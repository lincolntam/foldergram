---
title: Features
description: Verified product features and UI behaviors in the current Foldergram app.
---

# Features

This page documents what the current repository actually implements.

## Home

The home view is the primary feed surface.

It includes:

- three feed modes: Recent, Rediscover, and Random
- a top rail that can show Moments or Highlights
- a startup scan state when the first index is still being built
- a rebuild notice when the configured gallery root changed
- desktop recommendations for folders based on recency, likes, and recent navigation
- infinite loading for feed pagination

### Feed mode behavior

| Mode | What it does |
| --- | --- |
| Recent | "Newest posts first, with lighter runs from the same app folder." |
| Rediscover | "Older posts resurface when they are worth another look." |
| Random | "A fresh shuffle that stays steady while you browse." |

## Explore

Explore is a dedicated full-screen shell with a darker visual treatment.

It combines:

- a random feed source
- client-side ranking that boosts recent folder activity, liked folders, and recently opened folders
- folder search across name, slug, breadcrumb, and path
- local recent-search history stored in `localStorage`

Explore is a folder-search and serendipity surface, not a separate backend index.

## Library

Library lists every indexed folder and supports:

- free-text search
- sorting by recent activity, post count, name, or path
- quick navigation into folders
- delete actions from a context menu

### Folder deletion behavior

Library supports two delete flows:

| Flow | Behavior |
| --- | --- |
| Delete app folder | Deletes the folder's direct posts and their derivatives. Child app folders are kept. The source folder is only removed if it becomes empty. |
| Delete folder subtree | Removes the source folder subtree from disk, removes matching derivative subtrees, and deletes all affected indexed folders below that path. |

## Folder pages

A folder page is available at:

- `/folders/:slug`
- `/:slug` as an alias

Folder pages include:

- a folder header with avatar and counts
- a posts grid
- a reels tab when the folder contains videos
- infinite loading

The reels tab is a filtered view backed by the same folder endpoint using
`mediaType=video`.

## Post detail and modal flow

The post detail route is `/image/:id`.

Behavior depends on how the route is opened:

- from another page, it can render as a modal over the background route
- directly, it renders as a full page

The detail view includes:

- preview media
- previous and next navigation within the same folder and active media filter
- folder link and breadcrumb context
- size, dimensions, MIME type, and duration metadata
- like toggle
- original-file link
- delete action with confirmation for admin sessions only

## Likes and Favorites

Foldergram has two saved-items modes:

- signed-in `admin` and `viewer` sessions use shared SQLite likes through `GET /api/likes`
- anonymous public sessions use browser-local favorites stored in `localStorage`

The saved-items view:

- shows liked or favorited posts ordered by the most recent toggle in that mode
- updates optimistically in the UI
- drops deleted posts automatically when they are removed
- stays intentionally separate between shared likes and local favorites

There is no shared social layer behind either mode.

## Moments

The home rail and `/moments/:id` view expose either:

- date-driven Moments
- fallback Highlights

The selected rail depends on timestamp coverage in the current library. The UI
uses the same route name for both and adapts to the returned payload labels.

## Settings

Settings is the operational control surface for the library.

It exposes:

- admin-password controls
- viewer password and public access controls
- live scan status
- storage and index status
- last completed scan details
- manual scan
- thumbnail-only rebuild
- full library rebuild

### Access protection

Settings can optionally enable role-based local access for the app.

That flow supports:

- turning the admin password on
- changing the admin password
- disabling protection again
- enabling or disabling a separate viewer password
- enabling anonymous public browse mode
- rotating the viewer password without knowing the current one
- signing the current browser session out

Current non-admin behavior:

- viewers can browse the library and use shared likes
- anonymous public visitors can browse immediately and use browser-local favorites
- `viewer` and `anonymous` sessions can elevate through `Unlock admin`
- non-admin sessions cannot open Settings
- non-admin sessions cannot use Trash, delete actions, scans, or rebuild actions

### Rebuild actions

| Action | What changes |
| --- | --- |
| Scan Library | Runs a normal scan against the current gallery root. |
| Regenerate Thumbnails | Clears generated thumbnails and video poster images, then rebuilds them from indexed media only. |
| Rebuild Library | Clears indexed folders, posts, likes, folder scan state, and scan history, then rescans the active gallery root and reuses matching cached derivatives when possible. |

## Theme and local UI preferences

The client also persists a few local browser preferences:

- light or dark theme
- whether videos start muted
- last opened folder
- recently opened folders
- recent explore searches

These are stored in `localStorage` and are not synced anywhere else.

## What is intentionally missing

The current repository does **not** implement:

- uploads from the UI
- comments
- messaging
- notifications
- multi-user accounts
- remote multi-user permissions
- cloud sync
- hierarchical album navigation
