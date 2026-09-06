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

/* ------------------------------------------------------------------------
   Whole-file structure, per format (Codex on #1310, rounds three to five).
   A header is not a file, and a trailer is not a structure. Each format
   below is walked block by block: sizes must fit, mandatory blocks must be
   present in the order the format requires, and the walk must end exactly
   at the end of the file. PNG additionally has its pixel stream inflated
   and measured. None of this is a full decode; it is what a decoder checks
   before it starts, done without an image library and without retaining
   the decoded payload.
   ------------------------------------------------------------------------ */

/* The most decoded bytes the PNG check will inflate. Well above anything the
   browser sends (it downscales to 1600px on the long edge, so under 11 MiB
   of RGBA rows) and well below what an Edge worker can hold; an IHDR that
   implies more is refused outright as too large, so a highly compressible
   body cannot use its own header as the ceiling. Codex on #1310, round five. */
export const MAX_DECODED_BYTES = 48 * 1024 * 1024;

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

/** @param {number} colorType @returns {number} channels, or 0 for an undefined type */
function pngChannels(colorType) {
  return colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
}

/**
 * The PNG chunk walk: every chunk's declared length must fit, every CRC must
 * match its type and data, IHDR must come first with length 13, PLTE must
 * precede IDAT and is REQUIRED for an indexed image (colour type 3) and
 * forbidden for greyscale (0 and 4), at least one IDAT must carry data, and
 * the walk must end on a zero-length IEND exactly at the end of the file.
 * Returns the header and the concatenated IDAT stream, or null.
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
  let sawPlte = false;
  let sawIdat = false;
  let header = null;
  while (at + 12 <= n) {
    const length = be32(b, at);
    const type = ascii(b, at + 4, 4);
    const end = at + 12 + length;
    if (end > n) return null;
    if (first && (type !== "IHDR" || length !== 13)) return null;
    if (!first && type === "IHDR") return null;
    /* Chunk types are four ASCII letters; an uppercase first letter marks a
       CRITICAL chunk, and the only critical chunks that exist are the four
       named here. A conforming decoder must reject any other critical chunk,
       so this does too (Codex on #1310, round seven). Ancillary chunks
       (lowercase first letter: tEXt, pHYs, gAMA…) pass through. */
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    if (type[0] === type[0].toUpperCase() && !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)) return null;
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
    if (type === "PLTE") {
      if (!header || sawPlte || sawIdat) return null;
      if (header.colorType === 0 || header.colorType === 4) return null;
      if (length === 0 || length % 3 !== 0 || length / 3 > 256) return null;
      if (header.colorType === 3 && length / 3 > (1 << header.bitDepth)) return null;
      sawPlte = true;
    }
    if (type === "IDAT") {
      if (!header || (header.colorType === 3 && !sawPlte)) return null;
      sawIdat = true;
      idat.push(b.subarray(at + 8, at + 8 + length));
      idatBytes += length;
    }
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

/** The filtered scanline lengths IHDR implies, in file order (Adam7 passes
 * when interlaced), or null for an IHDR that names no legal layout.
 * @param {{ width: number, height: number, bitDepth: number, colorType: number, interlace: number }} h
 * @returns {number[] | null} */
function pngRowLengths(h) {
  const channels = pngChannels(h.colorType);
  const depthOk = [1, 2, 4, 8, 16].includes(h.bitDepth)
    && !((h.colorType === 2 || h.colorType === 4 || h.colorType === 6) && h.bitDepth < 8)
    && !(h.colorType === 3 && h.bitDepth === 16);
  if (!channels || !depthOk || h.width <= 0 || h.height <= 0) return null;
  const bitsPerPixel = channels * h.bitDepth;
  /** @param {number} w */
  const rowBytes = (w) => 1 + Math.ceil((w * bitsPerPixel) / 8);
  /** @type {number[]} */
  const rows = [];
  if (h.interlace === 0) {
    const row = rowBytes(h.width);
    for (let y = 0; y < h.height; y++) rows.push(row);
    return rows;
  }
  if (h.interlace !== 1) return null;
  const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  for (const [x0, y0, dx, dy] of passes) {
    const w = Math.ceil(Math.max(0, h.width - x0) / dx);
    const hgt = Math.ceil(Math.max(0, h.height - y0) / dy);
    if (w > 0 && hgt > 0) { const row = rowBytes(w); for (let y = 0; y < hgt; y++) rows.push(row); }
  }
  return rows;
}

