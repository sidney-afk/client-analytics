'use strict';

/*
 * CALM, ROUND FIVE: the yellow line that flashed on every hard refresh, the plan-origin marks on the client rows, and
 * the editor / designer name colour. Fictional data, every backend answer mocked.
 *
 *   node docs/syncview-design/tests/workload-calm-five-browser.js
 */

const F = require('./workload-calm-fixture.js');

let checks = 0;
function expect(ok, message) {
  if (!ok) throw new Error('WORKLOAD_CALM_FIVE ' + message);
  checks++;
}

const STATUS = () => { const el = document.getElementById('wlPlanStatus'); return el && !el.hidden ? el.textContent.trim() : ''; };

// A hard refresh: a second load of the app in the same browser (so the saved board copy is there), the board read held open.
async function hardRefresh(h) {
  await h.context.addInitScript(() => {
    window.__seen = [];
    setInterval(() => {
      const el = document.getElementById('wlPlanStatus');
      const t = el && !el.hidden ? el.textContent.trim() : '';
      if (t && !window.__seen.includes(t)) window.__seen.push(t);
    }, 5);
  });
  h.state.holdNativeRead();
  await h.page.goto(h.page.url().replace(/\/workload.*/, '/#workload'), { waitUntil: 'domcontentloaded' });
  await h.page.waitForFunction(() => typeof wlState === 'object' && wlState.cachedBoardAt != null && wlState.allActiveSubs.length > 0, null, { timeout: 15000 });
}

