'use strict';

/*
 * TWO IMPLEMENTATIONS OF ONE AUTHORITY, PROVEN EQUAL.
 *
 * `configuredProjectIds` (scripts/f200-attribution.js) decides which Linear
 * projects the roster maps. The reconciler, B1 and every attribution path use
 * it. `production-write` must compute its intake stamp under the SAME rule,
 * because that stamp is compared against the reconciler's output — but an Edge
 * Function cannot import from `scripts/`, so the logic is mirrored into
 * `policy.mjs` as `attributionProjectIds`.
 *
 * Duplication that can drift is the exact hazard this whole line of work has
 * been about: two authorities over one roster cell already produced a permanent
 * per-row diff once. This file makes the duplication safe by running both
 * implementations over a shared corpus and failing if they ever disagree —
 * including on shapes nobody has written down yet.
 *
 * If this test fails, do not "fix" one side to match the other. Work out which
 * rule is correct, change that one, and let this test confirm the other follows.
 */

const { configuredProjectIds } = require('../scripts/f200-attribution');
const {
  attributionProjectIds,
  projectIdsForTeam,
} = require('../supabase/functions/production-write/policy.mjs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

/*
 * Every shape the reader documents, every shape seen in the live roster, and
 * the malformed ones that must degrade rather than throw.
 */
const CORPUS = [
  ['null', null],
  ['undefined', undefined],
  ['empty object', {}],
  ['empty string', ''],
  ['canonical both teams', { video: A, graphics: B }],
  ['aliases', { vid: A, gra: B }],
  ['thumbnail alias', { thumbnail: A }],
  ['object form', { video: { id: A }, graphics: { project_id: B } }],
  ['linear_project_id key', { video: { linear_project_id: A } }],
  // The live shape that started all of this: an id under no team key.
  ['untagged bare id', { id: A }],
  ['untagged plus teamed', { id: C, video: A }],
  ['projects wrapper', { projects: [{ id: A }, { project_id: B }] }],
  ['array of strings', [A, B]],
  ['array of objects', [{ id: A }, { linear_project_id: B }]],
  ['json string', JSON.stringify({ video: A, graphics: B })],
  ['bare string id', A],
  ['unknown keys only', { notes: 'see Linear', owner: 'someone' }],
  ['team key with array value', { video: [A, B] }],
  ['team key with null', { video: null }],
  ['nested metadata under a team key', { video: { meta: { id: A } } }],
  ['numeric value', { video: 12345 }],
  ['whitespace padded', { video: `  ${A}  ` }],
  ['duplicate across shapes', { id: A, video: A, projects: [{ id: A }] }],
  ['mixed case keys', { VIDEO: A, Graphics: B }],
];

console.log('the Edge Function and the reconciler agree on every roster shape');
for (const [label, value] of CORPUS) {
  let node;
  let edge;
  let threw = '';
  try {
    node = configuredProjectIds(value);
  } catch (error) {
    threw = `scripts threw: ${error && error.message}`;
  }
  try {
    edge = attributionProjectIds(value);
  } catch (error) {
    threw = threw || `policy threw: ${error && error.message}`;
  }
  if (threw) {
    ok(false, `${label}: ${threw}`);
    continue;
  }
  ok(JSON.stringify(node) === JSON.stringify(edge),
    `${label}: ${JSON.stringify(node)} === ${JSON.stringify(edge)}`);
}

/*
 * The two rules are DIFFERENT on purpose, and that difference must stay
 * visible. If someone later "unifies" them, this fails and forces the
 * conversation rather than silently loosening an intake guard.
 */
console.log('the intake rule remains deliberately stricter than the attribution rule');
{
  const untagged = { id: A };
  ok(attributionProjectIds(untagged).includes(A),
    'attribution maps an untagged id — team-key-blind, as buildProjectIndex is');
  ok(projectIdsForTeam(untagged, 'video').length === 0,
    'intake refuses to route on an untagged id — it will not guess a team');
  ok(projectIdsForTeam({ video: A }, 'video').length === 1
    && attributionProjectIds({ video: A }).includes(A),
    'and both accept the canonical team-tagged shape');
}

console.log('the mirrored copy is documented as a mirror');
{
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'supabase', 'functions', 'production-write', 'policy.mjs'),
    'utf8');
  ok(/mirrored from `scripts\/f200-attribution\.js`/.test(source),
    'policy.mjs names the source it mirrors, so the next reader knows both exist');
  ok(/attribution-project-ids-parity/.test(source),
    'and points at the test that holds them together');
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nattribution project-id parity: all checks passed');
