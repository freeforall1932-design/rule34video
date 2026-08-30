# Worklist — Rule34 Downloader

Status key: `[x]` done · `[~]` in progress · `[ ]` todo

Last updated: 2026-08-30 (session 3). PR #1 merged (rebrand + queue + batch).
PR #2 = session-2 bug fixes (popup fallback + image routing).
PR #3 = session-3 review fixes (CDN outage handling + persistent queue).

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
- [x] **(PR #3) rule34.world host probe:** CDN (`rule34storage.b-cdn.net`) was
      returning HTTP 500 for every post while the origin served fine; the
      resolver now probes both roots (10-min TTL) and builds URLs on the
      healthy root, with a `fallbackUrl` on the other healthy root.
- [x] **(PR #3) Fallback retry:** interrupted (non-user-cancelled) chrome
      downloads restart once on the format's `fallbackUrl`.
- [x] **(PR #3) Persistent session queue:** queue + batch + active slots
      mirrored to `chrome.storage.local` (`r34.queueState.v1`), restored on
      service-worker restart (stale >3h dropped; chrome downloads re-verified),
      flushed on `onSuspend`, 500-job cap.
- [x] **(PR #3) Queue list UI in popup** (`getQueueItems` / `clearQueue`):
      live active + queued items, per-item cancel, clear button.
- [x] **(PR #3) Signed-URL expiry:** failed dispatch re-resolves the post once
      and retries with fresh formats/links (rule34video + rule34.world).
- [x] **(PR #3) Batch hardening:** dedupe vs pending/queued/active downloads,
      5-wide parallel resolution, no per-item browser notifications,
      "already in queue" toast, `skipped` count.
- [x] **(PR #3) Filenames:** `downloadVideo` applies resolver `apiTitle` when
      the caller had no title (context-menu downloads got `video.mp4` before).
- [x] **(PR #3) TELEMETRY_LOG** now acks into the SW log (was a no-op).
- [x] **(PR #3)** Bump version to `4.2.0`; refresh docs; Node harness
      (mocked chrome + fetch) validates 23 queue/host behaviors.
- [x] **(Session 4) Retrofit audit + rebrand:** removed stale paywall/branding
      (`license_code` in `inject.js`, `.activation-section`/`.activate-btn`/
      `.buy-key-link` CSS, dead `chrome.action.onClicked` listener); renamed
      `Serp*` → `Rule34*` identifiers across 8 files + `SERP`/`serp` strings;
      added top-level MIT `LICENSE` and `docs/THIRD_PARTY_LICENSES.md`
      (mediabunny MPL-2.0, mp4box BSD-3).
- [x] **(Session 4) Gate generic multi-hoster:** `site-adapter.js` no longer
      loaded on rule34 pages; its background fallback is inert; `host_permissions`
      narrowed to the two sites + `rule34storage.b-cdn.net` + `api.github.com`
      (wildcards dropped).
- [x] **(Session 4) Smart Library:** configurable `{site}/{artist}/{title}`
      download-path template (popup UI + presets), stored in `downloadPathTemplate`;
      artist supplied by the rule34.world resolver.
- [x] **(Session 4) Bulk by tag / playlist:** rule34.world cursor-paginated
      search (`/api/v2/post/search/root`, `/v2/post/search/playlist/{id}`) wired
      to the batch engine via a new `bulkDownloadTag` popup control.
- [x] **(Session 4)** Bump version to `4.3.0`; `docs/RETROFIT_AUDIT.md` written.

## Manual browser test matrix (MOST IMPORTANT remaining work)

> Load the unpacked extension from `rule34video downloader/` at
> `chrome://extensions` (Developer mode), then test on the live sites.

### rule34video.com
- [ ] Listing page: corner `↓` button appears on each `.item.thumb` card.
- [ ] Clicking a corner button enqueues exactly that post (toast).
- [ ] "Download visible" enqueues all in-viewport cards.
- [ ] Clicking "Download visible" a second time toasts "already in the queue"
      and does NOT re-enqueue (skipped count).
- [ ] Single video page (`/video/{id}/...`): popup opens (no "No video found"),
      lists 1080p/720p/480p/360p after the background resolver runs.
- [ ] Popup "Download Video" downloads the selected quality (signed link works).
- [ ] Preview MP4s (`data-preview`, `_preview.mp4`) are never used as final downloads.
- [ ] Popup title/thumbnail populate (from `apiTitle` / `apiThumbnail`).
- [ ] Saved file is named `artist/title_1080p.mp4`-ish, not `video.mp4`.

### rule34.world
- [ ] Hot/listing page: corner `↓` button appears on each post card
      (**verify the `app-post-card` / `mat-card` / `[class*=post]` selectors**).
- [ ] Single video post (`/post/{id}`): popup opens and lists Source/720p/480p.
      (Video post ids are in the high range — e.g. `/post/3571567`.)
- [ ] Image post (`/post/{id}`) downloads directly as `.jpg` (**PR #2 fix** —
      confirm it does NOT spin through the HLS/offscreen "Preparing…" state).
- [ ] **With the CDN down (as of 2026-08-30):** downloads save from the
      `rule34.world` origin host, and no download fails with a 500.
- [ ] "Download visible" batch works on the listing.

### Concurrency / queue
- [ ] Set limit 2, start 4 downloads → 2 active + 2 queued, auto-dispatch on finish.
- [ ] Set limit 3 → same with 3 slots.
- [ ] Unlimited (0) → no queueing, all start immediately.
- [ ] Cancel an active download frees a slot; cancel a queued one removes it.
- [ ] Slider and typed input stay in sync; clearing input = Unlimited.
- [ ] Offscreen/HLS/image completions all release their slot (no stuck queue).

### Persistent queue (PR #3 — new)
- [ ] With limit 1, queue 3 downloads → popup "Download queue" shows
      1 active + 2 queued (with titles + positions).
- [ ] Cancel a queued row via its ✕ button → it disappears from the list.
- [ ] "Clear" button empties queued + pending batch rows.
- [ ] **Reload the extension** (chrome://extensions → reload) with 2+ queued
      items still waiting → they are still in the queue and keep draining.
- [ ] Close and reopen the browser with queued items → queue survives
      (chrome.storage.local), items older than 3h are dropped.
- [ ] With limit 1: completing the active download auto-starts the next queued
      item (visible in the list moving from queued to active).
- [ ] Kill the browser mid-batch (30+ queued) → reopen → remaining posts
      continue resolving/downloading (no duplicates).

### Fallback retry (PR #3 — new, rule34.world)
- [ ] (Only reproducible if the CDN degrades mid-download or is flaky.)
      If a rule34.world download gets interrupted by a host error, it
      automatically restarts on the other host with a "Download restarted"
      notification. Cancelling manually never auto-restarts.

### Update checker
- [ ] Popup shows update notice when a newer GitHub release exists.
- [ ] Link points to `github.com/freeforall1932-design/rule34video/releases/latest`.

## To-do / improvements (ordered)

- [ ] **Verify rule34.world listing-card selectors on a live page**; adjust
      `post-actions.js` `pinContainerFor()` / `processCards()` if needed.
      (rule34video.com selectors were verified against live HTML in session 3.)
- [ ] Narrow broad host permissions (`https://*/*`) to rule34 sites +
      `https://rule34storage.b-cdn.net/*` once cross-origin needs are confirmed.
- [ ] Optional: rename `Serp*` namespace identifiers to `Rule34*` (cosmetic).
- [ ] Optional: batch pagination / auto-scroll for rule34.world. Session 3
      confirmed the exact API from gallery-dl's extractor: `POST
      {root}/api/v2/post/search/root` with JSON
      `{ includeTags, Skip, take, CountTotal:false, IncludeLinks:true,
      OrderBy:0, cursor }` → `{ items, cursor }` (60/page);
      `/v2/post/search/playlist/{id}` for playlists.
- [ ] Optional: image posts on rule34video.com (currently video-focused).
- [ ] Optional: "already downloaded" dedupe via `chrome.downloads` history
      (match by filename; note signed rule34video URLs differ per resolve).
- [ ] Optional: remove dead `chrome.action.onClicked` listener (popup set).

## Git notes

- PR #1 = merged (`42cc212`). PR #2 = session-2 fixes. PR #3 = session-3
  review fixes (this session).
- Always merge with a **merge commit** (`gh pr merge <n> --merge`), not squash.
- `git fetch origin` and work from `origin/main` at the start of every session;
  the local checkout may be behind.