/**
 * The pixel payload, decoded as a STREAM (Codex on #1310, rounds four and
 * five): the IDAT bytes are inflated through the runtime's built-in
 * DecompressionStream and consumed as they arrive; nothing decoded is
 * retained. The output must reach EXACTLY the byte count IHDR implies, with
 * a defined filter type (0..4) at the start of every scanline, and any
 * byte past that count ends the check as a failure. An IHDR implying more
 * than MAX_DECODED_BYTES is refused before anything is inflated, so the cap
 * is a fixed runtime-safe number rather than whatever the header says.
 * @param {Uint8Array} b
 * @returns {Promise<"ok" | "undecodable" | "too_large">}
 */
export async function pngPixelsDecodable(b) {
  const chunks = pngChunks(b);
  if (!chunks) return "undecodable";
  const rows = pngRowLengths(chunks);
  if (!rows) return "undecodable";
  let expected = 0;
  for (const row of rows) expected += row;
  if (expected > MAX_DECODED_BYTES) return "too_large";
  try {
    const inflater = new DecompressionStream("deflate");
    const writer = inflater.writable.getWriter();
    /* A copy on a plain ArrayBuffer: the writer's BufferSource type does not
       admit a view over a SharedArrayBuffer, and `bytes` may be either. */
    const owned = new Uint8Array(chunks.idat.byteLength);
    owned.set(chunks.idat);
    writer.write(owned).then(() => writer.close()).catch(() => {});
    const reader = inflater.readable.getReader();
    let produced = 0;      /* bytes seen so far */
    let rowIndex = 0;      /* which scanline the next byte belongs to */
    let rowRemaining = rows[0]; /* bytes left in that scanline */
    let ok = true;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (produced + value.byteLength > expected) { ok = false; try { await reader.cancel(); } catch (_error) { /* failing anyway */ } break; }
      for (let i = 0; i < value.byteLength; i++) {
        if (rowRemaining === rows[rowIndex] && value[i] > 4) { ok = false; break; }
        rowRemaining -= 1;
        if (rowRemaining === 0) { rowIndex += 1; rowRemaining = rowIndex < rows.length ? rows[rowIndex] : 0; }
      }
      if (!ok) { try { await reader.cancel(); } catch (_error) { /* failing anyway */ } break; }
      produced += value.byteLength;
    }
    return ok && produced === expected ? "ok" : "undecodable";
  } catch (_error) {
    return "undecodable";
  }
}

/**
 * GIF block structure: header, logical screen descriptor, the global colour
 * table its flag announces, then a sequence of extension blocks (label plus
 * data sub-blocks) and image descriptors (with local colour table, LZW
 * minimum code size and data sub-blocks), ending on the 0x3B trailer as the
 * LAST byte. At least one image descriptor with at least one data sub-block
 * is required. LZW itself is not decoded.
 * @param {Uint8Array} b @returns {boolean}
 */
