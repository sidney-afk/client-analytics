// dawn-check.js — the weekday MORNING CHECK (skill: /dawn-check).
//
// Walks the seven flows that matter most, in a real Chromium against the LIVE
// backend, on the TEST client `sidneylaruel` only, and writes a short
// plain-English report with a screenshot per failure and timings against
// docs/audits/2026-09-23-speed-map.md.
//
//   1 client approve          (clean client context, lands on the Review tab)
//   2 client request changes  (clean client context)
//   3 staff card save         ("Saved, syncing" → saved, or straight to saved)
//   4 card rename             (linked sub-issue title follows, then restored)
//   5 Workload open time      6 SyncLinear first rows   7 Analytics first numbers
//
// Reuse, not rebuild: contexts, Linear mocking, the client-entry token and the
// archive-and-verify cleanup all come from qa/sxr_courier_lib.js via
// qa/probes/ot4_lib.js; the client clicks are the real buttons (H.clientAct).
//
// Safety (docs/testing/HEADLESS-TESTING-GUIDE.md §5):
//   - Every write targets sidneylaruel. A page-level guard ABORTS any POST whose
//     body names another client and fails the run.
//   - Seeds are archived and verified; the renamed card and its sub-issue are
//     renamed back and verified. Nothing is left changed.
//   - Linear is mocked by the courier context (write flows); the read-only tab
//     timings let Linear READS through and abort every Linear write hook. The
//     rename uses a card whose sub-issue has NO Linear mirror.
//   - Client flows act on the CAPTION: it has no native work item, so a seeded
//     card can take the write (a video approval needs a native deliverable,
//     which a disposable seed cannot have: native_link_required).
//
// Needs SYNCVIEW_STAFF_KEY in the environment (staff writes + the client link).
// Exit code: 0 all passed (slow timings are warnings), 1 any flow failed.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('../probes/ot4_lib.js');
const { launch, open, smmCal, clientCal, upCal, archiveCalSafe, appErrs, SUPA, KEY, ORIGIN } = H;

const TEST_SLUG = 'sidneylaruel';
const OUT = path.join(__dirname, 'out');
const TS = Date.now();
const POLL = 35000;
const SLOW_FACTOR = 1.5;   // slower than 1.5x the speed-map cold median = "slow" warning
const TAB_CAP = 30000;     // not rendered in 30 s = failed
// Cold medians from docs/audits/2026-09-23-speed-map.md §2 (each check opens a
// fresh browser context, so cold is the honest comparison; warm is shown too).
const BASELINE = {
  workload:   { cold: 7510, warm: 6008 },
  synclinear: { cold: 4370, warm: 2822 },
  analytics:  { cold: 5928, warm: 5116 },
  calendar:   { cold: 2485, warm: 801 },
};

fs.mkdirSync(OUT, { recursive: true });
const results = [];
const violations = [];
function record(key, title, r) { results.push(Object.assign({ key, title }, r)); }

