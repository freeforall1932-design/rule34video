// panel-queue.js
// The side-panel queue engine (service-worker side).
//
// Modelled on the sister project twitter-batch-download: every post the user
// lists lands in ONE persistent list with a checkbox and a status
// (listed -> queued -> resolving -> downloading -> completed | failed), the
// panel renders that list, and "Download N selected" drains the selected rows
// through a small worker pool. On top of that sits the nh-dw style page
// crawler: "fetch pages 2,4,6-10 / 1-99 / all" of the listing the user is
// looking at (or of any pasted listing/playlist URL), listing every post it
// finds. Crawling never starts downloads: the user reviews the list, then
// explicitly presses "Download N selected".
//
// Site specifics are isolated in two tiny adapters at the bottom:
//   rule34video.com  — scrape canonical listing HTML pages (cards + pagination),
//                      playlists included
//   rule34.world     — POST /api/v2/post/search/root (30 posts/page, the
//                      SPA's page size) so page N here == page N on the site;
//                      images AND videos, filterable
//
// This file is a dependency-injected factory (no chrome.* at module scope,
// no DOM) so it loads in the service worker AND in the offline test suites:
//
//   const engine = R34PanelQueue.create({ chrome, routes, resolvePost,
//     startDownload, cancelDownload, fetchImpl, collectPageItems, broadcast });
//   engine.handleMessage({ action: "panel.get" }) -> Promise<response>
//   engine.notifyOutcome(downloadId, { ok, error })   // from the download pipeline
//
// All panel actions are namespaced "panel.*" so they never collide with the
// legacy message names in background-enhanced.js.

