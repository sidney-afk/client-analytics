'use strict';
/*
 * Live regression for the EXACT reported flow: an existing card holds a Linear
 * link; the user creates a BLANK card via the + button, pastes the link onto it,
 * and clicks "Move it here". The link must move onto the (freshly-promoted) new
 * card and the old card must be cleared. Scoped to `sidneylaruel`; cleans up.
 */
const Q = require('./qalib.js');
const { up, supaGet, supa, poll, norm, soonISO } = Q;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const TS = Math.floor(Date.now() / 1000);
const A = 'p_blank_old_' + TS;
const LINK = 'https://linear.app/sidney-test/issue/BLVID-' + TS + '/x';
let promotedId = null;

(async () => {
  const browser = await Q.launch();
  let p;
  try {
    await up({ id: A, name: 'Blank-probe OLD ' + TS, platforms: 'youtube', scheduled_date: soonISO(), status: 'In Progress', order_index: 20, linear_issue_id: LINK, thumbnail_url: 'https://example.com/x.png', asset_url: 'https://example.com/x.mp4' });
    ok((await poll(A, 'id,linear_issue_id', r => norm(r.linear_issue_id) === LINK)).id === A, 'seed: old card A holds the link');

    p = await Q.smm(browser, 'sidneylaruel');
    await p.evaluate(async (a) => {
      try { window.onCalViewChange && window.onCalViewChange('organizer'); } catch (e) {}
      for (let i = 0; i < 30; i++) { try { await window.loadCalendarPosts({ background: true }); } catch (e) {} await new Promise(x => setTimeout(x, 700)); if (document.querySelector('[data-title-row="' + a + '"]')) break; }
    }, A);
    ok(await p.$('[data-title-row="' + A + '"]') !== null, 'old card A rendered in organizer');

    const blankPid = await p.evaluate(() => { window.addCalBlankCard(); const el = document.querySelector('.cal-card[data-pid^="__blank__"]'); return el ? el.getAttribute('data-pid') : null; });
    ok(!!blankPid, 'blank card created via the + button');

    const prompt = await p.evaluate(({ pid, link }) => {
      window._calLinearEdit(pid, 'video');
      const inp = document.querySelector('[data-title-row="' + pid + '"] input.cal-linear-input');
      if (!inp) return { ok: false };
      inp.value = link; inp.blur();
      const c = document.querySelector('[data-title-row="' + pid + '"] .cal-link-conflict');
      return { ok: !!c, msg: c ? c.textContent.trim() : null };
    }, { pid: blankPid, link: LINK });
    ok(prompt.ok, 'conflict prompt appears on the blank card: ' + JSON.stringify(prompt.msg));

    await p.evaluate((pid) => { const b = document.querySelector('[data-title-row="' + pid + '"] .cal-link-conflict-move'); if (b) b.click(); }, blankPid);
    await p.waitForTimeout(4000);

    for (let i = 0; i < 25; i++) {
      const rows = await supaGet(`linear_issue_id=eq.${encodeURIComponent(LINK)}&select=id,status`);
      const winner = rows.find(r => r.id !== A && String(r.status || '').toLowerCase() !== 'archived');
      if (winner) { promotedId = winner.id; break; }
      await new Promise(x => setTimeout(x, 800));
    }
    const aFinal = await poll(A, 'id,linear_issue_id', r => norm(r.linear_issue_id) === '');

    ok(!!promotedId, 'BACKEND: a new (promoted) card now owns the link');
    ok(norm(aFinal.linear_issue_id) === '', 'BACKEND: old card A link cleared');
    ok(promotedId && promotedId !== A, 'BACKEND: the link is on the NEW card, not the old one');
    ok(p._errs.length === 0, 'no JS errors (' + JSON.stringify(p._errs.slice(0, 4)) + ')');
  } catch (e) {
    fail++; console.log('  ❌ EXCEPTION ' + e.message + '\n' + (e.stack || ''));
  } finally {
    try { await up({ id: A, status: 'Archived' }); } catch (e) {}
    if (promotedId) { try { await up({ id: promotedId, status: 'Archived' }); } catch (e) {} }
    console.log('\nprobe_move_blank: pass=' + pass + ' fail=' + fail, fail ? '❌' : '✅');
    try { await browser.close(); } catch (e) {}
    process.exit(fail ? 1 : 0);
  }
})();
