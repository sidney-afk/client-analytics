'use strict';
/*
 * APPROVING AND ASKING FOR A CHANGE ANSWER ON SCREEN AT ONCE (owner request 2026-10-18, session Swift).
 *
 * The server is made slow (1.5 s for every save, status write and card write alike) so that nothing on screen can come
 * from a server answer. For every action, in the client link, the managers' Review tab and Kasper's Review Session, at
 * 1440 and on a 390 phone, the visible answer must be on screen within 150 ms of the click:
 *   Approve / Approve to Kasper / Approve to client / Approve after tweaks: the pressed button already says "Approved ...";
 *   Ask for a change: the box opens, and the sent change reads "Change asked" at once;
 *   a note: the words are in the conversation at once;
 *   Finish reviewing: the toast with the next step is up.
 * And the save is still honest: each action reaches the server exactly once, and a refused approval puts the part back
 * with its reason and "Try again".
 * Fails on main before this change (the pressed button read "Approve the video" with a spinner until the server answered).
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, openClient, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const LIMIT = 150, SLOW = 1500;
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

async function openMode(browser, origin, mode, width, edit) {
  const vp = { width, height: width < 500 ? 844 : 900 };
  let t;
  if (mode === 'client') t = await openClient(browser, origin, Object.assign({ flags: 'on' }, vp));
  else {
    t = await open(browser, origin, Object.assign({ stage: mode, flags: 'on', staff: STAFF }, vp));
    if (edit) edit(t.state.cards);
    if (mode === 'smm') {
      await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
      await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
      await t.page.evaluate(() => onCalViewChange('smmreview'));
    } else {
      await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
    }
  }
  await waitNew(t);
  await sleep(1200);
  await t.page.evaluate(() => {
    document.addEventListener('click', () => { window.__t0 = performance.now(); }, true);
    window.__arm = src => {
      window.__ans = null; window.__t0 = null;
      const root = document.getElementById('svReviewStage').shadowRoot, f = new Function('r', 'return (' + src + ');');
      const loop = () => { if (window.__ans !== null) return; if (window.__t0 && f(root)) { window.__ans = performance.now() - window.__t0; return; } requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    };
  });
  return t;
}
// Arm the check, click, and read how long the visible answer took (-1: never within a second).
async function timed(t, label, clickFn, condSrc) {
  await t.page.evaluate(src => window.__arm(src), condSrc);
  await clickFn();
  const ms = await t.page.evaluate(() => new Promise(res => { const t1 = performance.now(); const w = () => window.__ans !== null ? res(window.__ans) : performance.now() - t1 > 1000 ? res(-1) : setTimeout(w, 5); w(); }));
  expect(ms >= 0 && ms <= LIMIT, label + ': answered on screen in ' + (ms < 0 ? 'never' : Math.round(ms) + ' ms') + ' (limit ' + LIMIT + ' ms)');
  return ms;
}
const step = (t, k) => inS(t.page, '.stp[data-step="' + k + '"]').click().then(() => sleep(450));
const quiet = t => t.page.waitForFunction(() => !Object.values((typeof _calReviewState === 'object' && _calReviewState.saving) || {}).some(Boolean), null, { timeout: 15000 });

async function run(browser, origin, mode, width) {
  const tag = mode + ' ' + width + ': ';
  console.log('--- ' + tag.trim() + ' ---');
  const t = await openMode(browser, origin, mode, width);
  t.state.writeDelay = SLOW; t.state.gatewayDelay = SLOW;
  const sendId = mode === 'client' ? '#cmtBtn' : '#sendBtn';
  const lbl = k => "(r.querySelector('[data-ok=\"" + k + "\"]')||{textContent:''}).textContent";
  // Approve (to Kasper for the SMM). Kasper's own stage steps on at once, so his answer is the next part on stage.
  await timed(t, tag + 'approve the video', () => inS(t.page, '[data-ok="video"]').click(), mode === 'kasper' ? "!r.querySelector('[data-ok=\"video\"]') || " + lbl('video') + ".indexOf('Approved')===0" : lbl('video') + ".indexOf('Approved')===0");
  if (mode === 'client') {
    await step(t, 'graphic');
    await timed(t, tag + 'ask for a change opens the box', () => inS(t.page, '[data-chg="graphic"]').click(), "!!r.getElementById('ta')");
    await inS(t.page, '#ta').fill('Please make the title bigger.');
    await timed(t, tag + 'send the change', () => inS(t.page, '#sendBtn').click(), "/Change asked/.test((r.getElementById('drow')||{}).textContent||'')");
  } else if (mode === 'smm') {
    await step(t, 'graphic');
    await inS(t.page, '[data-menu="graphic"]').click();
    await timed(t, tag + 'approve to the client', () => inS(t.page, '[data-alt]').first().click(), lbl('graphic') + ".indexOf('Approved to client')===0");
    await step(t, 'caption');
    await timed(t, tag + 'ask for a change opens the box', () => inS(t.page, '[data-chg="caption"]').click(), "!!r.getElementById('ta')");
    await inS(t.page, '#ta').fill('Shorten the caption.');
    await timed(t, tag + 'send the change', () => inS(t.page, '#sendBtn').click(), "/Change asked/.test((r.getElementById('drow')||{}).textContent||'')");
  } else {
    await step(t, 'caption');
    await inS(t.page, '[data-menu="caption"]').click();
    await timed(t, tag + 'approve after tweaks opens the box', () => inS(t.page, '[data-alt]').first().click(), "!!r.getElementById('ta')");
    await inS(t.page, '#ta').fill('Shorten the caption.');
    await timed(t, tag + 'send approve after tweaks', () => inS(t.page, '#sendBtn').click(), "/Approved after tweaks/.test((r.getElementById('drow')||{}).textContent||'') || !r.querySelector('[data-ok=\"caption\"]')");
  }
  await step(t, 'video');
  await inS(t.page, '#chat #ta').fill('Thanks, looks good to me.');
  await timed(t, tag + 'send a note', () => mode === 'kasper' ? ((inS(t.page, '#chat #noteBtn').count()).then(n => n ? inS(t.page, '#chat #noteBtn').click() : t.page.keyboard.press('Enter'))) : inS(t.page, '#chat ' + sendId).click(), "(r.getElementById('chat')||{textContent:''}).textContent.indexOf('Thanks, looks good to me.')>=0");
  // Kasper's Finish is not timed here: once he has answered every part the card leaves his lists (his dismiss is local first).
  if (mode === 'kasper') { expect(t.errors.length === 0, tag + 'no page errors (' + t.errors.join(' | ') + ')'); await t.ctx.close(); return; }
  if (mode === 'client') {
    // the last part, then Finish reviewing (it waits for the saves, by design: wait for them first)
    t.state.writeDelay = 0; t.state.gatewayDelay = 0;
    await quiet(t).catch(() => {}); await sleep(600);
    await step(t, 'caption');
    await inS(t.page, '[data-ok="caption"]').click();
    await quiet(t).catch(() => {}); await sleep(900);
  } else {
    // Finish is on once every part has an answer; let the slow saves end first so only the click is timed
    t.state.writeDelay = 0; t.state.gatewayDelay = 0;
    await t.page.waitForFunction(() => { const b = document.getElementById('svReviewStage').shadowRoot.getElementById('finishBtn'); return b && !b.disabled; }, null, { timeout: 20000 });
  }
  t.state.writeDelay = SLOW; t.state.gatewayDelay = SLOW;
  await timed(t, tag + 'finish reviewing', () => inS(t.page, '#finishBtn').click(), "!!(r.getElementById('rsToast') && r.getElementById('rsToast').classList.contains('on'))");
  expect(t.errors.length === 0, tag + 'no page errors (' + t.errors.join(' | ') + ')');
  await t.ctx.close();
}

async function refused(browser, origin, mode) {
  const tag = mode + ' refused: ';
  console.log('--- ' + tag.trim() + ' ---');
  const t = await openMode(browser, origin, mode, 1440);
  t.state.writeFail = mode === 'kasper' ? 1 : 3;   // the status write and the card write are both refused
  await inS(t.page, '[data-ok="video"]').click();
  const text0 = await inS(t.page, '[data-ok="video"]').textContent();
  expect(/^Approved/.test(text0), tag + 'the click is answered first (' + text0 + ')');
  let n = 0; while (n++ < 60 && !(await inS(t.page, '[data-retry="video"]').count())) await sleep(100);
  expect(await inS(t.page, '[data-retry="video"]').count() > 0, tag + 'a refused save puts the part back with its reason and Try again');
  expect(await inS(t.page, '[data-ok="video"]').count() > 0 || await inS(t.page, '[data-retry="video"]').count() > 0, tag + 'nothing is lost');
  await t.ctx.close();
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) for (const mode of ['client', 'smm', 'kasper']) await run(browser, origin, mode, width);
    for (const mode of ['smm']) await refused(browser, origin, mode);
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview stage instant answers: all passed');
})().catch(e => { console.error(e); process.exit(1); });
