'use strict';

// Real PostgreSQL, synthetic data only. Never starts/stops a database service.
// Requires explicit local disposable server opt-in. No HTTP, browser, provider,
// mail, webhook, scheduler or production connection code exists in this lane.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { FOUNDATION_SQL } = require('./f42-apply-rehearsal');
const ROOT = path.resolve(__dirname, '..');
const MIGRATION = '2026-09-05-card-change-journal.sql';
const OWNERS = ['calendar_posts', 'sample_reviews', 'batches', 'deliverables', 'production_comments', 'workload_plan'];

function localConfig(env = process.env) {
  if (env.CARD_HISTORY_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') throw new Error('local_disposable_confirmation_required');
  const host = env.CARD_HISTORY_PGHOST || '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('only_literal_loopback_allowed');
  const port = String(env.CARD_HISTORY_PGPORT || '55440');
  if (!/^\d{4,5}$/.test(port) || Number(port) > 65535) throw new Error('local_port_invalid');
  const psql = env.CARD_HISTORY_PSQL || 'psql';
  return { host, port, psql, user: env.CARD_HISTORY_PGUSER || 'postgres' };
}

function sqlLiteral(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }
function sqlJson(value) { return sqlLiteral(JSON.stringify(value)) + '::jsonb'; }

class LocalDatabase {
  constructor(config) {
    this.config = config;
    this.name = 'card_history_' + process.pid + '_' + crypto.randomBytes(4).toString('hex');
  }
  args(database = this.name) {
    return ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', this.config.host,
      '-p', this.config.port, '-U', this.config.user, '-d', database];
  }
  raw(sql, database) {
    return spawnSync(this.config.psql, this.args(database), {
      input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: process.env.CARD_HISTORY_PGPASSWORD || '', PGOPTIONS: '' },
    });
  }
  query(sql, database) {
    const r = this.raw(sql, database);
    if (r.status !== 0) throw new Error('local_sql_failed: ' + (r.stderr || r.error || '').toString());
    return r.stdout.trim();
  }
  rows(sql) { return JSON.parse(this.query(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t;`)); }
  asyncQuery(sql) {
    return new Promise(resolve => {
      const child = spawn(this.config.psql, this.args(), { stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PGPASSWORD: process.env.CARD_HISTORY_PGPASSWORD || '', PGOPTIONS: '' } });
      let stdout = '', stderr = '';
      child.stdout.on('data', c => { stdout += c; });
      child.stderr.on('data', c => { stderr += c; });
      child.on('error', error => resolve({ status: -1, stdout, stderr: String(error) }));
      child.on('close', status => resolve({ status, stdout, stderr }));
      child.stdin.end(sql);
    });
  }
  create() { this.query('create database ' + this.name, 'postgres'); }
  drop() { this.query('drop database ' + this.name, 'postgres'); }
}

function source(name) { return fs.readFileSync(path.join(ROOT, 'migrations', name), 'utf8'); }
function tableDeclaration(baseline, name) {
  const match = baseline.match(new RegExp('create table if not exists public\\.' + name + ' \\([\\s\\S]*?\\n\\);'));
  if (!match) throw new Error('source_table_definition_missing');
  return match[0];
}

function bootstrap(db) {
  const baseline = source('live-schema-baseline-2026-07-03.sql');
  let foundation = FOUNDATION_SQL;
  for (const table of ['calendar_posts', 'sample_reviews']) {
    foundation = foundation.replace(`create table if not exists public.${table} (id text primary key);`,
      tableDeclaration(baseline, table) + `\nalter table public.${table} add primary key(client,id);`);
  }
  db.query(foundation);
  for (const file of ['2026-06-18-atomic-comment-merge.sql', 'sample-reviews-migration.sql',
    '2026-07-03-a1-calendar-upsert.sql', '2026-07-06-b1-linear-data-model.sql',
    '2026-07-11-b4-linear-outbound.sql', '2026-07-12-production-comments.sql',
    '2026-07-12-write-ui-outbox-parity.sql', '2026-07-19-workload-plan.sql']) db.query(source(file));
  db.query(`set check_function_bodies = on;
    insert into public.clients(slug, display_name) values ('historyfixture','Synthetic history fixture'), ('historyother','Synthetic unrelated fixture');
    insert into public.team_members(id,name,role,active) values ('11111111-1111-4111-8111-111111111111','Synthetic member','admin',true);
    insert into public.syncview_runtime_flags(key,value) values
      ('prod_authority','{"video":"syncview","graphics":"syncview"}'),
      ('linear_outbound_enabled','{"mode":"off"}') on conflict(key) do update set value=excluded.value;
    grant select,insert,update,delete on public.calendar_posts,public.sample_reviews to service_role;
  `);
  assert.equal(db.query('select count(*) from pg_foreign_server'), '0');
  assert.equal(db.query("select count(*) from pg_extension where extname not in ('plpgsql','pgcrypto')"), '0');
  db.query(source(MIGRATION));
}

async function run() {
  const db = new LocalDatabase(localConfig());
  const checks = [];
  const check = (name, fn) => { fn(); checks.push(name); };
  db.create();
  let completed = false;
  try {
    bootstrap(db);
    const count = () => Number(db.query('select count(*) from public.card_change_journal'));
    const latest = table => db.rows(`select * from public.card_change_journal where relation_name=${sqlLiteral(table)} order by id desc limit 1`)[0];
    const nativeEvent = { actor: 'synthetic-staff', role: 'admin', action: 'create', source: 'ui' };
    const intentEvent = (entity, suffix, operation = 'create') => ({ ...nativeEvent, outbound: {
      entity, operation, team: 'video', dedup_key: 'history-' + suffix,
      payload: { _intent_fingerprint: 'synthetic-' + suffix },
    } });
    const batch = { id: 'history-batch', client_slug: 'historyfixture', team: 'video', name: 'Original batch' };
    const deliverable = { id: 'history-deliverable', batch_id: batch.id, client_slug: batch.client_slug, team: 'video', kind: 'video', title: 'Original deliverable' };
    db.query(`set role service_role; select public.production_batch_write(${sqlJson(batch)},${sqlJson(intentEvent('batch','batch'))});
      select public.production_deliverable_write(${sqlJson(deliverable)},${sqlJson(intentEvent('deliverable','deliverable'))});`);
    check('native RPC preserves existing semantic events and ignores event_written suppression', () => {
      assert.equal(count(), 2);
      assert.equal(db.query("select count(*) from public.deliverable_events where actor='synthetic-staff'"), '2');
      assert.equal(db.query('select count(*) from public.mirror_outbox'), '2');
      assert.equal(latest('batches').row_after.name, 'Original batch');
    });
    const comment = { id: 'history-comment', idempotency_key: 'history-comment', deliverable_id: deliverable.id,
      team: 'video', author_key: 'synthetic-staff', author_name: 'Synthetic staff', role: 'admin', body: 'Original canonical body', audience: 'internal', source_updated_at: '2026-09-05T00:00:00Z' };
    db.query(`set role service_role; select public.production_comment_upsert(${sqlJson(comment)},${sqlJson(nativeEvent)});`);
    check('canonical comment snapshot and semantic version both retained', () => {
      assert.equal(latest('production_comments').row_after.body, comment.body);
      assert.equal(db.query("select count(*) from public.deliverable_events where payload->'comment'->>'body'='Original canonical body'"), '1');
    });
    const beforeReplay = count();
    db.query(`set role service_role; select public.production_comment_upsert(${sqlJson(comment)},${sqlJson(nativeEvent)});`);
    check('existing idempotent comment replay makes no extra committed row version', () => assert.equal(count(), beforeReplay));
    db.query(`set role service_role;
      insert into public.calendar_posts(client,id,name,status,video_tweaks) values('historyfixture','card','Original calendar','InProgress','');
      insert into public.sample_reviews(client,id,name,status) values('historyfixture','card','Original samples','InProgress');
      insert into public.workload_plan(issue_id,client,plan_date,updated_by) values('history-issue','historyfixture','2026-09-06','synthetic-staff');`);
    check('INSERT coverage for all six actual owners', () => {
      assert.deepEqual(db.rows("select distinct relation_name from public.card_change_journal where operation='INSERT' order by relation_name").map(x => x.relation_name), [...OWNERS].sort());
    });

    const legacyNotes = JSON.stringify([{ id: 'synthetic-note', body: 'Original source note', role: 'client', author: 'Claimed author', created_at: '2026-09-05T00:00:00Z' }]);
    db.query(`set role service_role; select public.calendar_merge_comments('historyfixture','card',${sqlLiteral(legacyNotes)});`);
    const mergeReceipt = latest('calendar_posts');
    check('actual atomic source-cell RPC retains ordinary client note independently of canonical store', () => {
      assert.equal(JSON.parse(mergeReceipt.row_after.video_tweaks)[0].body, 'Original source note');
      assert.equal(mergeReceipt.row_before.video_tweaks, '');
      assert.deepEqual(mergeReceipt.entity_key_after, { client: 'historyfixture', id: 'card' });
      assert.equal(mergeReceipt.actor_assurance, 'transport_only_person_unverified');
    });
    db.query(`set role service_role; select public.sample_review_merge_comments('historyfixture','card',${sqlLiteral(legacyNotes)});`);
    check('Samples source-cell RPC has independent complete journal evidence', () => {
      assert.equal(JSON.parse(latest('sample_reviews').row_after.video_tweaks)[0].body, 'Original source note');
      assert.equal(latest('sample_reviews').row_before.video_tweaks, null);
    });
    db.query(`set role service_role; set request.jwt.claims='{"role":"service_role","sub":"claimed-person","secret":"must-not-copy"}';
      update public.workload_plan set updated_by=updated_by where issue_id='history-issue';`);
    check('transport claims do not become a verified actor or leak unselected metadata', () => {
      assert.deepEqual(latest('workload_plan').request_claims, { role: 'service_role', sub: 'claimed-person' });
      assert.equal(latest('workload_plan').database_role_setting, 'service_role');
      assert.equal(latest('workload_plan').actor_assurance, 'transport_only_person_unverified');
    });
    db.query(`set role service_role; set request.jwt.claims='not json'; update public.workload_plan set updated_by=updated_by where issue_id='history-issue';`);
    check('malformed optional metadata preserves save with unknown actor evidence', () => assert.deepEqual(latest('workload_plan').request_claims, {}));
    const afterMerge = count();
    const rejected = db.raw("set role service_role; update public.calendar_posts set name=null, id=null where client='historyfixture' and id='card';");
    check('partial multi-transaction action retains successful first request and no rejected second change', () => {
      assert.notEqual(rejected.status, 0); assert.equal(count(), afterMerge);
      assert.equal(db.query("select name from public.calendar_posts where client='historyfixture' and id='card'"), 'Original calendar');
    });

    db.query(`begin; set local app.event_written='1';
      update public.calendar_posts set name='Final calendar',status='Approved',scheduled_date='2026-09-09',order_index='3',asset_url='https://example.invalid/synthetic-media',video_tweaks='[{"id":"synthetic-note","body":"Edited source note","deleted":true}]' where client='historyfixture' and id='card';
      update public.sample_reviews set name='Final samples',video_status='Approved',order_index='2',graphic_tweaks='[{"id":"synthetic-sample-note","body":"Sample note"}]' where client='historyfixture' and id='card';
      update public.deliverables set title='Final deliverable',brief='Edited brief',status='approved',assignee_id='11111111-1111-4111-8111-111111111111',due_date='2026-09-10' where id='history-deliverable';
      update public.batches set name='Final batch',description='Edited batch' where id='history-batch';
      update public.production_comments set body='Final canonical body',version=version+1,resolved_at=now() where id='history-comment';
      update public.workload_plan set plan_date='2026-09-07',updated_by='synthetic-other-staff' where issue_id='history-issue'; commit;`);
    const finalImages = Object.fromEntries(OWNERS.map(table => [table, latest(table).row_after]));
    const priorImages = Object.fromEntries(OWNERS.map(table => [table, latest(table).row_before]));
    check('direct UPDATE captures all fields and six owners even with semantic suppression set', () => {
      const rows = OWNERS.map(latest);
      assert.equal(new Set(rows.map(r => r.transaction_id)).size, 1);
      assert.equal(finalImages.deliverables.due_date, '2026-09-10');
      assert.equal(finalImages.workload_plan.plan_date, '2026-09-07');
      assert.equal(priorImages.production_comments.body, 'Original canonical body');
      assert.equal(latest('calendar_posts').row_schema.scheduled_date.type, 'text');
      assert.equal(latest('calendar_posts').row_schema_md5.length, 32);
    });

    for (const role of ['anon', 'authenticated']) {
      for (const sql of ['select row_before from public.card_change_journal', 'delete from public.card_change_journal', 'truncate public.card_change_journal']) {
        check(role + ' denied ' + sql.split(' ')[0], () => assert.notEqual(db.raw(`set role ${role}; ${sql};`).status, 0));
      }
    }
    for (const sql of ['update public.card_change_journal set operation=operation', 'delete from public.card_change_journal', 'truncate public.card_change_journal']) {
      check('owner accidental mutation blocked: ' + sql.split(' ')[0], () => assert.match(db.raw(sql).stderr, /card_change_journal_immutable/));
    }
    check('service role cannot forge history rows or call trigger function', () => {
      assert.match(db.raw('set role service_role; insert into public.card_change_journal default values;').stderr, /permission denied/);
      assert.match(db.raw('set role service_role; select public.card_change_journal_capture();').stderr, /permission denied/);
    });
    check('no foreign key can cascade journal deletion', () => assert.equal(db.query("select count(*) from pg_constraint where conrelid='public.card_change_journal'::regclass and contype='f'"), '0'));
    check('journal omitted from realtime publication', () => assert.equal(db.query("select count(*) from pg_publication_tables where tablename='card_change_journal'"), '0'));

    const failureBefore = count();
    const eventsBefore = db.query('select count(*) from public.deliverable_events');
    const outboxBefore = db.query('select count(*) from public.mirror_outbox');
    db.query("alter table public.card_change_journal add constraint synthetic_injected_storage_failure check(false) not valid;");
    const failedWrite = db.raw(`set role service_role; select public.production_deliverable_write(${sqlJson({ ...deliverable, title: 'Must never commit' })},${sqlJson(intentEvent('deliverable','failed-title','title'))});`);
    db.query('alter table public.card_change_journal drop constraint synthetic_injected_storage_failure;');
    check('journal insertion failure rolls back business row and semantic event together', () => {
      assert.notEqual(failedWrite.status, 0); assert.equal(count(), failureBefore);
      assert.equal(db.query('select count(*) from public.deliverable_events'), eventsBefore);
      assert.equal(db.query('select count(*) from public.mirror_outbox'), outboxBefore);
      assert.equal(db.query("select title from public.deliverables where id='history-deliverable'"), 'Final deliverable');
    });
    const eventFailedWrite = db.raw(`set role service_role; select public.production_deliverable_write(${sqlJson({ ...deliverable, title: 'Must also never commit' })},${sqlJson({ ...intentEvent('deliverable','failed-event','title'), source: 'synthetic-invalid-source' })});`);
    check('later semantic event failure rolls back the already-captured business row and journal', () => {
      assert.notEqual(eventFailedWrite.status, 0); assert.equal(count(), failureBefore);
      assert.equal(db.query('select count(*) from public.deliverable_events'), eventsBefore);
      assert.equal(db.query('select count(*) from public.mirror_outbox'), outboxBefore);
      assert.equal(db.query("select title from public.deliverables where id='history-deliverable'"), 'Final deliverable');
    });

    // Actual overlapping sessions: the first row lock is held until the second
    // session is observed waiting on that lock. No timing-only concurrency claim.
    const first = db.asyncQuery("begin; update public.workload_plan set plan_date='2026-09-11' where issue_id='history-issue'; select pg_sleep(1.5); commit;");
    for (let i = 0; i < 100; i++) {
      if (Number(db.query("select count(*) from pg_stat_activity where datname=current_database() and wait_event='PgSleep'")) > 0) break;
      await new Promise(resolve => setTimeout(resolve, 10));
      if (i === 99) throw new Error('first_session_barrier_not_observed');
    }
    const second = db.asyncQuery("update public.workload_plan set plan_date='2026-09-12' where issue_id='history-issue';");
    let observedWait = false;
    for (let i = 0; i < 100; i++) {
      if (Number(db.query("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock'")) > 0) { observedWait = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const [a, b] = await Promise.all([first, second]);
    check('concurrent commits retain exact serialized prior-to-final chain', () => {
      assert.equal(a.status, 0); assert.equal(b.status, 0); assert.equal(observedWait, true);
      const versions = db.rows("select row_before->>'plan_date' previous,row_after->>'plan_date' next,transaction_id from public.card_change_journal where relation_name='workload_plan' order by id desc limit 2");
      assert.deepEqual(versions.map(v => [v.previous, v.next]), [['2026-09-11', '2026-09-12'], ['2026-09-07', '2026-09-11']]);
      assert.notEqual(versions[0].transaction_id, versions[1].transaction_id);
    });

    db.query(`insert into public.calendar_posts(client,id,name) values('historyother','card','Unrelated remains');
      update public.calendar_posts set client='historyother',id='moved-card' where client='historyfixture' and id='card';`);
    check('key and client reassignment preserves both identities', () => {
      const r = latest('calendar_posts'); assert.equal(r.client_before, 'historyfixture'); assert.equal(r.client_after, 'historyother');
      assert.deepEqual(r.entity_key_before, { client: 'historyfixture', id: 'card' });
      assert.deepEqual(r.entity_key_after, { client: 'historyother', id: 'moved-card' });
    });
    db.query("alter table public.calendar_posts add column synthetic_future_field text; update public.calendar_posts set synthetic_future_field='Future field value' where id='moved-card';");
    check('future columns captured with changed schema identity', () => {
      const r = latest('calendar_posts'); assert.equal(r.row_after.synthetic_future_field, 'Future field value');
      assert.equal(r.row_schema.synthetic_future_field.type, 'text'); assert.ok(r.changed_columns.includes('synthetic_future_field'));
      assert.notEqual(r.row_schema_md5, mergeReceipt.row_schema_md5);
    });
    db.query(`begin; delete from public.production_comments where id='history-comment';
      delete from public.calendar_posts where id='moved-card'; delete from public.sample_reviews where client='historyfixture' and id='card';
      delete from public.workload_plan where issue_id='history-issue'; delete from public.deliverables where id='history-deliverable';
      delete from public.batches where id='history-batch'; commit;`);
    check('DELETE captures all six owners with complete final prior images', () => {
      assert.deepEqual(db.rows("select distinct relation_name from public.card_change_journal where operation='DELETE' order by relation_name").map(x => x.relation_name), [...OWNERS].sort());
      assert.equal(latest('production_comments').row_before.body, 'Final canonical body');
      assert.equal(latest('production_comments').row_after, null);
    });

    // Restore images into isolated scratch tables, never reverse live rows or
    // replay RPCs/events/outboxes. Explicit typed reconstruction is lossless.
    for (const table of OWNERS) {
      db.query(`create table public.synthetic_restore_${table} (like public.${table});`);
      for (const images of [priorImages, finalImages]) {
        db.query(`truncate public.synthetic_restore_${table}; insert into public.synthetic_restore_${table} select * from jsonb_populate_record(null::public.synthetic_restore_${table}, ${sqlJson(images[table])});`);
        const actual = db.rows(`select to_jsonb(t) image from public.synthetic_restore_${table} t`)[0].image;
        // Schema-drift-added nullable column exists only after the source receipt.
        if (table === 'calendar_posts') delete actual.synthetic_future_field;
        assert.deepEqual(actual, images[table]);
      }
    }
    check('typed prior and final values restored for every owner with no side-effect triggers', () => {
      assert.equal(db.query("select name from public.calendar_posts where client='historyother' and id='card'"), 'Unrelated remains');
      assert.equal(db.query("select count(*) from pg_trigger where tgrelid::regclass::text like 'synthetic_restore_%' and not tgisinternal"), '0');
    });

    // Representative local overhead: same full card row and repeated edits,
    // alternating capture disabled/enabled. Transaction sizes are explicit;
    // this is NOT a production latency, concurrent-capacity or disk forecast.
    const overhead = [];
    db.query("insert into public.calendar_posts(client,id,name,video_tweaks) values('historyfixture','bench','Benchmark',repeat('synthetic-note ',200));");
    for (let round = 0; round < 3; round++) {
      for (const enabled of [false, true]) {
        db.query(`alter table public.calendar_posts ${enabled ? 'enable' : 'disable'} trigger card_change_journal_after;`);
        const timing = db.query(`do $bench$ declare v_started timestamptz := clock_timestamp(); begin
          for n in 1..200 loop update public.calendar_posts set name='Benchmark '||n,order_index=n::text where client='historyfixture' and id='bench'; end loop;
          perform set_config('synthetic.history_elapsed_ms', (extract(epoch from clock_timestamp()-v_started)*1000)::text,false);
        end $bench$; select current_setting('synthetic.history_elapsed_ms');`);
        overhead.push({ capture: enabled, round, changes: 200, milliseconds: Number(timing) });
      }
    }
    db.query('alter table public.calendar_posts enable trigger card_change_journal_after;');
    const bytes = Number(db.query("select pg_total_relation_size('public.card_change_journal')"));
    const retainedBeforeRollback = count();
    db.query(fs.readFileSync(path.join(ROOT, 'scripts/card-change-journal-rollback.sql'), 'utf8'));
    db.query("set role service_role; update public.calendar_posts set name='Post-rollback save' where id='bench';");
    check('exact behavior rollback preserves history and writer access while suspending all six captures', () => {
      assert.equal(count(), retainedBeforeRollback);
      assert.equal(db.query("select count(*) from pg_trigger where tgname='card_change_journal_after' and tgenabled='D'"), '6');
      assert.equal(db.query("select name from public.calendar_posts where id='bench'"), 'Post-rollback save');
      assert.match(db.raw('delete from public.card_change_journal;').stderr, /card_change_journal_immutable/);
    });
    const result = { status: 'PASS', source_base: '287c16cd1c46da18c9d6e302e9a8d7c66c746e50',
      migration_sha256: crypto.createHash('sha256').update(source(MIGRATION)).digest('hex'),
      rehearsal_sha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
      rollback_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts/card-change-journal-rollback.sql'))).digest('hex'),
      server_version: db.query('show server_version'), checks, passed: checks.length,
      local_overhead: overhead, local_journal_relation_bytes: bytes,
      proof_scope: 'synthetic_local_SQL_only_no_live_capacity_or_backup_delivery_claim' };
    if (process.env.CARD_HISTORY_REPORT) fs.writeFileSync(path.resolve(process.env.CARD_HISTORY_REPORT), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result)); completed = true;
    return result;
  } finally {
    // Preserve failed rehearsal evidence. No daemon, runtime or shared files
    // are deleted; successful cleanup drops only this uniquely named database.
    if (completed) db.drop();
    else console.error('FAILED rehearsal database retained: ' + db.name);
  }
}
if (require.main === module) run().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { localConfig, LocalDatabase, bootstrap, source, run, OWNERS, MIGRATION };
