'use strict';
// Decisive proof for Calendar feedback recovery: the COMPLETE document, the
// ACTUAL offered client controls, the ACTUAL production-write handler and the
// FROZEN calendar-upsert handler running in-process, and a disposable
// PostgreSQL 16 behind every calendar/deliverable read and every write. Only
// third-party resources, the n8n reads and unrelated tables stay fictional.
// comment accepted -> own status accepted -> source refused -> refresh ->
// Retry card sync completes exactly once.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { Harness, ROOT } = require('../feedback-drafts/harness');
const { Backend, CLIENTS, clone } = require('../feedback-drafts/mock-backend');
const ui = require('../feedback-drafts/ui');
const pg = require('./pg');
const { PgSupabase } = require('./seam');

const BASE = process.env.CALENDAR_RECOVERY_BASELINE || '7e5a743cce8a1552bc822e0e560896451f983cdf';
const BASELINE_MODE = process.argv.includes('--baseline');
const SOURCE = path.resolve(process.env.FEEDBACK_SOURCE || ROOT);
const OUT = path.join(ROOT, '.codex-tmp', 'calendar-feedback-recovery-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(OUT, { recursive: true });
const ID = ui.ID, body = 'Fictional feedback original', newer = 'Fictional feedback newer';
const recoveryPanel = (s, comp) => s.page.locator(`[data-cal-review-recovery="${comp}"]`);
const retryButton = (s, comp) => recoveryPanel(s, comp).getByRole('button', { name: 'Retry card sync', exact: true });

class PgBackend extends Backend {
  constructor(db, edge, handlers) {
    super('video', 'Client Approval', false);
    this.db = db; this.edge = edge; this.handlers = handlers;
    this.sourceOutcome = 'refused'; this.statusOutcome = null; this.sourceRequests = []; this.gatewayRequests = []; this.pending = [];
    this.holdRecovery = false; this.beforeGateway = null;
  }
  release() { this.pending.splice(0).forEach(r => r()); super.release(); }
  filter(rows, url) {
    return rows.filter(row => [...url.searchParams].every(([key, value]) => {
      if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
      if (value.startsWith('in.(')) return value.slice(4, -1).split(',').map(v => v.replace(/^"|"$/g, '')).includes(String(row[key]));
      return true;
    }));
  }
  headersFor(req) {
    const out = {};
    for (const [k, v] of Object.entries(req.headers())) if (/^x-syncview-/i.test(k)) out[k.toLowerCase()] = v;
    return out;
  }
  async handle(route, role, origin) {
    const q = route.request(), url = new URL(q.url()), p = url.pathname, method = q.method();
    let data; try { data = q.postDataJSON(); } catch {}
    const send = (status, payload, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(payload) });
    if (method === 'GET' && p === '/rest/v1/calendar_posts') {
      let rows = this.filter(this.db.rows('select * from public.calendar_posts'), url);
      if (url.searchParams.has('or')) rows = rows.filter(row => row.status !== 'Archived');
      this.records.push({ session: role, action: 'read:calendar_posts', body: {}, outcome: 'read', row_count: rows.length });
      return send(200, rows, { 'content-range': rows.length ? '0-' + (rows.length - 1) + '/' + rows.length : '*/0', 'access-control-expose-headers': 'content-range' });
    }
    if (method === 'GET' && (p === '/rest/v1/deliverables' || p === '/rest/v1/production_deliverables_browser_v1')) {
      const rows = this.filter(this.db.rows('select * from public.deliverables'), url).map(row => ({ ...row, version: 1 }));
      this.records.push({ session: role, action: 'read:deliverables', body: {}, outcome: 'read', row_count: rows.length });
      return send(200, rows);
    }
    if (method === 'GET' && p === '/webhook/calendar-get') {
      const rows = this.db.rows(`select * from public.calendar_posts where client = ${pg.lit(url.searchParams.get('client'))}`);
      return send(200, { ok: true, posts: rows });
    }
    if (method === 'POST' && p === '/functions/v1/production-comments') {
      const rows = this.db.rows(`select * from public.production_comments where deliverable_id = ${pg.lit(String(data && data.deliverable_id || ''))} and audience = 'client' and deleted_at is null`);
      return send(200, { ok: true, comments: rows, has_more: false, next_cursor: null });
    }
    if (method === 'POST' && p === '/functions/v1/production-write' && data && data.operation) {
      const entry = { kind: data.recover_source ? 'recover_source' : data.reconcile_only ? 'reconcile_only' : String(data.operation), body: clone(data) };
      this.gatewayRequests.push(entry);
      if (entry.kind === 'recover_source' && this.holdRecovery) await new Promise(resolve => this.pending.push(resolve));
      if (this.beforeGateway) await this.beforeGateway(entry);
      const result = await this.edge.invoke(this.handlers.productionWrite.handler, data, this.headersFor(q));
      await this.edge.drainBackground();
      entry.status = result.status; entry.response = result.body;
      if (entry.kind === 'status' && this.statusOutcome === 'lost' && result.status === 200) { entry.lost = true; return route.abort('failed'); }
      return send(result.status, result.body);
    }
    if (method === 'POST' && p === '/functions/v1/calendar-upsert') {
      const entry = { body: clone(data), outcome: 'held' }; this.sourceRequests.push(entry);
      if (this.sourceOutcome === 'refused') { entry.outcome = 'refused'; return send(403, { ok: false, error: 'synthetic_write_refused' }); }
      const result = await this.edge.invoke(this.handlers.calendarUpsert.handler, data, this.headersFor(q));
      await this.edge.drainBackground();
      entry.status = result.status; entry.outcome = result.status === 200 ? 'accepted' : 'refused';
      if (this.sourceOutcome === 'lost' && result.status === 200) { entry.lost = true; return route.abort('timedout'); }
      return send(result.status, result.body);
    }
    return super.handle(route, role, origin);
  }
}

