// Shared offscreen downloader core for unified legacy direct-video apps.
//
// Site-specific behavior belongs in SiteConfig.OFFSCREEN:
// - download folder and default referer/origin
// - HLS conversion mode: "transmux" or "concat"
// - completion ownership: "offscreen" or "background"

const SiteConfigRef = globalThis.SiteConfig || {};
const manifest = (() => {
  try {
    return chrome.runtime.getManifest() || {};
  } catch {
    return {};
  }
})();

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function cleanSiteToken(value) {
  return String(value || "")
    .replace(/^Downloader\s+for\s+/i, "")
    .replace(/[^A-Za-z0-9]+/g, "");
}

function inferSiteName() {
  return SiteConfigRef.SITE_NAME || cleanSiteToken(manifest.name) || "Video";
}

function inferOriginFromHostPermissions() {
  const ignored = [
    "api.github.com",
    "workers.dev",
    "gstatic.com",
  ];
  const hosts = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  for (const pattern of hosts) {
    const value = String(pattern || "");
    if (!/^https?:\/\//i.test(value)) continue;
    let normalized = value.replace(/\*.*$/, "").replace(/\/+$/, "");
    normalized = normalized.replace(/^https:\/\/\*\./i, "https://");
    try {
      const url = new URL(normalized);
      if (ignored.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) continue;
      return url.origin;
    } catch {}
  }
  return "";
}

function safeLogger(siteName) {
  try {
    if (globalThis.Logger && typeof globalThis.Logger.createLogger === "function") {
      return globalThis.Logger.createLogger(`[${siteName} Offscreen]`);
    }
  } catch {}
  const prefix = `[${siteName} Offscreen]`;
  return {
    log: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

function buildConfig() {
  const siteName = inferSiteName();
  const offscreenConfig = SiteConfigRef.OFFSCREEN || {};
  const inferredOrigin = inferOriginFromHostPermissions();
  const defaultOrigin = offscreenConfig.defaultOrigin || inferredOrigin;
  const defaultRefererUrl = offscreenConfig.defaultRefererUrl || (defaultOrigin ? `${defaultOrigin}/` : "");
  const readyToken = cleanSiteToken(siteName);

  return {
    siteName,
    downloadFolder: offscreenConfig.downloadFolder || siteName,
    defaultRefererUrl,
    defaultOrigin,
    readyTypes: uniq([
      ...(Array.isArray(offscreenConfig.readyTypes) ? offscreenConfig.readyTypes : []),
      offscreenConfig.readyType,
      readyToken ? `${readyToken}_OFFSCREEN_READY` : "",
      readyToken ? `${readyToken.toUpperCase()}_OFFSCREEN_READY` : "",
      "OFFSCREEN_READY",
    ]),
    fetch: {
      includeOriginHeader: Boolean(offscreenConfig.fetch?.includeOriginHeader),
      useTemporaryRefererRule: Boolean(offscreenConfig.fetch?.useTemporaryRefererRule),
      temporaryRefererRuleResourceTypes: Array.isArray(offscreenConfig.fetch?.temporaryRefererRuleResourceTypes)
        ? offscreenConfig.fetch.temporaryRefererRuleResourceTypes
        : ["xmlhttprequest", "media", "other"],
      useRefererHeader: offscreenConfig.fetch?.useRefererHeader !== false,
      useReferrerOption: offscreenConfig.fetch?.useReferrerOption !== false,
      useUserAgentHeader: offscreenConfig.fetch?.useUserAgentHeader !== false,
      credentials: offscreenConfig.fetch?.credentials || undefined,
      mode: offscreenConfig.fetch?.mode || undefined,
      cache: offscreenConfig.fetch?.cache || undefined,
      referrerPolicy: offscreenConfig.fetch?.referrerPolicy || "no-referrer-when-downgrade",
    },
    hls: {
      mode: offscreenConfig.hls?.mode || "transmux",
      completion: offscreenConfig.hls?.completion || "offscreen",
      messageStyle: offscreenConfig.hls?.messageStyle || "standard",
      continueOnSegmentError: Boolean(offscreenConfig.hls?.continueOnSegmentError),
      maxSegmentRetries: Number.isFinite(Number(offscreenConfig.hls?.maxSegmentRetries))
        ? Number(offscreenConfig.hls.maxSegmentRetries)
        : 3,
      backoffBaseMs: Number.isFinite(Number(offscreenConfig.hls?.backoffBaseMs))
        ? Number(offscreenConfig.hls.backoffBaseMs)
        : 500,
      stallTimeoutMs: Number.isFinite(Number(offscreenConfig.hls?.stallTimeoutMs))
        ? Number(offscreenConfig.hls.stallTimeoutMs)
        : 30000,
      absoluteTimeoutMs: Number.isFinite(Number(offscreenConfig.hls?.absoluteTimeoutMs))
        ? Number(offscreenConfig.hls.absoluteTimeoutMs)
        : 60000,
      segmentConcurrency: Number.isFinite(Number(offscreenConfig.hls?.segmentConcurrency))
        ? Math.max(1, Math.floor(Number(offscreenConfig.hls.segmentConcurrency)))
        : 1,
    },
    mp4: {
      completion: offscreenConfig.mp4?.completion || "offscreen",
      revokeDelayMs: Number.isFinite(Number(offscreenConfig.mp4?.revokeDelayMs))
        ? Number(offscreenConfig.mp4.revokeDelayMs)
        : 15000,
    },
  };
}

const config = buildConfig();
const logger = safeLogger(config.siteName);

const hlsCancelled = new Set();
const hlsActive = new Set();
const hlsAttemptControllers = new Map();
const hlsActiveConverters = new Map();
const mp4Active = new Map();
let temporaryRefererRuleSequence = 0;
let SimpleHLS2MP4Converter = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addHlsAttemptController(downloadId, controller) {
  let controllers = hlsAttemptControllers.get(downloadId);
  if (!controllers) {
    controllers = new Set();
    hlsAttemptControllers.set(downloadId, controllers);
  }
  controllers.add(controller);
}

function removeHlsAttemptController(downloadId, controller) {
  const controllers = hlsAttemptControllers.get(downloadId);
  if (!controllers) return;
  controllers.delete(controller);
  if (!controllers.size) hlsAttemptControllers.delete(downloadId);
}

function abortHlsAttemptControllers(downloadId) {
  const controllers = hlsAttemptControllers.get(downloadId);
  if (!controllers) return;
  for (const controller of controllers) {
    try {
      controller?.abort?.();
    } catch {}
  }
  hlsAttemptControllers.delete(downloadId);
}

function normalizeFileName(fileName, fallback = "video.mp4") {
  const raw = String(fileName || fallback).trim() || fallback;
  return /\.mp4$/i.test(raw) ? raw : `${raw}.mp4`;
}

function scopedFileName(fileName) {
  const cleanName = normalizeFileName(fileName);
  const folder = String(config.downloadFolder || "").replace(/^\/+|\/+$/g, "");
  return folder ? `${folder}/${cleanName}` : cleanName;
}

function safeSendMessage(payload) {
  try {
    const maybePromise = chrome.runtime.sendMessage(payload);
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {});
    }
    return maybePromise;
  } catch {
    return null;
  }
}

function hlsDataPayload(payload) {
  return {
    downloadId: payload.downloadId,
    filename: payload.fileName || payload.filename,
    fileName: payload.fileName || payload.filename,
    segmentIndex: payload.segmentIndex,
    totalSegments: payload.totalSegments,
    progress: payload.progress,
    status: payload.status,
    error: payload.error,
    blobUrl: payload.blobUrl,
    fileSize: payload.fileSize,
    chromeDownloadId: payload.chromeDownloadId,
  };
}

function sendCanonicalDownloadProgress(payload) {
  safeSendMessage({
    action: "downloadProgress",
    data: {
      downloadId: payload.downloadId,
      filename: payload.fileName || payload.filename,
      fileName: payload.fileName || payload.filename,
      strategy: payload.strategy || (payload.kind === "hls" ? "offscreen-hls" : "offscreen-mp4"),
      status: payload.status,
      downloadedBytes: payload.downloadedBytes,
      totalBytes: payload.totalBytes,
      progress: payload.progress,
      segmentIndex: payload.segmentIndex,
      totalSegments: payload.totalSegments,
      error: payload.error,
      fileSize: payload.fileSize,
      chromeDownloadId: payload.chromeDownloadId,
      isHLS: payload.kind === "hls",
    },
  });
}

function sendHlsProgress(payload) {
  sendCanonicalDownloadProgress({ ...payload, kind: "hls", strategy: "offscreen-hls" });
  if (config.hls.messageStyle === "actionData") {
    safeSendMessage({ action: "hlsProgress", data: hlsDataPayload(payload) });
    return;
  }
  safeSendMessage({
    type: "HLS_PROCESSING_PROGRESS",
    downloadId: payload.downloadId,
    fileName: payload.fileName,
    progress: payload.progress,
    status: payload.status,
    segmentIndex: payload.segmentIndex,
    totalSegments: payload.totalSegments,
  });
}

function sendHlsComplete(payload) {
  sendCanonicalDownloadProgress({
    ...payload,
    kind: "hls",
    strategy: "offscreen-hls",
    status: "Complete",
    progress: 100,
    downloadedBytes: payload.fileSize || 0,
    totalBytes: payload.fileSize || 0,
  });
  if (config.hls.messageStyle === "actionData") {
    safeSendMessage({ action: "hlsComplete", data: hlsDataPayload(payload) });
    return;
  }
  const message = {
    type: "HLS_PROCESSING_COMPLETE",
    downloadId: payload.downloadId,
    fileName: payload.fileName,
    fileSize: payload.fileSize,
  };
  if (payload.blobUrl) message.blobUrl = payload.blobUrl;
  if (payload.chromeDownloadId !== undefined && payload.chromeDownloadId !== null) {
    message.chromeDownloadId = payload.chromeDownloadId;
  }
  safeSendMessage(message);
}

function sendHlsError(payload) {
  sendCanonicalDownloadProgress({
    ...payload,
    kind: "hls",
    strategy: "offscreen-hls",
    status: "Failed",
    progress: 0,
  });
  if (config.hls.messageStyle === "actionData") {
    safeSendMessage({ action: "hlsError", data: hlsDataPayload(payload) });
    return;
  }
  safeSendMessage({
    type: "HLS_PROCESSING_ERROR",
    downloadId: payload.downloadId,
    fileName: payload.fileName,
    error: payload.error,
  });
}

function sendMp4Progress(payload) {
  sendCanonicalDownloadProgress({ ...payload, kind: "mp4", strategy: "offscreen-mp4" });
  safeSendMessage({
    type: "MP4_DOWNLOAD_PROGRESS",
    downloadId: payload.downloadId,
    fileName: payload.fileName,
    downloadedBytes: payload.downloadedBytes,
    totalBytes: payload.totalBytes,
    progress: payload.progress,
    status: payload.status,
  });
}

function sendMp4Complete(payload) {
  sendCanonicalDownloadProgress({
    ...payload,
    kind: "mp4",
    strategy: "offscreen-mp4",
    status: "Complete",
    progress: 100,
    downloadedBytes: payload.fileSize || payload.totalBytes || 0,
    totalBytes: payload.fileSize || payload.totalBytes || 0,
  });
  safeSendMessage(payload);
}

function sendMp4Error(payload) {
  sendCanonicalDownloadProgress({
    ...payload,
    kind: "mp4",
    strategy: "offscreen-mp4",
    status: "Failed",
    progress: 0,
  });
  safeSendMessage(payload);
}

function sendReady() {
  for (const type of config.readyTypes) {
    safeSendMessage({ type, siteName: config.siteName });
  }
}

function getRequestReferer(request, segment) {
  return (
    segment?.refererUrl ||
    segment?.referer ||
    request?.refererUrl ||
    request?.mediaReferrer ||
    request?.referrer ||
    config.defaultRefererUrl ||
    ""
  );
}

function buildFetchOptions({ signal, referer, kind, rangeRequest }) {
  const headers = {};
  if (config.fetch.useRefererHeader && referer) headers.Referer = referer;
  if (config.fetch.useUserAgentHeader && typeof navigator !== "undefined" && navigator.userAgent) {
    headers["User-Agent"] = navigator.userAgent;
  }
  if (kind === "mp4") {
    headers.Accept = "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5";
    if (rangeRequest) headers.Range = "bytes=0-";
  }
  if (config.fetch.includeOriginHeader) {
    let origin = config.defaultOrigin;
    try {
      if (referer) origin = new URL(referer).origin;
    } catch {}
    if (origin) headers.Origin = origin;
  }

  const options = {
    method: "GET",
    signal,
    headers: Object.keys(headers).length ? headers : undefined,
    referrerPolicy: config.fetch.referrerPolicy,
  };

  if (config.fetch.useReferrerOption && referer) options.referrer = referer;
  if (config.fetch.credentials) options.credentials = config.fetch.credentials;
  if (config.fetch.mode) options.mode = config.fetch.mode;
  if (config.fetch.cache) options.cache = config.fetch.cache;
  return options;
}

function dnrUrlCondition(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const isIpHost = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
    const escapedHost = host.replace(/\./g, "\\.");
    return isIpHost
      ? { regexFilter: `^https?://${escapedHost}(?::[0-9]+)?/` }
      : { urlFilter: `||${host}/` };
  } catch {
    return null;
  }
}

