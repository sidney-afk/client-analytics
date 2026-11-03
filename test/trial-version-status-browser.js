'use strict';
/*
 * V1 IN A REAL BROWSER (plan docs/plans/2026-11-trial-and-posting/combined.md row V1; Sidney's D1), fully offline.
 * Each version row on the staff Calendar card gets the card's own status picker (189 _trlStatusPickHtml), behind the
 * trial_versions_v2 switch. Proves, at 1440 and 390 wide:
 *   - switch off: the row is today's label exactly (no picker);
 *   - switch on, admin and SMM keys: the pill names the version's status in the card's words; its menu is the card's
 *     list up to Approved (no N/A, Scheduled or Posted); picking Approved sends version_status_set for that letter only
 *     and the row reads Approved; the card's own status is not written (no card save, no Production status push);
 *   - a version with no link: the review statuses are disabled, as the card disables them on an empty part;
 *   - a refusal puts the row back and says why;
 *   - a creative key gets no picker (today's label).
 * The trial-reels function is answered by its own rules (logic.mjs versionStatusPatches and readShape).
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

  try {
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
      // Switch off: today's row.
      T.flagOn = false; fresh(); T.calls = []; T.writes = []; T.refuse = '';
      card.video_status = 'For SMM Approval';
      let page = await open(w, h);
      ok(!!(await page.$('.trl-list .trl-v')) && !(await page.$('.trl-v .trl-st')), `${label}: switch off, the versions show with no status picker`);
      ok(/with SMM/.test(await page.$eval('.trl-list', (n) => n.innerText).catch(() => '')), `${label}: switch off, the label is today's ("with SMM")`);
      await page.close();

      // Switch on, admin key (the harness's).
      T.flagOn = true; fresh(); T.calls = []; T.writes = [];
      page = await open(w, h);
      ok((await pillText(page, 'A')) === 'For SMM Approval' && (await pillText(page, 'B')) === 'For SMM Approval', `${label}: A and B read For SMM Approval, in the card's words`);
      ok((await pillText(page, 'C')) === 'In Progress', `${label}: C, with no link, reads In Progress`);
      await (await pill(page, 'B')).click();
      await sleep(300);
      const items = await page.$$eval('.cal-fld-status-menu .cal-fld-status-item', (ns) => ns.map((n) => n.textContent.trim()));
      ok(JSON.stringify(items) === JSON.stringify(['In Progress', 'For SMM Approval', 'Kasper Approval', 'Client Approval', 'Tweaks Needed', 'Approved']),
        `${label}: the menu is the card's list up to Approved (${items.join(', ')})`);
      ok(!!(await page.$('.cal-fld-status-menu .cal-fld-status-item.active.cal-fld-status-for-smm-approval')), `${label}: the current status is marked in the menu`);
      await page.click('.cal-fld-status-menu .cal-fld-status-item.cal-fld-status-approved');
      await sleep(900);
      const sent = T.calls.filter((c) => c.action === 'version_status_set');
      ok(sent.length === 1 && sent[0].letter === 'B' && sent[0].status === 'Approved' && sent[0].client === 'fixtureclient' && sent[0].post_id === 'p_t1',
        `${label}: one version_status_set, for B, Approved`);
      ok((await pillText(page, 'B')) === 'Approved' && (await pillText(page, 'A')) === 'For SMM Approval', `${label}: B reads Approved; A is unchanged`);
      ok(T.versions[1].status === 'approved' && !!T.versions[1].smm_ok_at && !!T.versions[1].kasper_ok_at && !!T.versions[1].client_ok_at,
        `${label}: B is stored approved with all three OKs (D1: an SMM may go straight to Approved)`);
      ok(!(await page.$('.cal-fld-status-menu')), `${label}: the menu closes on the pick`);
      if (process.env.TRL_SHOTS) {
        await page.screenshot({ path: path.join(process.env.TRL_SHOTS, 'v1-row-' + label + '.png') });
        await (await pill(page, 'A')).click(); await sleep(400);
        await page.screenshot({ path: path.join(process.env.TRL_SHOTS, 'v1-menu-' + label + '.png') });
        await page.keyboard.press('Escape'); await sleep(200);
      }
      ok(T.writes.length === 0 && card.video_status === 'For SMM Approval', `${label}: the card's status is not written (no card save, no Production push)`);

      // No link: the review statuses are disabled.
      await (await pill(page, 'C')).click();
      await sleep(300);
      const dis = await page.$$eval('.cal-fld-status-menu .cal-fld-status-item', (ns) => ns.filter((n) => n.disabled).map((n) => n.textContent.trim()));
      ok(JSON.stringify(dis) === JSON.stringify(['For SMM Approval', 'Kasper Approval', 'Client Approval', 'Approved']), `${label}: with no link, the review statuses are disabled (${dis.join(', ')})`);
      ok(/Paste its Frame\.io link first/.test(await page.$eval('.cal-fld-status-menu', (n) => n.innerText)), `${label}: and the menu says why`);
      await page.keyboard.press('Escape');
      await sleep(200);
      ok(!(await page.$('.cal-fld-status-menu')), `${label}: Escape closes the menu`);

      // A refusal puts the row back and says why.
      T.refuse = 'status_follows_card';
      await (await pill(page, 'A')).click();
      await sleep(300);
      await page.click('.cal-fld-status-menu .cal-fld-status-item.cal-fld-status-kasper-approval');
      await sleep(1000);
      ok((await pillText(page, 'A')) === 'For SMM Approval', `${label}: a refused pick puts A back`);
      ok(/follows the card/.test(await page.evaluate(() => document.body.innerText)), `${label}: and says why in words`);
      T.refuse = '';

      // SMM key: the picker; creative key: today's label.
      await asRole(page, 'smm');
      ok(!!(await pill(page, 'A')), `${label}: an SMM key gets the picker`);
      await asRole(page, 'creative');
      ok(!(await page.$('.trl-v .trl-st')) && !!(await page.$('.trl-list .trl-lab')), `${label}: a creative key gets today's label, no picker`);
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
  console.log(`trial-version-status-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  if (failures.length) process.exit(1);
})();
