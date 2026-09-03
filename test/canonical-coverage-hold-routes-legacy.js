'use strict';

/*
 * A canonical projection that REFUSES must also SAY it refused.
 *
 * The calendar coverage guard already protected legacy storage — it skipped the
 * setter, so the stored `*_tweaks` survived (that is what the G1 suite proves).
 * But it returned bare, leaving `clientLegacyHeld` false, so the deliverable was
 * still stamped `ready`. The gate then answered `linked:true, ready:true` for a
 * card whose LEGACY rows are what actually renders.
 *
 * That combination is the whole mark-done failure on an uncovered card:
 *   `_calToggleCommentDone` routes on `linked`  -> takes the canonical branch
 *   `_writeUiCardCommentLifecycle` needs `ready` -> passes
 *   the legacy row it is handed has no `version` -> 409 comment_cas_required
 * ...before a request is ever sent, and the SMM is told the comment could not be
 * committed. Worse, `_calResolveLastTweak`'s `if (!receipt) return;` sits BEFORE
 * `_calApplyAutoStatus`, so the card cannot be routed onward either.
 *
 * Every assertion drives the REAL functions. Each one is run twice: once against
 * the shipped source and once against a variant with the hold textually reverted
 * to the bare `return`. The reverted variant must FAIL the property — that is
 * what makes these tests teeth rather than decoration.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHIPPED = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Brace-matched extraction that also skips COMMENTS.
   The older suites track quotes only, so a comment containing an apostrophe
   ("doesn't") flips them into string mode and they either throw or — worse —
   silently return a megabyte of the file that happens to re-balance. Both
   happen on this path: _calToggleCommentDone and _calFindCompForCommentId
   throw, _calResolveLastTweak silently swallowed 1.1 MB. Every extraction here
   is length-checked by the caller for that reason. */
function extractFunction(name, from) {
  const text = from || SHIPPED;
  const marker = 'function ' + name;
  let start = text.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (text.slice(start - 6, start) === 'async ') start -= 6;
  const brace = text.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      const body = text.slice(start, i + 1);
      // A runaway extraction can still parse. Anything this large is the rest
      // of the file, not a function on this path.
      if (body.length > 40000) throw new Error('runaway extraction for ' + name);
      return body;
    }
  }
  throw new Error('unclosed ' + name);
}

// ── The two variants ────────────────────────────────────────────────────────
// The pre-fix form, reconstructed by textual revert. If the shipped block ever
// stops matching, this throws rather than silently testing one variant twice.
const HELD = 'if (!_prodCanonicalCoversLegacy(projected, legacyRows)) {\n'
  + '                            clientLegacyHeld = true;\n'
  + '                            return;\n'
  + '                        }';
const BARE = 'if (!_prodCanonicalCoversLegacy(projected, legacyRows)) return;';

if (SHIPPED.indexOf(HELD) < 0) {
  throw new Error('the calendar coverage hold is not in its expected form — '
    + 'update HELD, and re-check that the hold is still present at all');
}
const REVERTED = SHIPPED.replace(HELD, BARE);
if (REVERTED === SHIPPED) throw new Error('textual revert did not apply');
if (REVERTED.indexOf(BARE) < 0) throw new Error('reverted variant lacks the bare return');

const CAL_COMPONENTS = ['video', 'graphic', 'caption', 'title'];
const DELIVERABLE = {
  id: 'dlv-1', client_slug: 'acme-co', team: 'video',
  origin: 'calendar', card_id: 'card-1',
};

function legacyRow(body, extra) {
  return Object.assign({
    id: 'l-' + body.replace(/\W/g, '').slice(0, 8),
    body, author_key: 'client:acme', author: 'Client', role: 'client',
    audience: 'client', is_tweak: true, round: 1, parent_id: null,
    done: false, done_at: '', done_by: '',
    created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z',
  }, extra || {});
}
function canonicalRow(body, extra) {
  return Object.assign({
    id: 'c-' + body.replace(/\W/g, '').slice(0, 8), canonical: true, body,
    author_key: 'client:acme', author: 'Client', role: 'client',
    audience: 'client', component: 'video', is_tweak: true, round: 1,
    parent_id: null, done: false, can_resolve: true,
    version: 1, row_updated_at: '2026-07-21T00:00:00Z',
    canonical_updated_at: '2026-07-21T00:00:00Z',
    source_created_at: '2026-07-20T00:00:00Z', created_at: '2026-07-20T00:00:00Z',
    updated_at: '2026-07-20T00:00:00Z',
  }, extra || {});
}

