'use strict';
/* templates-social-links-browser.js -- the Templates client page shows the
 * client's own Instagram / TikTok / YouTube as one-click links next to the
 * name, built exactly like the Calendar's profile links (160
 * _calSocialLinksFor), and leaves out any platform with no handle on file.
 *
 * Fully offline: the page is served locally, every outside request answers
 * empty, and the client info is made up (no real client or handle).
 *   - every handle on file: three links, the Calendar's addresses (leading @
 *     stripped), each opening in a new tab;
 *   - only some handles: only those links;
 *   - none: the strip is empty and takes no space;
 *   - client info that arrives after the page drew fills the strip in place.
 */
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic, formatFailures } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');
const { CORS } = require('./client-link-fixture');

const CLIENTS = {
  'Sample Client All': { instagram_handle: '@sample.gram', tiktok_handle: 'sampletok', youtube_channel_id: 'UCsample0000000000000000' },
  'Sample Client Gram': { instagram_handle: 'only.gram', tiktok_handle: '', youtube_channel_id: '  ' },
  'Sample Client None': {},
};
const EXPECT = {
  'Sample Client All': [
    ['instagram', 'https://instagram.com/sample.gram'],
    ['tiktok', 'https://tiktok.com/@sampletok'],
    ['youtube', 'https://youtube.com/channel/UCsample0000000000000000'],
  ],
  'Sample Client Gram': [['instagram', 'https://instagram.com/only.gram']],
  'Sample Client None': [],
};

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    const context = await browser.newContext();
    await context.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), r => (r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: CORS, body: '' })
      : r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' }).catch(() => {})));
    await seedStaffGate(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.navTo === 'function', null, { timeout: 20000 });
    await page.waitForTimeout(1500);   // let start-up's own client-info pass settle first

    const open = async name => {
      await page.evaluate(({ name, info }) => {
        for (const k of Object.keys(clientMap)) delete clientMap[k];
        Object.assign(clientMap, info);
        navTo('templates');
      }, { name, info: CLIENTS });
      await svAreaReady();
      await page.evaluate(n => openClientTemplate(n), name);
      await page.waitForSelector('.tpl-client-head [data-tpl-social]', { state: 'attached', timeout: 15000 });
    };
    const svAreaReady = () => page.waitForFunction(() => !!svAreaApi('templates'), null, { timeout: 15000 });
    const links = () => page.$$eval('.tpl-client-head [data-tpl-social] a', as => as.map(a => ({
      platform: a.dataset.platform, href: a.getAttribute('href'), target: a.target, rel: a.rel,
      visible: !!(a.offsetWidth || a.offsetHeight), hasIcon: !!a.querySelector('.cal-client-link-ico svg'),
    })));

    for (const [name, want] of Object.entries(EXPECT)) {
      await open(name);
      const got = await links();
      const gotPairs = got.map(l => [l.platform, l.href]);
      if (JSON.stringify(gotPairs) !== JSON.stringify(want)) failures.push(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(gotPairs)}`);
      for (const l of got) {
        if (l.target !== '_blank') failures.push(`${name}: ${l.platform} does not open in a new tab`);
        if (!/noopener/.test(l.rel)) failures.push(`${name}: ${l.platform} link lacks rel=noopener`);
        if (!l.visible) failures.push(`${name}: ${l.platform} link is not visible`);
        if (!l.hasIcon) failures.push(`${name}: ${l.platform} link has no platform icon`);
      }
      // Same addresses as the Calendar builds for this client.
      const calendar = await page.evaluate(n => _calSocialLinksFor(n).map(l => [l.key, l.url]), name);
      if (JSON.stringify(calendar) !== JSON.stringify(gotPairs)) failures.push(`${name}: Templates links differ from the Calendar's ${JSON.stringify(calendar)}`);
      if (!want.length) {
        const box = await page.$eval('.tpl-client-head [data-tpl-social]', el => ({ w: el.offsetWidth, h: el.offsetHeight }));
        if (box.w || box.h) failures.push(`${name}: the empty strip still takes space (${box.w}x${box.h})`);
      }
      console.log(`templates-social-links: ${name}: ${got.map(l => l.platform).join(', ') || 'none'}`);
    }

    // Client info arriving after the page drew: the strip fills in place.
    await page.evaluate(() => { clientMap['Sample Client None'] = { tiktok_handle: '@latetok' }; svAreaApi('templates').refreshSocialLinks(); });
    const late = (await links()).map(l => [l.platform, l.href]);
    if (JSON.stringify(late) !== JSON.stringify([['tiktok', 'https://tiktok.com/@latetok']])) failures.push(`late client info: expected the TikTok link, got ${JSON.stringify(late)}`);
    else console.log('templates-social-links: late client info fills the strip');

    // The refresh is wired to the moment client info lands (040).
    const wired = await page.evaluate(() => /svAreaApi\(['"]templates['"]\)[\s\S]{0,40}refreshSocialLinks\(\)/.test(String(_applyEssentialRows)));
    if (!wired) failures.push('client-info refresh (_applyEssentialRows) does not repaint the Templates links');

    if (process.env.SHOT) await page.screenshot({ path: path.resolve(process.env.SHOT) });
    if (errors.length) failures.push('page errors: ' + errors.join(' | '));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(formatFailures('templates-social-links failures', failures));
    process.exit(1);
  }
  console.log('templates-social-links: PASS');
})().catch(err => { console.error(err); process.exit(1); });
