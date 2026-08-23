#!/usr/bin/env node
'use strict';

/*
 * Read-only: does the assurance ledger still claim what its dates support?
 *
 * `docs/testing/ASSURANCE_LEDGER.md` is a claim about EVIDENCE, not about the
 * site working, and it carries its own deterministic rule: FRESH = age <= half
 * the tier window, NEAR = half..full, EXPIRED = beyond it. Nothing enforced
 * that. On 2026-08-22 thirteen rows still read FRESH while every one of them
 * was more than a month past its window -- the ledger had quietly become the
 * opposite of what it exists to be, and the only way to notice was to do this
 * arithmetic by hand.
 *
 * This never fails. It prints the arithmetic so the answer is visible without
 * anyone having to want it. `test/assurance-ledger-freshness.js` is the half
 * with teeth: it refuses a row that claims MORE freshness than its date allows.
 *
 * Public-safe: surface names and dates only, all already in the repository.
 *
 *   node scripts/assurance-ledger-freshness.js [--as-of=YYYY-MM-DD] [--ledger=PATH]
 *   node scripts/assurance-ledger-freshness.js --gate     # exits 1 if a claim has lapsed
 */

const fs = require('fs');
const path = require('path');

const LEDGER = path.join(__dirname, '..', 'docs', 'testing', 'ASSURANCE_LEDGER.md');

// Windows in days, from the ledger's own Rules section. Tier 3 is
// "quarterly/on-change"; 90 days is the arithmetic reading of quarterly.
const TIER_WINDOW_DAYS = Object.freeze({ 0: 7, 1: 14, 2: 30, 3: 90 });
const STATES = Object.freeze(['FRESH', 'NEAR', 'EXPIRED']);

function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1
    || date.getUTCDate() !== Number(d)) return null;
  return date;
}

function ageInDays(proven, asOf) {
  return Math.floor((asOf.getTime() - proven.getTime()) / 86400000);
}

function computedState(ageDays, windowDays) {
  if (ageDays <= windowDays / 2) return 'FRESH';
  if (ageDays <= windowDays) return 'NEAR';
  return 'EXPIRED';
}

/*
 * A cell may UNDERSTATE freshness -- "EXPIRED" on a row proven this morning is
 * pessimistic, not dishonest, and an open gap is a legitimate reason to write
 * it. Overstating is the failure this exists to catch.
 */
function claimedState(stateCell) {
  const upper = String(stateCell || '').toUpperCase();
  for (const state of STATES) if (upper.includes(state)) return state;
  return '';
}

function overstates(claimed, computed) {
  if (!claimed) return false;
  return STATES.indexOf(claimed) < STATES.indexOf(computed);
}

// The last date in the "Last proven" cell is the one the row stands on: those
// cells often narrate a prior proof too ("2026-07-17 (prior 2026-07-15)").
function lastProvenDate(cell) {
  const found = String(cell || '').match(/20\d\d-\d\d-\d\d/g);
  if (!found || !found.length) return null;
  return found.map(parseDay).filter(Boolean).sort((a, b) => b - a)[0] || null;
}

/*
 * The date the STATE COLUMN claims to be true as of -- the `State (YYYY-MM-DD)`
 * stamp on the tier tables. This is what the unit test judges every claim
 * against, and picking it correctly is the whole guard.
 *
 * The first version anchored to the header's "Last refreshed" stamp instead,
 * and that defeated the purpose (caught in review, 2026-08-22). When the ledger
 * is restated arithmetically WITHOUT a new assurance cycle -- exactly what
 * happened on 2026-08-22, which deliberately kept the 2026-07-20 refresh stamp
 * -- every row computes FRESH against that old anchor, because the proofs were
 * days old when the cycle ran. A Tier-0 row last proven 2026-07-17 could be
 * written back to FRESH in a column stamped 2026-08-22 and sail through, which
 * is the precise mistake this exists to catch.
 *
 * Anchoring to the State column fixes both halves: a claim is judged against the
 * date its author stamped on it, so an overstatement is caught when written, and
 * a file nobody touches still cannot spontaneously turn the suite red.
 */
function ledgerStateAsOfDate(markdown) {
  const header = String(markdown).match(/\|\s*State \((20\d\d-\d\d-\d\d)\)\s*\|/);
  if (header) return parseDay(header[1]);
  // No stamped column: fall back to the refresh stamp rather than to today, so
  // an older ledger without the stamp is still judged against a fixed date.
  const line = String(markdown).split('\n').find(l => /Last refreshed/i.test(l));
  return line ? lastProvenDate(line) : null;
}

