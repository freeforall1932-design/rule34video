# v5 popup UI (retired in 6.0.0)

The pre-Side-Panel user interface, kept for reference and never packaged:

| File | Was |
|---|---|
| `popup.html`, `popup.js`, `styles/popup-enhanced.css`, `styles/styles.css` | The toolbar popup: single-video quality list, concurrency slider, queue list, output settings, bulk tag/playlist box |
| `post-actions.js` | Generic both-domain corner ⬇ buttons + floating "Download visible" toolbar |
| `player-button.js`, `styles/player-button.css` | Overlay download button on the video player |
| `content.js`, `content-bridge.js`, `inject.js` | Generic generated content adapter + page-data relay (DOM/webRequest video detection) |
| `download-manager.js`, `styles/download-manager.css` | In-page progress toasts |

Replaced by `extension/sidepanel.*`, `extension/panel-queue.js`,
`extension/content-rule34video.js` and `extension/content-rule34world.js`,
all routed through `extension/site-routes.js`. The background message
handlers these files used (`downloadVideo`, `getVideoFormats`,
`batchDownloadPosts`, `bulkDownloadTag`, `getQueueItems`, …) still exist in
`background-enhanced.js`, so the popup can be revived by moving the files
back and re-adding `default_popup` + the content-script entries to the
manifest.
