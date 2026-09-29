'use strict';
/* first-load-measure.js -- staff (and client link) first-load size and time,
 * with the load-per-tab split off ("before": one file) and on ("after": the
 * loader plus the parts a staff browser needs).
 *
 * Plan: docs/plans/2026-09-28-load-per-tab-plan.md, step 4. Same method as the
 * plan's baseline: the page is served locally with gzip, headless Chromium,
 * every load cold (a fresh browser context each time), median of N, "ready" =
 * DOMContentLoaded. Every request outside the local server answers empty, so
 * this measures what the code costs, not the network to the backend.
 *
 *   node qa/lazy/first-load-measure.js [--runs=5] [--json=path]
 *
 * "before" is the plain concatenation of the fragments (what index.html was
 * with the switch off), "after" is the committed index.html and js/ as they are.
 * Bytes are compressed bytes on the wire for the local origin. "At load" counts
 * what had arrived by DOMContentLoaded; "after prefetch" waits for the quiet
 * background download of the on-demand areas to finish.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const { chromium } = require('playwright');
const { seedStaffGate } = require('../staff-gate-seed');
const { CORS, clientLinkRoute, clientLinkUrl } = require('../../docs/syncview-design/tests/client-link-fixture');

const ROOT = path.resolve(__dirname, '..', '..');
const arg = (k, d) => { const m = process.argv.find(a => a.startsWith('--' + k + '=')); return m ? m.slice(k.length + 3) : d; };
const RUNS = Math.max(1, parseInt(arg('runs', '5'), 10));
const JSON_OUT = arg('json', '');

// "Before": the plain concatenation of the fragments, built the way the
// single-file page always was. "After": index.html and js/ exactly as committed.
const { readModuleList, servedBytes } = require('../../scripts/index-modules');
const SRC = path.join(ROOT, 'src', 'index');
const entries = fs.readFileSync(path.join(SRC, 'manifest.txt'), 'utf8').split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#'));
const modules = readModuleList(SRC);
const SINGLE = Buffer.concat(entries.map(e => servedBytes(e, fs.readFileSync(path.join(SRC, e)), modules)));
const DISK = fs.readFileSync(path.join(ROOT, 'index.html'));
const SPLIT_ON = JSON.parse(fs.readFileSync(path.join(SRC, 'split.json'), 'utf8')).enabled === true;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function serve(indexBytes) {
  const gz = new Map();
  const send = (res, type, body) => {
    if (!gz.has(body)) gz.set(body, zlib.gzipSync(body, { level: 6 }));
    res.writeHead(200, { 'content-type': type, 'content-encoding': 'gzip', 'cache-control': 'no-store' });
    res.end(gz.get(body));
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '/index.html') return send(res, MIME['.html'], indexBytes);
    const full = path.join(ROOT, path.normalize(p));
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    send(res, MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', fs.readFileSync(full));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const PROFILES = [
  { name: 'desktop', net: null, cpu: 1 },
  { name: 'phone, typical 4G', net: { latency: 60, down: 9e6 / 8, up: 9e6 / 8 }, cpu: 4 },
  { name: 'phone, slow', net: { latency: 150, down: 1.6e6 / 8, up: 1.6e6 / 8 }, cpu: 4 },
];

const median = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function once(browser, origin, kind, profile) {
  const context = await browser.newContext();
  const external = u => !/^http:\/\/127\.0\.0\.1/.test(u.toString());
  if (kind === 'staff') {
    await context.route(external, r => (r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: CORS, body: '' })
      : r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' }).catch(() => {})));
    await seedStaffGate(context);
  } else {
    await context.route(external, clientLinkRoute('calendar'));
  }
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const sizes = new Map(); const done = new Map();
  cdp.on('Network.requestWillBeSent', e => sizes.set(e.requestId, e.request.url));
  cdp.on('Network.loadingFinished', e => done.set(e.requestId, { bytes: e.encodedDataLength, at: Date.now() }));
  if (profile.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.net.latency, downloadThroughput: profile.net.down, uploadThroughput: profile.net.up });
  if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  const url = kind === 'staff' ? origin + '/' : clientLinkUrl(origin, 'calendar').replace(/^http:\/\/[^/]+/, origin);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const ready = await page.evaluate(() => { const t = performance.timing; return t.domContentLoadedEventEnd - t.navigationStart; });
  const local = () => [...done.entries()].filter(([id]) => (sizes.get(id) || '').startsWith(origin)).reduce((n, [, v]) => n + v.bytes, 0);
  const atLoad = local();
  const files = () => [...done.keys()].filter(id => (sizes.get(id) || '').startsWith(origin)).map(id => sizes.get(id).replace(origin, '')).sort();
  let after = atLoad;
  let filesLoad = files();
  // Let the quiet background download finish (it starts about 2.5 s after load).
  const wait = kind === 'staff' && SPLIT_ON ? 9000 + (profile.cpu > 1 ? 9000 : 0) + (profile.net && profile.net.down < 1e6 ? 15000 : 0) : 500;
  await page.waitForTimeout(wait);
  after = local();
  const filesAfter = files();
  await context.close();
  return { ready, atLoad, after, nFilesLoad: filesLoad.length, nFilesAfter: filesAfter.length };
}

(async () => {
  const before = await serve(SINGLE);
  const after = await serve(DISK);
  const browser = await chromium.launch({ headless: true });
  const out = { runs: RUNS, splitOn: SPLIT_ON, rows: [] };
  try {
    for (const kind of ['staff', 'client link']) {
      for (const profile of PROFILES) {
        const res = {};
        for (const [label, server] of [['before', before], ['after', after]]) {
          const origin = `http://127.0.0.1:${server.address().port}`;
          const runs = [];
          for (let i = 0; i < RUNS; i++) runs.push(await once(browser, origin, kind === 'staff' ? 'staff' : 'client', profile));
          res[label] = { ready: median(runs.map(r => r.ready)), atLoad: median(runs.map(r => r.atLoad)), afterPrefetch: median(runs.map(r => r.after)), filesAtLoad: median(runs.map(r => r.nFilesLoad)), filesAfter: median(runs.map(r => r.nFilesAfter)) };
        }
        out.rows.push({ kind, profile: profile.name, before: res.before, after: res.after });
        console.log(`${kind} | ${profile.name} | before ${res.before.atLoad} B, ${res.before.ready} ms | after ${res.after.atLoad} B (${res.after.afterPrefetch} B once prefetched), ${res.after.ready} ms`);
      }
    }
  } finally {
    await browser.close(); before.close(); after.close();
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2) + '\n');
})().catch(e => { console.error(e); process.exit(1); });
