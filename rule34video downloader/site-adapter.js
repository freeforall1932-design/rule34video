// site-adapter.js
// Generated generic static-media hook module for Rule 34.
(function () {
  const SiteConfig = globalThis.SiteConfig || {};
  const selectors = Object.assign({
    "title": [
        "meta[property=\"og:title\"]",
        "h1",
        ".title",
        "title"
    ],
    "video": [
        "video[src]",
        "video source[src]",
        "source[src]",
        "meta[property=\"og:video\"]",
        "meta[property=\"og:video:secure_url\"]",
        "meta[name=\"twitter:player:stream\"]"
    ],
    "thumbnail": [
        "meta[property=\"og:image\"]",
        "video[poster]"
    ]
}, (SiteConfig.ADAPTER && SiteConfig.ADAPTER.selectors) || {});
  const preferDirectMedia = false;
  const preferDomVideoSrc = false;
  const chromeDownloadWithHeaderRules = true;
  const chromeDownloadHlsSegmentWithHeaderRules = false;
  const chromeDownloadHlsWithHeaderRules = false;
  const tabInitiatedDownloadWithHeaderRules = false;
  const offscreenDownloadWithHeaderRules = false;
  const forceOffscreenHls = false;
  const removeCookieHeaderForDownload = false;
  const refreshPageMediaBeforeDownload = false;
  const resolveDownloadRedirectBeforeDownload = false;
  const extractMediaDefinitions = false;
  const fetchFlowplayerConfigScripts = false;
  const fetchHalimPlayer = false;
  const fetchHlsfreePlayer = false;
  const fetchNhplayerPlayer = false;
  const resolveNhplayerInPageFrame = false;
  const fetchAkiHPlayer = false;
  const forcedMediaRefererUrl = "";
  const preferredMediaUrlPatterns = [];
  const blockedMediaUrlPatterns = [
    "roomad",
    "notifications?",
    "gambling",
    "bonus",
    "/ads?/",
    "/ad/",
    "banner",
    "thumbs?",
    "thumbnails?",
    "preview",
    "sprite",
    "logo",
    "\\.gif(?:[?#]|$)"
];
  const rangeRequestUrlPatterns = [];
  const mediaUrlRewriteRules = [];
  const allowTemplateHlsMediaUrls = false;
  const directChromeDownloadUrlPatterns = [];
  const downloadHeaderRuleExtraDomains = [];
  const staticMediaUrls = [];
  const preferPageFormatsBeforeDefault = true;
  const resolvePageFlashvarsInMainWorld = false;
  const nhplayerPlayerFailureCache = new Set();

  function shouldIgnorePlayerUrl(url) {
    return preferDirectMedia && /\/wp-json\/oembed\//i.test(String(url || ""));
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

  function normalizeUrl(url) {
    return String(url || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  }

  function absoluteUrl(url, baseUrl) {
    try {
      const value = normalizeUrl(url);
      if (!value) return "";
      if (value.startsWith("//")) return "https:" + value;
      return /^https?:\/\//i.test(value) ? value : new URL(value, baseUrl).toString();
    } catch {
      return normalizeUrl(url);
    }
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function isClearlyInvalidStaticProbe(response) {
    if (!response || !response.ok) return true;
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (/\b(?:text\/html|application\/(?:xml|json)|text\/xml)\b/i.test(contentType)) return true;
    if (contentLength > 0 && contentLength < 1024 && !/mpegurl|vnd\.apple|mp2t/i.test(contentType)) return true;
    return false;
  }

  async function isUsableSeedStaticFormat(format, pageUrl) {
    if (!format || format.source !== "seed-static") return true;
    const url = String(format.url || "");
    if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
    const headers = {
      Accept: "video/*,application/octet-stream,application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.5",
      Referer: format.refererUrl || mediaRefererUrl(pageUrl),
    };
    try {
      const head = await fetchWithTimeout(url, { method: "HEAD", headers }, 8000);
      if (!isClearlyInvalidStaticProbe(head)) return true;
      if (head && head.status === 405) {
        const range = await fetchWithTimeout(url, { headers: { ...headers, Range: "bytes=0-0" } }, 10000);
        return !isClearlyInvalidStaticProbe(range);
      }
      return false;
    } catch {
      try {
        const range = await fetchWithTimeout(url, { headers: { ...headers, Range: "bytes=0-0" } }, 10000);
        return !isClearlyInvalidStaticProbe(range);
      } catch {
        return false;
      }
    }
  }

  async function filterUsableSeedStaticFormats(formats, pageUrl) {
    const checked = [];
    for (const format of formats) {
      if (await isUsableSeedStaticFormat(format, pageUrl)) checked.push(format);
    }
    return checked;
  }

  async function withTemporaryAdapterHeaderRules(url, referer, task = async () => null) {
    if (!url || !referer || !globalThis.chrome?.declarativeNetRequest?.updateSessionRules) return await task();
    let requestHost = "";
    let origin = "";
    try { requestHost = new URL(url).hostname; } catch {}
    try { origin = new URL(referer).origin; } catch {}
    if (!requestHost) return await task();
    const ruleId = 840000 + Math.floor(Date.now() % 100000);
    const requestHeaders = [
      { header: "referer", operation: "set", value: referer },
      ...(origin ? [{ header: "origin", operation: "set", value: origin }] : []),
      ...(removeCookieHeaderForDownload ? [{ header: "cookie", operation: "remove" }] : []),
    ];
    const requestDomains = Array.from(new Set([requestHost, ...downloadHeaderRuleExtraDomains].filter(Boolean)));
    const rule = {
      id: ruleId,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders },
      condition: {
        requestDomains,
        resourceTypes: ["xmlhttprequest", "media", "other"],
      },
    };
    let installed = false;
    try {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId], addRules: [rule] });
      installed = true;
      return await task();
    } catch (error) {
      console.log("[site-adapter] adapter-header-rule-failed", { message: error?.message || String(error) });
      return await task();
    } finally {
      if (installed) {
        setTimeout(() => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {}), 15000);
      }
    }
  }

  async function resolveDownloadRedirectFormat(format, pageUrl, videoInfo = {}) {
    if (!resolveDownloadRedirectBeforeDownload || !format?.url || format.format_type === "hls") return format;
    const referer = format.refererUrl || forcedMediaRefererUrl || pageUrl || videoInfo?.webpage_url || videoInfo?.url || "";
    if (!referer) return format;
    try {
      const response = await withTemporaryAdapterHeaderRules(format.url, referer, async () => await fetchWithTimeout(format.url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        credentials: "omit",
        headers: {
          Accept: "video/*,application/octet-stream,*/*;q=0.8",
          Range: "bytes=0-0",
        },
      }, 12000));
      const redirectLocation = response.headers && response.headers.get ? response.headers.get("location") : "";
      const resolvedUrl = redirectLocation
        ? absoluteUrl(redirectLocation, format.url)
        : absoluteUrl(response.url || "", format.url);
      const originalUrl = absoluteUrl(format.url, pageUrl);
      if (!redirectLocation && (!response.ok || !resolvedUrl || sameUrl(resolvedUrl, originalUrl))) {
        console.log("[site-adapter] download-redirect-unresolved", {
          status: response.status || 0,
          host: (() => { try { return new URL(format.url).hostname; } catch { return ""; } })(),
        });
        return format;
      }
      if (!/^https?:\/\//i.test(resolvedUrl)) return format;
      console.log("[site-adapter] resolved-download-redirect", {
        fromHost: (() => { try { return new URL(format.url).hostname; } catch { return ""; } })(),
        toHost: (() => { try { return new URL(resolvedUrl).hostname; } catch { return ""; } })(),
      });
      return {
        ...format,
        url: resolvedUrl,
        source: String(format.source || "mp4") + "-redirect",
        refererUrl: referer,
        requiresReferer: true,
        redirectResolved: true,
      };
    } catch {
      return format;
    }
  }

  function attr(tag, name) {
    const pattern = new RegExp(name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
    const match = String(tag || "").match(pattern);
    return (match && (match[1] || match[2] || match[3])) || "";
  }

  function isLikelyMediaUrl(url) {
    const value = normalizeUrl(url);
    const isPreferredMediaUrl = matchesAnyPattern(value, preferredMediaUrlPatterns);
    if (!isPreferredMediaUrl && !/\.(mp4|m4v|webm|flv|m3u8)(?:$|[?#/])/i.test(value) && !/\/manifest\/video\.mpd(?:$|[?#])/i.test(value) && !/^https?:\/\/(?:[^/]+\.)?xiaoshenke\.net\/(?:vid|s1)\//i.test(value) && !/\/get_video\?/i.test(value) && !/\/api\/hls\/serve\?token=/i.test(value) && !/\/player\/xs1\.php\?data=/i.test(value) && !/^https?:\/\/[^/]+\/[^?#]*\/cf-master\.[^/?#]+\.txt(?:$|[?#])/i.test(value) && !/^https?:\/\/[^/]+\/sora\/[^?#]+\/[^?#]+(?:$|[?#])/i.test(value) && !/^https?:\/\/(?:[^/]+\.)?aki-h\.stream\/(?:file|file2|quality2)\/[^?#]+(?:$|[?#/])/i.test(value) && !/^https?:\/\/[^/]+\.sssrr\.org\/[^?#]+\.fd(?:$|[?#])/i.test(value) && !/^https?:\/\/[^/]+\.xspcdn\d+\.sa\.com\/cdn\/down\/[^?#]+\.html(?:$|[?#])/i.test(value)) return false;
    if (/\.(jpg|jpeg|png|webp|gif|avif|svg)(?:$|[?#])/i.test(value)) return false;
    const isTemplateHlsMaster = /_TPL_\.mp4(?:[?#]|$)/i.test(value) || /\/media=hls[^/]*\/multi=/i.test(value);
    if (isTemplateHlsMaster && !allowTemplateHlsMediaUrls) return false;
    if (/^https?:\/\/[^/]*cloudflarestream\.com\/[^/]+\/video\/[^/]+\/(?:init|seg_\d+)\.mp4(?:$|[?#])/i.test(value)) return false;
    if (!isPreferredMediaUrl && /sprite|thumbnail|thumb|preview|mediabook|\.vtt(?:$|[?#])|timelines\.php/i.test(value)) return false;
    if (/[#?&]file\.mp4(?:$|[?#&])/i.test(value)) return false;
    if (/\/search\/[^?#]*\.mp4(?:$|[/?#])/i.test(value)) return false;
    if (/^https?:\/\/(?:[^/]+\.)?(?:tezfiles\.com|k2s\.cc|rg\.to)\/file\//i.test(value)) return false;
    if (!isPreferredMediaUrl && isKnownHosterDocumentMediaUrl(value)) return false;
    if (!isPreferredMediaUrl && isImageDerivativeMediaUrl(value)) return false;
    if (isAdMediaUrl(value)) return false;
    return true;
  }

  function isAdMediaUrl(url) {
    try {
      const parsed = new URL(absoluteUrl(url, "https://example.invalid/"));
      const host = parsed.hostname.replace(/^www\./i, "");
      const path = parsed.pathname;
      if (/(^|\.)(adtng\.com|mmcdn\.com|playhubconnect\.com|love\.mydaddy\.cc|cdn\.itsup\.com|psmcdn\.net)$/i.test(host)) return true;
      if (/\/(?:ads?|creatives?|roomad|pubs|banner|vast|tour\/pics)\//i.test(path)) return true;
    } catch {}
    return /(?:^|[/.])(ads?|advert|banner|vast|roomad|creatives?)(?:[/.?_-]|$)/i.test(String(url || ""));
  }

  function mediaRefererUrl(pageUrl) {
    return forcedMediaRefererUrl || pageUrl || "";
  }

  function sameUrl(left, right) {
    try {
      return new URL(String(left || "")).href === new URL(String(right || "")).href;
    } catch {
      return String(left || "") === String(right || "");
    }
  }

  function isSourcePageUrl(url, videoInfo) {
    if (!url) return false;
    return [videoInfo?.webpage_url, videoInfo?.url, videoInfo?.sourcePageUrl]
      .filter(Boolean)
      .some((pageUrl) => sameUrl(url, pageUrl));
  }

  function rewriteMediaUrl(url, baseUrl) {
    let value = absoluteUrl(url, baseUrl);
    for (const rule of Array.isArray(mediaUrlRewriteRules) ? mediaUrlRewriteRules : []) {
      const pattern = rule && (rule.from || rule.pattern || rule.match);
      const replacement = rule && (rule.to || rule.replacement || rule.replace);
      if (!pattern || typeof replacement !== "string") continue;
      try {
        const flags = String(rule.flags || "i").replace(/[^dgimsuvy]/g, "") || "i";
        const next = value.replace(new RegExp(String(pattern), flags), replacement);
        if (next !== value) value = absoluteUrl(next, value);
      } catch {}
    }
    return value;
  }

  function isTemplateHlsMasterUrl(url) {
    const value = normalizeUrl(url);
    return /_TPL_\.mp4(?:[?#]|$)/i.test(value) || /\/media=hls[^/]*\/multi=/i.test(value);
  }

  function parseM3u8Attributes(line) {
    const attrs = {};
    for (const part of String(line || "").split(",")) {
      const match = part.match(/([A-Z0-9-]+)=(".*?"|[^,]*)/i);
      if (!match) continue;
      attrs[match[1].toUpperCase()] = String(match[2] || "").replace(/^"|"$/g, "");
    }
    return attrs;
  }

  async function resolveTemplateHlsMasterFormat(format, pageUrl) {
    if (!allowTemplateHlsMediaUrls || !format || !isTemplateHlsMasterUrl(format.url)) return format;
    try {
      const response = await fetchWithTimeout(format.url, {
        headers: {
          Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*",
          Referer: mediaRefererUrl(pageUrl),
        },
      }, 15000);
      if (!response.ok) return format;
      const text = await response.text();
      const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const variants = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue;
        const next = lines.slice(index + 1).find((candidate) => candidate && !candidate.startsWith("#"));
        if (!next) continue;
        const attrs = parseM3u8Attributes(line.replace(/^#EXT-X-STREAM-INF:/i, ""));
        const resolution = String(attrs.RESOLUTION || "");
        const height = Number(resolution.match(/x(\d+)/i)?.[1] || 0);
        const bandwidth = Number(attrs.BANDWIDTH || attrs["AVERAGE-BANDWIDTH"] || 0);
        variants.push({
          url: absoluteUrl(next, response.url || format.url),
          height,
          bandwidth,
        });
      }
      variants.sort((a, b) => (b.height - a.height) || (b.bandwidth - a.bandwidth));
      const best = variants[0];
      if (!best || !best.url) return format;
      return {
        ...format,
        url: best.url,
        height: best.height || format.height || null,
        ext: "m3u8",
        format_type: "hls",
        protocol: "m3u8_native",
        source: String(format.source || "html") + "-resolved-master",
        quality: best.height ? String(best.height) + "p HLS" : (format.quality || "HLS"),
      };
    } catch {
      return format;
    }
  }

  async function resolveFirstHlsMediaSegmentFromContent(content, baseUrl, refererUrl) {
    const lines = String(content || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const absolute = (value) => absoluteUrl(value, baseUrl);
    const variants = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue;
      const next = lines.slice(index + 1).find((candidate) => candidate && !candidate.startsWith("#"));
      if (!next) continue;
      const attrs = parseM3u8Attributes(line.replace(/^#EXT-X-STREAM-INF:/i, ""));
      const resolution = String(attrs.RESOLUTION || "");
      const height = Number(resolution.match(/x(\d+)/i)?.[1] || 0);
      const bandwidth = Number(attrs.BANDWIDTH || attrs["AVERAGE-BANDWIDTH"] || 0);
      variants.push({ url: absolute(next), height, bandwidth });
    }
    if (variants.length) {
      variants.sort((left, right) => (right.height - left.height) || (right.bandwidth - left.bandwidth));
      const variantUrl = variants[0]?.url;
      if (!variantUrl) return "";
      try {
        const response = await fetchWithTimeout(variantUrl, {
          headers: {
            Accept: "application/vnd.apple.mpegurl,text/plain,*/*",
            ...(refererUrl ? { Referer: refererUrl } : {}),
          },
        }, 15000);
        if (!response.ok) return "";
        return await resolveFirstHlsMediaSegmentFromContent(await response.text(), response.url || variantUrl, refererUrl);
      } catch {
        return "";
      }
    }
    const mediaSegments = [];
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      if (/\.(?:key|vtt)(?:$|[?#])/i.test(line)) continue;
      const segmentUrl = absolute(line);
      if (/\.(?:ts|m4s|mp4)(?:$|[?#])/i.test(segmentUrl) || /\/cdn\/down\/[^?#]+\.html(?:$|[?#])/i.test(segmentUrl)) mediaSegments.push(segmentUrl);
    }
    return mediaSegments[1] || mediaSegments[0] || "";
  }

  function isDirectChromeDownloadUrl(url) {
    return Boolean(url && matchesAnyPattern(String(url), directChromeDownloadUrlPatterns));
  }

  function requiresRangeRequestUrl(url) {
    return Boolean(url && matchesAnyPattern(String(url), rangeRequestUrlPatterns));
  }

  function isNosofilesMediaUrl(url) {
    try {
      return /(^|[.])nosofiles[.]com$/i.test(new URL(url || "").hostname);
    } catch {
      return false;
    }
  }

  function markDirectChromeDownload(format) {
    if (!format || !isDirectChromeDownloadUrl(format.url)) return format;
    const direct = { ...format };
    direct.forceChromeDownload = true;
    delete direct.forceOffscreenDownload;
    delete direct.forceTabDownload;
    delete direct.useDownloadHeaderRules;
    delete direct.requiresReferer;
    delete direct.refererUrl;
    delete direct.referrer;
    delete direct.referer;
    return direct;
  }

  function mediaFormat(url, label, pageUrl, source) {
    const absolute = absoluteUrl(url, pageUrl);
    let normalizedAbsolute = rewriteMediaUrl(absolute, pageUrl);
    if (!isLikelyMediaUrl(normalizedAbsolute) && !isLikelyMediaUrl(absolute)) return null;
    if (isBlockedFormatUrl(normalizedAbsolute)) return null;
    if (/\/manifest\/video\.mpd(?:$|[?#])/i.test(normalizedAbsolute)) normalizedAbsolute = normalizedAbsolute.replace(/\/manifest\/video\.mpd/i, "/manifest/video.m3u8");
    const isTemplateHlsMaster = allowTemplateHlsMediaUrls && (/_TPL_\.mp4(?:[?#]|$)/i.test(normalizedAbsolute) || /\/media=hls[^/]*\/multi=/i.test(normalizedAbsolute));
    const isHls = /\.m3u8(?:$|[?#/])/i.test(normalizedAbsolute) || isTemplateHlsMaster || (extractMediaDefinitions && /\/media\/hls\//i.test(normalizedAbsolute)) || /\/api\/hls\/serve\?token=/i.test(normalizedAbsolute) || /\/player\/xs1\.php\?data=/i.test(normalizedAbsolute) || /\/cf-master\.[^/?#]+\.txt(?:$|[?#])/i.test(normalizedAbsolute) || /^https?:\/\/(?:[^/]+\.)?aki-h\.stream\/(?:file|file2|quality2)\/[^?#]+(?:$|[?#/])/i.test(normalizedAbsolute);
    const labelHeight = String(label || "").match(/(?:^|[^0-9])(\d{3,4})p?(?:[^0-9]|$)/i)?.[1] || "";
    const urlHeight = String(normalizedAbsolute || "").match(/(?:^|[^0-9])(\d{3,4})p(?:[^0-9]|$)/i)?.[1] || "";
    const height = parseInt(labelHeight || urlHeight, 10) || null;
    const format = {
      format_id: height ? String(height) + "p" : (label || source || (isHls ? "hls" : "mp4")),
      height,
      ext: isHls ? "m3u8" : (/\.flv(?:$|[?#/])/i.test(normalizedAbsolute) ? "flv" : (/\.webm(?:$|[?#/])/i.test(normalizedAbsolute) ? "webm" : (/\.m4v(?:$|[?#/])/i.test(normalizedAbsolute) ? "m4v" : "mp4"))),
      format_type: isHls ? "hls" : (/\.flv(?:$|[?#/])/i.test(normalizedAbsolute) ? "flv" : "mp4"),
      protocol: isHls ? "m3u8_native" : "https",
      quality: label || source || "auto",
      source: source || "html",
      url: normalizedAbsolute,
    };
    if (!isHls && !isDirectChromeDownloadUrl(normalizedAbsolute) && isNosofilesMediaUrl(normalizedAbsolute)) {
      format.forceTabDownload = true;
      format.refererUrl = format.refererUrl || mediaRefererUrl(pageUrl);
      format.requiresReferer = true;
      format.requiresRangeRequest = true;
    }
    if (preferDirectMedia && !isHls) {
      try {
        const host = new URL(absolute).hostname;
        if (!format.forceOffscreenDownload && !/(^|[.])xiaoshenke[.]net$/i.test(host)) format.forceChromeDownload = true;
      } catch {
        if (!format.forceOffscreenDownload) format.forceChromeDownload = true;
      }
    }
    if (!isHls && requiresRangeRequestUrl(normalizedAbsolute)) {
      format.requiresRangeRequest = true;
    }
    if (!isHls && !isDirectChromeDownloadUrl(normalizedAbsolute) && /\/(?:get_file|reversebuffer)(?:\/|\?)/i.test(absolute)) {
      format.refererUrl = mediaRefererUrl(pageUrl);
      format.requiresReferer = true;
      if (/[?&](?:rnd|v-acctoken|token|expires|cv)=/i.test(absolute)) format.requiresRangeRequest = true;
    }
    if (chromeDownloadWithHeaderRules && !isHls && !format.forceOffscreenDownload && !format.forceTabDownload && !isDirectChromeDownloadUrl(normalizedAbsolute)) {
      format.forceChromeDownload = true;
      format.useDownloadHeaderRules = true;
      format.refererUrl = format.refererUrl || mediaRefererUrl(pageUrl);
      format.requiresReferer = true;
    }
    if (tabInitiatedDownloadWithHeaderRules && !isHls && !format.forceOffscreenDownload && !isDirectChromeDownloadUrl(normalizedAbsolute)) {
      format.forceTabDownload = true;
      format.useDownloadHeaderRules = true;
      format.refererUrl = format.refererUrl || mediaRefererUrl(pageUrl);
      format.requiresReferer = true;
    }
    if (chromeDownloadHlsSegmentWithHeaderRules && isHls) {
      format.forceChromeHlsSegmentDownload = true;
      format.useDownloadHeaderRules = true;
      format.refererUrl = format.refererUrl || mediaRefererUrl(pageUrl);
      format.requiresReferer = true;
    } else if (chromeDownloadHlsWithHeaderRules && isHls) {
      format.forceChromeDownload = true;
      format.useDownloadHeaderRules = true;
      format.refererUrl = format.refererUrl || mediaRefererUrl(pageUrl);
      format.requiresReferer = true;
    }
    if (forceOffscreenHls && isHls) {
      format.forceOffscreenHls = true;
      delete format.forceChromeDownload;
      delete format.forceChromeHlsSegmentDownload;
      format.refererUrl = format.refererUrl || mediaRefererUrl(pageUrl);
      format.requiresReferer = true;
    }
    if (offscreenDownloadWithHeaderRules && !isHls && !isDirectChromeDownloadUrl(normalizedAbsolute)) {
      format.forceOffscreenDownload = true;
      format.refererUrl = format.refererUrl || mediaRefererUrl(pageUrl);
      format.requiresReferer = true;
    }
    if (format.forceOffscreenDownload) {
      delete format.forceChromeDownload;
      delete format.forceTabDownload;
    }
    if (removeCookieHeaderForDownload && format.requiresReferer) {
      format.removeCookieHeaderForDownload = true;
    }
    if (downloadHeaderRuleExtraDomains.length && format.useDownloadHeaderRules) {
      format.downloadHeaderRuleExtraDomains = downloadHeaderRuleExtraDomains;
    }
    return markDirectChromeDownload(format);
  }

  function decodeProxyMediaUrl(url, baseUrl) {
    try {
      const absolute = absoluteUrl(url, baseUrl);
      if (!absolute) return "";
      const parsed = new URL(absolute);
      const decodeCandidates = (value) => {
        const decoded = normalizeUrl(decodeURIComponent(value || ""));
        const candidates = [decoded];
        try {
          candidates.push(normalizeUrl(atob(decoded)));
        } catch {}
        return candidates;
      };
      for (const key of ["floc", "r", "url", "file", "src"]) {
        const encoded = parsed.searchParams.get(key);
        if (!encoded) continue;
        for (const decoded of decodeCandidates(encoded)) {
          if (!decoded || !/\.(mp4|m4v|webm|m3u8)(?:$|[?#/])/i.test(decoded)) continue;
          return absoluteUrl(decoded, absolute);
        }
      }
      return "";
    } catch {
      return "";
    }
  }

  function isKnownHosterUrl(url) {
    try {
      const parsed = new URL(absoluteUrl(url, "https://example.invalid/"));
      const host = parsed.hostname.replace(/^www\./i, "");
      if (/(^|\.)(vidara\.(?:to|so)|vsonic\.click|rubyvidhub\.com|streamruby\.(?:com|net)|luluvid\.com|luluvids\.top|luluvdoo\.com|luluvdo\.com|lulustream\.com|nhplayer\.com|eporner\.com|playmogo\.com|voe\.sx|byseraguci\.com|byselapuix\.com|bysesayeveum\.com|q8y5z\.com|myvidplay\.com|dood\.(?:watch|stream|so|la)|streamtape\.(?:com|to|xyz)|prvs\.top|mydaddy\.cc|seekplays\.com|pornhouse\.me|bkcdn\.net|storage\.googleapis\.com|aurorapath\.space|abxxx\.(?:com|tube)|xiaoshenke\.net|xtremestream\.xyz|turbovidhls\.com|44x\.io)$/i.test(host)) {
        return true;
      }
      return /\/(?:e|embed|d)\/[^/?#]+/i.test(parsed.pathname) || /\/embed-[^/?#]+\.html$/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function isKnownHosterDocumentMediaUrl(url) {
    try {
      const parsed = new URL(absoluteUrl(url, "https://example.invalid/"));
      const host = parsed.hostname.replace(/^www\./i, "");
      const path = parsed.pathname;
      if (/(^|\.)(streamtape\.(?:com|to|xyz))$/i.test(host) && /^\/(?:e|v|d)\//i.test(path)) return true;
      if (/(^|\.)(dood\.(?:watch|stream|so|la))$/i.test(host) && /^\/(?:e|d)\//i.test(path)) return true;
    } catch {}
    return false;
  }

  function isImageDerivativeMediaUrl(url) {
    try {
      const parsed = new URL(absoluteUrl(url, "https://example.invalid/"));
      const host = parsed.hostname.replace(/^www\./i, "");
      const path = parsed.pathname;
      if (/(^|\.)(?:pix-cdn77|pix-fl)\.phncdn\.com$/i.test(host) && /\/plain\/.*\/rs:fit:/i.test(path)) return true;
    } catch {}
    return false;
  }

  function jsString(value) {
    return String(value || "")
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }

  function unpackPackerPayload(payload, radix, count, words) {
    const dictionary = Array.isArray(words) ? words : [];
    const base = Number(radix) || 36;
    const limit = Number(count) || dictionary.length;
    const encodeToken = (value) => {
      const encode = (number) => {
        const quotient = Math.floor(number / base);
        const remainder = number % base;
        return (number < base ? "" : encode(quotient)) +
          (remainder > 35 ? String.fromCharCode(remainder + 29) : remainder.toString(36));
      };
      const numeric = Number(value) || 0;
      return encode(numeric);
    };
    let output = String(payload || "");
    for (let index = limit - 1; index >= 0; index -= 1) {
      if (!dictionary[index]) continue;
      const token = encodeToken(index);
      output = output.replace(new RegExp("\\b" + token + "\\b", "g"), dictionary[index]);
    }
    return output;
  }

  function unpackPackedScripts(html) {
    const unpacked = [];
    const source = String(html || "");
    const marker = "eval(function(p,a,c,k,e,d)";
    let offset = 0;
    while ((offset = source.indexOf(marker, offset)) !== -1) {
      const chunk = source.slice(offset, offset + 120000);
      const match = chunk.match(/\}\('((?:\\'|[^'])*)',(\d+),(\d+),'((?:\\'|[^'])*)'\.split\('\|'\)(?:,[^)]*)?\)\)/);
      if (match) {
        const payload = jsString(match[1]);
        const words = jsString(match[4]).split("|");
        unpacked.push(unpackPackerPayload(payload, match[2], match[3], words));
      }
      offset += marker.length;
    }
    return unpacked;
  }

  function decodeBase64Utf8(value) {
    try {
      const decoded = globalThis.atob(String(value || "").replace(/[^A-Za-z0-9+/=]/g, ""));
      try {
        return decodeURIComponent(escape(decoded));
      } catch {
        return decoded;
      }
    } catch {
      return "";
    }
  }

  function unpackCookieRunScripts(html) {
    const unpacked = [];
    const source = String(html || "");
    for (const match of source.matchAll(/Cookie\.Run\(\s*((?:"(?:\\.|[^"])*"\s*(?:\+\s*)?)+)\s*\)/g)) {
      const joined = Array.from(String(match[1] || "").matchAll(/"((?:\\.|[^"])*)"/g))
        .map((part) => jsString(part[1]))
        .join("");
      const decoded = decodeBase64Utf8(joined);
      if (decoded) unpacked.push(decoded);
    }
    return unpacked;
  }

  function collectPackedMediaFormats(html, pageUrl) {
    const formats = [];
    const seen = new Set();
    const queue = [String(html || "")];
    const visited = new Set();
    for (let index = 0; index < queue.length && index < 12; index += 1) {
      const source = queue[index];
      if (!source || visited.has(source)) continue;
      visited.add(source);
      const unpackedScripts = unpackPackedScripts(source).concat(unpackCookieRunScripts(source));
      for (const unpacked of unpackedScripts) {
        if (unpacked && !visited.has(unpacked)) queue.push(unpacked);
        for (const format of collectStaticMediaFormats(unpacked, pageUrl)) {
          if (!format || !format.url || seen.has(format.url)) continue;
          seen.add(format.url);
          formats.push(format);
        }
      }
    }
    return formats;
  }

  function collectEncodedMediaFormats(html, pageUrl) {
    const formats = [];
    const seen = new Set();
    const add = (url, label, source) => {
      const format = mediaFormat(url, label, pageUrl, source);
      if (!format || seen.has(format.url)) return;
      seen.add(format.url);
      formats.push(format);
    };

    for (const match of String(html || "").matchAll(/(?:const|let|var)\s+(_0x[a-z0-9_]+)\s*=\s*['"]([0-9a-fA-F|]{20,})['"][\s\S]{0,1500}?_decode\(\1\)/gi)) {
      const clean = String(match[2] || "").replace(/\|/g, "");
      let decoded = "";
      for (let index = 0; index + 1 < clean.length; index += 2) {
        const byte = parseInt(clean.slice(index, index + 2), 16);
        if (!Number.isNaN(byte)) decoded += String.fromCharCode(byte);
      }
      add(decoded.split("").reverse().join(""), "encoded", "encoded-js");
    }

    return formats;
  }

  function decodeBase64Compat(value) {
    if (typeof atob === "function") return atob(value);
    if (typeof Buffer !== "undefined") return Buffer.from(value, "base64").toString("utf8");
    return "";
  }

  function normalizeConfusableBase64(value) {
    const map = {
      "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "У": "Y",
      "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "к": "k", "м": "m", "т": "t", "в": "b", "н": "h", "з": "3",
    };
    return Array.from(String(value || ""), (char) => map[char] || char).join("");
  }

  function decodeSextuVideoUrl(value, pageUrl) {
    const normalized = normalizeConfusableBase64(value);
    const parts = normalized.split(",");
    if (!parts[0]) return "";
    try {
      const pathPart = decodeBase64Compat(parts[0]);
      const queryPart = parts[1] ? decodeBase64Compat(parts[1]) : "";
      const absolute = new URL(pathPart, pageUrl);
      absolute.search = queryPart || "";
      return absolute.toString();
    } catch {
      return "";
    }
  }

  function collectInitPlayerConfigFormats(html, pageUrl) {
    const formats = [];
    const seen = new Set();
    const add = (url, label, source) => {
      const format = mediaFormat(url, label, pageUrl, source);
      if (!format || seen.has(format.url)) return;
      seen.add(format.url);
      formats.push(format);
    };

    const source = String(html || "");
    for (const match of source.matchAll(/window\.initPlayer\([\s\S]*?,\s*'([^']+)'\s*,\s*null\s*\)/gi)) {
      try {
        const decoded = decodeBase64Compat(normalizeConfusableBase64(match[1] || ""));
        const parsed = JSON.parse(decoded);
        for (const item of Array.isArray(parsed) ? parsed : []) {
          const url = decodeSextuVideoUrl(item && item.video_url, pageUrl);
          const label = item && item.format ? String(item.format).replace(/^_/, "").replace(/\.(mp4|m4v|webm|m3u8)$/i, "") : "";
          add(url, label || "mp4", "init-player-config");
        }
      } catch {}
    }

    return formats;
  }

  function decodeVoeConfig(value) {
    try {
      const rot13 = String(value || "").replace(/[A-Za-z]/g, (char) => {
        const code = char.charCodeAt(0);
        const base = code >= 97 ? 97 : 65;
        return String.fromCharCode(((code - base + 13) % 26) + base);
      });
      const compact = rot13.replace(/(@\$|\^\^|~@|%\?|\*~|!!|#&)/g, "_").split("_").join("");
      const shifted = atob(compact)
        .split("")
        .map((char) => String.fromCharCode(char.charCodeAt(0) - 3))
        .join("");
      const json = atob(shifted.split("").reverse().join(""));
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function collectVoeMediaFormats(html, pageUrl) {
    const formats = [];
    const seen = new Set();
    const add = (url, label, source) => {
      const format = mediaFormat(url, label, pageUrl, source);
      if (!format || seen.has(format.url)) return;
      seen.add(format.url);
      formats.push(format);
    };

    for (const match of String(html || "").matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      let parsed = null;
      try {
        parsed = JSON.parse(match[1]);
      } catch {
        parsed = null;
      }
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        if (typeof value !== "string") continue;
        const config = decodeVoeConfig(value);
        if (!config) continue;
        add(config.source, "hls", "voe-config");
        for (const fallback of Array.isArray(config.fallback) ? config.fallback : []) {
          add(fallback.file || fallback.url, fallback.label || fallback.type || "fallback", "voe-fallback");
        }
      }
    }

    for (const match of String(html || "").matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = match[1] || match[2] || "";
      const label = String(match[3] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      add(href, label, "anchor");
      add(decodeProxyMediaUrl(href, pageUrl), label, "anchor-proxy");
    }

    formats.sort((a, b) => (b.height || 0) - (a.height || 0));
    return formats.slice(0, 20);
  }

  function decodeBase64Json(value) {
    try {
      return JSON.parse(atob(String(value || "")));
    } catch {
      return null;
    }
  }

  function collectSexApiMediaFormats(html, pageUrl) {
    const formats = [];
    const seen = new Set();
    const add = (url, label, source) => {
      const format = mediaFormat(url, label, pageUrl, source);
      if (!format || seen.has(format.url)) return;
      seen.add(format.url);
      formats.push(format);
    };

    for (const match of String(html || "").matchAll(/window\.__V_DATA__\s*=\s*["']([^"']+)["']/gi)) {
      const config = decodeBase64Json(match[1]);
      if (!config) continue;
      try {
        if (config.rm) add(atob(config.rm), "hls", "sex-api-raw");
      } catch {}
      try {
        if (config.m) add(atob(config.m), "hls", "sex-api-manifest");
      } catch {}
    }

    formats.sort((a, b) => (b.height || 0) - (a.height || 0));
    return formats.slice(0, 20);
  }

  function base64UrlBytes(value) {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function decryptAesGcmJson(encrypted) {
    if (!encrypted || !Array.isArray(encrypted.key_parts) || !encrypted.iv || !encrypted.payload) return null;
    const keyParts = selectedAesGcmKeyParts(encrypted).map(base64UrlBytes);
    const keyLength = keyParts.reduce((total, part) => total + part.length, 0);
    const key = new Uint8Array(keyLength);
    let offset = 0;
    for (const part of keyParts) {
      key.set(part, offset);
      offset += part.length;
    }
    const cryptoApi = globalThis.crypto || globalThis.msCrypto;
    if (!cryptoApi || !cryptoApi.subtle) return null;
    try {
      const imported = await cryptoApi.subtle.importKey("raw", key.slice().buffer, "AES-GCM", false, ["decrypt"]);
      const decrypted = await cryptoApi.subtle.decrypt(
        { name: "AES-GCM", iv: base64UrlBytes(encrypted.iv) },
        imported,
        base64UrlBytes(encrypted.payload)
      );
      return JSON.parse(new TextDecoder().decode(decrypted));
    } catch {
      return null;
    }
  }

  function selectedAesGcmKeyParts(encrypted) {
    const keyParts = Array.isArray(encrypted && encrypted.key_parts) ? encrypted.key_parts : [];
    const version = parseInt(String(encrypted && encrypted.version || "").trim(), 10);
    if (Number.isInteger(version) && version >= 1 && version <= 20) {
      const selected = [version, 31 - version]
        .filter((index) => index >= 1 && index <= keyParts.length)
        .map((index) => keyParts[index - 1])
        .filter((value) => typeof value === "string" && value);
      if (selected.length) return selected;
    }
    return keyParts;
  }

  function base64UrlString(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return btoa(binary).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }

  function byseRotate(value, shift) {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
  }

  function byseMix(state) {
    state[0] = (state[0] + state[1]) >>> 0;
    state[3] = byseRotate(state[3] ^ state[0], 16);
    state[2] = (state[2] + state[3]) >>> 0;
    state[1] = byseRotate(state[1] ^ state[2], 12);
    state[0] = (state[0] + state[1]) >>> 0;
    state[3] = byseRotate(state[3] ^ state[0], 8);
    state[2] = (state[2] + state[3]) >>> 0;
    state[1] = byseRotate(state[1] ^ state[2], 7);
  }

  function byseHash(input) {
    const size = 512;
    const state = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762]);
    for (let index = 0; index < input.length; index += 1) {
      state[0] = (state[0] + input[index]) >>> 0;
      state[0] = byseRotate(state[0], 7);
      byseMix(state);
    }
    for (let index = 0; index < 8; index += 1) byseMix(state);
    const memory = new Uint32Array(size);
    for (let index = 0; index < size; index += 1) {
      byseMix(state);
      memory[index] = (state[0] ^ state[2]) >>> 0;
    }
    for (let round = 0; round < 2; round += 1) {
      for (let index = 0; index < size; index += 1) {
        const picked = memory[index] & (size - 1);
        let next = (memory[index] + memory[picked]) >>> 0;
        next = byseRotate(next, 13);
        next = (next ^ Math.imul(memory[(index + 1) & (size - 1)], 2654435761)) >>> 0;
        memory[index] = next;
        state[0] = (state[0] ^ next) >>> 0;
        byseMix(state);
      }
    }
    const output = new Uint32Array(8);
    const bucketSize = size / 8;
    for (let bucket = 0; bucket < 8; bucket += 1) {
      byseMix(state);
      let value = state[0];
      const offset = bucket * bucketSize;
      for (let index = 0; index < bucketSize; index += 1) {
        const item = memory[offset + index];
        value = (value + item) >>> 0;
        value = byseRotate(value, 5);
        value = (value ^ Math.imul(item, 2246822519)) >>> 0;
      }
      output[bucket] = (value ^ state[2]) >>> 0;
    }
    return output;
  }

  function byseLeadingZeroBits(values) {
    let total = 0;
    for (const value of values) {
      if (value === 0) {
        total += 32;
        continue;
      }
      return total + Math.clz32(value);
    }
    return total;
  }

  function byseAsciiBytes(value) {
    const input = String(value || "");
    const bytes = new Uint8Array(input.length);
    for (let index = 0; index < input.length; index += 1) bytes[index] = input.charCodeAt(index) & 255;
    return bytes;
  }

  async function solveByseProofOfWork(nonce, difficulty, timeoutMs = 20000) {
    const minDifficulty = Math.max(0, Number(difficulty) || 0);
    if (minDifficulty <= 0) return "0";
    const prefix = String(nonce || "") + ":";
    const startedAt = Date.now();
    for (let attempt = 0; ; attempt += 1) {
      if (byseLeadingZeroBits(byseHash(byseAsciiBytes(prefix + attempt))) >= minDifficulty) return String(attempt);
      if (attempt > 0 && attempt % 1024 === 0) {
        if (Date.now() - startedAt > timeoutMs) return "";
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  async function byseAccessFingerprint(origin) {
    const cryptoApi = globalThis.crypto || globalThis.msCrypto;
    if (!cryptoApi || !cryptoApi.subtle) return null;
    const challengeResponse = await fetch(new URL("/api/videos/access/challenge", origin).toString(), {
      method: "POST",
      credentials: "include",
    });
    if (!challengeResponse.ok) return null;
    const challenge = await challengeResponse.json().catch(() => null);
    if (!challenge || !challenge.nonce || !challenge.challenge_id) return null;
    const keyPair = await cryptoApi.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicKey = await cryptoApi.subtle.exportKey("jwk", keyPair.publicKey);
    const signatureBytes = await cryptoApi.subtle.sign(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      keyPair.privateKey,
      new TextEncoder().encode(challenge.nonce)
    );
    const nav = typeof navigator !== "undefined" ? navigator : {};
    const screenInfo = typeof screen !== "undefined" ? screen : {};
    const client = {
      user_agent: String(nav.userAgent || ""),
      pixel_ratio: typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
      screen_width: Number(screenInfo.width) || 0,
      screen_height: Number(screenInfo.height) || 0,
      color_depth: Number(screenInfo.colorDepth) || 24,
      languages: Array.isArray(nav.languages) ? nav.languages : (nav.language ? [nav.language] : []),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      hardware_concurrency: Number(nav.hardwareConcurrency) || 0,
      touch_points: Number(nav.maxTouchPoints) || 0,
      pointer_type: "fine,hover",
      extra: {
        vendor: String(nav.vendor || ""),
        appVersion: String(nav.appVersion || ""),
      },
    };
    const attestResponse = await fetch(new URL("/api/videos/access/attest", origin).toString(), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        viewer_id: "",
        device_id: "",
        challenge_id: challenge.challenge_id,
        nonce: challenge.nonce,
        signature: base64UrlString(signatureBytes),
        public_key: publicKey,
        client,
        storage: {},
        attributes: { entropy: "low" },
      }),
    });
    if (!attestResponse.ok) return null;
    const attest = await attestResponse.json().catch(() => null);
    if (!attest || !attest.token) return null;
    return {
      token: attest.token,
      viewer_id: attest.viewer_id || "",
      device_id: attest.device_id || "",
      confidence: attest.confidence,
    };
  }

  async function fetchByseQ8PlaybackFormats(playerUrl, pageUrl) {
    const formats = [];
    let parsed;
    try {
      parsed = new URL(playerUrl);
    } catch {
      return formats;
    }
    let q8Url = playerUrl;
    let parentUrl = playerUrl;
    let sourcePageUrl = pageUrl || playerUrl;
    const host = parsed.hostname.replace(/^www\./i, "");
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const byseCode = pathParts[0] === "e" && pathParts[1] ? pathParts[1] : (pathParts[pathParts.length - 1] || "");
    if (/^(?:bysesayeveum\.com|byseraguci\.com|byselapuix\.com)$/i.test(host) && byseCode) {
      try {
        const detailsUrl = new URL("/api/videos/" + encodeURIComponent(byseCode) + "/embed/details", parsed.origin);
        const detailsResponse = await fetch(detailsUrl.toString(), {
          credentials: "include",
          headers: {
            Accept: "application/json,text/plain,*/*",
            Referer: pageUrl || playerUrl,
          },
        });
        if (detailsResponse.ok) {
          const details = await detailsResponse.json().catch(() => null);
          if (details && typeof details.embed_frame_url === "string" && details.embed_frame_url) q8Url = details.embed_frame_url;
        }
      } catch {}
    }
    let q8Parsed;
    try {
      q8Parsed = new URL(q8Url);
    } catch {
      return formats;
    }
    const q8Host = q8Parsed.hostname.replace(/^www\./i, "");
    if (!/^(?:q8y5z\.com)$/i.test(q8Host)) return formats;
    const filecode = q8Parsed.pathname.split("/").filter(Boolean).pop() || byseCode;
    if (!filecode) return formats;
    let embedOrigin = "";
    try {
      embedOrigin = new URL(sourcePageUrl || pageUrl || playerUrl).hostname.replace(/^www\./i, "");
    } catch {}
    if (!embedOrigin && /^(?:bysesayeveum\.com)$/i.test(host)) embedOrigin = "xfuntaxy.com";
    const embedHeaders = {
      "X-Embed-Origin": embedOrigin,
      "X-Embed-Referer": sourcePageUrl || pageUrl || playerUrl,
      "X-Embed-Parent": parentUrl || playerUrl,
    };
    const fingerprint = await byseAccessFingerprint(q8Parsed.origin);
    if (!fingerprint) return formats;
    const jsonHeaders = { "Content-Type": "application/json", ...embedHeaders };
    try {
      const captchaResponse = await fetch(new URL("/api/videos/" + encodeURIComponent(filecode) + "/embed/captcha", q8Parsed.origin).toString(), {
        method: "POST",
        credentials: "include",
        headers: jsonHeaders,
        body: JSON.stringify({ fingerprint }),
      });
      if (!captchaResponse.ok) return formats;
      const captcha = await captchaResponse.json().catch(() => null);
      const solution = await solveByseProofOfWork(captcha && captcha.pow_nonce, captcha && captcha.pow_difficulty);
      if (!captcha || !captcha.pow_token || !solution) return formats;
      const verifyResponse = await fetch(new URL("/api/videos/" + encodeURIComponent(filecode) + "/embed/captcha/verify", q8Parsed.origin).toString(), {
        method: "POST",
        credentials: "include",
        headers: jsonHeaders,
        body: JSON.stringify({ pow_token: captcha.pow_token, solution, fingerprint }),
      });
      if (!verifyResponse.ok) return formats;
      const verification = await verifyResponse.json().catch(() => null);
      const playbackHeaders = { ...jsonHeaders };
      if (verification && verification.token) playbackHeaders["X-Captcha-Token"] = verification.token;
      const playbackResponse = await fetch(new URL("/api/videos/" + encodeURIComponent(filecode) + "/embed/playback", q8Parsed.origin).toString(), {
        method: "POST",
        credentials: "include",
        headers: playbackHeaders,
        body: JSON.stringify({ fingerprint }),
      });
      if (!playbackResponse.ok) return formats;
      const playback = await playbackResponse.json().catch(() => null);
      const decrypted = await decryptAesGcmJson(playback && playback.playback);
      for (const source of (decrypted && decrypted.sources) || []) {
        const format = mediaFormat(source && source.url, source && (source.label || source.quality) || "hls", sourcePageUrl || pageUrl || q8Url, "byse-q8-playback");
        if (!format) continue;
        format.refererUrl = q8Url;
        format.requiresReferer = true;
        if (source && source.height) format.height = source.height;
        if (source && source.bitrate_kbps) format.tbr = source.bitrate_kbps;
        if (source && source.size_bytes) format.filesize = source.size_bytes;
        formats.push(format);
      }
    } catch {}
    formats.sort((a, b) => formatPreferenceScore(b) - formatPreferenceScore(a));
    return formats.slice(0, 20);
  }

  function decodeKvsVideoUrl(value) {
    const map = {
      0x0410: "A",
      0x0412: "B",
      0x0415: "E",
      0x041a: "K",
      0x041c: "M",
      0x041d: "H",
      0x041e: "O",
      0x0420: "P",
      0x0421: "C",
      0x0422: "T",
      0x0425: "X",
    };
    let encoded = String(value || "")
      .replace(/[\u0410\u0412\u0415\u041a\u041c\u041d\u041e\u0420\u0421\u0422\u0425]/g, (char) => map[char.charCodeAt(0)] || char)
      .replace(/,/g, "/")
      .replace(/~/g, "=");
    while (encoded.length % 4) encoded += "=";
    try {
      return atob(encoded);
    } catch {
      return "";
    }
  }

  function kvsApiFormat(record, pageUrl) {
    const decoded = decodeKvsVideoUrl(record && record.video_url);
    if (!decoded) return null;
    const url = absoluteUrl(decoded, pageUrl);
    if (!/\.mp4(?:$|[?#/])/i.test(url)) return null;
    const label = String(record.format || "mp4").replace(/^_/, "").replace(/^\./, "").replace(/\.mp4$/i, "") || "mp4";
    const height = parseInt(label.match(/(\d{3,4})p?/i)?.[1] || "", 10) || null;
    return {
      url,
      ext: "mp4",
      format_type: "mp4",
      protocol: "https",
      format_id: height ? String(height) + "p" : label,
      quality: label,
      height,
      source: "kvs-api",
    };
  }

  function parseKvsVideoId(pageUrl) {
    try {
      const pathname = new URL(pageUrl).pathname;
      const matches = Array.from(pathname.matchAll(/(?:^|\/)(\d{4,})(?=$|[\/._-])/g)).map((match) => match[1]);
      return matches[matches.length - 1] || "";
    } catch {
      const matches = Array.from(String(pageUrl || "").matchAll(/(?:^|\/)(\d{4,})(?=$|[\/._-])/g)).map((match) => match[1]);
      return matches[matches.length - 1] || "";
    }
  }

  async function fetchKvsApiFormats(pageUrl) {
    let origin = "";
    try {
      origin = new URL(pageUrl).origin;
    } catch {
      return [];
    }
    const videoId = parseKvsVideoId(pageUrl);
    if (!origin || !videoId) return [];
    const apiUrl = origin + "/api/videofile.php?video_id=" + encodeURIComponent(videoId) + "&lifetime=8640000";
    try {
      const response = await fetch(apiUrl, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          Referer: pageUrl,
        },
      });
      if (!response.ok) return [];
      const records = await response.json();
      return (Array.isArray(records) ? records : [])
        .map((record) => kvsApiFormat(record, response.url || pageUrl))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function formatPreferenceScore(format) {
    const url = String(format && format.url ? format.url : "");
    const preferredPatternBonus = matchesAnyPattern(url, preferredMediaUrlPatterns) ? 5000 : 0;
    const blockedPatternPenalty = matchesAnyPattern(url, blockedMediaUrlPatterns) ? 20000 : 0;
    const directChromeBonus = isDirectChromeDownloadUrl(url) ? 6000 : 0;
    const source = String(format && format.source || "");
    const seedStaticBonus = source === "seed-static" ? -5000 : 0;
    const domVideoBonus = preferDomVideoSrc && /^(?:dom-video|dom-source|current-src)$/i.test(source) ? 10000 : 0;
    const pageDataBonus = preferPageFormatsBeforeDefault && /^page-(?:data|flashvars)|main-world-flashvars/i.test(source) ? 12000 : 0;
    return (format && Number(format.height || 0) || 0) + preferredPatternBonus + directChromeBonus + seedStaticBonus + domVideoBonus + pageDataBonus - blockedPatternPenalty;
  }

  function isBlockedFormatUrl(url) {
    return Boolean(url && matchesAnyPattern(String(url), blockedMediaUrlPatterns));
  }

  function collectDomVideoFormats(doc, pageUrl) {
    const formats = [];
    const seen = new Set();
    const add = (url, label, source) => {
      const format = mediaFormat(url, label, pageUrl, source);
      if (!format || seen.has(format.url)) return;
      seen.add(format.url);
      formats.push(format);
    };
    try {
      for (const video of Array.from(doc.querySelectorAll("video"))) {
        add(video.currentSrc || video.src || video.getAttribute("src"), video.getAttribute("data-quality") || video.getAttribute("label") || "video", "dom-video");
        for (const source of Array.from(video.querySelectorAll("source"))) {
          add(source.currentSrc || source.src || source.getAttribute("src"), source.getAttribute("label") || source.getAttribute("title") || source.getAttribute("res") || "source", "dom-source");
        }
      }
    } catch {}
    formats.sort((a, b) => formatPreferenceScore(b) - formatPreferenceScore(a));
    return formats.slice(0, 20);
  }

  function mergePreferredFormats(...groups) {
    const seen = new Set();
    const formats = [];
    for (const group of groups) {
      for (const format of Array.isArray(group) ? formatGroup(group) : []) {
        if (!format || !format.url) continue;
        const url = String(format.url || "").replace(/&amp;/g, "&");
        if (!url || seen.has(url)) continue;
        seen.add(url);
        formats.push({ ...format, url });
      }
    }
    formats.sort((a, b) => formatPreferenceScore(b) - formatPreferenceScore(a));
    return formats;
  }

  function formatGroup(group) {
    return Array.isArray(group) ? group : [];
  }

  function isAdLikeTitle(value) {
    return /\b(?:adzone|ads by|juicyads|siteid\s*:\s*\d+|zoneid\s*:\s*\d+|poweredby\.jads\.co)\b/i.test(String(value || ""));
  }

  function pageTitleFromDocument(doc, fallback = "") {
    const candidates = [];
    try {
      for (const selector of selectors.title || []) {
        const value = textFrom(doc, selector);
        if (value) candidates.push(value);
      }
    } catch {}
    try {
      const value = String(doc.title || "").trim();
      if (value) candidates.push(value);
    } catch {}
    candidates.push(fallback);
    return candidates.find((value) => value && !isAdLikeTitle(value)) || fallback || "";
  }

  function flashvarsToFormats(flashvars, pageUrl) {
    const formats = [];
    const add = (url, label) => {
      const format = mediaFormat(url, label, pageUrl, "main-world-flashvars");
      if (format) formats.push(format);
    };
    const data = flashvars && typeof flashvars === "object" ? flashvars : {};
    add(data.video_url, data.video_url_text || "Best MP4");
    add(data.video_alt_url, data.video_alt_url_text || "Alt MP4");
    add(data.video_alt_url2, data.video_alt_url2_text || "Alt 2 MP4");
    add(data.video_alt_url3, data.video_alt_url3_text || "Alt 3 MP4");
    return mergePreferredFormats(formats);
  }

  async function collectMainWorldFlashvarsFormats(tabId, pageUrl) {
    if (!resolvePageFlashvarsInMainWorld || !tabId || !globalThis.chrome?.scripting?.executeScript) return [];
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          const keys = ["video_url", "video_url_text", "video_alt_url", "video_alt_url_text", "video_alt_url2", "video_alt_url2_text", "video_alt_url3", "video_alt_url3_text"];
          const copyFlashvars = (source) => {
            if (!source || typeof source !== "object" || typeof source.video_url !== "string") return null;
            const out = {};
            keys.forEach((key) => {
              const value = source[key];
              if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = String(value);
            });
            return out.video_url ? out : null;
          };
          const found = [];
          const add = (source) => {
            const item = copyFlashvars(source);
            if (item && !found.some((existing) => existing.video_url === item.video_url && existing.video_alt_url === item.video_alt_url)) found.push(item);
          };
          add(window.flashvars);
          try {
            Object.keys(window).forEach((key) => {
              let value = null;
              try { value = window[key]; } catch { return; }
              add(value);
            });
          } catch {}
          return found;
        },
      });
      const flashvarsItems = results && results[0] && results[0].result;
      return mergePreferredFormats(...(Array.isArray(flashvarsItems) ? flashvarsItems : [flashvarsItems]).map((item) => flashvarsToFormats(item, pageUrl)));
    } catch {
      return [];
    }
  }

  function nhplayerFrameMediaFormat(mediaUrl, playerUrl) {
    const format = mediaFormat(mediaUrl, "nhplayer-mp4", playerUrl, "nhplayer-frame");
    if (!format) return null;
    try {
      format.refererUrl = new URL(playerUrl).origin + "/";
    } catch {
      format.refererUrl = "https://nhplayer.com/";
    }
    format.requiresReferer = true;
    if (chromeDownloadWithHeaderRules || tabInitiatedDownloadWithHeaderRules) {
      format.useDownloadHeaderRules = true;
    }
    return format;
  }

  async function collectNhplayerFrameFormats(tabId) {
    if (!resolveNhplayerInPageFrame || !fetchNhplayerPlayer || !tabId || !globalThis.chrome?.scripting?.executeScript) return [];
    try {
      console.log("[site-adapter] nhplayer-frame-resolve-start", { tabId });
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN",
        func: async () => {
          const isNhplayerFrame = () => {
            try { return /(^|\.)nhplayer\.com$/i.test(location.hostname || ""); } catch { return false; }
          };
          if (!isNhplayerFrame()) return null;
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const isMediaUrl = (value) => /^https?:\/\/[^\s"'<>]+\.(?:mp4|m4v|webm|m3u8)(?:$|[?#])/i.test(String(value || ""));
          const urlsFrom = (value, seen = new Set()) => {
            const urls = [];
            const add = (candidate) => {
              const text = String(candidate || "").trim();
              if (!isMediaUrl(text) || seen.has(text)) return;
              seen.add(text);
              urls.push(text);
            };
            if (!value) return urls;
            if (typeof value === "string") {
              add(value);
              return urls;
            }
            if (Array.isArray(value)) {
              value.forEach((item) => urlsFrom(item, seen).forEach(add));
              return urls;
            }
            if (typeof value === "object") {
              for (const key of ["url", "file", "src", "source", "videoUrl", "video_url", "downloadUrl", "download_url"]) {
                add(value[key]);
              }
              for (const key of ["sources", "formats", "videos", "items", "result", "data"]) {
                urlsFrom(value[key], seen).forEach(add);
              }
            }
            return urls;
          };
          const firstDatasetValue = (node) => {
            try {
              const keys = node && node.dataset ? Object.keys(node.dataset) : [];
              return keys.length ? String(node.dataset[keys[0]] || "") : "";
            } catch {
              return "";
            }
          };
          const nhplayerProofOfWork = async (challenge) => {
            const encoder = new TextEncoder();
            for (let nonce = 0; nonce < 10000000; nonce += 1) {
              const value = nonce.toString(16);
              try {
                const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(challenge || "") + value));
                if (new Uint8Array(digest)[0] === 0) return value;
              } catch {
                return "";
              }
              if (nonce > 0 && nonce % 50000 === 0) await sleep(0);
            }
            return "";
          };
          const nhplayerFingerprintBase64 = () => {
            const nav = typeof navigator !== "undefined" ? navigator : {};
            const screenInfo = typeof screen !== "undefined" ? screen : {};
            const data = {
              t: 1200,
              mm: [[110, 210, 120], [150, 230, 260], [190, 250, 520]],
              tm: [],
              cl: [[220, 300, 820]],
              kp: [],
              sc: [],
              i: 1,
              mc: 3,
              tc: 0,
              cc: 1,
              kc: 0,
              b: {
                sw: Number(screenInfo.width) || 0,
                sh: Number(screenInfo.height) || 0,
                aw: Number(screenInfo.availWidth) || 0,
                ah: Number(screenInfo.availHeight) || 0,
                cd: Number(screenInfo.colorDepth) || 24,
                pd: Number(screenInfo.pixelDepth) || 24,
                tz: new Date().getTimezoneOffset(),
                hc: Number(nav.hardwareConcurrency) || 0,
                dm: Number(nav.deviceMemory) || 0,
                pl: String(nav.platform || ""),
                lang: String(nav.language || ""),
                langs: Array.isArray(nav.languages) ? nav.languages.join(",") : "",
                dpr: typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
                ww: typeof innerWidth === "number" ? innerWidth : 0,
                wh: typeof innerHeight === "number" ? innerHeight : 0,
                touch: ("ontouchstart" in globalThis) || Number(nav.maxTouchPoints || 0) > 0,
                pdf: Boolean(nav.pdfViewerEnabled),
                fonts: 0,
              },
            };
            try {
              return btoa(JSON.stringify(data));
            } catch {
              return "";
            }
          };
          const readPageUrls = () => {
            const urls = [];
            const add = (candidate) => urlsFrom(candidate).forEach((url) => {
              if (!urls.includes(url)) urls.push(url);
            });
            try {
              document.querySelectorAll("video,source").forEach((node) => {
                add(node.currentSrc);
                add(node.src);
              });
            } catch {}
            try {
              const player = window._pC;
              add(player && player.result);
              add(player && player.video);
              add(player && player.videoUrl);
              add(player && player.sources);
              add(player && player.formats);
            } catch {}
            return urls;
          };
          const invokePlayerFetch = async () => {
            let player = null;
            let values = null;
            try {
              player = window._pC;
              values = window._pV || {};
            } catch {}
            if (!player || typeof player !== "object" || !values || !values.vid) return [];
            for (const name of ["fetch", "getVideoUrl", "resolve", "load"]) {
              if (typeof player[name] !== "function") continue;
              try {
                const result = player[name].call(player, values.vid, values.ct || "", values.pid || "", values.st || "");
                const awaited = result && typeof result.then === "function" ? await result : result;
                const urls = urlsFrom(awaited).concat(readPageUrls());
                if (urls.length) return urls;
              } catch {}
            }
            return readPageUrls();
          };
          const resolveFromPageConfig = async () => {
            let values = null;
            try {
              values = window._pV || null;
            } catch {}
            if (!values || !values.vid) return [];
            try {
              const corePath = document.querySelector('script[src*="player-core-v2.php"]')?.getAttribute("src") || "";
              if (!corePath) return [];
              const coreResponse = await fetch(new URL(corePath, location.href).toString(), {
                headers: {
                  Accept: "application/javascript,text/javascript,*/*;q=0.8",
                },
                credentials: "include",
                cache: "no-store",
              });
              if (!coreResponse || !coreResponse.ok) return [];
              const core = await coreResponse.text();
              const ids = Array.from(String(core || "").matchAll(/getElementById\('([^']+)'\)/g)).map((match) => match[1]);
              if (ids.length < 5) return [];
              const p1 = firstDatasetValue(document.getElementById(ids[0]));
              const p2 = String(document.getElementById(ids[1])?.value || "");
              const p3 = firstDatasetValue(document.getElementById(ids[2]));
              const p4Node = document.getElementById(ids[3]);
              const p4 = String((p4Node?.content?.querySelector("p") || p4Node?.querySelector?.("p"))?.textContent || "").trim();
              const t = firstDatasetValue(document.getElementById(ids[4]));
              const sc = String(core || "").match(/var\s+_[A-Za-z0-9]+\s*=\s*'([^']+\.[^']+)'/)?.[1] || "";
              const rid = String(core || "").match(/var\s+_[A-Za-z0-9]+\s*=\s*'([a-f0-9]{16,})'/i)?.[1] || "";
              if (!p1 || !p2 || !p3 || !p4 || !t || !sc || !rid) return [];
              const pow = await nhplayerProofOfWork(p1 + p2 + p3 + p4 + t);
              if (!pow) return [];
              const endpoint = new URL("/get-video-url-v2.php", location.href);
              endpoint.search = new URLSearchParams({
                vid: String(values.vid || ""),
                c: String(values.ct || values.c || ""),
                p1,
                p2,
                p3,
                p4,
                t,
                sc,
                rid,
                fp: nhplayerFingerprintBase64(),
                df: "",
                pow,
                pid: String(values.pid || ""),
                st: String(values.st || ""),
              }).toString();
              const response = await fetch(endpoint.toString(), {
                headers: {
                  Accept: "application/json,text/plain,*/*",
                  "X-Requested-With": "XMLHttpRequest",
                },
                credentials: "include",
                cache: "no-store",
              });
              if (!response || !response.ok) return [];
              const data = await response.json().catch(() => null);
              return urlsFrom(data).concat(readPageUrls());
            } catch {
              return [];
            }
          };
          let fetchAttempted = false;
          for (let index = 0; index < 18; index += 1) {
            const existing = readPageUrls();
            if (existing.length) return { urls: existing, playerUrl: location.href, reason: "page-state" };
            if (!fetchAttempted && index >= 2) {
              fetchAttempted = true;
              const fetched = await invokePlayerFetch();
              if (fetched.length) return { urls: fetched, playerUrl: location.href, reason: "player-fetch" };
              const resolved = await resolveFromPageConfig();
              if (resolved.length) return { urls: resolved, playerUrl: location.href, reason: "page-config-resolver" };
            }
            await sleep(500);
          }
          return { urls: [], playerUrl: location.href, reason: "no-frame-media" };
        },
      });
      console.log("[site-adapter] nhplayer-frame-results", {
        frames: Array.isArray(results) ? results.length : 0,
        candidateCounts: (Array.isArray(results) ? results : []).filter((item) => item && item.result && Array.isArray(item.result.urls)).map((item) => item.result.urls.length).join(","),
      });
      const formats = [];
      for (const item of Array.isArray(results) ? results : []) {
        const result = item && item.result;
        const playerUrl = result && result.playerUrl ? String(result.playerUrl) : "";
        for (const url of Array.isArray(result?.urls) ? result.urls : []) {
          const format = nhplayerFrameMediaFormat(url, playerUrl || "https://nhplayer.com/");
          if (format) formats.push(format);
        }
      }
      const merged = mergePreferredFormats(formats);
      if (merged.length) console.log("[site-adapter] nhplayer-frame-format-ready", { count: merged.length, host: new URL(merged[0].url).hostname });
      return merged;
    } catch (error) {
      console.log("[site-adapter] nhplayer-frame-resolve-error", { message: error?.message || String(error) });
      return [];
    }
  }

  async function ensureNhplayerProbeFrame(tabId, playerUrl) {
    if (!resolveNhplayerInPageFrame || !fetchNhplayerPlayer || !tabId || !isNhplayerUrl(playerUrl) || !globalThis.chrome?.scripting?.executeScript) return false;
    try {
      const resolvedPlayerUrl = absoluteUrl(playerUrl, playerUrl);
      console.log("[site-adapter] nhplayer-frame-ensure-start", { tabId, playerUrl: resolvedPlayerUrl });
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [resolvedPlayerUrl],
        func: (src) => {
          try {
            const id = "serp-nhplayer-probe-frame";
            let frame = document.getElementById(id);
            if (!frame) {
              frame = document.createElement("iframe");
              frame.id = id;
              frame.setAttribute("data-serp-probe", "nhplayer");
              frame.allow = "autoplay; fullscreen";
              frame.referrerPolicy = "origin-when-cross-origin";
              frame.style.position = "fixed";
              frame.style.left = "-2px";
              frame.style.bottom = "-2px";
              frame.style.width = "1px";
              frame.style.height = "1px";
              frame.style.opacity = "0.01";
              frame.style.pointerEvents = "none";
              frame.style.border = "0";
              (document.documentElement || document.body).appendChild(frame);
            }
            if (frame.src !== src) frame.src = src;
            return { ok: true, src: frame.src || src };
          } catch (error) {
            return { ok: false, error: error && error.message ? error.message : String(error) };
          }
        },
      });
      const ok = Array.isArray(results) && results.some((item) => item && item.result && item.result.ok);
      console.log("[site-adapter] nhplayer-frame-ensure-done", { ok });
      await new Promise((resolve) => setTimeout(resolve, 4500));
      return ok;
    } catch (error) {
      console.log("[site-adapter] nhplayer-frame-ensure-error", { message: error?.message || String(error) });
      return false;
    }
  }

  async function collectNestedNhplayerProbeUrls(pageUrl, referer = "", depth = 0, seen = new Set()) {
    if (!resolveNhplayerInPageFrame || !fetchNhplayerPlayer || depth > 2 || !/^https?:\/\//i.test(String(pageUrl || ""))) return [];
    const currentUrl = absoluteUrl(pageUrl, referer || pageUrl);
    if (!currentUrl || seen.has(currentUrl)) return [];
    seen.add(currentUrl);
    if (isNhplayerUrl(currentUrl)) return [currentUrl];
    try {
      const response = await fetchWithTimeout(currentUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: referer || currentUrl,
        },
      }, 12000);
      if (!response || !response.ok) return [];
      const resolvedUrl = response.url || currentUrl;
      const html = await response.text();
      const urls = [];
      for (const candidateUrl of collectPlayerDocumentUrls(html, resolvedUrl)) {
        if (isNhplayerUrl(candidateUrl)) {
          if (!urls.includes(candidateUrl)) urls.push(candidateUrl);
          continue;
        }
        for (const nestedUrl of await collectNestedNhplayerProbeUrls(candidateUrl, resolvedUrl, depth + 1, seen)) {
          if (!urls.includes(nestedUrl)) urls.push(nestedUrl);
        }
      }
      if (urls.length) console.log("[site-adapter] nhplayer-nested-probe-urls", { source: resolvedUrl, count: urls.length, first: urls[0] });
      return urls.slice(0, 4);
    } catch (error) {
      console.log("[site-adapter] nhplayer-nested-probe-error", { source: currentUrl, message: error?.message || String(error) });
      return [];
    }
  }

  function collectStaticMediaFormats(html, pageUrl) {
    const formats = [];
    const seen = new Set();
    const add = (url, label, source) => {
      const format = mediaFormat(url, label, pageUrl, source);
      if (!format || seen.has(format.url)) return;
      seen.add(format.url);
      formats.push(format);
    };

    if (!String(html || "").trim()) {
      for (const directUrl of staticMediaUrls) {
        add(directUrl, "direct", "seed-static");
      }
    }
    for (const match of String(html || "").matchAll(/<source\b[^>]*>/gi)) {
      const tag = match[0];
      add(attr(tag, "src"), attr(tag, "label") || attr(tag, "title"), "source");
    }
    for (const match of String(html || "").matchAll(/<meta\b[^>]*(?:property|name)=["'](?:og:video|og:video:secure_url|og:video:url|twitter:player:stream)["'][^>]*>/gi)) {
      add(attr(match[0], "content"), "meta", "meta");
    }
    for (const match of String(html || "").matchAll(/https?:[^"'\\\s<>]+(?:\.(?:mp4|m4v|webm|flv|m3u8)[^"'\\\s<>]*|\/manifest\/video\.mpd[^"'\\\s<>]*)/gi)) {
      add(match[0], "", "html");
    }
    for (const match of String(html || "").matchAll(/https?:\\\/\\\/[^"'\s<>]+(?:\.(?:mp4|m4v|webm|flv|m3u8)[^"'\s<>]*|\\\/manifest\\\/video\.mpd[^"'\s<>]*)/gi)) {
      add(match[0], "", "html-escaped");
    }
    for (const match of String(html || "").matchAll(/https?:[^"'\\\s<>]+\/api\/hls\/serve\?token=[^"'\\\s<>]+/gi)) {
      add(match[0], "hls", "hls-api");
    }
    for (const match of String(html || "").matchAll(/https?:\\\/\\\/[^"'\s<>]+\\\/api\\\/hls\\\/serve\?token=[^"'\s<>]+/gi)) {
      add(match[0], "hls", "hls-api-escaped");
    }
    if (extractMediaDefinitions) {
      for (const match of String(html || "").matchAll(/"format"\s*:\s*"(hls|mp4)"[^{}]{0,500}?"videoUrl"\s*:\s*"(https?:[^"<>]+?)"/gi)) {
        add(match[2], match[1], "media-definition");
      }
      for (const match of String(html || "").matchAll(/"videoUrl"\s*:\s*"(https?:[^"<>]+?\/media\/(?:hls|mp4)\/[^"<>]*)"/gi)) {
        add(match[1], /\/media\/hls\//i.test(match[1]) ? "hls" : "mp4", "media-definition");
      }
    }
    for (const match of String(html || "").matchAll(/https?:[^"'\\\s<>]+\/[^"'\\\s<>]*\/cf-master\.[^"'\\\s<>]+\.txt[^"'\\\s<>]*/gi)) {
      add(match[0], "hls", "aurorapath");
    }
    for (const match of String(html || "").matchAll(/https?:\\\/\\\/[^"'\s<>]+\\\/[^"'\s<>]*\\\/cf-master\.[^"'\s<>]+\.txt[^"'\s<>]*/gi)) {
      add(match[0], "hls", "aurorapath-escaped");
    }
    for (const match of String(html || "").matchAll(/https?:[^"'\\\s<>]+\/(?:file|file2|quality2)\/[^"'\\\s<>]+/gi)) {
      add(match[0], "hls", "hls-path");
    }
    for (const match of String(html || "").matchAll(/https?:\\\/\\\/[^"'\s<>]+\\\/(?:file|file2|quality2)\\\/[^"'\s<>]+/gi)) {
      add(match[0], "hls", "hls-path-escaped");
    }

    formats.sort((a, b) => formatPreferenceScore(b) - formatPreferenceScore(a));
    return formats.slice(0, 20);
  }

  function collectXiaoshenkePlayerFormats(html, pageUrl) {
    const formats = [];
    const seen = new Set();
    const add = (url, label) => {
      const format = mediaFormat(url, label, pageUrl, "xiaoshenke-player");
      if (!format || seen.has(format.url)) return;
      format.refererUrl = mediaRefererUrl(pageUrl);
      format.requiresReferer = true;
      seen.add(format.url);
      formats.push(format);
    };

    let host = "";
    try { host = new URL(pageUrl).hostname.replace(/^www\./i, ""); } catch {}
    if (!/(^|\.)xiaoshenke\.net$/i.test(host)) return formats;

    const source = String(html || "");
    const reversedId = source.match(/\bvar\s+id\s*=\s*["']([^"']+)["']\.split\(["']{2}\)\.reverse\(\)\.join\(["']{2}\)/)?.[1] || "";
    const plainId = source.match(/\bvar\s+id\s*=\s*["']([^"']+)["']\s*;/)?.[1] || "";
    const id = reversedId ? reversedId.split("").reverse().join("") : plainId;
    const qualityValue = source.match(/\bvar\s+quality\s*=\s*parseInt\(["']?([^"')]+)["']?\)/)?.[1] || "";
    const qualityMask = parseInt(qualityValue, 10) || 0;
    if (!id || !qualityMask) return formats;

    const qualities = [];
    if (qualityMask & 1) qualities.push(360);
    if (qualityMask & 2) qualities.push(480);
    if (qualityMask & 4) qualities.push(720);
    if (qualityMask & 8) qualities.push(1080);
    const origin = (() => {
      try { return new URL(pageUrl).origin; } catch { return "https://xiaoshenke.net"; }
    })();
    for (const quality of qualities) add(`${origin}/vid/${id}/${quality}`, `${quality}p`);
    formats.sort((a, b) => (b.height || 0) - (a.height || 0));
    return formats.slice(0, 20);
  }

  function collectPlayerDocumentUrls(html, pageUrl) {
    const urls = [];
    const seen = new Set();
    const add = (url) => {
      const absolute = absoluteUrl(url, pageUrl);
      if (!/^https?:\/\//i.test(absolute || "")) return;
      let parsedAbsolute = null;
      try {
        parsedAbsolute = new URL(absolute);
        for (const key of ["host", "url", "src", "embed", "file"]) {
          const nestedUrl = parsedAbsolute.searchParams.get(key);
          if (nestedUrl && nestedUrl !== absolute) add(nestedUrl);
        }
      } catch {}
      const pathname = parsedAbsolute?.pathname || "";
      if (/\.(?:css|js|mjs|map|svg|png|jpe?g|gif|webp|ico)(?:[?#]|$)/i.test(pathname)) return;
      if (/\/player\.php$/i.test(pathname) && !parsedAbsolute?.search) return;
      const looksLikeEmbedRoute =
        /\/(?:e|d)\/[^/?#]+(?:$|[?#])/i.test(pathname) ||
        /\/(?:embed|player|iframe|video|watch)(?:\/|$)/i.test(pathname);
      if (
        !/(?:\/|%2f)(?:player|embed|iframe)(?:\/|%2f|[._-])|(?:player|embed|iframe)/i.test(absolute) &&
        !isKnownHosterUrl(absolute) &&
        !looksLikeEmbedRoute
      ) return;
      if (seen.has(absolute)) return;
      seen.add(absolute);
      urls.push(absolute);
    };

    for (const match of String(html || "").matchAll(/<iframe\b[^>]*>/gi)) {
      add(attr(match[0], "src"));
      add(attr(match[0], "data-src"));
    }
    for (const match of String(html || "").matchAll(/<meta\b[^>]*(?:itemprop|property|name)=["'](?:embedURL|embedUrl|og:video:url|og:video)["'][^>]*>/gi)) {
      add(attr(match[0], "content"));
    }
    for (const match of String(html || "").matchAll(/<[^>]+\bdata-embed-url\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi)) {
      add(match[1] || match[2] || match[3]);
    }
    for (const match of String(html || "").matchAll(/\bdata-link\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
      add(match[1] || match[2]);
    }
    for (const match of String(html || "").matchAll(/\bdata-id\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
      add(match[1] || match[2]);
    }
    for (const match of String(html || "").matchAll(/setIFrameSrc\s*\([^)]*?["'](https?:[^"']+)["']/gi)) {
      add(match[1]);
    }
    for (const match of String(html || "").matchAll(/<link\b[^>]*>/gi)) {
      const tag = match[0];
      const rel = attr(tag, "rel");
      const as = attr(tag, "as");
      const href = attr(tag, "href");
      if (/prefetch|preload/i.test(rel) || /document/i.test(as) || /(?:player|embed|iframe)/i.test(href)) add(href);
    }
    for (const match of String(html || "").matchAll(/["'](?:embedUrl|embed_url|playerUrl|player_url|iframe_url)["']\s*:\s*["']([^"']+)["']/gi)) {
      add(match[1]);
    }
    for (const match of String(html || "").matchAll(/\b(?:const|let|var)\s+currentURL\s*=\s*["'](https?:[^"']+)["']/gi)) {
      add(match[1]);
    }
    for (const match of String(html || "").matchAll(/(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:[^"']+)["']/gi)) {
      add(match[1]);
    }
    for (const match of String(html || "").matchAll(/location\.replace\(\s*["'](https?:[^"']+)["']\s*\)/gi)) {
      add(match[1]);
    }
    for (const match of String(html || "").matchAll(/https?:[^"'\\\s<>]+\/(?:player|embed|iframe)\/[^"'\\\s<>]*/gi)) {
      add(match[0]);
    }
    for (const match of String(html || "").matchAll(/https?:\\\/\\\/[^"'\s<>]+\/(?:player|embed|iframe)\/[^"'\s<>]*/gi)) {
      add(match[0]);
    }
    for (const match of String(html || "").matchAll(/https?:[^"'\\\s<>]+\/(?:video)\/[^"'\\\s<>]*/gi)) {
      add(match[0]);
    }
    for (const match of String(html || "").matchAll(/https?:\\\/\\\/[^"'\s<>]+\/(?:video)\/[^"'\s<>]*/gi)) {
      add(match[0]);
    }
    for (const match of String(html || "").matchAll(/https?:[^"'\\\s<>)]+/gi)) {
      if (isKnownHosterUrl(match[0])) add(match[0]);
    }
    return urls.slice(0, 6);
  }

  function playerUrlPriority(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./i, "");
      const pathname = parsed.pathname || "";
      if (/(^|\.)(luluvid\.com|luluvids\.top|luluvdoo\.com|luluvdo\.com|lulustream\.com)$/i.test(host)) return 120;
      if (/(^|\.)nhplayer\.com$/i.test(host)) return 119;
      if (/(^|\.)eporner\.com$/i.test(host)) return 118;
      if (/\/(?:embed|player|iframe)(?:\/|$)/i.test(pathname)) return 115;
      if (/(^|\.)(vidara\.(?:to|so)|byseraguci\.com|byselapuix\.com|bysesayeveum\.com|q8y5z\.com)$/i.test(host)) return 110;
      if (/(^|\.)(voe\.sx|streamruby\.(?:com|net)|rubyvidhub\.com|seekplays\.com)$/i.test(host)) return 100;
      if (/(^|\.)(streamtape\.(?:com|to|xyz)|dood\.(?:watch|stream|so|la)|vsonic\.click)$/i.test(host)) return 90;
      if (/(^|\.)(hqq\.tv|netu\.tv)$/i.test(host)) return 80;
      if (/(^|\.)(playmogo\.com|myvidplay\.com)$/i.test(host)) return 20;
      if (/(^|\.)flaswish\.com$/i.test(host)) return 5;
      return 60;
    } catch {
      return 0;
    }
  }

  function isUsablePlayerUrl(url, pageUrl = "") {
    const raw = String(url || "").trim();
    if (!raw) return false;
    if (/[{]video_id[}]|window\.location\.host|['"]\s*\+\s*window\.location/i.test(raw)) return false;
    if (/\.(?:css|js|mjs|map|svg|png|jpe?g|gif|webp|ico)(?:[?#]|$)/i.test(raw)) return false;
    if (/tsyndicate\.com|doubleclick|googlesyndication|adservice|juicyads|jads\.co|promos\.camsoda\.com|magsrv\.com|rmhfrtnd\.com/i.test(raw)) return false;
    try {
      const absolute = absoluteUrl(raw, pageUrl);
      if (!/^https?:\/\//i.test(absolute)) return false;
      if (/\.(?:css|js|mjs|map|svg|png|jpe?g|gif|webp|ico)(?:[?#]|$)/i.test(absolute)) return false;
      if (/tsyndicate\.com|doubleclick|googlesyndication|adservice|juicyads|jads\.co|promos\.camsoda\.com|magsrv\.com|rmhfrtnd\.com/i.test(absolute)) return false;
      if (/\.(?:mp4|m4v|webm|m3u8)(?:[?#]|$)/i.test(absolute)) return true;
      if (isKnownHosterUrl(absolute)) return true;
      const pathname = new URL(absolute).pathname;
      return /(?:player|embed|iframe|video|watch)/i.test(pathname) || /\/(?:e|d)\/[^/?#]+(?:$|[?#])/i.test(pathname);
    } catch {
      return false;
    }
  }

  function pickPreferredPlayerUrl(urls, currentUrl = "") {
    const candidates = Array.isArray(urls) ? urls.filter(Boolean) : [];
    const filteredCandidates = candidates.filter((candidate) => isUsablePlayerUrl(candidate));
    const safeCurrentUrl = isUsablePlayerUrl(currentUrl) ? currentUrl : "";
    if (!filteredCandidates.length) return safeCurrentUrl;
    let best = safeCurrentUrl || filteredCandidates[0] || "";
    let bestScore = playerUrlPriority(best);
    for (const candidate of filteredCandidates) {
      const score = playerUrlPriority(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  function playerUrlStaticFormats(playerUrl, pageUrl) {
    const formats = [];
    try {
      const parsed = new URL(playerUrl);
      if (/\/clean-tube-player\/public\/player-x\.php$/i.test(parsed.pathname)) {
        const encoded = parsed.searchParams.get("q") || "";
        const decoded = encoded
          ? (typeof atob === "function"
              ? atob(encoded)
              : (typeof Buffer !== "undefined" ? Buffer.from(encoded, "base64").toString("utf8") : ""))
          : "";
        const tag = decoded ? new URLSearchParams(decoded).get("tag") : "";
        for (const format of collectStaticMediaFormats(tag || decoded, pageUrl || playerUrl)) {
          if (format && format.format_type !== "hls") {
            format.refererUrl = playerUrl;
            format.requiresReferer = true;
          }
          formats.push(format);
        }
      }
      if (/(^|\.)xiaoshenke\.net$/i.test(parsed.hostname)) {
        const parts = parsed.pathname.split("/").filter(Boolean);
        const videoIndex = parts.indexOf("video");
        const encodedId = videoIndex >= 0 ? parts[videoIndex + 1] : "";
        const qualityMask = parseInt(parts[videoIndex + 2] || "", 10) || 0;
        if (encodedId && qualityMask) {
          const id = encodedId.split("").reverse().join("");
          const qualities = [];
          if (qualityMask & 1) qualities.push(360);
          if (qualityMask & 2) qualities.push(480);
          if (qualityMask & 4) qualities.push(720);
          if (qualityMask & 8) qualities.push(1080);
          for (const quality of qualities) {
            const format = mediaFormat(`${parsed.origin}/vid/${id}/${quality}`, `${quality}p`, pageUrl || playerUrl, "xiaoshenke-player-url");
            if (format) {
              format.refererUrl = playerUrl;
              format.requiresReferer = true;
            }
            if (format) formats.push(format);
          }
        }
      }
      if (/(^|\.)xtremestream\.xyz$/i.test(parsed.hostname)) {
        const data = parsed.searchParams.get("data") || parsed.searchParams.get("v") || "";
        if (data) {
          const apiUrl = new URL("/player/xs1.php?data=" + encodeURIComponent(data), parsed.origin);
          const format = mediaFormat(apiUrl.toString(), "hls", pageUrl || playerUrl, "xtremestream");
          if (format) {
            format.refererUrl = playerUrl;
            format.requiresReferer = true;
          }
          if (format) formats.push(format);
        }
      }
    } catch {}
    return formats;
  }

  function applyCleanTubePlayerReferer(formats, playerUrl) {
    if (!Array.isArray(formats) || !playerUrl || !/\/clean-tube-player\/public\/player-x\.php(?:$|[?#])/i.test(playerUrl)) return formats;
    return formats.map((format) => {
      if (!format || format.format_type === "hls") return format;
      return {
        ...format,
        refererUrl: format.refererUrl || playerUrl,
        requiresReferer: true,
      };
    });
  }

  function collectStaticPlayerUrlFormats(html, pageUrl) {
    const formats = [];
    const seen = new Set();
    const addFormats = (items) => {
      for (const format of items || []) {
        if (!format || !format.url || seen.has(format.url)) continue;
        seen.add(format.url);
        formats.push(format);
      }
    };
    for (const playerUrl of collectPlayerDocumentUrls(html, pageUrl)) {
      addFormats(playerUrlStaticFormats(playerUrl, pageUrl));
    }
    formats.sort((a, b) => (b.height || 0) - (a.height || 0));
    return formats.slice(0, 20);
  }

  async function fetchKnownHosterFormats(playerUrl, pageUrl) {
    const formats = [];
    const seen = new Set();
    const add = (url, label, source) => {
      const format = mediaFormat(url, label, playerUrl || pageUrl, source);
      if (!format || seen.has(format.url)) return;
      seen.add(format.url);
      formats.push(format);
    };

    let parsed;
    try {
      parsed = new URL(playerUrl);
    } catch {
      return formats;
    }
    const host = parsed.hostname.replace(/^www\./i, "");
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const filecode = pathParts[0] === "e" && pathParts[1] ? pathParts[1] : (pathParts.pop() || "");

    async function decryptSeekplaysHex(hex) {
      const bytes = new Uint8Array(String(hex || "").match(/[\da-f]{2}/gi).map((value) => parseInt(value, 16)));
      const key = new TextEncoder().encode("kiemtienmua911ca");
      const iv = new TextEncoder().encode("1234567890oiuytr");
      const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["decrypt"]);
      const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, bytes);
      return new TextDecoder().decode(decrypted);
    }

    function md5Hex(input) {
      function add32(a, b) { return (a + b) & 0xffffffff; }
      function cmn(q, a, b, x, s, t) { return add32(((add32(add32(a, q), add32(x, t)) << s) | (add32(add32(a, q), add32(x, t)) >>> (32 - s))), b); }
      function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
      function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
      function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
      function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
      function md5cycle(state, block) {
        let [a, b, c, d] = state;
        a = ff(a, b, c, d, block[0], 7, -680876936); d = ff(d, a, b, c, block[1], 12, -389564586); c = ff(c, d, a, b, block[2], 17, 606105819); b = ff(b, c, d, a, block[3], 22, -1044525330);
        a = ff(a, b, c, d, block[4], 7, -176418897); d = ff(d, a, b, c, block[5], 12, 1200080426); c = ff(c, d, a, b, block[6], 17, -1473231341); b = ff(b, c, d, a, block[7], 22, -45705983);
        a = ff(a, b, c, d, block[8], 7, 1770035416); d = ff(d, a, b, c, block[9], 12, -1958414417); c = ff(c, d, a, b, block[10], 17, -42063); b = ff(b, c, d, a, block[11], 22, -1990404162);
        a = ff(a, b, c, d, block[12], 7, 1804603682); d = ff(d, a, b, c, block[13], 12, -40341101); c = ff(c, d, a, b, block[14], 17, -1502002290); b = ff(b, c, d, a, block[15], 22, 1236535329);
        a = gg(a, b, c, d, block[1], 5, -165796510); d = gg(d, a, b, c, block[6], 9, -1069501632); c = gg(c, d, a, b, block[11], 14, 643717713); b = gg(b, c, d, a, block[0], 20, -373897302);
        a = gg(a, b, c, d, block[5], 5, -701558691); d = gg(d, a, b, c, block[10], 9, 38016083); c = gg(c, d, a, b, block[15], 14, -660478335); b = gg(b, c, d, a, block[4], 20, -405537848);
        a = gg(a, b, c, d, block[9], 5, 568446438); d = gg(d, a, b, c, block[14], 9, -1019803690); c = gg(c, d, a, b, block[3], 14, -187363961); b = gg(b, c, d, a, block[8], 20, 1163531501);
        a = gg(a, b, c, d, block[13], 5, -1444681467); d = gg(d, a, b, c, block[2], 9, -51403784); c = gg(c, d, a, b, block[7], 14, 1735328473); b = gg(b, c, d, a, block[12], 20, -1926607734);
        a = hh(a, b, c, d, block[5], 4, -378558); d = hh(d, a, b, c, block[8], 11, -2022574463); c = hh(c, d, a, b, block[11], 16, 1839030562); b = hh(b, c, d, a, block[14], 23, -35309556);
        a = hh(a, b, c, d, block[1], 4, -1530992060); d = hh(d, a, b, c, block[4], 11, 1272893353); c = hh(c, d, a, b, block[7], 16, -155497632); b = hh(b, c, d, a, block[10], 23, -1094730640);
        a = hh(a, b, c, d, block[13], 4, 681279174); d = hh(d, a, b, c, block[0], 11, -358537222); c = hh(c, d, a, b, block[3], 16, -722521979); b = hh(b, c, d, a, block[6], 23, 76029189);
        a = hh(a, b, c, d, block[9], 4, -640364487); d = hh(d, a, b, c, block[12], 11, -421815835); c = hh(c, d, a, b, block[15], 16, 530742520); b = hh(b, c, d, a, block[2], 23, -995338651);
        a = ii(a, b, c, d, block[0], 6, -198630844); d = ii(d, a, b, c, block[7], 10, 1126891415); c = ii(c, d, a, b, block[14], 15, -1416354905); b = ii(b, c, d, a, block[5], 21, -57434055);
        a = ii(a, b, c, d, block[12], 6, 1700485571); d = ii(d, a, b, c, block[3], 10, -1894986606); c = ii(c, d, a, b, block[10], 15, -1051523); b = ii(b, c, d, a, block[1], 21, -2054922799);
        a = ii(a, b, c, d, block[8], 6, 1873313359); d = ii(d, a, b, c, block[15], 10, -30611744); c = ii(c, d, a, b, block[6], 15, -1560198380); b = ii(b, c, d, a, block[13], 21, 1309151649);
        a = ii(a, b, c, d, block[4], 6, -145523070); d = ii(d, a, b, c, block[11], 10, -1120210379); c = ii(c, d, a, b, block[2], 15, 718787259); b = ii(b, c, d, a, block[9], 21, -343485551);
        state[0] = add32(a, state[0]); state[1] = add32(b, state[1]); state[2] = add32(c, state[2]); state[3] = add32(d, state[3]);
      }
      function md5blk(s) {
        const md5blks = [];
        for (let i = 0; i < 64; i += 4) md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
        return md5blks;
      }
      const str = unescape(encodeURIComponent(String(input || "")));
      const n = str.length;
      const state = [1732584193, -271733879, -1732584194, 271733878];
      let i;
      for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(str.substring(i - 64, i)));
      const tail = Array(16).fill(0);
      const rest = str.substring(i - 64);
      for (i = 0; i < rest.length; i += 1) tail[i >> 2] |= rest.charCodeAt(i) << ((i % 4) << 3);
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) { md5cycle(state, tail); tail.fill(0); }
      tail[14] = n * 8;
      md5cycle(state, tail);
      const hex = "0123456789abcdef";
      return state.map((value) => {
        let out = "";
        for (let j = 0; j < 4; j += 1) out += hex[(value >> (j * 8 + 4)) & 0x0f] + hex[(value >> (j * 8)) & 0x0f];
        return out;
      }).join("");
    }

    function decodeBase64(value) {
      if (typeof atob === "function") return atob(value);
      if (typeof Buffer !== "undefined") return Buffer.from(value, "base64").toString("utf8");
      return "";
    }

    async function decryptPrvsMediaString(media, keySeed) {
      const keyBytes = new TextEncoder().encode(md5Hex(keySeed));
      const counter = keyBytes.slice(0, 16);
      const input = String(media || "");
      const bytes = new Uint8Array(input.length);
      for (let index = 0; index < input.length; index += 1) bytes[index] = input.charCodeAt(index) & 0xff;
      const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CTR" }, false, ["decrypt"]);
      const decrypted = await crypto.subtle.decrypt({ name: "AES-CTR", counter, length: 128 }, cryptoKey, bytes);
      return JSON.parse(new TextDecoder().decode(decrypted));
    }

    if (/(^|\.)seekplays\.com$/i.test(host)) {
      const seekplaysId = parsed.hash.replace(/^#/, "") || parsed.searchParams.get("id") || filecode;
      if (seekplaysId) {
        try {
          const refererHost = (() => {
            try { return new URL(pageUrl || playerUrl).hostname.replace(/^www\./i, ""); } catch { return ""; }
          })();
          const apiUrl = new URL("/api/v1/video", parsed.origin);
          apiUrl.searchParams.set("id", seekplaysId);
          apiUrl.searchParams.set("w", "3440");
          apiUrl.searchParams.set("h", "1440");
          if (refererHost) apiUrl.searchParams.set("r", refererHost);
          const response = await fetch(apiUrl.toString(), {
            headers: {
              Accept: "application/octet-stream,text/plain,*/*",
              Referer: playerUrl,
            },
          });
          if (response.ok) {
            const data = JSON.parse(await decryptSeekplaysHex(await response.text()));
            add(data && data.source, "hls", "seekplays");
            add(data && data.cf, "hls", "seekplays-cf");
          }
        } catch {}
      }
    }

    if (/^prvs\.top$/i.test(host)) {
      try {
        const response = await fetchWithTimeout(playerUrl, {
          headers: {
            Accept: "text/html,application/xhtml+xml,*/*",
            Referer: pageUrl || playerUrl,
          },
        });
        if (response.ok) {
          const html = await response.text();
          const encoded = html.match(/const\s+datas\s*=\s*"([^"]+)"/)?.[1] || "";
          const data = encoded ? JSON.parse(decodeBase64(encoded)) : null;
          const media = data && (typeof data.media === "object"
            ? data.media
            : await decryptPrvsMediaString(data.media, data.user_id + ":" + data.slug + ":" + data.md5_id));
          const sourcesByResId = new Map(((media && media.mp4 && media.mp4.sources) || []).map((item) => [String(item.res_id || ""), item]));
          for (const item of ((media && media.mp4 && media.mp4.fristDatas) || [])) {
            const source = sourcesByResId.get(String(item.res_id || "")) || {};
            add(item.url, source.label || item.res_id || "mp4", "prvs-firstdata");
          }
        }
      } catch {}
    }

    if (/^(?:vidara\.(?:to|so))$/i.test(host) && filecode) {
      try {
        const apiUrl = new URL("/api/stream" + (parsed.search || ""), parsed.origin);
        const response = await fetch(apiUrl.toString(), {
          method: "POST",
          headers: {
            Accept: "application/json,text/plain,*/*",
            "Content-Type": "application/json",
            Referer: playerUrl,
          },
          body: JSON.stringify({ filecode, device: "web" }),
        });
        if (response.ok) {
          const data = await response.json().catch(() => null);
          add(data && (data.streaming_url || data.url || data.file), "api-stream", "hoster-api");
        }
      } catch {}
    }

    if (/^(?:bysesayeveum\.com|byseraguci\.com|byselapuix\.com|q8y5z\.com)$/i.test(host) && filecode) {
      try {
        const byseFormats = await fetchByseQ8PlaybackFormats(playerUrl, pageUrl);
        for (const format of byseFormats) {
          if (!format || !format.url || seen.has(format.url)) continue;
          seen.add(format.url);
          formats.push(format);
        }
      } catch {}
    }

    if (/^(?:byseraguci\.com|byselapuix\.com)$/i.test(host) && filecode) {
      try {
        const apiUrl = new URL("/api/videos/" + encodeURIComponent(filecode) + "/embed/playback", parsed.origin);
        const response = await fetch(apiUrl.toString(), {
          method: "POST",
          headers: {
            Accept: "application/json,text/plain,*/*",
            "Content-Type": "application/json",
            Referer: playerUrl,
            "X-Embed-Parent": pageUrl || playerUrl,
          },
          body: "{}",
        });
        if (response.ok) {
          const data = await response.json().catch(() => null);
          const playback = await decryptAesGcmJson(data && data.playback);
          for (const source of (playback && playback.sources) || []) {
            add(source.url, source.label || source.quality || "playback", "byse-playback");
          }
        }
      } catch {}
    }

    if (/(^|\.)streamtape\.(?:com|to|xyz)$/i.test(host)) {
      try {
        const response = await fetchWithTimeout(playerUrl, {
          headers: {
            Accept: "text/html,application/xhtml+xml,*/*",
            Referer: pageUrl || playerUrl,
          },
        });
        if (response.ok) {
          const html = await response.text();
          const expressionMatch = html.match(/document\.getElementById\(['"]norobotlink['"]\)\.innerHTML\s*=\s*['"]([^'"]*)['"]\s*\+\s*\(['"]([^'"]+)['"]\)\.substring\((\d+)\)\.substring\((\d+)\)/i);
          if (expressionMatch) {
            const prefix = expressionMatch[1] || "";
            const suffix = String(expressionMatch[2] || "")
              .substring(parseInt(expressionMatch[3] || "0", 10) || 0)
              .substring(parseInt(expressionMatch[4] || "0", 10) || 0);
            const computedUrl = prefix + suffix;
            add(computedUrl.startsWith("//") ? "https:" + computedUrl : absoluteUrl(computedUrl, parsed.origin + "/"), "mp4", "streamtape-norobot");
          }
          const directMatch =
            html.match(/get_video\?id=[A-Za-z0-9]+&expires=\d+&ip=[A-Za-z0-9._-]+&token=[A-Za-z0-9._-]+/i) ||
            html.match(/get_video\?id=[^"'\s<>&]+(?:&amp;|&)[^"'\s<]+/i);
          if (directMatch && directMatch[0]) {
            const directUrl = absoluteUrl("/" + String(directMatch[0]).replace(/&amp;/g, "&"), parsed.origin + "/");
            add(directUrl, "mp4", "streamtape");
          }
        }
      } catch {}
    }

    if (/(^|\.)xtremestream\.xyz$/i.test(host)) {
      const data = parsed.searchParams.get("data") || parsed.searchParams.get("v") || "";
      if (data) {
        try {
          const apiUrl = new URL("/player/xs1.php?data=" + encodeURIComponent(data), parsed.origin);
          const response = await fetch(apiUrl.toString(), {
            headers: {
              Accept: "application/vnd.apple.mpegurl,text/plain,*/*",
              Referer: playerUrl,
            },
          });
          if (response.ok) {
            const playlistUrl = response.url || apiUrl.toString();
            const playlistText = await response.text();
            const segmentUrl = await resolveFirstHlsMediaSegmentFromContent(playlistText, playlistUrl, playerUrl);
            if (segmentUrl) {
              add(segmentUrl, "mp4", "xtremestream-segment");
              const segment = formats[formats.length - 1];
              if (segment) {
                segment.ext = /\.m4s(?:$|[?#])/i.test(segment.url) ? "m4s" : (/\.ts(?:$|[?#])/i.test(segment.url) ? "ts" : "mp4");
                segment.format_type = "mp4";
                segment.protocol = "https";
                segment.forceChromeDownload = true;
                segment.useDownloadHeaderRules = true;
                segment.refererUrl = playerUrl;
                segment.requiresReferer = true;
              }
            }
            add(playlistUrl, "hls", "xtremestream");
            const latest = formats[formats.length - 1];
            if (latest) {
              latest.refererUrl = playerUrl;
              latest.requiresReferer = true;
            }
          }
        } catch {}
      }
    }

    return formats;
  }

  function collectAkiHPlayerUrls(html, pageUrl) {
    const urls = [];
    const seen = new Set();
    const add = (url) => {
      const absolute = absoluteUrl(url, pageUrl);
      if (!/^https?:\/\//i.test(absolute || "")) return;
      let parsed = null;
      try {
        parsed = new URL(absolute);
      } catch {
        return;
      }
      const host = parsed.hostname.replace(/^www\./i, "");
      const path = parsed.pathname || "";
      const isAkiPlayer =
        host === "v.aki-h.com" && /^\/(?:v|f)\//i.test(path);
      const isAkiPlayback =
        host === "streaming.aki.today" && /^\/playback\//i.test(path);
      const isAkiStream =
        /(^|\.)aki-h\.stream$/i.test(host) && /^\/(?:v|v2|file|file2|quality2)\//i.test(path);
      if (!isAkiPlayer && !isAkiPlayback && !isAkiStream) return;
      const normalized = parsed.toString();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      urls.push(normalized);
    };

    for (const match of String(html || "").matchAll(/https?:[^"'\\\s<>]+/gi)) add(match[0]);
    for (const match of String(html || "").matchAll(/https?:\\\/\\\/[^"'\s<>]+/gi)) add(match[0]);
    for (const match of String(html || "").matchAll(/\b(?:src|href|url|data-src)\s*[:=]\s*["']([^"']+)["']/gi)) add(match[1]);

    let parsedPage = null;
    try {
      parsedPage = new URL(pageUrl || "");
    } catch {}
    for (const match of String(html || "").matchAll(/\bvid\s*=\s*["']([^"']+)["']/gi)) {
      if (parsedPage && parsedPage.hostname.replace(/^www\./i, "") === "v.aki-h.com") {
        add(new URL("/f/" + encodeURIComponent(match[1]), parsedPage.origin).toString());
      }
    }
    return urls.slice(0, 12);
  }

  async function fetchAkiHPlayerFormats(html, pageUrl) {
    const formats = [];
    const seenFormats = new Set();
    const seenPages = new Set();
    const queue = collectAkiHPlayerUrls(html, pageUrl);
    const addFormats = (items) => {
      for (const format of items || []) {
        if (!format || !format.url || seenFormats.has(format.url)) continue;
        seenFormats.add(format.url);
        if (/\/(?:file|file2)\//i.test(format.url) && !format.refererUrl) {
          format.refererUrl = format.pageUrl || pageUrl;
          format.requiresReferer = true;
        }
        formats.push(format);
      }
    };
    addFormats(collectStaticMediaFormats(html, pageUrl));
    addFormats(collectPackedMediaFormats(html, pageUrl));
    for (let index = 0; index < queue.length && index < 12 && !formats.length; index += 1) {
      const playerUrl = queue[index];
      if (seenPages.has(playerUrl)) continue;
      seenPages.add(playerUrl);
      try {
        const response = await fetchWithTimeout(playerUrl, {
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: pageUrl,
          },
        });
        if (!response.ok) continue;
        const playerHtml = await response.text();
        const resolvedUrl = response.url || playerUrl;
        addFormats(collectStaticMediaFormats(playerHtml, resolvedUrl));
        addFormats(collectPackedMediaFormats(playerHtml, resolvedUrl));
        addFormats(collectEncodedMediaFormats(playerHtml, resolvedUrl));
        for (const nestedUrl of collectAkiHPlayerUrls(playerHtml, resolvedUrl)) {
          if (!seenPages.has(nestedUrl) && !queue.includes(nestedUrl)) queue.push(nestedUrl);
        }
      } catch {}
    }
    formats.sort((a, b) => (b.height || 0) - (a.height || 0));
    return formats.slice(0, 20);
  }

  async function fetchEmbeddedPlayerFormats(html, pageUrl, depth = 0) {
    const formats = [];
    const seen = new Set();
    const addFormats = (items) => {
      for (const format of items || []) {
        if (!format || !format.url || seen.has(format.url)) continue;
        seen.add(format.url);
        formats.push(format);
      }
    };

    if (fetchAkiHPlayer) {
      addFormats(await fetchAkiHPlayerFormats(html, pageUrl));
      if (formats.length) {
        formats.sort((a, b) => (b.height || 0) - (a.height || 0));
        return formats.slice(0, 20);
      }
    }

    for (const playerUrl of collectPlayerDocumentUrls(html, pageUrl)) {
      try {
        const nhplayerFormats = await fetchNhplayerPlayerFormats(playerUrl, pageUrl);
        if (nhplayerFormats.length) {
          addFormats(nhplayerFormats);
          break;
        }
        const hlsfreeFormats = await fetchHlsfreePlayerFormats(playerUrl, pageUrl);
        if (hlsfreeFormats.length) {
          addFormats(hlsfreeFormats);
          break;
        }
        const luluvdoFormats = await fetchLuluvdoPlayerFormats(playerUrl, pageUrl);
        if (luluvdoFormats.length) {
          addFormats(luluvdoFormats);
          break;
        }
        const response = await fetchWithTimeout(playerUrl, {
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: pageUrl,
          },
        });
        if (!response.ok) continue;
        const playerHtml = await response.text();
        const resolvedNhplayerFormats = await fetchNhplayerPlayerFormats(response.url || playerUrl, pageUrl, playerHtml);
        if (resolvedNhplayerFormats.length) {
          addFormats(resolvedNhplayerFormats);
          break;
        }
        const voeFormats = collectVoeMediaFormats(playerHtml, response.url || playerUrl);
        if (voeFormats.length) {
          addFormats(voeFormats);
        } else {
          addFormats(collectSexApiMediaFormats(playerHtml, response.url || playerUrl));
          addFormats(collectXiaoshenkePlayerFormats(playerHtml, response.url || playerUrl));
          addFormats(collectStaticMediaFormats(playerHtml, response.url || playerUrl));
          addFormats(collectPackedMediaFormats(playerHtml, response.url || playerUrl));
          addFormats(collectEncodedMediaFormats(playerHtml, response.url || playerUrl));
          addFormats(await fetchApiStreamFormats(playerHtml, response.url || playerUrl));
          if (fetchAkiHPlayer) addFormats(await fetchAkiHPlayerFormats(playerHtml, response.url || playerUrl));
          addFormats(await fetchKnownHosterFormats(response.url || playerUrl, pageUrl));
          if (!formats.length && depth < 2) {
            addFormats(await fetchEmbeddedPlayerFormats(playerHtml, response.url || playerUrl, depth + 1));
          }
        }
      } catch {}
      if (formats.length) break;
    }
    formats.sort((a, b) => (b.height || 0) - (a.height || 0));
    return formats.slice(0, 20);
  }

  function collectDooplayOptions(html, pageUrl) {
    const options = [];
    const seen = new Set();
    const add = (post, nume, type) => {
      const normalized = {
        post: String(post || "").trim(),
        nume: String(nume || "").trim(),
        type: String(type || "").trim() || "movie",
      };
      if (!normalized.post || !normalized.nume) return;
      const key = normalized.post + ":" + normalized.nume + ":" + normalized.type;
      if (seen.has(key)) return;
      seen.add(key);
      options.push(normalized);
    };

    for (const match of String(html || "").matchAll(/<[^>]+\bclass=["'][^"']*dooplay_player_option[^"']*["'][^>]*>/gi)) {
      const tag = match[0];
      add(attr(tag, "data-post"), attr(tag, "data-nume"), attr(tag, "data-type"));
    }
    for (const match of String(html || "").matchAll(/\bdata-post=["']([^"']+)["'][^>]+\bdata-nume=["']([^"']+)["'][^>]+\bdata-type=["']([^"']+)["']/gi)) {
      add(match[1], match[2], match[3]);
    }
    return options.slice(0, 6);
  }

  async function fetchDooplayFormats(html, pageUrl) {
    const formats = [];
    const seen = new Set();
    const addFormats = (items) => {
      for (const format of items || []) {
        if (!format || !format.url || seen.has(format.url)) continue;
        seen.add(format.url);
        formats.push(format);
      }
    };

    for (const option of collectDooplayOptions(html, pageUrl)) {
      try {
        const body = new URLSearchParams({
          action: "doo_player_ajax",
          post: option.post,
          nume: option.nume,
          type: option.type,
        });
        const response = await fetch(new URL("/wp-admin/admin-ajax.php", pageUrl).toString(), {
          method: "POST",
          headers: {
            Accept: "application/json,text/plain,*/*",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Referer: pageUrl,
            "X-Requested-With": "XMLHttpRequest",
          },
          body,
        });
        if (!response.ok) continue;
        const data = await response.json().catch(() => null);
        const embedUrl = data && (data.embed_url || data.url || data.src);
        if (!embedUrl) continue;
        const embedHtml = '<iframe src="' + String(embedUrl).replace(/"/g, "&quot;") + '"></iframe>';
        addFormats(collectStaticMediaFormats(embedHtml, response.url || pageUrl));
        addFormats(await fetchEmbeddedPlayerFormats(embedHtml, response.url || pageUrl));
      } catch {}
      if (formats.length) break;
    }
    formats.sort((a, b) => (b.height || 0) - (a.height || 0));
    return formats.slice(0, 20);
  }

  function extractApiStreamIds(html) {
    const ids = [];
    const add = (value) => {
      const id = String(value || "").trim();
      if (id && !ids.includes(id)) ids.push(id);
    };

    for (const match of String(html || "").matchAll(/\/api\/stream\/([^"'?&\/\s]+)/gi)) {
      add(match[1]);
    }
    for (const match of String(html || "").matchAll(/videoId\s*=\s*["']([^"']+)["']/gi)) {
      add(match[1]);
    }
    return ids;
  }

  async function fetchApiStreamFormats(html, pageUrl) {
    const formats = [];
    const seen = new Set();
    const targets = ["", "download", "video", "player"];
    const add = (url, label, source) => {
      const format = mediaFormat(url, label, pageUrl, source);
      if (!format || seen.has(format.url)) return;
      seen.add(format.url);
      formats.push(format);
    };

    for (const id of extractApiStreamIds(html)) {
      for (const target of targets) {
        try {
          const apiUrl = new URL("/api/stream/" + encodeURIComponent(id) + "?target=" + encodeURIComponent(target), pageUrl);
          const response = await fetch(apiUrl.toString(), {
            headers: {
              Accept: "application/json,text/plain,*/*",
              Referer: pageUrl,
            },
          });
          if (!response.ok) continue;
          const data = await response.json().catch(() => null);
          add(data && data.url, target || "api-stream", "api-stream");
        } catch {}
      }
    }
    return formats;
  }

  function parseEpornerVideoId(pageUrl) {
    try {
      const match = String(pageUrl || "").match(/\/(?:video-|embed\/|dload\/|hd-porn\/)([\w-]+)/i);
      return match ? match[1] : "";
    } catch {
      return "";
    }
  }

  function findEpornerFormatUrl(videoInfo = {}) {
    const candidates = [];
    if (videoInfo.selectedFormat?.url) candidates.push(videoInfo.selectedFormat.url);
    if (Array.isArray(videoInfo.formats)) {
      for (const format of videoInfo.formats) {
        if (format?.url) candidates.push(format.url);
      }
    }
    return candidates.find((url) => /(^https?:\/\/)?(?:[^/]+\.)?eporner\.com\//i.test(String(url || ""))) || "";
  }

  function extractEpornerPageHash(html) {
    try {
      return (String(html || "").match(/hash\s*[:=]\s*["']([\da-f]{32})/i) || [])[1] || "";
    } catch {
      return "";
    }
  }

  function encodeBaseN(num, base) {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    if (!num) return "0";
    let result = "";
    while (num > 0) {
      result = chars[num % base] + result;
      num = Math.floor(num / base);
    }
    return result;
  }

  function calcEpornerHash(hex) {
    let result = "";
    for (let offset = 0; offset < 32; offset += 8) {
      const chunk = String(hex || "").substring(offset, offset + 8);
      const num = parseInt(chunk, 16);
      if (Number.isNaN(num)) return "";
      result += encodeBaseN(num, 36);
    }
    return result;
  }

  async function fetchEpornerApiFormats(videoInfo = {}) {
    const playerUrl = videoInfo.playerUrl || videoInfo.embed_url || findEpornerFormatUrl(videoInfo) || videoInfo.webpage_url || videoInfo.url || "";
    if (!/(^https?:\/\/)?(?:[^/]+\.)?eporner\.com\//i.test(playerUrl)) return [];
    const videoId = parseEpornerVideoId(playerUrl);
    if (!videoId) return [];
    const playerFetchUrl = /\/embed\//i.test(playerUrl)
      ? playerUrl.replace(/^https?:\/\/(?:[^/]+\.)?eporner\.com\//i, "https://www.eporner.com/")
      : `https://www.eporner.com/embed/${encodeURIComponent(videoId)}/`;

    try {
      const epornerReferer = "https://www.eporner.com/";
      const playerResponse = await fetchWithTimeout(playerFetchUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: epornerReferer,
        },
        credentials: "omit",
        cache: "no-store",
      }, 12000);
      if (!playerResponse.ok) return [];
      const playerHtml = await playerResponse.text();
      const rawHash = extractEpornerPageHash(playerHtml);
      const hash = rawHash && /^[0-9a-f]{32}$/i.test(rawHash) ? calcEpornerHash(rawHash) : rawHash;
      if (!hash) return [];

      const apiParams = new URLSearchParams({
        hash,
        domain: "www.eporner.com",
        pixelRatio: "1",
        playerWidth: "0",
        playerHeight: "0",
        fallback: "false",
        embed: "true",
        supportedFormats: "hls,dash,h265,vp9,av1,mp4",
        _: String(Date.now()),
      });
      const apiUrl = `https://www.eporner.com/xhr/video/${encodeURIComponent(videoId)}?${apiParams.toString()}`;
      const response = await fetchWithTimeout(apiUrl, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: playerFetchUrl,
          "X-Requested-With": "XMLHttpRequest",
        },
        credentials: "omit",
        cache: "no-store",
      }, 12000);
      if (!response.ok) return [];
      const data = await response.json().catch(() => null);
      const formats = [];
      const seen = new Set();
      const add = (url, formatId, kind) => {
        const absolute = absoluteUrl(url, response.url || apiUrl);
        if (!absolute || seen.has(absolute)) return;
        const isHls = kind === "hls" || /\.m3u8(?:$|[?#])/i.test(absolute);
        const isMp4 = kind === "mp4" || /\.mp4(?:$|[?#/])/i.test(absolute);
        if (!isHls && !isMp4) return;
        if (!isHls && /^https?:\/\/(?:[^/]+\.)?eporner\.com\/dload\//i.test(absolute)) return;
        const height = parseInt(String(formatId || "").match(/(\d{3,4})p?/i)?.[1] || "", 10) || null;
        seen.add(absolute);
        const format = {
          url: absolute,
          ext: isHls ? "m3u8" : "mp4",
          format_type: isHls ? "hls" : "mp4",
          protocol: isHls ? "m3u8_native" : "https",
          format_id: height ? `${height}p` : String(formatId || (isHls ? "eporner-hls" : "eporner-mp4")),
          quality: height ? `${height}p` : String(formatId || (isHls ? "hls" : "mp4")),
          height,
          source: "eporner-xhr",
        };
        if (isMp4) {
          format.forceChromeDownload = true;
          format.requiresReferer = false;
          format.refererUrl = "";
          format.referrer = "";
          format.referer = "";
          format.sourcePageUrl = "";
        }
        formats.push(format);
      };

      const sources = data && data.sources;
      if (sources && typeof sources === "object") {
        for (const [kind, group] of Object.entries(sources)) {
          if (!group || typeof group !== "object") continue;
          for (const [formatId, record] of Object.entries(group)) {
            if (record && typeof record === "object" && record.src) add(record.src, formatId, kind);
          }
        }
      }

      const resources = data?.file?.hls_resources || (Array.isArray(data?.fc_facts) && data.fc_facts.find((fact) => fact?.hls_resources)?.hls_resources);
      if (resources && typeof resources === "object") {
        for (const [formatId, videoUri] of Object.entries(resources)) {
          if (videoUri) add(absoluteUrl(videoUri, "https://www.eporner.com/"), formatId, "hls");
        }
      }

      return formats.sort((a, b) => (b.height || 0) - (a.height || 0));
    } catch {
      return [];
    }
  }

  async function fetchFlowplayerConfigFormats(html, pageUrl) {
    if (!fetchFlowplayerConfigScripts) return [];
    const formats = [];
    const seen = new Set();
    const add = (url, label, source) => {
      const format = mediaFormat(url, label, pageUrl);
      if (!format || seen.has(format.url)) return;
      format.source = source || format.source || "flowplayer-config";
      format.quality = label || format.quality;
      seen.add(format.url);
      formats.push(format);
    };
    const urls = [];
    const addConfigUrl = (value) => {
      if (!value) return;
      const absolute = absoluteUrl(String(value).replace(/&amp;/g, "&"), pageUrl);
      if (!/^https?:\/\//i.test(absolute)) return;
      if (!/config(?:_|-)?iframe|player\/config|flowplayer/i.test(absolute)) return;
      if (!urls.includes(absolute)) urls.push(absolute);
    };
    for (const match of String(html || "").matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
      addConfigUrl(match[1]);
    }
    for (const match of String(html || "").matchAll(/https?:[^"'\s<>]+config(?:_|-)?iframe[^"'\s<>]*/gi)) {
      addConfigUrl(match[0]);
    }
    for (const url of urls.slice(0, 5)) {
      try {
        const response = await fetchWithTimeout(url, {
          headers: {
            Accept: "application/javascript,text/javascript,text/plain,*/*",
            Referer: pageUrl,
          },
        });
        if (!response.ok) continue;
        const text = await response.text();
        for (const format of collectStaticMediaFormats(text, response.url || url)) {
          add(format.url, format.quality || format.format_id || "flowplayer", "flowplayer-config");
        }
      } catch {}
    }
    return formats;
  }

  function parseHalimConfig(html) {
    const source = String(html || "");
    const match = source.match(/\bvar\s+halim_cfg\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i) ||
      source.match(/\bvar\s+halim_cfg\s*=\s*(\{[\s\S]*?\})\s*;/i);
    if (!match) return null;
    try {
      return JSON.parse(match[1].replace(/\\\//g, "/"));
    } catch {
      return null;
    }
  }

  function parseBodyNonce(html) {
    return String(html || "").match(/<body\b[^>]*\bdata-nonce=["']([^"']+)["']/i)?.[1] || "";
  }

  async function fetchHalimPlayerFormats(html, pageUrl) {
    if (!fetchHalimPlayer) return [];
    const cfg = parseHalimConfig(html);
    if (!cfg || !cfg.player_url || !cfg.post_id || !cfg.episode_slug) return [];
    const params = new URLSearchParams({
      episode_slug: String(cfg.episode_slug || ""),
      server_id: String(cfg.server || "1"),
      subsv_id: "",
      post_id: String(cfg.post_id || ""),
      nonce: parseBodyNonce(html),
      custom_var: String(cfg.custom_var || ""),
    });
    try {
      const playerUrl = absoluteUrl(String(cfg.player_url), pageUrl) + "?" + params.toString();
      const response = await fetchWithTimeout(playerUrl, {
        headers: {
          Accept: "text/html,application/json,*/*",
          Referer: pageUrl,
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      if (!response.ok) return [];
      const playerHtml = await response.text();
      const directFormats = collectStaticMediaFormats(playerHtml, response.url || playerUrl);
      const embeddedFormats = await fetchEmbeddedPlayerFormats(playerHtml, response.url || playerUrl, 1);
      return mergePreferredFormats(directFormats, embeddedFormats);
    } catch {
      return [];
    }
  }

  function isNhplayerUrl(url) {
    try {
      return /(^|\.)nhplayer\.com$/i.test(new URL(String(url || "")).hostname);
    } catch {
      return false;
    }
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  }

  function parseNhplayerValue(source, key) {
    try {
      return String(source || "").match(new RegExp("\\b" + key + "\\s*:\\s*[\"']([^\"']*)[\"']", "i"))?.[1] || "";
    } catch {
      return "";
    }
  }

  function tagById(html, id) {
    if (!id) return "";
    try {
      const escaped = escapeRegExp(id);
      return String(html || "").match(new RegExp("<[^>]*\\bid\\s*=\\s*(?:\"" + escaped + "\"|'" + escaped + "')[^>]*>", "i"))?.[0] || "";
    } catch {
      return "";
    }
  }

  function firstDataAttr(tag) {
    const match = String(tag || "").match(/\bdata-[^=]+\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return (match && (match[1] || match[2] || match[3])) || "";
  }

  async function nhplayerProofOfWork(challenge) {
    const encoder = new TextEncoder();
    for (let nonce = 0; nonce < 10000000; nonce += 1) {
      const value = nonce.toString(16);
      try {
        const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(challenge || "") + value));
        if (new Uint8Array(digest)[0] === 0) return value;
      } catch {
        return "";
      }
      if (nonce > 0 && nonce % 50000 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return "";
  }

  function nhplayerFingerprintBase64() {
    const nav = typeof navigator !== "undefined" ? navigator : {};
    const screenInfo = typeof screen !== "undefined" ? screen : {};
    const data = {
      t: 1200,
      mm: [[110, 210, 120], [150, 230, 260], [190, 250, 520]],
      tm: [],
      cl: [[220, 300, 820]],
      kp: [],
      sc: [],
      i: 1,
      mc: 3,
      tc: 0,
      cc: 1,
      kc: 0,
      b: {
        sw: Number(screenInfo.width) || 0,
        sh: Number(screenInfo.height) || 0,
        aw: Number(screenInfo.availWidth) || 0,
        ah: Number(screenInfo.availHeight) || 0,
        cd: Number(screenInfo.colorDepth) || 24,
        pd: Number(screenInfo.pixelDepth) || 24,
        tz: new Date().getTimezoneOffset(),
        hc: Number(nav.hardwareConcurrency) || 0,
        dm: Number(nav.deviceMemory) || 0,
        pl: String(nav.platform || ""),
        lang: String(nav.language || ""),
        langs: Array.isArray(nav.languages) ? nav.languages.join(",") : "",
        dpr: typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
        ww: typeof innerWidth === "number" ? innerWidth : 0,
        wh: typeof innerHeight === "number" ? innerHeight : 0,
        touch: ("ontouchstart" in globalThis) || Number(nav.maxTouchPoints || 0) > 0,
        pdf: Boolean(nav.pdfViewerEnabled),
        fonts: 0,
      },
    };
    try {
      return btoa(JSON.stringify(data));
    } catch {
      return "";
    }
  }

  async function fetchNhplayerPlayerFormats(playerUrl, pageReferer = "", knownHtml = "") {
    if (!fetchNhplayerPlayer || !isNhplayerUrl(playerUrl)) return [];
    const referer = pageReferer || playerUrl;
    const failureKey = String(playerUrl || "") + "\n" + String(referer || "");
    if (nhplayerPlayerFailureCache.has(failureKey)) return [];
    const markFailure = () => {
      if (nhplayerPlayerFailureCache.size > 100) nhplayerPlayerFailureCache.clear();
      nhplayerPlayerFailureCache.add(failureKey);
    };
    try {
      let resolvedPlayerUrl = absoluteUrl(playerUrl, referer);
      let html = String(knownHtml || "");
      console.log("[site-adapter] nhplayer-resolve-start", { playerUrl: resolvedPlayerUrl, hasHtml: Boolean(html), referer });
      if (!html) {
        const response = await withTemporaryAdapterHeaderRules(resolvedPlayerUrl, referer, async () => await fetchWithTimeout(resolvedPlayerUrl, {
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          credentials: "include",
          referrer: referer,
          referrerPolicy: "origin-when-cross-origin",
        }, 12000));
        if (!response || !response.ok) {
          console.log("[site-adapter] nhplayer-fetch-failed", { status: response?.status || 0, url: resolvedPlayerUrl });
          markFailure();
          return [];
        }
        html = await response.text();
        resolvedPlayerUrl = response.url || resolvedPlayerUrl;
        console.log("[site-adapter] nhplayer-fetched-html", { url: resolvedPlayerUrl, bytes: html.length, hasDataId: /\bdata-id\b/i.test(html), hasPlayerConfig: /window\._pV/i.test(html) });
      }

      if (!/\/player\.php(?:$|[?#])/i.test(new URL(resolvedPlayerUrl).pathname)) {
        const playerMatch = String(html || "").match(/\bdata-id\s*=\s*(?:"([^"]*\/player\.php\?[^"]+)"|'([^']*\/player\.php\?[^']+)')/i);
        const playerPath = (playerMatch && (playerMatch[1] || playerMatch[2])) || "";
        console.log("[site-adapter] nhplayer-player-path", { found: Boolean(playerPath), from: resolvedPlayerUrl });
        return playerPath ? await fetchNhplayerPlayerFormats(absoluteUrl(playerPath, resolvedPlayerUrl), resolvedPlayerUrl, "") : [];
      }

      const coreMatch = String(html || "").match(/<script\b[^>]+src\s*=\s*(?:"([^"]*player-core-v2\.php[^"]*)"|'([^']*player-core-v2\.php[^']*)')/i);
      const corePath = (coreMatch && (coreMatch[1] || coreMatch[2])) || "";
      const pVSource = String(html || "").match(/window\._pV\s*=\s*(\{[\s\S]*?\})\s*;/)?.[1] || "";
      if (!corePath || !pVSource) {
        console.log("[site-adapter] nhplayer-config-missing", { url: resolvedPlayerUrl, htmlBytes: html.length, hasCorePath: Boolean(corePath), pVBytes: pVSource.length, sample: String(html || "").slice(0, 80) });
        markFailure();
        return [];
      }

      const coreUrl = absoluteUrl(corePath, resolvedPlayerUrl);
      const coreResponse = await withTemporaryAdapterHeaderRules(coreUrl, resolvedPlayerUrl, async () => await fetchWithTimeout(coreUrl, {
        headers: {
          Accept: "application/javascript,text/javascript,*/*;q=0.8",
        },
        credentials: "include",
        referrer: resolvedPlayerUrl,
        referrerPolicy: "origin-when-cross-origin",
      }, 12000));
      if (!coreResponse || !coreResponse.ok) {
        console.log("[site-adapter] nhplayer-core-fetch-failed", { status: coreResponse?.status || 0, url: coreUrl });
        markFailure();
        return [];
      }
      const core = await coreResponse.text();
      const ids = Array.from(String(core || "").matchAll(/getElementById\('([^']+)'\)/g)).map((match) => match[1]);
      if (ids.length < 5) {
        console.log("[site-adapter] nhplayer-core-ids-missing", { url: coreUrl, idCount: ids.length, coreBytes: core.length });
        markFailure();
        return [];
      }

      const p1 = firstDataAttr(tagById(html, ids[0]));
      const p2 = attr(tagById(html, ids[1]), "value");
      const p3 = firstDataAttr(tagById(html, ids[2]));
      const p4Pattern = new RegExp("<template[^>]*\\bid\\s*=\\s*(?:\"" + escapeRegExp(ids[3]) + "\"|'" + escapeRegExp(ids[3]) + "')[^>]*>[\\s\\S]*?<p>([^<]+)<\\/p>", "i");
      const p4 = String(html || "").match(p4Pattern)?.[1] || "";
      const t = firstDataAttr(tagById(html, ids[4]));
      const sc = String(core || "").match(/var\s+_[A-Za-z0-9]+\s*=\s*'([^']+\.[^']+)'/)?.[1] || "";
      const rid = String(core || "").match(/var\s+_[A-Za-z0-9]+\s*=\s*'([a-f0-9]{16,})'/i)?.[1] || "";
      const vid = parseNhplayerValue(pVSource, "vid");
      const ct = parseNhplayerValue(pVSource, "ct");
      const pid = parseNhplayerValue(pVSource, "pid");
      const st = parseNhplayerValue(pVSource, "st");
      if (!p1 || !p2 || !p3 || !p4 || !t || !sc || !rid || !vid) {
        console.log("[site-adapter] nhplayer-parts-missing", { p1: Boolean(p1), p2: Boolean(p2), p3: Boolean(p3), p4: Boolean(p4), t: Boolean(t), sc: Boolean(sc), rid: Boolean(rid), vid: Boolean(vid), ct: Boolean(ct), pid: Boolean(pid), st: Boolean(st) });
        markFailure();
        return [];
      }

      await new Promise((resolve) => setTimeout(resolve, 750));
      const pow = await nhplayerProofOfWork(p1 + p2 + p3 + p4 + t);
      if (!pow) {
        console.log("[site-adapter] nhplayer-pow-failed");
        markFailure();
        return [];
      }
      const endpoint = new URL("/get-video-url-v2.php", resolvedPlayerUrl);
      endpoint.search = new URLSearchParams({
        vid,
        c: ct,
        p1,
        p2,
        p3,
        p4,
        t,
        sc,
        rid,
        fp: nhplayerFingerprintBase64(),
        df: "",
        pow,
        pid,
        st,
      }).toString();
      const apiResponse = await withTemporaryAdapterHeaderRules(endpoint.toString(), resolvedPlayerUrl, async () => await fetchWithTimeout(endpoint.toString(), {
        headers: {
          Accept: "application/json,text/plain,*/*",
          "X-Requested-With": "XMLHttpRequest",
        },
        credentials: "include",
        referrer: resolvedPlayerUrl,
        referrerPolicy: "origin-when-cross-origin",
        cache: "no-store",
      }, 15000));
      if (!apiResponse || !apiResponse.ok) {
        console.log("[site-adapter] nhplayer-api-failed", { status: apiResponse?.status || 0, url: endpoint.toString() });
        markFailure();
        return [];
      }
      const data = await apiResponse.json().catch(() => null);
      const mediaUrl = data && data.url ? String(data.url) : "";
      if (!mediaUrl) {
        console.log("[site-adapter] nhplayer-api-no-url");
        markFailure();
        return [];
      }
      const format = mediaFormat(mediaUrl, "nhplayer-mp4", resolvedPlayerUrl, "nhplayer-player");
      if (!format) {
        console.log("[site-adapter] nhplayer-format-rejected", { mediaUrl });
        markFailure();
        return [];
      }
      console.log("[site-adapter] nhplayer-format-ready", { host: new URL(mediaUrl).hostname, source: format.source });
      format.refererUrl = new URL(resolvedPlayerUrl).origin + "/";
      format.requiresReferer = true;
      if (chromeDownloadWithHeaderRules || tabInitiatedDownloadWithHeaderRules) {
        format.useDownloadHeaderRules = true;
      }
      return [format];
    } catch (error) {
      console.log("[site-adapter] nhplayer-resolve-error", { message: error?.message || String(error) });
      markFailure();
      return [];
    }
  }

  function isHlsfreePlayerUrl(url) {
    try {
      const parsed = new URL(String(url || ""));
      return /(^|\.)hlsfree\.com$/i.test(parsed.hostname) && /\/embed\/hls\//i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function collectHlsfreePlayerFormats(html, playerUrl) {
    const formats = [];
    const seen = new Set();
    const source = normalizeUrl(String(html || ""));
    const add = (url, label = "hlsfree-hls") => {
      const format = mediaFormat(url, label, playerUrl, "hlsfree-player");
      if (!format || !format.url || seen.has(format.url)) return;
      seen.add(format.url);
      formats.push(format);
    };
    for (const match of source.matchAll(/(?:defaultHlsUrl|hlsUrl|hlsSource|source|file)\s*[:=]\s*["']([^"']+\/api\/hls\/serve\?token=[^"']+)["']/gi)) {
      add(match[1]);
    }
    for (const match of source.matchAll(/https?:\/\/(?:[^\s"'<>]+\.)?hlsfree\.com\/api\/hls\/serve\?token=[^\s"'<>]+/gi)) {
      add(match[0]);
    }
    return formats;
  }

  async function fetchHlsfreePlayerFormats(playerUrl, pageReferer = "") {
    if (!fetchHlsfreePlayer || !isHlsfreePlayerUrl(playerUrl)) return [];
    const referer = pageReferer || playerUrl;
    try {
      const response = await withTemporaryAdapterHeaderRules(playerUrl, referer, async () => await fetchWithTimeout(playerUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      }, 12000));
      if (!response || !response.ok) return [];
      const playerHtml = await response.text();
      return collectHlsfreePlayerFormats(playerHtml, response.url || playerUrl);
    } catch {
      return [];
    }
  }

  function isLuluvdoPlayerUrl(url) {
    try {
      const parsed = new URL(String(url || ""));
      return /(^|\.)(?:luluvdo\.com|lulustream\.com)$/i.test(parsed.hostname) && /\/embed\//i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  async function fetchLuluvdoPlayerFormats(playerUrl, pageReferer = "") {
    if (!isLuluvdoPlayerUrl(playerUrl)) return [];
    const formats = [];
    const seen = new Set();
    const addFormats = (items) => {
      for (const format of items || []) {
        if (!format || !format.url || seen.has(format.url)) continue;
        seen.add(format.url);
        formats.push(format);
      }
    };
    try {
      const parsed = new URL(playerUrl);
      const fileCode = parsed.pathname.split("/").filter(Boolean).pop() || "";
      if (!fileCode) return [];
      const dlUrl = new URL("/dl", parsed.origin).toString();
      const response = await withTemporaryAdapterHeaderRules(dlUrl, playerUrl, async () => await fetchWithTimeout(dlUrl, {
        method: "POST",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Origin: parsed.origin,
          Referer: playerUrl,
        },
        body: new URLSearchParams({
          op: "embed",
          file_code: fileCode,
          auto: "1",
          referer: pageReferer || "",
        }),
        credentials: "include",
        referrer: playerUrl,
        referrerPolicy: "origin-when-cross-origin",
      }, 15000));
      if (!response || !response.ok) return [];
      const html = await response.text();
      const resolvedUrl = response.url || dlUrl;
      addFormats(collectStaticMediaFormats(html, resolvedUrl));
      addFormats(collectPackedMediaFormats(html, resolvedUrl));
      addFormats(collectEncodedMediaFormats(html, resolvedUrl));
    } catch {}
    formats.sort((a, b) => formatPreferenceScore(b) - formatPreferenceScore(a));
    return formats.slice(0, 20);
  }

  const SiteAdapter = {
    version: "0.1.0",
    preset: "generic-static-media",
    selectors,

    collectCandidates({ defaultCollectCandidates, document, location, addCandidate }) {
      const candidates = defaultCollectCandidates();
      try {
        const html = (document.documentElement && document.documentElement.innerHTML) || "";
        const discoveredFormats = preferDomVideoSrc
          ? mergePreferredFormats(collectDomVideoFormats(document, location.href), collectStaticMediaFormats(html, location.href))
          : collectStaticMediaFormats(html, location.href);
        for (const format of discoveredFormats) {
          addCandidate(candidates, format.url, format.source || "html");
        }
        for (const playerUrl of collectPlayerDocumentUrls(html, location.href)) {
          addCandidate(candidates, playerUrl, "player-document");
        }
      } catch {}
      return candidates;
    },

    extractVideoInfo({ defaults, document, location }) {
      let formats = Array.isArray(defaults.formats)
        ? defaults.formats.filter((format) => format && !isBlockedFormatUrl(format.url))
        : [];
      let playerUrl = defaults.playerUrl || defaults.embed_url || "";
      let suppressDefaultVideoUrl = false;
      let cleanTitle = pageTitleFromDocument(document, defaults.title || "");
      try {
        const html = (document.documentElement && document.documentElement.innerHTML) || "";
        const playerCandidates = collectPlayerDocumentUrls(html, location.href);
        const iframeCandidates = Array.from(document.querySelectorAll("iframe"))
          .map((frame) => frame && typeof frame.src === "string" ? frame.src : "")
          .filter(Boolean);
        const pageFormats = preferDomVideoSrc
          ? mergePreferredFormats(collectDomVideoFormats(document, location.href), collectStaticMediaFormats(html, location.href))
          : collectStaticMediaFormats(html, location.href);
        formats = formats.length ? mergePreferredFormats(pageFormats, formats) : pageFormats;
        playerUrl = pickPreferredPlayerUrl(playerCandidates.concat(iframeCandidates), playerUrl);
        if (shouldIgnorePlayerUrl(playerUrl)) playerUrl = "";
        if (!formats.length && playerUrl) formats = playerUrlStaticFormats(playerUrl, location.href);
        formats = applyCleanTubePlayerReferer(formats, playerUrl);
        if (!preferDirectMedia && playerUrl && formats.length && formats.every((format) => format && isKnownHosterUrl(format.url))) {
          formats = [];
          suppressDefaultVideoUrl = true;
        }
      } catch {}
      const selected = formats.find((format) => format.format_type === "mp4") || formats[0] || null;
      const defaultVideoUrl = defaults.video_url && !isBlockedFormatUrl(defaults.video_url)
        ? defaults.video_url
        : "";
      return {
        ...defaults,
        title: cleanTitle || defaults.title,
        url: defaults.url || location.href,
        webpage_url: defaults.webpage_url || defaults.url || location.href,
        video_url: suppressDefaultVideoUrl ? ((selected && selected.url) || "") : (defaultVideoUrl || (selected && selected.url) || ""),
        playerUrl,
        embed_url: defaults.embed_url || playerUrl,
        formats,
      };
    },

    async getVideoFormats({ videoInfo, defaultGetVideoFormats, request, tabId }) {
      const epornerFormats = await fetchEpornerApiFormats(videoInfo);
      if (epornerFormats.length) return { formats: epornerFormats };

      const preferredPageFormats = preferPageFormatsBeforeDefault
        ? mergePreferredFormats(Array.isArray(videoInfo?.formats) ? videoInfo.formats : [])
            .filter((format) => format && !isBlockedFormatUrl(format.url))
        : [];
      if (preferredPageFormats.length) {
        const pageReferer = videoInfo?.webpage_url || videoInfo?.url || "";
        const resolvedPreferredHosters = [];
        const directPreferredFormats = [];
        for (const format of preferredPageFormats) {
          if (format && isKnownHosterUrl(format.url)) {
            const resolved = await fetchKnownHosterFormats(format.url, pageReferer || format.url);
            if (resolved.length) resolvedPreferredHosters.push(...resolved);
            continue;
          }
          directPreferredFormats.push(format);
        }
        if (resolvedPreferredHosters.length) return { formats: mergePreferredFormats(resolvedPreferredHosters, directPreferredFormats) };
        if (directPreferredFormats.length) return { formats: directPreferredFormats };
      }

      const direct = await defaultGetVideoFormats(videoInfo);
      const cleanTubePlayerUrl = videoInfo.playerUrl || videoInfo.embed_url || "";
      if (Array.isArray(direct.formats)) {
        direct.formats = direct.formats.filter((format) =>
          format && !isSourcePageUrl(format.url, videoInfo) && !isBlockedFormatUrl(format.url)
        );
      }
      if (direct.formats && direct.formats.length) {
        direct.formats = applyCleanTubePlayerReferer(direct.formats, cleanTubePlayerUrl);
        if (preferDirectMedia) return direct;
        const directHosterCandidates = direct.formats.filter((format) => format && isKnownHosterUrl(format.url));
        if (directHosterCandidates.length && !cleanTubePlayerUrl) {
          for (const format of directHosterCandidates.slice(0, 3)) {
            const resolvedDirect = await fetchKnownHosterFormats(format.url, videoInfo.webpage_url || videoInfo.url || format.url);
            if (resolvedDirect.length) return { formats: resolvedDirect };
          }
        }
        if (!directHosterCandidates.length) return direct;
      }

      const sourcePageUrl = videoInfo.webpage_url || videoInfo.url || "";
      const sourceKvsFormats = await fetchKvsApiFormats(sourcePageUrl);
      if (sourceKvsFormats.length) return { formats: sourceKvsFormats };

      let pageUrl = videoInfo.playerUrl || videoInfo.embed_url || videoInfo.webpage_url || videoInfo.url;
      if (shouldIgnorePlayerUrl(pageUrl)) pageUrl = sourcePageUrl || videoInfo.url || "";
      if (!/^https?:\/\//i.test(pageUrl || "")) {
        const fallbackSeedStaticFormats = staticMediaUrls.length
          ? await filterUsableSeedStaticFormats(
              collectStaticMediaFormats("", sourcePageUrl || pageUrl || ""),
              sourcePageUrl || pageUrl || ""
            )
          : [];
        if (fallbackSeedStaticFormats.length) return { formats: fallbackSeedStaticFormats };
        return direct;
      }

      if (isKnownHosterUrl(pageUrl)) {
        const knownHosterPageFormats = await fetchKnownHosterFormats(pageUrl, videoInfo.webpage_url || videoInfo.url || pageUrl);
        if (knownHosterPageFormats.length) return { formats: knownHosterPageFormats };
      }

      const resolvedTabId = Number(tabId || request?.tabId || videoInfo?.tabId || 0) || 0;
      const nhplayerProbeUrls = [];
      const addNhplayerProbeUrl = (url) => {
        const value = String(url || "");
        if (!isNhplayerUrl(value) || nhplayerProbeUrls.includes(value)) return;
        nhplayerProbeUrls.push(value);
      };
      [
        pageUrl,
        sourcePageUrl,
        videoInfo.playerUrl,
        videoInfo.embed_url,
        videoInfo.url,
        videoInfo.webpage_url,
      ].forEach(addNhplayerProbeUrl);
      for (const format of []
        .concat(Array.isArray(videoInfo?.formats) ? videoInfo.formats : [])
        .concat(Array.isArray(preferredPageFormats) ? preferredPageFormats : [])
        .concat(Array.isArray(direct?.formats) ? direct.formats : [])) {
        addNhplayerProbeUrl(format && format.url);
      }
      if (!nhplayerProbeUrls.length) {
        for (const nestedUrl of await collectNestedNhplayerProbeUrls(pageUrl, sourcePageUrl || pageUrl)) addNhplayerProbeUrl(nestedUrl);
        if (!nhplayerProbeUrls.length && sourcePageUrl && sourcePageUrl !== pageUrl) {
          for (const nestedUrl of await collectNestedNhplayerProbeUrls(sourcePageUrl, pageUrl)) addNhplayerProbeUrl(nestedUrl);
        }
      }
      console.log("[site-adapter] nhplayer-frame-probe-urls", { count: nhplayerProbeUrls.length, first: nhplayerProbeUrls[0] || "" });
      for (const probeUrl of nhplayerProbeUrls.slice(0, 2)) {
        await ensureNhplayerProbeFrame(resolvedTabId, probeUrl);
      }
      const nhplayerFrameFormats = await collectNhplayerFrameFormats(resolvedTabId);
      if (nhplayerFrameFormats.length) return { formats: nhplayerFrameFormats };

      const nhplayerFormats = await fetchNhplayerPlayerFormats(pageUrl, sourcePageUrl || pageUrl);
      if (nhplayerFormats.length) return { formats: nhplayerFormats };

      const hlsfreePlayerFormats = await fetchHlsfreePlayerFormats(pageUrl, sourcePageUrl || pageUrl);
      if (hlsfreePlayerFormats.length) return { formats: hlsfreePlayerFormats };

      const luluvdoPlayerFormats = await fetchLuluvdoPlayerFormats(pageUrl, sourcePageUrl || pageUrl);
      if (luluvdoPlayerFormats.length) return { formats: luluvdoPlayerFormats };

      const staticPlayerFormats = playerUrlStaticFormats(pageUrl, sourcePageUrl || pageUrl);
      if (staticPlayerFormats.length && !staticPlayerFormats.every((format) => format && isKnownHosterUrl(format.url))) return { formats: staticPlayerFormats };

      if (!isKnownHosterUrl(pageUrl)) {
        const directHosterFormats = await fetchKnownHosterFormats(pageUrl, videoInfo.webpage_url || videoInfo.url || pageUrl);
        if (directHosterFormats.length) return { formats: directHosterFormats };
      }

      let response = null;
      try {
        response = await fetchWithTimeout(pageUrl, {
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: pageUrl,
          },
        });
      } catch {}
      if (!response || !response.ok) {
        try {
          const shouldRetrySourcePage =
            /^https?:\/\//i.test(sourcePageUrl) &&
            sourcePageUrl !== pageUrl;
          if (shouldRetrySourcePage) {
            const sourceResponse = await fetchWithTimeout(sourcePageUrl, {
              headers: {
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                Referer: sourcePageUrl,
              },
            });
            if (sourceResponse.ok) {
              const sourceHtml = await sourceResponse.text();
              const resolvedSourceUrl = sourceResponse.url || sourcePageUrl;
              const sourceEmbeddedFormats = await fetchEmbeddedPlayerFormats(sourceHtml, resolvedSourceUrl);
              if (sourceEmbeddedFormats.length) return { formats: sourceEmbeddedFormats };
              const sourceDooplayFormats = await fetchDooplayFormats(sourceHtml, resolvedSourceUrl);
              if (sourceDooplayFormats.length) return { formats: sourceDooplayFormats };
              const sourceKvsFormats = await fetchKvsApiFormats(resolvedSourceUrl);
              if (sourceKvsFormats.length) return { formats: sourceKvsFormats };
            }
          }
        } catch {}
        const fallbackSeedStaticFormats = staticMediaUrls.length
          ? await filterUsableSeedStaticFormats(
              collectStaticMediaFormats("", sourcePageUrl || pageUrl || ""),
              sourcePageUrl || pageUrl || ""
            )
          : [];
        if (fallbackSeedStaticFormats.length) return { formats: fallbackSeedStaticFormats };
        return direct;
      }

      const html = await response.text();
      const voeFormats = collectVoeMediaFormats(html, response.url || pageUrl);
      if (voeFormats.length) return { formats: voeFormats };

      const sexApiFormats = collectSexApiMediaFormats(html, response.url || pageUrl);
      if (sexApiFormats.length) return { formats: sexApiFormats };

      const staticPlayerUrlFormats = collectStaticPlayerUrlFormats(html, response.url || pageUrl);
      if (staticPlayerUrlFormats.length) return { formats: staticPlayerUrlFormats };

      const flowplayerConfigFormats = await fetchFlowplayerConfigFormats(html, response.url || pageUrl);
      if (flowplayerConfigFormats.length) return { formats: flowplayerConfigFormats };

      const halimPlayerFormats = await fetchHalimPlayerFormats(html, response.url || pageUrl);
      if (halimPlayerFormats.length) return { formats: halimPlayerFormats };

      const xiaoshenkeFormats = collectXiaoshenkePlayerFormats(html, response.url || pageUrl);
      if (xiaoshenkeFormats.length) return { formats: xiaoshenkeFormats };

      const formats = collectStaticMediaFormats(html, response.url || pageUrl);
      if (formats.length) return { formats };

      const initPlayerFormats = collectInitPlayerConfigFormats(html, response.url || pageUrl);
      if (initPlayerFormats.length) return { formats: initPlayerFormats };

      const packedFormats = collectPackedMediaFormats(html, response.url || pageUrl);
      if (packedFormats.length) return { formats: packedFormats };

      const encodedFormats = collectEncodedMediaFormats(html, response.url || pageUrl);
      if (encodedFormats.length) return { formats: encodedFormats };

      const apiStreamFormats = await fetchApiStreamFormats(html, response.url || pageUrl);
      if (apiStreamFormats.length) return { formats: apiStreamFormats };

      const knownHosterFormats = await fetchKnownHosterFormats(response.url || pageUrl, videoInfo.webpage_url || videoInfo.url || pageUrl);
      if (knownHosterFormats.length) return { formats: knownHosterFormats };

      const embeddedPlayerFormats = await fetchEmbeddedPlayerFormats(html, response.url || pageUrl);
      if (embeddedPlayerFormats.length) return { formats: embeddedPlayerFormats };

      const dooplayFormats = await fetchDooplayFormats(html, response.url || pageUrl);
      if (dooplayFormats.length) return { formats: dooplayFormats };

      const kvsFormats = await fetchKvsApiFormats(response.url || pageUrl);
      if (kvsFormats.length) return { formats: kvsFormats };

      if (staticMediaUrls.length) {
        const seedStaticFormats = collectStaticMediaFormats("", videoInfo?.webpage_url || videoInfo?.url || "");
        const usableSeedStaticFormats = await filterUsableSeedStaticFormats(seedStaticFormats, videoInfo?.webpage_url || videoInfo?.url || "");
        if (usableSeedStaticFormats.length) return { formats: usableSeedStaticFormats };
      }

      const resolvedPageUrl = response.url || pageUrl;
      const shouldRetrySourcePage =
        /^https?:\/\//i.test(sourcePageUrl) &&
        sourcePageUrl !== pageUrl &&
        sourcePageUrl !== resolvedPageUrl;

      if (!shouldRetrySourcePage) return direct;

      try {
        const sourceResponse = await fetchWithTimeout(sourcePageUrl, {
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: sourcePageUrl,
          },
        });
        if (!sourceResponse.ok) return direct;

        const sourceHtml = await sourceResponse.text();
        const resolvedSourceUrl = sourceResponse.url || sourcePageUrl;

        const sourceEmbeddedFormats = await fetchEmbeddedPlayerFormats(sourceHtml, resolvedSourceUrl);
        if (sourceEmbeddedFormats.length) return { formats: sourceEmbeddedFormats };

        const sourceDooplayFormats = await fetchDooplayFormats(sourceHtml, resolvedSourceUrl);
        if (sourceDooplayFormats.length) return { formats: sourceDooplayFormats };

        const sourceKvsFormats = await fetchKvsApiFormats(resolvedSourceUrl);
        if (sourceKvsFormats.length) return { formats: sourceKvsFormats };
      } catch {}

      const fallbackSeedStaticFormats = staticMediaUrls.length
        ? await filterUsableSeedStaticFormats(
            collectStaticMediaFormats("", sourcePageUrl || pageUrl || ""),
            sourcePageUrl || pageUrl || ""
          )
        : [];
      if (fallbackSeedStaticFormats.length) return { formats: fallbackSeedStaticFormats };
      return direct;
    },

    async prepareDownload({ videoInfo, selectedFormat, formats = [], tabId }) {
      if (!preferredMediaUrlPatterns.length && !blockedMediaUrlPatterns.length && !mediaUrlRewriteRules.length && !directChromeDownloadUrlPatterns.length && !resolvePageFlashvarsInMainWorld && !allowTemplateHlsMediaUrls) {
        return { videoInfo, selectedFormat };
      }
      const pageUrl = videoInfo?.webpage_url || videoInfo?.url || videoInfo?.sourcePageUrl || "";
      const seedStaticFormats = staticMediaUrls.length ? collectStaticMediaFormats("", pageUrl) : [];
      const knownCandidates = [selectedFormat, ...(Array.isArray(formats) ? formats : []), ...(Array.isArray(videoInfo?.formats) ? videoInfo.formats : [])]
        .filter((format) => format && /^https?:\/\//i.test(String(format.url || "")) && !isSourcePageUrl(format.url, videoInfo));
      const hasPreferredKnownCandidate = knownCandidates.some((format) =>
        !isBlockedFormatUrl(rewriteMediaUrl(format.url, pageUrl)) && (
          matchesAnyPattern(String(rewriteMediaUrl(format.url, pageUrl) || ""), preferredMediaUrlPatterns) ||
          isDirectChromeDownloadUrl(rewriteMediaUrl(format.url, pageUrl))
        )
      );
      const mainWorldFormats = hasPreferredKnownCandidate
        ? []
        : await collectMainWorldFlashvarsFormats(tabId, pageUrl);
      const candidates = [...knownCandidates, ...mainWorldFormats, ...seedStaticFormats]
        .filter((format) => format && /^https?:\/\//i.test(String(format.url || "")));
      const seen = new Set();
      const unique = candidates.filter((format) => {
        const url = rewriteMediaUrl(String(format.url || "").replace(/&amp;/g, "&"), pageUrl);
        if (!url || seen.has(url)) return false;
        seen.add(url);
        format.url = url;
        return true;
      });
      const usableUnique = await filterUsableSeedStaticFormats(unique, pageUrl);
      const resolvedUnique = allowTemplateHlsMediaUrls
        ? await Promise.all(usableUnique.map((format) => resolveTemplateHlsMasterFormat(format, pageUrl)))
        : usableUnique;
      const scored = resolvedUnique
        .filter((format) => !isBlockedFormatUrl(format.url))
        .map((format) => ({
          format,
          score: formatPreferenceScore(format),
        })).sort((left, right) => right.score - left.score);
      const fallbackSelected = selectedFormat?.url && !isBlockedFormatUrl(selectedFormat.url) && !isSourcePageUrl(selectedFormat.url, videoInfo)
        ? selectedFormat
        : null;
      const preferred = markDirectChromeDownload({ ...(scored[0]?.format || fallbackSelected || {}) });
      if (preferred?.url && preferred.format_type !== "hls" && !isDirectChromeDownloadUrl(preferred.url) && isNosofilesMediaUrl(preferred.url)) {
        preferred.forceTabDownload = true;
        delete preferred.forceOffscreenDownload;
        delete preferred.forceChromeDownload;
        preferred.refererUrl = preferred.refererUrl || forcedMediaRefererUrl || videoInfo?.webpage_url || videoInfo?.url || videoInfo?.sourcePageUrl || "";
        preferred.requiresReferer = true;
        preferred.requiresRangeRequest = true;
      }
      if (preferred?.url && preferred.format_type !== "hls" && requiresRangeRequestUrl(preferred.url)) {
        preferred.requiresRangeRequest = true;
      }
      if (offscreenDownloadWithHeaderRules && preferred?.url && preferred.format_type !== "hls" && !isDirectChromeDownloadUrl(preferred.url)) {
        preferred.forceOffscreenDownload = true;
        preferred.refererUrl = preferred.refererUrl || forcedMediaRefererUrl || videoInfo?.webpage_url || videoInfo?.url || videoInfo?.sourcePageUrl || "";
        preferred.requiresReferer = true;
        delete preferred.forceChromeDownload;
        delete preferred.forceTabDownload;
      }
      if (chromeDownloadWithHeaderRules && preferred?.url && preferred.format_type !== "hls" && !preferred.forceOffscreenDownload && !preferred.forceTabDownload && !isDirectChromeDownloadUrl(preferred.url)) {
        preferred.forceChromeDownload = true;
        preferred.useDownloadHeaderRules = true;
        preferred.refererUrl = preferred.refererUrl || forcedMediaRefererUrl || videoInfo?.webpage_url || videoInfo?.url || videoInfo?.sourcePageUrl || "";
        preferred.requiresReferer = true;
      }
      if (tabInitiatedDownloadWithHeaderRules && preferred?.url && preferred.format_type !== "hls" && !preferred.forceOffscreenDownload && !isDirectChromeDownloadUrl(preferred.url)) {
        preferred.forceTabDownload = true;
        preferred.useDownloadHeaderRules = true;
        preferred.refererUrl = preferred.refererUrl || forcedMediaRefererUrl || videoInfo?.webpage_url || videoInfo?.url || videoInfo?.sourcePageUrl || "";
        preferred.requiresReferer = true;
      }
      const isOffscreenHls = Boolean(preferred?.forceOffscreenHls || (Array.isArray(preferred?.segments) && preferred.segments.length));
      if (chromeDownloadHlsSegmentWithHeaderRules && preferred?.url && preferred.format_type === "hls" && !isOffscreenHls) {
        preferred.forceChromeHlsSegmentDownload = true;
        preferred.useDownloadHeaderRules = true;
        preferred.refererUrl = preferred.refererUrl || forcedMediaRefererUrl || videoInfo?.webpage_url || videoInfo?.url || videoInfo?.sourcePageUrl || "";
        preferred.requiresReferer = true;
      } else if (chromeDownloadHlsWithHeaderRules && preferred?.url && preferred.format_type === "hls" && !isOffscreenHls) {
        preferred.forceChromeDownload = true;
        preferred.useDownloadHeaderRules = true;
        preferred.refererUrl = preferred.refererUrl || forcedMediaRefererUrl || videoInfo?.webpage_url || videoInfo?.url || videoInfo?.sourcePageUrl || "";
        preferred.requiresReferer = true;
      }
      if (forcedMediaRefererUrl && preferred?.url && preferred.format_type === "hls") {
        preferred.refererUrl = preferred.refererUrl || forcedMediaRefererUrl;
        preferred.requiresReferer = true;
      }
      let prepared = preferred;
      if (resolveDownloadRedirectBeforeDownload && prepared?.url) {
        prepared = await resolveDownloadRedirectFormat(prepared, pageUrl, videoInfo);
        if (chromeDownloadWithHeaderRules && prepared?.url && prepared.format_type !== "hls" && !prepared.forceOffscreenDownload && !prepared.forceTabDownload && !isDirectChromeDownloadUrl(prepared.url)) {
          prepared.forceChromeDownload = true;
          prepared.useDownloadHeaderRules = true;
          prepared.refererUrl = prepared.refererUrl || forcedMediaRefererUrl || videoInfo?.webpage_url || videoInfo?.url || videoInfo?.sourcePageUrl || "";
          prepared.requiresReferer = true;
        }
        if (offscreenDownloadWithHeaderRules && prepared?.url && prepared.format_type !== "hls" && !isDirectChromeDownloadUrl(prepared.url)) {
          prepared.forceOffscreenDownload = true;
          prepared.refererUrl = prepared.refererUrl || forcedMediaRefererUrl || videoInfo?.webpage_url || videoInfo?.url || videoInfo?.sourcePageUrl || "";
          prepared.requiresReferer = true;
          delete prepared.forceChromeDownload;
          delete prepared.forceTabDownload;
        }
      }
      if (removeCookieHeaderForDownload && prepared?.requiresReferer) {
        prepared.removeCookieHeaderForDownload = true;
      }
      if (downloadHeaderRuleExtraDomains.length && prepared?.useDownloadHeaderRules) {
        prepared.downloadHeaderRuleExtraDomains = downloadHeaderRuleExtraDomains;
      }
      return { videoInfo, selectedFormat: markDirectChromeDownload(prepared) };
    },
  };

  try {
    globalThis.SerpSiteAdapter = SiteAdapter;
  } catch {}
})();
