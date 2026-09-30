'use strict';
// The TikTok Upload tab now opens with a TikTok / Instagram switch. Opens the real page offline and proves:
// TikTok is the default and is untouched; the switch hides one side and shows the other without losing the
// TikTok draft; the choice is remembered; a client with no Instagram account id cannot post; and a full
// Instagram post (mint, storage PUT, create) sends the right thing to the `instagram-upload` function and shows
// its status in the queue. Every backend answer is local: nothing reaches Post For Me or any real account.
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
const fs = require('fs');
const path = require('path');
// The test client's display name, read from the page's own roster (the only client a check may post for).
const TEST_CLIENT = (fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '070-core-client-names.js.part'), 'utf8').match(/'[^']+'/g) || [])
  .map(q => q.slice(1, -1)).find(n => n.toLowerCase().replace(/[^a-z]/g, '') === 'sidneylaruel');
assert.ok(TEST_CLIENT, 'the test client is on the roster');
let NO_ACCOUNT_CLIENT = '';                 // picked from the page's own roster below: any roster name other than the test client has no Instagram id in the fixture sheet
const ACCOUNT_ID = 'spc_fixtureInstagram01';
const csv = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const CLIENTS_CSV = ['client_name,postforme_account_id,postforme_instagram_account_id',
  `${csv(TEST_CLIENT)},${csv('spc_fixtureTikTok0001')},${csv(ACCOUNT_ID)}`,
  ].join('\r\n') + '\r\n';

