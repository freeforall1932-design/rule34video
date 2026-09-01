// Minimal dependency-free ZIP writer for the picture-set archive formats
// (ZIP / CBZ). The extension ships no bundler and no npm dependencies, so the
// container is written here instead of pulling in JSZip.
//
// Design constraints:
//   - Pure module, no DOM/chrome dependencies: runs in the offscreen document,
//     in the MV3 service worker, and in the plain-Node test suites.
//   - Deterministic output for a given input: entry order is preserved and the
//     DOS timestamp defaults to a fixed value, so tests can compare bytes.
//   - Compression uses the platform's CompressionStream("deflate-raw") when it
//     exists (Chrome 103+, i.e. every MV3 context we run in) and falls back to
//     STORED entries otherwise, so an archive is always produced.
//
// Layout written: for each entry a local file header + data, then the central
// directory, then the end-of-central-directory record. Data descriptors are not
// used (sizes and CRCs are known up front). ZIP64 is not needed for post-sized
// archives.

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 20; // 2.0 = deflate supported
const UTF8_NAME_FLAG = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

// Standard ZIP CRC-32 (same polynomial as PNG/gzip, reflected).
export function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

// Fixed DOS timestamp (1980-01-01 00:00) so archives are byte-reproducible.
const DEFAULT_DOS_TIME = 0;
const DEFAULT_DOS_DATE = ((1980 - 1980) << 9) | (1 << 5) | 1;

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value && typeof value.arrayBuffer === "function") {
    throw new TypeError("Convert Blob/ArrayBuffer inputs to Uint8Array before calling buildZip.");
  }
  return new Uint8Array(0);
}

// Compress with the platform's raw-deflate stream when available.
export async function deflateRaw(bytes) {
  const Ctor = typeof CompressionStream === "function" ? CompressionStream : null;
  if (!Ctor) return null;
  try {
    const stream = new Ctor("deflate-raw");
    const writer = stream.writable.getWriter();
    void writer.write(bytes).then(() => writer.close());
    const compressed = new Uint8Array(await new Response(stream.readable).arrayBuffer());
    // Deflate is only worth it when it actually shrinks the entry.
    if (compressed.length >= bytes.length) return null;
    return compressed;
  } catch {
    return null;
  }
}

function concat(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// Normalize one caller-supplied entry into { name, bytes }.
export function normalizeZipEntry(entry) {
  if (!entry) throw new Error("ZIP entry is missing.");
  const name = String(entry.name || "").replace(/^\/+/, "").replace(/\\/g, "/");
  if (!name) throw new Error("ZIP entry has no name.");
  if (name.split("/").some((segment) => segment === "..")) {
    throw new Error("ZIP entry name escapes the archive: " + name);
  }
  return { name, bytes: toBytes(entry.bytes) };
}

/**
 * Build a ZIP archive.
 * @param {Array<{name: string, bytes: Uint8Array}>} entries in archive order
 * @param {{compress?: boolean, comment?: string, dosTime?: number, dosDate?: number}} options
 * @returns {Promise<Uint8Array>} the complete archive
 */
export async function buildZip(entries, options = {}) {
  const list = Array.isArray(entries) ? entries.map(normalizeZipEntry) : [];
  if (!list.length) throw new Error("Cannot build an archive with no entries.");
  const commentBytes = toBytes(options.comment || "");
  const dosTime = Number.isFinite(options.dosTime) ? options.dosTime : DEFAULT_DOS_TIME;
  const dosDate = Number.isFinite(options.dosDate) ? options.dosDate : DEFAULT_DOS_DATE;
  const wantCompression = options.compress !== false;

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of list) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const needsUtf8Flag = entry.name.split("").some((ch) => ch.charCodeAt(0) > 0x7f);
    const checksum = crc32(entry.bytes);
    const compressed = wantCompression ? await deflateRaw(entry.bytes) : null;
    const method = compressed ? METHOD_DEFLATED : METHOD_STORED;
    const payload = compressed || entry.bytes;

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
    localView.setUint16(4, VERSION_NEEDED, true);
    localView.setUint16(6, needsUtf8Flag ? UTF8_NAME_FLAG : 0, true);
    localView.setUint16(8, method, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, payload.length, true);
    localView.setUint32(22, entry.bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, payload);

    const header = new Uint8Array(46 + nameBytes.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
    headerView.setUint16(4, VERSION_NEEDED, true); // version made by
    headerView.setUint16(6, VERSION_NEEDED, true); // version needed
    headerView.setUint16(8, needsUtf8Flag ? UTF8_NAME_FLAG : 0, true);
    headerView.setUint16(10, method, true);
    headerView.setUint16(12, dosTime, true);
    headerView.setUint16(14, dosDate, true);
    headerView.setUint32(16, checksum, true);
    headerView.setUint32(20, payload.length, true);
    headerView.setUint32(24, entry.bytes.length, true);
    headerView.setUint16(28, nameBytes.length, true);
    headerView.setUint16(30, 0, true); // extra length
    headerView.setUint16(32, 0, true); // comment length
    headerView.setUint16(34, 0, true); // disk number
    headerView.setUint16(36, 0, true); // internal attributes
    headerView.setUint32(38, 0, true); // external attributes
    headerView.setUint32(42, offset, true); // local header offset
    header.set(nameBytes, 46);
    central.push(header);

    offset += local.length + payload.length;
  }

  const centralDirectory = concat(central);
  const end = new Uint8Array(22 + commentBytes.length);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  endView.setUint16(4, 0, true); // disk number
  endView.setUint16(6, 0, true); // disk with central directory
  endView.setUint16(8, list.length, true);
  endView.setUint16(10, list.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, commentBytes.length, true);
  end.set(commentBytes, 22);

  return concat([...chunks, centralDirectory, end]);
}

// Parse the central directory of an archive we produced. Used by the offline
// tests to assert order, sizes and CRCs without shelling out to a zip tool.
export function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      endOffset = i;
      break;
    }
  }
  if (endOffset < 0) throw new Error("Not a ZIP archive (no end-of-central-directory record).");
  const count = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Corrupt central directory at entry " + n);
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const checksum = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder(flags & UTF8_NAME_FLAG ? "utf-8" : "utf-8").decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    entries.push({ name, method, crc32: checksum, compressedSize, size, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// Pull one entry's bytes back out of an archive (inflating when needed), so
// the tests can prove every image survived in the right order.
export async function readZipEntryBytes(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localNameLength = view.getUint16(entry.localOffset + 26, true);
  const localExtraLength = view.getUint16(entry.localOffset + 28, true);
  const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
  const data = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === METHOD_STORED) return new Uint8Array(data);
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  void writer.write(data).then(() => writer.close());
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
