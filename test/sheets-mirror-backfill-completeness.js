'use strict';
// Execute the real copy script in a child whose every transport is mocked.
// A later valid chunk must never certify a rejected or unacknowledged one.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
let checks = 0;
function run(mode, dataset = 'metrics', apply = true) {
  const child = String.raw`
    const path = require('node:path');
    const mode = process.argv[1], dataset = process.argv[2], apply = process.argv[3] === 'true';
    process.argv = [process.execPath, path.resolve('scripts/sheets-mirror-backfill.js'), '--datasets=' + dataset, ...(apply ? ['--apply'] : [])];
    process.env.ANALYTICS_MIRROR_WRITE_KEY = 'synthetic-marker-'.repeat(3);
    const rows = Array.from({ length: dataset === 'metrics' ? 2001 : 1 }, (_, i) =>
      [mode === 'invalid' && i === 0 ? 'bad-date' : '2026-10-02', 'Synthetic', String(i)]);
    if (mode === 'blank') rows.unshift(['2026-10-02', '', '0']);
    const csv = ['date,client_name,ig_followers', ...rows.map(r => r.join(','))].join('\n');
    let sends = 0;
    global.fetch = async (url, options) => {
      if (!options && String(url).includes('/gviz/tq?')) return { ok: true, text: async () => csv };
      if (!options || !String(url).endsWith('/functions/v1/analytics-write')) throw new Error('unexpected mocked transport');
      const b = JSON.parse(options.body);
      sends++;
      console.log('MOCK_SEND ' + JSON.stringify({ part: b.run_part, rows: b.rows.length, complete: b.complete, full_snapshot: b.full_snapshot }));
      const answer = { ok: true, rows_received: b.rows.length, rows_written: b.rows.length, rejected: [] };
      if (sends === 1 && mode === 'server-reject') answer.rejected = [{ index: 0, reason: 'bad_date' }];
      if (sends === 1 && mode === 'short-received') answer.rows_received--;
      if (sends === 1 && mode === 'short-written') answer.rows_written--;
      if (sends === 1 && mode === 'missing-rejected') delete answer.rejected;
      if (mode === 'profile-skip') answer.rows_written = 0;
      return { ok: true, json: async () => answer };
    };
    require(path.resolve('scripts/sheets-mirror-backfill.js'));
  `;
  const r = spawnSync(process.execPath, ['-e', child, mode, dataset, String(apply)], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  assert.ifError(r.error);
  const sends = r.stdout.split(/\r?\n/).filter(s => s.startsWith('MOCK_SEND ')).map(s => JSON.parse(s.slice(10)));
  return { ...r, sends };
}

let r = run('invalid');
assert.equal(r.status, 1, 'a local invalid row fails APPLY');
assert.equal(r.sends.length, 0, 'local rejection in the first chunk prevents every send');
checks += 2;
r = run('invalid', 'metrics', false);
assert.equal(r.status, 0, 'dry run still counts rejected rows');
assert.equal(r.sends.length, 0, 'dry run makes no write request');
assert.match(r.stdout, /1 rejected/, 'dry run reports the rejected row');
checks += 3;

for (const mode of ['server-reject', 'short-received', 'short-written', 'missing-rejected']) {
  r = run(mode);
  assert.equal(r.status, 1, mode + ': partial acknowledgement fails');
  assert.equal(r.sends.length, 1, mode + ': no subsequent chunk sent');
  assert.equal(r.sends[0].full_snapshot, false, mode + ': no whole-dataset receipt sent');
  checks += 3;
}

for (const mode of ['valid', 'blank']) {
  r = run(mode);
  assert.equal(r.status, 0, mode + ': valid copy succeeds');
  assert.deepEqual(r.sends, [
    { part: 0, rows: 2000, complete: false, full_snapshot: false },
    { part: 1, rows: 1, complete: true, full_snapshot: true },
  ], mode + ': only the acknowledged final part certifies the whole copy');
  checks += 2;
}
r = run('profile-skip', 'client_profiles');
assert.equal(r.status, 0, 'unchanged profile edits may legitimately skip writes');
assert.equal(r.sends.length, 1, 'profile copy is one complete part');
checks += 2;
console.log(`sheets-mirror-backfill-completeness: ${checks} checks passed`);