// ---- the other-client write guard -----------------------------------------
async function guard(page) {
  await page.route('**/*', (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postData() || '';
      const m = body.match(/"(?:client|client_slug|slug)"\s*:\s*"([^"]*)"/g) || [];
      const bad = m.map(s => s.split(':').pop().replace(/[\s"]/g, '').toLowerCase())
        .filter(v => v && v !== TEST_SLUG && v !== 'sidney laruel' && v !== 'sidneylaruel');
      if (bad.length) { violations.push(req.url().split('?')[0]); return route.abort(); }
    }
    return route.fallback();
  });
}
async function shot(page, key) {
  const f = path.join(OUT, key + '.png');
  try { await page.screenshot({ path: f, fullPage: false }); return f; } catch { return null; }
}
const rowCal = (id, cols) => H.rowCal(id, cols);
async function deliverableTitle(id) {
  const r = await fetch(`${SUPA}/rest/v1/deliverables?id=eq.${encodeURIComponent(id)}&select=title`, { headers: { apikey: KEY, authorization: 'Bearer ' + KEY } });
  const j = await r.json(); return (j[0] || {}).title || null;
}
async function actRetry(p, name, comp, kind, text) {
  for (let i = 0; i < 12; i++) { const r = await H.clientAct(p, name, comp, kind, text); if (r !== 'disabled') return r; await H.sleep(1000); }
  return 'disabled';
}
function seedReviewCard(id, name, captionStatus = 'Client Approval') {
  upCal({ id, name, platforms: 'youtube', scheduled_date: new Date(Date.now() + 86400e3).toISOString().slice(0, 10),
    video_status: 'Approved', graphic_status: 'Approved', caption_status: captionStatus, status: captionStatus === 'Client Approval' ? 'Client Approval' : 'In Progress',
    caption: 'Dawn check caption under review',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', asset_url: 'https://example.com/dawn.mp4' });
}

// ---- flows 1 + 2: the client link -----------------------------------------
async function clientFlows(browser, seeds) {
  const A = seeds.approve, R = seeds.request;
  const t0 = Date.now();
  const p = await clientCal(browser);
  await guard(p);
  const landed = await p.waitForFunction(() => !!document.querySelector('.cal-review-card'), null, { timeout: TAB_CAP }).then(() => Date.now() - t0).catch(() => null);
  const onReview = await p.evaluate(() => {
    const active = document.querySelector('.cal-view-btn.active, .cal-tab.active, [aria-selected="true"]');
    return { cards: document.querySelectorAll('.cal-review-card').length, active: active ? active.textContent.trim().slice(0, 30) : '' };
  });
  // 1 approve
  try {
    await H.expandReview(p, A.name);
    const clicked = await actRetry(p, A.name, 'caption', 'approve');
    const t1 = Date.now();
    const row = clicked === 'ok' ? await H.pollRow(() => rowCal(A.id, 'caption_status,client_caption_approved_at'), r => r.caption_status === 'Approved' && !!r.client_caption_approved_at, POLL) : null;
    // Read again after a pause: an approval that lands and is then reverted is a failure.
    await H.sleep(4000);
    const held = row ? rowCal(A.id, 'caption_status') : null;
    const ok = clicked === 'ok' && !!row && !!held && held.caption_status === 'Approved';
    record('client-approve', 'Client approves', { ok, ms: ok ? Date.now() - t1 : null,
      detail: ok ? `link opened on the Review tab in ${landed} ms (${onReview.cards} cards); approval saved`
                 : `click=${clicked}, saved=${!!row}, held=${!!held && held.caption_status}; review cards on landing=${onReview.cards}`,
      extra: landed, shot: ok ? null : await shot(p, 'client-approve') });
  } catch (e) { record('client-approve', 'Client approves', { ok: false, detail: String(e.message || e), shot: await shot(p, 'client-approve') }); }
  // 2 request changes
  try {
    const txt = 'Dawn check: please adjust ' + TS;
    await H.expandReview(p, R.name);
    const clicked = await actRetry(p, R.name, 'caption', 'request', txt);
    const t1 = Date.now();
    const row = clicked === 'ok' ? await H.pollRow(() => rowCal(R.id, 'caption_status,caption_tweaks'), r => r.caption_status === 'Tweaks Needed', POLL) : null;
    const ok = clicked === 'ok' && !!row && JSON.stringify(row.caption_tweaks || '').includes(txt);
    record('client-request', 'Client requests changes', { ok, ms: ok ? Date.now() - t1 : null,
      detail: ok ? 'request saved with its text; status is Tweaks Needed' : `click=${clicked}, saved=${!!row}`,
      shot: ok ? null : await shot(p, 'client-request') });
  } catch (e) { record('client-request', 'Client requests changes', { ok: false, detail: String(e.message || e), shot: await shot(p, 'client-request') }); }
  const errs = appErrs(p);
  if (errs.length) record('client-errors', 'Client page has no app errors', { ok: false, detail: errs[0].slice(0, 200), shot: await shot(p, 'client-errors') });
  await p.context().close();
  return landed;
}

// ---- flows 3 + 4: staff calendar ------------------------------------------
async function staffFlows(browser, seeds, renameTarget) {
  const t0 = Date.now();
  const p = await smmCal(browser, TEST_SLUG);
  await guard(p);
  const calMs = await p.waitForFunction(() => !!document.querySelector('#calView .cal-card, #calStrip .cal-card'), null, { timeout: TAB_CAP }).then(() => Date.now() - t0).catch(() => null);
  // 3 save
  const S = seeds.save;
  try {
    await p.waitForFunction((pid) => !!document.querySelector(`#calStrip textarea.cal-fld-cap[data-pid="${pid}"]`), S.id, { timeout: 25000 });
    await p.evaluate((pid) => {
      window.__dawnSave = { syncingAt: null, savedAt: null, errorAt: null, t0: 0 };
      const d = window.__dawnSave;
      const look = () => {
        const tag = document.querySelector(`[data-saving="${pid}"]`);
        const ind = document.querySelector(`[data-sv-save-ind="${pid}"]`);
        const now = performance.now();
        if (tag && /Saved, syncing/.test(tag.textContent) && !d.syncingAt) d.syncingAt = now;
        if (((ind && ind.classList.contains('is-saved')) || (d.syncingAt && tag && !/syncing/.test(tag.textContent))) && !d.savedAt) d.savedAt = now;
        if (tag && tag.classList.contains('is-error') && !d.errorAt) d.errorAt = now;
      };
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    }, S.id);
    const cap = 'Dawn check caption ' + TS;
    await p.evaluate(([pid, txt]) => {
      const ta = document.querySelector(`#calStrip textarea.cal-fld-cap[data-pid="${pid}"]`);
      window.__dawnSave.t0 = performance.now();
      ta.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, txt);
      ta.dispatchEvent(new Event('input', { bubbles: true })); ta.blur();
    }, [S.id, cap]);
    const row = await H.pollRow(() => rowCal(S.id, 'caption'), r => r.caption === cap, POLL);
    await p.waitForFunction(() => window.__dawnSave.savedAt || window.__dawnSave.errorAt, null, { timeout: 20000 }).catch(() => {});
    const d = await p.evaluate(() => window.__dawnSave);
    const rel = (x) => x ? Math.round(x - d.t0) : null;
    const ok = !!row && !!d.savedAt && !d.errorAt;
    record('staff-save', 'Staff card save', { ok, ms: rel(d.savedAt),
      detail: ok ? (d.syncingAt ? `"Saved, syncing" at ${rel(d.syncingAt)} ms, then saved at ${rel(d.savedAt)} ms` : `saved at ${rel(d.savedAt)} ms (no syncing step needed)`)
                 : `db=${!!row}, saved-mark=${!!d.savedAt}, error=${!!d.errorAt}, syncing-stuck=${!!d.syncingAt && !d.savedAt}`,
      shot: ok ? null : await shot(p, 'staff-save') });
  } catch (e) { record('staff-save', 'Staff card save', { ok: false, detail: String(e.message || e), shot: await shot(p, 'staff-save') }); }
  // 4 rename (and restore)
  if (!renameTarget) record('rename', 'Card rename, sub-issue follows', { ok: false, detail: 'no test card with a two-sided, Linear-free sub-issue link was found' });
  else {
    const { id, name, deliverableId } = renameTarget;
    const renamed = (name + ' · dawn').slice(0, 150);
    const setName = (to) => p.evaluate(([pid, v]) => {
      const inp = document.querySelector(`#calStrip .cal-card[data-pid="${pid}"] .cal-fld-name`);
      if (!inp) return 'no-name-field';
      inp.focus(); inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur(); return 'ok';
    }, [id, to]);
    try {
      await p.waitForFunction((pid) => !!document.querySelector(`#calStrip .cal-card[data-pid="${pid}"] .cal-fld-name`), id, { timeout: 25000 });
      const t1 = Date.now();
      const c1 = await setName(renamed);
      const card = await H.pollRow(() => rowCal(id, 'name'), r => r.name === renamed, POLL);
      const sub = await pollAsync(async () => (await deliverableTitle(deliverableId)) || '', t => t.includes(renamed), 60000);
      const ok = c1 === 'ok' && !!card && !!sub;
      record('rename', 'Card rename, sub-issue follows', { ok, ms: ok ? Date.now() - t1 : null,
        detail: ok ? 'card and its sub-issue both took the new name' : `click=${c1}, card=${!!card}, sub-issue followed=${!!sub}`,
        shot: ok ? null : await shot(p, 'rename') });
    } catch (e) { record('rename', 'Card rename, sub-issue follows', { ok: false, detail: String(e.message || e), shot: await shot(p, 'rename') }); }
  }
  const errs = appErrs(p);
  if (errs.length) record('staff-errors', 'Staff calendar has no app errors', { ok: false, detail: errs[0].slice(0, 200), shot: await shot(p, 'staff-errors') });
  await p.context().close();
  return calMs;
}
async function pollAsync(fn, pred, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (pred(v)) return v; } catch {} await H.sleep(1200); }
  return null;
}
// Put the rename back: through the same staff UI first, REST-verified; both sides.
async function restoreRename(browser, t) {
  const cardOk = async () => ((rowCal(t.id, 'name') || {}).name === t.name);
  const subOk = async () => { const x = (await deliverableTitle(t.deliverableId)) || ''; return x === t.originalTitle || (x.includes(t.name) && !x.includes(' · dawn')); };
  if (await cardOk() && await subOk()) return { ok: true };
  const p = await smmCal(browser, TEST_SLUG);
  await guard(p);
  await p.waitForFunction((pid) => !!document.querySelector(`#calStrip .cal-card[data-pid="${pid}"] .cal-fld-name`), t.id, { timeout: 25000 }).catch(() => {});
  await p.evaluate(([pid, v]) => {
    const inp = document.querySelector(`#calStrip .cal-card[data-pid="${pid}"] .cal-fld-name`);
    if (inp) { inp.focus(); inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur(); }
  }, [t.id, t.name]);
  const c = await pollAsync(cardOk, Boolean, POLL);
  const s = await pollAsync(subOk, Boolean, 120000);
  await p.context().close();
  return { ok: !!c && !!s, card: !!c, sub: !!s };
}

