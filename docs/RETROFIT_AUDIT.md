# Retrofit Audit — paid/licensed extension → free community extension

Purpose of this doc: capture the audit requested in the 2026-08-30 session —
read the handoff/improvement/worklist, look up a "must-have / nice-to-have"
quality-of-life feature, brainstorm robust-coding & quality ideas, and **recheck
for stale code + third-party involvement** because the product is being
retrofitted from a *marketed, paid, license-checked* Chrome extension into a
*free, community* extension for rule34.world + rule34video.com.

Branch: `arena/01a05149-rule34video`. State reviewed: extension **v4.2.0**
(dual-site, persistent queue, CDN-outage fallback — all from PR #1/#2/#3).

---

## A. Stale code & branding leftovers (found this session)

| # | Location | Issue | Action taken / proposed |
|---|----------|-------|--------------------------|
| S1 | `styles.css` (`.activation-section`, `.activate-btn`, `.buy-key-link`) | Orphaned **paywall/activation UI** CSS from the paid product. Confirmed unused by any JS/HTML. | **REMOVED** (this session). |
| S2 | `inject.js` flashvars loop | `"license_code"` key — literal leftover from the paid product's license-check field. Harmless but on-brand "paid" smell. | **REMOVED** (this session). |
| S3 | `background-enhanced.js` bottom | `chrome.action.onClicked` listener — **dead code** (manifest sets a default popup, so `onClicked` never fires). | **REMOVED** (this session). |
| S4 | `SerpBackgroundBridge` / `SerpContentBridge` / `SerpSiteAdapter` / `SerpUnifiedPopup` (8 files) | Generator branding identifiers (`serp.co`/`serp.ly` product). Cosmetic only. | **RENAMED → `Rule34*`** (this session) for a clean rebrand. |
| S5 | `globalThis.__serpObservedMediaListenerInstalled` | Lowercase generator flag. | Renamed → `__rule34...` (this session). |
| S6 | `background-enhanced.js` `forceChromeHlsSegmentDownload = false` | Hardcoded-dead config knob (only `site-adapter.js` ever flips it true). | Leave for now; fold into the site-adapter cleanup (see C). |

**Note:** the forbidden-paywall grep (`auth.serp.co`, `serp.ly`, `gumroad`,
`isActivated`, `activationTitle`, `trial-banner`, …) is **clean** — PR #1 already
deleted the real auth/license/trial machinery. The only `serp`/`license` strings
left were the cosmetic ones above (S1–S5), now removed.

---

## B. Third-party involvement (the real retrofit risk)

The extension was generated from a **universal multi-site video downloader**
template. Two kinds of "third party" remain:

### B1. Vendored libraries (legal, must attribute) — OK
- `modules/mediabunny` → **MPL-2.0** (file-level copyleft). Compatible with a
  free MIT release **as long as** the mediabunny source ships in the repo (it
  does) and we don't modify it without publishing the change (we don't).
- `modules/mp4box.mjs` → **BSD-3-Clause** (GPAC). Keep header.
- `modules/hls2mp4`, `dash2mp4`, `reencoder` → vendored transmuxers (FastStream
  lineage); license to be confirmed before editing. Shipped unmodified.
- **Added this session:** top-level `LICENSE` (MIT) + `docs/THIRD_PARTY_LICENSES.md`.

### B2. Live third-party host scraping (the concern) — needs a decision
- `site-adapter.js` (~3,600 lines) is a **generic multi-hoster scraper** that
  fetches & reverse-engineers ~40+ unrelated third-party sites: eporner, voe,
  streamtape, dood, nhplayer, xiaoshenke, q8/byser* proof-of-work + captcha,
  luluvid, vidara, xtremestream, cloudflarestream, erome, … It is loaded as a
  **content script on every page** and `import`ed into the background, where it
  is used only as a *generic fallback* for non-rule34 URLs.
- For a rule34.world + rule34video.com-only community tool this generic surface:
  1. is **dead weight** (large bundle, slow to load, maintenance burden);
  2. is a **privacy/security surface** (code that talks to dozens of arbitrary
     hosts);
  3. is the **reason broad `host_permissions` exist** (`"https://*/*"` +
     `"http://*/*"`) and why a `<all_urls>` `webRequest` listener is registered
     (observed-media scan). Chrome Web Store review flags over-broad host
     permissions.
- **Recommendation (see §C):** strip or hard-gate the generic scraper so the
  extension only loads on the two rule34 sites, then narrow host permissions.

### B3. No external telemetry / analytics / beacon found
- `TELEMETRY_LOG` is a **local SW-log ack** (no backend). No GA/gtag/mixpanel/
  sentry/beacon/cookie code exists. Good baseline for community trust.
