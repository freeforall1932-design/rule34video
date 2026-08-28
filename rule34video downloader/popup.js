// Shared popup lifecycle for unified legacy direct-video downloaders.
(function () {
  "use strict";

  if (globalThis.__SERP_UNIFIED_POPUP__) return;
  globalThis.__SERP_UNIFIED_POPUP__ = true;

  const SiteConfig = () => globalThis.SiteConfig || {};
  const DEFAULT_TIMEOUT_MS = Math.max(
    12000,
    Number(SiteConfig().POPUP_MESSAGE_TIMEOUT_MS || SiteConfig().POPUP?.messageTimeoutMs || 12000) || 12000,
  );
  const siteName = () => SiteConfig().SITE_NAME || "Video";
  const popupTitle = () => SiteConfig().POPUP_TITLE || `Downloader for ${siteName()}`;
  const entitlement = () =>
    SiteConfig().AUTH_ENTITLEMENT ||
    SiteConfig().ENTITLEMENT ||
    (SiteConfig().AUTH && SiteConfig().AUTH.entitlement) ||
    "";
  const appKey = () => String(entitlement() || siteName()).toLowerCase();
  const logger =
    globalThis.Logger && typeof globalThis.Logger.createLogger === "function"
      ? globalThis.Logger.createLogger(`${siteName()} Popup`)
      : {
          log: () => {},
          warn: () => {},
          error: () => {},
        };

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }
    setTimeout(callback, 0);
  }

  function telemetry(evt, data = {}) {
    try {
      chrome.runtime.sendMessage({ type: "TELEMETRY_LOG", evt, source: "popup", data });
    } catch {}
  }

  function createElements() {
    return {
      loading: document.getElementById("loading"),
      error: document.getElementById("error"),
      errorMessage: document.querySelector(".error-message"),
      videoInfo: document.getElementById("video-info"),
      thumbnail: document.getElementById("thumbnail"),
      thumbnailPlaceholder: document.getElementById("thumbnail-placeholder"),
      durationBadge: document.getElementById("duration-badge"),
      title: document.getElementById("video-title"),
      duration: document.getElementById("video-duration"),
      uploader: document.getElementById("video-uploader"),
      views: document.getElementById("video-views"),
      likes: document.getElementById("video-likes"),
      dislikes: document.getElementById("video-dislikes"),
      qualitySelect: document.getElementById("quality-select"),
      downloadBtn: document.getElementById("download-btn"),
      activationSection: document.getElementById("activationSection"),
      mainContent: document.getElementById("mainContent"),
      bootSplash: document.getElementById("bootSplash"),
      downloadProgress: document.getElementById("download-progress"),
      progressFill: document.querySelector(".progress-fill"),
      progressText: document.querySelector(".progress-text"),
      quickHelpBtn: document.getElementById("quickHelpBtn"),
      quickHelpBanner: document.getElementById("quickHelpBanner"),
      openOptions: document.getElementById("open-options"),
      viewHistory: document.getElementById("view-history"),
    };
  }

  function show(node) {
    if (!node) return;
    node.classList.remove("hidden");
    node.removeAttribute("hidden");
  }

  function hide(node) {
    if (!node) return;
    node.classList.add("hidden");
  }

  function setText(node, value) {
    if (node) node.textContent = value || "";
  }

  function setButtonLabel(button, label) {
    if (!button) return;
    const textNode = button.querySelector(".btn-text");
    if (textNode) textNode.textContent = label;
    else button.textContent = label;
  }

  function formatDuration(seconds) {
    const total = Number(seconds) || 0;
    if (!total) return "";
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = Math.floor(total % 60);
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (!value) return "";
    const units = ["Bytes", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${Number((value / Math.pow(1024, index)).toFixed(1))} ${units[index]}`;
  }

  function messageWithCallback(kind, target, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve) => {
      let settled = false;
      const action = payload && (payload.action || payload.type);
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        telemetry(`${kind}.timeout`, { action, timeoutMs });
        resolve({ success: false, error: "Timed out waiting for response" });
      }, timeoutMs);

      const finish = (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const runtimeError = chrome.runtime && chrome.runtime.lastError;
        if (runtimeError) {
          resolve({ success: false, error: runtimeError.message || String(runtimeError) });
          return;
        }
        resolve(response || { success: false, error: "No response" });
      };

      try {
        if (kind === "tab") {
          chrome.tabs.sendMessage(target, payload, finish);
        } else {
          chrome.runtime.sendMessage(payload, finish);
        }
      } catch (error) {
        finish({ success: false, error: error && error.message ? error.message : String(error) });
      }
    });
  }

  function runtimeMessage(payload, options = {}) {
    return messageWithCallback("runtime", null, payload, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  }

  function tabMessage(tabId, payload, options = {}) {
    return messageWithCallback("tab", tabId, payload, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  }

  async function queryActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs && tabs[0] ? tabs[0] : null;
    } catch (error) {
      logger.warn("active tab query failed", error);
      return null;
    }
  }

  async function waitForAuth(maxMs = 2500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxMs) {
      if (globalThis.Auth) return globalThis.Auth;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return globalThis.Auth || null;
  }

  async function readLocalActivation(auth) {
    try {
      const keys = ["isActivated"];
      if (auth && auth.storageKeys && auth.storageKeys.activatedFlag) {
        keys.push(auth.storageKeys.activatedFlag);
      }
      const data = await chrome.storage.local.get(keys);
      return keys.some((key) => Boolean(data && data[key]));
    } catch {
      return false;
    }
  }

  async function checkDownloadAccess() {
    const auth = await waitForAuth();
    try {
      if (auth && typeof auth.checkActivationStatus === "function") {
        const status = await auth.checkActivationStatus();
        return Boolean(status && status.isActivated);
      }
      if (auth && typeof auth.checkActivation === "function") {
        const status = await auth.checkActivation();
        return Boolean(status && status.isActivated);
      }
    } catch (error) {
      logger.warn("auth status check failed", error);
    }

    if (await readLocalActivation(auth)) return true;

    try {
      const response = await runtimeMessage({ type: "auth/check", name: entitlement() }, { timeoutMs: 4000 });
      return Boolean(response && (response.ok || response.isActivated));
    } catch {
      return false;
    }
  }

  async function getActiveDownloadsSnapshot() {
    const response = await runtimeMessage({ action: "getActiveDownloads" }, { timeoutMs: 4000 });
    const active = response && response.active_downloads;
    return active && typeof active === "object" ? active : {};
  }

  function hasActiveDownloads(activeDownloads) {
    return Object.keys(activeDownloads || {}).length > 0;
  }

  function showActivationShell(elements) {
    hide(elements.bootSplash);
    show(elements.activationSection);
    hide(elements.mainContent);
    try {
      document.body.dataset.authScreen = "visible";
      document.body.classList.add("serp-auth-active");
    } catch {}
  }

  function showMainShell(elements) {
    hide(elements.bootSplash);
    hide(elements.activationSection);
    show(elements.mainContent);
    try {
      delete document.body.dataset.authScreen;
      document.body.classList.remove("serp-auth-active");
    } catch {}
  }

  function showLoading(elements) {
    show(elements.loading);
    hide(elements.error);
    hide(elements.videoInfo);
    if (elements.downloadBtn) elements.downloadBtn.disabled = true;
  }

  function showError(elements, message) {
    hide(elements.loading);
    hide(elements.videoInfo);
    show(elements.error);
    setText(elements.errorMessage, message || "No video found on this page.");
    if (elements.downloadBtn) elements.downloadBtn.disabled = true;
    telemetry("popup.error", { message });
  }

  function setThumbnail(elements, src, tabId) {
    if (!elements.thumbnail) return;
    const value = String(src || "").trim();
    if (!value || value.startsWith("data:")) {
      elements.thumbnail.removeAttribute("src");
      elements.thumbnail.setAttribute("hidden", "hidden");
      hide(elements.thumbnail);
      show(elements.thumbnailPlaceholder);
      return;
    }

    elements.thumbnail.src = value;
    elements.thumbnail.style.display = "block";
    elements.thumbnail.removeAttribute("hidden");
    show(elements.thumbnail);
    show(elements.thumbnailPlaceholder);
    elements.thumbnail.onload = () => hide(elements.thumbnailPlaceholder);
    elements.thumbnail.onerror = () => show(elements.thumbnailPlaceholder);

    if (tabId) {
      tabMessage(tabId, { action: "fetchThumbnailData", url: value }, { timeoutMs: 5000 }).then((response) => {
        if (response && response.success && response.dataUrl) {
          elements.thumbnail.src = response.dataUrl;
          hide(elements.thumbnailPlaceholder);
        }
      });
    }
  }

  function applyVideoInfo(elements, videoInfo, tabId) {
    const title = videoInfo && videoInfo.title ? String(videoInfo.title) : "Untitled Video";
    const duration = formatDuration(videoInfo && videoInfo.duration);
    hide(elements.loading);
    hide(elements.error);
    show(elements.videoInfo);
    setText(elements.title, title);
    setText(elements.duration, duration);
    setText(elements.durationBadge, duration);
    setText(elements.uploader, videoInfo && (videoInfo.uploader || videoInfo.owner || videoInfo.channel));
    setText(elements.views, videoInfo && videoInfo.views ? `${videoInfo.views} views` : "");
    setText(elements.likes, videoInfo && videoInfo.likes ? `${videoInfo.likes} likes` : "");
    setText(elements.dislikes, videoInfo && videoInfo.dislikes ? `${videoInfo.dislikes} dislikes` : "");
    setThumbnail(elements, videoInfo && videoInfo.thumbnail, tabId);
  }

  function getVideoInfoActions() {
    const key = appKey();
    if (key.includes("xvideos")) return ["getXVideosVideoInfo", "getVideoInfo"];
    return ["getVideoInfo", "getXVideosVideoInfo"];
  }

  function hasUsableVideoInfo(info) {
    return Boolean(info && (info.id || info.title || info.url || info.videoUrl || info.thumbnail));
  }

  async function requestVideoInfo(tabId) {
    const overrideInfo = globalThis.__SERP_TEST_VIDEO_INFO_OVERRIDE__;
    if (hasUsableVideoInfo(overrideInfo)) {
      telemetry("popup.videoInfo.override", { tabId });
      return overrideInfo;
    }

    let lastError = "";
    for (const action of getVideoInfoActions()) {
      const response = await tabMessage(tabId, { action }, { timeoutMs: 7000 });
      if (response && response.success && hasUsableVideoInfo(response.data)) {
        telemetry("popup.videoInfo.success", { action });
        return response.data;
      }
      lastError = (response && response.error) || lastError;
    }
    throw new Error(lastError || "No video found on this page.");
  }

  function normalizeFormats(response) {
    const source =
      (response && Array.isArray(response.formats) && response.formats) ||
      (response && response.result && Array.isArray(response.result.formats) && response.result.formats) ||
      (Array.isArray(response) && response) ||
      [];

    const seen = new Set();
    const formats = [];
    for (const format of source) {
      if (!format || !format.url) continue;
      const key = `${format.url}|${format.format_id || ""}|${format.quality || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      formats.push(format);
    }

    const sorted = formats.sort((a, b) => scoreFormat(b) - scoreFormat(a));
    return useFormatDisplayNormalization() ? normalizeDisplayFormats(sorted) : sorted;
  }

  function useFormatDisplayNormalization() {
    return SiteConfig().POPUP_FORMAT_NORMALIZATION_V2 !== false;
  }

  function detectFormatQuality(format) {
    const explicitHeight = normalizeDisplayHeight(format.height, { allowExplicit: true });
    if (explicitHeight) return explicitHeight;
    let quality = normalizeDisplayHeight(format.quality);
    if (quality) return quality;
    try {
      const match =
        String(format.quality || format.format_id || format.label || "").match(videoHeightPattern())
        || String(format.url || "").match(videoHeightPattern());
      if (match) {
        quality = normalizeDisplayHeight(match[1]);
      }
    } catch {}
    return quality || 0;
  }

  function scoreFormat(format) {
    const height = Math.max(normalizeDisplayHeight(format.height, { allowExplicit: true }), descriptorFormatHeight(format));
    const width = Number(format.width || 0);
    const bitrate = Number(format.tbr || format.bitrate || 0);
    const url = String(format && format.url ? format.url : "");
    // Prefer direct downloadable media over HLS for the popup default.
    // HLS is useful as a fallback, but in QA it often needs offscreen segment
    // fetching and referer handling before Chrome creates a real download.
    const transportBonus = isHlsFormat(format) ? 0 : 1000000000;
    const signedKvsBonus = /\/(?:get_file|reversebuffer)(?:\/|\?)/i.test(url) && /[?&](?:rnd|v-acctoken|token|expires|cv)=/i.test(url) ? 200000000 : 0;
    const staleKvsPenalty = /\/(?:get_file|reversebuffer)(?:\/|\?)/i.test(url) && !/[?&](?:rnd|v-acctoken|token|expires|cv)=/i.test(url) ? 200000000 : 0;
    return height * 100000 + transportBonus + signedKvsBonus + knownSizeBonus(format) + trustedDirectHostBonus(format) + width + bitrate - staleKvsPenalty - riskyHostPenalty(format);
  }

  function isHlsFormat(format) {
    const descriptor = `${format.format || ""} ${format.format_type || ""} ${format.ext || ""} ${format.protocol || ""}`.toLowerCase();
    const url = String(format.url || "").toLowerCase();
    return /\bhls\b/.test(descriptor) || descriptor.includes("m3u8") || /\.m3u8(?:$|[?#/])/i.test(url);
  }

  function detectFormatType(format) {
    const descriptor = `${format.format || ""} ${format.format_type || ""} ${format.ext || ""} ${format.protocol || ""}`.toLowerCase();
    const url = String(format.url || "").toLowerCase();
    if (/\bhls\b/.test(descriptor) || descriptor.includes("m3u8") || /\.m3u8(?:$|[?#/])/i.test(url)) return "HLS";
    if (/\bdash\b/.test(descriptor) || descriptor.includes("mpd") || /\.mpd(?:$|[?#/])/i.test(url)) return "DASH";
    if (descriptor.includes("webm") || /\.webm(?:$|[?#/])/i.test(url)) return "WEBM";
    return "MP4";
  }

  function inferFormatHeight(format) {
    const descriptor = String(`${format.quality || ""} ${format.format_id || ""}`);
    const descriptorMatch = descriptor.match(videoHeightPattern());
    if (descriptorMatch) return normalizeDisplayHeight(descriptorMatch[1]);
    const url = String(format.url || "");
    const urlMatch =
      url.match(videoHeightPattern()) ||
      url.match(new RegExp(`/(${commonDisplayHeights().join("|")})(?:$|[/?#])`, "i"));
    return urlMatch ? normalizeDisplayHeight(urlMatch[1]) : 0;
  }

  function descriptorFormatHeight(format) {
    const descriptor = String(`${format.quality || ""} ${format.format_id || ""} ${format.label || ""}`);
    const descriptorMatch = descriptor.match(videoHeightPattern());
    return descriptorMatch ? normalizeDisplayHeight(descriptorMatch[1]) : 0;
  }

  function commonDisplayHeights() {
    return [144, 180, 216, 240, 270, 288, 360, 432, 480, 540, 576, 720, 1080, 1440, 2160, 4320];
  }

  function videoHeightPattern() {
    return new RegExp(`(?:^|[^0-9])(${commonDisplayHeights().join("|")})p?(?:[^0-9]|$)`, "i");
  }

  function normalizeDisplayHeight(value, options = {}) {
    const height = Number.parseInt(value, 10);
    if (!Number.isFinite(height) || height <= 0) return 0;
    if (commonDisplayHeights().includes(height)) return height;
    if (options.allowExplicit && height >= 120 && height <= 4320) return height;
    return 0;
  }

  function displayHeight(format) {
    return Math.max(normalizeDisplayHeight(format.height, { allowExplicit: true }), detectFormatQuality(format), inferFormatHeight(format));
  }

  function displayTypeRank(type) {
    return { MP4: 0, HLS: 1, WEBM: 2, DASH: 3 }[type] ?? 9;
  }

  function mediaHost(format) {
    if (format && format.host) return String(format.host).toLowerCase();
    try {
      return new URL(String(format && format.url ? format.url : "")).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function trustedDirectHostBonus(format) {
    const host = mediaHost(format);
    if (/\b(?:bkcdn|bxcdn)\.net$/i.test(host)) return 0;
    return 0;
  }

  function knownSizeBonus(format) {
    const bytes = Number(
      format?.filesize ||
        format?.filesize_approx ||
        format?.contentLength ||
        format?.contentLengthBytes ||
        format?.size ||
        format?.totalBytes ||
        0,
    ) || 0;
    return Math.min(Math.max(bytes, 0), 500 * 1024 * 1024);
  }

  function riskyHostPenalty(format) {
    const host = mediaHost(format);
    const url = String(format && format.url ? format.url : "").toLowerCase();
    let penalty = 0;
    if (/(^|\.)streamtape\./i.test(host)) penalty += 700000000;
    if (/(^|\.)(?:dood|doodstream|fastbit|filemoon|mixdrop|upstream|uqload|voe)\./i.test(host)) penalty += 700000000;
    if (/^ev-ph\./i.test(host)) penalty += 700000000;
    if (/(?:^|[._-])\d{3,4}p?_\d+k_/i.test(url) || /_fb\.mp4(?:[?#]|$)/i.test(url)) penalty += 300000000;
    return penalty;
  }

  function hasLowInfoSourceLabel(format) {
    const raw = `${format.quality || ""} ${format.format_id || ""} ${format.label || ""}`.trim();
    return !raw || /^(html|video|source|performance|webrequest|direct|hls|mp4|auto|html-escaped)(\s|$)/i.test(raw);
  }

  function isLikelyPreviewOrNoiseFormat(format) {
    const url = String(format && format.url ? format.url : "").toLowerCase();
    if (!url) return false;
    if (/_tpl_\.mp4(?:[?#]|$)|_[a-z0-9]+_init_[a-z0-9]+\.mp4(?:[?#]|$)/i.test(url) || /\/media=hls[^/]*\/multi=/i.test(url)) return true;
    return /(?:^|[/?#._-])(?:thumb|thumbnail|sprite|timeline|heat-preview|preview|teaser|trailer)(?:[/?#._-]|$)/i.test(url) ||
      /\/pv\/|\/previews?\//i.test(url) ||
      /(?:^|[/?#._-])pv_[a-f0-9]{8,}\.mp4(?:[?#]|$)/i.test(url) ||
      /\.(?:jpg|jpeg|png|webp|gif|vtt)(?:[?#]|$)/i.test(url);
  }

  function displayNoisePenalty(format) {
    const url = String(format && format.url ? format.url : "").toLowerCase();
    if (/_tpl_\.mp4(?:[?#]|$)|_[a-z0-9]+_init_[a-z0-9]+\.mp4(?:[?#]|$)/i.test(url) || /\/media=hls[^/]*\/multi=/i.test(url)) return 500000000;
    if (/(?:^|[/?#._-])(?:thumb|thumbnail|sprite|timeline|heat-preview)(?:[/?#._-]|$)/i.test(url)) return 400000000;
    if (/(?:^|[/?#._-])(?:preview|teaser|trailer)(?:[/?#._-]|$)|\/previews?\//i.test(url)) return 300000000;
    if (/\/pv\/|(?:^|[/?#._-])pv_[a-f0-9]{8,}\.mp4(?:[?#]|$)/i.test(url)) return 200000000;
    return riskyHostPenalty(format);
  }

  function displayBucketFor(format, index) {
    const type = format.__displayType || detectFormatType(format);
    const height = format.__displayHeight || 0;
    if (height) return `${type}:${height}`;
    const host = mediaHost(format);
    if (format.__displayIsNoise) return `${type}:noise`;
    if (hasLowInfoSourceLabel(format) && host) return `${type}:unknown-host:${host}`;
    const url = String(format.url || "");
    return `${type}:unknown:${url || index}`;
  }

  function normalizeDisplayFormats(formats) {
    const buckets = new Map();
    const candidates = formats.map((format, index) => {
      const type = detectFormatType(format);
      const height = displayHeight(format);
      return {
        ...format,
        __displayType: type,
        __displayHeight: height,
        __displayScore: scoreFormat(format) - displayNoisePenalty(format),
        __displayOriginalIndex: index,
        __displayIsNoise: isLikelyPreviewOrNoiseFormat(format),
      };
    });
    candidates.forEach((candidate, index) => {
      const bucket = displayBucketFor(candidate, index);
      const existing = buckets.get(bucket);
      if (!existing || candidate.__displayScore > existing.__displayScore) buckets.set(bucket, candidate);
    });

    const unknownCounts = {};
    return Array.from(buckets.values())
      .sort((a, b) => {
        const typeDelta = displayTypeRank(a.__displayType) - displayTypeRank(b.__displayType);
        if (typeDelta) return typeDelta;
        const scoreDelta = b.__displayScore - a.__displayScore;
        if (scoreDelta) return scoreDelta;
        if (a.__displayHeight || b.__displayHeight) return (b.__displayHeight || 0) - (a.__displayHeight || 0);
        return a.__displayOriginalIndex - b.__displayOriginalIndex;
      })
      .map((format) => {
        const type = format.__displayType || detectFormatType(format);
        const height = format.__displayHeight || 0;
        if (height) return { ...format, __displayLabel: `${height}p ${type}` };
        unknownCounts[type] = (unknownCounts[type] || 0) + 1;
        const fallback = unknownCounts[type] === 1 ? `Best ${type}` : `${type} Format ${unknownCounts[type]}`;
        return { ...format, __displayLabel: fallback };
      });
  }

  function formatLabel(format, index) {
    if (format.__displayLabel) {
      const size = format.filesize || format.filesize_approx ? ` - ${formatBytes(format.filesize || format.filesize_approx)}` : "";
      return `${format.__displayLabel}${size}`;
    }
    const inferredHeight = Math.max(normalizeDisplayHeight(format.height, { allowExplicit: true }), detectFormatQuality(format), inferFormatHeight(format));
    const lowInfoQuality = /^(html|video|source|performance|webrequest|direct|hls|mp4|auto)$/i.test(String(format.quality || "").trim());
    const lowInfoFormatId = /^(html|video|source|performance|webrequest|direct|hls|mp4|auto)$/i.test(String(format.format_id || "").trim());
    const lowInfoLabel = /^(html|video|source|performance|webrequest|direct|hls|mp4|auto)$/i.test(String(format.label || "").trim());
    const quality =
      (!lowInfoQuality ? format.quality : "") ||
      (inferredHeight ? `${inferredHeight}p` : "") ||
      (!lowInfoFormatId ? format.format_id : "") ||
      (!lowInfoLabel ? format.label : "") ||
      `Format ${index + 1}`;
    const type = detectFormatType(format);
    const size = format.filesize || format.filesize_approx ? ` - ${formatBytes(format.filesize || format.filesize_approx)}` : "";
    return `${quality} - ${type}${size}`;
  }

  function populateFormats(elements, formats) {
    if (!elements.qualitySelect) return;
    elements.qualitySelect.innerHTML = "";
    if (!formats.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No formats found";
      elements.qualitySelect.appendChild(option);
      return;
    }

    formats.forEach((format, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = formatLabel(format, index);
      elements.qualitySelect.appendChild(option);
    });
    elements.qualitySelect.value = "0";
  }

  function updateDownloadAvailability(elements, state) {
    if (!elements.downloadBtn) return;
    elements.downloadBtn.disabled = !(state.hasDownloadAccess && state.availableFormats.length > 0);
  }

  async function loadFormats(elements, state) {
    const response = await runtimeMessage({
      action: "getVideoFormats",
      videoInfo: state.currentVideoInfo,
      tabId: state.currentTabId || undefined,
    });

    if (!response || !response.success) {
      throw new Error((response && response.error) || "Could not retrieve video formats.");
    }

    if (response.apiTitle && state.currentVideoInfo && !state.currentVideoInfo.title) {
      state.currentVideoInfo.title = response.apiTitle;
    }
    if (response.apiDuration && state.currentVideoInfo && !state.currentVideoInfo.duration) {
      state.currentVideoInfo.duration = Number(response.apiDuration) || state.currentVideoInfo.duration;
    }
    if (response.apiThumbnail && state.currentVideoInfo && !state.currentVideoInfo.thumbnail) {
      state.currentVideoInfo.thumbnail = response.apiThumbnail;
    }

    state.availableFormats = normalizeFormats(response);
    populateFormats(elements, state.availableFormats);
    applyVideoInfo(elements, state.currentVideoInfo, state.currentTabId);
    updateDownloadAvailability(elements, state);
    telemetry("popup.formats", { count: state.availableFormats.length });
  }

  async function initializeMainContent(elements, state) {
    showLoading(elements);
    const tab = await queryActiveTab();
    if (!tab || !tab.id) {
      showError(elements, "No active tab found.");
      return;
    }

    state.currentTabId = tab.id;
    try {
      state.currentVideoInfo = await requestVideoInfo(tab.id);
      applyVideoInfo(elements, state.currentVideoInfo, state.currentTabId);
      await loadFormats(elements, state);
    } catch (error) {
      logger.error("popup initialization failed", error);
      if (hasUsableVideoInfo(globalThis.__SERP_TEST_VIDEO_INFO_OVERRIDE__)) {
        try {
          state.currentVideoInfo = globalThis.__SERP_TEST_VIDEO_INFO_OVERRIDE__;
          applyVideoInfo(elements, state.currentVideoInfo, state.currentTabId);
          await loadFormats(elements, state);
          return;
        } catch (fallbackError) {
          logger.error("popup override fallback failed", fallbackError);
        }
      }
      showError(elements, error && error.message ? error.message : "No video found on this page.");
    }
  }

  function selectedFormat(elements, state) {
    const index = Number(elements.qualitySelect && elements.qualitySelect.value);
    if (Number.isInteger(index) && state.availableFormats[index]) return state.availableFormats[index];
    return state.availableFormats[0] || null;
  }

  function resetDownloadButton(elements) {
    if (!elements.downloadBtn) return;
    setButtonLabel(elements.downloadBtn, "Download Video");
    elements.downloadBtn.style.background = "";
  }

  function flashDownloadStarted(elements) {
    if (!elements.downloadBtn) return;
    setButtonLabel(elements.downloadBtn, "Download Started");
    elements.downloadBtn.style.background = "var(--success)";
    setTimeout(() => resetDownloadButton(elements), 3000);
  }

  function setProgress(elements, pct, text) {
    if (elements.downloadProgress) show(elements.downloadProgress);
    if (elements.progressFill && typeof pct === "number") {
      elements.progressFill.style.width = `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
    }
    if (elements.progressText) elements.progressText.textContent = text || "Downloading...";
  }

  function startProgressPolling(elements, downloadId, isHls) {
    if (!downloadId || !elements.downloadProgress) return;
    let lastSignature = "";
    const timer = setInterval(async () => {
      const response = await runtimeMessage({ action: "getDownloadProgress", downloadId }, { timeoutMs: 3500 });
      const progress = response && response.progress;
      if (!progress) {
        if (isHls) setProgress(elements, null, "Preparing HLS download...");
        return;
      }
      const pct = typeof progress.progress === "number" ? progress.progress : null;
      const status = progress.status || progress.state || "downloading";
      const signature = `${status}:${pct == null ? "" : pct}:${progress.segmentIndex || ""}:${progress.totalSegments || ""}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        telemetry("popup.download.progress", { downloadId, status, pct });
      }
      if (pct != null) {
        const segmentText =
          typeof progress.segmentIndex === "number" && typeof progress.totalSegments === "number"
            ? ` (${progress.segmentIndex}/${progress.totalSegments} segments)`
            : "";
        setProgress(elements, pct, `${Math.round(pct)}%${segmentText}`);
      } else if (progress.bytesReceived && progress.totalBytes) {
        const percent = (Number(progress.bytesReceived) / Number(progress.totalBytes)) * 100;
        setProgress(elements, percent, `${formatBytes(progress.bytesReceived)} / ${formatBytes(progress.totalBytes)}`);
      } else {
        setProgress(elements, null, "Downloading...");
      }

      if (status === "complete" || status === "error" || status === "interrupted") {
        clearInterval(timer);
        setTimeout(() => {
          hide(elements.downloadProgress);
          if (elements.progressFill) elements.progressFill.style.width = "0%";
          resetDownloadButton(elements);
        }, 1600);
      }
    }, 600);
  }

  async function handleDownload(elements, state) {
    if (!state.currentVideoInfo || !state.availableFormats.length) return;
    const format = selectedFormat(elements, state);
    if (!format) return;

    elements.downloadBtn.disabled = true;
    setButtonLabel(elements.downloadBtn, "Starting...");
    setProgress(elements, 0, "Preparing download...");

    const payload = {
      ...state.currentVideoInfo,
      selectedFormat: format,
      selectedFormatIndex: Number(elements.qualitySelect && elements.qualitySelect.value) || 0,
    };

    try {
      const response = await runtimeMessage({
        action: "downloadVideo",
        videoInfo: payload,
        tabId: state.currentTabId || undefined,
      }, { timeoutMs: 20000 });

      if (!response || !response.success) {
        throw new Error((response && response.error) || "Download failed.");
      }

      const result = response.result || response;
      const downloadId = result.downloadId || result.id || result.download_id;
      flashDownloadStarted(elements);
      startProgressPolling(elements, downloadId, isHlsFormat(format) || Boolean(result.isHLS));
      telemetry("popup.download.started", { hasDownloadId: Boolean(downloadId), isHls: isHlsFormat(format) });
    } catch (error) {
      logger.error("download failed", error);
      showError(elements, error && error.message ? error.message : "Download failed.");
      resetDownloadButton(elements);
    } finally {
      setTimeout(() => updateDownloadAvailability(elements, state), 500);
    }
  }

  function bindUi(elements, state) {
    if (elements.downloadBtn) {
      elements.downloadBtn.addEventListener("click", () => handleDownload(elements, state));
    }
    if (elements.qualitySelect) {
      elements.qualitySelect.addEventListener("change", () => updateDownloadAvailability(elements, state));
    }
    if (elements.quickHelpBtn && elements.quickHelpBanner) {
      let timer = null;
      elements.quickHelpBtn.addEventListener("click", () => {
        if (timer) clearTimeout(timer);
        show(elements.quickHelpBanner);
        timer = setTimeout(() => {
          hide(elements.quickHelpBanner);
          timer = null;
        }, 6000);
      });
    }
    if (elements.openOptions) {
      elements.openOptions.addEventListener("click", (event) => {
        event.preventDefault();
        try { chrome.runtime.openOptionsPage(); } catch {}
      });
    }
    if (elements.viewHistory) {
      elements.viewHistory.addEventListener("click", (event) => {
        event.preventDefault();
        try { chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }); } catch {}
      });
    }
  }

  function applyTitles() {
    try {
      document.title = `Video ${popupTitle()}`;
      const header = document.querySelector(".header h1, .header h2");
      if (header) header.textContent = `Video ${popupTitle()}`;
      const title = document.getElementById("video-title");
      if (title && !title.dataset.serpTouched) title.textContent = `Video ${popupTitle()}`;
    } catch {}
  }

  async function initializePopup() {
    const elements = createElements();
    const state = {
      currentVideoInfo: null,
      currentTabId: null,
      availableFormats: [],
      hasDownloadAccess: false,
    };

    applyTitles();
    bindUi(elements, state);

    try {
      const [accessResult, activeDownloadsResult] = await Promise.allSettled([
        checkDownloadAccess(),
        getActiveDownloadsSnapshot(),
      ]);
      state.hasDownloadAccess = accessResult.status === "fulfilled" && Boolean(accessResult.value);
      const activeDownloads =
        activeDownloadsResult.status === "fulfilled" ? activeDownloadsResult.value : {};

      if (state.hasDownloadAccess || hasActiveDownloads(activeDownloads)) {
        showMainShell(elements);
        await initializeMainContent(elements, state);
      } else {
        showActivationShell(elements);
      }
    } catch (error) {
      logger.error("popup boot failed", error);
      showActivationShell(elements);
    }
  }

  globalThis.SerpUnifiedPopup = {
    initializePopup,
    normalizeFormats,
    formatDuration,
    formatBytes,
  };

  onReady(initializePopup);
})();
