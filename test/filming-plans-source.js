'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-09-filming-plans-source.sql'), 'utf8');
const FN = fs.readFileSync(path.join(ROOT, 'supabase/functions/filming-plans/index.ts'), 'utf8');
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
ok(/create policy "anon read filming plans"[\s\S]*for select[\s\S]*to anon, authenticated[\s\S]*using \(true\)/.test(MIGRATION),
  'filming_plans must keep public read parity with the old sheet');
ok(/alter publication supabase_realtime add table public\.filming_plans/.test(MIGRATION),
  'filming_plans must be added to realtime publication');
ok(/Chelsey Scaffidi/.test(MIGRATION) && /Amanda Hanson/.test(MIGRATION) && /Adriana Rizzolo/.test(MIGRATION),
  'migration must seed the live SyncView filming plan rows');

ok(/\[functions\.filming-plans\]\s*\nverify_jwt = false/.test(CFG),
  'filming-plans function must be browser-callable because it does its own passphrase check');
ok(/Deno\.env\.get\("ONBOARDING_STAFF_KEY"\)/.test(FN), 'function must require ONBOARDING_STAFF_KEY');
ok(!/Deno\.env\.get\("CREDENTIALS_STAFF_KEY"\)/.test(FN), 'function must not accept the credentials staff key');
ok(/x-syncview-key/.test(FN) && /timingSafeEqual/.test(FN), 'function must verify the supplied onboarding key safely');
ok(FN.includes('docs\\.google\\.com\\/document\\/d\\/[A-Za-z0-9_-]+'),
  'function must validate Google Docs document links');
ok(/\.from\("filming_plans"\)[\s\S]*\.upsert/.test(FN), 'function must write filming_plans through Supabase service role');

ok(/id="navFilmingPlans"/.test(INDEX), 'main nav must include the Filming Plans tab');
ok(/navTo\('filming-plans'\)/.test(INDEX), 'Filming Plans nav must route to #filming-plans');
ok(/FAST_TABS = \[[^\]]*'filming-plans'/.test(INDEX), 'Filming Plans must be a fast tab');
ok(/var FAST = \[[^\]]*'filming-plans'/.test(INDEX), 'prepaint boot router must know the Filming Plans tab');
ok(/FILMING_PLANS_EF_URL/.test(INDEX), 'app must call the filming-plans Edge Function for writes');
ok(/\/rest\/v1\/filming_plans/.test(INDEX), 'app must read filming_plans from Supabase REST');
ok(/function renderFilmingPlansView/.test(INDEX), 'main Filming Plans view must exist');

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
ok(/_filmsRowsFromPlans/.test(kasperLoad), 'Kasper filming tab must convert shared rows into runway rows');
ok(!/fetch\(FILMING_PLANS_URL/.test(kasperLoad), 'Kasper filming tab must not fetch the sheet directly');

console.log('filming-plans source checks passed');