async function openClient(h, b, storageState) {
  const s = await h.session(b, 'client', { storageState }); await h.open(s);
  // A client who last used the Sheet (the notes overlay lives there) lands on
  // it again; Review is one offered click away, exactly as they would do.
  const wrap = s.page.locator('.cal-review-wrap'), review = s.page.locator('[data-cal-view="review"]');
  await s.page.locator('.cal-review-wrap, [data-cal-view="review"]').first().waitFor();
  if (!await wrap.isVisible() && await review.isVisible()) await review.click();
  await wrap.waitFor(); return s;
}
async function settled(s) {
  await ui.until(() => s.page.evaluate(() => Object.keys(_calSaveInFlight).length === 0 && Object.values(_calReviewState.saving).every(v => !v)), 'save settles', 15000);
}
async function submitTweak(h, b, comp) {
  const s = await openClient(h, b);
  const panel = await ui.review(s.page, comp);
  await panel.locator('.cal-review-textarea').fill(body);
  await panel.locator('.cal-review-tweak-btn').click();
  await ui.until(() => b.sourceRequests.length > 0 || b.gatewayRequests.some(g => g.kind === 'status' && g.lost), 'source save attempted', 15000);
  await settled(s); return s;
}
async function submitNote(h, b, comp) {
  const s = await openClient(h, b);
  await ui.review(s.page, comp);
  await s.page.locator(`[data-cal-review-pid="${ID}"] .kcard-open-sheet`).click();
  await ui.card(s.page).waitFor();
  await ui.card(s.page).locator('.cal-comments-btn').click();
  await s.page.locator('#calCommentsOverlay.open').waitFor();
  if (comp !== 'video') await s.page.locator(`[data-cm-toggle="comp"] [data-comp="${comp}"]`).click();
  await s.page.locator('#calCommentComposer').fill(body);
  await s.page.locator('.cal-cm-send').click();
  await ui.until(() => b.sourceRequests.length > 0, 'source save attempted', 15000);
  await settled(s);
  // The open modal reports the pending source sync in a notice; dismiss it
  // the way a client would before closing the notes overlay.
  const notice = s.page.locator('#confirmOverlay.active');
  if (await notice.isVisible()) {
    assert.match(await notice.innerText(), /Note source sync pending/, 'the client is told the native note is safe');
    await notice.locator('#confirmYes').click(); await ui.until(async () => !await notice.isVisible(), 'notice dismissed');
  }
  await ui.closeNotes(s.page);
  return s;
}
async function fresh(h, b, s) {
  const storage = await s.context.storageState(); await s.context.close();
  const next = await openClient(h, b, storage); await next.page.waitForLoadState('networkidle');
  const card = next.page.locator(`[data-cal-review-pid="${ID}"]`);
  if (await card.isVisible() && !await next.page.locator('[data-cal-review-recovery]').first().isVisible()) await card.locator('.kcard-expand-btn').click();
  return next;
}
async function retry(s, comp) {
  await retryButton(s, comp).click();
  await ui.until(() => s.page.evaluate(() => [..._reviewDraftRecords.values()].every(c => !c.recovering)), 'recovery settles', 20000);
}
const attempts = s => s.page.evaluate(() => [..._reviewDraftRecords.values()].filter(c => c.value.attempt).map(c => ({ comp: c.comp, attempt: c.value.attempt, failure: c.recoveryFailure || null, error: c.recoveryError || null })));
const storedAttempts = s => s.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('syncview_review_draft_v1:')).map(k => JSON.parse(localStorage.getItem(k))).filter(v => v.attempt).map(v => ({ comp: v.comp, attempt: v.attempt })));
function cellOf(db, comp) { const text = db.scalar(`select ${pg.ident(comp + '_tweaks')} from public.calendar_posts where id = ${pg.lit(ID)}`); return text ? JSON.parse(text) : []; }
function guards(h, b) {
  assert.equal(b.blocked.length, 0, 'every external request is answered locally: ' + JSON.stringify(b.blocked.slice(0, 3)));
  assert.deepEqual(h.sessions.flatMap(s => s.errors), [], 'no page error');
}

