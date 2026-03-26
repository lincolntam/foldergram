<template>
  <aside class="reels-info-sidebar sidebar" aria-label="Reel details">
    <div class="reels-info-sidebar__header">
      <p class="reels-info-sidebar__eyebrow">Reel Details</p>

      <button
        class="reels-info-sidebar__close"
        type="button"
        aria-label="Hide reel details"
        @click="$emit('close')"
      >
        <svg class="reels-info-sidebar__close-icon" viewBox="0 0 24 24" role="presentation">
          <path
            d="m7 7 10 10M17 7 7 17"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      </button>
    </div>

    <div class="reels-info-sidebar__folder-row">
      <RouterLink
        class="reels-info-sidebar__folder-link"
        :to="{ name: 'folder', params: { slug: item.folderSlug } }"
        aria-label="Open folder"
      >
        <Avatar
          class="reels-info-sidebar__avatar"
          :name="folder?.name ?? item.folderName"
          :src="folder?.avatarUrl ?? null"
        />
        <div class="min-w-0">
          <p class="reels-info-sidebar__folder-name">
            {{ folder?.name ?? item.folderName }}
          </p>
          <p class="reels-info-sidebar__folder-breadcrumb">
            {{ folderBreadcrumb }}
          </p>
        </div>
      </RouterLink>

      <span class="reels-info-sidebar__date">{{ formattedDate }}</span>
    </div>

    <p class="reels-info-sidebar__caption">{{ readableFilename }}</p>

    <dl class="reels-info-sidebar__stats">
      <div class="reels-info-sidebar__stat">
        <dt class="reels-info-sidebar__stat-label">Resolution</dt>
        <dd class="reels-info-sidebar__stat-value">{{ dimensionsLabel }}</dd>
      </div>
      <div class="reels-info-sidebar__stat">
        <dt class="reels-info-sidebar__stat-label">Length</dt>
        <dd class="reels-info-sidebar__stat-value">{{ durationLabel }}</dd>
      </div>
      <div class="reels-info-sidebar__stat">
        <dt class="reels-info-sidebar__stat-label">Size</dt>
        <dd class="reels-info-sidebar__stat-value">{{ fileSizeLabel }}</dd>
      </div>
      <div class="reels-info-sidebar__stat">
        <dt class="reels-info-sidebar__stat-label">Format</dt>
        <dd class="reels-info-sidebar__stat-value">{{ formatLabel }}</dd>
      </div>
    </dl>

    <p
      v-if="loading"
      class="reels-info-sidebar__notice"
      role="status"
      aria-live="polite"
    >
      Loading reel details...
    </p>
    <p v-else-if="error" class="reels-info-sidebar__notice reels-info-sidebar__notice--error" role="status">
      {{ error }}
    </p>

    <dl class="reels-info-sidebar__meta">
      <div class="reels-info-sidebar__meta-item">
        <dt class="reels-info-sidebar__meta-label">Folder Path</dt>
        <dd class="reels-info-sidebar__meta-value">{{ item.folderPath }}</dd>
      </div>

      <div v-if="mimeLabel" class="reels-info-sidebar__meta-item">
        <dt class="reels-info-sidebar__meta-label">MIME Type</dt>
        <dd class="reels-info-sidebar__meta-value">{{ mimeLabel }}</dd>
      </div>
    </dl>

  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { fetchImage } from '../api/gallery';
import type { FeedItem, FolderSummary, ImageDetail } from '../types/api';
import { formatMediaDuration } from '../utils/media';
import Avatar from './Avatar.vue';

const props = defineProps<{
  item: FeedItem;
  folder: FolderSummary | null;
  open: boolean;
}>();

defineEmits<{
  close: [];
}>();

const detail = ref<ImageDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const detailCache = new Map<number, ImageDetail>();
let requestToken = 0;

const readableFilename = computed(() =>
  props.item.filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);
