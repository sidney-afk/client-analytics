'use strict';
/*
 * Kasper's review board in a REAL page: cards that are at Kasper Approval and urgent must
 * be on his screen (OPEN_REPAIRS 316).
 *
 * Run:  node test/kasper-board-browser.js
 *
 * THE REPORT. Two cards for one client sat at Kasper Approval and were marked urgent from
 * 15:26 to 17:14 UTC on 2026-10-01, and were not on Kasper's board. The client is in the
 * page's own client list, both rows come back from the paged read, the server stamps were
 * clean (not finished, not closed), the video file, thumbnail and caption were all there.
 * So the data path was fine and the cause is state kept in his browser. Two ways that state
 * can hide a card for good are reproduced here, on the test client, in the real page:
 *
 *   1. A Finish / Close mark saved only in his browser. It never expired and ignored urgent
 *      pings, so a card whose write never landed was hidden from Waiting AND Urgent for as
 *      long as it stayed at Kasper Approval. (Cached up to 24 hours, rewritten on every save.)
 *   2. The live refresh held back by an unsent draft anywhere on the board, so a card that
 *      became urgent while his page was open never arrived.
 *
 * Fully offline: a verified admin identity, the rows the test client would return (the
 * paged read of calendar_posts answered locally), a stand-in for supabase-js whose realtime
 * callback the test fires, everything else answered empty. Nothing reaches a live backend.
 */
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };
const CACHE_KEY = 'syncview_kasper_review_cache_v1';

function row(id, over) {
  return Object.assign({
    id, client: 'sidneylaruel', name: 'Fixture ' + id, status: 'Kasper Approval',
    video_status: 'Kasper Approval', graphic_status: 'Client Approval', caption_status: 'Kasper Approval', title_status: null,
    asset_url: 'https://example.invalid/v.mp4', thumbnail_url: 'https://example.invalid/t.jpg', caption: 'A caption',
    scheduled_date: '2026-10-05', video_deliverable_id: 'del_v_' + id, graphic_deliverable_id: 'del_g_' + id,
    video_tweaks: '', graphic_tweaks: '', caption_tweaks: '', title_tweaks: '',
    video_status_at: '2026-09-30 19:38:51.555501+00', caption_status_at: '2026-09-30 19:38:52+00', updated_at: '2026-10-01T15:00:00.000Z', order_index: '1',
    kasper_finished_at: null, kasper_closed_at: null,
  }, over || {});
}
const urgent = (id, over) => row(id, Object.assign({
  kasper_urgent_pinged_at: '2026-10-01 15:26:27.11+00', kasper_urgent_comp: 'video',
  kasper_urgent_status_at: '2026-09-30 19:38:51.555501+00', kasper_urgent_by: 'Sam Staff',
}, over || {}));

// Realtime callbacks are kept by channel name; the page opens several (Kasper's calendar queue is 'kasper-cal').
const FAKE_SUPABASE = "window.__rts={};window.supabase={createClient:function(){return{channel:function(name){var ch={on:function(t,f,cb){window.__rts[name]=cb;return ch;},subscribe:function(){return ch;}};return ch;},removeChannel:function(){}};}};";

