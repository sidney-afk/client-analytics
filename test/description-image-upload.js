'use strict';
/*
 * The write half of pasting an image into a description.
 *
 * docs/ops/DESCRIPTION_IMAGE_UPLOAD.md §3 names three conditions that must ALL
 * hold before a byte reaches the bucket: the declared type is on the allowlist,
 * the magic bytes prove a type on the allowlist, and the two agree. This suite
 * feeds the deployed function's own policy module the exact byte shapes those
 * conditions exist to catch — an SVG labelled PNG, a GIF labelled PNG, an
 * oversize PNG — and reads the verdicts back. Then it pins the handler's
 * structure: verified actor before any write, admin/SMM only, ledger before
 * the answer, object removed when the ledger refuses.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const policy = require('../supabase/functions/description-image-upload/policy.mjs');

const ROOT = path.resolve(__dirname, '..');
const HANDLER = fs.readFileSync(path.join(ROOT, 'supabase/functions/description-image-upload/index.ts'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/2026-09-05-description-images.sql'), 'utf8');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-description-image-upload.yml'), 'utf8');
const CONFIG = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* ---- Byte fixtures: real headers, no pixel data ------------------------ */
/* Each fixture is a header PLUS the closing structure a real file must have:
   PNG's IEND, GIF's 0x3B trailer, JPEG's EOI, a WebP RIFF size that states
   the file's own length. `headerOnly` strips that back off to prove the
   truncation check (Codex on #1310, round two). */
/* A real chunk writer with real CRCs, because the policy now verifies them
   (Codex on #1310, round three: the earlier fixture had zeroed CRCs and an
   empty IDAT and was asserted as accepted). */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set([...type].map(c => c.charCodeAt(0)), 4);
  out.set(data, 8);
  new DataView(out.buffer).setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function png(width, height, headerOnly, options) {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (headerOnly) return concat(parts);
  const o = options || {};
  /* Real pixel rows: one filter byte (0) plus width RGBA pixels per row,
     deflated the way an encoder would (round four: the IDAT is inflated and
     measured against IHDR, so a placeholder stream no longer passes). */
  const raw = new Uint8Array(height * (1 + width * 4));
  const idat = o.badIdat ? new Uint8Array([0x01])
    : o.shortIdat ? new Uint8Array(zlib.deflateSync(raw.subarray(0, Math.max(1, raw.length - 4))))
    : o.badFilter ? new Uint8Array(zlib.deflateSync((() => { const r = raw.slice(); r[0] = 9; return r; })()))
    : new Uint8Array(zlib.deflateSync(raw));
  if (!o.noIdat) parts.push(chunk('IDAT', idat));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const out = concat(parts);
  if (o.corruptCrc) out[out.length - 1] ^= 0xff; /* flip a bit of IEND's CRC */
  if (o.trailingJunk) return concat([out, new Uint8Array([0, 0, 0])]);
  return out;
}
/* A real 1x1 GIF (header, screen descriptor, 2-colour global table, a
   graphic-control extension, an image descriptor with one LZW sub-block,
   trailer). `headerOnly` is header + screen descriptor and nothing else;
   round five: a header + 0x3B with no image block is no longer a GIF. */
const REAL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
function gif(width, height, headerOnly) {
  const b = new Uint8Array(headerOnly ? 13 : REAL_GIF.length);
  b.set(headerOnly ? REAL_GIF.subarray(0, 13) : REAL_GIF);
  new DataView(b.buffer).setUint16(6, width, true);
  new DataView(b.buffer).setUint16(8, height, true);
  return b;
}
function jpeg(width, height, headerOnly, options) {
  /* SOI, APP0 (JFIF, 16 bytes), SOF0 carrying the dimensions, SOS (8 bytes),
     a few entropy-coded bytes (with one stuffed FF 00), EOI. Huffman data
     is not decoded by the policy, so these bytes only need the shape. */
  const o = options || {};
  const entropy = o.strayMarker ? [0x12, 0xff, 0xc4, 0x34] : o.noEntropy ? [] : [0x12, 0x34, 0xff, 0x00, 0x56];
  const b = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda,
    0, 8, 1, 1, 0, 0, 0x3f, 0, ...entropy, 0xff, 0xd9,
  ]);
  new DataView(b.buffer).setUint16(25, height);
  new DataView(b.buffer).setUint16(27, width);
  return headerOnly ? b.slice(0, 41) : b;
}
function webp(width, height, headerOnly, options) {
  /* RIFF, size, WEBP, then one "VP8 " chunk of 20 bytes: a key-frame tag
     (bit 0 clear), the 9d 01 2a start code, width, height, and padding. */
  const o = options || {};
  const b = new Uint8Array(40);
  b.set([82, 73, 70, 70], 0);
  new DataView(b.buffer).setUint32(4, headerOnly ? 4000 : 32, true); /* RIFF size = total - 8 */
  b.set([87, 69, 66, 80], 8);
  b.set([86, 80, 56, 32], 12);
  new DataView(b.buffer).setUint32(16, o.badChunkSize ? 100 : 20, true);
  b.set(o.noStartCode ? [0x10, 0x02, 0x00, 0, 0, 0] : [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a], 20);
  new DataView(b.buffer).setUint16(26, width, true);
  new DataView(b.buffer).setUint16(28, height, true);
  return b;
}
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

