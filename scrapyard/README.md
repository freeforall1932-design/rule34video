# Scrapyard — retired but retained code

Purpose: storage for dead code that was removed from the live extension but
kept because it may be useful again. Nothing in this folder is loaded,
referenced, or packaged. The shipped extension lives in
`rule34video downloader/` and is unaffected by anything here.

Created 2026-08-31 (session 6, same session as the purge): the purge deleted
this material outright; the owner asked for it to be retained in a scrapyard
folder instead, on the grounds that retired code (e.g. the multi-hoster
adapter, the DASH pipeline) can be worth something for future sites/formats.

## Rules

- Do not import or reference anything in `scrapyard/` from the extension.
- To revive a piece: move it back to its original path (see "Restore" column),
  then re-verify with `node tests/smoke.mjs` + the reachability check.
- `git log --follow scrapyard/<path>` shows full history.
- Everything here also exists verbatim in git history at commit `f1c5dcc`.

## Inventory

| Scrapyard path | Original path (restore there) | Bytes | Why retired | Why kept |
|---|---|---|---|---|
| `site-adapter.js` | `legacy/site-adapter.js` (was `rule34video downloader/site-adapter.js` before session 4) | 160,128 | Removed from the package in session 4 (multi-hoster generic detector; both target sites use dedicated resolvers) | Detects eporner, voe, streamtape, dood, nhplayer, xiaoshenke, byse/q8 and more — a starting point if support for other sites is ever added. Note: keeps internal `serp`-era identifiers; `background-enhanced.js` lines 9/1296/2229 still hold the `Rule34SiteAdapter` hook points it would plug into |
| `modules/mp4box.mjs` | `rule34video downloader/modules/mp4box.mjs` | 317,975 | Only imported by `dash2mp4/mp4merger.mjs` (retired) | MP4/ISOBMFF box parser — required by the DASH pipeline below |
| `modules/dash2mp4/` | `rule34video downloader/modules/dash2mp4/` | 15,732 | No inbound references from live code | DASH (fMP4 init+fragment) → MP4 merge pipeline — the non-HLS counterpart to the live hls2mp4 path; candidate for future sites serving DASH |
| `modules/reencoder/` | `rule34video downloader/modules/reencoder/` | 211,904 | Only imported by `dash2mp4/dash2mp4.mjs` (WebCodecs fallback) | WebCodecs WebM/MP4 re-encode pipeline (mp4-muxer, JsWebm demuxer, resamplers) — candidate for future transcode features |
| `modules/mediabunny/` | `rule34video downloader/modules/mediabunny/` | 815,905 | Zero references; TypeScript sources (needs a build step browsers don't have) | MPL-2.0 mux/demux library (ISOBMFF/Matroska/MP3/OGG/WAV) — modern alternative to mp4box if a build step is ever added |
| `modules/hls/Mp4Sample.mjs` | `rule34video downloader/modules/hls/Mp4Sample.mjs` | 370 | Only imported by `dash2mp4/mp4merger.mjs` | Required by the DASH pipeline |
| `modules/Localize.mjs` | `rule34video downloader/modules/Localize.mjs` | 1,215 | Only referenced by retired `AlertPolyfill` | i18n helper used by the scrapyard utils |
| `modules/utils/` (13 files) | `rule34video downloader/modules/utils/` | 54,197 | Unreachable; some import paths absent from this repo (`../enums/`, `../options/`, `../ui/`, `sweetalert.mjs`) | `BlobManager.mjs` is required by `reencoder/reencoder.mjs`; the rest are vendored helpers from the source project |
| `page-source/rule34video-listing.html` | `page source.txt` | 231,325 | Saved HTML dump | Session-3 reference: verified listing-card selectors, search form (`/search/`), preview-link shape |
| `page-source/rule34world-shell.html` | `page source for rule34 world` | 17,814 | Saved HTML dump | Session-3 reference: Angular shell (no SSR) — documents why world selectors need live verification |

Not restored (no unique content):
- `unified-app.config.json` — byte-identical to the kept
  `rule34video downloader/app.config.json` (verified with `cmp` at `f1c5dcc`).
- `modules/eventemitter/eventemitter.mjs` — byte-identical duplicate of the
  kept `rule34video downloader/modules/eventemitter.mjs`.

## Size accounting

- Scrapyard: 74 files, ~2.0 MB (repo-only; outside the extension folder).
- Shipped extension folder: unchanged at ~0.85 MB.
- Known caveats recorded before retention: 4 of the 13 scrapyard utils import
  missing paths (they were fragments in the source project); `mediabunny` is
  TypeScript needing a bundler; `dash2mp4` targets the pre-rewrite adapter
  era and will need adapting before use.
