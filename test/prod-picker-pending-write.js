'use strict';
/*
 * A change the gateway never sent must not be reported as saved.
 *
 * _prodGatewayWrite returns null (it does not throw) when a write for the same
 * issue and field is still in flight. _prodRunPickerWrite used to count that
 * null as a completed write: it had already painted the second value, then
 * toasted "Status updated", and the FIRST change's receipt put the old value
 * back a moment later. Two quick status changes on one SyncLinear card: the
 * second was dropped and the page said it was saved.
 *
 * The real _prodRunPickerWrite is lifted out of the app and run against a
 * gateway that answers null, a receipt, or a refusal.
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const { extractFunction } = require('./helpers/extract-function.js');
// extractFunction starts at the word `function`, so an async one gets its keyword back.
function lift(name) {
  const body = extractFunction(INDEX, name);
  return (INDEX.includes('async function ' + name + '(') ? 'async ' : '') + body;
}
function harness(gateway) {
  const row = { id: 'd1', status: 'in_progress', updated_at: 'T0' };
  const row2 = { id: 'd2', status: 'todo', updated_at: 'T0' };
  const env = { toasts: [], recorded: [], renders: 0, row, row2 };
  const run = new Function('env', 'gateway', `
    const _prodState = { deliverables: [env.row, env.row2], adapter: {} };
    const PROD_STATUS_FROM_ARTIFACT = {};
    const _prodIssue = id => ({ id, team: 'video' });
    const _prodSmmArtifactGate = () => ({ ok: true });
    const _prodEnsureAssets = () => {};
    const _prodWriteTeam = team => team;
    const _prodCanWrite = () => true;
    const _prodWriteGateText = () => 'gate';
    const _prodWriteErrorText = error => 'refused: ' + (error && error.code);
    const _prodToast = text => env.toasts.push(String(text));
    const _prodRender = () => { env.renders++; };
    const _writeUiRecordFailure = (surface, kind, error) => env.recorded.push(error && error.code);
    const _prodGatewayWrite = gateway;
    ${lift('_prodOptimisticStillOurs')}
    ${lift('_prodRunPickerWrite')}
    return _prodRunPickerWrite;
  `)(env, gateway);
  return { env, run };
}

(async () => {
  // --- an earlier change is still saving: the gateway sends nothing ----------
  {
    const { env, run } = harness(async () => null);
    await run('status', ['d1'], 'approved');
    ok(!env.toasts.some(t => /updated/i.test(t)),
      'a change the gateway did not send is not toasted as "updated"');
    ok(env.toasts.length === 1 && /still saving/i.test(env.toasts[0]),
      'the reader is told an earlier change is still saving');
    ok(env.row.status === 'in_progress',
      'the row goes back to the value that is actually being saved');
    ok(env.recorded.length === 0,
      'nothing is written to the refusal log, because nothing was refused by the server');
  }

  // --- the ordinary success still reads as a success --------------------------
  {
    const { env, run } = harness(async () => ({ ok: true }));
    await run('status', ['d1'], 'approved');
    ok(env.toasts.length === 1 && env.toasts[0] === 'Status updated', 'a sent change still toasts "Status updated"');
    ok(env.row.status === 'approved', 'and keeps the new value');
  }

  // --- a real refusal still rolls back, reports and records -------------------
  {
    const { env, run } = harness(async () => { throw Object.assign(new Error('write_failed'), { code: 'write_failed' }); });
    await run('due', ['d1'], '2027-07-20');
    ok(env.toasts.length === 1 && env.toasts[0] === 'refused: write_failed', 'a refused change shows the gateway reason');
    ok(env.recorded.length === 1 && env.recorded[0] === 'write_failed', 'and is recorded in the refusal log as before');
    ok(env.row.due_date === undefined, 'and the optimistic value is rolled back');
  }

  // --- a selection where a later row is still saving --------------------------
  {
    let n = 0;
    const { env, run } = harness(async () => (++n === 1 ? { ok: true } : null));
    await run('status', ['d1', 'd2'], 'approved');
    ok(!env.toasts.some(t => /issues updated/.test(t)),
      'a selection with one held-back row does not claim every row was updated');
    ok(env.toasts.some(t => /still saving/i.test(t)), 'and says an earlier change is still saving');
    ok(env.row.status === 'approved', 'the row that was sent keeps its new value');
    ok(env.row2.status === 'todo', 'the row that was held back returns to its own value');
  }
  if (failures) { console.log('\n' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\nprod-picker-pending-write: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
