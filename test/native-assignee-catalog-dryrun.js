'use strict';
/*
 * The catalog dry-run's REST read is evidence only when it is COMPLETE. The
 * first draft fetched `limit=1000` and reported readiness from whatever came
 * back, so a roster larger than one page, or a server that never said how
 * large it was, could still print "ready". This drives readRestComplete with
 * a fake fetch: a two-page roster is read in full; an unknown total, a page
 * that stops short of the total, a total that moves between pages, and a
 * roster beyond the page budget are all refused as unproven, never reported.
 */
const path = require('path');
const { readRestComplete, REST_PAGE, REST_MAX_PAGES } = require(path.resolve(__dirname, '../scripts/native-assignee-catalog-dryrun.js'));

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function fakeFetch(total, options = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const range = /^(\d+)-(\d+)$/.exec(init.headers.Range);
    const from = Number(range[1]);
    const to = Math.min(Number(range[2]), total - 1);
    const rows = [];
    for (let i = from; i <= to; i++) rows.push({ role: 'editor', team: 'video', active: true, default_for_team: false, linear_user_id: null });
    const reportedTotal = options.unknownTotal ? '*' : options.movingTotal ? String(total + calls.length) : String(total);
    const body = options.shortPage && calls.length === 0 ? rows.slice(0, Math.max(0, rows.length - 1)) : rows;
    calls.push({ url, from, to });
    return {
      status: 206,
      headers: { get: name => (name.toLowerCase() === 'content-range' ? `${from}-${to}/${reportedTotal}` : null) },
      json: async () => body,
    };
  };
  return { fetch, calls };
}

(async () => {
  const twoPages = fakeFetch(REST_PAGE + 3);
  const rows = await readRestComplete('https://example.invalid', 'k', twoPages.fetch);
  ok(rows.length === REST_PAGE + 3 && twoPages.calls.length === 2 && twoPages.calls[1].from === REST_PAGE,
    'a roster larger than one page is read page by page until the exact total is reached');
  ok(twoPages.calls.every(call => /select=role,team,active,default_for_team,linear_user_id/.test(call.url) && !/name|email|slack/.test(call.url)),
    'only the columns the rule reads are requested');
  for (const [label, options] of [['unknown total', { unknownTotal: true }], ['short page', { shortPage: true }], ['moving total', { movingTotal: true }]]) {
    let refused = '';
    try { await readRestComplete('https://example.invalid', 'k', fakeFetch(REST_PAGE + 3, options).fetch); } catch (error) { refused = error.message; }
    ok(/^unproven_roster_read/.test(refused), `a ${label} is refused as an unproven roster read, never reported`);
  }
  let oversize = '';
  try { await readRestComplete('https://example.invalid', 'k', fakeFetch(REST_PAGE * REST_MAX_PAGES + 1).fetch); } catch (error) { oversize = error.message; }
  ok(/^unproven_roster_read/.test(oversize) && /page budget/.test(oversize), 'a roster beyond the bounded page budget is refused rather than truncated');
  if (failures) { console.error(`\n${failures} catalog dry-run check(s) failed`); process.exit(1); }
  console.log('\nNative assignee catalog dry-run checks passed');
})().catch(error => { console.error(error); process.exit(1); });
