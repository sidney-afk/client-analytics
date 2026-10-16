'use strict';
/*
 * check-index.js (npm run check:index) -- proves the page build succeeds and
 * is deterministic, and that its output is not committed.
 *
 * Since 2026-10-15 index.html, js/sv-*.js and src/index/INDEX.md are build
 * output only: .gitignore lists them, the Pages publish builds them from
 * src/index/ on every push to main (.github/workflows/pages-site.yml), and
 * every CI job that reads them builds them first (.github/actions/build-index).
 * Committing them made every merge conflict every other open pull request.
 * This used to compare a committed index.html with the build; there is no
 * committed copy any more, so it checks instead that:
 *
 *   1. none of the build outputs is tracked by git (a session that commits
 *      one by habit is told so here, not by the next merge clash);
 *   2. .gitignore ignores each of them;
 *   3. the build succeeds twice, each time into a fresh empty folder;
 *   4. the two builds are byte-for-byte identical, file for file;
 *   5. if a working-tree index.html exists (a local build), it says whether it
 *      is current. That is information only: the file is never published from
 *      here, and the publish builds its own.
 *
 * On success it prints the SHA-256 and byte length of index.html and a digest
 * of the whole output set, as evidence.
 *
 * Usage: node scripts/check-index.js
 *
 * The package.json alias keeps its old name on purpose: package.json is
 * content-pinned by the F27 reconciler closure and the PTO evidence
 * fingerprint, so renaming the alias would stale both.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUTPUTS_GLOB_HINT = ['index.html', 'js/sv-*.js', 'src/index/INDEX.md'];

let failed = false;
function fail(message) {
  console.error('check-index: FAIL - ' + message);
  failed = true;
}

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function isOutputPath(rel) {
  return rel === 'index.html' || rel === 'src/index/INDEX.md' || /^js\/sv-[^/]+\.js$/.test(rel);
}

function listFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function buildInto(dir) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-index.js'), '--out=' + dir], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    fail('the build failed (exit ' + r.status + '):\n' + (r.stderr || r.stdout || '').trim());
    return null;
  }
  const files = new Map();
  for (const rel of listFiles(dir)) files.set(rel, fs.readFileSync(path.join(dir, rel)));
  return files;
}

function main() {
  // 1. Nothing built is tracked.
  const tracked = git(['ls-files', '--', 'index.html', 'js', 'src/index/INDEX.md']).split('\n').filter(Boolean).filter(isOutputPath);
  if (tracked.length) {
    fail(`${tracked.length} build output file(s) are tracked by git (first: ${tracked[0]}). They are built, never committed: git rm --cached them.`);
  }

  // 2. .gitignore covers every output.
  for (const probe of ['index.html', 'js/sv-01-core-000000000000.js', 'src/index/INDEX.md']) {
    const r = spawnSync('git', ['check-ignore', '-q', '--no-index', probe], { cwd: ROOT });
    if (r.status !== 0) fail(`.gitignore does not ignore ${probe}`);
  }

  // 3 and 4. Two clean builds, identical.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-index-'));
  try {
    const a = buildInto(path.join(tmp, 'a'));
    const b = buildInto(path.join(tmp, 'b'));
    if (a && b) {
      const names = [...new Set([...a.keys(), ...b.keys()])].sort();
      for (const rel of names) {
        if (!a.has(rel) || !b.has(rel)) fail(`${rel} came out of only one of the two builds`);
        else if (!a.get(rel).equals(b.get(rel))) fail(`${rel} differs between two builds of the same source: the build is not deterministic`);
      }
      if (!a.has('index.html')) fail('the build wrote no index.html');
      const set = crypto.createHash('sha256');
      for (const rel of names) if (a.has(rel)) set.update(rel + '\0' + sha256(a.get(rel)) + '\n');
      const page = a.get('index.html') || Buffer.alloc(0);
      const js = names.filter(n => n.startsWith('js/'));
      console.log(`check-index: index.html sha256=${sha256(page)} bytes=${page.length}`);
      console.log(`check-index: ${js.length} js file(s), ${names.length} output file(s) in all, output-set sha256=${set.digest('hex')}`);

      // 5. Information only: is a local build current?
      const local = path.join(ROOT, 'index.html');
      if (fs.existsSync(local)) {
        console.log(fs.readFileSync(local).equals(page)
          ? 'check-index: the working-tree index.html is current'
          : 'check-index: note - the working-tree index.html is older than src/index/ (run npm run build:index before testing by hand)');
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failed) {
    console.error('\ncheck-index: FAILED');
    process.exit(1);
  }
  console.log(`\ncheck-index: OK - the build succeeds, two builds are byte-identical, and no output (${OUTPUTS_GLOB_HINT.join(', ')}) is committed`);
}

main();
