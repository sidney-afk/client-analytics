'use strict';
/*
 * "NOT ASSIGNED" ON CREATE POST (owner 2026-10-23).
 *
 * The Create Post picker (Calendar and Samples) offers "Not assigned": the post
 * is created with no video editor and lands in Workload's "Needs assignment".
 * The browser sends `unassigned: true` on the video items; the gateway must
 * then write a NULL assignee and never fall through to the automatic pick.
 *
 * This runs the gateway's REAL validation and assignment code (sliced out of
 * production-write/index.ts, type annotations stripped) against stubs, and the
 * browser's real item builder, so neither half can drift into a source-text
 * pin that passes while the behaviour is wrong.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/extract-function');

const root = path.join(__dirname, '..');
const gateway = fs.readFileSync(path.join(root, 'supabase/functions/production-write/index.ts'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let checks = 0;
function pass(label) { checks++; console.log('  ok  ' + label); }

function slice(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'slice not found: ' + start.slice(0, 50));
  assert.equal(source.split(start).length, 2, 'slice start is not unique: ' + start.slice(0, 50));
  return source.slice(a, b);
}
const stripTypes = code => code
  .replace(/: Record<string, (string|boolean)>/g, '')
  .replace(/ as JsonMap\[\]/g, '');

class GatewayError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const clean = value => String(value == null ? '' : value).trim();
const normalizeTeam = value => ['video', 'graphics'].includes(clean(value).toLowerCase()) ? clean(value).toLowerCase() : '';

// ---- the per-item shape check (first validation loop) ---------------------
const shapeCheck = slice(gateway,
  '    // "Not assigned" (owner 2026-10-23): a VIDEO item may ask for nobody,',
  '    /* The optional post name');
function shape(item) {
  return vm.runInNewContext('(() => {' + shapeCheck + '})()', { item, index: 0, GatewayError, clean, normalizeTeam });
}
assert.doesNotThrow(() => shape({ team: 'video', unassigned: true }));
assert.doesNotThrow(() => shape({ team: 'video' }));
pass('a video item may say unassigned: true, and an item that says nothing is unchanged');
for (const [label, item, code] of [
  ['graphics', { team: 'graphics', unassigned: true }, 'intake_assignee_override_not_allowed'],
  ['false', { team: 'video', unassigned: false }, 'intake_assignee_override_not_allowed'],
  ['string', { team: 'video', unassigned: 'yes' }, 'intake_assignee_override_not_allowed'],
  ['beside an editor', { team: 'video', unassigned: true, assignee_id: 'ed-1' }, 'intake_assignee_override_conflict'],
]) {
  assert.throws(() => shape(item), error => error.status === 400 && error.code === code);
  pass('refused: unassigned ' + label + ' (' + code + ')');
}

// ---- the assignment plan ----------------------------------------------------
const plan = stripTypes(slice(gateway, '  const requestedByTeam: Record<string, string> = {};', '  /*\n   * ONE NAME PER CARD'));
async function assign(items, existing = []) {
  const calls = { auto: 0, eligible: [] };
  const context = {
    items, teamList: [...new Set(items.map(item => normalizeTeam(item.team)))],
    existingById: new Map(existing.map(row => [row.id, row])),
    nativeEpochByTeam: { video: 'native-epoch', graphics: 'native-epoch' },
    supabase: {}, GatewayError, clean, normalizeTeam,
    assertEligibleAssignee: async (db, id) => { calls.eligible.push(id); },
    autoAssigneeForIntake: async (db, team) => { calls.auto++; return team === 'video' ? 'ed-freest' : 'designer'; },
  };
  const result = await vm.runInNewContext('(async () => {' + plan + '\nreturn assigneeByTeam; })()', context);
  return { result: JSON.parse(JSON.stringify(result)), calls };
}
const row = (assignee, extra = {}) => ({ id: 'del-' + Math.random(), team: 'video', created_by: 'staff', assignee_id: assignee, ...extra });

(async () => {
  let out = await assign([{ team: 'video', unassigned: true }, { team: 'video', unassigned: true }, { team: 'graphics' }]);
  assert.equal(out.result.video, '');
  assert.equal(out.result.graphics, 'designer');
  assert.equal(out.calls.auto, 1);
  assert.deepEqual(out.calls.eligible, []);
  pass('Not assigned: the video half gets nobody and is never auto-assigned; the thumbnail keeps its designer');

  out = await assign([{ team: 'video' }]);
  assert.equal(out.result.video, 'ed-freest');
  pass('without the field the automatic pick is unchanged');

  out = await assign([{ team: 'video', assignee_id: 'ed-chosen' }]);
  assert.equal(out.result.video, 'ed-chosen');
  assert.deepEqual(out.calls.eligible, ['ed-chosen']);
  pass('a chosen editor is unchanged, and still checked for eligibility');

  await assert.rejects(assign([{ team: 'video', unassigned: true }, { team: 'video' }]),
    error => error.status === 400 && error.code === 'intake_assignee_override_conflict');
  await assert.rejects(assign([{ team: 'video', unassigned: true }, { team: 'video', assignee_id: 'ed-x' }]),
    error => error.status === 400 && error.code === 'intake_assignee_override_conflict');
  pass('half "nobody" and half "automatic" or "someone" is refused before anything is written');

  out = await assign([{ team: 'video', unassigned: true }], [row('ed-earlier')]);
  assert.equal(out.result.video, 'ed-earlier');
  pass('a retry still adopts what its own earlier attempt wrote');

  out = await assign([{ team: 'video', unassigned: true }], [row('ed-mirror', { created_by: 'linear-backfill' })]);
  assert.equal(out.result.video, '');
  pass('a mirrored Linear-era assignee does not override an explicit "nobody"');

  // ---- the row is written with a NULL assignee, not an empty string ---------
  assert.ok(/\n      assignee_id: assigneeId \|\| null,\n/.test(gateway));
  pass('the deliverable row stores NULL (the column is a uuid), which Workload reads as Needs assignment');

  // ---- the browser item builder ---------------------------------------------
  const builder = extractFunction(html, '_linearIntakeItems');
  const build = vm.runInNewContext('(' + builder.replace(/^function _linearIntakeItems/, 'function') + ')', {
    CAL_NATIVE_TITLE_SEPARATOR: ' — ', PROD_CREATED_STATUS: 'todo',
    _linearVideoBrief: () => '', _linearThumbnailBrief: () => '',
  });
  const videos = [{ number: 1, dueDate: '2026-10-30' }, { number: 2, dueDate: '2026-10-30' }];
  const nobody = JSON.parse(JSON.stringify(build('both', videos, 'req-1', 'calendar', '', true)));
  assert.deepEqual(nobody.filter(item => item.team === 'video').map(item => item.unassigned), [true, true]);
  assert.ok(nobody.filter(item => item.team === 'graphics').every(item => !('unassigned' in item)));
  assert.ok(nobody.every(item => !('assignee_id' in item)));
  pass('the browser marks every video item, and only video items');
  const plain = JSON.parse(JSON.stringify(build('both', videos, 'req-1', 'sxr', '', false)));
  assert.ok(plain.every(item => !('unassigned' in item) && !('assignee_id' in item)));
  const chosen = JSON.parse(JSON.stringify(build('video', videos, 'req-1', 'calendar', 'ed-1', true)));
  assert.ok(chosen.every(item => item.assignee_id === 'ed-1' && !('unassigned' in item)));
  pass('an ordinary post keeps its old payload, and a named editor always wins over the flag');

  console.log(JSON.stringify({ suite: 'intake-not-assigned', checks, status: 'PASS' }));
})().catch(error => { console.error(error); process.exitCode = 1; });
