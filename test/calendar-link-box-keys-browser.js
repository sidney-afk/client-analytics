'use strict';
/* calendar-link-box-keys-browser.js -- Escape and Enter in a Calendar card's
 * thumbnail link box, in a real browser, fully offline.
 *
 * Owner report 2026-09-26 ("Escape does not close a Calendar card's thumbnail
 * or video edit box"), still true on the live site on 2026-10-08. Drives the
 * real page against a synthetic client whose every backend answer is local:
 *   - the pencil opens the box; Escape closes it and the card keeps the link it
 *     had, even after typing over it;
 *   - Enter closes it and keeps what was typed;
 *   - Escape in the box does not throw the page out of anything else.
 * The pure key logic (Calendar and Samples) is in calendar-link-box-keys.js.
 * No request leaves the machine. Fixture names only.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const CLIENT = 'Link Box Fixture';
const SLUG = 'linkboxfixture';
const OLD = 'https://example.invalid/thumb-old.png';
const NEW = 'https://example.invalid/thumb-new.png';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const cards = () => [
  { id: 'lb1', client: SLUG, name: 'Card with a thumbnail link', status: 'In Progress', order_index: 1, updated_at: '2026-09-20T12:00:00.000Z',
    scheduled_date: '2026-10-03', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
    thumbnail_url: OLD, asset_url: '', video_deliverable_id: '', graphic_deliverable_id: '', comments: [], graphic_comments: [], caption_comments: [] },
];

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
    await seedStaffGate(page);
    await page.route('**/*', async route => {
      const r = route.request(); const u = new URL(r.url());
      if (r.url().startsWith(origin)) return route.continue();
      const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      const p = u.pathname; const sp = u.searchParams;
      if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
      if (r.method() === 'POST') return json({ ok: true });
      if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, active: true, kind: 'video' }]);
      if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }]);
      if (p === '/rest/v1/syncview_runtime_flags') {
        const raw = sp.get('key') || '';
        const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
        return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : (/_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false }) })));
      }
      if (p === '/rest/v1/calendar_posts') return json(cards());
      if (/\/rest\/v1\//.test(p)) return json([]);
      if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
      if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
      return route.abort();
    });

    await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _calSavePins === 'function', null, { timeout: 30000 });
    await page.evaluate(client => { _syncviewStaffIdentityVerified = true; _calSavePins([client]); navTo('calendar'); }, CLIENT);
    const field = '.cal-link-field[data-pid-wrap="lb1"][data-fld-wrap="thumbnail_url"]';
    await page.waitForSelector(field + ' .cal-link-edit', { timeout: 20000 });
    const stored = () => page.evaluate(() => (calState.posts.find(p => p.id === 'lb1') || {}).thumbnail_url);
    const editing = () => page.locator(field + '.editing').count();
    const focusInBox = () => page.evaluate(() => !!(document.activeElement && document.activeElement.classList.contains('cal-link-input')));

    // 1. open, Escape straight away
    await page.click(field + ' .cal-link-edit');
    expect(await editing() === 1 && await focusInBox(), 'the pencil opens the thumbnail link box and puts the cursor in it');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    expect(await editing() === 0 && !(await focusInBox()), 'Escape closes the box');
    expect(await stored() === OLD, 'and the card still has its link');

    // 2. open, type over the link, Escape
    await page.click(field + ' .cal-link-edit');
    await page.keyboard.type('https://example.invalid/half-typ');
    expect(await stored() !== OLD, 'typing in the box changes the card as you type (which is why Escape has to put it back)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    expect(await editing() === 0, 'Escape after typing closes the box');
    expect(await stored() === OLD, 'and the card is back on the link it had, not the half-typed one');
    expect(await page.locator(field + ' .cal-link-pill-open').count() === 1, 'the Thumbnail pill is back');

    // 3. open, type a new link, Enter
    await page.click(field + ' .cal-link-edit');
    await page.keyboard.type(NEW);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    expect(await editing() === 0, 'Enter closes the box');
    expect(await stored() === NEW, 'and keeps the new link');

    expect(pageErrors.length === 0, 'no page errors (' + pageErrors.join(' | ') + ')');
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' check(s) failed'); process.exit(1); }
  console.log('\ncalendar-link-box-keys-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
