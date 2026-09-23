// dawn-report.js — builds the dawn-check report, PUBLIC-SAFE by construction.
//
// The repo is public, and so are Actions step summaries, logs and artifacts. The
// report may therefore carry ONLY: fixed check names, pass/fail marks, timings,
// counts, fixed step words and HTTP status codes. Never a client name, a card name,
// caption or title, a URL, or an error message (they can quote any of those).
//
// Two layers enforce it:
//   1. every detail line is produced by a template below from numbers and enums;
//   2. assertReportSafe() checks the finished text line by line against an anchored
//      allowlist, and buildReport() withholds anything that does not match.
// test/dawn-report-allowlist.js pins both. Dependency-free on purpose (unit lane).
'use strict';

const CHECKS = Object.freeze({
  'client-approve': 'Client approves',
  'client-request': 'Client requests changes',
  'client-errors': 'Client page has no app errors',
  'staff-save': 'Staff card save',
  'rename': 'Card rename, sub-issue follows',
  'staff-errors': 'Staff calendar has no app errors',
  'workload': 'Workload opens',
  'synclinear': 'SyncLinear first rows',
  'analytics': 'Analytics first numbers',
  'harness': 'Harness ran to the end',
  'cleanup': 'Everything put back',
});
const STEPS = Object.freeze(['landing', 'click', 'save', 'hold', 'saved-mark', 'save-error', 'syncing-stuck', 'field', 'card', 'sub-issue', 'target', 'error']);
const TABS = ['workload', 'synclinear', 'analytics'];

const int = (n) => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 0) throw new Error('dawn-report: not a count');
  return v;
};
const fmt = (n) => int(n).toLocaleString('en-US');
const step = (s) => { if (!STEPS.includes(s)) throw new Error('dawn-report: unknown step'); return s; };
const yn = (b) => (b ? 'yes' : 'no');

// ---- detail templates (the only way a detail string is made) ----------------
const D = Object.freeze({
  approveOk: (landedMs, cards) => `link opened on the Review tab in ${fmt(landedMs)} ms (${fmt(cards)} cards); approval saved and held`,
  requestOk: () => 'request saved with its text; status is Tweaks Needed',
  saveOk: (syncMs, savedMs) => syncMs == null
    ? `saved at ${fmt(savedMs)} ms (no syncing step needed)`
    : `"Saved, syncing" at ${fmt(syncMs)} ms, then saved at ${fmt(savedMs)} ms`,
  renameOk: () => 'card and its sub-issue both took the new name',
  failedAt: (s) => `failed at step: ${step(s)}`,
  appErrors: (n) => `app errors on this page: ${fmt(n)}`,
  tabOk: (ms, map) => `${fmt(ms)} ms vs ${fmt(map)} ms map`,
  tabSlow: (ms, map) => `slow: ${fmt(ms)} ms vs ${fmt(map)} ms map`,
  tabNever: (capS, statuses) => `nothing showed within ${fmt(capS)} s` +
    (statuses && statuses.length ? `; failed requests: ${statuses.map(s => Number.isInteger(s) ? `HTTP ${fmt(s)}` : 'network').join(', ')}` : ''),
  tabBlocked: () => 'not measured: this tab needs a staff role key and the run has none (set the SYNCVIEW_ROLE_KEY secret)',
  noTarget: () => 'not run: no test card with a two-sided, Linear-free sub-issue link was found',
  harness: () => 'the harness stopped early; see the runner for details',
  cleanup: (archived, seeds, renamed, card, sub, blocked) =>
    `seeds archived ${fmt(archived)}/${fmt(seeds)}` +
    (renamed ? `, rename restored on card=${yn(card)} sub-issue=${yn(sub)}` : '') +
    (blocked ? `, ${fmt(blocked)} other-client write(s) blocked` : ''),
});

