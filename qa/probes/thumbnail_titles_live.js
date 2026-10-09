// thumbnail_titles_live.js -- ON DEMAND, not nightly: it creates real work items on the TEST client.
// Live proof of the thumbnail titles background step (OPEN_REPAIRS 377,
// migrations/2026-10-09-thumbnail-titles.sql) through the real page:
//   1. the Calendar "..." menu has "Thumbnail title prompt" right under "Caption prompt"; the editor
//      opens with the seeded default; a custom edit saves, reopens as custom, and Reset + Save goes
//      back to the default (desktop and iPhone pictures);
//   2. a real Create Post (video + thumbnail) returns as fast as before: the step runs later, on the
//      timer, and fills the empty thumbnail description (on the test client, whose filming plan is a
//      one-word placeholder, that is the "Needs info: ... filming plan is empty" line);
//   3. a second write into that description is refused: text already there is never overwritten;
//   4. a Sample made the same way is never touched;
//   5. the Production tab shows the line in the item's description (desktop and iPhone pictures).
// Needs the switch thumbnail_titles to list the test client, SYNCVIEW_ROLE_KEY (or SYNCVIEW_STAFF_KEY)
// + SYNCVIEW_ACTOR, and SUPABASE_SERVICE_ROLE_KEY to read the descriptions back (the browser key
// cannot read them). Cleans up: cancels every work item it made and archives every card.
// TEST client only. Screenshots go to TT_SHOTS. Run: node qa/run-probes.js thumbnail_titles_live
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./ot4_lib.js');
const L = require('../sxr_courier_lib.js');
const { TEST_CLIENT } = require('../test-client-entry.js');

