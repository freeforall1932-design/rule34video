// Minimal dependency-free PDF writer for the PDF picture-set format.
// Ported from the sister project (nh-dw-2.0 `src/utils/pdfBuilder.ts`); the
// only adaptation is TypeScript -> JavaScript and the added
// `preparePdfPage` helper (which lived in that project's Downloader class).
//
// Produces a PDF 1.4 document with one page per image, embedding each page as
// a JPEG (DCTDecode) XObject at its native size — no re-encode for
// baseline/progressive RGB JPEGs, which keeps assembly fast and lossless.
//
// Design constraints:
//   - No DOM/chrome dependencies, so it runs in the offscreen document, the
//     MV3 service worker fallback, and plain Node test builds.
//   - Callers pre-encode non-JPEG pages (PNG/GIF/WebP, or CMYK JPEGs) to RGB
//     JPEG before calling buildPdfDocument; see preparePdfPage, which uses
//     createImageBitmap + OffscreenCanvas where the platform provides them.
//
// Structure produced:
//   1: /Catalog  ->  2: /Pages  ->  per page: Page, Contents stream, Image
//   followed by a cross-reference table and trailer with exact byte offsets.

function latin1Bytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function concat(parts) {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// Parse the frame header (SOFn) of a JPEG to get its pixel dimensions and
// component count. Handles baseline (SOF0/1), progressive (SOF2), and the
// lossless/extended variants; restart markers and embedded thumbnails (APPn)
// are skipped by segment length. Returns null for anything that does not look
// like a JPEG we can dimension (callers then re-encode through a canvas).
export function jpegInfo(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = bytes[pos + 1];
    // Standalone markers without a length payload.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      pos += 2;
      continue;
    }
    if (pos + 4 > bytes.length) {
      return null;
    }
    const length = (bytes[pos + 2] << 8) | bytes[pos + 3];
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC).
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (pos + 8 > bytes.length || length < 8) {
        return null;
      }
      return {
        height: (bytes[pos + 5] << 8) | bytes[pos + 6],
        width: (bytes[pos + 7] << 8) | bytes[pos + 8],
        components: bytes[pos + 9],
      };
    }
    if (marker === 0xda) {
      // Start of scan: no SOF before the image data — not usable.
      return null;
    }
    pos += 2 + length;
  }
  return null;
}

function pad10(value) {
  let out = String(value);
  while (out.length < 10) {
    out = "0" + out;
  }
  return out;
}

// Assemble the final PDF. Pages appear in the order of the given array; page
// size equals the image size in points (1 px = 1 pt keeps the archive compact
// and readers scale to fit anyway).
export function buildPdfDocument(images) {
  if (!images || images.length === 0) {
    throw new Error("Cannot build a PDF with no pages.");
  }
  const pageCount = images.length;
  // Object numbering: 1 catalog, 2 pages, then 3 objects per page.
  const firstPageObj = 3;
  const objectCount = 2 + pageCount * 3;
  const parts = [];
  const offsets = new Array(objectCount + 1).fill(0);
  let length = 0;
  const push = (text) => {
    const asBytes = latin1Bytes(text);
    parts.push(asBytes);
    length += asBytes.length;
  };
  const pushBinary = (asBytes) => {
    parts.push(asBytes);
    length += asBytes.length;
  };
  const beginObject = (num) => {
    offsets[num] = length;
    push(num + " 0 obj\n");
  };

  // Header plus a binary comment marker so readers treat the file as binary.
  pushBinary(latin1Bytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));

  beginObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const kids = [];
  for (let i = 0; i < pageCount; i++) {
    kids.push((firstPageObj + i * 3) + " 0 R");
  }
  beginObject(2);
  push("<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + pageCount + " >>\nendobj\n");

  for (let i = 0; i < pageCount; i++) {
    const image = images[i];
    if (!image || !image.bytes || !image.bytes.length || !(image.width > 0) || !(image.height > 0)) {
      throw new Error("PDF page " + (i + 1) + " has no usable image.");
    }
    const pageObj = firstPageObj + i * 3;
    const contentObj = pageObj + 1;
    const imageObj = pageObj + 2;

    beginObject(pageObj);
    push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + image.width + " " + image.height + "]"
      + " /Resources << /XObject << /Im" + i + " " + imageObj + " 0 R >> >>"
      + " /Contents " + contentObj + " 0 R >>\nendobj\n");

    const content = "q\n" + image.width + " 0 0 " + image.height + " 0 0 cm\n/Im" + i + " Do\nQ\n";
    beginObject(contentObj);
    push("<< /Length " + content.length + " >>\nstream\n" + content + "endstream\nendobj\n");

    beginObject(imageObj);
    push("<< /Type /XObject /Subtype /Image /Width " + image.width + " /Height " + image.height
      + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + image.bytes.length + " >>\nstream\n");
    pushBinary(image.bytes);
    push("\nendstream\nendobj\n");
  }

  const xrefOffset = length;
  let xref = "xref\n0 " + (objectCount + 1) + "\n0000000000 65535 f \n";
  for (let num = 1; num <= objectCount; num++) {
    xref += pad10(offsets[num]) + " 00000 n \n";
  }
  push(xref);
  push("trailer\n<< /Size " + (objectCount + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF\n");

  return concat(parts);
}

// Re-encode any image into an RGB JPEG page through an image canvas. Returns
// null when the current context has no canvas (plain Node), so callers can
// report a clear error instead of writing a broken page.
export async function reencodeImageToJpeg(bytes, contentType) {
  const createImageBitmapFn = typeof createImageBitmap === "function" ? createImageBitmap : null;
  const OffscreenCanvasCtor = typeof OffscreenCanvas === "function" ? OffscreenCanvas : null;
  if (!createImageBitmapFn || !OffscreenCanvasCtor || typeof Blob !== "function") {
    return null;
  }
  try {
    const bitmap = await createImageBitmapFn(new Blob([bytes], { type: contentType || "image/jpeg" }));
    try {
      const canvas = new OffscreenCanvasCtor(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return null;
      }
      // JPEG has no alpha channel: flatten transparency onto white instead of
      // letting transparent pages turn black.
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: bitmap.width,
        height: bitmap.height,
      };
    } finally {
      if (bitmap && typeof bitmap.close === "function") {
        bitmap.close();
      }
    }
  } catch {
    return null;
  }
}

// Prepare one collected image for the PDF. RGB JPEGs are embedded as-is (fast
// and lossless); grayscale/CMYK JPEGs and PNG/GIF/WebP images are re-encoded
// to RGB JPEG. Throws when neither is possible.
export async function preparePdfPage(bytes, contentType) {
  const info = jpegInfo(bytes);
  if (info !== null && info.components === 3 && info.width > 0 && info.height > 0) {
    return { bytes, width: info.width, height: info.height };
  }
  const reencoded = await reencodeImageToJpeg(bytes, contentType);
  if (reencoded === null) {
    throw new Error("PDF export cannot encode an image (no image canvas available in this context).");
  }
  return reencoded;
}

// Assemble a complete PDF from raw image bytes, in the given order.
export async function buildPdfFromImages(images) {
  const list = Array.isArray(images) ? images : [];
  if (!list.length) throw new Error("Cannot build a PDF with no pages.");
  const pages = [];
  for (const image of list) {
    pages.push(await preparePdfPage(image.bytes, image.contentType || null));
  }
  return buildPdfDocument(pages);
}
