'use strict';
/*
 * KASPER'S REVIEW SESSION WITH THE CLIENT PAGE'S POLISH (session Porch, round 3, 2026-10-25), on only for the staff
 * members unread_badges_v2 names, where his Review Session is on. Real browser, fully offline, the shared mocked backend
 * of the review-stage tests (fictional client, cards, people and conversation), in his second layout (every part at once).
 *
 * 1. Approve: the check shows at the click (the part leaves his list at once), then it settles as Approved, then Undo.
 *    A refused save takes the check back: Approve returns with the reason and Try again.
 * 2. A change request: "Sent" at once and the box stays open on the same part; a second one sent straight after also
 *    arrives, in order. A reload while the first still saves brings the waiting one back into the box, never lost.
 * 3. A note: no spinner while the save is quick (only after 1.2 s).
 * 4. Reply: under a team-only message, saved with that message as its parent, team-only, and shown under it; never on a
 *    message the client can see.
 * 5. Not on the list (unread_badges_v2 off): his page exactly as before (no check, the box closes after a change).
 * Server times are close to the live ones (edge logs of his session, 2026-10-23): permission read 40 ms, each
 * production-write 900 ms, the card write 650 ms.
 * SHOTS=<dir> writes the PR screenshots (light and dark, 1440 wide); with POLISH=0 the "before" set.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, open, inS, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.SHOTS_ONLY === '1';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

// A team-only question from the SMM to Kasper on the first card's video (what Reply answers).
function teamQuestion(t) {
  const c = t.state.cards[0], l = JSON.parse(c.video_tweaks || '[]');
  l.push({ id: 'k1', parent_id: null, author: 'Team Member', author_member_id: 'qa_other', role: 'smm', is_tweak: false, audience: 'internal', body: 'Kasper, is the new intro OK for you?', created_at: '2026-10-13T09:00:00.000Z', updated_at: '2026-10-13T09:00:00.000Z', done: false, done_at: '', done_by: '' });
  c.video_tweaks = JSON.stringify(l);
}
async function openKasper(browser, origin, o) {
  const opt = Object.assign({ stage: 'kasper', flags: 'on', staff: STAFF, layout2: true, unread: true, expectNew: true, linkedParts: true, mergeComments: true, nativeReceipts: true }, o);
  const t = await open(browser, origin, opt);
  if (opt.question) teamQuestion(t);
  await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
  await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && r.querySelectorAll('#l2g .pn').length); }, null, { timeout: 30000 });
  await sleep(1800);
  Object.assign(t.state, { authorityDelay: 40, gatewayDelay: 900, writeDelay: 650 });
  return t;
}
const R = (page, fn, arg) => page.evaluate(([src, a]) => { const r = document.getElementById('svReviewStage').shadowRoot; return (0, eval)('(' + src + ')')(r, a); }, [fn.toString(), arg]);
const notes = (row, col) => { try { return JSON.parse(String(row[col] || '[]')); } catch (e) { return []; } };
const video = '.pn-d[data-pd="video"]';

// Click Approve on the video (a hand's 100 ms press) and time the first check, the first "Approved" word and Undo.
async function timeApprove(t) {
  await R(t.page, (r) => {
    window.__m = {};
    const look = () => {
      if (!window.__t0) return;
      const d = r.querySelector('.pn-d[data-pd="video"]'), now = Math.round(performance.now() - window.__t0);
      if (!d) return;
      if (!window.__m.check && d.querySelector('.cp-ok')) window.__m.check = now;
      if (!window.__m.word && /Approved/.test(d.innerText) && !d.querySelector('.cp-morph')) window.__m.word = now;
      if (!window.__m.undo && d.querySelector('[data-undo]')) window.__m.undo = now;
    };
    new MutationObserver(look).observe(r, { subtree: true, childList: true, attributes: true, characterData: true });
    r.querySelector('.pn-d[data-pd="video"] [data-ok]').addEventListener('pointerdown', () => { window.__t0 = performance.now(); }, { capture: true });
  });
  const b = await inS(t.page, video + ' [data-ok]').first().boundingBox();
  await t.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await t.page.mouse.down(); await sleep(100); await t.page.mouse.up();
  for (let i = 0; i < 120 && !(await t.page.evaluate(() => window.__m.undo)); i++) await sleep(50);
  return t.page.evaluate(() => window.__m);
}

async function shots(browser, origin) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const polish = process.env.POLISH !== '0';
  const tag = polish ? 'after' : 'before';
  for (const dark of [false, true]) {
    const name = (n) => path.join(SHOTS, tag + '-kasper-' + n + '-1440-' + (dark ? 'dark' : 'light') + '.png');
    const t = await openKasper(browser, origin, { width: 1440, height: 900, dark, unread: polish, question: true });
    if (polish && await inS(t.page, '[data-cp-reply]').count()) {
      await inS(t.page, '[data-cp-reply]').first().click({ force: true }); await sleep(200);
      await inS(t.page, '#chat #ta').fill('Yes, the new intro works.');
      await inS(t.page, '#chat #ta').press('Enter'); await sleep(2500);
      await t.page.screenshot({ path: name('2-reply') });
    }
    await inS(t.page, video + ' [data-ok]').first().click();
    await sleep(polish ? 200 : 350);
    await t.page.screenshot({ path: name('1-approve') });
    await sleep(4000);
    await inS(t.page, '.pn-d[data-pd="graphic"] [data-chg]').first().click(); await sleep(300);
    await inS(t.page, '#ta').first().fill('Make the title a touch bigger, please.');
    await inS(t.page, '#ta').first().press('Enter'); await sleep(300);
    await t.page.screenshot({ path: name('3-change-sent') });
    await sleep(5000);
    await t.ctx.close();
  }
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    if (SHOTS) await shots(browser, origin);
    if (ONLY) return;

    console.log('--- 1. Approve: the check at the click, before and after ---');
    {
      const t0 = await openKasper(browser, origin, { unread: false });
      const before = await timeApprove(t0);
      await t0.ctx.close();
      const t = await openKasper(browser, origin, {});
      expect(await inS(t.page, '.rs.cp').count() === 1, 'on the list: his Review Session has the polish');
      const after = await timeApprove(t);
      console.log('     before: ' + JSON.stringify(before) + ', after: ' + JSON.stringify(after));
      expect(!before.check && before.word > 0 && before.word < 400, 'before: the part already read "Approved" at once (' + before.word + ' ms), with no check');
      expect(after.check > 0 && after.check < 300, 'after: the check shows at the click (' + after.check + ' ms)');
      expect(after.word > after.check && after.undo > after.word, 'then it settles as Approved, then Undo once the save lands (' + JSON.stringify(after) + ')');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- 1b. Approve: a refusal takes the check back ---');
    {
      const t = await openKasper(browser, origin, {});
      t.state.refusal = { code: 'fixture_refused', status: 409 };
      await R(t.page, (r) => { window.__ck = false; new MutationObserver(() => { if (r.querySelector('.pn-d[data-pd="video"] .cp-ok')) window.__ck = true; }).observe(r, { subtree: true, childList: true, attributes: true }); });
      await inS(t.page, video + ' [data-ok]').first().click();
      await sleep(120);
      const mid = await t.page.evaluate(() => window.__ck);
      for (let i = 0; i < 60 && !(await inS(t.page, video + ' .err').count()); i++) await sleep(50);
      const st = await R(t.page, (r) => { const d = r.querySelector('.pn-d[data-pd="video"]'); return { check: !!d.querySelector('.cp-ok'), approve: !!d.querySelector('[data-ok]'), err: (d.querySelector('.err') || {}).innerText || '' }; });
      expect(mid, 'the check showed at the click');
      expect(!st.check && st.approve && /^Not saved\./.test(st.err) && /Try again/.test(st.err), 'the refusal puts Approve back with the reason and Try again (' + JSON.stringify(st) + ')');
      await t.ctx.close();
    }

    console.log('--- 2. Two change requests in a row: "Sent" at once, the box stays open, both arrive in order ---');
    {
      const t = await openKasper(browser, origin, {});
      await inS(t.page, video + ' [data-chg]').first().click(); await sleep(300);
      await inS(t.page, '#ta').first().fill('Cut the pause after the hook.');
      await R(t.page, () => { window.__t0 = performance.now(); });
      await inS(t.page, '#ta').first().press('Enter');
      await t.page.waitForFunction(() => /Sent/.test((document.getElementById('svReviewStage').shadowRoot.getElementById('cpSt') || {}).innerText || ''), null, { timeout: 5000 });
      const sentAt = await t.page.evaluate(() => Math.round(performance.now() - window.__t0));
      expect(sentAt < 400, '"Sent" shows at once (' + sentAt + ' ms)');
      expect(await inS(t.page, '#ta').count() === 1, 'the box stays open on the video');
      await inS(t.page, '#ta').first().fill('And end on the logo.');
      await inS(t.page, '#ta').first().press('Enter'); await sleep(200);
      const two = await R(t.page, (r) => (r.getElementById('cpSt') || {}).innerText || '');
      expect(/2 changes sent/.test(two), 'the box counts both (' + two.replace(/\s+/g, ' ') + ')');
      let got = [];
      for (let i = 0; i < 100; i++) { got = notes(t.state.cards[0], 'video_tweaks').filter(n => n.is_tweak && n.role === 'kasper').map(n => n.body); if (got.length >= 2) break; await sleep(150); }
      expect(got.join(' | ') === 'Cut the pause after the hook. | And end on the logo.', 'both changes saved, in order (' + got.join(' | ') + ')');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- 2b. A reload while the first change still saves: the second comes back into the box ---');
    {
      const t = await openKasper(browser, origin, {});
      t.state.gatewayDelay = 8000;   // the first change's save hangs
      await inS(t.page, video + ' [data-chg]').first().click(); await sleep(300);
      await inS(t.page, '#ta').first().fill('Cut the pause after the hook.');
      await inS(t.page, '#ta').first().press('Enter'); await sleep(200);
      await inS(t.page, '#ta').first().fill('And end on the logo.');
      await inS(t.page, '#ta').first().press('Enter'); await sleep(300);
      const kept = await t.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('syncview_rs_chgq_v1:kasper:')).map(k => k + '=' + localStorage.getItem(k)).join(' | '));
      expect(/And end on the logo\./.test(kept) && !/Cut the pause/.test(kept), 'the waiting change is kept in this browser, under his own key (' + kept.slice(0, 160) + ')');
      t.state.gatewayDelay = 900;
      await t.page.reload({ waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
      await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && r.querySelectorAll('#l2g .pn').length); }, null, { timeout: 30000 });
      await sleep(1500);
      const box = await R(t.page, (r) => Array.from(r.querySelectorAll('#ta')).map(x => x.value).join(' | '));
      const sent = notes(t.state.cards[0], 'video_tweaks').some(n => n.body === 'And end on the logo.');
      expect(/And end on the logo\./.test(box) || sent, 'after the reload the second change is back in the box, unsent, or was sent (box: ' + box + ', sent: ' + sent + ')');
      const left = await t.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('syncview_rs_chgq_v1:kasper:')).length);
      expect(left === 0, 'and it is no longer waiting in storage (it cannot go twice)');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- 3. A quick note shows no spinner ---');
    {
      const t = await openKasper(browser, origin, {});
      await R(t.page, (r) => { window.__spin = false; new MutationObserver(() => { const s = r.querySelector('#chat .cp-spin'); if (s && getComputedStyle(s).visibility !== 'hidden' && getComputedStyle(s).opacity !== '0') window.__spin = true; }).observe(r, { subtree: true, childList: true, attributes: true }); });
      await inS(t.page, '#chat #ta').fill('Looks good overall.');
      await inS(t.page, '#chat #ta').press('Enter');
      await sleep(900);
      expect(!(await t.page.evaluate(() => window.__spin)), 'no spinner while the note saves quickly');
      let ok = false;
      for (let i = 0; i < 40 && !ok; i++) { ok = notes(t.state.cards[0], 'video_tweaks').some(n => n.body === 'Looks good overall.' && n.role === 'kasper'); if (!ok) await sleep(100); }
      expect(ok, 'the note is saved');
      await t.ctx.close();
    }

    console.log('--- 4. Reply under a team-only message ---');
    {
      const t = await openKasper(browser, origin, { question: true });
      const offered = await R(t.page, (r) => Array.from(r.querySelectorAll('[data-cp-reply]')).map(b => b.dataset.cpReply));
      expect(offered.length === 1 && offered[0] === 'k1', 'Reply only on the team-only message, never on one the client can see (' + offered.join(',') + ')');
      await inS(t.page, '[data-cp-reply="k1"]').click({ force: true }); await sleep(200);
      expect(/Replying to/.test(await inS(t.page, '#chat #reLine').innerText()), 'the box says whom it answers');
      await inS(t.page, '#chat #ta').fill('Yes, the new intro works.');
      await inS(t.page, '#chat #ta').press('Enter');
      let rep = null;
      for (let i = 0; i < 40 && !rep; i++) { rep = notes(t.state.cards[0], 'video_tweaks').find(n => n.body === 'Yes, the new intro works.') || null; if (!rep) await sleep(100); }
      expect(rep && rep.parent_id === 'k1' && rep.audience === 'internal' && rep.role === 'kasper', 'saved under that message, team-only (' + JSON.stringify(rep && { p: rep.parent_id, a: rep.audience, r: rep.role }) + ')');
      await sleep(500);
      const shown = await R(t.page, (r) => { const rows = Array.from(r.querySelectorAll('#chat .cpm')); const i = rows.findIndex(e => /is the new intro OK/.test(e.innerText)); const n = rows[i + 1]; return n ? { rep: n.classList.contains('rep'), text: n.innerText.replace(/\s+/g, ' ') } : null; });
      expect(shown && shown.rep && /the new intro works/.test(shown.text), 'shown indented under it (' + JSON.stringify(shown) + ')');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- 5. Not on the list: his page as it was ---');
    {
      const t = await openKasper(browser, origin, { unread: false, question: true });
      expect(await inS(t.page, '.rs.cp').count() === 0 && await inS(t.page, '[data-cp-reply]').count() === 0, 'no polish and no Reply');
      await inS(t.page, video + ' [data-chg]').first().click(); await sleep(300);
      await inS(t.page, '#ta').first().fill('Old-page change.');
      await inS(t.page, '#ta').first().press('Enter'); await sleep(400);
      expect(await inS(t.page, video + ' #ta').count() === 0 && !(await inS(t.page, '.cp-done').count()), 'a sent change closes the box, as before');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-kasper-polish-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-kasper-polish-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
