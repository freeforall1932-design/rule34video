# Naming-feature code review (Rule34 Downloader)

Review date: 2026-09-02 · on branch `arena/01a06057-rule34video`.

This is a targeted review of the output-naming feature (master folder + per-site
folder + tag/artist collection folder + filename) and the paths that feed it,
motivated by the fact that the sister `twitter-batch` project found bugs after
shipping the same naming system. The naming engine lives in
`extension/folder-naming.js`; the consumers are `background-enhanced.js`
(service worker), `popup.js`, `offscreen.js`, and `post-actions.js`.

## What was verified

- All offline suites pass on the base commit: `npm run check` (validation),
  `node --test source/tests/*.test.mjs` (59 fixture checks, incl. 31 naming),
  `node source/tests/smoke.mjs`, `node source/tests/e2e-download-paths.mjs`.
- The four naming code paths were traced end to end:
  1. **Popup** → `handleDownload` ships `__output` (`manual`, `tags`,
     `useSearchQuery`) + `__searchContext`; the worker merges metadata from
     `getVideoFormats` (`apiArtist/apiUploader/apiDate`) in `downloadVideo`.
  2. **Corner button / "Download visible" / tag+playlist batch** → all route
     through `processBatchJob` → `queueDownloadRequest` with `skipFormatRefresh`.
  3. **Context menu** → `handleConfiguredContextMenuClick` → `queueDownloadRequest`.
  4. **Image sets** → `downloadImageSet` (loose numbered originals or one
     ZIP/CBZ/PDF per post).

## Bug fixed in this session

**Batch / corner-button downloads dropped the resolved post metadata, so the
same post landed in two different folder names depending on how it was queued.**

`processBatchJob` (in `extension/background-enhanced.js`) resolves each post with
`resolveKnownPost()` — which returns `artist`, `uploader`, `date` and `tags` — but
the object it passed to `queueDownloadRequest` contained only
`{ id, title, url, thumbnail, duration, selectedFormat, formats,
skipFormatRefresh, __fromBatch }`. Because `skipFormatRefresh: true` also skips the
`apiArtist`/`apiUploader`/`apiDate` merge in `downloadVideo`, every batch item hit
the naming engine with an empty `{artist}` (and empty `{uploader}`/`{date}`/`{tags}`).
The collection folder therefore fell back to a bare `title - id`, while a popup
download of the same post produced an artist-derived folder.

Concretely (rule34.world, template `{artist} - {title} - {id}`):

```
popup / context-menu:  R34V/rule34world/WorldArtist - <title> - 3571567/<file>.mp4
batch / corner-button: R34V/rule34world/WorldArtist - <title> - 3571567/<file>.mp4
                       …but with {artist} empty, so the two differ
```