(async () => {
/* ---- 1. The sniffers identify the four allowed shapes, and nothing else - */
console.log('magic bytes decide the type, and the header yields real dimensions');
ok(JSON.stringify(policy.sniffImage(png(1600, 900))) === '{"kind":"png","width":1600,"height":900}', 'PNG: IHDR width/height read big-endian');
ok(JSON.stringify(policy.sniffImage(gif(320, 200))) === '{"kind":"gif","width":320,"height":200}', 'GIF: logical screen read little-endian');
ok(JSON.stringify(policy.sniffImage(jpeg(768, 512))) === '{"kind":"jpeg","width":768,"height":512}', 'JPEG: the SOF0 frame header is found past APP0');
ok(JSON.stringify(policy.sniffImage(webp(1280, 720))) === '{"kind":"webp","width":1280,"height":720}', 'WebP: VP8 chunk dimensions');
ok(policy.sniffImage(SVG) === null, 'SVG bytes are recognised as NOTHING — there is no sniffer that can admit them');
ok(policy.sniffImage(new Uint8Array(0)) === null && policy.sniffImage(new Uint8Array([0x89, 0x50])) === null,
  'an empty or truncated body is null rather than a crash');
ok(policy.sniffImage(new TextEncoder().encode('%PDF-1.7 ... ')) === null, 'a PDF is not an image');

/* ---- 2. THE THREE CONDITIONS, executed ---------------------------------- */
console.log('the declared type, the bytes, and their agreement are all required');
const good = await policy.verifyImage('image/png', png(800, 600));
ok(good.ok === true && good.mime === 'image/png' && good.extension === 'png' && good.width === 800,
  'a PNG labelled image/png passes with its verified mime and extension');
ok((await policy.verifyImage('image/png; charset=binary', png(8, 8))).ok === true,
  'a content-type with parameters is read by its media type alone');
ok((await policy.verifyImage('IMAGE/JPEG', jpeg(10, 10))).ok === true, 'the declared type is case-insensitive');

const svgAsPng = await policy.verifyImage('image/png', SVG);
ok(svgAsPng.ok === false && svgAsPng.error === 'image_bytes_unrecognized' && svgAsPng.status === 415,
  'THE FINDING FROM #1225: SVG bytes labelled image/png are refused — the allowlist checks a claim, the sniffer checks the bytes');
const svgDeclared = await policy.verifyImage('image/svg+xml', SVG);
ok(svgDeclared.ok === false && svgDeclared.error === 'unsupported_image_type',
  'and SVG declared honestly is refused by the allowlist before the bytes are looked at');
const mismatch = await policy.verifyImage('image/png', gif(10, 10));
ok(mismatch.ok === false && mismatch.error === 'image_type_mismatch',
  'a real GIF labelled image/png is refused: the two must AGREE, not merely both be allowed');
ok((await policy.verifyImage('image/jpeg', webp(10, 10))).error === 'image_type_mismatch', 'same for WebP bytes under a JPEG label');
ok((await policy.verifyImage('image/png', new Uint8Array(0))).error === 'empty_image', 'an empty body is refused as empty, not as unrecognised');
ok((await policy.verifyImage('text/html', png(10, 10))).error === 'unsupported_image_type', 'a non-image label never reaches the sniffer');

/* ---- 3. The ceilings ---------------------------------------------------- */
console.log('bounds fail closed');
ok(policy.MAX_BYTES === 4 * 1024 * 1024, 'the byte ceiling is 4 MiB');
ok(/file_size_limit[\s\S]*4194304/.test(MIGRATION) && MIGRATION.includes("'syncview-description-images'"),
  "and the bucket's own file_size_limit is the same number, so the two refusals agree");
const big = new Uint8Array(policy.MAX_BYTES + 1);
big.set(png(10, 10));
ok((await policy.verifyImage('image/png', big)).error === 'image_too_large', 'one byte over the ceiling is refused');
const wide = await policy.verifyImage('image/png', png(policy.MAX_DIMENSION + 1, 10));
ok(wide.ok === false && wide.error === 'image_too_large', 'a header claiming more pixels than the dimension ceiling is refused');
ok((await policy.verifyImage('image/png', png(0, 10))).error === 'image_dimensions_invalid', 'zero pixels is not an image');

/* ---- 3b. A header is not a file ---------------------------------------- */
console.log('a body that stops after its header is refused');
ok((await policy.verifyImage('image/png', png(10, 10, true))).error === 'image_incomplete',
  'THE ROUND-TWO FINDING: a 33-byte PNG signature + IHDR with no IEND is refused, not stored forever as a broken URL');
ok((await policy.verifyImage('image/gif', gif(10, 10, true))).error === 'image_incomplete', 'a GIF without its 0x3B trailer is refused');
ok((await policy.verifyImage('image/jpeg', jpeg(10, 10, true))).error === 'image_incomplete', 'a JPEG without its EOI marker is refused');
ok((await policy.verifyImage('image/webp', webp(10, 10, true))).error === 'image_incomplete', 'a WebP whose RIFF size does not match its length is refused');
ok(policy.imageComplete('png', png(10, 10)) && policy.imageComplete('gif', gif(10, 10))
  && policy.imageComplete('jpeg', jpeg(10, 10)) && policy.imageComplete('webp', webp(10, 10)),
  'and each complete fixture passes the same check');
/* Round three: a PNG is walked chunk by chunk, not matched by its last bytes. */
ok((await policy.verifyImage('image/png', png(10, 10, false, { corruptCrc: true }))).error === 'image_incomplete',
  'THE ROUND-THREE FINDING: a PNG whose chunk CRC does not match is refused — "IEND" at the end is not enough');
ok((await policy.verifyImage('image/png', png(10, 10, false, { noIdat: true }))).error === 'image_incomplete',
  'a PNG with IHDR and IEND but no IDAT (no pixel data at all) is refused');
ok((await policy.verifyImage('image/png', png(10, 10, false, { trailingJunk: true }))).error === 'image_incomplete',
  'and bytes after IEND are refused: the walk must end exactly at the end of the file');
const suffixOnly = new Uint8Array(57);
suffixOnly.set(png(10, 10, true));
suffixOnly.set([0x49, 0x45, 0x4e, 0x44], 49);
ok((await policy.verifyImage('image/png', suffixOnly)).error === 'image_incomplete',
  'the exact shape round two accepted (IHDR + zero padding + the letters IEND) is now refused');
const noScan = jpeg(10, 10, true).slice(0, 39); /* up to and including SOF0, before the SOS marker */
const noScanEoi = new Uint8Array(noScan.length + 2);
noScanEoi.set(noScan); noScanEoi.set([0xff, 0xd9], noScan.length);
ok((await policy.verifyImage('image/jpeg', noScanEoi)).error === 'image_incomplete',
  'a JPEG with an EOI but no Start Of Scan carries no image data and is refused');
/* Round four: the pixel payload is inflated and measured. */
ok((await policy.verifyImage('image/png', png(10, 10, false, { badIdat: true }))).error === 'image_undecodable',
  'THE ROUND-FOUR FINDING: a CRC-valid PNG whose IDAT is not a zlib stream is refused');
ok((await policy.verifyImage('image/png', png(10, 10, false, { shortIdat: true }))).error === 'image_undecodable',
  'a PNG whose IDAT inflates to fewer bytes than IHDR implies is refused');
ok((await policy.verifyImage('image/png', png(10, 10, false, { badFilter: true }))).error === 'image_undecodable',
  'a PNG whose scanline carries an undefined filter type is refused');
ok((await policy.verifyImage('image/png', png(10, 10))).ok === true, 'and a PNG with real deflated rows passes');
const realPng1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
ok(await policy.pngPixelsDecodable(new Uint8Array(realPng1x1)) === 'ok', 'the real 1x1 PNG inflates to exactly its one filtered row');
const bomb = concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', (() => { const h = new Uint8Array(13); new DataView(h.buffer).setUint32(0, 1); new DataView(h.buffer).setUint32(4, 1); h.set([8, 6, 0, 0, 0], 8); return h; })()),
  chunk('IDAT', new Uint8Array(zlib.deflateSync(new Uint8Array(1 << 20)))),
  chunk('IEND', new Uint8Array(0))]);
