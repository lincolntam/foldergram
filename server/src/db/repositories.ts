import { databaseManager } from './database.js';
import { normalizePath } from '../utils/path-utils.js';
import type {
  AppSettingRecord,
  FeedImage,
  FolderAvatarSource,
  FolderScanStateRecord,
  ImageDetail,
  ImageRecord,
  LikeRecord,
  MediaType,
  PlaybackStrategy,
  FolderRecord,
  FolderSummaryRecord,
  ScanRunRecord,
  TrashImage,
  TakenAtSource
} from '../types/models.js';

const database = databaseManager.connection;
const EFFECTIVE_FEED_TIME_SQL = 'COALESCE(images.taken_at, images.sort_timestamp)';
const COVER_FILENAMES = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.gif'] as const;
const COVER_FILENAME_SQL = COVER_FILENAMES.map((name) => `'${name}'`).join(', ');
const VISIBLE_IMAGE_WHERE_SQL = `images.is_deleted = 0 AND images.is_trashed = 0 AND LOWER(images.filename) NOT IN (${COVER_FILENAME_SQL})`;
const VISIBLE_IMAGE_WHERE_UNSCOPED_SQL = `is_deleted = 0 AND is_trashed = 0 AND LOWER(filename) NOT IN (${COVER_FILENAME_SQL})`;
const IMAGE_FILENAME_SEARCH_SQL = 'LOWER(images.filename)';
const FOLDER_NAME_SEARCH_SQL = 'LOWER(folders.name)';
const FOLDER_SLUG_SEARCH_SQL = 'LOWER(folders.slug)';
const FOLDER_PATH_SEARCH_SQL = 'LOWER(folders.folder_path)';
const EXIF_CAMERA_MAKE_SEARCH_SQL =
  "LOWER(COALESCE(CASE WHEN json_valid(images.exif_json) THEN json_extract(images.exif_json, '$.cameraMake') END, ''))";
const EXIF_CAMERA_MODEL_SEARCH_SQL =
  "LOWER(COALESCE(CASE WHEN json_valid(images.exif_json) THEN json_extract(images.exif_json, '$.cameraModel') END, ''))";
const EXIF_LENS_MODEL_SEARCH_SQL =
  "LOWER(COALESCE(CASE WHEN json_valid(images.exif_json) THEN json_extract(images.exif_json, '$.lensModel') END, ''))";
const MEDIA_SEARCH_FIELD_SQL = [
  IMAGE_FILENAME_SEARCH_SQL,
  FOLDER_NAME_SEARCH_SQL,
  FOLDER_SLUG_SEARCH_SQL,
  FOLDER_PATH_SEARCH_SQL,
  EXIF_CAMERA_MAKE_SEARCH_SQL,
  EXIF_CAMERA_MODEL_SEARCH_SQL,
  EXIF_LENS_MODEL_SEARCH_SQL
] as const;
const FEED_IMAGE_SELECT_SQL = `
  SELECT
    images.id,
    images.folder_id AS folderId,
    folders.slug AS folderSlug,
    folders.name AS folderName,
    folders.folder_path AS folderPath,
    images.filename,
    images.width,
    images.height,
    images.media_type AS mediaType,
    images.duration_ms AS durationMs,
    images.is_animated AS isAnimated,
    images.thumbnail_path AS thumbnailUrl,
    images.preview_path AS previewUrl,
    images.playback_strategy AS playbackStrategy,
    images.sort_timestamp AS sortTimestamp,
    images.taken_at AS takenAt
  FROM images
  INNER JOIN folders ON folders.id = images.folder_id
`;

