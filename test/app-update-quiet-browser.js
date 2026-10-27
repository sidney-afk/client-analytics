'use strict';
/*
 * The "new version" bar asks once, not once per publish, and never eats a draft.
 *
 * Owner, 2026-10-27: "while I was doing my comments, I had to refresh 10 times
 * the website." Eight publishes landed that afternoon. A tab someone was
 * working in got the bar after each one, and again after every dismiss: once a
 * tab was document-stale, the next poll (5 min) or window focus skipped the
 * dismissed-build return and showed the bar again. The bar's Reload also threw
 * away a half-written comment without asking. OPEN_REPAIRS 547.
 *
 * This runs the real update-check script from the built index.html in Chromium,
 * on a page served from a non-loopback host (the script stays silent on
 * 127.0.0.1), with a fake clock and a fake deploy whose Last-Modified the test
 * moves forward to "publish". It checks:
 *   1. a burst of publishes while someone works -> the bar shows once, after an
 *      hour, and a dismiss holds for every later publish;
 *   2. a draft open during a publish -> no bar while typing, and the bar's
 *      Reload asks before it would lose the draft;
 *   3. a hidden clean tab still reloads itself; a hidden tab with a draft does not;
 *   4. a dismissed tab still gets the wall after four stale hours (the safety net).
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

require('../scripts/ensure-built').ensureBuilt();
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const at = INDEX.indexOf('(function appUpdateNudge(');
assert.ok(at > -1, 'the update-check script is in index.html');
const SCRIPT = INDEX.slice(INDEX.lastIndexOf('<script>', at), INDEX.indexOf('</script>', at) + '</script>'.length);

const MIN = 60 * 1000, H = 60 * MIN;
const T0 = Date.parse('2026-10-27T14:00:00Z');
const real = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function ok(cond, label) { assert.ok(cond, label); checks++; console.log('  ok  ' + label); }

async function open(browser) {
  const deploy = { lm: T0 - H, loads: 0 };
  const context = await browser.newContext();
  await context.route('https://syncview.test/**', route => {
    const req = route.request();
    const headers = { 'last-modified': new Date(deploy.lm).toUTCString(), etag: '"' + deploy.lm + '"', 'content-type': 'text/html' };
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers, body: '' });
    deploy.loads++;
    return route.fulfill({ status: 200, headers, body: '<!doctype html><html><head></head><body><textarea id="draft"></textarea>' + SCRIPT + '</body></html>' });
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__hidden = false; window.__bars = 0; window.__confirms = 0;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
    window.confirm = () => { window.__confirms++; return false; };
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.id === 'svUpdateBar') window.__bars++; })))
      .observe(document, { childList: true, subtree: true });
  });
  await page.clock.install({ time: T0 });
  await page.goto('https://syncview.test/');
  const t = { page, deploy, context };
  t.tick = async ms => { // advance in poll-sized steps, letting each HEAD settle
    for (let left = ms; left > 0; left -= 5 * MIN) { await page.clock.runFor(Math.min(left, 5 * MIN)); await real(40); }
  };
  t.publish = async () => { deploy.lm = (await page.evaluate(() => Date.now())); };
  t.state = () => page.evaluate(() => ({ bars: window.__bars, bar: !!document.getElementById('svUpdateBar'), wall: !!document.getElementById('svUpdateWall'), confirms: window.__confirms }));
  await t.tick(6000); // the baseline poll
  return t;
}

(async () => {
  const browser = await chromium.launch();
  try {
    // 1. Several publishes in a row while someone works in the tab.
    {
      const t = await open(browser);
      await t.tick(10 * MIN); await t.publish();
      await t.tick(30 * MIN);
      ok((await t.state()).bars === 0, 'a publish does not interrupt a working tab at once (no bar in its first half hour)');
      for (let i = 0; i < 2; i++) { await t.tick(20 * MIN); await t.publish(); }
      await t.tick(10 * MIN);
      let s = await t.state();
      ok(s.bars === 1 && s.bar, 'after an hour of staleness, three publishes later, the bar has shown exactly once');
      await t.page.click('#svUpdateBar .sv-up-x');
      for (let i = 0; i < 5; i++) { await t.tick(25 * MIN); await t.publish(); await t.page.evaluate(() => window.dispatchEvent(new Event('focus'))); }
      s = await t.state();
      ok(s.bars === 1 && !s.bar && !s.wall, 'a dismiss holds through five more publishes, polls and window focuses');
      ok(t.deploy.loads === 1, 'and the visible tab was never reloaded out from under the reader');
      await t.tick(H);
      s = await t.state();
      ok(s.wall, 'four stale hours later the wall still arrives: a dismissed tab never runs old code for long');
      await t.context.close();
    }
    // 2. A draft open during a publish.
    {
      const t = await open(browser);
      await t.page.fill('#draft', 'half a comment');
      await t.publish();
      await t.tick(2 * H);
      let s = await t.state();
      ok(s.bars === 0 && t.deploy.loads === 1, 'no bar and no reload while a comment is being written, two hours after a publish');
      await t.page.evaluate(() => { const d = document.getElementById('draft'); d.remove(); });
      await t.tick(5 * MIN);
      s = await t.state();
      ok(s.bars === 1, 'once the draft is gone (sent), the one bar shows');
      const fresh = () => { const d = document.createElement('textarea'); d.id = 'draft2'; document.body.appendChild(d); };
      await t.page.evaluate(fresh);
      await t.page.fill('#draft2', 'a new draft started with the bar up');
      await t.page.click('#svUpdateBar .sv-up-reload');
      await real(100);
      s = await t.state();
      ok(s.confirms === 1 && t.deploy.loads === 1, "the bar's Reload asks first when a draft would be lost, and Cancel keeps it");
      ok(await t.page.inputValue('#draft2') === 'a new draft started with the bar up', 'the draft is still there');
      await t.context.close();
    }
    // 3. A hidden tab.
    {
      const t = await open(browser);
      await t.page.evaluate(() => { window.__hidden = true; });
      await t.page.fill('#draft', 'typed then tabbed away');
      await t.publish(); await t.tick(15 * MIN);
      ok(t.deploy.loads === 1, 'a hidden tab with a draft is not reloaded');
      await t.page.fill('#draft', '');
      await t.page.evaluate(() => { delete document.getElementById('draft').dataset.svUnsavedEdit; });
      await t.tick(5 * MIN);
      ok(t.deploy.loads === 2, 'a hidden clean tab takes the publish by itself, unseen');
      await t.context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`app-update-quiet-browser: ${checks} checks passed ✅`);
})().catch(e => { console.error('FAIL ', e && e.message || e); process.exit(1); });