ok((await policy.verifyImage('image/png', bomb)).error === 'image_undecodable',
  'a 1x1 IHDR over a megabyte of inflatable zeros is refused the moment the stream passes the five bytes IHDR allows');
/* Round five: the inflate ceiling is a fixed number, never the header's. */
const hugeHeader = (() => { const h = new Uint8Array(13); new DataView(h.buffer).setUint32(0, 8000); new DataView(h.buffer).setUint32(4, 8000); h.set([16, 6, 0, 0, 0], 8); return h; })();
const hugeHeaderPng = concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', hugeHeader),
  chunk('IDAT', new Uint8Array(zlib.deflateSync(new Uint8Array(16)))), chunk('IEND', new Uint8Array(0))]);
ok((await policy.verifyImage('image/png', hugeHeaderPng)).error === 'image_too_large',
  'THE ROUND-FIVE FINDING: an 8000x8000 16-bit RGBA header (512 MB of rows) is refused as too large BEFORE anything is inflated');
ok(policy.MAX_DECODED_BYTES <= 64 * 1024 * 1024 && policy.MAX_DECODED_BYTES >= 11 * 1024 * 1024,
  'the decoded ceiling is a fixed runtime-safe number, above anything the 1600px browser path produces');
ok(!/parts\.push\(value\)/.test(fs.readFileSync(path.join(ROOT, 'supabase/functions/description-image-upload/policy.mjs'), 'utf8')),
  'and the decoded payload is consumed as a stream, never retained');
