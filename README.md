# rule34video

MV3 Chrome extension that downloads videos (and images) from
[rule34video.com](https://rule34video.com) and [rule34.world](https://rule34.world):
per-post download buttons, a popup with quality selection, batch ("download
visible" / by tag / by playlist), a concurrency-limited download queue that
survives service-worker restarts, HLS→MP4 remuxing in an offscreen document,
and downloads organized into per-site, tag-named folders. Free, no telemetry,
no accounts — see `source/docs/privacy.md`.

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
node --test "source/tests/*.test.mjs"      # fixtures: folder naming, ZIP, PDF
node source/tests/smoke.mjs                # real service worker under mocked chrome
node source/tests/e2e-download-paths.mjs   # real worker + offscreen doc: the saved paths
npm test                                   # all three

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

- Version **5.0.0** (see `source/docs/IMPROVEMENT_LOG.md` for the full history).
- Session 8 added the source-separated, tag-named output folders above
  (ported from the sister project `nh-dw-2.0`) and fixed two real save-path
  bugs found while wiring them: offscreen-downloaded videos were landing flat
  in the download root, and offscreen saves were double-foldered under
  `Rule 34/`.
- Session 6 removed ~1.35 MB of unreachable vendored code from the package
  (retained under `source/`) and trimmed dead handlers; shipped folder ≈ 0.85 MB.
- Known-open work is tracked in `source/docs/WORKLIST.md`; the largest items are a
  remux-only hls.js build (measured 67 KB achievable vs the shipped 407 KB
  bundle — needs a build step + a browser regression test first) and
  consolidating the dual canonical/legacy progress messages.

## License

MIT — see `LICENSE`. Vendored third-party code keeps its own license; see
`source/docs/THIRD_PARTY_LICENSES.md`.
