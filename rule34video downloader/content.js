// content.js
// Generated generic direct-video content adapter stub.
(function () {
  const SiteConfig = globalThis.SiteConfig || {};
  const Bridge = globalThis.SerpContentBridge || {};
  const Adapter = globalThis.SerpSiteAdapter || {};
  const logger = (globalThis.Logger && globalThis.Logger.createLogger("[Rule 34 Content]")) || { log() {}, warn() {}, error() {} };
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
  const videoInfoPollMs = 0;
  const videoInfoPollCount = 0;
  const injectPageDataRelay = false;
  let generatedPageData = null;

  function list(name, fallback) {
    const value = selectors[name];
    return Array.isArray(value) && value.length ? value : fallback;
  }

  function textFromSelector(selector) {
    try {
      const node = document.querySelector(selector);
      if (!node) return "";
      return (node.getAttribute("content") || node.getAttribute("title") || node.textContent || "").trim();
    } catch {
      return "";
    }
  }

  function attrFromSelector(selector, attrs) {
    try {
      const node = document.querySelector(selector);
      if (!node) return "";
      for (const attr of attrs) {
        const value = node.getAttribute(attr);
        if (value) return value.trim();
      }
    } catch {}
    return "";
  }

  function toAbsoluteUrl(url) {
    try {
      if (!url) return "";
      return /^https?:\/\//i.test(url) ? url : new URL(url, location.href).toString();
    } catch {
      return url || "";
    }
  }

  function looksPlayable(url) {
    if (!url) return false;
    if (/\.\.\./.test(url)) return false;
    if (/sprite|thumbnail|thumb|preview|mediabook|timelines\.php|\.vtt(?:$|[?#])/i.test(url)) return false;
    if (/^https?:\/\/[^/]*cloudflarestream\.com\/[^/]+\/video\/[^/]+\/(?:init|seg_\d+)\.mp4(?:$|[?#])/i.test(url)) return false;
    return /\.(mp4|m4v|webm|m3u8)(?:$|[?#])/i.test(url) || /\/player\/xs1\.php\?data=/i.test(url) || /^https?:\/\/[^/]+\/[^?#]*\/cf-master\.[^/?#]+\.txt(?:$|[?#])/i.test(url) || /^https?:\/\/[^/]+\/sora\/[^?#]+\/[^?#]+(?:$|[?#])/i.test(url) || /^https?:\/\/(?:[^/]+\.)?aki-h\.stream\/(?:file|file2|quality2)\/[^?#]+(?:$|[?#/])/i.test(url);
  }

  function addCandidate(candidates, url, source) {
    const absolute = toAbsoluteUrl(url);
    if (!looksPlayable(absolute)) return;
    if (candidates.some((item) => item.url === absolute)) return;
    const isHls = /\.m3u8(?:$|[?#])/i.test(absolute) || /\/player\/xs1\.php\?data=/i.test(absolute) || /\/cf-master\.[^/?#]+\.txt(?:$|[?#])/i.test(absolute);
    candidates.push({
      url: absolute,
      ext: isHls ? "m3u8" : (/\.webm(?:$|[?#/])/i.test(absolute) ? "webm" : (/\.m4v(?:$|[?#/])/i.test(absolute) ? "m4v" : "mp4")),
      format_type: isHls ? "hls" : "mp4",
      protocol: isHls ? "m3u8_native" : "https",
      quality: source || "auto",
      format_id: source || (isHls ? "hls" : "mp4"),
      source: source || "dom",
    });
  }

  function collectPerformanceMediaCandidates(candidates) {
    try {
      const entries = [
        ...performance.getEntriesByType("resource"),
        ...performance.getEntriesByType("navigation"),
      ];
      for (const entry of entries) {
        addCandidate(candidates, entry.name, "performance");
      }
    } catch {}
  }

  function defaultCollectCandidates() {
    const candidates = [];
    try {
      if (Bridge.collectMediaCandidates) {
        for (const item of Bridge.collectMediaCandidates(document)) {
          addCandidate(candidates, item.url, item.source);
        }
      }
    } catch {}

    for (const selector of list("video", ["video[src]", "source[src]"])) {
      try {
        document.querySelectorAll(selector).forEach((node) => {
          addCandidate(candidates, node.getAttribute("src") || node.getAttribute("data-src") || node.getAttribute("content"), selector);
        });
      } catch {}
    }

    try {
      const mediaUrlRe = /(https?:[^"'\\\s]+\.(?:mp4|m4v|webm|m3u8)[^"'\\\s]*)/gi;
      document.querySelectorAll("script").forEach((script) => {
        const text = script.textContent || "";
        let match;
        while ((match = mediaUrlRe.exec(text)) !== null) {
          addCandidate(candidates, match[1], "script");
        }
      });
    } catch {}

    try {
      const pageData = generatedPageData || {};
      if (Array.isArray(pageData.videos)) {
        pageData.videos.forEach((url) => addCandidate(candidates, url, "page-data-video"));
      }
      const flashvars = pageData.flashvars || {};
      ["video_url", "video_alt_url", "video_alt_url2", "video_alt_url3"].forEach((key) => {
        const value = flashvars && typeof flashvars[key] === "string" ? flashvars[key] : "";
        if (value) addCandidate(candidates, value, "page-flashvars");
      });
    } catch {}

    collectPerformanceMediaCandidates(candidates);

    return candidates;
  }

  function collectCandidates() {
    if (typeof Adapter.collectCandidates === "function") {
      try {
        const result = Adapter.collectCandidates({
          SiteConfig,
          Bridge,
          document,
          location,
          logger,
          defaultCollectCandidates,
          collectPerformanceMediaCandidates,
          addCandidate,
        });
        if (Array.isArray(result)) return result;
      } catch (error) {
        logger.warn("Site adapter collectCandidates hook failed", error);
      }
    }
    return defaultCollectCandidates();
  }

  function extractTitle() {
    for (const selector of list("title", ['meta[property="og:title"]', "h1", "title"])) {
      const value = textFromSelector(selector);
      if (value) return value;
    }
    return document.title || SiteConfig.SITE_NAME || "Video";
  }

  function extractThumbnail() {
    for (const selector of list("thumbnail", ['meta[property="og:image"]', "video[poster]"])) {
      const value = attrFromSelector(selector, ["content", "poster", "src"]);
      if (value) return toAbsoluteUrl(value);
    }
    return "";
  }

  function defaultExtractVideoInfo() {
    const formats = collectCandidates();
    const selected = formats.find((format) => format.format_type === "mp4") || formats[0] || null;
    const slug = (location.pathname || "").split("/").filter(Boolean).pop() || "";
    return {
      id: slug || String(Date.now()),
      display_id: slug,
      title: extractTitle(),
      thumbnail: extractThumbnail(),
      url: location.href,
      webpage_url: location.href,
      video_url: selected && selected.url,
      formats,
      method: "generated-direct-video-stub",
    };
  }

  function extractVideoInfo() {
    const defaults = defaultExtractVideoInfo();
    if (typeof Adapter.extractVideoInfo === "function") {
      try {
        const custom = Adapter.extractVideoInfo({
          SiteConfig,
          Bridge,
          document,
          location,
          logger,
          defaults,
          defaultExtractVideoInfo,
          collectCandidates,
        });
        if (custom && typeof custom === "object") {
          return { ...defaults, ...custom };
        }
      } catch (error) {
        logger.warn("Site adapter extractVideoInfo hook failed", error);
      }
    }
    return defaults;
  }

  function getVideoCandidates() {
    return {
      videoInfo: extractVideoInfo(),
      candidates: collectCandidates().map((item) => item.url),
    };
  }

  if (Bridge.exposeExtractor) Bridge.exposeExtractor(extractVideoInfo);
  else {
    try { globalThis.extractVideoInfo = extractVideoInfo; } catch {}
  }

  if (Bridge.registerStandardMessages) {
    Bridge.registerStandardMessages({
      extractVideoInfo,
      getVideoCandidates,
      logger,
      isVideoInfoReady(info) {
        return Boolean(info && (
          info.video_url ||
          info.playerUrl ||
          info.embed_url ||
          info.vjavVideoId ||
          (Array.isArray(info.formats) && info.formats.length)
        ));
      },
      notFoundError: "No video player or direct video URL found yet.",
    });
    Bridge.observeVideoDetection({ extractVideoInfo, selectors: ["video", "source"], logger });
    Bridge.runInitialVideoCheck({ extractVideoInfo, logger });
    if (injectPageDataRelay && Bridge.listenForPageData && Bridge.injectPageScript) {
      Bridge.listenForPageData({
        dataType: "SERP_GENERATED_PAGE_DATA",
        updatedAction: false,
        onData(payload) {
          generatedPageData = payload || null;
          try {
            Bridge.safeSendMessage({ action: "videoDetected", data: extractVideoInfo() }).catch(function () {});
          } catch {}
        },
      });
      Bridge.injectPageScript({ script: "inject.js", requestType: "REQUEST_SERP_GENERATED_PAGE_DATA", logger });
    }
    if (videoInfoPollMs > 0 && videoInfoPollCount > 0) {
      let remainingPolls = videoInfoPollCount;
      const pollTimer = setInterval(() => {
        remainingPolls -= 1;
        try {
          if (injectPageDataRelay) globalThis.postMessage({ type: "REQUEST_SERP_GENERATED_PAGE_DATA" }, "*");
          Bridge.safeSendMessage({ action: "videoDetected", data: extractVideoInfo() }).catch(function () {});
        } catch (error) {
          logger.warn("Video info poll failed", error);
        }
        if (remainingPolls <= 0) clearInterval(pollTimer);
      }, videoInfoPollMs);
    }
  } else {
    logger.warn("SerpContentBridge unavailable; generated content adapter stub was not registered.");
  }
})();
