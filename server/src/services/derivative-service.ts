import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import sharp from 'sharp';

import type { MediaType, PlaybackStrategy } from '../types/models.js';
import { appConfig } from '../config/env.js';
import { extractTakenAt, normalizeTakenAtValue } from '../utils/exif-utils.js';
import {
  PREVIEW_MAX_WIDTH,
  THUMBNAIL_SIZE,
  getMediaTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../utils/image-utils.js';
import { safeJoin } from '../utils/path-utils.js';

const execFileAsync = promisify(execFile);
const DIRECT_VIDEO_PLAYBACK_MAX_FILE_SIZE_BYTES = 24 * 1024 * 1024;
const DIRECT_VIDEO_PLAYBACK_ALLOWED_AUDIO_CODECS = new Set(['aac']);
const DIRECT_VIDEO_PLAYBACK_ALLOWED_PIXEL_FORMATS = new Set(['yuv420p']);

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  tags?: {
    creation_time?: string;
  };
}

interface FfprobeFormat {
  duration?: string;
  format_name?: string;
  tags?: {
    creation_time?: string;
  };
}

interface FfprobePayload {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

export interface MediaMetadata {
  width: number;
  height: number;
  takenAt: number | null;
  durationMs: number | null;
  mediaType: MediaType;
  playbackStrategy: PlaybackStrategy;
  isAnimated: boolean;
}

export interface DerivativeResult extends MediaMetadata {
  thumbnailPath: string;
  previewPath: string;
  generatedThumbnail: boolean;
  generatedPreview: boolean;
}

export interface ThumbnailDerivativeResult {
  thumbnailPath: string;
  generatedThumbnail: boolean;
}

interface ReadMediaMetadataOptions {
  fileSize?: number;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runBinary(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, {
    maxBuffer: 8 * 1024 * 1024
  });
}

async function readVideoProbe(sourcePath: string): Promise<FfprobePayload> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,format_name:format_tags=creation_time:stream=codec_type,codec_name,width,height,pix_fmt:stream_tags=creation_time',
      '-of',
      'json',
      sourcePath
    ],
    {
      maxBuffer: 2 * 1024 * 1024
    }
  );

  return JSON.parse(stdout) as FfprobePayload;
}

async function removeFileIfPresent(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function readImageMetadata(sourcePath: string): Promise<MediaMetadata> {
  const [metadata, takenAt] = await Promise.all([
    sharp(sourcePath, { animated: false }).metadata(),
    extractTakenAt(sourcePath)
  ]);

  return {
    width: metadata.width ?? THUMBNAIL_SIZE,
    height: metadata.height ?? THUMBNAIL_SIZE,
    takenAt,
    durationMs: null,
    mediaType: 'image',
    playbackStrategy: 'preview',
    isAnimated: (metadata.pages ?? 1) > 1
  };
}

async function resolveVideoPlaybackStrategy(
  sourcePath: string,
  payload: FfprobePayload,
  width: number,
  fileSize?: number
): Promise<PlaybackStrategy> {
  if (path.extname(sourcePath).toLowerCase() !== '.mp4') {
    return 'preview';
  }

  const videoStream = payload.streams?.find((stream) => stream.codec_type === 'video');
  const audioStream = payload.streams?.find((stream) => stream.codec_type === 'audio');
  const formatName = payload.format?.format_name?.toLowerCase() ?? '';
  const effectiveFileSize = typeof fileSize === 'number' ? fileSize : (await fs.stat(sourcePath)).size;

  if (!videoStream) {
    return 'preview';
  }

  const hasCompatibleContainer = formatName.includes('mp4');
  const hasCompatibleVideoCodec = videoStream.codec_name === 'h264';
  const hasCompatiblePixelFormat = DIRECT_VIDEO_PLAYBACK_ALLOWED_PIXEL_FORMATS.has(videoStream.pix_fmt ?? '');
  const hasCompatibleAudioCodec = !audioStream || DIRECT_VIDEO_PLAYBACK_ALLOWED_AUDIO_CODECS.has(audioStream.codec_name ?? '');
  const isWithinSizeBudget = effectiveFileSize <= DIRECT_VIDEO_PLAYBACK_MAX_FILE_SIZE_BYTES;
  const isWithinResolutionBudget = width > 0 && width <= PREVIEW_MAX_WIDTH;

  return hasCompatibleContainer &&
    hasCompatibleVideoCodec &&
    hasCompatiblePixelFormat &&
    hasCompatibleAudioCodec &&
    isWithinSizeBudget &&
    isWithinResolutionBudget
    ? 'original'
    : 'preview';
}

async function readVideoMetadata(sourcePath: string, options: ReadMediaMetadataOptions = {}): Promise<MediaMetadata> {
  const payload = await readVideoProbe(sourcePath);
  const videoStream = payload.streams?.find((stream) => stream.codec_type === 'video');
  const durationSeconds = payload.format?.duration ? Number.parseFloat(payload.format.duration) : Number.NaN;
  const durationMs = Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null;
  const takenAt = normalizeTakenAtValue(videoStream?.tags?.creation_time ?? payload.format?.tags?.creation_time ?? null);
  const playbackWidth = videoStream?.width ?? 0;
  const width = videoStream?.width ?? THUMBNAIL_SIZE;

  return {
    width,
    height: videoStream?.height ?? THUMBNAIL_SIZE,
    takenAt,
    durationMs,
    mediaType: 'video',
    playbackStrategy: await resolveVideoPlaybackStrategy(sourcePath, payload, playbackWidth, options.fileSize),
    isAnimated: false
  };
}

export async function readMediaMetadata(
  sourcePath: string,
  mediaType: MediaType,
  options: ReadMediaMetadataOptions = {}
): Promise<MediaMetadata> {
  return mediaType === 'video' ? readVideoMetadata(sourcePath, options) : readImageMetadata(sourcePath);
}

async function writeImageThumbnail(sourcePath: string, thumbnailAbsolutePath: string): Promise<void> {
  await ensureParentDirectory(thumbnailAbsolutePath);
  await sharp(sourcePath, { animated: false })
    .rotate()
    .resize({
      width: THUMBNAIL_SIZE,
      withoutEnlargement: true
    })
    .webp({ quality: 82, effort: 4 })
    .toFile(thumbnailAbsolutePath);
}

async function writeImagePreview(sourcePath: string, previewAbsolutePath: string): Promise<void> {
  await ensureParentDirectory(previewAbsolutePath);
  await sharp(sourcePath, { animated: true })
    .rotate()
    .resize({
      width: PREVIEW_MAX_WIDTH,
      withoutEnlargement: true
    })
    .webp({ quality: 86, effort: 4 })
    .toFile(previewAbsolutePath);
}

async function writeVideoThumbnail(sourcePath: string, thumbnailAbsolutePath: string): Promise<void> {
  await ensureParentDirectory(thumbnailAbsolutePath);
  await runBinary('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    sourcePath,
    '-vf',
    `thumbnail,scale='min(${THUMBNAIL_SIZE},iw)':-2:flags=lanczos`,
    '-frames:v',
    '1',
    '-c:v',
    'libwebp',
    '-quality',
    '82',
    '-compression_level',
    '4',
    thumbnailAbsolutePath
  ]);
}

