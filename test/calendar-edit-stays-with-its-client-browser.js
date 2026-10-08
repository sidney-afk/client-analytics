'use strict';
/* calendar-edit-stays-with-its-client-browser.js -- an edit typed on one
 * client's card is never written under another client, in a real browser,
 * fully offline.
 *
 * The Calendar save engine read "which client" when a flush STARTED. Switching
 * client flushes what is pending first, but two ordinary sequences let a flush
 * wake up after the switch:
 *
 *   S1  type in a caption, click another client. The click blurs the box, the
 *       save starts and first re-reads the field (the "did someone else change
 *       it" check); the view has moved by the time that read answers.
 *   S2  a save for the card is still in flight, more is typed, then the client
 *       is switched. The second flush waits behind the first one's lock.
 *
 * In both the card is no longer in the list on screen, so the engine took it
 * for a NEW row: a blank card carrying only the edit. This drives the real page
 * against two made-up clients whose every backend answer is local and proves:
 *   - nothing is ever sent to the client the view moved to;
 *   - no blank whole-card write goes over the real card;
 *   - the person is told, and coming back to the first client saves the edit;
 *   - the first client's saved copy is not overwritten with the other's cards.
 * No request leaves the machine. Fixture names only.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const A = { name: 'Fixture Alpha', slug: 'fixturealpha' };
const B = { name: 'Fixture Beta', slug: 'fixturebeta' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const card = (id, slug, name) => ({
  id, client: slug, name, status: 'In Progress', order_index: 1, updated_at: '2026-09-20T12:00:00.000Z',
  scheduled_date: '2026-10-03', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  caption: 'Original caption', cta: '', thumbnail_url: 'https://example.invalid/thumb.png', asset_url: 'https://example.invalid/video.mp4',
  video_deliverable_id: '', graphic_deliverable_id: '', comments: [], graphic_comments: [], caption_comments: [],
});

async function open(browser, origin, behave) {
  const state = { cards: { [A.slug]: [card('a1', A.slug, 'Alpha card')], [B.slug]: [card('b1', B.slug, 'Beta card')] }, upserts: [] };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname; const sp = u.searchParams;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
    if (/calendar-upsert/.test(p) && r.method() === 'POST') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      const post = body.post || {};
      state.upserts.push({ client: body.client, id: post.id, keys: Object.keys(post).filter(k => k !== 'id'), post });
      if (behave.upsertDelay) await sleep(behave.upsertDelay);
      const list = state.cards[body.client] || [];
      let row = list.find(c => c.id === post.id);
      if (!row) { row = Object.assign({ client: body.client }, post); list.push(row); state.cards[body.client] = list; }
      else Object.assign(row, post);
      row.updated_at = new Date().toISOString();
      return json({ ok: true, post: row });
    }
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([A, B].map(c => ({ slug: c.slug, display_name: c.name, active: true, kind: 'video' })));
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = sp.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : (/_clients$/.test(k) ? { clients: [A.slug, B.slug] } : { enabled: false }) })));
    }
    if (p === '/rest/v1/calendar_posts') {
      const slug = String(sp.get('client') || '').replace(/^eq\./, '');
      const one = String(sp.get('id') || '').replace(/^eq\./, '');
      // The one-card read is the "did someone else change this field" check.
      if (one && behave.freshDelay) await sleep(behave.freshDelay);
      const rows = (state.cards[slug] || []).filter(c => !one || c.id === one);
      return json(rows);
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _calSavePins === 'function', null, { timeout: 30000 });
  await page.evaluate(names => { _syncviewStaffIdentityVerified = true; _calSavePins(names); calState.client = names[0]; navTo('calendar'); }, [A.name, B.name]);
  await page.waitForSelector('.cal-card[data-pid="a1"]', { timeout: 20000 });
  const goTo = name => page.evaluate(n => onCalClientChange(n), name);
  const notices = () => page.evaluate(() => {
    const o = document.getElementById('confirmOverlay');
    return { open: !!(o && o.classList.contains('active')), title: o && o.classList.contains('active') ? (document.getElementById('confirmTitle').textContent || '') : '' };
  });
  const closeNotice = () => page.evaluate(() => { const o = document.getElementById('confirmOverlay'); if (o && o.classList.contains('active')) document.getElementById('confirmYes').click(); });
  return { page, ctx, state, pageErrors, goTo, notices, closeNotice };
}

function judge(tag, t, typedField, typedValue) {
  const toB = t.state.upserts.filter(u => u.client === B.slug);
  expect(toB.length === 0, tag + ': nothing was written to the client the view moved to (' + toB.length + ' write(s))');
  expect(!(t.state.cards[B.slug] || []).some(c => c.id === 'a1'), tag + ': the other client did not gain a card');
  const blankOver = t.state.upserts.filter(u => u.client === A.slug && u.id === 'a1' && 'name' in u.post && String(u.post.name || '') === '');
  expect(blankOver.length === 0, tag + ': no blank whole-card write went over the real card');
  const a1 = t.state.cards[A.slug].find(c => c.id === 'a1');
  expect(a1.name === 'Alpha card' && a1.asset_url === 'https://example.invalid/video.mp4' && a1.scheduled_date === '2026-10-03',
    tag + ': the card kept its name, date and video link');
  return a1[typedField] === typedValue;
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // ---- S1: type a caption, switch client while the field re-read is out ----
    console.log('--- S1: caption typed, client switched during the re-read ---');
    let t = await open(browser, origin, { freshDelay: 900 });
    await t.page.fill('.cal-card[data-pid="a1"] textarea.cal-fld-cap', 'Caption typed on Alpha');
    await t.page.evaluate(() => document.querySelector('.cal-card[data-pid="a1"] textarea.cal-fld-cap').blur());
    await sleep(120);
    await t.goTo(B.name);
    await t.page.waitForSelector('.cal-card[data-pid="b1"]', { timeout: 20000 });
    await sleep(2200);
    let savedAlready = judge('S1', t, 'caption', 'Caption typed on Alpha');
    expect(await t.page.locator('.cal-card').count() === 1, 'S1: the other client shows only its own card (no ghost)');
    if (!savedAlready) {
      const n = await t.notices();
      expect(/not saved yet/i.test(n.title), 'S1: the person is told the edit is not saved yet (' + n.title + ')');
      await t.closeNotice();
      await t.goTo(A.name);
      await t.page.waitForSelector('.cal-card[data-pid="a1"]', { timeout: 20000 });
      await sleep(2600);
      savedAlready = t.state.cards[A.slug].find(c => c.id === 'a1').caption === 'Caption typed on Alpha';
    }
    expect(savedAlready, 'S1: the caption ends up saved on the card it was typed on');
    judge('S1 after return', t, 'caption', 'Caption typed on Alpha');
    expect(t.pageErrors.length === 0, 'S1: no page errors (' + t.pageErrors.join(' | ') + ')');
    await t.ctx.close();

    // ---- S2: a save in flight, more typed, then the client switched ----------
    console.log('--- S2: edit queued behind a save, then the client switched ---');
    t = await open(browser, origin, { upsertDelay: 1500 });
    const cta = '.cal-card[data-pid="a1"] [data-fld="cta"]';
    await t.page.fill(cta, 'First');
    await t.page.evaluate(sel => document.querySelector(sel).blur(), cta);
    await sleep(250);                                   // first save is now waiting on the server
    expect(t.state.upserts.length === 1, 'S2: the first save is in flight');
    await t.page.fill(cta, 'First and second');          // queued behind it
    await t.goTo(B.name);
    await t.page.waitForSelector('.cal-card[data-pid="b1"]', { timeout: 20000 });
    await sleep(2600);
    savedAlready = judge('S2', t, 'cta', 'First and second');
    expect(await t.page.locator('.cal-card').count() === 1, 'S2: the other client shows only its own card (no ghost)');
    const cachedA = await t.page.evaluate(slug => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.indexOf(slug) < 0) continue;
        try { const v = JSON.parse(localStorage.getItem(k)); if (v && Array.isArray(v.posts)) return v.posts.map(p => p.id); } catch (e) {}
      }
      return null;
    }, A.slug);
    expect(!cachedA || !cachedA.includes('b1'), 'S2: the first client\'s saved copy does not hold the other client\'s card (' + JSON.stringify(cachedA) + ')');
    if (!savedAlready) {
      const n = await t.notices();
      expect(/not saved yet/i.test(n.title), 'S2: the person is told the edit is not saved yet (' + n.title + ')');
      await t.closeNotice();
      await t.goTo(A.name);
      await t.page.waitForSelector('.cal-card[data-pid="a1"]', { timeout: 20000 });
      await sleep(3600);
      savedAlready = t.state.cards[A.slug].find(c => c.id === 'a1').cta === 'First and second';
    }
    expect(savedAlready, 'S2: the queued edit ends up saved on the card it was typed on');
    judge('S2 after return', t, 'cta', 'First and second');
    expect(t.pageErrors.length === 0, 'S2: no page errors (' + t.pageErrors.join(' | ') + ')');
    await t.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' check(s) failed'); process.exit(1); }
  console.log('\ncalendar-edit-stays-with-its-client-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
