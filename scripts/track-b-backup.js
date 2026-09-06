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
const { sendAlert } = require('./monitoring-alert-relay');

const PRODUCTION_REF = 'uzltbbrjidmjwwfakwve';
const DB_URL = String(process.env.TRACK_B_BACKUP_DATABASE_URL || '');
const DRIVE_FOLDER_ID = String(process.env.TRACK_B_BACKUP_DRIVE_FOLDER_ID || '');
const DRIVE_CREDENTIALS_INPUT = String(
  process.env.TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON
  || process.env.TRACK_B_BACKUP_GOOGLE_SERVICE_ACCOUNT_JSON
  || '',
);
const SLACK_WEBHOOK = String(process.env.SLACK_ALERT_WEBHOOK || '');
const GITHUB_RUN_ID = String(process.env.GITHUB_RUN_ID || 'local');
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

// v3 remains the scheduled default. Each expanded version is explicit opt-in;
// a data package alone never certifies schema reconstruction or recoverability.
const HISTORY_TABLES = Object.freeze([...TABLES,
  { name: 'calendar_posts', pk: ['client', 'id'] },
  { name: 'sample_reviews', pk: ['client', 'id'] },
  { name: 'calendar_post_events', pk: 'id', identity: true },
  { name: 'sample_review_events', pk: 'id', identity: true },
  { name: 'workload_plan', pk: 'issue_id' },
  { name: 'card_change_journal', pk: 'id', identity: true },
  { name: 'production_intake_manifests', pk: 'request_id' },
]);
// Preserve v4's authenticated meaning. v5 closes its known FK boundary and
// retains comment/intake replay evidence plus the corresponding F27 generation.
const CLOSED_HISTORY_TABLES = Object.freeze([...HISTORY_TABLES.flatMap(table =>
  // F27 drill outbox rows hold a non-deferrable FK to this parent. COPY must
  // materialize it first; preserve the original v3/v4 order independently.
  table.name === 'mirror_outbox' ? [{ name: 'track_b_team_rollbacks', pk: 'id' }, table] : [table]),
  { name: 'pto_members', pk: 'member_id' },
  { name: 'pto_requests', pk: 'id' },
  { name: 'pto_adjustments', pk: 'id' },
  { name: 'linear_project_ids_shape_migration_20260728', pk: 'slug' },
  { name: 'production_asset_access_checks', pk: ['deliverable_id', 'slot', 'url_sha256'] },
  { name: 'linear_archive_asset_refs', pk: 'ref_id' },
  { name: 'production_comment_card_links', pk: ['source_surface', 'card_id', 'component', 'native_comment_id'] },
  { name: 'production_comment_mutation_receipts', pk: 'dedup_key' },
  { name: 'track_b_team_rollback_intents', pk: ['rollback_id', 'outbox_id'] },
  { name: 'track_b_f27_team_fences', pk: 'team' },
  { name: 'linear_intake_receipts', pk: 'receipt_key' },
]);
// v6 additionally owns the two FK-free recovery ledgers. Their lack of FKs
// makes explicit coverage mandatory; v5 remains exactly its authenticated33.
const INTEGRATED_HISTORY_TABLES = Object.freeze([...CLOSED_HISTORY_TABLES,
  { name: 'production_card_provenance', pk: 'id', identity: true },
  { name: 'calendar_feedback_materializations', pk: 'attempt_key' },
]);
// v7 deliberately adds only the two retained materialization owners. Both use
// UUID primary keys and have neither identities nor foreign-key coverage to
// inherit, so v6 must refuse them rather than treating a present empty table
// as evidence it can safely capture or restore the older corpus.
const MATERIALIZATION_HISTORY_TABLES = Object.freeze([...INTEGRATED_HISTORY_TABLES,
  { name: 'production_card_materialization_receipts', pk: 'id' },
  { name: 'production_card_materialization_ingress', pk: 'id' },
]);
const CORPORA = Object.freeze({
  'legacy-v3': Object.freeze({ name: 'legacy-v3', version: 3, magic: PACKAGE_MAGIC, tables: TABLES }),
  'history-v4': Object.freeze({ name: 'history-v4', version: 4,
    magic: Buffer.from('SYNCVIEW_TRACK_B_SNAPSHOT_V4\n', 'utf8'), tables: HISTORY_TABLES }),
  'history-v5': Object.freeze({ name: 'history-v5', version: 5,
    magic: Buffer.from('SYNCVIEW_TRACK_B_SNAPSHOT_V5\n', 'utf8'), tables: CLOSED_HISTORY_TABLES }),
  'history-v6': Object.freeze({ name: 'history-v6', version: 6,
    magic: Buffer.from('SYNCVIEW_TRACK_B_SNAPSHOT_V6\n', 'utf8'), tables: INTEGRATED_HISTORY_TABLES }),
  'history-v7': Object.freeze({ name: 'history-v7', version: 7,
    magic: Buffer.from('SYNCVIEW_TRACK_B_SNAPSHOT_V7\n', 'utf8'), tables: MATERIALIZATION_HISTORY_TABLES }),
});

