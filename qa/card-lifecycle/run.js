'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Harness, ROOT, hash, provenance, toolingProvenance } = require('./harness');
const matrix = require('./matrix');
const { Backend, CLIENTS, clone } = require('./mock-backend');
const ui = require('./ui');
const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const source = path.resolve(option('--source', ROOT));
const selected = option('--case', '').split(',').filter(Boolean);
const output = path.join(ROOT, '.codex-tmp', 'card-lifecycle', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(output, { recursive: true });
const cases = [];
const add = (id, comp, status, tweak, run) => cases.push({ id, comp, status, tweak, run });
for (const comp of ['video', 'graphic']) add(`journey-${comp}`, comp, 'Tweaks Needed', true, async (h, b, step) => {
  const s = await h.session(b); let p = await h.open(s);
  await step('resolve-last-to-kasper', async () => {
    const start = b.records.length; await ui.resolve(p); await ui.accepted(b, start);
    await ui.pill(p, comp, 'Kasper Approval');
    await ui.fresh(h, b, comp, 'Kasper Approval', { kasper: true, client: false });
  });
  const k = await ui.reviewer(h, b, comp); const kp = k.page;
  await step('kasper-request', async () => {
    const panel = await ui.review(kp, comp, true), start = b.records.length;
    await panel.locator('.cal-review-textarea').fill('Fictional Kasper adjustment');
    await panel.locator('.cal-review-tweak-btn').click(); await ui.accepted(b, start);
    await ui.queue(kp, 'kasper', true);
    await ui.fresh(h, b, comp, 'Tweaks Needed', { kasper: true, client: false });
  });
  await step('staff-resolve-kasper-request', async () => {
    await p.reload(); const start = b.records.length;
    await ui.resolve(p); await ui.accepted(b, start);
    await ui.pill(p, comp, 'Kasper Approval');
    await ui.fresh(h, b, comp, 'Kasper Approval', { kasper: true, client: false });
  });
  await step('kasper-approve-to-client', async () => {
    await kp.locator('#navCalendar').click(); await ui.card(kp).waitFor(); await kp.locator('#navKasper').click();
    const panel = await ui.review(kp, comp, true), start = b.records.length;
    await panel.locator('.cal-review-approve-btn').click(); await ui.accepted(b, start);
    await ui.queue(kp, 'kasper', false);
    await ui.fresh(h, b, comp, 'Client Approval', { kasper: false, client: true });
  });
  const c = await h.session(b, 'client'); p = await h.open(c);
  await step('client-plain-note', async () => {
    const panel = await ui.review(p, comp), start = b.records.length;
    await panel.locator('.cal-review-textarea').fill('Fictional client plain note');
    await panel.locator('.cal-review-comment-btn').click(); await ui.accepted(b, start);
    assert.equal(b.rows[0][`${comp}_status`], 'Client Approval');
    await ui.queue(p, 'client', true);
    await ui.fresh(h, b, comp, 'Client Approval', { client: true });
    const staff = await h.session(b); await h.open(staff); await ui.notes(staff.page);
    await staff.page.getByText('Fictional client plain note', { exact: true }).waitFor();
    assert.equal(JSON.parse(b.rows[0][`${comp}_tweaks`]).find(c => c.body === 'Fictional client plain note')?.audience,
      'client', 'client audience persisted in the submitted card thread');
    await staff.context.close();
  });
  await step('client-request-invalidates-approval', async () => {
    const panel = await ui.review(p, comp), start = b.records.length;
    await panel.locator('.cal-review-textarea').fill('Fictional client adjustment');
    await panel.locator('.cal-review-tweak-btn').click(); await ui.accepted(b, start);
    assert(!b.rows[0].kasper_approved_at, 'new request clears old Kasper approval');
    await ui.queue(p, 'client', false);
    await ui.fresh(h, b, comp, 'Tweaks Needed', { client: false });
  });
  await step('staff-return-to-client', async () => {
    await s.page.reload(); const start = b.records.length;
    await ui.resolve(s.page, 'Client'); await ui.accepted(b, start);
    await ui.pill(s.page, comp, 'Client Approval');
    await ui.fresh(h, b, comp, 'Client Approval', { client: true });
  });
  await step('client-final-approve', async () => {
    await p.reload(); const panel = await ui.review(p, comp), start = b.records.length;
    await panel.locator('.cal-review-approve-btn').click(); await ui.accepted(b, start);
    assert(b.rows[0][`client_${comp}_approved_at`], 'client approval stamp persisted');
    await ui.queue(p, 'client', false);
    await ui.fresh(h, b, comp, 'Approved', { kasper: false, client: false });
    step.observe({ client_approval_undo: await p.getByRole('button', { name: 'Undo', exact: true }).count() ? 'OFFERED_NOT_TESTED' : 'UNSUPPORTED_ON_THIS_SURFACE' });
  });
});

require('./scenarios')(add);

async function main() {
  assert(selected.every(id => cases.some(c => c.id === id)), 'unknown case selection');
  assert.deepEqual(cases.map(c => c.id).sort(), Object.keys(matrix).sort(), 'entire declared matrix has an implementation');
  const before = provenance(source), h = await new Harness(source, output).start();
  const report = { schema: 'card-lifecycle-v1', evidence: 'ISOLATED_BROWSER', source: before,
    serving: { kind: 'loopback-static', index_sha256: before.index_sha256, deployed_revision: 'UNPROVEN' },
    tooling: toolingProvenance(), browser: h.browser.version(), started_at: new Date().toISOString(), cells: [] };
  try {
    for (const spec of cases.filter(c => !selected.length || selected.includes(c.id))) {
      const b = new Backend(spec.comp, spec.status, spec.tweak);
      const cell = { id: spec.id, verdict: 'PASS', steps: [] }; report.cells.push(cell);
      let current = 'setup';
      const step = async (id, run) => {
        assert(matrix[spec.id].includes(id), 'step is registered in the finite matrix');
        current = id;
        await run();
        cell.steps.push({ id, verdict: 'PASS' });
        process.stdout.write(`PASS ${spec.id}/${id}\n`);
      };
      step.observe = values => { cell.observations = { ...(cell.observations || {}), ...values }; };
      try {
        await spec.run(h, b, step);
        current = 'matrix-completeness';
        assert(matrix[spec.id].every(id => cell.steps.some(s => s.id === id && s.verdict === 'PASS')), 'all declared steps executed');
        current = 'network-isolation';
        assert.equal(b.blocked.length, 0, 'unexpected request blocked');
        assert.equal(h.sessions.flatMap(s => s.sockets).length, 0, 'unexpected websocket blocked');
        current = 'document-health';
        assert.equal(h.sessions.flatMap(s => s.errors).length, 0, 'unexpected document error');
      } catch (error) {
        cell.verdict = 'FAIL'; cell.failure = current;
        cell.steps.push({ id: current, verdict: 'FAIL', failure_class: /Timeout/.test(error.message) ? 'visible_control_timeout' : 'contract_assertion' });
        fs.writeFileSync(path.join(output, spec.id + '-private.txt'), error.stack || String(error));
        const p = h.sessions.filter(s => !s.page.isClosed()).at(-1)?.page;
        if (p) cell.screenshot = await h.shot(p, spec.id).catch(() => null);
        process.stdout.write(`FAIL ${spec.id}/${current}\n`);
      } finally {
        b.release();
        for (const id of matrix[spec.id]) if (!cell.steps.some(s => s.id === id)) cell.steps.push({ id, verdict: 'NOT_TESTED', reason: 'prior_step_failed' });
        cell.accepted = b.records.filter(r => r.outcome === 'accepted').length;
        cell.replayed = b.records.filter(r => r.outcome === 'replayed').length;
        cell.blocked = b.blocked.length; cell.page_errors = h.sessions.flatMap(s => s.errors).length;
        cell.blocked_sockets = h.sessions.flatMap(s => s.sockets).length;
        cell.console_errors = h.sessions.flatMap(s => s.consoleErrors).length;
        cell.negative_control_rejections = (b.expectedBlocked || []).length;
        const privateData = JSON.stringify({ records: b.records, blocked: b.blocked, expectedBlocked: b.expectedBlocked, rows: b.rows, native: b.native,
          errors: h.sessions.flatMap(s => s.errors), consoleErrors: h.sessions.flatMap(s => s.consoleErrors) }, null, 2);
        fs.writeFileSync(path.join(output, spec.id + '-private.json'), privateData);
        cell.records_sha256 = hash(privateData);
        await h.closeSessions();
      }
    }
  } finally {
    await h.close(); report.finished_at = new Date().toISOString();
    report.serving.observed_document_count = h.documentHashes.length;
    report.serving.observed_hashes = [...new Set(h.documentHashes)];
    report.not_selected = Object.keys(matrix).filter(id => !report.cells.some(c => c.id === id));
    report.source_unchanged = provenance(source).tracked_bytes_sha256 === before.tracked_bytes_sha256;
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
  }
  console.log(`RESULT ${report.cells.filter(c => c.verdict === 'PASS').length} PASS ${report.cells.filter(c => c.verdict === 'FAIL').length} FAIL`);
  console.log('Artifacts: ' + output);
  process.exitCode = report.cells.some(c => c.verdict === 'FAIL') || !report.source_unchanged ? 1 : 0;
}
main().catch(error => { fs.writeFileSync(path.join(output, 'runner-private.txt'), error.stack || String(error)); console.error('FAIL runner_setup'); process.exitCode = 1; });
