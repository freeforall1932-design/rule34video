# Session Handoff — Rule34 Downloader (free/community rebrand)

> Purpose: this document is a **fresh-context-window handoff**. It records exactly
> what was done, why, what is left, and how to validate — so a new session can pick
> up without re-deriving anything.

## 1. The ask (verbatim intent)

The user is rebranding the Chrome extension into a **single, free/community
"Rule34 Downloader"** supporting both target sites:

- `rule34.world`
- `rule34video.com`

Explicit requirements, in the order they were raised:

1. Strip **all third-party auth** that is not from the target sites themselves.
   The user no longer owns the original website and no longer uses its login.
2. Remove the fixed **3-download trial limit**; replace it with a
   **user-configurable simultaneous-download limit** (slider **and** typeable
   number input). Default = **Unlimited**, but when a limit is set, extra
   downloads should **queue** and auto-dispatch as slots free (no spamming).
3. **Re-fetch / use page sources** for both Rule34 World and Rule34 Video.
4. **Re-review the codebase for missing/broken logic without losing functionality.**
5. Add **batch fetch + batch download** (not just manual one-by-one).
6. Add a **corner / action-bar download button inside each post/card**.
7. Use `freeforall1932-design/twitter-batch-download` as the **reference** for
   X/Twitter-style action-bar buttons + batch queue UX.
8. Create handoff docs (`SESSION_HANDOFF.md`, `IMPROVEMENT_LOG.md`, `WORKLIST.md`).
9. **Open a PR, then merge it with a merge commit** so the user can test from `main`.

## 2. Repository / branch state

- Repo: `freeforall1932-design/rule34video`
- Working copy: `/home/user/rule34video`
- Extension dir: `/home/user/rule34video/rule34video downloader`
- Branch for this session: `arena/01a04898-rule34video` (from `aba4516 Add files via upload`)
- `origin/main` advanced separately to `5219397` (added `page source.txt` and
  `page source for rule34 world`).
- The two page-source files are present in both `main` and the working tree
  (byte-identical) — they are **not** part of the diff, only untracked locally
  because this branch was created before main moved. They must be included in the
  final commit so the branch is fully self-contained.

> NOTE on git history: this checkout is **shallow/grafted** — `git log` only shows
> the root commits, and there is **no prior local merge commit**. The earlier
> "merge main" step recorded in prior context did not persist. The correct path
> forward is a single squashed-ish content commit on this branch, then a GitHub
> **merge commit** PR (done via `gh pr merge --merge`, not squash).

## 3. What was changed (code)

### 3.1 Deleted — third-party auth / paywall / trial (phase 1)

Removed files:

- `rule34video downloader/auth.js`
- `rule34video downloader/auth-ui.js`
- `rule34video downloader/trial-banner.js`
- `rule34video downloader/auth/auth-api.js`
- `rule34video downloader/auth/auth-config.js`
- `rule34video downloader/auth/auth-storage.js`
- `rule34video downloader/auth/auth-telemetry.js`
- `rule34video downloader/auth/auth-token.js`

Removed references:

- `manifest.json`: dropped `https://auth.serp.co/*` (and related) host permission.
- `player-button.js`: removed `checkActivated()`, `addStorageActivationListener()`,
  and the `isActivated` gate around `runAttachFlow()`.
- `offscreen.js`: removed `auth.serp.co` and `serp.ly` from the host-permission
  origin ignore list.
- `background-enhanced.js`: `downloadVideo` no longer calls `ensureDownloadAccess`.
- `popup.html` / `popup.js`: removed activation / email / license UI and `serp.ly`
  buy link.
- `styles/popup-enhanced.css`: removed activation + free-trial-banner + buy-key CSS.
- `app.config.json` / `unified-app.config.json`: removed `activationTitle`.

The **internal namespace names** `SerpBackgroundBridge`, `SerpContentBridge`,
`SerpSiteAdapter`, `SerpUnifiedPopup` are still used as code identifiers. They are
cosmetic leftovers from the generator and are **not** third-party integrations —
a full rename is optional, tracked in WORKLIST.

### 3.2 Update checker repointed to the user's repo

`update-notifier.js` + `site-config.js`:

- owner: `freeforall1932-design`
- repo: `rule34video`
- API: `https://api.github.com/repos/freeforall1932-design/rule34video/releases/latest`
- Page: `https://github.com/freeforall1932-design/rule34video/releases/latest`

