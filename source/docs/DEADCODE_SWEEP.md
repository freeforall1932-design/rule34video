# Dead-code & stale-reference sweep — 2026-09-14

Scope: the shipped `extension/` only (`source/` is the documented scrapyard and was
left alone apart from gaining a retirement kit). Baseline: **v6.0.2, 12 457 lines
in 23 shipped JS files, all suites green.**

Goal, per the brief: retire the generic-hoster code that has nothing to do with
rule34video.com / rule34.world, sweep for stale/unlinked code, **without touching
anything that works.** Everything below was proven, not inferred from a name.

## Result

| | |
|---|---|
| `background-enhanced.js` | 3517 → **3387 lines** (−130) |
| Dead shipped *files* found | **0** (all 23 reachable — see "what the sweep got wrong") |
| Provably-inert blocks removed | 6 (table below) |
| Hoster branches deliberately **kept** | 9 |
| Suite before / after | 103 fixtures + smoke + e2e **green both times, byte-identical output** |
| New CI guards | 2 (stale references, host inventory) + 1 site-config↔manifest check |

## Removed (provably inert)

Each was provable because its **only feeder is code that no longer ships**: the
generic `site-adapter.js` was moved out in the retrofit (`RETROFIT_AUDIT.md` §C),
and nothing in `extension/` assigns what it used to assign.

| Removed | Proof |
|---|---|
| `const forceChromeHlsSegmentDownload = false` | hardcoded `false`; only the retired adapter flipped it (audit item **S6**, deferred since 2026-08-30) |
| the `forceChromeHlsSegmentDownload` spread in `normalizeFormat()` | guard is the constant above |
| `resolveHlsSegmentForChromeDownload()` (~50 lines) | its single caller was the branch below |
| the `hls-segment-chrome` branch in `downloadVideo()` (~44 lines) | condition reads a flag nothing ever sets now |
| the two loops in `rewriteDownloadUrl()` + `downloadMediaUrlRewriteRules` / `removeMediaUrlQueryParams` | both arrays are declared `[]` and **nothing pushes to them** |
| `case "getActiveDownloads"`, `case "getOutputSettings"` | no shipped file *and no retired file* emits them (`source/retired/v5-popup-ui/` checked — superseded by `panel.get`/`panel.*`) |

Copied verbatim to **`source/retired/generic-hoster/REMOVED-2026-09-14.md`** with
the anchor to paste each back at, so a repo for a specific site can lift one.

## Kept on purpose — four near-misses worth recording

Every one of these *looks* dead; deleting it would have broken the working extension.

1. **`buildConfig()` + 5 helpers in `offscreen.js`** — reported dead because the
   call site `const config = buildConfig();` (`:129`) is *top-level*, i.e. inside
   no function body, so a block-scoped parser attributes it to `buildConfig` itself.
2. **`rememberObservedRequest()` and the whole observed-media chain** — reported
   dead because it is passed to `chrome.webRequest.onBeforeRequest.addListener`
   as a **bare callback reference** (no `()`), which a "who calls this?" scan misses.
   It roots `looksObservedPlayable → rememberObservedMedia → observedMediaFormats →
   defaultGetVideoFormats → getVideoFormats`. `NAMING_REVIEW.md` claims
   `observedMediaFormats` is "effectively unreachable in production" — **that is
   wrong**, and the claim should not be trusted for future sweeps.
3. **`withTemporaryHeaderRules()`** — live from 4 call sites; and because `:2939`
   (live) sets `useDownloadHeaderRules`, the **erome** DNR pattern at `:1992` is
   reachable from a real download. Erome was therefore *not* removed.
4. **Legacy `case "downloadVideo"` / `getVideoFormats` / `bulkDownloadTag` / …** —
   11 of the 13 unsent cases are the **documented revival seam** for the retired
   popup (`source/retired/v5-popup-ui/README.md` states they exist so the popup can
   be moved back). Sent by nobody in `extension/`, but load-bearing for your ability
   to restore that UI, so they stay.

