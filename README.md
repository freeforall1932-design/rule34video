# rule34video

MV3 Chrome extension for [rule34video.com](https://rule34video.com) and
[rule34.world](https://rule34.world), built around a **Side Panel batch
queue** (in the style of the sister X/Twitter downloader) and an
**nh-dw style page fetcher** ("N posts found · Download all pages · pages
`2,4,6-10`"). Free, no telemetry, no accounts — see `source/docs/privacy.md`.

The extension **only activates on URLs it recognises** (`extension/site-routes.js`
is the single routing table); on every other page it stays silent.

| Where you are | What the panel / page offers |
|---|---|
| **rule34video.com** video page | *Download this post* (best quality, or your preferred height) |
| rule34video.com homepage, `/latest-updates`, search, tag, category, artist, member | *List this page* · *Download page* · page range (`1-99`, `all`) → *Fetch pages* / *Download all pages*; a ⬇ on every card |
| rule34video.com **playlist** | the same, plus *Whole playlist* on the page pill — every page of the playlist is crawled |
| **rule34.world** post | *Download this post* (picture **or** video) |
| rule34.world homepage, tag search, `/hot` `/highest` `/trends`, playlist | Twitter-style queue: auto batch-fetch **all pics and videos** through the site API, page N here = page N on the site, media filter (pics / videos / both), page range or *all pages* |
| anything else | queue only, plus *Fetch from a URL* (paste any listing / playlist URL of either site) |

Every listed post is a row with a checkbox, thumbnail, site/type badge, page
number and live status (listed → queued → resolving → downloading →
completed / failed). *Select all*, *Invert*, filter, *Retry failed*, *Clear
finished*, *Skip already downloaded* (with a resettable history) and a
1/2/3/5 concurrency switch behave exactly like the X downloader panel.
The queue and the crawl survive service-worker restarts.

## Where files are saved

```
Downloads/
  R34V/                          <- master folder (rename it, or clear it to turn off)
    rule34video/                 <- which site the post came from (automatic)
      AnArtist - Some title - 4573905/     <- folder name: your tags / template / manual name
        Some title.mp4
    rule34world/
      WorldArtist - post 3571567/
        001.jpg                  <- picture post, loose mode (or one .zip/.cbz/.pdf)
```

> The **id lives in the folder name**, not the file name — so the file is
> `<title>.<ext>`. (On rule34.world the title already ends with `post <id>`, so
> a post there saves as `WorldArtist - post 3571567.mp4`.)

- The **site level is automatic** — it comes from the site that served the post,
  so the two sites never end up in the same folder.
- The **folder name** comes from a template (`{artist} - {title} - {id}` by
  default, one checkbox per token), from the tags you tick in the popup, from a
  name you type yourself (highest priority), or from the search you started
  from. Whatever wins is sanitized; nothing can escape the download folder and
  files are never overwritten unless you ask for it.
- Everything happens inside your **fixed download location, with no prompts**
  (turn off Chrome's "Ask where to save each file" for the folders to appear).

## Repository layout

| Path | What |
|---|---|
| `extension/` | The shipped extension (load this folder unpacked). Runtime-only. |
| `extension/site-routes.js` | **URL router** (which page is this? what listing does it belong to?), page-range grammar, rule34video.com listing/pagination parser, rule34.world search-body builder. Shared by the worker, the panel and both content scripts; unit-tested. |
| `extension/panel-queue.js` | The Side Panel **queue engine** (worker side): persistent list, worker pool, page crawler with one adapter per site, download history. Dependency-injected, unit-tested offline. |
| `extension/sidepanel.html/.js` + `styles/sidepanel.css` | The Side Panel UI (opens from the toolbar icon, the page pill, or the context menu) |
| `extension/content-rule34video.js`, `extension/content-rule34world.js` | Per-site page adapters: corner ⬇ buttons, the floating pill, `collectListing` for the panel. Each fires only on routes the router recognises. |
| `extension/folder-naming.js` | The output-path engine: master folder, site slug map, path sanitizer, folder-name template |
| `extension/modules/archive/` | Dependency-free ZIP/CBZ writer and PDF writer for picture sets |
| `source/` | All development-use code: `retired/` (retired extension code), `vendor/` + `page-source/` (never-used sources), `tools/`, `tests/`, `docs/`. See `source/README.md`. |
| `source/tools/validate.mjs` | Offline validation (syntax, JSON, branding) — the single source of truth shared by `npm run check` and CI |
| `.github/workflows/ci.yml` | Runs `npm run check` + all three offline suites on every push/PR. Every step is an `npm run` script, so CI and local runs are identical. |

## Development

```bash
# 1. Load the extension
#    chrome://extensions → Developer mode → Load unpacked → "extension"

# 2. Run the offline test suites (from the repo root — no browser, no network)
node --test "source/tests/*.test.mjs"      # fixtures: routes, panel queue + crawler, folder naming, ZIP, PDF, queue restore
node source/tests/smoke.mjs                # real service worker under mocked chrome
node source/tests/e2e-download-paths.mjs   # real worker + offscreen doc: the saved paths
npm test                                   # all of the above

# 3. Syntax-check everything (background is an ES module, the rest are classic)
cd extension
for f in *.js modules/*.mjs modules/*/*.mjs; do node --check "$f"; done
```

Workflow: develop in `source/`, ship the result into `extension/`, debug
against live-test findings by reading the extension files. CI runs steps 2–3
(plus JSON + branding greps) automatically. The full manual browser test
matrix lives in `source/docs/WORKLIST.md` — real-browser checks (does the
folder appear, does the PDF open) cannot run on GitHub-hosted runners and stay
manual by design.

## Current state

- Version **6.0.0** — the UI/UX rework: popup replaced by the Side Panel
  queue, generic both-domain toolbar replaced by URL-routed per-site page
  adapters, nh-dw style page crawling (ranges / all pages) for both sites,
  playlist downloads on rule34video.com, pictures + videos batch fetch on
  rule34.world. The v5 popup / player-button / post-actions code is retained,
  never packaged, under `source/retired/v5-popup-ui/`.
- The download pipeline itself (resolvers, concurrency queue, HLS remux,
  picture-set archives, per-site tag-named folders) is unchanged from 5.x; the
  panel simply feeds it.
- Known-open work is tracked in `source/docs/WORKLIST.md`.

## License

MIT — see `LICENSE`. Vendored third-party code keeps its own license; see
`source/docs/THIRD_PARTY_LICENSES.md`.
