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
 *
 * The fix (session Trials, build 2): the pick reads the versions now and stops when a winner is already picked; when
 * the function still refuses after the attach (a read that raced the other pick), the put-back goes to the function's
 * own main version and is a compare-and-swap on the sub-issue's clock from this page's own attach, so a link someone
 * else attached since is never overwritten. Three races, each from the same start:
 *   1. the second page's pick after the first's: stopped before anything is written;
 *   2. its read raced the first pick (it still saw D on trial): D is attached, refused, and the card goes back to
 *      the WINNER's link (C), not to the A the page saw;
 *   3. as 2, and a third hand attaches another link before the put-back: the put-back is refused, theirs stands.
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
  const T = { calls: [], stale: null, attaches: [], beforePutBack: null };
  const reset = () => {
    card.asset_url = LINK('A'); vid.file_url = LINK('A'); vid.updated_at = '2026-10-27T08:00:00.000Z';
    T.versions = ['A', 'B', 'C', 'D'].map(l => ({ id: 'v' + l, letter: l, status: 'on trial', frame_url: LINK(l), trial_ends_at: past, revision: 0, updated_at: '2026-10-27T09:00:00.000Z' }));
    T.stale = null; T.attaches = []; T.beforePutBack = null;
  };
  reset();
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
    // A read that raced another pick: answers once with the versions as they were before it.
    if (b.action === 'read' && T.stale) { const st = T.stale; T.stale = null; return reply(Object.assign({ ok: true }, st)); }
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
    T.attaches.push(b.file_url);
    // The third hand of race 3: just before the put-back (the second attach of the losing pick), someone attaches E.
    if (T.beforePutBack && T.attaches.length === 2) { T.beforePutBack(); T.beforePutBack = null; }
    const row = () => ({ id: vid.id, file_url: vid.file_url, updated_at: vid.updated_at });
    if (b.expected_updated_at !== vid.updated_at) return route.fulfill({ status: 409, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: false, error: { code: 'write_conflict' }, row: row() }) });
    vid.file_url = b.file_url; card.asset_url = b.file_url; vid.updated_at = new Date(Date.now() + T.attaches.length).toISOString();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, native_committed: true, row: row() }) });
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

  const short = u => String(u).replace('https://f.io/fixture-race-', '…');
  const rows = () => { const sh = L.readShape(T.versions, { client: false, mainLink: mainLink(), cardStatus: '' }); return { c: sh.versions.find(v => v.letter === 'C'), a: sh.versions.find(v => v.letter === 'A') }; };
  try {
    for (const race of [1, 2, 3]) {
      reset();
      const one = await open();
      const two = await open();
      await one.click('.trl-list .trl-v:nth-child(3) .trl-pick');
      await sleep(1500);
      ok(T.versions[2].status === 'winner' && vid.file_url === LINK('C'), `race ${race}: the first staff member picks Video C: it is the winner and the card's link`);
      const n0 = T.attaches.length;
      T.attaches = [];
      if (race >= 2) {   // the second page's read raced the first pick: it still sees D on trial and no winner
        T.stale = Object.assign({ enabled: true, winner_letter: null }, L.readShape(T.versions.map(v => Object.assign({}, v, { status: 'on trial' })), { client: false, mainLink: LINK('A'), cardStatus: card.video_status }));
      }
      if (race === 3) T.beforePutBack = () => { vid.file_url = LINK('E'); card.asset_url = LINK('E'); vid.updated_at = '2026-10-27T23:00:00.000Z'; };
      await two.click('.trl-list .trl-v:nth-child(4) .trl-pick');   // the second page still shows D on trial
      await sleep(2500);
      ok(T.versions[2].status === 'winner' && T.versions[3].status === 'lost', `race ${race}: the second pick (Video D) is refused: C stays the winner`);
      if (race === 1) ok(n0 === 1 && T.attaches.length === 0, `race 1: the second pick stops before it writes anything (${T.attaches.length} attach(es))`);
      if (race === 3) {
        ok(vid.file_url === LINK('E') && card.asset_url === LINK('E'), `race 3: a link someone else attached before the put-back stands (file_url ${short(vid.file_url)})`);
      } else {
        ok(vid.file_url === LINK('C') && card.asset_url === LINK('C'), `race ${race}: afterwards the card's one link is still the winner's (file_url ${short(vid.file_url)}, asset_url ${short(card.asset_url)})`);
        const r = rows();
        ok(r.c.frame_url !== r.a.frame_url, `race ${race}: the card's Video C row and Video A row never show the same link (${r.c.frame_url} / ${r.a.frame_url})`);
      }
      ok(!one.errors.length && !two.errors.length, `race ${race}: no page errors (${one.errors.concat(two.errors).join(' | ')})`);
      await one.close(); await two.close();
    }
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  console.log(`trial-reels-race-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
