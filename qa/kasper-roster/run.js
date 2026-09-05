'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
assert(option('--fixture'), '--fixture must name a local PR1282 checkout');
const fixture = path.resolve(option('--fixture'));
const root = path.resolve(__dirname, '../..');
const source = path.resolve(option('--source', root));
const { Harness, provenance, hash, toolingProvenance } = require(path.join(fixture, 'qa/card-lifecycle/harness'));
const { Backend, clone } = require(path.join(fixture, 'qa/card-lifecycle/mock-backend'));
const ui = require(path.join(fixture, 'qa/card-lifecycle/ui'));
const fixtureHead = execFileSync('git', ['-C', fixture, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(fixtureHead, 'd2f67ba4037621484f1e08d0f9fb02635e9cbfcf', 'use the unchanged PR1282 fixture head');
assert.equal(execFileSync('git', ['-C', fixture, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '', 'fixture tracked files must be unchanged');
const outputRoot = path.join(root, '.codex-tmp/kasper-roster');
fs.mkdirSync(outputRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(outputRoot, new Date().toISOString().replace(/[:.]/g, '-') + '-'));
const deferred = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
class TimingBackend extends Backend {
  constructor() {
    super('video', 'Kasper Approval', false);
    this.rows.push({ ...clone(this.rows[0]), id: 'fixture-unlisted', client: 'fictionalunlisted', name: 'Fictional unlisted card' });
    this.rosterRequests = 0; this.rosterResponses = 0; this.calendarRequests = 0; this.metricsFailures = 0;
    this.calendarGates = []; this.rosterGate = null; this.holdCalendar = false;
  }
  holdRoster() { this.rosterGate = deferred(); return this.rosterGate; }
  release() { super.release(); this.rosterGate?.release(); this.calendarGates.forEach(g => g.release()); }
  async handle(route, session, origin) {
    const req = route.request(), u = new URL(req.url());
    if (this.metricsFault && req.method() === 'GET' && u.hostname === 'docs.google.com' && u.searchParams.get('sheet') === 'Metrics') {
      this.metricsFailures++;
      return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Fictional metrics unavailable' });
    }
    const roster = req.method() === 'GET' && u.hostname === 'docs.google.com' && u.searchParams.get('sheet') === 'Clients Info';
    if (roster) {
      this.rosterRequests++;
      if (this.rosterGate) await this.rosterGate.promise;
      const fault = this.rosterFault; this.rosterFault = null;
      if (fault) return fault === 'network' ? route.abort('failed')
        : route.fulfill({ status: 503, contentType: 'text/plain', body: 'Fictional unavailable roster' });
      await super.handle(route, session, origin); this.rosterResponses++; return;
    }
    const calendar = req.method() === 'GET' && u.hostname === this.apiHost && u.pathname === '/rest/v1/calendar_posts' && u.searchParams.has('or');
    if (calendar) {
      this.calendarRequests++;
      const rows = clone(this.rows.filter(r => r.status !== 'Archived'));
      this.records.push({ session, action: 'read:calendar_posts', outcome: 'read', row_count: rows.length });
      if (this.holdCalendar) { const gate = deferred(); this.calendarGates.push(gate); await gate.promise; }
      return route.fulfill({ status: this.calendarFault ? 503 : 200, contentType: 'application/json',
        body: JSON.stringify(this.calendarFault ? { ok: false } : rows) });
    }
    if (this.calendarFault && u.hostname === this.webhookHost && ['/webhook/kasper-queue', '/webhook/calendar-get'].includes(u.pathname)) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
    }
    return super.handle(route, session, origin);
  }
}
const card = p => p.locator(`.kcard[data-kasper-pid="${ui.ID}"]`);
async function settled(p) { await p.waitForFunction(() => !_kasperState.loading); }
async function refreshing(p, expected) {
  await ui.until(async () => {
    const state = await p.locator('#kasperReviewRefreshPill').evaluate(el => ({ hidden: el.hidden, opacity: Number(getComputedStyle(el).opacity) }));
    return state.hidden === !expected && (expected ? state.opacity > 0.95 : state.opacity < 0.05);
  }, 'refresh indicator reflects its current read owner');
}
async function direct(h, b) { const s = await h.session(b, 'admin'); await h.open(s, 'kasper'); await s.page.locator('#kasperReviewBody').waitFor(); return s; }
async function ready(h, b) { const s = await ui.reviewer(h, b, 'video'); await card(s.page).waitFor(); await settled(s.page); return s; }
const cases = {
  'metrics-http-client-calendar': async (h, b, observe) => {
    b.metricsFault = true;
    b.rows[0].status = b.rows[0].video_status = 'Client Approval'; b.native[0].status = 'client_approval';
    const s = await h.session(b, 'client'); await h.open(s);
    await s.page.waitForFunction(() => document.querySelector('.cal-review-wrap') || document.querySelector('[data-client-entry-state="retry"]'));
    observe.client_calendar = await s.page.locator('.cal-review-wrap').count();
    observe.eligible_cards = await s.page.locator('.cal-review-card').count();
    observe.retry_screen = await s.page.locator('[data-client-entry-state="retry"]').count();
    observe.verifier_requests = b.records.filter(r => r.action === 'client-token-verify').length;
    assert.equal(b.metricsFailures, 1, 'only Metrics HTTP read fails');
    assert.equal(b.rosterResponses, 1, 'Clients Info remains healthy');
    assert.equal(observe.verifier_requests, 1, 'real entry verifier transport was exercised');
    assert.equal(observe.retry_screen, 0, 'analytics failure must not turn a verified Calendar link into a retry screen');
    assert.equal(observe.eligible_cards, 1, 'anonymous client still sees the eligible review card');
  },
  'metrics-http-kasper': async (h, b, observe) => {
    b.metricsFault = true; const s = await direct(h, b); await settled(s.page);
    observe.eligible_cards = await card(s.page).count();
    assert.equal(b.metricsFailures, 1); assert.equal(b.rosterResponses, 1);
    assert.equal(observe.eligible_cards, 1, 'healthy roster still admits the eligible Kasper card when Metrics returns 503');
  },
  'calendar-fast': async (h, b, observe) => {
    const roster = b.holdRoster(), s = await direct(h, b);
    await ui.until(() => b.rosterRequests > 0, 'roster requested');
    // Calendar is immediately available; hold only the roster long enough for
    // the old implementation to complete and publish its premature empty read.
    await s.page.waitForTimeout(250);
    observe.calendar_started_before_roster = b.calendarRequests;
    roster.release(); await ui.until(() => b.rosterResponses > 0, 'roster responded');
    await settled(s.page); await card(s.page).waitFor();
  },
  'roster-first': async (h, b) => {
    b.holdCalendar = true; const s = await direct(h, b);
    await ui.until(() => b.rosterResponses > 0 && b.calendarGates.length > 0, 'roster arrives before held Calendar response');
    b.calendarGates[0].release(); await settled(s.page); await card(s.page).waitFor();
  },
  'cached-reload': async (h, b) => {
    const s = await ready(h, b), roster = b.holdRoster();
    await s.page.reload(); await s.page.locator('#kasperReviewBody').waitFor();
    await ui.until(() => b.rosterRequests >= 2, 'reload roster held');
    await s.page.waitForTimeout(250); await card(s.page).waitFor();
    await refreshing(s.page, true);
    roster.release(); await settled(s.page); await card(s.page).waitFor();
  },
  'roster-network-error': async (h, b) => rosterError(h, b, 'network'),
  'roster-http-error': async (h, b) => rosterError(h, b, 'http'),
  'calendar-error': async (h, b) => {
    b.calendarFault = true; const s = await direct(h, b);
    await s.page.locator('[data-kasper-unloaded]').waitFor(); await settled(s.page);
    assert(Number(await s.page.locator('[data-kasper-unloaded]').getAttribute('data-kasper-unloaded')) > 0, 'unread clients are reported');
    b.calendarFault = false; await s.page.locator('[data-kasper-tab="review"]').click();
    await card(s.page).waitFor(); await settled(s.page);
    assert.equal(await s.page.locator('[data-kasper-unloaded]').count(), 0, 'successful refresh clears the read failure');
  },
  'overlap-old-first': async (h, b) => overlap(h, b, false),
  'overlap-new-first': async (h, b) => overlap(h, b, true),
  'mutation-during-roster': async (h, b) => {
    const s = await ready(h, b), roster = b.holdRoster(); b.holdCalendar = true;
    await s.page.reload(); await card(s.page).waitFor();
    await ui.until(() => b.rosterRequests >= 2, 'roster wait active');
    const panel = await ui.review(s.page, 'video', true), start = b.records.length;
    await panel.locator('.cal-review-approve-btn').click(); await ui.accepted(b, start);
    await ui.queue(s.page, 'kasper', false);
    b.holdCalendar = false; b.release(); await settled(s.page);
    assert.equal(await card(s.page).count(), 0, 'invalidated read cannot resurrect approved card');
    assert.equal(b.rows[0].video_status, 'Client Approval', 'fixture accepted approval remains');
    await refreshing(s.page, false);
  },
};
async function rosterError(h, b, fault) {
  b.rosterFault = fault; const s = await direct(h, b);
  await s.page.getByText("Couldn't load the queue", { exact: true }).waitFor();
  await s.page.getByText('Client list could not load. Refresh to try again.', { exact: true }).waitFor();
  await settled(s.page);
  assert.equal(b.calendarRequests, 0, 'failed roster never certifies an empty queue');
  await s.page.locator('[data-kasper-tab="review"]').click(); await card(s.page).waitFor(); await settled(s.page);
  assert.equal(b.rosterRequests, 2, 'one visible Review revisit retries roster once');
}
async function overlap(h, b, newerFirst) {
  const s = await ready(h, b), p = s.page; b.holdCalendar = true;
  b.rows[0].name = 'Fictional older snapshot';
  await p.locator('[data-kasper-tab="review"]').click();
  await ui.until(() => b.calendarGates.length === 1, 'older read held');
  b.rows[0].name = 'Fictional newer snapshot';
  await p.locator('[data-kasper-tab="review"]').click();
  await ui.until(() => b.calendarGates.length === 2, 'newer read held');
  b.calendarGates[newerFirst ? 1 : 0].release();
  if (newerFirst) await card(p).filter({ hasText: 'Fictional newer snapshot' }).waitFor();
  else {
    await p.waitForTimeout(200);
    await refreshing(p, true);
    assert(await p.evaluate(() => _kasperState.loading), 'newer request still owns loading');
  }
  b.calendarGates[newerFirst ? 0 : 1].release();
  await settled(p); await card(p).filter({ hasText: 'Fictional newer snapshot' }).waitFor();
  await p.waitForTimeout(100);
  assert(!(await card(p).innerText()).includes('Fictional older snapshot'), 'stale response cannot repaint');
}
async function main() {
  const selected = option('--case', Object.keys(cases).join(',')).split(',');
  assert(selected.every(id => cases[id]), 'unknown case');
  const before = provenance(source), h = await new Harness(source, output).start();
  const report = { evidence: 'ISOLATED_BROWSER', source: before, fixture: toolingProvenance(),
    runner_sha256: hash(fs.readFileSync(__filename)), started_at: new Date().toISOString(), browser: h.browser.version(), cells: [] };
  try {
    for (const id of selected) {
      const b = new TimingBackend(), cell = { id, verdict: 'PASS', observations: {} }; report.cells.push(cell);
      try {
        await cases[id](h, b, cell.observations);
        if (id !== 'mutation-during-roster') assert.equal(b.records.filter(r => r.outcome === 'accepted').length, 0, 'reader case makes no accepted fixture mutation');
        for (const s of h.sessions.filter(s => !s.page.isClosed())) {
          assert.equal(await s.page.locator('.kcard[data-kasper-pid="fixture-unlisted"]').count(), 0, 'unlisted raw slug remains filtered');
        }
        assert.equal(b.blocked.length, 0, 'unexpected external request');
        assert.equal(h.sessions.flatMap(s => s.sockets).length, 0, 'unexpected websocket');
        assert.equal(h.sessions.flatMap(s => s.errors).length, 0, 'unexpected page error');
      } catch (e) {
        cell.verdict = 'FAIL'; cell.failure_class = /Timeout/.test(e.message) ? 'visible_contract_timeout' : 'contract_assertion';
        fs.writeFileSync(path.join(output, id + '-private.txt'), e.stack || String(e));
        const p = h.sessions.at(-1)?.page; if (p && !p.isClosed()) await h.shot(p, id).catch(() => {});
      } finally {
        b.release();
        cell.observations = { ...cell.observations, roster_requests: b.rosterRequests, calendar_requests: b.calendarRequests, metrics_http_failures: b.metricsFailures,
          unexpected_http: b.blocked.length, unexpected_sockets: h.sessions.flatMap(s => s.sockets).length,
          page_errors: h.sessions.flatMap(s => s.errors).length, accepted_fixture_effects: b.records.filter(r => r.outcome === 'accepted').length };
        const privateData = JSON.stringify({ records: b.records, blocked: b.blocked, console_errors: h.sessions.flatMap(s => s.consoleErrors) });
        fs.writeFileSync(path.join(output, id + '-private.json'), privateData); cell.records_sha256 = hash(privateData);
        await h.closeSessions(); console.log(cell.verdict + ' ' + id);
      }
    }
  } finally {
    await h.close(); report.finished_at = new Date().toISOString();
    report.source_unchanged = before.tracked_bytes_sha256 === provenance(source).tracked_bytes_sha256;
    report.serving = { kind: 'loopback-static', document_count: h.documentHashes.length, observed_hashes: [...new Set(h.documentHashes)], deployed_revision: 'UNPROVEN' };
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
  }
  console.log('Artifacts: ' + output);
  process.exitCode = report.cells.some(c => c.verdict !== 'PASS') || !report.source_unchanged ? 1 : 0;
}
main().catch(e => { fs.writeFileSync(path.join(output, 'runner-private.txt'), e.stack || String(e)); console.error('FAIL runner_setup'); process.exitCode = 1; });
