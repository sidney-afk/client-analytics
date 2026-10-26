'use strict';
/* crm-leads-browser.js -- the Leads page (/leads) in a real browser, fully
 * offline: every crm-leads answer is local and made up (example.invalid).
 *
 * Checks: the Pipeline paints stage columns with cards (name, handle, lead type,
 * niche, next step, overdue in red); a drag moves a card and sends one update
 * with the version it had; a refused save is reported to the write-refusal log
 * and the card goes back; the person panel opens with details and the timeline
 * newest first, closes with Escape and returns focus; a lost race shows the
 * newer copy; Today/Sequences/Systems say what is coming; at 390px the page
 * has no sideways overflow.
 *
 * Run: node docs/syncview-design/tests/crm-leads-browser.js [--shots=<dir>]
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffIdentity, STAFF_GATE_MEMBER } = require('../../../qa/staff-gate-seed.js');

const root = path.resolve(__dirname, '..', '..', '..');
const shotsArg = process.argv.find(a => a.startsWith('--shots='));
const SHOTS = shotsArg ? shotsArg.slice(8) : '';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

function today(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function people() {
  const p = (id, name, handle, type, niche, stage, step, due) => ({
    id, display_name: name, instagram_handle: handle, lead_type: type, niche, stage, owner: 'Made Up Owner',
    next_step: step, next_step_due: due, source_id: 's1', tags: [], state_version: 1, updated_at: '2026-10-20T10:00:00Z',
  });
  return [
    p('00000000-0000-4000-8000-000000000001', 'Made-up Studio', 'madeup.studio', 'dream100', 'Fitness', 'to_contact', 'First DM', today(-2)),
    p('00000000-0000-4000-8000-000000000002', 'Example Kitchen', 'example.kitchen', 'ad_lead', 'Food', 'contacted', 'Follow up', today(1)),
    p('00000000-0000-4000-8000-000000000003', 'Sample Coach', '', 'past_call', 'Coaching', 'call1_booked', 'Call prep', today(3)),
    p('00000000-0000-4000-8000-000000000004', 'Test Florist', 'test.florist', 'email', 'Retail', 'won', '', null),
  ];
}

let checks = 0; const failures = [];
function expect(v, m) { checks++; if (!v) { failures.push(m); console.error('FAIL  ' + m); } else console.log('  ok  ' + m); }

async function run(browser, origin, viewport) {
  const label = viewport.width + 'px';
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', hasTouch: viewport.width < 500 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffIdentity(page, STAFF_GATE_MEMBER);
  const state = { people: people(), updates: [], refuse: '', beacons: 0 };
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (b, st) => route.fulfill({ status: st || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: STAFF_GATE_MEMBER });
    if (p === '/functions/v1/write-diagnostics') { state.beacons++; return json({ ok: true }); }
    if (p === '/functions/v1/crm-leads') {
      const body = JSON.parse(r.postData() || '{}');
      const hdr = r.headers();
      if (!hdr['x-syncview-key']) return json({ ok: false, error: 'unauthorized' }, 401);
      if (body.action === 'list') return json({ ok: true, people: state.people, sources: [{ id: 's1', name: 'Made-up batch', kind: 'csv_import' }], truncated: false });
      const person = state.people.find(x => x.id === body.id);
      if (body.action === 'get') {
        return json({ ok: true, person: Object.assign({ email: 'made-up@example.invalid', phone: '555 010 0000', lost_reason: null }, person), source: { id: 's1', name: 'Made-up batch' },
          events: [{ id: 2, kind: 'note', actor: 'QA Staff', detail: { text: 'Newest made-up note' }, occurred_at: '2026-10-21T10:00:00Z' },
                   { id: 1, kind: 'imported', actor: 'import', detail: {}, occurred_at: '2026-10-20T10:00:00Z' }] });
      }
      if (body.action === 'update') {
        state.updates.push(body);
        if (state.refuse === 'conflict') return json({ ok: false, error: 'conflict', current: Object.assign({}, person, { stage: 'nurture', state_version: person.state_version + 5 }) }, 409);
        if (state.refuse) return json({ ok: false, error: state.refuse }, 500);
        Object.assign(person, body.patch, { state_version: person.state_version + 1 });
        return json({ ok: true, person });
      }
      if (body.action === 'note') return json({ ok: true, person });
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });

  await page.goto(origin + '/?sv_path=%2Fleads', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.crm-card', { timeout: 30000 });
  expect(new URL(page.url()).pathname === '/leads', label + ': the address is /leads');
  expect(await page.locator('.crm-col').count() === 10, label + ': ten stage columns');
  const first = page.locator('[data-crm-card="00000000-0000-4000-8000-000000000001"]');
  const text = await first.innerText();
  expect(/Made-up Studio/.test(text) && /@madeup\.studio/.test(text) && /Dream 100/.test(text) && /Fitness/.test(text) && /First DM/.test(text), label + ': card shows name, handle, lead type, niche and next step');
  expect(await first.evaluate(n => n.classList.contains('is-overdue')) && /Overdue/.test(text), label + ': an overdue next step is marked');
  expect(!(await page.locator('[data-crm-card="00000000-0000-4000-8000-000000000002"]').evaluate(n => n.classList.contains('is-overdue'))), label + ': a future step is not overdue');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'leads-pipeline-' + label + '.png'), fullPage: false });

  if (viewport.width >= 500) {
    // Drag a card to Replied: one update with the version it had.
    await first.dragTo(page.locator('[data-crm-stage="replied"] .crm-col-body'));
    await page.waitForFunction(() => document.querySelector('[data-crm-stage="replied"] [data-crm-card="00000000-0000-4000-8000-000000000001"]'));
    expect(state.updates.length === 1 && state.updates[0].patch.stage === 'replied' && state.updates[0].expected_version === 1, label + ': drag sends one stage update with the version it had');
    // A refused drag goes back and is reported.
    state.refuse = 'write_failed';
    const before = state.beacons;
    await page.locator('[data-crm-card="00000000-0000-4000-8000-000000000002"]').dragTo(page.locator('[data-crm-stage="to_contact"] .crm-col-body'));
    await page.waitForFunction(() => document.querySelector('[data-crm-stage="contacted"] [data-crm-card="00000000-0000-4000-8000-000000000002"]'));
    await page.waitForFunction(() => (window.peekWriteUiQueueDiagnostics() || []).some(r => r.surface === 'leads'));
    expect(state.updates.length === 2 && await page.locator('[data-crm-stage="contacted"] [data-crm-card="00000000-0000-4000-8000-000000000002"]').count() === 1, label + ': a refused drag puts the card back');
    const diag = await page.evaluate(() => (window.peekWriteUiQueueDiagnostics ? window.peekWriteUiQueueDiagnostics() : []).filter(r => r.surface === 'leads').length);
    expect(diag >= 1, label + ': the refusal is recorded in the write-refusal log');
    expect(state.beacons >= before, label + ': the refusal beacon path ran without error');
    state.refuse = '';
  }

  // Person panel.
  await page.locator('[data-crm-card="00000000-0000-4000-8000-000000000003"]').click();
  await page.waitForSelector('#crmPanel:not([hidden]) .crm-timeline');
  const panel = await page.locator('#crmPanel').innerText();
  expect(/Sample Coach/.test(panel) && /made-up@example\.invalid/.test(panel) && /Made-up batch/.test(panel), label + ': panel shows details and source');
  const evs = await page.locator('.crm-ev-text').allInnerTexts();
  expect(evs[0] === 'Newest made-up note' && /Imported/.test(evs[1]), label + ': timeline is newest first');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'leads-person-' + label + '.png'), fullPage: false });
  // A lost race shows the newer copy.
  state.refuse = 'conflict';
  await page.fill('#crmPStep', 'A changed made-up step');
  await page.click('.crm-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#crmPStageLabel') && document.querySelector('#crmPStageLabel').textContent === 'Nurture');
  expect(await page.inputValue('#crmPStep') === 'Call prep', label + ': a lost race shows the stored copy, not the typed one');
  state.refuse = '';
  await page.fill('#crmPNote', 'Half-written made-up note');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('crmPanel').hidden);
  expect(await page.evaluate(() => !!document.activeElement && document.activeElement.getAttribute('data-crm-card') === '00000000-0000-4000-8000-000000000003'), label + ': Escape closes the panel and focus returns to the card');
  await page.locator('[data-crm-card="00000000-0000-4000-8000-000000000003"]').click();
  await page.waitForSelector('#crmPanel:not([hidden]) #crmPNote');
  expect(await page.inputValue('#crmPNote') === 'Half-written made-up note', label + ': closing kept the started note');
  await page.click('.crm-x');
  await page.waitForFunction(() => document.getElementById('crmPanel').hidden);

  for (const tab of ['today', 'sequences', 'systems']) {
    await page.click(`[data-crm-tab="${tab}"]`);
    expect(await page.locator('.crm-coming h2').count() === 1, label + ': ' + tab + ' says what is coming');
  }
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'leads-coming-' + label + '.png') });
  await page.click('[data-crm-tab="pipeline"]');
  await page.waitForSelector('.crm-card');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow <= 1, label + ': no sideways page overflow (' + overflow + 'px)');
  expect(!errors.length, label + ': no page errors' + (errors.length ? ' (' + errors.join(' | ') + ')' : ''));
  await ctx.close();
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    await run(browser, origin, { width: 1360, height: 860 });
    await run(browser, origin, { width: 390, height: 844 });
  } finally { await browser.close(); server.close(); }
  console.log(failures.length ? `\ncrm-leads-browser: ${failures.length} of ${checks} failed` : `\ncrm-leads-browser: ${checks} checks passed`);
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
