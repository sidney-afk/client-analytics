'use strict';

/*
 * Track-B recovery package: authenticated SCHEMA + DATA capture from one
 * exported PostgreSQL snapshot, and reconstruction into a genuinely EMPTY
 * scratch database. DRAFT / DORMANT: nothing schedules, uploads or alerts.
 *
 * Recoverable boundary (see docs/ops/TRACK_B_BACKUP.md):
 *   schema  = every object in schema `public` (tables, columns, defaults,
 *             identities, sequences, constraints, indexes, functions in
 *             plpgsql/sql, triggers, policies, RLS flags, replica identity,
 *             views, enum/domain/composite types, comments, table/column/
 *             sequence/function ACLs for the platform roles);
 *   data    = the selected Track-B corpus tables only, each bound by an exact
 *             ordered content digest; every other public table is
 *             reconstructed empty and listed as omitted;
 *   sequences = exact (last_value, is_called) of every public sequence as
 *             validated decimal strings, never through a JavaScript Number;
 *   pinned  = roles, extensions (name/schema/version), non-public schemas and
 *             the realtime publication are PREREQUISITES verified on the
 *             target, never recreated by the package;
 *   callable = every function an expression can execute while rows load
 *             (CHECK, default, generated column, index expression/predicate,
 *             view, materialized view) is resolved at capture against the
 *             source catalog and must be pg_catalog (not denylisted), a
 *             stable/immutable function of a pinned extension, or a PURE public
 *             function (immutable, invoker, sql/plpgsql, no writing statement,
 *             transitively resolvable). Ordinary VIEW expressions alone may
 *             use a separately classified STABLE invoker read-only closure;
 *             materialized views and load expressions retain immutable-only
 *             public functions. Anything else refuses the capture; the
 *             reader and the target re-verify the same contract;
 *   coherence = pre-data, data and post-data dumps import ONE exported
 *             repeatable-read snapshot; a catalog fingerprint taken inside
 *             that snapshot must equal a fresh fingerprint taken after the
 *             dumps, otherwise the package is refused (DDL race fail-closed).
 *             Sequence state is read inside the capture window but sequences
 *             are not MVCC objects: a value can be later than the row
 *             snapshot, never earlier than any value the rows use.
 *
 * Reconstruction executes only allowlisted DDL classes re-emitted from the
 * authenticated sections, inside one transaction, in the order
 * pre-data -> COPY -> sequence values -> post-data -> in-transaction
 * verification (fingerprint, per-table digests, sequences, ownership). A
 * detectable mismatch therefore rolls the whole transaction back and leaves
 * the target empty. Triggers, foreign keys and policies do not exist while
 * rows load; CHECK/default/index expressions DO execute, which is exactly why
 * the callable contract above exists. Owner names are never restored.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const backup = require('./track-b-backup');

const RECOVERY_MAGIC = Buffer.from('SYNCVIEW_TRACK_B_RECOVERY_V1\n', 'utf8');
const RECOVERY_FORMAT = 'syncview-track-b-recovery-package';
// Version 2: exact sequence state (decimal strings + is_called), per-table
// content digests, callable-dependency contract and in-transaction
// verification. Version 1 packages (local proofs only) carried a lossy
// sequence projection and are refused rather than reinterpreted.
const RECOVERY_VERSION = 2;
const LEGACY_RECOVERY_VERSIONS = Object.freeze({ 1: 'lossy sequence projection; recapture with version 2' });
const RECOVERY_FILE_PREFIX = 'syncview-track-b-recovery-';
const HMAC_BYTES = backup.HMAC_BYTES;
const PLATFORM_ROLES = Object.freeze(['anon', 'authenticated', 'service_role']);
const REQUIRED_EXTENSION_ALLOWLIST = Object.freeze(['pgcrypto', 'uuid-ossp', 'pg_trgm', 'citext', 'btree_gist', 'btree_gin']);
const EGRESS_EXTENSIONS = Object.freeze(['pg_net', 'dblink', 'http', 'postgres_fdw', 'pg_cron']);
const EGRESS_SCHEMAS = Object.freeze(['net', 'dblink', 'cron']);
// Informational only: counted on trigger/RPC bodies, which reconstruction never
// invokes. It is NOT the execution boundary; the callable contract is.
const EGRESS_BODY_PATTERN = /\b(net\.http_|dblink|pg_net|http_(?:post|get|put|delete)|pg_read_(?:binary_)?file|pg_execute_server_program|lo_import|lo_export)\b|\bcopy\b[^;]*\bprogram\b/i;
// pg_catalog functions that must never appear in an expression the restore
// evaluates, and whose EXECUTE the restore role must not hold.
const DANGEROUS_CATALOG_FUNCTIONS = Object.freeze(['pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file', 'pg_ls_logdir', 'pg_ls_waldir',
  'lo_import', 'lo_export', 'lo_unlink', 'lo_from_bytea', 'lo_put', 'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_rotate_logfile',
  'pg_notify', 'set_config', 'pg_sleep', 'pg_sleep_for', 'pg_sleep_until', 'pg_advisory_lock', 'pg_advisory_xact_lock', 'pg_advisory_unlock',
  'pg_export_snapshot', 'pg_create_physical_replication_slot', 'pg_create_logical_replication_slot', 'pg_drop_replication_slot',
  'pg_logical_emit_message', 'pg_switch_wal', 'pg_backup_start', 'pg_backup_stop', 'pg_promote', 'pg_replication_origin_create',
  'setval', 'pg_file_write', 'pg_file_unlink', 'pg_file_rename', 'query_to_xml', 'database_to_xml', 'schema_to_xml']);
// Signatures the target role must NOT be able to execute (privilege recheck).
// MEASURED on PostgreSQL 16 against a plain LOGIN role: exactly these eight are
// withheld from PUBLIC by default, so holding EXECUTE on one is a real privilege
// signal. pg_sleep, set_config, pg_notify, pg_advisory_lock, pg_export_snapshot
// and pg_terminate_backend ARE PUBLIC-executable by default, so they prove
// nothing about this role; they stay in the expression denylist above, which is
// the check that matters for reconstruction, and pg_signal_backend membership is
// covered by DANGEROUS_ROLE_MEMBERSHIPS.
const DANGEROUS_CATALOG_SIGNATURES = Object.freeze(['pg_catalog.pg_read_file(text)', 'pg_catalog.pg_read_binary_file(text)', 'pg_catalog.pg_ls_dir(text)',
  'pg_catalog.pg_stat_file(text)', 'pg_catalog.lo_import(text)', 'pg_catalog.lo_export(oid,text)',
  'pg_catalog.pg_reload_conf()', 'pg_catalog.pg_rotate_logfile()']);
const DANGEROUS_ROLE_MEMBERSHIPS = Object.freeze(['pg_execute_server_program', 'pg_read_server_files', 'pg_write_server_files', 'pg_signal_backend',
  'pg_read_all_data', 'pg_write_all_data', 'pg_database_owner', 'pg_maintain', 'pg_create_subscription']);
// Volatile extension functions an expression may still call (no side effects).
const VOLATILE_EXTENSION_ALLOWLIST = Object.freeze(['gen_random_bytes', 'gen_random_uuid', 'uuid_generate_v1', 'uuid_generate_v1mc', 'uuid_generate_v4', 'gen_salt']);
// The narrow EXECUTE contract the target prerequisites grant in `extensions`.
const EXTENSION_FUNCTION_CONTRACT = Object.freeze(['digest(bytea,text)', 'gen_random_bytes(integer)', 'gen_random_uuid()']);
// A pure function body may not contain any of these statements.
const BODY_WRITE_KEYWORDS = /\b(insert|update|delete|truncate|execute|perform|call|copy|notify|listen|unlisten|create|alter|drop|grant|revoke|refresh|lock|commit|rollback|savepoint|prepare|deallocate|import|vacuum|analyze|analyse|reindex|cluster|checkpoint|discard|load|security)\b/i;
// Tokens that precede "(" in SQL without naming a function.
const SQL_CALL_KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'as', 'on', 'any', 'all', 'some', 'exists', 'array', 'row', 'values', 'select', 'from', 'where',
  'when', 'then', 'else', 'end', 'case', 'cast', 'over', 'filter', 'within', 'group', 'order', 'by', 'having', 'limit', 'offset', 'join', 'using', 'left',
  'right', 'inner', 'outer', 'full', 'cross', 'lateral', 'union', 'intersect', 'except', 'distinct', 'between', 'like', 'ilike', 'similar', 'to', 'with',
  'recursive', 'returning', 'into', 'default', 'check', 'constraint', 'references', 'primary', 'key', 'unique', 'foreign', 'exclude', 'generated', 'always',
  'stored', 'identity', 'collate', 'interval', 'timestamp', 'timestamptz', 'time', 'timetz', 'numeric', 'decimal', 'varchar', 'varying', 'char', 'character',
  'bit', 'float', 'double', 'precision', 'nchar', 'if', 'elsif', 'elseif', 'while', 'loop', 'for', 'foreach', 'return', 'raise', 'declare', 'begin',
  'exception', 'get', 'diagnostics', 'strict', 'nulls', 'first', 'last', 'asc', 'desc', 'extract', 'position', 'substring', 'trim', 'overlay', 'xmlelement',
  'xmlforest', 'xmlattributes', 'xmlparse', 'xmlserialize', 'xmlexists', 'xmlagg', 'coalesce', 'nullif', 'greatest', 'least', 'grouping', 'treat', 'only',
  'table', 'index', 'btree', 'hash', 'gin', 'gist', 'brin', 'spgist', 'setof', 'language', 'returns', 'function', 'procedure', 'trigger', 'each', 'statement',
  'each_row', 'ordinality', 'rows', 'range', 'groups', 'partition', 'window', 'lower', 'upper']);
// lower/upper are real pg_catalog functions too; keyword membership only means
// "do not fail if unresolved", resolution still classifies them when present.
const SKIPPED_SESSION_SETTINGS = Object.freeze(['statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout', 'transaction_timeout']);
const ALLOWED_SESSION_SETTINGS = Object.freeze([...SKIPPED_SESSION_SETTINGS, 'client_encoding', 'standard_conforming_strings',
  'check_function_bodies', 'xmloption', 'client_min_messages', 'row_security', 'default_tablespace',
  'default_table_access_method', 'default_toast_compression']);
const IDENT = '(?:"[^"]+"|[a-z_][a-z0-9_]*)';
const ARGS = '\\((?:[^()]|\\([^()]*\\))*\\)';
const SEQUENCE_RANGES = Object.freeze({ smallint: [-32768n, 32767n], integer: [-2147483648n, 2147483647n], bigint: [-9223372036854775808n, 9223372036854775807n] });

function clean(value) { return String(value == null ? '' : value).trim(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hmacSha256(key, value) { return crypto.createHmac('sha256', key).update(value).digest(); }
function u64(value) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(value)); return b; }
function unquote(name) { return clean(name).replace(/^"(.*)"$/, '$1'); }

function recoveryName(generatedAt) {
  const stamp = clean(generatedAt).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  if (!/^\d{8}T\d{6}Z$/.test(stamp)) throw new Error('Recovery generated_at cannot produce a safe filename');
  return `${RECOVERY_FILE_PREFIX}${stamp}.recovery`;
}

// ---------------------------------------------------------------------------
// Statement splitting: dollar quotes, strings, identifiers, comments, psql meta.
// ---------------------------------------------------------------------------
function splitSqlStatements(text) {
  const out = [];
  let i = 0; let start = 0; let line = 1; let startLine = 1; let atLineStart = true; let sawToken = false;
  const n = text.length;
  const push = (end, kind) => {
    const body = text.slice(start, end).trim();
    if (body) out.push({ text: body, kind, line: startLine });
  };
  while (i < n) {
    const ch = text[i];
    if (atLineStart && ch === '\\') {
      const eol = text.indexOf('\n', i);
      start = i; startLine = line;
      push(eol === -1 ? n : eol, 'meta');
      i = eol === -1 ? n : eol + 1; line += 1; start = i; startLine = line; atLineStart = true; sawToken = false;
      continue;
    }
    if (ch === '\n') { line += 1; atLineStart = true; i += 1; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i += 1; continue; }
    if (text.startsWith('--', i)) { const eol = text.indexOf('\n', i); i = eol === -1 ? n : eol; if (!sawToken) { start = i; startLine = line; } continue; }
    if (text.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (text.startsWith('/*', i)) { depth += 1; i += 2; } else if (text.startsWith('*/', i)) { depth -= 1; i += 2; } else { if (text[i] === '\n') line += 1; i += 1; }
      }
      if (depth > 0) throw new Error('Unterminated block comment in SQL section');
      if (!sawToken) { start = i; startLine = line; }
      continue;
    }
    atLineStart = false;
    if (!sawToken) { start = i; startLine = line; sawToken = true; }
    if (ch === "'") {
      const escaped = /[eE]$/.test(text.slice(Math.max(0, i - 1), i)) && !/[a-zA-Z0-9_]/.test(text[i - 2] || '');
      i += 1;
      while (i < n) {
        if (escaped && text[i] === '\\') { i += 2; continue; }
        if (text[i] === "'") { if (text[i + 1] === "'") { i += 2; continue; } i += 1; break; }
        if (text[i] === '\n') line += 1;
        i += 1;
      }
      continue;
    }
    if (ch === '"') { i += 1; while (i < n) { if (text[i] === '"') { if (text[i + 1] === '"') { i += 2; continue; } i += 1; break; } if (text[i] === '\n') line += 1; i += 1; } continue; }
    if (ch === '$') {
      const tag = text.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tag) {
        const close = text.indexOf(tag[0], i + tag[0].length);
        if (close === -1) throw new Error('Unterminated dollar-quoted body in SQL section');
        line += (text.slice(i, close).match(/\n/g) || []).length;
        i = close + tag[0].length; continue;
      }
    }
    if (ch === ';') { push(i, 'statement'); i += 1; start = i; startLine = line; sawToken = false; continue; }
    i += 1;
  }
  if (text.slice(start).trim()) throw new Error('SQL section ends inside an unterminated statement');
  return out;
}

