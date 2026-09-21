'use strict';
/*
 * A BYTE THAT MOVED IS NOT A BYTE THAT WAS ADDED.
 *
 * Owner-ratified 2026-09-21, for the index.html modularization split:
 * `scripts/repo-identity-exposure-check.js` in `--diff` mode scans a change's
 * ADDED lines for a roster term, and a source split that copies `index.html`
 * verbatim into new fragment files makes every one of those bytes look
 * "added" to `git diff`, even though none of them is newly public — the whole
 * file was already tracked and public at the diff base. The fix in
 * `addedLinesContaining()` skips an added line only when its bytes are an
 * EXACT full-line match against a line already present in the diff base's
 * `index.html`; nothing normalized, nothing fuzzy, and no name/path exemption.
 *
 * This suite proves both directions of that narrow rule against a disposable
 * synthetic git fixture, using invented roster terms that are never real
 * client slugs or staff names:
 *   (a) a line moved verbatim from the base's index.html into a new file is
 *       NOT reported as new exposure;
 *   (b) a genuinely new line — never present in the base's index.html —
 *       naming a roster term IS still reported, even in the same commit.
 *
 * The roster read is a local HTTP fixture (never the live Supabase project),
 * so this stays fully offline like every other suite `test/run-all.js` runs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_SOURCE = path.join(ROOT, 'scripts', 'repo-identity-exposure-check.js');

const temporaryRoots = [];
let passed = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  passed += 1;
  console.log('  ok  ' + message);
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/* A synthetic Supabase REST stand-in. Serves exactly the two endpoints
   roster() reads, from fixed in-memory rows — never a live project, and never
   a real client slug or colleague's name. */
function startFakeRoster(rows) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let body;
    if (url.pathname === '/rest/v1/clients') body = rows.clients;
    else if (url.pathname === '/rest/v1/team_members') body = rows.team_members;
    else { res.writeHead(404); res.end('[]'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function buildFixtureRepo() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'syncview-identity-moved-line-test-'));
  temporaryRoots.push(tempRoot);
  const repo = path.join(tempRoot, 'repo');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src', 'index'), { recursive: true });

  // The script resolves its own ROOT from __dirname, so copying it into the
  // fixture's own scripts/ directory makes it operate on the fixture repo,
  // never on this real checkout.
  fs.copyFileSync(SCRIPT_SOURCE, path.join(repo, 'scripts', 'repo-identity-exposure-check.js'));

  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Identity Fixture']);
  git(repo, ['config', 'user.email', 'identity-fixture@example.invalid']);

  return { tempRoot, repo };
}

function commit(repo, message) {
  git(repo, ['add', '--all']);
  git(repo, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

// The fake roster server above lives in THIS process. spawnSync would block
// this process's event loop for the child's whole lifetime, so the server
// could never answer the child's fetch — a self-deadlock. spawn()+Promise
// keeps the event loop free while the child runs.
function runCheck(repo, base, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(repo, 'scripts', 'repo-identity-exposure-check.js'),
      `--diff=${base}`,
      '--json',
    ], { cwd: repo, env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => {
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`identity check did not print JSON (status ${status}):\n${stdout}\n${stderr}`));
      }
    });
  });
}

async function main() {
  // Invented, fixture-only identifiers — never a real client slug or a real
  // colleague's name.
  const SYNTHETIC_SLUG = 'zzzfixtureclientmovedline';
  const SYNTHETIC_STAFF_NAME = 'Zzq Fixturestaff';

  const server = await startFakeRoster({
    clients: [{ slug: SYNTHETIC_SLUG, kind: 'client', active: true }],
    team_members: [{ name: SYNTHETIC_STAFF_NAME, active: true }],
  });
  const port = server.address().port;
  const env = {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${port}`,
    SUPABASE_ANON_KEY: 'fixture-key-not-a-real-credential',
  };

  try {
    const { repo } = buildFixtureRepo();

    // Seed base: index.html carries one line naming the synthetic client slug.
    const movedLine = `    var CLIENT_SLUG = "${SYNTHETIC_SLUG}";`;
    fs.writeFileSync(path.join(repo, 'index.html'),
      `<!doctype html>\n<script>\n${movedLine}\n</script>\n</html>\n`);
    fs.writeFileSync(path.join(repo, 'README.md'), 'fixture repo\n');
    const base = commit(repo, 'seed base index.html');

    // Change under test:
    //   (a) copy the EXACT slug line verbatim into a brand-new fragment file
    //       under src/index/*.part (this is the modularization-split shape:
    //       a byte-identical move into a verified fragment destination).
    //   (b) separately, add a genuinely new line elsewhere naming the
    //       synthetic staff member — never present in base's index.html.
    //   (c) copy that SAME verbatim slug line into a non-fragment tracked
    //       file. Owner-tightened 2026-09-21 (Codex P1 on #1464): the
    //       exemption is scoped to src/index/*.part destinations only, so an
    //       identical move anywhere else is still new exposure.
    fs.writeFileSync(path.join(repo, 'src', 'index', '999-remainder.part'),
      `<script>\n${movedLine}\n</script>\n`);
    fs.writeFileSync(path.join(repo, 'docs-note.txt'),
      `New note that was never in index.html, mentioning ${SYNTHETIC_STAFF_NAME} by name.\n`);
    fs.writeFileSync(path.join(repo, 'docs-note-2.txt'), `${movedLine}\n`);
    commit(repo, 'split index.html and add unrelated new notes');

    const result = await runCheck(repo, base, env);

    ok(result.roster_terms_checked === 2, 'fixture roster carries exactly the two synthetic terms');

    const slugFile = (result.files || []).find((f) => f.file === 'src/index/999-remainder.part');
    ok(!slugFile, '(a) a line moved verbatim from the base index.html into a src/index/*.part fragment is NOT reported as new exposure');

    const noteFile = (result.files || []).find((f) => f.file === 'docs-note.txt');
    ok(!!noteFile && noteFile.staff_name === 1,
      '(b) a genuinely new line naming a roster term, never present in the base index.html, IS still reported');

    const nonFragmentSlugFile = (result.files || []).find((f) => f.file === 'docs-note-2.txt');
    ok(!!nonFragmentSlugFile && nonFragmentSlugFile.client_slug === 1,
      '(c) the SAME verbatim moved line landing outside src/index/*.part IS still reported — the exemption is scoped to fragment destinations, not any file');

    ok(result.matched_by_kind.client_slug === 1,
      'exactly one matched client-slug term: the non-fragment copy, not the fragment one');
    ok(result.matched_by_kind.staff_name === 1,
      'the new staff-name line contributes exactly one matched staff-name term');
  } finally {
    server.close();
    for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
  }

  console.log(`\nrepo-identity-exposure-moved-lines: ${passed} check(s) passed`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
