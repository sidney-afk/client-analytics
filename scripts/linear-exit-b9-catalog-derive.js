'use strict';
/*
 * B9: derive the settled-state catalog, once, against a real PostgreSQL 17.
 *
 * WHY THIS EXISTS. The live database is ahead of main. The owner's hiring
 * practical-test / Video Editor migration was applied live on 2026-09-15 and
 * has since landed on main at `1abdd1fa`
 * (`migrations/2026-09-15-hiring-video-editor-role.sql`, one new public table,
 * `hiring_practical_test_jobs`). So the live catalog hashes to neither
 * reviewed profile, and steps 8, 9 and 10 cannot pass until a third profile is
 * derived against the settled state. That is journal B9, and D12 says it is
 * derived ONCE, after the migration is on main. It is on main now.
 *
 * WHAT THIS DOES, AND ALL IT DOES. It rebuilds the settled state in an
 * isolated throwaway PostgreSQL 17 cluster, reads the catalog with the pinned
 * catalog query, and prints what the third profile has to be written against.
 * It reads nothing hosted, writes nothing outside the private output directory
 * you name, and installs nothing. It is not the installation and it is not an
 * authorization.
 *
 * THE SEQUENCE IS NOT INVENTED HERE. It is the same one
 * `test/linear-exit-install-operator-postgres.js` already uses to stand up the
 * observed67 world, with exactly one thing added at the end -- the hiring
 * migration read from main. Reusing that path is deliberate: a second,
 * hand-rolled reconstruction of the observed schema would be a new thing to be
 * wrong, and being wrong here means the owner's sitting is spent twice.
 *
 * WHAT YOU NEED.
 *   - PostgreSQL 17 on PATH, or F42_REHEARSAL_PGBIN pointing at its bin dir.
 *   - PGHOST=127.0.0.1 and PGPORT set to a throwaway cluster you started, OR
 *     nothing set, in which case the helper starts one for you.
 *   - --observed-input=<abs dir>, your private observed-schema inputs. They are
 *     not in this repository and never will be.
 *   - --out=<abs NEW dir>, private, must not already exist as the input dir.
 *
 * NO SECRET GOES IN AN ARGUMENT. There is no password, token or project ref in
 * anything this script takes or prints. If something asks you for one, it is
 * not this.
 *
 * WHAT IT PRINTS, WHICH IS THE WHOLE POINT.
 *   settled_catalog_sha256   the third profile's `initial_catalog_sha256`
 *   public_tables            the settled pre-install public table count
 *   section counts           compared against the reviewed observed67 sections,
 *                            so the delta is visible object class by object
 *                            class rather than as one moved hash
 *
 * READ THE `public_tables` LINE. `scripts/linear-exit-install-operator.js`
 * carries a HARD-CODED post-install expectation of 90 public tables
 * (`fail('GUARD_COUNT')`), derived from a 67-table live read
 * (`docs/independence/LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json`,
 * `public_tables: 90`, built from `initial_public_catalog_sha256`
 * 809c5dc7...). One new live table moves that to 91 and the operator refuses
 * before installing anything. That constant is re-derived deliberately with
 * the new target, never edited to match a number -- see AGENTS.md and journal
 * D8 on re-derivation versus silencing.
 *
 * --selfcheck runs the plumbing with no private inputs and no cluster, so you
 * can confirm the script loads and finds its dependencies BEFORE spending a
 * sitting on it.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const assert = require('assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HIRING_MIGRATION = 'migrations/2026-09-15-hiring-video-editor-role.sql';
const OBSERVED_CONTRACT = 'docs/independence/LINEAR_EXIT_OBSERVED_PUBLIC_CATALOG_20260912.json';
const OPTOUT_PREREQUISITE_REF = '73d5fdc361';
const OPTOUT_PREREQUISITE = 'migrations/2026-09-14-team-members-auto-assign-opt-out.sql';
const OPTOUT_PREREQUISITE_SHA = 'fbd5ae8ecbef6e28cce913878791cb5f2a2a7fc70a7c930d3c0d3b508966fbaa';

/* The reviewed observed67 section counts, for a class-by-class delta rather
 * than one moved top-level hash. Source: the committed observed catalog. */
function reviewedSections() {
  const p = path.join(ROOT, OBSERVED_CONTRACT);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const by = new Map();
  for (const s of d.sections) by.set(s.name, s.count);
  return { catalogSha256: d.catalog_sha256, counts: by, sections: d.sections, observedDate: d.observed_date };
}

