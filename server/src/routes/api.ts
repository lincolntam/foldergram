import express from 'express';
import { z } from 'zod';

import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH, authService } from '../services/auth-service.js';
import { galleryService } from '../services/gallery-service.js';
import { requireCapability } from '../middleware/auth-protection.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { LIBRARY_REBUILD_REQUIRED_MESSAGE, scannerService } from '../services/scanner-service.js';
import { storageService } from '../services/storage-service.js';
import { watcherService } from '../services/watcher-service.js';

const router = express.Router();

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24)
});
const mediaTypeQuerySchema = z.object({
  mediaType: z.enum(['image', 'video']).optional()
});
const deleteFolderQuerySchema = z.object({
  deleteSourceFolder: z.preprocess((value) => {
    if (value === undefined) {
      return false;
    }

    if (value === true || value === 'true') {
      return true;
    }

    if (value === false || value === 'false') {
      return false;
    }

    return value;
  }, z.boolean())
});
const feedQuerySchema = paginationQuerySchema.extend({
  mode: z.enum(['recent', 'rediscover', 'random']).default('random'),
  seed: z.coerce.number().int().nonnegative().optional()
});
const mediaSearchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(160)
});
const homeFeedDefaultBodySchema = z.object({
  defaultMode: z.enum(['recent', 'rediscover', 'random'])
});

const slugSchema = z.object({
  slug: z.string().min(1).max(240)
});
const momentIdSchema = z.object({
  id: z.string().min(1).max(120)
});

const imageIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const patchFolderBodySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(300).nullable().optional()
});

export const folderCoverBodySchema = z.object({
  imageId: z.coerce.number().int().positive()
});

const submittedPasswordSchema = z
  .string()
  .min(1, 'Password is required.')
  .max(AUTH_PASSWORD_MAX_LENGTH, `Password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`);
const submittedCurrentPasswordSchema = z
  .string()
  .min(1, 'Current password is required.')
  .max(AUTH_PASSWORD_MAX_LENGTH, `Current password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`);
const passwordFieldSchema = z
  .string()
  .min(AUTH_PASSWORD_MIN_LENGTH, `Password must be at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`)
  .max(AUTH_PASSWORD_MAX_LENGTH, `Password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`)
  .refine((value) => value.trim().length > 0, 'Password cannot be empty.');
const loginBodySchema = z.object({
  password: submittedPasswordSchema
});
const configurePasswordBodySchema = z.object({
  password: passwordFieldSchema
});
const changePasswordBodySchema = z.object({
  currentPassword: submittedCurrentPasswordSchema,
  password: passwordFieldSchema
});
const disablePasswordBodySchema = z.object({
  currentPassword: submittedCurrentPasswordSchema
});
const viewerAccessBodySchema = z
  .object({
    mode: z.enum(['off', 'password', 'public']),
    viewerPassword: passwordFieldSchema.optional()
  })
  .superRefine((body, context) => {
    if (body.mode === 'password' && !body.viewerPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Viewer password is required when viewer access mode is password.',
        path: ['viewerPassword']
      });
    }
  });

export const authRequestBodySchemas = {
  login: loginBodySchema,
  configurePassword: configurePasswordBodySchema,
  changePassword: changePasswordBodySchema,
  disablePassword: disablePasswordBodySchema,
  viewerAccess: viewerAccessBodySchema
};

export const settingsRequestBodySchemas = {
  homeFeedDefault: homeFeedDefaultBodySchema
};

const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts. Please try again in a minute.'
});

router.get('/health', (_request, response) => {
  const storageState = storageService.getState();
  response.json({
    ok: true,
    timestamp: new Date().toISOString(),
    storage: {
      available: storageState.libraryAvailable,
      reason: storageState.reason,
      usingInMemoryDatabase: storageState.usingInMemoryDatabase
    }
  });
});

router.get('/auth/status', (request, response) => {
  authService.setNoStoreHeaders(response);
  response.json(authService.getStatus(request));
});

router.post('/auth/login', authRateLimiter, (request, response) => {
  authService.setNoStoreHeaders(response);

  if (!authService.isEnabled()) {
    response.status(400).json({ message: 'Password protection is not enabled.' });
    return;
  }

  const body = loginBodySchema.parse(request.body);
  const role = authService.authenticatePassword(body.password);
  if (!role) {
    response.status(401).json({ message: 'Incorrect password.' });
    return;
  }

  authService.setAuthenticatedSession(response, request, role);
  response.json({
    ok: true,
    auth: authService.getAuthenticatedStatus(role)
  });
});

router.post('/auth/unlock-admin', authRateLimiter, (request, response) => {
  authService.setNoStoreHeaders(response);

  if (!authService.isEnabled()) {
    response.status(400).json({ message: 'Password protection is not enabled.' });
    return;
  }

  const body = loginBodySchema.parse(request.body);
  if (!authService.verifyAdminPassword(body.password)) {
    response.status(401).json({ message: 'Incorrect admin password.' });
    return;
  }

  authService.setAuthenticatedSession(response, request, 'admin');
  response.json({
    ok: true,
    auth: authService.getAuthenticatedStatus('admin')
  });
});

