import { defineStore } from 'pinia';

import { fetchLikes, likeImage, unlikeImage } from '../api/gallery';
import type { FeedItem, LikesMode } from '../types/api';
import { useAuthStore } from './auth';

interface LikesState {
  mode: LikesMode;
  items: FeedItem[];
  likedIds: number[];
  pendingIds: number[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
}

const LOCAL_FAVORITES_STORAGE_KEY = 'foldergram-local-favorites';

function isFeedItem(value: unknown): value is FeedItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<FeedItem>;
  return (
    typeof item.id === 'number' &&
    typeof item.folderId === 'number' &&
    typeof item.folderSlug === 'string' &&
    typeof item.folderName === 'string' &&
    typeof item.folderPath === 'string' &&
    (item.folderBreadcrumb === null || item.folderBreadcrumb === undefined || typeof item.folderBreadcrumb === 'string') &&
    typeof item.filename === 'string' &&
    typeof item.width === 'number' &&
    typeof item.height === 'number' &&
    (item.mediaType === 'image' || item.mediaType === 'video') &&
    (item.durationMs === null || item.durationMs === undefined || typeof item.durationMs === 'number') &&
    (item.isAnimated === null || item.isAnimated === undefined || typeof item.isAnimated === 'boolean') &&
    typeof item.thumbnailUrl === 'string' &&
    typeof item.previewUrl === 'string' &&
    typeof item.sortTimestamp === 'number' &&
    (item.takenAt === null || item.takenAt === undefined || typeof item.takenAt === 'number')
  );
}

function readLocalFavorites(): FeedItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const rawValue = window.localStorage.getItem(LOCAL_FAVORITES_STORAGE_KEY);
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seenIds = new Set<number>();
    return parsed.filter((entry): entry is FeedItem => {
      if (!isFeedItem(entry) || seenIds.has(entry.id)) {
        return false;
      }

      seenIds.add(entry.id);
      return true;
    });
  } catch {
    return [];
  }
}

function writeLocalFavorites(items: FeedItem[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(LOCAL_FAVORITES_STORAGE_KEY, JSON.stringify(items));
}

export const useLikesStore = defineStore('likes', {
  state: (): LikesState => ({
    mode: 'shared',
    items: [],
    likedIds: [],
    pendingIds: [],
    loading: false,
    error: null,
    initialized: false
  }),
  getters: {
    isLiked: (state) => (id: number) => state.likedIds.includes(id),
    isPending: (state) => (id: number) => state.pendingIds.includes(id),
    collectionLabel: (state) => (state.mode === 'local' ? 'Favorites' : 'Likes'),
    collectionSectionLabel: (state) => (state.mode === 'local' ? 'Favorite posts' : 'Liked posts'),
    emptyTitle: (state) => (state.mode === 'local' ? 'No favorites yet' : 'No liked posts yet'),
    emptyDescription: (state) =>
      state.mode === 'local'
        ? 'Tap the heart under any post and it will appear here in this browser.'
        : 'Tap the heart under any post and it will appear here.',
    loadingLabel: (state) => (state.mode === 'local' ? 'Loading favorites...' : 'Loading likes...'),
    errorTitle: (state) => (state.mode === 'local' ? 'Could not load favorites' : 'Could not load likes'),
    toggleAriaLabel: (state) => (liked: boolean) =>
      state.mode === 'local' ? (liked ? 'Remove favorite from post' : 'Favorite post') : liked ? 'Unlike post' : 'Like post'
  },
  actions: {
    syncFromItems(items: FeedItem[], mode: LikesMode) {
      this.mode = mode;
      this.items = items;
      this.likedIds = items.map((item) => item.id);
    },

    resetForRebuild() {
      const authStore = useAuthStore();

      this.mode = authStore.likesMode;
      this.items = [];
      this.likedIds = [];
      this.pendingIds = [];
      this.loading = false;
      this.error = null;
      this.initialized = false;
    },

    async initialize(force = false) {
      const authStore = useAuthStore();
      if (!authStore.canUseSavedItems) {
        this.resetForRebuild();
        return;
      }

      if ((this.initialized && this.mode === authStore.likesMode && !force) || this.loading) {
        return;
      }

      this.loading = true;
      this.error = null;

      try {
        if (authStore.likesMode === 'shared') {
          const payload = await fetchLikes();
          this.syncFromItems(payload.items, 'shared');
        } else {
          this.syncFromItems(readLocalFavorites(), 'local');
        }

        this.initialized = true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : `Unable to load ${this.mode === 'local' ? 'favorites' : 'likes'}`;
      } finally {
        this.loading = false;
      }
    },

    async toggleLike(item: FeedItem) {
      const authStore = useAuthStore();
      if (!authStore.canUseSavedItems || this.pendingIds.includes(item.id)) {
        return;
      }

      const mode = authStore.likesMode;
      const wasLiked = this.likedIds.includes(item.id);
      this.mode = mode;
      this.pendingIds.push(item.id);
      this.error = null;

      if (wasLiked) {
        this.likedIds = this.likedIds.filter((id) => id !== item.id);
        this.items = this.items.filter((entry) => entry.id !== item.id);
      } else {
        this.likedIds = [item.id, ...this.likedIds.filter((id) => id !== item.id)];
        this.items = [item, ...this.items.filter((entry) => entry.id !== item.id)];
      }

      try {
        if (mode === 'local') {
          writeLocalFavorites(this.items);
          this.initialized = true;
        } else if (wasLiked) {
          await unlikeImage(item.id);
        } else {
          await likeImage(item.id);
        }
      } catch (error) {
        if (wasLiked) {
          this.likedIds = [item.id, ...this.likedIds.filter((id) => id !== item.id)];
          this.items = [item, ...this.items.filter((entry) => entry.id !== item.id)];
        } else {
          this.likedIds = this.likedIds.filter((id) => id !== item.id);
          this.items = this.items.filter((entry) => entry.id !== item.id);
        }

        this.error = error instanceof Error ? error.message : `Unable to update ${mode === 'local' ? 'favorites' : 'likes'}`;
      } finally {
        if (mode === 'local') {
          writeLocalFavorites(this.items);
        }

        this.pendingIds = this.pendingIds.filter((id) => id !== item.id);
      }
    },

    removeImage(id: number) {
      this.likedIds = this.likedIds.filter((entry) => entry !== id);
      this.items = this.items.filter((entry) => entry.id !== id);
      this.pendingIds = this.pendingIds.filter((entry) => entry !== id);

      if (this.mode === 'local') {
        writeLocalFavorites(this.items);
      }
    },

    removeFolderItems(folderSlug: string) {
      const removedIds = new Set(this.items.filter((item) => item.folderSlug === folderSlug).map((item) => item.id));
      this.items = this.items.filter((item) => item.folderSlug !== folderSlug);
      this.likedIds = this.likedIds.filter((id) => !removedIds.has(id));
      this.pendingIds = this.pendingIds.filter((id) => !removedIds.has(id));

      if (this.mode === 'local') {
        writeLocalFavorites(this.items);
      }
    }
  }
});
