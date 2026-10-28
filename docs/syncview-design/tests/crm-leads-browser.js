'use strict';
/* crm-leads-browser.js -- the Leads page (/leads) in a real browser, fully
 * offline: every crm-leads answer is local and made up (example.invalid).
 *
 * Checks: a shimmer skeleton (never "Loading" text) shows before the list
 * lands; the Pipeline paints stage groups with each lead as one flat line
 * (name, niche, next step, overdue in red; no lead-type badge), empty stages
 * in one quiet line; no bordered box sits inside another bordered box on any
 * view; the filters sit behind one View button with a dot when one is on;
 * a drag moves a lead and sends one update
 * with the version it had; a refused save is reported to the write-refusal log
 * and the card goes back; the person panel opens with details and the timeline
 * newest first, closes with Escape and returns focus; a lost race shows the
 * newer copy; Today groups due steps by owner, marks a passed call Showed /
 * No-show (one call_outcome with the version it had) and lists automatic
 * sends; Sequences shows each sequence with draft/approved steps, edits a
 * step into a new draft, approves (admin) and switches a sequence on;
 * each n8n automation opens as a read-only sequence with its exact emails
 * and texts, and the timeline links an automatic send to it; an identity change
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

/* A bordered box (all four sides) with a bordered box around it, inside the
   Leads page or the person panel: '' when there is none. */
async function boxesInBoxes(page) {
  return page.evaluate(() => {
    const boxed = n => { const c = getComputedStyle(n); return ['Top', 'Right', 'Bottom', 'Left'].every(k => parseFloat(c['border' + k + 'Width']) > 0 && c['border' + k + 'Style'] !== 'none'); };
    const out = [];
    for (const root of [document.querySelector('.crm-page'), document.getElementById('crmPanel')]) {
      if (!root || root.hidden) continue;
      for (const n of root.querySelectorAll('*')) {
        if (!n.getClientRects().length || !boxed(n)) continue;
        for (let a = n.parentElement; a && a !== root.parentElement; a = a.parentElement) if (boxed(a)) { out.push((n.className || n.tagName) + ' in ' + (a.className || a.tagName)); break; }
      }
    }
    return out.slice(0, 3).join('; ');
  });
}
/* Light and dark screenshots of what is on screen. */
async function shoot(page, name, full) {
  await page.evaluate(() => { const a = document.activeElement; if (a && a.blur && !/^(INPUT|TEXTAREA)$/.test(a.tagName)) a.blur(); });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(SHOTS, name + '-' + theme + '.png'), fullPage: !!full });
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
}

