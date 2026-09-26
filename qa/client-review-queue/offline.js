'use strict';
// Live dropped-connection check for the client review send queue (185).
// Test client only (the courier lib pins it); seeds p_crq_* cards and archives them.
// Exits non-zero if any check fails.
// Run: SYNCVIEW_STAFF_KEY=... node qa/client-review-queue/offline.js
const { H, server } = require('./common.js');
const TS = Date.now();
const seeds = [];
const results = [];
const check = (ok, name, detail) => { results.push({ ok: !!ok, name }); console.log((ok ? '✓ ' : '✗ ') + name + (detail != null ? '  [' + String(detail).slice(0, 160) + ']' : '')); };
const mk = tag => { const s = { id: 'p_crq_' + tag + '_' + TS, name: 'CRQ ' + tag + ' ' + TS }; seeds.push(s); return s; };
const seed = s => H.upCal({ id: s.id, name: s.name, platforms: 'youtube', scheduled_date: new Date(Date.now() + 86400e3).toISOString().slice(0, 10), video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval', caption: 'Queue test caption', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', asset_url: 'https://example.com/q.mp4' });
const row = id => (H.rowCal(id, 'caption_status,caption_tweaks') || {});
async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return Date.now() - t; } catch {} await H.sleep(500); } return null; }
const toast = p => p.evaluate(() => { const t = document.querySelector('.sv-toast'); return t ? t.innerText : ''; });
const notify = p => p.evaluate(() => { const o = document.getElementById('confirmOverlay'); return o && o.classList.contains('active') ? document.getElementById('confirmTitle').textContent : ''; });
const cardOn = (p, n) => p.evaluate(n => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), n);
const queue = p => p.evaluate(() => localStorage.getItem('sv-client-review-queue-v1') || '{}');
async function open(b) {
  const C = await H.clientCal(b); C._mode = '';
  await C.route(/supabase\.co|n8n\.cloud/, r => {
    const u = r.request().url();
    if (C._mode === 'off') return r.abort('internetdisconnected');
    if (C._mode === 'upsertdown' && /calendar-upsert/.test(u)) return r.abort('internetdisconnected');
    if (C._mode === 'refuse' && /calendar-upsert/.test(u) && r.request().method() === 'POST') return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"code":"forbidden","error":"forbidden"}' });
    return r.fallback();
  });
  await C.waitForFunction(() => !!document.querySelector('.cal-review-card'), null, { timeout: 40000 });
  return C;
}
(async () => {
  const srv = server(); await H.sleep(1500);
  const A = mk('online'), B = mk('offapp'), R = mk('offreq'), L = mk('reload'), F = mk('refuse'), D = mk('twodev');
  const b = await H.launch();
  try {
    for (const s of seeds) seed(s);
    for (const s of seeds) await H.pollRow(() => H.rowCal(s.id, 'id'), r => !!r.id, 35000);
    const C = await open(b);

    // 1. Online approve: "Sending..." then "Approved", saved.
    await H.clientAct(C, A.name, 'caption', 'approve');
    await H.sleep(150);
    check(await toast(C) === 'Sending...', 'online approve shows "Sending..."');
    const ms1 = await until(() => row(A.id).caption_status === 'Approved', 30000);
    check(ms1 != null, 'online approve saved', ms1 + ' ms');
    await H.sleep(800);
    check(await toast(C) === 'Approved', 'online approve then shows "Approved"');

    // 2 + 3. Approve and request changes with the connection dropped.
    await H.expandReview(C, B.name); C._mode = 'off'; await C.context().setOffline(true);
    await H.clientAct(C, B.name, 'caption', 'approve');
    await H.sleep(4000);
    check(/waiting for your connection/.test(await toast(C)), 'offline approve shows it is waiting to send');
    check(await notify(C) === '', 'offline approve shows no error');
    check((await queue(C)).includes(B.id) && row(B.id).caption_status === 'Client Approval', 'offline approve is held in the browser, not yet saved');
    await H.clientAct(C, R.name, 'caption', 'request', 'Queue test change ' + TS);
    await H.sleep(4000);
    check((await queue(C)).includes(R.id), 'offline change request is held in the browser');
    C._mode = ''; await C.context().setOffline(false);
    const ms2 = await until(() => row(B.id).caption_status === 'Approved', 60000);
    check(ms2 != null, 'held approve lands after reconnect', ms2 + ' ms');
    const ms3 = await until(() => { const r = row(R.id); return r.caption_status === 'Tweaks Needed' && String(r.caption_tweaks || '').includes('Queue test change ' + TS); }, 60000);
    check(ms3 != null, 'held change request lands after reconnect', ms3 + ' ms');
    const copies = (String(row(R.id).caption_tweaks || '').match(new RegExp('Queue test change ' + TS, 'g')) || []).length;
    check(copies === 1, 'the change request is saved exactly once', copies + ' copies');
    await H.sleep(1500);
    check(await queue(C) === '{}', 'queue is empty after both land');

    // 4. Save path down, page closed and reopened: sent after the reload.
    await H.expandReview(C, L.name); C._mode = 'upsertdown';
    await H.clientAct(C, L.name, 'caption', 'approve'); await H.sleep(4000);
    check((await queue(C)).includes(L.id), 'approve held while the save path is down');
    const ctx = C.context(); const url = C.url(); await C.close();
    const C2 = await ctx.newPage(); await C2.goto(url);
    const ms4 = await until(() => row(L.id).caption_status === 'Approved', 90000);
    check(ms4 != null, 'held approve is sent after the page is reopened', ms4 + ' ms');
    await H.sleep(1500);
    check(await queue(C2) === '{}', 'queue is empty after the reload send');

    // 5. Server refusal: not retried, card back, plain message.
    await C2.waitForFunction(() => !!document.querySelector('.cal-review-card'), null, { timeout: 30000 });
    await C2.route(/calendar-upsert/, r => r.request().method() === 'POST' ? r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"code":"forbidden","error":"forbidden"}' }) : r.fallback());
    await H.clientAct(C2, F.name, 'caption', 'approve'); await H.sleep(5000);
    check(/was not saved/.test(await notify(C2)), 'refused approve: plain "not saved" message');
    check(await cardOn(C2, F.name), 'refused approve: the card is back on screen');
    check(row(F.id).caption_status === 'Client Approval' && await queue(C2) === '{}', 'refused approve: nothing saved, nothing queued');
    await C2.close();

    // 6. Two devices: approve held on A, change request on B, A reconnects. B must win.
    const DA = await open(b);
    const DB = await open(b);   // a separate browser profile, its own storage
    await H.expandReview(DA, D.name); DA._mode = 'upsertdown';
    await H.clientAct(DA, D.name, 'caption', 'approve'); await H.sleep(4000);
    check((await queue(DA)).includes(D.id), 'two devices: approve held on device A');
    await H.clientAct(DB, D.name, 'caption', 'request', 'Two device change ' + TS);
    const ms6 = await until(() => row(D.id).caption_status === 'Tweaks Needed', 30000);
    check(ms6 != null, 'two devices: change request saved from device B', ms6 + ' ms');
    DA._mode = '';
    await DA.evaluate(() => window.dispatchEvent(new Event('online')));
    await H.sleep(8000);
    check(row(D.id).caption_status === 'Tweaks Needed', 'two devices: the change request wins after A reconnects', row(D.id).caption_status);
    check(await queue(DA) === '{}', 'two devices: A drops its held approve');
    check(/changed while your approval was waiting/.test(await notify(DA)), 'two devices: A is told its approval was not saved');
    check(H.appErrs(DA).length === 0, 'no page errors', H.appErrs(DA).length);
  } catch (e) {
    check(false, 'harness ran to the end', e && e.message);
  } finally {
    const bad = seeds.filter(s => !H.archiveCalSafe(s.id)).map(s => s.id);
    check(bad.length === 0, 'all ' + seeds.length + ' seed cards archived', bad.length + ' left');
    await b.close(); srv.kill();
    const failedN = results.filter(r => !r.ok).length;
    console.log(failedN ? failedN + ' of ' + results.length + ' checks FAILED' : 'all ' + results.length + ' checks passed');
    process.exit(failedN ? 1 : 0);
  }
})();
