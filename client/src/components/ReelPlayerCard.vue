<template>
  <article class="reel-player-card">
    <div class="reel-player-card__stage">
      <div
        class="reel-player-card__surface"
        :aria-label="active ? 'Toggle playback' : undefined"
        :role="active ? 'button' : undefined"
        :tabindex="active ? 0 : -1"
        @click="handleSurfaceClick"
        @keydown="handleSurfaceKeydown"
      >
        <media-player
          ref="playerElement"
          class="reel-player-card__player"
          :src.prop="videoSource"
          :title.prop="item.filename"
          :fullscreenOrientation.prop="'none'"
          :playsInline.prop="true"
          :muted.prop="appStore.videoMuted"
          :loop.prop="true"
          :load="playerLoadMode"
          preload="metadata"
        >
          <media-provider />
          <media-poster
            :src.prop="item.thumbnailUrl"
            :alt.prop="item.filename"
          />
        </media-player>

        <div
          v-if="showPausedIndicator"
          class="reel-player-card__pause-indicator"
          aria-hidden="true"
        >
          <span class="reel-player-card__pause-icon i-fluent-play-20-filled" />
        </div>

        <div class="reel-player-card__bottom-fade" aria-hidden="true" />

        <div
          class="reel-player-card__overlay"
          :class="{ 'reel-player-card__overlay--visible': active }"
        >
          <div class="reel-player-card__copy">
            <RouterLink
              class="reel-player-card__folder-row reel-player-card__folder-link"
              :to="{ name: 'folder', params: { slug: item.folderSlug } }"
              aria-label="Open folder"
              @click.stop
            >
              <Avatar
                class="reel-player-card__avatar"
                :name="folder?.name ?? item.folderName"
                :src="folder?.avatarUrl ?? null"
              />
              <div class="min-w-0">
                <strong class="reel-player-card__folder-name">
                  {{ folder?.name ?? item.folderName }}
                </strong>
                <p class="reel-player-card__folder-description">
                  {{ folderDescription }}
                </p>
              </div>
            </RouterLink>
          </div>

          <button
            class="reel-player-card__sound-button"
            type="button"
            :aria-label="appStore.videoMuted ? 'Enable sound' : 'Mute sound'"
            @click.stop="toggleSound"
          >
            <span
              class="reel-player-card__sound-icon"
              :class="
                appStore.videoMuted
                  ? 'i-fluent-speaker-mute-16-regular'
                  : 'i-fluent-speaker-2-16-regular'
              "
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import 'vidstack/bundle';

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import type { PlayerSrc } from 'vidstack';
import type { MediaPlayerElement } from 'vidstack/elements';

import { useAppStore } from '../stores/app';
import type { FeedItem, FolderSummary } from '../types/api';
import Avatar from './Avatar.vue';

const props = defineProps<{
  item: FeedItem;
  folder: FolderSummary | null;
  active: boolean;
}>();

const appStore = useAppStore();
const playerElement = ref<MediaPlayerElement | null>(null);
const isPaused = ref(false);
const isUsingOriginalFallback = ref(false);
const playerLoadMode = computed(() => (props.active ? 'eager' : 'visible'));
const currentVideoSrc = computed(() => (isUsingOriginalFallback.value ? `/api/originals/${props.item.id}` : props.item.previewUrl));
const videoSource = computed<PlayerSrc>(() => ({
  src: currentVideoSrc.value,
  type: 'video/mp4'
}));
const showPausedIndicator = computed(() => props.active && isPaused.value);
const folderDescription = computed(
  () => props.folder?.description?.trim() || props.folder?.breadcrumb || 'App Folder'
);

let muteSyncToken = 0;
let removePlayerEventListeners: (() => void) | null = null;
let autoplayRetryAttempts = 0;
let autoplayRetryTimer = 0;

const AUTOPLAY_RETRY_DELAY_MS = 140;
const MAX_AUTOPLAY_RETRIES = 3;

function clearAutoplayRetry() {
  if (autoplayRetryTimer !== 0) {
    window.clearTimeout(autoplayRetryTimer);
    autoplayRetryTimer = 0;
  }
}

function resetAutoplayRetry() {
  clearAutoplayRetry();
  autoplayRetryAttempts = 0;
}