function parseLedger(markdown) {
  const rows = [];
  let tier = null;
  for (const line of String(markdown).split('\n')) {
    const heading = /^##\s+Tier\s+(\d)/.exec(line);
    if (heading) { tier = Number(heading[1]); continue; }
    if (/^##\s/.test(line) && !heading) { tier = null; continue; }
    if (tier == null || !line.startsWith('|')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
    if (cells.length < 7) continue;
    if (/^Surface$/i.test(cells[0]) || /^-+$/.test(cells[0])) continue;
    rows.push({ tier, surface: cells[0], provenCell: cells[1], stateCell: cells[5] });
  }
  return rows;
}

function evaluate(rows, asOf) {
  return rows.map(row => {
    const proven = lastProvenDate(row.provenCell);
    const windowDays = TIER_WINDOW_DAYS[row.tier];
    const age = proven ? ageInDays(proven, asOf) : null;
    const computed = age == null ? '' : computedState(age, windowDays);
    const claimed = claimedState(row.stateCell);
    return { ...row, proven, windowDays, age, computed, claimed, overstated: overstates(claimed, computed) };
  });
}

/*
 * HAS THE LEDGER STOPPED BEING TRUE SINCE IT WAS WRITTEN?
 *
 * The unit test judges every claim as of the date its author stamped on it, so
 * it catches an overstatement AT THE MOMENT IT IS WRITTEN and a file nobody
 * touches can never spontaneously turn red. That is the right rule for a test.
 * It is the wrong rule for an alarm, because the failure an alarm exists to
 * catch is precisely the one that arrives with nobody touching the file: a row
 * that was honestly FRESH the day it was written and has since rotted.
 *
 * So the monitor runs the SAME predicate against TODAY. A row is LAPSED when
 * the state written in the ledger is more optimistic than today's arithmetic --
 * the claim in the file has stopped being true. Two consequences worth stating
 * because both were chosen deliberately:
 *
 *  - It is GREEN on the day it ships even though 15 of 19 rows are past their
 *    window, because those rows already SAY they are expired. A gate that shipped
 *    permanently red is the exact failure docs/ops/PRE_FLIP_HEALTH_CHECK.md
 *    opens by blaming for teaching a team to discount its own gates. What is
 *    already known and already written down is not news.
 *  - It self-arms. Re-proving a row rewrites it to FRESH, and from then on it
 *    lapses -- and pages -- the day its window closes without a new proof.
 *
 * The stamp clause is the other half. A ledger can be restated pessimistically
 * (legal, and the 2026-08-22 precedent), which makes every row agree with its
 * own arithmetic and leaves nothing left to lapse. That state is honest and
 * completely uninformative, so it must not also be silent: if nobody has
 * restated or re-proven ANYTHING in STAMP_MAX_AGE_DAYS, that silence is the
 * finding. Sixty days is deliberately generous -- this is a backstop against an
 * abandoned ledger, not a nag.
 *
 * Everything else fails CLOSED. A missing State stamp, a table that stopped
 * parsing, a row whose "Last proven" cell holds no date -- each is an incident,
 * not a pass. An alarm whose most likely bug is silence is not an alarm.
 */
const STAMP_MAX_AGE_DAYS = 60;

function stalenessReport(markdown, asOf) {
  const statedAsOf = ledgerStateAsOfDate(markdown);
  const base = { ok: false, reason: '', stated_as_of: null, stamp_age_days: null, total_rows: 0, lapsed: [], counts: {} };
  if (!statedAsOf) return { ...base, reason: 'no_state_stamp' };

  const stamped = statedAsOf.toISOString().slice(0, 10);
  const stampAge = ageInDays(statedAsOf, asOf);
  const rows = evaluate(parseLedger(markdown), asOf);
  if (!rows.length) return { ...base, reason: 'no_rows_parsed', stated_as_of: stamped, stamp_age_days: stampAge };

  const unjudgeable = rows.filter(row => !row.computed);
  if (unjudgeable.length) {
    return {
      ...base,
      reason: 'unjudgeable_rows',
      stated_as_of: stamped,
      stamp_age_days: stampAge,
      total_rows: rows.length,
      lapsed: unjudgeable.map(row => ({ tier: row.tier, surface: row.surface, age: null, claimed: row.claimed, computed: '' })),
    };
  }

  const lapsed = rows
    .filter(row => overstates(row.claimed, row.computed))
    .map(row => ({ tier: row.tier, surface: row.surface, age: row.age, claimed: row.claimed, computed: row.computed }));
  const counts = {};
  for (const row of lapsed) counts[row.tier] = (counts[row.tier] || 0) + 1;

  const stampRotted = stampAge > STAMP_MAX_AGE_DAYS;
  const reasons = [];
  if (lapsed.length) reasons.push('rows_lapsed');
  if (stampRotted) reasons.push('stamp_unrefreshed');
  return {
    ok: !reasons.length,
    reason: reasons.join('+'),
    stated_as_of: stamped,
    stamp_age_days: stampAge,
    total_rows: rows.length,
    lapsed,
    counts,
  };
}

/*
 * The gate's own words, for the Actions log. Surface names are already public in
 * a tracked file in this public repo, so printing them here adds no exposure --
 * but nothing from this function goes near the Slack relay, which carries only
 * the lane name. Keep it that way: a surface name is repo-public, not DM-public.
 */
function gateLines(report) {
  const lines = [];
  if (report.reason === 'no_state_stamp') {
    lines.push('The ledger has no `State (YYYY-MM-DD)` stamp, so no claim in it can be judged.');
    return lines;
  }
  if (report.reason === 'no_rows_parsed') {
    lines.push('The ledger parsed to ZERO tier rows as of ' + report.stated_as_of + '. The table shape changed.');
    return lines;
  }
  if (report.reason === 'unjudgeable_rows') {
    lines.push(report.lapsed.length + ' row(s) carry no readable "Last proven" date:');
    for (const row of report.lapsed) lines.push('  T' + row.tier + '  ' + shorten(row.surface, 58));
    return lines;
  }
  if (report.reason.includes('rows_lapsed')) {
    lines.push(report.lapsed.length + ' row(s) no longer support the state written beside them'
      + ' (stated ' + report.stated_as_of + '):');
    for (const row of report.lapsed) {
      lines.push('  T' + row.tier + '  ' + String(row.age).padStart(3) + 'd  '
        + row.claimed + ' -> ' + row.computed + '  ' + shorten(row.surface, 58));
    }
  }
  if (report.reason.includes('stamp_unrefreshed')) {
    lines.push('The State column has not been restated in ' + report.stamp_age_days
      + ' days (limit ' + STAMP_MAX_AGE_DAYS + '), and nothing has been re-proven.');
  }
  return lines;
}

function shorten(text, width) {
  const value = String(text || '').replace(/\s+/g, ' ');
  return value.length <= width ? value : value.slice(0, width - 1) + '…';
}

function main() {
  const asOfArg = process.argv.find(a => a.startsWith('--as-of='));
  const asOf = asOfArg ? parseDay(asOfArg.slice('--as-of='.length)) : new Date();
  if (!asOf) { console.error('--as-of must be YYYY-MM-DD'); return 0; }
  const ledgerArg = process.argv.find(a => a.startsWith('--ledger='));
  const ledgerPath = ledgerArg ? ledgerArg.slice('--ledger='.length) : LEDGER;
  const markdown = fs.readFileSync(ledgerPath, 'utf8');

  /*
   * --gate is the ONLY mode that can exit non-zero, and it is what the monitored
   * workflow runs. The default report above it stays exit-0 forever: printing
   * the arithmetic must never be something a person avoids doing.
   */
  if (process.argv.includes('--gate')) {
    const report = stalenessReport(markdown, asOf);
    console.log('ASSURANCE LEDGER STALENESS as of ' + asOf.toISOString().slice(0, 10));
    if (report.ok) {
      console.log('  ok — every row still supports the state written beside it,');
      console.log('  and the State column was restated ' + report.stamp_age_days + ' day(s) ago.');
      return 0;
    }
    for (const line of gateLines(report)) console.log('  ' + line);
    console.log('');
    console.log('  Re-prove the surface, or restate the row to what its date supports.');
    console.log('  Either action clears this; test/assurance-ledger-freshness.js refuses');
    console.log('  a restatement that claims more than the dates allow.');
    return 1;
  }

  const evaluated = evaluate(parseLedger(markdown), asOf);
  if (!evaluated.length) { console.log('No tier rows found in the assurance ledger.'); return 0; }

  console.log('ASSURANCE LEDGER FRESHNESS as of ' + asOf.toISOString().slice(0, 10));
  console.log('  window: T0 7d · T1 14d · T2 30d · T3 90d (quarterly)');
  console.log('');
  let lastTier = null;
  for (const row of evaluated) {
    if (row.tier !== lastTier) {
      lastTier = row.tier;
      console.log('  Tier ' + row.tier + ' (' + row.windowDays + 'd)');
    }
    const age = row.age == null ? '  ?' : String(row.age).padStart(3) + 'd';
    const flag = row.overstated ? '  !! claims ' + row.claimed : '';
    console.log('    ' + age + '  ' + row.computed.padEnd(7) + '  ' + shorten(row.surface, 58) + flag);
  }

  const overstated = evaluated.filter(r => r.overstated);
  const expired = evaluated.filter(r => r.computed === 'EXPIRED');
  console.log('');
  console.log('  ' + expired.length + ' of ' + evaluated.length + ' rows are past their window.');
  if (overstated.length) {
    console.log('  ' + overstated.length + ' row(s) CLAIM more freshness than the dates support.');
    console.log('  A row here is a claim about evidence. Restate it or re-prove it;');
    console.log('  test/assurance-ledger-freshness.js refuses the overstatement.');
  } else {
    console.log('  No row claims more freshness than its date supports.');
  }
  return 0;
}

module.exports = {
  STAMP_MAX_AGE_DAYS,
  TIER_WINDOW_DAYS,
  ageInDays,
  claimedState,
  computedState,
  evaluate,
  lastProvenDate,
  ledgerStateAsOfDate,
  overstates,
  parseDay,
  parseLedger,
  gateLines,
  stalenessReport,
};

if (require.main === module) process.exit(main());
