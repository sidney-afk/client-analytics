'use strict';
/*
 * pages-site-allowlist.js -- the published site is the allowlist, nothing more,
 * and everything the app loads is still on it.
 *
 * Builds the site folder exactly as CI does (scripts/pages-site.js), then
 * serves TWO folders the way GitHub Pages does:
 *   - the repository root (what is live today: the whole repository), and
 *   - the built site folder (what goes live after the Pages source switch).
 * Every address the app answers must give the same status and the same bytes
 * from both, and every source/plan/config address must answer 200 from the
 * first and 404 from the second. No network, no browser, no client data;
 * addresses use invented placeholder names only.
 *
 * The real-browser half (every page boots, every js/ part loads) is
 * docs/syncview-design/tests/pages-site-browser.js.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const site = require('../scripts/pages-site.js');

const ROOT = site.ROOT;
let passed = 0;
// test/run-all.js preloads test/helpers/single-file-index.js, which answers a
// read of the repository's index.html BY PATH with the single-file page instead
// of the file on disk. This suite must see the bytes that are really served, so
// it reads through a file descriptor, which that preload leaves alone.
function raw(file) {
  const fd = fs.openSync(file, 'r');
  try { return fs.readFileSync(fd); } finally { fs.closeSync(fd); }
}
function ok(label) { passed += 1; console.log('  ok  ' + label); }

// Invented placeholders only: this repository names no client.
const SLUG = 'synthetic-slug';
const CARD = 'p_synthetic_1';

function addresses() {
  const { names } = site.routeStubNames();
  const list = ['/', '/index.html'];
  for (const n of names) list.push('/' + n, '/' + n + '.html');
  list.push(
    // deep links land on 404.html, the router that hands them to the app
    '/calendar/' + SLUG + '/' + CARD, '/synclinear/synthetic-id', '/synclinear/batch/synthetic-batch',
    '/onboarding/synthetic-view', '/sample-reviews/' + SLUG, '/unknown/path',
    // the onboarding forms (standard and AI, both spellings)
    '/onboarding_form', '/onboarding-form', '/ai_onboarding_form', '/ai-onboarding-form',
    // client share links and the legacy entry forms, all served by index.html
    '/?c=' + SLUG + '&v=calendar&t=synthetic-token', '/?c=' + SLUG + '&v=brief&t=synthetic-token',
    '/?intake=1', '/?onboarding=1', '/?onboarding=ai', '/index.html#smm-weekly-report',
  );
  return list;
}

// Every file the app can request under the published folders and root.
function assetAddresses(siteFiles) {
  return siteFiles.map(f => '/' + f);
}

// The js/ parts index.html asks for: FULL, PARTS and LAZY in its loader.
function loaderParts() {
  const html = raw(path.join(ROOT, 'index.html')).toString('utf8');
  const parts = new Set();
  for (const m of html.matchAll(/"(js\/sv-[A-Za-z0-9-]+\.js)"/g)) parts.add('/' + m[1]);
  return [...parts].sort();
}

// Repository top-level names the app references from quoted strings and CSS
// url(...) in its page and scripts. Anything that resolves to a repository
// entry which is not published is a page that would 404 after the switch.
function referencedTopLevel() {
  const top = new Set(fs.readdirSync(ROOT).filter(e => !e.startsWith('.git')));
  const sources = ['index.html', '404.html', ...site.routeStubNames().names.map(n => n + '.html')]
    .concat(site.listFiles(path.join(ROOT, 'js')).map(f => 'js/' + f));
  // Quoted with ' or " or in url(...): a run-time reference. Back-ticked names
  // in these files are prose mentions of repository paths in comments, and only
  // count when they name something published.
  const quoted = /["']\/?([A-Za-z0-9_.-]+)(\/[A-Za-z0-9_./-]*)?["'?#]/g;
  const urlFn = /url\(\s*["']?\/?([A-Za-z0-9_.-]+)(\/[A-Za-z0-9_./-]*)?/g;
  const found = new Map();
  for (const rel of sources) {
    const text = raw(path.join(ROOT, rel)).toString('utf8');
    for (const re of [quoted, urlFn]) {
      for (const m of text.matchAll(re)) {
        const head = m[1];
        const rest = m[2] || '';
        if (!top.has(head)) continue;
        const isDir = fs.statSync(path.join(ROOT, head)).isDirectory();
        if (isDir && !rest) continue; // a bare word that happens to match a folder name
        if (!found.has(head)) found.set(head, rel);
      }
    }
  }
  return found;
}

async function main() {
  console.log('pages-site-allowlist');
  const plan = site.plan();
  assert.deepEqual(plan.problems, [], 'the publish list has problems: ' + plan.problems.join('; '));
  ok('publish list resolves: ' + plan.files.length + ' files, no missing entry, no undecided root page');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-site-test-'));
  const siteDir = path.join(tmp, 'site');
  let repoServer;
  let siteServer;
  try {
    const built = site.build(siteDir);
    assert.deepEqual(site.listFiles(siteDir), built.files, 'the folder holds exactly the planned files');
    ok('site folder holds exactly the planned files');

    for (const f of built.files) {
      assert.ok(Buffer.compare(raw(path.join(siteDir, f)), raw(path.join(ROOT, f))) === 0, f + ' differs from the repository copy');
    }
    ok('every published file is byte-identical to the repository copy');

    repoServer = await site.pagesServer(ROOT);
    siteServer = await site.pagesServer(siteDir);
    const repoOrigin = 'http://127.0.0.1:' + repoServer.address().port;
    const siteOrigin = 'http://127.0.0.1:' + siteServer.address().port;

    // 1. Every app address answers exactly as it does today.
    const addrs = addresses();
    for (const a of addrs) {
      const before = await site.fetchStatus(repoOrigin, a);
      const after = await site.fetchStatus(siteOrigin, a);
      assert.deepEqual(after, before, 'address changed: ' + a + ' -> ' + JSON.stringify({ before: before.status, after: after.status }));
    }
    ok(addrs.length + ' app addresses (staff pages, deep links, forms, client links, weekly reports) answer the same status and bytes');

    // deep links and unknown paths reach the router (404.html with status 404)
    const router = await site.fetchStatus(siteOrigin, '/calendar/' + SLUG + '/' + CARD);
    assert.equal(router.status, 404, 'deep links are answered by the 404.html router, as on GitHub Pages');
    assert.equal(router.sha256, (await site.fetchStatus(siteOrigin, '/404.html')).sha256, 'the router page is 404.html');
    ok('deep links still reach the 404.html router');

    // 2. Every runtime file answers 200 with the same bytes.
    const assets = assetAddresses(built.files);
    for (const a of assets) {
      const before = await site.fetchStatus(repoOrigin, a);
      const after = await site.fetchStatus(siteOrigin, a);
      assert.equal(after.status, 200, 'published file does not load: ' + a);
      assert.deepEqual(after, before, 'published file changed: ' + a);
    }
    ok(assets.length + ' published files load with unchanged bytes');

    // 3. The loader's js/ parts are all there.
    const parts = loaderParts();
    assert.ok(parts.length >= 10, 'the loader lists the split parts (' + parts.length + ' found)');
    for (const p of parts) assert.equal((await site.fetchStatus(siteOrigin, p)).status, 200, 'loader part missing: ' + p);
    ok(parts.length + ' js/ parts named by the loader all load');

    // 4. Source, plans and config no longer answer. The repository-root run
    //    proves the check can see them: the live site served these on 2026-09-29.
    for (const p of site.DENIED_PATHS) {
      const after = await site.fetchStatus(siteOrigin, p);
      assert.equal(after.status, 404, 'still published: ' + p);
    }
    for (const p of ['/docs/STATE_OF_THINGS.md', '/CLAUDE.md', '/scripts/pages-site.js', '/migrations/2026-06-18-atomic-comment-merge.sql', '/supabase/config.toml']) {
      assert.equal((await site.fetchStatus(repoOrigin, p)).status, 200, 'the repository-root run should serve ' + p + ', otherwise this test cannot see the difference');
    }
    ok(site.DENIED_PATHS.length + ' source, plan and config addresses answer 404 (they answer 200 from the repository root)');
    for (const dir of ['docs', 'scripts', 'migrations', 'supabase', 'test', 'qa', 'src', 'n8n-backups', 'thumbnails', '.github']) {
      assert.equal(built.files.some(f => f === dir || f.startsWith(dir + '/')), false, dir + '/ must not be in the site folder');
    }
    for (const f of ['CLAUDE.md', 'AGENTS.md', 'README.md', 'REPO_MAP.md', 'ROLLBACK.md', 'EXECUTION_LOG.md', 'package.json', '.gitignore', '.gitattributes']) {
      assert.equal(built.files.includes(f), false, f + ' must not be in the site folder');
    }
    ok('no repository folder or top-level document is in the site folder');

    // 5. Nothing the app references by path is left out.
    const missing = [];
    const publishedTop = new Set([...site.PAGE_FILES, ...site.PUBLISHED_FILES, ...site.PUBLISHED_DIRS, ...site.routeStubNames().names.map(n => n + '.html')]);
    // Repository folders that only ever appear in comments and prose, never as
    // a run-time path, so a quoted mention is not a page that would 404.
    const PROSE_ONLY = new Set(['docs', 'scripts', 'test', 'src', 'migrations', 'supabase', 'qa']);
    for (const [head, from] of referencedTopLevel()) {
      if (publishedTop.has(head)) continue;
      if (PROSE_ONLY.has(head)) continue;
      missing.push(head + ' (first seen in ' + from + ')');
    }
    assert.deepEqual(missing, [], 'the app references repository paths that are not published: ' + missing.join(', '));
    ok('every repository path the page and scripts reference is published');

    // 6. The workflow never deploys from a pull request.
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pages-site.yml'), 'utf8');
    const deployJob = wf.slice(wf.indexOf('\n  deploy:'));
    assert.ok(wf.includes('actions/deploy-pages@'), 'the workflow deploys with deploy-pages');
    assert.equal((wf.slice(0, wf.indexOf('\n  deploy:')).match(/deploy-pages@/g) || []).length, 0, 'the build job has no deploy step');
    assert.match(deployJob, /github\.event_name != 'pull_request'/, 'the deploy job refuses pull_request runs');
    assert.match(deployJob, /github\.ref == 'refs\/heads\/main'/, 'the deploy job runs only from main');
    assert.match(deployJob, /needs\.build\.outputs\.source == 'workflow'/, 'the deploy job runs only once the Pages source is switched to Actions');
    ok('the workflow builds and checks on every pull request and deploys only from main, after the Pages source is switched');
  } finally {
    if (repoServer) repoServer.close();
    if (siteServer) siteServer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('pages-site-allowlist: ' + passed + ' groups passed');
}

main().catch(e => { console.error('FAIL pages-site-allowlist: ' + (e && e.stack || e)); process.exit(1); });
