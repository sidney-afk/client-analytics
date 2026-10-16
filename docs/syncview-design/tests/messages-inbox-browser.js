'use strict';
/* messages-inbox-browser.js -- Notes Step 2, the Messages inbox
 * (docs/plans/2026-10-13-notes-messages.md, section 6 "Step 2").
 *
 * Drives the real page, fully mocked (lost-work-lib.js plus a local answer for
 * production-comments' `inbox` / `inbox_mark` actions), and proves:
 *   A  Kasper's Messages tab opens the Messages page: conversations on the
 *      left with client, title, last message and unread count; the header
 *      button shows the count
 *   B  opening a conversation shows the chat and marks it read (count drops,
 *      the server is told "read")
 *   C  Mark as unread tells the server "unread" and the count comes back
 *   D  a reply goes through the Notes save path into the SAME card thread,
 *      under the thread it answers, keeping its part and audience
 *   E  a posted post drops out of the list
 *   F  the header Messages button opens the same page: header still there,
 *      no Close button, full width, any other tab leaves it
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

async function markUnread(page){
 const direct=page.locator('#msgPage .msg-act[title="Mark as unread"]');
 if(await direct.isVisible())await direct.click();
 else {await page.getByRole('button',{name:'More conversation actions'}).click();await page.locator('.thumb-msg-more').getByRole('button',{name:'Mark as unread',exact:true}).click();}
}
(async () => {
  const S = await createEnv();
  // The real unread rules (production-comments/inbox.mjs) decide the counts.
  const inbox = await import(require('node:url').pathToFileURL(path.join(__dirname, '../../../supabase/functions/production-comments/inbox.mjs')).href);
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
    let inboxDelay = 0;
    let inboxCalls = 0;
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
      if (body.action === 'inbox') { inboxCalls++; if (inboxDelay) await sleep(inboxDelay); return reply({ ok: true, scope: 'all', conversations: conversations() }); }
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
    check(await until(() => page.evaluate(() => currentNav === 'messages' && document.querySelectorAll('#msgPage .msg-conv').length === 3)), 'A: the Kasper Messages tab opens the Messages page with three conversations');
    check(await page.evaluate(() => _kasperState.tab === 'review'), 'A: the Kasper page itself goes back to Review for the next visit');
    const a = await page.evaluate(() => ({
      first: (document.querySelector('#msgPage .msg-conv .msg-conv-sub') || {}).textContent,
      count: (document.querySelector('#navMessages [data-msg-count]') || {}).textContent,
      badges: [...document.querySelectorAll('#msgPage .msg-unread')].map(b => b.textContent),
    }));
    check(a.first === 'Second fixture post', 'A: newest conversation first');
    check(a.count === '3', 'A: the header button shows 3 unread conversations (' + a.count + ')');
    check(a.badges.join(',') === '1,1,1', 'A: each conversation shows its unread count');
    await shot('inbox-light-desktop-list');

    // B: open = read
    await page.click('#msgPage [data-msg-conv="p_t1"]');
    check(await until(() => page.evaluate(() => !!document.querySelector('#msgPage .msg-b'))), 'B: the chat opens');
    check(await until(() => marks.includes('p_t1:read')), 'B: opening tells the server "read"');
    check(await page.evaluate(() => document.querySelector('#navMessages [data-msg-count]').textContent) === '2', 'B: the count drops to 2');
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
    check(await until(() => page.evaluate(() => [...document.querySelectorAll('#msgPage .msg-b-text')].some(b => b.textContent === 'Fixture reply from the inbox'))), 'D: the reply shows in the chat');

    // C: mark as unread
    await markUnread(page);
    check(await until(() => marks.includes('p_t1:unread')), 'C: Mark as unread tells the server "unread"');
    check(await until(() => page.evaluate(() => document.querySelector('#navMessages [data-msg-count]').textContent === '3')), 'C: the count comes back to 3');

    // E: posted post drops out
    postedGone = true;
    await page.evaluate(() => _msgLoad(true));
    check(await until(() => page.evaluate(() => !document.querySelector('#msgPage [data-msg-conv="p_posted"]'))), 'E: a posted post drops out of the list');

    // F: the header Messages button opens the Messages page
    await page.evaluate(() => navTo('calendar'));
    // Who gets the header button: admins and SMMs, never editors or designers.
    const asRole = (role) => page.evaluate(role => {
      const id = _syncviewStaffIdentityLoad();
      _syncviewStaffIdentitySave(Object.assign({}, id, { role, member: Object.assign({}, id.member, { role }) }));
      _syncviewStaffIdentityVerified = true;
      _syncviewStaffRefreshChrome();
    }, role);
    const buttonState = () => page.evaluate(() => {
      const b = document.getElementById('navMessages');
      const r = b.getBoundingClientRect();
      return { hidden: b.hidden, shown: !b.hidden && getComputedStyle(b).display !== 'none' && r.width > 0 && r.height > 0 };
    });
    // On a phone the header button moves into the Tabs menu.
    const inPhoneTabs = async () => {
      await page.evaluate(() => { const t = [...document.querySelectorAll('.pocket-staff-tabs-btn,#fphTabsBtn,[data-staff-menu=tabs],.pocket-admin-heading button[aria-haspopup=dialog]')].find(el => el.getBoundingClientRect().width > 0); if (t) t.click(); });
      await page.waitForTimeout(400);
      const found = await page.evaluate(() => !!document.querySelector('.sv-phone-tabs-grid [data-nav="navMessages"]'));
      await page.evaluate(() => { const c = document.querySelector('[aria-label="Close Tabs"]'); if (c) c.click(); });
      await page.waitForTimeout(200);
      return found;
    };
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await asRole('admin');
      const adm = await buttonState();
      check(!adm.hidden && (width < 768 ? (adm.shown || await inPhoneTabs()) : adm.shown), 'F: ' + width + 'px: an admin has the Messages button ' + JSON.stringify(adm));
      await asRole('editor');
      const ed = await buttonState();
      check(ed.hidden && !ed.shown && (width >= 768 || !(await inPhoneTabs())), 'F: ' + width + 'px: an editor has no Messages button ' + JSON.stringify(ed));
    }
    await asRole('admin');
    await page.setViewportSize({ width: 1366, height: 900 });
    // The editor sign-in cleared the inbox; the first background load after
    // signing back in waits a minute, so load it now.
    await page.evaluate(() => _msgLoad(true));
    await until(() => page.evaluate(() => document.querySelector('#navMessages [data-msg-count]').textContent === '2'));
    check(await page.isVisible('#navMessages'), 'F: the Messages button shows by the account icon');
    check(await page.evaluate(() => document.querySelector('#navMessages [data-msg-count]').textContent) === '2', 'F: the button shows the unread count (the posted one is gone)');
    await page.click('#navMessages');
    check(await until(() => page.evaluate(() => currentNav === 'messages' && document.querySelectorAll('#msgPage .msg-conv').length === 2)), 'F: the button opens the Messages page with the same conversations');
    const f = await page.evaluate(() => {
      const h = document.querySelector('header.header').getBoundingClientRect();
      const p = document.getElementById('msgPage').getBoundingClientRect();
      const inbox = document.querySelector('#msgPage .msg-inbox').getBoundingClientRect();
      const list = document.querySelector('#msgPage .msg-list').getBoundingClientRect();
      const chat = document.querySelector('#msgPage .msg-chat').getBoundingClientRect();
      return { headerShown: h.height > 0 && getComputedStyle(document.querySelector('header.header')).display !== 'none', below: p.top >= h.bottom - 1,
        close: [...document.querySelectorAll('#msgPage button')].some(b => /close/i.test(b.textContent + ' ' + (b.getAttribute('aria-label') || ''))),
        dialog: !!document.querySelector('#msgPage[role="dialog"], #msgPage [role="dialog"]'), active: document.getElementById('navMessages').classList.contains('active'),
        inboxW: Math.round(inbox.width), vw: innerWidth, listLeft: list.left <= inbox.left + 1, chatW: Math.round(chat.width) };
    });
    check(f.headerShown && f.below, 'F: the page sits under the main header, which stays visible');
    check(f.close && !f.dialog, 'F: a page with a Close button, not a dialog');
    check(f.active, 'F: the header button shows as the active tab');
    check(f.listLeft && f.inboxW >= f.vw - 80 && f.chatW >= f.inboxW - 360, 'F: full width, list on the left, conversation takes the rest ' + JSON.stringify(f));
    await shot('messages-page-desktop');
    // A fresh load of the Messages address (the test server cannot serve the
    // clean /messages path the live site redirects, so use its hash form).
    await page.goto(S.origin + '/index.html#messages', { waitUntil: 'domcontentloaded' });
    check(await until(() => page.evaluate(() => typeof currentNav !== 'undefined' && currentNav === 'messages' && document.querySelectorAll('#msgPage .msg-conv').length === 2), 30000), 'F: a reload on the Messages page comes back to it');
    await page.click('#navCalendar');
    check(await until(() => page.evaluate(() => currentNav === 'calendar' && !document.getElementById('msgPage'))), 'F: clicking another tab leaves the Messages page');

    // G: phone
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => _msgOpenPage());
    await until(() => page.evaluate(() => !!document.querySelector('#msgPage .msg-conv')));
    check(await page.evaluate(() => currentNav === 'messages'), 'G: phone opens the Messages page');
    const g1 = await page.evaluate(() => ({ list: getComputedStyle(document.querySelector('#msgPage .msg-list')).display, chat: getComputedStyle(document.querySelector('#msgPage .msg-chat')).display }));
    check(g1.list !== 'none' && g1.chat === 'none', 'G: phone shows the list first');
    await shot('messages-page-phone-list');
    await page.click('#msgPage [data-msg-conv="p_other"]');
    const g2 = await page.evaluate(() => ({ list: getComputedStyle(document.querySelector('#msgPage .msg-list')).display, chat: getComputedStyle(document.querySelector('#msgPage .msg-chat')).display }));
    check(g2.list === 'none' && g2.chat !== 'none', 'G: tapping a conversation opens the chat');
    await shot('messages-page-phone-chat');
    await theme('dark');
    await shot('inbox-dark-phone-chat');
    await theme('light');
    check(await page.evaluate(() => { const b = document.querySelector('#msgPage .msg-back'); return !!b && b.getBoundingClientRect().width > 0; }), 'G: an open conversation has a back arrow on a phone');
    await page.click('#msgPage .msg-back');
    check(await page.evaluate(() => getComputedStyle(document.querySelector('#msgPage .msg-list')).display !== 'none'), 'G: back returns to the list');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    check(wide <= 391, 'G: no sideways scroll on a phone (' + wide + ')');
    check(!page.errors.length, 'no page errors ' + JSON.stringify(page.errors));

    // I: who wrote it
    await page.setViewportSize({ width: 1366, height: 900 });
    withWriters = true;
    await page.evaluate(() => { navTo('kasper'); });
    await page.evaluate(() => _kasperGotoTab('replies'));
    await page.evaluate(() => _msgLoad(true));
    check(await until(() => page.evaluate(() => !!document.querySelector('#msgPage [data-msg-conv="p_writers"]'))), 'I: the writers conversation is listed');
    await until(() => page.evaluate(() => /Robin Testwell/.test(document.querySelector('#msgPage [data-msg-conv="p_writers"]').innerText)));
    const iList = await page.evaluate(() => {
      const row = id => document.querySelector('#msgPage [data-msg-conv="' + id + '"]');
      const badge = id => (row(id).querySelector('.msg-unread') || {}).textContent || '0';
      return { writersText: row('p_writers').innerText, writersUnread: badge('p_writers'), mineUnread: badge('p_mine'), mineText: row('p_mine').innerText };
    });
    check(iList.writersUnread === '1', "I: a colleague's note is unread, your own is not (" + iList.writersUnread + ')');
    check(iList.mineUnread === '0', 'I: a conversation with only your own note has nothing unread (' + iList.mineUnread + ')');
    check(/Robin Testwell/.test(iList.writersText), "I: the list names the colleague who wrote last");
    check(/You/.test(iList.mineText) && !/Synchro Social/.test(iList.mineText), 'I: your own last note reads "You"');
    await page.click('#msgPage [data-msg-conv="p_writers"]');
    check(await until(() => page.evaluate(() => document.querySelectorAll('#msgPage .msg-b').length === 2)), 'I: the chat shows both notes');
    const iChat = await page.evaluate(() => [...document.querySelectorAll('#msgPage .msg-b .msg-b-meta b')].map(b => b.textContent));
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
      check(await until(() => cold.evaluate(() => !!document.querySelector('#msgPage [data-msg-conv="p_t1"]'))), 'J: the inbox lists the conversation');
      await cold.click('#msgPage [data-msg-conv="p_t1"]');
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
    check(await until(() => page.evaluate(() => !!document.querySelector('#msgPage [data-msg-conv="p_twin"]'))), 'L: the same-name conversation is listed');
    const lRow = await page.evaluate(() => { const r = document.querySelector('#msgPage [data-msg-conv="p_twin"]'); return { text: r.innerText, badge: (r.querySelector('.msg-unread') || {}).textContent || '0' }; });
    check(lRow.badge === '1', "L: the client's message counts as unread (" + lRow.badge + ')');
    check(!/You:/.test(lRow.text), 'L: the list does not call it "You"');
    await page.click('#msgPage [data-msg-conv="p_twin"]');
    await until(() => page.evaluate(() => document.querySelectorAll('#msgPage .msg-b').length === 1));
    check(await page.evaluate(() => { const b = document.querySelector('#msgPage .msg-b'); return !b.classList.contains('is-me') && b.querySelector('.msg-b-meta b').textContent === 'Browser Staff'; }), 'L: the chat shows it as the client\'s, not yours');
    // Leave one conversation unread for the phone check below.
    await markUnread(page);
    await until(() => marks.includes('p_twin:unread'));

    // K: phone list keeps the time and badge inside the row
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { _msgState.openId = ''; _msgLoad(true); });
    // Wait for the reloaded list: the conversation marked unread above shows
    // its badge only once the reload lands.
    await until(() => page.evaluate(() => document.querySelectorAll('#msgPage .msg-conv').length > 0 && document.querySelector('#msgPage .msg-list').offsetParent !== null && !!document.querySelector('#msgPage .msg-conv .msg-unread')));
    for (const t of ['light', 'dark']) {
      await theme(t);
      const k = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('#msgPage .msg-conv')].map(row => {
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

    // M, N, O: the loading placeholder, the short-lived list cache and the call on pointer arrival.
    {
      const goHome = async (pg) => {
        await pg.goto(S.origin + '/index.html', { waitUntil: 'domcontentloaded' });
        await pg.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
        await pg.evaluate(() => { _syncviewStaffIdentityVerified = true; _syncviewStaffRefreshChrome(); });
        await pg.waitForFunction(() => { const b = document.getElementById('navMessages'); return b && !b.hidden && b.offsetParent !== null; }, null, { timeout: 30000 });
      };
      const geo = (pg) => pg.evaluate(() => {
        const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 10) / 10); };
        const one = sel => r(document.querySelector('#msgPage ' + sel));
        const rows = [...document.querySelectorAll('#msgPage .msg-conv')].slice(0, 3).map(row => ({
          row: r(row), thumb: r(row.querySelector('.msg-thumb')), top: r(row.querySelector('.msg-conv-top')),
          sub: r(row.querySelector('.msg-conv-sub')), last: r(row.querySelector('.msg-conv-last')),
        }));
        return { inbox: one('.msg-inbox'), list: one('.msg-list'), filters: one('.msg-filters'),
          pills: [...document.querySelectorAll('#msgPage .msg-filters button')].map(r), convs: one('.msg-convs'), chat: one('.msg-chat'), empty: one('.msg-chat-empty'), rows,
          scrollW: document.documentElement.scrollWidth };
      });
      const flat = (o, p = '') => Array.isArray(o) ? (o.length && typeof o[0] === 'number' ? [[p, o]] : o.flatMap((v, i) => flat(v, p + '[' + i + ']'))) : (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => flat(v, p + '.' + k)) : []);
      const sizes = [['desktop', 1366, 900], ['phone', 390, 844]];
      for (const [name, w, h] of sizes) {
        const pg = await S.newPage();
        await pg.setViewportSize({ width: w, height: h });
        inboxDelay = 2500;
        await goHome(pg);
        await pg.evaluate(() => _msgOpenPage());
        check(await until(() => pg.evaluate(() => !!document.querySelector('#msgPage .msg-inbox.is-skeleton'))), 'M: ' + name + ': the grey placeholder shows while the list loads');
        check(await pg.evaluate(() => !document.querySelector('#msgPage .kasper-empty')), 'M: ' + name + ': no "all caught up" flash before the answer');
        const skel = {};
        for (const t of ['light', 'dark']) {
          await pg.evaluate(t => document.documentElement.setAttribute('data-theme', t), t);
          skel[t] = await geo(pg);
          if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `skeleton-${t}-${name}.png`) }); }
          if (t === 'dark') {
            const cols = await pg.evaluate(() => { const b = document.querySelector('#msgPage .msg-conv .msg-skel'); const l = document.querySelector('#msgPage .msg-list'); return [getComputedStyle(b).backgroundColor, getComputedStyle(l).backgroundColor]; });
            check(cols[0] !== cols[1], 'M: ' + name + ': dark: the grey bars differ from the list background (' + cols.join(' vs ') + ')');
          }
        }
        await pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
        check(await until(() => pg.evaluate(() => !!document.querySelector('#msgPage .msg-conv[data-msg-conv]')), 12000), 'M: ' + name + ': the real list replaces the placeholder');
        const real = {};
        for (const t of ['light', 'dark']) {
          await pg.evaluate(t => document.documentElement.setAttribute('data-theme', t), t);
          real[t] = await geo(pg);
          if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `loaded-${t}-${name}.png`) });
        }
        await pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
        // A line of text is as wide as its words and a bar as wide as it was told to be, so
        // for the text lines (and the row's text column) only left, top and height must match.
        const lineKey = k => /\.(sub|last|top)$/.test(k);
        const same = (k, v, other) => other.has(k) && other.get(k).every((n, i) => (lineKey(k) && i === 2) || Math.abs(n - v[i]) <= 0.5);
        const a = flat(skel.light), b = new Map(flat(real.light));
        const off = a.filter(([k, v]) => !same(k, v, b));
        check(a.length > 20 && !off.length, 'M: ' + name + ': every box of the placeholder sits where the loaded page puts it (' + a.length + ' boxes; off: ' + JSON.stringify(off.slice(0, 3)) + ')');
        const ad = flat(skel.dark), bd = new Map(flat(real.dark));
        check(!ad.filter(([k, v]) => !same(k, v, bd)).length, 'M: ' + name + ': same in dark');
        check(skel.light.scrollW <= w + 1, 'M: ' + name + ': the placeholder does not scroll sideways');
        check(!pg.errors.length, 'M: no page errors ' + JSON.stringify(pg.errors));
        await pg.close();
      }

      // N: the list cache belongs to one signed-in member, in this tab, for ten minutes.
      const withCache = async (cache) => {
        const pg = await S.newPage();
        await pg.setViewportSize({ width: 1366, height: 900 });
        await pg.goto(S.origin + '/index.html', { waitUntil: 'domcontentloaded' });
        await pg.evaluate(c => { sessionStorage.clear(); if (c) sessionStorage.setItem('sv_msg_inbox_v1', JSON.stringify(c)); }, cache);
        inboxDelay = 2500;
        await goHome(pg);
        return pg;
      };
      const entry = (member, ageMs, title) => ({ v: 1, member, at: Date.now() - ageMs, scope: 'all', conversations: [
        { post_id: 'p_cached', client_slug: 'fixtureclient', client_name: 'fixtureclient', title, thumbnail_url: '', asset_url: '', last_at: T(12), last_author: 'Client', last_author_member_id: '', last_role: 'client', last_body: 'Cached preview line', unread: 1 }] });
      {
        const pg = await withCache(entry('m1', 60000, 'Cached fixture title'));
        await pg.evaluate(() => _msgOpenPage());
        check(await until(() => pg.evaluate(() => /Cached fixture title/.test(document.querySelector('#msgPage') ? document.querySelector('#msgPage').innerText : '')), 1500), 'N: your own recent list shows at once, before the server answers');
        check(await pg.evaluate(() => _msgState.fromCache === true), 'N: it is marked as the cached list');
        const before = marks.length;
        await pg.click('#msgPage [data-msg-conv="p_cached"]');
        check(await pg.evaluate(() => !!document.querySelector('#msgPage .msg-bubbles[role="status"]')), 'N: opening it before the answer shows the chat placeholder, not an empty chat');
        check(marks.length === before, 'N: nothing is marked read before the notes are in');
        check(await until(() => pg.evaluate(() => !/Cached fixture title/.test(document.querySelector('#msgPage').innerText) && !!document.querySelector('#msgPage [data-msg-conv="p_t1"]')), 12000), "N: the server's list replaces the cached one");
        check(await pg.evaluate(() => _msgState.fromCache === false), 'N: no longer marked cached');
        await pg.close();
      }
      {
        const pg = await withCache(entry('m9', 60000, 'Someone elses secret title'));
        await pg.evaluate(() => _msgOpenPage());
        await sleep(600);
        check(await pg.evaluate(() => !/Someone elses secret title/.test(document.body.innerText) && !!document.querySelector('#msgPage .msg-inbox.is-skeleton')), "N: another member's cached list is never shown (placeholder instead)");
        check(await pg.evaluate(() => !(sessionStorage.getItem('sv_msg_inbox_v1') || '').includes('Someone elses')), "N: and it is thrown away");
        await pg.close();
      }
      {
        const pg = await withCache(entry('m1', 11 * 60 * 1000, 'Stale fixture title'));
        await pg.evaluate(() => _msgOpenPage());
        await sleep(600);
        check(await pg.evaluate(() => !/Stale fixture title/.test(document.body.innerText)), 'N: a list older than ten minutes is not shown');
        await pg.close();
      }
      {
        const pg = await withCache(null);
        await pg.evaluate(() => _msgOpenPage());
        check(await until(() => pg.evaluate(() => !!document.querySelector('#msgPage [data-msg-conv="p_t1"]')), 12000), 'N: first visit: the list arrives');
        const raw = await pg.evaluate(() => sessionStorage.getItem('sv_msg_inbox_v1') || '');
        check(raw.includes('"member":"m1"') && !raw.includes('"messages"') && !raw.includes('Can we add the opening hours'), 'N: the saved copy is yours and holds the list lines only, no conversation text (' + raw.length + ' bytes)');
        await pg.evaluate(() => { _syncviewStaffIdentityVerified = false; _syncviewStaffRefreshChrome(); });
        check(await until(() => pg.evaluate(() => !sessionStorage.getItem('sv_msg_inbox_v1'))), 'N: signing out throws the saved copy away');
        await pg.close();
      }
      // An answer still on its way when the sign-in ends is dropped, never kept for whoever signs in next.
      {
        const pg = await withCache(null);
        inboxDelay = 1500;
        await pg.evaluate(() => { _msgLoad(true); });
        await pg.evaluate(() => { _syncviewStaffIdentityVerified = false; _syncviewStaffRefreshChrome(); });
        await sleep(2400);
        const left = await pg.evaluate(() => ({ loaded: _msgState.loaded, n: _msgState.conversations.length, loading: _msgState.loading, saved: sessionStorage.getItem('sv_msg_inbox_v1') }));
        check(!left.loaded && left.n === 0 && !left.loading && !left.saved, 'N: an answer that lands after sign-out is dropped and not saved (' + JSON.stringify(left) + ')');
        await pg.close();
      }
      // O: nothing is asked at page load; the call starts when the pointer reaches the button.
      {
        inboxDelay = 0;
        const pg = await S.newPage();
        await pg.setViewportSize({ width: 1366, height: 900 });
        await pg.goto(S.origin + '/index.html', { waitUntil: 'domcontentloaded' });
        await pg.evaluate(() => sessionStorage.clear());
        const n0 = inboxCalls;
        await goHome(pg);
        await sleep(2500);
        check(inboxCalls === n0, 'O: no inbox call at page load (' + (inboxCalls - n0) + ')');
        await pg.hover('#navMessages');
        check(await until(() => inboxCalls > n0, 3000), 'O: the call starts when the pointer reaches the Messages button');
        await pg.click('#navMessages');
        check(await until(() => pg.evaluate(() => !!document.querySelector('#msgPage [data-msg-conv="p_t1"]')), 3000), 'O: opening afterwards shows the list');
        check(inboxCalls === n0 + 1, 'O: opening did not start a second call (' + (inboxCalls - n0) + ')');
        await pg.close();
      }
      inboxDelay = 0;
    }

    // P: getting out of Messages (owner, 2026-10-15): the Messages button toggles, a Close button, Escape (desktop),
    // browser Back, all back to exactly where the person was; a link-opened page closes to the Calendar.
    {
      // Enough cards for the Sheet's strip to scroll sideways.
      for (let i = 2; i <= 14; i++) S.cards.push({ ...S.card('p_t1'), id: 'p_x' + i, name: 'Extra card ' + i, order_index: i, scheduled_date: '2026-10-' + String(10 + (i % 15)).padStart(2, '0'), video_deliverable_id: null, graphic_deliverable_id: null });
      const read = pg => pg.evaluate(() => ({ nav: currentNav, view: calState.view, client: calState.client, y: Math.round(scrollY),
        strip: Math.round((document.querySelector('.cal-organizer-strip') || {}).scrollLeft || 0),
        card: !!document.querySelector('.cal-card-focused[data-pid="p_t1"]'), msg: !!document.getElementById('msgPage') }));
      const ready = async (pg) => {
        await S.openCalendar(pg);
        await pg.evaluate(() => { _syncviewStaffIdentityVerified = true; _syncviewStaffRefreshChrome(); });
        await pg.waitForFunction(() => { const b = document.getElementById('navMessages'); return b && !b.hidden; }, null, { timeout: 30000 });
      };
      // Put the Calendar in a known place: the Sheet (organizer) view, one card open, scrolled down.
      const arrange = async (pg, name0) => {
        await pg.evaluate(() => onCalViewChange('organizer'));
        await pg.waitForSelector('.cal-card[data-pid="p_t1"]', { timeout: 10000 });
        await pg.evaluate(() => { try { WL_CLIENT_NAMES.push('fixtureclient'); } catch (e) {} history.pushState({ nav: 'calendar', client: null }, '', '#calendar/fixtureclient/p_t1'); window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
        check(await until(() => pg.evaluate(() => !!document.querySelector('.cal-card-focused')), 8000), 'P: setup: a card is open on the Calendar');
        await pg.evaluate(() => { window.scrollTo(0, 100); const st = document.querySelector('.cal-organizer-strip'); if (st) st.scrollLeft = 300; });
        await pg.waitForTimeout(250);
        const state = await read(pg);
        if (name0 === 'desktop') check(state.strip >= 250, 'P: setup: the Sheet strip is scrolled sideways (' + state.strip + ')');
        return state;
      };
      const same = (a, b) => a.nav === b.nav && a.view === b.view && a.client === b.client && Math.abs(a.y - b.y) <= 6 && Math.abs(a.strip - b.strip) <= 6 && a.card === b.card && !b.msg;
      const openers = {
        desktop: pg => pg.click('#navMessages'),
        // The phone's Tabs menu copy of the button just clicks the native one.
        phone: pg => pg.evaluate(() => document.getElementById('navMessages').click()),
      };
      for (const [name, w, h] of [['desktop', 1366, 900], ['phone', 390, 844]]) {
        for (const t of ['light', 'dark']) {
          const pg = await S.newPage();
          await pg.setViewportSize({ width: w, height: h });
          inboxDelay = 0;
          await ready(pg);
          await pg.evaluate(t => document.documentElement.setAttribute('data-theme', t), t);
          const before = await arrange(pg, name);
          const tag = `P: ${name} ${t}`;
          const opened = async () => { await openers[name](pg); return until(() => pg.evaluate(() => currentNav === 'messages' && !!document.querySelector('#msgPage .msg-conv')), 8000); };
          const back = async (label) => {
            check(await until(() => pg.evaluate(() => !document.getElementById('msgPage') && currentNav === 'calendar'), 8000), `${tag}: ${label}: Messages closes`);
            await until(() => pg.evaluate(() => !!document.querySelector('.cal-card-focused') && Math.abs(scrollY - 100) <= 6 && Math.abs(((document.querySelector('.cal-organizer-strip') || {}).scrollLeft || 0) - 300) <= 6), 6000);
            const after = await read(pg);
            check(same(before, after), `${tag}: ${label}: back where they were (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
          };
          // 1. the Messages button again
          check(await opened(), `${tag}: Messages opens`);
          if (SHOTS && name === 'desktop') await pg.screenshot({ path: path.join(SHOTS, `close-${name}-${t}.png`) });
          if (name === 'phone') {
            check(await pg.evaluate(() => { const b = document.querySelector('.pocket-staff-msg-close'); if (!b) return false; const r = b.getBoundingClientRect(); const bar = document.getElementById('pocketStaffBar').getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.right <= bar.right + 0.5 && r.left >= 0 && document.documentElement.scrollWidth <= innerWidth + 1; }), `${tag}: the Close button fits the phone title bar (44px, inside it, no sideways scroll)`);
            if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `close-${name}-${t}.png`) });
          } else {
            check(await pg.evaluate(() => { const b = document.querySelector('#msgPage .msg-close'); const i = document.querySelector('#msgPage .msg-inbox').getBoundingClientRect(); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.right >= i.right - 4 && r.top < i.top; }), `${tag}: the Close button is top right of the page`);
          }
          if (name === 'phone') {
            // The Messages tile in the phone Tabs menu is the same toggle.
            await pg.click('.pocket-staff-tabs-btn');
            await pg.click('dialog[open] [data-nav="navMessages"]');
          } else await openers[name](pg);
          await back(name === 'phone' ? 'the Messages tile in the Tabs menu' : 'the Messages button again');
          // 2. the Close button
          check(await opened(), `${tag}: Messages opens again`);
          await pg.click(name === 'phone' ? '.pocket-staff-msg-close' : '#msgPage .msg-close');
          await back('the Close button');
          // 3. Escape (desktop only)
          if (name === 'desktop') {
            check(await opened(), `${tag}: Messages opens a third time`);
            await pg.keyboard.press('Escape');
            await back('Escape');
          }
          // 4. browser Back
          check(await opened(), `${tag}: Messages opens once more`);
          await pg.goBack();
          await back('browser Back');
          check(!pg.errors.length, `${tag}: no page errors ` + JSON.stringify(pg.errors));
          await pg.close();
        }
      }

      // Escape never throws away a typed reply; the Close button keeps it for the next visit.
      {
        const pg = await S.newPage();
        await pg.setViewportSize({ width: 1366, height: 900 });
        await ready(pg);
        await pg.click('#navMessages');
        await until(() => pg.evaluate(() => !!document.querySelector('#msgPage [data-msg-conv="p_t1"]')), 8000);
        await pg.click('#msgPage [data-msg-conv="p_t1"]');
        await pg.fill('#msgReplyBox', 'A reply I am still writing');
        await pg.keyboard.press('Escape');
        await pg.waitForTimeout(300);
        check(await pg.evaluate(() => !!document.getElementById('msgPage') && document.getElementById('msgReplyBox').value === 'A reply I am still writing'), 'P: Escape in a box with typed text keeps Messages open and the text');
        await pg.click('#msgPage .msg-close');
        check(await until(() => pg.evaluate(() => !document.getElementById('msgPage')), 6000), 'P: the Close button closes it even with a typed reply');
        await pg.click('#navMessages');
        check(await until(() => pg.evaluate(() => { const b = document.getElementById('msgReplyBox'); return !!b && b.value === 'A reply I am still writing'; }), 8000), 'P: the typed reply is still there on the next visit');
        await pg.fill('#msgReplyBox', '');
        await pg.keyboard.press('Escape');
        check(await until(() => pg.evaluate(() => !document.getElementById('msgPage')), 6000), 'P: Escape closes it when the box is empty');
        await pg.close();
      }

      // Opened straight from a link: nothing to go back to, so Close goes to the Calendar.
      {
        const pg = await S.newPage();
        await pg.setViewportSize({ width: 1366, height: 900 });
        await pg.goto(S.origin + '/index.html#messages', { waitUntil: 'domcontentloaded' });
        await pg.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
        await pg.evaluate(() => { _syncviewStaffIdentityVerified = true; _syncviewStaffRefreshChrome(); });
        check(await until(() => pg.evaluate(() => currentNav === 'messages' && !!document.getElementById('msgPage')), 10000), 'P: a link straight to Messages opens it');
        await pg.click('#msgPage .msg-close');
        check(await until(() => pg.evaluate(() => currentNav === 'calendar' && !document.getElementById('msgPage')), 8000), 'P: opened from a link, Close goes to the Calendar');
        await pg.close();
      }
      S.cards = S.cards.filter(c => !/^p_x/.test(c.id));
    }

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
