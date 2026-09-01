// Shared popup lifecycle for unified legacy direct-video downloaders.
(function () {
  "use strict";

  if (globalThis.__RULE34_UNIFIED_POPUP__) return;
  globalThis.__RULE34_UNIFIED_POPUP__ = true;

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
      mainContent: document.getElementById("mainContent"),
      bootSplash: document.getElementById("bootSplash"),
      downloadProgress: document.getElementById("download-progress"),
      progressFill: document.querySelector(".progress-fill"),
      progressText: document.querySelector(".progress-text"),
      quickHelpBtn: document.getElementById("quickHelpBtn"),
      quickHelpBanner: document.getElementById("quickHelpBanner"),
      openOptions: document.getElementById("open-options"),
      viewHistory: document.getElementById("view-history"),
      limitSlider: document.getElementById("limit-slider"),
      limitInput: document.getElementById("limit-input"),
      limitValue: document.getElementById("limit-value"),
      queueStatus: document.getElementById("queue-status"),
      queueSection: document.getElementById("queue-section"),
      queueSummary: document.getElementById("queue-summary"),
      queueList: document.getElementById("queue-list"),
      clearQueueBtn: document.getElementById("clear-queue-btn"),
      masterFolder: document.getElementById("master-folder"),
      manualFolder: document.getElementById("manual-folder"),
      tokenChecks: document.getElementById("token-checks"),
      tagChecks: document.getElementById("tag-checks"),
      templateAdvanced: document.getElementById("template-advanced"),
      collectionTemplate: document.getElementById("collection-template"),
      artistFolderMode: document.getElementById("artist-folder-mode"),
      useSearchQuery: document.getElementById("use-search-query"),
      pictureMode: document.getElementById("picture-mode"),
      duplicateBehaviour: document.getElementById("duplicate-behaviour"),
      outputPathPreview: document.getElementById("output-path-preview"),
      bulkTag: document.getElementById("bulk-tag"),
      bulkPlaylist: document.getElementById("bulk-playlist"),
      bulkBtn: document.getElementById("bulk-btn"),
      bulkStatus: document.getElementById("bulk-status"),
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

  function showMainShell(elements) {
    hide(elements.bootSplash);
    show(elements.mainContent);
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

  // True for a rule34video.com / rule34.world post page the background service
  // worker can resolve directly (via the post page or the rule34.world API),
  // even when the content script could not read the SPA / lazy-loaded player.
  function supportedPostUrl(url) {
    const value = String(url || "");
    return (
      /^https?:\/\/(?:www\.)?rule34video\.com\/(?:video|popup-video)\/\d+/i.test(value) ||
      /^https?:\/\/(?:www\.)?rule34\.world\/post\/\d+/i.test(value)
    );
  }

  function fallbackVideoInfoForTab(tab) {
    const url = String((tab && tab.url) || "");
    if (!supportedPostUrl(url)) return null;
    const idMatch = url.match(/(\d+)/);
    return {
      id: idMatch ? idMatch[1] : "",
      title: "",
      url,
      webpage_url: url,
      pageUrl: url,
      thumbnail: "",
      formats: [],
      resolvedByBackground: true,
    };
  }

  async function requestVideoInfo(tabId) {
    const overrideInfo = globalThis.__RULE34_TEST_VIDEO_INFO_OVERRIDE__;
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

  function trackSelectedExtension(elements, state) {
    if (!elements.qualitySelect) return;
    elements.qualitySelect.addEventListener("change", () => {
      const format = selectedFormat(elements, state);
      state.selectedExtHint = String((format && format.ext) || "").toLowerCase() || state.selectedExtHint;
      refreshOutputPreview(elements, state);
    });
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
    // Metadata the folder-name tokens are filled from.
    if (state.currentVideoInfo) {
      if (response.apiArtist && !state.currentVideoInfo.artist) state.currentVideoInfo.artist = response.apiArtist;
      if (response.apiUploader && !state.currentVideoInfo.uploader) state.currentVideoInfo.uploader = response.apiUploader;
      if (response.apiDate && !state.currentVideoInfo.date) state.currentVideoInfo.date = response.apiDate;
    }
    if (Array.isArray(response.apiTags)) state.outputResolvedTags = response.apiTags;
    if (response.apiKind === "image") state.selectedExtHint = "jpg";

    state.availableFormats = normalizeFormats(response);
    applyOutputContext(elements, state);
    populateFormats(elements, state.availableFormats);
    trackSelectedExtension(elements, state);
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
    state.currentTabUrl = tab.url || "";
    try {
      try {
        state.currentVideoInfo = await requestVideoInfo(tab.id);
      } catch (videoInfoError) {
        // The content-script DOM extractor cannot see rule34.world's Angular
        // shell or some lazy KVS players. For a supported post page, fall back
        // to a minimal record keyed on the tab URL and let the background
        // post-resolver (getVideoFormats fast path) populate formats/title.
        const fallback = fallbackVideoInfoForTab(tab);
        if (!fallback) throw videoInfoError;
        logger.warn("content getVideoInfo failed; using background post resolver", videoInfoError && videoInfoError.message);
        state.currentVideoInfo = fallback;
      }
      applyVideoInfo(elements, state.currentVideoInfo, state.currentTabId);
      await loadFormats(elements, state);
    } catch (error) {
      logger.error("popup initialization failed", error);
      if (hasUsableVideoInfo(globalThis.__RULE34_TEST_VIDEO_INFO_OVERRIDE__)) {
        try {
          state.currentVideoInfo = globalThis.__RULE34_TEST_VIDEO_INFO_OVERRIDE__;
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

    const outputChoice = currentOutputChoice(elements, state);
    const payload = {
      ...state.currentVideoInfo,
      selectedFormat: format,
      selectedFormatIndex: Number(elements.qualitySelect && elements.qualitySelect.value) || 0,
      // Per-post naming choice: the manual folder name, the tags checked in
      // the popup, and whether the current search query names the folder.
      __output: {
        manual: outputChoice.manual,
        tags: outputChoice.tags,
        useSearchQuery: outputChoice.useSearchQuery,
      },
      __searchContext: outputChoice.useSearchQuery ? outputChoice.searchContext : "",
    };
    state.selectedExtHint = String(format.ext || "").toLowerCase() || state.selectedExtHint;
    refreshOutputPreview(elements, state);

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
      if (result.queued) {
        setButtonLabel(elements.downloadBtn, `Queued (#${result.queuePosition || "?"})`);
        elements.downloadBtn.style.background = "";
        hide(elements.downloadProgress);
        setTimeout(() => resetDownloadButton(elements), 4000);
        telemetry("popup.download.queued", { position: result.queuePosition || 0 });
        refreshQueueStatus(elements);
        refreshQueueItems(elements);
        return;
      }
      flashDownloadStarted(elements);
      startProgressPolling(elements, downloadId, isHlsFormat(format) || Boolean(result.isHLS));
      telemetry("popup.download.started", { hasDownloadId: Boolean(downloadId), isHls: isHlsFormat(format) });
      refreshQueueStatus(elements);
        refreshQueueItems(elements);
    } catch (error) {
      logger.error("download failed", error);
      showError(elements, error && error.message ? error.message : "Download failed.");
      resetDownloadButton(elements);
    } finally {
      setTimeout(() => updateDownloadAvailability(elements, state), 500);
    }
  }

  // --- Simultaneous download limit control (slider + typeable number) ---
  const LIMIT_STORAGE_KEY = "downloadConcurrencyLimit";
  const LIMIT_SLIDER_MAX = 10;
  const LIMIT_MAX = 99;

  function normalizeLimit(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(parsed, LIMIT_MAX);
  }

  function renderLimit(elements, limit, options = {}) {
    const value = normalizeLimit(limit);
    if (elements.limitValue) {
      elements.limitValue.textContent = value > 0 ? String(value) : "Unlimited";
    }
    if (elements.limitSlider && !options.skipSlider) {
      elements.limitSlider.value = String(Math.min(value, LIMIT_SLIDER_MAX));
    }
    if (elements.limitInput && !options.skipInput) {
      elements.limitInput.value = value > 0 ? String(value) : "";
    }
  }

  let saveLimitTimer = null;
  function saveLimit(limit) {
    const value = normalizeLimit(limit);
    if (saveLimitTimer) clearTimeout(saveLimitTimer);
    saveLimitTimer = setTimeout(() => {
      runtimeMessage({ action: "setDownloadLimit", limit: value }, { timeoutMs: 4000 }).then((response) => {
        if (!response || !response.success) {
          try { chrome.storage.local.set({ [LIMIT_STORAGE_KEY]: value }); } catch {}
        }
      });
    }, 200);
  }

  async function initLimitControls(elements) {
    let stored = 0;
    try {
      const data = await chrome.storage.local.get([LIMIT_STORAGE_KEY]);
      stored = normalizeLimit(data && data[LIMIT_STORAGE_KEY]);
    } catch {}
    renderLimit(elements, stored);

    if (elements.limitSlider) {
      elements.limitSlider.addEventListener("input", () => {
        const value = normalizeLimit(elements.limitSlider.value);
        renderLimit(elements, value, { skipSlider: true });
        saveLimit(value);
      });
    }

    if (elements.limitInput) {
      const applyTyped = () => {
        const digits = String(elements.limitInput.value || "").replace(/[^0-9]/g, "");
        const value = normalizeLimit(digits);
        renderLimit(elements, value, { skipInput: true });
        saveLimit(value);
      };
      elements.limitInput.addEventListener("input", applyTyped);
      elements.limitInput.addEventListener("change", () => {
        applyTyped();
        renderLimit(elements, normalizeLimit(elements.limitInput.value));
      });
    }
  }

  async function refreshQueueStatus(elements) {
    if (!elements.queueStatus) return;
    const response = await runtimeMessage({ action: "getQueueStatus" }, { timeoutMs: 3000 });
    if (!response || !response.success) return;
    const active = Number(response.active) || 0;
    const queued = Number(response.queued) || 0;
    if (!active && !queued) {
      elements.queueStatus.textContent = "";
      return;
    }
    const parts = [`${active} active`];
    if (queued) parts.push(`${queued} queued`);
    elements.queueStatus.textContent = parts.join(" \u2022 ");
  }

  // --- Queue list (active + waiting downloads, persisted across reloads) ---

  function renderQueueItems(elements, response) {
    if (!elements.queueSection || !elements.queueList) return;
    const active = Array.isArray(response.active) ? response.active : [];
    const queued = Array.isArray(response.queued) ? response.queued : [];
    const batchPending = Number(response.batchPending) || 0;
    if (!active.length && !queued.length && !batchPending) {
      hide(elements.queueSection);
      if (elements.queueSummary) elements.queueSummary.textContent = "";
      return;
    }
    show(elements.queueSection);
    const parts = [];
    if (active.length) parts.push(`${active.length} active`);
    if (queued.length) parts.push(`${queued.length} queued`);
    if (batchPending) parts.push(`${batchPending} resolving`);
    if (elements.queueSummary) elements.queueSummary.textContent = parts.join(" \u2022 ");

    elements.queueList.innerHTML = "";
    const addItem = (kind, title, posLabel, cancelable, onCancel) => {
      const item = document.createElement("li");
      item.className = `queue-item qi-${kind}`;
      const dot = document.createElement("span");
      dot.className = "qi-dot";
      const label = document.createElement("span");
      label.className = "qi-title";
      label.textContent = title || "Download";
      label.title = title || "";
      item.appendChild(dot);
      item.appendChild(label);
      if (posLabel) {
        const pos = document.createElement("span");
        pos.className = "qi-pos";
        pos.textContent = posLabel;
        item.appendChild(pos);
      }
      if (cancelable) {
        const cancel = document.createElement("button");
        cancel.className = "qi-cancel";
        cancel.type = "button";
        cancel.textContent = "\u2715";
        cancel.title = "Cancel this queued download";
        cancel.setAttribute("aria-label", "Cancel this queued download");
        cancel.addEventListener("click", () => {
          if (onCancel) onCancel();
        });
        item.appendChild(cancel);
      }
      elements.queueList.appendChild(item);
    };

    for (const item of active) {
      addItem("active", item.title, null, false, null);
    }
    for (const item of queued) {
      addItem(
        "queued",
        item.title,
        `#${item.position || "?"}`,
        true,
        () => {
          runtimeMessage({ action: "cancelDownload", downloadId: item.queuedId }, { timeoutMs: 3000 }).then(() => {
            refreshQueueStatus(elements);
            refreshQueueItems(elements);
          });
        },
      );
    }
  }

  function refreshQueueItems(elements) {
    runtimeMessage({ action: "getQueueItems" }, { timeoutMs: 3000 }).then((response) => {
      if (response && response.success) renderQueueItems(elements, response);
    });
  }

  function clearQueue(elements) {
    runtimeMessage({ action: "clearQueue" }, { timeoutMs: 3000 }).then((response) => {
      if (response && response.success) {
        telemetry("popup.queue.cleared", { removedQueued: response.removedQueued || 0, removedBatch: response.removedBatch || 0 });
        refreshQueueStatus(elements);
        refreshQueueItems(elements);
      }
    });
  }

  // --- Output organization: master folder + site + collection folder --------
  // Settings live in chrome.storage.sync so they follow the user across
  // machines; the per-post "manual name / checked tags" choice travels with
  // the download request instead (the background remembers it per post URL).
  const OUTPUT_SETTINGS = {
    masterFolder: "R34V",
    collectionTemplate: "{artist} - {title} - {id}",
    artistFolderMode: false,
    pictureSaveMode: "loose",
    duplicateBehaviour: "uniquify",
  };
  const TOKEN_LABELS = {
    site: "Site",
    artist: "Artist",
    uploader: "Uploader",
    title: "Title",
    text: "Title (first 40 chars)",
    id: "Post ID",
    date: "Date",
    tags: "Checked tags",
  };

  function outputStorage() {
    try {
      return chrome.storage && (chrome.storage.sync || chrome.storage.local);
    } catch {
      return null;
    }
  }

  let saveOutputTimer = null;
  function saveOutputSettings(patch) {
    if (saveOutputTimer) clearTimeout(saveOutputTimer);
    saveOutputTimer = setTimeout(() => {
      const area = outputStorage();
      if (area) {
        try { area.set(patch); } catch {}
      }
    }, 250);
  }

  function readOutputSettings() {
    return new Promise((resolve) => {
      const area = outputStorage();
      if (!area) {
        resolve({ ...OUTPUT_SETTINGS });
        return;
      }
      try {
        const done = (data) => resolve({ ...OUTPUT_SETTINGS, ...(data || {}) });
        const maybePromise = area.get({ ...OUTPUT_SETTINGS }, done);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(done, () => resolve({ ...OUTPUT_SETTINGS }));
        }
      } catch {
        resolve({ ...OUTPUT_SETTINGS });
      }
    });
  }

  function currentOutputChoice(elements, state) {
    const Folder = globalThis.R34FolderNaming;
    const checked = {};
    if (elements.tokenChecks && Folder) {
      for (const token of Folder.COLLECTION_TOKENS) {
        const box = elements.tokenChecks.querySelector(`[data-token="${token}"]`);
        checked[token] = Boolean(box && box.checked);
      }
    }
    const tags = [];
    if (elements.tagChecks) {
      for (const box of elements.tagChecks.querySelectorAll("input[type=checkbox]")) {
        if (box.checked && box.value) tags.push(box.value);
      }
    }
    return {
      template: elements.collectionTemplate ? elements.collectionTemplate.value : "",
      checked,
      manual: elements.manualFolder ? elements.manualFolder.value.trim() : "",
      tags,
      artistFolderMode: Boolean(elements.artistFolderMode && elements.artistFolderMode.checked),
      useSearchQuery: Boolean(state.outputSearchQuery && elements.useSearchQuery && elements.useSearchQuery.classList.contains("active")),
      searchContext: state.outputSearchQuery || "",
      masterFolder: elements.masterFolder ? elements.masterFolder.value : "",
    };
  }

  function refreshOutputPreview(elements, state) {
    const Folder = globalThis.R34FolderNaming;
    if (!elements.outputPathPreview || !Folder) return;
    const choice = currentOutputChoice(elements, state);
    const info = state.currentVideoInfo || {};
    const pageUrl = String(info.url || info.webpage_url || "");
    const site = Folder.siteSlugForUrl(pageUrl) || "site";
    const uploader = String(info.uploader || info.owner || info.channel || "").trim();
    const context = {
      site,
      // Mirrors the background: {artist} falls back to the uploader.
      artist: String(info.artist || "").trim() || uploader,
      uploader,
      title: String(info.title || "").trim(),
      text: String(info.title || "").trim(),
      id: String(info.id || "").trim(),
      date: String(info.date || "").trim(),
      tags: choice.tags,
    };
    const path = Folder.buildRelativePath({
      masterFolder: choice.masterFolder,
      site,
      template: choice.template,
      artistFolderMode: choice.artistFolderMode,
      manual: choice.manual,
      checkedTags: choice.tags,
      searchContext: choice.useSearchQuery ? choice.searchContext : "",
      context,
      fallbackId: context.id,
      basename: context.title || context.id,
      ext: (state.selectedExtHint || "mp4"),
    });
    elements.outputPathPreview.textContent = "Downloads/" + path;
    const folder = Folder.buildDirectoryPath({
      masterFolder: choice.masterFolder,
      site,
      template: choice.template,
      artistFolderMode: choice.artistFolderMode,
      manual: choice.manual,
      checkedTags: choice.tags,
      searchContext: choice.useSearchQuery ? choice.searchContext : "",
      context,
      fallbackId: context.id,
      basename: context.title || context.id,
      ext: state.selectedExtHint || "mp4",
    });
    const collection = folder.split("/").slice(-1)[0] || "";
    elements.outputPathPreview.title = collection ? "Folder name: " + collection : "";
  }

  function renderTokenCheckboxes(elements, state, template) {
    const Folder = globalThis.R34FolderNaming;
    if (!elements.tokenChecks || !Folder) return;
    elements.tokenChecks.innerHTML = "";
    const inUse = Folder.templateTokensInUse(template);
    for (const token of Folder.COLLECTION_TOKENS) {
      const wrapper = document.createElement("label");
      wrapper.className = "check-row";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.token = token;
      box.checked = Boolean(inUse[token]);
      box.addEventListener("change", () => {
        const checked = {};
        for (const item of Folder.COLLECTION_TOKENS) {
          const node = elements.tokenChecks.querySelector(`[data-token="${item}"]`);
          checked[item] = Boolean(node && node.checked);
        }
        const rebuilt = Folder.buildTemplate(checked);
        if (elements.collectionTemplate) elements.collectionTemplate.value = rebuilt;
        saveOutputSettings({ collectionTemplate: rebuilt });
        refreshOutputPreview(elements, state);
      });
      wrapper.appendChild(box);
      wrapper.appendChild(document.createTextNode(" " + (TOKEN_LABELS[token] || token)));
      elements.tokenChecks.appendChild(wrapper);
    }
  }

  function renderTagCheckboxes(elements, state) {
    if (!elements.tagChecks) return;
    const tags = Array.isArray(state.outputTags) ? state.outputTags.filter(Boolean) : [];
    elements.tagChecks.innerHTML = "";
    if (!tags.length) {
      elements.tagChecks.classList.add("hidden");
      return;
    }
    elements.tagChecks.classList.remove("hidden");
    const heading = document.createElement("div");
    heading.className = "token-heading";
    heading.textContent = "Tags on this page";
    elements.tagChecks.appendChild(heading);
    for (const tag of tags.slice(0, 40)) {
      const wrapper = document.createElement("label");
      wrapper.className = "check-row";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = tag;
      box.checked = state.outputCheckedTags.has(tag);
      box.addEventListener("change", () => {
        if (box.checked) state.outputCheckedTags.add(tag);
        else state.outputCheckedTags.delete(tag);
        // Checking a tag only shows up in the name once {tags} is part of the
        // template; turn it on for the user instead of silently doing nothing.
        if (box.checked && elements.tokenChecks) {
          const tokenBox = elements.tokenChecks.querySelector('[data-token="tags"]');
          if (tokenBox && !tokenBox.checked) {
            tokenBox.checked = true;
            tokenBox.dispatchEvent(new Event("change"));
          }
        }
        refreshOutputPreview(elements, state);
      });
      wrapper.appendChild(box);
      wrapper.appendChild(document.createTextNode(" " + tag));
      elements.tagChecks.appendChild(wrapper);
    }
  }

  async function initOutputControls(elements, state) {
    const Folder = globalThis.R34FolderNaming;
    if (!Folder || !elements.masterFolder) return;
    const settings = await readOutputSettings();

    // The empty string is meaningful ("no master folder"), so this input is
    // wired by hand instead of through a generic widget that would drop it.
    elements.masterFolder.value = String(settings.masterFolder === undefined ? "" : settings.masterFolder);
    elements.masterFolder.placeholder = Folder.DEFAULT_MASTER_FOLDER;
    elements.masterFolder.addEventListener("input", () => {
      saveOutputSettings({ masterFolder: elements.masterFolder.value.trim() });
      refreshOutputPreview(elements, state);
    });

    // Undefined = never set (use the default); "" = every token unchecked.
    const template = settings.collectionTemplate === undefined || settings.collectionTemplate === null
      ? Folder.DEFAULT_COLLECTION_TEMPLATE
      : String(settings.collectionTemplate);
    if (elements.collectionTemplate) {
      elements.collectionTemplate.value = template;
      // A template the checkboxes cannot represent stays editable by hand so
      // nothing the user typed is lost.
      if (!Folder.isTokenOnlyTemplate(template) && elements.templateAdvanced) {
        elements.templateAdvanced.classList.remove("hidden");
      }
      elements.collectionTemplate.addEventListener("input", () => {
        saveOutputSettings({ collectionTemplate: elements.collectionTemplate.value });
        refreshOutputPreview(elements, state);
      });
    }
    renderTokenCheckboxes(elements, state, template);

    if (elements.artistFolderMode) {
      elements.artistFolderMode.checked = Boolean(settings.artistFolderMode);
      elements.artistFolderMode.addEventListener("change", () => {
        saveOutputSettings({ artistFolderMode: elements.artistFolderMode.checked });
        refreshOutputPreview(elements, state);
      });
    }
    if (elements.pictureMode) {
      elements.pictureMode.value = String(settings.pictureSaveMode || "loose");
      elements.pictureMode.addEventListener("change", () => {
        saveOutputSettings({ pictureSaveMode: elements.pictureMode.value });
      });
    }
    if (elements.duplicateBehaviour) {
      elements.duplicateBehaviour.value = String(settings.duplicateBehaviour || "uniquify");
      elements.duplicateBehaviour.addEventListener("change", () => {
        saveOutputSettings({ duplicateBehaviour: elements.duplicateBehaviour.value });
      });
    }
    if (elements.manualFolder) {
      elements.manualFolder.addEventListener("input", () => refreshOutputPreview(elements, state));
    }
    if (elements.useSearchQuery) {
      elements.useSearchQuery.addEventListener("click", () => {
        elements.useSearchQuery.classList.toggle("active");
        refreshOutputPreview(elements, state);
      });
    }
    refreshOutputPreview(elements, state);
  }

  // Fill the tag/search inputs for the page the popup is looking at.
  function applyOutputContext(elements, state) {
    const Folder = globalThis.R34FolderNaming;
    if (!Folder) return;
    const info = state.currentVideoInfo || {};
    const fromPage = Array.isArray(info.tags) ? info.tags : [];
    const tags = [];
    for (const tag of [...(state.outputResolvedTags || []), ...fromPage]) {
      const value = String(tag || "").trim();
      if (value && !tags.some((item) => item.toLowerCase() === value.toLowerCase())) tags.push(value);
    }
    state.outputTags = tags;
    renderTagCheckboxes(elements, state);

    const pageUrl = String(info.url || info.webpage_url || "");
    const search = Folder.searchContextFromUrl(state.currentTabUrl || pageUrl);
    state.outputSearchQuery = search;
    if (elements.useSearchQuery) {
      if (search) {
        elements.useSearchQuery.classList.remove("hidden");
        elements.useSearchQuery.textContent = "Use search: " + (search.length > 24 ? search.slice(0, 24) + "…" : search);
      } else {
        elements.useSearchQuery.classList.add("hidden");
        elements.useSearchQuery.classList.remove("active");
      }
    }
    refreshOutputPreview(elements, state);
  }

  // --- Bulk download by tag / playlist (rule34.world) ---
  async function initBulkTagControl(elements) {
    if (!elements.bulkBtn) return;
    const setStatus = (text, kind) => {
      if (!elements.bulkStatus) return;
      elements.bulkStatus.textContent = text || "";
      elements.bulkStatus.classList.remove("error", "success");
      if (kind) elements.bulkStatus.classList.add(kind);
    };
    elements.bulkBtn.addEventListener("click", async () => {
      const tags = (elements.bulkTag && elements.bulkTag.value || "").trim();
      const playlistUrl = (elements.bulkPlaylist && elements.bulkPlaylist.value || "").trim();
      if (!tags && !playlistUrl) {
        setStatus("Enter a tag/artist or a playlist URL first.", "error");
        return;
      }
      elements.bulkBtn.disabled = true;
      setStatus("Searching and queuing posts...");
      let site = "";
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        site = (tab && tab.url) || "";
      } catch {}
      try {
        const response = await runtimeMessage(
          { action: "bulkDownloadTag", tags, playlistUrl, site },
          { timeoutMs: 25000 },
        );
        if (!response || !response.success) {
          throw new Error((response && response.error) || "Bulk download failed.");
        }
        const accepted = Number(response.accepted) || 0;
        const skipped = Number(response.skipped) || 0;
        setStatus(
          `Queued ${accepted} post(s)${skipped ? `, ${skipped} already queued/skipped` : ""}.`,
          "success",
        );
        telemetry("popup.bulk.tag", { accepted, skipped });
        refreshQueueStatus(elements);
        refreshQueueItems(elements);
      } catch (error) {
        setStatus(error && error.message ? error.message : "Bulk download failed.", "error");
      } finally {
        elements.bulkBtn.disabled = false;
      }
    });
  }

  function startQueueStatusPolling(elements) {
    refreshQueueStatus(elements);
    refreshQueueItems(elements);
    const timer = setInterval(() => {
      refreshQueueStatus(elements);
      refreshQueueItems(elements);
    }, 2000);
    return timer;
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
    if (elements.clearQueueBtn) {
      elements.clearQueueBtn.addEventListener("click", () => {
        clearQueue(elements);
      });
    }
  }

  function applyTitles() {
    try {
      document.title = `Video ${popupTitle()}`;
      const header = document.querySelector(".header h1, .header h2");
      if (header) header.textContent = `Video ${popupTitle()}`;
      const title = document.getElementById("video-title");
      if (title && !title.dataset.rule34Touched) title.textContent = `Video ${popupTitle()}`;
    } catch {}
  }

  async function initializePopup() {
    const elements = createElements();
    const state = {
      currentVideoInfo: null,
      currentTabId: null,
      currentTabUrl: "",
      availableFormats: [],
      hasDownloadAccess: true,
      outputTags: [],
      outputResolvedTags: [],
      outputCheckedTags: new Set(),
      outputSearchQuery: "",
      selectedExtHint: "mp4",
    };

    applyTitles();
    bindUi(elements, state);
    initLimitControls(elements);
    // Awaited so the preview below never renders with default (empty) settings
    // before the stored values arrive.
    await initOutputControls(elements, state);
    initBulkTagControl(elements);
    startQueueStatusPolling(elements);

    try {
      showMainShell(elements);
      await initializeMainContent(elements, state);
    } catch (error) {
      logger.error("popup boot failed", error);
      showMainShell(elements);
      showError(elements, error && error.message ? error.message : "Something went wrong.");
    }
  }

  globalThis.Rule34UnifiedPopup = {
    initializePopup,
    normalizeFormats,
    formatDuration,
    formatBytes,
  };

  onReady(initializePopup);
})();