function stripDollarQuoted(text) {
  const bodies = [];
  const stripped = sqlTokens(text).map(token => {
    if (token.kind !== 'dollar') return token.raw;
    bodies.push(token.raw); return '$BODY$';
  }).join('');
  return { stripped, bodies };
}

function normalizeRoleList(tail) {
  return clean(tail).split(',').map(item => unquote(item));
}

// ---------------------------------------------------------------------------
// Callable references: names that precede "(" in SQL text, minus strings,
// comments and known keywords. Used identically at capture and read time.
// ---------------------------------------------------------------------------
// One lexical pass: comment markers have no meaning inside strings/quoted
// identifiers, and dollar quotes inside a string/comment are not a function
// body. Keep executable identifiers distinct from literal text. This is a
// bounded lexer, not a SQL grammar or an independent execution-safety proof.
function sqlTokens(text) {
  const source = String(text || ''); const tokens = []; let i = 0;
  const add = (kind, start, value, extra = {}) => tokens.push({ kind, raw: source.slice(start, i), value, ...extra });
  while (i < source.length) {
    const start = i; const ch = source[i];
    if (/\s/.test(ch)) { while (i < source.length && /\s/.test(source[i])) i += 1; add('space', start); continue; }
    if (source.startsWith('--', i)) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; add('line_comment', start); continue; }
    if (source.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < source.length && depth) {
        if (source.startsWith('/*', i)) { depth += 1; i += 2; }
        else if (source.startsWith('*/', i)) { depth -= 1; i += 2; }
        else i += 1;
      }
      if (depth) throw new Error('Unterminated SQL block comment in callable contract');
      add('block_comment', start); continue;
    }
    const quotedPrefix = source.slice(i).match(/^(?:[eEbBxXnN](?=')|[uU]&(?=['"]))/);
    if (ch === "'" || ch === '"' || quotedPrefix) {
      const lead = quotedPrefix ? quotedPrefix[0] : ''; i += lead.length;
      const quote = source[i++]; const escaped = /^[eE]$/.test(lead); let value = ''; let closed = false; let slashes = 0;
      while (i < source.length) {
        const c = source[i];
        if (escaped && c === '\\') { if (i + 1 >= source.length) break; value += source.slice(i, i + 2); i += 2; continue; }
        if (c === quote) {
          // A non-E string with an odd backslash run before a quote depends on
          // standard_conforming_strings. Never guess that ambiguity away.
          if (quote === "'" && !escaped && slashes % 2) throw new Error('Ambiguous non-E SQL string escape in callable contract');
          if (source[i + 1] === quote) { value += quote; i += 2; slashes = 0; continue; }
          i += 1; closed = true; break;
        }
        value += c; slashes = c === '\\' ? slashes + 1 : 0; i += 1;
      }
      if (!closed) throw new Error('Unterminated SQL quoted token in callable contract');
      add(quote === '"' ? 'identifier' : 'string', start, value, { unicodeEscaped: /^[uU]&$/.test(lead) }); continue;
    }
    if (ch === '$') {
      const match = source.slice(i).match(/^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/);
      if (match) {
        const tag = match[0]; const end = source.indexOf(tag, i + tag.length);
        if (end < 0) throw new Error('Unterminated SQL dollar quote in callable contract');
        const value = source.slice(i + tag.length, end); i = end + tag.length; add('dollar', start, value); continue;
      }
    }
    const word = source.slice(i).match(/^[A-Za-z_\u0080-\uffff][A-Za-z0-9_$\u0080-\uffff]*/);
    if (word) { i += word[0].length; add('word', start, word[0].toLowerCase()); continue; }
    i += 1; add('symbol', start, ch);
  }
  return tokens;
}

function stripBlockComments(text, replacement = ' ') {
  return sqlTokens(text).map(token => token.kind === 'block_comment' ? replacement : token.raw).join('');
}

function stripSqlNoise(text) {
  return sqlTokens(text).map(token => ['space', 'word', 'symbol'].includes(token.kind) ? token.raw : ' ').join('');
}

function callNamesIn(text) {
  const names = new Set();
  const tokens = sqlTokens(text).filter(token => !['space', 'line_comment', 'block_comment'].includes(token.kind));
  const identifier = token => token && ['word', 'identifier'].includes(token.kind);
  for (let i = 0; i < tokens.length; i += 1) {
    if (!identifier(tokens[i]) || tokens[i - 1]?.value === '.') continue;
    const parts = [tokens[i]]; let end = i + 1;
    while (tokens[end]?.value === '.' && identifier(tokens[end + 1])) { parts.push(tokens[end + 1]); end += 2; }
    if (tokens[end]?.kind !== 'symbol' || tokens[end].value !== '(') continue;
    if (parts.length > 2 || parts.some(part => part.unicodeEscaped || !/^[a-z_][a-z0-9_]{0,62}$/.test(part.value))) {
      throw new Error('Unsupported callable identifier in Track-B recovery contract');
    }
    const name = parts.map(part => part.value).join('.');
    // Quoted identifiers remain callable even when their spelling is a SQL
    // keyword. lower/upper are actual functions, not grammar constructs.
    if (parts.length === 1 && parts[0].kind === 'word' && SQL_CALL_KEYWORDS.has(name) && !['lower', 'upper'].includes(name)) continue;
    names.add(name); i = end - 1;
  }
  return names;
}

// Texts an expression evaluates during reconstruction, drawn from the package
// statements themselves (read-time) so the contract does not trust the manifest.
function evaluatedExpressionTexts(statements) {
  const texts = [];
  for (const text of statements) {
    const head = text.replace(/\s+/g, ' ');
    if (/^CREATE (?:UNLOGGED )?TABLE public\./i.test(head)) {
      texts.push({ kind: 'table_definition', text: text.replace(/^CREATE (?:UNLOGGED )?TABLE public\.[^(]*\(/i, '(') });
    } else if (/^ALTER TABLE (?:ONLY )?public\.\S+ ALTER COLUMN \S+ SET DEFAULT /i.test(head)) {
      texts.push({ kind: 'default', text: head.replace(/^ALTER TABLE (?:ONLY )?public\.\S+ ALTER COLUMN \S+ SET DEFAULT /i, '') });
    } else if (/^ALTER TABLE (?:ONLY )?public\.\S+ ADD CONSTRAINT \S+ CHECK /i.test(head)) {
      texts.push({ kind: 'check', text: head.replace(/^ALTER TABLE (?:ONLY )?public\.\S+ ADD CONSTRAINT \S+ CHECK /i, '') });
    } else if (/^CREATE (?:UNIQUE )?INDEX /i.test(head)) {
      texts.push({ kind: 'index', text: head.replace(/^CREATE (?:UNIQUE )?INDEX \S+ ON public\.\S+ USING \S+ /i, '') });
    } else if (/^CREATE (?:OR REPLACE )?VIEW public\./i.test(head) || /^CREATE MATERIALIZED VIEW public\./i.test(head)) {
      texts.push({ kind: /^CREATE MATERIALIZED VIEW /i.test(head) ? 'materialized_view' : 'view', text: text.replace(/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+public\.\S+/i, '') });
    } else if (/^ALTER DOMAIN public\.\S+ ADD CONSTRAINT /i.test(head) || /^CREATE DOMAIN public\./i.test(head)) {
      texts.push({ kind: 'domain', text: head });
    }
  }
  return texts;
}

// Purity contract for a public function an expression may execute.
function functionPurity(statementText, { allowStableView = false } = {}) {
  const tokens = sqlTokens(statementText);
  const headTokens = tokens.map(token => token.kind === 'dollar' ? { kind: 'body_placeholder', raw: '$BODY$' } : token);
  const head = headTokens.map(token => ['line_comment', 'block_comment'].includes(token.kind) ? ' ' : token.raw).join('').replace(/\s+/g, ' ');
  const modifiers = headTokens.filter(token => token.kind === 'word').map(token => token.value).join(' ');
  const reasons = [];
  const name = (head.match(new RegExp(`^CREATE (?:OR REPLACE )?FUNCTION public\\.(${IDENT})\\(`, 'i')) || [])[1];
  if (!name) reasons.push('not_a_public_function');
  const language = (modifiers.match(/\blanguage\s+([a-z_]+)/) || [])[1];
  if (!language || !/^(sql|plpgsql)$/i.test(language)) reasons.push('language');
  const volatilityWords = modifiers.match(/\b(immutable|stable|volatile)\b/g) || [];
  const volatility = volatilityWords.length === 1 ? ({ immutable: 'i', stable: 's', volatile: 'v' })[volatilityWords[0]] : 'unknown';
  if (volatility !== 'i' && !(allowStableView && volatility === 's')) reasons.push('not_immutable');
  if (/\bsecurity definer\b/.test(modifiers)) reasons.push('security_definer');
  if (/\bAS\s+'/i.test(head)) reasons.push('quoted_body');
  const body = tokens.filter(token => token.kind === 'dollar').map(token => token.value).join('\n');
  if (BODY_WRITE_KEYWORDS.test(stripSqlNoise(body))) reasons.push('writing_statement');
  if (allowStableView && volatility === 's' && stableBodyUnsafe(body, language)) reasons.push('locking_or_sql_into');
  return { pure: reasons.length === 0, reasons, name: name ? unquote(name) : null, volatility, stable_body_safe: !stableBodyUnsafe(body, language), calls: [...callNamesIn(body)] };
}

function stableBodyUnsafe(body, language) {
  const text = stripSqlNoise(body);
  // SQL SELECT INTO creates a relation; PL/pgSQL SELECT INTO a local variable
  // is required by the admitted reader. Neither language may acquire row locks.
  return /\bfor\s+(?:(?:no\s+)?key\s+)?(?:share|update)\b/i.test(text) || (language === 'sql' && /\binto\b/i.test(text));
}

// Read-time contract: every callable name in evaluated expressions and in the
// bodies of pure public functions must be classified by the manifest, every
// public function so classified must exist in the package and be pure, and
// no other class may appear.
function verifyCallableContract(statements, manifest) {
  const references = manifest.callable_references || {};
  const pureFunctions = new Map();
  for (const text of statements) {
    if (/^CREATE (?:OR REPLACE )?FUNCTION public\./i.test(text)) {
      const purity = functionPurity(text, { allowStableView: true });
      if (purity.name) pureFunctions.set(purity.name, [...(pureFunctions.get(purity.name) || []), purity]);
    }
  }
  const visited = new Set(); const pureNames = new Set(); const stableNames = new Set();
  const require = (name, origin, stableAllowed = false, readOnlyClosure = false) => {
    const entry = references[name];
    if (!entry) throw new Error(`Track-B recovery callable reference is outside the manifest contract (${origin})`);
    if (entry.class === 'pg_catalog') {
      if (DANGEROUS_CATALOG_FUNCTIONS.includes(entry.name)) throw new Error('Track-B recovery callable contract names a denylisted catalog function');
      if (readOnlyClosure && (!['i', 's'].includes(entry.volatility) || entry.security_definer !== false)) throw new Error('Track-B recovery stable view closure lacks a nonvolatile invoker catalog callable');
      return;
    }
    if (entry.class === 'extension') {
      if (!(manifest.prerequisites.required_extensions || []).some(item => item.name === entry.extension)) throw new Error('Track-B recovery callable contract references an unpinned extension');
      if (readOnlyClosure && (!['i', 's'].includes(entry.volatility) || entry.security_definer !== false)) throw new Error('Track-B recovery stable view closure lacks a nonvolatile invoker extension callable');
      return;
    }
    if (entry.class === 'not_a_function' || entry.class === 'keyword') return;
    if (entry.class === 'public_pure' || entry.class === 'public_stable_view') {
      const stable = entry.class === 'public_stable_view';
      if (stable && !stableAllowed) throw new Error('Track-B recovery stable public callable is allowed only in an ordinary view');
      const purities = pureFunctions.get(entry.name);
      if (!purities) throw new Error('Track-B recovery package lacks a pure function the contract requires');
      for (const purity of purities) {
        if (!purity.pure) throw new Error(`Track-B recovery public function violates the purity contract (${purity.reasons.join(',')})`);
      }
      if (stable !== purities.some(purity => purity.volatility === 's')) throw new Error('Track-B recovery public callable volatility disagrees with its manifest class');
      // A view visit cannot authorize the same name in a later load expression,
      // nor bypass the stricter builtin closure after a legacy immutable visit.
      const closure = readOnlyClosure || stable;
      if (closure && purities.some(purity => !purity.stable_body_safe)) throw new Error('Track-B recovery stable view closure contains locking or SQL INTO');
      const key = `${entry.name}:${stableAllowed}:${closure}`;
      if (visited.has(key)) return;
      visited.add(key); (stable ? stableNames : pureNames).add(entry.name);
      for (const purity of purities) for (const call of purity.calls) require(call, 'function body', stableAllowed, closure);
      return;
    }
    throw new Error('Track-B recovery callable contract has an unsupported class');
  };
  let evaluated = 0;
  for (const item of evaluatedExpressionTexts(statements)) {
    for (const name of callNamesIn(item.text)) { evaluated += 1; require(name, item.kind, item.kind === 'view'); }
  }
  return { evaluated_references: evaluated, pure_functions: [...pureNames].sort(), stable_view_functions: [...stableNames].sort() };
}

// ---------------------------------------------------------------------------
// Statement classification: execute / skip (platform-owned) / reject.
// ---------------------------------------------------------------------------
function classifySchemaStatement(statement, allowedRoles = PLATFORM_ROLES) {
  const raw = clean(statement && statement.text);
  if (statement && statement.kind === 'meta') {
    if (/^\\(?:un)?restrict [A-Za-z0-9]+$/.test(raw)) return { action: 'skip', kind: 'psql_restrict_marker' };
    return { action: 'reject', kind: 'psql_meta_command' };
  }
  const { stripped, bodies } = stripDollarQuoted(raw);
  const head = stripped.replace(/\s+/g, ' ');
  const roles = new Set([...allowedRoles, ...PLATFORM_ROLES]);
  const rolesAllowed = tail => normalizeRoleList(tail).every(role => role === 'PUBLIC' || roles.has(role));
  const roleList = `${IDENT}(?:, ${IDENT})*`;
  const tests = [
    [new RegExp(`^SET (${ALLOWED_SESSION_SETTINGS.join('|')}) = [^;]{1,60}$`, 'i'), match => (
      SKIPPED_SESSION_SETTINGS.includes(match[1].toLowerCase()) ? { action: 'skip', kind: 'session_timeout_setting' } : { action: 'execute', kind: 'session_setting' })],
    [/^SELECT pg_catalog\.set_config\('search_path', '', false\)$/, () => ({ action: 'execute', kind: 'search_path_reset' })],
    [/^CREATE SCHEMA public$/i, () => ({ action: 'skip', kind: 'platform_schema' })],
    [/^COMMENT ON SCHEMA public IS /i, () => ({ action: 'skip', kind: 'platform_schema_comment' })],
    [new RegExp(`^(?:GRANT|REVOKE) [A-Z, ]+ ON SCHEMA public (?:TO|FROM) ${roleList}$`, 'i'), () => ({ action: 'skip', kind: 'platform_schema_acl' })],
    [new RegExp(`^CREATE (?:UNLOGGED )?TABLE public\\.${IDENT} \\(`, 'i'), () => ({ action: 'execute', kind: 'table' })],
    [new RegExp(`^CREATE (?:UNIQUE )?INDEX ${IDENT} ON public\\.${IDENT} USING ${IDENT} \\(`, 'i'), () => ({ action: 'execute', kind: 'index' })],
    [new RegExp(`^CREATE SEQUENCE public\\.${IDENT}`, 'i'), () => ({ action: 'execute', kind: 'sequence' })],
    [new RegExp(`^ALTER SEQUENCE public\\.${IDENT} OWNED BY public\\.${IDENT}\\.${IDENT}$`, 'i'), () => ({ action: 'execute', kind: 'sequence_owner' })],
    [new RegExp(`^ALTER TABLE (?:ONLY )?public\\.${IDENT} ALTER COLUMN ${IDENT} (?:ADD GENERATED (?:ALWAYS|BY DEFAULT) AS IDENTITY|SET DEFAULT|SET NOT NULL|SET STATISTICS|SET STORAGE|SET \\()`, 'i'), () => ({ action: 'execute', kind: 'column_alter' })],
    [new RegExp(`^ALTER TABLE (?:ONLY )?public\\.${IDENT} ADD CONSTRAINT ${IDENT} (?:PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK|EXCLUDE)`, 'i'), () => ({ action: 'execute', kind: 'constraint' })],
    [new RegExp(`^ALTER TABLE (?:ONLY )?public\\.${IDENT} (?:ENABLE|FORCE) ROW LEVEL SECURITY$`, 'i'), () => ({ action: 'execute', kind: 'row_security' })],
    [new RegExp(`^ALTER TABLE (?:ONLY )?public\\.${IDENT} REPLICA IDENTITY (?:DEFAULT|FULL|NOTHING|USING INDEX ${IDENT})$`, 'i'), () => ({ action: 'execute', kind: 'replica_identity' })],
    [new RegExp(`^ALTER TABLE (?:ONLY )?public\\.${IDENT} (?:ENABLE|DISABLE) (?:ALWAYS |REPLICA )?TRIGGER ${IDENT}$`, 'i'), () => ({ action: 'execute', kind: 'trigger_state' })],
    [new RegExp(`^ALTER TABLE (?:ONLY )?public\\.${IDENT} CLUSTER ON ${IDENT}$`, 'i'), () => ({ action: 'execute', kind: 'cluster' })],
    [new RegExp(`^CREATE (?:OR REPLACE )?(?:FUNCTION|PROCEDURE) public\\.${IDENT}\\(`, 'i'), () => {
      const language = stripped.match(/\bLANGUAGE\s+([A-Za-z_]+)/i);
      if (!language || !/^(plpgsql|sql)$/i.test(language[1])) return { action: 'reject', kind: 'function_language' };
      if (/\bLANGUAGE\s+[A-Za-z_]+[\s\S]*\bLANGUAGE\s+/i.test(stripped)) return { action: 'reject', kind: 'function_language' };
      if (/\bAS\s+'/i.test(head)) return { action: 'reject', kind: 'function_quoted_body' };
      return { action: 'execute', kind: 'function', egress: bodies.some(body => EGRESS_BODY_PATTERN.test(body)) };
    }],
    [new RegExp(`^CREATE (?:CONSTRAINT )?TRIGGER ${IDENT} (?:BEFORE|AFTER|INSTEAD OF) (?:INSERT|UPDATE|DELETE|TRUNCATE)(?: OF ${IDENT}(?:, ${IDENT})*)?(?: OR (?:INSERT|UPDATE|DELETE|TRUNCATE)(?: OF ${IDENT}(?:, ${IDENT})*)?)* ON public\\.${IDENT} [\\s\\S]*EXECUTE (?:FUNCTION|PROCEDURE) public\\.${IDENT}\\(`, 'i'), () => ({ action: 'execute', kind: 'trigger' })],
    [new RegExp(`^CREATE POLICY ${IDENT} ON public\\.${IDENT} `, 'i'), () => {
      const to = head.match(/ TO ([^ ]+(?:, [^ ]+)*) (?:USING|WITH)/i) || head.match(/ TO ([^ ]+(?:, [^ ]+)*)$/i);
      return to && !rolesAllowed(to[1]) ? { action: 'reject', kind: 'policy_role' } : { action: 'execute', kind: 'policy' };
    }],
    [new RegExp(`^CREATE (?:OR REPLACE )?VIEW public\\.${IDENT} `, 'i'), () => ({ action: 'execute', kind: 'view' })],
    [new RegExp(`^CREATE MATERIALIZED VIEW public\\.${IDENT} `, 'i'), () => ({ action: 'execute', kind: 'materialized_view' })],
    [new RegExp(`^REFRESH MATERIALIZED VIEW public\\.${IDENT}$`, 'i'), () => ({ action: 'execute', kind: 'materialized_view_refresh' })],
    [new RegExp(`^CREATE TYPE public\\.${IDENT} AS `, 'i'), () => ({ action: 'execute', kind: 'type' })],
    [new RegExp(`^CREATE DOMAIN public\\.${IDENT} AS `, 'i'), () => ({ action: 'execute', kind: 'domain' })],
    [new RegExp(`^ALTER DOMAIN public\\.${IDENT} ADD CONSTRAINT `, 'i'), () => ({ action: 'execute', kind: 'domain_constraint' })],
    [new RegExp(`^COMMENT ON (?:TABLE|COLUMN|FUNCTION|PROCEDURE|INDEX|TYPE|DOMAIN|SEQUENCE|VIEW|MATERIALIZED VIEW) public\\.${IDENT}`, 'i'), () => ({ action: 'execute', kind: 'comment' })],
    [new RegExp(`^COMMENT ON (?:CONSTRAINT|TRIGGER|POLICY) ${IDENT} ON public\\.${IDENT} IS `, 'i'), () => ({ action: 'execute', kind: 'comment' })],
    // Exactly ONE public target, no comma list, no other schema, no grant option.
    [new RegExp(`^(GRANT|REVOKE) ((?:[A-Z]+(?:\\([^)]*\\))?)(?:, ?(?:[A-Z]+(?:\\([^)]*\\))?))*) ON (TABLE|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE|TYPE|DOMAIN) public\\.${IDENT}(?:${ARGS})? (TO|FROM) (${roleList})$`, 'i'), match => (
      rolesAllowed(match[5]) ? { action: 'execute', kind: 'acl' } : { action: 'reject', kind: 'acl_role' })],
    [/^(GRANT|REVOKE) /i, () => ({ action: 'reject', kind: 'acl_shape' })],
  ];
  for (const [pattern, resolve] of tests) {
    const match = head.match(pattern);
    if (match) return resolve(match);
  }
  const keyword = (head.match(/^[A-Z]+(?: [A-Z]+)?/i) || ['unknown'])[0].toLowerCase().replace(/ /g, '_');
  return { action: 'reject', kind: `disallowed_${keyword}` };
}

function validateSchemaSection(text, allowedRoles = PLATFORM_ROLES) {
  const statements = splitSqlStatements(String(text));
  const executable = [];
  const inventory = {};
  let skipped = 0; let egress = 0;
  for (const statement of statements) {
    const verdict = classifySchemaStatement(statement, allowedRoles);
    if (verdict.action === 'reject') {
      const error = new Error(`Track-B recovery schema section contains a disallowed statement (${verdict.kind}) at line ${statement.line}`);
      error.code = verdict.kind; throw error;
    }
    if (verdict.action === 'skip') { skipped += 1; continue; }
    inventory[verdict.kind] = (inventory[verdict.kind] || 0) + 1;
    if (verdict.egress) egress += 1;
    executable.push(statement.text);
  }
  return { statements: executable, skipped, inventory, egress_capable_functions: egress };
}

function createdTables(statements) {
  const names = new Set();
  for (const text of statements) {
    const match = text.match(new RegExp(`^CREATE (?:UNLOGGED )?TABLE public\\.(${IDENT}) \\(`, 'i'));
    if (match) names.add(unquote(match[1]));
  }
  return names;
}

// ---------------------------------------------------------------------------
// Catalog SQL. Owner names never enter the fingerprint: ACLs are exploded and
// the owner's own entries are dropped, so a restore owned by another role
// reproduces the same value. Function bodies enter only as digests.
// ---------------------------------------------------------------------------
function fingerprintSql() {
  return `with rel as (
  select c.oid, c.relname, c.relkind, c.relowner, c.relrowsecurity, c.relforcerowsecurity, c.relreplident, c.relacl
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m','S','f')
), lines as (
  select 'R|'||r.relname||'|'||r.relkind::text||'|'||r.relrowsecurity||'|'||r.relforcerowsecurity||'|'||r.relreplident::text||'|'||coalesce((
    select string_agg(coalesce(g.rolname,'PUBLIC')||':'||e.privilege_type||':'||e.is_grantable, ',' order by coalesce(g.rolname,'PUBLIC'), e.privilege_type)
    from pg_catalog.aclexplode(r.relacl) e left join pg_catalog.pg_roles g on g.oid=e.grantee where e.grantee<>r.relowner),'') as line from rel r
  union all
  select 'A|'||r.relname||'|'||a.attnum||'|'||a.attname||'|'||pg_catalog.format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'')||'|'||a.attidentity::text||'|'||a.attgenerated::text||'|'||coalesce((
    select string_agg(coalesce(g.rolname,'PUBLIC')||':'||e.privilege_type, ',' order by coalesce(g.rolname,'PUBLIC'), e.privilege_type)
    from pg_catalog.aclexplode(a.attacl) e left join pg_catalog.pg_roles g on g.oid=e.grantee where e.grantee<>r.relowner),'')
  from rel r join pg_catalog.pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid=r.oid and d.adnum=a.attnum where r.relkind in ('r','p','v','m','f')
  union all
  select 'C|'||r.relname||'|'||c.conname||'|'||c.contype::text||'|'||c.condeferrable||'|'||c.condeferred||'|'||c.convalidated||'|'||pg_catalog.pg_get_constraintdef(c.oid)
  from pg_catalog.pg_constraint c join rel r on r.oid=c.conrelid
  union all
  select 'I|'||r.relname||'|'||ic.relname||'|'||pg_catalog.pg_get_indexdef(i.indexrelid)
  from pg_catalog.pg_index i join rel r on r.oid=i.indrelid join pg_catalog.pg_class ic on ic.oid=i.indexrelid
  union all
  select 'F|'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')|'||md5(pg_catalog.pg_get_functiondef(p.oid))||'|'||p.prosecdef::text||'|'||p.provolatile::text||'|'||p.prokind::text||'|'||coalesce((
    select string_agg(coalesce(g.rolname,'PUBLIC')||':'||e.privilege_type, ',' order by coalesce(g.rolname,'PUBLIC'), e.privilege_type)
    from pg_catalog.aclexplode(p.proacl) e left join pg_catalog.pg_roles g on g.oid=e.grantee where e.grantee<>p.proowner),'')
  from pg_catalog.pg_proc p where p.pronamespace='public'::regnamespace
  union all
  select 'G|'||r.relname||'|'||t.tgname||'|'||t.tgenabled::text||'|'||pg_catalog.pg_get_triggerdef(t.oid)
  from pg_catalog.pg_trigger t join rel r on r.oid=t.tgrelid where not t.tgisinternal
  union all
  select 'P|'||p.tablename||'|'||p.policyname||'|'||coalesce(array_to_string(p.roles,','),'')||'|'||p.cmd||'|'||p.permissive||'|'||coalesce(p.qual,'')||'|'||coalesce(p.with_check,'')
  from pg_catalog.pg_policies p where p.schemaname='public'
  union all
  select 'V|'||r.relname||'|'||md5(pg_catalog.pg_get_viewdef(r.oid)) from rel r where r.relkind in ('v','m')
  union all
  select 'S|'||r.relname||'|'||s.seqstart||'|'||s.seqincrement||'|'||s.seqmin||'|'||s.seqmax||'|'||s.seqcache||'|'||s.seqcycle||'|'||s.seqtypid::regtype::text
  from pg_catalog.pg_sequence s join rel r on r.oid=s.seqrelid
  union all
  select 'T|'||t.typname||'|'||t.typtype::text||'|'||coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_catalog.pg_enum e where e.enumtypid=t.oid),'')||'|'||coalesce(pg_catalog.format_type(nullif(t.typbasetype,0), t.typtypmod),'')
  from pg_catalog.pg_type t where t.typnamespace='public'::regnamespace and t.typtype in ('e','d','r')
  union all
  select 'T|'||t.typname||'|c|'||coalesce((select string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod), ',' order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid=t.typrelid and a.attnum>0 and not a.attisdropped),'')
  from pg_catalog.pg_type t join pg_catalog.pg_class c on c.oid=t.typrelid where t.typnamespace='public'::regnamespace and t.typtype='c' and c.relkind='c'
  union all
  select 'D|'||r.relname||'|'||d.objsubid||'|'||md5(d.description) from pg_catalog.pg_description d join rel r on r.oid=d.objoid and d.classoid='pg_class'::regclass
  union all
  select 'DF|'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')|'||md5(d.description)
  from pg_catalog.pg_description d join pg_catalog.pg_proc p on p.oid=d.objoid and d.classoid='pg_proc'::regclass where p.pronamespace='public'::regnamespace
)
select coalesce(md5(string_agg(line, E'\\n' order by line)), md5('')) from lines`;
}

function inventorySql() {
  return `select json_build_object(
  'tables', (select json_agg(c.relname order by c.relname) from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')),
  'views', (select count(*) from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('v','m')),
  'sequences', (select json_agg(c.relname order by c.relname) from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind='S'),
  'functions', (select count(*) from pg_catalog.pg_proc p where p.pronamespace='public'::regnamespace),
  'triggers', (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal),
  'disabled_triggers', (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal and t.tgenabled='D'),
  'policies', (select count(*) from pg_catalog.pg_policies p where p.schemaname='public'),
  'indexes', (select count(*) from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indrelid where c.relnamespace='public'::regnamespace),
  'constraints', (select count(*) from pg_catalog.pg_constraint c where c.connamespace='public'::regnamespace),
  'types', (select count(*) from pg_catalog.pg_type t where t.typnamespace='public'::regnamespace and t.typtype in ('e','d','r'))
)`;
}

// Exact sequence state: the sequence relation itself (last_value, is_called)
// plus its catalog definition, everything as text. pg_sequences.last_value is
// NULL for an uncalled sequence and is not the state; it is never used here.
function sequenceStateSql(name) {
  const safe = safeName(name, /^[a-z_][a-z0-9_]{0,62}$/, 'sequence name');
  return `select json_build_object('name', '${safe}', 'last_value', s.last_value::text, 'is_called', s.is_called,
  'start_value', q.seqstart::text, 'increment_by', q.seqincrement::text, 'min_value', q.seqmin::text, 'max_value', q.seqmax::text,
  'data_type', q.seqtypid::regtype::text)
from public.${safe} s cross join pg_catalog.pg_sequence q where q.seqrelid='public.${safe}'::regclass`;
}

function validateSequenceState(item) {
  const name = safeName(item && item.name, /^[a-z_][a-z0-9_]{0,62}$/, 'sequence name');
  const type = clean(item.data_type);
  if (!SEQUENCE_RANGES[type]) throw new Error('Unsupported sequence data type in Track-B recovery manifest');
  const decimal = value => { if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,18})$/.test(value)) throw new Error('Unsafe sequence value in Track-B recovery manifest'); return BigInt(value); };
  const last = decimal(item.last_value); const min = decimal(item.min_value); const max = decimal(item.max_value); decimal(item.start_value); decimal(item.increment_by);
  const [lo, hi] = SEQUENCE_RANGES[type];
  if (min < lo || max > hi || min > max || last < min || last > max) throw new Error('Sequence value out of range in Track-B recovery manifest');
  if (typeof item.is_called !== 'boolean') throw new Error('Sequence is_called must be an explicit boolean in Track-B recovery manifest');
  return { name, last_value: item.last_value, is_called: item.is_called };
}

function sequenceValueSql(manifest) {
  return (manifest.sequences || []).map(item => {
    const state = validateSequenceState(item);
    return `select pg_catalog.setval('public.${state.name}', '${state.last_value}'::bigint, ${state.is_called});`;
  });
}

// Exact ordered content digest of one table, timezone-pinned so the same rows
// produce the same digest on any server. Never stores or prints row content.
function dataDigestSql(table) {
  const safe = safeName(table, /^[a-z_][a-z0-9_]{0,62}$/, 'table name');
  return `select encode(pg_catalog.sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, E'\\n' order by to_jsonb(t)::text), ''), 'UTF8')), 'hex') from public.${safe} t`;
}

function prerequisitesSql() {
  const platform = PLATFORM_ROLES.map(role => `('${role}')`).join(',');
  return `with grantees as (
  select g.rolname from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) e join pg_catalog.pg_roles g on g.oid=e.grantee where c.relnamespace='public'::regnamespace and e.grantee<>c.relowner
  union select g.rolname from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid cross join lateral pg_catalog.aclexplode(a.attacl) e join pg_catalog.pg_roles g on g.oid=e.grantee where c.relnamespace='public'::regnamespace and e.grantee<>c.relowner
  union select g.rolname from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) e join pg_catalog.pg_roles g on g.oid=e.grantee where p.pronamespace='public'::regnamespace and e.grantee<>p.proowner
  union select r from pg_catalog.pg_policies p cross join lateral unnest(p.roles) r where p.schemaname='public' and r<>'public'
  union select rolname from (values ${platform}) v(rolname)
)
select json_build_object(
  'server_version', current_setting('server_version'),
  'server_version_num', current_setting('server_version_num')::int,
  'roles', (select json_agg(rolname order by rolname) from grantees),
  'extensions', (select coalesce(json_agg(json_build_object('name', e.extname, 'schema', n.nspname, 'version', e.extversion) order by e.extname), '[]'::json) from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace),
  'schemas', (select json_agg(n.nspname order by n.nspname) from pg_catalog.pg_namespace n where n.nspname not like 'pg\\_%' and n.nspname<>'information_schema'),
  'realtime_publication', (select case when exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
    then json_build_object('present', true, 'all_tables', (select puballtables from pg_catalog.pg_publication where pubname='supabase_realtime'),
      'tables', (select coalesce(json_agg(tablename order by tablename), '[]'::json) from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public'))
    else json_build_object('present', false) end),
  'foreign_servers', (select count(*) from pg_catalog.pg_foreign_server)
)`;
}

// Resolve every callable name seen in evaluated expressions and pure-function
// bodies against the SOURCE catalog. pg_depend supplies the authoritative
// non-pinned edges; the name resolution supplies the class of every token.
function callableResolutionSql(names) {
  const list = names.length ? names.map(name => sqlLiteral(name)).join(',') : "'__none__'";
  return `with wanted(token) as (select * from (values (${list.split(',').join('),(')})) v(token)),
parsed as (select token, case when position('.' in token) > 0 then split_part(token, '.', 1) else null end as schema_name,
  case when position('.' in token) > 0 then split_part(token, '.', 2) else token end as bare from wanted),
hits as (
  select w.token, n.nspname as schema_name, p.proname, p.provolatile::text as volatility, p.prosecdef, l.lanname, p.prosrc,
    (select e.extname from pg_catalog.pg_depend d join pg_catalog.pg_extension e on e.oid=d.refobjid where d.classid='pg_proc'::regclass and d.objid=p.oid and d.refclassid='pg_extension'::regclass and d.deptype='e' limit 1) as extension
  from parsed w join pg_catalog.pg_proc p on p.proname=w.bare join pg_catalog.pg_namespace n on n.oid=p.pronamespace join pg_catalog.pg_language l on l.oid=p.prolang
  where (w.schema_name is null or n.nspname=w.schema_name) and n.nspname not in ('pg_toast','information_schema')
)
select coalesce(json_agg(json_build_object('token', token, 'schema', schema_name, 'name', proname, 'volatility', volatility, 'security_definer', prosecdef,
  'language', lanname, 'extension', extension, 'body_sha256', encode(pg_catalog.sha256(convert_to(prosrc,'UTF8')),'hex'), 'body', prosrc) order by token, schema_name, proname), '[]'::json) from hits`;
}

function dependencyEdgesSql() {
  return `select coalesce(json_agg(json_build_object('kind', kind, 'relation', relation, 'function', fn) order by kind, relation, fn), '[]'::json) from (
  select case d.classid when 'pg_constraint'::regclass then 'check' when 'pg_attrdef'::regclass then 'default' when 'pg_class'::regclass then 'index' else 'view' end as kind,
    case d.classid when 'pg_constraint'::regclass then (select conrelid::regclass::text from pg_catalog.pg_constraint where oid=d.objid)
      when 'pg_attrdef'::regclass then (select adrelid::regclass::text from pg_catalog.pg_attrdef where oid=d.objid)
      when 'pg_class'::regclass then (select i.indrelid::regclass::text from pg_catalog.pg_index i where i.indexrelid=d.objid)
      else (select ev_class::regclass::text from pg_catalog.pg_rewrite where oid=d.objid) end as relation,
    n.nspname||'.'||p.proname as fn
  from pg_catalog.pg_depend d join pg_catalog.pg_proc p on p.oid=d.refobjid join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where d.refclassid='pg_proc'::regclass and d.classid in ('pg_constraint'::regclass,'pg_attrdef'::regclass,'pg_class'::regclass,'pg_rewrite'::regclass)
) edges where relation like 'public.%' or relation not like '%.%'`;
}

function evaluatedSourceTextsSql() {
  return `select coalesce(json_agg(json_build_object('kind', kind, 'text', expr)), '[]'::json) from (
  select 'check' kind, pg_get_constraintdef(oid) expr from pg_catalog.pg_constraint where contype='c' and connamespace='public'::regnamespace
  union all select 'default', pg_get_expr(adbin, adrelid) from pg_catalog.pg_attrdef where adrelid in (select oid from pg_catalog.pg_class where relnamespace='public'::regnamespace)
  union all select 'index', regexp_replace(pg_get_indexdef(indexrelid), '^CREATE (UNIQUE )?INDEX \\S+ ON \\S+ USING \\S+ ', '') from pg_catalog.pg_index where indrelid in (select oid from pg_catalog.pg_class where relnamespace='public'::regnamespace)
  union all select case c.relkind when 'v' then 'view' else 'materialized_view' end, pg_get_viewdef(c.oid) from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('v','m')
  union all select 'domain', pg_get_constraintdef(oid) from pg_catalog.pg_constraint where contype='c' and contypid in (select oid from pg_catalog.pg_type where typnamespace='public'::regnamespace and typtype='d')
) x`;
}

// Classify one resolved token. Returns {class, ...} or throws for unsafe ones.
function classifyCallable(token, hits, requiredExtensionNames, visited, resolveBody, { allowStableView = false } = {}) {
  const bare = token.includes('.') ? token.split('.')[1] : token;
  if (!hits.length) {
    if (token.includes('.')) throw new Error('Track-B recovery capture found a qualified callable that does not resolve');
    return { class: 'not_a_function', name: bare };
  }
  const schemas = new Set(hits.map(hit => hit.schema));
  for (const schema of schemas) {
    if (!['pg_catalog', 'public'].includes(schema) && !hits.some(hit => hit.schema === schema && hit.extension)) {
      throw new Error(`Track-B recovery capture found a callable in an unsupported schema (${schema})`);
    }
  }
  if (DANGEROUS_CATALOG_FUNCTIONS.includes(bare)) throw new Error(`Track-B recovery capture found a denylisted catalog callable (${bare})`);
  const publicHits = hits.filter(hit => hit.schema === 'public');
  const extensionHits = hits.filter(hit => hit.extension);
  if (publicHits.length && (token.includes('.') ? token.startsWith('public.') : true)) {
    if (!token.includes('.') && hits.some(hit => hit.schema === 'pg_catalog')) throw new Error(`Track-B recovery capture found a public callable shadowing pg_catalog (${bare})`);
    for (const hit of publicHits) {
      if ((hit.volatility !== 'i' && !(allowStableView && hit.volatility === 's')) || hit.security_definer !== false || !['sql', 'plpgsql'].includes(hit.language)) throw new Error(`Track-B recovery capture found an impure public callable (${bare})`);
      if (typeof hit.body !== 'string') throw new Error('Track-B recovery capture lacks a public callable body');
      if (BODY_WRITE_KEYWORDS.test(stripSqlNoise(hit.body))) throw new Error(`Track-B recovery capture found a public callable with a writing statement (${bare})`);
      if (hit.volatility === 's' && stableBodyUnsafe(hit.body, hit.language)) throw new Error('Track-B recovery capture found a stable callable with locking or SQL INTO');
    }
    if (!visited.has(bare)) { visited.add(bare); for (const hit of publicHits) resolveBody(hit.body); }
    return { class: publicHits.some(hit => hit.volatility === 's') ? 'public_stable_view' : 'public_pure', name: bare, body_sha256: publicHits.map(hit => hit.body_sha256).sort() };
  }
  if (extensionHits.length && (token.includes('.') ? !token.startsWith('pg_catalog.') : !hits.some(hit => hit.schema === 'pg_catalog'))) {
    for (const hit of extensionHits) {
      if (!requiredExtensionNames.has(hit.extension)) throw new Error(`Track-B recovery capture found a callable from an unpinned extension (${hit.extension})`);
      if (hit.volatility === 'v' && !VOLATILE_EXTENSION_ALLOWLIST.includes(bare)) throw new Error(`Track-B recovery capture found a volatile extension callable (${bare})`);
    }
    return { class: 'extension', name: bare, extension: extensionHits[0].extension, schema: extensionHits[0].schema, ...callableMetadata(extensionHits) };
  }
  return { class: 'pg_catalog', name: bare, ...callableMetadata(hits.filter(hit => hit.schema === 'pg_catalog')) };
}

// All overloads must be nonvolatile invokers before the new stable-view closure
// can consume them. Legacy immutable/default classifications are unchanged.
function callableMetadata(hits) {
  return {
    volatility: !hits.length || hits.some(hit => !['i', 's', 'v'].includes(hit.volatility)) ? 'unknown' : hits.some(hit => hit.volatility === 'v') ? 'v' : hits.some(hit => hit.volatility === 's') ? 's' : 'i',
    security_definer: hits.length > 0 && hits.every(hit => hit.security_definer === false) ? false : true,
  };
}

function sourcePreflightSql(corpusName) {
  const boundary = backup.resolveCorpus(corpusName).version >= 5 ? backup.corpusBoundarySql(corpusName) : '';
  return `${boundary}do $recovery_source$ declare v record; begin
  if not (select rolbypassrls from pg_catalog.pg_roles where rolname=current_user) then raise exception 'Track-B recovery capture role lacks BYPASSRLS'; end if;
  if (select rolsuper or rolcreaterole or rolcreatedb from pg_catalog.pg_roles where rolname=current_user) then raise exception 'Track-B recovery capture role must be restricted'; end if;
  for v in select c.oid::regclass as rel from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','f') loop
    if not has_table_privilege(current_user, v.rel, 'SELECT') then raise exception 'Track-B recovery capture role lacks SELECT on a public relation'; end if;
    if has_table_privilege(current_user, v.rel, 'INSERT') or has_table_privilege(current_user, v.rel, 'UPDATE')
      or has_table_privilege(current_user, v.rel, 'DELETE') or has_table_privilege(current_user, v.rel, 'TRUNCATE') then
      raise exception 'Track-B recovery capture role has a forbidden write privilege'; end if;
  end loop;
  for v in select c.oid::regclass as rel from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind='S' loop
    if not has_sequence_privilege(current_user, v.rel, 'SELECT') then raise exception 'Track-B recovery capture role lacks SELECT on a public sequence'; end if;
  end loop;
end $recovery_source$;
select 'source_preflight_ok'`;
}

// ---------------------------------------------------------------------------
// Package format: MAGIC | u64 manifest | manifest | u64 | gzip(pre) | u64 |
// gzip(post) | gzip(data) | HMAC-SHA256 over everything before the tag.
// ---------------------------------------------------------------------------
function sectionDescriptor(bytes) {
  const compressed = zlib.gzipSync(bytes, { level: 9 });
  return { bytes: bytes.length, sha256: sha256(bytes), compressed_bytes: compressed.length, compressed_sha256: sha256(compressed), compressed };
}

function bindingDigest(manifest) {
  return sha256(backup.canonicalJson({
    pre_data: manifest.schema.pre_data.sha256, post_data: manifest.schema.post_data.sha256,
    data: manifest.data.sha256, fingerprint: manifest.schema.fingerprint, corpus: manifest.corpus,
    generated_at: manifest.generated_at, source_project_ref: manifest.source_project_ref,
    recovery_version: manifest.recovery_version,
    table_digests: Object.fromEntries(Object.entries(manifest.data.tables || {}).map(([name, item]) => [name, item.digest_sha256 || null])),
    sequences: (manifest.sequences || []).map(item => `${item.name}:${item.last_value}:${item.is_called}`),
  }));
}

function packRecoveryPackage({ preData, postData, data, manifest }, hmacInput) {
  const key = backup.parseHmacKey(hmacInput);
  const pre = sectionDescriptor(preData); const post = sectionDescriptor(postData); const dat = sectionDescriptor(data);
  const full = {
    ...manifest,
    schema: { ...manifest.schema,
      pre_data: { bytes: pre.bytes, sha256: pre.sha256, compressed_bytes: pre.compressed_bytes, compressed_sha256: pre.compressed_sha256, statements: manifest.schema.pre_data.statements, skipped_platform_statements: manifest.schema.pre_data.skipped_platform_statements },
      post_data: { bytes: post.bytes, sha256: post.sha256, compressed_bytes: post.compressed_bytes, compressed_sha256: post.compressed_sha256, statements: manifest.schema.post_data.statements, skipped_platform_statements: manifest.schema.post_data.skipped_platform_statements } },
    data: { ...manifest.data, bytes: dat.bytes, sha256: dat.sha256, compressed_bytes: dat.compressed_bytes, compressed_sha256: dat.compressed_sha256 },
    authentication: { algorithm: 'hmac-sha256', covers: 'magic, manifest length, manifest, all compressed sections' },
  };
  full.binding = bindingDigest(full);
  const manifestBytes = Buffer.from(backup.canonicalJson(full), 'utf8');
  const unsigned = Buffer.concat([RECOVERY_MAGIC, u64(manifestBytes.length), manifestBytes,
    u64(pre.compressed.length), pre.compressed, u64(post.compressed.length), post.compressed, dat.compressed]);
  return { bytes: Buffer.concat([unsigned, hmacSha256(key, unsigned)]), manifest: full };
}

function readRecoveryPackage(input, hmacInput, nowMs = Date.now()) {
  const key = backup.parseHmacKey(hmacInput);
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || '');
  if (bytes.length < RECOVERY_MAGIC.length + 8 + 2 + 16 + HMAC_BYTES || !bytes.subarray(0, RECOVERY_MAGIC.length).equals(RECOVERY_MAGIC)) {
    throw new Error('Unsupported Track-B recovery package');
  }
  const unsigned = bytes.subarray(0, bytes.length - HMAC_BYTES);
  if (!crypto.timingSafeEqual(bytes.subarray(bytes.length - HMAC_BYTES), hmacSha256(key, unsigned))) {
    throw new Error('Track-B recovery package authentication failed');
  }
  let offset = RECOVERY_MAGIC.length;
  const manifestLength = Number(bytes.readBigUInt64BE(offset)); offset += 8;
  if (!Number.isSafeInteger(manifestLength) || manifestLength < 2 || manifestLength > 4 * 1024 * 1024 || offset + manifestLength >= unsigned.length) {
    throw new Error('Invalid Track-B recovery manifest length');
  }
  let manifest;
  try { manifest = JSON.parse(bytes.subarray(offset, offset + manifestLength).toString('utf8')); } catch (_) { throw new Error('Invalid Track-B recovery manifest JSON'); }
  offset += manifestLength;
  if (manifest.format !== RECOVERY_FORMAT) throw new Error('Unsupported Track-B recovery manifest');
  if (LEGACY_RECOVERY_VERSIONS[manifest.recovery_version]) {
    throw new Error(`Track-B recovery package version ${manifest.recovery_version} is refused: ${LEGACY_RECOVERY_VERSIONS[manifest.recovery_version]}`);
  }
  if (manifest.recovery_version !== RECOVERY_VERSION) throw new Error('Unsupported Track-B recovery manifest');
  const corpus = backup.resolveCorpus(manifest.corpus);
  if (manifest.corpus_version !== corpus.version) throw new Error('Track-B recovery corpus does not match its version');
  if (clean(manifest.source_project_ref) !== backup.PRODUCTION_REF) throw new Error('Track-B recovery package is not a production capture');
  if (manifest.binding !== bindingDigest(manifest)) throw new Error('Track-B recovery schema/data binding mismatch');
  backup.authenticatedGeneratedAt(manifest, nowMs);
  for (const item of manifest.sequences || []) validateSequenceState(item);
  const readSection = (descriptor, length) => {
    if (offset + length > unsigned.length) throw new Error('Track-B recovery section exceeds package');
    const compressed = bytes.subarray(offset, offset + length); offset += length;
    if (compressed.length !== descriptor.compressed_bytes || sha256(compressed) !== descriptor.compressed_sha256) throw new Error('Track-B recovery section digest mismatch');
    let raw;
    try { raw = zlib.gunzipSync(compressed); } catch (_) { throw new Error('Track-B recovery section is not valid gzip'); }
    if (raw.length !== descriptor.bytes || sha256(raw) !== descriptor.sha256) throw new Error('Track-B recovery section digest mismatch');
    return raw;
  };
  const preLength = Number(bytes.readBigUInt64BE(offset)); offset += 8;
  const preData = readSection(manifest.schema.pre_data, preLength);
  const postLength = Number(bytes.readBigUInt64BE(offset)); offset += 8;
  const postData = readSection(manifest.schema.post_data, postLength);
  const data = readSection(manifest.data, unsigned.length - offset);
  const roles = Array.isArray(manifest.prerequisites && manifest.prerequisites.roles) ? manifest.prerequisites.roles : PLATFORM_ROLES;
  const pre = validateSchemaSection(preData.toString('utf8'), roles);
  const post = validateSchemaSection(postData.toString('utf8'), roles);
  if (pre.statements.length !== manifest.schema.pre_data.statements || post.statements.length !== manifest.schema.post_data.statements) {
    throw new Error('Track-B recovery schema statement count mismatch');
  }
  const parsed = backup.parseStrictPgDump(data, corpus.name);
  const inspected = backup.inspectPlainDump(data, corpus.name);
  const tables = createdTables(pre.statements);
  for (const config of corpus.tables) {
    const expected = manifest.data.tables && manifest.data.tables[config.name];
    if (!expected || Number(expected.rows) !== inspected[config.name].rows || backup.canonicalJson(expected.primary_key) !== backup.canonicalJson(config.pk)) {
      throw new Error(`Track-B recovery manifest mismatch for ${config.name}`);
    }
    if (!/^[0-9a-f]{64}$/.test(String(expected.digest_sha256 || ''))) throw new Error(`Track-B recovery manifest lacks a content digest for ${config.name}`);
    if (!tables.has(config.name)) throw new Error(`Track-B recovery schema section does not create ${config.name}`);
  }
  if (Number(manifest.data.table_count) !== corpus.tables.length) throw new Error('Track-B recovery data table count mismatch');
  const sequenceNames = new Set((manifest.sequences || []).map(item => item.name));
  for (const text of pre.statements) {
    const created = text.match(new RegExp(`^CREATE SEQUENCE public\\.(${IDENT})`, 'i')) || text.match(new RegExp(`SEQUENCE NAME public\\.(${IDENT})`, 'i'));
    if (created && !sequenceNames.has(unquote(created[1]))) throw new Error('Track-B recovery manifest lacks the state of a package sequence');
  }
  const callable = verifyCallableContract([...pre.statements, ...post.statements], manifest);
  return { manifest, corpus: corpus.name, preData, postData, data, parsedData: parsed, schema: { pre, post }, callable };
}

// ---------------------------------------------------------------------------
// Reconstruction SQL for an EMPTY target. One transaction; no TRUNCATE, DROP,
// CASCADE or owner assignment; prerequisites verified before any DDL; exact
// verification before COMMIT so a mismatch rolls everything back.
// ---------------------------------------------------------------------------
function sqlLiteral(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }
function safeName(value, pattern, what) {
  const name = clean(value);
  if (!pattern.test(name)) throw new Error(`Unsafe ${what} in Track-B recovery manifest`);
  return name;
}

function targetPrerequisiteSql(manifest) {
  const prerequisites = manifest.prerequisites || {};
  const roles = (prerequisites.roles || []).map(role => safeName(role, /^[a-z_][a-z0-9_]{0,62}$/, 'role name'));
  const extensions = (prerequisites.required_extensions || []).map(item => ({
    name: safeName(item.name, /^[a-z_][a-z0-9_-]{0,62}$/, 'extension name'),
    schema: safeName(item.schema, /^[a-z_][a-z0-9_]{0,62}$/, 'extension schema'),
    version: safeName(item.version, /^[0-9A-Za-z._-]{1,40}$/, 'extension version'),
  }));
  const major = Math.floor(Number(prerequisites.server_version_num || 0) / 10000);
  const realtime = prerequisites.realtime_publication && prerequisites.realtime_publication.present === true;
  const references = Object.values(manifest.callable_references || {});
  const catalogNames = [...new Set(references.filter(item => item.class === 'pg_catalog').map(item => safeName(item.name, /^[a-z_][a-z0-9_]{0,62}$/, 'callable name')))];
  const absentNames = [...new Set(references.filter(item => item.class === 'not_a_function').map(item => safeName(item.name, /^[a-z_][a-z0-9_]{0,62}$/, 'callable name')))];
  const extensionCalls = references.filter(item => item.class === 'extension').map(item => ({
    name: safeName(item.name, /^[a-z_][a-z0-9_]{0,62}$/, 'callable name'), schema: safeName(item.schema, /^[a-z_][a-z0-9_]{0,62}$/, 'callable schema') }));
  const metadataCalls = references.filter(item => ['pg_catalog', 'extension'].includes(item.class) && Object.hasOwn(item, 'volatility')).map(item => {
    if (!['i', 's', 'v'].includes(item.volatility) || typeof item.security_definer !== 'boolean') throw new Error('Track-B recovery callable metadata is malformed');
    return { name: safeName(item.name, /^[a-z_][a-z0-9_]{0,62}$/, 'callable name'), schema: item.class === 'pg_catalog' ? 'pg_catalog' : safeName(item.schema, /^[a-z_][a-z0-9_]{0,62}$/, 'callable schema'), volatility: item.volatility, security_definer: item.security_definer };
  });
  const array = values => (values.length ? `array[${values.map(sqlLiteral).join(',')}]::text[]` : 'array[]::text[]');
  return `do $recovery_target$ declare v_count integer; v_role text; v_ext record; v_name text; v_sig text; begin
  select count(*) into v_count from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','S','f','c','i','I','t');
  if v_count > 0 then raise exception 'Track-B recovery target is not empty'; end if;
  select count(*) into v_count from pg_catalog.pg_proc p where p.pronamespace='public'::regnamespace;
  if v_count > 0 then raise exception 'Track-B recovery target is not empty'; end if;
  select count(*) into v_count from pg_catalog.pg_type t where t.typnamespace='public'::regnamespace and t.typtype in ('e','d','r','c');
  if v_count > 0 then raise exception 'Track-B recovery target is not empty'; end if;
  -- Effective-permission recheck of the CONNECTING role, immediately before DDL.
  if (select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or rolreplication from pg_catalog.pg_roles where rolname=current_user) then raise exception 'Track-B recovery role must be restricted'; end if;
  if exists(select 1 from pg_catalog.pg_roles r where r.rolsuper and r.rolname<>current_user and pg_has_role(current_user, r.oid, 'member')) then raise exception 'Track-B recovery role inherits superuser'; end if;
  foreach v_role in array ${array([...DANGEROUS_ROLE_MEMBERSHIPS])} loop
    if exists(select 1 from pg_catalog.pg_roles where rolname=v_role) and pg_has_role(current_user, v_role, 'member') then raise exception 'Track-B recovery role holds a dangerous membership'; end if;
  end loop;
  foreach v_sig in array ${array([...DANGEROUS_CATALOG_SIGNATURES])} loop
    if to_regprocedure(v_sig) is not null and has_function_privilege(current_user, to_regprocedure(v_sig), 'execute') then raise exception 'Track-B recovery role can execute a dangerous catalog function'; end if;
  end loop;
  if not has_schema_privilege(current_user, 'public', 'CREATE') then raise exception 'Track-B recovery role lacks CREATE on public'; end if;
  foreach v_role in array ${array(roles)} loop
    if not exists(select 1 from pg_catalog.pg_roles where rolname=v_role) then raise exception 'Track-B recovery target lacks a required role'; end if;
  end loop;
  for v_ext in select * from (values ${extensions.map(item => `(${sqlLiteral(item.name)},${sqlLiteral(item.schema)},${sqlLiteral(item.version)})`).join(',') || "(null::text,null::text,null::text)"}) v(name, schema, version) loop
    if v_ext.name is not null and not exists(select 1 from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace
      where e.extname=v_ext.name and n.nspname=v_ext.schema and e.extversion=v_ext.version) then
      raise exception 'Track-B recovery target lacks a required extension'; end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_extension where extname in (${EGRESS_EXTENSIONS.map(sqlLiteral).join(',')})) then raise exception 'Track-B recovery target has an egress-capable extension'; end if;
  if exists(select 1 from pg_catalog.pg_namespace where nspname in (${EGRESS_SCHEMAS.map(sqlLiteral).join(',')})) then raise exception 'Track-B recovery target has an egress-capable schema'; end if;
  if exists(select 1 from pg_catalog.pg_foreign_server) then raise exception 'Track-B recovery target has a foreign server'; end if;
  -- Callable contract on the target: catalog names exist and are not denylisted,
  -- extension callables exist under the pinned extension and are executable by
  -- this role, and names the source resolved to nothing resolve to nothing here.
  foreach v_name in array ${array(catalogNames)} loop
    if not exists(select 1 from pg_catalog.pg_proc p where p.pronamespace='pg_catalog'::regnamespace and p.proname=v_name) then raise exception 'Track-B recovery target lacks a catalog callable'; end if;
    if v_name = any(${array([...DANGEROUS_CATALOG_FUNCTIONS])}) then raise exception 'Track-B recovery contract names a denylisted callable'; end if;
  end loop;
  for v_ext in select * from (values ${extensionCalls.map(item => `(${sqlLiteral(item.name)},${sqlLiteral(item.schema)})`).join(',') || '(null::text,null::text)'}) v(name, schema) loop
    if v_ext.name is not null then
      if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace join pg_catalog.pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid and d.refclassid='pg_extension'::regclass
        where p.proname=v_ext.name and n.nspname=v_ext.schema) then raise exception 'Track-B recovery target lacks an extension callable'; end if;
      if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where p.proname=v_ext.name and n.nspname=v_ext.schema and not has_function_privilege(current_user, p.oid, 'execute')) then
        raise exception 'Track-B recovery role lacks EXECUTE on a contract callable'; end if;
    end if;
  end loop;
  -- New captures retain aggregate overload volatility/invoker metadata. Recheck
  -- it before DDL; older packages without stable-view classes retain their
  -- original contract, while a new stable closure requires this metadata.
  for v_ext in select * from (values ${metadataCalls.map(item => `(${sqlLiteral(item.name)},${sqlLiteral(item.schema)},${sqlLiteral(item.volatility)},${item.security_definer})`).join(',') || '(null::text,null::text,null::text,false)'}) v(name, schema, volatility, security_definer) loop
    if v_ext.name is not null and not exists(
      select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where p.proname=v_ext.name and n.nspname=v_ext.schema
      having count(*) > 0 and (case when bool_or(p.provolatile='v') then 'v' when bool_or(p.provolatile='s') then 's' else 'i' end)=v_ext.volatility
        and bool_or(p.prosecdef)=v_ext.security_definer
    ) then raise exception 'Track-B recovery target callable metadata differs from source'; end if;
  end loop;
  foreach v_name in array ${array(absentNames)} loop
    if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where p.proname=v_name and n.nspname in ('pg_catalog','public','extensions')) then raise exception 'Track-B recovery target resolves a name the source did not'; end if;
  end loop;
  if current_setting('server_version_num')::int / 10000 < ${major} then raise exception 'Track-B recovery target server is older than the source'; end if;
  ${realtime ? "if not exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then raise exception 'Track-B recovery target lacks the realtime publication'; end if;" : ''}
end $recovery_target$;`;
}

// In-transaction verification: any mismatch raises, so COMMIT never happens.
function inTransactionVerificationSql(manifest) {
  const corpus = backup.resolveCorpus(manifest.corpus);
  const fingerprint = safeName(manifest.schema.fingerprint, /^[0-9a-f]{32}$/, 'fingerprint');
  const lines = ['do $recovery_verify$ declare v_text text; v_called boolean; begin', "  perform set_config('timezone', 'UTC', true);",
    "  perform set_config('search_path', 'public', true);",
    `  select (${fingerprintSql().replace(/\n/g, ' ')}) into v_text;`,
    `  if v_text <> '${fingerprint}' then raise exception 'Track-B recovery verification: schema fingerprint mismatch'; end if;`];
  for (const config of corpus.tables) {
    const digest = safeName(manifest.data.tables[config.name].digest_sha256, /^[0-9a-f]{64}$/, 'content digest');
    const rows = safeName(String(manifest.data.tables[config.name].rows), /^\d{1,12}$/, 'row count');
    lines.push(`  select count(*)::text into v_text from public.${safeName(config.name, /^[a-z_][a-z0-9_]{0,62}$/, 'table name')};`,
      `  if v_text <> '${rows}' then raise exception 'Track-B recovery verification: row count mismatch'; end if;`,
      `  select (${dataDigestSql(config.name).replace(/\n/g, ' ')}) into v_text;`,
      `  if v_text <> '${digest}' then raise exception 'Track-B recovery verification: content digest mismatch'; end if;`);
  }
  for (const item of manifest.sequences || []) {
    const state = validateSequenceState(item);
    lines.push(`  select last_value::text, is_called into v_text, v_called from public.${state.name};`,
      `  if v_text <> '${state.last_value}' or v_called <> ${state.is_called} then raise exception 'Track-B recovery verification: sequence state mismatch'; end if;`);
  }
  lines.push("  if exists(select 1 from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','S') and pg_get_userbyid(c.relowner)<>current_user) then raise exception 'Track-B recovery verification: ownership mismatch'; end if;",
    "  if exists(select 1 from pg_catalog.pg_extension where extname in (" + EGRESS_EXTENSIONS.map(sqlLiteral).join(',') + ")) or exists(select 1 from pg_catalog.pg_foreign_server) then raise exception 'Track-B recovery verification: egress capability appeared'; end if;",
    'end $recovery_verify$;');
  return lines.join('\n');
}

function reconstructSql(pkg) {
  const { manifest, corpus, data, schema } = pkg;
  return [
    'begin;',
    "set local lock_timeout = '20s';",
    "set local statement_timeout = '30min';",
    targetPrerequisiteSql(manifest),
    ...schema.pre.statements.map(text => `${text};`),
    backup.renderSafeCopySections(data, corpus).trimEnd(),
    ...sequenceValueSql(manifest),
    ...schema.post.statements.map(text => `${text};`),
    inTransactionVerificationSql(manifest),
    'commit;',
    '',
  ].join('\n');
}

// Post-commit verification (fresh session): the same facts, independently.
function verificationSql(manifest) {
  const corpus = backup.resolveCorpus(manifest.corpus);
  const lines = ["set timezone = 'UTC';", "set search_path = 'public';", `select 'fingerprint' || E'\\t' || (${fingerprintSql()});`];
  for (const config of corpus.tables) {
    lines.push(`select 'rows:${config.name}' || E'\\t' || count(*)::text from public.${config.name};`);
    lines.push(`select 'digest:${config.name}' || E'\\t' || (${dataDigestSql(config.name)});`);
  }
  for (const item of manifest.sequences || []) {
    const state = validateSequenceState(item);
    lines.push(`select 'seq:${state.name}' || E'\\t' || last_value::text || '|' || is_called::text from public.${state.name};`);
  }
  lines.push("select 'sequence_count' || E'\\t' || count(*)::text from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind='S';");
  lines.push("select 'egress_extensions' || E'\\t' || count(*)::text from pg_catalog.pg_extension where extname in (" + EGRESS_EXTENSIONS.map(sqlLiteral).join(',') + ');');
  lines.push("select 'foreign_servers' || E'\\t' || count(*)::text from pg_catalog.pg_foreign_server;");
  lines.push("select 'realtime_tables' || E'\\t' || count(*)::text from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public';");
  lines.push("select 'owner_is_current_user' || E'\\t' || (select bool_and(pg_get_userbyid(c.relowner)=current_user)::text from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','S'));");
  // DIRECT grants to the restore role only. An extension's PUBLIC default
  // EXECUTE is a pinned platform property, reported separately, never widened.
  lines.push("select 'extension_executable_beyond_contract' || E'\\t' || count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace cross join lateral pg_catalog.aclexplode(p.proacl) e join pg_catalog.pg_roles g on g.oid=e.grantee where n.nspname='extensions' and g.rolname=current_user and e.privilege_type='EXECUTE' and replace(p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')', ' ', '') not in (" + EXTENSION_FUNCTION_CONTRACT.map(sqlLiteral).join(',') + ');');
  lines.push("select 'extension_public_default_execute' || E'\\t' || count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace cross join lateral pg_catalog.aclexplode(p.proacl) e where n.nspname='extensions' and e.grantee=0 and e.privilege_type='EXECUTE';");
  return lines.join('\n') + '\n';
}

function parseVerification(text) {
  const observed = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!clean(line)) continue;
    const index = line.indexOf('\t');
    if (index === -1) throw new Error('Malformed Track-B recovery verification line');
    observed[line.slice(0, index)] = line.slice(index + 1);
  }
  return observed;
}