/* THE SETTLED WORLD, BUILT IN ONE PLACE.
 *
 * observed67 reconstructed + the storage-column supplement + the opt-out
 * prerequisite + the owner's hiring migration = settled68, catalog ddfa4c4f...
 *
 * This used to live only inside derive(). On 2026-09-17 the re-based pipeline
 * proof lane grew its own copy and got it WRONG: it applied the hiring
 * migration and skipped the opt-out prerequisite, so it built 5864a28f...
 * instead of ddfa4c4f... and the storage session's calibrate run refused. Two
 * constructions of one world is one too many, so both callers now share this.
 *
 * The order is load-bearing. Opt-out FIRST: it is the delta that takes
 * observed67 to the opt-out world, and the hiring migration is authored on top
 * of that, not beside it.
 */
function applySettledWorld(c, { onStage = () => {}, stopBeforeHiring = false, hiringOnly = false } = {}) {
  if (!hiringOnly) {
    /* Same storage-column supplement the operator proof uses. */
    c.exec('alter table storage.buckets alter column name set not null; alter table storage.buckets add column public boolean, add column file_size_limit bigint, add column allowed_mime_types text[];');
    onStage('storage_supplement_applied');
    const prerequisite = gitShow(OPTOUT_PREREQUISITE_REF, OPTOUT_PREREQUISITE);
    assert.equal(j.sha(prerequisite), OPTOUT_PREREQUISITE_SHA, 'opt-out prerequisite source drift');
    c.exec(prerequisite.toString('utf8'));
    onStage('optout_prerequisite_applied');
    if (stopBeforeHiring) return;
  }
  const hiring = fs.readFileSync(path.join(ROOT, HIRING_MIGRATION));
  c.exec(hiring.toString('utf8'));
  onStage('hiring_migration_applied');
}

function gitShow(ref, file) {
  return cp.execFileSync('git', ['show', ref + ':' + file], { cwd: ROOT, maxBuffer: 1 << 28 });
}

function parseArgs(argv) {
  const out = { selfcheck: false, observedInput: null, out: null, json: false, planFrom: null };
  for (const a of argv) {
    if (a === '--selfcheck') out.selfcheck = true;
    else if (a.startsWith('--plan-from=')) out.planFrom = a.slice(12);
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--observed-input=')) out.observedInput = a.slice(17);
    else if (a.startsWith('--out=')) out.out = a.slice(6);
    else throw new Error('unknown argument: ' + a);
  }
  return out;
}

