// arx_restore_live.js -- ON DEMAND, not nightly: it creates real work items on the TEST client.
// Live proof (docs/plans/2026-09-29-calendar-unarchive.md) that a card or sample archived
// through the real UI comes back through the new More menu exactly as it was:
//   1. make a card (then a sample) through the real Create Post, with a video and a
//      thumbnail work item;
//   2. read the card row and both work items;
//   3. archive it through the real Archive button (the app parks the work items in Backlog);
//   4. open More > Archived cards (Archived samples), see it, press Restore, confirm;
//   5. read everything back: the card is live again and unchanged except status and clock,
//      and each work item is back on the exact status it had before the archive.
// Cleans up after itself: cancels every work item it made and archives every card.
// TEST client only. Screenshots go to ARX_SHOTS (default: a folder beside the mock-up).
// Run: node qa/run-probes.js arx_restore_live      (SXR_COURIER=0 outside this sandbox)
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./ot4_lib.js');
const L = require('../sxr_courier_lib.js');
const { TEST_CLIENT } = require('../test-client-entry.js');

const TEST = TEST_CLIENT.slug;
const TS = Date.now();
const SHOTS = process.env.ARX_SHOTS || path.join(__dirname, '..', '..', 'docs', 'syncview-design', 'mockups', 'calendar-unarchive', 'live');
fs.mkdirSync(SHOTS, { recursive: true });
const res = [];
const ok = (c, m, x) => { res.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  [' + String(x).slice(0, 200) + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anon = { apikey: L.KEY, Authorization: 'Bearer ' + L.KEY };
// The page holds the harness's stand-in staff key; the real one is swapped in on the wire, as the
// other on-demand probes do, so it never enters the page.
const REAL = String(process.env.SYNCVIEW_ROLE_KEY || process.env.SYNCVIEW_STAFF_KEY || '').trim();
const ACTOR = String(process.env.SYNCVIEW_ACTOR || '').trim();
async function staffPage(browser, route) {
  const p = await L.open(browser, '/qa/dawn/blank.html');
  await p.context().route(u => u.toString().startsWith(L.SUPA + '/functions/v1/'), r => {
    const h = r.request().headers();
    if (!h['x-syncview-key']) return r.fallback();
    return r.fallback({ headers: Object.assign({}, h, { 'x-syncview-key': REAL }, ACTOR ? { 'x-syncview-actor': ACTOR } : {}) });
  });
  await p.goto(L.ORIGIN + route, { waitUntil: 'domcontentloaded' });
  return p;
}
function rest(table, qs) {
  const out = L.filelessHttpRequest('GET', `${L.SUPA}/rest/v1/${table}?${qs}`, anon).body.toString('utf8');
  try { return JSON.parse(out); } catch (e) { return []; }
}
const item = id => (rest('production_deliverables_browser_v1', `id=eq.${encodeURIComponent(id)}&select=id,status,updated_at,team,card_id`)[0] || null);
const itemEvents = id => rest('deliverable_events', `deliverable_id=eq.${encodeURIComponent(id)}&action=eq.status_change&order=ts.asc&select=ts,from_status,to_status,payload`);
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); }
async function pollUntil(fn, pred, ms) { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (pred(v)) return v; await sleep(1500); } return null; }

