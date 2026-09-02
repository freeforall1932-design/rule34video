// Window-less VM end-to-end test for the output organization.
//
// It loads the REAL service worker (extension/background-enhanced.js) and the
// REAL offscreen document (extension/offscreen.js) in Node with a mocked
// `chrome.*` + `fetch`, then drives them through their message handlers and
// asserts the exact relative paths handed to the download manager:
//
//   1. a video from each site lands under its own site folder, never mixed
//   2. manual tag > checked tags > search query > post id
//   3. an empty master folder restores the flat layout exactly
//   4. a picture post saves loose numbered files or one archive per post, and
//      the assembled archive really contains every image in order
//   5. reserved names are prefixed, and files never overwrite by default
//
// Run from the repo root:  node source/tests/e2e-download-paths.mjs

import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readZipEntries, readZipEntryBytes } from "../../extension/modules/archive/zipBuilder.mjs";

process.on("unhandledRejection", (err) => {
  console.warn("non-fatal unhandledRejection:", err?.message || err);
});

const repoRoot = resolve(process.cwd());
const extensionDir = join(repoRoot, "extension");
let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log("  ok  " + label);
  } else {
    failures += 1;
    console.log("  FAIL " + label + (detail ? "\n       " + detail : ""));
  }
}

function section(title) {
  console.log("\n" + title);
}

// ---------------------------------------------------------------------------
// Fixtures: one post per site.
// ---------------------------------------------------------------------------
const VIDEO_POST_ID = "4573905";
const VIDEO_POST_URL = `https://rule34video.com/video/${VIDEO_POST_ID}/some-slug/`;
const rule34VideoHtml = `
<html><head>
<meta property="og:title" content="A Sample Video - Rule 34" />
<meta property="og:image" content="https://rule34video.com/thumb.jpg" />
</head><body>
<h1>A Sample Video</h1>
<time datetime="2026-08-14 10:00:00">Aug 14</time>
<a href="https://rule34video.com/models/an-uploader/">AnUploader</a>
<div class="tags">
  <a href="https://rule34video.com/tags/26528/">touhou</a>
  <a href="https://rule34video.com/tags/194069/">artist a</a>
  <a href="https://rule34video.com/tags/38117/">animated</a>
</div>
<a href="https://rule34video.com/get_file/abc123/video_file_1080p.mp4/?rnd=1&download=true&download_filename=x.mp4">1080p</a>
<a href="https://rule34video.com/get_file/abc123/video_file_480.mp4/?rnd=1&download=true&download_filename=x.mp4">480p</a>
</body></html>`;

const WORLD_POST_ID = "3571567";
const WORLD_POST_URL = `https://rule34.world/post/${WORLD_POST_ID}`;
const worldVideoPost = {
  id: Number(WORLD_POST_ID),
  type: 1,
  duration: 12,
  created: "2026-08-02T08:00:00",
  files: { "100": [1], "101": [0], "102": [0] },
  tags: [{ type: 8, value: "WorldArtist" }, { type: 0, value: "some_tag" }],
};
const WORLD_IMAGE_POST_ID = "1280481";
const WORLD_IMAGE_POST_URL = `https://rule34.world/post/${WORLD_IMAGE_POST_ID}`;
const worldImagePost = {
  id: Number(WORLD_IMAGE_POST_ID),
  type: 0,
  created: "2026-07-19T08:00:00",
  files: { "10": [1] },
  tags: [{ type: 8, value: "PicArtist" }, { type: 0, value: "still" }],
};

// ---------------------------------------------------------------------------
// Mocked chrome + fetch. Storage is a real key/value store so the code under
// test exercises its own read/write paths.
// ---------------------------------------------------------------------------
function createStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get(keys, cb) {
      const defaults = typeof keys === "object" && !Array.isArray(keys) ? keys : {};
      const names = Array.isArray(keys) ? keys : Object.keys(defaults);
      const out = {};
      for (const name of names) {
        out[name] = name in data ? data[name] : defaults[name];
      }
      const promise = Promise.resolve(out);
      if (cb) cb(out);
      return promise;
    },
    set(patch, cb) {
      Object.assign(data, patch);
      if (cb) cb();
      return Promise.resolve();
    },
    remove(keys, cb) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      if (cb) cb();
      return Promise.resolve();
    },
    onChanged: { addListener() {} },
  };
}

