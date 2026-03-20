import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import pLimit from 'p-limit';

import {
  LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY,
  LIBRARY_REBUILD_REQUIRED_SETTING_KEY,
  PREVIOUS_GALLERY_ROOT_SETTING_KEY
} from '../constants/app-setting-keys.js';
import { appConfig } from '../config/env.js';
import {
  appSettingsRepository,
  folderRepository,
  folderScanStateRepository,
  imageRepository,
  maintenanceRepository,
  scanRunRepository
} from '../db/repositories.js';
import { generateDerivatives, generateThumbnailDerivative, readMediaMetadata } from './derivative-service.js';
import { log } from './log-service.js';
import { storageService } from './storage-service.js';
import {
  createFingerprint,
  getMediaTypeFromExtension,
  getMimeTypeFromExtension,
  getPreviewRelativePath,
  getStableSortTimestamp,
  getThumbnailRelativePath,
  isSupportedMediaFile
} from '../utils/image-utils.js';
import { resolveTakenAt } from '../utils/exif-utils.js';
import {
  getFolderDisplayInfo,
  getRelativeGalleryPath,
  matchesRelativeRoot,
  getSourceFolderPathFromRelativePath,
  isHiddenPath,
  normalizePath
} from '../utils/path-utils.js';
import {
  createFolderScanSignature,
  resolveFullScanOptions,
  shouldQueueDerivativeJobForStatus,
  shouldRefreshUnchangedImage,
  shouldSkipFolderBySignature,
  type FullScanOptions,
  type IndexedFileStatus
} from '../utils/scan-utils.js';
import { resolveUniqueSlug, slugifyFolderPath } from '../utils/slug.js';
import type { FolderRecord, FolderScanStateRecord, ScanRunRecord } from '../types/models.js';

interface ScanSummary {
  status: string;
  scanned_files: number;
  new_files: number;
  updated_files: number;
  removed_files: number;
  error_text: string | null;
}

interface DerivativeJob {
  absolutePath: string;
  relativePath: string;
  force: boolean;
  kind: 'all' | 'thumbnail';
}

interface ProcessedFileSummary {
  status: IndexedFileStatus;
  derivativeJob: DerivativeJob | null;
  refreshedIndexedRow: boolean;
  relativePath: string;
}

interface IndexedFileCandidate {
  absolutePath: string;
  relativePath: string;
  stats: Stats;
}

interface SourceFolderCandidate {
  absolutePath: string;
  relativePath: string;
}

interface ResolvedFolderResult {
  folder: FolderRecord;
  wroteFolder: boolean;
}

interface SourceFolderScanResult {
  folder: FolderRecord | null;
  sourceFolderPath: string;
  discoveredDirectImages: boolean;
  wroteFolder: boolean;
  scannedFiles: number;
  newFiles: number;
  updatedFiles: number;
  removedFiles: number;
  unchangedFiles: number;
  refreshedUnchangedRows: number;
  skippedUnchangedRows: number;
  usedFolderShortcut: boolean;
}

interface ImageProcessingContext {
  galleryRootChanged: boolean;
  hasStoredGalleryRoot: boolean;
}

interface FullScanMetrics {
  folderShortcutHits: number;
  folderShortcutImagesSkipped: number;
  folderShortcutMisses: number;
  folderWritesCommitted: number;
  folderWritesSkipped: number;
  unchangedFiles: number;
  unchangedFilesQueuedForDerivativeVerification: number;
  unchangedFilesSkippedDerivativeVerification: number;
  unchangedRowsRefreshed: number;
  unchangedRowsSkippedRefresh: number;
  discoveryDurationMs: number;
  derivativeJobsQueued: number;
  removedFolderStateRows: number;
}

interface DerivativeProcessingSummary {
  durationMs: number;
  generatedPreviews: number;
  generatedThumbnails: number;
  queuedJobs: number;
}

type ScanPhase = 'idle' | 'discovery' | 'derivatives';
type StartupAction = 'scan' | 'idle' | 'blocked';

export interface ScanProgressSnapshot {
  isScanning: boolean;
  scanReason: string | null;
  phase: ScanPhase;
  startedAt: string | null;
  runId: number | null;
  discoveredFolders: number;
  processedFolders: number;
  discoveredImages: number;
  processedImages: number;
  queuedDerivativeJobs: number;
  processedDerivativeJobs: number;
  generatedThumbnails: number;
  generatedPreviews: number;
  currentFolder: string | null;
  lastCompletedScan: ScanRunRecord | null;
}

const discoveryLimit = pLimit(appConfig.scanDiscoveryConcurrency);
const derivativeLimit = pLimit(appConfig.scanDerivativeConcurrency);
const HEARTBEAT_INTERVAL_MS = 5000;
const DERIVATIVE_CACHE_KEEP_FILE = '.gitkeep';
const ROOT_DISCOVERY_LABEL = '(root)';
export const LIBRARY_REBUILD_REQUIRED_MESSAGE =
  'Library rebuild required before scanning because the configured gallery root changed.';

function createEmptySummary(): ScanSummary {
  return {
    status: 'completed',
    scanned_files: 0,
    new_files: 0,
    updated_files: 0,
    removed_files: 0,
    error_text: null
  };
}

function createIdleProgress(lastCompletedScan: ScanRunRecord | null = null): ScanProgressSnapshot {
  return {
    isScanning: false,
    scanReason: null,
    phase: 'idle',
    startedAt: null,
    runId: null,
    discoveredFolders: 0,
    processedFolders: 0,
    discoveredImages: 0,
    processedImages: 0,
    queuedDerivativeJobs: 0,
    processedDerivativeJobs: 0,
    generatedThumbnails: 0,
    generatedPreviews: 0,
    currentFolder: null,
    lastCompletedScan
  };
}

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) {
    return '00:00';
  }

  const elapsedMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function formatStep(label: string, value: string | number): string {
  return `${label} ${value}`;
}

function formatDuration(durationMs: number): string {
  return `${durationMs}ms`;
}

function formatToggle(value: boolean): string {
  return value ? 'yes' : 'no';
}

function joinLogParts(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' | ');
}

class ScannerService {
  private queue = Promise.resolve<ScanSummary>(createEmptySummary());
  private progress = createIdleProgress(scanRunRepository.latestCompleted() ?? null);
  private heartbeatTimer: NodeJS.Timeout | null = null;

