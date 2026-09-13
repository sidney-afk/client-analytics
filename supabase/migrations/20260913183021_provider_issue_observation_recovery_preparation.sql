-- Preparation only: original issue/attachment observation recovery, no provider mutation.
begin;
create or replace function public.production_provider_send_ack_v1(p_attempt_id uuid,p_lock_token text,p_request jsonb,p_response jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a linear_exit_provider.send_attempts_v1%rowtype;
begin
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 if a.lock_token is distinct from p_lock_token or a.request is distinct from p_request or jsonb_typeof(p_response) is distinct from 'object' then raise exception 'provider_send_ack_binding';end if;
 if a.provider_response->>'format' in ('provider-create-read-observations-v1','provider-comment-read-observations-v1','provider-issue-read-observations-v1') then raise exception 'provider_send_ack_observation_requires_reconciliation';end if;
 if a.state<>'admitted' then
  if a.provider_response is distinct from p_response then raise exception 'provider_send_ack_conflict';end if;
 else
  update linear_exit_provider.send_attempts_v1 set state='acknowledged',provider_response=p_response,acknowledged_at=clock_timestamp() where attempt_id=a.attempt_id;
 end if;
 return jsonb_build_object('acknowledged',true,'completed',false);
end $fn$;



create function public.production_provider_issue_observation_plan_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $plan$
declare gate public.card_write_admission_v1%rowtype;a linear_exit_provider.send_attempts_v1%rowtype;o public.mirror_outbox%rowtype;native jsonb;initial jsonb;issue_id text;kind text;k text;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.mode<>'closed' or gate.epoch is distinct from p_epoch then raise exception 'provider_issue_observation_gate';end if;
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 select * into strict o from public.mirror_outbox where id=a.outbox_id for update;
 if to_jsonb(o) is distinct from p_expected_outbox then raise exception 'provider_issue_observation_cas';end if;
 kind:=a.request->>'kind';initial:=a.receipt_context_v1->'context'->'entity';issue_id:=a.receipt_context_v1->>'issueId';
 if a.admission_preimage_v1 is null or a.receipt_context_v1 is null or jsonb_typeof(initial) is distinct from 'object' or a.state not in ('admitted','completed') or coalesce(kind,'') not in ('issueUpdate','issueArchive','issueUnarchive','attachmentCreate') or coalesce(o.entity,'') not in ('batch','deliverable') or nullif(issue_id,'') is null or (a.replay_scope is not null and a.replay_scope<>'null'::jsonb) then raise exception 'provider_issue_observation_scope';end if;
 if (kind='issueUpdate' and coalesce(o.operation,'') not in ('status','due','assignee','title','description','priority','parent','labels')) or (kind='issueArchive' and o.operation is distinct from 'archive') or (kind='issueUnarchive' and o.operation is distinct from 'restore') or (kind='attachmentCreate' and o.operation is distinct from 'attachment') then raise exception 'provider_issue_observation_operation';end if;
 if (kind='attachmentCreate' and a.request->'variables'->'input'->>'issueId' is distinct from issue_id) or (kind<>'attachmentCreate' and a.request->'variables'->>'id' is distinct from issue_id) then raise exception 'provider_issue_observation_issue';end if;
 if (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) is distinct from (a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) then raise exception 'provider_issue_observation_original_intent';end if;
 if a.state='admitted' and (o.lock_token::text is distinct from a.lock_token or o.locked_at is null or o.status not in ('pending','failed','shadow_ok')) then raise exception 'provider_issue_observation_lock';end if;
 if o.entity='deliverable' then
  select to_jsonb(d) into strict native from public.deliverables d where d.id=o.entity_id for share;
  foreach k in array array['id','batch_id','client_slug','team','kind','origin','card_id','created_by','created_at','linear_issue_uuid'] loop if native->k is distinct from initial->k then raise exception 'provider_issue_observation_native_identity';end if;end loop;
  if native->>'linear_issue_uuid' is distinct from issue_id or native->>'team' is distinct from o.team then raise exception 'provider_issue_observation_native_target';end if;
 else
  select to_jsonb(b) into strict native from public.batches b where b.id=o.entity_id for share;
  foreach k in array array['id','client_slug','created_by','created_at'] loop if native->k is distinct from initial->k then raise exception 'provider_issue_observation_native_identity';end if;end loop;
  if coalesce(native->'linear_parent_ids'->lower(o.team)->>'uuid',native->'linear_parent_ids'->lower(o.team)->>'id') is distinct from issue_id then raise exception 'provider_issue_observation_native_target';end if;
 end if;
 if native->>'client_slug' is distinct from o.client_slug then raise exception 'provider_issue_observation_native_client';end if;
 return jsonb_build_object('attempt_id',a.attempt_id,'request_sha256',a.request_sha256,'kind',kind,'issue_id',issue_id,'native',native,'payload',a.admission_preimage_v1->'payload');
end $plan$;

create function public.production_provider_issue_observe_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb,p_expected_observation jsonb,p_query text,p_variables jsonb,p_response jsonb,p_projection jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $observe$
declare plan jsonb;a linear_exit_provider.send_attempts_v1%rowtype;history jsonb;last_observation jsonb;round_id integer;page_id integer:=0;query_kind text;expected_variables jsonb;envelope jsonb;nodes jsonb;node jsonb;entry jsonb;i integer:=0;
begin
 plan:=public.production_provider_issue_observation_plan_v1(p_epoch,p_attempt_id,p_expected_outbox);
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id;
 if a.state<>'admitted' or a.provider_response is distinct from p_expected_observation then raise exception 'provider_issue_observe_cas';end if;
 if a.provider_response is null then history:='[]';elsif a.provider_response->>'format'='provider-issue-read-observations-v1' and a.provider_response->>'issue_id'=plan->>'issue_id' and jsonb_typeof(a.provider_response->'observations')='array' then history:=a.provider_response->'observations';else raise exception 'provider_issue_observe_existing_evidence';end if;
 last_observation:=history->-1;round_id:=coalesce((last_observation->>'round')::integer,0);
 if p_query='query SyncViewMirrorIssue($id: String!) { issue(id: $id) { id identifier title description url priority dueDate archivedAt updatedAt
state { id name type }
team { id key name states { nodes { id name type position } } }
project { id name }
assignee { id name email }
parent { id identifier title }
labelIds
labels(first: 100, includeArchived: true) { nodes { id name color description } pageInfo { hasNextPage } }
attachments(first: 100) { nodes { id url title subtitle } pageInfo { hasNextPage endCursor } }
comments(first: 100) { nodes { id body createdAt user { id name email } } } } }' then query_kind:='issue';round_id:=round_id+1;expected_variables:=jsonb_build_object('id',plan->'issue_id');
 elsif p_query='query SyncViewMirrorIssueAttachments($id: String!, $after: String) { issue(id: $id) { attachments(first: 100, after: $after) { nodes { id url title subtitle } pageInfo { hasNextPage endCursor } } } }' and plan->>'kind'='attachmentCreate' then
  query_kind:='attachments';page_id:=coalesce((last_observation->>'page')::integer,0)+1;
  if last_observation->>'query_kind' not in ('issue','attachments') or last_observation->'response'->>'http_status' is distinct from '200' or last_observation->'response'->'body'?'errors' or last_observation->'response'->'body'->'data'->'issue'->'attachments'->'pageInfo'->'hasNextPage' is distinct from 'true'::jsonb or nullif(last_observation->'response'->'body'->'data'->'issue'->'attachments'->'pageInfo'->>'endCursor','') is null then raise exception 'provider_issue_observe_pagination';end if;
  expected_variables:=jsonb_build_object('id',plan->'issue_id','after',last_observation->'response'->'body'->'data'->'issue'->'attachments'->'pageInfo'->'endCursor');
  if page_id>50 or exists(select from jsonb_array_elements(history)x where x->>'round'=round_id::text and x->'variables'->'after'=expected_variables->'after') then raise exception 'provider_issue_observe_pagination_bound';end if;
 else raise exception 'provider_issue_observe_query';end if;
 if p_variables is distinct from expected_variables then raise exception 'provider_issue_observe_variables';end if;
 if jsonb_typeof(p_response) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(p_response)key) is distinct from array['body','http_status']::text[] or jsonb_typeof(p_response->'http_status') is distinct from 'number' or (p_response->>'http_status')::numeric not between 100 and 599 or trunc((p_response->>'http_status')::numeric)<>(p_response->>'http_status')::numeric or jsonb_typeof(p_response->'body') is distinct from 'object' or octet_length(p_response::text)>1048576 then raise exception 'provider_issue_observe_response';end if;
 if plan->>'kind'='attachmentCreate' then
  nodes:=p_response->'body'->'data'->'issue'->'attachments'->'nodes';if jsonb_typeof(nodes) is distinct from 'array' then nodes:='[]';end if;
  if jsonb_typeof(p_projection) is distinct from 'object' or p_projection->>'format' is distinct from 'provider-attachment-canonical-projection-v1' or p_projection->>'source_sha256' is distinct from 'dad75fc2c545628108a9a6e84cd5c55922455ab144b302a47410efc843ca45ef' or p_projection->'intent'->'raw_url' is distinct from coalesce(plan->'payload'->'url','null'::jsonb) or jsonb_typeof(p_projection->'intent'->'canonical_url') is distinct from 'string' or p_projection->'native'->'raw_url' is distinct from coalesce(plan->'native'->'file_url','null'::jsonb) or p_projection->'native'->'revision' is distinct from coalesce(plan->'native'->'artifact_revision','null'::jsonb) or jsonb_typeof(p_projection->'native'->'canonical_url') is distinct from 'string' or jsonb_typeof(p_projection->'entries') is distinct from 'array' or jsonb_array_length(p_projection->'entries')<>jsonb_array_length(nodes) then raise exception 'provider_issue_observe_projection';end if;
  for node in select value from jsonb_array_elements(nodes) loop
   entry:=p_projection->'entries'->i;
   if entry->'index' is distinct from to_jsonb(i) or entry->'raw_url' is distinct from coalesce(node->'url','null'::jsonb) or entry->'raw_subtitle' is distinct from coalesce(node->'subtitle','null'::jsonb) or jsonb_typeof(entry->'canonical_url') is distinct from 'string' or jsonb_typeof(entry->'subtitle') is distinct from 'string' then raise exception 'provider_issue_observe_projection_binding';end if;
   if jsonb_typeof(node->'subtitle')='string' and entry->>'subtitle' is distinct from public.production_provider_receipt_clean_v1(node->'subtitle') then raise exception 'provider_issue_observe_subtitle_projection';end if;
   i:=i+1;
  end loop;
 elsif p_projection is not null and p_projection<>'null'::jsonb then raise exception 'provider_issue_observe_projection_unexpected';end if;
 if jsonb_array_length(history)>=128 or octet_length(history::text)+octet_length(p_response::text)+coalesce(octet_length(p_projection::text),0)>16777216 then raise exception 'provider_issue_observe_history_bound';end if;
 envelope:=jsonb_build_object('format','provider-issue-read-observations-v1','issue_id',plan->'issue_id','observations',history||jsonb_build_array(jsonb_build_object('sequence',jsonb_array_length(history)+1,'round',round_id,'page',page_id,'query_kind',query_kind,'query_sha256',encode(extensions.digest(convert_to(p_query,'UTF8'),'sha256'),'hex'),'variables',p_variables,'recorded_at',clock_timestamp(),'response',p_response,'response_sha256',encode(extensions.digest(convert_to(p_response::text,'UTF8'),'sha256'),'hex'),'attempt_id',a.attempt_id,'request_sha256',a.request_sha256,'projection',p_projection)));
 update linear_exit_provider.send_attempts_v1 set provider_response=envelope where attempt_id=a.attempt_id;
 return jsonb_build_object('recorded',true,'observation',envelope,'mutation_acknowledged',false,'provider_resent',false);
