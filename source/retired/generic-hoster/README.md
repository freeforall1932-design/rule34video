# generic-hoster — retirement kit for the non-rule34 sites

Everything here is **reference material, never packaged** (see `source/README.md`
rules). It exists so that a repo targeting *other* sites can lift exactly the
piece it needs instead of re-deriving it.

## Why this folder exists

This extension was generated from a universal multi-site downloader template. The
generic scraper (`source/retired/site-adapter.js`, ~3.6k lines, ~40 third-party
hosts) was moved out of the package by the retrofit
(`source/docs/RETROFIT_AUDIT.md` §C). What remained were the **host-specific
branches inside the live files**: they still compile, still run their guards, and
still return "not my host" for every URL rule34video.com / rule34.world can
produce. That is why nothing was ever broken by them — and why a sweep must be
done one guard at a time.

Two line-number references below are **post-sweep** (`extension/background-enhanced.js`,
3387 lines, after 130 lines of provably-inert code was removed on 2026-09-14).

## Removed on 2026-09-14 (provably inert — kept here verbatim)

See `REMOVED-2026-09-14.md`. Provable because the only feeder for each was the
retired adapter, and no shipped file assigns it:

| Piece | Why provably dead |
|---|---|
| `const forceChromeHlsSegmentDownload = false` | hardcoded false; only ever flipped true by `site-adapter.js` (`RETROFIT_AUDIT.md` item S6) |
| `resolveHlsSegmentForChromeDownload()` + its `if (…forceChromeHlsSegmentDownload)` branch | single caller was that branch |
| `downloadMediaUrlRewriteRules` / `removeMediaUrlQueryParams` loops in `rewriteDownloadUrl()` | both arrays declared `[]`; nothing ever pushes to them |
| `case "getActiveDownloads"`, `case "getOutputSettings"` | no shipped **and** no retired file emits them (superseded by `panel.get` / `panel.*`) |

## Retired in pass 2 (2026-09-14) — proof, not guesswork

The observed-media predicates turned out to be **provably** unreachable after all,
for a reason no grep gives you: `rememberObservedRequest` is the only writer into
`observedMediaByOrigin` / `observedMediaByTab`, and Chrome only ever invokes a
`webRequest` listener for URLs matching its `urls` filter — which lists nothing but
`rule34.world`, `*.rule34.world`, `www.rule34.world`, `rule34video.com`,
`*.rule34video.com`, `rule34storage.b-cdn.net`.

So any predicate inside that chain anchored to a *foreign hostname* can never be
true. Deleted on that basis (~141 lines):

| Retired | Anchor it was fenced by |
|---|---|
| `looksKnownHosterDocumentMediaUrl()` | streamtape + dood, both host-anchored |
| `looksImageDerivativeMediaUrl()` | `pix-cdn77/pix-fl.phncdn.com`, host-anchored |
| `looksObservedAdMedia()`'s host branch | adtng / mmcdn / playhubconnect / mydaddy / itsup / psmcdn |
| `cloudflareStreamIframeInfo`, `rememberCloudflareStreamRequest`, `decodeJwtPayload`, `observedCloudflareStreamTokens`, `cloudflareStreamSegmentInfo`, `isCloudflareStreamSegmentUrl`, `cloudflareStreamManifestFormats` | all four are host-anchored (`iframe.cloudflarestream.com`, `iframe.videodelivery.net`, `*.cloudflarestream.com`) and the cluster only fed itself |
| the two host terms in `looksObservedPlayable()` | `xiaoshenke.net/(vid|s1)/`, `aki-h.stream/(file|file2|quality2)/` |
| the `xtremestream.xyz` height probe in `observedFormat()` | host-anchored |

The reasoning is now executable: **`source/tests/hoster-reachability.test.mjs`**
asserts the filter admits only supported hosts *and* that no foreign hostname test
survives inside the chain. Widen the filter, or re-add `evilhost.net` to
`looksObservedPlayable`, and CI fails with a message explaining that the retired
code may be live again.

## Kept live on purpose

These are *not* fenced by any URL filter — they read `videoInfo`, which the content
scripts build from the page's own DOM, so a foreign media URL can legitimately
arrive with it. Removing them would change behaviour on inputs I cannot enumerate
offline, so they stay until a live page says otherwise.

| Guard | Live location | Function | Lift it for |
|---|---|---|---|
| `aki-h.stream` HLS alias | `:1523` | `normalizeFormat` | aki-h embeds |
| `xiaoshenkePlayerFormats()` | `:1589`, called `:1744` | `getVideoFormats` | xiaoshenke players |
| referer choices for xiaoshenke / xtremestream | `:1790`, `:1793` | `getFormatReferer` | referer-locked hosts |
| erome referer + header-rule + offscreen rules | `:1819`, `:1829`, `:1851`, `:1956` | `shouldForceChromeDownload`, `shouldUseTabInitiatedDownload`, `dnrRegexFilterForDownload`, `shouldUseOffscreenMp4` | erome |
| `resolveXiaoshenkeSignedUrl()` (+ its own scoped `webRequest` listener) | `:2083-2101`, listener `:2027` | signed-URL recovery | xiaoshenke |
| path-shaped terms in `looksObservedPlayable`: `/player/xs1.php?data=`, `/cf-master.<x>.txt`, `/sora/<a>/<b>`, sprite/thumb/`.vtt` rejection | `:1537-1539` | — | **not host-anchored** — a `rule34video.com` URL can match these, so they are live by definition |

## The `Adapter` seam is the cheap multi-host API

`background-enhanced.js:12` is `const Adapter = globalThis.Rule34SiteAdapter || {}`.
Nothing in the shipped tree assigns it, so `Adapter` is always `{}` and both hook
blocks are skipped. **Do not delete it**: assigning that one global from a site
file is the entire plugin surface (see `source/docs/MULTIHOST_PLAN.md`). Retiring
it would cost you the cheapest extension point you have.
