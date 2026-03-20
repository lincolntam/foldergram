---
title: Quick Start
description: Get Foldergram running locally with a real gallery structure and verified defaults.
---

# Quick Start

Docker Compose is the recommended way to run Foldergram.

It gives you the quickest path to a working install and includes the media
tooling needed for video support, so you do not need to set up Node.js,
`pnpm`, or `ffmpeg` on the host first.

## Preferred: Docker Compose

## 1. Create your local data layout

```text
data/
  gallery/
  db/
  thumbnails/
  previews/
```

## 2. Put media into folders under `data/gallery`

Foldergram does not index loose files placed directly in the gallery root.

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

The important rule is simple:

- A non-hidden folder becomes an indexed album only when it directly contains supported media.
- Nested folders become separate albums if they directly contain media.

## 3. Start the container

```bash
docker compose up -d
```

The included compose file:

- uses the GHCR image by default
- maps host port `4141` by default
- mounts `./data/gallery`, `./data/db`, `./data/thumbnails`, and `./data/previews`
- runs the app in production mode
- uses internal container paths under `/app/data`
- relies on the image's bundled `ffmpeg`

If you cloned the repo and want to build locally instead, use:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

## 4. Open the app

- `http://localhost:4141` for the app
- `http://localhost:4141/api/health` for a quick backend check

On first run, the server performs a startup scan when there is no existing index.

If you plan to expose Foldergram on a homelab or LAN, open Settings after the
first load and enable the admin password. From there, you can keep admin-only
access, add a separate viewer password, or switch to public browse mode.

## Optional: run from source for development

Foldergram is a `pnpm` workspace monorepo with three workspaces:

- `server`
- `client`
- `docs`

Use the source workflow when you want to develop or modify the app itself.

### Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js 22 | The repo is configured for Node 22. |
| `pnpm` | Matches the workspace scripts and lockfile. |
| FFmpeg and FFprobe | Required on the host if you run the app outside Docker and want video support. |

### Development startup

```bash
pnpm install
cp .env.example .env
pnpm dev
```

This runs:

- the Vite client on `http://localhost:4141`, with automatic fallback through `4144`
- the Express server on `http://localhost:4140`
- the VitePress docs site on `http://localhost:4145`, with automatic fallback to the next free port

## Useful commands

```bash
docker compose up -d
docker compose down
pnpm rescan
pnpm test
pnpm build
pnpm start
pnpm build:docs
```

## What to expect after startup

- Feed, folder pages, likes, explore, and moments read from SQLite, not directly from disk.
- Thumbnails are generated under `data/thumbnails`.
- Previews are generated under `data/previews`.
- Settings exposes admin/viewer access controls, manual scan, thumbnail rebuild, and full library rebuild actions.

If nothing appears, start with [Troubleshooting](/troubleshooting).
