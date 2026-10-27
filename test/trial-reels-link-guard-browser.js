'use strict';
/*
 * TRIAL REELS: THE CARD'S ONE LINK WHEN A LINK ON THE VERSION ON THE CARD IS REFUSED, in a real browser, fully
 * offline. Session Probe, 2026-10-27 (second pass on the fixes).
 *
 * The version on the card (Video A, then the winner) is saved through today's Production attach FIRST and copied to
 * the version after. When the function then refuses the copy (a link another version already has; a version that is
 * decided), what must hold is the plan's one rule: the card's link and the version on the card's link are one link,
 * and the page never says "did not save" about a link the card now carries.
 */
const path = require('path');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = l => 'https://f.io/fixture-guard-' + l.toLowerCase();

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  const vid = S.deliv.find(d => d.id === 'del_vid_1');
  card.asset_url = LINK('A'); vid.file_url = LINK('A');
  const T = { versions: ['A', 'B', 'C'].map(l => ({ id: 'v' + l, letter: l, status: 'waiting', frame_url: LINK(l), revision: 0, updated_at: '2026-10-27T09:00:00.000Z' })), calls: [] };
  const mainLink = () => String(vid.file_url || card.asset_url || '');

  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
    const u = new URL(route.request().url());
    const raw = u.searchParams.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({ key: k,
      value: k === 'trial_reels_pages' ? { clients: ['fixtureclient'] } : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: ['fixtureclient'] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
  });
  await S.ctx.route('**/functions/v1/trial-reels', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const b = JSON.parse(r.postData() || '{}');
    T.calls.push(b);
    const reply = (obj, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) });
    const shape = () => Object.assign({ enabled: true, winner_letter: (T.versions.find(v => v.status === 'winner') || {}).letter || null },
      L.readShape(T.versions, { client: false, mainLink: mainLink(), cardStatus: card.video_status }));
    const apply = changes => { for (const c of changes || []) Object.assign(T.versions.find(v => v.id === c.id), c.patch); };
    let res = null;
    if (b.action === 'list') return reply({ ok: true, cards: { p_t1: shape() } });
    if (b.action === 'read') return reply(Object.assign({ ok: true }, shape()));
    if (b.action === 'version_link_set') {
      res = L.linkPatch(T.versions, b.letter, b.link, mainLink());
      if (!res.error && res.patch) Object.assign(T.versions.find(v => v.letter === b.letter), res.patch);
    }
    if (!res) return reply({ ok: false, error: 'unknown_action' }, 400);
    if (res.error) return reply({ ok: false, error: res.error }, res.error === 'attach_first' ? 409 : 400);
    return reply(Object.assign({ ok: true }, shape()));
  });
  await S.ctx.route('**/functions/v1/production-write{,?*}', async route => {
    const r = route.request();
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (r.method() !== 'POST' || b.operation !== 'attachment') return route.fallback();
    if (b.expected_updated_at !== vid.updated_at) return route.fulfill({ status: 409, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: false, error: 'write_conflict' }) });
    vid.file_url = b.file_url; card.asset_url = b.file_url; vid.updated_at = new Date().toISOString();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, native_committed: true }) });
  });
  const notices = page => page.evaluate(() => (window.__seen || []).filter(s => s.kind === 'notify').map(s => s.a + ' ' + s.b).join(' | '));
  const editMain = async (page, link, row) => {
    const n = row || 1;
    if (!(await page.$('.trl-list'))) { await page.click('.cal-link-post .trl-chev'); await sleep(300); }
    await page.hover('.trl-list .trl-v:nth-child(' + n + ')');
    await page.click('.trl-list .trl-v:nth-child(' + n + ') .trl-ico[title="Change the link"]');
    await page.fill('.trl-link-input', link);
    await page.keyboard.press('Enter');
    await sleep(1500);
  };
  const oneLink = () => {
    const sh = L.readShape(T.versions, { client: false, mainLink: mainLink(), cardStatus: '' });
    const main = T.versions.find(v => v.letter === sh.main_letter);
    const shown = sh.versions.map(v => v.frame_url);
    return { same: vid.file_url === card.asset_url && main.frame_url === vid.file_url && new Set(shown).size === shown.length, file: vid.file_url, main: main.letter + ' ' + main.frame_url };
  };
  const open = async () => {
    const page = await S.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await S.openCalendar(page);
    await sleep(1500);
    return page;
  };

  try {
    // 1. Video A (on the card) given Video B's link by mistake.
    let page = await open();
    await editMain(page, LINK('B'));
    let o = oneLink();
    ok(o.same, 'a link another version already has, pasted on Video A: the card and Video A still agree, and no two rows show one link (card ' + o.file.replace('https://f.io/fixture-guard-', '…') + ', ' + o.main.replace('https://f.io/fixture-guard-', '…') + ')');
    const said = await notices(page);
    ok(!/did not save/.test(said) || vid.file_url === LINK('A'), 'and if the page says the link did not save, the card did not change either (' + said.slice(0, 160) + ')');
    await page.close();

    // 2. The winner's link changed on the card after the pick (the version is decided).
    vid.file_url = LINK('C'); card.asset_url = LINK('C');
    T.versions.forEach(v => { v.status = v.letter === 'C' ? 'winner' : 'lost'; });
    page = await open();
    await editMain(page, 'https://f.io/fixture-guard-c-recut', 3);
    o = oneLink();
    const said2 = await notices(page);
    ok(!(/did not save/.test(said2) && vid.file_url === 'https://f.io/fixture-guard-c-recut'),
      'the winner\'s link: the page never says "did not save" about a link the card now carries (card ' + vid.file_url.replace('https://f.io/fixture-guard-', '…') + '; ' + said2.slice(0, 160) + ')');
    await page.close();
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  console.log(`trial-reels-link-guard-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
