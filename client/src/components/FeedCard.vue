<template>
  <article class="bg-transparent">
    <div class="flex items-center justify-between gap-4 px-4 py-[0.55rem]">
      <RouterLink class="feed-card__folder flex items-center gap-[0.72rem] min-w-0" :to="{ name: 'folder', params: { slug: item.folderSlug } }">
        <Avatar class="w-8 h-8" :name="item.folderName" :src="avatarUrl" />
        <div class="min-w-0">
          <h3 class="m-0 text-[0.88rem] font-semibold truncate">
            {{ item.folderName }}
          </h3>
        </div>
      </RouterLink>
      <button
        class="inline-flex items-center justify-center w-8 h-8 p-0 border-0 text-muted bg-transparent cursor-pointer"
        type="button"
        aria-label="More options"
        @click="menuOpen = true"
      >
        <svg class="w-[1.15rem] h-[1.15rem]" viewBox="0 0 24 24" role="presentation">
          <circle cx="6.5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="17.5" cy="12" r="1.5" fill="currentColor" />
        </svg>
      </button>
    </div>

    <RouterLink v-if="!isHomeContext" custom :to="imageRoute" v-slot="{ href, navigate }">
      <a
        :href="href"
        class="relative block overflow-hidden rounded-[0.5rem] border border-border bg-surface-alt"
        :style="{ aspectRatio: mediaAspectRatio }"
        @click="handleImageNavigation($event, navigate)"
      >
        <ResilientImage
          :src="item.thumbnailUrl"
          :alt="item.filename"
          loading="lazy"
          :retry-while="appStore.isScanning"
          class="h-full w-full object-cover"
        />
        <div
          v-if="item.mediaType === 'video'"
          class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-4 py-3 text-white pointer-events-none bg-[linear-gradient(180deg,rgba(10,14,24,0)_0%,rgba(10,14,24,0.82)_100%)]"
        >
          <span class="i-fluent-play-circle-24-filled w-[1.15rem] h-[1.15rem] text-white" aria-hidden="true" />
          <span v-if="item.durationMs" class="rounded-full bg-black/55 px-[0.55rem] py-[0.18rem] text-[0.76rem] font-semibold">
            {{ formattedDuration }}
          </span>
        </div>
      </a>
    </RouterLink>

    <div
      v-else-if="item.mediaType === 'image'"
      class="relative block overflow-hidden rounded-[0.5rem] border border-border bg-surface-alt select-none"
      :style="{ aspectRatio: mediaAspectRatio, touchAction: 'manipulation' }"
      @click="handleHomeImageClick"
    >
      <ResilientImage
        :src="homeImageSrc"
        :alt="item.filename"
        loading="lazy"
        :retry-while="appStore.isScanning"
        class="h-full w-full object-cover"
      />
    </div>

    <div
      v-else
      ref="homeVideoTarget"
      class="relative block overflow-hidden rounded-[0.5rem] border border-border bg-surface-alt"
      :style="{ aspectRatio: mediaAspectRatio }"
    >
      <video
        ref="homeVideoElement"
        class="block h-full w-full bg-black object-cover"
        :src="item.previewUrl"
        :poster="item.thumbnailUrl"
        :controls="isActiveVideo"
        loop
        playsinline
        preload="metadata"
        @loadedmetadata="syncHomeVideoPlayback"
        @play="handleHomeVideoPlay"
        @volumechange="handleHomeVideoVolumeChange"
      />
      <div
        class="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-4 py-3 text-white pointer-events-none bg-[linear-gradient(180deg,rgba(10,14,24,0.82)_0%,rgba(10,14,24,0)_100%)]"
      >
        <span class="i-fluent-play-circle-24-filled w-[1.15rem] h-[1.15rem] text-white" aria-hidden="true" />
        <span v-if="item.durationMs" class="rounded-full bg-black/55 px-[0.55rem] py-[0.18rem] text-[0.76rem] font-semibold">
          {{ formattedDuration }}
        </span>
      </div>
    </div>

    <div class="grid gap-[0.6rem] px-4 pt-[0.7rem] pb-[0.15rem]">
      <div class="flex items-center justify-between gap-[0.65rem]">
        <div class="flex items-center gap-[0.65rem]">
          <button
            v-if="authStore.canUseSavedItems"
            class="inline-flex items-center justify-center w-8 h-8 border-0 bg-transparent cursor-pointer transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px disabled:opacity-50 disabled:cursor-wait disabled:transform-none"
            :class="{ 'text-[#e5484d]': likesStore.isLiked(item.id) }"
            type="button"
            :aria-label="likesStore.toggleAriaLabel(likesStore.isLiked(item.id))"
            :aria-pressed="likesStore.isLiked(item.id)"
            :disabled="likesStore.isPending(item.id)"
            @click="handleLike"
          >
            <span
              class="w-[1.45rem] h-[1.45rem]"
              :class="likesStore.isLiked(item.id) ? 'i-fluent-heart-16-filled' : 'i-fluent-heart-16-regular'"
              aria-hidden="true"
            />
          </button>
          <RouterLink custom :to="imageRoute" v-slot="{ href, navigate }">
            <a
              :href="href"
              class="inline-flex items-center justify-center w-8 h-8 border-0 bg-transparent cursor-pointer color-inherit transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px"
              :aria-label="item.mediaType === 'video' ? 'Open reel' : 'Open post'"
              @click="handleImageNavigation($event, navigate)"
            >
              <svg class="w-[1.45rem] h-[1.45rem]" viewBox="0 0 24 24" role="presentation">
                <path
                  d="M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17.5zm2.5 8 2.5-3 2.5 2.5 2-2 2.5 3"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                />
                <circle cx="15.25" cy="8.75" r="1.25" fill="currentColor" />
              </svg>
            </a>
          </RouterLink>
          <RouterLink
            class="inline-flex items-center justify-center w-8 h-8 border-0 bg-transparent cursor-pointer color-inherit transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px"
            :to="{ name: 'folder', params: { slug: item.folderSlug } }"
            aria-label="Open folder"
          >
            <span class="i-fluent-folder-16-regular w-[1.30rem] h-[1.30rem]" aria-hidden="true" />
          </RouterLink>
        </div>
        <a
          class="inline-flex items-center justify-center w-8 h-8 border-0 bg-transparent cursor-pointer color-inherit transition-[opacity,transform] duration-180 hover:opacity-72 hover:-translate-y-px"
          :href="item.previewUrl"
          target="_blank"
          rel="noreferrer"
          aria-label="Open preview"
        >
          <svg class="w-[1.45rem] h-[1.45rem]" viewBox="0 0 24 24" role="presentation">
            <path
              d="M14 5h5v5m0-5-7.5 7.5M10 7H7.5A2.5 2.5 0 0 0 5 9.5v7A2.5 2.5 0 0 0 7.5 19h7a2.5 2.5 0 0 0 2.5-2.5V14"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
        </a>
      </div>

      <p class="m-0 text-[0.88rem]">
        <strong class="mr-[0.35rem]">{{ item.folderName }}</strong>
        {{ caption }}
      </p>
      <p class="m-0 text-muted text-[0.72rem] uppercase tracking-[0.05em]">
        {{ formattedDate }}
      </p>
    </div>

    <div v-if="menuOpen" class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/48" @click.self="menuOpen = false">
      <div class="w-[min(100%,22rem)] overflow-hidden bg-surface border border-border rounded-[1rem] shadow-[var(--shadow)]">
        <button
          class="flex items-center gap-[0.8rem] w-full px-4 py-[0.95rem] border-0 border-b border-border text-text bg-transparent cursor-pointer text-left"
          type="button"
          @click="openOriginal"
        >
          <svg class="w-[1.15rem] h-[1.15rem] shrink-0" viewBox="0 0 24 24" role="presentation">
            <path
              d="M14 5h5v5m0-5-7.5 7.5M10 7H7.5A2.5 2.5 0 0 0 5 9.5v7A2.5 2.5 0 0 0 7.5 19h7a2.5 2.5 0 0 0 2.5-2.5V14"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
          <span>Open original</span>
        </button>
        <button
          v-if="authStore.canDeleteMedia"
          class="flex items-center gap-[0.8rem] w-full px-4 py-[0.95rem] border-0 border-b border-border text-[#d93025] bg-transparent cursor-pointer text-left disabled:opacity-70 disabled:cursor-wait"
          type="button"
          :disabled="deleting"
          @click="handleDelete"
        >
          <svg class="w-[1.15rem] h-[1.15rem] shrink-0" viewBox="0 0 24 24" role="presentation">
            <path
              d="M9 4.75h6m-8 3h10m-8.5 0v10a1.25 1.25 0 0 0 1.25 1.25h4.5A1.25 1.25 0 0 0 15.5 17.75v-10m-4 3v5m4-5v5"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
          <span>{{ deleting ? 'Deleting...' : 'Delete post' }}</span>
        </button>
        <button
          class="flex items-center gap-[0.8rem] w-full px-4 py-[0.95rem] border-0 text-text bg-transparent cursor-pointer text-left"
          type="button"
          @click="menuOpen = false"
        >
          <svg class="w-[1.15rem] h-[1.15rem] shrink-0" viewBox="0 0 24 24" role="presentation">
            <path
              d="m7 7 10 10M17 7 7 17"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
          <span>Cancel</span>
        </button>
      </div>
    </div>

    <ConfirmDialog
      v-if="confirmDeleteOpen"
      title="Delete this post?"
      :message="deleteDialogMessage"
      :confirm-label="deleteDialogConfirmLabel"
      :loading="deleting"
      @cancel="confirmDeleteOpen = false"
      @confirm="confirmDelete"
    >
      <template #details>
        <label class="flex items-start gap-3 mt-3 cursor-pointer select-none">
          <input
            v-model="deleteOriginalFromDisk"
            class="mt-[0.2rem]"
            type="checkbox"
            :disabled="deleting"
          />
          <span class="grid gap-[0.18rem]">
            <span class="text-[0.92rem] font-semibold text-text">Also permanently delete original file from disk</span>
            <span class="text-[0.84rem] text-muted">Keep this unchecked to move the post to Trash while keeping the source file on disk.</span>
          </span>
        </label>
        <p
          v-if="deleteOriginalFromDisk"
          class="m-0 mt-3 px-3 py-[0.8rem] rounded-[0.9rem] border border-[rgba(217,48,37,0.24)] text-[0.84rem] text-[#b42318] bg-[rgba(217,48,37,0.08)]"
        >
          This will permanently delete the original file, thumbnail, and preview from disk. This action cannot be undone.
        </p>
        <p
          v-if="deleteError"
          class="m-0 mt-3 px-3 py-[0.8rem] rounded-[0.9rem] border border-[rgba(217,48,37,0.24)] text-[0.84rem] text-[#b42318] bg-[rgba(217,48,37,0.08)]"
        >
          {{ deleteError }}
        </p>
      </template>
    </ConfirmDialog>
  </article>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

