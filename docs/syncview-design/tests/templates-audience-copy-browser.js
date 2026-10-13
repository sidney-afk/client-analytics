'use strict';
/* templates-audience-copy-browser.js -- the Templates client view shows the
 * brain's Audience section after the editor brief, and its "Copy" button puts
 * the whole brief on the clipboard as plain text with a "Copied" note (or a
 * plain message when the browser blocks the clipboard).
 *
 * Fully offline: the page is served locally, every outside request answers
 * empty, and the brain answer is made up (no real client).
 * SHOT_DIR=<dir> also saves light/dark x desktop/390 screenshots.
 */
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic, formatFailures } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');
const { CORS } = require('./client-link-fixture');

const NAME = 'Sample Client Audience';
const F = (id, heading, body) => ({ file: 'editing', id: 'client.sample.editing.' + id, heading, status: 'written', owner: 'team', source: 'inputs/calls/sample-call.md', updated: '2026-10-12', spec: '', body });
const BRAIN = {
  ok: true, found: true, folder: 'sample-client',
  facts: [F('look', 'Look', 'Warm, bright kitchen shots.'), F('cuts', 'Cuts', 'Quick cuts, no dead air.')],
  brief: [
    { heading: 'Look and feel', bullets: [
      { text: '**Subtitles:** white Serif, highlight #ffcc00', facts: ['client.sample.editing.look'] },
      { text: 'Warm, bright kitchen shots.', facts: ['client.sample.editing.look'] }] },
    { heading: 'Editing', bullets: Array.from({ length: 6 }, (_, i) => ({ text: `Cut rule ${i + 1}: keep it moving.`, facts: ['client.sample.editing.cuts'] })) },
    { heading: 'Avoid', bullets: [{ text: 'Stock music with lyrics.', facts: [] }] },
  ],
  audience: [
    { file: 'audience', id: 'client.sample.audience.who', heading: 'Who is watching', status: 'written', owner: 'team', source: 'inputs/calls/sample-call.md; clients/sample-client/identity.md', updated: '2026-10-12',
      body: 'Busy parents who cook after work.\n\n- **Short on time.** Most say so on calls.', sure: 'medium. The client\'s own words on two calls.' },
    { file: 'audience', id: 'client.sample.audience.problems', heading: 'What they struggle with', status: 'written', owner: 'team', source: 'inputs/calls/sample-call.md', updated: '2026-10-12',
      body: 'Getting dinner on the table in 20 minutes.', sure: 'low. One call.' },
  ],
};

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const shotDir = process.env.SHOT_DIR ? path.resolve(process.env.SHOT_DIR) : '';
  try {
    for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['390', { width: 390, height: 844 }]]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport, colorScheme: theme });
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        await context.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), r => {
          if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS, body: '' });
          const body = /\/functions\/v1\/brain/.test(r.request().url()) && /"read"/.test(r.request().postData() || '') ? JSON.stringify(BRAIN) : '[]';
          return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body }).catch(() => {});
        });
        await seedStaffGate(context);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.navTo === 'function', null, { timeout: 20000 });
        await page.waitForTimeout(1500);
        await page.evaluate(t => { document.documentElement.setAttribute('data-theme', t); navTo('templates'); }, theme);
        await page.waitForFunction(() => !!svAreaApi('templates'), null, { timeout: 15000 });
        await page.evaluate(n => openClientTemplate(n), NAME);
        await page.waitForSelector('.tpl-aud-card', { timeout: 15000 });
        const tag = `${label}/${theme}`;
        const cards = await page.$$eval('.tpl-aud-card', els => els.map(e => ({ h: e.querySelector('.tpl-aud-h').textContent, sure: (e.querySelector('.tpl-aud-sure') || {}).textContent || '', acts: [...e.querySelectorAll('.tpl-brief-act')].map(b => b.textContent.trim()) })));
        if (cards.length !== 2) failures.push(`${tag}: expected 2 audience cards, got ${cards.length}`);
        if (!cards.every(c => /How sure we are:/.test(c.sure))) failures.push(`${tag}: a card is missing its How sure we are line`);
        if (!cards.every(c => c.acts.includes('Where does this come from') && c.acts.includes('Send a change'))) failures.push(`${tag}: source/change buttons missing`);
        const order = await page.evaluate(() => { const b = document.querySelector('.tpl-brief'); const a = document.querySelector('.tpl-aud'); return !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING); });
        if (!order) failures.push(`${tag}: Audience is not after the brief`);
        // Where does this come from, then Send a change on the first audience fact.
        await page.click('.tpl-aud-card .tpl-brief-act >> text=Where does this come from');
        if (!(await page.$('.tpl-aud-src li'))) failures.push(`${tag}: sources did not open`);
        await page.click('.tpl-aud-card .tpl-brief-act >> text=Send a change');
        const formKey = await page.$eval('.tpl-aud-card .tpl-brain-form', f => f.dataset.brainKey).catch(() => '');
        if (formKey !== NAME + '::client.sample.audience.who') failures.push(`${tag}: change form not opened on the audience fact (${formKey})`);
        await page.click('.tpl-brain-cancel').catch(() => page.evaluate(() => { _tplBrainOpenForm = ''; _maybeRerenderTemplates(); }));
        // Copy.
        if (label === '390') { const h = await page.$eval('.tpl-copy-btn', el => el.getBoundingClientRect().height); if (h < 44) failures.push(`${tag}: Copy button is ${h}px tall, under the 44px tap target`); }
        await page.click('.tpl-copy-btn');
        await page.waitForFunction(() => (document.querySelector('.tpl-copy-note') || {}).textContent === 'Copied', null, { timeout: 5000 }).catch(() => failures.push(`${tag}: no Copied note`));
        if (!(await page.$('.tpl-aud-list li'))) failures.push(`${tag}: audience bullets not shown as a list`);
        const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
        if (!/## Look and feel/.test(clip) || !/# Audience/.test(clip) || /<!--|client\.sample|\*\*/.test(clip) || (clip.match(/^- Cut rule/gm) || []).length !== 6) failures.push(`${tag}: clipboard text wrong`);
        if (shotDir) {
          await page.evaluate(() => { const el = document.querySelector('.tpl-brief-titlerow'); el.scrollIntoView(); window.scrollBy(0, -80); });
          await page.screenshot({ path: path.join(shotDir, `audience-copy-${label}-${theme}.png`) });
          await page.evaluate(() => document.querySelector('.tpl-aud').scrollIntoView());
          await page.screenshot({ path: path.join(shotDir, `audience-${label}-${theme}.png`) });
        }
        // A blocked clipboard is said plainly.
        await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) }, configurable: true }); });
        await page.click('.tpl-copy-btn');
        await page.waitForFunction(() => /blocked copying/.test((document.querySelector('.tpl-copy-note') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => failures.push(`${tag}: blocked copy not reported`));
        if (errors.length) failures.push(`${tag}: page errors: ` + errors.join(' | '));
        console.log(`templates-audience-copy: ${tag} checked`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(formatFailures('templates-audience-copy failures', failures));
    process.exit(1);
  }
  console.log('templates-audience-copy: PASS');
})().catch(err => { console.error(err); process.exit(1); });
