'use strict';
// Read-only catalog comparison. This never installs or authorizes SQL execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {canonicalJson} = require('./track-b-backup');
const ROOT = path.resolve(__dirname, '..');
const QUERY = 'scripts/linear-exit-source-baseline-catalog.sql';
// Finite, named observed contracts. A caller selects one BY NAME; nothing here
// accepts a caller-supplied path or hash, so a new starting picture is a
// reviewed addition to this table and never an argument.
//
// observed67 is the 2026-09-12 live read, 67 public tables. settled68 is the
// 2026-09-16 settled state: the same picture plus the owner's hiring migration
// as merged on main at 1abdd1fa, 68 public tables, derived offline against an
// isolated PostgreSQL 17 and byte-confirmed against the derivation's private
// candidate before being wired here.
const ARTIFACTS = Object.freeze({
  observed67: Object.freeze({
    path: 'docs/independence/LINEAR_EXIT_OBSERVED_PUBLIC_CATALOG_20260912.json',
    sha256: '824a39b43491fef2d9289c9bcdc1f3665e26ad8fca992e76b1a9f77ecaa872d5'}),
  settled68: Object.freeze({
    path: 'docs/independence/LINEAR_EXIT_OBSERVED_PUBLIC_CATALOG_20260916.json',
    sha256: 'c8e934bcdfd0f43ffe8767f076bbc65e6aae803285ae380e3e552f302fb6778a'}),
});
const DEFAULT_CONTRACT = 'observed67';

/* THE TABLES THE INSTALLATION CREATES, as opposed to the ones it finds.
 *
 * DERIVED, NOT CHOSEN. `docs/independence/LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json`
 * records post-install `public_tables: 90` from
 * `initial_public_catalog_sha256` 809c5dc7…, which is the observed67
 * contract's 67-table live read. 90 - 67 = 23.
 *
 * It is a property of the PLAN'S SOURCE LIST, not of any one profile: a profile
 * changes only `initial_catalog_sha256` and the contract the starting catalog
 * is compared against, never the sources. So the same 23 tables are created
 * whichever profile runs, and the post-install count moves only because the
 * starting count does.
 *
 * WHY THIS IS NOT THE TENTH LITERAL. The nine it replaces each restated a
 * finished number with no way to tell which world it belonged to. This is one
 * input to an arithmetic that reads its other input from the profile's own
 * reviewed contract, and it carries where it came from. If a future profile
 * ever changes the plan's source list, this is wrong and must be re-derived
 * from that profile's own target -- it is not a universal constant.
 *
 * VERIFICATION STATUS, recorded deliberately so a later reader knows which
 * links in this chain were independently checked and which were not:
 *   - the 90 and the 67 are READ from committed artifacts;
 *   - "the source list is identical across profiles" was established by
 *     reading the builder, by one party only;
 *   - the related 86-plus-4 decomposition was NOT independently confirmed: two
 *     attempts to extract it from compressed source failed. It was approved on
 *     the structural argument plus the fact that the calibration can refute it.
 *
 * THE CALIBRATION IS THE TEST OF THIS NUMBER. If it reports a post-install
 * count other than the one derived here, that is a FINDING: stop and report it.
 * It is not a licence to adjust this a second time. Adjusting twice is fitting
 * the number to the observation.
 */
const INSTALL_CREATED_PUBLIC_TABLES = 23;
const ARTIFACT = ARTIFACTS[DEFAULT_CONTRACT].path;
const ARTIFACT_SHA256 = ARTIFACTS[DEFAULT_CONTRACT].sha256;
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

function load({readFile = fs.readFileSync, contract = DEFAULT_CONTRACT} = {}) {
  if (!Object.hasOwn(ARTIFACTS, contract)) throw Error('OBSERVED_CATALOG_UNKNOWN_CONTRACT');
  const {path: artifact, sha256: expectedSha} = ARTIFACTS[contract];
  const bytes = readFile(path.join(ROOT, artifact));
  if (sha(bytes) !== expectedSha) throw Error('OBSERVED_CATALOG_ARTIFACT_DRIFT');
  const expected = JSON.parse(bytes);
  if (sha(readFile(path.join(ROOT, QUERY))) !== expected.query.sha256) throw Error('CATALOG_QUERY_DRIFT');
  return expected;
}

