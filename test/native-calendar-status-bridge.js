'use strict';
/*
 * Offline contract suite for the native calendar status bridge
 * (migrations/2026-09-18-native-calendar-status-bridge.sql).
 *
 * THE DRIFT THIS EXISTS TO CATCH.
 *
 * The status mapping has one canonical home: `_calMapNativeStatusStrict` in
 * index.html. The browser binds every native projector to it, and
 * scripts/linear-sync-reconcile.js extracts it out of index.html at runtime
 * rather than copying it, precisely so a second copy cannot drift. The
 * migration is a second copy -- in SQL, where the page's function cannot be
 * called -- so the drift risk is real and this suite is the answer to it.
 *
 * It does not eyeball the two. It EXECUTES the page's own function, parses the
 * migration's `case` arms out of the SQL, and compares the two over every value
 * `deliverables.status` is allowed to hold -- the list being read from the
 * CHECK constraint in the data-model migration, so a status added to the column
 * and to only one of the two mappers fails here rather than in front of a
 * client.
 *
 * It also pins the three structural facts the projection depends on, each of
 * which is a defect if it silently changes:
 *   * the trigger carries no WHEN clause, because the Linear-exit deploy
 *     preflight requires `tgqual is null` on every trigger it pins;
 *   * the deploy preflight carries a row for each of the three new routines,
 *     with the fifth element false, because none of them is SECURITY DEFINER;
 *   * the event rows use a source distinct from every existing writer's.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROUTINES, TRIGGERS } = require('../scripts/linear-exit-deploy-preflight.js');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'migrations', '2026-09-18-native-calendar-status-bridge.sql');
const sql = fs.readFileSync(MIGRATION, 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dataModel = fs.readFileSync(path.join(ROOT, 'migrations', '2026-07-06-b1-linear-data-model.sql'), 'utf8');

let passed = 0;
let failed = 0;
const ok = (name, value) => {
  if (value) { passed += 1; console.log(`  ok ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};

/* ---- the page's own mapper, executed rather than described --------------- */
function grabFunc(source, name) {
  const at = source.indexOf('function ' + name + '(');
  assert.ok(at >= 0, 'index.html no longer defines ' + name);
  let depth = 0;
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('unbalanced braces around ' + name);
}
const pageMap = new Function(
  grabFunc(page, '_calMapNativeStatusStrict') + ';return _calMapNativeStatusStrict;')();

/* ---- the migration's mapper, parsed out of the SQL ----------------------- */
function sqlMapper() {
  const body = sql.match(
    /create or replace function public\.production_native_calendar_status_map\([\s\S]*?\bas \$fn\$([\s\S]*?)\$fn\$;/);
  assert.ok(body, 'the migration no longer defines production_native_calendar_status_map');
  const arms = [...body[1].matchAll(/when\s+'([^']*)'\s+then\s+(.+)$/gm)]
    .map(m => [m[1], m[2].trim()]);
  assert.ok(arms.length >= 8, 'the mapping arms could not be parsed out of the migration');
  return (status, origin) => {
    const s = String(status || '').trim().toLowerCase();
    const samples = String(origin || '').trim().toLowerCase() === 'samples';
    for (const [key, result] of arms) {
      if (key !== s) continue;
      const plain = result.match(/^'([^']*)'/);
      if (plain) return plain[1];
      // The two surface-conditional arms: `case when ... 'samples' then null else 'X' end`.
      const conditional = result.match(/^case when .*'samples' then null else '([^']*)' end/);
      assert.ok(conditional, 'unrecognised mapping arm for ' + key + ': ' + result);
      return samples ? null : conditional[1];
    }
    return null;
  };
}
const migrationMap = sqlMapper();

/* Every value the column may hold, read from its own CHECK constraint. */
const statuses = (() => {
  const m = dataModel.match(/status text not null default 'in_progress' check \(status in\s*\(([\s\S]*?)\)\)/);
  assert.ok(m, 'the deliverables status CHECK constraint could not be read');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
})();
ok('the deliverables status vocabulary was read from its own CHECK constraint', statuses.length >= 13);

const probes = [...statuses, '', '   ', 'SMM_APPROVAL', '  tweak  ', 'not_a_status'];
let agree = 0;
const disagreements = [];
for (const status of probes) {
  for (const origin of ['calendar', 'samples', 'manual', '', 'SAMPLES']) {
    const a = pageMap(status, origin);
    const b = migrationMap(status, origin);
    if (a === b) agree += 1;
    else disagreements.push(`${JSON.stringify(status)}/${JSON.stringify(origin)}: page=${a} sql=${b}`);
  }
}
ok(`the migration's mapping agrees with index.html on all ${agree} status/origin pairs`
  + (disagreements.length ? ' — ' + disagreements.join('; ') : ''), disagreements.length === 0);

/* A parser that quietly matched nothing would agree with anything, so prove it
 * is reading real arms: the values the regression is about must be present. */
ok('the parsed SQL mapper actually produces the calendar values, not a blanket null',
  migrationMap('smm_approval', 'calendar') === 'For SMM Approval'
  && migrationMap('tweak', 'calendar') === 'Tweaks Needed'
  && migrationMap('scheduled', 'calendar') === 'Scheduled'
  && migrationMap('scheduled', 'samples') === null);
ok('and the page mapper it is compared against is the real one, not an empty stub',
  pageMap('approved', 'calendar') === 'Approved');

/* ---- the structural pins ------------------------------------------------ */
const triggerStatement = sql.match(
  /create trigger zzz_native_calendar_status_project([\s\S]*?);/);
ok('the projection trigger is declared', !!triggerStatement);
ok('it is an AFTER UPDATE row trigger on deliverables',
  /after update on public\.deliverables/.test(triggerStatement[1])
  && /for each row/.test(triggerStatement[1]));
ok('it carries NO WHEN clause, so the deploy preflight tgqual is null check holds',
  !/\bwhen\s*\(/i.test(triggerStatement[1]));

ok('the event source is distinct from every existing calendar_post_events writer',
  /'native-bridge'/.test(sql) && !/'ui'\s*,\s*$/m.test(sql));

const expectedRoutines = [
  'production_native_calendar_status_map(text,text)',
  'production_native_calendar_status_project()',
  'production_native_calendar_status_backfill(timestamp with time zone,boolean)',
];
for (const signature of expectedRoutines) {
  const row = ROUTINES.find(r => r[0] === signature);
  ok(`the deploy preflight pins ${signature}`, !!row);
  if (!row) continue;
  ok(`  ...against this migration, with securityDefiner false (none of the three is SECURITY DEFINER)`,
    row[1] === 'migrations/2026-09-18-native-calendar-status-bridge.sql' && row[4] === false);
}
const triggerRow = TRIGGERS.find(r => r[2] === 'zzz_native_calendar_status_project');
ok('the deploy preflight pins the trigger itself', !!triggerRow);
ok('  ...as a row-level AFTER UPDATE trigger (tgtype 17 = ROW | UPDATE)',
  triggerRow && triggerRow[1] === 'deliverables' && triggerRow[4] === 17);

/* The migration must not have picked up a byte-order mark: the deploy tooling
 * strips those on upload while fingerprints hash the committed bytes. */
ok('the migration carries no byte-order mark', !sql.startsWith('﻿'));

console.log(JSON.stringify({
  marker: failed ? 'NATIVE_CALENDAR_STATUS_BRIDGE_FAIL' : 'NATIVE_CALENDAR_STATUS_BRIDGE_OK',
  status_pairs: agree, passed, failed,
}));
assert.equal(failed, 0, 'native calendar status bridge contract');
