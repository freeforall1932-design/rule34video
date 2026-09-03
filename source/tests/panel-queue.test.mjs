// Offline tests for the side-panel queue engine (extension/panel-queue.js).
//
// The engine is a dependency-injected factory, so it runs here with a fake
// chrome.storage, a fake fetch that serves rule34video.com listing pages and
// rule34.world API pages, and a fake download pipeline that records what it
// was asked to download. Covers: listing a page, page-range crawls on both
// sites (incl. playlists and "all"), dedupe + download history, the
// concurrency-limited worker pool, completion/failure/rebind plumbing, media
// filtering for rule34.world and restore-after-restart.
//
// Run: node --test source/tests/panel-queue.test.mjs

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadClassicScript } from "./helpers/loadClassicScript.mjs";

let Routes;
let PanelQueue;
const listingHtml = readFileSync(join(process.cwd(), "source/page-source/rule34video-listing.html"), "utf8");

before(async () => {
  Routes = await loadClassicScript("site-routes.js", "R34Routes");
  PanelQueue = await loadClassicScript("panel-queue.js", "R34PanelQueue");
});

function fakeChrome(initial = {}) {
  const store = { ...initial };
  const downloads = { states: {} };
  return {
    store,
    downloads,
    api: {
      storage: {
        local: {
          get: (keys, cb) => {
            const out = {};
            for (const key of Array.isArray(keys) ? keys : Object.keys(keys || store)) if (key in store) out[key] = store[key];
            cb(out);
          },
          set: (patch, cb) => { Object.assign(store, patch); if (cb) cb(); },
          remove: (keys, cb) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; if (cb) cb(); },
        },
      },
      downloads: {
        search: ({ id }, cb) => cb(downloads.states[id] ? [{ id, state: downloads.states[id] }] : []),
      },
      runtime: { lastError: null },
    },
  };
}

// A small rule34video.com listing page: N cards with ids base..base+N-1 and a
// pagination block claiming `pages` pages.
function videoListingPage(base, count, pages) {
  const cards = [];
  for (let i = 0; i < count; i += 1) {
    const id = base + i;
    cards.push(`<div class="item thumb" data-video-card-id="${id}"><a class="th js-open-popup" href="https://rule34video.com/video/${id}/slug-${id}/" title="Video ${id}"><div class="img wrap_image"><img class="thumb lazy-load" data-original="https://rule34video.com/contents/videos_screenshots/${id}/320x180/3.jpg" alt="Video ${id}"></div><div class="time">1:0${i}</div></a></div>`);
  }
  const pagination = pages > 1
    ? `<div class="pagination"><div class="item"><a href="https://rule34video.com/x/${pages}/" data-parameters="from:${pages}">Last</a></div></div>`
    : "";
  return `<html><body><h1>Videos for: test (${count * pages})</h1>${cards.join("")}${pagination}</body></html>`;
}

function worldPage(ids, total, videoIds = []) {
  return {
    items: ids.map((id) => ({ id, type: videoIds.includes(id) ? 1 : 0, duration: videoIds.includes(id) ? 12 : 0, tags: [{ type: 8, value: "Artist" }] })),
    totalCount: total,
    cursor: null,
  };
}

