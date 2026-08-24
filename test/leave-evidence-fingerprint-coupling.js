'use strict';
/*
 * The leave-lifecycle evidence packet is fingerprinted by TOKEN MATCH, and a
 * CSS class name is a token.
 *
 * qa/pto-lifecycle/run.js hashes only the lines of index.html that match
 * PTO_SOURCE_TOKEN, on the stated intent that "unrelated edits don't stale the
 * PTO evidence". A class name like `pto-card-head` matches that token wherever
 * it appears — including in a completely different feature's markup.
 *
 * On 2026-08-24 the Kasper Ad Performance panel (#1127) shipped reusing six of
 * those class names for its card chrome. No leave code changed, no leave pixel
 * moved, and the published 101-screenshot packet became "stale for the current
 * source tree" — turning that lane red on main for every subsequent PR. The
 * only sanctioned way out is a human re-review of all 101 shots, so the false
 * alarm is expensive as well as wrong.
 *
 * Two things are pinned here:
 *
 *   1. The panel styles itself, so the coupling cannot return by accident.
 *   2. The published fingerprint still matches the current tree — the check
 *      the CI lane makes, run cheaply here so a stale packet is caught in the
 *      unit suite instead of eleven minutes into a browser job.
 *
 * The second assertion is the one that will fail again some day, and that is
 * the point: when it does, the question to ask first is whether the leave
 * source ACTUALLY changed, or whether something merely borrowed its names.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const { canonicalSourceText, ptoSourceSlice } = require(path.join(ROOT, 'qa', 'pto-lifecycle', 'review.js'));

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- 1. The panel wears its own class names --------------------------------
/*
 * Sliced by function boundary rather than by scanning the whole file: the
 * leave feature is of course entitled to its own class names, and only THIS
 * panel is being held to the rule.
 */
const panelStart = source.indexOf('const _kadState = {');
const panelEnd = source.indexOf('function _kasperRenderSalesIntake(');
ok(panelStart > 0 && panelEnd > panelStart,
  'the ad-performance panel is still findable between its state object and the next Kasper panel');
const panel = source.slice(panelStart, panelEnd);
const borrowed = (panel.match(/["' ](pto-[a-z-]+)/g) || []).map(match => match.slice(1));
ok(borrowed.length === 0,
  'the ad-performance panel uses none of the leave feature’s class names'
    + (borrowed.length ? ' — found ' + [...new Set(borrowed)].join(', ') : ''));

// ---- 2. Its own rules exist, so the markup is not unstyled -----------------
for (const selector of ['.kad-card', '.kad-card-head', '.kad-card-title',
  '.kad-card-sub', '.kad-section-title', '.kad-refresh']) {
  ok(source.includes('\n        ' + selector + ' {'),
    selector + ' is defined, so dropping the borrowed name did not drop the styling');
}

// ---- 3. The published evidence is current for this tree --------------------
function sourceTreeFingerprint() {
  const files = [
    'index.html',
    'package.json',
    'supabase/functions/pto/policy.js',
    ...fs.readdirSync(path.join(ROOT, 'qa', 'pto-lifecycle'))
      .filter(file => /\.(?:js|json)$/.test(file) && file !== 'visual-review.json')
      .map(file => `qa/pto-lifecycle/${file}`),
  ].sort();
  const hash = crypto.createHash('sha256');
  for (const relative of files) {
    const full = path.join(ROOT, relative);
    if (!fs.existsSync(full)) continue;
    hash.update(relative.replace(/\\/g, '/'));
    hash.update('\0');
    const raw = fs.readFileSync(full, 'utf8');
    hash.update(canonicalSourceText(relative === 'index.html' ? ptoSourceSlice(raw) : raw));
    hash.update('\0');
  }
  return hash.digest('hex');
}

const manifestFile = path.join(ROOT, 'docs', 'audits', '2026-07-17-pto-lifecycle-simulation', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const computed = sourceTreeFingerprint();
ok(manifest.source_tree_sha256 === computed,
  'the published evidence packet matches the current source fingerprint'
    + (manifest.source_tree_sha256 === computed
      ? ''
      : `\n      published ${manifest.source_tree_sha256}\n      computed  ${computed}\n      `
        + 'Before regenerating: did the leave source actually change, or did something '
        + 'merely borrow one of its names? Regenerating costs a human review of every screenshot.'));

/*
 * The fingerprint copy above is a COPY of qa/pto-lifecycle/run.js. If that
 * function changes, this one silently drifts and this test passes for the
 * wrong reason — so pin the shape it was copied from.
 */
const runner = fs.readFileSync(path.join(ROOT, 'qa', 'pto-lifecycle', 'run.js'), 'utf8');
ok(/const text = relative === 'index\.html' \? ptoSourceSlice\(raw\) : raw;/.test(runner),
  'the runner still fingerprints index.html through the same slice this test reproduces');
ok(/'supabase\/functions\/pto\/policy\.js',/.test(runner)
  && /file !== 'visual-review\.json'/.test(runner),
  'and over the same file set, so the copy above has not drifted from it');

if (failures) {
  console.error(`\n${failures} leave-evidence coupling check(s) failed`);
  process.exit(1);
}
console.log('\nleave-evidence fingerprint coupling checks passed');
