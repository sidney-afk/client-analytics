'use strict';
/*
 * dawn-report-allowlist.js — the dawn check's public output stays public-safe.
 *
 * The repo is public, so the dawn check's step summary, log and artifact are too.
 * Its report may carry only check names, pass/fail, timings, counts, fixed step
 * words and HTTP status codes (qa/dawn/dawn-report.js). This suite pins:
 *   1. every template the script uses produces a line inside the allowlist;
 *   2. anything else -- a client or card name, caption text, a URL, an error
 *      message -- is refused by assertReportSafe and withheld by buildReport;
 *   3. the script never hands the report a free-text detail;
 *   4. the workflow publishes only the client-link screenshot folder.
 * Offline and dependency-free.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { D, CHECKS, STEPS, buildReport, assertReportSafe } = require('../qa/dawn/dawn-report.js');

const ROOT = path.join(__dirname, '..');
const BASELINE = { workload: { cold: 7510, warm: 6008 }, synclinear: { cold: 4370, warm: 2822 }, analytics: { cold: 5928, warm: 5116 }, calendar: { cold: 2485, warm: 801 } };
const started = Date.UTC(2026, 8, 24, 11, 30);
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

// 1. Every template, in passing and failing shapes, renders inside the allowlist.
const everyShape = [
  { key: 'client-approve', ok: true, ms: 5183, detail: D.approveOk(3160, 4) },
  { key: 'client-request', ok: false, detail: D.failedAt('save'), shot: 'attached' },
  { key: 'client-errors', ok: false, detail: D.appErrors(2), shot: 'attached' },
  { key: 'staff-save', ok: true, ms: 462, detail: D.saveOk(null, 462) },
  { key: 'staff-save', ok: true, ms: 1900, detail: D.saveOk(310, 1900) },
  { key: 'rename', ok: true, ms: 1209, detail: D.renameOk() },
  { key: 'rename', ok: false, detail: D.noTarget() },
  { key: 'staff-errors', ok: false, detail: D.appErrors(1), shot: 'runner' },
  { key: 'workload', ok: true, blocked: true, ms: null, detail: D.tabBlocked() },
  { key: 'synclinear', ok: true, slow: true, ms: 9100, detail: D.tabSlow(9100, 4370), shot: 'runner' },
  { key: 'analytics', ok: false, ms: null, detail: D.tabNever(30, [401, 'network', 503]), shot: 'runner' },
  { key: 'harness', ok: false, detail: D.harness() },
  { key: 'cleanup', ok: false, detail: D.cleanup(2, 3, true, true, false, 1) },
];
for (const s of STEPS) everyShape.push({ key: 'client-approve', ok: false, detail: D.failedAt(s) });
const mixed = buildReport({ started, results: everyShape, violations: 1, calMs: 2168, baseline: BASELINE });
ok(mixed.safe, 'every template renders inside the allowlist');
ok(assertReportSafe(mixed.md), 'mixed report passes the allowlist');

const green = buildReport({ started, calMs: 2168, baseline: BASELINE, results: [
  { key: 'client-approve', ok: true, ms: 5183, detail: D.approveOk(3160, 4) },
  { key: 'workload', ok: true, blocked: true, ms: null, detail: D.tabBlocked() },
  { key: 'synclinear', ok: true, ms: 1374, detail: D.tabOk(1374, 4370) },
  { key: 'cleanup', ok: true, detail: D.cleanup(3, 3, true, true, true, 0) },
] });
ok(green.safe && /All 3 checks that ran passed/.test(green.md), 'green report renders');
ok(/\| Workload opens \| not measured \|/.test(green.md), 'blocked tab shows as not measured');

// 2. Anything outside the allowlist is refused, and the report is withheld whole.
const hostile = [
  'Acme Studio', 'Dawn approve 1790196654782', 'caption: summer launch teaser',
  'https://example.com/share?t=abc', 'TypeError: cannot read "name" of undefined',
  'saved at 12 ms (no syncing step needed) Acme', '401 /functions/v1/workload-plan',
];
for (const h of hostile) {
  const r = buildReport({ started, calMs: 1, baseline: BASELINE, results: [{ key: 'client-approve', ok: false, detail: h }, { key: 'cleanup', ok: true, detail: D.cleanup(3, 3, false, true, true, 0) }] });
  ok(!r.safe, 'withheld: ' + h.slice(0, 24));
  ok(!r.md.includes(h), 'withheld report does not echo the text');
  ok(assertReportSafe(r.md), 'the withheld stand-in is itself allowlisted');
}
for (const line of ['Acme Studio', '- ✅ **Client approves** — Dawn approve 1', '| Workload opens | Acme | 1 ms | 1 ms |', '# Dawn check — client Acme']) {
  assert.throws(() => assertReportSafe('# Dawn check — 2026-09-24 11:30 UTC\n' + line + '\n'), /outside the public allowlist/);
  n++;
}
ok(!Object.values(CHECKS).some(t => /[A-Z][a-z]+ [A-Z][a-z]+ [A-Z]/.test(t) && !/^(Client|Staff|Card|Workload|SyncLinear|Analytics|Harness|Everything)/.test(t)), 'check names are fixed product words');

// 3. Templates accept only numbers and known step words.
assert.throws(() => D.tabOk('Acme', 1)); assert.throws(() => D.failedAt('Acme')); assert.throws(() => D.approveOk(-1, 2)); n += 3;
assert.throws(() => buildReport({ started, results: [{ key: 'acme', ok: true, detail: D.renameOk() }], baseline: BASELINE })); n++;

// 4. The script never hands the report free text.
const src = fs.readFileSync(path.join(ROOT, 'qa/dawn/dawn-check.js'), 'utf8');
const details = src.match(/\bdetail:\s*[^,\n]+/g) || [];
ok(details.length >= 10, 'script details found');
for (const d of details) ok(/^detail:\s*(?:!?ok \? )?D\.[a-zA-Z]+\(/.test(d), 'detail comes from a template: ' + d.slice(0, 50));
ok(!/e\.message|e\.stack/.test(src), 'no error message or stack in the script (it would reach the public log)');

// 5. The workflow publishes only the client-link screenshots.
const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/dawn-check.yml'), 'utf8');
const paths = [...wf.matchAll(/^\s*path:\s*(.+)$/gm)].map(m => m[1].trim());
ok(paths.length === 1 && paths[0] === 'qa/dawn/out/public/', 'only qa/dawn/out/public/ is uploaded');
ok(/shot\(p, 'client-approve', true\)/.test(src) && !/shot\(p, '(?:staff-save|rename|staff-errors)', true\)/.test(src) && !/shot\(p, key, true\)/.test(src), 'only client-link shots are publishable');

console.log(`dawn-report-allowlist: ${n} checks passed ✅`);
