'use strict';

/*
 * Canonical projection — INVOKED, not regex-matched.
 *
 * Every assertion here drives the real `_prodProjectCanonicalCardComments`
 * against a sandboxed app state and then inspects what it did to the card. The
 * earlier suite proved the helper functions in isolation and pattern-matched
 * the wiring; that is exactly how a circular call (G4) survived review — the
 * source contained the check, and the check could never fire.
 *
 * Covers the four defects found in merged main d3e9349:
 *   G1 set-vs-multiset containment dropping duplicate legacy rows
 *   G2 case/whitespace-folded provenance key equating different content
 *   G3 provenance key injective only by assumption
 *   G4 the client-SXR hold reading through the gate it was meant to pre-empt
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function extractFunction(name, from) {
  const marker = `function ${name}`;
  let start = (from || source).indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  const text = from || source;
  if (text.slice(start - 6, start) === 'async ') start -= 6;
  const brace = text.indexOf('{', start);
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
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  throw new Error(`unclosed ${name}`);
}

const CAL_COMPONENTS = ['video', 'graphic', 'caption', 'title'];
const SXR_COMPONENTS = ['video', 'graphic'];

/* Builds a sandbox running the REAL projection plus the real helpers it calls.
   Only the network read and the render hooks are stubbed. */
function makeApp(options) {
  const opts = options || {};
  const env = {
    console,
    SXR_COMPONENTS,
    PROD_CROSSWALK_SURFACE_ORIGIN: { calendar: 'calendar', sxr: 'samples' },
    PROD_CROSSWALK_SELECT: 'id,client_slug,team,origin,card_id',
    PROD_EPHEMERAL_CANONICAL_KEYS: Object.freeze(['_canonicalCrosswalk', '_canonicalCommentReads']),
    CAL_SUPABASE_URL: 'https://db.test',
    CAL_SUPABASE_ANON_KEY: 'anon',
    _isClientLink: !!opts.clientLink,
    calState: { posts: [] },
    sxrState: { posts: [], client: 'acme-co' },
    _calOpenCommentsPid: null,
    _sxrOpenCommentsPid: null,
    _calRenderCommentsModal() {},
    _sxrRenderCommentsModal() {},
    _calComponentsFor: () => CAL_COMPONENTS,
    _calStringifyComments: list => JSON.stringify(list || []),
    _sxrStringifyComments: list => JSON.stringify(list || []),
    _prodCanonicalCardComment: row => row,
    _prodClientCommentSurfaceKey: value => (value ? JSON.stringify(value) : ''),
    _prodCardClientCommentSurfaceKnown: () => true,
    _prodVerifiedClientCommentSurfaceContext: (surface, post, component, deliverableId) => ({
      source_surface: surface, card_id: post && post.id, component, deliverable_id: deliverableId,
    }),
    // The canonical read. Tests supply the thread per deliverable id.
    _prodComments: {
      readCanonical: async (deliverableId) => {
        const thread = (opts.threads || {})[deliverableId];
        if (!thread) return { status: 'error' };
        return Object.assign({ status: 'ready', clientSurfaceVerified: true }, thread);
      },
    },
    // The crosswalk lookup. Tests supply deliverable rows.
    fetch: async () => ({ ok: true, json: async () => opts.deliverables || [] }),
  };
  // The canonical read must echo the surface context back for client binding.
  const origRead = env._prodComments.readCanonical;
  env._prodComments.readCanonical = async (deliverableId, readOpts) => {
    const thread = await origRead(deliverableId);
    if (thread.status === 'ready' && thread.clientSurface === undefined) {
      thread.clientSurface = readOpts && readOpts.clientSurface;
    }
    return thread;
  };

  vm.createContext(env);
  vm.runInContext([
    extractFunction('_writeUiNativeId'),
    extractFunction('_prodCrosswalkTeamForComponent'),
    extractFunction('_prodCrosswalkCardSlug'),
    extractFunction('_prodCrosswalkMismatchFields'),
    extractFunction('_prodCrosswalkKey'),
    extractFunction('_prodCrosswalkVerdict'),
    extractFunction('_prodCrosswalkSetVerdict'),
    extractFunction('_prodCommentProvenanceKey'),
    extractFunction('_prodCanonicalCoversLegacy'),
    extractFunction('_prodFetchCrosswalkRows'),
    extractFunction('_prodCardBindingToken'),
    extractFunction('_prodResolveCardCrosswalk'),
    extractFunction('_prodCanonicalCommentGate'),
    extractFunction('_calCommentsFor'),
    extractFunction('_calSetCommentsFor'),
    extractFunction('_sxrCommentsFor'),
    extractFunction('_sxrSetCommentsFor'),
    extractFunction('_sxrCanonicalCommentsFor'),
    extractFunction('_sxrSetCanonicalCommentsFor'),
    extractFunction('_sxrMsgAudience'),
    extractFunction('_sxrClientVisibleLegacyRows'),
    extractFunction('_sxrCommentsForView'),
    extractFunction('_prodProjectCanonicalCardComments'),
  ].join('\n'), env);
  return env;
}

