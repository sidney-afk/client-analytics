'use strict';
/* notes-quick-open-reply-browser.js -- round 9 of the unread badges, for Notes (owner, 2026-10-25; switch
 * unread_badges_v2, staff only). Fully mocked: nothing reaches a live backend.
 *
 *   A a first opening of a card with no notes shows the loading skeleton while its notes are looked up, then
 *     "No notes yet"
 *   B a second opening of the same card, after a board refresh has replaced its row and its read state, shows
 *     "No notes yet" at once: not one skeleton frame, although the same lookup runs again
 *   C a reply sent while the notes are still loading is taken (Send is not held), shows in the thread at once, and
 *     is sent when the loading ends, once
 *   D the "sending" mark goes when the server has the note, without waiting for the card's own save behind it
 *   E with the switch off, B and C are as before (the skeleton on every opening; Send held while loading)
 *
 * On the code before this change B, C and D fail.
 */
const { createEnv, sleep, SLUG } = require('./lost-work-lib');

const CORS = { 'access-control-allow-origin': '*' };
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(50); } return false; };

async function run(flagValue) {
  const S = await createEnv();
  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', async route => {
    const sp = new URL(route.request().url()).searchParams;
    const raw = sp.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({
      key: k, value: k === 'unread_badges_v2' ? flagValue : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows.filter(r => r.value !== undefined)) });
  });
  // The card's link lookup (the crosswalk), slowed on demand.
  const slow = { crosswalk: 0 };
  await S.ctx.route('**/rest/v1/deliverables**', async route => { if (slow.crosswalk) await sleep(slow.crosswalk); return route.fallback(); });
  const errors = [];
  const sent = [];
  const page = await S.newPage();
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('request', r => {
    if (!/functions\/v1\/production-write/.test(r.url()) || r.method() !== 'POST') return;
    try { const b = JSON.parse(r.postData() || '{}'); if (b.operation === 'comment') sent.push(b.comment || {}); } catch (e) {}
  });
  await S.openCalendar(page);
  await sleep(600);
  return { S, page, slow, errors, sent };
}

// Opens Notes and records every frame: did the skeleton ever show, and what did the first frame hold?
const openWatched = page => page.evaluate(() => new Promise(resolve => {
  window.__r9 = { skel: false, first: '' };
  const look = () => {
    const feed = document.getElementById('calCommentsFeed');
    if (!feed) return;
    if (feed.querySelector('.cal-cm-skeleton')) window.__r9.skel = true;
    if (!window.__r9.first) window.__r9.first = feed.querySelector('.cal-cm-skeleton') ? 'skeleton' : (feed.textContent || '').trim().slice(0, 40);
  };
  const mo = new MutationObserver(look);
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.__r9.stop = () => mo.disconnect();
  openCalComments('p_t1');
  look();
  resolve();
}));
const settled = page => until(() => page.evaluate(() => {
  const feed = document.getElementById('calCommentsFeed');
  const p = calState.posts.find(x => x.id === 'p_t1');
  return !!feed && !feed.querySelector('.cal-cm-skeleton') && !_prodCrosswalkInFlight(p);
}), 8000);
const watched = page => page.evaluate(() => { window.__r9.stop(); return { skel: window.__r9.skel, first: window.__r9.first }; });
// A board refresh: the card's row is a new object, without the read state the last opening left on it.
const refreshBoard = page => page.evaluate(() => {
  calState.posts = calState.posts.map(p => { const c = Object.assign({}, p); delete c._canonicalCommentReads; delete c._canonicalCrosswalk; return c; });
});