function createEngine(overrides = {}) {
  const chromeMock = fakeChrome(overrides.storage || {});
  const fetchLog = [];
  const started = [];
  const cancelled = [];
  let nextDownloadId = 1000;
  let engineRef = null;
  const engine = PanelQueue.create({
    chrome: chromeMock.api,
    routes: Routes,
    fetchImpl: async (url, init) => {
      fetchLog.push(url);
      if (overrides.fetch) {
        const custom = await overrides.fetch(url, init, fetchLog);
        if (custom) return custom;
      }
      // rule34video.com: three listing pages of 3 cards.
      if (/rule34video\.com/.test(url)) {
        const u = new URL(url);
        // The crawler must use the canonical /…/N/ page a browser sees, not
        // KVS's failing undocumented get_block endpoint.
        const match = u.pathname.match(/\/(?:latest-updates|search\/[^/]+|playlists\/\d+\/[^/]+)\/(\d+)\/?$/i);
        const page = Number(match?.[1] || 1);
        if (page > 3) return { ok: true, status: 200, text: async () => "<html><body></body></html>" };
        return { ok: true, status: 200, text: async () => videoListingPage(100 + page * 10, 3, 3) };
      }
      // rule34.world: 2 pages of 30 (total 45).
      if (/rule34\.world\/api/.test(url)) {
        const body = JSON.parse(init.body);
        const page = body.Skip / body.take + 1;
        const ids = [];
        const start = 5000 + (page - 1) * 30;
        const count = page === 1 ? 30 : page === 2 ? 15 : 0;
        for (let i = 0; i < count; i += 1) ids.push(start + i);
        const filtered = body.type === 1 ? ids.filter((id) => id % 2 === 0) : body.type === 0 ? ids.filter((id) => id % 2 === 1) : ids;
        return { ok: true, status: 200, json: async () => worldPage(filtered, 45, ids.filter((id) => id % 2 === 0)) };
      }
      return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
    },
    resolvePost: overrides.resolvePost || (async (url) => {
      const route = Routes.match(url);
      if (route.site === "world") {
        const image = Number(route.id) % 2 === 1;
        return { id: route.id, title: `Post ${route.id}`, url, formats: image ? [{ url: `https://cdn/${route.id}.jpg`, format_type: "image", ext: "jpg" }] : [{ url: `https://cdn/${route.id}.mp4`, format_type: "mp4", height: 720, label: "720p" }, { url: `https://cdn/${route.id}_480.mp4`, format_type: "mp4", height: 480, label: "480p" }] };
      }
      return { id: route.id, title: `Video ${route.id}`, url, formats: [{ url: `https://v/${route.id}_1080.mp4`, format_type: "mp4", height: 1080, label: "1080p" }, { url: `https://v/${route.id}_720.mp4`, format_type: "mp4", height: 720, label: "720p" }, { url: `https://v/${route.id}_360.mp4`, format_type: "mp4", height: 360, label: "360p" }] };
    }),
    startDownload: overrides.startDownload || (async (videoInfo) => {
      const downloadId = nextDownloadId++;
      started.push({ downloadId, videoInfo });
      // Like a tiny real download: finishes shortly after it started.
      if (overrides.autoComplete) setTimeout(() => engineRef.notifyOutcome(downloadId, { ok: true }), 5);
      return { downloadId };
    }),
    cancelDownload: (id) => cancelled.push(id),
    collectPageItems: overrides.collectPageItems || (async () => null),
    broadcast: () => {},
  });
  engineRef = engine;
  return { engine, chromeMock, fetchLog, started, cancelled };
}

function waitFor(predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error("timed out waiting"));
      setTimeout(tick, 15);
    };
    tick();
  });
}

describe("format choice", () => {
  it("prefers the requested height, then the next lower one, and always the image for picture posts", () => {
    const formats = [{ height: 1080, format_type: "mp4" }, { height: 720, format_type: "mp4" }, { height: 360, format_type: "mp4" }];
    assert.equal(PanelQueue.pickFormat(formats, "best").height, 1080);
    assert.equal(PanelQueue.pickFormat(formats, "720").height, 720);
    assert.equal(PanelQueue.pickFormat(formats, "480").height, 360);
    assert.equal(PanelQueue.pickFormat(formats, "240").height, 360);
    assert.equal(PanelQueue.pickFormat([{ format_type: "image", url: "x" }, ...formats], "1080").format_type, "image");
    assert.equal(PanelQueue.pickFormat([], "best"), null);
    // rule34.world 256px grid previews are never preferred over a real file…
    const withPreview = [{ height: 720, format_type: "mp4" }, { height: 256, format_type: "mp4", preview: true }];
    assert.equal(PanelQueue.pickFormat(withPreview, "360").height, 720);
    // …but are still used when a post has nothing else.
    assert.equal(PanelQueue.pickFormat([{ height: 256, format_type: "mp4", preview: true }], "best").height, 256);
  });
});

