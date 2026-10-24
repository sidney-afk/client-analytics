'use strict';
/* Round-8 unread badges: real-page screenshots (session Beacon, 2026-10-24).
 *   npm run build:index && node docs/syncview-design/proofs/unread-badges-r8/shots.js --tag=after
 * Serves the built page of the checkout it runs in through the offline harness (every backend answer mocked, nothing
 * leaves the machine), with the runtime switch unread_badges_v2 naming the harness member, fictional notes
 * (fixture.js: round 6's cards plus one with every kind of note, for the spacing audit) and drawn pictures. --tag names the files (before = the code on main, after = this branch).
 * --root=<checkout> takes the page from another checkout (for the "before" pictures). NODE_PATH must reach playwright. */
const fs = require('fs');
const path = require('path');
const arg = k => (process.argv.find(a => a.startsWith('--' + k + '=')) || '').slice(k.length + 3);
const ROOT = arg('root') || path.resolve(__dirname, '../../../..');
const TAG = arg('tag') || 'after';
const { createEnv, sleep, SLUG } = require(path.join(ROOT, 'docs/syncview-design/tests/lost-work-lib'));
const { cards } = require('../unread-badges-r7/fixture');
const OUT = __dirname;
const CORS = { 'access-control-allow-origin': '*' };
const PIC = name => 'https://pictures.example.test/' + encodeURIComponent(name) + '.svg';
const hue = name => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
function pictureSvg(name) {
  if (name === 'client') return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0f766e"/><circle cx="32" cy="32" r="17" fill="none" stroke="#99f6e4" stroke-width="5"/><circle cx="32" cy="32" r="6" fill="#99f6e4"/></svg>';
  const h = name === 'kasper' ? 262 : hue(name);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},60%,70%)"/><stop offset="1" stop-color="hsl(${(h + 35) % 360},55%,48%)"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="25" r="12" fill="hsl(${h},45%,93%)"/><path d="M9 66c2-15 11-22 23-22s21 7 23 22z" fill="hsl(${h},45%,93%)"/></svg>`;
}

function seed(S) {
  S.cards.length = 0;
  const seen = {}, convs = [];
  for (const c of cards()) {
    S.cards.push({
      id: c.id, client: SLUG, name: c.name, status: 'In Progress', order_index: S.cards.length + 1, updated_at: new Date().toISOString(),
      scheduled_date: c.date, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', title_status: 'In Progress',
      caption: 'A fictional caption for the preview.', name_set: true, platforms: 'instagram',
      video_tweaks: JSON.stringify(c.parts.video || []), graphic_tweaks: JSON.stringify(c.parts.graphic || []),
      caption_tweaks: JSON.stringify(c.parts.caption || []), title_tweaks: JSON.stringify(c.parts.title || []),
      asset_url: 'https://example.invalid/' + c.id + '.mp4', thumbnail_url: '',
    });
    const seenAt = c.seen != null ? new Date(Date.now() - c.seen * 60000).toISOString() : '';
    if (seenAt) seen[c.id] = seenAt;
    const messages = [];
    for (const comp of Object.keys(c.parts)) for (const m of c.parts[comp]) messages.push(Object.assign({ component: comp }, m));
    messages.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const counts = m => m.author_member_id !== 'm1' && m.created_at > seenAt;
    const first = messages.find(counts);
    const last = messages[messages.length - 1];
    convs.push({ post_id: c.id, client_slug: SLUG, client_name: 'Sample Client', title: c.name, thumbnail_url: '', asset_url: '', status: 'In Progress',
      last_at: last.created_at, last_author: last.author, last_author_member_id: last.author_member_id || '', last_role: last.role, last_body: last.body,
      unread: messages.filter(counts).length, first_unread_id: first ? first.id : '', messages });
  }
  convs.sort((a, b) => b.last_at.localeCompare(a.last_at));
  return { seen, convs };
}

