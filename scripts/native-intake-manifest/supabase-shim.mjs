/*
 * A translating stand-in for @supabase/supabase-js, so the REAL
 * production-write handler can run in Node against the disposable PostgreSQL.
 *
 * Every builder chain becomes one SQL statement executed in its own psql
 * process : which is exactly PostgREST's contract (one request, one
 * transaction, no session state). `.rpc()` calls the real database function.
 * That is the whole point: the handler's pre-write reads, its RPC commits and
 * its post-commit re-reads run against the same rows and locks the live
 * gateway would, with only the HTTP transport replaced.
 *
 * Fault injection lives here too, because the persistence boundary is where
 * the interesting failures are: a hook can drop the response of a committed
 * RPC, fail the Nth write, or hold two callers at a barrier so they reach the
 * database together.
 *
 * Deliberately narrow. Anything the intake/append/fill paths do not use throws
 * `shim_unsupported:<method>` so a silent mistranslation cannot pass as data.
 */
import { spawn } from 'node:child_process';

const ENV = {
  host: process.env.NIR_PGHOST, port: process.env.NIR_PGPORT,
  user: process.env.NIR_PGUSER, db: process.env.NIR_PGDATABASE,
  psql: process.env.NIR_PSQL || 'psql',
};

export const hooks = {
  /* async (name, args) => void  : runs before each rpc */
  beforeRpc: null,
  /* (name, args, result) => result|throw : runs after a successful rpc */
  afterRpc: null,
  log: [],
};

export function resetHooks() {
  hooks.beforeRpc = null;
  hooks.afterRpc = null;
  hooks.log.length = 0;
}

function lit(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'object') return "'" + JSON.stringify(value).replace(/'/g, "''") + "'::jsonb";
  return "'" + String(value).replace(/'/g, "''") + "'";
}
function ident(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(name))) throw new Error('shim_bad_identifier:' + name);
  return '"' + name + '"';
}

export function runSql(sql) {
  return new Promise(resolve => {
    const args = ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A',
      '-h', ENV.host, '-p', ENV.port, '-U', ENV.user, '-d', ENV.db];
    const child = spawn(ENV.psql, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
    child.stdin.end('\\set VERBOSITY verbose\nset time zone \'UTC\';\n' + sql + '\n');
  });
}

function pgError(stderr) {
  const match = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(stderr || '');
  if (match) return { code: match[1], message: match[2].trim(), details: '', hint: '' };
  return { code: 'XX000', message: String(stderr || 'psql failed').trim().slice(0, 300), details: '', hint: '' };
}

class Builder {
  constructor(table) {
    this.table = table;
    this.op = 'select';
    this.columns = '*';
    this.filters = [];
    this.orderBy = null;
    this.limitN = null;
    this.mode = 'many';
    this.payload = null;
  }
  select(columns = '*') {
    if (this.op === 'select') this.columns = String(columns || '*').replace(/\s+/g, '');
    if (/[()!]/.test(this.columns)) throw new Error('shim_unsupported:embedded_select');
    return this;
  }
  eq(col, val) { this.filters.push({ col, op: 'eq', val }); return this; }
  neq(col, val) { this.filters.push({ col, op: 'neq', val }); return this; }
  gte(col, val) { this.filters.push({ col, op: 'gte', val }); return this; }
  in(col, vals) { this.filters.push({ col, op: 'in', val: vals }); return this; }
  is(col, val) { this.filters.push({ col, op: 'is', val }); return this; }
  not(col, op, val) { this.filters.push({ col, op: 'not_' + op, val }); return this; }
  filter(col, op, val) { this.filters.push({ col, op, val }); return this; }
  or() { throw new Error('shim_unsupported:or'); }
  order(col, options = {}) { this.orderBy = { col, asc: options.ascending !== false }; return this; }
  limit(n) { this.limitN = Number(n); return this; }
  maybeSingle() { this.mode = 'maybeSingle'; return this; }
  single() { this.mode = 'single'; return this; }
  insert(payload) { this.op = 'insert'; this.payload = payload; return this; }
  update(payload) { this.op = 'update'; this.payload = payload; return this; }
  upsert() { throw new Error('shim_unsupported:upsert'); }
  delete() { throw new Error('shim_unsupported:delete'); }

