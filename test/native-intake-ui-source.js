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
const writes = [];
let failCard2 = true;
let currentIdentity = { role: 'smm', member: { id: 'actor-a' } };
const context = {
  NATIVE_INTAKE_PENDING_KEY: 'pending',
  LINEAR_FORM_KEY: 'form',
  LAST_LINK_KEY: 'last-link',
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
  ok(submitEntry.includes('_submitLinearFormRoutedOnce(mode)')
    && /operation: 'intake_create'/.test(submit)
    && /surface: 'submission'/.test(submit)
    && /_syncviewRequireStaffIdentity\('intake'\)/.test(submit)
    && /_writeUiRerouteUseGatewayWhenReady/.test(submit)
    && /_submitLinearFormLegacy/.test(submit),
  'Submit uses one authenticated native intake request only for an enrolled client');
  ok(!/VIDEO_FORM_WEBHOOK|GRAPHIC_FORM_WEBHOOK|_calCardJobCreate|_writeLinearVideoCardsToCalendar/.test(submit),
  'the enrolled Submit lane cannot call a legacy create webhook or enqueue a Linear polling job');
  ok(/return _submitLinearFormOnce\(mode\)/.test(legacySubmit)
    && submit.includes('localStorage.getItem(LINEAR_RECEIPTS_KEY)')
    && submit.includes('if (!useGateway)')
    && /_linearPrepareReceipts/.test(f44Submit)
    && /_linearAwaitCreate/.test(f44Submit)
    && /_linearApplyReceiptOutcomes/.test(f44Submit)
    && /_calCardJobCreate/.test(f44Submit)
    && /_writeLinearVideoCardsToCalendar/.test(f44Submit)
    && /idempotency_key: receipt\.receipt_key/.test(f44Transport)
    && /await fetch\(target\.url/.test(f44Transport)
    && /_linearConfirmedCreate/.test(f44Transport)
    && !/fetch\((?:VIDEO_FORM_WEBHOOK|GRAPHIC_FORM_WEBHOOK), sendOptions\)/.test(source),
  'the non-enrolled Submit lane retains F44 receipts and never restores the pre-F44 direct fetch');
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
  ok(/rest\/v1\/clients\?select=slug,display_name,kind,active/.test(source)
    && !/webhook\/linear-projects/.test(source),
  'client selection is sourced from the native registry');
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
    && createPost.includes("items: _linearIntakeItems('both', videos, requestId)")
    && createPost.includes("payload.batch_id = String(latest.id || '')")
    && createPost.includes("payload.expected_batch_updated_at = String(latest.updated_at || '')")
    && createPost.includes('payload.batch = { name: _linearIntakeBatchTitle(state.clientName), description: null }'),
  'latest append carries batch CAS while new-batch Calendar intake reuses intake_create');
  ok(!createPost.includes('_calUpsertFetch')
    && createPost.includes("await _resumeNativeIntakeJob('calendar-create-post', pending)")
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

  if (failures) process.exit(1);
  console.log('\nNative intake UI checks passed');
})().catch(error => { console.error(error); process.exit(1); });
