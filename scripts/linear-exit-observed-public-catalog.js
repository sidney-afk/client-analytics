'use strict';
// Read-only catalog comparison. This never installs or authorizes SQL execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {canonicalJson} = require('./track-b-backup');
const ROOT = path.resolve(__dirname, '..');
const QUERY = 'scripts/linear-exit-source-baseline-catalog.sql';
const ARTIFACT = 'docs/independence/LINEAR_EXIT_OBSERVED_PUBLIC_CATALOG_20260912.json';
const ARTIFACT_SHA256 = '824a39b43491fef2d9289c9bcdc1f3665e26ad8fca992e76b1a9f77ecaa872d5';
const SECTIONS = ['rules', 'types', 'views', 'schema', 'tables', 'indexes', 'policies',
  'triggers', 'functions', 'sequences', 'default_acls', 'dependencies',
  'publications', 'server_major', 'internal_constraint_triggers'].sort();
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog) ||
      canonicalJson(Object.keys(catalog).sort()) !== canonicalJson(SECTIONS)) {
    throw Error('OBSERVED_CATALOG_SHAPE');
  }
  if (!Number.isInteger(catalog.server_major) || catalog.server_major < 15 ||
      !catalog.schema || typeof catalog.schema !== 'object' || Array.isArray(catalog.schema)) {
    throw Error('OBSERVED_CATALOG_PLATFORM_SHAPE');
  }
  for (const name of SECTIONS.filter(x => !['schema', 'server_major'].includes(x))) {
    if (!Array.isArray(catalog[name])) throw Error('OBSERVED_CATALOG_SECTION_SHAPE');
  }
  return catalog;
}

function summarize(catalog) {
  validateCatalog(catalog);
  return SECTIONS.map(name => ({name,
    count: Array.isArray(catalog[name]) ? catalog[name].length : null,
    sha256: sha(canonicalJson(catalog[name]))}));
}

function observation(catalog, {projectRef, observedDate, queryBytes = fs.readFileSync(path.join(ROOT, QUERY))}) {
  validateCatalog(catalog);
  if (!/^[a-z]{20}$/.test(projectRef) || !/^\d{4}-\d{2}-\d{2}$/.test(observedDate)) {
    throw Error('OBSERVED_CATALOG_PROVENANCE_SHAPE');
  }
  return {
    format: 'linear-exit-observed-public-catalog-v1',
    classification: 'LIVE_READ_SCHEMA_ONLY_POINT_IN_TIME',
    project_ref: projectRef, observed_date: observedDate,
    query: {path: QUERY, sha256: sha(queryBytes)},
    catalog_sha256: sha(canonicalJson(catalog)), sections: summarize(catalog),
    scope: 'public schema metadata and catalog dependencies; no application rows',
    source_rehearsal_equivalence_proven: false,
    connection_identity_verified_by_comparator: false,
    external_platform_configuration_proven: false,
    installation_authorized: false,
    fresh_read_required: true
  };
}

function compare(catalog, expected, {projectRef, queryBytes = fs.readFileSync(path.join(ROOT, QUERY))} = {}) {
  const refuse = (code, sections = []) => ({status: 'REFUSE', code,
    changed_sections: sections, installation_authorized: false});
  if (!expected || expected.format !== 'linear-exit-observed-public-catalog-v1' ||
      expected.installation_authorized !== false || expected.fresh_read_required !== true ||
      !/^[a-f0-9]{64}$/.test(expected.catalog_sha256) || !Array.isArray(expected.sections)) {
    return refuse('OBSERVATION_SHAPE');
  }
  if (projectRef !== expected.project_ref) return refuse('PROJECT_CONTEXT_MISMATCH');
  if (expected.query?.path !== QUERY || expected.query.sha256 !== sha(queryBytes)) {
    return refuse('CATALOG_QUERY_DRIFT');
  }
  let sections;
  try { sections = summarize(catalog); } catch { return refuse('CATALOG_SHAPE'); }
  const changed = sections.filter((x, i) => canonicalJson(x) !== canonicalJson(expected.sections[i] ?? null)).map(x => x.name);
  if (expected.sections.length !== sections.length || changed.length ||
      sha(canonicalJson(catalog)) !== expected.catalog_sha256) return refuse('CATALOG_DRIFT', changed);
  return {status: 'MATCHED_OBSERVED_PUBLIC_CATALOG', changed_sections: [],
    installation_authorized: false, source_rehearsal_equivalence_proven: false,
    connection_identity_verified_by_comparator: false,
    external_platform_configuration_proven: false};
}

function load({readFile = fs.readFileSync} = {}) {
  const bytes = readFile(path.join(ROOT, ARTIFACT));
  if (sha(bytes) !== ARTIFACT_SHA256) throw Error('OBSERVED_CATALOG_ARTIFACT_DRIFT');
  const expected = JSON.parse(bytes);
  if (sha(readFile(path.join(ROOT, QUERY))) !== expected.query.sha256) throw Error('CATALOG_QUERY_DRIFT');
  return expected;
}

async function verify(readOnlyQuery, {projectRef} = {}) {
  if (typeof readOnlyQuery !== 'function') throw Error('READ_ONLY_QUERY_REQUIRED');
  const expected = load();
  const bytes = fs.readFileSync(path.join(ROOT, QUERY));
  const actual = await readOnlyQuery(bytes.toString('utf8'));
  load();
  return compare(actual, expected, {projectRef, queryBytes: bytes});
}

module.exports = {observation, compare, summarize, load, verify};
