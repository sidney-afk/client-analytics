'use strict';
// A strict supabase-js-shaped seam over the disposable PostgreSQL. Only the
// builder methods the two Edge Functions actually use exist; anything else
// throws so the lane cannot silently succeed on an unmodelled call. Every
// statement runs through psql against the real tables and RPCs.
const assert = require('node:assert/strict');
const { lit, ident } = require('./pg');

function pgError(error) {
  const message = String(error && error.message || error || 'query failed').replace(/^ERROR:\s*/m, '').split('\n')[0].trim();
  const code = /duplicate key value violates unique constraint/.test(message) ? '23505'
    : /violates check constraint/.test(message) ? '23514' : /violates not-null constraint/.test(message) ? '23502' : 'XX000';
  return { message, code, details: null, hint: null };
}
function parseOr(expr) {
  // PostgREST `a.eq.x,b.eq.y`; only eq alternatives are used by the handlers.
  return expr.split(',').map(part => {
    const [column, op, ...rest] = part.split('.');
    assert.equal(op, 'eq', 'unsupported or() operator: ' + op);
    return `${ident(column)} = ${lit(rest.join('.'))}`;
  }).join(' or ');
}
function columns(select) {
  const text = String(select == null ? '*' : select).replace(/\s+/g, '');
  if (text === '' || text === '*') return '*';
  return text.split(',').map(c => { assert.match(c, /^[a-z_][a-z0-9_]*$/, 'select column ' + c); return ident(c); }).join(', ');
}
class Query {
  constructor(seam, table) { this.seam = seam; this.table = table; this.filters = []; this.orderBy = []; this.max = null; this.mode = 'select'; this.cols = '*'; this.payload = null; }
  select(cols) { if (this.mode === 'select') this.cols = columns(cols); return this; }
  eq(c, v) { this.filters.push(`${ident(c)} = ${lit(v)}`); return this; }
  neq(c, v) { this.filters.push(`${ident(c)} <> ${lit(v)}`); return this; }
  in(c, vs) { this.filters.push(vs.length ? `${ident(c)} in (${vs.map(lit).join(', ')})` : 'false'); return this; }
  is(c, v) { assert.equal(v, null, 'is() supports null only'); this.filters.push(`${ident(c)} is null`); return this; }
  gte(c, v) { this.filters.push(`${ident(c)} >= ${lit(v)}`); return this; }
  lte(c, v) { this.filters.push(`${ident(c)} <= ${lit(v)}`); return this; }
  gt(c, v) { this.filters.push(`${ident(c)} > ${lit(v)}`); return this; }
  lt(c, v) { this.filters.push(`${ident(c)} < ${lit(v)}`); return this; }
  or(expr) { this.filters.push('(' + parseOr(expr) + ')'); return this; }
  order(c, opts) { this.orderBy.push(`${ident(c)} ${opts && opts.ascending === false ? 'desc' : 'asc'}`); return this; }
  limit(n) { this.max = Number(n); return this; }
  insert(rows) { this.mode = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch) { this.mode = 'update'; this.payload = patch; return this; }
  upsert() { throw new Error('seam_unsupported_upsert:' + this.table); }
  delete() { throw new Error('seam_unsupported_delete:' + this.table); }
  sql() {
    const where = this.filters.length ? ' where ' + this.filters.join(' and ') : '';
    if (this.mode === 'select') {
      return `select ${this.cols} from public.${ident(this.table)}${where}${this.orderBy.length ? ' order by ' + this.orderBy.join(', ') : ''}${this.max != null ? ' limit ' + this.max : ''}`;
    }
    if (this.mode === 'insert') {
      return `insert into public.${ident(this.table)} select * from jsonb_populate_recordset(null::public.${ident(this.table)}, ${lit(this.payload)})`;
    }
    const sets = Object.entries(this.payload).map(([k, v]) => `${ident(k)} = ${lit(v)}`).join(', ');
    assert.ok(this.filters.length, 'update requires a filter');
    return `update public.${ident(this.table)} set ${sets}${where}`;
  }
  async execute() {
    const sql = this.sql();
    this.seam.calls.push({ kind: this.mode, table: this.table, sql });
    try {
      if (this.mode === 'select') return { data: this.seam.db.rows(sql), error: null };
      this.seam.db.run(sql);
      return { data: null, error: null };
    } catch (error) { const failure = pgError(error); this.seam.calls[this.seam.calls.length - 1].error = failure; return { data: null, error: failure }; }
  }
  async maybeSingle() {
    const result = await this.execute();
    if (result.error) return result;
    if (result.data.length > 1) return { data: null, error: { message: 'multiple_rows', code: 'PGRST116' } };
    return { data: result.data[0] || null, error: null };
  }
  async single() {
    const result = await this.maybeSingle();
    if (!result.error && !result.data) return { data: null, error: { message: 'no_rows', code: 'PGRST116' } };
    return result;
  }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}
class PgSupabase {
  constructor(db) { this.db = db; this.calls = []; this.retset = new Map(); }
  from(table) { assert.match(table, /^[a-z_][a-z0-9_]*$/); return new Query(this, table); }
  async rpc(name, args) {
    assert.match(name, /^[a-z_][a-z0-9_]*$/);
    const named = Object.entries(args || {}).map(([k, v]) => `${ident(k)} := ${lit(v)}`).join(', ');
    this.calls.push({ kind: 'rpc', name, args: JSON.parse(JSON.stringify(args || {})) });
    try {
      if (!this.retset.has(name)) {
        this.retset.set(name, this.db.scalar(`select coalesce((select proretset from pg_proc where proname = ${lit(name)} and pronamespace = 'public'::regnamespace limit 1), false)`) === true);
      }
      const rows = this.db.rows(`select to_jsonb(r) as value from public.${ident(name)}(${named}) r`).map(row => row.value);
      return { data: this.retset.get(name) ? rows : (rows.length ? rows[0] : null), error: null };
    } catch (error) { return { data: null, error: pgError(error) }; }
  }
}
module.exports = { PgSupabase, pgError };
