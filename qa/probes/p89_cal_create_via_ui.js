// p89_cal_create_via_ui.js — CALENDAR create-via-UI + ghost-card gate + the
// generic state-vs-DB divergence check, on the CONTENT CALENDAR surface.
//
// Why: the SXR ghost-card bug (GA 2026-07-02) lived in the create funnel that
// no scenario drove via the UI. The calendar's funnel is a DIFFERENT design —
// addCalBlankCard is DOM-only (no optimistic push into calState.posts), the
// blank post object is born inside _calFlushCardSave's wasNewRow branch — so
// it structurally can't hit the stale-blank shape. This probe PINS that: born
// in the browser ("+" → type → blur), then
//   1. exactly ONE .cal-card in #calStrip with that name, ZERO __blank__ cards
//   2. exactly ONE entry in calState.posts with that name (non-blank id)
//   3. exactly ONE live calendar_posts row for the test client with that name
//   4. rename immediately after create (the promote-race) → still one of each
//   5. generic divergence: calState.posts (non-blank, settled) id-set ≡ live
//      calendar_posts id-set for sidneylaruel
// Cleanup: archives every row it minted (archiveCalSafe, verified).
const L = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const note = (ok, msg, extra) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}${extra ? '  [' + extra + ']' : ''}`); ok ? pass++ : fail++; };

(async () => {
  const ts = Date.now();
  const NAME1 = 'CAL UI Create ' + ts;
  const NAME2 = 'CAL UI Renamed ' + ts;
  const minted = new Set();
  const browser = await L.launch();
  let page;
  try {
    page = await L.smmCal(browser);
    await page.waitForFunction(() => !!document.querySelector('#calStrip .cal-card-add'), { timeout: 20000 }).catch(() => {});

    // --- create via the real UI ---
    const clicked = await page.evaluate(() => {
      const add = document.querySelector('#calStrip .cal-card-add');
      if (!add) return 'no-add-btn';
      add.click(); return 'ok';
    });
    note(clicked === 'ok', 'click calendar "+"', clicked);
    await page.waitForTimeout(500);
    const typed = await page.evaluate((nm) => {
      const blanks = [...document.querySelectorAll('#calStrip .cal-card[data-pid^="__blank__"]')];
      const card = blanks[blanks.length - 1];
      if (!card) return 'no-blank-card';
      const inp = card.querySelector('.cal-fld-name');
      if (!inp) return 'no-name-field';
      inp.focus(); inp.value = nm;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.blur();
      return 'ok';
    }, NAME1);
    note(typed === 'ok', 'type name + blur (create funnel)', typed);

    // --- rename IMMEDIATELY, inside the promote window (the save from the blur
    // is still in flight; the card may still carry its blank pid). This is the
    // historical calendar ghost shape: an edit through a stale blank pid made
    // _calFlushCardSave mint a SECOND id and push a ghost row. Verified
    // red/green 2026-07-02: with _calPromoteBlankCard disabled this rename
    // strands "CAL UI Create *" as a second live row and the old-name-gone
    // check below goes red. Renaming only after the save settles would let a
    // full re-render heal the DOM first and hide the bug.
    await page.waitForTimeout(250);
    const ren = await page.evaluate((args) => {
      const [from, to] = args;
      const card = [...document.querySelectorAll('#calStrip .cal-card[data-pid]')].find(c => { const i = c.querySelector('.cal-fld-name'); return i && i.value === from; });
      if (!card) return 'no-card';
      const inp = card.querySelector('.cal-fld-name');
      inp.focus(); inp.value = to;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.blur();
      return 'ok';
    }, [NAME1, NAME2]);
    note(ren === 'ok', 'rename mid-save (inside the promote window)', ren);

    // --- gate: exactly one card / one state entry / one live row ---
    const gate = async (nm) => {
      let dom = null, rows = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        dom = await page.evaluate((n) => {
          const strip = document.getElementById('calStrip');
          if (!strip) return null;
          const named = [...strip.querySelectorAll('.cal-card[data-pid]')].filter(c => { const i = c.querySelector('.cal-fld-name'); return i && i.value === n; });
          // calState is a script-scope const, NOT a window property — reach it by identifier.
          const statePosts = (typeof calState !== 'undefined' && calState && Array.isArray(calState.posts)) ? calState.posts : [];
          const stateNamed = statePosts.filter(p => String(p.name || '') === n);
          const pend = (typeof _calPendingEdits !== 'undefined') ? Object.keys(_calPendingEdits).length : 0;
          const inflight = (typeof _calSaveInFlight !== 'undefined') ? Object.keys(_calSaveInFlight).length : 0;
          return {
            cards: named.length,
            blanks: named.filter(c => (c.getAttribute('data-pid') || '').startsWith('__blank__')).length,
            pids: named.map(c => c.getAttribute('data-pid')),
            state: stateNamed.length,
            stateIds: stateNamed.map(p => p.id),
            settled: pend === 0 && inflight === 0,
          };
        }, nm);
        try { rows = L.supaCal('client=eq.sidneylaruel&name=eq.' + encodeURIComponent(nm) + '&or=(status.neq.Archived,status.is.null)&select=id,name') || []; } catch { rows = []; }
        (Array.isArray(rows) ? rows : []).forEach(r => minted.add(r.id));
        (dom && dom.stateIds || []).filter(x => x && !String(x).startsWith('__blank__')).forEach(x => minted.add(x));
        if (dom && dom.settled && dom.cards === 1 && Array.isArray(rows) && rows.length === 1) break;
        await new Promise(s => setTimeout(s, 700));
      }
      return { dom, rows };
    };

    let g = await gate(NAME2);
    note(g.dom && g.dom.cards === 1 && g.dom.blanks === 0, `DOM: exactly one card "${NAME2}", zero blanks`, g.dom ? `cards=${g.dom.cards} blanks=${g.dom.blanks} pids=${JSON.stringify(g.dom.pids)}` : 'no strip');
    note(g.dom && g.dom.state === 1, 'calState.posts: exactly one entry', g.dom ? `state=${g.dom.state} ids=${JSON.stringify(g.dom.stateIds)}` : '');
    note(Array.isArray(g.rows) && g.rows.length === 1, 'DB: exactly one live calendar_posts row', `rows=${Array.isArray(g.rows) ? g.rows.length : 'err'}`);
    // the old name must be fully gone everywhere
    const gOld = await page.evaluate((n) => ((typeof calState !== 'undefined' && calState && calState.posts) || []).filter(p => String(p.name || '') === n).length, NAME1);
    let rowsOld = [];
    try { rowsOld = L.supaCal('client=eq.sidneylaruel&name=eq.' + encodeURIComponent(NAME1) + '&or=(status.neq.Archived,status.is.null)&select=id') || []; } catch {}
    (Array.isArray(rowsOld) ? rowsOld : []).forEach(r => minted.add(r.id));
    note(gOld === 0 && rowsOld.length === 0, 'old name fully gone (no orphan row from the rename race)', `state=${gOld} db=${rowsOld.length}`);

    // --- the GENERIC divergence gate, calendar edition ---
    const st = await page.evaluate(() => {
      const posts = ((typeof calState !== 'undefined' && calState && calState.posts) || [])
        .filter(p => p && !(typeof _calIsBlankId === 'function' && _calIsBlankId(p.id)))
        .filter(p => !p._saveError && !(typeof _calFailedNewCards !== 'undefined' && _calFailedNewCards.has(p.id)))
        .map(p => p.id);
      return posts;
    });
    let all = [];
    try { all = L.supaCal('client=eq.sidneylaruel&or=(status.neq.Archived,status.is.null)&select=id') || []; } catch {}
    // p_cal_settings is the per-client config row — persisted in calendar_posts
    // but never loaded into calState.posts; not a divergence.
    const dbIds = new Set((Array.isArray(all) ? all : []).map(r => r.id).filter(x => x !== 'p_cal_settings'));
    const locIds = new Set(st);
    const extraLocal = st.filter(x => !dbIds.has(x));
    const extraDb = [...dbIds].filter(x => !locIds.has(x));
    const dup = st.length !== locIds.size;
    note(!extraLocal.length && !extraDb.length && !dup, `divergence gate: calState ≡ calendar_posts (${st.length} rows)`,
      (extraLocal.length ? 'local-only: ' + extraLocal.join(',') + ' ' : '') + (extraDb.length ? 'db-only: ' + extraDb.join(',') + ' ' : '') + (dup ? 'DUPLICATE id in state' : ''));

    // 0-app-JS-errors gate
    const errs = L.appErrs(page) || [];
    note(errs.length === 0, '0 app JS errors', errs.slice(0, 3).join(' | ').slice(0, 200));
  } catch (e) {
    note(false, 'EXCEPTION: ' + (e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    for (const id of minted) { try { L.archiveCalSafe(id); } catch {} }
  }
  console.log(`pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('RUNNER ERROR', e && e.stack || e); process.exit(2); });
