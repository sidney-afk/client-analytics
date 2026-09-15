'use strict';
// Synthetic historical rows under the installed source constraints. These are
// structural preservation fixtures, not claims that hosted operations occurred.
const assert=require('node:assert/strict');
const TABLES=['calendar_feedback_materializations','calendar_post_events','client_access_events','linear_archive','linear_archive_asset_refs','linear_project_ids_shape_migration_20260728','pto_adjustments','pto_members','pto_requests','sample_review_events','settings_events','syncview_auth_events','track_b_team_rollback_intents','track_b_team_rollbacks','workload_plan'];
function seedHistory(c){
 c.exec(`
 insert into public.calendar_feedback_materializations(attempt_key,client,card_id,component,native_comment_id,canonical_comment_id,comment_dedup_key,request_fingerprint,outcome,applied)
 values('complete-history','fixture-client','historical-card','video','historical-native-comment','historical-canonical-comment','historical-dedup','historical-fingerprint','already_present','{"synthetic_history":true}');
 insert into public.calendar_post_events(client,post_id,action,source,payload) values('fixture-client','historical-card','comment_add','synthetic-history','{"body":"Retained synthetic note"}');
 insert into public.sample_review_events(client,sample_id,action,source,payload) values('fixture-client','historical-sample','comment_add','synthetic-history','{"body":"Retained synthetic note"}');
 insert into public.client_access_events(slug,ok,reason,source) values('fixture-client',false,'synthetic historical refusal','synthetic-history');
 insert into public.syncview_auth_events(surface,client_slug,ok,reason,payload) values('calendar','fixture-client',false,'synthetic historical refusal','{"synthetic_history":true}');
 insert into public.settings_events(surface,client_slug,actor,payload) values('calendar','fixture-client','synthetic-history','{"before":null,"after":"synthetic"}');
 insert into public.linear_archive(linear_uuid,identifier,client_slug,title,archived_at,comments,raw)
 values('complete-historical-archive','SYNTHETIC-ARCHIVE','fixture-client','Synthetic archived history','2026-09-01Z','[{"body":"Preserved synthetic comment"}]','{"synthetic_history":true}');
 insert into public.linear_archive_asset_refs(ref_id,linear_uuid,client_slug,source_kind,location_key,original_url,original_url_sha256,state)
 values('complete-historical-asset','complete-historical-archive','fixture-client','archive_raw','raw.description','https://uploads.linear.app/synthetic-complete-history',encode(extensions.digest('https://uploads.linear.app/synthetic-complete-history','sha256'),'hex'),'pending');
 insert into public.linear_project_ids_shape_migration_20260728(slug,before_linear_project_ids,after_linear_project_ids,applied_at)
 values('fixture-client','["synthetic-former-project"]','{"video":["synthetic-former-project"]}','2026-09-01Z');
 insert into public.team_members(id,name,role,team) values('00000000-0000-4000-8000-000000000815','Synthetic recovery PTO','editor','video');
 insert into public.pto_members(member_id,pto_start_date,pto_enabled) values('00000000-0000-4000-8000-000000000815','2025-01-01',true);
 insert into public.pto_requests(member_id,type,start_date,end_date,days,note,status,source) values('00000000-0000-4000-8000-000000000815','wellness','2026-09-01','2026-09-01',0.5,'Synthetic retained half-day','cancelled','hrvey_migration');
 insert into public.pto_adjustments(member_id,kind,delta,effective_date,reason,created_by) values('00000000-0000-4000-8000-000000000815','wellness',-0.5,'2026-09-01','Synthetic historical correction','synthetic-history');
 insert into public.workload_plan(issue_id,client,plan_date,updated_by) values('synthetic-priority','fixtureclient','2026-09-01','synthetic-history');
 `);
 // Existing reserved no-op drill creates authentic linked rollback/intents.
 // Preserve and restore all preexisting flag bytes in this same transaction.
 c.exec(`
 do $complete_drill$ declare saved jsonb; item record; outcome jsonb; begin
 select jsonb_object_agg(key,value) into saved from public.syncview_runtime_flags where key in ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled');
 if (select count(*) from jsonb_object_keys(saved))<>3 then raise exception 'complete_drill_flags_missing';end if;
 update public.syncview_runtime_flags set value='{"video":"linear","graphics":"linear"}' where key='prod_authority';
 update public.syncview_runtime_flags set value='{"mode":"off"}' where key='linear_outbound_enabled';
 update public.syncview_runtime_flags set value='{"enabled":false}' where key='linear_legacy_parity_enabled';
 select public.track_b_f27_begin_drill('{"video":"linear","graphics":"linear"}','synthetic-complete-recovery') into outcome;
 for item in select key,value from jsonb_each(saved) loop update public.syncview_runtime_flags set value=item.value where key=item.key;end loop;
 end $complete_drill$;`);
 for(const name of TABLES)assert.notEqual(c.run('',null,{sql:`select count(*) from public.${name}`,tuplesOnly:true}).trim(),'0','history fixture must populate '+name);
 return {tables:TABLES,scope:'synthetic historical structural preservation; existing reserved F27 drill; no hosted action or object bytes'};
}
module.exports={seedHistory,TABLES};
