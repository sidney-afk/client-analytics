'use strict';
/*
 * TRIAL REELS IN THE NOTES VIEW (src/index/189-trial-reels-card.js.part, hooked into 190), in a real browser, fully
 * offline. Session Trials, 2026-10-27; plan docs/features/TRIAL_REELS_PLAN.md (R5).
 *
 * The page is today's, served by the offline harness (docs/syncview-design/tests/lost-work-lib.js: fictional data).
 * The trial-reels function is answered by its own rules (supabase/functions/trial-reels/logic.mjs); the video viewer
 * (frameio-view) answers every link with the fixture clip and its own made-up Frame.io comments. Proves:
 *   - switch off for this client: today's Notes view, no version switch;
 *   - with the card's versions linked: a "Video A B C D E" switch beside Open in Frame.io (desktop) or a slim bar of
 *     its own under the player (390), Video A (the card's link) on first;
 *   - picking C plays C (the player asks for C's link), its Frame.io comments are C's, and the title and the
 *     "About the…" switch say "Video C";
 *   - a note about the video written while C is on screen starts "Video C:";
 *   - once a winner is picked: today's player, no switch;
 *   - no page errors.
 * TRIAL_NOTES_SHOTS=<dir> also writes screenshots (fictional data only).
 */
const fs = require('fs');
const path = require('path');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const LINK = l => 'https://f.io/fixture-version-' + l.toLowerCase();
const MEDIA = 'https://media.fixture.test/clip.webm';
const CLIP = fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-clip.webm'));

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  const vid = S.deliv.find(d => d.id === 'del_vid_1');
  const T = { flag: true, versions: [], views: [], bodies: [] };
  const fresh = over => ['A', 'B', 'C', 'D', 'E'].map(l => Object.assign({ id: 'v' + l, letter: l, status: 'approved', frame_url: LINK(l), revision: 0, updated_at: '2026-10-27T09:00:00.000Z' }, (over || {})[l] || {}));

  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
    const u = new URL(route.request().url());
    const raw = u.searchParams.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({ key: k,
      value: k === 'trial_reels_pages' ? (T.flag ? { clients: ['fixtureclient'] } : { clients: ['someotherclient'] })
        : k === 'frame_viewer_clients' ? { all: true }
        : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: ['fixtureclient'] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
  });
  await S.ctx.route('**/functions/v1/trial-reels', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const b = JSON.parse(r.postData() || '{}');
    const shape = Object.assign({ enabled: true, winner_letter: (T.versions.find(v => v.status === 'winner') || {}).letter || null },
      L.readShape(T.versions, { client: false, mainLink: String(vid.file_url || card.asset_url || ''), cardStatus: card.video_status }));
    const body = b.action === 'list' ? { ok: true, cards: { p_t1: shape } } : Object.assign({ ok: true }, shape);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
  });
  // The video viewer: every link gets the fixture clip, and comments that name the link they belong to.
  await S.ctx.route('**/functions/v1/frameio-view*', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    const link = String(b.link || '');
    T.views.push(link);
    const letter = (link.match(/fixture-version-([a-e])$/) || [])[1] || '?';
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({
      ok: true, video: { url: MEDIA, renditions: { efficient: MEDIA, high_quality: MEDIA, original: MEDIA }, expires_at: new Date(Date.now() + 3600000).toISOString(), name: 'Fixture clip.webm', file_id: 'f-' + letter, duration_seconds: 12, fps: 24 },
      comments: [{ id: 'c-' + letter, frame: 24, time_seconds: 1, text: 'A note on version ' + letter.toUpperCase() + ' in Frame.io.', author: 'Fixture Reviewer', guest: false, created_at: new Date(Date.now() - 600000).toISOString(), done: false, replies: [] }],
      comments_error: '', open_url: 'https://next.frame.io/share/00000000-0000-4000-8000-00000000000' + (letter === '?' ? '0' : 'abcde'.indexOf(letter) + 1), fetched_at: new Date().toISOString() }) });
  });
  await S.ctx.route('https://media.fixture.test/**', route => route.fulfill({ status: 200, headers: Object.assign({ 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: CLIP }));
  // Every write the page sends, to find the note's words in whichever path carries them.
  S.ctx.on('request', r => { if (r.method() === 'POST') { const d = r.postData() || ''; if (/fixture note/i.test(d)) T.bodies.push(d); } });

  const open = async (w, h) => {
    const page = await S.newPage();
    await page.setViewportSize({ width: w, height: h });
    await S.openCalendar(page);
    await sleep(1500);   // the switches and the trial list land
    await page.evaluate(() => openCalComments('p_t1'));
    await sleep(1800);
    return page;
  };
  const look = page => page.evaluate(() => {
    const sw = document.querySelector('#calNotesShell .trl-notes-sw');
    const modal = document.getElementById('calCommentsModal');
    const topic = [...modal.querySelectorAll('[data-comp="video"]')][0];
    return {
      sw: !!sw, inFoot: !!(sw && sw.closest('.fv-stage-foot')), inBar: !!(sw && sw.closest('.trl-notes-bar')),
      letters: sw ? [...sw.querySelectorAll('.cal-cm-aud-btn')].map(b => b.textContent.trim()).join('') : '',
      active: sw ? ((sw.querySelector('.is-active') || {}).textContent || '').trim() : '',
      sub: ((modal.querySelector('.cal-comments-head-text p') || {}).textContent || '').trim(),
      topic: topic ? topic.textContent.trim() : '',
      feed: (document.getElementById('calCommentsFeed') || {}).innerText || '',
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

  try {
    // Switch off for this client: today's Notes view.
    T.flag = false; T.versions = fresh(); vid.file_url = LINK('A'); card.asset_url = LINK('A');
    let page = await open(1440, 900);
    let v = await look(page);
    ok(!v.sw && !/· Video/.test(v.sub), 'switch off: today\'s Notes view, no version switch');
    await page.close();

    T.flag = true;
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
      T.views = []; T.bodies = [];
      page = await open(w, h);
      v = await look(page);
      ok(v.sw && v.letters === 'ABCDE' && v.active === 'A' && T.views.includes(LINK('A')), `${label}: a "Video A B C D E" switch, Video A (the card's link) on first and playing`);
      ok(label === 'desktop' ? v.inFoot : v.inBar, `${label}: the switch sits ${label === 'desktop' ? 'beside Open in Frame.io' : 'in a slim bar of its own under the player'}`);
      await page.click('#calNotesShell .trl-notes-sw .cal-cm-aud-btn:nth-child(3)');
      await sleep(1800);
      v = await look(page);
      ok(v.active === 'C' && T.views[T.views.length - 1] === LINK('C'), `${label}: picking C plays C (the player asks for C's link)`);
      ok(/· Video C$/.test(v.sub) && v.topic === 'Video C', `${label}: the title and the "About the…" switch say "Video C" (${v.sub} | ${v.topic})`);
      ok(label !== 'desktop' || (/version C in Frame\.io/.test(v.feed) && !/version A in Frame\.io/.test(v.feed)), `${label}: the Frame.io comments are Video C's`);
      ok(!v.overflow, `${label}: no sideways scroll`);
      if (process.env.TRIAL_NOTES_SHOTS) { fs.mkdirSync(process.env.TRIAL_NOTES_SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.TRIAL_NOTES_SHOTS, 'notes-' + label + '.png') }); }
      if (label === 'desktop') {
        await page.fill('#calCommentComposer', 'A fixture note on the hook.');
        await page.keyboard.press('Enter');
        for (let i = 0; i < 60 && !T.bodies.length; i++) await sleep(100);
        ok(T.bodies.some(b => /Video C: A fixture note on the hook\./.test(b)), 'desktop: a note about the video written while C is on screen starts "Video C:"');
      }
      ok(!page.errors.length, `${label}: no page errors (${page.errors.join(' | ')})`);
      await page.close();
    }

    // Once a winner is picked: today's player.
    T.versions = fresh({ C: { status: 'winner' }, A: { status: 'lost' }, B: { status: 'lost' }, D: { status: 'lost' }, E: { status: 'lost' } });
    vid.file_url = LINK('C'); card.asset_url = LINK('C');
    page = await open(1440, 900);
    v = await look(page);
    ok(!v.sw && !/· Video/.test(v.sub), 'after the pick: today\'s player, no switch');
    await page.close();
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  console.log(`trial-reels-notes-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
