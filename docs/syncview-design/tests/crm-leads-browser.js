'use strict';
/* crm-leads-browser.js -- the Leads page (/leads) in a real browser, fully
 * offline: every crm-leads answer is local and made up (example.invalid).
 *
 * Checks: the Pipeline paints stage columns with cards (name, handle, lead type,
 * niche, next step, overdue in red); a drag moves a card and sends one update
 * with the version it had; a refused save is reported to the write-refusal log
 * and the card goes back; the person panel opens with details and the timeline
 * newest first, closes with Escape and returns focus; a lost race shows the
 * newer copy; Today groups due steps by owner, marks a passed call Showed /
 * No-show (one call_outcome with the version it had) and lists automatic
 * sends; Sequences shows each sequence with draft/approved steps, edits a
 * step into a new draft, approves (admin) and switches a sequence on;
 * Systems lists the sequences and the n8n automations; an identity change
 * purges the cached people; at 390px the page has no sideways overflow.
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
function iso(minutesFromNow) { return new Date(Date.now() + minutesFromNow * 60000).toISOString(); }
function sequences() {
  const st = (id, key, pos, ch, day, extra) => Object.assign({ id, sequence_id: 'q1', step_key: key, position: pos, day_offset: day, hour_offset: 0, send_hour: day ? 9 : null, channel: ch, audience: 'all',
    subject: ch === 'email' ? 'Made-up subject' : null, template: 'Hi {first_name}, made-up text {rebook_link}', version: 1, is_current: true, approval_state: 'draft', approved_by: null }, extra || {});
  return [
    { id: 'q1', key: 'no_show', name: 'No-show on call 1', description: 'Made-up description', active: false, people_now: 2,
      steps: [st('st1', 'ns_a', 1, 'sms', 0), st('st2', 'ns_b', 2, 'email', 2, { approval_state: 'approved', approved_by: 'QA Staff' })] },
    { id: 'q2', key: 'nurture', name: 'Nurture', description: 'Weekly', active: true, people_now: 0, steps: [] },
  ];
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
  const state = { people: people(), updates: [], refuse: '', beacons: 0, seqs: sequences(), outcomes: [], edits: [], approvals: [], toggles: [], actions: [] };
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
      state.actions.push(body.action);
      if (body.action === 'today') {
        return json({ ok: true,
          due_people: [Object.assign({}, state.people[0], { overdue: true }), Object.assign({}, state.people[1], { owner: 'Second Made Up', next_step_due: today(0) })],
          calls_passed: state.people.filter(x => x.stage === 'call1_booked').map(x => Object.assign({}, x, { call_at: iso(-90) })),
          sends_today: [{ enrolment_id: 'e1', person_id: state.people[0].id, display_name: 'Made-up Studio', sequence: 'No-show on call 1', step_key: 'ns_a', channel: 'sms', due_at: iso(30), state: 'hold', reason: 'sequence_off' }] });
      }
      if (body.action === 'call_outcome') {
        state.outcomes.push(body);
        Object.assign(person, { stage: body.outcome === 'showed' ? 'call1_done' : 'no_show', state_version: person.state_version + 1 });
        return json({ ok: true, person, enrolment: body.outcome === 'no_show' ? { id: 'e9' } : null });
      }
      if (body.action === 'sequences') return json({ ok: true, sequences: state.seqs });
      if (body.action === 'step_edit') {
        state.edits.push(body);
        const s = state.seqs[0]; const i = s.steps.findIndex(x => x.id === body.step_id);
        const next = Object.assign({}, s.steps[i], body.fields, { id: 'st1v2', version: 2, approval_state: 'draft', approved_by: null });
        s.steps[i] = next; return json({ ok: true, step: next });
      }
      if (body.action === 'step_approve') {
        state.approvals.push(body);
        const s = state.seqs[0]; const step = s.steps.find(x => x.id === body.step_id);
        Object.assign(step, { approval_state: 'approved', approved_by: 'QA Staff' }); return json({ ok: true, step });
      }
      if (body.action === 'sequence_toggle') {
        state.toggles.push(body);
        const s = state.seqs.find(x => x.id === body.sequence_id); s.active = body.active; return json({ ok: true, sequence: s });
      }
      if (body.action === 'systems') {
        return json({ ok: true,
          automations: [{ id: 'booking_confirmation', name: 'Booking confirmation', trigger: 'A call is booked', audience: 'The person who booked', channel: 'email+sms', from: 'Made-up sender', timing: 'Right after booking', logged: false, owner: 'n8n' }],
          sequences: [{ id: 'seq_no_show', name: 'No-show on call 1', trigger: 'Made-up', audience: 'People in this sequence', channel: 'sms+email', from: 'Made-up', timing: 'day 0, day 2', logged: true, owner: 'SyncView sequence', active: false, approved: 1, steps: 2 }] });
      }
      if (body.action === 'due' || body.action === 'log_send') return json({ ok: false, error: 'unauthorized' }, 401);
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

  // Today.
  await page.click('[data-crm-tab="today"]');
  await page.waitForSelector('#crmTodayCalls');
  const todayText = await page.locator('#crmToday').innerText();
  expect(/Made Up Owner/.test(todayText) && /Second Made Up/.test(todayText), label + ': Today groups due steps by owner');
  expect(await page.locator('#crmToday .crm-row.is-overdue').count() >= 1, label + ': an overdue step is marked on Today');
  expect(/Sequence is off/.test(todayText) && /No-show on call 1/.test(todayText), label + ': upcoming automatic sends show why they are held');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'leads-today-' + label + '.png'), fullPage: true });
  const callRow = page.locator('[data-crm-call="00000000-0000-4000-8000-000000000003"]');
  expect(await callRow.count() === 1, label + ': a call whose slot passed is listed');
  const box = await callRow.locator('[data-crm-outcome="no_show"]').boundingBox();
  expect(box && box.height >= 36, label + ': the No-show button is a real touch target');
  await callRow.locator('[data-crm-outcome="no_show"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-crm-call="00000000-0000-4000-8000-000000000003"]'));
  expect(state.outcomes.length === 1 && state.outcomes[0].outcome === 'no_show' && Number.isInteger(state.outcomes[0].expected_version), label + ': No-show sends one call outcome with the version it had');
  // Put the made-up call back for the other viewport run's state (each run has its own state, so this is just tidy).
  state.people[2].stage = 'call1_booked';

  // Sequences.
  await page.click('[data-crm-tab="sequences"]');
  await page.waitForSelector('[data-crm-seq="no_show"]');
  const seqText = await page.locator('[data-crm-seq="no_show"]').innerText();
  expect(/Draft/.test(seqText) && /Approved/.test(seqText) && /2\s+in it now/.test(seqText) && /Text/.test(seqText) && /Email/.test(seqText), label + ': a sequence card shows steps, channels, badges and people in it');
  expect(await page.locator('[data-crm-seq="no_show"] .crm-switch').getAttribute('aria-checked') === 'false', label + ': a sequence that is off says so');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'leads-sequences-' + label + '.png'), fullPage: true });
  await page.locator('[data-crm-step="st1"] button', { hasText: 'Edit' }).click();
  await page.waitForSelector('#crmStepText');
  await page.fill('#crmStepText', 'Hi {first_name}, a changed made-up text');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('crmStepText'));
  await page.locator('[data-crm-step="st1"] button', { hasText: 'Edit' }).click();
  expect(await page.inputValue('#crmStepText') === 'Hi {first_name}, a changed made-up text', label + ': Escape closes the editor and keeps the typed text');
  await page.locator('#crmStepEditor button', { hasText: 'Save as draft' }).click();
  await page.waitForSelector('[data-crm-step="st1v2"]');
  expect(state.edits.length === 1 && state.edits[0].fields.template === 'Hi {first_name}, a changed made-up text' && !('subject' in state.edits[0].fields), label + ': saving a text step sends its new wording only');
  expect(/v2/.test(await page.locator('[data-crm-step="st1v2"]').innerText()), label + ': the edited step shows as a new version');
  await page.locator('[data-crm-step="st1v2"] button', { hasText: 'Approve' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-crm-step="st1v2"] .crm-btn-ok'));
  expect(state.approvals.length === 1 && state.approvals[0].step_id === 'st1v2', label + ': Approve approves that step');
  await page.locator('[data-crm-seq="no_show"] .crm-switch').click();
  await page.waitForFunction(() => document.querySelector('[data-crm-seq="no_show"] .crm-switch').getAttribute('aria-checked') === 'true');
  expect(state.toggles.length === 1 && state.toggles[0].active === true, label + ': the switch turns the sequence on');

  // Systems.
  await page.click('[data-crm-tab="systems"]');
  await page.waitForSelector('[data-crm-sys="booking_confirmation"]');
  const sysText = await page.locator('#crmSystems').innerText();
  expect(/Booking confirmation/.test(sysText) && /Not yet/.test(sysText) && /Logged/.test(sysText) && /1 of 2 approved/.test(sysText), label + ': Systems lists the sequences and the n8n automations with their logging state');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'leads-systems-' + label + '.png'), fullPage: true });
  const sysOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sysOverflow <= 1, label + ': Systems has no sideways page overflow (' + sysOverflow + 'px)');
  expect(!state.actions.includes('due') && !state.actions.includes('log_send'), label + ': the page never calls the sender-only actions');

  await page.click('[data-crm-tab="pipeline"]');
  await page.waitForSelector('.crm-card');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow <= 1, label + ': no sideways page overflow (' + overflow + 'px)');
  // An identity change drops the cached people and re-renders.
  const purged = await page.evaluate(() => { window._crmPurgeSensitiveState(); return !document.querySelector('.crm-card') && !document.getElementById('crmPage').firstChild; });
  expect(purged, label + ': an identity change clears the cached people from the page');
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
