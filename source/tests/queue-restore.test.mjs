// Regression suite for the persistent session queue's restore-on-startup path.
//
// The real background-enhanced.js is loaded in Node with a mocked `chrome.*`
// whose storage is PRE-SEEDED with a persisted queue, so `restoreQueueState()`
// runs for real at import time and the result is observed through the public
// `getQueueItems` message.
//
// It exists because of a bug that every other suite was blind to: the restore
// path called `chrome.downloads.get(id)`, which is not part of the Chrome
// extensions API (the single-item lookup is `search({ id })`). The call threw
// on every restart, the `catch` swallowed it as "not alive", and so EVERY
// in-flight chrome download was dropped from the concurrency accounting after
// a service-worker restart. The mock below only implements `search`, exactly
// like the real API, so a regression fails here instead of shipping.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.on("unhandledRejection", () => {});

const QUEUE_STATE_STORAGE_KEY = "r34.queueState.v1";
const now = Date.now();

// A live chrome download (re-track it), a finished one (drop it), and a temp
// `queue-job-N` key persisted before a chrome id existed (drop it).
const persisted = {
  queued: [
    {
      queuedId: "queued-1",
      videoInfo: { url: "https://rule34video.com/video/1/a", title: "Waiting Post" },
      enqueuedAt: now,
    },
  ],
  batch: [{ url: "https://rule34.world/post/999", enqueuedAt: now }],
  active: [
    { key: "77", title: "Live Download", url: "https://rule34video.com/video/77/x", startedAt: now },
    { key: "88", title: "Finished Download", url: "https://rule34video.com/video/88/x", startedAt: now },
    { key: "queue-job-3", title: "Temp Key", url: "", startedAt: now },
  ],
};

const downloadStates = { 77: "in_progress", 88: "complete" };
const searchCalls = [];

globalThis.__handler = null;
// A concurrency limit of 1 keeps the restored job WAITING instead of being
// dispatched immediately by the restore-time pump, so the queued list stays
// observable.
const store = { [QUEUE_STATE_STORAGE_KEY]: persisted, downloadConcurrencyLimit: 1 };

globalThis.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {};
        for (const k of Array.isArray(keys) ? keys : Object.keys(keys || store)) {
          if (k in store) out[k] = store[k];
        }
        return cb ? cb(out) : Promise.resolve(out);
      },
      set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
      remove: (k) => { delete store[k]; return Promise.resolve(); },
      onChanged: { addListener() {} },
    },
    sync: {
      get: (_keys, cb) => (cb ? cb({}) : Promise.resolve({})),
      set: () => {}, remove: () => {}, onChanged: { addListener() {} },
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
    // Deliberately NO `get`: the real chrome.downloads API has none.
    search: (query) => {
      searchCalls.push(query);
      const state = downloadStates[String(query?.id)];
      return Promise.resolve(state ? [{ id: query.id, state }] : []);
    },
    download: (_o, cb) => (cb ? cb(1) : Promise.resolve(1)),
    onCreated: { addListener() {} },
    onChanged: { addListener() {} },
    onDeterminingFilename: { addListener() {}, removeListener() {} },
  },
  notifications: { create() {} },
  contextMenus: { onClicked: { addListener() {} }, create() {} },
  tabs: {
    query: () => Promise.resolve([]),
    sendMessage() {}, get() {}, create() {}, remove() {},
    onUpdated: { addListener() {} },
  },
  scripting: { executeScript() {} },
  offscreen: {},
  declarativeNetRequest: { updateSessionRules() {} },
};

// Record what the restored batch actually reaches for, so "the batch was
// restored" can be asserted even though the batch pump drains it immediately.
const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

// Copy the shipped classic scripts into a temp dir as ESM, as the other suites do.
const tmp = join(tmpdir(), "r34-queue-restore-" + Date.now());
mkdirSync(tmp, { recursive: true });
const srcDir = join(process.cwd(), "extension");
for (const [src, dst] of Object.entries({
  "background-enhanced.js": "background-enhanced.mjs",
  "site-config.js": "site-config.mjs",
  "logger.js": "logger.mjs",
  "background-bridge.js": "background-bridge.mjs",
  "folder-naming.js": "folder-naming.mjs",
})) {
  const code = readFileSync(join(srcDir, src), "utf8")
    .replace(/from\s+['"]\.\/([\w-]+)\.js['"]/g, "from './$1.mjs'")
    .replace(/import\s+['"]\.\/([\w-]+)\.js['"]/g, "import './$1.mjs'");
  writeFileSync(join(tmp, dst), code);
}

await import(join(tmp, "background-enhanced.mjs"));
const handler = globalThis.__handler;

// restoreQueueState() is fired without await at module scope; give its
// storage + downloads.search round-trips a tick to settle.
await new Promise((resolve) => setTimeout(resolve, 150));

const items = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("getQueueItems timed out")), 5000);
  handler({ action: "getQueueItems" }, {}, (response) => { clearTimeout(t); resolve(response); });
});

test("the live chrome download is looked up with search({id}), not the non-existent get()", () => {
  assert.ok(searchCalls.length > 0, "restore never queried chrome.downloads at all");
  for (const call of searchCalls) {
    assert.ok("id" in call, `search() was called without an id: ${JSON.stringify(call)}`);
  }
});

test("an in_progress download is re-tracked so its concurrency slot survives a restart", () => {
  const keys = items.active.map((entry) => entry.key);
  assert.ok(keys.includes("77"), `live download 77 was dropped; active=${JSON.stringify(keys)}`);
});

test("a finished download is not re-tracked", () => {
  assert.ok(!items.active.some((entry) => entry.key === "88"));
});

test("a temp queue-job key never blocks a slot", () => {
  assert.ok(!items.active.some((entry) => entry.key.startsWith("queue-job-")));
});

test("a waiting job is restored and stays queued behind the limit of 1", () => {
  assert.equal(items.queued.length, 1);
  assert.equal(items.queued[0].title, "Waiting Post");
});

test("the pending batch is restored and handed to the batch pump", () => {
  // batchPending is 0 by the time we look because the restore pump already
  // drained it — the observable proof is that the post was actually resolved.
  assert.ok(
    fetched.some((url) => url.includes("/post/999")),
    `restored batch post was never resolved; fetched=${JSON.stringify(fetched)}`,
  );
});

test.after(() => rmSync(tmp, { recursive: true, force: true }));
