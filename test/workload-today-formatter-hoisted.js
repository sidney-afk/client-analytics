'use strict';
/*
 * A DATE FORMATTER BUILT PER ROW IS A CONSTRUCTOR CALL PER ROW.
 *
 * `wlWorkloadTodayISO` is called once per row while the Production list builds
 * its HTML. It used to construct a fresh `Intl.DateTimeFormat` on every call,
 * which is the expensive half of the operation: construction resolves locale
 * and time-zone data, while `formatToParts` on an existing formatter is nearly
 * free.
 *
 * Measured here on the live Active tab's row count: constructing each time
 * 91.4ms for 1,145 calls, one hoisted formatter 9.8ms — 9.3x. Measured in the
 * browser against the full 5,398-row estate, hoisting took 395ms off a 739.6ms
 * `_prodRender()`.
 *
 * Two things are pinned, and the second is the one that will catch a
 * regression: the output is unchanged, and the constructor is no longer inside
 * the function. A future edit that "simplifies" this back to a one-liner would
 * pass any output-only test while quietly restoring the whole cost.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const start = html.indexOf('function wlWorkloadTodayISO(');
const end = html.indexOf('function wlTodayISO(', start);
const src = start >= 0 && end > start ? html.slice(start, end) : '';
ok(!!src, 'the hoisted formatter and its function are findable (harness is not vacuous)');

const tz = (html.match(/const WL_WORKLOAD_TIME_ZONE = '([^']+)'/) || [])[1];
ok(!!tz, 'the time zone is a literal constant (' + tz + ')');
ok((html.match(/WL_WORKLOAD_TIME_ZONE\s*=/g) || []).length === 1,
  'and it is assigned exactly once — a reassignable zone is what would make one cached formatter wrong');

const ctx = { Intl, Date, WL_WORKLOAD_TIME_ZONE: tz, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const hoisted = ctx.wlWorkloadTodayISO;
ok(typeof hoisted === 'function', 'the shipped function loads');

/* The reference implementation: what it used to be, verbatim in behaviour. */
function perCall(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now || new Date());
  const values = {};
  for (const part of parts) if (part.type !== 'literal') values[part.type] = part.value;
  return `${values.year}-${values.month}-${values.day}`;
}

// ---- 1. the output did not change ---------------------------------------
let mismatches = 0;
for (let i = 0; i < 4000; i++) {
  const day = new Date(Date.UTC(2024, 0, 1) + i * 6 * 3600 * 1000);
  if (hoisted(day) !== perCall(day)) mismatches++;
}
ok(mismatches === 0,
  'identical output across 4,000 instants spanning ~2.7 years, so every DST boundary in the zone is covered ('
    + mismatches + ' mismatches)');
ok(/^\d{4}-\d{2}-\d{2}$/.test(hoisted(new Date(Date.UTC(2026, 7, 26, 3, 0, 0)))),
  'and it still returns a zero-padded ISO date');
ok(hoisted() === perCall(),
  'a call with no argument still means "today in the workload zone"');

// ---- 2. the constructor is out of the hot path ---------------------------
const body = src.slice(src.indexOf('function wlWorkloadTodayISO('));
ok(/wlWorkloadTodayISO\._fmt \|\| \(wlWorkloadTodayISO\._fmt = new Intl\.DateTimeFormat/.test(body),
  'the construction sits behind a memo, so it happens once rather than once per row');
ok((body.match(/new Intl\.DateTimeFormat/g) || []).length === 1,
  'and there is exactly one construction site in the function');
/* The memo lives ON the function, not in a neighbouring `let`. Several suites
   compile this function alone into an explicit scope, so a free identifier
   beside it is a ReferenceError the moment they run — which is how the first
   version of this change announced itself. */
ok(!/_wlWorkloadTodayFormatter/.test(html),
  'and it introduces no module-level global, so the suites that compile this function in isolation still can');

/* The measurement, re-run rather than quoted. Deliberately a RATIO with a loose
   floor: a shared runner is not a benchmark rig, and the point is the order of
   magnitude, not a number this suite would then have to defend. */
const N = 1145;
const now = new Date();
perCall(now); hoisted(now);
let t = process.hrtime.bigint();
for (let i = 0; i < N; i++) perCall(now);
const before = Number(process.hrtime.bigint() - t) / 1e6;
t = process.hrtime.bigint();
for (let i = 0; i < N; i++) hoisted(now);
const after = Number(process.hrtime.bigint() - t) / 1e6;
ok(after < before / 2,
  `${N} calls (the live Active tab's row count): ${before.toFixed(1)}ms constructing each time vs `
    + `${after.toFixed(1)}ms hoisted — ${(before / after).toFixed(1)}x`);

if (failures) {
  console.error(`\n${failures} workload-formatter check(s) failed`);
  process.exit(1);
}
console.log('\nworkload today-formatter is hoisted, and still says the same thing');
