'use strict';
/* Phone polish (the staff pages' polish, permanent for every signed-in staff member since 2026-10-29 with no switch,
 * session Permafive; and the client page's review_client_polish), session Grip, 2026-10-25.
 *   npm run build:index && node docs/syncview-design/tests/phone-polish-browser.js [--widths=360,390,430]
 * CI runs it in the staff phone lane, once per width there (390 and 430); the desktop check runs with 390.
 * Fully offline (docs/syncview-design/phone-audit/harness.js and qa/finch-phone/harness.js), fictional data only.
 * The staff fixes are checked with the old phone_polish_staff row present and absent: the polish must show either way.
 * On a desktop page nothing the polish touches may change: the page is measured with its class and again with the
 * class taken off by hand. The client fixes are checked with review_client_polish on and off. */
const assert = require('assert/strict');
const { staffEnv, clientPage, sleep, FLAGS } = require('../phone-audit/harness');
const finch = require('../../../qa/finch-phone/harness');
const { SCENARIOS } = require('../../../qa/finch-phone/scenarios');

const H = { 360: 780, 390: 844, 430: 932 };
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ok', msg); };

async function openPost(S, page) {
  await S.openCalendar(page); await sleep(2600);
  await page.evaluate(() => onCalViewChange('organizer')); await sleep(1200);
  const sheetTop = await page.evaluate(() => Math.round(document.querySelector('.thumb-tile').getBoundingClientRect().top));
  await page.click('[data-thumb-card=p_morning]'); await sleep(1300);
  return sheetTop;
}

async function staffPhone(W, rowPresent) {
  if (rowPresent) FLAGS.phone_polish_staff = { staff: ['m1'] }; else delete FLAGS.phone_polish_staff;
  const S = await staffEnv({ context: { viewport: { width: W, height: H[W] }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } });
  const tag = `staff ${W} old row ${rowPresent ? 'present' : 'absent'}:`;
  // No switch since 2026-10-29: every signed-in staff member has the polish, whatever the old row says.
  try {
    const page = await S.newPage();
    const sheetTop = await openPost(S, page);
    ok(await page.evaluate(() => document.documentElement.classList.contains('sv-phone-polish')), `${tag} the page carries the polish class`);
    // Round 2: the Sheet's first post starts higher (272 px before).
    ok(sheetTop <= 244, `${tag} the Sheet's first post starts at ${sheetTop} px`);
    const notes = await page.evaluate(() => { const b = [...document.querySelectorAll('.cal-card-edit .cal-comments-btn')].find(x => x.checkVisibility()); return b ? Math.round(b.getBoundingClientRect().bottom) : null; });
    ok(notes !== null && notes <= H[W], `${tag} an opened post shows Notes without scrolling (bottom ${notes} <= ${H[W]})`);
    const thumb = await page.evaluate(() => Math.round(document.querySelector('.cal-card-edit .cal-card-thumb img').getBoundingClientRect().height));
    ok(thumb <= 180, `${tag} the post's picture is at most 180 px (${thumb})`);
    await page.evaluate(() => history.back()); await sleep(900);
    await page.evaluate(() => openCalComments('p_morning')); await sleep(1500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#calCommentsOverlay .cal-cm-actions')].filter(a => a.checkVisibility() && a.querySelector('.is-danger')).map(a => {
      const d = a.querySelector('.is-danger'), r = a.getBoundingClientRect(), dr = d.getBoundingClientRect(), cs = getComputedStyle(a);
      const reply = [...a.querySelectorAll('.cal-cm-action')].find(b => /Reply/.test(b.textContent));
      const word = d.querySelector('span'); return { del: word && word.getBoundingClientRect().width > 2 ? word.textContent.trim() : '', name: d.textContent.trim(), delRightGap: Math.round(r.right - dr.right), delLeftGap: reply ? Math.round(dr.left - reply.getBoundingClientRect().right) : null, delW: Math.round(dr.width), delH: Math.round(dr.height), border: cs.borderTopColor, reply: reply ? reply.innerText.trim() : '' };
    }));
    ok(rows.length >= 3, `${tag} notes with a Delete are on screen (${rows.length})`);
    // Round 2: a note's actions sit right under its words.
    const bands = await page.evaluate(() => [...document.querySelectorAll('#calCommentsOverlay .cal-cm-actions')].filter(a => a.checkVisibility()).map(a => { const b = a.closest('.cal-cm-row').querySelector('.cal-cm-body-col'); return Math.round(a.getBoundingClientRect().top - b.getBoundingClientRect().bottom); }));
    ok(bands.every(g => g <= 2), `${tag} the band between a note's words and its actions is gone (${[...new Set(bands)].join(', ')} px)`);
    {
      ok(rows.every(r => r.del === '' && r.name === 'Delete'), `${tag} Delete shows no word (its name is still "Delete" for a screen reader)`);
      ok(rows.every(r => r.delRightGap <= 4 && r.delLeftGap >= 60), `${tag} Delete sits at the row's far end, away from Reply`);
      ok(rows.every(r => r.delW >= 44 && r.delH >= 44), `${tag} Delete is still a 44 px target`);
      ok(rows.every(r => r.border === 'rgba(0, 0, 0, 0)'), `${tag} the actions have no box around them`);
      ok(rows.every(r => r.reply === 'Reply'), `${tag} Reply keeps its word`);
    }
    // Delete still asks first.
    await page.evaluate(() => [...document.querySelectorAll('#calCommentsOverlay .cal-cm-action.is-danger')].find(b => b.checkVisibility()).click()); await sleep(500);
    ok(await page.evaluate(() => !!document.querySelector('.confirm-overlay, .sv-confirm, [role=alertdialog], [role=dialog][aria-modal=true]:not(#calCommentsOverlay)')), `${tag} Delete asks before it deletes`);
    await page.keyboard.press('Escape'); await sleep(300);
    await page.keyboard.press('Escape'); await sleep(500);
    await page.evaluate(() => _msgOpenPage()); await sleep(1500);
    const lines = await page.evaluate(() => { const e = document.querySelector('#msgPage [data-msg-conv="p_morning"] .msg-conv-last'); return Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)); });
    ok(lines === 2, `${tag} a conversation's last message shows on two lines (${lines})`);
    // Round 2: the Messages title shows whole beside Close (on a 360 px phone it ran under the word "Close").
    const head = await page.evaluate(() => { const h = document.querySelector('.pocket-staff-title'), c = document.querySelector('.pocket-staff-msg-close'); const hr = h.getBoundingClientRect(), cr = c.getBoundingClientRect(); return { whole: h.scrollWidth <= h.clientWidth + 1 && hr.right <= cr.left, cw: Math.round(cr.width), ch: Math.round(cr.height), name: c.getAttribute('aria-label') }; });
    ok(head.whole && head.cw >= 44 && head.ch >= 44 && head.name === 'Close Messages', `${tag} "Messages" shows whole beside a 44 px Close (${head.cw}x${head.ch})`);
    await page.click('.pocket-staff-msg-close'); await sleep(900);
    ok(await page.evaluate(() => { const m = document.getElementById('msgPage'); return !m || !m.checkVisibility(); }), `${tag} Close still closes Messages`);
  } finally { await S.close(); }
}

