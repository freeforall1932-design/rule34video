// Shared player overlay download button core. Site-specific selectors and
// behavior switches live in SiteConfig.PLAYER_BUTTON.
(function () {
  const siteConfig = globalThis.SiteConfig || {};
  const config = normalizeConfig(siteConfig.PLAYER_BUTTON || {});
  const classes = buildClassNames(config.classPrefix);
  const state = {
    observer: null,
    urlPoll: null,
    historyHooked: false,
    storageListenerAdded: false,
    lastHref: getHref(),
    currentVideo: null,
    buttonContexts: new WeakMap(),
  };

  function normalizeConfig(raw) {
    const selectors = raw.selectors || {};
    const observer = raw.observer || {};
    const button = raw.button || {};
    const popover = raw.popover || {};
    const message = raw.message || {};
    const formats = raw.formats || {};
    const videoInfo = raw.videoInfo || {};
    const gallery = raw.gallery || {};
    const videoPage = raw.videoPage || {};

    return {
      mode: raw.mode || "single-video",
      classPrefix: raw.classPrefix || "ph",
      cssId: raw.cssId || `${raw.classPrefix || "ph"}-player-button-css`,
      attachAttr: raw.attachAttr || `data-${raw.classPrefix || "ph"}-dl-attached`,
      typeAttr: raw.typeAttr || "",
      applyThemeVars: Boolean(raw.applyThemeVars),
      allowedUrlIncludes: toArray(raw.allowedUrlIncludes),
      requireVideoElementForPopover: Boolean(raw.requireVideoElementForPopover),
      trackVideoIdentity: Boolean(raw.trackVideoIdentity),
      noVideoMessage: raw.noVideoMessage || "No video found on this page.",
      noFormatsMessage: raw.noFormatsMessage || "No formats available.",
      selectors: {
        container: toArray(selectors.container),
        iframeParent: toArray(selectors.iframeParent),
        iframeParentFirst: Boolean(selectors.iframeParentFirst),
        video: toArray(selectors.video, ["video"]),
        videoClosest: toArray(selectors.videoClosest),
        fallbackContainer: toArray(selectors.fallbackContainer),
        fallbackVideoParent: selectors.fallbackVideoParent !== false,
        preferVisibleVideo: Boolean(selectors.preferVisibleVideo),
        minVideoWidth: Number(selectors.minVideoWidth || 0),
        minVideoHeight: Number(selectors.minVideoHeight || 0),
        ancestorStrategy: selectors.ancestorStrategy || "",
        ancestorPlayerSelector:
          selectors.ancestorPlayerSelector || '[id*="player"], [class*="player"], [data-testid="player"]',
      },
      observer: {
        persistent: Boolean(observer.persistent),
        attributes: Boolean(observer.attributes),
        attributeFilter: toArray(observer.attributeFilter, ["class", "style", "src"]),
        urlPollingMs: Number(observer.urlPollingMs || 0),
        hookHistory: Boolean(observer.hookHistory),
        historyEventName: observer.historyEventName || "serp-player-button-locationchange",
        settleDelayMs: Number(observer.settleDelayMs || 50),
      },
      button: {
        title: button.title || "Download this video",
        text: button.text || "Download",
        imageText: button.imageText || "Download Image",
        iconHtml: button.iconHtml || "&#x2B07;",
        inlineStyle: button.inlineStyle || {},
      },
      popover: {
        appendToBody: Boolean(popover.appendToBody),
        position: popover.position || "absolute",
        zIndex: Number(popover.zIndex || 10021),
        fixedZIndex: Number(popover.fixedZIndex || 2147483647),
        fixedWidth: Number(popover.fixedWidth || 180),
      },
      videoInfo: {
        requiredAny: toArray(videoInfo.requiredAny, ["id"]),
        error: videoInfo.error || "No video info found.",
      },
      message: {
        retry: Boolean(message.retry),
        retries: Number(message.retries || 5),
        delayMs: Number(message.delayMs || 200),
      },
      formats: {
        parseQualityFromUrl: formats.parseQualityFromUrl !== false,
      },
      videoPage: {
        enabled: Boolean(videoPage.enabled),
        pathRegexes: toArray(videoPage.pathRegexes),
        hasOgVideo: Boolean(videoPage.hasOgVideo),
        hasPlayer: Boolean(videoPage.hasPlayer),
      },
      gallery: {
        formatCollectorName: gallery.formatCollectorName || "__EROME_COLLECT_VIDEO_FORMATS",
        mediaGroupSelectors: toArray(gallery.mediaGroupSelectors, [".media-group"]),
        primaryImageSelectors: toArray(gallery.primaryImageSelectors, [
          ".img[data-src]",
          ".img img[data-src]",
          ".img img[data-full]",
          ".img img[data-original]",
          ".img img",
          "img[data-download]",
          "img[data-full]",
          "img[data-original]",
          "img[data-src]",
          "img",
        ]),
        looseVideoSelectors: toArray(gallery.looseVideoSelectors, ["video"]),
        looseImageSelectors: toArray(gallery.looseImageSelectors, [
          ".album-photo img",
          ".album img",
          ".gallery img",
          ".post-content img",
          ".viewer img",
          ".media img[data-full]",
        ]),
        videoContainerClosest:
          gallery.videoContainerClosest || ".player, .video-player, .video-wrapper, .video-js, .video, figure, article",
        imageContainerClosest:
          gallery.imageContainerClosest || ".media-group, figure, .photo, .album-photo, .post-image, .image-wrapper",
        excludedContainerClosest: toArray(gallery.excludedContainerClosest, [".album-infos"]),
        thumbnailClassPattern: gallery.thumbnailClassPattern || "thumb",
        imageAction: gallery.imageAction || "downloadImageMedia",
        imageRefererFromPageInfo: gallery.imageRefererFromPageInfo !== false,
      },
    };
  }

  function toArray(value, fallback = []) {
    if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && String(item) !== "");
    if (value === undefined || value === null || value === "") return fallback;
    return [value];
  }

  function buildClassNames(prefix) {
    return {
      button: `${prefix}-download-button`,
      icon: `${prefix}-dl-icon`,
      text: `${prefix}-dl-text`,
      popover: `${prefix}-quality-popover`,
      header: `${prefix}-popover-header`,
      content: `${prefix}-popover-content`,
      loading: `${prefix}-popover-loading`,
      error: `${prefix}-popover-error`,
      list: `${prefix}-popover-list`,
      item: `${prefix}-popover-item`,
      quality: `${prefix}-popover-q`,
      type: `${prefix}-popover-type`,
    };
  }

  function getHref() {
    try {
      return location.href || "";
    } catch {
      return "";
    }
  }

  function applyThemeVarsTo(el) {
    try {
      if (!el) return;
      const c = siteConfig.COLORS || {};
      const setVar = (name, value) => {
        if (value) el.style.setProperty(name, value);
      };
      setVar("--brand-accent", c.brandAccent || "#ff9000");
      setVar("--brand-accent-hover", c.brandAccentHover || "#ff7700");
      setVar("--bg-dark", c.bgDark || "#1b1b1b");
      setVar("--bg-darker", c.bgDarker || "#2a2a2a");
      setVar("--border-dark", c.borderDark || "#333");
      setVar("--input-border", c.inputBorder || "#555");
      setVar("--text-primary", c.textPrimary || "#fff");
      setVar("--text-muted", c.textMuted || "#999");
      setVar("--text-subtle", c.textSubtle || "#ccc");
    } catch {}
  }

  function addStylesOnce() {
    try {
      if (!document.getElementById(config.cssId)) {
        const link = document.createElement("link");
        link.id = config.cssId;
        link.rel = "stylesheet";
        link.href = chrome.runtime.getURL("styles/player-button.css");
        (document.head || document.documentElement).appendChild(link);
      }
    } catch {}
  }

  function removeButtonIfPresent() {
    try {
      document.querySelectorAll(`.${classes.popover}`).forEach((node) => node.remove());
    } catch {}
    try {
      document.querySelectorAll(`.${classes.button}`).forEach((button) => button.remove());
    } catch {}
    try {
      document.querySelectorAll(`[${config.attachAttr}]`).forEach((element) => {
        element.removeAttribute(config.attachAttr);
      });
    } catch {}
    if (config.typeAttr) {
      try {
        document.querySelectorAll(`[${config.typeAttr}]`).forEach((element) => {
          element.removeAttribute(config.typeAttr);
        });
      } catch {}
    }
    state.currentVideo = null;
  }

  async function init() {
    addStylesOnce();
    runAttachFlow();
    startUrlWatchers();
  }

  function runAttachFlow() {
    addStylesOnce();
    if (config.mode === "media-gallery") {
      runGalleryAttachFlow();
      return;
    }
    runSingleVideoAttachFlow();
  }

  function runSingleVideoAttachFlow() {
    const attached = ensureButton();
    if (attached && !config.observer.persistent) return;
    startObserver(() => {
      const ok = ensureButton();
      if (ok && !config.observer.persistent) disconnectObserver();
    });
  }

  function startObserver(handler) {
    if (state.observer || !document.body) return;
    try {
      state.observer = new MutationObserver(handler);
      const options = {
        childList: true,
        subtree: true,
      };
      if (config.observer.attributes) {
        options.attributes = true;
        options.attributeFilter = config.observer.attributeFilter;
      }
      state.observer.observe(document.body, options);
    } catch {}
  }

  function disconnectObserver() {
    try {
      if (state.observer) state.observer.disconnect();
    } catch {}
    state.observer = null;
  }

  function startUrlWatchers() {
    if (config.mode !== "single-video") return;
    if (config.observer.urlPollingMs > 0 && !state.urlPoll) {
      try {
        state.urlPoll = setInterval(() => {
          const now = getHref();
          if (now === state.lastHref) return;
          state.lastHref = now;
          removeButtonIfPresent();
          runAttachFlow();
        }, config.observer.urlPollingMs);
      } catch {}
    }

    if (config.observer.hookHistory && !state.historyHooked) {
      state.historyHooked = true;
      try {
        const eventName = config.observer.historyEventName;
        const dispatchLocationChange = () => {
          try {
            window.dispatchEvent(new Event(eventName));
          } catch {}
        };
        ["pushState", "replaceState"].forEach((type) => {
          const original = history[type];
          history[type] = function () {
            const result = original.apply(this, arguments);
            dispatchLocationChange();
            return result;
          };
        });
        window.addEventListener("popstate", dispatchLocationChange);
        window.addEventListener(eventName, () => {
          state.lastHref = getHref();
          setTimeout(() => {
            removeButtonIfPresent();
            runAttachFlow();
          }, config.observer.settleDelayMs);
        });
      } catch {}
    }
  }

  function isAllowedUrl() {
    if (!config.allowedUrlIncludes.length) return true;
    const href = getHref();
    return config.allowedUrlIncludes.some((needle) => href.includes(needle));
  }

  function isVideoPage() {
    if (!config.videoPage.enabled) return true;
    try {
      const path = location.pathname || "";
      const pathMatch = config.videoPage.pathRegexes.some((pattern) => {
        try {
          return new RegExp(pattern).test(path);
        } catch {
          return false;
        }
      });
      if (pathMatch) return true;
      if (config.videoPage.hasOgVideo && document.querySelector('meta[property="og:video"], meta[property="og:video:url"]')) {
        return true;
      }
      if (config.videoPage.hasPlayer && findPlayerContainer()) return true;
    } catch {}
    return false;
  }

  function findFirstSelector(selectors) {
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element) return element;
      } catch {}
    }
    return null;
  }

  function findPlayerContainer() {
    if (config.selectors.iframeParentFirst) {
      const iframeFirst = findFirstSelector(config.selectors.iframeParent);
      if (iframeFirst && iframeFirst.parentElement) return iframeFirst.parentElement;
    }

    const direct = findFirstSelector(config.selectors.container);
    if (direct) return direct;

    const iframe = findFirstSelector(config.selectors.iframeParent);
    if (iframe && iframe.parentElement) return iframe.parentElement;

    const video = findTargetVideo();
    if (video) {
      for (const selector of config.selectors.videoClosest) {
        try {
          const closest = video.closest(selector);
          if (closest) return closest;
        } catch {}
      }
      const byStrategy = getContainerByStrategy(video);
      if (byStrategy) return byStrategy;
      if (config.selectors.fallbackVideoParent && video.parentElement) return video.parentElement;
    }

    return findFirstSelector(config.selectors.fallbackContainer);
  }

  function findTargetVideo() {
    const candidates = [];
    for (const selector of config.selectors.video) {
      try {
        candidates.push(...Array.from(document.querySelectorAll(selector)));
      } catch {}
    }
    if (!candidates.length) return null;
    if (!config.selectors.preferVisibleVideo) return candidates[0];
    const visible = candidates
      .map((element) => ({ element, rect: element.getBoundingClientRect ? element.getBoundingClientRect() : null }))
      .filter(({ element, rect }) => {
        if (!isElementVisible(element)) return false;
        if (!rect) return true;
        return rect.width >= config.selectors.minVideoWidth && rect.height >= config.selectors.minVideoHeight;
      });
    return (visible[0] && visible[0].element) || candidates[0];
  }

  function getContainerByStrategy(video) {
    const strategy = config.selectors.ancestorStrategy;
    if (!strategy) return null;
    if (strategy === "parent") return video.parentElement || null;

    let node = video.parentElement;
    while (node && node !== document.body) {
      let style = null;
      try {
        style = window.getComputedStyle(node);
      } catch {}
      const positioned = !!(style && style.position && style.position !== "static");
      const largeEnough = node.clientWidth > 300 && node.clientHeight > 200;

      if (strategy === "positioned" && positioned) return node;
      if (strategy === "largeOrPositioned" && (largeEnough || positioned)) return node;
      if (strategy === "largeOrPositionedPlayer") {
        if (largeEnough && positioned) return node;
        try {
          if (largeEnough && node.matches(config.selectors.ancestorPlayerSelector)) return node;
        } catch {}
      }
      node = node.parentElement;
    }
    return video.parentElement || null;
  }

  function isElementVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity || "1") === 0) {
        return false;
      }
      const rects = el.getClientRects ? el.getClientRects() : [];
      return rects.length > 0 || el.offsetWidth > 0 || el.offsetHeight > 0;
    } catch {
      return true;
    }
  }

  function ensureButton() {
    if (!isAllowedUrl()) {
      removeButtonIfPresent();
      return false;
    }
    if (!isVideoPage()) return false;

    const video = findTargetVideo();
    if (config.trackVideoIdentity && state.currentVideo === video && video) return true;

    const container = findPlayerContainer();
    if (!container) return false;
    if (container.getAttribute(config.attachAttr) === "1" && !config.trackVideoIdentity) return true;
    if (container.getAttribute(config.attachAttr) === "1" && config.trackVideoIdentity && state.currentVideo) return true;

    ensureContainerPosition(container);

    const button = document.createElement("button");
    button.className = classes.button;
    button.type = "button";
    button.setAttribute("title", config.button.title);
    button.innerHTML = `<span class="${classes.icon}">${config.button.iconHtml}</span><span class="${classes.text}">${config.button.text}</span>`;
    applyInlineStyle(button, config.button.inlineStyle);
    if (config.applyThemeVars) applyThemeVarsTo(button);

    container.appendChild(button);
    container.setAttribute(config.attachAttr, "1");
    state.currentVideo = video;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      showQualityPopover(button);
    });

    return true;
  }

  function ensureContainerPosition(container) {
    try {
      const style = window.getComputedStyle(container);
      if (!style || style.position === "static" || !style.position) {
        container.style.position = "relative";
      }
    } catch {}
  }

  function applyInlineStyle(element, styleMap) {
    try {
      Object.entries(styleMap || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null) element.style[key] = String(value);
      });
    } catch {}
  }

  function showQualityPopover(anchorButton) {
    document.querySelectorAll(`.${classes.popover}`).forEach((node) => node.remove());
    const video = findTargetVideo();
    const container = findPlayerContainer() || anchorButton.offsetParent || anchorButton.parentElement || document.body;
    if (!container) return;

    const popover = createPopover();
    const appendTarget = config.popover.appendToBody ? document.body || container : container;
    appendTarget.appendChild(popover);
    if (config.applyThemeVars) applyThemeVarsTo(popover);
    positionPopover(popover, anchorButton, container);

    const cleanup = (event) => {
      if (!popover.contains(event.target) && event.target !== anchorButton) {
        try {
          document.removeEventListener("click", cleanup, true);
        } catch {}
        try {
          popover.remove();
        } catch {}
      }
    };
    setTimeout(() => {
      document.addEventListener("click", cleanup, true);
    }, 0);

    if (config.requireVideoElementForPopover && !video) {
      setPopoverError(popover, config.noVideoMessage);
      return;
    }

    const videoInfo = extractVideoInfoSafe();
    if (!isVideoInfoValid(videoInfo)) {
      setPopoverError(popover, config.videoInfo.error);
      return;
    }

    sendRuntimeMessage({ action: "getVideoFormats", videoInfo }).then((response) => {
      if (!response || !response.success || !Array.isArray(response.formats) || response.formats.length === 0) {
        setPopoverError(popover, response && response.error ? response.error : config.noFormatsMessage);
        return;
      }

      const normalized = normalizeFormats(response.formats);
      if (!normalized.length) {
        setPopoverError(popover, config.noFormatsMessage);
        return;
      }

      renderFormatList(popover, normalized, (format) => {
        try {
          if (typeof showDownloadManager === "function") showDownloadManager();
        } catch {}
        const selected = { ...videoInfo, selectedFormat: format };
        sendRuntimeMessage({ action: "downloadVideo", videoInfo: selected }, { fireAndForget: true });
        try {
          document.removeEventListener("click", cleanup, true);
        } catch {}
        try {
          popover.remove();
        } catch {}
      });
    });
  }

  function createPopover() {
    const popover = document.createElement("div");
    popover.className = classes.popover;
    popover.innerHTML = `
      <div class="${classes.header}">Select quality</div>
      <div class="${classes.content}"><div class="${classes.loading}">Loading...</div></div>
    `;
    return popover;
  }

  function positionPopover(popover, anchorButton, container) {
    try {
      if (config.popover.position === "fixed") {
        const rect = anchorButton.getBoundingClientRect();
        const top = Math.max(8, Math.min(window.innerHeight - 10, rect.bottom + 8));
        const left = Math.max(8, Math.min(window.innerWidth - config.popover.fixedWidth, rect.right - config.popover.fixedWidth));
        popover.style.position = "fixed";
        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
        popover.style.zIndex = String(config.popover.fixedZIndex);
        return;
      }

      const buttonRect = anchorButton.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const top = buttonRect.top - containerRect.top + anchorButton.offsetHeight + 8;
      popover.style.position = "absolute";
      popover.style.top = `${top}px`;
      popover.style.right = "10px";
      popover.style.zIndex = String(config.popover.zIndex);
    } catch {}
  }

  function extractVideoInfoSafe() {
    try {
      return typeof extractVideoInfo === "function" ? extractVideoInfo() : null;
    } catch {
      return null;
    }
  }

  function isVideoInfoValid(videoInfo) {
    if (!videoInfo) return false;
    if (!config.videoInfo.requiredAny.length) return true;
    return config.videoInfo.requiredAny.some((path) => hasMeaningfulValue(getByPath(videoInfo, path)));
  }

  function getByPath(source, dottedPath) {
    return String(dottedPath || "")
      .split(".")
      .filter(Boolean)
      .reduce((value, key) => (value && value[key] !== undefined ? value[key] : undefined), source);
  }

  function hasMeaningfulValue(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return value !== undefined && value !== null && String(value) !== "";
  }

  function sendRuntimeMessage(message, options = {}) {
    if (options.fireAndForget) {
      try {
        chrome.runtime.sendMessage(message);
      } catch {}
      return Promise.resolve(null);
    }
    if (config.message.retry) {
      return sendMessageWithRetry(message, config.message.retries, config.message.delayMs);
    }
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
          resolve({ success: false, error: "runtime unavailable" });
          return;
        }
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response);
        });
      } catch (error) {
        resolve({ success: false, error: error && error.message ? error.message : "sendMessage failed" });
      }
    });
  }

  function sendMessageWithRetry(message, retries, delayMs) {
    return new Promise((resolve) => {
      const attempt = (remaining) => {
        try {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              if (remaining > 0) {
                setTimeout(() => attempt(remaining - 1), delayMs);
                return;
              }
              resolve({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(response);
          });
        } catch (error) {
          if (remaining > 0) {
            setTimeout(() => attempt(remaining - 1), delayMs);
            return;
          }
          resolve({ success: false, error: error && error.message ? error.message : "sendMessage failed" });
        }
      };
      attempt(retries);
    });
  }

  function normalizeFormats(formats) {
    const normalized = formats
      .filter((format) => format && format.url)
      .map((format) => {
        const q = detectQuality(format);
        const type = detectType(format);
        return { ...format, q, type };
      })
      .sort((a, b) => scoreFormat(b) - scoreFormat(a));
    return useFormatDisplayNormalization() ? normalizeDisplayFormats(normalized) : normalized;
  }

  function useFormatDisplayNormalization() {
    return siteConfig.POPUP_FORMAT_NORMALIZATION_V2 !== false;
  }

  function detectQuality(format) {
    let q = normalizeDisplayHeight(format.height, { allowExplicit: true }) || normalizeDisplayHeight(format.quality);
    if (!q && config.formats.parseQualityFromUrl) {
      try {
        const match =
          String(format.url || "").match(videoHeightPattern()) ||
          String(format.format_id || "").match(videoHeightPattern());
        if (match) q = normalizeDisplayHeight(match[1]);
      } catch {}
    }
    return q;
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

  function detectType(format) {
    const haystack = `${format.ext || ""} ${format.format_type || ""} ${format.format || ""} ${format.url || ""}`;
    if (/hls|m3u8/i.test(haystack)) return "HLS";
    if (/dash|mpd/i.test(haystack)) return "DASH";
    if (/webm/i.test(haystack)) return "WEBM";
    return "MP4";
  }

  function scoreFormat(format) {
    const height = Math.max(normalizeDisplayHeight(format.height, { allowExplicit: true }), descriptorQuality(format));
    const width = Number(format.width || 0);
    const bitrate = Number(format.tbr || format.bitrate || 0);
    const url = String(format && format.url ? format.url : "");
    const transportBonus = detectType(format) === "MP4" ? 1000000000 : 0;
    const signedKvsBonus = /\/(?:get_file|reversebuffer)(?:\/|\?)/i.test(url) && /[?&](?:rnd|v-acctoken|token|expires|cv)=/i.test(url) ? 200000000 : 0;
    const staleKvsPenalty = /\/(?:get_file|reversebuffer)(?:\/|\?)/i.test(url) && !/[?&](?:rnd|v-acctoken|token|expires|cv)=/i.test(url) ? 200000000 : 0;
    return height * 100000 + transportBonus + signedKvsBonus + trustedDirectHostBonus(format) + width + bitrate - staleKvsPenalty - riskyHostPenalty(format);
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

  function descriptorQuality(format) {
    const descriptor = String(`${format.quality || ""} ${format.format_id || ""} ${format.label || ""}`);
    const descriptorMatch = descriptor.match(videoHeightPattern());
    return descriptorMatch ? normalizeDisplayHeight(descriptorMatch[1]) : 0;
  }

  function trustedDirectHostBonus(format) {
    const host = mediaHost(format);
    const url = String(format && format.url ? format.url : "").toLowerCase();
    if (/\b(?:bkcdn|bxcdn)\.net$/i.test(host) && /\/library\/[^/?#]+\/[^/?#]+\.mp4(?:[?#]|$)/i.test(url)) return 250000000;
    if (/\b(?:bkcdn|bxcdn)\.net$/i.test(host)) return 100000000;
    return 0;
  }

  function riskyHostPenalty(format) {
    const host = mediaHost(format);
    const url = String(format && format.url ? format.url : "").toLowerCase();
    let penalty = 0;
    if (/(^|\.)streamtape\./i.test(host)) penalty += 700000000;
    if (/(^|\.)(?:dood|doodstream|filemoon|mixdrop|upstream|uqload|voe)\./i.test(host)) penalty += 700000000;
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
    return /(?:^|[/?#._-])(?:thumb|thumbnail|sprite|timeline|heat-preview|preview|teaser|trailer)(?:[/?#._-]|$)/i.test(url) ||
      /\/pv\/|\/previews?\//i.test(url) ||
      /(?:^|[/?#._-])pv_[a-f0-9]{8,}\.mp4(?:[?#]|$)/i.test(url) ||
      /\.(?:jpg|jpeg|png|webp|gif|vtt)(?:[?#]|$)/i.test(url);
  }

  function displayNoisePenalty(format) {
    const url = String(format && format.url ? format.url : "").toLowerCase();
    if (/(?:^|[/?#._-])(?:thumb|thumbnail|sprite|timeline|heat-preview)(?:[/?#._-]|$)/i.test(url)) return 400000000;
    if (/(?:^|[/?#._-])(?:preview|teaser|trailer)(?:[/?#._-]|$)|\/previews?\//i.test(url)) return 300000000;
    if (/\/pv\/|(?:^|[/?#._-])pv_[a-f0-9]{8,}\.mp4(?:[?#]|$)/i.test(url)) return 200000000;
    return riskyHostPenalty(format);
  }

  function displayBucketFor(format, index) {
    const type = format.type || detectType(format);
    const height = Number(format.q || 0);
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
      const type = format.type || detectType(format);
      const height = Number(format.q || detectQuality(format) || 0);
      return {
        ...format,
        type,
        q: height,
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
        const typeDelta = displayTypeRank(a.type) - displayTypeRank(b.type);
        if (typeDelta) return typeDelta;
        const scoreDelta = b.__displayScore - a.__displayScore;
        if (scoreDelta) return scoreDelta;
        if (a.q || b.q) return (b.q || 0) - (a.q || 0);
        return a.__displayOriginalIndex - b.__displayOriginalIndex;
      })
      .map((format) => {
        const type = format.type || detectType(format);
        if (format.q) {
          return { ...format, __displayQualityLabel: `${format.q}p`, __displayLabel: `${format.q}p ${type}` };
        }
        unknownCounts[type] = (unknownCounts[type] || 0) + 1;
        const quality = unknownCounts[type] === 1 ? "Best" : `Format ${unknownCounts[type]}`;
        return { ...format, __displayQualityLabel: quality, __displayLabel: `${quality} ${type}` };
      });
  }

  function labelForFormat(format) {
    if (format.__displayQualityLabel) return format.__displayQualityLabel;
    if (format.q) return `${format.q}p`;
    const raw = String(format.quality || format.format_id || format.label || "").trim();
    if (/^(html|video|source|performance|webrequest|direct|hls|mp4|auto)$/i.test(raw)) return "Best";
    return raw || "Best";
  }

  function renderFormatList(popover, formats, onSelect) {
    const list = document.createElement("div");
    list.className = classes.list;
    formats.forEach((format) => {
      const item = document.createElement("button");
      item.className = classes.item;
      item.type = "button";
      item.innerHTML = `<span class="${classes.quality}">${escapeHtml(labelForFormat(format))}</span><span class="${classes.type}">${escapeHtml(format.type || "")}</span>`;
      item.addEventListener("click", () => onSelect(format));
      list.appendChild(item);
    });
    const content = popover.querySelector(`.${classes.content}`);
    if (!content) return;
    content.innerHTML = "";
    content.appendChild(list);
  }

  function setPopoverError(popover, message) {
    const content = popover.querySelector(`.${classes.content}`);
    if (content) content.innerHTML = `<div class="${classes.error}">${escapeHtml(message)}</div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function runGalleryAttachFlow() {
    attachGalleryButtons();
    startObserver(() => attachGalleryButtons());
  }

  function attachGalleryButtons() {
    const targets = collectGalleryTargets();
    targets.forEach((context) => {
      if (!context.container || context.container.getAttribute(config.attachAttr) === "1") return;
      ensureContainerPosition(context.container);
      const button = document.createElement("button");
      button.className = classes.button;
      button.type = "button";
      button.dataset[`${config.classPrefix}DlType`] = context.type;
      button.setAttribute("title", context.type === "video" ? "Download this video" : "Download this image");
      const text = context.type === "video" ? config.button.text : config.button.imageText;
      button.innerHTML = `<span class="${classes.icon}">${config.button.iconHtml}</span><span class="${classes.text}">${text}</span>`;
      if (config.applyThemeVars) applyThemeVarsTo(button);
      state.buttonContexts.set(button, context);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = state.buttonContexts.get(button);
        if (!current) return;
        if (current.type === "video") handleGalleryVideoButton(button, current);
        else handleGalleryImageButton(current);
      });
      context.container.appendChild(button);
      context.container.setAttribute(config.attachAttr, "1");
      if (config.typeAttr) context.container.setAttribute(config.typeAttr, context.type);
    });
  }

  function collectGalleryTargets() {
    const contexts = [];
    const processed = new Set();
    const counters = { video: 0, image: 0 };
    const pageInfo = extractVideoInfoSafe() || {};
    const pageTitle = pageInfo.title || document.title.replace(/\s*-\s*Erome.*/i, "").trim();

    const register = (type, originalContainer, mediaEl) => {
      if (!originalContainer || !mediaEl) return;
      const container = normalizeGalleryContainer(originalContainer);
      if (!container) return;
      if (isGalleryThumbnailTarget(container, mediaEl)) return;
      if (config.gallery.excludedContainerClosest.some((selector) => safeClosest(container, selector))) return;
      if (processed.has(container)) return;
      counters[type] += 1;
      contexts.push({
        type,
        container,
        mediaEl,
        index: counters[type],
        pageInfo,
        pageTitle,
      });
      processed.add(container);
    };

    config.gallery.mediaGroupSelectors.forEach((selector) => {
      queryAll(selector).forEach((group) => {
        const video = findVisibleVideo(group);
        if (video) {
          register("video", group, video);
          return;
        }
        const image = findPrimaryImage(group);
        if (image) register("image", group, image);
      });
    });

    config.gallery.looseVideoSelectors.forEach((selector) => {
      queryAll(selector).forEach((video) => {
        if (!isElementVisible(video)) return;
        if (config.gallery.mediaGroupSelectors.some((groupSelector) => safeClosest(video, groupSelector))) return;
        const container = safeClosest(video, config.gallery.videoContainerClosest) || video.parentElement;
        register("video", container, video);
      });
    });

    config.gallery.looseImageSelectors.forEach((selector) => {
      queryAll(selector).forEach((image) => {
        if (!isElementVisible(image)) return;
        if (config.gallery.mediaGroupSelectors.some((groupSelector) => safeClosest(image, groupSelector))) return;
        const container = safeClosest(image, config.gallery.imageContainerClosest) || image.parentElement;
        register("image", container, image);
      });
    });

    return contexts;
  }

  function queryAll(selector) {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function safeClosest(node, selector) {
    try {
      return node && node.closest ? node.closest(selector) : null;
    } catch {
      return null;
    }
  }

  function findVisibleVideo(root) {
    for (const video of queryAllWithin(root, "video")) {
      if (isElementVisible(video)) return video;
    }
    return null;
  }

  function queryAllWithin(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function findPrimaryImage(root) {
    for (const selector of config.gallery.primaryImageSelectors) {
      const candidate = findWithin(root, selector);
      if (!candidate) continue;
      const image = candidate.tagName && candidate.tagName.toLowerCase() === "img" ? candidate : findWithin(candidate, "img");
      if (image && isElementVisible(image)) return image;
    }
    return null;
  }

  function findWithin(root, selector) {
    try {
      return root.querySelector(selector);
    } catch {
      return null;
    }
  }

  function normalizeGalleryContainer(node) {
    let current = node;
    while (current && current.tagName === "A") {
      current = current.parentElement;
    }
    return current || node;
  }

  function isGalleryThumbnailTarget(container, mediaEl) {
    let pattern = null;
    try {
      pattern = new RegExp(config.gallery.thumbnailClassPattern, "i");
    } catch {
      pattern = /thumb/i;
    }
    return [container, mediaEl].some((node) => {
      if (!node || !node.classList) return false;
      return Array.from(node.classList).some((className) => pattern.test(className));
    });
  }

  function gatherGalleryVideoFormats(context) {
    let formats = [];
    try {
      const collector = globalThis[config.gallery.formatCollectorName];
      if (typeof collector === "function") {
        formats = collector(context.mediaEl, { baseId: context.pageInfo && context.pageInfo.id });
      }
    } catch (error) {
      console.warn("[PlayerButton] Failed to collect formats from gallery video:", error);
    }
    return normalizeFormats(Array.isArray(formats) ? formats : []);
  }

  function buildGalleryVideoInfo(context) {
    const base = { ...(context.pageInfo || {}) };
    const video = context.mediaEl;
    const candidates = [
      video && video.dataset ? video.dataset.videoId : null,
      video && video.dataset ? video.dataset.id : null,
      video && video.getAttribute ? video.getAttribute("data-video-id") : null,
      video && video.getAttribute ? video.getAttribute("data-id") : null,
      video && video.id ? video.id.replace(/^player-/, "") : null,
    ].filter(Boolean);
    const parentWithId = video && video.closest ? video.closest("[id]") : null;
    if (!base.id) {
      const derived = candidates[0] || (parentWithId ? parentWithId.id.replace(/^player-/, "") : null);
      if (derived) base.id = derived;
    }
    base.url = base.url || getHref();
    if (!base.title) base.title = context.pageTitle || document.title;
    base.contextIndex = context.index;
    base.contextType = "video";
    base.contextSource = (video && video.id) || (parentWithId && parentWithId.id) || null;
    return base;
  }

  function handleGalleryVideoButton(button, context) {
    const formats = gatherGalleryVideoFormats(context);
    const videoInfo = buildGalleryVideoInfo(context);
    if (formats.length === 1) {
      startGalleryVideoDownload(context, formats[0], videoInfo);
      return;
    }
    showGalleryVideoPopover(button, context, formats, videoInfo);
  }

  function showGalleryVideoPopover(anchorButton, context, initialFormats, initialVideoInfo) {
    document.querySelectorAll(`.${classes.popover}`).forEach((node) => node.remove());
    const container = context.container;
    if (!container) return;
    const popover = createPopover();
    container.appendChild(popover);
    positionPopover(popover, anchorButton, container);

    const cleanup = (event) => {
      if (!popover.contains(event.target) && event.target !== anchorButton) {
        try {
          document.removeEventListener("click", cleanup, true);
        } catch {}
        try {
          popover.remove();
        } catch {}
      }
    };
    setTimeout(() => document.addEventListener("click", cleanup, true), 0);

    const render = (formats) => {
      if (!formats || !formats.length) {
        setPopoverError(popover, config.noFormatsMessage);
        return;
      }
      renderFormatList(popover, formats, (format) => {
        try {
          document.removeEventListener("click", cleanup, true);
        } catch {}
        try {
          popover.remove();
        } catch {}
        startGalleryVideoDownload(context, format, initialVideoInfo);
      });
    };

    if (initialFormats && initialFormats.length) {
      render(initialFormats);
      return;
    }

    sendRuntimeMessage({ action: "getVideoFormats", videoInfo: initialVideoInfo }).then((response) => {
      if (!response || !response.success || !Array.isArray(response.formats) || !response.formats.length) {
        setPopoverError(popover, config.noFormatsMessage);
        return;
      }
      render(normalizeFormats(response.formats));
    });
  }

  function startGalleryVideoDownload(context, format, videoInfoOverride) {
    const videoInfo = videoInfoOverride ? { ...videoInfoOverride } : buildGalleryVideoInfo(context);
    videoInfo.selectedFormat = { ...format, source: format.source || "video-element" };
    videoInfo.originContext = {
      type: "video",
      index: context.index,
      elementId: context.mediaEl && context.mediaEl.id ? context.mediaEl.id : null,
    };
    try {
      if (typeof showDownloadManager === "function") showDownloadManager();
    } catch {}
    sendRuntimeMessage({ action: "downloadVideo", videoInfo }, { fireAndForget: true });
  }

  function handleGalleryImageButton(context) {
    const imageUrl = getImageDownloadUrl(context);
    if (!imageUrl) {
      console.warn("[PlayerButton] No image URL found for gallery download target");
      return;
    }
    const filename = buildImageFilename(context, imageUrl);
    try {
      if (typeof showDownloadManager === "function") showDownloadManager();
    } catch {}
    sendRuntimeMessage(
      {
        action: config.gallery.imageAction,
        imageUrl,
        filename,
        referer: config.gallery.imageRefererFromPageInfo ? (context.pageInfo && context.pageInfo.url) || getHref() : getHref(),
      },
      { fireAndForget: true },
    );
  }

  function getImageDownloadUrl(context) {
    const container = context.container;
    const image = context.mediaEl;
    const candidates = [
      container && container.getAttribute ? container.getAttribute("data-src") : null,
      container && container.dataset ? container.dataset.src : null,
      image && image.getAttribute ? image.getAttribute("data-download") : null,
      image && image.getAttribute ? image.getAttribute("data-full") : null,
      image && image.getAttribute ? image.getAttribute("data-original") : null,
      image && image.dataset ? image.dataset.download : null,
      image && image.dataset ? image.dataset.full : null,
      image && image.dataset ? image.dataset.src : null,
      image && image.src ? image.src : null,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeUrl(candidate);
      if (normalized) return normalized;
    }
    return "";
  }

  function buildImageFilename(context, imageUrl) {
    const baseTitle = (context.pageTitle || (context.pageInfo && context.pageInfo.title) || document.title || "Image").trim();
    const alt = context.mediaEl && context.mediaEl.getAttribute ? context.mediaEl.getAttribute("alt") : "";
    let suffix = alt ? alt.trim() : "";
    if (!suffix && context.index) suffix = `image-${context.index}`;
    if (!suffix) {
      try {
        const parsed = new URL(imageUrl);
        suffix = (parsed.pathname.split("/").pop() || "").replace(/\.[a-z0-9]{2,5}$/i, "");
      } catch {}
    }
    let base = baseTitle.replace(/\.[a-z0-9]{2,5}$/i, "");
    if (suffix) base = `${base} - ${suffix}`;
    return base.trim() || `image-${context.index || Date.now()}`;
  }

  function normalizeUrl(url) {
    if (!url || typeof url !== "string") return "";
    let clean = url.trim().replace(/&amp;/g, "&");
    if (!clean) return "";
    if (/^\/\//.test(clean)) {
      clean = `${location.protocol}${clean}`;
    } else if (!/^https?:/i.test(clean)) {
      try {
        clean = new URL(clean, getHref()).toString();
      } catch {
        return "";
      }
    }
    return clean;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
