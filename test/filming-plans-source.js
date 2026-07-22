'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-09-filming-plans-source.sql'), 'utf8');
const F88_MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-14-f88-safe-sensitive-read-revocations.sql'), 'utf8');
const FN = fs.readFileSync(path.join(ROOT, 'supabase/functions/filming-plans/index.ts'), 'utf8');
const STAFF_ROLE_AUTH = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/staff-role-auth.ts'), 'utf8');
const CFG = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL filming-plans-source:', msg);
    process.exit(1);
  }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return INDEX.slice(at, j + 1);
    }
  }
  throw new Error('unbalanced braces: ' + name);
}

ok(/create table if not exists public\.filming_plans/.test(MIGRATION), 'migration must create public.filming_plans');
ok(/client_slug text primary key/.test(MIGRATION), 'filming_plans must key by client_slug');
ok(/alter publication supabase_realtime add table public\.filming_plans/.test(MIGRATION),
  'filming_plans must be added to realtime publication');
ok(/revoke select on table public\.filming_plans from anon/.test(F88_MIGRATION),
  'F88 migration must revoke anonymous filming_plans reads');

ok(/\[functions\.filming-plans\]\s*\nverify_jwt = false/.test(CFG),
  'filming-plans function must be browser-callable because it does its own passphrase check');
ok(/Deno\.env\.get\("ONBOARDING_STAFF_KEY"\)/.test(FN), 'function must require ONBOARDING_STAFF_KEY');
ok(!/Deno\.env\.get\("CREDENTIALS_STAFF_KEY"\)/.test(FN), 'function must not accept the credentials staff key');
ok(/x-syncview-key/.test(FN)
  && /authorizeStaffKey\(supplied, \["admin", "smm", "creative"\], \[legacyKey\]\)/.test(FN)
  && /authorizeStaffKey\(supplied, \["admin"\], \[legacyKey\]\)/.test(FN)
  && /timingSafeEqual/.test(STAFF_ROLE_AUTH),
  'function must timing-safely allow staff reads while preserving admin-only writes');
ok(FN.indexOf('const authError = req.method === "GET"') < FN.indexOf('createClient(url, serviceKey'),
  'function must authenticate GET and POST before constructing a service-role client');
ok(FN.includes('docs\\.google\\.com\\/document\\/d\\/[A-Za-z0-9_-]+'),
  'function must validate Google Docs document links');
ok(/\.from\("filming_plans"\)[\s\S]*\.upsert/.test(FN), 'function must write filming_plans through Supabase service role');

