import { defineStore } from 'pinia';

import { fetchStats } from '../api/gallery';
import type { AppStatus } from '../types/api';

interface AppState {
  stats: AppStatus | null;
  loadingStats: boolean;
  error: string | null;
  theme: 'light' | 'dark';
  videoMuted: boolean;
  lastOpenedFolderSlug: string | null;
  recentOpenedFolderSlugs: string[];
  imageModalBackgroundPath: string | null;
  statsPollFailures: number;
  statsPollTimer: ReturnType<typeof setInterval> | null;
}

const THEME_STORAGE_KEY = 'foldergram-theme';
const VIDEO_MUTED_STORAGE_KEY = 'foldergram-video-muted';
const LAST_OPENED_FOLDER_STORAGE_KEY = 'foldergram-last-opened-folder';
const RECENT_OPENED_FOLDERS_STORAGE_KEY = 'foldergram-recent-opened-folders';
const RECENT_OPENED_FOLDERS_LIMIT = 24;

function parseStoredRecentFolderSlugs(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry, index, items) => entry.length > 0 && items.indexOf(entry) === index)
      .slice(0, RECENT_OPENED_FOLDERS_LIMIT);
  } catch {
    return [];
  }
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    stats: null,
    loadingStats: false,
    error: null,
    theme: 'light',
    videoMuted: true,
    lastOpenedFolderSlug: null,
    recentOpenedFolderSlugs: [],
    imageModalBackgroundPath: null,
    statsPollFailures: 0,
    statsPollTimer: null
  }),
  getters: {
    isLibraryUnavailable: (state) => state.stats?.storage.available === false,
    libraryUnavailableReason: (state) => state.stats?.storage.reason ?? 'Configured library storage is unavailable.',
    isLibraryRebuildRequired: (state) => state.stats?.libraryIndex.rebuildRequired === true,
    isScanning: (state) => state.stats?.scan.isScanning === true,
    isRebuilding: (state) => state.stats?.scan.isScanning === true && state.stats?.scan.scanReason === 'rebuild',
    hasCompletedScan: (state) => state.stats?.scan.lastCompletedScan !== null,
    isInitialScan: (state) => state.stats?.scan.isScanning === true && state.stats?.scan.lastCompletedScan === null
  },
  actions: {
    persistOpenedFolderState() {
      if (this.lastOpenedFolderSlug) {
        window.localStorage.setItem(LAST_OPENED_FOLDER_STORAGE_KEY, this.lastOpenedFolderSlug);
      } else {
        window.localStorage.removeItem(LAST_OPENED_FOLDER_STORAGE_KEY);
      }

      window.localStorage.setItem(
        RECENT_OPENED_FOLDERS_STORAGE_KEY,
        JSON.stringify(this.recentOpenedFolderSlugs.slice(0, RECENT_OPENED_FOLDERS_LIMIT))
      );
    },

    initializeTheme() {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      const preferredTheme =
        savedTheme === 'light' || savedTheme === 'dark'
          ? savedTheme
          : window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';

      this.setTheme(preferredTheme);
    },

    initializeLastOpenedFolder() {
      const savedSlug = window.localStorage.getItem(LAST_OPENED_FOLDER_STORAGE_KEY);
      this.lastOpenedFolderSlug = savedSlug && savedSlug.length > 0 ? savedSlug : null;

      const savedRecentSlugs = parseStoredRecentFolderSlugs(window.localStorage.getItem(RECENT_OPENED_FOLDERS_STORAGE_KEY));
      this.recentOpenedFolderSlugs = this.lastOpenedFolderSlug
        ? [this.lastOpenedFolderSlug, ...savedRecentSlugs.filter((slug) => slug !== this.lastOpenedFolderSlug)]
        : savedRecentSlugs;

      this.persistOpenedFolderState();
    },

    setTheme(theme: 'light' | 'dark') {
      this.theme = theme;
      document.documentElement.dataset.theme = theme;
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    },

    toggleTheme() {
      this.setTheme(this.theme === 'light' ? 'dark' : 'light');
    },

    initializeVideoMuted() {
      const savedPreference = window.localStorage.getItem(VIDEO_MUTED_STORAGE_KEY);
      this.videoMuted = savedPreference === 'false' ? false : true;
    },

    setVideoMuted(videoMuted: boolean) {
      this.videoMuted = videoMuted;
      window.localStorage.setItem(VIDEO_MUTED_STORAGE_KEY, String(videoMuted));
    },

    recordOpenedFolder(slug: string) {
      this.lastOpenedFolderSlug = slug;
      this.recentOpenedFolderSlugs = [slug, ...this.recentOpenedFolderSlugs.filter((entry) => entry !== slug)].slice(
        0,
        RECENT_OPENED_FOLDERS_LIMIT
      );
      this.persistOpenedFolderState();
    },

    setImageModalBackground(path: string) {
      this.imageModalBackgroundPath = path;
    },

    clearImageModalBackground() {
      this.imageModalBackgroundPath = null;
    },

    markLibraryRebuildStarted() {
      if (!this.stats) {
        return;
      }

      this.error = null;
      this.stats = {
        ...this.stats,
        folders: 0,
        indexedImages: 0,
        indexedVideos: 0,
        scan: {
          ...this.stats.scan,
          isScanning: true,
          scanReason: 'rebuild',
          phase: 'discovery',
          startedAt: new Date().toISOString(),
          runId: null,
          discoveredFolders: 0,
          processedFolders: 0,
          discoveredImages: 0,
          processedImages: 0,
          queuedDerivativeJobs: 0,
          processedDerivativeJobs: 0,
          generatedThumbnails: 0,
          generatedPreviews: 0,
          currentFolder: null
        }
      };
      this.startStatsPolling();
    },

    markScanStatusUnavailable() {
      if (!this.stats) {
        return;
      }

      this.stats = {
        ...this.stats,
        scan: {
          ...this.stats.scan,
          isScanning: false,
          scanReason: null,
          phase: 'idle',
          startedAt: null,
          runId: null,
          currentFolder: null
        }
      };
    },

    startStatsPolling() {
      if (this.statsPollTimer) {
        return;
      }

      this.statsPollTimer = setInterval(() => {
        if (document.visibilityState === 'hidden') {
          return;
        }

        if (!this.stats?.scan.isScanning) {
          this.stopStatsPolling();
          return;
        }

        void this.fetchStats({ background: true });
      }, 2500);
    },

    stopStatsPolling() {
      if (this.statsPollTimer) {
        clearInterval(this.statsPollTimer);
        this.statsPollTimer = null;
      }

      this.statsPollFailures = 0;
    },

    resetProtectedState() {
      this.stopStatsPolling();
      this.stats = null;
      this.loadingStats = false;
      this.error = null;
      this.imageModalBackgroundPath = null;
    },

    removeIndexedImage(removedFolderCount = 0, mediaType: 'image' | 'video' = 'image') {
      if (!this.stats) {
        return;
      }

      this.stats.folders = Math.max(0, this.stats.folders - removedFolderCount);
      this.stats.indexedImages = Math.max(0, this.stats.indexedImages - 1);
      if (mediaType === 'video') {
        this.stats.indexedVideos = Math.max(0, this.stats.indexedVideos - 1);
      }
    },

    removeFolder(deletedImageCount: number) {
      if (!this.stats) {
        return;
      }

      this.stats.folders = Math.max(0, this.stats.folders - 1);
      this.stats.indexedImages = Math.max(0, this.stats.indexedImages - deletedImageCount);
    },

    async fetchStats(options: { background?: boolean } = {}) {
      if (!options.background) {
        this.loadingStats = true;
        this.error = null;
      }

      try {
        this.stats = await fetchStats();
        this.statsPollFailures = 0;

        if (options.background && this.error) {
          this.error = null;
        }

        if (this.stats.scan.isScanning) {
          this.startStatsPolling();
        } else {
          this.stopStatsPolling();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load app stats';

        if (options.background) {
          this.statsPollFailures += 1;

          if (this.statsPollFailures >= 3) {
            this.stopStatsPolling();
            this.markScanStatusUnavailable();
            this.error = 'Lost connection while refreshing scan status.';
          }
        } else {
          this.error = message;
        }
      } finally {
        if (!options.background) {
          this.loadingStats = false;
        }
      }
    }
  }
});