function resolveCorpus(name = 'legacy-v3') {
  if (!Object.prototype.hasOwnProperty.call(CORPORA, name)) throw new Error('Unsupported Track-B backup corpus');
  return CORPORA[name];
}

function configuredCorpus() {
  return resolveCorpus(clean(process.env.TRACK_B_BACKUP_CORPUS) || 'legacy-v3').name;
}

function manifestCorpus(manifest) {
  const name = manifest && manifest.schema_version === 3 ? 'legacy-v3'
    : manifest && manifest.schema_version === 4 ? 'history-v4'
      : manifest && manifest.schema_version === 5 ? 'history-v5'
        : manifest && manifest.schema_version === 6 ? 'history-v6'
          : manifest && manifest.schema_version === 7 ? 'history-v7' : '';
  const corpus = resolveCorpus(name);
  if ((corpus.version >= 4 || manifest.corpus != null) && manifest.corpus !== corpus.name) {
    throw new Error('Track-B snapshot corpus does not match its schema version');
  }
  return corpus;
}

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

function exactTableNames(value, corpusName = 'legacy-v3') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected = resolveCorpus(corpusName).tables.map(config => config.name).sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function assertExactTableManifest(manifest, corpusName = 'legacy-v3') {
  if (Number(manifest && manifest.table_count) !== resolveCorpus(corpusName).tables.length
    || !exactTableNames(manifest && manifest.tables, corpusName)) {
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

function corpusBoundarySql(corpusName) {
  const corpus = resolveCorpus(corpusName);
  const relations = corpus.tables.map(config => `'public.${config.name}'::regclass`).join(',');
  // No row values, client identifiers, constraint names or dynamic SQL reach
  // diagnostics. RESTRICT remains the ultimate restore race guard.
  return `do $corpus_boundary$ declare covered oid[] := array[${relations}]::oid[]; begin
${corpus.version < 6 ? "if to_regclass('public.production_card_provenance') is not null or to_regclass('public.calendar_feedback_materializations') is not null then raise exception 'Track-B package omits integrated recovery evidence'; end if;" : ''}
${corpus.version < 7 ? "if to_regclass('public.production_card_materialization_receipts') is not null or to_regclass('public.production_card_materialization_ingress') is not null then raise exception 'Track-B package omits materialization recovery evidence'; end if;" : ''}
if exists(select 1 from pg_catalog.pg_constraint where contype='f'
  and confrelid=any(covered) and not conrelid=any(covered)) then
  raise exception 'Track-B corpus has an omitted incoming foreign key';
end if;
if exists(select 1 from pg_catalog.pg_constraint where contype='f'
  and conrelid=any(covered) and not confrelid=any(covered)) then
  raise exception 'Track-B corpus has an omitted referenced relation';
end if;
end $corpus_boundary$;\n`;
}

function readOnlyPrivilegeSql(corpusName = 'legacy-v3') {
  const boundary = resolveCorpus(corpusName).version >= 5 ? corpusBoundarySql(corpusName) : '';
  return boundary + resolveCorpus(corpusName).tables.map(config => {
    const relation = `public.${config.name}`;
    return `select '${config.name}', has_table_privilege(current_user, '${relation}', 'SELECT'), `
      + `has_table_privilege(current_user, '${relation}', 'INSERT'), `
      + `has_table_privilege(current_user, '${relation}', 'UPDATE'), `
      + `has_table_privilege(current_user, '${relation}', 'DELETE'), `
      + `has_table_privilege(current_user, '${relation}', 'TRUNCATE'), `
      + `(select rolbypassrls from pg_roles where rolname=current_user)`;
  }).join(' union all ');
}

function verifyReadOnlyPrivilegeOutput(text, corpusName = 'legacy-v3') {
  const observed = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!clean(line)) continue;
    const [name, select, insert, update, remove, truncate, allRows] = line.split('|').map(clean);
    if (observed.has(name)) throw new Error('Duplicate backup privilege result');
    observed.set(name, { select, insert, update, remove, truncate, allRows });
  }
  if (observed.size !== resolveCorpus(corpusName).tables.length) throw new Error('Incomplete backup privilege result');
  for (const config of resolveCorpus(corpusName).tables) {
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

function readOnlyPrivilegeArgs(corpusName = 'legacy-v3') {
  // DO emits a command tag even with --tuples-only. Keep the fixed privilege
  // result protocol free of that tag without suppressing errors/exit status.
  return ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--field-separator=|',
    '--set=ON_ERROR_STOP=1', '--command', readOnlyPrivilegeSql(corpusName),
  ];
}

function assertReadOnlySource(corpusName = 'legacy-v3') {
  assertProductionSource();
  const output = runPostgresTool('psql', readOnlyPrivilegeArgs(corpusName), true, 'Backup privilege preflight');
  return verifyReadOnlyPrivilegeOutput(output, corpusName);
}

function pgDumpArgs(output, corpusName = 'legacy-v3') {
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
  for (const config of resolveCorpus(corpusName).tables) args.push(`--table=public.${config.name}`);
  return args;
}

function parseDumpIdentifier(value) {
  const token = clean(value);
  const quoted = token.match(/^"([a-z_][a-z0-9_]*)"$/);
  const name = quoted ? quoted[1] : token;
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Unsafe PostgreSQL dump identifier');
  return name;
}

function allowedDumpControlLine(line, corpusName = 'legacy-v3') {
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
    const allowedSequences = new Set(resolveCorpus(corpusName).tables.filter(config => config.identity).map(config => `${config.name}_${config.pk}_seq`));
    return allowedSequences.has(sequence[1]);
  }
  return false;
}

