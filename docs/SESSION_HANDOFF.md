# Session Handoff — Rule34 Downloader (fresh-context handoff)

> Purpose: a **fresh-context-window handoff**. It records the true repository
> state, what every session has done, what was found & fixed *this* session,
> what features already exist, and exactly what is left — so a new session can
> pick up without re-deriving anything.
>
> Written: 2026-08-29 (Asia/Jakarta) by the Arena.ai coding agent.

---

## 0. TL;DR — the "missing PR" mystery is resolved

The previous session **did** open a PR and merge it. Evidence:

- `origin/main` = `42cc212 Merge pull request #1 from freeforall1932-design/arena/01a04898-rule34video`
- PR #1: **MERGED 2026-08-28T23:11:49Z**, title "Rebrand as free community
  Rule34 downloader with batch queue", +5126 / −2025 across 26 files.
- The feature branch `arena/01a04898-rule34video` still exists on the remote.

This session's sandbox was initially checked out at the **old** pre-merge
commit `5219397`, which made it look like nothing had landed. After
`git fetch origin` + `git reset --hard origin/main`, all previous work is
present. **New sessions must always `git fetch origin` and work from
`origin/main` first** — do not trust the local checkout to be current.

This session then:
1. Synced the working branch to merged `main`.
2. Did a full codebase review (architecture + end-to-end message/handler audit).
3. Found & fixed **2 real logic bugs** (see §5).
4. Refreshed these handoff docs.
5. Opened PR #2 with the fixes (merge commit to `main`).

---

## 1. Repository / branch state

- Repo: `freeforall1932-design/rule34video`
- Working copy: `/home/user/rule34video`
- Extension dir: `/home/user/rule34video/rule34video downloader`  (note the space)
- Docs dir: `/home/user/rule34video/docs`
- Session branch: `arena/01a048c4-rule34video`
- Base: `origin/main` @ `42cc212` (PR #1 merge), version `4.1.0` → bumped to **`4.1.1`**.
- GitHub auth is the `arena-ai-coding-agent[bot]` token (`gh` + `git` work).
- The two `page source*.txt|html` files at the repo root are saved reference
  HTML for rule34.world / rule34video.com. They are not code.

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
  `site-config.js`, `logger.js`, `background-bridge.js`, `site-adapter.js`.
  Holds the download queue, post resolvers, batch engine, and the central
  `chrome.runtime.onMessage` router.
- **Content scripts** (run `document_idle` on both sites), in order:
  `site-config.js → logger.js → download-manager.js → content-bridge.js →
  site-adapter.js → content.js → player-button.js → post-actions.js`.
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
- **Batch backend** (`enqueueBatchDownloads`, `processBatchQueue`,
  `sendBatchStatus`, `BATCH_MAX_URLS=300`) + `batchDownloadPosts` handler.
- **Per-card corner buttons + visible-batch toolbar + toasts** (`post-actions.js`),
  MutationObserver for infinite scroll / Angular re-renders, scroll-based count.
- Extension-aware filenames (`.mp4` vs `.jpg`), download folder from config.
- Rich generic media detection inherited from the generator (`site-adapter.js`):
  HLS/DASH, many third-party hosters (eporner, voe, streamtape, dood,
  nhplayer, xiaoshenke, byse/q8 proof-of-work, etc.) — mostly irrelevant to
  the two rule34 sites but harmless.
- Offscreen HLS transmux + MP4 fetch (`offscreen.js` + `modules/`), progress
  manager, context menu, notifications.

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

---

## 6. Known issues / things that still need attention

Ordered by priority. Full checklist in `docs/WORKLIST.md`.

1. **MANUAL BROWSER TESTING IS THE #1 GAP.** Static analysis can't confirm
   live behavior. Run the matrix in `WORKLIST.md` on both sites.
2. **rule34.world listing-card selectors are inferred, not confirmed**
   (`app-post-card` / `mat-card` / `[class*='post']`). Verify on a live
   listing page and adjust `post-actions.js` `pinContainerFor` /
   `processCards` if cards don't get buttons.
3. **`popup.js` still sends `{ type: "TELEMETRY_LOG" }`** in `telemetry()`;
   there is no background handler, so it's a harmless no-op. Optionally route
   it to the existing `LOG_MIRROR` handler or drop it.
4. **Broad host permissions** (`https://*/*`, `http://*/*`) remain from the
   generator. Narrow to rule34 + the BunnyCDN host once testing confirms no
   cross-origin media needs the wildcard.
5. **Cosmetic namespace leftovers**: `SerpBackgroundBridge`, `SerpContentBridge`,
   `SerpSiteAdapter`, `SerpUnifiedPopup` identifier names (generator branding).
   Not third-party integration; optional rename to `Rule34*`.
6. Nice-to-haves: rule34video image posts; "already downloaded" dedupe via
   `chrome.downloads` history; batch auto-paginate rule34.world (POST API with
   `Skip`/`take`/`cursor`).

> Verified clean this session: `popup.html` does NOT reference the deleted
> `auth-ui.js` / `trial-banner.js` (PR #1 removed those tags), and no file
> references any deleted auth/trial file. The forbidden-paywall grep is empty.

---

## 7. File map (extension code only; `modules/` is vendored third-party)

| File | Role |
|---|---|
| `manifest.json` | MV3 config; surface registration; permissions |
| `background-enhanced.js` | SW: queue, post resolvers, batch, message router, download routing |
| `background-bridge.js` | SW helpers (offscreen doc, DNR rules, progress forwarders, response wrappers) |
| `site-config.js` | SITE_NAME, folder, player-button selectors, context-menu patterns, update-check config, colors |
| `site-adapter.js` | Generic media-detection hook module (many hosters); `SerpSiteAdapter` |
| `content.js` | Generic content adapter; `getVideoInfo` extractor |
| `content-bridge.js` | Content-side message bridge / progress UI glue (`SerpContentBridge`) |
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
(NB: the last grep will still show the `popup.html` `<script src="auth-ui.js">`
/ `trial-banner.js` tags until cleanup task #2 in §6 is done.)

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
- PR #2 (this session): popup fallback + image-routing fix + docs refresh.

---

## 10. Site facts worth keeping (from PR #1 + live reference files)

### rule34video.com
- KVS. Card: `a.th.js-open-popup[href*="/video/"]`; `data-preview` URLs are
  **preview MP4s — never final downloads**.
- Final links are signed `get_file/.../{1080p|720p|480p|360p}.mp4/...&download=true&download_filename=...`
  in the post HTML.

### rule34.world
- Angular SPA (`<app-root>`); data via API, not static HTML.
- `GET https://rule34.world/api/v2/post/{id}` → JSON `{ files: {"100":..,"101":..,"102":..,"10":..}, tags:[...], duration, width, height, type, filename }`.
- Artist tag = `tag.type === 8`.
- File URL: `https://rule34storage.b-cdn.net/posts/{floor(id/1000)}/{id}/{id}.{mov.mp4|mov720.mp4|mov480.mp4|pic.jpg}`.
- Thumbnail: `{...}/{id}.pic256.jpg`.
- Listing pagination = POST API with `Skip`/`take`/`cursor` (not yet used).
