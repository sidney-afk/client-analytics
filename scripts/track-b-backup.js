'use strict';

/*
 * Private Track-B transactional snapshot and freshness monitor.
 *
 * A single pg_dump process reads every allowlisted table from one PostgreSQL
 * snapshot. The source credential is required to have SELECT and no table
 * write privileges. The self-verifying package stays in RUNNER_TEMP until it
 * is uploaded directly to the pre-shared private Drive folder.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { TextDecoder } = require('util');
const zlib = require('zlib');

const PRODUCTION_REF = 'uzltbbrjidmjwwfakwve';
const DB_URL = String(process.env.TRACK_B_BACKUP_DATABASE_URL || '');
const DRIVE_FOLDER_ID = String(process.env.TRACK_B_BACKUP_DRIVE_FOLDER_ID || '');
const DRIVE_CREDENTIALS_INPUT = String(
  process.env.TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON
  || process.env.TRACK_B_BACKUP_GOOGLE_SERVICE_ACCOUNT_JSON
  || '',
);
const SLACK_WEBHOOK = String(process.env.SLACK_ALERT_WEBHOOK || '');
const HMAC_KEY_INPUT = String(process.env.TRACK_B_BACKUP_HMAC_KEY || '');
const FRESHNESS_HOURS = Math.max(1, Number(process.env.TRACK_B_BACKUP_FRESHNESS_HOURS || 7));
const FILE_PREFIX = 'syncview-track-b-';
const ALERT_MARKER_PREFIX = 'syncview-track-b-alert-';
const PACKAGE_MAGIC = Buffer.from('SYNCVIEW_TRACK_B_SNAPSHOT_V3\n', 'utf8');
const HMAC_BYTES = 32;
const DRIVE_PAGE_SIZE = 1000;
const MAX_DRIVE_PAGES = 100;
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;
const SCHEMA_VERSION = 3;

const TABLES = Object.freeze([
  { name: 'team_members', pk: 'id' },
  { name: 'clients', pk: 'slug' },
  { name: 'client_access', pk: 'slug' },
  { name: 'client_access_events', pk: 'id', identity: true },
  { name: 'syncview_auth_events', pk: 'id', identity: true },
  { name: 'syncview_runtime_flags', pk: 'key' },
  { name: 'flag_flips', pk: 'id', identity: true },
  { name: 'settings_events', pk: 'id', identity: true },
  { name: 'batches', pk: 'id' },
  { name: 'deliverables', pk: 'id' },
  { name: 'production_comments', pk: 'id' },
  { name: 'deliverable_events', pk: 'id', identity: true },
  { name: 'mirror_outbox', pk: 'id', identity: true },
  { name: 'linear_archive', pk: 'linear_uuid' },
]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
  return out;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function isSnapshotName(value) {
  return /^syncview-track-b-\d{8}T\d{6}Z\.snapshot$/.test(clean(value));
}

function snapshotName(generatedAt) {
  const stamp = clean(generatedAt).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const name = `${FILE_PREFIX}${stamp}.snapshot`;
  if (!isSnapshotName(name)) throw new Error('Snapshot generated_at cannot produce a safe Drive filename');
  return name;
}

function exactTableNames(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected = TABLES.map(config => config.name).sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function assertExactTableManifest(manifest) {
  if (Number(manifest && manifest.table_count) !== TABLES.length
    || !exactTableNames(manifest && manifest.tables)) {
    throw new Error('Track-B snapshot manifest does not contain the exact table allowlist');
  }
  return true;
}

function strictConnectionInfo(url) {
  const raw = clean(url);
  if (!raw) throw new Error('PostgreSQL connection URL is required');
  if (/[\u0000-\u0020\u007f]/.test(raw)) throw new Error('PostgreSQL connection URL contains whitespace or control bytes');
  let parsed;
  try { parsed = new URL(raw); } catch (_) { throw new Error('PostgreSQL connection URL is invalid'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('PostgreSQL connection URL must use postgres:// or postgresql://');
  }
  if (parsed.hash) throw new Error('PostgreSQL connection URL must not contain a fragment');
  if (parsed.pathname !== '/postgres') throw new Error('PostgreSQL connection URL must target the postgres database');
  if (!parsed.username || !parsed.password) throw new Error('PostgreSQL connection URL must contain an explicit user and password');
  const queryEntries = [...parsed.searchParams.entries()];
  if (queryEntries.length > 1 || (queryEntries.length === 1 && queryEntries[0][0] !== 'sslmode')) {
    throw new Error('PostgreSQL connection URL permits only one sslmode query parameter');
  }
  if (queryEntries.length === 1 && !['require', 'verify-ca', 'verify-full'].includes(queryEntries[0][1])) {
    throw new Error('PostgreSQL sslmode must require TLS');
  }
  const direct = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if (direct) {
    if (parsed.port && parsed.port !== '5432') throw new Error('Direct Supabase PostgreSQL URL must use port 5432');
    let user;
    let password;
    try {
      user = decodeURIComponent(parsed.username);
      password = decodeURIComponent(parsed.password);
    } catch (_) { throw new Error('PostgreSQL credentials are invalid'); }
    if (!/^[a-z_][a-z0-9_]*$/i.test(user)) throw new Error('Direct PostgreSQL user is invalid');
    return {
      url: parsed.toString(), ref: direct[1], kind: 'direct', user, password,
      host: parsed.hostname, port: parsed.port || '5432', database: 'postgres',
      sslmode: parsed.searchParams.get('sslmode') || 'require',
    };
  }
  if (!/\.pooler\.supabase\.com$/i.test(parsed.hostname)) {
    throw new Error('PostgreSQL connection URL must use an approved Supabase host');
  }
  if (parsed.port && !['5432', '6543'].includes(parsed.port)) throw new Error('Supabase pooler URL must use port 5432 or 6543');
  let user;
  let password;
  try {
    user = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch (_) { throw new Error('PostgreSQL credentials are invalid'); }
  const pooled = user.match(/^([a-z_][a-z0-9_]*)\.([a-z0-9]+)$/i);
  if (!pooled) throw new Error('Supabase pooler user must include the project ref');
  return {
    url: parsed.toString(), ref: pooled[2], kind: 'pooler', user, password,
    host: parsed.hostname, port: parsed.port || '5432', database: 'postgres',
    sslmode: parsed.searchParams.get('sslmode') || 'require',
  };
}

function connectionProjectRef(url) {
  try { return strictConnectionInfo(url).ref; } catch (_) { return ''; }
}

function assertProductionSource(url = DB_URL) {
  if (!clean(url)) throw new Error('TRACK_B_BACKUP_DATABASE_URL is required');
  const ref = strictConnectionInfo(url).ref;
  if (!ref || ref !== PRODUCTION_REF) {
    throw new Error('Backup database URL must identify the production Supabase project');
  }
  return ref;
}

function outputArg() {
  const raw = process.argv.find(arg => arg.startsWith('--output='));
  return raw ? raw.slice('--output='.length) : '';
}

function postgresEnvironment(url, appName) {
  const info = strictConnectionInfo(url);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  return {
    ...environment,
    PGHOST: info.host,
    PGPORT: info.port,
    PGUSER: info.user,
    PGPASSWORD: info.password,
    PGDATABASE: info.database,
    PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: appName,
    PGSSLMODE: info.sslmode,
  };
}

function opaqueToolError(stage, tool, result) {
  const exit = result && Number.isInteger(result.status) ? String(result.status) : 'launch';
  return new Error(`${stage} failed (${tool}; exit=${exit})`);
}

function runOpaqueTool(stage, tool, args, options, spawn = spawnSync) {
  let result;
  try {
    result = spawn(tool, args, options);
  } catch (_) {
    throw opaqueToolError(stage, tool, null);
  }
  if (result.error || result.status !== 0) throw opaqueToolError(stage, tool, result);
  return result;
}

function runPostgresTool(command, args, capture = false, stage = 'PostgreSQL backup tool') {
  const result = runOpaqueTool(stage, command, args, {
      encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      env: postgresEnvironment(DB_URL, 'syncview-track-b-backup'),
    });
  return result.stdout || '';
}

function readOnlyPrivilegeSql() {
  return TABLES.map(config => {
    const relation = `public.${config.name}`;
    return `select '${config.name}', has_table_privilege(current_user, '${relation}', 'SELECT'), `
      + `has_table_privilege(current_user, '${relation}', 'INSERT'), `
      + `has_table_privilege(current_user, '${relation}', 'UPDATE'), `
      + `has_table_privilege(current_user, '${relation}', 'DELETE'), `
      + `has_table_privilege(current_user, '${relation}', 'TRUNCATE'), `
      + `(select rolbypassrls from pg_roles where rolname=current_user)`;
  }).join(' union all ');
}

function verifyReadOnlyPrivilegeOutput(text) {
  const observed = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!clean(line)) continue;
    const [name, select, insert, update, remove, truncate, allRows] = line.split('|').map(clean);
    observed.set(name, { select, insert, update, remove, truncate, allRows });
  }
  for (const config of TABLES) {
    const row = observed.get(config.name);
    if (!row || row.select !== 't') throw new Error(`Backup database role lacks SELECT on public.${config.name}`);
    if ([row.insert, row.update, row.remove, row.truncate].some(value => value !== 'f')) {
      throw new Error(`Backup database role has a forbidden write privilege on public.${config.name}`);
    }
    if (row.allRows !== 't') {
      throw new Error(`Backup database role does not have BYPASSRLS for public.${config.name}`);
    }
  }
  return true;
}

function assertReadOnlySource() {
  assertProductionSource();
  const output = runPostgresTool('psql', [
    '--no-psqlrc', '--tuples-only', '--no-align', '--field-separator=|',
    '--set=ON_ERROR_STOP=1', '--command', readOnlyPrivilegeSql(),
  ], true, 'Backup privilege preflight');
  return verifyReadOnlyPrivilegeOutput(output);
}

function pgDumpArgs(output) {
  const args = [
    '--format=plain',
    '--data-only',
    '--serializable-deferrable',
    '--no-owner',
    '--no-privileges',
    '--encoding=UTF8',
    '--lock-wait-timeout=60000',
    `--file=${path.resolve(output)}`,
  ];
  for (const config of TABLES) args.push(`--table=public.${config.name}`);
  return args;
}

function parseDumpIdentifier(value) {
  const token = clean(value);
  const quoted = token.match(/^"([a-z_][a-z0-9_]*)"$/);
  const name = quoted ? quoted[1] : token;
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Unsafe PostgreSQL dump identifier');
  return name;
}

function allowedDumpControlLine(line) {
  if (!line || line.startsWith('--')) return true;
  if (/^\\(?:un)?restrict [A-Za-z0-9]+$/.test(line)) return true;
  if (/^SET (?:statement_timeout|lock_timeout|idle_in_transaction_session_timeout|transaction_timeout) = 0;$/.test(line)) return true;
  if (/^SET client_encoding = 'UTF8';$/.test(line)) return true;
  if (/^SET standard_conforming_strings = on;$/.test(line)) return true;
  if (/^SET check_function_bodies = false;$/.test(line)) return true;
  if (/^SET xmloption = content;$/.test(line)) return true;
  if (/^SET client_min_messages = warning;$/.test(line)) return true;
  if (/^SET row_security = off;$/.test(line)) return true;
  if (/^SET default_tablespace = '';$/.test(line)) return true;
  if (/^SET default_table_access_method = heap;$/.test(line)) return true;
  if (line === "SELECT pg_catalog.set_config('search_path', '', false);") return true;
  const sequence = line.match(/^SELECT pg_catalog\.setval\('public\.([a-z_][a-z0-9_]*)'(?:::regclass)?, [0-9]+, (?:true|false)\);$/);
  if (sequence) {
    const allowedSequences = new Set(TABLES.filter(config => config.identity).map(config => `${config.name}_${config.pk}_seq`));
    return allowedSequences.has(sequence[1]);
  }
  return false;
}

function parseStrictPgDump(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) {
    throw new Error('Track-B PostgreSQL dump is not valid UTF-8');
  }
  if (text.includes('\0')) throw new Error('Track-B PostgreSQL dump contains a NUL byte');
  if (/\r(?!\n)/.test(text)) throw new Error('Track-B PostgreSQL dump contains an invalid carriage return');
  const allowlist = new Set(TABLES.map(config => config.name));
  const tables = {};
  let active = null;
  let sawHeader = false;
  for (const line of text.split(/\r?\n/)) {
    if (line === '-- PostgreSQL database dump') sawHeader = true;
    if (active) {
      if (line === '\\.') {
        tables[active.name] = active;
        active = null;
      } else {
        active.rows.push(line);
      }
      continue;
    }
    const copy = line.match(/^COPY public\.([a-z_][a-z0-9_]*) \((.+)\) FROM stdin;$/);
    if (copy) {
      const name = copy[1];
      if (!allowlist.has(name)) throw new Error('Unexpected table in Track-B dump');
      if (tables[name]) throw new Error(`Duplicate COPY section for public.${name}`);
      const columns = copy[2].split(',').map(parseDumpIdentifier);
      if (!columns.length || new Set(columns).size !== columns.length) {
        throw new Error(`Invalid COPY column list for public.${name}`);
      }
      active = { name, columns, rows: [] };
      continue;
    }
    if (!allowedDumpControlLine(line)) {
      throw new Error('Disallowed PostgreSQL dump statement');
    }
  }
  if (!sawHeader) throw new Error('Track-B package does not contain a PostgreSQL dump');
  if (active) throw new Error(`Unterminated COPY section for public.${active.name}`);
  for (const config of TABLES) {
    if (!tables[config.name]) throw new Error(`Track-B dump is missing public.${config.name}`);
  }
  return { tables };
}

function inspectPlainDump(value) {
  const parsed = parseStrictPgDump(value);
  return Object.fromEntries(TABLES.map(config => [config.name, {
    rows: parsed.tables[config.name].rows.length,
    primary_key: config.pk,
  }]));
}

function quotedIdentifier(value) {
  const name = parseDumpIdentifier(value);
  return `"${name}"`;
}

function renderSafeCopySections(value) {
  const parsed = parseStrictPgDump(value);
  const lines = [];
  for (const config of TABLES) {
    const section = parsed.tables[config.name];
    lines.push(`COPY public.${quotedIdentifier(config.name)} (${section.columns.map(quotedIdentifier).join(', ')}) FROM stdin;`);
    lines.push(...section.rows, '\\.');
  }
  return `${lines.join('\n')}\n`;
}

function parseHmacKey(input = HMAC_KEY_INPUT) {
  const encoded = clean(input);
  if (!/^(?:[A-Za-z0-9+/]{4}){8,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('TRACK_B_BACKUP_HMAC_KEY must be canonical base64');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length < 32 || key.toString('base64') !== encoded) {
    throw new Error('TRACK_B_BACKUP_HMAC_KEY must decode to at least 32 bytes');
  }
  return key;
}

function hmacSha256(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function buildManifest(dumpBytes, generatedAt = new Date().toISOString(), sourceUrl = DB_URL) {
  const tables = inspectPlainDump(dumpBytes);
  return {
    format: 'syncview-track-b-postgresql-snapshot',
    schema_version: SCHEMA_VERSION,
    table_count: TABLES.length,
    generated_at: generatedAt,
    completed_at: new Date().toISOString(),
    source_project_ref: assertProductionSource(sourceUrl),
    source_commit: clean(process.env.GITHUB_SHA) || null,
    authentication: { algorithm: 'hmac-sha256', tag_bytes: HMAC_BYTES },
    snapshot: {
      engine: 'pg_dump',
      isolation: 'serializable-deferrable',
      format: 'postgresql-plain-data-only',
      bytes: dumpBytes.length,
      sha256: sha256(dumpBytes),
    },
    tables,
  };
}

function packSnapshot(dumpFile, output, generatedAt = new Date().toISOString(), sourceUrl = DB_URL, hmacInput = HMAC_KEY_INPUT) {
  const key = parseHmacKey(hmacInput);
  const dumpBytes = fs.readFileSync(path.resolve(dumpFile));
  const manifest = buildManifest(dumpBytes, generatedAt, sourceUrl);
  const compressed = zlib.gzipSync(dumpBytes, { level: 9 });
  manifest.snapshot.compressed_bytes = compressed.length;
  manifest.snapshot.compressed_sha256 = sha256(compressed);
  const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(manifestBytes.length));
  const unsignedPackage = Buffer.concat([PACKAGE_MAGIC, length, manifestBytes, compressed]);
  const packageBytes = Buffer.concat([unsignedPackage, hmacSha256(key, unsignedPackage)]);
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), packageBytes, { mode: 0o600 });
  return manifest;
}

function authenticatedGeneratedAt(manifest, nowMs = Date.now()) {
  const generatedAt = clean(manifest && manifest.generated_at);
  const completedAt = clean(manifest && manifest.completed_at);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(generatedAt)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(completedAt)) {
    throw new Error('Track-B snapshot timestamps are not canonical UTC');
  }
  const generatedMs = Date.parse(generatedAt);
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(generatedMs) || !Number.isFinite(completedMs)
    || new Date(generatedMs).toISOString() !== generatedAt
    || new Date(completedMs).toISOString() !== completedAt
    || completedMs < generatedMs) {
    throw new Error('Track-B snapshot timestamps are invalid');
  }
  if (generatedMs > nowMs + MAX_FUTURE_SKEW_MS || completedMs > nowMs + MAX_FUTURE_SKEW_MS) {
    throw new Error('Track-B snapshot timestamp is too far in the future');
  }
  if (clean(manifest.source_project_ref) !== PRODUCTION_REF) {
    throw new Error('Track-B snapshot is not from the production project');
  }
  return generatedMs;
}

function readSnapshotBytes(packageBytesInput, hmacInput = HMAC_KEY_INPUT, nowMs = Date.now()) {
  const key = parseHmacKey(hmacInput);
  const packageBytes = Buffer.isBuffer(packageBytesInput) ? packageBytesInput : Buffer.from(packageBytesInput || '');
  if (packageBytes.length < PACKAGE_MAGIC.length + 8 + 2 + HMAC_BYTES
    || !packageBytes.subarray(0, PACKAGE_MAGIC.length).equals(PACKAGE_MAGIC)) {
    throw new Error('Unsupported Track-B snapshot package');
  }
  const unsignedPackage = packageBytes.subarray(0, packageBytes.length - HMAC_BYTES);
  const actualTag = packageBytes.subarray(packageBytes.length - HMAC_BYTES);
  const expectedTag = hmacSha256(key, unsignedPackage);
  if (!crypto.timingSafeEqual(actualTag, expectedTag)) {
    throw new Error('Track-B snapshot authentication failed');
  }
  const manifestLength = Number(packageBytes.readBigUInt64BE(PACKAGE_MAGIC.length));
  const manifestStart = PACKAGE_MAGIC.length + 8;
  const payloadStart = manifestStart + manifestLength;
  const payloadEnd = packageBytes.length - HMAC_BYTES;
  if (!Number.isSafeInteger(manifestLength) || manifestLength < 2 || manifestLength > 1024 * 1024 || payloadStart >= payloadEnd) {
    throw new Error('Invalid Track-B snapshot manifest length');
  }
  let manifest;
  try { manifest = JSON.parse(packageBytes.subarray(manifestStart, payloadStart).toString('utf8')); } catch (_) {
    throw new Error('Invalid Track-B snapshot manifest JSON');
  }
  if (manifest.format !== 'syncview-track-b-postgresql-snapshot' || manifest.schema_version !== SCHEMA_VERSION) {
    throw new Error('Unsupported Track-B snapshot manifest');
  }
  if (!manifest.authentication || manifest.authentication.algorithm !== 'hmac-sha256'
    || Number(manifest.authentication.tag_bytes) !== HMAC_BYTES) {
    throw new Error('Unsupported Track-B snapshot authentication metadata');
  }
  const compressed = packageBytes.subarray(payloadStart, payloadEnd);
  if (Number(manifest.snapshot && manifest.snapshot.compressed_bytes) !== compressed.length
    || clean(manifest.snapshot && manifest.snapshot.compressed_sha256) !== sha256(compressed)) {
    throw new Error('Track-B compressed snapshot checksum mismatch');
  }
  let dumpBytes;
  try { dumpBytes = zlib.gunzipSync(compressed); } catch (_) {
    throw new Error('Track-B snapshot payload is not valid gzip data');
  }
  if (Number(manifest.snapshot && manifest.snapshot.bytes) !== dumpBytes.length
    || clean(manifest.snapshot && manifest.snapshot.sha256) !== sha256(dumpBytes)) {
    throw new Error('Track-B PostgreSQL dump checksum mismatch');
  }
  const parsed = parseStrictPgDump(dumpBytes);
  const inspected = inspectPlainDump(dumpBytes);
  assertExactTableManifest(manifest);
  for (const config of TABLES) {
    const expected = manifest.tables && manifest.tables[config.name];
    const actual = inspected[config.name];
    if (!expected || Number(expected.rows) !== actual.rows || clean(expected.primary_key) !== config.pk) {
      throw new Error(`Track-B snapshot manifest mismatch for ${config.name}`);
    }
  }
  authenticatedGeneratedAt(manifest, nowMs);
  return { manifest, dumpBytes, parsed };
}

function readSnapshotFile(file, hmacInput = HMAC_KEY_INPUT, nowMs = Date.now()) {
  return readSnapshotBytes(fs.readFileSync(path.resolve(file)), hmacInput, nowMs);
}

function verifySnapshotFile(file, extractTo = '', hmacInput = HMAC_KEY_INPUT) {
  const snapshot = readSnapshotFile(file, hmacInput);
  if (extractTo) {
    fs.mkdirSync(path.dirname(path.resolve(extractTo)), { recursive: true });
    fs.writeFileSync(path.resolve(extractTo), snapshot.dumpBytes, { mode: 0o600 });
  }
  return snapshot.manifest;
}

function parseDriveCredentials(input = DRIVE_CREDENTIALS_INPUT) {
  if (!clean(input)) throw new Error('TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON is required');
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch (_) {
    try { parsed = JSON.parse(Buffer.from(input, 'base64').toString('utf8')); } catch (_error) {
      throw new Error('Google Drive credentials secret is not valid JSON or base64 JSON');
    }
  }
  const serviceAccount = clean(parsed.client_email) && clean(parsed.private_key);
  const authorizedUser = clean(parsed.client_id) && clean(parsed.client_secret) && clean(parsed.refresh_token);
  if (!serviceAccount && !authorizedUser) {
    throw new Error('Google Drive credentials must be a service account or authorized-user refresh credential');
  }
  parsed.token_uri = clean(parsed.token_uri) || 'https://oauth2.googleapis.com/token';
  return parsed;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function driveAccessToken(account) {
  if (clean(account.refresh_token)) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: account.client_id,
      client_secret: account.client_secret,
      refresh_token: account.refresh_token,
    });
    const response = await fetch(account.token_uri, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    if (!response.ok) throw new Error(`Google OAuth refresh HTTP ${response.status}`);
    const json = await response.json();
    if (!clean(json.access_token)) throw new Error('Google OAuth refresh returned no access token');
    return json.access_token;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: account.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${unsigned}.${signature}`,
  });
  const response = await fetch(account.token_uri, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!response.ok) throw new Error(`Google OAuth HTTP ${response.status}`);
  const json = await response.json();
  if (!clean(json.access_token)) throw new Error('Google OAuth returned no access token');
  return json.access_token;
}

async function listDriveFiles(token, query, fetchImpl = fetch, folderId = DRIVE_FOLDER_ID) {
  if (!folderId) throw new Error('TRACK_B_BACKUP_DRIVE_FOLDER_ID is required');
  const files = [];
  const seenTokens = new Set();
  let pageToken = '';
  for (let page = 0; page < MAX_DRIVE_PAGES; page += 1) {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false and (${query})`,
      fields: 'nextPageToken,files(id,name,parents,createdTime,modifiedTime,size,md5Checksum)',
      orderBy: 'createdTime desc', pageSize: String(DRIVE_PAGE_SIZE), spaces: 'drive',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Google Drive list HTTP ${response.status}`);
    const json = await response.json();
    if (!json || !Array.isArray(json.files)) throw new Error('Google Drive list response is incomplete');
    files.push(...json.files);
    const next = clean(json.nextPageToken);
    if (!next) return files;
    if (seenTokens.has(next)) throw new Error('Google Drive list returned a repeated page token');
    seenTokens.add(next);
    pageToken = next;
  }
  throw new Error('Google Drive list exceeded the pagination safety cap');
}

async function listBackups(token, fetchImpl = fetch, folderId = DRIVE_FOLDER_ID) {
  const files = await listDriveFiles(token, `name contains '${FILE_PREFIX}'`, fetchImpl, folderId);
  return files.filter(file => isSnapshotName(file && file.name));
}

async function uploadDriveBytes(token, bytes, name) {
  const metadata = Buffer.from(JSON.stringify({ name, parents: [DRIVE_FOLDER_ID] }));
  const boundary = `trackb_${crypto.randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`), metadata,
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,createdTime,size,md5Checksum', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  if (!response.ok) throw new Error(`Google Drive upload HTTP ${response.status}`);
  return response.json();
}

async function uploadBackup(token, filePath, name) {
  return uploadDriveBytes(token, fs.readFileSync(filePath), name);
}

async function driveFileMetadata(token, fileId) {
  const params = new URLSearchParams({
    fields: 'id,name,parents,createdTime,modifiedTime,size,md5Checksum',
    supportsAllDrives: 'true',
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Google Drive metadata HTTP ${response.status}`);
  return response.json();
}

async function downloadBackupBytes(token, fileId) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Google Drive download HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function assertDriveReadback(metadata, remoteBytes, localBytes, expectedName, expectedFolderId, expectedFileId = '') {
  const expectedMd5 = md5(localBytes);
  const sameLength = remoteBytes.length === localBytes.length;
  if ((expectedFileId && clean(metadata && metadata.id) !== clean(expectedFileId))
    || clean(metadata && metadata.name) !== expectedName
    || !Array.isArray(metadata && metadata.parents)
    || !metadata.parents.map(clean).includes(expectedFolderId)
    || Number(metadata && metadata.size) !== localBytes.length
    || clean(metadata && metadata.md5Checksum).toLowerCase() !== expectedMd5
    || !sameLength
    || md5(remoteBytes) !== expectedMd5
    || (sameLength && !crypto.timingSafeEqual(remoteBytes, localBytes))) {
    throw new Error('Google Drive backup readback does not match the local authenticated package');
  }
  return true;
}

function alertMarkerName(staleKey) {
  return `${ALERT_MARKER_PREFIX}${sha256(clean(staleKey)).slice(0, 32)}.json`;
}

function buildAlertMarker(staleKey, ageHours, alertedAt = new Date().toISOString(), hmacInput = HMAC_KEY_INPUT) {
  const payload = {
    format: 'syncview-track-b-freshness-alert',
    schema_version: 1,
    stale_key: clean(staleKey),
    age_hours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
    threshold_hours: FRESHNESS_HOURS,
    alerted_at: alertedAt,
  };
  const payloadBytes = Buffer.from(canonicalJson(payload), 'utf8');
  return Buffer.from(canonicalJson({
    payload,
    hmac_sha256: hmacSha256(parseHmacKey(hmacInput), payloadBytes).toString('base64'),
  }), 'utf8');
}

function readAlertMarker(bytes, staleKey, hmacInput = HMAC_KEY_INPUT) {
  let envelope;
  try { envelope = JSON.parse(Buffer.from(bytes || '').toString('utf8')); } catch (_) {
    throw new Error('Drive freshness marker is not valid JSON');
  }
  const payload = envelope && envelope.payload;
  if (!payload || payload.format !== 'syncview-track-b-freshness-alert'
    || payload.schema_version !== 1 || clean(payload.stale_key) !== clean(staleKey)) {
    throw new Error('Drive freshness marker does not match the stale snapshot');
  }
  const payloadBytes = Buffer.from(canonicalJson(payload), 'utf8');
  let actual;
  try { actual = Buffer.from(clean(envelope.hmac_sha256), 'base64'); } catch (_) {
    throw new Error('Drive freshness marker authentication is invalid');
  }
  const expected = hmacSha256(parseHmacKey(hmacInput), payloadBytes);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error('Drive freshness marker authentication failed');
  }
  return payload;
}

async function verifyUploadedBackup(token, fileId, expectedName, filePath, hmacInput = HMAC_KEY_INPUT) {
  const localBytes = fs.readFileSync(path.resolve(filePath));
  const localSnapshot = readSnapshotBytes(localBytes, hmacInput);
  const metadata = await driveFileMetadata(token, fileId);
  const remoteBytes = await downloadBackupBytes(token, fileId);
  assertDriveReadback(metadata, remoteBytes, localBytes, expectedName, DRIVE_FOLDER_ID, fileId);
  const remoteSnapshot = readSnapshotBytes(remoteBytes, hmacInput);
  if (remoteSnapshot.manifest.snapshot.sha256 !== localSnapshot.manifest.snapshot.sha256) {
    throw new Error('Google Drive backup readback snapshot checksum mismatch');
  }
  return {
    metadata,
    manifest: remoteSnapshot.manifest,
    bytes: remoteBytes.length,
    package_sha256: sha256(remoteBytes),
    compressed_sha256: remoteSnapshot.manifest.snapshot.compressed_sha256,
  };
}

async function hasFreshnessMarker(token, staleKey) {
  const name = alertMarkerName(staleKey);
  const escaped = name.replace(/'/g, "\\'");
  const files = await listDriveFiles(token, `name = '${escaped}'`);
  for (const file of files) {
    try {
      const bytes = await downloadBackupBytes(token, file.id);
      readAlertMarker(bytes, staleKey);
      return true;
    } catch (_) {}
  }
  return false;
}

async function writeFreshnessMarker(token, staleKey, ageHours) {
  const name = alertMarkerName(staleKey);
  const bytes = buildAlertMarker(staleKey, ageHours);
  const uploaded = await uploadDriveBytes(token, bytes, name);
  const metadata = await driveFileMetadata(token, uploaded.id);
  const remoteBytes = await downloadBackupBytes(token, uploaded.id);
  assertDriveReadback(metadata, remoteBytes, bytes, name, DRIVE_FOLDER_ID, uploaded.id);
  readAlertMarker(remoteBytes, staleKey);
}

function selectAuthenticatedCandidates(candidates, hmacInput = HMAC_KEY_INPUT, nowMs = Date.now()) {
  parseHmacKey(hmacInput);
  const valid = [];
  let invalidCount = 0;
  for (const candidate of candidates || []) {
    try {
      if (!candidate || candidate.error || !candidate.file || !Buffer.isBuffer(candidate.bytes)) throw new Error('candidate unavailable');
      const snapshot = readSnapshotBytes(candidate.bytes, hmacInput, nowMs);
      if (clean(candidate.file.name) !== snapshotName(snapshot.manifest.generated_at)) {
        throw new Error('Drive filename does not match authenticated generated_at');
      }
      valid.push({
        file: candidate.file,
        bytes: candidate.bytes,
        snapshot,
        generatedMs: authenticatedGeneratedAt(snapshot.manifest, nowMs),
      });
    } catch (_) {
      invalidCount += 1;
    }
  }
  valid.sort((a, b) => b.generatedMs - a.generatedMs);
  return { latest: valid[0] || null, validCount: valid.length, invalidCount };
}

async function downloadDriveCandidates(token, files) {
  const candidates = [];
  for (const file of files || []) {
    try {
      candidates.push({ file, bytes: await downloadBackupBytes(token, file.id) });
    } catch (_) {
      candidates.push({ file, error: true });
    }
  }
  return candidates;
}

async function createAndUpload() {
  assertProductionSource();
  assertReadOnlySource();
  const generatedAt = new Date().toISOString();
  const name = snapshotName(generatedAt);
  const output = path.resolve(outputArg() || path.join(process.env.RUNNER_TEMP || process.cwd(), name));
  const tempDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'track-b-dump-'));
  const dumpFile = path.join(tempDir, 'track-b.sql');
  try {
    runPostgresTool('pg_dump', pgDumpArgs(dumpFile), false, 'Transactional Track-B snapshot');
    const manifest = packSnapshot(dumpFile, output, generatedAt);
    verifySnapshotFile(output);
    const account = parseDriveCredentials();
    const token = await driveAccessToken(account);
    const uploaded = await uploadBackup(token, output, name);
    const readback = await verifyUploadedBackup(token, uploaded.id, name, output);
    console.log(JSON.stringify({
      ok: true,
      file_id: uploaded.id,
      file_name: name,
      last_known_good_advanced: true,
      snapshot_sha256: manifest.snapshot.sha256,
      compressed_sha256: readback.compressed_sha256,
      package_sha256: readback.package_sha256,
      tables: manifest.tables,
      bytes: readback.bytes,
      drive_md5: readback.metadata.md5Checksum,
      hmac_verified: true,
      readback_verified: true,
    }));
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function postSlack(text) {
  if (!SLACK_WEBHOOK) throw new Error('SLACK_ALERT_WEBHOOK is required for backup freshness alerts');
  const response = await fetch(SLACK_WEBHOOK, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  });
  const body = await response.text();
  if (!response.ok || clean(body).toLowerCase() !== 'ok') throw new Error(`Slack freshness alert failed with HTTP ${response.status}`);
}

async function checkFreshness() {
  const account = parseDriveCredentials();
  const token = await driveAccessToken(account);
  const files = await listBackups(token);
  const nowMs = Date.now();
  const selection = selectAuthenticatedCandidates(await downloadDriveCandidates(token, files), HMAC_KEY_INPUT, nowMs);
  const latest = selection.latest;
  const ageHours = latest ? (nowMs - latest.generatedMs) / 3600000 : Infinity;
  const stale = !latest || ageHours > FRESHNESS_HOURS;
  if (!stale) {
    console.log(JSON.stringify({
      ok: true,
      stale: false,
      latest_file_id: latest.file.id,
      authenticated_generated_at: latest.snapshot.manifest.generated_at,
      age_hours: Number(ageHours.toFixed(2)),
      threshold_hours: FRESHNESS_HOURS,
      invalid_candidates: selection.invalidCount,
    }));
    return;
  }
  const staleKey = latest
    ? `snapshot:${latest.snapshot.manifest.snapshot.sha256.slice(0, 24)}`
    : `no-valid-snapshot:${new Date(nowMs).toISOString().slice(0, 10)}`;
  const alreadyPaged = await hasFreshnessMarker(token, staleKey);
  if (!alreadyPaged) {
    const ageText = Number.isFinite(ageHours) ? `${ageHours.toFixed(1)}h` : 'missing';
    await postSlack(`SyncView Track-B private backup is stale. age=${ageText}; threshold=${FRESHNESS_HOURS}h; backup_handle=${staleKey}`);
    await writeFreshnessMarker(token, staleKey, ageHours);
  }
  console.log(JSON.stringify({
    ok: false,
    stale: true,
    alerted: !alreadyPaged,
    stale_key: staleKey,
    authenticated_generated_at: latest ? latest.snapshot.manifest.generated_at : null,
    age_hours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
    threshold_hours: FRESHNESS_HOURS,
    invalid_candidates: selection.invalidCount,
  }));
  process.exitCode = 1;
}

async function downloadLatest() {
  const output = outputArg();
  if (!output) throw new Error('download-latest requires --output=PATH');
  const account = parseDriveCredentials();
  const token = await driveAccessToken(account);
  const files = await listBackups(token);
  if (!files.length) throw new Error('No Track-B backup exists in the configured Drive folder');
  const selection = selectAuthenticatedCandidates(await downloadDriveCandidates(token, files));
  if (!selection.latest) throw new Error('No authenticated Track-B backup exists in the configured Drive folder');
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), selection.latest.bytes, { mode: 0o600 });
  const manifest = selection.latest.snapshot.manifest;
  console.log(JSON.stringify({
    ok: true,
    file_id: selection.latest.file.id,
    file_name: selection.latest.file.name,
    bytes: selection.latest.bytes.length,
    generated_at: manifest.generated_at,
    snapshot_sha256: manifest.snapshot.sha256,
    invalid_candidates: selection.invalidCount,
  }));
}

async function main() {
  const command = clean(process.argv[2] || 'export');
  if (command === 'export') return createAndUpload();
  if (command === 'freshness') return checkFreshness();
  if (command === 'download-latest') return downloadLatest();
  throw new Error(`Unknown Track-B backup command: ${command}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error && error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  FILE_PREFIX,
  HMAC_BYTES,
  MAX_FUTURE_SKEW_MS,
  PACKAGE_MAGIC,
  PRODUCTION_REF,
  SCHEMA_VERSION,
  TABLES,
  assertDriveReadback,
  assertExactTableManifest,
  assertProductionSource,
  authenticatedGeneratedAt,
  buildManifest,
  canonicalJson,
  connectionProjectRef,
  inspectPlainDump,
  isSnapshotName,
  listBackups,
  listDriveFiles,
  md5,
  packSnapshot,
  parseHmacKey,
  parseDriveCredentials,
  parseStrictPgDump,
  pgDumpArgs,
  postgresEnvironment,
  readOnlyPrivilegeSql,
  readAlertMarker,
  readSnapshotBytes,
  readSnapshotFile,
  renderSafeCopySections,
  runOpaqueTool,
  selectAuthenticatedCandidates,
  sha256,
  snapshotName,
  strictConnectionInfo,
  verifyReadOnlyPrivilegeOutput,
  verifySnapshotFile,
  alertMarkerName,
  buildAlertMarker,
};
