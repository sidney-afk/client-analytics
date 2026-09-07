'use strict';
// Actual selected-source reader/auth/projection; finite Supabase transport only.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
function readFeedback(input) {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', __filename], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(run.status, 0, 'actual feedback reader failed: ' + (run.stderr || run.error || ''));
  return JSON.parse(run.stdout);
}
module.exports = { readFeedback };
async function child() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8')), reads = [], tables = input.tables;
  class Query {
    constructor(table) { assert(Object.hasOwn(tables, table), 'unmodeled table'); this.table = table; this.filters = []; this.orders = []; this.cap = Infinity; }
    select(columns, options = {}) { this.head = options.head; return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    order(key, options = {}) { this.orders.push([key, options.ascending !== false ? 1 : -1]); return this; }
    limit(value) { this.cap = value; return this; }
    maybeSingle() { this.single = true; return this; }
    or() { throw Error('cursor pagination outside finite fixture'); }
    insert() { throw Error('fixture forbids reader table writes'); }
    then(resolve, reject) {
      try {
        reads.push(this.table);
        const rows = structuredClone(tables[this.table].filter(row => this.filters.every(fn => fn(row))));
        rows.sort((a, b) => { for (const [key, direction] of this.orders) if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * direction; return 0; });
        return Promise.resolve({ data: this.head ? null : this.single ? rows.length === 1 ? rows[0] : null : rows.slice(0, this.cap), count: rows.length,
          error: this.single && rows.length > 1 ? { message: 'ambiguous fixture' } : null }).then(resolve, reject);
      } catch (error) { return Promise.reject(error).then(resolve, reject); }
    }
  }
  globalThis.__feedbackClient = () => ({ from: table => new Query(table), rpc: async name => {
    assert(['production_comment_read_budget_take', 'production_comment_read_authorize'].includes(name), 'unmodeled RPC');
    return { data: name === 'production_comment_read_authorize' ? { ok: true, authorized: true } : { ok: true, allowed: true }, error: null };
  } });
  let handler;
  const role = input.session === 'admin' ? 'ADMIN' : input.session === 'smm' ? 'SMM' : 'CREATIVE';
  globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional-service',
    ['ROLE_KEY_' + role]: 'fictional-lifecycle-key' }[name]) }, serve: fn => { handler = fn; } };
  globalThis.fetch = () => { throw Error('external transport forbidden'); };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-feedback-'));
  try {
    const entry = path.join(input.source, 'supabase/functions/production-comments/index.ts');
    const original = fs.readFileSync(entry, 'utf8'), authCopy = path.join(tmp, 'staff-role-auth.mts');
    fs.copyFileSync(path.join(input.source, 'supabase/functions/_shared/staff-role-auth.ts'), authCopy);
    const source = original.replace(/import \{ createClient, SupabaseClient \} from "npm:[^"]+";/,
      'const createClient = globalThis.__feedbackClient; type SupabaseClient = any;')
      .replace(/from "(\.\.?\/[^\"]+)"/g, (_all, relative) => 'from ' + JSON.stringify(pathToFileURL(
        relative === '../_shared/staff-role-auth.ts' ? authCopy : path.resolve(path.dirname(entry), relative)).href));
    assert.notEqual(source, original);
    const copied = path.join(tmp, 'handler.mts'); fs.writeFileSync(copied, source);
    await import(pathToFileURL(copied).href);
    const response = await handler(new Request('https://fixture.invalid', { method: 'POST', headers: input.headers, body: JSON.stringify(input.body) }));
    process.stdout.write(JSON.stringify({ status: response.status, body: await response.json(), reads }));
  } finally {
    const relative = path.relative(os.tmpdir(), tmp); assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
if (require.main === module) child().catch(error => { process.stderr.write(String(error.stack)); process.exitCode = 1; });
