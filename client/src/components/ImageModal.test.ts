import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedItem, ImageDetail } from '../types/api';
import { useAppStore } from '../stores/app';
import { useLikesStore } from '../stores/likes';
import ImageModal from './ImageModal.vue';

const mockRouterResolve = vi.fn();

vi.mock('vidstack/bundle', () => ({}));
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');

  return {
    ...actual,
    useRoute: () => ({
      query: {}
    }),
    useRouter: () => ({
      push: vi.fn(),
      resolve: mockRouterResolve
    })
  };
});

function createFeedItem(id: number): FeedItem {
  return {
    id,
    folderId: 7,
    folderSlug: 'animal-planet',
    folderName: 'AnimalPlanet',
    folderPath: 'animal-planet',
    folderBreadcrumb: null,
    filename: `post-${id}.jpg`,
    width: 1200,
    height: 1500,
    mediaType: 'image',
    durationMs: null,
    isAnimated: false,
    thumbnailUrl: `/thumbnails/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id
  };
}

function createImageDetail(id: number, options: { previousImageId: number | null; nextImageId: number | null }): ImageDetail {
  const item = createFeedItem(id);

  return {
    ...item,
    folderAvatarImageId: null,
    relativePath: `${item.folderSlug}/${item.filename}`,
    mimeType: 'image/jpeg',
    fileSize: 123_456,
    exif: null,
    originalUrl: `/api/originals/${id}`,
    playbackStrategy: null,
    previousImageId: options.previousImageId,
    nextImageId: options.nextImageId
  };
}

const globalStubs = {
  Avatar: {
    template: '<div data-test="avatar" />'
  },
  ResilientImage: {
    template: '<img data-test="resilient-image" />'
  },
  RouterLink: {
    inheritAttrs: false,
    props: ['to'],
    template: '<a v-bind="$attrs" :data-to="JSON.stringify(to)"><slot /></a>'
  }
};

describe('ImageModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockRouterResolve.mockReset();
    mockRouterResolve.mockImplementation((path: string) => ({
      name: path === '/likes/posts' ? 'likes' : 'folder'
    }));
  });

  it('uses likes-page neighbors instead of folder neighbors when opened from likes', () => {
    const appStore = useAppStore();
    const likesStore = useLikesStore();

    appStore.setImageModalBackground('/likes/posts');
    likesStore.syncFromItems([createFeedItem(11), createFeedItem(12), createFeedItem(13)], 'shared');

    const wrapper = mount(ImageModal, {
      props: {
        image: createImageDetail(12, {
          previousImageId: null,
          nextImageId: 99
        }),
        isModal: true
      },
      global: {
        stubs: globalStubs
      }
    });

    expect(wrapper.get('a[aria-label="Previous post"]').attributes('data-to')).toContain('"id":"11"');
    expect(wrapper.get('a[aria-label="Next post"]').attributes('data-to')).toContain('"id":"13"');
  });
});
