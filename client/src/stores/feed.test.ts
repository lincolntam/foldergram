import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as galleryApi from '../api/gallery';
import type { FeedItem } from '../types/api';
import { useFeedStore } from './feed';

function createFeedItem(id: number): FeedItem {
  return {
    id,
    folderId: 1,
    folderSlug: 'alpha',
    folderName: 'Alpha',
    folderPath: 'albums/alpha',
    folderBreadcrumb: null,
    filename: `image-${id}.jpg`,
    width: 1200,
    height: 1500,
    mediaType: 'image',
    durationMs: null,
    thumbnailUrl: `/thumbnails/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    sortTimestamp: 1_778_400_000_000 + id,
    takenAt: 1_778_400_000_000 + id
  };
}

describe('feed store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('loads the recent feed without a random seed', async () => {
    const fetchFeedSpy = vi.spyOn(galleryApi, 'fetchFeed').mockResolvedValue({
      mode: 'recent',
      items: [createFeedItem(7)],
      page: 1,
      limit: 18,
      total: 1,
      hasMore: false
    });

    const feedStore = useFeedStore();
    feedStore.initializeMode('recent');
    await feedStore.loadInitial();

    expect(feedStore.mode).toBe('recent');
    expect(fetchFeedSpy).toHaveBeenCalledWith(1, 18, 'recent', undefined);
    expect(feedStore.loadedMode).toBe('recent');
    expect(feedStore.items.map((item) => item.id)).toEqual([7]);
  });

  it('reloads initialized items when the active mode changed since the last fetch', async () => {
    const fetchFeedSpy = vi.spyOn(galleryApi, 'fetchFeed').mockResolvedValue({
      mode: 'recent',
      items: [createFeedItem(21)],
      page: 1,
      limit: 18,
      total: 1,
      hasMore: false
    });

    const feedStore = useFeedStore();
    feedStore.$patch({
      mode: 'random',
      loadedMode: 'random',
      items: [createFeedItem(5)],
      page: 2,
      hasMore: true,
      initialized: true,
      randomSeed: 12345
    });

    feedStore.initializeMode('recent');
    await feedStore.loadInitial();

    expect(fetchFeedSpy).toHaveBeenCalledWith(1, 18, 'recent', undefined);
    expect(feedStore.loadedMode).toBe('recent');
    expect(feedStore.items.map((item) => item.id)).toEqual([21]);
  });
});
