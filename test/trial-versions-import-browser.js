'use strict';
/*
 * V2 IN A REAL BROWSER (plan docs/plans/2026-11-trial-and-posting/combined.md row V2; variants.md 4.3), fully offline.
 * "Import from Frame" on a trial card (189 svTrialImportOpen), behind trial_versions_v2. Proves, at 1440 and 390 wide:
 *   - switch off: no Import button (today's "+ Add version" row exactly);
 *   - step 1 has Back; a refused link (share off) says Frame's plain message and keeps the link;
 *   - step 2 names the folder and the card; letters are pre-set only when a file name clearly says one; the version on
 *     the card cannot be picked; a still-processing video cannot be picked; one letter never sits on two videos;
 *   - Back returns to step 1 with the link kept; Cancel writes nothing;
 *   - "Add" sends one versions_import with exactly the picked letters and links, and the card then lists them;
 *   - replacing an answered version asks first; a refused import writes nothing and says why.
 * frameio-view's list is mocked in its F1 shape; trial-reels is answered by its own rules (logic.mjs importPlan).
 */
const path = require('path');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = (l) => 'https://f.io/fixture-imp-' + l.toLowerCase();
const FILE = (n) => 'https://next.frame.io/share/fixture-share/view/fixture-file-' + n;
const SHARE = 'https://f.io/fixture-folder';

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  const vid = S.deliv.find((d) => d.id === 'del_vid_1');
  const T = { flagOn: false, versions: [], calls: [], lists: [], listFail: '', importFail: '' };
  const fresh = (over) => {
    const at = new Date().toISOString();
    T.versions = [{ id: 'vA', letter: 'A', status: 'waiting', frame_url: LINK('A'), revision: 0, updated_at: at, post_id: 'p_t1' },
      Object.assign({ id: 'vB', letter: 'B', status: 'waiting', frame_url: LINK('B'), revision: 0, updated_at: at, post_id: 'p_t1' }, over || {})];
  };
  const VIDEOS = [
    { file_id: 'f1', name: 'hook_B_final.mp4', duration_seconds: 23.4, thumbnail_url: null, created_at: '2026-11-02T10:00:00Z', processing: false, link: FILE(1) },
    { file_id: 'f2', name: 'Morning v3.mp4', duration_seconds: 25, thumbnail_url: null, created_at: '2026-11-02T09:00:00Z', processing: false, link: FILE(2) },
    { file_id: 'f3', name: 'broll test.mp4', duration_seconds: 8, thumbnail_url: null, created_at: '2026-11-02T08:00:00Z', processing: false, link: FILE(3) },
    { file_id: 'f4', name: 'hook_A_old.mp4', duration_seconds: 24, thumbnail_url: null, created_at: '2026-11-02T07:00:00Z', processing: false, link: FILE(4) },
    { file_id: 'f5', name: 'hook_D.mp4', duration_seconds: null, thumbnail_url: null, created_at: '2026-11-02T06:00:00Z', processing: true, link: FILE(5) },
  ];
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
  await S.ctx.route('**/functions/v1/frameio-view', async (route) => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const b = JSON.parse(r.postData() || '{}');
    T.lists.push(b);
    const reply = (obj, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) });
    if (b.part !== 'list') return reply({ ok: false, error: 'unexpected' }, 400);
    if (T.listFail) return reply({ ok: false, error: T.listFail, message: 'This share is switched off in Frame. Fixture message.' }, 404);
    return reply({ ok: true, name: 'Fixture folder v2', videos: VIDEOS, truncated: false, open_url: SHARE, fetched_at: new Date().toISOString() });
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
    if (b.action === 'versions_import') {
      if (T.importFail) return reply({ ok: false, error: T.importFail }, 409);
      const plan = L.importPlan(T.versions, b.items, mainLink());
      if (plan.error) return reply({ ok: false, error: plan.error }, 400);
      for (const u of plan.updates) Object.assign(T.versions.find((x) => x.id === u.id), u.patch);
      for (const x of plan.inserts) T.versions.push({ id: 'v' + x.letter, letter: x.letter, status: 'waiting', frame_url: x.link, revision: 0, updated_at: new Date().toISOString(), post_id: 'p_t1' });
      return reply(Object.assign({ ok: true, changed: [...plan.updates, ...plan.inserts].map((c) => c.letter) }, shape()));
    }
    return reply({ ok: false, error: 'unknown_action' }, 400);
  });

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
  const importBtn = (page) => page.evaluateHandle(() => [...document.querySelectorAll('.trl-add .trl-addbtn')].find((b) => b.offsetParent && /Import from Frame/.test(b.textContent)) || null);
  const sheetText = (page) => page.$eval('#trlImportOverlay.open .trl-imp', (n) => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  // The pickers are the house select (100 _svSelectHtml): its value sits in a hidden input, its options are buttons.
  const picks = (page) => page.$$eval('#trlImportOverlay .trl-imp-pick', (ns) => ns.map((n) => ({
    v: n.querySelector('input[type=hidden]').value,
    disabled: !!n.querySelector('.sv-select.is-disabled'),
    onCard: n.querySelector('[data-sv-select-option][data-label*="on the card"]')?.getAttribute('aria-disabled') === 'true',
    native: !!n.querySelector('select'),
  })));
  const pick = async (page, file, letter) => {
    const i = await page.$$eval('#trlImportOverlay .trl-imp-pick', (ns, f) => ns.findIndex((n) => n.dataset.file === f), file);
    await page.click('#trlImpPick' + i + 'Btn');
    await sleep(150);
    await page.click('#trlImpPick' + i + 'Menu [data-value="' + letter + '"]');
    await sleep(200);
  };
  const listText = (page) => page.evaluate(() => { const l = [...document.querySelectorAll('.trl-list')].find((n) => n.offsetParent); return l ? l.innerText.replace(/\s+/g, ' ').trim() : ''; });

  try {
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
      vid.file_url = LINK('A'); card.asset_url = LINK('A'); card.video_status = 'For SMM Approval';
      T.flagOn = false; fresh(); T.calls = []; T.lists = []; T.listFail = ''; T.importFail = '';
      let page = await open(w, h);
      ok(!!(await page.$('.trl-add .trl-addbtn')) && !(await importBtn(page)).asElement(), `${label}: switch off, "+ Add version" and no Import`);
      await page.close();

      T.flagOn = true; fresh(); T.calls = []; T.lists = [];
      page = await open(w, h);
      const btn = (await importBtn(page)).asElement();
      ok(!!btn, `${label}: switch on, "Import from Frame" beside "+ Add version"`);
      await btn.click();
      await sleep(300);
      ok(/Import versions from Frame/.test(await sheetText(page)) && !!(await page.$('#trlImportOverlay .trl-imp-back')), `${label}: step 1 opens, with a Back button`);
      if (process.env.TRL_SHOTS) await page.screenshot({ path: path.join(process.env.TRL_SHOTS, 'v2-step1-' + label + '.png') });

      // A refused link: Frame's own plain words, the link kept.
      T.listFail = 'share_off';
      await page.fill('#trlImpLink', SHARE);
      await page.click('#trlImportOverlay .cal-import-btn-primary');
      await sleep(700);
      ok(/switched off in Frame/.test(await sheetText(page)) && (await page.inputValue('#trlImpLink')) === SHARE, `${label}: a refused link says why and keeps the link`);
      T.listFail = '';

      await page.click('#trlImportOverlay .cal-import-btn-primary');
      await sleep(800);
      ok(T.lists.length === 2 && T.lists[1].link === SHARE && T.lists[1].part === 'list', `${label}: frameio-view is asked for the list of that link`);
      const t2 = await sheetText(page);
      ok(/Folder "Fixture folder v2" · 5 videos/.test(t2) && /Card: Test card one/.test(t2), `${label}: step 2 names the folder and the card ("${t2.slice(0, 80)}")`);
      let p = await picks(page);
      ok(p.map((x) => x.v).join() === 'B,C,,,', `${label}: letters pre-set only where the name says one (hook_B=B, v3=C, broll and hook_A (on the card) Skip, processing Skip): ${p.map((x) => x.v || '-').join()}`);
      ok(p.every((x) => x.onCard === true), `${label}: Video A, on the card, cannot be picked`);
      ok(p.every((x) => !x.native), `${label}: every picker is the house select, never a browser-native one`);
      ok(p[4].disabled === true && /Still processing in Frame/.test(t2), `${label}: a still-processing video cannot be picked, and says so`);
      ok(/0:23/.test(t2), `${label}: the length shows`);
      if (process.env.TRL_SHOTS) {
        await page.screenshot({ path: path.join(process.env.TRL_SHOTS, 'v2-step2-' + label + '.png') });
        await page.click('#trlImpPick3Btn'); await sleep(250);
        await page.screenshot({ path: path.join(process.env.TRL_SHOTS, 'v2-menu-' + label + '.png') });
        await page.keyboard.press('Escape'); await sleep(200);
      }

      // One letter never on two videos: giving broll C moves C off "Morning v3".
      await pick(page, 'f3', 'C');
      p = await picks(page);
      ok(p[2].v === 'C' && p[1].v === '', `${label}: picking a taken letter moves it, the other video goes back to Skip`);
      await pick(page, 'f2', 'D');
      ok(/Add 3 versions/.test(await sheetText(page)), `${label}: the button counts the picked videos`);

      // Back keeps the link; Cancel writes nothing.
      await page.click('#trlImportOverlay .trl-imp-back');
      await sleep(200);
      ok(/Import versions from Frame/.test(await sheetText(page)) && (await page.inputValue('#trlImpLink')) === SHARE, `${label}: Back returns to step 1 with the link kept`);
      await page.click('#trlImportOverlay .cal-import-btn-ghost');
      await sleep(300);
      ok(!(await page.$('#trlImportOverlay.open')) && !T.calls.some((c) => c.action === 'versions_import'), `${label}: Cancel closes and writes nothing`);

      // The import itself.
      await (await importBtn(page)).asElement().click();
      await sleep(200);
      await page.fill('#trlImpLink', SHARE);
      await page.keyboard.press('Enter');
      await sleep(800);
      await pick(page, 'f3', 'C');
      await page.click('#trlImportOverlay .cal-import-btn-primary');
      await sleep(1200);
      const sent = T.calls.filter((c) => c.action === 'versions_import');
      ok(sent.length === 1 && JSON.stringify(sent[0].items) === JSON.stringify([{ letter: 'B', link: FILE(1) }, { letter: 'C', link: FILE(3) }]),
        `${label}: one versions_import with exactly the picked letters and links (${JSON.stringify(sent[0] && sent[0].items)})`);
      ok(!(await page.$('#trlImportOverlay.open')), `${label}: the sheet closes after the import`);
      ok(/Video C/.test(await listText(page)) && T.versions.find((x) => x.letter === 'B').frame_url === FILE(1), `${label}: the card lists the imported versions`);
      await page.close();

      // Replacing an answered version asks first; a refused import writes nothing and says why.
      fresh({ status: 'approved', smm_ok_at: '2026-11-02T08:00:00Z', kasper_ok_at: '2026-11-02T08:00:00Z', client_ok_at: '2026-11-02T08:00:00Z' });
      T.calls = [];
      page = await open(w, h);
      await (await importBtn(page)).asElement().click();
      await sleep(200);
      await page.fill('#trlImpLink', SHARE);
      await page.keyboard.press('Enter');
      await sleep(800);
      await page.click('#trlImportOverlay .cal-import-btn-primary');
      await sleep(400);
      ok(await page.evaluate(() => document.getElementById('confirmOverlay').classList.contains('active') && /Video B was already answered/.test(document.getElementById('confirmMsg').textContent)),
        `${label}: replacing an answered Video B asks first`);
      T.importFail = 'conflict';
      await page.click('#confirmYes');
      await sleep(1200);
      ok(T.calls.filter((c) => c.action === 'versions_import').length === 1 && T.versions.find((x) => x.letter === 'B').frame_url === LINK('B'), `${label}: a refused import changes nothing`);
      ok(!!(await page.$('#trlImportOverlay.open')) && /changed this version a moment ago/.test(await page.evaluate(() => document.body.innerText)), `${label}: the sheet stays open and the refusal is said in words`);
      T.importFail = '';
      await page.close();

      // Codex on #2545: Import stays on a card whose seven letters are all taken (an import can still replace cuts).
      T.versions = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l) => ({ id: 'v' + l, letter: l, status: 'waiting', frame_url: LINK(l), revision: 0, updated_at: new Date().toISOString(), post_id: 'p_t1' }));
      page = await open(w, h);
      ok(!!(await importBtn(page)).asElement(), `${label}: a card with all seven letters still offers Import from Frame`);
      await page.close();

      // Codex on #2545: the last asked-for new cut arriving by import sends a Tweaks Needed card back to the SMM.
      fresh({ status: 'change asked', change_by: 'client', change_note: 'Fixture note', change_at: '2026-11-02T08:00:00Z' });
      card.video_status = 'Tweaks Needed'; T.calls = [];
      page = await open(w, h);
      await (await importBtn(page)).asElement().click();
      await sleep(200);
      await page.fill('#trlImpLink', SHARE);
      await page.keyboard.press('Enter');
      await sleep(800);
      await page.click('#trlImportOverlay .cal-import-btn-primary');
      await sleep(1500);
      ok(T.versions.find((x) => x.letter === 'B').status === 'waiting', `${label}: B's new cut came in by import`);
      ok(await page.evaluate(() => (calState.posts.find((x) => x.id === 'p_t1') || {}).video_status === 'For SMM Approval'), `${label}: and the card goes back to For SMM Approval, as a pasted link does`);
      card.video_status = 'For SMM Approval';
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
  console.log(`trial-versions-import-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  if (failures.length) process.exit(1);
})();
