'use strict';
/* today-clients-shots.js -- screenshots of Today's "Your clients" chips
 * (owner, 2026-10-07): desktop and phone, light and dark, for an SMM with two
 * own clients and an "also sees" grant to another manager's clients.
 *
 *   node qa/today/today-clients-shots.js --out=<dir>
 *
 * Serves this checkout and answers every backend call locally with fixture
 * data (fixture names only; this repo is public). Nothing reaches the live
 * backend. Also checks that the chips are there in every shot, own before
 * also-seen, and that a chip opens that client's Calendar.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = (process.argv.find(a => a.startsWith('--out=')) || '').slice(6) || path.join(ROOT, 'qa', 'today', 'out');
const MEMBER = { id: 'm_fixture_smm', name: 'Fixture Smm', role: 'smm', team: null };
const NOW = new Date().toISOString();
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const CLIENTS = [
  ['fixture-alpha', 'Alpha Fixture'], ['fixture-beta', 'Beta Fixture'],
  ['fixture-gamma', 'Gamma Fixture'], ['fixture-delta', 'Delta Fixture'], ['fixture-epsilon', 'Epsilon Fixture'],
  ['fixture-zeta', 'Zeta Fixture'],
].map(([slug, display_name]) => ({ slug, display_name, active: true, kind: 'client' }));
const MANAGERS = [
  { slug: 'fixture-smm', name: 'Fixture Smm', email: '', active: true, source_clients: ['Alpha Fixture', 'Beta Fixture'] },
  { slug: 'fixture-other', name: 'Other Manager', email: '', active: true, source_clients: ['Gamma Fixture', 'Delta Fixture', 'Epsilon Fixture'] },
  { slug: 'fixture-third', name: 'Third Manager', email: '', active: true, source_clients: ['Zeta Fixture'] },
];
const ALSO = [{ viewer_member_id: MEMBER.id, manager_slug: 'fixture-other', client_name: null }];
const del = (id, title, slug, status) => ({ id, client_slug: slug, team: 'video', kind: 'video', title, status, status_at: NOW, assignee_id: null, due_date: iso(3), origin: 'calendar', card_id: null, linear_issue_uuid: null });
const ROWS = [
  del('d1', 'Fixture reel one', 'fixture-alpha', 'smm_approval'), del('d2', 'Fixture reel two', 'fixture-beta', 'smm_approval'),
  del('d3', 'Fixture reel three', 'fixture-gamma', 'smm_approval'), del('d4', 'Fixture reel four', 'fixture-zeta', 'smm_approval'),
];

let failures = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL  ') + m); if (!c) failures++; };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, path.normalize(p));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(''); }
      const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'text/html';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(f));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function shot(browser, origin, phone, dark) {
  const context = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 } });
  await context.addInitScript(([id, dark]) => {
    localStorage.setItem('syncview_staff_identity_v1', JSON.stringify(id));
    sessionStorage.setItem('syncview_staff_identity_prompted_v1', '1');
    if (dark) localStorage.setItem('syncview_theme', 'dark'); else localStorage.removeItem('syncview_theme');
  }, [{ key: 'fixture-role-key', role: MEMBER.role, member: MEMBER, verified_at: NOW }, dark]);
  await context.route('**/*', route => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await context.route('**/functions/v1/key-verify', route => json(route, { ok: true, role: MEMBER.role, member: MEMBER }));
  await context.route('**/rest/v1/team_members**', route => json(route, route.request().url().includes('select=email') ? [{ email: '' }] : [MEMBER]));
  await context.route('**/rest/v1/clients**', route => json(route, CLIENTS));
  await context.route('**/rest/v1/calendar_posts**', route => json(route, []));
  await context.route('**/rest/v1/production_deliverables_browser_v1**', route => {
    const u = decodeURIComponent(route.request().url());
    return json(route, u.includes('raw_issue_parent_id') ? [] : (u.includes('smm_approval') && u.includes('todo') ? ROWS : []));
  });
  await context.route('**/functions/v1/smm-weekly-reports**', route => json(route, { ok: true, managers: MANAGERS, also_sees: ALSO }));
  const page = await context.newPage();
  await page.goto(origin + '/index.html#today', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tdyRoot .tdy-clients .tdy-cl', { timeout: 30000 });
  await page.waitForTimeout(600);
  const label = (phone ? 'phone' : 'desktop') + '-' + (dark ? 'dark' : 'light');
  const got = await page.evaluate(() => ({
    own: [...document.querySelectorAll('#tdyRoot .tdy-cl:not(.also) .tdy-cl-n')].map(e => e.textContent),
    also: [...document.querySelectorAll('#tdyRoot .tdy-cl.also .tdy-cl-n')].map(e => e.textContent),
    order: (() => { const t = document.querySelector('#tdyRoot .tdy-clients').textContent; return t.indexOf('Your clients') >= 0 && t.indexOf('Your clients') < t.indexOf('Also seeing'); })(),
    dark: document.documentElement.getAttribute('data-theme') === 'dark',
    minChip: Math.min(...[...document.querySelectorAll('#tdyRoot .tdy-cl')].map(e => e.getBoundingClientRect().height)),
    under: (() => { const big = document.querySelector('#tdyRoot .tdy-big'); const cl = document.querySelector('#tdyRoot .tdy-clients'); return !!big && !!cl && big.nextElementSibling === cl; })()
  }));
  ok(JSON.stringify(got.own) === JSON.stringify(['Alpha Fixture', 'Beta Fixture']), label + ': the two own clients are chips');
  ok(JSON.stringify(got.also) === JSON.stringify(['Delta Fixture', 'Epsilon Fixture', 'Gamma Fixture']), label + ': the also-seen clients are separate, quieter chips');
  ok(got.order && got.under, label + ': right under the greeting, own first');
  ok(got.dark === dark, label + ': theme is ' + (dark ? 'dark' : 'light'));
  if (phone) ok(got.minChip >= 44, label + ': every chip is a 44 px touch target (smallest ' + Math.round(got.minChip) + ' px)');
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'today-clients-' + label + '.png'), clip: phone ? undefined : { x: 0, y: 0, width: 1440, height: 640 } });
  if (!phone && !dark) {
    await page.click('#tdyRoot .tdy-cl[data-k="cl:fixture-alpha"]');
    const onCal = () => { const n = document.getElementById('navCalendar'); return !!n && n.classList.contains('active'); };
    await page.waitForFunction(onCal, null, { timeout: 10000 }).catch(() => {});
    const opened = await page.evaluate(onCal => ({ cal: (new Function('return (' + onCal + ')()'))(), url: location.pathname + location.hash, text: (document.getElementById('content') || {}).innerText || '' }), onCal.toString());
    ok(opened.cal, 'a chip opens Calendar (' + opened.url + ')');
    ok(/\/calendar\/alphafixture/.test(opened.url), 'on the client the chip named');
  }
  await context.close();
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const phone of [false, true]) for (const dark of [false, true]) await shot(browser, origin, phone, dark);
  } finally { await browser.close(); server.close(); }
  console.log(failures ? `\ntoday-clients-shots: ${failures} check(s) failed` : '\ntoday-clients-shots: all checks passed, screenshots in ' + OUT);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
