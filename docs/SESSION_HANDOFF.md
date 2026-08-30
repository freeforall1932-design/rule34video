# Session Handoff — Rule34 Downloader (fresh-context handoff)

> Purpose: a **fresh-context-window handoff**. It records the true repository
> state, what every session has done, what was found & fixed *this* session,
> what features already exist, and exactly what is left — so a new session can
> pick up without re-deriving anything.
>
> Written: 2026-08-29 (Asia/Jakarta) by the Arena.ai coding agent.
> Updated: 2026-08-30 (session 3 — review + missing-logic fixes).

---

## 0. TL;DR — session 3: CDN outage found + persistent queue shipped

Session 3 (this one) did a **full codebase review with live-site verification**
and fixed the biggest real-world bug found so far:

1. **rule34.world's file CDN (`rule34storage.b-cdn.net`) is DOWN** — HTTP 500
   for every post sampled (old + new, image + video) while the `rule34.world`
   origin serves the identical files fine. The post API still flags the CDN,
   so the old resolver produced **broken URLs for every rule34.world
   download**. Fixed with a per-session host probe + `fallbackUrl` retry
   (see §5 bug C). Verified live from the sandbox on 2026-08-30.
2. **Persistent session queue** (explicit user request): the queue, batch
   list, and active slots now survive MV3 service-worker restarts via
   `chrome.storage.local` + restore-on-startup, with a queue list UI in the
   popup (see §4/§5).
