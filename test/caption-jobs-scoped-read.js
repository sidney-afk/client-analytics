'use strict';
// Run the real GET branch against a query fake that implements the database's
// filter/order/limit semantics. No network, database, or mutation is reachable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const J = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/caption-jobs/jobs.mjs')).href);
  const source = fs.readFileSync(process.env.DIGGER_CAPTION_SOURCE || path.join(ROOT, 'supabase/functions/caption-jobs/index.ts'), 'utf8');
  const begin = source.indexOf('if (req.method === "GET") {');
  const end = source.indexOf('    const body = await req.json()', begin);
  assert(begin >= 0 && end > begin, 'actual GET branch found');
  const run = new Function('req', 'db', 'clean', 'selectJobs', 'STATUS_LIMIT', 'json', 'Date',
    'return (async () => { ' + source.slice(begin, end) + ' })();');
  const now = Date.parse('2026-10-02T12:00:00Z');
  const row = (id, post, ago, client = 'fixture-client') => ({ job_id: id, post_id: post, client, updated_at: new Date(now - ago).toISOString(), status: 'running' });
  const rows = Array.from({ length: 201 }, (_, i) => row('new-' + i, 'other-post', i * 1000));
  rows.push(row('held-job', 'held-post', 30 * 3600000));
  rows.push(row('held-post-recent', 'held-post', 2 * 3600000));
  rows.push(row('held-job', 'held-post', 0, 'unrelated-fixture'));
  let checks = 0;
  async function get(params, fail = false) {
    const operations = [];
    const db = { from(table) {
      assert.equal(table, 'caption_jobs');
      const filters = [];
      let cap = Infinity;
      const q = {
        select() { return q; },
        eq(k, v) { filters.push([k, v]); operations.push('eq:' + k); return q; },
        order() { return q; },
        limit(v) { cap = v; operations.push('limit'); return q; },
        then(resolve, reject) {
          const data = rows.filter(r => filters.every(([k, v]) => r[k] === v))
            .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, cap);
          return Promise.resolve({ data, error: fail ? new Error('read_failed') : null }).then(resolve, reject);
        },
      };
      return q;
    } };
    const req = { method: 'GET', url: 'https://example.test/caption-jobs?' + new URLSearchParams(params) };
    const result = await run(req, db, v => String(v || '').trim(), J.selectJobs, J.STATUS_LIMIT, x => x, { now: () => now });
    return { result, operations };
  }
  let r = await get({ client: 'fixture-client', jobId: 'held-job' });
  assert.deepEqual(r.result.jobs.map(j => j.jobId), ['held-job'], 'explicit old job remains reachable after 200 newer jobs'); checks++;
  assert(r.operations.indexOf('eq:job_id') < r.operations.indexOf('limit'), 'job filter precedes cap'); checks++;
  r = await get({ client: 'fixture-client', postId: 'held-post' });
  assert.deepEqual(r.result.jobs.map(j => j.jobId), ['held-post-recent'], 'post filter precedes cap while keeping the 24-hour window'); checks++;
  assert(r.operations.indexOf('eq:post_id') < r.operations.indexOf('limit')); checks++;
  r = await get({ client: 'fixture-client', jobId: 'held-job', postId: 'other-post' });
  assert.deepEqual(r.result.jobs, [], 'both filters must match within the named client'); checks++;
  r = await get({ client: 'fixture-client' });
  assert.equal(r.result.jobs.length, 200, 'unfiltered latest-200 contract remains'); checks++;
  r = await get({ jobId: 'held-job' });
  assert.deepEqual(r.result.jobs, [], 'missing client reads nothing'); checks++;
  assert.deepEqual(r.operations, []); checks++;
  await assert.rejects(() => get({ client: 'fixture-client', jobId: 'held-job' }, true), /read_failed/); checks++;
  console.log(`caption-jobs-scoped-read: ${checks} checks passed; offline only`);
})().catch(e => { console.error(e); process.exitCode = 1; });
