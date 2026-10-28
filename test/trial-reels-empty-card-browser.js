'use strict';
/*
 * TRIAL REELS ON A CARD THE AI EDITOR HAS NOT LOGGED (src/index/189-trial-reels-card.js.part), in a real browser,
 * fully offline. Session Trials, 2026-10-27.
 *
 * Found live on 2026-10-27, on the test client with builds 1 and 2 merged: the switch saved, but the card listed only
 * the versions the AI editor's studio log had written, and there were none. So "Show the versions" opened nothing and
 * there was nowhere to paste a Frame.io link. The other card test starts from five logged versions, which is why it
 * never saw this. This one starts as the live card did, with no version rows at all, and proves:
 *   - a card with no link: switching on opens the list on "Video A · Paste the Frame.io link"; pasting moves the
 *     card's link first through today's attach, then adds Video A (version_add); "Video B" is offered next;
 *   - adding Video B is version_add alone (the card's link stays Video A's), and a link another version already has
 *     is refused before anything is sent;
 *   - a card that already carries a link: switching on starts it with Video A from that link (the function's seed),
 *     so the row reads "Video · 1" and the list offers "Video B".
 * The trial-reels function is answered by its own rules (logic.mjs addVersion, and the switch's seed as index.ts
 * does it); test/trial-reels-function-deno.ts runs the real function for the same flow.
 */
