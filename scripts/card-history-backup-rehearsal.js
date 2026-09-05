'use strict';

// Local synthetic proof of the ACTUAL 21-table dump/package/restore path.
// No cloud connection, Drive call, provider worker or alert. The unmerged
// PR #1293 prerequisite is explicit and hash-bound, never silently stubbed.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { LocalDatabase, localConfig, bootstrap, source } = require('./card-change-journal-rehearsal');
const backup = require('./track-b-backup');
const restore = require('./track-b-restore-rehearsal');
const ROOT = path.resolve(__dirname, '..');
const MANIFEST_COMMIT = '5418ab5618595d9469f0527bd94623e9229a637e';
const MANIFEST_HASH = '39ac761471e67b2f9e66d78a9783a374070b924cf6abf6d67aeee79da01cfcf1';
const literal = value => "'" + String(value).replace(/'/g, "''") + "'";
const json = value => literal(JSON.stringify(value)) + '::jsonb';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const PROOF_FILES = ['scripts/card-history-backup-rehearsal.js', 'scripts/card-change-journal-rehearsal.js',
  'scripts/track-b-backup.js', 'scripts/track-b-restore-rehearsal.js',
  'scripts/track-b-history-backup-prerequisites.sql', 'migrations/2026-09-05-card-change-journal.sql'];
const sourceHashes = () => Object.fromEntries(PROOF_FILES.map(file => [file, sha(fs.readFileSync(path.join(ROOT, file)))]));

function prerequisite() {
  const file = process.env.CARD_HISTORY_MANIFEST_SQL;
  if (!file) throw new Error('explicit_PR1293_manifest_SQL_required');
  const sql = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (sha(sql) !== MANIFEST_HASH) throw new Error('PR1293_manifest_SQL_hash_mismatch');
  return sql;
}

function prepare(db, manifestSql) {
  bootstrap(db);
  // Real authority/security relation definitions, not id-only backup mocks.
  db.query(source('2026-07-05-b0-linear-auth-scaffold.sql'));
  db.query(source('2026-07-11-b4-write-attribution.sql'));
  db.query('alter table public.clients add column if not exists lead_member_id uuid references public.team_members(id);');
  db.query(manifestSql);
}

function applyPrerequisites(db, role, mode) {
  const filename = path.join(ROOT, 'scripts/track-b-history-backup-prerequisites.sql');
  const args = [...db.args(), '-v', 'mode=' + mode, '-v', 'existing_role=' + role,
    '-v', 'confirmation=' + (mode === 'backup' ? 'HISTORY_BACKUP_GRANTS_ONLY' : 'DISPOSABLE_SCRATCH_ONLY'),
    '-v', 'scratch_project_ref=abcdefghijklmnopqrst', '-f', filename];
  const r = spawnSync(db.config.psql, args, { encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: process.env.CARD_HISTORY_PGPASSWORD || '', PGOPTIONS: '' } });
  if (r.status !== 0) throw new Error('local_prerequisites_failed: ' + r.stderr);
}