  getProgress(): ScanProgressSnapshot {
    return {
      ...this.progress,
      lastCompletedScan: this.progress.lastCompletedScan ? { ...this.progress.lastCompletedScan } : null
    };
  }

  isLibraryRebuildRequired(): boolean {
    return appSettingsRepository.get(LIBRARY_REBUILD_REQUIRED_SETTING_KEY) === '1';
  }

  handleStartup(reason = 'startup'): StartupAction {
    const options = resolveFullScanOptions({ repairUnchangedDerivatives: false });
    const currentGalleryRoot = normalizePath(appConfig.galleryRoot);
    const storedGalleryRoot = appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY);
    const normalizedStoredGalleryRoot = storedGalleryRoot ? normalizePath(storedGalleryRoot) : null;
    const hasStoredGalleryRoot = normalizedStoredGalleryRoot !== null;
    const galleryRootChanged = normalizedStoredGalleryRoot !== currentGalleryRoot;
    const hasIndexedFolders = folderRepository.getAll().length > 0;

    if (galleryRootChanged && normalizedStoredGalleryRoot && hasIndexedFolders) {
      this.markLibraryRebuildRequired(normalizedStoredGalleryRoot);
      log.info(
        joinLogParts([
          'Startup scan deferred',
          'rebuild required',
          formatStep('previous', normalizedStoredGalleryRoot),
          formatStep('current', currentGalleryRoot)
        ])
      );
      return 'blocked';
    }

    if (!galleryRootChanged || !hasStoredGalleryRoot || !hasIndexedFolders) {
      this.clearLibraryRebuildRequirement();
    }

