'use strict';
/* messages-new-view-browser.js -- the Messages inbox's "New / All" switch and what counts as new
 * (owner request, 2026-10-18). Fully mocked (lost-work-lib.js, a local answer for production-comments'
 * `inbox` / `inbox_mark`, and the fake realtime channel). The server's real rules (inbox.mjs) decide counts.
 *   A  a client's automatic caption-change record does not raise the badge and does not show as new, but is
 *      still listed under All
 *   B  the switch defaults to New, shows "New" (with the count when there is one) and "All", and the New view
 *      with nothing new says "No new messages"
 *   C  a manager's message to the reviewer raises the badge live (a realtime change on the cards), without a reload
 *   D  reading it in ANOTHER tab clears the badge here live, without a reload
 *   E  opening a conversation in the New view keeps it on screen while it is open
 * With SCREENSHOTS=<dir>, light and dark captures at 1440 and 390 are written there. Fictional data only.
 */
const fs = require('fs');
const path = require('path');
const { createEnv, sleep } = require('./lost-work-lib');
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };
const SHOTS = process.env.SCREENSHOTS || '';
const T = (d, h = 10) => `2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;

(async () => {
  const S = await createEnv();
  const inbox = await import(require('node:url').pathToFileURL(path.join(__dirname, '../../../supabase/functions/production-comments/inbox.mjs')).href);
  const ME = { id: 'm1', name: 'Browser Staff', role: 'admin' };
  const NOW = Date.parse('2026-10-18T12:00:00.000Z');
  const reads = new Map();
  const CAPTION = 'Changed the caption to:\n\nOpen daily from nine.\n\nIt was:\n\nOpen daily.';
  const convs = [
    { post_id: 'p_cap', client_slug: 'fixtureclient', client_name: 'Fixture Client', title: 'Opening hours reel', thumbnail_url: '', asset_url: '', status: 'In Progress',
      messages: [{ id: 'k1', parent_id: null, root_id: 'k1', author: 'Fixture Client', role: 'client', audience: 'client', is_tweak: false, component: 'caption', body: CAPTION, created_at: T(17) }] },
    { post_id: 'p_mgr', client_slug: 'fixtureclient', client_name: 'Fixture Client', title: 'Behind the scenes', thumbnail_url: '', asset_url: '', status: 'In Progress',
      messages: [{ id: 'k2', parent_id: null, root_id: 'k2', author: 'Browser Staff', author_member_id: 'm1', role: 'kasper', audience: 'internal', is_tweak: false, component: 'video', body: 'Please check the first cut.', created_at: T(16) }] },
  ];
  const marks = [];
  try {
    await S.ctx.route('**/rest/v1/team_members**', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }, { id: 'm7', name: 'Robin Testwell', role: 'smm', team: null, active: true }]) }));
    await S.ctx.route('**/functions/v1/production-comments{,?*}', async route => {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (route.request().method() === 'GET') body = { action: new URL(route.request().url()).searchParams.get('action') || '' };   // the inbox list is read with GET ?action=inbox
      if (route.request().method() === 'OPTIONS' || (body.action !== 'inbox' && body.action !== 'inbox_mark')) return route.fallback();
      const reply = obj => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
      const list = () => convs.map(c => {
        const last = c.messages[c.messages.length - 1];
        return { ...c, last_at: last.created_at, last_author: last.author, last_author_member_id: last.author_member_id || '', last_role: last.role, last_body: last.body,
          unread: inbox.unreadCount(c.messages, ME, reads.get(c.post_id) || '', NOW, 'reviewer') };
      }).sort((a, b) => b.last_at.localeCompare(a.last_at));
      if (body.action === 'inbox') return reply({ ok: true, scope: 'all', conversations: list() });
      marks.push(body.post_id + ':' + body.state);
      const c = convs.find(x => x.post_id === body.post_id);
      if (!c) return reply({ ok: false, error: 'forbidden' });
      const mark = body.state === 'read' ? '2026-10-18T09:30:00.000Z' : inbox.unreadMark(c.messages, ME, 'reviewer');
      reads.set(body.post_id, mark);
      return reply({ ok: true, post_id: body.post_id, last_read_at: mark });
    });

    const openMessages = async (pg) => {
      await S.openCalendar(pg);
      await pg.evaluate(() => { navTo('kasper'); });
      await pg.waitForFunction(() => typeof svAreaApi === 'function' && !!svAreaApi('kasper'), null, { timeout: 20000 });
      await pg.evaluate(() => _kasperGotoTab('replies'));
      await pg.waitForFunction(() => currentNav === 'messages' && document.querySelectorAll('#msgPage .msg-filters button').length === 2, null, { timeout: 20000 });
    };
    const state = pg => pg.evaluate(() => ({
      count: (document.querySelector('#navMessages [data-msg-count]') || {}).textContent,
      countHidden: !!(document.querySelector('#navMessages [data-msg-count]') || {}).hidden,
      tabs: [...document.querySelectorAll('#msgPage .msg-filters button')].map(b => b.textContent.trim()),
      active: ((document.querySelector('#msgPage .msg-filters button.is-active') || {}).textContent || '').trim(),
      rows: [...document.querySelectorAll('#msgPage .msg-conv')].map(r => ({ id: r.getAttribute('data-msg-conv'), unread: r.classList.contains('is-unread'), badge: !!r.querySelector('.msg-unread') })),
      empty: ((document.querySelector('#msgPage .msg-list-empty') || {}).textContent || '').trim(),
    }));

    const page = await S.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMessages(page);
    await page.evaluate(() => { window.__noReload = 1; });
    const shot = async (pg, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
    const theme = (pg, t) => pg.evaluate(t => document.documentElement.setAttribute('data-theme', t), t);
    const sweep = async (tag) => {
      for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
        await page.setViewportSize({ width: w, height: h });
        for (const t of ['light', 'dark']) {
          await theme(page, t);
          await page.evaluate(() => _msgSetFilter('new')); await sleep(250); await shot(page, `${tag}-${label}-${t}-new`);
          await page.evaluate(() => _msgSetFilter('all')); await sleep(250); await shot(page, `${tag}-${label}-${t}-all`);
        }
      }
      await theme(page, 'light'); await page.setViewportSize({ width: 1440, height: 900 }); await page.evaluate(() => _msgSetFilter('new'));
    };

    // A + B
    let s = await state(page);
    check(s.tabs.join('|') === 'New|All', 'B: the switch has two options, New and All (' + s.tabs.join('|') + ')');
    check(s.active === 'New', 'B: the switch opens on New (' + s.active + ')');
    check(s.countHidden || s.count === '0', 'A: the caption-change record raises no badge (' + s.count + ')');
    check(s.empty === 'No new messages', 'B: nothing new shows the calm empty state "No new messages" (' + s.empty + ')');
    check(s.rows.length === 0, 'A: the caption-change record is not listed as new');
    await page.setViewportSize({ width: 390, height: 844 });
    const phoneLook = await page.evaluate(() => [...document.querySelectorAll('#msgPage .msg-filters button')].map(b => ({ t: b.textContent.trim(), tt: getComputedStyle(b).textTransform, fv: getComputedStyle(b).fontVariant })));
    
    check(phoneLook.every(b => b.tt === 'none' && /^(New|All)/.test(b.t)), 'B: on a phone the labels read New and All, not changed to lower case');
    await page.setViewportSize({ width: 1440, height: 900 });
    await sweep('empty');
    await page.evaluate(() => _msgSetFilter('all'));
    s = await state(page);
    check(s.rows.length === 2, 'A: under All both conversations are listed, the record included (' + s.rows.length + ')');
    check(s.rows.every(r => !r.unread && !r.badge), 'A: neither is bold or badged');

    // C: a manager writes to the reviewer; the cards change in realtime
    convs[1].messages.push({ id: 'k3', parent_id: 'k2', root_id: 'k2', author: 'Robin Testwell', author_member_id: 'm7', role: 'smm', audience: 'internal', is_tweak: false, component: 'video', body: 'Checked, one small trim left.', created_at: T(18, 9) });
    await S.realtime();
    check(await until(async () => (await state(page)).count === '1'), "C: a manager's message raises the badge live, with no reload");
    check(await page.evaluate(() => window.__noReload === 1), 'C: the page was not reloaded');
    s = await state(page);
    check(s.tabs[0] === 'New · 1', 'C: the switch shows the count on New (' + s.tabs[0] + ')');
    check(s.rows.find(r => r.id === 'p_mgr').unread && s.rows.find(r => r.id === 'p_mgr').badge, 'C: that conversation is bold with a count');
    check(!s.rows.find(r => r.id === 'p_cap').unread, 'C: the caption-change record still is not');
    await page.evaluate(() => _msgSetFilter('new'));
    s = await state(page);
    check(s.rows.length === 1 && s.rows[0].id === 'p_mgr', 'B: New lists only the manager conversation');
    await sweep('unread');

    // D: read in another tab
    const other = await S.newPage();
    await openMessages(other);
    await other.evaluate(() => _msgSetFilter('all'));
    await other.click('#msgPage [data-msg-conv="p_mgr"]');
    check(await until(() => marks.includes('p_mgr:read')), 'D: the other tab reads the conversation');
    check(await until(async () => { const x = await state(page); return x.countHidden || x.count === '0'; }), 'D: the badge here clears live, with no reload');
    s = await state(page);
    check(s.tabs[0] === 'New' && s.empty === 'No new messages', 'D: the switch drops its count and the New view is calm again');
    check(await page.evaluate(() => window.__noReload === 1), 'D: the page was not reloaded');

    // E: opening keeps the conversation on screen in the New view
    await other.close();
    convs[1].messages.push({ id: 'k4', parent_id: 'k2', root_id: 'k2', author: 'Robin Testwell', author_member_id: 'm7', role: 'smm', audience: 'internal', is_tweak: false, component: 'video', body: 'One more thing.', created_at: T(18, 10) });
    await S.realtime();
    check(await until(async () => (await state(page)).count === '1'), 'E: a second message raises the badge again');
    await page.click('#msgPage [data-msg-conv="p_mgr"]');
    check(await until(async () => (await state(page)).count === '0' || (await state(page)).countHidden), 'E: opening it clears the badge');
    s = await state(page);
    check(s.rows.some(r => r.id === 'p_mgr'), 'E: the open conversation stays on screen in New');
    check(!page.errors.length, 'no page errors ' + JSON.stringify(page.errors));
  } catch (e) {
    failures.push(String(e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  if (failures.length) { console.log('\nmessages-new-view-browser: ' + failures.length + ' failed'); process.exit(1); }
  console.log('\nmessages-new-view-browser: all checks passed');
})();