function scheduleAutoplayRetry() {
  if (!props.active || autoplayRetryTimer !== 0 || autoplayRetryAttempts >= MAX_AUTOPLAY_RETRIES) {
    return;
  }

  autoplayRetryAttempts += 1;
  autoplayRetryTimer = window.setTimeout(() => {
    autoplayRetryTimer = 0;
    void syncPlayback();
  }, AUTOPLAY_RETRY_DELAY_MS * autoplayRetryAttempts);
}

function switchToOriginalFallback() {
  if (isUsingOriginalFallback.value) {
    return;
  }

  resetAutoplayRetry();
  isUsingOriginalFallback.value = true;
}

function syncMuted(player: MediaPlayerElement, muted: boolean) {
  const token = ++muteSyncToken;
  player.muted = muted;

  requestAnimationFrame(() => {
    if (muteSyncToken === token) {
      muteSyncToken = 0;
    }
  });
}

async function syncPlayback() {
  const player = playerElement.value;
  if (!player) {
    return;
  }

  if (!props.active) {
    resetAutoplayRetry();
    isPaused.value = false;
    void player.pause().catch(() => {
      // Ignore pause rejections before the provider is ready.
    });
    syncMuted(player, appStore.videoMuted);
    return;
  }

  syncMuted(player, appStore.videoMuted);

  try {
    await player.play();
    resetAutoplayRetry();
    isPaused.value = false;
    return;
  } catch {
    if (appStore.videoMuted) {
      if (!isUsingOriginalFallback.value && autoplayRetryAttempts >= MAX_AUTOPLAY_RETRIES) {
        switchToOriginalFallback();
        return;
      }

      scheduleAutoplayRetry();
      return;
    }
  }
}

function bindPlayerEventListeners(player: MediaPlayerElement | null) {
  removePlayerEventListeners?.();
  removePlayerEventListeners = null;

  if (!player) {
    return;
  }

  const handleReady = () => {
    void syncPlayback();
  };
  const handlePlay = () => {
    isPaused.value = false;
    if (!props.active) {
      void player.pause().catch(() => {
        // Ignore pause rejections before the provider is ready.
      });
    }
  };
  const handlePause = () => {
    isPaused.value = props.active;
  };

  player.addEventListener('loaded-metadata', handleReady);
  player.addEventListener('can-play', handleReady);
  player.addEventListener('play', handlePlay);
  player.addEventListener('pause', handlePause);

  removePlayerEventListeners = () => {
    player.removeEventListener('loaded-metadata', handleReady);
    player.removeEventListener('can-play', handleReady);
    player.removeEventListener('play', handlePlay);
    player.removeEventListener('pause', handlePause);
  };

  if (player.hasAttribute('data-can-play')) {
    void syncPlayback();
  }
}

async function toggleSound() {
  const nextMuted = !appStore.videoMuted;
  appStore.setVideoMuted(nextMuted);

  const player = playerElement.value;
  if (!player || !props.active) {
    return;
  }

  syncMuted(player, nextMuted);

  if (player.paused) {
    await syncPlayback();
  }
}

async function handleSurfaceClick() {
  const player = playerElement.value;
  if (!player || !props.active) {
    return;
  }

  if (player.paused) {
    await syncPlayback();
    return;
  }

  isPaused.value = true;
  void player.pause().catch(() => {
    // Ignore pause rejections before the provider is ready.
  });
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('a, button'));
}

function handleSurfaceKeydown(event: KeyboardEvent) {
  if (isInteractiveTarget(event.target)) {
    return;
  }

  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  void handleSurfaceClick();
}

watch(
  () => props.active,
  (active) => {
    if (active) {
      resetAutoplayRetry();
    }

    void syncPlayback();
  }
);

watch(
  () => props.item.id,
  () => {
    resetAutoplayRetry();
    isUsingOriginalFallback.value = false;
    isPaused.value = false;
  }
);

watch(
  () => appStore.videoMuted,
  (videoMuted) => {
    const player = playerElement.value;
    if (!player) {
      return;
    }

    syncMuted(player, videoMuted);
  }
);

watch(playerElement, (player) => {
  bindPlayerEventListeners(player);
});

watch(
  currentVideoSrc,
  () => {
    if (!props.active) {
      return;
    }

    void syncPlayback();
  }
);

onMounted(() => {
  void syncPlayback();
  if (props.active) {
    scheduleAutoplayRetry();
  }
});

