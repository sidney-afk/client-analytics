'use strict';
/*
 * 688 PART 2 IN A REAL BROWSER: Version A/B/C tabs on a trial card's picture in the staff Calendar, behind
 * trial_versions_v2 (Sidney's option B in the Quiet look, 3 Nov). Fully offline; the trial-reels function is answered by
 * its own rules (logic.mjs readShape with the card). Proves, at 1440 and 390 wide:
 *   - switch off: no tabs, today's Video row;
 *   - switch on, three live versions: one tab per version on the picture, each with its status dot (approved and waiting
 *     in different colours), the version on the card picked first, the Video row says "Version A";
 *   - picking B: B is underlined, the Video row says "Version B" with B's status and opens B's link, B's own picture and
 *     caption show over the card's (the card's caption box hidden, its words untouched), and nothing at all is written;
 *   - picking A again puts the card's own back; a version dropped leaves its tab; one live version, or a winner, no tabs;
 *   - the tabs fit inside the picture, and the page never scrolls sideways.
 */
const path = require('path');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = (l) => 'https://f.io/fixture-tabs-' + l.toLowerCase();

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  const vid = S.deliv.find((d) => d.id === 'del_vid_1');
  const T = { flagOn: false, versions: [], calls: [], saves: [], winner: null, failSave: false };
  const CARD0 = { thumbnail_url: 'https://e.example/fixture-card-thumb.jpg', caption: 'The card caption, fixture.' };
  const fresh = (status) => {
    const at = new Date().toISOString();
    const ends = status === 'on trial' ? new Date(Date.now() - 60000).toISOString() : null;
    T.versions = ['A', 'B', 'C'].map((l) => ({ id: 'v' + l, letter: l, status: status || 'waiting', frame_url: LINK(l), revision: 0, updated_at: at,
      post_id: 'p_t1', thumbnail_url: null, caption: null, trial_ends_at: ends }));
    T.winner = null;
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
    const vs = () => L.settleWinner(T.versions, T.winner);
    const shape = () => Object.assign({ enabled: true, winner_letter: T.winner },
      L.readShape(vs(), { client: false, mainLink: mainLink(), cardStatus: card.video_status, card: { thumbnail_url: card.thumbnail_url, caption: card.caption } }));
    if (b.action === 'list') return reply({ ok: true, cards: { p_t1: shape() } });
    if (b.action === 'read') return reply(Object.assign({ ok: true }, shape()));
    if (b.action === 'version_fields_set') {
      const res = L.versionFieldsPatch(vs(), { letter: b.letter, thumbnail_url: b.thumbnail_url, caption: b.caption, mainLink: mainLink() });
      if (res.error) return reply({ ok: false, error: res.error }, 400);
      if (res.patch) Object.assign(T.versions.find((x) => x.letter === b.letter), res.patch);
      return reply(Object.assign({ ok: true, changed: res.patch ? [b.letter] : [], restarted: !!res.restarted }, shape()));
    }
    if (b.action === 'winner_set') {
      const res = L.winnerPatches(vs(), b.letter, mainLink(), { nowMs: Date.now() });
      if (res.error) return reply({ ok: false, error: res.error }, res.error === 'attach_first' ? 409 : 400);
      T.winner = b.letter;
      return reply(Object.assign({ ok: true, changed: [b.letter] }, shape()));
    }
    if (b.action === 'winner_undo') {
      const res = L.undoWinnerPatches(vs(), mainLink());
      if (res.error) return reply({ ok: false, error: res.error }, res.error === 'attach_first' ? 409 : 400);
      T.winner = null;
      return reply(Object.assign({ ok: true, changed: [] }, shape()));
    }
    return reply({ ok: false, error: 'unknown_action' }, 400);
  });
  await S.ctx.route('**/functions/v1/production-write{,?*}', async (route) => {
    const r = route.request();
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (r.method() !== 'POST' || b.operation !== 'attachment') return route.fallback();
    vid.file_url = b.file_url; card.asset_url = b.file_url; vid.updated_at = new Date().toISOString();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, native_committed: true }) });
  });
  // Today's card save: what it carries for the thumbnail and the caption is the winner copy.
  await S.ctx.route('**/functions/v1/{calendar-card-write,calendar-upsert}{,?*}', (route) => {
    const r = route.request();
    if (r.method() === 'POST') {
      const text = r.postData() || '';
      if (/thumbnail_url|"caption"/.test(text)) {
        T.saves.push(text);
        if (T.failSave) return route.fulfill({ status: 503, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: false, error: 'fixture_unavailable' }) });
      }
    }
    return route.fallback();
  });
  T.writes = [];
  // The versions' own pictures (a one-pixel PNG), so a picture that loads stays.
  const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await S.ctx.route('https://e.example/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: PNG1 }));
  await S.ctx.route('**/functions/v1/{calendar-card-write,calendar-upsert,production-write}{,?*}', (route) => {
    if (route.request().method() === 'POST') T.writes.push(route.request().url());
    return route.fallback();
  });
  const open = async (w, h) => {
    const page = await S.newPage();
    await page.setViewportSize({ width: w, height: h });
    await S.openCalendar(page);
    if (w < 600) { await page.getByText(card.name).first().click(); await sleep(1000); }
    await sleep(1800);
    return page;
  };
  const view = (page) => page.evaluate(() => {
    const cards = [...document.querySelectorAll('.cal-card[data-pid="p_t1"]')].filter((c) => c.offsetParent);
    const c = cards[cards.length - 1];
    if (!c) return null;
    const thumb = c.querySelector('.cal-card-thumb'), tabs = c.querySelector('.trl-tabs');
    const tb = thumb && thumb.getBoundingClientRect(), gb = tabs && tabs.getBoundingClientRect();
    const row = c.querySelector('.trl-main');
    const open = row && row.querySelector('.cal-link-pill-open');
    const cap = c.querySelector('textarea.cal-fld-cap'), capView = c.querySelector('.trl-cap-view'), img = c.querySelector('.trl-tab-img');
    return {
      tabs: tabs ? [...tabs.querySelectorAll('.trl-tab')].map((b) => ({ t: b.textContent.trim(), on: b.getAttribute('aria-pressed') === 'true', name: b.getAttribute('aria-label'), dot: getComputedStyle(b.querySelector('.trl-tab-d')).backgroundColor, line: getComputedStyle(b, '::after').backgroundColor })) : [],
      // On the staff phone the tabs are their own row above the Video field, inside the card; elsewhere on the picture.
      inside: tabs && tabs.classList.contains('trl-tabs-row') ? (() => { const cb = c.getBoundingClientRect(), rb = row.getBoundingClientRect(); return gb.left >= cb.left - 0.5 && gb.right <= cb.right + 0.5 && gb.bottom <= rb.top + 0.5; })()
        : !!(tb && gb && gb.left >= tb.left - 0.5 && gb.right <= tb.right + 0.5 && gb.bottom <= tb.bottom + 0.5 && gb.top >= tb.top - 0.5),
      row: row ? row.innerText.replace(/\s+/g, ' ').trim() : '',
      href: open && open.tagName === 'A' ? open.getAttribute('href') : '',
      img: img ? img.getAttribute('src') : '',
      capShown: !!(cap && cap.offsetParent), capVal: cap ? cap.value : null,
      capView: capView ? capView.innerText.replace(/\s+/g, ' ').trim() : '',
      sideways: document.documentElement.scrollWidth - innerWidth,
    };
  });
  const tab = async (page, l) => {
    const b = (await page.evaluateHandle((letter) => [...document.querySelectorAll('.cal-card[data-pid="p_t1"] .trl-tab')].filter((x) => x.offsetParent).find((x) => x.textContent.trim() === letter) || null, l)).asElement();
    if (b) { await b.click(); await sleep(500); }
    return !!b;
  };

  try {
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
      Object.assign(card, CARD0, { video_status: 'For SMM Approval' }); vid.file_url = LINK('A'); card.asset_url = LINK('A');
      T.flagOn = false; fresh();
      let page = await open(w, h);
      let V = await view(page);
      ok(V && !V.tabs.length && /Video · 3/.test(V.row), `${label}: switch off, no tabs and today's row ("${V && V.row}")`);
      await page.close();

      T.flagOn = true; fresh();
      Object.assign(T.versions[0], { status: 'approved', smm_ok_at: new Date().toISOString() });
      Object.assign(T.versions[1], { thumbnail_url: 'https://e.example/fixture-tabs-b.jpg', caption: 'Version B words, fixture.' });
      T.calls = []; T.writes = [];
      page = await open(w, h);
      V = await view(page);
      ok(V && V.tabs.map((t) => t.t).join('') === 'ABC', `${label}: one tab per version on the picture (${V && V.tabs.map((t) => t.t).join(',')})`);
      ok(V && V.tabs[0].on && !V.tabs[1].on && /^Version A\b/.test(V.row), `${label}: the version on the card is picked first and the row says Version A ("${V && V.row}")`);
      ok(V && V.tabs[0].dot !== V.tabs[1].dot && /approved/.test(V.tabs[0].name) && /with SMM/.test(V.tabs[1].name), `${label}: each tab's dot is its status, said in its name too (${V && V.tabs.map((t) => t.name + ' ' + t.dot).join(' | ')})`);
      ok(V && V.inside && V.sideways <= 1, `${label}: the tabs sit inside the picture (on the phone, their own row above the Video field) and the page does not scroll sideways (${V && V.sideways})`);
      ok(V && V.capShown && V.capVal === CARD0.caption && !V.img && !V.capView, `${label}: with A picked the card shows its own picture and caption`);
      const shot = async (n) => { if (!process.env.TRL_SHOTS) return; const c = (await page.$$('.cal-card[data-pid="p_t1"]')).pop(); if (c) await c.screenshot({ path: path.join(process.env.TRL_SHOTS, 'tabs-' + n + '-' + label + '.png') }); };
      await shot('a');
      ok(await tab(page, 'B'), `${label}: B's tab can be pressed`);
      await shot('b');
      V = await view(page);
      ok(V && V.tabs[1].on && !V.tabs[0].on && V.tabs[1].line !== V.tabs[0].line, `${label}: B is now the underlined tab`);
      ok(V && /^Version B\b/.test(V.row) && /with SMM|For SMM Approval/.test(V.row) && V.href === LINK('B'), `${label}: the row says Version B with its status and opens B's link ("${V && V.row}", ${V && V.href})`);
      ok(V && /fixture-tabs-b\.jpg/.test(V.img), `${label}: B's own picture shows over the card's (${V && V.img})`);
      ok(V && !V.capShown && /Version B caption/.test(V.capView) && /Version B words, fixture\./.test(V.capView), `${label}: B's caption shows in place of the card's box, read only ("${V && V.capView}")`);
      ok(V && V.capVal === CARD0.caption && card.caption === CARD0.caption && card.thumbnail_url === CARD0.thumbnail_url, `${label}: the card's own caption and thumbnail are untouched`);
      await tab(page, 'C');
      V = await view(page);
      ok(V && V.tabs[2].on && !V.img && /The card caption, fixture\./.test(V.capView), `${label}: C has no fields of its own, so it shows the card's picture and caption as its own ("${V && V.capView}")`);
      await tab(page, 'A');
      V = await view(page);
      ok(V && V.tabs[0].on && V.capShown && !V.capView && !V.img && /^Version A\b/.test(V.row), `${label}: A again puts the card's own back`);
      // Month and Week: a dot per live version, in its status colour; the Week card also says each letter. Opened on the
      // card's own month and week, never today's (CLAUDE.md: a fixture date must not depend on the month the run is in).
      if (w >= 600) {
        const mk = async (viewName) => {
          await page.evaluate(([v, d]) => { if (v === 'month') calState.monthCursor = d.slice(0, 8) + '01'; else calState.weekCursor = d; onCalViewChange(v); }, [viewName, card.scheduled_date]);
          await sleep(1500);
          if (process.env.TRL_SHOTS) { const h = await page.$('.cal-month-pill:has(.trl-mk), .cal-week-card:has(.trl-mk)'); if (h) await h.screenshot({ path: path.join(process.env.TRL_SHOTS, 'mk-' + viewName + '.png') }); }
          return page.evaluate(() => { const m = document.querySelector('.trl-mk'); return m ? { n: m.querySelectorAll('.trl-mk-v').length, text: m.innerText.replace(/\s+/g, ''), name: m.getAttribute('aria-label'), dots: [...m.querySelectorAll('.trl-tab-d')].map(d => getComputedStyle(d).backgroundColor) } : null; });
        };
        const mm = await mk('month');
        ok(mm && mm.n === 3 && !mm.text && mm.dots[0] !== mm.dots[1] && /Version A approved/.test(mm.name), `${label}: Month shows a dot per version in its status colour, named in words (${JSON.stringify(mm)})`);
        const wk = await mk('week');
        ok(wk && wk.n === 3 && wk.text === 'ABC', `${label}: Week shows the three versions with their letters (${JSON.stringify(wk)})`);
        await page.evaluate(() => onCalViewChange('organizer')); await sleep(800);
      }
      const wrote = T.calls.filter((c) => !['list', 'read'].includes(c.action)).length + T.writes.length;
      ok(wrote === 0, `${label}: picking tabs writes nothing (${wrote})`);
      ok(!page.errors.length, `${label}: no page errors (${page.errors.join(' | ')})`);
      await page.close();

      // A dropped version has no tab; with one live version left, or a winner, no tabs at all.
      fresh(); T.versions[2].status = 'dropped';
      page = await open(w, h);
      V = await view(page);
      ok(V && V.tabs.map((t) => t.t).join('') === 'AB', `${label}: a dropped version has no tab (${V && V.tabs.map((t) => t.t).join(',')})`);
      await page.close();
      fresh(); T.versions[1].status = 'dropped'; T.versions[2].status = 'dropped';
      page = await open(w, h);
      V = await view(page);
      ok(V && !V.tabs.length, `${label}: one live version, no tabs`);
      await page.close();
      fresh('on trial'); T.winner = 'B';
      page = await open(w, h);
      V = await view(page);
      ok(V && !V.tabs.length && !V.capView, `${label}: a winner, no tabs (the card is the winner's)`);
      await page.close();
    }
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  console.log(`trial-version-card-tabs-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  if (failures.length) process.exit(1);
})();
