'use strict';
/*
 * The QA harness must not spend live n8n executions on filming-plan-tabs during
 * cold headless boots. It should return the empty-state contract by default and
 * allow an explicit env opt-in for deliberate live probes.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'qa', 'sxr_courier_lib.js'), 'utf8');

function extractFunction(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function ' + name);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function ' + name);
}

function makePayload(live) {
  const sandbox = {
    URL,
    LIVE_FILMING_TABS: live,
    FILMING_TABS_HOOK: /\/webhook\/filming-plan-tabs\b/,
  };
  vm.runInNewContext(extractFunction('_filmingTabsStubPayload') + '\nthis.payload = _filmingTabsStubPayload;', sandbox);
  return sandbox.payload;
}

let pass = 0;
let fail = 0;
function ok(cond, msg, detail) {
  if (cond) { pass++; console.log('  ok  ' + msg); }
  else { fail++; console.error('  FAIL ' + msg + (detail ? ' - ' + detail : '')); }
}

{
  const payload = makePayload(false)('https://synchrosocial.app.n8n.cloud/webhook/filming-plan-tabs?doc=abc123');
  ok(payload && payload.ok === true, 'stub returns ok:true by default');
  ok(payload && payload.docId === 'abc123', 'stub echoes the doc query parameter');
  ok(payload && Array.isArray(payload.tabs) && payload.tabs.length === 0, 'stub returns an empty tabs array');
}

{
  const payload = makePayload(false)('https://synchrosocial.app.n8n.cloud/webhook/sample-review-get?doc=abc123');
  ok(payload === null, 'non-filming webhooks are not stubbed');
}

{
  const payload = makePayload(true)('https://synchrosocial.app.n8n.cloud/webhook/filming-plan-tabs?doc=abc123');
  ok(payload === null, 'live opt-in bypasses the stub');
}

ok(src.indexOf('const filmingTabsStub = _filmingTabsStubPayload(url);') > src.indexOf('const lh = url.match(LINEAR_HOOK);'), 'filming stub is installed after Linear safety mocks');
ok(src.indexOf('const filmingTabsStub = _filmingTabsStubPayload(url);') < src.indexOf('if (EXT.test(url) && (COURIER || commitThenFailMatch))'), 'filming stub is installed before the live courier');

console.log(`sxr-courier-filming-tabs-stub: ${pass} passed, ${fail} failed ${fail ? 'FAIL' : 'OK'}`);
process.exit(fail ? 1 : 0);
