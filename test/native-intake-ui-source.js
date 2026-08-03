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
function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

const store = new Map();
const frozenWrites = [];
const recoveries = [];
let currentIdentity = { role: 'smm', member: { id: 'actor-a' } };
let f133State = 'enabled';
let frozenFailureCardId = '';
const context = {
  CANONICAL_TITLE_MAX_LENGTH: 500,
  NATIVE_INTAKE_PENDING_KEY: 'pending',
  LINEAR_FORM_KEY: 'form',
  LAST_LINK_KEY: 'last-link',
  PROD_WRITE_EF_URL: 'https://example.invalid/production-write',
  CAL_SUPABASE_ANON_KEY: 'public-anon-fixture',
  localStorage: {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  },
  crypto: { randomUUID: () => 'stable-uuid' },
  navigator: { locks: { request: async (_name, _options, callback) => callback() } },
  _calCacheRead: () => ({ posts: [{ order_index: 40 }] }),
  calState: { client: 'fixture', posts: [], focusPid: '' },
  calClientSlug: value => String(value || '').trim().toLowerCase(),
  _calCacheWrite: () => {},
  _calRenderBody: () => {},
  _syncviewStaffIdentityForHeaders: () => currentIdentity,
  _syncviewStaffRoleValue: identity => String(identity && identity.role || ''),
  _syncviewEfHeaders: headers => headers,
  fetch: async (_url, options) => {
    const body = JSON.parse(options.body);
    recoveries.push(body);
    const card = {
      id: body.card_id, client: 'fixture', name: 'Legacy saved title',
      video_deliverable_id: 'calendar-vid', graphic_deliverable_id: 'calendar-gra',
      linear_issue_id: '', graphic_linear_issue_id: '',
    };
    const rows = [
      { id: 'calendar-vid', team: 'video', client_slug: 'fixture', origin: 'calendar', card_id: body.card_id, title: card.name, linear_issue_url: '' },
      { id: 'calendar-gra', team: 'graphics', client_slug: 'fixture', origin: 'calendar', card_id: body.card_id, title: card.name, linear_issue_url: '' },
    ];
    return {
      ok: true, status: 200,
      json: async () => ({
        ok: true, native_committed: true, card_materialization: 'server_committed',
        card, rows, replayed: false,
      }),
    };
  },
  _calUpsertFetch: async (slug, payload, sourceName) => {
    frozenWrites.push({ slug, payload, sourceName });
    const shouldFail = String(payload && payload.post && payload.post.id || '') === frozenFailureCardId;
    return {
      ok: !shouldFail,
      status: shouldFail ? 503 : 200,
      json: async () => shouldFail ? ({ ok: false }) : ({ ok: true, post: payload.post }),
    };
  },
  _f133CanonicalTitleIsEnabled: () => f133State === 'enabled',
  _f133CanonicalTitleIsAbsent: () => f133State === 'absent',
  _f133CanonicalTitleIntakeVersion: () => f133State === 'enabled' ? 4 : (f133State === 'absent' ? 3 : null),
  _f133CanonicalTitleCanAdoptCommittedV3: () => ['enabled', 'disabled'].includes(f133State),
  _f133RefreshCanonicalTitleObservation: async () => f133State,
  console,
};
vm.createContext(context);
vm.runInContext([
  extract('_linearIntakeRequestId'),
  extract('_linearIntakeWithLock'),
  extract('_linearIntakeRead'),
  extract('_linearIntakeJobId'),
  extract('_linearIntakeWrite'),
  extract('_linearIntakeRemoveIfCurrent'),
  extract('_linearIntakeActorError'),
  extract('_linearIntakeRecordedVersion'),
  extract('_linearIntakeJobVersion'),
  extract('_linearIntakeRequireActor'),
  extract('_linearIntakeRecoveryCopy'),
  extract('_linearIntakePersistRecovery'),
  extract('_linearIntakeCheckpointOrSuspend'),
  extract('_linearIntakePurgeSensitiveState'),
  extract('_linearIntakePending'),
  extract('_linearVideoBrief'),
  extract('_linearIntakeBatchTitle'),
  extract('_canonicalTitleValue'),
  extract('_canonicalTitleTargetValue'),
  extract('_linearIntakeItems'),
  extract('_linearIntakeValidateResult'),
  extract('_writeNativeSubmissionCardsToCalendar'),
].join('\n'), context);

const makePayload = (requestId, sourceEditedAt) => ({
  operation: 'intake_create', client_slug: 'fixture', request_id: requestId,
  source_edited_at: sourceEditedAt, intake_version: 4,
  items: [
    { team: 'video', videoNumber: 1, card_id: 'card-1', title: 'Launch story' },
    { team: 'graphics', videoNumber: 1, card_id: 'card-1', title: 'Launch story' },
    { team: 'video', videoNumber: 2, card_id: 'card-2', title: 'Founder update' },
    { team: 'graphics', videoNumber: 2, card_id: 'card-2', title: 'Founder update' },
  ],
});
const result = {
  ok: true, native_committed: true, intake_version: 4, card_materialization: 'server_committed',
  batch: { id: 'batch-safe', client_slug: 'fixture' },
  items: [
    { item_index: 3, video_number: 2, id: 'gra-2', batch_id: 'batch-safe', client_slug: 'fixture', origin: 'calendar', team: 'graphics', card_id: 'card-2', title: 'Founder update', linear_issue_url: 'https://linear.invalid/GRA-2' },
    { item_index: 0, video_number: 1, id: 'vid-1', batch_id: 'batch-safe', client_slug: 'fixture', origin: 'calendar', team: 'video', card_id: 'card-1', title: 'Launch story', linear_issue_url: 'https://linear.invalid/VID-1' },
    { item_index: 2, video_number: 2, id: 'vid-2', batch_id: 'batch-safe', client_slug: 'fixture', origin: 'calendar', team: 'video', card_id: 'card-2', title: 'Founder update', linear_issue_url: 'https://linear.invalid/VID-2' },
    { item_index: 1, video_number: 1, id: 'gra-1', batch_id: 'batch-safe', client_slug: 'fixture', origin: 'calendar', team: 'graphics', card_id: 'card-1', title: 'Launch story', linear_issue_url: 'https://linear.invalid/GRA-1' },
  ],
  cards: [
    { id: 'card-1', client: 'fixture', name: 'Launch story', video_deliverable_id: 'vid-1', graphic_deliverable_id: 'gra-1', linear_issue_id: 'https://linear.invalid/VID-1', graphic_linear_issue_id: 'https://linear.invalid/GRA-1' },
    { id: 'card-2', client: 'fixture', name: 'Founder update', video_deliverable_id: 'vid-2', graphic_deliverable_id: 'gra-2', linear_issue_id: 'https://linear.invalid/VID-2', graphic_linear_issue_id: 'https://linear.invalid/GRA-2' },
  ],
};

