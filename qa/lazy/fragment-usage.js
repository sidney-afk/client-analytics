'use strict';
/* fragment-usage.js -- which source files' code actually runs on each screen.
 *
 * Plan: docs/plans/2026-09-28-load-per-tab-plan.md, step 1 (safety nets).
 * Before any area is loaded on demand we need to know, per screen, which of
 * the src/index fragments do work there. This opens every staff tab and the
 * client link (Calendar, Sample reviews, Analytics) fully offline, records
 * Chrome's JavaScript coverage, and maps every function that ran to the
 * fragment that holds it. The code every fragment runs just by being loaded
 * (its top level) is not counted; only functions that were called.
 *
 * Informational, not a CI gate: it prints a table, and with --write saves it
 * to docs/audits/<date>-fragment-usage.md. Re-run it after each step.
 * Usage: node qa/lazy/fragment-usage.js [--write]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('../../docs/syncview-design/tests/prod-test-utils');
const { seedStaffGate } = require('../staff-gate-seed');
const { CORS, clientLinkRoute, clientLinkUrl, clientLinkCard } = require('../../docs/syncview-design/tests/client-link-fixture');
const { readModuleList, splitModuleFragment } = require('../../scripts/index-modules');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src', 'index');
const SETTLE_MS = 2000;

const manifest = fs.readFileSync(path.join(SRC, 'manifest.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s.endsWith('.js.part'));
const modules = readModuleList(SRC);
const area = new Map();
for (const line of fs.readFileSync(path.join(SRC, 'areas.txt'), 'utf8').split(/\r?\n/)) {
  const [f, a] = line.replace(/#.*/, '').trim().split(/\s+/);
  if (f && a) area.set(f, a.replace('!', ''));
}
const bodies = manifest.map(f => {
  const buf = fs.readFileSync(path.join(SRC, f));
  return [f, (modules.has(f) ? splitModuleFragment(buf).body : buf).toString('utf8')];
});

// Map covered functions in the page's main inline script to fragments.
function fragmentsRun(entries) {
  const ran = new Set();
  const names = new Map(); // fragment -> names of the functions that ran
  for (const e of entries) {
    const spans = [];
    for (const [f, body] of bodies) { const at = e.source.indexOf(body); if (at >= 0) spans.push([at, at + body.length, f]); }
    if (!spans.length) continue;
    for (const fn of e.functions) {
      const r = fn.ranges[0];
      if (!r || !r.count) continue;
      const s = spans.find(([a, b]) => r.startOffset >= a && r.endOffset <= b);
      if (s && !(r.startOffset === s[0] && r.endOffset === s[1])) {
        ran.add(s[2]);
        if (!names.has(s[2])) names.set(s[2], new Set());
        names.get(s[2]).add(fn.functionName || '(anonymous)');
      }
    }
  }
  ran.names = names;
  return ran;
}
const answerEmpty = r => r.request().method() === 'OPTIONS'
  ? r.fulfill({ status: 204, headers: CORS, body: '' })
  : r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' }).catch(() => {});

async function scenario(browser, label, { route, staff, url, afterLoad }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await context.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), route);
  if (staff) {
    await seedStaffGate(context);
    await context.addInitScript(() => { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); localStorage.removeItem('syncview_nav'); } catch (e) {} });
  }
  const page = await context.newPage();
  await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: true });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SETTLE_MS);
  if (afterLoad) await afterLoad(page);
  const ran = fragmentsRun(await page.coverage.stopJSCoverage());
  await context.close();
  return [label, ran];
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  try {
    for (const surface of ['calendar', 'samples', 'analytics']) {
      rows.push(await scenario(browser, `client link: ${surface}`, {
        route: clientLinkRoute(surface), url: clientLinkUrl(origin, surface),
        afterLoad: async page => {
          const sel = clientLinkCard(surface);
          if (!sel) return;
          await page.waitForSelector(sel, { timeout: 20000 });
          await page.click(`${sel} .kcard-expand-btn`);
          await page.waitForTimeout(800);
        },
      }));
    }
    // Staff: find the tabs, then land on each one directly.
    const probe = await browser.newContext();
    await probe.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), answerEmpty);
    await seedStaffGate(probe);
    await probe.addInitScript(() => { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); } catch (e) {} });
    const p = await probe.newPage();
    await p.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.getElementById('navLinear'));
    await p.waitForTimeout(800);
    const tabs = await p.evaluate(() => [...document.querySelectorAll('#headerNav > .header-nav-btn')]
      .filter(a => a.getClientRects().length && getComputedStyle(a).display !== 'none')
      .map(a => [a.textContent.trim().replace(/\s+/g, ' ') || a.id, a.getAttribute('href') || '/']));
    await probe.close();
    for (const [name, href] of tabs) {
      rows.push(await scenario(browser, `staff: ${name}`, { route: answerEmpty, staff: true, url: origin + (href.startsWith('/') || href.startsWith('#') ? href.replace(/^#/, '/#') : '/' + href) }));
    }
  } finally {
    await browser.close();
    server.close();
  }

  const areas = [...new Set(area.values())].sort((a, b) => (a === 'core' ? -1 : b === 'core' ? 1 : a.localeCompare(b)));
  const lines = [
    `# Fragment usage per screen, ${new Date().toISOString().slice(0, 10)}`,
    '',
    'Written by `node qa/lazy/fragment-usage.js --write` (plan: `docs/plans/2026-09-28-load-per-tab-plan.md`, step 1).',
    'Offline run: every backend answer is empty or synthetic. A mark means at least one function in that area was',
    'called on that screen (code that runs just by loading does not count). Areas come from `src/index/areas.txt`.',
    '',
    '| screen | ' + areas.join(' | ') + ' |',
    '|---|' + areas.map(() => '---').join('|') + '|',
  ];
  for (const [label, ran] of rows) {
    const hit = new Set([...ran].map(f => area.get(f)));
    lines.push(`| ${label} | ` + areas.map(a => (hit.has(a) ? '●' : '')).join(' | ') + ' |');
  }
  lines.push('', '## Fragments called per screen', '');
  for (const [label, ran] of rows) lines.push(`- **${label}**: ${[...ran].map(f => f.slice(0, 3)).sort().join(', ')}`);
  lines.push('', '## Staff-only code a client link calls today', '',
    'Each of these must move to core, or stop being called on a client link, before its area can load on demand.', '');
  const perArea = new Map();
  for (const [label, ran] of rows.filter(([l]) => l.startsWith('client link'))) {
    for (const [f, fnNames] of ran.names) {
      const a = area.get(f);
      if (a === 'core') continue;
      if (!perArea.has(a)) perArea.set(a, new Set());
      for (const n of fnNames) if (n !== '(anonymous)') perArea.get(a).add(`\`${n}\` (${f.slice(0, 3)})`);
    }
  }
  for (const [a, fnNames] of [...perArea].sort()) lines.push(`- **${a}**: ${[...fnNames].sort().join(', ') || 'unnamed callbacks only'}`);
  const text = lines.join('\n') + '\n';
  console.log(text);
  if (process.argv.includes('--write')) {
    const out = path.join(ROOT, 'docs', 'audits', `${new Date().toISOString().slice(0, 10)}-fragment-usage.md`);
    fs.writeFileSync(out, text);
    console.log('wrote ' + path.relative(ROOT, out));
  }
})().catch(err => { console.error(err); process.exit(1); });
