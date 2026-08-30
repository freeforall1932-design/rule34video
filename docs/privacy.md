# Privacy — Downloader for Rule 34

This extension is **free and open**. It does **not** collect, transmit, or sell
any personal data, and it contains **no telemetry, analytics, or advertising**.

## What it does with your data

- **No accounts, no log-in, no license check.** The paid/licensed version of
  this product was removed; there is no "call home" for activation or tracking.
- **No analytics / telemetry.** The only `TELEMETRY_LOG` message in the code is
  mirrored to the extension's own local service-worker log — it is **not** sent
  anywhere.
- **Local-only storage.** The extension stores a few preferences on *your
  device* via `chrome.storage.local` and never uploads them:
  - the simultaneous-download limit,
  - your download-path template (Smart Library layout),
  - the in-progress download queue (so it survives a browser restart).

## What it talks to on the network

It only makes requests to the sites you are already using it on, plus one
optional update check:

| Destination | Why |
|---|---|
| `rule34.world` and `rule34video.com` | Resolve the post you want and download the media you click. |
| `rule34storage.b-cdn.net` | BunnyCDN file host that rule34.world serves media from. |
| `api.github.com` | Check for a newer release (update notifier). Disabled if you turn off update checks. |

That is the complete list. It does **not** contact any third-party analytics,
ad, or tracking service, and it does not scrape or upload your browsing history.

## Third-party code

The extension bundles a few vendored libraries (see
`docs/THIRD_PARTY_LICENSES.md`). These run locally to process media; none of
them phone home. The generic multi-site downloader module from the original
generator was **removed from the packaged extension** (kept only in `legacy/`
for reference).

## Source

MIT-licensed. Full source is available in the project repository so you can
verify every claim above.