describe("listing a page", () => {
  it("lists the cards of a rule34video.com search page (via the tab when possible)", async () => {
    const { engine, fetchLog } = createEngine({
      collectPageItems: async () => [{ id: "1", url: "https://rule34video.com/video/1/a/", title: "From tab", type: "video" }],
    });
    const result = await engine.handleMessage({ action: "panel.listPage", url: "https://rule34video.com/search/touhou/", tabId: 7 });
    assert.equal(result.success, true);
    assert.equal(result.added, 1);
    assert.equal(fetchLog.length, 0, "no network round trip when the tab answered");
    const snap = engine.snapshot();
    assert.equal(snap.items[0].title, "From tab");
    assert.equal(snap.items[0].selected, true);
    assert.equal(snap.items[0].status, "listed");
  });

  it("falls back to fetching the page HTML when there is no content script", async () => {
    const { engine } = createEngine();
    const result = await engine.handleMessage({ action: "panel.listPage", url: "https://rule34video.com/search/touhou/2/" });
    assert.equal(result.success, true);
    assert.equal(result.found, 3);
    assert.deepEqual(engine.snapshot().items.map((item) => item.id), ["120", "121", "122"]);
    assert.equal(engine.snapshot().items[0].page, 2);
  });

  it("lists a rule34.world tag page through the API, pictures and videos alike", async () => {
    const { engine } = createEngine();
    const result = await engine.handleMessage({ action: "panel.listPage", url: "https://rule34.world/touhou" });
    assert.equal(result.success, true);
    assert.equal(result.added, 30);
    const items = engine.snapshot().items;
    assert.equal(items.filter((item) => item.type === "image").length, 15);
    assert.equal(items.filter((item) => item.type === "video").length, 15);
    assert.equal(items[0].thumbnail, Routes.worldThumbnail(5000));
  });

  it("treats a single post URL as a one-item listing", async () => {
    const { engine } = createEngine();
    const result = await engine.handleMessage({ action: "panel.listPage", url: "https://rule34.world/post/42" });
    assert.equal(result.added, 1);
    assert.equal(engine.snapshot().items[0].key, "world:42");
  });
});