import { deleteImage, trashImage } from '../api/gallery';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useFeedStore } from '../stores/feed';
import { useFoldersStore } from '../stores/folders';
import { useLikesStore } from '../stores/likes';
import { useMomentsStore } from '../stores/moments';
import type { FeedItem } from '../types/api';
import { formatMediaDuration } from '../utils/media';
import { resolveFeedAspectRatio } from '../utils/media-layout';
import Avatar from './Avatar.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import ResilientImage from './ResilientImage.vue';

interface HomeVideoVisibilityChange {
  id: number;
  ratio: number;
  centerOffset: number;
}

const HOME_IMAGE_DOUBLE_TAP_WINDOW_MS = 320;
const HOME_VIDEO_OBSERVER_THRESHOLDS = [0, 0.2, 0.4, 0.6, 0.8, 1];

const props = withDefaults(
  defineProps<{
    item: FeedItem;
    avatarUrl: string | null;
    context?: 'default' | 'home';
    isActiveVideo?: boolean;
  }>(),
  {
    context: 'default',
    isActiveVideo: false
  }
);

const emit = defineEmits<{
  videoVisibilityChange: [payload: HomeVideoVisibilityChange];
}>();

const appStore = useAppStore();
const authStore = useAuthStore();
const feedStore = useFeedStore();
const likesStore = useLikesStore();
const foldersStore = useFoldersStore();
const momentsStore = useMomentsStore();
const route = useRoute();
const menuOpen = ref(false);
const deleting = ref(false);
const confirmDeleteOpen = ref(false);
const deleteOriginalFromDisk = ref(false);
const deleteError = ref<string | null>(null);
const homeVideoTarget = ref<HTMLElement | null>(null);
const homeVideoElement = ref<HTMLVideoElement | null>(null);
const lastHomeImageTapAt = ref(0);

