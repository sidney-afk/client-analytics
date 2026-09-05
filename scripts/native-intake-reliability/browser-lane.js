'use strict';
/*
 * Browser lane: the REAL native-intake job machinery, brace-extracted from
 * index.html and executed in a vm context. Nothing is re-implemented; what the
 * context supplies is the browser's environment (localStorage, Web Locks,
 * fetch, the calendar upsert transport, the staff identity reader) as
 * scriptable stubs so faults can be injected at each boundary:
 *   - the gateway response (lost, refused, delayed past an actor switch),
 *   - the calendar-card write (fails for one card),
 *   - localStorage (cleared, over quota),
 *   - the signed-in actor and the open client view.
 * No network is touched: every fetch is recorded and answered locally.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('../../test/helpers/extract-function.js');

const ROOT = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extract(name) {
  const body = extractFunction(html, name);
  const at = html.indexOf(body);
  return (html.slice(at - 6, at) === 'async ' ? 'async ' : '') + body;
}
function constant(name) {
  const m = new RegExp("const " + name + " = '([^']+)';").exec(html);
  if (!m) throw new Error('missing const ' + name + ' in index.html');
  return m[1];
}

const FUNCTIONS = [
  '_linearIntakeRequestId', '_linearIntakeWithLock', '_linearIntakeRead', '_linearIntakeJobId',
  '_linearIntakeWrite', '_linearIntakeRemoveIfCurrent', '_linearIntakeActorContext', '_linearIntakeActorError',
  '_linearIntakeRequireActor', '_linearIntakeRecoveryCopy', '_linearIntakePersistRecovery',
  '_linearIntakeCheckpointOrSuspend', '_linearIntakePurgeSensitiveState', '_linearIntakePending',
  '_linearVideoBrief', '_linearThumbnailBrief', '_linearIntakeBatchTitle', '_linearIntakeItems',
  '_linearIntakeValidateResult', '_writeNativeSubmissionCardsToCalendar', '_linearIntakeSendTelemetry',
  '_linearIntakeLogSubmissionRequest', '_runNativeIntakeJob', '_linearIntakeDiscardTerminallyRefused',
  '_resumeNativeIntakeJob', '_writeUiQueueDiagnostic', '_writeUiDiagnosticIds',
];

function makeWorld() {
  const store = new Map();
  const world = {
    store, quotaExceeded: false,
    gatewayScript: [],          // queue of { throw } | { status, body }
    gatewayPosts: [],           // recorded gateway POST bodies
    logPosts: [],               // recorded fire-and-forget submission-log posts
    cardWrites: [],             // recorded calendar-upsert payloads
    cardFail: () => false,      // post => should this card write fail?
    onGatewayResponse: null,    // hook: runs when the gateway responds (before the browser sees it)
    notifications: [],
    identity: { role: 'admin', member: { id: 'actor-a', name: 'Fixture Admin' } },
    uuidSeq: 0,
  };
  let lockChain = Promise.resolve();
  const context = {
    console: { warn() {}, log() {}, error() {} },
    PROD_WRITE_EF_URL: 'https://gateway.fixture.invalid/functions/v1/production-write',
    CAL_SUPABASE_ANON_KEY: 'fixture-anon-key',
    LOG_SUBMISSION_WEBHOOK: 'https://n8n.fixture.invalid/webhook/log-linear-submission',
    NATIVE_INTAKE_PENDING_KEY: constant('NATIVE_INTAKE_PENDING_KEY'),
    WRITE_UI_QUEUE_DIAG_KEY: constant('WRITE_UI_QUEUE_DIAG_KEY'),
    WRITE_UI_DIAG_IDS: ['id', 'client_slug', 'transport', 'card', 'component', 'comment', 'parent', 'action'],
    WRITE_UI_DIAG_PAYLOAD_IDS: ['issue', 'status'],
    LINEAR_FORM_KEY: 'syncview_linear_form_fixture',
    LAST_LINK_KEY: 'syncview_last_link_fixture',
    PROD_CREATED_STATUS: /const PROD_CREATED_STATUS = '([a-z_]+)';/.exec(html)[1],
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { if (world.quotaExceeded) throw new Error('QuotaExceededError'); store.set(key, String(value)); },
      removeItem: key => { store.delete(key); },
    },
    navigator: { locks: { request: (_name, _options, callback) => {
      const run = lockChain.then(() => callback());
      lockChain = run.catch(() => {});
      return run;
    } } },
    crypto: { randomUUID: () => { world.uuidSeq += 1; return '00000000-0000-4000-8000-' + String(world.uuidSeq).padStart(12, '0'); } },
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      if (url === context.PROD_WRITE_EF_URL) {
        world.gatewayPosts.push(body);
        const next = world.gatewayScript.length ? world.gatewayScript.shift() : { status: 503, body: { ok: false, error: 'unscripted_gateway_response' } };
        if (world.onGatewayResponse) world.onGatewayResponse(next);
        if (next.throw) throw new TypeError('fetch failed: ' + next.throw);
        return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
      }
      if (url === context.LOG_SUBMISSION_WEBHOOK) { world.logPosts.push(body); return { ok: true, status: 200, json: async () => ({}) }; }
      throw new Error('unexpected fetch ' + url);
    },
    _syncviewEfHeaders: headers => headers,
    _syncviewStaffIdentityForHeaders: () => world.identity,
    _syncviewStaffRoleValue: identity => String(identity && identity.role || '').trim().toLowerCase(),
    _calCacheRead: () => ({ posts: [{ order_index: 40 }] }),
    _calCacheWrite: () => {},
    _calRenderBody: () => {},
    _kasperCalCachePrune: () => {},
    calState: { client: 'fixture-view-client', posts: [], focusPid: null },
    calClientSlug: client => String(client || ''),
    _calUpsertFetch: async (slug, payload, source) => {
      world.cardWrites.push({ slug, payload, source });
      const fail = world.cardFail(payload.post);
      if (fail === 'network') throw new TypeError('fetch failed: card write lost');
      return { ok: !fail, status: fail ? 500 : 200, json: async () => ({ ok: !fail, post: payload.post }) };
    },
    showNotify: (title, text) => world.notifications.push({ title, text }),
    _writeUiQueueDiagnosticSink: null,
  };
  vm.createContext(context);
  vm.runInContext('let _nativeIntakeResumePromise = null;\n' + FUNCTIONS.map(extract).join('\n'), context);
  // The resume path reports through _writeUiQueueDiagnostic; the real one is
  // loaded above, so its ring is observable in the store.
  world.context = context;
  world.readJob = () => context._linearIntakeRead();
  world.diagnostics = () => JSON.parse(store.get(context.WRITE_UI_QUEUE_DIAG_KEY) || '[]');
  return world;
}

const makePayload = (world, clientSlug = 'fixture-client') => (requestId, sourceEditedAt) => ({
  operation: 'intake_create', surface: 'submission', client_slug: clientSlug,
  request_id: requestId, source_edited_at: sourceEditedAt,
  batch: { name: 'Fixture batch', description: 'notes', notes: 'notes', filming_doc_url: null, footage_folder_url: null },
  items: world.context._linearIntakeItems('both', [
    { number: 1, main_cam: 'cam', side_cam: '', audio: '', notes: 'n1', dueDate: '2026-09-12' },
    { number: 2, main_cam: 'cam', side_cam: '', audio: '', notes: 'n2', dueDate: '2026-09-12' },
  ], requestId),
});
const actorContext = (world, extra = {}) => Object.assign({
  surface: 'submission', materialization_source: 'submission-native', batch_choice: 'new',
  clientSlug: 'fixture-client', clientName: 'Fixture Client', mode: 'both',
}, world.context._linearIntakeActorContext(world.identity), extra);
function gatewayOk(job, extra = {}) {
  const items = job.payload.items.map((item, index) => ({
    item_index: index, id: 'del_' + index + '_' + job.payload.request_id.slice(-4), team: item.team,
    card_id: item.card_id, title: item.title || (item.team === 'graphics' ? 'Thumbnail ' + item.videoNumber : 'Video ' + item.videoNumber),
    video_number: item.videoNumber, linear_issue_url: '',
  }));
  return { status: 201, body: { ok: true, native_committed: true, mirror_pending: true, batch: { id: 'bat_' + job.payload.request_id.slice(-4) }, items, ...extra } };
}
async function pending(world, signature = 'sig-a', extra = {}) {
  return world.context._linearIntakeWithLock(() => world.context._linearIntakePending(signature, makePayload(world), actorContext(world, extra)));
}
async function resume(world, reason, job) {
  try { return { ok: true, value: await world.context._resumeNativeIntakeJob(reason, job) }; }
  catch (error) { return { ok: false, error: { code: error && error.code, status: error && error.status, message: error && error.message } }; }
}

async function run() {
  const checks = [];
  const events = [];
  const check = (id, kind, label, pass, evidence) => {
    checks.push({ id, lane: 'browser', kind, label, pass: !!pass, evidence: evidence === undefined ? null : evidence });
    const line = `${pass ? 'ok  ' : 'FAIL'} [${kind}] ${id} ${label}`;
    events.push(line);
    console.error(line + (pass ? '' : '\n      evidence: ' + JSON.stringify(evidence)));
  };

  /* B1 : response lost after the gateway committed. */
  {
    const w = makeWorld();
    const job = await pending(w);
    w.gatewayScript.push({ throw: 'connection reset after server commit' });
    const first = await resume(w, 'submit', job);
    const saved = w.readJob();
    check('B1-lost-response-keeps-request', 'current', 'a lost gateway response leaves the job in localStorage at stage request_pending with its request id, and the request-log beacon fired before the gateway call',
      !first.ok && saved && saved.stage === 'request_pending' && saved.payload.request_id === job.payload.request_id && w.logPosts.length === 1,
      { stage: saved && saved.stage, request_id: saved && saved.payload.request_id, log_posts: w.logPosts.length });
    w.gatewayScript.push(gatewayOk(job));
    const second = await resume(w, 'submit', w.readJob());
    check('B1-retry-identical-request', 'current', 'the retry re-sends a byte-identical gateway request (same request_id and source_edited_at), then materializes both cards and clears the job',
      second.ok && w.gatewayPosts.length === 2 && JSON.stringify(w.gatewayPosts[0]) === JSON.stringify(w.gatewayPosts[1])
        && w.cardWrites.length === 2 && w.readJob() === null,
      { posts: w.gatewayPosts.length, identical: JSON.stringify(w.gatewayPosts[0]) === JSON.stringify(w.gatewayPosts[1]), card_writes: w.cardWrites.length, job_after: w.readJob() });
  }

  /* B2 : native committed, second card write fails; resume finishes without re-posting. */
  {
    const w = makeWorld();
    const job = await pending(w);
    w.gatewayScript.push(gatewayOk(job));
    w.cardFail = post => post.id.endsWith('_2');
    const first = await resume(w, 'submit', job);
    const saved = w.readJob();
    check('B2-native-checkpoint-before-cards', 'current', 'when the second card write fails, the job is checkpointed with the native result, stage materializing_cards and the first card marked complete',
      !first.ok && saved && saved.result && saved.result.native_committed === true && saved.stage === 'materializing_cards'
        && saved.completed_card_ids.length === 1,
      { stage: saved && saved.stage, completed: saved && saved.completed_card_ids, error: first.error });
    w.cardFail = () => false;
    const posts = w.gatewayPosts.length;
    const second = await resume(w, 'startup', w.readJob());
    check('B2-resume-writes-only-remaining-card', 'current', 'a background resume writes only the remaining card, sends no second gateway request, and clears the job',
      second.ok && w.gatewayPosts.length === posts && w.cardWrites.length === 3 && w.cardWrites[2].payload.post.id.endsWith('_2') && w.readJob() === null,
      { gateway_posts: w.gatewayPosts.length, card_writes: w.cardWrites.map(c => c.payload.post.id) });
  }

  /* B3 : browser storage lost between the native commit and the card writes. */
  {
    const w = makeWorld();
    const job = await pending(w);
    w.gatewayScript.push(gatewayOk(job));
    w.cardFail = () => true;
    await resume(w, 'submit', job);
    const committed = w.readJob();
    w.store.clear();
    const after = await resume(w, 'startup');
    check('B3-storage-loss-forgets-accepted-work', 'current', 'after localStorage is cleared, the accepted-but-unmaterialized submission is gone from the browser: resume finds nothing, writes nothing, notifies nothing',
      committed && committed.result && committed.result.native_committed === true && after.ok && after.value === null
        && w.cardWrites.length === 1 && w.notifications.length === 0 && w.store.size === 0,
      { had_native_result: !!(committed && committed.result), resume_value: after.value, card_writes: w.cardWrites.length, notifications: w.notifications.length });
    check('U3-browser-loss-recovery', 'unproven', 'recovery of the owed cards after browser storage loss cannot be exercised in this lane: there is no server-side component to run; the gateway lane observes whether any card gets written server-side (R3-server-materializes-orphan-card)',
      false, { exercised: false });
  }

  /* B4 : recovery fails repeatedly. */
  {
    const w = makeWorld();
    const job = await pending(w);
    w.gatewayScript.push(gatewayOk(job));
    w.cardFail = () => 'network';
    await resume(w, 'submit', job);
    // Sign-out converts the committed job into a scrubbed recovery copy.
    await w.context._linearIntakePurgeSensitiveState();
    const recovery = w.readJob();
    const outcomes = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      const r = await resume(w, 'startup');
      outcomes.push({ attempt, present: !!w.readJob(), refusals: w.readJob() && w.readJob().resume_refusals });
    }
    check('B4-recovery-copy-discarded-after-4', 'current', 'a recovery copy (native work committed, card write failing with no HTTP status) is removed after four background failures with a notice; the native rows stay on the server with no card',
      recovery && recovery.recovery_only === true && outcomes[2].present && !outcomes[3].present
        && w.notifications.some(n => /stopped retrying/i.test(n.title)),
      { recovery_only: recovery && recovery.recovery_only, outcomes, notifications: w.notifications.map(n => n.title) });
    check('R5-no-silent-discard-of-accepted-work', 'readiness', 'accepted native work whose card cannot be written is never dropped from the only place that remembers it (durable pending state survives repeated failure)',
      outcomes[3].present, { discarded_after: 4 });
  }
  {
    const w = makeWorld();
    const job = await pending(w);
    const outcomes = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
      w.gatewayScript.push({ status: 503, body: { ok: false, error: 'project_mapping_validation_unavailable' } });
      await resume(w, 'startup');
      outcomes.push({ attempt, present: !!w.readJob() });
    }
    check('B4-uncommitted-discarded-after-6-provider-503s', 'current', 'an UNCOMMITTED submission refused 503 project_mapping_validation_unavailable on six page loads is discarded with its payload; the only copies left are the fire-and-forget request-log beacons',
      outcomes[4].present && !outcomes[5].present && w.notifications.some(n => /discarded/i.test(n.title)) && w.logPosts.length >= 1,
      { outcomes, log_posts: w.logPosts.length, notifications: w.notifications.map(n => n.title) });
    check('R5-provider-outage-does-not-discard-draft', 'readiness', 'a provider outage that outlasts six page loads does not delete the typed submission from the browser',
      outcomes[5].present, { discarded_after: 6 });
    // Live clicks never count a strike, whatever the status.
    const w2 = makeWorld();
    const job2 = await pending(w2);
    for (let i = 0; i < 8; i++) { w2.gatewayScript.push({ status: 409, body: { ok: false, error: 'project_mapping_missing' } }); await resume(w2, 'submit', w2.readJob()); }
    check('B4-live-click-never-strikes', 'current', 'a refusal on a live click never counts toward discard: eight 409s on Submit leave the job in place',
      !!w2.readJob() && w2.readJob().payload.request_id === job2.payload.request_id, { present: !!w2.readJob() });
  }

  /* B5 : actor changes. */
  {
    const w = makeWorld();
    const job = await pending(w);
    w.identity = { role: 'smm', member: { id: 'actor-b', name: 'Fixture Manager' } };
    const r = await resume(w, 'startup', job);
    let blocked = null;
    try { await pending(w, 'sig-b'); } catch (error) { blocked = error && error.code; }
    check('B5-actor-switch-suspends-uncommitted', 'current', 'a saved submission started by actor A is not sent by actor B (native_intake_actor_mismatch), stays saved, and blocks B from starting a different submission (native_intake_pending_conflict)',
      !r.ok && r.error.code === 'native_intake_actor_mismatch' && !!w.readJob() && blocked === 'native_intake_pending_conflict' && w.gatewayPosts.length === 0,
      { error: r.error, blocked_code: blocked, gateway_posts: w.gatewayPosts.length });
  }
  {
    const w = makeWorld();
    const job = await pending(w);
    w.gatewayScript.push(gatewayOk(job));
    w.onGatewayResponse = () => { w.identity = { role: 'admin', member: { id: 'actor-b', name: 'Fixture Other Admin' } }; };
    const r = await resume(w, 'submit', job);
    const saved = w.readJob();
    check('B5-delayed-response-after-actor-switch', 'current', 'a gateway response that lands after the signed-in actor changed is checkpointed as a scrubbed recovery copy carrying the native ids (no card is written under the wrong actor, nothing is re-sent)',
      !r.ok && r.error.code === 'native_intake_actor_mismatch' && saved && saved.recovery_only === true && saved.suspended === true
        && saved.result.native_committed === true && saved.result.items.length === 4 && w.cardWrites.length === 0
        && !saved.payload.batch && saved.payload.items.every(i => Object.keys(i).sort().join(',') === 'card_id,team,videoNumber'),
      { error: r.error, recovery_only: saved && saved.recovery_only, card_writes: w.cardWrites.length, scrubbed_item_keys: saved && Object.keys(saved.payload.items[0]) });
    w.onGatewayResponse = null;
    w.identity = { role: 'admin', member: { id: 'actor-a', name: 'Fixture Admin' } };
    const back = await resume(w, 'staff-verified');
    check('B5-original-actor-finishes', 'current', 'when the original actor returns, the recovery copy materializes both cards from the stored native result without a second gateway request',
      back.ok && w.cardWrites.length === 2 && w.gatewayPosts.length === 1 && w.readJob() === null,
      { card_writes: w.cardWrites.length, gateway_posts: w.gatewayPosts.length });
  }

  /* B6 : the open client changes before the response arrives. */
  {
    const w = makeWorld();
    const job = await pending(w);
    w.gatewayScript.push(gatewayOk(job));
    w.context.calState.client = 'fixture-other-client';
    const r = await resume(w, 'submit', job);
    check('B6-materializes-to-job-client', 'current', 'cards are written to the client named in the job, not the client now open in the calendar, and the open view is not mutated',
      r.ok && w.cardWrites.every(c => c.slug === 'fixture-client') && w.context.calState.posts.length === 0,
      { slugs: w.cardWrites.map(c => c.slug), view_posts: w.context.calState.posts.length });
  }

  /* B7 : simultaneous submissions in one browser. */
  {
    const w = makeWorld();
    const first = await pending(w, 'sig-same');
    const again = await pending(w, 'sig-same');
    let conflict = null;
    try { await pending(w, 'sig-other'); } catch (error) { conflict = error && error.code; }
    w.gatewayScript.push(gatewayOk(first));
    const [a, b] = await Promise.all([resume(w, 'submit', first), resume(w, 'submit', first)]);
    check('B7-same-intent-one-request', 'current', 'the same intent submitted twice reuses one request id, a different intent is refused while one is pending, and two concurrent resumes share one in-flight gateway request',
      first.payload.request_id === again.payload.request_id && conflict === 'native_intake_pending_conflict'
        && a.ok && b.ok && w.gatewayPosts.length === 1,
      { same_request_id: first.payload.request_id === again.payload.request_id, conflict, gateway_posts: w.gatewayPosts.length });
  }

  /* B8 : storage over quota. */
  {
    const w = makeWorld();
    w.quotaExceeded = true;
    let code = null;
    try { await pending(w); } catch (error) { code = error && error.message; }
    check('B8-quota-refuses-before-send', 'current', 'when the job cannot be stored, the submission is refused (native_intake_storage_unavailable) before any gateway request',
      code === 'native_intake_storage_unavailable' && w.gatewayPosts.length === 0, { code, gateway_posts: w.gatewayPosts.length });
  }

  /* B9 : sign-out purge. */
  {
    const w = makeWorld();
    await pending(w);
    await w.context._linearIntakePurgeSensitiveState();
    check('B9-signout-drops-uncommitted-draft', 'current', 'sign-out removes an uncommitted (never accepted) submission from the browser without a notice: it is an unsubmitted draft, and it is silently gone',
      w.readJob() === null && w.notifications.length === 0, { job: w.readJob(), notifications: w.notifications.length });
  }

  /* B10 : the local diagnostics ring is the only refusal record. */
  {
    const w = makeWorld();
    for (let i = 0; i < 55; i++) w.context._writeUiQueueDiagnostic('calendar', 'ui_write_failure', { kind: 'component_fill', card: 'card-' + i }, { code: 'batch_parent_mapping_missing' });
    const ring = w.diagnostics();
    check('B10-refusal-ring-local-and-capped', 'current', 'write refusals are recorded only in a 50-row localStorage ring in the refusing browser (OPEN_REPAIRS 101); nothing is sent anywhere',
      ring.length === 50 && ring[0].card === 'card-5' && w.gatewayPosts.length === 0 && w.logPosts.length === 0, { rows: ring.length, oldest: ring[0] && ring[0].card });
  }

  /* B11 : the anonymous client link resumes without a staff identity. */
  {
    const w = makeWorld();
    w.context._isIntake = true;
    w.identity = null;
    const job = await w.context._linearIntakeWithLock(() => w.context._linearIntakePending('sig-client', makePayload(w), { surface: 'submission', clientSlug: 'fixture-client', mode: 'both', initiating_actor_id: '', initiating_actor_role: '' }));
    w.gatewayScript.push(gatewayOk(job));
    const r = await resume(w, 'client-verified', job);
    check('B11-anonymous-intake-resumes', 'current', 'on the client link (no staff identity) a saved submission still resumes and materializes: the actor guard yields to the server gate for public intake',
      r.ok && w.cardWrites.length === 2 && w.readJob() === null, { card_writes: w.cardWrites.length, error: r.error });
  }

  return { checks, events };
}

module.exports = { run, makeWorld };
