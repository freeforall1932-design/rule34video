// background-enhanced.js
// Generated generic direct-video background adapter stub.
import './site-config.js';
import './logger.js';
import './background-bridge.js';
import './site-adapter.js';
import './auth.js';

try {
  if (!globalThis.__serpAuthListenerInstalled) {
    globalThis.__serpAuthListenerInstalled = true;
    globalThis.Auth?.registerAuthMessageListener?.();
  }
} catch {}

const SiteConfig = globalThis.SiteConfig || {};
const Bridge = globalThis.SerpBackgroundBridge || {};
const Adapter = globalThis.SerpSiteAdapter || {};
const logger = (globalThis.Logger && globalThis.Logger.createLogger("[Rule 34 BG]")) || { log() {}, warn() {}, error() {} };
const downloadProgress = new Map();
const observedMediaByTab = new Map();
const observedMediaByOrigin = new Map();
const observedCloudflareStreamTokens = new Map();
const observedMediaGlobalKey = "__global__";
const forceChromeHlsSegmentDownload = false;
const downloadMediaUrlRewriteRules = [];
const removeMediaUrlQueryParams = [];
const rangeRequestUrlPatterns = [];
let currentDownloadTabId = null;

function sanitizeFilename(value) {
  return Bridge.sanitizeFilename ? Bridge.sanitizeFilename(value || "video") : String(value || "video").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().slice(0, 200);
}

function folderName() {
  return sanitizeFilename(SiteConfig.OFFSCREEN?.downloadFolder || SiteConfig.SITE_NAME || "Videos") || "Videos";
}

function notify(title, message) {
  if (Bridge.showNotification) return Bridge.showNotification(title, message);
  try {
    chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title, message });
  } catch {}
}

function matchesAnyPattern(value, patterns) {
  const text = String(value || "");
  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    try {
      if (new RegExp(String(pattern), "i").test(text)) return true;
    } catch {}
  }
  return false;
}

