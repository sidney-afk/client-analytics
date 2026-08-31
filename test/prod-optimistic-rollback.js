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
    /* Comments are SKIPPED, not parsed. index.html comments are prose and
       contain apostrophes -- "the row's scope" -- which a quote-only scanner
       reads as an unterminated string, swallowing every brace after it and
       throwing `unclosed` for a function that balances perfectly. That error
       names the wrong thing and sends the reader hunting a syntax error that
       is not there. A brace or quote inside a comment is not code. */
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const ch = INDEX[j];
    const next = INDEX[j + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; j++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; j++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; j++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}
const stillOurs = new Function(lift('_prodOptimisticStillOurs') + '\nreturn _prodOptimisticStillOurs;')();

// --- the ordinary failure: nothing touched the row, so roll it back ----------
{
  const row = { id: 'd1', status: 'approved', updated_at: 'T0' };
  const entry = { row, before: { status: 'in_progress' }, patch: { status: 'approved' }, beforeUpdatedAt: row.updated_at };
  ok(stillOurs(entry) === true,
    'a row still holding the optimistic value is rolled back — the normal failure path');
}

// --- the write_conflict: the server row landed first, leave it alone ---------
{
  const row = { id: 'd1', status: 'approved', updated_at: 'T0' };
  const entry = { row, before: { status: 'in_progress' }, patch: { status: 'approved' }, beforeUpdatedAt: row.updated_at };
  // _prodApplyGatewayRow applies the authoritative row before the throw.
  row.status = 'client_approval';
  row.updated_at = 'T1';
  ok(stillOurs(entry) === false,
    'a row the gateway already reloaded is NOT rolled back — the conflict case');
}

// --- multi-field writes: any field moving is enough to stand down ------------
{
  const row = { id: 'd1', due_date: '2026-09-01' };
  const entry = { row, before: { due_date: '' }, patch: { due_date: '2026-09-01' }, beforeUpdatedAt: row.updated_at };
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

/* --- the SAME-VALUE conflict, which the field-only guard could not see -------
 *
 * Raised by automated review on PR #1143 after the guard shipped. Another tab
 * (or the same person on their phone) sets the SAME status we are about to
 * write. Our write conflicts, and the 409 carries an authoritative row whose
 * status EQUALS what we optimistically painted. Comparing patched fields alone,
 * that is indistinguishable from "nobody touched it" -- so the guard said roll
 * back, the old value went on, and the row kept the SERVER's updated_at. That
 * pair fails its own CAS forever: the exact failure this whole guard exists to
 * prevent, reached through its blind spot.
 *
 * updated_at is the discriminator that cannot coincide: a conflict happens
 * BECAUSE the server's version differed from the one we sent. */
{
  const row = { id: 'd1', status: 'in_progress', updated_at: 'T0' };
  const entry = { row, before: { status: 'in_progress' }, patch: { status: 'approved' }, beforeUpdatedAt: row.updated_at };
  // The other tab already set 'approved'; the gateway 409s and applies its row.
  row.status = 'approved';
  row.updated_at = 'T1';
  ok(stillOurs(entry) === false,
    'a conflict row that happens to CARRY our value is still not ours to roll back');
}

/* And the mirror of it: the version moved but the field did not. Still not
 * ours -- the server has spoken about this row either way. */
{
  const row = { id: 'd1', status: 'approved', updated_at: 'T0' };
  const entry = { row, before: { status: 'in_progress' }, patch: { status: 'approved' }, beforeUpdatedAt: row.updated_at };
  row.updated_at = 'T1';
  ok(stillOurs(entry) === false,
    'a reloaded row is left alone even when the reload changed nothing visible');
}

/* The guard is only as good as the entry it is handed, and there is exactly one
 * place that builds one. Pin that the shipped factory captures the version
 * BEFORE the optimistic paint -- dropping that line would not fail any
 * assertion above, it would just quietly stop rolling anything back. */
{
  const at = INDEX.indexOf('const optimistic = issues.map(issue => {');
  // Bounded window rather than a brace walk: the callback contains an inner
  // `forEach(... );`, so the first `});` is not the factory's end.
  const body = at < 0 ? '' : INDEX.slice(at, at + 900);
  ok(body.includes('const beforeUpdatedAt = row.updated_at;'),
    'the optimistic factory captures updated_at before painting');
  ok(body.indexOf('const beforeUpdatedAt') >= 0
    && body.indexOf('const beforeUpdatedAt') < body.indexOf('Object.assign(row, patch)'),
    'and captures it BEFORE the assign, or it would record the painted version');
  ok(body.includes('return { row, before, patch, beforeUpdatedAt };'),
    'and hands it to the guard on every entry');
}

console.log(failures === 0
  ? '\nAll optimistic-rollback checks passed.'

  : '\n' + failures + ' check(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