// The shared SyncView select: open its button, click the option.
async function pickSv(page, id, value) {
  await page.click(`#${id}Btn`);
  await page.click(`#${id}Menu [data-sv-select-option][data-value=${JSON.stringify(value)}]`);
}
const future = new Date(Date.now() + 26 * 3600000).toISOString();
const SERVER_ROWS = [
  { id: 'ig_a', client: TEST_CLIENT, title: 'Waiting post', status: 'scheduled', timezone: 'UTC', scheduled_for: future, placement: 'reels', error: '', instagram_url: '' },
  { id: 'ig_b', client: TEST_CLIENT, title: 'Live post', status: 'posted', timezone: 'UTC', posted_at: new Date().toISOString(), placement: 'reels', error: '', instagram_url: 'https://www.instagram.com/reel/FIXTURE/' },
  { id: 'ig_c', client: TEST_CLIENT, title: 'Broken post', status: 'failed', timezone: 'UTC', created_at: new Date().toISOString(), placement: 'timeline', error: 'Instagram rejected the post', instagram_url: '' },
];

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  const calls = { attempts: [], failCreate: false, list: 0, mint: 0, create: [], cancel: [], put: [], tiktokList: 0, headers: null };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
      const req = route.request(); const url = req.url();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
      if (/\/gviz\/tq/.test(url)) {
        const sheet = new URL(url).searchParams.get('sheet') || '';
        return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? CLIENTS_CSV : 'col\r\n' });
      }
      if (/tiktok-uploads-list/.test(url)) { calls.tiktokList++; return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify([]) }); }
      if (/functions\/v1\/instagram-upload/.test(url)) {
        const body = JSON.parse(req.postData() || '{}');
        calls.headers = req.headers();
        const ok = (obj) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, ...obj }) });
        if (body.action === 'list') { calls.list++; return ok({ rows: SERVER_ROWS }); }
        if (body.action === 'mint') { calls.mint++; return ok({ upload_url: 'https://storage.fixture.test/put/abc', media_url: 'https://data.postforme.dev/fixture.mp4' }); }
        if (body.action === 'create') {
          calls.attempts.push(body.idempotencyKey);
          if (calls.failCreate) { calls.failCreate = false; return route.abort('failed'); }
          calls.create.push(body);
          return ok({ id: body.idempotencyKey, status: body.scheduledAtUTC ? 'scheduled' : 'processing', row: { id: body.idempotencyKey, client: body.clientName, title: body.title, status: body.scheduledAtUTC ? 'scheduled' : 'processing', scheduled_for: body.scheduledAtUTC || '', timezone: body.timezone, created_at: new Date().toISOString(), error: '', instagram_url: '' } });
        }
        if (body.action === 'cancel') { calls.cancel.push(body.id); return ok({ row: { ...SERVER_ROWS[0], status: 'cancelled' } }); }
        return route.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: '{"ok":false}' });
      }
      if (/functions\/v1\/write-diagnostics/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"ok":true}' });   // the failed-saves log, which an unconfirmed create is reported to
      if (/storage\.fixture\.test/.test(url)) { calls.put.push(req.method()); return route.fulfill({ status: 200, headers: cors, body: '' }); }
      if (req.method() !== 'GET') throw new Error('unexpected write: ' + req.method() + ' ' + url);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
    });
    await seedStaffIdentity(context, ADMIN);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#tiktok-upload`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tkPlatTiktok', { timeout: 20000 });

    // --- the switch, TikTok default
    assert.equal(await page.innerText('.tk-title'), 'TikTok Upload', 'the tab keeps its name'); checks++;
    assert.equal(await page.getAttribute('#tkPlatTiktok', 'aria-selected'), 'true', 'TikTok is the default side'); checks++;
    assert.equal(await page.isVisible('#tkFormCol'), true, 'the TikTok form shows'); checks++;
    assert.equal(await page.isHidden('#igFormCol'), true, 'the Instagram form is hidden'); checks++;
    assert.equal(calls.list, 0, 'Instagram is not asked anything until it is chosen'); checks++;

    // A TikTok draft must survive a round trip through the Instagram side.
    await page.waitForSelector('#tkTitle, #tkCaption, #tkFormCol textarea', { timeout: 10000 });
    await page.fill('#tkFormCol textarea', 'My TikTok caption');

    await page.click('#tkPlatInstagram');
    await page.waitForSelector('#igQueueCol .tk-queue-item', { timeout: 10000 });
    assert.equal(await page.getAttribute('#tkPlatInstagram', 'aria-selected'), 'true'); checks++;
    assert.equal(await page.isHidden('#tkFormCol'), true, 'the TikTok form hides'); checks++;
    assert.equal(await page.isVisible('#igFormCol'), true, 'the Instagram form shows'); checks++;
    assert.equal(await page.innerText('.tk-title'), 'TikTok Upload', 'still not renamed'); checks++;
    assert.equal(calls.list, 1, 'the Instagram queue is read once on opening'); checks++;
    assert.ok(calls.headers['x-syncview-key'], 'the staff key goes to the function'); checks++;

    // --- the queue shows each status
    const queue = page.locator('#igQueueCol');
    assert.match(await queue.innerText(), /Waiting post/); checks++;
    assert.match(await queue.innerText(), /Scheduled/, 'a waiting post reads Scheduled'); checks++;
    await page.click('[data-ig-tab="done"]');
    assert.match(await queue.innerText(), /Live post[\s\S]*Posted/, 'a live post reads Posted'); checks++;
    assert.equal(await queue.locator('a[href="https://www.instagram.com/reel/FIXTURE/"]').count(), 1, 'a posted row links to the reel'); checks++;
    await page.click('[data-ig-tab="failed"]');
    assert.match(await queue.innerText(), /Broken post[\s\S]*Failed[\s\S]*Instagram rejected the post/, 'a failed row shows why'); checks++;
    await page.click('[data-ig-tab="upcoming"]');

    // --- no Instagram id: no post
    NO_ACCOUNT_CLIENT = await page.$$eval('#igClientMenu [data-sv-select-option]', os => os.map(o => o.getAttribute('data-value')).find(v => v && !/^sidney/i.test(v)));
    assert.ok(NO_ACCOUNT_CLIENT, 'the roster has another client'); checks++;
    await pickSv(page, 'igClient', NO_ACCOUNT_CLIENT);
    assert.match(await page.innerText('#igFormCol'), /No Instagram account/, 'a client with no id is flagged'); checks++;
    assert.match(await page.innerText('#igFormCol'), /postforme_instagram_account_id/, 'the flag names the sheet column'); checks++;
    await page.setInputFiles('#igFile', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') });
    await page.fill('#igTitle', 'Should not post');
    assert.equal(await page.isDisabled('#igSubmit'), true, 'no id means the button stays off'); checks++;

    // --- the test client posts end to end
    await pickSv(page, 'igClient', TEST_CLIENT);
    assert.match(await page.innerText('#igFormCol'), new RegExp(ACCOUNT_ID), 'the test client shows its connected account'); checks++;
    await page.fill('#igTitle', 'Fixture caption');
    assert.equal(await page.inputValue('#igTitle'), 'Fixture caption', 'the caption and video stay when the client changes'); checks++;
    assert.equal(await page.isDisabled('#igSubmit'), false, 'video, caption and account make it ready'); checks++;
    calls.failCreate = true;
    await page.click('#igSubmit');
    await page.waitForFunction(() => /could not confirm/i.test(document.querySelector('#igFormCol')?.innerText || ''), null, { timeout: 10000 });
    assert.equal(await page.isDisabled('#igSubmit'), false, 'the button is available again after an unconfirmed attempt'); checks++;
    await page.click('#igSubmit');
    await page.waitForFunction(() => /Sent to Instagram/.test(document.querySelector('#igFormCol')?.innerText || ''), null, { timeout: 10000 });
    assert.equal(calls.attempts.length, 2, 'the unconfirmed attempt was retried'); checks++;
    assert.equal(calls.attempts[0], calls.attempts[1], 'the retry reuses the same key, so it cannot post twice'); checks++;
    assert.equal(calls.put.length >= 1 && calls.put.every(m => m === 'PUT'), true, 'the video went straight to storage'); checks++;
    assert.equal(calls.create.length, 1, 'one post was created'); checks++;
    const c = calls.create[0];
    assert.equal(c.clientName, TEST_CLIENT); checks++;
    assert.equal(c.socialAccountId, ACCOUNT_ID, 'the Instagram id is sent, not the TikTok one'); checks++;
    assert.equal(c.mediaUrl, 'https://data.postforme.dev/fixture.mp4'); checks++;
    assert.equal(c.title, 'Fixture caption'); checks++;
    assert.equal(c.options.placement, undefined, 'no placement is chosen on the form: every post is a Reel'); checks++;
    assert.equal(await page.locator('input[name="igPlacement"]').count(), 0, 'there is no Feed video choice'); checks++;
    assert.doesNotMatch(await page.innerText('#igFormCol'), /Feed video/, 'Feed video is not offered'); checks++;
    assert.equal(c.scheduledAtUTC, '', 'posting now sends no time'); checks++;
    assert.ok(/^[A-Za-z0-9_-]{1,80}$/.test(c.idempotencyKey), 'a retry-safe key is sent'); checks++;
    assert.match(await queue.innerText(), /Fixture caption[\s\S]*Posting/, 'the new post shows in the queue right away'); checks++;

    // --- no browser-native menus or date popups on the Instagram side
    assert.equal(await page.locator('#igFormCol select, #igFormCol input[type="datetime-local"]').count(), 0, 'the Instagram form uses the SyncView controls, not native ones'); checks++;
    assert.equal(await page.locator('#igFormCol [data-sv-select]').count() >= 1, true, 'the client picker is the shared select'); checks++;

    // --- scheduling: the same on/off switch as TikTok, then SyncView's own date and time controls
    await page.setInputFiles('#igFile', { name: 'clip2.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') });
    await page.fill('#igTitle', 'Scheduled caption');
    assert.equal(await page.isVisible('#igPostNow + .tk-toggle-track'), true, 'the Post immediately switch is visible'); checks++;
    assert.match(await page.innerText('#igFormCol'), /Posts as soon as you press Post now/, 'the note explains the switch'); checks++;
    assert.equal(await page.isHidden('#igScheduleFields'), true, 'no date fields while posting now'); checks++;
    await page.click('label.tk-toggle:has(#igPostNow)');
    await page.waitForSelector('#igScheduleFields:not([hidden])');
    assert.equal(await page.isVisible('#igDateBtn'), true, 'switching it off shows the date control'); checks++;
    await page.click('#igSubmit');
    await page.waitForSelector('#igFormCol .tk-error');
    assert.match(await page.innerText('#igFormCol .tk-error'), /Pick a schedule date and time/, 'pressing it without a date and time says what is missing'); checks++;
    assert.match(await page.innerText('#igSubmit'), /Schedule post/, 'the button now says Schedule post'); checks++;
    await page.click('#igDateBtn');
    await page.waitForSelector('#svDatePickerPopup [data-dp-day]');
    const pickedDay = await page.evaluate(() => {
      const t = new Date(); const today = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
      const days = [...document.querySelectorAll('#svDatePickerPopup [data-dp-day]')].filter(b => !b.disabled && b.getAttribute('data-dp-day') > today);
      const b = days[days.length - 1]; b.click(); return b.getAttribute('data-dp-day');
    });
    await pickSv(page, 'igHour', '3'); await pickSv(page, 'igMin', '30'); await pickSv(page, 'igAmPm', 'PM');
    await page.click('#igSubmit');
    await page.waitForFunction(() => /Scheduled\. It will appear/.test(document.querySelector('#igFormCol')?.innerText || ''), null, { timeout: 10000 });
    const sc = calls.create[calls.create.length - 1];
    assert.match(sc.scheduledAtUTC, /^\d{4}-\d{2}-\d{2}T(19|20):30:00\.000Z$/, '3:30 PM New York is sent as a UTC time'); checks++;
    assert.equal(new Date(sc.scheduledAtUTC).toISOString().slice(0, 10), pickedDay, 'on the chosen day'); checks++;
    assert.equal(sc.timezone, 'America/New_York', 'with its timezone'); checks++;
    assert.match(await queue.innerText(), /Scheduled caption[\s\S]*Scheduled/, 'the queue shows it as Scheduled'); checks++;

    // --- cancel a scheduled row: asks first, then sends
    await page.click('[data-ig-cancel="ig_a"]');
    assert.deepEqual(calls.cancel, [], 'nothing is cancelled before the person confirms'); checks++;
    await page.waitForSelector('#confirmOverlay.active #confirmYes', { timeout: 5000 });
    await page.click('#confirmYes');
    await page.waitForFunction(() => !document.querySelector('[data-ig-cancel="ig_a"]'), null, { timeout: 5000 });
    assert.deepEqual(calls.cancel, ['ig_a'], 'Cancel goes to the function'); checks++;

    // --- back to TikTok: the draft is still there, and the choice is remembered across a reload
    await page.click('#tkPlatTiktok');
    assert.equal(await page.isVisible('#tkFormCol'), true, 'TikTok comes back'); checks++;
    assert.equal(await page.inputValue('#tkFormCol textarea'), 'My TikTok caption', 'the TikTok draft was not lost'); checks++;
    assert.equal(await page.isHidden('#igFormCol'), true); checks++;
    await page.click('#tkPlatInstagram');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#igQueueCol .tk-queue-item', { timeout: 20000 });
    assert.equal(await page.isVisible('#igFormCol'), true, 'the last side is remembered'); checks++;
    assert.equal(await page.isHidden('#tkFormCol'), true); checks++;

    assert.deepEqual(errors, [], 'no page errors'); checks++;
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`instagram-platform-switch-browser: ${checks} checks passed ✅`);
})().catch(e => { console.error(e); process.exit(1); });
