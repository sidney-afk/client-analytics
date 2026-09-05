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
  extract('_linearIntakeAutomaticAttempts'),
  extract('_linearIntakeScope'),
  extract('_linearIntakeUnresolvedRead'),
  extract('_linearIntakeParkUnknown'),
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
  const f44Received = extract('_linearConfirmedReceived');
  const linearView = extract('renderLinearView');
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
  const resultCheckpoint = runner.indexOf('_linearIntakeCheckpointOrSuspend(job)', runner.indexOf('job.result = result'));
  ok(runner.indexOf('result = await response.json()') < resultCheckpoint
    && resultCheckpoint < runner.indexOf('_linearIntakeSendTelemetry(job)')
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
    && projectSource.indexOf('await _writeUiPrimeRerouteFlag()') < projectSource.indexOf('/rest/v1/clients')
    && projectBuilder.includes('.filter(row => _writeUiRerouteUseGateway(row.slug))')
    && projectBuilder.includes('linearLegacyProjects.map')
    && rerouteSetter.includes('_linearRefreshProjectsForRerouteChange(previousClients, nextClients)'),
  'Submit keeps legacy project names outside the reroute cohort and uses native names only inside it');
  const intakeItems = extract('_linearIntakeItems');
  /* Was: "graphics brief remains server-owned" — the browser sent no graphics
     brief at all, because the server used to generate it and refused a
     caller-supplied one (graphics_brief_server_owned). The owner retired that
     generator on 2026-08-17 and the gateway now ranks a caller-supplied brief
     ABOVE the generated text, so on 2026-08-21 he asked for the per-video note
     to land on the thumbnail sub-issue as well as the video one. What still
     matters, and is pinned here, is that the graphics child gets the NOTE only
     — never the video composer, whose camera and audio lines belong to the
     editor — and that an empty note still leaves the field for the server. */
  ok(/team: 'graphics'[\s\S]{0,180}brief: _linearThumbnailBrief\(/.test(intakeItems),
  'the graphics child carries the owner-written note');
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
    && createPost.includes('payload.batch = { name: _linearIntakeBatchTitle(state.clientName, surface), description: null }'),
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

  // The destructive characterization is superseded by the executable resume
  // and recovery fault matrix in native-intake-preservation.js. Keep this
  // suite guarding the shared source contract as well.
  vm.runInContext(extract('_linearIntakeDiscardTerminallyRefused'), context);
  const retained = { payload: { request_id: 'fixture-kept' }, result: null };
  store.set('pending', JSON.stringify(retained));
  for (const status of [0, 401, 403, 409, 429, 500, 503]) {
    for (let i = 0; i < 8; i++) context._linearIntakeDiscardTerminallyRefused('startup', 'fixture-kept', { status });
    ok(store.get('pending') === JSON.stringify(retained), 'error ' + status + ' never establishes permission to discard');
  }
  ok(extract('_calNativePostErrorText').includes('See its recovery notice'), 'recovery error points to the scoped notice without promising a replay of unknown work');
  ok(!extract('_calSubmitNativePost').includes('_linearIntakeRemoveIfCurrent'), 'Create Post never deletes from a 4xx response');

  if (failures) process.exit(1);
  console.log('\nNative intake UI checks passed');
})().catch(error => { console.error(error); process.exit(1); });