function parseStrictPgDump(value, corpusName = 'legacy-v3') {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) {
    throw new Error('Track-B PostgreSQL dump is not valid UTF-8');
  }
  if (text.includes('\0')) throw new Error('Track-B PostgreSQL dump contains a NUL byte');
  if (/\r(?!\n)/.test(text)) throw new Error('Track-B PostgreSQL dump contains an invalid carriage return');
  const corpus = resolveCorpus(corpusName);
  const allowlist = new Set(corpus.tables.map(config => config.name));
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
    if (!allowedDumpControlLine(line, corpusName)) {
      throw new Error('Disallowed PostgreSQL dump statement');
    }
  }
  if (!sawHeader) throw new Error('Track-B package does not contain a PostgreSQL dump');
  if (active) throw new Error(`Unterminated COPY section for public.${active.name}`);
  for (const config of corpus.tables) {
    if (!tables[config.name]) throw new Error(`Track-B dump is missing public.${config.name}`);
    const keys = Array.isArray(config.pk) ? config.pk : [config.pk];
    if (!keys.every(key => tables[config.name].columns.includes(key))) {
      throw new Error(`Track-B dump is missing primary-key columns for public.${config.name}`);
    }
  }
  return { tables };
}

function inspectPlainDump(value, corpusName = 'legacy-v3') {
  const parsed = parseStrictPgDump(value, corpusName);
  return Object.fromEntries(resolveCorpus(corpusName).tables.map(config => [config.name, {
    rows: parsed.tables[config.name].rows.length,
    primary_key: config.pk,
  }]));
}

function quotedIdentifier(value) {
  const name = parseDumpIdentifier(value);
  return `"${name}"`;
}

