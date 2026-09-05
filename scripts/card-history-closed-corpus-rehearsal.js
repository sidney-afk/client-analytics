'use strict';

// LOCAL ONLY. Uses an explicitly supplied, already running disposable server.
// Adds actual dependency DDL to the earlier journal fixture; it is deliberately
// not a claim that the full installed Supabase schema can be reconstructed.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { LocalDatabase, localConfig, source } = require('./card-change-journal-rehearsal');
const { prerequisite, prepare, seed, triggerRows } = require('./card-history-backup-rehearsal');
const backup = require('./track-b-backup');
const restore = require('./track-b-restore-rehearsal');
const ROOT = path.resolve(__dirname, '..');
const CORPUS = 'history-v5';
const literal = value => "'" + String(value).replace(/'/g, "''") + "'";
const json = value => literal(JSON.stringify(value)) + '::jsonb';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fragments = {};
const fullMigrations = [
  '2026-07-23-f201-production-labels.sql', '2026-07-23-f202-production-descriptions.sql',
  '2026-07-23-f203-production-issue-create.sql', '2026-07-23-production-comment-thread-lifecycle.sql',
  '2026-07-23-f34-f53-production-attachments.sql', '2026-07-15-pto-tracker.sql',
  '2026-07-14-linear-intake-receipts.sql',
];
function declaration(file, table) {
  const sql = source(file);
  const match = sql.match(new RegExp('create table if not exists public\\.' + table + ' \\([\\s\\S]*?\\n\\);'));
  if (!match) throw new Error('exact_dependency_DDL_missing');
  fragments[table] = { file, file_sha256: sha(sql), declaration_sha256: sha(match[0]) };
  return match[0];
}
function dependencies(db, withF27 = true) {
  for (const file of fullMigrations) db.query(source(file));
  // Only the exact CREATE TABLE is executed from the owner-gated data repair.
  // Its production data scan/update is not part of a local schema fixture.
  db.query(declaration('2026-07-28-linear-project-ids-team-shape.sql', 'linear_project_ids_shape_migration_20260728'));
  if (withF27) f27Relations(db);
}
function f27Relations(db) {
  const file = '2026-07-20-f27-team-rollback.sql';
  for (const table of ['track_b_f27_team_fences', 'track_b_team_rollbacks', 'track_b_team_rollback_intents']) db.query(declaration(file, table));
  // Actual F27 FK and columns, WITHOUT bypassing/executing its install gate,
  // replacing worker functions, seeding live flags or claiming an F27 install.
  const clause = source(file).match(/alter table public\.mirror_outbox\s+add column if not exists authority_generation bigint[\s\S]*?references public\.track_b_team_rollbacks\(id\);/);
  if (!clause) throw new Error('exact_F27_outbox_DDL_missing');
  fragments.f27_outbox_columns = { file, declaration_sha256: sha(clause[0]) };
  db.query(clause[0]);
  const tail = source(file).slice(clause.index + clause[0].length);
  const checks = tail.match(/^\s*(do \$block\$[\s\S]*?\$block\$;)/);
  if (!checks) throw new Error('exact_F27_outbox_CHECK_DDL_missing');
  fragments.f27_outbox_checks = { file, declaration_sha256: sha(checks[1]) };
  db.query(checks[1]);
}
function boundary(db, corpus) {
  const list = backup.resolveCorpus(corpus).tables.map(t => literal('public.' + t.name) + '::regclass').join(',');
  return db.rows(`select c.conrelid::regclass::text child,c.confrelid::regclass::text parent,c.conname
    from pg_constraint c where c.contype='f' and c.confrelid=any(array[${list}]::oid[])
    and not c.conrelid=any(array[${list}]::oid[]) order by 1,2,3`);
}
function rows(db) {
  return Object.fromEntries(backup.CLOSED_HISTORY_TABLES.map(({ name }) => [name,
    db.rows(`select to_jsonb(t) image from public.${name} t order by to_jsonb(t)::text`).map(r => r.image)]));
}
function grant(db, role, mode) {
  const r = spawnSync(db.config.psql, [...db.args(), '-v', 'mode=' + mode, '-v', 'existing_role=' + role,
    '-v', 'confirmation=' + (mode === 'backup' ? 'HISTORY_V5_BACKUP_GRANTS_ONLY' : 'DISPOSABLE_SCRATCH_ONLY'),
    '-v', 'scratch_project_ref=abcdefghijklmnopqrst', '-f', path.join(ROOT, 'scripts/track-b-history-v5-backup-prerequisites.sql')],
  { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '' } });
  if (r.status) throw new Error('local_v5_grants_failed: ' + r.stderr);
}
const comment = { id: 'closed-comment', native_comment_id: 'closed-comment', idempotency_key: 'closed-add',
  deliverable_id: 'backup-deliverable', team: 'video', author_key: 'synthetic-staff', author_name: 'Synthetic staff',
  role: 'admin', body: 'Before retained edit', audience: 'internal', source_updated_at: '2026-09-05T00:00:00Z' };