// ---- flows 5-7: tab timings ------------------------------------------------
// READ-ONLY tabs use the courier staff context (staff key, Linear writes
// mocked), plus one page-level rule: Linear READ hooks go to the network, since
// the courier stubs reads too and that leaves Workload empty. Everything else,
// every Linear write included, still falls through to the courier mock.
const LINEAR_READS = /\/webhook\/linear-(issues|read|search|browser|data-model|plan-skeleton|tweak-comments)[a-z-]*(?:[/?]|$)/;
async function readOnlyPage(browser, route) {
  const page = await open(browser, '/favicon.ico');
  await page.route(u => LINEAR_READS.test(u.toString()), r => r.continue());
  await guard(page);
  page._t0 = Date.now();   // the clock starts at navigation, not at context setup
  await page.goto(ORIGIN + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
  return page;
}
async function timeTab(browser, key, title, route, readyFn) {
  const p = await readOnlyPage(browser, route);
  const ms = await p.waitForFunction(readyFn, null, { timeout: TAB_CAP, polling: 50 }).then(() => Date.now() - p._t0).catch(() => null);
  const b = BASELINE[key];
  const ok = ms !== null;
  const slow = ok && ms > b.cold * SLOW_FACTOR;
  record(key, title, { ok, slow, ms, baseline: b,
    detail: !ok ? `nothing showed within ${TAB_CAP / 1000} s` : slow ? `slow: ${ms} ms vs ${b.cold} ms map` : `${ms} ms vs ${b.cold} ms map`,
    shot: (!ok || slow) ? await shot(p, key) : null });
  await p.context().close();
}

// ---- main ------------------------------------------------------------------
function findRenameTarget() {
  const rows = H.supaCal(`client=eq.${TEST_SLUG}&status=neq.Archived&video_deliverable_id=not.is.null&select=id,name,video_deliverable_id&order=id`) || [];
  return (async () => {
    for (const r of rows) {
      const q = await fetch(`${SUPA}/rest/v1/deliverables?id=eq.${r.video_deliverable_id}&select=title,card_id,linear_issue_uuid`, { headers: { apikey: KEY, authorization: 'Bearer ' + KEY } });
      const d = (await q.json())[0];
      if (d && d.card_id === r.id && !d.linear_issue_uuid && d.title && d.title.includes(r.name) && !/ · dawn$/.test(r.name))
        return { id: r.id, name: r.name, deliverableId: r.video_deliverable_id, originalTitle: d.title };
    }
    return null;
  })();
}

function report(started, calMs) {
  const fails = results.filter(r => !r.ok);
  const slows = results.filter(r => r.ok && r.slow);
  const L = [];
  L.push(`# Dawn check — ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  L.push('');
  L.push(fails.length ? `**${fails.length} of ${results.length} checks failed.**` : `**All ${results.length} checks passed.**` + (slows.length ? ` ${slows.length} ran slow.` : ''));
  if (violations.length) L.push(`\n⛔ Blocked ${violations.length} write(s) aimed at a client other than the test client.`);
  L.push('');
  for (const r of results) {
    const mark = !r.ok ? '❌' : r.slow ? '🐢' : '✅';
    L.push(`- ${mark} **${r.title}** — ${r.detail}` + (r.shot ? ` (screenshot: \`${path.relative(path.join(__dirname, '..', '..'), r.shot).replace(/\\/g, '/')}\`)` : ''));
  }
  L.push('');
  L.push('## Timings vs the speed map (2026-09-23)');
  L.push('');
  L.push('| check | today | map cold | map warm |');
  L.push('|---|---|---|---|');
  for (const k of ['workload', 'synclinear', 'analytics']) {
    const r = results.find(x => x.key === k);
    if (!r) { L.push(`| ${k} | not reached | ${BASELINE[k].cold.toLocaleString('en-US')} ms | ${BASELINE[k].warm.toLocaleString('en-US')} ms |`); continue; }
    L.push(`| ${r.title} | ${r.ms == null ? 'never' : r.ms.toLocaleString('en-US') + ' ms'} | ${BASELINE[k].cold.toLocaleString('en-US')} ms | ${BASELINE[k].warm.toLocaleString('en-US')} ms |`);
  }
  L.push(`| Staff calendar, first card | ${calMs == null ? 'never' : calMs.toLocaleString('en-US') + ' ms'} | ${BASELINE.calendar.cold.toLocaleString('en-US')} ms | ${BASELINE.calendar.warm.toLocaleString('en-US')} ms |`);
  const others = results.filter(r => ['client-approve', 'client-request', 'staff-save', 'rename'].includes(r.key) && r.ms != null);
  if (others.length) L.push('\nNo map numbers exist yet for the write flows; today’s: ' + others.map(r => `${r.title.toLowerCase()} ${r.ms.toLocaleString('en-US')} ms`).join(', ') + '.');
  L.push('');
  L.push(`Test client only. Seeds archived and verified, rename restored: ${results.find(r => r.key === 'cleanup').ok ? 'yes' : '**NO — see cleanup line**'}.`);
  const md = L.join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, 'DAWN_REPORT.md'), md);
  fs.writeFileSync(path.join(OUT, 'dawn.json'), JSON.stringify({ started, results, violations }, null, 2));
  return md;
}

