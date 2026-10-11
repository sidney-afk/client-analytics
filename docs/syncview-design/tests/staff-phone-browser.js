'use strict';
/* Staff phone screens: Templates, Filming Plans, Submit and Today, every
 * state, at 360 / 390 / 430 px, in light and dark.
 *
 * Fully offline. The real generated app is served from this checkout, a stub
 * staff identity is seeded, and every backend answer is made up here (no real
 * client, person or address). Nothing is written anywhere: any request that is
 * not a plain read is refused and counted, and the run fails if one happens.
 *
 *   node docs/syncview-design/tests/staff-phone-browser.js
 *     [--shots=<dir>]       write one PNG per state/width/theme into <dir>
 *     [--only=<regex>]      run only the states whose name matches
 *     [--widths=360,390]    default 360,390,430
 *     [--themes=light]      default light,dark
 *     [--before-root=<dir>] serve the app from another checkout (the BEFORE shots)
 *     [--freeze]            stop animations (for exact before/after comparisons)
 *     [--report=<file>]     write a JSON measurement receipt (counts and smallest sizes only)
 *     [--fonts=<dir>]       folder holding plus-jakarta-<weight>.ttf (sandbox has no web fonts)
 *
 * For every state it checks: no sideways page scroll, every tap target is at
 * least 44 px, every editable text field is at least 16 px, and (after the
 * new phone bar exists) the title row, Tabs and More are present.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const SHOTS = arg('shots', '');
const REPORT = arg('report', '');
const receipt = [];
const ONLY = arg('only', '') ? new RegExp(arg('only', ''), 'i') : null;
const WIDTHS = arg('widths', '360,390,430').split(',').map(Number);
const THEMES = arg('themes', 'light,dark').split(',');
const SERVE_ROOT = path.resolve(arg('before-root', ROOT));
const FONTS = arg('fonts', process.env.POCKET_FONT_DIR || '');
const BEFORE = !!arg('before-root', '');
const FREEZE = process.argv.includes('--freeze');   // stop animations and carets, for exact before/after picture comparison
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

/* ------------------------------------------------------------------ data */
// One fixed time of day, so two runs on the same day draw the same clock times (the app shows them).
const STAMP = (() => { const d = new Date(); d.setHours(9, 30, 0, 0); return d.toISOString(); })();
const day = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const CLIENTS = [
  { slug: 'sample-one', display_name: 'Sample Client One', active: true, kind: 'client' },
  { slug: 'sample-two', display_name: 'Sample Client Two', active: true, kind: 'client' },
  { slug: 'sample-three', display_name: 'Sample Client Three', active: true, kind: 'client' },
  { slug: 'sample-four', display_name: 'Sample Client Four', active: true, kind: 'client' },
];
const NAMES = CLIENTS.map(c => c.display_name);
const TEMPLATE_ROWS = [
  { client_slug: 'sample-one', updated_at: STAMP, data: { client_name: 'Sample Client One',
    filming_plans_link: 'https://docs.google.com/document/d/fixture_plan_one/edit',
    reels_editor_folder_link: 'https://drive.google.com/drive/folders/fixture_editor_folder',
    reels_reference_link: 'https://www.instagram.com/reel/fixture1/',
    reels_reference_link_list: JSON.stringify(['https://www.instagram.com/reel/fixture1/', 'https://www.instagram.com/reel/fixture2/']),
    thumbnails_photos_link: 'https://drive.google.com/drive/folders/fixture_photos',
    thumbnails_canva_link: 'https://www.canva.com/design/fixture/edit' } },
  { client_slug: 'sample-two', updated_at: STAMP, data: { client_name: 'Sample Client Two' } },
  { client_slug: 'sample-three', updated_at: STAMP, data: { client_name: 'Sample Client Three' } },
];
const BRAIN = {
  ok: true, found: true, folder: 'sample-one',
  facts: [
    { id: 'client.sample-one.editing.subtitle-spec', file: 'editing', heading: 'Subtitle spec', status: 'written', spec: 'font=Montserrat Bold; main=#ffffff; highlight=#f5c518; shadow=none',
      body: 'Subtitles sit in the lower third, two lines at most.', owner: 'Editing', updated: '2026-09-30', source: 'brain/sample-one/editing.md' },
    { id: 'client.sample-one.editing.thumbnail-spec', file: 'editing', heading: 'Thumbnail spec', status: 'written', spec: 'font=Anton; title=#111111; highlight=none',
      body: 'Thumbnails keep the face on the right.', owner: 'Editing', updated: '2026-09-30' },
    { id: 'client.sample-one.editing.cuts', file: 'editing', heading: 'Cuts and pacing', status: 'written', body: 'Cut every pause longer than half a second.\n\n> Keep the first line punchy.\n\n**Never** use stock music without asking.', owner: 'Editing', updated: '2026-09-30' },
    { id: 'client.sample-one.voice.tone', file: 'voice', heading: 'Tone of voice', status: 'empty', body: '' },
  ],
  brief: [
    { heading: 'Look and feel', bullets: [{ text: '**Colors:** warm white with a gold highlight #f5c518', facts: ['client.sample-one.editing.subtitle-spec'] }, { text: '**Colors:** dark text #111111 on thumbnails', facts: ['client.sample-one.editing.thumbnail-spec'] }] },
    { heading: 'Editing', bullets: [{ text: 'Cut every pause longer than half a second.', facts: ['client.sample-one.editing.cuts'] }] },
    { heading: 'Avoid', bullets: [{ text: 'Stock music without asking first.', facts: [] }] },
  ],
};
const FOLDERS = { ok: true,
  frame: [{ name: 'Sample batch A', url: 'https://f.io/fixture-a', at: '2026-08-30T10:00:00Z' }, { name: 'Sample batch B', url: 'https://f.io/fixture-b', at: '2026-08-12T10:00:00Z' }],
  raw: [{ name: 'Sample batch A', url: 'https://drive.google.com/drive/folders/fixture-raw-a', at: '2026-09-28T10:00:00Z' }] };
