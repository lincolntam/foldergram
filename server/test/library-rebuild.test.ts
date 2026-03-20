import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMediaTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('library rebuild reuses existing derivatives', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let scannerService: ScannerServiceModule['scannerService'];
  let imageRepository: RepositoriesModule['imageRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-library-rebuild-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    generateThumbnailDerivativeMock.mockReset();
    generateDerivativesMock.mockReset();
    readMediaMetadataMock.mockReset();

    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.resetModules();
    vi.doMock('../src/services/derivative-service.js', () => ({
      generateDerivatives: generateDerivativesMock,
      generateThumbnailDerivative: generateThumbnailDerivativeMock,
      readMediaMetadata: readMediaMetadataMock
    }));

    ({ appConfig } = await import('../src/config/env.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({ imageRepository } = await import('../src/db/repositories.js'));

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    readMediaMetadataMock.mockImplementation(async (sourcePath: string) => {
      const mediaType = getMediaTypeFromExtension(path.extname(sourcePath));
      return {
        width: mediaType === 'video' ? 1080 : 1600,
        height: mediaType === 'video' ? 1920 : 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 12_000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false
      };
    });

    generateDerivativesMock.mockImplementation(async (sourcePath: string, relativePath: string, force = false) => {
      const mediaType = getMediaTypeFromExtension(path.extname(relativePath));
      const thumbnailPath = getThumbnailRelativePath(relativePath);
      const previewPath = getPreviewRelativePath(relativePath, mediaType);
      const thumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, thumbnailPath);
      const previewAbsolutePath = path.join(appConfig.previewsDir, previewPath);
      const shouldWriteThumbnail = force || !(await pathExists(thumbnailAbsolutePath));
      const shouldWritePreview = force || !(await pathExists(previewAbsolutePath));

      if (shouldWriteThumbnail) {
        await fs.mkdir(path.dirname(thumbnailAbsolutePath), { recursive: true });
        await fs.writeFile(thumbnailAbsolutePath, `thumb:${relativePath}`);
      }

      if (shouldWritePreview) {
        await fs.mkdir(path.dirname(previewAbsolutePath), { recursive: true });
        await fs.writeFile(previewAbsolutePath, `preview:${relativePath}`);
      }

      return {
        width: mediaType === 'video' ? 1080 : 1600,
        height: mediaType === 'video' ? 1920 : 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 12_000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false,
        thumbnailPath,
        previewPath,
        generatedThumbnail: shouldWriteThumbnail,
        generatedPreview: shouldWritePreview
      };
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('keeps matching thumbnails/previews and only generates missing derivatives during a rebuild', async () => {
    await createSourceFile('summer/photo-1.jpg');
    await createSourceFile('summer/clip-1.mp4');

    const existingThumbnailPath = path.join(appConfig.thumbnailsDir, getThumbnailRelativePath('summer/photo-1.jpg'));
    const existingPreviewPath = path.join(appConfig.previewsDir, getPreviewRelativePath('summer/photo-1.jpg', 'image'));
    await fs.mkdir(path.dirname(existingThumbnailPath), { recursive: true });
    await fs.mkdir(path.dirname(existingPreviewPath), { recursive: true });
    await fs.writeFile(existingThumbnailPath, 'existing-thumb:summer/photo-1.jpg');
    await fs.writeFile(existingPreviewPath, 'existing-preview:summer/photo-1.jpg');

    const lastScan = await scannerService.rebuildLibraryIndex();

    expect(lastScan?.status).toBe('completed');
    expect(lastScan?.scanned_files).toBe(2);
    expect(imageRepository.countFeed()).toBe(2);

    expect(generateDerivativesMock).toHaveBeenCalledTimes(2);
    for (const [, , force] of generateDerivativesMock.mock.calls) {
      expect(force).toBe(false);
    }

    await expect(fs.readFile(existingThumbnailPath, 'utf8')).resolves.toBe('existing-thumb:summer/photo-1.jpg');
    await expect(fs.readFile(existingPreviewPath, 'utf8')).resolves.toBe('existing-preview:summer/photo-1.jpg');

    const generatedVideoThumbnailPath = path.join(appConfig.thumbnailsDir, getThumbnailRelativePath('summer/clip-1.mp4'));
    const generatedVideoPreviewPath = path.join(appConfig.previewsDir, getPreviewRelativePath('summer/clip-1.mp4', 'video'));
    await expect(fs.readFile(generatedVideoThumbnailPath, 'utf8')).resolves.toBe('thumb:summer/clip-1.mp4');
    await expect(fs.readFile(generatedVideoPreviewPath, 'utf8')).resolves.toBe('preview:summer/clip-1.mp4');
  });

  async function createSourceFile(relativePath: string): Promise<void> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `source:${relativePath}`);
  }
});

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