(async () => {
  for (const on of [true, false]) {
    const tag = s => (on ? 'switch on: ' : 'switch off: ') + s;
    const h = await run(on ? { staff: ['m1'] } : undefined);
    const { S, page, slow } = h;
    try {
      // A first opening
      slow.crosswalk = 700;
      await openWatched(page);
      ok(await settled(page), tag('A: the notes finish loading'));
      const a = await watched(page);
      const empty = await page.evaluate(() => (document.querySelector('#calCommentsFeed .cal-comments-empty-title') || {}).textContent || '');
      ok(a.skel && a.first === 'skeleton', tag('A: a first opening shows the skeleton while the notes load ' + JSON.stringify(a)));
      ok(empty === 'No notes yet', tag('A: then "No notes yet" (' + empty + ')'));
      await page.evaluate(() => closeCalComments());

      // B second opening, after a board refresh
      await refreshBoard(page);
      await sleep(5200); // past the 5 s window in which an opening reuses the last read
      await openWatched(page);
      const inFlight = await page.evaluate(() => _prodCrosswalkInFlight(calState.posts.find(x => x.id === 'p_t1')));
      ok(await settled(page), tag('B: the notes finish loading again'));
      const b = await watched(page);
      ok(inFlight, tag('B: the second opening looks the notes up again'));
      if (on) ok(!b.skel && /^No notes yet/.test(b.first), tag('B: a second opening shows "No notes yet" at once, not one skeleton frame ' + JSON.stringify(b)));
      else ok(b.skel, tag('E: the second opening still shows the skeleton first ' + JSON.stringify(b)));

      // C and D: a reply sent while the notes are still loading
      slow.crosswalk = 0;
      await page.evaluate(() => _calSetComposeComp('video'));
      await page.fill('#calCommentComposer', 'R9 root note');
      await page.click('#calCommentsModal .cal-cm-send');
      ok(await until(() => S.comments.some(c => c.body === 'R9 root note'), 8000), tag('C: a first note is saved, to reply to'));
      const rootId = (S.comments.find(c => c.body === 'R9 root note') || {}).id;
      await until(() => page.evaluate(() => !document.querySelector('#calCommentsFeed .is-outbox-sending')), 8000);
      await page.evaluate(() => closeCalComments());
      await refreshBoard(page);
      await sleep(5200);
      slow.crosswalk = 1500;
      S.behave['gw:comment'] = { delay: 300 };
      S.behave['cal-upsert'] = { delay: 2500 };
      await page.evaluate(() => openCalComments('p_t1'));
      await page.waitForSelector('#calCommentsModal #calCommentComposer');
      const rowId = await page.evaluate(id => {
        const row = [...document.querySelectorAll('#calCommentsFeed .cal-cm-row')].find(r => /R9 root note/.test(r.textContent));
        return row ? row.getAttribute('data-cm-row') : (id || '');
      }, rootId);
      await page.evaluate(id => _calBeginReply(id), rowId);
      await page.fill('#calCommentComposer', 'R9 quick reply');
      const held = await page.evaluate(() => {
        const btn = document.querySelector('#calCommentsModal .cal-cm-send');
        const p = calState.posts.find(x => x.id === 'p_t1');
        return { loading: _prodCrosswalkInFlight(p), disabled: !!(btn && btn.disabled), pending: !!(btn && btn.hasAttribute('data-send-pending')) };
      });
      ok(held.loading, tag('C: the notes are still loading when the reply is written'));
      if (!on) {
        ok(held.disabled && held.pending, tag('E: Send waits for the notes, as before ' + JSON.stringify(held)));
      } else {
        ok(!held.disabled && !held.pending, tag('C: Send is not held while the notes load ' + JSON.stringify(held)));
        const t0 = Date.now();
        await page.click('#calCommentsModal .cal-cm-send');
        const shown = await until(() => page.evaluate(() => [...document.querySelectorAll('#calCommentsFeed .cal-cm-row')].some(r => /R9 quick reply/.test(r.textContent))), 1500);
        ok(shown && Date.now() - t0 < 800, tag('C: the reply is in the thread at once (' + (Date.now() - t0) + ' ms)'));
        const noToast = await page.evaluate(() => !/still loading/i.test(document.body.innerText));
        ok(noToast, tag('C: no "Notes are still loading"'));
        ok(await until(() => S.comments.some(c => c.body === 'R9 quick reply'), 8000), tag('C: it is sent when the loading ends'));
        const tSaved = Date.now();
        const cleared = await until(() => page.evaluate(() => {
          const r = [...document.querySelectorAll('#calCommentsFeed .cal-cm-row')].find(x => /R9 quick reply/.test(x.textContent));
          return !!r && !r.classList.contains('is-outbox-sending') && !r.classList.contains('is-outbox-failed');
        }), 6000);
        const clearMs = Date.now() - tSaved;
        ok(cleared && clearMs < 1500, tag('D: the sending mark goes when the server has the note, not after the 2.5 s card save (' + clearMs + ' ms)'));
        await sleep(3000);
        ok(S.comments.filter(c => c.body === 'R9 quick reply').length === 1, tag('C: sent once'));
        const parent = (h.sent.find(c => c.body === 'R9 quick reply') || {}).parent_id;
        ok(!!parent, tag('C: as a reply (' + parent + ')'));
      }
      ok(h.errors.length === 0, tag('no page error') + (h.errors.length ? ' ' + h.errors.join(' | ') : ''));
    } finally { await S.close(); }
  }
  if (failures) { console.error(`notes-quick-open-reply-browser: ${failures} failed`); process.exit(1); }
  console.log('notes-quick-open-reply-browser: all passed');
})().catch(e => { console.error(e); process.exit(1); });