/* Round five: indexed colour needs its palette; greyscale must not carry one. */
const indexedHeader = (() => { const h = new Uint8Array(13); new DataView(h.buffer).setUint32(0, 1); new DataView(h.buffer).setUint32(4, 1); h.set([8, 3, 0, 0, 0], 8); return h; })();
const indexedRows = new Uint8Array(zlib.deflateSync(new Uint8Array([0, 0])));
const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const indexedNoPlte = concat([sig, chunk('IHDR', indexedHeader), chunk('IDAT', indexedRows), chunk('IEND', new Uint8Array(0))]);
ok((await policy.verifyImage('image/png', indexedNoPlte)).error === 'image_incomplete',
  'an indexed-colour PNG with no PLTE is refused as structurally incomplete: browsers cannot decode it');
const indexedWithPlte = concat([sig, chunk('IHDR', indexedHeader), chunk('PLTE', new Uint8Array([0, 0, 0])), chunk('IDAT', indexedRows), chunk('IEND', new Uint8Array(0))]);
ok((await policy.verifyImage('image/png', indexedWithPlte)).ok === true, 'and the same file with its palette passes');
const greyHeader = (() => { const h = new Uint8Array(13); new DataView(h.buffer).setUint32(0, 1); new DataView(h.buffer).setUint32(4, 1); h.set([8, 0, 0, 0, 0], 8); return h; })();
const greyWithPlte = concat([sig, chunk('IHDR', greyHeader), chunk('PLTE', new Uint8Array([0, 0, 0])), chunk('IDAT', indexedRows), chunk('IEND', new Uint8Array(0))]);
ok((await policy.verifyImage('image/png', greyWithPlte)).error === 'image_incomplete', 'a greyscale PNG carrying a PLTE is refused, as the spec forbids it');
/* Round five: GIF, JPEG and WebP are walked block by block, not trailer-matched. */
const gifNoImage = new Uint8Array(14); gifNoImage.set(gif(1, 1, true)); gifNoImage[13] = 0x3b;
ok((await policy.verifyImage('image/gif', gifNoImage)).error === 'image_incomplete',
  'THE ROUND-FIVE FINDING: GIF89a + screen descriptor + 0x3B with no image block is refused');
