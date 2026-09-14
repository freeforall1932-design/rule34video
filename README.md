<div align="center">

# 🎬 Downloader for Rule 34

**Batch video & picture downloading for `rule34video.com` and `rule34.world` —
a Manifest V3 Chrome extension with a Side Panel queue.**

[![CI](https://img.shields.io/github/actions/workflow/status/freeforall1932-design/rule34video/ci.yml?branch=main&logo=githubactions&logoColor=white&label=CI)](https://github.com/freeforall1932-design/rule34video/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/offline%20tests-110%20passing-brightgreen?logo=nodedotjs&logoColor=white)](#-test-it)
[![Version](https://img.shields.io/badge/version-6.0.2-8b5cf6?logo=googlechrome&logoColor=white)](extension/manifest.json)
[![Manifest V3](https://img.shields.io/badge/Manifest%20V3-ready-2563eb)](extension/manifest.json)
[![Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-green)](package.json)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Telemetry](https://img.shields.io/badge/telemetry-none-important)](source/docs/privacy.md)

*No accounts · No keys · No paywall · No build step · Nothing leaves your machine
except the requests to the two sites you browse and GitHub for update checks.*

</div>

---

## Contents

[✨ Highlights](#-highlights) ·
[🗺️ What works where](#️-what-works-where) ·
[📥 Where files land](#-where-files-land) ·
[🧱 How it's built](#-how-its-built) ·
[🚀 Install](#-install) ·
[🧪 Test it](#-test-it) ·
[🗂 Docs](#-docs) ·
[🧭 Status](#-status--roadmap) ·
[📄 License](#-license)

---

## ✨ Highlights

- 📋 **Fetch and download are separate on purpose.** List a page, inspect the rows,
  tick what you want, *then* start **Download selected**. Nothing downloads because a
  crawl finished.
- 🔎 **nh-dw-style page fetcher** — `N posts found · Fetch selected pages ·`
  pages `2,4,6-10`, `1-99`, `50-`, `all`.
- 🧵 **Real concurrency** — 1/2/3/5 downloads at once; a slot frees, the next queued
  post starts. Active rows can be cancelled individually.
- 💾 **Resume-proof** — the queue *and* the in-flight crawl survive service-worker
  restarts.
- 🗂️ **Folders you can actually navigate** — `site → artist/tags → file`, template
  driven, sanitized, never overwriting unless you say so.
- 🖼️ **Picture sets too** — loose originals, or one `.zip` / `.cbz` / `.pdf` per post,
  written by a dependency-free archiver.
- 🎞️ **HLS → MP4 in-browser** — remuxed by a vendored transmuxer, no server, no ffmpeg.
- 🙈 **Silent everywhere else** — it only activates on URLs the router recognises.

---

## 🗺️ What works where

The extension **only activates on URLs it recognises** (`extension/site-routes.js` is
the single routing table); on every other page it stays silent.

| Where you are | What the panel / page offers |
|---|---|
| **rule34video.com** video page | *Download this post* (best quality, or your preferred height) |
| rule34video.com homepage, `/latest-updates`, search, tag, category, artist, member | *List this page* · *Download page* · page range (`2,4,6-10`, `1-99`) → *Fetch selected pages*, review, then *Download selected*; a ⬇ on every card |
| rule34video.com **playlist** | the same, plus a *Fetch page batch* pill — every fetched row is reviewed in the panel before it can download |
| **rule34.world** post | *Download this post* (picture **or** video) |
| rule34.world homepage, tag search, `/hot` `/highest` `/trends`, playlist | Twitter-style queue: fetch pics and videos through the site API (page N here = page N on the site), filter by media type, review the selected rows, then start them explicitly |
| anything else | queue only, plus *Fetch from a URL* (paste any listing / playlist URL of either site) |

Every listed post is a row with a checkbox, thumbnail, site/type badge, page number
and live status (listed → queued → resolving → downloading → completed / failed).
*Select all*, *Invert*, filter, *Retry failed*, *Clear finished*, *Skip already
downloaded* (with a resettable history) and a **Downloads at once** switch behave
exactly like the sister X/Twitter downloader panel. To avoid an unreviewable list,
each fetch is limited to **150 pages** (use successive ranges for a larger listing).
**Stop fetch** aborts the current request and prevents subsequent pages; **Stop**
pauses waiting downloads while active rows can be cancelled individually.

---

## 📥 Where files land

```
Downloads/
  R34V/                          ← master folder (rename it, or clear it to turn off)
    rule34video/                 ← which site the post came from (automatic)
      AnArtist - Some title - 4573905/     ← your tags / template / manual name
        Some title.mp4
    rule34world/
      WorldArtist - post 3571567/
        001.jpg                  ← picture post, loose mode (or one .zip/.cbz/.pdf)
```

> The **id lives in the folder name**, not the file name — so the file is
> `<title>.<ext>`. (On rule34.world the title already ends with `post <id>`, so a
> post there saves as `WorldArtist - post 3571567.mp4`.)

- 🌐 The **site level is automatic** — it comes from the site that served the post, so
  the two sites never end up in the same folder.
- 🏷️ The **folder name** comes from a template (`{artist} - {title} - {id}` by default,
  one checkbox per token), from the tags you tick, from a name you type yourself
  (highest priority), or from the search you started from. Whatever wins is sanitized;
  nothing can escape the download folder and files are never overwritten unless you ask.
- 📂 Everything happens inside your **fixed download location, with no prompts** (turn
  off Chrome's *"Ask where to save each file"* for the folders to appear).

---

## 🧱 How it's built

| Path | What |
|---|---|
| `extension/` | The shipped extension (load this folder unpacked). Runtime-only. |
| `extension/site-routes.js` | **URL router** (which page is this? what listing does it belong to?), page-range grammar, rule34video.com listing/pagination parser, rule34.world search-body builder. Shared by the worker, the panel and both content scripts; unit-tested. |
| `extension/panel-queue.js` | The Side Panel **queue engine** (worker side): persistent list, worker pool, page crawler with one adapter per site, download history. Dependency-injected, unit-tested offline. |
| `extension/sidepanel.html/.js` + `styles/sidepanel.css` | The Side Panel UI (opens from the toolbar icon, the page pill, or the context menu) |
| `extension/content-rule34video.js`, `extension/content-rule34world.js` | Per-site page adapters: corner ⬇ buttons, the floating pill, `collectListing` for the panel. Each fires only on routes the router recognises. |
| `extension/folder-naming.js` | The output-path engine: master folder, site slug map, path sanitizer, folder-name template |
| `extension/modules/archive/` | Dependency-free ZIP/CBZ writer and PDF writer for picture sets |
| `source/` | All development-use code: `retired/` (retired extension code + the `generic-hoster/` retirement kit), `vendor/` + `page-source/` (never-used sources), `tools/`, `tests/`, `docs/`. See `source/README.md`. |
| `source/tools/validate.mjs` | Offline validation (syntax, JSON, branding, **stale file references**, **declared-host inventory**) — the single source of truth shared by `npm run check` and CI |
| `.github/workflows/ci.yml` | Runs `npm run check` + every offline suite on each push/PR. Every step is an `npm run` script, so CI and local runs are identical. |

**Two design rules keep it small and honest:**

1. 🚫 **Nothing in `extension/` may reference a site that isn't declared.**
   `validate.mjs` keeps an inventory; the "generic hoster" list is empty on purpose
   and may only shrink (see `source/docs/DEADCODE_SWEEP.md`).
2. 🧪 **Everything testable must be testable offline.** No browser, no network, no
   fixtures that need logging in.

---

## 🚀 Install

```bash
git clone https://github.com/freeforall1932-design/rule34video
```

1. Open `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder.
3. Visit a supported page and click the ⬇ pill, or open the Side Panel from the icon.

> 📦 There is no build step and no `npm install`: the folder you clone is the folder
> you load. `npm` is only used to run the test suites.
>
> 🔁 Update checks hit this repo's GitHub Releases. Turn them off in the panel if you'd
> rather not.

---

## 🧪 Test it

```bash
npm test                                   # everything below, in order

node --test "source/tests/*.test.mjs"      # fixtures: routes, panel queue + crawler, folder
                                           #   naming, ZIP, PDF, queue restore, hoster reachability
node source/tests/smoke.mjs                # real service worker under mocked chrome + fetch
node source/tests/e2e-download-paths.mjs   # real worker + offscreen doc: the saved paths
npm run check                              # syntax, JSON, branding, stale refs, host inventory
```

All suites run offline on plain Node — **110 fixture checks, 0 runtime dependencies.**

---

## 🗂 Docs

| Document | Read it when… |
|---|---|
| [`SESSION_HANDOFF.md`](source/docs/SESSION_HANDOFF.md) | you're starting a session — true repo state, every session's outcome, what's left |
| [`WORKLIST.md`](source/docs/WORKLIST.md) | you want the open items, ordered, with *"needs data"* flagged instead of guessed |
| [`IMPROVEMENT_LOG.md`](source/docs/IMPROVEMENT_LOG.md) | you want the why behind a change, dated |
| [`DEADCODE_SWEEP.md`](source/docs/DEADCODE_SWEEP.md) | you're about to delete something — includes the near-misses that would have broken a working path |
| [`MULTIHOST_PLAN.md`](source/docs/MULTIHOST_PLAN.md) | you're adding a third site (or building a sibling repo) |
| [`NAMING_REVIEW.md`](source/docs/NAMING_REVIEW.md) | you're touching output naming |
| [`RETROFIT_AUDIT.md`](source/docs/RETROFIT_AUDIT.md) | you're wondering why some odd code exists (it was cloned from a paid multi-site template) |
| [`privacy.md`](source/docs/privacy.md) | you want the data policy in one paragraph |

---

## 🧭 Status & roadmap

| | |
|---|---|
| 🏷️ Shipped | **6.0.2** — filename guard no longer clashes with other downloaders |
| 🧩 Latest build | 6.0.2-rc: world listings fetch by **From → To**, advanced free-text ranges, and a fetch button that becomes **Stop fetch** mid-crawl |
| 🧠 Engine | resolvers, concurrency queue, HLS remux, picture archives, per-site tag-named folders — unchanged from 5.x; the panel feeds it |
| 🧹 Housekeeping | −271 lines of unreachable template code removed 2026-09-14, preserved in `source/retired/generic-hoster/` |
| 📋 Open work | everything tracked in [`WORKLIST.md`](source/docs/WORKLIST.md); real-browser checks stay manual by design (GitHub runners can't verify "did the folder appear") |

---

## ⚠️ Disclaimer

Unofficial and not affiliated with, endorsed by, or sponsored by any site this
extension can talk to. It automates **your own** browsing session: it reads pages you
have already opened and downloads content you can already see. Respect each site's
terms and the rights of every creator whose work you save.

## 📄 License

MIT — see [`LICENSE`](LICENSE). Vendored third-party code keeps its own license; see
[`THIRD_PARTY_LICENSES.md`](source/docs/THIRD_PARTY_LICENSES.md).
