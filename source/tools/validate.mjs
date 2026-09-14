// Offline validation for the shipped extension: syntax, JSON, branding.
//
// This is the single source of truth used by BOTH `npm run check:syntax` and
// the `validate` job in .github/workflows/ci.yml. It replaces a hand-maintained
// file list that was duplicated (and drifted) between a bash loop in the
// workflow and a one-liner in package.json: every classic script is simply
// "every extension/*.js except the ESM service worker", so the list is derived
// from disk instead of typed out and no new file can be silently skipped.
//
//   node source/tools/validate.mjs

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = process.cwd();
const extDir = join(repoRoot, "extension");

const problems = [];
const fail = (message) => problems.push(message);
const rel = (path) => relative(repoRoot, path).replaceAll("\\", "/");

// --- 1. JavaScript syntax --------------------------------------------------
// `node --check` parses without executing. Content scripts and the popup are
// classic scripts; background-enhanced.js is an ES module ("type": "module" in
// the manifest) and must be checked as one.
const ESM_ENTRY = "background-enhanced.js";

function checkSyntax(absPath, sourceType) {
  const args = sourceType === "module"
    ? ["--input-type=module", "--check"]
    : ["--check", absPath];
  try {
    execFileSync(process.execPath, args, {
      input: sourceType === "module" ? readFileSync(absPath, "utf8") : undefined,
      stdio: ["pipe", "ignore", "pipe"],
    });
  } catch (error) {
    fail(`syntax: ${rel(absPath)}\n${String(error.stderr || error.message).trim()}`);
  }
}

function walk(dir, predicate, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (predicate(entry.name)) out.push(full);
  }
  return out;
}

const classicScripts = readdirSync(extDir)
  .filter((name) => name.endsWith(".js") && name !== ESM_ENTRY)
  .sort()
  .map((name) => join(extDir, name));

// The Node-side icon generator lives outside the extension but still ships in
// the repo, so it is syntax-checked here too.
classicScripts.push(join(repoRoot, "source/tools/generate-icons.js"));

const modules = walk(join(extDir, "modules"), (name) => name.endsWith(".mjs")).sort();

for (const file of classicScripts) checkSyntax(file, "script");
for (const file of modules) checkSyntax(file, "module");
checkSyntax(join(extDir, ESM_ENTRY), "module");

// --- 2. JSON ---------------------------------------------------------------
for (const jsonPath of [
  join(extDir, "manifest.json"),
  join(repoRoot, "source/tools/app.config.json"),
  join(repoRoot, "package.json"),
]) {
  try {
    JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (error) {
    fail(`json: ${rel(jsonPath)} — ${error.message}`);
  }
}

const manifestJson = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));

// --- 3. Branding: no paywall/auth remnants ---------------------------------
// The extension was retrofitted from a paid product; these markers must never
// come back. Only the shipped extension is scanned (source/ is a documented
// scrapyard that is never packaged).
const FORBIDDEN = /auth\.serp\.co|serp\.ly|serpapps|ensureDownloadAccess|checkActivated|isActivated|auth-ui\.js|trial-banner\.js|gumroad|activationTitle/i;
const SCANNED = /\.(js|mjs|json|html|css)$/;

for (const file of walk(extDir, (name) => SCANNED.test(name))) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (FORBIDDEN.test(line) && !/Rule34/i.test(line)) {
      fail(`forbidden paywall remnant: ${rel(file)}:${index + 1}: ${line.trim().slice(0, 120)}`);
    }
  });
}