const formattedDate = computed(() =>
  new Date(detail.value?.takenAt ?? detail.value?.sortTimestamp ?? props.item.takenAt ?? props.item.sortTimestamp).toLocaleDateString(
    undefined,
    {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }
  )
);
const folderBreadcrumb = computed(
  () => props.folder?.breadcrumb ?? detail.value?.folderBreadcrumb ?? props.item.folderBreadcrumb ?? 'Top-level source folder'
);
const dimensionsLabel = computed(() => `${detail.value?.width ?? props.item.width} x ${detail.value?.height ?? props.item.height}`);
const durationLabel = computed(() => formatMediaDuration(detail.value?.durationMs ?? props.item.durationMs) || 'Unavailable');
const formatLabel = computed(() => {
  if (!detail.value?.mimeType) {
    return 'Video';
  }

  return detail.value.mimeType.replace(/^video\//, '').toUpperCase();
});
const fileSizeLabel = computed(() => {
  if (!detail.value) {
    return loading.value ? 'Loading...' : 'Unavailable';
  }

  return `${(detail.value.fileSize / (1024 * 1024)).toFixed(2)} MB`;
});
const mimeLabel = computed(() => detail.value?.mimeType ?? null);

watch(
  () => [props.open, props.item.id] as const,
  ([open, itemId]) => {
    requestToken += 1;
    const currentToken = requestToken;

    if (!open) {
      detail.value = detailCache.get(itemId) ?? null;
      loading.value = false;
      error.value = null;
      return;
    }

    const cachedDetail = detailCache.get(itemId);
    if (cachedDetail) {
      detail.value = cachedDetail;
      loading.value = false;
      error.value = null;
      return;
    }

    detail.value = null;
    loading.value = true;
    error.value = null;

    void (async () => {
      try {
        const loadedDetail = await fetchImage(itemId, 'video');
        if (currentToken !== requestToken) {
          return;
        }

        detailCache.set(itemId, loadedDetail);
        detail.value = loadedDetail;
      } catch (loadError) {
        if (currentToken !== requestToken) {
          return;
        }

        detail.value = null;
        error.value = loadError instanceof Error ? loadError.message : 'Unable to load reel details.';
      } finally {
        if (currentToken === requestToken) {
          loading.value = false;
        }
      }
    })();
  },
  { immediate: true }
);
</script>

<style scoped>
.reels-info-sidebar {
  position: relative;
  width: min(22rem, calc(100vw - 8rem));
  max-height: min(34rem, calc(100vh - 2rem));
  padding: 1rem;
  border: 1px solid color-mix(in srgb, var(--border) 86%, transparent 14%);
  border-radius: 1.35rem;
  background: color-mix(in srgb, var(--surface) 96%, white 4%);
  box-shadow: 0 22px 48px rgba(15, 20, 25, 0.18);
  overflow-y: auto;
}

.reels-info-sidebar::before {
  content: '';
  position: absolute;
  bottom: 1.45rem;
  left: -0.5rem;
  width: 1rem;
  height: 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 86%, transparent 14%);
  border-left: 1px solid color-mix(in srgb, var(--border) 86%, transparent 14%);
  background: color-mix(in srgb, var(--surface) 96%, white 4%);
  transform: rotate(45deg);
}

.reels-info-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.reels-info-sidebar__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.3rem;
  height: 2.3rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-alt) 82%, var(--surface) 18%);
  color: var(--text);
  cursor: pointer;
  transition:
    transform 0.16s ease,
    opacity 0.16s ease,
    background-color 0.16s ease;
}

.reels-info-sidebar__close:hover {
  transform: translateY(-1px);
  opacity: 0.92;
  background: color-mix(in srgb, var(--surface-alt) 74%, var(--surface) 26%);
}

.reels-info-sidebar__eyebrow {
  margin: 0;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text);
}

.reels-info-sidebar__close-icon {
  width: 1rem;
  height: 1rem;
}

.reels-info-sidebar__folder-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem;
  margin-top: 1rem;
}

.reels-info-sidebar__folder-link {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  text-decoration: none;
  color: inherit;
}

.reels-info-sidebar__avatar {
  width: 2.65rem;
  height: 2.65rem;
  flex-shrink: 0;
}

.reels-info-sidebar__folder-name {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reels-info-sidebar__folder-breadcrumb {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  line-height: 1.4;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reels-info-sidebar__date {
  flex-shrink: 0;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--muted);
}

.reels-info-sidebar__caption {
  margin: 0;
  margin-top: 0.95rem;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--text);
  word-break: break-word;
}

.reels-info-sidebar__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 1rem 0 0;
}

.reels-info-sidebar__stat {
  min-width: 0;
  padding: 0.85rem 0.9rem;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent 16%);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--surface-alt) 82%, var(--surface) 18%);
}

.reels-info-sidebar__stat-label,
.reels-info-sidebar__meta-label {
  margin: 0;
  margin-bottom: 0.28rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}

.reels-info-sidebar__stat-value,
.reels-info-sidebar__meta-value {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1.45;
  color: var(--text);
  word-break: break-word;
}

.reels-info-sidebar__notice {
  margin: 1rem 0 0;
  padding: 0.85rem 0.95rem;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent 16%);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--surface-alt) 76%, var(--surface) 24%);
  font-size: 0.88rem;
  line-height: 1.45;
  color: var(--muted);
}

.reels-info-sidebar__notice--error {
  border-color: rgba(208, 48, 37, 0.2);
  background: rgba(208, 48, 37, 0.08);
  color: #b3261e;
}

.reels-info-sidebar__meta {
  display: grid;
  gap: 0.75rem;
  margin: 1rem 0 0;
}

.reels-info-sidebar__meta-item {
  padding: 0.9rem;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent 16%);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--surface-alt) 74%, var(--surface) 26%);
}

@media (max-width: 1100px) {
  .reels-info-sidebar {
    width: min(20rem, calc(100vw - 8rem));
  }
}

@media (max-width: 900px) {
  .reels-info-sidebar {
    width: min(18.5rem, calc(100vw - 7rem));
  }
}
</style>
