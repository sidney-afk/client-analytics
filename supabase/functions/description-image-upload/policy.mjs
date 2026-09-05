// Pure policy for description-image-upload: the allowlist, the ceilings and
// the magic-byte sniffers. Plain JavaScript with no Deno or Supabase surface
// so the unit suite (test/description-image-upload.js) can require() it and
// exercise the exact bytes the deployed function checks. Mirrors the
// policy.mjs beside production-write.
//
// @ts-check

/** @typedef {"png" | "jpeg" | "webp" | "gif"} ImageKind */
/** @typedef {{ kind: ImageKind, width: number, height: number }} Sniffed */

export const BUCKET = "syncview-description-images";
/* 4 MiB. A 1600px screenshot re-encoded by the browser is well under 1 MiB;
   the ceiling is for the GIF that passes through untouched and the odd very
   tall capture. Mirrors the bucket's own file_size_limit so the two refusals
   cannot disagree about what "too large" means. */
export const MAX_BYTES = 4 * 1024 * 1024;
/* Pixels per side. The browser downscales to 1600 on the long edge before it
   uploads; this is the server's own bound on a caller that did not. */
export const MAX_DIMENSION = 8000;
/* Per verified actor, per rolling hour. Pasting is a burst activity -- a brief
   with a dozen screenshots is normal -- so the number is roomy, and the point
   is that a stolen key cannot fill the bucket, not that a busy SMM is slowed. */
export const RATE_LIMIT_PER_HOUR = 120;
/* Declared content type -> the kind its bytes must prove. SVG is absent on
   purpose: it is a script container, not a picture. */
/** @type {Readonly<Record<string, ImageKind>>} */
export const ALLOWED_TYPES = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
});
/* The extension comes from the VERIFIED kind, never from a caller's filename. */
/** @type {Readonly<Record<ImageKind, string>>} */
export const EXTENSION = Object.freeze({ png: "png", jpeg: "jpg", webp: "webp", gif: "gif" });
/** @type {Readonly<Record<ImageKind, string>>} */
export const CANONICAL_MIME = Object.freeze({
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
});

/** @param {Uint8Array} b @param {number} at */
function be32(b, at) {
  return ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
}
/** @param {Uint8Array} b @param {number} at */
function be16(b, at) {
  return (b[at] << 8) + b[at + 1];
}
/** @param {Uint8Array} b @param {number} at */
function le16(b, at) {
  return b[at] + (b[at + 1] << 8);
}
/** @param {Uint8Array} b @param {number} at */
function le24(b, at) {
  return b[at] + (b[at + 1] << 8) + (b[at + 2] << 16);
}
/** @param {Uint8Array} b @param {number} at @param {number} length */
function ascii(b, at, length) {
  let out = "";
  for (let i = 0; i < length && at + i < b.length; i++) out += String.fromCharCode(b[at + i]);
  return out;
}

/** @param {Uint8Array} b @returns {Sniffed | null} */
function sniffPng(b) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24) return null;
  for (let i = 0; i < signature.length; i++) if (b[i] !== signature[i]) return null;
  if (ascii(b, 12, 4) !== "IHDR") return null;
  return { kind: "png", width: be32(b, 16), height: be32(b, 20) };
}

/** @param {Uint8Array} b @returns {Sniffed | null} */
function sniffGif(b) {
  if (b.length < 10) return null;
  const head = ascii(b, 0, 6);
  if (head !== "GIF87a" && head !== "GIF89a") return null;
  return { kind: "gif", width: le16(b, 6), height: le16(b, 8) };
}

/** @param {Uint8Array} b @returns {Sniffed | null} */
function sniffJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  /* Walk the marker segments to the first SOFn frame header, which carries
     the dimensions. C4 (DHT), C8 (JPG) and CC (DAC) share the C0..CF range
     without being frame headers. */
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xff) { at += 1; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { at += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = be16(b, at + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (at + 9 > b.length) return null;
      return { kind: "jpeg", width: be16(b, at + 7), height: be16(b, at + 5) };
    }
    at += 2 + length;
  }
  return null;
}

/** @param {Uint8Array} b @returns {Sniffed | null} */
function sniffWebp(b) {
  if (b.length < 30) return null;
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    return { kind: "webp", width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] + (b[22] << 8) + (b[23] << 16) + (b[24] << 24);
    return { kind: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return { kind: "webp", width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  }
  return null;
}

/**
 * The bytes decide. Returns the ONE kind the header proves plus its pixel
 * dimensions, or null. Each sniffer is exact about its own signature, so a
 * file cannot satisfy two, and anything with no recognised signature (SVG,
 * HTML, a PDF, a renamed executable) is null.
 * @param {Uint8Array} bytes
 * @returns {Sniffed | null}
 */
export function sniffImage(bytes) {
  return sniffPng(bytes) || sniffJpeg(bytes) || sniffGif(bytes) || sniffWebp(bytes);
}

/**
 * The whole verdict in one place, so the function and the test agree on it.
 * @param {string} declared content type as the browser labelled the bytes
 * @param {Uint8Array} bytes
 * @returns {{ ok: true, kind: ImageKind, mime: string, extension: string, width: number, height: number }
 *   | { ok: false, error: string, status: number }}
 */
export function verifyImage(declared, bytes) {
  const declaredKind = ALLOWED_TYPES[String(declared || "").split(";")[0].trim().toLowerCase()];
  if (!declaredKind) return { ok: false, error: "unsupported_image_type", status: 415 };
  if (!bytes || bytes.byteLength === 0) return { ok: false, error: "empty_image", status: 400 };
  if (bytes.byteLength > MAX_BYTES) return { ok: false, error: "image_too_large", status: 413 };
  const sniffed = sniffImage(bytes);
  if (!sniffed) return { ok: false, error: "image_bytes_unrecognized", status: 415 };
  if (sniffed.kind !== declaredKind) return { ok: false, error: "image_type_mismatch", status: 415 };
  if (!(sniffed.width > 0 && sniffed.height > 0)) {
    return { ok: false, error: "image_dimensions_invalid", status: 415 };
  }
  if (sniffed.width > MAX_DIMENSION || sniffed.height > MAX_DIMENSION) {
    return { ok: false, error: "image_too_large", status: 413 };
  }
  return {
    ok: true,
    kind: sniffed.kind,
    mime: CANONICAL_MIME[sniffed.kind],
    extension: EXTENSION[sniffed.kind],
    width: sniffed.width,
    height: sniffed.height,
  };
}
