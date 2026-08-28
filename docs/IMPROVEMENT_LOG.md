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

## Known issues / notes

- rule34.world listing DOM (`app-post-card`, `mat-card`) is inferred, not
  confirmed from a live page — verify during browser testing.
- The `Serp*` namespace identifiers are generator leftovers (cosmetic only).
- Broad `https://*/*` host permission remains (needed for cross-origin media
  downloads); consider narrowing in a future cleanup.
- `popup.js` `telemetry()` posts `{type:"TELEMETRY_LOG"}` with no background
  handler (harmless no-op).
- Manual browser testing is still the largest open item (see WORKLIST.md).