3. Batch hardening (dedupe, parallel resolution, no notification spam),
   signed-link re-resolve on dispatch failure, filename title fix,
   TELEMETRY_LOG handler. Version bumped **4.1.1 → 4.2.0** (PR #3).
4. **Session 4 (this one) — retrofit to free community + quality-of-life.**
   Per the user's retrofit goal (paid/licensed → free community), the audit
   found and removed stale paywall/branding (`license_code`, `.activate-btn`
   activation CSS, dead `action.onClicked`), renamed `Serp*` → `Rule34*`
   identifiers, and added a top-level MIT `LICENSE` + `docs/THIRD_PARTY_LICENSES.md`
   (mediabunny MPL-2.0, mp4box BSD-3). The generic multi-hoster `site-adapter.js`
   is **gated** (kept but no longer loaded on the two rule34 sites; its
   background fallback is inert) and `host_permissions` narrowed to the two sites
   + BunnyCDN + `api.github.com`. New **Smart Library** auto-organization
   (configurable `{site}/{artist}/{title}` download-path template) and **bulk
   "download by tag / playlist"** for rule34.world (cursor-paginated search API).
   Version bumped **4.2.0 → 4.3.0**. Full write-up: `docs/RETROFIT_AUDIT.md`.

Prior history: the "missing PR" mystery from session 2 is resolved —
PR #1 **was** merged (`42cc212`) and PR #2 merged the session-2 fixes.
**New sessions must always `git fetch origin` and work from `origin/main`
first** — do not trust the local checkout to be current.

---

## 1. Repository / branch state

- Repo: `freeforall1932-design/rule34video`
- Working copy: `/home/user/rule34video`
- Extension dir: `/home/user/rule34video/rule34video downloader`  (note the space)
- Docs dir: `/home/user/rule34video/docs`
- Session branch (session 3): `arena/01a0507e-rule34video`
- Base: `origin/main` @ `bb4ccca` (PR #2 merge), version `4.1.1` → bumped to **`4.2.0`**.
- **The sandbox clone is shallow** (1 commit) — don't be alarmed by a short
  `git log`; `origin/main` is still the source of truth.
- GitHub auth is the `arena-ai-coding-agent[bot]` token (`gh` + `git` work).
- The two `page source*.txt|html` files at the repo root are saved reference
  HTML: `page source.txt` = rule34video.com **listing** page (cards, previews
  only — no download links), `page source for rule34 world` = rule34.world
  **Angular shell** (no SSR content). A live post page + API shapes were
  verified directly in session 3.
- Useful reference repo: `freeforall1932-design/gallery-dl` (user's fork) —
  `gallery_dl/extractor/rule34xyz.py` is the canonical rule34.world/.xyz
  extractor (format map, CDN flag logic, search/pagination API).

---

## 2. What the product is

A **Manifest V3 Chrome/Edge browser extension** — a **free, community
"Downloader for Rule 34"** that supports BOTH target sites:

- **rule34.world** — Angular SPA; post data via `https://rule34.world/api/v2/post/{id}`;
  media on the BunnyCDN host `https://rule34storage.b-cdn.net`.
- **rule34video.com** — KVS-style site; signed `get_file/..._{height}p.mp4`
  download links live in the post-page HTML.

All third-party paywall/auth/trial machinery from the original generator
(serp.co / serp.ly / gumroad / activation license / 3-download trial) was
**removed** in PR #1. The extension is fully free.

---

## 3. Architecture (how the pieces fit)

### 3.1 Extension surfaces (`manifest.json`)
- **Service worker (module):** `background-enhanced.js` — imports
  `site-config.js`, `logger.js`, `background-bridge.js`. (The generic
  multi-hoster `site-adapter.js` is **gated** — kept in the repo but no longer
  imported or injected; the rule34 resolvers handle both target sites.) Holds
  the download queue, post resolvers, batch engine, the Smart Library path
  builder, the rule34.world tag/playlist search, and the central
  `chrome.runtime.onMessage` router.
- **Content scripts** (run `document_idle` on both sites), in order:
  `site-config.js → logger.js → download-manager.js → content-bridge.js →
  content.js → player-button.js → post-actions.js`.
- **Popup:** `popup.html` + `popup.js` (+ `site-config.js`, `logger.js`,
  `update-notifier.js`). The paywall-era `auth-ui.js` / `trial-banner.js`
  scripts were deleted in PR #1 and are no longer referenced by `popup.html`.
- **Offscreen document:** `offscreen.html` → `site-config.js`, `logger.js`,
  `offscreen.js` (module). Does the heavy HLS-transmux / MP4-fetch work.
- **Injected page script:** `inject.js` (web-accessible).

### 3.2 Request flow (single post)
1. Popup queries the active tab.
2. Popup asks the **content script** for `getVideoInfo` (DOM/observation based).
3. Popup asks the **background** for `getVideoFormats`. Background has a
   **fast-path resolver** (`resolveKnownPost`) that hits the rule34.world API
   or scrapes the rule34video.com post HTML — this is the reliable path for
   these sites. It falls back to the generic `site-adapter.js` detector, then
   observed webRequest media.
4. User picks a quality → popup sends `downloadVideo` → background routes to
   chrome download / offscreen MP4 / HLS / tab-download / xiaoshenke resolver.
5. All single downloads go through `queueDownloadRequest`, which honors the
   user-configurable concurrency limit.

### 3.3 Batch flow (corner buttons)
- `post-actions.js` (content) adds a corner `↓` button to every post card and
  a floating "Download visible (N)" toolbar. Both send
  `{ action: "batchDownloadPosts", urls }`.
- Background `enqueueBatchDownloads` → `processBatchQueue` → resolves each post,
  picks the best format, pushes through `queueDownloadRequest` (so the
  concurrency limit applies), and streams `{ action: "batchPostStatus" }`
  toasts back to the tab.
- Card buttons & toolbar **do not depend on the popup** — they always worked.

---

## 4. Features that ALREADY EXIST (do not rebuild)

- Free rebrand; all auth/license/trial/paywall code deleted; update checker
  repointed to `freeforall1932-design/rule34video` GitHub releases.
- **Dual-site post resolvers** in `background-enhanced.js`:
  - rule34video.com: scrapes signed `get_file` MP4 links, prefers
    `download=true` links, skips `_preview.mp4`, sorts highest-res first.
  - rule34.world: `/api/v2/post/{id}` → builds CDN URLs
    (`{cdn}/posts/{id//1000}/{id}/{id}.{ext}`); formats `100` Source MP4,
    `101` 720p, `102` 480p, `10` Image; title from artist tag (`type===8`).
- **Configurable concurrency queue**: storage key `downloadConcurrencyLimit`
  (0/empty = Unlimited, max 99). Slider (0–10) + numeric input in the popup,
  live `N active • M queued`, auto-dispatch on slot free, re-pump on limit
  change, stale-job purge (3h), cancel handling.
- **Persistent session queue (session 3)**: `downloadQueue` + `batchPending`
  + `activeQueueJobs` mirrored to `chrome.storage.local`
  (`r34.queueState.v1`) on every mutation (250ms debounce), flushed on
  `onSuspend`, restored on SW startup (stale >3h dropped; numeric download
  ids re-verified via `chrome.downloads.get`). 500-job cap. New messages:
  `getQueueItems` (active/queued list for the popup) and `clearQueue`
  (drops queued jobs + pending batch). Popup shows a live "Download queue"
  list with per-item cancel + Clear.
- **Batch backend** (`enqueueBatchDownloads`, `processBatchQueue`,
  `sendBatchStatus`, `BATCH_MAX_URLS=300`, 5-wide parallel resolution) +
  `batchDownloadPosts` handler. Dedupes against pending batch, queued jobs
  AND active downloads (reports `skipped`); no per-item browser
  notifications for batch-originated queue entries.
- **rule34.world host probe + fallback retry (session 3)**: both file roots
  (`rule34storage.b-cdn.net` CDN vs `rule34.world` origin) probed once per
  session (HEAD → `GET Range` fallback, 10-min TTL); formats built on the
  healthy root; `fallbackUrl` on the other healthy root. Interrupted
  (non-user-cancelled) chrome downloads restart once on the fallback host.
- **Re-resolve on dispatch failure (session 3)**: rule34 post jobs that fail
  at dispatch re-resolve the post page/API once and retry with fresh
  formats/signed links (signed-URL expiry safety).
- **Per-card corner buttons + visible-batch toolbar + toasts** (`post-actions.js`),
  MutationObserver for infinite scroll / Angular re-renders, scroll-based count.
  Toast distinguishes "already in queue" (skipped) from new enqueue.
- Extension-aware filenames (`.mp4` vs `.jpg`), download folder from config;
  `downloadVideo` applies resolver `apiTitle` when the caller had no title.
- Rich generic media detection inherited from the generator (`site-adapter.js`):
  HLS/DASH, many third-party hosters (eporner, voe, streamtape, dood,
  nhplayer, xiaoshenke, byse/q8 proof-of-work, etc.) — mostly irrelevant to
  the two rule34 sites but harmless.
- Offscreen HLS transmux + MP4 fetch (`offscreen.js` + `modules/`), progress
  manager, context menu, notifications.
- **Smart Library download-path template (session 4):** configurable
  `{site}/{artist}/{title}` folder layout (popup control + presets), stored in
  `downloadPathTemplate`; each token sanitized, empty segments collapse. The
  rule34.world resolver supplies the artist tag (returned as `artist`).
- **Bulk download by tag / playlist (session 4):** popup "Download tag" enqueues
  a whole rule34.world tag search or playlist via the cursor-paginated
  `/api/v2/post/search/root` (and `/v2/post/search/playlist/{id}`) API, reusing
  the existing batch engine. (rule34video.com tag search not yet wired — see §6.)
- **Generic multi-hoster surface gated (session 4):** `site-adapter.js` is no
  longer injected into rule34 pages and its background fallback is inert;
  `host_permissions` narrowed to the two sites + BunnyCDN + api.github.com.
- **Licensing clarity (session 4):** top-level `LICENSE` (MIT) +
  `docs/THIRD_PARTY_LICENSES.md`.

---

## 5. Bugs FOUND & FIXED this session (PR #2)

### Bug A — Popup could never reach the working resolver on single posts
**File:** `popup.js` (`initializeMainContent`).
The popup hard-required the content script's `getVideoInfo` to succeed before
it ever called `getVideoFormats`. On rule34.world (Angular shell, no media in
static DOM) and some lazy rule34video players, `getVideoInfo` returns nothing
usable, so the popup showed **"No video found"** and the reliable background
post-resolver was never invoked. (Corner buttons were unaffected.)
**Fix:** Added `supportedPostUrl()` + `fallbackVideoInfoForTab(tab)`. When the
content-side extraction fails on a supported rule34 post URL, the popup builds
a minimal `{ url, webpage_url, pageUrl, … }` record and proceeds to
`loadFormats`, letting the background resolver return formats + `apiTitle` +
`apiThumbnail`. Non-supported pages still show the normal error.

### Bug B — rule34.world image posts routed into the MP4/offscreen pipeline
**File:** `background-enhanced.js` (`shouldUseOffscreenMp4`).
Image posts have `format_type: "image"` and a cross-origin CDN URL
(`b-cdn.net`), so the old "cross-origin referer" check sent them to the
offscreen **MP4** downloader, which expects media and can fail/block images.
**Fix:** `shouldUseOffscreenMp4` now returns `false` for image formats
(`format_type === "image"` or ext jpg/png/webp/gif/bmp/avif), so images take
the normal direct Chrome download path.

### Also
- Bumped `manifest.json` `4.1.0 → 4.1.1`.
- Re-validated: all JS passes `node --check` (bg as ESM), all JSON parses,
  forbidden-paywall grep is clean (see §8).

### Bug C — rule34.world file CDN down → every world download 500s (session 3, PR #3)
**Files:** `background-enhanced.js` (`resolveRule34WorldPost`, new
`probeMediaUrl`/`getWorldHostStatus`, `retryInterruptedDownload`).
Live check on 2026-08-30: `rule34storage.b-cdn.net` returns HTTP 500 for
every sampled post (e.g. `/posts/1280/1280481/1280481.pic.jpg`,
`/posts/3571/3571567/3571567.mov720.mp4`, `/posts/0/100/100.pic.jpg`) while
`rule34.world` serves the same paths with 200. The post API's per-file flag
(`files: { "10": [2], ... }`, flag[0] truthy = CDN) still points at the CDN,
so the pre-fix resolver produced dead URLs for 100% of rule34.world posts.
**Fix:** probe both roots once per session (10-min TTL, sampled on a real
file) and build format URLs on the healthy root; attach `fallbackUrl` (other
healthy root) per format; an interrupted, non-user-cancelled chrome download
restarts once on that fallback. Also verified the rest of the world resolver
against live API + the user's `gallery-dl` fork (`rule34xyz.py`): format map
`100/101/102/10`, `{root}/posts/{id//1000}/{id}/{id}.{ext}`, artist tag
`type===8`, video posts `type:1` + `duration`, no `filename` field on
single-post responses.

### Bug D — session queue lost on any service-worker restart (session 3, PR #3)
**File:** `background-enhanced.js`. MV3 kills the SW after ~30s idle (and on
reload/update/crash); `downloadQueue`/`batchPending`/`activeQueueJobs` were
in-memory only, so a queued batch vanished. **Fix:** persist to
`chrome.storage.local` (`r34.queueState.v1`) + restore on startup (see §4).

### Bug E — batch spam + re-enqueue + serial resolution (session 3, PR #3)
**Files:** `background-enhanced.js`, `post-actions.js`. (1) Each queued item
fired a browser notification — a 300-post batch with limit 5 = 295
notifications; batches are now quiet (page toasts remain). (2) Re-clicking
"Download visible" re-enqueued posts already waiting/active; now deduped
(`skipped` reported + toast). (3) Post resolution was strictly serial
(300 posts ≈ minutes); now 5-wide. (4) Queued batch jobs kept stale signed
rule34video links (fresh `rnd=` per page load); failed dispatch now
re-resolves once. (5) `downloadVideo` dropped the resolver title when the
caller had none → `video.mp4` filenames; now applied.

### Also (session 3)
- `TELEMETRY_LOG` pings now ack into the SW log (was a no-op).
- Bumped `manifest.json` `4.1.1 → 4.2.0`.
- Re-validated: all JS passes `node --check` (bg as ESM), all JSON parses,
  forbidden-paywall grep clean (see §8), plus a 23-check Node harness
  (mocked `chrome` + `fetch`) covering queue math, host selection
  (healthy/degrading/dead CDN), fallback retry, persistence + restore,
  dedupe, and stale purge — all green.

---

## 6. Known issues / things that still need attention

Ordered by priority. Full checklist in `docs/WORKLIST.md`.

1. **MANUAL BROWSER TESTING IS STILL THE #1 GAP.** Static analysis + mocked
   Node harnesses can't confirm live behavior. Run the matrix in
   `WORKLIST.md` on both sites (it grew: persistent-queue + fallback-retry
   sections are new in session 3).
2. **rule34.world listing-card selectors are inferred, not confirmed**
   (`app-post-card` / `mat-card` / `[class*='post']`); the site is an Angular
   shell with no SSR, so it can't be checked from static HTML. Verify on a
   live listing page and adjust `post-actions.js` `pinContainerFor` /
   `processCards` if cards don't get buttons. (The rule34video.com side WAS
   verified live in session 3 — selectors are correct there.)
3. **Host permissions narrowed (session 4):** the `"https://*/*"` / `"http://*/*"`
   wildcards are gone; `host_permissions` is now just the two rule34 sites +
   `rule34storage.b-cdn.net` + `api.github.com`. (If a future feature needs a
   new host, add it explicitly.)
4. **Cosmetic namespace rename done (session 4):** `Serp*` identifiers and
   `SERP`/`serp` strings were renamed to `Rule34*`/`rule34` across active code
   (the kept-but-unloaded `site-adapter.js` retains its internal `serp` strings).
5. **rule34.world CDN state is volatile** — as of 2026-08-30
   `rule34storage.b-cdn.net` 500s on everything. The probe/fallback code
   (PR #3) handles both directions automatically, but re-verify the probe
   behavior if the CDN comes back (flag-preferred root should win again).
6. **Dead `chrome.action.onClicked` listener removed (session 4)** (manifest
   sets a default popup, so it never fired).
7. Nice-to-haves: rule34video image posts; "already downloaded" dedupe via
   `chrome.downloads` history; batch auto-paginate rule34.world — session 3
   pinned down the exact API from the gallery-dl fork: `POST
   {root}/api/v2/post/search/root`, JSON
   `{ includeTags, Skip, take, CountTotal:false, IncludeLinks:true,
   OrderBy:0, cursor }` → `{ items, cursor }` (60/page);
   `/v2/post/search/playlist/{id}` for playlists.
   **Session 4 implemented** the rule34.world bulk-by-tag/playlist flow on top of
   this exact API (`searchRule34WorldPosts` + `bulkDownloadTag`); rule34video.com
   tag search is still a future nice-to-have.

> Verified clean session 3: forbidden-paywall grep empty, all JS/JSON valid,
> 23-check mocked harness green (see §8). `TELEMETRY_LOG` from the popup now
> has a background handler (SW-log ack).

---

## 7. File map (extension code only; `modules/` is vendored third-party)

| File | Role |
|---|---|
| `manifest.json` | MV3 config; surface registration; permissions |
| `background-enhanced.js` | SW: queue, post resolvers, batch, message router, download routing |
| `background-bridge.js` | SW helpers (offscreen doc, DNR rules, progress forwarders, response wrappers) |
| `site-config.js` | SITE_NAME, folder, player-button selectors, context-menu patterns, update-check config, colors |
| `site-adapter.js` | Generic multi-hoster media-detection hook module (many hosters); **gated** — kept but not loaded on rule34 sites (`Rule34SiteAdapter`) |
| `content.js` | Generic content adapter; `getVideoInfo` extractor |
| `content-bridge.js` | Content-side message bridge / progress UI glue (`Rule34ContentBridge`) |
| `post-actions.js` | **Corner buttons + batch toolbar + toasts** (new in PR #1) |
| `player-button.js` | In-page player download button (single-video) |
| `popup.html` / `popup.js` | Toolbar popup UI; concurrency controls; download trigger |
| `offscreen.html` / `offscreen.js` | Offscreen doc: HLS transmux / MP4 fetch |
| `download-manager.js` | In-page download progress UI |
| `update-notifier.js` | GitHub release update check |
| `inject.js` | Page-context injected script |
| `logger.js` | Logging + log mirroring to SW |
| `styles/*` | popup / player-button / download-manager CSS |
| `modules/**` | Vendored libs (hls2mp4, dash2mp4, mediabunny, mp4box, utils) |
| `app.config.json` / `unified-app.config.json` / `factory-candidate.config.json` | Generator config artifacts (edit in step) |
| `generate-icons.js` | Icon generator helper |

---

## 8. Validation commands (run these after any change)

```bash
cd "/home/user/rule34video/rule34video downloader"

# JS syntax (content scripts are classic; background is a module)
for f in popup.js player-button.js site-config.js update-notifier.js offscreen.js \
         content.js content-bridge.js download-manager.js logger.js background-bridge.js \
         inject.js site-adapter.js post-actions.js; do
  node --check "$f" || echo "FAIL $f"
done
node --input-type=module --check < background-enhanced.js

# JSON
for j in manifest.json app.config.json unified-app.config.json factory-candidate.config.json; do
  python3 -m json.tool "$j" >/dev/null || echo "FAIL $j"
done

# Paywall/auth remnants — must print NOTHING:
grep -rniE 'auth\.serp\.co|serp\.ly|serpapps|ensureDownloadAccess|checkActivated|isActivated|auth-ui\.js|trial-banner\.js|gumroad|activationTitle' \
  --include='*.js' --include='*.json' --include='*.html' --include='*.css' . \
  | grep -viE 'SerpBackground|SerpContent|SerpSite|SerpBridge|SerpUnifiedPopup'
```

Session 3 additionally ran a **functional harness** (`/tmp/queue-test/harness.mjs`
in that sandbox — scratch, not committed): it loads the real
`background-enhanced.js` in Node with mocked `chrome.*` + `fetch` and asserts
23 behaviors — concurrency/queue math, world host selection (both-healthy →
flag-preferred CDN; CDN degrading → fallback retry exactly once; CDN fully
dead → origin-only, no pointless retry), persistence to
`chrome.storage.local`, restore after a simulated SW restart (chrome download
re-verification, no burst dispatch, auto-dispatch on slot free), batch dedupe
(0 accepted / 3 skipped), user-cancel never retried, and 5h-stale job purge.
Recreate it after big queue changes; all checks were green at `4.2.0`.

---

## 9. Git / PR procedure for the next session

```bash
cd /home/user/rule34video
git fetch origin
git checkout <session-branch>        # stay on the assigned arena/* branch
git reset --hard origin/main         # start from current merged main
# ...make changes...
# run §8 validation...
git add -A
git commit -m "..."
git push origin <session-branch>
gh pr create --base main --head <session-branch> --title "..." --body-file docs/SESSION_HANDOFF.md
gh pr merge <PR_NUMBER> --merge      # merge COMMIT (not squash), so it lands on main
```

- **Always** use a merge commit (`--merge`), per the user's preference.
- Do not switch/push to other branches; the session is tied to its `arena/*` branch.
- PR #2 (session 2): popup fallback + image-routing fix + docs refresh.
- PR #3 (session 3, this session): CDN-outage host probe + fallback retry,
  persistent session queue + popup queue list, batch hardening, re-resolve
  on dispatch failure, filename title fix, version `4.2.0`, docs refresh.

---

## 10. Site facts worth keeping (from PR #1 + live reference files)

### rule34video.com
- KVS. Card: `a.th.js-open-popup[href*="/video/"]`; `data-preview` URLs are
  **preview MP4s — never final downloads**.
- Final links are signed `get_file/.../{1080p|720p|480p|360p}.mp4/...&download=true&download_filename=...`
  in the post HTML.
- **Verified live (session 3, post 4573905):** download tab links exist for
  all four qualities; the 360p file is `..._360.mp4` (**no `p` suffix** — the
  resolver regex `_(\d{3,4})p?` handles it). `rnd=` in signed URLs is a
  "now" timestamp → links are fresh per page load (expiry risk for long
  queues; PR #3 re-resolves on dispatch failure).
- Listing pages contain **only** `_preview.mp4` links (0 `download=true`) →
  batch mode must resolve each post page individually (it does).
- Card structure: `div.item.thumb[data-video-card-id]` → `a.th.js-open-popup`
  → `div.img.wrap_image` (corner-button pinning target) → `img.thumb`.

### rule34.world
- Angular SPA (`<app-root>`); data via API, not static HTML.
- `GET https://rule34.world/api/v2/post/{id}` → JSON
  `{ id, type, files: { "100"|"101"|"102"|"10": [flag] }, tags:[...], duration, width, height, created, ... }`.
  **No `filename` field** on single-post responses (resolver falls back to
  `post {id}`).
- `type: 1` = video (has `duration` + `101`/`102` [and sometimes `100`]),
  `type: 0` = image (`10` + derivatives `11/12/13/14/31/34`).
- Artist tag = `tag.type === 8`. (Other ids seen: `112`, `113` — unmapped
  derivatives; ignore, gallery-dl does the same.)
- File URL: `{root}/posts/{floor(id/1000)}/{id}/{id}.{mov.mp4|mov720.mp4|mov480.mp4|pic.jpg}`,
  where `root` = `rule34storage.b-cdn.net` (CDN) or `rule34.world` (origin)
  per the file flag — **session 3: the CDN was 500ing on every post while
  the origin served fine, so the extension probes both roots and builds URLs
  on the healthy one** (10-min TTL + `fallbackUrl` retry).
- Thumbnail: `{...}/{id}.pic256.jpg`.
- Listing/search pagination (not yet used, confirmed from gallery-dl
  `rule34xyz.py`): `POST {root}/api/v2/post/search/root` with JSON
  `{ includeTags, Skip, take, CountTotal:false, IncludeLinks:true,
  OrderBy:0, cursor }` → `{ items, cursor }`, 60/page;
  `/v2/post/search/playlist/{id}` for playlists; login =
  `POST /api/v2/auth/signin` → `Bearer {jwt}`.
- Sample posts for testing: video `/post/3571567` (720p+480p, no source),
  images `/post/100`, `/post/1280481` (2026). Old ids (100–250000) are
  mostly image-only.
- The sister domain `rule34.xyz` uses the same API/CDN pattern
  (`rule34xyz.b-cdn.net`); the extension currently targets rule34.world only.
