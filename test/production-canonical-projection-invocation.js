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
    // Read from source, never hardcoded: a stale copy here would let the real
    // list drift while the cache-stripping assertions kept passing.
    PROD_EPHEMERAL_CANONICAL_KEYS: Object.freeze(
      (source.slice(
        source.indexOf('const PROD_EPHEMERAL_CANONICAL_KEYS'),
        source.indexOf(']);', source.indexOf('const PROD_EPHEMERAL_CANONICAL_KEYS')),
      ).match(/'_[A-Za-z]+'/g) || []).map(s => s.slice(1, -1)),
    ),
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
    extractFunction('_prodLegacyRawFieldCount'),
    extractFunction('_prodLegacySameContent'),
  extractFunction('_prodLegacyReadIncomplete'),
  extractFunction('_prodStripEphemeralCanonicalState'),
    extractFunction('_prodMarkLegacyReadIncomplete'),
    extractFunction('_prodRootAudienceClientRows'),
    extractFunction('_prodCanonicalCoversLegacy'),
    extractFunction('_calLoadCommentsField'),
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

  // ================================================================ unreadable legacy column
  // A column the loader could not fully read is UNKNOWN, not empty. Its text is
  // still recoverable by a human, a support query or a migration right up until
  // a projection overwrites it — at which point it is gone for everyone.
  {
    const app = makeApp({});
    ok(app._prodLegacyRawFieldCount('') === 0 && app._prodLegacyRawFieldCount('   ') === 0,
      'an empty column counts zero stored rows');
    ok(app._prodLegacyRawFieldCount('[{"id":"a"},{"id":"b"}]') === 2,
      'a well-formed array column counts its rows');
    ok(app._prodLegacyRawFieldCount('[{"id":"broken",  not json') === 1,
      'an UNPARSEABLE column counts as holding content, not as empty');
    ok(app._prodLegacyRawFieldCount('plain text feedback') === 1,
      'a non-JSON column counts as holding content');
    ok(app._prodLegacyRawFieldCount('{"not":"an array"}') === 1,
      'a JSON non-array column counts as holding content');
  }
  for (const [label, raw] of [
    ['unparseable JSON', '[{"id":"broken",  not json'],
    // The reviewer reproduction: parses perfectly, is human-readable, and is
    // dropped only for lacking an id.
    ['a readable row with no id', '[{"body":"real feedback, no id"}]'],
    ['a JSON non-array', '{"body":"real feedback"}'],
  ]) {
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('Fresh reply')] } },
    });
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: [], video_tweaks: raw,
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    ok(app.calState.posts[0].video_tweaks === raw,
      `REGRESSION: ${label} is NOT overwritten — an unread column is unknown, not empty`);
  }
  {
    // Partial drop: one row survives, one is dropped for lacking an id. The
    // surviving row alone must not license replacing the column.
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('kept', { id: 'k' })] } },
    });
    const raw = '[{"id":"k","body":"kept"},{"body":"dropped, no id"}]';
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: [{ id: 'k', body: 'kept', author_key: 'client:acme', created_at: '2026-07-20T00:00:00Z' }],
      video_tweaks: raw,
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    ok(app.calState.posts[0].video_tweaks === raw,
      'REGRESSION: a PARTIALLY read column is not overwritten even though the loaded rows are covered');
  }
  {
    // A cleanly-read column still replaces, so the guard is not "never".
    const legacy = [legacyRow('Readable')];
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('Readable')] } },
    });
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    ok(app.calState.posts[0].video_comments[0].canonical === true,
      'a fully-read column whose content IS carried still replaces');
  }
  {
    // The loader stamps the signal at the point the drop happens, and the
    // signal survives a cache rehydrate where the loader never runs again.
    const app = makeApp({});
    const post = { video_tweaks: '[{"body":"no id"}]' };
    const loaded = app._calLoadCommentsField(post, 'video_tweaks', '');
    ok(loaded.length === 0 && post._legacyReadIncomplete
      && post._legacyReadIncomplete.video === true,
    'the calendar loader marks the read incomplete when it drops an id-less row');
    ok(app._prodLegacyReadIncomplete({ video_tweaks: '[{"body":"no id"}]' }, 'video', []) === true,
      'incompleteness is recomputable from the raw column alone, so a rehydrated post is still protected');
  }
  {
    // Samples: no legacy-seed path at all, so a non-JSON column is pure loss.
    const app = makeApp({
      clientLink: true,
      deliverables: [SXR_DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('Fresh')] } },
    });
    app.sxrState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: [], video_tweaks: 'plain text a client wrote',
    }];
    await app._prodProjectCanonicalCardComments('sxr', 'card-1');
    ok(app.sxrState.posts[0].video_tweaks === 'plain text a client wrote'
      && app._prodCanonicalCommentGate(app.sxrState.posts[0], 'video').status === 'legacy_retained',
    'REGRESSION: an unreadable Samples column holds the card rather than overwriting');
  }

  // ---------------------------------------------------------------- the `tweaks` alias
  // The video slot spans two legacy columns. Both setters write both, but the
  // loader reads `tweaks` only as a fallback and skips it entirely once
  // `video_tweaks` holds something — so divergent content in `tweaks` is read
  // by nobody and destroyed by every write.
  {
    const legacy = [legacyRow('in video_tweaks', { id: 'a' })];
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('in video_tweaks', { id: 'a' })] } },
    });
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
      tweaks: 'ORIGINAL FEEDBACK ONLY IN THE ALIAS COLUMN',
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    ok(app.calState.posts[0].tweaks === 'ORIGINAL FEEDBACK ONLY IN THE ALIAS COLUMN',
      'REGRESSION: divergent content in the `tweaks` alias is not destroyed by a covered write');
  }
  {
    // The normal case — both columns in sync — must NOT be held forever.
    const legacy = [legacyRow('Synced', { id: 'a' })];
    const wire = JSON.stringify(legacy);
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('Synced', { id: 'a' })] } },
    });
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(), video_tweaks: wire, tweaks: wire,
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    ok(app.calState.posts[0].video_comments[0].canonical === true,
      'a card whose two video columns are in sync still adopts (the alias rule is not a blanket hold)');
  }
  {
    // Primary empty, alias holds content: the loader SEEDS from the alias, so
    // the content is carried and must not be double-counted into a false hold.
    const app = makeApp({});
    const seeded = app._calLoadCommentsField(
      { video_tweaks: '', tweaks: 'legacy blob' }, 'video_tweaks', 'legacy blob',
    );
    ok(seeded.length === 1,
      'an empty primary seeds one row from the alias, so the alias content is carried');
    ok(app._prodLegacyReadIncomplete({ video_tweaks: '', tweaks: 'legacy blob' }, 'video', seeded) === false,
      'a seeded alias is not counted as unread (no false hold)');
  }

  // ================================================================ audience alignment
  {
    // A canonical REPLY tagged internal beneath a client-visible root is
    // client-visible under the root-audience rule. Filtering canonical on each
    // row own audience would drop it, so coverage could never succeed and the
    // card would hold forever.
    const app = makeApp({});
    const rows = [
      { id: 'r', body: 'root', audience: 'client', role: 'client' },
      { id: 'a', parent_id: 'r', body: 'reply', audience: 'internal', role: 'client' },
    ];
    ok(app._prodRootAudienceClientRows(rows).length === 2,
      'a reply inherits its root audience, so both rows are client-visible');
    ok(app._prodRootAudienceClientRows([
      { id: 'r', body: 'root', audience: 'internal', role: 'smm' },
      { id: 'a', parent_id: 'r', body: 'reply', audience: 'client', role: 'client' },
    ]).length === 0,
    'a client-tagged reply under an INTERNAL root stays hidden');
    ok(app._prodRootAudienceClientRows([{ id: 'k', body: 'x', audience: 'client', role: 'kasper' }]).length === 0,
      'Kasper authorship is hard-hidden regardless of audience');
  }
  {
    // THE CLIENT-LOSS CASE. A staff reply carries no audience of its own and
    // inherits `client` from its root, so the client reads it today. Its
    // canonical twin is tagged `internal` and the linked render filters it out
    // per-row. Building the canonical comparison set with root inheritance
    // would certify it as covered, the card would adopt, and the client would
    // lose a message they can read right now. Coverage must therefore compare
    // what the reader will ACTUALLY emit.
    const legacy = [
      legacyRow('root note', { id: 'r', audience: 'client' }),
      legacyRow('reply note', { id: 'a', parent_id: 'r', role: 'smm', audience: undefined }),
    ];
    const app = makeApp({
      clientLink: true,
      deliverables: [SXR_DELIVERABLE],
      threads: {
        'dlv-1': {
          items: [
            canonicalRow('root note', { id: 'cr', audience: 'client' }),
            canonicalRow('reply note', { id: 'ca', parent_id: 'cr', role: 'smm', audience: 'internal' }),
          ],
        },
      },
    });
    app.sxrState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
    }];
    const before = app._sxrClientVisibleLegacyRows(app.sxrState.posts[0], 'video').map(r => r.body);
    await app._prodProjectCanonicalCardComments('sxr', 'card-1');
    const post = app.sxrState.posts[0];
    const after = app._sxrCommentsForView(post, 'video').map(r => r.body);
    ok(before.length === 2 && before.includes('reply note'),
      'the client reads the staff reply today, by root-audience inheritance');
    ok(after.length >= before.length && before.every(b => after.includes(b)),
      'REGRESSION: adoption never leaves the client seeing LESS than they see today');
    ok(app._prodCanonicalCommentGate(post, 'video').status === 'legacy_retained',
      'the card is held, because the canonical render rule would drop the staff reply');
  }
  {
    // Explicitly agreeing rows still adopt: the hold above is caused by the two
    // render rules disagreeing, not by a blanket refusal on threaded content.
    const legacy = [
      legacyRow('root note', { id: 'r', audience: 'client' }),
      legacyRow('reply note', { id: 'a', parent_id: 'r', audience: 'client' }),
    ];
    const app = makeApp({
      clientLink: true,
      deliverables: [SXR_DELIVERABLE],
      threads: {
        'dlv-1': {
          items: [
            canonicalRow('root note', { id: 'cr', audience: 'client' }),
            canonicalRow('reply note', { id: 'ca', parent_id: 'cr', audience: 'client' }),
          ],
        },
      },
    });
    app.sxrState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
    }];
    await app._prodProjectCanonicalCardComments('sxr', 'card-1');
    ok(app._prodCanonicalCommentGate(app.sxrState.posts[0], 'video').status === 'ready',
      'a thread whose rows agree on BOTH render rules adopts normally');
  }
  {
    // ...and the hold still fires when the canonical side genuinely lacks it.
    const legacy = [
      legacyRow('root note', { id: 'r', audience: 'client' }),
      legacyRow('reply note', { id: 'a', parent_id: 'r', audience: 'client' }),
    ];
    const app = makeApp({
      clientLink: true,
      deliverables: [SXR_DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('root note', { id: 'cr', audience: 'client' })] } },
    });
    app.sxrState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
    }];
    await app._prodProjectCanonicalCardComments('sxr', 'card-1');
    ok(app._prodCanonicalCommentGate(app.sxrState.posts[0], 'video').status === 'legacy_retained',
      'a genuinely missing reply still holds the card');
  }

  // ================================================================ staff hold status
  {
    // An unread column must hold the STAFF path too. Falling through to `ready`
    // would report linked+ready while the legacy thread is what renders, and
    // the comment lifecycle would then address a canonical row that does not
    // exist (CAS failure, mark-done silently dead).
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('Fresh')] } },
    });
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: [], video_tweaks: '[{"body":"no id"}]',
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    const gate = app._prodCanonicalCommentGate(app.calState.posts[0], 'video');
    ok(gate.status === 'legacy_retained' && gate.linked === false,
      'REGRESSION: a held staff card reports legacy_retained, not linked+ready');
  }

  // ================================================================ cache + flag lifecycle
  {
    const app = makeApp({});
    ok(app.PROD_EPHEMERAL_CANONICAL_KEYS.includes('_legacyReadIncomplete'),
      'the incomplete-read verdict is stripped from the 7-day cache like the other live verdicts');
    const cached = app._prodStripEphemeralCanonicalState({
      id: 'c', video_tweaks: '[]', _legacyReadIncomplete: { video: true },
    });
    ok(!('_legacyReadIncomplete' in cached),
      'a cached post carries no stale incomplete-read verdict');
    // A repaired column clears the flag rather than holding for the cache TTL.
    const post = { video_tweaks: '[{"body":"no id"}]' };
    app._calLoadCommentsField(post, 'video_tweaks', '');
    ok(post._legacyReadIncomplete.video === true, 'a dropped row stamps the flag');
    post.video_tweaks = '[{"id":"c1","body":"repaired"}]';
    app._calLoadCommentsField(post, 'video_tweaks', '');
    ok(!post._legacyReadIncomplete.video,
      'REGRESSION: a repaired column CLEARS the flag, so the hold is not sticky');
  }
  {
    // Samples has no seed path, so an empty primary does NOT carry the alias.
    const app = makeApp({});
    const sxrPost = { video_tweaks: '', tweaks: '[{"id":"s1","body":"only in alias"}]' };
    ok(app._prodLegacyReadIncomplete(sxrPost, 'video', [], 'sxr') === true,
      'REGRESSION: on Samples an empty primary with a populated alias is INCOMPLETE');
    ok(app._prodLegacyReadIncomplete(sxrPost, 'video', [], 'calendar') === false,
      'on calendar the same shape is carried by the seed fallback, so it is complete');
    // Re-serialised identical content must not hold forever.
    ok(app._prodLegacySameContent(
      '[{"id":"c1","body":"fix the intro","author":"S","created_at":"t"}]',
      '[{"body": "fix the intro", "id": "c1", "author":"S", "created_at":"t"}]',
    ) === true,
    'REGRESSION: the alias comparison is by content, not bytes, so a reserialised column does not hold');
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