const PLANS = [
  { client_name: 'Sample Client One', client_slug: 'sample-one', doc_url: 'https://docs.google.com/document/d/fixture_plan_one/edit', notes: 'October plan' },
  { client_name: 'Sample Client Two', client_slug: 'sample-two', doc_url: 'https://docs.google.com/document/d/fixture_plan_two/edit', notes: '' },
  { client_name: 'Sample Client Three', client_slug: 'sample-three', doc_url: '', notes: 'No document yet' },
];
const deliverable = (id, slug, title, status, extra) => Object.assign({ id, client_slug: slug, team: 'video', kind: 'video', title, status,
  status_at: STAMP, assignee_id: 'qa_editor', due_date: day(2), origin: 'native', card_id: null, linear_issue_uuid: null }, extra || {});
const DELIVERABLES = [
  deliverable('d1', 'sample-one', 'Opening hook edit for the October reel', 'smm_approval'),
  deliverable('d2', 'sample-two', 'A very long working title that has to wrap on a narrow phone screen', 'tweak'),
  deliverable('d3', 'sample-three', 'Thumbnail pass', 'in_progress'),
  deliverable('d4', 'sample-one', 'Captions for the second clip', 'todo'),
  deliverable('d5', 'sample-two', 'Color pass', 'smm_approval'),
];
const POSTS = [
  { id: 'p1', client: 'sample-one', name: 'Monday motivation post', scheduled_date: day(1), status: 'Draft', video_status: '', graphic_status: '', caption: '', asset_url: '', thumbnail_url: '', video_deliverable_id: 'd1' },
  { id: 'p2', client: 'sample-two', name: 'Behind the scenes', scheduled_date: day(3), status: 'Draft', caption: 'Hello', asset_url: 'https://example.com/v', thumbnail_url: '' },
];
const DONE = [deliverable('d9', 'sample-one', 'Finished earlier today', 'approved')];