function selfcheck() {
  const problems = [];
  const j = require('./linear-exit-install-journal');
  const catalog = require('./linear-exit-source-baseline-catalog');
  const { Cluster } = require('./f42-apply-rehearsal');
  require('./linear-exit-observed-schema');
  require('./linear-exit-install-profiles');
  const observedApi = require('./linear-exit-observed-public-catalog');
  if (typeof observedApi.observation !== 'function') problems.push('observed catalog builder missing its observation() entry point');

  const reviewed = reviewedSections();
  const hiring = fs.readFileSync(path.join(ROOT, HIRING_MIGRATION));
  const createdTables = [...hiring.toString('utf8').matchAll(/create table (?:if not exists )?public\.([a-z_0-9]+)/gi)].map((m) => m[1]);

  /* Both of these are hard refusals inside linear-exit-observed-schema.js, and
   * both cost time at the keyboard on 2026-09-16 because neither page said so.
   * The whole point of a selfcheck is that nothing surprises you mid-run. */
  if (process.env.F63_REQUIRE_POSTGRES !== '1') problems.push('F63_REQUIRE_POSTGRES is not set to 1 -- the observed-schema loader asserts it and the derivation will refuse at its first real stage');
  const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
  if (!['127.0.0.1', '::1'].includes(host)) {
    problems.push('PGHOST is ' + (host ? '"' + host + '"' : 'unset') + ' -- the loader requires a caller-owned loopback (127.0.0.1 or ::1). Start a throwaway PostgreSQL 17 cluster listening on 127.0.0.1 and point PGHOST/PGPORT at it; the helper\'s self-managed cluster listens on a Unix socket only and will not do, and does not exist on Windows.');
  }

  let prerequisiteOk = false;
  try { prerequisiteOk = j.sha(gitShow(OPTOUT_PREREQUISITE_REF, OPTOUT_PREREQUISITE)) === OPTOUT_PREREQUISITE_SHA; }
  catch (e) { problems.push('cannot read the opt-out prerequisite from ' + OPTOUT_PREREQUISITE_REF + ': ' + e.message + ' (shallow clone?)'); }
  if (!prerequisiteOk && !problems.length) problems.push('opt-out prerequisite does not match its pinned sha256');

  const c = new Cluster();
  const pgbin = c.pgbin;
  let serverVersion = null;
  try { serverVersion = cp.execFileSync(path.join(pgbin, 'postgres'), ['--version'], { encoding: 'utf8' }).trim(); }
  catch { problems.push('no postgres binary at ' + pgbin + ' -- set F42_REHEARSAL_PGBIN to a PostgreSQL 17 bin directory'); }
  if (serverVersion && !/\b17\./.test(serverVersion)) problems.push('server is not PostgreSQL 17: ' + serverVersion);

  /* THE COLLATION PROBE. The pinned catalog query orders several sections by
   * text columns, so a rebuild only reproduces the live capture under a
   * collation that sorts the way live sorts. A cluster created with --locale=C
   * (or C.UTF-8) sorts by byte value, which puts '(' 0x28 before '_' 0x5F; live
   * sorts linguistically, weighting punctuation low, and puts '_' first. That
   * single difference shifted 37 of 1,336 dependency entries and stopped the
   * derivation on 2026-09-16 after the cluster was already up.
   *
   * These are the exact two identities whose order differed. If the cluster
   * sorts them the byte way, the derivation WILL fail, so say so now rather
   * than twenty minutes in. */
  const probeHost = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
  if (probeHost && pgbin) {
    const a = 'production_comment_card_import_counts(x)';
    const b = 'production_comment_card_import(pg_catalog.jsonb)';
    const sql = "select string_agg(v,'|' order by v) from (values ('" + a + "'),('" + b + "')) t(v)";
    const r = cp.spawnSync(path.join(pgbin, 'psql'),
      ['-X', '-q', '-t', '-A', '-h', probeHost, '-p', String(process.env.PGPORT || 55432),
       '-U', process.env.PGUSER || 'postgres', '-d', 'postgres', '-c', sql],
      { encoding: 'utf8', timeout: 20000 });
    if (r.status === 0) {
      const first = (r.stdout || '').trim().split('|')[0] || '';
      if (first.startsWith(b)) {
        problems.push('the target cluster sorts by BYTE order, not linguistically -- the observed-schema rebuild will not reproduce the live capture and the derivation will fail in its first real stage. Recreate the cluster with an ICU locale: initdb --locale-provider=icu --icu-locale=en-US --encoding=UTF8. See LINEAR_EXIT_B9_CATALOG_REDERIVATION.md.');
      } else if (!first.startsWith(a)) {
        problems.push('collation probe returned an unexpected result; could not establish the cluster\'s sort order');
      }
    } else {
      problems.push('could not reach the cluster at ' + probeHost + ' to probe its collation (' + ((r.stderr || '').trim().split('\n')[0] || 'psql failed') + ')');
    }
  }


  return {
    marker: problems.length ? 'B9_DERIVE_SELFCHECK_PROBLEMS' : 'B9_DERIVE_SELFCHECK_OK',
    reviewed_observed_catalog_sha256: reviewed.catalogSha256,
    reviewed_observed_date: reviewed.observedDate,
    reviewed_public_tables: reviewed.counts.get('tables'),
    operator_post_install_public_tables_constant: 90,
    hiring_migration: HIRING_MIGRATION,
    hiring_migration_sha256: require('./linear-exit-install-journal').sha(hiring),
    hiring_migration_creates_public_tables: createdTables,
    catalog_query_bytes: catalog.query().length,
    postgres_bin: pgbin,
    postgres_version: serverVersion,
    problems,
  };
}

