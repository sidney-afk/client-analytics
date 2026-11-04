'use strict';
/*
 * V3 IN A REAL BROWSER (plan docs/plans/2026-11-trial-and-posting/combined.md row V3), fully offline. Each version row on
 * the staff Calendar card gets its own thumbnail and caption (189 _trlFieldsHtml), behind trial_versions_v2. Proves, at
 * 1440 and 390 wide:
 *   - switch off: no field line under any version (today's rows exactly);
 *   - switch on: the version on the card says its fields are the card's own; another reads "Same as the card";
 *     a caption typed and left saves through version_fields_set for that letter only; a thumbnail that is not https is
 *     refused before anything is sent; Escape sends nothing;
 *   - picking a winner copies its thumbnail and caption onto the card through today's card save, and Undo puts the
 *     card's own back.
 * The trial-reels function is answered by its own rules (logic.mjs versionFieldsPatch, readShape with the card).
 */
const path = require('path');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = (l) => 'https://f.io/fixture-fields-' + l.toLowerCase();

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

  const fieldsText = (page, l) => page.evaluate((letter) => {
    const rows = [...document.querySelectorAll('.trl-list .trl-v')].filter((n) => n.offsetParent);
    const row = rows.find((n) => new RegExp('(?:Video|Version) ' + letter + '\\b').test(n.innerText));
    const next = row && row.nextElementSibling;
    return next && next.classList.contains('trl-fields') ? next.innerText.replace(/\s+/g, ' ').trim() : '';
  }, l);
  const fieldBtn = (page, l, k) => page.evaluateHandle(({ letter, key }) => {
    const rows = [...document.querySelectorAll('.trl-list .trl-v')].filter((n) => n.offsetParent);
    const row = rows.find((n) => new RegExp('(?:Video|Version) ' + letter + '\\b').test(n.innerText));
    const f = row && row.nextElementSibling;
    return f ? [...f.querySelectorAll('button.trl-f')].find((b) => b.querySelector('.trl-f-k').textContent === key) || null : null;
  }, { letter: l, key: k });
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

  try {
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
      Object.assign(card, CARD0, { video_status: 'For SMM Approval' }); vid.file_url = LINK('A'); card.asset_url = LINK('A');
      T.flagOn = false; fresh(); T.calls = []; T.saves = [];
      let page = await open(w, h);
      ok(!!(await page.$('.trl-list .trl-v')) && !(await page.$('.trl-fields')), `${label}: switch off, no field line under any version`);
      await page.close();

      T.flagOn = true; fresh(); T.calls = [];
      page = await open(w, h);
      ok(/the card's own/.test(await fieldsText(page, 'A')), `${label}: Video A (on the card) says its fields are the card's own ("${await fieldsText(page, 'A')}")`);
      ok(/Thumbnail Same as the card/.test(await fieldsText(page, 'B')) && /Caption Same as the card/.test(await fieldsText(page, 'B')), `${label}: Video B reads "Same as the card" twice ("${await fieldsText(page, 'B')}")`);

      await (await fieldBtn(page, 'B', 'Caption')).click();
      await sleep(200);
      await page.fill('.trl-f-input.trl-f-caption', 'Stop doing this, fixture.');
      await page.keyboard.press('Escape');
      await sleep(400);
      ok(!T.calls.some((c) => c.action === 'version_fields_set') && /Caption Same as the card/.test(await fieldsText(page, 'B')), `${label}: Escape sends nothing`);

      await (await fieldBtn(page, 'B', 'Caption')).click();
      await sleep(200);
      await page.fill('.trl-f-input.trl-f-caption', 'Stop doing this, fixture.');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
      await sleep(900);
      const sent = T.calls.filter((c) => c.action === 'version_fields_set');
      ok(sent.length === 1 && sent[0].letter === 'B' && sent[0].caption === 'Stop doing this, fixture.' && !('thumbnail_url' in sent[0]), `${label}: the caption is sent for B only, and only the caption`);
      ok(/Caption Stop doing this, fixture\./.test(await fieldsText(page, 'B')), `${label}: B shows its own caption ("${await fieldsText(page, 'B')}")`);

      await (await fieldBtn(page, 'B', 'Thumbnail')).click();
      await sleep(200);
      await page.fill('.trl-f-input', 'http://e.example/b.jpg');
      await page.keyboard.press('Enter');
      await sleep(500);
      ok(T.calls.filter((c) => c.action === 'version_fields_set').length === 1 && /https link/.test(await page.evaluate(() => document.body.innerText)), `${label}: an http thumbnail is refused before anything is sent, in words`);
      await page.keyboard.press('Escape');
      await sleep(300);
      ok(!(await page.$('#confirmOverlay.active')), `${label}: the notice closes with Escape`);
      await (await fieldBtn(page, 'B', 'Thumbnail')).click();
      await sleep(200);
      await page.fill('.trl-f-input', 'https://e.example/fixture-b.jpg');
      await page.keyboard.press('Enter');
      await sleep(900);
      ok(T.versions[1].thumbnail_url === 'https://e.example/fixture-b.jpg' && !!(await page.$('.trl-fields .trl-f-img')), `${label}: B gets its own thumbnail, shown small`);
      ok(card.thumbnail_url === CARD0.thumbnail_url && card.caption === CARD0.caption, `${label}: the card's own fields are untouched`);
      // A Google Drive file page (the team's usual thumbnail link) is shown as its image, as the card's own is (V4 live walk).
      await (await fieldBtn(page, 'C', 'Thumbnail')).click();
      await sleep(200);
      await page.fill('.trl-f-input', 'https://drive.google.com/file/d/FixtureDriveFile456/view');
      await page.keyboard.press('Enter');
      await sleep(900);
      const cImg = await page.evaluate(() => { const i = [...document.querySelectorAll('.trl-fields .trl-f-img')].map(x => x.getAttribute('src')); return i.find(x => /FixtureDriveFile456/.test(x)) || ''; });
      ok(/^https:\/\/lh3\.googleusercontent\.com\/d\/FixtureDriveFile456=w\d+/.test(cImg), `${label}: a Drive file page as C's thumbnail shows as its image (${cImg.slice(0, 44)})`);
      if (process.env.TRL_SHOTS) {
        await page.screenshot({ path: path.join(process.env.TRL_SHOTS, 'v3-row-' + label + '.png') });
        await (await fieldBtn(page, 'C', 'Caption')).click(); await sleep(300);
        await page.screenshot({ path: path.join(process.env.TRL_SHOTS, 'v3-edit-' + label + '.png') });
        await page.keyboard.press('Escape'); await sleep(300);
      }
      await page.close();

      // The winner copy and its Undo.
      fresh('on trial'); Object.assign(T.versions[1], { caption: 'Winner words, fixture.', thumbnail_url: 'https://e.example/fixture-win.jpg' });
      card.video_status = 'Posted'; T.saves = []; T.calls = [];
      page = await open(w, h);
      const trophy = (await page.evaluateHandle(() => {
        const row = [...document.querySelectorAll('.trl-list .trl-v')].find((n) => n.offsetParent && /(?:Video|Version) B\b/.test(n.innerText));
        return row ? row.querySelector('.trl-pick') : null;
      })).asElement();
      ok(!!trophy, `${label}: B offers the trophy`);
      if (trophy) {
        await trophy.click();
        await sleep(2000);
        ok(T.winner === 'B' && T.saves.some((t) => t.includes('fixture-win.jpg') && t.includes('Winner words, fixture.')), `${label}: picking B copies its thumbnail and caption onto the card through today's card save`);
        const undo = await page.$('.sv-toast button');
        if (undo) { await undo.click(); await sleep(2200); }
        ok(!T.winner && T.saves.some((t) => t.includes('fixture-card-thumb.jpg') && t.includes('The card caption, fixture.')), `${label}: Undo puts the card's own thumbnail and caption back`);
      }
      await page.close();

      // Undo after someone edited the card since the pick: theirs stands, nothing is put back, and the page says so.
      fresh('on trial'); Object.assign(T.versions[1], { caption: 'Winner words, fixture.', thumbnail_url: 'https://e.example/fixture-win.jpg' });
      Object.assign(card, CARD0, { video_status: 'Posted' }); vid.file_url = LINK('A'); card.asset_url = LINK('A'); T.saves = [];
      page = await open(w, h);
      const trophy2 = (await page.evaluateHandle(() => {
        const row = [...document.querySelectorAll('.trl-list .trl-v')].find((n) => n.offsetParent && /(?:Video|Version) B\b/.test(n.innerText));
        return row ? row.querySelector('.trl-pick') : null;
      })).asElement();
      if (trophy2) {
        await trophy2.click();
        await sleep(2000);
        ok(T.winner === 'B' && !(await page.$$eval('.trl-list .trl-fields', (ns) => ns.some((n) => n.offsetParent && /Same as the card/.test(n.innerText)))),
          `${label}: after the pick, the versions that lost show no field line`);
        await page.evaluate(() => { const p = calState.posts.find((x) => x.id === 'p_t1'); p.caption = 'Edited by someone else, fixture.'; });
        const savesBefore = T.saves.length;
        const undo2 = await page.$('.sv-toast button');
        if (undo2) { await undo2.click(); await sleep(2200); }
        ok(!T.winner && !T.saves.slice(savesBefore).some((t) => t.includes('The card caption, fixture.')), `${label}: Undo after a card edit overwrites nothing`);
        ok(/edited after the winner was picked/.test(await page.evaluate(() => document.body.innerText)), `${label}: and says so in plain words`);
      } else ok(false, `${label}: B offers the trophy again`);
      await page.close();

      // Codex P2 on #2539: the card's thumbnail and caption could not be saved, so the winner is not picked and the
      // card's video link goes back; the page says why.
      fresh('on trial'); Object.assign(T.versions[1], { caption: 'Winner words, fixture.', thumbnail_url: 'https://e.example/fixture-win.jpg' });
      Object.assign(card, CARD0, { video_status: 'Posted' }); vid.file_url = LINK('A'); card.asset_url = LINK('A'); T.saves = []; T.calls = [];
      page = await open(w, h);
      T.failSave = true;
      const trophy3 = (await page.evaluateHandle(() => {
        const row = [...document.querySelectorAll('.trl-list .trl-v')].find((n) => n.offsetParent && /(?:Video|Version) B\b/.test(n.innerText));
        return row ? row.querySelector('.trl-pick') : null;
      })).asElement();
      if (trophy3) {
        await trophy3.click();
        await sleep(3000);
        ok(!T.calls.some((c) => c.action === 'winner_set') && !T.winner, `${label}: a failed card save means no winner_set`);
        ok(vid.file_url === LINK('A'), `${label}: and the card's video link is put back on Video A ("${vid.file_url}")`);
        ok(/could not be saved/.test(await page.evaluate(() => document.body.innerText)), `${label}: and the page says why`);
      } else ok(false, `${label}: B offers the trophy a third time`);
      T.failSave = false;
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
  console.log(`trial-version-fields-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  if (failures.length) process.exit(1);
})();