  where(alias) {
    if (!this.filters.length) return '';
    const parts = this.filters.map(f => {
      const c = alias + '.' + ident(f.col);
      switch (f.op) {
        case 'eq': return f.val === null || f.val === undefined ? c + ' is null' : c + ' = ' + lit(f.val);
        case 'neq': return c + ' <> ' + lit(f.val);
        case 'gte': return c + ' >= ' + lit(f.val);
        case 'in': return Array.isArray(f.val) && f.val.length
          ? c + ' = any(array[' + f.val.map(lit).join(',') + '])' : 'false';
        case 'is': return f.val === null ? c + ' is null' : c + ' is ' + lit(f.val);
        case 'not_is': return f.val === null ? c + ' is not null' : c + ' is not ' + lit(f.val);
        default: throw new Error('shim_unsupported:filter_' + f.op);
      }
    });
    return ' where ' + parts.join(' and ');
  }

  sql() {
    const t = 'public.' + ident(this.table);
    if (this.op === 'select') {
      const cols = this.columns === '*' ? 't.*' : this.columns.split(',').map(c => 't.' + ident(c)).join(', ');
      let q = 'select ' + cols + ' from ' + t + ' t' + this.where('t');
      if (this.orderBy) q += ' order by t.' + ident(this.orderBy.col) + (this.orderBy.asc ? ' asc' : ' desc');
      if (this.limitN != null) q += ' limit ' + this.limitN;
      return "select coalesce(json_agg(row_to_json(q)), '[]'::json) from (" + q + ') q;';
    }
    if (this.op === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
      const list = keys.map(ident).join(', ');
      return 'insert into ' + t + ' (' + list + ') select ' + list
        + ' from json_populate_recordset(null::' + t + ', ' + lit(rows).replace('::jsonb', '::json') + ');';
    }
    if (this.op === 'update') {
      const keys = Object.keys(this.payload);
      const sets = keys.map(k => ident(k) + ' = r.' + ident(k)).join(', ');
      return 'update ' + t + ' as t set ' + sets + ' from json_populate_record(null::' + t + ', '
        + lit(this.payload).replace('::jsonb', '::json') + ') r' + this.where('t') + ';';
    }
    throw new Error('shim_unsupported:' + this.op);
  }

  async execute() {
    const sql = this.sql();
    hooks.log.push({ kind: this.op, table: this.table });
    const r = await runSql(sql);
    if (r.status !== 0) return { data: null, error: pgError(r.stderr), status: 400 };
    if (this.op !== 'select') return { data: null, error: null, status: 204 };
    const rows = r.stdout.trim() ? JSON.parse(r.stdout.trim()) : [];
    if (this.mode === 'maybeSingle') {
      if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
      return { data: rows[0] || null, error: null };
    }
    if (this.mode === 'single') {
      if (rows.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

class ShimClient {
  from(table) { return new Builder(table); }
  async rpc(name, args = {}) {
    if (hooks.beforeRpc) await hooks.beforeRpc(name, args);
    hooks.log.push({ kind: 'rpc', name });
    const named = Object.entries(args).map(([k, v]) => ident(k) + ' => ' + lit(v)).join(', ');
    const r = await runSql('select to_json(public.' + ident(name) + '(' + named + '));');
    if (r.status !== 0) return { data: null, error: pgError(r.stderr) };
    const data = r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null;
    if (hooks.afterRpc) return hooks.afterRpc(name, args, { data, error: null });
    return { data, error: null };
  }
}

export class SupabaseClient {}
export function createClient() { return new ShimClient(); }