/* -------------------------------------------------------------- scenario */
const scenario = { templates: 'ok', brain: 'ok', plans: 'ok', today: 'ok', gate: null, writes: [], noBrief: false };
function resetScenario() { Object.assign(scenario, { templates: 'ok', brain: 'ok', plans: 'ok', today: 'ok', gate: null, writes: [], noBrief: false }); }
const json = (route, body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });

async function installBackend(ctx, editor) {
  await ctx.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), async route => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname; const m = req.method();
    if (process.env.DEBUG_REQ) console.log('  req', m, p);
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (/fonts\.googleapis\.com/.test(url.host)) {
      if (!FONTS) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      const css = [400, 500, 600, 700, 800].map(w => `@font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:${w};src:url(data:font/ttf;base64,${fs.readFileSync(path.join(FONTS, 'plus-jakarta-' + w + '.ttf')).toString('base64')}) format('truetype');font-display:block}`).join('\n');
      return route.fulfill({ status: 200, contentType: 'text/css', body: css });
    }
    if (/fonts\.gstatic\.com/.test(url.host)) return route.fulfill({ status: 200, contentType: 'font/ttf', body: '' });
    if (m !== 'GET' && m !== 'HEAD' && !/functions\/v1\/(brain|filming-plans|key-verify)/.test(p)) {
      scenario.writes.push(m + ' ' + p); return json(route, { ok: false, error: 'refused_in_phone_harness' }, 403);
    }
    if (/\/functions\/v1\/key-verify/.test(p)) {
      const member = editor ? { id: 'qa_editor', name: 'QA Editor', role: 'editor', team: 'video' } : { id: 'qa_staff', name: 'QA Editor', role: 'admin', team: null };
      return json(route, { ok: true, role: member.role, member });
    }
    if (/\/rest\/v1\/templates/.test(p)) {
      if (scenario.templates === 'error') return json(route, { message: 'fixture failure' }, 500);
      if (scenario.templates === 'slow') await scenario.gate;
      return json(route, TEMPLATE_ROWS);
    }
    if (/\/functions\/v1\/brain/.test(p)) {
      if (m === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        if (body.action === 'change') { scenario.writes.push('brain change (mocked)'); return json(route, { ok: true }); }
        if (scenario.brain === 'slow') await scenario.gate;
        if (scenario.brain === 'error') return json(route, { ok: false, error: 'fixture brain failure' }, 500);
        if (scenario.brain === 'empty') return json(route, body.action === 'folders' ? { ok: true, frame: [], raw: [] } : { ok: true, found: false, facts: [], brief: [] });
        return json(route, body.action === 'folders' ? FOLDERS : (scenario.noBrief ? Object.assign({}, BRAIN, { brief: [] }) : BRAIN));
      }
    }
    if (/\/functions\/v1\/filming-plans/.test(p)) {
      if (m === 'GET') {
        if (scenario.plans === 'slow') await scenario.gate;
        if (scenario.plans === 'error') return json(route, { ok: false, error: 'fixture plans failure' }, 500);
        return json(route, { ok: true, plans: scenario.plans === 'empty' ? [] : PLANS });
      }
      scenario.writes.push('filming-plans POST (mocked)');
      return json(route, { ok: true, plan: PLANS[0] });
    }
    if (/\/rest\/v1\/deliverables/.test(p)) return json(route, [{ id: 'd2', priority: 1 }]);
    if (/\/rest\/v1\/clients/.test(p)) return json(route, CLIENTS);
    if (/\/rest\/v1\/production_deliverables_browser_v1/.test(p)) {
      if (scenario.today === 'error') return json(route, { message: 'fixture failure' }, 500);
      if (scenario.today === 'slow') await scenario.gate;
      if (scenario.today === 'empty') return json(route, []);
      const q = decodeURIComponent(url.search);
      return json(route, /status=in\.\((?:approved|kasper|client|smm)|status_at=gte/.test(q) && /approved/.test(q) ? DONE : DELIVERABLES);
    }
    if (/\/rest\/v1\/calendar_posts/.test(p)) return json(route, scenario.today === 'empty' ? [] : POSTS);
    if (/\/rest\/v1\/team_members/.test(p)) return json(route, [{ email: 'qa-editor@example.invalid' }]);
    if (/\/rest\/v1\/syncview_runtime_flags/.test(p)) return json(route, []);
    if (/\/spreadsheets\//.test(p)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return json(route, []);
  });
}