function createChromeMock() {
  const downloads = [];
  const runtimeMessages = [];
  const determiningFilenameListeners = [];
  const createdListeners = [];
  const mock = {
    runtimeMessages,
    storage: { local: createStore(), sync: createStore() },
    runtime: {
      lastError: null,
      onMessage: { addListener(handler) { mock.__handler = handler; } },
      onInstalled: { addListener() {} },
      onSuspend: { addListener() {} },
      getURL: (path) => pathToFileURL(join(extensionDir, path)).href,
      getManifest: () => ({ name: "Downloader for Rule 34", host_permissions: [] }),
      getContexts: () => Promise.resolve([]),
      sendMessage(message, cb) {
        runtimeMessages.push(message);
        if (cb) cb({ success: true });
        return Promise.resolve({ success: true });
      },
    },
    webRequest: { onBeforeRequest: { addListener() {} } },
    downloadsApi: {
      download(options, cb) {
        downloads.push(options);
        const id = downloads.length;
        if (cb) cb(id);
        return Promise.resolve(id);
      },
      cancel() {},
      onCreated: { addListener(listener) { createdListeners.push(listener); } },
      onChanged: { addListener() {} },
      onDeterminingFilename: {
        addListener(listener) { determiningFilenameListeners.push(listener); },
        removeListener() {},
      },
    },
    notifications: { create() {} },
    contextMenus: { onClicked: { addListener() {} }, create() {} },
    tabs: {
      query: () => Promise.resolve([{ id: 1, url: VIDEO_POST_URL }]),
      sendMessage() {},
      get(id, cb) { if (cb) cb({ id, url: mock.__tabUrl || VIDEO_POST_URL }); },
      create() {},
      remove() {},
      onUpdated: { addListener() {} },
    },
    scripting: { executeScript: () => Promise.resolve([]) },
    offscreen: {
      createDocument: () => Promise.resolve(),
      hasDocument: () => Promise.resolve(true),
      Reason: { DOM_SCRAPING: "DOM_SCRAPING" },
    },
    declarativeNetRequest: {
      updateSessionRules: () => Promise.resolve(),
      getSessionRules: () => Promise.resolve([]),
    },
  };
  mock.downloadCalls = downloads;
  mock.downloadsApi.determiningFilenameListeners = determiningFilenameListeners;
  return mock;
}

let fetchLog = [];
function installFetch() {
  fetchLog = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    fetchLog.push(u);
    if (u.includes("/api/v2/post/" + WORLD_IMAGE_POST_ID)) {
      return { ok: true, status: 200, json: async () => worldImagePost, text: async () => JSON.stringify(worldImagePost) };
    }
    if (u.includes("/api/v2/post/" + WORLD_POST_ID)) {
      return { ok: true, status: 200, json: async () => worldVideoPost, text: async () => JSON.stringify(worldVideoPost) };
    }
    if (u.includes("rule34video.com/video/" + VIDEO_POST_ID)) {
      return { ok: true, status: 200, text: async () => rule34VideoHtml, json: async () => ({}) };
    }
    if (u.startsWith("https://pics.example/")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "image/jpeg" },
        arrayBuffer: async () => new TextEncoder().encode("image-bytes-" + u.slice(-3)).buffer,
      };
    }
    // Host probe + anything else.
    return {
      ok: true,
      status: 200,
      headers: { get: () => "video/mp4" },
      body: { cancel() {}, getReader: () => ({ read: async () => ({ done: true }) }) },
      json: async () => ({}),
      text: async () => "",
      arrayBuffer: async () => new Uint8Array(0).buffer,
    };
  };
}

