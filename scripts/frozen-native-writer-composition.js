'use strict';

// Offline composition only. Inputs are exact private serving captures; output
// must be a NEW private directory outside this repository. No deploy command.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const PINS = {
  'calendar-upsert': { version: 48, sha256: '414976024b7651afd03ddd9bc6b18eba3b97951fa3ed6bc98c05c0fc3256e389', surface: 'calendar' },
  'sample-review-upsert': { version: 49, sha256: 'd95eb9760a77305397ad045556cd160b2b12f125b23b1ca92f97acfa225b71c6', surface: 'samples' },
};
const THUMBNAIL = '8e8478cb8812688656fb5dee5fe022dd32090722da9db78f12556459de81cb51';
const ADAPTER = '7f3185bba428d18d4f773a9014dffd3bdff49873354b55391f8d72f27a98de74';
function once(source, before, after) {
  if (source.split(before).length !== 2) throw Error('composition_seam_drift');
  return source.replace(before, after);
}
function compose(source, slug) {
  const pin = PINS[slug];
  if (!pin || hash(source) !== pin.sha256) throw Error('captured_writer_hash_mismatch');
  const seams = [];
  const add = (before, after) => { source = once(source, before, after); seams.push({ before, after }); };
  const importLine = 'import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";';
  add(importLine, importLine + '\nimport { nativeCardSource, readNativeCardRequest, materializeNativeCard, nativeCardUnretained, nativeCardUnknown } from "../_shared/native-card-materialization.mjs";');
  const bodyRead = '  let body: JsonMap;\n  try { body = JSON.parse(await req.text()) as JsonMap; }\n  catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }';
  add(bodyRead, `  const nativeSource = nativeCardSource(req);
  let nativeRawText = "";
  let nativeAttempted = false;
  let body: JsonMap;
  if (nativeSource) {
    const read = await readNativeCardRequest(req);
    if ("status" in read) return json(read.body, read.status);
    nativeRawText = read.rawText;
    body = read.body;
  } else {
    try { body = JSON.parse(await req.text()) as JsonMap; }
    catch (_e) { return json({ ok: false, error: "invalid body" }, 400); }
  }`);
  const identity = '    id = clean(built.row.id);';
  add(identity, identity + `
    if (nativeSource) {
      nativeAttempted = true;
      const native = await materializeNativeCard({ supabase, surface: "${pin.surface}", source: nativeSource,
        rawText: nativeRawText, client, cardId: id });
      outcome = native.body.outcome;
      return json(native.body, native.status);
    }`);
  const failure = '  } catch (e) {' + (slug === 'calendar-upsert' ? '\n    outcome = "error";' : '');
  add(failure, failure + `
    if (nativeSource) {
      const refused = nativeAttempted ? nativeCardUnknown() : nativeCardUnretained();
      return json(refused.body, refused.status);
    }`);
  const logging = '  } finally {\n    console.log(JSON.stringify({';
  add(logging, `  } finally {
    if (nativeSource) console.log(JSON.stringify({ fn: "${slug}", action: "native-card", outcome, ms: Date.now() - started }));
    else console.log(JSON.stringify({`);
  // Inverting exactly these five additions must reproduce every serving byte.
  let inverse = source;
  for (const seam of [...seams].reverse()) inverse = once(inverse, seam.after, seam.before);
  if (hash(inverse) !== pin.sha256) throw Error('frozen_source_roundtrip_failed');
  return source;
}
function prepare(captureRoot, output) {
  if (!path.isAbsolute(captureRoot || '') || !path.isAbsolute(output || '')) throw Error('absolute_private_paths_required');
  const absolute = path.resolve(output), rel = path.relative(ROOT, absolute);
  if (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)) throw Error('output_inside_repository_refused');
  if (fs.existsSync(absolute)) throw Error('existing_output_refused');
  const files = {}, sourceHashes = {};
  for (const slug of Object.keys(PINS)) {
    const captured = fs.readFileSync(path.join(captureRoot, slug, 'functions', slug, 'index.ts'));
    const thumbnail = fs.readFileSync(path.join(captureRoot, slug, 'functions/_shared/thumbnail-revisions.ts'));
    if (hash(thumbnail) !== THUMBNAIL) throw Error('captured_thumbnail_hash_mismatch');
    files[`functions/${slug}/index.ts`] = compose(captured.toString('utf8'), slug);
    files['functions/_shared/thumbnail-revisions.ts'] = thumbnail;
    sourceHashes[slug] = { ...PINS[slug], verify_jwt: false };
  }
  const adapter = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/native-card-materialization.mjs'));
  if (hash(adapter) !== ADAPTER) throw Error('candidate_adapter_hash_mismatch');
  files['functions/_shared/native-card-materialization.mjs'] = adapter;
  // Validate all inputs before creating output; never overwrite captured/source files.
  fs.mkdirSync(absolute, { recursive: false });
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(absolute, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { flag: 'wx' });
  }
  const receipt = { classification: 'SOURCE_ONLY_PRIVATE_STAGED_COMPOSITION',
    candidate: 'b60a9705492002830eed60ece874e0686fc4b538', sourceHashes,
    files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(value)])),
    limits: ['Not deployed or authorized for deployment', 'Frozen tokenless ordinary writes preserved',
      'Native marker selects a terminal path; existing accepted manifest/receipt SQL decides admission',
      'No SQL, browser, Deno serving, live continuity or abuse accounting proof'] };
  fs.writeFileSync(path.join(absolute, 'COMPOSITION.private.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}
module.exports = { compose, prepare, PINS, hash };
if (require.main === module) {
  try {
    const receipt = prepare(process.env.FROZEN_WRITER_CAPTURE_ROOT, process.env.FROZEN_WRITER_OUTPUT);
    console.log(JSON.stringify({ classification: receipt.classification, writer_count: 2, file_count: 4, deployed: false }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