interface MediaSearchSql {
  whereSql: string;
  whereParams: string[];
  rankSql: string;
  rankParams: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function serializeAnimatedFlag(isAnimated: boolean | null | undefined): number {
  return isAnimated ? 1 : 0;
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function buildMediaSearchSql(query: string): MediaSearchSql | null {
  const normalizedQuery = normalizeSearchQuery(query);
  if (normalizedQuery.length === 0) {
    return null;
  }

  const normalizedTokens = [...new Set(normalizedQuery.split(' ').filter(Boolean))];
  const tokenClauseSql = `(${MEDIA_SEARCH_FIELD_SQL.map((fieldSql) => `${fieldSql} LIKE ? ESCAPE '\\'`).join(' OR ')})`;
  const whereSql = normalizedTokens.map(() => tokenClauseSql).join(' AND ');
  const whereParams = normalizedTokens.flatMap((token) =>
    MEDIA_SEARCH_FIELD_SQL.map(() => `%${escapeLikePattern(token)}%`)
  );
  const queryContainsPattern = `%${escapeLikePattern(normalizedQuery)}%`;
  const queryPrefixPattern = `${escapeLikePattern(normalizedQuery)}%`;

  const rankSqlParts = [
    `CASE
      WHEN ${IMAGE_FILENAME_SEARCH_SQL} = ? THEN 240
      WHEN ${IMAGE_FILENAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 180
      WHEN ${IMAGE_FILENAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 140
      ELSE 0
    END`,
    `CASE
      WHEN ${FOLDER_NAME_SEARCH_SQL} = ? THEN 120
      WHEN ${FOLDER_NAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 84
      WHEN ${FOLDER_NAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 56
      ELSE 0
    END`,
    `CASE
      WHEN ${FOLDER_SLUG_SEARCH_SQL} = ? THEN 76
      WHEN ${FOLDER_SLUG_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 52
      WHEN ${FOLDER_SLUG_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 36
      ELSE 0
    END`,
    `CASE WHEN ${FOLDER_PATH_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 32 ELSE 0 END`,
    `CASE WHEN ${EXIF_CAMERA_MAKE_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 20 ELSE 0 END`,
    `CASE WHEN ${EXIF_CAMERA_MODEL_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 20 ELSE 0 END`,
    `CASE WHEN ${EXIF_LENS_MODEL_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 18 ELSE 0 END`
  ];
  const rankParams: string[] = [
    normalizedQuery,
    queryPrefixPattern,
    queryContainsPattern,
    normalizedQuery,
    queryPrefixPattern,
    queryContainsPattern,
    normalizedQuery,
    queryPrefixPattern,
    queryContainsPattern,
    queryContainsPattern,
    queryContainsPattern,
    queryContainsPattern,
    queryContainsPattern
  ];

  for (const token of normalizedTokens) {
    const tokenPattern = `%${escapeLikePattern(token)}%`;
    rankSqlParts.push(
      `CASE WHEN ${IMAGE_FILENAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 18 ELSE 0 END`,
      `CASE WHEN ${FOLDER_NAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 12 ELSE 0 END`,
      `CASE WHEN ${FOLDER_SLUG_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 8 ELSE 0 END`,
      `CASE WHEN ${FOLDER_PATH_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 8 ELSE 0 END`,
      `CASE WHEN ${EXIF_CAMERA_MAKE_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END`,
      `CASE WHEN ${EXIF_CAMERA_MODEL_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END`,
      `CASE WHEN ${EXIF_LENS_MODEL_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END`
    );
    rankParams.push(
      tokenPattern,
      tokenPattern,
      tokenPattern,
      tokenPattern,
      tokenPattern,
      tokenPattern,
      tokenPattern
    );
  }

  return {
    whereSql,
    whereParams,
    rankSql: rankSqlParts.join(' + '),
    rankParams
  };
}

export interface UpsertFolderInput {
  slug: string;
  name: string;
  folderPath: string;
}

export interface SaveFolderResult {
  folder: FolderRecord;
  wrote: boolean;
}

export interface UpsertImageInput {
  folderId: number;
  filename: string;
  extension: string;
  relativePath: string;
  absolutePath: string;
  fileSize: number;
  width: number;
  height: number;
  mediaType: MediaType;
  mimeType: string;
  durationMs: number | null;
  isAnimated?: boolean | null;
  fingerprint: string;
  mtimeMs: number;
  firstSeenAt: string;
  sortTimestamp: number;
  takenAt: number;
  takenAtSource: TakenAtSource;
  exifJson: string | null;
  thumbnailPath: string;
  previewPath: string;
  playbackStrategy?: PlaybackStrategy | null;
}

export interface RefreshIndexedImageInput {
  folderId: number;
  filename: string;
  extension: string;
  relativePath: string;
  absolutePath: string;
  fileSize: number;
  width: number;
  height: number;
  mediaType: MediaType;
  mimeType: string;
  durationMs: number | null;
  isAnimated?: boolean | null;
  fingerprint: string;
  mtimeMs: number;
  takenAt: number;
  takenAtSource: TakenAtSource;
  exifJson: string | null;
  thumbnailPath: string;
  previewPath: string;
  playbackStrategy?: PlaybackStrategy | null;
}

export interface UpsertFolderScanStateInput {
  folderPath: string;
  signature: string;
  fileCount: number;
  maxMtimeMs: number;
  totalSize: number;
}

export const folderRepository = {
  getAll(): FolderRecord[] {
    return database.prepare('SELECT * FROM folders ORDER BY folder_path COLLATE NOCASE ASC').all() as unknown as FolderRecord[];
  },

  getAllSummaries(): FolderSummaryRecord[] {
    return database
      .prepare(
        `
        SELECT
          folders.*,
          COUNT(images.id) AS image_count,
          SUM(CASE WHEN images.media_type = 'video' THEN 1 ELSE 0 END) AS video_count,
          MAX(images.mtime_ms) AS latest_image_mtime_ms
        FROM folders
        INNER JOIN images ON images.folder_id = folders.id AND ${VISIBLE_IMAGE_WHERE_SQL}
        GROUP BY folders.id
        ORDER BY latest_image_mtime_ms DESC, folders.name COLLATE NOCASE ASC, folders.folder_path COLLATE NOCASE ASC
        `
      )
      .all() as unknown as FolderSummaryRecord[];
  },

  getBySlug(slug: string): FolderRecord | undefined {
    return database.prepare('SELECT * FROM folders WHERE slug = ?').get(slug) as FolderRecord | undefined;
  },

  getById(id: number): FolderRecord | undefined {
    return database.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRecord | undefined;
  },

  getByFolderPath(folderPath: string): FolderRecord | undefined {
    return database
      .prepare('SELECT * FROM folders WHERE folder_path = ?')
      .get(normalizePath(folderPath)) as FolderRecord | undefined;
  },

  getSummaryBySlug(slug: string): FolderSummaryRecord | undefined {
    return database
      .prepare(
        `
        SELECT
          folders.*,
          COUNT(images.id) AS image_count,
          SUM(CASE WHEN images.media_type = 'video' THEN 1 ELSE 0 END) AS video_count,
          MAX(images.mtime_ms) AS latest_image_mtime_ms
        FROM folders
        INNER JOIN images ON images.folder_id = folders.id AND ${VISIBLE_IMAGE_WHERE_SQL}
        WHERE folders.slug = ?
        GROUP BY folders.id
        `
      )
      .get(slug) as FolderSummaryRecord | undefined;
  },

  upsert(input: UpsertFolderInput): FolderRecord {
    const normalizedFolderPath = normalizePath(input.folderPath);
    database.prepare(
      `
      INSERT INTO folders (slug, name, folder_path, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(folder_path) DO UPDATE SET
        slug = excluded.slug,
        name = excluded.name,
        updated_at = excluded.updated_at
      `
    ).run(input.slug, input.name, normalizedFolderPath, nowIso());

    return this.getByFolderPath(normalizedFolderPath) as FolderRecord;
  },

  save(input: UpsertFolderInput): SaveFolderResult {
    const normalizedFolderPath = normalizePath(input.folderPath);
    const existing = this.getByFolderPath(normalizedFolderPath);
    if (existing && existing.slug === input.slug) {
      return {
        folder: existing,
        wrote: false
      };
    }

    if (existing) {
      database.prepare('UPDATE folders SET slug = ?, updated_at = ? WHERE id = ?').run(input.slug, nowIso(), existing.id);

      return {
        folder: this.getById(existing.id) as FolderRecord,
        wrote: true
      };
    }

    return {
      folder: this.upsert({
        ...input,
        folderPath: normalizedFolderPath
      }),
      wrote: true
    };
  },

  count(): number {
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM folders
            WHERE EXISTS (
              SELECT 1
              FROM images
              WHERE images.folder_id = folders.id AND images.is_deleted = 0 AND images.is_trashed = 0
            )
            `
          )
          .get() as { count: number }
      ).count
    );
  },

  setAvatar(folderId: number, imageId: number | null, source: FolderAvatarSource = 'auto'): void {
    database.prepare(
      'UPDATE folders SET avatar_image_id = ?, avatar_source = ?, updated_at = ? WHERE id = ? AND (avatar_image_id IS NOT ? OR avatar_source != ?)'
    ).run(
      imageId,
      source,
      nowIso(),
      folderId,
      imageId,
      source
    );
  },

  updateMetadata(slug: string, name: string, description: string | null): FolderRecord | undefined {
    database.prepare('UPDATE folders SET name = ?, description = ?, updated_at = ? WHERE slug = ?').run(
      name,
      description,
      nowIso(),
      slug
    );
    return this.getBySlug(slug);
  },

  delete(id: number): void {
    database.prepare('DELETE FROM folders WHERE id = ?').run(id);
  },

  resolveAvatarSelection(folderId: number): { imageId: number | null; source: FolderAvatarSource } | null {
    const folder = this.getById(folderId);
    if (!folder) {
      return null;
    }

    const explicitCoverImageId = imageRepository.getExplicitCoverImageId(folderId);
    if (explicitCoverImageId !== null) {
      return {
        imageId: explicitCoverImageId,
        source: 'cover'
      };
    }

    if (folder.avatar_source === 'manual' && folder.avatar_image_id !== null) {
      const manualImage = imageRepository.getById(folder.avatar_image_id);
      if (
        manualImage &&
        manualImage.folder_id === folderId &&
        manualImage.is_deleted === 0 &&
        manualImage.is_trashed === 0 &&
        manualImage.media_type === 'image'
      ) {
        return {
          imageId: manualImage.id,
          source: 'manual'
        };
      }
    }

    return {
      imageId: imageRepository.getLatestFolderImageId(folderId),
      source: 'auto'
    };
  },

  syncAvatarSelection(folderId: number): void {
    const nextSelection = this.resolveAvatarSelection(folderId);
    if (!nextSelection) {
      return;
    }

    this.setAvatar(folderId, nextSelection.imageId, nextSelection.source);
  }
};

export const imageRepository = {
  getByRelativePath(relativePath: string): ImageRecord | undefined {
    return database.prepare('SELECT * FROM images WHERE relative_path = ?').get(relativePath) as ImageRecord | undefined;
  },

  getById(id: number): ImageRecord | undefined {
    return database.prepare('SELECT * FROM images WHERE id = ?').get(id) as ImageRecord | undefined;
  },

  upsert(input: UpsertImageInput): ImageRecord {
    database.prepare(
      `
      INSERT INTO images (
        folder_id, filename, extension, relative_path, absolute_path, file_size, width, height,
        media_type, mime_type, duration_ms, is_animated, checksum_or_fingerprint, mtime_ms, first_seen_at, sort_timestamp, taken_at, taken_at_source, exif_json,
        thumbnail_path, preview_path, playback_strategy, is_deleted, is_trashed, trashed_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)
      ON CONFLICT(relative_path) DO UPDATE SET
        folder_id = excluded.folder_id,
        filename = excluded.filename,
        extension = excluded.extension,
        absolute_path = excluded.absolute_path,
        file_size = excluded.file_size,
        width = excluded.width,
        height = excluded.height,
        media_type = excluded.media_type,
        mime_type = excluded.mime_type,
        duration_ms = excluded.duration_ms,
        is_animated = excluded.is_animated,
        checksum_or_fingerprint = excluded.checksum_or_fingerprint,
        mtime_ms = excluded.mtime_ms,
        taken_at = excluded.taken_at,
        taken_at_source = excluded.taken_at_source,
        exif_json = excluded.exif_json,
        thumbnail_path = excluded.thumbnail_path,
        preview_path = excluded.preview_path,
        playback_strategy = excluded.playback_strategy,
        is_deleted = 0,
        updated_at = excluded.updated_at
      `
    ).run(
      input.folderId,
      input.filename,
      input.extension,
      input.relativePath,
      input.absolutePath,
      input.fileSize,
      input.width,
      input.height,
      input.mediaType,
      input.mimeType,
      input.durationMs,
      serializeAnimatedFlag(input.isAnimated),
      input.fingerprint,
      input.mtimeMs,
      input.firstSeenAt,
      input.sortTimestamp,
      input.takenAt,
      input.takenAtSource,
      input.exifJson,
      input.thumbnailPath,
      input.previewPath,
      input.playbackStrategy ?? 'preview',
      nowIso()
    );

    return this.getByRelativePath(input.relativePath) as ImageRecord;
  },

  refreshIndexed(input: RefreshIndexedImageInput): ImageRecord {
    database.prepare(
      `
      UPDATE images
      SET
        folder_id = ?,
        filename = ?,
        extension = ?,
        absolute_path = ?,
        file_size = ?,
        width = ?,
        height = ?,
        media_type = ?,
        mime_type = ?,
        duration_ms = ?,
        is_animated = ?,
        checksum_or_fingerprint = ?,
        mtime_ms = ?,
        taken_at = ?,
        taken_at_source = ?,
        exif_json = ?,
        thumbnail_path = ?,
        preview_path = ?,
        playback_strategy = ?,
        is_deleted = 0,
        updated_at = ?
      WHERE relative_path = ?
      `
    ).run(
      input.folderId,
      input.filename,
      input.extension,
      input.absolutePath,
      input.fileSize,
      input.width,
      input.height,
      input.mediaType,
      input.mimeType,
      input.durationMs,
      serializeAnimatedFlag(input.isAnimated),
      input.fingerprint,
      input.mtimeMs,
      input.takenAt,
      input.takenAtSource,
      input.exifJson,
      input.thumbnailPath,
      input.previewPath,
      input.playbackStrategy ?? 'preview',
      nowIso(),
      input.relativePath
    );

    return this.getByRelativePath(input.relativePath) as ImageRecord;
  },

  markDeleted(relativePath: string): void {
    database.prepare('UPDATE images SET is_deleted = 1, updated_at = ? WHERE relative_path = ?').run(nowIso(), relativePath);
  },

  markFolderImagesDeleted(folderId: number, activeRelativePaths: string[]): number {
    const rows = database.prepare('SELECT relative_path FROM images WHERE folder_id = ? AND is_deleted = 0').all(folderId) as Array<{ relative_path: string }>;
    const active = new Set(activeRelativePaths);
    let removedCount = 0;

    for (const row of rows) {
      if (!active.has(row.relative_path)) {
        this.markDeleted(row.relative_path);
        removedCount += 1;
      }
    }

    return removedCount;
  },

  markAllDeletedByFolder(folderId: number): number {
    const result = database.prepare('UPDATE images SET is_deleted = 1, updated_at = ? WHERE folder_id = ? AND is_deleted = 0').run(nowIso(), folderId);
    return Number(result.changes ?? 0);
  },

  reactivate(relativePath: string): void {
    database.prepare('UPDATE images SET is_deleted = 0, updated_at = ? WHERE relative_path = ?').run(nowIso(), relativePath);
  },

  moveToTrash(id: number, trashedAt = nowIso()): boolean {
    const result = database
      .prepare(
        `
        UPDATE images
        SET is_trashed = 1, trashed_at = ?, updated_at = ?
        WHERE id = ? AND is_deleted = 0 AND is_trashed = 0
        `
      )
      .run(trashedAt, nowIso(), id);
    return Number(result.changes ?? 0) > 0;
  },

  restoreFromTrash(id: number): boolean {
    const result = database
      .prepare(
        `
        UPDATE images
        SET is_trashed = 0, trashed_at = NULL, updated_at = ?
        WHERE id = ? AND is_deleted = 0 AND is_trashed = 1
        `
      )
      .run(nowIso(), id);
    return Number(result.changes ?? 0) > 0;
  },

  deleteById(id: number): boolean {
    const result = database.prepare('DELETE FROM images WHERE id = ?').run(id);
    return Number(result.changes ?? 0) > 0;
  },

  listFeed(page: number, limit: number): FeedImage[] {
    const offset = (page - 1) * limit;
    return database.prepare(
      `
      ${FEED_IMAGE_SELECT_SQL}
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
      ORDER BY images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(limit, offset) as unknown as FeedImage[];
  },

  countFeed(): number {
    return Number(
      (database.prepare(`SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL}`).get() as { count: number }).count
    );
  },

  countVisibleSearch(query: string): number {
    const mediaSearch = buildMediaSearchSql(query);
    if (!mediaSearch) {
      return 0;
    }

    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM images
            INNER JOIN folders ON folders.id = images.folder_id
            WHERE ${VISIBLE_IMAGE_WHERE_SQL} AND ${mediaSearch.whereSql}
            `
          )
          .get(...mediaSearch.whereParams) as { count: number }
      ).count
    );
  },

  listRecentCandidates(offset: number, limit: number): FeedImage[] {
    return database.prepare(
      `
      ${FEED_IMAGE_SELECT_SQL}
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
      ORDER BY ${EFFECTIVE_FEED_TIME_SQL} DESC, images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(limit, offset) as unknown as FeedImage[];
  },

  countRediscover(cutoffTimestamp: number): number {
    return Number(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} AND ${EFFECTIVE_FEED_TIME_SQL} <= ?`)
          .get(cutoffTimestamp) as { count: number }
      ).count
    );
  },

  listRediscoverCandidates(offset: number, limit: number, cutoffTimestamp: number): FeedImage[] {
    return database.prepare(
      `
      ${FEED_IMAGE_SELECT_SQL}
      LEFT JOIN likes ON likes.image_id = images.id
      WHERE ${VISIBLE_IMAGE_WHERE_SQL} AND ${EFFECTIVE_FEED_TIME_SQL} <= ?
      ORDER BY
        CASE WHEN likes.image_id IS NULL THEN 0 ELSE 1 END DESC,
        ${EFFECTIVE_FEED_TIME_SQL} DESC,
        images.sort_timestamp DESC,
        images.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(cutoffTimestamp, limit, offset) as unknown as FeedImage[];
  },

  listRandom(page: number, limit: number, seed: number): FeedImage[] {
    const offset = (page - 1) * limit;
    return database.prepare(
      `
      ${FEED_IMAGE_SELECT_SQL}
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
      ORDER BY ABS(((images.id * 1103515245) + (? * 1013904223)) % 2147483647), images.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(seed, limit, offset) as unknown as FeedImage[];
  },

  listVisibleSearch(query: string, page: number, limit: number): FeedImage[] {
    const mediaSearch = buildMediaSearchSql(query);
    if (!mediaSearch) {
      return [];
    }

    const offset = (page - 1) * limit;
    return database.prepare(
      `
      SELECT
        search_results.id,
        search_results.folderId,
        search_results.folderSlug,
        search_results.folderName,
        search_results.folderPath,
        search_results.filename,
        search_results.width,
        search_results.height,
        search_results.mediaType,
        search_results.durationMs,
        search_results.isAnimated,
        search_results.thumbnailUrl,
        search_results.previewUrl,
        search_results.playbackStrategy,
        search_results.sortTimestamp,
        search_results.takenAt
      FROM (
        SELECT
          images.id,
          images.folder_id AS folderId,
          folders.slug AS folderSlug,
          folders.name AS folderName,
          folders.folder_path AS folderPath,
          images.filename,
          images.width,
          images.height,
          images.media_type AS mediaType,
          images.duration_ms AS durationMs,
          images.is_animated AS isAnimated,
          images.thumbnail_path AS thumbnailUrl,
          images.preview_path AS previewUrl,
          images.playback_strategy AS playbackStrategy,
          images.sort_timestamp AS sortTimestamp,
          images.taken_at AS takenAt,
          (${mediaSearch.rankSql}) AS searchRank
        FROM images
        INNER JOIN folders ON folders.id = images.folder_id
        WHERE ${VISIBLE_IMAGE_WHERE_SQL} AND ${mediaSearch.whereSql}
      ) AS search_results
      ORDER BY search_results.searchRank DESC, search_results.sortTimestamp DESC, search_results.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(...mediaSearch.rankParams, ...mediaSearch.whereParams, limit, offset) as unknown as FeedImage[];
  },

  countByMonthDayKeys(monthDayKeys: string[], maxYearExclusive: number): number {
    if (monthDayKeys.length === 0) {
      return 0;
    }

    const placeholders = monthDayKeys.map(() => '?').join(', ');
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM images
            WHERE ${VISIBLE_IMAGE_WHERE_SQL}
              AND strftime('%m-%d', ${EFFECTIVE_FEED_TIME_SQL} / 1000, 'unixepoch', 'localtime') IN (${placeholders})
              AND CAST(strftime('%Y', ${EFFECTIVE_FEED_TIME_SQL} / 1000, 'unixepoch', 'localtime') AS INTEGER) < ?
            `
          )
          .get(...monthDayKeys, maxYearExclusive) as { count: number }
      ).count
    );
  },

  listByMonthDayKeys(monthDayKeys: string[], maxYearExclusive: number, page: number, limit: number): FeedImage[] {
    if (monthDayKeys.length === 0) {
      return [];
    }

    const offset = (page - 1) * limit;
    const placeholders = monthDayKeys.map(() => '?').join(', ');

    return database.prepare(
      `
      ${FEED_IMAGE_SELECT_SQL}
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
        AND strftime('%m-%d', ${EFFECTIVE_FEED_TIME_SQL} / 1000, 'unixepoch', 'localtime') IN (${placeholders})
        AND CAST(strftime('%Y', ${EFFECTIVE_FEED_TIME_SQL} / 1000, 'unixepoch', 'localtime') AS INTEGER) < ?
      ORDER BY ${EFFECTIVE_FEED_TIME_SQL} DESC, images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(...monthDayKeys, maxYearExclusive, limit, offset) as unknown as FeedImage[];
  },

  countByEffectiveTimeRange(startTimestamp: number, endTimestamp: number): number {
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM images
            WHERE ${VISIBLE_IMAGE_WHERE_SQL}
              AND ${EFFECTIVE_FEED_TIME_SQL} BETWEEN ? AND ?
            `
          )
          .get(startTimestamp, endTimestamp) as { count: number }
      ).count
    );
  },

  listByEffectiveTimeRange(startTimestamp: number, endTimestamp: number, page: number, limit: number): FeedImage[] {
    const offset = (page - 1) * limit;

    return database.prepare(
      `
      ${FEED_IMAGE_SELECT_SQL}
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
        AND ${EFFECTIVE_FEED_TIME_SQL} BETWEEN ? AND ?
      ORDER BY ${EFFECTIVE_FEED_TIME_SQL} DESC, images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(startTimestamp, endTimestamp, limit, offset) as unknown as FeedImage[];
  },

  listFolderImages(folderId: number, page: number, limit: number, mediaType?: MediaType): FeedImage[] {
    const offset = (page - 1) * limit;
    const mediaTypeClause = mediaType ? ' AND images.media_type = ?' : '';
    return database.prepare(
      `
      ${FEED_IMAGE_SELECT_SQL}
      WHERE images.folder_id = ? AND ${VISIBLE_IMAGE_WHERE_SQL}${mediaTypeClause}
      ORDER BY images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(...(mediaType ? [folderId, mediaType, limit, offset] : [folderId, limit, offset])) as unknown as FeedImage[];
  },

  listTrashed(page: number, limit: number): TrashImage[] {
    const offset = (page - 1) * limit;
    return database.prepare(
      `
      SELECT
        images.id,
        images.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        images.filename,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        images.sort_timestamp AS sortTimestamp,
        images.taken_at AS takenAt,
        images.trashed_at AS trashedAt
      FROM images
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE images.is_deleted = 0 AND images.is_trashed = 1
      ORDER BY images.trashed_at DESC, images.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(limit, offset) as unknown as TrashImage[];
  },

  countTrashed(): number {
    return Number(
      (database.prepare('SELECT COUNT(*) AS count FROM images WHERE is_deleted = 0 AND is_trashed = 1').get() as { count: number }).count
    );
  },

  countByFolder(folderId: number, mediaType?: MediaType): number {
    const mediaTypeClause = mediaType ? ' AND media_type = ?' : '';
    return Number(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND is_deleted = 0${mediaTypeClause}`)
          .get(...(mediaType ? [folderId, mediaType] : [folderId])) as { count: number }
      ).count
    );
  },

  countVisibleByFolder(folderId: number, mediaType?: MediaType): number {
    const mediaTypeClause = mediaType ? ' AND media_type = ?' : '';
    return Number(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL}${mediaTypeClause}`)
          .get(...(mediaType ? [folderId, mediaType] : [folderId])) as { count: number }
      ).count
    );
  },

  listActiveByFolder(folderId: number): ImageRecord[] {
    return database
      .prepare('SELECT * FROM images WHERE folder_id = ? AND is_deleted = 0 ORDER BY id ASC')
      .all(folderId) as unknown as ImageRecord[];
  },

  listActive(): ImageRecord[] {
    return database
      .prepare('SELECT * FROM images WHERE is_deleted = 0 ORDER BY folder_id ASC, sort_timestamp DESC, id DESC')
      .all() as unknown as ImageRecord[];
  },

  countMissingTimestampMetadataByFolder(folderId: number): number {
    return Number(
      (
        database
          .prepare(
            'SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND is_deleted = 0 AND (taken_at IS NULL OR taken_at_source IS NULL)'
          )
          .get(folderId) as { count: number }
      ).count
    );
  },

  countMissingPlaybackStrategyByFolder(folderId: number): number {
    return Number(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND is_deleted = 0 AND media_type = 'video' AND (playback_strategy IS NULL OR playback_strategy = '')"
          )
          .get(folderId) as { count: number }
      ).count
    );
  },