ok((await policy.verifyImage('image/gif', gif(1, 1))).ok === true, 'a real 1x1 GIF (global table, extension, image block, trailer) passes');
ok((await policy.verifyImage('image/jpeg', jpeg(10, 10, false, { noEntropy: true }))).error === 'image_incomplete', 'a JPEG with SOS but no entropy-coded bytes is refused');
ok((await policy.verifyImage('image/jpeg', jpeg(10, 10, false, { strayMarker: true }))).error === 'image_incomplete', 'a JPEG whose scan data carries a stray marker before its segment is refused');
const jpegTrailingJunk = concat([jpeg(10, 10), new Uint8Array([1, 2])]);
ok((await policy.verifyImage('image/jpeg', jpegTrailingJunk)).error === 'image_incomplete', 'a JPEG with bytes after EOI is refused: EOI must be the last two bytes');
ok((await policy.verifyImage('image/webp', webp(10, 10, false, { badChunkSize: true }))).error === 'image_incomplete', 'a WebP whose VP8 chunk size overruns the file is refused');
ok((await policy.verifyImage('image/webp', webp(10, 10, false, { noStartCode: true }))).error === 'image_incomplete', 'a WebP VP8 chunk without the key-frame start code is refused');
/* Round six: a GIF frame must fit the screen its header advertised. */
const gifHugeFrame = gif(1, 1);
new DataView(gifHugeFrame.buffer).setUint16(gifHugeFrame.length - 14 + 5 - 4, 65535, true); /* image descriptor width */
new DataView(gifHugeFrame.buffer).setUint16(gifHugeFrame.length - 14 + 7 - 4, 65535, true); /* image descriptor height */
ok((await policy.verifyImage('image/gif', gifHugeFrame)).error === 'image_incomplete',
  'THE ROUND-SIX FINDING: a 1x1 GIF whose image descriptor claims 65535x65535 is refused; every frame must fit the logical screen');
const gifOffsetFrame = gif(1, 1);
new DataView(gifOffsetFrame.buffer).setUint16(gifOffsetFrame.length - 14 + 1 - 4, 1, true); /* image descriptor left = 1 on a 1-wide screen */
ok((await policy.verifyImage('image/gif', gifOffsetFrame)).error === 'image_incomplete', 'a frame whose offset pushes it past the screen edge is refused');
/* Round six: an animated WebP keeps its image chunks inside ANMF frames. */
const vp8Payload = (() => { const p = new Uint8Array(20); p.set([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, 1, 0, 1, 0], 0); return p; })();
const riffChunk = (fourcc, data) => { const c = new Uint8Array(8 + data.length + (data.length & 1)); c.set([...fourcc].map(ch => ch.charCodeAt(0)), 0); new DataView(c.buffer).setUint32(4, data.length, true); c.set(data, 8); return c; };
const anmf = concat([new Uint8Array(16), riffChunk('VP8 ', vp8Payload)]);
const animatedBody = concat([riffChunk('VP8X', new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 0, 0])), riffChunk('ANIM', new Uint8Array(6)), riffChunk('ANMF', anmf), riffChunk('ANMF', anmf)]);
const animatedWebp = (() => { const out = new Uint8Array(12 + animatedBody.length); out.set([82, 73, 70, 70], 0); new DataView(out.buffer).setUint32(4, out.length - 8, true); out.set([87, 69, 66, 80], 8); out.set(animatedBody, 12); return out; })();
ok((await policy.verifyImage('image/webp', animatedWebp)).ok === true,
  'THE ROUND-SIX FINDING: a VP8X animation whose image chunks live inside ANMF frames passes');
const vp8xNoImage = (() => { const b = new Uint8Array(30); b.set([82, 73, 70, 70], 0); new DataView(b.buffer).setUint32(4, 22, true); b.set([87, 69, 66, 80], 8); b.set([86, 80, 56, 88], 12); new DataView(b.buffer).setUint32(16, 10, true); b.set([0, 0, 0, 0, 9, 0, 0, 9, 0, 0], 20); return b; })();
ok(policy.sniffImage(vp8xNoImage) !== null && (await policy.verifyImage('image/webp', vp8xNoImage)).error === 'image_incomplete',
  'a VP8X container with no image chunk inside is refused');
const realPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const realVerdict = await policy.verifyImage('image/png', new Uint8Array(realPng));
ok(realVerdict.ok === true && realVerdict.width === 1 && realVerdict.height === 1,
  'a real 1x1 PNG from an encoder passes end to end (the same bytes the nightly probe uploads)');
