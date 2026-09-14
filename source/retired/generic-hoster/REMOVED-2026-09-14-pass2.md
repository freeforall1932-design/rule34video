# Removed 2026-09-14 · pass 2 — the observed-media hoster predicates

Verbatim copies of the code retired on 2026-09-14 in the **second** sweep, from
`extension/background-enhanced.js` as it stood at 3387 lines (pre-removal line
numbers shown per block). Reference only — never packaged, never imported.

**Why they were provably dead:** `rememberObservedRequest` is the sole writer into
`observedMediaByOrigin` / `observedMediaByTab`, and Chrome only invokes a
`webRequest` listener for URLs matching its `urls` filter. That filter admits only
`rule34.world`, `*.rule34.world`, `www.rule34.world`, `rule34video.com`,
`*.rule34video.com` and `rule34storage.b-cdn.net` — so a predicate anchored to any
other hostname can never be true. The premise itself is now enforced by
`source/tests/hoster-reachability.test.mjs`.

## Ad networks: deleted outright, NOT preserved

`adtng.com` · `itsup.com` · `mmcdn.com` · `psmcdn.net` · `love.mydaddy.cc` ·
`playhubconnect.com` · `phncdn.com` image derivatives — these were ad/CDN blocks in
the observed-media path, never media sources this tool should download *from*.
Keeping them would only invite a future reader to "support" an ad network, so they
are gone with no copy here (recoverable from git if ever needed).


## Host-anchored media predicates (reusable for a specific site)

Each returns `true`/`false` for one foreign host. Provably dead because the only feeder is `rememberObservedRequest`, behind a webRequest `urls` filter that admits just the supported hosts.

### looksKnownHosterDocumentMediaUrl — was `:1546-1555`

```js
function looksKnownHosterDocumentMediaUrl(url) {
  try {
    const parsed = new URL(url || "");
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname;
    if (/(^|\.)streamtape\.(?:com|to|xyz)$/i.test(host) && /^\/(?:e|v|d)\//i.test(path)) return true;
    if (/(^|\.)dood\.(?:watch|stream|so|la)$/i.test(host) && /^\/(?:e|d)\//i.test(path)) return true;
  } catch {}
  return false;
}
```

### looksImageDerivativeMediaUrl — was `:1557-1565`

```js
function looksImageDerivativeMediaUrl(url) {
  try {
    const parsed = new URL(url || "");
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname;
    if (/(^|\.)(?:pix-cdn77|pix-fl)\.phncdn\.com$/i.test(host) && /\/plain\/.*\/rs:fit:/i.test(path)) return true;
  } catch {}
  return false;
}
```

### looksObservedAdMedia — only the host branch was dropped — was `:1567-1572`

```js
function looksObservedAdMedia(url) {
  try {
    const parsed = new URL(url || "");
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname;
    if (/(^|\.)(adtng\.com|mmcdn\.com|playhubconnect\.com|love\.mydaddy\.cc|cdn\.itsup\.com|psmcdn\.net)$/i.test(host)) return true;
```

## Cloudflare-Stream / videodelivery cluster

Self-contained: the token map was written only by `rememberCloudflareStreamRequest` and read only by `cloudflareStreamManifestFormats`, so the whole cluster fed nothing but itself.

### observedCloudflareStreamTokens (const) — was `:25`

```js
const observedCloudflareStreamTokens = new Map();
```

### decodeJwtPayload — was `:1586-1596`

```js
function decodeJwtPayload(token) {
  try {
    const payload = String(token || "").split(".")[1] || "";
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}
```

### cloudflareStreamIframeInfo — was `:1598-1615`

```js
function cloudflareStreamIframeInfo(url) {
  try {
    const parsed = new URL(url || "");
    if (!/^(?:iframe\.cloudflarestream\.com|iframe\.videodelivery\.net)$/i.test(parsed.hostname)) return null;
    const signedToken = parsed.pathname.split("/").filter(Boolean)[0] || parsed.searchParams.get("token") || "";
    if (!signedToken) return null;
    const payload = decodeJwtPayload(signedToken) || decodeJwtPayload(parsed.searchParams.get("token") || "");
    const videoId = String(payload?.sub || "").trim();
    if (!videoId) return null;
    return {
      videoId,
      signedToken,
      iframeUrl: parsed.href,
    };
  } catch {
    return null;
  }
}
```

### rememberCloudflareStreamRequest — was `:1617-1621`

```js
function rememberCloudflareStreamRequest(details = {}) {
  const info = cloudflareStreamIframeInfo(details.url);
  if (!info?.videoId || !info?.signedToken) return;
  observedCloudflareStreamTokens.set(info.videoId, info);
}
```

### cloudflareStreamSegmentInfo — was `:1648-1672`

