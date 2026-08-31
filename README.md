# rule34video

MV3 Chrome extension that downloads videos (and images) from
[rule34video.com](https://rule34video.com) and [rule34.world](https://rule34.world):
per-post download buttons, a popup with quality selection, batch ("download
visible" / by tag / by playlist), a concurrency-limited download queue that
survives service-worker restarts, and HLS→MP4 remuxing in an offscreen
document. Free, no telemetry, no accounts — see `docs/privacy.md`.

## Repository layout

| Path | What |
|---|---|
| `rule34video downloader/` | The extension (load this folder unpacked). Note the space in the name. |
| `docs/` | `SESSION_HANDOFF.md` (start here — full architecture + state), `WORKLIST.md` (test matrix + backlog), `IMPROVEMENT_LOG.md` (change history), `RETROFIT_AUDIT.md`, `privacy.md`, `THIRD_PARTY_LICENSES.md` |
| `scrapyard/` | Retired but retained code (multi-hoster adapter, DASH pipeline, mediabunny, saved page-source dumps). **Never packaged or imported** — see `scrapyard/README.md` |
| `tests/smoke.mjs` | Mocked-chrome integration test for the service worker (real resolver + batch paths) |
| `.github/workflows/ci.yml` | Syntax + JSON + branding checks + the smoke test, on every push/PR |

## Development

```bash
# 1. Load the extension
#    chrome://extensions → Developer mode → Load unpacked → "rule34video downloader"

# 2. Run the smoke test (from the repo root)
node tests/smoke.mjs

# 3. Syntax-check everything (background is an ES module, the rest are classic)
cd "rule34video downloader"
for f in *.js modules/*.mjs modules/*/*.mjs; do node --check "$f"; done
```

CI runs steps 2–3 (plus JSON + branding greps) automatically. The full manual
browser test matrix lives in `docs/WORKLIST.md`.

## Current state

- Version **4.4.2** (see `docs/IMPROVEMENT_LOG.md` for the full history).
- Session 6 removed ~1.35 MB of unreachable vendored code from the package
  (retained in `scrapyard/`) and trimmed dead handlers; shipped folder ≈ 0.85 MB.
- Known-open work is tracked in `docs/WORKLIST.md`; the largest items are a
  remux-only hls.js build (measured 67 KB achievable vs the shipped 407 KB
  bundle — needs a build step + a browser regression test first) and
  consolidating the dual canonical/legacy progress messages.

## License

MIT — see `LICENSE`. Vendored third-party code keeps its own license; see
`docs/THIRD_PARTY_LICENSES.md`.