/* STARTING CATALOGS THAT ARE NOT THEMSELVES A CONTRACT ARTIFACT.
 *
 * A world can differ from a contract's picture without differing in TABLE
 * COUNT, and this arithmetic only ever needs the count. Such a world gets an
 * entry here naming the contract whose table count governs it. The entry is
 * reviewed, finite and resolved from the starting hash alone; nothing accepts
 * a caller-supplied mapping.
 *
 * f5ed8a38... is the opt-out world. It is the observed67 picture with one
 * column (`auto_assign_opt_out`) dropped from `team_members` and that table's
 * ACL widened. ONE COLUMN AND AN ACL STRING; ZERO TABLES.
 *
 * WHERE THAT IS PROVEN -- by the builder, not by this comment.
 * `linear-exit-install-profiles.js` build() reverses exactly that delta on a
 * clone and then asserts
 *   assert.equal(j.sha(j.canonical(old)),OLD,'only exact known source migration delta may be reversed for source planning')
 * The reversal edits columns and an ACL on a table present in both worlds, so
 * `tables.length` is untouched, and the result hashes to the observed67
 * catalog. A delta that added or dropped a table could not reverse that way:
 * the assert would fail and no plan would be built at all.
 *
 * WHY IT LIVES HERE AND NOT ON THE PROFILE OR THE PLAN. The opt-out plan hash
 * 0c889149... is pinned and checked in the builder and in the installer's
 * preflight. A field added to the plan to carry this would change the plan
 * bytes and break that pin.
 *
 * WHAT WOULD MAKE IT WRONG: any future opt-out delta that ADDS OR DROPS A
 * TABLE. Then the opt-out world no longer shares observed67's count, this
 * entry is wrong, and the count must be re-derived from that world's own
 * reviewed artifact -- never adjusted by hand to fit a run.
 */
const STARTING_CATALOG_TABLE_COUNT_SOURCE = Object.freeze({
  'f5ed8a38a4454e62905192c49de9a6a790c1bb48e247884efed12562b1161c25': 'observed67',
});

/* Public table count of a STARTING world, resolved from its catalog hash
 * alone: a reviewed contract whose catalog IS that hash, or a reviewed entry
 * above naming the contract whose count governs it. Nothing else resolves.
 *
 * Extracted from postInstallPublicTables() on 2026-09-16, unchanged in
 * behaviour: same checks, same order, same error messages. It exists so the
 * pre-installation backup (scripts/linear-exit-native-preinstall-backup.js)
 * asks this one reviewed question instead of restating a table count. */
function startingPublicTables(catalogSha256, {readFile = fs.readFileSync} = {}) {
  if (!/^[a-f0-9]{64}$/.test(catalogSha256 || '')) throw Error('OBSERVED_CATALOG_STARTING_SHA_SHAPE');
  let contract = null, expected = null;
  for (const name of Object.keys(ARTIFACTS)) {
    const candidate = load({readFile, contract: name});
    if (candidate.catalog_sha256 === catalogSha256) { contract = name; expected = candidate; break; }
  }
  if (!contract) {
    // No artifact IS this starting catalog. A reviewed entry above may still
    // name the contract whose table count governs it; nothing else may.
    contract = STARTING_CATALOG_TABLE_COUNT_SOURCE[catalogSha256] ?? null;
    if (!contract) throw Error('OBSERVED_CATALOG_UNKNOWN_STARTING_CATALOG');
    expected = load({readFile, contract});
  }
  const tables = expected.sections.find(section => section.name === 'tables');
  if (!tables || !Number.isInteger(tables.count)) throw Error('OBSERVED_CATALOG_TABLE_COUNT');
  // `contract` names where the COUNT came from. For an entry resolved above it
  // is not a claim that the starting catalog's bytes equal that contract's.
  return {contract, count: tables.count};
}

/* Expected public table count AFTER installation, for whichever world the plan
 * starts from. The plan names its own starting catalog, so nothing has to be
 * told which profile it is serving -- which is the defect the nine literals
 * had: they asserted a number they had no way to be right about. */
function postInstallPublicTables(initialCatalogSha256, {readFile = fs.readFileSync} = {}) {
  const {contract, count} = startingPublicTables(initialCatalogSha256, {readFile});
  return {contract, pre_install: count,
    created: INSTALL_CREATED_PUBLIC_TABLES,
    expected: count + INSTALL_CREATED_PUBLIC_TABLES};
}

async function verify(readOnlyQuery, {projectRef} = {}) {
  if (typeof readOnlyQuery !== 'function') throw Error('READ_ONLY_QUERY_REQUIRED');
  const expected = load();
  const bytes = fs.readFileSync(path.join(ROOT, QUERY));
  const actual = await readOnlyQuery(bytes.toString('utf8'));
  load();
  return compare(actual, expected, {projectRef, queryBytes: bytes});
}

module.exports = {observation, compare, summarize, load, verify, ARTIFACTS,
  postInstallPublicTables, startingPublicTables, INSTALL_CREATED_PUBLIC_TABLES};
