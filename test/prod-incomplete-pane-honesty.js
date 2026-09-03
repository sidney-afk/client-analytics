'use strict';
/*
 * AN INCOMPLETE ROW SET IS NOT AN ABSENT ROW — ON EVERY EXIT AND EVERY PANE.
 *
 * Run:  node test/prod-incomplete-pane-honesty.js   (exit 0 = all good)
 *
 * OPEN_REPAIRS 108, fifth round. Four previous repairs each modelled ONE reason
 * the Production row set can be incomplete and treated the others as proof of
 * absence. The states are:
 *
 *   PENDING   the tail has not finished          -> an unresolved id is NOT YET
 *   FAILED    the tail ran and threw             -> an unresolved id is UNKNOWN
 *   complete  the tail landed                    -> an unresolved id is GONE
 *
 * The 2026-09-02 repair collapsed FAILED into complete: its failure exit called
 * `_prodApplyDeepLinkFallback(true)` and described that as publishing an honest
 * result. It is not honest — the read established nothing — so a reader sitting
 * on a posted deliverable was evicted to the list, and a deep link at an
 * existing row was told it "has no row in Production", off the back of a request
 * that FAILED. Found by audit, reproduced by execution, and it was live.
 *
 * The previous suite (test/prod-terminal-tail-settles.js) scored that exit a
 * PASS, because it asserted `calls.fallback === 1` against a stubbed fallback
 * that only increments a counter. It counted the very call that caused the bug.
 * So this suite runs the REAL `_prodApplyDeepLinkFallback` over a real row set,
 * and asserts on the STATE it leaves behind rather than on whether it was called.
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
  let at = INDEX.indexOf('async function ' + name + '(');
  if (at < 0) at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

/* A row set holding ONLY the live half — exactly what phase one leaves behind,
   and the state every one of these bugs happened in. 'posted-1' exists in the
   real world and is absent here; 'ghost-1' does not exist at all. */
function ctxFor(state) {
  const ctx = vm.createContext({ console });
  vm.runInContext(`
    const LIVE = [{ id: 'live-1', status: 'in_progress' }];
    const _prodState = Object.assign({
      openId: '', openBatchId: '', openProjectId: '', clientSlug: '',
      view: 'detail', deepLink: null, deepLinkMissing: '', deepLinkMissingKind: '',
      terminalTailPending: false, terminalTailFailed: false
    }, ${JSON.stringify(state)});
    function _prodIssue(id) { return LIVE.find(r => r.id === id) || null; }
    function _prodBatch() { return null; }
    function _prodClient() { return null; }
    function _calEsc(s) { return String(s == null ? '' : s); }
    function _prodRefresh() {}
  `, ctx);
  vm.runInContext(grabFunc('_prodApplyDeepLinkFallback'), ctx);
  vm.runInContext(grabFunc('_prodIncompletePaneHTML'), ctx);
  return { ctx, run: e => vm.runInContext(e, ctx) };
}

/* ---- the three states, asserted on OUTCOME not on calls ------------------- */

{
  const h = ctxFor({ openId: 'posted-1', view: 'detail', terminalTailPending: true });
  h.run(`_prodApplyDeepLinkFallback(true)`);
  ok(h.run(`_prodState.view`) === 'detail' && h.run(`_prodState.openId`) === 'posted-1',
    'PENDING: a reader on an unresolved row is not moved');
  ok(h.run(`_prodState.deepLinkMissing`) === '',
    'PENDING: and is not told the row has no place in Production');
}
{
  const h = ctxFor({ openId: 'posted-1', view: 'detail', terminalTailFailed: true });
  h.run(`_prodApplyDeepLinkFallback(true)`);
  ok(h.run(`_prodState.view`) === 'detail' && h.run(`_prodState.openId`) === 'posted-1',
    'FAILED: a reader on an unresolved row is not moved either — a failed read proved nothing');
  ok(h.run(`_prodState.deepLinkMissing`) === '',
    'FAILED: and no missing-row notice is published off a request that failed');
}
{
  const h = ctxFor({ openId: 'ghost-1', view: 'detail' });
  h.run(`_prodState.deepLink = { id: 'ghost-1', kind: 'issue' }; _prodApplyDeepLinkFallback(true)`);
  ok(h.run(`_prodState.view`) === 'list' && h.run(`_prodState.openId`) === '',
    'COMPLETE: a genuinely absent row still evicts — the guard did not disable the feature');
  ok(h.run(`_prodState.deepLinkMissing`) === 'ghost-1',
    'COMPLETE: and the notice still names it');
}

/* ---- the pane says three different things, and never the wrong one -------- */

{
  const h = ctxFor({ terminalTailPending: true });
  const html = h.run(`_prodIncompletePaneHTML('item')`);
  ok(/data-prod-detail-settling/.test(html) && /Loading this item/.test(html),
    'PENDING: the pane shows a skeleton, because the row may be one moment away');
  ok(!/not found/i.test(html), 'PENDING: and never says not found');
}
{
  const h = ctxFor({ terminalTailFailed: true });
  const html = h.run(`_prodIncompletePaneHTML('item')`);
  ok(/data-prod-detail-unavailable/.test(html) && /could not be loaded/.test(html),
    'FAILED: the pane says the read failed, rather than spinning for something that stopped');
  ok(!/not found/i.test(html) && /Refresh/.test(html),
    'FAILED: it does not claim absence, and offers the one action that changes the answer');
}
{
  const h = ctxFor({});
  ok(h.run(`_prodIncompletePaneHTML('item')`) === '',
    'COMPLETE: the helper stands aside so the caller reports a real not-found');
}

/* ---- all three panes route through it ------------------------------------ */

for (const [fn, noun] of [['_prodDetail', 'item'], ['_prodProjectDetail', 'project'], ['_prodBatchDetail', 'batch']]) {
  let body = '';
  try { body = grabFunc(fn); } catch (e) { body = ''; }
  ok(body && body.includes('_prodIncompletePaneHTML('),
    fn + ' consults the shared incomplete-pane answer before reporting absence');
}
ok(!/_prodDetail[\s\S]{0,4000}?terminalTailPending\)\s*\{[\s\S]{0,200}?prod-skeleton/.test(INDEX)
  || INDEX.indexOf('function _prodIncompletePaneHTML') < INDEX.indexOf('function _prodDetail'),
'the skeleton lives in the shared helper, not copied into one pane');

/* ---- and the tail marks the failure rather than accusing ------------------ */

const tail = grabFunc('_prodLoadTerminalTail');
/* Comments are stripped before this is examined. The first version of this
   assertion matched the repair's OWN comment -- which quotes the call it removed
   in order to explain why -- and reported the fix as absent. Searching source
   text for a call and hitting prose about that call is the same mistake as
   OPEN_REPAIRS 111's extractor: read the code, not the file. */
const tailCode = tail.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok(/_prodState\.terminalTailFailed = true;/.test(tailCode),
'the tail records that it failed');
ok(!/else if \(!settled\) \{[\s\S]{0,900}?_prodApplyDeepLinkFallback\(true\)/.test(tailCode),
'and no longer runs an AUTHORITATIVE fallback from an exit that established nothing');
ok(/_prodState\.terminalTailFailed = false;/.test(tailCode),
'a tail that lands clears the failure, so one bad read does not mute the notice for ever');

if (failures) {
  console.error('\nProduction incomplete-pane honesty checks FAILED');
  process.exit(1);
}
console.log('\nProduction incomplete-pane honesty checks passed');
