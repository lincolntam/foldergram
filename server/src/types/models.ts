export type MediaType = 'image' | 'video';
export type TakenAtSource = 'exif' | 'mtime' | 'first_seen' | 'sort_timestamp';
export type PlaybackStrategy = 'preview' | 'original';

export interface FolderRecord {
  id: number;
  slug: string;
  name: string;
  folder_path: string;
  avatar_image_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface FolderSummaryRecord extends FolderRecord {
  image_count: number;
  video_count: number;
  latest_image_mtime_ms: number | null;
}

export interface ImageRecord {
  id: number;
  folder_id: number;
  filename: string;
  extension: string;
  relative_path: string;
  absolute_path: string;
  file_size: number;
  width: number;
  height: number;
  media_type: MediaType;
  mime_type: string;
  duration_ms: number | null;
  is_animated: number | null;
  checksum_or_fingerprint: string;
  mtime_ms: number;
  first_seen_at: string;
  sort_timestamp: number;
  taken_at: number | null;
  taken_at_source: TakenAtSource | null;
  thumbnail_path: string;
  preview_path: string;
  playback_strategy: PlaybackStrategy | null;
  is_deleted: number;
  is_trashed: number;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScanRunRecord {
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

export interface AppSettingRecord {
  key: string;
  value: string;
}

export interface FolderScanStateRecord {
  folder_path: string;
  signature: string;
  file_count: number;
  max_mtime_ms: number;
  total_size: number;
  updated_at: string;
}

export interface LikeRecord {
  image_id: number;
  created_at: string;
}

export interface FeedImage {
  id: number;
  folderId: number;
  folderSlug: string;
  folderName: string;
  folderPath: string;
  folderBreadcrumb?: string | null;
  filename: string;
  width: number;
  height: number;
  mediaType: MediaType;
  durationMs: number | null;
  isAnimated?: boolean | null;
  thumbnailUrl: string;
  previewUrl: string;
  sortTimestamp: number;
  takenAt: number | null;
}

export interface ImageDetail extends FeedImage {
  relativePath: string;
  mimeType: string;
  fileSize: number;
  originalUrl: string;
  nextImageId: number | null;
  previousImageId: number | null;
}

export interface TrashImage extends FeedImage {
  trashedAt: string | null;
}
