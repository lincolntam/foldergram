---
layout: home
title: Foldergram
titleTemplate: false
hero:
  name: "Foldergram"
  text: "Local-first photo and video gallery for folders"
  tagline: Browse folders you already own through a fast feed-style interface backed by SQLite, generated thumbnails and previews, and a local-only runtime.
  image:
    src: /logo.svg
    alt: Foldergram Logo
  actions:
    - theme: brand
      text: Quick Start
      link: /quick-start
    - theme: alt
      text: How It Works
      link: /how-it-works
    - theme: alt
      text: Live Demo
      link: https://foldergram.intentdeep.com/
features:
  - title: Local-first
    details: Originals stay in your configured gallery root. Indexed metadata lives in SQLite and derivatives stay on disk next to the app's local storage paths.
  - title: Fast feed-style browsing
    details: Runtime reads come from SQLite and generated derivatives instead of filesystem walks during every request.
  - title: Photos and videos
    details: Foldergram indexes supported image and video formats, generates thumbnails, and creates previews or direct-playback links when videos already fit the playback budget.
  - title: Honest scope
    details: The current app includes feed browsing, explore, library, likes and favorites, moments, settings, optional admin/viewer/public access control, and local maintenance controls without cloud sync or social features.
---

## Foldergram at a Glance

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr)); gap: 1rem; margin: 2rem 0;">

<div class="cs-feature">
<h3>What ships today</h3>
<p>The current repository includes Home, Explore, Library, Likes and Favorites, Moments, Settings, folder pages, a post detail view and modal flow, shared SQLite likes, browser-local favorites in public mode, delete actions, optional admin/viewer/public access control, manual scans, full library rebuilds, and thumbnail-only rebuilds.</p>
</div>

<div class="cs-feature">
<h3>How indexing behaves</h3>
<p>Foldergram recursively discovers non-hidden folders under <code>GALLERY_ROOT</code>. Any folder that directly contains supported media becomes an indexed album. Files placed directly in the gallery root are ignored.</p>
</div>

<div class="cs-feature">
<h3>Supported formats</h3>
<p>Images: <code>.jpg</code>, <code>.jpeg</code>, <code>.png</code>, <code>.webp</code>, <code>.gif</code>. Videos: <code>.mp4</code>, <code>.mov</code>, <code>.m4v</code>, <code>.webm</code>, <code>.mkv</code>.</p>
</div>

<div class="cs-feature">
<h3>Storage model</h3>
<p>Originals remain in the gallery root. SQLite stores indexed metadata. Thumbnails are generated under <code>thumbnails/</code> and previews under <code>previews/</code>.</p>
</div>

</div>

## How Foldergram Works

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 1rem; margin: 2rem 0;">

<div class="cs-feature">
<h3>1. Discover folders</h3>
<p>Walk the gallery tree, skip hidden paths, and ignore managed storage paths that would otherwise re-enter the scan.</p>
</div>

<div class="cs-feature">
<h3>2. Index posts</h3>
<p>Store normalized paths, media metadata, timestamps, stable sort order, and playback strategy in SQLite.</p>
</div>

<div class="cs-feature">
<h3>3. Generate derivatives</h3>
<p>Create `640px` thumbnails and up to `1500px` previews, with direct-original playback for already compatible MP4 files.</p>
</div>

<div class="cs-feature">
<h3>4. Serve fast reads</h3>
<p>Feed, folders, likes, moments, and explore read from SQLite and derivative URLs instead of scanning the filesystem on request.</p>
</div>

<div class="cs-feature">
<h3>5. Build moments and highlights</h3>
<p>The home rail can surface date-based Moments when the library has enough EXIF-backed timestamps, or fall back to Highlights when capture-date coverage is sparse.</p>
</div>

<div class="cs-feature">
<h3>6. Maintain the library locally</h3>
<p>Settings includes optional admin/viewer/public access control plus manual scan, thumbnail rebuild, and full library rebuild actions so you can protect access and refresh the index without touching the source files by hand.</p>
</div>

</div>