const path = require('path');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = l => 'https://f.io/fixture-empty-' + l.toLowerCase();

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  const vid = S.deliv.find(d => d.id === 'del_vid_1');
  const T = { enabled: false, versions: [], calls: [], attaches: [] };
  const mainLink = () => String(vid.file_url || card.asset_url || '');
  const add = (letter, link) => T.versions.push({ id: 'v' + letter, letter, status: 'waiting', frame_url: link, revision: 0,
    updated_at: new Date().toISOString(), post_id: 'p_t1' });

  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
    const u = new URL(route.request().url());
    const raw = u.searchParams.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({ key: k,
      value: k === 'trial_reels_pages' ? { clients: ['fixtureclient'] }
        : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: ['fixtureclient'] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
  });
  await S.ctx.route('**/functions/v1/trial-reels', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const b = JSON.parse(r.postData() || '{}');
    T.calls.push(b);
    const reply = (obj, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) });
    const shape = () => Object.assign({ enabled: true, winner_letter: null }, L.readShape(T.versions, { client: false, mainLink: mainLink(), cardStatus: card.video_status }));
    if (b.action === 'list') return reply({ ok: true, cards: T.enabled ? { p_t1: shape() } : {} });
    if (b.action === 'read') return reply(Object.assign({ ok: true }, shape()));
    if (b.action === 'switch_set') {
      T.enabled = b.enabled === true;
      // As index.ts does: a card switched on with no version starts with Video A, the link it already carries.
      const first = L.cleanLink(mainLink()).link;
      if (T.enabled && !T.versions.length && first) add('A', first);
      return reply({ ok: true, enabled: T.enabled });
    }
    if (b.action === 'version_add') {
      if (typeof L.addVersion !== 'function') return reply({ ok: false, error: 'unknown_action' }, 400);
      const res = L.addVersion(T.versions, b.link, mainLink());
      if (res.error) return reply({ ok: false, error: res.error }, res.error === 'attach_first' ? 409 : 400);
      add(res.letter, res.link);
      return reply(Object.assign({ ok: true, changed: [res.letter] }, shape()));
    }
    return reply({ ok: false, error: 'unknown_action' }, 400);
  });
  await S.ctx.route('**/functions/v1/production-write{,?*}', async route => {
    const r = route.request();
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (r.method() !== 'POST' || b.operation !== 'attachment') return route.fallback();
    T.attaches.push(b);
    if (b.id !== vid.id || !b.expected_updated_at) return route.fulfill({ status: 400, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: false, error: 'cas_required' }) });
    vid.file_url = b.file_url; card.asset_url = b.file_url; vid.updated_at = new Date().toISOString();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, native_committed: true }) });
  });

  const rowText = page => page.evaluate(() => { const f = [...document.querySelectorAll('.cal-link-field.cal-link-post')].find(n => n.offsetParent); return f ? f.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const listText = page => page.evaluate(() => { const l = [...document.querySelectorAll('.trl-list')].find(n => n.offsetParent); return l ? l.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const open = async (w, h) => {
    const page = await S.newPage();
    await page.setViewportSize({ width: w, height: h });
    await S.openCalendar(page);
    if (w < 600) { await page.getByText(card.name).first().click(); await sleep(1000); }
    await sleep(1500);
    return page;
  };
  const paste = async (page, link) => {
    await page.click('.trl-add .trl-paste');
    await sleep(300);
    await page.fill('.trl-add .trl-link-input', link);
    await page.press('.trl-add .trl-link-input', 'Enter');
    await sleep(1200);
  };

  try {
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
      // As live: no version rows, and this card has no Video link yet.
      T.enabled = false; T.versions = []; T.calls = []; T.attaches = []; vid.file_url = ''; card.asset_url = '';
      let page = await open(w, h);
      await page.click('.cal-link-post .trl-sw-slot');
      await sleep(1200);
      ok(T.calls.some(c => c.action === 'switch_set' && c.enabled === true), `${label}: the switch sends switch_set on`);
      ok(!!(await page.$('.trl-add .trl-paste')), `${label}: with no version yet, the list stands open on a place to paste the first link`);
      ok(/Video A/.test(await listText(page)), `${label}: that place is Video A ("${await listText(page)}")`);

      await paste(page, LINK('A'));
      ok(T.attaches.some(a => a.file_url === LINK('A')) && card.asset_url === LINK('A'), `${label}: Video A's link goes on the card first, through today's attach`);
      ok(T.calls.some(c => c.action === 'version_add' && c.link === LINK('A')) && T.versions.length === 1 && T.versions[0].letter === 'A', `${label}: then Video A is added (version_add)`);
      ok(/Video · 1/.test(await rowText(page)), `${label}: the row reads "Video · 1" ("${await rowText(page)}")`);
      ok(/Video B/.test(await listText(page)) && !!(await page.$('.trl-add .trl-paste')), `${label}: Video B is offered next`);

      const attachesBefore = T.attaches.length;
      await paste(page, LINK('B'));
      ok(T.versions.length === 2 && T.versions[1].letter === 'B' && T.versions[1].frame_url === LINK('B'), `${label}: Video B is added`);
      ok(T.attaches.length === attachesBefore && card.asset_url === LINK('A'), `${label}: adding Video B leaves the card on Video A's link`);
      ok(/Video · 2/.test(await rowText(page)) && /Video C/.test(await listText(page)), `${label}: "Video · 2", and Video C is offered next`);

      const callsBefore = T.calls.length;
      await paste(page, LINK('B'));
      ok(T.calls.length === callsBefore && T.versions.length === 2, `${label}: a link another version already has is refused before anything is sent`);
      await page.close();

      // A card that already carries a link: switched on, it starts with Video A from that link.
      T.enabled = false; T.versions = []; T.calls = []; T.attaches = []; vid.file_url = LINK('main'); card.asset_url = LINK('main');
      page = await open(w, h);
      await page.click('.cal-link-post .trl-sw-slot');
      await sleep(1200);
      ok(T.versions.length === 1 && T.versions[0].frame_url === LINK('main'), `${label}: a card with a link starts with Video A, its link`);
      ok(/Video · 1/.test(await rowText(page)), `${label}: its row reads "Video · 1" ("${await rowText(page)}")`);
      // The list opens by itself when the switch goes on (owner, 2026-10-27), so the paste row is right there.
      ok(/Video A/.test(await listText(page)) && /Video B/.test(await listText(page)) && !!(await page.$('.trl-add .trl-paste')), `${label}: its list is open by itself, shows Video A and offers Video B`);
      if (page.errors.length) console.log('page errors', label, page.errors);
      ok(!page.errors.length, `${label}: no page errors`);
      await page.close();
    }
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  console.log(`trial-reels-empty-card-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  if (failures.length) process.exit(1);
})();