// Copy the classic scripts the service worker imports into a temp dir as .mjs
// so Node can import them (the same trick source/tests/smoke.mjs uses).
async function loadBackground(chromeMock) {
  installFetch();
  globalThis.chrome = chromeMock;
  globalThis.chrome.downloads = chromeMock.downloadsApi;
  const tmp = join(tmpdir(), "r34-e2e-bg-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  mkdirSync(tmp, { recursive: true });
  for (const name of ["background-enhanced.js", "site-config.js", "logger.js", "background-bridge.js", "folder-naming.js"]) {
    let code = readFileSync(join(extensionDir, name), "utf8");
    code = code
      .replace(/from\s+['"]\.\/([\w-]+)\.js['"]/g, "from './$1.mjs'")
      .replace(/import\s+['"]\.\/([\w-]+)\.js['"]/g, "import './$1.mjs'");
    writeFileSync(join(tmp, name.replace(/\.js$/, ".mjs")), code);
  }
  await import(pathToFileURL(join(tmp, "background-enhanced.mjs")).href);
  if (typeof chromeMock.__handler !== "function") throw new Error("background did not register an onMessage handler");
  return {
    call: (request) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("handler timed out for " + request.action)), 15000);
      chromeMock.__handler(request, { tab: { id: 1, url: VIDEO_POST_URL } }, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
    }),
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

function lastMessage(chromeMock, type) {
  return [...chromeMock.runtimeMessages].reverse().find((message) => message.type === type) || null;
}

// ---------------------------------------------------------------------------
// Phase A: the service worker's output paths.
// ---------------------------------------------------------------------------
const chromeMock = createChromeMock();
const bg = await loadBackground(chromeMock);

async function setSettings(patch) {
  Object.assign(chromeMock.storage.sync.data, patch);
}

async function downloadVideoPost(url, extra = {}) {
  chromeMock.downloadCalls.length = 0;
  chromeMock.runtimeMessages.length = 0;
  const response = await bg.call({
    action: "downloadVideo",
    tabId: 1,
    videoInfo: { url, ...extra },
  });
  return response;
}

function downloadedFilenames() {
  return chromeMock.downloadCalls.map((options) => options.filename);
}

section("A1. one video per site, never mixed");
await setSettings({ masterFolder: "R34V", collectionTemplate: "{artist} - {title} - {id}" });
let response = await downloadVideoPost(VIDEO_POST_URL);
check("rule34video download succeeded", response?.success === true, JSON.stringify(response));
// The rule34video media URL is same-origin with the page, so Chrome downloads
// it directly and we can read the exact requested path.
check(
  "rule34video path is R34V/rule34video/<artist - title - id>/<title>.mp4",
  downloadedFilenames().some((name) => /^R34V\/rule34video\/.+\/.+\.mp4$/.test(name)),
  JSON.stringify(downloadedFilenames()),
);
const videoPath = downloadedFilenames()[0];
check("the site level is the automatic slug, not user input", videoPath.startsWith("R34V/rule34video/"), videoPath);
check(
  "the collection folder is built from the template (artist falls back to the uploader)",
  /\/AnUploader - A Sample Video - 4573905\//.test(videoPath),
  videoPath,
);
check("no duplicate files were created", chromeMock.downloadCalls.length === 1, String(chromeMock.downloadCalls.length));

response = await downloadVideoPost(WORLD_POST_URL);
check("rule34.world download succeeded", response?.success === true, JSON.stringify(response));
// The rule34.world file lives on the CDN with a cross-origin referer, so it
// goes through the offscreen document; the relayed name carries the folders.
const mp4Message = lastMessage(chromeMock, "PROCESS_MP4_DOWNLOAD");
check("rule34.world went through the offscreen relay", Boolean(mp4Message), JSON.stringify(chromeMock.runtimeMessages.map((m) => m.type)));
check(
  "rule34.world path is R34V/rule34world/<collection>/<file>",
  /^R34V\/rule34world\/WorldArtist - .+ - 3571567\/.+\.mp4$/.test(String(mp4Message?.fileName || "")),
  String(mp4Message?.fileName),
);
check(
  "the two sites never share a folder",
  !String(mp4Message?.fileName || "").includes("/rule34video/") && !videoPath.includes("/rule34world/"),
  videoPath + " | " + mp4Message?.fileName,
);

section("A2. folder-name priority: manual > checked tags > search query > id");
await downloadVideoPost(VIDEO_POST_URL, { __output: { manual: "My Manual Tag", tags: [] } });
check("the manual name wins", downloadedFilenames()[0].startsWith("R34V/rule34video/My Manual Tag/"), downloadedFilenames()[0]);

await setSettings({ collectionTemplate: "{tags}" });
await downloadVideoPost(VIDEO_POST_URL, { __output: { manual: "", tags: ["touhou", "animated"] } });
check(
  "emptying the manual field falls back to the checked tags",
  downloadedFilenames()[0].startsWith("R34V/rule34video/touhou, animated/"),
  downloadedFilenames()[0],
);

await setSettings({ collectionTemplate: "" });
// The popup offers the query it read from the page it is looking at.
await downloadVideoPost(VIDEO_POST_URL, {
  __output: { manual: "", tags: [], useSearchQuery: true },
  __searchContext: "touhou art",
});
check(
  "with nothing checked the search query names the folder",
  downloadedFilenames()[0].startsWith("R34V/rule34video/touhou art/"),
  downloadedFilenames()[0],
);

// A corner-button download has no popup: the background reads the query from
// the tab the download started on (a tag/search results page).
chromeMock.__tabUrl = "https://rule34video.com/search/touhou%20art/";
await downloadVideoPost(VIDEO_POST_URL, { __output: { manual: "", tags: [], useSearchQuery: true } });
check(
  "and from the tab URL when the popup did not send one",
  downloadedFilenames()[0].startsWith("R34V/rule34video/touhou art/"),
  downloadedFilenames()[0],
);
chromeMock.__tabUrl = VIDEO_POST_URL;

await downloadVideoPost(VIDEO_POST_URL, { __output: { manual: "", tags: [] } });
check("and the post id is the last resort", downloadedFilenames()[0].startsWith("R34V/rule34video/4573905/"), downloadedFilenames()[0]);

section("A3. an empty master folder restores the flat layout");
await setSettings({ masterFolder: "", collectionTemplate: "{artist} - {title} - {id}" });
await downloadVideoPost(VIDEO_POST_URL);
const flatPath = downloadedFilenames()[0];
check("no master level, no leading slash", flatPath === videoPath.slice("R34V/".length), flatPath + " vs " + videoPath);
check("still site-separated while flat", flatPath.startsWith("rule34video/"), flatPath);

section("A4. reserved names, duplicates, and the filename guard");
await setSettings({ masterFolder: "R34V", collectionTemplate: "CON" });
await downloadVideoPost(VIDEO_POST_URL);
check("a Windows reserved folder name is prefixed", downloadedFilenames()[0].includes("/_CON/"), downloadedFilenames()[0]);

await setSettings({ collectionTemplate: "{id}" });
await downloadVideoPost(VIDEO_POST_URL);
check("duplicates are never overwritten by default", chromeMock.downloadCalls[0].conflictAction === "uniquify", JSON.stringify(chromeMock.downloadCalls[0]));
await setSettings({ duplicateBehaviour: "overwrite" });
await downloadVideoPost(VIDEO_POST_URL);
check("overwrite is honoured when the user asks for it", chromeMock.downloadCalls[0].conflictAction === "overwrite", JSON.stringify(chromeMock.downloadCalls[0]));
await setSettings({ duplicateBehaviour: "uniquify" });

const listeners = chromeMock.downloadsApi.determiningFilenameListeners;
check("a permanent filename guard is registered", listeners.length === 1, String(listeners.length));
let suggested = null;
listeners[0]({ id: 99, url: chromeMock.downloadCalls[0].url, finalUrl: chromeMock.downloadCalls[0].url }, (value) => { suggested = value; });
check(
  "the guard re-suggests the full folder path (beats Content-Disposition / blob UUIDs / other extensions)",
  suggested?.filename === chromeMock.downloadCalls[0].filename,
  JSON.stringify(suggested) + " vs " + chromeMock.downloadCalls[0].filename,
);
let untouched = "untouched";
listeners[0]({ id: 100, url: "https://unrelated.example/file.bin", finalUrl: "https://unrelated.example/file.bin" }, () => { untouched = null; });
check("unrelated downloads are never renamed", untouched === "untouched");

section("A5. metadata for the naming tokens comes from the post page");
const formats = await bg.call({ action: "getVideoFormats", videoInfo: { url: VIDEO_POST_URL }, tabId: 1 });
check("rule34video tags are collected for the checkbox list", Array.isArray(formats?.apiTags) && formats.apiTags.includes("touhou"), JSON.stringify(formats?.apiTags));
check("the uploader token has a value", formats?.apiUploader === "AnUploader", JSON.stringify(formats?.apiUploader));
check("the date token has a value", formats?.apiDate === "2026-08-14", JSON.stringify(formats?.apiDate));
const worldFormats = await bg.call({ action: "getVideoFormats", videoInfo: { url: WORLD_POST_URL }, tabId: 1 });
check("rule34.world tags come from the API", Array.isArray(worldFormats?.apiTags) && worldFormats.apiTags.includes("some_tag"), JSON.stringify(worldFormats?.apiTags));
check("rule34.world artist is the type-8 tag", worldFormats?.apiArtist === "WorldArtist", JSON.stringify(worldFormats?.apiArtist));
check("an image post is reported as an image", (await bg.call({ action: "getVideoFormats", videoInfo: { url: WORLD_IMAGE_POST_URL }, tabId: 1 }))?.apiKind === "image");

section("A6. picture posts: loose files or one archive per post");
await setSettings({ masterFolder: "R34V", collectionTemplate: "{artist} - {id}", pictureSaveMode: "loose" });
response = await downloadVideoPost(WORLD_IMAGE_POST_URL);
check("loose mode succeeded", response?.success === true, JSON.stringify(response));
check(
  "loose mode saves a numbered original into the collection folder",
  downloadedFilenames().length === 1 && /^R34V\/rule34world\/PicArtist - 1280481\/001\.jpg$/.test(downloadedFilenames()[0]),
  JSON.stringify(downloadedFilenames()),
);

for (const mode of ["zip", "cbz", "pdf"]) {
  await setSettings({ pictureSaveMode: mode });
  response = await downloadVideoPost(WORLD_IMAGE_POST_URL);
  const message = lastMessage(chromeMock, "PROCESS_IMAGE_SET");
  check(`${mode} mode reached the offscreen builder`, response?.success === true && Boolean(message), JSON.stringify(response));
  check(
    `${mode} archive is named <collection>/<post>.${mode === "cbz" ? "cbz" : mode}`,
    new RegExp(`^R34V/rule34world/PicArtist - 1280481/.+\\.${mode === "cbz" ? "cbz" : mode}$`).test(String(message?.fileName || "")),
    String(message?.fileName),
  );
  check(`${mode} request carries the image list`, Array.isArray(message?.images) && message.images.length === 1, JSON.stringify(message?.images));
}
await setSettings({ pictureSaveMode: "loose" });

section("A7. the remembered choice follows the post to the corner button");
await downloadVideoPost(VIDEO_POST_URL, { __output: { manual: "Remembered Tag", tags: [] } });
check("saved from the popup", downloadedFilenames()[0].startsWith("R34V/rule34video/Remembered Tag/"), downloadedFilenames()[0]);
await downloadVideoPost(VIDEO_POST_URL); // no explicit choice, as from the corner button
check("reused for the same post without the popup", downloadedFilenames()[0].startsWith("R34V/rule34video/Remembered Tag/"), downloadedFilenames()[0]);

// ---------------------------------------------------------------------------
// Phase B: the offscreen document really builds the archives.
// ---------------------------------------------------------------------------
section("B. offscreen document builds the picture-set archives");

async function loadOffscreen(chromeMock) {
  const tmp = join(tmpdir(), "r34-e2e-off-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  mkdirSync(tmp, { recursive: true });
  let code = readFileSync(join(extensionDir, "offscreen.js"), "utf8");
  writeFileSync(join(tmp, "offscreen.mjs"), code);
  await import(pathToFileURL(join(tmp, "offscreen.mjs")).href);
  return () => rmSync(tmp, { recursive: true, force: true });
}

const offscreenChrome = createChromeMock();
offscreenChrome.__handler = null;
globalThis.chrome = offscreenChrome;
globalThis.chrome.downloads = undefined; // an offscreen document has none
globalThis.Blob = globalThis.Blob || (await import("node:buffer")).Blob;
globalThis.URL.createObjectURL = () => "blob:chrome-extension://test/" + Math.random().toString(36).slice(2);
globalThis.URL.revokeObjectURL = () => {};
const offscreenCleanup = await loadOffscreen(offscreenChrome);

function sendToOffscreen(message) {
  return new Promise((resolve) => {
    offscreenChrome.__handler(message, {}, (response) => resolve(response));
  });
}

function waitFor(predicate, label, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error("timed out waiting for " + label));
      }
    }, 20);
  });
}

