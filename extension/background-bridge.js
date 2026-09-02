(function initRule34BackgroundBridge(root) {
  if (root.Rule34BackgroundBridge?.version) return;

  const fallbackLogger = {
    log() {},
    warn() {},
    error() {},
  };

  function getLogger(logger) {
    return logger || fallbackLogger;
  }

  function isNoReceiverError(error) {
    const message = String(error?.message || error || "");
    return /Receiving end does not exist|Could not establish connection|The message port closed before a response was received/i.test(message);
  }

  async function sendMessageToTabSafely(tabId, payload, logger = fallbackLogger) {
    if (!tabId || !root.chrome?.tabs?.sendMessage) return false;
    try {
      await root.chrome.tabs.sendMessage(tabId, payload);
      return true;
    } catch (error) {
      if (!isNoReceiverError(error)) {
        try {
          const action = payload?.action || payload?.type || "message";
          getLogger(logger).warn(`Could not forward "${action}" to tab ${tabId}:`, error);
        } catch {}
      }
      return false;
    }
  }

  function getBackgroundConfig() {
    return root.SiteConfig?.BACKGROUND || {};
  }

  function getContextMenuConfig(overrides = {}) {
    const configured = {
      ...(getBackgroundConfig().contextMenu || {}),
      ...(overrides || {}),
    };
    const menu = {
      id: configured.id || "download-video",
      title: configured.title || `Download ${root.SiteConfig?.SITE_NAME || "Video"} Video`,
      contexts: Array.isArray(configured.contexts) && configured.contexts.length ? configured.contexts : ["page", "video"],
    };
    if (Array.isArray(configured.documentUrlPatterns) && configured.documentUrlPatterns.length) {
      menu.documentUrlPatterns = configured.documentUrlPatterns;
    }
    if (Array.isArray(configured.targetUrlPatterns) && configured.targetUrlPatterns.length) {
      menu.targetUrlPatterns = configured.targetUrlPatterns;
    }
    return menu;
  }

  function createConfiguredContextMenu(options = {}) {
    const { logger, contextMenu } = options;
    if (!root.chrome?.contextMenus?.create) return false;
    try {
      root.chrome.contextMenus.create(getContextMenuConfig(contextMenu));
      return true;
    } catch (error) {
      try {
        getLogger(logger).warn("Could not create configured context menu:", error);
      } catch {}
      return false;
    }
  }

  function isConfiguredContextMenuClick(info, contextMenu) {
    return info?.menuItemId === getContextMenuConfig(contextMenu).id;
  }

  function handleConfiguredContextMenuClick(options = {}) {
    const {
      info,
      tab,
      downloadVideo,
      setCurrentDownloadTabId,
      afterSetCurrentDownloadTabId,
      lastErrorContext,
      logger,
      contextMenu,
    } = options;
    const configured = {
      ...(getBackgroundConfig().contextMenu || {}),
      ...(contextMenu || {}),
    };
    if (!isConfiguredContextMenuClick(info, configured)) return false;

    const tabId = tab?.id || null;
    if (typeof setCurrentDownloadTabId === "function") setCurrentDownloadTabId(tabId);
    if (typeof afterSetCurrentDownloadTabId === "function") {
      try {
        afterSetCurrentDownloadTabId(tabId);
      } catch {}
    }
    try {
      root.chrome.tabs.sendMessage(tabId, { action: configured.messageAction || "getVideoInfo" }, (response) => {
        const lastError = root.chrome?.runtime?.lastError;
        if (lastError) {
          try {
            getLogger(logger).log(lastErrorContext || "Configured context menu getVideoInfo failed:", lastError.message || lastError);
          } catch {}
          return;
        }
        if (!response || !response.success || typeof downloadVideo !== "function") return;
        if (configured.passTabIdToDownloadVideo) downloadVideo(response.data, tabId);
        else downloadVideo(response.data);
      });
    } catch (error) {
      try {
        getLogger(logger).warn("Configured context menu click failed:", error);
      } catch {}
    }
    return true;
  }

  function notifyUser(notify, title, message) {
    try {
      if (typeof notify === "function") notify(title, message);
    } catch {}
  }

  function showNotification(title, message, options = {}) {
    try {
      root.chrome?.notifications?.create?.({
        type: options.type || "basic",
        iconUrl: options.iconUrl || "icons/icon128.png",
        title,
        message,
      });
      return true;
    } catch {
      return false;
    }
  }

  function sanitizeFilename(filename, options = {}) {
    const replacement = typeof options.replacement === "string" ? options.replacement : "";
    const maxLength = Number(options.maxLength) || 200;
    const unicodeReplacements = {
      "\u2018": "'",
      "\u2019": "'",
      "\u201A": ",",
      "\u201B": "'",
      "\u201C": '"',
      "\u201D": '"',
      "\u201E": '"',
      "\u2013": "-",
      "\u2014": "-",
      "\u2212": "-",
      "\u2022": "-",
      "\u2026": "...",
      "\u00AB": "",
      "\u00BB": "",
      "\u00A1": "",
      "\u00BF": "",
    };
    let normalized = Array.from(String(filename || ""), (char) => unicodeReplacements[char] ?? char).join("");
    try {
      normalized = normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    } catch {}
    return normalized
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, replacement)
      .replace(/[^A-Za-z0-9 !#$%&'()+,./;=@\[\]^_`{}~-]/g, replacement)
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, maxLength);
  }

  function monitorDownloadCompletion(options = {}) {
    const {
      downloadId,
      filename,
      downloadProgress,
      notify = showNotification,
      numericOnly = false,
      nonNumericMessage,
    } = options;

    if (numericOnly && typeof downloadId !== "number") {
      if (nonNumericMessage) {
        try {
          console.log(nonNumericMessage);
        } catch {}
      }
      return false;
    }

    if (!root.chrome?.downloads?.onChanged?.addListener) return false;
    root.chrome.downloads.onChanged.addListener(function downloadListener(delta) {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === "complete") {
        notifyUser(notify, "Download Complete", `${filename} has been downloaded successfully.`);
        downloadProgress?.delete?.(downloadId);
        root.chrome.downloads.onChanged.removeListener(downloadListener);
      } else if (delta.state.current === "interrupted") {
        notifyUser(notify, "Download Failed", `Failed to download ${filename}`);
        downloadProgress?.delete?.(downloadId);
        root.chrome.downloads.onChanged.removeListener(downloadListener);
      }
    });
    return true;
  }

  function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function shouldUseRangeRequest(videoUrl) {
    return /\/(?:get_file|reversebuffer)(?:\/|\?)/i.test(String(videoUrl || "")) &&
      /[?&](?:rnd|v-acctoken|token|expires|cv)=/i.test(String(videoUrl || ""));
  }

  async function installTemporaryRefererRule(videoUrl, refererUrl, logger) {
    if (!videoUrl || !refererUrl || !root.chrome?.declarativeNetRequest?.updateDynamicRules) return null;
    const ruleId = 900000 + Math.floor(Date.now() % 100000);
    const requestHost = (() => {
      try { return new URL(videoUrl).hostname; } catch { return ""; }
    })();
    const resourceTypes = ["xmlhttprequest", "media", "other"];
    const buildRule = (condition) => ({
      id: ruleId,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "Referer", operation: "set", value: refererUrl }],
      },
      condition: {
        ...condition,
        resourceTypes,
      },
    });
    const installRule = async (condition) => {
      await root.chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleId],
        addRules: [buildRule(condition)],
      });
      setTimeout(() => {
        try {
          root.chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ruleId] });
        } catch {}
      }, 120000);
      return ruleId;
    };
    try {
      const regexFilter = `^${escapeRegex(videoUrl)}$`;
      if (regexFilter.length <= 1900) return await installRule({ regexFilter });
    } catch (error) {
      try { getLogger(logger).warn("Failed to install exact temporary referer rule", error); } catch {}
    }
    try {
      if (requestHost) return await installRule({ requestDomains: [requestHost] });
    } catch (error) {
      try { getLogger(logger).warn("Failed to install host temporary referer rule", error); } catch {}
    }
    return null;
  }

  async function downloadMp4WithOffscreen(options = {}) {
    const {
      videoUrl,
      filename,
      refererUrl,
      ensureOffscreenDocument,
      downloadProgress,
      logger,
      rangeRequest,
      conflictAction,
    } = options;

    try {
      if (typeof logger === "function") {
        try {
          logger("Downloading MP4 with headers via offscreen:", videoUrl, "referer:", refererUrl);
        } catch {}
      }

      if (typeof ensureOffscreenDocument === "function") {
        await ensureOffscreenDocument();
      }

      const dnrRuleId = await installTemporaryRefererRule(videoUrl, refererUrl, logger);
      const downloadId = `mp4-${Date.now()}`;
      const ack = await new Promise((resolve, reject) => {
        try {
          root.chrome.runtime.sendMessage({
            type: "PROCESS_MP4_DOWNLOAD",
            downloadId,
            fileName: filename,
            videoUrl,
            refererUrl,
            dnrRuleId,
            rangeRequest: Boolean(rangeRequest || shouldUseRangeRequest(videoUrl)),
            // Echoed back by the offscreen document when it relays the finished
            // blob for saving, so the user's overwrite setting is honoured.
            conflictAction: conflictAction === "overwrite" ? "overwrite" : "uniquify",
          }, (resp) => {
            if (root.chrome.runtime.lastError) {
              reject(new Error(root.chrome.runtime.lastError.message));
            } else {
              resolve(resp);
            }
          });
        } catch (error) {
          reject(error);
        }
      });

      if (!ack || ack.success !== true) {
        throw new Error(ack?.error || "Failed to start MP4 download");
      }

      downloadProgress?.set?.(downloadId, { startTime: Date.now(), videoUrl, filename });
      return downloadId;
    } catch (error) {
      console.error("Error in downloadWithHeaders:", error);
      throw error;
    }
  }

  function getOffscreenDocumentConfig() {
    return getBackgroundConfig().offscreenDocument || {};
  }

  let offscreenDocumentCreationPromise = null;

  async function hasOffscreenDocument(chromeRef, documentUrl) {
    try {
      if (chromeRef.runtime.getContexts) {
        const existingContexts = await chromeRef.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"],
          documentUrls: [documentUrl],
        });
        return Array.isArray(existingContexts) && existingContexts.length > 0;
      }
      return Boolean(chromeRef.offscreen.hasDocument && await chromeRef.offscreen.hasDocument());
    } catch {
      return false;
    }
  }

  async function ensureOffscreenDocument(options = {}) {
    const configured = getOffscreenDocumentConfig();
    const logger = options.logger;
    const url = options.url || configured.url || "offscreen.html";
    const reasons = Array.isArray(options.reasons) && options.reasons.length
      ? options.reasons
      : Array.isArray(configured.reasons) && configured.reasons.length
        ? configured.reasons
        : ["DOM_SCRAPING"];
    const justification = options.justification || configured.justification || "Process media streams and create downloadable files";
    const logMessage = options.logMessage || configured.logMessage || "Creating offscreen document";

    const chromeRef = root.chrome;
    if (!chromeRef?.offscreen?.createDocument) {
      throw new Error("Chrome offscreen API is not available.");
    }

    const documentUrl = chromeRef.runtime.getURL(url);
    if (await hasOffscreenDocument(chromeRef, documentUrl)) return false;

    if (!offscreenDocumentCreationPromise) {
      offscreenDocumentCreationPromise = (async () => {
        if (await hasOffscreenDocument(chromeRef, documentUrl)) return false;

        try {
          getLogger(logger).log(logMessage);
        } catch {}

        try {
          await chromeRef.offscreen.createDocument({
            url,
            reasons,
            justification,
          });
          return true;
        } catch (error) {
          if (/single offscreen document/i.test(String(error?.message || error)) && await hasOffscreenDocument(chromeRef, documentUrl)) {
            return false;
          }
          throw error;
        }
      })();
    }

    try {
      return await offscreenDocumentCreationPromise;
    } finally {
      offscreenDocumentCreationPromise = null;
    }
  }

  function parseM3U8Attributes(attrString) {
    const attrs = {};
    const regex = /([A-Z-]+)=(?:"([^"]*)"|([^,]*))/g;
    let match;

    while ((match = regex.exec(String(attrString || ""))) !== null) {
      const key = match[1];
      const value = match[2] || match[3];
      attrs[key] = value;
    }

    return attrs;
  }

  function safeSendResponse(sendResponse, payload) {
    try {
      if (typeof sendResponse === "function") sendResponse(payload);
    } catch {}
  }

  function getErrorMessage(error, fallback = "Unknown error") {
    return error?.message || String(error || "") || fallback;
  }

  function respondWithPromise(sendResponse, promise, toSuccessPayload) {
    Promise.resolve(promise)
      .then((result) => safeSendResponse(sendResponse, toSuccessPayload(result)))
      .catch((error) => safeSendResponse(sendResponse, { success: false, error: getErrorMessage(error) }));
    return true;
  }

  function handleDownloadVideoMessage(options = {}) {
    const {
      request,
      sender,
      sendResponse,
      downloadVideo,
      setCurrentDownloadTabId,
    } = options;

    const runWithTab = (tabId) => {
      if (tabId && typeof setCurrentDownloadTabId === "function") setCurrentDownloadTabId(tabId);
      return respondWithPromise(
        sendResponse,
        downloadVideo(request?.videoInfo),
        (result) => ({ success: true, result }),
      );
    };

    const explicitTabId = Number(request?.tabId);
    if (Number.isFinite(explicitTabId) && explicitTabId > 0) return runWithTab(explicitTabId);

    const senderTabId = sender?.tab?.id;
    if (senderTabId) return runWithTab(senderTabId);

    try {
      root.chrome.tabs.query({ active: true, currentWindow: true })
        .then((tabs) => runWithTab(tabs && tabs.length ? tabs[0].id : null))
        .catch(() => runWithTab(null));
    } catch {
      runWithTab(null);
    }
    return true;
  }

  function handleGetVideoFormatsMessage(options = {}) {
    const { request, sendResponse, getVideoFormats } = options;
    return respondWithPromise(
      sendResponse,
      getVideoFormats(request?.videoInfo),
      (result) => {
        const out = Array.isArray(result) ? { formats: result } : (result || { formats: [] });
        return { success: true, ...out };
      },
    );
  }

  function handleGetDownloadProgressMessage(options = {}) {
    const { request, sendResponse, downloadProgress } = options;
    const progress = downloadProgress?.get?.(request?.downloadId);
    safeSendResponse(sendResponse, { progress });
  }

  function handleForwardAck(options = {}) {
    const { request, sendResponse, forwarder } = options;
    try {
      if (typeof forwarder === "function") forwarder(request);
    } catch {}
    safeSendResponse(sendResponse, { success: true });
    return true;
  }

  function handleLogMirror(options = {}) {
    const { request, sender, sendResponse, logger } = options;
    try {
      const lvl = String(request?.level || "log");
      const pre = request?.prefix || "Mirror";
      const src = sender?.tab?.id ? `tab:${sender.tab.id}` : "ext";
      const payload = Array.isArray(request?.args) ? request.args : [];
      const targetLogger = getLogger(logger);
      if (lvl === "error") targetLogger.error(pre, src, ...payload);
      else if (lvl === "warn") targetLogger.warn(pre, src, ...payload);
      else targetLogger.log(pre, src, ...payload);
    } catch {}
    safeSendResponse(sendResponse, { ok: true });
  }

  function getSegmentProgress(message) {
    const segmentMatch = message?.status?.match(/Downloaded segment (\d+)\/(\d+)/);
    const explicitSegmentIndex = Number(message?.segmentIndex) || 0;
    const explicitTotalSegments = Number(message?.totalSegments) || 0;
    if (explicitSegmentIndex || explicitTotalSegments) {
      return {
        segmentIndex: explicitSegmentIndex,
        totalSegments: explicitTotalSegments || 100,
      };
    }
    return {
      segmentIndex: segmentMatch ? parseInt(segmentMatch[1], 10) : 0,
      totalSegments: segmentMatch ? parseInt(segmentMatch[2], 10) : 100,
    };
  }

  async function forwardProgressMessages(tabId, canonicalPayload, logger) {
    if (!tabId) return false;
    return sendMessageToTabSafely(tabId, canonicalPayload, logger);
  }

  function recordDownloadProgress(downloadProgress, payload = {}) {
    if (!downloadProgress || typeof downloadProgress.set !== "function" || !payload.downloadId) return;
    const existing = typeof downloadProgress.get === "function" ? downloadProgress.get(payload.downloadId) : null;
    downloadProgress.set(payload.downloadId, {
      ...(existing || {}),
      status: payload.status || existing?.status || "",
      progress: typeof payload.progress === "number" ? payload.progress : (existing?.progress || 0),
      downloadedBytes: payload.downloadedBytes ?? existing?.downloadedBytes ?? 0,
      totalBytes: payload.totalBytes ?? existing?.totalBytes ?? 0,
      segmentIndex: payload.segmentIndex ?? existing?.segmentIndex ?? 0,
      totalSegments: payload.totalSegments ?? existing?.totalSegments ?? 0,
      fileName: payload.filename || payload.fileName || existing?.fileName || existing?.filename || "",
      filename: payload.filename || payload.fileName || existing?.filename || existing?.fileName || "",
      chromeDownloadId: payload.chromeDownloadId ?? existing?.chromeDownloadId,
      error: payload.error || existing?.error || "",
      updatedAt: Date.now(),
    });
  }

  async function notifyDownloadProgressToContent({
    tabId,
    downloadId,
    filename,
    strategy,
    status,
    progress = 0,
    downloadedBytes = 0,
    totalBytes = 0,
    segmentIndex = 0,
    totalSegments = 0,
    isHLS = false,
    error = "",
    downloadProgress,
    logger,
  } = {}) {
    if (!downloadId) return false;
    recordDownloadProgress(downloadProgress, {
      downloadId,
      filename,
      status: status || (error ? "Failed" : "Downloading..."),
      progress,
      downloadedBytes,
      totalBytes,
      segmentIndex,
      totalSegments,
      error,
    });
    if (!tabId) return false;
    const hls = Boolean(
      isHLS ||
      String(strategy || "").toLowerCase().includes("hls") ||
      String(downloadId).toLowerCase().includes("hls"),
    );
    const legacyPayload = hls
      ? {
          action: error ? "hlsError" : "hlsProgress",
          data: {
            downloadId,
            filename,
            segmentIndex,
            totalSegments,
            progress,
            status: status || (error ? "Failed" : "Processing HLS..."),
            error,
          },
        }
      : {
          action: error ? "mp4Error" : "mp4Progress",
          data: {
            downloadId,
            filename,
            downloaded: downloadedBytes,
            total: totalBytes,
            progress,
            status: status || (error ? "Failed" : "Downloading..."),
            error,
          },
        };
    return forwardProgressMessages(tabId, {
      action: "downloadProgress",
      data: {
        downloadId,
        filename,
        strategy: strategy || (hls ? "background-hls" : "background-mp4"),
        status: status || (error ? "Failed" : "Downloading..."),
        progress,
        downloadedBytes,
        totalBytes,
        segmentIndex,
        totalSegments,
        isHLS: hls,
        error,
      },
    }, legacyPayload, logger);
  }

  function formatTotalBytes(format) {
    return Number(
      format?.filesize ||
        format?.filesize_approx ||
        format?.contentLength ||
        format?.size ||
        format?.totalBytes ||
        0,
    ) || 0;
  }

  async function notifyContentDownloadStarted({
    tabId,
    downloadId,
    filename,
    selectedFormat,
    format,
    strategy = "chrome",
    isHLS = false,
    downloadProgress,
    logger,
  } = {}) {
    const rawFormat = selectedFormat || format || {};
    return notifyDownloadProgressToContent({
      tabId,
      downloadId,
      filename,
      strategy,
      status: "Download started...",
      progress: 1,
      downloadedBytes: 0,
      totalBytes: formatTotalBytes(rawFormat),
      isHLS,
      downloadProgress,
      logger,
    });
  }

  async function forwardHLSProgress({ tabId, message, downloadProgress, logger }) {
    if (!tabId) return false;
    const { segmentIndex, totalSegments } = getSegmentProgress(message);
    recordDownloadProgress(downloadProgress, {
      downloadId: message?.downloadId,
      filename: message?.fileName,
      status: message?.status,
      progress: message?.progress,
      segmentIndex,
      totalSegments,
    });
    return forwardProgressMessages(tabId, {
      action: "downloadProgress",
      data: {
        downloadId: message?.downloadId,
        filename: message?.fileName,
        strategy: "offscreen-hls",
        status: message?.status,
        progress: message?.progress,
        segmentIndex,
        totalSegments,
      },
    }, logger);
  }

  async function forwardHLSComplete({ tabId, message, downloadProgress, logger }) {
    if (!tabId) return false;
    recordDownloadProgress(downloadProgress, {
      downloadId: message?.downloadId,
      filename: message?.fileName,
      status: "Complete",
      progress: 100,
      downloadedBytes: message?.fileSize || 0,
      totalBytes: message?.fileSize || 0,
      chromeDownloadId: message?.chromeDownloadId,
    });
    return forwardProgressMessages(tabId, {
      action: "downloadProgress",
      data: {
        downloadId: message?.downloadId,
        filename: message?.fileName,
        strategy: "offscreen-hls",
        status: "Complete",
        progress: 100,
        downloadedBytes: message?.fileSize || 0,
        totalBytes: message?.fileSize || 0,
      },
    }, logger);
  }

  async function forwardHLSError({ tabId, message, downloadProgress, logger }) {
    if (!tabId) return false;
    recordDownloadProgress(downloadProgress, {
      downloadId: message?.downloadId,
      filename: message?.fileName || "Unknown video.mp4",
      status: "Failed",
      progress: 0,
      error: message?.error,
    });
    return forwardProgressMessages(tabId, {
      action: "downloadProgress",
      data: {
        downloadId: message?.downloadId,
        filename: message?.fileName || "Unknown video.mp4",
        strategy: "offscreen-hls",
        status: "Failed",
        progress: 0,
        error: message?.error,
      },
    }, logger);
  }

  async function forwardMP4Progress({ tabId, message, downloadProgress, logger }) {
    if (!tabId) return false;
    recordDownloadProgress(downloadProgress, {
      downloadId: message?.downloadId,
      filename: message?.fileName,
      status: message?.status || "Downloading...",
      progress: message?.progress || 0,
      downloadedBytes: message?.downloadedBytes || 0,
      totalBytes: message?.totalBytes || 0,
    });
    return forwardProgressMessages(tabId, {
      action: "downloadProgress",
      data: {
        downloadId: message?.downloadId,
        filename: message?.fileName,
        strategy: "offscreen-mp4",
        status: message?.status || "Downloading...",
        downloadedBytes: message?.downloadedBytes || 0,
        totalBytes: message?.totalBytes || 0,
        progress: message?.progress || 0,
      },
    }, logger);
  }

  async function forwardMP4Complete({ tabId, message, downloadProgress, logger }) {
    if (!tabId) return false;
    recordDownloadProgress(downloadProgress, {
      downloadId: message?.downloadId,
      filename: message?.fileName,
      status: "Complete",
      progress: 100,
      downloadedBytes: message?.fileSize || message?.totalBytes || 0,
      totalBytes: message?.fileSize || message?.totalBytes || 0,
      chromeDownloadId: message?.chromeDownloadId,
    });
    return forwardProgressMessages(tabId, {
      action: "downloadProgress",
      data: {
        downloadId: message?.downloadId,
        filename: message?.fileName,
        strategy: "offscreen-mp4",
        status: "Complete",
        progress: 100,
        downloadedBytes: message?.fileSize || message?.totalBytes || 0,
        totalBytes: message?.fileSize || message?.totalBytes || 0,
      },
    }, logger);
  }

  async function forwardMP4Error({ tabId, message, downloadProgress, logger }) {
    if (!tabId) return false;
    recordDownloadProgress(downloadProgress, {
      downloadId: message?.downloadId,
      filename: message?.fileName || "Unknown video.mp4",
      status: "Failed",
      progress: 0,
      error: message?.error || "Unknown error",
    });
    return forwardProgressMessages(tabId, {
      action: "downloadProgress",
      data: {
        downloadId: message?.downloadId,
        filename: message?.fileName || "Unknown video.mp4",
        strategy: "offscreen-mp4",
        status: "Failed",
        progress: 0,
        error: message?.error || "Unknown error",
      },
    }, logger);
  }

  // Public API surface: only what consumers (background-enhanced.js,
  // offscreen.js, content scripts, popup) actually call. Everything else in
  // this file is an internal implementation detail.
  root.Rule34BackgroundBridge = Object.freeze({
    version: "1.0.0",
    createConfiguredContextMenu,
    handleConfiguredContextMenuClick,
    showNotification,
    sanitizeFilename,
    monitorDownloadCompletion,
    installTemporaryRefererRule,
    downloadMp4WithOffscreen,
    ensureOffscreenDocument,
    parseM3U8Attributes,
    handleDownloadVideoMessage,
    handleGetVideoFormatsMessage,
    handleGetDownloadProgressMessage,
    handleForwardAck,
    handleLogMirror,
    forwardHLSProgress,
    forwardHLSComplete,
    forwardHLSError,
    forwardMP4Progress,
    forwardMP4Complete,
    forwardMP4Error,
    notifyDownloadProgressToContent,
    notifyContentDownloadStarted,
  });
})(globalThis);
