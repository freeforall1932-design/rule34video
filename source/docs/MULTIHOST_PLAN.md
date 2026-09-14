# Multi-host plan — one engine, many video-only sites

Planning only. No code in this doc is committed yet. Written 2026-09-14, after the
dead-code sweep (`DEADCODE_SWEEP.md`), for the planned sibling repo covering
**video-only, non-booru sites** (4-6 more).

## The premise this plan is built on

You do not need a plugin framework. Two things already exist:

1. **A real plugin seam.** `background-enhanced.js:12` is
   `const Adapter = globalThis.Rule34SiteAdapter || {};` and two blocks call
   `Adapter.getVideoFormats` / `Adapter.prepareDownload`. Nothing assigns that
   global, so the hooks are inert today. **Assigning it is the entire integration
   point** — no refactor needed to support "a new site".
2. **A host-agnostic engine.** `offscreen.js`, `background-bridge.js`, `logger.js`,
   `panel-queue.js`, `folder-naming.js`, `modules/hls2mp4/*`, `modules/archive/*`
   contain **zero** domain literals (verified by the sweep's host inventory). The
   queue, crawler, worker pool, naming, HLS→MP4 and ZIP/PDF layers are already
   shareable as-is.

Everything else in this plan is bookkeeping around those two facts.

## Decision rule (settles the "same name vs new repo" question)

| Candidate domain is… | Do this |
|---|---|
| a **mirror / alternate TLD** of a site you already support | add 2 host regexes in `site-routes.js`, `host_permissions` + a `content_scripts` entry in the manifest, one line in `SITE_SLUG_BY_HOST` (`folder-naming.js:44-47`). Already-proven pattern: `rule34.xyz` → `rule34world`. **Same repo.** |
| a **distinct site** (your video-only set) | new *app*, not new *copy*: one adapter file + config, built against the shared core. **New repo, built from core.** |
| a site you have **never opened a listing page on** | nothing. Do not add it. |

Third row is the rule that keeps you out of the trap the ancestor repo fell into:
`ALLOWED_HOSTER_HOSTS` in `validate.mjs` is full of CDN/ad names for sites nobody
here ever tested (`phncdn.com`, `itsup.com`). That is what "supports many hosts,
verified on none" looks like after two years.

## Phase 0 — in this repo, before any fork (~1 session)

Replace `route.site === "world"` special-casing with **capabilities declared by the
adapter**, so "video-only" becomes a property of a site rather than an absence:

| Today | Becomes |
|---|---|
| `panel-queue.js:783`, `:1090` — `mediaType = route.site === "world" ? … : "all"` | `adapter.capabilities.mediaTypes` (`["video"]` or `["video","image"]`); the filter control hides itself for video-only |
| `panel-queue.js:377-378` — `Post {id}` vs `Video {id}`, world-only thumbnail | `adapter.noun` + `adapter.thumbnailFor(id)` |
| `sidepanel.js:113`, `:129-135` — labels/copy per site | `adapter.labels` |

Preserve behavior exactly: keep `site-routes.test.mjs` + `panel-queue.test.mjs`
green without editing their assertions. Do this **first** — forking before it means
each fork re-invents the same ternaries.

## Phase 1 — the core/app split (~2 sessions)

Constraint to respect: **this repo has no build step and no dependencies**
(`package.json` devDependencies is `{}`, and the README sells "load `extension/`
unpacked"). Do not introduce a bundler for this. Use a 100-line Node copy script in
the existing style:

```
core/                     # the engine, no domain literals
  panel-queue.js  folder-naming.js  site-routes.js  (as a router *base*)
  sidepanel.*  offscreen.*  background-bridge.js  logger.js  update-notifier.js
  modules/
apps/
  rule34video/            # this repo's site layer
    adapter.js            # routes + listing parsers + capabilities + branding
    app.config.json       # name, hosts, folder slug, icons, brand colors
    content-*.js
  <newsite>/
    adapter.js  app.config.json  content-*.js
build.mjs                 # node build.mjs apps/rule34video  →  dist/rule34video/extension/
```

- `apps/*/app.config.json` **replaces** the current orphaned
  `source/tools/app.config.json`, which points at a generator
  (`unify-app-test/tools/generate-phase2-config.mjs`) that is not in this repo. A
  config whose generator lives on someone else's disk is how you ended up with
  `site-config.js` hand-edited and drift-prone.
- Manifest is *generated* from `app.config.json` (hosts, content-script matches,
  `UPDATE_CHECK.repoName`). Then a half-finished rename becomes impossible, and the
  sibling-inherits-parent's-updater failure mode cannot occur.
- `source/retired/`, `source/vendor/`, `source/page-source/` stay out of `dist/`.

## Phase 2 — the adapter contract (~1 session)

Exactly this, nothing more. A site is supported when it can answer all of it:

```js
{
  id: "newsite",                       // folder slug + storage namespace
  hosts: ["newsite.com"],              // mirrors allowed: same id, more hosts
  capabilities: { mediaTypes: ["video"], needsReferer: true, playlists: false },
  routes: (url) => ({ kind, id, page, … } | null),   // video|listing|search|tag
  listing: {
    parse(html, url)      -> { items[], totalPages },  // cards on a listing page
    pageUrl(base, n)      -> string,                    // "page N here = page N there"
  },
  resolve: { post(id|url) -> { title, artist, date, mediaUrls[] } },
  media:   { pick(formats, preferredHeight) -> format },
  labels:  { noun: "Video", eyebrow: "NEWSITE.COM" },
}
```

Keep the **`Adapter.getVideoFormats` / `prepareDownload` hook names already in the
worker** — implement the contract as `globalThis.Rule34SiteAdapter` inside the app's
`content`/worker bundle, so the seam stays a single global and `background-enhanced.js`
never gains another `site ===` branch.

Deliberately **not** in the contract: generic iframe sniffing, proof-of-work/captcha
solvers, "download from any page" fallbacks. That is the ~3.6k-line
`source/retired/site-adapter.js` shape, and it is retired for a reason.

## Phase 3 — per-app CI and updates (~1 session)

Already half-built by the sweep; extend rather than invent:

- `validate.mjs` host inventory runs **per app** with `ALLOWED_HOSTER_HOSTS` empty
  for new apps → a video-only repo *cannot* grow a scraper without a deliberate
  allowlist edit. This is the enforcement, not a convention.
- Stale-reference + site-config↔manifest checks already pass; keep them as the
  "does this file still link to anything" sweep, run automatically instead of by hand.
- One release tag per app (`v6.0.2`, `newsite-v0.1.0`) in the core repo, or per-app
  repos with core as a submodule — pick per-app repos only if you want independent
  store listings; the copy tax documented in `NAMING_REVIEW.md` (one fix ported from
  `twitter-batch-download`, 2 of 3 triaged items N/A) is the price.
- Licensing gate before any vendored file ships in a new app: `modules/hls/hls.mjs`
  (397 KB, Apache-2.0 upstream) and the `hls2mp4`/`archive` vendoring need a
  `THIRD_PARTY_LICENSES.md` entry per app; `mediabunny` is MPL-2.0 and must keep its
  sources available.

## Open questions to settle before Phase 1

1. Does `panel-queue.js`'s crawler assume the *site's own* pagination grammar
   everywhere, or is `site-routes.js` already the only parser? (It writes the
   rule34video parser there today — confirm the world path goes through its API
   builder only.)
2. Do any of the 4-6 targets require a referer or cookie to fetch media? If yes,
   `capabilities.needsReferer` must exist before the first app, and
   `withTemporaryHeaderRules` becomes part of the core API (it is live, 4 call sites).
3. Is `source/page-source/` per-app fixtures (saved listing HTML) enough to drive
   offline parser tests for a new site, or does each app need its own fixtures dir?
   Recommended: yes, per-app fixtures — that is what makes "we tested it" true.