const TEST = TEST_CLIENT.slug;
const TS = Date.now();
const SHOTS = process.env.TT_SHOTS || path.join(__dirname, '..', '..', 'docs', 'syncview-design', 'mockups', 'thumbnail-titles', 'live');
fs.mkdirSync(SHOTS, { recursive: true });
const res = [];
const ok = (c, m, x) => { res.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  [' + String(x).slice(0, 220) + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REAL = String(process.env.SYNCVIEW_ROLE_KEY || process.env.SYNCVIEW_STAFF_KEY || '').trim();
const ACTOR = String(process.env.SYNCVIEW_ACTOR || '').trim();
const SERVICE = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const IPHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function staffPage(browser, route, opts) {
  const p = await L.open(browser, '/qa/dawn/blank.html', opts);
  await p.context().route(u => u.toString().startsWith(L.SUPA + '/functions/v1/'), r => {
    const h = r.request().headers();
    if (!h['x-syncview-key']) return r.fallback();
    return r.fallback({ headers: Object.assign({}, h, { 'x-syncview-key': REAL }, ACTOR ? { 'x-syncview-actor': ACTOR } : {}) });
  });
  await p.goto(L.ORIGIN + route, { waitUntil: 'domcontentloaded' });
  return p;
}
async function svc(pathAndQuery, init) {
  const r = await fetch(`${L.SUPA}/rest/v1/${pathAndQuery}`, Object.assign({}, init, {
    headers: Object.assign({ apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' }, (init && init.headers) || {}),
  }));
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { return text; }
}
const deliverable = async id => ((await svc(`deliverables?id=eq.${encodeURIComponent(id)}&client_slug=eq.${TEST}&select=id,brief,status,origin,kind,updated_at`)) || [])[0] || null;
const queueRow = async id => ((await svc(`thumbnail_title_queue?deliverable_id=eq.${encodeURIComponent(id)}&select=state,outcome,reason,attempts`)) || [])[0] || null;
async function pollUntil(fn, pred, ms, step = 3000) { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (pred(v)) return v; await sleep(step); } return null; }
async function shot(page, name) {
  await page.addStyleTag({ content: 'img, video, canvas, iframe, [style*="background-image"] { visibility: hidden !important; background-image: none !important; }' }).catch(() => {});
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}
async function openCalendar(browser, opts) {
  const p = await staffPage(browser, `/index.html?v2debug=1#calendar/${TEST}`, opts);
  await p.waitForFunction(() => typeof calState === 'object' && !!calState.client, null, { timeout: 60000 }).catch(() => {});
  await p.waitForSelector('.cal-kebab-wrap button.cal-kebab', { state: 'visible', timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(8000);
  return p;
}
async function openEditor(p) {
  await p.click('.cal-kebab-wrap button.cal-kebab', { timeout: 60000 });
  await p.waitForSelector('#calKebabMenu:not([hidden])', { timeout: 10000 });
  const items = await p.$$eval('#calKebabMenu .cal-kebab-item', els => els.map(e => e.textContent.trim()));
  const ci = items.indexOf('Caption prompt'), ti = items.indexOf('Thumbnail title prompt');
  await p.click('#calKebabMenu .cal-kebab-item:has-text("Thumbnail title prompt")');
  await p.waitForSelector('#calPromptTA', { timeout: 30000 });
  return { ci, ti };
}
async function makePost(p, surface, name) {
  await p.evaluate(([n, s, surf]) => _calOpenNativePost(n, s, surf), [TEST_CLIENT.name, TEST, surface]);
  await p.waitForSelector('#calNativePostCreate', { timeout: 20000 });
  const both = p.locator('input[name=calNativeModeChoice][value=both]');
  if (await both.count()) await both.check();
  await p.locator('#calNativePostNames input').first().fill(name);
  const bn = p.locator('#calNativeBatchName'); if (await bn.count()) await bn.fill(`Thumbnail titles probe batch ${TS}`);
  const t0 = Date.now();
  await p.click('#calNativePostCreate');
  await p.waitForFunction(() => !document.getElementById('calNativePostOverlay'), null, { timeout: 60000 }).catch(() => {});
  return Date.now() - t0;
}
async function cancelItem(browser, id) {
  const p = await staffPage(browser, '/index.html?prod=1#production');
  await p.waitForFunction(i => typeof _prodIssue === 'function' && !!_prodIssue(i), id, { timeout: 90000 }).catch(() => {});
  await p.evaluate(i => _prodRunPickerWrite('status', [i], 'canceled'), id).catch(() => {});
  const d = await pollUntil(async () => (await deliverable(id) || {}).status, s => s === 'canceled', 30000, 1500);
  await p.context().close();
  return d === 'canceled';
}

(async () => {
  if (!REAL || !ACTOR || !SERVICE) { console.log('FAIL needs SYNCVIEW_ROLE_KEY/SYNCVIEW_STAFF_KEY, SYNCVIEW_ACTOR and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
  const flag = ((await svc('syncview_runtime_flags?key=eq.thumbnail_titles&select=value')) || [])[0];
  const clients = (flag && flag.value && flag.value.clients) || [];
  ok(clients.length === 1 && clients[0] === TEST, 'the switch lists the test client only', JSON.stringify(clients));
  if (!(clients.length === 1 && clients[0] === TEST)) process.exit(1);

  const browser = await H.launch();
  const made = { cards: [], sxrCards: [], items: [] };
  try {
    // 1. The editor, desktop.
    const p = await openCalendar(browser);
    const where = await openEditor(p);
    ok(where.ti === where.ci + 1, 'the menu item sits right under "Caption prompt"', JSON.stringify(where));
    const banner = await p.$eval('.cal-prompt-banner', e => e.className + ' | ' + e.innerText);
    const initial = await p.$eval('#calPromptTA', e => e.value);
    ok(/is-default/.test(banner) && initial.startsWith('You write short, punchy reel titles.'), 'it opens on the seeded default (the n8n instruction first)', banner.slice(0, 120));
    await shot(p, 'desktop-1-editor-default');
    await p.fill('#calPromptTA', initial + '\n- Probe edit ' + TS);
    await p.click('#calPromptSaveBtn');
    await p.waitForFunction(() => !document.getElementById('calPromptOverlay').classList.contains('open'), null, { timeout: 30000 });
    await openEditor(p);
    const custom = await p.$eval('.cal-prompt-banner', e => e.className);
    const saved = await p.$eval('#calPromptTA', e => e.value);
    ok(/is-custom/.test(custom) && saved.endsWith('Probe edit ' + TS), 'a custom edit saves and reopens as custom');
    await shot(p, 'desktop-2-editor-custom');
    await p.click('.cal-prompt-btn:has-text("Reset to default")');
    await p.click('#calPromptSaveBtn');
    await p.waitForFunction(() => !document.getElementById('calPromptOverlay').classList.contains('open'), null, { timeout: 30000 });
    const row = ((await svc(`thumbnail_title_prompts?client_slug=eq.${TEST}&select=prompt,default_prompt`)) || [])[0] || {};
    ok(row.prompt === '' && (row.default_prompt || '').startsWith('You write short'), 'Reset to default + Save stores "use the default" again');

    // 2. A real Calendar post and a real Sample.
    const calName = `Thumbnail titles probe ${TS}`;
    const ms = await makePost(p, 'calendar', calName);
    ok(ms < 20000, `Create Post returned in ${ms} ms (the title step is not in this path)`);
    const card = await pollUntil(async () => (L.supaCal(`client=eq.${TEST}&name=like.*${encodeURIComponent(calName)}*&select=id,video_deliverable_id,graphic_deliverable_id`) || [])[0], r => r && r.graphic_deliverable_id, 90000);
    ok(!!card, 'the post carries a thumbnail work item', card && card.graphic_deliverable_id);
    if (card) { made.cards.push(card.id); made.items.push(card.video_deliverable_id, card.graphic_deliverable_id); }
    if (await p.$('#confirmOverlay.active #confirmYes')) await p.click('#confirmOverlay.active #confirmYes').catch(() => {});
    await p.context().close();

    const sp = await staffPage(browser, `/index.html?sxr=1&v2debug=1#sample-reviews/${TEST}`);
    await sp.waitForFunction(() => window.sxrV2Status && window.sxrV2Status().ready, null, { timeout: 60000 }).catch(() => {});
    await sp.waitForTimeout(2500);
    const sxrName = `Thumbnail titles probe sample ${TS}`;
    await makePost(sp, 'sxr', sxrName);
    const sxrCard = await pollUntil(async () => (L.supa(`client=eq.${TEST}&name=like.*${encodeURIComponent(sxrName)}*&select=id,video_deliverable_id,graphic_deliverable_id`) || [])[0], r => r && r.graphic_deliverable_id, 90000);
    if (sxrCard) { made.sxrCards.push(sxrCard.id); made.items.push(sxrCard.video_deliverable_id, sxrCard.graphic_deliverable_id); }
    ok(!!sxrCard, 'a Sample with a thumbnail was made the same way', sxrCard && sxrCard.graphic_deliverable_id);
    await sp.context().close();

    if (card) {
      const gid = card.graphic_deliverable_id;
      const first = await deliverable(gid);
      ok(first && first.origin === 'calendar' && first.kind === 'thumbnail', 'the calendar thumbnail is origin calendar');
      const filled = await pollUntil(() => deliverable(gid), d => d && String(d.brief || '').trim(), 240000, 5000);
      ok(!!filled, 'the timer filled the empty description within 4 minutes');
      ok(filled && /^Needs info: the client's filming plan is empty/.test(filled.brief), 'the test client\'s placeholder plan gives the clear one-line "Needs info" text', filled && filled.brief);
      const q = await queueRow(gid);
      ok(q && q.state === 'needs_info' && q.outcome === 'plan_empty' && q.reason === 'new', 'the queue row says needs_info / plan_empty / new', JSON.stringify(q));
      const vid = await deliverable(card.video_deliverable_id);
      ok(vid && !String(vid.brief || '').startsWith('Needs info') && !(await queueRow(card.video_deliverable_id)), 'the video item is not touched');

      // 3. Never over a description that has text.
      const second = await svc('rpc/thumbnail_title_apply', { method: 'POST', body: JSON.stringify({ p_deliverable_id: gid, p_text: 'SHOULD NOT LAND', p_state: 'written', p_outcome: 'probe' }) });
      const after = await deliverable(gid);
      ok(second === 'skipped_human' && after.brief === filled.brief, 'a second write into a filled description is refused (skipped_human)', String(second));

      // 5. Production tab, desktop and iPhone.
      for (const [label, opts] of [['desktop', undefined], ['iphone', IPHONE]]) {
        const pp = await staffPage(browser, `/index.html?prod=1&d=${encodeURIComponent(gid)}#production`, opts);
        const shown = await pp.waitForFunction(() => /Needs info: the client/.test(document.body.innerText), null, { timeout: 90000 }).then(() => true, () => false);
        ok(shown, `${label}: the Production item shows the line in its description`);
        await pp.waitForTimeout(1200);
        await shot(pp, `${label}-3-production-item`);
        await pp.context().close();
      }
    }
    if (sxrCard) {
      await sleep(70000);
      const sg = await deliverable(sxrCard.graphic_deliverable_id);
      ok(sg && sg.origin === 'samples' && !String(sg.brief || '').trim() && !(await queueRow(sxrCard.graphic_deliverable_id)), 'the Sample thumbnail is never queued or written');
    }

    // 1b. The editor on an iPhone.
    const ip = await openCalendar(browser, IPHONE);
    await openEditor(ip).then(() => true, () => false);
    const ipOk = await ip.$('#calPromptTA');
    ok(!!ipOk, 'iphone: the editor opens from the "..." menu');
    await shot(ip, 'iphone-1-editor-default');
    await ip.context().close();
  } catch (e) {
    ok(false, 'raised: ' + String(e && e.message || e).split('\n')[0].slice(0, 200));
  } finally {
    for (const id of made.cards) { try { ok(L.archiveCalSafe(id) !== false, 'cleanup: archived the calendar card'); } catch (e) {} }
    for (const id of made.sxrCards) { try { ok(L.archiveSafe(id) !== false, 'cleanup: archived the sample'); } catch (e) {} }
    for (const id of made.items.filter(Boolean)) ok(await cancelItem(browser, id), 'cleanup: work item canceled');
    await browser.close();
  }
  const failed = res.filter(x => !x).length;
  console.log(`thumbnail_titles_live: ${res.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
