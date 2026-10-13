'use strict';
/* notes-composer-threads-browser.js -- Notes, Step 1 (docs/plans/2026-10-13-notes-messages.md).
 *
 * Drives the real Calendar Notes dialog, fully mocked (lost-work-lib.js), and
 * proves the owner-approved composer and threads:
 *   A  the staff composer is the message box plus one quiet line: no
 *      "Who sees this?" or "This is a..." rows; the default is a comment to
 *      Kasper / the team about the selected part, sent with no extra click
 *   B  the lock/eye icon switches to the client: the box turns blue, the quiet
 *      line says so, the "Request change" arrow is switched off, and the note
 *      is saved with audience client
 *   C  the Send arrow's "Request change" sends a team-only change request on
 *      the selected part and moves only that part to Tweaks Needed
 *   D  a reply carries no audience icon and no arrow (it inherits its thread)
 *   E  threads fold with the rail to "n replies" and open again
 *   F  Escape closes the Send menu
 * Nothing reaches a live backend.
 */
const { createEnv, sleep } = require('./lost-work-lib');
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };
const parse = v => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch (e) { return []; } };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };

(async () => {
  const S = await createEnv();
  try {
    const page = await S.newPage();
    await S.openCalendar(page);
    await page.evaluate(() => { openCalComments('p_t1'); });
    await page.waitForSelector('#calCommentsModal .cal-cm-composer');
    await page.evaluate(() => _calSetComposeComp('caption'));

    // A
    const shape = await page.evaluate(() => ({
      rows: document.querySelectorAll('#calCommentsModal [data-cm-toggle="audience"], #calCommentsModal [data-cm-toggle="tweak"]').length,
      icon: !!document.querySelector('#calCommentsModal .cal-cm-aud-icon'),
      quiet: (document.querySelector('#calCommentsModal [data-cm-quiet]') || {}).textContent,
      more: !!document.querySelector('#calCommentsModal .cal-cm-send-more'),
    }));
    check(shape.rows === 0, 'A: no audience or type rows above the box');
    check(shape.icon && shape.more, 'A: audience icon inside the box and the Send arrow are there');
    check(shape.quiet === 'Team only · Caption', 'A: quiet line reads "Team only · Caption"');
    await page.fill('#calCommentComposer', 'Fixture team note');
    await page.press('#calCommentComposer', 'Enter');
    check(await until(() => parse(S.card('p_t1').caption_tweaks || S.card('p_t1').caption_comments).some(c => c.body === 'Fixture team note')), 'A: Enter sends the note');
    const a = parse(S.card('p_t1').caption_tweaks || S.card('p_t1').caption_comments).find(c => c.body === 'Fixture team note') || {};
    check(a.audience === 'internal' && a.is_tweak === false, 'A: saved as a team-only comment');
    check(S.card('p_t1').caption_status === 'In Progress', 'A: a comment changes no status');

    // B
    await page.click('#calCommentsModal .cal-cm-aud-icon');
    await page.fill('#calCommentComposer', 'Fixture client note');
    const b = await page.evaluate(() => ({
      blue: document.querySelector('#calCommentsModal .cal-cm-composer').classList.contains('is-to-client'),
      quiet: document.querySelector('#calCommentsModal [data-cm-quiet]').textContent,
      moreOff: document.querySelector('#calCommentsModal .cal-cm-send-more').disabled,
    }));
    check(b.blue, 'B: the box turns blue');
    check(b.quiet === 'The client will see this · Caption', 'B: quiet line says the client will see it');
    check(b.moreOff, 'B: Request change is off when writing to the client');
    await page.click('#calCommentsModal .cal-cm-send');
    check(await until(() => parse(S.card('p_t1').caption_tweaks || S.card('p_t1').caption_comments).some(c => c.body === 'Fixture client note')), 'B: the note is sent');
    const bn = parse(S.card('p_t1').caption_tweaks || S.card('p_t1').caption_comments).find(c => c.body === 'Fixture client note') || {};
    check(bn.audience === 'client' && bn.is_tweak === false, 'B: saved with audience client');
    await page.click('#calCommentsModal .cal-cm-aud-icon');

    // D + E
    await page.evaluate(() => { const p = calState.posts.find(x => x.id === 'p_t1'); const root = (p.caption_comments || []).find(c => c.body === 'Fixture client note'); _calBeginReply(root.id); });
    const d = await page.evaluate(() => ({ icon: !!document.querySelector('#calCommentsModal .cal-cm-aud-icon'), more: !!document.querySelector('#calCommentsModal .cal-cm-send-more'), quiet: !!document.querySelector('#calCommentsModal [data-cm-quiet]') }));
    check(!d.icon && !d.more && !d.quiet, 'D: a reply has no audience icon, arrow or quiet line');
    await page.fill('#calCommentComposer', 'Fixture reply');
    await page.press('#calCommentComposer', 'Enter');
    await until(() => page.evaluate(() => !!document.querySelector('#calCommentsModal .cal-cm-rail')));
    const rootId = await page.evaluate(() => document.querySelector('#calCommentsModal .cal-cm-rail').closest('[data-thread]').getAttribute('data-thread'));
    const notice = await page.evaluate(() => { const o = document.getElementById('confirmOverlay'); return o && o.classList.contains('active') ? document.getElementById('confirmTitle').textContent + ' / ' + document.getElementById('confirmMsg').textContent : ''; });
    check(!notice, 'D: no notice after the reply ' + notice);
    await page.click(`#calCommentsModal [data-thread="${rootId}"] .cal-cm-rail`);
    const e1 = await page.evaluate(id => { const t = document.querySelector(`#calCommentsModal [data-thread="${id}"]`); return { folded: t.classList.contains('is-collapsed'), link: (t.querySelector('.cal-cm-more-replies') || {}).textContent, replies: t.querySelectorAll('.cal-cm-row.is-reply').length }; }, rootId);
    check(e1.folded && e1.link === '1 reply' && e1.replies === 0, 'E: the rail folds the thread to "1 reply"');
    await page.click(`#calCommentsModal [data-thread="${rootId}"] .cal-cm-more-replies`);
    const e2 = await page.evaluate(id => document.querySelectorAll(`#calCommentsModal [data-thread="${id}"] .cal-cm-row.is-reply`).length, rootId);
    check(e2 === 1, 'E: "1 reply" opens it again');
    // C + F
    await page.fill('#calCommentComposer', 'Fixture change request');
    await page.click('#calCommentsModal .cal-cm-send-more');
    check(await page.isVisible('#calCommentsModal .cal-cm-send-menu'), 'C: the arrow opens the menu');
    await page.keyboard.press('Escape');
    check(!(await page.isVisible('#calCommentsModal .cal-cm-send-menu')), 'F: Escape closes the menu');
    await page.click('#calCommentsModal .cal-cm-send-more');
    await page.click('#calCommentsModal .cal-cm-send-menu button');
    check(await until(() => S.card('p_t1').caption_status === 'Tweaks Needed'), 'C: Request change moves the caption to Tweaks Needed');
    const cn = parse(S.card('p_t1').caption_tweaks || S.card('p_t1').caption_comments).find(c => c.body === 'Fixture change request') || {};
    check(cn.audience === 'internal' && cn.is_tweak === true, 'C: saved as a team-only change request');
    check(S.card('p_t1').video_status === 'In Progress' && S.card('p_t1').graphic_status === 'In Progress', 'C: other parts keep their status');

    check(!page.errors.length, 'no page errors ' + JSON.stringify(page.errors));
  } catch (e) {
    failures.push(String(e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  if (failures.length) { console.log('\nnotes-composer-threads-browser: ' + failures.length + ' failed'); process.exit(1); }
  console.log('\nnotes-composer-threads-browser: all checks passed');
})();