end $observe$;

create function public.production_provider_issue_observed_recover_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $recover$
declare plan jsonb;a linear_exit_provider.send_attempts_v1%rowtype;o public.mirror_outbox%rowtype;history jsonb;observation jsonb;issue_observation jsonb;issue jsonb;round_id text;payload jsonb;ctx jsonb;actual jsonb;intended jsonb;labels jsonb;compact jsonb;receipt jsonb;after_row jsonb;native jsonb;matches integer;marker jsonb;expected_input jsonb;historical_raw jsonb;completed_before boolean:=false;
begin
 plan:=public.production_provider_issue_observation_plan_v1(p_epoch,p_attempt_id,p_expected_outbox);
 if (select value from public.syncview_runtime_flags where key='linear_outbound_enabled') is distinct from '{"mode":"off"}'::jsonb or (select value from public.syncview_runtime_flags where key='linear_legacy_parity_enabled') is distinct from '{"enabled":false}'::jsonb then raise exception 'provider_issue_observed_stops';end if;
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id;
 select * into strict o from public.mirror_outbox where id=a.outbox_id;
 if a.provider_response->>'format' is distinct from 'provider-issue-read-observations-v1' or jsonb_typeof(a.provider_response->'observations') is distinct from 'array' then raise exception 'provider_issue_observed_evidence';end if;
 history:=a.provider_response->'observations';round_id:=history->-1->>'round';
 select x into issue_observation from jsonb_array_elements(history)x where x->>'round'=round_id and x->>'query_kind'='issue';
 issue:=issue_observation->'response'->'body'->'data'->'issue';
 if issue_observation->'response'->>'http_status' is distinct from '200' or issue_observation->'response'->'body'?'errors' or jsonb_typeof(issue) is distinct from 'object' or issue->>'id' is distinct from plan->>'issue_id' then raise exception 'provider_issue_observed_issue';end if;
 payload:=a.admission_preimage_v1->'payload';ctx:=a.receipt_context_v1->'context';native:=plan->'native';
 -- Required selected fields must be present; a truncated read is not a clear intent.
 if (o.operation='status' and (jsonb_typeof(issue->'state') is distinct from 'object' or jsonb_typeof(issue->'state'->'id') is distinct from 'string'))
 or (o.operation in ('status','due') and (o.operation='due' or payload?'due_date') and (not(issue?'dueDate') or jsonb_typeof(issue->'dueDate') not in ('null','string')))
 or (o.operation in ('assignee','parent') and (not(issue?case when o.operation='assignee' then 'assignee' else 'parent' end) or (issue->(case when o.operation='assignee' then 'assignee' else 'parent' end)<>'null'::jsonb and (jsonb_typeof(issue->(case when o.operation='assignee' then 'assignee' else 'parent' end)) is distinct from 'object' or jsonb_typeof(issue->(case when o.operation='assignee' then 'assignee' else 'parent' end)->'id') is distinct from 'string'))))
 or (o.operation='title' and jsonb_typeof(issue->'title') is distinct from 'string')
 or (o.operation='description' and (not(issue?'description') or jsonb_typeof(issue->'description') not in ('null','string')))
 or (o.operation='priority' and (not(issue?'priority') or jsonb_typeof(issue->'priority') not in ('null','number')))
 or (o.operation in ('archive','restore') and (not(issue?'archivedAt') or jsonb_typeof(issue->'archivedAt') not in ('null','string')))
 then raise exception 'provider_issue_observed_selected_field';end if;


 if o.operation in ('parent','restore') and (native->>'created_at')::timestamptz<'2026-07-12T04:48:56.000Z'::timestamptz then
  historical_raw:=native->'linear_raw';if jsonb_typeof(historical_raw)='string' then begin historical_raw:=(historical_raw#>>'{}')::jsonb;exception when invalid_text_representation then historical_raw:='{}';end;end if;
  begin completed_before:=nullif(historical_raw->'issue'->>'completedAt','')::timestamptz<'2026-07-12T04:48:56.000Z'::timestamptz;exception when invalid_datetime_format or datetime_field_overflow then completed_before:=false;end;
  if lower(public.production_provider_receipt_clean_v1(native->'created_by')) in ('linear-backfill','history-backfill-2026-07-10') or lower(public.production_provider_receipt_clean_v1(native->'origin'))='backfill' or coalesce(completed_before,false) then raise exception 'provider_issue_observed_historical_disposition';end if;
 end if;
 case o.operation
 when 'status' then
  actual:=to_jsonb(public.production_provider_receipt_clean_v1(issue->'state'->'id'));intended:=to_jsonb(public.production_provider_receipt_clean_v1(coalesce(nullif(nullif(payload->'state_id','""'::jsonb),'null'::jsonb),ctx->'state_id')));
  if payload?'due_date' then actual:=to_jsonb('['||actual::text||','||coalesce(to_jsonb(nullif(public.production_provider_receipt_clean_v1(issue->'dueDate'),''))::text,'null')||']');intended:=to_jsonb('['||intended::text||','||coalesce(to_jsonb(nullif(public.production_provider_receipt_clean_v1(payload->'due_date'),''))::text,'null')||']');end if;
 when 'due' then actual:=to_jsonb(nullif(public.production_provider_receipt_clean_v1(issue->'dueDate'),''));intended:=to_jsonb(nullif(public.production_provider_receipt_clean_v1(payload->'due_date'),''));
 when 'assignee' then actual:=to_jsonb(nullif(public.production_provider_receipt_clean_v1(issue->'assignee'->'id'),''));intended:=to_jsonb(nullif(public.production_provider_receipt_clean_v1(coalesce(nullif(nullif(payload->'linear_user_id','""'::jsonb),'null'::jsonb),ctx->'linear_user_id')),''));
 when 'title' then actual:=to_jsonb(public.production_provider_receipt_clean_v1(issue->'title'));intended:=to_jsonb(public.production_provider_receipt_clean_v1(payload->'title'));
 when 'description' then actual:=case when issue->'description' is null or issue->'description'='null' then '""'::jsonb when jsonb_typeof(issue->'description')='string' then issue->'description' else null end;intended:=case when jsonb_typeof(payload->'description')='string' then payload->'description' else null end;if actual is null or intended is null then raise exception 'provider_issue_observed_description';end if;
 when 'priority' then actual:=to_jsonb(coalesce(nullif(issue->>'priority','')::numeric,0));intended:=to_jsonb(coalesce(nullif(payload->>'priority','')::numeric,0));
 when 'parent' then actual:=to_jsonb(nullif(public.production_provider_receipt_clean_v1(issue->'parent'->'id'),''));intended:=to_jsonb(nullif(public.production_provider_receipt_clean_v1(coalesce(nullif(nullif(payload->'parent_linear_issue_id','""'::jsonb),'null'::jsonb),ctx->'parent_linear_issue_id')),''));
 when 'labels' then
  if jsonb_typeof(issue->'labelIds') is distinct from 'array' or jsonb_typeof(payload->'label_ids') is distinct from 'array' then raise exception 'provider_issue_observed_labels';end if;
  if exists(select from jsonb_array_elements(issue->'labelIds')x where jsonb_typeof(x) is distinct from 'string' or public.production_provider_receipt_clean_v1(x)='') then raise exception 'provider_issue_observed_labels';end if;
  select to_jsonb('['||coalesce(string_agg(to_jsonb(v)::text,',' order by v),'')||']') into actual from(select distinct public.production_provider_receipt_clean_v1(value)v from jsonb_array_elements(issue->'labelIds'))x where v<>'';
  select to_jsonb('['||coalesce(string_agg(to_jsonb(v)::text,',' order by v),'')||']') into intended from(select distinct public.production_provider_receipt_clean_v1(value)v from jsonb_array_elements(payload->'label_ids'))x where v<>'';
 when 'archive' then actual:=to_jsonb(issue->'archivedAt' is not null and issue->'archivedAt' not in ('null','false','0','""'));intended:='true';
 when 'restore' then actual:=to_jsonb(issue->'archivedAt' is not null and issue->'archivedAt' not in ('null','false','0','""'));intended:='false';
 when 'attachment' then
  marker:=a.request->'variables'->'input';
  if o.entity<>'deliverable' or jsonb_typeof(payload->'artifact_revision') is distinct from 'number' or (payload->>'artifact_revision')::numeric<=0 or trunc((payload->>'artifact_revision')::numeric)<>(payload->>'artifact_revision')::numeric or (payload->>'artifact_revision')::numeric>9007199254740991 or native->'artifact_revision' is distinct from payload->'artifact_revision' or marker->'metadata'->'syncviewArtifactRevision' is distinct from payload->'artifact_revision' or marker->>'subtitle' is distinct from 'SyncView canonical revision '||(payload->>'artifact_revision') then raise exception 'provider_issue_observed_native_revision';end if;

  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into expected_input from jsonb_each(case when jsonb_typeof(payload->'metadata')='object' then payload->'metadata' else '{}'::jsonb end) where public.production_provider_receipt_clean_v1(to_jsonb(key))<>'' and length(key)<=100 and jsonb_typeof(value) in ('string','number','boolean');
  expected_input:=jsonb_build_object('issueId',plan->'issue_id','url',marker->'url','title',coalesce(nullif(public.production_provider_receipt_clean_v1(payload->'title'),''),'SyncView canonical Graphics deliverable'),'subtitle','SyncView canonical revision '||(payload->>'artifact_revision'),'metadata',expected_input||jsonb_build_object('syncviewArtifactRevision',payload->'artifact_revision'));
  if a.request->'variables' is distinct from jsonb_build_object('input',expected_input) then raise exception 'provider_issue_observed_request_intent';end if;
  matches:=0;
  for observation in select value from jsonb_array_elements(history) where value->>'round'=round_id loop
   if observation->'response'->>'http_status' is distinct from '200' or observation->'response'->'body'?'errors' or jsonb_typeof(observation->'response'->'body'->'data'->'issue'->'attachments'->'nodes') is distinct from 'array' then raise exception 'provider_issue_observed_attachment_response';end if;
   if observation->>'attempt_id' is distinct from a.attempt_id::text or observation->>'request_sha256' is distinct from a.request_sha256 or observation->>'response_sha256' is distinct from encode(extensions.digest(convert_to((observation->'response')::text,'UTF8'),'sha256'),'hex') or observation->'projection'->'native'->'raw_url' is distinct from native->'file_url' or observation->'projection'->'native'->'revision' is distinct from native->'artifact_revision' or observation->'projection'->'native'->'canonical_url' is distinct from marker->'url' or observation->'projection'->'intent'->'canonical_url' is distinct from marker->'url' then raise exception 'provider_issue_observed_projection_current';end if;
   select matches+count(*) into matches from jsonb_array_elements(observation->'projection'->'entries')x where x->'canonical_url'=marker->'url' and x->'subtitle'=marker->'subtitle';
  end loop;
  actual:=to_jsonb(matches>0);intended:='true';
 else raise exception 'provider_issue_observed_operation';end case;

 -- A receipt cannot reconcile a request whose recorded mutation contradicted its intent.
 if a.request->>'kind'='issueUpdate' then
  if a.request->>'query' is distinct from 'mutation SyncViewMirrorUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier title description url priority dueDate archivedAt updatedAt
state { id name type }
team { id key name states { nodes { id name type position } } }
project { id name }
assignee { id name email }
parent { id identifier title }
labelIds
labels(first: 100, includeArchived: true) { nodes { id name color description } pageInfo { hasNextPage } }
attachments(first: 100) { nodes { id url title subtitle } pageInfo { hasNextPage endCursor } }
comments(first: 100) { nodes { id body createdAt user { id name email } } } } } }' then raise exception 'provider_issue_observed_request_query';end if;
  expected_input:=case o.operation
   when 'status' then case when payload?'due_date' then jsonb_build_object('stateId',(intended#>>'{}')::jsonb->0,'dueDate',(intended#>>'{}')::jsonb->1) else jsonb_build_object('stateId',intended) end
   when 'due' then jsonb_build_object('dueDate',intended)
   when 'assignee' then jsonb_build_object('assigneeId',intended)
   when 'title' then jsonb_build_object('title',intended)
   when 'description' then jsonb_build_object('description',case when intended='""'::jsonb then 'null'::jsonb else intended end)
   when 'priority' then jsonb_build_object('priority',intended)
   when 'parent' then jsonb_build_object('parentId',intended)
   when 'labels' then jsonb_build_object('labelIds',(intended#>>'{}')::jsonb) end;
  if a.request->'variables' is distinct from jsonb_build_object('id',plan->'issue_id','input',expected_input) then raise exception 'provider_issue_observed_request_intent';end if;
 elsif a.request->>'kind' in ('issueArchive','issueUnarchive') and a.request->'variables' is distinct from jsonb_build_object('id',plan->'issue_id') then raise exception 'provider_issue_observed_request_intent';
 end if;
 if (a.request->>'kind'='issueArchive' and a.request->>'query' is distinct from 'mutation SyncViewMirrorArchive($id: String!) { issueArchive(id: $id) { success } }') or (a.request->>'kind'='issueUnarchive' and a.request->>'query' is distinct from 'mutation SyncViewMirrorRestore($id: String!) { issueUnarchive(id: $id) { success } }') or (a.request->>'kind'='attachmentCreate' and a.request->>'query' is distinct from 'mutation SyncViewMirrorAttachment($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success attachment { id url title subtitle } } }') then raise exception 'provider_issue_observed_request_query';end if;
 if actual is distinct from intended then raise exception 'provider_issue_observed_unresolved';end if;
 labels:=case when jsonb_typeof(issue->'labelIds')='array' then issue->'labelIds' else coalesce((select jsonb_agg(x->'id') from jsonb_array_elements(case when jsonb_typeof(issue->'labels')='array' then issue->'labels' when jsonb_typeof(issue->'labels'->'nodes')='array' then issue->'labels'->'nodes' else '[]' end)x),'[]') end;
 compact:=jsonb_build_object('id',public.production_provider_receipt_clean_v1(issue->'id'),'identifier',public.production_provider_receipt_clean_v1(issue->'identifier'),'description',case when jsonb_typeof(issue->'description')='string' then issue->'description' else 'null'::jsonb end,'updated_at',public.production_provider_receipt_clean_v1(issue->'updatedAt'),'state_id',public.production_provider_receipt_clean_v1(issue->'state'->'id'),'due_date',nullif(public.production_provider_receipt_clean_v1(issue->'dueDate'),''),'assignee_id',nullif(public.production_provider_receipt_clean_v1(issue->'assignee'->'id'),''),'parent_id',nullif(public.production_provider_receipt_clean_v1(issue->'parent'->'id'),''),'label_ids',(select coalesce(jsonb_agg(v order by v),'[]') from(select distinct public.production_provider_receipt_clean_v1(value) v from jsonb_array_elements(labels))x where v<>''),'archived',issue->'archivedAt' is not null and issue->'archivedAt' not in ('null','false','0','""'));
 receipt:=coalesce(nullif(a.admission_preimage_v1->'linear_result','null'::jsonb),'{}'::jsonb)||jsonb_build_object('conflict',jsonb_build_object('decision','already_applied','actual',actual,'intended',intended),'issue',compact,'recovered_idempotently',false);
 if a.state='completed' then
  if o.status is distinct from 'skipped' or o.lock_token is not null or o.linear_result is distinct from receipt or a.local_receipt is distinct from receipt then raise exception 'provider_issue_observed_completed_conflict';end if;
  return jsonb_build_object('completed',true,'provider_resent',false,'replayed_receipt',true);
 end if;
 if o.linear_result is not null and o.linear_result is distinct from a.admission_preimage_v1->'linear_result' then raise exception 'provider_issue_observed_checkpoint_conflict';end if;
 after_row:=to_jsonb(o)||jsonb_build_object('status','skipped','linear_result',receipt,'processed_at',now(),'last_error',null,'next_retry_at',null,'attempts',coalesce(o.attempts,0)+1,'lock_token',null,'locked_at',null,'updated_at',now());
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),p_epoch,'provider_recovery',jsonb_build_object('before',to_jsonb(o),'after',after_row));
 update public.mirror_outbox set status='skipped',linear_result=receipt,processed_at=now(),last_error=null,next_retry_at=null,attempts=coalesce(o.attempts,0)+1,lock_token=null,locked_at=null,updated_at=now() where id=o.id;
 delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 update linear_exit_provider.send_attempts_v1 set state='completed',local_receipt=receipt,completed_at=clock_timestamp() where attempt_id=a.attempt_id;
 return jsonb_build_object('completed',true,'provider_resent',false,'native_work_preserved',true,'mutation_acknowledged',false);
end $recover$;
revoke all on function public.production_provider_issue_observation_plan_v1(uuid,uuid,jsonb),public.production_provider_issue_observe_v1(uuid,uuid,jsonb,jsonb,text,jsonb,jsonb,jsonb),public.production_provider_issue_observed_recover_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.production_provider_issue_observation_plan_v1(uuid,uuid,jsonb),public.production_provider_issue_observe_v1(uuid,uuid,jsonb,jsonb,text,jsonb,jsonb,jsonb),public.production_provider_issue_observed_recover_v1(uuid,uuid,jsonb) to service_role;
create or replace function public.production_provider_terminal_eligible_v1(o public.mirror_outbox)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare gate public.card_write_admission_v1%rowtype; a linear_exit_provider.send_attempts_v1%rowtype;
begin
 select * into gate from public.card_write_admission_v1 where singleton;
 if gate.mode not in ('closed','sealed') or o.lock_token is not null or o.locked_at is not null or o.next_retry_at is not null or o.processed_at is null then return false;end if;
 -- Composite arguments do not authorize invented row values.
 if not exists(select from public.mirror_outbox x where x.id=o.id and to_jsonb(x)=to_jsonb(o)) then return false;end if;
 select * into a from linear_exit_provider.send_attempts_v1 where outbox_id=o.id;
 if found then return coalesce(a.state='completed' and a.completed_at is not null and (o.status='written' or (o.status='skipped' and a.provider_response->>'format'='provider-comment-read-observations-v1' and a.request->>'kind' in ('commentCreate','commentUpdate','commentDelete') and o.linear_result->'conflict'->>'decision'='already_applied' and o.linear_result->'conflict'->>'reason' in ('comment_marker_receipt','comment_delete_attempt_receipt') and o.linear_result->'recovered_idempotently'='true'::jsonb) or (o.status='skipped' and a.provider_response->>'format'='provider-issue-read-observations-v1' and a.request->>'kind' in ('issueUpdate','issueArchive','issueUnarchive','attachmentCreate') and o.linear_result->'conflict'->>'decision'='already_applied' and o.linear_result->'recovered_idempotently'='false'::jsonb)) and a.local_receipt=o.linear_result and a.admission_preimage_v1 is not null and lower(o.team)=a.team and (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status'])=(a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']),false);end if;
 if public.production_provider_legacy_written_shape_v1(o) then
  return exists(select from jsonb_array_elements(gate.control_history) h cross join lateral jsonb_array_elements(case when jsonb_typeof(h->'rows')='array' then h->'rows' else '[]' end) x where h->>'action'='provider_terminal_history' and h->>'epoch'=gate.epoch::text and h->>'source_sha256'='8b6823724bbeda49449fd584f5953e40c4f2c14428c66c3458d17471c06daaf4' and x->>'id'=o.id::text and x->>'sha256'=encode(extensions.digest(convert_to(to_jsonb(o)::text,'UTF8'),'sha256'),'hex'));
 end if;
 -- Only the exact source-owned discard removes work. Quarantine stays unresolved.
 return exists(select from public.track_b_team_rollback_intents i join public.track_b_team_rollbacks r on r.id=i.rollback_id cross join lateral jsonb_array_elements(gate.control_history) h
  where i.outbox_id=o.id and not r.is_drill and i.classification='discard' and i.terminal_receipt is null and o.status='skipped' and o.linear_result is null and o.last_error='F27 discard: '||i.reason
  and i.row_sha256=encode(extensions.digest(convert_to(i.row_snapshot::text,'UTF8'),'sha256'),'hex')
  and (to_jsonb(o)-array['status','last_error','next_retry_at','updated_at','processed_at'])=(i.row_snapshot-array['status','last_error','next_retry_at','updated_at','processed_at'])
  and h->>'action'='provider_disposition' and h->>'epoch'=gate.epoch::text and h->>'rollback_id'=r.id::text and h->>'outbox_id'=o.id::text and h->>'classification'='discard' and h->>'snapshot_sha256'=i.row_sha256 and h->>'actor'=i.classified_by and h->>'reason'=i.reason);
end $fn$;
commit;
