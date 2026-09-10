'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=(cluster,root)=>{
 const run=file=>cluster.runFile(path.join(root,'migrations',file));
 const cut=(file,start,end)=>{const text=fs.readFileSync(path.join(root,'migrations',file),'utf8');const a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<0)throw Error('schema seam drift');return text.slice(a,b);};
 run('calendar-status-at-migration.sql');
 run('2026-07-05-b0-linear-auth-scaffold.sql');
 run('2026-08-04-client-access-auto-provision.sql');
 cluster.exec(`alter table clients add column if not exists emoji text, add column if not exists board_status text default 'in_progress', add column if not exists lead_member_id uuid references team_members(id), add column if not exists target_date date, add column if not exists board_desc text;`);
 for(const file of ['2026-07-23-f201-production-labels.sql','2026-07-23-f202-production-descriptions.sql','2026-07-23-production-comment-thread-lifecycle.sql','2026-07-23-f34-f53-production-attachments.sql','2026-08-06-artifact-projection-scope-and-revision.sql','2026-08-30-artifact-video-projection.sql','2026-09-05-artifact-card-binding-first.sql','2026-09-09-editors-event-assignee.sql','2026-09-09-native-ordinary-receipts.sql','2026-09-11-native-ordinary-receipt-repair.sql','2026-09-12-native-ordinary-envelope-repair.sql'])run(file);
 cluster.exec(`alter table clients add column if not exists slack_channel_id text;
 alter table team_members add column if not exists slack_user_id text;
 create table if not exists workload_issues(id text primary key,active boolean,is_sub_issue boolean,team_key text,team_name text,client_name text,status_type text,assignee_id text);
 insert into syncview_runtime_flags(key,value) values
 ('calendar_upsert_ef_clients','{"clients":["fixture-client"]}'),('sample_review_ef_clients','{"clients":["fixture-client"]}'),('settings_ef_clients','{"clients":["fixture-client"]}'),('write_ui_reroute_clients','{"clients":["fixture-client"]}'),('client_comment_gateway_enabled','{"enabled":true}')
 on conflict(key) do update set value=excluded.value;
 update syncview_runtime_flags set value='{"video":{"enabled":true,"epoch":"browser-v1"},"graphics":{"enabled":true,"epoch":"browser-g1"}}' where key='native_intake_epochs';
 update syncview_runtime_flags set value='{"schema_version":1,"video":{"mode":"native","epoch":"ordinary-v1"},"graphics":{"mode":"native","epoch":"ordinary-g1"}}' where key='production_native_ordinary_receipts';`);
 run('2026-09-09-native-client-provisioning.sql');
 cluster.exec(`insert into clients(slug,display_name,active,kind,linear_project_ids) select 'fixtureclient','Fixture Client',true,'client',linear_project_ids from clients where slug='fixture-client';
 update clients set active=false,linear_project_ids='{}' where slug='fixture-client';
 select production_native_client_provision('browser-native-client-1','fixturenativeclient','Fixture Native Client');
 update syncview_runtime_flags set value=jsonb_set(value,'{clients}',coalesce(value->'clients','[]')||'"fixtureclient"'::jsonb) where key in('calendar_upsert_ef_clients','sample_review_ef_clients','settings_ef_clients','write_ui_reroute_clients');
 update clients set slack_channel_id='C1234567890' where slug in('fixtureclient','fixturenativeclient');
 update team_members set slack_user_id='U1234567890' where role='editor';`);
 run('2026-09-06-native-existing-assignment.sql');
 cluster.exec(`update syncview_runtime_flags set value='{"video":{"mode":"native","epoch":"assignment-v1"},"graphics":{"mode":"native","epoch":"assignment-g1"}}' where key='native_assignment_epochs';`);
 run('2026-07-19-workload-plan.sql');
 run('2026-09-09-native-attribution-browser-projection.sql');
 for(const file of ['2026-09-02-workload-native-view.sql','2026-09-05-workload-native-membership.sql','2026-09-08-workload-native-label-state-shape.sql','2026-09-09-workload-native-roster.sql','2026-09-09-native-notification-outbox.sql'])run(file);
 for(const file of ['2026-09-05-native-label-catalog-foundation.sql','2026-09-06-native-label-writes.sql'])run(file);
 const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const manifest={schema_version:1,capture_id:uuid(800),source_kind:'linear_workspace_issue_labels',source_sha256:'a'.repeat(64),workspace_fingerprint:'b'.repeat(64),captured_at:'2026-09-06T10:00:00Z',include_archived:true,teams:{video:uuid(900),graphics:uuid(901)},expected_count:1,pages:[{after:null,nodes:[{id:uuid(1),name:'Synthetic Label',color:'#123456',description:null,isGroup:false,archivedAt:null,team:null}],pageInfo:{hasNextPage:false,endCursor:null}}]};
 const attestation={contract:'operator-reviewed-complete-export-v1',source_sha256:manifest.source_sha256,workspace_fingerprint:manifest.workspace_fingerprint,teams:manifest.teams,expected_count:1,capture_id:manifest.capture_id,export_package_sha256:'c'.repeat(64),review_evidence_sha256:'d'.repeat(64),operator_subject:'fictional-operator',archived_pages_verified:true,independent_count_reconciled:true,reviewed_at:'2026-09-06T11:00:00Z'};
 cluster.exec(`select production_label_catalog_stage_attested('${uuid(700)}','${JSON.stringify(manifest)}','${JSON.stringify(attestation)}');update syncview_runtime_flags set value='{"schema_version":1,"mode":"native","version_id":"${uuid(700)}"}' where key='production_native_label_catalog';`);
 cluster.exec(`insert into production_notification_config(key,value) values('urgent_video_destination','{"channel_id":"C0987654321"}');`);
 console.log('SCHEMA_READY actual composed intake, card owners, ordinary receipts, browser view, Workload, notifications');
};