function renderSafeCopySections(value, corpusName = 'legacy-v3') {
  const parsed = parseStrictPgDump(value, corpusName);
  const lines = [];
  for (const config of resolveCorpus(corpusName).tables) {
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

function buildManifest(dumpBytes, generatedAt = new Date().toISOString(), sourceUrl = DB_URL, corpusName = 'legacy-v3') {
  const corpus = resolveCorpus(corpusName);
  const tables = inspectPlainDump(dumpBytes, corpusName);
  return {
    format: 'syncview-track-b-postgresql-snapshot',
    schema_version: corpus.version,
    ...(corpus.version >= 4 ? { corpus: corpus.name } : {}),
    table_count: corpus.tables.length,
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

function packSnapshot(dumpFile, output, generatedAt = new Date().toISOString(), sourceUrl = DB_URL, hmacInput = HMAC_KEY_INPUT, corpusName = 'legacy-v3') {
  const key = parseHmacKey(hmacInput);
  const dumpBytes = fs.readFileSync(path.resolve(dumpFile));
  const manifest = buildManifest(dumpBytes, generatedAt, sourceUrl, corpusName);
  const compressed = zlib.gzipSync(dumpBytes, { level: 9 });
  manifest.snapshot.compressed_bytes = compressed.length;
  manifest.snapshot.compressed_sha256 = sha256(compressed);
  const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(manifestBytes.length));
  const unsignedPackage = Buffer.concat([resolveCorpus(corpusName).magic, length, manifestBytes, compressed]);
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
  const corpus = Object.values(CORPORA).find(item => packageBytes.subarray(0, item.magic.length).equals(item.magic));
  if (!corpus || packageBytes.length < corpus.magic.length + 8 + 2 + HMAC_BYTES) {
    throw new Error('Unsupported Track-B snapshot package');
  }
  const unsignedPackage = packageBytes.subarray(0, packageBytes.length - HMAC_BYTES);
  const actualTag = packageBytes.subarray(packageBytes.length - HMAC_BYTES);
  const expectedTag = hmacSha256(key, unsignedPackage);
  if (!crypto.timingSafeEqual(actualTag, expectedTag)) {
    throw new Error('Track-B snapshot authentication failed');
  }
  const manifestLength = Number(packageBytes.readBigUInt64BE(corpus.magic.length));
  const manifestStart = corpus.magic.length + 8;
  const payloadStart = manifestStart + manifestLength;
  const payloadEnd = packageBytes.length - HMAC_BYTES;
  if (!Number.isSafeInteger(manifestLength) || manifestLength < 2 || manifestLength > 1024 * 1024 || payloadStart >= payloadEnd) {
    throw new Error('Invalid Track-B snapshot manifest length');
  }
  let manifest;
  try { manifest = JSON.parse(packageBytes.subarray(manifestStart, payloadStart).toString('utf8')); } catch (_) {
    throw new Error('Invalid Track-B snapshot manifest JSON');
  }
  if (manifest.format !== 'syncview-track-b-postgresql-snapshot' || manifestCorpus(manifest).name !== corpus.name) {
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
  const parsed = parseStrictPgDump(dumpBytes, corpus.name);
  const inspected = inspectPlainDump(dumpBytes, corpus.name);
  assertExactTableManifest(manifest, corpus.name);
  for (const config of corpus.tables) {
    const expected = manifest.tables && manifest.tables[config.name];
    const actual = inspected[config.name];
    if (!expected || Number(expected.rows) !== actual.rows || canonicalJson(expected.primary_key) !== canonicalJson(config.pk)) {
      throw new Error(`Track-B snapshot manifest mismatch for ${config.name}`);
    }
  }
  authenticatedGeneratedAt(manifest, nowMs);
  return { manifest, dumpBytes, parsed, corpus: corpus.name };
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

async function listDriveFiles(token, query, fetchImpl = fetch, folderId = DRIVE_FOLDER_ID, driveId = '') {
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
      corpora: driveId ? 'drive' : 'user',
    });
    if (driveId) params.set('driveId', driveId);
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

async function listBackups(token, fetchImpl = fetch, folderId = DRIVE_FOLDER_ID, driveId = '') {
  const files = await listDriveFiles(token, `name contains '${FILE_PREFIX}'`, fetchImpl, folderId, driveId);
  return files.filter(file => isSnapshotName(file && file.name));
}

function googleDriveErrorReason(payload) {
  const error = payload && payload.error;
  const nested = error && Array.isArray(error.errors)
    ? error.errors.find(item => clean(item && item.reason))
    : null;
  const candidate = clean(nested && nested.reason || error && error.status);
  return /^[A-Za-z0-9_.-]{1,80}$/.test(candidate) ? candidate : 'unspecified';
}

async function googleDriveHttpError(stage, response) {
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  return new Error(`${stage} HTTP ${response.status} (${googleDriveErrorReason(payload)})`);
}

async function uploadDriveBytes(token, bytes, name, folderId = DRIVE_FOLDER_ID) {
  const metadata = Buffer.from(JSON.stringify({ name, parents: [folderId] }));
  const boundary = `trackb_${crypto.randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`), metadata,
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,parents,driveId,createdTime,size,md5Checksum', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  if (!response.ok) throw await googleDriveHttpError('Google Drive upload', response);
  return response.json();
}

async function uploadBackup(token, filePath, name, folderId = DRIVE_FOLDER_ID) {
  return uploadDriveBytes(token, fs.readFileSync(filePath), name, folderId);
}

async function driveFileMetadata(token, fileId, fetchImpl = fetch) {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,parents,driveId,createdTime,modifiedTime,size,md5Checksum,capabilities(canAddChildren,canListChildren)',
    supportsAllDrives: 'true',
  });
  const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Google Drive metadata HTTP ${response.status}`);
  return response.json();
}

function assertDriveFolderContext(metadata, folderId = DRIVE_FOLDER_ID, requireSharedDrive = false) {
  if (!metadata || clean(metadata.id) !== clean(folderId)
    || clean(metadata.mimeType) !== 'application/vnd.google-apps.folder') {
    throw new Error('Configured Google Drive destination is not the expected folder');
  }
  if (!metadata.capabilities || metadata.capabilities.canAddChildren !== true
    || metadata.capabilities.canListChildren !== true) {
    throw new Error('Backup principal cannot add and list children in the configured Drive folder');
  }
  const driveId = clean(metadata.driveId);
  if (requireSharedDrive && !driveId) {
    throw new Error('Service-account backup destination must be inside a Google Workspace Shared Drive');
  }
  return { folderId: clean(folderId), driveId, sharedDrive: Boolean(driveId) };
}

async function resolveDriveContext(token, account, fetchImpl = fetch, folderId = DRIVE_FOLDER_ID) {
  const metadata = await driveFileMetadata(token, folderId, fetchImpl);
  const serviceAccount = Boolean(clean(account && account.client_email) && !clean(account && account.refresh_token));
  return assertDriveFolderContext(metadata, folderId, serviceAccount);
}

async function downloadBackupBytes(token, fileId) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Google Drive download HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function assertDriveReadback(metadata, remoteBytes, localBytes, expectedName, expectedFolderId, expectedFileId = '', expectedDriveId = '') {
  const expectedMd5 = md5(localBytes);
  const sameLength = remoteBytes.length === localBytes.length;
  if ((expectedFileId && clean(metadata && metadata.id) !== clean(expectedFileId))
    || clean(metadata && metadata.name) !== expectedName
    || !Array.isArray(metadata && metadata.parents)
    || !metadata.parents.map(clean).includes(expectedFolderId)
    || (expectedDriveId && clean(metadata && metadata.driveId) !== clean(expectedDriveId))
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

async function verifyUploadedBackup(token, fileId, expectedName, filePath, driveContext, hmacInput = HMAC_KEY_INPUT) {
  const localBytes = fs.readFileSync(path.resolve(filePath));
  const localSnapshot = readSnapshotBytes(localBytes, hmacInput);
  const metadata = await driveFileMetadata(token, fileId);
  const remoteBytes = await downloadBackupBytes(token, fileId);
  assertDriveReadback(metadata, remoteBytes, localBytes, expectedName, driveContext.folderId, fileId, driveContext.driveId);
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

async function hasFreshnessMarker(token, staleKey, driveContext) {
  const name = alertMarkerName(staleKey);
  const escaped = name.replace(/'/g, "\\'");
  const files = await listDriveFiles(token, `name = '${escaped}'`, fetch, driveContext.folderId, driveContext.driveId);
  for (const file of files) {
    try {
      const bytes = await downloadBackupBytes(token, file.id);
      readAlertMarker(bytes, staleKey);
      return true;
    } catch (_) {}
  }
  return false;
}

async function writeFreshnessMarker(token, staleKey, ageHours, driveContext) {
  const name = alertMarkerName(staleKey);
  const bytes = buildAlertMarker(staleKey, ageHours);
  const uploaded = await uploadDriveBytes(token, bytes, name, driveContext.folderId);
  const metadata = await driveFileMetadata(token, uploaded.id);
  const remoteBytes = await downloadBackupBytes(token, uploaded.id);
  assertDriveReadback(metadata, remoteBytes, bytes, name, driveContext.folderId, uploaded.id, driveContext.driveId);
  readAlertMarker(remoteBytes, staleKey);
}

function selectAuthenticatedCandidates(candidates, hmacInput = HMAC_KEY_INPUT, nowMs = Date.now(), requiredCorpus = 'legacy-v3') {
  const minimumVersion = resolveCorpus(requiredCorpus).version;
  parseHmacKey(hmacInput);
  const valid = [];
  let invalidCount = 0;
  for (const candidate of candidates || []) {
    try {
      if (!candidate || candidate.error || !candidate.file || !Buffer.isBuffer(candidate.bytes)) throw new Error('candidate unavailable');
      const snapshot = readSnapshotBytes(candidate.bytes, hmacInput, nowMs);
      if (snapshot.manifest.schema_version < minimumVersion) throw new Error('Snapshot lacks required history coverage');
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

async function selectLatestAuthenticatedFromDrive(token, files, {
  retainBytes = false,
  hmacInput = HMAC_KEY_INPUT,
  nowMs = Date.now(),
  download = downloadBackupBytes,
  requiredCorpus = 'legacy-v3',
} = {}) {
  parseHmacKey(hmacInput);
  // One candidate at a time: the Drive folder accumulates snapshots without
  // pruning, and authenticating a package materializes its full parsed dump,
  // so holding every candidate at once grows the heap with folder history
  // until the freshness/restore lanes OOM. Only the winner's package bytes
  // (never its parsed dump) may be retained, and only when asked.
  let latest = null;
  let validCount = 0;
  let invalidCount = 0;
  let newestCandidateValid = true;
  let first = true;
  for (const file of files || []) {
    let candidate;
    try {
      candidate = { file, bytes: await download(token, file.id) };
    } catch (_) {
      candidate = { file, error: true };
    }
    const single = selectAuthenticatedCandidates([candidate], hmacInput, nowMs, requiredCorpus);
    if (single.latest) {
      validCount += 1;
      if (!latest || single.latest.generatedMs > latest.generatedMs) {
        latest = {
          file,
          generatedMs: single.latest.generatedMs,
          manifest: single.latest.snapshot.manifest,
          bytes: retainBytes ? candidate.bytes : null,
        };
      }
    } else {
      invalidCount += 1;
      if (first) newestCandidateValid = false;
    }
    first = false;
  }
  return { latest, validCount, invalidCount, newestCandidateValid };
}

async function createAndUpload() {
  const corpusName = configuredCorpus();
  assertProductionSource();
  assertReadOnlySource(corpusName);
  const generatedAt = new Date().toISOString();
  const name = snapshotName(generatedAt);
  const output = path.resolve(outputArg() || path.join(process.env.RUNNER_TEMP || process.cwd(), name));
  const tempDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'track-b-dump-'));
  const dumpFile = path.join(tempDir, 'track-b.sql');
  try {
    runPostgresTool('pg_dump', pgDumpArgs(dumpFile, corpusName), false, 'Transactional Track-B snapshot');
    const manifest = packSnapshot(dumpFile, output, generatedAt, DB_URL, HMAC_KEY_INPUT, corpusName);
    verifySnapshotFile(output);
    const account = parseDriveCredentials();
    const token = await driveAccessToken(account);
    const driveContext = await resolveDriveContext(token, account);
    const uploaded = await uploadBackup(token, output, name, driveContext.folderId);
    const readback = await verifyUploadedBackup(token, uploaded.id, name, output, driveContext);
    writeUploadReceipt(uploaded.id, name);
    console.log(JSON.stringify({
      ok: true,
      file_id: uploaded.id,
      corpus: corpusName,
      file_name: name,
      receipt_written: true,
      last_known_good_advanced: true,
      snapshot_sha256: manifest.snapshot.sha256,
      compressed_sha256: readback.compressed_sha256,
      package_sha256: readback.package_sha256,
      tables: manifest.tables,
      bytes: readback.bytes,
      drive_md5: readback.metadata.md5Checksum,
      hmac_verified: true,
      readback_verified: true,
      parent_verified: true,
      shared_drive: driveContext.sharedDrive,
    }));
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}

/*
 * Same two defects as the reconciler pager, same fix: the relay answers 2xx
 * with a JSON envelope rather than the literal "ok" a Slack incoming webhook
 * returns, and it renders named fields instead of echoing `text`. A `{ text }`
 * page arrived as `type=edge_alert issue=unknown team=unknown`. See
 * scripts/monitoring-alert-relay.js.
 */
async function postSlack(spec, webhook = SLACK_WEBHOOK, fetchImpl = fetch) {
  if (!clean(webhook)) return false;
  const receipt = await sendAlert({
    type: 'backup_freshness',
    team: 'account',
    ...(typeof spec === 'string' ? { summary: spec, text: spec } : spec),
    runId: `${GITHUB_RUN_ID}:backup_freshness`,
  }, { webhook, fetchImpl });
  return receipt.accepted === true;
}

function classifyFreshness({ fileCount, newestCandidateValid, latestGeneratedMs, nowMs, thresholdHours }) {
  const ageHours = Number.isFinite(latestGeneratedMs) ? (nowMs - latestGeneratedMs) / 3600000 : Infinity;
  let reason = '';
  if (!fileCount) reason = 'missing';
  else if (!newestCandidateValid) reason = 'verification_failed';
  else if (!Number.isFinite(latestGeneratedMs)) reason = 'missing';
  else if (ageHours > thresholdHours) reason = 'stale';
  return { ok: !reason, reason, ageHours };
}

/*
 * 2026-08-28 (run #33167562618): the freshness gate red-failed SECONDS after
 * this same job's export had uploaded and readback-verified a fresh snapshot.
 * The gate discovers candidates through a Drive LIST query, and Drive's
 * search index had not caught up with the just-finished upload, so the newest
 * file the list returned was the previous run's — 13.1h old, because
 * GitHub's degraded cron had skipped the intervening scheduled runs. The lag
 * was masked for as long as the previous snapshot was always younger than
 * the threshold; the cron degradation unmasked it.
 *
 * The export therefore leaves a runner-local receipt naming the file it
 * uploaded, and freshness folds that file in as one extra candidate when the
 * listing does not contain it yet — id reads are not behind the list index.
 * The receipt is a DISCOVERY HINT, never evidence, and it must not weaken
 * any invariant the listing carries (Codex P2 on the first draft): the
 * file's CURRENT Drive metadata is re-fetched and must still show the
 * receipt's name in the configured folder on the configured drive — a file
 * that was moved or renamed since upload is no candidate, because
 * download-latest could no longer discover it either — and the candidate is
 * merged into the listing at its createdTime position rather than prepended,
 * so a genuinely newer malformed listed file keeps the newest-candidate
 * canary seat. The bytes are then authenticated exactly like every listed
 * candidate: age still comes only from the HMAC-authenticated manifest
 * timestamp, so a forged or replayed receipt can at most point at a snapshot
 * whose authenticated age speaks for itself. A receipt whose file cannot be
 * fetched or no longer matches contributes nothing — the gate then judges
 * the listing alone, red when that is stale. Without a receipt (a freshness
 * step after a failed export — it runs `if: always()`) behavior is exactly
 * as before.
 */
const RECEIPT_FORMAT = 'syncview-track-b-upload-receipt';
const RECEIPT_FILE_ID = /^[A-Za-z0-9_-]{10,128}$/;

function uploadReceiptPath() {
  const fromEnv = clean(process.env.TRACK_B_BACKUP_RECEIPT_PATH);
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'syncview-track-b-upload-receipt.json');
}

function writeUploadReceipt(fileId, fileName, target = uploadReceiptPath()) {
  const payload = { format: RECEIPT_FORMAT, schema_version: 1, file_id: clean(fileId), file_name: clean(fileName) };
  if (!RECEIPT_FILE_ID.test(payload.file_id) || !isSnapshotName(payload.file_name)) {
    throw new Error('Upload receipt fields are not safe to record');
  }
  fs.writeFileSync(target, JSON.stringify(payload), { mode: 0o600 });
  return target;
}

function readUploadReceipt(target = uploadReceiptPath()) {
  let payload = null;
  try { payload = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (_) { return null; }
  if (!payload || payload.format !== RECEIPT_FORMAT || payload.schema_version !== 1) return null;
  const fileId = clean(payload.file_id);
  const fileName = clean(payload.file_name);
  if (!RECEIPT_FILE_ID.test(fileId) || !isSnapshotName(fileName)) return null;
  return { fileId, fileName };
}

function receiptDriveFile(metadata, receipt, driveContext) {
  if (!metadata || !receipt) return null;
  const name = clean(metadata.name);
  const createdTime = clean(metadata.createdTime);
  const parents = Array.isArray(metadata.parents) ? metadata.parents.map(clean) : [];
  if (clean(metadata.id) !== receipt.fileId) return null;
  if (name !== receipt.fileName || !isSnapshotName(name)) return null;
  if (!parents.includes(clean(driveContext && driveContext.folderId))) return null;
  if (driveContext && driveContext.sharedDrive && clean(metadata.driveId) !== clean(driveContext.driveId)) return null;
  if (!Number.isFinite(Date.parse(createdTime))) return null;
  return { id: receipt.fileId, name, createdTime };
}

function mergeReceiptCandidate(files, receiptFile) {
  const listed = Array.isArray(files) ? files : [];
  if (!receiptFile) return listed;
  if (listed.some(file => clean(file && file.id) === clean(receiptFile.id))) return listed;
  // Insert at the createdTime-desc position the listing itself would have
  // used, so the newest-candidate canary always sits on the genuinely newest
  // known file, receipt or listed.
  const receiptMs = Date.parse(clean(receiptFile.createdTime));
  const merged = listed.slice();
  let at = 0;
  while (at < merged.length) {
    const rowMs = Date.parse(clean(merged[at] && merged[at].createdTime));
    if (!Number.isFinite(rowMs) || rowMs <= receiptMs) break;
    at += 1;
  }
  merged.splice(at, 0, receiptFile);
  return merged;
}

async function checkFreshness() {
  const account = parseDriveCredentials();
  const token = await driveAccessToken(account);
  const driveContext = await resolveDriveContext(token, account);
  const files = await listBackups(token, fetch, driveContext.folderId, driveContext.driveId);
  const receipt = readUploadReceipt();
  let receiptFile = null;
  if (receipt) {
    try {
      receiptFile = receiptDriveFile(await driveFileMetadata(token, receipt.fileId), receipt, driveContext);
    } catch (_) { receiptFile = null; }
  }
  const candidates = mergeReceiptCandidate(files, receiptFile);
  const nowMs = Date.now();
  const requiredCorpus = configuredCorpus();
  const selection = await selectLatestAuthenticatedFromDrive(token, candidates, { nowMs, requiredCorpus });
  const latest = selection.latest;
  const freshness = classifyFreshness({
    fileCount: candidates.length,
    newestCandidateValid: selection.newestCandidateValid,
    latestGeneratedMs: latest ? latest.generatedMs : NaN,
    nowMs,
    thresholdHours: FRESHNESS_HOURS,
  });
  if (freshness.ok) {
    console.log(JSON.stringify({
      ok: true,
      stale: false,
      required_corpus: requiredCorpus,
      snapshot_corpus: manifestCorpus(latest.manifest).name,
      latest_file_id: latest.file.id,
      authenticated_generated_at: latest.manifest.generated_at,
      age_hours: Number(freshness.ageHours.toFixed(2)),
      threshold_hours: FRESHNESS_HOURS,
      invalid_candidates: selection.invalidCount,
      receipt_candidate_added: candidates.length !== files.length,
      alert_transport: 'github_workflow_failure_email',
      shared_drive: driveContext.sharedDrive,
    }));
    return;
  }
  const staleKey = latest
    ? `snapshot:${latest.manifest.snapshot.sha256.slice(0, 24)}`
    : `no-valid-snapshot:${new Date(nowMs).toISOString().slice(0, 10)}`;
  let alreadyPaged = false;
  let slackAlerted = false;
  if (SLACK_WEBHOOK) {
    alreadyPaged = await hasFreshnessMarker(token, staleKey, driveContext);
    if (!alreadyPaged) {
      const ageText = Number.isFinite(freshness.ageHours) ? `${freshness.ageHours.toFixed(1)}h` : 'missing';
      slackAlerted = await postSlack({
        summary: `private_backup_stale reason=${freshness.reason} age=${ageText} threshold=${FRESHNESS_HOURS}h handle=${staleKey}`,
        text: `SyncView Track-B private backup failed freshness. reason=${freshness.reason}; age=${ageText}; threshold=${FRESHNESS_HOURS}h; backup_handle=${staleKey}`,
      });
      await writeFreshnessMarker(token, staleKey, freshness.ageHours, driveContext);
    }
  }
  const ageText = Number.isFinite(freshness.ageHours) ? `${freshness.ageHours.toFixed(1)}h` : 'missing';
  console.error(`Track-B backup freshness FAILED: reason=${freshness.reason}; age=${ageText}; threshold=${FRESHNESS_HOURS}h. GitHub Actions must mark this run failed so the repository owner's Actions email notification can fire.`);
  console.log(JSON.stringify({
    ok: false,
    stale: true,
    required_corpus: requiredCorpus,
    failure_reason: freshness.reason,
    alerted: slackAlerted,
    slack_configured: Boolean(SLACK_WEBHOOK),
    slack_already_paged: alreadyPaged,
    alert_transport: 'github_workflow_failure_email',
    stale_key: staleKey,
    authenticated_generated_at: latest ? latest.manifest.generated_at : null,
    age_hours: Number.isFinite(freshness.ageHours) ? Number(freshness.ageHours.toFixed(2)) : null,
    threshold_hours: FRESHNESS_HOURS,
    invalid_candidates: selection.invalidCount,
    receipt_candidate_added: candidates.length !== files.length,
  }));
  process.exitCode = 1;
}

async function downloadLatest() {
  const output = outputArg();
  if (!output) throw new Error('download-latest requires --output=PATH');
  const account = parseDriveCredentials();
  const token = await driveAccessToken(account);
  const driveContext = await resolveDriveContext(token, account);
  const files = await listBackups(token, fetch, driveContext.folderId, driveContext.driveId);
  if (!files.length) throw new Error('No Track-B backup exists in the configured Drive folder');
  const selection = await selectLatestAuthenticatedFromDrive(token, files, { retainBytes: true, requiredCorpus: configuredCorpus() });
  if (!selection.latest) throw new Error('No authenticated Track-B backup exists in the configured Drive folder');
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), selection.latest.bytes, { mode: 0o600 });
  const manifest = selection.latest.manifest;
  console.log(JSON.stringify({
    ok: true,
    file_id: selection.latest.file.id,
    file_name: selection.latest.file.name,
    bytes: selection.latest.bytes.length,
    generated_at: manifest.generated_at,
    snapshot_sha256: manifest.snapshot.sha256,
    invalid_candidates: selection.invalidCount,
    shared_drive: driveContext.sharedDrive,
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
    console.error(`Track-B backup workflow FAILED: ${error && error.message || String(error)}`);
    process.exit(1);
  });
}

