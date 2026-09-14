// Why the observed-media predicates carry no foreign hostnames — and the check
// that keeps that reasoning true.
//
// `rememberObservedRequest` is the ONLY writer into the observed-media maps, and
// Chrome only ever invokes a webRequest listener for URLs matching its `urls`
// filter. So every predicate fed by it (looksObservedPlayable, looksObservedAdMedia,
// observedFormat, …) can only ever see the hosts that filter admits. A hostname test
// for any other domain inside those functions is therefore dead on arrival — that is
// exactly how the retired generic-hoster branches were justified
// (source/docs/DEADCODE_SWEEP.md, source/retired/generic-hoster/).
//
// This file proves the *premise*, not just the conclusion: if the filter is widened,
// or a foreign host is added to one of those predicates, the sweep's justification
// stops holding and CI says so.
//
// Run: node --test source/tests/hoster-reachability.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const extDir = join(root, "extension");
const src = readFileSync(join(extDir, "background-enhanced.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));

// The sites this extension supports. Mirrors are allowed (same site, other TLD);
// a foreign host is not, because nothing here is expected to serve media from one.
const SUPPORTED = new Set(["rule34video.com", "rule34.world", "rule34.xyz", "b-cdn.net"]);
const supportedHost = (host) =>
  [...SUPPORTED].some((site) => host === site || host.endsWith("." + site));

// --- source helpers --------------------------------------------------------
function bodyOf(name) {
  const start = src.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start !== -1, `${name}() is gone from the shipped worker`);
  const from = src.slice(start);
  let depth = 0;
  let i = 0;
  for (; i < from.length; i++) {
    if (from[i] === "{") depth++;
    else if (from[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return from.slice(0, i + 1);
}

// hostnames appear as "a.com", /a\.com$/ and /a[.]com/ — normalise all three
function hostsNamed(text) {
  const flat = text
    .replace(/\[\.\]/g, ".")
    .replace(/\\\./g, ".")
    .replace(/\\\\/g, "\\")
    .toLowerCase();
  const found = new Set();
  for (const m of flat.matchAll(/\b([a-z0-9](?:[a-z0-9-]{1,30})?)\.(com|net|org|xyz|stream|world|cc)\b/g)) {
    // only TLDs real hosts here use are matched, so `logger.info` / `spec.to`
    // style property accesses cannot be read as domains
    found.add(`${m[1]}.${m[2]}`);
  }
  return found;
}

const OBSERVED_CHAIN = [
  "rememberObservedRequest",
  "rememberObservedMedia",
  "looksObservedPlayable",
  "looksObservedAdMedia",
  "observedFormat",
  "observedMediaFormats",
  "originOf",
];

describe("observed-media reachability premise", () => {
  it("has exactly one writer, registered as a filtered webRequest listener", () => {
    const registrations = src.match(/chrome\.webRequest\.onBeforeRequest\.addListener\(\s*rememberObservedRequest/g) || [];
    assert.equal(registrations.length, 1, "rememberObservedRequest must stay registered exactly once");
    assert.match(src, /__rule34ObservedMediaListenerInstalled/, "the install guard is what keeps it a single registration");
  });

  it("admits only supported hosts through that filter", () => {
    const at = src.indexOf("addListener(\n      rememberObservedRequest");
    assert.ok(at !== -1, "listener registration not found in the expected shape");
    const block = src.slice(at, src.indexOf("],", at));
    const patterns = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(patterns.length >= 4, `expected the filter to list the supported hosts, got ${patterns.length}`);
    for (const pattern of patterns) {
      const host = pattern.replace(/^\*:\/\//, "").replace(/^https?:\/\//, "").replace(/^\*\./, "").replace(/\/\*$/, "");
      assert.ok(supportedHost(host), `listener filter admits a host this repo does not serve: ${host}`);
    }
  });

  it("carries no foreign-host predicate in the chain that filter feeds", () => {
    for (const name of OBSERVED_CHAIN) {
      for (const host of hostsNamed(bodyOf(name))) {
        assert.ok(
          supportedHost(host),
          `${name}() tests for ${host}: either the listener filter was widened (this code is live again) or the test belongs in the site adapter instead`,
        );
      }
    }
  });

  it("keeps the path/extension predicates that a supported URL CAN match", () => {
    // These look like leftovers but are not host-anchored, so rule34video.com can
    // legitimately serve one of these shapes; deleting them would change behaviour.
    const body = bodyOf("looksObservedPlayable");
    for (const probe of ["m3u8", "xs1\\.php", "cf-master", "sora", "sprite|thumbnail"]) {
      assert.ok(body.includes(probe), `looksObservedPlayable() lost the reachable shape ${probe}`);
    }
    assert.ok(bodyOf("looksObservedAdMedia").includes("roomad"), "ad-path filtering must stay");
  });

  it("never mixes the manifest's permissions with what the chain assumes", () => {
    const allowed = (manifest.host_permissions || []).map((p) =>
      p.replace(/^\*:\/\//, "").replace(/^https?:\/\//, "").replace(/^\*\./, "").replace(/\/\*$/, ""),
    );
    for (const host of allowed) {
      if (host === "api.github.com") continue; // update checks, not media
      assert.ok(supportedHost(host), `host_permissions grants ${host}, which the observed-media chain no longer supports`);
    }
  });
});

describe("host inventory stays honest", () => {
  const validateSrc = readFileSync(join(root, "source/tools/validate.mjs"), "utf8");
  const setFrom = (name) => {
    const at = validateSrc.indexOf(`const ${name} = new Set([`);
    assert.ok(at !== -1, `${name} is gone from validate.mjs`);
    const block = validateSrc.slice(at, validateSrc.indexOf("]);", at));
    return [...block.matchAll(/"([a-z0-9][a-z0-9.-]*\.[a-z]{2,})"/g)].map((m) => m[1]);
  };

  it("ALLOWED_HOSTER_HOSTS has no entry that nothing references", () => {
    const shipped = [];
    (function walk(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          // vendored modules are excluded from the inventory by design
          if (!full.endsWith("modules")) walk(full);
        } else if (/\.(js|mjs|json|html)$/.test(e.name)) shipped.push(readFileSync(full, "utf8"));
      }
    })(extDir);
    const text = shipped.join("\n").replace(/\[\.\]/g, ".").replace(/\\\./g, ".").toLowerCase();
    for (const host of setFrom("ALLOWED_HOSTER_HOSTS")) {
      const label = host.split(".").slice(-2)[0];
      assert.ok(
        text.includes(label),
        `${host} is allowlisted but nothing references it — drop it, or the next person re-adds that host without thinking`,
      );
    }
  });

  it("SUPPORTED_HOSTS covers every host the manifest grants", () => {
    const supported = new Set(setFrom("SUPPORTED_HOSTS"));
    for (const host of [...supported]) assert.ok(host.includes("."), `malformed allowlist entry ${host}`);
    for (const host of ["rule34video.com", "rule34.world"]) {
      assert.ok(supported.has(host), `${host} must be a supported host`);
    }
  });
});
