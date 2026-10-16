'use strict';
/*
 * pages-retained-bundles.js -- puts back into js/ the older content-hashed
 * bundles that the live site has always kept, before the Pages publish.
 *
 * WHY. js/sv-*.js file names carry a hash of their contents, and a browser tab
 * left open on an older index.html asks for the files THAT page was built with
 * (scripts/index-split.js). While the bundles were committed, every one ever
 * built stayed in the repository and so on the live site. Now they are built
 * at publish time (since 2026-10-15), and a plain build writes only the
 * current set. Without this step the first publish after the switch would
 * drop every older file, and an open tab's next on-demand area load would 404.
 *
 * WHAT IT ADDS to js/ (never overwriting a file the current build wrote):
 *   1. The LEGACY set: every js/sv-*.js committed in the last commit on the
 *      first-parent history that still tracked index.html. That is exactly
 *      what the site served before the switch, so the first publish after it
 *      is byte-identical to the last one before it.
 *   2. The RECENT set: for the newest --keep=N (default 10) first-parent
 *      commits after that one which changed the build's inputs, the bundles
 *      that commit's build writes. Each is rebuilt in a temporary worktree from
 *      that commit's own sources; the build is deterministic
 *      (npm run check:index), so the bytes are the ones that commit published.
 * With the outputs still committed at HEAD (before the switch merges) it does
 * nothing: the checkout already holds every file.
 *
 *   node scripts/pages-retained-bundles.js [--keep=N] [--dry-run]
 *
 * Needs the full history (actions/checkout fetch-depth: 0). Reads git only;
 * no network, no secret. Prints what it added, as counts.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const JS = path.join(ROOT, 'js');
const BUNDLE = /^js\/sv-[a-z0-9-]+-[0-9a-f]{12}\.js$/;
// Every file the page build reads. A commit that changed none of them
// published the same bundles as its parent.
const BUILD_INPUTS = Object.freeze([
  'src/index',
  'scripts/build-index.js',
  'scripts/index-modules.js',
  'scripts/index-split.js',
  'scripts/index-minify.js',
]);

function git(args, opts = {}) {
  return execFileSync('git', ['-C', ROOT, ...args], { encoding: opts.encoding === undefined ? 'utf8' : opts.encoding, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function tracks(sha, rel) {
  return spawnSync('git', ['-C', ROOT, 'cat-file', '-e', `${sha}:${rel}`]).status === 0;
}

/** The last first-parent commit that still tracked index.html, and the first one after it (the switch), if any. */
function findLegacy(head = 'HEAD') {
  if (tracks(head, 'index.html')) return { legacy: git(['rev-parse', head]).trim(), switchCommit: null };
  const touched = git(['log', '--first-parent', '--format=%H', '-n', '1', head, '--', 'index.html']).trim();
  if (!touched) throw new Error('no commit on the first-parent history ever tracked index.html; is this a shallow checkout? (fetch-depth: 0)');
  const legacy = git(['rev-parse', `${touched}^1`]).trim();
  if (!tracks(legacy, 'index.html')) throw new Error(`expected ${legacy.slice(0, 12)} to track index.html`);
  return { legacy, switchCommit: touched };
}

/** Newest first: first-parent commits after `legacy` that changed a build input, HEAD excluded. */
function recentBuildCommits(legacy, keep, head = 'HEAD') {
  const headSha = git(['rev-parse', head]).trim();
  const out = git(['rev-list', '--first-parent', `${legacy}..${head}`, '--', ...BUILD_INPUTS]).split('\n').filter(Boolean);
  return out.filter(sha => sha !== headSha).slice(0, keep);
}

function addFile(rel, bytes, added, dryRun) {
  const full = path.join(ROOT, rel);
  if (fs.existsSync(full)) return false;
  if (!dryRun) {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, bytes);
  }
  added.push(rel);
  return true;
}

function addLegacy(legacy, dryRun) {
  const added = [];
  const names = git(['ls-tree', '-r', '--name-only', legacy, '--', 'js']).split('\n').filter(n => BUNDLE.test(n));
  for (const rel of names) {
    if (fs.existsSync(path.join(ROOT, rel))) continue;
    addFile(rel, git(['cat-file', 'blob', `${legacy}:${rel}`], { encoding: 'buffer' }), added, dryRun);
  }
  return { listed: names.length, added };
}

function buildAt(sha) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retained-'));
  const tree = path.join(tmp, 'tree');
  const out = path.join(tmp, 'out');
  try {
    git(['worktree', 'add', '--detach', '--quiet', tree, sha]);
    const r = spawnSync(process.execPath, [path.join(tree, 'scripts', 'build-index.js'), '--out=' + out], { cwd: tree, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`the build at ${sha.slice(0, 12)} failed: ${(r.stderr || '').trim().split('\n').pop()}`);
    const files = new Map();
    const jsDir = path.join(out, 'js');
    for (const f of fs.existsSync(jsDir) ? fs.readdirSync(jsDir) : []) files.set('js/' + f, fs.readFileSync(path.join(jsDir, f)));
    return files;
  } finally {
    spawnSync('git', ['-C', ROOT, 'worktree', 'remove', '--force', tree]);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const keepArg = process.argv.find(a => a.startsWith('--keep='));
  const keep = keepArg ? Number(keepArg.split('=')[1]) : 10;
  if (!Number.isInteger(keep) || keep < 0) throw new Error('--keep takes a whole number');
  const dryRun = process.argv.includes('--dry-run');
  const { legacy, switchCommit } = findLegacy();
  if (!switchCommit) {
    console.log(`pages-retained-bundles: index.html is still committed at HEAD; every bundle is already in the checkout, nothing to add`);
    return;
  }
  const legacyResult = addLegacy(legacy, dryRun);
  console.log(`pages-retained-bundles: legacy set from ${legacy.slice(0, 12)} (last commit with committed bundles): ${legacyResult.listed} file(s), ${legacyResult.added.length} added`);
  const commits = recentBuildCommits(legacy, keep);
  let recentAdded = 0;
  for (const sha of commits) {
    const added = [];
    for (const [rel, bytes] of buildAt(sha)) if (BUNDLE.test(rel)) addFile(rel, bytes, added, dryRun);
    recentAdded += added.length;
    console.log(`pages-retained-bundles: rebuilt ${sha.slice(0, 12)}: ${added.length} older file(s) added`);
  }
  console.log(`pages-retained-bundles: ${commits.length} earlier build(s) since the switch kept (--keep=${keep}); ${legacyResult.added.length + recentAdded} file(s) ${dryRun ? 'would be' : ''} added in all`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('pages-retained-bundles: ' + e.message); process.exit(1); }
}

module.exports = { BUILD_INPUTS, findLegacy, recentBuildCommits };
