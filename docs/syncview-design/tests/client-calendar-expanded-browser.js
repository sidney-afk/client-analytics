'use strict';
/* Real generated app, synthetic client, intercepted backend only.
 * --headed uses visible Chrome. --capture-before records the unchanged page
 * from --before-root without pretending it passed the new Expanded contract.
 * POCKET_PHONE_SHOTS is a local output folder. Optional POCKET_FONT_DIR can
 * supply the offline gallery fonts for representative, repeatable images.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const { serve, installFixture, BASE_ROW } = require('./client-phone-review-browser');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const phoneThumbnailComparison = require('./phone-thumbnail-comparison');
const { heightFor } = require('../../../qa/client-phone/profiles');
const arg = key => process.argv.find(x => x.startsWith('--' + key + '='))?.split('=').slice(1).join('=');
const widths = (arg('widths') || '360,390,430').split(',').map(Number);
const themes = (arg('themes') || 'light,dark').split(',');
assert(widths.every(w => Number.isInteger(w) && w > 0), 'Invalid widths');
assert(themes.every(t => ['light', 'dark'].includes(t)), 'Invalid themes');
let requestedTheme = 'light';
const captures = [];
const before = process.argv.includes('--capture-before');
const headed = process.argv.includes('--headed');
const shots = process.env.POCKET_PHONE_SHOTS;
const out = [];
let checks = 0;
if (process.argv.includes('--list')) {
  const names = ['review-queue','review','review-alt-caption','long-content','many','thumbnail','lightbox','caption','caption-draft','save-error','sending','tabs','organizer','month','week','month-post','week-post','month-empty-today','week-empty-today','date-picker','notes','sheet-cta','more','organize','suggest-post','loading','loading-review','loading-organizer','loading-month','error','empty',
    ...['loading','pending','retry-loading','empty','error','denied','ready','image-error'].map(state => 'comparison-' + state)];
  console.log(JSON.stringify(names.map(name => ({lane:'client-calendar-expanded',name,tab:'calendar'}))));
  process.exit(0);
}
function ok(value, message) { assert(value, message); checks++; }
async function measureLoading(page, view) {
  const m = await page.evaluate(() => {
    const loader = document.querySelector('.cal-skeleton-loader');
    const rect = loader.getBoundingClientRect();
    const heading = document.querySelector('.pocket-client-calendar h1').getBoundingClientRect();
    return { height: rect.height, top: rect.top, headingBottom: heading.bottom,
      coversHeading: [...loader.querySelectorAll('.sv-skeleton')].filter(n => n.checkVisibility()).some(n => {
        const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < heading.bottom;
      }),
      outside: [...loader.querySelectorAll('.sv-skeleton')].filter(n => n.checkVisibility()).filter(n => {
        const r = n.getBoundingClientRect();
        return r.top < rect.top - 1 || r.bottom > rect.bottom + 1 || r.left < rect.left - 1 || r.right > rect.right + 1;
      }).map(n => n.className),
      label: loader.querySelector('.pocket-cal-timeline-loading-label')?.textContent,
      emptyClaims: [...loader.querySelectorAll('*')].filter(n => n.checkVisibility()).map(n => getComputedStyle(n, '::after').content).filter(text => /nothing scheduled/i.test(text)) };
  });
  ok(m.top >= m.headingBottom, view + ': loading panel overlaps Calendar heading');
  ok(!m.coversHeading, view + ': skeleton paints over the Calendar heading');
  ok(m.emptyClaims.length === 0, view + ': loading incorrectly claims nothing is scheduled');
  if (['month', 'week'].includes(view)) {
    ok(m.outside.length === 0, view + ': timeline skeleton escapes its loading panel: ' + m.outside.slice(0, 3).join(', '));
    ok(m.height <= 250, view + ': timeline loading is oversized');
    ok(m.label === 'Loading your calendar', view + ': visible loading label missing');
  }
}

async function measure(page, label) {
  const m = await page.evaluate(() => {
    const visible = e => e.checkVisibility({ checkVisibilityCSS: true });
    const controls = [...document.querySelectorAll('button, summary, a[href], input:not([type=hidden]), textarea, select')]
      .filter(e => visible(e) && !e.closest('.header')).map(e => {
        const r = e.getBoundingClientRect();
        return { tag: e.tagName, what: e.getAttribute('aria-label') || e.className, w: r.width, h: r.height };
      });
    const fields = [...document.querySelectorAll('input:not([readonly]):not([type=hidden]), textarea:not([readonly]), select')]
      .filter(visible).map(e => parseFloat(getComputedStyle(e).fontSize));
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, controls, fields };
  });
  ok(m.scrollWidth <= m.width + 1, label + ': page overflows');
  for (const c of m.controls) ok(c.w >= 43.5 && c.h >= 43.5, label + ': target below 44px: ' + JSON.stringify(c));
  for (const size of m.fields) ok(size >= 16, label + ': editable text below 16px');
  out.push({ label, requestedTheme, effectiveTheme: await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'light'), width: m.width, scrollWidth: m.scrollWidth, controls: m.controls.length, fields: m.fields.length });
}
async function shot(page, label) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 4000 }).catch(() => {});
  const overlay = await page.locator('dialog[open], .cal-comments-overlay.open, .cal-preview-overlay.open, .cal-lightbox.open, .thumb-compare-overlay.open, .dp-popup').count();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const name = label + '-' + requestedTheme;
  const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, fullHeight: document.documentElement.scrollHeight }));
  await page.screenshot({ path: path.join(shots, name + '-viewport.png'), animations: 'disabled' });
  await require('../../../qa/client-phone/native-captures').capture(page,{ path: path.join(shots, name + '.png'), fullPage: !overlay && dimensions.fullHeight > dimensions.height, animations: 'disabled' });
  captures.push({ label, requestedTheme, effectiveTheme: await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'light'), ...dimensions, file: name + '.png', viewportFile: name + '-viewport.png' });
}
async function run(browser, origin, width) {
  const timezoneId = 'America/Guatemala';
  const ctx = await browser.newContext({ viewport: { width, height: heightFor(width, arg('height')) }, isMobile: width < 768, hasTouch: width < 768, reducedMotion: 'reduce', colorScheme: requestedTheme, locale: 'en-US', timezoneId });
  // The CI host can already be tomorrow while this browser is still today.
  // Use the browser's zone for the populated fixture; empty Today is exercised
  // separately below, so neither state depends on when CI happens to run.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezoneId, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const fixtureDate = [parts.year, parts.month, parts.day].join('-');
  const row = { ...BASE_ROW, id: 'p_phone_fixture_1', name: 'A little change. A better day.', scheduled_date: fixtureDate, cta: 'Save this for later.', thumbnail_url: 'https://drive.google.com/file/d/fixture_thumbnail_asset/view', video_deliverable_id: '00000000-0000-4000-a000-000000000001', graphic_deliverable_id: '00000000-0000-4000-a000-000000000002' };
  const finished = { ...row, id: 'p_phone_fixture_2', name: 'Make room for what matters.', thumbnail_url: origin + '/__fixture_unavailable.png', order_index: 2, status: 'Approved', video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' };
  const settings = { id: 'p_cal_settings', client: row.client, caption: JSON.stringify({ collab_mode: true }) };
  const writes = [];
  await installFixture(ctx, origin, row, writes, 'calendar');
  await ctx.addInitScript(theme => localStorage.setItem('syncview_theme', theme), requestedTheme);
  await ctx.route('**/__fixture_unavailable.png', route => route.abort());
  // This existing POST is a read, not a card mutation. Keep it separate from
  // the writer receipt while loading a synthetic Drive thumbnail.
  await ctx.route('**/functions/v1/thumbnail-revision-read', route => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
  await ctx.route('https://lh3.googleusercontent.com/d/fixture_thumbnail_asset*', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="#dedccf"/><circle cx="480" cy="500" r="260" fill="#aaa88d"/><text x="80" y="1030" font-size="60" fill="#32352c" font-family="sans-serif">A little change.</text></svg>' }));
  await ctx.route('**/rest/v1/calendar_posts?**', route => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([row, finished, settings]) }));
  if (process.env.POCKET_FONT_DIR) {
    const css = [400, 500, 600, 700, 800].map(weight => {
      const bytes = fs.readFileSync(path.join(process.env.POCKET_FONT_DIR, 'plus-jakarta-' + weight + '.ttf'));
      return `@font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:${weight};src:url(data:font/ttf;base64,${bytes.toString('base64')}) format('truetype');font-display:block}`;
    }).join('\n');
    await ctx.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: css }));
  }
  if (arg('before-root')) {
    const root = path.resolve(arg('before-root'));
    await ctx.route(origin + '/**', route => {
      const u = new URL(route.request().url());
      if (u.pathname.includes('__fixture')) return route.fallback();
      const file = path.join(root, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
      if (!file.startsWith(root + path.sep)) return route.abort();
      if (!fs.existsSync(file)) return /\.(html|js)$/.test(file) ? route.fulfill({ status: 404, body: 'Reference asset not found' }) : route.fallback();
      return route.fulfill({ status: 200, contentType: file.endsWith('.html') ? 'text/html' : 'text/javascript', body: fs.readFileSync(file) });
    });
  }
  const page = await ctx.newPage();
  require('../../../qa/client-phone/native-captures').prepareCaptures(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html?c=Phone%20Fixture%20Client&t=synthetic-phone-token&v=calendar', { waitUntil: 'domcontentloaded' });
  await page.locator('.cal-review-card').first().waitFor();
  await shot(page, 'review-queue-' + width);
  if (!before) await measure(page, 'review-queue-' + width);
  await page.locator('.kcard-expand-btn').first().click();
  await shot(page, 'review-' + width);
  const originalPosts=await page.evaluate(()=>calState.posts);
  await page.evaluate(posts=>{calState.posts=posts.map((row,i)=>i===0?{...row,caption_alt:'A fictional caption for another platform.',caption_alt_platform:'linkedin'}:row);_calRenderBody();},originalPosts);
  ok(await page.locator('.cal-review-cap-card').count()>=2,'Native dual-caption fixture must show both captions');
  await measure(page,'review-alt-caption-'+width);await shot(page,'review-alt-caption-'+width);
  await page.evaluate(posts=>{calState.posts=posts;_calRenderBody();},originalPosts);
  for(const kind of ['long-content','many']) {
    await page.evaluate(({kind,original})=>{
      const row={...original[0],name:'A longer fictional title about making a calmer start to the day with enough room for every important detail',caption:'A longer fictional caption needs to wrap comfortably and keep its review actions within reach. '.repeat(16)};
      calState.posts=kind==='many'?Array.from({length:12},(_,i)=>({...row,id:i?row.id+'-fixture-'+i:row.id,name:row.name+' '+(i+1)})):[row];
      _calRenderBody();
    },{kind,original:originalPosts});
    await measure(page,kind+'-'+width);await shot(page,kind+'-'+width);
  }
  await page.evaluate(posts=>{calState.posts=posts;_calRenderBody();},originalPosts);
  if (!before) {
    await measure(page, 'review-' + width);
    ok(await page.locator('.pocket-client-calendar h1').innerText() === 'Calendar', 'Calendar title missing');
    ok(await page.locator('html[data-theme=dark]').count() === 0, 'client links must remain light even with a saved dark preference');
    ok(!await page.locator('.header').isVisible(), 'separate phone header remains');
    ok(await page.locator('.pocket-cal-section').count() === 3, 'three component decisions must remain');
    ok(await page.locator('.cal-review-panel:visible').count() === 3, 'all component sections must be visible');
    const caption = page.locator('.pocket-cal-section:has([data-comp=caption])');
    const note = caption.locator('textarea');
    await note.fill('Please shorten the opening line.');
    ok(await caption.locator('.cal-review-approve-btn').isDisabled(), 'draft must disable approval');
    ok(!await caption.locator('.cal-review-tweak-btn').isDisabled(), 'draft must enable Request change');
    ok(await caption.isVisible(), 'caption must stay visible beside the other decisions');
    ok((await caption.locator('.pocket-cal-section-status').innerText()).includes('Note not sent'), 'draft must stay visibly unsent');
    await measure(page, 'caption-draft-' + width);
    await shot(page, 'caption-draft-' + width);
    const thumbnail = page.locator('.cal-review-preview-thumb-btn');
    await thumbnail.scrollIntoViewIfNeeded();
    ok(await thumbnail.locator('img').evaluate(img => img.decode().then(() => img.naturalWidth > 0, () => false)), 'thumbnail must display a decoded fixture image');
    await measure(page, 'thumbnail-' + width);
    await shot(page, 'thumbnail-' + width);
    await page.locator('.cal-review-preview-thumb-btn').click();
    await page.locator('#calLightbox.open').waitFor();
    await measure(page, 'lightbox-' + width);
    await shot(page, 'lightbox-' + width);
    await page.locator('.cal-lightbox-close').click();
    ok(await note.inputValue() === 'Please shorten the opening line.', 'moving between sections lost a draft');
    await note.fill('');
    ok(!await caption.locator('.cal-review-approve-btn').isDisabled(), 'clearing draft must restore approval');
    await measure(page, 'caption-' + width);
    await shot(page, 'caption-' + width);
    await page.evaluate(() => { _calReviewState.errors['p_phone_fixture_1|caption'] = 'Synthetic save refusal'; _calReviewRepaintCard('p_phone_fixture_1'); });
    ok((await caption.locator('.pocket-cal-section-status').innerText()).includes('Save failed'), 'failed save must remain explicit');
    await measure(page, 'save-error-' + width);
    await shot(page, 'save-error-' + width);
    await caption.locator('textarea').fill('A note retained after a failed save.');
    ok((await caption.locator('.pocket-cal-section-status').innerText()).includes('Save failed'), 'editing must not hide a failed save');
    await caption.locator('textarea').fill('');
    await page.evaluate(() => { delete _calReviewState.errors['p_phone_fixture_1|caption']; _calReviewState.saving['p_phone_fixture_1|caption'] = true; _calReviewRepaintCard('p_phone_fixture_1'); });
    ok((await caption.locator('.pocket-cal-section-status').innerText()).includes('Sending'), 'pending save must remain explicit');
    await measure(page, 'sending-' + width);
    await shot(page, 'sending-' + width);
    await page.evaluate(() => { _calReviewState.saving['p_phone_fixture_1|caption'] = false; _calReviewRepaintCard('p_phone_fixture_1'); });
    await page.locator('[aria-controls=pocketCalTabs]').click();
    await measure(page, 'tabs-' + width);
    await shot(page, 'tabs-' + width);
    await page.keyboard.press('Escape');
    ok(await page.locator('[aria-controls=pocketCalTabs]').evaluate(e => document.activeElement === e), 'Tabs must restore focus');
    await page.locator('[aria-controls=pocketCalTabs]').click();
    await page.locator('#pocketCalTabs .view-tab-btn').filter({ hasText: /^Analytics$/ }).click();
    // This fixture has no analytics rows. Its native no-data route has no
    // switcher; browser Back returns through the existing guarded renderer.
    ok(!new URL(page.url()).searchParams.has('v'), 'Analytics action must keep the native route');
    await page.goBack();
    await page.locator('.pocket-client-calendar').waitFor();
    ok(await page.locator('#pocketCalTabs .view-tab-btn').count() >= 2, 'native client navigation must survive a round trip');
  }
  for (const view of ['organizer', 'month', 'week']) {
    await page.locator('[data-cal-view=' + view + ']').click();
    await shot(page, view + '-' + width);
    if (!before) await measure(page, view + '-' + width);
    if (!before && view !== 'organizer') {
      // Runs of empty days fold into one labelled line; the folded days stay in the page for drag and drop.
      const dayRows = await page.evaluate(v => [...document.querySelectorAll(v === 'month' ? '.cal-month-cell[data-iso]' : '.cal-week-col[data-iso]')]
        .filter(e => !e.classList.contains('out') && e.checkVisibility({ checkVisibilityCSS: true }))
        .map(e => ({ label: (e.querySelector('.pocket-run-label') || {}).textContent || '', posts: e.querySelectorAll('.cal-month-pill, .cal-week-card').length, run: e.classList.contains('pocket-run-head'), rest: e.classList.contains('pocket-run-rest') })), view);
      // Today is one black circle, the same in Month and Week; the few thumbnails are fetched at once and have loaded.
      ok(await page.locator(view === 'month' ? '.cal-month-cell.today .cal-month-pill' : '.cal-week-col.today .cal-week-card').count() > 0, view + ': populated Today fixture must use the browser date');
      const todayMark = await page.evaluate(v => { const e = document.querySelector(v === 'month' ? '.cal-month-cell.today .cal-month-num' : '.cal-week-col.today .cal-week-num'); if (!e) return null; const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, fg: cs.color }; }, view);
      if (todayMark) ok(todayMark.w === 36 && todayMark.h === 36 && parseFloat(todayMark.radius) >= 18 && todayMark.bg !== todayMark.fg, view + ': Today marker must be the 36 px circle ' + JSON.stringify(todayMark));
      await page.waitForFunction(() => [...document.querySelectorAll('.cal-month-pill-thumb img, .cal-week-card-thumb img')].every(i => i.complete), null, { timeout: 4000 });
      ok(await page.evaluate(() => [...document.querySelectorAll('.cal-month-pill-thumb img, .cal-week-card-thumb img')].every(i => i.loading === 'eager')), view + ': thumbnails must be fetched at once on a phone');
      ok(!dayRows.some(r => r.rest), view + ': a folded day must not show');
      ok(dayRows.every(r => !r.run || /^[A-Z][a-z]{2} \d{1,2}( to [A-Z][a-z]{2} \d{1,2})? \u00b7 Nothing scheduled$/.test(r.label)), view + ': run line must name its days ' + JSON.stringify(dayRows.filter(r => r.run)));
      ok(await page.locator('.pocket-run-rest').count() === await page.evaluate(() => document.querySelectorAll('.pocket-run-rest[data-iso]').length), view + ': folded days keep their date for drag and drop');
      const cards = page.locator(view === 'month' ? '.cal-month-pill:visible' : '.cal-week-card:visible');
      if (view === 'week' && !await cards.count()) await page.locator('.cal-nav-btn').last().click();
      await cards.first().click();
      await measure(page, view + '-post-' + width);
      await shot(page, view + '-post-' + width);
      await page.locator('.cal-preview-foot button').first().click();
      // An empty Today uses the native compact day row. Check it explicitly;
      // the host's timezone must not decide whether this regression is tested.
      await page.evaluate(() => {
        window._phoneTodayPosts = calState.posts;
        const next = new Date(); next.setDate(next.getDate() + 1);
        const iso = [next.getFullYear(), String(next.getMonth()+1).padStart(2,'0'), String(next.getDate()).padStart(2,'0')].join('-');
        calState.posts = calState.posts.map(post=>post.scheduled_date ? {...post,scheduled_date:iso} : post);
        _calRenderBody();
      });
      const emptyToday = await page.evaluate(v => {
        const day = document.querySelector(v==='month' ? '.cal-month-cell.today' : '.cal-week-col.today');
        const marker = day?.querySelector(v==='month' ? '.cal-month-num' : '.cal-week-num');
        if (!marker) return null;
        const r=marker.getBoundingClientRect(); return {w:r.width,h:r.height,posts:day.querySelectorAll('.cal-month-pill,.cal-week-card').length};
      }, view);
      ok(emptyToday && emptyToday.posts===0 && emptyToday.w===36 && emptyToday.h===36, view+': empty Today keeps a circular marker '+JSON.stringify(emptyToday));
      await measure(page, view+'-empty-today-'+width);
      await shot(page, view+'-empty-today-'+width);
      await page.evaluate(() => {calState.posts=window._phoneTodayPosts;delete window._phoneTodayPosts;_calRenderBody();});
    }
    if (!before && view === 'organizer') {
      await page.locator('.cal-date-chip').first().click();
      await page.locator('.dp-popup').waitFor({ state: 'visible' });
      await measure(page, 'date-picker-' + width);
      await shot(page, 'date-picker-' + width);
      await page.keyboard.press('Escape');
      await page.locator('.cal-comments-btn').first().click();
      await page.locator('#calCommentsModal').waitFor({ state: 'visible' });
      const labels = page.locator('#calCommentsModal [data-cm-toggle=comp] .cal-cm-audience-cap, #calCommentsModal [data-cm-toggle=tweak] .cal-cm-audience-cap');
      ok((await labels.allTextContents()).includes('About') && (await labels.allTextContents()).includes('Type'), 'phone Calendar Notes labels must be complete');
      // Wait for the phone styles to settle before measuring; a loaded runner once read the size too early.
      const labelSel = '#calCommentsModal [data-cm-toggle=comp] .cal-cm-audience-cap, #calCommentsModal [data-cm-toggle=tweak] .cal-cm-audience-cap';
      // Query and measure in one step, in the page: the modal can re-render between a locator's
      // query and its evaluate, which left detached nodes with no computed size (seen on CI).
      const readLabelSizes = sel => [...document.querySelectorAll(sel)].map(n => { const cs = getComputedStyle(n); return n.textContent.trim() + (n.isConnected ? '' : '[detached]') + (cs.display === 'none' ? '[hidden]' : '') + ':' + cs.fontSize; });
      await page.waitForFunction(sel => { const n = [...document.querySelectorAll(sel)]; return n.length > 0 && n.every(x => x.isConnected && parseFloat(getComputedStyle(x).fontSize) >= 13); }, labelSel, { timeout: 5000 }).catch(() => {});
      const labelSizes = await page.evaluate(readLabelSizes, labelSel);
      ok(labelSizes.every(t => parseFloat(t.split(':').pop()) >= 13), 'Calendar Notes labels must be readable ' + JSON.stringify(labelSizes));
      const composer = page.locator('#calCommentComposer');
      await composer.fill('Fictional Calendar Notes draft.');
      await page.locator('#calCommentsModal [data-comp=caption]').tap();
      ok(await composer.inputValue() === 'Fictional Calendar Notes draft.', 'Calendar Notes component choice lost its draft');
      await page.locator('#calCommentsModal [data-tweak="1"]').tap();
      ok(await page.locator('#calCommentsModal [data-tweak="1"]').evaluate(n=>n.classList.contains('is-active')), 'Calendar Notes change-request choice did not activate');
      ok(await composer.inputValue() === 'Fictional Calendar Notes draft.', 'Calendar Notes type choice lost its draft');
      await page.locator('#calCommentsModal [data-comp=video]').tap();
      await page.locator('#calCommentsModal [data-tweak="0"]').tap();
      await composer.fill('');
      await measure(page, 'notes-' + width);
      await shot(page, 'notes-' + width);
      await page.locator('.cal-comments-close').click();
      const name = page.locator('.cal-fld-name').first();
      ok(await name.getAttribute('readonly') !== null, 'existing client names must stay locked');
      const cta = page.locator('.cal-card').first().locator('.pocket-cal-section:has(.cal-fld-cta)');
      ok(await cta.isVisible() && await page.locator('.cal-card').first().locator('.cal-capblock').isVisible(), 'Sheet Caption and Call to action must both be visible');
      await measure(page, 'sheet-cta-' + width);
      await cta.scrollIntoViewIfNeeded();
      await shot(page, 'sheet-cta-' + width);
      await page.locator('[aria-controls=pocketCalMore]').click();
      ok(await page.locator('#pocketCalMore #calOrganizeBtn').count() === 1, 'Organize must be inside More');
      ok(await page.locator('#pocketCalMore #calZoomIn').count() === 1, 'card size must be inside More');
      await measure(page, 'more-' + width);
      ok(await page.locator('#pocketCalMore').evaluate(e => e.offsetHeight < 300), 'closed Organize must not leave a blank row in More');
      await shot(page, 'more-' + width);
      await page.locator('#calOrganizeBtn').click();
      await page.locator('#calOrganizeMenu').waitFor({ state: 'visible' });
      await measure(page, 'organize-' + width);
      await shot(page, 'organize-' + width);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.locator('.cal-card-add').click();
      ok(await page.locator('.cal-fld-name:not([readonly])').count() === 1, 'native suggestion must keep an editable name');
      await measure(page, 'suggest-post-' + width);
      await shot(page, 'suggest-post-' + width);
    }
  }
  if (!before) {
    await phoneThumbnailComparison(page, ctx, { surface: 'calendar', id: row.id, measure, shot, suffix: width, prefix: '' });
    // Presentation crossing must return the existing desktop shell and tabs.
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.locator('.pocket-client-calendar').waitFor({ state: 'detached' });
    ok(await page.locator('.pocket-client-calendar').count() === 0, 'phone header leaked to desktop');
    ok(await page.locator('.cal-tab-view > .view-tab-toggle').count() === 1, 'native tabs not restored');
    await page.locator('[data-cal-view="week"]').click();
    const desktopWeek = await page.locator('.cal-week-grid').getAttribute('style');
    await page.setViewportSize({ width: 1, height: 1 });
    await page.waitForTimeout(200);
    const tinyViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, visibleWidth: visualViewport.width, visibleHeight: visualViewport.height }));
    ok(await page.locator('.pocket-client-calendar').count() === 0, 'measurement viewport rebuilt the phone shell: ' + JSON.stringify(tinyViewport));
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(200);
    ok(await page.locator('.cal-week-grid').getAttribute('style') === desktopWeek, 'measurement viewport shifted desktop Week');
    await page.setViewportSize({ width, height: heightFor(width, arg('height')) });
    await page.locator('.pocket-client-calendar').waitFor();
    ok(await page.locator('.pocket-client-calendar').count() === 1, 'phone header not restored');
    // Held loading and failure paints remain recognisable, then recovery.
    for (const view of ['review', 'organizer', 'month', 'week']) {
      await page.evaluate(() => { calState.loading = true; });
      await page.locator('[data-cal-view="' + view + '"]').click();
      await page.evaluate(() => { _calRenderBody(); window.scrollTo(0, 0); });
      ok(await page.locator('.cal-skeleton-loader').count() > 0, 'loading skeleton removed');
      await measureLoading(page, view);
      await shot(page, (view === 'week' ? 'loading' : 'loading-' + view) + '-' + width);
    }
    await page.evaluate(() => { calState.loading = false; calState.error = 'Synthetic read failure'; _calRenderBody(); });
    ok(await page.locator('.cal-error').count() === 1, 'failure became an empty state');
    await measure(page, 'error-' + width);
    await shot(page, 'error-' + width);
    await page.evaluate(() => { calState.error = null; calState.posts = []; _calRenderBody(); });
    await measure(page, 'empty-' + width);
    await shot(page, 'empty-' + width);
    ok(writes.length === 0, 'section navigation sent a write');
    ok(errors.length === 0, 'browser errors: ' + errors.join(' | '));
  }
  await ctx.close();
}
(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: !headed, ...(headed ? { channel: 'chrome' } : {}) });
  try { for (const theme of themes) { requestedTheme = theme; for (const width of widths) await run(browser, origin, width); } }
  finally { await browser.close(); server.close(); }
  if (shots) fs.writeFileSync(path.join(shots, 'measurements.json'), JSON.stringify({ checks, before, cases: out }, null, 2));
  if (shots) fs.writeFileSync(path.join(shots, 'captures.json'), JSON.stringify(captures, null, 2));
  console.log(before ? 'client-calendar-expanded: BEFORE screenshots recorded; no Expanded pass claimed.' : `client-calendar-expanded: OK (${checks} assertions; Review, Sheet, Month, Week, menus, drafts, loading, failure, empty, breakpoint; ${widths.join('/')}; requested ${themes.join('/')}, effective client light).`);
})().catch(e => { console.error(e); process.exitCode = 1; });