### 3.3 Dual-site support + post resolvers (background)

In `background-enhanced.js`:

- `WORLD_CDN_ROOT = "https://rule34storage.b-cdn.net"`
- `WORLD_ROOT = "https://rule34.world"`
- `WORLD_FORMATS` maps rule34.world file ids:
  - `100` → `mov.mp4` (Source MP4)
  - `101` → `mov720.mp4` (720p)
  - `102` → `mov480.mp4` (480p)
  - `10`  → `pic.jpg` (Image)
- `rule34VideoPostId(url)` — matches `/video/{id}` or `/popup-video/{id}` on `rule34video.com`.
- `rule34WorldPostId(url)` — matches `/post/{id}` on `rule34.world`.
- `resolveRule34VideoPost(pageUrl)` — fetches the post page HTML
  (`credentials: "include"`), extracts title (`og:title` / `h1` / `title`),
  thumbnail (`og:image`), and parses **signed** `get_file/..._{height}.mp4` links,
  preferring the explicit `download=true` download-tab links and falling back to
  player `get_file` MP4s. Skips `_preview.mp4`. Sorts highest resolution first.
- `resolveRule34WorldPost(postId, pageUrl)` — fetches
  `https://rule34.world/api/v2/post/{id}`, builds CDN URLs as
  `{root}/posts/{id//1000}/{id}/{id}.{ext}`, derives title from artist tag
  (`type === 8`) + `filename`, and a `pic256.jpg` thumbnail.
- `resolveKnownPost(url)` — dispatches to the right resolver.

`getVideoFormats()` gained a fast path: for supported post URLs it resolves
formats directly from the page/API instead of relying on DOM/network observation.

`downloadVideo()` now derives the file extension from the selected format
(so rule34.world image posts save as `.jpg`, videos as `.mp4`), and honors
`skipFormatRefresh` so freshly-signed rule34video links are not refetched.

### 3.4 Configurable concurrency queue

- Storage key: `downloadConcurrencyLimit` (0 = Unlimited, up to 99).
- Background queue in `background-enhanced.js`:
  - `getDownloadLimit()`, `queueDownloadRequest()`, `pumpDownloadQueue()`,
    `releaseQueueSlot()`, `removeQueuedDownload()`.
  - `chrome.downloads.onChanged` frees a slot on `complete`/`interrupted`.
  - `chrome.storage.onChanged` re-pumps when the user changes the limit.
- Message handlers: `getQueueStatus`, `setDownloadLimit`.
- Popup (`popup.html` + `popup.js`): slider (0–10) **and** numeric input (up to 99),
  "Unlimited" default, live `N active • M queued` status. Clear the input = Unlimited.

### 3.5 Batch download backend

In `background-enhanced.js`:

- `BATCH_MAX_URLS = 300`
- `enqueueBatchDownloads(urls, tabId)` — dedupes, filters to supported URLs, queues.
- `processBatchQueue()` — resolves each post, picks `formats[0]` (best), and pushes
  it through `queueDownloadRequest` (so it respects the user's concurrency limit),
  with `skipFormatRefresh: true`.
- `sendBatchStatus(tabId, payload)` — streams per-post `batchPostStatus` back to the tab.
- Message handler `batchDownloadPosts` (sync `sendResponse`, returns accepted count).

### 3.6 Content-side corner buttons + batch toolbar (NEW this phase)

New file: `rule34video downloader/post-actions.js` (registered in `manifest.json`
content-script `js` list after `player-button.js`).

- Detects `rule34.world` vs `rule34video.com` by hostname.
- `anchorForCard()` / `pinContainerFor()` find the post `<a>` and a stable container:
  - rule34video.com: `a.th.js-open-popup[href]`, `a[href*="/video/"]`,
    `a[href*="/popup-video/"]`, pinned into `.img.wrap_image` / card.
  - rule34.world: `a[href*="/post/"]`, pinned into `app-post-card` / `mat-card` /
    `[class*="post"]` container.
- Adds a **corner download button** (`↓`) to every card via a `MutationObserver`
  (handles lazy/infinite-scroll + Angular SPA re-renders).
- Adds a **floating "Download visible (N)" toolbar** (bottom-right) that collects
  all in-viewport supported post URLs and sends `batchDownloadPosts`.
- Single-post pages fall back to treating `location.href` as the one post.
- Listens for `batchPostStatus` and shows a **toast** (queued / downloading / failed).
- All downloads flow through the background queue, so the concurrency limit applies.

## 4. Discovered site/API facts (for future work)

### rule34video.com

- KVS-based. Cards look like:
  ```html
  <div class="item thumb video_1" data-video-card-id="4573905">
    <a data-href=".../popup-video/4573905/?popup_id=1" class="js-click hidden"></a>
    <a class="th js-open-popup" href="https://rule34video.com/video/4573905/slug/">
      <div class="img wrap_image" data-preview="...4573905_preview.mp4/">
        <img class="thumb lazy-load" data-original="...320x180/3.jpg">
        <div class="quality">...</div><div class="futa">Futa</div><div class="time">34:52</div>
      </div>
      <div class="thumb_title">...</div>
    </a>
  </div>
  ```
- The **`data-preview` URLs are preview MP4s — do NOT use as final downloads.**
- Final download URLs are signed `get_file/.../{1080p|720p|480p|360}.mp4/?...&download=true&download_filename=...`.
- The per-post HTML exposes player quality labels (1080p/720p/480p/360p) and the
  signed download-tab links; the resolver prefers the `download=true` links.

### rule34.world

- Angular SPA (`<app-root>`), data loaded via API, not in static HTML.
- Post API: `https://rule34.world/api/v2/post/{id}` → JSON with `files` map,
  `tags` (artist = `type === 8`), `duration`, `width`, `height`, `type`, etc.
- File URL pattern: `{cdn}/posts/{id//1000}/{id}/{id}.{ext}`.
- CDN host: `https://rule34storage.b-cdn.net` (world) / `https://rule34xyz.b-cdn.net` (xyz).
- Formats (gallery-dl reference): `10` pic.jpg, `100` mov.mp4, `101` mov720.mp4, `102` mov480.mp4.
- Pagination API is POST-based with `Skip`/`take`/`cursor` (not yet needed).

### Update-check / repo

- Target repo: `freeforall1932-design/rule34video` (GitHub releases).

## 5. Validation commands (run these)

```bash
cd "/home/user/rule34video/rule34video downloader"
for f in popup.js player-button.js site-config.js update-notifier.js offscreen.js \
         content.js content-bridge.js download-manager.js logger.js background-bridge.js \
         inject.js site-adapter.js post-actions.js; do
  node --check "$f" || echo "FAIL $f"
done
node --input-type=module --check < background-enhanced.js
for j in manifest.json app.config.json unified-app.config.json factory-candidate.config.json; do
  python3 -m json.tool "$j" >/dev/null || echo "FAIL $j"
done
```

Forbidden-remnant check (should print nothing):

```bash
grep -rniE 'auth\.serp\.co|serp\.ly|serpapps|ensureDownloadAccess|checkActivation|isActivated|auth-ui\.js|trial-banner\.js|gumroad|activationTitle' \
  --include='*.js' --include='*.json' --include='*.html' --include='*.css' . \
  | grep -viE 'SerpBackground|SerpContent|SerpSite|SerpBridge|SerpUnifiedPopup'
```

## 6. What still needs doing (see WORKLIST.md for the full checklist)

1. **Manual browser test matrix** — the biggest open item. See `docs/WORKLIST.md`.
   - rule34video.com listing card button + single video popup
   - rule34.world hot/listing visible batch + single video post + image post
   - concurrency limit 2/3 vs Unlimited, cancellation, update checker
2. Optional rename of `Serp*` namespace identifiers to `Rule34*` (cosmetic).
3. Optional: verify rule34.world `app-post-card` DOM assumptions once a live page
   is inspected (the Angular shell has no post HTML in the saved page source).
4. Optional: reduce broad `https://*/*` host permission if not needed; keep
   `https://rule34storage.b-cdn.net/*` explicitly for world downloads.

## 7. How the PR/merge should be done

```bash
cd /home/user/rule34video
git add -A
git commit -m "..."          # single commit carrying all changes + docs
git push origin arena/01a04898-rule34video
gh pr create --base main --head arena/01a04898-rule34video \
  --title "..." --body-file docs/SESSION_HANDOFF.md
gh pr merge <PR_NUMBER> --merge --delete-branch=false   # merge commit, NOT squash
```