    if (!hasIndexedFolders) {
      log.info(
        joinLogParts([
          'Startup scan queued',
          formatStep('reason', reason),
          formatStep('repair-derivatives', formatToggle(options.repairUnchangedDerivatives))
        ])
      );
      void this.scanAll(reason, options).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Startup scan failed (${reason})`, message);
      });
      return 'scan';
    }

    log.info(
      joinLogParts([
        'Startup scan skipped',
        formatStep('reason', reason),
        'using existing index'
      ])
    );
    return 'idle';
  }

  async scanAll(reason = 'manual', options: Partial<FullScanOptions> = {}): Promise<ScanRunRecord | undefined> {
    const resolvedOptions = resolveFullScanOptions(options);

    await this.enqueue(async () => this.performFullScan(reason, resolvedOptions));
    return scanRunRepository.latest();
  }

  async rebuildLibraryIndex(reason = 'rebuild'): Promise<ScanRunRecord | undefined> {
    const resolvedOptions = resolveFullScanOptions({
      repairUnchangedDerivatives: false,
      forceNewFileDerivatives: false
    });

    await this.enqueue(async () => this.performLibraryRebuild(reason, resolvedOptions));
    return scanRunRepository.latest();
  }

  async rebuildThumbnails(reason = 'rebuild-thumbnails'): Promise<ScanRunRecord | undefined> {
    await this.enqueue(async () => this.performThumbnailRebuild(reason));
    return scanRunRepository.latest();
  }

  async scanChangedPaths(relativePaths: string[], reason = 'watcher'): Promise<ScanRunRecord | undefined> {
    if (relativePaths.length === 0) {
      return scanRunRepository.latest();
    }

    await this.enqueue(async () => this.performIncrementalScan(relativePaths, reason));
    return scanRunRepository.latest();
  }

  private async enqueue(job: () => Promise<ScanSummary>): Promise<ScanSummary> {
    this.queue = this.queue.then(job, job);
    return this.queue;
  }

  private beginProgress(reason: string, runId: number): void {
    this.progress = {
      ...createIdleProgress(this.progress.lastCompletedScan),
      isScanning: true,
      scanReason: reason,
      phase: 'discovery',
      startedAt: new Date().toISOString(),
      runId
    };

    this.startHeartbeat();
    this.logProgress('started');
  }

  private setProgress(patch: Partial<Omit<ScanProgressSnapshot, 'lastCompletedScan'>>): void {
    this.progress = {
      ...this.progress,
      ...patch
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.logProgress('heartbeat');
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private logProgress(kind: 'started' | 'heartbeat' | 'folder' | 'phase' = 'heartbeat'): void {
    if (!this.progress.isScanning) {
      return;
    }

    if (kind === 'folder' || kind === 'phase') {
      return;
    }

    const elapsed = formatElapsed(this.progress.startedAt);
    if (kind === 'started') {
      log.info(
        joinLogParts([
          'Scan started',
          formatStep('reason', this.progress.scanReason ?? 'unknown'),
          formatStep('phase', this.progress.phase),
          formatStep('elapsed', elapsed)
        ])
      );
      return;
    }

    if (this.progress.phase === 'derivatives') {
      log.info(
        joinLogParts([
          'Derivatives',
          formatStep('jobs', `${this.progress.processedDerivativeJobs}/${this.progress.queuedDerivativeJobs}`),
          formatStep('thumbnails', this.progress.generatedThumbnails),
          formatStep('previews', this.progress.generatedPreviews),
          this.progress.currentFolder ? formatStep('current', this.progress.currentFolder) : null,
          formatStep('elapsed', elapsed)
        ])
      );
      return;
    }

    log.info(
      joinLogParts([
        'Discovery',
        formatStep('folders', `${this.progress.processedFolders}/${this.progress.discoveredFolders}`),
        formatStep('images', `${this.progress.processedImages}/${this.progress.discoveredImages}`),
        this.progress.currentFolder ? formatStep('current', this.progress.currentFolder) : null,
        formatStep('elapsed', elapsed)
      ])
    );
  }

  private finishProgress(): void {
    this.stopHeartbeat();
    this.progress = createIdleProgress(scanRunRepository.latestCompleted() ?? this.progress.lastCompletedScan);
  }

  private finishRun(runId: number, summary: ScanSummary): void {
    scanRunRepository.finish(runId, {
      ...summary,
      finished_at: new Date().toISOString()
    });
  }

  private finishUnavailableRun(runId: number, reason: string): ScanSummary {
    const storageState = storageService.refreshAvailability();
    const summary = {
      ...createEmptySummary(),
      status: 'skipped_unavailable',
      error_text: storageState.reason ?? 'Configured library storage is unavailable'
    };

    this.finishRun(runId, summary);
    this.finishProgress();

    log.info(
      joinLogParts([
        `Skipped scan (${reason})`,
        'storage unavailable',
        storageState.reason
      ])
    );

    return summary;
  }

  private markLibraryRebuildRequired(previousGalleryRoot: string): void {
    appSettingsRepository.set(LIBRARY_REBUILD_REQUIRED_SETTING_KEY, '1');
    appSettingsRepository.set(PREVIOUS_GALLERY_ROOT_SETTING_KEY, previousGalleryRoot);
  }

  private clearLibraryRebuildRequirement(): void {
    appSettingsRepository.remove(LIBRARY_REBUILD_REQUIRED_SETTING_KEY);
    appSettingsRepository.remove(PREVIOUS_GALLERY_ROOT_SETTING_KEY);
  }

  private async resetDerivativeDirectory(targetDirectory: string): Promise<void> {
    await fs.rm(targetDirectory, { recursive: true, force: true });
    await fs.mkdir(targetDirectory, { recursive: true });
    await fs.writeFile(path.join(targetDirectory, DERIVATIVE_CACHE_KEEP_FILE), '');
  }

  private async clearThumbnailCache(): Promise<void> {
    await this.resetDerivativeDirectory(appConfig.thumbnailsDir);
  }

  private isManagedGalleryPath(relativePath: string): boolean {
    return matchesRelativeRoot(relativePath, appConfig.managedGalleryRelativeIgnores);
  }

  private async walkMediaSourceFolders(
    currentAbsolutePath: string,
    onSourceFolder: (sourceFolder: SourceFolderCandidate) => Promise<void>,
    currentRelativePath: string | null = null
  ): Promise<void> {
    this.setProgress({
      currentFolder: currentRelativePath ? normalizePath(currentRelativePath) : ROOT_DISCOVERY_LABEL
    });

    const entries = await fs
      .readdir(currentAbsolutePath, { withFileTypes: true })
      .catch((error: unknown) => {
        const filesystemError = error as NodeJS.ErrnoException;
        if (filesystemError.code === 'ENOENT') {
          return null;
        }

        throw error;
      });

    if (!entries) {
      return;
    }

    const childDirectories: Array<{ absolutePath: string; relativePath: string }> = [];
    let hasDirectImages = false;

    for (const entry of entries) {
      const relativeEntryPath = currentRelativePath ? `${currentRelativePath}/${entry.name}` : entry.name;
      if (isHiddenPath(relativeEntryPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (this.isManagedGalleryPath(relativeEntryPath)) {
          continue;
        }

        childDirectories.push({
          absolutePath: path.join(currentAbsolutePath, entry.name),
          relativePath: relativeEntryPath
        });
        continue;
      }

      if (currentRelativePath && entry.isFile() && isSupportedMediaFile(entry.name)) {
        hasDirectImages = true;
      }
    }

    if (currentRelativePath && hasDirectImages) {
      const normalizedRelativePath = normalizePath(currentRelativePath);
      this.setProgress({
        discoveredFolders: this.progress.discoveredFolders + 1,
        currentFolder: normalizedRelativePath
      });
      await onSourceFolder({
        absolutePath: currentAbsolutePath,
        relativePath: normalizedRelativePath
      });
    }

    for (const childDirectory of childDirectories) {
      await this.walkMediaSourceFolders(childDirectory.absolutePath, onSourceFolder, childDirectory.relativePath);
    }
  }

  private clearIndexedSourceFolder(sourceFolderPath: string, existingFolders: FolderRecord[]): SourceFolderScanResult {
    const existingFolder = existingFolders.find(
      (folder) => normalizePath(folder.folder_path) === normalizePath(sourceFolderPath)
    );
    const removedFiles = existingFolder ? imageRepository.markAllDeletedByFolder(existingFolder.id) : 0;

    if (existingFolder) {
      folderRepository.setAvatar(existingFolder.id, null);
    }

    folderScanStateRepository.delete(sourceFolderPath);

    return {
      folder: existingFolder ?? null,
      sourceFolderPath,
      discoveredDirectImages: false,
      wroteFolder: false,
      scannedFiles: 0,
      newFiles: 0,
      updatedFiles: 0,
      removedFiles,
      unchangedFiles: 0,
      refreshedUnchangedRows: 0,
      skippedUnchangedRows: 0,
      usedFolderShortcut: false
    };
  }

  private async scanSourceFolder(
    sourceFolder: SourceFolderCandidate,
    existingFolders: FolderRecord[],
    usedSlugs: Set<string>,
    folderScanStates: Map<string, FolderScanStateRecord>,
    derivativeJobs: Map<string, DerivativeJob>,
    errors: string[],
    options: FullScanOptions,
    context: ImageProcessingContext
  ): Promise<SourceFolderScanResult> {
    const sourceFolderPath = normalizePath(sourceFolder.relativePath);
    const folderStartedAt = performance.now();
    const entries = await fs
      .readdir(sourceFolder.absolutePath, { withFileTypes: true })
      .catch((error: unknown) => {
        const filesystemError = error as NodeJS.ErrnoException;
        if (filesystemError.code === 'ENOENT') {
          return null;
        }

        throw error;
      });

    if (!entries) {
      return this.clearIndexedSourceFolder(sourceFolderPath, existingFolders);
    }

    const imageFiles = entries.filter(
      (entry) => entry.isFile() && isSupportedMediaFile(entry.name) && !entry.name.startsWith('.')
    );

    if (imageFiles.length === 0) {
      return this.clearIndexedSourceFolder(sourceFolderPath, existingFolders);
    }

    this.setProgress({
      currentFolder: sourceFolderPath,
      discoveredImages: this.progress.discoveredImages + imageFiles.length
    });

    let unchangedFiles = 0;
    let newFiles = 0;
    let updatedFiles = 0;
    let refreshedUnchangedRows = 0;
    let skippedUnchangedRows = 0;
    let usedFolderShortcut = false;
    let folderHadErrors = false;

    const resolvedFolder = this.resolveFolder(existingFolders, usedSlugs, sourceFolderPath);
    const folder = resolvedFolder.folder;
    const activeRelativePaths: string[] = [];
    const discoveredFiles: IndexedFileCandidate[] = [];

    await Promise.all(
      imageFiles.map((entry) =>
        discoveryLimit(async () => {
          const absolutePath = path.join(sourceFolder.absolutePath, entry.name);
          const relativePath = getRelativeGalleryPath(appConfig.galleryRoot, absolutePath);
          activeRelativePaths.push(relativePath);

          try {
            const stats = await fs.stat(absolutePath);
            discoveredFiles.push({
              absolutePath,
              relativePath,
              stats
            });
          } catch (error) {
            folderHadErrors = true;
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${relativePath}: ${message}`);
            this.setProgress({
              processedImages: this.progress.processedImages + 1
            });
            log.error(joinLogParts(['Failed to stat media during discovery', formatStep('file', relativePath), message]));
          }
        })
      )
    );

    const folderSignature = createFolderScanSignature(
      discoveredFiles.map((file) => ({
        relativePath: file.relativePath,
        fileSize: file.stats.size,
        mtimeMs: file.stats.mtimeMs
      }))
    );
    const storedFolderState = folderScanStates.get(sourceFolderPath);
    const hasCompleteTakenAtMetadata = imageRepository.countMissingTimestampMetadataByFolder(folder.id) === 0;
    const hasCompletePlaybackStrategyMetadata = imageRepository.countMissingPlaybackStrategyByFolder(folder.id) === 0;
    const hasMatchingIndexedFiles =
      discoveredFiles.length > 0 &&
      hasCompleteTakenAtMetadata &&
      hasCompletePlaybackStrategyMetadata &&
      imageRepository.countByFolder(folder.id) === discoveredFiles.length &&
      discoveredFiles.every((file) => {
        const existingImage = imageRepository.getByRelativePath(file.relativePath);
        return existingImage?.folder_id === folder.id && existingImage.is_deleted === 0;
      });

    if (
      !folderHadErrors &&
      shouldSkipFolderBySignature({
        currentSignature: folderSignature.signature,
        galleryRootChanged: context.galleryRootChanged,
        hasStoredGalleryRoot: context.hasStoredGalleryRoot,
        hasMatchingIndexedFiles,
        repairUnchangedDerivatives: options.repairUnchangedDerivatives,
        storedSignature: storedFolderState?.signature ?? null
      })
    ) {
      usedFolderShortcut = true;
      this.setProgress({
        processedImages: this.progress.processedImages + discoveredFiles.length
      });

      return {
        folder,
        sourceFolderPath,
        discoveredDirectImages: true,
        wroteFolder: resolvedFolder.wroteFolder,
        scannedFiles: imageFiles.length,
        newFiles: 0,
        updatedFiles: 0,
        removedFiles: 0,
        unchangedFiles: discoveredFiles.length,
        refreshedUnchangedRows: 0,
        skippedUnchangedRows: discoveredFiles.length,
        usedFolderShortcut
      };
    }

    await Promise.all(
      discoveredFiles.map((file) =>
        discoveryLimit(async () => {
          try {
            const result = await this.processImageFile(folder, file, options, context);

            if (result.status === 'new') {
              newFiles += 1;
            }

            if (result.status === 'updated') {
              updatedFiles += 1;
            }

            if (result.status === 'unchanged') {
              unchangedFiles += 1;
              if (result.refreshedIndexedRow) {
                refreshedUnchangedRows += 1;
              } else {
                skippedUnchangedRows += 1;
              }
            }

            if (result.derivativeJob) {
              this.queueDerivativeJob(derivativeJobs, result.derivativeJob);
            }
          } catch (error) {
            folderHadErrors = true;
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${file.relativePath}: ${message}`);
            log.error(joinLogParts(['Failed to index media', formatStep('file', file.relativePath), message]));
          } finally {
            this.setProgress({
              processedImages: this.progress.processedImages + 1
            });
          }
        })
      )
    );

    const removedFiles = imageRepository.markFolderImagesDeleted(folder.id, activeRelativePaths);
    folderRepository.setAvatar(folder.id, imageRepository.getLatestFolderImageId(folder.id));

    if (!folderHadErrors) {
      folderScanStateRepository.upsert({
        folderPath: sourceFolderPath,
        signature: folderSignature.signature,
        fileCount: folderSignature.fileCount,
        maxMtimeMs: folderSignature.maxMtimeMs,
        totalSize: folderSignature.totalSize
      });
      folderScanStates.set(sourceFolderPath, {
        folder_path: sourceFolderPath,
        signature: folderSignature.signature,
        file_count: folderSignature.fileCount,
        max_mtime_ms: folderSignature.maxMtimeMs,
        total_size: folderSignature.totalSize,
        updated_at: new Date().toISOString()
      });
    }

    log.info(
      joinLogParts([
        'App folder indexed',
        sourceFolderPath,
        formatStep('scanned', imageFiles.length),
        formatStep('new', newFiles),
        formatStep('updated', updatedFiles),
        formatStep('removed', removedFiles),
        formatStep('unchanged', unchangedFiles),
        formatStep('duration', formatDuration(elapsedMilliseconds(folderStartedAt)))
      ])
    );

    return {
      folder,
      sourceFolderPath,
      discoveredDirectImages: true,
      wroteFolder: resolvedFolder.wroteFolder,
      scannedFiles: imageFiles.length,
      newFiles,
      updatedFiles,
      removedFiles,
      unchangedFiles,
      refreshedUnchangedRows,
      skippedUnchangedRows,
      usedFolderShortcut
    };
  }

  private async performLibraryRebuild(reason: string, options: FullScanOptions): Promise<ScanSummary> {
    const storageState = storageService.refreshAvailability();
    if (!storageState.libraryAvailable) {
      throw new Error(storageState.reason ?? 'Configured library storage is unavailable');
    }

    log.info(
      joinLogParts([
        'Rebuild library index',
        formatStep('reason', reason),
        formatStep('root', normalizePath(appConfig.galleryRoot))
      ])
    );

    maintenanceRepository.resetLibraryIndex();
    appSettingsRepository.remove(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY);

    const summary = await this.performFullScan(reason, options);
    if (summary.status !== 'failed' && summary.status !== 'skipped_unavailable') {
      this.clearLibraryRebuildRequirement();
    }

    return summary;
  }

  private async performThumbnailRebuild(reason: string): Promise<ScanSummary> {
    if (this.isLibraryRebuildRequired()) {
      throw new Error(LIBRARY_REBUILD_REQUIRED_MESSAGE);
    }

    const runId = scanRunRepository.start();
    const summary = createEmptySummary();
    const errors: string[] = [];
    let derivativeSummary: DerivativeProcessingSummary = {
      durationMs: 0,
      generatedPreviews: 0,
      generatedThumbnails: 0,
      queuedJobs: 0
    };
    const rebuildStartedAt = performance.now();

    if (!storageService.refreshAvailability().libraryAvailable) {
      return this.finishUnavailableRun(runId, reason);
    }

    this.beginProgress(reason, runId);
    log.info(
      joinLogParts([
        'Rebuild thumbnails',
        formatStep('reason', reason),
        formatStep('root', normalizePath(appConfig.galleryRoot))
      ])
    );

    try {
      const indexedImages = imageRepository.listActive();
      const indexedFolders = new Set(
        indexedImages
          .map((image) => getSourceFolderPathFromRelativePath(image.relative_path))
          .filter((folderPath): folderPath is string => Boolean(folderPath))
      );
      const derivativeJobs: DerivativeJob[] = indexedImages.map((image) => ({
        absolutePath: image.absolute_path,
        relativePath: image.relative_path,
        force: true,
        kind: 'thumbnail'
      }));

      summary.scanned_files = indexedImages.length;
      this.setProgress({
        discoveredFolders: indexedFolders.size,
        processedFolders: indexedFolders.size,
        discoveredImages: indexedImages.length,
        processedImages: indexedImages.length,
        queuedDerivativeJobs: 0,
        processedDerivativeJobs: 0,
        generatedThumbnails: 0,
        generatedPreviews: 0,
        currentFolder: null
      });

      await this.clearThumbnailCache();
      derivativeSummary = await this.processDerivativeJobs(derivativeJobs, errors);
    } catch (error) {
      summary.status = 'failed';
      summary.error_text = error instanceof Error ? error.message : String(error);
      log.error('Thumbnail rebuild failed', summary.error_text);
    }

    if (errors.length > 0) {
      summary.error_text = errors.join('\n').slice(0, 8000);
      if (summary.status !== 'failed') {
        summary.status = 'completed_with_errors';
      }
    }

    this.finishRun(runId, summary);
    log.table(
      `Finished thumbnail rebuild (${reason})`,
      [
        ['Status', summary.status],
        ['Indexed media', summary.scanned_files],
        ['Thumbnails', derivativeSummary.generatedThumbnails],
        ['Previews', derivativeSummary.generatedPreviews],
        ['Duration', formatDuration(elapsedMilliseconds(rebuildStartedAt))]
      ],
      summary.status === 'completed' ? 'success' : summary.status === 'completed_with_errors' ? 'warning' : 'error'
    );
    this.finishProgress();

    return summary;
  }

  private async performFullScan(reason: string, options: FullScanOptions): Promise<ScanSummary> {
    const runId = scanRunRepository.start();
    const summary = createEmptySummary();
    const errors: string[] = [];
    const derivativeJobs = new Map<string, DerivativeJob>();
    const metrics: FullScanMetrics = {
      folderShortcutHits: 0,
      folderShortcutImagesSkipped: 0,
      folderShortcutMisses: 0,
      folderWritesCommitted: 0,
      folderWritesSkipped: 0,
      unchangedFiles: 0,
      unchangedFilesQueuedForDerivativeVerification: 0,
      unchangedFilesSkippedDerivativeVerification: 0,
      unchangedRowsRefreshed: 0,
      unchangedRowsSkippedRefresh: 0,
      discoveryDurationMs: 0,
      derivativeJobsQueued: 0,
      removedFolderStateRows: 0
    };
    let derivativeSummary: DerivativeProcessingSummary = {
      durationMs: 0,
      generatedPreviews: 0,
      generatedThumbnails: 0,
      queuedJobs: 0
    };
    const scanStartedAt = performance.now();
    const currentGalleryRoot = normalizePath(appConfig.galleryRoot);
    const storedGalleryRoot = appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY);
    const normalizedStoredGalleryRoot = storedGalleryRoot ? normalizePath(storedGalleryRoot) : null;
    const hasStoredGalleryRoot = normalizedStoredGalleryRoot !== null;
    const galleryRootChanged = normalizedStoredGalleryRoot !== currentGalleryRoot;
    const imageProcessingContext: ImageProcessingContext = {
      galleryRootChanged,
      hasStoredGalleryRoot
    };

    if (!storageService.refreshAvailability().libraryAvailable) {
      return this.finishUnavailableRun(runId, reason);
    }

    this.beginProgress(reason, runId);
    log.info(
      joinLogParts([
        `Starting full scan (${reason})`,
        formatStep('repair-derivatives', formatToggle(options.repairUnchangedDerivatives)),
        formatStep('root-changed', formatToggle(galleryRootChanged)),
        formatStep('stored-root', formatToggle(hasStoredGalleryRoot)),
        appConfig.managedGalleryRelativeIgnores.length > 0
          ? formatStep('ignored-managed-paths', appConfig.managedGalleryRelativeIgnores.join(','))
          : null,
        formatStep('discovery-concurrency', appConfig.scanDiscoveryConcurrency),
        formatStep('derivative-concurrency', appConfig.scanDerivativeConcurrency)
      ])
    );

    try {
      const existingFolders = folderRepository.getAll();
      if (galleryRootChanged && normalizedStoredGalleryRoot && existingFolders.length > 0) {
        this.markLibraryRebuildRequired(normalizedStoredGalleryRoot);
        log.info(
          joinLogParts([
            'Gallery root changed',
            formatStep('previous', normalizedStoredGalleryRoot),
            formatStep('current', currentGalleryRoot)
          ])
        );
      }
      const folderScanStates = new Map(
        folderScanStateRepository.getAll().map((state) => [normalizePath(state.folder_path), state])
      );
      const usedSlugs = new Set(existingFolders.map((folder) => folder.slug));
      const activeFolderPaths = new Set<string>();
      const discoveredFolderIds = new Set<number>();
      const discoveryStartedAt = performance.now();
      let discoveredSourceFolders = 0;

      await this.walkMediaSourceFolders(appConfig.galleryRoot, async (sourceFolder) => {
        discoveredSourceFolders += 1;
        const result = await this.scanSourceFolder(
          sourceFolder,
          existingFolders,
          usedSlugs,
          folderScanStates,
          derivativeJobs,
          errors,
          options,
          imageProcessingContext
        );

        summary.scanned_files += result.scannedFiles;
        summary.new_files += result.newFiles;
        summary.updated_files += result.updatedFiles;
        summary.removed_files += result.removedFiles;
        metrics.unchangedFiles += result.unchangedFiles;
        metrics.unchangedRowsRefreshed += result.refreshedUnchangedRows;
        metrics.unchangedRowsSkippedRefresh += result.skippedUnchangedRows;

        if (result.discoveredDirectImages && result.folder) {
          activeFolderPaths.add(result.sourceFolderPath);
          discoveredFolderIds.add(result.folder.id);
          if (result.wroteFolder) {
            metrics.folderWritesCommitted += 1;
          } else {
            metrics.folderWritesSkipped += 1;
          }
        }

        if (result.usedFolderShortcut) {
          metrics.folderShortcutHits += 1;
          metrics.folderShortcutImagesSkipped += result.unchangedFiles;
          metrics.unchangedFilesSkippedDerivativeVerification += result.unchangedFiles;

          log.info(
            joinLogParts([
              'Folder shortcut',
              result.sourceFolderPath,
              formatStep('files', result.unchangedFiles)
            ])
          );
        } else {
          metrics.folderShortcutMisses += 1;
          if (options.repairUnchangedDerivatives) {
            metrics.unchangedFilesQueuedForDerivativeVerification += result.unchangedFiles;
          } else {
            metrics.unchangedFilesSkippedDerivativeVerification += result.unchangedFiles;
          }
        }

        this.setProgress({
          processedFolders: this.progress.processedFolders + 1
        });
        this.logProgress('folder');
      });

      for (const folder of existingFolders) {
        if (!discoveredFolderIds.has(folder.id)) {
          summary.removed_files += imageRepository.markAllDeletedByFolder(folder.id);
          folderRepository.setAvatar(folder.id, null);
        }
      }

      metrics.removedFolderStateRows = folderScanStateRepository.deleteMissing([...activeFolderPaths]);

      metrics.discoveryDurationMs = elapsedMilliseconds(discoveryStartedAt);
      metrics.derivativeJobsQueued = derivativeJobs.size;

      log.table('Discovery complete', [
        ['Folders', discoveredSourceFolders],
        ['Files', summary.scanned_files],
        ['New', summary.new_files],
        ['Updated', summary.updated_files],
        ['Removed', summary.removed_files],
        ['Shortcuts', metrics.folderShortcutHits],
        ['Queued derivatives', metrics.derivativeJobsQueued],
        ['Duration', formatDuration(metrics.discoveryDurationMs)]
      ]);

      derivativeSummary = await this.processDerivativeJobs([...derivativeJobs.values()], errors);
    } catch (error) {
      summary.status = 'failed';
      summary.error_text = error instanceof Error ? error.message : String(error);
      log.error('Full scan failed', summary.error_text);
    }

    if (errors.length > 0) {
      summary.error_text = errors.join('\n').slice(0, 8000);
      if (summary.status !== 'failed') {
        summary.status = 'completed_with_errors';
      }
    }

    if (summary.status !== 'failed') {
      appSettingsRepository.set(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, currentGalleryRoot);
    }

    this.finishRun(runId, summary);
    log.table(`Finished full scan (${reason})`, [
      ['Status', summary.status],
      ['Files', summary.scanned_files],
      ['New', summary.new_files],
      ['Updated', summary.updated_files],
      ['Removed', summary.removed_files],
      ['Thumbnails', derivativeSummary.generatedThumbnails],
      ['Previews', derivativeSummary.generatedPreviews],
      ['Duration', formatDuration(elapsedMilliseconds(scanStartedAt))]
    ], summary.status === 'completed' ? 'success' : summary.status === 'completed_with_errors' ? 'warning' : 'error');
    this.finishProgress();

    return summary;
  }

  private async performIncrementalScan(relativePaths: string[], reason: string): Promise<ScanSummary> {
    const runId = scanRunRepository.start();
    const summary = createEmptySummary();
    const errors: string[] = [];
    const derivativeJobs = new Map<string, DerivativeJob>();
    let fallbackReason: string | null = null;

    if (!storageService.refreshAvailability().libraryAvailable) {
      return this.finishUnavailableRun(runId, reason);
    }

    const normalizedPaths = [...new Set(relativePaths.map((value) => normalizePath(value)).filter(Boolean))];
    const impactedSourceFolders = new Set<string>();

    for (const relativePath of normalizedPaths) {
      if (isHiddenPath(relativePath)) {
        continue;
      }

      if (this.isManagedGalleryPath(relativePath)) {
        continue;
      }

      if (!isSupportedMediaFile(path.basename(relativePath))) {
        continue;
      }

      const sourceFolderPath = getSourceFolderPathFromRelativePath(relativePath);
      if (!sourceFolderPath) {
        fallbackReason = `${reason}:fallback`;
        break;
      }

      impactedSourceFolders.add(sourceFolderPath);
    }

    this.beginProgress(reason, runId);
    this.setProgress({
      discoveredFolders: impactedSourceFolders.size,
      discoveredImages: 0
    });

    log.info(
      joinLogParts([
        `Starting incremental scan (${reason})`,
        formatStep('files', normalizedPaths.length),
        formatStep('source-folders', impactedSourceFolders.size)
      ])
    );

    try {
      const existingFolders = folderRepository.getAll();
      const usedSlugs = new Set(existingFolders.map((folder) => folder.slug));
      const folderScanStates = new Map(
        folderScanStateRepository.getAll().map((state) => [normalizePath(state.folder_path), state])
      );
      const imageProcessingContext: ImageProcessingContext = {
        galleryRootChanged: false,
        hasStoredGalleryRoot: appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY) !== null
      };
      const incrementalOptions = resolveFullScanOptions({ repairUnchangedDerivatives: false });

      for (const sourceFolderPath of impactedSourceFolders) {
        const result = await this.scanSourceFolder(
          {
            absolutePath: path.join(appConfig.galleryRoot, sourceFolderPath),
            relativePath: sourceFolderPath
          },
          existingFolders,
          usedSlugs,
          folderScanStates,
          derivativeJobs,
          errors,
          incrementalOptions,
          imageProcessingContext
        );

        summary.scanned_files += result.scannedFiles;
        summary.new_files += result.newFiles;
        summary.updated_files += result.updatedFiles;
        summary.removed_files += result.removedFiles;

        this.setProgress({
          processedFolders: this.progress.processedFolders + 1
        });
        this.logProgress('folder');
      }

      if (fallbackReason === null) {
        await this.processDerivativeJobs([...derivativeJobs.values()], errors);
      }
    } catch (error) {
      summary.status = 'failed';
      summary.error_text = error instanceof Error ? error.message : String(error);
      log.error('Incremental scan failed', summary.error_text);
    }

    if (errors.length > 0) {
      summary.error_text = errors.join('\n').slice(0, 8000);
      if (summary.status !== 'failed') {
        summary.status = 'completed_with_errors';
      }
    }

    this.finishRun(runId, summary);
    log.table(`Finished incremental scan (${reason})`, [
      ['Status', summary.status],
      ['Files', summary.scanned_files],
      ['New', summary.new_files],
      ['Updated', summary.updated_files],
      ['Removed', summary.removed_files]
    ], summary.status === 'completed' ? 'success' : summary.status === 'completed_with_errors' ? 'warning' : 'error');
    this.finishProgress();

    if (fallbackReason) {
      return this.performFullScan(fallbackReason, resolveFullScanOptions());
    }

    return summary;
  }

  private queueDerivativeJob(queue: Map<string, DerivativeJob>, job: DerivativeJob): void {
    const existing = queue.get(job.relativePath);

    if (!existing) {
      queue.set(job.relativePath, job);
      return;
    }

    queue.set(job.relativePath, {
      ...job,
      force: existing.force || job.force,
      kind: existing.kind === 'all' || job.kind === 'all' ? 'all' : 'thumbnail'
    });
  }

  private async processDerivativeJobs(jobs: DerivativeJob[], errors: string[]): Promise<DerivativeProcessingSummary> {
    const startedAt = performance.now();
    let generatedThumbnails = 0;
    let generatedPreviews = 0;

    if (jobs.length === 0) {
      this.setProgress({
        queuedDerivativeJobs: 0,
        processedDerivativeJobs: 0
      });

      return {
        durationMs: 0,
        generatedPreviews: 0,
        generatedThumbnails: 0,
        queuedJobs: 0
      };
    }

    this.setProgress({
      phase: 'derivatives',
      queuedDerivativeJobs: jobs.length,
      processedDerivativeJobs: 0,
      currentFolder: jobs[0] ? getSourceFolderPathFromRelativePath(jobs[0].relativePath) : null
    });
    this.logProgress('phase');
    log.info(
      joinLogParts([
        'Starting derivative phase',
        formatStep('jobs', jobs.length),
        formatStep('concurrency', appConfig.scanDerivativeConcurrency)
      ])
    );

    await Promise.all(
      jobs.map((job) =>
        derivativeLimit(async () => {
          try {
            this.setProgress({
              currentFolder: getSourceFolderPathFromRelativePath(job.relativePath)
            });

            if (job.kind === 'thumbnail') {
              const thumbnail = await generateThumbnailDerivative(job.absolutePath, job.relativePath, job.force);

              if (thumbnail.generatedThumbnail) {
                generatedThumbnails += 1;
                this.setProgress({
                  generatedThumbnails: this.progress.generatedThumbnails + 1
                });
              }
            } else {
              const derivatives = await generateDerivatives(job.absolutePath, job.relativePath, job.force);

              if (derivatives.generatedThumbnail) {
                generatedThumbnails += 1;
                this.setProgress({
                  generatedThumbnails: this.progress.generatedThumbnails + 1
                });
              }

              if (derivatives.generatedPreview) {
                generatedPreviews += 1;
                this.setProgress({
                  generatedPreviews: this.progress.generatedPreviews + 1
                });
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${job.relativePath}: ${message}`);
            log.error(joinLogParts(['Derivative generation failed', formatStep('file', job.relativePath), message]));
          } finally {
            this.setProgress({
              processedDerivativeJobs: this.progress.processedDerivativeJobs + 1
            });
          }
        })
      )
    );

    const summary = {
      durationMs: elapsedMilliseconds(startedAt),
      generatedPreviews,
      generatedThumbnails,
      queuedJobs: jobs.length
    };

    log.table('Finished derivative phase', [
      ['Jobs', summary.queuedJobs],
      ['Thumbnails', summary.generatedThumbnails],
      ['Previews', summary.generatedPreviews],
      ['Duration', formatDuration(summary.durationMs)]
    ]);

    return summary;
  }

  private resolveFolder(existingFolders: FolderRecord[], usedSlugs: Set<string>, sourceFolderPath: string): ResolvedFolderResult {
    const normalizedFolderPath = normalizePath(sourceFolderPath);
    const existingByFolder = existingFolders.find(
      (folder) => normalizePath(folder.folder_path) === normalizedFolderPath
    );
    const folderName = getFolderDisplayInfo(normalizedFolderPath).name;

    if (existingByFolder) {
      usedSlugs.delete(existingByFolder.slug);
    }

    const slug = resolveUniqueSlug(normalizedFolderPath, usedSlugs, slugifyFolderPath);
    const saved = folderRepository.save({
      slug,
      name: folderName,
      folderPath: normalizedFolderPath
    });
    this.rememberFolder(existingFolders, saved.folder);
    return {
      folder: saved.folder,
      wroteFolder: saved.wrote
    };
  }

  private rememberFolder(existingFolders: FolderRecord[], folder: FolderRecord): void {
    const existingIndex = existingFolders.findIndex((entry) => entry.id === folder.id);

    if (existingIndex >= 0) {
      existingFolders[existingIndex] = folder;
      return;
    }

    existingFolders.push(folder);
  }

  private async processImageFile(
    folder: FolderRecord,
    file: IndexedFileCandidate,
    options: FullScanOptions = resolveFullScanOptions(),
    context: ImageProcessingContext = {
      galleryRootChanged: false,
      hasStoredGalleryRoot: false
    }
  ): Promise<ProcessedFileSummary> {
    const fingerprint = createFingerprint(file.relativePath, file.stats.size, file.stats.mtimeMs);
    const existing = imageRepository.getByRelativePath(file.relativePath);
    const extension = path.extname(file.absolutePath).toLowerCase();
    const absolutePathChanged = existing ? normalizePath(existing.absolute_path) !== normalizePath(file.absolutePath) : false;
    const mediaType = getMediaTypeFromExtension(extension);
    const thumbnailRelativePath = getThumbnailRelativePath(file.relativePath);
    const previewRelativePath = getPreviewRelativePath(file.relativePath, mediaType);
    const needsTakenAtBackfill = existing?.taken_at === null || existing?.taken_at_source === null;
    const needsMediaBackfill = existing?.media_type !== mediaType || (mediaType === 'video' && existing?.duration_ms === null);
    const needsPlaybackStrategyBackfill = mediaType === 'video' && existing?.playback_strategy === null;
    const needsAnimatedBackfill = mediaType === 'image' && existing?.is_animated === null;

    if (existing && existing.checksum_or_fingerprint === fingerprint) {
      const refreshedIndexedRow = shouldRefreshUnchangedImage({
        absolutePathChanged,
        galleryRootChanged: context.galleryRootChanged,
        hasStoredGalleryRoot: context.hasStoredGalleryRoot,
        isDeleted: existing.is_deleted === 1
      });

      let metadataTakenAt = existing.taken_at;
      let metadataDurationMs = existing.duration_ms;
      let metadataWidth = existing.width;
      let metadataHeight = existing.height;
      let metadataPlaybackStrategy = existing.playback_strategy ?? 'preview';
      let metadataIsAnimated = existing.is_animated === 1;

      if (needsTakenAtBackfill || needsMediaBackfill || needsPlaybackStrategyBackfill || needsAnimatedBackfill) {
        const metadata = await readMediaMetadata(file.absolutePath, mediaType, {
          fileSize: file.stats.size
        });
        metadataTakenAt = metadata.takenAt;
        metadataDurationMs = metadata.durationMs;
        metadataWidth = metadata.width;
        metadataHeight = metadata.height;
        metadataPlaybackStrategy = metadata.playbackStrategy;
        metadataIsAnimated = metadata.isAnimated;
      }

      if (refreshedIndexedRow || needsTakenAtBackfill || needsMediaBackfill || needsPlaybackStrategyBackfill || needsAnimatedBackfill) {
        const resolvedTakenAt = resolveTakenAt({
          exifTakenAt: metadataTakenAt,
          existingTakenAt: existing.taken_at,
          existingTakenAtSource: existing.taken_at_source,
          existingSortTimestamp: existing.sort_timestamp,
          existingFirstSeenAt: existing.first_seen_at,
          existingMtimeMs: existing.mtime_ms,
          fileMtimeMs: file.stats.mtimeMs,
          firstSeenAt: existing.first_seen_at,
          stableFallbackTimestamp: existing.sort_timestamp
        });

        imageRepository.refreshIndexed({
          folderId: folder.id,
          filename: path.basename(file.absolutePath),
          extension,
          relativePath: file.relativePath,
          absolutePath: file.absolutePath,
          fileSize: file.stats.size,
          width: metadataWidth,
          height: metadataHeight,
          mediaType,
          mimeType: getMimeTypeFromExtension(extension),
          durationMs: metadataDurationMs,
          isAnimated: metadataIsAnimated,
          fingerprint,
          mtimeMs: file.stats.mtimeMs,
          takenAt: resolvedTakenAt.takenAt,
          takenAtSource: resolvedTakenAt.source,
          thumbnailPath: existing.thumbnail_path || thumbnailRelativePath,
          previewPath: existing.preview_path || previewRelativePath,
          playbackStrategy: metadataPlaybackStrategy
        });
      }

      return {
        status: 'unchanged',
        derivativeJob: shouldQueueDerivativeJobForStatus('unchanged', options) || needsPlaybackStrategyBackfill
          ? {
              absolutePath: file.absolutePath,
              relativePath: file.relativePath,
              force: false,
              kind: 'all'
            }
          : null,
        refreshedIndexedRow,
        relativePath: file.relativePath
      };
    }

    const metadata = await readMediaMetadata(file.absolutePath, mediaType, {
      fileSize: file.stats.size
    });
    const sortTimestamp = getStableSortTimestamp(
      existing
        ? {
            sortTimestamp: existing.sort_timestamp,
            firstSeenAt: existing.first_seen_at
          }
        : null,
      file.stats.mtimeMs
    );
    const firstSeenAt = existing?.first_seen_at ?? new Date().toISOString();
    const resolvedTakenAt = resolveTakenAt({
      exifTakenAt: metadata.takenAt,
      existingTakenAt: existing?.taken_at,
      existingTakenAtSource: existing?.taken_at_source,
      existingSortTimestamp: existing?.sort_timestamp,
      existingFirstSeenAt: existing?.first_seen_at,
      existingMtimeMs: existing?.mtime_ms,
      fileMtimeMs: file.stats.mtimeMs,
      firstSeenAt,
      stableFallbackTimestamp: sortTimestamp
    });

    imageRepository.upsert({
      folderId: folder.id,
      filename: path.basename(file.absolutePath),
      extension,
      relativePath: file.relativePath,
      absolutePath: file.absolutePath,
      fileSize: file.stats.size,
      width: metadata.width,
      height: metadata.height,
      mediaType,
      mimeType: getMimeTypeFromExtension(extension),
      durationMs: metadata.durationMs,
      isAnimated: metadata.isAnimated,
      fingerprint,
      mtimeMs: file.stats.mtimeMs,
      firstSeenAt,
      sortTimestamp,
      takenAt: resolvedTakenAt.takenAt,
      takenAtSource: resolvedTakenAt.source,
      thumbnailPath: thumbnailRelativePath,
      previewPath: previewRelativePath,
      playbackStrategy: metadata.playbackStrategy
    });

      return {
        status: existing ? 'updated' : 'new',
        derivativeJob: {
          absolutePath: file.absolutePath,
          relativePath: file.relativePath,
          force: existing ? true : options.forceNewFileDerivatives,
          kind: 'all'
        },
      refreshedIndexedRow: false,
      relativePath: file.relativePath
    };
  }
}

export const scannerService = new ScannerService();
