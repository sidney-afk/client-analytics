#!/usr/bin/env node
'use strict';
/**
 * The samples nightly's opt-out assertion, and the two things it depends on.
 *
 * `qa/probes/sxr_gating_flags.js` asserts that `?sxr=0` refuses the
 * `#sample-reviews/...` route: no view mounted, and the hash cleared. The
 * hash is cleared by `navTo`, which runs at the END of boot — so reading it
 * behind a fixed sleep asks a question the page has not reached yet whenever
 * boot is slow. The lane's own history is that shape: red 2026-09-01, GREEN
 * 2026-09-02, red 2026-09-03, same assertion, no change to the opt-out path
 * between them.
 *
 * The probe now waits for `history.state.nav`, which `navTo` writes, instead
 * of for a duration. That makes the probe depend on a product detail, so this
 * suite pins BOTH ends: the probe waits for the signal, and `navTo` is still
 * what emits it. If someone stops writing `nav` into history state, the
 * nightly would otherwise start timing out for twenty seconds every night
 * with no explanation.
 *
 * What this suite is NOT: proof the race is gone. That is the next nightly.
 * It is proof the probe now asks its question after the event it depends on,
 * and reports which of the two failures happened.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

const ROOT = path.resolve(__dirname, '..');
const PROBE = fs.readFileSync(path.join(ROOT, 'qa', 'probes', 'sxr_gating_flags.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(cond, msg) {
    console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
    if (!cond) failures++;
}

/* ---- 1. the probe waits for the event, not for a duration --------------- */

// The opt-out block, bounded by its own two landmarks so the assertions below
// cannot drift onto some other part of the file.
const start = PROBE.indexOf("open(browser, '/index.html?sxr=0#sample-reviews/sidneylaruel')");
const end = PROBE.indexOf('route refused', start);
ok(start > 0 && end > start, 'the opt-out block is where this suite expects it');
const block = PROBE.slice(start, end);

ok(/waitForFunction\(\(\) => !!\(history\.state && history\.state\.nav\)/.test(block),
    'it waits for history.state.nav — the thing navTo writes when the route actually resolves');
ok(/timeout:\s*\d+/.test(block),
    'and the wait is bounded, so a page that never routes fails fast instead of hanging the lane');
ok(!/await sleep\(\d+\);[\s\S]*?location\.hash/.test(block),
    'the hash is no longer read behind a bare fixed sleep');
ok(/t\(offRouted, 'opt-out: boot finished routing/.test(PROBE),
    'the precondition is its own named check, so a timeout does not masquerade as a route-refusal failure');
ok(/routed=\$\{offRouted\}/.test(PROBE),
    'and the route-refusal failure line carries whether boot had routed at all');
ok(/routedTo="\$\{off\.routedTo\}"/.test(PROBE),
    'plus where it routed to, which is what distinguishes "still booting" from "routed and left the hash"');

/* ---- 2. navTo still emits the signal the probe waits for ---------------- */

const navTo = extractFunction(INDEX, 'navTo');
ok(typeof navTo === 'string' && navTo.length > 200, 'navTo extracts from index.html');
ok(/const state = \{\s*nav: page/.test(navTo),
    'navTo still builds a history state whose nav is the page — the probe waits on exactly this');
ok(/history\.pushState\(state, ''/.test(navTo) && /history\.replaceState\(state, ''/.test(navTo),
    'and still writes that state into history, which is what makes the wait resolve');
ok(/let hash = \(page !== 'home' \? '#' \+ page : ''\)/.test(navTo),
    'and routing home clears the hash, which is the behaviour the refused route is asserted against');

/* ---- 3. the opt-out branch must FALL THROUGH, not return ---------------- */

/* If the flag is off the boot must keep going and reach navTo; an early
   return there would leave the refused hash in the URL forever, and the probe
   would then be reporting a real defect rather than a race. Pinned so the two
   cannot be confused later. */
const branchAt = INDEX.indexOf("if (!_isClientLink && (hashRaw === 'sample-reviews'");
const sxrBranch = INDEX.slice(branchAt, INDEX.indexOf('// <<< SXR_END', branchAt));
ok(sxrBranch.length > 100 && sxrBranch.length < 2000, 'the boot-time samples route branch is bounded and small');
ok(/if \(_sxrOn\) \{[^}]*return; \}/.test(sxrBranch.replace(/\n/g, ' ')) || /if \(_sxrOn\)[\s\S]*return;/.test(sxrBranch),
    'the branch returns ONLY when samples is on');
const afterFlagCheck = sxrBranch.slice(sxrBranch.indexOf('if (_sxrOn)'));
ok((afterFlagCheck.match(/return;/g) || []).length === 1,
    'so with ?sxr=0 boot falls through and goes on to route normally — there is no second exit');

if (failures) {
    console.log('\n' + failures + ' check(s) failed.');
    process.exit(1);
}
console.log('\nSXR opt-out probe wiring checks passed');