async function run(browser, origin, viewport) {
  const label = viewport.width + 'px';
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', hasTouch: viewport.width < 500 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffIdentity(page, STAFF_GATE_MEMBER);
  const state = { todayDelay: SHOTS ? 2500 : 700, listDelay: 0, people: people(), updates: [], refuse: '', beacons: 0, seqs: sequences(), outcomes: [], edits: [], approvals: [], toggles: [], actions: [] };
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
      if (body.action === 'list' && state.listDelay) { const ms = state.listDelay; state.listDelay = 0; await new Promise(res => setTimeout(res, ms)); }
      if (body.action === 'list') return json({ ok: true, people: state.people, sources: [{ id: 's1', name: 'Made-up batch', kind: 'csv_import' }], truncated: false });
      const person = state.people.find(x => x.id === body.id);
      if (body.action === 'get') {
        return json({ ok: true, person: Object.assign({ email: 'made-up@example.invalid', phone: '555 010 0000', lost_reason: null }, person), source: { id: 's1', name: 'Made-up batch' },
          events: [{ id: 2, kind: 'note', actor: 'QA Staff', detail: { text: 'Newest made-up note' }, occurred_at: '2026-10-21T10:00:00Z' },
                   { id: 3, kind: 'message_sent', channel: 'email', actor: 'n8n:Sales — Booking Recovery Dispatch', detail: { calendar: 'doctor-strategy-call' }, occurred_at: '2026-10-21T09:00:00Z' },
                   { id: 1, kind: 'imported', actor: 'import', detail: {}, occurred_at: '2026-10-20T10:00:00Z' },
                   { id: 0, kind: 'call', actor: 'Kasper', detail: {}, occurred_at: '2026-10-19T15:00:00Z' }] });
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
      if (body.action === 'today' && state.todayDelay) { const ms = state.todayDelay; state.todayDelay = 0; await new Promise(res => setTimeout(res, ms)); }
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
      if (body.action === 'sequences') return json({ ok: true, sequences: state.seqs, n8n: [
        { key: 'didnt_book_doctors', name: 'Didn\u2019t book: made-up', description: 'Made-up people who sent the form but never booked.', stops_when: 'They book or opt out.', workflow_name: 'Sales — Booking Recovery Dispatch', active: true, position: 10,
          messages: [{ label: 'Email', channel: 'email', when: 'About 20 minutes after they stop', sender: 'Made-up sender', subject: 'made-up subject line', text: 'Hi {first_name}, a made-up email body.', live: true },
                     { label: 'Text', channel: 'sms', when: 'Same time', sender: 'Made-up number', subject: null, text: 'Hey {first_name}, a made-up text.', live: true }] }] });
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
      if (body.action === 'report') return json({ ok: true, sources: [{ id: 's1', name: 'Made-up batch', kind: 'csv_import' }], rows: [{ source_id: 's1', people: 4, booked: 2, showed: 1, won: 1, won_value: 0 }] });
      if (body.action === 'duplicates') return json({ ok: true, groups: state.merged ? [] : [[state.people[0], Object.assign({}, state.people[1], { id: '00000000-0000-4000-8000-000000000009', display_name: state.people[0].display_name })]] });
      if (body.action === 'merge') { state.merged = body; return json({ ok: true, person: state.people[0] }); }
      if (body.action === 'due' || body.action === 'log_send') return json({ ok: false, error: 'unauthorized' }, 401);
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });

  await page.goto(origin + '/?sv_path=%2Fleads', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#crmToday .crm-skel, #crmToday .crm-group', { timeout: 30000 });
  const skel = await page.evaluate(() => ({ skel: !!document.querySelector('#crmToday .crm-skel .sv-skeleton'), rows: !!document.querySelector('#crmToday .crm-group'), text: (document.getElementById('crmPage') || document.body).innerText }));
  expect(skel.skel && !skel.rows, label + ': Leads opens on Today, with a shimmer skeleton before it lands');
  expect(!/Loading/.test(skel.text), label + ': no "Loading" text while it loads');
  if (SHOTS) await shoot(page, 'leads-skeleton-' + label);
  await page.waitForSelector('#crmToday .crm-group', { timeout: 30000 });
  expect(await page.locator('[data-crm-nav="n8n:didnt_book_doctors"]').count() === 1 && await page.locator('[data-crm-nav="own:q1"]').count() === 1, label + ': the side menu lists the n8n sequences and ours');
  await page.click('[data-crm-nav="pipeline"]');
  await page.waitForSelector('.crm-lead[data-crm-card]', { timeout: 30000 });
  expect(new URL(page.url()).pathname === '/leads', label + ': the address is /leads');
  expect(await page.locator('.crm-stage-body').count() === 4 && await page.locator('[data-crm-stage]').count() === 10, label + ': every stage has a section, four of them open with people');
  expect(await page.locator('.crm-stage.is-empty').count() === 6 && await page.locator('.crm-stage.is-empty .crm-stage-toggle:disabled').count() === 6, label + ': empty stages stay as folded titles');
  expect(await page.locator('[data-crm-stage="to_contact"] .crm-stage-hint').innerText() === 'We have not reached out yet', label + ': each stage says in plain words what it means');
  if (viewport.width >= 500) expect(/Name\s+Where they came from\s+Niche\s+Next step\s+Due/i.test(await page.locator('.crm-cols').innerText()), label + ': the Pipeline has column titles, with no Owner column');
  expect(!(await page.locator('.crm-lead-owner').count()) && !/Nobody/.test(await page.locator('.crm-board').innerText()), label + ': no owner on the lines');
  expect(!!(await page.locator('.crm-cols span', { hasText: 'Next step' }).getAttribute('title')), label + ': the Next step title explains itself on hover');
  await page.click('[data-crm-stage="to_contact"] .crm-stage-toggle');
  await page.waitForFunction(() => !document.querySelector('[data-crm-stage="to_contact"] .crm-stage-body'));
  expect(await page.locator('[data-crm-stage="to_contact"] .crm-stage-toggle').getAttribute('aria-expanded') === 'false', label + ': a stage section folds');
  await page.click('[data-crm-stage="to_contact"] .crm-stage-toggle');
  await page.waitForSelector('[data-crm-stage="to_contact"] .crm-stage-body');
  const first = page.locator('[data-crm-card="00000000-0000-4000-8000-000000000001"]');
  const text = await first.innerText();
  expect(/Made-up Studio/.test(text) && /First DM/.test(text) && (viewport.width < 500 || /Fitness/.test(text)), label + ': a lead line shows name, niche and next step');
  expect(/Dream 100/.test(text) && /Made-up batch/.test(text), label + ': a lead line says where they came from (' + text.replace(/\s+/g, ' ') + ')');
  expect(!(await page.locator('.crm-type, .crm-badge, .crm-chip').count()), label + ': no badges or chips on the Pipeline');
  expect(await page.evaluate(() => document.querySelector('.crm-board').scrollWidth <= document.querySelector('.crm-board').clientWidth + 1), label + ': the Pipeline never scrolls sideways');
  await page.fill('#crmSearch', 'kitchen');
  expect(await page.locator('[data-crm-card]').count() === 1 && /1 match/.test(await page.locator('#crmSummary').innerText()), label + ': search narrows the Pipeline as you type');
  await page.fill('#crmSearch', 'nobody-like-this');
  expect(/Nobody matches/.test(await page.locator('.crm-board-wrap').innerText()), label + ': search with no match says so');
  await page.fill('#crmSearch', '');
  expect(await page.locator('[data-crm-card]').count() >= 3, label + ': clearing the search brings everyone back');
  await page.click('[data-crm-nav="report"]');
  await page.waitForSelector('.crm-report tbody tr');
  expect(/Made-up batch\s+4\s+2\s+1\s+1/.test(await page.locator('.crm-report tbody').innerText()), label + ': the Report shows people, booked, showed and signed per source');
  if (SHOTS) await shoot(page, label + '-report');
  expect(await page.locator('.crm-report thead th').count() === 5, label + ': the Report has column titles');
  const mergeBtn = page.locator('#crmReport .crm-btn', { hasText: 'Merge' });
  expect(await mergeBtn.count() === 1, label + ': the Report lists the same person twice with a Merge button');
  await mergeBtn.click();
  expect(await page.locator('#crmReport .crm-btn', { hasText: 'Yes, merge' }).count() === 1, label + ': Merge asks once before it merges');
  await page.locator('#crmReport .crm-btn', { hasText: 'Yes, merge' }).click();
  await page.waitForFunction(() => !document.querySelector('#crmReport .crm-btn'));
  expect(true, label + ': a merge removes the pair from the list');
  await page.click('[data-crm-nav="pipeline"]');
  await page.waitForSelector('[data-crm-card]');
  expect(await boxesInBoxes(page) === '', label + ': Pipeline has no box inside a box (' + await boxesInBoxes(page) + ')');
  // Filters behind one View button, with a dot while one is on.
  expect(await page.locator('#crmViewMenu').isHidden() && await page.locator('#crmFilters .sv-select').count() === 3, label + ': the three filters are tucked behind View');
  await page.click('#crmViewBtn');
  await page.waitForSelector('#crmViewMenu:not([hidden])');
  if (SHOTS) await shoot(page, 'leads-view-menu-' + label);
  await page.click('#crmFilters .crm-toggle');
  await page.waitForFunction(() => document.getElementById('crmViewBtn').classList.contains('has-filter'));
  expect(true, label + ': turning a filter on puts a dot on View');
  await page.click('#crmFilters .crm-toggle');
  await page.waitForFunction(() => !document.getElementById('crmViewBtn').classList.contains('has-filter'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('crmViewMenu').hidden);
  await page.waitForSelector('.crm-lead[data-crm-card]');
  expect(await first.evaluate(n => n.classList.contains('is-overdue')) && /Overdue/.test(text), label + ': an overdue next step is marked');
  expect(!(await page.locator('[data-crm-card="00000000-0000-4000-8000-000000000002"]').evaluate(n => n.classList.contains('is-overdue'))), label + ': a future step is not overdue');
  if (SHOTS) await shoot(page, 'leads-pipeline-' + label);
  if (viewport.width >= 500) {
    await page.evaluate(() => { const b = document.querySelector('.crm-stage-body'); for (let i = 0; i < 60; i++) b.insertAdjacentHTML('beforeend', '<div class="crm-lead crm-pad" style="height:28px"></div>'); });
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(150);
    const stuck = await page.evaluate(() => { const s = document.getElementById('crmSide').getBoundingClientRect(); const c = document.querySelector('.crm-cols').getBoundingClientRect(); return { side: s.top, cols: c.top, y: window.scrollY }; });
    expect(stuck.y > 300 && stuck.side >= 0 && stuck.side < 140 && stuck.cols >= 0 && stuck.cols < 140, label + ': the side menu and the column titles stay in view while the list scrolls (' + JSON.stringify(stuck) + ')');
    await page.evaluate(() => { document.querySelectorAll('.crm-pad').forEach(n => n.remove()); window.scrollTo(0, 0); });
  }

  if (viewport.width >= 500) {
    // Drag a card to Replied: one update with the version it had.
    await first.dragTo(page.locator('[data-crm-stage="replied"]'));
    await page.waitForFunction(() => document.querySelector('[data-crm-stage="replied"] [data-crm-card="00000000-0000-4000-8000-000000000001"]'));
    expect(state.updates.length === 1 && state.updates[0].patch.stage === 'replied' && state.updates[0].expected_version === 1, label + ': drag sends one stage update with the version it had');
    // A refused drag goes back and is reported.
    state.refuse = 'write_failed';
    const before = state.beacons;
    await page.locator('[data-crm-card="00000000-0000-4000-8000-000000000002"]').dragTo(page.locator('[data-crm-stage="to_contact"]'));
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
  expect(evs[0] === 'Newest made-up note' && /Imported/.test(evs[2]), label + ': timeline is newest first');
  expect(/Email sent by Booking Recovery Dispatch/.test(evs[1]) && await page.locator('#crmPanel .crm-link', { hasText: 'Read the message' }).count() === 1, label + ': an automatic email on the timeline says who sent it and links to its wording');
  expect(/Last touch/.test(panel) && !/No touch yet/.test(panel), label + ': the panel says when we last touched them (a call, message or reply)');
  expect(!(await page.locator('#crmPStep').count()), label + ': the edit fields stay hidden until Edit');
  expect(await page.evaluate(() => { const t = Array.from(document.querySelectorAll('#crmPanel .crm-section-title')).map(n => n.textContent); return t[0] === 'What\u2019s happened' && t[1] === 'Sequences'; }), label + ': the timeline comes first, sequences after');
  expect(await boxesInBoxes(page) === '', label + ': the person panel has no box inside a box');
  if (SHOTS) await shoot(page, 'leads-person-' + label);
  await page.click('#crmPanel [data-crm-edit]');
  await page.waitForSelector('#crmPStep');
  // A lost race shows the newer copy.
  state.refuse = 'conflict';
  await page.fill('#crmPStep', 'A changed made-up step');
  await page.click('.crm-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#crmPStageLabel') && document.querySelector('#crmPStageLabel').textContent === 'Nurture');
  expect(await page.inputValue('#crmPStep') === 'Call prep', label + ': a lost race shows the stored copy, not the typed one');
  state.refuse = '';
  expect(!(await page.locator('#crmPNote').count()), label + ': the note box stays closed until Add a note');
  await page.locator('#crmPanel button', { hasText: 'Add a note' }).click();
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
  await page.click('[data-crm-nav="today"]');
  await page.waitForSelector('#crmTodayCalls');
  const todayText = await page.locator('#crmToday').innerText();
  expect(/First DM/.test(todayText) && /Follow up/.test(todayText) && !/Made Up Owner/.test(todayText), label + ': Today lists each next step due, with no owner');
  expect(await page.locator('#crmToday .crm-row.is-overdue').count() >= 1, label + ': an overdue step is marked on Today');
  expect(await page.evaluate(() => { const ids = Array.from(document.querySelectorAll('#crmToday .crm-group-title')).map(n => n.id); return ids.join() === 'crmTodayCalls,crmTodayDue,crmTodaySends'; }), label + ': Today runs calls, then follow-ups, then automatic sends');
  expect(await page.locator('#crmToday .crm-sheet').count() === 0 && !/\b0 /.test(todayText) && !/Nothing is sent from this page/.test(todayText), label + ': Today has no boxes, no zero counts and no filler line');
  expect(await boxesInBoxes(page) === '', label + ': Today has no box inside a box');
  expect(/Sequence is off/.test(todayText) && /No-show on call 1/.test(todayText), label + ': upcoming automatic sends show why they are held');
  if (SHOTS) await shoot(page, 'leads-today-' + label, true);
  const callRow = page.locator('[data-crm-call="00000000-0000-4000-8000-000000000003"]');
  expect(await callRow.count() === 1, label + ': a call whose slot passed is listed');
  await callRow.locator('[data-crm-outcome="no_show"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => { const b = document.querySelector('[data-crm-outcome="no_show"]'); return b && b.getBoundingClientRect().height >= 36; }, null, { timeout: 3000 }).catch(() => {});
  const box = await callRow.locator('[data-crm-outcome="no_show"]').boundingBox();
  expect(box && box.height >= 36, label + ': the No-show button is a real touch target');
  await callRow.locator('[data-crm-outcome="no_show"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-crm-call="00000000-0000-4000-8000-000000000003"]'));
  expect(state.outcomes.length === 1 && state.outcomes[0].outcome === 'no_show' && Number.isInteger(state.outcomes[0].expected_version), label + ': No-show sends one call outcome with the version it had');
  // Put the made-up call back for the other viewport run's state (each run has its own state, so this is just tidy).
  state.people[2].stage = 'call1_booked';

  // Sequences.
  await page.click('[data-crm-nav="own:q1"]');
  await page.waitForSelector('[data-crm-seq="no_show"]');
  const seqText = await page.locator('[data-crm-seq="no_show"]').innerText();
  expect(/Waiting for approval/.test(seqText) && /Approved/.test(seqText) && /2\s+in it now/.test(seqText) && /Text/.test(seqText) && /Email/.test(seqText), label + ': a sequence shows its steps, channels, states and people in it');
  expect(/Day 2\s+9am their time\s+Email · Approved/.test(seqText) && /2\s+messages/.test(seqText) && /2\s+days/.test(seqText) && /1\s+waiting for approval/.test(seqText), label + ': a step reads day, hour, channel and approval in plain words (' + seqText.replace(/\s+/g, ' ').slice(0, 300) + ')');
  expect(!(await page.locator('#crmSeqs .crm-badge, #crmSeqs .crm-chan').count()) && await boxesInBoxes(page) === '', label + ': no step chips and no box inside a box');
  expect(await page.locator('[data-crm-seq="no_show"] .crm-switch').getAttribute('aria-checked') === 'false', label + ': a sequence that is off says so');
  if (SHOTS) await shoot(page, 'leads-sequences-' + label, true);
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
  expect(/edited \(v2\)/.test(await page.locator('[data-crm-step="st1v2"]').innerText()), label + ': the edited step shows as a new version');
  await page.locator('[data-crm-step="st1v2"] button', { hasText: 'Approve' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-crm-step="st1v2"] .crm-btn-ok'));
  expect(state.approvals.length === 1 && state.approvals[0].step_id === 'st1v2', label + ': Approve approves that step');
  await page.locator('[data-crm-seq="no_show"] .crm-switch').click();
  await page.waitForFunction(() => document.querySelector('[data-crm-seq="no_show"] .crm-switch').getAttribute('aria-checked') === 'true');
  expect(state.toggles.length === 1 && state.toggles[0].active === true, label + ': the switch turns the sequence on');

  // An n8n automation as a read-only sequence with its exact wording.
  await page.click('[data-crm-nav="n8n:didnt_book_doctors"]');
  await page.waitForSelector('[data-crm-seq="didnt_book_doctors"]');
  const n8nText = await page.locator('[data-crm-seq="didnt_book_doctors"]').innerText();
  expect(/Runs in n8n/.test(n8nText) && /made-up subject line/.test(n8nText) && /a made-up email body/.test(n8nText) && /a made-up text/.test(n8nText) && /Stops when/.test(n8nText), label + ': an n8n sequence shows its emails and texts word for word');
  expect(await page.locator('[data-crm-seq="didnt_book_doctors"] .crm-mail').count() === 1 && await page.locator('[data-crm-seq="didnt_book_doctors"] .crm-bubble').count() === 1, label + ': an email reads as an email and a text as a text bubble');
  expect(!(await page.locator('[data-crm-seq="didnt_book_doctors"] .crm-switch, [data-crm-seq="didnt_book_doctors"] .crm-btn').count()), label + ': an n8n sequence cannot be changed here');
  expect(await boxesInBoxes(page) === '', label + ': the n8n sequence has no box inside a box');
  if (SHOTS) await shoot(page, 'leads-n8n-' + label, true);
  const seqOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(seqOverflow <= 1, label + ': a sequence screen has no sideways page overflow (' + seqOverflow + 'px)');
  expect(!state.actions.includes('due') && !state.actions.includes('log_send'), label + ': the page never calls the sender-only actions');

  await page.click('[data-crm-nav="pipeline"]');
  await page.waitForSelector('.crm-lead[data-crm-card]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow <= 1, label + ': no sideways page overflow (' + overflow + 'px)');
  // An identity change drops the cached people and re-renders.
  const purged = await page.evaluate(() => { window._crmPurgeSensitiveState(); return !document.querySelector('.crm-lead') && !document.getElementById('crmPage').firstChild; });
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
