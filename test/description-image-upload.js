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
function png(width, height) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}
function gif(width, height) {
  const b = new Uint8Array(14);
  b.set([71, 73, 70, 56, 57, 97]);
  new DataView(b.buffer).setUint16(6, width, true);
  new DataView(b.buffer).setUint16(8, height, true);
  return b;
}
function jpeg(width, height) {
  /* SOI, APP0 (JFIF, 16 bytes), then SOF0 carrying the dimensions. */
  const b = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda,
  ]);
  new DataView(b.buffer).setUint16(25, height);
  new DataView(b.buffer).setUint16(27, width);
  return b;
}
function webp(width, height) {
  const b = new Uint8Array(40);
  b.set([82, 73, 70, 70], 0);
  b.set([87, 69, 66, 80], 8);
  b.set([86, 80, 56, 32], 12);
  new DataView(b.buffer).setUint16(26, width, true);
  new DataView(b.buffer).setUint16(28, height, true);
  return b;
}
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

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
const good = policy.verifyImage('image/png', png(800, 600));
ok(good.ok === true && good.mime === 'image/png' && good.extension === 'png' && good.width === 800,
  'a PNG labelled image/png passes with its verified mime and extension');
ok(policy.verifyImage('image/png; charset=binary', png(8, 8)).ok === true,
  'a content-type with parameters is read by its media type alone');
ok(policy.verifyImage('IMAGE/JPEG', jpeg(10, 10)).ok === true, 'the declared type is case-insensitive');

const svgAsPng = policy.verifyImage('image/png', SVG);
ok(svgAsPng.ok === false && svgAsPng.error === 'image_bytes_unrecognized' && svgAsPng.status === 415,
  'THE FINDING FROM #1225: SVG bytes labelled image/png are refused — the allowlist checks a claim, the sniffer checks the bytes');
const svgDeclared = policy.verifyImage('image/svg+xml', SVG);
ok(svgDeclared.ok === false && svgDeclared.error === 'unsupported_image_type',
  'and SVG declared honestly is refused by the allowlist before the bytes are looked at');
const mismatch = policy.verifyImage('image/png', gif(10, 10));
ok(mismatch.ok === false && mismatch.error === 'image_type_mismatch',
  'a real GIF labelled image/png is refused: the two must AGREE, not merely both be allowed');
ok(policy.verifyImage('image/jpeg', webp(10, 10)).error === 'image_type_mismatch', 'same for WebP bytes under a JPEG label');
ok(policy.verifyImage('image/png', new Uint8Array(0)).error === 'empty_image', 'an empty body is refused as empty, not as unrecognised');
ok(policy.verifyImage('text/html', png(10, 10)).error === 'unsupported_image_type', 'a non-image label never reaches the sniffer');

/* ---- 3. The ceilings ---------------------------------------------------- */
console.log('bounds fail closed');
ok(policy.MAX_BYTES === 4 * 1024 * 1024, 'the byte ceiling is 4 MiB');
ok(/file_size_limit[\s\S]*4194304/.test(MIGRATION) && MIGRATION.includes("'syncview-description-images'"),
  "and the bucket's own file_size_limit is the same number, so the two refusals agree");
const big = new Uint8Array(policy.MAX_BYTES + 1);
big.set(png(10, 10));
ok(policy.verifyImage('image/png', big).error === 'image_too_large', 'one byte over the ceiling is refused');
const wide = policy.verifyImage('image/png', png(policy.MAX_DIMENSION + 1, 10));
ok(wide.ok === false && wide.error === 'image_too_large', 'a header claiming more pixels than the dimension ceiling is refused');
ok(policy.verifyImage('image/png', png(0, 10)).error === 'image_dimensions_invalid', 'zero pixels is not an image');
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
ok(HANDLER.indexOf('.insert({') > HANDLER.indexOf('.upload(')
  && /if \(ledgerError\) \{[\s\S]*?\.remove\(\[storagePath\]\)/.test(HANDLER),
  'a ledger row is written after the object, and a refused row removes the object — no orphan the rate limit cannot count');
ok(HANDLER.includes('rate_limited') && HANDLER.includes('from("description_images")') && HANDLER.includes('rate_limit_unavailable'),
  'the rate limit counts the ledger and refuses to write when it cannot read it');
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
