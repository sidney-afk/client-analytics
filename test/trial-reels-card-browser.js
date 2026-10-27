'use strict';
/*
 * TRIAL REELS ON THE STAFF CARD (src/index/189-trial-reels-card.js.part), in a real browser, fully offline.
 * Session Trials, 2026-10-27; plan docs/features/TRIAL_REELS_PLAN.md.
 *
 * The page is today's, served by the offline harness (docs/syncview-design/tests/lost-work-lib.js: every backend answer
 * is local, fictional data). The trial-reels function is answered by its own rules (supabase/functions/trial-reels/
 * logic.mjs) over an in-memory card; production-write's attach is answered like the database does it (file_url, then
 * the projection onto the card). Proves:
 *   - switch off (trial_reels_pages does not list the client): the card is exactly today's, no trial control anywhere;
 *   - switch on, card off: a faint switch inside the Video row, and the card is still today's height;
 *   - card on: the row reads "Video · 5" with "2/4 approved", still today's height; the small arrow opens the
 *     versions (Video A…E), each label shown, "Paste the Frame.io link" on the one with no link; pasting saves it;
 *     dropping and bringing back a version;
 *   - 24 h up: only a muted trophy in the state slot ("Trial over: pick the winner"), no "on trial" labels in the list
 *     (no visual noise), still today's height; a trophy on a version makes it the winner at once through today's
 *     attach first, then the function, with today's toast offering Undo; Undo puts Video A back the same way;
 *   - no confirm row, on desktop or phone.
 * TRIAL_CARD_SHOTS=<dir> also writes screenshots (fictional data only). TRIAL_CARD_THEME=dark draws them dark.
 */
