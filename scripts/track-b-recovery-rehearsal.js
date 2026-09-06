'use strict';
// LOCAL ONLY, prepared source. A migration-shaped source is captured with the
// schema engine and reconstructed into an EMPTY restricted target. No serving
// schema, provider, cloud, scheduler or alert claim. Both databases are retained.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const cp = require('child_process');
const { LocalDatabase } = require('./card-change-journal-rehearsal');
const { setup } = require('./card-history-integrated-rehearsal');
const backup = require('./track-b-backup');
const recovery = require('./track-b-recovery-package');
const { reconstruct, OUTCOMES } = require('./track-b-recovery-reconstruct');
const ROOT = path.resolve(__dirname, '..');
const CORPUS = process.env.TRACK_B_RECOVERY_TEST_CORPUS || 'history-v7';
if (!['history-v7','history-v8'].includes(CORPUS)) throw new Error('unsupported_recovery_test_corpus');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
// The older data rehearsal intentionally fixes its comparison at v7. This
// combined schema lane compares the selected corpus, including FK-free owners.
function unionImages(db) {
  const sql = backup.resolveCorpus(CORPUS).tables.map(t => `select ${quote(t.name)} as table_name,to_jsonb(t)::text as image from public.${t.name} t`).join(' union all ');
  return db.rows(`select table_name,image from (${sql}) images order by table_name,image`);
}
const SOURCES = ['scripts/track-b-recovery-package.js', 'scripts/track-b-recovery-reconstruct.js',
  'scripts/track-b-recovery-prerequisites.sql', 'scripts/track-b-recovery-rehearsal.js',
  'scripts/track-b-backup.js', 'scripts/track-b-restore-rehearsal.js',
  'scripts/card-history-integrated-rehearsal.js', 'scripts/card-history-backup-rehearsal.js',
  'scripts/card-history-closed-corpus-rehearsal.js', 'scripts/card-change-journal-rehearsal.js',
  'scripts/native-card-materialization/fixture.mjs', 'scripts/native-card-materialization/recovery-v7-phase.mjs',
  'migrations/live-schema-baseline-2026-07-03.sql', 'migrations/2026-09-02-workload-native-view.sql',
  'migrations/2026-09-05-workload-native-membership.sql',
  'migrations/2026-09-05-card-change-journal.sql', 'migrations/2026-09-05-calendar-feedback-recovery.sql',
  'migrations/2026-09-05-crosswalk-bind-and-import.sql', 'migrations/2026-09-06-native-card-materialization-boundary.sql',
  ...(CORPUS === 'history-v8' ? [
  'migrations/2026-09-05-native-label-catalog-foundation.sql', 'migrations/2026-09-06-native-label-writes.sql',
  'migrations/2026-09-06-linear-outbound-cutoff.sql', 'migrations/2026-09-06-native-existing-assignment.sql'] : [])];
// Platform-only prerequisites. No public application table/function/type is
// recreated manually on the target; the package must reconstruct those.
const TARGET_PREREQUISITES = `create schema extensions; create extension pgcrypto schema extensions;
create schema auth; create schema storage; create publication supabase_realtime;
grant usage on schema public to anon, authenticated, service_role;`;

