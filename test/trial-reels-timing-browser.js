'use strict';
/*
 * TRIAL REELS: TWO THINGS THAT CAME LATE ON THE STAFF CARD (Sidney, 2026-10-31, Nightreel's Q3 and Q4; session
 * Trialchange), in a real browser, fully offline, on the lost-work fixture (fictional data). Saves are held slow on
 * purpose, as a live line can be:
 *   winner   "Video C is the winner · Undo" shows on the click, not when the save comes back (about 4 s live). A refused
 *            pick takes the toast back and says why; Undo pressed while the pick is still saving puts the trial back.
 *   posted   a card set to Posted shows "On trial" with its countdown in about 1 s, not about 7 s: the function starts
 *            the trial only once it reads the card as Posted, which is after the Posted save lands. A refused Posted
 *            save leaves no "On trial" behind.
 * Each part fails on main by itself (TRT_PART=winner|posted runs one).
 */
const path = require('path');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = l => 'https://f.io/fixture-timing-' + l.toLowerCase();
const part = k => !process.env.TRT_PART || process.env.TRT_PART === k;
const SLOW_MS = 3000;

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  const vid = S.deliv.find(d => d.id === 'del_vid_1');
  const T = { calls: [], winnerDelay: 0, refuseWinner: false };
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
    T.calls.push(Object.assign({ at: Date.now() }, b));
    const reply = (obj, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) }).catch(() => {});
    const shape = () => Object.assign({ enabled: true, winner_letter: (T.versions.find(v => v.status === 'winner') || {}).letter || null },
      L.readShape(T.versions, { client: false, mainLink: mainLink(), cardStatus: card.video_status }));
    const apply = changes => { for (const c of changes || []) Object.assign(T.versions.find(v => v.id === c.id), c.patch); };
    // Every read and list starts the trial once the card is Posted on the server, as the function does (startIfPosted).
    if (b.action === 'list' || b.action === 'read') {
      const auto = L.autoTrialPatches(T.versions, { cardStatus: card.video_status, postedAt: card.video_status_at, nowMs: Date.now(), mainLink: mainLink() });
      apply(auto.patches);
      return reply(b.action === 'list' ? { ok: true, cards: { p_t1: shape() } } : Object.assign({ ok: true }, shape()));
    }
    let res = null;
    if (b.action === 'winner_set') {
      if (T.winnerDelay) await sleep(T.winnerDelay);
      if (T.refuseWinner) return reply({ ok: false, error: 'write_failed' }, 500);
      res = L.winnerPatches(T.versions, b.letter, mainLink()); if (!res.error) apply(res.patches);
    } else if (b.action === 'winner_undo') { res = L.undoWinnerPatches(T.versions, mainLink()); if (!res.error) apply(res.patches); }
    if (!res) return reply({ ok: false, error: 'unknown_action' }, 400);
    if (res.error) return reply({ ok: false, error: res.error }, 400);
    return reply(Object.assign({ ok: true }, shape()));
  });
  await S.ctx.route('**/functions/v1/production-write{,?*}', async route => {
    const r = route.request();
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (r.method() !== 'POST' || b.operation !== 'attachment') return route.fallback();
    vid.file_url = b.file_url; card.asset_url = b.file_url; vid.updated_at = new Date().toISOString();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, native_committed: true, row: { id: vid.id, file_url: vid.file_url, updated_at: vid.updated_at } }) });
  });
  const open = async () => {
    const page = await S.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await S.openCalendar(page);
    await sleep(1500);
    return page;
  };
  const toast = page => page.evaluate(() => { const t = document.querySelector('.sv-toast .sv-toast-msg'); return t ? t.textContent : ''; });
  const rowState = page => page.evaluate(() => { const s = [...document.querySelectorAll('.cal-link-post.trl-main')].find(n => n.offsetParent); return s ? s.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const until = async (page, fn, arg, ms) => { const t0 = Date.now(); await page.waitForFunction(fn, arg, { timeout: ms, polling: 25 }).catch(() => {}); return Date.now() - t0; };

  try {
    // ---------- winner: the toast on the click ----------
    if (part('winner')) {
      const past = new Date(Date.now() - 3600000).toISOString();
      const resetWin = () => {
        card.asset_url = LINK('A'); vid.file_url = LINK('A'); vid.updated_at = '2026-10-27T08:00:00.000Z'; card.video_status = 'Posted';
        T.versions = ['A', 'B', 'C'].map(l => ({ id: 'v' + l, letter: l, status: 'on trial', frame_url: LINK(l), trial_ends_at: past, revision: 0, updated_at: '2026-10-27T09:00:00.000Z' }));
        T.winnerDelay = SLOW_MS; T.refuseWinner = false;
      };
      for (const run of ['saves', 'refused', 'undo in flight']) {
        resetWin();
        if (run === 'refused') T.refuseWinner = true;
        const page = await open();
        await page.click('.cal-link-post .trl-state-ico'); await sleep(300);
        const t0 = Date.now();
        await page.click('.trl-list .trl-v:nth-child(3) .trl-pick');
        const ms = await until(page, () => { const t = document.querySelector('.sv-toast .sv-toast-msg'); return !!(t && /Video C is the winner/.test(t.textContent)); }, null, SLOW_MS + 3000);
        const took = Date.now() - t0;
        ok(took < 600 && ms < 600, `winner (${run}): "Video C is the winner" shows ${took} ms after the click, not when the save returns (save held ${SLOW_MS} ms)`);
        if (run === 'saves') {
          await page.waitForFunction(() => false, null, { timeout: SLOW_MS + 1500 }).catch(() => {});
          ok(T.versions[2].status === 'winner' && vid.file_url === LINK('C'), 'winner (saves): C is the winner and the card\'s link once the save lands');
        }
        if (run === 'refused') {
          await sleep(SLOW_MS + 1500);
          const g = await page.evaluate(() => ({ toast: (document.querySelector('.sv-toast .sv-toast-msg') || {}).textContent || '', notify: document.body.innerText }));
          ok(!/Video C is the winner/.test(g.toast), `winner (refused): the toast is taken back ("${g.toast}")`);
          ok(/winner|did not|not picked|not saved|Nothing/i.test(g.notify) && T.versions.every(v => v.status === 'on trial'), 'winner (refused): the page says it did not happen, and every version is still on trial');
        }
        if (run === 'undo in flight') {
          await sleep(300);
          await page.click('.sv-toast .sv-toast-action');   // Undo while the pick is still saving
          await sleep(SLOW_MS + 2500);
          ok(T.calls.some(c => c.action === 'winner_undo') && T.versions.every(v => v.status === 'on trial'), `winner (undo in flight): Undo puts the trial back once the pick lands (${T.versions.map(v => v.letter + ':' + v.status).join(' ')})`);
          ok(!/Someone else just changed/.test(await page.evaluate(() => document.body.innerText)), 'winner (undo in flight): no "Someone else just changed this trial"');
        }
        ok(!page.errors.length, `winner (${run}): no page errors (${page.errors.join(' | ')})`);
        await page.close();
      }
    }

    // ---------- posted: "On trial" in about 1 s ----------
    if (part('posted')) {
      for (const run of ['saves', 'refused']) {
        card.asset_url = LINK('A'); vid.file_url = LINK('A'); card.video_status = 'Approved';
        T.versions = ['A', 'B', 'C'].map(l => ({ id: 'v' + l, letter: l, status: 'approved', frame_url: LINK(l), revision: 0, smm_ok_at: '2026-10-28T08:00:00.000Z', kasper_ok_at: '2026-10-28T08:05:00.000Z', client_ok_at: '2026-10-28T10:00:00.000Z', updated_at: '2026-10-28T09:00:00.000Z' }));
        // The Posted save is slow: the server holds Approved until it lands (commit at the end), or refuses it.
        S.behave['cal-upsert'] = run === 'saves' ? { delay: SLOW_MS, commit: false, times: 1 } : { delay: SLOW_MS, mode: 'http', status: 500, body: { ok: false, error: 'synthetic' }, commit: false, times: 20 };
        S.behave['gw:status'] = run === 'saves' ? { delay: SLOW_MS, commit: false, times: 1 } : { delay: SLOW_MS, mode: 'http', status: 500, body: { ok: false, error: 'synthetic' }, commit: false, times: 20 };
        const page = await open();
        ok(/approved/i.test(await rowState(page)) && !/On trial/.test(await rowState(page)), `posted (${run}): before, the row reads approved ("${await rowState(page)}")`);
        const t0 = Date.now();
        await page.evaluate(() => _calStatusPick('p_t1', 'Posted', 'video'));
        await until(page, () => { const s = [...document.querySelectorAll('.cal-link-post.trl-main')].find(n => n.offsetParent); return !!(s && /On trial/.test(s.innerText)); }, null, 9000);
        const took = Date.now() - t0;
        if (run === 'saves') {
          ok(took < 1500, `posted: "On trial" shows ${took} ms after Posted (the Posted save held ${SLOW_MS} ms; was about 7 s live)`);
          await page.waitForFunction(() => false, null, { timeout: SLOW_MS + 4000 }).catch(() => {});
          ok(T.versions.every(v => v.status === 'on trial') && /On trial · 2[34] h left/.test(await rowState(page)), `posted: once the save lands the function's trial is read and the row keeps "On trial" ("${await rowState(page)}")`);
          const n = T.calls.filter(c => c.action === 'read').length;
          await sleep(2500);
          ok(T.calls.filter(c => c.action === 'read').length === n, `posted: the re-reads stop once the trial has started (${n} then ${T.calls.filter(c => c.action === 'read').length})`);
        } else {
          await page.waitForFunction(() => false, null, { timeout: SLOW_MS + 4000 }).catch(() => {});
          const st = await rowState(page);
          ok(!/On trial/.test(st) && T.versions.every(v => v.status === 'approved'), `posted (refused): no "On trial" left behind once the Posted save is refused ("${st}")`);
        }
        ok(!page.errors.length, `posted (${run}): no page errors (${page.errors.join(' | ')})`);
        delete S.behave['cal-upsert']; delete S.behave['gw:status'];
        await page.close();
      }
    }
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  console.log(`trial-reels-timing-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
