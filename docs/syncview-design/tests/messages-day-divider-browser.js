'use strict';
/* messages-day-divider-browser.js -- the day dividers in a Messages chat.
 *
 * Found by session Patrol on 2026-10-17. The chat grouped notes by the first
 * ten characters of their UTC timestamp, so for the team (UTC-6) a note sent
 * at 7:30pm landed under the NEXT day; and on a desktop the divider read
 * "2026-10-17" while the phone read "Sat, 17 Oct 2026". Now every note sits
 * under its own local day, and the divider reads as a date on every screen.
 *
 * Fully mocked (lost-work-lib.js), fictional data, browser clock in
 * America/Guatemala.  Run: node docs/syncview-design/tests/messages-day-divider-browser.js
 */
const { createEnv, sleep } = require('./lost-work-lib');
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };

const MSGS = [
  // 9:00am, 7:30pm and 11:55pm on Saturday 17 October (UTC-6), then Sunday 10am.
  { id: 'd1', parent_id: null, root_id: 'd1', author: 'Fixture SMM', role: 'smm', audience: 'internal', is_tweak: false, component: 'video', body: 'Morning note.', created_at: '2026-10-17T15:00:00.000Z' },
  { id: 'd2', parent_id: null, root_id: 'd2', author: 'Fixture SMM', role: 'smm', audience: 'internal', is_tweak: false, component: 'video', body: 'Evening note.', created_at: '2026-10-18T01:30:00.000Z' },
  { id: 'd3', parent_id: null, root_id: 'd3', author: 'Fixture SMM', role: 'smm', audience: 'internal', is_tweak: false, component: 'video', body: 'Late note.', created_at: '2026-10-18T05:55:00.000Z' },
  { id: 'd4', parent_id: null, root_id: 'd4', author: 'Fixture SMM', role: 'smm', audience: 'internal', is_tweak: false, component: 'video', body: 'Next morning note.', created_at: '2026-10-18T16:00:00.000Z' },
];

async function run(width) {
  const S = await createEnv({ context: { timezoneId: 'America/Guatemala', viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 } });
  try {
    await S.ctx.route('**/functions/v1/production-comments', async route => {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (route.request().method() === 'OPTIONS' || (body.action !== 'inbox' && body.action !== 'inbox_mark')) return route.fallback();
      const reply = obj => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
      if (body.action === 'inbox_mark') return reply({ ok: true, post_id: body.post_id, last_read_at: '2026-10-20T00:00:00.000Z' });
      const last = MSGS[MSGS.length - 1];
      return reply({ ok: true, scope: 'all', conversations: [{ post_id: 'p_t1', client_slug: 'fixtureclient', client_name: 'fixtureclient', title: 'Day divider fixture', thumbnail_url: '', asset_url: '', status: 'In Progress',
        messages: MSGS, last_at: last.created_at, last_author: last.author, last_author_member_id: '', last_role: last.role, last_body: last.body, unread: 0 }] });
    });
    const page = await S.newPage();
    await S.openCalendar(page);
    await page.evaluate(() => navTo('messages'));
    await page.evaluate(() => _msgSetFilter('all'));   // the switch opens on New; this test reads a conversation that is already read
    const tag = width + 'px';
    check(await until(() => page.evaluate(() => !!document.querySelector('#msgPage [data-msg-conv="p_t1"]'))), tag + ': the conversation is listed');
    await page.click('#msgPage [data-msg-conv="p_t1"]');
    check(await until(() => page.evaluate(() => document.querySelectorAll('#msgPage .msg-b').length >= 4)), tag + ': the chat shows all four notes');
    const order = await page.evaluate(() => {
      const chat = document.querySelector('#msgPage .msg-day').parentElement;
      return [...chat.querySelectorAll('.msg-day, .msg-b-text')].map(n => n.classList.contains('msg-day') ? '#' + n.textContent.trim() : n.textContent.trim());
    });
    const days = order.filter(x => x[0] === '#');
    check(days.length === 2, tag + ': two day dividers for two local days (' + JSON.stringify(days) + ')');
    check(days[0] === '#Sat, 17 Oct 2026' && days[1] === '#Sun, 18 Oct 2026', tag + ': dividers read as dates (' + JSON.stringify(days) + ')');
    const sun = order.indexOf('#Sun, 18 Oct 2026');
    check(sun > order.indexOf('Evening note.') && sun > order.indexOf('Late note.') && sun < order.indexOf('Next morning note.'),
      tag + ': the 7:30pm and 11:55pm notes stay under Saturday ' + JSON.stringify(order));
    check(!(page.errors || []).length, tag + ': no page errors');
  } catch (e) {
    failures.push(String(e && e.stack || e)); console.error(e);
  } finally { await S.close(); }
}

(async () => {
  await run(1280);
  await run(390);
  if (failures.length) { console.log('\nmessages-day-divider-browser: ' + failures.length + ' failed'); process.exit(1); }
  console.log('\nmessages-day-divider-browser: all checks passed');
})();