const DELIVERABLE = {
  id: 'dlv-1', client_slug: 'acme-co', team: 'video', kind: 'video',
  origin: 'calendar', card_id: 'card-1',
};
const SXR_DELIVERABLE = Object.assign({}, DELIVERABLE, { origin: 'samples' });

function legacyRow(body, extra) {
  return Object.assign({
    id: 'l-' + Math.random().toString(36).slice(2, 8),
    body, author_key: 'client:acme', role: 'client', audience: 'client',
    created_at: '2026-07-20T00:00:00Z',
  }, extra || {});
}
function canonicalRow(body, extra) {
  return Object.assign({
    id: 'c-' + Math.random().toString(36).slice(2, 8),
    canonical: true, body, author_key: 'client:acme', role: 'client',
    audience: 'client', component: 'video',
    source_created_at: '2026-07-20T00:00:00Z', created_at: '2026-07-20T00:00:00Z',
  }, extra || {});
}

(async () => {
  console.log('Canonical projection — invoked\n');

  // ================================================================ G1 multiset
  {
    const legacy = [legacyRow('Same note'), legacyRow('Same note'), legacyRow('Same note')];
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('Same note')] } },
    });
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
      comments: legacy.slice(), tweaks: JSON.stringify(legacy),
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    const post = app.calState.posts[0];
    ok(post.video_comments.length === 3,
      'G1: 3 identical legacy rows are NOT replaced by 1 identical canonical row');
    ok(post.video_tweaks === JSON.stringify(legacy) && post.tweaks === JSON.stringify(legacy),
      'G1: both wire strings survive the duplicate-collapse attempt byte-identical');
  }
  {
    // 3 legacy, 3 canonical copies -> replacement IS lossless and proceeds.
    const legacy = [legacyRow('Same note'), legacyRow('Same note'), legacyRow('Same note')];
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('Same note'), canonicalRow('Same note'), canonicalRow('Same note')] } },
    });
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    ok(app.calState.posts[0].video_comments.every(row => row.canonical === true)
      && app.calState.posts[0].video_comments.length === 3,
    'G1: N legacy rows matched by N canonical copies DO replace (multiset, not "never")');
  }

  // ================================================================ G2 raw body
  for (const [label, legacyBody, canonicalBody] of [
    ['case', 'Approved', 'approved'],
    ['line break', 'line one\nline two', 'line one line two'],
    ['leading space', '  indented', 'indented'],
  ]) {
    const legacy = [legacyRow(legacyBody)];
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow(canonicalBody)] } },
    });
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    ok(app.calState.posts[0].video_comments.length === 1
      && app.calState.posts[0].video_comments[0].body === legacyBody,
    `G2: a ${label}-differing canonical body does NOT cover legacy — content is preserved`);
  }
  {
    // Exactly equal bodies still cover, so the invariant is not simply "never".
    const legacy = [legacyRow('Exact match')];
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('Exact match')] } },
    });
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    ok(app.calState.posts[0].video_comments[0].canonical === true,
      'G2: a byte-identical canonical body DOES cover legacy and replacement proceeds');
  }

  // ================================================================ G3 injectivity
  {
    const app = makeApp({});
    const key = app._prodCommentProvenanceKey;
    const U1 = String.fromCharCode(1);
    ok(key({ body: 'ab', author_key: 'c', created_at: 't' })
      !== key({ body: 'a', author_key: 'bc', created_at: 't' }),
    'G3: a shifted field boundary produces a different key');
    ok(key({ body: 'a' + U1 + 'b', author_key: 'x', created_at: 't' })
      !== key({ body: 'a', author_key: 'b' + U1 + 'x', created_at: 't' }),
    'G3: a control character INSIDE a field cannot forge a boundary');
    ok(key({ body: '"', author_key: '', created_at: '' })
      !== key({ body: '', author_key: '"', created_at: '' }),
    'G3: a quote inside a field cannot forge a boundary either');
    ok(!/never appears in a comment body/.test(source),
      'G3: the unenforced "a control character never appears" claim is gone from the source');
  }
  {
    // A forged-boundary row must not be accepted as covering a different row.
    const U1 = String.fromCharCode(1);
    const legacy = [legacyRow('a' + U1 + 'client:acme')];
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('a', { author_key: 'client:acme' })] } },
    });
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    ok(app.calState.posts[0].video_comments.length === 1
      && app.calState.posts[0].video_comments[0].body.includes(U1),
    'G3: a boundary-forging legacy row is not treated as covered');
  }

  // ================================================================ malformed loader case
  {
    // A malformed but NON-EMPTY *_tweaks string is reduced to [] by the loader.
    // The parsed array is then empty while the wire string still holds content:
    // coverage sees nothing to protect, so the write proceeds and the wire
    // string is rewritten. Pinned as the CURRENT behaviour so a future change
    // to the loader cannot silently alter it unobserved.
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('Fresh reply')] } },
    });
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: [],
      video_tweaks: '[{"id":"broken",  not json',
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    const post = app.calState.posts[0];
    ok(post.video_comments.length === 1 && post.video_comments[0].body === 'Fresh reply',
      'malformed-but-nonempty tweaks: the parsed array was already empty, so canonical writes');
    ok(post.video_tweaks !== '[{"id":"broken",  not json',
      'malformed-but-nonempty tweaks: the unparseable wire string IS replaced (documented behaviour)');
  }

  // ================================================================ G4 client SXR
  {
    // ready-but-EMPTY canonical while client-visible legacy exists.
    const legacy = [legacyRow('Client can see this')];
    const app = makeApp({
      clientLink: true,
      deliverables: [SXR_DELIVERABLE],
      threads: { 'dlv-1': { items: [] } },
    });
    app.sxrState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(),
    }];
    await app._prodProjectCanonicalCardComments('sxr', 'card-1');
    const post = app.sxrState.posts[0];
    const gate = app._prodCanonicalCommentGate(post, 'video');
    ok(gate.status === 'legacy_retained' && gate.linked === false,
      'G4: a ready-but-EMPTY canonical thread over visible legacy is held, not shown empty');
    const view = app._sxrCommentsForView(post, 'video');
    ok(view.length === 1 && view[0].body === 'Client can see this',
      'G4: the client still sees their comment (the hold actually fires end to end)');
  }
  {
    // ready-but-PARTIAL canonical: the case the old !projected.length skipped.
    const legacy = [legacyRow('First note'), legacyRow('Second note')];
    const app = makeApp({
      clientLink: true,
      deliverables: [SXR_DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('First note')] } },
    });
    app.sxrState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(),
    }];
    await app._prodProjectCanonicalCardComments('sxr', 'card-1');
    const post = app.sxrState.posts[0];
    ok(app._prodCanonicalCommentGate(post, 'video').status === 'legacy_retained',
      'G4: a ready-but-PARTIAL canonical thread is ALSO held (the skipped case)');
    const view = app._sxrCommentsForView(post, 'video');
    ok(view.length === 2 && view.map(r => r.body).join('|') === 'First note|Second note',
      'G4: the client keeps BOTH comments rather than losing the uncovered one');
  }
  {
    // Full coverage -> the canonical thread is adopted, so the hold is not
    // simply "always on".
    const legacy = [legacyRow('Covered note')];
    const app = makeApp({
      clientLink: true,
      deliverables: [SXR_DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('Covered note')] } },
    });
    app.sxrState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(),
    }];
    await app._prodProjectCanonicalCardComments('sxr', 'card-1');
    const post = app.sxrState.posts[0];
    ok(app._prodCanonicalCommentGate(post, 'video').status === 'ready',
      'G4: a fully-covering canonical thread IS adopted (the hold is not unconditional)');
    ok(app._sxrCommentsForView(post, 'video').every(r => r.canonical === true),
      'G4: once adopted the client reads the canonical rows');
  }
  {
    // No client-visible legacy at all -> nothing to protect, adopt freely.
    const app = makeApp({
      clientLink: true,
      deliverables: [SXR_DELIVERABLE],
      threads: { 'dlv-1': { items: [] } },
    });
    app.sxrState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      // internal-only legacy: not client-visible, so not protected
      video_comments: [legacyRow('Internal chatter', { role: 'smm', audience: 'internal' })],
    }];
    await app._prodProjectCanonicalCardComments('sxr', 'card-1');
    ok(app._prodCanonicalCommentGate(app.sxrState.posts[0], 'video').status === 'ready',
      'G4: internal-only legacy is not client-visible, so an empty canonical thread is adopted');
  }
  {
    // The helper must be gate-independent — the circularity that made G4 dead.
    const app = makeApp({ clientLink: true, deliverables: [SXR_DELIVERABLE] });
    const post = {
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: [legacyRow('Visible')],
      _canonicalCrosswalk: { 'video|dlv-1': { state: 'valid', fields: [] } },
      _canonicalCommentReads: { 'dlv-1': { status: 'ready', client: true, clientSurface: null } },
    };
    ok(app._sxrClientVisibleLegacyRows(post, 'video').length === 1,
      'G4: the legacy reader returns rows even when the gate reports linked+ready');
    ok(app._sxrCommentsForView(post, 'video').length === 0,
      'G4: ...while the gate-dependent view on that same post returns the canonical (empty) set');
    ok(!/_sxrCommentsForView\(post, component\)/.test(
      source.slice(source.indexOf('async function _prodProjectCanonicalCardComments'),
        source.indexOf('function _prodCanonicalCommentGate'))),
    'G4: the projection no longer calls the gate-dependent view');
  }

  if (failures) {
    console.error(`\n${failures} canonical projection invocation check(s) failed`);
    process.exit(1);
  }
  console.log('\nCanonical projection invocation checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