let homeImageTapResetTimer: ReturnType<typeof setTimeout> | null = null;
let homeVideoObserver: IntersectionObserver | null = null;
let homeVideoMuteSyncToken = 0;

const imageRoute = computed(() => `/image/${props.item.id}`);
const isHomeContext = computed(() => props.context === 'home');
const shouldOpenPostInModal = computed(() => props.context !== 'home');
const caption = computed(() =>
  props.item.filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);
const formattedDate = computed(() =>
  new Date(props.item.takenAt ?? props.item.sortTimestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
);
const formattedDuration = computed(() => formatMediaDuration(props.item.durationMs));
const mediaAspectRatio = computed(() => resolveFeedAspectRatio(props.item.width, props.item.height));
const homeImageSrc = computed(() => (props.item.isAnimated ? props.item.previewUrl : props.item.thumbnailUrl));
const deleteDialogMessage = computed(() =>
  deleteOriginalFromDisk.value
    ? 'This will permanently delete the post from the app and remove original media from disk.'
    : 'This will delete the post from the app and move it to Trash. The original file will stay on disk unless you choose permanent deletion.'
);
const deleteDialogConfirmLabel = computed(() => (deleteOriginalFromDisk.value ? 'Permanently Delete' : 'Delete'));

function isPrimaryPlainClick(event: MouseEvent) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function clearHomeImageTapResetTimer() {
  if (homeImageTapResetTimer) {
    clearTimeout(homeImageTapResetTimer);
    homeImageTapResetTimer = null;
  }
}

function queueHomeImageTapReset() {
  clearHomeImageTapResetTimer();
  homeImageTapResetTimer = setTimeout(() => {
    lastHomeImageTapAt.value = 0;
    homeImageTapResetTimer = null;
  }, HOME_IMAGE_DOUBLE_TAP_WINDOW_MS);
}

async function likeFromMedia() {
  if (!authStore.canUseSavedItems || likesStore.isLiked(props.item.id) || likesStore.isPending(props.item.id)) {
    return;
  }

  await likesStore.toggleLike(props.item);
}

function handleImageNavigation(event: MouseEvent, navigate: () => void) {
  if (!isPrimaryPlainClick(event)) {
    return;
  }

  event.preventDefault();

  if (shouldOpenPostInModal.value) {
    appStore.setImageModalBackground(route.fullPath);
  }

  navigate();
}

function handleHomeImageClick(event: MouseEvent) {
  if (!isHomeContext.value || props.item.mediaType !== 'image' || !isPrimaryPlainClick(event)) {
    return;
  }

  const now = Date.now();
  if (lastHomeImageTapAt.value > 0 && now - lastHomeImageTapAt.value <= HOME_IMAGE_DOUBLE_TAP_WINDOW_MS) {
    lastHomeImageTapAt.value = 0;
    clearHomeImageTapResetTimer();
    void likeFromMedia();
    return;
  }

  lastHomeImageTapAt.value = now;
  queueHomeImageTapReset();
}

function emitHomeVideoVisibility(ratio: number, centerOffset = Number.POSITIVE_INFINITY) {
  if (!isHomeContext.value || props.item.mediaType !== 'video') {
    return;
  }

  emit('videoVisibilityChange', {
    id: props.item.id,
    ratio,
    centerOffset
  });
}

function stopHomeVideoObserver() {
  if (homeVideoObserver) {
    homeVideoObserver.disconnect();
    homeVideoObserver = null;
  }

  emitHomeVideoVisibility(0);
}

function startHomeVideoObserver() {
  if (!isHomeContext.value || props.item.mediaType !== 'video' || !homeVideoTarget.value || homeVideoObserver) {
    return;
  }

  homeVideoObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const centerOffset = Math.abs(entry.boundingClientRect.top + entry.boundingClientRect.height / 2 - window.innerHeight / 2);
      emitHomeVideoVisibility(entry.isIntersecting ? entry.intersectionRatio : 0, centerOffset);
    },
    {
      threshold: HOME_VIDEO_OBSERVER_THRESHOLDS
    }
  );

  homeVideoObserver.observe(homeVideoTarget.value);
}

