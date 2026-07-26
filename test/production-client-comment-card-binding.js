'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const writer = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/production-write/index.ts'),
  'utf8',
);
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function extractFunction(name) {
  const marker = `function ${name}`;
  let start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
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
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${name}`);
}

function extractBlock(text, start) {
  const brace = text.indexOf('{', start);
  if (brace < 0) throw new Error('missing block');
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = brace; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  throw new Error('unclosed block');
}

(async () => {
  const policy = await import(pathToFileURL(path.join(
    ROOT,
    'supabase/functions/production-write/policy.mjs',
  )).href + '?client-card-binding');

  const captured = [];
  const browser = {
    _isClientLink: true,
    _syncviewClientEntryCapability: {
      verified: true,
      view: 'sample-reviews',
      slug: 'test-client',
    },
    _syncviewClientEntryDataRun: {},
    _syncviewClientEntryRunCurrent: () => true,
    sxrState: { client: 'test-client' },
    sxrClientSlug: value => String(value || ''),
    _writeUiNativeId(post, component) {
      return String(component === 'graphic'
        ? post && post.graphic_deliverable_id
        : post && post.video_deliverable_id || '');
    },
    _writeUiGatewayError(status, code) {
      const error = new Error(code);
      error.status = status;
      error.code = code;
      return error;
    },
    _writeUiTeam: component => component === 'graphic' ? 'graphics' : 'video',
    _writeUiIntentId: (surface, operation, parts) =>
      [surface, operation].concat(parts || []).join(':'),
    _writeUiGatewayWithRepair: async intent => {
      captured.push(intent);
      return { ok: true };
    },
    _writeUiUseGatewayWhenReady: async () => true,
    _sxrLegacyPostLinearComment() {},
    _writeUiClassifyTargetless: async () => ({ skipped: true }),
    _writeUiBuildSourceRepair: () => null,
  };
  vm.createContext(browser);
  vm.runInContext([
    extractFunction('_prodCardClientCommentSurfaceKnown'),
    extractFunction('_prodVerifiedClientCommentSurfaceContext'),
    extractFunction('_prodVerifiedClientCommentMutationContext'),
    extractFunction('_prodClientCommentSurfaceKey'),
    extractFunction('_prodCrosswalkKey'),
    extractFunction('_prodCrosswalkVerdict'),
    extractFunction('_prodCanonicalCommentGate'),
    extractFunction('_sxrPostLinearComment'),
    extractFunction('_writeUiCardCommentLifecycle'),
    extractFunction('_sxrCommentsFor'),
    extractFunction('_sxrCanonicalCommentsFor'),
    extractFunction('_sxrMsgAudience'),
    extractFunction('_sxrCommentsForAction'),
    extractFunction('_sxrCommentsForView'),
  ].join('\n'), browser);

  const verifiedSurface = Object.freeze({
    source_surface: 'sxr',
    card_id: 'verified-card',
    component: 'video',
  });
  const post = {
    id: 'verified-card',
    client_slug: 'test-client',
    video_deliverable_id: 'deliverable-video',
    // A deliverable id alone no longer counts as linked: the gate requires a
    // resolved, crosswalk-VALID verdict. These fixtures stamp one so each
    // assertion below keeps testing what it was written to test (read
    // readiness and exact client binding), not crosswalk resolution.
    // Keyed component|deliverableId so one id in two slots cannot cross-validate.
    _canonicalCrosswalk: { 'video|deliverable-video': { state: 'valid', fields: [] } },
    _canonicalCommentReads: {
      'deliverable-video': {
        status: 'ready',
        client: true,
        clientSurface: verifiedSurface,
      },
    },
  };
  const mutationContext = browser._prodVerifiedClientCommentMutationContext(
    'sxr', post, 'video', 'deliverable-video',
  );
  const mismatchedPost = {
    ...post,
    _canonicalCommentReads: {
      'deliverable-video': {
        status: 'ready',
        client: true,
        clientSurface: { ...verifiedSurface, card_id: 'other-card' },
      },
    },
  };
  ok(mutationContext === verifiedSurface
    && browser._prodVerifiedClientCommentMutationContext(
      'sxr', mismatchedPost, 'video', 'deliverable-video',
    ) === null,
  'browser mutation context reuses only the exact verified canonical-read card binding');

  await browser._sxrPostLinearComment('', 'Root note', 'Client', {
    post,
    component: 'video',
    comment: { id: 'root-note', created_at: '2026-07-24T00:00:00Z' },
    audience: 'client',
  });
  await browser._sxrPostLinearComment('', 'Reply note', 'Client', {
    post,
    component: 'video',
    comment: { id: 'reply-note', created_at: '2026-07-24T00:01:00Z' },
    parentId: 'root-note',
    audience: 'client',
  });

  const lifecycleComment = {
    id: 'root-note',
    body: 'Root note',
    version: 2,
    canonical_updated_at: '2026-07-24T00:02:00Z',
  };
  for (const action of ['edit', 'delete', 'resolve', 'unresolve']) {
    await browser._writeUiCardCommentLifecycle(
      'sxr',
      post,
      'video',
      lifecycleComment,
      action,
      action === 'edit' ? 'Edited note' : undefined,
    );
  }
  ok(captured.length === 6
    && captured.every(intent => intent.comment.card_id === 'verified-card')
    && captured[0].comment.parent_id === ''
    && captured[1].comment.parent_id === 'root-note'
    && JSON.stringify(captured.slice(2).map(intent => intent.comment.action))
      === JSON.stringify(['edit', 'delete', 'resolve', 'unresolve']),
  'client add, reply, edit, delete, resolve and reopen payloads carry the verified card_id');

  const addGuardMarker = writer.indexOf('// A client add is bound to the exact SXR card/component/deliverable');
  const addGuardStart = writer.indexOf('if (principal.kind === "client"', addGuardMarker);
  const addGuard = extractBlock(writer, addGuardStart);
  const gateway = {
    clientCommentTargetAllowed: policy.clientCommentTargetAllowed,
    GatewayError: class GatewayError extends Error {
      constructor(status, code) {
        super(code);
        this.status = status;
        this.code = code;
      }
    },
  };
  vm.createContext(gateway);
  vm.runInContext(`
    function gatewayClientAddGuard(principal, surface, existing, commentInput, requestedCardId) {
      ${addGuard}
      return { ok: true };
    }
  `, gateway);
  const principal = { kind: 'client' };
  const existing = {
    origin: 'samples',
    card_id: 'verified-card',
    team: 'video',
  };
  const accepted = gateway.gatewayClientAddGuard(
    principal, 'sxr', existing, { component: 'video' }, 'verified-card',
  );
  let rejected = null;
  try {
    gateway.gatewayClientAddGuard(
      principal, 'sxr', existing, { component: 'video' }, 'other-card',
    );
  } catch (error) {
    rejected = error;
  }
  ok(accepted && accepted.ok === true
    && rejected
    && rejected.status === 403
    && rejected.code === 'comment_forbidden',
  'gateway admits the correctly bound client mutation and still fails a mismatched card closed');

  // ---- Canonical-where-linked, legacy-where-not (client outage fix) ---------
  // 6,032 of 6,681 Samples comments have no deliverable binding (only 3 of
  // 1,722 sxr cards are linked), so F42 structurally cannot cover them. On an
  // UNLINKED card the client surface falls back to the pre-Slice-4 legacy card
  // arrays; on a LINKED card the reviewed canonical contract is unchanged and
  // still never falls back.
  const legacyThread = [
    { id: 'legacy-root', role: 'client', audience: 'client', body: 'Client root', created_at: '2026-07-24T00:00:00Z' },
    { id: 'legacy-reply', parent_id: 'legacy-root', role: 'smm', body: 'SMM reply', created_at: '2026-07-24T00:01:00Z' },
    { id: 'internal-root', role: 'smm', audience: 'internal', body: 'Internal only', created_at: '2026-07-24T00:02:00Z' },
    { id: 'internal-reply', parent_id: 'internal-root', role: 'client', body: 'Reply under internal', created_at: '2026-07-24T00:03:00Z' },
    { id: 'kasper-row', role: 'kasper', audience: 'client', body: 'Kasper note', created_at: '2026-07-24T00:04:00Z' },
    { id: 'deleted-row', role: 'client', audience: 'client', deleted: true, body: 'Gone', created_at: '2026-07-24T00:05:00Z' },
    { id: 'hidden-row', role: 'client', audience: 'client', hidden: true, body: 'Hidden', created_at: '2026-07-24T00:06:00Z' },
  ];

  const unlinkedPost = { id: 'unlinked-card', client_slug: 'test-client', video_comments: legacyThread };
  const unlinkedGate = browser._prodCanonicalCommentGate(unlinkedPost, 'video');
  const unlinkedView = browser._sxrCommentsForView(unlinkedPost, 'video');
  ok(unlinkedGate.linked === false && unlinkedGate.status === 'unlinked'
    && JSON.stringify(unlinkedView.map(row => row.id)) === JSON.stringify(['legacy-root', 'legacy-reply']),
  'an UNLINKED card renders the legacy client thread (root audience inherited by replies)');
  ok(!unlinkedView.some(row => row.role === 'kasper')
    && !unlinkedView.some(row => row.id === 'internal-root' || row.id === 'internal-reply')
    && !unlinkedView.some(row => row.id === 'deleted-row' || row.id === 'hidden-row'),
  'the unlinked legacy view still hides internal threads, Kasper authorship, tombstones and hidden rows');
  ok(browser._sxrCommentsForAction(unlinkedPost, 'video') === unlinkedPost.video_comments,
    'unlinked client actions operate on the legacy card array');

  // A LINKED card is unchanged: canonical only, and it never falls back to the
  // legacy arrays even when those arrays are populated and the read is not ready.
  const linkedReadyPost = {
    ...post,
    video_comments: legacyThread,
    _canonicalCommentsByComponent: {
      video: [
        { id: 'canon-client', canonical: true, audience: 'client', body: 'Canonical client', created_at: '2026-07-24T01:00:00Z' },
        { id: 'canon-internal', canonical: true, audience: 'internal', body: 'Canonical internal', created_at: '2026-07-24T01:01:00Z' },
      ],
    },
  };
  const linkedReadyGate = browser._prodCanonicalCommentGate(linkedReadyPost, 'video');
  const linkedReadyView = browser._sxrCommentsForView(linkedReadyPost, 'video');
  ok(linkedReadyGate.linked === true && linkedReadyGate.ready === true && linkedReadyGate.client === true
    && JSON.stringify(linkedReadyView.map(row => row.id)) === JSON.stringify(['canon-client']),
  'a LINKED card renders only canonical client rows, never the populated legacy array');

  const linkedLoadingPost = {
    ...linkedReadyPost,
    _canonicalCommentReads: { 'deliverable-video': { status: 'loading', client: false, clientSurface: verifiedSurface } },
  };
  const linkedMismatchedPost = {
    ...linkedReadyPost,
    _canonicalCommentReads: {
      'deliverable-video': { status: 'ready', client: true, clientSurface: { ...verifiedSurface, card_id: 'other-card' } },
    },
  };
  ok(browser._prodCanonicalCommentGate(linkedLoadingPost, 'video').linked === true
    && browser._sxrCommentsForView(linkedLoadingPost, 'video').length === 0
    && browser._sxrCommentsForView(linkedMismatchedPost, 'video').length === 0,
  'a LINKED card whose canonical read is unready or card-mismatched renders nothing and still never falls back');

  const addSource = extractFunction('_sxrPostLinearComment');
  const lifecycleSource = extractFunction('_writeUiCardCommentLifecycle');
  ok(/card_id:\s*clientSurface\.card_id/.test(addSource)
    && /card_id:\s*clientSurface\.card_id/.test(lifecycleSource)
    && /body\.card_id \|\| commentInput\.card_id/.test(writer),
  'the browser card binding reaches the exact gateway field consumed by the server guard');

  if (failures) {
    console.error(`\n${failures} client comment card-binding check(s) failed`);
    process.exit(1);
  }
  console.log('\nClient comment card-binding checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
