<template>
  <section
    ref="homeLayoutElement"
    :class="[
      'grid gap-[4rem] items-start justify-center mx-auto',
      isCompactHomeLayout
        ? 'grid-cols-1 w-full'
        : 'grid-cols-[minmax(0,39.375rem)_19.9375rem] w-[min(100%,63.3125rem)] md:relative',
    ]"
    :style="
      isCompactHomeLayout
        ? undefined
        : { left: 'calc(var(--desktop-content-compensation) * -1)' }
    "
  >
    <!-- Main feed column -->
    <div class="min-w-0">
      <section
        v-if="appStore.isLibraryRebuildRequired && appStore.stats && !appStore.isRebuilding"
        class="grid gap-[0.55rem] px-5 py-[1rem] mb-[1.1rem] border rounded-[1rem] shadow-[var(--shadow)]"
        style="background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 88%, #fff4d1 12%) 0%, color-mix(in srgb, var(--surface) 82%, #ffe49a 18%) 100%); border-color: color-mix(in srgb, var(--border) 72%, #d2a133 28%);"
      >
        <div class="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <div class="grid gap-[0.2rem]">
            <strong>Library location changed</strong>
            <p class="m-0 text-muted">
              The current index may still contain folders and cached media from a previous gallery location. Review the rebuild steps to reset the index, reuse any matching thumbnails and previews, and generate only the missing derivatives for the current library.
            </p>
          </div>
          <RouterLink
            v-if="canManageLibrary"
            class="inline-flex items-center justify-center min-h-10 px-4 rounded-[0.8rem] text-[0.84rem] font-bold text-white bg-[#9f6a00] whitespace-nowrap"
            :to="{ name: 'settings', query: { action: 'rebuild' } }"
          >
            Review Rebuild
          </RouterLink>
          <p v-else class="m-0 text-[0.84rem] text-muted">An admin session needs to rebuild the library.</p>
        </div>
      </section>

      <section v-if="!appStore.isLibraryUnavailable" class="grid gap-[1rem] mb-5 w-full max-w-[39.375rem]">
        <section v-if="momentsStore.items.length" class="mb-2">
          <div class="stories-bar flex gap-[0.95rem] overflow-x-auto pb-5 pr-2 pt-[0.12rem] [scrollbar-width:none]" :aria-label="momentsStore.railTitle">
            <button
              v-for="moment in momentsStore.items"
              :key="moment.id"
              class="flex flex-col items-center gap-[0.48rem] min-w-[5.85rem] border-0 bg-transparent p-0 text-muted text-[0.74rem] text-center cursor-pointer transition-transform duration-180 hover:-translate-y-[1px]"
              :title="`${moment.title} · ${moment.subtitle}`"
              type="button"
              @click="openRailViewer(moment.id)"
            >
              <div
                class="rounded-full p-[0.26rem] shadow-[0_14px_30px_rgba(246,106,61,0.18)]"
                style="background: var(--story-ring);"
              >
                <div class="rounded-full bg-bg p-[0.2rem]">
                  <Avatar class="w-[4.625rem] h-[4.625rem]" :name="moment.title" :src="moment.coverImage.thumbnailUrl" />
                </div>
              </div>
              <span class="max-w-[5.75rem] overflow-hidden text-ellipsis whitespace-nowrap font-semibold leading-tight text-text">{{ moment.title }}</span>
            </button>
          </div>
        </section>

        <div class="w-full max-w-[29.375rem] mx-auto flex items-center justify-between gap-[0.8rem] max-sm:flex-col max-sm:items-center">
          <div class="flex flex-wrap gap-[0.35rem] max-sm:w-full max-sm:justify-center">
            <button
              v-for="mode in feedModes"
              :key="mode.id"
              class="min-h-[2rem] px-[0.82rem] rounded-full border text-[0.71rem] font-bold transition-[background-color,border-color,color,box-shadow] duration-180"
              :class="feedStore.mode === mode.id ? 'border-[#1f2937] text-white shadow-[var(--shadow)]' : 'border-border text-text bg-surface hover:border-text/25 hover:bg-surface-alt'"
              :style="
                feedStore.mode === mode.id
                  ? 'background: linear-gradient(135deg, #1f2937 0%, #111827 100%);'
                  : undefined
              "
              :title="mode.description"
              :aria-label="`${mode.label}. ${mode.description}`"
              type="button"
              @click="selectMode(mode.id)"
            >
              {{ mode.label }}
            </button>
          </div>

          <div
            v-if="appStore.stats"
            class="m-0 shrink-0 flex items-center gap-[0.75rem] whitespace-nowrap text-[0.85rem] text-muted max-sm:mt-[3px] max-sm:justify-center"
            :aria-label="indexedSummaryLabel"
            role="status"
          >
            <span class="inline-flex items-center gap-[0.28rem]">
              <span class="i-fluent-image-16-regular w-[1.1rem] h-[1.1rem]" aria-hidden="true" />
              <strong class="font-semibold text-text">{{ formattedIndexedImageCount }}</strong>
            </span>
            <span class="inline-flex items-center gap-[0.28rem]">
              <span class="i-fluent-play-circle-24-filled w-[1.1rem] h-[1.1rem]" aria-hidden="true" />
              <strong class="font-semibold text-text">{{ formattedIndexedVideoCount }}</strong>
            </span>
            <span class="inline-flex items-center gap-[0.28rem]">
              <span class="i-fluent-folder-16-regular w-[1.1rem] h-[1.1rem]" aria-hidden="true" />
              <strong class="font-semibold text-text">{{ formattedFolderCount }}</strong>
            </span>
          </div>
        </div>
      </section>

      <!-- States -->
      <EmptyState v-if="appStore.isLibraryUnavailable" title="Library storage unavailable" :description="appStore.libraryUnavailableReason" />
      <ErrorState v-else-if="feedStore.error" title="Could not load feed" :message="feedStore.error" />

      <!-- Initial scan state (no feed yet) -->
      <section v-else-if="showInitialScanState" class="grid gap-[0.85rem] px-5 py-5 mb-[1.1rem] border border-border rounded-[1rem] shadow-[var(--shadow)]" style="background: radial-gradient(circle at top right, rgba(0,149,246,0.12), transparent 38%), linear-gradient(180deg, var(--surface) 0%, color-mix(in srgb, var(--surface) 90%, var(--accent) 10%) 100%);">
        <span class="text-accent-strong text-[0.75rem] font-bold tracking-[0.08em] uppercase">Startup scan in progress</span>
        <h2 class="m-0">Indexing your library</h2>
        <p class="m-0 text-muted">{{ scanDescription }}</p>
        <dl class="grid grid-cols-4 gap-[0.8rem] m-0 max-sm:grid-cols-2">
          <div class="px-[0.9rem] py-[0.8rem] rounded-[0.85rem]" style="background: color-mix(in srgb, var(--surface-alt) 88%, var(--accent) 12%)">
            <dt class="m-0 mb-[0.25rem] text-muted text-[0.74rem] uppercase tracking-[0.05em]">Folders</dt>
            <dd class="m-0 text-base font-bold">{{ appStore.stats?.scan.processedFolders ?? 0 }}/{{ appStore.stats?.scan.discoveredFolders ?? 0 }}</dd>
          </div>
          <div class="px-[0.9rem] py-[0.8rem] rounded-[0.85rem]" style="background: color-mix(in srgb, var(--surface-alt) 88%, var(--accent) 12%)">
            <dt class="m-0 mb-[0.25rem] text-muted text-[0.74rem] uppercase tracking-[0.05em]">Posts indexed</dt>
            <dd class="m-0 text-base font-bold">{{ appStore.stats?.scan.processedImages ?? 0 }}/{{ appStore.stats?.scan.discoveredImages ?? 0 }}</dd>
          </div>
          <div class="px-[0.9rem] py-[0.8rem] rounded-[0.85rem]" style="background: color-mix(in srgb, var(--surface-alt) 88%, var(--accent) 12%)">
            <dt class="m-0 mb-[0.25rem] text-muted text-[0.74rem] uppercase tracking-[0.05em]">Thumbnails</dt>
            <dd class="m-0 text-base font-bold">{{ appStore.stats?.scan.generatedThumbnails ?? 0 }}</dd>
          </div>
          <div class="px-[0.9rem] py-[0.8rem] rounded-[0.85rem]" style="background: color-mix(in srgb, var(--surface-alt) 88%, var(--accent) 12%)">
            <dt class="m-0 mb-[0.25rem] text-muted text-[0.74rem] uppercase tracking-[0.05em]">Previews</dt>
            <dd class="m-0 text-base font-bold">{{ appStore.stats?.scan.generatedPreviews ?? 0 }}</dd>
          </div>
        </dl>
      </section>

      <section
        v-else-if="showHomeSetupNotice"
        class="grid gap-[0.85rem] px-5 py-5 mb-[1.1rem] border rounded-[1rem] shadow-[var(--shadow)]"
        :style="homeSetupNoticeStyle"
      >
        <span class="text-[0.75rem] font-bold tracking-[0.08em] uppercase" :class="homeSetupNoticeEyebrowClass">
          {{ homeSetupNoticeEyebrow }}
        </span>
        <h2 class="m-0">{{ homeSetupNoticeTitle }}</h2>
        <p class="m-0 text-muted">{{ homeSetupNoticeDescription }}</p>
        <div class="flex items-center gap-4 max-sm:flex-col max-sm:items-start">
          <button v-if="canManageLibrary" class="btn-primary min-w-[11.5rem]" type="button" :disabled="homeScanDisabled" @click="runHomeScan">
            {{ homeScanButtonLabel }}
          </button>
          <p class="m-0 text-muted">{{ homeScanNote }}</p>
        </div>
        <p
          v-if="homeScanError"
          class="m-0 px-4 py-[0.85rem] border border-[rgba(214,48,49,0.24)] rounded-[0.9rem] text-[#c0392b] bg-[rgba(214,48,49,0.08)]"
        >
          {{ homeScanError }}
        </p>
      </section>
      <EmptyState v-else-if="feedStore.initialized && feedStore.items.length === 0" title="No posts indexed yet" description="Add folders under the gallery root and the feed will populate after the next scan." />
      <template v-else>
        <!-- Feed cards in home-layout context: transparent card, no shadow -->
        <div class="w-full max-w-[29.375rem] mx-auto flex flex-col gap-[1.2rem]">
          <FeedList :items="feedStore.items" context="home" :show-skeleton="!feedStore.initialized && feedStore.loading" />
        </div>
        <div class="w-full max-w-[29.375rem] mx-auto">
          <InfiniteLoader :loading="feedStore.loading" :has-more="feedStore.hasMore" @load-more="feedStore.loadMore" />
        </div>
      </template>

      <RailViewerModal
        v-if="activeRailViewerId && momentsStore.items.length"
        :items="momentsStore.items"
        :initial-id="activeRailViewerId"
        :rail-singular-label="momentsStore.railSingularLabel"
        @close="closeRailViewer"
      />
    </div>

    <!-- Right rail (suggestions) — hidden on mobile -->
    <aside
      v-if="
        !appStore.isLibraryUnavailable &&
        homeSummaryFolder &&
        !isCompactHomeLayout
      "
      class="sticky top-8 grid gap-[1.15rem] w-[19.9375rem] text-muted"
      aria-label="Folder recommendations"
    >
      <div class="flex items-center gap-[0.8rem]">
        <Avatar class="w-11 h-11" :name="homeSummaryFolder.name" :src="homeSummaryFolder.avatarUrl" />
        <div class="flex-1 min-w-0">
          <strong class="block text-text text-[0.87rem] font-bold">{{ homeSummaryFolder.name }}</strong>
          <p class="m-0 mt-[0.12rem] text-[0.79rem] truncate">{{ homeSummaryFolder.breadcrumb ?? 'Top-level source folder' }}</p>
        </div>
        <RouterLink class="ml-auto text-accent-strong text-[0.76rem] font-bold" :to="{ name: 'folder', params: { slug: homeSummaryFolder.slug } }">Open</RouterLink>
      </div>

      <div class="flex items-center justify-between gap-4 text-text text-[0.96rem] font-bold">
        <span>Suggested folders</span>
        <RouterLink class="text-muted text-[0.76rem] font-bold" :to="{ name: 'likes' }">View {{ likesStore.collectionLabel.toLowerCase() }}</RouterLink>
      </div>

      <div class="grid gap-[0.95rem]">
        <RouterLink
          v-for="folder in recommendedFolders"
          :key="folder.id"
          class="flex items-center gap-[0.8rem]"
          :to="{ name: 'folder', params: { slug: folder.slug } }"
        >
          <Avatar class="w-11 h-11" :name="folder.name" :src="folder.avatarUrl" />
          <div class="flex-1 min-w-0">
            <strong class="block text-text text-[0.87rem] font-bold">{{ folder.name }}</strong>
            <p class="m-0 mt-[0.12rem] text-[0.79rem] truncate">{{ folder.breadcrumb ?? 'Top-level source folder' }}</p>
          </div>
          <span class="ml-auto text-accent-strong text-[0.76rem] font-bold">Open</span>
        </RouterLink>
      </div>

      <p class="m-0 mt-[1.4rem] text-center text-[0.64rem] font-semibold uppercase tracking-[0.08em] leading-[1.7] text-muted">
        Foldergram is open source.
        <a
          class="text-muted transition-colors duration-180 hover:text-text"
          href="https://github.com/foldergram/foldergram"
          target="_blank"
          rel="noreferrer"
        >
          View on GitHub
        </a>
      </p>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { triggerManualScan } from '../api/gallery';