function serve() {
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    let file = path.join(SERVE_ROOT, path.normalize(rel));
    if (!file.startsWith(SERVE_ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (fs.existsSync(file + '.html')) file += '.html';
      else if (!path.extname(rel) && fs.existsSync(path.join(SERVE_ROOT, '404.html'))) { file = path.join(SERVE_ROOT, '404.html'); }
      else { res.writeHead(404); return res.end('not found'); }
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ---------------------------------------------------------------- states */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function settle(page, ms) { await page.waitForTimeout(ms || 500); }
async function go(page, tab) {
  await page.evaluate(t => navTo(t), tab);
  // The split loader may need more than one frame to expose a lazy area's controls.
  if (tab === 'templates') await page.waitForFunction(() => typeof openClientTemplate === 'function');
  await settle(page, 1500);
}
async function client(page, name) { await page.evaluate(n => { openClientTemplate(n); }, name); await settle(page, 1200); }
async function holdThen(fn, flag) {   // run fn() while the named backend answers are held, then release them
  let release; scenario.gate = new Promise(r => { release = r; }); scenario[flag] = 'slow';
  try { await fn(); } finally { scenario[flag] = 'ok'; }
  return release;
}
async function openSheet(page, which) {
  await page.locator(which === 'tabs' ? '.pocket-staff-tabs-btn' : '.pocket-staff-more-btn').click();
  await settle(page, 400);
}

const S = [];   // { name, editor, setup(page) }
const state = (name, setup, opts) => S.push(Object.assign({ name, setup }, opts || {}));

/* Templates */
state('templates-index', async p => { await go(p, 'templates'); });
state('templates-index-pins', async p => {
  await p.evaluate(n => { localStorage.setItem(TPL_PINS_KEY, JSON.stringify(n.slice(0, 3))); }, NAMES);
  await go(p, 'templates');
});
state('templates-index-search', async p => {
  await go(p, 'templates'); await p.locator('#tplSearchInput').click(); await p.keyboard.type('sam'); await settle(p, 500);
});
state('templates-index-pin-picker', async p => {
  await go(p, 'templates'); await p.locator('#tplPinsAddRow .pin-add-btn').click(); await settle(p, 500);
});
state('templates-index-pins-edit', async p => {
  await p.evaluate(n => { localStorage.setItem(TPL_PINS_KEY, JSON.stringify(n.slice(0, 3))); }, NAMES);
  await go(p, 'templates'); await p.locator('.pin-edit-btn').click(); await settle(p, 500);
});
state('templates-index-error', async p => { scenario.templates = 'error'; await p.evaluate(() => { loadTemplates(); }); await go(p, 'templates'); });
state('templates-client-loading', async p => {
  await go(p, 'templates');
  const release = await holdThen(async () => { await p.evaluate(() => { templatesLoaded = false; }).catch(() => {}); await client(p, 'Sample Client One'); }, 'templates');
  p._release = release;
});
state('templates-client', async p => { await go(p, 'templates'); await client(p, 'Sample Client One'); });
state('templates-client-empty', async p => { scenario.brain = 'empty'; await go(p, 'templates'); await client(p, 'Sample Client Two'); });
state('templates-client-brain-error', async p => { scenario.brain = 'error'; await go(p, 'templates'); await client(p, 'Sample Client One'); });
state('templates-client-edit', async p => { await go(p, 'templates'); await client(p, 'Sample Client One'); await p.evaluate(() => setTemplatesEditMode(true)); await settle(p, 600); });
state('templates-client-spec-form', async p => {
  await go(p, 'templates'); await client(p, 'Sample Client One'); await settle(p, 800);
  await p.locator('.tpl-spec-btn').first().click(); await settle(p, 400);
});
state('templates-client-change-box', async p => {
  await go(p, 'templates'); await client(p, 'Sample Client One'); await settle(p, 800);
  await p.locator('.tpl-brain-change-btn').first().click(); await settle(p, 400);
});

state('templates-client-facts', async p => { scenario.noBrief = true; await go(p, 'templates'); await client(p, 'Sample Client One'); await p.evaluate(() => tplBrainSetTab('editing')); await settle(p, 400); });
state('templates-client-brief-menu', async p => {
  await go(p, 'templates'); await client(p, 'Sample Client One'); await p.locator('.tpl-brief-more').first().click(); await settle(p, 400);
});
state('templates-client-links-many', async p => {
  await p.evaluate(() => { const l = []; for (let i = 1; i <= 6; i++) l.push('https://www.instagram.com/reel/fixture' + i + '/'); window.__many = l; });
  await go(p, 'templates');
  await p.evaluate(() => { templatesData['Sample Client One'].reels_reference_link_list = JSON.stringify(window.__many); });
  await client(p, 'Sample Client One'); await p.locator('.tpl-link-count').first().click(); await settle(p, 400);
});

/* Filming Plans */
state('filming-list', async p => { await go(p, 'filming-plans'); await settle(p, 800); });
state('filming-search-none', async p => { await go(p, 'filming-plans'); await settle(p, 600); await p.locator('.fp-toolbar input').fill('zzz'); await settle(p, 400); });
state('filming-add', async p => { await go(p, 'filming-plans'); await settle(p, 600); await p.evaluate(() => _fpToggleAdd()); await settle(p, 400); });
state('filming-edit', async p => { await go(p, 'filming-plans'); await settle(p, 600); await p.evaluate(() => _fpEdit('sample-one')); await settle(p, 400); });
state('filming-empty', async p => { scenario.plans = 'empty'; await go(p, 'filming-plans'); await settle(p, 800); });
state('filming-error', async p => { scenario.plans = 'error'; await go(p, 'filming-plans'); await settle(p, 800); });
state('filming-saved-note', async p => { await go(p, 'filming-plans'); await settle(p, 600); await p.evaluate(() => _fpSetStatus('Saved')); await settle(p, 300); });
state('filming-loading', async p => { await holdThen(async () => { await go(p, 'filming-plans'); }, 'plans'); });

/* Submit */
state('submit', async p => { await go(p, 'linear'); await settle(p, 500); });
state('submit-add-video', async p => { await go(p, 'linear'); await p.locator('.linear-add-video-btn').click(); await p.locator('#vid_main_1').fill('https://drive.google.com/file/d/fixture_main_one'); await settle(p, 300); });
state('submit-client-menu', async p => { await go(p, 'linear'); await p.locator('#linearClientSearch').click(); await p.keyboard.type('sam'); await settle(p, 500); });
state('submit-client-chosen', async p => {
  await go(p, 'linear'); await p.evaluate(() => { const i = document.getElementById('linearClientSearch'); i.value = 'Sample Client One'; i.dataset.clientSlug = 'sample-one'; saveLinearForm(); });
  await p.evaluate(() => navTo('linear')); await settle(p, 800);
});
state('submit-filled', async p => {
  await go(p, 'linear');
  await p.evaluate(() => {
    document.getElementById('linearClientSearch').value = 'Sample Client One'; document.getElementById('linearClientSearch').dataset.clientSlug = 'sample-one';
    document.getElementById('linearGeneralDrive').value = 'https://drive.google.com/drive/folders/fixture';
    document.getElementById('linearNotes').value = 'Cut the intro tight.';
    document.getElementById('vid_main_1').value = 'https://drive.google.com/file/d/fixture_main_one';
    document.getElementById('vid_notes_1').value = 'Use the warm grade.';
    saveLinearForm();
  });
  await settle(p, 300);
});
state('submit-saved-box', async p => {
  await p.evaluate(() => {
    localStorage.setItem(NATIVE_INTAKE_PENDING_KEY, JSON.stringify({ payload: { request_id: 'submission:fixture1', client_slug: 'sample-one', batch: { title: 'Sample Client One · 3 Oct 2026' }, items: [] },
      context: { surface: 'submission', clientName: 'Sample Client One', clientSlug: 'sample-one', form: { client: 'Sample Client One', clientSlug: 'sample-one', videos: [{}] } }, savedAt: Date.now() - 600000 }));
  }).catch(() => {});
  await go(p, 'linear'); await settle(p, 500);
});
state('submit-status', async p => { await go(p, 'linear'); await p.evaluate(() => { document.getElementById('linearStatus').textContent = 'Pick a client first, then try again.'; }); await settle(p, 300); });
state('submit-no-match', async p => { await go(p, 'linear'); await p.locator('#linearClientSearch').click(); await p.keyboard.type('zzzz'); await settle(p, 500); });
state('submit-banner', async p => { await p.evaluate(() => { _linearSetJustCreated(true); }).catch(() => {}); await go(p, 'linear'); await settle(p, 300); });

/* Today: SMM */
state('today-rings', async p => { await go(p, 'today'); await settle(p, 1500); });
state('today-ring-open', async p => { await go(p, 'today'); await settle(p, 1500); await p.locator('.tdy-rg').nth(1).click().catch(() => {}); await settle(p, 400); });
state('today-walk', async p => { await go(p, 'today'); await settle(p, 1500); await p.locator('.tdy-vw button').nth(1).click(); await settle(p, 500); });
// Today prefetches at boot and keeps a fresh answer for twenty seconds. Configure
// its transport before navigation, rather than relabelling a cached normal page.
const todayBeforeBoot = mode => () => { scenario.today = mode; if (mode === 'slow') scenario.gate = new Promise(() => {}); };
const todayEmpty = async p => {
  await go(p, 'today');
  await p.waitForFunction(() => tdyState.data && !tdyState.data.open.length && !tdyState.data.done.length && !(tdyState.data.posts || []).length);
  await p.locator('#tdyRoot .tdy-win h2').filter({hasText:'All clear'}).waitFor();
};
state('today-all-clear', todayEmpty, {beforeBoot:todayBeforeBoot('empty')});
state('today-error', async p => { await go(p, 'today'); await p.locator('#tdyRoot [role=alert]').filter({hasText:'Today could not load'}).waitFor(); }, {beforeBoot:todayBeforeBoot('error')});
state('today-loading', async p => { await go(p, 'today'); await p.waitForFunction(() => !tdyState.data && !tdyState.error && !!document.querySelector('#tdyRoot .sv-skeleton')); }, {beforeBoot:todayBeforeBoot('slow')});
/* Today: editor */
state('today-editor-list', async p => { await go(p, 'today'); await settle(p, 1500); }, { editor: true });
state('today-editor-deck', async p => { await go(p, 'today'); await settle(p, 1500); await p.locator('.tdy-vw button').nth(1).click(); await settle(p, 500); }, { editor: true });
state('today-editor-all-clear', todayEmpty, { editor: true, beforeBoot:todayBeforeBoot('empty') });

/* Phone bar sheets (after the bar exists) */
state('sheet-tabs', async p => { await go(p, 'today'); await settle(p, 1200); await openSheet(p, 'tabs'); });
state('sheet-more', async p => { await go(p, 'today'); await settle(p, 1200); await openSheet(p, 'more'); });
state('sheet-more-templates', async p => { await go(p, 'templates'); await settle(p, 600); await openSheet(p, 'more'); });
state('client-picker', async p => {
  await go(p, 'templates'); await settle(p, 600); await openSheet(p, 'more');
  await p.locator('.pocket-staff-sheet button', { hasText: 'Change client' }).click(); await settle(p, 500);
});

/* --------------------------------------------------------------- measure */
async function measure(page) {
  return page.evaluate(() => {
    const vis = e => e.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true });
    const inDialog = e => !!e.closest('dialog[open]');
    const modal = document.querySelector('dialog[open]');
    const scope = modal || document;
    const targets = [...scope.querySelectorAll('button, summary, a[href], input:not([type=hidden]), textarea, select, [role=button]')]
      .filter(e => vis(e) && (!modal || modal.contains(e)) && !e.closest('.sv-skeleton'))
      .map(e => { const box = (e.type === 'checkbox' || e.type === 'radio') && e.closest('label') ? e.closest('label') : e; const r = box.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), what: (e.getAttribute('aria-label') || e.id || e.className || e.textContent || '').toString().trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), inline: e.tagName === 'A' && getComputedStyle(e).display === 'inline' && !!e.closest('p, .tpl-brain-prose, .tpl-brief-body') }; })
      .filter(t => t.w > 0 && t.h > 0);
    const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=color]), textarea, select')]
      .filter(vis).map(e => ({ what: e.id || e.className, size: parseFloat(getComputedStyle(e).fontSize) }));
    // Text characters standing in for icons (arrows, check marks, crosses, bullets, warning signs, emoji).
    const glyphs = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const bad = /[\u2190-\u21FF\u2713\u2714\u2715\u2716\u2717\u00D7\u2022\u25CF\u25CB\u25B2\u25BC\u25B6\u25C0\u2039\u203A\u26A0\u2197]|\p{Extended_Pictographic}/u;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent.trim() || !bad.test(n.textContent)) continue;
      if (/^(SCRIPT|STYLE|TEXTAREA)$/.test(el.tagName) || el.closest('script,style,template')) continue;
      if (!el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs === 0) continue;   // hidden on purpose: an SVG icon is drawn in its place
      glyphs.push(((el.className && String(el.className)) || el.tagName) + ': ' + n.textContent.trim().slice(0, 24));
    }
    return { innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth, targets, fields, glyphs };
  });
}
function judge(m, width) {
  const bad = [];
  if (m.scrollWidth > width + 1) bad.push('page scrolls sideways (' + m.scrollWidth + ' > ' + width + ')');
  m.targets.filter(t => !t.inline && (t.w < 43.5 || t.h < 43.5)).forEach(t => bad.push('small target ' + t.tag + ' "' + t.what + '" ' + t.w + 'x' + t.h));
  (m.glyphs || []).forEach(g => bad.push('text character used as an icon: ' + g));
  m.fields.filter(f => f.size < 16).forEach(f => bad.push('field text under 16px: ' + f.what + ' ' + f.size));
  return bad;
}