// A desktop page: everything the polish touches is drawn exactly as without its class (taken off by hand, since no
// switch can take it off any more).
async function desktopSame() {
  delete FLAGS.phone_polish_staff;
  const S = await staffEnv({ context: { viewport: { width: 1280, height: 900 } } });
  try {
    const page = await S.newPage();
    await S.openCalendar(page); await sleep(2600);
    await page.evaluate(() => openCalComments('p_morning')); await sleep(1500);
    // The unread badges' Notes toolbar fit (327 _svuFitBars) gives a borderline note 20 px of room in some runs and
    // not in others: that one measured class is cleared before each measure.
    const snap = () => page.evaluate(() => {
      document.querySelectorAll('.svu-bar-room').forEach(e => e.classList.remove('svu-bar-room'));
      const props = ['order', 'height', 'width', 'marginLeft', 'borderTopColor', 'backgroundColor', 'display', 'whiteSpace', 'position', 'maxHeight'];
      const els = [...document.querySelectorAll('#calView *, #calCommentsOverlay *, #msgPage *')];
      return { cls: document.documentElement.classList.contains('sv-phone-polish'), n: els.length, styles: els.map(e => props.map(p => getComputedStyle(e)[p]).join('|')).join('\n'), names: els.map(e => e.tagName + '.' + String(e.className).slice(0, 40) + ' "' + (e.childElementCount ? '' : e.textContent.trim().slice(0, 20)) + '"') };
    });
    const on = await snap();
    await page.evaluate(() => document.documentElement.classList.remove('sv-phone-polish'));
    const off = await snap();
    ok(on.cls && !off.cls, 'desktop: a signed-in staff member carries the polish class on a desktop page too, with no switch row');
    if (on.styles !== off.styles) { const a = on.styles.split('\n'), b = off.styles.split('\n'); a.forEach((x, i) => { if (x !== b[i]) console.log('  differs:', on.names[i], '|on', x, '|off', b[i], '|', off.names[i]); }); }
    ok(on.n > 200 && on.n === off.n && on.styles === off.styles, `desktop: with the polish class, the Calendar and Notes are drawn exactly as without it (${on.n} elements compared)`);
  } finally { await S.close(); }
}