router.post('/auth/logout', (request, response) => {
  authService.setNoStoreHeaders(response);
  authService.clearAuthenticatedSession(response, request);
  response.json({
    ok: true,
    auth: authService.getLoggedOutStatus()
  });
});

router.put('/auth/password', authRateLimiter, (request, response) => {
  authService.setNoStoreHeaders(response);

  if (!authService.isEnabled()) {
    const body = configurePasswordBodySchema.parse(request.body);
    const auth = authService.setAdminPassword(body.password);
    authService.setAuthenticatedSession(response, request, 'admin');
    response.json({
      ok: true,
      auth
    });
    return;
  }

  if (!authService.hasCapability(request, 'canAccessSettings')) {
    response.status(403).json({ message: 'Admin access is required.' });
    return;
  }

  const body = changePasswordBodySchema.parse(request.body);
  if (!authService.verifyAdminPassword(body.currentPassword)) {
    response.status(401).json({ message: 'Incorrect current password.' });
    return;
  }

  const auth = authService.setAdminPassword(body.password);
  authService.setAuthenticatedSession(response, request, 'admin');
  response.json({
    ok: true,
    auth
  });
});

router.delete('/auth/password', authRateLimiter, (request, response) => {
  authService.setNoStoreHeaders(response);

  if (!authService.isEnabled()) {
    response.status(400).json({ message: 'Password protection is already disabled.' });
    return;
  }

  if (!authService.hasCapability(request, 'canAccessSettings')) {
    response.status(403).json({ message: 'Admin access is required.' });
    return;
  }

  const body = disablePasswordBodySchema.parse(request.body);
  if (!authService.verifyAdminPassword(body.currentPassword)) {
    response.status(401).json({ message: 'Incorrect current password.' });
    return;
  }

  const auth = authService.disable();
  authService.clearAuthenticatedSession(response, request);
  response.json({
    ok: true,
    auth
  });
});

router.put('/auth/viewer-access', authRateLimiter, (request, response) => {
  authService.setNoStoreHeaders(response);

  if (!authService.isEnabled()) {
    response.status(400).json({ message: 'Enable the admin password before configuring viewer access.' });
    return;
  }

  if (!authService.hasCapability(request, 'canAccessSettings')) {
    response.status(403).json({ message: 'Admin access is required.' });
    return;
  }

  const body = viewerAccessBodySchema.parse(request.body);
  const auth = authService.setViewerAccess(body.mode, body.viewerPassword ?? null);
  authService.setAuthenticatedSession(response, request, 'admin');
  response.json({
    ok: true,
    auth
  });
});

router.get('/feed', (request, response) => {
  const query = feedQuerySchema.parse(request.query);
  response.json(galleryService.getFeed(query.page, query.limit, query.mode, query.seed));
});

router.get('/feed/search', (request, response) => {
  const query = mediaSearchQuerySchema.parse(request.query);
  response.json(galleryService.searchMedia(query.q, query.page, query.limit));
});

router.get('/status', (_request, response) => {
  response.json(galleryService.getStatus());
});

router.put(
  '/admin/settings/home-feed-default',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  (request, response) => {
    const body = homeFeedDefaultBodySchema.parse(request.body);
    response.json(galleryService.setDefaultHomeFeedMode(body.defaultMode));
  }
);

router.get('/feed/moments', (_request, response) => {
  response.json(galleryService.listMoments());
});

router.get('/feed/moments/:id', (request, response) => {
  const params = momentIdSchema.parse(request.params);
  const query = paginationQuerySchema.parse(request.query);
  const payload = galleryService.getMomentFeed(params.id, query.page, query.limit);

  if (!payload) {
    response.status(404).json({ message: 'Feed capsule not found' });
    return;
  }

  response.json(payload);
});

router.get('/folders', (_request, response) => {
  response.json({
    items: galleryService.listFolders()
  });
});

router.get('/folders/:slug', (request, response) => {
  const params = slugSchema.parse(request.params);
  const folder = galleryService.getFolderBySlug(params.slug);

  if (!folder) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json(folder);
});

router.patch('/folders/:slug', requireCapability('canManageLibrary', 'Admin access is required.'), (request, response) => {
  const params = slugSchema.parse(request.params);
  const body = patchFolderBodySchema.parse(request.body);
  const updated = galleryService.updateFolderMetadata(params.slug, body.name, body.description ?? null);

  if (!updated) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json(updated);
});

router.post('/folders/:slug/cover', requireCapability('canManageLibrary', 'Admin access is required.'), (request, response) => {
  const params = slugSchema.parse(request.params);
  const body = folderCoverBodySchema.parse(request.body);
  const success = galleryService.setFolderAvatar(params.slug, body.imageId);

  if (!success) {
    response.status(404).json({ message: 'Folder or image not found' });
    return;
  }

  response.json({ ok: true });
});

