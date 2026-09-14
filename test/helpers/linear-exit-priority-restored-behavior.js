'use strict';
const assert=require('node:assert/strict');
function verify({owner,asRole}){
 let checks=0;
 const run=sql=>{const r=owner(sql);assert.equal(r.status,0,r.stderr);checks++;};
 run(`begin;do $budget$ declare w timestamptz;r jsonb;begin
 select window_start into strict w from public.production_comment_read_budget where actor_key='synthetic-priority';
 if w<>to_timestamp(floor(extract(epoch from clock_timestamp())/300)*300) then raise exception 'RESTORED_BUDGET_WINDOW_ELAPSED';end if;
 if (select requests from public.production_comment_read_budget where actor_key='synthetic-priority' and window_start=w) is distinct from 119 then raise exception 'RESTORED_BUDGET_INITIAL_STATE';end if;
 r=public.production_comment_read_budget_take('synthetic-priority');if (r->>'allowed') is distinct from 'true' or (r->>'remaining')::int is distinct from 0 then raise exception 'RESTORED_BUDGET_CONTINUITY';end if;
 r=public.production_comment_read_budget_take('synthetic-priority');if (r->>'allowed') is distinct from 'false' then raise exception 'RESTORED_BUDGET_CAP';end if;
 if (select requests from public.production_comment_read_budget where actor_key='synthetic-priority' and window_start=w) is distinct from 120 then raise exception 'RESTORED_BUDGET_CHANGED_AFTER_REFUSAL';end if;
 end $budget$;rollback;`);
 run(`begin;do $identity$ declare prior bigint;fresh bigint;begin
 select max(id) into prior from public.production_comment_read_audit;
 insert into public.production_comment_read_audit(actor_key,auth_kind,decision,reason) values('synthetic-after-restore','staff','allow','synthetic') returning id into fresh;
 if prior is null or fresh is null or fresh<=prior then raise exception 'RESTORED_AUDIT_IDENTITY_COLLISION';end if;
 end $identity$;rollback;`);
 run(`begin;
 insert into public.clients(slug,display_name,active,kind) values('synthetic-restored-thumb','Synthetic',true,'test');
 update public.syncview_runtime_flags set value='{"mode":"on","clients":[]}' where key='thumbnail_revision_v2';
 insert into public.calendar_posts(client,id,thumbnail_url,graphic_status) values('synthetic-restored-thumb','synthetic-restored-thumb','https://drive.google.com/file/d/synthetic_drive_image_000001/view','Draft');
 do $thumb$ declare initial text;after_write text;begin
 select thumb_rev into strict initial from public.calendar_posts where client='synthetic-restored-thumb' and id='synthetic-restored-thumb';
 if coalesce(initial,'')='' then raise exception 'RESTORED_THUMB_TOKEN_MISSING';end if;
 update public.calendar_posts set thumbnail_url=thumbnail_url where client='synthetic-restored-thumb' and id='synthetic-restored-thumb';
 select thumb_rev into strict after_write from public.calendar_posts where client='synthetic-restored-thumb' and id='synthetic-restored-thumb';
 if after_write=initial or coalesce(after_write,'')='' then raise exception 'RESTORED_THUMB_TOKEN_NOT_ADVANCED';end if;
 if (select count(*) from public.thumbnail_media_revisions where client='synthetic-restored-thumb' and source_id='synthetic-restored-thumb' and reason='continuous_watch' and status='pending')<>1 then raise exception 'RESTORED_THUMB_WATCHER_DUPLICATED';end if;
 end $thumb$;rollback;`);
 for(const role of ['anon','authenticated'])for(const table of ['production_comment_read_audit','production_comment_import_conflicts','thumbnail_media_revisions']){
  const r=asRole(role,`select * from public.${table} limit 0;`);assert.notEqual(r.status,0);assert.match(r.stderr,/permission denied for table/);checks++;
 }
 return {checks,budget_restored_window_continuity:true,audit_identity_local_allocation:true,thumbnail_local_trigger_token_and_watcher:true,protected_role_denials:6,provider_calls:false,source_sequence_fence_proven:false};
}
module.exports={verify};