onBeforeUnmount(() => {
  clearAutoplayRetry();
  removePlayerEventListeners?.();
  removePlayerEventListeners = null;
  void playerElement.value?.pause().catch(() => {
    // Ignore pause rejections before the provider is ready.
  });
});
</script>

<style scoped>
.reel-player-card {
  --reel-stage-gap: 1.25rem;
  --reel-stage-max-width: 24.4rem;
  --reel-stage-max-height: calc(var(--reel-stage-max-width) * 16 / 9);
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: calc(var(--reel-stage-gap) / 2) 0;
}

.reel-player-card__stage {
  position: relative;
  justify-self: center;
  align-self: center;
  width: auto;
  max-width: min(100%, var(--reel-stage-max-width));
  height: min(calc(100% - var(--reel-stage-gap)), var(--reel-stage-max-height));
  aspect-ratio: 9 / 16;
  overflow: hidden;
  border-radius: 1.15rem;
  background: #000;
  box-shadow: none;
}

.reel-player-card__surface {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.reel-player-card__player {
  display: block;
  width: 100%;
  height: 100%;
  color: #fff;
  background: #000;
}

.reel-player-card__player :deep(media-provider),
.reel-player-card__player :deep(media-poster),
.reel-player-card__player :deep(video),
.reel-player-card__player :deep(img) {
  display: block;
  width: 100%;
  height: 100%;
}

.reel-player-card__player :deep(video),
.reel-player-card__player :deep(img) {
  object-fit: contain;
  background: #000;
}

.reel-player-card__pause-indicator {
  position: absolute;
  inset: 50% auto auto 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 4.25rem;
  height: 4.25rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.48);
  color: #fff;
  pointer-events: none;
  transform: translate(-50%, -50%);
  z-index: 1;
}

.reel-player-card__pause-icon {
  width: 1.45rem;
  height: 1.45rem;
}

.reel-player-card__bottom-fade {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 38%;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.76) 100%);
  pointer-events: none;
}

.reel-player-card__overlay {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding: 0 1rem 1rem;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}

.reel-player-card__overlay--visible {
  opacity: 1;
  pointer-events: auto;
}

.reel-player-card__copy {
  min-width: 0;
  max-width: calc(100% - 3.3rem);
}

.reel-player-card__folder-row {
  display: flex;
  align-items: center;
  gap: 0.78rem;
  min-width: 0;
}

.reel-player-card__folder-link {
  color: inherit;
  text-decoration: none;
}

.reel-player-card__folder-link:hover .reel-player-card__folder-name,
.reel-player-card__folder-link:focus-visible .reel-player-card__folder-name {
  text-decoration: underline;
}

.reel-player-card__folder-link:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.72);
  outline-offset: 0.25rem;
  border-radius: 0.85rem;
}

.reel-player-card__avatar {
  width: 2.4rem;
  height: 2.4rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
}

.reel-player-card__folder-name {
  display: block;
  overflow: hidden;
  font-size: 0.96rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.98);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reel-player-card__folder-description {
  display: -webkit-box;
  margin: 0.18rem 0 0;
  overflow: hidden;
  font-size: 0.8rem;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.72);
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}

.reel-player-card__sound-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(230, 233, 239, 0.22);
  color: rgba(255, 255, 255, 0.96);
  cursor: pointer;
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    opacity 0.18s ease,
    transform 0.15s ease;
}

.reel-player-card__sound-button:hover {
  color: #fff;
  background: rgba(230, 233, 239, 0.3);
  opacity: 0.9;
  transform: translateY(-1px);
}

.reel-player-card__sound-icon {
  width: 1rem;
  height: 1rem;
}

@media (max-width: 768px) {
  .reel-player-card {
    --reel-stage-max-width: 22.2rem;
  }

  .reel-player-card__stage {
    border-radius: 1rem;
  }

  .reel-player-card__overlay {
    padding: 0 0.85rem 0.9rem;
  }

  .reel-player-card__pause-indicator {
    width: 3.9rem;
    height: 3.9rem;
  }

  .reel-player-card__copy {
    max-width: calc(100% - 3.2rem);
  }

  .reel-player-card__avatar {
    width: 2.15rem;
    height: 2.15rem;
  }

  .reel-player-card__sound-button {
    width: 1.9rem;
    height: 1.9rem;
  }
}
</style>