- Recommend adding a one-paragraph `privacy.md` ("we send zero data anywhere
  except the two target sites + GitHub for update checks") for the Web Store
  listing.

---

## C. Proposed structural change (needs your go-ahead)

**Goal:** make the extension genuinely "free community / two-site only" and
Web-Store-clean.

1. **Gate/remove the generic `site-adapter.js` multi-hoster path.**
   - Option A (recommended): keep `site-adapter.js` only as an *opt-in* module
     that is **never loaded** on the rule34 sites; remove it from the
     `content_scripts` list for those origins and from the background `import`.
     The rule34 resolvers in `background-enhanced.js` already handle 100% of the
     target functionality, so behavior is unchanged for users.
   - Option B: delete the generic hosters entirely (smaller, cleaner) — but
     loses any future "download from anywhere" flexibility.
2. **Narrow `host_permissions`** to the two sites + `rule34storage.b-cdn.net` +
   `api.github.com` (drop `"https://*/*"` / `"http://*/*"`).
3. **Scope the `webRequest` observed-media listener** to those origins instead of
   `<all_urls>`.
4. **Remove the dead `forceChromeHlsSegmentDownload` knob** (fold into the
   site-adapter cleanup).

This is a product decision (loss of generic multi-site support) and touches
permissions, so it's listed as a proposal — not applied yet. Tell me A or B and
I'll implement + re-validate.

---

## D. Feature look-up — "must-have / nice-to-have for life improvement"

Searched current (2026) downloader-extension landscape. The recurring,
highest-value **quality-of-life** features across the top tools (Video
DownloadHelper, Video Downloader Professional, CocoCut, FetchV, Addoncrop) are:
**in-page one-click buttons** (already have per-card buttons), **folder
organization + smart filenames**, **playlist/tag bulk grab**, and **resume on
shaky networks** (already partly done via fallback retry). Applying that to
*this* product:

### D1. HEADLINE feature — "Smart Library" auto-organization (MUST-HAVE)
- **What:** auto-sort every download into subfolders by **site → artist/tag**,
  with a **user-configurable filename template** (e.g.
  `{site}/{artist}/{postId} - {title}.{ext}`), filesystem-safe sanitization, and
  uniquify-on-conflict.
- **Why it's a life improvement:** today every file lands flat in one folder as
  `video.mp4`, `video (1).mp4`, … The rule34.world resolver **already extracts the
  artist tag** (`tag.type === 8` → `apiTitle`) and the post id, so the data is
  free — we only need to extend `folderName()` / the `downloadVideo` filename
  builder and add a popup template control.
- **Effort:** small–medium. Low risk. Directly uses data we already resolve.
- **Win:** turns a chaotic Downloads folder into an instant, browsable library.

### D2. STRONG runner-up — "Download entire tag / search / playlist" (NICE→SHOULD)
- **What:** leverage the confirmed rule34.world cursor-pagination API
  (`POST /api/v2/post/search/root`, `{includeTags, Skip, take, cursor}` →
  `{items, cursor}`, 60/page; `/v2/post/search/playlist/{id}`) to enqueue a whole
  tag/playlist. rule34video.com search can be scraped the same way.
- **Why:** the #1 power-user ask for any downloader is bulk-by-tag; the worklist
  already lists it as optional. The single-post resolver is done; this extends it
  to paginated search.
- **Effort:** medium. Builds on `enqueueBatchDownloads`/`processBatchQueue`.

### D3. Other nice-to-haves (smaller)
- Image-post batch support for rule34video.com (currently video-only).
- "Already downloaded" dedupe via `chrome.downloads` history (match by filename).
- Subtitle/metadata embedding for saved files.
- Local offline gallery/view (bigger — a built-in media library UI).

**Recommendation:** ship **D1 (Smart Library)** next — highest QoL per unit of
risk, and it reuses data we already have. D2 right after.

---

## E. Robust coding & code-quality brainstorm

1. **Strip the generic multi-hoster surface (§C).** Single biggest quality +
   compliance + privacy win; shrinks bundle and kills over-broad permissions.
2. **Add licensing clarity (done):** top-level `LICENSE` (MIT) + `THIRD_PARTY_LICENSES.md`.
3. **Single source of truth for config.** Today 3 config JSONs
   (`app.config.json`, `unified-app.config.json`, `factory-candidate.config.json`)
   + `manifest.json` can drift. Generate `manifest.json` from one config, or
   delete the unused two.
4. **Commit the test harness.** The 23-check Node harness from PR #3 lives in
   `/tmp` (scratch). Move it to `tests/` so it survives and is run in CI.
5. **CI on GitHub Actions:** on every PR run `node --check` (bg as ESM) + JSON
   parse + the forbidden-paywall/stale grep + the harness. Catches regressions
   before merge (the docs stress manual testing is the #1 gap; CI narrows it).
6. **Lint/format baseline:** ESLint + Prettier with an `npm` wrapper, so the
   `Serp*`→`Rule34*` rename and future edits stay consistent.
7. **Remove dead code (§A):** done for S1–S5; S6 (`forceChromeHlsSegmentDownload`)
   folds into §C.
8. **`privacy.md`** for the Web Store listing (no telemetry; only two target
   sites + GitHub). Builds community trust.
9. **Verify rule34.world listing-card selectors on a live page** (worklist open
   item) before claiming batch works there.

---

## F. Validation run after this session's cleanups

- `node --check` on every classic script; background-enhanced.js as ESM. ✔
- All `*.json` parse. ✔
- Forbidden-paywall grep → **empty** (after cosmetic `Serp*`/`license_code`
  removal). ✔
- `grep -rn 'Serp' *.js` → **0** (rebrand complete). ✔

See `docs/SESSION_HANDOFF.md §8` for the full command set.
