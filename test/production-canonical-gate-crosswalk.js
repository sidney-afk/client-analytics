'use strict';

/*
 * Canonical comment gate — F42 crosswalk validity.
 *
 * Regression guard for the PR #937 projection writeback defect.
 *
 * Before this guard, `_prodCanonicalCommentGate` treated ANY card carrying a
 * deliverable id as linked. That is not what the F42 import means by linked:
 * `production_comment_card_import` (and its planner mirror,
 * scripts/f42-card-comment-import.js) accepts a comment only when the named
 * deliverable's origin/team/client_slug/card_id describe that exact card.
 *
 * Live measurement showed the failure is not hypothetical: of the deliverables
 * with origin='manual', ZERO carry a card_id, so every card-side-only link
 * write lands on a deliverable that fails the crosswalk. Such a card was
 * treated as linked, its canonical read came back legitimately EMPTY, and the
 * calendar projection wrote that empty array into the card through
 * `_calSetCommentsFor` — which also rewrites the `*_tweaks` wire string, so the
 * next save persisted the loss. Staff sessions included.
 *
 * These checks pin the four behaviours that fix it:
 *   1. crosswalk mismatch  -> not linked, legacy preserved
 *   2. crosswalk valid     -> linked, canonical-only (unchanged contract)
 *   3. unresolved / failed lookup -> not linked (fail safe, never destructive)
 *   4. an empty projection never overwrites non-empty legacy content
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const planner = fs.readFileSync(
  path.join(ROOT, 'scripts/f42-card-comment-import.js'),
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
    /* Comments are SKIPPED, not parsed. index.html comments are prose and
       contain apostrophes -- "the row's scope" -- which a quote-only scanner
       reads as an unterminated string, swallowing every brace after it and
       throwing `unclosed` for a function that balances perfectly. That error
       names the wrong thing and sends the reader hunting a syntax error that
       is not there. A brace or quote inside a comment is not code. */
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = brace; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (!quote && char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (!quote && char === '/' && next === '*') { blockComment = true; index++; continue; }
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

const browser = {
  console,
  _isClientLink: false,
  CAL_SUPABASE_URL: 'https://example.test',
  CAL_SUPABASE_ANON_KEY: 'anon-test-key',
  PROD_CROSSWALK_SURFACE_ORIGIN: { calendar: 'calendar', sxr: 'samples' },
  PROD_CROSSWALK_SELECT: 'id,client_slug,team,origin,card_id',
  PROD_EPHEMERAL_CANONICAL_KEYS: Object.freeze(['_canonicalCrosswalk', '_canonicalCommentReads']),
  _prodVerifiedClientCommentSurfaceContext: () => null,
  _prodClientCommentSurfaceKey: value => (value ? JSON.stringify(value) : ''),
  _prodCardClientCommentSurfaceKnown: () => false,
  _calStringifyComments: list => JSON.stringify(list || []),
  _sxrStringifyComments: list => JSON.stringify(list || []),
};
vm.createContext(browser);
vm.runInContext([
  // _writeUiNativeId now asks _writeUiComponentHasWorkItem whether the
  // component owns a deliverable at all (caption/title do not), so the real
  // predicate has to be in the sandbox with it. OPEN_REPAIRS 127.
  extractFunction('_writeUiComponentHasWorkItem'),
  extractFunction('_writeUiNativeId'),
  extractFunction('_prodCrosswalkTeamForComponent'),
  extractFunction('_prodCrosswalkCardSlug'),
  extractFunction('_prodCrosswalkMismatchFields'),
  extractFunction('_prodCrosswalkKey'),
  extractFunction('_prodCrosswalkVerdict'),
  extractFunction('_prodCrosswalkSetVerdict'),
  extractFunction('_prodStripEphemeralCanonicalState'),
  extractFunction('_prodStripEphemeralCanonicalPosts'),
  extractFunction('_prodCommentProvenanceKey'),
  extractFunction('_prodCanonicalCoversLegacy'),
  extractFunction('_prodFetchCrosswalkRows'),
  extractFunction('_prodCardBindingToken'),
  extractFunction('_prodResolveCardCrosswalk'),
  extractFunction('_prodCanonicalCommentGate'),
  extractFunction('_calSetCommentsFor'),
  extractFunction('_calCommentsFor'),
].join('\n'), browser);

const LEGACY = [
  { id: 'legacy-1', role: 'client', audience: 'client', body: 'Please recut the intro', created_at: '2026-07-20T00:00:00Z' },
  { id: 'legacy-2', parent_id: 'legacy-1', role: 'smm', body: 'On it', created_at: '2026-07-20T00:05:00Z' },
];

function calendarCard(extra) {
  return Object.assign({
    id: 'cal-card-1',
    client: 'acme-co',
    video_deliverable_id: 'dlv-video-1',
    video_comments: LEGACY.slice(),
    video_tweaks: JSON.stringify(LEGACY),
    comments: LEGACY.slice(),
    tweaks: JSON.stringify(LEGACY),
  }, extra || {});
}

(async () => {
  console.log('Canonical gate — F42 crosswalk validity\n');

  // ---------------------------------------------------------------- planner parity
  const plannerFields = planner.slice(
    planner.indexOf('function deliverableCrosswalkIssues'),
    planner.indexOf('function nulByteConflicts'),
  );
  ok(/clean\(deliverable\.origin\)\.toLowerCase\(\) !== expectedOrigin/.test(plannerFields)
    && /clean\(deliverable\.team\)\.toLowerCase\(\) !== expectedTeam/.test(plannerFields)
    && /clean\(deliverable\.client_slug\) !== clean\(scope\.clientSlug\)/.test(plannerFields)
    && /clean\(deliverable\.card_id\) !== clean\(scope\.cardId\)/.test(plannerFields),
  'planner still compares origin/team case-insensitively and client_slug/card_id exactly');

  const browserFields = extractFunction('_prodCrosswalkMismatchFields');
  ok(/low\(deliverable && deliverable\.origin\) !== expectedOrigin/.test(browserFields)
    && /low\(deliverable && deliverable\.team\)/.test(browserFields)
    && /exact\(deliverable && deliverable\.client_slug\) !== _prodCrosswalkCardSlug\(post\)/.test(browserFields)
    && /exact\(deliverable && deliverable\.card_id\) !== exact\(post && post\.id\)/.test(browserFields),
  'the browser gate mirrors those four comparisons with the same case rules');

  // Surface -> origin mapping must match the planner's SURFACE_ORIGIN exactly.
  ok(/SURFACE_ORIGIN = Object\.freeze\(\{ calendar: 'calendar', sxr: 'samples' \}\)/.test(planner)
    && browser.PROD_CROSSWALK_SURFACE_ORIGIN.calendar === 'calendar'
    && browser.PROD_CROSSWALK_SURFACE_ORIGIN.sxr === 'samples',
  'surface->origin mapping matches the planner (calendar->calendar, sxr->samples)');

  // ---------------------------------------------------------------- field detection
  const card = calendarCard();
  const matching = { id: 'dlv-video-1', client_slug: 'acme-co', team: 'VIDEO', origin: 'Calendar', card_id: 'cal-card-1' };
  ok(browser._prodCrosswalkMismatchFields(matching, 'calendar', card, 'video').length === 0,
    'a matching deliverable yields no mismatching fields (origin/team compare case-insensitively)');

  const manualResidue = { id: 'dlv-video-1', client_slug: 'acme-co', team: 'video', origin: 'manual', card_id: null };
  ok(JSON.stringify(browser._prodCrosswalkMismatchFields(manualResidue, 'calendar', card, 'video'))
    === JSON.stringify(['card_id', 'origin']),
  'an origin=manual/card_id=NULL deliverable reports exactly card_id+origin (the b3 card-side-only residue)');

  const teamSwap = { id: 'dlv-gra-1', client_slug: 'acme-co', team: 'video', origin: 'calendar', card_id: 'cal-card-1' };
  ok(JSON.stringify(browser._prodCrosswalkMismatchFields(teamSwap, 'calendar', card, 'graphic'))
    === JSON.stringify(['team']),
  'a kind/team-inconsistent deliverable in the graphic slot reports exactly team');

  const otherCard = { id: 'dlv-video-1', client_slug: 'acme-co', team: 'video', origin: 'calendar', card_id: 'cal-card-9' };
  ok(JSON.stringify(browser._prodCrosswalkMismatchFields(otherCard, 'calendar', card, 'video'))
    === JSON.stringify(['card_id']),
  'a deliverable bound to a different card reports exactly card_id');

  // client_slug falls back to `client`, matching the planner's row.client_slug || row.client
  ok(browser._prodCrosswalkCardSlug({ client: 'acme-co' }) === 'acme-co'
    && browser._prodCrosswalkCardSlug({ client_slug: 'preferred', client: 'acme-co' }) === 'preferred',
  'card slug resolves client_slug first, then client (planner parity)');

  // ---------------------------------------------------------------- THE WIPE
  // Linked card + crosswalk-invalid deliverable + empty canonical thread.
  const wipeCard = calendarCard();
  browser.fetch = async () => ({
    ok: true,
    json: async () => [manualResidue],
  });
  const validComponents = await browser._prodResolveCardCrosswalk('calendar', wipeCard, ['video']);

  ok(validComponents.size === 0,
    'a crosswalk-invalid link yields NO valid components, so nothing is projected');
  const wipeGate = browser._prodCanonicalCommentGate(wipeCard, 'video');
  ok(wipeGate.linked === false && wipeGate.status === 'crosswalk_mismatch',
    'REGRESSION: the card is NOT linked, so the client falls back to legacy rendering');

  // The defect itself: had the projection run, this is what it would have done.
  const control = calendarCard();
  browser._calSetCommentsFor(control, 'video', []);
  ok(control.video_comments.length === 0
    && control.video_tweaks === '[]'
    && control.tweaks === '[]',
  'CONTROL: _calSetCommentsFor with an empty projection does zero the array AND both wire strings');

  ok(wipeCard.video_comments.length === 2
    && wipeCard.video_tweaks === JSON.stringify(LEGACY)
    && wipeCard.tweaks === JSON.stringify(LEGACY),
  'REGRESSION: the invalid-link card keeps its legacy array and both wire strings byte-identical');

  // ---------------------------------------------------------------- valid link
  const validCard = calendarCard({ id: 'cal-card-1' });
  browser.fetch = async () => ({ ok: true, json: async () => [matching] });
  const validSet = await browser._prodResolveCardCrosswalk('calendar', validCard, ['video']);
  ok(validSet.has('video'), 'a crosswalk-valid link resolves the component as projectable');

  validCard._canonicalCommentReads = {
    'dlv-video-1': { status: 'ready', client: true, clientSurface: null },
  };
  const validGate = browser._prodCanonicalCommentGate(validCard, 'video');
  ok(validGate.linked === true && validGate.ready === true,
    'a crosswalk-VALID linked card is still linked and ready — the canonical contract is unchanged');

  // ---------------------------------------------------------------- fail safe
  const absentCard = calendarCard();
  browser.fetch = async () => ({ ok: true, json: async () => [] });
  await browser._prodResolveCardCrosswalk('calendar', absentCard, ['video']);
  const absentGate = browser._prodCanonicalCommentGate(absentCard, 'video');
  ok(absentGate.linked === false && absentGate.status === 'crosswalk_absent'
    && absentCard.video_tweaks === JSON.stringify(LEGACY),
  'a deliverable id with no matching row is NOT linked and leaves legacy intact');

  const errorCard = calendarCard();
  browser.fetch = async () => ({ ok: false, json: async () => null });
  await browser._prodResolveCardCrosswalk('calendar', errorCard, ['video']);
  const errorGate = browser._prodCanonicalCommentGate(errorCard, 'video');
  ok(errorGate.linked === false && errorGate.status === 'crosswalk_error'
    && errorCard.video_tweaks === JSON.stringify(LEGACY),
  'an HTTP failure is NOT linked (fail safe) and leaves legacy intact');

  const throwCard = calendarCard();
  browser.fetch = async () => { throw new Error('network down'); };
  await browser._prodResolveCardCrosswalk('calendar', throwCard, ['video']);
  ok(browser._prodCanonicalCommentGate(throwCard, 'video').linked === false
    && throwCard.video_tweaks === JSON.stringify(LEGACY),
  'a thrown fetch is NOT linked and leaves legacy intact');

  const unresolvedCard = calendarCard();
  const unresolvedGate = browser._prodCanonicalCommentGate(unresolvedCard, 'video');
  ok(unresolvedGate.linked === false && unresolvedGate.status === 'crosswalk_unresolved',
    'a card whose crosswalk has never been resolved is NOT linked (unknown is never destructive)');

  const unlinkedCard = calendarCard({ video_deliverable_id: '' });
  ok(browser._prodCanonicalCommentGate(unlinkedCard, 'video').status === 'unlinked',
    'a card with no deliverable id still reports the plain unlinked status');

  // ---------------------------------------------------------------- R1 provenance invariant
  const legacyRows = [
    { id: 'l1', body: 'Please recut the intro', author_key: 'client:acme', created_at: '2026-07-20T00:00:00Z' },
    { id: 'l2', body: 'On it', author_key: 'smm:pat', created_at: '2026-07-20T00:05:00Z' },
  ];
  const canonicalSame = legacyRows.map(row => ({
    id: 'canon-' + row.id, canonical: true,
    body: row.body, author_key: row.author_key, source_created_at: row.created_at,
  }));

  ok(browser._prodCanonicalCoversLegacy(canonicalSame, legacyRows) === true,
    'canonical that contains every legacy message covers it (replacement is lossless)');
  ok(browser._prodCanonicalCoversLegacy(canonicalSame.concat([
    { id: 'canon-new', body: 'Extra reply', author_key: 'smm:pat', source_created_at: '2026-07-21T00:00:00Z' },
  ]), legacyRows) === true,
  'canonical that is a strict superset of legacy still covers it');
  ok(browser._prodCanonicalCoversLegacy([], legacyRows) === false,
    'an EMPTY canonical thread does not cover non-empty legacy');
  ok(browser._prodCanonicalCoversLegacy([
    { id: 'canon-new', body: 'Fresh reply nobody imported', author_key: 'smm:pat', source_created_at: '2026-07-21T00:00:00Z' },
  ], legacyRows) === false,
  'REGRESSION R1: ONE unrelated canonical row does NOT cover legacy — the empty-only guard was insufficient');
  ok(browser._prodCanonicalCoversLegacy(canonicalSame.slice(0, 1), legacyRows) === false,
    'a partially-imported thread (one of two legacy rows present) does not cover legacy');
  ok(browser._prodCanonicalCoversLegacy([], []) === true,
    'an empty canonical trivially covers empty legacy');
  // Field-SHAPE tolerant (body/text, author_key/author, created_at/at) but
  // content-EXACT: case-folding and whitespace collapsing made materially
  // different messages compare equal, in the direction that permits a lossy
  // replacement, so both were removed.
  ok(browser._prodCommentProvenanceKey({ body: 'Hello World', author_key: 'A', created_at: 't' })
    === browser._prodCommentProvenanceKey({ text: 'Hello World', author: 'A', at: 't' }),
  'provenance matching is field-shape tolerant for identical content');
  ok(browser._prodCommentProvenanceKey({ body: 'Approved', author_key: 'A', created_at: 't' })
    !== browser._prodCommentProvenanceKey({ body: 'approved', author_key: 'A', created_at: 't' }),
  'REGRESSION G2: case-differing bodies are DIFFERENT messages');
  ok(browser._prodCommentProvenanceKey({ body: 'one\ntwo', author_key: 'A', created_at: 't' })
    !== browser._prodCommentProvenanceKey({ body: 'one two', author_key: 'A', created_at: 't' }),
  'REGRESSION G2: line breaks are content, not noise');
  ok(browser._prodCommentProvenanceKey({ body: 'a', author_key: 'x', created_at: 't1' })
    !== browser._prodCommentProvenanceKey({ body: 'a', author_key: 'x', created_at: 't2' }),
  'the same body from the same author at a different time is a different message');

  // Field-boundary collision. `body` is whitespace-normalised and may contain
  // spaces, so any separator that can occur inside a field lets the boundary
  // shift without changing the key. The dangerous direction is that it marks a
  // legacy row COVERED by canonical content that does not contain it — which
  // PERMITS the very overwrite the invariant exists to prevent.
  ok(browser._prodCommentProvenanceKey({ body: 'ab c', author_key: 'd', created_at: 't' })
    !== browser._prodCommentProvenanceKey({ body: 'ab', author_key: 'c d', created_at: 't' }),
  'REGRESSION: a shifted field boundary does NOT produce the same provenance key');
  ok(browser._prodCommentProvenanceKey({ body: 'ab', author_key: 'c', created_at: 't' })
    !== browser._prodCommentProvenanceKey({ body: 'a', author_key: 'bc', created_at: 't' }),
  'REGRESSION: the empty-separator collision (body "ab"+author "c" vs "a"+"bc") is closed');
  ok(browser._prodCanonicalCoversLegacy(
    [{ body: 'ab c', author_key: 'd', source_created_at: 't' }],
    [{ body: 'ab', author_key: 'c d', created_at: 't' }],
  ) === false,
  'REGRESSION: a boundary-collision row is NOT accepted as covering a different legacy row');

  // Injective by CONSTRUCTION rather than by a delimiter assumption: a hand-
  // joined key is only safe while no field can contain the delimiter, which is
  // an unenforced claim about data. JSON.stringify escapes whatever a field
  // holds.
  ok(/return JSON\.stringify\(\[body, author, when\]\);/.test(source),
    'REGRESSION G3: the provenance key is built with JSON.stringify, not a hand-joined delimiter');
  ok(browser._prodCommentProvenanceKey({ body: 'a', author_key: String.fromCharCode(1) + 'b', created_at: 't' })
    !== browser._prodCommentProvenanceKey({ body: 'a' + String.fromCharCode(1), author_key: 'b', created_at: 't' }),
  'REGRESSION G3: a control character inside a field cannot forge a field boundary');
  ok(!source.includes(String.fromCharCode(0)),
    'index.html contains no raw NUL byte (it must stay a text file to git and grep)');

  // ---------------------------------------------------------------- R2 component-keyed cache
  const twoSlot = calendarCard({ video_deliverable_id: 'dlv-shared', graphic_deliverable_id: 'dlv-shared' });
  browser._prodCrosswalkSetVerdict(twoSlot, 'dlv-shared', 'video', { state: 'valid', fields: [] });
  ok(browser._prodCrosswalkVerdict(twoSlot, 'dlv-shared', 'video').state === 'valid'
    && browser._prodCrosswalkVerdict(twoSlot, 'dlv-shared', 'graphic') === null,
  'REGRESSION R2: a verdict earned in the video slot does NOT cross-validate the graphic slot');
  ok(browser._prodCanonicalCommentGate(twoSlot, 'graphic').linked === false
    && browser._prodCanonicalCommentGate(twoSlot, 'video').linked === true,
  'the gate reads the component-keyed verdict, so one id in two slots is judged per slot');

  // ---------------------------------------------------------------- R3 cache stripping
  const cached = browser._prodStripEphemeralCanonicalState({
    id: 'c1', video_comments: legacyRows,
    _canonicalCrosswalk: { 'video|dlv-1': { state: 'valid' } },
    _canonicalCommentReads: { 'dlv-1': { status: 'ready' } },
  });
  ok(!('_canonicalCrosswalk' in cached) && !('_canonicalCommentReads' in cached)
    && cached.video_comments === legacyRows && cached.id === 'c1',
  'REGRESSION R3: ephemeral canonical state is stripped for serialization, real card fields survive');
  const source_ = { id: 'c2', _canonicalCrosswalk: { x: 1 } };
  browser._prodStripEphemeralCanonicalState(source_);
  ok('_canonicalCrosswalk' in source_,
    'stripping copies rather than mutating the live post (the session keeps its verdicts)');
  ok(browser._prodStripEphemeralCanonicalPosts([source_, null]).length === 2,
    'the list form tolerates holes');
  const calWrite = source.slice(source.indexOf('function _calCacheWrite'), source.indexOf('function _calCacheBustThumb'));
  const sxrWrite = source.slice(source.indexOf('function _sxrCacheWrite'), source.indexOf('function _sxrIsArchivedRef'));
  ok(/_prodStripEphemeralCanonicalPosts\(durablePosts\)/.test(calWrite)
    && /_prodStripEphemeralCanonicalPosts\(live\)/.test(sxrWrite),
  'both 7-day card caches strip the ephemeral canonical state before serializing');

  // ---------------------------------------------------------------- R4 generation binding
  const tokenCard = calendarCard();
  const t1 = browser._prodCardBindingToken('calendar', tokenCard, ['video']);
  ok(t1 === browser._prodCardBindingToken('calendar', tokenCard, ['video']),
    'the binding token is stable for an unchanged card');
  ok(t1 !== browser._prodCardBindingToken('calendar',
    calendarCard({ video_deliverable_id: 'dlv-other' }), ['video']),
  're-pointing the card changes the binding token');
  ok(t1 !== browser._prodCardBindingToken('calendar', calendarCard({ id: 'other-card' }), ['video']),
    'switching to another card changes the binding token');

  const raceCard = calendarCard();
  browser.fetch = async () => {
    // The binding moves while the crosswalk lookup is in flight.
    raceCard.video_deliverable_id = 'dlv-repointed';
    return { ok: true, json: async () => [matching] };
  };
  const raced = await browser._prodResolveCardCrosswalk('calendar', raceCard, ['video']);
  ok(raced === null && !raceCard._canonicalCrosswalk,
    'REGRESSION R4: a binding change during the lookup aborts and stamps NO verdict');

  // ---------------------------------------------------------------- projection wiring
  const projection = source.slice(
    source.indexOf('async function _prodProjectCanonicalCardComments'),
    source.indexOf('function _prodCanonicalCommentGate'),
  );
  ok(/const validComponents = await _prodResolveCardCrosswalk\(surface, post, allComponents\)/.test(projection)
    && /allComponents\.filter\(component => validComponents\.has\(component\)\)/.test(projection),
  'the projection resolves the crosswalk first and only projects validated components');
  ok(/if \(validComponents === null\) return false;/.test(projection)
    && (projection.match(/_prodCardBindingToken\(surface, post, allComponents\) !== bindingToken/g) || []).length >= 2,
  'R4: the projection aborts on an aborted resolve and re-checks the token after the canonical read');
  // The refusal must also HOLD the read. A bare `return` here still protected
  // legacy storage — the setter was skipped — but left `clientLegacyHeld`
  // false, so the deliverable was stamped `ready` and the gate then answered
  // linked+ready for a card whose LEGACY rows are what renders. Mark-done
  // routes on `linked`, so it took the canonical branch and died at the CAS
  // guard. Behavioural coverage: test/canonical-coverage-hold-routes-legacy.js.
  ok(/if \(!_prodCanonicalCoversLegacy\(projected, legacyRows\)\) \{\s*clientLegacyHeld = true;\s*return;\s*\}/.test(projection),
    'R1: legacy storage is written only when canonical demonstrably covers it, '
    + 'and the refusal holds the read instead of reporting ready');
  ok(/_prodLegacyReadIncomplete\(post, component, legacyRows, surface\)/.test(projection)
    && /_prodLegacyUnrepresentableState\(legacyRows\)\.length/.test(projection),
  'an unread column, or legacy state the canonical shape cannot represent, blocks the write on both paths');
  ok(/const writesLegacy = calendar \|\| !_isClientLink;/.test(projection),
    'the guard is scoped to the paths that write legacy storage, not the client canonical slot');
  ok(/clientLegacyHeld = true;/.test(projection) && /status: 'legacy_retained'/.test(projection),
    'R5: the client SXR path holds the read back instead of projecting an empty thread');

  // ---------------------------------------------------------------- R5 gate behaviour
  const heldCard = calendarCard({ video_deliverable_id: 'dlv-video-1' });
  browser._prodCrosswalkSetVerdict(heldCard, 'dlv-video-1', 'video', { state: 'valid', fields: [] });
  heldCard._canonicalCommentReads = { 'dlv-video-1': { status: 'legacy_retained', client: false } };
  const heldGate = browser._prodCanonicalCommentGate(heldCard, 'video');
  ok(heldGate.linked === false && heldGate.status === 'legacy_retained',
    'REGRESSION R5: a held-back thread reports NOT linked, so the reader keeps showing legacy comments');

  // ---------------------------------------------------------------- R6 importer parity
  const importer = require('fs').readFileSync(
    path.join(ROOT, 'scripts/f42-card-comment-import.js'), 'utf8',
  );
  ok(/const sourceClientSlug = clean\(row && \(row\.client_slug \|\| row\.client\)\);/.test(importer),
    'REGRESSION R6: the importer derives client_slug ONLY from the card row, with no operator fallback');
  ok(/client_slug_fallback_not_supported/.test(importer),
    'R6: passing --client-slug is an explicit error rather than a silent parity break');
  ok(browser._prodCrosswalkCardSlug({ client: 'acme-co' }) === 'acme-co',
    'R6: the browser derives the same slug the importer now does (client_slug || client)');

  if (failures) {
    console.error(`\n${failures} canonical gate crosswalk check(s) failed`);
    process.exit(1);
  }
  console.log('\nCanonical gate crosswalk checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
