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
  assert(d.browser && d.phone, event + ' must run every suite');
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

// What may skip: docs, one Edge Function no browser suite loads, its tests, migrations.
expectSkip(['docs/ops/OPEN_REPAIRS.md', 'docs/STATE_OF_THINGS.md', 'README.md', 'AGENTS.md', 'REPO_MAP.md'], ['browser', 'phone'], 'docs only');
expectSkip(['supabase/functions/production-write/index.ts', 'test/production-write-edge-function.js'], ['browser', 'phone'], 'one Edge Function and its unit test');
expectSkip(['supabase/functions/higgsfield-mcp/index.ts', 'docs/ops/HIGGSFIELD_CONNECTOR_LESSONS.md'], ['browser', 'phone'], 'connector only');
expectSkip(['supabase/migrations/20261017000000_example.sql', 'migrations/2026-10-17-example.sql'], ['browser', 'phone'], 'migrations only');
expectSkip(['.github/workflows/deploy-single-function.yml'], ['browser', 'phone'], 'another workflow');
expectSkip(['docs/syncview-design/tests/clients-admin-browser.js'], ['phone'], 'a desktop browser suite no phone suite reads');
expectSkip([], ['browser', 'phone'], 'no files');

// The classification never mixes up "safe area" and "page".
for (const f of ['docs/ops/X.md', 'supabase/functions/x/index.ts', 'test/x.js', 'scripts/x.js', 'qa/x.js']) assert(c.isOutsideBrowser(f), f);
for (const f of ['src/index/x.part', 'docs/syncview-design/x.html', 'supabase/functions/_shared/x.ts', 'index.html', 'nav-icons/x.svg']) assert(!c.isOutsideBrowser(f), f);
checks += 2;

console.log(`ci-changes: ${checks} checks passed`);
