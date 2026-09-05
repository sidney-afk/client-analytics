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
 *   data    = the selected Track-B corpus tables only; every other public
 *             table is reconstructed empty and listed as omitted;
 *   pinned  = roles, extensions (name/schema/version), non-public schemas and
 *             the realtime publication are PREREQUISITES verified on the
 *             target, never recreated by the package;
 *   coherence = pre-data, data and post-data dumps import ONE exported
 *             repeatable-read snapshot; a catalog fingerprint taken inside
 *             that snapshot must equal a fresh fingerprint taken after the
 *             dumps, otherwise the package is refused (DDL race fail-closed).
 *
 * The reconstruction executes only allowlisted DDL classes re-emitted from
 * the authenticated sections, inside one transaction, in the order
 * pre-data -> COPY -> sequence values -> post-data. Triggers, foreign keys and
 * policies therefore do not exist while rows are loaded: nothing fires, no
 * journal capture pollutes the restored journal, and no egress can occur.
 * Owner names are never restored; the restricted restore role owns everything.
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
const RECOVERY_VERSION = 1;
const RECOVERY_FILE_PREFIX = 'syncview-track-b-recovery-';
const HMAC_BYTES = backup.HMAC_BYTES;
const PLATFORM_ROLES = Object.freeze(['anon', 'authenticated', 'service_role']);
const REQUIRED_EXTENSION_ALLOWLIST = Object.freeze(['pgcrypto', 'uuid-ossp', 'pg_trgm', 'citext', 'btree_gist', 'btree_gin']);
const EGRESS_EXTENSIONS = Object.freeze(['pg_net', 'dblink', 'http', 'postgres_fdw', 'pg_cron']);
const EGRESS_BODY_PATTERN = /\b(net\.http_|dblink|pg_net|http_(?:post|get|put|delete)|pg_read_(?:binary_)?file|pg_execute_server_program|lo_import|lo_export)\b|\bcopy\b[^;]*\bprogram\b/i;
const SKIPPED_SESSION_SETTINGS = Object.freeze(['statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout', 'transaction_timeout']);
const ALLOWED_SESSION_SETTINGS = Object.freeze([...SKIPPED_SESSION_SETTINGS, 'client_encoding', 'standard_conforming_strings',
  'check_function_bodies', 'xmloption', 'client_min_messages', 'row_security', 'default_tablespace',
  'default_table_access_method', 'default_toast_compression']);
const IDENT = '(?:"[^"]+"|[a-z_][a-z0-9_]*)';

function clean(value) { return String(value == null ? '' : value).trim(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hmacSha256(key, value) { return crypto.createHmac('sha256', key).update(value).digest(); }
function u64(value) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(value)); return b; }

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
  let i = 0; let start = 0; let line = 1; let startLine = 1; let atLineStart = true;
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
      i = eol === -1 ? n : eol + 1; line += 1; start = i; startLine = line; atLineStart = true;
      continue;
    }
    if (ch === '\n') { line += 1; atLineStart = true; i += 1; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i += 1; continue; }
    if (text.startsWith('--', i)) { const eol = text.indexOf('\n', i); i = eol === -1 ? n : eol; if (text.slice(start, i).trim().startsWith('--') || text.slice(start, i).trim() === '') { start = i; startLine = line; } continue; }
    if (text.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (text.startsWith('/*', i)) { depth += 1; i += 2; } else if (text.startsWith('*/', i)) { depth -= 1; i += 2; } else { if (text[i] === '\n') line += 1; i += 1; }
      }
      if (depth > 0) throw new Error('Unterminated block comment in SQL section');
      if (text.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, '').trim() === '') { start = i; startLine = line; }
      continue;
    }
    atLineStart = false;
    if (text.slice(start, i).trim() === '') { start = i; startLine = line; }
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
    if (ch === ';') { push(i, 'statement'); i += 1; start = i; startLine = line; continue; }
    i += 1;
  }
  if (text.slice(start).trim()) throw new Error('SQL section ends inside an unterminated statement');
  return out;
}

