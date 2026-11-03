'use strict';
// "Open Post for Me" beside every "no account" message on the Post tab (plan row N1, decision D7, OPEN_REPAIRS 646).
// Opens the real page offline and proves:
//   1. for a client with no Post for Me account on any network, each "no account" message carries a link to
//      https://www.postforme.dev that opens in a new tab with rel="noopener": TikTok's account line and its
//      refusal on submit, Instagram's account line and its refusal on submit, and the Facebook box's reason;
//   2. for a client with every account on file, no such link appears anywhere on the Post tab;
//   3. the message wording is unchanged (it changes only with the linking pick list, plan row L1);
//   4. on a phone, where the account line is reworded shorter, the link stays beside it on both sides.
// Every backend answer is local and nothing is ever posted: the page is never let past its own refusal.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
// The test client's display name, read from the page's own roster (the only client this check uses).
const TEST_CLIENT = (fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '070-core-client-names.js.part'), 'utf8').match(/'[^']+'/g) || [])
  .map(q => q.slice(1, -1)).find(n => n.toLowerCase().replace(/[^a-z]/g, '') === 'sidneylaruel');
assert.ok(TEST_CLIENT, 'the test client is on the roster');
const csv = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const HEAD = 'client_name,postforme_account_id,postforme_instagram_account_id,postforme_facebook_account_id';
const clientsCsv = (withAccounts) => [HEAD, withAccounts
  ? `${csv(TEST_CLIENT)},${csv('spc_fixtureTikTok0001')},${csv('spc_fixtureInstagram01')},${csv('spc_fixtureFacebook01')}`
  : `${csv(TEST_CLIENT)},,,`].join('\r\n') + '\r\n';
const PFM = 'https://www.postforme.dev';
const textOf = (page, sel) => page.$eval(sel, el => el.textContent.replace(/\s+/g, ' ').trim());

async function newPage(browser, withAccounts, opts) {
  const context = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 1000 } }, opts || {}));
  const writes = [];
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
    if (/\/gviz\/tq/.test(url)) {
      const sheet = new URL(url).searchParams.get('sheet') || '';
      return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? clientsCsv(withAccounts) : 'col\r\n' });
    }
    if (/functions\/v1\/(instagram-upload|tiktok-upload)\b/.test(url)) {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action && !/^(list|status)$/.test(body.action)) writes.push(body.action);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, rows: [] }) });
    }
    if (/write-diagnostics/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"ok":true}' });
    if (/n8n\.cloud\/webhook\/tiktok-upload(?!s-list|-status)/.test(url) || /tiktok-upload-cancel/.test(url)) writes.push(url);
    if (req.method() !== 'GET' && !/tiktok-uploads-list|tiktok-upload-status|runtime|rpc\//.test(url)) writes.push(req.method() + ' ' + url);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : (/tiktok-uploads-list/.test(url) ? '[]' : '{}') });
  });
  await seedStaffIdentity(context, ADMIN);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { context, page, writes, errors };
}

