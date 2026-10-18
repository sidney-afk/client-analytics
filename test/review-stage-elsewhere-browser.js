'use strict';
/*
 * A POST ANSWERED ELSEWHERE (session Curtain Ten, 2026-10-18; card gauntlet, client side, Curtain findings 1 and 2).
 *
 * The client has the link open in two tabs, or the team answers while the client looks. Here the other window is a
 * change on the (mocked) server followed by the page's own background refresh, the same path a realtime event takes.
 *
 *   1. The client is typing a change on the video when it is approved elsewhere. Send: the words are never dropped.
 *      They go to the team as a note on that part, and the stage says so in plain words.
 *   2. The client is only looking. After the refresh the same post stays on stage, marked "Approved in another
 *      window", and the next action (Change my mind; a change on a part still waiting) lands on the card on screen,
 *      never on another one. Finish reviewing moves on.
 *   3. The same on the SMM's Review tab: the post on stage stays, marked.
 *   4. Kasper's tab: the card leaves his lists while he types a change (another window approved it). The words still
 *      reach that card as a team-only note, and nothing but notes is sent (review of #2207).
 *   5. The client's post leaves the list altogether while they type: the words stay in the box and nothing lands on
 *      another card (review of #2207).
 * Fails on main: the stage swapped to another post and the typed words went nowhere.
 * Screenshots: docs/audits/2026-10-18-curtain-ten/ (only with SV_SHOTS=1).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, open, openClient, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const SHOTS = process.env.SV_SHOTS ? path.join(__dirname, '..', 'docs', 'audits', '2026-10-18-curtain-ten') : '';
async function shot(t, name) { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await t.page.screenshot({ path: path.join(SHOTS, name) }); }

const title = t => inS(t.page, '#side').textContent().catch(() => '');
const drow = t => inS(t.page, '#drow').textContent().catch(() => '');
// What another window does: change the row on the server, then the page's own background reload.
async function elsewhere(t, id, fields) {
  const row = t.state.cards.find(c => c.id === id);
  Object.assign(row, fields, { updated_at: new Date().toISOString() });
  await t.page.evaluate(() => loadCalendarPosts({ background: true, quiet: true }));
  await sleep(1500);
}
function posts(t) {
  const out = [];
  t.page.on('request', r => { if (r.method() === 'POST') out.push({ url: r.url(), body: r.postData() || '' }); });
  return out;
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // 1. typing a change when the video is approved elsewhere
    console.log('--- client: typing a change, the video is approved in another window ---');
    let t = await openClient(browser, origin, { flags: 'on' });
    let sent = posts(t);
    await waitNew(t);
    await sleep(800);
    const first = await title(t);
    expect(/first second/.test(first), '1: the first post is on stage (' + first.slice(0, 60) + ')');
    await inS(t.page, '[data-chg="video"]').click();
    const words = 'Could the music be a little quieter under the voice?';
    await inS(t.page, '#ta').fill(words);
    await elsewhere(t, 'rs1', { video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' });
    expect(/first second/.test(await title(t)), '1: after the refresh the same post is still on stage');
    expect((await inS(t.page, '#ta').inputValue()) === words, '1: the typed words are still in the box');
    const n0 = t.state.upserts.length, s0 = sent.length;
    await inS(t.page, '#sendBtn').click();
    await sleep(1500);
    const d1 = await drow(t);
    expect(/already approved, so we sent your words to the team as a note/.test(d1), '1: the stage says in plain words what happened (' + d1.slice(0, 140) + ')');
    expect(!t.state.upserts.slice(n0).some(u => u.video_status === 'Tweaks Needed'), '1: no change request reopens the approved video');
    const carried = sent.slice(s0).filter(r => r.body.includes('quieter under the voice'));
    expect(carried.length > 0 && carried.every(r => /rs1/.test(r.body)), '1: the words were sent, on the post on screen (' + carried.length + ' request(s))');
    const v = await t.page.evaluate(() => { const p = calState.posts.find(x => x.id === 'rs1'); return JSON.stringify(p.video_tweaks || p.comments || ''); });
    expect(/quieter under the voice/.test(v), '1: the note is on the video of that post');
    expect(/first second/.test(await title(t)), '1: still the same post on stage');
    await shot(t, 'item1-words-sent-as-note.png');
    expect(!t.errors.length, '1: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // 2. only looking: the whole post is approved elsewhere
    console.log('--- client: looking, the whole post is approved in another window ---');
    t = await openClient(browser, origin, { flags: 'on' });
    sent = posts(t);
    await waitNew(t);
    await sleep(800);
    await elsewhere(t, 'rs1', { video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' });
    expect(/first second/.test(await title(t)), '2: the same post stays on stage after the refresh');
    const d2 = await drow(t);
    expect(/Approved in another window/.test(d2), '2: it is marked plainly (' + d2.slice(0, 120) + ')');
    const cur = await inS(t.page, '#skList .chipp.cur').getAttribute('data-id').catch(() => '');
    expect(cur === 'rs1', '2: the strip still marks the post on stage (' + cur + ')');
    expect(await inS(t.page, '#finishBtn:not([disabled])').count() === 1, '2: Finish reviewing is there to move on');
    await shot(t, 'item2-kept-on-stage-marked.png');
    // a few seconds later the client acts: every button acts on the post on screen
    await sleep(2500);
    expect(/first second/.test(await title(t)), '2: still the same post a few seconds later');
    const s2 = sent.length, n2 = t.state.upserts.length;
    await inS(t.page, '[data-again]').first().click();
    await inS(t.page, '#ta').fill('Actually, a warmer colour on the thumbnail?');
    await inS(t.page, '#sendBtn').click();
    await sleep(1500);
    const went = sent.slice(s2).filter(r => r.body.includes('warmer colour'));
    expect(went.length > 0 && went.every(r => /rs1/.test(r.body) && !/rs2/.test(r.body)), '2: Change my mind goes to the post on screen (' + went.length + ' request(s))');
    expect(!t.state.upserts.slice(n2).some(u => u.id !== 'rs1'), '2: nothing saved on another card');
    await inS(t.page, '#finishBtn').click();
    await sleep(800);
    expect(!/first second/.test(await title(t)), '2: Finish reviewing moves on to the next post');
    expect(!t.errors.length, '2: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // 2b. part of the post approved elsewhere: a change on another part lands on the card on screen
    console.log('--- client: the video is approved in another window, a change on the caption ---');
    t = await openClient(browser, origin, { flags: 'on' });
    await waitNew(t);
    await sleep(800);
    await elsewhere(t, 'rs1', { video_status: 'Approved' });
    expect(/Approved in another window/.test(await drow(t)), '2b: the video is marked plainly');
    await inS(t.page, '.stp[data-step="caption"]').click();
    await sleep(500);
    await inS(t.page, '[data-chg="caption"]').click();
    await inS(t.page, '#ta').fill('Shorter first line, please.');
    const n1 = t.state.upserts.length;
    await inS(t.page, '#sendBtn').click();
    await sleep(2000);
    const landed = t.state.upserts.slice(n1).filter(u => u.caption_status === 'Tweaks Needed').map(u => u.id);
    expect(landed.length && landed.every(id => id === 'rs1'), '2b: the change request lands on the card on screen (' + JSON.stringify(landed) + ')');
    expect(/first second/.test(await title(t)), '2b: and that card is still the one on stage');
    expect(!t.errors.length, '2b: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // 3. the SMM's Review tab
    console.log('--- SMM: the post on stage is approved in another window ---');
    t = await open(browser, origin, { stage: 'smm', flags: 'on', staff: STAFF });
    await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
    await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
    await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
    await t.page.evaluate(() => onCalViewChange('smmreview'));
    await waitNew(t);
    await sleep(800);
    const s3 = await title(t);
    await elsewhere(t, 'rs1', { video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval' });
    expect((await title(t)) === s3, '3: the same post stays on stage after the refresh');
    expect(/Approved in another window/.test(await drow(t)), '3: it is marked plainly');
    await shot(t, 'item2-smm-kept-on-stage.png');
    expect(!t.errors.length, '3: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
    // 4. Kasper's tab: the card leaves his lists while he types a change
    console.log('--- Kasper: typing a change, the card leaves his lists ---');
    t = await open(browser, origin, { stage: 'kasper', flags: 'on', staff: STAFF });
    await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
    await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
    await waitNew(t);
    await sleep(1500);
    const k0 = await title(t);
    await inS(t.page, '[data-chg="video"]').click();
    await inS(t.page, '#ta').fill('Kasper: lift the voice a touch.');
    await inS(t.page, '#ta').evaluate(e => e.blur());
    const krow = t.state.cards.find(c => c.id === 'rs1');
    Object.assign(krow, { video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval', updated_at: new Date().toISOString() });
    await t.page.evaluate(() => _kasperLoadReview(true));
    await sleep(2500);
    expect((await title(t)) === k0, '4: the card stays on stage after it left his lists');
    expect((await inS(t.page, '#ta').inputValue().catch(() => '')) === 'Kasper: lift the voice a touch.', '4: his typed words are still on screen');
    const kn = t.state.upserts.length;
    await inS(t.page, '#sendBtn').click();
    await sleep(2000);
    const kup = t.state.upserts.slice(kn).filter(u => JSON.stringify(u).includes('lift the voice'));
    expect(kup.length === 1 && kup[0].id === 'rs1', '4: the words reach that card once (' + kup.map(u => u.id).join(',') + ')');
    expect(kup.every(u => !Object.keys(u).some(k => /_status$|^status$/.test(k))), '4: only the notes are sent, never the old statuses');
    expect(/sent your words to the team as a note/.test(await drow(t)), '4: the stage says so');
    expect(!t.errors.length, '4: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // 5. the client's post leaves the list while they type
    console.log('--- client: the post on stage leaves the list while they type ---');
    t = await openClient(browser, origin, { flags: 'on' });
    sent = posts(t);
    await waitNew(t);
    await sleep(800);
    await inS(t.page, '[data-chg="video"]').click();
    await inS(t.page, '#ta').fill('Gone card words');
    const grow = t.state.cards.find(c => c.id === 'rs1');
    grow.client = 'not-this-client'; grow.updated_at = new Date().toISOString();
    await t.page.evaluate(() => loadCalendarPosts({ background: true, quiet: true }));
    await sleep(1500);
    await inS(t.page, '#ta').pressSequentially(' and more');
    await inS(t.page, '#ta').press('Enter');
    await sleep(1500);
    expect(!sent.some(r => r.body.includes('Gone card words')) && !t.state.upserts.some(u => JSON.stringify(u).includes('Gone card words')), '5: nothing lands on another card');
    expect(/Gone card words and more/.test(await inS(t.page, '#ta').inputValue().catch(() => '')), '5: the words stay in the box');
    expect(!t.errors.length, '5: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
