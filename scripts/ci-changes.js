'use strict';
/*
 * Which Calendar unit test suites a change needs (the `changes` job in
 * .github/workflows/calendar-unit-tests.yml).
 *
 * A pull request that only touches docs, or one Edge Function and its tests,
 * cannot change what the offline browser suites load, so it should not wait
 * 30 to 40 minutes for them. Every push to main (and every manual run) still
 * runs every suite in full, so nothing goes untested.
 *
 * The rule fails SAFE: a file is skipped only when it sits in an area that no
 * browser suite reads AND no browser suite in the workflow reads it directly
 * (the "closure" below: the suite files, everything they require, and every
 * repository file path they name). Anything unknown runs everything.
 *
 *   browser  every browser job (entry links, browser guards, split preview)
 *   phone    the staff phone matrix: staff phone files (scripts/staff-phone-changed.js),
 *            page code and the shared browser plumbing, or a file a phone suite reads
 *   review   the review page's own suites on a pull request (the Gauntlet Three in
 *            its reduced form, and the review phones): a file whose name says review,
 *            notes or comment, a file those suites read, or the build and shared
 *            browser plumbing (session Pitstop, 2026-10-19). Every push to main runs
 *            them in full, all nine engine and width legs, whatever changed.
 *
 * Usage: node scripts/ci-changes.js <event> <base> <head>
 *   event is github.event_name; anything but pull_request runs everything.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isStaffPhoneFile } = require('./staff-phone-changed');

const ROOT = path.join(__dirname, '..');
const WORKFLOW = '.github/workflows/calendar-unit-tests.yml';

// Page code, its build, and the plumbing every browser suite shares. Any of
// these means the full set, phone matrix included.
function isPageFile(f) {
  return /^(src\/|js\/|index\.html$|package\.json$|package-lock\.json$|\.gitattributes$|\.github\/actions\/)/.test(f)
    || /^scripts\/(build-index|build-route-stubs|index-[\w-]+|ensure-built|ci-changes|staff-phone-changed|test-suite-routing)\.js$/.test(f)
    || f === WORKFLOW
    || /^test\/(helpers|fixtures)\//.test(f)
    || /^qa\/(client-phone|finch-phone|boot|staff-phone)/.test(f)
    || f === 'qa/staff-gate-seed.js';
}

// The review page and its comment and notes threads (src/index/185-client-review-queue,
// 188/195-review-stage, 190-calendar-approval-comments, 230-production-create-comments,
// 280-samples-cards-notes, 290-samples-writes-review, 330-kasper-review-history and
// their tests and Edge Functions). Names, not a list, so a new review file is caught.
function isReviewFile(f) {
  return /^(src|test|qa|docs\/syncview-design|supabase\/functions)\//.test(f)
    && /review|notes?|comment/i.test(f.replace(/^.*\//, '') + '/' + (f.match(/^supabase\/functions\/([^/]+)\//) || [])[1]);
}
// The build and the plumbing every browser suite shares (isPageFile without the
// page's own code and without the staff phone harnesses).
function isBuildPlumbing(f) {
  return isPageFile(f) && !/^(src\/|js\/|index\.html$|qa\/)/.test(f);
}

// Areas no browser suite loads by itself. A file here still runs the browser
// suites when a suite reads it (the closure check), so this list only has to
// be right about areas, not about every file.
function isOutsideBrowser(f) {
  return (/^docs\//.test(f) && !/^docs\/syncview-design\//.test(f))
    || (/\.md$/i.test(f) && !/^(src|docs\/syncview-design)\//.test(f))
    || /^supabase\/functions\/(?!_shared\/)[^/]+\/./.test(f)
    || /^supabase\/migrations\//.test(f)
    || /^migrations\//.test(f)
    || /^test\//.test(f)
    || /^qa\//.test(f)
    || /^scripts\//.test(f)
    || /^n8n-backups\//.test(f)
    || /^\.github\/(workflows\/|ISSUE_TEMPLATE\/|pull_request_template\.md$|copilot-instructions\.md$)/.test(f);
}

/* The suite files a block of workflow text starts (`node [--require x] <file>`),
   everything they require (relative requires, followed), and every file path
   they name as a string. */