(async () => {
  const paired = context._linearIntakeItems('both', [{ number: 1, title: '  Launch   story  ', dueDate: '2026-07-20' }], 'calendar:stable-uuid', 4);
  ok(paired.length === 2
    && paired[0].team === 'video' && paired[1].team === 'graphics'
    && paired[0].card_id === paired[1].card_id
    && paired[0].title === 'Launch story' && paired[1].title === 'Launch story'
    && paired[0].due_date === '2026-07-20' && paired[1].due_date === '2026-07-20',
  'shared intake builder normalizes one explicit canonical title across a deterministic VID+GRA card');
  let blankTitleRejected = false;
  try { context._linearIntakeItems('both', [{ number: 1, title: '   ' }], 'calendar:blank', 4); }
  catch (error) { blankTitleRejected = error.code === 'canonical_title_required'; }
  ok(blankTitleRejected, 'native intake refuses whitespace-only titles before a request can be committed');

  const actorContext = { clientSlug: 'fixture', job_version: 4, initiating_actor_id: 'actor-a', initiating_actor_role: 'smm' };
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
  ok(actorBlocked && frozenWrites.length === 0 && recoveries.length === 0,
  'a different verified staff member cannot resume the initiating actor job');
  currentIdentity = { role: 'smm', member: { id: 'actor-a' } };
  await context._writeNativeSubmissionCardsToCalendar(first);
  const adopted = context._linearIntakeRead();
  const materializedCard = context.calState.posts.find(card => card && card.id === 'card-1');
  ok(frozenWrites.length === 0 && recoveries.length === 0 && adopted.completed_card_ids.length === 2,
  'current responses adopt transactionally committed cards without any frozen-writer request');
  ok(materializedCard && materializedCard.name === 'Launch story'
    && materializedCard.video_deliverable_id === 'vid-1'
    && materializedCard.graphic_deliverable_id === 'gra-1'
    && context.calState.focusPid === 'card-2',
  'validated server output materializes the exact canonical title and both native identities into Calendar state');

  const v4AfterKill = JSON.parse(JSON.stringify(adopted));
  v4AfterKill.completed_card_ids = [];
  frozenWrites.length = 0;
  const recoveriesBeforeV4Kill = recoveries.length;
  f133State = 'disabled';
  context._linearIntakeWrite(v4AfterKill);
  await context._writeNativeSubmissionCardsToCalendar(v4AfterKill);
  ok(v4AfterKill.completed_card_ids.length === 2
    && frozenWrites.length === 0
    && recoveries.length === recoveriesBeforeV4Kill,
  'an already-committed v4 job finishes from its exact server receipt after kill and never downgrades to either v3 materializer');
  f133State = 'enabled';

  const malformedJobVersions = [
    ['missing v4 request marker', job => { delete job.payload.intake_version; }],
    ['string v4 request marker', job => { job.payload.intake_version = '4'; }],
    ['string local job version', job => { job.version = '4'; }],
    ['v3 request carrying a v4 marker', job => { job.version = 3; }],
  ];
  for (const [label, mutate] of malformedJobVersions) {
    const malformed = JSON.parse(JSON.stringify(adopted));
    mutate(malformed);
    let code = '';
    try { context._linearIntakeJobVersion(malformed); }
    catch (error) { code = String(error && error.code || ''); }
    ok(code === 'native_intake_version_invalid', label + ' fails closed before recovery routing');
  }

  for (const [label, mutate] of [
    ['missing v4 receipt marker', job => { delete job.result.intake_version; }],
    ['string v4 receipt marker', job => { job.result.intake_version = '4'; }],
  ]) {
    const malformed = JSON.parse(JSON.stringify(adopted));
    mutate(malformed);
    let message = '';
    try { context._linearIntakeValidateResult(malformed, malformed.result); }
    catch (error) { message = String(error && error.message || ''); }
    ok(message === 'invalid_native_intake_version_receipt', label + ' fails closed before materialization');
  }

  const beforeInvalid = recoveries.length;
  let invalidRejected = false;
  const invalid = JSON.parse(JSON.stringify(adopted));
  invalid.result.items = invalid.result.items.filter(item => item.item_index !== 1);
  try { await context._writeNativeSubmissionCardsToCalendar(invalid); }
  catch (_error) { invalidRejected = true; }
  ok(invalidRejected && recoveries.length === beforeInvalid && frozenWrites.length === 0,
  'an incomplete response mapping aborts before any adoption or Calendar write');

  const markerlessV4 = JSON.parse(JSON.stringify(adopted));
  markerlessV4.version = 4;
  delete markerlessV4.result.card_materialization;
  let markerlessRejected = '';
  try { context._linearIntakeValidateResult(markerlessV4, markerlessV4.result); }
  catch (error) { markerlessRejected = String(error && error.message || ''); }
  ok(markerlessRejected === 'server_card_materialization_required'
    && recoveries.length === beforeInvalid && frozenWrites.length === 0,
  'a v4 response without the exact server-committed card marker fails before adoption or a frozen-writer fallback');

  const receiptSabotage = [
    ['append batch id', job => {
      job.payload.batch_id = 'batch-safe';
      job.result.batch.id = 'different-batch';
    }],
    ['batch client', job => { job.result.batch.client_slug = 'different-client'; }],
    ['item video number', job => { job.result.items[0].video_number = 99; }],
    ['item client scope', job => { job.result.items[0].client_slug = 'different-client'; }],
    ['item batch scope', job => { job.result.items[0].batch_id = 'different-batch'; }],
    ['item origin', job => { job.result.items[0].origin = 'samples'; }],
    ['card Linear link', job => { job.result.cards[0].linear_issue_id = 'https://linear.invalid/WRONG'; }],
  ];
  for (const [label, sabotage] of receiptSabotage) {
    const bad = JSON.parse(JSON.stringify(adopted));
    bad.version = 4;
    bad.completed_card_ids = [];
    sabotage(bad);
    let rejected = false;
    try { context._linearIntakeValidateResult(bad, bad.result); }
    catch (_error) { rejected = true; }
    ok(rejected, 'v4 native receipt rejects the wrong ' + label);
  }

  store.delete('pending');
  recoveries.length = 0;
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
        { item_index: 0, id: 'calendar-vid', team: 'video', card_id: 'calendar-card', title: 'Legacy saved title' },
        { item_index: 1, id: 'calendar-gra', team: 'graphics', card_id: 'calendar-card', title: 'Legacy saved title' },
      ],
    },
    completed_card_ids: [], stage: 'materializing_cards', telemetry_sent: true,
  };
  const v3ReceiptWithV4Marker = JSON.parse(JSON.stringify(calendarJob));
  v3ReceiptWithV4Marker.result.intake_version = 4;
  let v3ReceiptMarkerRejected = '';
  try { context._linearIntakeValidateResult(v3ReceiptWithV4Marker, v3ReceiptWithV4Marker.result); }
  catch (error) { v3ReceiptMarkerRejected = String(error && error.message || ''); }
  ok(v3ReceiptMarkerRejected === 'invalid_native_intake_version_receipt',
  'a recorded v3 job rejects a v4 receipt marker instead of silently promoting its recovery path');
  context._linearIntakeWrite(calendarJob, { allowCreate: true });
  await context._writeNativeSubmissionCardsToCalendar(calendarJob);
  ok(recoveries.length === 1
    && JSON.stringify(recoveries[0]) === JSON.stringify({
      operation: 'intake_recover', surface: 'calendar',
      request_id: 'calendar:materialize', card_id: 'calendar-card', client_slug: 'fixture',
    })
    && frozenWrites.length === 0,
  'a retained pre-v4 job may use the authenticated atomic adopter while F133 is ON');

  store.delete('pending');
  calendarJob.completed_card_ids = [];
  frozenWrites.length = 0;
  const recoveriesBeforeKill = recoveries.length;
  f133State = 'absent';
  context._linearIntakeWrite(calendarJob, { allowCreate: true });
  await context._writeNativeSubmissionCardsToCalendar(calendarJob);
  ok(recoveries.length === recoveriesBeforeKill
    && frozenWrites.length === 1
    && frozenWrites[0].slug === 'fixture'
    && frozenWrites[0].sourceName === 'calendar-native'
    && frozenWrites[0].payload.post.id === 'calendar-card'
    && frozenWrites[0].payload.post.name === 'Legacy saved title',
  'the same recorded v3 job resumes through the frozen card writer only while the F133 row is absent');

  store.delete('pending');
  frozenWrites.length = 0;
  const partialJob = {
    version: 3,
    signature: 'preinstall partial materialization',
    payload: {
      operation: 'intake_create', surface: 'calendar', client_slug: 'fixture',
      request_id: 'calendar:partial', source_edited_at: '2026-07-13T12:30:00.000Z',
      items: [
        { team: 'video', videoNumber: 1, card_id: 'partial-card-1' },
        { team: 'graphics', videoNumber: 1, card_id: 'partial-card-1' },
        { team: 'video', videoNumber: 2, card_id: 'partial-card-2' },
        { team: 'graphics', videoNumber: 2, card_id: 'partial-card-2' },
      ],
    },
    context: {
      surface: 'calendar', materialization_source: 'calendar-native', clientSlug: 'fixture',
      initiating_actor_id: 'actor-a', initiating_actor_role: 'smm',
    },
    result: {
      ok: true, native_committed: true, batch: { id: 'batch-partial' },
      items: [
        { item_index: 0, id: 'partial-vid-1', team: 'video', card_id: 'partial-card-1', title: 'First saved title', linear_issue_url: 'https://linear.invalid/VID-P1' },
        { item_index: 1, id: 'partial-gra-1', team: 'graphics', card_id: 'partial-card-1', title: 'First saved title', linear_issue_url: 'https://linear.invalid/GRA-P1' },
        { item_index: 2, id: 'partial-vid-2', team: 'video', card_id: 'partial-card-2', title: 'Second saved title', linear_issue_url: 'https://linear.invalid/VID-P2' },
        { item_index: 3, id: 'partial-gra-2', team: 'graphics', card_id: 'partial-card-2', title: 'Second saved title', linear_issue_url: 'https://linear.invalid/GRA-P2' },
      ],
    },
    completed_card_ids: [], stage: 'materializing_cards', telemetry_sent: true,
  };
  context._linearIntakeWrite(partialJob, { allowCreate: true });
  frozenFailureCardId = 'partial-card-2';
  let partialFailure = '';
  try { await context._writeNativeSubmissionCardsToCalendar(partialJob); }
  catch (error) { partialFailure = String(error && error.message || ''); }
  const checkpointedPartial = context._linearIntakeRead();
  ok(partialFailure === 'calendar_card_write_failed'
    && JSON.stringify(checkpointedPartial.completed_card_ids) === JSON.stringify(['partial-card-1'])
    && frozenWrites.length === 2,
  'the frozen preinstall Calendar writer checkpoints the first card before a later card failure');
  ok(frozenWrites[0].payload.post.name === 'First saved title'
    && frozenWrites[0].payload.post.video_deliverable_id === 'partial-vid-1'
    && frozenWrites[0].payload.post.graphic_deliverable_id === 'partial-gra-1',
  'the frozen writer emits the validated server title and exact paired deliverable identities');

  frozenFailureCardId = '';
  const beforePartialRetry = frozenWrites.length;
  await context._writeNativeSubmissionCardsToCalendar(checkpointedPartial);
  ok(frozenWrites.length === beforePartialRetry + 1
    && frozenWrites[beforePartialRetry].payload.post.id === 'partial-card-2'
    && JSON.stringify(checkpointedPartial.completed_card_ids)
      === JSON.stringify(['partial-card-1', 'partial-card-2']),
  'retry resumes the frozen preinstall writer at only the missing deterministic card');

  f133State = 'enabled';
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
  store.set('form', 'private form'); store.set('last-link', 'private link');
  await context._linearIntakePurgeSensitiveState();
  const scrubbedRaw = store.get('pending') || '';
  const scrubbed = JSON.parse(scrubbedRaw);
  ok(!store.has('form') && !store.has('last-link')
    && !scrubbedRaw.includes('private notes') && !scrubbedRaw.includes('drive.invalid')
    && !scrubbedRaw.includes('camera details') && scrubbed.result.native_committed === true,
  'sign-out scrubs sensitive intake payloads while retaining committed recovery IDs');

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
  const legacySubmit = extract('_submitLinearFormLegacy');
  const f44Submit = extract('_submitLinearFormOnce');
  const f44Transport = extract('_linearAwaitCreate');
  const f44Received = extract('_linearConfirmedReceived');
  const linearView = extract('renderLinearView');
  const legacyGate = extract('_linearLegacyRecoveryState');
  const legacyGateFunctions = [
    extract('_linearStableJson'), extract('_linearStorageError'),
    extract('_linearTargetForTeam'), extract('_linearSelectedTeams'),
    extract('_linearReceiptKey'), extract('_linearUuid'), legacyGate,
  ].join('\n');
  const legacyPayloadHash = 'fixture-payload-hash';
  const legacyPayload = {
    clientName: 'Legacy Acme', filmingPlans: '', notes: '', title: 'Legacy Acme batch',
    videos: [{ number: 1, title: 'Old receipt title' }],
  };
  const legacyDraftRaw = JSON.stringify({ client: 'Legacy Acme', videos: [{ title: 'Old receipt title' }] });
  const makeLegacyReceiptRaw = statuses => JSON.stringify({
    version: 1,
    receipts: Object.fromEntries(Object.entries(statuses).map(([team, status]) => [team, {
      version: 1, team, payload: legacyPayload, payload_hash: legacyPayloadHash,
      receipt_key: 'linear-intake-v1:' + team + ':' + legacyPayloadHash,
      status, draft_raw: legacyDraftRaw, last_link_raw: null,
      parent_id: status === 'created' ? '11111111-1111-4111-8111-111111111111' : null,
    }])),
  });

  let legacyResumeCalls = 0;
  const recoverableLegacyRaw = makeLegacyReceiptRaw({ video: 'failed', graphics: 'pending' });
  const legacyRouteContext = {
    LINEAR_RECEIPTS_KEY: 'legacy-receipts',
    VIDEO_FORM_WEBHOOK: 'legacy-video', GRAPHIC_FORM_WEBHOOK: 'legacy-graphics',
    localStorage: { getItem: key => key === 'legacy-receipts' ? recoverableLegacyRaw : null },
    document: { getElementById: () => null },
    _linearPayloadHash: async () => legacyPayloadHash,
    _f133RefreshCanonicalTitleObservation: async () => null,
    _submitLinearFormLegacy: async mode => { legacyResumeCalls++; return { ok: true, mode }; },
  };
  vm.createContext(legacyRouteContext);
  vm.runInContext(legacyGateFunctions + '\n' + submit, legacyRouteContext);
  const legacyRouteResult = await legacyRouteContext._submitLinearFormRoutedOnce('both');
  ok(legacyResumeCalls === 1 && legacyRouteResult.ok === true && legacyRouteResult.mode === 'both',
  'an existing legacy receipt resumes unchanged through its original idempotent lane');

  let registryReads = 0;
  let nativeRuns = 0;
  let nativePending = null;
  let unexpectedLegacyStarts = 0;
  let routeF133State = 'enabled';
  let routeRerouteEnabled = false;
  const clientInput = { value: 'Legacy Acme', dataset: { clientSlug: '' } };
  const statusBox = { textContent: '' };
  const titleInput = { value: '  Real   post name  ', setAttribute() {}, focus() {} };
  const routeStorage = new Map();
  const routeContext = {
    LINEAR_RECEIPTS_KEY: 'legacy-receipts',
    LINEAR_FORM_KEY: 'linear-form', LAST_LINK_KEY: 'last-link',
    VIDEO_FORM_WEBHOOK: 'legacy-video', GRAPHIC_FORM_WEBHOOK: 'legacy-graphics',
    linearClientRows: [], linearClientRegistryState: 'idle',
    localStorage: {
      getItem: key => routeStorage.has(key) ? routeStorage.get(key) : null,
      removeItem: key => routeStorage.delete(key),
    },
    document: {
      getElementById(id) {
        if (id === 'linearClientSearch') return clientInput;
        if (id === 'linearStatus') return statusBox;
        if (id === 'vid_title_1') return titleInput;
        if (id === 'linearNotes' || id === 'linearGeneralDrive') return { value: '' };
        return null;
      },
      querySelectorAll(selector) {
        return selector === '[id^="videoCard_"]' ? [{ id: 'videoCard_1' }] : [];
      },
    },
    _submitLinearFormLegacy: async () => { unexpectedLegacyStarts++; return { ok: false }; },
    _f133PrimeCanonicalTitleFlag: async () => {},
    _f133CanonicalTitleIsEnabled: () => routeF133State === 'enabled',
    _f133CanonicalTitleIntakeVersion: () => routeF133State === 'enabled'
      ? 4 : (routeF133State === 'absent' ? 3 : null),
    _f133RefreshCanonicalTitleObservation: async () => routeF133State,
    _writeUiRerouteUseGatewayWhenReady: async () => routeRerouteEnabled,
    _linearPayloadHash: async () => legacyPayloadHash,
    _linearIntakeRead: () => null,
    fetchLinearProjects: async () => {
      registryReads++;
      routeContext.linearClientRows = [{
        slug: 'legacy-acme', display_name: 'Canonical Acme', kind: 'real', active: true,
      }];
      routeContext.linearClientRegistryState = 'loaded';
    },
    calClientSlug: value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    _linearResolveClientRow: () => null,
    _syncviewRequireStaffIdentity: async () => ({ role: 'smm', member: { id: 'actor-a' } }),
    _linearResolvedPlanUrl: '',
    buildLinearTitle: () => 'Canonical Acme batch',
    wlTodayISO: () => '2026-08-02',
    wlAddWorkingDays: () => '2026-08-07',
    _canonicalTitleValue: value => {
      const title = String(value || '').trim().replace(/\s+/g, ' ');
      return title && title.length <= 500 ? title : '';
    },
    _canonicalTitleTargetValue: value => {
      const title = String(value || '').trim().replace(/\s+/g, ' ');
      return title && title.length <= 500 && !/^(?:video|graphics?)\s+[0-9]+$/i.test(title) ? title : '';
    },
    _linearIntakeItems: (_mode, videos, requestId, version) => videos.map(video => ({
      team: 'graphics', videoNumber: video.number, card_id: 'card-' + requestId, title: video.title,
    })),
    _linearIntakeActorContext: identity => ({
      initiating_actor_id: identity.member.id, initiating_actor_role: identity.role,
    }),
    _linearIntakeWithLock: callback => Promise.resolve().then(callback),
    _linearIntakePending: (signature, makePayload, intakeContext) => {
      nativePending = {
        version: intakeContext.job_version, signature,
        payload: makePayload('submission:native-new', '2026-08-02T00:00:00.000Z'),
        context: intakeContext,
      };
      return nativePending;
    },
    _resumeNativeIntakeJob: async (_reason, pending) => {
      nativeRuns++;
      if (pending !== nativePending) throw new Error('wrong pending job');
      return { ok: true, native_committed: true, card_materialization: 'server_committed' };
    },
    _linearIntakeJobVersion: job => Number(job && job.version || 3),
    navTo() {}, showNotify() {}, console,
  };
  vm.createContext(routeContext);
  vm.runInContext(legacyGateFunctions + '\n' + extract('_submitLinearRunNativeJob') + '\n' + submit, routeContext);
  await routeContext._submitLinearFormRoutedOnce('thumbnail');
  ok(registryReads === 1 && nativeRuns === 1 && unexpectedLegacyStarts === 0
    && nativePending.payload.operation === 'intake_create'
    && nativePending.payload.intake_version === 4
    && nativePending.version === 4
    && nativePending.payload.client_slug === 'legacy-acme'
    && nativePending.payload.items.length === 1
    && nativePending.payload.items[0].title === 'Real post name',
  'a new non-allowlisted active real client uses native canonical intake and never starts legacy create webhooks');

  const nativeRunsBeforeTerminalLeftover = nativeRuns;
  const registryReadsBeforeTerminalLeftover = registryReads;
  routeStorage.set('legacy-receipts', makeLegacyReceiptRaw({ video: 'created', graphics: 'received' }));
  await routeContext._submitLinearFormRoutedOnce('thumbnail');
  ok(nativeRuns === nativeRunsBeforeTerminalLeftover + 1
    && registryReads === registryReadsBeforeTerminalLeftover + 1
    && unexpectedLegacyStarts === 0,
  'an all-terminal leftover receipt cannot authorize a changed legacy submission and proceeds through native intake');

  const nativeRunsBeforeCorruptStore = nativeRuns;
  const registryReadsBeforeCorruptStore = registryReads;
  routeStorage.set('legacy-receipts', '{not-json');
  const corruptStoreResult = await routeContext._submitLinearFormRoutedOnce('thumbnail');
  ok(corruptStoreResult && corruptStoreResult.ok === false
    && corruptStoreResult.error === 'legacy_receipt_invalid'
    && nativeRuns === nativeRunsBeforeCorruptStore
    && registryReads === registryReadsBeforeCorruptStore
    && unexpectedLegacyStarts === 0
    && /No request was sent/.test(statusBox.textContent),
  'a corrupt legacy receipt store fails closed before either legacy or native creation');

  routeStorage.delete('legacy-receipts');
  const nativeBeforeOffLegacy = nativeRuns;
  const registryBeforeOffLegacy = registryReads;
  routeF133State = 'disabled';
  routeRerouteEnabled = false;
  const pausedResult = await routeContext._submitLinearFormRoutedOnce('thumbnail');
  ok(pausedResult && pausedResult.error === 'native_intake_activation_paused'
    && nativeRuns === nativeBeforeOffLegacy
    && registryReads === registryBeforeOffLegacy
    && unexpectedLegacyStarts === 0,
  'an exact-false installed pause starts neither legacy nor v4 Submit work');

  routeF133State = 'absent';
  await routeContext._submitLinearFormRoutedOnce('thumbnail');
  ok(nativeRuns === nativeBeforeOffLegacy
    && registryReads === registryBeforeOffLegacy
    && unexpectedLegacyStarts === 1,
  'only an absent pre-install flag keeps a non-cohort Submit on the legacy lane');
  routeRerouteEnabled = true;
  await routeContext._submitLinearFormRoutedOnce('thumbnail');
  ok(nativePending && nativePending.version === 3
    && !Object.prototype.hasOwnProperty.call(nativePending.payload, 'intake_version'),
  'an absent pre-install cohort Submit records v3 and omits the F133 wire marker');
  routeF133State = 'enabled';
  routeRerouteEnabled = false;

  const nativeRunsBeforeRegistryFailure = nativeRuns;
  const legacyRunsBeforeRegistryFailure = unexpectedLegacyStarts;
  routeContext.fetchLinearProjects = async () => {
    registryReads++;
    routeContext.linearClientRegistryState = 'failed';
  };
  const unavailableResult = await routeContext._submitLinearFormRoutedOnce('thumbnail');
  ok(unavailableResult && unavailableResult.error === 'native_client_registry_unavailable'
    && nativeRuns === nativeRunsBeforeRegistryFailure && unexpectedLegacyStarts === legacyRunsBeforeRegistryFailure
    && /No create request was sent/.test(statusBox.textContent),
  'an unavailable active registry fails closed without starting native or legacy work');

  ok(submitEntry.includes('_submitLinearFormRoutedOnce(mode)')
    && /operation: 'intake_create'/.test(submit)
    && /surface: 'submission'/.test(submit)
    && /_syncviewRequireStaffIdentity\('intake'\)/.test(submit)
    && /await fetchLinearProjects\(\)/.test(submit)
    && /linearClientRegistryState !== 'loaded'/.test(submit)
    && /await _f133RefreshCanonicalTitleObservation\(\)/.test(submit)
    && /_writeUiRerouteUseGatewayWhenReady/.test(submit)
    && /jobVersion = _f133CanonicalTitleIntakeVersion\(\)/.test(submit)
    && /native_intake_activation_paused/.test(submit)
    && /payload\.intake_version = 4/.test(submit)
    && /_submitLinearFormLegacy/.test(submit),
  'Submit re-reads before commit, preserves preinstall v3, blocks installed pause, and creates marked v4 only after activation');
  ok(!/VIDEO_FORM_WEBHOOK|GRAPHIC_FORM_WEBHOOK|_calCardJobCreate|_writeLinearVideoCardsToCalendar/.test(submit),
  'the new native Submit lane cannot call a legacy create webhook or enqueue a Linear polling job');
  ok(/return _submitLinearFormOnce\(mode, requiredRecoveryRaw\)/.test(legacySubmit)
    && /localStorage\.getItem\(LINEAR_RECEIPTS_KEY\)/.test(legacyGate)
    && submit.includes('await _linearLegacyRecoveryState()')
    && submit.includes("legacyRecovery.state === 'recoverable'")
    && submit.includes("error: 'legacy_receipt_scope_mismatch'")
    && submit.indexOf("legacyRecovery.state === 'recoverable'") < submit.indexOf('await _f133RefreshCanonicalTitleObservation()')
    && submit.includes('if (!useGateway) return _submitLinearFormLegacy(mode);')
    && (submit.match(/_submitLinearFormLegacy\(mode, legacyRecovery\.raw\)/g) || []).length === 1
    && /_linearPrepareReceipts/.test(f44Submit)
    && /_linearAwaitCreate/.test(f44Submit)
    && /_linearApplyReceiptOutcomes/.test(f44Submit)
    && /_calCardJobCreate/.test(f44Submit)
    && /_writeLinearVideoCardsToCalendar/.test(f44Submit)
    && /idempotency_key: receipt\.receipt_key/.test(f44Transport)
    && /await fetch\(target\.url/.test(f44Transport)
    && /_linearConfirmedCreate/.test(f44Transport)
    && !/fetch\((?:VIDEO_FORM_WEBHOOK|GRAPHIC_FORM_WEBHOOK), sendOptions\)/.test(source),
  'validated F44 recovery wins before activation, while new OFF work retains the exact cohort-selected legacy lane');
  ok(f44Received.includes("String(result.status || '').toLowerCase() !== 'received'")
    && f44Received.includes('result.durable_capture !== true')
    && f44Received.includes('result.triage_required !== true')
    && f44Received.includes("['pending', 'failed', 'partial'].includes(ledgerStatus)")
    && f44Received.includes('String(result.idempotency_key || \'\') !== receipt.receipt_key')
    && f44Received.includes('triage_reason_codes'),
  'received acknowledgement is accepted only with durable capture, exact receipt identity, a valid ledger state, and safe triage codes');
  ok(f44Transport.includes('const created = _linearConfirmedCreate(result, receipt)')
    && f44Transport.includes('const received = !created && _linearConfirmedReceived(result, receipt)')
    && f44Transport.includes("kind: created ? 'created' : 'received'")
    && f44Submit.includes("const failures = outcomes.filter(outcome => outcome.kind === 'failed')")
    && f44Submit.includes("const hasReceived = outcomes.some(outcome => outcome.kind === 'received')")
    && /if\s*\(!hasReceived\)\s*\{[\s\S]{0,900}?_calCardJobCreate/.test(f44Submit)
    && f44Submit.includes("linearJustCreated = hasReceived ? 'received' : true")
    && f44Submit.includes("status: hasReceived ? 'received' : 'created'"),
  'received is terminal client success but cannot be represented as a created issue or enqueue Calendar work');
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
  const projectSource = extract('fetchLinearProjects');
  const projectBuilder = extract('_linearRebuildProjectSource');
  const rerouteSetter = extract('_writeUiSetRerouteFlagValue');
  ok(/webhook\/linear-projects/.test(source)
    && /rest\/v1\/clients\?select=slug,display_name,kind,active/.test(projectSource)
    && projectSource.includes('_writeUiPrimeRerouteFlag')
    && projectSource.includes('_f133CanonicalTitleOwnsLinkedNames() || _writeUiRerouteClients.size || pendingNativeClientSlug')
    && projectBuilder.includes('_f133CanonicalTitleOwnsLinkedNames() || _writeUiRerouteUseGateway(row.slug)')
    && projectBuilder.includes('linearLegacyProjects.map')
    && rerouteSetter.includes('_linearRefreshProjectsForRerouteChange(previousClients, nextClients)'),
  'the dropdown is cohort/pending-only pre-install and stays installed-owned through pause/ON');
  const intakeItems = extract('_linearIntakeItems');
  ok(/team: 'graphics'/.test(intakeItems) && !/team: 'graphics'[\s\S]{0,180}brief:/.test(intakeItems),
  'graphics brief remains server-owned');

  const latestBatch = extract('_calLatestNativeBatches');
  const compatibleBatch = extract('_calNativeBatchCompatible');
  const choice = extract('_calRenderNativePostChoice');
  const openPost = extract('_calOpenNativePost');
  const createPost = extract('_calSubmitNativePost');
  const addPost = extract('addCalBlankCard');
  ok(latestBatch.includes('status=eq.active') && latestBatch.includes('order=created_at.desc,id.desc')
    && compatibleBatch.includes("!String(batch.team || '').trim()")
    && choice.includes('value="batch"') && choice.includes('data-batch-id=')
    && choice.includes('is-incompatible') && choice.includes(' disabled')
    && choice.includes('value="new"${compatible.length ? \'\' : \' checked\'}'),
  'Create Post lists recent active batches, disables team-incompatible rows, and falls back to new');
  ok(choice.includes('_calNativeBatchDate(batch.created_at)')
    && choice.includes("_prodTeamLabel(batch.team)")
    && choice.includes("batch.name || 'Current batch'"),
  'duplicate batch names are disambiguated with created time and team');
  ok(openPost.includes('initiatingClientName, initiatingClientSlug')
    && openPost.includes("const clientName = String(initiatingClientName || calState.client || '').trim()")
    && openPost.includes('const clientSlug = String(initiatingClientSlug || calClientSlug(clientName)')
    && openPost.includes('if (calClientSlug(calState.client) !== clientSlug) return')
    && !/linearClientSearch|<select/.test(openPost + choice),
  'Create Post derives the client from the open Calendar and exposes no client picker');
  ok(createPost.includes("operation: 'intake_create', surface: 'calendar'")
    && createPost.includes("items: _linearIntakeItems('both', videos, requestId, jobVersion)")
    && createPost.includes('if (jobVersion >= 4) payload.intake_version = 4')
    && createPost.includes("payload.batch_id = String(latest.id || '')")
    && createPost.includes("payload.expected_batch_updated_at = String(latest.updated_at || '')")
    && createPost.includes('payload.batch = { name: _linearIntakeBatchTitle(state.clientName), description: null }'),
  'latest append carries batch CAS while new-batch Calendar intake reuses intake_create');
  ok(!createPost.includes('_calUpsertFetch')
    && createPost.includes("await _resumeNativeIntakeJob('calendar-create-post', pending)")
    && addPost.indexOf("const clientName = String(calState.client || '').trim()") < addPost.indexOf('await _f133RefreshCanonicalTitleObservation()')
    && addPost.includes('calClientSlug(calState.client) !== clientSlug')
    && addPost.includes("linearClientRegistryState !== 'loaded'")
    && addPost.includes('_linearResolveClientRow(clientName, clientSlug)')
    && addPost.includes('_calInsertLocalBlankCard()')
    && addPost.includes('_writeUiRerouteUseGatewayWhenReady')
    && addPost.includes('_calOpenNativePost(clientName, clientSlug, 3)')
    && addPost.includes("_calOpenNativePost(String(activeClient.display_name || '').trim(), String(activeClient.slug || '').trim(), 4)"),
  'staff Create Post preserves cohort v3/local behavior OFF and requires one live active client for v4 ON');

  async function runAddPostFixture({ clientLink = false, registryState = 'loaded', rows = [], state = 'enabled', reroute = false } = {}) {
    let registryReads = 0;
    let localCreates = 0;
    let nativeOpens = 0;
    let rerouteReads = 0;
    const notices = [];
    const ctx = {
      _isClientLink: clientLink,
      calState: { client: 'Acme' },
      linearClientRows: rows,
      linearClientRegistryState: registryState,
      _calIsCollabOn: () => true,
      _f133RefreshCanonicalTitleObservation: async () => {},
      _f133CanonicalTitleIsEnabled: () => state === 'enabled',
      _f133CanonicalTitleIntakeVersion: () => state === 'enabled' ? 4 : (state === 'absent' ? 3 : null),
      _calInsertLocalBlankCard: () => { localCreates++; },
      calClientSlug: value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      fetchLinearProjects: async () => { registryReads++; },
      _calOpenNativePost: (name, slug, version) => { nativeOpens++; ctx.opened = { name, slug, version }; },
      _writeUiRerouteUseGatewayWhenReady: async () => { rerouteReads++; return reroute; },
      showNotify: (title, message) => notices.push({ title, message }),
    };
    vm.createContext(ctx);
    vm.runInContext(extract('_linearResolveClientRow') + '\n' + addPost, ctx);
    await ctx.addCalBlankCard();
    return { registryReads, localCreates, nativeOpens, rerouteReads, notices, opened: ctx.opened };
  }

  const activeCalendarCreate = await runAddPostFixture({
    rows: [{ slug: 'acme', display_name: 'Acme', active: true }],
  });
  ok(activeCalendarCreate.registryReads === 1
    && activeCalendarCreate.nativeOpens === 1
    && activeCalendarCreate.localCreates === 0
    && activeCalendarCreate.rerouteReads === 0
    && activeCalendarCreate.opened.name === 'Acme'
    && activeCalendarCreate.opened.slug === 'acme'
    && activeCalendarCreate.opened.version === 4,
  'staff Create Post resolves a fresh active native client and never consults the legacy cohort or creates a local placeholder');

  const unavailableCalendarCreate = await runAddPostFixture({ registryState: 'failed' });
  ok(unavailableCalendarCreate.registryReads === 1
    && unavailableCalendarCreate.nativeOpens === 0
    && unavailableCalendarCreate.localCreates === 0
    && unavailableCalendarCreate.rerouteReads === 0
    && unavailableCalendarCreate.notices.length === 1,
  'staff Create Post fails closed without a local placeholder when the active registry is unavailable');

  const unresolvedCalendarCreate = await runAddPostFixture();
  ok(unresolvedCalendarCreate.registryReads === 1
    && unresolvedCalendarCreate.nativeOpens === 0
    && unresolvedCalendarCreate.localCreates === 0
    && unresolvedCalendarCreate.notices.length === 1,
  'staff Create Post fails closed when the open calendar does not resolve to one active native client');

  const collaborativeSuggestion = await runAddPostFixture({ clientLink: true });
  ok(collaborativeSuggestion.registryReads === 0
    && collaborativeSuggestion.nativeOpens === 0
    && collaborativeSuggestion.localCreates === 1
    && collaborativeSuggestion.rerouteReads === 0,
  'client-link Collaborative Suggest a post remains the only local-placeholder path');

  const pausedCalendarCreate = await runAddPostFixture({ state: 'disabled', reroute: false });
  ok(pausedCalendarCreate.registryReads === 0
    && pausedCalendarCreate.rerouteReads === 0
    && pausedCalendarCreate.localCreates === 0
    && pausedCalendarCreate.nativeOpens === 0
    && pausedCalendarCreate.notices.length === 1,
  'exact-false installed pause blocks Create Post without consulting either old lane');

  const offLegacyCalendarCreate = await runAddPostFixture({ state: 'absent', reroute: false });
  ok(offLegacyCalendarCreate.registryReads === 0
    && offLegacyCalendarCreate.rerouteReads === 1
    && offLegacyCalendarCreate.localCreates === 1
    && offLegacyCalendarCreate.nativeOpens === 0,
  'absent pre-install state retains the local blank-card path with no active-registry read');

  const offNativeCalendarCreate = await runAddPostFixture({ state: 'absent', reroute: true });
  ok(offNativeCalendarCreate.registryReads === 0
    && offNativeCalendarCreate.rerouteReads === 1
    && offNativeCalendarCreate.localCreates === 0
    && offNativeCalendarCreate.nativeOpens === 1
    && offNativeCalendarCreate.opened.version === 3,
  'absent pre-install enrolled Create Post opens the exact recorded v3 native dialog and never widens the registry');

  const authAwait = createPost.indexOf("await _syncviewRequireStaffIdentity('intake')");
  const flagRefresh = createPost.indexOf('await _f133RefreshCanonicalTitleObservation()');
  const selectedAfterAuth = createPost.indexOf('const selectedAfterAuth =');
  const postAuthGuard = createPost.indexOf('if (_calNativePostState !== state', selectedAfterAuth);
  const intakeCommit = createPost.indexOf('await _linearIntakeWithLock');
  ok(flagRefresh >= 0
    && flagRefresh < createPost.indexOf('const jobVersion =')
    && createPost.indexOf('const selectedChoice =') < authAwait
    && createPost.indexOf('const selectedBatchId =') < authAwait
    && authAwait < selectedAfterAuth
    && postAuthGuard > authAwait && postAuthGuard < intakeCommit
    && createPost.includes("document.getElementById('calNativePostOverlay') !== overlay")
    && createPost.includes("String(selectedAfterAuth.value || '') !== selectedChoice")
    && createPost.includes("String(selectedAfterAuth.dataset && selectedAfterAuth.dataset.batchId || '') !== selectedBatchId")
    && createPost.includes('calClientSlug(calState.client) !== state.clientSlug'),
  'Create Post revalidates dialog identity, client, and exact batch choice after authentication and before commit');

  async function queuedCreateMutation(mutate) {
    let releaseLock = null;
    let overlayPresent = true;
    let pendingCalls = 0;
    let resumeCalls = 0;
    let currentF133 = true;
    let currentIdentity = { role: 'smm', member: { id: 'actor-a' } };
    const selected = { value: 'batch', dataset: { batchId: 'batch-1' }, disabled: false };
    const titleInput = {
      value: 'Launch story', disabled: false,
      setAttribute() {}, removeAttribute() {}, focus() {},
    };
    const button = { disabled: false, textContent: 'Create post' };
    const errorBox = { hidden: true, textContent: '' };
    const overlay = {
      dataset: {},
      querySelectorAll: () => [selected, titleInput, button],
    };
    const state = {
      clientName: 'Acme', clientSlug: 'acme', version: 4, title: 'Launch story',
      batchOptions: [{ id: 'batch-1', updated_at: '2026-08-02T00:00:00.000Z' }],
    };
    const ctx = {
      _calNativePostState: state,
      calState: { client: 'Acme', posts: [] },
      document: {
        getElementById(id) {
          if (id === 'calNativePostOverlay') return overlayPresent ? overlay : null;
          if (id === 'calNativePostCreate') return button;
          if (id === 'calNativePostError') return errorBox;
          if (id === 'calNativePostCanonicalTitle') return titleInput;
          return null;
        },
        querySelector: () => selected,
      },
      _syncviewRequireStaffIdentity: async () => currentIdentity,
      _syncviewStaffIdentityForHeaders: () => currentIdentity,
      _syncviewStaffRoleValue: identity => String(identity && identity.role || ''),
      _f133CanonicalTitleIsEnabled: () => currentF133,
      _f133CanonicalTitleIntakeVersion: () => currentF133 ? 4 : null,
      _f133RefreshCanonicalTitleObservation: async () => currentF133,
      calClientSlug: value => String(value || '').trim().toLowerCase(),
      _calNativeBatchCompatible: batch => !!batch,
      _canonicalTitleValue: value => String(value || '').trim().replace(/\s+/g, ' '),
      _canonicalTitleTargetValue: value => {
        const title = String(value || '').trim().replace(/\s+/g, ' ');
        return /^(?:video|graphics?)\s+[0-9]+$/i.test(title) ? '' : title;
      },
      wlTodayISO: () => '2026-08-02',
      wlAddWorkingDays: () => '2026-08-07',
      _linearIntakeBatchTitle: value => String(value || '') + ' batch',
      _linearIntakeItems: () => [{ team: 'video' }, { team: 'graphics' }],
      _linearIntakeActorContext: identity => ({ initiating_actor_id: identity.member.id }),
      _linearIntakeActorError: (status, code) => Object.assign(new Error(code), { status, code }),
      _linearIntakePending: (_signature, makePayload, contextValue) => {
        pendingCalls++;
        return { payload: makePayload('request-1', '2026-08-02T00:00:00.000Z'), context: contextValue };
      },
      _linearIntakeWithLock: callback => new Promise((resolve, reject) => {
        releaseLock = () => Promise.resolve().then(callback).then(resolve, reject);
      }),
      _resumeNativeIntakeJob: async () => { resumeCalls++; return { ok: true, items: [] }; },
      _linearIntakeRead: () => null,
      _linearIntakeRemoveIfCurrent: () => {},
      _calNativePostErrorText: error => String(error && (error.code || error.message) || ''),
      _calCloseNativePost: () => {},
      _calRenderBody: () => {},
      showNotify: () => {},
      console,
    };
    vm.createContext(ctx);
    vm.runInContext(extract('_calSubmitNativePost'), ctx);
    const running = ctx._calSubmitNativePost();
    while (!releaseLock) await new Promise(resolve => setImmediate(resolve));
    mutate({
      ctx, state, selected, titleInput, overlay,
      cancel: () => { ctx._calNativePostState = null; overlayPresent = false; },
      changeIdentity: value => { currentIdentity = value; },
      setF133: value => { currentF133 = value === true; },
    });
    releaseLock();
    await running;
    return { pendingCalls, resumeCalls, errorBox };
  }

  const queuedMutations = [
    ['cancelled dialog', fixture => fixture.cancel()],
    ['changed batch', fixture => { fixture.selected.dataset.batchId = 'batch-2'; }],
    ['changed title', fixture => { fixture.titleInput.value = 'Different title'; }],
    ['changed client', fixture => { fixture.ctx.calState.client = 'Other'; }],
    ['changed identity', fixture => fixture.changeIdentity({ role: 'admin', member: { id: 'actor-b' } })],
    ['F133 activation', fixture => fixture.setF133(false)],
  ];
  for (const [label, mutate] of queuedMutations) {
    const outcome = await queuedCreateMutation(mutate);
    ok(outcome.pendingCalls === 0 && outcome.resumeCalls === 0
      && outcome.errorBox.textContent === 'native_intake_dialog_changed',
    'a queued Create Post aborts before durable intake when the ' + label + ' changes');
  }

  ok(submit.indexOf("const clientName = input?.value?.trim() || ''") < submit.indexOf('await fetchLinearProjects()')
    && submit.includes("const selectedClientSlug = String(input?.dataset?.clientSlug || '').trim()")
    && submit.includes('selectionStillCurrent()')
    && submit.includes('_linearResolveClientRow(clientName, selectedClientSlug)'),
  'Submit binds one client selection across the live active-registry refresh and native resolution');

  if (failures) process.exit(1);
  console.log('\nNative intake UI checks passed');
})().catch(error => { console.error(error); process.exit(1); });
