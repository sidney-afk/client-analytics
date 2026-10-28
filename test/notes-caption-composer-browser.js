'use strict';
/*
 * STAFF CAN WRITE TO THE CLIENT ABOUT THE CAPTION ON A PRODUCTION-LINKED CARD (session Notesfix, 2026-10-27).
 * Real browser, fully mocked (docs/syncview-design/tests/lost-work-lib.js: one fictional card whose Video and
 * Thumbnail are linked to Production deliverables, its Caption not).
 *
 * In the staff Notes composer a linked Video or Thumbnail is team only (its canonical thread; no eye button). The
 * Caption has no canonical thread, so picking it must offer the client audience at once, without the dialog being
 * redrawn by something else; and picking Video again takes the eye button away. A draft in the box survives the switch.
 * On main before this fix, clicking Caption only moved the highlight: the eye button never appeared.
 */
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };

(async () => {
  const S = await createEnv();
  try {
    // The card's link lookup (the crosswalk) asks for its deliverables by `id=in.(...)`.
    await S.ctx.route('**/rest/v1/deliverables**', route => {
      const raw = new URL(route.request().url()).searchParams.get('id') || '';
      const ids = raw.replace(/^(in\.\(|eq\.)/, '').replace(/\)$/, '').split(',').map(x => x.replace(/"/g, '')).filter(Boolean);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(S.deliv.filter(d => !ids.length || ids.includes(d.id))) });
    });
    const page = await S.newPage();
    await S.openCalendar(page);
    await page.evaluate(() => { openCalComments('p_t1'); });
    await page.waitForSelector('#calCommentsModal .cal-cm-composer');
    const box = () => page.evaluate(() => ({
      comp: (document.querySelector('#calCommentsModal [data-cm-toggle="comp"] .cal-cm-aud-btn.is-active') || {}).textContent || '',
      eye: !!document.querySelector('#calCommentsModal .cal-cm-aud-icon'),
      quiet: (document.querySelector('#calCommentsModal [data-cm-quiet]') || {}).textContent || '',
      draft: (document.getElementById('calCommentComposer') || {}).value || '',
    }));
    // The linked Video: its canonical read settles, and the box is team only.
    check(await until(async () => { const b = await box(); return b.comp === 'Video' && !b.eye; }), 'the linked Video is team only (no eye button)');
    await page.fill('#calCommentComposer', 'Fixture draft about the caption');
    await page.click('#calCommentsModal [data-cm-toggle="comp"] .cal-cm-aud-btn[data-comp="caption"]');
    await sleep(150);
    const c1 = await box();
    console.log('     ' + JSON.stringify(c1));
    check(c1.comp === 'Caption' && c1.eye, 'picking Caption shows the eye button at once');
    check(c1.quiet === 'Team only · Caption', 'the quiet line names the Caption (' + c1.quiet + ')');
    check(c1.draft === 'Fixture draft about the caption', 'the draft in the box survives the switch');
    await page.click('#calCommentsModal .cal-cm-aud-icon');
    const c2 = await box();
    check(/The client will see this · Caption/.test(c2.quiet), 'the eye button switches the Caption note to the client (' + c2.quiet + ')');
    await page.click('#calCommentsModal [data-cm-toggle="comp"] .cal-cm-aud-btn[data-comp="video"]');
    await sleep(150);
    const c3 = await box();
    check(c3.comp === 'Video' && !c3.eye && c3.quiet === 'Team only · Video', 'picking the linked Video again takes the eye button away and is team only (' + c3.quiet + ')');
    check(!page.errors.length, 'no page errors ' + JSON.stringify(page.errors));
  } catch (e) {
    failures.push(String(e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  if (failures.length) { console.log('\nnotes-caption-composer-browser: ' + failures.length + ' failed'); process.exit(1); }
  console.log('\nnotes-caption-composer-browser: all checks passed');
})();
