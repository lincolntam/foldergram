<template>
  <section class="w-[min(100%,72rem)] mx-auto grid gap-[1.1rem]">
    <header class="flex items-end justify-between gap-4 max-sm:flex-col max-sm:items-start">
      <div class="flex flex-col items-start gap-[0.25rem]">
        <span class="eyebrow">Trash</span>
        <h1 class="m-0 text-[clamp(1.5rem,2.2vw,1.9rem)] tracking-[-0.03em]">Deleted posts</h1>
        <p class="m-0 text-muted">
          Posts moved here stay on disk until you permanently delete them.
        </p>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-[0.82rem] text-muted tabular-nums">{{ selectedCount }} selected</span>
        <button
          class="min-h-[2.35rem] px-4 py-[0.6rem] rounded-[0.75rem] border border-border bg-surface text-text font-semibold disabled:opacity-55 disabled:cursor-not-allowed"
          type="button"
          :disabled="selectedCount === 0 || processing"
          @click="restoreConfirmOpen = true"
        >
          Restore
        </button>
        <button
          class="min-h-[2.35rem] px-4 py-[0.6rem] rounded-[0.75rem] border border-transparent bg-[#b42318] text-white font-semibold disabled:opacity-55 disabled:cursor-not-allowed"
          type="button"
          :disabled="selectedCount === 0 || processing"
          @click="permanentConfirmOpen = true"
        >
          Permanently Delete
        </button>
      </div>
    </header>

    <EmptyState
      v-if="appStore.isLibraryUnavailable"
      title="Library storage unavailable"
      :description="appStore.libraryUnavailableReason"
    />
    <ErrorState
      v-else-if="trashStore.error && trashStore.items.length === 0"
      title="Could not load trash"
      :message="trashStore.error"
    />
    <template v-else>
      <p
        v-if="actionError"
        class="m-0 px-4 py-[0.75rem] rounded-[0.85rem] border border-[rgba(217,48,37,0.24)] text-[0.88rem] text-[#b42318] bg-[rgba(217,48,37,0.08)]"
      >
        {{ actionError }}
      </p>

      <section v-if="trashStore.loading && !trashStore.initialized && trashStore.items.length === 0" class="card p-8 text-center">
        <p class="m-0 text-muted">Loading trash...</p>
      </section>
      <EmptyState
        v-else-if="trashStore.initialized && trashStore.items.length === 0"
        title="Trash is empty"
        description="Deleted posts will appear here so you can restore them or remove them permanently."
      />
      <template v-else>
        <section class="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          <article
            v-for="item in trashStore.items"
            :key="item.id"
            :class="[
              'group overflow-hidden rounded-[0.9rem] border bg-surface transition-[border-color,box-shadow,transform,background-color] duration-180',
              isSelected(item.id)
                ? 'border-[color-mix(in_srgb,var(--accent)_40%,var(--border)_60%)] bg-[color-mix(in_srgb,var(--surface)_90%,var(--accent)_10%)] shadow-[0_16px_36px_rgba(0,149,246,0.14)]'
                : 'border-border'
            ]"
          >
            <label class="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none border-b border-border">
              <span class="text-[0.8rem] font-semibold text-text truncate">
                {{ item.folderName }}
              </span>
              <input
                class="cursor-pointer"
                type="checkbox"
                :checked="isSelected(item.id)"
                @change="toggleSelected(item.id)"
              />
            </label>

            <button
              class="relative block w-full aspect-square overflow-hidden border-0 p-0 text-left cursor-pointer bg-surface-alt"
              type="button"
              :aria-pressed="isSelected(item.id)"
              :aria-label="`${isSelected(item.id) ? 'Deselect' : 'Select'} ${readableFilename(item.filename)}`"
              @click="toggleSelected(item.id)"
            >
              <ResilientImage
                :src="item.thumbnailUrl"
                :alt="item.filename"
                loading="lazy"
                :retry-while="appStore.isScanning"
                :class="[
                  'h-full w-full object-cover transition-[transform,filter] duration-180',
                  isSelected(item.id) ? 'scale-[1.02] saturate-[1.05]' : 'group-hover:scale-[1.01]'
                ]"
              />
              <div
                v-if="item.mediaType === 'video'"
                class="absolute inset-x-0 top-0 flex items-center justify-between px-2 py-2 text-white pointer-events-none bg-[linear-gradient(180deg,rgba(10,14,24,0.72)_0%,rgba(10,14,24,0)_100%)]"
              >
                <span class="i-fluent-play-circle-24-filled w-[1.05rem] h-[1.05rem]" aria-hidden="true" />
              </div>
              <div
                :class="[
                  'absolute inset-0 pointer-events-none transition-colors duration-180',
                  isSelected(item.id) ? 'bg-[rgba(0,149,246,0.16)]' : 'bg-transparent'
                ]"
              />
              <div
                :class="[
                  'absolute right-3 bottom-3 flex h-9 w-9 items-center justify-center rounded-full border shadow-[0_10px_28px_rgba(15,20,25,0.18)] transition-all duration-180',
                  isSelected(item.id)
                    ? 'border-transparent bg-accent text-white'
                    : 'border-[rgba(255,255,255,0.45)] bg-[rgba(10,14,24,0.46)] text-white/92'
                ]"
              >
                <span
                  :class="isSelected(item.id) ? 'i-fluent-checkmark-20-filled h-5 w-5' : 'i-fluent-square-20-regular h-5 w-5'"
                  aria-hidden="true"
                />
              </div>
            </button>

            <div class="grid gap-[0.35rem] px-3 py-3">
              <p class="m-0 text-[0.84rem] truncate">{{ readableFilename(item.filename) }}</p>
              <p class="m-0 text-[0.74rem] text-muted">Trashed {{ formatTrashedAt(item.trashedAt) }}</p>
              <RouterLink class="text-[0.74rem] font-semibold text-accent-strong" :to="{ name: 'folder', params: { slug: item.folderSlug } }">
                Open folder
              </RouterLink>
            </div>
          </article>
        </section>

        <InfiniteLoader :loading="trashStore.loading" :has-more="trashStore.hasMore" @load-more="trashStore.loadMore" />
      </template>
    </template>

    <ConfirmDialog
      v-if="restoreConfirmOpen"
      title="Restore selected posts?"
      :message="`Restore ${selectedCount} selected post${selectedCount === 1 ? '' : 's'} to the app?`"
      confirm-label="Restore"
      loading-label="Restoring..."
      :loading="processing"
      @cancel="restoreConfirmOpen = false"
      @confirm="handleRestore"
    />

    <ConfirmDialog
      v-if="permanentConfirmOpen"
      title="Permanently delete selected posts?"
      :message="`This will permanently delete ${selectedCount} selected post${selectedCount === 1 ? '' : 's'} and remove original files from disk.`"
      confirm-label="Permanently Delete"
      loading-label="Deleting..."
      :loading="processing"
      @cancel="permanentConfirmOpen = false"
      @confirm="handlePermanentDelete"
    >
      <template #details>
        <p class="m-0 mt-3 px-3 py-[0.8rem] rounded-[0.9rem] border border-[rgba(217,48,37,0.24)] text-[0.84rem] text-[#b42318] bg-[rgba(217,48,37,0.08)]">
          Original files, thumbnails, and previews will be removed permanently. This action cannot be undone.
        </p>
      </template>
    </ConfirmDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { deleteImage, restoreImage } from '../api/gallery';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import InfiniteLoader from '../components/InfiniteLoader.vue';
