'use strict';
/* messages-inbox-browser.js -- Notes Step 2, the Messages inbox
 * (docs/plans/2026-10-13-notes-messages.md, section 6 "Step 2").
 *
 * Drives the real page, fully mocked (lost-work-lib.js plus a local answer for
 * production-comments' `inbox` / `inbox_mark` actions), and proves:
 *   A  Kasper's Messages tab is the inbox: conversations on the left with
 *      client, title, last message and unread count; the tab shows the count
 *   B  opening a conversation shows the chat and marks it read (count drops,
 *      the server is told "read")
 *   C  Mark as unread tells the server "unread" and the count comes back
 *   D  a reply goes through the Notes save path into the SAME card thread,
 *      under the thread it answers, keeping its part and audience
 *   E  a posted post drops out of the list
 *   F  the Messages button by the account (SMMs) opens the same inbox as a panel
 *   G  phone: the list first, then the chat, and back
 *   J  cold start on the Kasper tab (the Calendar never opened): a reply
 *      still loads the card and saves
 *   K  phone list: the time and unread badge stay inside the row, light and
 *      dark
 *   L  a client whose name equals yours: their messages are never "yours"
 *   I  who wrote it: a staff note shows the writer's name from the roster
 *      (looked up by member id), your own note is never unread and shows as
 *      "You", a colleague's note is unread; a reply stores your member id
 *   H  before the inbox backend is deployed (the old function answers
 *      invalid_deliverable_id), the old Messages tab stays and the button hides
 * With SCREENSHOTS=<dir>, light and dark captures are written there.
 * Nothing reaches a live backend.
 */
const fs = require('fs');
const path = require('path');
const { createEnv, sleep } = require('./lost-work-lib');
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };
const parse = v => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch (e) { return []; } };
const SHOTS = process.env.SCREENSHOTS || '';
const T = d => `2026-10-${String(d).padStart(2, '0')}T10:00:00.000Z`;

