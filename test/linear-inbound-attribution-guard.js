'use strict';

/*
 * The inbound attribution guard, tested against the real source.
 *
 * Background: invalidating the client on ANY project/parent change was too
 * blunt. Our own mirror re-parents a thumbnail onto its weekly batch card as
 * routine housekeeping, and that housekeeping was clearing the owner -- two of
 * a live client's finished thumbnails sat unattributed for ten days. The guard
 * keeps the client when only the PARENT moved AND the issue carries its own
 * project. Everything else still invalidates, including a re-parent of a
 * project-less issue, which really does inherit from its ancestor.
 *
 * Extracted and run against the deployed file so the test cannot drift away
 * from what actually ships.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INBOUND = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/linear-inbound/index.ts'),
  'utf8',
);

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('PASS:', message);
  else {
    failures++;
    console.error('FAIL linear-inbound-attribution-guard:', message);
  }
}

function extract(signature) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = INBOUND.match(new RegExp(`function ${escaped}\\([^]*?\\n\\}`));
  if (!source) throw new Error(`missing ${signature}`);
  return source[0];
}

const context = {
  clean: value => String(value == null ? '' : value).trim(),
  objectAt: value => (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  ),
};
vm.createContext(context);
vm.runInContext(
  extract('attributionStillCertain').replace(
    /function attributionStillCertain\([^\n]+\): boolean \{/,
    'function attributionStillCertain(issue, fields) {',
  ),
  context,
);
vm.runInContext(
  extract('payloadAttributionChangeFields').replace(
    /function payloadAttributionChangeFields\([^\n]+\): string\[\] \{/,
    'function payloadAttributionChangeFields(payload) {',
  ),
  context,
);

const { attributionStillCertain, payloadAttributionChangeFields } = context;

// The exact shape the guard has to answer for: a webhook where the only thing
// that moved is the parent, on an issue that has a project of its own.
const withProject = {
  identifier: 'GRA-7068',
  project: { id: '7657353b-78a2-4f9b-8d1f-f18cea028222', name: 'A Client' },
  projectId: '7657353b-78a2-4f9b-8d1f-f18cea028222',
  parentId: '96bf31d0-94cc-4e99-ac26-1b918abf245f',
};
const withoutProject = { identifier: 'GRA-9999', parentId: 'batch-card-uuid' };

function fieldsFor(updatedFrom) {
  return payloadAttributionChangeFields({ action: 'update', updatedFrom });
}

// --- retained: our own mirror's batch re-parent -------------------------------
ok(
  attributionStillCertain(withProject, fieldsFor({ parentId: null })) === true,
  'parentId-only move on an issue with its own project keeps the client',
);
ok(
  attributionStillCertain(withProject, fieldsFor({ parent: null })) === true,
  'the parent alias is treated the same as parentId',
);
ok(
  attributionStillCertain(withProject, fieldsFor({ parentId: null, title: 'x' })) === true,
  'an unrelated field alongside the re-parent does not change the answer',
);
ok(
  attributionStillCertain(
    { ...withProject, project: undefined },
    fieldsFor({ parentId: null }),
  ) === true,
  'a bare projectId with no expanded project object still counts as its own project',
);

// --- still invalidated -------------------------------------------------------
ok(
  attributionStillCertain(withProject, fieldsFor({ projectId: 'old' })) === false,
  'a project change always invalidates, project or no project',
);
ok(
  attributionStillCertain(withProject, fieldsFor({ project: 'old' })) === false,
  'the project alias invalidates too',
);
ok(
  attributionStillCertain(withProject, fieldsFor({ projectId: 'old', parentId: null })) === false,
  'project AND parent moving together invalidates -- the project wins',
);
ok(
  attributionStillCertain(withProject, fieldsFor({ project: 'old', parentId: null })) === false,
  'the project ALIAS moving alongside the parent invalidates too -- the case a '
    + 'parent-only check would silently wave through',
);
ok(
  attributionStillCertain(withoutProject, fieldsFor({ parentId: null })) === false,
  'a project-less issue inherits from its ancestor, so re-parenting DOES invalidate',
);
ok(
  attributionStillCertain(
    { ...withProject, project: {}, projectId: '   ' },
    fieldsFor({ parentId: null }),
  ) === false,
  'a blank projectId is not a project; fail closed and invalidate',
);

// --- nothing to decide -------------------------------------------------------
ok(
  attributionStillCertain(withProject, fieldsFor({ title: 'x' })) === false,
  'a webhook with no attribution field at all is not a retention',
);
ok(
  attributionStillCertain(withProject, []) === false,
  'an empty field list is not a retention',
);

// --- the wiring itself -------------------------------------------------------
// The guard is worthless if handleIssueEvent still passes the raw list on.
const wiring = INBOUND.match(
  /const attributionChangeFields = attributionRetained \? \[\] : declaredAttributionChanges;/,
);
ok(!!wiring, 'handleIssueEvent zeroes the change fields when the guard retains');
ok(
  /attributionRetained = attributionStillCertain\(issue, declaredAttributionChanges\)/.test(INBOUND),
  'the guard is called with the issue and the declared changes',
);
ok(
  (INBOUND.match(/if \(attributionChangeFields\.length\)/g) || []).length === 2,
  'both invalidation call sites read the guarded list, not the raw one',
);
ok(
  !/payloadAttributionChangeFields\(payload\)[^]{0,40}\n[^]{0,200}?invalidateClientAttribution/.test(INBOUND),
  'no invalidation path recomputes the raw list behind the guard',
);

process.exit(failures ? 1 : 0);