```js
function cloudflareStreamSegmentInfo(url) {
  try {
    const parsed = new URL(url || "");
    if (!/(^|\.)cloudflarestream\.com$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/([^/]+)\/video\/([^/]+)\/(init\.mp4|seg_(\d+)\.mp4)$/i);
    if (!match) return null;
    const streamId = match[1];
    const rendition = match[2];
    const fileName = match[3];
    const segmentIndex = typeof match[4] === "string" ? Number(match[4]) : -1;
    const height = Number(String(rendition || "").match(/\d{3,4}/)?.[0] || 0) || null;
    const manifestUrl = parsed.origin + "/" + streamId + "/manifest/video.m3u8" + parsed.search;
    return {
      manifestUrl,
      origin: parsed.origin,
      streamId,
      rendition,
      fileName,
      segmentIndex,
      height,
    };
  } catch {
    return null;
  }
}
```

### isCloudflareStreamSegmentUrl — was `:1674-1676`

```js
function isCloudflareStreamSegmentUrl(url) {
  return Boolean(cloudflareStreamSegmentInfo(url));
}
```

### cloudflareStreamManifestFormats — was `:1678-1717`

```js
function cloudflareStreamManifestFormats(formats = [], videoInfo = {}) {
  const byManifest = new Map();
  for (const format of formats || []) {
    const info = cloudflareStreamSegmentInfo(format && format.url);
    if (!info?.origin || !info?.streamId) continue;
    const key = info.origin + "/" + info.streamId;
    const current = byManifest.get(key) || {
      origin: info.origin,
      videoId: info.streamId,
      fallbackManifestUrl: info.manifestUrl,
      heights: new Set(),
      seenSegments: new Set(),
    };
    if (info.height) current.heights.add(info.height);
    current.seenSegments.add(info.fileName);
    byManifest.set(key, current);
  }
  return Array.from(byManifest.values()).map((item) => {
    const tokenInfo = observedCloudflareStreamTokens.get(item.videoId);
    const manifestUrl = tokenInfo?.signedToken
      ? item.origin + "/" + tokenInfo.signedToken + "/manifest/video.m3u8"
      : item.fallbackManifestUrl;
    const bestHeight = Math.max(0, ...Array.from(item.heights));
    return normalizeFormat({
      url: manifestUrl,
      ext: "m3u8",
      format_type: "hls",
      protocol: "m3u8_native",
      format_id: bestHeight ? `cloudflarestream-${bestHeight}p` : "cloudflarestream-hls",
      quality: bestHeight ? `${bestHeight}p` : "auto",
      height: bestHeight || null,
      source: "cloudflarestream-observed-manifest",
      forceOffscreenHls: true,
      requiresReferer: true,
      refererUrl: tokenInfo?.iframeUrl || videoInfo.playerUrl || videoInfo.embed_url || videoInfo.url || videoInfo.webpage_url || "",
      cloudflareSignedManifest: Boolean(tokenInfo?.signedToken),
      observedSegmentCount: item.seenSegments.size,
    });
  }).filter(Boolean);
}
```

## Host terms removed from functions that SURVIVED

The function stays live; only the foreign-host term inside it was dropped. If you add one of these sites, re-add the term *and* widen the webRequest filter, then `source/tests/hoster-reachability.test.mjs` will keep the two in sync.

### looksObservedPlayable — the xiaoshenke + aki-h terms — was `:1538`

```js
  if (!/\.(mp4|m4v|webm|m3u8)(?:$|[?#/])/i.test(url) && !/\/player\/xs1\.php\?data=/i.test(url || "") && !/^https?:\/\/(?:[^/]+\.)?xiaoshenke\.net\/(?:vid|s1)\//i.test(url || "") && !/^https?:\/\/[^/]+\/[^?#]*\/cf-master\.[^/?#]+\.txt(?:$|[?#])/i.test(url || "") && !/^https?:\/\/[^/]+\/sora\/[^?#]+\/[^?#]+(?:$|[?#])/i.test(url || "") && !/^https?:\/\/(?:[^/]+\.)?aki-h\.stream\/(?:file|file2|quality2)\/[^?#]+(?:$|[?#/])/i.test(url || "")) return false;
```

### observedFormat — the xtremestream height probe — was `:1630-1635`

```js
    if (/\.xtremestream\.xyz$/i.test(parsed.hostname) && /\/player\/xs1\.php$/i.test(parsed.pathname)) {
      const q = Number(parsed.searchParams.get("q") || 0) || 0;
      inferredHeight = q || 2160;
      inferredQuality = q ? String(q) + "p" : "2160p";
    }
  } catch {}
```

### observedMediaFormats — the Cloudflare manifest merge — was `:1790-1800`

```js
  const cloudflareManifests = cloudflareStreamManifestFormats(formats, videoInfo);
  if (!cloudflareManifests.length) return formats;
  const manifestUrls = new Set(cloudflareManifests.map((format) => format.url));
  const output = [...cloudflareManifests];
  for (const format of formats) {
    if (!format?.url) continue;
    if (manifestUrls.has(format.url)) continue;
    if (isCloudflareStreamSegmentUrl(format.url)) continue;
    output.push(format);
  }
  return output;
```