describe("page crawls", () => {
  it("describes a listing before crawling", async () => {
    const { engine } = createEngine();
    const info = await engine.handleMessage({ action: "panel.describe", url: "https://rule34video.com/search/touhou/" });
    assert.equal(info.success, true);
    assert.equal(info.totalPages, 3);
    const world = await engine.handleMessage({ action: "panel.describe", url: "https://rule34.world/touhou" });
    assert.equal(world.totalPages, 2);
    assert.equal(world.totalItems, 45);
  });

  it("crawls an explicit range of rule34video.com pages and dedupes", async () => {
    const { engine, fetchLog } = createEngine();
    await engine.handleMessage({ action: "panel.crawl.start", url: "https://rule34video.com/search/touhou/", pages: "1,3" });
    await waitFor(() => !engine.snapshot().crawl.running);
    const snap = engine.snapshot();
    assert.equal(snap.crawl.error, "");
    assert.equal(snap.crawl.found, 6);
    assert.equal(snap.crawl.added, 6);
    assert.deepEqual(snap.items.map((item) => item.id).sort(), ["110", "111", "112", "130", "131", "132"]);
    assert.ok(fetchLog.some((url) => /\/search\/touhou\/3\/$/.test(url)), "page 3 was fetched through its canonical URL");
    assert.ok(!fetchLog.some((url) => /\/search\/touhou\/2\/$/.test(url)), "page 2 was not requested");

    // Crawling the same range again adds nothing.
    await engine.handleMessage({ action: "panel.crawl.start", url: "https://rule34video.com/search/touhou/", pages: "1-3" });
    await waitFor(() => !engine.snapshot().crawl.running);
    assert.equal(engine.snapshot().crawl.added, 3, "only page 2 was new");
    assert.equal(engine.snapshot().crawl.duplicates, 6);
  });

  it("crawls 'all' pages of a rule34video.com playlist", async () => {
    const { engine, fetchLog } = createEngine();
    await engine.handleMessage({ action: "panel.crawl.start", url: "https://rule34video.com/playlists/3072/bioshock3/", pages: "all" });
    await waitFor(() => !engine.snapshot().crawl.running);
    const snap = engine.snapshot();
    assert.equal(snap.crawl.pageCount, 3);
    assert.equal(snap.items.length, 9);
    assert.ok(fetchLog.some((url) => /\/playlists\/3072\/bioshock3\/2\/$/.test(url)), "playlist page 2 uses its canonical URL");
    assert.equal(snap.items[0].sourceTitle, "Playlist bioshock3");
  });

  it("clamps an open range like 1-99 to the real last page", async () => {
    const { engine, fetchLog } = createEngine();
    await engine.handleMessage({ action: "panel.crawl.start", url: "https://rule34video.com/", pages: "1-99" });
    await waitFor(() => !engine.snapshot().crawl.running);
    assert.equal(engine.snapshot().crawl.pageCount, 3);
    assert.equal(fetchLog.filter((url) => /latest-updates/.test(url)).length, 3, "first page fetched once (describe), pages 2-3 once each");
  });

  it("crawls rule34.world pages through the API for review, never auto-downloading", async () => {
    const { engine, started } = createEngine({ autoComplete: true });
    await engine.handleMessage({ action: "panel.settings.set", settings: { concurrency: 3 } });
    // Even a stale caller that still sends autoDownload must only list rows.
    await engine.handleMessage({ action: "panel.crawl.start", url: "https://rule34.world/touhou", pages: "all", mediaType: "video", autoDownload: true });
    await waitFor(() => !engine.snapshot().crawl.running);
    // 15 even ids on page 1 + 8 on page 2 are videos.
    let snap = engine.snapshot();
    assert.equal(snap.crawl.pageCount, 2);
    assert.equal(snap.crawl.autoDownload, false);
    assert.ok(snap.items.every((item) => item.type === "video"), "only videos were listed");
    assert.equal(snap.items.length, 23);
    assert.equal(snap.counts.selected, 23, "found posts are ready for an explicit user start");
    assert.equal(started.length, 0, "a page fetch never starts a download stream");

    // The explicit queue action then starts no more than the chosen three.
    await engine.handleMessage({ action: "panel.start" });
    await waitFor(() => engine.snapshot().counts.completed === 23 && !engine.snapshot().running, 6000);
    snap = engine.snapshot();
    assert.equal(started.length, 23, "every explicitly selected video was handed to the download pipeline");
    assert.ok(started.every((entry) => entry.videoInfo.selectedFormat.height === 720), "best format by default");
    assert.ok(started.every((entry) => entry.videoInfo.__fromBatch === true));
    assert.equal(started[0].videoInfo.__searchContext, "touhou");
  });

  it("crawls 'all' pages of a listing whose total is unknown until the pages run dry", async () => {
    const { engine } = createEngine({
      fetch: async (url, init) => {
        if (!/rule34\.world\/api/.test(url)) return null;
        const body = JSON.parse(init.body);
        const page = body.Skip / body.take + 1;
        const ids = page <= 2 ? Array.from({ length: 30 }, (_, i) => 7000 + (page - 1) * 30 + i) : [];
        return { ok: true, status: 200, json: async () => ({ items: ids.map((id) => ({ id, type: 0 })), cursor: null }) };
      },
    });
    const info = await engine.handleMessage({ action: "panel.describe", url: "https://rule34.world/hot" });
    assert.equal(info.totalPages, 0, "the API reported no total");
    await engine.handleMessage({ action: "panel.crawl.start", url: "https://rule34.world/hot", pages: "all" });
    await waitFor(() => !engine.snapshot().crawl.running, 8000);
    const snap = engine.snapshot();
    assert.equal(snap.crawl.error, "");
    assert.equal(snap.items.length, 60);
    assert.ok(snap.crawl.pageIndex <= 5, "stopped shortly after the pages ran dry, not at 300");
  });

  it("a widened re-fetch (1-2 then 1-5) still lists the new pages when the total is unknown", async () => {
    const { engine } = createEngine({
      fetch: async (url, init) => {
        if (!/rule34\.world\/api/.test(url)) return null;
        const body = JSON.parse(init.body);
        const page = body.Skip / body.take + 1;
        const ids = page <= 4 ? Array.from({ length: 30 }, (_, i) => 9000 + (page - 1) * 30 + i) : [];
        return { ok: true, status: 200, json: async () => ({ items: ids.map((id) => ({ id, type: 0 })) }) };
      },
    });
    // First fetch 1-2 (listing has no reported total, but pages 1-4 exist).
    await engine.handleMessage({ action: "panel.crawl.start", url: "https://rule34.world/touhou", pages: "1-2" });
    await waitFor(() => !engine.snapshot().crawl.running);
    assert.equal(engine.snapshot().items.length, 60, "first fetch listed pages 1-2");

    // Widen to 1-5. The already-listed pages 1-2 must NOT stop the crawl early;
    // pages 3-5 still get requested and listed (3-4 new, 5 empty).
    await engine.handleMessage({ action: "panel.crawl.start", url: "https://rule34.world/touhou", pages: "1-5" });
    await waitFor(() => !engine.snapshot().crawl.running);
    const snap = engine.snapshot();
    assert.equal(snap.items.length, 120, "pages 3-4 were listed on the widened re-fetch");
    assert.equal(snap.crawl.error, "");
    assert.ok(snap.crawl.duplicates >= 60, "pages 1-2 counted as duplicates but did not stop the run");
  });

  it("an open range from a page ('2-') with an unknown total starts there and stops when dry", async () => {
    const { engine } = createEngine({
      fetch: async (url, init) => {
        if (!/rule34\.world\/api/.test(url)) return null;
        const body = JSON.parse(init.body);
        const page = body.Skip / body.take + 1;
        const ids = page <= 3 ? Array.from({ length: 30 }, (_, i) => 12000 + (page - 1) * 30 + i) : [];
        return { ok: true, status: 200, json: async () => ({ items: ids.map((id) => ({ id, type: 0 })) }) };
      },
    });
    await engine.handleMessage({ action: "panel.crawl.start", url: "https://rule34.world/touhou", pages: "2-" });
    await waitFor(() => !engine.snapshot().crawl.running);
    const snap = engine.snapshot();
    assert.equal(snap.crawl.error, "");
    assert.equal(snap.items.length, 60, "listed pages 2 and 3, stopped when page 4 ran dry");
    assert.ok(snap.items.every((item) => Number(item.id) >= 12030), "page 1 was not crawled");
  });

  it("aborts the in-flight page request when Stop fetch is pressed", async () => {
    let requestStarted = false;
    let aborted = false;
    const { engine } = createEngine({
      fetch: async (url, init) => {
        if (!/rule34video\.com/.test(url)) return null;
        requestStarted = true;
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            aborted = true;
            const error = new Error("fetch aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      },
    });
    await engine.handleMessage({ action: "panel.crawl.start", url: "https://rule34video.com/search/touhou/", pages: "1-2" });
    await waitFor(() => requestStarted);
    const stopped = await engine.handleMessage({ action: "panel.crawl.stop" });
    assert.equal(stopped.success, true);
    await waitFor(() => aborted);
    // Let the rejected request unwind through the crawler's catch/finally.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snap = engine.snapshot();
    assert.equal(snap.crawl.running, false);
    assert.equal(snap.crawl.stopped, true);
    assert.equal(snap.crawl.error, "", "an intentional abort is not shown as a fetch error");
    assert.equal(snap.items.length, 0);
  });

  it("reports a bad range instead of crawling", async () => {
    const { engine } = createEngine();
    await engine.handleMessage({ action: "panel.crawl.start", url: "https://rule34video.com/search/touhou/", pages: "banana" });
    await waitFor(() => !engine.snapshot().crawl.running);
    assert.match(engine.snapshot().crawl.error, /Cannot read/);
    assert.equal(engine.snapshot().items.length, 0);
  });

  it("refuses non-listing URLs", async () => {
    const { engine } = createEngine();
    const response = await engine.handleMessage({ action: "panel.crawl.start", url: "https://rule34video.com/terms/", pages: "1" });
    assert.equal(response.success, false);
    assert.match(response.error, /listing/);
  });
});

describe("download pool", () => {
  it("defaults to three active downloads", () => {
    const { engine } = createEngine();
    assert.equal(PanelQueue.DEFAULT_SETTINGS.concurrency, 3);
    assert.equal(engine.snapshot().settings.concurrency, 3);
  });

  it("runs at most `concurrency` downloads at once and completes them from outcomes", async () => {
    const pending = [];
    const { engine } = createEngine({
      startDownload: async (videoInfo) => new Promise((resolve) => pending.push({ videoInfo, resolve })),
    });
    await engine.handleMessage({ action: "panel.settings.set", settings: { concurrency: 3, quality: "720" } });
    await engine.handleMessage({ action: "panel.listPage", url: "https://rule34video.com/search/touhou/" });
    await engine.handleMessage({ action: "panel.add", items: [{ url: "https://rule34.world/post/42", title: "Fourth row" }] });
    const response = await engine.handleMessage({ action: "panel.start" });
    assert.equal(response.queued, 4);
    await waitFor(() => pending.length === 3);
    let snap = engine.snapshot();
    assert.equal(snap.counts.active, 3, "the user-selected cap of three is enforced");
    assert.equal(snap.counts.queued, 1);
    assert.equal(snap.running, true);
    assert.ok(pending.every((entry) => entry.videoInfo.selectedFormat.height === 720), "quality preference applied");

    // First download starts (gets an id) and then finishes, releasing exactly
    // one slot for the waiting row.
    pending[0].resolve({ downloadId: 501 });
    await waitFor(() => engine.snapshot().items.some((item) => item.downloadId === 501));
    assert.equal(engine.notifyOutcome(501, { ok: true }), true);
    await waitFor(() => pending.length === 4, 2000);
    snap = engine.snapshot();
    assert.equal(snap.counts.completed, 1);
    assert.equal(snap.counts.active, 3);

    // Second fails outright, third gets rebound (queued-> real id) then completes.
    pending[1].resolve({ downloadId: 502 });
    await waitFor(() => engine.snapshot().items.some((item) => item.downloadId === 502));
    engine.notifyOutcome(502, { ok: false, error: "boom" });
    pending[2].resolve({ downloadId: "queued-1-1" });
    await waitFor(() => engine.snapshot().items.some((item) => item.downloadId === "queued-1-1"));
    assert.equal(engine.rebindDownload("queued-1-1", 777), true);
    engine.notifyOutcome(777, { ok: true });
    pending[3].resolve({ downloadId: 778 });
    await waitFor(() => engine.snapshot().items.some((item) => item.downloadId === 778));
    engine.notifyOutcome(778, { ok: true });
    await waitFor(() => !engine.snapshot().running);
    snap = engine.snapshot();
    assert.equal(snap.counts.completed, 3);
    assert.equal(snap.counts.failed, 1);
    assert.equal(snap.items.find((item) => item.status === "failed").error, "boom");
    assert.equal(snap.historySize, 3);
  });

  it("an outcome that races ahead of the download id is not lost", async () => {
    let resolveStart;
    const { engine } = createEngine({
      startDownload: () => new Promise((resolve) => { resolveStart = resolve; }),
    });
    await engine.handleMessage({ action: "panel.listPage", url: "https://rule34video.com/video/9/x/" });
    await engine.handleMessage({ action: "panel.start" });
    await waitFor(() => Boolean(resolveStart));
    // chrome.downloads.onChanged fires before startDownload() returned.
    engine.notifyOutcome(900, { ok: true });
    resolveStart({ downloadId: 900 });
    await waitFor(() => engine.snapshot().counts.completed === 1);
  });

  it("retries a failing resolve once, then marks the row failed; Retry failed re-queues it", async () => {
    let calls = 0;
    const { engine, started } = createEngine({
      resolvePost: async () => { calls += 1; throw new Error("expired link"); },
    });
    await engine.handleMessage({ action: "panel.listPage", url: "https://rule34.world/post/1" });
    await engine.handleMessage({ action: "panel.start" });
    await waitFor(() => engine.snapshot().counts.failed === 1);
    assert.equal(calls, 2);
    assert.equal(started.length, 0);
    const retry = await engine.handleMessage({ action: "panel.retryFailed" });
    assert.equal(retry.queued, 1);
    await waitFor(() => engine.snapshot().counts.failed === 1 && !engine.snapshot().running);
    assert.equal(calls, 4);
  });

  it("stop parks the waiting rows and cancel-removes an in-flight row", async () => {
    const { engine, cancelled } = createEngine({ startDownload: () => new Promise(() => {}) });
    await engine.handleMessage({ action: "panel.settings.set", settings: { concurrency: 1 } });
    await engine.handleMessage({ action: "panel.listPage", url: "https://rule34video.com/search/touhou/" });
    await engine.handleMessage({ action: "panel.start" });
    await waitFor(() => engine.snapshot().counts.active === 1);
    const stop = await engine.handleMessage({ action: "panel.stop" });
    assert.equal(stop.stopped, 2);
    let snap = engine.snapshot();
    assert.equal(snap.running, false);
    assert.equal(snap.items.filter((item) => item.status === "stopped").length, 2);
    // Stopped rows count as selectable again.
    assert.equal(snap.counts.selected, 2);
    const active = snap.items.find((item) => item.status === "resolving" || item.status === "downloading");
    await engine.handleMessage({ action: "panel.remove", keys: [active.key] });
    snap = engine.snapshot();
    assert.equal(snap.items.length, 2);
    void cancelled;
  });
});

describe("selection, history and maintenance", () => {
  it("select all / invert / clear finished / clear list behave like the Twitter panel", async () => {
    const { engine } = createEngine();
    await engine.handleMessage({ action: "panel.listPage", url: "https://rule34.world/touhou" });
    await engine.handleMessage({ action: "panel.selectAll", selected: false });
    assert.equal(engine.snapshot().counts.selected, 0);
    await engine.handleMessage({ action: "panel.selectAll", selected: true, filter: { type: "image" } });
    assert.equal(engine.snapshot().counts.selected, 15);
    await engine.handleMessage({ action: "panel.invert" });
    assert.equal(engine.snapshot().counts.selected, 15);
    assert.ok(engine.snapshot().items.filter((item) => item.selected).every((item) => item.type === "video"));
    const cleared = await engine.handleMessage({ action: "panel.clear", which: "all" });
    assert.equal(cleared.removed, 30);
    assert.equal(engine.snapshot().items.length, 0);
  });

  it("skips posts that were downloaded before, until the history is reset", async () => {
    const { engine, chromeMock } = createEngine();
    await engine.handleMessage({ action: "panel.settings.set", settings: { concurrency: 5 } });
    await engine.handleMessage({ action: "panel.listPage", url: "https://rule34video.com/search/touhou/" });
    await engine.handleMessage({ action: "panel.start" });
    await waitFor(() => engine.snapshot().items.every((item) => item.status === "downloading" && item.downloadId !== null));
    for (const item of engine.snapshot().items) engine.notifyOutcome(item.downloadId, { ok: true });
    await waitFor(() => engine.snapshot().counts.completed === 3);
    assert.equal(chromeMock.store[PanelQueue.HISTORY_KEY].length, 3);
    await engine.handleMessage({ action: "panel.clear", which: "finished" });
    const again = await engine.handleMessage({ action: "panel.listPage", url: "https://rule34video.com/search/touhou/" });
    assert.equal(again.added, 0);
    assert.equal(again.alreadyDownloaded, 3);
    await engine.handleMessage({ action: "panel.history.reset" });
    const fresh = await engine.handleMessage({ action: "panel.listPage", url: "https://rule34video.com/search/touhou/" });
    assert.equal(fresh.added, 3);
  });

  it("restores its list, settings and history after a worker restart", async () => {
    const first = createEngine();
    await first.engine.handleMessage({ action: "panel.settings.set", settings: { concurrency: 3, quality: "480" } });
    await first.engine.handleMessage({ action: "panel.listPage", url: "https://rule34video.com/search/touhou/" });
    first.engine.flush();
    const second = createEngine({ storage: { ...first.chromeMock.store } });
    const snap = (await second.engine.handleMessage({ action: "panel.get" })).snapshot;
    assert.equal(snap.items.length, 3);
    assert.equal(snap.settings.concurrency, 3);
    assert.equal(snap.settings.quality, "480");
  });
});


describe("completed rows", () => {
  it("are not swept back in by Select all / Invert, but can be re-ticked and re-downloaded explicitly", async () => {
    const { engine, started } = createEngine({ autoComplete: true });
    await engine.handleMessage({ action: "panel.listPage", url: "https://rule34video.com/search/touhou/" });
    await engine.handleMessage({ action: "panel.start" });
    await waitFor(() => engine.snapshot().counts.completed === 3 && !engine.snapshot().running);
    await engine.handleMessage({ action: "panel.selectAll", selected: true });
    assert.equal(engine.snapshot().counts.selected, 0, "Select all leaves finished rows alone");
    await engine.handleMessage({ action: "panel.invert" });
    assert.equal(engine.snapshot().counts.selected, 0);
    // Explicit re-tick + download.
    await engine.handleMessage({ action: "panel.select", keys: ["video:110"], selected: true });
    assert.equal(engine.snapshot().counts.selected, 1);
    await engine.handleMessage({ action: "panel.start" });
    await waitFor(() => started.length === 4);
    assert.equal(started[3].videoInfo.id, "110");
    // The page corner button on an already-downloaded post downloads it again.
    const again = await engine.handleMessage({ action: "panel.add", items: [{ url: "https://rule34video.com/video/111/x/" }], start: true });
    assert.equal(again.duplicates, 1);
    await waitFor(() => started.length === 5);
  });
});
