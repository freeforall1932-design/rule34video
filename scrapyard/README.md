# Scrapyard — retired but retained code

Purpose: storage for dead code that was removed from the live extension but
kept because it may be useful again. Nothing in this folder is loaded,
referenced, or packaged. The shipped extension lives in
`rule34video downloader/` and is unaffected by anything here.

Created 2026-08-31 (session 6, same session as the purge): the purge deleted
this material outright; the owner asked for it to be retained in a scrapyard
folder instead, on the grounds that retired code (e.g. the multi-hoster
adapter, the DASH pipeline) can be worth something for future sites/formats.

**Reorganized 2026-08-31 (session 7):** the first version of this folder mixed
two different kinds of material — files that genuinely **were used as part of
the extension** and files that **never were** (source-project code and saved
reference material). They are now split into two subfolders:

- **`extension/`** — retired code that WAS used as extension files. These were
  loaded (or live-imported by loaded code) in some past version of the shipped
  extension. Reviving one means moving it back into `rule34video downloader/`
  (restore paths in the table below) and re-verifying.
- **`source/`** — files that were NEVER used as extension files: TypeScript
  library sources that browsers can't load unpackaged, source-project helper
  fragments whose import paths (`../enums/`, `../options/`, `../ui/`,
  `sweetalert.mjs`) don't exist in this repo, and saved page-source HTML dumps
  kept as reference. These are source code / reference material, not retired
  extension parts — reviving them means porting, not just moving.

## Rules

- Do not import or reference anything in `scrapyard/` from the extension.
- To revive an `extension/` piece: move it back to its original path (see
  "Restore" column), then re-verify with `node tests/smoke.mjs` + the
  reachability check.
- To reuse a `source/` piece: treat it as upstream source code — port it
  (build step, missing import paths, adaptation) rather than expecting it to
  load as-is.
- `git log --follow scrapyard/<path>` shows full history.
- Everything here also exists verbatim in git history at commit `f1c5dcc`.

---

## `extension/` — was used as extension files (13 files, ~708 KB)

Everything in this folder was part of the shipped extension's load graph at
some point. Intra-cluster imports resolve inside `extension/modules/`
(`mp4box.mjs`, `hls/Mp4Sample.mjs`, `utils/BlobManager.mjs`); three imports
(`../eventemitter.mjs`, `../FSBlob.mjs`, `../hls2mp4/MP4Generator.mjs`) point
at files that are still LIVE in `rule34video downloader/modules/`, so they
resolve again once the cluster is moved back.

| Scrapyard path | Original path (restore there) | Bytes | Why retired | Why kept |
|---|---|---|---|---|
| `extension/site-adapter.js` | `legacy/site-adapter.js` (was `rule34video downloader/site-adapter.js` before session 4) | 160,128 | Removed from the package in session 4 (multi-hoster generic detector; both target sites use dedicated resolvers) | Detects eporner, voe, streamtape, dood, nhplayer, xiaoshenke, byse/q8 and more — a starting point if support for other sites is ever added. Note: keeps internal `serp`-era identifiers; `background-enhanced.js` line 9 still holds the `Rule34SiteAdapter` hook point it would plug into |
| `extension/modules/mp4box.mjs` | `rule34video downloader/modules/mp4box.mjs` | 317,975 | Only imported by `dash2mp4/mp4merger.mjs` (retired) | MP4/ISOBMFF box parser — required by the DASH pipeline below |
| `extension/modules/dash2mp4/` | `rule34video downloader/modules/dash2mp4/` | 15,732 | No inbound references from live code | DASH (fMP4 init+fragment) → MP4 merge pipeline — the non-HLS counterpart to the live hls2mp4 path; candidate for future sites serving DASH |
| `extension/modules/hls/Mp4Sample.mjs` | `rule34video downloader/modules/hls/Mp4Sample.mjs` | 370 | Only imported by `dash2mp4/mp4merger.mjs` | Required by the DASH pipeline |
| `extension/modules/reencoder/` | `rule34video downloader/modules/reencoder/` | 211,904 | Only imported by `dash2mp4/dash2mp4.mjs` (WebCodecs fallback) | WebCodecs WebM/MP4 re-encode pipeline (mp4-muxer, JsWebm demuxer, resamplers) — candidate for future transcode features |
| `extension/modules/utils/BlobManager.mjs` | `rule34video downloader/modules/utils/BlobManager.mjs` | 1,942 | Only imported by `reencoder/reencoder.mjs` and `dash2mp4/mp4merger.mjs` (both retired) | Kept here (not in `source/`) because it was a **live import** in the retired extension pipeline — moving it back with the cluster keeps the import graph intact |

---

## `source/` — never used as extension files (61 files, ~1.12 MB)

Source code and reference material that shipped inside the repo's extension
folder but was never loadable/loaded by the extension. Do not revive by
copying into the extension; port it.

| Scrapyard path | Where it came from | Bytes | Notes |
|---|---|---|---|
| `source/modules/mediabunny/` (45 files: `LICENSE` + `src/**/*.ts`) | `rule34video downloader/modules/mediabunny/` | 815,905 | Zero references; TypeScript sources (needs a build step browsers don't have). MPL-2.0 mux/demux library (ISOBMFF/Matroska/MP3/OGG/WAV) — modern alternative to mp4box if a build step is ever added |
| `source/modules/Localize.mjs` | `rule34video downloader/modules/Localize.mjs` | 1,215 | i18n helper of the source-project utils; only referenced by the retired `AlertPolyfill` and never part of the reachable graph |
| `source/modules/utils/` (13 files) | `rule34video downloader/modules/utils/` | 53,255 | Source-project helper fragments: import `../enums/`, `../options/`, `../ui/`, `sweetalert.mjs` — paths absent from this repo, i.e. they would throw if ever loaded. `BlobManager.mjs` is NOT here (see `extension/modules/utils/`) |
| `source/page-source/rule34video-listing.html` | `page source.txt` | 231,325 | Session-3 reference: verified listing-card selectors, search form (`/search/`), preview-link shape |
| `source/page-source/rule34world-shell.html` | `page source for rule34 world` | 17,814 | Session-3 reference: Angular shell (no SSR) — documents why world selectors need live verification |

Not restored (no unique content):
- `unified-app.config.json` — byte-identical to the kept
  `tools/app.config.json` (verified with `cmp` at `f1c5dcc`; the kept copy
  moved to `tools/` in session 7).
- `modules/eventemitter/eventemitter.mjs` — byte-identical duplicate of the
  kept `rule34video downloader/modules/eventemitter.mjs`.

## Size accounting

- `extension/`: 13 files, ~0.7 MB — retired extension code.
- `source/`: 61 files, ~1.1 MB — source code + reference material.
- Scrapyard total: 74 files, ~1.8 MB (repo-only; outside the extension folder).
- Shipped extension folder: unchanged at ~0.85 MB.

## Known caveats

- The 13 source-project utils import missing paths (they were fragments in the
  source project); `mediabunny` is TypeScript needing a bundler; `dash2mp4`
  targets the pre-rewrite adapter era and will need adapting before use.
- The DASH cluster's three imports of still-live files
  (`eventemitter.mjs`, `FSBlob.mjs`, `hls2mp4/MP4Generator.mjs`) resolve only
  after the cluster is moved back into `rule34video downloader/modules/`.
