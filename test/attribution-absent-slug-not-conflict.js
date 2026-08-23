'use strict';

/*
 * An ABSENT persisted client slug is missing evidence, not contradicting
 * evidence.
 *
 * `_prodResolveAttributions` compares the slug the deliverable was resolved to
 * LAST time against the slug today's project mapping produces, and calls a
 * mismatch a conflict. The store always writes a slug beside
 * `state: 'resolved'`, so an empty one never comes from the store -- it comes
 * from the read path. The projection view gates `raw_attribution_client_slug`
 * behind a slug regex and returns NULL when a real roster slug fails it, while
 * passing `d.client_slug` through unfiltered a few columns away. One active
 * roster slug carries a character that regex rejects, so all 147 of that
 * client's rows arrived with `resolved` and no slug, each was declared
 * `persisted_resolved_client_disagrees_with_current_mapping`, and the family
 * fixpoint then poisoned every relative. 147 of the 176 "Client attribution
 * conflict" banners in the app were that one regex, and all 147 rows were
 * read-only and mis-grouped because of it.
 *
 * This suite is deliberately data-driven and executes the real function out of
 * the shipped file: a source scan would pass on a comment. The three cases are
 * the ones that matter -- the projection drops the slug and the row survives;
 * the slug is present and genuinely different, so the conflict is still raised;
 * and the drop does not leak into the neighbouring explicit-proof branch.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/*
 * Comment-aware, because the block this extracts carries prose with quote
 * characters in it. A scanner that treats an apostrophe in a `//` line as a
 * string opener runs off the end of the function and takes the rest of the file
 * with it -- which is exactly how test/production-write-ui-source.js once
 * returned a million characters.
 */
function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let comment = '';
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (comment === 'line') { if (char === '\n') comment = ''; continue; }
    if (comment === 'block') { if (char === '*' && next === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { comment = 'line'; i++; continue; }
    if (char === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

const sandbox = { Map, Set, String, Array, Object, JSON, Boolean };
vm.createContext(sandbox);
for (const name of ['_prodHasOwn', '_prodLinearRaw', '_prodConfiguredProjectIds', '_prodRawProjectId', '_prodRawAttribution', '_prodResolveAttributions']) {
  vm.runInContext(extractFunction(name), sandbox);
}
vm.runInContext('this.resolve = _prodResolveAttributions;', sandbox);
const resolve = sandbox.resolve;

const PROJECT = 'project-with-an-owner';
const CLIENTS = [{ slug: 'roster-slug', active: true, kind: 'client', linear_project_ids: [PROJECT] }];

function deliverable(overrides) {
  return Object.assign({
    id: 'del-1',
    client_slug: 'roster-slug',
    raw_project_id: PROJECT,
    raw_attribution_schema: 'syncview_attribution_v1',
    raw_attribution_state: 'resolved',
    raw_attribution_source: 'direct_project',
    raw_attribution_client_slug: 'roster-slug',
  }, overrides || {});
}

const run = row => resolve([row], CLIENTS, new Map()).get(row.id);

// --- 1. the bug -------------------------------------------------------------
const dropped = run(deliverable({ raw_attribution_client_slug: null }));
ok(dropped.state === 'resolved',
  'a row whose persisted slug the read path dropped is still RESOLVED, not a conflict');
ok(dropped.clientSlug === 'roster-slug',
  'and is grouped under the client the project mapping actually names');
ok(dropped.reason === 'persisted_client_slug_unavailable_in_read_path',
  'and says the read path is what is missing, so the fix does not become invisible');

const droppedEmpty = run(deliverable({ raw_attribution_client_slug: '' }));
ok(droppedEmpty.state === 'resolved',
  'an empty string reads the same as a NULL — both are the view returning nothing');

// --- 2. the check that must SURVIVE the fix ---------------------------------
// A real, present, different slug is real contradicting evidence. If this stops
// raising a conflict the fix has been widened into a hole.
const genuine = run(deliverable({ raw_attribution_client_slug: 'a-different-client' }));
ok(genuine.state === 'conflict' && genuine.reason === 'persisted_resolved_client_disagrees_with_current_mapping',
  'a persisted slug that is PRESENT and different is still a conflict — evidence, not absence');

// --- 3. no leak into the neighbouring branch --------------------------------
// The explicit-proof arm derives `persistedActive` from the same empty slug and
// would otherwise fall to `persisted_resolution_is_not_currently_verifiable`.
// Inert today (no explicitly-classified row carries the affected slug) and this
// keeps it that way.
const explicitDropped = run(deliverable({
  raw_attribution_client_slug: null,
  raw_attribution_source: 'explicit_roster_classification',
  raw_attribution_owner_kind: 'client',
  raw_attribution_explicit_owner_approved: true,
  raw_attribution_has_explicit_decision_ref: true,
  raw_attribution_explicit_manifest_sha256: 'a'.repeat(64),
}));
ok(explicitDropped.state === 'resolved',
  'an explicitly-classified row with the same dropped slug is not stranded either');

// --- 4. absence with nothing to fall back on is NEEDS, never CONFLICT -------
const noMapping = run(deliverable({ raw_attribution_client_slug: null, raw_project_id: 'project-nobody-owns' }));
ok(noMapping.state === 'needs_attribution',
  'with no mapping to fall back on the row needs attribution — an unknown is not a contradiction');
ok(noMapping.reason === 'persisted_client_slug_unavailable_in_read_path',
  'and still names the read path rather than blaming the mapping');

// --- 5. the family fixpoint is what made this expensive ----------------------
// One poisoned row propagates `hierarchy_conflict_propagated` to every relative,
// which is why 147 rows became 147 read-only rows rather than 147 odd banners.
const parent = deliverable({ id: 'del-parent', linear_issue_uuid: 'uuid-parent', raw_attribution_client_slug: null });
const child = deliverable({ id: 'del-child', raw_issue_parent_id: 'uuid-parent', raw_attribution_client_slug: null });
const family = resolve([parent, child], CLIENTS, new Map([['del-child', 'del-parent']]));
ok(family.get('del-parent').state === 'resolved' && family.get('del-child').state === 'resolved',
  'and a whole family of dropped-slug rows resolves cleanly instead of poisoning each other');

if (failures) {
  console.error('\n' + failures + ' attribution absent-slug check(s) failed');
  process.exit(1);
}
console.log('\nAttribution absent-slug checks passed');