ok(policy.ROLE_LIMIT_PER_HOUR > policy.RATE_LIMIT_PER_HOUR, 'the per-role ceiling sits above the per-actor one');
ok(Object.keys(policy.ALLOWED_TYPES).sort().join(',') === 'image/gif,image/jpeg,image/png,image/webp',
  'the allowlist is exactly png, jpeg, webp, gif — no svg, no bmp, no tiff');
ok(Object.values(policy.EXTENSION).every(ext => /^[a-z]+$/.test(ext)),
  'extensions come from the verified kind and are plain lowercase letters');
ok(policy.RATE_LIMIT_PER_HOUR > 0 && policy.RATE_LIMIT_PER_HOUR <= 500, 'a per-actor hourly rate limit exists and is finite');

/* ---- 4. The handler's shape ------------------------------------------- */
console.log('the deployed handler binds every object to one verified actor');
ok(HANDLER.includes('from("team_members")') && HANDLER.includes('matches.length !== 1'),
  'the actor is resolved to exactly ONE active roster row, as production-write does — a shared key alone cannot upload');
ok(/UPLOAD_ROLES[\s\S]*\["admin", "smm"\]/.test(HANDLER) && HANDLER.includes('operation_forbidden'),
  'admin and SMM only: a description is admin/SMM everywhere in the estate, so its images are too');
ok(HANDLER.indexOf('await authorize(') < HANDLER.indexOf('req.arrayBuffer()'),
  'authorization runs BEFORE the body is buffered');
ok(HANDLER.includes('verifyImage(') && HANDLER.indexOf('verifyImage(') < HANDLER.indexOf('.upload('),
  'the bytes are verified before the storage write');
ok(HANDLER.includes('crypto.randomUUID()') && !/req\.headers\.get\("x-syncview-image-name"\)/.test(HANDLER),
  'the object is named with a fresh UUID; no caller-supplied filename is read');
ok(HANDLER.includes('${verdict.extension}'), 'and its extension is the VERIFIED one');
/* Codex on #1310: reserve, THEN count. The row goes in before the object and
   the count that decides the limit includes the caller's own row, so two
   requests racing at the ceiling both see a total above it and both withdraw. */
ok(HANDLER.indexOf('await reserveLedgerRow(') < HANDLER.indexOf('.upload('),
  'the ledger row is RESERVED before the object is written — no object the ledger cannot count');
const reserve = HANDLER.slice(HANDLER.indexOf('async function reserveLedgerRow('), HANDLER.indexOf('Deno.serve('));
ok(reserve.indexOf('.insert(row)') < reserve.indexOf('count: "exact"'),
  'and inside the reservation the INSERT precedes the COUNT, so the count includes the caller\'s own row');
ok(/\(actorCount\.count \|\| 0\) > RATE_LIMIT_PER_HOUR \|\| \(roleCount\.count \|\| 0\) > ROLE_LIMIT_PER_HOUR/.test(reserve)
  && /\.delete\(\)\.eq\("id", id\)[\s\S]*?throw new UploadError\(429, "rate_limited"\)/.test(reserve),
  'a count above EITHER ceiling withdraws the reservation and answers 429 — concurrent uploads at the boundary cannot exceed the bound');
ok(/\.eq\("actor_role", String\(row\.actor_role\)\)/.test(reserve),
  'THE ROUND-TWO FINDING: the second ceiling is keyed to actor_role, which the ROLE SECRET resolved, not to the caller-chosen actor header');
