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

// The shipped regex, read out of the harness rather than copied here, so this suite
// cannot drift from what the harness really matches.
const hookSource = (src.match(/^const FILMING_TABS_HOOK = (\/.*\/[a-z]*);$/m) || [])[1];
if (!hookSource) throw new Error('missing FILMING_TABS_HOOK');

function makePayload(live) {
  const sandbox = {
    URL,
    LIVE_FILMING_TABS: live,
    FILMING_TABS_HOOK: new RegExp(hookSource.slice(1, hookSource.lastIndexOf('/')), hookSource.slice(hookSource.lastIndexOf('/') + 1)),
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

{
  // PR 1b: the Edge Function road is stubbed too, so a flag flip cannot send the harness live.
  const fn = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/filming-plan-tabs';
  const one = makePayload(false)(fn + '?doc=abc123');
  ok(one && one.ok === true && one.docId === 'abc123' && Array.isArray(one.tabs) && one.tabs.length === 0, 'function road, one Doc: same empty-tabs answer as the webhook');
  const bulk = makePayload(false)(fn + '?docs=abc123,def456&refresh=1');
  ok(bulk && bulk.ok === true && Object.keys(bulk.docs).join() === 'abc123,def456', 'function road, bulk: one entry per Doc');
  ok(bulk && Object.values(bulk.docs).every(e => e.ok === true && Array.isArray(e.tabs) && e.tabs.length === 0 && e.docId), 'each bulk entry is { ok, docId, tabs }');
  ok(makePayload(true)(fn + '?docs=abc123') === null, 'live opt-in bypasses the stub on the function road too');
  ok(makePayload(false)('https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/filming-plans') === null, 'the Filming Plans source-of-truth function is not stubbed');
  ok(makePayload(false)('https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/syncview_runtime_flags?select=value&key=eq.filming_plan_tabs_source') === null, 'the flag read is not stubbed: the page still reads the live flag');
}

ok(src.indexOf('const filmingTabsStub = _filmingTabsStubPayload(url);') > src.indexOf('const lh = url.match(LINEAR_HOOK);'), 'filming stub is installed after Linear safety mocks');
ok(src.indexOf('const filmingTabsStub = _filmingTabsStubPayload(url);') < src.indexOf('if (EXT.test(url) && (COURIER || commitThenFailMatch))'), 'filming stub is installed before the live courier');

console.log(`sxr-courier-filming-tabs-stub: ${pass} passed, ${fail} failed ${fail ? 'FAIL' : 'OK'}`);
process.exit(fail ? 1 : 0);
