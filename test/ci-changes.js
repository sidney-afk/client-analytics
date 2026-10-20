'use strict';
/*
 * scripts/ci-changes.js decides which Calendar unit test jobs a pull request
 * needs. Skipping a suite a change CAN break is the one failure that matters,
 * so most checks below are "this must run". Offline: reads files only.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const c = require('../scripts/ci-changes');

const ROOT = path.join(__dirname, '..');
const closures = c.closures();
const pr = files => c.decide(files, { event: 'pull_request', closures });
let checks = 0;
function expectRun(files, what, why) {
  const d = pr(files);
  for (const w of what) assert.equal(d[w], true, `${files.join(', ')} must run the ${w} suites: ${why}`);
  checks++;
}
function expectSkip(files, what, why) {
  const d = pr(files);
  for (const w of what) assert.equal(d[w], false, `${files.join(', ')} should not wait for the ${w} suites: ${why}`);
  checks++;
}

// Not a pull request: everything, always (every suite runs in full on main).
for (const event of ['push', 'workflow_dispatch', 'schedule']) {
  const d = c.decide([], { event, closures });
  assert(d.browser && d.phone && d.review, event + ' must run every suite, the full Gauntlet Three included');
  checks++;
}

// Page code, its build and the shared browser plumbing run everything.
for (const f of ['src/index/160-calendar-organize-ui.js.part', 'src/index/020-styles-surfaces.css.part', 'src/index/manifest.txt',
  'scripts/build-index.js', 'scripts/index-split.js', 'scripts/ensure-built.js', 'scripts/ci-changes.js', 'scripts/staff-phone-changed.js',
  '.github/actions/build-index/action.yml', '.github/workflows/calendar-unit-tests.yml', 'package.json', '.gitattributes',
  'test/helpers/single-file-index.js', 'qa/staff-gate-seed.js', 'qa/client-phone/native-captures.js', 'qa/finch-phone/harness.js']) {
  expectRun([f], ['browser', 'phone'], 'page code, the build or a shared browser helper');
}
// Anything the rule does not know runs the browser suites (fail safe).
for (const f of ['nav-icons/new.svg', 'calendar.html', 'some-new-dir/file.js', 'docs/syncview-design/tests/clients-admin-browser.js',
  'docs/syncview-design/staff-phone-rules.css', 'supabase/functions/_shared/anything.ts', 'supabase/config.toml']) {
  expectRun([f], ['browser'], 'unknown or browser-facing area');
}
// A suite the workflow starts, or a file one of them reads, runs the browser suites.
const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/calendar-unit-tests.yml'), 'utf8');
const started = [...c.suiteFiles(wf)].filter(f => f !== 'test/run-all.js' && !f.startsWith('scripts/'));
assert(started.length > 60, 'expected the workflow to start many browser suites, found ' + started.length);
for (const f of started) {
  if (/^test\/[\w.-]+\.js$/.test(f) && !/browser|local/.test(f)) continue; // a unit-style file the browser jobs never start
  expectRun([f], ['browser'], 'a browser job starts it');
}
expectRun(['scripts/repo-identity-exposure-check.js'], ['browser'], 'a browser harness requires it');
// Edge Function code that a browser suite loads and runs.
for (const fn of ['tiktok-upload', 'tiktok-upload-cancel', 'production-comments', 'pto']) {
  assert(fs.existsSync(path.join(ROOT, 'supabase/functions', fn)), 'fixture function folder moved: ' + fn);
  expectRun(['supabase/functions/' + fn + '/index.ts'], ['browser'], 'a browser suite loads this function');
}
// Staff phone files keep running the phone matrix.
for (const f of ['qa/staff-phone-collections.js', 'qa/staff-phone-final-pass.js', 'docs/syncview-design/tests/staff-phone-browser.js',
  'docs/syncview-design/tests/kasper-admin-expanded-browser.js', 'index.html', 'js/sv-calendar.js']) {
  expectRun([f], ['browser', 'phone'], 'staff phone file');
}
// A mix is as strong as its strongest file.
expectRun(['docs/ops/OPEN_REPAIRS.md', 'src/index/160-calendar-organize-ui.js.part'], ['browser', 'phone'], 'one page file is enough');

// A deleted suite, or any deleted code, still runs the browser suites; a deleted doc does not.
for (const f of ['test/caption-helper-browser.js', 'test/some-unit-test.js', 'qa/staff-phone-collections.js']) {
  assert(c.decide([f], { event: 'pull_request', closures, deleted: [f] }).browser, 'deleting ' + f + ' must run the browser suites');
  checks++;
}
assert(c.decide(['qa/staff-phone-collections.js'], { event: 'pull_request', closures, deleted: ['qa/staff-phone-collections.js'] }).phone, 'deleting a phone suite runs the phone matrix');
assert(!c.decide(['docs/ops/OLD.md'], { event: 'pull_request', closures, deleted: ['docs/ops/OLD.md'] }).browser, 'deleting a doc needs no browser suite');
// A file the workflow starts that no longer exists stays in the closure.
assert(c.closureOf(['test/no-such-browser-suite.js']).has('test/no-such-browser-suite.js'), 'a missing started suite must stay in the closure');
checks += 3;

// What may skip: docs, one Edge Function no browser suite loads, its tests, migrations.
expectSkip(['docs/ops/OPEN_REPAIRS.md', 'docs/STATE_OF_THINGS.md', 'README.md', 'AGENTS.md', 'REPO_MAP.md'], ['browser', 'phone'], 'docs only');
expectSkip(['supabase/functions/production-write/index.ts', 'test/production-write-edge-function.js'], ['browser', 'phone'], 'one Edge Function and its unit test');
expectSkip(['supabase/functions/higgsfield-mcp/index.ts', 'docs/ops/HIGGSFIELD_CONNECTOR_LESSONS.md'], ['browser', 'phone'], 'connector only');
expectSkip(['supabase/migrations/20261017000000_example.sql', 'migrations/2026-10-17-example.sql'], ['browser', 'phone'], 'migrations only');
expectSkip(['.github/workflows/deploy-single-function.yml'], ['browser', 'phone'], 'another workflow');
expectSkip(['docs/syncview-design/tests/clients-admin-browser.js'], ['phone'], 'a desktop browser suite no phone suite reads');
expectSkip([], ['browser', 'phone'], 'no files');

// Review page suites (session Pitstop, 2026-10-19): on a pull request only when the
// review page can change; the full Gauntlet Three always runs on main (checked above).
for (const f of ['src/index/195-review-stage.js.part', 'src/index/188-review-stage-switch.js.part', 'src/index/190-calendar-approval-comments.js.part',
  'src/index/280-samples-cards-notes.js.part', 'src/index/330-kasper-review-history.js.part', 'test/review-stage-gauntlet3-browser.js',
  'test/review-stage-phone-browser.js', 'test/fixtures/review-stage-fixture.js', 'supabase/functions/production-comments/index.ts',
  'scripts/build-index.js', 'package.json', '.github/workflows/calendar-unit-tests.yml', 'test/helpers/single-file-index.js']) {
  expectRun([f], ['browser', 'review'], 'the review page, its suites, or the build every suite shares');
}
// Shared page code fails safe (Codex on #2242): styles, head, boot and any part a
// review part imports, directly or not, run the review suites.
for (const f of ['src/index/020-styles-surfaces.css.part', 'src/index/010-styles-foundation.css.part', 'src/index/005-head-boot.html.part',
  'src/index/040-shared-briefs.js.part', 'src/index/131-core-html.js.part', 'src/index/160-calendar-organize-ui.js.part', 'src/index/manifest.txt',
  'src/index/999-brand-new-part.js.part']) {
  expectRun([f], ['browser', 'review'], 'shared page code the review page can load');
}
// A Workload-only change (the page parts of a PR like #2241, without its 020 styles edit) cannot reach the review page.
expectSkip(['src/index/069-workload-planning-helpers.js.part', 'src/index/080-workload-render.js.part', 'docs/syncview-design/tests/workload-calm-browser.js'], ['review'], 'Workload only');
expectRun(['src/index/069-workload-planning-helpers.js.part', 'src/index/020-styles-surfaces.css.part'], ['review'], 'one styles file is enough');
assert(c.reviewParts().has('src/index/195-review-stage.js.part') && c.reviewParts().has('src/index/040-shared-briefs.js.part'), 'the review import graph reaches the shared parts');
checks++;
for (const f of ['src/index/080-workload-render.js.part', 'qa/staff-phone-collections.js', 'test/tiktok-upload-steps-browser.js']) {
  expectRun([f], ['browser'], 'page code still runs the browser suites');
  expectSkip([f], ['review'], 'not the review page: its full Gauntlet Three runs after merge on main');
}
expectSkip(['docs/ops/REVIEW_NOTES.md'], ['browser', 'review'], 'a doc never runs the review suites, whatever its name');
// Every file a review suite reads runs them.
for (const f of c.closures().review) if (fs.existsSync(path.join(ROOT, f)) && /^(test|qa|docs\/syncview-design)\//.test(f)) expectRun([f], ['review'], 'a review suite reads it');

// The classification never mixes up "safe area" and "page".
for (const f of ['docs/ops/X.md', 'supabase/functions/x/index.ts', 'test/x.js', 'scripts/x.js', 'qa/x.js']) assert(c.isOutsideBrowser(f), f);
for (const f of ['src/index/x.part', 'docs/syncview-design/x.html', 'supabase/functions/_shared/x.ts', 'index.html', 'nav-icons/x.svg']) assert(!c.isOutsideBrowser(f), f);
checks += 2;

console.log(`ci-changes: ${checks} checks passed`);