function syncHomeVideoMuted(video: HTMLVideoElement, muted: boolean) {
  const token = ++homeVideoMuteSyncToken;
  video.muted = muted;

  requestAnimationFrame(() => {
    if (homeVideoMuteSyncToken === token) {
      homeVideoMuteSyncToken = 0;
    }
  });
}

async function syncHomeVideoPlayback() {
  if (!isHomeContext.value || props.item.mediaType !== 'video') {
    return;
  }

  const video = homeVideoElement.value;
  if (!video) {
    return;
  }

  if (!props.isActiveVideo) {
    video.pause();
    syncHomeVideoMuted(video, appStore.videoMuted);
    return;
  }

  syncHomeVideoMuted(video, appStore.videoMuted);

  try {
    await video.play();
    return;
  } catch {
    if (appStore.videoMuted) {
      // Ignore autoplay rejections and leave manual controls available when focused.
      return;
    }
  }

  syncHomeVideoMuted(video, true);

  try {
    await video.play();
  } catch {
    // Ignore autoplay rejections and leave manual controls available when focused.
  }
}

function handleHomeVideoPlay() {
  if (!props.isActiveVideo) {
    homeVideoElement.value?.pause();
  }
}

function handleHomeVideoVolumeChange() {
  const video = homeVideoElement.value;
  if (!video || homeVideoMuteSyncToken !== 0) {
    return;
  }

  if (video.muted !== appStore.videoMuted) {
    appStore.setVideoMuted(video.muted);
  }
}

