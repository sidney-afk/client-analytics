'use strict';
/* write-path-refusal-coverage.js -- the failed-saves log (Priority 4).
 *
 * The log used to record refusals from Calendar, Samples, Production and
 * intake only. This suite makes "does every save report its refusals" a thing
 * that cannot quietly stop being true:
 *
 *   1. The page's own code is scanned for every place it sends something other
 *      than a plain read (fetch with a method other than GET, XMLHttpRequest,
 *      sendBeacon). Each one must be in test/fixtures/write-path-inventory.json
 *      with a decision, and each entry must still exist. A new save fails this
 *      until someone decides how its refusals are recorded.
 *   2. A decision of "reports" is checked against the source: the named
 *      function must call one of the recorders. "reports-in-callers" checks
 *      each named caller the same way.
 *   3. The two helpers every non-gateway save uses are run for real: they must
 *      hand back the same response and rethrow the same error, record a
 *      refusal once with only a status class and fixed words, and record
 *      nothing for a success.
 *   4. The audit document lists the same inventory (generated: run
 *      `node test/write-path-refusal-coverage.js --markdown`).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { scan, keyOf, functionSource } = require('./helpers/write-path-scan');

const ROOT = path.resolve(__dirname, '..');
const INVENTORY = path.join(__dirname, 'fixtures', 'write-path-inventory.json');
const DOC = path.join(ROOT, 'docs', 'audits', '2026-09-29-write-paths-refusal-coverage.md');
const RECORDERS = /_writeUiTrackSave\(|_writeUiRecordSaveFailure\(|_writeUiRecordFailure\(|_writeUiReportFailure\(|_tkRecordFailure\(/;
const STATUSES = {
  'reports': 'records its own refusals',
  'reports-in-callers': 'refusals are recorded by the caller that shows the error',
  'client-transport': 'shared with the client link; not modified',
  'read': 'a read sent as a POST; nothing is saved',
  'background': 'background or best-effort; not a save a person waits on',
  'telemetry': 'fire-and-forget log',
  'public-form': 'public visitor form; a report would be labelled as staff',
  'the-log': 'the failed-saves log itself',
};

const inventory = JSON.parse(fs.readFileSync(INVENTORY, 'utf8')).sites;

function markdown() {
  const rows = Object.keys(inventory).sort().map(key => {
    const [fragment, fn, target, method] = key.split('|');
    const e = inventory[key];
    const who = e.within ? e.within.join(', ') : (e.callers ? 'via ' + e.callers.join(', ') : '');
    return `| \`${fragment.replace(/\.part$/, '')}\` | \`${fn}\` | \`${target}\` ${method} | ${e.status} | ${who ? '`' + who.replace(/, /g, '`, `') + '`' : ''} | ${e.note.replace(/\|/g, '/')} |`;
  });
  return ['| Fragment | Function | Sends to | What it is | Recorded in | Notes |', '|---|---|---|---|---|---|'].concat(rows).join('\n');
}
if (process.argv.includes('--markdown')) { console.log(markdown()); process.exit(0); }

let passed = 0;
function ok(condition, message) { assert.ok(condition, message); passed += 1; console.log('  ok  ' + message); }

// 1. The inventory and the code agree, both ways.
const sites = scan();
const keys = [...new Set(sites.map(keyOf))].sort();
const listed = Object.keys(inventory).sort();
const unlisted = keys.filter(k => !listed.includes(k));
const stale = listed.filter(k => !keys.includes(k));
ok(unlisted.length === 0, `every request the page sends other than a read is in the inventory (${sites.length} sites, ${keys.length} entries)` + (unlisted.length ? ' -- missing: ' + unlisted.join('; ') : ''));
ok(stale.length === 0, 'the inventory names nothing that is no longer in the code' + (stale.length ? ' -- stale: ' + stale.join('; ') : ''));

// 2. Each decision holds.
const counts = {};
for (const key of listed) {
  const e = inventory[key];
  counts[e.status] = (counts[e.status] || 0) + 1;
  assert.ok(STATUSES[e.status], `${key}: unknown status "${e.status}"`);
  assert.ok(typeof e.note === 'string' && e.note.length >= 12, `${key}: needs a note saying why`);
  if (e.status === 'reports') {
    assert.ok(Array.isArray(e.within) && e.within.length, `${key}: "reports" names the function(s) that record`);
    for (const name of e.within) {
      const source = functionSource(name);
      assert.ok(source, `${key}: function ${name} not found`);
      assert.ok(RECORDERS.test(source), `${key}: ${name} does not record a refusal`);
    }
  }
  if (e.status === 'reports-in-callers' || (e.status === 'client-transport' && e.callers)) {
    assert.ok(Array.isArray(e.callers) && e.callers.length, `${key}: names the callers that record`);
    for (const name of e.callers) {
      const source = functionSource(name);
      assert.ok(source, `${key}: caller ${name} not found`);
      assert.ok(RECORDERS.test(source), `${key}: caller ${name} does not record a refusal`);
    }
  }
}
ok(true, 'each "reports" decision is backed by a recorder call in the named function, and each "reports-in-callers" by its callers: ' + Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', '));
ok(counts['reports'] >= 30, `at least 30 sites now record their own refusals (${counts['reports']})`);

// The log stores the operation name as its action: lowercase letters, digits and
// underscores, at most 40 (the server's own rule, so a name outside it is dropped).
{
  const { fragments, read } = require('./helpers/write-path-scan');
  const names = new Set();
  for (const fragment of fragments()) {
    const text = read(fragment);
    for (const m of text.matchAll(/(?:_writeUiTrackSave|_writeUiRecordSaveFailure|_writeUiRecordFailure)\(\s*'([a-z_]+)'\s*,\s*'([a-z0-9_]+)'/g)) names.add(m[2]);
    for (const m of text.matchAll(/_tkRecordFailure\('([a-z0-9_]+)'/g)) names.add(m[1]);
  }
  const bad = [...names].filter(n => !/^[a-z0-9_]{1,40}$/.test(n));
  ok(names.size >= 30 && bad.length === 0, `every operation name the page records is one the log accepts as an action (${names.size} names, ${bad.length} outside a-z, 0-9, _ and 40 characters)`);
}

// The saves the owner named.
for (const [needle, what] of [['_tplFlush', 'Templates'], ['_fpPostPlan', 'Filming plans'], ['_tplBrainPost', 'Templates brain change'], ['_calSaveCaptionPrompt', 'Caption prompts'], ['_wlPlanWriteRequest', 'Workload plan'], ['_wlDueWriteRequest', 'Workload due date'], ['_tkCancelRow', 'TikTok cancel'], ['_hpCall', 'Hiring'], ['_ccApi', 'Client credentials'], ['_caEditPost', 'Client profile']]) {
  const entry = Object.entries(inventory).find(([k]) => k.split('|')[1] === needle || (inventory[k].within || []).includes(needle));
  ok(entry && entry[1].status === 'reports', `${what} (${needle}) records its refusals`);
}

// 3. The two helpers, run for real against stand-ins for the log.
function makeSandbox() {
  const recorded = [];
  const sandbox = { recorded, String, Number, Math, Object, Promise, Error, Array, Date, Integer: undefined };
  sandbox._writeUiRecordFailure = (surface, operation, error, context) => { recorded.push({ surface, operation, error, context }); };
  vm.createContext(sandbox);
  vm.runInContext(functionSource('_writeUiRecordSaveFailure') + '\n' + functionSource('_writeUiTrackSave') + '\nthis.rec = _writeUiRecordSaveFailure; this.track = _writeUiTrackSave;', sandbox);
  return sandbox;
}
(async () => {
  {
    const sb = makeSandbox();
    let bodyRead = false;
    const refused = { ok: false, status: 503, json() { bodyRead = true; return Promise.resolve({ error: 'secret words' }); } };
    const got = await sb.track('templates', 'templates_save', { client_slug: 'x' }, async () => refused);
    ok(got === refused, 'a refused save hands back the very same response object');
    ok(bodyRead === false, 'the body of a refused response is never read by the recorder');
    ok(sb.recorded.length === 1 && sb.recorded[0].surface === 'templates' && sb.recorded[0].operation === 'templates_save', 'a refused save is recorded once, under its surface and operation name');
    ok(sb.recorded[0].error.status === 503 && sb.recorded[0].error.message === 'HTTP 503', 'only the status class and fixed words are recorded (status 503, "HTTP 503")');
    ok(sb.recorded[0].context.client_slug === 'x', 'the context ids are passed through untouched');
    ok(!('network' in sb.recorded[0].error), 'a refusal that reached a server is not marked as a network failure');
  }
  {
    const sb = makeSandbox();
    let originalRead = false;
    const refusedInBody = { ok: true, status: 200, json() { originalRead = true; return Promise.resolve({}); },
      clone() { return { json: () => Promise.resolve({ ok: false, error: 'private words' }) }; } };
    const got = await sb.track('captions', 'caption_prompt_save', {}, async () => refusedInBody);
    ok(got === refusedInBody && originalRead === false, 'an OK answer is returned untouched: only a clone of it is read');
    ok(sb.recorded.length === 1 && sb.recorded[0].error.message === 'save refused' && sb.recorded[0].error.status === undefined, 'a refusal sent as HTTP 200 with {"ok":false} is recorded once, in fixed words, with no status');
    const unreadable = { ok: true, status: 200, clone() { return { json: () => Promise.reject(new Error('not json')) }; } };
    await sb.track('captions', 'caption_prompt_save', {}, async () => unreadable);
    const goodBody = { ok: true, status: 200, clone() { return { json: () => Promise.resolve({ ok: true }) }; } };
    await sb.track('captions', 'caption_prompt_save', {}, async () => goodBody);
    ok(sb.recorded.length === 1, 'an OK answer that is not JSON, or says ok:true, records nothing');
  }
  {
    const sb = makeSandbox();
    const refused = { ok: false, status: 500 };
    const got = await sb.track('templates', 'templates_save', () => ({ client_slug: 'lazy' }), async () => refused);
    ok(got === refused && sb.recorded.length === 1 && sb.recorded[0].context.client_slug === 'lazy', 'a context given as a function is resolved when the refusal is recorded');
    const broken = await sb.track('templates', 'templates_save', () => { throw new Error('context blew up'); }, async () => refused);
    ok(broken === refused && sb.recorded.length === 2, 'a context that throws never breaks the save: it is recorded without ids and the response still comes back');
  }
  {
    const sb = makeSandbox();
    const fine = { ok: true, status: 200 };
    const got = await sb.track('templates', 'templates_save', {}, async () => fine);
    ok(got === fine && sb.recorded.length === 0, 'a successful save is returned as is and records nothing');
  }
  {
    const sb = makeSandbox();
    const failure = Object.assign(new Error('Failed to fetch'), { name: 'TypeError' });
    let thrown = null;
    try { await sb.track('filming', 'filming_plan_save', {}, async () => { throw failure; }); } catch (e) { thrown = e; }
    ok(thrown === failure, 'a request that never got an answer rethrows the very same error');
    ok(sb.recorded.length === 1 && sb.recorded[0].error.network === true && sb.recorded[0].error.status === undefined, 'and is recorded once as a network failure with no status');
  }
  {
    const sb = makeSandbox();
    const abort = Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' });
    try { await sb.track('workload', 'workload_plan_save', {}, async () => { throw abort; }); } catch (e) {}
    ok(sb.recorded.length === 1 && sb.recorded[0].error.network === true, 'a timeout (abort) counts as a request that got no answer');
  }
  {
    const sb = makeSandbox();
    sb.rec('calendar', 'calendar_reorder', new Error('calendar reorder EF HTTP 500'), null, { client_slug: 'x' });
    ok(sb.recorded[0].error.status === 500, 'a status written into an error message ("... HTTP 500") is recovered when there is no response');
    sb.rec('calendar', 'x', new Error('x'.repeat(500)), null, {});
    ok(sb.recorded[1].error.message.length === 200, 'a long message is cut to 200 characters');
    sb.rec('calendar', 'x', new Error('boom'), { status: 200 }, {});
    ok(sb.recorded[2].error.status === undefined, 'a 200 response is never recorded as a status');
  }

  // 4. The audit document carries the same inventory.
  const doc = fs.readFileSync(DOC, 'utf8');
  const begin = '<!-- inventory:begin -->', end = '<!-- inventory:end -->';
  ok(doc.includes(begin) && doc.includes(end), 'the audit document has its generated inventory block');
  const block = doc.slice(doc.indexOf(begin) + begin.length, doc.indexOf(end)).trim();
  ok(block === markdown().trim(), 'the audit document lists exactly the inventory (regenerate with --markdown)');

  console.log(`\nwrite-path-refusal-coverage: ${passed} checks passed`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
