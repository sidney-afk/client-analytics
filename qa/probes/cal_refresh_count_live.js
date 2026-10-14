// cal_refresh_count_live.js -- how many background refreshes does the Calendar
// run, and what starts each one? Read-only, test client only.
//
// Opens the staff Calendar on the test client against the live backend (the
// same courier harness the other probes use: this checkout's index.html, live
// data), then counts, for each of these moments:
//   - a browser tab switch (another tab in front, then back),
//   - a longer absence (half a minute away, then back),
//   - going to another SyncView tab and back to the Calendar,
//   - a minute sitting idle,
// three things: the board reads that went out, the Calendar loads that ran
// (with what started each one), and the repaints of the board.
// A repaint that rebuilt cards is what the owner sees as "a refresh".
//
// Usage (static server on :8000, as for every courier probe):
//   node qa/probes/cal_refresh_count_live.js
'use strict';
const H = require('../sxr_courier_lib.js');

const SLUG = 'sidneylaruel';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function instrument() {
  if (window.__rc) return;
  const rc = window.__rc = { loads: [], renders: [], cardSwaps: [], events: [], at: () => Math.round(performance.now()) };
  // What called it, in a few function names (no paths, no data).
  const why = () => (new Error().stack || '').split('\n').slice(3, 8)
    .map(s => (s.trim().match(/^at (?:async )?([\w$.]+)/) || [])[1]).filter(Boolean).join(' < ');
  const wrap = (name, bucket) => {
    const f = window[name];
    if (typeof f !== 'function') return;
    window[name] = function (...a) {
      const o = a[0] && typeof a[0] === 'object' ? Object.keys(a[0]).filter(k => a[0][k]).join(',') : '';
      rc[bucket].push({ t: rc.at(), opts: o, why: why() });
      return f.apply(this, a);
    };
  };
  wrap('loadCalendarPosts', 'loads');
  wrap('_calRenderBody', 'renders');
  // Who sends a Calendar save, and which fields (names only).
  rc.saves = [];
  const of = window.fetch;
  window.fetch = function (u, init) {
    if (String(u).includes('calendar-upsert')) {
      let keys = '';
      try { const b = JSON.parse(init && init.body || '{}'); const row = b.row || b.post || b.patch || b; keys = Object.keys(row).filter(k => !/^(id|client|slug)$/.test(k)).slice(0, 12).join('/'); } catch (e) {}
      rc.saves.push(rc.at() + ' fields=' + keys + ' from ' + (new Error().stack || '').split('\n').slice(2, 9).map(s => (s.trim().match(/^at (?:async )?([\w$.]+)/) || [])[1]).filter(Boolean).join(' < '));
    }
    return of.apply(this, arguments);
  };
  // Each realtime delivery (or catch-up / fallback pull), with the card and its changed columns.
  rc.rt = [];
  const rtf = window._calV2OnRealtimeChange;
  window._calV2OnRealtimeChange = function (slug, lease, payload) {
    const n = payload && payload.new || {}, o = payload && payload.old || {};
    const cols = Object.keys(n).filter(k => JSON.stringify(n[k]) !== JSON.stringify(o[k]) && k in o);
    rc.rt.push(rc.at() + ' ' + (payload ? (payload.eventType + ' ' + String(n.id || o.id || '').slice(0, 24) + (cols.length ? ' cols=' + cols.join('/') : ' keys=' + Object.keys(n).length)) : 'catch-up/fallback') + ' via ' + why());
    return rtf.apply(this, arguments);
  };
  ['visibilitychange', 'pageshow'].forEach(ev => document.addEventListener(ev, () => rc.events.push(rc.at() + ' ' + ev + ':' + document.visibilityState), true));
  ['focus', 'blur', 'pageshow'].forEach(ev => window.addEventListener(ev, e => { if (e.target === window) rc.events.push(rc.at() + ' ' + ev); }, true));
  // A card node added or removed anywhere in the Calendar = the board was rebuilt there.
  const CARD = '.cal-card,.kcard,.cal-month-cell,.cal-week-col,[data-pid],[data-cal-review-pid]';
  new MutationObserver(list => {
    let n = 0;
    for (const m of list) for (const node of [...m.addedNodes, ...m.removedNodes]) {
      if (node.nodeType === 1 && (node.matches(CARD) || node.querySelector(CARD))) n++;
    }
    if (n) rc.cardSwaps.push({ t: rc.at(), n });
  }).observe(document.body, { childList: true, subtree: true });
}

function snapshot(page) {
  return page.evaluate(() => {
    const rc = window.__rc;
    const out = { saves: rc.saves.splice(0), rt: rc.rt.slice(), loads: rc.loads.slice(), renders: rc.renders.slice(), cardSwaps: rc.cardSwaps.slice(), events: rc.events.slice() };
    rc.rt.length = 0; rc.loads.length = 0; rc.renders.length = 0; rc.cardSwaps.length = 0; rc.events.length = 0;
    return out;
  });
}

// Card swaps closer than 400 ms apart belong to one visible refresh.
function visibleRefreshes(swaps) {
  let n = 0, last = -1e9;
  for (const s of swaps) { if (s.t - last > 400) n++; last = s.t; }
  return n;
}

