'use strict';
/*
 * Row cells that escape their row when their content grows.
 *
 * TWO CELLS, ONE DEFECT SHAPE: a flex item that cannot be narrower than its
 * content pushes out of the row instead of truncating. Both were invisible
 * while the data happened to be short, and both went red on 2026-09-18 on rows
 * no change had touched.
 *
 * `.prod-id` -- THE ONE THAT TURNED THE LANE RED. `width: 76px` was never a
 * cap, and the cell does not escape sideways. A deliverable id is hyphenated,
 * so with no `white-space: nowrap` it WRAPS and the cell grows taller than the
 * 44px row: it escapes top and bottom, by 8px each. The first version of this
 * file said min-content width and printed a negative overhang, which is how
 * the real mechanism was found. A provider card shows a 9-character Linear
 * identifier; a natively created card has none yet and `_prodIssueLabel` falls
 * through to the raw deliverable id. Every card created since 13:35Z that day
 * was native.
 *
 * `.prod-chip-client` -- the same shape, found while looking for the first.
 * See its own note below.
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

/* A synthetic native deliverable id: the `del_` prefix plus a UUID, which is
   the shape `_prodIssueLabel` falls back to when a card has no Linear
   identifier. Forty characters, the same length as the real ones. Synthetic
   throughout -- this identifies no card that exists. */
const SYNTHETIC_NATIVE_ID = 'del_a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
assert.equal(SYNTHETIC_NATIVE_ID.length, 40, 'the fixture id is 40 characters');

/* Wide enough for the id cell's declared 76px with room to spare, and still
   narrower than what the id's raw content (about 300px) or the chip's 180px cap
   would demand -- so a cell that refuses to be narrower than its content must
   overflow, and one that truncates cannot. */
const ROW_WIDTH = 220;

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  #harness { width: ${ROW_WIDTH}px; }
</style><style>${styles}</style></head><body><div id="harness">
  <div class="prod-row">
    <span class="prod-id" title="${SYNTHETIC_NATIVE_ID}">${SYNTHETIC_NATIVE_ID}</span>
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
        const idCell = document.querySelector('.prod-id');
        const shown = el => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden';
        };
        if (!row || !idCell) return { present: false, idInside: false, idEscape: 'the row or the id cell did not render' };
        const r = row.getBoundingClientRect();
        const within2 = el => {
          const b = el.getBoundingClientRect();
          return b.left >= r.left - 2 && b.right <= r.right + 2
            && b.top >= r.top - 2 && b.bottom <= r.bottom + 2;
        };
        /* The id cell is NOT `.prod-chip.optional`, so it renders at every
           viewport -- including below the 900px breakpoint where the chip is
           hidden. It is measured on every pass. */
        const idInside = within2(idCell);
        /* NAME THE EDGE. The first version of this reported only right-edge
           overhang and printed a NEGATIVE number, because the cell does not
           escape sideways at all: a deliverable id is hyphenated, the cell had
           no `white-space: nowrap`, so it WRAPS and grows taller than the 44px
           row. A number that cannot be read is the same blackout the assertion
           ids were added to end. */
        const b = idCell.getBoundingClientRect();
        const idEscape = [
          ['left', Math.round(r.left - b.left)],
          ['right', Math.round(b.right - r.right)],
          ['top', Math.round(r.top - b.top)],
          ['bottom', Math.round(b.bottom - r.bottom)],
        ].filter(([, px]) => px > 2).map(([edge, px]) => `${edge} by ${px}px`).join(', ');
        if (!chip || !shown(chip)) return { present: false, idInside, idEscape };
        const c = chip.getBoundingClientRect();
        return {
          present: true,
          idInside,
          idEscape,
          /* The same containment test prod-layout-polish.js applies, with the
             same 2px tolerance, so a pass here means a pass there. */
          inside: c.left >= r.left - 2 && c.right <= r.right + 2
            && c.top >= r.top - 2 && c.bottom <= r.bottom + 2,
          overhang: Math.round(c.right - r.right),
        };
      });
      await tab.close();
      if (!measured.idInside) {
        failures.push(`${name}: a ${SYNTHETIC_NATIVE_ID.length}-character native id pushed .prod-id outside its row (${measured.idEscape || 'no edge over tolerance'})`);
      }
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
    console.error(`\n${failures.length} row-cell overflow check(s) failed`);
    process.exit(1);
  }
  console.log('ok row cells keep a 40-character native id and a 24-character client name inside the row');
})().catch(error => { console.error(error); process.exit(1); });
