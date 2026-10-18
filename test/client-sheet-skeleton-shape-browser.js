'use strict';
/*
 * Client link Sheet: the loading skeleton has the shape of the client Sheet that loads (session Tether, 2026-10-18).
 *
 * Before: on a client link (?c=...&t=...) the Sheet drew the STAFF Sheet's placeholder (a date row, two link rows, a
 * caption chip, Set all and three status bars, all in staff widths; on the phone a "Loading your calendar..." line and a
 * narrower card), so the page jumped when the client Sheet arrived. After: the placeholder is the client card at the
 * loaded card's boxes: thumbnail, title, date, ONE link row, caption, call to action, Notes, and the status chips; on
 * the phone a single full-width column with the Caption and Call to action headings.
 *
 * Fully offline (the review-stage fixture, switches off so the old client page is the one that loads), fictional client.
 * The cards' read is held back so the skeleton can be measured, then released and the loaded cards are measured.
 * 1440 and 390, tolerance 2px. SKELETON_SHAPE_SHOT_DIR saves skeleton and loaded screenshots.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { openClient, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.SKELETON_SHAPE_SHOT_DIR || '';
const TOL = 2;
const failures = [];
let checks = 0;
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else { checks++; } }
const same = (a, b) => a && b && ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) <= TOL);
const show = b => b ? `${b.x},${b.y} ${b.w}x${b.h}` : 'missing';
function compare(label, skel, real) {
  expect(skel.length === real.length, `${label}: ${skel.length} skeleton boxes for ${real.length} loaded boxes`);
  real.forEach((b, i) => expect(same(skel[i], b), `${label} #${i + 1}: skeleton ${show(skel[i])}, loaded ${show(b)}`));
}

function measure(which) {
  const box = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const vis = e => e && e.getClientRects().length && e.getBoundingClientRect().width > 0;
  const inView = e => e.getBoundingClientRect().left < innerWidth && e.getBoundingClientRect().top < innerHeight;
  if (which === 'skeleton') {
    const root = [...document.querySelectorAll('#calView .cal-sheet-skeleton')].find(vis);
    if (!root) return { missing: true };
    const cards = [...root.querySelectorAll('.cal-sk-card')].filter(vis).filter(inView);
    const c = cards[0];
    return {
      client: root.classList.contains('is-client'),
      label: getComputedStyle(root, '::before').content,
      cards: cards.map(box),
      thumb: c ? [box(c.querySelector('.cal-skeleton-thumb'))] : [],
      rows: c ? [...c.querySelectorAll('.cal-sk-body > *')].filter(vis).map(box) : [],
      chips: c ? [...c.querySelectorAll('.cal-sk-cpill')].filter(vis).map(box) : [],
    };
  }
  const cards = [...document.querySelectorAll('#calStrip .cal-card')].filter(vis).filter(inView);
  const c = cards[0];
  return {
    cards: cards.map(box),
    thumb: c ? [box(c.querySelector('.cal-card-thumb'))] : [],
    rows: c ? [...c.querySelectorAll('.cal-card-body > *')].filter(vis).map(box) : [],
    chips: c ? [...c.querySelectorAll('.cal-client-status > *')].filter(vis).map(box) : [],
  };
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function run(browser, origin, label, viewport) {
  const t = await openClient(browser, origin, { width: viewport.width, height: viewport.height, finished: true, postsDelay: 6000 });
  await t.page.waitForFunction(() => typeof onCalViewChange === 'function' && document.querySelector('#calView .cal-view-btn'), null, { timeout: 30000 });
  await t.page.evaluate(() => onCalViewChange('organizer'));
  await t.page.waitForFunction(() => document.querySelector('#calView .cal-sheet-skeleton'), null, { timeout: 15000 }).catch(() => {});
  await sleep(500);
  const skel = await t.page.evaluate(measure, 'skeleton');
  await shot(t.page, `${label}-skeleton`);
  const loaded = await t.page.waitForSelector('#calStrip .cal-card', { timeout: 20000 }).then(() => true, () => false);
  expect(loaded, `${label}: the client cards load`);
  await sleep(800);
  const real = await t.page.evaluate(measure, 'loaded');
  await shot(t.page, `${label}-loaded`);
  expect(skel.client === true, `${label}: the client link draws the client skeleton`);
  expect(!skel.label || skel.label === 'none' || skel.label === 'normal', `${label}: no "Loading..." line pushes the cards down (${skel.label})`);
  const n = Math.min((skel.cards || []).length, real.cards.length);
  compare(`${label} cards`, (skel.cards || []).slice(0, n), real.cards.slice(0, n));
  compare(`${label} thumbnail`, skel.thumb || [], real.thumb);
  compare(`${label} first card rows`, skel.rows || [], real.rows);
  compare(`${label} status chips`, skel.chips || [], real.chips);
  expect(t.errors.length === 0, `${label}: no page errors (${t.errors.join(' | ')})`);
  await t.ctx.close();
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    await run(browser, origin, 'client-desktop', { width: 1440, height: 900 });
    await run(browser, origin, 'client-phone', { width: 390, height: 844 });
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed, ${checks} passed.`); process.exit(1); }
  console.log(`\nclient sheet skeleton shape: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
