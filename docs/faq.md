---
title: FAQ
description: Short answers to common questions about Foldergram's actual scope and behavior.
---

# FAQ

## Is Foldergram a cloud product?

No. The current repository is designed for local-only, self-hosted use.

## Does it upload or sync my media anywhere?

No. Originals stay in the configured gallery root.

## Does it scan files directly during API requests?

No. Request handlers read from SQLite and derivative directories. Scanning is a
separate service.

## Are files in the gallery root indexed?

No. Foldergram ignores files placed directly in `GALLERY_ROOT`.

## Do nested folders merge into their parent album?

No. Nested folders become separate albums when they directly contain supported
media.

## Are likes shared with other users?

Admin and viewer sessions share SQLite likes for the current library.

Anonymous public sessions do not write to SQLite likes. They use browser-local
favorites only.

## Does Foldergram have authentication?

It has optional role-based password protection for the app instance.

The current implementation supports:

- an `admin` password with full access
- an optional `viewer` password with browse-only access and shared likes
- an optional `public` browse mode with anonymous local favorites and admin unlock

It still does **not** have per-user accounts or per-user data isolation.

## Why does the API call posts "images" in some fields?

That naming is historical. The current app indexes both images and videos, and
several payload fields still use `image` terminology while carrying mixed media.

## Can Foldergram play videos directly from the original file?

Yes, sometimes. Compatible MP4 files within the current playback budget can skip
preview transcoding and stream directly from `/api/originals/:id`.

## Why would I use thumbnail rebuild instead of full rebuild?

Use thumbnail rebuild when the index is still correct and you only want to
regenerate feed/profile thumbnails and video poster images. Use full rebuild
when the gallery root changed or the index itself needs to be reset.

## Is the local-origin mutation check the same as authentication?

No. It is a separate trust check for browser-triggered mutations.

Foldergram's optional admin/viewer/public access control is the auth layer; the
local-origin mutation check is an additional safeguard around mutating routes.

## Does the app support remote multi-user access?

Not as a documented or hardened product target in the current repository.

The intended scope is still a single-user or shared-household local deployment,
not a full multi-user media portal.

## Can anyone browse the app anonymously?

Yes, if an admin enables `viewer_access_mode=public` from Settings.

In that mode, visitors can browse immediately and keep favorites only in the
current browser. Admin-only controls still require unlocking with the admin
password.