function gifBlocksValid(b) {
  const n = b.length;
  if (n < 14) return false;
  let at = 6;
  const screenW = le16(b, 6);
  const screenH = le16(b, 8);
  const packed = b[at + 4];
  at += 7;
  if (packed & 0x80) at += 3 * (1 << ((packed & 0x07) + 1));
  /** @param {number} from @returns {number} position after the 0-length terminator, or -1 */
  const subBlocks = (from) => {
    let p = from;
    for (;;) {
      if (p >= n) return -1;
      const size = b[p];
      p += 1;
      if (size === 0) return p;
      p += size;
    }
  };
  let images = 0;
  while (at < n) {
    const tag = b[at];
    if (tag === 0x3b) return at === n - 1 && images > 0;
    if (tag === 0x21) {
      if (at + 2 > n) return false;
      at = subBlocks(at + 2);
      if (at < 0) return false;
      continue;
    }
    if (tag === 0x2c) {
      if (at + 10 > n) return false;
      const left = le16(b, at + 1);
      const top = le16(b, at + 3);
      const w = le16(b, at + 5);
      const h = le16(b, at + 7);
      const local = b[at + 9];
      at += 10;
      /* Every frame must fit the logical screen the header advertised, so
         the dimension ceiling checked on that header binds each frame too.
         Codex on #1310, round six. */
      if (w === 0 || h === 0 || left + w > screenW || top + h > screenH) return false;
      if (w > MAX_DIMENSION || h > MAX_DIMENSION) return false;
      if (local & 0x80) at += 3 * (1 << ((local & 0x07) + 1));
      if (at + 2 > n) return false;
      const minCode = b[at];
      if (minCode < 2 || minCode > 8) return false;
      if (b[at + 1] === 0) return false; /* no data sub-block at all */
      at = subBlocks(at + 1);
      if (at < 0) return false;
      images += 1;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * JPEG segment structure: the marker walk must find a frame header (SOFn)
 * and a Start Of Scan; after SOS the entropy-coded data is walked byte by
 * byte, where an 0xFF may only be followed by a stuffed 0x00, a restart
 * marker, a further segment (progressive scans), or the EOI; and the EOI
 * must be the LAST two bytes. At least one entropy-coded byte is required.
 * Huffman decoding is not attempted.
 * @param {Uint8Array} b @returns {boolean}
 */
function jpegSegmentsValid(b) {
  const n = b.length;
  let at = 2;
  let sawFrame = false;
  let sawScan = false;
  let entropyBytes = 0;
  while (at + 2 <= n) {
    if (b[at] !== 0xff) return false;
    const marker = b[at + 1];
    if (marker === 0xff) { at += 1; continue; }
    if (marker === 0xd9) return at === n - 2 && sawFrame && sawScan && entropyBytes > 0;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { at += 2; continue; }
    if (at + 4 > n) return false;
    const length = be16(b, at + 2);
    if (length < 2 || at + 2 + length > n) return false;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) sawFrame = true;
    at += 2 + length;
    if (marker === 0xda) {
      if (!sawFrame) return false;
      sawScan = true;
      /* Entropy-coded data until the next real marker. */
      while (at < n) {
        if (b[at] !== 0xff) { entropyBytes += 1; at += 1; continue; }
        if (at + 1 >= n) return false;
        const next = b[at + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { entropyBytes += 1; at += 2; continue; }
        if (next === 0xff) { at += 1; continue; }
        break; /* a marker: back to the segment walk */
      }
    }
  }
  return false;
}

/** One image chunk's payload check: a "VP8 " key frame with its start code,
 * or a "VP8L" stream with its signature. Returns the bitstream's own
 * dimensions for an image chunk, null for any other chunk, and false for an
 * image chunk that is malformed or larger than `maxW` x `maxH` (the canvas
 * or frame it must fit) or the dimension ceiling. Codex on #1310, round
 * seven: a nested bitstream's dimensions are read, never assumed.
 * @param {Uint8Array} b @param {string} fourcc @param {number} dataAt @param {number} size
 * @param {number} maxW @param {number} maxH
 * @returns {{ w: number, h: number } | null | false} */
function webpImageChunk(b, fourcc, dataAt, size, maxW, maxH) {
  let w = 0;
  let h = 0;
  if (fourcc === "VP8 ") {
    /* frame tag (3) then the key-frame start code 9d 01 2a, then LE14 width and height */
    if (size < 10 || b[dataAt + 3] !== 0x9d || b[dataAt + 4] !== 0x01 || b[dataAt + 5] !== 0x2a) return false;
    const tag = b[dataAt] + (b[dataAt + 1] << 8) + (b[dataAt + 2] << 16);
    if (tag & 0x01) return false; /* bit 0 set = interframe, never a still */
    if (!((tag >>> 4) & 0x01)) return false; /* show_frame must be set on a still */
    /* bits 5..23 of the tag: the size of the first (mode) partition, which
       must fit inside the chunk after the 10-byte header, and must not be
       empty. A header with zero payload behind it is exactly what a decoder
       reads the dimensions from and then fails on (Codex on #1310, round
       eight). The DCT partitions are not decoded here. */
    const firstPartition = tag >>> 5;
    if (firstPartition === 0 || 10 + firstPartition > size) return false;
    w = le16(b, dataAt + 6) & 0x3fff;
    h = le16(b, dataAt + 8) & 0x3fff;
  } else if (fourcc === "VP8L") {
    if (size < 5 || b[dataAt] !== 0x2f) return false;
    const bits = b[dataAt + 1] + (b[dataAt + 2] << 8) + (b[dataAt + 3] << 16) + (b[dataAt + 4] << 24);
    w = (bits & 0x3fff) + 1;
    h = ((bits >>> 14) & 0x3fff) + 1;
  } else {
    return null;
  }
  if (w <= 0 || h <= 0 || w > maxW || h > maxH || w > MAX_DIMENSION || h > MAX_DIMENSION) return false;
  return { w, h };
}

/**
 * WebP RIFF structure: the RIFF size must state the file's own length, the
 * chunks after "WEBP" must tile the payload exactly (each fourcc + LE32 size
 * + data, padded to even), and at least one image chunk must be present:
 * directly (a still), or inside the ANMF frames of a VP8X animation, where
 * each frame carries exactly one (Codex on #1310, round six). A still may
 * carry only one.
 * @param {Uint8Array} b @returns {boolean}
 */
function webpChunksValid(b) {
  const n = b.length;
  if (n < 20) return false;
  const riffSize = b[4] + (b[5] << 8) + (b[6] << 16) + (b[7] << 24);
  if (riffSize + 8 !== n) return false;
  let at = 12;
  let stills = 0;
  let frames = 0;
  let extended = false;
  let animated = false;
  let sawAnim = false;
  /* The canvas every image and frame must fit: the VP8X header's when there
     is one, else the ceiling (a plain still IS the canvas). */
  let canvasW = MAX_DIMENSION;
  let canvasH = MAX_DIMENSION;
  while (at + 8 <= n) {
    const fourcc = ascii(b, at, 4);
    const size = b[at + 4] + (b[at + 5] << 8) + (b[at + 6] << 16) + (b[at + 7] << 24);
    const dataAt = at + 8;
    if (dataAt + size > n) return false;
    if (fourcc === "VP8X") {
      if (at !== 12 || size !== 10) return false;
      extended = true;
      /* Flags byte: bit 1 animation, bit 2 XMP, bit 3 EXIF, bit 4 alpha,
         bit 5 ICC; bits 0, 6, 7 and the next three bytes are reserved and
         must be zero. The animation bit must AGREE with the chunks that
         follow (Codex on #1310, round eight). */
      const flags = b[dataAt];
      if ((flags & 0xc1) !== 0 || b[dataAt + 1] !== 0 || b[dataAt + 2] !== 0 || b[dataAt + 3] !== 0) return false;
      animated = (flags & 0x02) !== 0;
      canvasW = le24(b, dataAt + 4) + 1;
      canvasH = le24(b, dataAt + 7) + 1;
      if (canvasW > MAX_DIMENSION || canvasH > MAX_DIMENSION) return false;
      at = dataAt + size + (size & 1);
      continue;
    }
    if (fourcc === "ANIM") {
      if (!extended || !animated || size !== 6 || sawAnim) return false;
      sawAnim = true;
    }
    const image = webpImageChunk(b, fourcc, dataAt, size, canvasW, canvasH);
    if (image === false) return false;
    if (image) stills += 1;
    if (fourcc === "ANMF") {
      /* 16 bytes of frame header: X/2 and Y/2 as 24-bit, width-1 and
         height-1 as 24-bit, duration, flags. The frame must fit the canvas,
         and its bitstream must fit the frame. Then the frame's own chunks
         must tile the payload with exactly one image chunk. */
      if (!extended || !animated || !sawAnim || size < 16) return false;
      const frameX = le24(b, dataAt) * 2;
      const frameY = le24(b, dataAt + 3) * 2;
      const frameW = le24(b, dataAt + 6) + 1;
      const frameH = le24(b, dataAt + 9) + 1;
      if (frameX + frameW > canvasW || frameY + frameH > canvasH) return false;
      let inner = dataAt + 16;
      const innerEnd = dataAt + size;
      let frameImages = 0;
      while (inner + 8 <= innerEnd) {
        const subFourcc = ascii(b, inner, 4);
        const subSize = b[inner + 4] + (b[inner + 5] << 8) + (b[inner + 6] << 16) + (b[inner + 7] << 24);
        const subDataAt = inner + 8;
        if (subDataAt + subSize > innerEnd) return false;
        const subImage = webpImageChunk(b, subFourcc, subDataAt, subSize, frameW, frameH);
        if (subImage === false) return false;
        if (subImage) frameImages += 1;
        inner = subDataAt + subSize + (subSize & 1);
      }
      if (inner !== innerEnd || frameImages !== 1) return false;
      frames += 1;
    } else if (!extended && at === 12 && !image) {
      return false; /* the first chunk must be an image or the extended header */
    }
    at = dataAt + size + (size & 1);
  }
  if (at !== n) return false;
  if (animated) return sawAnim && frames > 0 && stills === 0;
  return frames === 0 && stills === 1;
}

/**
 * The whole-file structure check, per format, run after the sniffers agree
 * with the declared type. PNG's pixel stream is checked separately and
 * asynchronously by pngPixelsDecodable.
 * @param {ImageKind} kind
 * @param {Uint8Array} b
 * @returns {boolean}
 */
export function imageComplete(kind, b) {
  if (kind === "png") return pngChunks(b) !== null;
  if (kind === "gif") return gifBlocksValid(b);
  if (kind === "jpeg") return jpegSegmentsValid(b);
  if (kind === "webp") return webpChunksValid(b);
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
  if (sniffed.kind === "png") {
    const pixels = await pngPixelsDecodable(bytes);
    if (pixels === "too_large") return { ok: false, error: "image_too_large", status: 413 };
    if (pixels !== "ok") return { ok: false, error: "image_undecodable", status: 415 };
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
