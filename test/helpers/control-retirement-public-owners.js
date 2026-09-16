'use strict';
// Fixed additive fixture owners, after the established current-public mode.
// This does not exercise switch authorization or provider dispatch.
const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict');
const prior=require('./control-current-public-owners'),split=require('../../scripts/track-b-recovery-package').splitSqlStatements;
const OWNERS=[
 ['supabase/migrations/20260913062741_provider_terminal_history_preparation.sql','e06124eb54b7920cab8b1a14d6c7ce8bcb08b4f14a8393c5552191095ea43ea0'],
 ['supabase/migrations/20260913190840_provider_terminal_private_acl_preparation.sql','439db3390b299b519af1a110bb0678ee8680d4b88be5c5ceb96faf1aae108942'],
 ['supabase/migrations/20260913181213_provider_comment_observation_recovery_preparation.sql','b92fbbe60b3e64d4cc3da7f297d3c6f6900cb7aaf225f1f6e0151ef55ea3004b'],
 ['supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql','5c5e24aef2c2710975d769378f58c812a78a32ff2e5eeb2392e36c515e5d33a2'],
 ['supabase/migrations/20260913062149_retirement_switch_preparation.sql','f6e7e24e4aef631e3e9a702ed53486dc9fa6cdcb27e45b2bf37675e3ee475821']
];
const hash=(x,kind='sha256')=>crypto.createHash(kind).update(x).digest('hex');
function expected(){const result=prior.expected();for(const [file,pin] of OWNERS){const b=fs.readFileSync(file);assert.equal(hash(b),pin,'retirement public owner drift');for(const s of split(b.toString('utf8'))){const m=s.text.match(/^create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)[\s\S]*?\bas\s+(\$[a-zA-Z_0-9]*\$)([\s\S]*?)\2/i);if(m)result.set(m[1],hash(m[3],'md5'));}}return result;}
function query(){const names=[...expected().keys()];assert(names.every(n=>/^[a-z_0-9]+$/.test(n)));return `set search_path=pg_catalog,public;select jsonb_agg(jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'body_raw_md5',md5(p.prosrc),'result',pg_get_function_result(p.oid),'language',l.lanname,'security_definer',p.prosecdef,'config',p.proconfig,'strict',p.proisstrict,'volatility',p.provolatile,'parallel',p.proparallel,'leakproof',p.proleakproof,'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by p.proname) from pg_proc p join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace and p.proname in (${names.map(n=>"'"+n+"'").join(',')});`;}
function apply(c){expected();for(const [file] of OWNERS)c.runFile(file);const rows=c.scalarJson(query()),bodies=expected();assert.equal(rows.length,bodies.size);for(const row of rows){assert.equal(row.body_raw_md5,bodies.get(row.name),'final public source body');assert.equal(row.anon_execute,false);assert.equal(row.authenticated_execute,false);}return rows;}
function verify(c,target,rows){assert.deepEqual(c.scalarJson(query(),target),rows,'restored final public metadata drift');}
function seedRetiredOpen(c){
 const debts=()=>c.scalarJson("select jsonb_build_object('outbox',(select count(*) from public.mirror_outbox),'followups',(select count(*) from public.card_write_followups_v1 where state not in ('completed','dispositioned')),'attempts',(select count(*) from linear_exit_provider.send_attempts_v1 where state<>'completed'))");
 const before=debts();assert(before.followups>0&&before.attempts>0);
 // Privileged synthetic restoration fixture only. This intentionally does not
 // call or claim successful activation with unresolved work. All guards remain.
 c.exec(`do $retired_fixture$ declare old_row public.syncview_retirement_admission%rowtype; after_row jsonb; e uuid;begin
  select epoch into strict e from public.card_write_admission_v1 where singleton for update;
  lock table public.mirror_outbox in share row exclusive mode;
  select * into strict old_row from public.syncview_retirement_admission where singleton for update;
  after_row:=to_jsonb(old_row)||jsonb_build_object('mode','retired','activated_at',clock_timestamp(),'activated_reason','synthetic archival recovery fixture; not activation proof','high_water_outbox_id',(select coalesce(max(id),0) from public.mirror_outbox),'high_water_created_at',clock_timestamp());
  insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),e,'retirement_switch',jsonb_build_object('before',to_jsonb(old_row),'after',after_row));
  update public.syncview_retirement_admission set mode='retired',activated_at=(after_row->>'activated_at')::timestamptz,activated_reason=after_row->>'activated_reason',high_water_outbox_id=(after_row->>'high_water_outbox_id')::bigint,high_water_created_at=(after_row->>'high_water_created_at')::timestamptz where singleton;
  delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
  update public.card_write_admission_v1 set mode='open' where singleton;
 end $retired_fixture$;`);
 assert.deepEqual(debts(),before,'fixture must preserve unresolved debts');
 assert.equal(c.scalarJson("select to_jsonb((select mode='retired' from public.syncview_retirement_admission where singleton) and (select mode='open' from public.card_write_admission_v1 where singleton) and not exists(select from public.card_write_transaction_context_v1))"),true);
 return {classification:'PRIVILEGED_SYNTHETIC_RETIRED_OPEN_RESTORE_STATE_ONLY',debts_preserved:before,activation_proven:false};
}
module.exports={OWNERS,expected,apply,verify,seedRetiredOpen};
