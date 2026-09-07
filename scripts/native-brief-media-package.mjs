// LOCAL FILES ONLY. No URL fetch, upload, SQL execution or credential discovery.
// Source ingress and recovery are distinct contracts; neither certifies serving.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { briefMediaOccurrences, briefMediaHash, BRIEF_MEDIA_BUCKET } from '../supabase/functions/_shared/native-brief-media.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = 'migrations/2026-09-07-native-brief-media.sql';
const HEX = /^[a-f0-9]{64}$/;
const VALIDATOR = path.join(ROOT, 'scripts/native-brief-media-validate.py');
const validatorPin = () => briefMediaHash(fs.readFileSync(VALIDATOR));
const validated = new Set();
const downloadTypes = new Set(['application/pdf', 'image/svg+xml', 'video/mp4', 'video/quicktime']);
export async function verifyExistingMedia(declared, bytes) {
  assert.ok(bytes.length > 0 && bytes.length <= 52428800, 'existing_media_size_held');
  const mime = String(declared || '').split(';')[0].trim().toLowerCase();
  const key = mime + ':' + await briefMediaHash(bytes);
  if (!validated.has(key)) {
    const result = spawnSync(process.env.NATIVE_BRIEF_MEDIA_PYTHON || 'python',
      [VALIDATOR, mime],
      { input: bytes, windowsHide: true, timeout: 120000, maxBuffer: 4096 });
    assert.ok(result.status === 0 && JSON.parse(result.stdout.toString()).ok === true, 'existing_media_bytes_held');
    validated.add(key);
  }
  return { mime, storage_mime_type: downloadTypes.has(mime) ? 'application/octet-stream' : mime };
}
export function privateFile(value) {
  assert.ok(path.isAbsolute(value || ''), 'absolute_private_path_required');
  const actual = fs.realpathSync(value);
  for (let p = actual;; p = path.dirname(p)) {
    assert.ok(!fs.existsSync(path.join(p, '.git')), 'git_path_refused');
    if (p === path.dirname(p)) break;
  }
  return actual;
}
function newDirectory(value) {
  assert.ok(path.isAbsolute(value || '') && !fs.existsSync(value), 'new_private_directory_required');
  privateFile(path.dirname(value));
  fs.mkdirSync(value, { mode: 0o700 });
  return privateFile(value);
}
async function imageFile(file, declared, expected, cache, urlHash) {
  const resolved = privateFile(file);
  const stat = fs.statSync(resolved);
  assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 52428800, 'image_size_held');
  const bytes = fs.readFileSync(resolved);
  const sha = await briefMediaHash(bytes);
  assert.equal(sha, expected, 'source_content_mismatch');
  let checked;
  if (cache) {
    assert.ok(['image/png', 'image/jpeg', 'image/gif', 'image/webp', ...downloadTypes].includes(declared));
    const prior = cache.rows.get(urlHash);
    assert.ok(prior?.ok === true && prior.content_sha256 === sha && prior.byte_length === bytes.length
      && prior.mime_type === declared, 'pinned_validation_mismatch');
    checked = { mime: declared };
  } else checked = await verifyExistingMedia(declared, bytes);
  return { bytes, mime: checked.mime, sha };
}
async function pinnedValidation(binding, files) {
  if (!binding) return null;
  const receiptPath = privateFile(binding.path), bytes = fs.readFileSync(receiptPath);
  assert.equal(await briefMediaHash(bytes), binding.sha256, 'validation_receipt_pin_mismatch');
  const receipt = JSON.parse(bytes), rows = new Map();
  assert.equal(receipt.classification, 'OFFLINE_LOCAL_CORPUS_VALIDATION_NOT_STORAGE_ADMISSION');
  assert.equal(receipt.validator_sha256, await validatorPin());
  files['receipts/' + binding.sha256 + '.json'] = bytes;
  for (const batch of receipt.batches) {
    assert.match(batch.file, /^batch-[0-9]{4}\.private\.json$/);
    const data = fs.readFileSync(privateFile(path.join(path.dirname(receiptPath), 'validation-final-batches', batch.file)));
    assert.equal(await briefMediaHash(data), batch.sha256, 'validation_batch_pin_mismatch');
    const parsed = JSON.parse(data); assert.equal(parsed.validator_sha256, receipt.validator_sha256);
    for (const item of parsed.results) { assert.ok(!rows.has(item.url_sha256)); rows.set(item.url_sha256, item); }
    files['receipts/' + batch.sha256 + '.json'] = data;
  }
  assert.equal(rows.size, receipt.files);
  return { rows, sourceSha: receipt.source_sha256, receiptSha: binding.sha256 };
}
async function collectionEvidence(doc, receipt, files, cache) {
  if (!receipt.generated_binding) return;
  assert.equal(receipt.provenance?.contract, 'native_brief_media_collection_binding_v1');
  for (const [key, value] of Object.entries({ id: doc.row.id, client_slug: doc.row.client_slug, team: doc.row.team,
    source_updated_at: doc.row.updated_at, brief_sha256: await briefMediaHash(doc.row.brief) })) assert.equal(receipt[key], value);
  for (const evidence of doc.evidence_files || []) {
    const bytes = fs.readFileSync(privateFile(evidence.path));
    assert.equal(await briefMediaHash(bytes), evidence.sha256);
    files['receipts/' + evidence.sha256 + '.json'] = bytes;
  }
  const sourceSha = receipt.provenance.collection_source_sha256;
  assert.ok(files['receipts/' + sourceSha + '.json'], 'collection_source_missing');
  if (cache) assert.equal(cache.sourceSha, sourceSha, 'validation_collection_mismatch');
  const source = JSON.parse(files['receipts/' + sourceSha + '.json']);
  const matching = source.documents.filter(x => x.row.id === doc.row.id && x.row.client_slug === doc.row.client_slug && x.row.team === doc.row.team);
  assert.equal(matching.length, 1); assert.deepEqual(matching[0].row, doc.row);
  assert.equal(matching[0].brief_sha256, receipt.brief_sha256);
  for (const ref of receipt.occurrences) {
    const original = matching[0].occurrences.filter(x => x.offset === ref.offset && x.url_sha256 === ref.original_url_sha256);
    assert.equal(original.length, 1, 'captured_occurrence_mismatch');
    if (ref.owner_deferred) continue;
    const bytes = files['receipts/' + ref.read_receipt_sha256 + '.json']; assert.ok(bytes, 'collection_read_receipt_missing');
    const read = JSON.parse(bytes);
    assert.equal(read.ok, true); assert.equal(read.http_status, 200);
    assert.equal(read.url_sha256, ref.original_url_sha256); assert.equal(read.content_sha256, ref.content_sha256);
  }
}
export async function stage(inputFile, output) {
  const input = JSON.parse(fs.readFileSync(privateFile(inputFile), 'utf8'));
  assert.equal(input.contract, 'native_brief_media_ingress_v1');
  assert.ok(Array.isArray(input.documents) && input.documents.length > 0);
  const ledger = [], objects = [], files = {}, receipts = [], ownerDeferred = [];
  const cache = await pinnedValidation(input.validated_corpus, files);
  for (const doc of input.documents) {
    const row = doc.row;
    assert.ok(row && typeof row.brief === 'string' && row.id && row.client_slug && row.team && Number.isFinite(Date.parse(row.updated_at)));
    const digest = await briefMediaHash(row.brief), refs = briefMediaOccurrences(row.brief);
    assert.ok(refs.length > 0 && refs.length <= 200 && doc.files.length === refs.length);
    const receiptBytes = fs.readFileSync(privateFile(doc.source_receipt_path));
    const receipt = JSON.parse(receiptBytes);
    assert.equal(receipt.contract, 'native_brief_media_source_v1');
    for (const [key, value] of Object.entries({ id: row.id, client_slug: row.client_slug, team: row.team,
      source_updated_at: row.updated_at, brief_sha256: digest })) assert.equal(receipt[key], value);
    assert.equal(receipt.occurrences.length, refs.length);
    const receiptSha = await briefMediaHash(receiptBytes);
    receipts.push(receiptSha); files['receipts/' + receiptSha + '.json'] = receiptBytes;
    await collectionEvidence(doc, receipt, files, cache);
    for (const ref of refs) {
      const matches = doc.files.filter(x => x.offset === ref.offset);
      const sources = receipt.occurrences.filter(x => x.offset === ref.offset);
      assert.ok(matches.length === 1 && sources.length === 1, 'exact_occurrence_required');
      const copy = matches[0], source = sources[0];
      assert.equal(source.original_url_sha256, await briefMediaHash(ref.url));
      if (copy.disposition === 'owner_deferred') {
        assert.equal(source.owner_deferred, true);
        const bytes = fs.readFileSync(privateFile(copy.owner_receipt_path)), decision = JSON.parse(bytes);
        assert.equal(decision.source_entity_id, row.id); assert.equal(decision.team, row.team);
        assert.equal(String(decision.source_status_at_decision).toLowerCase(), 'posted');
        assert.equal(decision.original_url_sha256, source.original_url_sha256); assert.equal(decision.content_sha256, source.content_sha256);
        assert.equal(decision.copy_complete, true); assert.equal(decision.website_restoration_required_before_operational_exit, false);
        assert.ok(HEX.test(decision.content_sha256) && Number.isSafeInteger(decision.byte_length) && decision.byte_length > 52428800);
        const decisionSha = await briefMediaHash(bytes); files['receipts/' + decisionSha + '.json'] = bytes;
        ownerDeferred.push({ contract: 'native_brief_owner_deferred_v1', id: row.id, client_slug: row.client_slug, team: row.team,
          source_status: 'posted', original_url_sha256: source.original_url_sha256, content_sha256: source.content_sha256,
          byte_length: decision.byte_length, owner_receipt_sha256: decisionSha, source_receipt_sha256: receiptSha, source_offset: ref.offset });
        continue;
      }
      assert.notEqual(source.owner_deferred, true);
      const img = await imageFile(copy.path, copy.mime_type, source.content_sha256, cache, source.original_url_sha256);
      const id = randomUUID(), storage_path = img.sha + '/' + id;
      files['objects/' + storage_path] = img.bytes;
      objects.push({ storage_path, content_sha256: img.sha, byte_length: img.bytes.length, mime_type: img.mime,
        storage_mime_type: downloadTypes.has(img.mime) ? 'application/octet-stream' : img.mime });
      ledger.push({ id, deliverable_id: row.id, client_slug: row.client_slug, team: row.team,
        source_kind: 'native_brief', source_entity_id: row.id,
        source_updated_at: row.updated_at, source_sha256: digest, source_offset: ref.offset, source_length: ref.length,
        original_url_sha256: source.original_url_sha256, audience: 'staff', state: 'pending',
        content_sha256: img.sha, readback_sha256: null, storage_path, byte_length: img.bytes.length,
        mime_type: img.mime, verified_at: null, source_receipt_sha256: receiptSha });
    }
  }
  files['ledger.private.json'] = Buffer.from(JSON.stringify(ledger));
  files['schema.sql'] = fs.readFileSync(path.join(ROOT, SCHEMA));
  const manifest = { contract: 'native_brief_media_package_v1', kind: 'INGRESS_STAGED', bucket: BRIEF_MEDIA_BUCKET,
    validation_contract: 'native_brief_existing_media_v1', validator_sha256: await validatorPin(),
    audience: 'staff', admission: 'UNVERIFIED_STORAGE', recovery_base_sha256: null, objects, receipts,
    owner_deferred_references: ownerDeferred, cached_validation_receipt_sha256: cache?.receiptSha || null,
    files: Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, bytes]) => [name, await briefMediaHash(bytes)]))) };
  const dir = newDirectory(output);
  for (const [name, bytes] of Object.entries(files)) {
    const target = path.join(dir, name); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  }
  fs.writeFileSync(path.join(dir, 'manifest.private.json'), JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  return { classification: 'OFFLINE_STAGED_UNVERIFIED_STORAGE', occurrences: ledger.length, owner_deferred: ownerDeferred.length };
}
export async function verify(directory) {
  const dir = privateFile(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.private.json'), 'utf8'));
  assert.equal(manifest.contract, 'native_brief_media_package_v1');
  assert.equal(manifest.validation_contract, 'native_brief_existing_media_v1');
  assert.equal(manifest.validator_sha256, await validatorPin(), 'validator_pin_mismatch');
  assert.equal(manifest.bucket, BRIEF_MEDIA_BUCKET); assert.equal(manifest.audience, 'staff');
  assert.ok(['INGRESS_STAGED', 'ADMISSION_PROPOSAL', 'RECOVERY_CAPTURE'].includes(manifest.kind));
  if (manifest.kind !== 'INGRESS_STAGED') assert.ok(HEX.test(manifest.recovery_base_sha256), 'versioned_base_recovery_required');
  for (const [name, sha] of Object.entries(manifest.files)) {
    assert.ok(/^(schema\.sql|ledger\.private\.json|receipts\/[a-f0-9]{64}\.json|objects\/[a-f0-9]{64}\/[a-f0-9-]{36})$/.test(name));
    const file = path.join(dir, name);
    assert.equal(fs.realpathSync(file), path.resolve(file), 'symlink_refused');
    assert.equal(await briefMediaHash(fs.readFileSync(file)), sha, 'package_content_mismatch');
  }
  assert.equal(manifest.files['schema.sql'], await briefMediaHash(fs.readFileSync(path.join(ROOT, SCHEMA))), 'schema_pin_mismatch');
  assert.ok(manifest.files['ledger.private.json']);
  const evidenceFiles = {};
  for (const name of Object.keys(manifest.files).filter(x => x.startsWith('receipts/')))
    evidenceFiles[name] = fs.readFileSync(path.join(dir, name));
  for (const bytes of Object.values(evidenceFiles)) {
    const receipt = JSON.parse(bytes);
    if (receipt.contract === 'native_brief_media_source_v1' && receipt.generated_binding) {
      const collection = JSON.parse(evidenceFiles['receipts/' + receipt.provenance.collection_source_sha256 + '.json']);
      const documents = collection.documents.filter(x => x.row.id === receipt.id && x.row.client_slug === receipt.client_slug && x.row.team === receipt.team);
      assert.equal(documents.length, 1);
      await collectionEvidence({ row: documents[0].row }, receipt, evidenceFiles, null);
    }
  }
  for (const entry of manifest.owner_deferred_references || []) {
    const decision = JSON.parse(evidenceFiles['receipts/' + entry.owner_receipt_sha256 + '.json']);
    const source = JSON.parse(evidenceFiles['receipts/' + entry.source_receipt_sha256 + '.json']);
    assert.equal(entry.contract, 'native_brief_owner_deferred_v1'); assert.equal(entry.source_status, 'posted');
    assert.equal(source.id, entry.id); assert.equal(source.client_slug, entry.client_slug); assert.equal(source.team, entry.team);
    assert.equal(decision.source_entity_id, entry.id); assert.equal(decision.team, entry.team);
    assert.equal(String(decision.source_status_at_decision).toLowerCase(), 'posted');
    assert.equal(decision.copy_complete, true); assert.equal(decision.website_restoration_required_before_operational_exit, false);
    for (const key of ['original_url_sha256', 'content_sha256', 'byte_length']) assert.equal(decision[key], entry[key]);
    const occurrence = source.occurrences.filter(x => x.offset === entry.source_offset && x.original_url_sha256 === entry.original_url_sha256);
    assert.equal(occurrence.length, 1); assert.equal(occurrence[0].owner_deferred, true); assert.equal(occurrence[0].content_sha256, entry.content_sha256);
  }
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'ledger.private.json'), 'utf8'));
  assert.ok(Array.isArray(rows));
  if (manifest.kind === 'RECOVERY_CAPTURE') assert.equal(rows.length, manifest.row_count, 'recovery_row_count_mismatch');
  for (const row of rows) {
    assert.equal(row.source_kind, 'native_brief'); assert.equal(row.source_entity_id, row.deliverable_id);
    assert.equal(row.audience, 'staff'); assert.ok(['pending', 'held', 'verified'].includes(row.state));
    if (manifest.kind === 'INGRESS_STAGED') assert.notEqual(row.state, 'verified', 'staging_is_not_storage_readback');
    if (row.state === 'verified' || row.storage_path) {
      assert.ok(HEX.test(row.content_sha256) && row.storage_path === row.content_sha256 + '/' + row.id);
      assert.equal(manifest.files['objects/' + row.storage_path], row.content_sha256, 'object_missing');
      const image = await imageFile(path.join(dir, 'objects', row.storage_path), row.mime_type, row.content_sha256);
      assert.equal(image.bytes.length, row.byte_length);
      if (row.state === 'verified') assert.equal(row.readback_sha256, row.content_sha256);
    }
    assert.equal(manifest.files['receipts/' + row.source_receipt_sha256 + '.json'], row.source_receipt_sha256, 'source_receipt_missing');
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'receipts', row.source_receipt_sha256 + '.json')));
    assert.equal(receipt.contract, 'native_brief_media_source_v1');
    for (const [key, value] of Object.entries({ id: row.deliverable_id, client_slug: row.client_slug,
      team: row.team, source_updated_at: row.source_updated_at, brief_sha256: row.source_sha256 })) assert.equal(receipt[key], value);
    const occurrence = receipt.occurrences.filter(x => x.offset === row.source_offset);
    assert.equal(occurrence.length, 1); assert.equal(occurrence[0].original_url_sha256, row.original_url_sha256);
    if (row.content_sha256) assert.equal(occurrence[0].content_sha256, row.content_sha256);
  }
  return { manifest, rows };
}
export async function admission(directory, readbackFile, output) {
  const { manifest, rows } = await verify(directory);
  assert.equal(manifest.kind, 'INGRESS_STAGED');
  const evidenceBytes = fs.readFileSync(privateFile(readbackFile));
  const evidence = JSON.parse(evidenceBytes);
  assert.equal(evidence.contract, 'native_brief_media_storage_readback_v1');
  assert.equal(evidence.bucket, BRIEF_MEDIA_BUCKET); assert.equal(evidence.public, false);
  assert.ok(HEX.test(evidence.recovery_base_sha256) && Number.isFinite(Date.parse(evidence.observed_at))
    && Date.parse(evidence.observed_at) <= Date.now());
  assert.equal(evidence.objects.length, rows.length);
  for (const row of rows) {
    const matches = evidence.objects.filter(x => x.storage_path === row.storage_path);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].storage_mime_type,
      downloadTypes.has(row.mime_type) ? 'application/octet-stream' : row.mime_type,
      'storage_content_type_required');
    const readback = await imageFile(matches[0].path, row.mime_type, row.content_sha256);
    assert.equal(readback.bytes.length, row.byte_length);
    const current = evidence.documents.filter(x => x.id === row.deliverable_id && x.client_slug === row.client_slug && x.team === row.team);
    assert.equal(current.length, 1, 'current_scope_required');
    assert.equal(await briefMediaHash(current[0].brief), row.source_sha256);
    const ref = briefMediaOccurrences(current[0].brief).find(x => x.offset === row.source_offset && x.length === row.source_length);
    assert.ok(ref); assert.equal(await briefMediaHash(ref.url), row.original_url_sha256);
    row.state = 'verified'; row.readback_sha256 = row.content_sha256; row.verified_at = evidence.observed_at;
  }
  await rehearse(directory, output);
  const bytes = Buffer.from(JSON.stringify(rows));
  fs.writeFileSync(path.join(output, 'ledger.private.json'), bytes, { mode: 0o600 });
  manifest.files['ledger.private.json'] = await briefMediaHash(bytes);
  const evidenceSha = await briefMediaHash(evidenceBytes);
  const name = 'receipts/' + evidenceSha + '.json';
  fs.writeFileSync(path.join(output, name), evidenceBytes, { flag: 'wx', mode: 0o600 });
  manifest.files[name] = evidenceSha;
  Object.assign(manifest, { kind: 'ADMISSION_PROPOSAL', admission: 'PROPOSED_NOT_INSTALLED',
    recovery_base_sha256: evidence.recovery_base_sha256, storage_readback_sha256: evidenceSha });
  fs.writeFileSync(path.join(output, 'manifest.private.json'), JSON.stringify(manifest), { mode: 0o600 });
  await verify(output);
  return { classification: 'OFFLINE_ADMISSION_PROPOSAL', occurrences: rows.length, installed: false };
}
// Assemble a recovery extension from an operator-supplied complete ledger export
// and object/receipt files. Caller must independently bind this local export to
// the authenticated base snapshot; this tool never takes a database snapshot.
export async function capture(inputFile, output) {
  const input = JSON.parse(fs.readFileSync(privateFile(inputFile), 'utf8'));
  assert.equal(input.contract, 'native_brief_media_recovery_v1');
  assert.ok(input.complete === true && HEX.test(input.recovery_base_sha256) && HEX.test(input.ledger_sha256));
  const ledgerBytes = fs.readFileSync(privateFile(input.ledger_path));
  assert.equal(await briefMediaHash(ledgerBytes), input.ledger_sha256);
  const rows = JSON.parse(ledgerBytes); assert.equal(rows.length, input.row_count);
  const files = { 'ledger.private.json': ledgerBytes, 'schema.sql': fs.readFileSync(path.join(ROOT, SCHEMA)) };
  for (const file of input.files) {
    assert.ok(/^(receipts\/[a-f0-9]{64}\.json|objects\/[a-f0-9]{64}\/[a-f0-9-]{36})$/.test(file.name));
    assert.ok(!files[file.name]);
    files[file.name] = fs.readFileSync(privateFile(file.path));
    assert.equal(await briefMediaHash(files[file.name]), file.sha256);
  }
  const manifest = { contract: 'native_brief_media_package_v1', kind: 'RECOVERY_CAPTURE', bucket: BRIEF_MEDIA_BUCKET,
    validation_contract: 'native_brief_existing_media_v1', validator_sha256: await validatorPin(),
    audience: 'staff', recovery_contract: input.contract, recovery_base_sha256: input.recovery_base_sha256,
    admission: 'RESTORE_NOT_SERVING', row_count: input.row_count,
    files: Object.fromEntries(await Promise.all(Object.entries(files).map(async ([n, b]) => [n, await briefMediaHash(b)]))) };
  const dir = newDirectory(output);
  for (const [name, bytes] of Object.entries(files)) {
    const target = path.join(dir, name); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  }
  fs.writeFileSync(path.join(dir, 'manifest.private.json'), JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  await verify(dir);
  return { classification: 'OFFLINE_RECOVERY_EXTENSION', occurrences: rows.length, authenticated_snapshot_acquired: false };
}
export async function rehearse(directory, output) {
  const { manifest, rows } = await verify(directory);
  const target = newDirectory(output);
  for (const name of [...Object.keys(manifest.files), 'manifest.private.json']) {
    const file = path.join(target, name); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(directory, name), file, fs.constants.COPYFILE_EXCL);
  }
  await verify(target);
  return { classification: 'OFFLINE_OBJECT_RECONSTRUCTION', kind: manifest.kind, occurrences: rows.length,
    sql_restored: false, storage_uploaded: false, serving: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode = 'verify', input, output, destination] = process.argv.slice(2);
    assert.ok(['verify', 'stage', 'rehearse', 'admission', 'capture'].includes(mode));
    const result = mode === 'admission' ? await admission(input, output, destination) : mode === 'capture' ? await capture(input, output)
      : mode === 'stage' ? await stage(input, output) : mode === 'rehearse' ? await rehearse(input, output)
      : { classification: 'OFFLINE_PACKAGE_VERIFIED', occurrences: (await verify(input)).rows.length };
    console.log(JSON.stringify(result));
  } catch { console.error('{"ok":false,"reason":"native_brief_media_package_refused"}'); process.exitCode = 2; }
}
