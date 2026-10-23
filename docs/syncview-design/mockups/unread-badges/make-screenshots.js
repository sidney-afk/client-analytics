'use strict';
/* Unread badges preview: screenshots of the REAL page (session Beacon, 2026-10-23).
 *   npm run build:index && node docs/syncview-design/mockups/unread-badges/make-screenshots.js
 * Serves the built page through the offline harness (docs/syncview-design/tests/lost-work-lib.js: every backend
 * answer mocked, nothing leaves the machine), seeds the fictional cards in fixture.js, answers the Messages inbox
 * from the same notes, and loads preview.js into the page: the local-only switch that applies the proposed design
 * on top of today's code. "before-*" shots are the same page without preview.js. Output: shots/real/*.png.
 * NODE_PATH must reach playwright (as for the other browser tests). */
const fs = require('fs');
const path = require('path');
const { createEnv, sleep } = require('../../tests/lost-work-lib');
const { cards } = require('./fixture');

const OUT = path.join(__dirname, 'shots', 'real');
const PREVIEW = fs.readFileSync(path.join(__dirname, 'preview.js'), 'utf8');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);

const CORS = { 'access-control-allow-origin': '*' };
function seed(S) {
  S.cards.length = 0;
  const seen = {};
  const convs = [];
  for (const c of cards()) {
    S.cards.push({
      id: c.id, client: 'fixtureclient', name: c.name, status: 'In Progress', order_index: S.cards.length + 1,
      updated_at: new Date().toISOString(), scheduled_date: c.date, video_status: 'In Progress', graphic_status: 'In Progress',
      caption_status: 'In Progress', title_status: 'In Progress', caption: 'A fictional caption for the preview.', name_set: true,
      platforms: 'instagram', video_tweaks: JSON.stringify(c.parts.video || []), graphic_tweaks: JSON.stringify(c.parts.graphic || []),
      caption_tweaks: JSON.stringify(c.parts.caption || []), title_tweaks: JSON.stringify(c.parts.title || []),
      asset_url: 'https://example.invalid/' + c.id + '.mp4', thumbnail_url: '',
    });
    const seenAt = c.seen != null ? new Date(Date.now() - c.seen * 60000).toISOString() : '';
    if (seenAt) seen[c.id] = seenAt;
    // The inbox the server would send (D2: a client's change request with no team answer is not in Messages).
    const messages = [];
    for (const comp of Object.keys(c.parts)) for (const m of c.parts[comp]) messages.push(Object.assign({ component: comp }, m));
    messages.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const conversational = messages.filter(m => !(m.role === 'client' && m.is_tweak && !m.parent_id && !messages.some(r => r.root_id === m.id && r.role !== 'client')));
    if (!conversational.length) continue;
    const last = messages[messages.length - 1];
    convs.push({ post_id: c.id, client_slug: 'fixtureclient', client_name: 'Sample Client', title: c.name, thumbnail_url: '', asset_url: '', status: 'In Progress',
      last_at: last.created_at, last_author: last.author, last_author_member_id: '', last_role: last.role, last_body: last.body, last_read_at: seenAt,
      unread: messages.filter(m => m.created_at > seenAt).length, messages });
  }
  convs.sort((a, b) => b.last_at.localeCompare(a.last_at));
  return { seen, convs };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const S = await createEnv();
  const { seen, convs } = seed(S);
  await S.ctx.addInitScript(([seenMap]) => { try { localStorage.setItem('syncview_notes_seen_v1', JSON.stringify(seenMap)); } catch (e) {} }, [seen]);
  await S.ctx.route('**/functions/v1/production-comments{,?*}', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fallback();
    let b = {}; try { b = r.method() === 'GET' ? { action: new URL(r.url()).searchParams.get('action') } : JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (b.action === 'inbox') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, scope: 'all', conversations: convs }) });
    if (b.action === 'inbox_mark') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, post_id: b.post_id, last_read_at: null }) });
    return route.fallback();
  });
  const done = [];
  const shot = async (page, name, opts) => { const f = name + '.png'; await page.screenshot(Object.assign({ path: path.join(OUT, f) }, opts || {})); done.push(f); };
  const cardShot = async (page, pid, name) => {
    const el = page.locator(`#calView .cal-card[data-pid="${pid}"]`).first();
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    const foot = await el.locator('.cal-card-foot').first().boundingBox().catch(() => null);
    // The card's title line, found by its text (the card's name), so the crop starts under the picture.
    const titleY = await el.evaluate(card => {
      const name = (window.calState.posts.find(p => p.id === card.getAttribute('data-pid')) || {}).name;
      const hit = [...card.querySelectorAll('*')].find(n => n.children.length === 0 && n.textContent.trim() === name)
        || [...card.querySelectorAll('input,textarea')].find(n => n.value === name);
      return hit ? hit.getBoundingClientRect().top + window.scrollY : null;
    });
    const top = titleY != null ? titleY - 12 - (await page.evaluate(() => window.scrollY)) : box.y;
    const bottom = foot ? foot.y + foot.height + 8 : box.y + box.height;
    await shot(page, name, { clip: { x: box.x - 4, y: top, width: box.width + 8, height: Math.max(40, bottom - top) } });
  };
  try {
    for (const theme of ['light', 'dark']) {
      for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
        for (const before of [true, false]) {
          const v = (before ? 'before' : 'after') + '-' + tag + '-' + theme;
          if (ONLY && !v.includes(ONLY)) continue;
          const page = await S.newPage();
          await page.setViewportSize({ width: w, height: h });
          await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
          await S.openCalendar(page);
          await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
          if (!before) { await page.addScriptTag({ content: PREVIEW }); await page.evaluate(() => svUnreadPreview.apply()); }
          await page.mouse.move(2, h - 2);
          await sleep(2600);   // the inbox's first read (1.5 s after sign-in) lands, so the header count is live
          await shot(page, v + '-calendar');
          // Card footers, one per case.
          for (const pid of ['p_new_change', 'p_new_comment', 'p_both', 'p_open', 'p_waiting', 'p_staff', 'p_kasper', 'p_calm']) await cardShot(page, pid, v + '-card-' + pid);
          if (!before) {
            // The hover card on the "both" card.
            const btn = page.locator(tag === 'phone' ? '#calView .cal-card[data-pid="p_both"] .thumb-tile' : '#calView .cal-card[data-pid="p_both"] [data-comments-btn]').first();
            await btn.scrollIntoViewIfNeeded();
            // A phone has no hover: the same card opens on a long press, so it is opened by script there.
            if (tag === 'phone') await btn.evaluate(el => svUnreadPreview.hoverCard('p_both', el));
            else await btn.hover();
            await sleep(300);
            await shot(page, v + '-hover');
            await page.mouse.move(2, h - 2);
            await page.evaluate(() => svUnreadPreview.hideHover());
            // The summary line, filtered to "to answer".
            await page.evaluate(() => { window.scrollTo(0, 0); svUnreadPreview.filter('waiting'); });
            await sleep(300);
            await shot(page, v + '-strip-filter');
            await page.evaluate(() => svUnreadPreview.filter(''));
          }
          // The Messages button, and its hover.
          await page.evaluate(() => window.scrollTo(0, 0));
          if (tag === 'desktop') {
            await shot(page, v + '-header', { clip: { x: w - 420, y: 0, width: 420, height: 64 } });
            if (!before) { await page.hover('#navMessages'); await sleep(250); await shot(page, v + '-header-hover', { clip: { x: w - 420, y: 0, width: 420, height: 260 } }); await page.mouse.move(2, h - 2); }
          }
          // Messages: the list (New, To answer, All) and a chat.
          await page.evaluate(() => _msgOpenPage());
          await sleep(1500);
          await shot(page, v + '-messages-new');
          if (!before) { await page.evaluate(() => _msgSetFilter('answer')); await sleep(300); await shot(page, v + '-messages-answer'); }
          await page.evaluate(() => _msgSetFilter('all')); await sleep(300);
          await shot(page, v + '-messages-all');
          await page.click('#msgPage [data-msg-conv="p_both"]');
          await sleep(1200);
          await shot(page, v + '-chat-p_both');
          if (!before) {
            // Nothing new any more, but answers are still owed: the button shows an outlined count.
            await page.evaluate(() => { _msgState.conversations.forEach(c => { c.last_read_at = new Date().toISOString(); }); _msgPaintCounts(); _msgPaint(); });
            await sleep(200);
            if (tag === 'desktop') await shot(page, v + '-header-waiting', { clip: { x: w - 420, y: 0, width: 420, height: 64 } });
          }
          // Back to the Calendar for Notes.
          await page.evaluate(() => { if (document.getElementById('msgPage')) _msgClose(); navTo('calendar'); });
          await sleep(900);
          // Notes on the "both" card (two new, one waiting) and on the "waiting" card (read, still waiting).
          for (const pid of ['p_both', 'p_waiting']) {
            await page.evaluate(id => openCalComments(id), pid);
            await sleep(900);
            await shot(page, v + '-notes-' + pid);
            await page.keyboard.press('Escape');
            await sleep(400);
          }
          if (page.errors.length) console.log('page errors', v, page.errors);
          await page.close();
        }
      }
    }
    console.log(done.length + ' screenshots in ' + path.relative(process.cwd(), OUT));
  } finally {
    await S.close();
  }
})();
