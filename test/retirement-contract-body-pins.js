'use strict';

/*
 * THE THIRD FROZEN ARTIFACT.
 *
 * One body change has to be kept in step in three places: the deploy
 * preflight's ROUTINES table, the install inventory, and -- least visibly --
 * the per-routine snapshot frozen inside
 * `production_retirement_contract_assert_v1`
 * (supabase/migrations/20260913062149_retirement_switch_preparation.sql),
 * which pins `md5(prosrc)` for 33 routines.
 *
 * Measured 2026-09-18: replacing five bodies for the native test-client parity
 * migration left that snapshot stale, and BOTH Isolated PG17 lanes went red
 * with `retirement_dependency_contract:production_native_assignment_receipt_guard`.
 * The deploy preflight said nothing, the install manifest said nothing, and the
 * only signal was a twenty-minute lane failing on a name.
 *
 * THE INVARIANT. For every routine the retirement contract pins that the deploy
 * preflight ALSO pins, the contract's `body_raw_md5` must equal the md5 of the
 * body in the migration file the preflight cites. The two artifacts describe
 * the same installed function, so they cannot be allowed to disagree.
 *
 * Scoped to that intersection on purpose: 14 of the 33 come from
 * `supabase/migrations/**` and have no repository body the preflight names, so
 * this check has nothing sound to compare them against and says so in its
 * output rather than guessing.
 *
 * The equivalence this rests on -- that the preflight's extracted body is
 * byte-for-byte `prosrc` -- is not assumed. It is proved below against a
 * routine nobody changed, which is exactly how the 2026-09-18 hashes were
 * derived in the first place.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_FILE = 'supabase/migrations/20260913062149_retirement_switch_preparation.sql';

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const contractSource = fs.readFileSync(path.join(ROOT, CONTRACT_FILE), 'utf8');
const blob = contractSource.match(/expected constant jsonb:=\$expected\$([\s\S]*?)\$expected\$/);
ok(!!blob, 'the frozen expected snapshot is still where this check looks for it');
const expected = JSON.parse(blob[1]);
ok(Array.isArray(expected.functions) && expected.functions.length > 0,
  `the snapshot carries its routine list (${expected.functions.length} routines)`);

const preflightSource = fs.readFileSync(path.join(ROOT, 'scripts/linear-exit-deploy-preflight.js'), 'utf8');
const pinned = new Map([...preflightSource.matchAll(
  /\['([^']+\([^']*\))',\s*'(migrations\/[^']+)',\s*'([a-z0-9_]+)'/g,
)].map(match => [match[3], match[2]]));
ok(pinned.size > 40, `the deploy preflight's ROUTINES table was parsed (${pinned.size} rows)`);

/* Mirrors bodyFor() in the preflight, which is what the live gate hashes. */
function bodyFor(file, name) {
  const sql = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const match = sql.match(new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\)`
      + `[\\s\\S]*?\\bas\\s+(\\$[A-Za-z0-9_]*\\$)([\\s\\S]*?)\\1\\s*;`, 'i'));
  return match ? match[2] : null;
}
const md5 = value => crypto.createHash('md5').update(value, 'utf8').digest('hex');

/*
 * THE CONTROL, and it is load-bearing. `body_raw_md5` is md5(prosrc) taken from
 * a live catalog; this file only has repository text. If the extraction and
 * prosrc ever diverge, every comparison below becomes noise. So prove the
 * method on a routine this repository has not changed before trusting it on
 * ones it has.
 */
{
  const control = expected.functions.find(fn => fn.name === 'production_assignment_epoch');
  ok(!!control, 'the control routine is still in the snapshot');
  const body = control && pinned.has(control.name) ? bodyFor(pinned.get(control.name), control.name) : null;
  ok(!!body && md5(body) === control.body_raw_md5,
    'the control reproduces its frozen hash, so extracted body == prosrc for this comparison');
}

const compared = [];
const stale = [];
const unresolved = [];
for (const fn of expected.functions) {
  const file = pinned.get(fn.name);
  if (!file) { unresolved.push(fn.name); continue; }
  const body = bodyFor(file, fn.name);
  if (body === null) { unresolved.push(fn.name + ' (no body in ' + file + ')'); continue; }
  compared.push(fn.name);
  if (md5(body) !== fn.body_raw_md5) stale.push({ routine: fn.name, file, frozen: fn.body_raw_md5, actual: md5(body) });
}

ok(compared.length > 0, `the two artifacts overlap on ${compared.length} routines`);
ok(stale.length === 0,
  stale.length === 0
    ? 'every routine both artifacts pin agrees between them'
    : 'the retirement contract is stale for: ' + stale.map(row =>
      `${row.routine} (frozen ${row.frozen.slice(0, 8)}, ${row.file} now ${row.actual.slice(0, 8)})`).join('; '));

/* Named so a revert of the 2026-09-18 regeneration fails with the reason. */
for (const name of ['production_native_ordinary_event', 'production_native_ordinary_receipt_guard',
  'production_native_assignment_receipt_guard']) {
  ok(compared.includes(name), `${name} is covered by this check`);
}

console.log(JSON.stringify({
  marker: 'RETIREMENT_CONTRACT_BODY_PINS_OK',
  snapshot_routines: expected.functions.length,
  compared: compared.length,
  not_comparable: unresolved.length,
  stale: stale.length,
}));
if (failures) process.exit(1);
