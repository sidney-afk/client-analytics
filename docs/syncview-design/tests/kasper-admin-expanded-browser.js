'use strict';
// Native product renders, fictional data, and fully intercepted transports.
// Run through the visible-Chrome adapter locally; CI may supply its own browser.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');
const BASE_ROW = { id:'p_phone_fixture',client_slug:'phone-fixture',post_type:'Reel',type:'Reel',caption_alt:'',caption_status:'Kasper Approval',cta:'Try one small change today.',scheduled_date:'2026-10-12',platforms:['instagram'],tweaks:[],graphic_status:'Kasper Approval',video_status:'Kasper Approval' };
const root = path.resolve(__dirname, '../../..');
const arg = name => process.argv.find(x => x.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
const before = process.argv.includes('--capture-before');
const base = path.resolve(arg('before-root') || root);
const desktop = process.argv.includes('--desktop');
const widths = arg('width') ? [Number(arg('width'))] : desktop ? [1024,1280,1440,1920] : [360,390,430];
const out = arg('out');
const themes = arg('theme') ? [arg('theme')] : ['light','dark'];
const only = arg('only');
const failures = [], rows = [];
let checks = 0;
const expect = (value, message) => { checks++; if (!value) failures.push(message); };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const profile = { slug: 'phone-fixture', display_name: 'Example workspace', email: 'contact@example.invalid', instagram_handle: '@example', keywords: 'Daily routines', content_description: 'Useful practical advice.', source: 'sheet', extra: {}, updated_at: '2026-10-01T10:00:00Z', archived_at: null };
const fixture = { ...BASE_ROW, id: 'p_phone_reviewer_fixture', name: 'Make room for a better day.', status: 'Kasper Approval', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval', caption: 'A small habit can change the rest of your day. Start with one thing you can keep doing.', graphic_deliverable_id:'00000000-0000-4000-8000-000000000002', thumbnail_url: 'https://images.example.invalid/phone.png', asset_url: 'https://media.example.invalid/example-video', scheduled_date: '2026-10-12', tweaks: [] };
const item = { client: 'Example workspace', slug: 'phone-fixture', post: fixture, _expanded: false, smm: { name: 'Team member' } };
const tests = [];
const add = (label, tab, setup, action) => tests.push({ label, tab, setup, action });
add('review-empty', 'review');
add('review-queue', 'review', data => { _kasperState.items = [data]; _kasperPaintReviewNow(); });
add('review-open', 'review', data => { data._expanded = true; _kasperState.items = [data]; _kasperPaintReviewNow(); });
add('review-finish-ready', 'review', data => { data._expanded = true; data.post.status = data.post.video_status = data.post.graphic_status = data.post.caption_status = 'Approved'; _kasperState.items = [data]; document.getElementById('kasperReviewBody').innerHTML = _kasperRenderCard(data); });
add('review-single', 'review', data => { data._expanded = true; data.post.video_status = 'Approved'; data.post.graphic_status = 'Approved'; _kasperState.items = [data]; _kasperPaintReviewNow(); });
add('review-unsaved', 'review', data => { data._expanded = true; _kasperState.items = [data]; _kasperState.saveAlerts = [{ pid: data.post.id, client: data.client, name: data.post.name, text: 'Your decision has not saved. Keep this page open and retry.' }]; _kasperPaintReviewNow(); });
add('review-error', 'review', () => { _kasperState.items = []; _kasperState.error = 'The review queue could not load. Try again.'; _kasperPaintReviewNow(); });
add('review-loading', 'review', () => { document.getElementById('kasperContent').innerHTML = _svLoadingSkeletonHtml('kasper', { label: 'Loading review queue' }); });
add('messages-empty', 'replies');
add('messages', 'replies', data => {
  data.post.name = 'Make room for a better day with one small habit you can keep.';
  data.post.caption_comments = [{ id: 'm_fixture_old', role: 'kasper', author: 'Reviewer', audience: 'internal', is_tweak: false, body: 'Keep the tone relaxed.', created_at: '2026-10-02T10:00:00Z' }, { id: 'm_fixture_root', role: 'kasper', author: 'Reviewer', audience: 'internal', is_tweak: false, body: 'Please simplify this opening sentence.', created_at: '2026-10-03T10:00:00Z' }, { id: 'm_fixture_reply', parent_id: 'm_fixture_root', role: 'smm', author: 'Team member', audience: 'internal', is_tweak: false, body: 'The opening is shorter now. Please take another look.', created_at: '2026-10-04T10:00:00Z' }];
  _kasperMarkSeenAt(data.post.id, '2026-10-03T12:00:00Z');
  data._showAllReplies = true; _kasperState.replies = [data]; _kasperRenderReplies();
});
add('messages-compose', 'replies', data => { data._replyDraft = 'Thanks — I will check the updated version.'; data._showAllReplies = true; _kasperState.replies = [data]; _kasperRenderReplies(); });
add('editors-empty', 'editors');
add('editors', 'editors', () => { _kasperState.editorsData = { weekStart: '2026-09-28T05:00:00Z', weekLabel: 'Last week', editors: [{ key: 'fixture-editor', id: 'fixture-editor', name: 'Example editor', videos: [], perDay: {}, finished: 0, stillOpen: 2 }], unattributedTransitions: 0 }; _kedPaint(); });
add('editor-info', 'editors', null, p => p.locator('#kedInfoBtn').click());
add('filming-empty', 'filming');
add('filming', 'filming', () => { _kasperState.filmingData = { rows: [{ client: 'Example workspace', slug: 'phone-fixture', status: 'amber', contentTotal: 12, docUrl: 'https://docs.example.invalid/plan', latestPlanMonth: '2026-09', tabTitles: ['September plan'], months: ['2026-09'], nextDue: '2026-10-15', reason: 'A new plan is due soon.' }] }; _filmsPaint(); });
add('filming-info', 'filming', null, p => p.locator('#kfilmInfoBtn').click());
add('time-off-empty', 'time-off', () => { _ptoAdminState.overview = { admin_members: [], pending_requests: [], as_of_date: '2026-10-05' }; _ptoAdminState.loading = false; _ptoAdminState.error = ''; _ptoRenderAdmin(); });
add('time-off', 'time-off', () => { _ptoAdminState.overview = { as_of_date: '2026-10-05', admin_members: [{ member_id: 'fixture-member', name: 'Example team member', role: 'creative', team: 'video', pto_enabled: true, pto_start_date: '2026-01-01', wellness_granted: 10, wellness_available: 7, sick_available: 5 }], pending_requests: [{ id: 'fixture-request', member_id: 'fixture-member', member_name: 'Example team member', type: 'wellness', start_date: '2026-10-14', end_date: '2026-10-16', days: 3, note: 'A few days away to recharge.', status: 'pending' }], upcoming_approved_requests: [], recent_requests: [], absences: [], holidays: [] }; _ptoAdminState.loading = false; _ptoAdminState.error = ''; _ptoRenderAdmin(); });
add('time-off-error', 'time-off', () => { _ptoAdminState.overview = null; _ptoAdminState.loading = false; _ptoAdminState.error = 'Could not load requests. Your decisions have not changed.'; _ptoRenderAdmin(); });
add('sales-intake', 'sales-intake');
add('hiring-empty', 'hiring-process');
add('hiring', 'hiring-process', () => { _hpState.list = [{ id: '00000000-0000-4000-8000-000000000001', name: 'Example applicant', email: 'applicant@example.invalid', status: 'new', submitted_at: '2026-10-01T10:00:00Z' }]; _hpState.loadingList = false; _hpState.listError = ''; _hpPaint(); });
add('hiring-detail', 'hiring-process', () => { _hpState.list = [{ id: '00000000-0000-4000-8000-000000000001', name: 'Example applicant', email: 'applicant@example.invalid', status: 'new', submitted_at: '2026-10-01T10:00:00Z' }]; _hpState.selectedId = _hpState.list[0].id; _hpState.detail = { ..._hpState.list[0], answers: [{ question: 'What would you bring to this role?', answer: 'Clear communication and a consistent approach to client work.' }], when_can_start: 'In two weeks', invite_state: 'none' }; _hpState.loadingList = false; _hpState.loadingDetail = false; _hpState.listError = ''; _hpPaint(); });
add('hiring-error', 'hiring-process', () => { _hpState.list = []; _hpState.listError = 'Applications could not load. Try again.'; _hpState.loadingList = false; _hpPaint(); });
add('onboarding-empty', 'onboarding');
add('credentials-empty', 'client-credentials');
add('credentials', 'client-credentials', () => { _ccState.kasper.credentials = [{ id: 'fixture-credential', client_slug: 'phone-fixture', client_name: 'Example workspace', platform: 'instagram', handle: '@example', password: '', notes: 'Example account; no private information.', status: 'active' }]; _ccState.kasper.loaded = true; _ccState.kasper.loading = false; _ccState.kasper.error = null; _ccExpanded.add('phone-fixture'); _ccPaintKasper(); });
add('credentials-masked', 'client-credentials', () => { _ccState.kasper.credentials = [{ id: 'fixture-credential', client_slug: 'phone-fixture', client_name: 'Example workspace', platform: 'instagram', handle: '@example', password: 'synthetic-fixture-value', notes: 'Fictional value, shown masked.', status: 'active' }]; _ccState.kasper.loaded = true; _ccState.kasper.loading = false; _ccState.kasper.error = null; _ccExpanded.add('phone-fixture'); _ccPaintKasper(); });
add('credential-add', 'client-credentials', null, p => p.locator('.cc-topbar .cc-btn').filter({ hasText: 'Add credential' }).click());
add('clients', 'clients', (data, row) => { _caState.rows = [row]; _caState.loaded = true; _caState.loading = false; _caState.error = null; _caState.selected = null; _caPaint(); });
add('client-detail', 'clients', (data, row) => { _caState.rows = [row]; _caState.loaded = true; _caState.loading = false; _caState.error = null; _caState.selected = row.slug; _caPaint(); });
add('clients-error', 'clients', () => { _caState.rows = []; _caState.loading = false; _caState.loaded = false; _caState.error = 'The client list could not load. Refresh to try again.'; _caPaint(); });
add('quiz-empty', 'quiz-leads');
add('quiz', 'quiz-leads', () => { _kqlState.leads = [{ response_id: 'fixture-lead', contact_name: 'Example lead', contact_email: 'lead@example.invalid', result_category: 'consistency', created_at: '2026-10-01T10:00:00Z', answers: { q1: 3, q2: 4 } }]; _kqlState.loaded = true; _kqlState.loading = false; _kqlState.error = null; _kqlPaint(); });
add('quiz-detail', 'quiz-leads', () => { _kqlState.leads = [{ response_id: 'fixture-lead', contact_name: 'Example lead', contact_email: 'lead@example.invalid', result_category: 'consistency', created_at: '2026-10-01T10:00:00Z', answers: { q1: 3, q2: 4 } }]; _kqlState.loaded = true; _kqlState.loading = false; _kqlState.error = null; _kqlPaint(); _kqlToggle('fixture-lead'); });
add('quiz-error', 'quiz-leads', () => { _kqlState.loading = false; _kqlState.error = 'Could not load quiz responses. Try again.'; _kqlPaint(); });
add('ads-empty', 'ad-performance');
add('ads', 'ad-performance', () => { _kadState.rows = [{ date: '2026-10-01', spend: 75, impressions: 1200, clicks: 38, bookings: 3 }]; _kadState.byAd = []; _kadState.loaded = true; _kadState.loading = false; _kadState.error = null; _kadPaint(); });
add('ads-error', 'ad-performance', () => { _kadState.loading = false; _kadState.error = 'Ad performance could not load. Try again.'; _kadPaint(); });
add('save-problems-empty', 'save-problems');
add('save-problems', 'save-problems', () => { _spState.loaded = true; _spState.loading = false; _spState.error = null; _spState.data = { rows: [{ surface: 'calendar', ui_action: 'Approve', operation: 'review', code: 'network_failure', recorded_at: '2026-10-01T10:00:00Z', attempts: 2, page: 'staff_page', staff_role: 'admin', detail: 'The connection was interrupted. Your decision has not saved.', browser: 'Chrome', os: 'Fixture OS', card_ref: 'fixture-card' }], total: 1 }; _spPaint(); });
add('save-problems-error', 'save-problems', () => { _spState.loading = false; _spState.error = 'Save problems could not load. Try again.'; _spPaint(); });
add('more', 'review', null, p => p.locator('[data-kasper-more-trigger]').click());
add('tabs', 'review', null, async p => { if (!before && !desktop) await p.getByRole('button', { name: 'Tabs', exact: true }).click(); });
add('tabs-client-picker','review',null,async p=>{ if(!before&&!desktop) await p.getByRole('button',{name:'Tabs',exact:true}).click();await p.locator('#svClientBadge').click();await p.locator('#svClientSearch').fill('Example'); });
add('account', 'review', null, async p => { if (!before && !desktop) { await p.locator('[data-kasper-more-trigger]').click(); await p.locator('#kasperMoreMenu .pocket-admin-account').click(); } else await p.evaluate(() => _syncviewOpenStaffAccount()); });


add('client-edit', 'clients', (data,row) => { _caState.rows=[row];_caState.selected=row.slug;_caState.loaded=true;_caState.loading=false;_caState.error=null;_caPaint(); }, p => p.locator('.ca-detail-head .cc-btn').filter({hasText:'Edit'}).click());
add('credential-history','client-credentials',null,async p => { await p.evaluate(()=>_ccOpenHistory('','phone-fixture'));await p.locator('#ccHistBody').waitFor(); });
add('credential-platform','client-credentials',null,async p => { await p.evaluate(()=>_ccOpenEdit('','kasper','phone-fixture'));await p.locator('#ccEditPlatformBtn').click(); });
add('sales-date','sales-intake',null,async p => { if(!before&&!desktop) await p.locator('[data-sv-date-trigger]').click(); });
add('sales-draft','sales-intake',null,async p => { await p.locator('[data-si=client_name]').fill('Example customer');await p.locator('[data-si=deliverables]').fill('Four useful videos each month.'); });
add('review-note','review',data => {data._expanded=true;_kasperState.items=[data];_kasperPaintReviewNow();},async p => {await p.locator('.cal-review-textarea').first().fill('Please simplify the opening sentence.');});
add('review-lightbox','review',data => {data._expanded=true;_kasperState.items=[data];_kasperPaintReviewNow();},async p => {await p.evaluate(()=>_kasperOpenLightbox('p_phone_reviewer_fixture'));});
for (const [label,tab,state,paint] of [['credentials','client-credentials','_ccState.kasper','_ccPaintKasper'],['quiz','quiz-leads','_kqlState','_kqlPaint'],['ads','ad-performance','_kadState','_kadPaint'],['save-problems','save-problems','_spState','_spPaint']]) {
 add(label+'-loading',tab,new Function('data','row',state+'.loading=true;'+state+'.loaded=false;'+state+'.error=null;'+paint+'();'));
}
add('onboarding','onboarding',null,async p => {
 await p.context().route('**/functions/v1/onboarding-full**',r=>r.fulfill({status:200,headers:CORS,contentType:'application/json',body:JSON.stringify({submissions:[{id:'fixture-submission',slug:'phone-fixture',first_name:'Example',last_name:'customer',email:'contact@example.invalid',funnel:'standard',created_at:'2026-10-01T10:00:00Z',answers:{brand_guidelines:'https://docs.example.invalid/brand',ideal_customer:'Busy people who want sustainable routines.',pain_points:'Too many complicated plans and too little time.',desired_outcomes:'A simpler routine that fits a real working day.',process:'One practical step at a time, with clear examples.',success:'Explain useful ideas clearly and consistently.',anything_else:'Keep the tone relaxed and the pace comfortable.',photos_link:'https://images.example.invalid/examples',source_material:'https://docs.example.invalid/source',instagram_username:'@example',subtitle_style:'bold'}}]})}));
 await p.evaluate(()=>_obvRefresh());await p.locator('.obv-card').waitFor();
});
add('onboarding-detail','onboarding',null,async p => { await p.locator('.obv-card').first().click();await p.locator('.obv-back').waitFor(); });
add('onboarding-error','onboarding',null,async p => { await p.context().route('**/functions/v1/onboarding-full**',r=>r.fulfill({status:503,headers:CORS,contentType:'application/json',body:'{}'}));await p.evaluate(()=>_obvRefresh());await p.locator('.obv-empty').waitFor(); });
add('standalone-credentials','client-credentials',null,p=>p.evaluate(()=>_svOpenStaffPage('client-credentials')));
add('standalone-onboarding','onboarding',null,p=>p.evaluate(()=>_svOpenStaffPage('staff-onboarding')));

function serve() {
  const server = http.createServer((req,res) => {
    const u = new URL(req.url,'http://127.0.0.1');
    const file = path.resolve(base, '.' + decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0,'127.0.0.1',() => resolve(server)));
}
async function capture(page,label,width,theme) {
  await page.mouse.move(0,0);
  // Visible labels only, for public proof. Native controls/handlers stay intact.
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { const n = walker.currentNode; if (!n.parentElement.closest('style,script')) n.textContent = n.textContent.replace(/\bKasper\b/g,'Reviewer'); }
    document.querySelectorAll('[aria-label],[title],[placeholder]').forEach(n => { for (const attr of ['aria-label','title','placeholder']) if (n.hasAttribute(attr)) n.setAttribute(attr,n.getAttribute(attr).replace(/\bKasper\b/g,'Reviewer')); });
    document.querySelectorAll('#kasperContent video').forEach(video => { video.pause();video.poster='https://images.example.invalid/phone.png'; });
    document.activeElement?.blur();
  });
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.evaluate(() => {
    const visible = n => n.checkVisibility({ checkVisibilityCSS: true }) && n.getBoundingClientRect().height > 0;
    const controls = [...document.querySelectorAll('button,a[href],[role=button],[role=option],summary,input:not([type=hidden]),select,textarea')].filter(visible).filter(n => !(n.getBoundingClientRect().width <= 1 && getComputedStyle(n).opacity === '0')).map(n => { const target = n.matches('input[type=radio],input[type=checkbox]') ? n.closest('label') || n : n; const r = target.getBoundingClientRect(); return { name: (n.id || n.className || n.tagName).toString().slice(0,90), w:r.width,h:r.height }; });
    const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable=true]')].filter(visible).map(n => parseFloat(getComputedStyle(n).fontSize));
    return { width:innerWidth, scrollWidth:document.documentElement.scrollWidth,controls,fields };
  });
  if (!before && !desktop) {
    expect(metrics.scrollWidth <= width + 1,label + ': sideways page scroll ' + metrics.scrollWidth);
    for (const c of metrics.controls) expect(c.w >= 43.5 && c.h >= 43.5,label + ': target below 44px ' + JSON.stringify(c));
    for (const f of metrics.fields) expect(f >= 16,label + ': text field below 16px');
  }
  rows.push({ label,width,theme,...metrics });
  if (out) {
    if(desktop) { const styles=await page.evaluate(()=>[...document.querySelectorAll('body *')].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return [n.tagName,[...s].sort().map(k=>k+':'+s.getPropertyValue(k).replaceAll(location.origin,'__LOCAL_ORIGIN__')).join(';'),Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)].join('|');}).join('\n'));rows[rows.length-1].styleHash=require('node:crypto').createHash('sha256').update(styles).digest('hex'); }
    fs.mkdirSync(out,{recursive:true});
    const overlay = await page.locator('dialog[open], .cal-import-overlay.open, .kasper-lightbox.open, .dp-popup, .kasper-more.open, #staffAccountPopover:not([hidden])').count();
    await page.screenshot({path:path.join(out,label+'-'+theme+'-'+width+'.png'),fullPage:!overlay,animations:'disabled'});
  }
}
async function open(browser,origin,width,theme) {
  const ctx = await browser.newContext({ viewport:{width,height:844},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce' });
  await ctx.route(u => !u.toString().startsWith(origin), async route => {
    const q = route.request(),u = new URL(q.url());
    const json = body => route.fulfill({ status:200,headers:CORS,contentType:'application/json',body:JSON.stringify(body) });
    if (q.method() === 'OPTIONS') return route.fulfill({ status:204,headers:CORS,body:'' });
    if (u.hostname === 'images.example.invalid') return route.fulfill({ status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#e6ddf5"/><circle cx="720" cy="400" r="220" fill="#c8b6e9"/><path d="M0 1000Q450 600 1080 1100V1350H0Z" fill="#9580b8"/></svg>' });
    if (u.pathname.endsWith('/analytics-read')) return json({ ok:true,principal:'staff',clients:[profile] });
    if (u.pathname.endsWith('/client-credentials')) return json({ ok:true,credentials:[],clients:[{slug:profile.slug,name:profile.display_name}],history:[] });
    if (u.pathname.endsWith('/client-profile-write')) return json({ ok:true,sheet_configured:true,row:profile });
    if (u.pathname.endsWith('/syncview_runtime_flags') && u.search.includes('pto_enabled')) return json([{ key:'pto_enabled',value:{mode:'on'} }]);
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/|\/webhook\//.test(u.pathname)) return json({ ok:true,applications:[],leads:[],rows:[],daily:[],editors:[],submissions:[],pending_requests:[],admin_members:[] });
    return route.abort(); // Fonts/CDNs/images never escape the fixture.
  });
  await ctx.route('**/*',r => {
    if(r.request().resourceType()==='image' && !new URL(r.request().url()).pathname.startsWith('/nav-icons/')) return r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#e6ddf5"/><circle cx="720" cy="400" r="220" fill="#c8b6e9"/><path d="M0 1000Q450 600 1080 1100V1350H0Z" fill="#9580b8"/></svg>'});
    if(r.request().resourceType()==='media') return r.abort();
    return r.fallback();
  });
  if(desktop) await ctx.addInitScript(() => {
    // These are deliberately seeded snapshots. Foregrounding another proof
    // window must not replace their data with the empty background transport.
    window.addEventListener('focus',e=>{if(e.target===window)e.stopImmediatePropagation();},true);
    window.addEventListener('pageshow',e=>e.stopImmediatePropagation(),true);
    document.addEventListener('visibilitychange',e=>e.stopImmediatePropagation(),true);
  });
  await seedStaffGate(ctx);
  await ctx.addInitScript(() => { const NativeDate = Date; const stamp = NativeDate.parse('2026-10-05T14:00:00Z'); window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [stamp])); } static now() { return stamp; } }; });
  await ctx.addInitScript(t => { sessionStorage.setItem('syncview_kasper_unlocked','ok');localStorage.setItem('syncview_theme',t); },theme);
  if (process.env.POCKET_FONT_DIR) {
    const css = [400,500,600,700,800].map(w => "@font-face{font-family:'Plus Jakarta Sans';font-weight:"+w+";src:url(data:font/ttf;base64,"+fs.readFileSync(path.join(process.env.POCKET_FONT_DIR,'plus-jakarta-'+w+'.ttf')).toString('base64')+") format('truetype');font-display:block}").join('\n');
    await ctx.route('https://fonts.googleapis.com/**',r => r.fulfill({status:200,contentType:'text/css',body:css}));
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror',e => errors.push(e.message));
  await page.goto(origin+'/#kasper',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => typeof _kasperGotoTab === 'function');
  await page.waitForTimeout(1200);
  // Same freeze as the desktop gate: a running placeholder pulse must not
  // masquerade as a computed-style change between identical product pages.
  await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
  if(process.env.POCKET_CHART_FILE) { await page.addScriptTag({content:fs.readFileSync(process.env.POCKET_CHART_FILE,'utf8')});await page.evaluate(()=>{Chart.defaults.animation=false;}); }
  await page.evaluate(() => {
    WL_CLIENT_NAMES.splice(0,WL_CLIENT_NAMES.length,'Example workspace');
    WL_CLIENT_CANONICAL.clear(); WL_CLIENT_CANONICAL.set('phone-fixture','Example workspace');
    _ptoStoreFlagValue({ mode:'on' });
    document.getElementById('content').innerHTML = renderKasperView(); mountKasperView();
  });
  return {ctx,page,errors};
}
async function runMain() {
  const server = await serve(); const origin = 'http://127.0.0.1:'+server.address().port;
  const browser = await chromium.launch({headless:!process.argv.includes('--headed')});
  try {
    for (const width of widths) for (const theme of themes) {
      const {ctx,page,errors} = await open(browser,origin,width,theme);
      try {
        for (const t of tests.filter(t => (!only || only.split(',').some(label=>t.label.includes(label))) && (!desktop || ['review-empty','review-open','review-single','messages','editors','filming','time-off','sales-intake','hiring-detail','onboarding','onboarding-detail','credentials','client-detail','quiz-detail','ads','save-problems','credential-add','account'].includes(t.label)))) {
          try {
            await page.evaluate(tab => {
              document.activeElement?.blur(); _syncviewCloseStaffAccount(); _kasperSetMoreOpen(false,false,false);
              document.querySelector('dialog.pocket-admin-tabs')?.dispatchEvent(new Event('cancel',{cancelable:true}));
              _ccCloseModal();
              document.getElementById('ccEditClose')?.click();
              document.getElementById('ccHistClose')?.click();
              document.getElementById('ccObClose')?.click();
              _kasperCloseLightbox();
              document.querySelector('.dp-popup .dp-close')?.click();
              document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
              if(currentNav !== 'kasper') navTo('kasper');
              _kasperState.items = []; _kasperState.replies = []; _kasperState.saveAlerts = []; _kasperState.error = '';
              _kasperState.lastLoaded = Date.now(); _kasperState.loading = false;
              _ptoStoreFlagValue({ mode:'on' }); // Each fictional state uses the declared enabled flag, including after background refresh.
              _kasperState.editorsData = { editors:[] }; _kasperState.filmingData = { rows:[] };
              _kasperGotoTab(tab);
            },t.tab);
            await page.waitForTimeout(250);
            const nativeTab = await page.evaluate(() => _kasperState.tab);
            if (nativeTab !== t.tab) throw new Error('Native tab mismatch: wanted '+t.tab+', got '+nativeTab);
            if (t.setup) {
              const source = t.setup.toString();
              await page.evaluate(({source,item,profile}) => new Function('data','row','return ('+source+')(data,row)')(item,profile),{source,item:JSON.parse(JSON.stringify(item)),profile});
            }
            if (t.action) await t.action(page);
            if (!before && !desktop) {
              await page.waitForTimeout(50);
              const dashboard = ['review','replies','filming'].includes(t.tab) && !t.label.startsWith('staff-');
              expect(await page.locator('.kasper-subtabs:visible').count() === (dashboard ? 1 : 0), t.label+': reviewer navigation belongs only to dashboard');
              if (dashboard) {
                const segments=await page.locator('.kasper-subtabs > .kasper-primary-tab:visible').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,width:r.width};}));
                expect(segments.length===3 && Math.max(...segments.map(s=>s.width))-Math.min(...segments.map(s=>s.width))<1 && Math.max(...segments.map(s=>s.top))-Math.min(...segments.map(s=>s.top))<1,t.label+': reviewer segments fill three equal columns on every view');
              }
              const header = await page.locator('.pocket-admin-heading').evaluate(el => ({ tabs:!!el.querySelector('button[aria-haspopup="dialog"] svg path[d="m5 7 5 5 5-5"]'),dots:[...el.querySelectorAll('.pocket-admin-more-icon circle,.pocket-admin-heading-actions > .pocket-admin-account circle')].map(n=>n.getAttribute('r')) }));
              expect(header.tabs && header.dots.length===3 && header.dots.every(r=>r==='1.7'), t.label+': approved Calendar header icons');
              if (t.label === 'review-open') {
                const finish = await page.locator('.kcard-done-btn').evaluate(b => ({ disabled:b.disabled, opacity:getComputedStyle(b).opacity, nowrap:getComputedStyle(b).whiteSpace, fits:b.scrollWidth<=b.clientWidth }));
                expect(finish.disabled && Number(finish.opacity)===.55 && finish.nowrap==='nowrap' && finish.fits,'Pending Finish uses the shared disabled appearance and fits on one line');
                expect(await page.getByRole('button',{name:'Hide card',exact:true}).textContent()==='Hide card','Native queue-hide action has a visible label distinct from Collapse');
                const actionRows = await page.locator('.cal-review-tweak-actions').evaluateAll(rows => rows.map(row => [...row.children].map(b=>b.getBoundingClientRect().top)));
                expect(actionRows.length===3 && actionRows.every(tops=>tops.length===3 && Math.max(...tops)-Math.min(...tops)<1),'Review: three secondary actions stay on one row per part');
                expect(await page.locator('.kcard-actions .kcard-expand-btn:visible').count()===0,'Review: no floating disclosure under card');
                expect(await page.locator('.kcard-dot:visible').count()===0,'Review: no trailing workspace separator');
                await page.getByRole('button',{name:'Collapse card',exact:true}).click();
                expect(await page.locator('.kasper-review-body').count()===0,'Moved disclosure invokes native collapse once');
                await page.getByRole('button',{name:'Expand card',exact:true}).click();
                expect(await page.locator('.cal-review-panel').count()===3,'Moved disclosure invokes native expand once');
              }
              if (t.label==='review-finish-ready') {
                const ready=await page.locator('.kcard-done-btn').evaluate(b=>({disabled:b.disabled,opacity:getComputedStyle(b).opacity,color:getComputedStyle(b).color,background:getComputedStyle(b).backgroundColor,nowrap:getComputedStyle(b).whiteSpace,fits:b.scrollWidth<=b.clientWidth}));
                expect(!ready.disabled && Number(ready.opacity)===1 && ready.color!==ready.background,'Finish reviewing is enabled and visually actionable after every decision');
                expect(ready.nowrap==='nowrap' && ready.fits,'Enabled Finish fits on one line');
              }
              if (t.label==='credentials' || t.label==='credentials-masked') {
                expect(await page.locator('.cc-secret code').textContent()===(t.label==='credentials'?'No password saved':'••••••'),'Credentials: absent and hidden values have clear, distinct labels');
                const tops=await page.locator('.cc-card-head .cc-actions button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
                expect(tops.length===2 && Math.max(...tops)-Math.min(...tops)<1,'Credentials: History and Add share one row');
                const toolbar=await page.locator('.cc-topbar .cc-actions button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
                expect(toolbar.length===3 && Math.max(...toolbar)-Math.min(...toolbar)<1,'Credentials: Refresh, Import and Add fit one row');
              }
              if (t.label==='hiring') {
                expect(await page.locator('.hp-detail:visible').count()===0,'Hiring hides unselected detail panel');
                for (const filter of ['.hp-filters','.hp-roles']) {
                  const tops=await page.locator(filter+' button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
                  expect(Math.max(...tops)-Math.min(...tops)<1,'Hiring filters stay in one horizontally scrollable row');
                  const scroll=await page.locator(filter).evaluate(n=>{const style=getComputedStyle(n);n.scrollLeft=40;const result={hidden:style.scrollbarWidth==='none',overflow:style.overflowX,overflows:n.scrollWidth>n.clientWidth,moved:n.scrollLeft>0};n.scrollLeft=0;return result;});
                  expect(scroll.hidden && scroll.overflow==='auto' && (!scroll.overflows || scroll.moved),'Hiring hides the scrollbar without disabling chip scrolling');
                }
              }
              if (t.label==='messages') {
                const badge=await page.locator('.kasper-replies-newfrom').evaluate(n=>{const range=document.createRange();range.selectNodeContents(n);return {text:n.textContent,nowrap:getComputedStyle(n).whiteSpace,lines:range.getClientRects().length};});
                expect(badge.text==='New' && badge.nowrap==='nowrap' && badge.lines===1,'Messages badge stays short and on one line');
                const text=await page.locator('.kasper-replies-title').evaluate(n=>({height:n.getBoundingClientRect().height,line:parseFloat(getComputedStyle(n).lineHeight),whiteSpace:getComputedStyle(n).whiteSpace}));
                expect(text.whiteSpace==='normal' && text.height>text.line && text.height<=text.line*2+1,'Messages title wraps to two lines');
                const toggle=page.getByRole('switch',{name:'Only new',exact:true});
                expect(await toggle.getAttribute('aria-checked')==='false','Only-new toggle starts off while all messages are shown');
                expect(await page.locator('.kasper-replies-thread').evaluate(n=>n.firstElementChild.matches('.pocket-admin-new-toggle') && Math.abs(n.firstElementChild.getBoundingClientRect().left-n.getBoundingClientRect().left)<1),'Only-new toggle sits at the top edge of the message list');
                expect(await page.locator('.kasper-replies-thread .cal-review-comment').count()===3,'All messages includes the older conversation');
                await toggle.click();
                expect(await toggle.getAttribute('aria-checked')==='true' && await page.locator('.kasper-replies-thread .cal-review-comment').count()===2,'Only-new toggle invokes the native filter and retains its unread conversation');
                await toggle.click();
                expect(await toggle.getAttribute('aria-checked')==='false' && await page.locator('.kasper-replies-thread .cal-review-comment').count()===3,'Turning off Only-new restores all messages');
              }
            }
            await capture(page,t.label,width,theme);
            if (!before && !desktop && ['review-open','messages'].includes(t.label)) {
              await page.setViewportSize({width:1280,height:844}); await page.waitForTimeout(100);
              if (t.label==='review-open') {
                expect(await page.locator('.kcard > .kcard-close-btn').count()===1 && await page.locator('.pocket-admin-close-label').count()===0,'Desktop restores the original queue-hide position and icon');
                expect(await page.locator('.kcard-close-btn').getAttribute('aria-label')==='Close card','Desktop restores the native close label');
              } else {
                expect(await page.locator('.kasper-replies-showall').textContent()==='Show only new' && await page.locator('.kasper-replies-showall').getAttribute('role')===null,'Desktop restores the original message-filter text and semantics');
                expect(await page.locator('.kasper-replies-thread .cal-review-comment').count()===3,'Desktop resize retains the selected message filter');
                expect(await page.locator('.kasper-replies-newfrom').textContent()==='New from Team' && await page.locator('.kasper-replies-newfrom').getAttribute('aria-label')===null,'Desktop restores the original unread-source badge');
              }
              await page.setViewportSize({width,height:844}); await page.waitForTimeout(100);
            }
            if (!before && !desktop && t.label === 'tabs') {
              await page.keyboard.press('Escape');
              expect(await page.locator('dialog.pocket-admin-tabs').count() === 0,'Tabs Escape closes dialog');
              expect(await page.evaluate(()=>document.activeElement?.textContent.trim()==='Tabs'),'Tabs Escape returns focus');
              expect(await page.locator('header #headerNav').count() === 1,'Tabs restores original navigation');
              expect(await page.locator('header #svClientBar').count()===1,'Tabs restores original client picker');
              await page.getByRole('button',{name:'Tabs',exact:true}).click();
              await page.getByRole('button',{name:'Overview',exact:true}).click();
              await page.waitForFunction(()=>currentNav==='home');
              expect(await page.locator('html.pocket-admin-phone').count()===0,'Overview invokes the native home action');
            }
            if (!before && !desktop && t.label === 'more') {
              await page.keyboard.press('Escape');
              expect(await page.locator('.kasper-more.open').count() === 0,'More Escape closes menu');
              await page.locator('[data-kasper-more-trigger]').click();
              await page.locator('.pocket-admin-more-backdrop').click({position:{x:5,y:5}});
              expect(await page.locator('.kasper-more.open').count() === 0,'More backdrop dismisses menu');
              expect(await page.evaluate(()=>_kasperState.tab==='review'),'More backdrop preserves current page');
            }
            if (!before && !desktop && t.label === 'account') {
              await page.keyboard.press('Escape');
              expect(await page.evaluate(()=>document.activeElement?.matches('[data-kasper-more-trigger]')),'Account Escape returns focus to More');
            }
            if (!before && !desktop && t.label === 'sales-draft') {
              await page.setViewportSize({width:1280,height:844}); await page.waitForTimeout(100);
              expect(await page.locator('.pocket-admin-heading').count()===0,'Desktop removes phone header');
              expect(await page.locator('html.pocket-admin-phone').count()===0,'Desktop removes phone marker');
              expect(await page.locator('.kasper-subtabs .kasper-more').count()===1,'Desktop restores native More location');
              expect(await page.locator('[data-si=client_name]').inputValue()==='Example customer','Resize preserves saved draft');
              await page.setViewportSize({width,height:844});await page.waitForTimeout(100);
            }
          } catch (e) { failures.push(t.label+' '+theme+' '+width+': '+e.message.slice(0,180)); }
        }
        if (!before) expect(errors.length===0,width+' '+theme+': browser errors '+JSON.stringify(errors));
      } finally { await ctx.close(); }
    }
  } finally { await browser.close();await new Promise(r => server.close(r)); }
  if (out) fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({checks,rows,failures},null,2));
  failures.forEach(x => console.error('FAIL '+x));
  console.log('KASPER_ADMIN_EXPANDED: '+rows.length+' native states; '+checks+' checks; '+failures.length+' failures; fictional data; no live writes.');
  if (failures.length) process.exitCode=1;
}
module.exports = {runMain};
if (require.main===module) runMain().catch(e => {console.error(e);process.exitCode=1;});
