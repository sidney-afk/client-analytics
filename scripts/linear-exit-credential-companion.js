'use strict';
// Offline row envelope only. No capture, SQL execution, restore, sequence or object custody.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { canonicalJson, parseHmacKey } = require('./track-b-backup');
const FORMAT = 'credential-three-companion-v1';
const MAGIC = Buffer.from('SYNCVIEW-CREDENTIAL-THREE-V1\n');
const SCHEMA_SHA256 = 'e0fd80e9ee8a154af098752baf3f8d30c386790fd5916c7834d3fb30787f855a';
const SCHEMA_PATH = path.join(__dirname, '../docs/independence/LINEAR_EXIT_CREDENTIAL_ROW_SCHEMA_20260911.json');
const NAMES = ['client_credential_events', 'client_credentials', 'client_credentials_rev'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error('CREDENTIAL_COMPANION_' + code); };
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
  exact(value, ['package_sha256', 'schema_fingerprint', 'priority_companion_sha256']);
  if (!/^[a-f0-9]{64}$/.test(value.priority_companion_sha256) || !/^[a-f0-9]{64}$/.test(value.package_sha256) || !/^[a-f0-9]{32}$/.test(value.schema_fingerprint)) fail('PARENT_IDENTITY');
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
function encode({ tables, parentBytes, priorityBytes, hmacInput }) {
  const parent = identity(parentBytes, priorityBytes, hmacInput);
  if (typeof hmacInput !== 'string') fail('EXPLICIT_KEY_REQUIRED');
  const payload = validate({ format: FORMAT, parent, row_schema_sha256: SCHEMA_SHA256, tables }, parent);
  const unsigned = Buffer.concat([MAGIC, Buffer.from(canonicalJson(payload), 'utf8')]);
  return Buffer.concat([unsigned, crypto.createHmac('sha256', parseHmacKey(hmacInput)).update(unsigned).digest()]);
}
function decode({ credentialBytes: bytes, parentBytes, priorityBytes, hmacInput }) {
  const expectedParent = identity(parentBytes, priorityBytes, hmacInput);
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
function identity(parentBytes, priorityBytes, key) {
  const pair = require('./linear-exit-priority-companion').verifyPair(priorityBytes, parentBytes, key);
  validateRequirement(pair.parent.manifest.credential_companion_v1);
  return { ...pair.identity, priority_companion_sha256: sha(priorityBytes) };
}
function verifyTriple({ credentialBytes, priorityBytes, parentBytes, hmacInput: key }) {
  const pair = require('./linear-exit-priority-companion').verifyPair(priorityBytes, parentBytes, key);
  const credential = decode({credentialBytes,parentBytes,priorityBytes,hmacInput:key});
  return { ...pair, credential, complete_storage_proven: false, encryption_proven: false };
}
function requirement() { return {required:true,version:1,tables:NAMES,row_schema_sha256:SCHEMA_SHA256}; }
function validateRequirement(value) { if(canonicalJson(value)!==canonicalJson(requirement()))fail('REQUIREMENT'); }
module.exports = { FORMAT, SCHEMA_SHA256, schema, encode, decode, verifyTriple, requirement, validateRequirement };
