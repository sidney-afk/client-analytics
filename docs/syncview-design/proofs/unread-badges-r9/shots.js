'use strict';
/* Round-9 before/after pictures (session Beacon). Run on a build: node --require ./test/helpers/single-file-index.js
   docs/syncview-design/proofs/unread-badges-r9/shots.js <prefix>   (prefix "before" or "after"). Fully mocked, switch on.
   1 msgbtn   the Messages button hovered, with conversations waiting for an answer and nothing new
   2 reopen   the first frame of Notes reopened on a card with no notes, after a board refresh
   3 reply    a reply written while the notes are still loading, a moment after Send */
const path = require('path');
const { createEnv, sleep, SLUG } = require('../../tests/lost-work-lib');

const OUT = __dirname;
const prefix = process.argv[2] || 'after';
const CORS = { 'access-control-allow-origin': '*' };
const at = new Date(Date.now() - 3 * 86400000).toISOString();

async function shot(page, name, clip) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await sleep(150);
    await page.screenshot({ path: path.join(OUT, `${prefix}-${name}-${theme}.png`), clip, animations: 'disabled' });
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
}

(async () => {
  const S = await createEnv();
  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', async route => {
    const sp = new URL(route.request().url()).searchParams;
    const raw = sp.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({
      key: k, value: k === 'unread_badges_v2' ? { staff: ['m1'] } : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows.filter(r => r.value !== undefined)) });
  });
  const q = (id, body) => ({ id, root_id: id, parent_id: null, author: 'Casey Client', role: 'client', audience: 'client', is_tweak: false, done: false, component: 'video', body, created_at: at, updated_at: at });
  const conv = (pid, title, body) => ({ post_id: pid, client_slug: SLUG, client_name: 'Fixture Client Co', title, thumbnail_url: '', asset_url: '', status: 'In Progress',
    last_at: at, last_author: 'Casey Client', last_role: 'client', last_body: body, unread: 0, first_unread_id: '', messages: [q('q_' + pid, body)] });
  await S.ctx.route('**/functions/v1/production-comments{,?*}', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fallback();
    let b = {};
    try { b = r.method() === 'GET' ? { action: new URL(r.url()).searchParams.get('action') } : JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (b.action === 'inbox') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS,
      body: JSON.stringify({ ok: true, scope: 'all', conversations: [conv('p_x1', 'Spring launch reel', 'Can we post this on Friday?'), conv('p_x2', 'Behind the scenes', 'Is the music licensed?')], pictures: { members: {}, names: {}, clients: {} } }) });
    if (b.action === 'inbox_mark') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true }) });
    return route.fallback();
  });
  const slow = { crosswalk: 0 };
  await S.ctx.route('**/rest/v1/deliverables**', async route => { if (slow.crosswalk) await sleep(slow.crosswalk); return route.fallback(); });
  const page = await S.newPage();
  await S.openCalendar(page);
  await sleep(1200);

  // 1 the Messages button, hovered
  await page.hover('#navMessages');
  await sleep(400);
  const b = await page.evaluate(() => { const r = document.getElementById('navMessages').getBoundingClientRect(); return { x: r.right, y: r.top }; });
  const clip = { x: Math.max(0, b.x - 420), y: Math.max(0, b.y - 10), width: 440, height: 240 };
  await shot(page, 'msgbtn', clip);
  await page.mouse.move(5, 600);

  // 2 reopening Notes on a card with no notes, after a board refresh
  slow.crosswalk = 600;
  await page.evaluate(() => openCalComments('p_t1'));
  await sleep(1500);
  await page.evaluate(() => closeCalComments());
  await page.evaluate(() => { calState.posts = calState.posts.map(p => { const c = Object.assign({}, p); delete c._canonicalCommentReads; delete c._canonicalCrosswalk; return c; }); });
  await sleep(5200);
  slow.crosswalk = 4000;
  await page.evaluate(() => openCalComments('p_t1'));
  await sleep(250);
  const box = await page.evaluate(() => {
    // The panel: the nearest box holding both the thread and the message box.
    const feed = document.getElementById('calCommentsFeed');
    let m = document.getElementById('calCommentComposer');
    while (m && !m.contains(feed)) m = m.parentElement;
    const r = m.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  const mclip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, 1280), height: Math.min(box.height, 900) };
  await shot(page, 'reopen', mclip);

  // 3 a reply written while the notes are still loading, a moment after Send
  await page.evaluate(() => _calSetComposeComp('video'));
  await page.fill('#calCommentComposer', 'Yes, Friday works.');
  await page.click('#calCommentsModal .cal-cm-send', { force: true }).catch(() => {});
  await sleep(200);
  await shot(page, 'reply', mclip);
  await S.close();
  console.log('shots: ' + prefix + ' done');
})().catch(e => { console.error(e); process.exit(1); });
