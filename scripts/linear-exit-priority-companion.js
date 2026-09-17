'use strict';
// Offline row envelope only. No capture, SQL execution, restore, sequence or object custody.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { canonicalJson, parseHmacKey } = require('./track-b-backup');
const FORMAT = 'priority-nine-companion-v1';
const MAGIC = Buffer.from('SYNCVIEW-PRIORITY-NINE-V1\n');
const SCHEMA_SHA256 = '40c039d6a12ffb2c43cc6d178bd8dd278f2e44d4d5ba12e22521f57a364dc310';
const SCHEMA_PATH = path.join(__dirname, '../docs/independence/LINEAR_EXIT_PRIORITY_ROW_SCHEMA_20260910.json');
const NAMES = ['batches_parent_claim_backup_20260824', 'content_samples', 'filming_plans', 'linear_archive_asset_rescue_config', 'production_comment_import_conflicts', 'production_comment_read_audit', 'production_comment_read_budget', 'thumbnail_media_revisions', 'workload_issues'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error('PRIORITY_COMPANION_' + code); };
function exact(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) fail('SHAPE');
}
function schema() {
  const bytes = fs.readFileSync(SCHEMA_PATH);
  if (sha(bytes) !== SCHEMA_SHA256) fail('SCHEMA_SOURCE_HASH');
  const result = JSON.parse(bytes);
  if (canonicalJson(result.tables.map(t => t.name).sort()) !== canonicalJson(NAMES)) fail('TABLE_ALLOWLIST');
  return result;
}
function parentIdentity(value) {
  exact(value, ['package_sha256', 'schema_fingerprint']);
  if (!/^[a-f0-9]{64}$/.test(value.package_sha256) || !/^[a-f0-9]{32}$/.test(value.schema_fingerprint)) fail('PARENT_IDENTITY');
  // Fingerprint is the existing recovery catalog MD5; package bytes use SHA256.
  return value;
}
function validate(payload, expectedParent) {
  exact(payload, ['format', 'parent', 'row_schema_sha256', 'tables']);
  if (payload.format !== FORMAT) fail('FORMAT');
  parentIdentity(payload.parent); parentIdentity(expectedParent);
  if (canonicalJson(payload.parent) !== canonicalJson(expectedParent)) fail('PARENT_MISMATCH');
  if (payload.row_schema_sha256 !== SCHEMA_SHA256) fail('SCHEMA_MISMATCH');
  const contract = schema();
  exact(payload.tables, NAMES);
  for (const table of contract.tables) {
    const item = payload.tables[table.name];
    exact(item, ['columns', 'primary_key', 'rows']);
    if (canonicalJson(item.columns) !== canonicalJson(table.columns) || canonicalJson(item.primary_key) !== canonicalJson(table.primary_key)) fail('TABLE_SCHEMA_MISMATCH');
    if (!Array.isArray(item.rows)) fail('ROWS_SHAPE');
    const keys = new Set();
    for (const row of item.rows) {
      if (!Array.isArray(row) || row.length !== table.columns.length) fail('ROW_SHAPE');
      for (let i = 0; i < row.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(row, i)) fail('ROW_SHAPE');
        const cell = row[i];
        if (cell !== null && typeof cell !== 'string') fail('CELL_TYPE');
        if (cell === null && table.columns[i].not_null) fail('NULLABILITY');
      }
      if (table.primary_key.length) {
        const cells = table.primary_key.map(name => row[table.columns.findIndex(c => c.name === name)]);
        if (cells.some(cell => cell === null || cell === undefined)) fail('PRIMARY_KEY_NULL');
        const key = canonicalJson(cells);
        if (keys.has(key)) fail('PRIMARY_KEY_DUPLICATE');
        keys.add(key);
      }
    }
  }
  return payload;
}
function encode(tables, parent, hmacInput) {
  if (typeof hmacInput !== 'string') fail('EXPLICIT_KEY_REQUIRED');
  const payload = validate({ format: FORMAT, parent, row_schema_sha256: SCHEMA_SHA256, tables }, parent);
  const unsigned = Buffer.concat([MAGIC, Buffer.from(canonicalJson(payload), 'utf8')]);
  return Buffer.concat([unsigned, crypto.createHmac('sha256', parseHmacKey(hmacInput)).update(unsigned).digest()]);
}
function decode(bytes, expectedParent, hmacInput) {
  if (typeof hmacInput !== 'string') fail('EXPLICIT_KEY_REQUIRED');
  if (!Buffer.isBuffer(bytes) || bytes.length < MAGIC.length + 34 || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) fail('FORMAT');
  const unsigned = bytes.subarray(0, -32);
  const mac = crypto.createHmac('sha256', parseHmacKey(hmacInput)).update(unsigned).digest();
  if (!crypto.timingSafeEqual(mac, bytes.subarray(-32))) fail('AUTHENTICATION');
  let payload;
  try { payload = JSON.parse(unsigned.subarray(MAGIC.length).toString('utf8')); } catch (_) { fail('JSON'); }
  if (!Buffer.from(canonicalJson(payload), 'utf8').equals(unsigned.subarray(MAGIC.length))) fail('NONCANONICAL');
  return validate(payload, expectedParent);
}
function verifyPair(companionBytes, parentBytes, hmacInput) {
  if (typeof hmacInput !== 'string') fail('EXPLICIT_KEY_REQUIRED');
  if (!Buffer.isBuffer(parentBytes)) fail('PARENT_BYTES_REQUIRED');
  const recovery = require('./track-b-recovery-package');
  const parent = recovery.readRecoveryPackage(parentBytes, hmacInput);
  if (parent.corpus !== 'history-v11') fail('PARENT_CORPUS');
  const identity = { package_sha256: sha(parentBytes), schema_fingerprint: parent.manifest.schema.fingerprint };
  const companion = decode(companionBytes, identity, hmacInput);
  // Authentication binds these exact packages; it cannot prove a shared snapshot.
  return { parent, companion, identity, same_snapshot_proven: false };
}
module.exports = { FORMAT, SCHEMA_SHA256, schema, encode, decode, verifyPair };