// --- 4. Stale references: every path the manifest or a page points at must exist
// A retired file that is still listed in the manifest is a load-time crash, and a
// <script src> to a deleted file fails silently. Both are invisible to `--check`.
for (const [label, relPath] of [
  ["background.service_worker", manifestJson.background?.service_worker],
  ["side_panel.default_path", manifestJson.side_panel?.default_path],
  ["action.default_popup", manifestJson.action?.default_popup],
].filter(([, p]) => p)) {
  if (!existsSync(join(extDir, relPath))) fail(`stale reference: ${label} -> ${relPath} does not exist`);
}
for (const [size, iconPath] of Object.entries(manifestJson.icons || {})) {
  if (!existsSync(join(extDir, iconPath))) fail(`stale reference: icons.${size} -> ${iconPath} does not exist`);
}
for (const [i, cs] of (manifestJson.content_scripts || []).entries()) {
  for (const js of cs.js || []) {
    if (!existsSync(join(extDir, js))) fail(`stale reference: content_scripts[${i}].js -> ${js} does not exist`);
  }
}
for (const htmlFile of walk(extDir, (name) => name.endsWith(".html"))) {
  for (const m of readFileSync(htmlFile, "utf8").matchAll(/(?:src|href)="([^"{}]+\.(?:js|css))"/g)) {
    const ref = m[1].split("?")[0];
    if (!existsSync(join(extDir, ref))) fail(`stale reference: ${rel(htmlFile)} -> ${m[1]} does not exist`);
  }
}