import Avatar from '../components/Avatar.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import FeedList from '../components/FeedList.vue';
import InfiniteLoader from '../components/InfiniteLoader.vue';
import RailViewerModal from '../components/RailViewerModal.vue';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useFeedStore } from '../stores/feed';
import { useLikesStore } from '../stores/likes';
import { useFoldersStore } from '../stores/folders';
import { useMomentsStore } from '../stores/moments';
import type { FeedMode } from '../types/api';
import { buildLikedCountByFolder, selectHomeRecommendations } from '../utils/home-recommendations';

const appStore = useAppStore();
const authStore = useAuthStore();
const feedStore = useFeedStore();
const likesStore = useLikesStore();
const foldersStore = useFoldersStore();
const momentsStore = useMomentsStore();
const likedCountByFolder = computed(() => buildLikedCountByFolder(likesStore.items));
const homeRecommendations = computed(() =>
  selectHomeRecommendations(foldersStore.items, likedCountByFolder.value, appStore.lastOpenedFolderSlug)
);
const homeSummaryFolder = computed(() => homeRecommendations.value.homeSummaryFolder);
const recommendedFolders = computed(() => homeRecommendations.value.recommendedFolders);
const activeRailViewerId = ref<string | null>(null);
const homeLayoutElement = ref<HTMLElement | null>(null);
const isCompactHomeLayout = ref(false);
const requestingHomeScan = ref(false);
const homeScanError = ref<string | null>(null);

