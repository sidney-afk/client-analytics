// _kasper_handlers.js — exercises the NEW samples-Kasper handlers that no
// scenario verb covers: Close (X), Finish reviewing (tweak hand-off), and the
// clean Approve → Approved-history path. Drives the real buttons in a real
// headless Kasper page against the LIVE backend and asserts the DB + queue.
const L = require('../sxr_courier_lib.js');
const { launch, kasper, up, supa, poll, archiveSafe } = L;

const TS = Date.now();
const sleep = (p, ms) => p.waitForTimeout(ms);
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  OK  ' + m); } else { fail++; console.log('  ✗   ' + m + (extra ? '  [' + extra + ']' : '')); } };

function row(id, cols) { const r = supa('id=eq.' + id + '&select=' + (cols || '*')); return (Array.isArray(r) && r[0]) || null; }
async function waitCol(id, col, pred, ms = 14000) { const t = Date.now(); while (Date.now() - t < ms) { const r = row(id, col); if (r && pred(r[col])) return r[col]; await new Promise(s => setTimeout(s, 500)); } return (row(id, col) || {})[col]; }

async function gotoSamples(page, name) {
  await page.evaluate(() => { const b = document.querySelector('.kasper-subtab[data-kasper-tab="samples"]'); if (b) b.click(); if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); });
  await page.waitForFunction((n) => [...document.querySelectorAll('#kasperContent [data-sxr-kasper-pid]')].some(c => (((c.querySelector('.kcard-title') || {}).textContent) || '').trim() === n), name, { timeout: 15000 }).catch(() => {});
}
const inWaiting = (page, name) => page.evaluate((n) => { const w = document.getElementById('sxrKasperWaitingWrap'); if (!w) return false; return [...w.querySelectorAll('[data-sxr-kasper-pid]')].some(c => (((c.querySelector('.kcard-title') || {}).textContent) || '').trim() === n); }, name);
const inTweaksPending = (page, name) => page.evaluate((n) => { const w = document.getElementById('sxrKasperTweaksWrap'); if (!w) return false; return [...w.querySelectorAll('[data-sxr-kasper-pid]')].some(c => (((c.querySelector('.kcard-title') || {}).textContent) || '').trim() === n); }, name);
const anywhere = (page, name) => page.evaluate((n) => [...document.querySelectorAll('#kasperContent [data-sxr-kasper-pid]')].some(c => (((c.querySelector('.kcard-title') || {}).textContent) || '').trim() === n), name);
async function expand(page, name) { await page.evaluate((n) => { const c = [...document.querySelectorAll('#kasperContent [data-sxr-kasper-pid]')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === n); if (c && !c.querySelector('.cal-review-panel')) (c.querySelector('.kcard-strip') || c).click(); }, name); await sleep(page, 500); }