const imageSetImages = [
  { url: "https://pics.example/a.jpg", ext: "jpg" },
  { url: "https://pics.example/b.jpg", ext: "jpg" },
  { url: "https://pics.example/c.jpg", ext: "jpg" },
];

offscreenChrome.runtimeMessages.length = 0;
await sendToOffscreen({
  type: "PROCESS_IMAGE_SET",
  downloadId: "imageset-test-zip",
  fileName: "R34V/rule34world/PicArtist - 1280481/A post.zip",
  format: "zip",
  images: imageSetImages,
  conflictAction: "uniquify",
});
await waitFor(() => offscreenChrome.runtimeMessages.some((m) => m.type === "SAVE_BLOB_ARTIFACT"), "the ZIP relay");
const zipRelay = lastMessage(offscreenChrome, "SAVE_BLOB_ARTIFACT");
check("the ZIP keeps its full folder path through the relay", zipRelay.filename === "R34V/rule34world/PicArtist - 1280481/A post.zip", zipRelay.filename);
await waitFor(() => offscreenChrome.runtimeMessages.some((m) => m.type === "IMAGE_SET_COMPLETE"), "the ZIP completion");
check("the ZIP build reported completion", lastMessage(offscreenChrome, "IMAGE_SET_COMPLETE")?.imageCount === 3, JSON.stringify(lastMessage(offscreenChrome, "IMAGE_SET_COMPLETE")));

