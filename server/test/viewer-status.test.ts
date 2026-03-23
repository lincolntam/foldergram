import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type AppConfigModule = typeof import('../src/config/env.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type StorageServiceModule = typeof import('../src/services/storage-service.js');
type AppSettingKeysModule = typeof import('../src/constants/app-setting-keys.js');

describe.sequential('viewer-safe status payload', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];
  let scanRunRepository: RepositoriesModule['scanRunRepository'];
  let storageService: StorageServiceModule['storageService'];
  let HOME_FEED_DEFAULT_MODE_SETTING_KEY: AppSettingKeysModule['HOME_FEED_DEFAULT_MODE_SETTING_KEY'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-viewer-status-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ maintenanceRepository, appSettingsRepository, scanRunRepository } = await import('../src/db/repositories.js'));
    ({ storageService } = await import('../src/services/storage-service.js'));
    ({ HOME_FEED_DEFAULT_MODE_SETTING_KEY } = await import('../src/constants/app-setting-keys.js'));
  });

  beforeEach(async () => {
    maintenanceRepository.resetLibraryIndex();
    appSettingsRepository.remove(HOME_FEED_DEFAULT_MODE_SETTING_KEY);
    await Promise.all([
      fs.rm(appConfig.galleryRoot, { recursive: true, force: true }),
      fs.rm(appConfig.thumbnailsDir, { recursive: true, force: true }),
      fs.rm(appConfig.previewsDir, { recursive: true, force: true })
    ]);
    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('redacts admin-only scan and gallery-root details', () => {
    const completedRunId = scanRunRepository.start();
    scanRunRepository.finish(completedRunId, {
      finished_at: '2026-03-20T00:00:00.000Z',
      status: 'completed_with_errors',
      scanned_files: 4,
      new_files: 1,
      updated_files: 2,
      removed_files: 1,
      error_text: '/private/gallery/trips/broken.jpg'
    });

    const status = galleryService.getStatus();

    expect(status.scan.lastCompletedScan).toMatchObject({
      id: completedRunId,
      status: 'completed_with_errors',
      error_text: null
    });
    expect(status.scan.currentFolder).toBeNull();
    expect(status).not.toHaveProperty('lastScan');
    expect(status.storage).not.toHaveProperty('usingInMemoryDatabase');
    expect(status.libraryIndex).not.toHaveProperty('currentGalleryRoot');
    expect(status.libraryIndex).not.toHaveProperty('previousGalleryRoot');
    expect(status.libraryIndex).not.toHaveProperty('lastSuccessfulGalleryRoot');
  });

  it('replaces storage failure details with a generic viewer-safe message', () => {
    const storageStateSpy = vi.spyOn(storageService, 'getState').mockReturnValue({
      libraryAvailable: false,
      reason: 'Gallery directory unavailable at /private/gallery: ENOENT',
      usingInMemoryDatabase: true,
      databasePath: ':memory:'
    });

    const status = galleryService.getStatus();

    expect(status.storage).toEqual({
      available: false,
      reason: 'Configured library storage is unavailable.'
    });
    expect(status.folders).toBe(0);
    expect(status.indexedImages).toBe(0);
    expect(status.indexedVideos).toBe(0);

    storageStateSpy.mockRestore();
  });

  it('uses random as the viewer-safe home-feed default when nothing is configured', () => {
    const status = galleryService.getStatus();

    expect(status.preferences).toEqual({
      defaultHomeFeedMode: 'random'
    });
  });

  it('includes the configured home-feed default in the viewer-safe status payload', () => {
    appSettingsRepository.set(HOME_FEED_DEFAULT_MODE_SETTING_KEY, 'rediscover');

    const status = galleryService.getStatus();

    expect(status.preferences).toEqual({
      defaultHomeFeedMode: 'rediscover'
    });
  });
});
