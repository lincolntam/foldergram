<template>
  <section class="reels-view">
    <section v-if="appStore.isLibraryUnavailable" class="reels-view__message-card">
      <p class="reels-view__eyebrow">Reels</p>
      <h1 class="reels-view__title">Library storage unavailable</h1>
      <p class="reels-view__message">{{ appStore.libraryUnavailableReason }}</p>
    </section>

    <section v-else-if="reelsStore.error" class="reels-view__message-card">
      <p class="reels-view__eyebrow">Reels</p>
      <h1 class="reels-view__title">Could not load reels</h1>
      <p class="reels-view__message">{{ reelsStore.error }}</p>
    </section>

    <section v-else-if="showLoadingState" class="reels-view__message-card">
      <p class="reels-view__eyebrow">Reels</p>
      <h1 class="reels-view__title">Loading reels</h1>
      <p class="reels-view__message">Pulling together a video-only queue from your indexed library.</p>
    </section>

    <section v-else-if="reelsStore.initialized && reelsStore.items.length === 0" class="reels-view__message-card">
      <p class="reels-view__eyebrow">Reels</p>
      <h1 class="reels-view__title">No reels available</h1>
      <p class="reels-view__message">Add indexed videos to your library and they will show up here after the next scan.</p>
    </section>

    <div v-else class="reels-view__layout">
      <div class="reels-view__deck-shell">
        <ReelDeck
          ref="deckElement"
          :items="reelsStore.items"
          :folders="foldersStore.items"
          :active-reel-id="reelsStore.activeReelId"
          :loading="reelsStore.loading"
          @active-change="handleActiveChange"
          @prefetch="handlePrefetch"
        />
      </div>

      <ReelActionRail
        v-if="activeItem"
        class="reels-view__action-rail hidden md:grid"
        :item="activeItem"
        :info-open="isInfoSidebarOpen"
        @toggle-info="handleInfoToggle"
      >
        <template #info-panel>
          <Transition name="reels-info-popup">
            <div v-if="isInfoSidebarOpen" data-test="info-shell" class="reels-view__info-shell">
              <ReelInfoSidebar
                :item="activeItem"
                :folder="activeFolder"
                :open="isInfoSidebarOpen"
                @close="closeInfoSidebar"
              />
            </div>
          </Transition>
        </template>
      </ReelActionRail>

      <div class="reels-view__nav-controls hidden md:grid" aria-label="Reel navigation">
        <button
          class="reels-view__nav-button"
          type="button"
          aria-label="Previous reel"
          :disabled="!canGoPrevious"
          @click="goToPrevious"
        >
          <svg class="reels-view__nav-icon" viewBox="0 0 24 24" role="presentation">
            <path
              d="m6.75 14.75 5.25-5.25 5.25 5.25"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.9"
            />
          </svg>
        </button>
        <button
          class="reels-view__nav-button"
          type="button"
          aria-label="Next reel"
          :disabled="!canGoNext"
          @click="goToNext"
        >
          <svg class="reels-view__nav-icon" viewBox="0 0 24 24" role="presentation">
            <path
              d="m6.75 9.25 5.25 5.25 5.25-5.25"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.9"
            />
          </svg>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import ReelActionRail from '../components/ReelActionRail.vue';
import ReelDeck from '../components/ReelDeck.vue';
import ReelInfoSidebar from '../components/ReelInfoSidebar.vue';
import { useAppStore } from '../stores/app';
import { useFoldersStore } from '../stores/folders';
import { useReelsStore } from '../stores/reels';

const appStore = useAppStore();
const foldersStore = useFoldersStore();
const reelsStore = useReelsStore();
const deckElement = ref<InstanceType<typeof ReelDeck> | null>(null);
const isInfoSidebarOpen = ref(false);

const activeItem = computed(() => reelsStore.activeItem);
const activeFolder = computed(() =>
  activeItem.value ? foldersStore.items.find((folder) => folder.slug === activeItem.value?.folderSlug) ?? null : null
);
const activeIndex = computed(() => reelsStore.items.findIndex((item) => item.id === reelsStore.activeReelId));
const canGoPrevious = computed(() => activeIndex.value > 0);
const canGoNext = computed(() => activeIndex.value >= 0 && activeIndex.value < reelsStore.items.length - 1);
const showLoadingState = computed(() => reelsStore.loading && !reelsStore.initialized);