/* One sandbox running the REAL projection, the REAL gate, and the REAL
   mark-done / resolve-destination path. Only the network read, the chooser
   overlay, the renderers and the gateway call are stubbed — and the gateway
   stub returns null, which is exactly what a refused write returns today. */
function makeApp(opts, source) {
  const o = opts || {};
  const env = {
    console,
    CAL_REVIEW_COMPONENTS: CAL_COMPONENTS,
    SXR_COMPONENTS: ['video', 'graphic'],
    PROD_CROSSWALK_SURFACE_ORIGIN: { calendar: 'calendar', sxr: 'samples' },
    PROD_CROSSWALK_SELECT: 'id,client_slug,team,origin,card_id',
    PROD_EPHEMERAL_CANONICAL_KEYS: Object.freeze(
      ['_canonicalCrosswalk', '_canonicalCommentReads', '_legacyReadIncomplete'],
    ),
    CAL_SUPABASE_URL: 'https://db.test',
    CAL_SUPABASE_ANON_KEY: 'anon',
    _isClientLink: false,
    calState: { posts: [] },
    sxrState: { posts: [], client: 'acme-co' },
    // The modal is OPEN on the card under test: _calToggleCommentDone takes its
    // pid from here, not from an argument.
    _calOpenCommentsPid: 'card-1',
    _sxrOpenCommentsPid: null,
    _calPendingEdits: {},
    setTimeout: fn => fn(),
    document: { getElementById: () => null },
    // Observability for the assertions.
    spy: { lifecycle: [], autoStatus: [], watchSave: 0, chooser: 0 },
    _calRenderCommentsModal() {},
    _sxrRenderCommentsModal() {},
    _calCaptureModalDrafts() {},
    _calRefreshCommentsBtn() {},
    _calUpdateCardStatusDisplay() {},
    _calComponentsFor: () => CAL_COMPONENTS,
    _calStringifyComments: list => JSON.stringify(list || []),
    _sxrStringifyComments: list => JSON.stringify(list || []),
    _calLoadComments: post => (Array.isArray(post && post.comments) ? post.comments : []),
    _calCommentRole: () => o.role || 'smm',
    _calCurrentAuthor: () => 'SMM Tester',
    _calOpenTweaksForComp: (post, comp) => (env._calCommentsFor(post, comp) || [])
      .filter(c => c && !c.parent_id && !c.done && !c.deleted && env._calMsgIsTweak(c)),
    _calResolveDestRecommend: () => 'client',
    _calResolveDestReason: () => '',
    // Mirrors the real overlay-missing branch: fire onChoose immediately.
    _calShowResolveDest: options => {
      env.spy.chooser++;
      const ids = (options.openTweaks || []).map(t => t.id);
      return options.onChoose(options.recommend || 'client', ids);
    },
    _calApplyAutoStatus: (pid, trigger, comp, dest) => {
      env.spy.autoStatus.push({ pid, trigger, comp, dest });
      return true;
    },
    _calWatchNoteSave: async () => { env.spy.watchSave++; },
    // A refused native write. `_writeUiCommitCardCommentLifecycle` swallows the
    // gateway error and returns null — the exact shape both callers branch on.
    _writeUiCommitCardCommentLifecycle: async (surface, post, comp, comment, action) => {
      env.spy.lifecycle.push({ surface, id: post && post.id, comp, comment: comment && comment.id, action });
      return null;
    },
    _writeUiPersistCanonicalCommentProjection: async () => {},
    _prodCanonicalCardComment: row => row,
    _prodClientCommentSurfaceKey: v => (v ? JSON.stringify(v) : ''),
    _prodCardClientCommentSurfaceKnown: () => true,
    _prodVerifiedClientCommentSurfaceContext: (surface, post, component, deliverableId) => ({
      source_surface: surface, card_id: post && post.id, component, deliverable_id: deliverableId,
    }),
    _prodComments: {
      readCanonical: async (deliverableId, readOpts) => {
        const thread = (o.threads || {})[deliverableId];
        if (!thread) return { status: 'error' };
        return Object.assign(
          { status: 'ready', clientSurfaceVerified: true, clientSurface: readOpts && readOpts.clientSurface },
          thread,
        );
      },
    },
    fetch: async () => ({ ok: true, json: async () => o.deliverables || [] }),
  };
  vm.createContext(env);
  vm.runInContext([
    // _writeUiNativeId now asks _writeUiComponentHasWorkItem whether the
    // component owns a deliverable at all (caption/title do not), so the real
    // predicate has to be in the sandbox with it. OPEN_REPAIRS 127.
    extractFunction('_writeUiComponentHasWorkItem', source),
    extractFunction('_writeUiNativeId', source),
    extractFunction('_prodCrosswalkTeamForComponent', source),
    extractFunction('_prodCrosswalkCardSlug', source),
    extractFunction('_prodCrosswalkMismatchFields', source),
    extractFunction('_prodCrosswalkKey', source),
    extractFunction('_prodCrosswalkVerdict', source),
    extractFunction('_prodCrosswalkSetVerdict', source),
    extractFunction('_prodCommentProvenanceKey', source),
    extractFunction('_prodLegacyRawFieldCount', source),
    extractFunction('_prodLegacySameContent', source),
    extractFunction('_prodLegacyReadIncomplete', source),
    extractFunction('_prodMarkLegacyReadIncomplete', source),
    extractFunction('_prodRootAudienceClientRows', source),
    extractFunction('_prodLegacyUnrepresentableState', source),
    extractFunction('_prodCanonicalCoversLegacy', source),
    extractFunction('_calLoadCommentsField', source),
    extractFunction('_prodFetchCrosswalkRows', source),
    extractFunction('_prodCardBindingToken', source),
    extractFunction('_prodResolveCardCrosswalk', source),
    extractFunction('_prodCanonicalCommentGate', source),
    extractFunction('_prodProjectCanonicalCardComments', source),
    extractFunction('_calCommentsFor', source),
    extractFunction('_calSetCommentsFor', source),
    extractFunction('_sxrCommentsFor', source),
    extractFunction('_sxrSetCommentsFor', source),
    extractFunction('_sxrCanonicalCommentsFor', source),
    extractFunction('_sxrSetCanonicalCommentsFor', source),
    extractFunction('_sxrMsgAudience', source),
    extractFunction('_sxrClientVisibleLegacyRows', source),
    extractFunction('_sxrCommentsForView', source),
    extractFunction('_calMsgAudience', source),
    extractFunction('_calMsgIsTweak', source),
    extractFunction('_calFindCompForCommentId', source),
    extractFunction('_calResolveTweaksDone', source),
    extractFunction('_calResolveLastTweak', source),
    extractFunction('_calToggleCommentDone', source),
  ].join('\n'), env);
  return env;
}