function stripDollarQuoted(text) {
  const bodies = [];
  const stripped = text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, match => { bodies.push(match); return '$BODY$'; });
  return { stripped, bodies };
}

function normalizeRoleList(tail) {
  return clean(tail).split(',').map(item => clean(item).replace(/^"(.*)"$/, '$1'));
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
  const tests = [
    [new RegExp(`^SET (${ALLOWED_SESSION_SETTINGS.join('|')}) = [^;]{1,60}$`, 'i'), match => (
      SKIPPED_SESSION_SETTINGS.includes(match[1].toLowerCase()) ? { action: 'skip', kind: 'session_timeout_setting' } : { action: 'execute', kind: 'session_setting' })],
    [/^SELECT pg_catalog\.set_config\('search_path', '', false\)$/, () => ({ action: 'execute', kind: 'search_path_reset' })],
    [/^CREATE SCHEMA public$/i, () => ({ action: 'skip', kind: 'platform_schema' })],
    [/^COMMENT ON SCHEMA public IS /i, () => ({ action: 'skip', kind: 'platform_schema_comment' })],
    [/^(?:GRANT|REVOKE) [A-Z, ]+ ON SCHEMA public /i, () => ({ action: 'skip', kind: 'platform_schema_acl' })],
    [new RegExp(`^CREATE (?:UNLOGGED )?TABLE public\\.${IDENT} \\(`, 'i'), () => ({ action: 'execute', kind: 'table' })],
    [new RegExp(`^CREATE (?:UNIQUE )?INDEX ${IDENT} ON public\\.${IDENT} `, 'i'), () => ({ action: 'execute', kind: 'index' })],
    [new RegExp(`^CREATE SEQUENCE public\\.${IDENT}`, 'i'), () => ({ action: 'execute', kind: 'sequence' })],
    [new RegExp(`^ALTER SEQUENCE public\\.${IDENT} OWNED BY public\\.${IDENT}\\.${IDENT}$`, 'i'), () => ({ action: 'execute', kind: 'sequence_owner' })],
    [new RegExp(`^ALTER TABLE (?:ONLY )?public\\.${IDENT} ALTER COLUMN ${IDENT} (?:ADD GENERATED (?:ALWAYS|BY DEFAULT) AS IDENTITY|SET DEFAULT|SET NOT NULL|SET STATISTICS|SET STORAGE|SET \\()`, 'i'), () => ({ action: 'execute', kind: 'column_alter' })],
    [new RegExp(`^ALTER TABLE (?:ONLY )?public\\.${IDENT} ADD CONSTRAINT ${IDENT} (?:PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK|EXCLUDE)`, 'i'), () => ({ action: 'execute', kind: 'constraint' })],
    [new RegExp(`^ALTER TABLE (?:ONLY )?public\\.${IDENT} (?:ENABLE|FORCE) ROW LEVEL SECURITY$`, 'i'), () => ({ action: 'execute', kind: 'row_security' })],
    [new RegExp(`^ALTER TABLE (?:ONLY )?public\\.${IDENT} REPLICA IDENTITY `, 'i'), () => ({ action: 'execute', kind: 'replica_identity' })],
    [new RegExp(`^ALTER TABLE (?:ONLY )?public\\.${IDENT} (?:ENABLE|DISABLE) (?:ALWAYS |REPLICA )?TRIGGER ${IDENT}$`, 'i'), () => ({ action: 'execute', kind: 'trigger_state' })],
    [new RegExp(`^ALTER TABLE (?:ONLY )?public\\.${IDENT} CLUSTER ON ${IDENT}$`, 'i'), () => ({ action: 'execute', kind: 'cluster' })],
    [new RegExp(`^CREATE (?:OR REPLACE )?(?:FUNCTION|PROCEDURE) public\\.${IDENT}\\(`, 'i'), () => {
      const language = stripped.match(/\bLANGUAGE\s+([A-Za-z_]+)/i);
      if (!language || !/^(plpgsql|sql)$/i.test(language[1])) return { action: 'reject', kind: 'function_language' };
      if (/\bLANGUAGE\s+[A-Za-z_]+[\s\S]*\bLANGUAGE\s+/i.test(stripped)) return { action: 'reject', kind: 'function_language' };
      return { action: 'execute', kind: 'function', egress: bodies.some(body => EGRESS_BODY_PATTERN.test(body)) };
    }],
    [new RegExp(`^CREATE (?:CONSTRAINT )?TRIGGER ${IDENT} (?:BEFORE|AFTER|INSTEAD OF) (?:INSERT|UPDATE|DELETE|TRUNCATE)(?: OF ${IDENT}(?:, ${IDENT})*)?(?: OR (?:INSERT|UPDATE|DELETE|TRUNCATE)(?: OF ${IDENT}(?:, ${IDENT})*)?)* ON public\\.${IDENT} [\\s\\S]*EXECUTE (?:FUNCTION|PROCEDURE) public\\.${IDENT}\\(`, 'i'), () => ({ action: 'execute', kind: 'trigger' })],
    [new RegExp(`^CREATE POLICY ${IDENT} ON public\\.${IDENT} `, 'i'), match => {
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
    [new RegExp(`^(GRANT|REVOKE) (?:[A-Z]+(?:\\([^)]*\\))?(?:, ?)?)+ ON (?:TABLE|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE|TYPE|DOMAIN) public\\.${IDENT}[^;]* (TO|FROM) ([^;]+)$`, 'i'), match => {
      const tail = match[3].replace(/ WITH GRANT OPTION$/i, '');
      if (/ WITH GRANT OPTION$/i.test(match[3]) || /GRANTED BY/i.test(match[3])) return { action: 'reject', kind: 'grant_option' };
      return rolesAllowed(tail) ? { action: 'execute', kind: 'acl' } : { action: 'reject', kind: 'acl_role' };
    }],
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
    if (match) names.add(match[1].replace(/^"(.*)"$/, '$1'));
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
  'sequences', (select count(*) from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind='S'),
  'functions', (select count(*) from pg_catalog.pg_proc p where p.pronamespace='public'::regnamespace),
  'triggers', (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal),
  'disabled_triggers', (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal and t.tgenabled='D'),
  'policies', (select count(*) from pg_catalog.pg_policies p where p.schemaname='public'),
  'indexes', (select count(*) from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indrelid where c.relnamespace='public'::regnamespace),
  'constraints', (select count(*) from pg_catalog.pg_constraint c where c.connamespace='public'::regnamespace),
  'types', (select count(*) from pg_catalog.pg_type t where t.typnamespace='public'::regnamespace and t.typtype in ('e','d','r'))
)`;
}

function sequencesSql() {
  return `select coalesce(json_agg(json_build_object('name', sequencename, 'last_value', last_value, 'start_value', start_value, 'increment_by', increment_by, 'data_type', data_type::text) order by sequencename), '[]'::json)
from pg_catalog.pg_sequences where schemaname='public'`;
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
  if (manifest.format !== RECOVERY_FORMAT || manifest.recovery_version !== RECOVERY_VERSION) throw new Error('Unsupported Track-B recovery manifest');
  const corpus = backup.resolveCorpus(manifest.corpus);
  if (manifest.corpus_version !== corpus.version) throw new Error('Track-B recovery corpus does not match its version');
  if (clean(manifest.source_project_ref) !== backup.PRODUCTION_REF) throw new Error('Track-B recovery package is not a production capture');
  if (manifest.binding !== bindingDigest(manifest)) throw new Error('Track-B recovery schema/data binding mismatch');
  backup.authenticatedGeneratedAt(manifest, nowMs);
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
    if (!tables.has(config.name)) throw new Error(`Track-B recovery schema section does not create ${config.name}`);
  }
  if (Number(manifest.data.table_count) !== corpus.tables.length) throw new Error('Track-B recovery data table count mismatch');
  return { manifest, corpus: corpus.name, preData, postData, data, parsedData: parsed, schema: { pre, post } };
}

// ---------------------------------------------------------------------------
// Reconstruction SQL for an EMPTY target. One transaction; no TRUNCATE, DROP,
// CASCADE or owner assignment; prerequisites verified before any DDL.
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
  return `do $recovery_target$ declare v_count integer; v_role text; v_ext record; begin
  select count(*) into v_count from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','S','f','c','i','I','t');
  if v_count > 0 then raise exception 'Track-B recovery target is not empty'; end if;
  select count(*) into v_count from pg_catalog.pg_proc p where p.pronamespace='public'::regnamespace;
  if v_count > 0 then raise exception 'Track-B recovery target is not empty'; end if;
  select count(*) into v_count from pg_catalog.pg_type t where t.typnamespace='public'::regnamespace and t.typtype in ('e','d','r','c');
  if v_count > 0 then raise exception 'Track-B recovery target is not empty'; end if;
  if (select rolsuper or rolcreaterole or rolcreatedb from pg_catalog.pg_roles where rolname=current_user) then raise exception 'Track-B recovery role must be restricted'; end if;
  if not has_schema_privilege(current_user, 'public', 'CREATE') then raise exception 'Track-B recovery role lacks CREATE on public'; end if;
  foreach v_role in array array[${roles.map(sqlLiteral).join(',') || 'null::text'}]::text[] loop
    if v_role is not null and not exists(select 1 from pg_catalog.pg_roles where rolname=v_role) then raise exception 'Track-B recovery target lacks a required role'; end if;
  end loop;
  for v_ext in select * from (values ${extensions.map(item => `(${sqlLiteral(item.name)},${sqlLiteral(item.schema)},${sqlLiteral(item.version)})`).join(',') || "(null::text,null::text,null::text)"}) v(name, schema, version) loop
    if v_ext.name is not null and not exists(select 1 from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace
      where e.extname=v_ext.name and n.nspname=v_ext.schema and e.extversion=v_ext.version) then
      raise exception 'Track-B recovery target lacks a required extension'; end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_extension where extname in (${EGRESS_EXTENSIONS.map(sqlLiteral).join(',')})) then raise exception 'Track-B recovery target has an egress-capable extension'; end if;
  if exists(select 1 from pg_catalog.pg_foreign_server) then raise exception 'Track-B recovery target has a foreign server'; end if;
  if current_setting('server_version_num')::int / 10000 < ${major} then raise exception 'Track-B recovery target server is older than the source'; end if;
  ${realtime ? "if not exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then raise exception 'Track-B recovery target lacks the realtime publication'; end if;" : ''}
end $recovery_target$;`;
}

function sequenceValueSql(manifest) {
  const lines = [];
  for (const item of manifest.sequences || []) {
    const name = safeName(item.name, /^[a-z_][a-z0-9_]{0,62}$/, 'sequence name');
    if (item.last_value === null || item.last_value === undefined) continue;
    if (!/^-?\d{1,19}$/.test(String(item.last_value))) throw new Error('Unsafe sequence value in Track-B recovery manifest');
    lines.push(`select pg_catalog.setval('public.${name}', ${item.last_value}, true);`);
  }
  return lines;
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
    'commit;',
    '',
  ].join('\n');
}

function verificationSql(manifest) {
  const corpus = backup.resolveCorpus(manifest.corpus);
  const lines = [`select 'fingerprint' || E'\\t' || (${fingerprintSql()});`];
  for (const config of corpus.tables) lines.push(`select 'rows:${config.name}' || E'\\t' || count(*)::text from public.${config.name};`);
  lines.push(`select 'sequences' || E'\\t' || (${sequencesSql()})::text;`);
  lines.push("select 'egress_extensions' || E'\\t' || count(*)::text from pg_catalog.pg_extension where extname in (" + EGRESS_EXTENSIONS.map(sqlLiteral).join(',') + ');');
  lines.push("select 'foreign_servers' || E'\\t' || count(*)::text from pg_catalog.pg_foreign_server;");
  lines.push("select 'realtime_tables' || E'\\t' || count(*)::text from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public';");
  lines.push("select 'owner_is_current_user' || E'\\t' || (select bool_and(pg_get_userbyid(c.relowner)=current_user)::text from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','S'));");
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
    const expected = Number(manifest.data.tables[config.name].rows);
    if (Number(observed[`rows:${config.name}`]) !== expected) throw new Error(`Track-B recovery row-count mismatch for ${config.name}`);
    tables[config.name] = expected;
  }
  let sequences;
  try { sequences = JSON.parse(observed.sequences || '[]'); } catch (_) { throw new Error('Malformed Track-B recovery sequence verification'); }
  const expectedSequences = backup.canonicalJson((manifest.sequences || []).map(item => ({ name: item.name, last_value: item.last_value, start_value: item.start_value, increment_by: item.increment_by })));
  const observedSequences = backup.canonicalJson(sequences.map(item => ({ name: item.name, last_value: item.last_value, start_value: item.start_value, increment_by: item.increment_by })));
  if (expectedSequences !== observedSequences) throw new Error('Track-B recovery sequence state mismatch after reconstruction');
  if (observed.egress_extensions !== '0' || observed.foreign_servers !== '0') throw new Error('Track-B recovery target acquired an egress capability');
  if (observed.owner_is_current_user !== 'true') throw new Error('Track-B recovery objects are not owned by the restore role');
  const realtimeExpected = manifest.prerequisites && manifest.prerequisites.realtime_publication && Array.isArray(manifest.prerequisites.realtime_publication.tables)
    ? manifest.prerequisites.realtime_publication.tables.length : 0;
  return {
    corpus: corpus.name,
    schema_fingerprint_match: true,
    data_table_count: corpus.tables.length,
    omitted_data_table_count: (manifest.omitted_data_tables || []).length,
    sequence_count: sequences.length,
    tables,
    realtime_membership_expected: realtimeExpected,
    realtime_membership_restored: Number(observed.realtime_tables || 0),
    egress_capable_functions: Number(manifest.schema.egress_capable_functions || 0),
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
      : lastReconstruction.ok === true ? 'stale_package' : 'failed';
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
  const input = snapshot
    ? `begin isolation level repeatable read read only;\nset transaction snapshot ${sqlLiteral(snapshot)};\n${sql};\ncommit;\n`
    : `${sql};\n`;
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

async function captureRecoveryPackage({ env, corpusName, output, hmacInput, sourceUrl, generatedAt = new Date().toISOString(), sourceCommit = clean(process.env.GITHUB_SHA) || null, psql = 'psql', pgDump = 'pg_dump', tempDir = null, hooks = {} }) {
  const corpus = backup.resolveCorpus(corpusName);
  const key = backup.parseHmacKey(hmacInput);
  const sourceRef = backup.assertProductionSource(sourceUrl);
  const preflight = runPsql(env, sourcePreflightSql(corpus.name), { psql });
  if (!/source_preflight_ok/.test(preflight)) throw new Error('Track-B recovery source preflight did not confirm');
  const dir = tempDir || fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'track-b-recovery-'));
  const files = { pre: path.join(dir, 'pre-data.sql'), post: path.join(dir, 'post-data.sql'), data: path.join(dir, 'data.sql') };
  const session = await openSnapshotSession(env, psql);
  let fingerprintBefore; let inventory; let sequences; let prerequisites;
  try {
    fingerprintBefore = runPsql(env, fingerprintSql(), { psql, snapshot: session.snapshot });
    inventory = JSON.parse(runPsql(env, inventorySql(), { psql, snapshot: session.snapshot }));
    sequences = JSON.parse(runPsql(env, sequencesSql(), { psql, snapshot: session.snapshot }));
    prerequisites = JSON.parse(runPsql(env, prerequisitesSql(), { psql, snapshot: session.snapshot }));
    for (const section of ['pre-data', 'data', 'post-data']) {
      const target = section === 'pre-data' ? files.pre : section === 'post-data' ? files.post : files.data;
      const result = spawnSync(pgDump, pgDumpSectionArgs(section, target, corpus.name, session.snapshot), { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
      if (result.error || result.status !== 0) throw opaque(`Track-B recovery ${section} dump`, result);
    }
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
  const pre = validateSchemaSection(preData.toString('utf8'), roles);
  const post = validateSchemaSection(postData.toString('utf8'), roles);
  const inspected = backup.inspectPlainDump(data, corpus.name);
  const corpusNames = new Set(corpus.tables.map(config => config.name));
  const omitted = (inventory.tables || []).filter(name => !corpusNames.has(name));
  const manifest = {
    format: RECOVERY_FORMAT,
    recovery_version: RECOVERY_VERSION,
    corpus: corpus.name,
    corpus_version: corpus.version,
    generated_at: generatedAt,
    completed_at: new Date().toISOString(),
    source_project_ref: sourceRef,
    source_commit: sourceCommit,
    snapshot_isolation: 'repeatable read read only; exported snapshot shared by catalog reads and all three dumps',
    pg_dump_version: clean((spawnSync(pgDump, ['--version'], { encoding: 'utf8' }).stdout || '').replace(/^pg_dump \(PostgreSQL\) /, '')) || null,
    schema: {
      fingerprint: fingerprintBefore,
      inventory: { ...inventory, tables: (inventory.tables || []).length },
      pre_data: { statements: pre.statements.length, skipped_platform_statements: pre.skipped },
      post_data: { statements: post.statements.length, skipped_platform_statements: post.skipped },
      statement_inventory: Object.fromEntries(Object.entries({ ...pre.inventory }).concat(Object.entries(post.inventory).map(([k, v]) => [k, (pre.inventory[k] || 0) + v]))),
      egress_capable_functions: pre.egress_capable_functions + post.egress_capable_functions,
    },
    data: { table_count: corpus.tables.length, tables: inspected },
    omitted_data_tables: omitted,
    sequences,
    prerequisites: {
      server_version: prerequisites.server_version,
      server_version_num: prerequisites.server_version_num,
      roles,
      required_extensions: requiredExtensions(prerequisites.extensions),
      observed_extensions: prerequisites.extensions,
      schemas: prerequisites.schemas,
      realtime_publication: prerequisites.realtime_publication,
      foreign_servers: prerequisites.foreign_servers,
    },
  };
  if (Number(prerequisites.foreign_servers) > 0) throw new Error('Track-B recovery source has a foreign server; capture refused');
  const packed = packRecoveryPackage({ preData, postData, data, manifest }, key.toString('base64'));
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), packed.bytes, { mode: 0o600 });
  const verified = readRecoveryPackage(fs.readFileSync(path.resolve(output)), key.toString('base64'));
  return summarize(verified.manifest, packed.bytes);
}

function summarize(manifest, bytes = null) {
  return {
    ok: true,
    format: manifest.format,
    corpus: manifest.corpus,
    generated_at: manifest.generated_at,
    package_sha256: bytes ? sha256(bytes) : undefined,
    schema_fingerprint: manifest.schema.fingerprint,
    schema_statements: manifest.schema.pre_data.statements + manifest.schema.post_data.statements,
    data_table_count: manifest.data.table_count,
    omitted_data_table_count: (manifest.omitted_data_tables || []).length,
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
  EGRESS_EXTENSIONS,
  PLATFORM_ROLES,
  RECOVERY_FILE_PREFIX,
  RECOVERY_FORMAT,
  RECOVERY_MAGIC,
  RECOVERY_VERSION,
  REQUIRED_EXTENSION_ALLOWLIST,
  bindingDigest,
  captureRecoveryPackage,
  classifySchemaStatement,
  createdTables,
  evaluateRecoveryWatch,
  fingerprintSql,
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
  sequenceValueSql,
  sequencesSql,
  sourcePreflightSql,
  splitSqlStatements,
  stripDollarQuoted,
  summarize,
  targetPrerequisiteSql,
  validateSchemaSection,
  verificationSql,
  verifyReconstruction,
};
