'use strict';
// Actual browser functions with synthetic storage, Web Locks and transport.
// --browser adds a finite Chromium DOM/control check; no app boot or backend.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { extractFunction } = require('./helpers/extract-function');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const base = '16a701a318eaf829a6357bb0352ff7babd51b1c6';
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
gitEnv.GIT_NO_LAZY_FETCH = '1';
const old = execFileSync('git', ['--no-replace-objects', 'show', base + ':index.html'], { cwd: root, env: gitEnv, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const functions = ['_linearIntakeRead', '_linearIntakeWrite', '_linearIntakeJobId', '_linearIntakeRemoveIfCurrent',
  '_linearIntakeWithLock', '_linearIntakeActorError', '_linearIntakeRequireActor', '_linearIntakeRecoveryCopy',
  '_linearIntakePersistRecovery', '_linearIntakeCheckpointOrSuspend', '_linearIntakePending', '_linearIntakePurgeSensitiveState',
  '_linearIntakeValidateResult', '_nativeAcceptedCardTransport', '_nativeAcceptedCurrentCard',
  '_writeNativeSubmissionCardsToCalendar', '_runNativeIntakeJob', '_linearIntakeDiscardTerminallyRefused',
  '_resumeNativeIntakeJob', '_calNativePostErrorText', '_linearIntakeOfferSavedRetry', '_calSubmitNativePost'];
function extract(source, name) {
  const body = extractFunction(source, name);
  return (source.includes('async ' + body) ? 'async ' : '') + body;
}
const script = functions.map(name => extract(html, name)).join('\n') + '\nvar _nativeIntakeResumePromise = null;';
let passed = 0;
const pass = name => { passed++; console.log('PASS ' + name); };
const clone = value => JSON.parse(JSON.stringify(value));
function element() {
  return { isConnected: true, children: [], attrs: {}, _text: '', style: {}, dataset: {},
    set textContent(value) { this._text = value; this.children = []; }, get textContent() { return this._text; },
    setAttribute(key, value) { this.attrs[key] = value; }, appendChild(child) { this.children.push(child); },
    addEventListener(type, fn) { this[type] = fn; } };
}
function job(surface = 'calendar', accepted = false) {
  return { version: 3, signature: accepted ? 'recovery:request-a' : 'signature-a',
    payload: { operation: 'intake_create', request_id: 'request-a', source_edited_at: '2030-01-01T00:00:00.000Z',
      client_slug: 'fixture', surface, batch: { name: 'Saved fictional brief' },
      items: [{ team: 'video', card_id: 'card-a', videoNumber: 1, brief: 'Conserve this exact fictional text' }] },
    context: { initiating_actor_id: 'actor-a', initiating_actor_role: 'smm', surface,
      materialization_source: surface === 'sxr' ? 'samples-native' : 'calendar-native' },
    result: accepted ? result() : null, completed_card_ids: [], request_logged: true, telemetry_sent: true,
    recovery_only: accepted, suspended: accepted, stage: accepted ? 'materializing_cards' : 'request_pending' };
}
function result() { return { ok: true, native_committed: true, items: [{ item_index: 0, id: 'child-a', team: 'video', card_id: 'card-a', video_number: 1, title: 'Fictional title', linear_issue_url: 'https://linear.invalid/fixture' }] }; }
function world(source = script) {
  const store = new Map(), sent = [], notices = [], box = element(), overlay = element(), create = element();
  let lockTail = Promise.resolve(), locks = 0;
  const ctx = { console: { warn() {} }, JSON, Map, Set, Date, String, Number, Object, Array, Promise, Error,
    NATIVE_INTAKE_PENDING_KEY: 'pending', LINEAR_FORM_KEY: 'form', LAST_LINK_KEY: 'link',
    _isIntake: false, identity: { role: 'smm', member: { id: 'actor-a' } }, client: 'fixture',
    localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => { if (ctx.quota) throw Error('quota'); store.set(key, String(value)); }, removeItem: key => store.delete(key) },
    navigator: { locks: { request(name, opts, fn) { assert.equal(name, 'syncview-native-intake'); assert.equal(opts.mode, 'exclusive');
      const count = ++locks;
      const next = lockTail.then(async () => { if (ctx.beforeLock) await ctx.beforeLock(count); return fn(); });
      lockTail = next.catch(() => {}); return next; } } },
    document: { createElement: element, getElementById: id => ({ calNativePostOverlay: overlay, calNativePostCreate: create, calNativePostError: box })[id], querySelector: () => ({ value: 'new' }) },
    _syncviewStaffIdentityForHeaders: () => ctx.identity, _syncviewStaffRoleValue: i => String(i && i.role || ''),
    showNotify: (...args) => notices.push(args), _writeUiQueueDiagnostic() {},
    _linearIntakeLogSubmissionRequest() {}, _linearIntakeSendTelemetry() {},
    PROD_WRITE_EF_URL: 'https://gateway.invalid/write', CAL_SUPABASE_ANON_KEY: 'synthetic', _syncviewEfHeaders: x => x,
    fetch: async (url, opts) => { sent.push({ lane: 'gateway', url, body: opts.body });
      if (ctx.gatewayWait) await ctx.gatewayWait;
      const status = ctx.gatewayStatus || 200;
      return { ok: status === 200, status, json: async () => status === 200 ? clone(ctx.gatewayResult || result()) : ({ ok: false, error: 'synthetic_refusal' }) }; },
    _calCacheRead: () => null, _sxrCacheRead: () => null,
    _calUpsertFetch: async (client, body, source) => card('calendar', client, body, source),
    _sxrUpsertFetch: async (client, body, source) => card('sxr', client, body, source),
    _calUpsertFetchPinned: () => { throw Error('unmarked receipt must not change transport'); },
    _sxrUpsertFetchPinned: () => { throw Error('unmarked receipt must not change transport'); },
    _calNativePostState: { surface: 'calendar', clientSlug: 'fixture', mode: 'video', postCount: 1 },
    _nativePostViewSlug: () => ctx.client, _syncviewRequireStaffIdentity: async () => ctx.identity,
    _calNativePostCount: () => 1, wlTodayISO: () => '2030-01-01', wlAddWorkingDays: () => '2030-01-08',
  };
  async function card(lane, client, body, source) { sent.push({ lane, client, body: clone(body), source });
    if (ctx.cardWait) await ctx.cardWait;
    if (ctx.cardFailure) throw Error('synthetic_card_refusal');
    return { ok: true, json: async () => ({ ok: true }) }; }
  vm.createContext(ctx); vm.runInContext(source, ctx);
  return { ctx, store, sent, notices, box, overlay, create,
    save: value => store.set('pending', JSON.stringify(value)), read: () => JSON.parse(store.get('pending') || 'null'),
    offer: (surface = 'calendar') => ctx._linearIntakeOfferSavedRetry(box, 'fixture', surface, () => ctx.client === 'fixture'),
    locks: () => locks };
}
async function rejection(promise, code) { await assert.rejects(promise, error => error.code === code); }
async function main() {
  for (const [accepted, status, count] of [[true, undefined, 4], [false, 503, 6], [false, 409, 2]]) {
    const before = world(['_linearIntakeRead', '_linearIntakeJobId', '_linearIntakeWrite', '_linearIntakeRemoveIfCurrent', '_linearIntakeDiscardTerminallyRefused'].map(n => extract(old, n)).join('\n'));
    before.save(job('calendar', accepted));
    for (let i = 0; i < count; i++) before.ctx._linearIntakeDiscardTerminallyRefused('resume', 'request-a', { status });
    assert.equal(before.read(), null); pass('BASELINE deletion reproduced at budget ' + count);
    const w = world(), saved = job('calendar', accepted); w.save(saved);
    for (let i = 0; i < count; i++) assert.equal(w.ctx._linearIntakeDiscardTerminallyRefused('resume', 'request-a', { status }), false);
    const held = w.read(); assert.equal(held.resume_held, true); assert.equal(held.resume_refusals, count);
    delete held.resume_held; delete held.resume_refusals; assert.deepEqual(held, saved);
    assert.equal(w.notices.length, 1); assert.match(w.notices[0][1], /completion is unconfirmed/);
    const exact = w.store.get('pending');
    for (const reason of ['resume', 'startup', 'focus', 'visible', 'online', 'staff-verified', 'client-verified', 'timer']) {
      await rejection(w.ctx._resumeNativeIntakeJob(reason), 'native_intake_recovery_held');
    }
    assert.equal(w.sent.length, 0); assert.equal(w.store.get('pending'), exact); pass('candidate conserves budget ' + count + ' and prevents all automatic transports');
  }
  for (const surface of ['calendar', 'sxr', 'submission']) for (const accepted of [false, true]) {
    const w = world(), saved = job(surface, accepted); saved.resume_held = true; saved.resume_refusals = 6; w.save(saved); w.offer(surface);
    assert.equal(w.box.children.length, 1); await w.box.children[0].click();
    assert.equal(w.read(), null); assert.match(w.box.textContent, /completed/);
    assert.equal(w.sent.filter(x => x.lane === 'gateway').length, accepted ? 0 : 1);
    if (!accepted) assert.equal(w.sent[0].body, JSON.stringify(saved.payload));
    const card = w.sent.find(x => x.lane !== 'gateway'); assert.equal(card.lane, surface === 'sxr' ? 'sxr' : 'calendar');
    assert.equal((card.body.sample || card.body.post).id, 'card-a'); assert.equal(card.source, saved.context.materialization_source);
    pass(surface + ' ' + (accepted ? 'accepted recovery never creates' : 'unknown retry reuses exact payload') + ' and original card transport');
  }
  for (const mutation of ['client', 'actor', 'role', 'replaced-id', 'same-id-payload', 'same-id-result', 'intake-mode', 'detached']) {
    const w = world(), saved = job(); saved.resume_held = true; w.save(saved); w.offer(); const button = w.box.children[0];
    if (mutation === 'client') w.ctx.client = 'another';
    if (mutation === 'actor') w.ctx.identity.member.id = 'actor-b';
    if (mutation === 'role') w.ctx.identity.role = 'editor';
    if (mutation === 'intake-mode') w.ctx._isIntake = true;
    if (mutation === 'detached') w.box.isConnected = false;
    if (mutation === 'replaced-id') { saved.payload.request_id = 'replacement'; w.save(saved); }
    if (mutation === 'same-id-payload') { saved.payload.batch.name = 'replacement'; w.save(saved); }
    if (mutation === 'same-id-result') { saved.result = result(); w.save(saved); }
    const exact = w.store.get('pending'); await button.click(); assert.equal(w.sent.length, 0); assert.equal(w.store.get('pending'), exact);
    pass('stale retry refuses ' + mutation);
  }
  for (const mutation of ['client', 'actor', 'replaced-id', 'same-id-payload']) {
    const w = world(), saved = job(); saved.resume_held = true; w.save(saved); w.offer();
    w.ctx.beforeLock = count => { if (count !== 1) return;
      if (mutation === 'client') w.ctx.client = 'another';
      else if (mutation === 'actor') w.ctx.identity.member.id = 'actor-b';
      else { if (mutation === 'replaced-id') saved.payload.request_id = 'replacement'; else saved.payload.batch.name = 'replacement'; w.save(saved); }
    };
    await w.box.children[0].click(); assert.equal(w.sent.length, 0);
    if (mutation.startsWith('replaced') || mutation.startsWith('same')) assert.deepEqual(w.read(), saved);
    pass('fresh under-lock scope refuses ' + mutation);
  }
  for (const status of [409, 503]) {
    const w = world(), saved = job(); saved.resume_held = true; w.save(saved); w.ctx.gatewayStatus = status; w.offer();
    await w.box.children[0].click(); assert.equal(w.sent.length, 1); assert.deepEqual(w.read(), saved);
    assert.equal(w.box.children.length, 1); assert.ok(!/completed\./.test(w.box.textContent)); pass('manual ' + status + ' retains exact unknown request and retry action');
  }
  {
    const w = world(), saved = job(); saved.resume_refusals = 5; w.save(saved); w.ctx.gatewayStatus = 503;
    const replacement = job('sxr'); replacement.payload.request_id = 'new-request';
    w.ctx.beforeLock = count => { if (count === 2) w.save(replacement); };
    await assert.rejects(w.ctx._resumeNativeIntakeJob('resume')); assert.equal(w.locks(), 2); assert.deepEqual(w.read(), replacement);
    pass('failure bookkeeping reacquires the Web Lock and cannot overwrite replacement');
  }
  {
    const w = world(), saved = job(); saved.resume_held = true; w.save(saved); w.offer();
    let release; w.ctx.gatewayWait = new Promise(resolve => { release = resolve; });
    const running = w.ctx._resumeNativeIntakeJob('submit', saved); await new Promise(resolve => setImmediate(resolve));
    await w.box.children[0].click(); assert.match(w.box.textContent, /already being checked/); assert.equal(w.sent.length, 1);
    release(); await running; pass('explicit retry refuses to join an already running request');
  }
  {
    const w = world(), saved = job(); saved.resume_refusals = 5; w.save(saved); w.ctx.quota = true;
    w.ctx._linearIntakeDiscardTerminallyRefused('resume', 'request-a', { status: 503 });
    assert.deepEqual(w.read(), saved); assert.equal(w.notices.length, 0); pass('quota failure retains prior record without a false held receipt');
  }
  for (const surface of ['calendar', 'sxr']) {
    const w = world(), saved = job(surface, true); saved.resume_held = true; w.save(saved); w.ctx._calNativePostState.surface = surface;
    await w.ctx._calSubmitNativePost(); assert.equal(w.box.children.length, 1); assert.equal(w.sent.length, 0);
    pass('actual ' + surface + ' pending-conflict error area exposes saved retry');
    const unknown = job(surface); unknown.resume_held = true; w.save(unknown); w.ctx._linearIntakePending = () => w.ctx._linearIntakeRead(); w.ctx.gatewayStatus = 409;
    await w.ctx._calSubmitNativePost(); assert.deepEqual(w.read(), unknown); assert.equal(w.box.children.length, 1);
    pass('actual ' + surface + ' live 4xx catch preserves a held unknown job');
  }
  {
    const w = world(), saved = job('calendar', true); saved.resume_held = true; saved.resume_refusals = 4; w.save(saved);
    await w.ctx._linearIntakePurgeSensitiveState(); const scrubbed = w.read(); assert.equal(scrubbed.resume_held, true); assert.equal(scrubbed.resume_refusals, 4);
    assert.equal(scrubbed.payload.batch, undefined); assert.equal(scrubbed.context.initiating_actor_id, 'actor-a');
    w.ctx.identity.member.id = 'actor-b'; w.offer(); assert.equal(w.box.children.length, 0);
    w.ctx._isIntake = true; w.offer(); assert.equal(w.box.children.length, 0);
    pass('sign-out scrubbing keeps accepted hold but neither another actor nor client-link sees staff retry');
  }
  for (const name of ['_linearIntakeRequireActor', '_linearIntakePurgeSensitiveState', '_runNativeIntakeJob', '_writeNativeSubmissionCardsToCalendar', '_nativeAcceptedCardTransport', '_linearIntakeWithLock']) {
    assert.equal(extract(html, name), extract(old, name));
  }
  assert.match(extract(html, '_submitLinearFormRoutedOnce'), /_linearIntakeOfferSavedRetry\(status, client.slug, 'submission', selectionStillCurrent\)/);
  pass('writer, transport, actor, shared-device and lock contracts remain byte-identical; Submit action is wired');
  if (process.argv.includes('--browser')) await browser();
  console.log(JSON.stringify({ passed, baseline_deletions: 3, classification: 'OFFLINE_ACTUAL_SOURCE', real_backend: false }));
}
async function browser() {
  const { chromium } = require('playwright'); const browser = await chromium.launch({ headless: true });
  const styles = [/:root\s*\{[^}]+\}/, /html\[data-theme="dark"\]\s*\{[^}]+\}/, /^\s*\.cal-import-btn-ghost\s*\{[^}]+\}/m]
    .map(pattern => { const match = html.match(pattern); assert.ok(match); return match[0]; }).join('\n');
  let attempted = 0;
  try {
    for (const width of [360, 768, 1280]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: theme, hasTouch: true, reducedMotion: 'reduce' });
      await context.route('**/*', route => { attempted++; return route.abort(); }); const page = await context.newPage();
      await page.setContent('<html data-theme="' + theme + '"><style>' + styles + '</style><body style="background:var(--bg);color:var(--text-primary)"><div id="error" style="margin:20px;max-width:480px">Saved request</div></body></html>');
      await page.evaluate(({ helper, text, saved }) => {
        window._isIntake = false; window.saved = saved; window.clientCurrent = true; window.actorCurrent = true;
        window._linearIntakeRead = () => window.saved;
        window._linearIntakeJobId = value => String(value && value.payload && value.payload.request_id || '');
        window._linearIntakeRequireActor = () => { if (!window.actorCurrent) throw Error('actor'); };
        window._resumeNativeIntakeJob = async (reason, job, current) => {
          if (!current(window.saved)) throw Error('stale'); window.called = { reason, payload: JSON.stringify(job.payload) };
          await new Promise(resolve => { window.finish = resolve; });
        };
        (0, eval)(text + '\n' + helper);
        _linearIntakeOfferSavedRetry(document.getElementById('error'), 'fixture', 'calendar', () => window.clientCurrent);
      }, { helper: extract(html, '_linearIntakeOfferSavedRetry'), text: extract(html, '_calNativePostErrorText'), saved: { ...job(), resume_held: true } });
      const button = page.getByRole('button'); assert.equal(await button.count(), 1);
      assert.equal(await button.textContent(), 'Retry saved post');
      const box = await button.boundingBox(); assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width);
      await button.hover(); assert.equal(await button.evaluate(el => getComputedStyle(el).cursor), 'pointer');
      assert.equal(await button.evaluate(el => getComputedStyle(el).color !== getComputedStyle(el).backgroundColor), true);
      await page.keyboard.press('Tab'); assert.equal(await button.evaluate(el => el === document.activeElement), true);
      assert.equal(await button.evaluate(el => parseFloat(getComputedStyle(el).outlineWidth) > 0), true);
      if (theme === 'dark' && width === 360) await button.tap();
      else if (theme === 'dark' && width === 768) await button.click();
      else await page.keyboard.press('Enter');
      await page.waitForFunction(() => !!window.called);
      assert.equal(await button.isDisabled(), true); assert.equal(await page.evaluate(() => window.called.reason), 'manual-recovery');
      await page.evaluate(() => window.finish()); await page.getByRole('status').waitFor();
      assert.equal(await page.getByRole('status').textContent(), 'The saved request completed.');
      await context.close(); pass('ISOLATED_BROWSER styled helper controls and fit ' + width + ' ' + theme);
    }
    assert.equal(attempted, 0);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