/* ------------------------------------------------------------------- run */
if (require.main === module) (async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const failures = []; let ran = 0;
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  try {
    for (const theme of THEMES) for (const width of WIDTHS) for (const st of S) {
      if (ONLY && !ONLY.test(st.name)) continue;
      resetScenario();
      if (st.beforeBoot) st.beforeBoot();
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
      await installBackend(ctx, !!st.editor);
      await seedStaffGate(ctx);
      if (st.editor) {
        await ctx.addInitScript(() => { try { localStorage.setItem('syncview_staff_identity_v1', JSON.stringify({ key: 'qa-staff-gate-key', role: 'editor',
          member: { id: 'qa_editor', name: 'QA Editor', role: 'editor', team: 'video' }, verified_at: new Date().toISOString() })); } catch (e) {} });
        await ctx.route('**/functions/v1/key-verify', r => json(r, { ok: true, role: 'editor', member: { id: 'qa_editor', name: 'QA Editor', role: 'editor', team: 'video' } }));
      }
      await ctx.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message)); if (process.env.DEBUG_REQ) { page.on('console', c => { if (c.type() === 'error' || c.type() === 'warning') console.log('  console', c.text().slice(0, 200)); }); page.on('pageerror', e => console.log('  pageerror', e.message.slice(0, 200))); }
      try {
        await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.navTo === 'function', null, { timeout: 30000 });
        await settle(page, 1500);
        // The app ships a built-in client roster. Swap it for made-up names before anything is drawn, and remember
        // the real ones only to prove none is on screen (counts are reported, names never are).
        await page.evaluate(n => {
          window.__seedRoster = WL_CLIENT_NAMES.slice();
          WL_CLIENT_NAMES.splice(0, WL_CLIENT_NAMES.length, ...n);
          WL_CLIENT_CANONICAL.clear(); n.forEach(x => WL_CLIENT_CANONICAL.set(wlNormalizeClient(x), x));
        }, NAMES);
        await page.evaluate(n => { try { wlMergeClientsFromSheet(n); } catch (e) {} Object.assign(clientMap, { 'Sample Client One': { instagram_handle: 'sample.one', tiktok_handle: 'sampleone', youtube_channel_id: 'UCsample0000000000000000' } }); }, NAMES).catch(() => {});
        await st.setup(page);
        if (FREEZE) await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
        await settle(page, 300);
        const label = `${st.name} ${width} ${theme}`;
        if (process.env.EVAL_JS) console.log('  eval:', JSON.stringify(await page.evaluate(process.env.EVAL_JS)));
        const m = await measure(page);
        const bad = BEFORE ? [] : judge(m, width);
        const leaked = await page.evaluate(() => { const text = document.body.innerText.toLowerCase(); return (window.__seedRoster || []).filter(n => n && text.includes(String(n).toLowerCase())).length; });
        if (leaked) bad.push(leaked + ' built-in client name(s) visible on screen: this is a public repo');
        if (!BEFORE && errors.length) bad.push('page errors: ' + errors.slice(0, 2).join(' | '));
        if (scenario.writes.some(w => !/mocked/.test(w))) bad.push('write attempted: ' + scenario.writes.join(', '));
        bad.forEach(b => failures.push(label + ': ' + b));
        ran++;
        receipt.push({ state: st.name, width, theme, pageWidth: m.scrollWidth, controls: m.targets.length,
          smallestControl: m.targets.filter(t => !t.inline).reduce((a, t) => Math.min(a, t.w, t.h), 999), editableFields: m.fields.length,
          smallestFieldText: m.fields.reduce((a, f) => Math.min(a, f.size), 999), problems: bad.length });
        if (SHOTS) {
          await page.evaluate(() => document.fonts.ready);
          const open = await page.locator('dialog[open], .sv-client-pop:not([hidden]), .search-dropdown.open, .linear-search-dropdown.open').count();
          await page.screenshot({ path: path.join(SHOTS, `${st.name}-${theme}-${width}.png`), fullPage: !open });
        }
        console.log((bad.length ? 'FAIL ' : 'ok   ') + label + (bad.length ? '\n       ' + bad.slice(0, 6).join('\n       ') : ''));
      } catch (e) {
        failures.push(`${st.name} ${width} ${theme}: ${e.message.split('\n')[0]}`);
        console.log('FAIL ' + st.name + ' ' + width + ' ' + theme + ': ' + e.message.split('\n')[0]);
      }
      if (page._release) page._release();
      await ctx.close();
    }
  } finally {
    await browser.close(); server.close();
  }
  if (REPORT) fs.writeFileSync(REPORT, JSON.stringify({ renders: receipt.length, problems: failures.length, widths: WIDTHS, themes: THEMES, receipt }, null, 1) + '\n');
  console.log(`staff-phone-browser: ${ran} state renders, ${failures.length} problems`);
  if (failures.length && !BEFORE) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });

// The final-pass proof reuses these native journeys and the same refused-write transport.
module.exports = { serve, installBackend, resetScenario, S, NAMES, measure, judge };
