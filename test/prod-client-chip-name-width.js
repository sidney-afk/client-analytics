'use strict';
/*
 * The client chip escaped its row the day a longer client name arrived.
 *
 * The Production list's `.prod-chip-client` carries the client's display name.
 * Its base rule, `.prod-chip`, sets `flex: none` -- which is `flex: 0 0 auto`,
 * so the chip cannot shrink. At any row narrower than the chip's content the
 * chip keeps its width and hangs outside the row. `max-width: 180px` caps how
 * wide it gets but does not make it yield, and the `text-overflow: ellipsis`
 * on `.prod-chip` never fires, because the label lives in a NESTED span that
 * the chip's own `overflow: hidden` only clips.
 *
 * None of that was visible while every active client's display name was short.
 * The longest was 13 characters. On 2026-09-18 a 19-character name arrived with
 * 32 new cards and `prod-layout-polish` went red on `plp_list_metadata` at the
 * compact-desktop viewport, on rows no change had touched -- red on two open
 * pull requests at once, neither of which was the cause.
 *
 * WHAT THIS ASSERTS, and what it deliberately does not. It does not reproduce
 * the production row's arithmetic: that depends on live data and on how many
 * siblings happen to be rendered, which is exactly the thing that made the
 * failure look like somebody's diff. It asserts the PROPERTY underneath it --
 * a chip that cannot shrink escapes any row too narrow for it, at every
 * viewport and for every name length -- by rendering the real extracted CSS
 * around a row narrower than the chip's natural width.
 *
 * The name is synthetic and 24 characters long. Never a real client's name:
 * this repository is public and the identity gate fails on any roster display
 * name a change adds.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* Every <style> block, so the custom properties the chip's colors read are
   defined exactly as the app defines them. */
const styles = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
assert.ok(/\.prod-chip\s*\{/.test(styles), 'extracted the stylesheet that defines .prod-chip');

/* 24 characters. Longer than the 19 that broke it and than any name on the
   roster, so the assertion keeps meaning something as names grow. */
const SYNTHETIC_CLIENT_NAME = 'Northwind Test Client Co';
assert.equal(SYNTHETIC_CLIENT_NAME.length, 24, 'the fixture name is 24 characters');

/* Narrower than the chip's 180px cap, so a chip that refuses to shrink must
   overflow and one that yields cannot. */
const ROW_WIDTH = 120;

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  #harness { width: ${ROW_WIDTH}px; }
</style><style>${styles}</style></head><body><div id="harness">
  <div class="prod-row">
    <span class="prod-title"><b>A deliverable title that is itself long</b></span>
    <span class="prod-spacer"></span>
    <span class="prod-chip optional prod-chip-client"><span class="prod-client-dot">*</span><span>${SYNTHETIC_CLIENT_NAME}</span></span>
  </div>
</div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const failures = [];
  try {
    /* Both viewports the layout suite measures above the 900px breakpoint that
       hides `.prod-chip.optional` outright, plus one below it to prove the chip
       is simply absent there rather than passing for a different reason. */
    for (const [name, width, height] of [['desktop', 1440, 950], ['compact-desktop', 1180, 760], ['mobile', 390, 844]]) {
      const tab = await browser.newPage({ viewport: { width, height } });
      await tab.setContent(page);
      const measured = await tab.evaluate(() => {
        const row = document.querySelector('.prod-row');
        const chip = document.querySelector('.prod-chip-client');
        const shown = el => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden';
        };
        if (!row || !chip) return { present: false };
        if (!shown(chip)) return { present: false };
        const r = row.getBoundingClientRect();
        const c = chip.getBoundingClientRect();
        return {
          present: true,
          /* The same containment test prod-layout-polish.js applies, with the
             same 2px tolerance, so a pass here means a pass there. */
          inside: c.left >= r.left - 2 && c.right <= r.right + 2
            && c.top >= r.top - 2 && c.bottom <= r.bottom + 2,
          overhang: Math.round(c.right - r.right),
        };
      });
      await tab.close();
      if (name === 'mobile') {
        if (measured.present) failures.push('mobile: the optional client chip should be hidden below the 900px breakpoint');
        continue;
      }
      if (!measured.present) { failures.push(`${name}: the client chip did not render`); continue; }
      if (!measured.inside) {
        failures.push(`${name}: a ${SYNTHETIC_CLIENT_NAME.length}-character client name pushed the chip ${measured.overhang}px outside its row`);
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    failures.forEach(f => console.error('FAIL  ' + f));
    console.error(`\n${failures.length} client-chip width check(s) failed`);
    process.exit(1);
  }
  console.log('ok client chip keeps a long client name inside its row');
})().catch(error => { console.error(error); process.exit(1); });
