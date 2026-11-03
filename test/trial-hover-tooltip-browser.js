'use strict';
/*
 * OPEN_REPAIRS 686 (Sidney, 3 Nov, on the test client's Calendar Sheet): hovering a trial version's status pill showed
 * the browser's native tooltip; clicking it opened the status menu with that tooltip sitting over it; and clicking out
 * closed the menu and brought the tooltip back with no pointer over it. In a real browser, fully offline, on the staff
 * card (the V1 harness, test/trial-version-status-browser.js): the pill has no native title; a hover shows who approved
 * it in the shared tooltip; a click opens the menu with no tooltip over it; a click outside closes it and no tooltip
 * returns; and the shared tooltip's rule for every titled control holds (a press keeps the native title away until the
 * pointer leaves).
 */
const path = require('path');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = (l) => 'https://f.io/fixture-status-' + l.toLowerCase();

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  const vid = S.deliv.find((d) => d.id === 'del_vid_1');
  const T = { flagOn: false, versions: [], calls: [], refuse: '' , writes: [] };
  const fresh = () => {
    const at = new Date().toISOString();
    T.versions = [
      { id: 'vA', letter: 'A', status: 'waiting', frame_url: LINK('A'), revision: 0, updated_at: at, post_id: 'p_t1' },
      { id: 'vB', letter: 'B', status: 'waiting', frame_url: LINK('B'), revision: 0, updated_at: at, post_id: 'p_t1' },
      { id: 'vC', letter: 'C', status: 'waiting', frame_url: null, revision: 0, updated_at: at, post_id: 'p_t1' },
    ];
  };
  const mainLink = () => String(vid.file_url || card.asset_url || '');

  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', (route) => {
    const u = new URL(route.request().url());
    const raw = u.searchParams.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter((k) => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients'
      && (k !== 'trial_versions_v2' || T.flagOn)).map((k) => ({ key: k,
      value: k === 'trial_reels_pages' || k === 'trial_versions_v2' ? { clients: ['fixtureclient'] }
        : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: ['fixtureclient'] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
  });
  await S.ctx.route('**/functions/v1/trial-reels', async (route) => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const b = JSON.parse(r.postData() || '{}');
    T.calls.push(b);
    const reply = (obj, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) });
    const shape = () => Object.assign({ enabled: true, winner_letter: null }, L.readShape(T.versions, { client: false, mainLink: mainLink(), cardStatus: card.video_status }));
    if (b.action === 'list') return reply({ ok: true, cards: { p_t1: shape() } });
    if (b.action === 'read') return reply(Object.assign({ ok: true }, shape()));
    if (b.action === 'version_status_set') {
      if (T.refuse) return reply({ ok: false, error: T.refuse }, 409);
      const res = L.versionStatusPatches(T.versions, { letter: b.letter, status: b.status, cardStatus: card.video_status }, new Date().toISOString());
      if (res.error) return reply({ ok: false, error: res.error }, 400);
      for (const c of res.patches) Object.assign(T.versions.find((x) => x.id === c.id), c.patch);
      return reply(Object.assign({ ok: true, changed: res.patches.map((c) => c.letter) }, shape()));
    }
    return reply({ ok: false, error: 'unknown_action' }, 400);
  });
  // Any card save or Production status push while picking a version's status would be the card's status written.
  await S.ctx.route('**/functions/v1/{calendar-card-write,calendar-upsert,production-write}{,?*}', (route) => {
    if (route.request().method() === 'POST') T.writes.push(route.request().url());
    return route.fallback();
  });

  const pill = (page, l) => page.$(`.trl-v .trl-st[aria-label^="Video ${l} status"]`);
  const pillText = async (page, l) => { const h = await pill(page, l); return h ? (await h.innerText()).trim() : ''; };
  const open = async (w, h) => {
    const page = await S.newPage();
    await page.setViewportSize({ width: w, height: h });
    await S.openCalendar(page);
    if (w < 600) { await page.getByText(card.name).first().click(); await sleep(1000); }
    await sleep(1500);
    await page.evaluate(() => window.svTrialOpen('p_t1', true));
    await sleep(500);
    return page;
  };
  const asRole = async (page, role) => {
    await page.evaluate((r) => {
      _syncviewStaffIdentitySave({ key: 'fixture-' + r + '-key', role: r, member: { id: 'm1', name: 'Browser Staff' } });
      window.svTrialOpen('p_t1', true);
    }, role);
    await sleep(300);
  };


  // What the pointer would see: the shared tooltip on screen, and whether a native title is on the pill (the browser
  // paints that one itself, under a resting pointer).
  const tipState = (page) => page.evaluate(() => {
    const t = document.getElementById('globalTooltip');
    const pill = document.querySelector('.trl-v .trl-st[aria-label^="Video B status"]');
    return { tip: !!(t && t.isConnected && t.getClientRects().length), text: t && t.isConnected ? t.textContent : '', title: pill ? pill.getAttribute('title') : 'no-pill',
      expanded: pill ? pill.getAttribute('aria-expanded') : '', menu: !!document.querySelector('.cal-fld-status-menu') };
  });
  try {
    for (const [w, h, label] of [[1440, 900, 'desktop']]) {
      T.flagOn = true; fresh(); T.calls = []; T.writes = [];
      card.video_status = 'For SMM Approval';
      const page = await open(w, h);
      const b = await pill(page, 'B');
      ok(!!b, `${label}: Video B has its status pill`);
      ok((await b.getAttribute('title')) === null, `${label}: the pill carries no native title (the browser's own tooltip can never paint)`);
      await b.hover();
      await sleep(300);
      let s = await tipState(page);
      ok(s.tip && /SMM/.test(s.text), `${label}: hovering the pill shows who approved it in the shared tooltip (${JSON.stringify(s.text)})`);
      await b.click();
      await sleep(400);
      s = await tipState(page);
      ok(s.menu && !s.tip && s.title === null && s.expanded === 'true', `${label}: the click opens the menu, with no tooltip of either kind over it (${JSON.stringify(s)})`);
      const box = await b.boundingBox();
      await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2);
      await sleep(400);
      s = await tipState(page);
      ok(s.menu && !s.tip, `${label}: moving over the pill while its menu is open shows no tooltip`);
      await page.mouse.click(Math.max(5, w - 20), 20);
      await sleep(600);
      s = await tipState(page);
      ok(!s.menu && !s.tip && s.expanded === 'false', `${label}: a click outside closes the menu, and no tooltip comes back (${JSON.stringify(s)})`);
      await sleep(800);
      s = await tipState(page);
      ok(!s.tip && s.title === null, `${label}: nor a moment later, with the pointer away from the pill`);
      // The same rule for every control with a title: a press keeps the browser's native tooltip away until the pointer
      // leaves, and focus handed back after a mouse action shows no tooltip.
      const other = await page.$('.trl-v .trl-ico[title]');
      if (other) {
        await other.hover(); await sleep(250);
        await page.mouse.down(); await sleep(50);
        const held = await page.evaluate((el) => ({ title: el.getAttribute('title'), tip: !!(document.getElementById('globalTooltip') || {}).isConnected }), other);
        ok(held.title === null && !held.tip, `${label}: pressing another titled control hides the tip and keeps its native title off while the pointer rests on it`);
        // Leave with the button still down and let go elsewhere, so no click fires: the pencil's click redraws the row,
        // and a check on the old button would read a node that is no longer on the page (CI on #2579).
        await page.mouse.move(5, 5); await sleep(200);
        await page.mouse.up(); await sleep(100);
        // The row may have been redrawn meanwhile: read the same control as the page has it now, found by its name.
        const back = await page.evaluate((el) => {
          const now = el.isConnected ? el : [...document.querySelectorAll('.trl-v .trl-ico')].find(b => b.getAttribute('aria-label') === el.getAttribute('aria-label'));
          return { redrawn: !el.isConnected, found: !!now, title: now ? now.getAttribute('title') : null, oldTitle: el.getAttribute('title') };
        }, other);
        ok(back.found && back.title !== null && back.oldTitle !== null, `${label}: the title comes back once the pointer leaves (screen readers keep it) (${JSON.stringify(back)})`);
      }
      if (page.errors.length) console.log('page errors', page.errors);
      ok(!page.errors.length, `${label}: no page errors`);
      await page.close();
    }
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  console.log(`trial-hover-tooltip-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  if (failures.length) process.exit(1);
})();