async function main() {
  const browser = await launch();
  const ids = [];
  try {
    const page = await kasper(browser);

    // ── Test 1: Close (X) ──────────────────────────────────────────────
    const id1 = 'sr_kh_close_' + TS, n1 = 'KH close ' + TS; ids.push(id1);
    up({ id: id1, name: n1, order_index: 1, asset_url: 'https://frame.io/x/' + id1, thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' });
    await poll(() => row(id1, 'id'), 12000, 600);
    await gotoSamples(page, n1);
    ok(await anywhere(page, n1), 'close: card present before X');
    await page.evaluate((n) => { const c = [...document.querySelectorAll('#kasperContent [data-sxr-kasper-pid]')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === n); const b = c && c.querySelector('.kcard-close-btn'); if (b) b.click(); }, n1);
    await sleep(page, 1500);
    ok(!(await anywhere(page, n1)), 'close: card removed from the queue after X');
    const closedAt = await waitCol(id1, 'kasper_closed_at', v => !!v);
    ok(!!closedAt, 'close: kasper_closed_at stamped in DB', 'got ' + closedAt);

    // ── Test 2: Request change → Finish reviewing → Tweaks pending ──────
    const id2 = 'sr_kh_finish_' + TS, n2 = 'KH finish ' + TS; ids.push(id2);
    up({ id: id2, name: n2, order_index: 1, asset_url: 'https://frame.io/x/' + id2, thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' });
    await poll(() => row(id2, 'id'), 12000, 600);
    await gotoSamples(page, n2);
    await expand(page, n2);
    // request a change on the video (sets a draft + clicks Request change)
    await page.evaluate((n) => { const c = [...document.querySelectorAll('#kasperContent [data-sxr-kasper-pid]')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === n); const p = c && c.querySelector('.cal-review-panel[data-sxr-kasper-comp="video"]'); const ta = p && p.querySelector('.cal-review-textarea'); if (ta) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, 'Trim the intro'); ta.dispatchEvent(new Event('input', { bubbles: true })); } }, n2);
    await sleep(page, 250);
    await page.evaluate((n) => { const c = [...document.querySelectorAll('#kasperContent [data-sxr-kasper-pid]')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === n); const p = c && c.querySelector('.cal-review-panel[data-sxr-kasper-comp="video"]'); const b = p && p.querySelector('.cal-review-tweak-btn'); if (b && !b.disabled) b.click(); }, n2);
    ok((await waitCol(id2, 'video_status', v => v === 'Tweaks Needed')) === 'Tweaks Needed', 'finish: request set video → Tweaks Needed');
    await sleep(page, 800);
    // the Finish reviewing button should now be enabled (the only comp is decided)
    const finishEnabled = await page.evaluate((n) => { const c = [...document.querySelectorAll('#kasperContent [data-sxr-kasper-pid]')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === n); const b = c && c.querySelector('.kcard-done-btn'); return !!(b && !b.disabled); }, n2);
    ok(finishEnabled, 'finish: "Finish reviewing" enabled after the decision');
    await page.evaluate((n) => { const c = [...document.querySelectorAll('#kasperContent [data-sxr-kasper-pid]')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === n); const b = c && c.querySelector('.kcard-done-btn'); if (b && !b.disabled) b.click(); }, n2);
    const finishedAt = await waitCol(id2, 'kasper_finished_at', v => !!v);
    ok(!!finishedAt, 'finish: kasper_finished_at stamped in DB', 'got ' + finishedAt);
    await sleep(page, 800);
    ok(await inTweaksPending(page, n2), 'finish: card moved to the "Tweaks pending" partition');
    ok(!(await inWaiting(page, n2)), 'finish: card left the "Waiting" partition');

    // ── Test 3: clean Approve → Approved history ───────────────────────
    const id3 = 'sr_kh_appr_' + TS, n3 = 'KH appr ' + TS; ids.push(id3);
    up({ id: id3, name: n3, order_index: 1, asset_url: 'https://frame.io/x/' + id3, thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' });
    await poll(() => row(id3, 'id'), 12000, 600);
    await gotoSamples(page, n3);
    await expand(page, n3);
    await page.evaluate((n) => { const c = [...document.querySelectorAll('#kasperContent [data-sxr-kasper-pid]')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === n); const p = c && c.querySelector('.cal-review-panel[data-sxr-kasper-comp="video"]'); const b = p && p.querySelector('.cal-review-approve-main'); if (b && !b.disabled) b.click(); }, n3);
    ok((await waitCol(id3, 'video_status', v => v === 'Client Approval')) === 'Client Approval', 'approve: video → Client Approval in DB');
    await sleep(page, 1200);
    ok(!(await inWaiting(page, n3)), 'approve: fully-approved card left the "Waiting" partition');
    const inHistory = await page.evaluate((n) => { const w = document.getElementById('sxrKasperHistoryWrap'); return !!(w && /KH appr/.test(w.textContent) && w.textContent.includes(n)); }, n3);
    ok(inHistory, 'approve: card appears in "Approved history"');

    console.log('\n  app errors:', L.appErrs(page));
    await page.context().close();
  } catch (e) { console.error('PROBE ERROR', e && e.stack || e); fail++; }
  finally { await browser.close(); for (const id of ids) { try { archiveSafe(id); } catch {} } }
  console.log('\n' + '─'.repeat(50));
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main();
