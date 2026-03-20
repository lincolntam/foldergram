<template>
  <!-- Mobile top nav — hidden on desktop (md+) -->
  <header class="topbar hidden max-md:flex items-center justify-between gap-4 sticky top-0 z-20 px-4 py-[0.95rem] bg-bg backdrop-blur-[12px] border-b border-border">
    <RouterLink class="topbar__brand inline-flex items-center justify-center w-12 h-12 p-[0.3rem] rounded-[1rem] color-inherit transition-[background-color,transform] duration-180 hover:bg-surface-hover hover:-translate-y-px" to="/" aria-label="Foldergram home">
      <BrandMark />
    </RouterLink>
    <div class="flex items-center gap-[0.35rem]">
      <RouterLink custom to="/" v-slot="{ href, navigate, isActive }">
        <a
          :href="href"
          class="topbar__icon-link inline-flex items-center justify-center w-11 h-12 rounded-[1rem] border-0 bg-transparent color-inherit cursor-pointer transition-colors duration-150 hover:bg-white/8"
          :class="isActive ? topbarActiveClass : ''"
          aria-label="Home"
          @click="navigate"
        >
          <span class="w-[1.45rem] h-[1.45rem]" :class="isActive ? 'i-fluent-home-16-filled' : 'i-fluent-home-16-regular'" aria-hidden="true" />
        </a>
      </RouterLink>
      <RouterLink custom :to="{ name: 'explore' }" v-slot="{ href, navigate, isActive }">
        <a
          :href="href"
          class="topbar__icon-link inline-flex items-center justify-center w-11 h-12 rounded-[1rem] border-0 bg-transparent color-inherit cursor-pointer transition-colors duration-150 hover:bg-white/8"
          :class="isActive ? topbarActiveClass : ''"
          aria-label="Search"
          @click="navigate"
        >
          <span class="w-[1.45rem] h-[1.45rem]" :class="isActive ? 'i-fluent-search-16-filled' : 'i-fluent-search-16-regular'" aria-hidden="true" />
        </a>
      </RouterLink>
      <RouterLink custom :to="{ name: 'library' }" v-slot="{ href, navigate, isActive }">
        <a
          :href="href"
          class="topbar__icon-link inline-flex items-center justify-center w-11 h-12 rounded-[1rem] border-0 bg-transparent color-inherit cursor-pointer transition-colors duration-150 hover:bg-white/8"
          :class="isActive ? topbarActiveClass : ''"
          aria-label="Library"
          @click="navigate"
        >
          <span class="w-[1.45rem] h-[1.45rem]" :class="isActive ? 'i-fluent-folder-16-filled' : 'i-fluent-folder-16-regular'" aria-hidden="true" />
        </a>
      </RouterLink>
      <RouterLink v-if="authStore.canUseSavedItems" custom :to="{ name: 'likes' }" v-slot="{ href, navigate, isActive }">
        <a
          :href="href"
          class="topbar__icon-link inline-flex items-center justify-center w-11 h-12 rounded-[1rem] border-0 bg-transparent color-inherit cursor-pointer transition-colors duration-150 hover:bg-white/8"
          :class="isActive ? topbarActiveClass : ''"
          :aria-label="`${likesStore.collectionLabel} (${likesStore.items.length})`"
          @click="navigate"
        >
          <span class="w-[1.45rem] h-[1.45rem]" :class="isActive ? 'i-fluent-heart-16-filled' : 'i-fluent-heart-16-regular'" aria-hidden="true" />
        </a>
      </RouterLink>
      <RouterLink v-if="authStore.canDeleteMedia" custom :to="{ name: 'trash' }" v-slot="{ href, navigate, isActive }">
        <a
          :href="href"
          class="topbar__icon-link inline-flex items-center justify-center w-11 h-12 rounded-[1rem] border-0 bg-transparent color-inherit cursor-pointer transition-colors duration-150 hover:bg-white/8"
          :class="isActive ? topbarActiveClass : ''"
          aria-label="Trash"
          @click="navigate"
        >
          <svg class="w-[1.45rem] h-[1.45rem]" viewBox="0 0 24 24" role="presentation">
            <path
              d="M9 4.75h6m-8 3h10m-8.5 0v10a1.25 1.25 0 0 0 1.25 1.25h4.5A1.25 1.25 0 0 0 15.5 17.75v-10m-4 3v5m4-5v5"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
        </a>
      </RouterLink>
      <RouterLink v-if="authStore.canAccessSettings" custom :to="{ name: 'settings' }" v-slot="{ href, navigate, isActive }">
        <a
          :href="href"
          class="topbar__icon-link inline-flex items-center justify-center w-11 h-12 rounded-[1rem] border-0 bg-transparent color-inherit cursor-pointer transition-colors duration-150 hover:bg-white/8"
          :class="isActive ? topbarActiveClass : ''"
          aria-label="Settings"
          @click="navigate"
        >
          <span class="w-[1.45rem] h-[1.45rem]" :class="isActive ? 'i-fluent-settings-16-filled' : 'i-fluent-settings-16-regular'" aria-hidden="true" />
        </a>
      </RouterLink>
      <button
        v-if="authStore.canUnlockAdmin"
        class="inline-flex items-center justify-center w-11 h-12 rounded-[1rem] color-inherit bg-transparent border-0 cursor-pointer transition-colors duration-150 hover:bg-white/8"
        type="button"
        aria-label="Unlock admin"
        @click="authStore.openUnlockDialog()"
      >
        <span class="i-fluent-key-16-regular w-[1.45rem] h-[1.45rem]" aria-hidden="true" />
      </button>
      <button
        v-if="authStore.authenticated"
        class="inline-flex items-center justify-center w-11 h-12 rounded-[1rem] color-inherit bg-transparent border-0 cursor-pointer transition-colors duration-150 hover:bg-white/8 disabled:opacity-60 disabled:cursor-wait"
        type="button"
        :aria-label="signOutLabel"
        :disabled="authStore.loading"
        @click="handleSignOut"
      >
        <span class="i-fluent-arrow-exit-20-regular w-[1.45rem] h-[1.45rem]" aria-hidden="true" />
      </button>
      <button class="inline-flex items-center justify-center w-11 h-12 rounded-[1rem] color-inherit bg-transparent border-0 cursor-pointer transition-colors duration-150 hover:bg-white/8" type="button" :aria-label="themeLabel" @click="appStore.toggleTheme()">
        <svg v-if="appStore.theme === 'light'" class="w-[1.45rem] h-[1.45rem]" viewBox="0 0 24 24" role="presentation">
          <path
            d="M12 3v2.5m0 13V21m9-9h-2.5M5.5 12H3m14.86 6.36-1.77-1.77M7.91 7.91 6.14 6.14m11.72 0-1.77 1.77M7.91 16.09l-1.77 1.77M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
        <svg v-else class="w-[1.45rem] h-[1.45rem]" viewBox="0 0 24 24" role="presentation">
          <path
            d="M20 14.5A7.5 7.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useLikesStore } from '../stores/likes';
import BrandMark from './BrandMark.vue';

const appStore = useAppStore();
const authStore = useAuthStore();
const likesStore = useLikesStore();
const themeLabel = computed(() => (appStore.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'));
const signOutLabel = computed(() => (authStore.accessMode === 'public' ? 'Return to public view' : 'Sign out'));
const topbarActiveClass = 'router-link-active bg-[rgba(255,255,255,0.08)]';

async function handleSignOut() {
  try {
    await authStore.logout();
  } catch {
    // Keep the current shell visible and let auth-store error handling surface the failure.
  }
}
</script>