async function writeVideoPreview(sourcePath: string, previewAbsolutePath: string): Promise<void> {
  await ensureParentDirectory(previewAbsolutePath);
  await runBinary('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    sourcePath,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-vf',
    `scale='min(${PREVIEW_MAX_WIDTH},iw)':-2:flags=lanczos`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    previewAbsolutePath
  ]);
}

async function generateImageDerivatives(
  sourcePath: string,
  thumbnailAbsolutePath: string,
  previewAbsolutePath: string,
  force: boolean
): Promise<Pick<DerivativeResult, 'generatedThumbnail' | 'generatedPreview'>> {
  const shouldWriteThumbnail = force || !(await fileExists(thumbnailAbsolutePath));
  const shouldWritePreview = force || !(await fileExists(previewAbsolutePath));

  if (shouldWriteThumbnail) {
    await writeImageThumbnail(sourcePath, thumbnailAbsolutePath);
  }

  if (shouldWritePreview) {
    await writeImagePreview(sourcePath, previewAbsolutePath);
  }

  return {
    generatedThumbnail: shouldWriteThumbnail,
    generatedPreview: shouldWritePreview
  };
}

async function generateVideoDerivatives(
  sourcePath: string,
  thumbnailAbsolutePath: string,
  previewAbsolutePath: string,
  playbackStrategy: PlaybackStrategy,
  force: boolean
): Promise<Pick<DerivativeResult, 'generatedThumbnail' | 'generatedPreview'>> {
  const shouldWriteThumbnail = force || !(await fileExists(thumbnailAbsolutePath));
  const shouldWritePreview = playbackStrategy === 'preview' && (force || !(await fileExists(previewAbsolutePath)));

  if (shouldWriteThumbnail) {
    await writeVideoThumbnail(sourcePath, thumbnailAbsolutePath);
  }

  if (playbackStrategy === 'original') {
    await removeFileIfPresent(previewAbsolutePath);
  }

  if (shouldWritePreview) {
    await writeVideoPreview(sourcePath, previewAbsolutePath);
  }

  return {
    generatedThumbnail: shouldWriteThumbnail,
    generatedPreview: shouldWritePreview
  };
}

export async function generateThumbnailDerivative(
  sourcePath: string,
  relativePath: string,
  force = false
): Promise<ThumbnailDerivativeResult> {
  const mediaType = getMediaTypeFromExtension(path.extname(relativePath));
  const thumbnailPath = getThumbnailRelativePath(relativePath);
  const thumbnailAbsolutePath = safeJoin(appConfig.thumbnailsDir, thumbnailPath);
  const shouldWriteThumbnail = force || !(await fileExists(thumbnailAbsolutePath));

  if (shouldWriteThumbnail) {
    if (mediaType === 'video') {
      await writeVideoThumbnail(sourcePath, thumbnailAbsolutePath);
    } else {
      await writeImageThumbnail(sourcePath, thumbnailAbsolutePath);
    }
  }

  return {
    thumbnailPath,
    generatedThumbnail: shouldWriteThumbnail
  };
}

export async function generateDerivatives(sourcePath: string, relativePath: string, force = false): Promise<DerivativeResult> {
  const mediaType = getMediaTypeFromExtension(path.extname(relativePath));
  const thumbnailPath = getThumbnailRelativePath(relativePath);
  const previewPath = getPreviewRelativePath(relativePath, mediaType);
  const thumbnailAbsolutePath = safeJoin(appConfig.thumbnailsDir, thumbnailPath);
  const previewAbsolutePath = safeJoin(appConfig.previewsDir, previewPath);
  const metadata = await readMediaMetadata(sourcePath, mediaType);
  const generated =
    mediaType === 'video'
      ? await generateVideoDerivatives(sourcePath, thumbnailAbsolutePath, previewAbsolutePath, metadata.playbackStrategy, force)
      : await generateImageDerivatives(sourcePath, thumbnailAbsolutePath, previewAbsolutePath, force);

  return {
    ...metadata,
    thumbnailPath,
    previewPath,
    generatedThumbnail: generated.generatedThumbnail,
    generatedPreview: generated.generatedPreview
  };
}