const HOME_RIGHT_RAIL_BREAKPOINT = 960;
let homeLayoutResizeObserver: ResizeObserver | null = null;

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

const indexedSummaryLabel = computed(() => {
  if (!appStore.stats) {
    return '';
  }

  return `${formatCount(appStore.stats.indexedImages)} posts, ${formatCount(appStore.stats.indexedVideos)} videos across ${formatCount(appStore.stats.folders)} folders`;
});
const formattedIndexedImageCount = computed(() => formatCount(appStore.stats?.indexedImages ?? 0));
const formattedIndexedVideoCount = computed(() => formatCount(appStore.stats?.indexedVideos ?? 0));
const formattedFolderCount = computed(() => formatCount(appStore.stats?.folders ?? 0));
const feedModes: Array<{ id: FeedMode; label: string; description: string }> = [
  {
    id: 'recent',
    label: 'Recent',
    description: 'Newest posts first, with lighter runs from the same app folder.'
  },
  {
    id: 'rediscover',
    label: 'Rediscover',
    description: 'Older posts resurface when they are worth another look.'
  },
  {
    id: 'random',
    label: 'Random',
    description: 'A fresh shuffle that stays steady while you browse.'
  }
];
const showInitialScanState = computed(
  () => appStore.isScanning && feedStore.items.length === 0 && !feedStore.loading && !feedStore.error
);
const ignoredRootMediaCount = computed(() => appStore.stats?.libraryIndex.ignoredRootMediaCount ?? 0);
const hasIndexedFolders = computed(() => (appStore.stats?.folders ?? 0) > 0);
const showHomeSetupNotice = computed(
  () =>
    !appStore.isLibraryUnavailable &&
    !showInitialScanState.value &&
    Boolean(appStore.stats) &&
    feedStore.initialized &&
    feedStore.items.length === 0 &&
    !hasIndexedFolders.value
);
const homeSetupNoticeEyebrow = computed(() => (ignoredRootMediaCount.value > 0 ? 'Gallery Root' : 'Get Started'));
const homeSetupNoticeEyebrowClass = computed(() => (ignoredRootMediaCount.value > 0 ? 'text-[#9f6a00]' : 'text-accent-strong'));
const homeSetupNoticeTitle = computed(() =>
  ignoredRootMediaCount.value > 0 ? 'Files in the gallery root are being ignored' : 'No folders found yet'
);
const homeSetupNoticeDescription = computed(() => {
  if (ignoredRootMediaCount.value > 0) {
    const supportedFileLabel = ignoredRootMediaCount.value === 1 ? 'supported file is' : 'supported files are';
    return `${formatCount(ignoredRootMediaCount.value)} ${supportedFileLabel} being ignored in the gallery root. Move them into a folder inside your gallery root, such as example-album, to create App Folders. Files placed directly in the gallery root are ignored.`;
  }

  return 'Create a folder inside your gallery root, such as example-album, and place photos or videos in it to create your first App Folder. Files placed directly in the gallery root are ignored.';
});
const homeSetupNoticeStyle = computed(() =>
  ignoredRootMediaCount.value > 0
    ? 'background: radial-gradient(circle at top right, rgba(210,161,51,0.16), transparent 38%), linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, #fff4d1 8%) 0%, color-mix(in srgb, var(--surface) 88%, #ffeab1 12%) 100%); border-color: color-mix(in srgb, var(--border) 70%, #d2a133 30%);'
    : 'background: radial-gradient(circle at top right, rgba(0,149,246,0.12), transparent 38%), linear-gradient(180deg, var(--surface) 0%, color-mix(in srgb, var(--surface) 92%, var(--accent) 8%) 100%); border-color: color-mix(in srgb, var(--border) 78%, var(--accent) 22%);'
);
const homeScanDisabled = computed(
  () =>
    !authStore.canManageLibrary ||
    appStore.isLibraryUnavailable ||
    appStore.isLibraryRebuildRequired ||
    appStore.isScanning ||
    requestingHomeScan.value
);
const canManageLibrary = computed(() => authStore.canManageLibrary);
const homeScanButtonLabel = computed(() => {
  if (appStore.isScanning || requestingHomeScan.value) {
    return 'Scanning library...';
  }

  return 'Run Scan Library';
});
const homeScanNote = computed(() => {
  if (appStore.isLibraryUnavailable) {
    return appStore.libraryUnavailableReason;
  }

  if (appStore.isLibraryRebuildRequired) {
    return 'Rebuild the library index first because the gallery location changed.';
  }

  if (!authStore.canManageLibrary) {
    return 'An admin session needs to run the next scan before new folders or moved media will appear here.';
  }

  if (appStore.isScanning || requestingHomeScan.value) {
    return 'Scanning the gallery now and refreshing the Home feed when it finishes.';
  }

  return 'Run a scan after adding folders or moving files so the library can index them.';
});
const scanDescription = computed(() => {
  const scan = appStore.stats?.scan;
  if (!scan) {
    return 'Preparing scan status...';
  }

  const currentFolder = scan.currentFolder ? ` Current folder: ${scan.currentFolder}.` : '';
  if (scan.scanReason === 'rebuild-thumbnails') {
    return `Regenerating thumbnails and video posters in the background.${currentFolder}`;
  }

  if (scan.phase === 'discovery' && scan.discoveredFolders === 0 && scan.discoveredImages === 0) {
    return `Walking the library tree to find media folders before indexing begins.${currentFolder}`;
  }

  if (scan.phase === 'derivatives') {
    return `Generating thumbnails and previews in the background.${currentFolder}`;
  }

  return `Indexing folders and posts so the library can open immediately.${currentFolder}`;
});

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function warmScanStatus() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await wait(attempt === 0 ? 150 : 250);

    try {
      await appStore.fetchStats({ background: true });
    } catch {
      // The rescan request may win the race; keep polling until scan state flips or the request finishes.
    }

    if (appStore.stats?.scan.isScanning) {
      return;
    }
  }
}

