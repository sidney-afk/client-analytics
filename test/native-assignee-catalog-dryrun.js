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
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
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
    for (let i = from; i <= to; i++) rows.push({ id: 'fixture-member-' + i, role: 'editor', team: 'video', active: true, default_for_team: false, linear_user_id: null });
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
  ok(twoPages.calls.every(call => /select=id,role,team,active,default_for_team,linear_user_id/.test(call.url) && !/name|email|slack/.test(call.url)),
    'eligibility and distinct coverage receive member ids; names and contact fields are not requested');
  for (const [label, options] of [['unknown total', { unknownTotal: true }], ['short page', { shortPage: true }], ['moving total', { movingTotal: true }]]) {
    let refused = '';
    try { await readRestComplete('https://example.invalid', 'k', fakeFetch(REST_PAGE + 3, options).fetch); } catch (error) { refused = error.message; }
    ok(/^unproven_roster_read/.test(refused), `a ${label} is refused as an unproven roster read, never reported`);
  }
  let oversize = '';
  try { await readRestComplete('https://example.invalid', 'k', fakeFetch(REST_PAGE * REST_MAX_PAGES + 1).fetch); } catch (error) { oversize = error.message; }
  ok(/^unproven_roster_read/.test(oversize) && /page budget/.test(oversize), 'a roster beyond the bounded page budget is refused rather than truncated');

  const response = (range, rows) => ({ status: 206, headers: { get: () => range }, json: async () => rows });
  const row = i => ({ id: 'fixture-member-' + i, role: 'editor', team: 'video', active: true, default_for_team: false, linear_user_id: null });
  const first = Array.from({ length: REST_PAGE }, (_, i) => row(i));
  const tail = [row(REST_PAGE), row(REST_PAGE + 1)];
  for (const [label, replies] of [
    ['overlapping response range', [response('0-499/502', first), response('0-1/502', tail)]],
    ['gap in response range', [response('0-499/502', first), response('501-502/502', tail)]],
    ['wrong range body length', [response('0-1/2', [row(0)])]],
    ['duplicate identity across pages', [response('0-499/502', first), response('500-501/502', [row(0), row(501)])]],
    ['duplicate identity within page', [response('0-1/2', [row(0), row(0)])]],
    ['missing member identity', [response('0-0/1', [{ role: 'editor', team: 'video', active: true }])]],
    ['invalid numeric total', [response('0-0/9007199254740992', [row(0)])]],
    ['nonempty zero-total response', [response('*/0', [row(0)])]],
    ['non-array body', [response('0-0/1', {})]],
  ]) {
    let reason = '';
    try { await readRestComplete('https://example.invalid', 'k', async () => replies.shift()); } catch (error) { reason = error.message; }
    ok(/^unproven_roster_read/.test(reason), label + ' is refused without reporting coverage');
  }
  ok((await readRestComplete('https://example.invalid', 'k', async () => response('*/0', []))).length === 0,
    'an exact empty roster is accepted as empty');

  // Run the real CLI, including each projection, into the real policy. Only
  // fetch / the psql subprocess are modeled; no provider or database is called.
  const scratchRoot = path.resolve(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(scratchRoot, 'native-catalog-cli-'));
  try {
    const roster = [
      { id: 'fixture-editor', role: 'editor', team: 'video', active: true, default_for_team: false, linear_user_id: null },
      { id: 'fixture-designer', role: 'designer', team: 'graphics', active: true, default_for_team: true, linear_user_id: null },
    ];
    const fixture = path.join(scratch, 'roster.json');
    fs.writeFileSync(fixture, JSON.stringify(roster));
    const preload = path.join(scratch, 'transport.cjs');
    fs.writeFileSync(preload, `
'use strict';
const assert=require('node:assert/strict');
const rows=JSON.parse(require('node:fs').readFileSync(process.env.CATALOG_FIXTURE,'utf8'));
globalThis.fetch=async(url,init)=>{
 const u=new URL(url);assert.equal(u.origin,'https://catalog.fixture.invalid');assert.equal(u.pathname,'/rest/v1/team_members');
 const fields=u.searchParams.get('select').split(',');
 const result=rows.map(r=>Object.fromEntries(fields.map(k=>[k,r[k]])));
 if(process.env.CATALOG_FAULT==='missing-id')delete result[0].id;
 const range=process.env.CATALOG_FAULT==='range'?'1-2/2':'0-1/2';
 return {status:200,headers:{get:()=>range},json:async()=>result};
};
require('node:child_process').spawnSync=(exe,args)=>{
 assert.equal(exe,'fixture-psql');assert.equal(args[args.indexOf('-h')+1],'127.0.0.1');
 const sql=args[args.indexOf('-c')+1];assert.match(sql,/from public.team_members/);
 const fields=/from \\(select ([\\s\\S]+) from public.team_members\\)/.exec(sql)[1];
 const includeId=/^id, role,/.test(fields);
 const result=/as mapped$/.test(fields)
  ?rows.map(({id,linear_user_id,...r})=>({...r,...(includeId?{id}:{}),mapped:!!linear_user_id}))
  :rows.map(r=>Object.fromEntries(fields.split(', ').map(k=>[k,r[k]])));
 return {status:0,stdout:JSON.stringify(result),stderr:''};
};
`);
    const script = path.resolve(__dirname, '../scripts/native-assignee-catalog-dryrun.js');
    const cli = (mode, fault = '') => {
      const r = spawnSync(process.execPath, ['--require', preload, script, mode, ...(mode === '--file' ? [fixture] : [])], {
        encoding: 'utf8', windowsHide: true, timeout: 10000,
        env: { ...process.env, CATALOG_FIXTURE: fixture, CATALOG_FAULT: fault, SUPABASE_URL: 'https://catalog.fixture.invalid', SUPABASE_ANON_KEY: 'fixture-only',
          NIR_PSQL: 'fixture-psql', NIR_PGHOST: '127.0.0.1', NIR_PGPORT: '1', NIR_PGUSER: 'fixture', NIR_PGDATABASE: 'fixture' },
      });
      let result; try { result = JSON.parse(r.stdout); } catch (_) {}
      return { ...r, result };
    };
    for (const mode of ['--file', '--rest', '--pg']) {
      const r = cli(mode);
      ok(r.status === 0 && r.result && r.result.ready === true && r.result.totals.rows === 2,
        mode + ' actual CLI projection feeds the same valid roster into native eligibility');
      ok(r.result && !/fixture-editor|fixture-designer|"(?:id|name|email|linear_user_id)"\s*:/.test(JSON.stringify(r.result)), mode + ' output contains aggregates only');
    }
    for (const fault of ['range', 'missing-id']) {
      const r = cli('--rest', fault);
      ok(r.status === 1 && !r.result && /unproven_roster_read/.test(r.stderr), 'actual REST CLI refuses ' + fault + ' without a readiness report');
    }
    for (const [label, mapping, refused] of [
      ['valid', 'lin_fixture_valid', 0], ['missing', null, 1],
      ['malformed', 'invalid id', 1], ['whitespace', '   ', 1],
    ]) {
      roster.forEach(member => { member.linear_user_id = mapping; });
      fs.writeFileSync(fixture, JSON.stringify(roster));
      const results = ['--file', '--rest', '--pg'].map(mode => cli(mode));
      ok(results.every(r => r.status === 0 && r.result && r.result.ready === true),
        label + ' mapping preserves native readiness through all three actual CLI readers');
      ok(results.every(r => r.result && ['video', 'graphics'].every(team => r.result.teams[team].provider_lane_would_refuse === refused)),
        label + ' mapping counts match across file, REST and PostgreSQL CLI readers');
      ok(results.every(r => r.result && !/lin_fixture_valid|invalid id|fixture-editor|fixture-designer|"(?:id|linear_user_id)"\s*:/.test(JSON.stringify(r.result))),
        label + ' mapping remains private in all three CLI reports');
    }
    roster[1].active = false;
    fs.writeFileSync(fixture, JSON.stringify(roster));
    for (const mode of ['--file', '--rest', '--pg']) {
      const r = cli(mode);
      ok(r.status === 2 && r.result && r.result.ready === false && r.result.teams.graphics.reasons.includes('default_designer_ineligible'),
        mode + ' actual CLI retains the inactive-default policy refusal');
    }
  } finally {
    const relative = path.relative(scratchRoot, path.resolve(scratch));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(scratch).startsWith('native-catalog-cli-')) throw new Error('refuse unscoped temporary cleanup');
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  if (failures) { console.error(`\n${failures} catalog dry-run check(s) failed`); process.exit(1); }
  console.log('\nNative assignee catalog dry-run checks passed');
})().catch(error => { console.error(error); process.exit(1); });