`Adapter.getVideoFormats` / `Adapter.prepareDownload` were *also* left in — see the
plan doc; that global is the cheapest multi-host API you have.

## Not verifiable offline (needs one live page)

The remaining hoster guards (`xiaoshenke`, `streamtape`, `aki-h`, `xtremestream`,
cloudflare-stream, `videodelivery`, erome) sit **inside** live shared predicates
(`normalizeFormat`, `looksObservedPlayable`). Two facts prevent a static proof:

- `source/page-source/rule34video-listing.html` contains a third-party
  `<iframe src="https://engine.sadbaguette.com/…">`, so *this site* does embed
  foreign-origin frames;
- `chrome.downloads.download()` needs **no host permission**, so a foreign media URL
  can reach the worker regardless of `host_permissions`.

So "unreachable" for those is an assumption about the video page, not a theorem.
Decide it in a browser: open one rule34video.com `/video/{id}` page, and if every
media request is `rule34video.com`, delete the guards (the kit keeps copies).

## The inventory that replaced guessing

`source/tools/validate.mjs` now fails the build unless every external host in
first-party files is **declared**. Detected in the shipped tree:

```
served:      rule34video.com  rule34.world  rule34.xyz  b-cdn.net  github.com
hoster kit:  xiaoshenke.net  erome.com  aki-h.stream  xtremestream.xyz
             streamtape.*  videodelivery.net  cloudflarestream.com
retired:     sa.com (its only reference was inside the deleted HLS-segment resolver)
template     phncdn.com  playhubconnect.com  mmcdn.com  psmcdn.net
 leftovers:  adtng.com  itsup.com  mydaddy.cc  workers.dev
```

The last two rows are what a clone actually inherits: CDN and ad-network names from
the ancestor product, still in the worker. They are now *named* rather than hidden,
and `ALLOWED_HOSTER_HOSTS` can only shrink — the new repo starts by emptying it.

Two checks back it up: **stale references** (manifest + every `<script src>`/
`<link href>` in the HTML must exist on disk) and **site-config ↔ manifest
consistency** (a host in `BACKGROUND.contextMenu.documentUrlPatterns` that is not
in `host_permissions` is dead on arrival — this is the half-finished-rename case).

Guards were verified by injecting failures, not just by watching them pass:
unknown `.biz` host → FAIL; `logger.js` renamed away → FAIL; host added to
site-config only → FAIL; `phncdn.com` removed from the allowlist → FAIL.

## How to reproduce

```bash
node source/tools/validate.mjs     # now includes stale-reference + host inventory
npm test                           # 103 fixtures + smoke + e2e
# behaviour proof used here (suite output must be identical before/after):
git stash && npm test > /tmp/before.txt 2>&1; git stash pop && npm test > /tmp/after.txt 2>&1
diff <(grep -vE "duration_ms|r34-(smoke|e2e|queue)|mp4-[0-9]{10}" /tmp/before.txt) \
     <(grep -vE "duration_ms|r34-(smoke|e2e|queue)|mp4-[0-9]{10}" /tmp/after.txt)
```

Only the temp-dir names and stack-trace line numbers shift (±3, the deleted consts).

## Follow-ups (not done here, deliberately)

1. Empty `ALLOWED_HOSTER_HOSTS` in the new repo — it becomes a compile-time "no
   third-party scraping" statement.
2. `NAMING_REVIEW.md` §"Sloppy / dead-weight code" is now partly stale: the
   observed-media chain is live (item 2 above), and `download-manager.js`,
   `player-button.js`, `content-bridge.js`, `popup.js` no longer ship at all.
   Correct it before anyone plans against it.
3. `forceChromeDownload` is now read at `:1983`/`:2889`/`:2967` but never set
   (its setter was block 5). Kept as a harmless safety valve; fold into the
   capability work in `MULTIHOST_PLAN.md` if you want it gone.