function required(env, key) { if (!env[key]) throw new Error(key + '_required'); return String(env[key]); }
function sameOrInside(child, parent) {
  const a = child.toLowerCase(), b = parent.toLowerCase(); return a === b || a.startsWith(b + path.sep);
}
function config(env = process.env) {
  if (env.TRACK_B_RECOVERY_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') throw new Error('local_disposable_confirmation_required');
  const host = required(env, 'TRACK_B_RECOVERY_TEST_PGHOST'), port = required(env, 'TRACK_B_RECOVERY_TEST_PGPORT');
  if (host !== '127.0.0.1' || !/^\d{4,5}$/.test(port) || +port > 65535) throw new Error('literal_loopback_port_required');
  const file = key => { const raw = required(env, key); if (!path.isAbsolute(raw)) throw new Error('absolute_tool_path_required');
    const value = fs.realpathSync.native(raw); if (!fs.statSync(value).isFile()) throw new Error('regular_tool_file_required'); return value; };
  const output = required(env, 'TRACK_B_RECOVERY_TEST_OUTPUT');
  if (!path.isAbsolute(output)) throw new Error('absolute_private_output_required');
  let ancestor = path.resolve(output); while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (sameOrInside(fs.realpathSync.native(ancestor), fs.realpathSync.native(ROOT))) throw new Error('repository_output_forbidden');
  return { host, port, psql: file('TRACK_B_RECOVERY_TEST_PSQL'), pgDump: file('TRACK_B_RECOVERY_TEST_PG_DUMP'),
    user: required(env, 'TRACK_B_RECOVERY_TEST_PGUSER'), password: required(env, 'TRACK_B_RECOVERY_TEST_PGPASSWORD'), output };
}
function cleanEnv(password) {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG|^NIR_|^CARD_MATERIALIZATION_|^TRACK_B_RECOVERY_TEST_/i.test(key))),
    PGPASSWORD: password, PGCLIENTENCODING: 'UTF8', PGOPTIONS: '', PGCONNECT_TIMEOUT: '10' };
}
function connectionEnv(cfg, db, user, password) {
  return { ...cleanEnv(password), PGHOST: cfg.host, PGPORT: cfg.port, PGUSER: user, PGDATABASE: db.name };
}
class DB extends LocalDatabase {
  raw(sql, database) { return cp.spawnSync(this.config.psql, ['-w', ...this.args(database)], {
    input: "set time zone 'America/Guatemala';\n" + sql, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024,
    windowsHide: true, env: cleanEnv(this.config.password) }); }
}
function phase(cfg, db, kind, seed, name) {
  const report = path.join(cfg.output, name + '.private.json');
  const result = cp.spawnSync(process.execPath, ['--experimental-strip-types', path.join(ROOT, 'scripts/native-card-materialization/recovery-v7-phase.mjs')], {
    timeout: 120000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    env: { ...cleanEnv(cfg.password), NIR_PGHOST: cfg.host, NIR_PGPORT: cfg.port, NIR_PGUSER: db.config.user,
      NIR_PGDATABASE: db.name, NIR_PSQL: cfg.psql, CARD_MATERIALIZATION_FIXTURE: path.join(ROOT, 'scripts/native-card-materialization/fixture.mjs'),
      CARD_MATERIALIZATION_PHASE: kind, CARD_MATERIALIZATION_PHASE_REPORT: report, CARD_MATERIALIZATION_PHASE_SEED: seed || '' } });
  fs.writeFileSync(path.join(cfg.output, name + '.private.log'), (result.stdout || '') + (result.stderr || ''));
  assert.equal(result.status, 0, 'actual gateway/browser/SQL phase');
  return { report, value: JSON.parse(fs.readFileSync(report, 'utf8')) };
}
function grants(cfg, db, role, mode) {
  return cp.spawnSync(cfg.psql, ['-w', ...db.args(), '-v', 'mode=' + mode, '-v', 'existing_role=' + role,
    '-v', 'confirmation=' + (mode === 'capture' ? 'RECOVERY_CAPTURE_GRANTS_ONLY' : 'EMPTY_SCRATCH_TARGET_ONLY'),
    '-v', 'scratch_project_ref=abcdefghijklmnopqrst', '-f', path.join(ROOT, 'scripts/track-b-recovery-prerequisites.sql')], {
    encoding: 'utf8', timeout: 60000, windowsHide: true, env: cleanEnv(cfg.password) });
}
function publicCount(db) { return db.query("select (select count(*) from pg_class where relnamespace='public'::regnamespace)+(select count(*) from pg_proc where pronamespace='public'::regnamespace)+(select count(*) from pg_type where typnamespace='public'::regnamespace and typtype in('e','d','r','c'))"); }
function captureSequences(db) {
  return db.rows("select relname from pg_class where relnamespace='public'::regnamespace and relkind='S' order by relname")
    .map(row => JSON.parse(db.query(recovery.sequenceStateSql(row.relname))));
}
// Test-only require seam: executes the exact reconstruct module and real psql,
// refusing ONLY its independent post-COMMIT verify.sql subprocess. Portable on
// Windows/POSIX; no runtime engine hook or executable shell wrapper is added.
function postCommitRefusal() {
  const filename = path.join(ROOT, 'scripts/track-b-recovery-reconstruct.js'), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = module.paths; const counts = { apply: 0, refused: 0 };
  instance.require = id => id === 'child_process' ? { ...cp, spawnSync(tool, args, options) {
    if (args.some(arg => /[\\/]verify\.sql$/.test(arg))) { counts.refused++; return { status: 3, stderr: 'synthetic postcommit transport refusal' }; }
    if (args.some(arg => /[\\/]reconstruct\.sql$/.test(arg))) counts.apply++;
    return cp.spawnSync(tool, args, options);
  } } : module.require(id);
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  return { reconstruct: instance.exports.reconstruct, counts };
}
async function run() {
  const cfg = config(); fs.mkdirSync(cfg.output, { recursive: true });
  const output = fs.realpathSync.native(cfg.output); if (sameOrInside(output, fs.realpathSync.native(ROOT))) throw new Error('repository_output_forbidden');
  cfg.output = path.join(output, 'schema-v7-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(cfg.output); const checks = [], check = (name, fn) => { fn(); checks.push(name); };
  const source = new DB(cfg), target = new DB(cfg), quarantine = new DB(cfg), databases = [source, target, quarantine];
  const pins = Object.fromEntries(SOURCES.map(file => [file, sha(fs.readFileSync(path.join(ROOT, file)))]));
  const captureRole = source.name + '_capture', targetRole = target.name + '_target', quarantineRole = quarantine.name + '_target';
  const capturePassword = crypto.randomBytes(24).toString('hex'), targetPassword = crypto.randomBytes(24).toString('hex');
  const hmac = crypto.randomBytes(32).toString('base64'); let complete = false;
  let labelReplaySql, labelNewSql, labelCurrent, cutoffReceipt, cutoffState, cutoffDebt;
  try {
    for (const db of databases) db.create();
    setup(source, fs.readFileSync(path.join(ROOT, 'migrations/2026-09-05-calendar-feedback-recovery.sql'), 'utf8'));
    // Same declaration and two real Workload migrations as the integrated
    // Workload rehearsal. Its legacy population is empty and outside37.
    const baseline = fs.readFileSync(path.join(ROOT, 'migrations/live-schema-baseline-2026-07-03.sql'), 'utf8');
    const workload = baseline.match(/create table if not exists public\.workload_issues \([\s\S]*?\n\);/);
    assert.ok(workload); source.query(workload[0]);
    for (const file of ['2026-09-02-workload-native-view.sql', '2026-09-05-workload-native-membership.sql'])
      source.query(fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8'));
    for (const file of ['2026-09-05-crosswalk-bind-and-import.sql', '2026-09-06-native-card-materialization-boundary.sql']) source.query(fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8'));
    if (CORPUS === 'history-v8') for (const file of ['2026-09-05-native-label-catalog-foundation.sql', '2026-09-06-native-label-writes.sql', '2026-09-06-linear-outbound-cutoff.sql', '2026-09-06-native-existing-assignment.sql']) source.query(fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8'));
    const seeded = phase(cfg, source, 'seed', '', 'source');
    check('actual selected corpus schema contains four accepted cards and retained unknown ingress', () => {
      assert.equal(backup.resolveCorpus(CORPUS).tables.length, CORPUS === 'history-v8' ? 39 : 37); assert.equal(seeded.value.cases.length, 4);
      assert.ok(seeded.value.held.ingress_id); assert.equal(seeded.value.provider_attempts, 0);
      for (const table of backup.resolveCorpus(CORPUS).tables) assert.notEqual(source.query('select to_regclass(' + quote('public.' + table.name) + ')'), '');
      if (CORPUS === 'history-v8') {
      const labelVersion='00000000-0000-4000-8000-000000000700', teamVideo='00000000-0000-4000-8000-000000000900', teamGraphics='00000000-0000-4000-8000-000000000901';
      const node={id:'00000000-0000-4000-8000-000000000001',name:'Synthetic label',color:'#123456',description:null,isGroup:false,archivedAt:null,team:{id:teamVideo}};
      const manifest={schema_version:1,capture_id:'00000000-0000-4000-8000-000000000800',source_kind:'linear_workspace_issue_labels',source_sha256:'a'.repeat(64),workspace_fingerprint:'b'.repeat(64),captured_at:'2026-09-06T10:00:00Z',include_archived:true,teams:{video:teamVideo,graphics:teamGraphics},expected_count:1,pages:[{after:null,nodes:[node],pageInfo:{hasNextPage:false,endCursor:null}}]};
      const attestation={contract:'operator-reviewed-complete-export-v1',source_sha256:manifest.source_sha256,workspace_fingerprint:manifest.workspace_fingerprint,teams:manifest.teams,expected_count:1,capture_id:manifest.capture_id,export_package_sha256:'c'.repeat(64),review_evidence_sha256:'d'.repeat(64),operator_subject:'synthetic-operator',archived_pages_verified:true,independent_count_reconciled:true,reviewed_at:'2026-09-06T11:00:00Z'};
      source.query(`set role service_role;select public.production_label_catalog_stage_attested(${quote(labelVersion)}::uuid,${quote(JSON.stringify(manifest))}::jsonb,${quote(JSON.stringify(attestation))}::jsonb);`);
      source.query(`update public.syncview_runtime_flags set value=${quote(JSON.stringify({schema_version:1,mode:'native',version_id:labelVersion}))}::jsonb where key='production_native_label_catalog';`);
      assert.equal(source.query("select count(*) from public.production_label_catalog_versions"), '1'); assert.equal(source.query("select count(*) from public.linear_outbound_cutoff_control where lane='mirror_outbox'"), '1');
      const labelRow=source.rows("select id,client_slug,team,updated_at from public.deliverables where team='video' order by id limit 1")[0]; assert.ok(labelRow);
      source.query(`update public.deliverables set linear_raw=${quote(JSON.stringify({issue:{labelIds:[],labels:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}))}::jsonb where id=${quote(labelRow.id)};`);
      const current=source.rows(`select * from public.deliverables where id=${quote(labelRow.id)}`)[0], generation=Number(source.query("select generation from public.track_b_f27_team_fences where team='video'"));
      const labelEvent={surface:'production',auth_kind:'staff',source:'ui',action:'labels_change',actor:'synthetic-operator',role:'admin',expected_updated_at:current.updated_at,outbound:{operation:'labels',entity:'deliverable',entity_id:current.id,test_only:false,legacy_parity:false,dedup_key:'write-ui:labels:deliverable:'+current.id+':v8',payload:{_intent_fingerprint:'v8-native-label-receipt',_native_label_catalog_version:labelVersion,label_ids:[node.id],_f27_authority_generation:generation}}};
      const shape=source.rows(`select jsonb_typeof(linear_raw->'issue'->'labels'->'nodes') nodes_type,jsonb_typeof(linear_raw->'issue'->'labelIds') ids_type from public.deliverables where id=${quote(current.id)}`)[0];
      assert.deepEqual(shape,{nodes_type:'array',ids_type:'array'}); assert.equal(Array.isArray(labelEvent.outbound.payload.label_ids),true);
      source.query(`set role service_role;select public.production_labels_write(${quote(JSON.stringify(current))}::jsonb,${quote(JSON.stringify(labelEvent))}::jsonb);`);
      assert.equal(source.query("select count(*) from public.mirror_outbox where payload ? '_native_label_catalog_version' and status='skipped'"), '1');
      labelReplaySql = `set role service_role;select to_jsonb(public.production_labels_write(${quote(JSON.stringify(current))}::jsonb,${quote(JSON.stringify(labelEvent))}::jsonb))::text;`;
      source.query(`update public.deliverables set title='Later retained human label title' where id=${quote(current.id)};`);
      labelCurrent = source.rows(`select * from public.deliverables where id=${quote(current.id)}`)[0];
      assert.deepEqual(labelCurrent.linear_raw.issue.labelIds, [node.id]);
      const newEvent = JSON.parse(JSON.stringify(labelEvent));
      newEvent.expected_updated_at = labelCurrent.updated_at;
      newEvent.outbound.dedup_key += '-new'; newEvent.outbound.payload._intent_fingerprint += '-new';
      labelNewSql = `set role service_role;select public.production_labels_write(${quote(JSON.stringify(labelCurrent))}::jsonb,${quote(JSON.stringify(newEvent))}::jsonb);`;
      source.query(`update public.syncview_runtime_flags set value='{"schema_version":1,"mode":"hold","version_id":null}'::jsonb where key='production_native_label_catalog';`);
    } else assert.equal(source.query("select to_regclass('public.production_label_catalog_versions')"), '');
    });
    const deliverable = source.rows("select id,team from public.deliverables where team='video' order by id limit 1")[0];
    assert.ok(deliverable);
    const comment = { id: 'schema-v7-comment', native_comment_id: 'schema-v7-comment', idempotency_key: 'schema-v7-add',
      deliverable_id: deliverable.id, team: deliverable.team, author_key: 'synthetic-staff', author_name: 'Synthetic staff',
      role: 'admin', body: 'Synthetic retained canonical note', audience: 'internal', source_updated_at: '2026-09-06T00:00:00Z' };
    const event = { actor: 'synthetic-staff', role: 'admin', action: 'add', source: 'ui', outbound: { entity: 'comment',
      entity_id: deliverable.id, operation: 'comment', team: 'video', dedup_key: 'schema-v7-add', payload: {
        _intent_fingerprint: 'synthetic-schema-v7-add', _f27_legacy_parity: false,
        _f27_authority_generation: Number(source.query("select generation from public.track_b_f27_team_fences where team='video'")) } } };
    const commentSql = `set role service_role;select public.production_comment_write(${quote(JSON.stringify(comment))}::jsonb,${quote(JSON.stringify(event))}::jsonb);`;
    source.query(commentSql);
    check('canonical note and its accepted receipt coexist with actual native card receipts', () => {
      assert.equal(source.query("select count(*) from public.production_comments where id='schema-v7-comment'"), '1');
      assert.equal(source.query("select count(*) from public.mirror_outbox where dedup_key='schema-v7-add'"), '1');
    });
    if (CORPUS === 'history-v8') check('cutoff retains a real pre-cutoff queued receipt and refuses its valid lease request', () => {
      cutoffReceipt = source.rows("select id,status,outbound_generation from public.mirror_outbox where dedup_key='schema-v7-add'")[0];
      assert.equal(cutoffReceipt.status, 'pending'); assert.equal(cutoffReceipt.outbound_generation, 0);
      // Roll back an actual successful claim to prove this exact row and call
      // were eligible before cutoff; no external worker is run.
      assert.equal(source.query(`begin;set role service_role;select (public.linear_outbound_claim_v1(${cutoffReceipt.id},'pending',600) is not null)::text;rollback;`), 'true');
      assert.equal(source.query("select (public.linear_outbound_cutoff_activate_v1(0,'synthetic-operator')->>'cutoff_enabled')"), 'true');
      assert.equal(source.query(`set role service_role;select (public.linear_outbound_claim_v1(${cutoffReceipt.id},'pending',600) is null)::text;`), 'true');
      cutoffState = source.rows("select * from public.linear_outbound_cutoff_control order by lane");
      cutoffDebt = source.rows("select * from public.linear_outbound_cutoff_debt_v1 order by id");
      assert.equal(cutoffState[0].generation, 1);
      assert.equal(cutoffDebt.find(r => String(r.id) === String(cutoffReceipt.id)).disposition, 'unclaimed_before_cutoff');
    });
    source.query(`create sequence public.synthetic_large_seq as bigint; select setval('public.synthetic_large_seq',9007199254740993,true);
      create sequence public.synthetic_uncalled_seq as bigint start with 9000; create sequence public.synthetic_fresh_seq as bigint;
      create role ${captureRole} login bypassrls password ${quote(capturePassword)};
      create role ${targetRole} login password ${quote(targetPassword)}; create role ${quarantineRole} login password ${quote(targetPassword)};`);
    for (const db of [target, quarantine]) db.query(TARGET_PREREQUISITES);
    check('capture role refuses write privilege and target refuses BYPASSRLS before narrow grants', () => {
      source.query(`grant insert on public.calendar_posts to ${captureRole}`); assert.notEqual(grants(cfg, source, captureRole, 'capture').status, 0);
      source.query(`revoke insert on public.calendar_posts from ${captureRole}`);
      assert.equal(grants(cfg, source, captureRole, 'capture').status, 0);
      target.query(`alter role ${targetRole} bypassrls`); assert.notEqual(grants(cfg, target, targetRole, 'target').status, 0);
      target.query(`alter role ${targetRole} nobypassrls`);
      for (const [db, role] of [[target, targetRole], [quarantine, quarantineRole]]) assert.equal(grants(cfg, db, role, 'target').status, 0);
      assert.equal(publicCount(target), '0');
    });
    const sourceEnv = connectionEnv(cfg, source, captureRole, capturePassword), targetEnv = connectionEnv(cfg, target, targetRole, targetPassword);
    check('both restricted connections require SCRAM/password authentication', () => {
      for (const env of [sourceEnv, targetEnv]) for (const password of ['wrong', '']) {
        const refused = cp.spawnSync(cfg.psql, ['-w', '-X', '-c', 'select 1'], { env: { ...env, PGPASSWORD: password }, encoding: 'utf8', timeout: 15000 });
        assert.notEqual(refused.status, 0); assert.match(refused.stderr, /password authentication failed|no password supplied|fe_sendauth/);
      }
    });
    const packet = path.join(cfg.output, 'schema.private.recovery'), opts = { psql: cfg.psql, pgDump: cfg.pgDump,
      env: sourceEnv, corpusName: CORPUS, hmacInput: hmac,
      sourceUrl: `postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres` };
    let raced; try { await recovery.captureRecoveryPackage({ ...opts, output: packet + '.raced', hooks: { afterDumps: () => source.query('alter table public.calendar_posts add column synthetic_race text') } }); } catch (e) { raced = e; }
    source.query('alter table public.calendar_posts drop column if exists synthetic_race');
    check('catalog drift is refused and publishes no partial package', () => { assert.ok(raced); assert.match(raced.message, /catalog change/); assert.equal(fs.existsSync(packet + '.raced'), false); });
    // A deliberate synthetic negative, not deletion of a sampled dependency to
    // obtain a passing capture. No rows enter the CHECK table and the writing
    // function is never intentionally called by this fixture.
    source.query(`create function public.synthetic_capture_write() returns void language plpgsql immutable as $$
      begin update public.calendar_posts set name=name where false; end;$$;
      create function public.synthetic_capture_check(p text) returns boolean language plpgsql immutable as $$
      declare marker text; begin marker := '/*'; perform public.synthetic_capture_write(); marker := '*/'; return true; end;$$;
      create table public.synthetic_capture_negative(id text primary key,body text check(public.synthetic_capture_check(body)));`);
    assert.equal(grants(cfg, source, captureRole, 'capture').status, 0);
    let impure; try { await recovery.captureRecoveryPackage({ ...opts, output: packet + '.impure' }); } catch (e) { impure = e; }
    fs.writeFileSync(path.join(cfg.output, 'impure-capture.private.log'), String(impure && impure.stack || 'CAPTURE_UNEXPECTEDLY_ACCEPTED'));
    check('actual capture refuses a writing callable concealed between comment-like string literals', () => {
      assert.ok(impure); assert.match(impure.message, /impure public callable|writing statement/); assert.equal(fs.existsSync(packet + '.impure'), false);
    });
    source.query('drop table public.synthetic_capture_negative;drop function public.synthetic_capture_check(text);drop function public.synthetic_capture_write();');
    const summary = await recovery.captureRecoveryPackage({ ...opts, output: packet });
    const bytes = fs.readFileSync(packet), pkg = recovery.readRecoveryPackage(bytes, hmac), before = unionImages(source), sequences = captureSequences(source);
    check('authenticated schema and all selected corpus data sections bind exact observed corpus', () => {
      assert.equal(summary.ok, true); assert.equal(summary.corpus, CORPUS); assert.equal(summary.data_table_count, backup.resolveCorpus(CORPUS).tables.length);
      assert.deepEqual(Object.keys(pkg.manifest.data.tables).sort(), backup.resolveCorpus(CORPUS).tables.map(t => t.name).sort());
      assert.equal(pkg.manifest.schema.fingerprint, source.query(recovery.fingerprintSql()));
      assert.ok(Object.values(pkg.manifest.data.tables).every(t => /^[0-9a-f]{64}$/.test(t.digest_sha256)));
      assert.equal(pkg.manifest.schema.egress_capable_functions, 0);
      const large = pkg.manifest.sequences.find(s => s.name === 'synthetic_large_seq'); assert.equal(large.last_value, '9007199254740993');
      assert.equal(pkg.manifest.sequences.find(s => s.name === 'synthetic_uncalled_seq').is_called, false);
    });
    check('wrong HMAC and prior data readers refuse the selected newer package', () => {
      assert.throws(() => recovery.readRecoveryPackage(bytes, crypto.randomBytes(32).toString('base64')), /authentication failed/);
      assert.throws(() => backup.parseStrictPgDump(pkg.data, 'history-v6'), /Unexpected table/);
      if (CORPUS === 'history-v8') assert.throws(() => backup.parseStrictPgDump(pkg.data, 'history-v7'), /Unexpected table/);
    });
    const diagnosticDir = path.join(cfg.output, 'diagnostics');
    check('data alone cannot reconstruct the empty target', () => {
      const refused = cp.spawnSync(cfg.psql, ['-w', '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: 'begin;\n' + backup.renderSafeCopySections(pkg.data, CORPUS) + '\ncommit;', env: targetEnv, encoding: 'utf8', timeout: 60000 });
      assert.notEqual(refused.status, 0); assert.match(refused.stderr, /does not exist/); assert.equal(publicCount(target), '0');
    });
    check('permission race and in-transaction digest failure leave a genuinely empty target', () => {
      target.query(`grant pg_read_server_files to ${targetRole}`); assert.throws(() => reconstruct(pkg, targetEnv, { psql: cfg.psql, diagnosticDir }));
      assert.equal(publicCount(target), '0'); target.query(`revoke pg_read_server_files from ${targetRole}`);
      const malformed = { ...pkg, manifest: { ...pkg.manifest, data: { ...pkg.manifest.data, tables: { ...pkg.manifest.data.tables,
        clients: { ...pkg.manifest.data.tables.clients, digest_sha256: 'd'.repeat(64) } } } } };
      let error; try { reconstruct(malformed, targetEnv, { psql: cfg.psql, diagnosticDir }); } catch (e) { error = e; }
      assert.ok(error); assert.equal(error.outcome, OUTCOMES.ROLLED_BACK); assert.equal(error.receipt.retry_in_place_allowed, true); assert.equal(publicCount(target), '0');
    });
    check('late37th-table COPY refusal rolls earlier schema and data back', () => {
      const section = backup.parseStrictPgDump(pkg.data, CORPUS).tables.production_card_materialization_ingress;
      const text = pkg.data.toString('utf8'), header = `COPY public.production_card_materialization_ingress (${section.columns.join(', ')}) FROM stdin;`;
      const at = text.indexOf(header); assert.ok(at >= 0); const start = at + header.length + 1, end = text.indexOf('\n', start);
      const fields = text.slice(start, end).split('\t'), raw = section.columns.indexOf('raw_body'); assert.ok(raw >= 0);
      fields[raw] = String.raw`\N`; const broken = { ...pkg, data: Buffer.from(text.slice(0, start) + fields.join('\t') + text.slice(end)) };
      let error; try { reconstruct(broken, targetEnv, { psql: cfg.psql, diagnosticDir }); } catch (e) { error = e; }
      assert.ok(error); assert.match(error.detail, /null value.*raw_body.*violates not-null constraint/);
      assert.equal(error.outcome, OUTCOMES.ROLLED_BACK); assert.equal(publicCount(target), '0');
    });
    const restored = reconstruct(pkg, targetEnv, { psql: cfg.psql, diagnosticDir });
    check('restricted empty-target schema reconstruction verifies exact corpus raw row images and sequences', () => {
      assert.equal(restored.outcome, OUTCOMES.VERIFIED); assert.equal(restored.data_table_count, backup.resolveCorpus(CORPUS).tables.length);
      assert.equal(restored.schema_fingerprint_match, true); assert.equal(restored.content_digests_match, true);
      assert.deepEqual(unionImages(target), before); assert.deepEqual(captureSequences(target), sequences);
      for (const db of [source, target]) {
        assert.equal(db.query("select nextval('public.synthetic_large_seq')::text"), '9007199254740994');
        assert.equal(db.query("select nextval('public.synthetic_uncalled_seq')::text"), '9000');
        assert.equal(db.query("select nextval('public.synthetic_fresh_seq')::text"), '1');
      }
    });
    const current = unionImages(target), replay = phase(cfg, target, 'replay', seeded.report, 'replay');
    check('restored receipts replay four current human-edited cards in hold without rewriting any owner', () => {
      assert.equal(replay.value.replayed, 4); assert.equal(replay.value.provider_attempts, 0);
      const after = unionImages(target), other = rows => rows.filter(row => row.table_name !== 'production_card_materialization_ingress');
      assert.deepEqual(other(after), other(current));
      const prior = new Set(current.filter(row => row.table_name === 'production_card_materialization_ingress').map(row => row.image));
      const incoming = after.filter(row => row.table_name === 'production_card_materialization_ingress');
      assert.equal(incoming.length, prior.size + 4); for (const image of prior) assert.ok(incoming.some(row => row.image === image));
      assert.equal(new Set(replay.value.ingress_ids).size, 4);
      const rows = target.rows(`select raw_body,raw_sha256,outcome from public.production_card_materialization_ingress where id=any(array[${replay.value.ingress_ids.map(quote).join(',')}]::uuid[])`);
      assert.equal(rows.length, 4); for (const row of rows) { assert.ok(seeded.value.cases.some(c => c.raw_body === row.raw_body)); assert.equal(row.raw_sha256, sha(row.raw_body)); assert.equal(row.outcome.ok, true); }
    });
    check('retained corpus evidence keeps anonymous privacy and mutation/TRUNCATE guards after reconstruction', () => {
      for (const name of ['production_card_materialization_receipts', 'production_card_materialization_ingress', 'card_change_journal']) {
        for (const role of ['anon', 'authenticated']) assert.notEqual(target.raw(`set role ${role};select * from public.${name}`).status, 0);
        // Journal identity is GENERATED ALWAYS: assigning it is rejected before
        // the immutable-row trigger. Use an ordinary column to reach the guard.
        const unchanged = name === 'card_change_journal' ? 'operation=operation' : 'id=id';
        for (const sql of [`update public.${name} set ${unchanged}`, `delete from public.${name}`, `truncate public.${name}`]) {
          const prior = unionImages(target), refused = target.raw(sql); assert.notEqual(refused.status, 0);
          assert.match(refused.stderr, /card_materialization_evidence_retained|card_change_journal_immutable/); assert.deepEqual(unionImages(target), prior);
        }
      }
      assert.equal(target.query('select count(*) from pg_foreign_server'), '0');
      assert.equal(target.query("select count(*) from pg_publication_tables where schemaname='public'"), '0');
    });
    check('restored canonical add receipt replays without duplicating current or historical rows', () => {
      const beforeReplay = unionImages(target); target.query(commentSql); assert.deepEqual(unionImages(target), beforeReplay);
    });
    if (CORPUS === 'history-v8') {
      check('restored accepted native label receipt replays current edited state under hold without any corpus mutation', () => {
        const beforeReplay = unionImages(target);
        assert.deepEqual(JSON.parse(target.query(labelReplaySql)), labelCurrent);
        assert.deepEqual(unionImages(target), beforeReplay);
        const refused = target.raw(labelNewSql); assert.notEqual(refused.status, 0);
        assert.match(refused.stderr, /native_label_catalog_held/); assert.deepEqual(unionImages(target), beforeReplay);
      });
      check('restored cutoff generation and debt preserve stale-worker refusal and restricted catalog access', () => {
        const prior = unionImages(target);
        assert.deepEqual(target.rows("select * from public.linear_outbound_cutoff_control order by lane"), cutoffState);
        assert.deepEqual(target.rows("select * from public.linear_outbound_cutoff_debt_v1 order by id"), cutoffDebt);
        assert.equal(target.query(`set role service_role;select (public.linear_outbound_claim_v1(${cutoffReceipt.id},'pending',600) is null)::text;`), 'true');
        const refused = target.raw("set role service_role;select public.linear_outbound_cutoff_activate_v1(0,'synthetic-operator');");
        assert.notEqual(refused.status, 0); assert.match(refused.stderr, /linear_cutoff_generation_conflict/);
        for (const role of ['anon', 'authenticated']) for (const table of ['production_label_catalog_versions','linear_outbound_cutoff_control']) {
          const read = target.raw(`set role ${role};select * from public.${table}`); assert.notEqual(read.status, 0); assert.match(read.stderr, /permission denied/);
        }
        for (const statement of ['update public.production_label_catalog_versions set manifest=manifest','delete from public.production_label_catalog_versions','truncate public.production_label_catalog_versions']) {
          const write = target.raw(statement); assert.notEqual(write.status, 0); assert.match(write.stderr, /label_catalog_immutable/);
        }
        assert.deepEqual(unionImages(target), prior);
      });
    }
    check('post-COMMIT verification transport refusal preserves the complete quarantined target', () => {
      const seam = postCommitRefusal(), env = connectionEnv(cfg, quarantine, quarantineRole, targetPassword);
      let error; try { seam.reconstruct(pkg, env, { psql: cfg.psql, diagnosticDir }); } catch (e) { error = e; }
      assert.ok(error); assert.equal(error.outcome, OUTCOMES.COMMITTED_UNVERIFIED); assert.equal(error.receipt.retry_in_place_allowed, false);
      assert.equal(error.receipt.quarantine_required, true); assert.deepEqual(seam.counts, { apply: 1, refused: 1 });
      assert.deepEqual(unionImages(quarantine), before); assert.ok(fs.existsSync(error.receipt.diagnostic_file));
      assert.throws(() => reconstruct(pkg, env, { psql: cfg.psql, diagnosticDir }), /reconstruction failed/);
      assert.deepEqual(unionImages(quarantine), before);
    });
    const report = { status: 'PASS', classification: 'ISOLATED_MIGRATION_SHAPED_SCHEMA_DATA_REPLAY', passed: checks.length, checks,
      corpus: CORPUS, table_count: backup.resolveCorpus(CORPUS).tables.length, package_sha256: sha(bytes), source_sha256: pins,
      data_coverage: pkg.manifest.data.tables, omitted_data_tables: pkg.manifest.omitted_data_tables,
      limits: ['Synthetic migration-shaped source; installed capture/reconstruction remains UNPROVEN',
        'Whole public schema plus selected corpus data, not a full platform or omitted-data backup',
        'Callable lexical source is independently reviewed; execution coverage is limited to this fixture',
        'No serving adapter, provider, workflow, alert or live action'] };
    fs.writeFileSync(path.join(cfg.output, 'REPORT.private.json'), JSON.stringify(report, null, 2)); complete = true;
    console.log(JSON.stringify({ status: 'PASS', passed: checks.length, table_count: backup.resolveCorpus(CORPUS).tables.length }));
  } catch (error) {
    fs.writeFileSync(path.join(cfg.output, 'FAILURE.private.log'), String(error.stack || error) + '\n' + String(error.detail || ''));
    console.log(JSON.stringify({ status: 'FAIL', code: 'LOCAL_SCHEMA_REHEARSAL_FAILED', completed_checks: checks.length })); process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(cfg.output, 'DATABASES.private.json'), JSON.stringify({ databases: databases.map(db => db.name), retained: true, complete }));
  }
}
if (require.main === module) run().catch(() => { console.log(JSON.stringify({ status: 'FAIL', code: 'LOCAL_SCHEMA_CONFIGURATION_FAILED' })); process.exitCode = 1; });
module.exports = { run, config, cleanEnv, connectionEnv, DB, postCommitRefusal, SOURCES };
