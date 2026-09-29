'use strict';
/*
 * n8n exit, PR 3: Caption Prompts.
 *
 * Fully mocked (no live backend), every request to n8n.cloud recorded.
 *
 *  READ   The Calendar reads prompts from the caption_prompts table. The URL's
 *         exact query parameters are pinned (PostgREST answers 400 to any it does
 *         not know; a cache-buster broke the Filming flag read that way). A failed
 *         table read falls back to a last-known-good copy kept in the browser, and
 *         only when that is empty to the n8n caption-prompts-get webhook, once.
 *         When every source fails, prompts are NOT marked loaded, so Generate
 *         refuses instead of silently sending the generic default.
 *  SAVE   The save asks settings_ef_clients afresh (own read, bounded, never
 *         shared) before each write and goes to the caption-prompts-save function
 *         only. An unreadable, slow or malformed flag HOLDS the save; a flag that
 *         does not list the client PAUSES it with a message; neither reaches n8n.
 *
 * Fictional client and prompts only.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const ROOT = path.resolve(__dirname, '..');
const SLUG = 'fixtureclient';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };

function serve() {
  const server = http.createServer((req, res) => {
    let file;
    try {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      file = path.resolve(ROOT, decodeURIComponent(pathname === '/' ? 'index.html' : pathname.slice(1)));
    } catch (_) { res.writeHead(400).end(); return; }
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end(); return;
    }
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
      '.svg': 'image/svg+xml' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
const json = (route, body, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });

let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
  if (!cond) failures++;
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1200, height: 900 } });
  const errors = [];
  const state = {
    table: 'ok',            // ok | http500 | malformed
    flag: 'list',           // list | empty | http500 | hang | malformed
    armed: false, flagReads: 0, flagUrls: [], tableUrls: [],
    saves: [], n8n: [], hang: null,
  };
  try {
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (url.origin === origin) return route.continue();
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      if (/n8n\.cloud$/.test(url.hostname)) {
        state.n8n.push(method + ' ' + url.pathname);
        if (url.pathname === '/webhook/caption-prompts-get') {
          return json(route, { ok: true, prompts: { [SLUG]: 'prompt from the n8n fallback' } });
        }
        return json(route, { ok: true });
      }
      if (url.pathname === '/rest/v1/caption_prompts' && method === 'GET') {
        state.tableUrls.push(url.search);
        if (state.table === 'http500') return json(route, { message: 'fixture failure' }, 500);
        if (state.table === 'malformed') return json(route, { not: 'an array' });
        return json(route, [{ client_slug: SLUG, prompt: 'prompt from the table' }, { client_slug: 'otherclient', prompt: '' }]);
      }
      if (url.pathname === '/rest/v1/syncview_runtime_flags' && method === 'GET') {
        const raw = url.searchParams.get('key') || '';
        const keys = raw.startsWith('in.(') ? raw.slice(4, -1).split(',') : [raw.replace(/^eq\./, '')];
        if (state.armed && keys.length === 1 && keys[0] === 'settings_ef_clients') {
          state.flagReads++; state.flagUrls.push(url.search);
          if (state.flag === 'http500') return json(route, { message: 'fixture failure' }, 500);
          if (state.flag === 'hang') { await new Promise(resolve => { state.hang = resolve; }); return route.abort(); }
          if (state.flag === 'malformed') return json(route, [{ key: keys[0], value: { unexpected: true } }]);
          if (state.flag === 'empty') return json(route, [{ key: keys[0], value: { clients: [] } }]);
          return json(route, [{ key: keys[0], value: { clients: [SLUG] } }]);
        }
        const values = {
          calendar_upsert_ef_clients: { clients: [SLUG] }, settings_ef_clients: { clients: [SLUG] },
          write_ui_reroute_clients: { clients: [SLUG] }, prod_authority: { video: 'syncview', graphics: 'syncview' },
        };
        return json(route, keys.filter(key => Object.hasOwn(values, key)).map(key => ({ key, value: values[key] })));
      }
      if (url.pathname === '/functions/v1/caption-prompts-save' && method === 'POST') {
        state.saves.push(JSON.parse(request.postData() || '{}'));
        return json(route, { ok: true });
      }
      if (url.pathname === '/rest/v1/clients' && method === 'GET') {
        return json(route, [{ slug: SLUG, display_name: 'Fixture Client', kind: 'client', active: true }]);
      }
      if (url.pathname.startsWith('/rest/v1/') && method === 'GET') return json(route, []);
      if (url.pathname.startsWith('/functions/v1/')) return json(route, { ok: true });
      if (url.host === 'docs.google.com') return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
      return route.abort();
    });

    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 180)));
    await seedStaffGate(page);
    await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _calLoadCaptionPrompts === 'function' && typeof _calSaveCaptionPrompt === 'function', null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    /* ---------- READ ---------- */
    const load = async (mode) => {
      state.table = mode;
      const before = state.n8n.length, tableBefore = state.tableUrls.length;
      const out = await page.evaluate(async () => {
        _calSetCaptionPromptsLoaded(false); _calSetCaptionPrompts({}); _calSetCaptionPromptsInFlight(null);
        await _calLoadCaptionPrompts();
        return { loaded: _calCaptionPromptsLoaded, prompts: Object.assign({}, _calCaptionPrompts) };
      });
      return { out, n8n: state.n8n.slice(before), tables: state.tableUrls.length - tableBefore };
    };
    await page.evaluate(() => { try { localStorage.removeItem('syncview_caption_prompts_lkg_v1'); } catch (e) {} });

    // First load with nothing saved and a failing table: n8n is asked exactly once, as the error-only fallback.
    let r = await load('http500');
    ok(r.out.loaded && r.out.prompts[SLUG] === 'prompt from the n8n fallback' && r.n8n.length === 1 && r.n8n[0] === 'GET /webhook/caption-prompts-get',
      'table fails, no saved copy: the n8n caption-prompts-get answers once (error-only fallback)');

    // Healthy table: zero n8n, exact query, saved copy written.
    r = await load('ok');
    ok(r.out.loaded && r.out.prompts[SLUG] === 'prompt from the table' && r.n8n.length === 0 && r.tables === 1,
      'healthy table: prompts come from caption_prompts, zero n8n requests');
    const lkg = await page.evaluate(() => JSON.parse(localStorage.getItem('syncview_caption_prompts_lkg_v1') || 'null'));
    ok(lkg && lkg[SLUG] === 'prompt from the table', 'a last-known-good copy is kept in this browser');
    const tq = state.tableUrls[state.tableUrls.length - 1];
    const tk = Array.from(new URLSearchParams(tq).keys()).sort().join(',');
    ok(tk === 'order,select' && !/_t=/.test(tq) && new URLSearchParams(tq).get('select') === 'client_slug,prompt' && new URLSearchParams(tq).get('order') === 'client_slug.asc',
      'caption_prompts read has exactly select and order, no cache-buster: ' + tq);

    // Table fails but a saved copy exists: use it, zero n8n.
    r = await load('http500');
    ok(r.out.loaded && r.out.prompts[SLUG] === 'prompt from the table' && r.n8n.length === 0,
      'table fails with a saved copy: the saved copy is used, zero n8n');
    r = await load('malformed');
    ok(r.out.loaded && r.out.prompts[SLUG] === 'prompt from the table' && r.n8n.length === 0,
      'table answers a malformed body with a saved copy: the saved copy is used, zero n8n');

    // Everything fails: not loaded, so Generate refuses instead of sending an empty prompt.
    await page.route('**/webhook/caption-prompts-get*', route => route.abort());
    await page.evaluate(() => { try { localStorage.removeItem('syncview_caption_prompts_lkg_v1'); } catch (e) {} });
    r = await load('http500');
    ok(!r.out.loaded, 'every source failed: prompts are NOT marked loaded');
    await page.unroute('**/webhook/caption-prompts-get*');
    const src = fs.readFileSync(path.join(ROOT, 'src/index/180-calendar-native-post-media.js.part'), 'utf8');
    ok(/if \(!_calCaptionPromptsLoaded\) \{\s*if \(!opts\.silent\)[\s\S]{0,200}return \{ ok: false, error: 'Caption prompt unavailable'/.test(src),
      'Generate refuses (with a message) when the prompt could not be loaded, instead of using the generic default');

    /* ---------- SAVE ---------- */
    await page.evaluate(() => { _calSetCaptionPromptsLoaded(true); });
    const save = async (label) => {
      const before = { reads: state.flagReads, saves: state.saves.length, n8n: state.n8n.length };
      state.armed = true;
      await page.evaluate(async slug => {
        document.getElementById('calPromptTA')?.remove(); document.getElementById('calPromptSaveBtn')?.remove();
        const ta = document.createElement('textarea'); ta.id = 'calPromptTA'; ta.value = 'A custom fixture prompt'; document.body.appendChild(ta);
        const btn = document.createElement('button'); btn.id = 'calPromptSaveBtn'; document.body.appendChild(btn);
        calState.client = slug;
        await _calSaveCaptionPrompt();
      }, SLUG);
      state.armed = false;
      const notice = await page.evaluate(() => (document.querySelector('.sv-notify, #notifyOverlay, .sv-notify-msg') || {}).innerText || document.body.innerText.slice(0, 0));
      return { label, reads: state.flagReads - before.reads, saves: state.saves.length - before.saves, n8n: state.n8n.slice(before.n8n), notice };
    };
    state.flag = 'list';
    let s = await save('listed');
    ok(s.saves === 1 && s.reads === 1 && s.n8n.length === 0, 'listed client: one fresh settings-flag read, one caption-prompts-save function POST, zero n8n');
    s = await save('again');
    ok(s.saves === 1 && s.reads === 1, 'a second save starts its own read (no cache)');
    state.flag = 'empty';
    s = await save('removed');
    ok(s.saves === 0 && s.reads === 1 && s.n8n.length === 0, 'client removed from the flag: the very next save is refused, nothing sent, zero n8n');
    const paused = await page.evaluate(() => document.body.innerText.includes('Saving caption prompts is paused for this client'));
    ok(paused, 'the pause is visible to the person as a message');
    for (const mode of ['http500', 'malformed']) {
      state.flag = mode;
      s = await save(mode);
      ok(s.saves === 0 && s.n8n.length === 0 && s.reads === 3, mode + ': the read is retried (3 fresh reads), the save is HELD, nothing sent to the function or n8n');
    }
    state.flag = 'hang';
    const t0 = Date.now();
    s = await save('hang');
    if (state.hang) state.hang();
    ok(s.saves === 0 && s.n8n.length === 0 && Date.now() - t0 < 12000, 'a flag read that never answers times out and holds the save (' + (Date.now() - t0) + ' ms)');
    const fk = state.flagUrls.map(q => Array.from(new URLSearchParams(q).keys()).sort().join(','));
    ok(fk.length > 5 && fk.every(k => k === 'key,limit,select') && state.flagUrls.every(q => !/_t=/.test(q) && new URLSearchParams(q).get('key') === 'eq.settings_ef_clients'),
      'every settings-flag read (' + fk.length + ') has exactly select, key, limit and no cache-buster');
    const gsrc = fs.readFileSync(path.join(ROOT, 'src/index/120-calendar-flags-write-repair.js.part'), 'utf8');
    ok(!/CAPTION_PROMPTS_SAVE_URL\b/.test(src + gsrc) && !/webhook\/caption-prompts-save/.test(src + gsrc),
      'the n8n caption-prompts-save constant and URL are gone from the page source');
    ok(errors.length === 0, 'no browser errors: ' + JSON.stringify(errors));
    ok(state.n8n.filter(l => /caption-prompts-save/.test(l)).length === 0, 'no request to the n8n caption-prompts-save webhook at any point');
  } finally {
    if (state.hang) state.hang();
    await browser.close();
    server.close();
  }
  if (failures) { console.error('\ncaption-prompts-guard-browser: ' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\ncaption-prompts-guard-browser: all checks passed');
})().catch(error => { console.error(error); process.exit(1); });
