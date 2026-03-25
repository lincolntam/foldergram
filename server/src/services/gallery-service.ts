import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  HOME_FEED_DEFAULT_MODE_SETTING_KEY,
  LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY,
  LIBRARY_REBUILD_REQUIRED_SETTING_KEY,
  PREVIOUS_GALLERY_ROOT_SETTING_KEY
} from '../constants/app-setting-keys.js';
import { appConfig } from '../config/env.js';
import { appSettingsRepository, folderRepository, folderScanStateRepository, imageRepository, likeRepository, scanRunRepository } from '../db/repositories.js';
import type { FeedImage, ImageDetail, FolderSummaryRecord, MediaType, PlaybackStrategy, TrashImage } from '../types/models.js';
import { deserializeImageExifData } from '../utils/exif-utils.js';
import { buildMonthDayKey, countFeedBursts, diversifyFeedCandidates, groupFeedBursts, listMonthDayKeysAroundDate } from '../utils/feed-utils.js';
import { shouldPreferMomentRail, type FeedRailKind } from '../utils/feed-rail-utils.js';
import { countSupportedRootMediaFiles } from '../utils/gallery-root-utils.js';
import { getPathBreadcrumb } from '../utils/path-utils.js';
import { scannerService } from './scanner-service.js';
import { storageService } from './storage-service.js';

type FeedMode = 'recent' | 'rediscover' | 'random';

interface FeedCapsuleDefinition {
  id: string;
  title: string;
  subtitle: string;
  dateContext: string;
  minimumImageCount: number;
  count: () => number;
  list: (page: number, limit: number) => FeedImage[];
}

interface FeedRailDefinition {
  kind: FeedRailKind;
  title: string;
  description: string;
  singularLabel: string;
  capsules: FeedCapsuleDefinition[];
}

interface DeleteFolderOptions {
  deleteSourceFolder?: boolean;
}

const REDISCOVER_MIN_AGE_MS = 1000 * 60 * 60 * 24 * 180;
const DIVERSIFIED_FETCH_BATCH_SIZE = 72;
const MAX_DIVERSIFIED_CANDIDATES = 2400;
const THIS_WEEK_RADIUS_DAYS = 7;
const LAST_YEAR_RADIUS_DAYS = 45;
const HIGHLIGHT_BATCH_CANDIDATE_LIMIT = 180;
const HIGHLIGHT_BATCH_COUNT = 3;
const HIGHLIGHT_CAPSULE_MAX_ITEMS = 30;
// Keep the rail visually distinct from the first home-feed screen when enough alternatives exist.
const HIGHLIGHT_FEED_OVERLAP_WINDOW = 18;
const RAIL_COVER_CANDIDATE_LIMIT = 12;

type IndexedFeedImage = FeedImage & { playbackStrategy?: PlaybackStrategy | null };
type IndexedImageDetail = ImageDetail & { playbackStrategy?: PlaybackStrategy | null; exifJson?: string | null };
type IndexedTrashImage = TrashImage & { playbackStrategy?: PlaybackStrategy | null };
type ScanSummaryRecord = ReturnType<typeof scanRunRepository.latestCompleted>;

function toViewerSafeScanSummary(scan: ScanSummaryRecord | null) {
  if (!scan) {
    return null;
  }

  return {
    ...scan,
    error_text: null
  };
}

function buildViewerSafeStorageReason(libraryAvailable: boolean): string | null {
  return libraryAvailable ? null : 'Configured library storage is unavailable.';
}

function parseFeedMode(value: string | null): FeedMode {
  return value === 'recent' || value === 'rediscover' || value === 'random' ? value : 'random';
}

function getDefaultHomeFeedMode(): FeedMode {
  return parseFeedMode(appSettingsRepository.get(HOME_FEED_DEFAULT_MODE_SETTING_KEY));
}

function getDerivativeAssetVersion(): string | null {
  const lastCompletedScanId = scanRunRepository.latestCompleted()?.id ?? null;
  return lastCompletedScanId === null ? null : String(lastCompletedScanId);
}

function toPublicMediaUrl(basePath: '/thumbnails' | '/previews', relativePath: string, version?: string | null): string {
  const encodedSegments = relativePath.split('/').map(encodeURIComponent).join('/');
  if (!version) {
    return `${basePath}/${encodedSegments}`;
  }

  return `${basePath}/${encodedSegments}?v=${encodeURIComponent(version)}`;
}

function buildOriginalUrl(id: number): string {
  return `/api/originals/${id}`;
}

function buildPreviewUrl(
  image: {
    id: number;
    mediaType: MediaType;
    previewUrl: string;
  },
  useOriginalForImages = false,
  version?: string | null
): string {
  if (useOriginalForImages && image.mediaType === 'image') {
    return buildOriginalUrl(image.id);
  }

  return toPublicMediaUrl('/previews', image.previewUrl, version);
}