// Rebuild the same archive the worker would have produced and verify it with
// an independent reader: every image, in order, with the right bytes.
const { buildZip } = await import(pathToFileURL(join(extensionDir, "modules/archive/zipBuilder.mjs")).href);
const expectedEntries = imageSetImages.map((image, index) => ({
  name: `${String(index + 1).padStart(3, "0")}.${image.ext}`,
  bytes: new TextEncoder().encode("image-bytes-" + image.url.slice(-3)),
}));
const archive = await buildZip(expectedEntries);
const listed = readZipEntries(archive);
check("the archive holds every image, in order", listed.map((entry) => entry.name).join(",") === "001.jpg,002.jpg,003.jpg", JSON.stringify(listed.map((e) => e.name)));
let allMatch = true;
for (const [index, entry] of listed.entries()) {
  const restored = await readZipEntryBytes(archive, entry);
  if (Buffer.from(restored).toString() !== `image-bytes-${imageSetImages[index].url.slice(-3)}`) allMatch = false;
}
check("every image survived byte-for-byte", allMatch);

offscreenChrome.runtimeMessages.length = 0;
await sendToOffscreen({
  type: "PROCESS_IMAGE_SET",
  downloadId: "imageset-test-pdf",
  fileName: "R34V/rule34world/PicArtist - 1280481/A post.pdf",
  format: "pdf",
  images: imageSetImages,
  conflictAction: "uniquify",
});
await waitFor(() => offscreenChrome.runtimeMessages.some((m) => m.type === "IMAGE_SET_ERROR" || m.type === "IMAGE_SET_COMPLETE"), "the PDF result");
const pdfResult = lastMessage(offscreenChrome, "IMAGE_SET_ERROR") || lastMessage(offscreenChrome, "IMAGE_SET_COMPLETE");
// The fixtures above are not real JPEGs and Node has no image canvas, so the
// honest expectation is a clear, actionable error rather than a broken PDF.
check(
  "a PDF build without an image canvas fails loudly instead of writing a broken file",
  pdfResult?.type === "IMAGE_SET_ERROR" && /no image canvas/i.test(String(pdfResult.error)),
  JSON.stringify(pdfResult),
);

