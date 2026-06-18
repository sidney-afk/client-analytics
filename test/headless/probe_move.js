'use strict';
/*
 * Live regression: "paste a Linear link that's already on another card → Move
 * it here" moves the link old→new and persists it. Drives the REAL app in
 * headless Chromium against the live backend. Scoped to `sidneylaruel`; archives
 * the two cards it creates. (Pre-seeded-card variant; see probe_move_blank.js
 * for the brand-new-blank-card flow.)
 */
const Q = require('./qalib.js');
const { up, supa, poll, norm, soonISO } = Q;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const TS = Math.floor(Date.now() / 1000);
const A = 'p_probe_old_' + TS, B = 'p_probe_new_' + TS;
const LINK = 'https://linear.app/sidney-test/issue/SVID-' + TS + '/probe-move';
const base = { platforms: 'youtube', scheduled_date: soonISO(), status: 'In Progress', thumbnail_url: 'https://example.com/t.png', asset_url: 'https://example.com/a.mp4' };

(async () => {
  const browser = await Q.launch();
  let p;
  try {
    await up({ id: A, name: 'Probe OLD ' + TS, order_index: 10, linear_issue_id: LINK, ...base });
    await up({ id: B, name: 'Probe NEW ' + TS, order_index: 11, ...base });
    ok((await poll(A, 'id,linear_issue_id', r => norm(r.linear_issue_id) === LINK)).id === A, 'seed: old card A holds the link');
    ok((await poll(B, 'id', r => r.id === B)).id === B, 'seed: new card B exists, empty');

    p = await Q.smm(browser, 'sidneylaruel');
    const ready = await p.evaluate(async (ids) => {
      try { window.onCalViewChange && window.onCalViewChange('organizer'); } catch (e) {}
      for (let i = 0; i < 30; i++) { try { await window.loadCalendarPosts({ background: true }); } catch (e) {} await new Promise(x => setTimeout(x, 700)); if (document.querySelector('[data-title-row="' + ids.A + '"]') && document.querySelector('[data-title-row="' + ids.B + '"]')) break; }
      return { a: !!document.querySelector('[data-title-row="' + ids.A + '"]'), b: !!document.querySelector('[data-title-row="' + ids.B + '"]') };
    }, { A, B });
    ok(ready.a && ready.b, 'both cards render in the SMM organizer');

    const prompt = await p.evaluate(({ ids, link }) => {
      window._calLinearEdit(ids.B, 'video');
      const inp = document.querySelector('[data-title-row="' + ids.B + '"] input.cal-linear-input');
      if (!inp) return { ok: false };
      inp.value = link; inp.blur();
      const c = document.querySelector('[data-title-row="' + ids.B + '"] .cal-link-conflict');
      return { ok: !!c, msg: c ? c.textContent.trim() : null, hasMove: !!document.querySelector('[data-title-row="' + ids.B + '"] .cal-link-conflict-move') };
    }, { ids: { A, B }, link: LINK });
    ok(prompt.ok && prompt.hasMove, 'conflict prompt with "Move it here" appears: ' + JSON.stringify(prompt.msg));

    await p.evaluate((ids) => { const b = document.querySelector('[data-title-row="' + ids.B + '"] .cal-link-conflict-move'); if (b) b.click(); }, { A, B });

    // Refetch a few times (simulating focus/realtime) and confirm B never vanishes.
    let vanished = false;
    for (let i = 0; i < 10; i++) {
      await p.evaluate(async () => { try { await window.loadCalendarPosts({ background: true }); } catch (e) {} });
      await p.waitForTimeout(1000);
      const present = await p.evaluate((id) => !!document.querySelector('[data-title-row="' + id + '"]'), B);
      if (!present) vanished = true;
    }

    const aFinal = await poll(A, 'id,linear_issue_id', r => norm(r.linear_issue_id) === '');
    const bFinal = await poll(B, 'id,linear_issue_id', r => norm(r.linear_issue_id) === LINK);
    // View-independent state oracle: open each link editor, read the prefilled
    // value (= the card's live link), Escape out without committing.
    const ev = await p.evaluate((ids) => {
      const read = (pid) => { window._calLinearEdit(pid, 'video'); const inp = document.querySelector('[data-title-row="' + pid + '"] input.cal-linear-input'); const v = inp ? inp.value : null; if (inp) { inp.dataset.cancel = '1'; inp.blur(); } return v; };
      return { B: read(ids.B), A: read(ids.A) };
    }, { A, B });

    ok(norm(bFinal.linear_issue_id) === LINK, 'BACKEND: new card B holds the moved link');
    ok(norm(aFinal.linear_issue_id) === '', 'BACKEND: old card A link cleared');
    ok(ev.B === LINK, 'STATE: B shows the link in its editor (user sees B linked)');
    ok(!ev.A, 'STATE: A editor is empty (user sees A unlinked)');
    ok(!vanished, 'new card B never vanished across refetches');
    ok(p._errs.length === 0, 'no JS errors (' + JSON.stringify(p._errs.slice(0, 4)) + ')');
  } catch (e) {
    fail++; console.log('  ❌ EXCEPTION ' + e.message + '\n' + (e.stack || ''));
  } finally {
    try { await up({ id: A, status: 'Archived' }); } catch (e) {}
    try { await up({ id: B, status: 'Archived' }); } catch (e) {}
    console.log('\nprobe_move: pass=' + pass + ' fail=' + fail, fail ? '❌' : '✅');
    try { await browser.close(); } catch (e) {}
    process.exit(fail ? 1 : 0);
  }
})();
