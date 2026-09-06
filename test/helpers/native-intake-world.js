'use strict';
/*
 * Adapted from PR #1274 at 92d50240cebe8dc6855a89e69c08f76bd0a1ddc1.
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
const html = fs.readFileSync(process.env.INTAKE_SOURCE_FILE || path.join(ROOT, 'index.html'), 'utf8');

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
const RECOVERY_FUNCTIONS = ['_linearIntakeRecoveryText', '_linearIntakeRecoveryHtml', '_linearIntakeRefreshRecovery', '_linearIntakeRetrySaved',
  '_linearIntakeAutomaticAttempts', '_linearIntakeScope', '_linearIntakeUnresolvedRead', '_linearIntakeParkUnknown', '_linearIntakeRecoveryJobHtml'];

function makeWorld(options = {}) {
  const store = options.store || new Map();
  const world = {
    store, quotaExceeded: false, readUnavailable: false,
    gatewayScript: [],          // queue of { throw } | { status, body }
    gatewayPosts: [],           // recorded gateway POST bodies
    logPosts: [],               // recorded fire-and-forget submission-log posts
    cardWrites: [],             // recorded calendar-upsert payloads
    cardFail: () => false,      // post => should this card write fail?
    onGatewayResponse: null,    // hook: runs when the gateway responds (before the browser sees it)
    notifications: [],
    identity: { role: 'admin', member: { id: 'actor-a', name: 'Fixture Admin' } },
  };
  let lockChain = Promise.resolve();
  const context = {
    _calEsc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\"', '&quot;'),
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
      getItem: key => { if (world.readUnavailable) throw new Error('SecurityError'); return store.has(key) ? store.get(key) : null; },
      setItem: (key, value) => { if (world.quotaExceeded) throw new Error('QuotaExceededError'); store.set(key, String(value)); },
      removeItem: key => { store.delete(key); },
    },
    navigator: { locks: { request: (_name, _options, callback) => {
      const run = lockChain.then(() => callback());
      lockChain = run.catch(() => {});
      return run;
    } } },
    crypto: { randomUUID: require('crypto').randomUUID },
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
  vm.runInContext('let _nativeIntakeResumePromise = null;\n' + [...FUNCTIONS, ...RECOVERY_FUNCTIONS.filter(n => html.includes('function ' + n + '('))].map(extract).join('\n'), context);
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
  return world.context._linearIntakeWithLock(() => world.context._linearIntakePending(signature, makePayload(world, extra.clientSlug || 'fixture-client'), actorContext(world, extra)));
}
async function resume(world, reason, job) {
  try { return { ok: true, value: await world.context._resumeNativeIntakeJob(reason, job) }; }
  catch (error) { return { ok: false, error: { code: error && error.code, status: error && error.status, message: error && error.message } }; }
}


module.exports = { makeWorld, pending, resume, gatewayOk, extract, html, FUNCTIONS, RECOVERY_FUNCTIONS };