function resolveWithinRoot(rootPath: string, targetPath: string): string | null {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(path.resolve(rootPath), resolved);

  if ((relative.startsWith('..') || path.isAbsolute(relative)) || relative === '') {
    return relative === '' ? resolved : null;
  }

  return resolved;
}

async function removeFileIfPresent(targetPath: string | null): Promise<void> {
  if (!targetPath) {
    return;
  }

  try {
    await fsPromises.unlink(targetPath);
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function removeDirectoryIfEmpty(targetPath: string | null): Promise<void> {
  if (!targetPath) {
    return;
  }

  try {
    await fsPromises.rmdir(targetPath);
  } catch (error) {
    const directoryError = error as NodeJS.ErrnoException;
    if (directoryError.code !== 'ENOENT' && directoryError.code !== 'ENOTEMPTY' && directoryError.code !== 'EEXIST') {
      throw error;
    }
  }
}

async function removeDirectoryTree(targetPath: string | null): Promise<void> {
  if (!targetPath) {
    return;
  }

  try {
    await fsPromises.rm(targetPath, { recursive: true, force: true });
  } catch (error) {
    const directoryError = error as NodeJS.ErrnoException;
    if (directoryError.code !== 'ENOENT') {
      throw error;
    }
  }
}

function countDerivativeFilesOnDisk(rootPath: string): number {
  try {
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      const entryPath = path.join(rootPath, entry.name);

      if (entry.isDirectory()) {
        count += countDerivativeFilesOnDisk(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name !== '.gitkeep') {
        count += 1;
      }
    }

    return count;
  } catch (error) {
    const filesystemError = error as NodeJS.ErrnoException;
    if (filesystemError.code === 'ENOENT') {
      return 0;
    }

    throw error;
  }
}

function isSameOrDescendantFolderPath(rootFolderPath: string, candidateFolderPath: string): boolean {
  return candidateFolderPath === rootFolderPath || candidateFolderPath.startsWith(`${rootFolderPath}/`);
}

function mapFeedImage(image: IndexedFeedImage, derivativeVersion = getDerivativeAssetVersion()): FeedImage {
  const { playbackStrategy, ...rest } = image;
  return {
    ...rest,
    isAnimated: Boolean(rest.isAnimated),
    folderBreadcrumb: getPathBreadcrumb(rest.folderPath),
    thumbnailUrl: toPublicMediaUrl('/thumbnails', rest.thumbnailUrl, derivativeVersion),
    previewUrl: buildPreviewUrl({
      id: rest.id,
      mediaType: rest.mediaType,
      previewUrl: rest.previewUrl
    }, false, derivativeVersion)
  };
}

function mapImageDetail(image: IndexedImageDetail, derivativeVersion = getDerivativeAssetVersion()): ImageDetail {
  const { playbackStrategy, exifJson, ...rest } = image;
  const useOriginalForImages = appConfig.imageDetailSource === 'original';
  return {
    ...rest,
    isAnimated: Boolean(rest.isAnimated),
    exif: deserializeImageExifData(exifJson),
    folderBreadcrumb: getPathBreadcrumb(rest.folderPath),
    thumbnailUrl: toPublicMediaUrl('/thumbnails', rest.thumbnailUrl, derivativeVersion),
    previewUrl: buildPreviewUrl({
      id: rest.id,
      mediaType: rest.mediaType,
      previewUrl: rest.previewUrl
    }, useOriginalForImages, derivativeVersion),
    originalUrl: buildOriginalUrl(rest.id),
    playbackStrategy
  };
}

function mapTrashImage(image: IndexedTrashImage, derivativeVersion = getDerivativeAssetVersion()): TrashImage {
  const { playbackStrategy, ...rest } = image;
  return {
    ...rest,
    isAnimated: Boolean(rest.isAnimated),
    folderBreadcrumb: getPathBreadcrumb(rest.folderPath),
    thumbnailUrl: toPublicMediaUrl('/thumbnails', rest.thumbnailUrl, derivativeVersion),
    previewUrl: buildPreviewUrl({
      id: rest.id,
      mediaType: rest.mediaType,
      previewUrl: rest.previewUrl
    }, false, derivativeVersion)
  };
}

function buildFolderSummary(folder: FolderSummaryRecord) {
  const derivativeVersion = getDerivativeAssetVersion();
  const preferredAvatarImageId = folder.avatar_image_id ?? imageRepository.getLatestFolderImageId(folder.id);
  let avatar = preferredAvatarImageId ? imageRepository.getImageDetail(preferredAvatarImageId, undefined, true) : undefined;

  if (!avatar) {
    const fallbackAvatarImageId = imageRepository.getLatestFolderImageId(folder.id);
    avatar = fallbackAvatarImageId ? imageRepository.getImageDetail(fallbackAvatarImageId, undefined, true) : undefined;
  }

  return {
    id: folder.id,
    slug: folder.slug,
    name: folder.name,
    description: folder.description,
    folderPath: folder.folder_path,
    breadcrumb: getPathBreadcrumb(folder.folder_path),
    imageCount: folder.image_count,
    videoCount: folder.video_count,
    latestImageMtimeMs: folder.latest_image_mtime_ms,
    avatarImageId: avatar?.id ?? null,
    avatarUrl: avatar ? mapImageDetail(avatar, derivativeVersion).thumbnailUrl : null
  };
}

function formatMonthDay(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(date);
}

function formatShortRange(startDate: Date, endDate: Date): string {
  const sameMonth = startDate.getMonth() === endDate.getMonth();
  const sameYear = startDate.getFullYear() === endDate.getFullYear();

  if (sameMonth && sameYear) {
    const month = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(startDate);
    return `${month} ${startDate.getDate()}-${endDate.getDate()}, ${startDate.getFullYear()}`;
  }

  return `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(startDate)} to ${new Intl.DateTimeFormat(
    undefined,
    {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }
  ).format(endDate)}`;
}

function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
}

function mapFeedItems(items: IndexedFeedImage[], derivativeVersion = getDerivativeAssetVersion()): FeedImage[] {
  return items.map((item) => mapFeedImage(item, derivativeVersion));
}

function buildPaginatedPayload(items: FeedImage[], page: number, limit: number, total: number) {
  return {
    items,
    page,
    limit,
    total,
    hasMore: page * limit < total
  };
}

function buildTrashPaginatedPayload(items: TrashImage[], page: number, limit: number, total: number) {
  return {
    items,
    page,
    limit,
    total,
    hasMore: page * limit < total
  };
}

function sliceItemsForPage(items: FeedImage[], page: number, limit: number): FeedImage[] {
  const offset = (page - 1) * limit;
  return items.slice(offset, offset + limit);
}

function filterExcludedFeedItems(items: FeedImage[], excludedImageIds: Set<number>): FeedImage[] {
  if (excludedImageIds.size === 0) {
    return items;
  }

  return items.filter((item) => !excludedImageIds.has(item.id));
}

function limitHighlightItems(items: FeedImage[], minimumImageCount: number, excludedImageIds: Set<number>): FeedImage[] {
  const cappedItems = items.slice(0, HIGHLIGHT_CAPSULE_MAX_ITEMS);
  if (excludedImageIds.size === 0) {
    return cappedItems;
  }

  const filteredItems = filterExcludedFeedItems(items, excludedImageIds).slice(0, HIGHLIGHT_CAPSULE_MAX_ITEMS);
  return filteredItems.length >= minimumImageCount ? filteredItems : cappedItems;
}

function buildStaticCapsuleDefinition(
  capsule: Pick<FeedCapsuleDefinition, 'id' | 'title' | 'subtitle' | 'dateContext' | 'minimumImageCount'>,
  items: FeedImage[]
): FeedCapsuleDefinition {
  const cappedItems = items.slice(0, HIGHLIGHT_CAPSULE_MAX_ITEMS);

  return {
    ...capsule,
    count: () => cappedItems.length,
    list: (page, limit) => sliceItemsForPage(cappedItems, page, limit)
  };
}

function listDiversifiedModeItems(
  total: number,
  page: number,
  limit: number,
  loadBatch: (offset: number, limit: number) => FeedImage[]
): FeedImage[] {
  if (total === 0) {
    return [];
  }

  const targetCount = Math.min(total, page * limit);
  const candidateLimit = Math.min(total, Math.max(targetCount * 12, 720), MAX_DIVERSIFIED_CANDIDATES);
  const candidates: FeedImage[] = [];
  let offset = 0;

  while (offset < candidateLimit) {
    const batch = loadBatch(offset, Math.min(DIVERSIFIED_FETCH_BATCH_SIZE, candidateLimit - offset));
    if (batch.length === 0) {
      break;
    }

    candidates.push(...batch);
    offset += batch.length;

    if (countFeedBursts(candidates) >= targetCount || batch.length < DIVERSIFIED_FETCH_BATCH_SIZE) {
      break;
    }
  }

  const diversified = diversifyFeedCandidates(candidates);
  return diversified.slice((page - 1) * limit, page * limit);
}

function createDailySeed(now = new Date()): number {
  return Number(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`);
}

function getHighlightFeedOverlapImageIds(): Set<number> {
  const total = imageRepository.countFeed();
  const recentFeedItems = listDiversifiedModeItems(total, 1, HIGHLIGHT_FEED_OVERLAP_WINDOW, (offset, batchLimit) =>
    imageRepository.listRecentCandidates(offset, batchLimit)
  );

  return new Set(recentFeedItems.map((item) => item.id));
}

function getRecentBatchHighlightItems(excludedImageIds: Set<number>): FeedImage[] {
  const candidates = imageRepository.listRecentCandidates(0, HIGHLIGHT_BATCH_CANDIDATE_LIMIT);
  const bursts = groupFeedBursts(candidates)
    .filter((burst) => burst.items.length >= 2)
    .slice(0, HIGHLIGHT_BATCH_COUNT * 2);
  const filteredBursts = bursts
    .map((burst) => ({
      ...burst,
      items: filterExcludedFeedItems(burst.items, excludedImageIds)
    }))
    .filter((burst) => burst.items.length >= 2)
    .slice(0, HIGHLIGHT_BATCH_COUNT);

  if (filteredBursts.length > 0) {
    return filteredBursts.flatMap((burst) => burst.items).slice(0, HIGHLIGHT_CAPSULE_MAX_ITEMS);
  }

  return bursts
    .slice(0, HIGHLIGHT_BATCH_COUNT)
    .flatMap((burst) => burst.items)
    .slice(0, HIGHLIGHT_CAPSULE_MAX_ITEMS);
}

function buildMomentRailDefinition(now = new Date()): FeedRailDefinition {
  const currentYear = now.getFullYear();
  const onThisDayKeys = [buildMonthDayKey(now)];
  const weekKeys = listMonthDayKeysAroundDate(now, THIS_WEEK_RADIUS_DAYS, THIS_WEEK_RADIUS_DAYS);
  const lastYearReference = new Date(now);
  lastYearReference.setFullYear(lastYearReference.getFullYear() - 1);
  const lastYearStart = new Date(lastYearReference);
  lastYearStart.setDate(lastYearStart.getDate() - LAST_YEAR_RADIUS_DAYS);
  lastYearStart.setHours(0, 0, 0, 0);
  const lastYearEnd = new Date(lastYearReference);
  lastYearEnd.setDate(lastYearEnd.getDate() + LAST_YEAR_RADIUS_DAYS);
  lastYearEnd.setHours(23, 59, 59, 999);
  const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - THIS_WEEK_RADIUS_DAYS);
  const thisWeekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + THIS_WEEK_RADIUS_DAYS);

  return {
    kind: 'moments',
    title: 'Moments',
    description: 'Memory capsules shaped by real capture dates from your library.',
    singularLabel: 'Moment',
    capsules: [
      {
        id: 'on-this-day',
        title: 'On This Day',
        subtitle: `${formatMonthDay(now)} across previous years`,
        dateContext: formatMonthDay(now),
        minimumImageCount: 1,
        count: () => imageRepository.countByMonthDayKeys(onThisDayKeys, currentYear),
        list: (page, limit) => imageRepository.listByMonthDayKeys(onThisDayKeys, currentYear, page, limit)
      },
      {
        id: 'this-week-previous-years',
        title: 'This Week',
        subtitle: `${formatShortRange(thisWeekStart, thisWeekEnd)} from previous years`,
        dateContext: formatShortRange(thisWeekStart, thisWeekEnd),
        minimumImageCount: 2,
        count: () => imageRepository.countByMonthDayKeys(weekKeys, currentYear),
        list: (page, limit) => imageRepository.listByMonthDayKeys(weekKeys, currentYear, page, limit)
      },
      {
        id: 'from-last-year',
        title: 'Last Year Around Now',
        subtitle: `A revisit to ${formatMonthYear(lastYearReference)}`,
        dateContext: formatShortRange(lastYearStart, lastYearEnd),
        minimumImageCount: 1,
        count: () => imageRepository.countByEffectiveTimeRange(lastYearStart.getTime(), lastYearEnd.getTime()),
        list: (page, limit) => imageRepository.listByEffectiveTimeRange(lastYearStart.getTime(), lastYearEnd.getTime(), page, limit)
      }
    ]
  };
}

function buildHighlightRailDefinition(now = new Date()): FeedRailDefinition {
  const excludedImageIds = getHighlightFeedOverlapImageIds();
  const rediscoverCutoff = now.getTime() - REDISCOVER_MIN_AGE_MS;
  const dailySeed = createDailySeed(now);
  const highlightFetchLimit = HIGHLIGHT_CAPSULE_MAX_ITEMS + HIGHLIGHT_FEED_OVERLAP_WINDOW;
  const recentBatchItems = getRecentBatchHighlightItems(excludedImageIds);
  const forgottenFavoriteItems = limitHighlightItems(
    likeRepository.listLikedOlderThan(1, highlightFetchLimit, rediscoverCutoff),
    1,
    excludedImageIds
  );
  const deepCutItems = limitHighlightItems(
    listDiversifiedModeItems(imageRepository.countRediscover(rediscoverCutoff), 1, highlightFetchLimit, (offset, batchLimit) =>
      imageRepository.listRediscoverCandidates(offset, batchLimit, rediscoverCutoff)
    ),
    1,
    excludedImageIds
  );
  const luckyDipItems = limitHighlightItems(imageRepository.listRandom(1, highlightFetchLimit, dailySeed), 1, excludedImageIds);
  const recentBatchCount = groupFeedBursts(recentBatchItems).length;

  return {
    kind: 'highlights',
    title: 'Highlights',
    description: 'Curated sets from your library when capture dates are sparse or synthetic.',
    singularLabel: 'Highlight',
    capsules: [
      buildStaticCapsuleDefinition(
        {
          id: 'highlight-recent-batches',
          title: 'Recent Batches',
          subtitle: 'Latest runs gathered into one set',
          dateContext: `${recentBatchCount} batch${recentBatchCount === 1 ? '' : 'es'}`,
          minimumImageCount: 2
        },
        recentBatchItems
      ),
      buildStaticCapsuleDefinition(
        {
          id: 'highlight-forgotten-favorites',
          title: 'Forgotten Favorites',
          subtitle: 'Older liked posts worth another look',
          dateContext: 'Liked and older than 6 months',
          minimumImageCount: 1
        },
        forgottenFavoriteItems
      ),
      buildStaticCapsuleDefinition(
        {
          id: 'highlight-deep-cuts',
          title: 'Deep Cuts',
          subtitle: 'Older posts resurfaced from the archive',
          dateContext: 'Older than 6 months',
          minimumImageCount: 1
        },
        deepCutItems
      ),
      buildStaticCapsuleDefinition(
        {
          id: 'highlight-lucky-dip',
          title: 'Lucky Dip',
          subtitle: 'A playful mix from across the library',
          dateContext: 'Stable for today',
          minimumImageCount: 1
        },
        luckyDipItems
      )
    ]
  };
}

function materializeRailDefinition(definition: FeedRailDefinition) {
  const usedCoverImageIds = new Set<number>();
  const derivativeVersion = getDerivativeAssetVersion();

  return {
    ...definition,
    capsules: definition.capsules
      .map((capsule) => {
        const imageCount = capsule.count();
        if (imageCount < capsule.minimumImageCount) {
          return null;
        }

        const coverCandidates = capsule.list(1, RAIL_COVER_CANDIDATE_LIMIT);
        const coverImage = coverCandidates.find((image) => !usedCoverImageIds.has(image.id)) ?? coverCandidates[0];
        if (!coverImage) {
          return null;
        }

        usedCoverImageIds.add(coverImage.id);

        return {
          id: capsule.id,
          title: capsule.title,
          subtitle: capsule.subtitle,
          dateContext: capsule.dateContext,
          imageCount,
          coverImage: mapFeedImage(coverImage, derivativeVersion)
        };
      })
      .filter((capsule): capsule is NonNullable<typeof capsule> => capsule !== null)
  };
}

function getSelectedFeedRail(now = new Date()) {
  const totalImages = imageRepository.countFeed();
  const exifImages = imageRepository.countByTakenAtSource('exif');
  const preferMoments = shouldPreferMomentRail(totalImages, exifImages);
  const momentRail = materializeRailDefinition(buildMomentRailDefinition(now));
  const highlightRail = materializeRailDefinition(buildHighlightRailDefinition(now));

  if (preferMoments && momentRail.capsules.length > 0) {
    return momentRail;
  }

  if (highlightRail.capsules.length > 0) {
    return highlightRail;
  }

  return momentRail.capsules.length > 0 ? momentRail : highlightRail;
}

export const galleryService = {
  getFeed(page: number, limit: number, mode: FeedMode = 'random', randomSeed?: number) {
    if (!storageService.getState().libraryAvailable) {
      return {
        mode,
        items: [],
        page,
        limit,
        total: 0,
        hasMore: false
      };
    }

    if (mode === 'random') {
      const total = imageRepository.countFeed();
      const seed = Number.isFinite(randomSeed)
        ? Number(randomSeed)
        : Number(new Date().toISOString().slice(0, 10).replaceAll('-', ''));

      return {
        mode,
        ...buildPaginatedPayload(mapFeedItems(imageRepository.listRandom(page, limit, seed)), page, limit, total)
      };
    }

    if (mode === 'rediscover') {
      const cutoffTimestamp = Date.now() - REDISCOVER_MIN_AGE_MS;
      const total = imageRepository.countRediscover(cutoffTimestamp);
      const items = listDiversifiedModeItems(total, page, limit, (offset, batchLimit) =>
        imageRepository.listRediscoverCandidates(offset, batchLimit, cutoffTimestamp)
      );

      return {
        mode,
        ...buildPaginatedPayload(mapFeedItems(items), page, limit, total)
      };
    }

    const total = imageRepository.countFeed();
    const items = listDiversifiedModeItems(total, page, limit, (offset, batchLimit) =>
      imageRepository.listRecentCandidates(offset, batchLimit)
    );

    return {
      mode,
      ...buildPaginatedPayload(mapFeedItems(items), page, limit, total)
    };
  },

  searchMedia(query: string, page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return {
        items: [],
        page,
        limit,
        total: 0,
        hasMore: false
      };
    }

    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      return {
        items: [],
        page,
        limit,
        total: 0,
        hasMore: false
      };
    }

    const total = imageRepository.countVisibleSearch(normalizedQuery);
    const items = total > 0 ? imageRepository.listVisibleSearch(normalizedQuery, page, limit) : [];

    return buildPaginatedPayload(mapFeedItems(items), page, limit, total);
  },

  listMoments() {
    if (!storageService.getState().libraryAvailable) {
      return {
        railKind: 'moments' as FeedRailKind,
        railTitle: 'Moments',
        railDescription: 'Memory capsules shaped by real capture dates from your library.',
        railSingularLabel: 'Moment',
        items: []
      };
    }

    const rail = getSelectedFeedRail(new Date());
    return {
      railKind: rail.kind,
      railTitle: rail.title,
      railDescription: rail.description,
      railSingularLabel: rail.singularLabel,
      items: rail.capsules
    };
  },

  getMomentFeed(id: string, page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const now = new Date();
    const rail = getSelectedFeedRail(now);
    const capsule = rail.capsules.find((entry) => entry.id === id);

    if (!capsule) {
      return null;
    }

    const definition = (rail.kind === 'moments' ? buildMomentRailDefinition(now) : buildHighlightRailDefinition(now)).capsules.find(
      (entry) => entry.id === id
    );
    if (!definition) {
      return null;
    }

    const total = definition.count();

    return {
      railKind: rail.kind,
      railTitle: rail.title,
      railDescription: rail.description,
      railSingularLabel: rail.singularLabel,
      moment: capsule,
      ...buildPaginatedPayload(mapFeedItems(definition.list(page, limit)), page, limit, total)
    };
  },

  listFolders() {
    if (!storageService.getState().libraryAvailable) {
      return [];
    }

    return folderRepository.getAllSummaries().map(buildFolderSummary);
  },

  getFolderBySlug(slug: string) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    return buildFolderSummary(folder);
  },

  updateFolderMetadata(slug: string, name: string, description: string | null) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    folderRepository.updateMetadata(slug, name, description);
    const folder = folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    return buildFolderSummary(folder);
  },

  setFolderAvatar(slug: string, imageId: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = folderRepository.getBySlug(slug);
    if (!folder) {
      return null;
    }

    const image = imageRepository.getById(imageId);
    if (!image || image.folder_id !== folder.id || image.is_deleted !== 0 || image.is_trashed !== 0 || image.media_type !== 'image') {
      return null;
    }

    folderRepository.setAvatar(folder.id, imageId, 'manual');
    return true;
  },

  getFolderImages(slug: string, page: number, limit: number, mediaType?: MediaType) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    const total = mediaType ? imageRepository.countVisibleByFolder(folder.id, mediaType) : folder.image_count;
    const derivativeVersion = getDerivativeAssetVersion();

    return {
      folder: buildFolderSummary(folder),
      items: imageRepository.listFolderImages(folder.id, page, limit, mediaType).map((image) => mapFeedImage(image, derivativeVersion)),
      page,
      limit,
      total,
      hasMore: page * limit < total
    };
  },

  getImageDetail(id: number, mediaType?: MediaType) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    let detail = imageRepository.getImageDetail(id, mediaType);
    if (!detail) {
      const avatarDetail = imageRepository.getImageDetail(id, mediaType, true);
      if (avatarDetail && avatarDetail.folderAvatarImageId === avatarDetail.id) {
        detail = avatarDetail;
      }
    }

    if (!detail) {
      return null;
    }

    return mapImageDetail(detail, getDerivativeAssetVersion());
  },

  getTrashImages(page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return {
        items: [],
        page,
        limit,
        total: 0,
        hasMore: false
      };
    }

    const total = imageRepository.countTrashed();
    const derivativeVersion = getDerivativeAssetVersion();
    const items = imageRepository.listTrashed(page, limit).map((image) => mapTrashImage(image as IndexedTrashImage, derivativeVersion));

    return buildTrashPaginatedPayload(items, page, limit, total);
  },

  getLikes() {
    if (!storageService.getState().libraryAvailable) {
      return {
        items: []
      };
    }

    return {
      items: mapFeedItems(likeRepository.listLikedImages())
    };
  },

  likeImage(id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const image = imageRepository.getById(id);
    if (!image || image.is_deleted || image.is_trashed) {
      return null;
    }

    likeRepository.upsert(id);

    return {
      id,
      liked: true
    };
  },

  unlikeImage(id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const image = imageRepository.getById(id);
    if (!image || image.is_deleted || image.is_trashed) {
      return null;
    }

    likeRepository.remove(id);

    return {
      id,
      liked: false
    };
  },

  trashImage(id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const imageRecord = imageRepository.getById(id);
    if (!imageRecord || imageRecord.is_deleted) {
      return null;
    }

    const folder = folderRepository.getById(imageRecord.folder_id);
    if (!folder) {
      return null;
    }

    if (imageRecord.is_trashed === 0) {
      imageRepository.moveToTrash(id);
      folderRepository.syncAvatarSelection(imageRecord.folder_id);
    }

    return {
      id: imageRecord.id,
      folderSlug: folder.slug
    };
  },

  restoreImage(id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const imageRecord = imageRepository.getById(id);
    if (!imageRecord || imageRecord.is_deleted || imageRecord.is_trashed === 0) {
      return null;
    }

    const folder = folderRepository.getById(imageRecord.folder_id);
    if (!folder) {
      return null;
    }

    imageRepository.restoreFromTrash(id);
    folderRepository.syncAvatarSelection(imageRecord.folder_id);

    return {
      id: imageRecord.id,
      folderSlug: folder.slug
    };
  },

  getStatus() {
    const lastCompletedScan = scanRunRepository.latestCompleted() ?? null;
    const storageState = storageService.getState();
    const scanProgress = scannerService.getProgress();
    const rebuildRequired = appSettingsRepository.get(LIBRARY_REBUILD_REQUIRED_SETTING_KEY) === '1';
    const defaultHomeFeedMode = getDefaultHomeFeedMode();

    return {
      folders: storageState.libraryAvailable ? folderRepository.count() : 0,
      indexedImages: storageState.libraryAvailable ? imageRepository.countFeed() : 0,
      indexedVideos: storageState.libraryAvailable ? imageRepository.countByMediaType('video') : 0,
      scan: {
        ...scanProgress,
        currentFolder: null,
        lastCompletedScan: toViewerSafeScanSummary(lastCompletedScan)
      },
      storage: {
        available: storageState.libraryAvailable,
        reason: buildViewerSafeStorageReason(storageState.libraryAvailable)
      },
      libraryIndex: {
        rebuildRequired,
        reason: rebuildRequired ? 'gallery_root_changed' : null,
        ignoredRootMediaCount: storageState.libraryAvailable ? countSupportedRootMediaFiles(appConfig.galleryRoot) : 0
      },
      preferences: {
        defaultHomeFeedMode
      }
    };
  },

  getStats() {
    const lastCompletedScan = scanRunRepository.latestCompleted() ?? null;
    const storageState = storageService.getState();
    const scanProgress = scannerService.getProgress();
    const currentGalleryRoot = appConfig.galleryRoot;
    const previousGalleryRoot = appSettingsRepository.get(PREVIOUS_GALLERY_ROOT_SETTING_KEY);
    const rebuildRequired = appSettingsRepository.get(LIBRARY_REBUILD_REQUIRED_SETTING_KEY) === '1';
    const lastSuccessfulGalleryRoot = appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY);
    const defaultHomeFeedMode = getDefaultHomeFeedMode();

    return {
      folders: storageState.libraryAvailable ? folderRepository.count() : 0,
      indexedImages: storageState.libraryAvailable ? imageRepository.countFeed() : 0,
      indexedVideos: storageState.libraryAvailable ? imageRepository.countByMediaType('video') : 0,
      deletedImages: storageState.libraryAvailable ? imageRepository.countDeleted() : 0,
      thumbnailCount: storageState.libraryAvailable ? countDerivativeFilesOnDisk(appConfig.thumbnailsDir) : 0,
      previewCount: storageState.libraryAvailable ? countDerivativeFilesOnDisk(appConfig.previewsDir) : 0,
      lastScan: lastCompletedScan,
      scan: {
        ...scanProgress,
        lastCompletedScan
      },
      storage: {
        available: storageState.libraryAvailable,
        reason: storageState.reason,
        usingInMemoryDatabase: storageState.usingInMemoryDatabase
      },
      libraryIndex: {
        rebuildRequired,
        reason: rebuildRequired ? 'gallery_root_changed' : null,
        currentGalleryRoot,
        previousGalleryRoot,
        lastSuccessfulGalleryRoot,
        ignoredRootMediaCount: storageState.libraryAvailable ? countSupportedRootMediaFiles(currentGalleryRoot) : 0
      },
      preferences: {
        defaultHomeFeedMode
      }
    };
  },

  setDefaultHomeFeedMode(mode: FeedMode) {
    appSettingsRepository.set(HOME_FEED_DEFAULT_MODE_SETTING_KEY, mode);

    return {
      defaultMode: mode
    };
  },

  getOriginalImagePath(id: number): string | null {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const detail = imageRepository.getById(id);
    if (!detail || detail.is_deleted || detail.is_trashed) {
      return null;
    }

    const resolved = resolveWithinRoot(appConfig.galleryRoot, detail.absolute_path);
    if (!resolved || !fs.existsSync(resolved)) {
      return null;
    }

    return resolved;
  },

  async deleteImage(id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const imageRecord = imageRepository.getById(id);
    if (!imageRecord) {
      return null;
    }

    const folder = folderRepository.getById(imageRecord.folder_id);
    if (!folder) {
      return null;
    }

    const originalPath = resolveWithinRoot(appConfig.galleryRoot, imageRecord.absolute_path);
    const thumbnailPath = resolveWithinRoot(appConfig.thumbnailsDir, path.join(appConfig.thumbnailsDir, imageRecord.thumbnail_path));
    const previewPath = resolveWithinRoot(appConfig.previewsDir, path.join(appConfig.previewsDir, imageRecord.preview_path));

    if (!originalPath) {
      throw new Error('Stored image path is outside the gallery root');
    }

    if (!thumbnailPath && imageRecord.thumbnail_path) {
      throw new Error('Stored thumbnail path is outside the thumbnails root');
    }

    if (!previewPath && imageRecord.preview_path) {
      throw new Error('Stored preview path is outside the previews root');
    }

    await Promise.all([
      removeFileIfPresent(originalPath),
      removeFileIfPresent(thumbnailPath),
      removeFileIfPresent(previewPath)
    ]);

    if (folder.avatar_image_id === imageRecord.id) {
      folderRepository.setAvatar(imageRecord.folder_id, null, 'auto');
    }

    imageRepository.deleteById(imageRecord.id);
    folderRepository.syncAvatarSelection(imageRecord.folder_id);

    return {
      id: imageRecord.id,
      folderSlug: folder.slug
    };
  },

  async deleteFolder(slug: string, options: DeleteFolderOptions = {}) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    const deleteSourceFolder = options.deleteSourceFolder === true;
    const normalizedFolderPath = folder.folder_path;
    const images = imageRepository.listActiveByFolder(folder.id);

    if (deleteSourceFolder) {
      const affectedFolders = folderRepository
        .getAll()
        .filter((entry) => isSameOrDescendantFolderPath(normalizedFolderPath, entry.folder_path));
      const deletedImageCount = affectedFolders.reduce((total, entry) => total + imageRepository.listActiveByFolder(entry.id).length, 0);

      await Promise.all([
        removeDirectoryTree(resolveWithinRoot(appConfig.galleryRoot, path.join(appConfig.galleryRoot, normalizedFolderPath))),
        removeDirectoryTree(resolveWithinRoot(appConfig.thumbnailsDir, path.join(appConfig.thumbnailsDir, normalizedFolderPath))),
        removeDirectoryTree(resolveWithinRoot(appConfig.previewsDir, path.join(appConfig.previewsDir, normalizedFolderPath)))
      ]);

      folderScanStateRepository.deleteTree(normalizedFolderPath);

      for (const affectedFolder of affectedFolders) {
        folderRepository.setAvatar(affectedFolder.id, null, 'auto');
        folderRepository.delete(affectedFolder.id);
      }

      return {
        slug: folder.slug,
        deletedImageCount,
        deletedFolderCount: affectedFolders.length,
        deletedSourceFolder: true
      };
    }

    await Promise.all(
      images.map(async (imageRecord) => {
        const originalPath = resolveWithinRoot(appConfig.galleryRoot, imageRecord.absolute_path);
        const thumbnailPath = resolveWithinRoot(appConfig.thumbnailsDir, path.join(appConfig.thumbnailsDir, imageRecord.thumbnail_path));
        const previewPath = resolveWithinRoot(appConfig.previewsDir, path.join(appConfig.previewsDir, imageRecord.preview_path));

        if (!originalPath) {
          throw new Error('Stored image path is outside the gallery root');
        }

        if (!thumbnailPath && imageRecord.thumbnail_path) {
          throw new Error('Stored thumbnail path is outside the thumbnails root');
        }

        if (!previewPath && imageRecord.preview_path) {
          throw new Error('Stored preview path is outside the previews root');
        }

        await Promise.all([
          removeFileIfPresent(originalPath),
          removeFileIfPresent(thumbnailPath),
          removeFileIfPresent(previewPath)
        ]);
      })
    );

    folderRepository.setAvatar(folder.id, null, 'auto');
    folderScanStateRepository.delete(normalizedFolderPath);
    folderRepository.delete(folder.id);

    await Promise.all([
      removeDirectoryIfEmpty(resolveWithinRoot(appConfig.galleryRoot, path.join(appConfig.galleryRoot, normalizedFolderPath))),
      removeDirectoryIfEmpty(resolveWithinRoot(appConfig.thumbnailsDir, path.join(appConfig.thumbnailsDir, normalizedFolderPath))),
      removeDirectoryIfEmpty(resolveWithinRoot(appConfig.previewsDir, path.join(appConfig.previewsDir, normalizedFolderPath)))
    ]);

    return {
      slug: folder.slug,
      deletedImageCount: images.length,
      deletedFolderCount: 1,
      deletedSourceFolder: false
    };
  }
};
