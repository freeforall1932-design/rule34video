// background-enhanced.js
// Generated generic direct-video background adapter stub.
import './site-config.js';
import './logger.js';
import './background-bridge.js';
import './folder-naming.js';
import './site-routes.js';
import './panel-queue.js';

const SiteConfig = globalThis.SiteConfig || {};
const Bridge = globalThis.Rule34BackgroundBridge || {};
const Adapter = globalThis.Rule34SiteAdapter || {};
// Pure naming engine shared with the popup (extension/folder-naming.js).
const FolderNaming = globalThis.R34FolderNaming || {};
// URL router + listing parsers shared with the side panel and content scripts.
const Routes = globalThis.R34Routes || null;
// Side-panel queue engine factory (extension/panel-queue.js); instantiated
// further down once the resolvers and the download pipeline exist.
const PanelQueueFactory = globalThis.R34PanelQueue || null;
let panelQueue = null;
const logger = (globalThis.Logger && globalThis.Logger.createLogger("[Rule 34 BG]")) || { log() {}, warn() {}, error() {} };
const downloadProgress = new Map();
const observedMediaByTab = new Map();
const observedMediaByOrigin = new Map();
const observedCloudflareStreamTokens = new Map();
const observedMediaGlobalKey = "__global__";
const forceChromeHlsSegmentDownload = false;
const downloadMediaUrlRewriteRules = [];
const removeMediaUrlQueryParams = [];
const rangeRequestUrlPatterns = [];
let currentDownloadTabId = null;

// ---------------------------------------------------------------------------
// Download queue with a user-configurable concurrency limit.
// The limit lives in chrome.storage.local under DOWNLOAD_LIMIT_STORAGE_KEY.
// 0 (or unset) means unlimited. When the number of in-flight downloads
// reaches the limit, new requests are queued and dispatched automatically
// as soon as a running download finishes, fails, or is cancelled.
// ---------------------------------------------------------------------------
const DOWNLOAD_LIMIT_STORAGE_KEY = "downloadConcurrencyLimit";
const QUEUE_JOB_MAX_AGE_MS = 3 * 60 * 60 * 1000; // safety net for lost jobs
const QUEUE_STATE_STORAGE_KEY = "r34.queueState.v1"; // persisted session queue
const MAX_QUEUED_DOWNLOADS = 500;
const downloadQueue = [];
const activeQueueJobs = new Map(); // downloadId (or temp key) -> { startedAt, title, url }
const completedBeforeTracked = new Set();
const userCancelledDownloads = new Set(); // string downloadIds the user cancelled
const retriedInterruptedDownloads = new Set(); // string downloadIds already retried on fallback
const downloadRetryContext = new Map(); // string chrome downloadId -> { videoInfo, format }
// Batch pipeline state (see the batch section below). Declared here, next to
// the other queue state, because the queue helpers above (purge/persist/
// restore) reference `batchPending`.
const batchPending = [];
let queueJobSequence = 0;
let queuedIdSequence = 0;
let queuePumpRunning = false;
let queuePumpPending = false;
let queuePersistTimer = null;

async function getDownloadLimit() {
  try {
    const data = await chrome.storage.local.get([DOWNLOAD_LIMIT_STORAGE_KEY]);
    const value = Number(data?.[DOWNLOAD_LIMIT_STORAGE_KEY]);
    return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 99) : 0;
  } catch {
    return 0;
  }
}

function purgeStaleQueueJobs() {
  const now = Date.now();
  for (const [key, job] of activeQueueJobs) {
    if (now - (job?.startedAt || 0) > QUEUE_JOB_MAX_AGE_MS) activeQueueJobs.delete(key);
  }
  const before = downloadQueue.length;
  for (let index = downloadQueue.length - 1; index >= 0; index -= 1) {
    if (now - (downloadQueue[index]?.enqueuedAt || 0) > QUEUE_JOB_MAX_AGE_MS) downloadQueue.splice(index, 1);
  }
  const beforeBatch = batchPending.length;
  for (let index = batchPending.length - 1; index >= 0; index -= 1) {
    if (now - (batchPending[index]?.enqueuedAt || 0) > QUEUE_JOB_MAX_AGE_MS) batchPending.splice(index, 1);
  }
  if (downloadQueue.length !== before || batchPending.length !== beforeBatch) persistQueueState();
}

// ---------------------------------------------------------------------------
// Queue persistence.
// MV3 service workers are killed after ~30s of idle (and on extension
// reloads / updates / crashes), which would silently drop every waiting
// download and batch URL. The queue state is mirrored to chrome.storage.local
// on every mutation (debounced) and restored on service-worker startup, so a
// session queue survives the worker restarts. Jobs older than
// QUEUE_JOB_MAX_AGE_MS are dropped on restore (their signed links / state
// would be stale anyway).
// ---------------------------------------------------------------------------
function snapshotQueueState() {
  const now = Date.now();
  const queued = downloadQueue.map((job) => ({
    queuedId: job.queuedId,
    videoInfo: job.videoInfo,
    tabId: job.tabId,
    enqueuedAt: job.enqueuedAt || now,
  }));
  const batch = batchPending.map((job) => ({
    url: job.url,
    tabId: job.tabId,
    enqueuedAt: job.enqueuedAt || now,
  }));
  const active = [];
  for (const [key, job] of activeQueueJobs) {
    active.push({
      key: String(key),
      startedAt: job?.startedAt || now,
      title: job?.title || "",
      url: job?.url || "",
    });
  }
  return { queued, batch, active };
}

function persistQueueState() {
  if (queuePersistTimer) return;
  queuePersistTimer = setTimeout(() => {
    queuePersistTimer = null;
    flushQueueState();
  }, 250);
}

function flushQueueState() {
  if (queuePersistTimer) {
    clearTimeout(queuePersistTimer);
    queuePersistTimer = null;
  }
  try {
    const state = snapshotQueueState();
    if (!state.queued.length && !state.batch.length && !state.active.length) {
      chrome.storage.local.remove(QUEUE_STATE_STORAGE_KEY);
    } else {
      chrome.storage.local.set({ [QUEUE_STATE_STORAGE_KEY]: state });
    }
  } catch (error) {
    logger.warn("Failed to persist queue state", error);
  }
}

async function restoreQueueState() {
  let state = null;
  try {
    const data = await chrome.storage.local.get([QUEUE_STATE_STORAGE_KEY]);
    state = data?.[QUEUE_STATE_STORAGE_KEY];
  } catch {
    return;
  }
  if (!state) return;
  const now = Date.now();
  if (Array.isArray(state.queued)) {
    for (const job of state.queued) {
      if (!job || !job.queuedId || !job.videoInfo) continue;
      if (now - (job.enqueuedAt || 0) > QUEUE_JOB_MAX_AGE_MS) continue;
      if (downloadQueue.length >= MAX_QUEUED_DOWNLOADS) break;
      downloadQueue.push({
        queuedId: job.queuedId,
        videoInfo: job.videoInfo,
        tabId: job.tabId ?? null,
        enqueuedAt: job.enqueuedAt || now,
      });
    }
  }
  if (Array.isArray(state.batch)) {
    for (const job of state.batch) {
      if (!job || !job.url) continue;
      if (now - (job.enqueuedAt || 0) > QUEUE_JOB_MAX_AGE_MS) continue;
      if (batchPending.some((item) => item.url === job.url)) continue;
      batchPending.push({ url: job.url, tabId: job.tabId ?? null, enqueuedAt: job.enqueuedAt || now });
    }
  }
  if (Array.isArray(state.active)) {
    for (const item of state.active) {
      if (!item || !item.key) continue;
      if (now - (item.startedAt || 0) > QUEUE_JOB_MAX_AGE_MS) continue;
      const key = String(item.key);
      if (!/^\d+$/.test(key)) {
        // Temp key (`queue-job-N`): the worker died inside downloadVideo()
        // before a chrome download existed, so there is nothing to track or
        // complete. Restoring it would only block a concurrency slot for up
        // to QUEUE_JOB_MAX_AGE_MS — drop it. Everything still WAITING lives
        // in downloadQueue/batchPending and is re-pumped below.
        continue;
      }
      // Chrome-managed download: verify it is still alive before re-tracking.
      // NOTE: there is no `chrome.downloads.get()` in the extensions API — the
      // single-item lookup is `search({ id })`. The old call threw on every
      // restore, so *every* in-flight download was silently dropped from the
      // concurrency accounting after a service-worker restart.
      let alive = false;
      try {
        const [downloadItem] = (await chrome.downloads.search({ id: Number(key) })) || [];
        alive = downloadItem?.state === "in_progress";
      } catch {
        alive = false;
      }
      if (!alive) continue;
      activeQueueJobs.set(key, { startedAt: item.startedAt || now, title: item.title || "", url: item.url || "" });
    }
  }
  if (downloadQueue.length || batchPending.length || activeQueueJobs.size) {
    logger.log("Restored persisted download queue", {
      queued: downloadQueue.length,
      batch: batchPending.length,
      active: activeQueueJobs.size,
    });
    void pumpDownloadQueue();
    void processBatchQueue();
  }
}

// Best-effort sync right before the service worker is torn down.
try {
  chrome.runtime.onSuspend.addListener(() => {
    flushQueueState();
  });
} catch {}

function getQueueStatusSnapshot(limit) {
  purgeStaleQueueJobs();
  return {
    active: activeQueueJobs.size,
    queued: downloadQueue.length,
    limit: Number.isFinite(Number(limit)) ? Number(limit) : 0,
  };
}

function releaseQueueSlot(downloadId) {
  if (downloadId === undefined || downloadId === null) return;
  const removed = activeQueueJobs.delete(downloadId) || activeQueueJobs.delete(String(downloadId));
  if (!removed) {
    // Completion raced ahead of tracking; remember it briefly.
    completedBeforeTracked.add(String(downloadId));
    if (completedBeforeTracked.size > 50) {
      completedBeforeTracked.delete(completedBeforeTracked.values().next().value);
    }
    return;
  }
  persistQueueState();
  void pumpDownloadQueue();
}

function trackQueueJob(downloadId, job) {
  const key = String(downloadId);
  if (completedBeforeTracked.has(key)) {
    completedBeforeTracked.delete(key);
    void pumpDownloadQueue();
    return;
  }
  activeQueueJobs.set(downloadId, {
    startedAt: job?.startedAt || Date.now(),
    title: job?.title || "",
    url: job?.url || "",
  });
  persistQueueState();
}

// If dispatching a download fails, give rule34 post jobs one chance to
// re-resolve the post page / API and retry with fresh formats. This covers
// expired signed rule34video `get_file` links (queued batches can outlive
// them) and rule34.world hosts that were down at resolve time.
async function tryReResolveVideoInfo(videoInfo, error) {
  if (!videoInfo || Number(videoInfo.__retried || 0) >= 1) return null;
  const url = String(videoInfo.url || videoInfo.webpage_url || "");
  if (!rule34VideoPostId(url) && !rule34WorldPostId(url)) return null;
  try {
    const resolved = await resolveKnownPost(url);
    if (!resolved || !Array.isArray(resolved.formats) || !resolved.formats.length) return null;
    const best = resolved.formats[0];
    logger.log("Re-resolved post for download retry", { url, attempt: Number(videoInfo.__retried || 0) + 1 });
    return {
      ...videoInfo,
      id: resolved.id || videoInfo.id,
      title: resolved.title || videoInfo.title,
      thumbnail: resolved.thumbnail || videoInfo.thumbnail,
      duration: resolved.duration !== undefined ? resolved.duration : videoInfo.duration,
      selectedFormat: best,
      formats: resolved.formats,
      skipFormatRefresh: true,
      __retried: Number(videoInfo.__retried || 0) + 1,
    };
  } catch (resolveError) {
    logger.warn("Re-resolve before download retry failed", { url, error, resolveError });
    return null;
  }
}

async function runQueuedDownload(videoInfo, tabId) {
  const jobKey = `queue-job-${++queueJobSequence}`;
  activeQueueJobs.set(jobKey, { startedAt: Date.now(), title: videoInfo?.title || "", url: videoInfo?.url || "" });
  persistQueueState();
  let current = videoInfo;
  let result;
  try {
    if (tabId) currentDownloadTabId = tabId;
    let attempts = 0;
    for (;;) {
      try {
        result = await downloadVideo(current);
        break;
      } catch (error) {
        const reResolved = await tryReResolveVideoInfo(current, error);
        if (!reResolved || attempts >= 1) throw error;
        current = reResolved;
        attempts += 1;
      }
    }
  } catch (error) {
    activeQueueJobs.delete(jobKey);
    persistQueueState();
    void pumpDownloadQueue();
    throw error;
  }
  const job = activeQueueJobs.get(jobKey) || { startedAt: Date.now(), title: current?.title || "", url: current?.url || "" };
  activeQueueJobs.delete(jobKey);
  persistQueueState();
  const downloadId = result && result.downloadId;
  if (downloadId !== undefined && downloadId !== null) {
    trackQueueJob(downloadId, { ...job, title: current?.title || job.title, url: current?.url || job.url });
  } else {
    void pumpDownloadQueue();
  }
  return result;
}

async function queueDownloadRequest(videoInfo, options = {}) {
  purgeStaleQueueJobs();
  const limit = await getDownloadLimit();
  const tabId = currentDownloadTabId;
  if (limit > 0 && activeQueueJobs.size >= limit) {
    if (downloadQueue.length >= MAX_QUEUED_DOWNLOADS) {
      throw new Error(`Download queue is full (${MAX_QUEUED_DOWNLOADS} waiting). Raise the limit or wait for downloads to finish.`);
    }
    const queuedId = `queued-${Date.now()}-${++queuedIdSequence}`;
    downloadQueue.push({ queuedId, videoInfo, tabId, enqueuedAt: Date.now() });
    persistQueueState();
    const position = downloadQueue.length;
    // Batches already surface per-post toasts in the page; one browser
    // notification per queued item would be spam for large batches.
    if (!options.quiet) {
      const title = sanitizeFilename(videoInfo?.title || videoInfo?.id || "Video");
      notify(
        "Download queued",
        `"${title}" is #${position} in the queue. It will start automatically when a download slot frees up (limit: ${limit}).`,
      );
    }
    return {
      downloadId: queuedId,
      queued: true,
      queuePosition: position,
      activeDownloads: activeQueueJobs.size,
      limit,
    };
  }
  return runQueuedDownload(videoInfo, tabId);
}

async function pumpDownloadQueue() {
  if (queuePumpRunning) {
    queuePumpPending = true;
    return;
  }
  queuePumpRunning = true;
  try {
    do {
      queuePumpPending = false;
      purgeStaleQueueJobs();
      const limit = await getDownloadLimit();
      while (downloadQueue.length && (limit === 0 || activeQueueJobs.size < limit)) {
        const job = downloadQueue.shift();
        persistQueueState();
        try {
          const result = await runQueuedDownload(job.videoInfo, job.tabId);
          // A panel row that was parked under the temporary "queued-…" id now
          // follows the real download id so its completion is tracked.
          if (result?.downloadId !== undefined && result?.downloadId !== null) {
            panelQueue?.rebindDownload?.(job.queuedId, result.downloadId);
          } else {
            panelQueue?.notifyOutcome(job.queuedId, { ok: true });
          }
        } catch (error) {
          logger.error("Queued download failed", error);
          panelQueue?.notifyOutcome(job.queuedId, { ok: false, error: error?.message || "Queued download failed." });
          if (!job?.videoInfo?.__fromBatch) notify("Download failed", error?.message || "Queued download failed.");
        }
      }
    } while (queuePumpPending);
  } finally {
    queuePumpRunning = false;
  }
}

function removeQueuedDownload(queuedId) {
  const index = downloadQueue.findIndex((job) => job.queuedId === queuedId);
  if (index === -1) return false;
  downloadQueue.splice(index, 1);
  persistQueueState();
  return true;
}

// Remember which chrome download belongs to which resolved format so an
// interrupted download can be restarted on the format's fallback host.
function rememberDownloadRetryContext(downloadId, videoInfo, selectedFormat) {
  if (downloadId === undefined || downloadId === null) return;
  if (!selectedFormat?.fallbackUrl) return;
  const key = String(downloadId);
  downloadRetryContext.set(key, { videoInfo, format: selectedFormat });
  if (downloadRetryContext.size > 400) {
    downloadRetryContext.delete(downloadRetryContext.keys().next().value);
  }
}

