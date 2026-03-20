import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router';

import HomeView from '../views/HomeView.vue';
import ImageView from '../views/ImageView.vue';
import LibraryView from '../views/LibraryView.vue';
import LikesView from '../views/LikesView.vue';
import ExploreView from '../views/ExploreView.vue';
import FolderView from '../views/FolderView.vue';
import MomentView from '../views/MomentView.vue';
import TrashView from '../views/TrashView.vue';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { pinia } from '../stores/pinia';
import SettingsView from '../views/SettingsView.vue';
import type { AuthCapabilities } from '../types/api';

type RouteCapability = keyof AuthCapabilities;

function shouldPreserveModalScroll(to: RouteLocationNormalized, from: RouteLocationNormalized) {
  const appStore = useAppStore(pinia);
  const backgroundPath = appStore.imageModalBackgroundPath;

  if (!backgroundPath) {
    return false;
  }

  const isOpeningModal = to.name === 'image' && from.fullPath === backgroundPath;
  const isClosingModal = from.name === 'image' && to.fullPath === backgroundPath;
  const isNavigatingWithinModal = to.name === 'image' && from.name === 'image';

  return isOpeningModal || isClosingModal || isNavigatingWithinModal;
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView
    },
    {
      path: '/image/:id',
      name: 'image',
      component: ImageView,
      props: true
    },
    {
      path: '/library',
      name: 'library',
      component: LibraryView
    },
    {
      path: '/explore',
      name: 'explore',
      component: ExploreView,
      meta: {
        shell: 'explore'
      }
    },
    {
      path: '/likes/posts',
      name: 'likes',
      component: LikesView,
      meta: {
        requiresSavedItems: true
      }
    },
    {
      path: '/trash',
      name: 'trash',
      component: TrashView,
      meta: {
        requiredCapability: 'canDeleteMedia'
      }
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
      meta: {
        requiredCapability: 'canAccessSettings'
      }
    },
    {
      path: '/moments/:id',
      name: 'moment',
      component: MomentView,
      props: true
    },
    {
      path: '/folders/:slug',
      alias: '/:slug',
      name: 'folder',
      component: FolderView,
      props: true
    }
  ],
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition;
    }

    if (shouldPreserveModalScroll(to, from)) {
      return false;
    }

    return { top: 0 };
  }
});

export function getRouteRequiredCapability(route: Pick<RouteLocationNormalized, 'meta'>): RouteCapability | null {
  const capability = route.meta.requiredCapability;
  return typeof capability === 'string' ? (capability as RouteCapability) : null;
}

export function routeRequiresSavedItems(route: Pick<RouteLocationNormalized, 'meta'>): boolean {
  return route.meta.requiresSavedItems === true;
}

export function canAccessRoute(route: Pick<RouteLocationNormalized, 'meta'>): boolean {
  const authStore = useAuthStore(pinia);
  const requiredCapability = getRouteRequiredCapability(route);

  if (requiredCapability) {
    return authStore.capabilities[requiredCapability];
  }

  if (routeRequiresSavedItems(route)) {
    return authStore.canUseSavedItems;
  }

  return true;
}

router.beforeEach((to) => {
  const authStore = useAuthStore(pinia);
  if (!authStore.ready) {
    return true;
  }

  return canAccessRoute(to) ? true : { name: 'home' };
});
