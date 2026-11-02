'use strict';
/*
 * A CARD THIS BROWSER JUST SAVED STILL TAKES EVERYONE ELSE'S CHANGES TO THE OTHER FIELDS. Session Nightred, 2026-11-02.
 * A real browser against the real page and a mocked backend (fictional client, cards and token), fully offline.
 *
 * The nightly probe p52 went red every night from 28 Oct: on the client link (Collaborative mode on) the client saved a
 * caption, then the SMM removed the card's alt caption, and the client link kept showing the removed alt caption. After
 * any save, the Calendar's re-read kept this browser's whole copy of that card for 90 seconds (the recent-save guard,
 * there to ride out a stale echo of what we just wrote) and adopted only the four sub-statuses from a newer server row,
 * so a field someone else changed in that window was dropped until it ended.
 *
 * The rule now: inside the window, a newer server row's value is taken for every plain field this browser did not
 * write and has not queued; the fields it wrote, and anything typed but not yet sent, still keep the local value.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { openClient, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const later = () => new Date(Date.now() + 1000).toISOString();

async function reread(page) { await page.evaluate(async () => { await loadCalendarPosts({ background: true, quiet: true }); }); }
async function local(page, pid) { return page.evaluate(id => { const p = (calState.posts || []).find(x => x.id === id); return p ? { caption: p.caption, caption_alt: p.caption_alt || '', caption_alt_platform: p.caption_alt_platform || '', cta: p.cta || '', name: p.name, scheduled_date: p.scheduled_date } : null; }, pid); }

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    const t = await openClient(browser, origin, { flags: 'off', collab: true, finished: true });
    await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
    await t.page.evaluate(() => onCalViewChange('organizer'));
    await t.page.waitForFunction(() => calState.view === 'organizer', null, { timeout: 15000 });
    await sleep(1500);
    const pid = 'rf1';
    const drawnAlt = () => t.page.evaluate(id => { const ta = document.querySelector(`.cal-card[data-pid="${id}"] textarea[data-fld="caption_alt"]`); return ta ? ta.value : null; }, pid);
    const row = t.state.cards.find(c => c.id === pid);

    // The SMM had written an alt caption; the client link sees it.
    Object.assign(row, { caption_alt: 'A LinkedIn-only caption.', caption_alt_platform: 'linkedin', cta: 'Link in bio', updated_at: later() });
    await reread(t.page);
    let p = await local(t.page, pid);
    expect(p && p.caption_alt === 'A LinkedIn-only caption.', 'the client link has the alt caption (' + JSON.stringify(p && p.caption_alt) + ')');
    await sleep(600);
    const before = await drawnAlt();
    expect(before === 'A LinkedIn-only caption.', 'the alt caption is drawn on the client\'s Sheet card (' + JSON.stringify(before) + ')');

    // The client types and saves the caption (Collaborative mode on).
    const CAP = 'The client wrote this caption.';
    const n0 = t.state.upserts.length;
    await t.page.evaluate(([id, text]) => { const el = { dataset: { pid: id, fld: 'caption' }, value: text }; _calOnFieldInput(el); _calOnFieldBlur(el); }, [pid, CAP]);
    await t.page.waitForFunction(([id, n]) => true, [pid, n0]);
    for (let i = 0; i < 40 && !t.state.upserts.slice(n0).some(u => u.id === pid && u.caption === CAP); i++) await sleep(150);
    expect(row.caption === CAP, 'the client\'s caption is saved (' + JSON.stringify(row.caption) + ')');
    await sleep(800);

    // Seconds later the SMM removes the alt caption and changes the call to action and the title.
    Object.assign(row, { caption_alt: '', caption_alt_platform: '', cta: 'Book a call', name: 'Behind the scenes, part one', updated_at: later() });
    await reread(t.page);
    p = await local(t.page, pid);
    expect(p && p.caption_alt === '' && p.caption_alt_platform === '', 'the SMM\'s alt-caption removal reaches the client inside the window (' + JSON.stringify(p && [p.caption_alt, p.caption_alt_platform]) + ')');
    expect(p && p.cta === 'Book a call', 'the SMM\'s new call to action reaches the client (' + JSON.stringify(p && p.cta) + ')');
    expect(p && p.name === 'Behind the scenes, part one', 'the SMM\'s new title reaches the client (' + JSON.stringify(p && p.name) + ')');
    expect(p && p.caption === CAP, 'the client\'s own caption is kept (' + JSON.stringify(p && p.caption) + ')');
    await sleep(600);
    const shown = await drawnAlt();
    expect(!shown, 'no alt caption is drawn on the client\'s card (' + JSON.stringify(shown) + ')');

    // A stale copy of the field this browser wrote does not undo it inside the window (the guard's original job).
    Object.assign(row, { caption: 'A finished fixture caption.', updated_at: later() });
    await reread(t.page);
    p = await local(t.page, pid);
    expect(p && p.caption === CAP, 'a stale server caption does not overwrite the caption this browser just saved (' + JSON.stringify(p && p.caption) + ')');

    // Typed but not yet sent: a field queued on this browser keeps its local value too.
    await t.page.evaluate(id => { const q = (_calPendingEdits[id] = _calPendingEdits[id] || {}); q.cta = 'Typed, not sent'; const post = calState.posts.find(x => x.id === id); post.cta = 'Typed, not sent'; }, pid);
    Object.assign(row, { cta: 'Another server value', updated_at: later() });
    await reread(t.page);
    p = await local(t.page, pid);
    expect(p && p.cta === 'Typed, not sent', 'a queued edit is not replaced by the server (' + JSON.stringify(p && p.cta) + ')');
    await t.page.evaluate(id => { delete _calPendingEdits[id]; }, pid);

    expect(t.errors.length === 0, 'no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nall checks passed');
})().catch(e => { console.error(e); process.exit(1); });