function verifyReconstruction(manifest, observed) {
  const corpus = backup.resolveCorpus(manifest.corpus);
  if (observed.fingerprint !== manifest.schema.fingerprint) throw new Error('Track-B recovery schema fingerprint mismatch after reconstruction');
  const tables = {};
  for (const config of corpus.tables) {
    const expected = manifest.data.tables[config.name];
    if (observed[`rows:${config.name}`] !== String(expected.rows)) throw new Error(`Track-B recovery row-count mismatch for ${config.name}`);
    if (observed[`digest:${config.name}`] !== expected.digest_sha256) throw new Error(`Track-B recovery content digest mismatch for ${config.name}`);
    tables[config.name] = Number(expected.rows);
  }
  const sequences = manifest.sequences || [];
  if (observed.sequence_count !== String(sequences.length)) throw new Error('Track-B recovery sequence count mismatch after reconstruction');
  for (const item of sequences) {
    const state = validateSequenceState(item);
    if (observed[`seq:${state.name}`] !== `${state.last_value}|${state.is_called}`) throw new Error('Track-B recovery sequence state mismatch after reconstruction');
  }
  if (observed.egress_extensions !== '0' || observed.foreign_servers !== '0') throw new Error('Track-B recovery target acquired an egress capability');
  if (observed.owner_is_current_user !== 'true') throw new Error('Track-B recovery objects are not owned by the restore role');
  const realtimeExpected = manifest.prerequisites && manifest.prerequisites.realtime_publication && Array.isArray(manifest.prerequisites.realtime_publication.tables)
    ? manifest.prerequisites.realtime_publication.tables.length : 0;
  return {
    corpus: corpus.name,
    schema_fingerprint_match: true,
    content_digests_match: true,
    data_table_count: corpus.tables.length,
    omitted_data_table_count: (manifest.omitted_data_tables || []).length,
    sequence_count: sequences.length,
    tables,
    realtime_membership_expected: realtimeExpected,
    realtime_membership_restored: Number(observed.realtime_tables || 0),
    egress_capable_functions: Number(manifest.schema.egress_capable_functions || 0),
    extension_executable_beyond_contract: Number(observed.extension_executable_beyond_contract || 0),
    extension_public_default_execute: Number(observed.extension_public_default_execute || 0),
    callable_reference_count: Object.keys(manifest.callable_references || {}).length,
  };
}

