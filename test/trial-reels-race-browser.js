'use strict';
/*
 * TRIAL REELS: TWO STAFF PICK A WINNER AT ONCE, in a real browser, fully offline. Session Probe, 2026-10-27.
 *
 * Two staff pages show the same card, its 24 h up (fictional data, docs/syncview-design/tests/lost-work-lib.js). The
 * first picks Video C. The second, still showing the list it read (kept 30 s), picks Video D: today's attach puts D's
 * link on the card (its read of the sub-issue is fresh, so the attach is accepted), the function refuses D (C already
 * won), and the page puts back the link IT saw before (Video A's). What must hold afterwards is the plan's one rule:
 * the card's one link is the winner's (file_url = asset_url = Video C's link), so the video that posts on the
 * calendar date is the one the team picked.
 */
const path = require('path');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = l => 'https://f.io/fixture-race-' + l.toLowerCase();

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  const vid = S.deliv.find(d => d.id === 'del_vid_1');
  card.asset_url = LINK('A'); vid.file_url = LINK('A');
  const past = new Date(Date.now() - 3600000).toISOString();
  const T = { versions: ['A', 'B', 'C', 'D'].map(l => ({ id: 'v' + l, letter: l, status: 'on trial', frame_url: LINK(l), trial_ends_at: past, revision: 0, updated_at: '2026-10-27T09:00:00.000Z' })), calls: [] };
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
    if (b.action === 'winner_set') { res = L.winnerPatches(T.versions, b.letter, mainLink()); if (!res.error) apply(res.patches); }
    else if (b.action === 'winner_undo') { res = L.undoWinnerPatches(T.versions, mainLink()); if (!res.error) apply(res.patches); }
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
  const open = async () => {
    const page = await S.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await S.openCalendar(page);
    await sleep(1500);
    await page.click('.cal-link-post .trl-state-ico');
    await sleep(300);
    return page;
  };

  try {
    const one = await open();
    const two = await open();
    await one.click('.trl-list .trl-v:nth-child(3) .trl-pick');
    await sleep(1500);
    ok(T.versions[2].status === 'winner' && vid.file_url === LINK('C'), 'the first staff member picks Video C: it is the winner and the card\'s link');
    await two.click('.trl-list .trl-v:nth-child(4) .trl-pick');   // the second page still shows D on trial
    await sleep(2000);
    ok(T.versions[2].status === 'winner' && T.versions[3].status === 'lost', 'the second pick (Video D) is refused: C stays the winner');
    ok(vid.file_url === LINK('C') && card.asset_url === LINK('C'),
      'afterwards the card\'s one link is still the winner\'s (file_url ' + vid.file_url.replace('https://f.io/fixture-race-', '…') + ', asset_url ' + card.asset_url.replace('https://f.io/fixture-race-', '…') + ')');
    const sh = L.readShape(T.versions, { client: false, mainLink: mainLink(), cardStatus: '' });
    const c = sh.versions.find(v => v.letter === 'C'), a = sh.versions.find(v => v.letter === 'A');
    ok(c.frame_url !== a.frame_url, 'the card\'s Video C row and Video A row never show the same link (' + c.frame_url + ' / ' + a.frame_url + ')');
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  console.log(`trial-reels-race-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
