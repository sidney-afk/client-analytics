'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const edge = read('supabase/functions/production-write/index.ts');
const outboundEdge = read('supabase/functions/linear-outbound/index.ts');
const archiveEdge = read('supabase/functions/production-archive/index.ts');
const migration = read('migrations/2026-07-23-f34-f53-production-attachments.sql');
const f27Migration = read('migrations/2026-07-20-f27-team-rollback.sql');
const proof = read('scripts/f27-team-rollback-proof.sql');
const workflow = read('.github/workflows/f27-team-rollback-proof.yml');
const supabaseConfig = read('supabase/config.toml');
const ui = read('index.html');
const rescueSource = read('scripts/f34-linear-asset-rescue.js');
const rescue = require('../scripts/f34-linear-asset-rescue.js');

let failures = 0;
function ok(value, message) {
  if (value) console.log(`  ok  ${message}`);
  else { failures += 1; console.error(`FAIL  ${message}`); }
}

function extractFunction(source, name) {
  const asyncMarker = `async function ${name}(`;
  const marker = `function ${name}(`;
  const asyncStart = source.indexOf(asyncMarker);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = brace; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${name}`);
}

(async () => {
  const policy = await import(pathToFileURL(path.join(
    ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs',
  )).href);
  const mapping = await import(pathToFileURL(path.join(
    ROOT, 'supabase', 'functions', 'linear-outbound', 'mapping.mjs',
  )).href);

  ok(policy.normalizeOperation('attachment') === 'attachment'
      && policy.staffOperationAllowed('admin', 'attachment', '', 'graphics')
      && policy.staffOperationAllowed('smm', 'attachment', '', 'graphics')
      && policy.staffOperationAllowed('creative', 'attachment', 'graphics', 'graphics')
      && !policy.staffOperationAllowed('creative', 'attachment', 'video', 'graphics')
      && !policy.staffOperationAllowed('creative', 'attachment', 'video', 'video')
      && !policy.clientOperationAllowed('attachment', 'client_approval', ''),
  'attachment writes are staff-only, Graphics-only, and same-team for Creative staff');
  ok(policy.staffAssetReadAllowed('admin', '', 'video')
      && policy.staffAssetReadAllowed('smm', '', 'graphics')
      && policy.staffAssetReadAllowed('creative', 'graphics', 'graphics')
      && !policy.staffAssetReadAllowed('creative', 'graphics', 'video'),
  'asset reads use the explicit Admin/SMM or same-team Creative matrix');

  const driveStable = 'https://drive.google.com/file/d/TEST_RESOURCE_123/view?usp=sharing&resourcekey=stableKey';
  const dropboxStable = 'https://www.dropbox.com/scl/fi/asset/file.png?rlkey=stableKey&dl=0';
  ok(policy.canonicalArtifactUrl(driveStable)
      === 'https://drive.google.com/file/d/TEST_RESOURCE_123/view?resourcekey=stableKey'
      && policy.canonicalArtifactUrl(dropboxStable)
      === 'https://www.dropbox.com/scl/fi/asset/file.png?rlkey=stableKey',
  'canonical links preserve only Drive resourcekey and Dropbox rlkey share identity');
  ok(policy.canonicalArtifactUrl('https://drive.google.com/file/d/TEST_RESOURCE_123/view?token=secret') === null
      && policy.canonicalArtifactUrl('https://drive.google.com/file/d/TEST_RESOURCE_123/view?X-Goog-Signature=secret') === null
      && policy.canonicalArtifactUrl('https://www.dropbox.com/scl/fi/asset/file.png?expires=1') === null
      && policy.assetUrlType('https://127.0.0.1/private') === 'invalid'
      && policy.assetUrlType('http://drive.google.com/file/d/TEST_RESOURCE_123/view') === 'invalid',
  'credential-bearing, private-host, and non-HTTPS artifact URLs fail closed');
  ok(policy.assetTypeAllowed('filming_plan', 'https://docs.google.com/document/d/TEST_DOC/edit')
      && policy.assetTypeAllowed('raw_footage', 'https://drive.google.com/drive/folders/TEST_RAW')
      && policy.assetTypeAllowed('delivery_folder', 'https://app.frame.io/projects/TEST_PROJECT')
      && policy.canonicalArtifactUrl('https://docs.google.com/document/d/TEST_DOC/edit') === null
      && policy.canonicalArtifactUrl('https://drive.google.com/drive/folders/TEST_RAW') === null
      && policy.canonicalArtifactUrl('https://app.frame.io/projects/TEST_PROJECT') === null
      && policy.canonicalArtifactUrl('https://www.dropbox.com/scl/fo/TEST_FOLDER') === null,
  'typed source documents/folders stay visible but can never become the canonical file');

  const providerContext = {
    lower: value => String(value == null ? '' : value).trim().toLowerCase(),
    URL,
  };
  vm.createContext(providerContext);
  const providerStart = edge.indexOf('function providerEvidenceState(');
  const providerEnd = edge.indexOf('\nasync function probeAssetUrl(', providerStart);
  const providerFn = edge.slice(providerStart, providerEnd)
    .replace('rawUrl: string', 'rawUrl')
    .replace('response: Response', 'response')
    .replace('sample: string', 'sample')
    .replace(/\)\s*:\s*"available"\s*\|\s*"permission_denied"\s*\|\s*"unavailable"\s*\{/, ') {');
  vm.runInContext(`${providerFn}; this.providerEvidenceState = providerEvidenceState;`, providerContext);
  const response = (okValue, contentType, disposition = '') => ({
    ok: okValue,
    headers: {
      get(key) {
        return String(key).toLowerCase() === 'content-type' ? contentType
          : String(key).toLowerCase() === 'content-disposition' ? disposition : '';
      },
    },
  });
  ok(providerContext.providerEvidenceState(
    driveStable, response(true, 'text/html'), '<html>Google Drive branded landing</html>',
  ) === 'unavailable'
      && providerContext.providerEvidenceState(
        driveStable, response(true, 'text/html'), '<form>Request access and sign in</form>',
      ) === 'permission_denied'
      && providerContext.providerEvidenceState(
        driveStable, response(true, 'image/png'), '',
      ) === 'available',
  'generic/branded/login HTML never proves availability; only unambiguous media does');
  ok(/range: "bytes=0-8191"/.test(edge)
      && /MAX_ASSET_REDIRECTS/.test(edge)
      && /assetProbeRedirectAllowed/.test(edge)
      && /drive[.]usercontent[.]google[.]com/.test(edge)
      && /dl[.]dropboxusercontent[.]com/.test(edge),
  'asset probes are range-bounded and redirects stay on explicit provider content hosts');

  const attachmentUrl = policy.canonicalArtifactUrl(driveStable);
  const row = {
    operation: 'attachment',
    source_edited_at: '2026-07-23T12:00:00.000Z',
    payload: { url: attachmentUrl, linear_issue_id: 'issue-1', artifact_revision: 1 },
  };
  ok(mapping.decideConflict(row, { id: 'issue-1' }, {
    entity: {
      file_url: attachmentUrl,
      artifact_revision: 1,
      updated_at: '2026-07-23T12:00:00.000Z',
    },
  }).decision === 'apply',
  'the current canonical revision reaches Linear as an additive attachment');
  const exactApplied = mapping.decideConflict(row, {
    id: 'issue-1',
    attachments: {
      nodes: [{
        id: 'attachment-1',
        url: attachmentUrl,
        subtitle: 'SyncView canonical revision 1',
      }],
      pageInfo: { hasNextPage: false },
    },
  }, {
    entity: { file_url: attachmentUrl, artifact_revision: 1 },
  });
  const sameUrlNext = {
    ...row,
    payload: { ...row.payload, artifact_revision: 2 },
  };
  ok(exactApplied.decision === 'already_applied'
      && mapping.decideConflict(sameUrlNext, {
        id: 'issue-1',
        attachments: {
          nodes: [{
            id: 'attachment-1',
            url: attachmentUrl,
            subtitle: 'SyncView canonical revision 1',
          }],
        },
      }, {
        entity: { file_url: attachmentUrl, artifact_revision: 2 },
      }).decision === 'apply',
  'exact attachment replay is suppressed while a new same-URL revision still reaches Linear');
  const stale = mapping.decideConflict(row, { id: 'issue-1' }, {
    entity: {
      file_url: attachmentUrl,
      artifact_revision: 3,
      updated_at: '2026-07-23T12:01:00.000Z',
    },
  });
  ok(stale.decision === 'stale' && stale.reason === 'native_attachment_revision_superseded',
    'an old A revision cannot resurrect after a newer A-B-A native revision');
  const reverseCurrent = {
    ...row,
    payload: { ...row.payload, artifact_revision: 3 },
  };
  ok(mapping.decideConflict(reverseCurrent, {
    id: 'issue-1',
    attachments: {
      nodes: [{
        id: 'attachment-old-a',
        url: attachmentUrl,
        subtitle: 'SyncView canonical revision 1',
      }],
    },
  }, {
    entity: { file_url: attachmentUrl, artifact_revision: 3 },
  }).decision === 'apply',
  'the current A-B-A revision is not suppressed by an older same-URL attachment');
  const mutation = mapping.buildMutation(row, { linear_issue_id: 'issue-1' });
  ok(mutation.kind === 'attachmentCreate'
      && /attachmentCreate/.test(mutation.query)
      && mutation.variables.input.issueId === 'issue-1'
      && mutation.variables.input.url === attachmentUrl
      && mutation.variables.input.subtitle === 'SyncView canonical revision 1'
      && mutation.variables.input.metadata.syncviewArtifactRevision === 1,
  'Linear uses official attachmentCreate with exact URL and server-owned revision marker');
  ok(/clean\(resultMap\.subtitle\) !== expectedSubtitle/.test(outboundEdge)
      && /attachmentCreate receipt mismatch/.test(outboundEdge)
      && /attachment_revision: mutation\.kind === "attachmentCreate"/.test(outboundEdge),
  'Linear success requires exact id, URL, revision subtitle, and persisted revision receipt');

  const publicRowSource = edge.slice(
    edge.indexOf('function publicRow('),
    edge.indexOf('function publicArtifactRow('),
  );
  ok(!/file_url/.test(publicRowSource)
      && /function publicArtifactRow[\s\S]*file_url[\s\S]*artifact_revision/.test(edge)
      && /operation === "attachment"[\s\S]{0,80}publicArtifactRow/.test(edge),
  'ordinary/client-capable rows omit file_url; only staff attachment receipts expose URL plus durable revision');
  const attachmentPreauth = edge.indexOf('if (operation === "attachment") {');
  const attachmentLookup = edge.indexOf(': operation === "attachment"', attachmentPreauth);
  const crossTeamGuard = edge.indexOf('!staffAssetReadAllowed', attachmentLookup);
  const identityGuard = edge.indexOf('await assertDeliverableIdentityWritable', crossTeamGuard);
  ok(attachmentPreauth > 0
      && attachmentPreauth < attachmentLookup
      && attachmentLookup < crossTeamGuard
      && crossTeamGuard < identityGuard
      && /new GatewayError\(403, "asset_scope_forbidden"\)/.test(
        edge.slice(crossTeamGuard, identityGuard),
      )
      && /\.eq\("id", id\)[\s\S]{0,100}\.eq\("client_slug", attachmentClientSlug\)/.test(edge),
  'attachment auth precedes scoped lookup and missing/cross-client/cross-team ids share one 403');
  ok(/if \(!client \|\| client\.active !== true\)[\s\S]{0,80}asset_scope_forbidden/.test(edge)
      && /handleAssetAccessRead[\s\S]*if \(!client \|\| client\.active !== true\)[\s\S]{0,80}asset_scope_forbidden/.test(edge),
  'both guarded attachment writes and protected asset reads require an active roster client');
  ok(/scope\.team === "graphics" && status === "smm_approval"[\s\S]{0,220}artifact_not_resolvable/.test(edge)
      && /operation === "status" && nextStatus === "smm_approval"[\s\S]{0,100}assertGraphicsApprovalArtifact/.test(edge)
      && /for \(const planned of plannedItems\)[\s\S]{0,320}lower\(row\.status\) !== "smm_approval"[\s\S]{0,500}assertGraphicsApprovalArtifact/.test(edge),
  'create, status/reconcile, append intake, and new-batch intake all enforce the Graphics SMM artifact gate');
  const entityStart = edge.indexOf('async function handleEntityOperation(');
  const entityEnd = edge.indexOf('\nasync function handleIntakeCreate(', entityStart);
  const entitySource = edge.slice(entityStart, entityEnd);
  const earlyClientTransition = entitySource.indexOf(
    '&& !clientOperationAllowed(operation, existing.status, nextStatus)',
  );
  const artifactProbe = entitySource.indexOf('await assertGraphicsApprovalArtifact(supabase, existing)');
  const reconcileRoute = entitySource.indexOf('if (body.reconcile_only === true)');
  ok(earlyClientTransition > 0
      && earlyClientTransition < artifactProbe
      && artifactProbe < reconcileRoute,
  'forbidden client status/reconcile requests are rejected before any artifact provider probe');
  const attachmentWriteStart = edge.lastIndexOf('} else if (operation === "attachment") {');
  const attachmentWriteBranch = edge.slice(
    attachmentWriteStart,
    edge.indexOf('\n  } else {', attachmentWriteStart),
  );
  ok(/write_conflict[\s\S]{0,300}row: publicArtifactRow\(current \|\| existing\)/.test(attachmentWriteBranch)
      && /winning link was reloaded; your attempted link is still in the editor/.test(ui)
      && /state\.draft/.test(ui.slice(ui.indexOf('async function _prodSaveAsset'), ui.indexOf('function _prodArchiveDefaultState'))),
  'attachment CAS returns the authorized winning URL while UI retains the attempted draft');

  const operationalUrl = 'https://uploads.linear.app/operational.png';
  const archiveUrl = 'https://uploads.linear.app/archive.png';
  const commentUrl = 'https://uploads.linear.app/comment.png';
  const attachmentArrayUrl = 'https://uploads.linear.app/comment-attachment.png';
  const refs = rescue.discoverArchiveRefs(
    [{
      linear_uuid: 'issue-1',
      client_slug: 'test-client',
      team: 'graphics',
      description: `Archive ${archiveUrl}`,
      raw: { description: `Archive ${archiveUrl}` },
    }],
    [{
      id: 'comment-1',
      linear_issue_uuid: 'issue-1',
      client_slug: 'test-client',
      team: 'graphics',
      audience: 'client',
      body: `Comment ${commentUrl}`,
      attachments: [{ url: attachmentArrayUrl }],
    }],
    [{
      id: 'deliverable-1',
      linear_issue_uuid: 'issue-1',
      client_slug: 'test-client',
      team: 'graphics',
      brief: `Operational ${operationalUrl}`,
    }],
  );
  const kinds = new Set(refs.map(ref => ref.source_kind));
  ok(kinds.has('operational_brief')
      && kinds.has('issue_description')
      && kinds.has('normalized_comment_body')
      && kinds.has('comment_attachment'),
  'rescue discovery scans operational briefs, full archives/descriptions, and both comment shapes');
  ok(rescue.publicPlan(refs).scan_complete === false
      && rescue.publicPlan(refs).reconciliation.zero_gaps === false,
  'archive/comments alone never claim complete or zero-gap discovery');
  ok(rescue.argsFrom(['--client', 'test-client', '--verify-rescued']).get('--client') === 'test-client',
    'rescue arguments preserve paired values and boolean modes');
  let duplicateArgsRejected = false;
  try { rescue.argsFrom(['--client', 'one', '--client', 'two']); } catch (_) { duplicateArgsRejected = true; }
  ok(duplicateArgsRejected, 'duplicate rescue arguments fail closed');

  const repeatedUrl = 'https://uploads.linear.app/repeated.png';
  const repeatedRefs = rescue.discoverArchiveRefs([], [], [{
    id: 'deliverable-repeat',
    linear_issue_uuid: 'issue-repeat',
    client_slug: 'test-client',
    team: 'graphics',
    brief: `First ${repeatedUrl}; second ${repeatedUrl}`,
  }]);
  ok(repeatedRefs.length === 2
      && repeatedRefs[0].original_url_sha256 === repeatedRefs[1].original_url_sha256
      && repeatedRefs[0].location_key !== repeatedRefs[1].location_key
      && repeatedRefs[0].ref_id !== repeatedRefs[1].ref_id,
  'duplicate URLs remain two independently located rescue occurrences');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'f34-inventory-'));
  try {
    const inventoryPath = path.join(temp, 'inventory.json');
    const inventoryKey = 'TEST-owner-seeded-inventory-key';
    const inventoryKeyId = 'test-owner-key-v1';
    const writeInventory = occurrences => {
      const payload = {
        contract: 'syncview_f34_final_linear_inventory_v3',
        complete: true,
        exported_at: '2026-07-23T12:00:00.000Z',
        source: {
          system: 'linear',
          export_id: 'test-linear-export-20260723',
          organization_sha256: '1'.repeat(64),
          generator: 'syncview-independent-linear-export-v1',
          generated_at: '2026-07-23T11:59:00.000Z',
          artifact_sha256: '2'.repeat(64),
        },
        occurrences,
      };
      payload.certification = {
        key_id: inventoryKeyId,
        hmac_sha256: crypto.createHmac('sha256', inventoryKey)
          .update(rescue.inventoryCertificationMaterial(payload, occurrences))
          .digest('hex'),
      };
      const bytes = Buffer.from(JSON.stringify(payload));
      fs.writeFileSync(inventoryPath, bytes);
      return {
        pinnedFileSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        certificationKey: inventoryKey,
        certificationKeyId: inventoryKeyId,
      };
    };
    let inventoryOptions = writeInventory(refs.map(rescue.inventoryOccurrence));
    const exactInventory = rescue.reconcileFinalInventory(inventoryPath, refs, inventoryOptions);
    ok(exactInventory.scan_complete === true
        && exactInventory.missing_from_syncview === 0
        && exactInventory.missing_from_inventory === 0
        && exactInventory.file_sha256 === inventoryOptions.pinnedFileSha256
        && exactInventory.certification_key_id === inventoryKeyId,
    'only a pinned, owner-HMAC-certified independent Linear export can reconcile exactly');

    inventoryOptions = writeInventory(repeatedRefs.slice(0, 1).map(rescue.inventoryOccurrence));
    const mismatch = rescue.reconcileFinalInventory(inventoryPath, repeatedRefs, inventoryOptions);
    ok(mismatch.scan_complete === false
        && mismatch.missing_from_syncview === 0
        && mismatch.missing_from_inventory === 1
        && rescue.publicPlan(repeatedRefs, mismatch).reconciliation.zero_gaps === false,
    'one missing occurrence remains a gap even when its URL hash is still represented');

    const undiscovered = {
      ref_id: `f34:${'f'.repeat(40)}`,
      linear_uuid_sha256: '3'.repeat(64),
      source_kind: 'issue_description',
      location_key_sha256: '4'.repeat(64),
      original_url_sha256: '5'.repeat(64),
    };
    inventoryOptions = writeInventory([
      ...refs.map(rescue.inventoryOccurrence),
      undiscovered,
    ]);
    const exportOnlyGap = rescue.reconcileFinalInventory(inventoryPath, refs, inventoryOptions);
    ok(exportOnlyGap.scan_complete === false
        && exportOnlyGap.missing_from_syncview === 1
        && exportOnlyGap.missing_from_inventory === 0,
    'an independently exported occurrence that SyncView never discovered remains a visible gap');

    let unsignedRejected = false;
    try {
      rescue.reconcileFinalInventory(inventoryPath, refs, {
        ...inventoryOptions,
        certificationKey: 'wrong-owner-key',
      });
    } catch (error) {
      unsignedRejected = error && error.message === 'final_inventory_hmac_mismatch';
    }
    ok(unsignedRejected, 'operator-authored or tampered inventory cannot satisfy owner certification');

    const dispositionPath = path.join(temp, 'dispositions.json');
    fs.writeFileSync(dispositionPath, JSON.stringify({
      contract: 'syncview_f34_owner_dispositions_v1',
      complete: true,
      dispositions: [{
        ref_id: refs[0].ref_id,
        original_url_sha256: refs[0].original_url_sha256,
        confirmed_by: 'test-owner',
        confirmed_at: '2026-07-23T12:00:00.000Z',
        decision: 'unrecoverable_after_review',
        review_note: 'TEST-only explicit disposition.',
      }],
    }));
    const disposition = rescue.loadOwnerDispositionPlan(dispositionPath, refs);
    ok(disposition.length === 1
        && disposition[0].owner_evidence.decision === 'unrecoverable_after_review',
    'unrecoverable refs have an explicit exact-hash owner plan; nothing auto-dispositions');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  ok(rescue.rescuedVerificationStatus(
    { zero_gaps: true },
    [{ ref_id: 'f34:verified', state: 'rescued' }],
    [{ ref_id: 'f34:verified', state: 'verified' }],
  ) === 'VERIFIED'
      && rescue.rescuedVerificationStatus(
        { zero_gaps: false },
        [],
        [],
      ) === 'GAPS'
      && rescue.rescuedVerificationStatus(
        { zero_gaps: true },
        [],
        [],
      ) === 'GAPS'
      && rescue.rescuedVerificationStatus(
        { zero_gaps: true },
        [{ ref_id: 'f34:missing-readback', state: 'rescued' }],
        [],
      ) === 'GAPS'
      && rescue.rescuedVerificationStatus(
        { zero_gaps: true },
        [{ ref_id: 'f34:expected', state: 'rescued' }],
        [{ ref_id: 'f34:wrong', state: 'verified' }],
      ) === 'GAPS',
  'VERIFIED requires zero gaps plus the exact nonempty rescued readback set and final states');

  let tooLargeRejected = false;
  const oversized = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(5));
      controller.enqueue(new Uint8Array(5));
      controller.close();
    },
  }));
  try { await rescue.readBoundedBytes(oversized, 8, 'fixture'); } catch (error) {
    tooLargeRejected = error && error.message === 'fixture_too_large';
  }
  ok(tooLargeRejected
      && rescue.approvedLinearRedirect('https://uploads.linear.app/private/file')
      && rescue.approvedLinearRedirect('https://storage.googleapis.com/private-copy/file')
      && !rescue.approvedLinearRedirect('https://127.0.0.1/private')
      && !rescue.approvedLinearRedirect('http://uploads.linear.app/private/file'),
  'rescue downloads are stream-bounded and redirect only to explicit HTTPS provider storage');
  ok(/createHmac\('sha256', config\.rescueCapability\)/.test(rescueSource)
      && /destination_folder_id: config\.folderId/.test(rescueSource)
      && /independent_private_readback: 'PASS'/.test(rescueSource)
      && /F34_CONFIRM_LINEAR_ASSET_READBACK/.test(rescueSource)
      && /F34_CONFIRM_OWNER_DISPOSITION/.test(rescueSource),
  'rescue terminal receipts bind private destination, byte readback, capability HMAC, and explicit modes');
  ok(/syncview_f34_final_linear_inventory_v3/.test(rescueSource)
      && /syncview-independent-linear-export-v1/.test(rescueSource)
      && /F34_INVENTORY_HMAC_KEY/.test(rescueSource)
      && /F34_FINAL_INVENTORY_SHA256/.test(rescueSource)
      && /rescuedVerificationStatus\(summary, existing, readback\)/.test(rescueSource),
  'final inventory requires independent source metadata, owner HMAC, pinned bytes, and non-vacuous readback reconciliation');

  ok(/completeIssueRefs\(/.test(archiveEdge)
      && /MAX_INTERNAL_REF_ROWS = 2_000/.test(archiveEdge)
      && /rewriteArchiveValue\(archive, completeRefs\)/.test(archiveEdge)
      && /rewriteArchiveValue\(commentRows, completeRefs\)/.test(archiveEdge)
      && /asset_refs: refs\.map\(publicRef\)/.test(archiveEdge),
  'archive content uses one bounded complete replacement map while refs remain independently paged');
  ok(/\[functions[.]production-archive\]\s*verify_jwt = false/.test(supabaseConfig),
    'the browser-callable archive reader has explicit publishable routing and internal staff auth');
  const archiveClientLookup = archiveEdge.indexOf('from("clients")');
  const archiveClientActiveGuard = archiveEdge.indexOf('client.active !== true', archiveClientLookup);
  ok(archiveClientLookup > 0
      && archiveClientActiveGuard > archiveClientLookup
      && archiveClientActiveGuard < archiveEdge.indexOf('if (action === "list")', archiveClientLookup)
      && /return json\(\{ ok: false, error: "forbidden" \}, 403\)/.test(archiveEdge)
      && /certifiedRescuedRef/.test(archiveEdge)
      && /rescued_url: certifiedRescuedRef\(ref\)/.test(archiveEdge),
  'archive normal mode denies unknown/inactive clients and exposes only certified private copies');
  ok(/listRetryAppend/.test(ui)
      && /detailRetryAppend/.test(ui)
      && />Retry<\/button>/.test(ui)
      && /state\.loading \|\| !state\.clientSlug/.test(ui)
      && /state\.detailLoading/.test(ui),
  'archive list/detail failures expose bounded single-request Retry controls');

  const archivePending = [];
  const archiveContext = {
    _prodState: {
      archiveRepair: {
        clientSlug: 'test-client',
        team: 'graphics',
        audience: 'internal',
        issues: [],
        hasMore: false,
        cursor: '',
        loading: false,
        error: '',
        listRetryAppend: false,
        selectedId: '',
        detail: null,
        detailLoading: false,
        detailError: '',
        detailRetryAppend: false,
        scopeGeneration: 1,
        listRequestToken: 0,
        detailRequestToken: 0,
      },
    },
    _prodRenderArchiveRepair() {},
    _prodArchiveErrorText() { return 'failed'; },
    _prodArchiveRequest(body) {
      return new Promise((resolve, reject) => archivePending.push({
        body: JSON.parse(JSON.stringify(body)), resolve, reject, settled: false,
      }));
    },
  };
  vm.createContext(archiveContext);
  vm.runInContext([
    extractFunction(ui, '_prodArchiveScopeSignature'),
    extractFunction(ui, '_prodArchiveScopeChange'),
    extractFunction(ui, '_prodArchiveLoadList'),
    extractFunction(ui, '_prodArchiveOpenIssue'),
    'this.scopeChange = _prodArchiveScopeChange;',
    'this.loadList = _prodArchiveLoadList;',
    'this.openIssue = _prodArchiveOpenIssue;',
  ].join('\n'), archiveContext);
  const resolveArchive = (predicate, payload) => {
    const request = archivePending.find(item => !item.settled && predicate(item.body));
    if (!request) throw new Error('missing archive request');
    request.settled = true;
    request.resolve(payload);
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));

  const oldList = archiveContext.loadList(false);
  archiveContext.scopeChange('team', 'video');
  resolveArchive(
    body => body.action === 'list' && body.team === 'video',
    { ok: true, issues: [{ linear_uuid: 'video-row' }], has_more: false },
  );
  await settle();
  resolveArchive(
    body => body.action === 'list' && body.team === 'graphics',
    { ok: true, issues: [{ linear_uuid: 'stale-graphics-row' }], has_more: false },
  );
  await oldList;
  ok(archiveContext._prodState.archiveRepair.team === 'video'
      && archiveContext._prodState.archiveRepair.issues.length === 1
      && archiveContext._prodState.archiveRepair.issues[0].linear_uuid === 'video-row'
      && archiveContext._prodState.archiveRepair.loading === false,
  'an in-flight archive list cannot overwrite or clear the newer scope load');

  const oldDetail = archiveContext.openIssue('issue-a', false);
  const newDetail = archiveContext.openIssue('issue-b', false);
  resolveArchive(
    body => body.action === 'issue' && body.linear_uuid === 'issue-b',
    { ok: true, issue: { linear_uuid: 'issue-b' }, comments: [], asset_refs: [] },
  );
  await newDetail;
  resolveArchive(
    body => body.action === 'issue' && body.linear_uuid === 'issue-a',
    { ok: true, issue: { linear_uuid: 'issue-a' }, comments: [], asset_refs: [] },
  );
  await oldDetail;
  ok(archiveContext._prodState.archiveRepair.selectedId === 'issue-b'
      && archiveContext._prodState.archiveRepair.detail.issue.linear_uuid === 'issue-b'
      && archiveContext._prodState.archiveRepair.detailLoading === false,
  'a newer archive detail selection supersedes an older in-flight response');

  const assetCalls = [];
  const assetContext = {
    URL,
    PROD_ASSET_SPECS: null,
    _prodState: { assets: new Map() },
    _prodIssue() {
      return { id: 'asset-row', team: 'graphics', assets: {}, updatedRaw: '2026-07-23T00:00:00Z' };
    },
    _prodRefreshAssetSurfaces() {},
    _prodWriteRequestId() { return 'attachment-request-1'; },
    async _prodGatewayWrite(issue, operation, fields, requestId, sourceEditedAt) {
      assetCalls.push({ issue, operation, fields, requestId, sourceEditedAt });
      throw new Error('ambiguous-network-failure');
    },
    _prodWriteErrorText() { return 'Retry the same intent.'; },
    _prodToast() {},
    async _prodEnsureAssets() {},
  };
  vm.createContext(assetContext);
  const assetSpecsStart = ui.indexOf('const PROD_ASSET_SPECS = Object.freeze([');
  const assetSpecsEnd = ui.indexOf('\n        const PROD_GROUP_KEYS', assetSpecsStart);
  vm.runInContext([
    ui.slice(assetSpecsStart, assetSpecsEnd),
    extractFunction(ui, '_prodAssetDefaultEvidence'),
    extractFunction(ui, '_prodAssetState'),
    extractFunction(ui, '_prodAssetDraftInput'),
    extractFunction(ui, '_prodSaveAsset'),
    'this.assetState = _prodAssetState;',
    'this.assetInput = _prodAssetDraftInput;',
    'this.saveAsset = _prodSaveAsset;',
  ].join('\n'), assetContext);
  assetContext.assetInput('asset-row', driveStable);
  await assetContext.saveAsset(null, 'asset-row');
  const firstIntent = {
    requestId: assetContext.assetState('asset-row').requestId,
    sourceEditedAt: assetContext.assetState('asset-row').sourceEditedAt,
  };
  await assetContext.saveAsset(null, 'asset-row');
  ok(assetCalls.length === 2
      && firstIntent.requestId
      && firstIntent.sourceEditedAt
      && assetCalls[0].requestId === assetCalls[1].requestId
      && assetCalls[0].sourceEditedAt === assetCalls[1].sourceEditedAt
      && assetCalls[1].requestId === firstIntent.requestId
      && assetCalls[1].sourceEditedAt === firstIntent.sourceEditedAt,
  'ambiguous attachment retry reuses both request_id and source_edited_at');
  assetContext.assetInput('asset-row', dropboxStable);
  ok(assetContext.assetState('asset-row').requestId === ''
      && assetContext.assetState('asset-row').sourceEditedAt === '',
  'changing the attachment draft starts a fresh idempotency identity and source clock');

  let resolveHeldAssetRead;
  let scopedIssue = {
    id: 'scope-row',
    team: 'graphics',
    authorityProject: 'test-client-a',
    storedClientSlug: 'test-client-a',
    assets: {},
  };
  const scopedAssetContext = {
    URL,
    PROD_WRITE_EF_URL: 'https://example.test/functions/v1/production-write',
    CAL_SUPABASE_ANON_KEY: 'test-anon',
    _syncviewStaffVerificationEpoch: 7,
    _prodState: {
      assets: new Map(),
      assetRequestTokens: new Map(),
      descriptions: new Map(),
      descriptionRequestTokens: new Map(),
      linearRaw: new Map(),
      writes: new Map(),
      projectionGeneration: 1,
    },
    _prodIssue() { return scopedIssue; },
    _prodWriteTeam(value) { return String(value || '').trim().toLowerCase(); },
    _prodRefreshAssetSurfaces() {},
    _syncviewStaffIdentityForHeaders() {
      return { key: 'staff-a', role: 'creative', team: 'graphics' };
    },
    _syncviewStaffIdentitySignature(value) { return JSON.stringify(value || null); },
    _syncviewEfHeaders(value) { return value; },
    fetch() {
      return new Promise(resolve => { resolveHeldAssetRead = resolve; });
    },
  };
  vm.createContext(scopedAssetContext);
  vm.runInContext([
    ui.slice(assetSpecsStart, assetSpecsEnd),
    extractFunction(ui, '_prodAssetDefaultEvidence'),
    extractFunction(ui, '_prodAssetState'),
    extractFunction(ui, '_prodNextAssetRequestToken'),
    extractFunction(ui, '_prodAssetReadErrorText'),
    extractFunction(ui, '_prodEnsureAssets'),
    extractFunction(ui, '_prodInvalidateScopedReads'),
    'this.ensureAssets = _prodEnsureAssets;',
    'this.invalidateScopedReads = _prodInvalidateScopedReads;',
  ].join('\n'), scopedAssetContext);
  const heldAssetRead = scopedAssetContext.ensureAssets('scope-row', true);
  await settle();
  scopedAssetContext.invalidateScopedReads();
  scopedIssue = {
    ...scopedIssue,
    team: 'video',
    authorityProject: 'test-client-b',
    storedClientSlug: 'test-client-b',
  };
  scopedAssetContext._prodState.projectionGeneration += 1;
  resolveHeldAssetRead({
    ok: true,
    status: 200,
    async json() {
      return {
        ok: true,
        complete: true,
        id: 'scope-row',
        client_slug: 'test-client-a',
        team: 'graphics',
        assets: [{
          slot: 'deliverable_file',
          url: driveStable,
          state: 'available',
        }],
      };
    },
  });
  await heldAssetRead;
  ok(!scopedAssetContext._prodState.assets.has('scope-row'),
    'a held protected asset response cannot repopulate after refresh changes row client/team scope');

  ok(/Filming plan/.test(ui)
      && /Raw footage/.test(ui)
      && /Delivery \/ Frame folder/.test(ui)
      && /Canonical deliverable/.test(ui)
      && /missing:'Missing'|missing: 'Missing'/.test(ui)
      && /permission_denied: 'Permission denied'/.test(ui),
  'Production renders four independent typed assets and explicit access states');
  const assetDefaultStart = ui.indexOf('function _prodAssetDefaultEvidence(');
  const assetDefaultEnd = ui.indexOf('\n        function _prodAssetState(', assetDefaultStart);
  const assetMatrixContext = { URL };
  vm.createContext(assetMatrixContext);
  vm.runInContext(
    `${ui.slice(assetSpecsStart, assetSpecsEnd)}
${ui.slice(assetDefaultStart, assetDefaultEnd)}
this.assetSpecs = PROD_ASSET_SPECS;
this.normalizeAssets = _prodAssetDefaultEvidence;`,
    assetMatrixContext,
  );
  const expectedAssetLabels = [
    'Filming plan',
    'Raw footage',
    'Delivery / Frame folder',
    'Deliverable file',
  ];
  let assetMatrixPass = assetMatrixContext.assetSpecs.length === 4
    && assetMatrixContext.assetSpecs.every((spec, index) => spec.label === expectedAssetLabels[index]);
  for (let mask = 0; mask < 16; mask += 1) {
    const supplied = {};
    assetMatrixContext.assetSpecs.forEach((spec, index) => {
      if (mask & (1 << index)) supplied[spec.key] = `https://files.example.test/${spec.key}-${mask}`;
    });
    const normalized = assetMatrixContext.normalizeAssets({ assets: supplied });
    assetMatrixPass = assetMatrixPass
      && Object.keys(normalized).join(',') === assetMatrixContext.assetSpecs.map(spec => spec.key).join(',')
      && assetMatrixContext.assetSpecs.every((spec, index) => {
        const expectedUrl = supplied[spec.key] || '';
        const row = normalized[spec.key];
        return row
          && row.slot === spec.key
          && row.url === expectedUrl
          && row.state === (mask & (1 << index) ? 'checking' : 'missing');
      });
  }
  ok(assetMatrixPass,
    'all 16 asset-presence combinations preserve four independent labeled slots without substitution');
  const assetsPanelSource = extractFunction(ui, '_prodAssetsPanelHTML');
  const loadDataStart = ui.indexOf('async function _prodLoadData(');
  const loadDataEnd = ui.indexOf('\n        async function _prodLoadLinearRawFor(', loadDataStart);
  const loadDataSource = ui.slice(loadDataStart, loadDataEnd);
  ok(!/Select existing:|_prodChooseAssetCandidate|prod-assets-candidate/.test(assetsPanelSource)
      && !/_prodChooseAssetCandidate/.test(ui),
  'source documents and folders are never offered as canonical selection candidates');
  ok(!/filming_doc_url|footage_folder_url|delivery_folder_url|due_date,file_url/.test(loadDataSource)
      && /return \{ \.\.\.evidence, url: clean\(values\[slot\.key\]\) \|\| null \}/.test(edge)
      && /url: String\(asset\.url \|\| ''\)\.trim\(\)/.test(ui)
      && /state\.assets && state\.assets\.deliverable_file[\s\S]{0,100}state\.assets\.deliverable_file\.url/.test(
        extractFunction(ui, '_prodBeginAssetEdit'),
      ),
  'typed asset URLs leave anonymous bootstrap and reach display/edit only through the guarded read');
  const projectionLoader = extractFunction(ui, '_prodLoadDeliverableProjection');
  const descriptionLoader = extractFunction(ui, '_prodEnsureDescription');
  const refreshSource = extractFunction(ui, '_prodRefresh');
  ok(/production_deliverables_browser_v1/.test(projectionLoader)
      && /if \(!_prodBrowserProjectionMissing\(error\)\) throw error/.test(projectionLoader)
      && /PGRST205/.test(extractFunction(ui, '_prodBrowserProjectionMissing'))
      && /production_deliverables_browser_v1/.test(
        extractFunction(ui, 'wlFetchNativeMetadata'),
      )
      && /action: 'description_read'/.test(descriptionLoader)
      && !/_prodRestRows\('deliverables'/.test(descriptionLoader)
      && /_prodInvalidateScopedReads\(\)/.test(refreshSource)
      && /projectionGeneration === _prodState\.projectionGeneration/.test(
        extractFunction(ui, '_prodEnsureAssets'),
      ),
  'safe-view rollout falls back only for explicit pre-migration absence and protected reads are synchronously generation-quarantined');
  ok(/async function handleDescriptionRead/.test(edge)
      && /description_scope_forbidden/.test(edge)
      && /if \(lower\(body\.action\) === "description_read"\)/.test(edge)
      && /row: publicDescriptionRow\(existing\)/.test(edge),
  'description bodies are returned only by the active-roster, role/team-scoped no-store gateway read');

  ok(/DELIBERATE ADDITIVE-ONLY EXCEPTION \(owner-approved\)/.test(migration)
      && /'create', 'status', 'comment', 'due', 'assignee', 'title',[\s\S]*'priority', 'parent', 'archive', 'restore', 'labels', 'description',[\s\S]*'attachment'/.test(migration)
      && /drop constraint if exists mirror_outbox_operation_b4_check/.test(migration)
      && /begin;[\s\S]*drop constraint[\s\S]*add constraint[\s\S]*commit;/i.test(migration),
  'migration documents and installs the exact transactional 12-to-13 CHECK superset');
  ok(/production_artifact_write/.test(migration)
      && /production_deliverable_write\(v_row, v_event\)/.test(migration)
      && /artifact_revision = v_next_revision/.test(migration)
      && /'artifact-' \|\| v_next_revision::text/.test(migration)
      && /production_outbox_replay\(/.test(migration)
      && !/thumbnail_url is distinct from v_result\.file_url/.test(migration)
      && /graphic_deliverable_id = v_result\.id/.test(migration)
      && /v_result\.origin <> 'manual'/.test(migration)
      && /production artifact active client required/.test(migration),
  'artifact RPC revision-orders every new intent, suppresses exact replay, projects same-URL cards, preserves manual isolation, and requires active client');
  const artifactRpcStart = migration.indexOf('create or replace function public.production_artifact_write');
  const artifactLockAt = migration.indexOf("'production-artifact:' || v_id", artifactRpcStart);
  const deliverableLockAt = migration.indexOf("'production-deliverable:' || v_id", artifactLockAt);
  const artifactRowLockAt = migration.indexOf('for update;', deliverableLockAt);
  ok(artifactLockAt > artifactRpcStart
      && deliverableLockAt > artifactLockAt
      && artifactRowLockAt > deliverableLockAt
      && /if \(replay\) \{[\s\S]{0,900}\.eq\("client_slug", attachmentClientSlug\)[\s\S]{0,260}result = replayCurrent as JsonMap/.test(attachmentWriteBranch),
  'artifact writes match scalar advisory-before-row lock order and replay re-reads the post-winner scoped row');
  ok(/revoke select on table public\.batches from public, anon, authenticated/.test(migration)
      && /grant select \([\s\S]*linear_parent_ids[\s\S]*\) on table public\.batches to anon, authenticated/.test(migration)
      && /revoke select on table public\.deliverables from public, anon, authenticated/.test(migration)
      && /production_deliverables_browser_v1/.test(migration)
      && /production_workload_label_projection/.test(migration)
      && !/grant select \([\s\S]{0,900}\bbrief\b[\s\S]{0,200}\) on table public\.deliverables/.test(migration)
      && !/grant select \([\s\S]{0,900}\blinear_raw\b[\s\S]{0,200}\) on table public\.deliverables/.test(migration)
      && !/grant select \([\s\S]{0,500}filming_doc_url/.test(migration)
      && /f53_typed_asset_column_still_public/.test(proof)
      && /f53_non_asset_browser_read_not_preserved/.test(proof)
      && /f34_legacy_brief_direct_read_unexpectedly_succeeded/.test(proof)
      && /f34_legacy_raw_direct_read_unexpectedly_succeeded/.test(proof)
      && /f34_safe_projection_leaked_legacy_url/.test(proof)
      && /f53_service_asset_read_not_preserved/.test(proof),
  'typed assets and legacy bodies lose browser grants while a derived URL-free view and service reads are DB-proven');
  ok(/linear_archive_asset_rescue_config/.test(migration)
      && /revoke all on table public\.linear_archive_asset_rescue_config[\s\S]*service_role/.test(migration)
      && /revoke insert, update, delete, truncate on table public\.linear_archive_asset_refs[\s\S]*service_role/.test(migration)
      && /extensions\.hmac/.test(migration)
      && /destination_folder_id is distinct from v_config\.approved_folder_id/.test(migration)
      && /verification_receipt_hmac/.test(migration)
      && /content_sha256/.test(migration)
      && /byte_length/.test(migration),
  'generic service callers cannot certify arbitrary Drive files; terminal rescue is capability, folder, object, hash, byte, and timestamp bound');
  ok(/operational_brief/.test(migration)
      && /position\(v_original_url in coalesce\(v_deliverable\.brief/.test(migration)
      && /archive_asset_source_mismatch/.test(migration)
      && /archive_asset_write_conflict/.test(migration)
      && /archive_asset_terminal/.test(migration),
  'rescue RPC source-binds operational/archive/comment refs and enforces CAS plus terminal immutability');
  ok(/'labels', 'description', 'attachment'/.test(f27Migration),
    'parked F27 enqueue retains labels, description, and attachment additively');
  ok(/\\ir \.\.\/migrations\/2026-07-23-f34-f53-production-attachments\.sql/.test(proof)
      && /f53_operation_superset_not_exact/.test(proof)
      && /f53_typed_asset_table_grant_not_revoked/.test(proof)
      && /f53_same_url_revision_not_projected/.test(proof)
      && /f53_same_url_exact_replay_bumped_revision/.test(proof)
      && /f53_projection_or_manual_scope_not_exact/.test(proof)
      && /f53_mislinked_projection_not_atomic/.test(proof)
      && /f34_uncertified_rescue_unexpectedly_succeeded/.test(proof)
      && /f34_certified_rescue_not_exact/.test(proof)
      && /f34_f53_attachment_and_rescue_exact/.test(proof)
      && /migrations\/2026-07-23-f34-f53-production-attachments\.sql/.test(workflow),
  'the PostgreSQL 16 proof covers the superset, same-URL revision/replay, projection rollback, safe browser boundary, and private rescue certification');
  ok(!/public[.](?:calendar_upsert|sample_review_upsert)|rpc\/(?:calendar-upsert|sample-review-upsert)/i.test(migration)
      && !/calendar-upsert|sample-review-upsert/i.test(rescueSource)
      && !/n8n|runtime_flags|prod_authority/i.test(rescueSource),
  'this slice does not change frozen writers, n8n, runtime flags, or authority');

  if (failures) process.exit(1);
  console.log('Production attachment/archive focused contract passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
