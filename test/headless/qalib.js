'use strict';
/*
 * Shared headless-browser harness (see docs/HEADLESS-TESTING-GUIDE.md).
 * Drives the REAL index.html in headless Chromium so probes exercise the same
 * code the live site/extension serve, against the live Supabase + n8n backend.
 *
 * SAFETY: probes only ever mutate the test client `sidneylaruel` and clean up
 * (archive) everything they create. Never point these at another client.
 */
let PW;
try { PW = require('playwright'); }                              // repo node_modules (CI + `npm install`)
catch (e) { PW = require('/opt/node22/lib/node_modules/playwright'); } // global install (dev box)

const ORIGIN = process.env.QA_ORIGIN || 'http://localhost:8000';

async function launch() {
  return await PW.chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
}
function capture(page) {
  page._errs = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) page._errs.push('[console.error] ' + m.text()); });
  page.on('pageerror', e => page._errs.push('[pageerror] ' + (e && e.message)));
  page.on('requestfailed', r => { const u = r.url(); if (/synchrosocial|supabase/.test(u)) page._errs.push('[reqfail] ' + u + ' ' + (r.failure() && r.failure().errorText)); });
}
async function ctx(browser, opts = {}) {
  const c = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true, ...opts });
  await c.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  return c;
}
async function open(browser, url, opts) {
  const c = await ctx(browser, opts);
  const p = await c.newPage();
  capture(p);
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(700);
  return p;
}
async function smm(browser, slug = 'sidneylaruel', opts) {
  const p = await open(browser, `${ORIGIN}/index.html?v2debug=1#calendar/${slug}`, opts);
  await p.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2500);
  return p;
}

// Backend helpers (public browser-safe constants, already shipped in index.html).
const UPSERT = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post';
const SUPA   = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/calendar_posts';
const KEY    = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';
const up = (post) => fetch(UPSERT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client: 'sidneylaruel', post, comments_base_at: '' }) }).then(r => r.json());
const supaGet = async (qs) => (await (await fetch(`${SUPA}?${qs}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json());
const supa = async (id, sel) => (await supaGet(`id=eq.${id}&select=${sel}`))[0] || {};
const poll = async (id, sel, pred, ms = 22000) => { const t = Date.now(); let r;
  while (Date.now() - t < ms) { r = await supa(id, sel); if (pred(r)) return r; await new Promise(x => setTimeout(x, 800)); } return r; };
const norm = (v) => (v == null ? '' : v);
// A scheduled date ~10 days out, so seeded cards land in a current calendar window.
const soonISO = () => new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

module.exports = { launch, open, ctx, smm, ORIGIN, up, supaGet, supa, poll, norm, soonISO };
