'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}
// 060 and 090 offer these setters so the Submit screen module (200) can
// change their state without assigning an ES module import (phase C step
// C3). A function that calls one gets it loaded beside it, so each vm
// context keeps writing the same context variables as before.
const LINEAR_200_SETTERS = [
  '_linearSetVideoCount', '_linearNextVideoCount', '_linearSetJustCreated',
  '_linearSetSubmitInFlight', '_linearSetResolvedPlanUrl',
];
function extract(name) {
  const body = extractOne(name);
  const setters = LINEAR_200_SETTERS.filter(setter => setter !== name && body.includes(setter + '('));
  return [body, ...setters.map(extractOne)].join('\n');
}

function extractOne(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  // Comment-aware: prose inside a comment may contain ' " or ` and must not
  // be read as a string delimiter, or brace matching runs past the function's
  // end. Mirrors test/attribution-mixed-family.js, which learned this first.
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (comment === 'line') { if (ch === '\n') comment = ''; continue; }
    if (comment === 'block') { if (ch === '*' && next === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { comment = 'line'; i++; continue; }
    if (ch === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

const store = new Map();
const writes = [];
let failCard2 = true;
let currentIdentity = { role: 'smm', member: { id: 'actor-a' } };
const context = {
  NATIVE_INTAKE_PENDING_KEY: 'pending',
  LINEAR_FORM_KEY: 'form',
  LAST_LINK_KEY: 'last-link',
  LINEAR_INTAKE_HOLD_KEY: 'hold',
  localStorage: {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  },
  crypto: { randomUUID: () => 'stable-uuid' },
  navigator: { locks: { request: async (_name, _options, callback) => callback() } },
  _calCacheRead: () => ({ posts: [{ order_index: 40 }] }),
  _syncviewStaffIdentityForHeaders: () => currentIdentity,
  _syncviewStaffRoleValue: identity => String(identity && identity.role || ''),
  _calUpsertFetch: async (slug, payload, sourceName) => {
    writes.push({ slug, payload, sourceName });
    const shouldFail = payload.post.id === 'card-2' && failCard2;
    return { ok: !shouldFail, json: async () => ({ ok: !shouldFail }) };
  },
  console,
};
/*
 * Read the real created-status constant out of index.html rather than
 * restating it: an editor reported every new sub-issue arriving already
 * "In Progress" (2026-08-17), and a copy of the value here would let the app
 * drift back to that without this suite noticing.
 */
const createdStatusMatch = /const PROD_CREATED_STATUS = '([a-z_]+)';/.exec(source);
if (!createdStatusMatch) throw new Error('missing const PROD_CREATED_STATUS');
context.PROD_CREATED_STATUS = createdStatusMatch[1];

if (context.PROD_CREATED_STATUS === 'in_progress') {
  throw new Error('newly created work must not start already in progress');
}

vm.createContext(context);
vm.runInContext([
  extract('_linearIntakeRequestId'),
  extract('_linearIntakeWithLock'),
  extract('_linearIntakeRead'),
  extract('_linearIntakeJobId'),
  extract('_linearIntakeWrite'),
  extract('_linearIntakeRemoveIfCurrent'),
  extract('_linearIntakeActorError'),
  extract('_linearIntakeRequireActor'),
  extract('_linearIntakeRecoveryCopy'),
  extract('_linearIntakePersistRecovery'),
  extract('_linearIntakeCheckpointOrSuspend'),
  extract('_linearIntakePurgeSensitiveState'),
  extract('_linearIntakePending'),
  extract('_linearVideoBrief'),
  extract('_linearThumbnailBrief'),
  extract('_linearIntakeBatchTitle'),
  extract('_linearIntakeItems'),
  extract('_linearIntakeValidateResult'),
  extract('_writeNativeSubmissionCardsToCalendar'),
].join('\n'), context);

const makePayload = (requestId, sourceEditedAt) => ({
  operation: 'intake_create', client_slug: 'fixture', request_id: requestId,
  source_edited_at: sourceEditedAt,
  items: [
    { team: 'video', videoNumber: 1, card_id: 'card-1' },
    { team: 'graphics', videoNumber: 1, card_id: 'card-1' },
    { team: 'video', videoNumber: 2, card_id: 'card-2' },
    { team: 'graphics', videoNumber: 2, card_id: 'card-2' },
  ],
});
const result = {
  ok: true, native_committed: true,
  items: [
    { item_index: 3, id: 'gra-2', team: 'graphics', card_id: 'card-2', linear_issue_url: 'https://linear.invalid/GRA-2' },
    { item_index: 0, id: 'vid-1', team: 'video', card_id: 'card-1', linear_issue_url: 'https://linear.invalid/VID-1' },
    { item_index: 2, id: 'vid-2', team: 'video', card_id: 'card-2', linear_issue_url: 'https://linear.invalid/VID-2' },
    { item_index: 1, id: 'gra-1', team: 'graphics', card_id: 'card-1', linear_issue_url: 'https://linear.invalid/GRA-1' },
  ],
};

(async () => {
  const paired = context._linearIntakeItems('both', [{ number: 1, dueDate: '2026-07-20' }], 'calendar:stable-uuid');
  ok(paired.length === 2
    && paired[0].team === 'video' && paired[1].team === 'graphics'
    && paired[0].card_id === paired[1].card_id
    && paired[0].due_date === '2026-07-20' && paired[1].due_date === '2026-07-20',
  'shared intake builder creates one paired VID+GRA post with a deterministic shared card id');

  const actorContext = { clientSlug: 'fixture', initiating_actor_id: 'actor-a', initiating_actor_role: 'smm' };
  const seeded = context._linearIntakePending('held', makePayload, actorContext, {
    request_id: 'submission:held-identity', source_edited_at: '2026-09-19T12:00:00.000Z'
  });
  const seededReplay = context._linearIntakePending('held', () => ({ wrong: true }), actorContext);
  ok(seeded.payload.request_id === 'submission:held-identity'
    && seeded.payload.source_edited_at === '2026-09-19T12:00:00.000Z'
    && seededReplay.payload.request_id === seeded.payload.request_id,
  'a browser hold becomes a native pending job on the same preallocated identity and replays it exactly');
  store.delete('pending');
  const first = context._linearIntakePending('same', makePayload, actorContext);
  const replay = context._linearIntakePending('same', () => ({ wrong: true }), actorContext);
  ok(first.payload.request_id === replay.payload.request_id
    && first.payload.source_edited_at === replay.payload.source_edited_at,
  'ambiguous retry reuses the exact request id and source timestamp');

  let conflict = false;
  try { context._linearIntakePending('changed', makePayload, actorContext); }
  catch (error) { conflict = error.code === 'native_intake_pending_conflict'; }
  ok(conflict, 'a different semantic submission cannot overwrite an incomplete job');

  first.result = result;
  first.stage = 'materializing_cards';
  context._linearIntakeWrite(first);
  currentIdentity = { role: 'smm', member: { id: 'actor-b' } };
  let actorBlocked = false;
  try { await context._writeNativeSubmissionCardsToCalendar(first); }
  catch (error) { actorBlocked = error.code === 'native_intake_actor_mismatch'; }
  ok(actorBlocked && writes.length === 0,
  'a different verified staff member cannot resume the initiating actor job');
  currentIdentity = { role: 'smm', member: { id: 'actor-a' } };
  let partialFailed = false;
  try { await context._writeNativeSubmissionCardsToCalendar(first); }
  catch (error) { partialFailed = error.message === 'calendar_card_write_failed'; }
  const partial = context._linearIntakeRead();
  ok(partialFailed && partial.completed_card_ids.length === 1 && partial.completed_card_ids[0] === 'card-1',
  'each successful card is checkpointed before a later card failure');
  ok(writes.length === 2 && writes[0].payload.post.id === 'card-1' && writes[1].payload.post.id === 'card-2',
  'returned items are paired by item_index before materialization');
  ok(writes[0].payload.post.video_deliverable_id === 'vid-1'
    && writes[0].payload.post.graphic_deliverable_id === 'gra-1',
  'calendar card carries both native deliverable identities');

  writes.length = 0;
  failCard2 = false;
  await context._writeNativeSubmissionCardsToCalendar(partial);
  ok(writes.length === 1 && writes[0].payload.post.id === 'card-2',
  'resume writes only the missing deterministic card');

  const beforeInvalid = writes.length;
  let invalidRejected = false;
  const invalid = JSON.parse(JSON.stringify(partial));
  invalid.result.items = invalid.result.items.filter(item => item.item_index !== 1);
  try { await context._writeNativeSubmissionCardsToCalendar(invalid); }
  catch (_error) { invalidRejected = true; }
  ok(invalidRejected && writes.length === beforeInvalid,
  'an incomplete response mapping aborts before the first Calendar write');

  store.delete('pending');
  writes.length = 0;
  const calendarJob = {
    version: 3,
    signature: 'calendar append',
    payload: {
      operation: 'intake_create', surface: 'calendar', client_slug: 'fixture',
      request_id: 'calendar:materialize', source_edited_at: '2026-07-13T12:00:00.000Z',
      batch_id: 'batch-latest', expected_batch_updated_at: '2026-07-13T11:00:00.000Z',
      items: [
        { team: 'video', videoNumber: 1, card_id: 'calendar-card' },
        { team: 'graphics', videoNumber: 1, card_id: 'calendar-card' },
      ],
    },
    context: {
      surface: 'calendar', materialization_source: 'calendar-native', batch_choice: 'latest',
      clientSlug: 'fixture', initiating_actor_id: 'actor-a', initiating_actor_role: 'smm',
    },
    result: {
      ok: true, native_committed: true, batch: { id: 'batch-latest' },
      items: [
        { item_index: 0, id: 'calendar-vid', team: 'video', card_id: 'calendar-card' },
        { item_index: 1, id: 'calendar-gra', team: 'graphics', card_id: 'calendar-card' },
      ],
    },
    completed_card_ids: [], stage: 'materializing_cards', telemetry_sent: true,
  };
  context._linearIntakeWrite(calendarJob, { allowCreate: true });
  await context._writeNativeSubmissionCardsToCalendar(calendarJob);
  ok(writes.length === 1
    && writes[0].sourceName === 'calendar-native'
    && writes[0].payload.post.video_deliverable_id === 'calendar-vid'
    && writes[0].payload.post.graphic_deliverable_id === 'calendar-gra',
  'Calendar Create Post materializes only from returned native IDs and carries its calendar-native source');
  const calendarRecovery = context._linearIntakeRecoveryCopy(calendarJob);
  ok(calendarRecovery.payload.surface === 'calendar'
    && calendarRecovery.payload.batch_id === 'batch-latest'
    && calendarRecovery.payload.expected_batch_updated_at === '2026-07-13T11:00:00.000Z'
    && calendarRecovery.context.surface === 'calendar'
    && calendarRecovery.context.materialization_source === 'calendar-native'
    && calendarRecovery.context.batch_choice === 'latest',
  'committed recovery preserves the Calendar surface, append cursor, and materialization metadata');
  store.delete('pending');

  const sensitive = JSON.parse(JSON.stringify(first));
  sensitive.signature = 'private notes duplicate';
  sensitive.payload.batch = { notes: 'private notes', footage_folder_url: 'https://drive.invalid/private' };
  sensitive.payload.items[0].brief = 'private camera details';
  sensitive.result.batch = { id: 'batch-safe' };
  context._linearIntakeWrite(sensitive, { allowCreate: true });
  store.set('form', 'private form'); store.set('last-link', 'private link'); store.set('hold', 'private held submission');
  await context._linearIntakePurgeSensitiveState();
  const scrubbedRaw = store.get('pending') || '';
  const scrubbed = JSON.parse(scrubbedRaw);
  ok(!store.has('form') && !store.has('last-link') && !store.has('hold')
    && !scrubbedRaw.includes('private notes') && !scrubbedRaw.includes('drive.invalid')
    && !scrubbedRaw.includes('camera details') && scrubbed.result.native_committed === true,
  'sign-out scrubs form, hold, and sensitive intake payloads while retaining committed recovery IDs');

  store.delete('pending');
  const replacement = JSON.parse(JSON.stringify(first));
  replacement.signature = 'replacement';
  replacement.payload.request_id = 'submission:replacement';
  replacement.context.initiating_actor_id = 'actor-b';
  ok(context._linearIntakeWrite(replacement, { allowCreate: true })
    && !context._linearIntakeWrite(first)
    && !context._linearIntakeRemoveIfCurrent(first.payload.request_id)
    && context._linearIntakeRead().payload.request_id === 'submission:replacement',
  'a slower tab cannot checkpoint over or delete a newer intake job');

  const submitEntry = extract('submitLinearForm');
  const submit = extract('_submitLinearFormRoutedOnce');
  const linearView = extract('renderLinearView');
  ok(submitEntry.includes('_submitLinearFormRoutedOnce(mode)')
    && /operation: 'intake_create'/.test(submit)
    && /surface: 'submission'/.test(submit)
    && /_syncviewRequireStaffIdentity\('intake'\)/.test(submit)
    && /_writeUiRerouteUseGatewayWhenReady/.test(submit)
    && !/_submitLinearFormLegacy/.test(submit),
  'Submit has one native intake route and no legacy fallback caller');
  ok(!/VIDEO_FORM_WEBHOOK|GRAPHIC_FORM_WEBHOOK|_calCardJobCreate|_writeLinearVideoCardsToCalendar/.test(submit),
  'the enrolled Submit lane cannot call a legacy create webhook or enqueue a Linear polling job');
  ok(submit.includes("_linearHoldSubmission(mode, 'saved_legacy_receipt'")
    && submit.includes("_linearHoldSubmission(mode, 'legacy_receipt_read_failed'")
    && submit.includes("_linearHoldSubmission(mode, 'routing_helper_missing'")
    && submit.includes("_linearHoldSubmission(mode, 'native_routing_unavailable'")
    && !/_submitLinearFormLegacy|_submitLinearFormOnce|_linearAwaitCreate/.test(source),
  'all four legacy exits hold visibly while the orphan F44 transport stays retired');
  ok(linearView.includes("const receivedBanner = linearJustCreated === 'received'")
    && linearView.includes('Production work received. Our team will complete an internal setup step; no action is needed from you.'),
  'the received terminal state renders a client-facing acknowledgement rather than a created-work claim');
  ok(!/test_override/.test(submit),
  'Submit never asks a browser credential to self-enter TEST scope');
  const runner = extract('_runNativeIntakeJob');
  ok(runner.indexOf('result = await response.json()') < runner.indexOf('_linearIntakeCheckpointOrSuspend(job)')
    && runner.indexOf('_linearIntakeCheckpointOrSuspend(job)') < runner.indexOf('_linearIntakeSendTelemetry(job)')
    && runner.indexOf('_linearIntakeSendTelemetry(job)') < runner.indexOf('await _writeNativeSubmissionCardsToCalendar(job)'),
  'the native response and validated IDs are checkpointed before telemetry or the first Calendar write');
  ok(submit.includes('await _linearIntakeWithLock')
    && extract('_linearIntakePurgeSensitiveState').includes('return _linearIntakeWithLock(purge)')
    && runner.includes('_linearIntakeRemoveIfCurrent(job.payload.request_id)')
    && !runner.includes('localStorage.removeItem(NATIVE_INTAKE_PENDING_KEY)'),
  'create, purge, and completion deletion share the cross-tab intake lock');
  const lifecycle = source.slice(source.indexOf('function _writeUiResumeLegacyQueues'), source.indexOf('/* Point-adoption:', source.indexOf('function _writeUiResumeLegacyQueues')));
  ok(lifecycle.includes('_resumeNativeIntakeJob') && lifecycle.includes("'focus'") && lifecycle.includes("'startup'"),
  'native intake resumes on startup and the shared lifecycle paths');
  const holdResume = extract('_linearResumeSubmissionHold');
  ok(holdResume.includes("snapshot.hold.created_load_id === LINEAR_INTAKE_LOAD_ID")
    && holdResume.includes('_submitLinearFormRoutedOnce(snapshot.hold.mode)')
    && holdResume.includes('same_identity_backend_recovery_required')
    && holdResume.includes('snapshot.hold.legacy_receipt_present')
    && lifecycle.includes('_linearResumeSubmissionHold(reason')
    && source.includes("_linearResumeSubmissionHold('startup')"),
  'held Submit work retries once on the next page load while legacy identities remain held');
  ok(extract('_linearIntakePending').includes('seed && seed.request_id')
    && extract('_linearIntakePending').includes('seed && seed.source_edited_at')
    && submit.includes('request_id: heldSnapshot.hold.request_id')
    && submit.includes('_linearCompareRemove(LINEAR_INTAKE_HOLD_KEY, heldSnapshot.raw)'),
  'a held native retry promotes its preallocated identity without changing it');
  ok(submit.includes('heldSnapshot.hold.computed_title')
    && submit.includes('heldSnapshot.hold.computed_due_dates[number - 1]')
    && submit.includes("String(heldDraft && heldDraft.filmingPlans || '').trim()")
    && extract('_linearSubmissionHoldSnapshot').includes('hold.computed_due_dates')
    && extract('renderLinearView').includes('heldSubmission.computed_title')
    && extract('updateLinearTitle').includes('hold.computed_title')
    && extract('_linearIntakePurgeSensitiveState').includes('removeItem(LINEAR_INTAKE_HOLD_KEY)'),
  'an overnight hold preserves its visible title, filming plan, and due dates and cannot cross a staff sign-out');
  ok(submit.indexOf('const pendingNativeIntake = _linearIntakeRead()')
      < submit.indexOf('localStorage.getItem(LINEAR_RECEIPTS_KEY)')
    && submit.includes('if (!pendingNativeIntake)')
    && submit.includes('const useGateway = pendingNativeIntake')
    && submit.includes('? true'),
  'a straddling native batch keeps its request and accepted-epoch recovery path ahead of legacy classification');

  function holdWorld(options) {
    const heldStore = new Map();
    const statusNode = { textContent: '' };
    const inputNode = { value: 'Fixture Client', dataset: { clientSlug: 'fixture-client' } };
    const legacyKey = 'linear-intake-v1:video:' + 'a'.repeat(64);
    if (options && options.legacyReceipt) heldStore.set('receipts', JSON.stringify({
      version: 1,
      receipts: { video: { receipt_key: legacyKey } }
    }));
    const holdContext = {
      LINEAR_INTAKE_HOLD_KEY: 'hold', LINEAR_RECEIPTS_KEY: 'receipts',
      LINEAR_FORM_KEY: 'form', LAST_LINK_KEY: 'last', LINEAR_INTAKE_LOAD_ID: 'load-a',
      // Empty = the async plan map has not resolved yet on this page load.
      _linearResolvedPlanUrl: '',
      localStorage: {
        getItem(key) {
          if (options && options.receiptReadThrows && key === 'receipts') throw new Error('blocked');
          return heldStore.has(key) ? heldStore.get(key) : null;
        },
        setItem: (key, value) => heldStore.set(key, String(value)),
        removeItem: key => heldStore.delete(key),
      },
      document: {
        getElementById: id => id === 'linearClientSearch' ? inputNode : id === 'linearStatus' ? statusNode : null,
        querySelectorAll: selector => selector === '[id^="videoCard_"]' ? [{ id: 'videoCard_1' }] : [],
      },
      buildLinearTitle: () => 'Fixture Client - 19 Sep 2026',
      wlTodayISO: () => '2026-09-19',
      wlAddWorkingDays: () => '2026-09-26',
      saveLinearForm() {
        const draft = { client: inputNode.value, clientSlug: inputNode.dataset.clientSlug,
          filmingPlans: holdContext._linearResolvedPlanUrl || '', videos: [{ main_cam: 'fixture' }] };
        heldStore.set('form', JSON.stringify(draft));
        return draft;
      },
      _linearIntakeRead: () => null,
      crypto: { randomUUID: () => 'hold-request' },
      fetch: async () => { throw new Error('network must not run'); },
      console,
    };
    if (options && options.routingFalse) holdContext._writeUiRerouteUseGatewayWhenReady = async () => false;
    vm.createContext(holdContext);
    vm.runInContext([
      extract('_linearStableJson'), extract('_linearStorageError'), extract('_linearIntakeRequestId'),
      extract('_linearDraftSnapshot'), extract('_linearSubmissionHoldSnapshot'),
      extract('_linearSubmissionHoldRead'), extract('_linearSubmissionHoldReceiptKeys'),
      extract('_linearSubmissionHoldMessage'), extract('_linearSubmissionHoldComputed'),
      extract('_linearHoldSubmission'),
      extract('_submitLinearFormRoutedOnce'),
    ].join('\n'), holdContext);
    return { context: holdContext, store: heldStore, statusNode, legacyKey };
  }

  for (const scenario of [
    { label: 'saved legacy receipt', options: { legacyReceipt: true }, reason: 'saved_legacy_receipt' },
    { label: 'throwing receipt read', options: { receiptReadThrows: true }, reason: 'legacy_receipt_read_failed' },
    { label: 'missing routing helper', options: {}, reason: 'routing_helper_missing' },
    { label: 'routing false', options: { routingFalse: true }, reason: 'native_routing_unavailable' },
  ]) {
    const world = holdWorld(scenario.options);
    const result = await world.context._submitLinearFormRoutedOnce('video');
    const hold = JSON.parse(world.store.get('hold'));
    ok(result && result.held === true && result.reason === scenario.reason
      && hold.request_id === 'submission:hold-request'
      && hold.draft_raw === world.store.get('form')
      && hold.computed_title === 'Fixture Client - 19 Sep 2026'
      && hold.computed_due_dates.join(',') === '2026-09-26'
      && /saved/i.test(world.statusNode.textContent)
      && /next page load/i.test(world.statusNode.textContent)
      && /Nothing was sent to Linear/i.test(world.statusNode.textContent),
    scenario.label + ' becomes a durable self-retrying hold with zero legacy request');
    if (scenario.options.legacyReceipt) {
      ok(hold.legacy_receipt_keys.length === 1 && hold.legacy_receipt_keys[0] === world.legacyKey
        && hold.legacy_receipt_present === true
        && /same-identity backend recovery/.test(world.statusNode.textContent),
      'saved legacy receipt keeps its original recovery identity and names the backend limitation');
    }
  }
  {
    // Reload ordering: a hold saved with a filming-plan link is retried before
    // loadLinearPlanMap() resolves. Re-saving the form must restore the held
    // link, not overwrite it and report a false held_submission_conflict.
    const heldPlan = 'https://docs.example.test/plan';
    const world = holdWorld({ routingFalse: true });
    const heldDraft = JSON.stringify({ client: 'Fixture Client', clientSlug: 'fixture-client',
      filmingPlans: heldPlan, videos: [{ main_cam: 'fixture' }] });
    world.store.set('form', heldDraft);
    world.store.set('hold', world.context._linearStableJson({
      version: 1, mode: 'video', reason: 'native_routing_unavailable',
      request_id: 'submission:earlier-load', source_edited_at: '2026-09-19T12:00:00.000Z',
      client_name: 'Fixture Client', client_slug: 'fixture-client',
      draft_raw: heldDraft, last_link_raw: null,
      computed_title: 'Fixture Client - 19 Sep 2026', computed_due_dates: ['2026-09-26'],
      legacy_receipt_keys: [], legacy_receipt_present: false,
      created_at: '2026-09-19T12:00:00.000Z', created_load_id: 'load-b'
    }));
    const snapshot = world.context._linearDraftSnapshot('Fixture Client', heldDraft);
    ok(snapshot.form_raw === heldDraft && world.context._linearResolvedPlanUrl === heldPlan,
    'a held draft snapshot restores the held filming-plan link before re-saving, so the bytes stay identical');
    world.context._linearResolvedPlanUrl = '';
    const result = await world.context._submitLinearFormRoutedOnce('video');
    const hold = JSON.parse(world.store.get('hold'));
    ok(result && result.held === true && result.reason === 'native_routing_unavailable'
      && result.request_id === 'submission:earlier-load'
      && hold.request_id === 'submission:earlier-load'
      && JSON.parse(hold.draft_raw).filmingPlans === heldPlan,
    'a held retry before the plan map resolves keeps its identity and plan instead of a false conflict');
    ok(submit.includes('_linearDraftSnapshot(clientName, heldSnapshot.hold.draft_raw)')
      && extract('_linearHoldSubmission').includes('_linearDraftSnapshot(clientName, prior && prior.hold.draft_raw)'),
    'both held-draft comparisons hand the snapshot the held bytes so only user-editable fields decide a conflict');
  }
  const projectSource = extract('fetchLinearProjects');
  const projectBuilder = extract('_linearRebuildProjectSource');
  const rerouteSetter = extract('_writeUiSetRerouteFlagValue');
  ok(!/LINEAR_PROJECTS_WEBHOOK/.test(source)
    && /rest\/v1\/clients\?select=slug,display_name,kind,active/.test(projectSource)
    && projectSource.indexOf('await _writeUiPrimeRerouteFlag()') < projectSource.indexOf('/rest/v1/clients')
    && projectBuilder.includes('.filter(row => failNative || _writeUiRerouteUseGateway(row.slug))')
    && /_writeUiRerouteFlagFailed \|\| _writeUiRerouteRosterUnusable/.test(extract('_linearRosterFailsNative'))
    && projectBuilder.includes('linearLegacyProjects.map')
    && rerouteSetter.includes('_linearRefreshProjectsForRerouteChange(previousClients, nextClients)'),
  'Submit no longer calls the dead linear-projects webhook, keeps held legacy names outside the reroute cohort and uses native names only inside it');
  const intakeItems = extract('_linearIntakeItems');
  /* Was: "graphics brief remains server-owned" — the browser sent no graphics
     brief at all, because the server used to generate it and refused a
     caller-supplied one (graphics_brief_server_owned). The owner retired that
     generator on 2026-08-17 and the gateway ranked a caller-supplied brief
     ABOVE the generated text, so on 2026-08-21 he asked for the per-video note
     to land on the thumbnail sub-issue as well as the video one.
     2026-09-08: a non-empty caller-supplied brief used to make the gateway
     skip AI thumbnail-title generation outright, so an ordinary editing note
     silently produced the "AI never wrote a title" symptom the owner
     reported. The note still rides the same `_linearThumbnailBrief` wiring
     below (test/submit-video-notes-and-tab-icons.js pins that function's
     body), but the gateway no longer treats its presence as a reason to skip
     generation — it combines the note with a generated line instead of
     either one excluding the other. What this suite pins is only the wiring:
     the graphics child's `brief` comes from `_linearThumbnailBrief` and never
     from the video composer, whose camera/audio lines belong to the editor
     regardless. */
  ok(/team: 'graphics'[\s\S]{0,180}brief: _linearThumbnailBrief\(/.test(intakeItems),
  'the graphics child brief is still wired through _linearThumbnailBrief, which now always withholds the note');
  ok(!/team: 'graphics'[\s\S]{0,180}_linearVideoBrief\(/.test(intakeItems),
  'the graphics child never receives the video composer, so no footage links reach the designer');

  const latestBatch = extract('_calLatestNativeBatches');
  const compatibleBatch = extract('_calNativeBatchCompatible');
  const choice = extract('_calRenderNativePostChoice');
  const openPost = extract('_calOpenNativePost');
  const createPost = extract('_calSubmitNativePost');
  const addPost = extract('addCalBlankCard');
  ok(latestBatch.includes('status=eq.active') && latestBatch.includes('order=created_at.desc,id.desc')
    && latestBatch.includes('linear_parent_ids')
    /* Updated 2026-08-26: compatibility is decided by the PARENT MAP, not the
       `team` column. The column describes a batch's existing children, not the
       teams it can file, so pinning the old stamp comparisons here pinned the
       defect. The third clause is the one that matters — the rule must not read
       the column at all. */
    && compatibleBatch.includes('needed.every(t => parentTeams.has(t))')
    && !/\bbatch\.team\b/.test(compatibleBatch)
    && choice.includes('value="batch"') && choice.includes('data-batch-id=')
    && !choice.includes('is-incompatible')
    && choice.includes("value=\"new\"${prevBatchChecked ? '' : ' checked'}"),
  'Create Post lists recent active batches, hides mode-incompatible batches entirely, and defaults to Start a new batch');
  // OPEN_REPAIRS: the native_intake_epochs flag read used to be wrapped in a
  // SILENT catch. A failed flag read left `nativeTeams` empty, so every
  // parentless (native) batch got `_nativeAppendTeams: []`, which
  // `_calNativeBatchCompatible`/`_calNativeBatchHasLinearParents` both read
  // as "cannot append" -- the batch vanished from the picker entirely on a
  // transient read failure. The fix fails OPEN for append-capability (both
  // teams) instead of fail-closed to invisible, and logs instead of
  // swallowing.
  ok(!/catch \(_\) \{ \/\* Existing parent-backed choices remain available\. \*\/ \}/.test(latestBatch),
  'the native_intake_epochs flag read no longer swallows its failure silently');
  ok(/console\.warn\(/.test(latestBatch),
  'a failed flag read is logged instead of silently swallowed');
  {
    // Execute the real function with a mocked _prodRestRows: the batches read
    // succeeds with one parentless (native) batch, and the flags read throws.
    const ctx = { console };
    vm.createContext(ctx);
    let flagReadCalls = 0;
    ctx._prodRestRows = async (table) => {
      if (table === 'batches') {
        return [{ id: 'bat-native', client_slug: 'fixture-client', team: null,
          name: 'Native batch', status: 'active', purpose: 'calendar',
          created_at: '2026-09-18T00:00:00.000Z', updated_at: '2026-09-18T00:00:00.000Z',
          linear_parent_ids: null }];
      }
      flagReadCalls++;
      throw new Error('flag read failed (simulated network error)');
    };
    ctx._nativePostPurpose = () => 'calendar';
    vm.runInContext(latestBatch, ctx);
    const rows = await ctx._calLatestNativeBatches('fixture-client', 'calendar');
    ok(flagReadCalls === 1, 'the harness actually exercised the failing flag-read branch');
    ok(Array.isArray(rows) && rows.length === 1 && rows[0].id === 'bat-native',
    'the parentless batch is still returned when the flag read fails');
    ok(Array.isArray(rows[0]._nativeAppendTeams)
      && rows[0]._nativeAppendTeams.includes('video') && rows[0]._nativeAppendTeams.includes('graphics'),
    'a failed flag read fails OPEN: the batch is stamped append-capable for BOTH teams rather than empty/invisible');
  }
  // Codex review, PR for OPEN_REPAIRS 218 (P2): the original fix only failed
  // open when _prodRestRows THREW. A 200 response with an unusable payload
  // (no matching row, the wrong key, or a non-object `value`) bypassed the
  // catch entirely and reproduced the exact invisible-picker bug. Each shape
  // below must ALSO fail open.
  for (const [label, flagsResponse] of [
    ['an empty array (no matching row)', []],
    ['two rows (should never happen, but not exactly one)', [
      { key: 'native_intake_epochs', value: { video: { enabled: true, epoch: 'e1' } } },
      { key: 'native_intake_epochs', value: { video: { enabled: true, epoch: 'e2' } } },
    ]],
    ['the wrong key', [{ key: 'some_other_flag', value: { video: { enabled: true, epoch: 'e1' } } }]],
    ['a null value', [{ key: 'native_intake_epochs', value: null }]],
    ['a non-object (string) value', [{ key: 'native_intake_epochs', value: 'not-an-object' }]],
    ['an array value', [{ key: 'native_intake_epochs', value: [] }]],
  ]) {
    const ctx = { console };
    vm.createContext(ctx);
    ctx._prodRestRows = async (table) => {
      if (table === 'batches') {
        return [{ id: 'bat-native', client_slug: 'fixture-client', team: null,
          name: 'Native batch', status: 'active', purpose: 'calendar',
          created_at: '2026-09-18T00:00:00.000Z', updated_at: '2026-09-18T00:00:00.000Z',
          linear_parent_ids: null }];
      }
      return flagsResponse;
    };
    ctx._nativePostPurpose = () => 'calendar';
    vm.runInContext(latestBatch, ctx);
    const rows = await ctx._calLatestNativeBatches('fixture-client', 'calendar');
    ok(Array.isArray(rows[0]._nativeAppendTeams)
      && rows[0]._nativeAppendTeams.includes('video') && rows[0]._nativeAppendTeams.includes('graphics'),
    'an unusable (non-throwing) flag payload -- ' + label + ' -- also fails OPEN, same as a thrown read');
  }
  // Control: a WELL-FORMED payload with a team legitimately disabled is real
  // per-team state, not a malformed read, and must NOT be treated as a
  // failure -- it keeps its real (partial) nativeTeams list.
  {
    const ctx = { console };
    vm.createContext(ctx);
    ctx._prodRestRows = async (table) => {
      if (table === 'batches') {
        return [{ id: 'bat-native', client_slug: 'fixture-client', team: null,
          name: 'Native batch', status: 'active', purpose: 'calendar',
          created_at: '2026-09-18T00:00:00.000Z', updated_at: '2026-09-18T00:00:00.000Z',
          linear_parent_ids: null }];
      }
      return [{ key: 'native_intake_epochs', value: {
        video: { enabled: true, epoch: 'e1' },
        graphics: { enabled: false, epoch: 'e2' },
      } }];
    };
    ctx._nativePostPurpose = () => 'calendar';
    vm.runInContext(latestBatch, ctx);
    const rows = await ctx._calLatestNativeBatches('fixture-client', 'calendar');
    ok(rows[0]._nativeAppendTeams.includes('video') && !rows[0]._nativeAppendTeams.includes('graphics'),
    'a well-formed payload with graphics legitimately disabled keeps its real partial list — not treated as a failure');
  }
  // Owner ruling 2026-08-16: creation asks what the post needs. The mode is
  // part of the dialog state, re-renders the picker (compatibility depends on
  // it), and rides the intent signature so a saved job of one shape can never
  // silently resume as another.
  const setMode = extract('_calSetNativePostMode');
  ok(choice.includes('name="calNativeModeChoice"')
    && choice.includes('value="both"') && choice.includes('value="video"') && choice.includes('value="thumbnail"')
    && choice.includes('_calSetNativePostMode(this.value)')
    && setMode.includes("['video', 'thumbnail', 'both'].includes(mode)")
    && setMode.includes('_calRenderNativePostChoice()'),
  'Create Post asks video/thumbnail/both, and a mode change re-renders the mode-dependent picker');
  ok(choice.includes('_calNativeBatchLists(state.batchOptions, mode, state.batchPostCounts)')
    && choice.includes('_calNativeBatchDisplayName(batch)')
    && choice.includes('_calNativeBatchStartMeta(batch.created_at')
    && !choice.includes('cal-native-batch-unavailable')
    && choice.includes('cal-native-batch-select')
    && choice.includes('_calNativePrevBatchPick(this, true)'),
  'dropdown rows are titled by batch name with start-date subtext; incompatible batches are not rendered (behavioral pins: test/create-post-picker.js)');
  // Generalised 2026-08-19: ONE dialog now serves the Calendar and the Samples
  // tab, so "the open Calendar" became "the open view for this surface"
  // (_nativePostViewSlug). The contract is unchanged -- the client comes from
  // whichever view is on screen and there is still no client picker anywhere
  // in the dialog.
  ok(openPost.includes('initiatingClientName, initiatingClientSlug, initiatingSurface')
    && openPost.includes("const clientName = String(initiatingClientName || viewClient || '').trim()")
    && openPost.includes('const clientSlug = String(initiatingClientSlug')
    && openPost.includes('if (_nativePostViewSlug(surface) !== clientSlug) return')
    && !/linearClientSearch/.test(openPost + choice) && !/<select/.test(openPost)
    /* The batch picker is the ONLY native select in this dialog. The editor
       picker (2026-08-24) is built on the sv-select primitive, which renders
       buttons rather than an OS menu, so the original single-select allowlist
       still holds and is deliberately not widened. The invariant it protects
       is that no control here chooses the CLIENT -- that comes from the open
       view and nothing else. */
    && !/<select(?![^>]*cal-native-batch-select)/.test(choice)
    && !/client/i.test((choice.match(/<select[^>]*>/g) || []).join(' ')),
  'Create Post derives the client from the open view and exposes no client picker');
  // `surface` is now a variable rather than the 'calendar' literal, because the
  // Samples tab drives the same submit. It still reaches both the payload and
  // the idempotency signature, which is what the pin is for.
  ok(createPost.includes("operation: 'intake_create', surface, client_slug")
    /* 2026-08-24: the item builder gained the chosen video editor, and the
       signature gained it too -- a different editor is a different submission
       and must not resume a saved job that named somebody else. */
    && createPost.includes('items: _linearIntakeItems(mode, videos, requestId, surface, videoAssigneeId)')
    && createPost.includes('video_assignee_id: videoAssigneeId,')
    /* 2026-08-20: the signature gained post_count, so a saved 3-post job can
       never resume under a 12-post request. Pinned as the full head rather
       than relaxed, so a future edit that drops the count is caught here. */
    && createPost.includes("surface, choice, mode, post_count: postCount, client_slug: state.clientSlug")
    && createPost.includes('_calNativeBatchCompatible(latest, mode)')
    && createPost.includes("payload.batch_id = String(latest.id || '')")
    && createPost.includes("payload.expected_batch_updated_at = String(latest.updated_at || '')")
    /* 2026-09-07: the new-batch name is now whatever the SMM typed, falling
       back to the generated title when the field is untouched -- so the pin
       moved from the generator call to the resolver that wraps it. The
       generator is still the default and _calNativeBatchNameFor is still the
       only thing that decides, which is what this holds in place. */
    && createPost.includes('payload.batch = { name: batchName, description: null }')
    && createPost.includes('const batchName = _calNativeBatchNameFor(state);')
    && /if \(!typed\) return _linearIntakeBatchTitle\(state && state\.clientName, surface\);/
      .test(extract('_calNativeBatchNameFor')),
  'latest append carries batch CAS while new-batch Calendar intake reuses intake_create');
  // The resume reason is now chosen by surface so a recovered job resumes onto
  // its own tab; the calendar half of that ternary is the original string.
  ok(!createPost.includes('_calUpsertFetch')
    && createPost.includes("surface === 'sxr' ? 'samples-create-post' : 'calendar-create-post'")
    && addPost.indexOf("const clientName = String(calState.client || '').trim()") < addPost.indexOf('await _writeUiRerouteUseGatewayWhenReady(clientSlug)')
    && addPost.includes('calClientSlug(calState.client) !== clientSlug')
    && addPost.includes('_calInsertLocalBlankCard()')
    && addPost.includes('_calOpenNativePost(clientName, clientSlug)'),
  'staff Create Post stays legacy for non-enrolled clients and cannot upsert before an enrolled native response');

  ok(submit.indexOf("const clientName = input?.value?.trim() || ''") < submit.indexOf('await _writeUiRerouteUseGatewayWhenReady(selectedClientSlug || clientName)')
    && submit.includes("const selectedClientSlug = String(input?.dataset.clientSlug || '').trim()")
    && submit.includes('selectionStillCurrent()')
    && submit.includes('_linearResolveClientRow(clientName, selectedClientSlug)'),
  'Submit binds one client selection across the allowlist wait and native resolution');

  // --- terminal-refusal discard: a resumed job the server permanently ------
  // refuses must clear itself after two strikes instead of re-arming forever.
  vm.runInContext(extract('_linearIntakeDiscardTerminallyRefused'), context);
  const notifications = [];
  context.showNotify = (title, body) => notifications.push({ title, body });
  const seedJob = extra => {
    store.set('pending', JSON.stringify(Object.assign({
      version: 3, signature: 'sig', result: null,
      payload: { operation: 'intake_create', request_id: 'rq-discard', client_slug: 'fixture', items: [] }
    }, extra || {})));
  };
  const refusal = status => Object.assign(new Error('refused'), { status, code: 'write_conflict' });
  const call = (reason, status) => vm.runInContext(
    `_linearIntakeDiscardTerminallyRefused(${JSON.stringify(reason)}, 'rq-discard', __err)`,
    Object.assign(context, { __err: refusal(status) }));

  seedJob();
  ok(call('resume', 409) === false && store.has('pending')
    && JSON.parse(store.get('pending')).resume_refusals === 1
    && notifications.length === 0,
  'first terminal refusal on a resume records a strike and keeps the job');
  ok(call('resume', 409) === true && !store.has('pending')
    && notifications.length === 1
    && /discarded/i.test(notifications[0].title + notifications[0].body)
    && notifications[0].body.includes('fixture'),
  'second terminal refusal discards the job and announces it with the client named');
  notifications.length = 0;

  seedJob();
  ok(call('submit', 409) === false && call('calendar-create-post', 409) === false
    && store.has('pending') && !JSON.parse(store.get('pending')).resume_refusals,
  'a live-click failure never discards: the user is present to retry');
  ok(call('resume', 401) === false && call('resume', 403) === false && store.has('pending')
    && !JSON.parse(store.get('pending')).resume_refusals,
  'auth refusals are never terminal: signing back in can make the job succeed');

  // An append whose database function was never installed returns 500 on every
  // attempt forever, and the job then blocks every later Create Post. A server
  // error has to be survivable-but-bounded rather than ignored outright.
  seedJob();
  ok(call('focus', 500) === false && call('visible', 503) === false && call('online', 500) === false
    && !JSON.parse(store.get('pending')).resume_refusals,
  'a refocused tab never spends a server-error strike: only a fresh page load counts');
  ok([1, 2, 3, 4, 5].every(n => call('resume', 500) === false
      && JSON.parse(store.get('pending')).resume_refusals === n)
    && call('startup', 500) === true && !store.has('pending'),
  'a server error discards only after six page loads, far above the refusal budget');
  ok(notifications.length === 1 && /6 times/.test(notifications[0].body),
  'the discard notice reports the budget the job actually spent');
  notifications.length = 0;

  // Strikes are one counter, so a 5xx already on the job counts toward the
  // smaller 4xx budget. That is deliberate: a 4xx says the payload can never
  // succeed, and two independent failures ending in a terminal refusal is
  // enough to stop re-arming it.
  seedJob();
  ok(call('resume', 500) === false && JSON.parse(store.get('pending')).resume_refusals === 1
    && call('resume', 409) === true && !store.has('pending'),
  'a terminal refusal after a server error discards on the refusal budget, not the server one');
  store.delete('pending');
  notifications.length = 0;

  seedJob({ result: { ok: true, native_committed: true, items: [] }, resume_refusals: 5 });
  ok(call('resume', 409) === false && store.has('pending'),
  'a job with committed native work is never discarded, whatever the strike count');

  seedJob({ payload: { operation: 'intake_create', request_id: 'rq-other', client_slug: 'fixture', items: [] } });
  ok(call('resume', 409) === false && store.has('pending'),
  'a refusal for one request id never touches a different saved job');
  store.delete('pending');
  notifications.length = 0;

  // A page load defers its pageshow resume until identity is verified, so the
  // run that reaches the server arrives as 'staff-verified', not 'resume'.
  // Demanding the literal 'resume' meant no strike ever counted on a real
  // boot and a dead job blocked Create Post forever.
  ['startup', 'focus', 'visible', 'online', 'staff-verified', 'client-verified'].forEach(reason => {
    seedJob();
    ok(call(reason, 409) === false && JSON.parse(store.get('pending')).resume_refusals === 1
      && call(reason, 409) === true && !store.has('pending'),
    'a background ' + reason + ' resume counts terminal-refusal strikes');
    notifications.length = 0;
  });

  // A recovery copy is what sign-out leaves for a committed job: it can never
  // match a fresh post signature, refuses to discard because it committed, and
  // is rewritten on the next sign-out. Without a bounded life it blocks every
  // later Create Post permanently.
  const seedRecovery = extra => seedJob(Object.assign({
    recovery_only: true, suspended: true, signature: 'recovery:rq-discard',
    result: { ok: true, native_committed: true, items: [] }
  }, extra || {}));
  const statusless = () => Object.assign(context, { __err: new Error('calendar_card_write_failed') });
  const callStatusless = reason => vm.runInContext(
    `_linearIntakeDiscardTerminallyRefused(${JSON.stringify(reason)}, 'rq-discard', __err)`, statusless());

  seedRecovery();
  ok(callStatusless('resume') === false && callStatusless('resume') === false
    && callStatusless('resume') === false && JSON.parse(store.get('pending')).resume_refusals === 3
    && notifications.length === 0,
  'a recovery copy survives three failed resumes: its debt is a real calendar card');
  ok(callStatusless('resume') === true && !store.has('pending') && notifications.length === 1
    && /safe in Production/.test(notifications[0].body) && notifications[0].body.includes('fixture'),
  'a recovery copy stops retrying on the fourth failure and says the post itself is safe');
  notifications.length = 0;

  seedRecovery();
  ok(call('resume', 401) === false && call('resume', 403) === false
    && store.has('pending') && !JSON.parse(store.get('pending')).resume_refusals,
  'signing back in can still finish a recovery copy, so auth refusals never strike it');

  seedRecovery({ resume_refusals: 3 });
  ok(call('submit', 409) === false && store.has('pending'),
  'a live click never spends a recovery copy strike either');
  store.delete('pending');
  notifications.length = 0;

  // The blocking copy has to name its own case: there is no dialog that lets
  // the user go back and finish a recovery copy.
  const pendingFn = extract('_linearIntakePending');
  ok(pendingFn.includes("saved.recovery_only === true")
    && pendingFn.includes("'native_intake_recovery_pending'")
    && pendingFn.includes("'native_intake_pending_conflict'"),
  'a recovery copy blocks under its own error code, not the pending-conflict one');
  const errorTextFn = extract('_calNativePostErrorText');
  ok(errorTextFn.includes("code === 'native_intake_recovery_pending'")
    && /stops retrying on its own/.test(errorTextFn),
  'the recovery block reads as self-clearing instead of sending the user to find a dialog');

  const resumeFn = extract('_resumeNativeIntakeJob');
  ok(resumeFn.includes('_linearIntakeDiscardTerminallyRefused(reason, requestId, error)'),
  'the shared resume catch applies the terminal-refusal rule for every caller');

  if (failures) process.exit(1);
  console.log('\nNative intake UI checks passed');
})().catch(error => { console.error(error); process.exit(1); });
