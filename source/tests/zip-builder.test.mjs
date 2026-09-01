// Fixture tests for the dependency-free ZIP writer
// (extension/modules/archive/zipBuilder.mjs): CRC-32, local headers, central
// directory, entry order and a real inflate round-trip through Node's zlib.
//
// Run: node --test source/tests/zip-builder.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync, crc32 as nodeCrc32 } from "node:zlib";
import { buildZip, crc32, readZipEntries, readZipEntryBytes } from "../../extension/modules/archive/zipBuilder.mjs";

function bytes(text) {
  return new TextEncoder().encode(text);
}

// Deterministic pseudo-random payload so compressed entries have real entropy.
function noise(length, seed = 7) {
  const out = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[i] = state % 251;
  }
  return out;
}

describe("crc32", () => {
  it("matches the published check value for \"123456789\"", () => {
    assert.equal(crc32(bytes("123456789")), 0xcbf43926);
  });

  it("agrees with Node's zlib implementation", () => {
    const sample = bytes("rule34video 001.jpg");
    assert.equal(crc32(sample), nodeCrc32(sample) >>> 0);
  });
});

describe("buildZip", () => {
  const entries = [
    { name: "001.jpg", bytes: bytes("first page") },
    { name: "002.jpg", bytes: noise(4096) },
    { name: "003.png", bytes: bytes("third page") },
  ];

  it("rejects an empty archive and escaping entry names", async () => {
    await assert.rejects(() => buildZip([]), /no entries/i);
    await assert.rejects(() => buildZip([{ name: "../escape.jpg", bytes: bytes("x") }]), /escapes the archive/i);
    await assert.rejects(() => buildZip([{ name: "", bytes: bytes("x") }]), /no name/i);
  });

  it("keeps every entry, in order, with the right sizes and CRCs", async () => {
    const archive = await buildZip(entries);
    const listed = readZipEntries(archive);
    assert.deepEqual(listed.map((entry) => entry.name), ["001.jpg", "002.jpg", "003.png"]);
    listed.forEach((entry, index) => {
      assert.equal(entry.size, entries[index].bytes.length, "uncompressed size");
      assert.equal(entry.crc32, crc32(entries[index].bytes), "crc");
      assert.ok(entry.localOffset >= 0);
    });
  });

  it("round-trips the original bytes through a real inflate", async () => {
    const archive = await buildZip(entries);
    for (const [index, entry] of readZipEntries(archive).entries()) {
      const restored = await readZipEntryBytes(archive, entry);
      assert.deepEqual(
        Buffer.from(restored),
        Buffer.from(entries[index].bytes),
        "entry " + entry.name + " content",
      );
    }
  });

  it("compresses with raw deflate when the platform provides it", async () => {
    const repetitive = [{ name: "001.jpg", bytes: bytes("A".repeat(20000)) }];
    const archive = await buildZip(repetitive);
    const [entry] = readZipEntries(archive);
    assert.equal(entry.method, 8, "deflated");
    assert.ok(entry.compressedSize < entry.size / 10, `compressed ${entry.compressedSize} of ${entry.size}`);
    // The same bytes must come back out.
    assert.equal((await readZipEntryBytes(archive, entry)).length, 20000);
  });

  it("stores entries verbatim when compression is turned off", async () => {
    const archive = await buildZip(entries, { compress: false });
    const listed = readZipEntries(archive);
    assert.ok(listed.every((entry) => entry.method === 0), "all stored");
    for (const [index, entry] of listed.entries()) {
      assert.equal(entry.compressedSize, entry.size);
      assert.deepEqual(Buffer.from(await readZipEntryBytes(archive, entry)), Buffer.from(entries[index].bytes));
    }
  });

  it("is byte-for-byte reproducible (fixed timestamps)", async () => {
    const a = await buildZip(entries);
    const b = await buildZip(entries);
    assert.deepEqual(Buffer.from(a), Buffer.from(b));
  });

  it("marks non-ASCII entry names as UTF-8 and keeps them intact", async () => {
    const archive = await buildZip([{ name: "アーティスト/001.jpg", bytes: bytes("x") }]);
    const [entry] = readZipEntries(archive);
    assert.equal(entry.name, "アーティスト/001.jpg");
  });

  it("writes a CBZ-shaped archive (comic viewers read the same container)", async () => {
    const archive = await buildZip(entries);
    const listed = readZipEntries(archive);
    assert.equal(listed.length, 3);
    assert.equal(listed[0].name, "001.jpg");
  });
});
