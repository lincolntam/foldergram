import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchImage } from '../api/gallery';
import type { FeedItem, FolderSummary, ImageDetail } from '../types/api';
import ReelInfoSidebar from './ReelInfoSidebar.vue';

vi.mock('../api/gallery', () => ({
  fetchImage: vi.fn()
}));

function createFeedItem(id: number): FeedItem {
  return {
    id,
    folderId: 7,
    folderSlug: 'animal-planet',
    folderName: 'Animal Planet',
    folderPath: 'animals/big-cats',
    folderBreadcrumb: 'Animals / Big Cats',
    filename: `snow-leopard-${id}.mp4`,
    width: 1080,
    height: 1920,
    mediaType: 'video',
    durationMs: 21_000,
    thumbnailUrl: `/thumbs/${id}.webp`,
    previewUrl: `/previews/${id}.mp4`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id
  };
}

function createFolder(): FolderSummary {
  return {
    id: 7,
    slug: 'animal-planet',
    name: 'Animal Planet',
    description: 'Wildlife clips from the archive.',
    folderPath: 'animals/big-cats',
    breadcrumb: 'Animals / Big Cats',
    imageCount: 0,
    videoCount: 3,
    latestImageMtimeMs: null,
    avatarImageId: null,
    avatarUrl: null
  };
}

function createImageDetail(id: number): ImageDetail {
  return {
    ...createFeedItem(id),
    folderAvatarImageId: null,
    relativePath: `animals/big-cats/snow-leopard-${id}.mp4`,
    mimeType: 'video/mp4',
    fileSize: 24 * 1024 * 1024,
    exif: null,
    originalUrl: `/api/originals/${id}`,
    playbackStrategy: 'preview',
    nextImageId: null,
    previousImageId: null
  };
}

describe('ReelInfoSidebar', () => {
  const fetchImageMock = vi.mocked(fetchImage);

  beforeEach(() => {
    fetchImageMock.mockReset();
  });

  it('loads reel details only when the sidebar is open', async () => {
    fetchImageMock.mockResolvedValue(createImageDetail(11));

    const wrapper = mount(ReelInfoSidebar, {
      props: {
        item: createFeedItem(11),
        folder: createFolder(),
        open: false
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          RouterLink: {
            template: '<a><slot /></a>'
          }
        }
      }
    });

    await flushPromises();
    expect(fetchImageMock).not.toHaveBeenCalled();

    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(fetchImageMock).toHaveBeenCalledWith(11, 'video');
    expect(wrapper.text()).toContain('MP4');
    expect(wrapper.text()).toContain('24.00 MB');
    expect(wrapper.text()).toContain('animals/big-cats');
    expect(wrapper.text()).toContain('video/mp4');
  });

  it('reuses cached details when reopening the same reel', async () => {
    fetchImageMock.mockResolvedValue(createImageDetail(14));

    const wrapper = mount(ReelInfoSidebar, {
      props: {
        item: createFeedItem(14),
        folder: createFolder(),
        open: true
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          RouterLink: {
            template: '<a><slot /></a>'
          }
        }
      }
    });

    await flushPromises();
    expect(fetchImageMock).toHaveBeenCalledTimes(1);

    await wrapper.setProps({ open: false });
    await flushPromises();
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(fetchImageMock).toHaveBeenCalledTimes(1);
  });
});