async function measure(page, net, label, act) {
  await snapshot(page);
  const reads0 = net.reads;
  await act();
  const s = await snapshot(page);
  const row = { label, reads: net.reads - reads0, loads: s.loads.length, renders: s.renders.length, visible: visibleRefreshes(s.cardSwaps) };
  console.log('\n## ' + label);
  console.log('  board reads: ' + row.reads + ' | Calendar loads: ' + row.loads + ' | board repaints: ' + row.renders + ' | visible refreshes (cards rebuilt): ' + row.visible);
  console.log('  events: ' + (s.events.join(', ') || 'none'));
  s.saves.forEach(x => console.log('  save ' + x));
  s.rt.forEach(x => console.log('  realtime ' + x));
  (net.writes.splice(0)).forEach(w => console.log('  write ' + w));
  s.loads.forEach(l => console.log('  load @' + l.t + ' [' + l.opts + '] from ' + l.why));
  s.renders.forEach(r => console.log('  repaint @' + r.t + ' [' + r.opts + '] from ' + r.why));
  return row;
}

(async () => {
  const browser = await H.launch();
  const page = await H.smmCal(browser, SLUG);
  const net = { reads: 0, writes: [] };
  page.on('request', r => { if (r.method() !== 'GET' && r.method() !== 'OPTIONS' && /supabase\.co/.test(r.url())) net.writes.push(r.method() + ' ' + r.url().replace(/^https:\/\/[^/]+/, '').split('?')[0]); });
  page.on('request', r => { if (r.method() === 'GET' && /\/rest\/v1\/calendar_posts\?/.test(r.url()) && r.url().includes('client=eq.' + SLUG)) net.reads++; });
  if (process.env.RC_DEBUG) page.on('response', async r => { if (r.url().includes('calendar-upsert') && r.request().method() === 'POST') { try { const j = await r.json(); console.log('  upsert answer: ok=' + j.ok + ' keys=' + Object.keys(j).join('/') + ' ' + JSON.stringify(j).replace(/https?:[^"]+/g, 'URL').slice(0, 300)); } catch (e) {} } });
  await page.waitForFunction(() => calState && calState.posts && calState.posts.length > 0, null, { timeout: 30000 });
  await page.evaluate(instrument);
  await sleep(6000);
  const rows = [];
  const ctx = page.context();
  const other = await ctx.newPage();
  await other.goto('about:blank');

  // Headless Chromium does not hide a tab that loses the front, so a switch
  // is played the way a real browser plays it: hidden + blur, then visible + focus.
  const away = async (ms) => {
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
    });
    await other.bringToFront();
    await sleep(ms);
    await page.bringToFront();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
  };

  rows.push(await measure(page, net, 'browser tab switch (5 s away)', async () => { await away(5000); await sleep(9000); }));
  rows.push(await measure(page, net, 'browser tab switch (35 s away)', async () => { await away(35000); await sleep(9000); }));
  rows.push(await measure(page, net, 'second quick tab switch right after', async () => { await away(1500); await sleep(9000); }));
  rows.push(await measure(page, net, 'SyncView tab and back to the Calendar', async () => {
    await page.evaluate(() => navTo('today'));
    await sleep(3000);
    await page.evaluate(() => navTo('calendar'));
    await sleep(9000);
  }));
  rows.push(await measure(page, net, 'SyncView tab and back to the Calendar, again', async () => {
    await page.evaluate(() => navTo('today'));
    await sleep(3000);
    await page.evaluate(() => navTo('calendar'));
    await sleep(9000);
  }));
  rows.push(await measure(page, net, 'Calendar view tab switch (Sheet -> Month -> Sheet)', async () => {
    await page.evaluate(() => { const b = document.querySelector('[data-cal-view="month"], .cal-view-btn[data-view="month"]'); if (b) b.click(); });
    await sleep(2500);
    await page.evaluate(() => { const b = document.querySelector('[data-cal-view="organizer"], .cal-view-btn[data-view="organizer"]'); if (b) b.click(); });
    await sleep(6000);
  }));
  rows.push(await measure(page, net, 'sitting idle for 65 s', async () => { await sleep(65000); }));
  console.log('cards still missing a link the deliverable has: ' + JSON.stringify(await page.evaluate(() => calState.posts.filter(p => ['video', 'graphic'].some(c => !String(p[c === 'video' ? 'linear_issue_id' : 'graphic_linear_issue_id'] || '').trim() && _writeUiNativeId(p, c))).map(p => p.id.slice(0, 24) + ' v=' + !!p.linear_issue_id + ' g=' + !!p.graphic_linear_issue_id))));
  const rt = await page.evaluate(() => typeof _calV2RtState !== 'undefined' ? _calV2RtState : '?');
  console.log('\nrealtime state at the end: ' + rt);
  console.log('\nSUMMARY');
  rows.forEach(r => console.log('  ' + r.label.padEnd(52) + ' reads ' + r.reads + ', loads ' + r.loads + ', repaints ' + r.renders + ', visible refreshes ' + r.visible));
  const errs = H.appErrs(page);
  if (errs.length) console.log('app errors: ' + errs.length);
  await browser.close();
})().catch(e => { console.error('cal_refresh_count_live: FAIL ' + (e && e.message)); process.exit(1); });
