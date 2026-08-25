'use strict';
/*
 * A rolled-back optimistic write must not discard the server's own answer.
 *
 * _prodRunPickerWrite paints the picked status locally before the gateway
 * round-trip, then rolls back whatever never got written. That is correct for a
 * throw that mutates nothing — a network drop, a closed write gate, an invalid
 * status.
 *
 * It is WRONG for a 409 write_conflict. The gateway returns the authoritative
 * row in the error body (production-write assertCas -> GatewayError(409,
 * "write_conflict", {conflict:true, row})), and _prodGatewayWrite applies it via
 * _prodApplyGatewayRow BEFORE it throws. A blind rollback then:
 *   - throws away the reload the toast is telling the reader about, and
 *   - leaves the OLD local status sitting on the SERVER's updated_at.
 * That pair fails its own CAS on every retry, so the "try again" the toast asks
 * for can never succeed, and _prodDeltaRefresh does not heal it either — the
 * row's updated_at already equals the fetched row's, so the merge takes the
 * unchanged-echo branch and never rebuilds the projection.
 *
 * Found by adversarial review of the change that introduced the optimistic
 * paint, before it shipped.
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function lift(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('missing ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}
const stillOurs = new Function(lift('_prodOptimisticStillOurs') + '\nreturn _prodOptimisticStillOurs;')();

// --- the ordinary failure: nothing touched the row, so roll it back ----------
{
  const row = { id: 'd1', status: 'approved', updated_at: 'T0' };
  const entry = { row, before: { status: 'in_progress' }, patch: { status: 'approved' } };
  ok(stillOurs(entry) === true,
    'a row still holding the optimistic value is rolled back — the normal failure path');
}

// --- the write_conflict: the server row landed first, leave it alone ---------
{
  const row = { id: 'd1', status: 'approved', updated_at: 'T0' };
  const entry = { row, before: { status: 'in_progress' }, patch: { status: 'approved' } };
  // _prodApplyGatewayRow applies the authoritative row before the throw.
  row.status = 'client_approval';
  row.updated_at = 'T1';
  ok(stillOurs(entry) === false,
    'a row the gateway already reloaded is NOT rolled back — the conflict case');
}

// --- multi-field writes: any field moving is enough to stand down ------------
{
  const row = { id: 'd1', due_date: '2026-09-01' };
  const entry = { row, before: { due_date: '' }, patch: { due_date: '2026-09-01' } };
  ok(stillOurs(entry) === true, 'an untouched due-date write rolls back');
  row.due_date = '2026-10-15';
  ok(stillOurs(entry) === false, 'a due date changed elsewhere does not');
}

// --- null/'' equivalence, because the gateway returns null for cleared fields -
{
  const row = { id: 'd1', assignee_id: null };
  const entry = { row, before: { assignee_id: 'm1' }, patch: { assignee_id: '' } };
  ok(stillOurs(entry) === true,
    'null and empty string count as the same cleared value — the gateway returns null');
}

// --- defensive: a malformed entry must never claim ownership ----------------
{
  ok(stillOurs(null) === false, 'a missing entry is never rolled back');
  ok(stillOurs({ row: null, patch: { status: 'x' } }) === false, 'nor one with no row');
  ok(stillOurs({ row: {}, patch: null }) === false, 'nor one with no patch');
}

// --- the call site actually uses it ------------------------------------------
ok(/if \(!_prodOptimisticStillOurs\(entry\)\) return;/.test(INDEX),
  'the rollback loop consults the guard before restoring anything');

console.log(failures === 0
  ? '\nAll optimistic-rollback checks passed.'
  : '\n' + failures + ' check(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
