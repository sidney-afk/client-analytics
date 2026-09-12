'use strict';
// Synthetic rows reused from the credential recovery rehearsal.
module.exports = function seed(cluster) {
 cluster.exec(`insert into public.batches_parent_claim_backup_20260824(id,linear_parent_ids) values('synthetic-priority','[]'),('synthetic-priority','[]');
 insert into public.content_samples(client,id,label) values('synthetic-priority','synthetic-priority','Synthetic');
 insert into public.filming_plans(client_slug,client_name) values('synthetic-priority','Synthetic');
 insert into public.thumbnail_media_revisions(surface,client,source_id,thumbnail_url) values('calendar','synthetic-priority','synthetic-priority','https://example.invalid/synthetic');
 insert into public.production_comment_import_conflicts(import_run_id,source_surface,classification) values('synthetic-priority','calendar','missing_card_id');
 insert into public.production_comment_read_audit(actor_key,auth_kind,decision,reason) values('synthetic-priority','staff','allow','synthetic');
 insert into public.production_comment_read_budget(actor_key,window_start,requests) values('synthetic-priority',now(),119);
 insert into public.linear_archive_asset_rescue_config(config_key,destination_provider,approved_folder_id,rescue_capability_sha256,active) values('active','google_drive_private','synthetic_folder_000000',repeat('0',64),false);
 insert into public.workload_issues(id) values('synthetic-priority');
 insert into public.client_credentials(id,client_slug,client_name,platform,label,password,status,source,raw_import) values
 ('00000000-0000-4000-8000-000000000001','synthetic-credential','Synthetic','synthetic','main','SYNTHETIC_NOT_A_CREDENTIAL','archived','onboarding',E'synthetic\\nraw'),
 ('00000000-0000-4000-8000-000000000002','synthetic-credential','Synthetic','synthetic','main','SYNTHETIC_REPLACEMENT','active','manual',null),
 ('00000000-0000-4000-8000-000000000003','synthetic-credential','Synthetic','synthetic','review',null,'needs_review','bulk_import','synthetic raw');
 insert into public.client_credential_events(credential_id,client_slug,action,old_value,new_value,payload) values
 ('00000000-0000-4000-8000-000000000001','synthetic-credential','reveal',null,null,'{"synthetic":true}'),
 ('00000000-0000-4000-8000-000000000002','synthetic-credential','update','SYNTHETIC_OLD','SYNTHETIC_NEW','{"synthetic":true}'),
 (null,'synthetic-credential','delete','SYNTHETIC_HISTORY',null,null);
 insert into public.client_credentials_rev(client_slug,client_name,rev) values('synthetic-credential','Synthetic',7);`);
};
