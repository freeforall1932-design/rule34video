// Fixture tests for the dependency-free PDF writer
// (extension/modules/archive/pdfBuilder.mjs): JPEG frame parsing (jpegInfo) and
// PDF document structure — header, page tree, DCTDecode image embedding, and
// exact cross-reference offsets.
//
// Adapted from the sister project's test/pdf-builder.test.js; only the input
// shape changed (an image list instead of a gallery page list).
//
// Run: node --test source/tests/pdf-builder.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jpegInfo, buildPdfDocument, buildPdfFromImages, preparePdfPage } from "../../extension/modules/archive/pdfBuilder.mjs";

// Minimal JPEG with a real SOF0 frame: SOI, SOF0(length 17, precision, H, W,
// components + component specs), then payload, then EOI.
function makeJpeg(width, height, components = 3, payload = 1900) {
  const buf = new Uint8Array(payload + 20);
  const header = [
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    components,
  ];
  if (components === 3) {
    header.push(0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01);
  } else {
    for (let i = 0; i < components * 3; i++) header.push(0x01);
  }
  buf.set(header, 0);
  buf[buf.length - 2] = 0xff;
  buf[buf.length - 1] = 0xd9;
  return buf;
}

describe("jpegInfo", () => {
  it("reads dimensions and component count from a baseline SOF0 frame", () => {
    assert.deepEqual(jpegInfo(makeJpeg(1280, 1808)), { width: 1280, height: 1808, components: 3 });
  });

  it("reads progressive (SOF2) frames and non-3 component counts", () => {
    const progressive = makeJpeg(640, 480);
    progressive[3] = 0xc2; // SOF2 instead of SOF0
    assert.deepEqual(jpegInfo(progressive), { width: 640, height: 480, components: 3 });
    assert.equal(jpegInfo(makeJpeg(10, 10, 1)).components, 1);
    assert.equal(jpegInfo(makeJpeg(10, 10, 4)).components, 4);
  });

  it("skips APPn segments (with embedded thumbnails) before the frame", () => {
    const buf = makeJpeg(800, 600);
    // Splice an APP0 segment with a payload right after SOI.
    const app0 = new Uint8Array([0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0x41)]);
    const withApp = new Uint8Array(buf.length + app0.length);
    withApp.set(buf.slice(0, 2), 0);
    withApp.set(app0, 2);
    withApp.set(buf.slice(2), 2 + app0.length);
    assert.deepEqual(jpegInfo(withApp), { width: 800, height: 600, components: 3 });
  });

  it("returns null for non-JPEG bytes, truncated frames, and scan-first data", () => {
    assert.equal(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0a])), null); // PNG
    assert.equal(jpegInfo(new Uint8Array(4)), null);
    assert.equal(jpegInfo(null), null);
    const sosFirst = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0x00]);
    assert.equal(jpegInfo(sosFirst), null);
  });
});

describe("buildPdfDocument", () => {
  const images = [
    { bytes: makeJpeg(120, 200), width: 120, height: 200 },
    { bytes: makeJpeg(120, 190), width: 120, height: 190 },
    { bytes: makeJpeg(120, 180), width: 120, height: 180 },
  ];

  it("produces a PDF 1.4 document with one page and one DCTDecode image per input", () => {
    const pdf = Buffer.from(buildPdfDocument(images));
    assert.ok(pdf.toString("latin1").startsWith("%PDF-1.4\n"), "PDF header");
    assert.ok(pdf.toString("latin1").endsWith("%%EOF\n"), "EOF marker");
    const text = pdf.toString("latin1");
    assert.ok(text.includes("/Count 3"), "page count");
    assert.equal(text.split("/Filter /DCTDecode").length - 1, 3, "one embedded JPEG per page");
    assert.ok(text.includes("/MediaBox [0 0 120 200]"), "page size matches image 1");
    assert.ok(text.includes("/MediaBox [0 0 120 180]"), "page size matches image 3");
  });

  it("keeps the page order it was given", () => {
    const text = Buffer.from(buildPdfDocument(images)).toString("latin1");
    const first = text.indexOf("/MediaBox [0 0 120 200]");
    const last = text.indexOf("/MediaBox [0 0 120 180]");
    assert.ok(first > -1 && last > first, "page 1 precedes page 3");
  });

  it("embeds the original JPEG bytes verbatim (no re-encode)", () => {
    const pdf = Buffer.from(buildPdfDocument([images[0]]));
    const needle = Buffer.from(images[0].bytes);
    assert.notEqual(pdf.indexOf(needle), -1, "exact JPEG byte sequence present in the PDF");
  });

  it("writes a cross-reference table whose offsets point at each object", () => {
    const pdf = Buffer.from(buildPdfDocument(images));
    const text = pdf.toString("latin1");
    const startxref = /startxref\n(\d+)\n%%EOF/.exec(text);
    assert.ok(startxref, "startxref present");
    const xrefOffset = parseInt(startxref[1], 10);
    assert.equal(pdf.slice(xrefOffset, xrefOffset + 4).toString("latin1"), "xref", "startxref points at the xref table");

    const xrefText = text.slice(xrefOffset);
    const countMatch = /xref\n0 (\d+)\n/.exec(xrefText);
    assert.ok(countMatch, "xref subheader");
    const objectCount = parseInt(countMatch[1], 10) - 1; // entry 0 is the free head
    assert.equal(objectCount, 2 + 3 * 3, "catalog + pages + 3 objects per page");
    const entries = xrefText.slice(countMatch.index + countMatch[0].length).split("\n");
    assert.match(entries[0], /^0000000000 65535 f $/, "free-list head entry");
    for (let num = 1; num <= objectCount; num++) {
      const entry = entries[num];
      assert.match(entry, /^\d{10} 00000 n $/, "well-formed xref entry: " + JSON.stringify(entry));
      const offset = parseInt(entry.slice(0, 10), 10);
      const atOffset = pdf.slice(offset, offset + 12).toString("latin1");
      assert.ok(atOffset.startsWith(num + " 0 obj"), "object " + num + " offset correct, got " + JSON.stringify(atOffset));
    }
  });

  it("rejects empty input and unusable pages", () => {
    assert.throws(() => buildPdfDocument([]), /no pages/i);
    assert.throws(() => buildPdfDocument([{ bytes: new Uint8Array(4), width: 0, height: 0 }]), /no usable image/i);
  });
});

describe("preparePdfPage / buildPdfFromImages", () => {
  it("embeds an RGB JPEG as-is, using its SOF dimensions", async () => {
    const jpeg = makeJpeg(64, 96);
    const page = await preparePdfPage(jpeg, "image/jpeg");
    assert.deepEqual(page, { bytes: jpeg, width: 64, height: 96 });
  });

  it("reports a clear error when a non-JPEG page cannot be re-encoded", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await assert.rejects(() => preparePdfPage(png, "image/png"), /no image canvas/i);
    await assert.rejects(() => buildPdfFromImages([{ bytes: png, contentType: "image/png" }]), /no image canvas/i);
  });

  it("assembles a document straight from an image list", async () => {
    const pdf = Buffer.from(await buildPdfFromImages([
      { bytes: makeJpeg(30, 40), contentType: "image/jpeg" },
      { bytes: makeJpeg(30, 50), contentType: "image/jpeg" },
    ]));
    assert.ok(pdf.toString("latin1").includes("/Count 2"));
  });
});
