'use strict';
/*
 * Linear is retired (2026-09-24): a Calendar/Samples component is linked only
 * by its SyncView deliverable id. The live nightly probes used to seed a Linear
 * URL to make a test-client card linked. A synthetic deliverable id cannot be
 * persisted (calendar_posts.video_deliverable_id carries a foreign key), so the
 * probes register their cards with qa/native_work_item_fixture.js, which stamps
 * the ids into the calendar and samples READS instead. This checks, offline:
 *   1. every probe seed with a non-empty Linear URL registers that card;
 *   2. both shared context helpers install the registry;
 *   3. the registry really stamps calendar_posts and sample_reviews responses,
 *      including for a card registered after the context was created, and
 *      leaves unregistered cards and non-GET requests alone.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } };

const PROBES = [
  'qa/probes/ot_temporal_client_combo.js', 'qa/probes/ot_temporal_kasper.js', 'qa/probes/p34_set_all.js',
  'qa/probes/p88_realtime_handler.js', 'qa/probes/sxr_client_persist_guard.js', 'qa/probes/sxr_concurrency.js',
  'qa/probes/sxr_gating_flags.js', 'qa/probes/sxr_kasper_audit_holes.js', 'qa/probes/sxr_realtime_twin.js',
  'qa/probes/p92_sxr_resolve_pill_inplace.js', 'qa/scenario_engine.js',
];
for (const rel of PROBES) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
  let seeds = 0, missing = 0;
  lines.forEach((line, i) => {
    if (!/(?<![A-Za-z_.])(graphic_)?linear_issue_id:\s*['"`]https?:\/\//.test(line)) return;
    seeds++;
    const before = lines.slice(Math.max(0, i - 25), i + 1).join('\n');
    if (!/registerProbeWorkItems\(/.test(before)) { missing++; console.error('      ' + rel + ':' + (i + 1) + ' seeds a Linear URL with no registerProbeWorkItems before it'); }
  });
  ok(seeds > 0 && missing === 0, rel + ' registers every card it links (' + seeds + ' linked seed line' + (seeds === 1 ? '' : 's') + ')');
}
const courier = fs.readFileSync(path.join(ROOT, 'qa/sxr_courier_lib.js'), 'utf8');
const lib = fs.readFileSync(path.join(ROOT, 'qa/probes/lib.js'), 'utf8');
ok(/applyProbeWorkItems\(ctx\)/.test(courier), 'qa/sxr_courier_lib.js contexts install the registry');
ok(/applyProbeWorkItems\(c\)/.test(lib), 'qa/probes/lib.js contexts install the registry');

(async () => {
  const NW = require('../qa/native_work_item_fixture.js');
  const routes = [];
  const ctx = { route: async (pred, handler) => { routes.push({ pred, handler }); } };
  await NW.applyProbeWorkItems(ctx);
  NW.registerProbeWorkItems([{ id: 'sr_probe_1', components: ['video', 'graphic'] }]);
  const call = async (pathname, method, rows) => {
    const url = new URL('https://x.supabase.co' + pathname + '?select=*');
    const r = routes.find(x => x.pred(url));
    if (!r) return { routed: false };
    let out = { routed: true, fallback: false, body: null };
    await r.handler({
      request: () => ({ method: () => method, url: () => url.toString() }),
      fallback: async () => { out.fallback = true; },
      fetch: async () => ({ text: async () => JSON.stringify(rows) }),
      fulfill: async (o) => { out.body = o.body; },
    });
    return out;
  };
  for (const table of ['/rest/v1/calendar_posts', '/rest/v1/sample_reviews']) {
    const res = await call(table, 'GET', [{ id: 'sr_probe_1' }, { id: 'other' }]);
    const rows = JSON.parse(res.body || '[]');
    ok(rows[0] && rows[0].video_deliverable_id === NW.nativeDeliverableId('sr_probe_1', 'video')
      && rows[0].graphic_deliverable_id === NW.nativeDeliverableId('sr_probe_1', 'graphic'),
      table + ': a card registered AFTER the context was created is stamped on both components');
    ok(rows[1] && !rows[1].video_deliverable_id && !rows[1].graphic_deliverable_id, table + ': an unregistered card is left alone');
  }
  const post = await call('/rest/v1/calendar_posts', 'POST', []);
  ok(post.fallback === true, 'a non-GET request is passed through untouched');
  const cw = await call('/rest/v1/deliverables', 'GET', []);
  ok(cw.routed, 'the crosswalk read is routed');
  if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
  console.log('probes-register-native-work-items: ok');
})().catch(e => { console.error(e); process.exit(1); });
