'use strict';
const assert=require('node:assert/strict');const {scalar}=require('../../scripts/linear-exit-composition/harness');
const snapshotSql=`select jsonb_build_object('flag',(select to_jsonb(t) from public.syncview_runtime_flags t where key='production_native_identifier_mint'),'cursor',(select jsonb_agg(to_jsonb(t) order by team) from public.production_native_identifier_mint t),'grants',(select jsonb_agg(to_jsonb(t) order by identifier) from public.production_native_identifier_grants t),'deliverables',(select jsonb_agg(to_jsonb(t) order by id) from public.deliverables t where id like 'synthetic-nid-%'))`;
function seed(cluster){
 cluster.exec(`do $empty$ begin if exists(select from public.production_native_identifier_mint) or exists(select from public.production_native_identifier_grants) then raise exception 'NATIVE_IDENTIFIER_FIXTURE_NOT_EMPTY';end if;end $empty$;
 insert into public.clients(slug,display_name,active,kind) values('synthetic-nid-client','Synthetic',true,'test');
 insert into public.batches(id,client_slug,team,name) values('synthetic-nid-batch','synthetic-nid-client','video','Synthetic');
 insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,linear_identifier) values('synthetic-nid-provider','synthetic-nid-batch','synthetic-nid-client','video','other','Synthetic','todo','VID-42');
 select public.production_native_identifier_seed('video',100000);
 update public.syncview_runtime_flags set value=jsonb_set(value,'{video,mode}','"native"') where key='production_native_identifier_mint';
 do $cap$ begin if public.production_native_identifier_capability('video')->>'mode' is distinct from 'native' then raise exception 'NATIVE_IDENTIFIER_MODE_NOT_READY';end if;end $cap$;
 insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status) values('synthetic-nid-initial','synthetic-nid-batch','synthetic-nid-client','video','other','Synthetic','todo');
 do $collisions$ declare c public.production_native_identifier_mint;begin
 select * into strict c from public.production_native_identifier_mint where team='video';
 if not exists(select from public.production_native_identifier_grants where deliverable_id='synthetic-nid-initial') then raise exception 'NATIVE_IDENTIFIER_INITIAL_NOT_MINTED';end if;
 insert into public.production_native_identifier_grants(identifier,deliverable_id,team) values(c.prefix||'-'||c.next_ordinal,'synthetic-nid-orphan','video');
 insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,linear_identifier) values('synthetic-nid-collision','synthetic-nid-batch','synthetic-nid-client','video','other','Synthetic','todo',c.prefix||'-'||(c.next_ordinal+1));
 end $collisions$;`);
 return JSON.parse(scalar(cluster,"set timezone='UTC';"+snapshotSql));
}
function verify(owner,expected){
 const hex=Buffer.from(JSON.stringify(expected)).toString('hex');
 const result=owner(`begin;set local timezone='UTC';
 do $restore$ declare actual jsonb;c public.production_native_identifier_mint;allocated text;provider text;orphan jsonb;original_name text;cursor_before jsonb;begin
 select (${snapshotSql}) into actual;if actual is distinct from convert_from(decode('${hex}','hex'),'UTF8')::jsonb then raise exception 'NATIVE_IDENTIFIER_RESTORED_ROWS_DIFFER';end if;
 select * into strict c from public.production_native_identifier_mint where team='video';
 if exists(select from public.deliverables where id='synthetic-nid-orphan') then raise exception 'NATIVE_IDENTIFIER_ORPHAN_NOT_ORPHAN';end if;
 select to_jsonb(g) into strict orphan from public.production_native_identifier_grants g where deliverable_id='synthetic-nid-orphan';
 insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status) values('synthetic-nid-after','synthetic-nid-batch','synthetic-nid-client','video','other','Synthetic','todo') returning linear_identifier into allocated;
 if allocated is distinct from c.prefix||'-'||(c.next_ordinal+2) then raise exception 'NATIVE_IDENTIFIER_COLLISIONS_NOT_SKIPPED';end if;
 if (select next_ordinal from public.production_native_identifier_mint where team='video') is distinct from c.next_ordinal+3 then raise exception 'NATIVE_IDENTIFIER_CURSOR_ADVANCE';end if;
 if (select identifier from public.production_native_identifier_grants where deliverable_id='synthetic-nid-orphan') is distinct from c.prefix||'-'||c.next_ordinal then raise exception 'NATIVE_IDENTIFIER_ORPHAN_CHANGED';end if;
 provider=c.prefix||'-7';update public.deliverables set linear_identifier=provider where id='synthetic-nid-after';
 if (select linear_identifier from public.deliverables where id='synthetic-nid-after') is distinct from allocated or (select provider_identifier_refused from public.production_native_identifier_grants where deliverable_id='synthetic-nid-after') is distinct from provider then raise exception 'NATIVE_IDENTIFIER_PROVIDER_OVERWRITE';end if;
 select identifier into strict original_name from public.production_native_identifier_grants where deliverable_id='synthetic-nid-initial';
 update public.deliverables set linear_identifier=provider where id='synthetic-nid-initial';
 if (select linear_identifier from public.deliverables where id='synthetic-nid-initial') is distinct from original_name or (select provider_identifier_refused from public.production_native_identifier_grants where deliverable_id='synthetic-nid-initial') is distinct from provider then raise exception 'NATIVE_IDENTIFIER_RESTORED_GRANT_OVERWRITE';end if;
 update public.syncview_runtime_flags set value=jsonb_set(value,'{video,mode}','"provider"') where key='production_native_identifier_mint';
 provider=c.prefix||'-8';update public.deliverables set linear_identifier=provider where id='synthetic-nid-after';
 if (select linear_identifier from public.deliverables where id='synthetic-nid-after') is distinct from allocated or (select provider_identifier_refused from public.production_native_identifier_grants where deliverable_id='synthetic-nid-after') is distinct from provider then raise exception 'NATIVE_IDENTIFIER_PROVIDER_MODE_RENAME';end if;
 update public.deliverables set linear_identifier=provider where id='synthetic-nid-initial';
 if (select linear_identifier from public.deliverables where id='synthetic-nid-initial') is distinct from original_name or (select provider_identifier_refused from public.production_native_identifier_grants where deliverable_id='synthetic-nid-initial') is distinct from provider then raise exception 'NATIVE_IDENTIFIER_RESTORED_GRANT_PROVIDER_MODE_RENAME';end if;
 if (select to_jsonb(g) from public.production_native_identifier_grants g where deliverable_id='synthetic-nid-orphan') is distinct from orphan or exists(select from public.deliverables where id='synthetic-nid-orphan') then raise exception 'NATIVE_IDENTIFIER_ORPHAN_MUTATED';end if;
 select to_jsonb(m) into strict cursor_before from public.production_native_identifier_mint m where team='video';
 begin perform public.production_native_identifier_seed('video',100000);raise exception 'NATIVE_IDENTIFIER_RESEED_ACCEPTED';
 exception when sqlstate '55000' then if sqlerrm<>'native_identifier_already_seeded' then raise;end if;end;
 if (select to_jsonb(m) from public.production_native_identifier_mint m where team='video') is distinct from cursor_before then raise exception 'NATIVE_IDENTIFIER_RESEED_CHANGED_CURSOR';end if;
 end $restore$;rollback;`);
 assert.equal(result.status,0,result.stderr);
 const fresh=owner(`set timezone='UTC';do $fresh$ declare actual jsonb;begin select (${snapshotSql}) into actual;if actual is distinct from convert_from(decode('${hex}','hex'),'UTF8')::jsonb then raise exception 'NATIVE_IDENTIFIER_ROLLBACK_STATE_DIFFER';end if;end $fresh$;`);
 assert.equal(fresh.status,0,fresh.stderr);
 return {populated_cursor_grants_and_deliverables_exact:true,restored_collision_skips:2,cursor_advance:3,restored_and_new_grant_overwrite_refused_in_both_modes:true,reseed_refused_cursor_unchanged:true,fresh_connection_rollback_images_exact:true,hosted_allocator_proven:false};
}
module.exports={seed,verify};
