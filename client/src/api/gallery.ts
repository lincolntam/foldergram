import type {
  AppStatus,
  AppStats,
  AuthMutationResult,
  AuthStatus,
  HomeFeedDefaultSetting,
  ViewerAccessMode,
  DeleteImageResult,
  DeleteFolderResult,
  FeedMode,
  ImageDetail,
  LikeMutationResult,
  LikesPayload,
  ManualScanResult,
  MomentFeedPayload,
  MomentsPayload,
  PaginatedFeed,
  FolderImagesPayload,
  RestoreImageResult,
  RebuildLibraryResult,
  RebuildThumbnailsResult,
  FolderSummary,
  TrashImageResult,
  TrashImagesPayload
} from '../types/api';
import { requestJson } from './http';

export function fetchFeed(page = 1, limit = 24, mode: FeedMode = 'random', seed?: number) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    mode
  });

  if (typeof seed === 'number') {
    params.set('seed', String(seed));
  }

  return requestJson<PaginatedFeed>(`/api/feed?${params.toString()}`);
}

export function fetchMoments() {
  return requestJson<MomentsPayload>('/api/feed/moments');
}

export function fetchMomentFeed(id: string, page = 1, limit = 24) {
  return requestJson<MomentFeedPayload>(`/api/feed/moments/${encodeURIComponent(id)}?page=${page}&limit=${limit}`);
}

export async function fetchFolders() {
  const payload = await requestJson<{ items: FolderSummary[] }>('/api/folders');
  return payload.items;
}

export function fetchFolder(slug: string) {
  return requestJson<FolderSummary>(`/api/folders/${encodeURIComponent(slug)}`);
}

export function fetchFolderImages(slug: string, page = 1, limit = 24, mediaType?: 'image' | 'video') {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit)
  });

  if (mediaType) {
    params.set('mediaType', mediaType);
  }

  return requestJson<FolderImagesPayload>(`/api/folders/${encodeURIComponent(slug)}/images?${params.toString()}`);
}

export function updateFolderProfile(slug: string, name: string, description: string | null) {
  return requestJson<FolderSummary>(`/api/folders/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, description })
  });
}

export function setFolderCover(slug: string, imageId: number) {
  return requestJson<{ ok: boolean }>(`/api/folders/${encodeURIComponent(slug)}/cover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageId })
  });
}

export function fetchImage(id: number, mediaType?: 'image' | 'video') {
  const params = new URLSearchParams();
  if (mediaType) {
    params.set('mediaType', mediaType);
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestJson<ImageDetail>(`/api/images/${id}${suffix}`);
}

export function fetchLikes() {
  return requestJson<LikesPayload>('/api/likes');
}

export function fetchTrashImages(page = 1, limit = 24) {
  return requestJson<TrashImagesPayload>(`/api/trash/images?page=${page}&limit=${limit}`);
}

export function likeImage(id: number) {
  return requestJson<LikeMutationResult>(`/api/images/${id}/like`, {
    method: 'POST'
  });
}

export function unlikeImage(id: number) {
  return requestJson<LikeMutationResult>(`/api/images/${id}/like`, {
    method: 'DELETE'
  });
}

export function trashImage(id: number) {
  return requestJson<TrashImageResult>(`/api/images/${id}/trash`, {
    method: 'POST'
  });
}

export function restoreImage(id: number) {
  return requestJson<RestoreImageResult>(`/api/images/${id}/restore`, {
    method: 'POST'
  });
}

export function deleteImage(id: number) {
  return requestJson<DeleteImageResult>(`/api/images/${id}`, {
    method: 'DELETE'
  });
}

export function deleteFolder(slug: string, options: { deleteSourceFolder?: boolean } = {}) {
  const params = new URLSearchParams();
  if (options.deleteSourceFolder) {
    params.set('deleteSourceFolder', 'true');
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestJson<DeleteFolderResult>(`/api/folders/${encodeURIComponent(slug)}${suffix}`, {
    method: 'DELETE'
  });
}

export function fetchStats() {
  return requestJson<AppStatus>('/api/status');
}

export function fetchAdminStats() {
  return requestJson<AppStats>('/api/admin/stats');
}

export function fetchAuthStatus() {
  return requestJson<AuthStatus>('/api/auth/status');
}

export function loginWithPassword(password: string) {
  return requestJson<AuthMutationResult>('/api/auth/login', {
    body: JSON.stringify({ password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'POST'
  });
}

export function unlockAdmin(password: string) {
  return requestJson<AuthMutationResult>('/api/auth/unlock-admin', {
    body: JSON.stringify({ password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'POST'
  });
}

export function logout() {
  return requestJson<AuthMutationResult>('/api/auth/logout', {
    method: 'POST'
  });
}

export function enablePasswordProtection(password: string) {
  return requestJson<AuthMutationResult>('/api/auth/password', {
    body: JSON.stringify({ password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'PUT'
  });
}

export function changePasswordProtection(currentPassword: string, password: string) {
  return requestJson<AuthMutationResult>('/api/auth/password', {
    body: JSON.stringify({ currentPassword, password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'PUT'
  });
}

export function disablePasswordProtection(currentPassword: string) {
  return requestJson<AuthMutationResult>('/api/auth/password', {
    body: JSON.stringify({ currentPassword }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'DELETE'
  });
}

export function updateViewerAccess(mode: ViewerAccessMode, viewerPassword?: string) {
  return requestJson<AuthMutationResult>('/api/auth/viewer-access', {
    body: JSON.stringify({
      mode,
      viewerPassword
    }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'PUT'
  });
}

export function triggerManualScan() {
  return requestJson<ManualScanResult>('/api/admin/rescan', {
    method: 'POST'
  });
}

export function triggerLibraryRebuild() {
  return requestJson<RebuildLibraryResult>('/api/admin/rebuild-index', {
    method: 'POST'
  });
}

export function triggerThumbnailRebuild() {
  return requestJson<RebuildThumbnailsResult>('/api/admin/rebuild-thumbnails', {
    method: 'POST'
  });
}

export function updateHomeFeedDefault(defaultMode: FeedMode) {
  return requestJson<HomeFeedDefaultSetting>('/api/admin/settings/home-feed-default', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ defaultMode })
  });
}