// Hosts a content script may fire on, and hosts the worker may talk to, must be the
// same set: a route in site-routes.js that no manifest pattern allows is dead on
// arrival (and is exactly what a half-finished rename of a cloned repo leaves behind).
const hostOf = (pattern) => {
  try {
    const normalized = String(pattern).replace(/^\*:\/\//, "https://").replace(/^(https?):\/\/\*\./, "$1://sub.");
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const declaredHosts = new Set();
for (const pattern of [
  ...(manifestJson.host_permissions || []),
  ...(manifestJson.content_scripts || []).flatMap((cs) => cs.matches || []),
]) {
  const host = hostOf(pattern);
  if (!host) continue;
  declaredHosts.add(host);
  // `*.host.com` authorises host.com itself, and a bare host.com does not authorise
  // every subdomain — but the manifest here lists both forms, so keep both readable.
  const labels = host.split(".");
  if (labels.length > 2) declaredHosts.add(labels.slice(-2).join("."));
}
const siteConfigSource = readFileSync(join(extDir, "site-config.js"), "utf8");
for (const m of siteConfigSource.matchAll(/"(https?:\/\/[^"]+?\/\*)"/g)) {
  const host = hostOf(m[1]);
  if (host && !declaredHosts.has(host) && !declaredHosts.has(host.split(".").slice(-2).join("."))) {
    fail(`undeclared host in site-config.js: ${host} (not in manifest host_permissions/content_scripts)`);
  }
}

// --- 5. Host inventory: no site may be referenced unless it is declared here ----
// This repo was cloned from a universal multi-site template, so the worker still
// carries CDN/ad-network names for sites it cannot reach. Those are tracked
// explicitly below: the list can only ever SHRINK, and any new host must be
// justified here or moved to source/retired/generic-hoster/.
const SUPPORTED_HOSTS = new Set([
  "rule34video.com",
  "rule34.world",
  "rule34.xyz",
  "b-cdn.net",
  "github.com",
  "githubusercontent.com",
  "gstatic.com",
  "googleapis.com",
  "w3.org",
]);
// Kept deliberately: inert for the two supported sites, but load-bearing if a
// specific hoster is ever enabled. See source/retired/generic-hoster/README.md.
// This list may only ever SHRINK: an entry with nothing behind it lets the next
// person re-add that host without thinking. Entries deleted 2026-09-14 once the
// observed-media predicates were retired: streamtape.*, dood.*, phncdn.com,
// playhubconnect.com, mmcdn.com, psmcdn.net, adtng.com, itsup.com, mydaddy.cc,
// cloudflarestream.com, videodelivery.net, sa.com.
const ALLOWED_HOSTER_HOSTS = new Set([
  "xiaoshenke.net",
  "xtremestream.xyz",
  "aki-h.stream",
  "erome.com",
  "workers.dev",
]);
// Only our own first-party files are inventoried: extension/modules/** is vendored
// third-party code (its comments carry the upstream author's URLs) and CSS cannot
// name a network peer we talk to, so both are out of scope by design.
// One label + a TLD is enough: hostnames here appear as "a.com", /a\.com$/,
// /a[.]com/ and "x.y.z.com", and the trailing two labels are what matters.
const HOST_RE = /\b([a-z0-9](?:[a-z0-9-]{0,30})?)\.(com|net|org|xyz|stream|world|dev|cc|app|site|info|live|me|co|to|io)\b/gi;
// Identifier noise that structurally looks like a domain (property accesses,
// CSS class chains). Deliberately a blocklist rather than a whitelist of shapes:
// a blocklisted name can only ever hide `x.<tld>`, which no real host in this
// repo is written as.
const HOST_NOISE = new Set([
  "this", "that", "window", "global", "index", "item", "route", "node", "ctx", "opts", "args",
  "props", "state", "event", "error", "console", "result", "response", "settings", "filter",
  "output", "outputtarget", "target", "request", "context", "spec", "kind", "type", "badge",
  "panel", "details", "value", "list", "entry", "token", "site", "startfragrequested", "eyebrow",
  "el", "e", "t", "n", "r", "s", "i", "o", "a", "l", "d", "c", "m", "p", "q", "v", "w", "x", "y", "z", "b", "f", "g", "h", "j", "k", "u",
]);
function externalHosts(text) {
  // hostnames are written 3 ways in this codebase: "a.b.com", /a\.b\.com/ and /a[.]b[.]com/
  const flat = text.replace(/\[\.\]/g, ".").replace(/\\\./g, ".").replace(/\./g, ".").toLowerCase();
  const out = new Set();
  for (const m of flat.matchAll(HOST_RE)) {
    if (m[1].length < 3 || HOST_NOISE.has(m[1])) continue;
    out.add(`${m[1]}.${m[2]}`);
  }
  return out;
}
const FIRST_PARTY = (name, dir) => !dir.includes(join(extDir, "modules")) && /\.(js|mjs|json|html)$/.test(name);
const firstPartyFiles = walk(extDir, () => true).filter((f) => {
  const base = f.split("/").pop();
  return FIRST_PARTY(base, f.slice(0, -base.length));
});
// TLD lists are never exhaustive, so *every* URL literal is inventoried too: that
// is how the extension reaches a host at all, and it catches `.biz`-style TLDs.
function urlLiteralHosts(text) {
  const out = new Set();
  // any quoted string that is a URL or a match-pattern ("*://*.host/*")
  for (const m of text.matchAll(/["'`]([^"'`\n]{4,240})["'`]/g)) {
    const literal = m[1].trim().toLowerCase();
    const match = literal.match(/^(?:\*:|https?:|ftp:)\/\/([^/?#\s]+)/);
    if (!match) continue;
    const host = match[1].replace(/^\*\./, "").replace(/:\d+$/, "");
    const labels = host.split(".").filter((label) => label && label !== "*");
    if (labels.length < 2) continue;
    out.add(labels.slice(-2).join("."));
  }
  return out;
}

for (const file of firstPartyFiles) {
  const text = readFileSync(file, "utf8");
  const hosts = new Set([...externalHosts(text), ...urlLiteralHosts(text)]);
  for (const host of hosts) {
    if (SUPPORTED_HOSTS.has(host) || ALLOWED_HOSTER_HOSTS.has(host) || declaredHosts.has(host)) continue;
    fail(`undeclared host: ${host} in ${rel(file)} — add it to SUPPORTED_HOSTS (a site this repo serves), to ALLOWED_HOSTER_HOSTS (a generic-hoster branch kept for a future site), or delete the reference; see source/retired/generic-hoster/`);
  }
}

// --- report ----------------------------------------------------------------
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\nvalidation FAILED (${problems.length} problem(s))`);
  process.exit(1);
}
console.log(
  `validation OK — ${classicScripts.length} classic scripts, ${modules.length} modules, 1 ESM worker, 3 JSON files, branding clean`,
);