function openOriginal() {
  menuOpen.value = false;
  window.open(`/api/originals/${props.item.id}`, '_blank', 'noopener,noreferrer');
}

function handleDelete() {
  if (!authStore.canDeleteMedia) {
    return;
  }

  menuOpen.value = false;
  deleteOriginalFromDisk.value = false;
  deleteError.value = null;
  confirmDeleteOpen.value = true;
}

async function handleLike() {
  if (!authStore.canUseSavedItems) {
    return;
  }

  await likesStore.toggleLike(props.item);
}

async function confirmDelete() {
  if (!authStore.canDeleteMedia) {
    return;
  }

  deleting.value = true;
  deleteError.value = null;

  try {
    const deleted = deleteOriginalFromDisk.value ? await deleteImage(props.item.id) : await trashImage(props.item.id);
    feedStore.removeImage(deleted.id);
    likesStore.removeImage(deleted.id);
    const removedFolder = foldersStore.removeImage(deleted.id, deleted.folderSlug, props.item.mediaType);
    momentsStore.removeImage(deleted.id);
    appStore.removeIndexedImage(removedFolder ? 1 : 0, props.item.mediaType);
    confirmDeleteOpen.value = false;
    deleteOriginalFromDisk.value = false;
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : 'Unable to delete post';
  } finally {
    deleting.value = false;
  }
}

watch(
  () => homeVideoTarget.value,
  () => {
    stopHomeVideoObserver();
    startHomeVideoObserver();
  }
);

watch(
  () => props.isActiveVideo,
  () => {
    void syncHomeVideoPlayback();
  }
);

watch(
  () => appStore.videoMuted,
  (videoMuted) => {
    const video = homeVideoElement.value;
    if (!video) {
      return;
    }

    syncHomeVideoMuted(video, videoMuted);
  }
);

watch(
  () => props.context,
  (context) => {
    if (context === 'home' && props.item.mediaType === 'video') {
      startHomeVideoObserver();
      void syncHomeVideoPlayback();
      return;
    }

    stopHomeVideoObserver();
    homeVideoElement.value?.pause();
  }
);

onMounted(() => {
  startHomeVideoObserver();
  void syncHomeVideoPlayback();
});

onBeforeUnmount(() => {
  clearHomeImageTapResetTimer();
  stopHomeVideoObserver();
  homeVideoElement.value?.pause();
});
</script>