/* An UNCOVERED card: two legacy notes, canonical carries only one of them. */
function uncovered(source, extra) {
  const legacy = [legacyRow('First note'), legacyRow('Second note')];
  const app = makeApp(Object.assign({
    deliverables: [DELIVERABLE],
    threads: { 'dlv-1': { items: [canonicalRow('First note')] } },
  }, extra || {}), source);
  app.calState.posts = [{
    id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
    status: 'Tweaks Needed', video_status: 'Tweaks Needed',
    video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
    comments: legacy.slice(), tweaks: JSON.stringify(legacy),
  }];
  return { app, legacy };
}

/* A COVERED card: canonical carries every legacy note. */
function covered(source, extra) {
  const legacy = [legacyRow('First note')];
  const app = makeApp(Object.assign({
    deliverables: [DELIVERABLE],
    threads: { 'dlv-1': { items: [canonicalRow('First note')] } },
  }, extra || {}), source);
  app.calState.posts = [{
    id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
    status: 'Tweaks Needed', video_status: 'Tweaks Needed',
    video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
    comments: legacy.slice(), tweaks: JSON.stringify(legacy),
  }];
  return { app, legacy };
}

(async () => {
  // ── (a) an uncovered card reports a held gate and routes legacy ───────────
  {
    const { app } = uncovered(SHIPPED);
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    const post = app.calState.posts[0];
    const gate = app._prodCanonicalCommentGate(post, 'video');

    ok(post._canonicalCommentReads['dlv-1'].status === 'legacy_retained',
      '(a) uncovered deliverable is stamped legacy_retained, not ready');
    ok(gate.linked === false && gate.ready === false && gate.status === 'legacy_retained',
      '(a) the gate reports not-linked / not-ready, so mark-done takes the legacy branch');
    ok(post.video_comments.length === 2 && post.video_comments.every(r => !r.canonical),
      '(a) legacy rows still render — the projection was refused, not applied');

    const { app: pre } = uncovered(REVERTED);
    await pre._prodProjectCanonicalCardComments('calendar', 'card-1');
    const preGate = pre._prodCanonicalCommentGate(pre.calState.posts[0], 'video');
    ok(pre.calState.posts[0]._canonicalCommentReads['dlv-1'].status === 'ready'
      && preGate.linked === true && preGate.ready === true,
      '(a) TEETH: reverted to the bare return, the same card is ready+linked while rendering legacy');
  }

  // ── (b) mark-done persists and survives a modal reopen ────────────────────
  {
    const { app, legacy } = uncovered(SHIPPED);
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    const post = app.calState.posts[0];
    // Two open change-requests, so this is the plain (non-chooser) mark-done.
    app._calToggleCommentDone(legacy[0].id);

    const doneNow = app._calCommentsFor(post, 'video').find(c => c.id === legacy[0].id);
    ok(doneNow && doneNow.done === true && !!doneNow.done_at,
      '(b) mark-done applied on the held card');
    ok(app.spy.lifecycle.length === 0,
      '(b) no native lifecycle write was attempted');
    ok(String(app._calPendingEdits['card-1'].video_tweaks).includes('"done":true'),
      '(b) the resolve is queued to the source column');
    ok(app._calCommentsFor(post, 'video').length === 2,
      '(b) both notes are still present — nothing was dropped by the write-back');

    // Reopening the modal re-runs the projection. The hold must keep holding,
    // or the canonical rows (done:false) would overwrite the resolve.
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    const after = app._calCommentsFor(app.calState.posts[0], 'video')
      .find(c => c.id === legacy[0].id);
    ok(after && after.done === true,
      '(b) the resolve SURVIVES the reopen — no silent revert');

    const { app: pre, legacy: preLegacy } = uncovered(REVERTED);
    await pre._prodProjectCanonicalCardComments('calendar', 'card-1');
    pre._calToggleCommentDone(preLegacy[0].id);
    const preRow = pre._calCommentsFor(pre.calState.posts[0], 'video')
      .find(c => c.id === preLegacy[0].id);
    ok(pre.spy.lifecycle.length === 1 && (!preRow || preRow.done !== true),
      '(b) TEETH: reverted, the click goes to the refused native lifecycle and nothing is marked done');
  }

  // ── (c) a covered card is byte-unchanged ─────────────────────────────────
  {
    const fixed = covered(SHIPPED);
    const pre = covered(REVERTED);
    await fixed.app._prodProjectCanonicalCardComments('calendar', 'card-1');
    await pre.app._prodProjectCanonicalCardComments('calendar', 'card-1');

    const f = fixed.app.calState.posts[0];
    const p = pre.app.calState.posts[0];
    ok(JSON.stringify(f._canonicalCommentReads) === JSON.stringify(p._canonicalCommentReads),
      '(c) covered card: read status identical with and without the hold');
    ok(f.video_tweaks === p.video_tweaks && f.tweaks === p.tweaks,
      '(c) covered card: both wire strings identical');
    ok(JSON.stringify(f.video_comments) === JSON.stringify(p.video_comments),
      '(c) covered card: projected rows identical');

    const gate = fixed.app._prodCanonicalCommentGate(f, 'video');
    ok(gate.linked === true && gate.ready === true,
      '(c) covered card still routes canonical — the fix did not widen the hold');
    // On a covered card the projection has REPLACED the legacy rows, so the
    // rendered root is the canonical one — resolve by what actually renders.
    const rendered = fixed.app._calCommentsFor(f, 'video')[0];
    ok(rendered && rendered.canonical === true,
      '(c) covered card renders the canonical row');
    await fixed.app._calToggleCommentDone(rendered.id);
    ok(fixed.app.spy.lifecycle.length === 1
      && fixed.app.spy.lifecycle[0].action === 'resolve',
      '(c) covered card still attempts the native lifecycle write');
  }

  // ── (d) the resolve-destination flow completes for the held population ────
  {
    // ONE open change-request + role smm => deferToChooser is true.
    const legacy = [legacyRow('Only note')];
    const app = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('Different note')] } },
      role: 'smm',
    }, SHIPPED);
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      status: 'Tweaks Needed', video_status: 'Tweaks Needed',
      video_comments: legacy.slice(), video_tweaks: JSON.stringify(legacy),
      comments: legacy.slice(), tweaks: JSON.stringify(legacy),
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    await app._calToggleCommentDone(legacy[0].id);

    ok(app.spy.chooser === 1, '(d) the resolve-destination chooser opened');
    const row = app._calCommentsFor(app.calState.posts[0], 'video')[0];
    ok(row && row.done === true, '(d) the change-request was marked done on the pick');
    ok(app.spy.autoStatus.length === 1 && app.spy.autoStatus[0].trigger === 'smm_resolved_last',
      '(d) _calApplyAutoStatus ran — the card can be routed onward');
    ok(app.spy.lifecycle.length === 0, '(d) no native write was attempted');

    const preLegacy = [legacyRow('Only note')];
    const pre = makeApp({
      deliverables: [DELIVERABLE],
      threads: { 'dlv-1': { items: [canonicalRow('Different note')] } },
      role: 'smm',
    }, REVERTED);
    pre.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      status: 'Tweaks Needed', video_status: 'Tweaks Needed',
      video_comments: preLegacy.slice(), video_tweaks: JSON.stringify(preLegacy),
      comments: preLegacy.slice(), tweaks: JSON.stringify(preLegacy),
    }];
    await pre._prodProjectCanonicalCardComments('calendar', 'card-1');
    await pre._calToggleCommentDone(preLegacy[0].id);
    ok(pre.spy.lifecycle.length === 1 && pre.spy.autoStatus.length === 0,
      '(d) TEETH: reverted, the refused write returns early and the card is left unroutable');
  }

  // ── the parse-shrink obligation, pinned by ORDER ──────────────────────────
  {
    // `_calResolveTweaksDone` has no read-completeness guard of its own: it
    // writes back whatever array the loader produced. The newly-held population
    // is safe only because `_prodLegacyReadIncomplete` is evaluated EARLIER in
    // the same pass and already held those cards. Pin that ordering — a
    // refactor that moves the coverage check above it would silently route
    // parse-shrunk cards into a write-back that drops the unread rows.
    const projection = extractFunction('_prodProjectCanonicalCardComments', SHIPPED);
    const incompleteAt = projection.indexOf('_prodLegacyReadIncomplete(');
    const coverageAt = projection.indexOf('_prodCanonicalCoversLegacy(projected, legacyRows)');
    ok(incompleteAt > 0 && coverageAt > 0 && incompleteAt < coverageAt,
      'ordering: the read-completeness guard is evaluated BEFORE the coverage hold');
    ok(!/_prodLegacyReadIncomplete/.test(extractFunction('_calResolveTweaksDone', SHIPPED)),
      'ordering: _calResolveTweaksDone still has no guard of its own — the order is what protects it');

    // And prove the earlier guard really does pre-empt: a card whose column
    // holds more rows than the loader parsed is held REGARDLESS of coverage.
    const parsed = [legacyRow('Parsed note')];
    const app = makeApp({
      deliverables: [DELIVERABLE],
      // Canonical fully covers what was PARSED, so only the read-completeness
      // guard can hold this card.
      threads: { 'dlv-1': { items: [canonicalRow('Parsed note')] } },
    }, SHIPPED);
    app.calState.posts = [{
      id: 'card-1', client: 'acme-co', video_deliverable_id: 'dlv-1',
      video_comments: parsed.slice(),
      // Three rows stored, one parsed: the other two are unread, not absent.
      video_tweaks: JSON.stringify([parsed[0], legacyRow('Unread A'), legacyRow('Unread B')]),
      comments: parsed.slice(),
    }];
    await app._prodProjectCanonicalCardComments('calendar', 'card-1');
    ok(app.calState.posts[0]._canonicalCommentReads['dlv-1'].status === 'legacy_retained',
      'ordering: a parse-shrunk column is held by the read guard before coverage is consulted');
    ok(app.calState.posts[0].video_comments.every(r => !r.canonical),
      'ordering: its stored column is never overwritten by the projection');
  }

  console.log(failures
    ? '\ncanonical coverage hold: ' + failures + ' FAILED'
    : '\ncanonical coverage hold checks passed');
  process.exit(failures ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