// A chrome-managed download that was interrupted (HTTP 5xx, CDN outage, ...)
// is restarted once on the format's fallback host — but never for downloads
// the user cancelled themselves.
async function retryInterruptedDownload(delta) {
  const downloadId = delta && delta.id;
  if (downloadId === undefined || downloadId === null || typeof downloadId !== "number") return;
  const key = String(downloadId);
  if (userCancelledDownloads.has(key) || retriedInterruptedDownloads.has(key)) return;
  const context = downloadRetryContext.get(key);
  if (!context || !context.format?.fallbackUrl) return;
  retriedInterruptedDownloads.add(key);
  if (retriedInterruptedDownloads.size > 500) {
    retriedInterruptedDownloads.delete(retriedInterruptedDownloads.values().next().value);
  }
  downloadRetryContext.delete(key);
  logger.log("Retrying interrupted download on fallback host", { downloadId, url: context.format?.url });
  try {
    await chrome.downloads.cancel(downloadId);
  } catch {}
  const fallbackFormat = { ...context.format, url: context.format.fallbackUrl, fallbackUrl: "" };
  const videoInfo = { ...context.videoInfo, selectedFormat: fallbackFormat, skipFormatRefresh: true };
  const title = sanitizeFilename(videoInfo.title || videoInfo.id || "Video");
  try {
    const result = await queueDownloadRequest(videoInfo, { quiet: true });
    if (result?.downloadId !== undefined && result?.downloadId !== null) {
      panelQueue?.rebindDownload?.(downloadId, result.downloadId);
    } else {
      panelQueue?.notifyOutcome(downloadId, { ok: false, error: "Retry on the backup host could not start." });
    }
    notify(
      "Download restarted",
      `"${title}" restarted on the backup file host${result?.queued ? ` (queued #${result.queuePosition || "?"})` : ""}.`,
    );
  } catch (error) {
    logger.warn("Fallback download retry failed", error);
    panelQueue?.notifyOutcome(downloadId, { ok: false, error: error?.message || "Retry on the backup host failed." });
    notify("Download failed", error?.message || `Could not restart "${title}" on the backup file host.`);
  }
}

// Free a slot whenever a Chrome-managed download finishes or is interrupted.
try {
  chrome.downloads.onChanged.addListener((delta) => {
    if (!delta || !delta.state) return;
    const state = delta.state.current;
    if (state !== "complete" && state !== "interrupted") return;
    releaseQueueSlot(delta.id);
    if (state === "interrupted") {
      // A fallback-host retry re-enqueues the same panel item under a new
      // download id, so only report the failure when no retry is possible.
      const key = String(delta.id);
      const canRetry = Boolean(downloadRetryContext.get(key)?.format?.fallbackUrl)
        && !userCancelledDownloads.has(key)
        && !retriedInterruptedDownloads.has(key);
      if (!canRetry) panelQueue?.notifyOutcome(delta.id, { ok: false, error: describeInterrupt(delta) });
      void retryInterruptedDownload(delta);
    } else {
      panelQueue?.notifyOutcome(delta.id, { ok: true });
    }
  });
} catch {}

function describeInterrupt(delta) {
  const reason = String(delta?.error?.current || "").replace(/_/g, " ").toLowerCase();
  if (!reason) return "Download interrupted";
  if (reason.includes("user canceled")) return "Cancelled";
  return `Download interrupted (${reason})`;
}

// Re-pump when the user changes the limit from the popup.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[DOWNLOAD_LIMIT_STORAGE_KEY]) void pumpDownloadQueue();
  });
} catch {}

// ---------------------------------------------------------------------------
// Site-specific post resolvers (rule34video.com + rule34.world).
// Used by the popup format list, the per-card corner buttons, and batch mode.
// ---------------------------------------------------------------------------
const WORLD_CDN_ROOT = "https://rule34storage.b-cdn.net";
const WORLD_ROOT = "https://rule34.world";
// rule34.world file format ids -> [extension, label, kind, preview] (best
// first). Taken from the site's own file-type table (the SPA's
// `typesStr`, session 10): 100 is the source the site's Download button uses,
// 111-114 are the 360/480/720/1080 ladders, and 101/102 are the 256px grid
// previews — kept last, flagged, so they are only ever offered when a post
// has nothing else (the queue never picks a preview over a real file).
const WORLD_FORMATS = [
  ["100", "mov.mp4", "Source MP4", "mp4", false],
  ["114", "1080.mp4", "1080p", "mp4", false],
  ["113", "mov720.mp4", "720p", "mp4", false],
  ["112", "mov480.mp4", "480p", "mp4", false],
  ["111", "360.mp4", "360p", "mp4", false],
  ["101", "mov256.mp4", "256p preview", "mp4", true],
  ["102", "mov256ex.mp4", "256p preview", "mp4", true],
  ["10", "pic.jpg", "Image", "image", false],
];
// The rule34.world post API reports, per file, whether it lives on the
// BunnyCDN root or the site origin. In practice the CDN has been observed
// failing wholesale (HTTP 500) while the origin keeps serving, so we probe
// both roots once per session (cheap HEAD/RANGE on one real file) and build
// format URLs on the healthy root. Every format also carries a fallbackUrl
// on the other root so a failed download can be retried there.
const WORLD_HOST_PROBE_TTL_MS = 10 * 60 * 1000;
// When BOTH roots fail the probe we treat it as a likely transient outage and
// re-probe after 60s instead of pinning "both dead" for the full TTL.
const WORLD_HOST_PROBE_FAIL_TTL_MS = 60 * 1000;
let worldHostProbe = null; // { cdnOk, originOk, checkedAt }

async function probeMediaUrl(url) {
  const attempt = async (method, headers, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method, headers, cache: "no-store", signal: controller.signal });
      const ok = response.status >= 200 && response.status < 400;
      if (ok && response.body) {
        try { await response.body.cancel(); } catch {}
      }
      return ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
  if (await attempt("HEAD", {}, 6000)) return true;
  return attempt("GET", { Range: "bytes=0-0" }, 8000);
}

