'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  SNAPSHOT_CONTRACT,
  planCardCommentImport,
  productionId,
  safeAttachments: plannerAttachments,
  sourceCoverage,
  teamForComponent,
} = require('../scripts/f42-card-comment-import');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function snapshotFor(calendar, sxr, mutateManifest) {
  const surfaces = { calendar, sxr };
  const manifest = {
    surfaces: {
      calendar: sourceCoverage(calendar, 'calendar'),
      sxr: sourceCoverage(sxr, 'sxr'),
    },
  };
  if (typeof mutateManifest === 'function') mutateManifest(manifest);
  return { contract: SNAPSHOT_CONTRACT, surfaces, manifest };
}

(async () => {
  const readerPolicy = await import(pathToFileURL(path.join(
    root, 'supabase', 'functions', 'production-comments', 'policy.mjs',
  )).href);
  const writerPolicy = await import(pathToFileURL(path.join(
    root, 'supabase', 'functions', 'production-write', 'policy.mjs',
  )).href);

  ok(readerPolicy.credentialMode('staff-secret', 'client-secret') === 'ambiguous'
    && readerPolicy.credentialMode('staff-secret', '') === 'staff'
    && readerPolicy.credentialMode('', 'client-secret') === 'client',
  'reader refuses ambiguous credentials and distinguishes exact principal modes');
  ok(readerPolicy.roleCompatible('creative', 'editor')
    && readerPolicy.roleCompatible('creative', 'designer')
    && !readerPolicy.roleCompatible('creative', 'smm')
    && !readerPolicy.roleCompatible('smm', 'admin'),
  'staff key family must exactly match one compatible roster role');
  ok(readerPolicy.staffTargetAllowed('creative', 'graphics', 'graphic')
    && !readerPolicy.staffTargetAllowed('creative', 'video', 'graphics')
    && !readerPolicy.staffTargetAllowed('creative', '', 'graphics')
    && readerPolicy.staffTargetAllowed('smm', '', 'graphics'),
  'creative reads are exact-team and unassigned creatives fail closed');
  ok(readerPolicy.clientTargetAllowed('test-client', 'test-client')
    && !readerPolicy.clientTargetAllowed('test-client', 'other-client')
    && readerPolicy.audienceAllowed('client', 'client')
    && !readerPolicy.audienceAllowed('client', 'internal')
    && readerPolicy.audienceAllowed('staff', 'internal'),
  'client reads are exact-client and client-visible audience only');
  const exactClientSurface = {
    source_surface: 'sxr',
    card_id: 'fixture-card',
    component: 'graphic',
  };
  const exactClientTarget = {
    origin: 'samples',
    card_id: 'fixture-card',
    team: 'graphics',
  };
  ok(readerPolicy.clientSurfaceTargetAllowed(exactClientSurface, exactClientTarget)
    && !readerPolicy.clientSurfaceTargetAllowed(
      { ...exactClientSurface, source_surface: 'calendar' }, exactClientTarget,
    )
    && !readerPolicy.clientSurfaceTargetAllowed(
      exactClientSurface, { ...exactClientTarget, origin: 'manual' },
    )
    && !readerPolicy.clientSurfaceTargetAllowed(
      exactClientSurface, { ...exactClientTarget, card_id: 'other-card' },
    )
    && !readerPolicy.clientSurfaceTargetAllowed(
      exactClientSurface, { ...exactClientTarget, team: 'video' },
    ),
  'client reader binds SXR surface, exact card, component team and Samples-origin deliverable');

  const attachmentInput = Array.from({ length: 24 }, (_, index) => ({
    url: `https://example.invalid/file-${index}`,
    name: `File ${index}`,
    mime_type: 'image/png',
    size: index,
  })).concat([
    { url: 'http://example.invalid/insecure', name: 'No' },
    { url: 'javascript:alert(1)', name: 'No' },
  ]);
  const safe = readerPolicy.safeAttachments(attachmentInput);
  ok(safe.length === 20
    && safe.every(item => item.url.startsWith('https://'))
    && safe[0].mime_type === 'image/png'
    && safe[0].size === 0,
  'reader attachment projection is HTTPS-only and bounded to twenty safe fields');
  const publicRow = readerPolicy.publicComment({
    id: 'comment-public',
    native_comment_id: 'raw-private-id',
    linear_comment_id: 'linear-private-id',
    thread_root_id: 'private-root',
    parent_id: null,
    author_name: 'Fixture author',
    author_key: 'member:private',
    author_member_id: 'member-private',
    client_slug: 'private-client',
    role: 'smm',
    body: 'secret deleted body',
    audience: 'client',
    attachments: [{ url: 'https://example.invalid/secret' }],
    deleted_at: '2026-07-23T00:00:00Z',
    provenance: { secret: true },
    version: 2,
  }, { kind: 'staff', keyRole: 'smm', memberId: 'member-smm' });
  ok(publicRow.body === 'Comment deleted.'
    && publicRow.attachments.length === 0
    && publicRow.native_comment_id === 'raw-private-id'
    && !Object.prototype.hasOwnProperty.call(publicRow, 'linear_comment_id')
    && !Object.prototype.hasOwnProperty.call(publicRow, 'thread_root_id')
    && !Object.prototype.hasOwnProperty.call(publicRow, 'author_key')
    && !Object.prototype.hasOwnProperty.call(publicRow, 'client_slug')
    && !Object.prototype.hasOwnProperty.call(publicRow, 'provenance'),
  'public tombstones retain only the bounded native adoption id while redacting body, attachment URLs, provider IDs, scope keys and provenance');
  const boundedAdoption = readerPolicy.publicComment({
    ...publicRow,
    id: 'comment-bounded',
    native_comment_id: 'x'.repeat(220),
    audience: 'internal',
  }, { kind: 'staff', keyRole: 'smm', memberId: 'member-smm' });
  ok(boundedAdoption.native_comment_id === 'x'.repeat(160),
    'response-loss adoption exposes one bounded native comment id');

  const ownCreative = { kind: 'staff', keyRole: 'creative', memberId: 'member-a' };
  const otherCreative = { kind: 'staff', keyRole: 'creative', memberId: 'member-b' };
  const client = { kind: 'client', actorKey: 'client:test-client' };
  const ownRow = { author_member_id: 'member-a', author_key: 'client:test-client', audience: 'client' };
  ok(writerPolicy.normalizeCommentAction('reopen') === ''
    && writerPolicy.normalizeCommentAction('unresolve') === 'unresolve',
  'comment lifecycle accepts the canonical action vocabulary only');
  ok(writerPolicy.commentLifecycleAllowed(ownCreative, 'edit', ownRow)
    && writerPolicy.commentLifecycleAllowed(ownCreative, 'delete', ownRow)
    && !writerPolicy.commentLifecycleAllowed(otherCreative, 'edit', ownRow)
    && !writerPolicy.commentLifecycleAllowed(ownCreative, 'resolve', ownRow),
  'creative lifecycle is limited to own edit/delete and excludes moderation');
  ok(writerPolicy.commentLifecycleAllowed(client, 'edit', ownRow)
    && writerPolicy.commentLifecycleAllowed(client, 'delete', ownRow)
    && !writerPolicy.commentLifecycleAllowed(client, 'resolve', ownRow)
    && !writerPolicy.commentLifecycleAllowed(
      client, 'edit', { ...ownRow, audience: 'internal' },
    ),
  'client lifecycle is limited to its own client-visible edit/delete');
  const rootCaps = writerPolicy.commentLifecycleCapabilities(
    { kind: 'staff', keyRole: 'smm', memberId: 'member-smm' },
    { ...ownRow, parent_id: null },
  );
  const replyCaps = writerPolicy.commentLifecycleCapabilities(
    { kind: 'staff', keyRole: 'smm', memberId: 'member-smm' },
    { ...ownRow, parent_id: 'root' },
  );
  ok(rootCaps.can_edit && rootCaps.can_delete && rootCaps.can_resolve
    && replyCaps.can_edit && replyCaps.can_delete && !replyCaps.can_resolve,
  'server-derived receipts expose moderation capabilities but never resolve replies');

  const rootComment = {
    id: 'root',
    author: 'Fixture SMM',
    role: 'smm',
    body: 'Root',
    audience: 'client',
    attachments: [
      { url: 'https://example.invalid/root.png', name: 'Root attachment' },
      { url: 'http://example.invalid/unsafe.png', name: 'Unsafe' },
    ],
    created_at: '2026-07-23T10:00:00Z',
    updated_at: '2026-07-23T10:00:00Z',
  };
  const replyComment = {
    id: 'reply',
    parent_id: 'root',
    author: 'Fixture client',
    role: 'client',
    body: 'Reply',
    created_at: '2026-07-23T10:01:00Z',
    updated_at: '2026-07-23T10:02:00Z',
    edited_at: '2026-07-23T10:02:00Z',
  };
  const grandchild = {
    id: 'grandchild',
    parent_id: 'reply',
    author: 'Fixture SMM',
    role: 'smm',
    body: 'Nested reply',
    done: true,
    created_at: '2026-07-23T10:03:00Z',
    updated_at: '2026-07-23T10:04:00Z',
  };
  const fixture = [{
    id: 'calendar-card-a',
    client_slug: 'test-client',
    video_deliverable_id: 'deliverable-video-a',
    graphic_deliverable_id: 'deliverable-graphic-a',
    comments: [rootComment],
    video_comments: [grandchild, replyComment, rootComment],
    graphic_comments: [{
      id: 'graphic-root', author: 'Fixture designer', role: 'designer',
      body: 'Graphic note', created_at: '2026-07-23T11:00:00Z',
    }],
    caption_comments: [{
      id: 'caption-root', author: 'Fixture SMM', role: 'smm',
      body: 'Caption note', created_at: '2026-07-23T12:00:00Z',
    }],
    title_comments: [{
      id: 'title-root', author: 'Fixture SMM', role: 'smm',
      body: 'Title note', created_at: '2026-07-23T13:00:00Z',
    }],
  }, {
    id: 'calendar-card-b',
    client_slug: 'test-client',
    video_deliverable_id: 'deliverable-video-b',
    comments: [{
      ...rootComment,
      body: 'Same raw id on a different card is valid',
    }],
  }];
  const planA = planCardCommentImport(snapshotFor(fixture, []), {
    importRunId: 'fixture-run-a',
  });
  const planB = planCardCommentImport(snapshotFor(fixture, []), {
    importRunId: 'fixture-run-b',
  });
  const identity = row => row.identity;
  const order = planA.imports.map(identity);
  const rootIdentity = 'calendar|calendar-card-a|video|root';
  const replyIdentity = 'calendar|calendar-card-a|video|reply';
  const grandIdentity = 'calendar|calendar-card-a|video|grandchild';
  ok(planA.complete && planA.conflicts.length === 0
    && order.indexOf(rootIdentity) < order.indexOf(replyIdentity)
    && order.indexOf(replyIdentity) < order.indexOf(grandIdentity),
  'planner deduplicates aliased arrays and emits arbitrary-depth parents before children');
  ok(planA.imports.filter(row => row.identity === rootIdentity).length === 1
    && planA.imports.some(row => row.identity === 'calendar|calendar-card-b|video|root'),
  'exact aliases collapse once while the same raw id on another card stays distinct');
  const plannedRootA = planA.imports.find(row => row.identity === rootIdentity);
  const plannedRootB = planB.imports.find(row => row.identity === rootIdentity);
  ok(plannedRootA.comment.id === productionId('calendar', 'calendar-card-a', 'video', 'root')
    && plannedRootA.comment.native_comment_id === plannedRootA.comment.id
    && plannedRootA.link.native_comment_id === 'root'
    && plannedRootA.link.source_fingerprint === plannedRootB.link.source_fingerprint,
  'composite canonical identity preserves the raw crosswalk and ignores import-run provenance');
  ok(plannedRootA.comment.audience === 'client'
    && plannedRootA.comment.attachments.length === 1
    && plannedRootA.comment.attachments[0].url.startsWith('https://')
    && planA.imports.find(row => row.identity === replyIdentity).comment.edited_at
    && teamForComponent('graphic') === 'graphics'
    && teamForComponent('caption') === 'video'
    && planA.imports.find(row => row.identity.includes('|graphic|')).link.team === 'graphics'
    && planA.imports.find(row => row.identity.includes('|caption|')).link.team === 'video',
  'planner preserves audience, attachment, edit/lifecycle and component-team metadata');
  ok(plannerAttachments(attachmentInput).length === 20
    && plannerAttachments(attachmentInput).every(item => item.url.startsWith('https://')),
  'planner attachment normalization matches the bounded HTTPS contract');

  const divergentRows = [{
    id: 'card-divergent',
    client_slug: 'test-client',
    video_deliverable_id: 'deliverable-divergent',
    comments: [{ ...rootComment, body: 'One' }],
    video_comments: [{ ...rootComment, body: 'Two' }],
  }];
  const divergent = planCardCommentImport(snapshotFor(divergentRows, []), {
    importRunId: 'divergent-run',
  });
  ok(!divergent.complete
    && divergent.conflicts.some(row => row.classification === 'duplicate_identity'),
  'divergent copies of one card identity are visible conflicts, never first-row-wins');

  const cyclicRows = [{
    id: 'card-cycle',
    client_slug: 'test-client',
    video_deliverable_id: 'deliverable-cycle',
    comments: [
      { ...rootComment, id: 'cycle-a', parent_id: 'cycle-b' },
      { ...rootComment, id: 'cycle-b', parent_id: 'cycle-a' },
    ],
  }];
  const cyclic = planCardCommentImport(snapshotFor(cyclicRows, []), {
    importRunId: 'cycle-run',
  });
  ok(!cyclic.complete
    && cyclic.conflicts.some(row => row.classification === 'parent_cycle')
    && cyclic.imports.length === 0,
  'parent cycles are classified and excluded from the import plan');
  const missingParentRows = [{
    id: 'card-missing-parent',
    client_slug: 'test-client',
    video_deliverable_id: 'deliverable-missing-parent',
    comments: [{ ...replyComment, parent_id: 'not-present' }],
  }];
  const missingParent = planCardCommentImport(snapshotFor(missingParentRows, []), {
    importRunId: 'missing-parent-run',
  });
  ok(!missingParent.complete
    && missingParent.conflicts.some(row => row.classification === 'missing_parent')
    && missingParent.imports.length === 0,
  'unresolved parent links are classified and excluded');
  const tweakRows = [{
    id: 'card-tweak',
    client_slug: 'test-client',
    video_deliverable_id: 'deliverable-tweak',
    video_tweaks: [{
      id: 'tweak-without-redundant-flag',
      author: 'Fixture SMM',
      role: 'smm',
      body: 'Please revise this',
      created_at: '2026-07-23T14:00:00Z',
    }],
  }];
  const tweakPlan = planCardCommentImport(snapshotFor(tweakRows, []), {
    importRunId: 'tweak-run',
  });
  ok(tweakPlan.complete
    && tweakPlan.imports.length === 1
    && tweakPlan.imports[0].comment.is_tweak === true,
  'historical *_tweaks provenance implies tweak semantics even when the redundant flag is absent');

  const legacyEmpty = planCardCommentImport([], { surface: 'calendar' });
  const certifiedEmpty = planCardCommentImport(snapshotFor([], []));
  ok(!legacyEmpty.complete
    && legacyEmpty.conflicts.some(row => row.classification === 'snapshot_contract_required')
    && certifiedEmpty.complete
    && certifiedEmpty.coverage.surfaces.calendar.actual.cards === 0
    && certifiedEmpty.coverage.surfaces.sxr.actual.comments.video === 0,
  'empty input certifies only when both surfaces explicitly declare exact zero-count manifests');

  const partialSnapshot = {
    contract: SNAPSHOT_CONTRACT,
    surfaces: { calendar: fixture },
    manifest: { surfaces: { calendar: sourceCoverage(fixture, 'calendar') } },
  };
  const partialPlan = planCardCommentImport(partialSnapshot);
  ok(!partialPlan.complete
    && partialPlan.conflicts.some(row =>
      row.classification === 'snapshot_contract_required' && row.surface === 'sxr'),
  'a one-surface export can never certify as complete');

  const malformedRows = [{
    id: 'card-malformed',
    client_slug: 'test-client',
    video_deliverable_id: 'deliverable-malformed',
    comments: '{"not":"an array"}',
  }];
  const malformedPlan = planCardCommentImport(snapshotFor(malformedRows, []));
  ok(!malformedPlan.complete
    && malformedPlan.conflicts.some(row =>
      row.classification === 'malformed_comment_field'
      && row.source_field === 'comments'),
  'malformed nonempty legacy comment fields become visible conflicts');

  const badTimestampRows = [{
    id: 'card-bad-timestamp',
    client_slug: 'test-client',
    video_deliverable_id: 'deliverable-bad-timestamp',
    comments: [{
      id: 'ts-bad', author: 'Fixture SMM', role: 'smm', body: 'Has a bad edit stamp',
      created_at: '2026-07-23T10:00:00Z', updated_at: '2026-07-23T10:00:00Z',
      edited_at: 'not-a-real-timestamp',
    }],
  }];
  const badTimestampPlan = planCardCommentImport(snapshotFor(badTimestampRows, []));
  ok(!badTimestampPlan.complete
    && badTimestampPlan.conflicts.some(row =>
      row.classification === 'malformed_lifecycle_timestamp'
      && row.source_field === 'edited_at'
      && row.native_comment_id === 'ts-bad')
    && badTimestampPlan.imports.every(row => row.identity !== 'calendar|card-bad-timestamp|video|ts-bad'),
  'a malformed lifecycle timestamp blocks certification and excludes the apply-unsafe row');

  const badAttachmentFieldRows = [{
    id: 'card-bad-attach-field',
    client_slug: 'test-client',
    video_deliverable_id: 'deliverable-bad-attach-field',
    comments: [{
      id: 'attach-field-bad', author: 'Fixture SMM', role: 'smm', body: 'Attachment field is not an array',
      created_at: '2026-07-23T10:00:00Z',
      attachments: '{"not":"an array"}',
    }],
  }];
  const badAttachmentFieldPlan = planCardCommentImport(snapshotFor(badAttachmentFieldRows, []));
  ok(!badAttachmentFieldPlan.complete
    && badAttachmentFieldPlan.conflicts.some(row =>
      row.classification === 'malformed_attachment_field'
      && row.native_comment_id === 'attach-field-bad'),
  'a nonempty non-array attachments field is a blocking conflict, never a silent drop');

  const badAttachmentEntryRows = [{
    id: 'card-bad-attach-entry',
    client_slug: 'test-client',
    video_deliverable_id: 'deliverable-bad-attach-entry',
    comments: [{
      id: 'attach-entry-bad', author: 'Fixture SMM', role: 'smm', body: 'One attachment entry is a bare string',
      created_at: '2026-07-23T10:00:00Z',
      attachments: ['https://example.invalid/ok.png', 'not-an-object'],
    }],
  }];
  const badAttachmentEntryPlan = planCardCommentImport(snapshotFor(badAttachmentEntryRows, []));
  ok(!badAttachmentEntryPlan.complete
    && badAttachmentEntryPlan.conflicts.some(row =>
      row.classification === 'malformed_attachment_entry'
      && row.native_comment_id === 'attach-entry-bad'
      && row.source_index === 1),
  'a non-object attachment array entry is a blocking conflict');

  const nonHttpsAttachmentRows = [{
    id: 'card-nonhttps-attach',
    client_slug: 'test-client',
    video_deliverable_id: 'deliverable-nonhttps-attach',
    comments: [{
      id: 'attach-nonhttps', author: 'Fixture SMM', role: 'smm', body: 'Has a well-formed http attachment',
      created_at: '2026-07-23T10:00:00Z',
      attachments: [
        { url: 'https://example.invalid/keep.png', name: 'Keep' },
        { url: 'http://example.invalid/drop.png', name: 'Drop' },
      ],
    }],
  }];
  const nonHttpsAttachmentPlan = planCardCommentImport(snapshotFor(nonHttpsAttachmentRows, []));
  const nonHttpsImport = nonHttpsAttachmentPlan.imports.find(row => row.identity === 'calendar|card-nonhttps-attach|video|attach-nonhttps');
  ok(nonHttpsAttachmentPlan.complete
    && nonHttpsAttachmentPlan.conflicts.length === 0
    && nonHttpsImport
    && nonHttpsImport.comment.attachments.length === 1
    && nonHttpsImport.comment.attachments[0].url.startsWith('https://'),
  'a well-formed non-HTTPS attachment stays a policy sanitization, not a blocking malformation');

  const mismatchedPlan = planCardCommentImport(snapshotFor(fixture, [], manifest => {
    manifest.surfaces.calendar.cards += 1;
    manifest.surfaces.sxr.source_sha256 = '0'.repeat(64);
  }));
  ok(!mismatchedPlan.complete
    && mismatchedPlan.conflicts.filter(row => row.classification === 'coverage_mismatch').length === 2
    && !mismatchedPlan.coverage.surfaces.calendar.matches_manifest
    && !mismatchedPlan.coverage.surfaces.sxr.matches_manifest,
  'exact per-surface inventory and deterministic source hashes must both match before certification');

  const migration = read('migrations/2026-07-23-production-comment-thread-lifecycle.sql');
  const writer = read('supabase/functions/production-write/index.ts');
  const outbound = read('supabase/functions/linear-outbound/index.ts');
  ok(/production_comment_mirror_applicable[\s\S]{0,600}return true;/.test(migration)
    && /F2 controls drainer activity[\s\S]{0,180}never the retired epoch/.test(migration)
    && /F2 controls draining[\s\S]{0,220}off, missing, or unreadable/.test(writer)
    && !/outboundEnabledForMirror/.test(writer),
  'F2 off, missing, or unreadable pauses draining but never suppresses comment intent');
  ok(/p_operation := 'comment'/.test(migration)
    && /v_action in \('edit', 'delete'\) and v_mirror_applicable/.test(migration)
    && /resolve\/reopen[\s\S]{0,260}without manufacturing[\s\S]{0,180}outbox row/i.test(migration)
    && !/drop constraint/i.test(migration)
    && !/add constraint[\s\S]{0,100}mirror_outbox/i.test(migration)
    && !/track_b_enqueue_outbound_intent/i.test(migration),
  'add/edit/delete reuse the existing comment operation while resolve/reopen add no outbox or allowlist change');
  ok(/production_comment_bind_linear_id\(/.test(migration)
    && /v_outbox\.comment_id is distinct from v_comment_id/.test(migration)
    && /v_outbox\.payload->>'comment_id'/.test(migration)
    && /'operation', 'link_linear'/.test(migration)
    && /rpc\("production_comment_bind_linear_id"/.test(outbound),
  'provider comment ids bind durably through the exact outbox identity');
  ok(!/comment_mirror_pending|production comment mirror pending/.test(writer + migration)
    && /commentDependsOnId/.test(writer)
    && /\.eq\("comment_id", productionCommentId\)[\s\S]{0,220}\.order\("id", \{ ascending: false \}\)/.test(writer)
    && /o\.comment_id = v_result\.id[\s\S]{0,220}order by o\.id desc/.test(migration)
    && /p_depends_on_id := v_dependency_id/.test(migration)
    && /'pending', 'failed', 'shadow_ok', 'written', 'skipped'/.test(migration),
  'F2-off create, edit, and delete commit native state immediately and enqueue one strictly ordered intent chain');
  ok((writer.match(/audience = lower\(parent\.audience\) === "client" \? "client" : "internal";/g) || []).length === 2,
  'normal and source-reconcile replies inherit canonical parent visibility server-side');
  ok(/v_target_team is distinct from v_expected_team[\s\S]{0,260}v_client_slug is distinct from v_target_client_slug[\s\S]{0,180}v_card_id is distinct from v_target_card_id/.test(migration)
    && /when v_surface = 'calendar' then 'calendar'[\s\S]{0,80}else 'samples'/.test(migration),
  'card import RPC revalidates component team, client, card, deliverable and source surface');
  ok(/from public\.production_comment_card_links l/.test(migration)
    && /and v_result\.linear_comment_id is null/.test(migration)
    && /and v_dependency_id is null/.test(migration)
    && /'card_import_without_foreign', v_card_import_without_foreign/.test(migration)
    && /const cardImportWithoutForeign =/.test(outbound)
    && /card_import_transition_noop: cardImportWithoutForeign/.test(outbound)
    && /context\.comment_import_materialize = true/.test(outbound),
  'an imported comment without provider or predecessor materializes on first edit and terminalizes first delete without a foreign call');
  ok(/malformed_comment_field/.test(migration)
    && /snapshot_contract_required/.test(migration)
    && /coverage_mismatch/.test(migration),
  'the durable F42 conflict catalog accepts certification and malformed-source evidence');

  if (failures) {
    console.error(`\n${failures} production comment slice check(s) failed`);
    process.exit(1);
  }
  console.log('\nProduction comment slice checks passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
