# Worklist — Rule34 Downloader

Status key: `[x]` done · `[~]` in progress · `[ ]` todo

Last updated: 2026-08-29 (session 2). PR #1 merged (rebrand + queue + batch).
PR #2 = session-2 bug fixes (popup fallback + image routing).

## Done

- [x] Remove third-party auth (`auth.serp.co`, `serp.ly`, activation/license/trial).
- [x] Delete `auth*` / `trial-banner.js` files and all references (incl. `popup.html` tags).
- [x] Remove `isActivated` gating from player button + background.
- [x] Replace fixed 3-download trial with configurable concurrency limit.
- [x] Slider + typeable number input, default Unlimited, live queue status.
- [x] Background queue with auto-dispatch on slot free, re-pump, cancel, stale purge.
- [x] Repoint update checker to `freeforall1932-design/rule34video`.
- [x] rule34video.com post resolver (signed `get_file`, prefers `download=true`, skips previews).
- [x] rule34.world `/api/v2/post/{id}` resolver (CDN URLs, artist title, thumbnail).
- [x] Wire resolver into `getVideoFormats()` fast path.
- [x] Extension-aware filenames (`.mp4` vs `.jpg`).
- [x] Batch download backend + `batchDownloadPosts` message + per-post toasts.
- [x] Corner download button per post card + floating "Download visible (N)" toolbar (`post-actions.js`).
- [x] Syntax + JSON validation pass; forbidden-remnant grep clean.
- [x] Handoff / improvement / worklist docs.
- [x] PR #1 opened and **merged to main with a merge commit** (`42cc212`).
- [x] **(PR #2) Popup fallback:** when content `getVideoInfo` fails on a supported
      rule34 post URL, build a minimal URL-based record and let the background
      resolver populate formats/title (fixes "No video found" on single posts).
- [x] **(PR #2) Image routing:** `shouldUseOffscreenMp4` excludes image formats
      so rule34.world image posts download directly (not via the MP4 pipeline).
- [x] **(PR #2)** Bump version to `4.1.1`; refresh docs.

## Manual browser test matrix (MOST IMPORTANT remaining work)

> Load the unpacked extension from `rule34video downloader/` at
> `chrome://extensions` (Developer mode), then test on the live sites.

### rule34video.com
- [ ] Listing page: corner `↓` button appears on each `.item.thumb` card.
- [ ] Clicking a corner button enqueues exactly that post (toast).
- [ ] "Download visible" enqueues all in-viewport cards.
- [ ] Single video page (`/video/{id}/...`): popup opens (no "No video found"),
      lists 1080p/720p/480p/360p after the background resolver runs.
- [ ] Popup "Download Video" downloads the selected quality (signed link works).
- [ ] Preview MP4s (`data-preview`, `_preview.mp4`) are never used as final downloads.
- [ ] Popup title/thumbnail populate (from `apiTitle` / `apiThumbnail`).

### rule34.world
- [ ] Hot/listing page: corner `↓` button appears on each post card
      (**verify the `app-post-card` / `mat-card` / `[class*=post]` selectors**).
- [ ] Single video post (`/post/{id}`): popup opens and lists Source/720p/480p.
- [ ] Image post (`/post/{id}`) downloads directly as `.jpg` (**PR #2 fix** —
      confirm it does NOT spin through the HLS/offscreen "Preparing…" state).
- [ ] "Download visible" batch works on the listing.

### Concurrency / queue
- [ ] Set limit 2, start 4 downloads → 2 active + 2 queued, auto-dispatch on finish.
- [ ] Set limit 3 → same with 3 slots.
- [ ] Unlimited (0) → no queueing, all start immediately.
- [ ] Cancel an active download frees a slot; cancel a queued one removes it.
- [ ] Slider and typed input stay in sync; clearing input = Unlimited.
- [ ] Offscreen/HLS/image completions all release their slot (no stuck queue).

### Update checker
- [ ] Popup shows update notice when a newer GitHub release exists.
- [ ] Link points to `github.com/freeforall1932-design/rule34video/releases/latest`.

## To-do / improvements (ordered)

- [ ] **Verify rule34.world listing-card selectors on a live page**; adjust
      `post-actions.js` `pinContainerFor()` / `processCards()` if needed.
- [ ] Route or drop the popup `telemetry()` `{type:"TELEMETRY_LOG"}` pings
      (currently no handler — harmless no-op).
- [ ] Narrow broad host permissions (`https://*/*`) to rule34 sites +
      `https://rule34storage.b-cdn.net/*` once cross-origin needs are confirmed.
- [ ] Optional: rename `Serp*` namespace identifiers to `Rule34*` (cosmetic).
- [ ] Optional: batch pagination / auto-scroll for rule34.world
      (POST API with `Skip`/`take`/`cursor`).
- [ ] Optional: image posts on rule34video.com (currently video-focused).
- [ ] Optional: "already downloaded" dedupe via `chrome.downloads` history.
- [ ] Optional: signed-URL expiry — batch/queue waits could outlive signed
      rule34video links; consider re-resolving on dispatch if a download fails.

## Git notes

- PR #1 = merged (`42cc212`). PR #2 = session-2 fixes.
- Always merge with a **merge commit** (`gh pr merge <n> --merge`), not squash.
- `git fetch origin` and work from `origin/main` at the start of every session;
  the local checkout may be behind.