// ---------------------------------------------------------------------------
// Dormant watcher evaluation: pure, public-safe, never schedules or sends.
// ---------------------------------------------------------------------------
function evaluateRecoveryWatch({ manifest = null, nowMs = Date.now(), thresholdHours = 25, liveFingerprint = null, livePublicTableCount = null, lastReconstruction = null } = {}) {
  const alerts = [];
  const freshness = { status: 'missing', age_hours: null };
  if (manifest && manifest.generated_at) {
    const age = (nowMs - Date.parse(manifest.generated_at)) / 3600000;
    freshness.age_hours = Number(age.toFixed(2));
    freshness.status = Number.isFinite(age) && age >= 0 && age <= thresholdHours ? 'ok' : 'stale';
  }
  if (freshness.status !== 'ok') alerts.push('RECOVERY_PACKAGE_' + freshness.status.toUpperCase());
  const schema = { status: 'unobserved' };
  if (manifest && liveFingerprint) {
    schema.status = liveFingerprint === manifest.schema.fingerprint ? 'ok' : 'mismatch';
    if (schema.status === 'mismatch') alerts.push('RECOVERY_SCHEMA_MISMATCH');
  }
  const verification = { status: 'never' };
  if (lastReconstruction) {
    verification.status = lastReconstruction.ok === true && lastReconstruction.package_sha256 === (manifest && manifest.package_sha256) ? 'ok'
      : lastReconstruction.ok === true ? 'stale_package' : lastReconstruction.outcome === 'committed_unverified' ? 'committed_unverified' : 'failed';
    if (verification.status !== 'ok') alerts.push('RECOVERY_VERIFICATION_' + verification.status.toUpperCase());
  } else alerts.push('RECOVERY_VERIFICATION_NEVER');
  const coverage = { status: 'unobserved', corpus: manifest ? manifest.corpus : null,
    data_table_count: manifest ? Number(manifest.data.table_count) : null,
    omitted_data_table_count: manifest ? (manifest.omitted_data_tables || []).length : null,
    live_public_table_count: livePublicTableCount };
  if (manifest && Number.isFinite(livePublicTableCount)) {
    const captured = Number(manifest.data.table_count) + (manifest.omitted_data_tables || []).length;
    coverage.status = livePublicTableCount === captured ? 'ok' : 'changed';
    if (coverage.status !== 'ok') alerts.push('RECOVERY_COVERAGE_CHANGED');
  }
  return { evaluated_at: new Date(nowMs).toISOString(), dormant: true, package_freshness: freshness, schema_mismatch: schema, verification, retained_coverage: coverage, alerts };
}

