<template>
  <aside
    class="sidebar group flex h-full w-[4.85rem] flex-col overflow-visible bg-bg px-[0.95rem] py-5 text-text transition-[width] duration-220 ease hover:w-60"
  >
    <RouterLink
      class="sidebar__brand relative inline-flex items-center justify-center w-12 h-12 p-[0.3rem] rounded-[1rem] color-inherit transition-[background-color,transform,opacity] duration-180 hover:bg-surface-hover hover:-translate-y-px"
      to="/"
      aria-label="Foldergram home"
    >
      <span
        class="pointer-events-none absolute top-[0.16rem] left-1/2 -translate-x-1/2 text-[0.42rem] leading-none tracking-[0.08em] text-muted"
        aria-hidden="true"
      >
        {{ appVersion }}
      </span>
      <BrandMark />
    </RouterLink>

    <nav
      class="sidebar__nav flex flex-col flex-1 min-h-0 gap-[0.4rem] overflow-y-auto mt-5 [scrollbar-width:none]"
    >
      <RouterLink custom to="/" v-slot="{ href, navigate, isActive }">
        <a
          :href="href"
          class="sidebar__link sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.45rem] h-[1.45rem]"
            :class="
              isActive ? 'i-fluent-home-16-filled' : 'i-fluent-home-16-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
            >Home</span
          >
        </a>
      </RouterLink>

      <RouterLink
        custom
        :to="{ name: 'explore' }"
        v-slot="{ href, navigate, isActive }"
      >
        <a
          :href="href"
          class="sidebar__link sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.45rem] h-[1.45rem]"
            :class="
              isActive
                ? 'i-fluent-search-16-filled'
                : 'i-fluent-search-16-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
            >Search</span
          >
        </a>
      </RouterLink>

      <RouterLink
        custom
        :to="{ name: 'library' }"
        v-slot="{ href, navigate, isActive }"
      >
        <a
          :href="href"
          class="sidebar__link sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.45rem] h-[1.45rem]"
            :class="
              isActive
                ? 'i-fluent-folder-16-filled'
                : 'i-fluent-folder-16-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
            >Library</span
          >
        </a>
      </RouterLink>

      <RouterLink
        v-if="authStore.canUseSavedItems"
        custom
        :to="{ name: 'likes' }"
        v-slot="{ href, navigate, isActive }"
      >
        <a
          :href="href"
          class="sidebar__link sidebar-item"
          :class="isActive ? sidebarActiveClass : ''"
          @click="navigate"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.58rem] h-[1.58rem]"
            :class="
              isActive
                ? 'i-fluent-heart-16-filled'
                : 'i-fluent-heart-16-regular'
            "
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
            >{{ likesStore.collectionLabel }}</span
          >
          <small
            class="sidebar__badge sidebar__meta ml-auto max-w-0 min-w-[1.5rem] overflow-hidden whitespace-nowrap rounded-full bg-white/12 px-[0.45rem] py-[0.1rem] text-center text-[0.72rem] font-bold text-white/86 opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
            >{{ likesStore.items.length }}</small
          >
        </a>
      </RouterLink>

      <span
        class="sidebar__section-label sidebar__meta inline-flex min-h-[1rem] items-center self-start mt-7 max-w-0 overflow-hidden whitespace-nowrap px-[0.75rem] text-[0.68rem] leading-[1.2] font-semibold uppercase tracking-[0.12em] text-muted opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
        style="
          transition:
            opacity 0.18s ease,
            max-width 0.22s ease;
        "
        >Folders Spotlight</span
      >
      <div
        class="flex min-h-0 flex-col gap-[0.2rem] max-h-[22.5rem] overflow-y-auto [scrollbar-width:none]"
      >
        <RouterLink
          v-for="folder in featuredFolders"
          :key="folder.id"
          custom
          :to="{ name: 'folder', params: { slug: folder.slug } }"
          v-slot="{ href, navigate, isActive }"
        >
          <a
            :href="href"
            class="sidebar__folder sidebar-item"
            :class="isActive ? sidebarActiveClass : ''"
            :title="
              folder.breadcrumb
                ? `${folder.breadcrumb} / ${folder.name}`
                : folder.name
            "
            @click="navigate"
          >
            <Avatar
              :name="folder.name"
              :src="folder.avatarUrl"
              class="h-[1.75rem] w-[1.75rem]"
            />
            <span
              class="sidebar__folder-copy sidebar__meta flex min-w-0 max-w-0 flex-col gap-[0.05rem] overflow-hidden whitespace-nowrap opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
              style="
                transition:
                  opacity 0.18s ease,
                  max-width 0.22s ease;
              "
            >
              <strong class="truncate text-[0.82rem]">{{ folder.name }}</strong>
              <small class="truncate text-[0.68rem] text-muted">{{
                folder.breadcrumb ?? `${folder.imageCount} posts`
              }}</small>
            </span>
          </a>
        </RouterLink>
      </div>
    </nav>

    <div
      v-if="moreMenuOpen"
      class="fixed inset-0 z-40"
      @click="closeMoreMenu"
    />

    <div class="z-50 mt-auto pt-10 pb-2">
      <div class="relative">
        <div
          v-if="moreMenuOpen"
          class="absolute bottom-[calc(100%+0.35rem)] left-0 w-[18rem] overflow-hidden rounded-[1.55rem] border border-border bg-[color-mix(in_srgb,var(--surface)_96%,var(--bg)_4%)] shadow-[0_28px_70px_rgba(0,0,0,0.24)]"
        >
          <RouterLink
            v-if="authStore.canDeleteMedia"
            class="flex items-center gap-[0.95rem] px-[1.2rem] py-[1rem] text-[0.98rem] text-text transition-colors duration-150 hover:bg-surface-hover"
            :to="{ name: 'trash' }"
            @click="closeMoreMenu"
          >
            <svg
              class="w-[1.18rem] h-[1.18rem] shrink-0"
              viewBox="0 0 24 24"
              role="presentation"
            >
              <path
                d="M9 4.75h6m-8 3h10m-8.5 0v10a1.25 1.25 0 0 0 1.25 1.25h4.5A1.25 1.25 0 0 0 15.5 17.75v-10m-4 3v5m4-5v5"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </svg>
            <span>Trash</span>
          </RouterLink>

          <RouterLink
            v-if="authStore.canAccessSettings"
            class="flex items-center gap-[0.95rem] px-[1.2rem] py-[1rem] text-[0.98rem] text-text transition-colors duration-150 hover:bg-surface-hover"
            :to="{ name: 'settings' }"
            @click="closeMoreMenu"
          >
            <span
              class="i-fluent-settings-16-regular w-[1.18rem] h-[1.18rem] shrink-0"
              aria-hidden="true"
            />
            <span>Settings</span>
          </RouterLink>

          <button
            v-if="authStore.canUnlockAdmin"
            class="flex items-center gap-[0.95rem] w-full px-[1.2rem] py-[1rem] border-0 bg-transparent text-[0.98rem] text-text cursor-pointer text-left transition-colors duration-150 hover:bg-surface-hover disabled:opacity-60 disabled:cursor-wait"
            type="button"
            :disabled="authStore.loading"
            @click="handleUnlockAdmin"
          >
            <span
              class="i-fluent-key-16-regular w-[1.18rem] h-[1.18rem] shrink-0"
              aria-hidden="true"
            />
            <span>Unlock admin</span>
          </button>

          <button
            class="flex items-center gap-[0.95rem] w-full px-[1.2rem] py-[1rem] border-0 bg-transparent text-[0.98rem] text-text cursor-pointer text-left transition-colors duration-150 hover:bg-surface-hover"
            type="button"
            :aria-label="appearanceLabel"
            @click="handleAppearanceToggle"
          >
            <svg
              v-if="appStore.theme === 'light'"
              class="w-[1.18rem] h-[1.18rem] shrink-0"
              viewBox="0 0 24 24"
              role="presentation"
            >
              <path
                d="M20 14.5A7.5 7.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </svg>
            <svg
              v-else
              class="w-[1.18rem] h-[1.18rem] shrink-0"
              viewBox="0 0 24 24"
              role="presentation"
            >
              <path
                d="M12 3v2.5m0 13V21m9-9h-2.5M5.5 12H3m14.86 6.36-1.77-1.77M7.91 7.91 6.14 6.14m11.72 0-1.77 1.77M7.91 16.09l-1.77 1.77M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </svg>
            <span>Switch appearance</span>
          </button>

          <button
            v-if="authStore.authenticated"
            class="flex items-center gap-[0.95rem] w-full px-[1.2rem] py-[1rem] border-0 bg-transparent text-[0.98rem] text-text cursor-pointer text-left transition-colors duration-150 hover:bg-surface-hover disabled:opacity-60 disabled:cursor-wait"
            type="button"
            :disabled="authStore.loading"
            @click="handleSignOut"
          >
            <span
              class="i-fluent-arrow-exit-20-regular w-[1.18rem] h-[1.18rem] shrink-0"
              aria-hidden="true"
            />
            <span>{{ signOutLabel }}</span>
          </button>
        </div>

        <button
          class="sidebar-item w-full"
          :class="moreMenuOpen ? 'bg-surface-hover font-semibold' : ''"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="moreMenuOpen"
          @click="toggleMoreMenu"
        >
          <span
            class="sidebar__icon flex-shrink-0 w-[1.45rem] h-[1.45rem]"
            :class="'i-fluent-line-horizontal-3-20-filled'"
            aria-hidden="true"
          />
          <span
            class="sidebar__label max-w-0 overflow-hidden whitespace-nowrap text-[0.9rem] opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100"
            style="
              transition:
                opacity 0.18s ease,
                max-width 0.22s ease;
            "
            >More</span
          >
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref, watch } from "vue"
  import { RouterLink, useRoute } from "vue-router"

  import { useAppStore } from "../stores/app"
  import { useAuthStore } from "../stores/auth"
  import { useLikesStore } from "../stores/likes"
  import { useFoldersStore } from "../stores/folders"
  import { buildLikedCountByFolder } from "../utils/home-recommendations"
  import { selectSidebarFolders } from "../utils/sidebar-folders"
  import Avatar from "./Avatar.vue"
  import BrandMark from "./BrandMark.vue"

  const appVersion = __APP_VERSION__
  const appStore = useAppStore()
  const authStore = useAuthStore()
  const likesStore = useLikesStore()
  const foldersStore = useFoldersStore()
  const route = useRoute()
  const moreMenuOpen = ref(false)

  const likedCountByFolder = computed(() =>
    buildLikedCountByFolder(likesStore.items),
  )
  const featuredFolders = computed(() =>
    selectSidebarFolders(
      foldersStore.items,
      likedCountByFolder.value,
      appStore.recentOpenedFolderSlugs,
    ),
  )
  const appearanceLabel = computed(() =>
    appStore.theme === "light" ? "Switch to dark mode" : "Switch to light mode",
  )
  const signOutLabel = computed(() =>
    authStore.accessMode === "public" ? "Return to public view" : "Sign out",
  )
  const sidebarActiveClass =
    "router-link-active bg-[color-mix(in_srgb,var(--surface)_92%,transparent_8%)] font-bold"

  function closeMoreMenu() {
    moreMenuOpen.value = false
  }

  function toggleMoreMenu() {
    moreMenuOpen.value = !moreMenuOpen.value
  }

  function handleAppearanceToggle() {
    appStore.toggleTheme()
    closeMoreMenu()
  }

  function handleUnlockAdmin() {
    authStore.openUnlockDialog()
    closeMoreMenu()
  }

  async function handleSignOut() {
    closeMoreMenu()

    try {
      await authStore.logout()
    } catch {
      // Keep the current shell visible and let auth-store error handling surface the failure.
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeMoreMenu()
    }
  }

  watch(
    () => route.fullPath,
    () => {
      closeMoreMenu()
    },
  )

  onMounted(() => {
    window.addEventListener("keydown", handleWindowKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener("keydown", handleWindowKeydown)
  })
</script>
