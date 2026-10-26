'use strict';
/* Trial reels on the REAL Notes view (the player and the notes): screenshots (session Trials, 2026-10-26).
 *   npm run build:index && node docs/features/trial-reels/real/make-notes-screenshots.js
 * Today's page, fully offline (the same stand-ins as test/frame-comments-in-notes-browser.js: every backend answer is
 * local, the frameio-view function is a stand-in that plays the repo's fixture clip). The card has five version links.
 * preview.js adds the small version switcher to the real player; pressing a letter changes the card's link on screen
 * and reopens Notes, so the player and the Frame.io comments really are read from that version's link.
 * Output: notes-<version>-<width>-<theme>.png in this folder. All names, links and comments are made up. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../../../syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../../../../qa/staff-gate-seed.js');
const { openEditableSheet } = require('../../../syncview-design/tests/staff-phone-browser');

const OUT = __dirname;
const PREVIEW = fs.readFileSync(path.join(__dirname, 'preview.js'), 'utf8');
const CLIP = fs.readFileSync(path.join(__dirname, '../../../../test/fixtures/frameio-viewer-clip-vertical.webm'));
const SLUG = 'fixtureclient';
const NAME = 'Fixture Client';
const STAFF_ID = 'qa_staff';
const LINK = l => 'https://f.io/fixture-version-' + l.toLowerCase();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = minAgo => new Date(Date.now() - minAgo * 60000).toISOString();
// Each version's own Frame.io comments, so a switch visibly changes them.
const COMMENTS = {
  A: [{ id: 'a1', frame: 48, time_seconds: 2, text: 'Version A: the text sits too low on the first frame.', author: 'Team Member', guest: false, created_at: iso(300), done: false, replies: [] }],
  C: [{ id: 'c1', frame: 24, time_seconds: 1, text: 'Version C: make the opening text bigger.', author: 'Team Member', guest: false, created_at: iso(120), done: false, replies: [] },
      { id: 'c2', frame: 96, time_seconds: 4, text: 'Love this one, the pace is right.', author: '', guest: true, created_at: iso(60), done: false, replies: [] }],
};
const NOTES = [{ id: 'n1', role: 'smm', author: 'Fixture SMM', body: 'Five versions, same cut. Pick the ones you like.', created_at: iso(400), done: false }];

async function run() {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const done = [];
  const card = { id: 'v1', client: SLUG, name: 'Why the first second matters', status: 'Client Approval', order_index: 1, updated_at: '2026-10-08T12:00:00.000Z',
    scheduled_date: '2026-10-30', video_status: 'Client Approval', graphic_status: 'N/A', caption_status: 'Client Approval',
    caption: 'Most people decide in the first second.', cta: '', thumbnail_url: '', asset_url: LINK('A'),
    video_deliverable_id: '', graphic_deliverable_id: '', comments: [], graphic_comments: [], caption_comments: [], video_tweaks: JSON.stringify(NOTES) };
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      for (const theme of ['light', 'dark']) {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, colorScheme: theme, hasTouch: w < 600, isMobile: w < 600 });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
        await seedStaffGate(page);
        await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
        await ctx.route('**/*', async route => {
          const r = route.request(); const u = new URL(r.url());
          if (r.url().startsWith(origin)) return route.continue();
          if (/fonts\.(googleapis|gstatic)\.com/.test(u.host)) return route.continue();
          const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
          if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
          const p = u.pathname; const sp = u.searchParams;
          if (u.host === 'media.fixture.test') return route.fulfill({ status: 200, headers: Object.assign({ 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: CLIP });
          if (p === '/functions/v1/frameio-view') {
            let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (_) {}
            const l = (String(body.link || '').match(/version-([a-g])$/) || [])[1] || 'a';
            const video = { url: 'https://media.fixture.test/clip-' + l + '.webm', renditions: {}, expires_at: iso(-600), duration_seconds: 12, fps: 24 };
            const comments = COMMENTS[l.toUpperCase()] || [];
            if (body.part === 'video') return json({ ok: true, video, open_url: body.link, fetched_at: iso(0) });
            if (body.part === 'comments') return json({ ok: true, comments, comments_error: '', open_url: body.link, fetched_at: iso(0) });
            return json({ ok: true, video, comments, comments_error: '', open_url: body.link, fetched_at: iso(0) });
          }
          if (p === '/functions/v1/production-comments') return json({ ok: true, canonical_thread: true, comments: [], has_more: false });
          if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: STAFF_ID, name: 'QA Staff', role: 'admin', team: null } });
          if (r.method() === 'POST') return json({ ok: true });
          if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: NAME, active: true, kind: 'video' }]);
          if (p === '/rest/v1/team_members') return json([{ id: STAFF_ID, name: 'QA Staff', role: 'admin', team: null, active: true }]);
          if (p === '/rest/v1/syncview_runtime_flags') {
            const raw = sp.get('key') || '';
            const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
            return json(keys.map(k => {
              if (k === 'frame_viewer_clients') return { key: k, value: { all: true } };
              if (k === 'frame_comments_in_notes_staff') return { key: k, value: { staff: [STAFF_ID] } };
              if (k === 'prod_authority') return { key: k, value: { video: 'syncview', graphics: 'syncview' } };
              return { key: k, value: /_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false } };
            }));
          }
          if (p === '/rest/v1/calendar_posts') return json([Object.assign({}, card)]);
          if (/\/rest\/v1\//.test(p)) return json([]);
          if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
          return route.abort();
        });
        await page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _calSavePins === 'function', null, { timeout: 30000 });
        await page.evaluate(names => { _syncviewStaffIdentityVerified = true; _calSavePins(names); calState.client = names[0]; navTo('calendar'); }, [NAME]);
        await page.waitForSelector('.cal-card[data-pid="v1"], .thumb-tile[data-thumb-card="v1"]', { timeout: 20000 });
        await openEditableSheet(page);
        await page.waitForSelector('.cal-card[data-pid="v1"]', { timeout: 20000 });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await page.addScriptTag({ content: PREVIEW });
        await page.evaluate(() => svTrialPreview.card('review', false));   // the same trial card behind the dialog
        for (const l of ['A', 'C']) {
          // What the switcher does: the version on screen is the card's link for the player and the comments.
          await page.evaluate(([link]) => { const p = calState.posts.find(x => x.id === 'v1'); p.asset_url = link; }, [LINK(l)]);
          await page.evaluate(() => openCalComments('v1'));
          await page.waitForFunction(() => document.querySelectorAll('#calCommentsFeed .cal-cm-row.is-frameio').length > 0, null, { timeout: 8000 }).catch(() => {});
          await page.evaluate(([letter]) => svTrialPreview.notes(letter), [l]);
          await sleep(1500);
          const name = 'notes-' + l + '-' + w + '-' + theme + '.png';
          await page.screenshot({ path: path.join(OUT, name) });
          done.push(name);
          await page.evaluate(() => closeCalComments());
          await sleep(300);
        }
        if (errors.length) console.log('page errors', w, theme, errors);
        await ctx.close();
      }
    }
    console.log(done.length + ' screenshots in ' + path.relative(process.cwd(), OUT));
  } finally {
    await browser.close();
    server.close();
  }
}
run();
