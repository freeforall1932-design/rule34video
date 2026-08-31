# Session-6 regression validation — session 5 (`f1c5dcc`) vs session 6 (`117d0c5`)

Owner request (2026-08-31, session 7): *validate whether session 6 just broke
the entire project, using session 5 as the stable point.*

**Verdict: session 6 did not break the project.** Every check below shows the
shipped extension behaves identically on both commits; session 6 only removed
code that was provably unreachable, plus two byte-identical/provenance config
files. The shipped extension folder went 2.2 MB → 0.85 MB with no functional
change.

- Stable point: `f1c5dcc` (PR #4 merge, v4.4.0 — end of session 5)
- Session 6 result: `117d0c5` (PR #5 merge, v4.4.2)

## 1. Functional equivalence — full message-API battery

A mocked-chrome harness loaded the **real** `background-enhanced.js` from each
commit (same temp-copy + ESM-rewrite mechanism as `tests/smoke.mjs`) and fired
all 25 message actions through the real `chrome.runtime.onMessage` handler
with identical fixtures: `getVideoFormats` (world + rule34video),
`downloadVideo` (image / direct MP4 / HLS→offscreen), queue controls,
`batchDownloadPosts`, `bulkDownloadTag` (both sites), progress/ack forwarders,
`cancelDownload`, `TELEMETRY_LOG`, `LOG_MIRROR`, unknown action.

Result: **byte-identical responses on every action for both commits** —
including the deep paths:

- `getVideoFormats` world: same 3 formats, same artist-extracted `apiTitle`.
- `getVideoFormats` rule34video: same signed `get_file` MP4 formats.
- `downloadVideo` HLS: same `success:true` result; the offscreen document was
  created and both `PROCESS_HLS_SEGMENTS` / `PROCESS_MP4_DOWNLOAD` messages
  were sent and acknowledged in both sessions.
- Queue/batch/bulk actions: identical accept/skip counts.

The handful of failing assertions were **identical in session 5**, i.e.
harness fixture gaps (missing mock fields like `downloads.cancel`), not
regressions. `node tests/smoke.mjs` passes on both commits (the session-6
smoke file is byte-identical to session 5's).

## 2. Message surface identical

- The `onMessage` switch in `background-enhanced.js` has the **exact same 23
  cases** in s5 and s6 (sorted diff = empty).
- Every `action:` string sent by popup/offscreen/content scripts exists in the
  background's switch in both sessions. The 3 senders-only actions
  (`downloadProgress`, `fetchThumbnailData`, `videoDetected`) are
  background→content or content→content messages, identical in both.

## 3. Bridge member removal was safe

Session 6 trimmed the `Rule34BackgroundBridge` freeze block 36 → 24 members.
For each of the 13 removed members (`handleActionClick`,
`handleParseM3U8Message`, `handleFetchM3U8PlaylistMessage`,
`handleDownloadBlobMessage`, `getActiveTabId`, `resolveSenderOrActiveTabId`,
`respondWithPromise`, `safeSendResponse`, `sendMessageToTabSafely`,
`isNoReceiverError`, `isConfiguredContextMenuClick`, `getBackgroundConfig`,
`getContextMenuConfig`):

- **zero references** to the name remain anywhere in the s6 extension, and
- in s5 they were already unreachable: no `onMessage` switch case routed to
  them and no file sent the corresponding message.

## 4. Static reachability audit (the thing a purge could break)

- s5: **~20 broken references** in the extension folder — the orphaned
  clusters' imports (`modules/utils/*.mjs` importing `../enums/…`,
  `../options/…`, `../ui/…`, `sweetalert.mjs`, …), `Localize.mjs` importing
  `utils/EnvUtils.mjs`, and a `web_accessible_resources` `modules/**/*` block
  that matched nothing loadable from a page. Session 6 deleted exactly these.
- s6: **1 remaining dangling reference** — `popup.js` `getURL("history.html")`
  behind a `try { … } catch {}`. It is identical in s5 (pre-existing dead
  button), so it is not a session-6 issue (and is now tracked in WORKLIST).
- `node --check` on every `.js`/`.mjs` in the extension folder: clean on both
  commits. Manifest JSON valid on both.

## 5. Manifest policy diff

- `permissions`: identical.
- `host_permissions`: identical.
- `web_accessible_resources`: s5 exposed `inject.js` + CSS, `offscreen.html` +
  `offscreen.js`, and `modules/**/*` to `<all_urls>`. s6 keeps only the
  page-context loads that actually happen — `inject.js` + the two content CSS
  files, restricted to the two supported sites. Verified safe: the only
  `getURL()` users of `offscreen.*` / `modules/*` are extension contexts
  (background creates the offscreen document; `offscreen.js` loads the
  transmuxer), which never need WAR. Nothing loads them from a page context.

## 6. What session 6 actually changed in the extension folder

`git diff f1c5dcc..117d0c5 -- "rule34video downloader"`:

- **Deleted** (all verified unreachable; retained in `scrapyard/`):
  `mediabunny/`, `mp4box.mjs`, `reencoder/`, `dash2mp4/`, `modules/utils/*`
  except `EnvUtils.mjs`, `Localize.mjs`, `hls/Mp4Sample.mjs`, duplicate
  `eventemitter/`, `unified-app.config.json` (byte-identical dupe),
  `factory-candidate.config.json`.
- **Modified (5 files, all covered by the checks above):**
  `background-enhanced.js`, `background-bridge.js`, `offscreen.js`,
  `post-actions.js` (in-file dead code + queue/host-probe hardening),
  `manifest.json` (WAR narrowing + version 4.4.2).
- CI on the session-6 merge (GitHub Actions run `33371030852`) succeeded.

## Method note

The harness used for this validation is reproducible but was written for a
one-off diff (it lives outside the repo, as session 7's deliverable is the
report). Committed regression coverage remains `tests/smoke.mjs` (CI).
