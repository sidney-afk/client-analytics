'use strict';
/*
 * TRIAL REELS IN PRODUCTION'S ASSETS (src/index/245-production-trial-versions.js.part), in a real browser, fully
 * offline. Session Trials, 2026-10-27; plan docs/features/TRIAL_REELS_PLAN.md (decision 6).
 *
 * The page is today's, served by the offline harness (docs/syncview-design/tests/lost-work-lib.js: every backend answer
 * is local, fictional data). The trial-reels function is answered by its own rules (supabase/functions/trial-reels/
 * logic.mjs); production-write's asset read answers the sub-issue's file_url as available. Proves:
 *   - switch off: the video sub-issue's Assets are exactly today's (one "Deliverable file" row);
 *   - switch on: one "Deliverable file · Video X" row per version, A to E in order; the version on the card is today's
 *     row (its Edit is today's attach) marked "on the card"; every other row has its own Edit and its own state, in
 *     Production's words (Available, Permission denied, Not checked, Missing); every column lines up;
 *   - a label shows only where it says something new, and reads at 4.5:1 or more;
 *   - Edit on Video E saves its link through the function (version_link_set), and a link off the providers is refused
 *     with a sentence on the row;
 *   - once the winner is picked: the winner's row is today's row, "winner" and no "on the card", no "lost" labels;
 *   - the graphics sub-issue of the same card keeps today's single row; the phone shows the same rows, no sideways scroll.
 * TRIAL_PROD_SHOTS=<dir> also writes screenshots (fictional data only). TRIAL_PROD_THEME=dark draws them dark.
 */
