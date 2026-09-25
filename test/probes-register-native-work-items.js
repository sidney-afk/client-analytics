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

/* Scope is DERIVED, not listed (Codex on #1609: a hand-written list let p92
   slip through). Every qa/ script that seeds a Linear URL on a card must link
   that card through the fixture, except the files named here with a reason. */
const EXEMPT = new Map([
  ['qa/probes/sxr_linear_deep.js', 'tests the Linear link edit/clear/move controls removed in #1605; to be retired'],
  ['qa/probes/parity_logic.js', 'in-page logic objects only, never seeded to the database; they carry their own ids'],
  ['qa/scenarios.js', 'scenario data; qa/scenario_engine.js registers every seeded or patched card'],
]);
const walk = dir => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? (e.name === 'node_modules' || e.name === 'out' ? [] : walk(dir + '/' + e.name)) : (e.name.endsWith('.js') ? [dir + '/' + e.name] : []));
const PROBES = walk('qa').filter(rel => {
  if (EXEMPT.has(rel) || rel === 'qa/native_work_item_fixture.js') return false;
  return /(?<![A-Za-z_.])(graphic_)?linear_issue_id:\s*['"`]https?:\/\//.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
});
ok(PROBES.length >= 10, 'the derived scope finds the Linear-seeding probes (' + PROBES.length + ')');
for (const [rel] of EXEMPT) ok(fs.existsSync(path.join(ROOT, rel)), 'exempt file still exists: ' + rel);
for (const rel of PROBES) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
  let seeds = 0, missing = 0;
  lines.forEach((line, i) => {
    if (!/(?<![A-Za-z_.])(graphic_)?linear_issue_id:\s*['"`]https?:\/\//.test(line)) return;
    seeds++;
    const before = lines.slice(Math.max(0, i - 25), i + 1).join('\n');
    // An in-page card object (set straight into calState, never saved) may
    // carry its own synthetic id beside the URL instead: no foreign key there.
    const near = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
    const idKey = /graphic_linear_issue_id/.test(line) ? 'graphic_deliverable_id' : 'video_deliverable_id';
    const inPageId = /calState\.posts|page\.evaluate/.test(lines.slice(Math.max(0, i - 12), i).join('\n')) && new RegExp('\\b' + idKey + '\\s*:').test(near);
    if (!inPageId && !/registerProbeWorkItems\(|stubNativeWorkItems\(/.test(before)) { missing++; console.error('      ' + rel + ':' + (i + 1) + ' seeds a Linear URL with no registerProbeWorkItems before it'); }
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
