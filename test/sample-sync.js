'use strict';
/*
 * sample-sync.js — the dawn check's "samples agree with their work items" count
 * (qa/dawn/sample-sync.js). Offline, made-up rows only.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stuckSamples, readSampleSync, SAMPLE_STATUS_FOR, GRACE_MINUTES } = require('../qa/dawn/sample-sync.js');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const NOW = Date.parse('2026-10-01T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const sample = (o) => Object.assign({ status: 'In Progress', video_status: 'In Progress', graphic_status: 'In Progress',
  video_status_at: ago(600), graphic_status_at: ago(600), video_deliverable_id: null, graphic_deliverable_id: null }, o);
const wi = (id, status, atMin) => ({ id, status, status_at: ago(atMin) });
const run = (samples, workItems) => stuckSamples({ samples, workItems, now: NOW });
const counts = (r) => `${r.samples}/${r.compared}/${r.stuck}/${r.stuckSamples}/${r.held}/${r.sampleAhead}`;

// Agreement is not a finding.
ok(counts(run([sample({ video_deliverable_id: 'w1', video_status: 'Kasper Approval' })], [wi('w1', 'kasper_approval', 300)])) === '1/1/0/0/0/0', 'a sample that agrees with its work item is not stuck');
ok(run([sample({ video_deliverable_id: 'w1' })], [wi('w1', 'backlog', 300)]).stuck === 0, 'backlog and todo read as In Progress, the way the page reads them');

// The case from 2026-10-01: the work item moved, the sample's own record did not.
const stuck1 = run([sample({ video_deliverable_id: 'w1', video_status: 'In Progress', video_status_at: ago(600) })], [wi('w1', 'kasper_approval', 120)]);
ok(counts(stuck1) === '1/1/1/1/0/0', 'a work item ahead of its sample for longer than the grace period is stuck');
ok(run([sample({ video_deliverable_id: 'w1', video_status: 'Kasper Approval', video_status_at: ago(600) })], [wi('w1', 'client_approval', 120)]).stuck === 1, 'Kasper approved on the work item but not on the sample is stuck');
ok(run([sample({ video_deliverable_id: 'w1', video_status: 'Client Approval', video_status_at: ago(600) })], [wi('w1', 'tweak', 120)]).stuck === 1, 'changes requested on the work item but not on the sample is stuck');

// A save in flight is not stuck yet.
const inflight = run([sample({ video_deliverable_id: 'w1' })], [wi('w1', 'kasper_approval', GRACE_MINUTES - 5)]);
ok(inflight.stuck === 0 && inflight.held === 1, 'a disagreement younger than the grace period is held, not reported');
ok(run([sample({ video_deliverable_id: 'w1' })], [wi('w1', 'kasper_approval', GRACE_MINUTES + 5)]).stuck === 1, 'the same disagreement just past the grace period is reported');

// The other direction is a different problem and is not reported as stuck.
const ahead = run([sample({ video_deliverable_id: 'w1', video_status: 'Client Approval', video_status_at: ago(10) })], [wi('w1', 'kasper_approval', 600)]);
ok(ahead.stuck === 0 && ahead.sampleAhead === 1, 'a sample newer than its work item is counted apart, not as stuck');
ok(run([sample({ video_deliverable_id: 'w1', video_status_at: null })], [wi('w1', 'kasper_approval', 120)]).stuck === 1, 'a sample with no status stamp is treated as behind');
ok(run([sample({ video_deliverable_id: 'w1', video_status: null })], [wi('w1', 'in_progress', 120)]).stuck === 1, 'a sample with no status at all, behind a live work item, is stuck');

// Things that are left out.
ok(run([sample({ status: 'Archived', video_deliverable_id: 'w1' })], [wi('w1', 'approved', 600)]).samples === 0, 'archived samples are left out');
ok(run([sample({ video_deliverable_id: null })], [wi('w1', 'approved', 600)]).compared === 0, 'a component with no work item is left out');
ok(run([sample({ video_deliverable_id: 'gone' })], [wi('w1', 'approved', 600)]).compared === 0, 'a work item that cannot be read is left out, not guessed');
for (const s of ['canceled', 'duplicate', 'triage', 'scheduled', 'posted', '', 'unknown']) {
  ok(run([sample({ video_deliverable_id: 'w1' })], [wi('w1', s, 600)]).compared === 0, `a work item at "${s}" has no sample equivalent and is left out`);
}

// Counting: components and samples are counted apart.
const both = run([
  sample({ video_deliverable_id: 'v', graphic_deliverable_id: 'g' }),
  sample({ video_deliverable_id: 'v2', video_status: 'Approved' }),
], [wi('v', 'kasper_approval', 120), wi('g', 'client_approval', 120), wi('v2', 'approved', 120)]);
ok(counts(both) === '2/3/2/1/0/0', 'two stuck components in one sample count as 2 components and 1 sample');
ok(Object.keys(both).sort().join() === 'compared,held,sampleAhead,samples,stuck,stuckSamples', 'only counts leave the module (the dawn report is public)');

// Parity with the page: the mapping is a mirror of _calMapNativeStatusStrict(…, 'samples').
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '134-calendar-prefs-mount.js.part'), 'utf8');
const m = src.match(/function _calMapNativeStatusStrict\(status, origin\) \{[\s\S]*?\n    \}\n/);
ok(!!m, 'the page mapping function is found in its fragment');
const page = new Function(m[0] + '\nreturn _calMapNativeStatusStrict;')();
const every = Object.keys(SAMPLE_STATUS_FOR).concat(['canceled', 'duplicate', 'triage', 'scheduled', 'posted', '', 'unknown']);
for (const s of every) ok((page(s, 'samples') || undefined) === SAMPLE_STATUS_FOR[s], `the page and this check agree on "${s}"`);

// The live read: paging, chunking, no names, failures throw.
(async () => {
  const urls = [];
  const many = Array.from({ length: 1500 }, (_, i) => sample({ video_deliverable_id: 'w' + i, graphic_deliverable_id: 'g' + i }));
  const fetchOk = async (url) => {
    urls.push(url);
    if (url.includes('/sample_reviews?')) {
      const off = Number((url.match(/offset=(\d+)/) || [])[1] || 0);
      return { ok: true, json: async () => many.slice(off, off + 1000) };
    }
    const ids = decodeURIComponent((url.match(/id=in\.\(([^)]*)\)/) || [])[1] || '').split(',');
    return { ok: true, json: async () => ids.map(id => wi(id, 'in_progress', 600)) };
  };
  const r = await readSampleSync({ supa: 'https://example.invalid', key: 'k', fetchImpl: fetchOk, now: NOW });
  ok(r.samples === 1500 && r.compared === 3000 && r.stuck === 0, 'the live read pages through every sample and every work item');
  ok(urls.filter(u => u.includes('/sample_reviews?')).length === 2, 'samples are read in pages of 1,000');
  ok(urls.filter(u => u.includes('production_deliverables_browser_v1')).length === Math.ceil(3000 / 80), 'work items are read in chunks, by id, from the browser view');
  ok(urls.every(u => u.includes('status=neq.Archived') || u.includes('production_deliverables_browser_v1')), 'archived samples are never read');
  let threw = false;
  try { await readSampleSync({ supa: 'https://example.invalid', key: 'k', fetchImpl: async () => ({ ok: false }) }); } catch (e) { threw = true; }
  ok(threw, 'a failed read throws, so the morning check reports "not measured" instead of "all clear"');
  threw = false;
  try { await readSampleSync({ supa: 'https://example.invalid', key: 'k', fetchImpl: async (u) => (u.includes('/sample_reviews?') ? { ok: true, json: async () => [sample({ video_deliverable_id: 'w1' })] } : { ok: true, json: async () => ({ message: 'denied' }) }) }); } catch (e) { threw = true; }
  ok(threw, 'an error body in place of work items throws too');
  console.log(`sample-sync: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
