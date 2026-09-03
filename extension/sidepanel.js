// sidepanel.js — the Side Panel UI.
//
// Thin view over the service-worker queue engine (extension/panel-queue.js):
// it renders the snapshot the background broadcasts, and every button is one
// "panel.*" message. The panel reads the ACTIVE TAB's URL through the shared
// router (extension/site-routes.js) and shows only the controls that make
// sense there:
//
//   rule34video.com post  -> "Download this post"
//   rule34video.com list  -> List / Download page, page-range crawl, playlists
//   rule34.world post     -> "Download this post" (image or video)
//   rule34.world list     -> same, plus the pics/videos filter
//   anything else         -> the queue + "fetch from a URL" only
//
// No framework, no build step (classic script, CSP-safe).

(function () {
  "use strict";

  const Routes = globalThis.R34Routes;
  const Folder = globalThis.R34FolderNaming;
  const $ = (id) => document.getElementById(id);

  const el = {
    siteEyebrow: $("siteEyebrow"), panelTitle: $("panelTitle"), engineStatus: $("engineStatus"),
    tabStatus: $("tabStatus"), tabStatusTitle: $("tabStatusTitle"), tabStatusDetail: $("tabStatusDetail"), refreshTabBtn: $("refreshTabBtn"),
    postCard: $("postCard"), postThumb: $("postThumb"), postTitle: $("postTitle"), postMeta: $("postMeta"), downloadPostBtn: $("downloadPostBtn"), listPostBtn: $("listPostBtn"), postHint: $("postHint"),
    listingCard: $("listingCard"), listingTitle: $("listingTitle"), listingMeta: $("listingMeta"), listingKind: $("listingKind"),
    listPageBtn: $("listPageBtn"), downloadPageBtn: $("downloadPageBtn"), pageRange: $("pageRange"), rangeHelpBtn: $("rangeHelpBtn"), rangeHelp: $("rangeHelp"), allPagesBtn: $("allPagesBtn"),
    worldFilters: $("worldFilters"), videoFilters: $("videoFilters"), mediaTypeSelect: $("mediaTypeSelect"), skipDownloaded: $("skipDownloaded"), skipDownloadedVideo: $("skipDownloadedVideo"),
    crawlListBtn: $("crawlListBtn"), crawlDownloadBtn: $("crawlDownloadBtn"), crawlStopBtn: $("crawlStopBtn"), crawlProgress: $("crawlProgress"), crawlBar: $("crawlBar"), crawlText: $("crawlText"), listingHint: $("listingHint"),
    remoteCard: $("remoteCard"), remoteInput: $("remoteInput"), remoteUseTabBtn: $("remoteUseTabBtn"), remoteRange: $("remoteRange"), remoteListBtn: $("remoteListBtn"), remoteDownloadBtn: $("remoteDownloadBtn"), remoteHint: $("remoteHint"),
    listedCount: $("listedCount"), selectedCount: $("selectedCount"), completedCount: $("completedCount"),
    selectAll: $("selectAll"), invertBtn: $("invertBtn"), mediaFilter: $("mediaFilter"),
    retryFailedBtn: $("retryFailedBtn"), clearFinishedBtn: $("clearFinishedBtn"), resetHistoryBtn: $("resetHistoryBtn"), clearListBtn: $("clearListBtn"),
    masterFolder: $("masterFolder"), tokenChecks: $("tokenChecks"), collectionTemplate: $("collectionTemplate"), artistFolderMode: $("artistFolderMode"), pictureSaveMode: $("pictureSaveMode"), duplicateBehaviour: $("duplicateBehaviour"), namePreview: $("namePreview"),
    queue: $("queue"),
    concurrencyGroup: $("concurrencyGroup"), qualitySelect: $("qualitySelect"), downloadSelectedBtn: $("downloadSelectedBtn"), stopBtn: $("stopBtn"), dockNotice: $("dockNotice"),
  };

  const state = {
    tab: null,
    route: null,
    listingInfo: null,
    snapshot: null,
    filter: "all",
    renderLimit: 400,
    settingsSaveTimer: null,
    noticeTimer: null,
  };

  // --- messaging ----------------------------------------------------------------
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

  function notice(text, kind) {
    el.dockNotice.textContent = text;
    el.dockNotice.className = `download-notice ${kind || ""}`.trim();
    if (state.noticeTimer) clearTimeout(state.noticeTimer);
    if (kind) {
      state.noticeTimer = setTimeout(() => {
        el.dockNotice.className = "download-notice";
        el.dockNotice.textContent = "Tick posts (or Select all), then download. Downloads keep running while you browse.";
      }, 6000);
    }
  }

  function hint(node, text, kind) {
    node.textContent = text || "";
    node.className = `hint ${kind || ""}`.trim();
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  // --- active tab --------------------------------------------------------------------
  async function readActiveTab() {
    let tab = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = tabs && tabs[0] ? tabs[0] : null;
      if (!tab) {
        const fallback = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = fallback && fallback[0] ? fallback[0] : null;
      }
    } catch {}
    state.tab = tab;
    state.route = tab && tab.url && Routes ? Routes.match(tab.url) : null;
    renderTabContext();
    renderNamePreview();
    if (state.route && Routes.isListing(state.route)) void describeListing();
  }

  function renderTabContext() {
    const route = state.route;
    const site = route ? route.site : "";
    el.siteEyebrow.textContent = site === "video" ? "RULE34VIDEO.COM" : site === "world" ? "RULE34.WORLD" : "RULE 34 DOWNLOADER";
    el.siteEyebrow.className = `eyebrow ${site}`.trim();
    el.postCard.classList.add("hidden");
    el.listingCard.classList.add("hidden");
    el.tabStatus.className = "tab-status";

    if (!route) {
      el.panelTitle.textContent = "Download queue";
      el.tabStatusTitle.textContent = "No supported page in this tab";
      el.tabStatusDetail.textContent = state.tab?.url ? "The panel only activates on rule34video.com and rule34.world pages." : "Open rule34video.com or rule34.world to begin.";
      el.tabStatus.classList.add("warn");
      el.remoteCard.open = true;
      return;
    }
    el.tabStatus.classList.add("ok");
    if (Routes.isSinglePost(route)) {
      el.panelTitle.textContent = site === "world" ? "Post" : "Video";
      el.tabStatusTitle.textContent = site === "world" ? `rule34.world post ${route.id}` : `rule34video.com video ${route.id}`;
      el.tabStatusDetail.textContent = state.tab?.title || state.tab?.url || "";
      el.postCard.classList.remove("hidden");
      el.postTitle.textContent = cleanTitle(state.tab?.title) || `${site === "world" ? "Post" : "Video"} ${route.id}`;
      el.postMeta.textContent = site === "world" ? "Picture or video — the best file is picked automatically." : "Best available quality unless you pick one below.";
      const thumb = site === "world" ? Routes.worldThumbnail(route.id) : "";
      if (thumb) { el.postThumb.src = thumb; el.postThumb.hidden = false; } else { el.postThumb.hidden = true; }
      hint(el.postHint, "");
      return;
    }
    if (Routes.isListing(route)) {
      const titles = { playlist: "Playlist", search: "Search", home: "Homepage", latest: "Latest updates", feed: route.title, tag: "Tag", category: "Category", model: "Artist", member: "Member" };
      el.panelTitle.textContent = titles[route.kind] || "Listing";
      el.tabStatusTitle.textContent = `${site === "world" ? "rule34.world" : "rule34video.com"} · ${route.title || route.kind}`;
      el.tabStatusDetail.textContent = `Page ${route.page || 1}` + (state.tab?.url ? ` · ${state.tab.url}` : "");
      el.listingCard.classList.remove("hidden");
      el.listingTitle.textContent = route.title || route.kind;
      el.listingKind.textContent = `${route.kind}`;
      el.listingKind.className = `kind-badge ${site}`;
      el.listingMeta.textContent = "Reading page info…";
      el.worldFilters.classList.toggle("hidden", site !== "world");
      el.videoFilters.classList.toggle("hidden", site !== "video");
      el.pageRange.value = String(route.page || 1);
      hint(el.listingHint, site === "video" && route.kind === "playlist"
        ? "Choose a page batch to list the playlist, review it, then download only the checked videos."
        : site === "world"
          ? "Fetches pictures AND videos through the site API — page N here is page N on the site."
          : "");
      return;
    }
    // playlists index etc.
    el.panelTitle.textContent = "Download queue";
    el.tabStatusTitle.textContent = `${site === "world" ? "rule34.world" : "rule34video.com"} · ${route.title || route.kind}`;
    el.tabStatusDetail.textContent = "Open a playlist to fetch its videos, or paste its URL below.";
    el.tabStatus.classList.add("warn");
    el.remoteCard.open = true;
  }

  function cleanTitle(title) {
    return String(title || "").replace(/\s*[-|–]\s*Rule ?34.*$/i, "").trim();
  }

  function safePageBatchRange(route, totalPages) {
    const start = Math.max(1, Number(route?.page) || 1);
    const cap = Math.max(1, Number(Routes?.PAGE_RANGE_HARD_CAP) || 150);
    const knownLast = Math.max(0, Number(totalPages) || 0);
    const end = knownLast ? Math.min(knownLast, start + cap - 1) : start + cap - 1;
    return start === end ? String(start) : `${start}-${end}`;
  }

  async function describeListing() {
    const route = state.route;
    if (!route || !state.tab?.url) return;
    const url = state.tab.url;
    state.listingInfo = null;
    const response = await send({ action: "panel.describe", url });
    if (!state.tab || state.tab.url !== url) return; // tab changed meanwhile
    if (!response.success) {
      el.listingMeta.textContent = `Could not read the listing (${response.error || "unknown error"}).`;
      return;
    }
    state.listingInfo = response;
    const pages = Number(response.totalPages) || 0;
    const total = Number(response.totalItems) || 0;
    const perPage = Number(response.perPage) || 0;
    const bits = [];
    if (total) bits.push(`${total.toLocaleString()} posts`);
    if (pages) bits.push(`${pages.toLocaleString()} pages`);
    if (perPage) bits.push(`${perPage} per page`);
    el.listingMeta.textContent = bits.length
      ? bits.join(" · ")
      : "Page count unknown — fetch an explicit, bounded range such as 1-20.";
    if (pages && (!el.pageRange.value || el.pageRange.value === String(route.page || 1))) {
      el.pageRange.value = safePageBatchRange(route, pages);
    }
  }

  // --- listing actions ------------------------------------------------------------------
  async function listCurrentPage(autoDownload) {
    if (!state.tab?.url) return;
    const button = autoDownload ? el.downloadPageBtn : el.listPageBtn;
    button.disabled = true;
    try {
      const response = await send({ action: "panel.listPage", url: state.tab.url, tabId: state.tab.id });
      if (!response.success) {
        hint(el.listingHint, response.error || "Could not list this page.", "error");
        return;
      }
      const parts = [`${plural(response.found || 0, "post")} on this page`, `${response.added || 0} new`];
      if (response.duplicates) parts.push(`${response.duplicates} already listed`);
      if (response.alreadyDownloaded) parts.push(`${response.alreadyDownloaded} downloaded before`);
      if (response.filtered) parts.push(`${response.filtered} filtered out`);
      hint(el.listingHint, parts.join(" · "), "ok");
      if (autoDownload && response.keys && response.keys.length) {
        await send({ action: "panel.start", keys: response.keys });
      }
    } finally {
      button.disabled = false;
    }
  }

  async function startCrawl(url, pages, hintNode) {
    if (!url) return;
    const response = await send({
      action: "panel.crawl.start",
      url,
      pages,
      mediaType: el.mediaTypeSelect.value,
      tabId: state.tab?.id,
    });
    if (!response.success) hint(hintNode, response.error || "Could not start.", "error");
    else hint(hintNode, "Fetching pages — posts are listed and checked, never auto-downloaded.", "ok");
  }

  async function downloadSelected(hintNode) {
    const response = await send({ action: "panel.start" });
    if (!response.success) {
      if (hintNode) hint(hintNode, response.error || "Could not start downloads.", "error");
      else notice(response.error || "Could not start downloads.", "error");
      return response;
    }
    const text = response.queued ? `${plural(response.queued, "selected post")} queued — the active-download limit is applied.` : "No selected posts are ready to download.";
    if (hintNode) hint(hintNode, text, response.queued ? "ok" : "");
    else notice(text, response.queued ? "ok" : "");
    return response;
  }

  // --- single post -----------------------------------------------------------------------
  async function addCurrentPost(start) {
    const route = state.route;
    if (!route || !state.tab) return;
    const item = {
      url: route.canonicalUrl || state.tab.url,
      title: cleanTitle(state.tab.title),
      thumbnail: route.site === "world" ? Routes.worldThumbnail(route.id) : "",
      selected: true,
    };
    el.downloadPostBtn.disabled = true;
    el.listPostBtn.disabled = true;
    try {
      const response = await send({ action: "panel.add", items: [item], start: Boolean(start), tabId: state.tab.id });
      if (!response.success) hint(el.postHint, response.error || "Failed.", "error");
      else if (start) hint(el.postHint, "Queued — watch it below.", "ok");
      else hint(el.postHint, response.added ? "Added to the list." : "Already in the list.", "ok");
    } finally {
      el.downloadPostBtn.disabled = false;
      el.listPostBtn.disabled = false;
    }
  }

  // --- snapshot rendering -------------------------------------------------------------------
  function applySnapshot(snapshot) {
    if (!snapshot) return;
    state.snapshot = snapshot;
    renderCounts();
    renderEngineStatus();
    renderCrawl();
    renderSettings();
    renderQueue();
  }

  function visibleItems() {
    const items = state.snapshot?.items || [];
    if (state.filter === "all") return items;
    return items.filter((item) => item.type === state.filter);
  }

  function renderCounts() {
    const counts = state.snapshot?.counts || { listed: 0, selected: 0, completed: 0 };
    el.listedCount.textContent = String(counts.listed || 0);
    el.selectedCount.textContent = String(counts.selected || 0);
    el.completedCount.textContent = String(counts.completed || 0);
    const selected = counts.selected || 0;
    el.downloadSelectedBtn.textContent = selected ? `Download ${selected} selected` : "Download selected";
    el.downloadSelectedBtn.disabled = !selected;
    el.crawlDownloadBtn.disabled = !selected;
    el.remoteDownloadBtn.disabled = !selected;
    const busy = Boolean(state.snapshot?.running) || Boolean(state.snapshot?.crawl?.running);
    el.stopBtn.disabled = !busy;
    const shown = visibleItems();
    const startable = shown.filter((item) => ["listed", "failed", "skipped", "stopped"].includes(item.status));
    el.selectAll.checked = startable.length > 0 && startable.every((item) => item.selected);
    el.selectAll.indeterminate = startable.some((item) => item.selected) && !el.selectAll.checked;
  }

  function renderEngineStatus() {
    const snap = state.snapshot;
    const counts = snap?.counts || {};
    if (snap?.crawl?.running) {
      el.engineStatus.textContent = `Fetching page ${snap.crawl.currentPage || "…"}`;
      el.engineStatus.className = "status-pill crawling";
    } else if (snap?.running) {
      el.engineStatus.textContent = `${counts.active || 0} active · ${counts.queued || 0} waiting`;
      el.engineStatus.className = "status-pill running";
    } else {
      el.engineStatus.textContent = "Ready";
      el.engineStatus.className = "status-pill idle";
    }
  }

  function renderCrawl() {
    const crawl = state.snapshot?.crawl;
    const running = Boolean(crawl?.running);
    el.crawlStopBtn.classList.toggle("hidden", !running);
    el.crawlListBtn.disabled = running;
    // Starting already checked rows remains safe while a fetch runs: newly
    // found rows stay listed until the user explicitly starts them later.
    el.remoteListBtn.disabled = running;
    const show = running || (crawl && crawl.finishedAt && Date.now() - crawl.finishedAt < 30000);
    el.crawlProgress.classList.toggle("hidden", !show);
    if (!crawl || !show) return;
    const total = crawl.pageCount || 0;
    const done = running ? Math.max(0, (crawl.pageIndex || 1) - 1) : total;
    el.crawlBar.style.width = total ? `${Math.round((done / total) * 100)}%` : (running ? "15%" : "100%");
    const parts = [];
    if (running) parts.push(`Page ${crawl.currentPage || "…"}${total ? ` (${crawl.pageIndex}/${total})` : ""}`);
    else if (crawl.stopped) parts.push("Stopped");
    else if (crawl.error) parts.push("Ended early");
    else parts.push(`Done — ${plural(total, "page")}`);
    parts.push(`${crawl.found || 0} found`, `${crawl.added || 0} new`);
    if (crawl.duplicates) parts.push(`${crawl.duplicates} dup`);
    if (crawl.alreadyDownloaded) parts.push(`${crawl.alreadyDownloaded} downloaded before`);
    if (crawl.filtered) parts.push(`${crawl.filtered} filtered`);
    if (crawl.error) parts.push(`⚠ ${crawl.error}`);
    el.crawlText.textContent = parts.join(" · ");
  }

  function renderSettings() {
    const settings = state.snapshot?.settings;
    if (!settings) return;
    for (const button of el.concurrencyGroup.querySelectorAll("button")) {
      button.classList.toggle("selected", Number(button.dataset.concurrency) === Number(settings.concurrency));
    }
    if (document.activeElement !== el.qualitySelect) el.qualitySelect.value = String(settings.quality || "best");
    if (document.activeElement !== el.mediaTypeSelect) el.mediaTypeSelect.value = String(settings.mediaType || "all");
    el.skipDownloaded.checked = Boolean(settings.skipDownloaded);
    el.skipDownloadedVideo.checked = Boolean(settings.skipDownloaded);
  }

  function renderQueue() {
    const items = visibleItems();
    el.queue.textContent = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = '<div class="empty-icon">↓</div><h2>Nothing listed yet</h2><p>Open a search, tag, playlist or homepage and press <strong>List this page</strong>, or fetch a range of pages.</p>';
      if (state.filter !== "all" && (state.snapshot?.items || []).length) {
        empty.querySelector("h2").textContent = "Nothing matches this filter";
        empty.querySelector("p").textContent = "Switch the filter back to “All media”.";
      }
      el.queue.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    const shown = items.slice(0, state.renderLimit);
    for (const item of shown) fragment.appendChild(renderItem(item));
    if (items.length > shown.length) {
      const more = document.createElement("div");
      more.className = "queue-more";
      more.textContent = `… and ${items.length - shown.length} more (Select all / Download selected include them).`;
      const button = document.createElement("button");
      button.className = "text-button";
      button.textContent = "Show more";
      button.addEventListener("click", () => { state.renderLimit += 400; renderQueue(); });
      more.appendChild(button);
      fragment.appendChild(more);
    }
    el.queue.appendChild(fragment);
  }

  function renderItem(item) {
    const row = document.createElement("div");
    row.className = `queue-item ${item.status}${item.selected ? " selected" : ""}`;
    row.dataset.key = item.key;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = Boolean(item.selected);
    box.disabled = !["listed", "failed", "skipped", "stopped", "completed"].includes(item.status);
    box.title = item.status === "completed" ? "Tick to download again" : "Select";
    box.addEventListener("change", () => {
      void send({ action: "panel.select", keys: [item.key], selected: box.checked });
    });
    row.appendChild(box);

    if (item.thumbnail) {
      const img = document.createElement("img");
      img.src = item.thumbnail;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => {
        const placeholder = document.createElement("div");
        placeholder.className = "thumb-placeholder";
        placeholder.textContent = item.type === "image" ? "🖼" : "▶";
        img.replaceWith(placeholder);
      }, { once: true });
      row.appendChild(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "thumb-placeholder";
      placeholder.textContent = item.type === "image" ? "🖼" : "▶";
      row.appendChild(placeholder);
    }

    const info = document.createElement("div");
    info.className = "item-info";
    const title = document.createElement("div");
    title.className = "item-title";
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.title || item.id;
    link.title = item.title || item.url;
    title.appendChild(link);
    info.appendChild(title);
    const meta = document.createElement("div");
    meta.className = "item-meta";
    const siteBadge = document.createElement("span");
    siteBadge.className = `type-badge ${item.site === "world" ? "world-site" : "video-site"}`;
    siteBadge.textContent = item.site === "world" ? "world" : "video";
    meta.appendChild(siteBadge);
    const typeBadge = document.createElement("span");
    typeBadge.className = `type-badge ${item.type}`;
    typeBadge.textContent = item.type === "image" ? "pic" : "video";
    meta.appendChild(typeBadge);
    if (item.duration) meta.appendChild(document.createTextNode(item.duration));
    if (item.page) meta.appendChild(document.createTextNode(`p.${item.page}`));
    if (item.quality) meta.appendChild(document.createTextNode(item.quality));
    info.appendChild(meta);
    row.appendChild(info);

    const right = document.createElement("div");
    right.className = "item-right";
    const status = document.createElement("span");
    status.className = `item-status ${item.status}`;
    status.textContent = item.status === "failed" ? (item.error || "failed") : item.status;
    status.title = item.error || item.status;
    right.appendChild(status);
    if (item.status === "downloading" && item.progress > 0) {
      const bar = document.createElement("div");
      bar.className = "item-progress";
      const fill = document.createElement("i");
      fill.style.width = `${Math.max(2, Math.min(100, item.progress))}%`;
      bar.appendChild(fill);
      right.appendChild(bar);
    }
    const remove = document.createElement("button");
    remove.className = "item-remove";
    remove.title = ["resolving", "downloading"].includes(item.status) ? "Cancel and remove" : "Remove from list";
    remove.textContent = "×";
    remove.addEventListener("click", () => { void send({ action: "panel.remove", keys: [item.key] }); });
    right.appendChild(remove);
    row.appendChild(right);
    return row;
  }

  // --- output settings (chrome.storage.sync, shared with the background) ------------------
  const OUTPUT_DEFAULTS = {
    masterFolder: Folder?.DEFAULT_MASTER_FOLDER || "R34V",
    collectionTemplate: Folder?.DEFAULT_COLLECTION_TEMPLATE || "{artist} - {title} - {id}",
    artistFolderMode: false,
    pictureSaveMode: "loose",
    duplicateBehaviour: "uniquify",
  };
  const TOKEN_LABELS = { site: "Site", artist: "Artist", uploader: "Uploader", title: "Title", text: "Title (40 chars)", id: "Post ID", date: "Date", tags: "Tags" };

  function outputArea() {
    try { return chrome.storage.sync || chrome.storage.local; } catch { return null; }
  }

  function saveOutput(patch) {
    if (state.settingsSaveTimer) clearTimeout(state.settingsSaveTimer);
    state.settingsSaveTimer = setTimeout(() => {
      try { outputArea()?.set(patch); } catch {}
    }, 200);
  }

  function renderTokenChecks(template) {
    if (!Folder) return;
    el.tokenChecks.textContent = "";
    const inUse = Folder.templateTokensInUse(template);
    for (const token of Folder.COLLECTION_TOKENS) {
      const label = document.createElement("label");
      label.className = "check-label";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.token = token;
      box.checked = Boolean(inUse[token]);
      box.addEventListener("change", () => {
        const checked = {};
        for (const other of el.tokenChecks.querySelectorAll("input[data-token]")) checked[other.dataset.token] = other.checked;
        const rebuilt = Folder.buildTemplate(checked);
        el.collectionTemplate.value = rebuilt;
        saveOutput({ collectionTemplate: rebuilt });
        renderNamePreview();
      });
      label.appendChild(box);
      label.appendChild(document.createTextNode(" " + (TOKEN_LABELS[token] || token)));
      el.tokenChecks.appendChild(label);
    }
  }

  function renderNamePreview() {
    if (!Folder || !el.masterFolder) return;
    const site = state.route?.site === "world" ? "https://rule34.world/post/1" : "https://rule34video.com/video/1/";
    const path = Folder.buildRelativePath({
      masterFolder: el.masterFolder.value,
      site,
      template: el.collectionTemplate.value,
      artistFolderMode: el.artistFolderMode.checked,
      searchContext: state.route && Routes.isListing(state.route) ? (state.route.query || state.route.title || "") : "",
      context: { artist: "Artist", uploader: "Uploader", title: "Post title", text: "Post title", id: "123456", date: "2026-01-01", tags: ["tag"] },
      fallbackId: "123456",
      basename: "Post title",
      ext: "mp4",
    });
    el.namePreview.textContent = "Downloads/" + path;
  }

  async function initOutputSettings() {
    const area = outputArea();
    let stored = {};
    try {
      stored = await new Promise((resolve) => {
        const maybe = area?.get({ ...OUTPUT_DEFAULTS }, (data) => resolve(data || {}));
        if (maybe && typeof maybe.then === "function") maybe.then((data) => resolve(data || {}), () => resolve({}));
        if (!area) resolve({});
      });
    } catch {}
    const settings = { ...OUTPUT_DEFAULTS, ...stored };
    el.masterFolder.value = settings.masterFolder === undefined || settings.masterFolder === null ? OUTPUT_DEFAULTS.masterFolder : String(settings.masterFolder);
    el.collectionTemplate.value = typeof settings.collectionTemplate === "string" ? settings.collectionTemplate : OUTPUT_DEFAULTS.collectionTemplate;
    el.artistFolderMode.checked = Boolean(settings.artistFolderMode);
    el.pictureSaveMode.value = ["loose", "zip", "cbz", "pdf"].includes(settings.pictureSaveMode) ? settings.pictureSaveMode : "loose";
    el.duplicateBehaviour.value = settings.duplicateBehaviour === "overwrite" ? "overwrite" : "uniquify";
    renderTokenChecks(el.collectionTemplate.value);
    renderNamePreview();

    el.masterFolder.addEventListener("input", () => { saveOutput({ masterFolder: el.masterFolder.value.trim() }); renderNamePreview(); });
    el.collectionTemplate.addEventListener("input", () => { saveOutput({ collectionTemplate: el.collectionTemplate.value }); renderTokenChecks(el.collectionTemplate.value); renderNamePreview(); });
    el.artistFolderMode.addEventListener("change", () => { saveOutput({ artistFolderMode: el.artistFolderMode.checked }); renderNamePreview(); });
    el.pictureSaveMode.addEventListener("change", () => saveOutput({ pictureSaveMode: el.pictureSaveMode.value }));
    el.duplicateBehaviour.addEventListener("change", () => saveOutput({ duplicateBehaviour: el.duplicateBehaviour.value }));
  }

  // --- wiring ------------------------------------------------------------------------
  function bind() {
    el.refreshTabBtn.addEventListener("click", () => void readActiveTab());
    el.downloadPostBtn.addEventListener("click", () => void addCurrentPost(true));
    el.listPostBtn.addEventListener("click", () => void addCurrentPost(false));

    el.listPageBtn.addEventListener("click", () => void listCurrentPage(false));
    el.downloadPageBtn.addEventListener("click", () => void listCurrentPage(true));
    el.rangeHelpBtn.addEventListener("click", () => el.rangeHelp.classList.toggle("hidden"));
    el.allPagesBtn.addEventListener("click", () => {
      // Do not turn a 9,000-page listing into an accidental download job.
      // This fills only the next reviewable batch; the user can enter any
      // specific page/range (including a later one) themselves.
      el.pageRange.value = safePageBatchRange(state.route, state.listingInfo?.totalPages);
      el.pageRange.focus();
    });
    el.crawlListBtn.addEventListener("click", () => void startCrawl(state.tab?.url, el.pageRange.value, el.listingHint));
    el.crawlDownloadBtn.addEventListener("click", () => void downloadSelected(el.listingHint));
    el.crawlStopBtn.addEventListener("click", () => void send({ action: "panel.crawl.stop" }));
    el.pageRange.addEventListener("keydown", (event) => { if (event.key === "Enter") void startCrawl(state.tab?.url, el.pageRange.value, el.listingHint); });

    el.mediaTypeSelect.addEventListener("change", () => {
      void send({ action: "panel.settings.set", settings: { mediaType: el.mediaTypeSelect.value } });
      void describeListing();
    });
    const toggleSkip = (checked) => void send({ action: "panel.settings.set", settings: { skipDownloaded: checked } });
    el.skipDownloaded.addEventListener("change", () => toggleSkip(el.skipDownloaded.checked));
    el.skipDownloadedVideo.addEventListener("change", () => toggleSkip(el.skipDownloadedVideo.checked));

    el.remoteUseTabBtn.addEventListener("click", () => { if (state.tab?.url) el.remoteInput.value = state.tab.url; });
    el.remoteListBtn.addEventListener("click", () => void startCrawl(el.remoteInput.value.trim(), el.remoteRange.value || "1-150", el.remoteHint));
    el.remoteDownloadBtn.addEventListener("click", () => void downloadSelected(el.remoteHint));
    el.remoteInput.addEventListener("keydown", (event) => { if (event.key === "Enter") void startCrawl(el.remoteInput.value.trim(), el.remoteRange.value || "1-150", el.remoteHint); });

    el.selectAll.addEventListener("change", () => void send({ action: "panel.selectAll", selected: el.selectAll.checked, filter: { type: state.filter } }));
    el.invertBtn.addEventListener("click", () => void send({ action: "panel.invert", filter: { type: state.filter } }));
    el.mediaFilter.addEventListener("change", () => { state.filter = el.mediaFilter.value; renderQueue(); renderCounts(); });
    el.retryFailedBtn.addEventListener("click", () => void send({ action: "panel.retryFailed" }));
    el.clearFinishedBtn.addEventListener("click", () => void send({ action: "panel.clear", which: "finished" }));
    el.resetHistoryBtn.addEventListener("click", async () => {
      const response = await send({ action: "panel.history.reset" });
      notice(response.success ? "Download history forgotten — skipped posts list again." : (response.error || "Failed."), response.success ? "ok" : "error");
    });
    el.clearListBtn.addEventListener("click", () => void send({ action: "panel.clear", which: "all" }));

    el.concurrencyGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-concurrency]");
      if (!button) return;
      void send({ action: "panel.settings.set", settings: { concurrency: Number(button.dataset.concurrency) } });
    });
    el.qualitySelect.addEventListener("change", () => void send({ action: "panel.settings.set", settings: { quality: el.qualitySelect.value } }));
    el.downloadSelectedBtn.addEventListener("click", async () => {
      el.downloadSelectedBtn.disabled = true;
      await downloadSelected();
    });
    el.stopBtn.addEventListener("click", async () => {
      await send({ action: "panel.stop" });
      notice("Stopped. Waiting rows are kept — press Download selected to resume.", "ok");
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.action === "panel.snapshot" && message.snapshot) applySnapshot(message.snapshot);
    });
    // Follow the user's tab: URL changes, tab switches, window focus.
    try {
      chrome.tabs.onActivated.addListener(() => void readActiveTab());
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (state.tab && tabId === state.tab.id && (changeInfo.url || changeInfo.status === "complete" || changeInfo.title)) void readActiveTab();
      });
      chrome.windows?.onFocusChanged?.addListener(() => void readActiveTab());
    } catch {}
  }

  async function init() {
    bind();
    await initOutputSettings();
    await readActiveTab();
    const response = await send({ action: "panel.get" });
    if (response.success) applySnapshot(response.snapshot);
    else notice(response.error || "The background is not responding — reload the extension.", "error");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void init());
  else void init();
})();
