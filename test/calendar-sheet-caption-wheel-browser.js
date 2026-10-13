'use strict';
/*
 * Staff Calendar Sheet, desktop: the mouse wheel over a long open caption reads
 * the caption instead of sliding the strip of cards sideways.
 *
 * Before: _calWireShiftScroll turned every vertical wheel inside the strip into
 * a sideways slide, and an open caption grew past the bottom of the screen with
 * no scroll area, so a long caption could not be read.
 * After: an open caption is capped to a screen-fitting height and scrolls; the
 * wheel over it scrolls it up and down, stops at its end (no sideways slide
 * mid-gesture), and the wheel anywhere else in the strip still slides the cards.
 *
 * Fully offline, fictional test client and caption. Set CAPTION_WHEEL_SHOT_DIR
 * to save a screenshot of the open caption.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const SLUG = 'fixtureclient';
const NAME = 'Test Client';
const SHOTS = process.env.CAPTION_WHEEL_SHOT_DIR || '';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const LONG = Array.from({ length: 70 }, (_, i) => `Line ${i + 1} of a fictional test caption about a lighthouse keeper who collects lost umbrellas.`).join('\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const card = (id, caption, order) => ({
  id, client: SLUG, name: 'Test card ' + order, status: 'In Progress', order_index: order, updated_at: '2026-10-08T12:00:00.000Z',
  scheduled_date: '2026-10-1' + order, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  caption, cta: '', thumbnail_url: '', asset_url: '', video_deliverable_id: '', graphic_deliverable_id: '',
  comments: [], graphic_comments: [], caption_comments: [],
});
const CARDS = [card('c1', 'Short test caption.', 1), card('c2', LONG, 2), card('c3', 'Short test caption.', 3),
  card('c4', 'Short test caption.', 4), card('c5', 'Short test caption.', 5), card('c6', 'Short test caption.', 6)];

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
    await seedStaffGate(page);
    await page.route('**/*', async route => {
      const r = route.request(); const u = new URL(r.url());
      if (r.url().startsWith(origin)) return route.continue();
      const json = body => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      const p = u.pathname; const sp = u.searchParams;
      if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
      if (r.method() === 'POST') return json({ ok: true });
      if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: NAME, active: true, kind: 'video' }]);
      if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }]);
      if (p === '/rest/v1/syncview_runtime_flags') {
        const raw = sp.get('key') || '';
        const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
        return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : (/_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false }) })));
      }
      if (p === '/rest/v1/calendar_posts') {
        const one = String(sp.get('id') || '').replace(/^eq\./, '');
        return json(CARDS.filter(c => !one || c.id === one));
      }
      if (/\/rest\/v1\//.test(p)) return json([]);
      if (/\/functions\/v1\/|\/webhook\//.test(p) || /n8n\.cloud$/.test(u.hostname)) return json({});
      if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
      return route.abort();
    });
    await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _calSavePins === 'function', null, { timeout: 30000 });
    await page.evaluate(names => { _syncviewStaffIdentityVerified = true; _calSavePins(names); calState.client = names[0]; navTo('calendar'); }, [NAME]);
    await page.waitForSelector('#calStrip .cal-card[data-pid="c2"]', { timeout: 20000 });
    await sleep(1200);

    const ta = '#calStrip .cal-card[data-pid="c2"] textarea[data-fld="caption"]';
    // Open the long caption (Show more) and park the strip at its start.
    await page.evaluate(sel => {
      const t = document.querySelector(sel); const wrap = t.closest('.cal-cap-wrap');
      wrap.classList.add('expanded'); _calRefreshCaption(t, false);
      const strip = document.getElementById('calStrip'); strip.scrollLeft = 0;
    }, ta);
    await sleep(200);
    const m = await page.evaluate(sel => { const t = document.querySelector(sel); const s = document.getElementById('calStrip');
      return { h: t.clientHeight, sh: t.scrollHeight, oy: getComputedStyle(t).overflowY, vh: innerHeight, stripMax: s.scrollWidth - s.clientWidth }; }, ta);
    expect(m.oy === 'auto' && m.sh > m.h + 50, `open long caption has its own scroll area (height ${m.h}, content ${m.sh}, overflow ${m.oy})`);
    expect(m.h <= m.vh * 0.6, `open caption fits the screen (${m.h}px of ${m.vh}px)`);
    expect(m.stripMax > 50, `the strip has room to slide sideways (${m.stripMax}px)`);

    const state = () => page.evaluate(sel => ({ top: document.querySelector(sel).scrollTop, left: document.getElementById('calStrip').scrollLeft }), ta);
    const box = await page.locator(ta).boundingBox();
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'after-open-caption.png') }); }

    // 1. Wheel over the long caption scrolls it vertically, strip stays put.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300); await sleep(300);
    let s = await state();
    expect(s.top > 0 && s.left === 0, `wheel over the long caption scrolls it down (top ${s.top}) and the strip does not slide (left ${s.left})`);

    // 2. Keep wheeling past its end: it stops, the strip still does not slide.
    for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 400); await sleep(30); }
    await sleep(300);
    s = await state();
    const end = await page.evaluate(sel => { const t = document.querySelector(sel); return t.scrollHeight - t.clientHeight; }, ta);
    expect(Math.abs(s.top - end) <= 2, `caption reached its bottom (${s.top} of ${end})`);
    expect(s.left === 0, `wheel at the caption's end does not slide the strip (left ${s.left})`);
    await page.mouse.wheel(0, -200); await sleep(300);
    s = await state();
    expect(s.top < end && s.left === 0, `wheel up scrolls the caption back (top ${s.top}), strip still put`);

    // 3. Wheel in the gap between cards still slides the strip.
    await sleep(500);   // past the end-of-gesture hold
    const gap = await page.evaluate(() => { const a = document.querySelector('#calStrip .cal-card[data-pid="c1"]').getBoundingClientRect();
      const b = document.querySelector('#calStrip .cal-card[data-pid="c2"]').getBoundingClientRect(); return { x: (a.right + b.left) / 2, y: a.top + 40 }; });
    await page.mouse.move(gap.x, gap.y);
    await page.mouse.wheel(0, 200); await sleep(300);
    s = await state();
    expect(s.left > 0, `wheel between cards still slides the strip sideways (left ${s.left})`);

    // 4. Wheel over a card with nothing to scroll still slides the strip.
    const before = s.left;
    const shortBox = await page.locator('#calStrip .cal-card[data-pid="c3"] textarea[data-fld="caption"]').boundingBox();
    await page.mouse.move(shortBox.x + 20, shortBox.y + 10);
    await page.mouse.wheel(0, 150); await sleep(300);
    s = await state();
    expect(s.left > before, `wheel over a short card still slides the strip (left ${before} -> ${s.left})`);

    expect(pageErrors.length === 0, `no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed.`); process.exit(1); }
  console.log('\ncalendar sheet caption wheel checks passed');
})().catch(e => { console.error(e); process.exit(1); });