import ResilientImage from '../components/ResilientImage.vue';
import { useAppStore } from '../stores/app';
import { useFeedStore } from '../stores/feed';
import { useFoldersStore } from '../stores/folders';
import { useLikesStore } from '../stores/likes';
import { useMomentsStore } from '../stores/moments';
import { useTrashStore } from '../stores/trash';

const appStore = useAppStore();
const feedStore = useFeedStore();
const foldersStore = useFoldersStore();
const likesStore = useLikesStore();
const momentsStore = useMomentsStore();
const trashStore = useTrashStore();
const selectedIds = ref<number[]>([]);
const actionError = ref<string | null>(null);
const processing = ref(false);
const restoreConfirmOpen = ref(false);
const permanentConfirmOpen = ref(false);

const selectedCount = computed(() => selectedIds.value.length);

function isSelected(id: number): boolean {
  return selectedIds.value.includes(id);
}

function toggleSelected(id: number) {
  if (isSelected(id)) {
    selectedIds.value = selectedIds.value.filter((selectedId) => selectedId !== id);
    return;
  }

  selectedIds.value = [...selectedIds.value, id];
}

function readableFilename(filename: string) {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatTrashedAt(value: string | null) {
  if (!value) {
    return 'recently';
  }

  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

async function refreshVisibleData() {
  await Promise.all([
    foldersStore.fetchFolders(true),
    feedStore.loadInitial(true),
    likesStore.initialize(true),
    momentsStore.fetchMoments(true),
    appStore.fetchStats({ background: true })
  ]);
}

function refreshVisibleDataInBackground() {
  void refreshVisibleData().catch((error) => {
    actionError.value = error instanceof Error ? error.message : 'Unable to refresh the updated library state.';
  });
}

async function processSelection(action: 'restore' | 'delete') {
  const ids = [...selectedIds.value];
  if (ids.length === 0) {
    return {
      succeededCount: 0,
      failedCount: 0
    };
  }

  processing.value = true;
  actionError.value = null;
  const succeeded: number[] = [];
  let failedCount = 0;

  for (const id of ids) {
    try {
      if (action === 'restore') {
        await restoreImage(id);
      } else {
        await deleteImage(id);
      }
      succeeded.push(id);
    } catch {
      failedCount += 1;
    }
  }

  if (succeeded.length > 0) {
    trashStore.removeItems(succeeded);
    selectedIds.value = selectedIds.value.filter((id) => !succeeded.includes(id));
  }

  if (failedCount > 0) {
    actionError.value = `${failedCount} post${failedCount === 1 ? '' : 's'} could not be processed.`;
  }

  processing.value = false;

  if (succeeded.length > 0) {
    refreshVisibleDataInBackground();
  }

  return {
    succeededCount: succeeded.length,
    failedCount
  };
}

async function handleRestore() {
  const result = await processSelection('restore');
  if (result.succeededCount > 0 || result.failedCount === 0) {
    restoreConfirmOpen.value = false;
  }
}

async function handlePermanentDelete() {
  const result = await processSelection('delete');
  if (result.succeededCount > 0 || result.failedCount === 0) {
    permanentConfirmOpen.value = false;
  }
}

onMounted(async () => {
  if (appStore.isLibraryUnavailable) {
    return;
  }

  if (trashStore.initialized) {
    void trashStore.loadInitial(true);
    return;
  }

  await trashStore.loadInitial(true);
});

watch(
  () => trashStore.items.map((item) => item.id),
  (itemIds) => {
    const itemIdSet = new Set(itemIds);
    selectedIds.value = selectedIds.value.filter((id) => itemIdSet.has(id));
  },
  { immediate: true }
);
</script>