async function openBoard(browser, server, { rows, seedCache }) {
  const state = { rows };
  const context = await browser.newContext();
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/supabase-js/.test(url)) return route.fulfill({ status: 200, contentType: 'application/javascript', headers: cors, body: FAKE_SUPABASE });
    if (/\/rest\/v1\/calendar_posts\?/.test(url) && !/id\.gt\./.test(url)) {
      const body = /client=eq\./.test(url) && !/client=eq\.sidneylaruel/.test(url) ? [] : state.rows;
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    }
    const empty = /\/rest\/v1\//.test(url) ? '[]' : '{}';
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: empty });
  });
  await seedStaffIdentity(context, ADMIN);
  await context.route('**/functions/v1/key-verify', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
  });
  if (seedCache) {
    await context.addInitScript(([key, cache]) => {
      try { cache.savedAt = Date.now(); localStorage.setItem(key, JSON.stringify(cache)); } catch (e) {}
    }, [CACHE_KEY, seedCache]);
  }
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/?Kasper=1#kasper`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#kasperReviewBody .kcard, #kasperReviewBody .kasper-empty', { timeout: 20000 });
  return { context, page, state };
}
// A card is expected, so wait for it (the first paint can be the saved copy, before the read lands).
const eventually = (page, sel, id) => page.waitForFunction(([s, i]) => !!document.querySelector(s + '[data-kasper-pid="' + i + '"]'), [sel, id], { timeout: 12000 }).then(() => true, () => false);
const onBoard = (page, id) => eventually(page, '.kcard', id);
const inUrgent = (page, id) => eventually(page, '#kasperUrgentWrap .kcard', id);
const emptyCache = extra => Object.assign({ items: [], history: [], dismissed: {}, closed: {}, smmByClient: [], sxrRepairs: [] }, extra || {});

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  const results = [];
  const record = (label, ok, note) => { results.push({ label, ok, note }); console.log((ok ? 'ok  ' : 'FAIL') + ' - ' + label + (note ? ' (' + note + ')' : '')); };
  try {
    /* Control: nothing hidden, an urgent card at Kasper Approval is shown in Urgent. */
    {
      const { context, page } = await openBoard(browser, server, { rows: [urgent('p_urgent_ctrl')] });
      record('control: an urgent card at Kasper Approval is in the Urgent section', await inUrgent(page, 'p_urgent_ctrl'));
      await context.close();
    }
    /* 1a. A Close mark saved only in his browser (older versions stored `true`). */
    {
      const { context, page } = await openBoard(browser, server, { rows: [urgent('p_urgent_closed')], seedCache: emptyCache({ closed: { p_urgent_closed: true } }) });
      record('a leftover browser-only Close mark does not hide an urgent card at Kasper Approval', await inUrgent(page, 'p_urgent_closed'));
      await context.close();
    }
    /* 1b. A Finish mark saved only in his browser. */
    {
      const { context, page } = await openBoard(browser, server, { rows: [urgent('p_urgent_done')], seedCache: emptyCache({ dismissed: { p_urgent_done: true } }) });
      record('a leftover browser-only Finish mark does not hide an urgent card at Kasper Approval', await inUrgent(page, 'p_urgent_done'));
      await context.close();
    }
    /* 1c. The same marks hide a NON-urgent card that is merely waiting: after the window it must show too. */
    {
      const { context, page } = await openBoard(browser, server, { rows: [row('p_wait_closed')], seedCache: emptyCache({ closed: { p_wait_closed: true }, dismissed: { p_wait_closed: true } }) });
      record('a leftover browser-only mark does not hide a waiting card either', await onBoard(page, 'p_wait_closed'));
      await context.close();
    }
    /* 3. A refused decision's alert survives a reload (Codex P2, PR 1916). */
    {
      const alert = { pid: 'p_alert_1', name: 'Fixture p_alert_1', client: 'Test Client', kind: 'conflict', text: 'Not saved: someone else changed this card after your screen loaded.', at: Date.now() };
      const { context, page } = await openBoard(browser, server, { rows: [row('p_alert_1')], seedCache: emptyCache({ saveAlerts: { p_alert_1: alert } }) });
      const shown = await page.waitForFunction(() => !!document.querySelector('[data-kasper-alerts]'), null, { timeout: 12000 }).then(() => true, () => false);
      record('an unsaved-change alert is still on screen after a reload', shown);
      await context.close();
    }
    /* 2a. Control for 2: with NO draft anywhere the same realtime refresh brings the card in (so the
          failure below is the draft, not the harness). */
    {
      const { context, page, state } = await openBoard(browser, server, { rows: [row('p_nodraft_a')] });
      await page.waitForFunction(() => typeof (window.__rts && window.__rts['kasper-cal']) === 'function', null, { timeout: 15000 });
      state.rows = [row('p_nodraft_a'), urgent('p_nodraft_b')];
      await page.evaluate(() => window.__rts['kasper-cal']({}));
      record('control: with no draft, a card that turns urgent arrives', await page.waitForFunction(() => !!document.querySelector('#kasperUrgentWrap .kcard[data-kasper-pid="p_nodraft_b"]'), null, { timeout: 12000 }).then(() => true, () => false));
      await context.close();
    }
    /* 2. An unsent draft must not freeze the live refresh. */
    {
      const { context, page, state } = await openBoard(browser, server, { rows: [row('p_draft_a')] });
      await page.click('.kcard[data-kasper-pid="p_draft_a"] .kcard-strip');
      await page.waitForSelector('.kcard[data-kasper-pid="p_draft_a"] .cal-review-textarea');
      await page.fill('.kcard[data-kasper-pid="p_draft_a"] .cal-review-textarea', 'a note I have not sent yet');
      await page.click('.kasper-fresh', { timeout: 3000 }).catch(() => page.mouse.click(5, 5));   // leave the box: the draft stays, the focus goes
      await page.waitForFunction(() => typeof (window.__rts && window.__rts['kasper-cal']) === 'function', null, { timeout: 15000 });
      // Two cards become urgent while the page is open; the realtime channel tells the page.
      state.rows = [row('p_draft_a'), urgent('p_draft_b'), urgent('p_draft_c')];
      await page.evaluate(() => window.__rts['kasper-cal']({}));
      const arrived = await page.waitForFunction(() => !!document.querySelector('#kasperUrgentWrap .kcard[data-kasper-pid="p_draft_b"]') && !!document.querySelector('#kasperUrgentWrap .kcard[data-kasper-pid="p_draft_c"]'), null, { timeout: 12000 }).then(() => true, () => false);
      record('with an unsent draft on the board, cards that turn urgent still arrive', arrived);
      const draftKept = await page.evaluate(() => { const ta = document.querySelector('.kcard[data-kasper-pid="p_draft_a"] .cal-review-textarea'); return !!ta && ta.value === 'a note I have not sent yet'; });
      record('and the unsent draft is still in its box', draftKept);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const bad = results.filter(r => !r.ok);
  if (bad.length) { console.error('\n' + bad.length + ' check(s) failed: ' + bad.map(r => r.label).join(' | ')); process.exit(1); }
  console.log('\nkasper-board-browser: urgent cards at Kasper Approval reach his screen ✅');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
