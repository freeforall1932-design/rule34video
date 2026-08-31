# Third-party licenses & attribution

This document records the third-party code shipped inside
`rule34video downloader/modules/`. The project itself is MIT
(see the top-level `LICENSE`); the items below are **vendored** and keep their
own licenses. No third-party **service / API / telemetry** dependency was found
in the extension — all network calls target rule34.world, rule34video.com,
their BunnyCDN file host, or `api.github.com` (update checker) only.

> Session 6 (2026-08-31) removed the vendored code the extension never loaded
> (`mediabunny/`, `mp4box.mjs`, `reencoder/`, `dash2mp4/`, orphaned `utils/`,
> duplicate `eventemitter/`). Their license notes were dropped accordingly —
> retrieve them from git history if ever reintroduced.

## hls.js (`modules/hls/hls.mjs`) — Apache-2.0 (upstream)

- Path: `rule34video downloader/modules/hls/hls.mjs` (~400 KB minified bundle).
- Upstream project: **hls.js** (https://github.com/video-dev/hls.js),
  licensed **Apache-2.0**. The minifier stripped the original header banner;
  upstream license text is not re-shipped inline — add it back if you
  redistribute outside this repo.
- Only the TS demuxer / AAC+MP3 demuxers / MP4 remuxers are used (imported by
  `modules/hls2mp4/transmuxer.mjs`) for HLS → MP4 remuxing in the offscreen
  document. The player side of hls.js (ABR/buffer/EME controllers) is inert in
  this bundle.

## hls2mp4 / transmuxer (FastStream-style transmux pipeline)

- Path: `rule34video downloader/modules/hls2mp4/`,
  `modules/hls/hls.mjs` (bundle), `modules/FSBlob.mjs`,
  `modules/network/IndexedDBManager.mjs`, `modules/eventemitter.mjs`,
  `modules/utils/EnvUtils.mjs`.
- These are vendored transmux helpers (comments reference the "FastStream"
  approach). **Status:** shipped unmodified. Upstream license should be
  confirmed before we modify them. Treat as "do not edit without verifying
  license" for now. If you modify, preserve original headers and add a clear
  change note.

## Rule of thumb for the community release

- The **extension is free, open, and MIT**.
- **Do not** silently relicense vendored third-party code.
- **Do not** add any closed/paid SDK, analytics beacon, or license-activation
  call home — that would break the "free for community" promise.
- Before modifying any vendored `modules/` file, confirm its license and keep
  the original header.
