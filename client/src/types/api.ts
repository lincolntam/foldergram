export type FeedMode = 'recent' | 'rediscover' | 'random';
export type FeedRailKind = 'moments' | 'highlights';

export interface HomeFeedDefaultSetting {
  defaultMode: FeedMode;
}

export interface FeedItem {
  id: number;
  folderId: number;
  folderSlug: string;
  folderName: string;
  folderPath: string;
  folderBreadcrumb: string | null;
  filename: string;
  width: number;
  height: number;
  mediaType: 'image' | 'video';
  durationMs: number | null;
  isAnimated?: boolean | null;
  thumbnailUrl: string;
  previewUrl: string;
  sortTimestamp: number;
  takenAt: number | null;
}

export interface FolderSummary {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  folderPath: string;
  breadcrumb: string | null;
  imageCount: number;
  videoCount: number;
  latestImageMtimeMs: number | null;
  avatarImageId: number | null;
  avatarUrl: string | null;
}

export interface ImageExifData {
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  fNumber?: number;
  exposureTimeSeconds?: number;
  iso?: number;
  focalLengthMm?: number;
  focalLength35mmMm?: number;
  latitude?: number;
  longitude?: number;
  altitudeMeters?: number;
}

export interface PaginatedFeed {
  mode?: FeedMode;
  items: FeedItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface MomentCapsule {
  id: string;
  title: string;
  subtitle: string;
  dateContext: string;
  imageCount: number;
  coverImage: FeedItem;
}

export interface MomentsPayload {
  railKind: FeedRailKind;
  railTitle: string;
  railDescription: string;
  railSingularLabel: string;
  items: MomentCapsule[];
}

export interface MomentFeedPayload extends PaginatedFeed {
  railKind: FeedRailKind;
  railTitle: string;
  railDescription: string;
  railSingularLabel: string;
  moment: MomentCapsule;
}

export interface FolderImagesPayload extends PaginatedFeed {
  folder: FolderSummary;
}

export interface LikesPayload {
  items: FeedItem[];
}

export interface ImageDetail extends FeedItem {
  folderAvatarImageId: number | null;
  relativePath: string;
  mimeType: string;
  fileSize: number;
  exif: ImageExifData | null;
  originalUrl: string;
  playbackStrategy?: 'preview' | 'original' | null;
  nextImageId: number | null;
  previousImageId: number | null;
}

export interface TrashItem extends FeedItem {
  trashedAt: string | null;
}

export interface TrashImagesPayload {
  items: TrashItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface DeleteImageResult {
  id: number;
  folderSlug: string;
}

export type TrashImageResult = DeleteImageResult;
export type RestoreImageResult = DeleteImageResult;

export interface DeleteFolderResult {
  slug: string;
  deletedImageCount: number;
  deletedFolderCount: number;
  deletedSourceFolder: boolean;
}

export interface LikeMutationResult {
  id: number;
  liked: boolean;
  ok: boolean;
}

export interface ScanRunSummary {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  scanned_files: number;
  new_files: number;
  updated_files: number;
  removed_files: number;
  error_text: string | null;
}

export interface ScanProgress {
  isScanning: boolean;
  scanReason: string | null;
  phase: 'idle' | 'discovery' | 'derivatives';
  startedAt: string | null;
  runId: number | null;
  discoveredFolders: number;
  processedFolders: number;
  discoveredImages: number;
  processedImages: number;
  queuedDerivativeJobs: number;
  processedDerivativeJobs: number;
  generatedThumbnails: number;
  generatedPreviews: number;
  currentFolder: string | null;
  lastCompletedScan: ScanRunSummary | null;
}

export interface ManualScanResult {
  ok: boolean;
  lastScan: ScanRunSummary | null;
}

export interface RebuildLibraryResult {
  ok: boolean;
  lastScan: ScanRunSummary | null;
}

export interface RebuildThumbnailsResult {
  ok: boolean;
  lastScan: ScanRunSummary | null;
}

export interface AppStatus {
  folders: number;
  indexedImages: number;
  indexedVideos: number;
  scan: ScanProgress;
  storage: {
    available: boolean;
    reason: string | null;
  };
  libraryIndex: {
    rebuildRequired: boolean;
    reason: 'gallery_root_changed' | null;
    ignoredRootMediaCount: number;
  };
  preferences: {
    defaultHomeFeedMode: FeedMode;
  };
}

export interface AppStats extends AppStatus {
  deletedImages: number;
  thumbnailCount: number;
  previewCount: number;
  storage: AppStatus['storage'] & {
    usingInMemoryDatabase: boolean;
  };
  libraryIndex: AppStatus['libraryIndex'] & {
    currentGalleryRoot: string;
    previousGalleryRoot: string | null;
    lastSuccessfulGalleryRoot: string | null;
  };
  lastScan: ScanRunSummary | null;
}

export type AuthRole = 'admin' | 'viewer' | 'anonymous';
export type ViewerAccessMode = 'off' | 'password' | 'public';
export type LikesMode = 'shared' | 'local';

export interface AuthCapabilities {
  canManageLibrary: boolean;
  canDeleteMedia: boolean;
  canAccessSettings: boolean;
  canUseSharedLikes: boolean;
  canUseLocalFavorites: boolean;
}

export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
  role: AuthRole;
  accessMode: ViewerAccessMode;
  likesMode: LikesMode;
  capabilities: AuthCapabilities;
}

export interface AuthMutationResult {
  ok: boolean;
  auth: AuthStatus;
}