(async () => {
  const S = await createEnv();
  // The real unread rules (production-comments/inbox.mjs) decide the counts.
  const inbox = await import(path.join(__dirname, '../../../supabase/functions/production-comments/inbox.mjs'));
  const ME = { id: 'm1', name: 'Browser Staff', role: 'admin' };
  const NOW = Date.parse('2026-10-15T00:00:00.000Z');
  // Made-up colleague on the fictional roster.
  const COLLEAGUE = { id: 'm7', name: 'Robin Testwell', role: 'smm', team: null, active: true };
  const marks = [];
  const reads = new Map();
  try {
    // One root note on the test card's caption, written by the client.
    S.card('p_t1').caption_tweaks = JSON.stringify([
      { id: 'c_root', parent_id: null, author: 'Client', role: 'client', audience: 'client', is_tweak: false, body: 'Can we add the opening hours?', created_at: T(9), updated_at: T(9), done: false }
    ]);
    S.card('p_t1').caption_comments = parse(S.card('p_t1').caption_tweaks);
    const others = [
      { post_id: 'p_other', client_slug: 'fixtureclient', client_name: 'fixtureclient', title: 'Second fixture post', thumbnail_url: '', asset_url: '', status: 'In Progress', messages: [
        { id: 'o1', parent_id: null, root_id: 'o1', author: 'Fixture SMM', role: 'smm', audience: 'internal', is_tweak: true, component: 'video', body: 'Trim the intro please.', created_at: T(10) }] },
      { post_id: 'p_posted', client_slug: 'fixtureclient', client_name: 'fixtureclient', title: 'Posted fixture post', thumbnail_url: '', asset_url: '', status: 'In Progress', messages: [
        { id: 'x1', parent_id: null, root_id: 'x1', author: 'Fixture SMM', role: 'smm', audience: 'internal', is_tweak: false, component: 'caption', body: 'Ready to go.', created_at: T(8) }] },
    ];
    let postedGone = false;
    let oldBackend = false;
    let withWriters = false;
    let withTwin = false;
    // A client note whose author name equals the signed-in staff member's.
    const twin = { post_id: 'p_twin', client_slug: 'fixtureclient', client_name: 'fixtureclient', title: 'Same name fixture post', thumbnail_url: '', asset_url: '', status: 'In Progress', messages: [
      { id: 'z1', parent_id: null, root_id: 'z1', author: 'Browser Staff', role: 'client', audience: 'client', is_tweak: false, component: 'caption', body: 'A client who shares your name, writing a long message that runs well past the width of a phone screen so the row has to cut it short.', created_at: T(13) }] };
    const writers = { post_id: 'p_writers', client_slug: 'fixtureclient', client_name: 'fixtureclient', title: 'Writers fixture post', thumbnail_url: '', asset_url: '', status: 'In Progress', messages: [
      { id: 'w1', parent_id: null, root_id: 'w1', author: 'Synchro Social', author_member_id: 'm1', role: 'smm', audience: 'internal', is_tweak: false, component: 'video', body: 'My own note.', created_at: T(11) },
      { id: 'w2', parent_id: 'w1', root_id: 'w1', author: 'Synchro Social', author_member_id: 'm7', role: 'smm', audience: 'internal', is_tweak: false, component: 'video', body: 'A colleague answers.', created_at: T(12) }] };
    const mine = { post_id: 'p_mine', client_slug: 'fixtureclient', client_name: 'fixtureclient', title: 'Only mine fixture post', thumbnail_url: '', asset_url: '', status: 'In Progress', messages: [
      { id: 'y1', parent_id: null, root_id: 'y1', author: 'Synchro Social', author_member_id: 'm1', role: 'smm', audience: 'internal', is_tweak: false, component: 'caption', body: 'Only I wrote here.', created_at: T(11) }] };
    const conversations = () => {
      const card = S.card('p_t1');
      const msgs = parse(card.caption_tweaks).filter(m => m && !m.deleted).map(m => ({
        id: m.id, parent_id: m.parent_id || null, root_id: m.parent_id || m.id, author: m.author, author_member_id: m.author_member_id || '', role: m.role,
        audience: 'client', is_tweak: !!m.is_tweak && !m.parent_id, component: 'caption', body: m.body, created_at: m.created_at,
      }));
      const list = [{ post_id: 'p_t1', client_slug: 'fixtureclient', client_name: 'fixtureclient', title: card.name, thumbnail_url: '', asset_url: '', status: card.status, messages: msgs }]
        .concat(others.filter(c => !(postedGone && c.post_id === 'p_posted')))
        .concat(withWriters ? [writers, mine] : [])
        .concat(withTwin ? [twin] : []);
      return list.map(c => {
        const last = c.messages[c.messages.length - 1];
        const mark = reads.get(c.post_id) || '';
        const unread = inbox.unreadCount(c.messages, ME, mark, NOW);
        return { ...c, last_at: last.created_at, last_author: last.author, last_author_member_id: last.author_member_id || '', last_role: last.role, last_body: last.body, unread };
      }).sort((a, b) => b.last_at.localeCompare(a.last_at));
    };
    await S.ctx.route('**/rest/v1/team_members**', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }, COLLEAGUE]) }));
    await S.ctx.route('**/functions/v1/production-comments', async route => {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (route.request().method() === 'OPTIONS' || (body.action !== 'inbox' && body.action !== 'inbox_mark')) return route.fallback();
      if (oldBackend) return route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'invalid_deliverable_id' }) });
      const reply = obj => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
      if (body.action === 'inbox') return reply({ ok: true, scope: 'all', conversations: conversations() });
      marks.push(body.post_id + ':' + body.state);
      const conv = conversations().find(c => c.post_id === body.post_id);
      if (!conv) return reply({ ok: false, error: 'forbidden' });
      const mark = body.state === 'read' ? '2026-10-20T00:00:00.000Z' : inbox.unreadMark(conv.messages, ME);
      reads.set(body.post_id, mark);
      return reply({ ok: true, post_id: body.post_id, last_read_at: mark });
    });

    const page = await S.newPage();
    await S.openCalendar(page);
    const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
    const theme = async (t) => page.evaluate(t => { document.documentElement.setAttribute('data-theme', t); }, t);

    // A: Kasper's Messages tab
    await page.evaluate(() => { navTo('kasper'); });
    await page.waitForFunction(() => typeof svAreaApi === 'function' && !!svAreaApi('kasper'), null, { timeout: 20000 });
    await page.evaluate(() => _kasperGotoTab('replies'));
    check(await until(() => page.evaluate(() => document.querySelectorAll('#kasperContent .msg-conv').length === 3)), 'A: the Messages tab lists three conversations');
    const a = await page.evaluate(() => ({
      first: (document.querySelector('#kasperContent .msg-conv .msg-conv-sub') || {}).textContent,
      count: (document.querySelector('[data-kasper-count="replies"]') || {}).textContent,
      badges: [...document.querySelectorAll('#kasperContent .msg-unread')].map(b => b.textContent),
    }));
    check(a.first === 'Second fixture post', 'A: newest conversation first');
    check(a.count === '3', 'A: the tab shows 3 unread conversations (' + a.count + ')');
    check(a.badges.join(',') === '1,1,1', 'A: each conversation shows its unread count');
    await shot('inbox-light-desktop-list');

    // B: open = read
    await page.click('#kasperContent [data-msg-conv="p_t1"]');
    check(await until(() => page.evaluate(() => !!document.querySelector('#kasperContent .msg-b'))), 'B: the chat opens');
    check(await until(() => marks.includes('p_t1:read')), 'B: opening tells the server "read"');
    check(await page.evaluate(() => document.querySelector('[data-kasper-count="replies"]').textContent) === '2', 'B: the tab count drops to 2');
    await shot('inbox-light-desktop-chat');
    await theme('dark');
    await shot('inbox-dark-desktop-chat');
    await theme('light');

    // D: reply through the Notes save path
    await page.fill('#msgReplyBox', 'Fixture reply from the inbox');
    await page.press('#msgReplyBox', 'Enter');
    check(await until(() => parse(S.card('p_t1').caption_tweaks).some(m => m.body === 'Fixture reply from the inbox'), 20000), 'D: the reply is saved on the card');
    const r = parse(S.card('p_t1').caption_tweaks).find(m => m.body === 'Fixture reply from the inbox') || {};
    check(r.parent_id === 'c_root', 'D: the reply sits under the thread it answers');
    check(!('audience' in r) || r.audience === undefined, 'D: a reply carries no audience of its own (it inherits the client thread)');
    check(r.is_tweak !== true, 'D: a reply is never a change request');
    check(r.author_member_id === 'm1', 'D: the reply stores the writer\'s member id (' + r.author_member_id + ')');
    check(r.author === 'Synchro Social' && !JSON.stringify(r).includes('Browser Staff'), 'D: the saved note holds the id only, never the staff name');
    check(await until(() => page.evaluate(() => [...document.querySelectorAll('#kasperContent .msg-b-text')].some(b => b.textContent === 'Fixture reply from the inbox'))), 'D: the reply shows in the chat');

    // C: mark as unread
    await page.click('#kasperContent .msg-act[title="Mark as unread"]');
    check(await until(() => marks.includes('p_t1:unread')), 'C: Mark as unread tells the server "unread"');
    check(await until(() => page.evaluate(() => document.querySelector('[data-kasper-count="replies"]').textContent === '3')), 'C: the count comes back to 3');

    // E: posted post drops out
    postedGone = true;
    await page.evaluate(() => _msgLoad(true));
    check(await until(() => page.evaluate(() => !document.querySelector('#kasperContent [data-msg-conv="p_posted"]'))), 'E: a posted post drops out of the list');

    // F: the Messages button opens the same inbox as a panel
    await page.evaluate(() => navTo('calendar'));
    check(!(await page.isVisible('#navMessages')), 'F: an admin has no header Messages button (the Kasper tab is their inbox)');
    // Show it as it shows for an SMM (role rule: test/messages-inbox-scope.js).
    await page.evaluate(() => { document.getElementById('navMessages').hidden = false; });
    check(await page.isVisible('#navMessages'), 'F: the Messages button shows by the account icon');
    check(await page.evaluate(() => document.querySelector('#navMessages [data-msg-count]').textContent) === '2', 'F: the button shows the unread count (the posted one is gone)');
    await page.click('#navMessages');
    check(await until(() => page.evaluate(() => document.querySelectorAll('#msgPanel .msg-conv').length === 2)), 'F: the panel shows the same conversations');
    check(await page.evaluate(() => document.getElementById('msgPanel').contains(document.activeElement)), 'F: focus moves into the panel');
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.getElementById('msgPanel').contains(document.activeElement)), 'F: Tab stays inside the panel');
    await shot('inbox-light-desktop-panel');
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => document.getElementById('msgPanel').hidden), 'F: Escape closes the panel');
    check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'navMessages'), 'F: focus returns to the Messages button');

    // G: phone
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => _msgOpenPanel());
    await until(() => page.evaluate(() => !!document.querySelector('#msgPanel .msg-conv')));
    const g1 = await page.evaluate(() => ({ list: getComputedStyle(document.querySelector('#msgPanel .msg-list')).display, chat: getComputedStyle(document.querySelector('#msgPanel .msg-chat')).display }));
    check(g1.list !== 'none' && g1.chat === 'none', 'G: phone shows the list first');
    await shot('inbox-light-phone-list');
    await page.click('#msgPanel [data-msg-conv="p_other"]');
    const g2 = await page.evaluate(() => ({ list: getComputedStyle(document.querySelector('#msgPanel .msg-list')).display, chat: getComputedStyle(document.querySelector('#msgPanel .msg-chat')).display }));
    check(g2.list === 'none' && g2.chat !== 'none', 'G: tapping a conversation opens the chat');
    await theme('dark');
    await shot('inbox-dark-phone-chat');
    await theme('light');
    await page.click('#msgPanel .msg-back');
    check(await page.evaluate(() => getComputedStyle(document.querySelector('#msgPanel .msg-list')).display !== 'none'), 'G: back returns to the list');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    check(wide <= 391, 'G: no sideways scroll on a phone (' + wide + ')');
    check(!page.errors.length, 'no page errors ' + JSON.stringify(page.errors));

    // I: who wrote it
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.evaluate(() => _msgClosePanel());
    withWriters = true;
    await page.evaluate(() => { navTo('kasper'); });
    await page.evaluate(() => _kasperGotoTab('replies'));
    await page.evaluate(() => _msgLoad(true));
    check(await until(() => page.evaluate(() => !!document.querySelector('#kasperContent [data-msg-conv="p_writers"]'))), 'I: the writers conversation is listed');
    await until(() => page.evaluate(() => /Robin Testwell/.test(document.querySelector('#kasperContent [data-msg-conv="p_writers"]').innerText)));
    const iList = await page.evaluate(() => {
      const row = id => document.querySelector('#kasperContent [data-msg-conv="' + id + '"]');
      const badge = id => (row(id).querySelector('.msg-unread') || {}).textContent || '0';
      return { writersText: row('p_writers').innerText, writersUnread: badge('p_writers'), mineUnread: badge('p_mine'), mineText: row('p_mine').innerText };
    });
    check(iList.writersUnread === '1', "I: a colleague's note is unread, your own is not (" + iList.writersUnread + ')');
    check(iList.mineUnread === '0', 'I: a conversation with only your own note has nothing unread (' + iList.mineUnread + ')');
    check(/Robin Testwell/.test(iList.writersText), "I: the list names the colleague who wrote last");
    check(/You/.test(iList.mineText) && !/Synchro Social/.test(iList.mineText), 'I: your own last note reads "You"');
    await page.click('#kasperContent [data-msg-conv="p_writers"]');
    check(await until(() => page.evaluate(() => document.querySelectorAll('#kasperContent .msg-b').length === 2)), 'I: the chat shows both notes');
    const iChat = await page.evaluate(() => [...document.querySelectorAll('#kasperContent .msg-b .msg-b-meta b')].map(b => b.textContent));
    check(iChat.join('|') === 'You|Robin Testwell', 'I: the chat names each writer (' + iChat.join('|') + ')');
    await shot('note-writer-inbox-light');
    // The card's Notes panel names the writer too; an old note without an id
    // keeps the shared author.
    {
      const extra = [
        { id: 'c_colleague', parent_id: null, author: 'Synchro Social', author_member_id: 'm7', role: 'smm', audience: 'internal', is_tweak: false, body: 'Colleague note on the card.', created_at: '2026-10-13T10:00:00.000Z', updated_at: '2026-10-13T10:00:00.000Z', done: false },
        { id: 'c_old', parent_id: null, author: 'Synchro Social', role: 'smm', audience: 'internal', is_tweak: false, body: 'Old note with no id.', created_at: '2026-10-13T11:00:00.000Z', updated_at: '2026-10-13T11:00:00.000Z', done: false }];
      S.card('p_t1').caption_tweaks = JSON.stringify(parse(S.card('p_t1').caption_tweaks).concat(extra));
      S.card('p_t1').caption_comments = parse(S.card('p_t1').caption_tweaks);
    }
    await page.evaluate(() => { navTo('calendar'); });
    await page.waitForTimeout(800);
    await page.evaluate(() => openCalComments('p_t1'));
    check(await until(() => page.evaluate(() => [...document.querySelectorAll('.cal-cm-author')].some(a => a.textContent === 'Robin Testwell'))), 'I: the Notes panel shows the colleague\'s name');
    const iPanel = await page.evaluate(() => [...document.querySelectorAll('.cal-cm-author')].map(a => a.textContent));
    check(iPanel.includes('Browser Staff'), 'I: your reply shows your name in the Notes panel (' + iPanel.join('|') + ')');
    check(iPanel.includes('Synchro Social'), 'I: an old note with no id keeps "Synchro Social"');
    await shot('note-writer-panel-light');
    await page.keyboard.press('Escape');
    check(!page.errors.length, 'I: no page errors ' + JSON.stringify(page.errors));

    // J: cold start straight on the Kasper tab; the Calendar never opened
    {
      const cold = await S.newPage();
      await cold.setViewportSize({ width: 1366, height: 900 });
      await cold.goto(S.origin + '/index.html?v=kasper', { waitUntil: 'domcontentloaded' });
      await cold.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      // This browser kept the earlier page's saved Calendar choice and cache;
      // a first visit has neither, so start from no client and no cards.
      await cold.evaluate(() => {
        _syncviewStaffIdentityVerified = true;
        calState.client = null; calState.posts = [];
        for (const k of Object.keys(localStorage)) if (k.startsWith('syncview_calCache_v2:')) localStorage.removeItem(k);
        navTo('kasper');
      });
      await cold.waitForFunction(() => typeof svAreaApi === 'function' && !!svAreaApi('kasper'), null, { timeout: 20000 });
      await cold.evaluate(() => _kasperGotoTab('replies'));
      const jState = await cold.evaluate(() => ({ view: !!(document.getElementById('calView') && document.getElementById('calView').isConnected), posts: calState.posts.length, nav: currentNav }));
      check(!jState.view && jState.posts === 0, 'J: cold start: no Calendar screen and no cards loaded (' + JSON.stringify(jState) + ')');
      check(await until(() => cold.evaluate(() => !!document.querySelector('#kasperContent [data-msg-conv="p_t1"]'))), 'J: the inbox lists the conversation');
      await cold.click('#kasperContent [data-msg-conv="p_t1"]');
      await until(() => cold.evaluate(() => !!document.getElementById('msgReplyBox')));
      const started = Date.now();
      await cold.fill('#msgReplyBox', 'Cold start reply');
      await cold.press('#msgReplyBox', 'Enter');
      check(await until(() => parse(S.card('p_t1').caption_tweaks).some(m => m.body === 'Cold start reply'), 15000), 'J: the reply saves from a cold start (' + (Date.now() - started) + ' ms)');
      check(await cold.evaluate(() => !document.querySelector('.sv-toast-msg') || !/was not sent/.test(document.querySelector('.sv-toast-msg').textContent)), 'J: no "not sent" message');
      check(await cold.evaluate(() => calState.posts.some(p => p.id === 'p_t1')), 'J: the card list now holds the card');
      check(!cold.errors.length, 'J: no page errors ' + JSON.stringify(cold.errors));
      await cold.close();
    }

    // L: a client sharing your name is not you
    withTwin = true;
    await page.evaluate(() => { navTo('kasper'); });
    await page.evaluate(() => _kasperGotoTab('replies'));
    await page.evaluate(() => _msgLoad(true));
    check(await until(() => page.evaluate(() => !!document.querySelector('#kasperContent [data-msg-conv="p_twin"]'))), 'L: the same-name conversation is listed');
    const lRow = await page.evaluate(() => { const r = document.querySelector('#kasperContent [data-msg-conv="p_twin"]'); return { text: r.innerText, badge: (r.querySelector('.msg-unread') || {}).textContent || '0' }; });
    check(lRow.badge === '1', "L: the client's message counts as unread (" + lRow.badge + ')');
    check(!/You:/.test(lRow.text), 'L: the list does not call it "You"');
    await page.click('#kasperContent [data-msg-conv="p_twin"]');
    await until(() => page.evaluate(() => document.querySelectorAll('#kasperContent .msg-b').length === 1));
    check(await page.evaluate(() => { const b = document.querySelector('#kasperContent .msg-b'); return !b.classList.contains('is-me') && b.querySelector('.msg-b-meta b').textContent === 'Browser Staff'; }), 'L: the chat shows it as the client\'s, not yours');
    // Leave one conversation unread for the phone check below.
    await page.click('#kasperContent .msg-act[title="Mark as unread"]');
    await until(() => marks.includes('p_twin:unread'));

    // K: phone list keeps the time and badge inside the row
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { _msgState.openId = ''; _msgLoad(true); });
    await until(() => page.evaluate(() => document.querySelectorAll('#kasperContent .msg-conv').length > 0 && document.querySelector('#kasperContent .msg-list').offsetParent !== null));
    for (const t of ['light', 'dark']) {
      await theme(t);
      const k = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('#kasperContent .msg-conv')].map(row => {
          const r = row.getBoundingClientRect();
          const time = row.querySelector('.msg-conv-time').getBoundingClientRect();
          const badge = row.querySelector('.msg-unread');
          const b = badge ? badge.getBoundingClientRect() : null;
          return { id: row.dataset.msgConv, vw, rowRight: r.right, timeRight: time.right, badgeRight: b ? b.right : null };
        });
      });
      const bad = k.filter(r => r.rowRight > r.vw + 0.5 || r.timeRight > r.vw + 0.5 || (r.badgeRight !== null && r.badgeRight > r.vw + 0.5));
      check(k.length >= 3 && !bad.length, 'K: ' + t + ': every row, time and badge is inside 390px (' + JSON.stringify(bad.slice(0, 2)) + ')');
      check(k.some(r => r.badgeRight !== null), 'K: ' + t + ': an unread badge is on screen');
      await shot('inbox-phone-list-' + t);
    }
    await theme('light');
    await page.setViewportSize({ width: 1366, height: 900 });
    check(!page.errors.length, 'J-L: no page errors ' + JSON.stringify(page.errors));

    // H: the page ships before the backend
    oldBackend = true;
    const old = await S.newPage();
    await S.openCalendar(old);
    await old.evaluate(() => { navTo('kasper'); });
    await old.waitForFunction(() => typeof svAreaApi === 'function' && !!svAreaApi('kasper'), null, { timeout: 20000 });
    await old.evaluate(() => _kasperGotoTab('replies'));
    check(await until(() => old.evaluate(() => !!document.querySelector('#kasperContent .kasper-empty, #kasperContent .kasper-replies-list'))), 'H: the old Messages view shows instead of an error');
    check(await old.evaluate(() => !document.querySelector('#kasperContent .msg-conv')), 'H: no inbox and no error message');
    check(await old.evaluate(() => getComputedStyle(document.getElementById('navMessages')).display === 'none'), 'H: the Messages button stays hidden');
    check(!old.errors.length, 'H: no page errors ' + JSON.stringify(old.errors));
  } catch (e) {
    failures.push(String(e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  if (failures.length) { console.log('\nmessages-inbox-browser: ' + failures.length + ' failed'); process.exit(1); }
  console.log('\nmessages-inbox-browser: all checks passed');
})();
