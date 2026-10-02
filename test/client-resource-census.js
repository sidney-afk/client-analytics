'use strict';
/*
 * scripts/client-resource-census.js: the one query is a single read-only SELECT,
 * the report is built from numbers only, the detector steps point at real
 * catalog steps, and (when CENSUS_PSQL names a disposable PostgreSQL) the query
 * gives the exact counts scripts/client-resource-census-proof.sql expects.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const census = require('../scripts/client-resource-census.js');
let passed = 0; let failed = 0;
function ok(name, cond) { if (cond) { passed++; console.log('OK  ' + name); } else { failed++; console.log('FAIL ' + name); } }

const sql = census.buildQuery();
ok('the query is one read-only SELECT', (() => { try { return census.validateReadOnly(sql); } catch (_) { return false; } })());
ok('validateReadOnly refuses writes, several statements and non-selects',
  ['delete from clients', 'select 1; select 2', 'update public.clients set active = false', 'with x as (select 1) insert into t select * from x', 'drop table t', 'select 1 where true; drop table t']
    .every((q) => { try { census.validateReadOnly(q); return false; } catch (_) { return true; } }));
ok('validateReadOnly ignores a forbidden word inside a quoted string', census.validateReadOnly("select 'delete' as k"));
ok('the query reads base tables only (it works before the checklist migration is applied)',
  !/client_resources|client_sales_state|client_onboarding_progress\b(?!.*to_regclass)/.test(sql.replace(/to_regclass\('public\.[a-z_]+'\)/g, '')));
ok('every resource key is unique and is aggregated', new Set(census.RESOURCES.map((r) => r.key)).size === census.RESOURCES.length
  && census.RESOURCES.every((r) => sql.includes(`'${r.key}', jsonb_build_object('have'`)));
ok('the four routing lists are covered', census.ROUTING_LISTS.length === 4 && census.ROUTING_LISTS.every((l) => sql.includes(`'${l}'`)));

const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '2026-10-03-onboarding-checklist-tables.sql'), 'utf8');
ok('every detector step is a real catalog step', census.DETECTORS.every(([step]) => new RegExp(`\\('${step}',\\s*\\d+,`).test(migration)));
ok('research_done needs all three research fields, not just keywords', census.DETECTORS.some(([step, r]) => step === 'research_done' && r === 'research_complete')
  && /keywords[\s\S]*competitors[\s\S]*content_description/.test(census.RESOURCES.find((r) => r.key === 'research_complete').expr));
ok('every detector reads a resource the query produces', census.DETECTORS.every(([, r]) => census.RESOURCES.some((x) => x.key === r)));

const fake = { active_clients: 2, active_test_clients: 1, inactive_roster_rows: 3, checklist_installed: false,
  routing_lists: Object.fromEntries(census.ROUTING_LISTS.map((l) => [l, { entries: 4, not_an_active_roster_row: 1 }])),
  resources: Object.fromEntries(census.RESOURCES.map((r) => [r.key, { have: 1, missing: 1 }])) };
const shaped = census.shape(fake);
const text = census.formatText(shaped);
ok('the report lists every resource and the steps the system can tick', census.RESOURCES.every((r) => text.includes(r.label)) && census.DETECTORS.every(([s]) => text.includes(s)));
ok('a malformed response is refused', (() => { try { census.shape({}); return false; } catch (e) { return e.message === 'census_response_invalid'; } })());

(async () => {
  let sent;
  const result = await census.readCensus({ token: 'x', projectRef: 'abcdefghijklmnopqrst',
    fetchImpl: async (url, init) => { sent = { url, init }; return { ok: true, json: async () => [{ census: fake }] }; } });
  ok('it sends one POST of the read-only query and nothing else', sent.init.method === 'POST' && sent.url.endsWith('/database/query')
    && JSON.parse(sent.init.body).query === sql && Object.keys(JSON.parse(sent.init.body)).length === 1 && result.active_clients === 2);
  const refused = await census.readCensus({ token: '', projectRef: 'abcdefghijklmnopqrst', fetchImpl: async () => { throw new Error('no'); } }).then(() => false, (e) => e.message === 'census_config_missing');
  ok('no token, no call', refused);
  const failedHttp = await census.readCensus({ token: 'x', projectRef: 'abcdefghijklmnopqrst', fetchImpl: async () => ({ ok: false, status: 403 }) }).then(() => false, (e) => e.message === 'census_read_failed_http_403');
  ok('an HTTP failure is reported by status only', failedHttp);

  if (process.env.CENSUS_PSQL) {
    const proof = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'client-resource-census-proof.sql'), 'utf8');
    const [head, tail] = proof.split('-- @@QUERY@@');
    const full = head + '\n' + sql + '\n\\gset\n' + tail;
    const tmp = path.join(require('os').tmpdir(), 'census-proof-' + process.pid + '.sql');
    fs.writeFileSync(tmp, full);
    let out = '';
    try { out = execSync(process.env.CENSUS_PSQL + ' -q -v ON_ERROR_STOP=1 -f ' + tmp + ' 2>&1', { encoding: 'utf8' }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    fs.unlinkSync(tmp);
    console.log(out.trim().split('\n').slice(-3).join('\n'));
    ok('on a disposable PostgreSQL the counts are exactly the expected ones', /CLIENT_RESOURCE_CENSUS_PROOF_OK\s*$/.test(out));
  } else {
    console.log('NOTE database proof not run here (set CENSUS_PSQL to a disposable PostgreSQL to run it)');
  }
  console.log(`client-resource-census: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
