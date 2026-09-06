'use strict';

/*
 * Destructive, scratch-only Track-B restore rehearsal.
 *
 * The target must be an explicitly named non-production Supabase project and
 * TRACK_B_RESTORE_CONFIRM must equal SCRATCH_ONLY. The transactional pg_dump
 * package is validated before its SQL is restored in one scratch transaction.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PRODUCTION_REF,
  TABLES,
  HISTORY_TABLES,
  corpusBoundarySql,
  manifestCorpus,
  resolveCorpus,
  connectionProjectRef,
  postgresEnvironment,
  readSnapshotFile,
  renderSafeCopySections,
  runOpaqueTool,
  strictConnectionInfo,
} = require('./track-b-backup');

const DB_URL = String(process.env.TRACK_B_RESTORE_DATABASE_URL || '');
const EXPECTED_REF = String(process.env.TRACK_B_RESTORE_EXPECTED_PROJECT_REF || '').trim();
const CONFIRM = String(process.env.TRACK_B_RESTORE_CONFIRM || '');

const INTEGRITY_CHECKS = Object.freeze({
  orphan_client_lead: "select count(*)::text from public.clients c left join public.team_members m on m.id=c.lead_member_id where c.lead_member_id is not null and m.id is null;",
  orphan_client_access: "select count(*)::text from public.client_access a left join public.clients c on c.slug=a.slug where c.slug is null;",
  orphan_batch_client: "select count(*)::text from public.batches b left join public.clients c on c.slug=b.client_slug where c.slug is null;",
  orphan_deliverable_batch: "select count(*)::text from public.deliverables d left join public.batches b on b.id=d.batch_id where b.id is null;",
  orphan_deliverable_client: "select count(*)::text from public.deliverables d left join public.clients c on c.slug=d.client_slug where c.slug is null;",
  orphan_deliverable_assignee: "select count(*)::text from public.deliverables d left join public.team_members m on m.id=d.assignee_id where d.assignee_id is not null and m.id is null;",
  orphan_comment_deliverable: "select count(*)::text from public.production_comments p left join public.deliverables d on d.id=p.deliverable_id where p.deliverable_id is not null and d.id is null;",
  orphan_comment_batch: "select count(*)::text from public.production_comments p left join public.batches b on b.id=p.batch_id where p.batch_id is not null and b.id is null;",
  orphan_comment_parent: "select count(*)::text from public.production_comments p left join public.production_comments q on q.id=p.parent_id where p.parent_id is not null and q.id is null;",
  orphan_comment_thread_root: "select count(*)::text from public.production_comments p left join public.production_comments q on q.id=p.thread_root_id where p.thread_root_id is not null and q.id is null;",
  orphan_comment_author: "select count(*)::text from public.production_comments p left join public.team_members m on m.id=p.author_member_id where p.author_member_id is not null and m.id is null;",
  orphan_outbox_dependency: "select count(*)::text from public.mirror_outbox o left join public.mirror_outbox q on q.id=o.depends_on_id where o.depends_on_id is not null and q.id is null;",
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function argValue(name) {
  const prefix = `--${name}=`;
  const raw = process.argv.find(arg => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : '';
}

function safeIdentifier(value) {
  const name = clean(value);
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return name;
}

function assertScratchTarget(url = DB_URL, expectedRef = EXPECTED_REF, confirm = CONFIRM) {
  if (!url) throw new Error('TRACK_B_RESTORE_DATABASE_URL is required');
  if (!expectedRef) throw new Error('TRACK_B_RESTORE_EXPECTED_PROJECT_REF is required');
  if (confirm !== 'SCRATCH_ONLY') throw new Error('TRACK_B_RESTORE_CONFIRM must equal SCRATCH_ONLY');
  if (expectedRef === PRODUCTION_REF) throw new Error('Production project ref is forbidden for restore rehearsals');
  const actual = strictConnectionInfo(url).ref;
  if (!actual || actual !== expectedRef) throw new Error('Restore database URL does not match the expected scratch project ref');
  return actual;
}

function restoreSql(parsedDump, corpusName = 'legacy-v3') {
  const corpus = resolveCorpus(corpusName);
  const names = corpus.tables.map(config => safeIdentifier(config.name));
  const helper = corpus.version === 5 ? 'track_b_restore_set_history_v5_user_triggers'
    : corpus.version === 4 ? 'track_b_restore_set_history_user_triggers' : 'track_b_restore_set_user_triggers';
  // Baseline Calendar/Samples existence alone does not establish a journal
  // dependency. Still reject retained journal/manifest state outside v3, and
  // reject actual FK dependencies for EVERY version before touching any data.
  const legacyGuard = corpus.version === 3 ? [
    'do $coverage$ begin',
    "if to_regclass('public.card_change_journal') is not null or to_regclass('public.production_intake_manifests') is not null then",
    "raise exception 'Legacy Track-B package cannot restore into an expanded history schema';",
    'end if; end $coverage$;',
  ] : [];
  const identityResets = corpus.tables.filter(config => config.identity).map(config => {
    const table = safeIdentifier(config.name);
    const pk = safeIdentifier(config.pk);
    // setval is not rolled back by PostgreSQL. Never rewind a used counter if
    // a later failure rolls restored rows back; advancing may leave harmless gaps.
    const sequenceState = `select coalesce(s.last_value, s.start_value) from pg_catalog.pg_sequences s `
      + `join pg_catalog.pg_namespace n on n.nspname=s.schemaname `
      + `join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=s.sequencename `
      + `where c.oid=pg_get_serial_sequence('public.${table}', '${pk}')::regclass`;
    return `select setval(pg_get_serial_sequence('public.${table}', '${pk}'), `
      + `greatest(coalesce((select max(${pk}) from public.${table}), 1), (${sequenceState})), true);`;
  });
  const preamble = [
    'begin;',
    "set local lock_timeout = '20s';",
    "set local statement_timeout = '20min';",
    ...legacyGuard,
    corpusBoundarySql(corpusName),
    `select public.${helper}(false);`,
    `truncate table ${names.map(name => `public.${name}`).join(', ')} restrict;`,
  ].join('\n');
  const postamble = [
    'set constraints all immediate;',
    `select public.${helper}(true);`,
    ...identityResets,
    'commit;',
    '',
  ].join('\n');
  return `${preamble}\n${renderSafeCopySections(parsedDump, corpusName)}${postamble}`;
}

function verifySql(corpusName = 'legacy-v3') {
  const lines = [];
  for (const config of resolveCorpus(corpusName).tables) {
    const name = safeIdentifier(config.name);
    lines.push(`select '${name}' || E'\\t' || count(*)::text from public.${name};`);
  }
  for (const [key, sql] of Object.entries(INTEGRITY_CHECKS)) {
    lines.push(`select '${key}' || E'\\t' || (${sql.slice(0, -1)});`);
  }
  return `${lines.join('\n')}\n`;
}

function parseVerification(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const [key, value] = line.split('\t');
    if (!clean(key)) continue;
    const count = Number(value);
    if (!Number.isFinite(count)) throw new Error('Unexpected restore verification output');
    if (Object.prototype.hasOwnProperty.call(out, key)) throw new Error('Duplicate restore verification key');
    out[key] = count;
  }
  return out;
}

function verifyCounts(manifest, observed) {
  const corpus = manifest.schema_version == null ? resolveCorpus() : manifestCorpus(manifest);
  for (const config of corpus.tables) {
    const expected = Number(manifest.tables[config.name].rows);
    if (observed[config.name] !== expected) {
      throw new Error(`Restore row-count mismatch for ${config.name}: expected ${expected}, observed ${observed[config.name]}`);
    }
  }
  for (const key of Object.keys(INTEGRITY_CHECKS)) {
    if (!Object.prototype.hasOwnProperty.call(observed, key)) {
      throw new Error(`Restore integrity check ${key} is missing`);
    }
    if (observed[key] !== 0) throw new Error(`Restore integrity check ${key} found ${observed[key]} row(s)`);
  }
  return true;
}

function runPsql(file, capture = false) {
  assertScratchTarget();
  const args = ['--no-psqlrc', '--set=ON_ERROR_STOP=1'];
  if (capture) args.push('--tuples-only', '--no-align');
  args.push('--file', file);
  const stage = capture ? 'Track-B restore verification' : 'Track-B restore apply';
  const result = runOpaqueTool(stage, 'psql', args, {
      encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      env: postgresEnvironment(DB_URL, 'syncview-track-b-restore-rehearsal'),
    }, spawnSync);
  return result.stdout || '';
}

async function main() {
  if (!process.argv.includes('--apply')) throw new Error('Restore rehearsal requires --apply');
  const packagePath = argValue('package');
  if (!packagePath) throw new Error('Restore rehearsal requires --package=PATH');
  const targetRef = assertScratchTarget();
  const tempDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'track-b-restore-'));
  const restoreFile = path.join(tempDir, 'restore.sql');
  const verifyFile = path.join(tempDir, 'verify.sql');
  const started = Date.now();
  try {
    const snapshot = readSnapshotFile(packagePath);
    const manifest = snapshot.manifest;
    const corpus = manifestCorpus(manifest);
    if (clean(manifest.source_project_ref) !== PRODUCTION_REF) {
      throw new Error('Restore rehearsal package is not a production Track-B snapshot');
    }
    fs.writeFileSync(restoreFile, restoreSql(snapshot.dumpBytes, corpus.name), { mode: 0o600 });
    fs.writeFileSync(verifyFile, verifySql(corpus.name), { mode: 0o600 });
    runPsql(restoreFile, false);
    const observed = parseVerification(runPsql(verifyFile, true));
    verifyCounts(manifest, observed);
    const elapsedSeconds = Number(((Date.now() - started) / 1000).toFixed(2));
    console.log(JSON.stringify({
      ok: true,
      target_project_ref: targetRef,
      source_snapshot_sha256: manifest.snapshot.sha256,
      elapsed_seconds: elapsedSeconds,
      corpus: corpus.name,
      coverage: corpus.version === 3 ? 'limited_legacy_only' : `data_only_${corpus.tables.length}_tables_schema_restore_unproven`,
      tables: Object.fromEntries(corpus.tables.map(item => [item.name, observed[item.name]])),
      integrity_checks: Object.fromEntries(Object.entries(observed).filter(([key]) => key.startsWith('orphan_'))),
    }));
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Track-B restore rehearsal\n\n- Target: scratch project \`${targetRef}\`\n- Result: verified\n- Snapshot SHA-256: \`${manifest.snapshot.sha256}\`\n- Elapsed: ${elapsedSeconds}s\n- Corpus: ${corpus.name}\n- Tables: ${corpus.tables.length}\n`);
    }
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error && error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  INTEGRITY_CHECKS,
  PRODUCTION_REF,
  assertScratchTarget,
  connectionProjectRef,
  parseVerification,
  restoreSql,
  verifyCounts,
  verifySql,
};
