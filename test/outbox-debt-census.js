'use strict';

/*
 * Locks the mirror-outbox debt census.
 *
 * THE PROPERTY THAT MATTERS MOST HERE IS THE NEGATIVE ONE. A census that cannot
 * be taken must never be reported as zero debt. Everything else in this file is
 * ordinary; that one assertion is the reason the file exists.
 *
 * The debt this counts has the worst shape a bug can have: after
 * `linear_outbound_enabled` goes to `{"mode":"off"}` the worker stops READING
 * the queue but nothing stops ENQUEUING into it, so every mirror intent becomes
 * a row that will never be delivered and never fail. The outbound's own
 * `failed_write` alert fires on rows reaching `failed`; these never do. Without
 * this census, a client comment that never appeared looks exactly like a quiet
 * afternoon.
 */

const fs = require('fs');
const path = require('path');
const {
  MAX_AGE_MINUTES,
  NON_TERMINAL_STATUSES,
  VERDICTS,
  ageMinutes,
  assessDebt,
} = require('../scripts/outbox-debt-census');

let failures = 0;
function ok(condition, message) {
  if (!condition) {
    console.error('FAIL outbox-debt-census:', message);
    failures++;
  }
}

const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const minutesAgo = minutes => new Date(NOW - minutes * 60000).toISOString();
const counts = (pending = 0, failed = 0, shadow_ok = 0) => ({ pending, failed, shadow_ok });
const assess = (over = {}) => assessDebt({
  counts: counts(), oldestAt: null, nowMs: NOW, ...over,
});

// ---------------------------------------------------------------------------
// THE NEGATIVE CASE. Read this one first.
// ---------------------------------------------------------------------------
{
  // A hole in the census that happens to total zero across the statuses it DID
  // read. This is the exact shape a partial outage produces, and reporting it as
  // `clear` would be a watcher confidently announcing an empty queue it never
  // counted.
  const holed = assess({ counts: { pending: 0, failed: null, shadow_ok: 0 } });
  ok(holed.verdict === VERDICTS.UNREADABLE && holed.ok === false,
    'a census with an unreadable status must be UNREADABLE, never "zero debt"');
  ok(holed.total === null,
    'a holed census reports a null total, not the sum of the parts it managed to read');

  for (const status of NON_TERMINAL_STATUSES) {
    const one = assess({ counts: { ...counts(), [status]: null } });
    ok(one.ok === false && one.verdict === VERDICTS.UNREADABLE,
      `an unreadable ${status} count alone must fail the whole census`);
  }

  for (const value of [null, undefined, NaN, '0', Infinity, -Infinity]) {
    const decision = assess({ counts: { ...counts(), pending: value } });
    ok(decision.ok === false,
      `a non-finite count (${String(value)}) must fail, not be coerced to a number`);
  }

  // Rows exist, but their age cannot be established — so "mid-flight or stuck?"
  // is unanswerable, and unanswerable is not healthy.
  const ageless = assess({ counts: counts(4), oldestAt: null });
  ok(ageless.verdict === VERDICTS.UNREADABLE && ageless.ok === false,
    'rows with an unreadable oldest created_at must fail, not default to "draining"');
  const garbageAge = assess({ counts: counts(4), oldestAt: 'not-a-date' });
  ok(garbageAge.ok === false, 'an unparseable created_at is not treated as "now"');
}

// ---------------------------------------------------------------------------
// The ordinary ladder.
// ---------------------------------------------------------------------------
{
  const clear = assess();
  ok(clear.verdict === VERDICTS.CLEAR && clear.ok === true && clear.total === 0,
    'an empty queue for real clients is clear');

  const draining = assess({ counts: counts(3), oldestAt: minutesAgo(10) });
  ok(draining.verdict === VERDICTS.DRAINING && draining.ok === true,
    'rows inside the drain window are normal traffic, not an incident');

  const debt = assess({ counts: counts(3), oldestAt: minutesAgo(MAX_AGE_MINUTES + 1) });
  ok(debt.verdict === VERDICTS.DEBT && debt.ok === false,
    'rows older than the drain window are debt and must fail the run');
  ok(debt.total === 3 && debt.oldest_age_minutes === MAX_AGE_MINUTES + 1,
    'the debt report carries the count and the age, which are the two numbers an operator acts on');

  const justInside = assess({ counts: counts(1), oldestAt: minutesAgo(MAX_AGE_MINUTES - 1) });
  ok(justInside.ok === true, 'one minute inside the window must not page');
  const justOutside = assess({ counts: counts(1), oldestAt: minutesAgo(MAX_AGE_MINUTES + 1) });
  ok(justOutside.ok === false, 'one minute outside the window must page');

  // Debt in any single status, not just pending. `shadow_ok` rows are the ones
  // a `shadow`-mode drain will never pick up (index.ts:1050 drops shadow_ok from
  // normalStatuses unless mode is live), so they are the easiest to strand.
  for (const status of NON_TERMINAL_STATUSES) {
    const only = assess({
      counts: { ...counts(), [status]: 5 },
      oldestAt: minutesAgo(MAX_AGE_MINUTES + 30),
    });
    ok(only.verdict === VERDICTS.DEBT,
      `${status} alone, aged past the window, is debt — no status is exempt`);
  }
}

