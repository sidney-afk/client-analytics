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
    extractFunction('_prodCanonicalCommentGate'),
    extractFunction('_sxrPostLinearComment'),
    extractFunction('_writeUiCardCommentLifecycle'),
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