const SURFACES = {
  cal: {
    label: 'Calendar', surface: 'calendar', table: 'calendar_posts', kebab: '#calKebabMenu', wrapBtn: '.cal-kebab-wrap button.cal-kebab',
    open: async browser => { const p = await staffPage(browser, `/index.html?v2debug=1#calendar/${TEST}`); await p.waitForFunction(() => typeof calState === 'object' && !!calState.client, null, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(1500); return p; },
    read: id => (L.supaCal(`id=eq.${encodeURIComponent(id)}&client=eq.${TEST}&select=*`) || [])[0] || null,
    find: name => (L.supaCal(`client=eq.${TEST}&name=like.*${encodeURIComponent(name)}*&select=id`) || [])[0] || null,
    archive: async (p, id) => { await p.evaluate(i => archiveCalPost(i), id); await p.waitForSelector('#confirmYes', { timeout: 10000 }); await p.click('#confirmYes'); },
    archiveSafe: id => L.archiveCalSafe(id),
    create: async (p, name) => {
      await p.evaluate(([n, s]) => _calOpenNativePost(n, s, 'calendar'), [TEST_CLIENT.name, TEST]);
    },
    nounCaps: 'card', archivedTitle: 'Archived cards'
  },
  sxr: {
    label: 'Samples', surface: 'sxr', table: 'sample_reviews', kebab: '#sxrKebabMenu', wrapBtn: '.cal-kebab-wrap button.cal-kebab',
    open: async browser => { const p = await staffPage(browser, `/index.html?sxr=1&v2debug=1#sample-reviews/${TEST}`); await p.waitForFunction(() => window.sxrV2Status && window.sxrV2Status().ready, null, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(1500); return p; },
    read: id => (L.supa(`id=eq.${encodeURIComponent(id)}&client=eq.${TEST}&select=*`) || [])[0] || null,
    find: name => (L.supa(`client=eq.${TEST}&name=like.*${encodeURIComponent(name)}*&select=id`) || [])[0] || null,
    archive: async (p, id) => { await p.evaluate(i => archiveSxrCard(i), id); await p.waitForSelector('#confirmYes', { timeout: 10000 }); await p.click('#confirmYes'); },
    archiveSafe: id => L.archiveSafe(id),
    create: async (p, name) => {
      await p.evaluate(([n, s]) => _calOpenNativePost(n, s, 'sxr'), [TEST_CLIENT.name, TEST]);
    },
    nounCaps: 'sample', archivedTitle: 'Archived samples'
  }
};

async function cancelItem(browser, id) {
  const p = await staffPage(browser, '/index.html?prod=1#production');
  await p.waitForFunction(i => typeof _prodIssue === 'function' && !!_prodIssue(i), id, { timeout: 90000 }).catch(() => {});
  await p.evaluate(i => _prodRunPickerWrite('status', [i], 'canceled'), id).catch(() => {});
  const d = await pollUntil(async () => (item(id) || {}).status, s => s === 'canceled', 30000);
  await p.context().close();
  return d === 'canceled';
}

async function runSurface(browser, key) {
  const S = SURFACES[key];
  const name = `Restore probe ${key} ${TS}`;
  const p = await S.open(browser);
  await p.setViewportSize({ width: 1280, height: 860 });
  let id = null, vid = null, gid = null;
  try {
    // 1. Make one through the real Create Post (video + thumbnail).
    await p.waitForFunction(() => typeof _calOpenNativePost === 'function', null, { timeout: 60000 });
    await p.waitForTimeout(4000);
    await S.create(p, name);
    await p.waitForSelector('#calNativePostCreate', { timeout: 20000 });
    const both = p.locator('input[name=calNativeModeChoice][value=both]');
    if (await both.count()) await both.check();
    await p.locator('#calNativePostNames input').first().fill(name);
    const bn = p.locator('#calNativeBatchName'); if (await bn.count()) await bn.fill(`Restore probe batch ${TS}`);
    await p.click('#calNativePostCreate');
    await p.waitForFunction(() => !document.getElementById('calNativePostOverlay'), null, { timeout: 60000 }).catch(() => {});
    const found = await pollUntil(async () => S.find(name), r => !!r, 60000);
    ok(!!found, `${S.label}: a test ${S.nounCaps} was made through the real Create Post`, found && found.id);
    if (!found) return;
    id = found.id;
    const settled = await pollUntil(async () => S.read(id), r => r && r.video_deliverable_id && r.graphic_deliverable_id, 60000);
    vid = settled && settled.video_deliverable_id; gid = settled && settled.graphic_deliverable_id;
    ok(!!vid && !!gid, `${S.label}: it carries a video and a thumbnail work item`, `${vid} ${gid}`);
    if (!vid || !gid) return;
    await sleep(3000);
    // 2. Snapshot before.
    const beforeRow = S.read(id);
    const beforeItems = { v: item(vid), g: item(gid) };
    ok(beforeRow && beforeRow.status !== 'Archived' && beforeItems.v && beforeItems.g, `${S.label}: before the archive: card "${beforeRow && beforeRow.status}", video "${beforeItems.v && beforeItems.v.status}", thumbnail "${beforeItems.g && beforeItems.g.status}"`);
    // Dismiss the app's "Post created" pop-up so the picture shows the card itself.
    if (await p.$('#confirmOverlay.active #confirmYes')) await p.click('#confirmOverlay.active #confirmYes').catch(() => {});
    await p.evaluate(i => { const el = document.querySelector('[data-pid="' + i + '"]'); if (el) el.scrollIntoView({ inline: 'center', block: 'center' }); }, id).catch(() => {});
    await p.waitForTimeout(1500);
    await shot(p, `${key}-1-before-archive`);
    // 3. Archive through the real button; the app parks the work items.
    await S.archive(p, id);
    const archived = await pollUntil(async () => S.read(id), r => r && r.status === 'Archived', 45000);
    ok(!!archived, `${S.label}: archived through the real button`);
    const parked = await pollUntil(async () => [item(vid), item(gid)], a => a[0] && a[1] && a[0].status === 'backlog' && a[1].status === 'backlog', 60000);
    ok(!!parked, `${S.label}: the app parked both work items in Backlog`, parked && parked.map(x => x.status).join(','));
    await sleep(1500);
    await shot(p, `${key}-2-after-archive-card-gone`);
    // 4. The new menu.
    await p.click(S.wrapBtn);
    await p.waitForSelector(`${S.kebab} [data-staff-capability="restore-archived"] button`, { state: 'visible', timeout: 5000 });
    await shot(p, `${key}-3-more-menu`);
    await p.click(`${S.kebab} [data-staff-capability="restore-archived"] button`);
    await p.waitForSelector('#arxOverlay .arx-row', { timeout: 30000 });
    const rows = await p.$$eval('#arxOverlay .arx-row-name', els => els.map(e => e.textContent.trim()));
    // The app titles a created card "Video 1 - <name>"; match on the unique part.
    const mine = r => r.includes(name);
    ok(rows.some(mine), `${S.label}: it is in the archived list (${rows.length} rows)`);
    ok(mine(rows[0] || ''), `${S.label}: newest first, so it is on top`);
    await shot(p, `${key}-4-archived-list`);
    await p.click(`#arxOverlay .arx-row:has(.arx-row-name:has-text("${name}")) [data-arx-act="restore"]`);
    await p.waitForSelector('#arxDialog', { timeout: 30000 });
    const confirmText = await p.$eval('#arxDialog', e => e.innerText);
    ok(/Video work item/.test(confirmText) && /work item/.test(confirmText), `${S.label}: the confirm lists the work items and where each goes`, confirmText.replace(/\s+/g, ' '));
    await shot(p, `${key}-5-confirm`);
    const cwBefore = (rest(S.table === 'calendar_posts' ? 'calendar_post_events' : 'sample_review_events', `client=eq.${TEST}&${S.table === 'calendar_posts' ? 'post_id' : 'sample_id'}=eq.${encodeURIComponent(id)}&select=id`) || []).length;
    await p.click('#arxDialog [data-arx="yes"]');
    await p.waitForFunction(() => /Restored/.test((document.getElementById('arxDialogTitle') || {}).textContent || ''), null, { timeout: 60000 });
    const successText = await p.$eval('#arxDialog', e => e.innerText);
    ok(/is back in/.test(successText), `${S.label}: the success message`, successText.replace(/\s+/g, ' '));
    await shot(p, `${key}-6-success`);
    await p.click('#arxDialog [data-arx="yes"]');
    // 5. Read everything back.
    const afterRow = await pollUntil(async () => S.read(id), r => r && r.status !== 'Archived', 45000);
    ok(!!afterRow, `${S.label}: the ${S.nounCaps} is live again (status "${afterRow && afterRow.status}")`);
    if (afterRow) {
      const changed = Object.keys(Object.assign({}, beforeRow, afterRow)).filter(k => JSON.stringify(beforeRow[k]) !== JSON.stringify(afterRow[k]));
      const allowed = ['status', 'updated_at', 'video_status_at', 'graphic_status_at', 'caption_status_at', 'status_at'];
      ok(changed.filter(k => !allowed.includes(k)).length === 0, `${S.label}: nothing else on the ${S.nounCaps} changed`, changed.join(','));
      ok(afterRow.status === beforeRow.status, `${S.label}: overall status is what it was before the archive`, `${beforeRow.status} -> ${afterRow.status}`);
      ok(afterRow.video_deliverable_id === vid && afterRow.graphic_deliverable_id === gid, `${S.label}: work item links are untouched`);
    }
    const back = await pollUntil(async () => [item(vid), item(gid)], a => a[0] && a[1] && a[0].status === beforeItems.v.status && a[1].status === beforeItems.g.status, 60000);
    ok(!!back, `${S.label}: each work item is back on its exact prior status`, `${(item(vid) || {}).status},${(item(gid) || {}).status} vs ${beforeItems.v.status},${beforeItems.g.status}`);
    const evs = itemEvents(vid).filter(e => e.to_status === beforeItems.v.status && e.from_status === 'backlog');
    ok(evs.length >= 1 && String((evs[evs.length - 1].payload || {}).surface) === S.surface, `${S.label}: the move went through the status operation on the ${S.surface} surface`);
    // Close the list so the picture shows the restored card back in place.
    await p.click('#arxOverlay [data-arx-act="close"]').catch(() => {});
    await p.waitForTimeout(3500);
    await p.evaluate(i => { const el = document.querySelector('[data-pid="' + i + '"]'); if (el) el.scrollIntoView({ inline: 'center', block: 'center' }); }, id).catch(() => {});
    await p.waitForTimeout(800);
    const visible = await p.evaluate(i => !!document.querySelector('[data-pid="' + i + '"]'), id);
    ok(visible, `${S.label}: the restored ${S.nounCaps} is back on the page`);
    await shot(p, `${key}-7-after-restore`);
    const errs = L.appErrs ? L.appErrs(p) : [];
    ok(errs.length === 0, `${S.label}: no app errors`, errs.join(' | '));
  } catch (e) {
    ok(false, `${S.label}: raised: ` + String(e && e.message || e).split('\n')[0].slice(0, 200));
    try { await shot(p, `${key}-x-failure`); } catch (e2) {}
  } finally {
    // Clean up: archive the card, cancel the work items.
    try { if (id) ok(S.archiveSafe(id) !== false, `${S.label}: cleanup: archived ${id}`); } catch (e) {}
    for (const w of [vid, gid].filter(Boolean)) ok(await cancelItem(browser, w), `${S.label}: cleanup: work item canceled ${w}`);
    try { await p.context().close(); } catch (e) {}
  }
}

(async () => {
  const browser = await H.launch();
  try {
    await runSurface(browser, 'cal');
    await runSurface(browser, 'sxr');
  } finally {
    await browser.close();
    console.log(`\npass=${res.filter(Boolean).length} fail=${res.filter(x => !x).length}`);
    process.exit(res.every(Boolean) ? 0 : 1);
  }
})();
