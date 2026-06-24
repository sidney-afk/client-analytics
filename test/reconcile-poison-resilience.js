'use strict';
/*
 * Reconciler resolution must survive a DEAD Linear link in a batch — regression for
 * THUMBNAIL_DESYNC_INCIDENT_2026-06-24.md.
 *
 * Run:  node test/reconcile-poison-resilience.js   (exit 0 = all good)
 *
 * BUG. scripts/linear-sync-reconcile.js resolves every card's Linear status through the
 * shared `linear-issue-statuses` webhook, which packs a batch into ONE aliased GraphQL
 * query. Linear nulls the WHOLE response if any single id doesn't exist (a deleted issue
 * / stale link), the webhook swallows that as {ok:true, statuses:{}}, and the reconciler
 * marked every card in that batch "missing" → skipped forever. ~289 dead links on
 * archived cards were poisoning the live cards batched alongside them (132 live
 * components dropped every run), so dropped sync events never healed.
 *
 * FIX. (1) Resolve LIVE links only (archived cards — where all the dead links live — are
 * no longer resolved). (2) resolveLinear retries any id a batch failed to return ONE AT
 * A TIME, so a dead link can only ever drop itself, never its batch-mates. This harness
 * proves (2) directly with a mocked webhook, and (1) by inspecting the source.
 */
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'linear-sync-reconcile.js'), 'utf8');

// Grab a (possibly async) top-level function body by brace-matching.
function grabFunc(name) {
  let at = SRC.indexOf('async function ' + name + '(');
  if (at < 0) at = SRC.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return SRC.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}

// --- Build resolveLinear + postStatuses in a sandbox with a mocked webhook -----------
const DEAD = 'VID-404';                                   // a deleted issue: never resolves
const _calIdentFromUrl = (u) => { const m = String(u || '').match(/([A-Za-z]+-\d+)/); return m ? m[1].toUpperCase() : null; };
const sleep = () => Promise.resolve();
const logs = [];
const log = (s) => logs.push(s);
let calls = 0;
// Mocked webhook: mirrors the real failure mode. A batch that contains the dead id and
// more than one link comes back EMPTY (Linear nulled the whole aliased query); any other
// call resolves every live id it was asked for (and omits the dead one).
const fetchMock = (url, opts) => {
  calls++;
  const issues = JSON.parse(opts.body).issues || [];
  const ids = issues.map(_calIdentFromUrl);
  const poisoned = ids.includes(DEAD) && issues.length > 1;
  const statuses = {};
  if (!poisoned) for (const id of ids) if (id !== DEAD) statuses[id] = 'For SMM approval';
  return Promise.resolve({ json: () => Promise.resolve({ ok: true, statuses }) });
};
const make = new Function(
  'fetch', 'sleep', 'log', 'LINEAR_STATUSES_URL', '_calIdentFromUrl',
  grabFunc('postStatuses') + '\n' + grabFunc('resolveLinear') + '\n;return { resolveLinear };'
);
const { resolveLinear } = make(fetchMock, sleep, log, 'http://mock', _calIdentFromUrl);

const U = (id) => `https://linear.app/synchro-social/issue/${id}/x`;

(async () => {
  console.log('— A dead link in a batch must NOT blind its live batch-mates —');
  const out = await resolveLinear([U('VID-1'), U('GRA-2'), U('VID-3'), U(DEAD)]);
  check('live VID-1 still resolved despite the dead link', out['VID-1'], 'For SMM approval');
  check('live GRA-2 still resolved despite the dead link', out['GRA-2'], 'For SMM approval');
  check('live VID-3 still resolved despite the dead link', out['VID-3'], 'For SMM approval');
  check('the genuinely-dead link stays unresolved (correct)', out[DEAD] === undefined, true);
  check('it logged the heal (poison detected + recovered)', /dropped by batch/.test(logs.join('\n')), true);

  console.log('\n— A clean batch resolves in one shot (no per-link retries) —');
  calls = 0; logs.length = 0;
  const clean = await resolveLinear([U('VID-10'), U('VID-11')]);
  check('both resolved', clean['VID-10'] === 'For SMM approval' && clean['VID-11'] === 'For SMM approval', true);
  check('only the single batch call was made (no fallback fired)', calls, 1);

  console.log('\n— Source: resolution is scoped to LIVE cards, and the retry exists —');
  check('urls are built from `canonical` (live), not every card',
    /for \(const p of canonical\)[^]*?linear_issue_id/.test(SRC), true);
  check('the old all-cards resolution loop is gone',
    /for \(const p of cards\)\s*\{\s*if \(p\.linear_issue_id\)/.test(SRC), false);
  check('resolveLinear retries missing links individually',
    /postStatuses\(\s*\[u\]\s*\)/.test(grabFunc('resolveLinear')), true);

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nAll reconcile-poison-resilience checks passed.');
})();