// ---- the allowlist ------------------------------------------------------------
const N = '[0-9][0-9,]*';
const TITLES = Object.values(CHECKS).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const DETAIL = [
  `link opened on the Review tab in ${N} ms \\(${N} cards\\); approval saved and held`,
  'request saved with its text; status is Tweaks Needed',
  `saved at ${N} ms \\(no syncing step needed\\)`,
  `"Saved, syncing" at ${N} ms, then saved at ${N} ms`,
  'card and its sub-issue both took the new name',
  `failed at step: (?:${STEPS.join('|')})`,
  `app errors on this page: ${N}`,
  `(?:slow: )?${N} ms vs ${N} ms map`,
  `nothing showed within ${N} s(?:; failed requests: (?:HTTP ${N}|network)(?:, (?:HTTP ${N}|network))*)?`,
  'not measured: this tab needs a staff role key and the run has none \\(set the SYNCVIEW_ROLE_KEY secret\\)',
  'not run: no test card with a two-sided, Linear-free sub-issue link was found',
  'the harness stopped early; see the runner for details',
  `seeds archived ${N}/${N}(?:, rename restored on card=(?:yes|no) sub-issue=(?:yes|no))?(?:, ${N} other-client write\\(s\\) blocked)?`,
].join('|');
const CELL = `(?:never|not measured|not reached|${N} ms)`;
const LINE_ALLOW = [
  /^$/,
  /^# Dawn check — \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/,
  new RegExp(`^\\*\\*${N} of ${N} checks failed\\.\\*\\*$`),
  new RegExp(`^\\*\\*All ${N} checks that ran passed\\.\\*\\*(?: ${N} ran slow\\.)?(?: ${N} could not run \\(see ⚠️\\)\\.)?$`),
  new RegExp(`^⛔ Blocked ${N} write\\(s\\) aimed at a client other than the test client\\.$`),
  new RegExp(`^- (?:✅|❌|⚠️|🐢) \\*\\*(?:${TITLES})\\*\\* — (?:${DETAIL})(?: \\(screenshot (?:attached|kept on the runner)\\))?$`),
  /^## Timings vs the speed map \(2026-09-23\)$/,
  /^\| check \| today \| map cold \| map warm \|$/,
  /^\|---\|---\|---\|---\|$/,
  new RegExp(`^\\| (?:${TITLES}|Staff calendar, first card) \\| ${CELL} \\| ${N} ms \\| ${N} ms \\|$`),
  new RegExp(`^No map numbers exist yet for the write flows; today’s: (?:(?:${TITLES.toLowerCase()}) ${N} ms)(?:, (?:${TITLES.toLowerCase()}) ${N} ms)*\\.$`),
  /^Test client only\. Seeds archived and verified, rename restored: (?:yes|\*\*NO — see cleanup line\*\*)\.$/,
];
function assertReportSafe(md) {
  const bad = String(md).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !LINE_ALLOW.some(re => re.test(l)));
  if (bad.length) {
    const e = new Error(`dawn-report: ${bad.length} line(s) outside the public allowlist (lines ${bad.map(b => b[0]).join(', ')})`);
    e.lines = bad.map(b => b[0]);
    throw e;
  }
  return true;
}

// ---- the report -----------------------------------------------------------------
// results: [{ key, ok, slow?, blocked?, ms?, detail (from D), shot?: 'attached'|'runner' }]
function buildReport({ started, results, violations = 0, calMs = null, baseline }) {
  const L = [];
  const fails = results.filter(r => !r.ok);
  const slows = results.filter(r => r.ok && r.slow);
  const blocked = results.filter(r => r.blocked);
  L.push(`# Dawn check — ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  L.push('');
  L.push(fails.length ? `**${fmt(fails.length)} of ${fmt(results.length)} checks failed.**`
    : `**All ${fmt(results.length - blocked.length)} checks that ran passed.**` + (slows.length ? ` ${fmt(slows.length)} ran slow.` : '') + (blocked.length ? ` ${fmt(blocked.length)} could not run (see ⚠️).` : ''));
  if (violations) { L.push(''); L.push(`⛔ Blocked ${fmt(violations)} write(s) aimed at a client other than the test client.`); }
  L.push('');
  for (const r of results) {
    const title = CHECKS[r.key];
    if (!title) throw new Error('dawn-report: unknown check');
    const mark = !r.ok ? '❌' : r.blocked ? '⚠️' : r.slow ? '🐢' : '✅';
    const shot = r.shot === 'attached' ? ' (screenshot attached)' : r.shot === 'runner' ? ' (screenshot kept on the runner)' : '';
    L.push(`- ${mark} **${title}** — ${r.detail}${shot}`);
  }
  L.push('');
  L.push('## Timings vs the speed map (2026-09-23)');
  L.push('');
  L.push('| check | today | map cold | map warm |');
  L.push('|---|---|---|---|');
  for (const k of TABS) {
    const r = results.find(x => x.key === k);
    const cell = !r ? 'not reached' : r.blocked ? 'not measured' : r.ms == null ? 'never' : `${fmt(r.ms)} ms`;
    L.push(`| ${CHECKS[k]} | ${cell} | ${fmt(baseline[k].cold)} ms | ${fmt(baseline[k].warm)} ms |`);
  }
  L.push(`| Staff calendar, first card | ${calMs == null ? 'never' : fmt(calMs) + ' ms'} | ${fmt(baseline.calendar.cold)} ms | ${fmt(baseline.calendar.warm)} ms |`);
  const writes = results.filter(r => ['client-approve', 'client-request', 'staff-save', 'rename'].includes(r.key) && r.ok && r.ms != null);
  if (writes.length) { L.push(''); L.push('No map numbers exist yet for the write flows; today’s: ' + writes.map(r => `${CHECKS[r.key].toLowerCase()} ${fmt(r.ms)} ms`).join(', ') + '.'); }
  L.push('');
  const clean = results.find(r => r.key === 'cleanup');
  L.push(`Test client only. Seeds archived and verified, rename restored: ${clean && clean.ok ? 'yes' : '**NO — see cleanup line**'}.`);
  const md = L.join('\n') + '\n';
  try { assertReportSafe(md); return { md, safe: true }; }
  catch (e) {
    return { md: `# Dawn check — ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC\n\n**${fmt(fails.length + 1)} of ${fmt(results.length + 1)} checks failed.**\n\n- ❌ **Harness ran to the end** — the harness stopped early; see the runner for details\n`, safe: false, lines: e.lines };
  }
}

module.exports = { CHECKS, STEPS, D, buildReport, assertReportSafe };
