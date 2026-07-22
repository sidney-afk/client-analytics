'use strict';
/*
 * archiveSafe should not POST a status-only archive for a row that does not
 * exist. The live Sample Review upsert has a phantom-row guard that correctly
 * rejects status-only creates; cleanup should poll for late rows, then archive
 * only if the row actually exists.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'qa', 'sxr_courier_lib.js'), 'utf8');
if (!/function _sleepSync\(ms\)\s*\{\s*Atomics\.wait\(/.test(src)) {
  throw new Error('archive retry delay must stay in-process');
}
if (/\bexecSync\b|_exec\(\s*['"`]sleep/.test(src)) {
  throw new Error('archive retry delay must not spawn a shell');
}

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

function makeSampleArchive(reads) {
  const calls = { up: [], supa: [], sleep: 0 };
  const sandbox = {
    up(sample) { calls.up.push(sample); return { ok: true }; },
    supa(qs) { calls.supa.push(qs); return reads.length ? reads.shift() : []; },
    _sleepSync(ms) { if (ms === 1500) calls.sleep++; },
  };
  vm.runInNewContext(extractFunction('archiveSafe') + '\nthis.archiveSafe = archiveSafe;', sandbox);
  return { archiveSafe: sandbox.archiveSafe, calls };
}

function makeCalendarArchive(reads) {
  const calls = { upCal: [], supaCal: [], sleep: 0 };
  const sandbox = {
    upCal(post) { calls.upCal.push(post); return { ok: true }; },
    supaCal(qs) { calls.supaCal.push(qs); return reads.length ? reads.shift() : []; },
    _sleepSync(ms) { if (ms === 1500) calls.sleep++; },
  };
  vm.runInNewContext(extractFunction('archiveCalSafe') + '\nthis.archiveCalSafe = archiveCalSafe;', sandbox);
  return { archiveCalSafe: sandbox.archiveCalSafe, calls };
}

let pass = 0;
let fail = 0;
function ok(cond, msg, detail) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.error('  ❌ ' + msg + (detail ? ' — ' + detail : '')); }
}

{
  const { archiveSafe, calls } = makeSampleArchive([[], []]);
  const res = archiveSafe('sr_missing', 2);
  ok(res === true, 'sample cleanup treats a repeatedly missing row as already clean', 'got ' + res);
  ok(calls.up.length === 0, 'sample cleanup does not POST archive for a missing row', 'up calls=' + calls.up.length);
  ok(calls.sleep === 2, 'sample missing-row retries use the in-process delay', 'sleep calls=' + calls.sleep);
}

{
  const { archiveSafe, calls } = makeSampleArchive([[{ status: 'In Progress' }], [{ status: 'Archived' }]]);
  const res = archiveSafe('sr_existing', 2);
  ok(res === true, 'sample cleanup archives an existing row');
  ok(calls.up.length === 1 && calls.up[0].status === 'Archived', 'sample cleanup POSTs archive exactly once for an existing row', JSON.stringify(calls.up));
}

{
  const { archiveSafe, calls } = makeSampleArchive([[], [{ status: 'In Progress' }], [{ status: 'Archived' }]]);
  const res = archiveSafe('sr_late', 3);
  ok(res === true, 'sample cleanup waits for a late row and archives it');
  ok(calls.up.length === 1, 'sample late-row cleanup avoids status-only phantom creates before the row appears', 'up calls=' + calls.up.length);
}

{
  const { archiveCalSafe, calls } = makeCalendarArchive([[], []]);
  const res = archiveCalSafe('cal_missing', 2);
  ok(res === true, 'calendar cleanup treats a repeatedly missing row as already clean', 'got ' + res);
  ok(calls.upCal.length === 0, 'calendar cleanup does not POST archive for a missing row', 'upCal calls=' + calls.upCal.length);
  ok(calls.sleep === 2, 'calendar missing-row retries use the in-process delay', 'sleep calls=' + calls.sleep);
}

{
  const { archiveCalSafe, calls } = makeCalendarArchive([[{ status: 'In Progress' }], [{ status: 'Archived' }]]);
  const res = archiveCalSafe('cal_existing', 2);
  ok(res === true, 'calendar cleanup archives an existing row');
  ok(calls.upCal.length === 1 && calls.upCal[0].status === 'Archived', 'calendar cleanup POSTs archive exactly once for an existing row', JSON.stringify(calls.upCal));
}

console.log(`sxr-courier-archive-safe: ${pass} passed, ${fail} failed ${fail ? '❌' : '✅'}`);
process.exit(fail ? 1 : 0);