async function withTemporaryRefererRule(url, referer, fn) {
  if (!config.fetch.useTemporaryRefererRule || !url || !referer || !chrome?.declarativeNetRequest?.updateSessionRules) {
    return fn();
  }
  const condition = dnrUrlCondition(url);
  if (!condition) return fn();

  temporaryRefererRuleSequence = (temporaryRefererRuleSequence + 1) % 700000;
  const ruleId = 200000 + ((Date.now() + temporaryRefererRuleSequence) % 700000);
  let installed = false;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [{
        id: ruleId,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "Referer", operation: "set", value: referer }],
        },
        condition: {
          ...condition,
          resourceTypes: config.fetch.temporaryRefererRuleResourceTypes,
        },
      }],
    });
    installed = true;
  } catch (error) {
    logger.warn("temporary referer DNR install failed", { url, referer, error: String(error?.message || error) });
  }

  try {
    return await fn();
  } finally {
    if (installed) {
      try {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
      } catch {}
    }
  }
}

async function fetchBlobWithRetry({
  url,
  referer,
  downloadId,
  segmentIndex = 0,
  totalSegments = 0,
  fileName = "",
  progressCap = 94,
  kind = "hls",
}) {
  let attempt = 0;
  while (true) {
    if (kind === "hls" && hlsCancelled.has(downloadId)) throw new Error("Download cancelled by user");
    attempt += 1;
    const attemptController = new AbortController();
    if (kind === "hls") addHlsAttemptController(downloadId, attemptController);

    const absoluteTimer =
      typeof config.hls.absoluteTimeoutMs === "number" && config.hls.absoluteTimeoutMs > 0
        ? setTimeout(() => attemptController.abort(), config.hls.absoluteTimeoutMs)
        : null;
    let stallTimer = null;
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      if (typeof config.hls.stallTimeoutMs === "number" && config.hls.stallTimeoutMs > 0) {
        stallTimer = setTimeout(() => {
          try {
            attemptController.abort();
          } catch {}
        }, config.hls.stallTimeoutMs);
      }
    };

    try {
      const response = await withTemporaryRefererRule(
        url,
        referer,
        () => fetch(url, buildFetchOptions({ signal: attemptController.signal, referer, kind })),
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const contentLength = parseInt(response.headers.get("Content-Length") || "0", 10) || 0;
      const reader = response.body?.getReader?.();
      if (!reader) return await response.blob();

      const chunks = [];
      let receivedBytes = 0;
      let lastProgressAt = 0;
      resetStallTimer();
      while (true) {
        if (kind === "hls" && hlsCancelled.has(downloadId)) {
          try {
            attemptController.abort();
          } catch {}
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          receivedBytes += Number(value.byteLength || value.length || 0);
          if (kind === "hls" && totalSegments > 0) {
            const now = Date.now();
            if (!lastProgressAt || now - lastProgressAt >= 1000) {
              const segmentFraction = contentLength > 0 ? Math.min(1, receivedBytes / contentLength) : 0;
              const progress = Math.max(
                5,
                Math.min(progressCap, Math.round(((segmentIndex + segmentFraction) / totalSegments) * progressCap)),
              );
              sendHlsProgress({
                downloadId,
                fileName,
                progress,
                status: `Downloading segment ${segmentIndex + 1}/${totalSegments}`,
                segmentIndex: Math.min(totalSegments, segmentIndex + 1),
                totalSegments,
              });
              lastProgressAt = now;
            }
          }
        }
        resetStallTimer();
      }
      return new Blob(chunks, { type: kind === "mp4" ? "video/mp4" : "video/mp2t" });
    } catch (error) {
      if (kind === "hls" && hlsCancelled.has(downloadId)) throw new Error("Download cancelled by user");
      const maxAttempts = config.hls.maxSegmentRetries + 1;
      if (kind !== "hls" || attempt >= maxAttempts) {
        logger.error(`Fetch failed after ${attempt} attempt(s):`, error);
        throw error;
      }
      const backoff = config.hls.backoffBaseMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * config.hls.backoffBaseMs);
      const delay = backoff + jitter;
      logger.warn(`Retry ${attempt}/${maxAttempts - 1} for segment ${segmentIndex + 1} in ${delay}ms.`);
      await sleep(delay);
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      if (absoluteTimer) clearTimeout(absoluteTimer);
      if (kind === "hls") removeHlsAttemptController(downloadId, attemptController);
    }
  }
}

