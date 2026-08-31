// Unified Download Manager shared core.
// Keeps the legacy public API stable while deriving site identity from SiteConfig.
(function () {
  const SiteConfig = globalThis.SiteConfig || {};
  const Logger =
    (globalThis.Logger && globalThis.Logger.createLogger && globalThis.Logger.createLogger("[RULE34 DM]")) || {
      log: function () {},
      warn: function () {},
      error: function () {},
    };

  const siteName = cleanText(SiteConfig.SITE_NAME || SiteConfig.siteName || "Video");
  const appId = normalizeAppId(
    (SiteConfig.AUTH && (SiteConfig.AUTH.storagePrefix || SiteConfig.AUTH.entitlement)) ||
      SiteConfig.AUTH_STORAGE_PREFIX ||
      SiteConfig.AUTH_ENTITLEMENT ||
      siteName,
  );
  const titleText = `${siteName} Downloader`;
  const panelId = `${appId}-download-manager`;
  const guardKey = `__RULE34_DM_LOADED__:${appId}`;
  const legacyGuardKeys = [
    "__AP_DM_LOADED__",
    "__BEEG_DM_LOADED__",
    "__EP_DM_LOADED__",
    "__PH_DM_LOADED__",
    "__RT_DM_LOADED__",
    "__SB_DM_LOADED__",
    "__TNA_DM_LOADED__",
    "__XH_DM_LOADED__",
    "__XNXX_DM_LOADED__",
    "__XV_DM_LOADED__",
    "__YP_DM_LOADED__",
  ];

  try {
    if (window[guardKey]) return;
    window[guardKey] = true;
    for (const key of legacyGuardKeys) window[key] = window[key] || true;
  } catch {}

  injectCss();

  let downloadManager = null;
  let downloadManagerVisible = false;
  const ypState = (window.__YP_DL__ = window.__YP_DL__ || {});
  const currentDownloads = pickMap(window.currentDownloads, ypState.currentDownloads);
  const cancelledDownloadIds = pickSet(window.cancelledDownloadIds, ypState.cancelledDownloadIds);
  ypState.currentDownloads = currentDownloads;
  ypState.cancelledDownloadIds = cancelledDownloadIds;

  try {
    window.currentDownloads = currentDownloads;
  } catch {}
  try {
    window.cancelledDownloadIds = cancelledDownloadIds;
  } catch {}

  try {
    window.addEventListener("message", function (event) {
      const data = event && event.data;
      if (!data || !data.downloadId) return;
      const type = String(data.type || "");
      if (/^[A-Z0-9_]+_CANCEL_DOWNLOAD$/.test(type)) {
        try {
          cancelDownload(data.downloadId);
        } catch (error) {
          Logger.warn("Cancel bridge failed", error);
        }
      }
    });
  } catch (error) {
    Logger.warn("Cancel bridge setup failed", error);
  }

  function injectCss() {
    try {
      const cssId = "rule34-download-manager-css";
      if (document.getElementById(cssId)) return;
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("styles/download-manager.css");
      (document.head || document.documentElement).appendChild(link);
    } catch (error) {
      Logger.warn("Download manager CSS inject failed", error);
    }
  }

  function createDownloadManager() {
    if (downloadManager && document.documentElement.contains(downloadManager)) return downloadManager;

    try {
      const existing = document.getElementById(panelId);
      if (existing && existing.getAttribute("data-rule34-download-manager") === "1") {
        downloadManager = existing;
        return existing;
      }
    } catch {}

    const panel = document.createElement("div");
    panel.id = panelId;
    panel.className = "rule34-download-manager";
    panel.setAttribute("data-rule34-download-manager", "1");
    panel.style.cssText = [
      "position:fixed",
      "top:20px",
      "right:-400px",
      "width:380px",
      "max-width:calc(100vw - 32px)",
      "max-height:80vh",
      "background:var(--bg-dark)",
      "border:2px solid var(--brand-accent)",
      "border-radius:10px",
      "box-shadow:0 8px 25px rgba(0,0,0,0.3)",
      "z-index:2147483647",
      "font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      "transition:right .3s ease-in-out",
      "overflow:hidden",
      "display:flex",
      "flex-direction:column",
    ].join(";");

    pinThemeVariables(panel);

    const header = document.createElement("div");
    header.style.cssText = [
      "background:linear-gradient(135deg,var(--brand-accent),var(--brand-accent-hover))",
      "color:var(--text-primary)",
      "padding:15px 20px",
      "font-weight:bold",
      "font-size:16px",
      "display:flex",
      "justify-content:space-between",
      "align-items:center",
      "gap:12px",
      "border-bottom:1px solid rgba(255,255,255,.2)",
    ].join(";");

    const title = document.createElement("span");
    title.textContent = titleText;
    title.style.cssText = "min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

    const controls = document.createElement("div");
    controls.style.cssText = "display:flex;align-items:center;gap:10px;flex:0 0 auto;";

    const minimize = makeHeaderButton("minimize-downloads", "Minimize", "-");
    const close = makeHeaderButton("close-downloads", "Close", "x");
    controls.appendChild(minimize);
    controls.appendChild(close);
    header.appendChild(title);
    header.appendChild(controls);

    const list = document.createElement("div");
    list.id = "downloads-container";
    list.className = "downloads-container";
    list.style.cssText = "flex:1;overflow-y:auto;max-height:400px;padding:10px;";

    const footer = document.createElement("div");
    footer.style.cssText =
      "padding:10px 20px;background:var(--bg-darker);border-top:1px solid var(--border-dark);text-align:center;font-size:12px;color:var(--text-muted);";
    footer.textContent = "Downloads will auto-close when complete";

    panel.appendChild(header);
    panel.appendChild(list);
    panel.appendChild(footer);
    document.body.appendChild(panel);

    close.addEventListener("click", hideDownloadManager);
    minimize.addEventListener("click", function () {
      const show = list.style.display === "none";
      list.style.display = show ? "block" : "none";
      footer.style.display = show ? "block" : "none";
      minimize.textContent = show ? "-" : "+";
      minimize.title = show ? "Minimize" : "Restore";
    });

    panel.addEventListener("click", function (event) {
      const target = event && event.target;
      const button = target && target.closest ? target.closest(".cancel-download-btn") : null;
      if (!button) return;
      const id = button.getAttribute("data-download-id");
      if (id) cancelDownload(id);
    });

    downloadManager = panel;
    return panel;
  }

  function showDownloadManager() {
    const dm = createDownloadManager();
    dm.style.right = "20px";
    downloadManagerVisible = true;
  }

  function hideDownloadManager() {
    if (!downloadManager) return;
    downloadManager.style.right = "-400px";
    downloadManagerVisible = false;
    setTimeout(function () {
      if (currentDownloads.size === 0 && downloadManager) {
        try {
          downloadManager.remove();
        } catch {}
        downloadManager = null;
      }
    }, 300);
  }

  function addDownload(downloadId, filename, totalSize = 0) {
    const id = normalizeDownloadId(downloadId);
    const safeFilename = cleanText(filename || `download-${id}.mp4`);
    const total = positiveNumber(totalSize);
    createDownloadManager();

    const existing = document.getElementById(`download-item-${id}`);
    if (existing) {
      const nameEl = existing.querySelector(".dm-filename");
      if (nameEl) {
        nameEl.textContent = safeFilename;
        nameEl.title = safeFilename;
      }
      const existingData = currentDownloads.get(id) || {};
      setDownloadData(downloadId, id, {
        filename: safeFilename,
        totalSize: total || existingData.totalSize || 0,
        startTime: existingData.startTime || Date.now(),
        lastUpdate: existingData.lastUpdate || Date.now(),
        lastDownloaded: existingData.lastDownloaded || 0,
        reader: existingData.reader,
        controller: existingData.controller,
      });
      showDownloadManager();
      return existing;
    }

    const container = document.getElementById("downloads-container");
    const item = document.createElement("div");
    const itemId = `download-item-${id}`;
    item.id = itemId;
    item.className = "dm-item";
    item.style.cssText =
      "background:var(--bg-dark);border:1px solid var(--border-dark);border-radius:8px;margin-bottom:10px;padding:15px;transition:all .3s ease;box-shadow:0 2px 4px rgba(0,0,0,0.1)";

    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;margin-bottom:10px;";

    const badge = document.createElement("div");
    badge.textContent = badgeText();
    badge.style.cssText =
      "background:var(--brand-accent);color:var(--text-primary);width:35px;height:35px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;margin-right:12px;flex:0 0 auto;";

    const textWrap = document.createElement("div");
    textWrap.style.cssText = "flex:1;min-width:0;";

    const name = document.createElement("div");
    name.className = "dm-filename";
    name.textContent = safeFilename;
    name.title = safeFilename;
    name.style.cssText =
      "font-weight:600;font-size:14px;color:var(--text-primary);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

    const status = document.createElement("div");
    status.id = `download-status-${id}`;
    status.className = "dm-status";
    status.textContent = "Initializing...";
    status.style.cssText = "font-size:12px;color:var(--text-muted);";

    textWrap.appendChild(name);
    textWrap.appendChild(status);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cancel-download-btn";
    cancel.setAttribute("data-download-id", id);
    cancel.title = "Cancel";
    cancel.textContent = "x";
    cancel.style.cssText =
      "background:none;border:1px solid var(--border-dark);color:var(--text-muted);cursor:pointer;padding:4px 8px;border-radius:4px;font-size:12px;transition:all .2s;";

    row.appendChild(badge);
    row.appendChild(textWrap);
    row.appendChild(cancel);

    const progressShell = document.createElement("div");
    progressShell.style.cssText =
      "background:var(--bg-darker);border-radius:6px;height:8px;overflow:hidden;margin-bottom:8px;";
    const bar = document.createElement("div");
    bar.id = `download-progress-bar-${id}`;
    bar.className = "dm-progress";
    bar.style.cssText =
      "background:linear-gradient(90deg,var(--brand-accent),var(--brand-accent-hover));height:100%;width:0%;transition:width .3s ease;border-radius:6px;";
    progressShell.appendChild(bar);

    const meta = document.createElement("div");
    meta.className = "dm-meta";
    meta.style.cssText = "display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);";
    const speed = document.createElement("span");
    speed.id = `download-speed-${id}`;
    speed.className = "dm-speed";
    speed.textContent = "0 B/s";
    const progressText = document.createElement("span");
    progressText.id = `download-progress-text-${id}`;
    progressText.className = "dm-progress-text dm-percent";
    progressText.textContent = `0% - 0 B / ${formatBytes(total)}`;
    meta.appendChild(speed);
    meta.appendChild(progressText);

    item.appendChild(row);
    item.appendChild(progressShell);
    item.appendChild(meta);
    container.appendChild(item);

    setDownloadData(downloadId, id, {
      filename: safeFilename,
      totalSize: total,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      lastDownloaded: 0,
    });
    showDownloadManager();
    return item;
  }

  function removeDownload(downloadId) {
    const id = normalizeDownloadId(downloadId);
    removeElementById(`download-item-${id}`);
    removeElementById(`yp-download-item-${id}`);
    const data = currentDownloads.get(id) || currentDownloads.get(downloadId);
    currentDownloads.delete(id);
    try {
      if (data && data.rawId !== undefined) currentDownloads.delete(data.rawId);
    } catch {}
    if (currentDownloads.size === 0) setTimeout(hideDownloadManager, 500);
  }

  function cancelDownload(downloadId) {
    const id = normalizeDownloadId(downloadId);
    const data = currentDownloads.get(id) || currentDownloads.get(downloadId);
    try {
      cancelledDownloadIds.add(id);
    } catch {}
    try {
      if (data && data.reader && typeof data.reader.cancel === "function") data.reader.cancel("user cancel");
    } catch {}
    try {
      if (data && data.controller && typeof data.controller.abort === "function") data.controller.abort();
    } catch {}
    try {
      chrome.runtime.sendMessage({
        action: "cancelDownload",
        downloadId: id,
        downloadType: inferDownloadType(id),
      });
    } catch {}
    removeDownload(id);
  }

  function updateDownloadProgress(
    downloadId,
    downloaded = 0,
    total = 0,
    progress = 0,
    status = "Downloading...",
    isHLS = false,
    segmentInfo = null,
  ) {
    const id = normalizeDownloadId(downloadId);
    if (cancelledDownloadIds.has(id)) return;

    if (!currentDownloads.has(id)) {
      addDownload(downloadId, `download-${id}.mp4`, total || downloaded || 0);
    }

    const data = currentDownloads.get(id);
    if (!data) return;

    const totalSize = positiveNumber(total || data.totalSize);
    const downloadedSize = positiveNumber(downloaded);
    const computedProgress = normalizeProgress(progress, downloadedSize, totalSize);
    const now = Date.now();
    const timeDiff = Math.max(1, now - (data.lastUpdate || now));
    const sizeDiff = Math.max(0, downloadedSize - (data.lastDownloaded || 0));
    const speed = (sizeDiff / timeDiff) * 1000;

    setText(`download-status-${id}`, cleanText(status || "Downloading..."));
    setWidth(`download-progress-bar-${id}`, `${computedProgress}%`);

    const speedText =
      isHLS && segmentInfo
        ? ""
        : speed > 0
          ? `${formatBytes(speed)}/s`
          : downloadedSize > 0
            ? "0 B/s"
            : "";
    const progressText =
      isHLS && segmentInfo
        ? `${Math.round(computedProgress)}% - ${positiveNumber(segmentInfo.current)}/${positiveNumber(segmentInfo.total)} segments`
        : `${Math.round(computedProgress)}% - ${formatBytes(downloadedSize)} / ${formatBytes(totalSize)}`;

    setText(`download-speed-${id}`, speedText);
    setText(`download-progress-text-${id}`, progressText);

    data.totalSize = totalSize || data.totalSize || 0;
    data.lastUpdate = now;
    data.lastDownloaded = downloadedSize;
    setDownloadData(downloadId, id, data);

    if (computedProgress >= 100) {
      setTimeout(function () {
        const item = document.getElementById(`download-item-${id}`);
        if (!item) return;
        item.style.transform = "translateX(100%)";
        item.style.opacity = "0";
        setTimeout(function () {
          removeDownload(id);
          if (currentDownloads.size === 0) setTimeout(hideDownloadManager, 1000);
        }, 300);
      }, 3000);
    } else if (!downloadManagerVisible) {
      showDownloadManager();
    }
  }

  function showDownloadProgress(downloadId, filename, downloaded, total, progress = 0, status = "Downloading...") {
    const id = normalizeDownloadId(downloadId);
    if (!currentDownloads.has(id)) addDownload(id, filename, total || 0);
    updateDownloadProgress(id, downloaded || 0, total || 0, progress || 0, status || "Downloading...");
  }

  function makeHeaderButton(id, title, text) {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.title = title;
    button.textContent = text;
    button.style.cssText =
      "background:none;border:none;color:white;cursor:pointer;font-size:18px;line-height:1;padding:0;width:25px;height:25px;display:flex;align-items:center;justify-content:center;border-radius:3px;";
    return button;
  }

  function pinThemeVariables(panel) {
    try {
      const colors = SiteConfig.COLORS || {};
      const setVar = function (name, value) {
        if (value) panel.style.setProperty(name, value);
      };
      setVar("--brand-accent", colors.brandAccent || "#ff9000");
      setVar("--brand-accent-hover", colors.brandAccentHover || "#ff7700");
      setVar("--bg-dark", colors.bgDark || "#1b1b1b");
      setVar("--bg-darker", colors.bgDarker || "#2a2a2a");
      setVar("--border-dark", colors.borderDark || "#333");
      setVar("--input-border", colors.inputBorder || "#555");
      setVar("--text-primary", colors.textPrimary || "#ffffff");
      setVar("--text-muted", colors.textMuted || "#999999");
      setVar("--text-subtle", colors.textSubtle || "#cccccc");
      setVar("--success", colors.success || "#4caf50");
      setVar("--error", colors.error || "#f44336");
      setVar("--info", colors.info || "#2196f3");
    } catch {}
  }

  function badgeText() {
    const words = siteName.replace(/[^a-z0-9]+/gi, " ").trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
    return siteName.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "VD";
  }

  function normalizeAppId(value) {
    return String(value || "video")
      .replace(/-downloader$/i, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "video";
  }

  function normalizeDownloadId(value) {
    return String(value === undefined || value === null ? Date.now() : value);
  }

  function normalizeProgress(progress, downloaded, total) {
    const explicit = Number(progress);
    if (Number.isFinite(explicit) && explicit >= 0) return Math.max(0, Math.min(100, explicit));
    if (total > 0) return Math.max(0, Math.min(100, (downloaded / total) * 100));
    return 0;
  }

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function formatBytes(bytes) {
    const value = positiveNumber(bytes);
    if (value === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(sizes.length - 1, Math.floor(Math.log(value) / Math.log(k)));
    return `${parseFloat((value / Math.pow(k, index)).toFixed(2))} ${sizes[index]}`;
  }

  function inferDownloadType(downloadId) {
    const id = String(downloadId || "").toLowerCase();
    if (/^mp4[-_]/.test(id) || id.endsWith(".mp4")) return "mp4";
    if (/^hls[-_]/.test(id) || id.includes("m3u8") || id.includes("segment")) return "hls";
    if (/^blob[-_]/.test(id) || id.includes("blob")) return "blob";
    if (/^\d+$/.test(id)) return "chrome";
    return "unknown";
  }

  function cleanText(value) {
    return String(value === undefined || value === null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function setDownloadData(rawId, normalizedId, data) {
    const next = Object.assign({}, data, { rawId: rawId });
    currentDownloads.set(normalizedId, next);
    if (rawId !== normalizedId) {
      try {
        currentDownloads.set(rawId, next);
      } catch {}
    }
  }

  function pickMap() {
    for (const candidate of arguments) {
      if (candidate && typeof candidate.get === "function" && typeof candidate.set === "function") return candidate;
    }
    return new Map();
  }

  function pickSet() {
    for (const candidate of arguments) {
      if (candidate && typeof candidate.add === "function" && typeof candidate.has === "function") return candidate;
    }
    return new Set();
  }

  function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function setWidth(id, value) {
    const element = document.getElementById(id);
    if (element) element.style.width = value;
  }

  function removeElementById(id) {
    try {
      const element = document.getElementById(id);
      if (element) element.remove();
    } catch {}
  }

  try {
    window.createDownloadManager = createDownloadManager;
  } catch {}
  try {
    window.showDownloadManager = showDownloadManager;
  } catch {}
  try {
    window.hideDownloadManager = hideDownloadManager;
  } catch {}
  try {
    window.addDownload = addDownload;
  } catch {}
  try {
    window.removeDownload = removeDownload;
  } catch {}
  try {
    window.cancelDownload = cancelDownload;
  } catch {}
  try {
    window.updateDownloadProgress = updateDownloadProgress;
  } catch {}
  try {
    window.showDownloadProgress = showDownloadProgress;
  } catch {}
})();
