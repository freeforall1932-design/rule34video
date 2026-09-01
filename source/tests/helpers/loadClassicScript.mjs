// Test helper: load one of the extension's classic (non-module) scripts into
// Node. The extension ships plain scripts that register themselves on
// globalThis; Node needs an ESM entry point to import them, so the file is
// copied to a temporary .mjs (same trick the committed smoke test uses) and
// imported. The registered global is returned.

import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = join(process.cwd().endsWith("rule34video") ? process.cwd() : process.cwd(), "");

export function extensionFile(relativePath) {
  return join(repoRoot, "extension", relativePath);
}

export async function loadClassicScript(relativePath, globalName) {
  const source = readFileSync(extensionFile(relativePath), "utf8");
  const dir = mkdtempSync(join(tmpdir(), "r34-classic-"));
  const target = join(dir, "script.mjs");
  writeFileSync(target, source);
  try {
    await import(pathToFileURL(target).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const registered = globalThis[globalName];
  if (!registered) {
    throw new Error(`${relativePath} did not register globalThis.${globalName}`);
  }
  return registered;
}
