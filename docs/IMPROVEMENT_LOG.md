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

## Known issues / notes

- rule34.world listing DOM (`app-post-card`, `mat-card`) is inferred, not
  confirmed from a live page (Angular shell has no SSR; verified the
  rule34video.com side live). Verify during browser testing.
- The `Serp*` namespace identifiers are generator leftovers (cosmetic only).
- Broad `https://*/*` host permission remains (needed for cross-origin media
  downloads); consider narrowing in a future cleanup.
- rule34.world file CDN (b-cdn.net) was **fully down** at review time; if it
  comes back the probe will start using it again automatically (flag
  preferred when both roots are healthy).
- `chrome.action.onClicked` listener is dead code (popup is set) — harmless.
- Manual browser testing is still the largest open item (see WORKLIST.md).
