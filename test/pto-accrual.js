'use strict';

/*
 * PTO policy, private-schema, and Edge Function contract checks.
 *
 * The accrual engine intentionally lives as annotation-free JavaScript inside
 * the Edge Function. This suite extracts it directly so policy tests exercise
 * the production source without importing Deno or touching a live backend.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FN = fs.readFileSync(path.join(ROOT, 'supabase/functions/pto/index.ts'), 'utf8');
const POLICY = fs.readFileSync(path.join(ROOT, 'supabase/functions/pto/policy.js'), 'utf8');
const AUTH = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/staff-role-auth.ts'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-15-pto-tracker.sql'), 'utf8');
const CANCELLATION_MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-15-pto-cancellation-audit.sql'), 'utf8');
const FEATURE = fs.readFileSync(path.join(ROOT, 'docs/features/PTO_TRACKER.md'), 'utf8');
const DEPLOY_WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-pto-edge-functions.yml'), 'utf8');

function grabFunc(source, name) {
  const at = source.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    const char = source[j];
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return source.slice(at, j + 1);
    }
  }
  throw new Error('unbalanced braces: ' + name);
}

function grabConst(source, name) {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`).exec(source);
  if (!match) throw new Error('constant not found: ' + name);
  return match[0];
}

const policy = new Function([
  grabConst(POLICY, 'FLOATING_HOLIDAY_ALLOWANCE'),
  grabConst(POLICY, 'PTO_POLICY_TIME_ZONE'),
  grabFunc(POLICY, 'ptoPolicyToday'),
  grabFunc(POLICY, 'ptoFixedHolidays'),
  grabFunc(POLICY, 'countPtoDays'),
  grabFunc(POLICY, 'computePtoBalance'),
  'return { ptoPolicyToday, ptoFixedHolidays, countPtoDays, computePtoBalance };',
].join('\n'))();

const { ptoPolicyToday, ptoFixedHolidays, countPtoDays, computePtoBalance } = policy;
let failures = 0;

function ok(condition, message) {
  if (!condition) {
    failures++;
    console.error('FAIL pto-accrual:', message);
  }
}

function same(actual, expected, message) {
  ok(Object.is(actual, expected), `${message} (expected ${expected}, got ${actual})`);
}

function member(id, start) {
  return { member_id: id, pto_start_date: start, pto_enabled: true };
}

function approved(memberId, type, start, days, extra = {}) {
  return {
    id: `${memberId}-${type}-${start}`,
    member_id: memberId,
    type,
    start_date: start,
    end_date: start,
    days,
    status: 'approved',
    ...extra,
  };
}

same(ptoPolicyToday('2026-07-16T01:30:00Z'), '2026-07-15', 'Guatemala evening does not advance to the UTC date');
same(ptoPolicyToday('2026-07-16T06:00:00Z'), '2026-07-16', 'policy date advances at Guatemala midnight');
same(ptoPolicyToday('2026-01-01T05:59:59Z'), '2025-12-31', 'policy timezone remains stable across the winter UTC boundary');

function adjustment(memberId, kind, date, delta) {
  return { member_id: memberId, kind, effective_date: date, delta };
}

// Fixture A: anniversary reset on 2026-07-14 closes all earlier 2026 usage.
{
  const result = computePtoBalance(
    member('A', '2024-07-14'),
    [
      approved('A', 'wellness', '2026-03-02', 4),
      approved('A', 'sick', '2026-04-06', 1),
    ],
    [],
    '2026-07-15',
  );
  same(result.leave_year_start, '2026-07-14', 'Fixture A leave year resets on the hire anniversary');
  same(result.leave_year_end, '2027-07-13', 'Fixture A leave year ends before the next anniversary');
  same(result.wellness_granted, 0, 'Fixture A has no grant before the following first');
  same(result.wellness_used, 0, 'Fixture A closed-year wellness usage is excluded');
  same(result.wellness_available, 0, 'Fixture A wellness balance is 0.0');
  same(result.sick_available, 3, 'Fixture A sick allowance resets to 3.0');
  same(result.next_accrual_date, '2026-08-01', 'Fixture A next accrual is Aug 1');
}

// Fixture B: 6.0 policy baseline + monthly grants, followed by May 19 reset.
{
  const m = member('B', '2025-05-19');
  const beforeReset = computePtoBalance(m, [], [], '2026-05-18');
  same(beforeReset.wellness_granted, 9, 'Fixture B includes Feb baseline and Mar/Apr/May grants before reset');
  ok(beforeReset.wellness_grant_events.some((event) => event.date === '2026-02-06' && event.amount === 6),
    'Fixture B uses the 6.0 Feb 6 baseline for 6mo+ staff');

  const result = computePtoBalance(
    m,
    [approved('B', 'wellness', '2026-07-09', 1)],
    [],
    '2026-07-15',
  );
  same(result.leave_year_start, '2026-05-19', 'Fixture B resets on May 19');
  same(result.wellness_granted, 2, 'Fixture B grants 1.0 on Jun 1 and Jul 1 after reset');
  same(result.wellness_used, 1, 'Fixture B uses 1.0 day after reset');
  same(result.wellness_available, 1, 'Fixture B balance is 1.0');
}

// Fixture C: eligibility grant + four half-day months and a negative seed.
{
  const result = computePtoBalance(
    member('C', '2026-01-30'),
    [],
    [adjustment('C', 'wellness', '2026-06-15', -6)],
    '2026-07-15',
  );
  same(result.eligibility_date, '2026-03-31', 'Fixture C is eligible at exactly 60 days');
  same(result.wellness_granted, 4, 'Fixture C receives +2 and four 0.5 grants');
  same(result.wellness_used, 6, 'Fixture C negative migration adjustment records 6.0 used');
  same(result.wellness_available, -2, 'Fixture C safely represents a -2.0 seeded balance');
  same(result.tenure_bucket, '2-6mo', 'Fixture C has not crossed six months on Jul 15');
}

// Fixture D: May 31 eligibility, Jun/Jul half grants, and one sick day.
{
  const result = computePtoBalance(
    member('D', '2026-04-01'),
    [approved('D', 'sick', '2026-06-18', 1)],
    [],
    '2026-07-15',
  );
  same(result.eligibility_date, '2026-05-31', 'Fixture D eligibility date is May 31');
  same(result.wellness_granted, 3, 'Fixture D wellness grant total is 3.0');
  same(result.wellness_available, 3, 'Fixture D has 3.0 wellness available');
  same(result.sick_used, 1, 'Fixture D has one sick day used');
  same(result.sick_available, 2, 'Fixture D has 2.0 sick days remaining');
}

// Fixture E: 2.0 baseline, 0.5 Mar grant, then 1.0 after the bucket flip.
{
  const result = computePtoBalance(
    member('E', '2025-09-16'),
    [],
    [adjustment('E', 'wellness', '2026-07-01', -5)],
    '2026-07-15',
  );
  same(result.leave_year_start, '2025-09-16', 'Fixture E remains in its first leave year');
  same(result.wellness_granted, 6.5, 'Fixture E carries 2-6mo grants into the 6mo+ rate');
  same(result.wellness_used, 5, 'Fixture E records 5.0 seeded days used');
  same(result.wellness_available, 1.5, 'Fixture E balance is 1.5');
  ok(result.wellness_grant_events.some((event) => event.date === '2026-02-06' && event.amount === 2),
    'Fixture E uses the 2.0 Feb 6 baseline for eligible pre-6mo staff');
  ok(result.wellness_grant_events.some((event) => event.date === '2026-03-01' && event.amount === 0.5),
    'Fixture E uses the 0.5 monthly rate before six months');
  ok(result.wellness_grant_events.some((event) => event.date === '2026-04-01' && event.amount === 1),
    'Fixture E flips to the 1.0 rate on the next first and carries prior grants');
}

// Eligibility boundary and +2 initial grant.
{
  const m = member('eligibility', '2026-06-01');
  const before = computePtoBalance(m, [], [], '2026-07-30');
  const onDate = computePtoBalance(m, [], [], '2026-07-31');
  same(before.eligible, false, '59 days of tenure remains ineligible');
  same(before.wellness_granted, 0, 'no wellness grant before day 60');
  same(onDate.eligible, true, 'eligibility begins on day 60');
  same(onDate.wellness_granted, 2, '+2.0 lands immediately on eligibility day');
  same(onDate.sick_available, 3, 'full sick allowance lands on eligibility day');
}

// Both cap values and the reachable 12-day grant ceiling.
{
  const lowerBucket = computePtoBalance(member('cap6', '2026-04-01'), [], [], '2026-07-15');
  same(lowerBucket.wellness_cap, 6, '2-6mo annual cap is 6.0');
  ok(lowerBucket.wellness_granted <= 6, '2-6mo grants never exceed the 6.0 cap');

  const upperBucket = computePtoBalance(member('cap12', '2024-01-15'), [], [], '2027-01-14');
  same(upperBucket.wellness_cap, 12, '6mo+ annual cap is 12.0');
  same(upperBucket.wellness_granted, 12, 'monthly grants stop at the 12.0 cap');
}

// Sick resets by anniversary; floating holiday is calendar-year based.
{
  const m = member('other-buckets', '2024-07-14');
  const result = computePtoBalance(m, [
    approved('other-buckets', 'sick', '2026-07-13', 3),
    approved('other-buckets', 'floating_holiday', '2026-12-11', 1),
  ], [], '2026-07-15');
  same(result.sick_available, 3, 'sick usage from the closed anniversary year resets');
  same(result.floating_holiday_used, true, 'approved floating holiday reserves the calendar-year allowance');
  same(result.floating_holiday_available, 0, 'only one floating holiday is available per calendar year');
}

// Day counting: weekends and observed fixed holidays are excluded.
{
  same(countPtoDays('2026-07-22', '2026-07-29'), 6,
    'Wed Jul 22 through Wed Jul 29 excludes the weekend');
  same(countPtoDays('2026-07-01', '2026-07-03'), 2,
    'Jul 1-3 excludes Fri Jul 3 because Jul 4 2026 is observed then');
  const independenceDay = ptoFixedHolidays(2026).find((holiday) => holiday.name === 'Independence Day');
  same(independenceDay.date, '2026-07-04', 'holiday list retains the actual Independence Day date');
  same(independenceDay.observed_date, '2026-07-03', 'Saturday holidays are observed on Friday');
  const newYear = ptoFixedHolidays(2023).find((holiday) => holiday.name === "New Year's Day");
  same(newYear.observed_date, '2023-01-02', 'Sunday holidays are observed on Monday');
}

// A pending floating holiday reserves the single calendar-year allowance.
{
  const m = member('floating-pending', '2025-01-01');
  const result = computePtoBalance(m, [{
    member_id: m.member_id,
    type: 'floating_holiday',
    start_date: '2026-08-03',
    end_date: '2026-08-03',
    days: 1,
    status: 'pending',
  }], [], '2026-07-15');
  same(result.floating_holiday_status, 'pending', 'pending floating holiday reports pending status');
  same(result.floating_holiday_available, 0, 'pending floating holiday reserves the allowance');
}

// Feb-29 hires use a clamped Feb-28 anniversary in non-leap years.
{
  const result = computePtoBalance(member('leap', '2024-02-29'), [], [], '2025-02-28');
  same(result.leave_year_start, '2025-02-28', 'Feb-29 anniversary clamps to Feb 28 in 2025');
  same(result.leave_year_end, '2026-02-27', 'clamped leap-day leave year ends before the next anniversary');
}

// Additive private schema and default-dark rollback flag.
for (const table of ['pto_members', 'pto_requests', 'pto_adjustments']) {
  ok(new RegExp(`create table if not exists public\\.${table}`).test(MIGRATION),
    `migration creates ${table}`);
  ok(new RegExp(`alter table public\\.${table} enable row level security`).test(MIGRATION),
    `${table} has RLS enabled`);
  ok(new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`).test(MIGRATION),
    `${table} revokes public, anon, and authenticated access`);
  ok(new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`).test(MIGRATION),
    `${table} grants CRUD only to service_role`);
}
ok(!/create policy[\s\S]*pto_/i.test(MIGRATION), 'PTO tables deliberately define no RLS policies');
ok(!/alter publication[\s\S]*pto_/i.test(MIGRATION), 'PTO tables are not added to realtime');
ok(/values \('pto_v1', '\{"mode":"off"\}'::jsonb, 'migration'\)/.test(MIGRATION),
  'pto_v1 is seeded with mode off');
ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(MIGRATION)
  && !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(MIGRATION),
  'migration contains no personal or HR seed data');
ok(/Accepted launch risk and post-launch identity hardening/.test(FEATURE)
  && /Owner decision D-36[\s\S]*accepts that same-role impersonation\/visibility risk for[\s\S]*PTO launch/.test(FEATURE)
  && /Individually revocable server-side staff sessions remain the recommended post-launch hardening/.test(FEATURE),
  'living contract records D-36 while retaining individual sessions as post-launch hardening');
ok(/state_version bigint not null default 0/.test(MIGRATION),
  'PTO members carry a monotonic state version for approval serialization');
ok(/create unique index if not exists pto_requests_one_live_floating_per_year[\s\S]*floating_holiday[\s\S]*pending[\s\S]*approved/.test(MIGRATION),
  'database uniqueness reserves one pending or approved floating holiday per calendar year');
ok(/pto_requests_bump_member_state[\s\S]*pto_adjustments_bump_member_state[\s\S]*pto_members_bump_own_state/.test(MIGRATION),
  'all balance-affecting tables advance the member state version');
ok(/pto_decision_snapshot_v1[\s\S]*for update[\s\S]*pto_finalize_decision_v1[\s\S]*p_expected_state_version/.test(MIGRATION),
  'decision snapshot and finalize RPCs lock rows and compare the expected state version');
ok(/pto_finalize_decision_v1[\s\S]*p_decision = 'approved'[\s\S]*from public\.team_members[\s\S]*active is true[\s\S]*for update[\s\S]*from public\.pto_members[\s\S]*for update/.test(MIGRATION)
  && /pto_finalize_decision_v1[\s\S]*p_decision = 'approved'[\s\S]*active is true[\s\S]*member_inactive/.test(CANCELLATION_MIGRATION),
  'approval rechecks the active target under the shared team-then-profile lock order while denial remains available');
ok(/revoke all on function public\.pto_decision_snapshot_v1[\s\S]*grant execute on function public\.pto_finalize_decision_v1[\s\S]*service_role/.test(MIGRATION),
  'decision RPCs are executable only by service_role');
ok(/pto_create_request_v1[\s\S]*from public\.team_members[\s\S]*active is true[\s\S]*for update[\s\S]*p_expected_state_version[\s\S]*pto_set_member_start_v1[\s\S]*from public\.team_members[\s\S]*active is true[\s\S]*for update/.test(MIGRATION)
  && (CANCELLATION_MIGRATION.match(/active is true/g) || []).length >= 2,
  'request creation and first-time setup serialize on an active roster row and compare state versions');
ok(/revoke all on function public\.pto_create_request_v1[\s\S]*revoke all on function public\.pto_set_member_start_v1[\s\S]*grant execute[\s\S]*service_role/.test(MIGRATION),
  'transactional request and setup RPCs are executable only by service_role');
ok(/add column if not exists cancelled_by text[\s\S]*add column if not exists cancelled_at timestamptz/.test(CANCELLATION_MIGRATION),
  'cancellation audit delta keeps cancellation attribution separate from decisions');
ok(/enable row level security[\s\S]*revoke all on table public\.pto_requests from public, anon, authenticated[\s\S]*grant select, insert, update, delete[\s\S]*service_role/.test(CANCELLATION_MIGRATION),
  'cancellation audit delta reasserts the locked PTO table boundary');
ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(CANCELLATION_MIGRATION)
  && !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(CANCELLATION_MIGRATION)
  && !/(?:insert|update|delete)[\s\S]{0,120}syncview_runtime_flags/i.test(CANCELLATION_MIGRATION),
  'cancellation audit delta contains no HR rows or runtime-flag write');
ok(/push:[\s\S]*branches: \[main\]/.test(DEPLOY_WORKFLOW),
  'function-only PTO changes retain automatic main deployment');
ok(/git diff --name-only[\s\S]*migrations\/\.\*pto\.\*\\\.sql[\s\S]*should_deploy=false/.test(DEPLOY_WORKFLOW),
  'schema-bearing main pushes hold the dependent PTO function deploy');
ok(/migration_readback_confirmed:[\s\S]*type: boolean/.test(DEPLOY_WORKFLOW)
  && /MIGRATION_READBACK_CONFIRMED[\s\S]*!= "true"[\s\S]*exit 1/.test(DEPLOY_WORKFLOW),
  'manual PTO deploy requires an explicit migration readback confirmation');
ok(/GITHUB_REF_VALUE[\s\S]*refs\/heads\/main[\s\S]*Manual PTO deploys must run from the main branch/.test(DEPLOY_WORKFLOW),
  'manual PTO deploy rejects a workflow dispatch from any non-main ref');
ok(/SCHEMA_CONTRACT: \$\{\{ vars\.PTO_SCHEMA_CONTRACT \}\}[\s\S]*REQUIRED_SCHEMA_CONTRACT: transactional-writes-v1[\s\S]*SCHEMA_CONTRACT[\s\S]*REQUIRED_SCHEMA_CONTRACT[\s\S]*exit 1/.test(DEPLOY_WORKFLOW),
  'every actual deploy requires the read-back transactional schema contract latch');
ok(/concurrency:[\s\S]*group: deploy-pto-edge-function-production[\s\S]*cancel-in-progress: false/.test(DEPLOY_WORKFLOW),
  'PTO deploys serialize so an older checkout cannot finish after the newest production deploy');
ok((DEPLOY_WORKFLOW.match(/if: steps\.deploy_gate\.outputs\.deploy == 'true'/g) || []).length === 2,
  'CLI setup and deploy both depend on the migration-order gate');

// Edge Function authorization, API, and server-validation contract.
ok(/authorizeStaffKey\([\s\S]*adminOnly \? \["admin"\] : STAFF_ROLES/.test(FN),
  'the shared role-key helper enforces the per-action role matrix');
ok(/const adminOnly = action === "decide" \|\| action === "adjust" \|\| action === "set_start_date"/.test(FN),
  'decide, adjust, and set_start_date are admin-only');
ok(/staffAuthFailureStatus\(auth\)/.test(FN) && /return auth\.role \? 403 : 401/.test(AUTH),
  'known insufficient keys return 403 while unknown keys return 401');
ok(/timingSafeEqual/.test(AUTH), 'shared staff key matching is constant-time');
ok(/x-syncview-key, x-syncview-actor, x-syncview-role/.test(FN),
  'CORS permits all SyncView staff auth headers');
ok(/"Cache-Control": "no-store"/.test(FN), 'all function responses are no-store');
ok(/req\.method === "OPTIONS"[\s\S]*status: 204/.test(FN), 'CORS preflight returns 204');
ok(/normalized\(req\.headers\.get\("x-syncview-actor"\)\)/.test(FN)
  && /roleCompatible\(keyRole, member\)/.test(FN),
  'actor metadata must resolve to an exact active role-compatible roster member');
ok(/requestedId[\s\S]*UUID\.test\(requestedId\)/.test(FN),
  'caller member IDs are validated rather than trusted');
ok(/function ptoFeatureEnabled\(supabase: SupabaseClient\)[\s\S]*\.from\("syncview_runtime_flags"\)[\s\S]*\.eq\("key", "pto_v1"\)/.test(FN),
  'the Edge Function reads pto_v1 server-side before normal actions');
ok(/if \(error \|\| !data \|\| !data\.value[\s\S]*return false;[\s\S]*catch \(_error\) \{[\s\S]*return false;/.test(FN),
  'missing, malformed, and unreadable runtime-flag state fails closed');
ok(/const setupOnly = action === "adjust" \|\| action === "set_start_date";[\s\S]*if \(!setupOnly && !\(await ptoFeatureEnabled\(supabase\)\)\)[\s\S]*error: "feature_disabled" \}, 503/.test(FN),
  'only admin adjustment/member setup bypasses the off flag; normal actions return stable feature_disabled');
ok(FN.indexOf('await ptoFeatureEnabled(supabase)') < FN.indexOf('const data = await loadPtoData(supabase)'),
  'the server flag gate runs before any PTO/HR tables are loaded');

for (const action of ['overview', 'quote', 'request', 'decide', 'cancel', 'adjust', 'set_start_date']) {
  ok(FN.includes(`"${action}"`), `Edge Function exposes ${action}`);
}
ok(/countPtoDays\(startDate, endDate\)/.test(FN), 'request day count is recomputed server-side');
ok(/async function quoteTimeOff[\s\S]*requestSpanDays[\s\S]*countPtoDays[\s\S]*partial_day_count/.test(FN)
  && /action === "quote"[\s\S]*quoteTimeOff/.test(FN),
  'read-only quote applies the same authenticated server day-count policy outside the overview window');
ok(/if \(fullDays <= 0\) \{[\s\S]*ok: true,[\s\S]*full_days: 0,[\s\S]*partial_day_count: 0/.test(FN),
  'a valid weekend/holiday-only quote returns a non-submittable zero count instead of fixture-only failure semantics');
ok(/MAX_REQUEST_FULL_DAYS = 999/.test(FN)
  && (FN.match(/fullDays > MAX_REQUEST_FULL_DAYS/g) || []).length === 2
  && /request_range_too_long/.test(FN),
  'quote and request reject counts that cannot fit the numeric(4,1) days column');
ok(/const partialDayCount = Math\.max\(0\.5, fullDays - 0\.5\)/.test(FN)
  && /days !== fullDays && days !== partialDayCount/.test(FN),
  'request days must match the full count or one explicit half-day deduction');
ok(/type === "floating_holiday" && \(startDate !== endDate \|\| fullDays !== 1\)/.test(FN),
  'floating holidays are bound to one business date');
ok(/paidType\(type\) && endDate > String\(requestYearBalance\.leave_year_end/.test(FN)
  && /paidType\(request\.type\) && request\.end_date > String\(balance\.leave_year_end/.test(FN),
  'paid requests crossing a leave-year anniversary are rejected at request and approval');
ok(/Math\.round\(number \* 2\) === number \* 2/.test(FN),
  'request days and adjustments use 0.5-day increments');
ok(/insufficient_balance/.test(FN) && /decision === "approved"[\s\S]*computePtoBalance/.test(FN),
  'wellness balance is checked at request and rechecked at approval');
ok(/floatingAlreadyClaimed/.test(FN) && /floating_holiday_used/.test(FN),
  'floating holidays are limited server-side per calendar year');
ok(/const FLOATING_HOLIDAY_ALLOWANCE = 1;/.test(POLICY)
  && /!floatingUsed && !floatingPending \? FLOATING_HOLIDAY_ALLOWANCE : 0/.test(POLICY),
  'floating-holiday allowance is a single config constant and pending requests reserve it');
ok(/function loadAllPtoRows[\s\S]*\.order\("id"[\s\S]*\.gt\("id", cursor\)/.test(FN)
  && !/\.limit\(10000\)/.test(FN), 'PTO history uses stable UUID keyset paging without a fixed total-row cap');
ok(/async function loadMemberPolicySnapshot[\s\S]*attempt < 3[\s\S]*const before = await loadPtoMember[\s\S]*Promise\.all\([\s\S]*"pto_requests"[\s\S]*"pto_adjustments"[\s\S]*const after = await loadPtoMember[\s\S]*before\.state_version[\s\S]*after\.state_version[\s\S]*pto_request_snapshot_conflict/.test(FN),
  'quote/request history is bracketed by matching per-member state versions and retries on concurrent writes');
ok(/if \(action === "decide" \|\| action === "quote" \|\| action === "request"\)[\s\S]*quoteTimeOff\(supabase, caller[\s\S]*requestTimeOff\(supabase, caller[\s\S]*const data = await loadPtoData/.test(FN),
  'quote and request avoid the inconsistent global history loader');
ok(/const asOfMonthStart = asOf\.slice\(0, 8\) \+ "01";[\s\S]*dateShiftMonths\(asOfMonthStart, -3\)[\s\S]*dateShiftMonths\(asOfMonthStart, 4\)/.test(FN),
  'overview returns complete boundary months for the calendar window');
const absenceBlock = FN.slice(FN.indexOf('const absences ='), FN.indexOf('const year =', FN.indexOf('const absences =')));
ok(/member_name:[\s\S]*start_date:[\s\S]*end_date:/.test(absenceBlock)
  && /names\.has\(row\.member_id\)/.test(absenceBlock)
  && !/\bid:|\bmember_id:|\btype:|\bdays:/.test(absenceBlock),
  'non-admin calendar absences expose only active-roster names and date ranges');
ok(/upcoming_approved_requests[\s\S]*row\.status === "approved"[\s\S]*row\.start_date > asOf/.test(FN),
  'admin overview separately exposes only future approved requests for cancellation');
ok(/wellness_approved_used:[\s\S]*wellness_adjustment:[\s\S]*sick_approved_used:[\s\S]*sick_adjustment:/.test(FN),
  'admin balances separate approved leave from balance adjustments');
ok(/\.from\("pto_requests"\)/.test(FN) && /\.from\("pto_adjustments"\)/.test(FN)
  && /\.from\("pto_members"\)/.test(FN),
  'all PTO persistence routes through the service-role Edge Function');
ok(/for \(let attempt = 0; attempt < 3; attempt \+= 1\)[\s\S]*\.rpc\("pto_decision_snapshot_v1"[\s\S]*\.rpc\("pto_finalize_decision_v1"[\s\S]*finalStatus === "stale"/.test(FN),
  'approval retries a versioned transactional snapshot instead of racing distinct request rows');
ok(/createStatus === "floating_holiday_used"[\s\S]*error: "floating_holiday_used"/.test(FN)
  && /when unique_violation[\s\S]*p_type = 'floating_holiday'[\s\S]*floating_holiday_used/.test(MIGRATION),
  'floating-holiday uniqueness conflicts return a stable 409 policy error');
ok(/createStatus === "member_not_found"[\s\S]*error: "member_not_found"[\s\S]*setStatus === "member_not_found"[\s\S]*error: "member_not_found"/.test(FN),
  'a roster deactivation racing request/setup returns a stable inactive-member response');
ok(/finalStatus === "member_inactive"[\s\S]*error: "member_inactive" \}, 409/.test(FN),
  'approval of an offboarded target returns a stable conflict instead of a generic failure');
ok(/request\.status === "pending" \|\| request\.status === "approved"/.test(FN)
  && /cancelled_by: caller\.name, cancelled_at: now/.test(FN)
  && /missingAuditColumns[\s\S]*request\.status === "approved"[\s\S]*cancellation_audit_not_ready/.test(FN),
  'admin cancellation is lifecycle-bounded and fails closed rather than erasing approval attribution before migration');
ok(/const hasHistory = data\.requests\.some[\s\S]*data\.adjustments\.some[\s\S]*start_date_history_conflict/.test(FN),
  'member setup refuses to reinterpret an existing leave history under a new start date');
ok(/\.rpc\("pto_create_request_v1"[\s\S]*p_expected_state_version/.test(FN)
  && /\.rpc\("pto_set_member_start_v1"[\s\S]*p_expected_state_version/.test(FN),
  'request insertion and start-date setup use versioned transactional database RPCs');
ok((FN.match(/ptoPolicyToday\(\)/g) || []).length >= 4 && !/function utcToday/.test(FN),
  'all date-based Edge rules use the explicit company policy timezone');
ok(!/n8n/i.test(FN), 'the PTO Edge Function has no n8n dependency');
ok(/from "\.\/policy\.js"/.test(FN)
  && /export \{ computePtoBalance, countPtoDays, ptoFixedHolidays, ptoPolicyToday \} from "\.\/policy\.js";/.test(FN),
  'the Edge Function imports and re-exports the checked policy module used by the offline suite');
ok(/export function computePtoBalance\(member, requests, adjustments, asOfDate\)/.test(POLICY),
  'computePtoBalance remains annotation-free plain JavaScript for offline extraction');

if (failures) {
  console.error(`\n${failures} PTO check(s) failed`);
  process.exit(1);
}
console.log('PTO accrual, schema, and Edge Function checks passed');