async function loadSimpleHLS2MP4Converter() {
  if (SimpleHLS2MP4Converter) return SimpleHLS2MP4Converter;
  const moduleUrl = chrome.runtime.getURL("modules/hls2mp4/simple-converter.mjs");
  const module = await import(moduleUrl);
  if (!module?.SimpleHLS2MP4Converter) throw new Error("SimpleHLS2MP4Converter export missing");
  SimpleHLS2MP4Converter = module.SimpleHLS2MP4Converter;
  return SimpleHLS2MP4Converter;
}

function durationFromSegments(segments, request) {
  const segmentTotal = (Array.isArray(segments) ? segments : []).reduce(
    (sum, segment) => sum + (Number(segment?.duration) || 0),
    0,
  );
  return segmentTotal || Number(request?.totalDuration) || 0;
}

async function concatSegments(segmentPayloads) {
  const totalSize = segmentPayloads.reduce((total, buffer) => total + (buffer?.byteLength || 0), 0);
  const combined = new Uint8Array(totalSize);
  let offset = 0;
  for (const buffer of segmentPayloads) {
    combined.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  return new Blob([combined], { type: "video/mp4" });
}

async function transmuxSegments({ segmentPayloads, segments, request, downloadId, fileName, totalSegments }) {
  const ConverterClass = await loadSimpleHLS2MP4Converter();
  const converter = new ConverterClass({
    onProgress: (fraction) => {
      const progress = Math.min(99, 92 + Math.round((Number(fraction) || 0) * 8));
      sendHlsProgress({
        downloadId,
        progress,
        fileName,
        segmentIndex: segmentPayloads.length,
        totalSegments,
        status: `Transmuxing segments (${Math.round((Number(fraction) || 0) * 100)}%)`,
      });
    },
  });
  hlsActiveConverters.set(downloadId, converter);
  try {
    const options = {
      videoCodec: "avc1.42E01E",
      audioCodec: "mp4a.40.2",
    };
    const duration = durationFromSegments(segments, request);
    if (duration > 0) options.duration = duration;
    return await converter.convertSegments(segmentPayloads, options);
  } finally {
    hlsActiveConverters.delete(downloadId);
    try {
      converter.destroy?.();
    } catch {}
  }
}

function chromeDownload(options) {
  return new Promise((resolve, reject) => {
    try {
      if (!chrome?.downloads || typeof chrome.downloads.download !== "function") {
        reject(new Error("chrome.downloads.download is unavailable"));
        return;
      }
      const maybePromise = chrome.downloads.download(options, (downloadId) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) reject(new Error(lastError.message));
        else resolve(downloadId);
      });
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(resolve, reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function anchorDownload(blobUrl, fileName) {
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

async function completeBlob({ kind, downloadId, fileName, blob, completion }) {
  const finalFileName = normalizeFileName(fileName);
  const blobUrl = URL.createObjectURL(blob);
  const type = kind === "hls" ? "HLS_PROCESSING_COMPLETE" : "MP4_DOWNLOAD_COMPLETE";
  const isBackgroundOwned = completion === "background";
  let chromeDownloadId = null;

  if (!isBackgroundOwned) {
    try {
      chromeDownloadId = await chromeDownload({
        url: blobUrl,
        filename: scopedFileName(finalFileName),
        saveAs: false,
      });
      logger.log(`Chrome download started for ${finalFileName}`, chromeDownloadId);
    } catch (downloadError) {
      logger.warn("chrome.downloads.download failed, falling back to anchor", downloadError);
      try {
        anchorDownload(blobUrl, finalFileName);
      } catch (anchorError) {
        logger.error("Anchor download fallback failed", anchorError);
        throw anchorError;
      }
    }
  }

  const payload = {
    type,
    downloadId,
    fileName: finalFileName,
    fileSize: blob.size,
  };
  if (chromeDownloadId !== null) payload.chromeDownloadId = chromeDownloadId;
  if (isBackgroundOwned) payload.blobUrl = blobUrl;
  if (kind === "hls") {
    sendHlsComplete(payload);
  } else {
    sendMp4Complete(payload);
  }

  const revokeDelayMs = isBackgroundOwned ? 120000 : config.mp4.revokeDelayMs;
  setTimeout(() => {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {}
  }, revokeDelayMs);
}

async function processHLSSegments(request) {
  const downloadId = String(request?.downloadId || `hls-${Date.now()}`);
  const segments = Array.isArray(request?.segments) ? request.segments : [];
  const totalSegments = Number(request?.totalSegments) || segments.length;
  const fileName = normalizeFileName(request?.fileName || request?.filename);

  if (!segments.length) throw new Error("No HLS segments provided");

  logger.log(`Processing ${segments.length} HLS segments for ${fileName}`);
  hlsActive.add(downloadId);
  hlsCancelled.delete(downloadId);

  try {
    const segmentPayloads = new Array(segments.length);
    let completed = 0;
    let cursor = 0;
    let fatalError = null;
    const concurrency = Math.min(config.hls.segmentConcurrency, segments.length);
    const downloadPhaseCap = config.hls.mode === "transmux" ? 90 : 94;
    const reportProgress = () => {
      const progress = totalSegments > 0 ? Math.round((completed / totalSegments) * downloadPhaseCap) : 0;
      sendHlsProgress({
        downloadId,
        fileName,
        progress,
        status: `Downloaded segment ${completed}/${totalSegments}`,
        segmentIndex: completed,
        totalSegments,
      });
    };
    if (totalSegments > 0) {
      sendHlsProgress({
        downloadId,
        fileName,
        progress: Math.min(5, downloadPhaseCap),
        status: `Downloading segment 1/${totalSegments}`,
        segmentIndex: 1,
        totalSegments,
      });
    }

    const downloadNextSegment = async () => {
      while (!fatalError && cursor < segments.length) {
        if (hlsCancelled.has(downloadId)) throw new Error("Download cancelled by user");
        const index = cursor;
        cursor += 1;
        const segment = segments[index];
        try {
          const blob = await fetchBlobWithRetry({
            url: segment.url,
            referer: getRequestReferer(request, segment),
            downloadId,
            segmentIndex: index,
            totalSegments,
            fileName,
            progressCap: downloadPhaseCap,
            kind: "hls",
          });
          segmentPayloads[index] = await blob.arrayBuffer();
          completed += 1;
          reportProgress();
        } catch (error) {
          logger.error(`Failed to download segment ${index + 1}:`, error);
          if (!config.hls.continueOnSegmentError) {
            fatalError = error;
            throw error;
          }
        }
      }
    };

    if (concurrency > 1) logger.log(`Downloading HLS segments with concurrency ${concurrency}`);
    await Promise.all(Array.from({ length: concurrency }, () => downloadNextSegment()));
    if (fatalError) throw fatalError;

    const downloadedPayloads = segmentPayloads.filter(Boolean);
    if (!downloadedPayloads.length) throw new Error("No segments were successfully downloaded");
    if (downloadedPayloads.length !== segmentPayloads.length) {
      logger.warn(`Downloaded ${downloadedPayloads.length}/${segmentPayloads.length} HLS segments`);
    }

    if (hlsCancelled.has(downloadId)) throw new Error("Download cancelled by user");

    sendHlsProgress({
      downloadId,
      fileName,
      progress: config.hls.mode === "transmux" ? 92 : 95,
      status: config.hls.mode === "transmux" ? "Preparing MP4 container..." : "Combining segments...",
    });

    const outputBlob =
      config.hls.mode === "concat"
        ? await concatSegments(downloadedPayloads)
        : await transmuxSegments({ segmentPayloads: downloadedPayloads, segments, request, downloadId, fileName, totalSegments });

    if (hlsCancelled.has(downloadId)) throw new Error("Download cancelled by user");
    if (!(outputBlob instanceof Blob)) throw new Error("HLS processing did not produce a Blob");

    await completeBlob({
      kind: "hls",
      downloadId,
      fileName,
      blob: outputBlob,
      completion: config.hls.completion,
    });
    logger.log(`HLS processing complete for ${fileName}`);
  } catch (error) {
    logger.error("HLS processing failed:", error);
    sendHlsError({
      downloadId,
      fileName,
      error: error?.message || String(error),
    });
  } finally {
    hlsActive.delete(downloadId);
    hlsCancelled.delete(downloadId);
    try {
      abortHlsAttemptControllers(downloadId);
    } catch {}
    try {
      hlsActiveConverters.get(downloadId)?.cancel?.();
    } catch {}
    hlsActiveConverters.delete(downloadId);
  }
}

async function processMP4Download(request) {
  const downloadId = String(request?.downloadId || `mp4-${Date.now()}`);
  const fileName = normalizeFileName(request?.fileName);
  const videoUrl = request?.videoUrl || request?.url;
  const referer = getRequestReferer(request, null);

  if (!videoUrl) {
    sendMp4Error({
      type: "MP4_DOWNLOAD_ERROR",
      downloadId,
      fileName,
      error: "Invalid request",
    });
    return;
  }

  const controller = new AbortController();
  mp4Active.set(downloadId, { controller });
  try {
    const response = await withTemporaryRefererRule(
      videoUrl,
      referer,
      () => fetch(videoUrl, buildFetchOptions({
        signal: controller.signal,
        referer,
        kind: "mp4",
        rangeRequest: Boolean(request?.rangeRequest || request?.requiresRangeRequest),
      })),
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const totalBytes = parseInt(response.headers.get("Content-Length") || "0", 10) || 0;
    const reader = response.body?.getReader?.();
    if (!reader) throw new Error("Failed to get response reader");

    let downloadedBytes = 0;
    const chunks = [];
    sendMp4Progress({
      downloadId,
      fileName,
      downloadedBytes,
      totalBytes,
      progress: 0,
      status: "Starting",
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        downloadedBytes += value.byteLength || value.length || 0;
      }
      const progress = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
      sendMp4Progress({
        downloadId,
        fileName,
        downloadedBytes,
        totalBytes,
        progress,
        status: "Downloading",
      });
    }

    const blob = new Blob(chunks, { type: "video/mp4" });
    await completeBlob({
      kind: "mp4",
      downloadId,
      fileName,
      blob,
      completion: config.mp4.completion,
    });
  } catch (error) {
    if (error?.name !== "AbortError") {
      logger.error("MP4 download failed:", error);
      sendMp4Error({
        type: "MP4_DOWNLOAD_ERROR",
        downloadId,
        fileName,
        error: error?.message || String(error),
      });
    }
  } finally {
    mp4Active.delete(downloadId);
  }
}

function cancelHls(downloadId) {
  if (!downloadId) return;
  hlsCancelled.add(String(downloadId));
  hlsActive.delete(String(downloadId));
  abortHlsAttemptControllers(String(downloadId));
  try {
    hlsActiveConverters.get(String(downloadId))?.cancel?.();
  } catch {}
  hlsActiveConverters.delete(String(downloadId));
}

function cancelMp4(downloadId) {
  const active = mp4Active.get(String(downloadId));
  try {
    active?.controller?.abort();
  } catch {}
  mp4Active.delete(String(downloadId));
}

function scheduleRevoke(message) {
  const delayMs = Math.max(0, Number(message?.delayMs) || 0);
  const blobUrl = message?.blobUrl;
  if (!blobUrl) return;
  setTimeout(() => {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {}
  }, delayMs);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const messageType = message?.type || message?.action || "";
  logger.log("Received message:", messageType || "(unknown)");

  if (message?.target === "offscreen" && messageType === "processHLS") {
    const data = message?.data || {};
    try {
      sendResponse?.({ success: true, message: "HLS processing started" });
    } catch {}
    void processHLSSegments({
      ...data,
      fileName: data.fileName || data.filename,
      totalSegments: data.totalSegments || (Array.isArray(data.segments) ? data.segments.length : 0),
    });
    return true;
  }

  if (message?.target === "offscreen" && messageType === "cancelHLS") {
    cancelHls(message?.data?.downloadId || message?.downloadId);
    try {
      sendResponse?.({ success: true, message: "HLS processing cancelled" });
    } catch {}
    return false;
  }

  if (messageType === "PROCESS_HLS_SEGMENTS") {
    try {
      sendResponse?.({ success: true, message: "HLS processing started" });
    } catch {}
    void processHLSSegments(message);
    // Ack already sent synchronously; close the channel.
    return false;
  }

  if (messageType === "CANCEL_HLS_PROCESSING") {
    cancelHls(message?.downloadId);
    try {
      sendResponse?.({ success: true, message: "HLS processing cancelled" });
    } catch {}
    return false;
  }

  if (messageType === "PROCESS_MP4_DOWNLOAD") {
    try {
      sendResponse?.({ success: true, message: "MP4 download started" });
    } catch {}
    void processMP4Download(message);
    // Ack already sent synchronously; close the channel.
    return false;
  }

  if (messageType === "CANCEL_MP4_DOWNLOAD") {
    cancelMp4(message?.downloadId);
    try {
      sendResponse?.({ success: true, message: "MP4 download cancelled" });
    } catch {}
    return false;
  }

  if (/OFFSCREEN_REVOKE_URL$/.test(messageType)) {
    scheduleRevoke(message);
    try {
      sendResponse?.({ success: true });
    } catch {}
    return false;
  }

  return false;
});

sendReady();
logger.log("Offscreen script loaded and ready", {
  hlsMode: config.hls.mode,
  hlsCompletion: config.hls.completion,
  mp4Completion: config.mp4.completion,
});
