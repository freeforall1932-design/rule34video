# Third-party licenses & attribution

This document records the third-party code shipped inside
`rule34video downloader/modules/`. The project itself is MIT
(see the top-level `LICENSE`); the items below are **vendored** and keep their
own licenses. No third-party **service / API / telemetry** dependency was found
in the extension — all network calls target rule34.world, rule34video.com,
their BunnyCDN file host, or `api.github.com` (update checker) only.

## mediabunny — Mozilla Public License 2.0 (MPL-2.0)

- Path: `rule34video downloader/modules/mediabunny/`
- License: **MPL-2.0** (file-level copyleft). Full text: `modules/mediabunny/LICENSE`.
- Covers: ISO-BMFF, Matroska/WebM, MP3, OGG, WAV demux/mux + transmux helpers.
- Obligations (satisfied by shipping the source in this repo):
  - Keep the MPL-2.0 files under MPL-2.0.
  - If we **modify** any mediabunny file, the modified Source Code Form must be
    made available under MPL-2.0 (it already is — the source ships here).
  - Inform recipients where to obtain the mediabunny source (this repo).

## mp4box — BSD-3-Clause

- Path: `rule34video downloader/modules/mp4box.mjs`
- Header: `Copyright (c) 2012-2013. Telecom ParisTech/TSI/MM/GPAC Cyril Concolato.
  License: BSD-3-Clause`.
- Keep the copyright + license header intact. (The upstream "LICENSE file"
  referenced in the header is not vendored separately here; the in-file header
  is the attribution.)

## hls2mp4 / dash2mp4 / reencoder / mp4-muxer (transmux & re-encode)

- Path: `rule34video downloader/modules/hls2mp4/`, `modules/dash2mp4/`,
  `modules/reencoder/`, `modules/mp4box-ish muxers`.
- These are vendored transmuxers (comments reference the "FastStream" approach).
- **Status:** shipped unmodified. Upstream license should be confirmed before we
  modify them. Treat as "do not edit without verifying license" for now.
- If you modify, preserve original headers and add a clear change note.

## eventemitter / FSBlob / Localize / utils

- Small vendored helpers under `modules/` (eventemitter, FSBlob, Localize, utils/*).
- Shipped unmodified; keep headers intact.

## Rule of thumb for the community release

- The **extension is free, open, and MIT**.
- **Do not** silently relicense or obfuscate the MPL-2.0 mediabunny source.
- **Do not** add any closed/paid SDK, analytics beacon, or license-activation
  call home — that would break the "free for community" promise and the MPL
  source-availability commitment.
- Before modifying any vendored `modules/` file, confirm its license and keep
  the original header.