(async () => {
  const S = await createEnv();
  const { seen, convs } = seed(S);
  const pictures = { members: { m1: PIC('Browser Staff') }, names: { 'robin sample': PIC('Robin Sample'), robin: PIC('Robin Sample'), kasper: PIC('kasper') }, clients: { [SLUG]: PIC('client') } };
  await S.ctx.addInitScript(([seenMap]) => { try { localStorage.setItem('syncview_notes_seen_v1', JSON.stringify(seenMap)); } catch (e) {} }, [seen]);
  await S.ctx.route('https://pictures.example.test/**', route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.slice(1).replace(/\.svg$/, ''));
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: pictureSvg(name) });
  });
  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', async route => {
    const raw = new URL(route.request().url()).searchParams.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({
      key: k, value: k === 'unread_badges_v2' ? { staff: ['m1'] } : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
  });
  await S.ctx.route('**/functions/v1/production-comments{,?*}', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fallback();
    let b = {};
    try { b = r.method() === 'GET' ? { action: new URL(r.url()).searchParams.get('action') } : JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (b.action === 'inbox') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, scope: 'own', conversations: convs, pictures }) });
    if (b.action === 'inbox_mark') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, post_id: b.post_id, last_read_at: null }) });
    return route.fallback();
  });
  const done = [];
  const shot = async (page, name, opts) => { const f = `${TAG}-${name}.png`; await page.screenshot(Object.assign({ path: path.join(OUT, f) }, opts || {})); done.push(f); };
  try {
    for (const theme of ['light', 'dark']) {
      const page = await S.newPage();
      await page.setViewportSize({ width: 1440, height: 1500 });
      await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} document.documentElement.setAttribute('data-theme', t); }, theme);
      await S.openCalendar(page);
      await page.evaluate(t => { document.documentElement.setAttribute('data-theme', t); }, theme);
      await page.waitForFunction(() => document.documentElement.classList.contains('sv-unread2') && document.querySelector('.svu-bub img'), null, { timeout: 10000 }).catch(() => {});
      await sleep(600);
      // 1. A card whose change request was read but is still open (the number without a ring in round 7).
      const strip = page.locator('.cal-foot-tweaks[data-comments-wrap="p_four"]').first();
      await strip.scrollIntoViewIfNeeded();
      const box = await strip.boundingBox();
      await shot(page, `${theme}-card`, { clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 12), width: Math.min(420, 1440 - box.x), height: box.height + 24 } });
      // 2. Notes on the card with every kind of note, the pointer on the long note (the toolbar at its bottom right).
      await page.evaluate(() => openCalComments('p_audit'));
      await sleep(800);
      const long = page.locator('#calCommentsModal .cal-cm-row', { hasText: 'A long note that runs on' }).first();
      await long.hover().catch(() => {});
      await sleep(250);
      await shot(page, `${theme}-notes-audit`);
      // 2b. The end of the same Notes: attachments, the team-only note, the automatic record, the last comment.
      await page.mouse.move(5, 5);
      await page.evaluate(() => { const f = document.querySelector('#calCommentsModal .cal-comments-feed'); if (f) f.scrollTop = f.scrollHeight; });
      await sleep(250);
      await shot(page, `${theme}-notes-audit-end`);
      // 3. The pointer on the change request: Mark done and Delete, no Reply.
      const chg = page.locator('#calCommentsModal .cal-cm-row', { hasText: 'Swap the second clip' }).first();
      await chg.hover().catch(() => {});
      await sleep(250);
      await shot(page, `${theme}-notes-change`);
      // 4. A note on its way: the spinner in place of "Sending…".
      await page.evaluate(() => {
        const id = 'shot-sending-note';
        _noteOutboxPut({ id, surface: 'notes', kind: 'note', pid: 'p_audit', comp: 'caption', parent_id: null, body: 'One more thing about the caption.',
          author: 'Browser Staff', author_member_id: 'm1', role: 'admin', audience: 'client', created_at: new Date().toISOString(), at: Date.now(), state: 'sending' });
        try { _noteOutboxLive.add(id); } catch (e) {}
        _noteOutboxRepaint('p_audit');
      });
      await sleep(600);
      await page.mouse.move(5, 5);
      const sending = page.locator('#calCommentsModal .cal-cm-row', { hasText: 'One more thing about the caption.' }).first();
      await sending.scrollIntoViewIfNeeded().catch(() => {});
      const sb = await sending.boundingBox().catch(() => null);
      if (sb) await shot(page, `${theme}-notes-sending`, { clip: { x: sb.x, y: Math.max(0, sb.y - 8), width: sb.width, height: sb.height + 16 } });
      await page.evaluate(() => { try { _noteOutboxDrop('shot-sending-note'); } catch (e) {} try { closeCalComments(); } catch (e) {} });
      // 5. Messages: the same card's conversation, the pointer on the long message.
      await page.evaluate(() => _msgOpenPage());
      await page.waitForSelector('#msgPage .msg-conv', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => _msgOpen('p_audit'));
      await sleep(900);
      await page.evaluate(() => { const b = document.getElementById('msgBubbles'); if (b) b.scrollTop = 0; });
      const lm = page.locator('#msgPage .msg-b', { hasText: 'A long note that runs on' }).first();
      await lm.hover().catch(() => {});
      await sleep(250);
      await shot(page, `${theme}-chat-audit`);
      // 6. Kasper's change request in Messages: no Reply.
      await page.evaluate(() => _msgOpen('p_long'));
      await sleep(900);
      const kasper = page.locator('#msgPage .msg-b', { hasText: 'Colour on the last shot' }).first();
      await kasper.scrollIntoViewIfNeeded().catch(() => {});
      await kasper.hover().catch(() => {});
      await sleep(250);
      await shot(page, `${theme}-chat-kasper`);
      await page.close();
    }
  } finally { await S.close(); }
  console.log(done.length + ' screenshots: ' + done.join(', '));
})().catch(e => { console.error(e); process.exit(1); });
