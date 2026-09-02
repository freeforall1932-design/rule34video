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
import { readdirSync, readFileSync } from "node:fs";
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

// --- report ----------------------------------------------------------------
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\nvalidation FAILED (${problems.length} problem(s))`);
  process.exit(1);
}
console.log(
  `validation OK — ${classicScripts.length} classic scripts, ${modules.length} modules, 1 ESM worker, 3 JSON files, branding clean`,
);