// ---------------------------------------------------------------------------
// Capture orchestration. `env` is a complete process environment carrying the
// PG* variables of the restricted capture role (see postgresEnvironment).
// ---------------------------------------------------------------------------
function opaque(stage, result) {
  const error = new Error(`${stage} failed`);
  error.detail = result && (result.stderr || String(result.error || ''));
  return error;
}

function runPsql(env, sql, { psql = 'psql', snapshot = null } = {}) {
  // Pin timezone AND search_path: pg_get_*def render qualified names when
  // search_path is empty, so every fingerprint context must agree or an
  // identical schema hashes differently.
  const input = snapshot
    ? `begin isolation level repeatable read read only;\nset transaction snapshot ${sqlLiteral(snapshot)};\nset local timezone = 'UTC';\nset local search_path = 'public';\n${sql};\ncommit;\n`
    : `set timezone = 'UTC';\nset search_path = 'public';\n${sql};\n`;
  const result = spawnSync(psql, ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1'], { input, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw opaque('Track-B recovery catalog query', result);
  return result.stdout.trim();
}

function openSnapshotSession(env, psql = 'psql') {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let settled = false;
    child.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/([0-9A-F]{8}-[0-9A-F]{8}-\d+)/);
      if (match && !settled) {
        settled = true;
        resolve({ snapshot: match[1], close: () => new Promise(done => { child.on('close', () => done()); child.stdin.end('commit;\n'); }) });
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { if (!settled) { settled = true; reject(opaque('Track-B recovery snapshot session', { error })); } });
    child.on('close', () => { if (!settled) { settled = true; reject(opaque('Track-B recovery snapshot session', { stderr })); } });
    child.stdin.write('begin isolation level repeatable read read only;\nselect pg_export_snapshot();\n');
  });
}

