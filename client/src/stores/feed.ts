import { defineStore } from 'pinia';

import { fetchFeed } from '../api/gallery';
import type { FeedItem, FeedMode } from '../types/api';

interface FeedState {
  mode: FeedMode;
  loadedMode: FeedMode | null;
  items: FeedItem[];
  page: number;
  limit: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  initialized: boolean;
  randomSeed: number | null;
}

function createRandomSeed(): number {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    return cryptoObject.getRandomValues(new Uint32Array(1))[0] ?? Math.floor(Math.random() * 2_147_483_647);
  }

  return Math.floor(Math.random() * 2_147_483_647);
}

export const useFeedStore = defineStore('feed', {
  state: (): FeedState => ({
    mode: 'random',
    loadedMode: null,
    items: [],
    page: 1,
    limit: 18,
    hasMore: true,
    loading: false,
    error: null,
    initialized: false,
    randomSeed: null
  }),
  actions: {
    initializeMode(mode: FeedMode = 'random') {
      this.mode = mode;

      if (mode !== 'random') {
        this.randomSeed = null;
      }
    },

    ensureRandomSeed() {
      if (this.randomSeed !== null) {
        return this.randomSeed;
      }

      this.randomSeed = createRandomSeed();
      return this.randomSeed;
    },

    async setMode(mode: FeedMode) {
      if (this.mode === mode && this.initialized && mode !== 'random') {
        return;
      }

      this.mode = mode;
      this.randomSeed = mode === 'random' ? createRandomSeed() : null;
      await this.loadInitial(true);
    },

    removeImage(id: number) {
      this.items = this.items.filter((item) => item.id !== id);
    },

    removeFolderItems(folderSlug: string) {
      this.items = this.items.filter((item) => item.folderSlug !== folderSlug);
    },

    resetForRebuild() {
      this.loadedMode = null;
      this.items = [];
      this.page = 1;
      this.hasMore = true;
      this.loading = false;
      this.error = null;
      this.initialized = false;
    },

    async loadInitial(force = false) {
      if (this.loading) {
        return;
      }

      const queueRequiresSeed = this.mode === 'random';
      const queueMatchesMode = this.loadedMode === this.mode && (!queueRequiresSeed || this.randomSeed !== null);

      if (this.initialized && !force && queueMatchesMode) {
        return;
      }

      this.items = [];
      this.loadedMode = null;
      this.page = 1;
      this.hasMore = true;
      this.initialized = false;
      await this.loadMore();
    },

    async loadMore() {
      if (this.loading || !this.hasMore) {
        return;
      }

      this.loading = true;
      this.error = null;

      try {
        const seed = this.mode === 'random' ? this.ensureRandomSeed() : undefined;
        const payload = await fetchFeed(this.page, this.limit, this.mode, seed);
        this.items.push(...payload.items);
        this.loadedMode = payload.mode ?? this.mode;
        this.page += 1;
        this.hasMore = payload.hasMore;
        this.initialized = true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to load feed';
      } finally {
        this.loading = false;
      }
    }
  }
});
