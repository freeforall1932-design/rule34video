# Worklist — Rule34 Downloader

Status key: `[x]` done · `[~]` in progress · `[ ]` todo

Last updated: 2026-08-31 (session 6). PR #1 merged (rebrand + queue + batch).
PR #2 = session-2 bug fixes (popup fallback + image routing).
PR #3 = session-3 review fixes (CDN outage handling + persistent queue).
Session 6 = dead-code purge + footprint reduction (extension 2.2 MB → 0.85 MB).

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
- [x] **(Session 4) Move generic multi-hoster out of package:** `site-adapter.js`
      moved to `legacy/` (excluded from the extension package); its background
      fallback is inert; `host_permissions` narrowed to the two sites +
      `rule34storage.b-cdn.net` + `api.github.com` (wildcards dropped).
- [x] **(Session 5) Privacy + CI + rule34video.com tag search:**
      - `docs/privacy.md` (no telemetry; only the two sites + BunnyCDN + GitHub).
      - `.github/workflows/ci.yml` runs `node --check` (classic + background ESM),
        JSON parse, forbidden-paywall grep, and a committed `tests/smoke.mjs`
        (mocked chrome + fetch exercising `getVideoFormats` + `bulkDownloadTag`).
      - Wired rule34video.com tag search (`searchRule34VideoTag` scrapes
        `rule34video.com/search/<tag>/` post links) into the bulk-by-tag popup
        (active-tab site auto-detected).
      - Bump version to `4.4.0`.
- [x] **(Session 4) Smart Library:** configurable `{site}/{artist}/{title}`
      download-path template (popup UI + presets), stored in `downloadPathTemplate`;
      artist supplied by the rule34.world resolver.
- [x] **(Session 4) Bulk by tag / playlist:** rule34.world cursor-paginated
      search (`/api/v2/post/search/root`, `/v2/post/search/playlist/{id}`) wired
      to the batch engine via a new `bulkDownloadTag` popup control.
- [x] **(Session 4)** Bump version to `4.3.0`; `docs/RETROFIT_AUDIT.md` written.
- [x] **(Session 6) Orphaned vendored modules deleted** (verified unreachable by
      entry-point reachability trace — the only path into `modules/` is
      `offscreen.js → hls2mp4/simple-converter.mjs`):
      `modules/mediabunny/` (61 files, 798 KB), `modules/mp4box.mjs` (311 KB),
      `modules/reencoder/` (207 KB), `modules/dash2mp4/` (15 KB),
      `modules/utils/*` except `EnvUtils.mjs` (54 KB; several imported
      `../enums/`/`../ui/` paths that don't exist in this repo),
      duplicate `modules/eventemitter/` dir, `modules/Localize.mjs`,
      `modules/hls/Mp4Sample.mjs`.
- [x] **(Session 6) Repo-level dead files deleted:** both `page source*` HTML
      dumps (243 KB), `legacy/site-adapter.js` (156 KB; `legacy/` dir removed),
      `unified-app.config.json` (byte-identical to `app.config.json`),
      `factory-candidate.config.json` (provenance pointing at paths not in this
      repo). `ci.yml` JSON loop updated to `manifest.json app.config.json`.
- [x] **(Session 6) Dead code removed:** `folderName()` in
      `background-enhanced.js`, `anchorForCard()` in `post-actions.js`, and in
      `background-bridge.js` the unreachable handlers `handleActionClick`,
      `handleParseM3U8Message`, `handleFetchM3U8PlaylistMessage`,
      `handleDownloadBlobMessage` (+ helpers `getDownloadFolder`,
      `resolveSenderOrActiveTabId`, `getActiveTabId` whose only callers were
      the removed code). Freeze-block public API trimmed 36 → 24 members
      (everything exported is now actually called by a consumer).
- [x] **(Session 6) `web_accessible_resources` narrowed:** offscreen + `modules/**`
      blocks removed (extension-context loads never needed WAR) and the
      remaining `inject.js` + 2 CSS block is restricted to the two supported
      sites instead of `<all_urls>`. Version bumped **4.4.0 → 4.4.1**.
- [x] **(Session 6) `docs/THIRD_PARTY_LICENSES.md` rewritten** for the surviving
      vendored set (hls.js Apache-2.0 note added — it was previously missing);
      mediabunny/mp4box notes dropped with their files.

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
- [ ] **(Session 6) Remux-only hls.js build** — `modules/hls/hls.mjs` is a ~400 KB
      full-player hls.js bundle, but `transmuxer.mjs` only imports 6 symbols
      (`TSDemuxer, MP4Remuxer, MP4Demuxer, AACDemuxer, MP3Demuxer,
      PassThroughRemuxer`). A tree-shaken remux-only build is ~80–120 KB
      (another ~300 KB off the package). Needs a minimal build step (repo has
      no `package.json` today) + a real-browser HLS download regression test
      before swapping the bundle.
- [ ] **(Session 6) Consolidate dual-payload progress forwarding** —
      `background-bridge.js` `forwardProgressMessages` sends a canonical AND a
      legacy message per progress tick; `content-bridge.js` still listens to
      both (`hlsProgress`/`mp4Progress`/…). Drop the legacy shape on both sides
      (coordinated change; needs browser test of progress toasts).
- [ ] **(Session 6) Queue-restore hardening** — `restoreQueueState()` restores
      non-numeric `activeQueueJobs` keys (`queue-job-N`, persisted before the
      chrome download id exists) without a liveness check (numeric keys DO get
      `chrome.downloads.get` verification). A SW death mid-job can zombie a
      concurrency slot for up to 3h. Drop temp keys on restore, or re-attempt
      the job.
- [ ] **(Session 6) Host-probe both-fail state** — when both rule34.world roots
      fail a probe, `getWorldHostStatus()` caches `{cdnOk:false,originOk:false}`
      for the full 10-min TTL with no log line. Log a warning; optionally use a
      shorter TTL (e.g. 60 s) for the double-failure state so transient
      outages self-heal faster.
- [ ] **(Session 6) Minor nits:** offscreen.js message handlers `return true`
      after already responding synchronously (harmless; `false` would be
      cleaner); optionally hoist the `const batchPending = []` declaration in
      `background-enhanced.js` above the queue helpers (verified NOT a bug —
      nothing calls those helpers before evaluation reaches line ~715, but the
      ordering is fragile).
- [ ] Optional: batch pagination / auto-scroll for rule34.world. Session 3
      confirmed the exact API from gallery-dl's extractor: `POST
      {root}/api/v2/post/search/root` with JSON
      `{ includeTags, Skip, take, CountTotal:false, IncludeLinks:true,
      OrderBy:0, cursor }` → `{ items, cursor }` (60/page);
      `/v2/post/search/playlist/{id}` for playlists.
- [ ] Optional: image posts on rule34video.com (currently video-focused).
- [ ] Optional: "already downloaded" dedupe via `chrome.downloads` history
      (match by filename; note signed rule34video URLs differ per resolve).

## Git notes

- PR #1 = merged (`42cc212`). PR #2 = session-2 fixes. PR #3 = session-3
  review fixes (this session).
- Always merge with a **merge commit** (`gh pr merge <n> --merge`), not squash.
- `git fetch origin` and work from `origin/main` at the start of every session;
  the local checkout may be behind.