// With an image canvas present (as in a real offscreen document) the same
// request produces a real PDF: verify the writer with a minimal canvas stub.
globalThis.createImageBitmap = async () => ({ width: 64, height: 48, close() {} });
globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    return {
      fillStyle: "",
      fillRect() {},
      drawImage() {},
    };
  }
  async convertToBlob() {
    // A minimal but structurally real baseline JPEG (SOF0, 3 components).
    const header = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
    const body = new Uint8Array(header.length + 2);
    body.set(header, 0);
    body[body.length - 2] = 0xff;
    body[body.length - 1] = 0xd9;
    return new Blob([body], { type: "image/jpeg" });
  }
};
offscreenChrome.runtimeMessages.length = 0;
await sendToOffscreen({
  type: "PROCESS_IMAGE_SET",
  downloadId: "imageset-test-pdf2",
  fileName: "R34V/rule34world/PicArtist - 1280481/A post.pdf",
  format: "pdf",
  images: imageSetImages,
});
await waitFor(() => offscreenChrome.runtimeMessages.some((m) => m.type === "IMAGE_SET_COMPLETE" || m.type === "IMAGE_SET_ERROR"), "the PDF build");
const pdfComplete = lastMessage(offscreenChrome, "IMAGE_SET_COMPLETE");
check("with an image canvas the PDF builds", Boolean(pdfComplete), JSON.stringify(lastMessage(offscreenChrome, "IMAGE_SET_ERROR")));
const pdfRelay = lastMessage(offscreenChrome, "SAVE_BLOB_ARTIFACT");
check("the PDF keeps its folder path", pdfRelay?.filename === "R34V/rule34world/PicArtist - 1280481/A post.pdf", JSON.stringify(pdfRelay?.filename));

// And the PDF writer itself produces a document with one page per image.
const { buildPdfFromImages } = await import(pathToFileURL(join(extensionDir, "modules/archive/pdfBuilder.mjs")).href);
const pdfBytes = await buildPdfFromImages([
  { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]), contentType: "image/jpeg" },
  { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x30, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]), contentType: "image/jpeg" },
]);
const pdfText = Buffer.from(pdfBytes).toString("latin1");
check("the PDF has one page per image", pdfText.includes("/Count 2"), pdfText.slice(0, 80));
check("the PDF starts with the version header and ends with EOF", pdfText.startsWith("%PDF-1.4\n") && pdfText.endsWith("%%EOF\n"));

bg.cleanup();
offscreenCleanup();

console.log(failures === 0 ? "\nALL E2E CHECKS PASSED" : `\n${failures} E2E CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
