'use strict';
/*
 * The live-divergence register, enforced.
 *
 * Run:  node test/live-divergence-register.js   (exit 0 = all good)
 *
 * WHY. This repo reads as authoritative everywhere, and for almost every file it
 * is. The exceptions look identical, which is what makes them dangerous: the two
 * client writers are deliberately un-gated in production while the committed
 * source still carries the F35 gate, so deploying the repo source 401s every
 * client approval on a pre-existing link. That is not hypothetical — it broke
 * clients twice on 2026-07-15, and three sessions since have re-derived "deploy
 * it by hand" from EF_DEPLOY_MANIFEST.md's `NO CI DEPLOY PATH` row and been
 * wrong. The most recent got as far as a PR description before review caught it.
 *
 * WHAT THIS GATES. Two things, both mechanical:
 *
 *   1. A change that touches a registered path must also touch the register.
 *      It does not judge the change — it forces the register into the diff, so
 *      the divergence is read at the moment it matters instead of discovered
 *      afterwards.
 *   2. A registered file must carry its own inline ⛔ warning, and must NOT
 *      carry a copy-pasteable `supabase functions deploy <slug>` line. The 2026
 *      instruction came from a comment inside the file itself; a reader who
 *      opens the source must hit the freeze before they hit anything runnable.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It cannot verify the live system, so it
 * never claims a file matches production. It only enforces that a KNOWN
 * divergence stays visible and stays annotated.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { evActions, coveredBy } = require('./helpers/ev-actions.js');

const ROOT = path.resolve(__dirname, '..');
const REGISTER = 'docs/ops/LIVE_DIVERGENCE_REGISTER.md';

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}`); };

const registerText = fs.readFileSync(path.join(ROOT, REGISTER), 'utf8');

// Registered paths are parsed OUT OF the register itself, so adding an entry
// arms the gate for it with no second place to edit.
const registered = [...registerText.matchAll(/^### `([^`]+)`$/gm)].map(m => m[1]);

console.log('\n-- the register --');
check('the register exists and names at least one path', registered.length > 0);
check('every registered path still exists',
  registered.every(p => fs.existsSync(path.join(ROOT, p))));

console.log('\n-- each registered file warns, in itself --');
for (const rel of registered) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const head = src.slice(0, 4000);   // must be near the top, not buried
  check(rel + ' carries a ⛔ freeze warning near the top', head.includes('⛔'));
  check(rel + ' explains that deploying it re-gates clients',
    /401|re-gate|re-applies the F35/i.test(head));
  const slug = rel.split('/')[2];
  check(rel + ' has no copy-pasteable deploy command',
    !new RegExp('supabase functions deploy\\s+' + slug).test(src));
}

/* ── capability parity: does live actually DO what the repo claims? ──────────
 *
 * The two checks above keep a KNOWN divergence visible. They cannot see a NEW
 * one, and on 2026-09-09 a new one shipped: both repo copies gained an
 * `ev("kasper_urgent_ping")` branch, a test asserted it was there, and it was
 * never in the deployed functions. Every guard pointed at the repo, so the
 * feature ran for a day with a paper trail that existed only in a file which
 * does not execute (OPEN_REPAIRS 195).
 *
 * This check closes that direction. The register records the event actions each
 * DEPLOYED function was observed to emit; a repo copy that claims an action the
 * register does not record as live fails here. It cannot reach production from
 * CI, and does not pretend to: it compares the repo against a human-verified
 * record, and the register says how to refresh that record. The failure it
 * prevents is believing the repo by default. */
console.log('\n-- capability parity: repo claims vs verified live --');
const CAP = /^- `([a-z-]+)` live v(\d+) verified (\d{4}-\d{2}-\d{2}) events: (.+)$/gm;
const caps = new Map();
for (const m of registerText.matchAll(CAP)) {
  caps.set(m[1], { version: m[2], verified: m[3], events: m[4].split(',').map(x => x.trim()).filter(Boolean) });
}
check('the register records a verified live capability row per registered writer',
  registered.every(rel => caps.has(rel.split('/')[2])));

for (const rel of registered) {
  const slug = rel.split('/')[2];
  const cap = caps.get(slug);
  if (!cap) continue;
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const { actions: repoActions, unresolved } = evActions(src);
  /* An argument the extractor cannot resolve is a HOLE in this gate, so it is
     a failure rather than a silent skip. Otherwise `const a = "x"; ev(a)`
     re-introduces a branch with every check green. (Codex P2 on PR 1383.) */
  check(slug + ' has no ev() argument this gate cannot resolve'
    + (unresolved.length ? ' — UNRESOLVED: ' + unresolved.join(' | ') : ''),
    unresolved.length === 0);
  const unproven = repoActions.filter(a => !coveredBy(a, cap.events));
  check(slug + ' claims no event the deployed v' + cap.version + ' was not verified to emit'
    + (unproven.length ? ' — UNPROVEN: ' + unproven.join(', ') : ''),
    unproven.length === 0);
  /* And the reciprocal, because parity is equality, not containment. If a
     future edit deletes or renames ev("urgent_ping") in the repo copy, the
     check above only sees the set shrink and stays green — while the deployed
     function still emits it. The next owner-approved port of this frozen
     source would then silently drop a live capability, which is the same class
     of loss this PR exists to close, pointing the other way.
     (Codex P2 on PR 1383.) */
  const dropped = cap.events.filter(a => !coveredBy(a, repoActions));
  check(slug + ' still carries every event the deployed v' + cap.version + ' emits'
    + (dropped.length ? ' — MISSING FROM REPO: ' + dropped.join(', ') : ''),
    dropped.length === 0);
}

console.log('\n-- a change touching a registered path must touch the register --');
let changed = null;
try {
  // Compare against the merge-base so a stale main does not make every file
  // look changed. Best-effort: if git cannot answer, the check is skipped
  // rather than guessed at.
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: ROOT, encoding: 'utf8' }).trim();
  changed = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean);
} catch (e) {
  console.log('SKIP  no git merge-base against origin/main here — cannot compute the diff');
}

if (changed) {
  const touched = registered.filter(p => changed.includes(p));
  if (!touched.length) {
    console.log('OK    this change touches no registered path');
  } else {
    check('this change touches ' + touched.join(', ') + ' and updates the register',
      changed.includes(REGISTER));
  }
}

console.log(failures ? `\n${failures} check(s) FAILED.` : '\nLive-divergence register checks passed.');
process.exit(failures ? 1 : 0);