router.delete('/folders/:slug', requireCapability('canDeleteMedia', 'Admin access is required.'), async (request, response) => {
  const params = slugSchema.parse(request.params);
  const query = deleteFolderQuerySchema.parse(request.query);
  const deleted = await galleryService.deleteFolder(params.slug, {
    deleteSourceFolder: query.deleteSourceFolder
  });

  if (!deleted) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json({
    ok: true,
    ...deleted
  });
});

router.get('/folders/:slug/images', (request, response) => {
  const params = slugSchema.parse(request.params);
  const query = paginationQuerySchema.merge(mediaTypeQuerySchema).parse(request.query);
  const payload = galleryService.getFolderImages(params.slug, query.page, query.limit, query.mediaType);

  if (!payload) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json(payload);
});

router.get('/likes', requireCapability('canUseSharedLikes', 'Authentication required.'), (_request, response) => {
  response.json(galleryService.getLikes());
});

router.get('/trash/images', requireCapability('canDeleteMedia', 'Admin access is required.'), (request, response) => {
  const query = paginationQuerySchema.parse(request.query);
  response.json(galleryService.getTrashImages(query.page, query.limit));
});

router.get('/images/:id', (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const query = mediaTypeQuerySchema.parse(request.query);
  const image = galleryService.getImageDetail(params.id, query.mediaType);

  if (!image) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json(image);
});

router.post('/images/:id/like', requireCapability('canUseSharedLikes', 'Authentication required.'), (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const payload = galleryService.likeImage(params.id);

  if (!payload) {
    response.status(404).json({ message: 'Image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.delete('/images/:id/like', requireCapability('canUseSharedLikes', 'Authentication required.'), (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const payload = galleryService.unlikeImage(params.id);

  if (!payload) {
    response.status(404).json({ message: 'Image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.post('/images/:id/trash', requireCapability('canDeleteMedia', 'Admin access is required.'), (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const payload = galleryService.trashImage(params.id);

  if (!payload) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.post('/images/:id/restore', requireCapability('canDeleteMedia', 'Admin access is required.'), (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const payload = galleryService.restoreImage(params.id);

  if (!payload) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.delete('/images/:id', requireCapability('canDeleteMedia', 'Admin access is required.'), async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const deleted = await galleryService.deleteImage(params.id);

  if (!deleted) {
    response.status(404).json({ message: 'Image not found' });
    return;
  }

  response.json({
    ok: true,
    ...deleted
  });
});

router.get('/originals/:id', (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const originalPath = galleryService.getOriginalImagePath(params.id);

  if (!originalPath) {
    response.status(404).json({ message: 'Original media not found' });
    return;
  }

  response.sendFile(originalPath);
});

const adminMutationRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many administrative requests. Please try again in a minute.'
});

const requireNoScanInProgress = (_request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (scannerService.getProgress().isScanning) {
    response.status(429).json({
      message: 'A scan or rebuild is already in progress.'
    });
    return;
  }
  next();
};

router.post(
  '/admin/rescan',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  adminMutationRateLimiter,
  requireNoScanInProgress,
  async (_request, response) => {
  try {
    if (scannerService.isLibraryRebuildRequired()) {
      response.status(409).json({
        message: LIBRARY_REBUILD_REQUIRED_MESSAGE
      });
      return;
    }

    const lastScan = await scannerService.scanAll('manual');
    await watcherService.start();
    response.json({
      ok: true,
      lastScan
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to run a manual scan.';
    const status = /rebuild required/i.test(message) ? 409 : 500;
    response.status(status).json({ message });
  }
});

router.post(
  '/admin/rebuild-index',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  adminMutationRateLimiter,
  requireNoScanInProgress,
  async (_request, response) => {
  await watcherService.stop();

  try {
    const lastScan = await scannerService.rebuildLibraryIndex('rebuild');
    response.json({
      ok: true,
      lastScan
    });
  } finally {
    await watcherService.start();
  }
});

router.post(
  '/admin/rebuild-thumbnails',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  adminMutationRateLimiter,
  requireNoScanInProgress,
  async (_request, response) => {
  if (scannerService.isLibraryRebuildRequired()) {
    response.status(409).json({
      message: LIBRARY_REBUILD_REQUIRED_MESSAGE
    });
    return;
  }

  await watcherService.stop();

  try {
    const lastScan = await scannerService.rebuildThumbnails('rebuild-thumbnails');
    response.json({
      ok: true,
      lastScan
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to regenerate thumbnails.';
    const status = /rebuild required/i.test(message) ? 409 : 500;
    response.status(status).json({ message });
  } finally {
    await watcherService.start();
  }
});

router.get('/admin/stats', requireCapability('canAccessSettings', 'Admin access is required.'), (_request, response) => {
  response.json(galleryService.getStats());
});

export { router as apiRouter };
