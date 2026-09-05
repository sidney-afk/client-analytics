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
/* Per ROLE KEY, per rolling hour, across every actor that key can name. The
   actor header is caller-chosen and the key is shared per role, so a stolen
   key could name each active member in turn and get a fresh per-actor
   allowance for each. This ceiling is keyed to the one thing the caller
   cannot forge: which role secret authenticated the request. The named
   actor stays as audit metadata. Raised by Codex on #1310, round two. */
export const ROLE_LIMIT_PER_HOUR = 600;
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
 * A header is not a file. The sniffers above read only the leading bytes, so
 * a 24-byte PNG signature plus IHDR would pass them with no pixel data behind
 * it and be stored forever as a URL that renders broken. Each format has a
 * mandatory closing structure that a truncated body cannot have: PNG ends in
 * an IEND chunk, GIF in a 0x3B trailer, JPEG in an EOI marker, and a WebP's
 * RIFF header states the file's own length. Cheap, exact, and enough to
 * refuse every header-only body; a full decode is not attempted in the Edge
 * runtime. Raised by Codex on #1310, round two.
 * @param {ImageKind} kind
 * @param {Uint8Array} b
 * @returns {boolean}
 */
export function imageComplete(kind, b) {
  const n = b.length;
  if (kind === "png") return pngChunks(b) !== null;
  if (kind === "gif") return n >= 14 && b[n - 1] === 0x3b;
  if (kind === "jpeg") return jpegReachesScan(b) && b[n - 2] === 0xff && b[n - 1] === 0xd9;
  if (kind === "webp") {
    const riffSize = b[4] + (b[5] << 8) + (b[6] << 16) + (b[7] << 24);
    /* RIFF size excludes its own 8-byte header; an odd chunk may carry one
       pad byte, so the file is either exactly that or one byte longer. */
    return riffSize > 12 && (n === riffSize + 8 || n === riffSize + 9);
  }
  return false;
}

/** @type {Uint32Array | null} */
let crcTable = null;
/** CRC-32 as PNG defines it (ISO 3309), over the chunk type and data.
 * @param {Uint8Array} b @param {number} from @param {number} to */
function crc32(b, from, to) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = from; i < to; i++) crc = crcTable[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * The PNG chunk walk. Not a suffix check (Codex on #1310, round three): every
 * chunk's declared length must fit, every chunk's CRC must match its type
 * and data, the first chunk must be a 13-byte IHDR, at least one IDAT must
 * carry data, and the walk must end on a zero-length IEND exactly at the end
 * of the file. Returns the header fields and the concatenated IDAT stream
 * for pngPixelsDecodable, or null.
 * @param {Uint8Array} b
 * @returns {{ width: number, height: number, bitDepth: number, colorType: number, interlace: number, idat: Uint8Array } | null}
 */
function pngChunks(b) {
  const n = b.length;
  let at = 8;
  let first = true;
  /** @type {Uint8Array[]} */
  const idat = [];
  let idatBytes = 0;
  let header = null;
  while (at + 12 <= n) {
    const length = be32(b, at);
    const type = ascii(b, at + 4, 4);
    const end = at + 12 + length;
    if (end > n) return null;
    if (first && (type !== "IHDR" || length !== 13)) return null;
    if (crc32(b, at + 4, at + 8 + length) !== be32(b, at + 8 + length)) return null;
    if (first) {
      header = {
        width: be32(b, at + 8),
        height: be32(b, at + 12),
        bitDepth: b[at + 16],
        colorType: b[at + 17],
        interlace: b[at + 20],
      };
      if (b[at + 18] !== 0 || b[at + 19] !== 0) return null; /* compression, filter: only 0 exists */
    }
    first = false;
    if (type === "IDAT") { idat.push(b.subarray(at + 8, at + 8 + length)); idatBytes += length; }
    if (type === "IEND") {
      if (!(length === 0 && end === n && idatBytes > 0) || !header) return null;
      const stream = new Uint8Array(idatBytes);
      let offset = 0;
      for (const part of idat) { stream.set(part, offset); offset += part.length; }
      return Object.assign(header, { idat: stream });
    }
    at = end;
  }
  return null;
}

/** @param {number} colorType @returns {number} channels, or 0 for an undefined type */
function pngChannels(colorType) {
  return colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
}

/** The byte length the filtered scanlines MUST inflate to, from IHDR alone:
 * one filter byte plus the packed pixels per row, summed over the seven
 * Adam7 passes when interlaced. Zero for an IHDR that names no legal layout.
 * @param {{ width: number, height: number, bitDepth: number, colorType: number, interlace: number }} h */
function pngExpectedRawLength(h) {
  const channels = pngChannels(h.colorType);
  const depthOk = [1, 2, 4, 8, 16].includes(h.bitDepth)
    && !((h.colorType === 2 || h.colorType === 4 || h.colorType === 6) && h.bitDepth < 8)
    && !(h.colorType === 3 && h.bitDepth === 16);
  if (!channels || !depthOk || h.width <= 0 || h.height <= 0) return 0;
  const bitsPerPixel = channels * h.bitDepth;
  /** @param {number} w @param {number} hgt */
  const rows = (w, hgt) => hgt * (1 + Math.ceil((w * bitsPerPixel) / 8));
  if (h.interlace === 0) return rows(h.width, h.height);
  if (h.interlace !== 1) return 0;
  const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  let total = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const w = Math.ceil(Math.max(0, h.width - x0) / dx);
    const hgt = Math.ceil(Math.max(0, h.height - y0) / dy);
    if (w > 0 && hgt > 0) total += rows(w, hgt);
  }
  return total;
}

/**
 * Inflate a zlib stream with a hard ceiling on the output, so a crafted body
 * cannot expand past what IHDR promised. Returns null on any error or on
 * output beyond `limit`.
 * @param {Uint8Array} bytes @param {number} limit
 * @returns {Promise<Uint8Array | null>} */
async function inflateBounded(bytes, limit) {
  try {
    const inflater = new DecompressionStream("deflate");
    const writer = inflater.writable.getWriter();
    /* Written and read concurrently; a corrupt stream rejects the write,
       which the read loop below surfaces as an error of its own. */
    /* A copy on a plain ArrayBuffer: the writer's BufferSource type does not
       admit a view over a SharedArrayBuffer, and `bytes` may be either. */
    const owned = new Uint8Array(bytes.byteLength);
    owned.set(bytes);
    writer.write(owned).then(() => writer.close()).catch(() => {});
    const reader = inflater.readable.getReader();
    /** @type {Uint8Array[]} */
    const parts = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > limit) { try { await reader.cancel(); } catch (_error) { /* already failing */ } return null; }
        parts.push(value);
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
    return out;
  } catch (_error) {
    return null;
  }
}