const fs = require('fs');
const path = require('path');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = l => 'https://f.io/fixture-version-' + l.toLowerCase();
const SHOTS = process.env.TRIAL_PROD_SHOTS || '';
const THEME = process.env.TRIAL_PROD_THEME === 'dark' ? 'dark' : 'light';
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await sleep(300);
  const panel = await page.$('.prod-assets-list');
  if (panel) await panel.screenshot({ path: path.join(SHOTS, name + '-' + THEME + '.png') });
}

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  const vid = S.deliv.find(d => d.id === 'del_vid_1');
  const T = { flag: false, enabled: true, calls: [] };
  const fresh = () => ['A', 'B', 'C', 'D', 'E'].map((l, i) => ({ id: 'v' + l, letter: l, status: ['approved', 'approved', 'change asked', 'dropped', 'waiting'][i],
    frame_url: l === 'E' ? null : LINK(l), revision: 0, updated_at: '2026-10-27T09:00:00.000Z', post_id: 'p_t1' }));
  // What the function's sharing check answers for each version (a fresh link answers available).
  const states = () => Object.fromEntries(T.versions.map(v => [v.letter, !v.frame_url ? { state: 'missing' }
    : ({ B: { state: 'permission_denied', http_status: 403 }, C: { state: 'unavailable' } })[v.letter] || { state: 'available', http_status: 200 }]));
  const mainLink = () => String(vid.file_url || card.asset_url || '');
  const reset = (versions, link) => { T.versions = versions; vid.file_url = link; card.asset_url = link; };

  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
    const u = new URL(route.request().url());
    const raw = u.searchParams.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({ key: k,
      value: k === 'trial_reels_pages' ? (T.flag ? { clients: ['fixtureclient'] } : { clients: ['someotherclient'] })
        : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: ['fixtureclient'] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
  });
  await S.ctx.route('**/functions/v1/trial-reels', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const b = JSON.parse(r.postData() || '{}');
    T.calls.push(b);
    const reply = (obj, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) });
    if (!T.enabled) return reply({ ok: false, error: 'trial_reels_off' }, 409);
    if (T.down && b.action === 'read') return reply({ ok: false, error: 'versions_unreadable' }, 503);
    const shape = () => Object.assign({ enabled: true, winner_letter: (T.versions.find(v => v.status === 'winner') || {}).letter || null },
      L.readShape(T.versions, { client: false, mainLink: mainLink(), cardStatus: card.video_status }));
    if (b.action === 'list') return reply({ ok: true, cards: { p_t1: shape() } });
    if (b.action === 'read') {
      if (b.post_id !== 'p_t1') return reply({ ok: false, error: 'card_not_found' }, 404);
      return reply(Object.assign({ ok: true, video_deliverable_id: vid.id }, shape(), b.probe === true ? { link_states: states() } : {}));
    }
    if (b.action === 'version_link_set') {
      const res = L.linkPatch(T.versions, b.letter, b.link, mainLink());
      if (res.error) return reply({ ok: false, error: res.error }, res.error === 'attach_first' ? 409 : 400);
      if (res.patch) Object.assign(T.versions.find(v => v.letter === b.letter), res.patch);
      return reply(Object.assign({ ok: true }, shape()));
    }
    return reply({ ok: false, error: 'unknown_action' }, 400);
  });
  // The sub-issue's own asset read: today's Deliverable file is its file_url, and it opens.
  await S.ctx.route('**/functions/v1/production-write{,?*}', async route => {
    const r = route.request();
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (r.method() !== 'POST' || b.action !== 'asset_access_read') return route.fallback();
    const file = b.id === vid.id ? mainLink() : null;
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, complete: true, assets: [
      { slot: 'filming_plan', state: 'missing', url: null }, { slot: 'raw_footage', state: 'missing', url: null }, { slot: 'delivery_folder', state: 'missing', url: null },
      { slot: 'deliverable_file', state: file ? 'available' : 'missing', url: file, http_status: file ? 200 : undefined }] }) });
  });

  const open = async (w, h, id) => {
    const page = await S.newPage();
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, THEME);
    await S.openProduction(page);
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), THEME);
    await page.evaluate(x => _prodOpenDeliverable(x), id || 'del_vid_1');
    await sleep(2000);   // the asset read and the versions read land, and the panel repaints
    return page;
  };
  const rows = page => page.evaluate(() => [...document.querySelectorAll('.prod-assets-list .prod-asset-row')].filter(n => n.offsetParent).map(n => ({
    label: (n.querySelector('.prod-asset-label') || {}).textContent || '',
    value: ((n.querySelector('.prod-asset-value') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
    state: ((n.querySelector('.prod-asset-state') || {}).textContent || '').trim(),
    today: n.getAttribute('data-prod-asset-slot') === 'deliverable_file',
    trial: n.classList.contains('trl-prod-v'),
    edit: !!n.querySelector('.prod-asset-edit'),
  })));
  // The colour behind an element, every background up to the page composited, and its text's contrast against it.
  const contrast = page => page.evaluate(() => {
    const rgba = c => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    const over = (t, u) => { const a = t[3] + u[3] * (1 - t[3]); return a ? [0, 1, 2].map(i => (t[i] * t[3] + u[i] * u[3] * (1 - t[3])) / a).concat(a) : [0, 0, 0, 0]; };
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    return [...document.querySelectorAll('.trl-prod-v .trl-lab, .trl-prod-v .trl-oncard, .trl-prod-v .prod-asset-label')].filter(n => n.offsetParent).map(el => {
      const layers = []; for (let n = el; n; n = n.parentElement) layers.push(rgba(getComputedStyle(n).backgroundColor));
      const bg = layers.reverse().reduce((acc, c) => over(c, acc), [255, 255, 255, 1]);
      const fg = over(rgba(getComputedStyle(el).color), bg);
      const a = lum(fg), b = lum(bg);
      return { text: el.textContent.trim(), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
  });

  try {
    // Switch off for this client: today's Assets.
    reset(fresh(), LINK('A'));
    let page = await open(1440, 900);
    let r = await rows(page);
    ok(r.some(x => x.today && x.label === 'Deliverable file') && !r.some(x => x.trial) && !T.calls.length, 'switch off: one "Deliverable file" row, as today, and the function is never asked');
    await page.close();

    // Switch on: one row per version.
    T.flag = true; T.calls = [];
    page = await open(1440, 900);
    r = await rows(page);
    const vr = r.filter(x => x.trial);
    ok(vr.map(x => x.label).join('|') === ['A', 'B', 'C', 'D', 'E'].map(l => 'Deliverable file · Video ' + l).join('|'), 'one "Deliverable file · Video X" row per version, A to E in order');
    ok(vr[0].today && vr.filter(x => x.today).length === 1 && /on the card/.test(vr[0].value) && vr.slice(1).every(x => !/on the card/.test(x.value)), "Video A's row is today's row (today's Edit, today's check), marked on the card");
    ok(vr.every(x => x.edit), 'every version row has an Edit');
    ok(vr[1].state === 'Permission denied' && vr[2].state === 'Not checked' && vr[3].state === 'Available' && vr[4].state === 'Missing' && /Not provided/.test(vr[4].value),
      "each other version's state in Production's own words: Permission denied, Not checked (the check could not look), Available, Missing");
    ok(/approved/.test(vr[0].value) && /change asked/.test(vr[2].value) && /dropped/.test(vr[3].value) && /waiting/.test(vr[4].value), 'with a mixed review each row says where it stands');
    ok(T.calls.some(c => c.action === 'read' && c.probe === true && c.post_id === 'p_t1'), "the read names the sub-issue's card and asks for the link states");
    const lefts = await page.evaluate(() => ['.prod-asset-value', '.prod-asset-state', '.prod-asset-edit'].map(sel => [...document.querySelectorAll('.trl-prod-v ' + sel)].map(n => Math.round(n.getBoundingClientRect().left))));
    ok(lefts.every(col => col.length === 5 && new Set(col).size === 1), 'the links, the states and the Edit buttons line up down the version rows: ' + JSON.stringify(lefts));
    const cr = await contrast(page);
    ok(cr.length >= 9 && cr.every(c => c.ratio >= 4.5), 'every label the trial adds reads at 4.5:1 or more (' + THEME + '): ' + cr.map(c => c.text + ' ' + c.ratio.toFixed(1)).join(', '));
    await shot(page, 'prod-review');

    // Edit Video E: its link goes to the function.
    await page.click('.trl-prod-v[data-trl-slot="E"] .prod-asset-edit');
    await sleep(300);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.matches('[data-trl-input]')), 'Edit opens a link field under the row, focused');
    await page.fill('[data-trl-input]', 'https://example.com/fixture-e');
    await page.click('[data-trl-editor="E"] .prod-assets-save');
    await sleep(800);
    ok(/Frame\.io, Google Drive or Dropbox/.test(await page.evaluate(() => ((document.querySelector('[data-trl-editor="E"] .prod-assets-error') || {}).textContent || ''))) && !T.versions[4].frame_url,
      'a link off the providers is refused, with a sentence on the row, and nothing is saved');
    await page.fill('[data-trl-input]', LINK('E'));
    await page.click('[data-trl-editor="E"] .prod-assets-save');
    await sleep(1500);
    r = await rows(page);
    const saved = T.calls.filter(c => c.action === 'version_link_set');
    ok(saved.length === 2 && saved[1].letter === 'E' && saved[1].link === LINK('E') && saved[1].post_id === 'p_t1' && T.versions[4].frame_url === LINK('E'), "Video E's link saved through the function's version_link_set");
    const rowE = r.find(x => x.label === 'Deliverable file · Video E');
    ok(!(await page.$('[data-trl-editor]')) && /^Open link/.test(rowE.value) && rowE.state === 'Available'
      && await page.evaluate(l => !!document.querySelector('.trl-prod-v[data-trl-slot="E"] a[href="' + l + '"]'), LINK('E')), 'the field closes and the row opens the new link, checked again');
    await page.close();

    // A read that fails for any reason but "no versions here" never hides the versions: it says so, with Retry.
    T.down = true;
    page = await open(1440, 900);
    r = await rows(page);
    const errText = await page.evaluate(() => ((document.querySelector('[data-trl-read-error]') || {}).innerText || '').replace(/\s+/g, ' ').trim());
    ok(/Could not be read/.test(errText) && /Retry/.test(errText) && r.some(x => x.today), 'a failed versions read: today\'s row and "Could not be read" with Retry, never a silent fallback (' + errText + ')');
    T.down = false;
    await page.click('[data-trl-read-error] button');
    await sleep(1500);
    r = await rows(page);
    ok(r.filter(x => x.trial && /· Video/.test(x.label)).length === 5 && !(await page.$('[data-trl-read-error]')), 'Retry reads again and draws the five rows');
    T.down = true;
    await page.evaluate(() => svTrialProdRetry('del_vid_1'));
    await sleep(1500);
    r = await rows(page);
    ok(r.filter(x => x.trial && /· Video/.test(x.label)).length === 5 && /Could not be refreshed/.test(await page.evaluate(() => ((document.querySelector('[data-trl-read-error]') || {}).innerText || ''))),
      'a refresh that fails keeps the rows already drawn and says so');
    T.down = false;
    await page.close();

    // The graphics sub-issue of the same card: today's single row.
    page = await open(1440, 900, 'del_gra_1');
    r = await rows(page);
    ok(!r.some(x => x.trial) && !r.some(x => /Video A/.test(x.label)), "the card's graphics sub-issue keeps today's row");
    await page.close();

    // Once the winner is picked.
    reset(fresh().map(v => Object.assign(v, { status: v.letter === 'C' ? 'winner' : v.letter === 'D' ? 'dropped' : 'lost' })), LINK('C'));
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
      page = await open(w, h);
      r = (await rows(page)).filter(x => x.trial);
      ok(r.map(x => x.label.slice(-1)).join('') === 'ABCDE' && r[2].today && /winner/.test(r[2].value) && !r.some(x => /on the card/.test(x.value)),
        `${label}: the winner's row is today's row, says "winner" and not "on the card"`);
      ok(!r.some(x => /lost/.test(x.value)) && /dropped/.test(r[3].value), `${label}: no "lost" labels once there is a winner; "dropped" stays`);
      if (label === 'phone') {
        ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone: no sideways scroll');
        await shot(page, 'prod-winner-390');
      } else {
        await shot(page, 'prod-winner');
      }
      await page.close();
    }
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  console.log(`trial-reels-production-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
