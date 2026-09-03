// content-rule34video.js
// rule34video.com page adapter. Fires ONLY on routes the shared router
// recognises (R34Routes.match): video pages, the homepage / latest updates,
// searches, tags, categories, artists, members and playlists. On anything
// else it does nothing at all.
//
// What it does per page type:
//   video     -> a floating "Download" pill (best quality, or opens the panel)
//   listing   -> a small corner ⬇ on every card (one-click, queued through the
//                panel), plus a floating pill "N videos · Download page · Panel"
//   playlist  -> same as listing, with a "Download playlist (all pages)" button
//
// The page never talks to the download pipeline directly: every action is a
// "panel.*" message, so what you click here shows up (and can be stopped) in
// the side panel. It also answers `collectListing` so the panel can list the
// cards exactly as the user sees them (sort + filters included).
(function () {
  "use strict";
  if (globalThis.__R34_VIDEO_CONTENT__) return;
  globalThis.__R34_VIDEO_CONTENT__ = true;

  const Routes = globalThis.R34Routes;
  if (!Routes) return;
  const PREFIX = "r34v";
  const ATTACH_ATTR = "data-r34v-attached";
  const CARD_SELECTOR = 'div.item.thumb[data-video-card-id], a.th.js-open-popup[href*="/video/"], a.th[href*="/video/"]';
  const state = { route: null, pill: null, pillCount: null, observer: null, toastTimer: null, lastHref: "" };

  function currentRoute() {
    return Routes.match(location.href);
  }

  // --- messaging ------------------------------------------------------------------
  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) return resolve({ success: false, error: chrome.runtime.lastError.message });
          resolve(response || { success: false, error: "No response" });
        });
      } catch (error) {
        resolve({ success: false, error: error?.message || String(error) });
      }
    });
  }

  function openPanel() {
    return send({ action: "openSidePanel" });
  }

  // --- card collection (also served to the panel) ---------------------------------
  function absolute(href) {
    try { return new URL(href, location.href).href; } catch { return ""; }
  }

  function cardsOnPage() {
    const items = [];
    const seen = new Set();
    let nodes = [];
    try { nodes = Array.from(document.querySelectorAll(CARD_SELECTOR)); } catch {}
    for (const node of nodes) {
      const anchor = node.matches("a") ? node : node.querySelector('a[href*="/video/"]');
      if (!anchor) continue;
      const url = absolute(anchor.getAttribute("href") || "");
      const route = Routes.match(url);
      if (!route || route.kind !== "video" || seen.has(route.id)) continue;
      seen.add(route.id);
      const card = node.matches("a") ? (node.closest("[data-video-card-id]") || node) : node;
      const img = card.querySelector("img.thumb, img");
      const title = anchor.getAttribute("title") || card.querySelector(".thumb_title")?.textContent || img?.getAttribute("alt") || "";
      const duration = card.querySelector(".time")?.textContent || "";
      items.push({
        id: route.id,
        url: route.canonicalUrl,
        title: String(title || "").trim() || `Video ${route.id}`,
        thumbnail: img?.getAttribute("data-original") || img?.getAttribute("data-webp") || (img && /^https?:/i.test(img.src) ? img.src : "") || "",
        duration: String(duration || "").trim(),
        type: "video",
        anchor,
        card,
      });
    }
    return items;
  }

  function serializable(items) {
    return items.map(({ anchor, card, ...rest }) => rest);
  }

  // --- styles -------------------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById(PREFIX + "-styles")) return;
    const css = `
.${PREFIX}-corner { position:absolute; top:6px; right:6px; z-index:2147483000; display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border:1px solid rgba(255,255,255,.28); border-radius:999px; background:rgba(18,17,26,.86); color:#f4f2fb; font-size:14px; font-weight:800; line-height:1; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,.35); transition:background .12s, transform .12s; }
.${PREFIX}-corner:hover { background:#7c3aed; transform:translateY(-1px); }
.${PREFIX}-corner.${PREFIX}-done { background:#15803d; }
.${PREFIX}-corner.${PREFIX}-busy { opacity:.7; pointer-events:none; }
.${PREFIX}-pill { position:fixed; right:16px; bottom:16px; z-index:2147483001; display:flex; align-items:center; gap:6px; padding:7px 8px 7px 12px; border:1px solid rgba(255,255,255,.18); border-radius:999px; background:rgba(18,17,26,.94); color:#f4f2fb; font:13px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; box-shadow:0 8px 24px rgba(0,0,0,.45); }
.${PREFIX}-pill .${PREFIX}-count { color:#9b98b3; white-space:nowrap; margin-right:2px; }
.${PREFIX}-pill button { display:inline-flex; align-items:center; gap:5px; padding:7px 11px; border:0; border-radius:999px; background:#7c3aed; color:#fff; font:inherit; font-weight:700; cursor:pointer; white-space:nowrap; }
.${PREFIX}-pill button:hover { background:#8b5cf6; }
.${PREFIX}-pill button.${PREFIX}-ghost { background:#2b2940; }
.${PREFIX}-pill button.${PREFIX}-ghost:hover { background:#3a3852; }
.${PREFIX}-pill button:disabled { opacity:.55; cursor:progress; }
.${PREFIX}-toast { position:fixed; right:16px; bottom:66px; z-index:2147483001; max-width:340px; padding:9px 12px; border-radius:10px; background:rgba(18,17,26,.96); color:#f4f2fb; font:12.5px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; box-shadow:0 8px 24px rgba(0,0,0,.45); opacity:0; transform:translateY(6px); transition:opacity .15s, transform .15s; pointer-events:none; }
.${PREFIX}-toast.${PREFIX}-show { opacity:1; transform:none; }
.${PREFIX}-toast.${PREFIX}-error { border-left:3px solid #f43f5e; }
.${PREFIX}-toast.${PREFIX}-ok { border-left:3px solid #22c55e; }
`;
    const style = document.createElement("style");
    style.id = PREFIX + "-styles";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function toast(text, kind) {
    injectStyles();
    let node = document.getElementById(PREFIX + "-toast");
    if (!node) {
      node = document.createElement("div");
      node.id = PREFIX + "-toast";
      node.className = PREFIX + "-toast";
      document.body.appendChild(node);
    }
    node.textContent = text;
    node.classList.toggle(PREFIX + "-error", kind === "error");
    node.classList.toggle(PREFIX + "-ok", kind === "ok");
    node.classList.add(PREFIX + "-show");
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => node.classList.remove(PREFIX + "-show"), 3200);
  }

  // --- actions ------------------------------------------------------------------------
  async function queueItems(items, start, sourceTitle) {
    const response = await send({
      action: "panel.add",
      items: serializable(items),
      start: Boolean(start),
      source: { title: sourceTitle || state.route?.title || "", url: location.href, page: state.route?.page || 1, searchContext: searchContext() },
    });
    if (!response.success) {
      toast("Downloader unavailable: " + (response.error || "unknown error"), "error");
      return response;
    }
    const n = Number(response.added) || 0;
    const dup = Number(response.duplicates) || 0;
    if (start) toast(n || dup ? `Queued ${n + dup} video${n + dup === 1 ? "" : "s"} — open the panel to watch progress` : "Nothing to download", n || dup ? "ok" : "");
    else toast(n ? `Listed ${n} video${n === 1 ? "" : "s"} in the panel` : "Already listed", n ? "ok" : "");
    return response;
  }

  function searchContext() {
    const route = state.route;
    if (!route) return "";
    if (route.kind === "search") return route.query || "";
    if (route.kind === "tag" || route.kind === "category" || route.kind === "model") return String(route.id || "");
    if (route.kind === "playlist") return route.slug ? route.slug.replace(/[-_]+/g, " ") : `playlist ${route.id}`;
    return "";
  }

  async function downloadWholeListing() {
    const response = await send({
      action: "panel.crawl.start",
      url: state.route.listingUrl,
      pages: "all",
      autoDownload: true,
    });
    if (!response.success) toast(response.error || "Could not start the crawl.", "error");
    else toast("Fetching every page — downloads start as posts are found. Open the panel to follow along.", "ok");
    void openPanel();
  }

  // --- per-card corner buttons -------------------------------------------------------
  function attachCornerButtons() {
    injectStyles();
    for (const item of cardsOnPage()) {
      const host = item.card.querySelector(".img.wrap_image, .img") || item.card;
      if (!host || host.getAttribute(ATTACH_ATTR)) continue;
      host.setAttribute(ATTACH_ATTR, "1");
      try {
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
      } catch {}
      const button = document.createElement("button");
      button.type = "button";
      button.className = PREFIX + "-corner";
      button.title = "Download this video (queued in the side panel)";
      button.setAttribute("aria-label", button.title);
      button.textContent = "⬇";
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.classList.add(PREFIX + "-busy");
        const response = await queueItems([item], true);
        button.classList.remove(PREFIX + "-busy");
        if (response.success) button.classList.add(PREFIX + "-done");
      });
      host.appendChild(button);
    }
  }

  // --- floating pill ----------------------------------------------------------------------
  function ensurePill() {
    if (state.pill) return state.pill;
    injectStyles();
    const pill = document.createElement("div");
    pill.className = PREFIX + "-pill";
    state.pillCount = document.createElement("span");
    state.pillCount.className = PREFIX + "-count";
    pill.appendChild(state.pillCount);
    state.pill = pill;
    document.body.appendChild(pill);
    return pill;
  }

  function button(label, className, onClick) {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    if (className) node.className = className;
    node.addEventListener("click", async () => {
      node.disabled = true;
      try { await onClick(); } finally { node.disabled = false; }
    });
    return node;
  }

  // Re-rendering only when the page identity changes keeps the pill from
  // mutating the DOM on every observer tick (which would re-trigger the
  // observer forever); otherwise just the counter text is refreshed.
  function renderPill() {
    const route = state.route;
    if (!route) return;
    const pill = ensurePill();
    const identity = `${route.kind}:${route.id}:${route.page || 1}`;
    if (state.pillIdentity === identity && pill.children.length > 1) {
      updatePillCount();
      return;
    }
    state.pillIdentity = identity;
    while (pill.children.length > 1) pill.removeChild(pill.lastChild);
    if (route.kind === "video") {
      state.pillCount.textContent = pillCountText();
      pill.appendChild(button("⬇ Download", "", () => queueItems([{ id: route.id, url: route.canonicalUrl, title: document.title.replace(/\s*[-|–]\s*Rule ?34.*$/i, "").trim(), thumbnail: document.querySelector('meta[property="og:image"]')?.content || "", type: "video" }], true, "")));
      pill.appendChild(button("Panel", PREFIX + "-ghost", openPanel));
      return;
    }
    state.pillCount.textContent = pillCountText();
    pill.appendChild(button("⬇ Download page", "", () => queueItems(cardsOnPage(), true)));
    if (route.kind === "playlist") pill.appendChild(button("Whole playlist", "", downloadWholeListing));
    pill.appendChild(button("Panel", PREFIX + "-ghost", openPanel));
  }

  function pillCountText() {
    if (!state.route) return "";
    if (state.route.kind === "video") return "Rule 34";
    const count = cardsOnPage().length;
    return `${count} video${count === 1 ? "" : "s"}`;
  }

  function updatePillCount() {
    if (!state.pillCount || !state.route) return;
    const text = pillCountText();
    if (text !== state.pillCount.textContent) state.pillCount.textContent = text;
  }

  function removeUi() {
    try { state.pill?.remove(); } catch {}
    state.pill = null;
    state.pillCount = null;
    state.pillIdentity = "";
  }

  // Mutations caused by our own buttons/pill/toast must not re-trigger a
  // refresh, or the observer would loop on itself.
  function isOwnMutation(record) {
    const own = (node) => node && node.nodeType === 1 && typeof node.className === "string" && node.className.indexOf(PREFIX + "-") !== -1;
    if (record.target && record.target.nodeType === 1 && record.target.closest && record.target.closest(`.${PREFIX}-pill, .${PREFIX}-toast`)) return true;
    const added = Array.from(record.addedNodes || []);
    const removed = Array.from(record.removedNodes || []);
    const all = added.concat(removed);
    return all.length > 0 && all.every(own);
  }

  // --- lifecycle --------------------------------------------------------------------------
  function refresh() {
    const route = currentRoute();
    state.route = route;
    if (!route || (!Routes.isListing(route) && route.kind !== "video")) {
      removeUi();
      return;
    }
    if (Routes.isListing(route)) attachCornerButtons();
    renderPill();
  }

  function startObserver() {
    if (state.observer || !document.body) return;
    let pending = null;
    state.observer = new MutationObserver((records) => {
      if (pending) return;
      if (records.every(isOwnMutation)) return;
      pending = setTimeout(() => {
        pending = null;
        if (location.href !== state.lastHref) {
          state.lastHref = location.href;
          removeUi();
        }
        refresh();
      }, 250);
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action === "collectListing") {
      try {
        sendResponse({ success: true, items: serializable(cardsOnPage()), route: currentRoute() });
      } catch (error) {
        sendResponse({ success: false, error: error?.message || String(error) });
      }
      return false;
    }
    if (request?.action === "routeMatch") {
      sendResponse({ success: true, route: currentRoute() });
      return false;
    }
    return false;
  });

  function init() {
    state.lastHref = location.href;
    refresh();
    startObserver();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
