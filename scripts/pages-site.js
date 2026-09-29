'use strict';
/*
 * pages-site.js -- builds the folder that GitHub Pages publishes, from an
 * explicit allowlist, instead of publishing the whole repository.
 *
 * WHY. Until this existed, GitHub Pages served the repository root, so the
 * live site also answered /docs/..., /CLAUDE.md, /scripts/..., /migrations/...
 * and /supabase/... to anyone. Measured 2026-09-29. Publishing only what the
 * app loads removes that, whether the repository is public or private.
 *
 *   node scripts/pages-site.js build [--out=<dir>]   write the site folder
 *                                                    (default .pages-site)
 *   node scripts/pages-site.js check                 build to a temp folder and
 *                                                    run the structure checks
 *   node scripts/pages-site.js serve <dir>           serve a folder the way
 *                                                    GitHub Pages does (for
 *                                                    looking at it by hand)
 *   node scripts/pages-site.js probe <origin>        ask a live site (default
 *                                                    https://syncview.synchrosocial.com)
 *                                                    for the app addresses and
 *                                                    the source addresses, and
 *                                                    say which side each is on
 *
 * WHAT IS PUBLISHED (everything else is not):
 *   - index.html and 404.html (the address router for deep links and forms);
 *   - one stub page per top-level address (scripts/build-route-stubs.js owns
 *     that list; a stray root .html that is not on it fails the build);
 *   - CNAME and the three logo/favicon images;
 *   - the directories the app loads at run time: js/ (the split parts),
 *     nav-icons/, thumbnail-styles/, onboarding-ai/, onboarding-audio/,
 *     onboarding-video/.
 * NOT published: thumbnails/ (a separate mock-up tool the app never loads; add
 * it to PUBLISHED_DIRS below if it is wanted at /thumbnails/ again).
 *
 * TO PUBLISH ONE MORE FILE OR FOLDER, add it to PUBLISHED_FILES or
 * PUBLISHED_DIRS. test/pages-site-allowlist.js fails if the app references a
 * repository path that is not published, so a forgotten entry is caught before
 * merge, not by a visitor.
 *
 * Dependency-free on purpose (runs in the `unit` lane).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

const PAGE_FILES = ['index.html', '404.html'];
const PUBLISHED_FILES = [
  'CNAME',
  'synchro-social-favicon.png',
  'synchro-social-logo.png',
  'syncview-favicon.png',
];
const PUBLISHED_DIRS = [
  'js',
  'nav-icons',
  'thumbnail-styles',
  'onboarding-ai',
  'onboarding-audio',
  'onboarding-video',
];
// Addresses that must NOT answer on the live site. Each is a repository
// location that used to be served and holds source, plans or credentials-adjacent
// notes rather than anything the app loads.
const DENIED_PATHS = [
  '/docs/STATE_OF_THINGS.md',
  '/docs/ops/OPEN_REPAIRS.md',
  '/CLAUDE.md',
  '/AGENTS.md',
  '/README.md',
  '/package.json',
  '/scripts/pages-site.js',
  '/scripts/repo-identity-exposure-check.js',
  '/migrations/2026-06-18-atomic-comment-merge.sql',
  '/supabase/config.toml',
  '/supabase/functions/brain/index.ts',
  '/test/run-all.js',
  '/qa/staff-gate-seed.js',
  '/src/index/000-head.html.part',
  '/n8n-backups/',
  '/.github/workflows/pages-site.yml',
  '/thumbnails/index.html',
];

function routeStubNames() {
  const { routeTable, stubHtml } = require('./build-route-stubs.js');
  return { names: routeTable().TOP, stubHtml };
}

function listFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  })(dir);
  return out.sort();
}

// The relative paths the site folder must contain, and the problems that stop
// it being built at all.
function plan(root = ROOT) {
  const problems = [];
  const files = [];
  const { names } = routeStubNames();
  const stubs = names.map(n => n + '.html');
  for (const f of [...PAGE_FILES, ...stubs, ...PUBLISHED_FILES]) {
    if (!fs.existsSync(path.join(root, f))) problems.push('missing published file: ' + f);
    else files.push(f);
  }
  for (const d of PUBLISHED_DIRS) {
    const full = path.join(root, d);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) { problems.push('missing published directory: ' + d); continue; }
    for (const f of listFiles(full)) files.push(d + '/' + f);
  }
  // A root .html nobody decided about would otherwise be silently unpublished.
  const known = new Set([...PAGE_FILES, ...stubs]);
  for (const entry of fs.readdirSync(root)) {
    if (entry.endsWith('.html') && !known.has(entry)) problems.push('root page not on the publish list: ' + entry + ' (add a route stub, or list it deliberately)');
  }
  return { files: [...new Set(files)].sort(), problems };
}

function build(outDir, root = ROOT) {
  const { files, problems } = plan(root);
  if (problems.length) {
    const err = new Error('pages-site: ' + problems.join('; '));
    err.problems = problems;
    throw err;
  }
  const abs = path.resolve(outDir);
  const inside = base => abs.startsWith(path.resolve(base) + path.sep);
  if (abs === root || !(inside(root) || inside(os.tmpdir()))) {
    throw new Error('pages-site: refusing to write the site folder to ' + abs + ' (it must be inside the repository or the temp folder)');
  }
  fs.rmSync(abs, { recursive: true, force: true });
  for (const f of files) {
    const to = path.join(abs, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, f), to);
  }
  return { out: abs, files };
}

// ---- GitHub-Pages-style server ------------------------------------------
// What Pages does with an address, as far as this site depends on it:
//   /a/b.ext        the file, if it exists
//   /a              a.html, if it exists (Pages serves clean paths this way)
//   /a/ or /        a/index.html, if it exists
//   anything else   404.html with status 404 (the deep-link router)
// Paths are case-sensitive. A missing 404.html gives Pages' own bare 404.
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

function resolvePagesPath(dir, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch (e) { return { status: 404, file: path.join(dir, '404.html') }; }
  const clean = path.posix.normalize('/' + p);
  const tryFile = rel => {
    const full = path.join(dir, rel);
    if (full !== dir && !full.startsWith(dir + path.sep)) return null;
    return fs.existsSync(full) && fs.statSync(full).isFile() ? full : null;
  };
  const trailing = clean.endsWith('/');
  const rel = clean.replace(/^\/+/, '').replace(/\/+$/, '');
  let hit = null;
  if (rel === '') hit = tryFile('index.html');
  else if (trailing) hit = tryFile(rel + '/index.html');
  else hit = tryFile(rel) || tryFile(rel + '.html') || tryFile(rel + '/index.html');
  if (hit) return { status: 200, file: hit };
  return { status: 404, file: tryFile('404.html') };
}

function pagesServer(dir) {
  const abs = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const r = resolvePagesPath(abs, url.pathname);
    if (!r.file) { res.writeHead(r.status, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(r.status, { 'Content-Type': MIME[path.extname(r.file).toLowerCase()] || 'application/octet-stream' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(r.file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function fetchStatus(origin, pathAndQuery) {
  return new Promise((resolve, reject) => {
    http.get(origin + pathAndQuery, res => {
      const hash = crypto.createHash('sha256');
      res.on('data', c => hash.update(c));
      res.on('end', () => resolve({ status: res.statusCode, sha256: hash.digest('hex') }));
    }).on('error', reject);
  });
}

// Live probe: read-only GETs against a running site. App addresses must answer
// (200, or 404 for deep links, which 404.html routes); source addresses must not.
async function probe(origin) {
  const https = require('https');
  const get = p => new Promise((resolve, reject) => {
    https.get(origin + p, { headers: { 'user-agent': 'pages-site-probe' } }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
  const { names } = routeStubNames();
  const app = ['/', '/index.html', '/404.html', ...names.map(n => '/' + n), '/nav-icons/analytics.png', '/syncview-favicon.png'];
  const deep = ['/calendar/synthetic-slug/p_synthetic_1', '/onboarding_form', '/ai_onboarding_form'];
  let bad = 0;
  for (const p of app) { const st = await get(p); const good = st === 200; if (!good) bad++; console.log((good ? 'ok   ' : 'FAIL ') + st + ' ' + p + ' (app address, must answer)'); }
  for (const p of deep) { const st = await get(p); const good = st === 404 || st === 200; if (!good) bad++; console.log((good ? 'ok   ' : 'FAIL ') + st + ' ' + p + ' (deep link, 404.html routes it)'); }
  let served = 0;
  for (const p of DENIED_PATHS) { const st = await get(p); if (st === 200) { served++; console.log('OPEN ' + st + ' ' + p + ' (source address, still published)'); } else console.log('shut ' + st + ' ' + p + ' (source address)'); }
  console.log(`probe ${origin}: ${bad} app addresses failing, ${served} of ${DENIED_PATHS.length} source addresses still published`);
  return { bad, served };
}

async function main() {
  const cmd = process.argv[2];
  const arg = name => (process.argv.find(a => a.startsWith('--' + name + '=')) || '').split('=').slice(1).join('=');
  if (cmd === 'build') {
    const { out, files } = build(arg('out') || path.join(ROOT, '.pages-site'));
    console.log(`pages-site: wrote ${files.length} files to ${path.relative(ROOT, out) || out}`);
    return;
  }
  if (cmd === 'check') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-site-'));
    try {
      const { files } = build(tmp);
      console.log(`pages-site check: built ${files.length} files`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    return;
  }
  if (cmd === 'serve') {
    const dir = process.argv[3];
    if (!dir) { console.error('usage: node scripts/pages-site.js serve <dir>'); process.exit(2); }
    const server = await pagesServer(dir);
    console.log('serving ' + dir + ' at http://127.0.0.1:' + server.address().port);
    return;
  }
  if (cmd === 'probe') {
    const r = await probe(process.argv[3] || 'https://syncview.synchrosocial.com');
    process.exit(r.bad ? 1 : 0);
  }
  console.error('usage: node scripts/pages-site.js build [--out=dir] | check | serve <dir> | probe [origin]');
  process.exit(2);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = {
  ROOT, PAGE_FILES, PUBLISHED_FILES, PUBLISHED_DIRS, DENIED_PATHS,
  plan, build, listFiles, resolvePagesPath, pagesServer, fetchStatus, routeStubNames,
};
