# Worklist — Rule34 Downloader

Status key: `[x]` done · `[~]` in progress · `[ ]` todo

Last updated: 2026-09-04 (world-domain listing pass — fetch deeper + From/To
picker + stop-in-button; see IMPROVEMENT_LOG.md).
PR #1 merged (rebrand + queue + batch).
PR #2 = session-2 bug fixes (popup fallback + image routing).
PR #3 = session-3 review fixes (CDN outage handling + persistent queue).
Session 6 = dead-code purge + scrapyard retention + hardening pass
(extension 2.2 MB → 0.85 MB; v4.4.2; ci.yml fixed by owner, CI green).
Session 8 = source-separated, tag-named output folders (v5.0.0): master
folder + automatic per-site folder + tag/artist collection folder + picture-set
archives, ported from the sister project `nh-dw-2.0` (PR #30 / `9f86426`).

## Follow-ups from the world-domain listing pass (next)

Open tasks carried forward from the fetch-deeper / From-To / stop-in-button
pass. Feasibility without extra data is noted per item — anything marked
"needs data" is deliberately **not** being built blind.

- [ ] **(World — ROOT CAUSE of "acts like a single page" found, code fix pending)**
      Live captures (2026-09-04) prove the world crawler sends the WRONG JSON
      keys. The extension posts `{ Skip, take, CountTotal, IncludeLinks,
      OrderBy }`, but `POST rule34.world/api/v2/post/search/root` actually reads
      a different lowercase payload the site itself sends:
      `{ skip, cursor, take, countTotal, checkHasMore, filterAi, sortBy,
      includeTags }`. JSON keys are case-sensitive, so the API ignores the
      extension's `Skip`/`CountTotal`/`OrderBy` and returns page 1 every time —
      the world crawl can never advance past the newest page. Response shape is
      `{ items: [{id,type,duration,files,…}], cursor: "<lastId>", hasMore:
      bool }` with **no** total-count field. Confirmed values: `skip` advances
      by 30/page and the returned `cursor` equals the last returned post id;
      termination is `hasMore:false`. Fix = make `worldSearchBody` +
      `worldAdapter` send the real lowercase payload, thread the returned
      `cursor` into the next request, and stop on `hasMore:false`. See the
      "World crawler" item in the ordered To-do below. **One open decision (ask
      the owner): sequential keyset walk vs skip-only offset** — affects whether
      a deep "From page N" can jump straight there or must walk pages 1→N.
      rule34video.com (canonical page-URL scraper) is unaffected by all of this.
- [ ] **(World — live tag/search capture for the filter payload — PENDING,
      needs live data, carry to a future session)** The root-feed capture above
      (`includeTags:[]`, `sortBy:0`, `filterAi:false`) came from the homepage
      feed. A **tag / search / pics-only / videos-only** listing almost
      certainly adds fields to the payload (how `includeTags` carries the tag,
      how the media-type filter is expressed, how sorting is requested). We will
      NOT over-tune the adapter against the root feed alone. **Data needed:**
      one request body + one response JSON for (a) a tag page like `/touhou`,
      (b) a pics-only or videos-only filtered listing, and (c) a playlist, if
      you want those to paginate correctly from the start. Until then the world
      adapter can be built to the root schema and verified against a real
      tag/search afterward.
- [ ] **(Video domain — verify the new fetch UI on rule34video.com)** The
      From/To picker, batch button, stop-morph and the engine fixes
      (widened re-fetch walks every page; empty page ends a bounded walk) are
      all in **shared** code, so rule34video.com already gets them. What is
      left is **live verification** that a real video listing pre-fills
      correctly (known total → To = last page / batch), that re-fetching a
      widened range lists the new pages, and that nothing video-specific
      regressed (playlists, member/artist, homepage crawl). **Data that helps
      (optional but recommended):** one real saved listing page each for a
      rule34video.com **search**, **tag**, **playlist** and **member** page
      (they all share card markup but the main-block id differs), captured
      like `source/page-source/rule34video-listing.html`. Without those, the
      offline suites + the existing saved listing still pass, but real-browser
      confirmation needs a manual check.
- [ ] **(World "Show More"/deep DOM driver — Twitter-style in-page crawl)**
      Porting the Twitter-repo style "drive the page to load older posts"
      against rule34.world. The site is an Angular SPA that appends older
      posts (a Show-More / infinite-scroll behaviour). **This is NOT being
      built blind** — the API crawl already fetches the same older posts and
      now stops correctly. **Data needed before coding:** one captured DOM
      (`document.body.innerHTML`, or DevTools copy of the grid root) of a
      rule34.world listing **before** and **after** clicking "Show more" /
      scrolling to the bottom (to see whether it is a button vs pure scroll and
      what class/id the appended-card container + button use), plus a note of
      any "we're out of posts / you've reached the end" element. Only then can
      the content-script driver (`content-rule34world.js`) be written against
      real selectors.
- [ ] **(World — pin the API total-count field live)** We broadened total
      detection across response shapes, but the single live field name has not
      been confirmed. **Data needed:** one raw JSON body returned by
      `POST https://rule34.world/api/v2/post/search/root` (paste the response,
      ids can be stripped) so we can pin the exact field and simplify.
- [ ] **(Video domain — optional "single page" quick action)** A dedicated
      one-click **List this page** already exists; if video wants a distinct
      *single-page fetch* vs the *From/To* multi-page flow, that is a small UI
      nicety and needs no data.

## Done

- [x] **(World-domain listing pass) Fetch deeper + From/To picker + stop-in-button** —
      rule34.world listings no longer act like a single page. Engine: a bounded
      explicit range (`1-5`) now always walks every requested page — widening a
      fetch `1-2` → `1-5` really lists pages 3-5 instead of stopping on the
      already-listed 1-2 (duplicate-based early-stop only applies to open-ended
      "to the last page" crawls now); open-ended-from-page (`2-`) works even
      when the API reports no total (walks a bounded batch, stops when dry);
      rule34.world total-count detection broadened across response shapes.
      Panel: the one `Pages` box became **From / To** whole-page fields with a
      live hint, an **advanced** free-text mode (`2,4,6-10 · all · 50-`), a
      **batch** pre-fill, and a warning/confirm for an uncapped "to the last
      page" fetch. The listing fetch button **morphs into "Stop fetch"** while a
      crawl runs and its Download hides (nothing pushed off-screen); `.action-row`
      also flex-wraps as a fallback. Regression tests in `panel-queue.test.mjs`.
      **(Follow-ups: apply the same fetch/UI pass to rule34video.com; drive the
      live page's Show-More DOM on world as an optional deep-crawl once its
      selectors are captured — not shipped blind.)**
- [x] **(Session 10, 6.0.0–6.0.1) UI/UX rework and safety follow-up** — popup
      → Side Panel queue (Twitter-style rows/counters/dock), generic toolbar →
      per-site URL-routed content scripts, and an inspect-first nh-dw page
      fetcher. rule34video.com crawls regular canonical page URLs (not the
      failing KVS ajax endpoint); each fetch is a bounded 150-page maximum and
      only lists checked rows until **Download selected** is pressed. Includes
      rule34video.com playlists + homepage/search crawling and rule34.world
      pics+videos batch fetch through the search API. New offline suites
      `site-routes.test.mjs` + `panel-queue.test.mjs`.
- [x] **(Session 10) Second-pass fixes** — real rule34.world format ladder
      (`100/114/113/112/111`, `101/102` flagged as previews), listing parser
      scoped to the main block, slug-less `/video/{id}/` URLs padded (the site
      404s on them), fetch Stop aborts active listing requests, panel Stop now
      reaches the offscreen `CANCEL_*` handlers (they had no sender), and
      update banner CSS scoped to the panel.

- [x] **(Session 8, 5.0.0) Master folder** — `chrome.storage.sync`
      `masterFolder`, default `R34V`; empty string = off (flat layout); slashes
      nest. Popup input wired by hand so the empty value is savable.
- [x] **(Session 8) Automatic per-site folder** — hostname → short slug map in
      `extension/folder-naming.js` (`rule34video`, `rule34world`); unknown hosts
      get their own folder instead of merging; the two sites can never share one.
- [x] **(Session 8) Collection folder naming** — template string
      (`{artist} - {title} - {id}`) with one checkbox per token, one checkbox
      per page tag, a manual override field, and the search/tag-results query;
      live preview; priority manual → template → search → post id → `untagged`;
      artist-folder mode.
- [x] **(Session 8) Path hardening** — `sanitizeArtifactFilename` ported
      verbatim, Windows reserved names prefixed, 120-char segment cap, 240-char
      total cap, `..`/absolute paths impossible.
- [x] **(Session 8) Filename authority** — permanent `onDeterminingFilename`
      guard re-suggests the full path for every artifact this extension starts
      (beats Content-Disposition, blob-UUID naming and other extensions'
      listeners); unrelated downloads untouched.
- [x] **(Session 8) Picture sets** — loose numbered originals, or one
      ZIP/CBZ/PDF per post built in the offscreen document with the new
      dependency-free `modules/archive/zipBuilder.mjs` + ported `pdfBuilder.mjs`.
- [x] **(Session 8) Fixed: offscreen videos ignored the folder path** —
      `chrome.downloads` does not exist in an offscreen document, so the MP4
      pipeline always fell back to the in-document anchor and saved flat in the
      download root. Blobs are now relayed to the service worker, which owns
      `chrome.downloads` and the folder path.
- [x] **(Session 8) Fixed: offscreen double folder** — `scopedFileName()`
      prepended `SiteConfig.OFFSCREEN.downloadFolder` ("Rule 34") to a name that
      already contained the template path. Removed; the worker supplies the
      complete relative path. Unused `chromeDownload()` helper deleted.
- [x] **(Session 8) Tests** — `node --test` fixture suites (naming 31, ZIP 10,
      PDF 12) + a 50-check window-less VM e2e driving the real service worker
      and offscreen document; `smoke.mjs` mock extended; all offline.
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
        JSON parse, forbidden-paywall grep, and a committed `source/tests/smoke.mjs`
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
- [x] **(Session 6) Orphaned vendored modules removed from the extension**
      (verified unreachable by entry-point reachability trace — the only path
      into `modules/` is `offscreen.js → hls2mp4/simple-converter.mjs`):
      `modules/mediabunny/` (61 files, 798 KB), `modules/mp4box.mjs` (311 KB),
      `modules/reencoder/` (207 KB), `modules/dash2mp4/` (15 KB),
      `modules/utils/*` except `EnvUtils.mjs` (54 KB; several imported
      `../enums/`/`../ui/` paths that don't exist in this repo),
      duplicate `modules/eventemitter/` dir, `modules/Localize.mjs`,
      `modules/hls/Mp4Sample.mjs`.
      **Same-session amendment:** after review, the owner asked for retired
      but potentially-useful code to be retained — all of the above except the
      byte-identical `eventemitter/` duplicate now lives under `source/`
      (repo-only, never packaged). See `source/README.md`.
      **Session 7 amendment:** the scrapyard was split by provenance —
      `source/retired/` (retired code that WAS used as extension files:
      `site-adapter.js`, `mp4box.mjs`, `dash2mp4/`, `reencoder/`,
      `hls/Mp4Sample.mjs`, `utils/BlobManager.mjs`) and
      `source/vendor/` + `source/page-source/`
      (never used as extension: `mediabunny/` TS sources, `Localize.mjs`, the
      13 source-project `utils/` fragments, `page-source/*.html`).
- [x] **(Session 6) Repo-level dead files removed:** both `page source*` HTML
      dumps (243 KB → kept as `source/page-source/*` under descriptive
      names), `legacy/site-adapter.js` (156 KB → `source/retired/site-adapter.js`;
      `legacy/` dir removed), `unified-app.config.json` (byte-identical to
      `app.config.json` — deleted outright, no unique content),
      `factory-candidate.config.json` (provenance pointing at paths not in
      this repo — deleted outright). `ci.yml` JSON loop **must** be updated to
      `manifest.json app.config.json` — see session 6 note in IMPROVEMENT_LOG
      (the fix could not be pushed; owner applies it manually).
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

> Load the unpacked extension from `extension/` at
> `chrome://extensions` (Developer mode), then test on the live sites.

> 6.0.0: read "popup" as **Side Panel**, "Download visible" toolbar as the
> bottom **pill** ("Download page"), and expect nothing at all on unmatched
> URLs (`/terms`, `/auth/login`, …).

### rule34video.com
- [ ] Listing page: corner `↓` button appears on each `.item.thumb` card.
- [ ] Clicking a corner button queues exactly that post (row in the panel).
- [ ] Pill "Download page" queues all cards of the page; pressing it again
      re-arms already-listed rows instead of duplicating them.
- [ ] Single video page (`/video/{id}/{slug}/`): the panel's post card offers
      "Download this post / Add to list"; the row resolves to 1080p/720p/480p/360p
      and the quality preference picks the right one.
- [ ] Preview MP4s (`data-preview`, `_preview.mp4`) are never used as final downloads.
- [ ] Panel row title/thumbnail populate (from the resolver).
- [ ] Saved file is named `artist/title_1080p.mp4`-ish, not `video.mp4`.

### Naming feature (Session 8, v5.0.0) — live spot-check
- [ ] Same post via the **panel post card** vs via **corner `↓` button / pill
      "Download page"** lands in the **same** collection folder (same folder
      name). In 6.0.0 both go through `panel-queue.runItem` → `resolvePost` →
      `startDownload` with `__fromBatch` / `__searchContext` / `__panelKey`, so
      a mismatch means the resolver metadata is being dropped somewhere.
- [ ] A row listed from a **search page** names its folder after the query when
      the template is empty (`__searchContext` from `searchContextFor(route)`);
      the same post queued from its own page falls back to `artist - title - id`.
      See `source/docs/NAMING_REVIEW.md` (written for the v5 paths — the
      popup/corner-button distinction there is now panel-card/pill).
- [ ] A post whose title is all illegal chars (e.g. `???`) saves as
      `<artist> - <id>` (no double/trailing `- `), and a folder called `CON` /
      `NUL` still saves under a `_CON` / `_NUL` master folder.
- [ ] rule34.world post with an artist that also heads the title saves as
      `Artist - post <id>` (artist **not** duplicated).

### rule34.world
- [ ] Hot/listing page: corner `↓` button appears on each post card
      (**verify the `app-post-card` / `mat-card` / `[class*=post]` selectors**).
- [ ] Single video post (`/post/{id}`): the panel post card lists the real
      ladder (Source / 1080p / 720p / 480p / 360p as available) and **never a
      256p preview** while a real file exists. **Confirm which file each
      `WORLD_FORMATS` id really is** (`111`–`114` vs `101`/`102`) by
      downloading one post at "720p" and checking its resolution — this is the
      one unverified assumption of 6.0.0. (Video ids are in the high range —
      e.g. `/post/1391557`, 2026.)
- [ ] Tag page in the panel: "N pics · N videos", media filter all/video/image,
      page 2 in the panel == page 2 on the site (30/page), `1-3` / `all` crawls
      stop at the real end (or after two empty pages).
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
- [ ] The panel shows the update notice when a newer GitHub release exists
      (banner mounts in `sidepanel.html` `.container`, styled by `sidepanel.css`).
- [ ] Link points to `github.com/freeforall1932-design/rule34video/releases/latest`.

## To-do / improvements (ordered)

- [ ] **(Session 10, post-6.0.0) Review + bug hunt** — a fresh pass over the
      rework, in this order:
      1. Dead references to retired files: `site-config.js` `cssId`,
         `folder-naming.js` line ~21 comment, `background-bridge.js`
         content-progress forwarders (`notifyContentDownloadStarted`,
         `forwardMP4Progress`, …) — trim or leave with a note.
      2. Legacy helpers still reachable: `searchRule34VideoTag`,
         `searchRule34WorldPosts`, `processBatchJob` (`bulkDownloadTag` /
         `batchDownloadPosts`). `processBatchJob` picks `resolved.formats[0]`,
         not `pickFormat`, so it could download a flagged preview; route them
         through the panel engine or retire them.
      3. Panel ↔ worker contract: `panel.*` actions, `collectListing`,
         `routeMatch`, `openSidePanel`; the outcome/rebind hooks in
         `background-enhanced.js` (`chrome.downloads.onChanged`, the
         `MP4_/HLS_/IMAGE_SET_*` cases, `pumpDownloadQueue` hand-over,
         fallback-host `rebindDownload`) and the restore path
         (`panelQueue.restore()` + `restoreQueueState`).
      4. Loose image sets return only the **first** chrome download id → the
         panel row completes on image 1. Track all ids (or complete on the last).
      5. `panel-queue.js`: status `"skipped"` never assigned, `autoList`
         setting unused, `parsePageRange("all")` throws when `maxPage` is
         unknown while the engine has its own open-ended path — unify.
      6. `getDownloadLimit()` (legacy inner limit) vs the panel concurrency —
         one knob, or document the composition in the panel.
      7. `NAMING_REVIEW.md` describes the v5 capture paths; the v6 paths all go
         through `panel-queue.runItem` (`__fromBatch`, `__searchContext`,
         `__panelKey`) — re-read its findings against that.
- [ ] **(v6.0.1) Manual browser matrix for the Side Panel** — open the panel
      on: a rule34video.com video page (Download this post); a search/listing
      page (List this page = visible cards; **Fetch selected pages** `2-3`
      must show page 2 and page 3 rows even when page 1 is open; **Download
      selected** must be a separate, explicit action); a very large listing
      (Batch pre-fills no more than `1-150`); a playlist (Fetch page batch
      pill); and the homepage. Test Stop fetch while a request is delayed and
      verify no later page is requested. Also test rule34.world post (picture
      and video), a tag page (media filter pics / videos; page 2 in the panel
      == page 2 on the site), `/hot`, and a playlist while logged in. Choose
      **3 Downloads at once**, start more than three selected rows, and verify
      only three are active. Check the toolbar icon, context-menu item, and
      restore after a `chrome://extensions` reload.
- [ ] **(World crawler — confirmed API fix)** `panel-queue.js` worldAdapter +
      `site-routes.js` worldSearchBody must be rewritten to the REAL payload the
      site sends (`{skip, cursor, take, countTotal:false, checkHasMore:true,
      filterAi:false, sortBy, includeTags}`, lowercase, with the returned
      `cursor` threaded into the next request and `hasMore:false` as the stop),
      because the current `Skip`/`CountTotal`/`OrderBy` casing is ignored by
      the API and the crawl never leaves page 1. Decide sequential-keyset vs
      skip-offset first (see Follow-ups). Update the offline fixtures to model
      `{items, cursor, hasMore}` so it is regression-tested. rule34video.com
      unaffected (canonical page-URL scraper).
- [ ] **(Session 10)** ~~rule34.world total-count field in the search response~~ —
      SUPERSEDED: the live response has **no total-count field** (2026-09-04).
      Termination is `hasMore:false` and page size is `take:30`; the crawler
      walks a bounded range and stops on `hasMore:false` rather than reading a
      page total.
- [ ] **(Session 10)** `background-bridge.js` still carries the v5 content
      progress forwarders (`notifyContentDownloadStarted`, `forwardMP4Progress`,
      …). They are harmless (no receiver) but could be trimmed together with
      the legacy `downloadVideo` / `batchDownloadPosts` handlers once nothing
      external depends on them.

- [ ] **Verify rule34.world listing-card selectors on a live page**; adjust
      `content-rule34world.js` `CARD_SELECTOR` / `cardsOnPage()` if needed.
      (rule34video.com selectors were verified against live HTML in session 3.)
- [ ] **(Session 6) Remux-only hls.js build** — `modules/hls/hls.mjs` is a ~400 KB
      full-player hls.js bundle, but `transmuxer.mjs` only imports 6 symbols
      (`TSDemuxer, MP4Remuxer, MP4Demuxer, AACDemuxer, MP3Demuxer,
      PassThroughRemuxer`).
      **Measured in the session-6 sandbox (esbuild, hls.js@1.5.20):**
      - Re-bundling the *vendored* minified file: **393 KB — no win** (the
        single-file bundle defeats tree-shaking).
      - Bundling the 6 classes from upstream `hls.js/src` TypeScript:
        **67.0 KB, all 6 symbols exported** → ~340 KB off the package.
      The win requires a build step (`esbuild` + pinned `hls.js` + `url-toolkit`)
      and deep imports into non-public upstream paths (version-pinned; class
      constructor/error-detail APIs must be re-verified against what
      `hls2mp4/transmuxer.mjs` uses), plus a real-browser HLS download
      regression test before swapping the bundle. Adoption recipe lives in
      IMPROVEMENT_LOG session 6 close-out.
- [x] **(Session 9) Consolidated dual-payload progress forwarding** —
      `forwardProgressMessages` no longer sends a legacy message beside the
      canonical `downloadProgress` one (the canonical payload is a strict
      superset), `content-bridge.js` dropped the six legacy handlers and their
      label table, and the offscreen document's unreachable `"actionData"`
      message style went with them. The three duplicate `hlsProgress`/
      `hlsComplete`/`hlsError` cases in the worker's message router are gone
      too — nothing emitted those action names any more. One message per tick
      instead of two. **Still wants a browser check of the progress toasts.**
- [x] **(Session 6 hardening pass, 4.4.2) Queue-restore temp keys** —
      `restoreQueueState()` now drops non-numeric `activeQueueJobs` keys
      (`queue-job-N` persisted before the chrome download id existed) instead
      of zombie-blocking a concurrency slot for up to 3 h. Verified with a
      mocked-chrome harness: temp key dropped, live numeric key re-tracked,
      dead numeric key dropped.
- [x] **(Session 6 hardening pass, 4.4.2) Host-probe both-fail state** —
      `getWorldHostStatus()` now logs a warning when both rule34.world roots
      fail, and the both-fail state re-probes after 60 s
      (`WORLD_HOST_PROBE_FAIL_TTL_MS`) instead of pinning for the full 10 min.
- [x] **(Session 6 hardening pass, 4.4.2) Minor nits** — offscreen sync-ack
      branches (`processHLS`, `PROCESS_HLS_SEGMENTS`, `PROCESS_MP4_DOWNLOAD`)
      now `return false` after the synchronous ack instead of holding the
      channel open with `return true`; `const batchPending = []` hoisted above
      the queue helpers it references (was verified not a bug — this removes
      the fragility).
- [ ] Optional: batch pagination / auto-scroll for rule34.world. Live capture
      (2026-09-04) supersedes the old gallery-dl-derived guess: `POST
      {root}/api/v2/post/search/root` with the real payload
      `{ skip, cursor, take:30, countTotal:false, checkHasMore:true,
      filterAi:false, sortBy, includeTags }` → `{ items:[{id,type,duration,
      files,…}], cursor:"<lastId>", hasMore:bool }` (30/page, cursor = last id,
      no total). `/v2/post/search/playlist/{id}` is the playlist variant.
- [x] **(Session 9) Simplified CI workflow applied by the owner.** GitHub
      rejected the agent's push (the bot token has no `workflows` scope), so
      the file shipped as `source/docs/ci-workflow.pending.yml` and the owner
      copied it over `.github/workflows/ci.yml` via the web UI (commit
      `e695faa`). Verified byte-identical and green on the branch: one job,
      "Validate and test". The pending file has been deleted now that it is a
      stale duplicate. Three near-duplicate jobs (each re-running checkout +
      setup-node, with an inlined classic-script list that had **drifted** from
      the near-identical one in `package.json`) became one job of four
      `npm run` steps, with the validation logic in
      `source/tools/validate.mjs`, which derives the file list from disk so no
      new extension file can be silently skipped.
- [ ] **(Session 8) Live-browser verification of the new metadata
      extraction.** `collectRule34VideoTags` / `collectRule34VideoUploader` /
      `collectRule34VideoDate` were written against the saved
      `source/page-source/rule34video-listing.html` (tag anchors
      `/tags/<id>/` → anchor text, `/models/<slug>/`, `<time datetime>`), not
      against a live post page. If a markup change breaks one, only the
      matching token/checkbox loses data — the download still works.
- [ ] **(Session 8) Manual checks that need a real browser:** a PDF opens in a
      viewer with the right page order and orientation (no PDF tool in CI); a
      CBZ opens in a comic reader; the master folder really is created under
      the user's fixed download location with "Ask where to save" OFF; the
      anchor fallback path (only reachable if the worker relay fails).
- [ ] **(Session 8) Optional: multi-image posts.** The picture-set pipeline is
      written for N images (`001.jpg…`, every image in the archive), but both
      current sites expose one original file per post, so today's archives hold
      a single page. Wire up albums automatically if a resolver ever returns
      several image formats.
- [ ] Optional: image posts on rule34video.com (currently video-focused).
- [ ] Optional: "already downloaded" dedupe via `chrome.downloads` history
      (match by filename; note signed rule34video URLs differ per resolve).

## Git notes

- PR #1 = merged (`42cc212`). PR #2 = session-2 fixes. PR #3 = session-3
  review fixes. PR #4–#7 = sessions 4–7 (purge, restructure, CI). PR #8 =
  session 8 (5.0.0 output folders). PR #9 = session 9 (review pass,
  queue-restore fix, CI rewrite). PR #10 = session 10 (6.0.0 UI/UX rework,
  this session). All merged with merge commits.
- Always merge with a **merge commit** (`gh pr merge <n> --merge`), not squash.
- `git fetch origin` and work from `origin/main` at the start of every session;
  the local checkout may be behind.
