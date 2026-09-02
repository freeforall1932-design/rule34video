# Improvement Log — Rule34 Downloader

Date: 2026-08-29 (Asia/Jakarta)

This log records changes made while rebranding the extension into a free,
community **Rule34 Downloader** for both `rule34.world` and `rule34video.com`.

## Phase 1 — Remove paywall / third-party auth

- Deleted `auth.js`, `auth-ui.js`, `trial-banner.js` and the whole `auth/`
  module (`auth-api.js`, `auth-config.js`, `auth-storage.js`,
  `auth-telemetry.js`, `auth-token.js`).
- Removed `auth.serp.co` host permission from `manifest.json`.
- Removed the `serp.ly` / license / activation UI from the popup and the
  `isActivated` gating from `player-button.js` and `background-enhanced.js`.
- Removed `auth.serp.co` / `serp.ly` entries from `offscreen.js` origin ignore list.
- Removed activation + trial-banner + buy-key CSS and `activationTitle` config.

## Phase 2 — Configurable concurrency (replaces fixed 3-download trial)

- Added storage key `downloadConcurrencyLimit` (default `0` = Unlimited, max 99).
- Added a background download queue that starts extra requests automatically as
  slots free (on download `complete` / `interrupted`).
- Added popup slider (0–10) **and** numeric input (up to 99), live queue status
  (`N active • M queued`), and "Unlimited" when the value is 0/empty.

## Phase 3 — Dual-site support + post resolvers

- Repointed the update checker to `freeforall1932-design/rule34video` (GitHub releases).
- Added rule34video.com post-page resolver (signed `get_file` MP4 links, prefers
  `download=true` download-tab links, skips previews).
- Added rule34.world `/api/v2/post/{id}` resolver (CDN file URL construction,
  artist + filename title, thumbnail).
- Wired the resolver into `getVideoFormats()` as a fast path.
- `downloadVideo()` now derives the extension from the selected format
  (images save as `.jpg`), and supports `skipFormatRefresh`.

## Phase 4 — Batch fetch + batch download

- Added batch backend: `enqueueBatchDownloads` + `processBatchQueue` +
  per-post `batchPostStatus` streaming to the tab.
- Batch respects the user concurrency limit and sends `skipFormatRefresh: true`
  to preserve signed rule34video links.
- Added `batchDownloadPosts` background message handler.

## Phase 5 — Per-card action-bar buttons + visible-batch toolbar

- New `post-actions.js` content script:
  - corner `↓` download button on every supported post card (MutationObserver
    keeps up with infinite scroll + Angular re-renders);
  - floating "Download visible (N)" toolbar;
  - toast notifications for queued/downloading/failed;
  - single-post-page fallback.
- Registered `post-actions.js` in `manifest.json`.

## Phase 6 — Docs

- Created `docs/SESSION_HANDOFF.md`, `docs/IMPROVEMENT_LOG.md`, `docs/WORKLIST.md`.

## Session 2 — re-sync, full review, bug fixes (2026-08-29)

Context: the previous session's work was confirmed merged via **PR #1**
(`42cc212`, merge commit) — the "no PR / no merge" report was a stale-checkout
artifact. This session re-fetched, reset to `origin/main`, audited the whole
extension (architecture + end-to-end message/handler wiring), and fixed two
real logic bugs:

- **Popup fallback resolver (popup.js).** The popup hard-required the content
  script's `getVideoInfo` to succeed before it ever called the background
  `getVideoFormats`. On rule34.world (Angular shell; no media in static DOM)
  and lazy rule34video players that step failed, so the popup showed
  "No video found" and the reliable background post-resolver was never reached.
  Added `supportedPostUrl()` + `fallbackVideoInfoForTab(tab)`: when content-side
  extraction fails on a supported rule34 post URL, the popup builds a minimal
  record keyed on the tab URL and proceeds to format loading; the background
  resolver returns the formats plus `apiTitle`/`apiThumbnail`. The per-card
  corner buttons were already independent and unaffected.
- **Image downloads routed correctly (background-enhanced.js).** rule34.world
  image posts (`format_type: "image"`, cross-origin BunnyCDN) were being sent
  into the offscreen **MP4** pipeline by `shouldUseOffscreenMp4` via the
  cross-origin-referer check. It now returns `false` for image formats / image
  extensions, so image posts take the direct Chrome download path.
- Bumped `manifest.json` `4.1.0 → 4.1.1`.
- Re-validated: all JS `node --check` (bg as ESM), all JSON parse, and the
  paywall/auth remnant grep is empty.
- Confirmed PR #1 already removed the `popup.html` references to deleted
  `auth-ui.js` / `trial-banner.js` (no dangling `<script>` tags remain).
- Refreshed `docs/SESSION_HANDOFF.md`, `docs/IMPROVEMENT_LOG.md`, `docs/WORKLIST.md`.

## Session 3 — codebase review + missing logic (2026-08-30)

Full review of every extension surface (message/handler audit + live checks
of both target sites from the sandbox). Findings & fixes:

### CRITICAL — rule34.world file CDN is down (verified live)
- `rule34storage.b-cdn.net` returns **HTTP 500 for every sampled post**
  (old + new, image + video) while the `rule34.world` origin serves the same
  files fine. The post API still claims the CDN (`files: { "10": [2], ... }`),
  so the previous resolver built **broken CDN URLs for 100% of posts**.
- **Fix (background-enhanced.js):** both file roots are now probed once per
  session (HEAD, falling back to `GET Range: bytes=0-0`, 10-minute TTL,
  sampled on one real file of the post). Formats are built on the healthy
  root; each format also carries a `fallbackUrl` on the other root (only when
  that root probed healthy, so we never retry into a known-dead host).
- **Fix (fallback retry):** every chrome download started from a
  rule34.world format remembers its resolved format; if Chrome reports the
  download `interrupted` (and the user did NOT cancel it), the download is
  cancelled and restarted once on the `fallbackUrl` ("Download restarted"
  notification). User cancellations are tracked and never auto-retried.

### Verified live (no code change needed)
- rule34world API shape: `files` map `id -> [flag]`, flag[0] truthy = CDN
  root; video posts `type: 1` + `duration`; image posts `type: 0`; artist
  tag `type === 8`; single-post API has **no `filename` field** (resolver
  already fell back to `post {id}`). Confirmed against
  `gallery-dl`'s `rule34xyz` extractor (formats `100/101/102/10`,
  `{root}/posts/{id//1000}/{id}/{id}.{ext}`) — the existing resolver
  matches it exactly.
- rule34video.com post pages: `download=true` signed `get_file` links present
  for 1080/720/480/360p (360p is `_360.mp4` without the `p` suffix — the
  regex already handles it); `rnd=` param is a "now" timestamp, i.e. signed
  links are fresh per page load (expiry risk for long queues — see below).
- rule34video.com listing cards: `a.th.js-open-popup` inside
  `div.item.thumb[data-video-card-id]` with `div.img.wrap_image` — the
  `post-actions.js` pinning selector is correct for rule34video.com.
- Listing pages carry **only** `_preview.mp4` links (0 `download=true`) —
  per-post resolution in batch mode is required and correct.

### Missing logic implemented
- **Persistent session queue (explicit user request).** `downloadQueue`,
  `batchPending` and the in-flight `activeQueueJobs` are now mirrored to
  `chrome.storage.local` (`r34.queueState.v1`) on every mutation (250ms
  debounce), flushed on `chrome.runtime.onSuspend`, and restored on
  service-worker startup (stale >3h entries dropped; chrome-managed
  downloads re-verified via `chrome.downloads.get` before re-tracking).
  MV3 service workers die after ~30s idle, so previously a queued batch was
  lost on any SW restart. Also: hard cap of 500 queued jobs, and queued/batch
  stale-purge while the worker is alive.
- **Queue list UI (popup).** New "Download queue" section: live list of
  active + queued items (title, queue position), per-item cancel for queued
  jobs, and a "Clear" button (`clearQueue` also drops pending batch URLs).
  New background messages: `getQueueItems`, `clearQueue`.
- **Signed-link expiry (worklist item).** If dispatching a queued job fails,
  rule34 post jobs re-resolve the post page/API once and retry with fresh
  formats + fresh `get_file` links (covers long queues outliving signed
  tokens, and hosts that were down at resolve time).
