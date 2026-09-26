'use strict';
/*
 * The browser refusal beacon must say WHICH card a refused write was for.
 *
 * Run:  node test/write-refusal-beacon-card-id.js   (exit 0 = all good)
 *
 * Measured 2026-09-23: 41 calendar status, 19 calendar comment and the sxr
 * browser_refusal rows in write_refusal_diagnostics.receipts_v1 all carried an
 * empty identifiers object. Almost every _writeUiReportFailure caller passes
 * only (surface, operation, error), so the beacon had nothing to send. The
 * gateway send path now stamps the deliverable id (the same `id` the server
 * hashes into its own receipts) onto the error, the repair wrapper adds the
 * card and component, and the report merges them in. Ids only: no slug, no
 * name, no comment text.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}
function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
function grabConst(name) {
  const m = new RegExp('const ' + name + ' = [^;]+;').exec(INDEX);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

(async () => {
  const sent = [];
  const ctx = vm.createContext({
    console, JSON, Object, String, Number, Array, Set, Promise, Error, TextEncoder,
    setTimeout, clearTimeout, AbortController,
    CAL_SUPABASE_URL: 'https://example.invalid',
    fetch: (url, init) => { sent.push(JSON.parse(init.body)); return Promise.resolve({}); },
    localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); } },
    WRITE_UI_QUEUE_DIAG_KEY: 'diag',
  });
  vm.runInContext([
    grabFunc('_writeUiGatewayError'),
    grabConst('WRITE_UI_DIAG_IDS'),
    grabConst('WRITE_UI_DIAG_PAYLOAD_IDS'),
    grabFunc('_writeUiDiagnosticIds'),
    grabConst('WRITE_REFUSAL_BEACON_URL'),
    grabConst('WRITE_REFUSAL_BEACON_IDS'),
    grabConst('WRITE_REFUSAL_BEACON_MAX'),
    'let _writeRefusalBeaconBudget = WRITE_REFUSAL_BEACON_MAX;',
    grabFunc('_writeRefusalBeacon'),
    grabFunc('_writeUiQueueDiagnostic'),
    grabFunc('_writeUiTagDiagIds'),
    // The real send path, with its first dependency refusing.
    'const _writeUiLegacyResumeOwnerCurrent = () => true;',
    'const _writeUiSourceTime = value => String(value || "");',
    'async function _writeUiRefreshAuthority() { throw _writeUiGatewayError(409, "status_reapply_required"); }',
    'async ' + grabFunc('_writeUiGatewayPost'),
    'this._writeUiGatewayPost = _writeUiGatewayPost; this._writeUiTagDiagIds = _writeUiTagDiagIds;',
    'this._writeUiQueueDiagnostic = _writeUiQueueDiagnostic; this._writeUiGatewayError = _writeUiGatewayError;',
  ].join('\n'), ctx);

  // Reproduce the old shape: a report with only the operation, no card.
  ctx._writeUiQueueDiagnostic('calendar', 'ui_write_failure', { kind: 'status' },
    ctx._writeUiGatewayError(409, 'status_reapply_required'));
  ok(sent.length === 1 && Object.keys(sent[0].identifiers).length === 0,
    'an untagged refusal still reports no identifiers (the 2026-09-23 shape)');

  let caught = null;
  try {
    await ctx._writeUiGatewayPost({ nativeId: 'b1_d_test', requestId: 'req-1', surface: 'calendar', operation: 'status',
      issue: 'VID-1', comment: { body: 'secret prose' } });
  } catch (e) { caught = e; }
  ok(caught && caught.code === 'status_reapply_required', 'the refusal still propagates unchanged');
  ok(caught && caught.diagIds && caught.diagIds.id === 'b1_d_test',
    'the send path stamps the deliverable id the gateway hashes');

  ctx._writeUiTagDiagIds(caught, { card: 'p_card', component: 'video', id: 'other' });
  ok(caught.diagIds.card === 'p_card' && caught.diagIds.component === 'video' && caught.diagIds.id === 'b1_d_test',
    'the repair wrapper adds card and component without overwriting the id');

  // What _writeUiReportFailure now hands the beacon.
  const src = grabFunc('_writeUiReportFailure');
  ok(/Object\.assign\(\{ kind: operation \}, error && error\.diagIds \|\| \{\}, context \|\| \{\}\)/.test(src),
    '_writeUiReportFailure merges the error ids, caller context winning');
  ctx._writeUiQueueDiagnostic('calendar', 'ui_write_failure',
    Object.assign({ kind: 'status' }, caught.diagIds), caught);
  const claim = sent[sent.length - 1];
  ok(claim.operation === 'status' && claim.code === 'status_reapply_required' && claim.status === 409,
    'the beacon carries the operation, the reason code and the real status');
  ok(claim.identifiers.id === 'b1_d_test' && claim.identifiers.card === 'p_card'
    && claim.identifiers.component === 'video',
    'the beacon carries the deliverable id, card and component');
  const body = JSON.stringify(claim);
  ok(!/client_slug|secret prose|VID-1/.test(body), 'no slug, issue key or comment text is sent');
  // `page` (client_link | staff_page) joined 2026-09-25 (refusal-log triage).
  // write-diagnostics reads named fields only, so a function deployed before
  // it ignores `page` and still accepts the claim.
  ok(Object.keys(claim).sort().join(',') === 'action,code,identifiers,operation,page,status,surface'
    && (claim.page === 'client_link' || claim.page === 'staff_page'),
    'the beacon shape is the known set plus the page claim, which older write-diagnostics ignores');

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nwrite refusal beacon card-id checks passed');
})().catch(e => { console.error(e); process.exit(1); });