  countByTakenAtSource(source: TakenAtSource): number {
    return Number(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} AND taken_at_source = ?`)
          .get(source) as { count: number }
      ).count
    );
  },

  getLatestFolderImageId(folderId: number): number | null {
    const row = database.prepare(
      `SELECT id FROM images WHERE folder_id = ? AND ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} ORDER BY sort_timestamp DESC, id DESC LIMIT 1`
    ).get(folderId) as { id: number } | undefined;
    return row?.id ?? null;
  },

  getExplicitCoverImageId(folderId: number): number | null {
    const row = database.prepare(
      `
      SELECT id
      FROM images
      WHERE folder_id = ?
        AND is_deleted = 0
        AND is_trashed = 0
        AND LOWER(filename) IN (${COVER_FILENAME_SQL})
      ORDER BY
        CASE LOWER(filename)
          WHEN 'cover.jpg' THEN 1
          WHEN 'cover.jpeg' THEN 2
          WHEN 'cover.png' THEN 3
          WHEN 'cover.webp' THEN 4
          WHEN 'cover.gif' THEN 5
          ELSE 6
        END,
        id ASC
      LIMIT 1
      `
    ).get(folderId) as { id: number } | undefined;

    return row?.id ?? null;
  },

  getImageDetail(id: number, mediaType?: MediaType, allowHiddenCover = false): ImageDetail | undefined {
    const whereClause = allowHiddenCover ? 'images.is_deleted = 0 AND images.is_trashed = 0' : VISIBLE_IMAGE_WHERE_SQL;
    const detail = database.prepare(
      `
      SELECT
        images.id,
        images.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        folders.avatar_image_id AS folderAvatarImageId,
        images.filename,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.relative_path AS relativePath,
        images.mime_type AS mimeType,
        images.file_size AS fileSize,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        images.exif_json AS exifJson,
        images.absolute_path AS originalUrl,
        images.sort_timestamp AS sortTimestamp,
        images.taken_at AS takenAt
      FROM images
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE images.id = ? AND ${whereClause}
      `
    ).get(id) as (Omit<ImageDetail, 'nextImageId' | 'previousImageId' | 'exif'> & { originalUrl: string; exifJson: string | null }) | undefined;

    if (!detail || (mediaType && detail.mediaType !== mediaType)) {
      return undefined;
    }

    const mediaTypeClause = mediaType ? ' AND media_type = ?' : '';
    const next = database.prepare(
      `
      SELECT id
      FROM images
      WHERE folder_id = ? AND ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL}
        ${mediaTypeClause}
        AND (sort_timestamp < ? OR (sort_timestamp = ? AND id < ?))
      ORDER BY sort_timestamp DESC, id DESC
      LIMIT 1
      `
    ).get(...(mediaType
      ? [detail.folderId, mediaType, detail.sortTimestamp, detail.sortTimestamp, detail.id]
      : [detail.folderId, detail.sortTimestamp, detail.sortTimestamp, detail.id])) as { id: number } | undefined;

    const previous = database.prepare(
      `
      SELECT id
      FROM images
      WHERE folder_id = ? AND ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL}
        ${mediaTypeClause}
        AND (sort_timestamp > ? OR (sort_timestamp = ? AND id > ?))
      ORDER BY sort_timestamp ASC, id ASC
      LIMIT 1
      `
    ).get(...(mediaType
      ? [detail.folderId, mediaType, detail.sortTimestamp, detail.sortTimestamp, detail.id]
      : [detail.folderId, detail.sortTimestamp, detail.sortTimestamp, detail.id])) as { id: number } | undefined;

    return {
      ...detail,
      exif: null,
      nextImageId: next?.id ?? null,
      previousImageId: previous?.id ?? null
    };
  },

  countDeleted(): number {
    return Number((database.prepare('SELECT COUNT(*) AS count FROM images WHERE is_deleted = 1').get() as { count: number }).count);
  },

  countByMediaType(mediaType: MediaType): number {
    return Number(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} AND media_type = ?`)
          .get(mediaType) as { count: number }
      ).count
    );
  },

  countWithThumbnail(): number {
    return Number(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} AND thumbnail_path IS NOT NULL`)
          .get() as { count: number }
      ).count
    );
  },

  countWithPreview(): number {
    return Number(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} AND preview_path IS NOT NULL`)
          .get() as { count: number }
      ).count
    );
  },

  getByThumbnailPath(thumbnailPath: string): ImageRecord | undefined {
    return database.prepare('SELECT * FROM images WHERE thumbnail_path = ? AND is_deleted = 0 LIMIT 1').get(thumbnailPath) as ImageRecord | undefined;
  },

  getByPreviewPath(previewPath: string): ImageRecord | undefined {
    return database.prepare('SELECT * FROM images WHERE preview_path = ? AND is_deleted = 0 LIMIT 1').get(previewPath) as ImageRecord | undefined;
  }
};