ok(/id="navFilmingPlans"/.test(INDEX), 'main nav must include the Filming Plans tab');
ok(/navTo\('filming-plans'\)/.test(INDEX), 'Filming Plans nav must route to #filming-plans');
ok(/FAST_TABS = \[[^\]]*'filming-plans'/.test(INDEX), 'Filming Plans must be a fast tab');
ok(/var FAST = \[[^\]]*'filming-plans'/.test(INDEX), 'prepaint boot router must know the Filming Plans tab');
ok(/FILMING_PLANS_EF_URL/.test(INDEX), 'app must call the filming-plans Edge Function');
const loadPlans = grabFunc('_fpLoadFromSupabase');
ok(/_syncviewRequireStaffIdentity\(\)/.test(loadPlans)
  && /fetch\(FILMING_PLANS_EF_URL/.test(loadPlans)
  && /'X-Syncview-Key': ident\.key/.test(loadPlans),
  'app must load filming plans through the staff-gated Edge Function');
ok(!/\/rest\/v1\/filming_plans/.test(INDEX), 'app must not read filming_plans through anonymous PostgREST');
ok(!/fetch\(FILMING_PLANS_URL/.test(INDEX), 'app must not fail open to the public Sheets filming-plan source');
ok(!/table: 'filming_plans'/.test(INDEX), 'app must not subscribe anonymously to filming_plans realtime');
ok(/function renderFilmingPlansView/.test(INDEX), 'main Filming Plans view must exist');
ok(/function _linearInvalidatePlanMap/.test(INDEX), 'Linear filming-plan cache invalidator must exist');

const purgePlans = grabFunc('_fpPurgeSensitiveState');
ok(/filmingPlansData = null/.test(purgePlans)
  && /localStorage\.removeItem\(KASPER_FILMING_CACHE_KEY\)/.test(purgePlans)
  && /_kasperState\.filmingData = null/.test(purgePlans),
  'staff sign-out must purge in-memory and persisted filming-plan data');
const staffPurge = grabFunc('_syncviewStaffPurgeSensitiveState');
ok(/_fpPurgeSensitiveState/.test(staffPurge), 'global staff sign-out must invoke the filming-plan purge');
const loadKasperCache = grabFunc('_filmsLoadCache');
ok(/if \(!_syncviewStaffIdentityForHeaders\(\)\) return null/.test(loadKasperCache),
  'Kasper filming cache must not load before staff identity is reverified');

const setData = grabFunc('_fpSetData');
ok(/_linearInvalidatePlanMap/.test(setData),
  'refreshing shared filming plans must invalidate the Linear derived plan map');

const renderTemplate = grabFunc('renderClientTemplate');
ok(!/_tplFieldLink\(name, 'filming_plans_link'/.test(renderTemplate),
  'Templates must not directly edit filming_plans_link anymore');
ok(/_fpLinkForClient\(name, _tplGet\(name, 'filming_plans_link'\)\)/.test(renderTemplate),
  'Templates must resolve the master Doc through filming_plans first');

const mountTemplates = grabFunc('mountTemplatesView');
ok(/_fpEnsureLoaded\(false\)/.test(mountTemplates), 'Templates must load filming_plans for read-only cards');

const linearPlans = grabFunc('loadLinearPlanMap');
ok(/_fpEnsureLoaded\(\!\!force\)/.test(linearPlans), 'Linear form must resolve filming plans through the shared source');
ok(!/fetch\(FILMING_PLANS_URL/.test(linearPlans), 'Linear form must not fetch the sheet directly');

const kasperLoad = grabFunc('_kasperLoadFilming');
ok(/_fpEnsureLoaded\(\!\!forceRefresh\)/.test(kasperLoad), 'Kasper filming tab must resolve plans through the shared source');
ok(/_filmsRowsFromPlans/.test(kasperLoad), 'Kasper filming tab must convert shared rows into content-bank rows');
ok(!/fetch\(FILMING_PLANS_URL/.test(kasperLoad), 'Kasper filming tab must not fetch the sheet directly');

const contentBank = grabFunc('_filmsFetchContentBank');
ok(/\(p\.status \|\| ''\)\.toLowerCase\(\) === 'archived'/.test(contentBank)
  && /if \(!d \|\| d >= today\) total\+\+/.test(contentBank),
  'content bank must count active undated and today/future cards while excluding archived and past-dated cards');
const classify = grabFunc('_filmsClassify');
ok(/FILMING_CONTENT_RED_COUNT/.test(classify)
  && /FILMING_CONTENT_COVERED_COUNT/.test(classify)
  && /plan\.state === 'overdue'/.test(classify),
  'Filming status must combine content-bank thresholds with the filming-plan cycle');
ok(/FILMING_CONTENT_RED_COUNT = 10/.test(INDEX)
  && /FILMING_CONTENT_COVERED_COUNT = 21/.test(INDEX)
  && /FILMING_PLAN_SOON_DAYS = 14/.test(INDEX),
  'Filming content and plan thresholds must match the Kasper content-bank policy');
const planDetails = grabFunc('_filmsPlanDetails');
ok(/_filmsAddMonth\(latestPlanMonth, 2\)/.test(planDetails),
  'a monthly filming-plan tab must advance the next expected filming plan by two calendar months');
ok(/pieces of content/.test(INDEX) && /Latest filming plan:/.test(INDEX),
  'Kasper filming rows must show total content and the latest filming-plan month');
ok(/syncview_kasper_filming_v3/.test(INDEX),
  'Kasper filming cache version must invalidate earlier unknown tab results');

const logic = [
  grabFunc('_filmsAddMonth'),
  grabFunc('_filmsDaysUntil'),
  grabFunc('_filmsMonthShort'),
  grabFunc('_filmsLatestPlanMonth'),
  grabFunc('_filmsPlanDetails'),
  grabFunc('_filmsClassify'),
].join('\n');
const contentContext = {
  FILMING_CONTENT_RED_COUNT: 10,
  FILMING_CONTENT_COVERED_COUNT: 21,
  FILMING_PLAN_SOON_DAYS: 14,
  _filmsTodayISO: () => '2026-07-22',
};
vm.createContext(contentContext);
vm.runInContext(logic, contentContext);

function classifyContent(contentTotal, months, docUrl = 'https://docs.google.com/document/d/test') {
  const row = { contentTotal, months: new Set(months), docUrl };
  return { row, result: contentContext._filmsClassify(row) };
}

let sample = classifyContent(21, ['2026-06']);
assert.strictEqual(sample.result.status, 'amber', 'June plan with 21 pieces is soon when the August plan is due in ten days');
assert.strictEqual(sample.row.nextPlanMonth, '2026-08', 'June plan creates the expected August plan cycle');
assert.match(sample.result.reason, /Aug plan due in 10d/, 'soon state names the expected next plan month and deadline');

sample = classifyContent(21, ['2026-05']);
assert.strictEqual(sample.result.status, 'red', 'an expected July plan is red once it is overdue');

sample = classifyContent(10, ['2026-07']);
assert.strictEqual(sample.result.status, 'red', 'ten or fewer active pieces need a plan regardless of a later plan cycle');

sample = classifyContent(21, ['2026-07']);
assert.strictEqual(sample.result.status, 'green', '21 active pieces with a September plan cycle are covered');

sample = classifyContent(99, [], '');
assert.strictEqual(sample.result.status, 'red', 'missing filming Doc remains an immediate action item');

const tabLogic = [grabFunc('_filmsParseMonth'), 'async ' + grabFunc('_filmsFetchTabMonths')].join('\n');
const tabContext = {
  FILMING_PLAN_TABS_URL: 'https://example.test/filming-plan-tabs',
  Date: { now: () => 1 },
  fetch: async () => ({
    ok: true,
    json: async () => ({ tabs: [{ title: 'April 2026' }] }),
  }),
};
vm.createContext(tabContext);
vm.runInContext(tabLogic, tabContext);
(async () => {
  const tabResult = await tabContext._filmsFetchTabMonths('doc-id');
  assert.deepStrictEqual(Array.from(tabResult.months), ['2026-04'], 'tab reader must recognise a month-named tab from the live webhook shape');
  assert.deepStrictEqual(Array.from(tabResult.titles), ['April 2026'], 'tab reader must retain received titles instead of hiding them as unknown');
  assert.strictEqual(tabResult.read, true, 'successful tab lookup must be distinguished from an unavailable lookup');
  console.log('filming-plans source checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