function suiteFiles(text) {
  const out = new Set();
  for (const m of text.matchAll(/\bnode\s+(?:--require\s+(\S+)\s+)?((?:test|docs|qa|scripts)\/[^\s'"]+\.(?:js|mjs))/g)) {
    if (m[1]) out.add(path.normalize(m[1]).replace(/^\.\//, ''));
    out.add(m[2]);
  }
  return out;
}
function closureOf(starts) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    const abs = path.join(ROOT, rel);
    // A file a suite starts or names that is gone stays in the closure: a pull
    // request that deletes it must still run the jobs that would now fail.
    if (!fs.existsSync(abs)) { seen.add(rel); continue; }
    if (!fs.statSync(abs).isFile()) continue;
    seen.add(rel);
    if (!/\.(js|mjs|cjs)$/.test(rel)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/(?:require\(|import\(|from\s)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const base = path.join(path.dirname(rel), m[1]);
      for (const cand of [base, base + '.js', base + '.mjs', path.join(base, 'index.js')]) {
        const c = path.normalize(cand);
        if (fs.existsSync(path.join(ROOT, c)) && fs.statSync(path.join(ROOT, c)).isFile()) { stack.push(c); break; }
      }
    }
    for (const m of src.matchAll(/['"`]((?:docs|supabase|scripts|migrations|test|qa)\/[\w./-]+\.\w+)['"`]/g)) stack.push(m[1]);
    // path.join(__dirname, '../x/y.js') and path.join(ROOT, 'x', 'y.js'): the
    // way several suites load Edge Function code to run it in the browser.
    for (const m of src.matchAll(/path\.(?:join|resolve)\(\s*(__dirname|[A-Za-z_]*(?:ROOT|Root|root|REPO|Repo|repo)[A-Za-z_]*)\s*((?:,\s*['"][^'"]+['"]\s*)+)\)/g)) {
      const parts = [...m[2].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
      const rel2 = path.normalize(path.join(m[1] === '__dirname' ? path.dirname(rel) : '', ...parts));
      if (!rel2.startsWith('..')) stack.push(rel2);
    }
  }
  return seen;
}
// An Edge Function folder a suite names in any form (functions/<name>/ or
// 'functions', '<name>'): a change inside it runs the suite. Errs towards running.
function namesFunction(sources, fn) {
  const esc = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('functions/' + esc + '/|[\'"]functions[\'"]\\s*,\\s*[\'"]' + esc + '[\'"]');
  return sources.some(s => re.test(s));
}
// One job's block of the workflow: from "  <name>:" to the next job.
function jobBlock(text, name) {
  text = text.slice(text.indexOf('\njobs:\n'));
  const at = text.indexOf('\n  ' + name + ':\n');
  if (at < 0) throw new Error('workflow has no job ' + name);
  const rest = text.slice(at + 1);
  const next = rest.slice(1).search(/\n  [A-Za-z0-9_-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
// The jobs a pull request runs only when the review page can change.
const REVIEW_JOBS = ['review-stage-phones', 'review-gauntlet-pr', 'review-gauntlet-three'];
function closures(workflowText) {
  const text = workflowText == null ? fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf8') : workflowText;
  const phoneText = jobBlock(text, 'staff-phone-rules');
  const browserText = ['entry-links-boot', 'browser-guards', 'review-stage-phones', 'repair-checkpoint', 'split-preview', 'review-gauntlet-pr', 'review-gauntlet-three'].map(j => jobBlock(text, j)).join('\n');
  const reviewText = REVIEW_JOBS.map(j => jobBlock(text, j)).join('\n');
  return { browser: closureOf(suiteFiles(browserText)), phone: closureOf(suiteFiles(phoneText)), review: closureOf(suiteFiles(reviewText)) };
}

function decide(files, opts) {
  opts = opts || {};
  if (opts.event && opts.event !== 'pull_request') {
    const all = 'not a pull request (' + opts.event + '): every suite runs';
    return { browser: true, phone: true, review: true, why: { browser: all, phone: all, review: all } };
  }
  const c = opts.closures || closures();
  const read = set => [...set].filter(f => /\.(js|mjs|cjs)$/.test(f)).map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const fnOf = f => (f.match(/^supabase\/functions\/([^/]+)\//) || [])[1];
  let browserSrc = null, phoneSrc = null;
  const browserReadsFn = f => fnOf(f) && namesFunction(browserSrc || (browserSrc = read(new Set([...c.browser, ...c.phone]))), fnOf(f));
  const phoneReadsFn = f => fnOf(f) && namesFunction(phoneSrc || (phoneSrc = read(c.phone)), fnOf(f));
  // A deleted or renamed-away file is checked against nothing that still names
  // it, so only docs may go without the browser suites.
  const deleted = new Set(opts.deleted || []);
  const goneCode = f => deleted.has(f) && !(/^docs\/(?!syncview-design\/)/.test(f) || (/\.md$/i.test(f) && !/^src\//.test(f)));
  const browserBy = files.find(f => isPageFile(f) || !isOutsideBrowser(f) || c.browser.has(f) || c.phone.has(f) || browserReadsFn(f) || goneCode(f));
  const phoneBy = files.find(f => isPageFile(f) || isStaffPhoneFile(f) || c.phone.has(f) || phoneReadsFn(f) || (goneCode(f) && /^(qa|docs\/syncview-design)\//.test(f)));
  const review = c.review || new Set();
  const reviewBy = files.find(f => isReviewFile(f) || isBuildPlumbing(f) || review.has(f));
  return {
    browser: !!browserBy,
    phone: !!phoneBy,
    // Never more than the browser suites: a review file that cannot reach the page (a doc) runs nothing.
    review: !!browserBy && !!reviewBy,
    why: {
      review: !browserBy ? 'no change reaches a browser suite' : reviewBy ? reviewBy + ' can change the review page or its suites' : 'no review page change (the full Gauntlet Three runs after merge on main)',
      browser: browserBy ? browserBy + ' can change what the browser suites load' : 'no change reaches a browser suite',
      phone: phoneBy ? phoneBy + ' can change the staff phone screens or their suites' : 'no staff phone change',
    },
  };
}

function changedFiles(base, head) {
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  let out;
  try { out = git(['diff', '--name-only', '--no-renames', '-z', base + '...' + head]); }
  catch (e) { out = git(['diff', '--name-only', '--no-renames', '-z', base, head]); }
  return out.split('\0').filter(Boolean);
}
function deletedFiles(base, head) {
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  let out;
  try { out = git(['diff', '--name-only', '--no-renames', '--diff-filter=D', '-z', base + '...' + head]); }
  catch (e) { out = git(['diff', '--name-only', '--no-renames', '--diff-filter=D', '-z', base, head]); }
  return out.split('\0').filter(Boolean);
}

module.exports = { REVIEW_JOBS, isReviewFile, isBuildPlumbing, isPageFile, isOutsideBrowser, suiteFiles, closureOf, closures, namesFunction, decide, changedFiles, deletedFiles, jobBlock };

if (require.main === module) {
  const [event, base, head] = process.argv.slice(2);
  if (!event) throw new Error('Usage: node scripts/ci-changes.js <event> <base> <head>');
  let files = [], deleted = [];
  if (event === 'pull_request') {
    if (!base || !head) throw new Error('A pull request needs its base and head commits');
    files = changedFiles(base, head);
    deleted = deletedFiles(base, head);
  }
  const d = decide(files, { event, deleted });
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'browser=' + d.browser + '\nphone=' + d.phone + '\nreview=' + d.review + '\n');
  console.log('CHANGED FILES: ' + (event === 'pull_request' ? files.length : 'not a pull request'));
  console.log('BROWSER SUITES: ' + (d.browser ? 'run' : 'skip') + ' (' + d.why.browser + ')');
  console.log('STAFF PHONE MATRIX: ' + (d.phone ? 'run' : 'skip') + ' (' + d.why.phone + ')');
  console.log('REVIEW PAGE SUITES: ' + (d.review ? 'run' : 'skip') + ' (' + d.why.review + ')');
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '### What this change needs', '',
      '| Suites | Decision | Why |', '|---|---|---|',
      '| Browser (entry links, browser guards, split preview) | ' + (d.browser ? 'run' : 'skip') + ' | ' + d.why.browser + ' |',
      '| Staff phone matrix | ' + (d.phone ? 'run' : 'skip') + ' | ' + d.why.phone + ' |',
      '| Review page (Gauntlet Three on chromium 1440, review phones) | ' + (d.review ? 'run' : 'skip') + ' | ' + d.why.review + ' |',
      '| Unit, module check, identity check | always run | |', '',
      'Every suite runs in full on every push to main.', '',
    ].join('\n'));
  }
}
