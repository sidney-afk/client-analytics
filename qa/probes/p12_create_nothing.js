// p12 — §4.1/§9: create a blank card and save NOTHING. An empty, untouched blank card must
// NOT persist (no phantom row on reload). A named card SHOULD persist.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const NAME = 'CREATED-' + TS;

(async () => {
  const S = Q.makeOk('P12 create-nothing');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  let createdId = null;
  try {
    // ensure organizer view (has the add affordance + strip)
    await smm.evaluate(async () => { try { calState.view='organizer'; _calRenderBody({preserveScroll:false}); } catch(e){} await new Promise(x=>setTimeout(x,400)); });

    // 1) add a blank card, touch NOTHING, reload → count unchanged.
    const r1 = await smm.evaluate(async () => {
      const before = (calState.posts||[]).length;
      try { addCalBlankCard(); } catch(e){ return { err: e.message }; }
      const blankInDom = document.querySelectorAll('.cal-card.is-blank').length;
      // reload from backend
      try { await loadCalendarPosts(); } catch(e){}
      await new Promise(x=>setTimeout(x,1500));
      const after = (calState.posts||[]).length;
      return { before, blankInDom, after };
    });
    console.log('blank-nothing:', JSON.stringify(r1));
    S.ok(r1.blankInDom >= 1, 'blank card was inserted in the DOM');
    S.ok(r1.after === r1.before, 'empty blank card did NOT persist (post count unchanged after reload)');

    // 2) add a blank card and TYPE a name → should persist as a real card.
    const r2 = await smm.evaluate(async (name) => {
      try { calState.view='organizer'; _calRenderBody({preserveScroll:false}); } catch(e){}
      await new Promise(x=>setTimeout(x,300));
      try { addCalBlankCard(); } catch(e){ return { err:e.message }; }
      await new Promise(x=>setTimeout(x,200));
      const input = document.querySelector('.cal-card.is-blank .cal-fld-name');
      if (!input) return { err:'no blank name input' };
      input.value = name;
      input.dispatchEvent(new Event('input', { bubbles:true }));
      input.dispatchEvent(new Event('blur', { bubbles:true }));
      await new Promise(x=>setTimeout(x,2500));
      // find the real id now in calState
      const p = (calState.posts||[]).find(x => x.name === name);
      return { id: p ? p.id : null };
    }, NAME);
    console.log('named-create:', JSON.stringify(r2));
    createdId = r2.id;
    S.ok(!!createdId && !createdId.startsWith('__blank__'), 'named card persisted with a real id (' + createdId + ')');
    if (createdId) {
      const bk = await Q.pollRaw(createdId, r => r.name === NAME, 'name', 12000);
      S.ok(bk.name === NAME, 'named card reached the backend');
    }
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0,3)) + ')');
  } finally {
    if (createdId) await Q.up({ id: createdId, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
