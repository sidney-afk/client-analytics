'use strict';
/*
 * THE STAFF BADGE NEVER COUNTS WHAT NOTES HIDES (session Notesfix, 2026-10-27). Real browser, fully mocked
 * (docs/syncview-design/tests/lost-work-lib.js: one fictional card), a staff member (the round-5 badges, no switch
 * since 2026-10-29; the old unread_badges_v2 row is still served and changes nothing).
 *
 * Notes keeps a done thread behind its history button. A client's reply inside a done change request is therefore
 * not something the staff member can see without opening history, so it must not make the Notes button say "new";
 * a new client comment outside it still does. On main before this fix the button counted both.
 */
const { createEnv, sleep, SLUG } = require('../docs/syncview-design/tests/lost-work-lib');
const CORS = { 'access-control-allow-origin': '*' };
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };
const at = min => new Date(Date.now() - min * 60000).toISOString();
const note = o => Object.assign({ parent_id: null, author: 'Casey Client', role: 'client', audience: 'client', is_tweak: false, done: false, round: 1 }, o, { root_id: o.parent_id || o.id, created_at: at(o.min), updated_at: at(o.min) });

(async () => {
  const S = await createEnv();
  try {
    S.cards[0].caption_tweaks = JSON.stringify([
      note({ id: 'd1', min: 300, is_tweak: true, done: true, done_at: at(200), body: 'Shorter caption, please.' }),
      note({ id: 'd2', parent_id: 'd1', min: 10, body: 'Thanks, that works.' }),
      note({ id: 'q1', min: 5, body: 'Can we post this on Friday?' }),
    ]);
    await S.ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
      const raw = new URL(route.request().url()).searchParams.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({
        key: k, value: k === 'unread_badges_v2' ? { staff: ['m1'] } : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false } }));
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
    });
    await S.ctx.route('**/functions/v1/production-comments{,?*}', route => {
      let b = {};
      try { b = route.request().method() === 'GET' ? { action: new URL(route.request().url()).searchParams.get('action') } : JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (b.action === 'inbox') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, scope: 'all', conversations: [], pictures: {} }) });
      return route.fallback();
    });
    const page = await S.newPage();
    await S.openCalendar(page);
    await page.waitForFunction(() => document.documentElement.classList.contains('sv-unread2') && document.querySelector('.cal-foot-tweaks[data-comments-wrap="p_t1"].svu-foot'), null, { timeout: 15000 });
    await sleep(600);
    const nums = await page.evaluate(() => [...document.querySelectorAll('.cal-foot-tweaks[data-comments-wrap="p_t1"] .svu-num')].map(n => n.textContent));
    const total = nums.reduce((s, n) => s + Number(n || 0), 0);
    console.log('     ' + JSON.stringify(nums));
    check(total === 1, 'the Notes button counts 1 (the new question), not the reply inside the done change request (' + JSON.stringify(nums) + ')');
    await page.evaluate(() => openCalComments('p_t1'));
    await page.waitForSelector('#calCommentsModal .cal-cm-row[data-cm-row]');
    await sleep(400);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#calCommentsModal .cal-cm-row[data-cm-row]')].map(r => r.getAttribute('data-cm-row')));
    check(rows.includes('q1') && !rows.includes('d2'), 'Notes shows the question and keeps the done thread in history (' + rows.join() + ')');
    check(!page.errors.length, 'no page errors ' + JSON.stringify(page.errors));
  } catch (e) {
    failures.push(String(e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  if (failures.length) { console.log('\nstaff-done-thread-badge-browser: ' + failures.length + ' failed'); process.exit(1); }
  console.log('\nstaff-done-thread-badge-browser: all checks passed');
})();
