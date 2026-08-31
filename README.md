# rule34video

MV3 Chrome extension that downloads videos (and images) from
[rule34video.com](https://rule34video.com) and [rule34.world](https://rule34.world):
per-post download buttons, a popup with quality selection, batch ("download
visible" / by tag / by playlist), a concurrency-limited download queue that
survives service-worker restarts, and HLS→MP4 remuxing in an offscreen
document. Free, no telemetry, no accounts — see `source/docs/privacy.md`.

## Repository layout

| Path | What |
|---|---|
| `extension/` | The shipped extension (load this folder unpacked). Runtime-only. |
| `source/` | All development-use code: `retired/` (retired extension code), `vendor/` + `page-source/` (never-used sources), `tools/`, `tests/`, `docs/`. See `source/README.md`. |
| `.github/workflows/ci.yml` | Syntax + JSON + branding checks + the smoke test, on every push/PR |

## Development

```bash
# 1. Load the extension
#    chrome://extensions → Developer mode → Load unpacked → "extension"

# 2. Run the smoke test (from the repo root)
node source/tests/smoke.mjs

# 3. Syntax-check everything (background is an ES module, the rest are classic)
cd extension
for f in *.js modules/*.mjs modules/*/*.mjs; do node --check "$f"; done
```

Workflow: develop in `source/`, ship the result into `extension/`, debug
against live-test findings by reading the extension files. CI runs steps 2–3
(plus JSON + branding greps) automatically. The full manual browser test
matrix lives in `source/docs/WORKLIST.md`.

## Current state

- Version **4.4.2** (see `source/docs/IMPROVEMENT_LOG.md` for the full history).
- Session 6 removed ~1.35 MB of unreachable vendored code from the package
  (retained under `source/`) and trimmed dead handlers; shipped folder ≈ 0.85 MB.
- Known-open work is tracked in `source/docs/WORKLIST.md`; the largest items are a
  remux-only hls.js build (measured 67 KB achievable vs the shipped 407 KB
  bundle — needs a build step + a browser regression test first) and
  consolidating the dual canonical/legacy progress messages.

## License

MIT — see `LICENSE`. Vendored third-party code keeps its own license; see
`source/docs/THIRD_PARTY_LICENSES.md`.