ok(/if \(actorCount\.error \|\| roleCount\.error\) \{[\s\S]*?\.delete\(\)\.eq\("id", id\)[\s\S]*?rate_limit_unavailable/.test(reserve),
  'an unreadable ledger withdraws the reservation and refuses: the write cannot be bounded, so it does not happen');
const PROBE = fs.readFileSync(path.join(ROOT, 'qa/probes/p96_description_image_upload.js'), 'utf8');
const MANIFEST = fs.readFileSync(path.join(ROOT, 'qa/probes/nightly-manifest.txt'), 'utf8');
ok(/^p96_description_image_upload\.js$/m.test(MANIFEST), 'the nightly manifest runs the live-function probe');
ok(/functions\/v1\/description-image-upload/.test(PROBE) && /roster_actor_required/.test(PROBE) && /image_bytes_unrecognized|image_type_mismatch/.test(PROBE),
  'and the probe exercises the deployed function: CORS, flag, key, actor binding, and the byte check, against the real backend');
ok(/if \(!STAFF_ACTOR\) \{\s*ok\(false,/.test(PROBE),
  'ROUND THREE: the probe FAILS without SYNCVIEW_STAFF_ACTOR rather than skipping the only real round trip');
const NIGHTLY = fs.readFileSync(path.join(ROOT, '.github/workflows/calendar-e2e-nightly.yml'), 'utf8');
ok(/SYNCVIEW_STAFF_ACTOR: \$\{\{ secrets\.SYNCVIEW_STAFF_ACTOR \}\}/.test(NIGHTLY),
  'and the nightly workflow wires that secret into the probe job');
ok(/description_images_role_created_idx[\s\S]*\(actor_role, created_at desc\)/.test(MIGRATION),
  'the per-role count has a matching (actor_role, created_at) index, since rows are kept forever');
ok(/if \(uploadError\) \{[\s\S]*?\.delete\(\)\.eq\("id", ledgerId\)/.test(HANDLER),
  'a failed storage write withdraws the reservation, so it neither counts against the actor nor points at nothing');
/* Codex on #1310: a server-side kill switch, because a Pages revert cannot
   reach a cached tab or a direct authenticated caller. */
ok(HANDLER.includes('UPLOAD_FLAG = "description_image_upload_enabled"') && HANDLER.includes('from("syncview_runtime_flags")'),
  'the function reads a runtime flag of its own');
ok(HANDLER.indexOf('await uploadEnabled(supabase)') < HANDLER.indexOf('await authorize('),
  'and reads it BEFORE authenticating anyone, so a kill contains every caller at once');
const flagFn = HANDLER.slice(HANDLER.indexOf('async function uploadEnabled('), HANDLER.indexOf('async function reserveLedgerRow('));
ok(/if \(error \|\| !data\) return false/.test(flagFn) && /\.enabled === true/.test(flagFn) && /catch \(_error\) \{\s*return false/.test(flagFn),
  'and it FAILS CLOSED: a missing row, a read error, or a malformed value all refuse');
ok(/insert into public\.syncview_runtime_flags[\s\S]*'description_image_upload_enabled', '\{"enabled": true\}'/.test(MIGRATION),
  'the migration seeds the flag row enabled, since the owner ratified the feature');
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'ROLLBACK.md'), 'utf8');
ok(/SyncLinear description images[^\n]*description_image_upload_enabled/.test(ROLLBACK),
  'and ROLLBACK.md carries the one UPDATE that flips it, in the Live State table');
ok(!/["'`]data:/.test(HANDLER),
  'no data: URL anywhere in the handler — the bytes go to Storage or nowhere');
ok(HANDLER.includes('publicUrl.startsWith("https://")'), 'the URL handed back is https, which is the only scheme #1204 renders');
ok(HANDLER.includes('upsert: false'), 'an existing object is never overwritten');

/* ---- 5. Migration, config and deploy lane ------------------------------ */
console.log('the estate around it');
ok(/public,\s*file_size_limit[\s\S]*?\n\s*true,/.test(MIGRATION), 'the bucket is PUBLIC — the decision the doc recommends and the Linear mirror needs');
ok(MIGRATION.includes('create table if not exists public.description_images') && MIGRATION.includes('actor_key text not null'),
  'the ledger table records the actor');
ok(/revoke all on table public\.description_images from anon/.test(MIGRATION)
  && /revoke all on table public\.description_images from authenticated/.test(MIGRATION),
  'and is service-role only');
ok(!/create policy/i.test(MIGRATION), 'no storage policy is created: only the service role writes, everything else keeps no access');
ok(/\[functions\.description-image-upload\]\nverify_jwt = false/.test(CONFIG),
  'config.toml declares the function with JWT verification off, like every other browser-callable staff function');
ok(WORKFLOW.includes("- 'supabase/functions/description-image-upload/**'") && WORKFLOW.includes('supabase functions deploy description-image-upload'),
  'the deploy lane is path-triggered on the function source and deploys exactly this function');
ok(!/linear-outbound|production-write|deliverable-write|batch-write/.test(WORKFLOW),
  'and touches none of the four Section 4 closures, so no sealed capture is owed');
ok(WORKFLOW.includes('workflow_dispatch'), 'and can be dispatched by hand for the first deploy');

console.log(failures === 0
  ? '\ndescription image upload checks passed'
  : '\n' + failures + ' description image upload check(s) failed');
process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