function pgDumpSectionArgs(section, file, corpusName, snapshot) {
  const common = ['--format=plain', '--encoding=UTF8', '--no-sync', '--lock-wait-timeout=60000', `--snapshot=${snapshot}`, `--file=${path.resolve(file)}`];
  if (section === 'data') {
    return [...common, '--data-only', ...backup.resolveCorpus(corpusName).tables.map(config => `--table=public.${config.name}`)];
  }
  return [...common, `--section=${section}`, '--schema=public', '--no-owner', '--no-publications', '--no-subscriptions', '--no-security-labels', '--no-tablespaces'];
}

function requiredExtensions(extensions) {
  return (extensions || []).filter(item => REQUIRED_EXTENSION_ALLOWLIST.includes(item.name) && ['public', 'extensions'].includes(item.schema));
}

// Resolve the callable contract against the source catalog inside the snapshot.
function resolveCallableContract(query, seedTokens, edges, requiredExtensionNames) {
  const references = {};
  const visited = new Set();
  const pending = new Set(seedTokens);
  const resolveBody = body => { for (const name of callNamesIn(body)) if (!references[name]) pending.add(name); };
  while (pending.size) {
    const batch = [...pending].filter(name => !references[name]); pending.clear();
    if (!batch.length) break;
    const hits = JSON.parse(query(callableResolutionSql(batch)));
    for (const token of batch) {
      references[token] = classifyCallable(token, hits.filter(hit => hit.token === token), requiredExtensionNames, visited, resolveBody, { allowStableView: true });
    }
  }
  for (const edge of edges) {
    const bare = edge.function.split('.')[1];
    const known = Object.values(references).find(item => item.name === bare && item.class !== 'not_a_function');
    if (!known) throw new Error(`Track-B recovery capture found a catalog dependency the expression scan did not resolve (${edge.kind})`);
  }
  return references;
}