function decodeProxyMediaUrl(url) {
  try {
    const parsed = new URL(String(url || "").replace(/&amp;/g, "&"));
    const decodeCandidates = (value) => {
      const decoded = String(decodeURIComponent(value || "") || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
      const candidates = [decoded];
      try {
        candidates.push(String(atob(decoded) || "").replace(/\\\//g, "/").replace(/&amp;/g, "&"));
      } catch {}
      return candidates;
    };
    for (const key of ["floc", "r", "url", "file", "src"]) {
      const encoded = parsed.searchParams.get(key);
      if (!encoded) continue;
      for (const decoded of decodeCandidates(encoded)) {
        if (!decoded || !/\.(mp4|m4v|webm|m3u8)(?:$|[?#/])/i.test(decoded)) continue;
        return new URL(decoded, parsed.href).href;
      }
    }
  } catch {}
  return "";
}

function rewriteDownloadUrl(url) {
  let value = decodeProxyMediaUrl(url) || String(url || "").replace(/&amp;/g, "&");
  for (const rule of Array.isArray(downloadMediaUrlRewriteRules) ? downloadMediaUrlRewriteRules : []) {
    const pattern = rule && (rule.from || rule.pattern || rule.match);
    const replacement = rule && (rule.to || rule.replacement || rule.replace);
    if (!pattern || typeof replacement !== "string") continue;
    try {
      const flags = String(rule.flags || "i").replace(/[^dgimsuvy]/g, "") || "i";
      value = value.replace(new RegExp(String(pattern), flags), replacement);
    } catch {}
  }
  if (Array.isArray(removeMediaUrlQueryParams) && removeMediaUrlQueryParams.length) {
    try {
      const parsed = new URL(value);
      for (const name of removeMediaUrlQueryParams) {
        if (!name) continue;
        parsed.searchParams.delete(String(name));
      }
      value = parsed.href;
    } catch {}
  }
  return value;
}

function normalizeFormat(format) {
  if (!format) return null;
  const url = rewriteDownloadUrl(format.url || format.videoUrl || format.video_url);
  if (!url) return null;
  const isHls = /\.m3u8(?:$|[?#])/i.test(url) || /^https?:\/\/(?:[^/]+\.)?aki-h\.stream\/(?:file|file2|quality2)\/[^?#]+(?:$|[?#/])/i.test(url) || format.ext === "m3u8" || format.format_type === "hls";
  const requiresRangeRequest = Boolean(format.requiresRangeRequest || format.rangeRequest || (!isHls && matchesAnyPattern(url, rangeRequestUrlPatterns)));
  return {
    ...format,
    url,
    ext: isHls ? "m3u8" : (format.ext || "mp4"),
    format_type: isHls ? "hls" : (format.format_type || "mp4"),
    protocol: isHls ? "m3u8_native" : (format.protocol || "https"),
    ...(requiresRangeRequest ? { requiresRangeRequest: true, rangeRequest: true } : {}),
    ...(isHls && forceChromeHlsSegmentDownload && !format.forceOffscreenHls ? {
      forceChromeHlsSegmentDownload: true,
      useDownloadHeaderRules: true,
      requiresReferer: true,
    } : {}),
  };
}

function looksObservedPlayable(url) {
  if (!/^https?:\/\//i.test(url || "")) return false;
  if (!/\.(mp4|m4v|webm|m3u8)(?:$|[?#/])/i.test(url) && !/\/player\/xs1\.php\?data=/i.test(url || "") && !/^https?:\/\/(?:[^/]+\.)?xiaoshenke\.net\/(?:vid|s1)\//i.test(url || "") && !/^https?:\/\/[^/]+\/[^?#]*\/cf-master\.[^/?#]+\.txt(?:$|[?#])/i.test(url || "") && !/^https?:\/\/[^/]+\/sora\/[^?#]+\/[^?#]+(?:$|[?#])/i.test(url || "") && !/^https?:\/\/(?:[^/]+\.)?aki-h\.stream\/(?:file|file2|quality2)\/[^?#]+(?:$|[?#/])/i.test(url || "")) return false;
  if (/sprite|thumbnail|thumb|preview|mediabook|timelines\.php|\.vtt(?:$|[?#])/i.test(url)) return false;
  if (looksKnownHosterDocumentMediaUrl(url)) return false;
  if (looksImageDerivativeMediaUrl(url)) return false;
  if (looksObservedAdMedia(url)) return false;
  return true;
}

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

function looksImageDerivativeMediaUrl(url) {
  try {
    const parsed = new URL(url || "");
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname;
    if (/(^|\.)(?:pix-cdn77|pix-fl)\.phncdn\.com$/i.test(host) && /\/plain\/.*\/rs:fit:/i.test(path)) return true;
  } catch {}
  return false;
}

function looksObservedAdMedia(url) {
  try {
    const parsed = new URL(url || "");
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname;
    if (/(^|\.)(adtng\.com|mmcdn\.com|playhubconnect\.com|love\.mydaddy\.cc|cdn\.itsup\.com|psmcdn\.net)$/i.test(host)) return true;
    if (/\/(?:ads?|creatives?|roomad|pubs|banner|vast|tour\/pics)\//i.test(path)) return true;
  } catch {}
  return /(?:^|[/.])(ads?|advert|banner|vast|roomad|creatives?)(?:[/.?_-]|$)/i.test(String(url || ""));
}

function originOf(value) {
  try {
    return new URL(value || "").origin;
  } catch {
    return "";
  }
}

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

function rememberCloudflareStreamRequest(details = {}) {
  const info = cloudflareStreamIframeInfo(details.url);
  if (!info?.videoId || !info?.signedToken) return;
  observedCloudflareStreamTokens.set(info.videoId, info);
}

function observedFormat(url, source = "webrequest") {
  const lowerUrl = String(url || "").toLowerCase();
  const isHls = lowerUrl.includes(".m3u8") || lowerUrl.includes("/player/xs1.php?data=") || lowerUrl.includes("/cf-master.") || /^https?:\/\/(?:[^/]+\.)?aki-h\.stream\/(?:file|file2|quality2)\/[^?#]+(?:$|[?#/])/i.test(String(url || ""));
  let inferredHeight = null;
  let inferredQuality = source;
  try {
    const parsed = new URL(String(url || ""));
    if (/\.xtremestream\.xyz$/i.test(parsed.hostname) && /\/player\/xs1\.php$/i.test(parsed.pathname)) {
      const q = Number(parsed.searchParams.get("q") || 0) || 0;
      inferredHeight = q || 2160;
      inferredQuality = q ? String(q) + "p" : "2160p";
    }
  } catch {}
  return normalizeFormat({
    url,
    ext: isHls ? "m3u8" : "mp4",
    format_type: isHls ? "hls" : "mp4",
    protocol: isHls ? "m3u8_native" : "https",
    format_id: source,
    quality: inferredQuality,
    height: inferredHeight,
    source,
  });
}

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

function isCloudflareStreamSegmentUrl(url) {
  return Boolean(cloudflareStreamSegmentInfo(url));
}

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

function xiaoshenkePlayerFormats(videoInfo = {}) {
  const playerUrl = videoInfo.playerUrl || videoInfo.embed_url || videoInfo.video_url || videoInfo.url || "";
  try {
    const parsed = new URL(playerUrl);
    if (!/(^|\.)xiaoshenke\.net$/i.test(parsed.hostname)) return [];
    const parts = parsed.pathname.split("/").filter(Boolean);
    const videoIndex = parts.indexOf("video");
    const encodedId = videoIndex >= 0 ? parts[videoIndex + 1] : "";
    const qualityMask = parseInt(parts[videoIndex + 2] || "", 10) || 0;
    if (!encodedId || !qualityMask) return [];
    const id = encodedId.split("").reverse().join("");
    const qualities = [];
    if (qualityMask & 1) qualities.push(360);
    if (qualityMask & 2) qualities.push(480);
    if (qualityMask & 4) qualities.push(720);
    if (qualityMask & 8) qualities.push(1080);
    return qualities.map((quality) => normalizeFormat({
      format_id: `${quality}p`,
      height: quality,
      ext: "mp4",
      format_type: "mp4",
      protocol: "https",
      quality: `${quality}p`,
      source: "xiaoshenke-player-url",
      url: `${parsed.origin}/vid/${id}/${quality}`,
      refererUrl: playerUrl,
      requiresReferer: true,
    })).filter(Boolean);
  } catch {
    return [];
  }
}

function rememberObservedMedia(map, key, url, source) {
  if (!key || !looksObservedPlayable(url)) return;
  const list = map.get(key) || [];
  if (!list.some((item) => item.url === url)) {
    list.unshift(observedFormat(url, source));
    map.set(key, list.slice(0, 30));
  }
}

function rememberObservedRequest(details = {}) {
  const url = details.url || "";
  rememberCloudflareStreamRequest(details);
  if (!looksObservedPlayable(url)) return;
  const source = "webrequest";
  rememberObservedMedia(observedMediaByOrigin, observedMediaGlobalKey, url, source);
  if (details.tabId >= 0) {
    rememberObservedMedia(observedMediaByTab, String(details.tabId), url, source);
    try {
      chrome.tabs.get(details.tabId).then((tab) => {
        rememberObservedMedia(observedMediaByOrigin, originOf(tab && tab.url), url, source);
      }).catch(() => {});
    } catch {}
  }
  rememberObservedMedia(observedMediaByOrigin, originOf(details.initiator), url, source);
  rememberObservedMedia(observedMediaByOrigin, originOf(details.documentUrl), url, source);
}

function observedMediaFormats(videoInfo = {}) {
  const formats = [];
  const add = (items) => {
    for (const item of items || []) {
      if (item && item.url && !formats.some((format) => format.url === item.url)) formats.push(item);
    }
  };
  if (currentDownloadTabId) add(observedMediaByTab.get(String(currentDownloadTabId)));
  add(observedMediaByOrigin.get(originOf(videoInfo.url || videoInfo.webpage_url)));
  add(observedMediaByOrigin.get(originOf(videoInfo.playerUrl || videoInfo.embed_url)));
  add(observedMediaByOrigin.get(observedMediaGlobalKey));
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
}

function sameUrl(left, right) {
  try {
    return new URL(String(left || "")).href === new URL(String(right || "")).href;
  } catch {
    return String(left || "") === String(right || "");
  }
}

function isSourcePageFormat(format, videoInfo = {}) {
  const url = String(format && format.url || "");
  if (!url) return false;
  return [videoInfo.url, videoInfo.webpage_url, videoInfo.sourcePageUrl]
    .filter(Boolean)
    .some((pageUrl) => sameUrl(url, pageUrl));
}

try {
  if (chrome.webRequest && !globalThis.__serpObservedMediaListenerInstalled) {
    globalThis.__serpObservedMediaListenerInstalled = true;
    chrome.webRequest.onBeforeRequest.addListener(
      rememberObservedRequest,
      { urls: ["<all_urls>"] },
    );
  }
} catch {}

async function defaultGetVideoFormats(videoInfo = {}) {
  const formats = [];
  if (videoInfo.selectedFormat && !isSourcePageFormat(videoInfo.selectedFormat, videoInfo)) formats.push(normalizeFormat(videoInfo.selectedFormat));
  if (Array.isArray(videoInfo.formats)) {
    for (const format of videoInfo.formats) {
      if (!isSourcePageFormat(format, videoInfo)) formats.push(normalizeFormat(format));
    }
  }
  for (const format of observedMediaFormats(videoInfo)) formats.push(normalizeFormat(format));
  if (videoInfo.video_url || /\.(mp4|m4v|webm|m3u8)(?:$|[?#])/i.test(videoInfo.url || "")) {
    formats.push(normalizeFormat({ url: videoInfo.video_url || videoInfo.url, format_id: "direct" }));
  }
  const deduped = [];
  for (const format of formats.filter(Boolean)) {
    if (!deduped.some((item) => item.url === format.url)) deduped.push(format);
  }
  deduped.sort((a, b) => (a.format_type === "mp4" ? -1 : 1) - (b.format_type === "mp4" ? -1 : 1));
  return { formats: deduped };
}

async function getVideoFormats(videoInfo = {}, request = {}) {
  if (request && request.tabId) currentDownloadTabId = request.tabId;
  const xiaoshenkeFormats = xiaoshenkePlayerFormats(videoInfo);
  if (xiaoshenkeFormats.length) return { formats: xiaoshenkeFormats };
  if (typeof Adapter.getVideoFormats === "function") {
    try {
      const result = await Adapter.getVideoFormats({
        videoInfo,
        request,
        tabId: request?.tabId || videoInfo?.tabId || currentDownloadTabId || null,
        SiteConfig,
        logger,
        normalizeFormat,
        defaultGetVideoFormats,
      });
      if (Array.isArray(result)) return { formats: result };
      if (result && typeof result === "object") return result;
    } catch (error) {
      logger.warn("Site adapter getVideoFormats hook failed", error);
    }
  }
  return defaultGetVideoFormats(videoInfo);
}

async function ensureDownloadAccess() {
  if (globalThis.Auth?.ensureDownloadAccess) return globalThis.Auth.ensureDownloadAccess();
  if (globalThis.Auth?.checkActivationStatus) {
    const status = await globalThis.Auth.checkActivationStatus();
    if (!status?.isActivated) throw new Error("Please sign in to continue.");
  }
}

function getDownloadReferer(videoInfo = {}, fallbackUrl = "") {
  return (
    videoInfo.url ||
    videoInfo.webpage_url ||
    videoInfo.playerUrl ||
    videoInfo.embed_url ||
    fallbackUrl ||
    undefined
  );
}

function getFormatReferer(selectedFormat = {}, videoInfo = {}, fallbackUrl = "") {
  const selectedReferer = (
    selectedFormat.refererUrl ||
    selectedFormat.referrer ||
    selectedFormat.referer ||
    selectedFormat.sourcePageUrl ||
    ""
  );
  if (selectedReferer) return selectedReferer;
  try {
    const selectedUrl = new URL(selectedFormat.url || "");
    const playerUrl = videoInfo.playerUrl || videoInfo.embed_url || "";
    const playerHost = playerUrl ? new URL(playerUrl).hostname : "";
    if (/(^|\.)xiaoshenke\.net$/i.test(selectedUrl.hostname) && /(^|\.)xiaoshenke\.net$/i.test(playerHost)) {
      return playerUrl;
    }
    if (/(^|\.)xtremestream\.xyz$/i.test(selectedUrl.hostname) && /(^|\.)xtremestream\.xyz$/i.test(playerHost)) {
      return playerUrl;
    }
  } catch {}
  return getDownloadReferer(videoInfo, fallbackUrl);
}

function buildMediaFetchHeaders(refererUrl = "") {
  const headers = {
    Accept: "application/vnd.apple.mpegurl, application/x-mpegurl, */*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (refererUrl) {
    headers.Referer = refererUrl;
    try {
      headers.Origin = new URL(refererUrl).origin;
    } catch {}
  }
  return headers;
}

function shouldForceChromeDownload(selectedFormat = {}) {
  if (!selectedFormat?.url || selectedFormat.format_type === "hls") return false;
  if (selectedFormat.forceChromeDownload) return true;
  try {
    const host = new URL(selectedFormat.url).hostname;
    return /(^|[.])erome[.]com$/i.test(host);
  } catch {
    return false;
  }
}

function shouldUseTabInitiatedDownload(selectedFormat = {}) {
  if (selectedFormat.forceTabDownload || selectedFormat.tabInitiatedDownload) return true;
  try {
    const host = new URL(selectedFormat.url || "").hostname;
    return /(^|[.])erome[.]com$/i.test(host);
  } catch {
    return false;
  }
}

function shouldUseDownloadHeaderRules(selectedFormat = {}) {
  return Boolean(selectedFormat.useDownloadHeaderRules) || shouldUseTabInitiatedDownload(selectedFormat);
}

function shouldRemoveDownloadCookieHeader(selectedFormat = {}) {
  return Boolean(
    selectedFormat.removeCookieHeaderForDownload ||
    selectedFormat.omitCookieHeader ||
    selectedFormat.omitCookiesForDownload ||
    selectedFormat.downloadWithoutCookies
  );
}

function dnrRegexFilterForDownload(selectedFormat = {}) {
  const rawUrl = String(selectedFormat.url || "");
  if (!rawUrl) return "";
  if (!selectedFormat.useDownloadHeaderRules) return "^https?://[^/]*erome[.]com/.*";
  try {
    const parsed = new URL(rawUrl);
    const escape = (value) => {
      let output = "";
      for (const char of String(value || "")) {
        output += "\\^$.|?*+()[]{}".includes(char) ? ("\\" + char) : char;
      }
      return output;
    };
    return "^" + escape(parsed.protocol).replace(/^https?:/i, "https?:") + "//" + escape(parsed.host) + escape(parsed.pathname) + ".*";
  } catch {
    return "";
  }
}

async function withTemporaryHeaderRules(selectedFormat = {}, videoInfo = {}, task = async () => null) {
  if (!shouldUseDownloadHeaderRules(selectedFormat) || !chrome.declarativeNetRequest?.updateSessionRules) return await task();
  const referer = getFormatReferer(selectedFormat, videoInfo, selectedFormat.url);
  if (!referer) return await task();
  const regexFilter = dnrRegexFilterForDownload(selectedFormat);
  let requestHost = "";
  try { requestHost = new URL(selectedFormat.url || "").hostname; } catch {}
  const extraRequestDomains = Array.isArray(selectedFormat.downloadHeaderRuleExtraDomains)
    ? selectedFormat.downloadHeaderRuleExtraDomains.map((domain) => String(domain || "").trim()).filter(Boolean)
    : [];
  const requestDomains = Array.from(new Set([requestHost, ...extraRequestDomains].filter(Boolean)));
  if (!regexFilter && !requestDomains.length) return await task();
  let origin = "";
  try { origin = new URL(referer).origin; } catch {}
  const ruleId = 930000 + Math.floor(Date.now() % 100000);
  const downloadName = sanitizeFilename(String(selectedFormat.filename || videoInfo.title || videoInfo.id || "video").split("/").pop()) || "video";
  const attachmentName = /[.]mp4$/i.test(downloadName) ? downloadName : (downloadName + ".mp4");
  const resourceTypes = ["main_frame", "sub_frame", "xmlhttprequest", "media", "object", "other"];
  console.log("[download] header-rule-prepare", {
    host: requestHost,
    hasRegex: Boolean(regexFilter),
    removeCookie: shouldRemoveDownloadCookieHeader(selectedFormat),
    extraDomains: extraRequestDomains.length,
  });
  const buildRule = (condition) => ({
    id: ruleId,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "referer", operation: "set", value: referer },
        ...(origin ? [{ header: "origin", operation: "set", value: origin }] : []),
        ...(shouldRemoveDownloadCookieHeader(selectedFormat) ? [{ header: "cookie", operation: "remove" }] : []),
      ],
      responseHeaders: [
        ...(selectedFormat.responseContentType ? [{ header: "content-type", operation: "set", value: selectedFormat.responseContentType }] : []),
        { header: "content-disposition", operation: "set", value: 'attachment; filename="' + attachmentName.replace(/"/g, "") + '"' },
      ],
    },
    condition: {
      ...condition,
      resourceTypes,
    },
  });
  const tryInstall = async (condition) => {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId], addRules: [buildRule(condition)] });
    return true;
  };
  let installed = false;
  if (regexFilter && !extraRequestDomains.length) {
    try {
      installed = await tryInstall({ regexFilter });
    } catch (error) {
      console.warn("[download] header-rule-regex-failed", error?.message || error);
    }
  }
  if (!installed && requestHost && !extraRequestDomains.length) {
    try {
      installed = await tryInstall({ urlFilter: "||" + requestHost + "/" });
    } catch (error) {
      console.warn("[download] header-rule-url-filter-failed", error?.message || error);
    }
  }
  if (!installed && requestDomains.length) {
    try {
      await tryInstall({ requestDomains });
      installed = true;
    } catch (error) {
      console.warn("[download] header-rule-domain-failed", error?.message || error);
    }
  }
  try {
    return await task();
  } finally {
    if (installed) setTimeout(() => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {}), 15000);
  }
}

function shouldUseOffscreenMp4(selectedFormat = {}, videoInfo = {}) {
  if (!selectedFormat?.url || selectedFormat.format_type === "hls") return false;
  if (selectedFormat.forceOffscreenDownload) return true;
  if (SiteConfig.BACKGROUND?.forceOffscreenMp4) return true;
  if (selectedFormat.forceTabDownload || selectedFormat.tabInitiatedDownload) return false;
  if (shouldForceChromeDownload(selectedFormat)) return false;
  try {
    const selectedUrl = new URL(selectedFormat.url);
    if (/(^|[.])erome[.]com$/i.test(selectedUrl.hostname)) return false;
  } catch {}
  if (selectedFormat.requiresReferer) return true;
  try {
    const selectedUrl = new URL(selectedFormat.url);
    const referer = getFormatReferer(selectedFormat, videoInfo, selectedFormat.url);
    if (/(^|[.])xiaoshenke[.]net$/i.test(selectedUrl.hostname)) return Boolean(referer);
    if (!referer) return false;
    const refererUrl = new URL(referer);
    return selectedUrl.origin !== refererUrl.origin;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isXiaoshenkeFormat(format = {}) {
  try {
    return /(^|[.])xiaoshenke[.]net$/i.test(new URL(format.url || "").hostname);
  } catch {
    return false;
  }
}

async function resolveXiaoshenkeSignedUrl(selectedFormat, videoInfo = {}) {
  const playerUrl = getFormatReferer(selectedFormat, videoInfo, selectedFormat.url);
  if (!playerUrl) throw new Error("No player referer available for Xiaoshenke resolver.");
  const tab = await chrome.tabs.create({ url: playerUrl, active: false });
  try {
    await new Promise((resolve) => {
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tab.id || changeInfo.status !== "complete") return;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        try { chrome.tabs.onUpdated.removeListener(listener); } catch {}
        resolve();
      }, 5000);
    });
    const signedUrl = await new Promise((resolve) => {
      const done = (value) => {
        try { chrome.webRequest.onBeforeRequest.removeListener(requestListener); } catch {}
        try { chrome.tabs.onUpdated.removeListener(tabListener); } catch {}
        resolve(value || "");
      };
      const isSignedMediaUrl = (url) => {
        try {
          const parsed = new URL(url || "");
          const host = parsed.hostname.toLowerCase();
          const path = parsed.pathname || "";
          return (host === "xiaoshenke.net" || host.endsWith(".xiaoshenke.net")) &&
            path.startsWith("/s1/") &&
            !path.split("/").includes("i");
        } catch {
          return false;
        }
      };
      const requestListener = (details) => {
        if (details.tabId !== tab.id) return;
        if (isSignedMediaUrl(details.url)) done(details.url);
      };
      const tabListener = (updatedTabId, changeInfo, updatedTab) => {
        if (updatedTabId !== tab.id) return;
        const nextUrl = changeInfo.url || updatedTab?.url || "";
        if (isSignedMediaUrl(nextUrl)) done(nextUrl);
      };
      chrome.webRequest.onBeforeRequest.addListener(requestListener, { urls: ["*://*.xiaoshenke.net/s1/*"] });
      chrome.tabs.onUpdated.addListener(tabListener);
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [selectedFormat.url],
        func: async (mediaUrl) => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          let video = document.querySelector("video");
          for (let index = 0; !video && index < 20; index += 1) {
            await sleep(250);
            video = document.querySelector("video");
          }
          if (!video) {
            video = document.createElement("video");
            video.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;";
            document.body.appendChild(video);
          }
          const sources = Array.from(video.querySelectorAll("source"));
          const absoluteMediaUrl = new URL(mediaUrl, location.href).href;
          let source = sources.find((item) => item.src === absoluteMediaUrl) || sources.find((item) => String(item.src || "").includes("/vid/"));
          if (!source) {
            source = document.createElement("source");
            source.src = absoluteMediaUrl;
            source.type = "video/mp4";
            video.appendChild(source);
          }
          if (source?.src) video.src = source.src;
          video.preload = "auto";
          video.muted = true;
          try { video.load(); } catch {}
          try { await video.play(); } catch {}
          return true;
        },
      }).catch(() => {});
      const poll = async () => {
        for (let index = 0; index < 30; index += 1) {
          try {
            const current = await chrome.tabs.get(tab.id);
            if (isSignedMediaUrl(current?.url)) return done(current.url);
          } catch {}
          await sleep(500);
        }
        done("");
      };
      poll();
    });
    if (!signedUrl) throw new Error("Could not resolve signed Xiaoshenke media URL.");
    return { signedUrl, playerUrl };
  } finally {
    setTimeout(() => { try { chrome.tabs.remove(tab.id); } catch {} }, 1000);
  }
}

function startPlayerTabDownload(selectedFormat, filename, videoInfo = {}) {
  const downloadId = "mp4-" + Date.now();
  downloadProgress.set(downloadId, { videoInfo, format: selectedFormat, startTime: Date.now(), status: "Resolving video URL...", progress: 1, downloadedBytes: 0, totalBytes: 0, fileName: filename, filename });
  Bridge.notifyDownloadProgressToContent?.({ tabId: currentDownloadTabId, downloadId, filename, selectedFormat, strategy: "xiaoshenke-resolver", status: "Resolving video URL...", progress: 1, downloadProgress, logger });
  void (async () => {
    try {
      const { signedUrl, playerUrl } = await resolveXiaoshenkeSignedUrl(selectedFormat, videoInfo);
      console.log("[download] xiaoshenke-signed-url", { host: (() => { try { return new URL(signedUrl).hostname; } catch { return ""; } })() });
      const resolvedFormat = { ...selectedFormat, url: signedUrl, refererUrl: playerUrl, source: "xiaoshenke-signed-media", requiresReferer: true };
      downloadProgress.set(downloadId, { ...(downloadProgress.get(downloadId) || {}), videoInfo, format: resolvedFormat, status: "Starting MP4 download...", progress: 2, updatedAt: Date.now() });
      Bridge.notifyDownloadProgressToContent?.({ tabId: currentDownloadTabId, downloadId, filename, selectedFormat: resolvedFormat, strategy: "xiaoshenke-resolver", status: "Starting MP4 download...", progress: 2, downloadProgress, logger });
      await ensureOffscreenDocument();
      const dnrRuleId = await Bridge.installTemporaryRefererRule?.(signedUrl, playerUrl, logger);
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "PROCESS_MP4_DOWNLOAD", downloadId, fileName: filename, videoUrl: signedUrl, refererUrl: playerUrl, dnrRuleId }, (result) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (!result?.success) reject(new Error(result?.error || "Failed to start MP4 download"));
          else resolve(result);
        });
      });
    } catch (error) {
      console.warn("[download] xiaoshenke-async-failed", error);
      Bridge.forwardMP4Error?.({ tabId: currentDownloadTabId, message: { downloadId, fileName: filename, error: error?.message || String(error) }, downloadProgress, logger });
    }
  })();
  return downloadId;
}

async function forwardHLSProgress(message) {
  return globalThis.SerpBackgroundBridge.forwardHLSProgress({
    tabId: currentDownloadTabId,
    message,
    downloadProgress,
    logger,
  });
}

async function forwardHLSComplete(message) {
  return globalThis.SerpBackgroundBridge.forwardHLSComplete({
    tabId: currentDownloadTabId,
    message,
    downloadProgress,
    logger,
  });
}

async function forwardHLSError(message) {
  return globalThis.SerpBackgroundBridge.forwardHLSError({
    tabId: currentDownloadTabId,
    message,
    downloadProgress,
    logger,
  });
}

async function ensureOffscreenDocument() {
  return globalThis.SerpBackgroundBridge.ensureOffscreenDocument({
    logger,
  });
}

function parseM3U8Attributes(attrString) {
  return globalThis.SerpBackgroundBridge.parseM3U8Attributes(attrString);
}

function extractM3U8Formats(m3u8Content, baseUrl, videoId, ext = "mp4") {
  const formats = [];
  const lines = String(m3u8Content || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let isStreamInf = false;
  let currentFormat = null;
  let pendingSegmentDuration = null;
  let targetDuration = null;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      isStreamInf = true;
      currentFormat = {
        format_id: "hls",
        ext: "m3u8",
        format_type: "hls",
        protocol: "m3u8_native",
        quality: null,
        height: null,
        tbr: null,
        isSegmented: false,
      };
      const attrs = parseM3U8Attributes(line.substring("#EXT-X-STREAM-INF:".length));
      if (attrs.RESOLUTION) {
        const [width, height] = String(attrs.RESOLUTION).split("x").map(Number);
        currentFormat.width = width;
        currentFormat.height = height;
        currentFormat.quality = height;
        currentFormat.format_id = String(height) + "p";
      }
      if (attrs.BANDWIDTH) {
        currentFormat.tbr = Math.round(parseInt(attrs.BANDWIDTH, 10) / 1000);
      }
      continue;
    }

    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      const match = line.match(/^#EXT-X-TARGETDURATION:(\d+)/);
      if (match) targetDuration = parseInt(match[1], 10);
      continue;
    }

    if (line.startsWith("#EXT-X-MAP:")) {
      const attrs = parseM3U8Attributes(line.substring("#EXT-X-MAP:".length));
      if (!attrs.URI) continue;
      if (!currentFormat) {
        currentFormat = {
          format_id: "hls-segments",
          ext,
          format_type: "hls",
          protocol: "m3u8_segments",
          quality: null,
          isSegmented: true,
          segments: [],
        };
      } else {
        currentFormat.isSegmented = true;
        if (!currentFormat.segments) currentFormat.segments = [];
      }
      let initUrl = String(attrs.URI || "");
      if (!/^https?:\/\//i.test(initUrl)) {
        const baseParts = String(baseUrl || "").split("/");
        baseParts.pop();
        initUrl = baseParts.join("/") + "/" + initUrl;
      }
      if (!currentFormat.segments.some((segment) => segment?.url === initUrl)) {
        currentFormat.segments.unshift({
          url: initUrl,
          duration: 0,
          init: true,
        });
      }
      continue;
    }

    if (line.startsWith("#EXTINF:")) {
      const match = line.match(/^#EXTINF:([\d.]+)/);
      if (match) pendingSegmentDuration = parseFloat(match[1]);
      if (!currentFormat) {
        currentFormat = {
          format_id: "hls-segments",
          ext,
          format_type: "hls",
          protocol: "m3u8_segments",
          quality: null,
          isSegmented: true,
          segments: [],
        };
      } else {
        currentFormat.isSegmented = true;
      }
      continue;
    }

    if (line.startsWith("#")) continue;

    if (isStreamInf && currentFormat) {
      let streamUrl = line;
      if (!/^https?:\/\//i.test(streamUrl)) {
        const baseParts = String(baseUrl || "").split("/");
        baseParts.pop();
        streamUrl = baseParts.join("/") + "/" + streamUrl;
      }
      currentFormat.url = streamUrl;
      formats.push({ ...currentFormat });
      currentFormat = null;
      isStreamInf = false;
      continue;
    }

    if (!currentFormat) {
      currentFormat = {
        format_id: "hls-segments",
        ext,
        format_type: "hls",
        protocol: "m3u8_segments",
        quality: null,
        isSegmented: true,
        segments: [],
      };
    }

    let segmentUrl = line;
    if (!/^https?:\/\//i.test(segmentUrl)) {
      const baseParts = String(baseUrl || "").split("/");
      baseParts.pop();
      segmentUrl = baseParts.join("/") + "/" + segmentUrl;
    }
    if (!currentFormat.segments) currentFormat.segments = [];
    currentFormat.segments.push({
      url: segmentUrl,
      duration:
        typeof pendingSegmentDuration === "number" && !Number.isNaN(pendingSegmentDuration)
          ? pendingSegmentDuration
          : (typeof targetDuration === "number" ? targetDuration : null),
    });
    pendingSegmentDuration = null;
  }

  if (currentFormat && Array.isArray(currentFormat.segments) && currentFormat.segments.length) {
    currentFormat.m3u8_url = baseUrl;
    currentFormat.duration =
      currentFormat.segments.reduce((sum, segment) => sum + (Number(segment?.duration) || 0), 0) || undefined;
    formats.push(currentFormat);
  }

  formats.sort((left, right) => {
    const leftQuality = parseInt(left?.quality, 10) || 0;
    const rightQuality = parseInt(right?.quality, 10) || 0;
    return rightQuality - leftQuality;
  });
  return formats;
}

async function parseM3U8(m3u8Url, videoInfo = {}, selectedFormat = {}) {
  const refererUrl = getFormatReferer(selectedFormat, videoInfo, m3u8Url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const response = await fetch(m3u8Url, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    headers: buildMediaFetchHeaders(refererUrl),
    signal: controller.signal,
    ...(refererUrl ? {
      referrer: refererUrl,
      referrerPolicy: "strict-origin-when-cross-origin",
    } : {}),
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    throw new Error("HTTP " + response.status + ": " + response.statusText);
  }
  const content = await response.text();
  return {
    success: true,
    formats: extractM3U8Formats(content, m3u8Url, videoInfo.id || "unknown", "mp4"),
    content,
  };
}

async function resolveHlsSegmentForChromeDownload(m3u8Url, videoInfo = {}, selectedFormat = {}, depth = 0) {
  if (depth > 2) throw new Error("HLS segment resolver exceeded playlist depth.");
  const refererUrl = getFormatReferer(selectedFormat, videoInfo, m3u8Url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const response = await fetch(m3u8Url, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    headers: buildMediaFetchHeaders(refererUrl),
    signal: controller.signal,
    ...(refererUrl ? {
      referrer: refererUrl,
      referrerPolicy: "strict-origin-when-cross-origin",
    } : {}),
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw new Error("HTTP " + response.status + ": " + response.statusText);
  const content = await response.text();
  const lines = String(content || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const absolute = (value) => {
    try { return new URL(value, m3u8Url).href; } catch { return value; }
  };
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue;
    const next = lines.slice(index + 1).find((item) => item && !item.startsWith("#"));
    if (!next) continue;
    const bandwidth = Number(line.match(/BANDWIDTH=(\d+)/i)?.[1] || 0);
    const resolution = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    const pixels = resolution ? ((Number(resolution[1]) || 0) * (Number(resolution[2]) || 0)) : 0;
    variants.push({ url: absolute(next), score: bandwidth || pixels || 0 });
  }
  if (variants.length) {
    variants.sort((left, right) => right.score - left.score);
    return await resolveHlsSegmentForChromeDownload(variants[0].url, videoInfo, { ...selectedFormat, url: variants[0].url }, depth + 1);
  }
  const segments = [];
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    if (/\.(?:key|vtt)(?:$|[?#])/i.test(line)) continue;
    segments.push(absolute(line));
  }
  const mediaSegments = segments.filter((url) => {
    return /\.(?:ts|m4s|mp4)(?:$|[?#])/i.test(url)
      || /^https?:\/\/[^/]+\.xspcdn\d+\.sa\.com\/cdn\/down\/[^?#]+\.html(?:$|[?#])/i.test(url);
  });
  const segmentUrl = mediaSegments[1] || mediaSegments[0] || segments[1] || segments[0];
  if (!segmentUrl) throw new Error("No HLS media segment found.");
  return segmentUrl;
}

async function downloadHLS(m3u8Url, filename, videoInfo = {}, options = {}) {
  const downloadId = options.downloadId || "hls-" + Date.now();
  const sourceFormat = normalizeFormat(options.selectedFormat) || {};
  const notifyHlsProgress = (payload = {}) => Bridge.notifyDownloadProgressToContent?.({
    tabId: currentDownloadTabId,
    downloadId,
    filename,
    strategy: "background-hls",
    isHLS: true,
    downloadProgress,
    logger,
    ...payload,
  });

  downloadProgress.set(downloadId, {
    status: "starting",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    segmentIndex: 0,
    totalSegments: 0,
    fileName: filename,
    filename,
    updatedAt: Date.now(),
  });
  notifyHlsProgress({ status: "Preparing HLS download...", progress: 0 });

  let selectedFormat = Array.isArray(sourceFormat.segments) && sourceFormat.segments.length
    ? sourceFormat
    : null;

  if (!selectedFormat) {
    let m3u8Response;
    try {
      m3u8Response = await parseM3U8(m3u8Url, videoInfo, sourceFormat);
    } catch (error) {
      downloadProgress.set(downloadId, {
        status: "error",
        progress: 0,
        error: error?.message || String(error || "Failed to fetch M3U8"),
        fileName: filename,
        filename,
        updatedAt: Date.now(),
      });
      notifyHlsProgress({
        status: "Failed",
        progress: 0,
        error: error?.message || String(error || "Failed to fetch M3U8"),
      });
      throw error;
    }
    if (!m3u8Response?.success) {
      const error = new Error("Failed to fetch M3U8: " + (m3u8Response?.error || "Unknown error"));
      downloadProgress.set(downloadId, {
        status: "error",
        progress: 0,
        error: error.message,
        fileName: filename,
        filename,
        updatedAt: Date.now(),
      });
      notifyHlsProgress({ status: "Failed", progress: 0, error: error.message });
      throw error;
    }

    selectedFormat = Array.isArray(m3u8Response.formats)
      ? m3u8Response.formats.find((format) => format.isSegmented) || m3u8Response.formats[0]
      : null;
  }

  if (!selectedFormat || !selectedFormat.segments || !selectedFormat.segments.length) {
    if (selectedFormat?.url && !selectedFormat.isSegmented) {
      try {
        const refererUrl = getFormatReferer(sourceFormat, videoInfo, selectedFormat.url || m3u8Url);
        const response = await fetch(selectedFormat.url, {
          credentials: "include",
          headers: buildMediaFetchHeaders(refererUrl),
          ...(refererUrl ? {
            referrer: refererUrl,
            referrerPolicy: "strict-origin-when-cross-origin",
          } : {}),
        });
        if (response.ok) {
          const mediaContent = await response.text();
          const mediaFormats = extractM3U8Formats(mediaContent, selectedFormat.url, videoInfo.id, "mp4");
          const mediaFormat = mediaFormats.find((format) => format.isSegmented);
          if (mediaFormat?.segments?.length) selectedFormat = mediaFormat;
        }
      } catch (error) {
        logger.warn("Failed to expand media playlist", error);
      }
    }
  }

  if (!selectedFormat?.segments?.length) {
    return Bridge.downloadMp4WithOffscreen({
      videoUrl: m3u8Url,
      filename,
      refererUrl: getFormatReferer(sourceFormat, videoInfo, m3u8Url),
      ensureOffscreenDocument,
      downloadProgress,
      logger,
    });
  }

  downloadProgress.set(downloadId, {
    status: "starting",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    segmentIndex: 0,
    totalSegments: selectedFormat.segments.length,
    fileName: filename,
    filename,
    updatedAt: Date.now(),
  });
  notifyHlsProgress({
    status: "Preparing " + selectedFormat.segments.length + " HLS segments...",
    progress: 0,
    segmentIndex: 0,
    totalSegments: selectedFormat.segments.length,
  });
  await ensureOffscreenDocument();
  const processingResult = await new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const ackTimer = setTimeout(() => {
      logger.warn("HLS offscreen start acknowledgement timed out; continuing with background progress polling.");
      finish({ success: true, timedOut: true });
    }, 3000);
    try {
      chrome.runtime.sendMessage({
        type: "PROCESS_HLS_SEGMENTS",
        downloadId,
        fileName: filename,
        segments: selectedFormat.segments,
        totalSegments: selectedFormat.segments.length,
        totalDuration: typeof selectedFormat.duration === "number" ? selectedFormat.duration : undefined,
        refererUrl: getFormatReferer(sourceFormat, videoInfo, m3u8Url),
      }, (result) => {
        clearTimeout(ackTimer);
        if (chrome.runtime.lastError) {
          finish({ success: false, error: chrome.runtime.lastError.message });
        } else {
          finish(result || { success: true });
        }
      });
    } catch (error) {
      clearTimeout(ackTimer);
      finish({ success: false, error: error?.message || String(error) });
    }
  });
  if (!processingResult?.success) {
    const error = new Error("HLS processing failed: " + (processingResult?.error || "Unknown error"));
    notifyHlsProgress({
      status: "Failed",
      progress: 0,
      totalSegments: selectedFormat.segments.length,
      error: error.message,
    });
    throw error;
  }
  return downloadId;
}

function startChromeDownload(options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, downloadId) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(downloadId);
    };
    try {
      chrome.downloads.download(options, (downloadId) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) finish(new Error(lastError.message || String(lastError)));
        else finish(null, downloadId);
      });
    } catch (error) {
      finish(error);
    }
    setTimeout(() => finish(new Error("Chrome download did not start before timeout.")), 15000);
  });
}

function watchForDownloadCreated({ url, filename, timeoutMs = 20000 }) {
  let settled = false;
  let cleanupTimer = null;
  let createdListener = null;
  let filenameListener = null;
  const leafName = String(filename || "").split("/").pop() || "";
  const isMatchingItem = (item = {}) => {
    const itemUrl = item.finalUrl || item.url || "";
    const itemName = String(item.filename || "").split(/[\/]/).pop();
    return itemUrl === url || (leafName && itemName === leafName);
  };
  const cleanup = () => {
    if (cleanupTimer) clearTimeout(cleanupTimer);
    try { if (createdListener) chrome.downloads.onCreated.removeListener(createdListener); } catch {}
    try { if (filenameListener) chrome.downloads.onDeterminingFilename.removeListener(filenameListener); } catch {}
  };
  const finish = (error, downloadId, resolve, reject) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (error) reject(error);
    else resolve(downloadId);
  };
  const promise = new Promise((resolve, reject) => {
    createdListener = (item) => { if (isMatchingItem(item)) finish(null, item.id, resolve, reject); };
    filenameListener = (item, suggest) => {
      if (!isMatchingItem(item)) return;
      try { suggest({ filename, conflictAction: "uniquify" }); } catch {}
      finish(null, item.id, resolve, reject);
    };
    try {
      chrome.downloads.onCreated.addListener(createdListener);
      chrome.downloads.onDeterminingFilename.addListener(filenameListener);
      cleanupTimer = setTimeout(() => finish(new Error("Tab download did not start before timeout."), null, resolve, reject), timeoutMs);
    } catch (error) {
      finish(error, null, resolve, reject);
    }
  });
  return { promise, cancel() { if (settled) return; settled = true; cleanup(); } };
}

async function startTabInitiatedDownload({ tabId, url, filename }) {
  if (!tabId || !chrome.scripting?.executeScript) throw new Error("No active page tab available for tab-initiated download.");
  const downloadWatch = watchForDownloadCreated({ url, filename });
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (downloadUrl, suggestedFilename) => {
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = String(suggestedFilename || "video.mp4").split("/").pop() || "video.mp4";
        anchor.rel = "noopener";
        anchor.style.display = "none";
        (document.documentElement || document.body).appendChild(anchor);
        anchor.click();
        setTimeout(() => { try { anchor.remove(); } catch {} }, 1000);
      },
      args: [url, filename],
    });
  } catch (error) {
    downloadWatch.cancel();
    throw error;
  }
  return await downloadWatch.promise;
}

async function downloadVideo(videoInfo = {}) {
  console.log("[download] background-start", {
    hasSelectedFormat: Boolean(videoInfo.selectedFormat),
    formatCount: Array.isArray(videoInfo.formats) ? videoInfo.formats.length : 0,
  });
  await ensureDownloadAccess();
  console.log("[download] auth-ok");
  let selectedFormat = normalizeFormat(videoInfo.selectedFormat);
  if (isSourcePageFormat(selectedFormat, videoInfo)) selectedFormat = null;
  let formatResponse = {
    formats: selectedFormat
      ? [selectedFormat].concat(
          Array.isArray(videoInfo.formats)
            ? videoInfo.formats.map((format) => normalizeFormat(format)).filter(Boolean)
            : [],
        )
      : [],
  };
  try {
    const refreshedResponse = await getVideoFormats({ ...videoInfo, selectedFormat });
    const mergedFormats = [];
    for (const format of [
      ...(Array.isArray(formatResponse.formats) ? formatResponse.formats : []),
      ...(Array.isArray(refreshedResponse?.formats) ? refreshedResponse.formats : []),
    ]) {
      const normalized = normalizeFormat(format);
      if (isSourcePageFormat(normalized, videoInfo)) continue;
      if (normalized?.url && !mergedFormats.some((item) => item.url === normalized.url)) mergedFormats.push(normalized);
    }
    if (mergedFormats.length) formatResponse = { ...(refreshedResponse || {}), formats: mergedFormats };
  } catch (error) {
    logger.warn("Download format refresh failed", error);
  }
  if (!selectedFormat) selectedFormat = normalizeFormat(videoInfo.selectedFormat) || formatResponse.formats[0];
  if (typeof Adapter.prepareDownload === "function") {
    try {
      const prepared = await Adapter.prepareDownload({
        videoInfo,
        selectedFormat,
        formats: formatResponse.formats,
        tabId: currentDownloadTabId,
        SiteConfig,
        logger,
        normalizeFormat,
      });
      if (prepared?.selectedFormat) selectedFormat = normalizeFormat(prepared.selectedFormat);
      if (prepared?.videoInfo) videoInfo = { ...videoInfo, ...prepared.videoInfo };
    } catch (error) {
      logger.warn("Site adapter prepareDownload hook failed", error);
    }
  }
  selectedFormat = normalizeFormat(selectedFormat) || selectedFormat;
  if (!selectedFormat?.url) throw new Error("No downloadable video URL found.");
  console.log("[download] selected-format", {
    type: selectedFormat.format_type || "",
    ext: selectedFormat.ext || "",
    host: (() => { try { return new URL(selectedFormat.url).hostname; } catch { return ""; } })(),
    forceOffscreen: Boolean(selectedFormat.forceOffscreenDownload),
    forceChrome: Boolean(selectedFormat.forceChromeDownload),
    requiresReferer: Boolean(selectedFormat.requiresReferer),
    requiresRange: Boolean(selectedFormat.requiresRangeRequest || selectedFormat.rangeRequest),
  });
  const filename = `${sanitizeFilename(videoInfo.title || videoInfo.id || "video")}.mp4`;
  const fullFilename = `${folderName()}/${filename}`;
  if (selectedFormat.format_type === "hls" && selectedFormat.forceChromeHlsSegmentDownload) {
    console.log("[download] hls-segment-chrome-start", { filename: fullFilename });
    const hlsHeaderFormat = {
      ...selectedFormat,
      useDownloadHeaderRules: true,
      refererUrl: getFormatReferer(selectedFormat, videoInfo, selectedFormat.url),
    };
    const segmentUrl = await withTemporaryHeaderRules(hlsHeaderFormat, videoInfo, async () => {
      return await resolveHlsSegmentForChromeDownload(selectedFormat.url, videoInfo, hlsHeaderFormat);
    });
    const segmentFormat = {
      ...selectedFormat,
      url: segmentUrl,
      format_type: "mp4",
      ext: /\.m4s(?:$|[?#])/i.test(segmentUrl) ? "m4s" : (/\.ts(?:$|[?#])/i.test(segmentUrl) ? "ts" : "mp4"),
      protocol: "https",
      forceChromeDownload: true,
      useDownloadHeaderRules: true,
      refererUrl: getFormatReferer(selectedFormat, videoInfo, selectedFormat.url),
    };
    if (/\/cdn\/down\/[^?#]+\.html(?:$|[?#])/i.test(segmentUrl)) {
      segmentFormat.ext = "ts";
      segmentFormat.responseContentType = "video/mp2t";
    }
    const downloadId = await withTemporaryHeaderRules(segmentFormat, videoInfo, async () => await startChromeDownload({
      url: segmentUrl,
      filename: fullFilename,
      saveAs: false,
    }));
    console.log("[download] hls-segment-chrome-id", downloadId);
    downloadProgress.set(downloadId, { videoInfo, format: segmentFormat, startTime: Date.now() });
    Bridge.notifyContentDownloadStarted?.({
      tabId: currentDownloadTabId,
      downloadId,
      filename: fullFilename,
      selectedFormat: segmentFormat,
      strategy: "chrome-hls-segment",
      downloadProgress,
      logger,
    });
    return { downloadId, format: segmentFormat, viaChromeHlsSegment: true };
  }
  if (selectedFormat.format_type === "hls" && !selectedFormat.forceChromeDownload) {
    console.log("[download] hls-start", { filename });
    const downloadId = "hls-" + Date.now();
    const hlsHeaderFormat = selectedFormat.useDownloadHeaderRules
      ? {
          ...selectedFormat,
          refererUrl: getFormatReferer(selectedFormat, videoInfo, selectedFormat.url),
        }
      : selectedFormat;
    const hlsTask = async () => await withTemporaryHeaderRules(hlsHeaderFormat, videoInfo, async () => {
      return await downloadHLS(selectedFormat.url, filename, videoInfo, { downloadId, selectedFormat: hlsHeaderFormat });
    });
    void hlsTask()
      .then((resolvedDownloadId) => console.log("[download] hls-id", resolvedDownloadId))
      .catch((error) => logger.error("HLS background job failed", error));
    return { downloadId, format: hlsHeaderFormat, isHLS: true };
  }
  if (isXiaoshenkeFormat(selectedFormat)) {
    console.log("[download] page-tab-mp4-start", { filename: fullFilename });
    const downloadId = await startPlayerTabDownload(selectedFormat, fullFilename, videoInfo);
    console.log("[download] page-tab-mp4-id", downloadId);
    downloadProgress.set(downloadId, {
      ...(downloadProgress.get(downloadId) || {}),
      videoInfo,
      format: selectedFormat,
      startTime: Date.now(),
      fileName: fullFilename,
      filename: fullFilename,
    });
    return { downloadId, format: selectedFormat, viaPageTab: true };
  }

  if (shouldUseOffscreenMp4(selectedFormat, videoInfo)) {
    console.log("[download] offscreen-start", { filename: fullFilename });
    const downloadId = await Bridge.downloadMp4WithOffscreen({
      videoUrl: selectedFormat.url,
      filename: fullFilename,
      refererUrl: getFormatReferer(selectedFormat, videoInfo, selectedFormat.url),
      rangeRequest: Boolean(selectedFormat.requiresRangeRequest || selectedFormat.rangeRequest),
      ensureOffscreenDocument,
      downloadProgress,
      logger,
    });
    console.log("[download] offscreen-id", downloadId);
    downloadProgress.set(downloadId, { videoInfo, format: selectedFormat, startTime: Date.now() });
    Bridge.notifyContentDownloadStarted?.({
      tabId: currentDownloadTabId,
      downloadId,
      filename: fullFilename,
      selectedFormat,
      strategy: "offscreen-mp4",
      downloadProgress,
      logger,
    });
    return { downloadId, format: selectedFormat, viaOffscreen: true };
  }

  const useTabDownload = shouldUseTabInitiatedDownload(selectedFormat);
  console.log(useTabDownload ? "[download] tab-start" : "[download] chrome-start", { filename: fullFilename });
  const downloadId = await withTemporaryHeaderRules(selectedFormat, videoInfo, async () => {
    if (useTabDownload) {
      return await startTabInitiatedDownload({
        tabId: currentDownloadTabId,
        url: selectedFormat.url,
        filename: fullFilename,
      });
    }
    return await startChromeDownload({
      url: selectedFormat.url,
      filename: fullFilename,
      saveAs: false,
    });
  });
  console.log("[download] chrome-id", downloadId);
  downloadProgress.set(downloadId, { videoInfo, format: selectedFormat, startTime: Date.now() });
  Bridge.notifyContentDownloadStarted?.({
    tabId: currentDownloadTabId,
    downloadId,
    filename: fullFilename,
    selectedFormat,
    strategy: "chrome",
    downloadProgress,
    logger,
  });
  if (Bridge.monitorDownloadCompletion) {
    Bridge.monitorDownloadCompletion({
      downloadId,
      filename: fullFilename,
      downloadProgress,
      notify,
    });
  }
  return { downloadId, format: selectedFormat };
}

chrome.runtime.onInstalled.addListener(() => {
  Bridge.createConfiguredContextMenu?.({ logger });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  Bridge.handleConfiguredContextMenuClick?.({
    info,
    tab,
    downloadVideo,
    setCurrentDownloadTabId(tabId) { currentDownloadTabId = tabId; },
    logger,
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request?.action || request?.type;
  switch (action) {
    case "downloadVideo":
      return Bridge.handleDownloadVideoMessage({
        request,
        sender,
        sendResponse,
        downloadVideo,
        setCurrentDownloadTabId(tabId) { currentDownloadTabId = tabId; },
      });
    case "getVideoFormats":
      return Bridge.handleGetVideoFormatsMessage({
        request,
        sendResponse,
        getVideoFormats(videoInfo) { return getVideoFormats(videoInfo, request); },
      });
    case "getDownloadProgress":
      Bridge.handleGetDownloadProgressMessage({ request, sendResponse, downloadProgress });
      return false;
    case "getActiveDownloads":
      sendResponse({ active_downloads: Object.fromEntries(downloadProgress) });
      return false;
    case "hlsProgress":
    case "HLS_PROCESSING_PROGRESS":
      return Bridge.handleForwardAck({
        request,
        sendResponse,
        forwarder: forwardHLSProgress,
      });
    case "hlsComplete":
    case "HLS_PROCESSING_COMPLETE":
      return Bridge.handleForwardAck({
        request,
        sendResponse,
        forwarder: forwardHLSComplete,
      });
    case "hlsError":
    case "HLS_PROCESSING_ERROR":
      return Bridge.handleForwardAck({
        request,
        sendResponse,
        forwarder: forwardHLSError,
      });
    case "MP4_DOWNLOAD_PROGRESS":
      return Bridge.handleForwardAck({
        request,
        sendResponse,
        forwarder: (message) => Bridge.forwardMP4Progress?.({
          tabId: currentDownloadTabId,
          message,
          downloadProgress,
          logger,
        }),
      });
    case "MP4_DOWNLOAD_COMPLETE":
      return Bridge.handleForwardAck({
        request,
        sendResponse,
        forwarder: (message) => Bridge.forwardMP4Complete?.({
          tabId: currentDownloadTabId,
          message,
          downloadProgress,
          logger,
        }),
      });
    case "MP4_DOWNLOAD_ERROR":
      return Bridge.handleForwardAck({
        request,
        sendResponse,
        forwarder: (message) => Bridge.forwardMP4Error?.({
          tabId: currentDownloadTabId,
          message,
          downloadProgress,
          logger,
        }),
      });
    case "cancelDownload":
      try {
        if (typeof request.downloadId === "number") chrome.downloads.cancel(request.downloadId);
        downloadProgress.delete(request.downloadId);
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error?.message || "cancel failed" });
      }
      return false;
    case "LOG_MIRROR":
      return Bridge.handleLogMirror({ request, sender, sendResponse, logger });
    default:
      return false;
  }
});

chrome.action.onClicked.addListener((tab) => {
  const patterns = SiteConfig.BACKGROUND?.contextMenu?.documentUrlPatterns || [];
  Bridge.handleActionClick?.({
    tab,
    isAllowedTab: () => patterns.some((pattern) => {
      const host = String(pattern || "").match(/^https?:\/\/(?:\*\.)?([^/*]+)/i)?.[1];
      return !host || String(tab.url || "").includes(host);
    }),
    setCurrentDownloadTabId(tabId) { currentDownloadTabId = tabId; },
    notify,
    logger,
  });
});