module.exports = {
  CORPORA,
  HISTORY_TABLES,
  CLOSED_HISTORY_TABLES,
  INTEGRATED_HISTORY_TABLES,
  MATERIALIZATION_HISTORY_TABLES,
  corpusBoundarySql,
  readOnlyPrivilegeArgs,
  configuredCorpus,
  manifestCorpus,
  resolveCorpus,
  FILE_PREFIX,
  HMAC_BYTES,
  MAX_FUTURE_SKEW_MS,
  PACKAGE_MAGIC,
  PRODUCTION_REF,
  SCHEMA_VERSION,
  TABLES,
  assertDriveFolderContext,
  assertDriveReadback,
  assertExactTableManifest,
  assertProductionSource,
  authenticatedGeneratedAt,
  buildManifest,
  canonicalJson,
  classifyFreshness,
  connectionProjectRef,
  googleDriveErrorReason,
  inspectPlainDump,
  isSnapshotName,
  listBackups,
  listDriveFiles,
  md5,
  mergeReceiptCandidate,
  packSnapshot,
  parseHmacKey,
  parseDriveCredentials,
  parseStrictPgDump,
  pgDumpArgs,
  postgresEnvironment,
  postSlack,
  readOnlyPrivilegeSql,
  readAlertMarker,
  readSnapshotBytes,
  readSnapshotFile,
  readUploadReceipt,
  receiptDriveFile,
  renderSafeCopySections,
  runOpaqueTool,
  selectAuthenticatedCandidates,
  selectLatestAuthenticatedFromDrive,
  sha256,
  snapshotName,
  strictConnectionInfo,
  uploadReceiptPath,
  verifyReadOnlyPrivilegeOutput,
  verifySnapshotFile,
  writeUploadReceipt,
  alertMarkerName,
  buildAlertMarker,
};