function seed(db) {
  const batch = { id: 'backup-batch', client_slug: 'historyfixture', team: 'video', name: 'Original backup parent' };
  const row = { id: 'backup-deliverable', batch_id: batch.id, client_slug: batch.client_slug, team: 'video', kind: 'video', title: 'Original work' };
  const event = { actor: 'synthetic-staff', actor_key: 'synthetic-staff', role: 'admin', auth_kind: 'staff', surface: 'submit',
    action: 'create', source: 'ui', ts: '2026-09-05T00:00:00Z', outbound: { entity: 'batch', entity_id: batch.id, operation: 'create', team: 'video',
      dedup_key: 'write-ui:create:batch:backup-batch:backup-request:video', source_edited_at: '2026-09-05T00:00:00Z',
      payload: { _intent_fingerprint: 'synthetic-parent-fingerprint' } } };
  const manifest = { request_id: 'backup-request', request_intent: { surface: 'submit', synthetic: true },
    expected_items: [{ item_index: 0, row, child_dedup: 'write-ui:create:deliverable:backup-deliverable:backup-request',
      child_fingerprint: 'synthetic-child-fingerprint' }] };
  db.query(`set role service_role; select public.production_intake_root_begin(${json(batch)},${json(event)},${json(manifest)});
    select public.production_deliverable_write(${json(row)},${json({ ...event, outbound: { entity: 'deliverable', entity_id: row.id, operation: 'create', team: 'video', dedup_key: 'synthetic-child', payload: { _intent_fingerprint: 'synthetic-child' } } })});`);
  db.query(`insert into public.calendar_posts(client,id,name,video_deliverable_id,caption) values('historyfixture','backup-card','Original calendar','backup-deliverable',E'Unicode café\\nLine two\\tTab');
    insert into public.sample_reviews(client,id,name,video_deliverable_id) values('historyfixture','backup-card','Original Samples','backup-deliverable');
    insert into public.workload_plan(issue_id,client,plan_date,updated_by) values('synthetic-provider-id','historyfixture','2026-09-05','synthetic-staff');
    insert into public.client_access(slug,review_token) values('historyfixture','synthetic-invalid-token');
    insert into public.client_access_events(slug,ok) values('historyfixture',true);
    insert into public.syncview_auth_events(surface,client_slug,ok) values('synthetic','historyfixture',true);
    insert into public.settings_events(surface,client_slug,payload) values('synthetic','historyfixture','{"before":"original"}');
    insert into public.flag_flips(key,old_value,new_value) values('synthetic','{}','{"test":true}');
    insert into public.linear_archive(linear_uuid,client_slug,title,raw) values('synthetic-archive','historyfixture','Retained archived title','{"synthetic":true}');
    insert into public.calendar_post_events(client,post_id,action,payload) values('historyfixture','backup-card','comment_add','{"body":"Original source note"}');
    insert into public.sample_review_events(client,sample_id,action,payload) values('historyfixture','backup-card','comment_add','{"body":"Original Samples note"}');
  `);
  const comment = { id: 'backup-comment', idempotency_key: 'backup-comment', deliverable_id: row.id,
    team: 'video', author_key: 'synthetic-staff', author_name: 'Synthetic staff', role: 'admin', body: 'Original canonical note', audience: 'internal', source_updated_at: '2026-09-05T00:00:00Z' };
  db.query(`set role service_role; select public.production_comment_upsert(${json(comment)},'{}');`);
  db.query(`update public.calendar_posts set name='Final calendar',video_tweaks='[{"id":"synthetic-note","body":"Edited note"}]' where id='backup-card';
    update public.sample_reviews set name='Final Samples',status='Approved' where id='backup-card';
    update public.workload_plan set plan_date='2026-09-10' where issue_id='synthetic-provider-id';
    update public.batches set name='Final parent' where id='backup-batch';
    update public.deliverables set title='Final work',due_date='2026-09-11' where id='backup-deliverable';
    update public.production_comments set body='Final canonical note',version=2 where id='backup-comment';
    insert into public.calendar_posts(client,id,name) values('historyfixture','deleted-card','Deleted card retained');
    delete from public.calendar_posts where id='deleted-card';`);
}

function fullRows(db) {
  return Object.fromEntries(backup.HISTORY_TABLES.map(({ name }) => [name,
    db.rows(`select to_jsonb(t) image from public.${name} t order by to_jsonb(t)::text`).map(r => r.image)]));
}
function triggerRows(db) {
  return db.rows("select c.relname,t.tgname,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname");
}