const event = (action, key) => ({ actor: 'synthetic-staff', role: 'admin', action, source: 'ui',
  outbound: { entity: 'comment', entity_id: 'backup-deliverable', operation: 'comment', team: 'video',
    dedup_key: key, payload: { _intent_fingerprint: 'synthetic-' + key } } });
function seedDependencies(db) {
  db.query(`insert into public.pto_members(member_id,pto_start_date,pto_enabled) values('11111111-1111-4111-8111-111111111111','2026-01-01',true);
    insert into public.pto_requests(member_id,type,start_date,end_date,days,note) values('11111111-1111-4111-8111-111111111111','sick','2026-09-05','2026-09-05',1,'Synthetic private HR note');
    insert into public.pto_adjustments(member_id,kind,delta,effective_date,reason,created_by) values('11111111-1111-4111-8111-111111111111','sick',1,'2026-09-05','Synthetic adjustment','synthetic-staff');
    insert into public.linear_project_ids_shape_migration_20260728(slug,before_linear_project_ids) values('historyfixture','["synthetic-provider-project"]');
    insert into public.production_asset_access_checks(deliverable_id,slot,url_sha256,state,result_code,checked_at) values('backup-deliverable','deliverable_file',repeat('a',64),'available','synthetic_ok',now());
    insert into public.linear_archive_asset_refs(ref_id,linear_uuid,deliverable_id,client_slug,source_kind,location_key,original_url,original_url_sha256) values('synthetic-ref','synthetic-archive','backup-deliverable','historyfixture','archive_raw','synthetic-location','https://uploads.linear.app/synthetic-invalid-fixture',repeat('b',64));
    insert into public.track_b_f27_team_fences(team,generation,updated_by) values('video',7,'synthetic-staff'),('graphics',3,'synthetic-staff');
    insert into public.track_b_team_rollbacks(id,team,expected_authority,prior_outbound,prior_parity,fence_generation,actor) values('33333333-3333-4333-8333-333333333333','video','{}','{}','{}',7,'synthetic-staff');
    insert into public.track_b_team_rollback_intents(rollback_id,outbox_id,row_snapshot,row_sha256) select '33333333-3333-4333-8333-333333333333',id,to_jsonb(o),repeat('c',64) from public.mirror_outbox o order by id limit 1;
    insert into public.track_b_team_rollbacks(id,team,is_drill,expected_authority,prior_outbound,prior_parity,fence_generation,actor)
      values('44444444-4444-4444-8444-444444444444','__f27_drill__',true,'{}','{"mode":"off"}','{"enabled":false}',null,'synthetic-staff');
    insert into public.mirror_outbox(deliverable_id,op,payload,attempts,created_at,next_retry_at,entity,entity_id,operation,client_slug,team,dedup_key,
      source_edited_at,status,actor,role,updated_at,test_only,legacy_parity,authority_generation,f27_drill_rollback_id)
      values(null,'update_state','{"f27_drill":true,"value":"noop"}',0,now(),now(),'deliverable','f27-drill:44444444-4444-4444-8444-444444444444',
      'status','__f27_drill__','__f27_drill__','f27-drill:44444444-4444-4444-8444-444444444444',now(),'pending','Synthetic drill','system',now(),true,false,0,'44444444-4444-4444-8444-444444444444');
    insert into public.track_b_team_rollback_intents(rollback_id,outbox_id,row_snapshot,row_sha256)
      select '44444444-4444-4444-8444-444444444444',id,to_jsonb(o),encode(extensions.digest(convert_to(to_jsonb(o)::text,'UTF8'),'sha256'),'hex')
      from public.mirror_outbox o where f27_drill_rollback_id='44444444-4444-4444-8444-444444444444';
  `);
  const payload = { clientName: 'historyfixture', filmingPlans: '', notes: 'Synthetic retry payload', title: 'Synthetic intake',
    videos: [{ audio: '', dueDate: null, main_cam: '', number: 1, side_cam: '' }] };
  db.query(`with p as(select public._linear_intake_canonical_json(${json(payload)}) body), h as(select body,public._linear_intake_sha256_hex(body) hash from p)
    insert into public.linear_intake_receipts(receipt_key,payload_hash,client,team,payload_json) select 'linear-intake-v1:video:'||hash,hash,'historyfixture','video',body from h;`);
  db.query(`set role service_role; select public.production_comment_write(${json(comment)},${json(event('add', 'closed-add'))});`);
  const original = db.rows("select * from public.production_comments where id='closed-comment'")[0];
  const edit = { ...comment, operation: 'edit', body: 'After retained edit', source_updated_at: '2026-09-05T01:00:00Z' };
  const editEvent = event('edit', 'closed-edit');
  const editSql = `set role service_role; select public.production_comment_lifecycle_write(${json(edit)},${json(editEvent)},${original.version},${literal(original.updated_at)});`;
  db.query(editSql);
  db.query(`insert into public.production_comment_card_links(source_surface,card_id,component,native_comment_id,deliverable_id,production_comment_id,source_fingerprint)
    values('calendar','backup-card','video','synthetic-source-note','backup-deliverable','closed-comment','synthetic-source-fingerprint');`);
  return editSql;
}
async function run() {
  const sources = ['scripts/track-b-backup.js','scripts/track-b-restore-rehearsal.js','scripts/track-b-history-v5-backup-prerequisites.sql',
    'scripts/card-history-backup-rehearsal.js','scripts/card-change-journal-rehearsal.js','scripts/card-history-closed-corpus-rehearsal.js',
    'migrations/2026-09-05-card-change-journal.sql'];
  const hashes = () => Object.fromEntries(sources.map(f => [f,sha(fs.readFileSync(path.join(ROOT,f)))]));
  const pins = hashes(), config = localConfig(), manifest = prerequisite();
  const from = new LocalDatabase(config), to = new LocalDatabase(config);
  const backupRole = from.name + '_backup', restoreRole = to.name + '_restore';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'history-v5-'));
  const checks = [], check = (name, fn) => { fn(); checks.push(name); };
  let complete = false;
  from.create(); to.create();
  try {
    prepare(from,manifest); prepare(to,manifest); dependencies(from,false); dependencies(to,false);
    const omitted = boundary(from,'history-v4');
    check('migration-shaped catalog reproduces9 incomingFKs from8 omitted v4 tables', () => {
      assert.equal(omitted.length,9); assert.equal(new Set(omitted.map(x=>x.child)).size,8);
      assert.equal(omitted.filter(x=>['production_comment_card_links','production_comment_mutation_receipts'].includes(x.child)).length,3);
    });
    const rawV3 = from.raw(`begin; truncate table ${backup.TABLES.map(t=>'public.'+t.name).join(',')} restrict; rollback;`);
    check('preexisting raw14-table TRUNCATE also refuses migration-shaped incomingFKs independently of the added legacy guard',()=>{
      assert.notEqual(rawV3.status,0);assert.match(rawV3.stderr,/foreign key constraint/);
    });
    const rawV4 = from.raw(`begin; truncate table ${backup.HISTORY_TABLES.map(t=>'public.'+t.name).join(',')} restrict; rollback;`);
    check('original v4 TRUNCATE RESTRICT actually refuses this schema',()=>{
      assert.notEqual(rawV4.status,0); assert.match(rawV4.stderr,/foreign key constraint/);
    });
    f27Relations(from); f27Relations(to);
    check('actual F27 intent FK adds the tenth omitted v4 incoming edge',()=>assert.equal(boundary(from,'history-v4').length,10));
    check('v5 has no incoming or outgoing catalog boundary after real dependency DDL',()=>assert.equal(from.raw(backup.corpusBoundarySql(CORPUS)).status,0));
    seed(from); const replay = seedDependencies(from);
    from.query(`create role ${backupRole} login bypassrls; create role ${restoreRole} login bypassrls;`);
    grant(from,backupRole,'backup'); grant(to,restoreRole,'scratch');
    check('actual production preflight arguments return exact33 grants without a DO command tag',()=>{
      const args=[...backup.readOnlyPrivilegeArgs(CORPUS),'-h',config.host,'-p',config.port,'-U',backupRole,'-d',from.name];
      const r=spawnSync(config.psql,args,{encoding:'utf8',env:{...process.env,PGOPTIONS:''}});
      assert.equal(r.status,0);assert.equal(backup.verifyReadOnlyPrivilegeOutput(r.stdout,CORPUS),true);
      const unquiet=spawnSync(config.psql,args.filter(a=>a!=='--quiet'),{encoding:'utf8',env:{...process.env,PGOPTIONS:''}});
      assert.equal(unquiet.status,0);assert.match(unquiet.stdout,/^DO\r?\n/);
      assert.throws(()=>backup.verifyReadOnlyPrivilegeOutput(unquiet.stdout,CORPUS));
    });
    const original = rows(from);
    check('all33 tables contain actual typed synthetic rows',()=>assert.ok(Object.values(original).every(r=>r.length>0)));
    const dumpPath=path.join(dir,'dump.sql'), packPath=path.join(dir,'package.snapshot');
    const dumped=spawnSync(process.env.CARD_HISTORY_PGDUMP||'pg_dump',[...backup.pgDumpArgs(dumpPath,CORPUS),'-h',config.host,'-p',config.port,'-U',backupRole,'-d',from.name],
      {encoding:'utf8',env:{...process.env,PGOPTIONS:'-c default_transaction_read_only=on -c timezone=UTC'}});
    if(dumped.status)throw Error('local_v5_dump_failed: '+dumped.stderr);
    const hmac=crypto.randomBytes(32).toString('base64');
    backup.packSnapshot(dumpPath,packPath,new Date().toISOString(),`postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres`,hmac,CORPUS);
    const snap=backup.readSnapshotFile(packPath,hmac);
    check('real dump authenticates as exact33 v5 with crosswalk composite identity',()=>{
      assert.equal(snap.manifest.table_count,33); assert.equal(snap.manifest.schema_version,5);
      assert.deepEqual(snap.manifest.tables.production_comment_card_links.primary_key,['source_surface','card_id','component','native_comment_id']);
    });
    const apply = sql => {const saved=to.config;to.config={...saved,user:restoreRole};try{return to.raw(sql);}finally{to.config=saved;}};
    const before=rows(to), triggers=triggerRows(to);
    check('wrong COPY order with a real nonnull F27 drill parent FK fails atomically',()=>{
      const sql=restore.restoreSql(snap.dumpBytes,CORPUS);
      const parent=sql.match(/COPY public\."track_b_team_rollbacks" \([^\n]+\) FROM stdin;\n[\s\S]*?\\\.\n/);
      assert.ok(parent);assert.ok(original.mirror_outbox.some(r=>r.f27_drill_rollback_id));
      const wrong=sql.replace(parent[0],'').replace('set constraints all immediate;',parent[0]+'set constraints all immediate;');
      const failed=apply(wrong);assert.notEqual(failed.status,0);assert.match(failed.stderr,/foreign key constraint/);
      assert.deepEqual(rows(to),before);assert.deepEqual(triggerRows(to),triggers);
    });
    to.query('create table public.synthetic_uncovered_fk(id text primary key,comment_id text references public.production_comments(id));');
    check('new unknown FK is rejected before any target row or trigger changes',()=>{
      const failed=apply(restore.restoreSql(snap.dumpBytes,CORPUS)); assert.notEqual(failed.status,0);assert.match(failed.stderr,/omitted incoming foreign key/);
      assert.deepEqual(rows(to),before);assert.deepEqual(triggerRows(to),triggers);
    });
    to.query('drop table public.synthetic_uncovered_fk;');
    from.query('create table public.synthetic_uncovered_fk(id text primary key,comment_id text references public.production_comments(id));');
    check('source preflight rejects an unknown incoming FK before exporting v5',()=>assert.notEqual(from.raw(`set role ${backupRole}; ${backup.readOnlyPrivilegeSql(CORPUS)}`).status,0));
    from.query('drop table public.synthetic_uncovered_fk;');
    check('failing actual COPY preserves target data and trigger states',()=>{
      const bad=snap.dumpBytes.toString().replace('After retained edit','After retained edit\textra-column');
      const failed=apply(restore.restoreSql(bad,CORPUS)); assert.notEqual(failed.status,0);
      assert.deepEqual(rows(to),before);assert.deepEqual(triggerRows(to),triggers);
    });
    const applied=apply(restore.restoreSql(snap.dumpBytes,CORPUS));if(applied.status)throw Error('local_v5_restore_failed: '+applied.stderr);
    check('all33 restored typed row contents equal the captured snapshot',()=>assert.deepEqual(rows(to),original));
    check('restored exact edit replay preserves comment, receipt, event, journal and outbox values',()=>{
      to.query(replay);assert.deepEqual(rows(to),original);
    });
    check('changed fingerprint still conflicts after restore',()=>{
      const refused=to.raw(replay.replace('synthetic-closed-edit','different-fingerprint'));
      assert.notEqual(refused.status,0);assert.match(refused.stderr,/idempotency_conflict/);assert.deepEqual(rows(to),original);
    });
    check('restore retains original and final comment bodies, crosswalk and intake payload',()=>{
      assert.ok(original.card_change_journal.some(r=>r.row_before&&r.row_before.body==='Before retained edit'));
      assert.equal(original.production_comments.find(r=>r.id==='closed-comment').body,'After retained edit');
      assert.equal(original.production_comment_card_links[0].native_comment_id,'synthetic-source-note');
      assert.equal(JSON.parse(original.linear_intake_receipts[0].payload_json).notes,'Synthetic retry payload');
      assert.equal(original.track_b_f27_team_fences.find(r=>r.team==='video').generation,7);
    });
    check('all33 counts/coreintegrity pass and user triggers are restored normally',()=>{
      assert.equal(restore.verifyCounts(snap.manifest,restore.parseVerification(to.query(restore.verifySql(CORPUS)))),true);
      assert.deepEqual(triggerRows(to),triggers);
    });
    check('anon and authenticated cannot read new private replay/HR/journal contents',()=>{
      for(const role of ['anon','authenticated'])for(const name of ['production_comment_card_links','production_comment_mutation_receipts','linear_intake_receipts','pto_requests','card_change_journal'])
        assert.notEqual(to.raw(`set role ${role};select * from public.${name};`).status,0);
    });
    check('no worker, network extension, foreign server or provider replay participates',()=>{
      assert.equal(to.query('select count(*) from pg_foreign_server'),'0');
      assert.equal(to.query("select count(*) from pg_extension where extname not in ('plpgsql','pgcrypto')"),'0');
      assert.deepEqual(rows(to).mirror_outbox,original.mirror_outbox);
    });
    assert.deepEqual(hashes(),pins);
    const result={status:'PASS',passed:checks.length,checks,table_count:33,original_v4_incoming_fk_count:9,with_f27_v4_incoming_fk_count:10,
      source_sha256:pins,dependency_fragments:fragments,full_migration_sha256:Object.fromEntries(fullMigrations.map(f=>[f,sha(source(f))])),
      proof_limits:'local migration-shaped dependencies; foundation platform stubs explicit; F27 table DDL only; installed schema and authenticated schema artifact UNPROVEN; no cloud or capacity claim'};
    if(process.env.CARD_HISTORY_CLOSED_REPORT)fs.writeFileSync(process.env.CARD_HISTORY_CLOSED_REPORT,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result));complete=true;return result;
  }finally{
    if(complete){from.drop();to.drop();from.query(`drop role ${backupRole};drop role ${restoreRole};`,'postgres');for(const name of ['dump.sql','package.snapshot'])fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);}
    else console.error('Failed local proof retained in unique databases '+from.name+' / '+to.name+'; files '+dir);
  }
}
if(require.main===module)run().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={declaration,dependencies,f27Relations,run};
