'use strict';
/* archived-restore-browser.js -- the More menu flow for archived cards and
 * samples, end to end, fully offline (docs/plans/2026-09-29-calendar-unarchive.md).
 *
 * Drives the real page in a real browser against a synthetic client whose every
 * backend answer is local, and proves, for the Calendar and for Samples:
 *   - the menu item is there for admin and SMM, not for a creative seat, not on
 *     a client link;
 *   - the list shows only archived items from the last 30 days, newest first,
 *     pages by a cursor and reaches older ones with Show older;
 *   - the empty and the error state;
 *   - the confirm dialog lists each work item and where it goes, with the words
 *     the owner approved;
 *   - Restore sends ONE card write with a live status and nothing else on the
 *     card, then moves each work item through the guarded status write with the
 *     expected values, and never touches a table directly;
 *   - a conflict keeps the other person's change; a failed card write changes
 *     nothing; an already-restored card writes nothing; a card that shares a
 *     work item with a live card is blocked and names it;
 *   - the position write happens only on a tie.
 * No request leaves the machine. Fixture names only.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffGate } = require('../../../qa/staff-gate-seed.js');

const root = path.resolve(__dirname, '..', '..', '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const CLIENT = 'Restore Fixture';
const SLUG = 'restorefixture';
const NOW = Date.now();
const ago = (days, ms) => new Date(NOW - days * 86400000 - (ms || 0)).toISOString();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

/* One synthetic world per surface. `kind` is 'cal' or 'sxr'. */
function world(kind) {
  const table = kind === 'sxr' ? 'sample_reviews' : 'calendar_posts';
  const evTable = kind === 'sxr' ? 'sample_review_events' : 'calendar_post_events';
  const evKey = kind === 'sxr' ? 'sample_id' : 'post_id';
  const surface = kind === 'sxr' ? 'sxr' : 'calendar';
  const row = (id, name, over) => Object.assign({
    id, client: SLUG, name, status: 'Archived', order_index: 50, updated_at: ago(2), scheduled_date: kind === 'cal' ? '2026-10-03' : null,
    video_status: 'For SMM Approval', graphic_status: 'Approved', caption_status: 'Approved', comments: [], graphic_comments: [], caption_comments: [],
    video_deliverable_id: '', graphic_deliverable_id: '', linear_issue_id: '', graphic_linear_issue_id: ''
  }, over || {}, { archivedAt: (over && over.updated_at) || ago(2) });
  const rows = [
    row('a1', 'Spring launch teaser', { updated_at: ago(2), video_deliverable_id: 'd-v1', graphic_deliverable_id: 'd-g1', order_index: 7, scheduled_date: kind === 'cal' ? '2026-09-01' : null }),
    row('a2', 'Behind the scenes reel', { updated_at: ago(4), video_deliverable_id: 'd-v2', graphic_deliverable_id: 'd-g2', order_index: 3, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress' }),
    row('a3', 'Customer story part two', { updated_at: ago(5), video_deliverable_id: 'd-v-shared' }),
    row('a4', 'Older weekly tips', { updated_at: ago(45), video_status: 'Approved' })
  ];
  for (let i = 0; i < 27; i++) rows.push(row('f' + String(i).padStart(2, '0'), 'Filler ' + i, { updated_at: ago(10, i * 1000), video_status: 'Approved' }));
  const live = [
    { id: 'l1', client: SLUG, name: 'Live card one', status: 'In Progress', order_index: 3, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', updated_at: ago(1), comments: [], graphic_comments: [], caption_comments: [], video_deliverable_id: 'd-v-shared', scheduled_date: kind === 'cal' ? '2026-10-20' : null }
  ];
  const items = {
    'd-v1': { id: 'd-v1', status: 'backlog', updated_at: ago(2, -5000) },
    'd-g1': { id: 'd-g1', status: 'posted', updated_at: ago(9) },
    'd-v2': { id: 'd-v2', status: 'backlog', updated_at: ago(4, -5000) },
    'd-g2': { id: 'd-g2', status: 'in_progress', updated_at: ago(3) },
    'd-v-shared': { id: 'd-v-shared', status: 'backlog', updated_at: ago(5, -5000) }
  };
  const itemEvents = {
    'd-v1': [{ ts: ago(2, -5000), action: 'status_change', from_status: 'smm_approval', to_status: 'backlog', payload: { surface } }],
    'd-v2': [{ ts: ago(4, -5000), action: 'status_change', from_status: 'backlog', to_status: 'backlog', payload: { surface } }],
    'd-v-shared': [{ ts: ago(5, -5000), action: 'status_change', from_status: 'todo', to_status: 'backlog', payload: { surface } }]
  };
  return { kind, table, evTable, evKey, rows, live, items, itemEvents, writes: [], listReads: [], failList: false, failCardWrite: false, conflictOn: null, restored: new Set() };
}

async function newPage(browser, origin, w, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  const role = (opts && opts.role) || 'admin';
  await seedStaffGate(page);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname; const sp = u.searchParams;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role, member: { id: 'm1', name: 'Browser Staff', role, team: null } });
    if (p === '/functions/v1/client-token-verify') return json({ ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: 'calendar', strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    if (r.method() === 'POST') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      if (p === '/functions/v1/calendar-upsert' || p === '/functions/v1/sample-review-upsert') {
        const rec = { route: p.split('/').pop(), body };
        w.writes.push(rec);
        const patch = body.post || body.sample || {};
        if (w.failCardWrite) return json({ ok: false, error: 'card write refused' }, 500);
        const found = w.rows.find(x => x.id === patch.id);
        if (found && patch.status && patch.status !== 'Archived') { found.status = patch.status; w.restored.add(found.id); found.updated_at = new Date().toISOString(); w.live.push(found); w.rows = w.rows.filter(x => x !== found); }
        return json({ ok: true, post: Object.assign({}, found || {}), sample: Object.assign({}, found || {}) });
      }
      if (p === '/functions/v1/production-write') {
        const rec = { route: 'production-write', body };
        w.writes.push(rec);
        if (body.operation === 'status' && w.items[body.id]) {
          const it = w.items[body.id];
          if (w.conflictOn === body.id) return json({ ok: false, error: 'write_conflict', conflict: true }, 409);
          if (body.expected_status && body.expected_status !== it.status) return json({ ok: false, error: 'write_conflict', conflict: true }, 409);
          it.status = body.status; it.updated_at = new Date().toISOString();
          return json({ ok: true, native_committed: true, row: { id: it.id, status: it.status } });
        }
        return json({ ok: true, native_committed: true });
      }
      if (/calendar-reorder|sample-review-reorder/.test(p)) { w.writes.push({ route: p.split('/').pop(), body }); return json({ ok: true, updated: (body.items || []).length }); }
      w.writes.push({ route: 'other:' + p, body });
      return json({ ok: true });
    }
    if (r.method() !== 'GET' && r.method() !== 'HEAD') { w.writes.push({ route: 'rest-' + r.method() + ':' + p, body: r.postData() }); return json([]); }
    // ── reads ──
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role, team: null, active: true }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = sp.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : ((k === 'write_ui_reroute_clients' || k === 'calendar_upsert_ef_clients' || k === 'sample_review_ef_clients') ? { clients: [SLUG] } : {}) })));
    }
    if (p === '/rest/v1/' + w.table) {
      const status = sp.get('status');
      const idEq = (sp.get('id') || '').replace(/^eq\./, '');
      if (idEq) return json([...w.rows, ...w.live].filter(x => x.id === idEq).slice(0, 1));
      if (status === 'eq.Archived') {
        w.listReads.push(u.search);
        if (w.failList) return json({ error: 'boom' }, 500);
        const gte = sp.get('updated_at') && sp.get('updated_at').replace(/^gte\./, '');
        let out = w.rows.filter(x => x.status === 'Archived' && (!gte || Date.parse(x.updated_at) >= Date.parse(gte)));
        const orq = sp.get('or');
        if (orq) {
          const m = /updated_at\.lt\.([^,]+),and\(updated_at\.eq\.[^,]+,id\.lt\.([^)]+)\)/.exec(orq);
          if (m) { const cu = Date.parse(m[1]); out = out.filter(x => Date.parse(x.updated_at) < cu || (Date.parse(x.updated_at) === cu && x.id < m[2])); }
        }
        out.sort((a, b) => (Date.parse(b.updated_at) - Date.parse(a.updated_at)) || (a.id < b.id ? 1 : -1));
        return json(out.slice(0, parseInt((sp.get('limit') || '1000'), 10)));
      }
      return json(w.live.slice());
    }
    if (p === '/rest/v1/' + w.evTable) {
      const inq = (sp.get(w.evKey) || '');
      const ids = inq.replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map(s => s.replace(/"/g, ''));
      return json(ids.filter(Boolean).map(id => { const f = [...w.rows, ...w.live].find(x => x.id === id); return { [w.evKey]: id, ts: (f && f.archivedAt) || ago(2), actor: 'Browser Staff', role: 'smm' }; }));
    }
    if (p === '/rest/v1/production_deliverables_browser_v1') {
      const id = (sp.get('id') || '').replace(/^eq\./, '');
      return json(w.items[id] ? [w.items[id]] : []);
    }
    if (p === '/rest/v1/deliverable_events') {
      const id = (sp.get('deliverable_id') || '').replace(/^eq\./, '');
      return json(w.itemEvents[id] || []);
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  return { page, ctx, pageErrors };
}

async function openSurface(page, origin, kind) {
  const url = kind === 'sxr' ? `${origin}/index.html?v=sample-reviews&sxr=1` : `${origin}/index.html?v=calendar`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _arxOpen === 'function', null, { timeout: 30000 });
  await page.evaluate(({ kind, client }) => {
    _syncviewStaffIdentityVerified = true;
    if (kind === 'sxr') { _sxrSavePins([client]); navTo('sample-reviews'); }
    else { _calSavePins([client]); navTo('calendar'); }
  }, { kind, client: CLIENT });
  await page.waitForSelector(kind === 'sxr' ? '#sxrKebabMenu' : '#calKebabMenu', { state: 'attached', timeout: 15000 });
}
const kebabSel = kind => kind === 'sxr' ? '.cal-kebab-wrap button.cal-kebab' : '.cal-kebab-wrap button.cal-kebab';
const menuSel = kind => kind === 'sxr' ? '#sxrKebabMenu' : '#calKebabMenu';
const itemSel = kind => `${menuSel(kind)} [data-staff-capability="restore-archived"] button`;
async function openList(page, kind) {
  await page.click(kebabSel(kind));
  await page.click(itemSel(kind));
  await page.waitForSelector('#arxOverlay .arx-row, #arxOverlay .arx-empty-t, #arxOverlay .arx-error-t', { timeout: 10000 });
}
const rowNames = page => page.$$eval('#arxOverlay .arx-row-name', els => els.map(e => e.textContent.trim()));
const dialogText = page => page.$eval('#arxDialog', e => e.innerText).catch(() => '');
async function waitDialog(page) { await page.waitForSelector('#arxDialog', { timeout: 10000 }); }
const clickDialog = (page, which) => page.click(`#arxDialog [data-arx="${which}"]`);
const cardWrites = w => w.writes.filter(x => /upsert$/.test(x.route));
const itemWrites = w => w.writes.filter(x => x.route === 'production-write');
const reorderWrites = w => w.writes.filter(x => /reorder$/.test(x.route));

async function runSurface(browser, origin, kind) {
  const label = kind === 'cal' ? 'Calendar' : 'Samples';
  console.log(`--- ${label} ---`);
  const w = world(kind);
  const { page, ctx, pageErrors } = await newPage(browser, origin, w, { role: 'admin' });
  await openSurface(page, origin, kind);

  // menu item is there for admin
  await page.click(kebabSel(kind));
  expect(await page.isVisible(itemSel(kind)), `${label}: the More menu shows the archived item to an admin`);
  const label1 = await page.$eval(itemSel(kind), e => e.textContent.trim());
  expect(label1 === (kind === 'cal' ? 'Archived cards' : 'Archived samples'), `${label}: the item is named "${label1}"`);
  await page.click(itemSel(kind));
  await page.waitForSelector('#arxOverlay .arx-row', { timeout: 10000 });

  // list: only last 30 days, newest first, paged by cursor
  let names = await rowNames(page);
  expect(names.length === 25, `${label}: first page shows 25 rows (${names.length})`);
  expect(names[0] === 'Spring launch teaser' && names[1] === 'Behind the scenes reel', `${label}: newest first`);
  expect(!names.includes('Older weekly tips'), `${label}: an item archived 45 days ago is not in the first 30 days`);
  expect(w.listReads.every(q => /status=eq\.Archived/.test(q) && /limit=26/.test(q)), `${label}: reads are archived-only with one spare row`);
  await page.click('#arxOverlay [data-arx-act="more"]');
  await page.waitForFunction(() => document.querySelectorAll('#arxOverlay .arx-row').length > 25, null, { timeout: 10000 });
  names = await rowNames(page);
  expect(new Set(names).size === names.length, `${label}: no row repeated across pages (${names.length})`);
  expect(names.length === 30 && names.includes('Filler 26'), `${label}: Show older reached the rest of the first 30 days (${names.length})`);
  if (await page.$('#arxOverlay [data-arx-act="more"]')) {
    await page.click('#arxOverlay [data-arx-act="more"]');
    await page.waitForFunction(() => [...document.querySelectorAll('#arxOverlay .arx-row-name')].some(e => e.textContent.trim() === 'Older weekly tips'), null, { timeout: 10000 });
  }
  names = await rowNames(page);
  expect(names.includes('Older weekly tips'), `${label}: Show older widened to reach the 45 day old item`);
  const countBefore = (await rowNames(page)).length;
  if (await page.$('#arxOverlay [data-arx-act="more"]')) { await page.click('#arxOverlay [data-arx-act="more"]'); await page.waitForFunction(() => !document.querySelector('#arxOverlay [data-arx-act="more"]'), null, { timeout: 10000 }); }
  expect(await page.$('#arxOverlay [data-arx-act="more"]') === null && (await rowNames(page)).length === countBefore, `${label}: after the 90 day window is used up, Show older is gone and nothing is added`);
  const meta = await page.$eval('#arxOverlay .arx-row-meta', e => e.textContent);
  expect(/Archived 2 days ago by an SMM/.test(meta), `${label}: the row says when and by whom (${meta.trim()})`);

  // blocked: shares a work item with a live card
  const before = w.writes.length;
  await page.click('#arxOverlay [data-arx-act="restore"][data-id="a3"]');
  await waitDialog(page);
  let txt = await dialogText(page);
  expect(/Can.t restore this (card|sample) yet/.test(txt) && txt.includes('Live card one'), `${label}: blocked, and names the live ${kind === 'cal' ? 'card' : 'sample'}`);
  await clickDialog(page, 'yes');
  expect(w.writes.length === before, `${label}: the blocked restore wrote nothing`);

  // confirm text, then cancel
  await page.click('#arxOverlay [data-arx-act="restore"][data-id="a1"]');
  await waitDialog(page);
  txt = await dialogText(page);
  expect(/Restore .Spring launch teaser.\?/.test(txt), `${label}: confirm names the ${kind === 'cal' ? 'card' : 'sample'}`);
  expect(/Video work item\s*back to SMM approval/.test(txt), `${label}: video goes "back to SMM approval"`);
  expect(new RegExp(`${kind === 'cal' ? 'Graphic' : 'Thumbnail'} work item\\s*stays Posted`).test(txt), `${label}: a finished item "stays Posted"`);
  expect(/overall status will be For SMM Approval/.test(txt), `${label}: it states the status it returns to`);
  if (kind === 'cal') expect(/2026-09-01, has passed/.test(txt), `${label}: a past date is flagged`);
  await clickDialog(page, 'no');
  expect(w.writes.length === before, `${label}: Cancel wrote nothing`);

  // restore a2: item statuses -> to To do (was already in Backlog) and left alone (moved since); tie -> reorder
  await page.click('#arxOverlay [data-arx-act="restore"][data-id="a2"]');
  await waitDialog(page);
  txt = await dialogText(page);
  expect(/Video work item\s*to To do/.test(txt), `${label}: "already in Backlog" goes "to To do"`);
  expect(new RegExp(`${kind === 'cal' ? 'Graphic' : 'Thumbnail'} work item\\s*left alone, it moved since`).test(txt), `${label}: a moved item is "left alone, it moved since"`);
  await clickDialog(page, 'yes');
  await waitDialog(page);
  await page.waitForFunction(() => /Restored/.test((document.getElementById('arxDialogTitle') || {}).textContent || ''), null, { timeout: 15000 });
  txt = await dialogText(page);
  expect(/moved to To do/.test(txt) && /left alone, it moved since/.test(txt), `${label}: success message lists what moved and what did not`);
  await clickDialog(page, 'yes');
  const cw = cardWrites(w);
  expect(cw.length === 1, `${label}: exactly one card write (${cw.length})`);
  const sent = cw[0].body.post || cw[0].body.sample;
  expect(sent.id === 'a2' && sent.status && sent.status !== 'Archived', `${label}: the card write carries a live status (${sent.status})`);
  expect(Object.keys(sent).filter(k => !['id', 'status', 'updated_at'].includes(k)).length === 0, `${label}: nothing else on the card is written (${Object.keys(sent).join(',')})`);
  const iw = itemWrites(w);
  expect(iw.length === 1 && iw[0].body.id === 'd-v2' && iw[0].body.status === 'todo' && iw[0].body.expected_status === 'backlog' && !!iw[0].body.expected_updated_at, `${label}: one guarded item move with expected values`);
  expect(iw[0].body.operation === 'status' && iw[0].body.surface === (kind === 'cal' ? 'calendar' : 'sxr'), `${label}: it is the status operation on the ${kind === 'cal' ? 'calendar' : 'sxr'} surface`);
  const rw = reorderWrites(w);
  expect(rw.length === 1 && rw[0].body.items[0].id === 'a2' && rw[0].body.items[0].order_index > 3, `${label}: a slot tie sends one position write to the end of the list`);
  expect(w.writes.every(x => !/^rest-/.test(x.route)), `${label}: no direct table write`);
  names = await rowNames(page);
  expect(!names.includes('Behind the scenes reel'), `${label}: the restored row leaves the list`);

  // restore a1 with a conflict on the video move: card stays restored, their change kept
  w.conflictOn = 'd-v1';
  await page.click('#arxOverlay [data-arx-act="restore"][data-id="a1"]');
  await waitDialog(page); await clickDialog(page, 'yes');
  await page.waitForFunction(() => /Restored/.test((document.getElementById('arxDialogTitle') || {}).textContent || ''), null, { timeout: 15000 });
  txt = await dialogText(page);
  expect(/Restored, one work item left as it is/.test(txt) && /someone else changed it first, their change was kept/.test(txt), `${label}: a conflict keeps the other change and says so`);
  await clickDialog(page, 'yes');
  expect(w.restored.has('a1'), `${label}: the card stayed restored despite the conflict`);
  expect(reorderWrites(w).length === 1, `${label}: no tie, no second position write`);

  // already restored elsewhere: writes nothing
  const f = w.rows.find(x => x.id === 'f00');
  f.status = 'In Progress';   // someone else restored it after the list loaded
  const beforeFresh = w.writes.length;
  await page.click('#arxOverlay [data-arx-act="restore"][data-id="f00"]');
  await waitDialog(page);
  txt = await dialogText(page);
  expect(/Already restored/.test(txt), `${label}: a row someone else restored says "Already restored"`);
  await clickDialog(page, 'yes');
  expect(w.writes.length === beforeFresh, `${label}: and writes nothing`);

  // failed card write: nothing changes
  w.failCardWrite = true;
  const itemsBeforeFail = itemWrites(w).length;
  await page.click('#arxOverlay [data-arx-act="restore"][data-id="f01"]');
  await waitDialog(page); await clickDialog(page, 'yes');
  await page.waitForFunction(() => /Couldn.t restore/.test((document.getElementById('arxDialogTitle') || {}).textContent || ''), null, { timeout: 15000 });
  expect(/Nothing was changed/.test(await dialogText(page)), `${label}: a failed card write says nothing was changed`);
  await clickDialog(page, 'yes');
  expect(itemWrites(w).length === itemsBeforeFail, `${label}: no work item moved after a failed card write`);
  names = await rowNames(page);
  expect(names.includes('Filler 1'), `${label}: the row stays in the list after a failed write`);
  w.failCardWrite = false;

  // error state + retry
  await page.click('#arxOverlay [data-arx-act="close"]');
  w.failList = true;
  await page.click(kebabSel(kind)); await page.click(itemSel(kind));
  await page.waitForSelector('#arxOverlay .arx-error-t', { timeout: 10000 });
  expect(/Couldn.t load archived (cards|samples)/.test(await page.$eval('#arxOverlay .arx-error', e => e.innerText)), `${label}: read failure shows the error state`);
  w.failList = false;
  await page.click('#arxOverlay [data-arx-act="retry"]');
  await page.waitForSelector('#arxOverlay .arx-row', { timeout: 10000 });
  expect(true, `${label}: Try again recovers`);
  await page.click('#arxOverlay [data-arx-act="close"]');

  // empty state
  const saveRows = w.rows; w.rows = [];
  await page.click(kebabSel(kind)); await page.click(itemSel(kind));
  await page.waitForSelector('#arxOverlay .arx-empty-t', { timeout: 10000 });
  expect(/Nothing archived in the last 30 days/.test(await page.$eval('#arxOverlay .arx-empty-t', e => e.textContent)), `${label}: empty state`);
  w.rows = saveRows;
  await page.click('#arxOverlay [data-arx-act="close"]');
  expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

async function runRoles(browser, origin) {
  console.log('--- roles and client link ---');
  for (const [role, expected] of [['smm', true], ['creative', false]]) {
    const w = world('cal');
    const { page, ctx } = await newPage(browser, origin, w, { role });
    await openSurface(page, origin, 'cal');
    const present = await page.evaluate(() => { const el = document.querySelector('#calKebabMenu [data-staff-capability="restore-archived"]'); return !!el && !el.hidden; });
    expect(present === expected, `Calendar: the item is ${expected ? 'shown to' : 'hidden from'} a ${role} seat`);
    const can = await page.evaluate(() => _arxCan());
    expect(can === expected, `Calendar: _arxCan() is ${expected} for ${role}`);
    if (!expected) {
      await page.evaluate(() => _arxOpen('cal'));
      expect(await page.$('#arxOverlay') === null, 'Calendar: opening it directly does nothing for a creative seat');
    }
    await ctx.close();
  }
  // a client link
  const w = world('cal');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = b => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (u.pathname === '/functions/v1/client-token-verify') return json({ ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: 'calendar', strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    if (r.method() !== 'GET') { w.writes.push({ route: u.pathname }); return json({ ok: true }); }
    if (u.pathname === '/rest/v1/calendar_posts') return json(w.live);
    if (u.pathname === '/rest/v1/clients') return json([{ slug: SLUG, kind: 'client', active: true }]);
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(u.pathname)) return json({});
    return route.abort();
  });
  await page.goto(`${origin}/index.html?${new URLSearchParams({ c: CLIENT, t: 'synthetic-token', v: 'calendar' })}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _arxCan === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => _isClientLink === true && _arxCan() === false), 'client link: the feature refuses (link detected, gate closed)');
  expect(await page.$('[data-staff-capability="restore-archived"]') === null, 'client link: no menu item exists on the page');
  await page.evaluate(() => _arxOpen('cal'));
  expect(await page.$('#arxOverlay') === null && w.writes.length === 0, 'client link: forcing the opener does nothing and writes nothing');
  await ctx.close();
}

(async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    await runSurface(browser, origin, 'cal');
    await runSurface(browser, origin, 'sxr');
    await runRoles(browser, origin);
  } catch (e) {
    failures.push('harness error: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close(); server.close();
  }
  if (failures.length) { console.error(`\narchived-restore-browser: ${failures.length} FAILED`); process.exit(1); }
  console.log('\narchived-restore-browser: all checks passed');
})();