/**
 * The pixel payload, decoded (Codex on #1310, round four): the IDAT stream
 * must inflate cleanly to EXACTLY the byte length IHDR implies, and every
 * scanline's filter byte must be one of the five defined. A CRC-valid PNG
 * whose IDAT is not a zlib stream, or inflates to the wrong size, is refused.
 * That is the whole of what a decoder checks before it starts unfiltering,
 * done here without an image library.
 * @param {Uint8Array} b
 * @returns {Promise<boolean>}
 */
export async function pngPixelsDecodable(b) {
  const chunks = pngChunks(b);
  if (!chunks) return false;
  const expected = pngExpectedRawLength(chunks);
  if (!expected) return false;
  const raw = await inflateBounded(chunks.idat, expected);
  if (!raw || raw.length !== expected) return false;
  /* Walk the filter bytes: one per scanline, at the row starts IHDR implies. */
  const channels = pngChannels(chunks.colorType);
  const bitsPerPixel = channels * chunks.bitDepth;
  const rowLengths = [];
  if (chunks.interlace === 0) {
    const row = 1 + Math.ceil((chunks.width * bitsPerPixel) / 8);
    for (let y = 0; y < chunks.height; y++) rowLengths.push(row);
  } else {
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    for (const [x0, y0, dx, dy] of passes) {
      const w = Math.ceil(Math.max(0, chunks.width - x0) / dx);
      const hgt = Math.ceil(Math.max(0, chunks.height - y0) / dy);
      if (w > 0 && hgt > 0) for (let y = 0; y < hgt; y++) rowLengths.push(1 + Math.ceil((w * bitsPerPixel) / 8));
    }
  }
  let at = 0;
  for (const length of rowLengths) {
    if (raw[at] > 4) return false;
    at += length;
  }
  return at === raw.length;
}

/** A JPEG that never reaches a Start Of Scan carries no image data, whatever
 * its last two bytes say. Walks the same marker segments the sniffer does.
 * @param {Uint8Array} b
 * @returns {boolean} */
function jpegReachesScan(b) {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return false;
    const marker = b[at + 1];
    if (marker === 0xff) { at += 1; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { at += 2; continue; }
    if (marker === 0xda) return true;
    if (marker === 0xd9) return false;
    const length = be16(b, at + 2);
    if (length < 2) return false;
    at += 2 + length;
  }
  return false;
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
 * @returns {Promise<{ ok: true, kind: ImageKind, mime: string, extension: string, width: number, height: number }
 *   | { ok: false, error: string, status: number }>}
 */
export async function verifyImage(declared, bytes) {
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
  if (!imageComplete(sniffed.kind, bytes)) return { ok: false, error: "image_incomplete", status: 415 };
  /* PNG is the one format whose pixel payload can be checked here without
     an image library: inflate it and measure it against IHDR. */
  if (sniffed.kind === "png" && !(await pngPixelsDecodable(bytes))) {
    return { ok: false, error: "image_undecodable", status: 415 };
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