async function pickSv(page, id, value) {
  await page.click(`#${id}Btn`);
  await page.click(`#${id}Menu [data-sv-select-option][data-value=${JSON.stringify(value)}]`);
}
// Every Post for Me link inside `scope`: its address, target, rel and text.
const linksIn = (page, scope) => page.$$eval(`${scope} a[href^="${PFM}"]`, as => as.map(a => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') || '', text: a.textContent.trim() })));
function assertOneLink(found, where) {
  assert.equal(found.length, 1, `${where}: one Open Post for Me link`);
  const [a] = found;
  assert.equal(a.href, PFM, `${where}: it goes to Post for Me`);
  assert.equal(a.target, '_blank', `${where}: it opens in a new tab`);
  assert.ok(a.rel.split(/\s+/).includes('noopener'), `${where}: rel has noopener`);
  assert.equal(a.text, 'Open Post for Me', `${where}: it says Open Post for Me`);
}

(async () => {
  const server = await serveStatic();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let checks = 0;
  try {
    // ---- 1. no account on any network: every message carries the link
    {
      const { context, page, writes, errors } = await newPage(browser, false);
      await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });

      // TikTok: the account line under the client picker.
      await page.fill('#tkClientInput', TEST_CLIENT);
      await page.press('#tkClientInput', 'Enter');
      await page.waitForSelector('#tkFormCol .tk-profile-line .tk-warn-chip');
      assertOneLink(await linksIn(page, '#tkFormCol .tk-profile-line'), 'TikTok account line'); checks++;
      assert.match(await textOf(page, '#tkFormCol .tk-profile-line'), /Ask an admin to add this client's Post For Me Connection ID/, 'TikTok wording unchanged'); checks++;
      // TikTok: the refusal a submit gives (the button is off, so the press is made the way a draft restore reaches it).
      await page.evaluate(() => _tkSubmit());
      await page.waitForSelector('#tkFormCol .tk-error');
      assertOneLink(await linksIn(page, '#tkFormCol .tk-error'), 'TikTok refusal'); checks++;
      assert.match(await textOf(page, '#tkFormCol .tk-error'), /This client has no Post For Me account yet/, 'TikTok refusal wording unchanged'); checks++;

      // Instagram: the account line, the Facebook reason, the refusal.
      await page.click('#tkPlatInstagram');
      await page.waitForSelector('#igFormCol:not([hidden])');
      if (!(await page.locator('#igFormCol .tk-profile-line').count())) await pickSv(page, 'igClient', TEST_CLIENT);
      await page.waitForSelector('#igFormCol .tk-profile-line .tk-warn-chip');
      assertOneLink(await linksIn(page, '#igFormCol .tk-profile-line'), 'Instagram account line'); checks++;
      assert.match(await textOf(page, '#igFormCol .tk-profile-line'), /No Instagram account on file for this client yet/, 'Instagram wording unchanged'); checks++;
      assertOneLink(await linksIn(page, '#igFacebookNote'), 'Facebook reason'); checks++;
      assert.match(await textOf(page, '#igFacebookNote'), /No Facebook Page connected for this client/, 'Facebook wording unchanged'); checks++;
      await page.evaluate(() => _igSubmit());
      await page.waitForSelector('#igFormCol .tk-error');
      assertOneLink(await linksIn(page, '#igFormCol .tk-error'), 'Instagram refusal'); checks++;

      // The link is a plain link: clicking it opens a new tab and leaves the form as it was.
      const [popup] = await Promise.all([context.waitForEvent('page'), page.click('#igFormCol .tk-profile-line a[href^="https://www.postforme.dev"]')]);
      assert.equal(await popup.evaluate(() => window.opener), null, 'the new tab has no handle on SyncView'); checks++;
      await popup.close();
      assert.equal(await page.evaluate(() => igState.client), TEST_CLIENT, 'the form keeps its client'); checks++;

      assert.deepEqual(writes, [], 'nothing was ever posted'); checks++;
      assert.deepEqual(errors, [], 'no page errors'); checks++;
      await context.close();
    }

    // ---- 2. every account on file: no link anywhere
    {
      const { context, page, writes, errors } = await newPage(browser, true);
      await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
      await page.fill('#tkClientInput', TEST_CLIENT);
      await page.press('#tkClientInput', 'Enter');
      await page.waitForSelector('[data-tk-picked-client]');
      assert.deepEqual(await linksIn(page, '.tk-page'), [], 'TikTok with an account: no link'); checks++;
      await page.click('#tkPlatInstagram');
      await page.waitForSelector('#igFormCol:not([hidden])');
      if (!(await page.locator('#igFormCol .tk-profile-line').count())) await pickSv(page, 'igClient', TEST_CLIENT);
      await page.waitForSelector('#igFacebook');
      assert.deepEqual(await linksIn(page, '.tk-page'), [], 'Instagram and Facebook with accounts: no link'); checks++;
      assert.deepEqual(writes, [], 'nothing was ever posted'); checks++;
      assert.deepEqual(errors, [], 'no page errors'); checks++;
      await context.close();
    }
    // ---- 3. a phone: the shorter phone wording keeps the link
    {
      const { context, page, writes, errors } = await newPage(browser, false, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
      await page.fill('#tkClientInput', TEST_CLIENT);
      await page.press('#tkClientInput', 'Enter');
      await page.waitForSelector('#tkFormCol .tk-profile-line .tk-warn-chip');
      await page.waitForFunction(() => document.documentElement.classList.contains('fph-on') && /connect this client in Clients/.test(document.querySelector('#tkFormCol .tk-profile-line')?.textContent || ''), null, { timeout: 5000 });
      assertOneLink(await linksIn(page, '#tkFormCol .tk-profile-line'), 'phone, TikTok account line'); checks++;
      await page.click('#tkPlatInstagram');
      await page.waitForSelector('#igFormCol:not([hidden])');
      if (!(await page.locator('#igFormCol .tk-profile-line').count())) await pickSv(page, 'igClient', TEST_CLIENT);
      await page.waitForFunction(() => /connect this client in Clients/.test(document.querySelector('#igFormCol .tk-profile-line')?.textContent || ''), null, { timeout: 5000 });
      assertOneLink(await linksIn(page, '#igFormCol .tk-profile-line'), 'phone, Instagram account line'); checks++;
      assert.match(await textOf(page, '#igFormCol .tk-profile-line'), /before uploading\. Open Post for Me$/, 'phone: the link reads after the sentence'); checks++;
      assert.deepEqual(writes, [], 'nothing was ever posted'); checks++;
      assert.deepEqual(errors, [], 'no page errors'); checks++;
      await context.close();
    }
    console.log(`postforme-link-browser: ${checks} checks passed`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
