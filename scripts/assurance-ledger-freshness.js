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
 *   node scripts/assurance-ledger-freshness.js [--as-of=YYYY-MM-DD]
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

// The header's own "Last refreshed" stamp. The unit test anchors its
// overstatement check here rather than to the current date: a row is judged
// against the day somebody wrote it, so the suite catches the mistake at the
// moment it is made and cannot spontaneously turn red later on a document
// nobody touched. Drift against TODAY is this script's job, not the suite's.
function ledgerRefreshedDate(markdown) {
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

function shorten(text, width) {
  const value = String(text || '').replace(/\s+/g, ' ');
  return value.length <= width ? value : value.slice(0, width - 1) + '…';
}

function main() {
  const asOfArg = process.argv.find(a => a.startsWith('--as-of='));
  const asOf = asOfArg ? parseDay(asOfArg.slice('--as-of='.length)) : new Date();
  if (!asOf) { console.error('--as-of must be YYYY-MM-DD'); return 0; }

  const evaluated = evaluate(parseLedger(fs.readFileSync(LEDGER, 'utf8')), asOf);
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
  TIER_WINDOW_DAYS,
  ageInDays,
  claimedState,
  computedState,
  evaluate,
  lastProvenDate,
  ledgerRefreshedDate,
  overstates,
  parseDay,
  parseLedger,
};

if (require.main === module) process.exit(main());
