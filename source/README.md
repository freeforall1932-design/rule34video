# Source — development code (everything that is not the shipped extension)

The repo root contains two code folders:

- **`extension/`** — the shipped MV3 extension (load this folder unpacked).
  Only runtime code lives there.
- **`source/`** — this folder: all development-use code, split by provenance:

| Path | What | Used as extension? | Revive by |
|---|---|---|---|
| `source/retired/` | Retired code that WAS part of the shipped extension (multi-hoster adapter, DASH/WebM pipeline) | **Yes, historically** | Moving back into `extension/` (restore paths below), then `node source/tests/smoke.mjs` + reachability check |
| `source/vendor/` | Never-used-as-extension source: mediabunny TS library, `Localize.mjs`, 13 source-project utils fragments | **No** | Porting — mediabunny needs a build step; the utils fragments import paths (`../enums/`, `../options/`, `../ui/`, `sweetalert.mjs`) that don't exist in this repo |
| `source/page-source/` | Saved page HTML dumps (rule34video listing, rule34.world shell) — session-3 reference material | No | N/A (reference only) |
| `source/tools/` | Dev tooling: `app.config.json` (generator provenance artifact, not runtime-loaded), `generate-icons.js` (Node icon generator → writes `extension/icons/`) | No | Run in place |
| `source/tests/` | The offline suites CI runs: `*.test.mjs` fixtures (folder naming, ZIP writer, PDF writer — `node --test`), `smoke.mjs` (real service worker under mocked chrome + fetch), `e2e-download-paths.mjs` (real worker + real offscreen document; asserts the saved paths), `helpers/` | No | Run in place |
| `source/docs/` | All project docs (`SESSION_HANDOFF.md` start here, `WORKLIST.md`, `IMPROVEMENT_LOG.md`, …) | No | N/A |

## Workflow

1. **Develop** in `source/` (or port from `source/retired` / `source/vendor`).
2. **Ship** the result into `extension/` — the extension folder is runtime-only.
3. **Debug** by reading the extension files, based on live-test findings.

## Rules

- Do not import or reference anything in `source/retired/`, `source/vendor/`
  or `source/page-source/` from the extension.
- To revive a `source/retired/` piece: move it back to its original path
  (restore column below), then re-verify with `node source/tests/smoke.mjs`
  + the reachability check.
- `git log --follow source/<path>` shows full history.
- Everything here also exists verbatim in git history at commit `f1c5dcc`.

## `source/retired/` — was used as extension files (13 files, ~708 KB)

Intra-cluster imports resolve inside `source/retired/modules/`; three imports
(`../eventemitter.mjs`, `../FSBlob.mjs`, `../hls2mp4/MP4Generator.mjs`) point
at files still LIVE in `extension/modules/`, so they resolve again once the
cluster is moved back.

| Retired path | Original path (restore there) | Bytes | Why retired | Why kept |
|---|---|---|---|---|
| `retired/site-adapter.js` | `legacy/site-adapter.js` (was `extension/site-adapter.js` before session 4) | 160,128 | Removed from the package in session 4 (multi-hoster generic detector; both target sites use dedicated resolvers) | Detects eporner, voe, streamtape, dood, nhplayer, xiaoshenke, byse/q8 and more — a starting point if support for other sites is ever added. Note: keeps internal `serp`-era identifiers; `extension/background-enhanced.js` line 9 still holds the `Rule34SiteAdapter` hook point it would plug into |
| `retired/modules/mp4box.mjs` | `extension/modules/mp4box.mjs` | 317,975 | Only imported by `dash2mp4/mp4merger.mjs` (retired) | MP4/ISOBMFF box parser — required by the DASH pipeline below |
| `retired/modules/dash2mp4/` | `extension/modules/dash2mp4/` | 15,732 | No inbound references from live code | DASH (fMP4 init+fragment) → MP4 merge pipeline — the non-HLS counterpart to the live hls2mp4 path; candidate for future sites serving DASH |
| `retired/modules/hls/Mp4Sample.mjs` | `extension/modules/hls/Mp4Sample.mjs` | 370 | Only imported by `dash2mp4/mp4merger.mjs` | Required by the DASH pipeline |
| `retired/modules/reencoder/` | `extension/modules/reencoder/` | 211,904 | Only imported by `dash2mp4/dash2mp4.mjs` (WebCodecs fallback) | WebCodecs WebM/MP4 re-encode pipeline (mp4-muxer, JsWebm demuxer, resamplers) — candidate for future transcode features |
| `retired/modules/utils/BlobManager.mjs` | `extension/modules/utils/BlobManager.mjs` | 1,942 | Only imported by `reencoder/reencoder.mjs` and `dash2mp4/mp4merger.mjs` (both retired) | Kept here (not in `vendor/`) because it was a **live import** in the retired extension pipeline — moving it back with the cluster keeps the import graph intact |

## `source/vendor/` — never used as extension files

| Path | Where it came from | Bytes | Notes |
|---|---|---|---|
| `vendor/mediabunny/` (45 files: `LICENSE` + `src/**/*.ts`) | `extension/modules/mediabunny/` | 815,905 | Zero references; TypeScript sources (needs a build step browsers don't have). MPL-2.0 mux/demux library (ISOBMFF/Matroska/MP3/OGG/WAV) — modern alternative to mp4box if a build step is ever added |
| `vendor/Localize.mjs` | `extension/modules/Localize.mjs` | 1,215 | i18n helper of the source-project utils; only referenced by the retired `AlertPolyfill` and never part of the reachable graph |
| `vendor/utils/` (13 files) | `extension/modules/utils/` | 53,255 | Source-project helper fragments: import `../enums/`, `../options/`, `../ui/`, `sweetalert.mjs` — paths absent from this repo, i.e. they would throw if ever loaded. `BlobManager.mjs` is NOT here (see `retired/modules/utils/`) |

Not retained (no unique content):
- `unified-app.config.json` — byte-identical to the kept
  `source/tools/app.config.json` (verified with `cmp` at `f1c5dcc`).
- `modules/eventemitter/eventemitter.mjs` — byte-identical duplicate of the
  kept `extension/modules/eventemitter.mjs`.

## `source/page-source/` — saved reference material

| Path | Where it came from | Bytes | Notes |
|---|---|---|---|
| `page-source/rule34video-listing.html` | `page source.txt` | 231,325 | Session-3 reference: verified listing-card selectors, search form (`/search/`), preview-link shape |
| `page-source/rule34world-shell.html` | `page source for rule34 world` | 17,814 | Session-3 reference: Angular shell (no SSR) — documents why world selectors need live verification |

## Size accounting

- `extension/`: ~0.85 MB shipped (runtime-only).
- `source/retired/`: 13 files, ~0.7 MB — retired extension code.
- `source/vendor/` + `source/page-source/`: 61 files, ~1.1 MB — never-used
  source + reference.

## Known caveats

- The 13 source-project utils fragments import missing paths (they were
  fragments in the source project); `mediabunny` is TypeScript needing a
  bundler; `dash2mp4` targets the pre-rewrite adapter era and will need
  adapting before use.
- The DASH cluster's three imports of still-live files
  (`eventemitter.mjs`, `FSBlob.mjs`, `hls2mp4/MP4Generator.mjs`) resolve only
  after the cluster is moved back into `extension/modules/`.

## History

- Session 6 (purge): this material was deleted, then restored into
  `scrapyard/` at the repo root.
- Session 7: `scrapyard/` split by provenance, then the whole repo
  restructured — the retired half became `source/retired/`, the never-used
  half became `source/vendor/` + `source/page-source/`. All moves are
  `git mv` renames; `git log --follow` keeps full history.
