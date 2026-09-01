// Committed smoke/integration test for the extension service worker.
//
// Loads the REAL background-enhanced.js in Node with mocked `chrome.*` + `fetch`,
// then exercises the two highest-value code paths end-to-end:
//   1. getVideoFormats for a rule34.world post (real resolver logic)
//   2. bulkDownloadTag (rule34.world cursor-paginated search -> batch enqueue)
//
// Run from the repo root:  node source/tests/smoke.mjs
// CI runs this on every push/PR.

import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Don't let an async error in the (fire-and-forget) batch pipeline fail the run.
process.on("unhandledRejection", (err) => {
  console.warn("non-fatal unhandledRejection during background processing:", err?.message || err);
});

// ---------------------------------------------------------------------------
// 1. Mock chrome + fetch
// ---------------------------------------------------------------------------
globalThis.__handler = null;
const chromeMock = {
  storage: {
    local: {
      get: (_keys, cb) => (cb ? cb({}) : Promise.resolve({})),
      set: () => {},
      remove: () => {},
      onChanged: { addListener() {} },
    },
    // Output-organization settings (master folder, collection template, ...)
    // live in sync storage; the background falls back to its defaults when a
    // key is absent, so an empty store is a valid fixture.
    sync: {
      get: (_keys, cb) => (cb ? cb({}) : Promise.resolve({})),
      set: () => {},
      remove: () => {},
      onChanged: { addListener() {} },
    },
  },
  runtime: {
    onMessage: { addListener: (h) => { globalThis.__handler = h; } },
    onInstalled: { addListener() {} },
    onSuspend: { addListener() {} },
    getURL: () => "chrome-extension://test/",
  },
  webRequest: { onBeforeRequest: { addListener() {} } },
  downloads: {
    download: (_options, cb) => (cb ? cb(1) : Promise.resolve(1)),
    onCreated: { addListener() {} },
    onChanged: { addListener() {} },
    onDeterminingFilename: { addListener() {}, removeListener() {} },
  },
  notifications: { create() {} },
  contextMenus: { onClicked: { addListener() {} }, create() {} },
  tabs: {
    query: () => Promise.resolve([]),
    sendMessage() {},
    get() {},
    create() {},
    remove() {},
    onUpdated: { addListener() {} },
  },
  scripting: { executeScript() {} },
  offscreen: {},
  declarativeNetRequest: { updateSessionRules() {} },
};
globalThis.chrome = chromeMock;

const worldPost = {
  id: 3571567,
  type: 1,
  duration: 12,
  files: { "100": [1], "101": [0], "102": [0], "10": [1] },
  tags: [{ type: 8, value: "SmokeArtist" }, { type: 0, value: "some_tag" }],
};

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/api/v2/post/3571567")) {
    return { ok: true, status: 200, json: async () => worldPost, text: async () => JSON.stringify(worldPost) };
  }
  // host probe sample path (both CDN + origin resolve to keep the resolver happy)
  if (u.includes("/posts/3571/3571567/")) {
    return { ok: true, status: 200, body: { cancel() {} }, json: async () => ({}), text: async () => "" };
  }
  if (u.includes("/api/v2/post/search/root")) {
    return { ok: true, status: 200, json: async () => ({ items: [{ id: 3571567 }], cursor: null }), text: async () => "" };
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

// ---------------------------------------------------------------------------
// 2. Copy the background module + its 3 imports into a temp dir as .mjs
//    (the extension ships classic .js; Node needs ESM to import it) and rewrite
//    the relative import specifiers.
// ---------------------------------------------------------------------------
const tmp = join(tmpdir(), "r34-smoke-" + Date.now());
mkdirSync(tmp, { recursive: true });
const srcDir = join(process.cwd(), "extension");
const files = {
  "background-enhanced.js": "background-enhanced.mjs",
  "site-config.js": "site-config.mjs",
  "logger.js": "logger.mjs",
  "background-bridge.js": "background-bridge.mjs",
  "folder-naming.js": "folder-naming.mjs",
};
for (const [src, dst] of Object.entries(files)) {
  let code = readFileSync(join(srcDir, src), "utf8");
  code = code
    .replace(/from\s+['"]\.\/([\w-]+)\.js['"]/g, "from './$1.mjs'")
    .replace(/import\s+['"]\.\/([\w-]+)\.js['"]/g, "import './$1.mjs'");
  writeFileSync(join(tmp, dst), code);
}

const mod = await import(join(tmp, "background-enhanced.mjs"));
const handler = globalThis.__handler;
if (typeof handler !== "function") throw new Error("background did not register an onMessage handler");

// ---------------------------------------------------------------------------
// 3. Exercise getVideoFormats (real rule34.world resolver)
// ---------------------------------------------------------------------------
function callHandler(request, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) { done = true; reject(new Error("handler timed out")); }
    }, timeoutMs);
    handler(request, {}, (resp) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(resp);
    });
  });
}

const fmt = await callHandler({ action: "getVideoFormats", videoInfo: { url: "https://rule34.world/post/3571567" } });
if (!fmt || !fmt.success) throw new Error("getVideoFormats failed: " + JSON.stringify(fmt));
if (!Array.isArray(fmt.formats) || !fmt.formats.length) throw new Error("getVideoFormats returned no formats");
if (!fmt.apiTitle || !/SmokeArtist/.test(fmt.apiTitle)) throw new Error("artist not extracted into apiTitle: " + fmt.apiTitle);
console.log(`SMOKE OK (getVideoFormats): ${fmt.formats.length} formats; title="${fmt.apiTitle}"`);

// ---------------------------------------------------------------------------
// 4. Exercise bulkDownloadTag (rule34.world search -> enqueue)
// ---------------------------------------------------------------------------
const bulk = await callHandler(
  { action: "bulkDownloadTag", tags: "some_tag", site: "https://rule34.world/post/1" },
  10000,
);
if (!bulk || !bulk.success) throw new Error("bulkDownloadTag failed: " + JSON.stringify(bulk));
if (!bulk.accepted) throw new Error("bulkDownloadTag accepted 0 posts");
console.log(`SMOKE OK (bulkDownloadTag): accepted ${bulk.accepted} post(s)`);

rmSync(tmp, { recursive: true, force: true });
console.log("ALL SMOKE TESTS PASSED");
void mod;