async function captureRecoveryPackage({ env, corpusName, output, hmacInput, sourceUrl, generatedAt = new Date().toISOString(), sourceCommit = clean(process.env.GITHUB_SHA) || null, psql = 'psql', pgDump = 'pg_dump', tempDir = null, hooks = {} }) {
  const corpus = backup.resolveCorpus(corpusName);
  const key = backup.parseHmacKey(hmacInput);
  const sourceRef = backup.assertProductionSource(sourceUrl);
  const preflight = runPsql(env, sourcePreflightSql(corpus.name), { psql });
  if (!/source_preflight_ok/.test(preflight)) throw new Error('Track-B recovery source preflight did not confirm');
  const dir = tempDir || fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'track-b-recovery-'));
  const files = { pre: path.join(dir, 'pre-data.sql'), post: path.join(dir, 'post-data.sql'), data: path.join(dir, 'data.sql') };
  const session = await openSnapshotSession(env, psql);
  let fingerprintBefore; let inventory; let sequences; let prerequisites; let digests; let references; let sections;
  try {
    const query = sql => runPsql(env, sql, { psql, snapshot: session.snapshot });
    fingerprintBefore = query(fingerprintSql());
    inventory = JSON.parse(query(inventorySql()));
    prerequisites = JSON.parse(query(prerequisitesSql()));
    sequences = (inventory.sequences || []).map(name => JSON.parse(query(sequenceStateSql(name))));
    digests = Object.fromEntries(corpus.tables.map(config => [config.name, query(dataDigestSql(config.name))]));
    const requiredExtensionNames = new Set(requiredExtensions(prerequisites.extensions).map(item => item.name));
    const evaluatedTexts = JSON.parse(query(evaluatedSourceTextsSql()));
    const edges = JSON.parse(query(dependencyEdgesSql()));
    for (const section of ['pre-data', 'data', 'post-data']) {
      const target = section === 'pre-data' ? files.pre : section === 'post-data' ? files.post : files.data;
      const result = spawnSync(pgDump, pgDumpSectionArgs(section, target, corpus.name, session.snapshot), { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
      if (result.error || result.status !== 0) throw opaque(`Track-B recovery ${section} dump`, result);
    }
    // Seed the contract from BOTH the catalog-rendered expressions and the
    // exact statements the reader will re-scan, so capture and read time can
    // never disagree about which tokens must be classified.
    const roles = prerequisites.roles || [...PLATFORM_ROLES];
    sections = {
      pre: validateSchemaSection(fs.readFileSync(files.pre).toString('utf8'), roles),
      post: validateSchemaSection(fs.readFileSync(files.post).toString('utf8'), roles),
    };
    const seedTokens = new Set();
    for (const item of evaluatedTexts) for (const name of callNamesIn(item.text)) seedTokens.add(name);
    for (const item of evaluatedExpressionTexts([...sections.pre.statements, ...sections.post.statements])) {
      for (const name of callNamesIn(item.text)) seedTokens.add(name);
    }
    // Bodies stay private in the resolution query; references retain hashes,
    // never body text. This replaces the earlier equivalent query injection.
    references = resolveCallableContract(query, seedTokens, edges, requiredExtensionNames);
    if (typeof hooks.afterDumps === 'function') await hooks.afterDumps();
    const fingerprintAfter = runPsql(env, fingerprintSql(), { psql });
    if (fingerprintAfter !== fingerprintBefore) throw new Error('Track-B recovery capture observed a catalog change; package refused');
  } finally {
    await session.close();
  }
  const preData = fs.readFileSync(files.pre); const postData = fs.readFileSync(files.post); const data = fs.readFileSync(files.data);
  for (const file of Object.values(files)) fs.rmSync(file, { force: true });
  if (!tempDir) fs.rmSync(dir, { recursive: true, force: true });
  const roles = prerequisites.roles || [...PLATFORM_ROLES];
  const pre = sections.pre; const post = sections.post;
  const inspected = backup.inspectPlainDump(data, corpus.name);
  for (const name of Object.keys(inspected)) inspected[name].digest_sha256 = digests[name];
  const corpusNames = new Set(corpus.tables.map(config => config.name));
  const omitted = (inventory.tables || []).filter(name => !corpusNames.has(name));
  const strippedReferences = Object.fromEntries(Object.entries(references).map(([token, item]) => [token, { class: item.class, name: item.name, ...(item.extension ? { extension: item.extension, schema: item.schema } : {}), ...(item.body_sha256 ? { body_sha256: item.body_sha256 } : {}), ...(item.volatility ? { volatility: item.volatility, security_definer: item.security_definer } : {}) }]));
  const manifest = {
    format: RECOVERY_FORMAT,
    recovery_version: RECOVERY_VERSION,
    corpus: corpus.name,
    corpus_version: corpus.version,
    generated_at: generatedAt,
    completed_at: new Date().toISOString(),
    source_project_ref: sourceRef,
    source_commit: sourceCommit,
    snapshot_isolation: 'repeatable read read only; exported snapshot shared by catalog reads, digests and all three dumps; sequence state read inside the window (non-MVCC)',
    pg_dump_version: clean((spawnSync(pgDump, ['--version'], { encoding: 'utf8' }).stdout || '').replace(/^pg_dump \(PostgreSQL\) /, '')) || null,
    schema: {
      fingerprint: fingerprintBefore,
      inventory: { ...inventory, tables: (inventory.tables || []).length, sequences: (inventory.sequences || []).length },
      pre_data: { statements: pre.statements.length, skipped_platform_statements: pre.skipped },
      post_data: { statements: post.statements.length, skipped_platform_statements: post.skipped },
      statement_inventory: Object.fromEntries(Object.entries({ ...pre.inventory }).concat(Object.entries(post.inventory).map(([k, v]) => [k, (pre.inventory[k] || 0) + v]))),
      egress_capable_functions: pre.egress_capable_functions + post.egress_capable_functions,
    },
    data: { table_count: corpus.tables.length, tables: inspected },
    omitted_data_tables: omitted,
    sequences,
    callable_references: strippedReferences,
    prerequisites: {
      server_version: prerequisites.server_version,
      server_version_num: prerequisites.server_version_num,
      roles,
      required_extensions: requiredExtensions(prerequisites.extensions),
      observed_extensions: prerequisites.extensions,
      extension_function_contract: [...EXTENSION_FUNCTION_CONTRACT],
      schemas: prerequisites.schemas,
      realtime_publication: prerequisites.realtime_publication,
      foreign_servers: prerequisites.foreign_servers,
    },
  };
  if (Number(prerequisites.foreign_servers) > 0) throw new Error('Track-B recovery source has a foreign server; capture refused');
  // Resolve STABLE candidates provisionally, but reject non-view uses and an
  // unsafe transitive closure before publishing any authenticated package.
  verifyCallableContract([...pre.statements, ...post.statements], manifest);
  const packed = packRecoveryPackage({ preData, postData, data, manifest }, key.toString('base64'));
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), packed.bytes, { mode: 0o600 });
  const verified = readRecoveryPackage(fs.readFileSync(path.resolve(output)), key.toString('base64'));
  return summarize(verified.manifest, packed.bytes);
}