export const likeRepository = {
  getByImageId(imageId: number): LikeRecord | undefined {
    return database.prepare('SELECT * FROM likes WHERE image_id = ?').get(imageId) as LikeRecord | undefined;
  },

  listLikedImages(): FeedImage[] {
    return database.prepare(
      `
      SELECT
        images.id,
        images.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        images.filename,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        images.sort_timestamp AS sortTimestamp,
        images.taken_at AS takenAt
      FROM likes
      INNER JOIN images ON images.id = likes.image_id
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
      ORDER BY likes.created_at DESC, likes.image_id DESC
      `
    ).all() as unknown as FeedImage[];
  },

  countLikedOlderThan(cutoffTimestamp: number): number {
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM likes
            INNER JOIN images ON images.id = likes.image_id
            WHERE ${VISIBLE_IMAGE_WHERE_SQL} AND ${EFFECTIVE_FEED_TIME_SQL} <= ?
            `
          )
          .get(cutoffTimestamp) as { count: number }
      ).count
    );
  },

  listLikedOlderThan(page: number, limit: number, cutoffTimestamp: number): FeedImage[] {
    const offset = (page - 1) * limit;

    return database.prepare(
      `
      SELECT
        images.id,
        images.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        images.filename,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        images.sort_timestamp AS sortTimestamp,
        images.taken_at AS takenAt
      FROM likes
      INNER JOIN images ON images.id = likes.image_id
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE ${VISIBLE_IMAGE_WHERE_SQL} AND ${EFFECTIVE_FEED_TIME_SQL} <= ?
      ORDER BY likes.created_at DESC, likes.image_id DESC
      LIMIT ? OFFSET ?
      `
    ).all(cutoffTimestamp, limit, offset) as unknown as FeedImage[];
  },

  upsert(imageId: number): LikeRecord {
    database.prepare(
      `
      INSERT INTO likes (image_id, created_at)
      VALUES (?, ?)
      ON CONFLICT(image_id) DO UPDATE SET
        created_at = excluded.created_at
      `
    ).run(imageId, nowIso());

    return this.getByImageId(imageId) as LikeRecord;
  },

  remove(imageId: number): boolean {
    const result = database.prepare('DELETE FROM likes WHERE image_id = ?').run(imageId);
    return Number(result.changes ?? 0) > 0;
  },

  removeByFolder(folderId: number): number {
    const result = database.prepare(
      'DELETE FROM likes WHERE image_id IN (SELECT id FROM images WHERE folder_id = ?)'
    ).run(folderId);
    return Number(result.changes ?? 0);
  }
};

export const appSettingsRepository = {
  get(key: string): string | null {
    const row = database.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as Pick<AppSettingRecord, 'value'> | undefined;
    return row?.value ?? null;
  },

  set(key: string, value: string): void {
    database
      .prepare(
        `
        INSERT INTO app_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `
      )
      .run(key, value);
  },

  remove(key: string): void {
    database.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  }
};

export const maintenanceRepository = {
  resetLibraryIndex(): void {
    database.exec(`
      BEGIN;
      UPDATE folders SET avatar_image_id = NULL;
      DELETE FROM likes;
      DELETE FROM images;
      DELETE FROM folders;
      DELETE FROM folder_scan_state;
      DELETE FROM scan_runs;
      DELETE FROM sqlite_sequence WHERE name IN ('folders', 'images', 'scan_runs');
      COMMIT;
    `);
  }
};

export const folderScanStateRepository = {
  getAll(): FolderScanStateRecord[] {
    return database.prepare('SELECT * FROM folder_scan_state ORDER BY folder_path ASC').all() as unknown as FolderScanStateRecord[];
  },

  upsert(input: UpsertFolderScanStateInput): void {
    const normalizedFolderPath = normalizePath(input.folderPath);
    database
      .prepare(
        `
        INSERT INTO folder_scan_state (folder_path, signature, file_count, max_mtime_ms, total_size, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(folder_path) DO UPDATE SET
          signature = excluded.signature,
          file_count = excluded.file_count,
          max_mtime_ms = excluded.max_mtime_ms,
          total_size = excluded.total_size,
          updated_at = excluded.updated_at
        `
      )
      .run(normalizedFolderPath, input.signature, input.fileCount, input.maxMtimeMs, input.totalSize, nowIso());
  },

  delete(folderPath: string): number {
    const result = database.prepare('DELETE FROM folder_scan_state WHERE folder_path = ?').run(normalizePath(folderPath));
    return Number(result.changes ?? 0);
  },

  deleteTree(folderPath: string): number {
    const normalizedFolderPath = normalizePath(folderPath);
    const result = database
      .prepare('DELETE FROM folder_scan_state WHERE folder_path = ? OR folder_path LIKE ?')
      .run(normalizedFolderPath, `${normalizedFolderPath}/%`);
    return Number(result.changes ?? 0);
  },

  deleteMissing(activeFolderPaths: string[]): number {
    if (activeFolderPaths.length === 0) {
      const result = database.prepare('DELETE FROM folder_scan_state').run();
      return Number(result.changes ?? 0);
    }

    const normalizedFolderPaths = activeFolderPaths.map((folderPath) => normalizePath(folderPath));
    const placeholders = normalizedFolderPaths.map(() => '?').join(', ');
    const statement = database.prepare(`DELETE FROM folder_scan_state WHERE folder_path NOT IN (${placeholders})`);
    const result = statement.run(...normalizedFolderPaths);
    return Number(result.changes ?? 0);
  }
};

export const scanRunRepository = {
  start(): number {
    const startedAt = nowIso();
    const result = database
      .prepare('INSERT INTO scan_runs (started_at, status, scanned_files, new_files, updated_files, removed_files) VALUES (?, ?, 0, 0, 0, 0)')
      .run(startedAt, 'running');

    return Number(result.lastInsertRowid);
  },

  finish(runId: number, input: Omit<ScanRunRecord, 'id' | 'started_at'>): void {
    database.prepare(
      `
      UPDATE scan_runs
      SET finished_at = ?, status = ?, scanned_files = ?, new_files = ?, updated_files = ?, removed_files = ?, error_text = ?
      WHERE id = ?
      `
    ).run(input.finished_at, input.status, input.scanned_files, input.new_files, input.updated_files, input.removed_files, input.error_text, runId);
  },

  latest(): ScanRunRecord | undefined {
    return database.prepare('SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1').get() as ScanRunRecord | undefined;
  },

  latestCompleted(): ScanRunRecord | undefined {
    return database
      .prepare('SELECT * FROM scan_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1')
      .get() as ScanRunRecord | undefined;
  }
};
