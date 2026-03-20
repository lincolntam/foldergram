---
title: Installation
description: Installation details, runtime expectations, and production build commands for Foldergram.
---

# Installation

## Recommended: Docker Compose

For most people, Docker Compose is the best way to install Foldergram.

It uses the pre-built container image and already includes the media tooling
needed for video support.

### 1. Create a working folder

Create a folder for Foldergram and move into it:

```bash
mkdir foldergram
cd foldergram
```

### 2. Create `docker-compose.yml`

Download the Compose file:

```bash
wget -O docker-compose.yml https://raw.githubusercontent.com/foldergram/foldergram/main/docker-compose.yml
```

### 3. Create your first gallery folder

Create a starter folder for your first indexed App Folder:

```bash
mkdir -p data/gallery/example-album
```

The layout should look like this:

```text
foldergram/
  docker-compose.yml
  data/
    gallery/
      example-album/
```

### 4. Add your media

Place photos and videos inside `data/gallery/example-album` or another folder
under `data/gallery`.

Foldergram ignores loose files placed directly in the gallery root, so use a
structure like this:

```text
data/
  gallery/
    trips/
      oslo/
        IMG_0001.jpg
        clip-01.mp4
    family/
      summer-2024/
        porch.webp
```

### 5. Start Foldergram

Run:

```bash
docker compose up -d
```

### 6. Open the app

Open:

- `http://localhost:4141`

For a quick backend check, you can also open:

- `http://localhost:4141/api/health`

The default Compose file uses the GHCR image and exposes `4141:4141`. If you
need a different host port, edit the left side of that mapping in
`docker-compose.yml`.

If the app will be reachable from other devices on your network, enable the
admin password from the Settings page after first startup. You can then keep
the app admin-only, add a separate viewer password, or switch to public browse
mode with admin unlock.

## If you already cloned this repository

This repository includes:

- `docker-compose.yml` for the GHCR image
- `docker-compose.local.yml` as a local-build override

From the repo root, run:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

This command uses the normal runtime settings, but builds the image locally
from the repository `Dockerfile`.

## Source install for development

Use the source install when you want to develop Foldergram itself.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

The shipped `.env.example` keeps the development ports aligned like this:

- `DEV_CLIENT_PORT=4141` with client fallback through `4144`
- `DEV_SERVER_PORT=4140`

## Runtime requirements for source installs

| Requirement | Why it matters |
| --- | --- |
| Node.js 22 | Used across the workspace and CI configuration. |
| `pnpm` | Matches the workspace scripts and lockfile. |
| Writable local storage | Foldergram creates and maintains the gallery, database, thumbnails, and previews directories. |
| FFmpeg and FFprobe | Needed only when you run the app outside Docker and want supported video processing. The backend calls `ffprobe` for metadata and `ffmpeg` for video thumbnails and previews. |

## Supported media

### Images

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.gif`

### Videos

- `.mp4`
- `.mov`
- `.m4v`
- `.webm`
- `.mkv`

## Default local paths

The shipped `.env.example` points at:

| Variable | Default |
| --- | --- |
| `DATA_ROOT` | `./data` |
| `GALLERY_ROOT` | `./data/gallery` |
| `DB_DIR` | `./data/db` |
| `THUMBNAILS_DIR` | `./data/thumbnails` |
| `PREVIEWS_DIR` | `./data/previews` |

Foldergram resolves relative paths from the repository root.

## Production behavior

### Docker

The Docker Compose install already runs the app in production mode.
The app inside the container listens on `4141` by default.

### Source

The production app build is split from the docs build:

```bash
pnpm build
pnpm start
```

`pnpm build` builds:

- `server`
- `client`

It does **not** build the docs site.

### How production serving works

When `NODE_ENV=production`, the Express app serves `client/dist` if it exists.
Requests that do not start with `/api`, `/thumbnails`, or `/previews` fall back
to the SPA entry point.

## Docs build

The VitePress site is built separately:

```bash
pnpm build:docs
```

The deploy workflow publishes `./docs/.vitepress/dist`.

## Optional developer entry points

```bash
pnpm dev:server
pnpm dev:client
pnpm dev:docs
```

## First-run behavior

On startup, the server checks storage availability and then decides whether to:

- queue a startup scan
- keep using the existing index
- block scanning until a library rebuild happens after a gallery root change

If the configured database directory is unavailable, Foldergram falls back to an
in-memory SQLite database. If the gallery, thumbnails, or previews directories
are unavailable, the library is reported as unavailable instead of serving stale
filesystem assumptions.