(async () => {
  if (!String(process.env.SYNCVIEW_STAFF_KEY || '').trim()) {
    console.error('dawn-check: SYNCVIEW_STAFF_KEY is not set (staff writes and the client link need it).');
    process.exit(2);
  }
  const started = Date.now();
  const server = process.env.DAWN_NO_SERVER === '1' ? null
    : spawn(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'http.server', '8000'], { cwd: path.join(__dirname, '..', '..'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  H.resetLinearCalls();
  const seeds = {
    approve: { id: `p_dawn_a_${TS}`, name: `Dawn approve ${TS}` },
    request: { id: `p_dawn_r_${TS}`, name: `Dawn request ${TS}` },
    save:    { id: `p_dawn_s_${TS}`, name: `Dawn save ${TS}` },
  };
  const renameTarget = await findRenameTarget().catch(() => null);
  const browser = await launch();
  let calMs = null;
  try {
    seedReviewCard(seeds.approve.id, seeds.approve.name);
    seedReviewCard(seeds.request.id, seeds.request.name);
    seedReviewCard(seeds.save.id, seeds.save.name, 'In Progress');
    for (const s of Object.values(seeds)) await H.pollRow(() => rowCal(s.id, 'id'), r => !!r.id, POLL);
    await clientFlows(browser, seeds);
    calMs = await staffFlows(browser, seeds, renameTarget);
    await timeTab(browser, 'workload', 'Workload opens', '/index.html#workload', () => !!document.querySelector('.workload-plan-item-content'));
    await timeTab(browser, 'synclinear', 'SyncLinear first rows', '/index.html?prod=1', () => !!document.querySelector('#prodRoot .prod-row'));
    await timeTab(browser, 'analytics', 'Analytics first numbers', '/index.html#home',
      () => [...document.querySelectorAll('.cell-inner')].some(c => !c.querySelector('.sv-skeleton') && /\d/.test(c.textContent)));
  } catch (e) {
    record('harness', 'Harness ran to the end', { ok: false, detail: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 400) });
  } finally {
    const bad = [];
    for (const s of Object.values(seeds)) if (!archiveCalSafe(s.id)) bad.push(s.id);
    let rr = { ok: true };
    if (renameTarget) { try { rr = await restoreRename(browser, renameTarget); } catch (e) { rr = { ok: false, err: String(e.message || e) }; } }
    const linearLeak = H.linearCalls().filter(c => /api\.linear\.app/.test(JSON.stringify(c))).length;
    try { await browser.close(); } catch {}
    if (server) server.kill();
    record('cleanup', 'Everything put back', { ok: !bad.length && rr.ok && !violations.length && !linearLeak,
      detail: `seeds archived ${Object.keys(seeds).length - bad.length}/${Object.keys(seeds).length}` +
        (renameTarget ? `, rename restored on card=${rr.card !== false} sub-issue=${rr.sub !== false}` : '') +
        (violations.length ? `, ${violations.length} other-client write(s) blocked` : '') + (linearLeak ? `, ${linearLeak} Linear call(s)` : '') });
  }
  const md = report(started, calMs);
  console.log(md);
  process.exit(results.some(r => !r.ok) ? 1 : 0);
})();
