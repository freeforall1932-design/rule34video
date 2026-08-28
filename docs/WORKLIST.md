# Worklist — Rule34 Downloader

Status key: `[x]` done · `[~]` in progress · `[ ]` todo

## Done

- [x] Remove third-party auth (`auth.serp.co`, `serp.ly`, activation/license/trial).
- [x] Delete `auth*` / `trial-banner.js` files.
- [x] Remove `isActivated` gating from player button + background.
- [x] Replace fixed 3-download trial with configurable concurrency limit.
- [x] Slider + typeable number input, default Unlimited, live queue status.
- [x] Background queue with auto-dispatch on slot free.
- [x] Repoint update checker to `freeforall1932-design/rule34video`.
- [x] Add rule34video.com post resolver.
- [x] Add rule34.world `/api/v2/post/{id}` resolver.
- [x] Wire resolver into `getVideoFormats()` fast path.
- [x] Extension-aware filenames (`.mp4` vs `.jpg`).
- [x] Batch download backend + `batchDownloadPosts` message.
- [x] Corner download button per post card (`post-actions.js`).
- [x] Floating "Download visible (N)" batch toolbar.
- [x] Toast status for batch results.
- [x] Syntax + JSON validation (all pass).
- [x] Forbidden-remnant grep (clean).
- [x] Handoff / improvement / worklist docs.
- [x] Commit, push, open PR, merge (merge commit).

## Manual browser test matrix (most important remaining work)

### rule34video.com

- [ ] Listing page: corner `↓` button appears on each `.item.thumb` card.
- [ ] Clicking a corner button enqueues exactly that post (toast shows "Queued #N").
- [ ] "Download visible" enqueues all in-viewport cards.
- [ ] Single video page (`/video/{id}/...`): popup lists 1080p/720p/480p/360p.
- [ ] Popup "Download Video" downloads the selected quality (signed link works).
- [ ] Preview MP4s are never used as final downloads.

### rule34.world

- [ ] Hot/listing page: corner `↓` button appears on each post card.
- [ ] Single video post (`/post/{id}`): popup lists Source/720p/480p.
- [ ] Image post (`/post/{id}`) downloads as `.jpg`.
- [ ] "Download visible" batch works on the listing.

### Concurrency / queue

- [ ] Set limit 2, start 4 downloads → 2 active + 2 queued, auto-dispatch on finish.
- [ ] Set limit 3 → same behavior with 3 slots.
- [ ] Unlimited (0) → no queueing, all start immediately.
- [ ] Cancel an active download frees a slot.
- [ ] Cancel a queued download removes it from the queue.
- [ ] Slider and typed input stay in sync; clearing input = Unlimited.

### Update checker

- [ ] Popup shows update notice when a newer GitHub release exists.
- [ ] Link points to `github.com/freeforall1932-design/rule34video/releases/latest`.

## Todo / nice-to-have

- [ ] Confirm rule34.world card selectors (`app-post-card` / `mat-card`) on a live page;
      adjust `post-actions.js` pin container if needed.
- [ ] Optional: rename `Serp*` namespace identifiers to `Rule34*` (cosmetic).
- [ ] Optional: narrow `https://*/*` host permission; keep
      `https://rule34storage.b-cdn.net/*` for world downloads.
- [ ] Optional: batch pagination / "load more" auto-scroll for rule34.world
      (POST API with `Skip`/`take`/`cursor` — pattern documented in handoff).
- [ ] Optional: image posts on rule34video.com (currently video-focused).
- [ ] Optional: dedupe "already downloaded" via `chrome.downloads` history.
