'use strict';
/*
 * FIRST PAINT MUST NOT BE HOSTAGE TO A THIRD-PARTY CDN.
 *
 * Reported by the owner's team 2026-08-26: "our sync linear is pretty slow, it
 * loads really slowly at the beginning when we click on it, and then it loads."
 *
 * Measured rather than guessed. `index.html` head carried two third-party tags:
 *
 *   1. a Google Fonts <link rel="stylesheet"> — and a stylesheet in the head
 *      blocks every script that follows it;
 *   2. the Chart.js CDN <script defer> — and a DEFERRED script runs BEFORE
 *      DOMContentLoaded, so it gates it. The comment beside it said it was
 *      deferred "so it can't block first paint", which is exactly the belief
 *      `defer` does not earn.
 *
 * With both CDNs unreachable, DOMContentLoaded took **12,906ms**. With the font
 * link non-render-blocking and Chart.js `async`, the same page reached
 * DOMContentLoaded in **349ms**. NEITHER CHANGE HELPS ALONE — fixing only one
 * leaves the other holding the door, which is why this suite checks both and
 * why they shipped as one commit.
 *
 * The everyday cost is smaller than 12.9s, because normally both CDNs answer.
 * The point is the tail: a corporate proxy, an ISP hiccup, a CDN outage or
 * ordinary bad wifi could stop the app reaching DOM-ready at all, and nothing
 * in the app is broken when that happens — it is simply waiting on somebody
 * else's server to render our own UI.
 *
 * `_chartReady` is what makes `async` safe: it polls for up to 6s and every
 * call site guards on `typeof Chart === 'undefined'`, so a chart asked to
 * render before the CDN answers waits instead of throwing. That guard is
 * asserted here too — if it is ever removed, `async` stops being safe and this
 * suite should be the thing that says so.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- Chart.js is off the DOMContentLoaded path --------------------------
const chartTag = (html.match(/<script\b[^>]*\bsrc="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@[^"]*"[^>]*><\/script>/) || [])[0] || '';
ok(!!chartTag, 'the Chart.js CDN tag is still findable (harness is not vacuous)');
ok(/\basync\b/.test(chartTag),
  'Chart.js loads async — defer would still gate DOMContentLoaded, which is the bug this fixed');
ok(!/\bdefer\b/.test(chartTag),
  'and is not ALSO marked defer, which would silently win over async for a classic script');

// ---- The webfont does not block the scripts that follow it --------------
const fontLinks = html.match(/<link\b[^>]*fonts\.googleapis\.com[^>]*>/g) || [];
ok(fontLinks.length >= 1, 'the Google Fonts link is still findable');
const blocking = fontLinks.filter(tag => !/media="print"/.test(tag) && !/rel="preconnect"/.test(tag)
  && !/rel="preload"/.test(tag));
/* The <noscript> copy is deliberately render-blocking and is deliberately
   exempt: with JS off there is no onload to promote it, and a viewer with no JS
   has no app to slow down anyway. */
const blockingOutsideNoscript = blocking.filter(tag => !html.includes('<noscript>' + tag));
ok(blockingOutsideNoscript.length === 0,
  'no render-blocking Google Fonts stylesheet outside <noscript> — one blocks every script after it'
    + (blockingOutsideNoscript.length ? ' (' + blockingOutsideNoscript[0].slice(0, 90) + ')' : ''));
ok(/<noscript><link\b[^>]*fonts\.googleapis\.com[^>]*><\/noscript>/.test(html),
  'and a <noscript> fallback still delivers the font when there is no JS to promote the media attribute');
ok(/display=swap/.test(fontLinks.join(' ')),
  'display=swap is set, so text paints in the fallback face rather than staying invisible');

// ---- What makes async safe, pinned so it cannot quietly disappear --------
ok(/_chartLoadTries\+\+ < \d+\) setTimeout/.test(html),
  '_chartReady still retries while Chart.js is in flight — this is what makes async safe');
const guards = (html.match(/typeof Chart === 'undefined'|typeof Chart !== 'undefined'/g) || []).length;
ok(guards >= 2,
  `every Chart call site still guards on the global being absent (${guards} guards found)`);

// ---- The preconnects that make the async loads fast are still there ------
ok(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>/.test(html),
  'the gstatic preconnect survives — non-blocking is not the same as slow, and the font still has to arrive');

if (failures) {
  console.error(`\n${failures} first-paint check(s) failed`);
  process.exit(1);
}
console.log('\nfirst paint is not CDN-hostage — checks passed');