async function selectMode(mode: FeedMode) {
  await feedStore.setMode(mode);
}

function openRailViewer(id: string) {
  activeRailViewerId.value = id;
}

function closeRailViewer() {
  activeRailViewerId.value = null;
}

function updateHomeLayout() {
  const layoutWidth = homeLayoutElement.value?.clientWidth ?? window.innerWidth;
  isCompactHomeLayout.value = layoutWidth <= HOME_RIGHT_RAIL_BREAKPOINT;
}

async function runHomeScan() {
  if (homeScanDisabled.value || !authStore.canManageLibrary) {
    return;
  }

  requestingHomeScan.value = true;
  homeScanError.value = null;

  try {
    const request = triggerManualScan();
    void warmScanStatus();
    await request;
    await appStore.fetchStats({ background: true });
    await Promise.all([foldersStore.fetchFolders(true), feedStore.loadInitial(true), momentsStore.fetchMoments(true)]);
  } catch (error) {
    homeScanError.value = error instanceof Error ? error.message : 'Unable to start a library scan.';
  } finally {
    requestingHomeScan.value = false;
  }
}

onMounted(async () => {
  updateHomeLayout();

  if (typeof ResizeObserver !== 'undefined' && homeLayoutElement.value) {
    homeLayoutResizeObserver = new ResizeObserver(() => {
      updateHomeLayout();
    });
    homeLayoutResizeObserver.observe(homeLayoutElement.value);
  } else {
    window.addEventListener('resize', updateHomeLayout);
  }

  if (!appStore.stats) {
    await appStore.fetchStats().catch(() => {});
  }

  if (appStore.isLibraryUnavailable) {
    return;
  }

  feedStore.initializeMode(appStore.defaultHomeFeedMode);
  await Promise.all([feedStore.loadInitial(), momentsStore.fetchMoments()]);
});

