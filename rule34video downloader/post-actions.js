// post-actions.js
// Per-post corner download buttons + a "Download visible" batch toolbar for
// rule34video.com and rule34.world.
//
// Every supported post card gets a small (corner) download button. Clicking it
// sends a single-post batch request to the background, so each download flows
// through the user-configurable concurrency queue. The floating toolbar
// collects every supported post URL currently visible on the page and enqueues
// them all at once.
//
// Progress/errors are surfaced as a small toast. This is deliberately kept as a
// separate content script so the generated generic adapter (content.js) and the
// single-video player button (player-button.js) remain untouched.
(function () {
  "use strict";
  if (globalThis.__RULE34_POST_ACTIONS__) return;
  globalThis.__RULE34_POST_ACTIONS__ = true;

  const HOST = String(location.hostname || "").toLowerCase();
  const IS_WORLD = /(^|\.)rule34\.world$/.test(HOST);
  const IS_VIDEO = /(^|\.)rule34video\.com$/.test(HOST);
  if (!IS_WORLD && !IS_VIDEO) return;

  const PREFIX = "r34pa";
  const ATTACH_ATTR = "data-" + PREFIX + "-attached";
  const MAX_VISIBLE = 300; // matches background BATCH_MAX_URLS

  function postIdFromUrl(url) {
    const u = String(url || "");
    if (!u) return "";
    if (IS_VIDEO) {
      const m = u.match(/(?:^|\/)(?:video|popup-video)\/(\d+)/i);
      return m ? m[1] : "";
    }
    const m = u.match(/\/post\/(\d+)/i);
    return m ? m[1] : "";
  }

  function isSupportedPostUrl(url) {
    return Boolean(postIdFromUrl(url));
  }

  function absoluteUrl(href) {
    try {
      if (!href) return "";
      if (/^https?:\/\//i.test(href)) return href;
      return new URL(href, location.href).href;
    } catch {
      return "";
    }
  }

  function injectStyles() {
    if (document.getElementById(PREFIX + "-styles")) return;
    const css = `
.${PREFIX}-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2147483000;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 26px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 999px;
  background: rgba(15,23,42,0.82);
  color: #f8fafc;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  box-shadow: 0 2px 6px rgba(0,0,0,0.35);
  transition: background .12s ease, transform .12s ease, border-color .12s ease;
}
.${PREFIX}-btn:hover {
  background: #2563eb;
  border-color: rgba(255,255,255,0.55);
  transform: translateY(-1px);
}
.${PREFIX}-btn:active {
  transform: translateY(0);
}
.${PREFIX}-btn .${PREFIX}-ico {
  font-size: 14px;
  line-height: 1;
}
.${PREFIX}-btn.${PREFIX}-busy {
  opacity: .75;
  pointer-events: none;
}
.${PREFIX}-toolbar {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483001;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 999px;
  background: rgba(15,23,42,0.92);
  color: #f8fafc;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  font-size: 13px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.4);
}
.${PREFIX}-toolbar .${PREFIX}-count {
  color: #94a3b8;
  white-space: nowrap;
}
.${PREFIX}-toolbar button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.${PREFIX}-toolbar button:hover { background: #1d4ed8; }
.${PREFIX}-toolbar button:disabled { opacity: .55; cursor: not-allowed; }
.${PREFIX}-toast {
  position: fixed;
  left: 50%;
  bottom: 64px;
  transform: translateX(-50%) translateY(8px);
  z-index: 2147483002;
  max-width: min(560px, calc(100vw - 32px));
  padding: 9px 14px;
  border-radius: 10px;
  background: rgba(15,23,42,0.95);
  color: #f8fafc;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45);
  opacity: 0;
  transition: opacity .18s ease, transform .18s ease;
  pointer-events: none;
}
.${PREFIX}-toast.${PREFIX}-show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.${PREFIX}-toast.${PREFIX}-error {
  border: 1px solid rgba(239,68,68,0.6);
}
.${PREFIX}-toast.${PREFIX}-ok {
  border: 1px solid rgba(34,197,94,0.6);
}
`;
    const style = document.createElement("style");
    style.id = PREFIX + "-styles";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  let toastTimer = null;
  function toast(message, kind) {
    injectStyles();
    let node = document.getElementById(PREFIX + "-toast");
    if (!node) {
      node = document.createElement("div");
      node.id = PREFIX + "-toast";
      node.className = PREFIX + "-toast";
      (document.body || document.documentElement).appendChild(node);
    }
    node.textContent = message;
    node.classList.toggle(PREFIX + "-error", kind === "error");
    node.classList.toggle(PREFIX + "-ok", kind === "ok");
    node.classList.add(PREFIX + "-show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.classList.remove(PREFIX + "-show");
    }, 3200);
  }

  function sendBatch(urls, done) {
    const list = Array.from(new Set((urls || []).filter(isSupportedPostUrl))).slice(0, MAX_VISIBLE);
    if (!list.length) {
      if (done) done(0);
      return;
    }
    try {
      chrome.runtime.sendMessage({ action: "batchDownloadPosts", urls: list }, (resp) => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) {
          toast("Downloader background unavailable: " + (err.message || "unknown error"), "error");
          if (done) done(0);
          return;
        }
        const n = resp && typeof resp.accepted === "number" ? resp.accepted : 0;
        const s = resp && typeof resp.skipped === "number" ? resp.skipped : 0;
        if (done) done(n);
        if (n) {
          toast("Queued " + n + " post" + (n === 1 ? "" : "s") + " for download" + (s ? " (" + s + " already in queue)" : ""), "ok");
        } else if (s) {
          toast("Those " + s + " post" + (s === 1 ? " is" : "s are") + " already in the download queue");
        } else {
          toast("No new posts to download");
        }
      });
    } catch (error) {
      toast("Failed to start download: " + (error && error.message ? error.message : error), "error");
      if (done) done(0);
    }
  }

  // Pick the element we pin the corner button to.
  function pinContainerFor(anchor) {
    if (IS_VIDEO) {
      return (
        anchor.querySelector(".img.wrap_image, .img, img.thumb") ||
        anchor.closest(".item.thumb[data-video-card-id]") ||
        anchor
      );
    }
    return (
      anchor.closest("app-post-card, mat-card, [class*='post-card'], [class*='postCard'], [class*='post']") ||
      anchor.parentElement ||
      anchor
    );
  }

  function attachButtonToAnchor(anchor, url) {
    const container = pinContainerFor(anchor);
    if (!container) return;
    if (container.getAttribute(ATTACH_ATTR)) return;
    container.setAttribute(ATTACH_ATTR, "1");
    ensurePositioned(container);

    const button = document.createElement("button");
    button.type = "button";
    button.className = PREFIX + "-btn";
    button.setAttribute("title", "Download this post");
    button.setAttribute("aria-label", "Download this post");
    button.innerHTML = '<span class="' + PREFIX + '-ico">&#x2B07;</span>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.classList.add(PREFIX + "-busy");
      sendBatch([url], () => setTimeout(() => button.classList.remove(PREFIX + "-busy"), 800));
    });
    container.appendChild(button);
  }

  function ensurePositioned(element) {
    if (!element) return;
    try {
      const pos = getComputedStyle(element).position;
      if (!pos || pos === "static") element.style.position = "relative";
    } catch {}
  }

  function processCards(root) {
    const scope = root || document;
    let anchors;
    try {
      anchors = IS_VIDEO
        ? scope.querySelectorAll('a.th.js-open-popup[href], a[href*="/video/"], a[href*="/popup-video/"]')
        : scope.querySelectorAll('a[href*="/post/"]');
    } catch {
      return;
    }
    anchors.forEach((anchor) => {
      const href = anchor.getAttribute("href") || "";
      const url = absoluteUrl(href);
      if (!isSupportedPostUrl(url)) return;
      attachButtonToAnchor(anchor, url);
    });
  }

  // --- Floating batch toolbar ----------------------------------------------
  function collectVisiblePostUrls() {
    const urls = [];
    let anchors = [];
    try {
      anchors = Array.from(
        IS_VIDEO
          ? document.querySelectorAll('a.th.js-open-popup[href], a[href*="/video/"], a[href*="/popup-video/"]')
          : document.querySelectorAll('a[href*="/post/"]'),
      );
    } catch {}
    for (const anchor of anchors) {
      if (urls.length >= MAX_VISIBLE) break;
      if (!isElementInViewport(anchor)) continue;
      const url = absoluteUrl(anchor.getAttribute("href") || "");
      if (isSupportedPostUrl(url) && !urls.includes(url)) urls.push(url);
    }
    // A single post page has no card list; treat the page itself as one post.
    if (!urls.length && isSupportedPostUrl(location.href)) urls.push(location.href);
    return urls;
  }

  function isElementInViewport(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) return true; // e.g. hidden anchor on a card
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    return rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
  }

  let toolbar = null;
  let toolbarCount = null;
  let toolbarButton = null;

  function ensureToolbar() {
    if (toolbar) return;
    injectStyles();
    toolbar = document.createElement("div");
    toolbar.className = PREFIX + "-toolbar";
    toolbarCount = document.createElement("span");
    toolbarCount.className = PREFIX + "-count";
    toolbarButton = document.createElement("button");
    toolbarButton.type = "button";
    toolbarButton.innerHTML = '<span>&#x2B07;</span> Download visible';
    toolbarButton.addEventListener("click", () => {
      const urls = collectVisiblePostUrls();
      if (!urls.length) {
        toast("No supported posts found on this page.");
        return;
      }
      toolbarButton.disabled = true;
      sendBatch(urls, () => setTimeout(() => { toolbarButton.disabled = false; }, 1000));
    });
    toolbar.appendChild(toolbarCount);
    toolbar.appendChild(toolbarButton);
    (document.body || document.documentElement).appendChild(toolbar);
  }

  function refreshToolbarCount() {
    const count = collectVisiblePostUrls().length;
    if (!count) {
      if (toolbar) toolbar.style.display = "none";
      return;
    }
    ensureToolbar();
    toolbar.style.display = "";
    if (toolbarCount) toolbarCount.textContent = count + " post" + (count === 1 ? "" : "s");
  }

  // --- Background -> content status streaming ------------------------------
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.action !== "batchPostStatus") return;
      if (msg.ok) {
        const label = msg.queued
          ? "Queued #" + (msg.queuePosition || "?") + ": " + (msg.title || "post")
          : "Downloading: " + (msg.title || "post");
        toast(label, "ok");
      } else {
        toast("Download failed: " + (msg.error || "unknown error"), "error");
      }
    });
  } catch {}

  // --- Bootstrap -----------------------------------------------------------
  function boot() {
    injectStyles();
    processCards(document);
    refreshToolbarCount();

    if (typeof MutationObserver !== "undefined" && document.body) {
      const observer = new MutationObserver((mutations) => {
        let addedCards = false;
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes || []) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            processCards(node);
            addedCards = true;
          }
        }
        if (addedCards) refreshToolbarCount();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    // Re-count as the user scrolls (debounced).
    let scrollTimer = null;
    window.addEventListener("scroll", () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        refreshToolbarCount();
      }, 200);
    }, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
  // Angular SPA route changes can re-render cards without a full navigation.
  window.addEventListener("load", () => {
    setTimeout(() => {
      processCards(document);
      refreshToolbarCount();
    }, 500);
  });
})();
