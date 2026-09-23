# Master plan — current and next Rule 34 family repos

Reusable planning note for future repo spins so the same architecture decisions do
not need to be re-explained each time.

_Last updated: 2026-09-23_

## 1) Fixed decisions

### Current repo: `rule34video`
- Keep this repo for:
  - `rule34video.com`
  - the shared `rule34.world` / `rule34.xyz` family
- `rule34.xyz` is a **same-family mirror / alternate domain**, not a new product.
- Deprecated site-related code/docs are **not** to be deleted just because they are
  no longer part of the active plan.
- `rule34video.com` should be skipped for new login/API work unless it is only
  needed to bypass guard / DDOS / fast-tab-opening issues.

### Future booru repo
- Build **one extension** for the booru family, not one repo per booru.
- Product model: **multiple saved servers/accounts** inside one extension.
- Initial target family:
  - e621
  - Danbooru
  - Gelbooru
  - similar booru-style installs later

### Future Pawchive repo
- Separate repo/product from this one.
- Auth must support **both**:
  1. browser-session reuse
  2. in-extension stored account form

### Future Newgrounds repo
- Separate repo/product from this one.
- Lower-feasibility target because NG Guard / anti-bot is the main blocker.
- Bias toward a content-script-first / browser-session-assisted design if pursued.

## 2) Feasibility summary by site family

### A. `rule34.world` / `rule34.xyz`
**Decision:** same repo, same adapter family.

Why:
- Same site family and route structure.
- Same API shape (`/api/v2/post/...`).
- Same listing concepts: tags, feeds, playlists, posts.
- Already partially anticipated in this repo (`folder-naming.js` already groups
  both into `rule34world`).

Implementation rule:
- Route both hosts through one shared adapter.
- Preserve host-specific origin/CDN values where needed.
- Keep downloads under the shared folder slug `rule34world`.

### B. Pawchive
**Decision:** separate repo, high enough feasibility to pursue.

Why:
- Stable creator/post/listing routes.
- Public pages exist.
- Login/session flow is visible and conventional.
- Mixed public + gated content suggests browser-cookie/session reuse is workable.

Main design rule:
- Support **hybrid auth**:
  - browser session reuse for users already logged in
  - extension-managed stored credentials for users who want an in-extension login

### C. Newgrounds
**Decision:** separate repo, later / experimental.

Why:
- Sandbox fetches hit NG Guard instead of usable content.
- Anti-bot behavior is the main product risk, not parsing.
- Needs real-browser validation before committing to a full build.

Main design rule:
- Treat challenge avoidance and browser-context access as the primary feasibility
  question before building large crawler surfaces.

### D. Booru family
**Decision:** separate repo, one extension with many saved servers/accounts.

Why:
- Shared booru concepts make one configurable app better than one repo per host.
- User explicitly wants the screenshot-style “many saved servers/accounts” model.
- Site differences are mostly API/auth/config differences, not entirely different UX.

Main design rule:
- Build a server/account manager first-class into the product.
- Store multiple endpoints and per-server credentials/settings.

## 3) Repo split map

### Repo 1 — current repo (`rule34video`)
Scope:
- `rule34video.com`
- `rule34.world`
- `rule34.xyz`

Shared behaviors:
- side-panel queue
- post listing/crawling
- download pipeline
- folder naming
- image/video handling for the world/xyz branch

### Repo 2 — booru-family extension
Scope:
- e621 / Danbooru / Gelbooru / compatible boorus

Core product requirement:
- one extension
- multiple saved servers/accounts
- per-server auth + API settings

### Repo 3 — Pawchive extension
Scope:
- Pawchive only

Core product requirement:
- hybrid auth
- gated-content support through either browser session or stored account

### Repo 4 — Newgrounds extension
Scope:
- Newgrounds only

Core product requirement:
- prove browser-context viability against NG Guard before full-scale crawler work

## 4) Auth policy to carry into future repos

### Browser-session reuse
Use when:
- the site is already logged in in the user’s browser
- session cookies are enough
- the user does not want to re-enter credentials into the extension

### Extension-stored account form
Use when:
- the site allows a stable login flow the extension can own
- the user wants separate saved accounts / easier switching
- background/API operations need credentials independent of a visible tab session

### Required by repo
- `rule34video` current repo: no new broad auth work planned right now
- Pawchive repo: **must support both modes**
- booru repo: likely per-server account support, plus anonymous/public mode where possible
- Newgrounds repo: auth is secondary; anti-bot/browser access is primary

## 5) Candidate file interpretation

The current GitHub `new domain candidate` file resolves to exactly two practical
separate-repo candidates:
1. Pawchive
2. Newgrounds

This does **not** change the status of `rule34.xyz`.
`rule34.xyz` still belongs in the current repo because it is part of the same
site family as `rule34.world`.

## 6) Starter prompts for new repos

Use these only for **new repos**. Do **not** ask “should I continue in the current
repo?” when the conversation is already inside that repo.

### A. Booru repo starter
> Audit this repo as the starting point for a booru-family downloader extension.
> The product goal is one extension with multiple saved servers/accounts, not one
> repo per booru. First determine what core pieces are reusable, what must become
> per-server config, how auth should work for e621/Danbooru/Gelbooru-style APIs,
> and what architecture changes are required before implementation. Preserve old
> code/docs unless clearly dead, but do not delete them during planning.

### B. Pawchive repo starter
> Audit this repo as the starting point for a Pawchive downloader extension.
> Plan for two auth modes: browser-session reuse and an in-extension stored login
> form. First verify which current systems are reusable, which parts need a new
> site adapter, how gated content should be accessed, and what minimum crawler /
> downloader architecture is needed before implementation. Preserve old code/docs;
> do not delete during planning.

### C. Newgrounds repo starter
> Audit this repo as the starting point for a Newgrounds downloader extension.
> First test real feasibility against browser-side guard/challenge behavior,
> identify what can only work through content scripts or active browser sessions,
> and decide whether a stable MVP is realistic before implementing anything broad.
> Preserve old code/docs; do not delete during planning.

## 7) Immediate current-repo worklist

1. Add/finish `rule34.xyz` support in the current repo.
2. Keep `rule34.world` and `rule34.xyz` as one route family with host-specific
   origin/CDN handling.
3. Extend tests so both hosts are covered.
4. After that, return to documenting or spinning up the next repo only when needed.