function luminance(rgb) {
  const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

(async () => {
  // ── 1. The warning that flashed ───────────────────────────────────────────────────────────────────────────────────
  let h = await F.launchWorkloadHarness({ nativeSnapshot: true, issues: F.fixtureIssues(), plans: F.fixturePlans(), comments: F.COMMENTS, flagRows: [F.CALM_FLAG] });
  try {
    const p = h.page;
    await F.waitForPlanSettled(p);
    await p.waitForTimeout(500); // the live board writes the saved copy a moment after it lands

    console.log('--- a hard refresh with the read still on its way');
    await hardRefresh(h);
    await p.waitForTimeout(1200);
    expect(await p.evaluate(() => wlState.cachedBoardAt != null && wlState.planStatus === 'loading'), 'the saved board is painted while the live read is held');
    expect(await p.evaluate(() => document.querySelectorAll('.workload-day-card-chip').length > 0), 'and its cards are on screen');
    expect(await p.evaluate(STATUS) === '', 'no warning line while the read is simply on its way (saw "' + await p.evaluate(STATUS) + '")');
    h.state.releaseNative();
    await p.waitForFunction(() => wlState.planStatus === 'ready' && wlState.cachedBoardAt == null, null, { timeout: 15000 });
    await p.waitForTimeout(300);
    expect(await p.evaluate(STATUS) === '', 'no warning after it lands either');
    const seen = await p.evaluate(() => window.__seen);
    expect(seen.length === 0, 'the line never appeared at any moment of the refresh (saw ' + JSON.stringify(seen) + ')');

    console.log('--- a read that stays out for a long time does say so');
    await hardRefresh(h);
    await p.waitForFunction(() => /Showing the board from \d\d:\d\d while it updates/.test((document.getElementById('wlPlanStatus') || {}).textContent || ''), null, { timeout: 9000 });
    expect(true, 'the line appeared as expected');
    h.state.releaseNative();
    await p.waitForFunction(() => wlState.planStatus === 'ready', null, { timeout: 15000 });
    expect(await p.evaluate(STATUS) === '', 'and the line goes when the read lands');

    console.log('--- a read that fails says so at once');
    await hardRefresh(h);
    h.state.failNative = 500;
    h.state.releaseNative();
    await p.waitForFunction(() => /Couldn.t update\. Showing the board from/.test((document.getElementById('wlPlanStatus') || {}).textContent || ''), null, { timeout: 15000 });
    expect(true, 'the line appeared as expected');
    h.state.failNative = 0;

    console.log('--- finished loading with something genuinely missing');
    await p.goto(p.url().replace(/\/workload.*/, '/#workload'), { waitUntil: 'domcontentloaded' });
    await F.waitForPlanSettled(p);
    expect(await p.evaluate(STATUS) === '', 'a complete board shows no line');
    h.state.nativeMeta = { plans_dropped: 2 };
    await p.evaluate(() => wlRefetchSilent());
    await p.waitForFunction(() => /2 saved work days are not shown/.test((document.getElementById('wlPlanStatus') || {}).textContent || ''), null, { timeout: 15000 });
    expect(await p.evaluate(() => document.getElementById('wlPlanStatus').classList.contains('is-warning')), 'two saved work days dropped: the yellow line names them');
    h.state.nativeMeta = null;
    await p.evaluate(() => wlRefetchSilent());
    await p.waitForFunction(() => !document.getElementById('wlPlanStatus').textContent.trim(), null, { timeout: 15000 });
    expect(true, 'the line appeared as expected');
  } finally { await h.close(); }

  // ── 2. The plan-origin marks ──────────────────────────────────────────────────────────────────────────────────────
  h = await F.launchCalmBoard({ calm: true, plans: [...F.fixturePlans(), { issue_id: 'o1', plan_date: '2026-09-10' }] });
  try {
    const p = h.page;
    await p.waitForTimeout(700);
    console.log('--- plan-origin marks on the client rows');
    const marks = () => p.evaluate(() => [...document.querySelectorAll('.workload-day-card-chip')].map(c => {
      const o = c.querySelector('.wl-plan-origin');
      const r = o && o.getBoundingClientRect();
      return o ? { kind: o.className.replace(/.*\bis-/, ''), tip: o.getAttribute('data-tip'), label: o.getAttribute('aria-label'), w: r.width, h: r.height, op: parseFloat(getComputedStyle(o).opacity), disp: getComputedStyle(o).display, svg: o.querySelector('svg').getBoundingClientRect().width } : null;
    }));
    let m = await marks();
    expect(m.length > 0 && m.every(x => x), 'every client row carries a plan-origin mark (' + m.length + ' rows)');
    for (const kind of ['auto', 'manual', 'carried']) {
      const x = m.find(y => y.kind === kind);
      expect(!!x, kind + ': a row shows it');
      expect(x.disp !== 'none' && x.w > 0 && x.h > 0, kind + ': it is visible');
      expect(x.svg <= 12 && x.op < 1, kind + ': small (' + x.svg + 'px) and muted (opacity ' + x.op + ')');
      expect(x.tip && x.tip.length > 20 && x.label, kind + ': it keeps its tooltip and its label: "' + x.tip + '"');
    }
    expect(m.find(y => y.kind === 'manual').tip.startsWith('Planned by hand'), 'manual: tooltip says planned by hand');
    expect(m.find(y => y.kind === 'carried').tip.startsWith('Carried over'), 'carried: tooltip says carried over');
    expect(/^Planned automatically/.test(m.find(y => y.kind === 'auto').tip), 'auto: tooltip says planned automatically');
    // The two states the board is only in for a moment (plans still loading, plans never answered).
    for (const [state, kind, start] of [[{ planHasSnapshot: false, planLoading: true }, 'loading', 'Loading saved plans'], [{ planHasSnapshot: false, planLoading: false }, 'fallback', 'No plan day saved']]) {
      await p.evaluate(s => { Object.assign(wlState, s); renderWorkloadAll(); }, state);
      m = await marks();
      const x = m.find(y => y && y.kind === kind);
      expect(!!x && x.disp !== 'none' && x.w > 0 && x.tip.startsWith(start), kind + ': it shows with its tooltip');
    }
    expect(await p.evaluate(() => [...document.querySelectorAll('.workload-day-card-chip-meta .wl-workload-group')].every(e => getComputedStyle(e).display === 'none')), 'the per-group weight stays hidden, as before');
  } finally { await h.close(); }

  // ── 3. Editor / designer names ────────────────────────────────────────────────────────────────────────────────────
  for (const theme of ['dark', 'light']) {
    h = await F.launchCalmBoard({ calm: true, theme });
    try {
      const p = h.page;
      await p.waitForTimeout(500);
      console.log('--- editor and designer names (' + theme + ')');
      const got = await p.evaluate(() => {
        const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,\/]+/).map(Number); return { rgb: v.slice(0, 3), a: v.length > 3 ? v[3] : 1 }; };
        // What the pixels behind the name really are: every ancestor's background laid over the page's.
        const behind = el => {
          const stack = [];
          for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) stack.push(c); }
          let base = [255, 255, 255];
          for (const c of stack.reverse()) base = base.map((v, i) => Math.round(c.rgb[i] * c.a + v * (1 - c.a)));
          return base;
        };
        const name = document.querySelector('.workload-day-card-name');
        const badge = document.querySelector('.workload-day-card-badge');
        const client = document.querySelector('.workload-day-card-chip-name');
        return { name: parse(getComputedStyle(name).color).rgb, badge: parse(getComputedStyle(badge).color).rgb, client: parse(getComputedStyle(client).color).rgb, bg: behind(name), badgeBg: behind(badge), badgeShown: getComputedStyle(badge).display !== 'none', n: document.querySelectorAll('.workload-day-card-name').length };
      });
      expect(got.n > 0 && got.badgeShown, theme + ': the names and the initial badge are there');
      expect(JSON.stringify(got.name) !== JSON.stringify(got.client), theme + ': the name colour differs from the client colour (' + got.name + ' vs ' + got.client + ')');
      const [r, g, b] = got.name;
      expect(b > r && b > g && r > g, theme + ': it is a purple (' + got.name + ')');
      expect(ratio(got.name, got.bg) >= 4.5, theme + ': the name meets 4.5:1 on its card (' + ratio(got.name, got.bg).toFixed(2) + ')');
      expect(ratio(got.badge, got.badgeBg) >= 4.5, theme + ': the badge letter meets 4.5:1 too (' + ratio(got.badge, got.badgeBg).toFixed(2) + ')');
      if (theme === 'dark') expect(luminance(got.name) > 0.35, 'dark: it is a bright, light tint');
    } finally { await h.close(); }
  }

  console.log('OK workload-calm-five-browser: ' + checks + ' checks');
})().catch(error => { console.error(error); process.exit(1); });