watch(
  () => [appStore.stats?.indexedImages ?? 0, appStore.stats?.folders ?? 0] as const,
  async ([indexedImages, folderCount]) => {
    if (appStore.isLibraryUnavailable) {
      return;
    }

    if (folderCount > 0 && folderCount !== foldersStore.items.length) {
      await foldersStore.fetchFolders(true);
    }

    if (indexedImages > 0 && feedStore.items.length === 0 && !feedStore.loading) {
      await feedStore.loadInitial(true);
    }

    if (indexedImages > 0 && momentsStore.items.length === 0 && !momentsStore.loadingList) {
      await momentsStore.fetchMoments(true);
    }
  }
);

watch(
  () => appStore.stats?.scan.lastCompletedScan?.id ?? null,
  async (lastCompletedScanId, previousScanId) => {
    if (
      appStore.isLibraryUnavailable ||
      lastCompletedScanId === null ||
      lastCompletedScanId === previousScanId ||
      momentsStore.loadingList
    ) {
      return;
    }

    await momentsStore.fetchMoments(true);
  }
);

watch(
  () => momentsStore.items.map((item) => item.id),
  (ids) => {
    if (activeRailViewerId.value && !ids.includes(activeRailViewerId.value)) {
      activeRailViewerId.value = ids[0] ?? null;
    }
  }
);

onUnmounted(() => {
  homeLayoutResizeObserver?.disconnect();
  homeLayoutResizeObserver = null;
  window.removeEventListener('resize', updateHomeLayout);
});
</script>