async function client(W, on) {
  if (on) FLAGS.review_client_polish = { all: true }; else delete FLAGS.review_client_polish;
  const S = await staffEnv({ context: { viewport: { width: W, height: H[W] } } });
  const tag = `client ${W} ${on ? 'on' : 'off'}:`;
  try {
    const { ctx, page } = await clientPage(S.browser, S.origin, { width: W, height: H[W], theme: 'light' });
    await page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return h && h.shadowRoot && h.shadowRoot.getElementById('drow'); }, null, { timeout: 30000 });
    await sleep(2500);
    const chars = await page.evaluate(() => [...document.getElementById('svReviewStage').shadowRoot.querySelectorAll('.tc-foot')].some(e => e.checkVisibility() && /characters/.test(e.innerText)));
    ok(on ? !chars : chars, `${tag} the caption's character count is ${on ? 'gone' : 'shown as before'}`);
    const cut = await page.evaluate(() => [...document.getElementById('svReviewStage').shadowRoot.querySelectorAll('.chipp .cn')].filter(e => e.checkVisibility() && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)).length);
    ok(on ? cut === 0 : cut > 0, `${tag} waiting posts' names are ${on ? 'shown whole' : 'cut as before'} (${cut} cut)`);
    await page.evaluate(() => { const q = [...document.getElementById('svReviewStage').shadowRoot.querySelectorAll('.cn')].find(e => /Meet the team/.test(e.textContent)); (q.closest('button,[role=button],.qi,li,div') || q).click(); }); await sleep(1500);
    const b = await page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; const ok = r.querySelector('.b-ok'), ask = r.querySelector('.b-ask'); return { ok: Math.round(ok.getBoundingClientRect().bottom), ask: ask ? Math.round(ask.getBoundingClientRect().bottom) : 0, view: r.getElementById('view').className }; });
    ok(/k-video/.test(b.view), `${tag} the video step is open`);
    if (on) ok(b.ok <= H[W] && b.ask <= H[W], `${tag} Approve and Ask for a change are on the first screen (${b.ok}, ${b.ask} <= ${H[W]})`);
    else if (W < 430) ok(b.ok > H[W], `${tag} Approve was below the first screen (${b.ok})`);
    await ctx.close();
  } finally { await S.close(); }
}

async function production(W, rowPresent) {
  // No switch since 2026-10-29: the polished row whatever the old row says.
  const sc = SCENARIOS.find(s => s.id === 'linear-list');
  const o = Object.assign({ width: W, theme: 'light' }, sc.open);
  o.rest = Object.assign({}, o.rest, { syncview_runtime_flags: (rowPresent ? [{ key: 'phone_polish_staff', value: { staff: ['qa_staff'] } }] : []).concat([{ key: 'prod_authority', value: { video: 'syncview', graphics: 'syncview' } }]) });
  const h = await finch.open(o);
  try {
    await h.page.waitForTimeout(4500);
    const r = await h.page.evaluate(() => { const row = document.querySelector('.prod-row'); const a = row.querySelector('.prod-assign-hot').getBoundingClientRect(), t = row.querySelector('.prod-title').getBoundingClientRect(); return { h: Math.round(row.getBoundingClientRect().height), sameLine: Math.abs((a.top + a.bottom) / 2 - (t.top + t.bottom) / 2) < 14, right: Math.round(a.right), rowRight: Math.round(row.getBoundingClientRect().right) }; });
    const tag = `production ${W} old row ${rowPresent ? 'present' : 'absent'}:`;
    ok(r.sameLine && r.h <= 125 && r.right <= r.rowRight, `${tag} the person's picture sits on the title's line; a row is ${r.h} px`);
  } finally { await h.close(); }
}

const WIDTHS = ((process.argv.find(a => a.startsWith('--widths=')) || '--widths=360,390,430').slice(9)).split(',').map(Number);
assert.ok(WIDTHS.length && WIDTHS.every(w => H[w]), 'widths are 360, 390 or 430');

(async () => {
  for (const W of WIDTHS) { await staffPhone(W, true); await staffPhone(W, false); }
  if (WIDTHS.includes(390)) await desktopSame();
  for (const W of WIDTHS) await client(W, true);
  if (WIDTHS.includes(390)) await client(390, false);
  for (const W of WIDTHS) { await production(W, true); await production(W, false); }
  console.log(`phone-polish-browser: ${passed} passed`);
})().catch(e => { console.error(e); process.exit(1); });