async function getWorldHostStatus(samplePath) {
  const ttl = worldHostProbe && !worldHostProbe.cdnOk && !worldHostProbe.originOk
    ? WORLD_HOST_PROBE_FAIL_TTL_MS
    : WORLD_HOST_PROBE_TTL_MS;
  if (worldHostProbe && Date.now() - worldHostProbe.checkedAt < ttl) return worldHostProbe;
  const [cdnOk, originOk] = await Promise.all([
    probeMediaUrl(WORLD_CDN_ROOT + samplePath),
    probeMediaUrl(WORLD_ROOT + samplePath),
  ]);
  if (!cdnOk && !originOk) {
    logger.warn("rule34.world host probe: BOTH file hosts unreachable", { samplePath, cdnOk, originOk });
  }
  worldHostProbe = { cdnOk, originOk, checkedAt: Date.now() };
  return worldHostProbe;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function rule34VideoPostId(url) {
  const match = String(url || "").match(/^https?:\/\/(?:www\.)?rule34video\.com\/(?:video|popup-video)\/(\d+)/i);
  return match ? match[1] : "";
}

function rule34WorldPostId(url) {
  const match = String(url || "").match(/^https?:\/\/(?:www\.)?rule34\.world\/post\/(\d+)/i);
  return match ? match[1] : "";
}

function heightFromLabel(label) {
  const match = String(label || "").match(/(\d{3,4})/);
  return match ? parseInt(match[1], 10) : 0;
}

// rule34video.com post pages list their tags (and the uploader) as plain
// anchors, so the popup can offer one checkbox per tag without a second
// request. Best effort: a markup change only costs the tag list, never the
// download.
const MAX_COLLECTED_TAGS = 60;

function collectRule34VideoTags(html) {
  const tags = [];
  const pattern = /<a[^>]+href=["']https?:\/\/(?:www\.)?rule34video\.com\/tags\/\d+\/?["'][^>]*>([\s\S]{1,160}?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const name = decodeHtmlEntities(String(match[1] || "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (!tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) tags.push(name);
    if (tags.length >= MAX_COLLECTED_TAGS) break;
  }
  return tags;
}

function collectRule34VideoUploader(html) {
  const match = html.match(/<a[^>]+href=["']https?:\/\/(?:www\.)?rule34video\.com\/(?:models|channels)\/([^"'/?#]+)\/?["'][^>]*>([\s\S]{1,160}?)<\/a>/i);
  if (!match) return "";
  const text = decodeHtmlEntities(String(match[2] || "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  if (text) return text;
  try {
    return decodeURIComponent(match[1]).replace(/[-_]+/g, " ").trim();
  } catch {
    return String(match[1] || "").replace(/[-_]+/g, " ").trim();
  }
}

function collectRule34VideoDate(html) {
  const match = html.match(/<time[^>]+datetime=["']([0-9]{4}-[0-9]{2}-[0-9]{2})/i)
    || html.match(/["'](?:datePublished|uploadDate)["']\s*:\s*["']([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  return match ? match[1] : "";
}

// rule34video.com answers 404 for slug-less `/video/{id}/` URLs but redirects
// any slug to the real one (verified 2026-09-03), so pad missing slugs with
// the id before fetching.
function padRule34VideoSlug(url) {
  return String(url || "").replace(
    /^(https?:\/\/(?:www\.)?rule34video\.com\/(?:video|popup-video)\/(\d+))\/?(?:[?#].*)?$/i,
    "$1/$2/",
  );
}

async function resolveRule34VideoPost(pageUrl) {
  pageUrl = padRule34VideoSlug(pageUrl);
  const response = await fetch(pageUrl, {
    credentials: "include",
    headers: { Accept: "text/html,application/xhtml+xml,*/*" },
  });
  if (!response.ok) throw new Error(`Post page fetch failed (${response.status})`);
  const html = await response.text();

  const title = decodeHtmlEntities(
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ||
    html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1] ||
    html.match(/<title>([^<]+)<\/title>/i)?.[1] ||
    ""
  ).replace(/\s*-\s*Rule ?34.*$/i, "").trim();

  const thumbnail = decodeHtmlEntities(
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] || ""
  );

  const seen = new Set();
  const formats = [];
  const push = (rawUrl, label) => {
    const url = decodeHtmlEntities(rawUrl);
    if (!url || seen.has(url) || /_preview\.mp4/i.test(url)) return;
    seen.add(url);
    formats.push({
      url,
      quality: label,
      label,
      height: heightFromLabel(label),
      ext: "mp4",
      format_type: "mp4",
      protocol: "https",
      source: "rule34video-download-tab",
    });
  };

  // Preferred: explicit download-tab links (carry download_filename).
  const downloadLinkPattern = /https?:\/\/[^"'\s<>]+\/get_file\/[^"'\s<>]*?_(\d{3,4})p?\.mp4\/?\?[^"'\s<>]*download=true[^"'\s<>]*/gi;
  for (const match of html.matchAll(downloadLinkPattern)) {
    push(match[0], `${match[1]}p`);
  }
  // Fallback: any signed get_file mp4 (player sources).
  if (!formats.length) {
    const anyPattern = /https?:\/\/[^"'\s<>]+\/get_file\/[^"'\s<>]*?(?:_(\d{3,4})p?)?\.mp4\/?(?:\?[^"'\s<>]*)?/gi;
    for (const match of html.matchAll(anyPattern)) {
      push(match[0], match[1] ? `${match[1]}p` : "MP4");
    }
  }
  formats.sort((a, b) => (b.height || 0) - (a.height || 0));
  if (!formats.length) throw new Error("No downloadable files found on the post page.");
  return {
    id: rule34VideoPostId(pageUrl) || undefined,
    title: title || `rule34video-${rule34VideoPostId(pageUrl) || Date.now()}`,
    thumbnail,
    url: pageUrl,
    formats,
    // Metadata for the collection-folder naming engine (tag checkboxes,
    // {uploader}, {date} tokens).
    tags: collectRule34VideoTags(html),
    uploader: collectRule34VideoUploader(html),
    date: collectRule34VideoDate(html),
  };
}

async function resolveRule34WorldPost(postId, pageUrl) {
  const response = await fetch(`${WORLD_ROOT}/api/v2/post/${postId}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`rule34.world API failed (${response.status})`);
  const post = await response.json();
  const files = post?.files || {};
  const idNumber = Number(postId);
  const directory = Math.floor(idNumber / 1000);

  const entries = [];
  for (const [formatId, extension, label, kind, preview] of WORLD_FORMATS) {
    if (!(formatId in files)) continue;
    const flags = files[formatId];
    const useCdn = Array.isArray(flags) ? Boolean(flags[0]) : Boolean(flags);
    entries.push({ extension, label, kind, useCdn, preview });
  }
  if (!entries.length) throw new Error("No downloadable files listed for this post.");

  // Probe both file hosts once per session (sampled on the first real file)
  // and prefer the healthy one over whatever the API flag claims.
  const samplePath = `/posts/${directory}/${idNumber}/${postId}.${entries[0].extension}`;
  const hostStatus = await getWorldHostStatus(samplePath);
  const pickRoots = (useCdn) => {
    const preferred = useCdn ? WORLD_CDN_ROOT : WORLD_ROOT;
    const preferredOk = preferred === WORLD_CDN_ROOT ? hostStatus.cdnOk : hostStatus.originOk;
    const other = preferred === WORLD_CDN_ROOT ? WORLD_ROOT : WORLD_CDN_ROOT;
    const otherOk = preferred === WORLD_CDN_ROOT ? hostStatus.originOk : hostStatus.cdnOk;
    if (preferredOk || (!preferredOk && !otherOk)) {
      return { root: preferred, altRoot: otherOk ? other : "" };
    }
    return { root: other, altRoot: preferredOk ? preferred : "" };
  };

  const formats = entries.map(({ extension, label, kind, useCdn, preview }) => {
    const { root, altRoot } = pickRoots(useCdn);
    const format = {
      url: `${root}/posts/${directory}/${idNumber}/${idNumber}.${extension}`,
      quality: label,
      label,
      height: heightFromLabel(label),
      ext: extension.split(".").pop(),
      format_type: kind === "image" ? "image" : "mp4",
      protocol: "https",
      source: "rule34world-api",
    };
    if (preview) format.preview = true;
    if (altRoot) format.fallbackUrl = `${altRoot}/posts/${directory}/${idNumber}/${idNumber}.${extension}`;
    return format;
  });

  const tagList = Array.isArray(post?.tags) ? post.tags : [];
  const artist = tagList.find((tag) => tag && tag.type === 8)?.value || "";
  const baseName = String(post?.filename || "").replace(/\.[a-z0-9]+$/i, "");
  const title = [artist, baseName || `post ${postId}`].filter(Boolean).join(" - ");
  const tags = tagList
    .map((tag) => String(tag?.value || tag?.name || "").trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, MAX_COLLECTED_TAGS);
  return {
    id: String(postId),
    title: title || `rule34world-${postId}`,
    artist,
    thumbnail: `${WORLD_CDN_ROOT}/posts/${directory}/${idNumber}/${idNumber}.pic256.jpg`,
    duration: Number(post?.duration) || undefined,
    url: pageUrl || `${WORLD_ROOT}/post/${postId}`,
    formats,
    tags,
    date: String(post?.created || "").slice(0, 10),
  };
}

async function resolveKnownPost(url) {
  const videoId = rule34VideoPostId(url);
  if (videoId) return resolveRule34VideoPost(url);
  const worldId = rule34WorldPostId(url);
  if (worldId) return resolveRule34WorldPost(worldId, url);
  return null;
}

// rule34video.com tag search (different site/API than rule34.world). The listing
// search page is `https://rule34video.com/search/<query>/`; we scrape the post
// card links (`/video/{id}/...`) from the returned HTML. Single page for now —
// the batch engine caps at BATCH_MAX_URLS and resolves each post individually.
async function searchRule34VideoTag({ tags, maxUrls = BATCH_MAX_URLS } = {}) {
  const query = String(tags || "").trim();
  if (!query) return [];
  const url = `https://rule34video.com/search/${encodeURIComponent(query)}/`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "text/html,application/xhtml+xml,*/*" },
  });
  if (!response.ok) throw new Error(`rule34video.com search failed (${response.status})`);
  const html = await response.text();
  const ids = new Set();
  const pattern = /https?:\/\/(?:www\.)?rule34video\.com\/video\/(\d+)/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    if (ids.size >= maxUrls) break;
    ids.add(match[1]);
  }
  return Array.from(ids).map((id) => `https://rule34video.com/video/${id}/${id}/`);
}

// rule34.world cursor-paginated search (confirmed from the gallery-dl
// rule34xyz extractor). Used by the "bulk download by tag / playlist" feature.
async function searchRule34WorldPosts({ tags, playlistId, maxUrls = BATCH_MAX_URLS } = {}) {
  const tagged = Array.isArray(tags)
    ? tags.filter(Boolean)
    : String(tags || "").split(/[,+]/).map((t) => t.trim()).filter(Boolean);
  const urls = [];
  let cursor = null;
  for (let page = 0; page < 50 && urls.length < maxUrls; page += 1) {
    const isPlaylist = Boolean(playlistId);
    const endpoint = isPlaylist
      ? `${WORLD_ROOT}/v2/post/search/playlist/${encodeURIComponent(playlistId)}`
      : `${WORLD_ROOT}/api/v2/post/search/root`;
    const body = isPlaylist
      ? { Skip: page * 60, take: 60, CountTotal: false, IncludeLinks: true, OrderBy: 0 }
      : { includeTags: tagged, Skip: page * 60, take: 60, CountTotal: false, IncludeLinks: true, OrderBy: 0, cursor: cursor || undefined };
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`rule34.world search failed (${response.status})`);
    const data = await response.json();
    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
    if (!items.length) break;
    for (const item of items) {
      const id = item && (item.id || item.postId || item.post_id);
      if (id && urls.length < maxUrls) urls.push(`${WORLD_ROOT}/post/${id}`);
    }
    const nextCursor = data?.cursor;
    if (nextCursor) cursor = nextCursor;
    if (items.length < 60 && !nextCursor) break;
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Batch downloads: resolve each post and push it through the download queue.
// Responds immediately, then streams per-post status back to the tab.
// ---------------------------------------------------------------------------
const BATCH_MAX_URLS = 300;
const BATCH_RESOLVE_CONCURRENCY = 5;
let batchRunning = false;

function sendBatchStatus(tabId, payload) {
  if (!tabId) return;
  try {
    chrome.tabs.sendMessage(tabId, { action: "batchPostStatus", ...payload }, () => {
      void chrome.runtime.lastError; // tab may be gone; ignore
    });
  } catch {}
}

async function processBatchJob(job) {
  try {
    const resolved = await resolveKnownPost(job.url);
    if (!resolved) throw new Error("Unsupported post URL.");
    const best = resolved.formats[0];
    if (job.tabId) currentDownloadTabId = job.tabId;
    const result = await queueDownloadRequest(
      {
        id: resolved.id,
        title: resolved.title,
        url: resolved.url,
        thumbnail: resolved.thumbnail,
        duration: resolved.duration,
        // Carry the resolver's metadata through to the naming engine so a
        // batch / corner-button download lands in the SAME folder as a popup
        // download of the same post. Without this the {artist}, {uploader} and
        // {date} tokens were empty for every batch item (the folder then fell
        // back to a bare title + id), splitting one post across two
        // differently-named folders depending on how it was enqueued.
        // Note: {tags} is NOT filled here — it is the user's checked page tags
        // (popup __output.tags, or the per-URL stored choice read by
        // resolveOutputChoice), and would diverge from that if auto-filled with
        // every resolver tag.
        artist: resolved.artist || "",
        uploader: resolved.uploader || "",
        date: resolved.date || "",
        selectedFormat: best,
        formats: resolved.formats,
        skipFormatRefresh: true,
        __fromBatch: true,
      },
      { quiet: true },
    );
    sendBatchStatus(job.tabId, {
      url: job.url,
      ok: true,
      queued: Boolean(result?.queued),
      queuePosition: result?.queuePosition || 0,
      downloadId: result?.downloadId,
      title: resolved.title,
    });
  } catch (error) {
    logger.warn("Batch item failed", job.url, error);
    sendBatchStatus(job.tabId, {
      url: job.url,
      ok: false,
      error: error?.message || "Failed to resolve post.",
    });
  }
}

async function processBatchQueue() {
  if (batchRunning) return;
  batchRunning = true;
  try {
    while (batchPending.length) {
      const chunk = batchPending.splice(0, BATCH_RESOLVE_CONCURRENCY);
      persistQueueState();
      // Resolve several posts in parallel (the per-download concurrency
      // limit still applies inside queueDownloadRequest).
      await Promise.all(chunk.map((job) => processBatchJob(job)));
    }
  } finally {
    batchRunning = false;
  }
}

function enqueueBatchDownloads(urls, tabId) {
  const accepted = [];
  let skipped = 0;
  // Posts already waiting (batch-resolving, queued, or actively downloading)
  // are not enqueued again when the user clicks "Download visible" twice.
  const waitingUrls = new Set(
    [
      ...downloadQueue.map((job) => String(job?.videoInfo?.url || "")),
      ...Array.from(activeQueueJobs.values()).map((job) => String(job?.url || "")),
    ].filter(Boolean),
  );
  for (const raw of Array.isArray(urls) ? urls : []) {
    const url = String(raw || "").trim();
    if (!url || accepted.length >= BATCH_MAX_URLS) break;
    if (!rule34VideoPostId(url) && !rule34WorldPostId(url)) continue;
    if (batchPending.some((job) => job.url === url) || waitingUrls.has(url)) {
      skipped += 1;
      continue;
    }
    batchPending.push({ url, tabId, enqueuedAt: Date.now() });
    accepted.push(url);
  }
  if (accepted.length) {
    persistQueueState();
    void processBatchQueue();
  }
  return { accepted, skipped };
}

function sanitizeFilename(value) {
  return Bridge.sanitizeFilename ? Bridge.sanitizeFilename(value || "video") : String(value || "video").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().slice(0, 200);
}

// --- Output organization: master folder + site + collection ----------------
// Every download lands in `Downloads/<Root>/<Site>/<Collection>/<file>`:
//   <Root>       chrome.storage.sync "masterFolder", default "R34V". The EMPTY
//                STRING is meaningful — it disables the master folder and
//                restores the flat layout — so it is stored verbatim and every
//                read goes through normalizeMasterFolder.
//   <Site>       derived automatically from the post URL's hostname (the source
//                map lives in folder-naming.js); never user input.
//   <Collection> the tag/artist folder: manual text > filled template >
//                search query > post id.
// The whole thing is one RELATIVE subpath for chrome.downloads.download, which
// creates the folders inside the fixed download location without prompts.
const OUTPUT_STORAGE_KEYS = {
  masterFolder: FolderNaming.DEFAULT_MASTER_FOLDER || "R34V",
  collectionTemplate: FolderNaming.DEFAULT_COLLECTION_TEMPLATE || "{artist} - {title} - {id}",
  artistFolderMode: false,
  pictureSaveMode: "loose", // loose | zip | cbz | pdf
  duplicateBehaviour: "uniquify", // uniquify | overwrite
};
// Per-post "manual name / checked tags" choices from the popup, remembered so
// the in-page corner button and the context menu land in the same folder as
// the popup download for that post.
const OUTPUT_CHOICE_STORAGE_KEY = "r34.outputChoice.v1";
const OUTPUT_CHOICE_MAX_ENTRIES = 100;

function outputStorageArea() {
  try {
    return chrome.storage?.sync || chrome.storage?.local || null;
  } catch {
    return null;
  }
}

async function getOutputSettings() {
  const area = outputStorageArea();
  if (!area || typeof area.get !== "function") return { ...OUTPUT_STORAGE_KEYS };
  return await new Promise((resolve) => {
    try {
      const callback = (data) => {
        const stored = data || {};
        resolve({
          // normalizeMasterFolder keeps undefined -> default and "" -> off.
          masterFolder: FolderNaming.normalizeMasterFolder(stored.masterFolder),
          // An empty string is a real value here: the user unchecked every
          // token, so the folder name falls through to search / post id. Only
          // an absent setting gets the default template.
          collectionTemplate: typeof stored.collectionTemplate === "string"
            ? stored.collectionTemplate
            : OUTPUT_STORAGE_KEYS.collectionTemplate,
          artistFolderMode: Boolean(stored.artistFolderMode),
          pictureSaveMode: ["loose", "zip", "cbz", "pdf"].includes(String(stored.pictureSaveMode))
            ? String(stored.pictureSaveMode)
            : OUTPUT_STORAGE_KEYS.pictureSaveMode,
          duplicateBehaviour: stored.duplicateBehaviour === "overwrite" ? "overwrite" : "uniquify",
        });
      };
      const maybePromise = area.get({ ...OUTPUT_STORAGE_KEYS }, callback);
      if (maybePromise && typeof maybePromise.then === "function") maybePromise.then(callback, () => resolve({ ...OUTPUT_STORAGE_KEYS }));
    } catch {
      resolve({ ...OUTPUT_STORAGE_KEYS });
    }
  });
}

async function readStoredOutputChoices() {
  try {
    const data = await chrome.storage.local.get([OUTPUT_CHOICE_STORAGE_KEY]);
    const stored = data && data[OUTPUT_CHOICE_STORAGE_KEY];
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

async function rememberOutputChoice(postUrl, choice) {
  const key = String(postUrl || "").trim();
  if (!key) return;
  try {
    const all = await readStoredOutputChoices();
    all[key] = {
      manual: String(choice?.manual || "").trim(),
      tags: Array.isArray(choice?.tags) ? choice.tags.filter(Boolean).map(String) : [],
      at: Date.now(),
    };
    const entries = Object.entries(all);
    if (entries.length > OUTPUT_CHOICE_MAX_ENTRIES) {
      entries.sort((a, b) => (a[1]?.at || 0) - (b[1]?.at || 0));
      for (const [oldKey] of entries.slice(0, entries.length - OUTPUT_CHOICE_MAX_ENTRIES)) delete all[oldKey];
    }
    await chrome.storage.local.set({ [OUTPUT_CHOICE_STORAGE_KEY]: all });
  } catch {}
}

// The manual name / checked tags for this post: whatever the popup sent with
// the request wins, otherwise the remembered choice for the same post URL.
async function resolveOutputChoice(videoInfo = {}) {
  const explicit = videoInfo.__output;
  if (explicit && typeof explicit === "object") {
    return {
      manual: String(explicit.manual || "").trim(),
      tags: Array.isArray(explicit.tags) ? explicit.tags.filter(Boolean).map(String) : [],
      useSearchQuery: Boolean(explicit.useSearchQuery),
      explicit: true,
    };
  }
  const stored = (await readStoredOutputChoices())[String(videoInfo.url || videoInfo.webpage_url || "")] || null;
  return {
    manual: String(stored?.manual || "").trim(),
    tags: Array.isArray(stored?.tags) ? stored.tags.filter(Boolean).map(String) : [],
    // Batch / corner-button downloads (which carry __fromBatch) start from a
    // search / tag / playlist results page, so the query is offered as a
    // folder-name candidate. It only ever wins when the template produces
    // nothing (searchContextForVideoInfo yields "" otherwise), so an explicit
    // template is never overridden and a stored manual choice is not clobbered.
    useSearchQuery: Boolean(videoInfo.__fromBatch),
    explicit: false,
  };
}

// Metadata the template tokens are filled from.
function postNamingContext(videoInfo = {}, site = "") {
  const pageUrl = String(videoInfo.url || videoInfo.webpage_url || videoInfo.pageUrl || "");
  const title = String(videoInfo.title || "").trim();
  const uploader = String(videoInfo.uploader || videoInfo.owner || videoInfo.channel || "").trim();
  return {
    site,
    // rule34video.com has no separate "artist" field: its model/channel is the
    // creator, so {artist} falls back to it (same chain the artist-folder mode
    // documents: artist -> uploader -> id -> untagged).
    artist: String(videoInfo.artist || "").trim() || uploader,
    uploader,
    title,
    text: title,
    id: String(videoInfo.id || rule34VideoPostId(pageUrl) || rule34WorldPostId(pageUrl) || "").trim(),
    date: String(videoInfo.date || videoInfo.upload_date || "").trim(),
  };
}

// The search/tag-results query this download started from, when there is one.
async function searchContextForVideoInfo(videoInfo = {}, tabId = null) {
  const explicit = String(videoInfo.__searchContext || "").trim();
  if (explicit) return explicit;
  const fromPage = FolderNaming.searchContextFromUrl?.(videoInfo.url || videoInfo.webpage_url || "") || "";
  if (fromPage) return fromPage;
  const id = Number(tabId ?? currentDownloadTabId);
  if (!Number.isFinite(id) || id <= 0) return "";
  try {
    const tab = await new Promise((resolve) => {
      chrome.tabs.get(id, (result) => resolve(chrome.runtime.lastError ? null : result));
    });
    return FolderNaming.searchContextFromUrl?.(tab?.url || "") || "";
  } catch {
    return "";
  }
}

// Build the relative subpath (folders + file name) for one artifact.
async function resolveOutputTarget(videoInfo = {}, ext = "", options = {}) {
  const settings = options.settings || (await getOutputSettings());
  const pageUrl = String(videoInfo.url || videoInfo.webpage_url || videoInfo.pageUrl || "");
  const site = FolderNaming.siteSlugForUrl?.(pageUrl) || "unknown-site";
  const choice = options.choice || (await resolveOutputChoice(videoInfo));
  const searchContext = options.useSearchQuery === false
    ? ""
    : (choice.useSearchQuery ? await searchContextForVideoInfo(videoInfo, options.tabId) : "");
  const context = postNamingContext(videoInfo, site);
  const relative = FolderNaming.buildRelativePath?.({
    masterFolder: settings.masterFolder,
    site,
    template: settings.collectionTemplate,
    artistFolderMode: settings.artistFolderMode,
    manual: choice.manual,
    checkedTags: options.checkedTags || choice.tags,
    searchContext,
    context,
    fallbackId: context.id,
    basename: options.basename || context.title || context.id,
    ext,
  });
  const full = FolderNaming.safeRelativePath?.(relative || "", context.id || "download")
    || `${context.id || "download"}.${ext || "mp4"}`;
  const split = full.lastIndexOf("/");
  return {
    settings,
    site,
    context,
    choice,
    searchContext,
    directory: split > 0 ? full.slice(0, split) : "",
    fileName: split > 0 ? full.slice(split + 1) : full,
    full,
    ext,
  };
}

// ---------------------------------------------------------------------------
// Filename authority: chrome.downloads.download's `filename` is a request, not
// a command — a server Content-Disposition can override it, blob: URLs are
// saved under the blob's UUID on some builds, and another extension holding an
// onDeterminingFilename listener can silently steal the name (crbug 579563).
// Every artifact this extension starts is registered here and re-suggested
// when Chrome asks, so the requested <Root>/<Site>/<Collection>/<file> path is
// what actually lands on disk.
//
// IMPORTANT (naming leak / cross-extension clash):
// Chrome treats ANY registered onDeterminingFilename listener as a participant
// in EVERY download's naming, even when the listener does nothing and returns
// (crbug 579563). That surfaces as:
//   "This extension failed to name the download X because another extension
//    (Downloader for Rule 34) determined a different filename """
// when the user downloads from nhentai / elsewhere while this extension is
// loaded. Fix: the listener is LAZY — installed only while we have pending
// overrides for downloads WE started, and removed the moment the map is empty.
// Outside rule34 work the extension does not touch download filenames at all.
// ---------------------------------------------------------------------------
const downloadFilenameOverrides = new Map(); // url | "id:<n>" -> { filename, conflictAction, at }
const FILENAME_OVERRIDE_TTL_MS = 10 * 60 * 1000;
let filenameGuardInstalled = false;

function purgeExpiredFilenameOverrides(now = Date.now()) {
  for (const [entryKey, entry] of downloadFilenameOverrides) {
    if (now - (entry?.at || 0) > FILENAME_OVERRIDE_TTL_MS) downloadFilenameOverrides.delete(entryKey);
  }
}

function syncFilenameGuardListener() {
  purgeExpiredFilenameOverrides();
  const shouldListen = downloadFilenameOverrides.size > 0;
  if (shouldListen === filenameGuardInstalled) return;
  try {
    if (shouldListen) {
      chrome.downloads.onDeterminingFilename.addListener(onDeterminingFilenameGuard);
      filenameGuardInstalled = true;
    } else {
      chrome.downloads.onDeterminingFilename.removeListener(onDeterminingFilenameGuard);
      filenameGuardInstalled = false;
    }
  } catch (error) {
    filenameGuardInstalled = false;
    logger.warn("Could not sync the filename guard listener", error);
  }
}

function rememberDownloadFilename(url, filename, conflictAction = "uniquify") {
  const key = String(url || "");
  const name = String(filename || "").trim();
  // Never register an empty path — Chrome ignores empty suggestions and other
  // extensions then report us as having "determined" filename "".
  if (!key || !name) return;
  purgeExpiredFilenameOverrides();
  downloadFilenameOverrides.set(key, { filename: name, conflictAction, at: Date.now() });
  syncFilenameGuardListener();
}

function rememberDownloadFilenameById(downloadId, filename, conflictAction = "uniquify", url = "") {
  if (downloadId === undefined || downloadId === null) return;
  const name = String(filename || "").trim();
  if (!name) return;
  purgeExpiredFilenameOverrides();
  downloadFilenameOverrides.set(`id:${downloadId}`, {
    filename: name,
    conflictAction,
    at: Date.now(),
    url: String(url || ""),
  });
  syncFilenameGuardListener();
}

function forgetDownloadFilename(url) {
  if (url !== undefined && url !== null && String(url) !== "") {
    downloadFilenameOverrides.delete(String(url));
  }
  syncFilenameGuardListener();
}

function forgetDownloadFilenameById(downloadId) {
  if (downloadId === undefined || downloadId === null) return;
  const key = `id:${downloadId}`;
  const entry = downloadFilenameOverrides.get(key);
  // Drop the paired URL key too so the lazy guard can detach as soon as the
  // chrome download finishes (even if onDeterminingFilename never fired).
  if (entry?.url) downloadFilenameOverrides.delete(String(entry.url));
  downloadFilenameOverrides.delete(key);
  syncFilenameGuardListener();
}

function filenameOverrideFor(item = {}) {
  if (item?.id !== undefined && item?.id !== null) {
    const byId = downloadFilenameOverrides.get(`id:${item.id}`);
    if (byId) return byId;
  }
  return downloadFilenameOverrides.get(String(item?.finalUrl || ""))
    || downloadFilenameOverrides.get(String(item?.url || ""))
    || null;
}

function onDeterminingFilenameGuard(item, suggest) {
  const override = filenameOverrideFor(item);
  // Only ever claim downloads we started. Foreign downloads must not be
  // renamed (and we should not be listening at all when the override map is
  // empty — see syncFilenameGuardListener). While we ARE listening because of
  // an in-flight rule34 download, still refuse to touch anything else: call
  // suggest() with no args so Chrome keeps the other extension's / the
  // browser's name, and never pass an empty filename.
  if (!override || !override.filename) {
    try { suggest(); } catch {}
    return;
  }
  try {
    suggest({ filename: override.filename, conflictAction: override.conflictAction || "uniquify" });
  } catch {
    try { suggest(); } catch {}
  }
  // The name has been applied; drop every entry that pointed at this download
  // (url key and/or id key, and any id entry that recorded the same url) so
  // the lazy listener can detach once nothing is left.
  const urlsToDrop = new Set(
    [item?.finalUrl, item?.url, override.url].map((value) => String(value || "")).filter(Boolean),
  );
  if (item?.id !== undefined && item?.id !== null) {
    downloadFilenameOverrides.delete(`id:${item.id}`);
  }
  for (const [entryKey, entry] of downloadFilenameOverrides) {
    if (urlsToDrop.has(entryKey)) {
      downloadFilenameOverrides.delete(entryKey);
      continue;
    }
    if (entryKey.startsWith("id:") && entry?.url && urlsToDrop.has(String(entry.url))) {
      downloadFilenameOverrides.delete(entryKey);
    }
  }
  syncFilenameGuardListener();
}

// Drop override entries once a chrome-managed download finishes so the guard
// listener detaches promptly (and other downloaders stop clashing with us).
try {
  chrome.downloads.onChanged.addListener((delta) => {
    if (!delta || !delta.state) return;
    const state = delta.state.current;
    if (state !== "complete" && state !== "interrupted") return;
    forgetDownloadFilenameById(delta.id);
  });
} catch {}

// Blob artifacts (ZIP/CBZ/PDF) are built in the offscreen document, which only
// has chrome.runtime — it relays the blob URL here and this side hands it to
// the download manager with the full relative path.
function saveBlobArtifact({ blobUrl, filename, conflictAction = "uniquify" }) {
  return new Promise((resolve) => {
    const url = String(blobUrl || "");
    const name = String(filename || "").trim();
    if (!url) {
      resolve({ success: false, error: "No blob URL to save." });
      return;
    }
    if (!name) {
      resolve({ success: false, error: "No filename to save." });
      return;
    }
    rememberDownloadFilename(url, name, conflictAction);
    try {
      chrome.downloads.download({ url, filename: name, saveAs: false, conflictAction }, (downloadId) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError || downloadId === undefined) {
          forgetDownloadFilename(url);
          resolve({ success: false, error: lastError?.message || "Chrome download did not start." });
          return;
        }
        // Prefer id-keyed lookup: blob: finalUrl can differ from the url we
        // registered. Keep the URL entry until the guard fires / the download
        // completes, and add the id so either key wins the race.
        rememberDownloadFilenameById(downloadId, name, conflictAction, url);
        downloadProgress.set(downloadId, { startTime: Date.now(), status: "Saving archive", fileName: name, filename: name });
        resolve({ success: true, downloadId });
      });
    } catch (error) {
      forgetDownloadFilename(url);
      resolve({ success: false, error: error?.message || String(error) });
    }
  });
}

// ---------------------------------------------------------------------------
// Picture sets (image posts).
//   loose   - numbered originals (001.jpg…) straight into the collection folder
//   zip/cbz - one archive per post, assembled in the offscreen document
//   pdf     - one PDF per post (dependency-free pdfBuilder, same writer as the
//             sister project)
// Loose files are plain remote URLs, so chrome.downloads.download places them
// in the folder itself. Archives are blobs: a service worker has no
// URL.createObjectURL, so the offscreen document builds them and relays the
// blob URL back to saveBlobArtifact (which also fixes the name via the
// filename guard above).
// ---------------------------------------------------------------------------
function imageExtFromFormat(format = {}) {
  const fromExt = String(format.ext || "").toLowerCase();
  if (/^[a-z0-9]{2,4}$/.test(fromExt)) return fromExt;
  const fromUrl = String(format.url || "").match(/\.([a-z0-9]{2,4})(?:$|[?#])/i)?.[1];
  return (fromUrl || "jpg").toLowerCase();
}

function imageFilesFromFormats(formats = []) {
  const files = [];
  for (const raw of formats) {
    const format = normalizeFormat(raw);
    if (!format?.url) continue;
    const type = String(format.format_type || "").toLowerCase();
    const isImage = type === "image" || /^image\//i.test(String(format.responseContentType || ""));
    if (!isImage) continue;
    if (files.some((item) => item.url === format.url)) continue;
    files.push({ url: format.url, ext: imageExtFromFormat(format), fallbackUrl: format.fallbackUrl || "" });
  }
  return files;
}

async function downloadImageSet(videoInfo = {}, formats = [], options = {}) {
  const settings = options.settings || (await getOutputSettings());
  const images = options.images || imageFilesFromFormats(formats);
  if (!images.length) throw new Error("No image files found for this post.");
  const target = await resolveOutputTarget(videoInfo, images[0].ext, {
    settings,
    tabId: currentDownloadTabId,
  });
  const stem = String(target.fileName).replace(/\.[a-z0-9]+$/i, "") || target.context.id || "image";
  const conflictAction = settings.duplicateBehaviour === "overwrite" ? "overwrite" : "uniquify";
  const mode = ["zip", "cbz", "pdf"].includes(settings.pictureSaveMode) ? settings.pictureSaveMode : "loose";

  if (mode === "loose") {
    // Numbered originals (001.jpg…) in the collection folder. Remote URLs, so
    // the download manager creates the folder and names each file itself.
    let firstDownloadId = null;
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const filename = `${target.directory ? `${target.directory}/` : ""}${FolderNaming.padNumber(index + 1, 3)}.${image.ext}`;
      rememberDownloadFilename(image.url, filename, conflictAction);
      const downloadId = await startChromeDownload({
        url: image.url,
        filename,
        saveAs: false,
        conflictAction,
      });
      rememberDownloadFilenameById(downloadId, filename, conflictAction, image.url);
      if (firstDownloadId === null) {
        firstDownloadId = downloadId;
        downloadProgress.set(downloadId, {
          videoInfo,
          format: { format_type: "image", url: image.url },
          startTime: Date.now(),
          status: "Saving images",
          fileName: filename,
          filename,
        });
      }
      if (index === 0) {
        Bridge.notifyContentDownloadStarted?.({
          tabId: currentDownloadTabId,
          downloadId,
          filename,
          selectedFormat: { format_type: "image", url: image.url },
          strategy: "image-loose",
          downloadProgress,
          logger,
        });
      }
    }
    return { downloadId: firstDownloadId, imageCount: images.length, mode, folder: target.directory };
  }

  // Archive modes: hand the image list to the offscreen document, which
  // fetches, assembles and relays the blob back for saving.
  await ensureOffscreenDocument();
  const downloadId = `imageset-${Date.now()}`;
  const filename = `${target.directory ? `${target.directory}/` : ""}${stem}.${mode === "cbz" ? "cbz" : mode}`;
  downloadProgress.set(downloadId, {
    videoInfo,
    startTime: Date.now(),
    status: `Building ${mode.toUpperCase()} archive`,
    progress: 1,
    fileName: filename,
    filename,
  });
  Bridge.notifyContentDownloadStarted?.({
    tabId: currentDownloadTabId,
    downloadId,
    filename,
    selectedFormat: { format_type: mode },
    strategy: `image-${mode}`,
    downloadProgress,
    logger,
  });
  const ack = await new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({
        type: "PROCESS_IMAGE_SET",
        downloadId,
        fileName: filename,
        format: mode,
        images,
        conflictAction,
        refererUrl: getDownloadReferer(videoInfo),
      }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
  if (!ack?.success) {
    downloadProgress.delete(downloadId);
    throw new Error(ack?.error || `Could not start the ${mode.toUpperCase()} build.`);
  }
  return { downloadId, imageCount: images.length, mode, folder: target.directory };
}

function notify(title, message) {
  if (Bridge.showNotification) return Bridge.showNotification(title, message);
  try {
    chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title, message });
  } catch {}
}

function matchesAnyPattern(value, patterns) {
  const text = String(value || "");
  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    try {
      if (new RegExp(String(pattern), "i").test(text)) return true;
    } catch {}
  }
  return false;
}

function decodeProxyMediaUrl(url) {
  try {
    const parsed = new URL(String(url || "").replace(/&amp;/g, "&"));
    const decodeCandidates = (value) => {
      const decoded = String(decodeURIComponent(value || "") || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
      const candidates = [decoded];
      try {
        candidates.push(String(atob(decoded) || "").replace(/\\\//g, "/").replace(/&amp;/g, "&"));
      } catch {}
      return candidates;
    };
    for (const key of ["floc", "r", "url", "file", "src"]) {
      const encoded = parsed.searchParams.get(key);
      if (!encoded) continue;
      for (const decoded of decodeCandidates(encoded)) {
        if (!decoded || !/\.(mp4|m4v|webm|m3u8)(?:$|[?#/])/i.test(decoded)) continue;
        return new URL(decoded, parsed.href).href;
      }
    }
  } catch {}
  return "";
}

function rewriteDownloadUrl(url) {
  let value = decodeProxyMediaUrl(url) || String(url || "").replace(/&amp;/g, "&");
  for (const rule of Array.isArray(downloadMediaUrlRewriteRules) ? downloadMediaUrlRewriteRules : []) {
    const pattern = rule && (rule.from || rule.pattern || rule.match);
    const replacement = rule && (rule.to || rule.replacement || rule.replace);
    if (!pattern || typeof replacement !== "string") continue;
    try {
      const flags = String(rule.flags || "i").replace(/[^dgimsuvy]/g, "") || "i";
      value = value.replace(new RegExp(String(pattern), flags), replacement);
    } catch {}
  }
  if (Array.isArray(removeMediaUrlQueryParams) && removeMediaUrlQueryParams.length) {
    try {
      const parsed = new URL(value);
      for (const name of removeMediaUrlQueryParams) {
        if (!name) continue;
        parsed.searchParams.delete(String(name));
      }
      value = parsed.href;
    } catch {}
  }
  return value;
}

function normalizeFormat(format) {
  if (!format) return null;
  const url = rewriteDownloadUrl(format.url || format.videoUrl || format.video_url);
  if (!url) return null;
  const isHls = /\.m3u8(?:$|[?#])/i.test(url) || /^https?:\/\/(?:[^/]+\.)?aki-h\.stream\/(?:file|file2|quality2)\/[^?#]+(?:$|[?#/])/i.test(url) || format.ext === "m3u8" || format.format_type === "hls";
  const requiresRangeRequest = Boolean(format.requiresRangeRequest || format.rangeRequest || (!isHls && matchesAnyPattern(url, rangeRequestUrlPatterns)));
  return {
    ...format,
    url,
    ext: isHls ? "m3u8" : (format.ext || "mp4"),
    format_type: isHls ? "hls" : (format.format_type || "mp4"),
    protocol: isHls ? "m3u8_native" : (format.protocol || "https"),
    ...(requiresRangeRequest ? { requiresRangeRequest: true, rangeRequest: true } : {}),
    ...(isHls && forceChromeHlsSegmentDownload && !format.forceOffscreenHls ? {
      forceChromeHlsSegmentDownload: true,
      useDownloadHeaderRules: true,
      requiresReferer: true,
    } : {}),
  };
}

function looksObservedPlayable(url) {
  if (!/^https?:\/\//i.test(url || "")) return false;
  if (!/\.(mp4|m4v|webm|m3u8)(?:$|[?#/])/i.test(url) && !/\/player\/xs1\.php\?data=/i.test(url || "") && !/^https?:\/\/(?:[^/]+\.)?xiaoshenke\.net\/(?:vid|s1)\//i.test(url || "") && !/^https?:\/\/[^/]+\/[^?#]*\/cf-master\.[^/?#]+\.txt(?:$|[?#])/i.test(url || "") && !/^https?:\/\/[^/]+\/sora\/[^?#]+\/[^?#]+(?:$|[?#])/i.test(url || "") && !/^https?:\/\/(?:[^/]+\.)?aki-h\.stream\/(?:file|file2|quality2)\/[^?#]+(?:$|[?#/])/i.test(url || "")) return false;
  if (/sprite|thumbnail|thumb|preview|mediabook|timelines\.php|\.vtt(?:$|[?#])/i.test(url)) return false;
  if (looksKnownHosterDocumentMediaUrl(url)) return false;
  if (looksImageDerivativeMediaUrl(url)) return false;
  if (looksObservedAdMedia(url)) return false;
  return true;
}

function looksKnownHosterDocumentMediaUrl(url) {
  try {
    const parsed = new URL(url || "");
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname;
    if (/(^|\.)streamtape\.(?:com|to|xyz)$/i.test(host) && /^\/(?:e|v|d)\//i.test(path)) return true;
    if (/(^|\.)dood\.(?:watch|stream|so|la)$/i.test(host) && /^\/(?:e|d)\//i.test(path)) return true;
  } catch {}
  return false;
}

function looksImageDerivativeMediaUrl(url) {
  try {
    const parsed = new URL(url || "");
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname;
    if (/(^|\.)(?:pix-cdn77|pix-fl)\.phncdn\.com$/i.test(host) && /\/plain\/.*\/rs:fit:/i.test(path)) return true;
  } catch {}
  return false;
}

function looksObservedAdMedia(url) {
  try {
    const parsed = new URL(url || "");
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname;
    if (/(^|\.)(adtng\.com|mmcdn\.com|playhubconnect\.com|love\.mydaddy\.cc|cdn\.itsup\.com|psmcdn\.net)$/i.test(host)) return true;
    if (/\/(?:ads?|creatives?|roomad|pubs|banner|vast|tour\/pics)\//i.test(path)) return true;
  } catch {}
  return /(?:^|[/.])(ads?|advert|banner|vast|roomad|creatives?)(?:[/.?_-]|$)/i.test(String(url || ""));
}

function originOf(value) {
  try {
    return new URL(value || "").origin;
  } catch {
    return "";
  }
}

function decodeJwtPayload(token) {
  try {
    const payload = String(token || "").split(".")[1] || "";
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function cloudflareStreamIframeInfo(url) {
  try {
    const parsed = new URL(url || "");
    if (!/^(?:iframe\.cloudflarestream\.com|iframe\.videodelivery\.net)$/i.test(parsed.hostname)) return null;
    const signedToken = parsed.pathname.split("/").filter(Boolean)[0] || parsed.searchParams.get("token") || "";
    if (!signedToken) return null;
    const payload = decodeJwtPayload(signedToken) || decodeJwtPayload(parsed.searchParams.get("token") || "");
    const videoId = String(payload?.sub || "").trim();
    if (!videoId) return null;
    return {
      videoId,
      signedToken,
      iframeUrl: parsed.href,
    };
  } catch {
    return null;
  }
}

function rememberCloudflareStreamRequest(details = {}) {
  const info = cloudflareStreamIframeInfo(details.url);
  if (!info?.videoId || !info?.signedToken) return;
  observedCloudflareStreamTokens.set(info.videoId, info);
}

function observedFormat(url, source = "webrequest") {
  const lowerUrl = String(url || "").toLowerCase();
  const isHls = lowerUrl.includes(".m3u8") || lowerUrl.includes("/player/xs1.php?data=") || lowerUrl.includes("/cf-master.") || /^https?:\/\/(?:[^/]+\.)?aki-h\.stream\/(?:file|file2|quality2)\/[^?#]+(?:$|[?#/])/i.test(String(url || ""));
  let inferredHeight = null;
  let inferredQuality = source;
  try {
    const parsed = new URL(String(url || ""));
    if (/\.xtremestream\.xyz$/i.test(parsed.hostname) && /\/player\/xs1\.php$/i.test(parsed.pathname)) {
      const q = Number(parsed.searchParams.get("q") || 0) || 0;
      inferredHeight = q || 2160;
      inferredQuality = q ? String(q) + "p" : "2160p";
    }
  } catch {}
  return normalizeFormat({
    url,
    ext: isHls ? "m3u8" : "mp4",
    format_type: isHls ? "hls" : "mp4",
    protocol: isHls ? "m3u8_native" : "https",
    format_id: source,
    quality: inferredQuality,
    height: inferredHeight,
    source,
  });
}

function cloudflareStreamSegmentInfo(url) {
  try {
    const parsed = new URL(url || "");
    if (!/(^|\.)cloudflarestream\.com$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/([^/]+)\/video\/([^/]+)\/(init\.mp4|seg_(\d+)\.mp4)$/i);
    if (!match) return null;
    const streamId = match[1];
    const rendition = match[2];
    const fileName = match[3];
    const segmentIndex = typeof match[4] === "string" ? Number(match[4]) : -1;
    const height = Number(String(rendition || "").match(/\d{3,4}/)?.[0] || 0) || null;
    const manifestUrl = parsed.origin + "/" + streamId + "/manifest/video.m3u8" + parsed.search;
    return {
      manifestUrl,
      origin: parsed.origin,
      streamId,
      rendition,
      fileName,
      segmentIndex,
      height,
    };
  } catch {
    return null;
  }
}

function isCloudflareStreamSegmentUrl(url) {
  return Boolean(cloudflareStreamSegmentInfo(url));
}

function cloudflareStreamManifestFormats(formats = [], videoInfo = {}) {
  const byManifest = new Map();
  for (const format of formats || []) {
    const info = cloudflareStreamSegmentInfo(format && format.url);
    if (!info?.origin || !info?.streamId) continue;
    const key = info.origin + "/" + info.streamId;
    const current = byManifest.get(key) || {
      origin: info.origin,
      videoId: info.streamId,
      fallbackManifestUrl: info.manifestUrl,
      heights: new Set(),
      seenSegments: new Set(),
    };
    if (info.height) current.heights.add(info.height);
    current.seenSegments.add(info.fileName);
    byManifest.set(key, current);
  }
  return Array.from(byManifest.values()).map((item) => {
    const tokenInfo = observedCloudflareStreamTokens.get(item.videoId);
    const manifestUrl = tokenInfo?.signedToken
      ? item.origin + "/" + tokenInfo.signedToken + "/manifest/video.m3u8"
      : item.fallbackManifestUrl;
    const bestHeight = Math.max(0, ...Array.from(item.heights));
    return normalizeFormat({
      url: manifestUrl,
      ext: "m3u8",
      format_type: "hls",
      protocol: "m3u8_native",
      format_id: bestHeight ? `cloudflarestream-${bestHeight}p` : "cloudflarestream-hls",
      quality: bestHeight ? `${bestHeight}p` : "auto",
      height: bestHeight || null,
      source: "cloudflarestream-observed-manifest",
      forceOffscreenHls: true,
      requiresReferer: true,
      refererUrl: tokenInfo?.iframeUrl || videoInfo.playerUrl || videoInfo.embed_url || videoInfo.url || videoInfo.webpage_url || "",
      cloudflareSignedManifest: Boolean(tokenInfo?.signedToken),
      observedSegmentCount: item.seenSegments.size,
    });
  }).filter(Boolean);
}

function xiaoshenkePlayerFormats(videoInfo = {}) {
  const playerUrl = videoInfo.playerUrl || videoInfo.embed_url || videoInfo.video_url || videoInfo.url || "";
  try {
    const parsed = new URL(playerUrl);
    if (!/(^|\.)xiaoshenke\.net$/i.test(parsed.hostname)) return [];
    const parts = parsed.pathname.split("/").filter(Boolean);
    const videoIndex = parts.indexOf("video");
    const encodedId = videoIndex >= 0 ? parts[videoIndex + 1] : "";
    const qualityMask = parseInt(parts[videoIndex + 2] || "", 10) || 0;
    if (!encodedId || !qualityMask) return [];
    const id = encodedId.split("").reverse().join("");
    const qualities = [];
    if (qualityMask & 1) qualities.push(360);
    if (qualityMask & 2) qualities.push(480);
    if (qualityMask & 4) qualities.push(720);
    if (qualityMask & 8) qualities.push(1080);
    return qualities.map((quality) => normalizeFormat({
      format_id: `${quality}p`,
      height: quality,
      ext: "mp4",
      format_type: "mp4",
      protocol: "https",
      quality: `${quality}p`,
      source: "xiaoshenke-player-url",
      url: `${parsed.origin}/vid/${id}/${quality}`,
      refererUrl: playerUrl,
      requiresReferer: true,
    })).filter(Boolean);
  } catch {
    return [];
  }
}

function rememberObservedMedia(map, key, url, source) {
  if (!key || !looksObservedPlayable(url)) return;
  const list = map.get(key) || [];
  if (!list.some((item) => item.url === url)) {
    list.unshift(observedFormat(url, source));
    map.set(key, list.slice(0, 30));
  }
}

function rememberObservedRequest(details = {}) {
  const url = details.url || "";
  rememberCloudflareStreamRequest(details);
  if (!looksObservedPlayable(url)) return;
  const source = "webrequest";
  rememberObservedMedia(observedMediaByOrigin, observedMediaGlobalKey, url, source);
  if (details.tabId >= 0) {
    rememberObservedMedia(observedMediaByTab, String(details.tabId), url, source);
    try {
      chrome.tabs.get(details.tabId).then((tab) => {
        rememberObservedMedia(observedMediaByOrigin, originOf(tab && tab.url), url, source);
      }).catch(() => {});
    } catch {}
  }
  rememberObservedMedia(observedMediaByOrigin, originOf(details.initiator), url, source);
  rememberObservedMedia(observedMediaByOrigin, originOf(details.documentUrl), url, source);
}

function observedMediaFormats(videoInfo = {}) {
  const formats = [];
  const add = (items) => {
    for (const item of items || []) {
      if (item && item.url && !formats.some((format) => format.url === item.url)) formats.push(item);
    }
  };
  if (currentDownloadTabId) add(observedMediaByTab.get(String(currentDownloadTabId)));
  add(observedMediaByOrigin.get(originOf(videoInfo.url || videoInfo.webpage_url)));
  add(observedMediaByOrigin.get(originOf(videoInfo.playerUrl || videoInfo.embed_url)));
  add(observedMediaByOrigin.get(observedMediaGlobalKey));
  const cloudflareManifests = cloudflareStreamManifestFormats(formats, videoInfo);
  if (!cloudflareManifests.length) return formats;
  const manifestUrls = new Set(cloudflareManifests.map((format) => format.url));
  const output = [...cloudflareManifests];
  for (const format of formats) {
    if (!format?.url) continue;
    if (manifestUrls.has(format.url)) continue;
    if (isCloudflareStreamSegmentUrl(format.url)) continue;
    output.push(format);
  }
  return output;
}

function sameUrl(left, right) {
  try {
    return new URL(String(left || "")).href === new URL(String(right || "")).href;
  } catch {
    return String(left || "") === String(right || "");
  }
}

function isSourcePageFormat(format, videoInfo = {}) {
  const url = String(format && format.url || "");
  if (!url) return false;
  return [videoInfo.url, videoInfo.webpage_url, videoInfo.sourcePageUrl]
    .filter(Boolean)
    .some((pageUrl) => sameUrl(url, pageUrl));
}

try {
  if (chrome.webRequest && !globalThis.__rule34ObservedMediaListenerInstalled) {
    globalThis.__rule34ObservedMediaListenerInstalled = true;
    chrome.webRequest.onBeforeRequest.addListener(
      rememberObservedRequest,
      {
        urls: [
          "https://rule34.world/*",
          "http://rule34.world/*",
          "https://*.rule34.world/*",
          "http://*.rule34.world/*",
          "https://www.rule34.world/*",
          "http://www.rule34.world/*",
          "https://rule34storage.b-cdn.net/*",
          "https://rule34video.com/*",
          "http://rule34video.com/*",
          "https://*.rule34video.com/*",
          "http://*.rule34video.com/*",
        ],
      },
    );
  }
} catch {}

async function defaultGetVideoFormats(videoInfo = {}) {
  const formats = [];
  if (videoInfo.selectedFormat && !isSourcePageFormat(videoInfo.selectedFormat, videoInfo)) formats.push(normalizeFormat(videoInfo.selectedFormat));
  if (Array.isArray(videoInfo.formats)) {
    for (const format of videoInfo.formats) {
      if (!isSourcePageFormat(format, videoInfo)) formats.push(normalizeFormat(format));
    }
  }
  for (const format of observedMediaFormats(videoInfo)) formats.push(normalizeFormat(format));
  if (videoInfo.video_url || /\.(mp4|m4v|webm|m3u8)(?:$|[?#])/i.test(videoInfo.url || "")) {
    formats.push(normalizeFormat({ url: videoInfo.video_url || videoInfo.url, format_id: "direct" }));
  }
  const deduped = [];
  for (const format of formats.filter(Boolean)) {
    if (!deduped.some((item) => item.url === format.url)) deduped.push(format);
  }
  deduped.sort((a, b) => (a.format_type === "mp4" ? -1 : 1) - (b.format_type === "mp4" ? -1 : 1));
  return { formats: deduped };
}

async function getVideoFormats(videoInfo = {}, request = {}) {
  if (request && request.tabId) currentDownloadTabId = request.tabId;
  // Fast path: resolve directly from the post page / API for supported sites.
  try {
    const postUrl = videoInfo?.url || videoInfo?.webpage_url || videoInfo?.pageUrl || "";
    const resolved = await resolveKnownPost(postUrl);
    if (resolved && resolved.formats.length) {
      return {
        formats: resolved.formats.map((format) => normalizeFormat(format)).filter(Boolean),
        apiTitle: resolved.title,
        apiArtist: resolved.artist,
        apiThumbnail: resolved.thumbnail,
        apiDuration: resolved.duration,
        apiTags: Array.isArray(resolved.tags) ? resolved.tags : [],
        apiUploader: resolved.uploader || "",
        apiDate: resolved.date || "",
        apiKind: resolved.formats.some((format) => format?.format_type === "image") ? "image" : "video",
      };
    }
  } catch (error) {
    logger.warn("Known-post resolver failed, falling back to generic detection", error);
  }
  const xiaoshenkeFormats = xiaoshenkePlayerFormats(videoInfo);
  if (xiaoshenkeFormats.length) return { formats: xiaoshenkeFormats };
  if (typeof Adapter.getVideoFormats === "function") {
    try {
      const result = await Adapter.getVideoFormats({
        videoInfo,
        request,
        tabId: request?.tabId || videoInfo?.tabId || currentDownloadTabId || null,
        SiteConfig,
        logger,
        normalizeFormat,
        defaultGetVideoFormats,
      });
      if (Array.isArray(result)) return { formats: result };
      if (result && typeof result === "object") return result;
    } catch (error) {
      logger.warn("Site adapter getVideoFormats hook failed", error);
    }
  }
  return defaultGetVideoFormats(videoInfo);
}

function getDownloadReferer(videoInfo = {}, fallbackUrl = "") {
  return (
    videoInfo.url ||
    videoInfo.webpage_url ||
    videoInfo.playerUrl ||
    videoInfo.embed_url ||
    fallbackUrl ||
    undefined
  );
}

function getFormatReferer(selectedFormat = {}, videoInfo = {}, fallbackUrl = "") {
  const selectedReferer = (
    selectedFormat.refererUrl ||
    selectedFormat.referrer ||
    selectedFormat.referer ||
    selectedFormat.sourcePageUrl ||
    ""
  );
  if (selectedReferer) return selectedReferer;
  try {
    const selectedUrl = new URL(selectedFormat.url || "");
    const playerUrl = videoInfo.playerUrl || videoInfo.embed_url || "";
    const playerHost = playerUrl ? new URL(playerUrl).hostname : "";
    if (/(^|\.)xiaoshenke\.net$/i.test(selectedUrl.hostname) && /(^|\.)xiaoshenke\.net$/i.test(playerHost)) {
      return playerUrl;
    }
    if (/(^|\.)xtremestream\.xyz$/i.test(selectedUrl.hostname) && /(^|\.)xtremestream\.xyz$/i.test(playerHost)) {
      return playerUrl;
    }
  } catch {}
  return getDownloadReferer(videoInfo, fallbackUrl);
}

function buildMediaFetchHeaders(refererUrl = "") {
  const headers = {
    Accept: "application/vnd.apple.mpegurl, application/x-mpegurl, */*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (refererUrl) {
    headers.Referer = refererUrl;
    try {
      headers.Origin = new URL(refererUrl).origin;
    } catch {}
  }
  return headers;
}

function shouldForceChromeDownload(selectedFormat = {}) {
  if (!selectedFormat?.url || selectedFormat.format_type === "hls") return false;
  if (selectedFormat.forceChromeDownload) return true;
  try {
    const host = new URL(selectedFormat.url).hostname;
    return /(^|[.])erome[.]com$/i.test(host);
  } catch {
    return false;
  }
}

function shouldUseTabInitiatedDownload(selectedFormat = {}) {
  if (selectedFormat.forceTabDownload || selectedFormat.tabInitiatedDownload) return true;
  try {
    const host = new URL(selectedFormat.url || "").hostname;
    return /(^|[.])erome[.]com$/i.test(host);
  } catch {
    return false;
  }
}

function shouldUseDownloadHeaderRules(selectedFormat = {}) {
  return Boolean(selectedFormat.useDownloadHeaderRules) || shouldUseTabInitiatedDownload(selectedFormat);
}

function shouldRemoveDownloadCookieHeader(selectedFormat = {}) {
  return Boolean(
    selectedFormat.removeCookieHeaderForDownload ||
    selectedFormat.omitCookieHeader ||
    selectedFormat.omitCookiesForDownload ||
    selectedFormat.downloadWithoutCookies
  );
}

function dnrRegexFilterForDownload(selectedFormat = {}) {
  const rawUrl = String(selectedFormat.url || "");
  if (!rawUrl) return "";
  if (!selectedFormat.useDownloadHeaderRules) return "^https?://[^/]*erome[.]com/.*";
  try {
    const parsed = new URL(rawUrl);
    const escape = (value) => {
      let output = "";
      for (const char of String(value || "")) {
        output += "\\^$.|?*+()[]{}".includes(char) ? ("\\" + char) : char;
      }
      return output;
    };
    return "^" + escape(parsed.protocol).replace(/^https?:/i, "https?:") + "//" + escape(parsed.host) + escape(parsed.pathname) + ".*";
  } catch {
    return "";
  }
}

async function withTemporaryHeaderRules(selectedFormat = {}, videoInfo = {}, task = async () => null) {
  if (!shouldUseDownloadHeaderRules(selectedFormat) || !chrome.declarativeNetRequest?.updateSessionRules) return await task();
  const referer = getFormatReferer(selectedFormat, videoInfo, selectedFormat.url);
  if (!referer) return await task();
  const regexFilter = dnrRegexFilterForDownload(selectedFormat);
  let requestHost = "";
  try { requestHost = new URL(selectedFormat.url || "").hostname; } catch {}
  const extraRequestDomains = Array.isArray(selectedFormat.downloadHeaderRuleExtraDomains)
    ? selectedFormat.downloadHeaderRuleExtraDomains.map((domain) => String(domain || "").trim()).filter(Boolean)
    : [];
  const requestDomains = Array.from(new Set([requestHost, ...extraRequestDomains].filter(Boolean)));
  if (!regexFilter && !requestDomains.length) return await task();
  let origin = "";
  try { origin = new URL(referer).origin; } catch {}
  const ruleId = 930000 + Math.floor(Date.now() % 100000);
  const downloadName = sanitizeFilename(String(selectedFormat.filename || videoInfo.title || videoInfo.id || "video").split("/").pop()) || "video";
  const attachmentName = /[.]mp4$/i.test(downloadName) ? downloadName : (downloadName + ".mp4");
  const resourceTypes = ["main_frame", "sub_frame", "xmlhttprequest", "media", "object", "other"];
  console.log("[download] header-rule-prepare", {
    host: requestHost,
    hasRegex: Boolean(regexFilter),
    removeCookie: shouldRemoveDownloadCookieHeader(selectedFormat),
    extraDomains: extraRequestDomains.length,
  });
  const buildRule = (condition) => ({
    id: ruleId,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "referer", operation: "set", value: referer },
        ...(origin ? [{ header: "origin", operation: "set", value: origin }] : []),
        ...(shouldRemoveDownloadCookieHeader(selectedFormat) ? [{ header: "cookie", operation: "remove" }] : []),
      ],
      responseHeaders: [
        ...(selectedFormat.responseContentType ? [{ header: "content-type", operation: "set", value: selectedFormat.responseContentType }] : []),
        { header: "content-disposition", operation: "set", value: 'attachment; filename="' + attachmentName.replace(/"/g, "") + '"' },
      ],
    },
    condition: {
      ...condition,
      resourceTypes,
    },
  });
  const tryInstall = async (condition) => {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId], addRules: [buildRule(condition)] });
    return true;
  };
  let installed = false;
  if (regexFilter && !extraRequestDomains.length) {
    try {
      installed = await tryInstall({ regexFilter });
    } catch (error) {
      console.warn("[download] header-rule-regex-failed", error?.message || error);
    }
  }
  if (!installed && requestHost && !extraRequestDomains.length) {
    try {
      installed = await tryInstall({ urlFilter: "||" + requestHost + "/" });
    } catch (error) {
      console.warn("[download] header-rule-url-filter-failed", error?.message || error);
    }
  }
  if (!installed && requestDomains.length) {
    try {
      await tryInstall({ requestDomains });
      installed = true;
    } catch (error) {
      console.warn("[download] header-rule-domain-failed", error?.message || error);
    }
  }
  try {
    return await task();
  } finally {
    if (installed) setTimeout(() => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {}), 15000);
  }
}

function shouldUseOffscreenMp4(selectedFormat = {}, videoInfo = {}) {
  if (!selectedFormat?.url || selectedFormat.format_type === "hls") return false;
  // Static images (e.g. rule34.world image posts) are plain direct downloads;
  // never send them through the MP4/offscreen media pipeline.
  if (selectedFormat.format_type === "image" || /^\s*(jpe?g|png|webp|gif|bmp|avif)\s*$/i.test(String(selectedFormat.ext || ""))) return false;
  if (selectedFormat.forceOffscreenDownload) return true;
  if (SiteConfig.BACKGROUND?.forceOffscreenMp4) return true;
  if (selectedFormat.forceTabDownload || selectedFormat.tabInitiatedDownload) return false;
  if (shouldForceChromeDownload(selectedFormat)) return false;
  try {
    const selectedUrl = new URL(selectedFormat.url);
    if (/(^|[.])erome[.]com$/i.test(selectedUrl.hostname)) return false;
  } catch {}
  if (selectedFormat.requiresReferer) return true;
  try {
    const selectedUrl = new URL(selectedFormat.url);
    const referer = getFormatReferer(selectedFormat, videoInfo, selectedFormat.url);
    if (/(^|[.])xiaoshenke[.]net$/i.test(selectedUrl.hostname)) return Boolean(referer);
    if (!referer) return false;
    const refererUrl = new URL(referer);
    return selectedUrl.origin !== refererUrl.origin;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isXiaoshenkeFormat(format = {}) {
  try {
    return /(^|[.])xiaoshenke[.]net$/i.test(new URL(format.url || "").hostname);
  } catch {
    return false;
  }
}

async function resolveXiaoshenkeSignedUrl(selectedFormat, videoInfo = {}) {
  const playerUrl = getFormatReferer(selectedFormat, videoInfo, selectedFormat.url);
  if (!playerUrl) throw new Error("No player referer available for Xiaoshenke resolver.");
  const tab = await chrome.tabs.create({ url: playerUrl, active: false });
  try {
    await new Promise((resolve) => {
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tab.id || changeInfo.status !== "complete") return;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        try { chrome.tabs.onUpdated.removeListener(listener); } catch {}
        resolve();
      }, 5000);
    });
    const signedUrl = await new Promise((resolve) => {
      const done = (value) => {
        try { chrome.webRequest.onBeforeRequest.removeListener(requestListener); } catch {}
        try { chrome.tabs.onUpdated.removeListener(tabListener); } catch {}
        resolve(value || "");
      };
      const isSignedMediaUrl = (url) => {
        try {
          const parsed = new URL(url || "");
          const host = parsed.hostname.toLowerCase();
          const path = parsed.pathname || "";
          return (host === "xiaoshenke.net" || host.endsWith(".xiaoshenke.net")) &&
            path.startsWith("/s1/") &&
            !path.split("/").includes("i");
        } catch {
          return false;
        }
      };
      const requestListener = (details) => {
        if (details.tabId !== tab.id) return;
        if (isSignedMediaUrl(details.url)) done(details.url);
      };
      const tabListener = (updatedTabId, changeInfo, updatedTab) => {
        if (updatedTabId !== tab.id) return;
        const nextUrl = changeInfo.url || updatedTab?.url || "";
        if (isSignedMediaUrl(nextUrl)) done(nextUrl);
      };
      chrome.webRequest.onBeforeRequest.addListener(requestListener, { urls: ["*://*.xiaoshenke.net/s1/*"] });
      chrome.tabs.onUpdated.addListener(tabListener);
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [selectedFormat.url],
        func: async (mediaUrl) => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          let video = document.querySelector("video");
          for (let index = 0; !video && index < 20; index += 1) {
            await sleep(250);
            video = document.querySelector("video");
          }
          if (!video) {
            video = document.createElement("video");
            video.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;";
            document.body.appendChild(video);
          }
          const sources = Array.from(video.querySelectorAll("source"));
          const absoluteMediaUrl = new URL(mediaUrl, location.href).href;
          let source = sources.find((item) => item.src === absoluteMediaUrl) || sources.find((item) => String(item.src || "").includes("/vid/"));
          if (!source) {
            source = document.createElement("source");
            source.src = absoluteMediaUrl;
            source.type = "video/mp4";
            video.appendChild(source);
          }
          if (source?.src) video.src = source.src;
          video.preload = "auto";
          video.muted = true;
          try { video.load(); } catch {}
          try { await video.play(); } catch {}
          return true;
        },
      }).catch(() => {});
      const poll = async () => {
        for (let index = 0; index < 30; index += 1) {
          try {
            const current = await chrome.tabs.get(tab.id);
            if (isSignedMediaUrl(current?.url)) return done(current.url);
          } catch {}
          await sleep(500);
        }
        done("");
      };
      poll();
    });
    if (!signedUrl) throw new Error("Could not resolve signed Xiaoshenke media URL.");
    return { signedUrl, playerUrl };
  } finally {
    setTimeout(() => { try { chrome.tabs.remove(tab.id); } catch {} }, 1000);
  }
}

function startPlayerTabDownload(selectedFormat, filename, videoInfo = {}) {
  const downloadId = "mp4-" + Date.now();
  downloadProgress.set(downloadId, { videoInfo, format: selectedFormat, startTime: Date.now(), status: "Resolving video URL...", progress: 1, downloadedBytes: 0, totalBytes: 0, fileName: filename, filename });
  Bridge.notifyDownloadProgressToContent?.({ tabId: currentDownloadTabId, downloadId, filename, selectedFormat, strategy: "xiaoshenke-resolver", status: "Resolving video URL...", progress: 1, downloadProgress, logger });
  void (async () => {
    try {
      const { signedUrl, playerUrl } = await resolveXiaoshenkeSignedUrl(selectedFormat, videoInfo);
      console.log("[download] xiaoshenke-signed-url", { host: (() => { try { return new URL(signedUrl).hostname; } catch { return ""; } })() });
      const resolvedFormat = { ...selectedFormat, url: signedUrl, refererUrl: playerUrl, source: "xiaoshenke-signed-media", requiresReferer: true };
      downloadProgress.set(downloadId, { ...(downloadProgress.get(downloadId) || {}), videoInfo, format: resolvedFormat, status: "Starting MP4 download...", progress: 2, updatedAt: Date.now() });
      Bridge.notifyDownloadProgressToContent?.({ tabId: currentDownloadTabId, downloadId, filename, selectedFormat: resolvedFormat, strategy: "xiaoshenke-resolver", status: "Starting MP4 download...", progress: 2, downloadProgress, logger });
      await ensureOffscreenDocument();
      const dnrRuleId = await Bridge.installTemporaryRefererRule?.(signedUrl, playerUrl, logger);
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "PROCESS_MP4_DOWNLOAD", downloadId, fileName: filename, videoUrl: signedUrl, refererUrl: playerUrl, dnrRuleId }, (result) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (!result?.success) reject(new Error(result?.error || "Failed to start MP4 download"));
          else resolve(result);
        });
      });
    } catch (error) {
      console.warn("[download] xiaoshenke-async-failed", error);
      Bridge.forwardMP4Error?.({ tabId: currentDownloadTabId, message: { downloadId, fileName: filename, error: error?.message || String(error) }, downloadProgress, logger });
    }
  })();
  return downloadId;
}

async function forwardHLSProgress(message) {
  return globalThis.Rule34BackgroundBridge.forwardHLSProgress({
    tabId: currentDownloadTabId,
    message,
    downloadProgress,
    logger,
  });
}

async function forwardHLSComplete(message) {
  return globalThis.Rule34BackgroundBridge.forwardHLSComplete({
    tabId: currentDownloadTabId,
    message,
    downloadProgress,
    logger,
  });
}

async function forwardHLSError(message) {
  return globalThis.Rule34BackgroundBridge.forwardHLSError({
    tabId: currentDownloadTabId,
    message,
    downloadProgress,
    logger,
  });
}

async function ensureOffscreenDocument() {
  return globalThis.Rule34BackgroundBridge.ensureOffscreenDocument({
    logger,
  });
}

function parseM3U8Attributes(attrString) {
  return globalThis.Rule34BackgroundBridge.parseM3U8Attributes(attrString);
}

function extractM3U8Formats(m3u8Content, baseUrl, videoId, ext = "mp4") {
  const formats = [];
  const lines = String(m3u8Content || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let isStreamInf = false;
  let currentFormat = null;
  let pendingSegmentDuration = null;
  let targetDuration = null;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      isStreamInf = true;
      currentFormat = {
        format_id: "hls",
        ext: "m3u8",
        format_type: "hls",
        protocol: "m3u8_native",
        quality: null,
        height: null,
        tbr: null,
        isSegmented: false,
      };
      const attrs = parseM3U8Attributes(line.substring("#EXT-X-STREAM-INF:".length));
      if (attrs.RESOLUTION) {
        const [width, height] = String(attrs.RESOLUTION).split("x").map(Number);
        currentFormat.width = width;
        currentFormat.height = height;
        currentFormat.quality = height;
        currentFormat.format_id = String(height) + "p";
      }
      if (attrs.BANDWIDTH) {
        currentFormat.tbr = Math.round(parseInt(attrs.BANDWIDTH, 10) / 1000);
      }
      continue;
    }

    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      const match = line.match(/^#EXT-X-TARGETDURATION:(\d+)/);
      if (match) targetDuration = parseInt(match[1], 10);
      continue;
    }

    if (line.startsWith("#EXT-X-MAP:")) {
      const attrs = parseM3U8Attributes(line.substring("#EXT-X-MAP:".length));
      if (!attrs.URI) continue;
      if (!currentFormat) {
        currentFormat = {
          format_id: "hls-segments",
          ext,
          format_type: "hls",
          protocol: "m3u8_segments",
          quality: null,
          isSegmented: true,
          segments: [],
        };
      } else {
        currentFormat.isSegmented = true;
        if (!currentFormat.segments) currentFormat.segments = [];
      }
      let initUrl = String(attrs.URI || "");
      if (!/^https?:\/\//i.test(initUrl)) {
        const baseParts = String(baseUrl || "").split("/");
        baseParts.pop();
        initUrl = baseParts.join("/") + "/" + initUrl;
      }
      if (!currentFormat.segments.some((segment) => segment?.url === initUrl)) {
        currentFormat.segments.unshift({
          url: initUrl,
          duration: 0,
          init: true,
        });
      }
      continue;
    }

    if (line.startsWith("#EXTINF:")) {
      const match = line.match(/^#EXTINF:([\d.]+)/);
      if (match) pendingSegmentDuration = parseFloat(match[1]);
      if (!currentFormat) {
        currentFormat = {
          format_id: "hls-segments",
          ext,
          format_type: "hls",
          protocol: "m3u8_segments",
          quality: null,
          isSegmented: true,
          segments: [],
        };
      } else {
        currentFormat.isSegmented = true;
      }
      continue;
    }

    if (line.startsWith("#")) continue;

    if (isStreamInf && currentFormat) {
      let streamUrl = line;
      if (!/^https?:\/\//i.test(streamUrl)) {
        const baseParts = String(baseUrl || "").split("/");
        baseParts.pop();
        streamUrl = baseParts.join("/") + "/" + streamUrl;
      }
      currentFormat.url = streamUrl;
      formats.push({ ...currentFormat });
      currentFormat = null;
      isStreamInf = false;
      continue;
    }

    if (!currentFormat) {
      currentFormat = {
        format_id: "hls-segments",
        ext,
        format_type: "hls",
        protocol: "m3u8_segments",
        quality: null,
        isSegmented: true,
        segments: [],
      };
    }

    let segmentUrl = line;
    if (!/^https?:\/\//i.test(segmentUrl)) {
      const baseParts = String(baseUrl || "").split("/");
      baseParts.pop();
      segmentUrl = baseParts.join("/") + "/" + segmentUrl;
    }
    if (!currentFormat.segments) currentFormat.segments = [];
    currentFormat.segments.push({
      url: segmentUrl,
      duration:
        typeof pendingSegmentDuration === "number" && !Number.isNaN(pendingSegmentDuration)
          ? pendingSegmentDuration
          : (typeof targetDuration === "number" ? targetDuration : null),
    });
    pendingSegmentDuration = null;
  }

  if (currentFormat && Array.isArray(currentFormat.segments) && currentFormat.segments.length) {
    currentFormat.m3u8_url = baseUrl;
    currentFormat.duration =
      currentFormat.segments.reduce((sum, segment) => sum + (Number(segment?.duration) || 0), 0) || undefined;
    formats.push(currentFormat);
  }

  formats.sort((left, right) => {
    const leftQuality = parseInt(left?.quality, 10) || 0;
    const rightQuality = parseInt(right?.quality, 10) || 0;
    return rightQuality - leftQuality;
  });
  return formats;
}

async function parseM3U8(m3u8Url, videoInfo = {}, selectedFormat = {}) {
  const refererUrl = getFormatReferer(selectedFormat, videoInfo, m3u8Url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const response = await fetch(m3u8Url, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    headers: buildMediaFetchHeaders(refererUrl),
    signal: controller.signal,
    ...(refererUrl ? {
      referrer: refererUrl,
      referrerPolicy: "strict-origin-when-cross-origin",
    } : {}),
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    throw new Error("HTTP " + response.status + ": " + response.statusText);
  }
  const content = await response.text();
  return {
    success: true,
    formats: extractM3U8Formats(content, m3u8Url, videoInfo.id || "unknown", "mp4"),
    content,
  };
}

async function resolveHlsSegmentForChromeDownload(m3u8Url, videoInfo = {}, selectedFormat = {}, depth = 0) {
  if (depth > 2) throw new Error("HLS segment resolver exceeded playlist depth.");
  const refererUrl = getFormatReferer(selectedFormat, videoInfo, m3u8Url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const response = await fetch(m3u8Url, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    headers: buildMediaFetchHeaders(refererUrl),
    signal: controller.signal,
    ...(refererUrl ? {
      referrer: refererUrl,
      referrerPolicy: "strict-origin-when-cross-origin",
    } : {}),
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw new Error("HTTP " + response.status + ": " + response.statusText);
  const content = await response.text();
  const lines = String(content || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const absolute = (value) => {
    try { return new URL(value, m3u8Url).href; } catch { return value; }
  };
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue;
    const next = lines.slice(index + 1).find((item) => item && !item.startsWith("#"));
    if (!next) continue;
    const bandwidth = Number(line.match(/BANDWIDTH=(\d+)/i)?.[1] || 0);
    const resolution = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    const pixels = resolution ? ((Number(resolution[1]) || 0) * (Number(resolution[2]) || 0)) : 0;
    variants.push({ url: absolute(next), score: bandwidth || pixels || 0 });
  }
  if (variants.length) {
    variants.sort((left, right) => right.score - left.score);
    return await resolveHlsSegmentForChromeDownload(variants[0].url, videoInfo, { ...selectedFormat, url: variants[0].url }, depth + 1);
  }
  const segments = [];
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    if (/\.(?:key|vtt)(?:$|[?#])/i.test(line)) continue;
    segments.push(absolute(line));
  }
  const mediaSegments = segments.filter((url) => {
    return /\.(?:ts|m4s|mp4)(?:$|[?#])/i.test(url)
      || /^https?:\/\/[^/]+\.xspcdn\d+\.sa\.com\/cdn\/down\/[^?#]+\.html(?:$|[?#])/i.test(url);
  });
  const segmentUrl = mediaSegments[1] || mediaSegments[0] || segments[1] || segments[0];
  if (!segmentUrl) throw new Error("No HLS media segment found.");
  return segmentUrl;
}

async function downloadHLS(m3u8Url, filename, videoInfo = {}, options = {}) {
  const downloadId = options.downloadId || "hls-" + Date.now();
  const sourceFormat = normalizeFormat(options.selectedFormat) || {};
  const notifyHlsProgress = (payload = {}) => Bridge.notifyDownloadProgressToContent?.({
    tabId: currentDownloadTabId,
    downloadId,
    filename,
    strategy: "background-hls",
    isHLS: true,
    downloadProgress,
    logger,
    ...payload,
  });

  downloadProgress.set(downloadId, {
    status: "starting",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    segmentIndex: 0,
    totalSegments: 0,
    fileName: filename,
    filename,
    updatedAt: Date.now(),
  });
  notifyHlsProgress({ status: "Preparing HLS download...", progress: 0 });

  let selectedFormat = Array.isArray(sourceFormat.segments) && sourceFormat.segments.length
    ? sourceFormat
    : null;

  if (!selectedFormat) {
    let m3u8Response;
    try {
      m3u8Response = await parseM3U8(m3u8Url, videoInfo, sourceFormat);
    } catch (error) {
      downloadProgress.set(downloadId, {
        status: "error",
        progress: 0,
        error: error?.message || String(error || "Failed to fetch M3U8"),
        fileName: filename,
        filename,
        updatedAt: Date.now(),
      });
      notifyHlsProgress({
        status: "Failed",
        progress: 0,
        error: error?.message || String(error || "Failed to fetch M3U8"),
      });
      throw error;
    }
    if (!m3u8Response?.success) {
      const error = new Error("Failed to fetch M3U8: " + (m3u8Response?.error || "Unknown error"));
      downloadProgress.set(downloadId, {
        status: "error",
        progress: 0,
        error: error.message,
        fileName: filename,
        filename,
        updatedAt: Date.now(),
      });
      notifyHlsProgress({ status: "Failed", progress: 0, error: error.message });
      throw error;
    }

    selectedFormat = Array.isArray(m3u8Response.formats)
      ? m3u8Response.formats.find((format) => format.isSegmented) || m3u8Response.formats[0]
      : null;
  }

  if (!selectedFormat || !selectedFormat.segments || !selectedFormat.segments.length) {
    if (selectedFormat?.url && !selectedFormat.isSegmented) {
      try {
        const refererUrl = getFormatReferer(sourceFormat, videoInfo, selectedFormat.url || m3u8Url);
        const response = await fetch(selectedFormat.url, {
          credentials: "include",
          headers: buildMediaFetchHeaders(refererUrl),
          ...(refererUrl ? {
            referrer: refererUrl,
            referrerPolicy: "strict-origin-when-cross-origin",
          } : {}),
        });
        if (response.ok) {
          const mediaContent = await response.text();
          const mediaFormats = extractM3U8Formats(mediaContent, selectedFormat.url, videoInfo.id, "mp4");
          const mediaFormat = mediaFormats.find((format) => format.isSegmented);
          if (mediaFormat?.segments?.length) selectedFormat = mediaFormat;
        }
      } catch (error) {
        logger.warn("Failed to expand media playlist", error);
      }
    }
  }

  if (!selectedFormat?.segments?.length) {
    return Bridge.downloadMp4WithOffscreen({
      videoUrl: m3u8Url,
      filename,
      refererUrl: getFormatReferer(sourceFormat, videoInfo, m3u8Url),
      ensureOffscreenDocument,
      downloadProgress,
      logger,
    });
  }

  downloadProgress.set(downloadId, {
    status: "starting",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    segmentIndex: 0,
    totalSegments: selectedFormat.segments.length,
    fileName: filename,
    filename,
    updatedAt: Date.now(),
  });
  notifyHlsProgress({
    status: "Preparing " + selectedFormat.segments.length + " HLS segments...",
    progress: 0,
    segmentIndex: 0,
    totalSegments: selectedFormat.segments.length,
  });
  await ensureOffscreenDocument();
  const hlsConflictAction = (await getOutputSettings()).duplicateBehaviour === "overwrite" ? "overwrite" : "uniquify";
  const processingResult = await new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const ackTimer = setTimeout(() => {
      logger.warn("HLS offscreen start acknowledgement timed out; continuing with background progress polling.");
      finish({ success: true, timedOut: true });
    }, 3000);
    try {
      chrome.runtime.sendMessage({
        type: "PROCESS_HLS_SEGMENTS",
        downloadId,
        fileName: filename,
        segments: selectedFormat.segments,
        totalSegments: selectedFormat.segments.length,
        totalDuration: typeof selectedFormat.duration === "number" ? selectedFormat.duration : undefined,
        refererUrl: getFormatReferer(sourceFormat, videoInfo, m3u8Url),
        conflictAction: hlsConflictAction,
      }, (result) => {
        clearTimeout(ackTimer);
        if (chrome.runtime.lastError) {
          finish({ success: false, error: chrome.runtime.lastError.message });
        } else {
          finish(result || { success: true });
        }
      });
    } catch (error) {
      clearTimeout(ackTimer);
      finish({ success: false, error: error?.message || String(error) });
    }
  });
  if (!processingResult?.success) {
    const error = new Error("HLS processing failed: " + (processingResult?.error || "Unknown error"));
    notifyHlsProgress({
      status: "Failed",
      progress: 0,
      totalSegments: selectedFormat.segments.length,
      error: error.message,
    });
    throw error;
  }
  return downloadId;
}

function startChromeDownload(options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, downloadId) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(downloadId);
    };
    try {
      chrome.downloads.download(options, (downloadId) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) finish(new Error(lastError.message || String(lastError)));
        else finish(null, downloadId);
      });
    } catch (error) {
      finish(error);
    }
    setTimeout(() => finish(new Error("Chrome download did not start before timeout.")), 15000);
  });
}

function watchForDownloadCreated({ url, filename, timeoutMs = 20000 }) {
  let settled = false;
  let cleanupTimer = null;
  let createdListener = null;
  let filenameListener = null;
  const targetName = String(filename || "").trim();
  const leafName = targetName.split("/").pop() || "";
  const isMatchingItem = (item = {}) => {
    const itemUrl = item.finalUrl || item.url || "";
    const itemName = String(item.filename || "").split(/[\\/]/).pop();
    return itemUrl === url || (leafName && itemName === leafName);
  };
  const cleanup = () => {
    if (cleanupTimer) clearTimeout(cleanupTimer);
    try { if (createdListener) chrome.downloads.onCreated.removeListener(createdListener); } catch {}
    try { if (filenameListener) chrome.downloads.onDeterminingFilename.removeListener(filenameListener); } catch {}
  };
  const finish = (error, downloadId, resolve, reject) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (error) reject(error);
    else resolve(downloadId);
  };
  const promise = new Promise((resolve, reject) => {
    createdListener = (item) => { if (isMatchingItem(item)) finish(null, item.id, resolve, reject); };
    // Temporary listener used only for tab-initiated downloads of *our*
    // media. Always call suggest() — Chrome requires it once per listener —
    // but only pass a filename for the matching item, and never an empty one.
    // Returning without suggest() on a foreign download is exactly the leak
    // that made nhentai report us as having determined filename "".
    filenameListener = (item, suggest) => {
      if (!isMatchingItem(item) || !targetName) {
        try { suggest(); } catch {}
        return;
      }
      try { suggest({ filename: targetName, conflictAction: "uniquify" }); } catch { try { suggest(); } catch {} }
      finish(null, item.id, resolve, reject);
    };
    try {
      chrome.downloads.onCreated.addListener(createdListener);
      chrome.downloads.onDeterminingFilename.addListener(filenameListener);
      cleanupTimer = setTimeout(() => finish(new Error("Tab download did not start before timeout."), null, resolve, reject), timeoutMs);
    } catch (error) {
      finish(error, null, resolve, reject);
    }
  });
  return { promise, cancel() { if (settled) return; settled = true; cleanup(); } };
}

async function startTabInitiatedDownload({ tabId, url, filename }) {
  if (!tabId || !chrome.scripting?.executeScript) throw new Error("No active page tab available for tab-initiated download.");
  const downloadWatch = watchForDownloadCreated({ url, filename });
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (downloadUrl, suggestedFilename) => {
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = String(suggestedFilename || "video.mp4").split("/").pop() || "video.mp4";
        anchor.rel = "noopener";
        anchor.style.display = "none";
        (document.documentElement || document.body).appendChild(anchor);
        anchor.click();
        setTimeout(() => { try { anchor.remove(); } catch {} }, 1000);
      },
      args: [url, filename],
    });
  } catch (error) {
    downloadWatch.cancel();
    throw error;
  }
  return await downloadWatch.promise;
}

async function downloadVideo(videoInfo = {}) {
  console.log("[download] background-start", {
    hasSelectedFormat: Boolean(videoInfo.selectedFormat),
    formatCount: Array.isArray(videoInfo.formats) ? videoInfo.formats.length : 0,
  });
  let selectedFormat = normalizeFormat(videoInfo.selectedFormat);
  if (isSourcePageFormat(selectedFormat, videoInfo)) selectedFormat = null;
  let formatResponse = {
    formats: selectedFormat
      ? [selectedFormat].concat(
          Array.isArray(videoInfo.formats)
            ? videoInfo.formats.map((format) => normalizeFormat(format)).filter(Boolean)
            : [],
        )
      : [],
  };
  let refreshedResponse = null;
  try {
    refreshedResponse = videoInfo.skipFormatRefresh
      ? null
      : await getVideoFormats({ ...videoInfo, selectedFormat });
    const mergedFormats = [];
    for (const format of [
      ...(Array.isArray(formatResponse.formats) ? formatResponse.formats : []),
      ...(Array.isArray(refreshedResponse?.formats) ? refreshedResponse.formats : []),
    ]) {
      const normalized = normalizeFormat(format);
      if (isSourcePageFormat(normalized, videoInfo)) continue;
      if (normalized?.url && !mergedFormats.some((item) => item.url === normalized.url)) mergedFormats.push(normalized);
    }
    if (mergedFormats.length) formatResponse = { ...(refreshedResponse || {}), formats: mergedFormats };
  } catch (error) {
    logger.warn("Download format refresh failed", error);
  }
  // Apply resolver-provided metadata (rule34 post API / post page) when the
  // caller didn't have it, so the saved filename gets the real title/id.
  if (refreshedResponse?.apiTitle && !videoInfo.title) {
    videoInfo = { ...videoInfo, title: refreshedResponse.apiTitle };
  }
  if (refreshedResponse?.apiArtist && !videoInfo.artist) {
    videoInfo = { ...videoInfo, artist: refreshedResponse.apiArtist };
  }
  // Same for the rest of the naming metadata, so the folder-name tokens work
  // for downloads that only carry a URL (corner button, context menu, batch).
  if (refreshedResponse?.apiUploader && !videoInfo.uploader) {
    videoInfo = { ...videoInfo, uploader: refreshedResponse.apiUploader };
  }
  if (refreshedResponse?.apiDate && !videoInfo.date) {
    videoInfo = { ...videoInfo, date: refreshedResponse.apiDate };
  }
  if (!selectedFormat) selectedFormat = normalizeFormat(videoInfo.selectedFormat) || formatResponse.formats[0];
  if (typeof Adapter.prepareDownload === "function") {
    try {
      const prepared = await Adapter.prepareDownload({
        videoInfo,
        selectedFormat,
        formats: formatResponse.formats,
        tabId: currentDownloadTabId,
        SiteConfig,
        logger,
        normalizeFormat,
      });
      if (prepared?.selectedFormat) selectedFormat = normalizeFormat(prepared.selectedFormat);
      if (prepared?.videoInfo) videoInfo = { ...videoInfo, ...prepared.videoInfo };
    } catch (error) {
      logger.warn("Site adapter prepareDownload hook failed", error);
    }
  }
  selectedFormat = normalizeFormat(selectedFormat) || selectedFormat;
  if (!selectedFormat?.url) throw new Error("No downloadable video URL found.");
  console.log("[download] selected-format", {
    type: selectedFormat.format_type || "",
    ext: selectedFormat.ext || "",
    host: (() => { try { return new URL(selectedFormat.url).hostname; } catch { return ""; } })(),
    forceOffscreen: Boolean(selectedFormat.forceOffscreenDownload),
    forceChrome: Boolean(selectedFormat.forceChromeDownload),
    requiresReferer: Boolean(selectedFormat.requiresReferer),
    requiresRange: Boolean(selectedFormat.requiresRangeRequest || selectedFormat.rangeRequest),
  });
  const outputSettings = await getOutputSettings();
  // Image posts take the picture-set pipeline (loose numbered originals or a
  // per-post ZIP/CBZ/PDF) instead of the single-file video path.
  const imageFiles = imageFilesFromFormats(formatResponse.formats);
  const selectedIsImage = String(selectedFormat.format_type || "").toLowerCase() === "image"
    || /^image\//i.test(String(selectedFormat.responseContentType || ""));
  if (selectedIsImage && imageFiles.length) {
    console.log("[download] image-set-start", { count: imageFiles.length, mode: outputSettings.pictureSaveMode });
    const result = await downloadImageSet(videoInfo, formatResponse.formats, { settings: outputSettings, images: imageFiles });
    rememberOutputChoice(videoInfo.url || videoInfo.webpage_url || "", { manual: videoInfo.__output?.manual, tags: videoInfo.__output?.tags });
    return result;
  }
  const fileExtension = (() => {
    const ext = String(selectedFormat.ext || "").toLowerCase();
    if (selectedFormat.format_type === "hls" || ext === "m3u8" || !/^[a-z0-9]{2,4}$/.test(ext)) return "mp4";
    return ext;
  })();
  const outputTarget = await resolveOutputTarget(videoInfo, fileExtension, {
    settings: outputSettings,
    tabId: currentDownloadTabId,
  });
  const fullFilename = outputTarget.full;
  const conflictAction = outputSettings.duplicateBehaviour === "overwrite" ? "overwrite" : "uniquify";
  // Remember the manual name / checked tags for this post so the corner button
  // and the context menu land in the same folder as the popup download.
  if (videoInfo.__output) {
    rememberOutputChoice(videoInfo.url || videoInfo.webpage_url || "", videoInfo.__output);
  }
  console.log("[download] output-path", { path: fullFilename, folder: outputTarget.directory, site: outputTarget.site });
  if (selectedFormat.format_type === "hls" && selectedFormat.forceChromeHlsSegmentDownload) {
    console.log("[download] hls-segment-chrome-start", { filename: fullFilename });
    const hlsHeaderFormat = {
      ...selectedFormat,
      useDownloadHeaderRules: true,
      refererUrl: getFormatReferer(selectedFormat, videoInfo, selectedFormat.url),
    };
    const segmentUrl = await withTemporaryHeaderRules(hlsHeaderFormat, videoInfo, async () => {
      return await resolveHlsSegmentForChromeDownload(selectedFormat.url, videoInfo, hlsHeaderFormat);
    });
    const segmentFormat = {
      ...selectedFormat,
      url: segmentUrl,
      format_type: "mp4",
      ext: /\.m4s(?:$|[?#])/i.test(segmentUrl) ? "m4s" : (/\.ts(?:$|[?#])/i.test(segmentUrl) ? "ts" : "mp4"),
      protocol: "https",
      forceChromeDownload: true,
      useDownloadHeaderRules: true,
      refererUrl: getFormatReferer(selectedFormat, videoInfo, selectedFormat.url),
    };
    if (/\/cdn\/down\/[^?#]+\.html(?:$|[?#])/i.test(segmentUrl)) {
      segmentFormat.ext = "ts";
      segmentFormat.responseContentType = "video/mp2t";
    }
    rememberDownloadFilename(segmentUrl, fullFilename, conflictAction);
    const downloadId = await withTemporaryHeaderRules(segmentFormat, videoInfo, async () => await startChromeDownload({
      url: segmentUrl,
      filename: fullFilename,
      saveAs: false,
      conflictAction,
    }));
    rememberDownloadFilenameById(downloadId, fullFilename, conflictAction, segmentUrl);
    console.log("[download] hls-segment-chrome-id", downloadId);
    downloadProgress.set(downloadId, { videoInfo, format: segmentFormat, startTime: Date.now() });
    Bridge.notifyContentDownloadStarted?.({
      tabId: currentDownloadTabId,
      downloadId,
      filename: fullFilename,
      selectedFormat: segmentFormat,
      strategy: "chrome-hls-segment",
      downloadProgress,
      logger,
    });
    return { downloadId, format: segmentFormat, viaChromeHlsSegment: true };
  }
  if (selectedFormat.format_type === "hls" && !selectedFormat.forceChromeDownload) {
    console.log("[download] hls-start", { filename: fullFilename });
    const downloadId = "hls-" + Date.now();
    const hlsHeaderFormat = selectedFormat.useDownloadHeaderRules
      ? {
          ...selectedFormat,
          refererUrl: getFormatReferer(selectedFormat, videoInfo, selectedFormat.url),
        }
      : selectedFormat;
    const hlsTask = async () => await withTemporaryHeaderRules(hlsHeaderFormat, videoInfo, async () => {
      return await downloadHLS(selectedFormat.url, fullFilename, videoInfo, { downloadId, selectedFormat: hlsHeaderFormat });
    });
    void hlsTask()
      .then((resolvedDownloadId) => {
        console.log("[download] hls-id", resolvedDownloadId);
        releaseQueueSlot(downloadId);
      })
      .catch((error) => {
        logger.error("HLS background job failed", error);
        releaseQueueSlot(downloadId);
      });
    return { downloadId, format: hlsHeaderFormat, isHLS: true };
  }
  if (isXiaoshenkeFormat(selectedFormat)) {
    console.log("[download] page-tab-mp4-start", { filename: fullFilename });
    const downloadId = await startPlayerTabDownload(selectedFormat, fullFilename, videoInfo);
    console.log("[download] page-tab-mp4-id", downloadId);
    downloadProgress.set(downloadId, {
      ...(downloadProgress.get(downloadId) || {}),
      videoInfo,
      format: selectedFormat,
      startTime: Date.now(),
      fileName: fullFilename,
      filename: fullFilename,
    });
    return { downloadId, format: selectedFormat, viaPageTab: true };
  }

  if (shouldUseOffscreenMp4(selectedFormat, videoInfo)) {
    console.log("[download] offscreen-start", { filename: fullFilename });
    const downloadId = await Bridge.downloadMp4WithOffscreen({
      videoUrl: selectedFormat.url,
      filename: fullFilename,
      refererUrl: getFormatReferer(selectedFormat, videoInfo, selectedFormat.url),
      rangeRequest: Boolean(selectedFormat.requiresRangeRequest || selectedFormat.rangeRequest),
      conflictAction,
      ensureOffscreenDocument,
      downloadProgress,
      logger,
    });
    console.log("[download] offscreen-id", downloadId);
    downloadProgress.set(downloadId, { videoInfo, format: selectedFormat, startTime: Date.now() });
    Bridge.notifyContentDownloadStarted?.({
      tabId: currentDownloadTabId,
      downloadId,
      filename: fullFilename,
      selectedFormat,
      strategy: "offscreen-mp4",
      downloadProgress,
      logger,
    });
    return { downloadId, format: selectedFormat, viaOffscreen: true };
  }

  const useTabDownload = shouldUseTabInitiatedDownload(selectedFormat);
  console.log(useTabDownload ? "[download] tab-start" : "[download] chrome-start", { filename: fullFilename });
  const downloadId = await withTemporaryHeaderRules(selectedFormat, videoInfo, async () => {
    if (useTabDownload) {
      return await startTabInitiatedDownload({
        tabId: currentDownloadTabId,
        url: selectedFormat.url,
        filename: fullFilename,
      });
    }
    rememberDownloadFilename(selectedFormat.url, fullFilename, conflictAction);
    const chromeId = await startChromeDownload({
      url: selectedFormat.url,
      filename: fullFilename,
      saveAs: false,
      conflictAction,
    });
    rememberDownloadFilenameById(chromeId, fullFilename, conflictAction, selectedFormat.url);
    return chromeId;
  });
  console.log("[download] chrome-id", downloadId);
  downloadProgress.set(downloadId, { videoInfo, format: selectedFormat, startTime: Date.now() });
  rememberDownloadRetryContext(downloadId, videoInfo, selectedFormat);
  Bridge.notifyContentDownloadStarted?.({
    tabId: currentDownloadTabId,
    downloadId,
    filename: fullFilename,
    selectedFormat,
    strategy: "chrome",
    downloadProgress,
    logger,
  });
  if (Bridge.monitorDownloadCompletion) {
    Bridge.monitorDownloadCompletion({
      downloadId,
      filename: fullFilename,
      downloadProgress,
      notify,
    });
  }
  return { downloadId, format: selectedFormat };
}

// ---------------------------------------------------------------------------
// Side panel: the Twitter-style batch queue + nh-dw style page crawler.
// The engine lives in extension/panel-queue.js; this is only the wiring to
// the resolvers, the download pipeline and the tab that asked.
// ---------------------------------------------------------------------------
const PANEL_SNAPSHOT_MESSAGE = "panel.snapshot";

// Offscreen jobs (`mp4-*`, `hls-*`, `imageset-*`) are not chrome.downloads
// items, so cancelling them means telling the offscreen document to abort.
// Its CANCEL_* handlers exist since v4; nothing sent to them before 6.0.0.
function cancelOffscreenJob(downloadId) {
  const id = String(downloadId || "");
  const type = id.startsWith("mp4-")
    ? "CANCEL_MP4_DOWNLOAD"
    : id.startsWith("hls-")
      ? "CANCEL_HLS_PROCESSING"
      : id.startsWith("imageset-")
        ? "CANCEL_IMAGE_SET"
        : "";
  if (!type) return false;
  try {
    chrome.runtime.sendMessage({ type, downloadId: id }, () => {
      void chrome.runtime.lastError; // no offscreen document — nothing to cancel
    });
  } catch {}
  return true;
}

function broadcastPanelSnapshot(snapshot) {
  try {
    chrome.runtime.sendMessage({ action: PANEL_SNAPSHOT_MESSAGE, snapshot }, () => {
      void chrome.runtime.lastError; // no panel open — fine
    });
  } catch {}
}

// Ask the rule34video.com content script for the cards currently rendered
// (keeps the user's on-page sort/filters). Returns null when there is no
// content script (e.g. the tab needs a reload) so the caller can fetch instead.
function collectPageItemsFromTab(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { action: "collectListing" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) return resolve(null);
        resolve(Array.isArray(response.items) ? response.items : null);
      });
    } catch {
      resolve(null);
    }
  });
}

if (PanelQueueFactory && Routes) {
  try {
    panelQueue = PanelQueueFactory.create({
      chrome,
      routes: Routes,
      logger,
      resolvePost: resolveKnownPost,
      // Every panel download flows through the same concurrency-aware queue as
      // the popup / corner buttons, so the two limits compose instead of
      // fighting (the panel's own worker pool is the outer limit).
      startDownload: (videoInfo) => queueDownloadRequest(videoInfo, { quiet: true }),
      cancelDownload: (downloadId) => {
        try {
          if (typeof downloadId === "number") {
            userCancelledDownloads.add(String(downloadId));
            chrome.downloads.cancel(downloadId);
          } else if (typeof downloadId === "string" && downloadId.startsWith("queued-")) {
            removeQueuedDownload(downloadId);
          } else {
            cancelOffscreenJob(downloadId);
          }
          downloadProgress.delete(downloadId);
          releaseQueueSlot(downloadId);
        } catch {}
      },
      collectPageItems: collectPageItemsFromTab,
      broadcast: broadcastPanelSnapshot,
      setCurrentTab: (tabId) => { if (tabId) currentDownloadTabId = tabId; },
    });
    void panelQueue.restore();
  } catch (error) {
    logger.error("Side-panel queue failed to start", error);
    panelQueue = null;
  }
}

async function openSidePanelForSender(sender, request = {}) {
  const tabId = Number(request?.tabId) || sender?.tab?.id || null;
  const windowId = Number(request?.windowId) || sender?.tab?.windowId || null;
  if (!chrome.sidePanel?.open) throw new Error("Side panel API unavailable (Chrome 114+ required).");
  if (tabId) {
    try { await chrome.sidePanel.open({ tabId }); return; } catch {}
  }
  if (windowId) {
    await chrome.sidePanel.open({ windowId });
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.windowId) throw new Error("No active window.");
  await chrome.sidePanel.open({ windowId: tab.windowId });
}

// Clicking the toolbar icon opens the side panel directly (the popup is gone:
// the panel IS the UI). Chrome only lets us set this once at startup.
try {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
} catch {}

// Restore the persisted session queue (waiting downloads, batch URLs,
// in-flight job slots) after a service-worker restart, then keep draining.
void restoreQueueState();

// Context menu: "Download with Rule 34 Downloader" on links and pages of the
// two sites. URL-routed like everything else — a post link queues that post,
// a listing link/page lists it in the panel, anything else is ignored.
const CONTEXT_MENU_ID = "r34-download";
const CONTEXT_MENU_PATTERNS = [
  "https://rule34.world/*", "https://*.rule34.world/*", "http://rule34.world/*", "http://*.rule34.world/*",
  "https://rule34video.com/*", "https://*.rule34video.com/*", "http://rule34video.com/*", "http://*.rule34video.com/*",
];

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      try {
        chrome.contextMenus.create({
          id: CONTEXT_MENU_ID,
          title: "Download with Rule 34 Downloader",
          contexts: ["link", "page", "video", "image"],
          documentUrlPatterns: CONTEXT_MENU_PATTERNS,
        }, () => void chrome.runtime.lastError);
      } catch (error) {
        logger.warn("Could not create the context menu", error);
      }
    });
  } catch {}
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info?.menuItemId !== CONTEXT_MENU_ID || !panelQueue || !Routes) return;
  const candidates = [info.linkUrl, info.pageUrl, tab?.url].filter(Boolean);
  for (const url of candidates) {
    const route = Routes.match(url);
    if (!route) continue;
    if (tab?.id) currentDownloadTabId = tab.id;
    if (Routes.isSinglePost(route)) {
      void panelQueue.handleMessage({ action: "panel.add", items: [{ url: route.canonicalUrl || url }], start: true, tabId: tab?.id }, { tab });
      return;
    }
    if (Routes.isListing(route)) {
      void panelQueue.handleMessage({ action: "panel.listPage", url, tabId: tab?.id }, { tab })
        .then(() => openSidePanelForSender({ tab }, {}))
        .catch(() => {});
      return;
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request?.action || request?.type;
  // Side-panel queue / crawler ("panel.*") — see extension/panel-queue.js.
  if (panelQueue && panelQueue.isPanelAction(request)) {
    panelQueue.handleMessage(request, sender)
      .then((response) => { try { sendResponse(response); } catch {} })
      .catch((error) => { try { sendResponse({ success: false, error: error?.message || String(error) }); } catch {} });
    return true;
  }
  if (action === "openSidePanel") {
    openSidePanelForSender(sender, request)
      .then(() => { try { sendResponse({ success: true }); } catch {} })
      .catch((error) => { try { sendResponse({ success: false, error: error?.message || String(error) }); } catch {} });
    return true;
  }
  if (action === "routeMatch") {
    try { sendResponse({ success: true, route: Routes ? Routes.match(request?.url || sender?.tab?.url || "") : null }); } catch {}
    return false;
  }
  switch (action) {
    case "downloadVideo":
      return Bridge.handleDownloadVideoMessage({
        request,
        sender,
        sendResponse,
        downloadVideo: queueDownloadRequest,
        setCurrentDownloadTabId(tabId) { currentDownloadTabId = tabId; },
      });
    case "getQueueStatus":
      getDownloadLimit()
        .then((limit) => sendResponse({ success: true, ...getQueueStatusSnapshot(limit) }))
        .catch(() => sendResponse({ success: true, ...getQueueStatusSnapshot(0) }));
      return true;
    case "setDownloadLimit": {
      const raw = Number(request?.limit);
      const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 99) : 0;
      chrome.storage.local.set({ [DOWNLOAD_LIMIT_STORAGE_KEY]: limit }, () => {
        void pumpDownloadQueue();
        try { sendResponse({ success: true, limit }); } catch {}
      });
      return true;
    }
    case "batchDownloadPosts": {
      const tabId = sender?.tab?.id || request?.tabId || currentDownloadTabId || null;
      const { accepted, skipped } = enqueueBatchDownloads(request?.urls, tabId);
      sendResponse({ success: true, accepted: accepted.length, skipped, urls: accepted });
      return false;
    }
    case "getQueueItems": {
      purgeStaleQueueJobs();
      const active = [];
      for (const [key, job] of activeQueueJobs) {
        active.push({
          key: String(key),
          title: job?.title || "Download",
          url: job?.url || "",
          startedAt: job?.startedAt || Date.now(),
        });
      }
      const queued = downloadQueue.map((job, index) => ({
        queuedId: job.queuedId,
        title: job?.videoInfo?.title || job?.videoInfo?.id || "Download",
        url: job?.videoInfo?.url || "",
        position: index + 1,
        enqueuedAt: job?.enqueuedAt || Date.now(),
      }));
      getDownloadLimit()
        .then((limit) => sendResponse({ success: true, limit, active, queued, batchPending: batchPending.length }))
        .catch(() => sendResponse({ success: true, limit: 0, active, queued, batchPending: batchPending.length }));
      return true;
    }
    case "clearQueue": {
      const removedQueued = downloadQueue.length;
      const removedBatch = batchPending.length;
      downloadQueue.length = 0;
      batchPending.length = 0;
      persistQueueState();
      sendResponse({ success: true, removedQueued, removedBatch });
      return false;
    }
    case "bulkDownloadTag": {
      const tabId = sender?.tab?.id || request?.tabId || currentDownloadTabId || null;
      const isVideo = /rule34video\.com/i.test(request?.site || (sender?.tab?.url) || "");
      (async () => {
        try {
          let urls = [];
          if (request?.playlistUrl) {
            const pid = String(request.playlistUrl).match(/playlist[/=](\w+)/i)?.[1]
              || String(request.playlistUrl).match(/(\d+)/)?.[1];
            if (!pid) throw new Error("Could not parse a playlist id from that URL.");
            urls = await searchRule34WorldPosts({ playlistId: pid, maxUrls: BATCH_MAX_URLS });
          } else if (request?.tags) {
            urls = isVideo
              ? await searchRule34VideoTag({ tags: request.tags, maxUrls: BATCH_MAX_URLS })
              : await searchRule34WorldPosts({ tags: request.tags, maxUrls: BATCH_MAX_URLS });
          } else {
            throw new Error("Enter a tag/artist or a playlist URL.");
          }
          if (!urls.length) throw new Error("No posts found for that query.");
          const { accepted, skipped } = enqueueBatchDownloads(urls, tabId);
          sendResponse({ success: true, accepted: accepted.length, skipped, urls: accepted });
        } catch (error) {
          sendResponse({ success: false, error: error?.message || "Bulk download failed." });
        }
      })();
      return true;
    }
    case "TELEMETRY_LOG":
      // Popup telemetry pings: no metrics backend — just mirror to the SW log.
      try {
        logger.log("telemetry", request?.evt || "", request?.data || {});
      } catch {}
      try { sendResponse({ success: true }); } catch {}
      return false;
    case "getVideoFormats":
      return Bridge.handleGetVideoFormatsMessage({
        request,
        sendResponse,
        getVideoFormats(videoInfo) { return getVideoFormats(videoInfo, request); },
      });
    case "getDownloadProgress":
      Bridge.handleGetDownloadProgressMessage({ request, sendResponse, downloadProgress });
      return false;
    case "getActiveDownloads":
      sendResponse({ active_downloads: Object.fromEntries(downloadProgress) });
      return false;
    case "HLS_PROCESSING_PROGRESS":
      panelQueue?.notifyProgress(request?.downloadId, request?.progress);
      return Bridge.handleForwardAck({
        request,
        sendResponse,
        forwarder: forwardHLSProgress,
      });
    case "HLS_PROCESSING_COMPLETE":
      releaseQueueSlot(request?.downloadId);
      panelQueue?.notifyOutcome(request?.downloadId, { ok: true });
      return Bridge.handleForwardAck({
        request,
        sendResponse,
        forwarder: forwardHLSComplete,
      });
    case "HLS_PROCESSING_ERROR":
      releaseQueueSlot(request?.downloadId);
      panelQueue?.notifyOutcome(request?.downloadId, { ok: false, error: String(request?.error || request?.message || "Download failed") });
      return Bridge.handleForwardAck({
        request,
        sendResponse,
        forwarder: forwardHLSError,
      });
    case "MP4_DOWNLOAD_PROGRESS":
      panelQueue?.notifyProgress(request?.downloadId, request?.progress);
      return Bridge.handleForwardAck({
        request,
        sendResponse,
        forwarder: (message) => Bridge.forwardMP4Progress?.({
          tabId: currentDownloadTabId,
          message,
          downloadProgress,
          logger,
        }),
      });
    case "MP4_DOWNLOAD_COMPLETE":
      releaseQueueSlot(request?.downloadId);
      panelQueue?.notifyOutcome(request?.downloadId, { ok: true });
      return Bridge.handleForwardAck({
        request,
        sendResponse,
        forwarder: (message) => Bridge.forwardMP4Complete?.({
          tabId: currentDownloadTabId,
          message,
          downloadProgress,
          logger,
        }),
      });
    case "MP4_DOWNLOAD_ERROR":
      releaseQueueSlot(request?.downloadId);
      panelQueue?.notifyOutcome(request?.downloadId, { ok: false, error: String(request?.error || request?.message || "Download failed") });
      return Bridge.handleForwardAck({
        request,
        sendResponse,
        forwarder: (message) => Bridge.forwardMP4Error?.({
          tabId: currentDownloadTabId,
          message,
          downloadProgress,
          logger,
        }),
      });
    // The offscreen document cannot call chrome.downloads (only chrome.runtime
    // exists there), so finished blob artifacts are relayed here for saving
    // with their full <Root>/<Site>/<Collection>/<file> path.
    case "SAVE_BLOB_ARTIFACT": {
      saveBlobArtifact({
        blobUrl: request?.blobUrl,
        filename: request?.filename || request?.fileName,
        conflictAction: request?.conflictAction,
      })
        .then((result) => {
          try { sendResponse(result); } catch {}
        })
        .catch((error) => {
          try { sendResponse({ success: false, error: error?.message || String(error) }); } catch {}
        });
      return true;
    }
    case "IMAGE_SET_PROGRESS": {
      panelQueue?.notifyProgress(request?.downloadId, request?.progress);
      const entry = downloadProgress.get(request?.downloadId) || {};
      downloadProgress.set(request?.downloadId, {
        ...entry,
        progress: Number(request?.progress) || entry.progress || 0,
        status: request?.status || entry.status || "Building archive",
      });
      Bridge.forwardMP4Progress?.({
        tabId: currentDownloadTabId,
        message: { ...request, type: "MP4_DOWNLOAD_PROGRESS" },
        downloadProgress,
        logger,
      });
      try { sendResponse({ success: true }); } catch {}
      return false;
    }
    case "IMAGE_SET_COMPLETE": {
      releaseQueueSlot(request?.downloadId);
      panelQueue?.notifyOutcome(request?.downloadId, { ok: true });
      downloadProgress.delete(request?.downloadId);
      notify("Download Complete", `${request?.fileName || "Archive"} has been downloaded successfully.`);
      Bridge.forwardMP4Complete?.({
        tabId: currentDownloadTabId,
        message: { ...request, type: "MP4_DOWNLOAD_COMPLETE" },
        downloadProgress,
        logger,
      });
      try { sendResponse({ success: true }); } catch {}
      return false;
    }
    case "IMAGE_SET_ERROR": {
      releaseQueueSlot(request?.downloadId);
      panelQueue?.notifyOutcome(request?.downloadId, { ok: false, error: String(request?.error || request?.message || "Download failed") });
      downloadProgress.delete(request?.downloadId);
      notify("Download Failed", String(request?.error || "The archive could not be built."));
      Bridge.forwardMP4Error?.({
        tabId: currentDownloadTabId,
        message: { ...request, type: "MP4_DOWNLOAD_ERROR" },
        downloadProgress,
        logger,
      });
      try { sendResponse({ success: true }); } catch {}
      return false;
    }
    case "getOutputSettings": {
      getOutputSettings()
        .then((settings) => sendResponse({ success: true, settings }))
        .catch(() => sendResponse({ success: true, settings: { ...OUTPUT_STORAGE_KEYS } }));
      return true;
    }
    case "cancelDownload":
      try {
        if (typeof request.downloadId === "number") {
          userCancelledDownloads.add(String(request.downloadId));
          if (userCancelledDownloads.size > 500) {
            userCancelledDownloads.delete(userCancelledDownloads.values().next().value);
          }
          chrome.downloads.cancel(request.downloadId);
        }
        if (typeof request.downloadId === "string" && request.downloadId.startsWith("queued-")) {
          removeQueuedDownload(request.downloadId);
        } else {
          cancelOffscreenJob(request.downloadId);
        }
        downloadProgress.delete(request.downloadId);
        releaseQueueSlot(request.downloadId);
        panelQueue?.notifyOutcome(request.downloadId, { ok: false, error: "Cancelled" });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error?.message || "cancel failed" });
      }
      return false;
    case "LOG_MIRROR":
      return Bridge.handleLogMirror({ request, sender, sendResponse, logger });
    default:
      return false;
  }
});
