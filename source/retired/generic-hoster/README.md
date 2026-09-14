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

## Kept live on purpose (looks dead, is not)

Do **not** delete these without a live-page check — they are guarded by a hostname,
but they sit inside functions the two sites use, and rule34video.com is
demonstrably embedding third-party iframes (a `<iframe src="https://engine.sadbaguette.com/…">`
ad frame is present in `source/page-source/rule34video-listing.html`). `chrome.downloads`
needs no host permission for a foreign media URL, so a foreign host *can* reach
these predicates. Verify on a real post page first.

| Guard | Live location | Lift it for |
|---|---|---|
| `looksObservedPlayable()` host patterns | `:1538` | any direct-file host |
| `streamtape` e/v/d path rule | `:1551` | streamtape mirrors |
| `cloudflareStreamIframeInfo` / `SegmentInfo` / `ManifestFormats` | `:1598`, `:1648`, `:1678` | Cloudflare-Stream-backed players |
| `aki-h.stream` HLS shape | `:1524`, `:1625` | aki-h embeds |
| `xtremestream.xyz` + `/player/xs1.php` | `:1630` | xtremestream |
| `xiaoshenkePlayerFormats()` / signed-URL resolver | `:1719`, `:2118-2229` | xiaoshenke (`*.xiaoshenke.net/s1/…`) |
| erome referer + header-rule patterns | `:1960`, `:1970`, `:1992`, `:2097` | erome |
| `Adapter.getVideoFormats` / `Adapter.prepareDownload` hooks | `:12`, `:1884`, `:2838` | **the plugin seam — keep, see below** |

## The `Adapter` seam is the cheap multi-host API

`background-enhanced.js:12` is `const Adapter = globalThis.Rule34SiteAdapter || {}`.
Nothing in the shipped tree assigns it, so `Adapter` is always `{}` and both hook
blocks are skipped. **Do not delete it**: assigning that one global from a site
file is the entire plugin surface (see `source/docs/MULTIHOST_PLAN.md`). Retiring
it would cost you the cheapest extension point you have.
