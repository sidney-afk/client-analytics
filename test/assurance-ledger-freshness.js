'use strict';

/*
 * The assurance ledger is a claim about EVIDENCE. It carries its own rule --
 * FRESH = age <= half the tier window, NEAR = half..full, EXPIRED = beyond --
 * and until 2026-08-22 nothing enforced it. Thirteen rows read FRESH while
 * every one of them was more than a month past its window, so the document
 * that exists to say "an expired proof is an expired proof" was asserting the
 * opposite, and only hand arithmetic could tell.
 *
 * What this refuses: a row claiming MORE freshness than its date supports,
 * judged as of the date the STATE COLUMN is stamped with. Anchoring there
 * rather than to today is deliberate -- it catches the overstatement at the
 * moment somebody writes it, and cannot turn a document nobody touched red
 * later. Drift against the current date belongs to
 * scripts/assurance-ledger-freshness.js, which reports and never fails.
 *
 * It must NOT be anchored to the header's "Last refreshed" stamp, which is what
 * the first version did. A restatement without a new cycle keeps that stamp
 * old, every row then computes FRESH against it, and a Tier-0 row last proven
 * three days before that stamp could be written back to FRESH in a column
 * stamped a month later and still pass.
 *
 * Understating is always allowed: writing EXPIRED on a fresh row is pessimism,
 * and an open gap is a legitimate reason to do it.
 */

const fs = require('fs');
const path = require('path');
const {
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
} = require('../scripts/assurance-ledger-freshness.js');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('PASS:', message);
  else { failures++; console.error('FAIL assurance-ledger-freshness:', message); }
}

// --- the boundaries of the ledger's own rule ---------------------------------
ok(computedState(0, 14) === 'FRESH', 'a proof taken today is FRESH');
ok(computedState(7, 14) === 'FRESH', 'exactly half the window is still FRESH');
ok(computedState(8, 14) === 'NEAR', 'one day past half the window is NEAR');
ok(computedState(14, 14) === 'NEAR', 'exactly the window is NEAR, not EXPIRED');
ok(computedState(15, 14) === 'EXPIRED', 'one day past the window is EXPIRED');
ok(TIER_WINDOW_DAYS[0] === 7 && TIER_WINDOW_DAYS[1] === 14 && TIER_WINDOW_DAYS[2] === 30,
  'the tier windows match the ledger Rules section');

// --- overstatement, in both directions ---------------------------------------
ok(overstates('FRESH', 'EXPIRED') === true, 'FRESH over an expired date is an overstatement');
ok(overstates('FRESH', 'NEAR') === true, 'FRESH over a near date is an overstatement');
ok(overstates('NEAR', 'EXPIRED') === true, 'NEAR over an expired date is an overstatement');
ok(overstates('EXPIRED', 'FRESH') === false, 'EXPIRED on a fresh row understates, which is allowed');
ok(overstates('', 'EXPIRED') === false, 'a cell with no recognisable state is not an overstatement');

// --- reading the cells the ledger actually contains --------------------------
ok(claimedState('NEAR (issuance half unproven in a real browser)') === 'NEAR',
  'a state word is read out of a cell that also carries prose');
ok(claimedState('CHURNED CANDIDATE — local visible sequence green') === '',
  'a cell with no state word claims nothing');
ok(lastProvenDate('**2026-07-17** (this run; prior 2026-07-15, invalidated same day)')
  .toISOString().slice(0, 10) === '2026-07-17',
'the LATEST date in a cell is the one the row stands on, not the narrated prior one');
ok(lastProvenDate('no date here at all') === null, 'a cell with no date yields no date');
ok(parseDay('2026-02-30') === null, 'an impossible calendar date is rejected rather than rolled over');
ok(ageInDays(parseDay('2026-07-20'), parseDay('2026-08-22')) === 33, 'age is counted in whole days');

// --- the real document -------------------------------------------------------
const markdown = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'testing', 'ASSURANCE_LEDGER.md'), 'utf8');
const rows = parseLedger(markdown);
ok(rows.length >= 15, 'every tier table row is parsed (' + rows.length + ' found)');
ok(rows.every(r => [0, 1, 2, 3].includes(r.tier)), 'every parsed row belongs to a known tier');
ok(rows.some(r => r.tier === 0), 'the Tier 0 table is reachable — the client-facing rows are the point');

const asOf = ledgerStateAsOfDate(markdown);
ok(!!asOf, 'the State column states the date it is true as of');
// Pin WHICH date it resolves, not merely that it found one. The first version
// asserted only truthiness, so reverting to the header's refresh stamp -- the
// exact bug review caught -- passed unnoticed.
const stateHeader = markdown.match(/\|\s*State \((20\d\d-\d\d-\d\d)\)\s*\|/);
ok(!!stateHeader, 'the tier tables carry a State (YYYY-MM-DD) stamp');
ok(asOf.toISOString().slice(0, 10) === stateHeader[1],
  'the anchor is the State column stamp itself — not the header refresh stamp, which is what made the first guard toothless');
const refreshLine = markdown.split('\n').find(l => /Last refreshed/i.test(l));
const refreshStamp = refreshLine && (refreshLine.match(/20\d\d-\d\d-\d\d/g) || []).pop();
ok(!refreshStamp || refreshStamp !== stateHeader[1] ? asOf.toISOString().slice(0, 10) !== refreshStamp : true,
  'and it is demonstrably a DIFFERENT date from the refresh stamp while the ledger is restated without a new cycle');
ok(rows.every(r => lastProvenDate(r.provenCell)), 'every row carries a date it can be judged against');

const overstated = evaluate(rows, asOf).filter(r => r.overstated);
ok(overstated.length === 0,
  'no row claims more freshness than its date supports, as of the State column\'s own stamp'
    + (overstated.length ? ' — ' + overstated.map(r => r.surface.slice(0, 40)
        + ' says ' + r.claimed + ', dates say ' + r.computed).join(' | ') : ''));

// The regression the first version shipped: a Tier-0 row proven three days
// before the REFRESH stamp but 36 days before the STATE stamp. Anchored to the
// refresh stamp it reads FRESH and passes; anchored to the State column it is
// EXPIRED and the FRESH claim is an overstatement.
const trap = [{ tier: 0, surface: 'trap', provenCell: '2026-07-17', stateCell: 'FRESH' }];
ok(evaluate(trap, parseDay('2026-07-20'))[0].overstated === false,
  'the trap row looks fine against the old refresh-stamp anchor — which is why that anchor was wrong');
ok(evaluate(trap, parseDay('2026-08-22'))[0].overstated === true,
  'and is caught against the State column stamp, which is what the guard now uses');

process.exit(failures ? 1 : 0);