// The three counted statuses are the three the worker treats as work.
// `skipped` is terminal and deliberately absent: structurally-unsendable
// duplicates land there on purpose (linear-outbound/index.ts:1415-1436), and
// counting them would rebuild the permanent false alarm that comment prevents.
{
  ok(NON_TERMINAL_STATUSES.join(',') === 'pending,failed,shadow_ok',
    'the census counts exactly the three non-terminal statuses');
  ok(!NON_TERMINAL_STATUSES.includes('skipped'),
    'skipped is TERMINAL and is not debt — counting it recreates a permanent false alarm');
  ok(!NON_TERMINAL_STATUSES.includes('written'),
    'written is terminal success and is not debt');
  ok(!NON_TERMINAL_STATUSES.includes('stale'),
    'stale is TERMINAL too — the row was dispositioned and dropped, it is not waiting for anything');

  // The three counted statuses must all be legal values of the column. A typo
  // here would count zero forever and report a permanently clear queue, which
  // is the same lie as an unreadable census reported as clear.
  const constraint = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '2026-07-11-b4-linear-outbound.sql'), 'utf8');
  const allowed = /check \(status in \(([\s\S]*?)\)\)/.exec(constraint);
  ok(Boolean(allowed), 'the mirror_outbox status check constraint is readable');
  for (const status of NON_TERMINAL_STATUSES) {
    ok(allowed && allowed[1].includes(`'${status}'`),
      `${status} must be a legal mirror_outbox status — a typo would count zero forever`);
  }
}

// The read must be scoped to REAL clients. A census that silently includes test
// or legacy-parity rows reports a number nobody can act on.
{
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'outbox-debt-census.js'), 'utf8');
  ok(/legacy_parity=eq\.false/.test(source) && /test_only=eq\.false/.test(source),
    'every count is scoped to legacy_parity=false and test_only=false');
  ok(/method: 'HEAD'/.test(source) && /Prefer: 'count=exact'/.test(source),
    'counts come from an exact count, not from paging rows into memory');
  ok(/\/\\\/\(\\d\+\)\\s\*\$\//.test(source) || /match \? Number\(match\[1\]\) : null/.test(source),
    'a malformed count header resolves to null, never to zero');
  ok(!/sendAlert|monitoring-alert-relay/.test(source),
    'this watcher must NOT grow its own alarm — the dead-man\'s switch owns paging, latching and dedup');
  ok(/process\.exit\(1\)/.test(source), 'a finding must leave the process non-zero');
}

// ---------------------------------------------------------------------------
// Ages.
// ---------------------------------------------------------------------------
{
  ok(ageMinutes(minutesAgo(120), NOW) === 120, 'age is reported in whole minutes');
  ok(ageMinutes(new Date(NOW + 60000).toISOString(), NOW) === 0,
    'a future created_at clamps to zero rather than going negative');
  ok(ageMinutes(null, NOW) === null, 'an absent timestamp has no age, and no age is not zero age');
}

// ---------------------------------------------------------------------------
// PUBLIC SAFETY.
// ---------------------------------------------------------------------------
{
  const rendered = JSON.stringify(assess({ counts: counts(9), oldestAt: minutesAgo(9999) }));
  ok(!/slug|dedup|identifier|client/i.test(rendered),
    'the census reports statuses, counts and ages only');
  ok(!/https?:\/\//.test(rendered), 'no URL may reach the log');
  const keys = Object.keys(assess()).sort().join(',');
  ok(keys === 'counts,detail,max_age_minutes,ok,oldest_age_minutes,total,verdict',
    `the output shape is fixed and aggregate-only, got: ${keys}`);
}

// ---------------------------------------------------------------------------
// Wiring.
// ---------------------------------------------------------------------------
{
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'outbox-debt-census.yml'), 'utf8');
  ok(/schedule:/.test(workflow) && /- cron:/.test(workflow),
    'the census must be scheduled, not dispatch-only');
  ok(/node scripts\/outbox-debt-census\.js/.test(workflow), 'the workflow must run the census');
  ok(/if: always\(\)[\s\S]{0,300}?--heartbeat=outbox_debt_census/.test(workflow),
    'the heartbeat must be written even when the run failed');
  ok(!/LINEAR_/.test(workflow),
    'the census must hold no Linear credential — it exists to outlive Linear');

  const { LANES } = require('../scripts/monitoring-watchdog');
  const lane = LANES.find(entry => entry.key === 'outbox_debt_census');
  ok(Boolean(lane), 'the census must be a registered dead-man lane');
  ok(lane && !lane.retires_with,
    'this lane outlives Linear — the debt it counts only STARTS when the outbound flag goes off');
  ok(lane && Array.isArray(lane.hosts) && lane.hosts.includes('outbox-debt-census.yml'),
    'the lane must name its host so the suite can check the registry against reality');
}

console.log(failures
  ? `outbox-debt-census: ${failures} check(s) failed`
  : 'outbox-debt-census checks passed');
process.exit(failures ? 1 : 0);