async function main() {
  const edge = await import(pathToFileURL(path.join(__dirname, 'edge.mjs')).href);
  const cluster = pg.Cluster.start();
  const db = pg.createDatabase(cluster, 'cfr_browser');
  const schema = pg.loadSchema(db);
  const seam = new PgSupabase(db); edge.useSeam(() => seam);
  const handlers = { productionWrite: await edge.loadProductionWrite(BASELINE_MODE ? BASE : null), calendarUpsert: await edge.loadCalendarUpsert() };
  const h = await new Harness(SOURCE, OUT).start();
  const report = { status: 'INCOMPLETE', mode: BASELINE_MODE ? 'baseline' : 'candidate', source: SOURCE, indexSha256: require('node:crypto').createHash('sha256').update(h.index).digest('hex'),
    handlers: { productionWrite: handlers.productionWrite, calendarUpsert: handlers.calendarUpsert.source_sha256 }, schema, browser: h.browser.version(), groups: [], checks: 0 };
  const check = (condition, message) => { assert.ok(condition, message); report.checks++; };
  const eq = (a, b, message) => { assert.equal(a, b, message); report.checks++; };
  const run = async (name, fn) => {
    try { await fn(); report.groups.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
    catch (error) { report.groups.push({ name, status: 'FAIL', error: error.message }); console.log('FAIL ' + name + ': ' + error.message); throw error; }
    finally { await h.closeSessions(); }
  };
  const f = () => pg.seedFixture(db);
  try {
    if (BASELINE_MODE) {
      await run('baseline document + baseline handler: Retry card sync holds and the source copy never materializes', async () => {
        f(); const b = new PgBackend(db, edge, handlers); let s = await submitTweak(h, b, 'video');
        const before = pg.snapshot(db); eq(before.comments, 1); eq(before.outbox_status, 1); eq(cellOf(db, 'video').length, 0);
        s = await fresh(h, b, s); check(await recoveryPanel(s, 'video').isVisible(), 'pending access');
        await retry(s, 'video');
        const after = pg.snapshot(db);
        eq(cellOf(db, 'video').length, 0, 'baseline: source copy still missing'); eq(after.materializations, 0);
        eq(after.card.video_status, 'Client Approval');
        check(await recoveryPanel(s, 'video').isVisible(), 'baseline keeps holding'); check((await attempts(s)).length === 1, 'attempt still owned');
        check(!b.gatewayRequests.some(g => g.kind === 'recover_source'), 'baseline never offers recovery');
        guards(h, b);
      });
      report.status = 'PASS'; return;
    }
    for (const comp of ['video', 'graphic']) for (const kind of ['tweak', 'note']) {
      await run(`${comp} ${kind}: comment accepted, own status accepted, source refused, refresh, Retry card sync completes exactly once`, async () => {
        f(); const b = new PgBackend(db, edge, handlers);
        let s = kind === 'tweak' ? await submitTweak(h, b, comp) : await submitNote(h, b, comp);
        const before = pg.snapshot(db);
        eq(before.comments, 1, 'one native comment'); eq(before.receipts, 1); eq(before.outbox_comment, 1);
        eq(before.outbox_status, kind === 'tweak' ? 1 : 0, 'own status receipt'); eq(before.status_events, kind === 'tweak' ? 1 : 0);
        eq(db.scalar(`select status from public.deliverables where id = ${pg.lit(kind === 'tweak' ? (comp === 'video' ? b.video : b.graphic) : '')} or true limit 1`) != null, true);
        eq(cellOf(db, comp).length, 0, 'source refused: no copy'); eq(before.card[comp + '_status'], 'Client Approval'); eq(before.card.updated_at, pg.FIXTURE.clock);
        eq(b.sourceRequests.length, 1); eq(b.sourceRequests[0].outcome, 'refused');
        const captured = await storedAttempts(s);
        eq(captured.length, 1); eq(captured[0].comp, comp); eq(captured[0].attempt.kind, kind); eq(captured[0].attempt.phase, 'native');
        check(typeof captured[0].attempt.recoveryPayload === 'string', 'exact native request captured');
        eq(captured[0].attempt.recoverySource.expected_updated_at, pg.FIXTURE.clock, 'original source revision captured');
        assert.deepEqual(Object.keys(captured[0].attempt.recoverySource.fields).sort(), kind === 'tweak' ? [comp + '_status', 'status'].sort() : []); report.checks++;
        if (kind === 'tweak') { eq(captured[0].attempt.statusReservation.result, 'accepted', 'companion status reserved and receipted'); check(JSON.parse(captured[0].attempt.statusReservation.payload).request_id === b.gatewayRequests.find(g => g.kind === 'status').body.request_id, 'reserved identity is the exact sent request'); }
        s = await fresh(h, b, s);
        check(await recoveryPanel(s, comp).isVisible(), 'same-link fresh page retains exact pending access');
        check((await recoveryPanel(s, comp).innerText()).includes(body), 'original text visible');
        eq(await recoveryPanel(s, comp).locator('.cal-review-approve-btn,.cal-review-tweak-btn').count(), 0, 'no second native action offered');
        const sourceBefore = b.sourceRequests.length, gatewayBefore = b.gatewayRequests.length;
        await retry(s, comp);
        const recoveries = b.gatewayRequests.slice(gatewayBefore);
        eq(recoveries.length, 1, 'exactly one gateway request'); eq(recoveries[0].kind, 'recover_source'); eq(recoveries[0].status, 200, JSON.stringify(recoveries[0].response).slice(0, 300));
        eq(recoveries[0].response.outcome, 'materialized');
        eq(b.sourceRequests.length, sourceBefore, 'no browser-side source write');
        const after = pg.snapshot(db), entries = cellOf(db, comp);
        eq(entries.length, 1, 'exactly one source copy'); eq(entries[0].id, captured[0].attempt.id, 'original logical id'); eq(entries[0].body, body); eq(entries[0].role, 'client'); eq(entries[0].is_tweak, kind === 'tweak');
        eq(after.card[comp + '_status'], kind === 'tweak' ? 'Tweaks Needed' : 'Client Approval'); eq(after.card.status, kind === 'tweak' ? 'Tweaks Needed' : 'Client Approval');
        eq(after.card[(comp === 'video' ? 'graphic' : 'video') + '_status'], 'Client Approval');
        eq(after.card.tweaks, comp === 'video' ? after.card.video_tweaks : '', 'video alias mirrored');
        eq(after.comments, 1); eq(after.receipts, 1); eq(after.outbox, before.outbox); eq(after.status_events, before.status_events); eq(after.materializations, 1);
        eq(after.calendar_events, before.calendar_events + (kind === 'tweak' ? 3 : 1));
        eq((await attempts(s)).length, 0, 'only the owned attempt retired'); eq((await storedAttempts(s)).length, 0);
        await ui.until(async () => !await recoveryPanel(s, comp).isVisible(), 'resolved access disappears');
        check(!await s.page.locator('[data-cal-review-recovery]').first().isVisible(), 'no other recovery panel');
        eq(await s.page.evaluate(({ ID, comp, body }) => { const p = calState.posts.find(p => p.id === ID); return _calCommentsFor(p, comp).filter(c => c.body === body).length; }, { ID, comp, body }), 1, 'local card carries the copy once');
        s = await fresh(h, b, s);
        eq((await attempts(s)).length, 0, 'nothing pending after reload'); check(!await s.page.locator('[data-cal-review-recovery]').first().isVisible(), 'no recovery panel after reload');
        eq(pg.snapshot(db).materializations, 1); eq(cellOf(db, comp).length, 1);
        guards(h, b); eq(edge.externalRequests(), 0);
      });
    }
    await run('response loss: the frozen writer committed, the browser lost the response, Retry confirms without a second copy', async () => {
      f(); const b = new PgBackend(db, edge, handlers); b.sourceOutcome = 'lost';
      let s = await submitTweak(h, b, 'video');
      const before = pg.snapshot(db); eq(cellOf(db, 'video').length, 1, 'committed by the frozen writer'); eq(before.card.video_status, 'Tweaks Needed'); eq(b.sourceRequests[0].lost, true);
      s = await fresh(h, b, s); check(await recoveryPanel(s, 'video').isVisible(), 'pending until confirmed');
      const sourceBefore = b.sourceRequests.length; await retry(s, 'video');
      const recovery = b.gatewayRequests.filter(g => g.kind === 'recover_source'); eq(recovery.length, 1); eq(recovery[0].response.outcome, 'already_present');
      eq(b.sourceRequests.length, sourceBefore, 'no repeat source write'); eq(cellOf(db, 'video').length, 1);
      const after = pg.snapshot(db); eq(after.materializations, 1); eq(after.card.updated_at, before.card.updated_at, 'source row untouched'); eq(after.calendar_events, before.calendar_events);
      eq((await attempts(s)).length, 0); guards(h, b);
    });
    await run('status response lost after acceptance: the reserved identity still proves the companion status', async () => {
      f(); const b = new PgBackend(db, edge, handlers); b.statusOutcome = 'lost';
      let s = await submitTweak(h, b, 'graphic');
      const before = pg.snapshot(db); eq(before.outbox_status, 1, 'status landed'); eq(before.comments, 1); eq(cellOf(db, 'graphic').length, 0);
      eq(b.sourceRequests.length, 0, 'source save never started'); const captured = await storedAttempts(s);
      eq(captured[0].attempt.statusReservation.result, 'lost'); eq(captured[0].attempt.phase, 'native');
      s = await fresh(h, b, s); check(await recoveryPanel(s, 'graphic').isVisible()); await retry(s, 'graphic');
      eq(b.gatewayRequests.filter(g => g.kind === 'recover_source')[0].response.outcome, 'materialized');
      eq(cellOf(db, 'graphic').length, 1); eq(pg.snapshot(db).card.graphic_status, 'Tweaks Needed'); eq((await attempts(s)).length, 0); guards(h, b);
    });
    for (const action of ['edit', 'delete']) await run(`native ${action} racing the retry: recovery holds under lock, no stale source copy`, async () => {
      f(); const b = new PgBackend(db, edge, handlers); let s = await submitTweak(h, b, 'video');
      const comment = db.one('select id, version, updated_at from public.production_comments');
      let raced = false;
      b.beforeGateway = async entry => {
        if (entry.kind !== 'recover_source' || raced) return; raced = true;
        const lifecycle = { ...entry.body, request_id: `calendar:comment:${comment.id}:${action}`, source_edited_at: '2026-09-05T12:05:00.000Z',
          comment: { ...entry.body.comment, action, id: comment.id, expected_version: comment.version, expected_updated_at: comment.updated_at, ...(action === 'edit' ? { body: 'Fictional newer native revision' } : {}) } };
        delete lifecycle.recover_source;
        const changed = await edge.invoke(handlers.productionWrite.handler, lifecycle, { 'x-syncview-client-token': pg.FIXTURE.client.token });
        assert.equal(changed.status, 200, JSON.stringify(changed.body).slice(0, 200)); await edge.drainBackground();
      };
      s = await fresh(h, b, s); const before = pg.snapshot(db); await retry(s, 'video');
      eq(raced, true, 'race reached the commit'); const recovery = b.gatewayRequests.filter(g => g.kind === 'recover_source')[0];
      eq(recovery.status, 409); eq(recovery.response.reason, 'native_lifecycle_changed');
      eq(cellOf(db, 'video').length, 0, 'no stale source copy'); eq(pg.snapshot(db).materializations, 0); eq(pg.snapshot(db).card.updated_at, before.card.updated_at);
      check(await recoveryPanel(s, 'video').isVisible(), 'held visibly'); check(/edited, deleted or resolved/.test(await recoveryPanel(s, 'video').innerText()), 'precise sentence');
      check((await recoveryPanel(s, 'video').innerText()).includes(body), 'original text kept'); eq((await attempts(s)).length, 1); eq(pg.snapshot(db).comments, 1, 'no duplicate native submission');
      guards(h, b);
    });
    await run('unrelated source edit after capture holds under the original-source-row CAS and keeps the newer typing', async () => {
      f(); const b = new PgBackend(db, edge, handlers); let s = await submitNote(h, b, 'video');
      const edited = await edge.invoke(handlers.calendarUpsert.handler, { client: pg.FIXTURE.client.slug, post: { id: ID, caption: 'Fictional unrelated caption edit' }, comments_base_at: '' }, { 'x-syncview-client-token': pg.FIXTURE.client.token, 'x-syncview-role': 'client' });
      assert.equal(edited.status, 200); await edge.drainBackground();
      s = await fresh(h, b, s); const before = pg.snapshot(db);
      b.holdRecovery = true; await retryButton(s, 'video').click(); await ui.until(() => b.pending.length > 0, 'recovery held');
      eq(await retryButton(s, 'video').isDisabled(), true, 'pending repeat click suppressed');
      await recoveryPanel(s, 'video').getByRole('textbox', { name: 'Newer unsent note' }).fill(newer);
      b.release(); await ui.until(() => s.page.evaluate(() => [..._reviewDraftRecords.values()].every(c => !c.recovering)), 'settles');
      eq(b.gatewayRequests.filter(g => g.kind === 'recover_source')[0].response.reason, 'source_row_changed');
      check(/card changed after your feedback/.test(await recoveryPanel(s, 'video').innerText()), 'precise sentence');
      check((await recoveryPanel(s, 'video').innerText()).includes(body)); eq(await recoveryPanel(s, 'video').getByRole('textbox', { name: 'Newer unsent note' }).inputValue(), newer, 'newer typing kept');
      assert.deepEqual(pg.snapshot(db).card, before.card); report.checks++; eq(cellOf(db, 'video').length, 0); guards(h, b);
    });
    await run('wrong client: the same link swapped to another client exposes nothing and writes nothing', async () => {
      f(); const b = new PgBackend(db, edge, handlers); let s = await submitTweak(h, b, 'video');
      s = await fresh(h, b, s); const before = pg.snapshot(db), gateway = b.gatewayRequests.length;
      await s.page.goto(h.url('client', 'calendar', CLIENTS[1]), { waitUntil: 'domcontentloaded' }); await s.page.waitForLoadState('networkidle');
      check(!await s.page.locator('[data-cal-review-recovery]').first().isVisible(), 'no owned attempt exposed'); check(!(await s.page.content()).includes(body), 'text never leaks');
      eq(b.gatewayRequests.length, gateway, 'no gateway request'); assert.deepEqual(pg.snapshot(db).card, before.card); report.checks++;
      await s.page.goto(h.url('client'), { waitUntil: 'domcontentloaded' }); await s.page.waitForLoadState('networkidle');
      const card = s.page.locator(`[data-cal-review-pid="${ID}"]`); if (!await recoveryPanel(s, 'video').isVisible()) await card.locator('.kcard-expand-btn').click();
      check((await recoveryPanel(s, 'video').innerText()).includes(body), 'owner still sees it'); guards(h, b);
    });
    await run('old attempt without original context stays visible and unresolved; no guess, no request', async () => {
      f(); const b = new PgBackend(db, edge, handlers); let s = await submitTweak(h, b, 'video');
      await s.page.evaluate(() => { for (const c of _reviewDraftRecords.values()) if (c.value.attempt) { delete c.value.attempt.recoverySource; localStorage.setItem(c.key, JSON.stringify(c.value)); } });
      s = await fresh(h, b, s); const gateway = b.gatewayRequests.length, before = pg.snapshot(db);
      check(/no complete original context/.test(await recoveryPanel(s, 'video').innerText()), 'precise notice'); await retry(s, 'video');
      eq(b.gatewayRequests.length, gateway, 'nothing sent'); check(/no complete original context/.test(await recoveryPanel(s, 'video').innerText()));
      check((await recoveryPanel(s, 'video').innerText()).includes(body)); assert.deepEqual(pg.snapshot(db), before); report.checks++; guards(h, b);
    });
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.error = error.stack; process.exitCode = 1;
    const page = h.sessions.filter(s => !s.page.isClosed()).at(-1)?.page;
    if (page) { try { await h.shot(page, 'failure'); fs.writeFileSync(path.join(OUT, 'failure-diagnostic-private.json'), JSON.stringify({ text: (await page.evaluate(() => document.body.innerText)).slice(-2000), attempts: await attempts({ page }), console: h.sessions.at(-1)?.consoleErrors }, null, 2)); } catch (e) {} }
  } finally {
    await h.close(); cluster.stop(); edge.cleanup();
    fs.writeFileSync(path.join(OUT, 'calendar-feedback-recovery-browser-private.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, mode: report.mode, checks: report.checks, groups: report.groups.length, failed: report.groups.filter(g => g.status !== 'PASS').map(g => g.name), error: report.error && report.error.split('\n').slice(0, 2).join(' | ') }));
    console.log('Evidence ' + OUT);
  }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
