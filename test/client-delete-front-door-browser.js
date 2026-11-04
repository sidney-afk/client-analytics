'use strict';
/*
 * OPEN_REPAIRS 690, in a real browser. A client on the client link asks for a
 * change on a part linked to Production, then deletes that note (the cross,
 * then Delete). The add goes to the card AND through the client front door to
 * Production. Before the fix the delete only rewrote the card
 * (calendar-upsert), so Production kept the note open for staff. Now the
 * delete also asks the front door to delete it, named by the card note's own
 * id, with no version (the client cannot read the Production thread).
 * Fully offline: the shared review-stage fixture answers every call (fictional
 * client, cards, people and token).
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, SLUG, TOKEN, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const notes = (row, col) => { try { return JSON.parse(String(row[col] || '[]')); } catch (e) { return []; } };
const comments = (state) => state.gateway.map(raw => { try { return JSON.parse(raw); } catch (e) { return {}; } }).filter(b => b.operation === 'comment');

(async () => {
  const server = await serveStatic(), origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    const t = await open(browser, origin, { stage: 'client', flags: 'on', polish: true, width: 1440 });
    // The card's video deliverable, as the live table describes a calendar card's part: this client's, the video
    // team's, made from the Calendar and bound to this card. (The shared fixture answers this read with no row.)
    await t.page.route('**/rest/v1/deliverables?**', route => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 'del_rs1', card_id: 'rs1', client_slug: SLUG, team: 'video', origin: 'calendar', linear_issue_url: '' }]) }));
    await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', tab: 'review', t: TOKEN }), { waitUntil: 'domcontentloaded' });
    await waitNew(t); await sleep(1200);
    const card = t.state.cards.find(c => c.id === 'rs1');
    expect(card && card.video_deliverable_id, 'the fixture card has a video part linked to Production');

    // The client asks for a change on the video.
    await inS(t.page, '#drow [data-chg]').first().click(); await sleep(200);
    await inS(t.page, '#ta').fill('Fixture change: start on the second shot.');
    await inS(t.page, '#sendBtn').click();
    // Wait for both halves: the front-door comment AND the card's own save. They are separate requests, and on a loaded
    // runner the card save can land after the comment (main red 4 Nov 10:21, reproduced with a 1.5 s card save).
    const sent = () => comments(t.state).some(b => (b.comment || {}).action !== 'delete' && /second shot/.test((b.comment || {}).body || ''));
    const saved = () => notes(card, 'video_tweaks').some(n => /second shot/.test(n.body || ''));
    for (let i = 0; i < 150 && !(sent() && saved()); i++) await sleep(100);
    const add = comments(t.state).find(b => /second shot/.test((b.comment || {}).body || ''));
    const note = notes(card, 'video_tweaks').find(n => /second shot/.test(n.body || ''));
    expect(note && note.is_tweak, 'the change request is on the card');
    expect(add && add.comment.native_comment_id === (note && note.id), 'and went through the client front door under the card note id (' + (add ? add.comment.native_comment_id : 'none') + ')');

    // ... then deletes it.
    await sleep(800);
    const sentBefore = t.state.gateway.length;
    const own = inS(t.page, '[data-cp-note="' + (note && note.id) + '"]');
    await own.hover(); await sleep(200);
    await inS(t.page, '[data-cp-note="' + (note && note.id) + '"] [data-cp-del]').click({ force: true }); await sleep(200);
    await inS(t.page, '[data-cp-yes]').click();
    // Again both halves: the front-door delete and the card's own save of the deleted note.
    const delSent = () => comments({ gateway: t.state.gateway.slice(sentBefore) }).some(b => (b.comment || {}).action === 'delete');
    const delSaved = () => notes(card, 'video_tweaks').some(n => n.id === (note && note.id) && n.deleted);
    for (let i = 0; i < 150 && !(delSent() && delSaved()); i++) await sleep(100);
    await sleep(300);
    const cardRow = t.state.cards.find(c => c.id === 'rs1');
    expect(notes(cardRow, 'video_tweaks').some(n => n.id === (note && note.id) && n.deleted), 'the card copy is deleted, as before');
    const del = comments({ gateway: t.state.gateway.slice(sentBefore) }).filter(b => (b.comment || {}).action === 'delete');
    expect(del.length === 1, 'one delete went to Production (' + del.length + ')');
    const d = del[0] || { comment: {} };
    expect(d.comment.native_comment_id === (note && note.id) && !d.comment.id, 'named by the card note id, never a Production id');
    expect(d.comment.expected_version === undefined && d.comment.expected_updated_at === undefined, 'with no version');
    expect(d.id === card.video_deliverable_id && d.surface === 'calendar' && d.comment.card_id === 'rs1', 'on the note\'s own deliverable, surface and card');
    expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
  } finally { await browser.close(); server.close(); }
  console.log(failures.length ? '\n' + failures.length + ' failed' : '\nclient-delete-front-door-browser: all passed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
