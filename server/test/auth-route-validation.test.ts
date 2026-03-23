import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ApiModule = typeof import('../src/routes/api.js');

describe.sequential('auth route validation', () => {
  let tempRoot = '';
  let authRequestBodySchemas: ApiModule['authRequestBodySchemas'];
  let settingsRequestBodySchemas: ApiModule['settingsRequestBodySchemas'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-auth-route-validation-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.resetModules();
    ({ authRequestBodySchemas, settingsRequestBodySchemas } = await import('../src/routes/api.js'));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('rejects oversized login passwords before hashing them', () => {
    expect(() =>
      authRequestBodySchemas.login.parse({
        password: 'x'.repeat(257)
      })
    ).toThrowError(/Password must be at most 256 characters\./);
  });

  it('rejects oversized current passwords on password-disable requests', () => {
    expect(() =>
      authRequestBodySchemas.disablePassword.parse({
        currentPassword: 'x'.repeat(257)
      })
    ).toThrowError(/Current password must be at most 256 characters\./);
  });

  it('requires a viewer password when viewer access mode is password', () => {
    expect(() =>
      authRequestBodySchemas.viewerAccess.parse({
        mode: 'password'
      })
    ).toThrowError(/Viewer password is required when viewer access mode is password\./);
  });

  it('accepts off mode without a viewer password', () => {
    expect(
      authRequestBodySchemas.viewerAccess.parse({
        mode: 'off'
      })
    ).toEqual({
      mode: 'off'
    });
  });

  it('accepts public mode without a viewer password', () => {
    expect(
      authRequestBodySchemas.viewerAccess.parse({
        mode: 'public'
      })
    ).toEqual({
      mode: 'public'
    });
  });

  it('rejects invalid home-feed default modes', () => {
    expect(() =>
      settingsRequestBodySchemas.homeFeedDefault.parse({
        defaultMode: 'latest'
      })
    ).toThrowError();
  });

  it('accepts random as a valid home-feed default mode', () => {
    expect(
      settingsRequestBodySchemas.homeFeedDefault.parse({
        defaultMode: 'random'
      })
    ).toEqual({
      defaultMode: 'random'
    });
  });
});
