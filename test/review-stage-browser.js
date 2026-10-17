'use strict';
/*
 * THE NEW REVIEW PAGE (layout C), behind its two switches, in a real browser, fully offline. Session Marquee.
 *
 * Drives the real page against a mocked backend (fictional clients, cards, people and tokens; the clip and posters
 * are the frame viewer's generated fixtures) and proves:
 *   - switch off, missing or unreadable: the client link and the SMM's Review tab show the old page, and Kasper's
 *     Review Session is the old one for anyone the switch does not name;
 *   - switch on: the new page draws, with no part list on the left, the date at the stage's top left, the step bar
 *     carrying each part's state, the strip scrolling sideways with the mouse wheel;
 *   - every button saves through the old page's own path: approve, a change request (nothing is sent before Send),
 *     a note, the client's caption edit (a change request, never an approval), Finish opening the next post, the
 *     SMM's Approve to Kasper and to client, Kasper's Approve and Tweaks are on Frame;
 *   - the "?" help button is hidden with no video address and opens the video with one.
 * REVIEW_STAGE_SHOTS=<dir> also writes the screenshots used in the PR (before and after, light and dark).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');

const CLIENT = 'Fixture Studio';
const SLUG = 'fixturestudio';
const TOKEN = 'fixture-review-stage-token';
const STAFF = { id: 'qa_marquee', name: 'Fixture Owner', role: 'admin', team: null };
const OTHER = { id: 'qa_other', name: 'Fixture Reviewer', role: 'admin', team: null };
const FRAME = 'https://f.io/FixtureClip1';
const MEDIA = 'https://media.fixture.test/clip.webm';
const POSTER = { l: 'https://media.fixture.test/poster-l.png', p: 'https://media.fixture.test/poster-p.png' };
const CLIP = { l: fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-clip.webm')), p: fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-clip-vertical.webm')) };
const PNG = { l: fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-poster-landscape.png')), p: fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-poster-vertical.png')) };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const FAKE_SUPABASE = "window.supabase={createClient:function(){return{channel:function(){var ch={on:function(){return ch;},subscribe:function(){return ch;}};return ch;},removeChannel:function(){}};}};";
const SHOTS = process.env.REVIEW_STAGE_SHOTS || '';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const note = (id, role, author, body, at, extra) => Object.assign({ id, parent_id: null, author, role, is_tweak: false, audience: role === 'client' ? 'client' : 'client', body, created_at: at, updated_at: at, done: false, done_at: '', done_by: '' }, extra || {});
function cards(stage) {
  const S = stage === 'smm' ? 'For SMM Approval' : stage === 'kasper' ? 'Kasper Approval' : 'Client Approval';
  return [
    { id: 'rs1', client: SLUG, name: 'Why the first second matters', status: S, order_index: 1, updated_at: '2026-10-10T12:00:00.000Z',
      scheduled_date: '2026-10-23', video_status: S, graphic_status: S, caption_status: S, asset_url: FRAME, thumbnail_url: POSTER.p,
      caption: 'Most people decide in the first second. Here is how to earn the second one: start with the change, not the context.',
      video_deliverable_id: 'del_rs1', linear_issue_id: '', video_tweaks: JSON.stringify([note('n1', 'smm', 'Team Member', 'New cut uploaded. The intro is two seconds shorter.', '2026-10-12T16:12:00.000Z')]),
      graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] },
    { id: 'rs2', client: SLUG, name: 'Three habits for a calmer week', status: S, order_index: 2, updated_at: '2026-10-10T12:00:00.000Z',
      scheduled_date: '2026-10-25', video_status: S, graphic_status: 'Approved', caption_status: S, asset_url: FRAME, thumbnail_url: POSTER.l,
      caption: 'Three habits, one calmer week.', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] },
    { id: 'rs3', client: SLUG, name: 'The question nobody asks', status: S, order_index: 3, updated_at: '2026-10-10T12:00:00.000Z',
      scheduled_date: '2026-10-28', video_status: S, graphic_status: S, caption_status: S, asset_url: FRAME, thumbnail_url: POSTER.p,
      caption: 'Ask it this week.', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] },
  ].concat(['A slower morning', 'What to cut first', 'One list, not three', 'The Friday reset'].map((name, i) => ({
    id: 'rs' + (4 + i), client: SLUG, name, status: S, order_index: 4 + i, updated_at: '2026-10-10T12:00:00.000Z',
    scheduled_date: '2026-11-0' + (2 + i), video_status: S, graphic_status: S, caption_status: S, asset_url: FRAME, thumbnail_url: i % 2 ? POSTER.l : POSTER.p,
    caption: 'A short fixture caption.', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] })));
}

async function open(browser, origin, opt) {
  const state = { cards: cards(opt.stage), upserts: [], gateway: [], flagReads: 0, orient: 'p' };
  const ctx = await browser.newContext({ viewport: { width: opt.width || 1440, height: opt.height || 900 }, serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.routeWebSocket('**/*', s => s.close());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  if (opt.staff) {
    const id = JSON.stringify({ key: 'qa-key', role: opt.staff.role, member: opt.staff, verified_at: new Date().toISOString() });
    await page.addInitScript(([v, dark]) => { try { localStorage.setItem('syncview_staff_identity_v1', v); localStorage.setItem('syncview_auth_v1', 'ok'); if (dark) localStorage.setItem('syncview_theme', 'dark'); } catch (e) {} }, [id, !!opt.dark]);
  } else if (opt.dark) {
    await page.addInitScript(() => { try { localStorage.setItem('syncview_theme', 'dark'); } catch (e) {} });
  }
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname, sp = u.searchParams;
    if (/supabase-js/.test(r.url())) return route.fulfill({ status: 200, contentType: 'application/javascript', headers: CORS, body: FAKE_SUPABASE });
    if (u.host === 'media.fixture.test' && /\.png$/.test(p)) return route.fulfill({ status: 200, headers: CORS, contentType: 'image/png', body: /-l\.png$/.test(p) ? PNG.l : PNG.p });
    if (u.host === 'media.fixture.test') {
      const clip = CLIP[state.orient];
      const range = /bytes=(\d+)-(\d*)/.exec(r.headers().range || '');
      if (range) { const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1; return route.fulfill({ status: 206, headers: Object.assign({ 'content-range': `bytes ${a}-${b}/${clip.length}`, 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: clip.subarray(a, b + 1) }); }
      return route.fulfill({ status: 200, headers: Object.assign({ 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: clip });
    }
    if (u.host === 'fonts.googleapis.com' || u.host === 'fonts.gstatic.com') return route.abort();
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: opt.staff ? opt.staff.role : 'admin', member: opt.staff || STAFF });
    if (p === '/functions/v1/client-token-verify') {
      const b = JSON.parse(r.postData() || '{}');
      return json(b.slug === SLUG && b.token === TOKEN ? { ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: b.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' } : { ok: true, valid: false, allowed: false, error: 'invalid_client_link' });
    }
    if (p === '/functions/v1/frameio-view') return json({ ok: true, video: { url: MEDIA, renditions: { efficient: MEDIA, high_quality: MEDIA, original: MEDIA }, expires_at: new Date(Date.now() + 3600000).toISOString(), name: 'Fixture clip.mp4', file_id: 'f1', duration_seconds: 12, fps: 24 }, comments: [], comments_error: '', open_url: 'https://next.frame.io/share/00000000-0000-4000-8000-000000000001', fetched_at: new Date().toISOString() });
    if (/\/functions\/v1\/(calendar-upsert|calendar-card-write)$/.test(p) && r.method() === 'POST') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      const post = body.post || {};
      state.upserts.push(post);
      const row = state.cards.find(c => c.id === post.id);
      if (row) Object.assign(row, post, { updated_at: new Date().toISOString() });
      return json({ ok: true, post: row || post });
    }
    if (p === '/functions/v1/production-write' && r.method() === 'POST') {
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
      state.gateway.push(r.postData() || '');
      return json({ ok: true, native_committed: true, authority: 'syncview', complete: true, outcome: 'absent', row: { id: b.deliverable_id || 'del_rs1', card_id: b.card_id || 'rs1', client_slug: SLUG, team: 'video', status: b.status || 'client_approval' } });
    }
    if (p === '/rest/v1/syncview_runtime_flags') {
      state.flagReads++;
      const raw = sp.get('key') || '';
      const keys = raw.startsWith('in.(') ? raw.slice(4, -1).split(',') : [raw.replace(/^eq\./, '')];
      if (opt.flags === 'unreadable' && keys.includes('review_stage_client_pages')) return json({ message: 'fixture' }, 500);
      const values = {
        calendar_upsert_ef_clients: { clients: [SLUG] }, write_ui_reroute_clients: { clients: [SLUG] },
        client_comment_gateway_enabled: { enabled: true }, prod_authority: { video: 'syncview', graphics: 'syncview' },
        frame_viewer_clients: { all: true },
      };
      if (opt.flags === 'on') { values.review_stage_client_pages = { clients: [SLUG] }; values.review_stage_kasper_staff = { staff: [STAFF.id] }; }
      if (opt.help) values.review_help_video_url = { url: opt.help };
      return json(keys.filter(k => Object.hasOwn(values, k)).map(k => ({ key: k, value: values[k] })));
    }
    if (p === '/rest/v1/calendar_posts') {
      const slug = String(sp.get('client') || '').replace(/^eq\./, '');
      const one = String(sp.get('id') || '').replace(/^eq\./, '');
      return json(state.cards.filter(c => (!slug || c.client === slug) && (!one || c.id === one)));
    }
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, kind: 'client', active: true }]);
    if (p === '/rest/v1/team_members') return json([STAFF, OTHER].map(m => Object.assign({ active: true }, m)));
    if (p.startsWith('/rest/v1/')) return json([]);
    if (u.host === 'docs.google.com') return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    if (p.startsWith('/functions/v1/') || p.startsWith('/webhook/')) return json({ ok: true });
    return route.abort();
  });
  return { page, ctx, state, errors };
}
async function openClient(browser, origin, opt) {
  const t = await open(browser, origin, Object.assign({ stage: 'client' }, opt));
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, t: TOKEN, v: 'calendar' }), { waitUntil: 'domcontentloaded' });
  return t;
}
const host = page => page.locator('#svReviewStage');
const inS = (page, sel) => page.locator('#svReviewStage').locator(sel);
async function waitNew(t) { await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return !!(h && !h.hidden && h.shadowRoot && h.shadowRoot.getElementById('stepper') && h.shadowRoot.getElementById('stepper').children.length); }, null, { timeout: 30000 }); }
async function confirmText(page) { return page.evaluate(() => { const o = document.getElementById('confirmOverlay'); return o && o.classList.contains('active') ? (document.getElementById('confirmTitle') || {}).textContent + ' | ' + ((document.getElementById('confirmMsg') || document.querySelector('#confirmOverlay p') || {}).textContent || '') : ''; }); }
async function answerConfirm(page) { const txt = await confirmText(page); if (txt) { console.log('     (the page asked: ' + txt.replace(/\s+/g, ' ').slice(0, 160) + ')'); await page.locator('#confirmYes').click(); } return txt; }
async function shot(t, name) { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await sleep(900); await t.page.screenshot({ path: path.join(SHOTS, name + '.png') }); }

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    const only = process.env.RS_ONLY || '';
    if (!only || only === 'client') {
    // ---------- the old page stays, switch off / unreadable ----------
    for (const flags of ['off', 'unreadable']) {
      console.log('--- client link, switch ' + flags + ' ---');
      const t = await openClient(browser, origin, { flags });
      await t.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
      await sleep(1200);
      expect(!(await host(t.page).count()) || await host(t.page).evaluate(e => e.hidden), flags + ': the new page is not drawn');
      expect(await t.page.locator('#calView').isVisible(), flags + ': the old review list shows');
      if (flags === 'off') { await shot(t, 'before-client-1440-light'); }
      expect(t.errors.length === 0, flags + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- the client page, switch on ----------
    console.log('--- client link, switch on ---');
    let t = await openClient(browser, origin, { flags: 'on' });
    await waitNew(t);
    await sleep(800);
    const look = await t.page.evaluate(() => {
      const r = document.getElementById('svReviewStage').shadowRoot;
      const vis = el => !!el && el.offsetParent !== null && !el.hidden;
      return {
        oldVisible: vis(document.getElementById('calView')),
        tabsVisible: !!document.querySelector('.client-view .view-tab-toggle') && vis(document.querySelector('.client-view .view-tab-toggle')),
        name: (r.getElementById('rsName') || {}).textContent,
        partsList: !!r.querySelector('.sd-parts') && vis(r.querySelector('.sd-parts')),
        date: (r.getElementById('sdate') || {}).textContent,
        steps: Array.from(r.querySelectorAll('.stp')).map(b => b.textContent.trim()),
        cursor: getComputedStyle(r.querySelector('.stp:not(.on)')).cursor,
        help: vis(r.getElementById('rsHelp')),
        player: !!r.querySelector('#fvHost .fv-player'),
        chips: r.querySelectorAll('.chipp').length,
      };
    });
    expect(!look.oldVisible && !look.tabsVisible, 'on: the old list and the Analytics tabs step aside');
    expect(look.name === CLIENT, 'on: the client name heads the page (' + look.name + ')');
    expect(!look.partsList, 'on: no part list on the left');
    expect(look.date === 'Fri 23 Oct', 'on: the date sits at the stage top left, written "Fri 23 Oct" (' + look.date + ')');
    expect(look.steps.join('|') === '1Video|2Thumbnail|3Caption', 'on: the step bar has the three parts (' + look.steps.join('|') + ')');
    expect(look.cursor === 'pointer', 'on: a step shows the hand cursor');
    expect(!look.help, 'on: the "?" is hidden with no help video address');
    expect(look.player, 'on: the video plays in the Notes view player (#2120)');
    expect(look.chips === 7, 'on: the strip lists the seven waiting posts (' + look.chips + ')');
    await shot(t, 'after-client-1440-light');

    // the strip: the ordinary wheel moves it sideways
    await t.page.setViewportSize({ width: 1100, height: 860 });
    await sleep(400);
    const box = await inS(t.page, '#skList').boundingBox();
    const before = await inS(t.page, '#skList').evaluate(e => ({ x: e.scrollLeft, max: e.scrollWidth - e.clientWidth }));
    await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await t.page.mouse.wheel(0, 240);
    await sleep(300);
    const after = await inS(t.page, '#skList').evaluate(e => e.scrollLeft);
    expect(before.max > 0 && after > before.x, 'strip: the mouse wheel scrolls it sideways (' + before.x + ' -> ' + after + ', room ' + before.max + ')');
    await t.page.setViewportSize({ width: 1440, height: 900 });

    // approve the video: one save, video Approved
    let n0 = t.state.upserts.length;
    await inS(t.page, '[data-ok="video"]').click();
    await t.page.waitForFunction(n => window.__rsUpserts === undefined || true, n0);
    for (let i = 0; i < 60 && !t.state.upserts.slice(n0).some(u => u.video_status === 'Approved'); i++) await sleep(100);
    expect(t.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Approved'), 'client: Approve saves the video as Approved through the calendar save');
    await sleep(900);
    const stepAfter = await inS(t.page, '.stp.on').getAttribute('data-step');
    expect(stepAfter === 'graphic', 'client: approving moves the stage to the next part by itself (' + stepAfter + ')');
    expect(await inS(t.page, '.stp[data-step="video"]').evaluate(e => e.classList.contains('ok')), 'client: the step bar shows the video approved');

    // ask for a change: nothing is saved before Send
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-chg="graphic"]').click();
    await sleep(300);
    await inS(t.page, '#cmpCancel').click();
    await sleep(800);
    expect(t.state.upserts.length === n0, 'client: Ask for a change then Cancel saves nothing');
    await inS(t.page, '[data-chg="graphic"]').click();
    await inS(t.page, '#ta').fill('Move the title to the top, please.');
    await shot(t, 'after-client-change-1440-light');
    await inS(t.page, '#sendBtn').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.graphic_status === 'Tweaks Needed'); i++) await sleep(100);
    const chg = t.state.upserts.slice(n0).find(u => u.graphic_status === 'Tweaks Needed');
    expect(!!chg && /Move the title to the top/.test(String(chg.graphic_tweaks || '')), 'client: Send saves the change request with its words on the thumbnail');

    // the caption edit goes to the team as a change, never an approval
    await sleep(900);
    await inS(t.page, '.stp[data-step="caption"]').click();
    await sleep(500);
    await inS(t.page, '#editBtn').click();
    await inS(t.page, '#capTa').fill('A new caption written by the client.');
    n0 = t.state.upserts.length;
    await inS(t.page, '#capSave').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.caption_status); i++) await sleep(100);
    const ce = t.state.upserts.slice(n0).find(u => u.caption_status);
    expect(!!ce && ce.caption_status === 'Tweaks Needed' && /A new caption written by the client/.test(String(ce.caption_tweaks || '')), 'client: a caption edit is sent as a change request carrying the new text');
    expect(!t.state.upserts.slice(n0).some(u => u.caption_status === 'Approved' || 'caption' in u), 'client: the caption edit neither approves nor overwrites the caption');

    // Finish opens the next post
    await sleep(900);
    expect(await inS(t.page, '#finishBtn').isEnabled(), 'client: Finish reviewing turns on once every part has an answer');
    await inS(t.page, '#finishBtn').click();
    await sleep(600);
    expect(await inS(t.page, '.sd-t h2').textContent() === 'Three habits for a calmer week', 'client: Finish opens the next waiting post');
    expect(t.errors.length === 0, 'client: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // the help button, dark, 1280 wide
    console.log('--- client link, help video, dark, 1280 ---');
    t = await openClient(browser, origin, { flags: 'on', dark: true, width: 1280, height: 800, help: 'https://media.fixture.test/help.mp4' });
    await waitNew(t);
    expect(await inS(t.page, '#rsHelp').isVisible(), 'help: the "?" shows when the address is set');
    expect(await host(t.page).getAttribute('data-theme') === 'dark', 'dark: the client page follows the sun/moon button');
    await shot(t, 'after-client-1280-dark');
    await inS(t.page, '#rsHelp').click();
    expect(await inS(t.page, '.help-ovl video').count() === 1, 'help: the "?" opens the video');
    await t.page.keyboard.press('Escape');
    expect(await inS(t.page, '.help-ovl').count() === 0, 'help: Escape closes it');
    await inS(t.page, '#rsTheme').click();
    await sleep(300);
    expect(await host(t.page).getAttribute('data-theme') === 'light', 'theme: the sun/moon switches back to light');
    expect(t.errors.length === 0, 'help/dark: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
    if (SHOTS) {
      t = await openClient(browser, origin, { flags: 'on', dark: true });
      await waitNew(t); await shot(t, 'after-client-1440-dark'); await t.ctx.close();
      t = await openClient(browser, origin, { flags: 'off', dark: true });
      await t.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 }); await shot(t, 'before-client-1440-dark-is-light'); await t.ctx.close();
    }

    }
    // ---------- the SMM's Review tab ----------
    if (!only || only === 'smm') for (const flags of ['off', 'on']) {
      console.log('--- SMM Review tab, switch ' + flags + ' ---');
      const t2 = await open(browser, origin, { stage: 'smm', flags, staff: STAFF });
      await t2.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
      await t2.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      await t2.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
      await t2.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
      await t2.page.evaluate(() => onCalViewChange('smmreview'));
      if (flags === 'off') {
        await t2.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
        await sleep(1200);
        expect(!(await host(t2.page).count()) || await host(t2.page).evaluate(e => e.hidden), 'SMM off: the old Review tab shows');
        await shot(t2, 'before-smm-1440-light');
      } else {
        await waitNew(t2);
        await sleep(800);
        expect(await inS(t2.page, '#rsNotify').isVisible(), 'SMM: Notify client sits in the header');
        expect(/Approve to Kasper/.test(await inS(t2.page, '[data-ok="video"]').textContent()), 'SMM: the green button reads Approve to Kasper');
        await shot(t2, 'after-smm-1440-light');
        let n0 = t2.state.upserts.length;
        await inS(t2.page, '[data-ok="video"]').click();
        for (let i = 0; i < 80 && !t2.state.upserts.slice(n0).some(u => u.video_status === 'Kasper Approval'); i++) await sleep(100);
        expect(t2.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Kasper Approval'), 'SMM: Approve to Kasper saves the video at Kasper Approval');
        await sleep(900);
        await inS(t2.page, '.stp[data-step="caption"]').click();
        await sleep(500);
        await inS(t2.page, '.sarr[data-menu="caption"]').click();
        await shot(t2, 'after-smm-menu-1440-light');
        n0 = t2.state.upserts.length;
        await inS(t2.page, '[data-alt="client"]').click();
        for (let i = 0; i < 80 && !t2.state.upserts.slice(n0).some(u => u.caption_status === 'Client Approval'); i++) { await answerConfirm(t2.page); await sleep(100); }
        expect(t2.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.caption_status === 'Client Approval'), 'SMM: Approve to client saves the caption at Client Approval');
      }
      expect(t2.errors.length === 0, 'SMM ' + flags + ': no page errors (' + t2.errors.join(' | ') + ')');
      await t2.ctx.close();
    }

    // ---------- Kasper's Review Session ----------
    if (!only || only === 'kasper') for (const who of [OTHER, STAFF]) {
      const named = who === STAFF;
      console.log('--- Kasper tab, ' + (named ? 'the staff member the switch names' : 'someone else') + ' ---');
      const t3 = await open(browser, origin, { stage: 'kasper', flags: 'on', staff: who });
      await t3.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
      await t3.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
      await t3.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
      if (process.env.RS_DEBUG && named) {
        await sleep(8000);
        console.log(await t3.page.evaluate(() => ({ id: (typeof _syncviewStaffIdentityForHeaders === 'function') ? JSON.stringify(_syncviewStaffIdentityForHeaders()) : 'nofn', body: !!document.getElementById('kasperReviewBody'), html: document.documentElement.className, items: (typeof _kasperState === 'object') ? (_kasperState.items || []).length : -1, tab: typeof _kasperState === 'object' ? _kasperState.tab : '', txt: (document.getElementById('kasperReviewBody') || {}).innerText })));
      }
      if (!named) {
        await t3.page.locator('#kasperReviewBody').waitFor({ timeout: 30000 });
        await sleep(2500);
        expect(!(await host(t3.page).count()) || await host(t3.page).evaluate(e => e.hidden), 'Kasper, not named: the old Review Session shows');
        await shot(t3, 'before-kasper-1440-light');
      } else {
        await waitNew(t3);
        await sleep(800);
        if (process.env.RS_DEBUG) console.log(await t3.page.evaluate(() => { const out = []; let e = document.getElementById('svReviewStage'); while (e && e !== document.body) { const cs = getComputedStyle(e); out.push((e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ').join('.') + ' w=' + e.offsetWidth + ' max=' + cs.maxWidth + ' pad=' + cs.paddingLeft + ' top=' + Math.round(e.getBoundingClientRect().top)); e = e.parentElement; } return out.join('\n'); }));
        const sk = await inS(t3.page, '#skHead').textContent();
        expect(/to review/.test(sk), 'Kasper: his strip heads with what is left to review (' + sk + ')');
        expect(await inS(t3.page, '[data-frame="video"]').isVisible(), 'Kasper: Tweaks are on Frame sits on the video');
        await shot(t3, 'after-kasper-1440-light');
        let n0 = t3.state.upserts.length;
        const g0 = t3.state.gateway.length;
        await inS(t3.page, '[data-frame="video"]').click();
        for (let i = 0; i < 80 && !t3.state.upserts.slice(n0).some(u => u.video_status === 'Tweaks Needed'); i++) { await answerConfirm(t3.page); await sleep(100); }
        const fr = t3.state.upserts.slice(n0).find(u => u.video_status === 'Tweaks Needed');
        const sentFrame = (!!fr && /Tweaks are on Frame/.test(String(fr.video_tweaks || ''))) || t3.state.gateway.some(b => /Tweaks are on Frame/.test(b));
        expect(sentFrame, 'Kasper: Tweaks are on Frame sends the change with that message through his change request');
        await sleep(900);
        n0 = t3.state.upserts.length;
        const step = await inS(t3.page, '.stp.on').getAttribute('data-step');
        await inS(t3.page, '[data-ok="' + step + '"]').click();
        for (let i = 0; i < 80 && !t3.state.upserts.slice(n0).some(u => u[step + '_status'] === 'Client Approval'); i++) { await answerConfirm(t3.page); await sleep(100); }
        expect(t3.state.upserts.slice(n0).some(u => u[step + '_status'] === 'Client Approval'), 'Kasper: Approve saves the ' + step + ' on to the client');
      }
      expect(t3.errors.length === 0, 'Kasper ' + (named ? 'named' : 'other') + ': no page errors (' + t3.errors.join(' | ') + ')');
      await t3.ctx.close();
    }

    // screenshots only: SMM and Kasper in dark, before and after
    if (SHOTS && (!only || only === 'shots')) {
      for (const flags of ['off', 'on']) {
        const t2 = await open(browser, origin, { stage: 'smm', flags, staff: STAFF, dark: true });
        await t2.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
        await t2.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
        await t2.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
        await t2.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
        await t2.page.evaluate(() => onCalViewChange('smmreview'));
        if (flags === 'on') await waitNew(t2); else await t2.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
        await shot(t2, (flags === 'on' ? 'after' : 'before') + '-smm-1440-dark');
        await t2.ctx.close();
        const t3 = await open(browser, origin, { stage: 'kasper', flags: 'on', staff: flags === 'on' ? STAFF : OTHER, dark: true });
        await t3.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
        await t3.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
        await t3.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
        if (flags === 'on') await waitNew(t3); else { await t3.page.locator('#kasperReviewBody').waitFor({ timeout: 30000 }); await sleep(2500); }
        await shot(t3, (flags === 'on' ? 'after' : 'before') + '-kasper-1440-dark');
        await t3.ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-stage-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
