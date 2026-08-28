// Unified content-script bridge shared core.
// Defines common helpers only; site adapters opt in by calling SerpContentBridge.
(function () {
  if (globalThis.SerpContentBridge) return;

  const noopLogger = {
    log: function () {},
    warn: function () {},
    error: function () {},
  };

  function createLogger(label) {
    try {
      if (globalThis.Logger && typeof globalThis.Logger.createLogger === "function") {
        return globalThis.Logger.createLogger(label || "[SERP Content]");
      }
    } catch {}
    return noopLogger;
  }

  const Logger = createLogger("[SERP Content Bridge]");

  function ensureMap(name) {
    try {
      if (globalThis[name] instanceof Map) return globalThis[name];
      globalThis[name] = new Map();
      return globalThis[name];
    } catch {
      return new Map();
    }
  }

  function ensureSet(name) {
    try {
      if (globalThis[name] instanceof Set) return globalThis[name];
      globalThis[name] = new Set();
      return globalThis[name];
    } catch {
      return new Set();
    }
  }

  function getDownloadState() {
    return {
      currentDownloads: ensureMap("currentDownloads"),
      cancelledDownloadIds: ensureSet("cancelledDownloadIds"),
      createDownloadManager: globalThis.createDownloadManager || function () {},
      showDownloadManager: globalThis.showDownloadManager || function () {},
      hideDownloadManager: globalThis.hideDownloadManager || function () {},
      addDownload: globalThis.addDownload || function () {},
      removeDownload: globalThis.removeDownload || function () {},
      cancelDownload: globalThis.cancelDownload || function () {},
      updateDownloadProgress: globalThis.updateDownloadProgress || function () {},
      showDownloadProgress: globalThis.showDownloadProgress || function () {},
    };
  }

  function safeSendMessage(message) {
    try {
      if (
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        typeof chrome.runtime.sendMessage === "function"
      ) {
        const result = chrome.runtime.sendMessage(message);
        return result && typeof result.then === "function" ? result : Promise.resolve(result);
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.reject(new Error("chrome.runtime.sendMessage unavailable"));
  }

  function sendResponseSafe(sendResponse, payload) {
    try {
      if (typeof sendResponse === "function") sendResponse(payload);
    } catch {}
  }

  function messagePayload(request) {
    if (request && request.data && typeof request.data === "object") return request.data;
    return request || {};
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      try {
        const reader = new FileReader();
        reader.onloadend = function () {
          resolve(reader.result);
        };
        reader.onerror = function () {
          reject(reader.error || new Error("Failed to read blob"));
        };
        reader.readAsDataURL(blob);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function fetchThumbnailData(url, options) {
    if (!url) throw new Error("Missing thumbnail URL");
    const fetchInit = Object.assign(
      {
        credentials: (options && options.credentials) || "include",
        referrer: (options && options.referrer) || globalThis.location.href,
      },
      (options && options.fetchOptions) || {},
    );
    const response = await fetch(url, fetchInit);
    if (!response.ok) throw new Error(`Thumbnail fetch failed (${response.status})`);
    return blobToDataUrl(await response.blob());
  }

  function hasDownload(state, downloadId) {
    return (
      state.currentDownloads.has(downloadId) ||
      state.currentDownloads.has(String(downloadId || ""))
    );
  }

  function isCancelled(state, downloadId) {
    const id = String(downloadId || "");
    return state.cancelledDownloadIds.has(id) || state.cancelledDownloadIds.has(downloadId);
  }

  function defaultFilename(downloadId) {
    return `Video_${String(downloadId || "download").split("-").pop()}.mp4`;
  }

  function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback || 0;
  }

  function addIfMissing(state, downloadId, filename, totalSize) {
    if (!downloadId || hasDownload(state, downloadId)) return;
    state.addDownload(downloadId, filename || defaultFilename(downloadId), positiveNumber(totalSize, 0));
  }

  function normalizeProgressStatus(value, fallback) {
    const status = String(value || fallback || "Downloading...").trim();
    const lower = status.toLowerCase();
    if (lower === "complete" || lower === "completed" || lower === "done") return "Complete";
    if (lower === "failed" || lower === "error" || lower === "interrupted") return "Failed";
    return status || "Downloading...";
  }

  function normalizeDownloadProgressPayload(request) {
    const data = messagePayload(request);
    const downloadId = data.downloadId || request.downloadId;
    const strategy = String(data.strategy || data.downloadStrategy || "").toLowerCase();
    const isHLS =
      data.isHLS === true ||
      data.isHls === true ||
      strategy.includes("hls") ||
      String(downloadId || "").toLowerCase().includes("hls");
    const segmentIndex = positiveNumber(data.segmentIndex ?? data.currentSegment ?? data.current, 0);
    const totalSegments = positiveNumber(data.totalSegments ?? data.segmentsTotal ?? data.totalSegmentsCount, 0);
    const downloadedBytes = positiveNumber(data.downloadedBytes ?? data.bytesReceived ?? data.downloaded, 0);
    const totalBytes = positiveNumber(data.totalBytes ?? data.bytesTotal ?? data.total, 0);
    const rawProgress = Number(data.progress);
    const computedProgress =
      Number.isFinite(rawProgress) && rawProgress >= 0
        ? Math.max(0, Math.min(100, rawProgress))
        : totalBytes > 0
          ? Math.max(0, Math.min(100, (downloadedBytes / totalBytes) * 100))
          : totalSegments > 0
            ? Math.max(0, Math.min(100, (segmentIndex / totalSegments) * 100))
            : 0;
    const status = normalizeProgressStatus(
      data.status || data.state || (data.error ? "Failed" : ""),
      computedProgress >= 100 ? "Complete" : "Downloading...",
    );
    const progress = status === "Complete" ? 100 : computedProgress;

    return {
      downloadId,
      filename: data.filename || data.fileName || data.name || defaultFilename(downloadId),
      strategy,
      isHLS,
      downloadedBytes,
      totalBytes,
      progress,
      status,
      segmentIndex,
      totalSegments,
      error: data.error || "",
    };
  }

  function handleCanonicalDownloadProgress(request) {
    const state = getDownloadState();
    const progressData = normalizeDownloadProgressPayload(request);
    const downloadId = progressData.downloadId;
    if (!downloadId) return true;
    if (isCancelled(state, downloadId)) return true;

    state.showDownloadManager();

    const rowTotal = progressData.isHLS
      ? progressData.totalSegments || 100
      : progressData.totalBytes || progressData.downloadedBytes || 0;
    addIfMissing(state, downloadId, progressData.filename, rowTotal);

    if (progressData.isHLS) {
      const current = progressData.segmentIndex || progressData.progress;
      const total = progressData.totalSegments || 100;
      state.updateDownloadProgress(
        downloadId,
        current,
        total,
        progressData.progress,
        progressData.error || progressData.status,
        true,
        { current, total },
      );
      return true;
    }

    state.updateDownloadProgress(
      downloadId,
      progressData.downloadedBytes,
      progressData.totalBytes,
      progressData.progress,
      progressData.error || progressData.status,
      false,
    );
    return true;
  }

  function handleProgressMessage(action, request, options) {
    const state = getDownloadState();
    const data = messagePayload(request);
    const downloadId = data.downloadId || request.downloadId;
    const labels = Object.assign(
      {
        hlsProgress: "Downloading...",
        hlsComplete: "Downloaded",
        hlsError: "Failed",
        mp4Progress: "Downloading",
        mp4Complete: "Downloaded",
        mp4Error: "Failed",
      },
      (options && options.progressLabels) || {},
    );

    if (action === "hideDownloadProgress" || action === "hideDownloadManager") {
      state.hideDownloadManager();
      return true;
    }

    if (action === "cancelHLSSegments" || action === "cancelBlobDownload") {
      if (downloadId) {
        state.cancelledDownloadIds.add(String(downloadId));
        state.cancelDownload(downloadId);
      }
      return true;
    }

    if (!downloadId) return true;

    if (action === "downloadProgress") {
      return handleCanonicalDownloadProgress(request);
    }

    if (action === "hlsProgress") {
      if (isCancelled(state, downloadId)) return true;
      state.showDownloadManager();
      addIfMissing(state, downloadId, data.filename || defaultFilename(downloadId), data.totalSize || data.fileSize || 0);
      const current = positiveNumber(data.segmentIndex ?? data.current, 0);
      const total = positiveNumber(data.totalSegments ?? data.total, 0);
      state.updateDownloadProgress(
        downloadId,
        current,
        total,
        positiveNumber(data.progress, 0),
        data.status || labels.hlsProgress,
        true,
        { current, total },
      );
      return true;
    }

    if (action === "mp4Progress") {
      state.showDownloadManager();
      const total = positiveNumber(data.total, 0);
      addIfMissing(state, downloadId, data.filename || defaultFilename(downloadId), total);
      state.updateDownloadProgress(
        downloadId,
        positiveNumber(data.downloaded, 0),
        total,
        positiveNumber(data.progress, 0),
        data.status || labels.mp4Progress,
      );
      return true;
    }

    if (action === "hlsComplete" || action === "mp4Complete") {
      if (action === "hlsComplete" && isCancelled(state, downloadId)) return true;
      addIfMissing(state, downloadId, data.filename || "video.mp4", data.fileSize || data.total || 0);
      state.updateDownloadProgress(
        downloadId,
        100,
        100,
        100,
        data.status || labels[action],
      );
      return true;
    }

    if (action === "hlsError" || action === "mp4Error") {
      if (action === "hlsError" && isCancelled(state, downloadId)) return true;
      addIfMissing(state, downloadId, data.filename || "video.mp4", data.fileSize || data.total || 0);
      state.updateDownloadProgress(
        downloadId,
        0,
        0,
        0,
        data.status || data.error || labels[action],
      );
      return true;
    }

    return false;
  }

  function registerStandardMessages(options) {
    const config = options || {};
    const logger = config.logger || Logger;
    const extractVideoInfo = config.extractVideoInfo;
    const getVideoCandidates = config.getVideoCandidates;
    const getPageAssets = typeof config.getPageAssets === "function" ? config.getPageAssets : null;
    const getPrimaryAsset = typeof config.getPrimaryAsset === "function" ? config.getPrimaryAsset : null;
    const isVideoInfoReady =
      typeof config.isVideoInfoReady === "function" ? config.isVideoInfoReady : null;
    const isPageAssetsReady =
      typeof config.isPageAssetsReady === "function" ? config.isPageAssetsReady : null;
    const handledActions = new Set([
      "getVideoInfo",
      "getVideoCandidates",
      "getPageAssets",
      "getPrimaryAsset",
      "fetchThumbnailData",
      "downloadProgress",
      "hlsProgress",
      "mp4Progress",
      "hlsComplete",
      "mp4Complete",
      "hlsError",
      "mp4Error",
      "cancelHLSSegments",
      "cancelBlobDownload",
      "hideDownloadProgress",
      "hideDownloadManager",
    ]);

    try {
      if (!chrome.runtime || !chrome.runtime.onMessage) return function () {};
      chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        const action = request && (request.action || request.type);

        try {
          if (typeof config.onMessage === "function") {
            const customResult = config.onMessage(request, sender, sendResponse, bridge);
            if (customResult !== undefined && customResult !== false) return customResult;
          }
        } catch (error) {
          logger.warn("Custom content message handler failed", error);
          sendResponseSafe(sendResponse, { success: false, error: error.message || String(error) });
          return true;
        }

        if (!handledActions.has(action)) return false;

        if (action === "getVideoInfo") {
          try {
            if (typeof config.beforeGetVideoInfo === "function") {
              config.beforeGetVideoInfo(request, sender, bridge);
            }
            const data = extractVideoInfo && extractVideoInfo();
            if (isVideoInfoReady && !isVideoInfoReady(data, request, sender, bridge)) {
              sendResponseSafe(sendResponse, {
                success: false,
                error: config.notFoundError || "Could not extract video information",
              });
              return true;
            }
            sendResponseSafe(sendResponse, { success: true, data });
          } catch (error) {
            if (typeof config.getVideoInfoFallback === "function") {
              try {
                const fallback = config.getVideoInfoFallback(error, request, sender, bridge);
                sendResponseSafe(sendResponse, { success: true, data: fallback });
                return true;
              } catch (fallbackError) {
                sendResponseSafe(sendResponse, {
                  success: false,
                  error: fallbackError.message || error.message || "Video extraction failed",
                });
                return true;
              }
            }
            sendResponseSafe(sendResponse, { success: false, error: error.message || "Video extraction failed" });
          }
          return true;
        }

        if (action === "getVideoCandidates") {
          try {
            const data =
              typeof getVideoCandidates === "function"
                ? getVideoCandidates(request, sender, bridge)
                : { videoInfo: extractVideoInfo && extractVideoInfo(), candidates: [] };
            sendResponseSafe(sendResponse, { success: true, data });
          } catch (error) {
            sendResponseSafe(sendResponse, { success: false, error: error.message || "Candidate extraction failed" });
          }
          return true;
        }

        if (action === "getPageAssets") {
          try {
            const data =
              typeof getPageAssets === "function"
                ? getPageAssets(request, sender, bridge)
                : { assets: [] };
            if (isPageAssetsReady && !isPageAssetsReady(data, request, sender, bridge)) {
              sendResponseSafe(sendResponse, {
                success: false,
                error: config.pageAssetsNotFoundError || "Could not extract page assets",
              });
              return true;
            }
            sendResponseSafe(sendResponse, { success: true, data });
          } catch (error) {
            sendResponseSafe(sendResponse, { success: false, error: error.message || "Page asset extraction failed" });
          }
          return true;
        }

        if (action === "getPrimaryAsset") {
          try {
            const data =
              typeof getPrimaryAsset === "function"
                ? getPrimaryAsset(request, sender, bridge)
                : (() => {
                    const result = typeof getPageAssets === "function" ? getPageAssets(request, sender, bridge) : { assets: [] };
                    const assets = Array.isArray(result && result.assets) ? result.assets : [];
                    const primary = assets.find(function (asset) { return asset && asset.isPrimary; }) || assets[0] || null;
                    return { asset: primary };
                  })();
            if (!data || !(data.asset || data.data || data.primaryAsset)) {
              sendResponseSafe(sendResponse, {
                success: false,
                error: config.primaryAssetNotFoundError || "Could not determine primary asset",
              });
              return true;
            }
            sendResponseSafe(sendResponse, { success: true, data });
          } catch (error) {
            sendResponseSafe(sendResponse, { success: false, error: error.message || "Primary asset extraction failed" });
          }
          return true;
        }

        if (action === "fetchThumbnailData") {
          (async function () {
            try {
              const data = messagePayload(request);
              const fetchOptions =
                typeof config.getThumbnailFetchOptions === "function"
                  ? config.getThumbnailFetchOptions(data.url || request.url, request, sender, bridge)
                  : config.thumbnailFetchOptions || {};
              const dataUrl = await fetchThumbnailData(data.url || request.url, {
                credentials: data.credentials || request.credentials || "include",
                referrer: data.referrer || request.referrer || globalThis.location.href,
                fetchOptions,
              });
              sendResponseSafe(sendResponse, { success: true, dataUrl });
            } catch (error) {
              sendResponseSafe(sendResponse, { success: false, error: error.message || "Thumbnail fetch failed" });
            }
          })();
          return true;
        }

        if (handleProgressMessage(action, request, config)) {
          sendResponseSafe(sendResponse, { success: true });
          return true;
        }

        return false;
      });
    } catch (error) {
      logger.warn("Content message bridge setup failed", error);
    }

    return function () {};
  }

  function nodeMatches(node, selectors) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    for (const selector of selectors) {
      try {
        if (node.matches && node.matches(selector)) return true;
        if (node.querySelector && node.querySelector(selector)) return true;
      } catch {}
    }
    return false;
  }

  function observeVideoDetection(options) {
    const config = options || {};
    const selectors = (config.selectors && config.selectors.length ? config.selectors : ["video"]).filter(Boolean);
    const extractVideoInfo = config.extractVideoInfo;
    const action = config.action || "videoDetected";
    const logger = config.logger || Logger;

    try {
      if (!globalThis.MutationObserver || !document.body) return null;
      const observer = new MutationObserver(function (mutations) {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes || []) {
            if (!nodeMatches(node, selectors)) continue;
            safeSendMessage({ action, data: extractVideoInfo && extractVideoInfo() }).catch(function () {});
            return;
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return observer;
    } catch (error) {
      logger.warn("Video detection observer setup failed", error);
      return null;
    }
  }

  function hasVideoInfo(info) {
    return Boolean(
      info &&
        (info.id ||
          info.display_id ||
          info.video_url ||
          info.url ||
          (Array.isArray(info.formats) && info.formats.length)),
    );
  }

  function runInitialVideoCheck(options) {
    const config = options || {};
    const extractVideoInfo = config.extractVideoInfo;
    const logger = config.logger || Logger;
    const isReady = config.isReady || hasVideoInfo;
    const label = config.label || "Video found";
    const check = function () {
      try {
        const info = extractVideoInfo && extractVideoInfo();
        if (isReady(info)) {
          logger.log(label, info);
          safeSendMessage({ action: "videoDetected", data: info }).catch(function () {});
        }
      } catch (error) {
        logger.warn("Initial video check failed", error);
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", check, { once: true });
    } else {
      check();
    }
    [1000, 3000, 7000].forEach(function (delay) {
      try {
        setTimeout(check, delay);
      } catch {}
    });
  }

  function exposeExtractor(extractVideoInfo, name) {
    if (typeof extractVideoInfo !== "function") return;
    try {
      globalThis[name || "extractVideoInfo"] = extractVideoInfo;
    } catch {}
  }

  function injectPageScript(options) {
    const config = typeof options === "string" ? { script: options } : options || {};
    const scriptName = config.script || "inject.js";
    const logger = config.logger || Logger;

    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL(scriptName);
      script.onload = function () {
        try {
          if (config.requestType) globalThis.postMessage({ type: config.requestType }, "*");
        } catch {}
        try {
          this.remove();
        } catch {}
      };
      (document.head || document.documentElement).appendChild(script);
      return script;
    } catch (error) {
      logger.warn("Page script injection failed", error);
      return null;
    }
  }

  function listenForPageData(options) {
    const config = options || {};
    const dataType = config.dataType;
    if (!dataType) return function () {};

    const handler = function (event) {
      const data = event && event.data;
      if (!data || data.type !== dataType) return;
      const payload = data.data || data.videoData || data.payload || data;
      try {
        if (config.storageKey) globalThis[config.storageKey] = payload;
      } catch {}
      try {
        if (typeof config.onData === "function") config.onData(payload, event, bridge);
      } catch (error) {
        Logger.warn("Page data handler failed", error);
      }
      if (config.updatedAction !== false) {
        safeSendMessage({ action: config.updatedAction || "videoDataUpdated", data: payload }).catch(function () {});
      }
    };

    globalThis.addEventListener("message", handler);
    return function () {
      try {
        globalThis.removeEventListener("message", handler);
      } catch {}
    };
  }

  function toAbsoluteUrl(url, baseUrl) {
    try {
      if (/^https?:\/\//i.test(url)) return url;
      return new URL(url, baseUrl || globalThis.location.href).toString();
    } catch {
      return url;
    }
  }

  function looksPlayableMediaUrl(url) {
    if (!url) return false;
    if (/\.\.\./.test(url)) return false;
    if (/sprite|thumbnail|thumb|preview|\.vtt(?:$|[?#])|timelines\.php/i.test(url)) return false;
    if (/[#?&]file\.mp4(?:$|[?#&])/i.test(url)) return false;
    if (/\/search\/[^?#]*\.mp4(?:$|[/?#])/i.test(url)) return false;
    if (/^https?:\/\/(?:[^/]+\.)?(?:tezfiles\.com|k2s\.cc|rg\.to)\/file\//i.test(url)) return false;
    if (/advert|banner|vast|popunder|tracking|analytics|\/ads?\//i.test(url)) return false;
    if (/adtng|twinrdengine|gsrv\.dev\/data\/creatives/i.test(url)) return false;
    return /\.(mp4|m3u8)(?:$|[?#])/i.test(url);
  }

  function collectMediaCandidates(root) {
    const scope = root || document;
    const candidates = [];
    const add = function (url, source) {
      if (!looksPlayableMediaUrl(url)) return;
      const absolute = toAbsoluteUrl(String(url || "").replace(/\\\//g, "/").replace(/&amp;/g, "&"));
      if (candidates.some(function (item) { return item.url === absolute; })) return;
      candidates.push({
        url: absolute,
        type: /\.m3u8(?:$|[?#])/i.test(absolute) ? "hls" : "mp4",
        source: source || "dom",
      });
    };

    try {
      scope.querySelectorAll("video[src], video[data-src], source[src], source[data-src]").forEach(function (node) {
        add(node.currentSrc || node.src || node.getAttribute("src") || node.getAttribute("data-src"), node.tagName.toLowerCase());
      });
    } catch {}
    try {
      scope.querySelectorAll('meta[property="og:video"], meta[property="og:video:secure_url"], meta[property="og:video:url"]').forEach(function (node) {
        add(node.getAttribute("content"), "meta");
      });
    } catch {}
    try {
      const html = (scope.documentElement && scope.documentElement.innerHTML) || scope.innerHTML || "";
      String(html).replace(/https?:[^"'\\\s<>]+\.(?:mp4|m3u8)[^"'\\\s<>]*/gi, function (url) {
        add(url, "html");
        return url;
      });
      String(html).replace(/https?:\\\/\\\/[^"'\s<>]+\.(?:mp4|m3u8)[^"'\s<>]*/gi, function (url) {
        add(url, "html-escaped");
        return url;
      });
    } catch {}
    try {
      if (scope === document && performance && performance.getEntriesByType) {
        performance.getEntriesByType("resource").forEach(function (entry) {
          add(entry && entry.name, "performance");
        });
      }
    } catch {}

    return candidates;
  }

  function legacyDownloadOptions(options) {
    const config = options || {};
    const state = getDownloadState();
    return {
      currentDownloads: config.currentDownloads || state.currentDownloads,
      addDownload: config.addDownload || state.addDownload,
      removeDownload: config.removeDownload || state.removeDownload,
      showDownloadManager: config.showDownloadManager || state.showDownloadManager,
      updateDownloadProgress: config.updateDownloadProgress || state.updateDownloadProgress,
      showDownloadProgress: config.showDownloadProgress || state.showDownloadProgress,
      defaultFilename: config.defaultFilename || "Video.mp4",
    };
  }

  function handleLegacyContentProgressMessage(action, request, options) {
    const config = legacyDownloadOptions(options);
    const data = request || {};
    const downloadId = data.downloadId;

    if (action === "hideDownloadProgress" || action === "hideHLSProgress") {
      try {
        config.removeDownload(downloadId);
      } catch {}
      return true;
    }

    if (action === "showDownloadProgress") {
      try {
        config.showDownloadManager();
        const name = data.filename || config.defaultFilename;
        const total = data.total || 0;
        const downloaded = data.downloaded || 0;
        const progress = data.progress || (total ? (downloaded / total) * 100 : 0);
        const status = data.status || "Downloading";
        if (!config.currentDownloads.has(downloadId)) {
          config.addDownload(downloadId, name, total);
        }
        config.updateDownloadProgress(downloadId, downloaded, total, progress, status, false);
      } catch {
        try {
          config.showDownloadProgress(
            downloadId,
            data.filename || config.defaultFilename,
            data.downloaded || 0,
            data.total || 0,
            data.progress || 0,
            data.status || "Downloading",
          );
        } catch {}
      }
      return true;
    }

    if (action === "showHLSProgress") {
      try {
        config.showDownloadManager();
        const name = data.filename || config.defaultFilename;
        const progress = Math.max(0, Math.min(100, data.progress || 0));
        const status = data.status || "Processing HLS...";
        if (!config.currentDownloads.has(downloadId)) {
          config.addDownload(downloadId, name, 100);
        }
        config.updateDownloadProgress(downloadId, progress, 100, progress, status, true);
      } catch {
        try {
          config.showDownloadProgress(
            downloadId,
            data.filename || config.defaultFilename,
            data.downloaded || 0,
            data.total || 0,
            data.progress || 0,
            data.status || "Processing HLS...",
          );
        } catch {}
      }
      return true;
    }

    return false;
  }

  function toM3u8AbsoluteUrl(base, relativeUrl) {
    try {
      if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl;
      if (relativeUrl.startsWith("/")) {
        const parsedBase = new URL(base);
        return `${parsedBase.protocol}//${parsedBase.host}${relativeUrl}`;
      }
      const parts = base.split("/");
      parts.pop();
      return `${parts.join("/")}/${relativeUrl}`.replace(/([^:]\/)\/+/g, "$1");
    } catch {
      return relativeUrl;
    }
  }

  function parseM3u8Playlist(content, baseUrl) {
    const lines = String(content || "")
      .split("\n")
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
    const isMaster = lines.some(function (line) { return line.startsWith("#EXT-X-STREAM-INF"); });

    if (isMaster) {
      const variants = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
        const resolution = line.match(/RESOLUTION=(\d+)x(\d+)/) || [];
        const height = resolution[2] ? parseInt(resolution[2], 10) : null;
        const nextLine = lines[index + 1];
        if (nextLine && !nextLine.startsWith("#")) {
          variants.push({ url: toM3u8AbsoluteUrl(baseUrl, nextLine), height });
        }
      }
      variants.sort(function (a, b) { return (b.height || 0) - (a.height || 0); });
      return { master: true, variants };
    }

    const segments = [];
    let duration = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.startsWith("#EXTINF:")) {
        duration = parseFloat(line.split(":")[1]) || 0;
      } else if (!line.startsWith("#")) {
        segments.push({ url: toM3u8AbsoluteUrl(baseUrl, line), duration });
        duration = 0;
      }
    }
    return { master: false, segments };
  }

  async function downloadHlsViaContent(request, options) {
    const config = legacyDownloadOptions(options);
    const m3u8Url = request && request.m3u8Url;
    const filename = request && request.filename;
    if (!m3u8Url || !filename) throw new Error("Missing m3u8Url or filename");

    async function fetchText(url) {
      const response = await fetch(url, {
        headers: { Accept: "application/vnd.apple.mpegurl,text/plain,*/*" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    }

    async function downloadSegments(segments, outName) {
      const downloadId = `hls-${Date.now()}`;
      try {
        config.showDownloadManager();
        if (!config.currentDownloads.has(downloadId)) {
          config.addDownload(downloadId, outName, segments.length);
        }
        config.updateDownloadProgress(downloadId, 0, segments.length, 0, "Starting HLS...", true, {
          current: 0,
          total: segments.length,
        });
      } catch {
        try {
          config.showDownloadProgress(downloadId, outName, 0, segments.length, 0, "Starting HLS...");
        } catch {}
      }

      const chunks = [];
      let count = 0;
      for (const segment of segments) {
        try {
          const response = await fetch(segment.url, { headers: { Accept: "*/*" } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          chunks.push(new Uint8Array(await response.arrayBuffer()));
          count += 1;
        } catch {}

        const progress = Math.round((count / segments.length) * 100);
        const status = `Downloaded ${count}/${segments.length} segments`;
        try {
          config.updateDownloadProgress(downloadId, count, segments.length, progress, status, true, {
            current: count,
            total: segments.length,
          });
        } catch {
          try {
            config.showDownloadProgress(downloadId, outName, count, segments.length, progress, status);
          } catch {}
        }
      }

      if (!chunks.length) throw new Error("No segments downloaded");

      const size = chunks.reduce(function (sum, chunk) { return sum + chunk.length; }, 0);
      const output = new Uint8Array(size);
      let offset = 0;
      chunks.forEach(function (chunk) {
        output.set(chunk, offset);
        offset += chunk.length;
      });

      const blobUrl = URL.createObjectURL(new Blob([output], { type: "video/mp4" }));
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = outName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 5000);

      try {
        config.updateDownloadProgress(downloadId, segments.length, segments.length, 100, "Complete", true, {
          current: segments.length,
          total: segments.length,
        });
      } catch {
        try {
          config.showDownloadProgress(downloadId, outName, segments.length, segments.length, 100, "Complete");
        } catch {}
      }
      setTimeout(function () {
        try { config.removeDownload(downloadId); } catch {}
      }, 3000);
      return { downloadId };
    }

    const masterText = await fetchText(m3u8Url);
    const parsed = parseM3u8Playlist(masterText, m3u8Url);
    if (parsed.master) {
      if (!parsed.variants.length) throw new Error("No variants");
      const best = parsed.variants[0];
      const mediaText = await fetchText(best.url);
      const media = parseM3u8Playlist(mediaText, best.url);
      if (!media.master && media.segments && media.segments.length) {
        return downloadSegments(media.segments, filename);
      }
      throw new Error("No segments in media playlist");
    }
    if (parsed.segments && parsed.segments.length) {
      return downloadSegments(parsed.segments, filename);
    }
    throw new Error("Unrecognized m3u8");
  }

  const bridge = {
    blobToDataUrl,
    collectMediaCandidates,
    createLogger,
    downloadHlsViaContent,
    exposeExtractor,
    fetchThumbnailData,
    getDownloadState,
    handleLegacyContentProgressMessage,
    handleProgressMessage,
    injectPageScript,
    listenForPageData,
    looksPlayableMediaUrl,
    normalizeDownloadProgressPayload,
    observeVideoDetection,
    registerStandardMessages,
    runInitialVideoCheck,
    safeSendMessage,
    toAbsoluteUrl,
  };

  try {
    globalThis.SerpContentBridge = bridge;
  } catch {}
  try {
    window.SerpContentBridge = bridge;
  } catch {}
})();