function derive(opts) {
  assert(opts.observedInput && path.isAbsolute(opts.observedInput), '--observed-input must be an absolute directory');
  assert(opts.out && path.isAbsolute(opts.out), '--out must be an absolute directory');
  fs.mkdirSync(opts.out, { recursive: true });
  assert.notEqual(fs.realpathSync(opts.observedInput), fs.realpathSync(opts.out), 'output must be a separate private directory');

  const j = require('./linear-exit-install-journal');
  const catalog = require('./linear-exit-source-baseline-catalog');
  const { Cluster } = require('./f42-apply-rehearsal');
  const observed = require('./linear-exit-observed-schema');

  const c = new Cluster();
  assert.equal(c.host, '127.0.0.1', 'point PGHOST at a throwaway 127.0.0.1 cluster');
  const stages = [];
  try {
    c.start();
    stages.push('cluster_started');

    observed.applyObservedSchema(c, { inputDirectory: opts.observedInput, outputDirectory: opts.out });
    stages.push('observed_schema_applied');

    applySettledWorld(c, { onStage: (s) => stages.push(s), stopBeforeHiring: true });

    const beforeHiring = c.scalarJson(catalog.query());
    const beforeSha = j.sha(j.canonical(beforeHiring));
    stages.push('pre_hiring_catalog_read');

    applySettledWorld(c, { onStage: (s) => stages.push(s), hiringOnly: true });

    const settled = c.scalarJson(catalog.query());
    const settledSha = j.sha(j.canonical(settled));
    stages.push('settled_catalog_read');

    /* The derived catalog is the input the third profile is authored against.
     * It is schema metadata, no application rows -- but it stays in the private
     * output directory, not in this public repository. */
    const settledPath = path.join(opts.out, 'b9-settled-catalog.private.json');
    fs.writeFileSync(settledPath, JSON.stringify(settled, null, 2) + '\n', { flag: 'wx' });

    /* Build the CANDIDATE observed contract with the repo's own builder, so
     * the artifact that gets reviewed has exactly the shape the comparator
     * expects rather than one assembled by hand. It is written privately; what
     * gets committed is the owner's call after review. The project ref comes
     * out of the existing contract rather than being typed again. */
    const observedApi = require('./linear-exit-observed-public-catalog');
    const existing = JSON.parse(fs.readFileSync(path.join(ROOT, OBSERVED_CONTRACT), 'utf8'));
    const observedDate = new Date().toISOString().slice(0, 10);
    const candidate = observedApi.observation(settled, { projectRef: existing.project_ref, observedDate });
    const candidatePath = path.join(opts.out, 'b9-candidate-observed-catalog.private.json');
    fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });

    /* Section hashes and counts are hashes and counts. They carry no schema
     * content, so these ARE safe to paste back -- and they are all that is
     * needed to author the contract. The catalog itself is not. */
    const reviewed = reviewedSections();
    const reviewedByName = new Map(reviewed.sections.map((x) => [x.name, x]));
    const sections = candidate.sections.map((x) => {
      const was = reviewedByName.get(x.name) || {};
      return {
        section: x.name,
        reviewed_count: was.count ?? null,
        settled_count: x.count ?? null,
        settled_sha256: x.sha256,
        moved: was.sha256 !== x.sha256,
      };
    });

    return {
      marker: 'B9_SETTLED_CATALOG_DERIVED',
      classification: 'ISOLATED_PG17_DERIVATION_NOT_A_HOSTED_READ',
      reviewed_observed_catalog_sha256: reviewed.catalogSha256,
      pre_hiring_catalog_sha256: beforeSha,
      pre_hiring_matches_optout_profile: beforeSha === 'f5ed8a38a4454e62905192c49de9a6a790c1bb48e247884efed12562b1161c25',
      settled_catalog_sha256: settledSha,
      settled_public_tables: Array.isArray(settled.tables) ? settled.tables.length : null,
      operator_post_install_public_tables_constant: 90,
      sections,
      settled_catalog_written_to: settledPath,
      candidate_observed_contract_written_to: candidatePath,
      candidate_observed_date: observedDate,
      stages,
      installation_authorized: false,
      third_profile_written: false,
    };
  } catch (e) {
    fs.writeFileSync(path.join(opts.out, 'b9-derive-error.private.log'), String(e.stack || e));
    return { marker: 'B9_DERIVE_FAILED', stages, error_written_to: path.join(opts.out, 'b9-derive-error.private.log') };
  } finally {
    try { c.stop(); } catch { /* the throwaway cluster is the caller's to clean up */ }
  }
}

/* Measure the settled profile's plan hash. It is a pure function of this
 * repository plus the settled catalog -- no cluster, no install, nothing
 * hosted. It exists so the pin in linear-exit-install-profiles.js is READ from
 * a run rather than chosen, which is the whole point of D8. Seconds to run.
 *
 * Takes the private settled catalog the derivation already wrote
 * (<out>/b9-settled-catalog.private.json). Prints hashes only. */
function planFrom(file) {
  const assert = require('assert/strict');
  assert(file && path.isAbsolute(file), '--plan-from must be an absolute path to b9-settled-catalog.private.json');
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  const j = require('./linear-exit-install-journal');
  const catalogSha = j.sha(j.canonical(catalog));
  const built = require('./linear-exit-install-profiles').build(catalog, 'settled68');
  return {
    marker: 'B9_SETTLED_PLAN_MEASURED',
    settled_catalog_sha256: catalogSha,
    settled_plan_sha256: built.planSha256,
    plan_bytes: built.planBytes.length,
    stage_id: JSON.parse(built.planBytes).stage_id,
    initial_catalog_sha256: JSON.parse(built.planBytes).initial_catalog_sha256,
    target_still_required: true,
    note: 'the target is NOT derivable here; it comes from a calibration run of the installer',
  };
}

function main(argv) {
  const opts = parseArgs(argv);
  const result = opts.planFrom ? planFrom(opts.planFrom) : opts.selfcheck ? selfcheck() : derive(opts);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.marker === 'B9_DERIVE_FAILED') return 1;
  if (result.marker === 'B9_DERIVE_SELFCHECK_PROBLEMS') return 1;
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { selfcheck, derive, planFrom, reviewedSections, HIRING_MIGRATION, applySettledWorld };