Before the fix a batch item produced
`R34V/rule34world/WorldArtist - post 3571567 - 3571567/<file>.mp4` (artist token
empty) whereas a popup item produced
`R34V/rule34world/WorldArtist - WorldArtist - post 3571567 - 3571567/<file>.mp4`
(artist token set). The fix passes the resolver's `artist`/`uploader`/`date`
through to the naming engine (`{tags}` is not taken from the resolver — it is the
user's checked/stored page tags, see the self-review below) so batch/corner-button
folders match the popup folder for the same post.

**Change:** `extension/background-enhanced.js` — `processBatchJob()` now forwards
`artist`, `uploader`, `date` from `resolved` into the naming tokens.

**Test added:** `source/tests/e2e-download-paths.mjs` section `A8` drives the real
`batchDownloadPosts` handler and asserts the batch folder is built from the
resolver artist (`R34V/rule34world/WorldArtist - 4444444/`) rather than a bare
title.

## Follow-ups completed in this session

### High (done): rule34.world titles embed the artist → de-duped in the naming engine

`resolveRule34WorldPost` builds `title = [artist, baseName || "post <id>"].join(" - ")`,
so the default template `{artist} - {title} - {id}` filled to a repeated artist:

```
R34V/rule34world/WorldArtist - WorldArtist - post 3571567 - 3571567/
```

**Change:** `extension/folder-naming.js` — added `collapseRepeatedLeadingArtist()`
and applied it in `resolveCollectionName()` for *template-derived* names only (a
`{artist}` value that also heads the title is collapsed once). The repeated artist
must be a whole token (followed by a separator or end), so an artist that is merely
a prefix of a longer title word (artist `Sun`, title `Sunshine`) is never mangled.
A user-typed `manual` override is never rewritten. The default (non-artist) mode
now produces:

```
R34V/rule34world/WorldArtist - post 3571567 - 3571567/
```

**Tests added** in `source/tests/folder-naming.test.mjs` (the helper incl. the
prefix-not-collapse edge case, the collection-folder de-dup, and the
manual-override is-not-rewritten guarantee).

### Medium (done): search-query folder naming now applies to batch / corner-button downloads

Batch and corner-button downloads (which carry `__fromBatch`) now offer the
search/tag/playlist query as a folder-name candidate. `resolveOutputChoice` in
`extension/background-enhanced.js` sets `useSearchQuery: true` for `__fromBatch`
items; `searchContextForVideoInfo` reads the query from the tab the batch was
started from. The query only ever wins when the template produces nothing (so an
explicit template is never overridden) and it never clobbers a stored manual
choice.

**Test added** in `source/tests/e2e-download-paths.mjs` §A9 (empty template +
search tab → folder is the search query).

## Transferable fix ported from the sister repo (twitter-batch)

### Fixed: separator collapsing must run AFTER stripping illegal characters

`fillTemplate` collapses separators via `tidySeparators`, but `sanitizeSegment` /
`cleanSegment` strip illegal characters *afterwards*. So a token whose only content
gets stripped (a post title of `"???"`) left a double empty " - " gap:

```
R34V/rule34video/nasa -  - 111/111.mp4      # before
R34V/rule34video/nasa - 111/111.mp4          # after
```

**Change:** `extension/folder-naming.js` — `sanitizeSegment()` now runs
`tidySeparators()` on the joined segments *after* cleaning and *before* the
reserved-name prefix, so the collapse happens post-strip and a `_CON` prefix is
never stripped. This mirrors the sister repo's fix.

**Test added** in `source/tests/folder-naming.test.mjs` (`collapses separators
AFTER illegal characters are stripped (not before)`), including a guard that
`_CON` survives.

## Triage of the sister-repo (twitter-batch) review log

The twitter-batch agent left 3 open items + one recommended lesson. Mapped to
this repo:

- **"collapse separator/whitespace AFTER stripping illegal chars, not before"**
  → **applied here** (see the section above). This is the one genuine
  transferable bug and it is fixed + tested.
- **`{name}` token inconsistency (same post named differently by capture
  path)** → **RELEVANT here, and it is a real latent inconsistency.** See the
  finding below. Not applied (it changes behavior and needs a live page to pick
  the correct source); flagged as a decision.
- **No signed-in browser validation** → **a testing gap that applies here too.**
  New browser-check items added to `WORKLIST.md` (batch vs popup folder-name
  equality, and popup vs batch tag list).
- **Archive "don't warn about media that isn't actually packed"** → **NOT
  applicable.** This repo has no `buildRunNotices` / run-notices concept
  (`grep` for notices/packed finds nothing). The nearest trait is that both
  sites expose one original per post, so a ZIP/CBZ/PDF today holds a single
  page — that's documented, not a warning bug.

### Finding: page-tag collection diverges by capture path (the `{name}` analog)

The same rule34video.com post produces a **different** page-tag set depending on
how it is downloaded, so a `{tags}`-nominated folder name can differ:

- **Popup path** — `content.js` `extractPageTags()` runs against the live DOM
  with broad selectors (`a[href*="/tags/"], a[href*="/tag/"], .tag a,
  .tags a, [class*="tag"] a`), then `applyOutputContext` merges it with the
  worker's tag set (union).
- **Batch / corner-button path** — `background-enhanced.js`
  `collectRule34VideoTags()` runs against the **fetched post-page HTML** with a
  strict regex (`rule34video.com/tags/<digits>` absolute hrefs only).
  `processBatchJob()` forwards only these as `resolved.tags`.

So the popup's candidate tag list is the **union** of both collectors, while a
batch download only sees the strict worker regex set (or the per-URL stored
checked tags). A tag that only the live-DOM selector catches (e.g. a
`/tag/<slug>` link or a `[class*="tag"]` anchor that isn't an absolute
`/tags/<digits>` URL) is available to a popup naming but invisible to a batch
naming, so the post's folder name splits by download path. This is the same
class of bug the sister repo found (DOM-captured `displayName` vs GraphQL name).

**Why not applied:** harmonising the two collectors is a behavior change (it can
renumber existing folders) and the *correct* source needs a live post page to
confirm which selector reflects the real tag block (the WORKLIST already tracks
live-browser verification of `collectRule34VideoTags`/`collectRule34VideoUploader`/
`collectRule34VideoDate`). Recommended direction once verified: make the worker's
`collectRule34VideoTags` use the same selector intent as `extractPageTags`
(single source of truth) so all download paths see one tag set.

**Not an issue:** `{artist}` on rule34video.com has no dedicated source — the
resolver returns no `artist`, and `postNamingContext` intentionally falls back to
`uploader` (model/channel). Both the popup and batch paths source that uploader
from the **same** worker `collectRule34VideoUploader()`, so `{name}`-style
divergence does **not** occur for `{artist}`/`{uploader}` — only for `{tags}`.

## Self-review of this session's diff

A second pass over exactly the code changed this session, looking for missing
logic / misaligned code / bugs introduced by those edits.

### Fixed this pass: dead batch `tags` forward (misaligned code + misleading comment)

`processBatchJob` forwarded `tags: resolved.tags` into `videoInfo.tags`, but the
naming engine never reads `videoInfo.tags`: `resolveCollectionName` fills `{tags}`
from `checkedTags` (`buildRelativePath` → `resolveCollectionName({ checkedTags })`),
which comes from `options.checkedTags || choice.tags`, and `resolveOutputChoice`
reads `__output.tags` (popup) or the per-URL `stored.tags` — never the resolver's
`tags`. So the forward was **dead**, and the fix's rationale over-claimed by
listing `{tags}` as populated (it stayed empty for batch items unless a stored
choice existed).

**Change:** removed the `tags: resolved.tags` forward and corrected the comment in
`processBatchJob` (and the A8 test comment). Auto-filling `{tags}` from every
resolver tag would have been **wrong**: it would diverge from the popup's
checked-tags semantic and produce bloated folder names for batch items. `{tags}`
stays a user-checked/stored value on every path.

### Decided (kept uniform): `sanitizeSegment` tidies separators for ALL sources

Before the separator fix only `fillTemplate` collapsed separators (so only
template results were `tidySeparators`-collapsed); `sanitizeSegment` passed a
manual/search/id name through verbatim (apart from `cleanSegment`'s char/edge
stripping). Now `sanitizeSegment` runs `tidySeparators` on the joined segments for
**every** source, so a manual override `A - - B` collapses to `A - B`.

This is intentionally kept uniform — a single code path with no per-source
branching. It does not meaningfully weaken "manual is verbatim": `cleanSegment`
already strips illegal chars and edge dots/spaces from every name, so byte-for-byte
manual fidelity never existed. The meaningful guarantee (a manual name is never
**artist-collapsed**) is preserved, because `collapseRepeatedLeadingArtist` runs
only for `source === "template"`. Collapsing an accidental double separator is a
sensible cleanup for a typed name too. Not a bug.

### Noted (edge, not fixed): artist de-dup only fires for the ` - ` separator

`collapseRepeatedLeadingArtist` matches on `artist + " - "`, so a hand-typed
template using a different separator (e.g. `{artist}/{title}/{id}`) is **not**
de-duped and yields `Artist-Artist - …`. The popup always rebuilds templates with
the ` - ` separator (and the default template uses it), so this only affects
hand-edited template strings. Low impact; could generalise the helper later.

### Noted (very niche): non-ASCII case-folding assumption in the collapse helper

`collapseRepeatedLeadingArtist` slices `rest` by `artist.length` after a
case-insensitive `startsWith`. For scripts where lower-casing changes byte length
this could offset, but none of the current sites do that. Not worth guarding.

## Findings that were NOT changed (worth a decision / follow-up)

### Aligned: README filename now matches the shipped behavior

`README.md` showed the file as `Some title - 4573905.mp4` (title + id), but the
producing callers (`resolveOutputTarget` in `downloadVideo` and `downloadImageSet`,
and the popup preview) default to a title-only filename (`Some title.mp4`). We did
**not** force the id into the filename because rule34.world titles already embed it
(as `WorldArtist - post 3571567`), which would have duplicated the id.
`README.md` is updated to document the actual behavior: the id lives in the
folder name, the file is `<title>.<ext>`.

### Noted (niche, degrades safely): artist-folder mode with a Windows-reserved artist

In artist-folder mode a reserved-name artist (e.g. an artist literally called
`Con`) is prefixed in the folder head to `_Con`, but the tail still starts with the
un-prefixed `Con - …`, so the artist appears twice. It produces a valid, safe path
(no escape, no overwrite) so it was left as a documented edge rather than fixed.

## Sloppy / dead-weight code (safe to trim eventually, not addressable here)

- **Leftover generic-hoster code** in `background-enhanced.js` and
  `background-bridge.js` for hosts that cannot appear on these two sites
  (xiaoshenke, erome, cloudflarestream, xtremestream, doodstream, streamtape,
  aki-h, `get_file`/`reversebuffer` proxy rewrites). The `webRequest` listener and
  host permissions only cover the two rule34 sites, so most of
  `observedMediaFormats`, `xiaoshenkePlayerFormats`, `cloudflareStreamManifestFormats`,
  `resolveXiaoshenkeSignedUrl`, `shouldUseTabInitiatedDownload`, `erome` branches,
  and the DNR reference-rule helpers are effectively unreachable in production.
  They are left in place because removing them is a large, risky change; this is
  the biggest single source of "sloppy code" in the shipped worker.
- **`getVideoInfoActions` / `getXVideosVideoInfo`** in `popup.js` are generic
  template leftovers (the "xvideos" branch is never taken for rule34).
- **`download-manager.js`** is a generic download-progress UI whose legacy guard
  keys (`__AP_DM_LOADED__`, `__XV_DM_LOADED__`, …) reference sites unrelated to
  this project. It is loaded as a content script but only driven by legacy message
  types that the current code no longer emits, so it adds ~20 KB with little effect.
- (Fixed) Minor formatting: `handleDownload` in `popup.js` had an inconsistent
  indentation (`refreshQueueItems(elements)` staggered under the `result.queued`
  branch) — aligned in this session.

## Deferred optimizations (from review, not yet applied)

1. **Ship a remux-only hls.js build** (already tracked in `WORKLIST.md`; ~340 KB
   package reduction, needs a build step + browser regression test first).
2. **Consolidate the dual canonical/legacy progress payloads** — session 9 already
   removed most of the legacy path; verify the remaining `legacyPayload` branches in
   `background-bridge.js` (`notifyDownloadProgressToContent`) are still needed.
3. **Trim the unreachable generic-hoster branches** above after a reachability
   trace confirms they are dead.
4. **Guard `chrome.downloads.onChanged`/`onDeterminingFilename` registrations** —
   they are wrapped in `try/catch`, but `addListener` failures are silently ignored;
   consider logging so a broken download integration is observable.

## Reproduction notes

- The probe harness must inject `URL` into the `vm` sandbox; without it
  `searchContextFromUrl` silently returns `""` because `new URL` throws inside a
  bare `vm` context (this misled the initial probe — the shipped code is correct,
  as the fixture tests confirm).
