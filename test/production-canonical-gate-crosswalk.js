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

const browser = {
  console,
  _isClientLink: false,
  CAL_SUPABASE_URL: 'https://example.test',
  CAL_SUPABASE_ANON_KEY: 'anon-test-key',
  PROD_CROSSWALK_SURFACE_ORIGIN: { calendar: 'calendar', sxr: 'samples' },
  PROD_CROSSWALK_SELECT: 'id,client_slug,team,origin,card_id',
  _prodVerifiedClientCommentSurfaceContext: () => null,
  _prodClientCommentSurfaceKey: value => (value ? JSON.stringify(value) : ''),
  _prodCardClientCommentSurfaceKnown: () => false,
  _calStringifyComments: list => JSON.stringify(list || []),
  _sxrStringifyComments: list => JSON.stringify(list || []),
};
vm.createContext(browser);
vm.runInContext([
  extractFunction('_writeUiNativeId'),
  extractFunction('_prodCrosswalkTeamForComponent'),
  extractFunction('_prodCrosswalkCardSlug'),
  extractFunction('_prodCrosswalkMismatchFields'),
  extractFunction('_prodCrosswalkVerdict'),
  extractFunction('_prodCrosswalkSetVerdict'),
  extractFunction('_prodFetchCrosswalkRows'),
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

  // ---------------------------------------------------------------- empty-over-legacy guard
  const projection = source.slice(
    source.indexOf('async function _prodProjectCanonicalCardComments'),
    source.indexOf('function _prodCanonicalCommentGate'),
  );
  ok(/const validComponents = await _prodResolveCardCrosswalk\(surface, post, allComponents\)/.test(projection)
    && /allComponents\.filter\(component => validComponents\.has\(component\)\)/.test(projection),
  'the projection resolves the crosswalk first and only projects validated components');
  ok(/if \(!projected\.length && writesLegacy\)/.test(projection)
    && /if \(Array\.isArray\(legacy\) && legacy\.length\) return;/.test(projection),
  'an empty projection never overwrites non-empty legacy content (caption/title fan-out guard)');
  ok(/const writesLegacy = calendar \|\| !_isClientLink;/.test(projection),
    'the guard is scoped to the paths that write legacy storage, not the client canonical slot');

  if (failures) {
    console.error(`\n${failures} canonical gate crosswalk check(s) failed`);
    process.exit(1);
  }
  console.log('\nCanonical gate crosswalk checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