async function run() {
  const frozenSources = sourceHashes();
  const manifestSql = prerequisite();
  const config = localConfig();
  const from = new LocalDatabase(config), to = new LocalDatabase(config);
  const backupRole = from.name + '_backup', restoreRole = to.name + '_restore';
  const files = fs.mkdtempSync(path.join(os.tmpdir(), 'card-history-backup-'));
  const checks = [], check = (name, fn) => { fn(); checks.push(name); };
  const hmac = crypto.randomBytes(32).toString('base64');
  const rolePassword = crypto.randomBytes(24).toString('hex');
  let completed = false;
  from.create(); to.create();
  try {
    prepare(from, manifestSql); prepare(to, manifestSql); seed(from);
    from.query(`create role ${backupRole} login bypassrls password ${literal(rolePassword)}; create role ${restoreRole} login bypassrls password ${literal(rolePassword)};`);
    applyPrerequisites(from, backupRole, 'backup'); applyPrerequisites(to, restoreRole, 'scratch');
    const privileges = from.query(`set role ${backupRole}; ${backup.readOnlyPrivilegeSql('history-v4')};`);
    check('actual private backup role has exact21 SELECT and no table write privileges', () => assert.equal(backup.verifyReadOnlyPrivilegeOutput(privileges, 'history-v4'), true));
    const original = fullRows(from);
    check('all21 real corpus tables have nonempty synthetic content', () => assert.ok(Object.values(original).every(rows => rows.length > 0)));
    const dumpPath = path.join(files, 'history.sql'), packagePath = path.join(files, 'history.snapshot');
    const r = spawnSync(process.env.CARD_HISTORY_PGDUMP || 'pg_dump', [...backup.pgDumpArgs(dumpPath, 'history-v4'),
      '-h', config.host, '-p', config.port, '-U', backupRole, '-d', from.name], { encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: rolePassword, PGOPTIONS: '-c default_transaction_read_only=on -c timezone=UTC' } });
    if (r.status !== 0) throw new Error('local_pg_dump_failed: ' + (r.stderr || r.error));
    // A syntactically valid production-origin URL is metadata only for this
    // existing pure package API. It is NEVER passed to a connection tool.
    const metadataUrl = `postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres?sslmode=require`;
    backup.packSnapshot(dumpPath, packagePath, new Date().toISOString(), metadataUrl, hmac, 'history-v4');
    const snapshot = backup.readSnapshotFile(packagePath, hmac);
    check('real pg_dump is authenticated as exact21 history-v4 with composite card keys', () => {
      assert.equal(snapshot.manifest.table_count, 21);
      assert.deepEqual(snapshot.manifest.tables.calendar_posts.primary_key, ['client', 'id']);
    });
    const apply = sql => {
      const originalConfig = to.config; to.config = { ...to.config, user: restoreRole, password: rolePassword };
      try { return to.raw(sql); } finally { to.config = originalConfig; }
    };
    to.query("select setval('public.card_change_journal_id_seq',10000,true); insert into public.calendar_posts(client,id,name) values('historyfixture','scratch-existing','Existing scratch value');");
    const before = fullRows(to), beforeTriggers = triggerRows(to);
    const sequenceBefore = Number(to.query('select last_value from public.card_change_journal_id_seq'));
    const invalidCopy = snapshot.dumpBytes.toString('utf8').replace('Final calendar', 'Final calendar\textra-unexpected-column');
    const failed = apply(restore.restoreSql(invalidCopy, 'history-v4'));
    check('failed actual COPY rolls back prior data and every trigger state', () => {
      assert.notEqual(failed.status, 0); assert.deepEqual(fullRows(to), before); assert.deepEqual(triggerRows(to), beforeTriggers);
    });
    const commentTable = snapshot.parsed.tables.production_comments;
    const badParentFields = commentTable.rows[0].split('\t');
    badParentFields[commentTable.columns.indexOf('parent_id')] = 'synthetic-missing-parent';
    const invalidParentDump = snapshot.dumpBytes.toString('utf8').replace(commentTable.rows[0], badParentFields.join('\t'));
    const deferredFailure = apply(restore.restoreSql(invalidParentDump, 'history-v4'));
    check('deferred FK refusal preserves data, trigger state and existing sequence floor', () => {
      assert.notEqual(deferredFailure.status, 0); assert.match(deferredFailure.stderr, /foreign key constraint/);
      assert.deepEqual(fullRows(to), before); assert.deepEqual(triggerRows(to), beforeTriggers);
      assert.equal(Number(to.query('select last_value from public.card_change_journal_id_seq')), sequenceBefore);
    });
    to.query('create table public.synthetic_excluded_reference(id text primary key, batch_id text references public.batches(id));');
    const externalFk = apply(restore.restoreSql(snapshot.dumpBytes, 'history-v4'));
    check('even empty omitted incoming-FK table refuses restore with unchanged data and triggers', () => {
      assert.notEqual(externalFk.status, 0); assert.match(externalFk.stderr, /omitted incoming foreign key/);
      assert.deepEqual(fullRows(to), before); assert.deepEqual(triggerRows(to), beforeTriggers);
    });
    to.query('drop table public.synthetic_excluded_reference;');
    const legacyDump = Buffer.from('-- PostgreSQL database dump\n' + backup.TABLES.map(c => {
      const t = snapshot.parsed.tables[c.name]; return `COPY public.${c.name} (${t.columns.join(', ')}) FROM stdin;\n${t.rows.join('\n')}${t.rows.length ? '\n' : ''}\\.\n`;
    }).join(''));
    const refusedLegacy = apply(restore.restoreSql(legacyDump, 'legacy-v3'));
    check('limited legacy package refuses expanded target before altering any row or trigger', () => {
      assert.notEqual(refusedLegacy.status, 0); assert.match(refusedLegacy.stderr, /Legacy Track-B package/);
      assert.deepEqual(fullRows(to), before); assert.deepEqual(triggerRows(to), beforeTriggers);
    });
    const lateFailureSql = restore.restoreSql(snapshot.dumpBytes, 'history-v4').replace(/\ncommit;\n$/, '\nselect 1/0;\ncommit;\n');
    const lateFailure = apply(lateFailureSql);
    check('failure after sequence adjustment cannot rewind counters or lose retained target rows', () => {
      assert.notEqual(lateFailure.status, 0); assert.match(lateFailure.stderr, /division by zero/);
      assert.deepEqual(fullRows(to), before); assert.deepEqual(triggerRows(to), beforeTriggers);
      assert.ok(Number(to.query('select last_value from public.card_change_journal_id_seq')) >= sequenceBefore);
    });
    const success = apply(restore.restoreSql(snapshot.dumpBytes, 'history-v4'));
    if (success.status !== 0) throw new Error('local_full_restore_failed: ' + success.stderr);
    check('all21 restored table rows exactly equal full original typed values', () => assert.deepEqual(fullRows(to), original));
    check('actual restored counts and core FK verification agree', () => assert.equal(restore.verifyCounts(snapshot.manifest, restore.parseVerification(to.query(restore.verifySql('history-v4')))), true));
    check('restored journal retains old/deleted body images and manifest original intent', () => {
      assert.ok(original.card_change_journal.some(r => r.row_before && r.row_before.body === 'Original canonical note'));
      assert.ok(original.card_change_journal.some(r => r.operation === 'DELETE' && r.row_before.id === 'deleted-card'));
      assert.equal(original.production_intake_manifests[0].batch_snapshot.name, 'Original backup parent');
      assert.equal(original.batches[0].name, 'Final parent');
    });
    check('all restored user triggers return to original enabled state without replay egress', () => {
      assert.deepEqual(triggerRows(to), beforeTriggers);
      assert.equal(to.query('select count(*) from pg_foreign_server'), '0');
      assert.equal(to.query("select count(*) from pg_extension where extname not in ('plpgsql','pgcrypto')"), '0');
      assert.deepEqual(fullRows(to).mirror_outbox, original.mirror_outbox);
    });
    check('restored journal remains immutable', () => assert.match(to.raw('delete from public.card_change_journal;').stderr, /card_change_journal_immutable/));
    check('successful restore retains sequence floor for the next accepted journal insert', () => {
      to.query("set role service_role; update public.calendar_posts set name='Post-restore save' where id='backup-card';");
      assert.ok(Number(to.query('select max(id) from public.card_change_journal')) > sequenceBefore);
    });
    assert.deepEqual(sourceHashes(), frozenSources, 'proof source changed during execution');
    const result = { status: 'PASS', passed: checks.length, checks, server_version: from.query('show server_version'),
      manifest_prerequisite_commit: MANIFEST_COMMIT, manifest_prerequisite_sha256: MANIFEST_HASH,
      corpus: 'history-v4', table_count: 21, row_counts: Object.fromEntries(Object.entries(original).map(([name, rows]) => [name, rows.length])),
      source_sha256: frozenSources,
      proof_scope: 'synthetic_local_SQL_and_package_only_no_cloud_delivery_or_full_installed_schema_claim' };
    if (process.env.CARD_HISTORY_BACKUP_REPORT) fs.writeFileSync(path.resolve(process.env.CARD_HISTORY_BACKUP_REPORT), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result)); completed = true; return result;
  } finally {
    // No shared directory/runtime cleanup. Failed databases and synthetic
    // package remain for diagnosis; only successful owned databases are dropped.
    if (completed) {
      from.drop(); to.drop();
      from.query(`drop role ${backupRole}; drop role ${restoreRole};`, 'postgres');
      for (const name of ['history.sql', 'history.snapshot']) fs.unlinkSync(path.join(files, name));
      fs.rmdirSync(files);
    } else console.error('Failed synthetic backup proof retained in unique databases ' + from.name + ' / ' + to.name);
  }
}
if (require.main === module) run().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { prerequisite, prepare, seed, triggerRows, run };