function summarize(manifest, bytes = null) {
  const references = Object.values(manifest.callable_references || {});
  return {
    ok: true,
    format: manifest.format,
    recovery_version: manifest.recovery_version,
    corpus: manifest.corpus,
    generated_at: manifest.generated_at,
    package_sha256: bytes ? sha256(bytes) : undefined,
    schema_fingerprint: manifest.schema.fingerprint,
    schema_statements: manifest.schema.pre_data.statements + manifest.schema.post_data.statements,
    data_table_count: manifest.data.table_count,
    omitted_data_table_count: (manifest.omitted_data_tables || []).length,
    sequence_count: (manifest.sequences || []).length,
    callable_classes: references.reduce((acc, item) => { acc[item.class] = (acc[item.class] || 0) + 1; return acc; }, {}),
    egress_capable_functions: manifest.schema.egress_capable_functions,
    required_extension_count: (manifest.prerequisites.required_extensions || []).length,
    role_count: (manifest.prerequisites.roles || []).length,
    binding: manifest.binding,
  };
}

async function main() {
  const command = process.argv[2];
  if (command === 'capture') {
    const output = (process.argv.find(arg => arg.startsWith('--output=')) || '').slice('--output='.length);
    const generatedAt = new Date().toISOString();
    const file = path.resolve(output || path.join(process.env.RUNNER_TEMP || process.cwd(), recoveryName(generatedAt)));
    const summary = await captureRecoveryPackage({
      env: backup.postgresEnvironment(process.env.TRACK_B_BACKUP_DATABASE_URL, 'syncview-track-b-recovery-capture'),
      corpusName: backup.configuredCorpus(), output: file, hmacInput: process.env.TRACK_B_BACKUP_HMAC_KEY,
      sourceUrl: process.env.TRACK_B_BACKUP_DATABASE_URL, generatedAt,
    });
    console.log(JSON.stringify({ ...summary, file_name: path.basename(file), uploaded: false, dormant: 'no Drive upload, schedule or alert exists for recovery packages' }));
    return;
  }
  if (command === 'verify') {
    const verified = readRecoveryPackage(fs.readFileSync(path.resolve(process.argv[3] || '')), process.env.TRACK_B_BACKUP_HMAC_KEY);
    console.log(JSON.stringify(summarize(verified.manifest)));
    return;
  }
  throw new Error('Usage: track-b-recovery-package.js capture [--output=file] | verify <file>');
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = {
  BODY_WRITE_KEYWORDS,
  DANGEROUS_CATALOG_FUNCTIONS,
  DANGEROUS_ROLE_MEMBERSHIPS,
  EGRESS_EXTENSIONS,
  EXTENSION_FUNCTION_CONTRACT,
  LEGACY_RECOVERY_VERSIONS,
  PLATFORM_ROLES,
  RECOVERY_FILE_PREFIX,
  RECOVERY_FORMAT,
  RECOVERY_MAGIC,
  RECOVERY_VERSION,
  REQUIRED_EXTENSION_ALLOWLIST,
  VOLATILE_EXTENSION_ALLOWLIST,
  bindingDigest,
  callNamesIn,
  callableResolutionSql,
  captureRecoveryPackage,
  classifyCallable,
  classifySchemaStatement,
  createdTables,
  dataDigestSql,
  dependencyEdgesSql,
  evaluateRecoveryWatch,
  evaluatedExpressionTexts,
  evaluatedSourceTextsSql,
  fingerprintSql,
  functionPurity,
  inTransactionVerificationSql,
  inventorySql,
  packRecoveryPackage,
  parseVerification,
  pgDumpSectionArgs,
  prerequisitesSql,
  readRecoveryPackage,
  reconstructSql,
  recoveryName,
  requiredExtensions,
  runPsql,
  sequenceStateSql,
  sequenceValueSql,
  sourcePreflightSql,
  splitSqlStatements,
  stripBlockComments,
  stripDollarQuoted,
  summarize,
  targetPrerequisiteSql,
  validateSchemaSection,
  validateSequenceState,
  verificationSql,
  verifyCallableContract,
  verifyReconstruction,
};