const path = require('path');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = l => 'https://f.io/fixture-version-' + l.toLowerCase();
const fs = require('fs');
const SHOTS = process.env.TRIAL_CARD_SHOTS || '';
const THEME = process.env.TRIAL_CARD_THEME === 'dark' ? 'dark' : 'light';
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, name + '-' + THEME + '.png'), fullPage: true });
}

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  card.asset_url = LINK('A');
  const vid = S.deliv.find(d => d.id === 'del_vid_1');
  vid.file_url = LINK('A');
  const T = { flag: false, enabled: false, calls: [], attaches: [] };
  const fresh = () => ['A', 'B', 'C', 'D', 'E'].map((l, i) => ({ id: 'v' + l, letter: l, status: ['approved', 'approved', 'change asked', 'dropped', 'waiting'][i],
    frame_url: l === 'E' ? null : LINK(l), revision: 0, updated_at: '2026-10-27T09:00:00.000Z', post_id: 'p_t1' }));
  T.versions = fresh();
  const mainLink = () => String(vid.file_url || card.asset_url || '');

  // The page switch, answered like the harness answers every other switch, plus trial_reels_pages.
  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
    const u = new URL(route.request().url());
    const raw = u.searchParams.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({ key: k,
      value: k === 'trial_reels_pages' ? (T.flag ? { clients: ['fixtureclient'] } : { clients: ['someotherclient'] })
        : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: ['fixtureclient'] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
  });
  // The trial-reels function, by its own rules.
  await S.ctx.route('**/functions/v1/trial-reels', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const b = JSON.parse(r.postData() || '{}');
    T.calls.push(b);
    const reply = (obj, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) });
    // One refusal on demand, for the paths where the card's link has already moved.
    if (T.refuse && b.action === T.refuse) { T.refuse = null; return reply({ ok: false, error: 'trial_reels_off' }, 409); }
    const shape = () => Object.assign({ enabled: true, winner_letter: (T.versions.find(v => v.status === 'winner') || {}).letter || null },
      L.readShape(T.versions, { client: false, mainLink: mainLink(), cardStatus: card.video_status }));
    const apply = changes => { for (const c of changes || []) Object.assign(T.versions.find(v => v.id === c.id), c.patch); };
    let res = null;
    if (b.action === 'list') return reply({ ok: true, cards: T.enabled ? { p_t1: shape() } : {} });
    if (b.action === 'switch_set') { T.enabled = b.enabled === true; return reply({ ok: true, enabled: T.enabled }); }
    if (b.action === 'version_link_set') {
      res = L.linkPatch(T.versions, b.letter, b.link, mainLink());
      if (!res.error && res.patch) apply([{ id: 'v' + b.letter, patch: res.patch }]);
    } else if (b.action === 'version_drop' || b.action === 'version_restore') {
      res = L.dropPatch(T.versions, b.letter, b.action === 'version_restore');
      if (!res.error && res.patch) apply([{ id: 'v' + b.letter, patch: res.patch }]);
    } else if (b.action === 'trial_start') { res = L.trialPatches(T.versions, Date.now()); if (!res.error) apply(res.patches); }
    else if (b.action === 'winner_set') { res = L.winnerPatches(T.versions, b.letter, mainLink()); if (!res.error) apply(res.patches); }
    else if (b.action === 'winner_undo') { res = L.undoWinnerPatches(T.versions, mainLink()); if (!res.error) apply(res.patches); }
    if (!res) return reply({ ok: false, error: 'unknown_action' }, 400);
    if (res.error) return reply({ ok: false, error: res.error }, res.error === 'attach_first' ? 409 : 400);
    return reply(Object.assign({ ok: true }, shape()));
  });
  // Production's attach, as the database does it: file_url, then the projection onto the card's link.
  await S.ctx.route('**/functions/v1/production-write{,?*}', async route => {
    const r = route.request();
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (r.method() !== 'POST' || b.operation !== 'attachment') return route.fallback();
    T.attaches.push(b);
    if (b.id !== vid.id || !b.expected_updated_at) return route.fulfill({ status: 400, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: false, error: 'cas_required' }) });
    vid.file_url = b.file_url; card.asset_url = b.file_url; vid.updated_at = new Date().toISOString();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, native_committed: true }) });
  });

  const heightOf = page => page.evaluate(() => { const c = [...document.querySelectorAll('#calView .cal-card')].find(n => n.offsetParent); return c ? Math.round(c.getBoundingClientRect().height * 10) / 10 : 0; });
  const rowText = page => page.evaluate(() => { const f = [...document.querySelectorAll('.cal-link-field.cal-link-post')].find(n => n.offsetParent); return f ? f.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const open = async (w, h) => {
    const page = await S.newPage();
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, THEME);
    await S.openCalendar(page);
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), THEME);
    if (w < 600) { await page.getByText(card.name).first().click(); await sleep(1000); }
    await sleep(1500);   // the switches and the trial list land, and the card repaints
    return page;
  };

  try {
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
      T.flag = false; T.enabled = false; T.versions = fresh(); vid.file_url = LINK('A'); card.asset_url = LINK('A');
      let page = await open(w, h);
      const todayH = await heightOf(page);
      ok(!(await page.$('.trl-sw-slot, .trl-main, .trl-list')), `${label}: switch off for this client: no trial control anywhere`);
      await page.close();

      T.flag = true;
      page = await open(w, h);
      ok(!!(await page.$('.cal-link-post .trl-sw-slot[aria-checked="false"]')), `${label}: switch on, card off: a faint switch inside the Video row`);
      await shot(page, label + '-off');
      ok(Math.abs((await heightOf(page)) - todayH) < 0.5, `${label}: the card is today's height (${todayH})`);
      // A card with no Video link yet offers the switch too, at the end of today's empty field.
      await page.close();
      vid.file_url = ''; card.asset_url = '';
      page = await open(w, h);
      ok(!!(await page.$('.cal-link-post:not(.has-link) .cal-link-input + .trl-sw-slot[aria-checked="false"]')), `${label}: a card with no Video link yet: the switch at the end of the empty field`);
      await page.close();
      vid.file_url = LINK('A'); card.asset_url = LINK('A');
      page = await open(w, h);
      await page.click('.cal-link-post .trl-sw-slot');
      await sleep(900);
      ok(T.calls.some(c => c.action === 'switch_set' && c.enabled === true && c.post_id === 'p_t1'), `${label}: the switch sends switch_set on`);
      let txt = await rowText(page);
      ok(/Video · 5/.test(txt) && /2\/4 approved/.test(txt), `${label}: the row reads "Video · 5" and "2/4 approved" (${txt})`);
      ok(Math.abs((await heightOf(page)) - todayH) < 0.5, `${label}: switched on and collapsed, still today's height`);
      await shot(page, label + '-review');
      await page.click('.cal-link-post .trl-chev');
      await sleep(300);
      const rows = await page.$$eval('.trl-list .trl-v', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      ok(rows.length === 5 && rows.every((r, i) => r.startsWith('Video ' + 'ABCDE'[i])), `${label}: the arrow opens Video A to E (${rows.join(' | ')})`);
      ok(/approved/.test(rows[0]) && /change asked/.test(rows[2]) && /dropped/.test(rows[3]) && /waiting/.test(rows[4]) && /Paste the Frame\.io link/.test(rows[4]), `${label}: a mixed review shows each label, and E asks for its link`);
      await shot(page, label + '-review-open');
      ok(!rows.join(' ').includes('Fictional hook') && !(await page.$('.trl-list .hook')), `${label}: no hook text anywhere`);
      await page.click('.trl-list .trl-v:nth-child(5) .trl-paste');
      await page.fill('.trl-link-input', LINK('E'));
      await page.keyboard.press('Enter');
      await sleep(900);
      ok(T.calls.some(c => c.action === 'version_link_set' && c.letter === 'E' && c.link === LINK('E')) && T.versions[4].frame_url === LINK('E'), `${label}: pasting Video E's link saves it`);
      await page.hover('.trl-list .trl-v:nth-child(2)');
      await page.click('.trl-list .trl-v:nth-child(2) .trl-ico[title="Drop this version"]');
      await sleep(800);
      ok(T.versions[1].status === 'dropped', `${label}: the team drops Video B`);
      await page.hover('.trl-list .trl-v:nth-child(2)');
      await page.click('.trl-list .trl-v:nth-child(2) .trl-ico[title="Bring back"]');
      await sleep(800);
      ok(T.versions[1].status === 'waiting', `${label}: and brings it back`);
      ok(!(await page.$('.trl-list .trl-v:nth-child(1) .trl-ico[title="Drop this version"]')), `${label}: the version on the card (Video A) has no drop control`);
      await page.close();

      // 24 h up.
      const past = new Date(Date.now() - 3600000).toISOString();
      T.versions.forEach(v => { if (v.status !== 'dropped') Object.assign(v, { status: 'on trial', trial_ends_at: past, frame_url: v.frame_url || LINK(v.letter) }); });
      page = await open(w, h);
      txt = await rowText(page);
      const ico = await page.$('.cal-link-post .trl-state-ico[title="Trial over: pick the winner"]');
      ok(!!ico && !/pick|winner|on trial/i.test(txt), `${label}: 24 h up: only a muted trophy in the state slot, no words (${txt})`);
      ok(Math.abs((await heightOf(page)) - todayH) < 0.5, `${label}: and still today's height`);
      await shot(page, label + '-due');
      await ico.click();
      await sleep(300);
      await shot(page, label + '-due-open');
      const trialRows = await page.$$eval('.trl-list .trl-v', ns => ns.map(n => ({ t: n.innerText.replace(/\s+/g, ' ').trim(), pick: !!n.querySelector('.trl-pick[title="Make this the winner"]') })));
      ok(trialRows.filter(r => r.pick).length === 4 && trialRows.every(r => !/on trial/.test(r.t)) && /dropped/.test(trialRows[3].t), `${label}: the trophy opens the list: a trophy on each version on trial, no "on trial" labels, "dropped" kept`);
      // The winner refused after today's attach moved the card's link: the link goes back to Video A.
      T.refuse = 'winner_set';
      const r0 = T.attaches.length;
      await page.click('.trl-list .trl-v:nth-child(3) .trl-pick');
      await sleep(1500);
      const back = T.attaches.slice(r0).map(a => a.file_url);
      ok(back.join('|') === LINK('C') + '|' + LINK('A') && vid.file_url === LINK('A') && card.asset_url === LINK('A') && !T.versions.some(v => v.status === 'winner'),
        `${label}: a refused winner puts the card's link back on Video A (${back.length} attaches)`);
      await page.evaluate(() => { const ov = document.getElementById('confirmOverlay'); if (ov) ov.classList.remove('active'); });
      if (!(await page.$('.trl-list .trl-v:nth-child(3) .trl-pick'))) { await page.click('.cal-link-post .trl-chev'); await sleep(300); }
      const n0 = T.attaches.length;
      await page.click('.trl-list .trl-v:nth-child(3) .trl-pick');
      await sleep(1200);
      const att = T.attaches.slice(n0);
      const pick = T.calls.filter(c => c.action === 'winner_set').pop();
      ok(att.length === 1 && att[0].file_url === LINK('C') && att[0].expected_updated_at && pick && pick.letter === 'C', `${label}: a trophy: today's attach puts Video C on the card first, then winner_set`);
      ok(T.versions[2].status === 'winner' && vid.file_url === LINK('C'), `${label}: Video C is the winner and the card's one link`);
      const toast = await page.evaluate(() => { const t = [...document.querySelectorAll('.sv-toast')].pop(); return t ? t.innerText.replace(/\s+/g, ' ').trim() : ''; });
      ok(/Video C is the winner/.test(toast) && /Undo/.test(toast), `${label}: today's toast offers Undo (${toast})`);
      await shot(page, label + '-winner-undo');
      ok(!(await page.$('.trp-confirm, .trl-confirm')) && !/Yes/.test(await page.evaluate(() => (document.querySelector('.trl-list') || {}).innerText || '')), `${label}: no confirm row`);
      txt = await rowText(page);
      ok(/^Video C\b/.test(txt) && !/winner/.test(txt.split('Video A')[0] || ''), `${label}: the collapsed row just says "Video C" (${txt.slice(0, 40)})`);
      await page.evaluate(() => { const b = [...document.querySelectorAll('.sv-toast button')].find(x => /Undo/.test(x.textContent)); if (b) b.click(); });
      await sleep(1200);
      ok(vid.file_url === LINK('A') && T.calls.some(c => c.action === 'winner_undo') && T.versions.every(v => v.status !== 'winner'), `${label}: Undo puts Video A back on the card through today's attach, then winner_undo`);
      // An Undo refused after the card's link went back to A: the winner stands, so the card keeps the winner's link.
      if (!(await page.$('.trl-list .trl-v:nth-child(3) .trl-pick'))) { await page.click('.cal-link-post .trl-chev'); await sleep(300); }
      await page.click('.trl-list .trl-v:nth-child(3) .trl-pick');
      await sleep(1500);
      T.refuse = 'winner_undo';
      await page.evaluate(() => { const b = [...document.querySelectorAll('.sv-toast button')].find(x => /Undo/.test(x.textContent)); if (b) b.click(); });
      await sleep(1500);
      ok(T.versions[2].status === 'winner' && vid.file_url === LINK('C') && card.asset_url === LINK('C'), `${label}: a refused Undo leaves Video C the winner and puts its link back on the card`);
      await page.evaluate(() => { const ov = document.getElementById('confirmOverlay'); if (ov) ov.classList.remove('active'); });
      if (page.errors.length) console.log('page errors', label, page.errors);
      ok(!page.errors.length, `${label}: no page errors`);
      await page.close();
    }
  } finally {
    await S.close();
  }
  console.log(`trial-reels-card-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  if (failures.length) process.exit(1);
})();