- **Batch hardening.** `enqueueBatchDownloads` now dedupes against pending
  batch, queued jobs **and** active downloads (re-clicking "Download
  visible" no longer re-enqueues; reports `skipped`), batch resolution runs
  5-wide in parallel instead of strictly serial, and batch-originated queue
  entries no longer fire one browser notification per item (page toasts
  already cover that; single downloads still notify).
- **Filenames.** `downloadVideo` now applies the resolver's `apiTitle` when
  the caller had no title, so context-menu / bare videoInfo downloads save
  as the real "artist - post id" name instead of `video.mp4`.
- **TELEMETRY_LOG** pings from the popup now ack into the SW log (no-op
  handler from before).
- `post-actions.js` toast distinguishes "already in queue" vs "queued N".
- Bumped `manifest.json` `4.1.1 → 4.2.0`.

### Validation
- All classic scripts `node --check`; background as ESM; all JSON parses;
  forbidden-paywall grep clean.
- New Node harness (`/tmp/queue-test/harness.mjs`, not committed — sandbox
  scratch) loads the real `background-enhanced.js` with mocked `chrome.*` +
  `fetch` and verifies 23 behaviors: limit/queue math, origin-vs-CDN host
  selection (healthy, degrading, and fully-dead CDN), fallback retry exactly
  once / never on user-cancel, storage persistence, restore after simulated
  SW restart (incl. chrome.downloads re-verification + auto-dispatch on slot
  free), batch dedupe (0 accepted / 3 skipped), stale (5h) job purge.
  All pass.

## Session 4 — retrofit to free community + quality-of-life (2026-08-30)

Context: the user is retrofitting the previously-marketed **paid, license-checked**
Chrome extension into a **free community** tool for rule34.world +
rule34video.com, and asked for (a) a neat must/nice-to-have QoL feature, (b)
robust-coding / quality brainstorming, and (c) a recheck for stale code + any
third-party involvement.

### Stale / branding remediation
- Removed the `license_code` flashvar key from `inject.js` (paid-product leftover).
- Removed orphaned paywall CSS (`.activation-section`, `.activate-btn`,
  `.buy-key-link`) from `styles.css`.
- Removed the dead `chrome.action.onClicked` listener (the manifest sets a
  default popup, so it never fired).
- Renamed generator-branding identifiers `Serp*` → `Rule34*` (8 files) and the
  `SERP`/`serp` strings (message contracts, logger labels, CSS/event ids) for a
  clean rebrand. `site-adapter.js` keeps its internal `serp` strings because it
  is now kept-but-unloaded legacy code.

### Third-party / licensing
- Added a top-level `LICENSE` (**MIT**) and `docs/THIRD_PARTY_LICENSES.md`
  (mediabunny **MPL-2.0** file-level copyleft — source ships in the repo;
  mp4box **BSD-3-Clause**). No external telemetry / analytics / beacon found.
- **Gated the generic multi-hoster surface:** `site-adapter.js` is no longer
  injected into rule34 pages and its background fallback is now inert;
  `host_permissions` narrowed to the two sites + `rule34storage.b-cdn.net` +
  `api.github.com` (dropped the `"https://*/*"` / `"http://*/*"` wildcards).

### Quality-of-life features
- **Smart Library** — configurable download-path template
  (`{site}/{artist}/{title}`, `{site}/{title}`, `{title}` presets) so files land
  in organized subfolders instead of a flat Downloads folder. The artist tag is
  already extracted by the rule34.world resolver.
- **Bulk download by tag / playlist** (rule34.world) — a popup control that
  cursor-paginates `/api/v2/post/search/root` (and
  `/v2/post/search/playlist/{id}`) and enqueues every post through the existing
  batch engine.

### Validation
- All classic scripts `node --check`; `background-enhanced.js` as ESM; all JSON
  parses; forbidden-paywall grep clean; `Serp`/`SERP` branding gone from active
  code (only `rule34` remains); the `RULE34_GENERATED_PAGE_DATA` message contract
  is preserved on both sides. Version bumped **4.2.0 → 4.3.0**.

## Session 5 — privacy.md + CI + rule34video.com tag search (2026-08-30)

Context: user approved (b) add `privacy.md` + GitHub Actions CI + wire rule34video.com
tag search, then update the three docs and (a) open the merge-commit PR.

### privacy.md
- `docs/privacy.md`: no telemetry/analytics; exact network destinations
  (rule34.world, rule34video.com, BunnyCDN host, api.github.com for update checks);
  local-only storage. Supports the Web Store listing.

### GitHub Actions CI
- `.github/workflows/ci.yml`: on push/PR runs syntax checks (all classic scripts +
  background as ESM), JSON validation, a forbidden-paywall grep, and a committed
  `source/tests/smoke.mjs`.
- `source/tests/smoke.mjs`: loads the REAL `background-enhanced.js` in Node with mocked
  `chrome.*` + `fetch`, then exercises `getVideoFormats` (rule34.world resolver →
  artist + formats) and `bulkDownloadTag` (search → batch enqueue) end-to-end.
  Commits the PR #3 harness concept into the repo so it survives and runs in CI
  (the original was scratch in /tmp).

### rule34video.com tag search
- `searchRule34VideoTag({ tags })` fetches `https://rule34video.com/search/<tag>/`
  (confirmed from the saved listing HTML: `action="https://rule34video.com/search/"`)
  and scrapes `/video/{id}/` card links. Wired into `bulkDownloadTag` via active-tab
  site detection; the popup passes `site` from `chrome.tabs.query`.
- rule34.world tag/playlist search was implemented in session 4.

### Validation
- `node source/tests/smoke.mjs` → ALL SMOKE TESTS PASSED; background ESM + all classic
  scripts `node --check`; all JSON parses. Version bumped **4.3.0 → 4.4.0**.

## Session 6 — dead-code purge + footprint reduction (2026-08-31)

Context: user asked for a full-codebase review focused on cutting the extension
down and optimizing both extension and repo (reviews were slow compared to the
same agent's passes over other repos). No new features — deletions + hardening
only, all verified behavior-neutral.

### Method
- **Reachability trace** from `manifest.json` entry points (static imports,
  dynamic `import()`, `chrome.runtime.getURL` loads): only **25 of ~124** repo
  files are reachable. The sole path into `modules/` is
  `offscreen.js:544 → modules/hls2mp4/simple-converter.mjs`.
- **Cross-file + function-level dead-code scan** over all hand-written files.

### Removed — orphaned vendored modules (≈1.36 MB, never loaded)
- `modules/mediabunny/` (61 files, 798 KB — `.ts` sources that could never run
  unpackaged), `modules/mp4box.mjs` (311 KB), `modules/reencoder/` (207 KB),
  `modules/dash2mp4/` (15 KB) — the old DASH/WebM pipeline the current HLS
  pipeline replaced.
- `modules/utils/*` except `EnvUtils.mjs` (54 KB; several imported
  `../enums/`, `../options/`, `../ui/`, `sweetalert.mjs` — paths absent from
  this repo, i.e. they would throw if ever loaded).
- Byte-identical duplicate `modules/eventemitter/eventemitter.mjs`,
  `modules/Localize.mjs`, `modules/hls/Mp4Sample.mjs`.

### Removed — repo-level dead files (≈407 KB; page dumps + `legacy/` later retained in `source/`, see below)
- Root `page source.txt` + `page source for rule34 world` (saved HTML dumps).
- `legacy/site-adapter.js` (pre-rewrite multi-hoster adapter; `legacy/` removed).
- `unified-app.config.json` (byte-identical dupe of `app.config.json`) and
  `factory-candidate.config.json` (provenance pointing at paths not in this
  repo). `ci.yml` JSON-validation loop updated to `manifest.json app.config.json`.

### Removed — in-file dead code
- `background-enhanced.js`: `folderName()`.
- `post-actions.js`: `anchorForCard()`.
- `background-bridge.js`: unreachable handlers `handleActionClick`,
  `handleParseM3U8Message`, `handleFetchM3U8PlaylistMessage`,
  `handleDownloadBlobMessage` (175 lines per `git diff --numstat`) + helpers
  whose only callers were the removed code (`getDownloadFolder`,
  `resolveSenderOrActiveTabId`, `getActiveTabId`). Public freeze block trimmed
  **36 → 24 members** — every exported bridge member is now actually called
  by a consumer.

### Hardening / manifest
- `web_accessible_resources`: dropped the `offscreen.html/js` and
  `modules/**/*` blocks (extension-context loads never needed WAR) and
  restricted the remaining `inject.js` + CSS block to the two supported sites
  (was `<all_urls>`). Less exposure surface.
- `docs/THIRD_PARTY_LICENSES.md` rewritten for the surviving vendored set;
  added the previously-missing hls.js (Apache-2.0) attribution.
- Version bumped **4.4.0 → 4.4.1**.

### Scrapyard retention (same session, post-review amendment)
- Owner review asked for retired-but-potentially-useful material to be kept
  (future sites / formats may need it) instead of deleted. All purged files
  except byte-identical duplicates were restored from `f1c5dcc` into
  **`source/`** (repo root; 74 files, ~2.0 MB; outside the extension
  folder, so the shipped package stays 0.85 MB and CI's branding grep never
  scans it).
- Contents + per-file rationale + restore paths: `source/README.md`.
  Highlights: `site-adapter.js` (multi-hoster detector; adapter hook points
  at `background-enhanced.js:9,1296,2229` remain live), the DASH/WebM→MP4
  pipeline (`mp4box.mjs` + `dash2mp4/` + `reencoder/` + `Mp4Sample.mjs`),
  `mediabunny/` (MPL-2.0 TS mux/demux lib), orphaned `utils/`, and the two
  page-source HTML dumps (renamed `source/page-source/*`).
- Not restored (zero unique content): `unified-app.config.json` (byte-identical
  to `app.config.json`, verified with `cmp`) and `modules/eventemitter/`
  (byte-identical to the kept `modules/eventemitter.mjs`).

### Optimization backlog added to WORKLIST.md
- Remux-only hls.js build (measured: **67 KB** achievable from upstream
  `hls.js/src` vs the shipped 407 KB bundle — but a re-bundle of the vendored
  file gives no win at 393 KB; needs a build step + browser regression test;
  see WORKLIST for the measured details).
- Dual-payload progress consolidation (canonical + legacy messages per tick).
- Queue-restore temp-key hardening (non-numeric `activeQueueJobs` keys restore
  without a liveness check).
- Host-probe both-fail state: log + shorter TTL.

### Validation
- All `.js`/`.mjs` `node --check` OK; JSON parses; forbidden-paywall grep clean;
  `node source/tests/smoke.mjs` → **ALL SMOKE TESTS PASSED** (getVideoFormats + bulk
  enqueue against the real background module); post-edit reachability re-run →
  0 broken imports; extension dir **2.2 MB → 0.85 MB**, repo **2.6 MB → 0.93 MB**
  (124 → 44 files). After the scrapyard amendment: extension folder diff vs
  the purge commit is **empty** (byte-identical); scrapyard is additive-only.

### CI fix applied by owner (2026-08-31, resolved)
- The owner applied the `ci.yml` one-line fix manually as commit `2ab56cf`
  ("Update CI workflow to check fewer JSON files", JSON loop →
  `manifest.json app.config.json`). GitHub Actions run `33371030852` on that
  commit completed **success** (validate + smoke, 16 s). The two earlier
  failures (`8144074`, `73d55bf`) were the deleted-config names in the old
  loop, as predicted. Remaining yml observations (non-blocking): `node-version:
  "20"` deprecation annotation from `actions/checkout@v4`/`setup-node@v4`,
  and `modules/**/*.mjs` files are not syntax-checked by CI (validated locally
  only).

### Session 6 hardening pass — post-CI-fix (2026-08-31, v4.4.2)

Context: with CI green, the three cheap items from the WORKLIST backlog were
implemented (the two expensive ones — remux-only hls.js build, dual-payload
progress consolidation — stay on the backlog because they need a build step /
browser testing):

- **Queue-restore temp keys** (`background-enhanced.js` `restoreQueueState`):
  non-numeric `activeQueueJobs` keys (`queue-job-N`, snapshotted while
  `downloadVideo()` was still running) are no longer restored — after a worker
  death no chrome download exists to track, so restoring only blocked a
  concurrency slot for up to 3 h. Numeric keys keep the
  `chrome.downloads.get` liveness check as before.
- **Host-probe both-fail state** (`getWorldHostStatus`): logs
  `"rule34.world host probe: BOTH file hosts unreachable"` when both roots
  fail, and the both-fail cache re-probes after 60 s
  (`WORLD_HOST_PROBE_FAIL_TTL_MS`) instead of holding for the full 10-min TTL
  (healthy states keep the 10-min TTL).
- **Offscreen ack channels** (`offscreen.js`): the three sync-ack branches
  (`processHLS`, `PROCESS_HLS_SEGMENTS`, `PROCESS_MP4_DOWNLOAD`) now
  `return false` — the ack is sent synchronously and consumed immediately by
  the background, so holding the channel open with `return true` was
  pointless (progress arrives via separate messages).
- **`batchPending` hoist**: declaration moved next to the other queue state
  since the queue helpers reference it. Was verified not a live bug (nothing
  executed above the old line 715 during module evaluation); this removes the
  ordering fragility.
- Version bumped **4.4.1 → 4.4.2**.

Validation: `node --check` all extension JS/MJS; JSON parse; branding grep
clean; `source/tests/smoke.mjs` ALL PASSED; reachability 0 broken imports; plus a
functional mocked-chrome restore test asserting: temp key dropped, live
numeric key re-tracked (`getQueueStatus` → `active === 1`), dead numeric key
dropped, module evaluates clean after the hoist.

## Session 7 (2026-08-31) — scrapyard split: extension-used vs unused source

The session-6 scrapyard mixed two kinds of material in one pile: files that
genuinely **were used as extension files** (retired from the shipped
extension) and files that **never were** (source-project code + saved
reference dumps). Per owner request they are now split into two subfolders:

- **`source/retired/`** (13 files, ~708 KB) — retired extension code:
  `site-adapter.js` (multi-hoster detector, removed session 4),
  `modules/mp4box.mjs`, `modules/dash2mp4/`, `modules/hls/Mp4Sample.mjs`,
  `modules/reencoder/`, and `modules/utils/BlobManager.mjs` (kept on this
  side because `reencoder.mjs`/`mp4merger.mjs` live-import it — the retired
  DASH/WebM load graph stays intact here).
- **`source/vendor/` + `source/page-source/`** (61 files, ~1.12 MB) — never
  used as extension: `vendor/mediabunny/` (45 TS files + MPL-2.0 LICENSE),
  `vendor/Localize.mjs`, the 13 source-project `vendor/utils/` fragments
  (imports `../enums/`, `../options/`, `../ui/`, `sweetalert.mjs` — absent
  from this repo), and `page-source/*.html` reference dumps.

Classification basis: the session-6 reachability audit plus per-file import
analysis. All 74 moves were `git mv` renames (history preserved). Docs
(`SESSION_HANDOFF.md`, `RETROFIT_AUDIT.md`, `WORKLIST.md`) updated to the new
paths. Full inventory + restore paths: `source/README.md`.

### Session 7 follow-up (2026-08-31) — tools split + session-6 regression validation

- **`source/tools/` split:** the last two non-runtime files in the extension folder
  (`app.config.json` — generator provenance artifact, and `generate-icons.js`
  — Node icon generator) moved to `source/tools/`. The extension folder
  is now runtime-only. `generate-icons.js` writes into
  `extension/icons/`. CI needs the owner-applied path
  update (bot token lacks `workflows` permission — exact diff in PR #6
  description; same situation as session 6's `2ab56cf`): the JSON loop
  `for j in manifest.json app.config.json` →
  `for j in manifest.json ../source/tools/app.config.json` and
  `../source/tools/generate-icons.js` added to the `node --check` list.
- **Session-6 regression validation against session 5 (`f1c5dcc`)** — verdict:
  session 6 did **not** break the project. Method + evidence in
  `docs/SESSION6_VALIDATION.md`. Summary: all 25 message actions of the real
  `background-enhanced.js` behave byte-identically on both commits under a
  mocked-chrome harness (including the HLS→offscreen pipeline);
  onMessage switch cases identical; all 13 bridge members removed in session
  6 have zero references in live code and were already unreachable in s5;
  static audit shows s5 had ~20 broken import refs (the dead clusters
  session 6 removed) vs 1 pre-existing try/catch-guarded `history.html` ref
  in s6; WAR narrowing verified safe (nothing loads offscreen/modules from
  page context); syntax checks clean on both commits.

### Session 7 close-out (2026-08-31) — top-level restructure: `extension/` + `source/`

Per owner direction, the repo root now contains only two code folders:

- **`extension/`** — the shipped extension (renamed from
  `rule34video downloader/`; no more space in the folder name).
- **`source/`** — all development-use code: `source/retired/` (retired
  extension code), `source/vendor/` + `source/page-source/` (never-used
  sources), `source/tools/` (`app.config.json`, `generate-icons.js`),
  `source/tests/` (`smoke.mjs`), `source/docs/` (all project docs).

Workflow: develop in `source/`, ship the result into `extension/`, debug
against live-test findings by reading the extension files. All moves were
`git mv` renames. `source/tests/smoke.mjs` and `source/tools/generate-icons.js`
paths updated to the new layout; CI (`.github/workflows/ci.yml`) needs the
owner-applied update — working dir `extension`, tools paths
`../source/tools/...`, smoke step `node source/tests/smoke.mjs` (full file
posted in PR #6).

Validation: `node source/tests/smoke.mjs` ALL PASSED; extension folder
byte-identical (no change).

## Session 8 (2026-09-01) — source-separated, tag-named output folders (v5.0.0)

Ported the proven output-organization mechanics from the sister project
(`nh-dw-2.0`, PR #30 / `9f86426`) to this extension: every download now lands
in `Downloads/<Root>/<Site>/<Collection>/<file>`, the two sites never share a
folder, and the collection folder is named from the post's tags.

### Feature 1 — per-website master folders (automatic)

- **New file `extension/folder-naming.js`** — a dependency-free naming engine
  shared by the popup (classic `<script>`) and the service worker (ESM import;
  it registers `globalThis.R34FolderNaming`, same pattern as `site-config.js`).
- `<Root>` = chrome.storage.sync `masterFolder`, default **`R34V`**. The **empty
  string is meaningful** (master folder off → the flat pre-feature layout), so
  it is stored verbatim and the popup input is wired by hand instead of through
  a generic widget (which drops empty values). Slashes nest deeper.
- `<Site>` is derived **automatically** from the post's hostname — no user
  input. Source map (`SITE_SLUG_BY_HOST`): `rule34video.com → rule34video`,
  `rule34.world`/`rule34.xyz`/`rule34storage.b-cdn.net → rule34world`. Unknown
  hosts get their own sanitized-hostname folder (`example-com`) instead of
  merging into another site's; `siteSlugForUrl` is idempotent so callers can
  hand over a page URL *or* an already-resolved slug.
- **`sanitizeArtifactFilename` ported verbatim** from the sister project
  (control chars + `\:*?"<>|` stripped per segment, leading dots and trailing
  dots/spaces dropped, 120-char segment cap, fallback when nothing usable is
  left) plus two additions this repo needs: Windows reserved device names
  (`CON`, `NUL`, `COM1`, `LPT9`, …) are prefixed with `_`, and a whole relative
  path is kept inside `MAX_TOTAL_PATH_LENGTH` (240) so Chrome never refuses a
  download with `FILE_NAME_TOO_LONG`. `..` cannot survive (leading dots are
  stripped), so no absolute path or parent escape is possible.
- **Filename authority.** `chrome.downloads.download`'s `filename` is a request,
  not a command: a server `Content-Disposition` can override it, blob: URLs are
  saved under the blob UUID on some builds, and another extension holding an
  `onDeterminingFilename` listener silently steals the name (crbug 579563). The
  service worker now registers **one permanent `onDeterminingFilename`
  listener** and re-suggests the full path for every artifact it started
  (URL-keyed map, 10-min TTL, unrelated downloads untouched).

### Feature 2 — tag / artist folder naming

- One template string (`{artist} - {title} - {id}` by default) filled three
  ways, all three in the popup: **(a) manual** text field (highest priority),
  **(b) checkboxes** — one per token *and* one per tag found on the page,
  **(c) search context** — the query of the search/tag/playlist page the
  download started from (sent by the popup, or read from the tab URL for the
  corner button / context menu).
- Token engine copied from the sister project's `nameTemplate.ts`: canonical
  order (`{site} {artist} {uploader} {title} {text} {id} {date} {tags}`),
  joined `" - "`, live "Downloads/…" preview, and a manual input kept visible
  when the stored template is not pure checkboxes so nothing typed is lost.
  An empty template means "every token unchecked" (falls through to search →
  post id), **not** "use the default".
- Priority: **manual → filled template → search query → post id → `untagged`**.
  The result is sanitized; a name that sanitizes to nothing falls back to the
  post id. Empty tokens leave no dangling separator (`"A -  - B"` → `"A - B"`).
- **Artist-folder mode** toggle: `<Site>/<Artist>/<post>`, falling back
  uploader → post id → `untagged`; a leading duplicate of the artist is dropped
  from the post part, and with no artist at all the extra level is skipped
  rather than duplicated.
- Metadata for the tokens is now collected by the resolvers: rule34video post
  pages give tag anchors, the uploader (`/models/`, `/channels/`) and
  `<time datetime>`; rule34.world gives `tags[]`, the type-8 artist and
  `created`. `getVideoFormats` returns `apiTags` / `apiUploader` / `apiDate` /
  `apiKind`, and `content.js` adds the page's own tag list to `getVideoInfo`.
- The popup's manual name + checked tags travel with the download request and
  are remembered per post URL (chrome.storage.local, capped at 100), so the
  in-page corner button and the context menu land in the same folder.

### Feature 3 — videos and pictures in that folder

- **Video** (the usual case): one file straight into the collection folder with
  the source container's extension (`<title>.mp4`), no archiver. Duplicates are
  never overwritten by default (`conflictAction: "uniquify"`, user-switchable
  to overwrite); same-name **folders** merge by design, so no ` (1)` junk.
- **Picture sets**: `pictureSaveMode` = `loose` (numbered originals
  `001.jpg…` in the folder, remote URLs so the download manager creates the
  folder itself) or `zip` / `cbz` / `pdf` (one archive per post,
  `<collection>/<post>.<ext>`).
- **New `extension/modules/archive/zipBuilder.mjs`** — dependency-free ZIP
  writer (CRC-32, local + central directory, EOCD, raw-deflate through
  `CompressionStream` with a STORE fallback, UTF-8 name flag, deterministic
  timestamps, `..` rejected). No JSZip, no bundler.
- **New `extension/modules/archive/pdfBuilder.mjs`** — the sister project's
  dependency-free PDF 1.4 writer ported as-is (JPEGs embedded verbatim from
  their SOF dimensions via `DCTDecode`, exact xref offsets), plus
  `preparePdfPage` / `reencodeImageToJpeg` (PNG/WebP re-encoded white-flattened
  through `OffscreenCanvas`).
- **MV3 realities respected.** Archives are built in the **offscreen document**
  (a service worker has no `URL.createObjectURL`, and PDF needs an image
  canvas); the offscreen document still touches **only `chrome.runtime`** — it
  relays the finished blob to the service worker (`SAVE_BLOB_ARTIFACT`), which
  owns `chrome.downloads` and therefore the folder path. If that relay fails the
  in-document `<a download>` anchor is the last resort (documented: its
  `download` attribute is a file *name*, so the artifact lands in the download
  root instead of the folder).

### Bugs found and fixed while wiring this up

- **Offscreen-downloaded videos ignored the folder path entirely.**
  `shouldUseOffscreenMp4` is the *main* rule34video.com path (CDN media +
  cross-origin referer). `chrome.downloads` does not exist in an offscreen
  document, so `chromeDownload()` always rejected and the fallback anchor saved
  the file **flat in the download root** under the leaf name — the folder
  template never applied. Now the blob is relayed to the service worker with
  its full relative path.
- **`scopedFileName()` double-foldered offscreen downloads.** It prepended
  `SiteConfig.OFFSCREEN.downloadFolder` ("Rule 34") to a name that already
  contained the template path, so the same video landed in
  `Rule 34/rule34video/…` or `rule34video/…` depending on the code path. The
  service worker now supplies the complete relative path and the offscreen
  document adds nothing (leading slashes stripped, since an absolute path is
  rejected). The unused `chromeDownload()` helper was removed rather than left
  unreachable.
- The anchor fallback used the **unscoped** name, losing the folder even in the
  fallback case.

### Replaced setting

- The free-form **"Save location (folder template)"** field
  (`downloadPathTemplate`, default `{site}/{artist}/{title}`, which made the
  *title* the file name) is replaced by Master folder + Folder name
  (manual / token checkboxes / tags / search). The old key is no longer read;
  it is left in storage untouched so nothing the user typed is deleted.

### Tests (all offline)

- `source/tests/folder-naming.test.mjs` — 31 fixture cases: master folder
  (default / custom / nested / empty = off), the site map, sanitizing
  (reserved chars, `..`, 120 cap, reserved Windows names, empty → post id,
  total-length cap), the template engine, the naming priority chain,
  artist-folder mode, search-context detection, full paths.
- `source/tests/zip-builder.test.mjs` — 10 cases: CRC-32 against the published
  check value and Node's zlib, entry order/sizes/CRCs, a real inflate
  round-trip, deflate vs STORE, byte-reproducibility, UTF-8 names, `..`
  rejection. Cross-checked in the sandbox with Python's `zipfile` (`testzip()`
  clean) and `unzip -t`.
- `source/tests/pdf-builder.test.mjs` — 12 cases, adapted from the sister
  project's `pdf-builder.test.js` (only the input shape changed): SOF parsing
  (baseline/progressive/APPn/non-RGB), PDF 1.4 structure, verbatim JPEG
  embedding, exact xref offsets, error cases.
- `source/tests/e2e-download-paths.mjs` — 50 window-less VM checks driving the
  **real** `background-enhanced.js` and `offscreen.js` through their message
  handlers with mocked `chrome.*` + `fetch`: per-site paths, the naming
  priority chain (including the tab-URL search context), master folder off,
  reserved names, `conflictAction`, the filename guard (and that it never
  renames unrelated downloads), resolver metadata, picture-set routing for
  loose/zip/cbz/pdf, and the offscreen document actually assembling the
  archive (verified with an independent reader).
- `source/tests/smoke.mjs` — mock extended with `chrome.storage.sync` and a
  downloads callback; still green.
- Runner: `node --test "source/tests/*.test.mjs"` (built into the Node 22 CI
  already installs; note the quoted glob — Node treats a bare directory
  argument as an entry point) rather
  than mocha — this repo has no `package.json`/`node_modules` and stays
  dependency-free; `npm test` runs the three suites for convenience.

Version bumped **4.4.2 → 5.0.0** in `extension/manifest.json` (the only
runtime manifest; `source/tools/app.config.json` is a historical generator
snapshot and is intentionally not bumped — it is never loaded at runtime).

## Session 9 (2026-09-02) — review pass: real bugs, dead code, CI de-duplication

A full review of `ci.yml`, the three handoff documents and the shipped code,
looking for missing logic, misaligned code and rot. Everything below is
verified by the offline suites (`npm test`, now 59 fixture checks + smoke +
50-check e2e, all green).

### Bugs fixed (all latent — no suite covered them)

1. **`chrome.downloads.get()` does not exist** (`background-enhanced.js`,
   restore path). The Chrome extensions API has no single-item `get()`; the
   lookup is `search({ id })`. The call threw on *every* service-worker
   restart, the surrounding `catch` swallowed it as "download not alive", and
   so **every in-flight chrome download was dropped from the concurrency
   accounting** after a restart — the queue then over-dispatched past the
   user's limit. Session 6 had "verified" this branch with a mock that
   implemented `get()`, which is why it survived. Now uses `search({ id })`,
   and the new `source/tests/queue-restore.test.mjs` mocks `chrome.downloads`
   *without* a `get()` so the same mistake fails loudly. (`state` is also
   compared against `"in_progress"` only — `"incomplete"` is not a member of
   the `DownloadItem.state` enum, it is `"in_progress" | "interrupted" |
   "complete"`.)
2. **`normalizePts` was called but never defined** (`modules/hls2mp4/transmuxer.mjs`).
   `getVideoStartPts()` calls it on the PTS-rollover branch. MPEG-TS PTS is 33
   bits and wraps about every 26.5 h, so any stream that actually rolled over
   threw a `ReferenceError` mid-transmux and failed the download. Implemented
   as hls.js' `PTSNormalize` does it.

### Dead code removed

- `buildDownloadPath()` (`background-enhanced.js`) — zero callers; every call
  site uses `resolveOutputTarget()` directly.
- `fireAndForget()` (`background-bridge.js`) — exported on the frozen public
  API with zero consumers. (`player-button.js`'s `fireAndForget` is an
  unrelated local option flag.)
- `R34FolderNamingDefaults` (`folder-naming.js`) — a second global nobody read;
  both constants are already on `R34FolderNaming`.
- `hasVideoTrack` (`modules/hls2mp4/simple-converter.mjs`) — computed, unused.
- The offscreen document's `"actionData"` HLS message style: `site-config.js`
  never sets `OFFSCREEN.hls.messageStyle`, so all three branches and their
  `hlsDataPayload()` helper were unreachable. The config knob went too.
- The worker's `hlsProgress` / `hlsComplete` / `hlsError` message-router cases:
  duplicate routes for action names nothing emits (the offscreen document only
  ever sends the `HLS_PROCESSING_*` types).

### Less code, same output

- **Dual-payload progress forwarding consolidated** (a WORKLIST backlog item).
  `forwardProgressMessages` sent a canonical *and* a legacy message per
  progress tick and `content-bridge.js` listened to both. The canonical
  `downloadProgress` payload is a strict superset, so the legacy shape is gone
  on both sides: six legacy payload literals, six content-side handlers, and
  the label table with them. Halves the message traffic per tick.
  ⚠️ Still wants a manual browser check of the progress toasts.
- **CI de-duplicated.** `source/docs/ci-workflow.pending.yml` was byte-identical
  to the live `.github/workflows/ci.yml` (the owner had already applied it), so
  it was deleted. The workflow inlined a hand-maintained list of classic
  scripts that had **drifted** from the near-identical list in `package.json`;
  both are replaced by `source/tools/validate.mjs`, which derives the list from
  disk so no new extension file can be silently skipped. The new workflow is
  one job of four `npm run` steps, identical to what a developer runs locally.
  Verified the validator actually fails on a syntax error, malformed JSON and a
  reintroduced paywall marker.
  GitHub rejected the workflow push (the bot token has no `workflows` scope),
  so the new file shipped as `source/docs/ci-workflow.pending.yml` for an owner
  copy-paste, exactly as in sessions 6-8. The owner applied it the same day
  (`e695faa`); it was verified byte-identical and green (one job, "Validate and
  test"), and the pending file was deleted as a stale duplicate.

### Test coverage added

- `source/tests/queue-restore.test.mjs` — 6 checks driving the real service
  worker against pre-seeded persisted queue state: `search({id})` is used, an
  `in_progress` download keeps its slot, a finished one does not, a temp
  `queue-job-N` key never blocks a slot, and waiting/batch jobs are restored.
  Confirmed to fail on the pre-fix code.

## Known issues / notes

- rule34.world listing DOM (`app-post-card`, `mat-card`) is inferred, not
  confirmed from a live page (Angular shell has no SSR; verified the
  rule34video.com side live). Verify during browser testing.
- rule34.world file CDN (b-cdn.net) was **fully down** at review time; if it
  comes back the probe will start using it again automatically (flag
  preferred when both roots are healthy).
- `modules/hls/hls.mjs` ships the full hls.js player (~400 KB) while only the
  demux/remux exports are used — remux-only build tracked in WORKLIST.md.
- Manual browser testing is still the largest open item (see WORKLIST.md).
