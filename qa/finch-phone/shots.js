'use strict';
/* node qa/finch-phone/shots.js --out=<dir> [--ids=a,b] [--w=360,390,430] [--theme=light,dark]
 * FINCH_VENDOR=<dir with chart.umd.min.js, supabase.js, plus-jakarta-*.ttf> draws charts and the app typeface. */
const fs = require('fs');
const path = require('path');
const { open } = require('./harness');
const { SCENARIOS } = require('./scenarios');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const AUDIT = process.argv.includes('--audit');
const shard = arg('shard', '0/1').split('/').map(Number);
const FMT = arg('fmt', 'png');
const DSF = Number(arg('dsf', '2'));
const OUT = arg('out', '/tmp/finch-shots');
const ids = arg('ids', '').split(',').filter(Boolean);
const widths = arg('w', '390').split(',').map(Number);
const themes = arg('theme', 'light').split(',');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const sc of SCENARIOS.filter((s, i) => (!ids.length || ids.includes(s.id)) && i % shard[1] === shard[0])) {
    for (const width of widths) for (const theme of themes) {
      const h = await open(Object.assign({ width, theme, dsf: DSF }, sc.open));
      try {
        await h.page.waitForTimeout(sc.settle || 2500);
        if (sc.steps) await sc.steps(h.page);
        if (AUDIT) {
          const a = await h.page.evaluate(() => {
            const vis = e => e.checkVisibility && e.checkVisibility({ checkVisibilityCSS: true });
            const inDialogClosed = e => { const d = e.closest('dialog'); return d && !d.open; };
            const desc = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) + '"';
            const small = [], wide = [], fields = [];
            const scrollers = e => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return true; } return false; };
            document.querySelectorAll('button, a[href], summary, input:not([type=hidden]), textarea, select, [role=button], [role=tab]').forEach(e => {
              if (!vis(e) || inDialogClosed(e) || e.closest('.header')) return;
              const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return;
              if (e.type === 'checkbox' || e.type === 'radio' || e.type === 'file') { const lab = e.closest('label'); if (lab) { const lr = lab.getBoundingClientRect(); if (lr.height >= 43.5) return; } }
              if (r.width < 43.5 || r.height < 43.5) { if (!(e.tagName === 'A' && e.closest('p, li, div.tk-profile-line, td') && r.height >= 20 && false)) small.push(desc(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
              if (/INPUT|TEXTAREA|SELECT/.test(e.tagName) && e.type !== 'file' && e.type !== 'checkbox' && e.type !== 'radio' && !e.readOnly && parseFloat(getComputedStyle(e).fontSize) < 16) fields.push(desc(e) + ' ' + getComputedStyle(e).fontSize);
            });
            document.querySelectorAll('body *').forEach(e => { if (!vis(e)) return; const r = e.getBoundingClientRect(); if (r.width && r.right > innerWidth + 1 && !scrollers(e) && getComputedStyle(e).position !== 'fixed') wide.push(desc(e) + ' right=' + Math.round(r.right)); });
            return { small: [...new Set(small)].slice(0, 12), fields: [...new Set(fields)].slice(0, 6), wide: wide.slice(0, 6) };
          });
          if (a.small.length || a.fields.length || a.wide.length) console.log('   AUDIT', JSON.stringify(a));
        }
        const m = await h.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
        if (!sc.viewportOnly) { const full = await h.page.evaluate(() => Math.ceil(document.documentElement.scrollHeight)); await h.page.setViewportSize({ width, height: Math.min(Math.max(full, 844), 6000) }); await h.page.waitForTimeout(300); }
        await h.page.screenshot(Object.assign({ path: path.join(OUT, `${sc.id}-${theme}-${width}.${FMT === 'jpeg' ? 'jpg' : 'png'}`), fullPage: false }, FMT === 'jpeg' ? { type: 'jpeg', quality: 78 } : {}));
        console.log(sc.id, theme, width, 'scrollWidth', m.sw, h.state.errors.length ? 'ERRORS ' + h.state.errors.slice(0, 2).join(' | ') : '');
      } catch (e) { console.log(sc.id, theme, width, 'FAILED', e.message.split('\n')[0]); }
      await h.close();
    }
  }
})();