(function (root) {
  "use strict";

  const STORAGE_KEY = "r34.panelQueue.v1";
  const HISTORY_KEY = "r34.panelHistory.v1";
  const SETTINGS_KEY = "r34.panelSettings.v1";
  const MAX_ITEMS = 6000;
  const MAX_HISTORY = 20000;
  const MAX_ATTEMPTS = 2;
  const BROADCAST_THROTTLE_MS = 250;
  const PERSIST_DEBOUNCE_MS = 300;
  const STALE_ACTIVE_MS = 3 * 60 * 60 * 1000;
  const VIDEO_PAGE_DELAY_MS = 450;
  const WORLD_PAGE_DELAY_MS = 250;
  const OPEN_ENDED_CRAWL_MAX_PAGES = 150; // fallback when the router is unavailable

  const ACTIVE_STATUSES = new Set(["resolving", "downloading"]);
  // "completed" is startable too: a row the user re-ticks downloads again
  // (finishItem clears the tick, and Select all leaves completed rows alone).
  const STARTABLE_STATUSES = new Set(["listed", "failed", "skipped", "stopped", "completed"]);
  const FINISHED_STATUSES = new Set(["completed", "failed", "skipped"]);
  const QUALITY_OPTIONS = ["best", "1080", "720", "480", "360"];
  const CONCURRENCY_OPTIONS = [1, 2, 3, 5];

  const DEFAULT_SETTINGS = {
    // A conservative default that still gives batch downloads useful
    // throughput. Users can lower it to 1/2 or deliberately choose 5.
    concurrency: 3,
    quality: "best",
    skipDownloaded: true,
    autoList: true,
    mediaType: "all", // all | video | image  (rule34.world listings)
  };

  function now() {
    return Date.now();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function itemKey(site, id) {
    return `${site}:${id}`;
  }

  function compactItem(item) {
    return {
      key: item.key,
      site: item.site,
      id: item.id,
      url: item.url,
      title: item.title,
      thumbnail: item.thumbnail || "",
      duration: item.duration || "",
      type: item.type || "video",
      page: item.page || 0,
      sourceTitle: item.sourceTitle || "",
      status: item.status,
      selected: Boolean(item.selected),
      error: item.error || "",
      progress: Number(item.progress) || 0,
      quality: item.quality || "",
      downloadId: item.downloadId === undefined ? null : item.downloadId,
      addedAt: item.addedAt || 0,
      updatedAt: item.updatedAt || 0,
    };
  }

  // Pick the download format for a resolved post from the quality preference.
  // Formats arrive best-first from the resolvers. Image posts have exactly one
  // "image" format and ignore the preference.
  function pickFormat(formats, quality) {
    let list = Array.isArray(formats) ? formats.filter(Boolean) : [];
    if (!list.length) return null;
    const image = list.find((format) => format.format_type === "image");
    if (image) return image;
    // Preview/thumbnail renditions only count when a post has nothing else.
    const real = list.filter((format) => !format.preview);
    if (real.length) list = real;
    const wanted = Number(quality);
    if (!Number.isFinite(wanted) || wanted <= 0) return list[0];
    const withHeight = list.filter((format) => Number(format.height) > 0);
    const exact = withHeight.find((format) => Number(format.height) === wanted);
    if (exact) return exact;
    const below = withHeight.filter((format) => Number(format.height) < wanted).sort((a, b) => b.height - a.height);
    if (below.length) return below[0];
    return withHeight.length ? withHeight[withHeight.length - 1] : list[0];
  }

  function create(deps) {
    const chromeRef = deps.chrome || root.chrome;
    const routes = deps.routes || root.R34Routes;
    const logger = deps.logger || { log() {}, warn() {}, error() {} };
    const fetchImpl = deps.fetchImpl || ((...args) => root.fetch(...args));
    const resolvePost = deps.resolvePost;
    const startDownload = deps.startDownload;
    const cancelDownload = deps.cancelDownload || (() => {});
    const collectPageItems = deps.collectPageItems || (async () => null);
    const broadcast = deps.broadcast || (() => {});
    const setCurrentTab = deps.setCurrentTab || (() => {});
    if (!routes) throw new Error("R34PanelQueue needs the R34Routes router");
    if (typeof resolvePost !== "function" || typeof startDownload !== "function") {
      throw new Error("R34PanelQueue needs resolvePost() and startDownload()");
    }

    const items = new Map(); // key -> item (insertion order = list order)
    const byDownloadId = new Map(); // downloadId -> key
    // Outcomes that arrived before the item was bound to its download id (a
    // tiny file can finish before startDownload() even returns).
    const earlyOutcomes = new Map(); // downloadId -> { outcome, at }
    let history = new Set();
    let settings = { ...DEFAULT_SETTINGS };
    let running = false;
    let pumping = false;
    let restored = false;
    let restorePromise = null;
    let persistTimer = null;
    let broadcastTimer = null;
    let broadcastDirty = false;
    let crawlToken = 0;
    // Cancels the currently in-flight page request as well as preventing the
    // next page from starting. A token alone cannot interrupt fetch(), which
    // made Stop look ineffective on a slow listing response.
    let crawlController = null;
    const crawl = emptyCrawlState();

    function emptyCrawlState() {
      return {
        running: false,
        site: "",
        kind: "",
        title: "",
        sourceUrl: "",
        pages: [],
        pageIndex: 0,
        currentPage: 0,
        totalPages: 0,
        totalItems: 0,
        found: 0,
        added: 0,
        duplicates: 0,
        alreadyDownloaded: 0,
        filtered: 0,
        // Kept in snapshots for forward-compatible clients. It is always
        // false: range fetches only list selected pages, never start a stream.
        autoDownload: false,
        openEnded: false,
        stopped: false,
        error: "",
        startedAt: 0,
        finishedAt: 0,
      };
    }

    // --- storage ------------------------------------------------------------
    function storageGet(keys) {
      return new Promise((resolve) => {
        try {
          const area = chromeRef?.storage?.local;
          if (!area) return resolve({});
          const maybe = area.get(keys, (data) => resolve(data || {}));
          if (maybe && typeof maybe.then === "function") maybe.then((data) => resolve(data || {}), () => resolve({}));
        } catch {
          resolve({});
        }
      });
    }

    function storageSet(patch) {
      try {
        const maybe = chromeRef?.storage?.local?.set(patch, () => void chromeRef?.runtime?.lastError);
        if (maybe && typeof maybe.catch === "function") maybe.catch(() => {});
      } catch {}
    }

    function storageRemove(keys) {
      try {
        const maybe = chromeRef?.storage?.local?.remove(keys, () => void chromeRef?.runtime?.lastError);
        if (maybe && typeof maybe.catch === "function") maybe.catch(() => {});
      } catch {}
    }

    function persistSoon() {
      if (persistTimer) return;
      persistTimer = setTimeout(() => {
        persistTimer = null;
        persistNow();
      }, PERSIST_DEBOUNCE_MS);
    }

    function persistNow() {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      const list = Array.from(items.values()).map((item) => ({
        ...item,
        // never persist transient bookkeeping
        progress: ACTIVE_STATUSES.has(item.status) ? item.progress : 0,
      }));
      if (!list.length && !running) storageRemove(STORAGE_KEY);
      else storageSet({ [STORAGE_KEY]: { items: list, running, savedAt: now() } });
    }

    function persistHistory() {
      storageSet({ [HISTORY_KEY]: Array.from(history) });
    }

    function persistSettings() {
      storageSet({ [SETTINGS_KEY]: settings });
    }

    async function restore() {
      if (restorePromise) return restorePromise;
      restorePromise = (async () => {
        const data = await storageGet([STORAGE_KEY, HISTORY_KEY, SETTINGS_KEY]);
        const storedSettings = data[SETTINGS_KEY];
        if (storedSettings && typeof storedSettings === "object") settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...storedSettings });
        const storedHistory = data[HISTORY_KEY];
        if (Array.isArray(storedHistory)) history = new Set(storedHistory.slice(-MAX_HISTORY).map(String));
        const stored = data[STORAGE_KEY];
        const list = Array.isArray(stored?.items) ? stored.items : [];
        const stamp = now();
        for (const raw of list) {
          if (!raw || !raw.key || !raw.url) continue;
          const item = { ...raw };
          if (ACTIVE_STATUSES.has(item.status)) {
            // The worker died mid-flight. A chrome download can be checked;
            // anything else (offscreen mp4/hls ids) is re-queued because the
            // offscreen document died with the worker.
            const numeric = /^\d+$/.test(String(item.downloadId || ""));
            if (numeric) {
              const state = await chromeDownloadState(Number(item.downloadId));
              if (state === "complete") finishItem(item, { ok: true }, false);
              else if (state === "in_progress") byDownloadId.set(String(item.downloadId), item.key);
              else { item.status = "queued"; item.downloadId = null; }
            } else {
              item.status = "queued";
              item.downloadId = null;
            }
          }
          if (item.status === "queued" && stamp - (item.updatedAt || 0) > STALE_ACTIVE_MS) item.status = "listed";
          items.set(item.key, item);
        }
        running = Boolean(stored?.running) && Array.from(items.values()).some((item) => item.status === "queued" || ACTIVE_STATUSES.has(item.status));
        restored = true;
        if (running) void pump();
        scheduleBroadcast();
      })();
      return restorePromise;
    }

    function chromeDownloadState(id) {
      return new Promise((resolve) => {
        try {
          const maybe = chromeRef?.downloads?.search({ id }, (results) => {
            void chromeRef?.runtime?.lastError;
            resolve(results && results[0] ? results[0].state : "");
          });
          if (maybe && typeof maybe.then === "function") maybe.then((results) => resolve(results && results[0] ? results[0].state : ""), () => resolve(""));
        } catch {
          resolve("");
        }
      });
    }

    function normalizeSettings(input) {
      const out = { ...DEFAULT_SETTINGS };
      const concurrency = Number(input?.concurrency);
      out.concurrency = CONCURRENCY_OPTIONS.includes(concurrency) ? concurrency : DEFAULT_SETTINGS.concurrency;
      out.quality = QUALITY_OPTIONS.includes(String(input?.quality)) ? String(input.quality) : DEFAULT_SETTINGS.quality;
      out.skipDownloaded = input?.skipDownloaded === undefined ? DEFAULT_SETTINGS.skipDownloaded : Boolean(input.skipDownloaded);
      out.autoList = input?.autoList === undefined ? DEFAULT_SETTINGS.autoList : Boolean(input.autoList);
      out.mediaType = ["all", "video", "image"].includes(String(input?.mediaType)) ? String(input.mediaType) : "all";
      return out;
    }

    // --- snapshot / broadcast ---------------------------------------------------
    function counts() {
      let listed = 0;
      let selected = 0;
      let completed = 0;
      let failed = 0;
      let queued = 0;
      let active = 0;
      let skipped = 0;
      for (const item of items.values()) {
        listed += 1;
        if (item.selected && STARTABLE_STATUSES.has(item.status)) selected += 1;
        if (item.status === "completed") completed += 1;
        else if (item.status === "failed") failed += 1;
        else if (item.status === "queued") queued += 1;
        else if (item.status === "skipped") skipped += 1;
        else if (ACTIVE_STATUSES.has(item.status)) active += 1;
      }
      return { listed, selected, completed, failed, queued, active, skipped };
    }

    function snapshot() {
      return {
        items: Array.from(items.values()).map(compactItem),
        counts: counts(),
        crawl: { ...crawl, pages: undefined, pageCount: crawl.pages.length },
        settings: { ...settings },
        running,
        historySize: history.size,
      };
    }

    function scheduleBroadcast() {
      broadcastDirty = true;
      if (broadcastTimer) return;
      broadcastTimer = setTimeout(() => {
        broadcastTimer = null;
        if (!broadcastDirty) return;
        broadcastDirty = false;
        try {
          broadcast(snapshot());
        } catch (error) {
          logger.warn("panel broadcast failed", error);
        }
      }, BROADCAST_THROTTLE_MS);
    }

    function touch(item, patch) {
      Object.assign(item, patch || {}, { updatedAt: now() });
      persistSoon();
      scheduleBroadcast();
    }

    // --- list management ----------------------------------------------------------
    function normalizeIncoming(raw, source) {
      if (!raw) return null;
      const url = String(raw.url || "").trim();
      const route = routes.match(url);
      if (!route || !routes.isSinglePost(route)) return null;
      const site = route.site;
      const id = String(route.id);
      const type = raw.type === "image" ? "image" : "video";
      return {
        key: itemKey(site, id),
        site,
        id,
        url: route.canonicalUrl || url,
        title: String(raw.title || "").trim() || (site === "world" ? `Post ${id}` : `Video ${id}`),
        thumbnail: String(raw.thumbnail || (site === "world" ? routes.worldThumbnail(id) : "")),
        duration: String(raw.duration || ""),
        type,
        page: Number(raw.page) || Number(source?.page) || 0,
        sourceTitle: String(raw.sourceTitle || source?.title || ""),
        sourceUrl: String(raw.sourceUrl || source?.url || ""),
        searchContext: String(raw.searchContext || source?.searchContext || ""),
        status: "listed",
        selected: raw.selected === undefined ? true : Boolean(raw.selected),
        error: "",
        progress: 0,
        attempts: 0,
        downloadId: null,
        addedAt: now(),
        updatedAt: now(),
      };
    }

    // Add posts to the list. Returns how many were new / duplicates / skipped
    // because they were downloaded before (when skipDownloaded is on).
    function addItems(rawItems, options = {}) {
      const source = options.source || {};
      const result = { added: 0, duplicates: 0, alreadyDownloaded: 0, filtered: 0, capacityReached: false, keys: [] };
      const mediaType = options.mediaType || "all";
      for (const raw of Array.isArray(rawItems) ? rawItems : []) {
        const item = normalizeIncoming(raw, source);
        if (!item) continue;
        if (mediaType !== "all" && item.type !== mediaType) {
          result.filtered += 1;
          continue;
        }
        if (items.has(item.key)) {
          result.duplicates += 1;
          const existing = items.get(item.key);
          result.keys.push(existing.key);
          // An explicit "download this" on a row that is already listed (or
          // already finished) re-arms it; in-flight rows are left alone.
          if (options.start && STARTABLE_STATUSES.has(existing.status)) existing.selected = true;
          continue;
        }
        if (settings.skipDownloaded && history.has(item.key) && !options.ignoreHistory) {
          result.alreadyDownloaded += 1;
          continue;
        }
        if (items.size >= MAX_ITEMS) {
          result.capacityReached = true;
          break;
        }
        items.set(item.key, item);
        result.added += 1;
        result.keys.push(item.key);
      }
      if (result.added || result.duplicates) {
        persistSoon();
        scheduleBroadcast();
      }
      return result;
    }

    function setSelected(keys, selected) {
      let changed = 0;
      for (const key of Array.isArray(keys) ? keys : []) {
        const item = items.get(key);
        if (!item) continue;
        if (item.selected !== Boolean(selected)) {
          item.selected = Boolean(selected);
          changed += 1;
        }
      }
      if (changed) {
        persistSoon();
        scheduleBroadcast();
      }
      return changed;
    }

    function matchesFilter(item, filter) {
      const type = String(filter?.type || "all");
      if (type !== "all" && item.type !== type) return false;
      const site = String(filter?.site || "all");
      if (site !== "all" && item.site !== site) return false;
      const status = String(filter?.status || "all");
      if (status === "unfinished" && FINISHED_STATUSES.has(item.status)) return false;
      if (status === "finished" && !FINISHED_STATUSES.has(item.status)) return false;
      return true;
    }

    function selectAll(selected, filter) {
      const keys = [];
      for (const item of items.values()) {
        if (!matchesFilter(item, filter)) continue;
        // Ticking everything must not re-download what already finished.
        if (selected && item.status === "completed" && !filter?.includeCompleted) continue;
        keys.push(item.key);
      }
      return setSelected(keys, selected);
    }

    function invertSelection(filter) {
      let changed = 0;
      for (const item of items.values()) {
        if (!matchesFilter(item, filter)) continue;
        if (item.status === "completed" && !item.selected) continue;
        item.selected = !item.selected;
        changed += 1;
      }
      if (changed) {
        persistSoon();
        scheduleBroadcast();
      }
      return changed;
    }

    function removeItems(keys) {
      let removed = 0;
      for (const key of Array.isArray(keys) ? keys : []) {
        const item = items.get(key);
        if (!item) continue;
        if (ACTIVE_STATUSES.has(item.status) && item.downloadId !== null && item.downloadId !== undefined) {
          try { cancelDownload(item.downloadId); } catch {}
          byDownloadId.delete(String(item.downloadId));
        }
        items.delete(key);
        removed += 1;
      }
      if (removed) {
        persistSoon();
        scheduleBroadcast();
      }
      return removed;
    }

    function clearItems(which) {
      const keys = [];
      for (const item of items.values()) {
        if (which === "finished" && !FINISHED_STATUSES.has(item.status)) continue;
        if (which === "all" && ACTIVE_STATUSES.has(item.status)) continue; // never drop in-flight rows silently
        keys.push(item.key);
      }
      const removed = removeItems(keys);
      if (which === "all" && !Array.from(items.values()).some((item) => item.status === "queued" || ACTIVE_STATUSES.has(item.status))) {
        running = false;
        persistNow();
        scheduleBroadcast();
      }
      return removed;
    }

    // --- download pipeline ---------------------------------------------------------
    function start(keys) {
      const targets = Array.isArray(keys) && keys.length
        ? keys.map((key) => items.get(key)).filter(Boolean)
        : Array.from(items.values()).filter((item) => item.selected);
      let queued = 0;
      for (const item of targets) {
        if (!STARTABLE_STATUSES.has(item.status)) continue;
        item.status = "queued";
        item.error = "";
        item.progress = 0;
        item.updatedAt = now();
        queued += 1;
      }
      if (queued) {
        running = true;
        persistSoon();
        scheduleBroadcast();
        void pump();
      }
      return queued;
    }

    function stop() {
      running = false;
      let reverted = 0;
      for (const item of items.values()) {
        if (item.status === "queued") {
          item.status = "stopped";
          item.updatedAt = now();
          reverted += 1;
        }
      }
      // Stop crawling too — "Stop" means stop everything the panel is doing.
      stopCrawl();
      persistNow();
      scheduleBroadcast();
      return reverted;
    }

    function activeCount() {
      let count = 0;
      for (const item of items.values()) if (ACTIVE_STATUSES.has(item.status)) count += 1;
      return count;
    }

    function nextQueued() {
      for (const item of items.values()) if (item.status === "queued") return item;
      return null;
    }

    async function pump() {
      if (pumping) return;
      pumping = true;
      try {
        while (running) {
          if (activeCount() >= settings.concurrency) break;
          const item = nextQueued();
          if (!item) {
            if (!activeCount()) {
              running = false;
              persistNow();
              scheduleBroadcast();
            }
            break;
          }
          item.status = "resolving";
          item.attempts = (item.attempts || 0) + 1;
          item.updatedAt = now();
          scheduleBroadcast();
          void runItem(item).finally(() => {
            void pump();
          });
        }
      } finally {
        pumping = false;
      }
    }

    async function runItem(item) {
      try {
        if (item.tabId) setCurrentTab(item.tabId);
        const resolved = await resolvePost(item.url);
        if (!resolved || !Array.isArray(resolved.formats) || !resolved.formats.length) {
          throw new Error("No downloadable files found for this post.");
        }
        const format = pickFormat(resolved.formats, settings.quality);
        if (!format?.url) throw new Error("No matching format.");
        const isImage = format.format_type === "image";
        touch(item, {
          status: "downloading",
          title: resolved.title || item.title,
          thumbnail: item.thumbnail || resolved.thumbnail || "",
          type: isImage ? "image" : "video",
          quality: format.label || format.quality || "",
        });
        const videoInfo = {
          id: resolved.id || item.id,
          title: resolved.title || item.title,
          url: resolved.url || item.url,
          thumbnail: resolved.thumbnail || item.thumbnail,
          duration: resolved.duration,
          artist: resolved.artist || "",
          uploader: resolved.uploader || "",
          date: resolved.date || "",
          selectedFormat: format,
          formats: resolved.formats,
          skipFormatRefresh: true,
          __fromBatch: true,
          __searchContext: item.searchContext || "",
          __panelKey: item.key,
        };
        const result = await startDownload(videoInfo);
        const downloadId = result && result.downloadId;
        if (downloadId === undefined || downloadId === null) {
          // Nothing to track (should not happen) — count it as done.
          finishItem(item, { ok: true });
          return;
        }
        item.downloadId = downloadId;
        byDownloadId.set(String(downloadId), item.key);
        touch(item, {});
        const early = earlyOutcomes.get(String(downloadId));
        if (early) {
          earlyOutcomes.delete(String(downloadId));
          finishItem(item, early.outcome);
        }
      } catch (error) {
        const message = error?.message || String(error || "Download failed");
        // Expired signed links / flaky hosts: one automatic retry.
        if ((item.attempts || 0) < MAX_ATTEMPTS && running) {
          logger.warn("panel item failed, retrying once", item.url, message);
          touch(item, { status: "queued", error: message });
          return;
        }
        finishItem(item, { ok: false, error: message });
      }
    }

    function finishItem(item, outcome, announce = true) {
      if (item.downloadId !== null && item.downloadId !== undefined) byDownloadId.delete(String(item.downloadId));
      if (outcome?.ok) {
        item.status = "completed";
        item.error = "";
        item.progress = 100;
        item.selected = false;
        history.add(item.key);
        if (history.size > MAX_HISTORY) history.delete(history.values().next().value);
        persistHistory();
      } else {
        item.status = "failed";
        item.error = String(outcome?.error || "Download failed");
        item.progress = 0;
      }
      item.updatedAt = now();
      if (announce) {
        persistSoon();
        scheduleBroadcast();
      }
    }

    // Called by the download pipeline whenever a download finishes (chrome
    // downloads, offscreen MP4/HLS jobs, picture-set archives).
    function notifyOutcome(downloadId, outcome) {
      if (downloadId === undefined || downloadId === null) return false;
      const key = byDownloadId.get(String(downloadId));
      if (!key) {
        // Might belong to an item still inside startDownload(); keep it briefly.
        if (running || activeCount()) {
          earlyOutcomes.set(String(downloadId), { outcome, at: now() });
          for (const [id, entry] of earlyOutcomes) {
            if (now() - entry.at > 60000) earlyOutcomes.delete(id);
          }
        }
        return false;
      }
      const item = items.get(key);
      if (!item) {
        byDownloadId.delete(String(downloadId));
        return false;
      }
      finishItem(item, outcome);
      void pump();
      return true;
    }

    // The download pipeline swapped ids (a queued job started for real, or an
    // interrupted download restarted on the backup host): follow it.
    function rebindDownload(oldId, newId) {
      if (oldId === undefined || oldId === null || newId === undefined || newId === null) return false;
      const key = byDownloadId.get(String(oldId));
      if (!key) return false;
      byDownloadId.delete(String(oldId));
      byDownloadId.set(String(newId), key);
      const item = items.get(key);
      if (item) touch(item, { downloadId: newId });
      return true;
    }

    function notifyProgress(downloadId, progress) {
      const key = byDownloadId.get(String(downloadId));
      if (!key) return;
      const item = items.get(key);
      if (!item) return;
      const value = Math.max(0, Math.min(99, Number(progress) || 0));
      if (Math.abs(value - (item.progress || 0)) >= 1) {
        item.progress = value;
        scheduleBroadcast();
      }
    }

    function retryFailed() {
      const keys = [];
      for (const item of items.values()) {
        if (item.status === "failed") {
          item.attempts = 0;
          item.selected = true;
          keys.push(item.key);
        }
      }
      return start(keys);
    }

    // --- crawling (nh-dw style page fetcher) ------------------------------------
    function stopCrawl() {
      if (!crawl.running) return false;
      crawlToken += 1;
      try { crawlController?.abort(); } catch {}
      crawlController = null;
      crawl.running = false;
      crawl.stopped = true;
      crawl.finishedAt = now();
      scheduleBroadcast();
      return true;
    }

    // Describe a listing URL: route + total pages/items (one network round trip
    // for rule34video.com, one API call for rule34.world). Used by the panel to
    // pre-fill the page-range box ("1-87") before any crawl starts.
    async function describeListing(url) {
      const route = routes.match(url);
      if (!route || !routes.isListing(route)) return { success: false, error: "Not a listing page.", route };
      const adapter = route.site === "video" ? videoAdapter : worldAdapter;
      try {
        const info = await adapter.describe(route);
        return { success: true, route, ...info };
      } catch (error) {
        return { success: false, route, error: error?.message || String(error) };
      }
    }

    async function startCrawl(options = {}) {
      const url = String(options.url || "").trim();
      const route = routes.match(url);
      if (!route || !routes.isListing(route)) throw new Error("Open a search, tag, playlist or homepage listing first (or paste one).");
      if (crawl.running) throw new Error("A page fetch is already running. Stop it first.");
      const adapter = route.site === "video" ? videoAdapter : worldAdapter;
      const mediaType = route.site === "world" ? (options.mediaType || settings.mediaType || "all") : "all";
      const token = ++crawlToken;
      crawlController = typeof AbortController === "function" ? new AbortController() : null;
      Object.assign(crawl, emptyCrawlState(), {
        running: true,
        site: route.site,
        kind: route.kind,
        title: route.title || "",
        sourceUrl: url,
        // Range fetching must be reviewable and cancellable. Do not let an old
        // message sender turn a page fetch into an unbounded download stream.
        autoDownload: false,
        startedAt: now(),
      });
      scheduleBroadcast();

      const tabId = Number(options.tabId) || null;
      if (tabId) setCurrentTab(tabId);

      (async () => {
        try {
          const info = await adapter.describe(route, { signal: crawlController?.signal });
          if (token !== crawlToken) return;
          crawl.totalPages = info.totalPages || 0;
          crawl.totalItems = info.totalItems || 0;
          let pages;
          const requested = options.pages === undefined ? String(route.page || 1) : String(options.pages);
          // An open range from a start page ("5-", or "all"/"*" from page 1)
          // when the listing has no known total: walk a bounded batch and stop
          // when the pages run dry, like "all". "1-5" and "5" (bounded) stay
          // bounded and never auto-stop.
          const openAll = /^(all|\*)?$/i.test(requested.trim());
          const openFrom = requested.trim().match(/^(\d+)\s*-\s*$/);
          const wantsOpenEnded = (openAll || openFrom) && !crawl.totalPages;
          try {
            pages = routes.parsePageRange(requested, crawl.totalPages);
          } catch (error) {
            if (wantsOpenEnded) {
              const max = Math.max(1, Number(routes.PAGE_RANGE_HARD_CAP) || OPEN_ENDED_CRAWL_MAX_PAGES);
              const from = openFrom ? Number(openFrom[1]) : 1;
              pages = routes.parsePageRange(`${from}-${from + max - 1}`, 0);
              crawl.openEnded = true;
            } else {
              throw new Error(error?.message || "Bad page range.");
            }
          }
          // A bounded open-ended request on a listing that DOES know its total
          // (e.g. "5-" with a known page count) parses cleanly already — mark
          // it open-ended so the walk-to-the-end semantics apply below.
          if (openFrom && crawl.totalPages) crawl.openEnded = true;
          crawl.pages = pages;
          scheduleBroadcast();
          const source = {
            title: route.title || "",
            url: url,
            searchContext: searchContextFor(route),
          };
          let emptyStreak = 0;
          for (let index = 0; index < pages.length; index += 1) {
            if (token !== crawlToken) return;
            const page = pages[index];
            crawl.pageIndex = index + 1;
            crawl.currentPage = page;
            scheduleBroadcast();
            let found;
            try {
              found = await adapter.fetchPage(route, page, { mediaType, info, signal: crawlController?.signal });
            } catch (error) {
              // Stop fetch deliberately aborts the request. Do not overwrite
              // its clean "Stopped" state with a misleading AbortError, and do
              // not wait for a retry delay before honouring the stop token.
              if (token !== crawlToken) return;
              logger.warn("crawl page failed", route.kind, page, error);
              crawl.error = `Page ${page}: ${error?.message || error}`;
              scheduleBroadcast();
              await sleep(adapter.delayMs * 2);
              continue;
            }
            if (token !== crawlToken) return;
            crawl.found += found.length;
            const result = addItems(found.map((item) => ({ ...item, page })), { source, mediaType });
            crawl.added += result.added;
            crawl.duplicates += result.duplicates;
            crawl.alreadyDownloaded += result.alreadyDownloaded;
            crawl.filtered += result.filtered;
            // Do not download while we enumerate: rows are selected so the user
            // can inspect or untick them, then intentionally start the queue.
            if (result.capacityReached) {
              crawl.error = `List limit reached (${MAX_ITEMS.toLocaleString()} posts). Start or clear the queue, then fetch the next page batch.`;
              break;
            }
            // Past the last page, a listing can be empty or repeat cards while
            // the world API returns []. A page coming back EMPTY means we are
            // past the end (listings run newest → oldest, so nothing later is
            // non-empty), so stop even a bounded range there — that keeps an
            // explicit "1-150" on a short listing from making 150 calls. But an
            // already-listed (duplicate) page is NOT the end: widening a fetch
            // 1-2 → 1-5 must keep walking to list pages 3-5, so duplicates
            // never stop a bounded crawl (this was the re-fetch bug). Open-ended
            // "to the last page" crawls additionally treat two duplicate-only
            // pages in a row as the end.
            const emptyPage = !found.length;
            if (crawl.openEnded) {
              const dupOnlyPage = !result.added && result.duplicates === found.length && index > 0;
              if (emptyPage || dupOnlyPage) emptyStreak += 1;
              else emptyStreak = 0;
              if (emptyStreak >= 2) break;
            } else if (emptyPage) {
              break;
            }
            scheduleBroadcast();
            if (index < pages.length - 1) await sleep(adapter.delayMs);
          }
        } catch (error) {
          if (token === crawlToken) crawl.error = error?.message || String(error);
        } finally {
          if (token === crawlToken) {
            crawlController = null;
            crawl.running = false;
            crawl.finishedAt = now();
            persistSoon();
            scheduleBroadcast();
          }
        }
      })();
      return { success: true };
    }

    // The folder-name fallback for downloads started from this listing
    // (mirrors the popup's "use the search query" behaviour).
    function searchContextFor(route) {
      if (!route) return "";
      if (route.kind === "search") return route.query || "";
      if (route.kind === "tag" && Array.isArray(route.tags)) return route.tags.join(", ");
      if (route.kind === "tag" || route.kind === "category" || route.kind === "model") return String(route.id || "");
      if (route.kind === "playlist") return route.slug ? String(route.slug).replace(/[-_]+/g, " ") : `playlist ${route.id}`;
      return "";
    }

    // --- site adapters -----------------------------------------------------------------
    async function fetchText(url, signal) {
      const response = await fetchImpl(url, {
        credentials: "include",
        headers: { Accept: "text/html,application/xhtml+xml,*/*" },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    }

    const videoAdapter = {
      delayMs: VIDEO_PAGE_DELAY_MS,
      async describe(route, context = {}) {
        const html = await fetchText(routes.videoListingPageUrl(route, 1), context.signal);
        const items = routes.parseVideoListing(html, route.listingUrl);
        let totalPages = routes.parseVideoListingPageCount(html);
        const totalItems = routes.parseVideoListingTotal(html);
        if (!totalPages && totalItems && items.length) totalPages = Math.ceil(totalItems / items.length);
        if (!totalPages && items.length) totalPages = 1;
        return { totalPages, totalItems, perPage: items.length, firstPage: items };
      },
      async fetchPage(route, page, context = {}) {
        if (page === 1 && context.info?.firstPage) return context.info.firstPage;
        const html = await fetchText(routes.videoListingPageUrl(route, page), context.signal);
        return routes.parseVideoListing(html, route.listingUrl);
      },
    };

    // --- rule34.world: sequential keyset walk --------------------------------
    // Live capture (2026-09-04): POST /api/v2/post/search/root (or
    // /search/playlist/{id}) is a keyset feed. Request `{ skip, cursor, take,
    // countTotal:false, checkHasMore:true, filterAi:false, sortBy, includeTags }`;
    // response `{ items:[{id,type,duration,files,…}], cursor:"<lastId>",
    // hasMore:bool }`, NO total. To get page N you must walk pages 1→N sending
    // the previous page's `cursor` (the last id it returned); there is no way
    // to jump straight to a deep page, and `hasMore:false` is the only end.
    // The adapter therefore carries a per-crawl cursor/sequence on
    // `context.info.seq` and, when asked for a page, advances through any
    // earlier pages that were not fetched yet (returning only the requested
    // page's items). rule34video.com (offset HTML crawler) is untouched.
    const worldAdapter = {
      delayMs: WORLD_PAGE_DELAY_MS,
      endpoint(route) {
        if (route.kind === "playlist") return `https://rule34.world/api/v2/post/search/playlist/${encodeURIComponent(route.id)}`;
        return "https://rule34.world/api/v2/post/search/root";
      },
      newSeq() {
        return { advancedTo: 0, cursor: "", hasMore: true, byPage: {} };
      },
      // One request for the page right after `seq.advancedTo`, threaded with the
      // cursor carried on the sequence. Updates the sequence in place.
      async advanceSeq(route, mediaType, seq, context) {
        const target = seq.advancedTo + 1;
        const body = routes.worldSearchBody({ ...route, mediaType }, target, { cursor: seq.cursor });
        if (route.kind === "playlist") delete body.includeTags;
        const response = await fetchImpl(this.endpoint(route), {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body),
          ...(context?.signal ? { signal: context.signal } : {}),
        });
        if (!response.ok) throw new Error(`rule34.world API ${response.status}`);
        const data = await response.json();
        const list = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
        const items = list.map(worldItem).filter(Boolean);
        const take = Number(body.take) > 0 ? Number(body.take) : 30;
        // hasMore only when the API says so (or, if it omits the field, when a
        // full page came back — a short/empty page means the feed is exhausted).
        const hasMore = data?.hasMore === true ? true : data?.hasMore === false ? false : items.length >= take;
        const cursor = data?.cursor === undefined || data?.cursor === null
          ? (items.length ? items[items.length - 1].id : seq.cursor)
          : String(data.cursor);
        seq.advancedTo = target;
        seq.byPage[target] = items;
        seq.cursor = cursor;
        seq.hasMore = hasMore;
        return { items, hasMore, cursor };
      },
      // Return the items for `page`, walking the keyset from the furthest
      // already-fetched page if needed. Empty when the feed ends first.
      async ensurePage(route, mediaType, seq, page, context) {
        const target = Math.max(1, Number(page) || 1);
        while (seq.advancedTo < target && seq.hasMore) {
          const before = seq.advancedTo;
          await this.advanceSeq(route, mediaType, seq, context);
          if (seq.advancedTo === before) break; // no progress → stop walking
          if (seq.advancedTo < target) await sleep(this.delayMs);
        }
        return seq.byPage[target] || [];
      },
      async describe(route, context = {}) {
        const seq = this.newSeq();
        // Seed page 1 (no cursor yet). There is no total-count field, so the
        // panel treats this listing as open-ended ("to the last page").
        await this.advanceSeq(route, settings.mediaType, seq, context);
        return {
          totalPages: 0,
          totalItems: 0,
          perPage: (seq.byPage[1] || []).length || 30,
          firstPage: seq.byPage[1] || [],
          seq,
        };
      },
      async fetchPage(route, page, context = {}) {
        // Normal crawl: reuse the sequence started by describe so pages 2..N
        // thread the cursor instead of re-walking from page 1 each time.
        if (context?.info && context.info.seq) {
          return this.ensurePage(route, context.mediaType || settings.mediaType, context.info.seq, page, context);
        }
        // Standalone (e.g. "list this page" with no prior describe): walk from
        // page 1 to the requested page.
        const seq = this.newSeq();
        await this.advanceSeq(route, settings.mediaType, seq, context);
        if ((Number(page) || 1) <= 1) return seq.byPage[1] || [];
        return this.ensurePage(route, settings.mediaType, seq, page, context);
      },
    };

    function worldItem(raw) {
      const id = raw && (raw.id ?? raw.postId ?? raw.post_id);
      if (id === undefined || id === null) return null;
      const isVideo = Number(raw.type) === 1 || Number(raw.duration) > 0;
      const artist = Array.isArray(raw.tags) ? raw.tags.find((tag) => tag && tag.type === 8)?.value : "";
      return {
        id: String(id),
        url: routes.worldPostUrl(id),
        title: artist ? `${artist} - post ${id}` : `Post ${id}`,
        thumbnail: routes.worldThumbnail(id),
        duration: isVideo && Number(raw.duration) > 0 ? formatDuration(raw.duration) : "",
        type: isVideo ? "video" : "image",
      };
    }

    function formatDuration(seconds) {
      const total = Math.max(0, Math.round(Number(seconds) || 0));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${m}:${String(s).padStart(2, "0")}`;
    }

    // --- "list this page" -------------------------------------------------------------
    // rule34video.com: ask the content script for the cards on screen (keeps
    // the user's sort/filter), falling back to fetching the page HTML.
    // rule34.world: the page's posts come from the API (page N of the route).
    async function listPage(options = {}) {
      const url = String(options.url || "").trim();
      const route = routes.match(url);
      if (!route) throw new Error("This page is not a supported Rule 34 page.");
      if (routes.isSinglePost(route)) {
        const result = addItems([{ url: route.canonicalUrl || url, title: "" }], { source: { title: "", url }, ignoreHistory: true });
        return { success: true, route, ...result, found: 1 };
      }
      if (!routes.isListing(route)) throw new Error("Open a listing (search, tag, playlist, homepage) or a post.");
      const source = { title: route.title || "", url, page: route.page || 1, searchContext: searchContextFor(route) };
      let found = null;
      if (route.site === "video" && options.tabId) {
        try {
          found = await collectPageItems(options.tabId);
        } catch {
          found = null;
        }
      }
      if (!Array.isArray(found) || !found.length) {
        const adapter = route.site === "video" ? videoAdapter : worldAdapter;
        found = await adapter.fetchPage(route, route.page || 1, { mediaType: settings.mediaType });
      }
      const result = addItems(found.map((item) => ({ ...item, page: route.page || 1 })), { source, mediaType: route.site === "world" ? settings.mediaType : "all" });
      return { success: true, route, found: found.length, ...result };
    }

    // --- message handler -------------------------------------------------------------
    async function handleMessage(request, sender) {
      try {
        await restore();
        return await dispatch(request, sender);
      } catch (error) {
        return { success: false, error: error?.message || String(error) };
      }
    }

    async function dispatch(request, sender) {
      const action = String(request?.action || "");
      switch (action) {
        case "panel.get":
          return { success: true, snapshot: snapshot() };
        case "panel.describe":
          return await describeListing(request.url);
        case "panel.listPage": {
          const result = await listPage({ url: request.url, tabId: request.tabId || sender?.tab?.id });
          return result;
        }
        case "panel.crawl.start": {
          await startCrawl({
            url: request.url,
            pages: request.pages,
            mediaType: request.mediaType,
            tabId: request.tabId || sender?.tab?.id,
          });
          return { success: true, snapshot: snapshot() };
        }
        case "panel.crawl.stop":
          stopCrawl();
          return { success: true };
        case "panel.add": {
          const tabId = request.tabId || sender?.tab?.id || null;
          if (tabId) setCurrentTab(tabId);
          const result = addItems(request.items, { source: request.source || {}, start: Boolean(request.start), ignoreHistory: Boolean(request.start) });
          if (request.start && result.keys.length) {
            for (const key of result.keys) {
              const item = items.get(key);
              if (item && tabId) item.tabId = tabId;
            }
            start(result.keys);
          }
          return { success: true, ...result };
        }
        case "panel.select":
          return { success: true, changed: setSelected(request.keys, request.selected) };
        case "panel.selectAll":
          return { success: true, changed: selectAll(request.selected, request.filter) };
        case "panel.invert":
          return { success: true, changed: invertSelection(request.filter) };
        case "panel.remove":
          return { success: true, removed: removeItems(request.keys) };
        case "panel.clear":
          return { success: true, removed: clearItems(request.which === "finished" ? "finished" : "all") };
        case "panel.retryFailed":
          return { success: true, queued: retryFailed() };
        case "panel.start":
          return { success: true, queued: start(request.keys) };
        case "panel.stop":
          return { success: true, stopped: stop() };
        case "panel.settings.set": {
          settings = normalizeSettings({ ...settings, ...(request.settings || {}) });
          persistSettings();
          scheduleBroadcast();
          if (running) void pump();
          return { success: true, settings: { ...settings } };
        }
        case "panel.history.reset":
          history = new Set();
          persistHistory();
          scheduleBroadcast();
          return { success: true };
        default:
          return { success: false, error: `Unknown panel action: ${action}` };
      }
    }

    function isPanelAction(request) {
      return typeof request?.action === "string" && request.action.startsWith("panel.");
    }

    return {
      restore,
      handleMessage,
      isPanelAction,
      notifyOutcome,
      notifyProgress,
      rebindDownload,
      snapshot,
      flush: persistNow,
      // exposed for tests
      _pickFormat: pickFormat,
    };
  }

  const api = {
    create,
    pickFormat,
    STORAGE_KEY,
    HISTORY_KEY,
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
    QUALITY_OPTIONS,
    CONCURRENCY_OPTIONS,
  };

  try {
    root.R34PanelQueue = api;
  } catch {}
})(typeof globalThis !== "undefined" ? globalThis : this);