function handleActiveChange(id: number) {
  reelsStore.setActiveReel(id);
}

async function handlePrefetch(activeIndex: number) {
  await reelsStore.prefetchIfNeeded(activeIndex);
}

function goToPrevious() {
  deckElement.value?.goToPrevious();
}

function goToNext() {
  deckElement.value?.goToNext();
}

function handleInfoToggle() {
  isInfoSidebarOpen.value = !isInfoSidebarOpen.value;
}

function closeInfoSidebar() {
  isInfoSidebarOpen.value = false;
}

function shouldCaptureGlobalWheel(event: WheelEvent) {
  if (event.defaultPrevented || Math.abs(event.deltaY) < 0.5) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return true;
  }

  if (target.closest('.sidebar')) {
    return false;
  }

  if (target.closest('input, textarea, select, [contenteditable="true"]')) {
    return false;
  }

  return true;
}

function handleGlobalWheel(event: WheelEvent) {
  if (!deckElement.value || !shouldCaptureGlobalWheel(event)) {
    return;
  }

  event.preventDefault();
  deckElement.value?.navigateByWheel(event.deltaY);
}

onMounted(async () => {
  window.addEventListener('wheel', handleGlobalWheel, { passive: false });
  await reelsStore.loadInitial();
});

onBeforeUnmount(() => {
  window.removeEventListener('wheel', handleGlobalWheel);
});

watch(activeItem, (item) => {
  if (!item) {
    isInfoSidebarOpen.value = false;
  }
});
</script>

<style scoped>
.reels-view {
  height: 100%;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
}

.reels-view__layout {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 24.4rem) 3.4rem;
  justify-content: center;
  align-items: stretch;
  column-gap: 1rem;
  height: 100%;
  min-height: 100%;
  width: 100%;
  padding: 0 1.25rem;
}

.reels-view__deck-shell {
  height: 100%;
  min-height: 0;
}

.reels-view__action-rail {
  align-self: end;
  margin-bottom: 4.8rem;
}

.reels-view__info-shell {
  display: block;
}

.reels-view__nav-controls {
  position: fixed;
  top: 50%;
  right: max(1rem, env(safe-area-inset-right));
  z-index: 12;
  gap: 0.9rem;
  transform: translateY(-50%);
}

.reels-view__nav-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.35rem;
  height: 3.35rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 78%, var(--text) 22%);
  color: var(--text);
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(15, 20, 25, 0.16);
  transition:
    transform 0.16s ease,
    opacity 0.16s ease,
    background-color 0.16s ease;
}

.reels-view__nav-button:hover:not(:disabled) {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--surface) 64%, var(--text) 36%);
}

.reels-view__nav-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.reels-view__nav-icon {
  width: 1.3rem;
  height: 1.3rem;
}

.reels-view__message-card {
  display: grid;
  gap: 0.75rem;
  width: min(100%, 30rem);
  margin: 0 auto;
  padding: 2rem 1.5rem;
  border: 1px solid var(--border);
  border-radius: 1.4rem;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.reels-view__eyebrow {
  margin: 0;
  font-size: 0.73rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

.reels-view__title {
  margin: 0;
  font-size: 1.55rem;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: var(--text);
}

.reels-view__message {
  margin: 0;
  font-size: 0.96rem;
  line-height: 1.6;
  color: var(--muted);
}

@media (max-width: 768px) {
  .reels-view__layout {
    grid-template-columns: minmax(0, 1fr);
    padding: 0;
  }

  .reels-view__deck-shell {
    height: 100%;
    min-height: 100%;
  }

  .reels-view__message-card {
    width: calc(100% - 1.5rem);
    margin: 1rem auto;
    padding: 1.55rem 1.15rem;
  }
}

.reels-info-popup-enter-active,
.reels-info-popup-leave-active {
  transition: opacity 0.18s ease;
}

.reels-info-popup-enter-from,
.reels-info-popup-leave-to {
  opacity: 0;
}
</style>
