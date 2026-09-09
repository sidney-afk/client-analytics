'use strict';

/*
 * Read-only database contract gate for the Linear-exit production-write
 * release. The Management API endpoint is POST because it accepts SQL, but
 * QUERY is one catalog SELECT: it cannot change schema, flags or application
 * data. Output is an aggregate public-safe receipt; database rows and function
 * source never leave the process.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT = 'linear-exit-production-write-sql-v5';
const TRANSIENT = new Set([429, 502, 503, 504]);

const ROUTINES = Object.freeze([
  ['workload_native_snapshot_v1()', 'migrations/2026-09-09-workload-native-roster.sql', 'workload_native_snapshot_v1', 'pg_catalog, public'],
  ['production_native_intake_epochs()', 'migrations/2026-09-05-native-only-intake.sql', 'production_native_intake_epochs', 'public'],
  ['production_intake_epoch_read(text,text,text,text,text,text,jsonb,jsonb)', 'migrations/2026-09-05-native-only-intake.sql', 'production_intake_epoch_read', 'public'],
  ['production_intake_root_begin(jsonb,jsonb,jsonb)', 'migrations/2026-09-05-native-only-intake.sql', 'production_intake_root_begin', 'public'],
  ['production_intake_append(text,timestamptz,jsonb,jsonb)', 'migrations/2026-09-07-native-intake-named-append.sql', 'production_intake_append', 'public'],
  ['production_component_fill(jsonb,jsonb,jsonb)', 'migrations/2026-09-05-native-only-intake.sql', 'production_component_fill', 'public'],
  ['production_native_intake_receipt_guard()', 'migrations/2026-09-05-native-only-intake.sql', 'production_native_intake_receipt_guard', 'public'],
  ['production_native_intake_delete_guard()', 'migrations/2026-09-08-native-intake-receipt-retention.sql', 'production_native_intake_delete_guard', 'public'],
  ['production_native_intake_truncate_guard()', 'migrations/2026-09-08-native-intake-receipt-retention.sql', 'production_native_intake_truncate_guard', 'public'],
  ['production_assignment_epoch(text)', 'migrations/2026-09-06-native-existing-assignment.sql', 'production_assignment_epoch', 'public'],
  ['production_assignment_context(jsonb)', 'migrations/2026-09-06-native-existing-assignment.sql', 'production_assignment_context', 'public'],
  ['production_assignee_write(jsonb,jsonb)', 'migrations/2026-09-06-native-existing-assignment.sql', 'production_assignee_write', 'public'],
  ['production_native_assignment_receipt_guard()', 'migrations/2026-09-06-native-existing-assignment.sql', 'production_native_assignment_receipt_guard', 'public'],
  ['production_native_assignment_truncate_guard()', 'migrations/2026-09-06-native-existing-assignment.sql', 'production_native_assignment_truncate_guard', 'public'],
  ['production_label_catalog_read_version(uuid,text)', 'migrations/2026-09-05-native-label-catalog-foundation.sql', 'production_label_catalog_read_version', 'pg_catalog, public'],
  ['production_label_catalog_validate_selection(uuid,text,jsonb,jsonb)', 'migrations/2026-09-05-native-label-catalog-foundation.sql', 'production_label_catalog_validate_selection', 'pg_catalog, public'],
  ['production_label_catalog_capability()', 'migrations/2026-09-06-native-label-writes.sql', 'production_label_catalog_capability', 'pg_catalog, public'],
  ['production_label_catalog_read_attested(uuid,text)', 'migrations/2026-09-06-native-label-writes.sql', 'production_label_catalog_read_attested', 'pg_catalog, public'],
  ['production_labels_write(jsonb,jsonb)', 'migrations/2026-09-06-native-label-writes.sql', 'production_labels_write', 'pg_catalog, public'],
  ['production_native_label_receipt_guard()', 'migrations/2026-09-06-native-label-writes.sql', 'production_native_label_receipt_guard', 'pg_catalog, public'],
  ['production_native_label_truncate_guard()', 'migrations/2026-09-06-native-label-writes.sql', 'production_native_label_truncate_guard', 'pg_catalog, public'],
  ['production_native_identifier_capability(text)', 'migrations/2026-09-07-native-identifier-mint.sql', 'production_native_identifier_capability', 'pg_catalog, public'],
  ['production_native_identifier_seed(text,bigint)', 'migrations/2026-09-07-native-identifier-mint.sql', 'production_native_identifier_seed', 'pg_catalog, public'],
  ['production_native_identifier_allocate(text,text)', 'migrations/2026-09-07-native-identifier-mint.sql', 'production_native_identifier_allocate', 'pg_catalog, public'],
  ['production_native_identifier_guard()', 'migrations/2026-09-07-native-identifier-mint.sql', 'production_native_identifier_guard', 'pg_catalog, public'],
  ['production_native_client_provision(text,text,text)', 'migrations/2026-09-09-native-client-provisioning.sql', 'production_native_client_provision', 'pg_catalog, public, extensions, pg_temp'],
  ['production_native_client_provisions_immutable()', 'migrations/2026-09-09-native-client-provisioning.sql', 'production_native_client_provisions_immutable', 'pg_catalog, public, pg_temp', false],
  ['production_native_ordinary_capability(text)', 'migrations/2026-09-09-native-ordinary-receipts.sql', 'production_native_ordinary_capability', 'public'],
  ['production_native_ordinary_event(jsonb,jsonb)', 'migrations/2026-09-12-native-ordinary-envelope-repair.sql', 'production_native_ordinary_event', 'public'],
  ['production_native_ordinary_receipt_guard()', 'migrations/2026-09-09-native-ordinary-receipts.sql', 'production_native_ordinary_receipt_guard', 'public'],
  ['production_native_ordinary_receipt_truncate_guard()', 'migrations/2026-09-09-native-ordinary-receipts.sql', 'production_native_ordinary_receipt_truncate_guard', 'public'],
  ['production_deliverable_write(jsonb,jsonb)', 'migrations/2026-09-09-native-ordinary-receipts.sql', 'production_deliverable_write', 'public'],
  ['production_comment_write(jsonb,jsonb)', 'migrations/2026-09-09-native-ordinary-receipts.sql', 'production_comment_write', 'public'],
  ['production_comment_lifecycle_write(jsonb,jsonb,integer,timestamp with time zone)', 'migrations/2026-09-12-native-ordinary-envelope-repair.sql', 'production_comment_lifecycle_write', 'public'],
  ['production_notification_intent_guard()', 'migrations/2026-09-09-native-notification-outbox.sql', 'production_notification_intent_guard', 'public, pg_temp'],
  ['production_notification_plain_text(text,integer)', 'migrations/2026-09-09-native-notification-outbox.sql', 'production_notification_plain_text', 'public, pg_temp', false],
  ['production_notification_actor_valid(uuid,text,text)', 'migrations/2026-09-09-native-notification-outbox.sql', 'production_notification_actor_valid', 'public, pg_temp'],
  ['production_notification_status_intent_after()', 'migrations/2026-09-09-native-notification-outbox.sql', 'production_notification_status_intent_after', 'public, pg_temp'],
  ['production_notification_comment_intent_after()', 'migrations/2026-09-09-native-notification-outbox.sql', 'production_notification_comment_intent_after', 'public, pg_temp'],
  ['production_notification_client_comment_event_after()', 'migrations/2026-09-09-native-notification-outbox.sql', 'production_notification_client_comment_event_after', 'public, pg_temp'],
  ['production_notification_health_summary()', 'migrations/2026-09-09-native-notification-outbox.sql', 'production_notification_health_summary', 'public, pg_temp'],
  ['production_notification_urgent_status(text,text,timestamp with time zone)', 'migrations/2026-09-09-native-notification-outbox.sql', 'production_notification_urgent_status', 'public, pg_temp'],
  ['production_notification_reconcile(uuid,text,text,text)', 'migrations/2026-09-09-native-notification-outbox.sql', 'production_notification_reconcile', 'public, pg_temp'],
  ['production_notification_enqueue_urgent(uuid,text,text,text,text,timestamp with time zone,uuid,uuid)', 'migrations/2026-09-09-native-notification-outbox.sql', 'production_notification_enqueue_urgent', 'public, pg_temp'],
  ['production_notification_claim(integer)', 'migrations/2026-09-09-native-notification-outbox.sql', 'production_notification_claim', 'public, pg_temp'],
  ['production_notification_record_delivery(uuid,integer,text,text,text)', 'migrations/2026-09-09-native-notification-outbox.sql', 'production_notification_record_delivery', 'public, pg_temp'],
]);

const PRIVATE_ROUTINES = new Set([
  'production_native_intake_receipt_guard',
  'production_native_intake_delete_guard',
  'production_native_intake_truncate_guard',
  'production_assignment_epoch',
  'production_native_assignment_receipt_guard',
  'production_native_assignment_truncate_guard',
  'production_native_label_receipt_guard',
  'production_native_label_truncate_guard',
  'production_native_identifier_allocate',
  'production_native_identifier_guard',
  'production_native_client_provisions_immutable',
  'production_native_ordinary_capability',
  'production_native_ordinary_event',
  'production_native_ordinary_receipt_guard',
  'production_native_ordinary_receipt_truncate_guard',
  'production_notification_intent_guard',
  'production_notification_plain_text',
  'production_notification_actor_valid',
  'production_notification_status_intent_after',
  'production_notification_comment_intent_after',
  'production_notification_client_comment_event_after',
]);

const TRIGGERS = Object.freeze([
  ['mirror_outbox.zz_native_intake_receipt_guard', 'mirror_outbox', 'zz_native_intake_receipt_guard', 'production_native_intake_receipt_guard', 23],
  ['mirror_outbox.zz_native_intake_delete_guard', 'mirror_outbox', 'zz_native_intake_delete_guard', 'production_native_intake_delete_guard', 11],
  ['mirror_outbox.zz_native_intake_truncate_guard', 'mirror_outbox', 'zz_native_intake_truncate_guard', 'production_native_intake_truncate_guard', 34],
  ['mirror_outbox.zzz_native_assignment_receipt_guard', 'mirror_outbox', 'zzz_native_assignment_receipt_guard', 'production_native_assignment_receipt_guard', 31],
  ['mirror_outbox.zzz_native_assignment_truncate_guard', 'mirror_outbox', 'zzz_native_assignment_truncate_guard', 'production_native_assignment_truncate_guard', 34],
  ['mirror_outbox.zzz_native_label_receipt_guard', 'mirror_outbox', 'zzz_native_label_receipt_guard', 'production_native_label_receipt_guard', 31],
  ['mirror_outbox.zzz_native_label_truncate_guard', 'mirror_outbox', 'zzz_native_label_truncate_guard', 'production_native_label_truncate_guard', 34],
  ['deliverables.zzz_production_native_identifier_mint', 'deliverables', 'zzz_production_native_identifier_mint', 'production_native_identifier_guard', 23],
  ['production_native_client_provisions.production_native_client_provisions_immutable_row', 'production_native_client_provisions', 'production_native_client_provisions_immutable_row', 'production_native_client_provisions_immutable', 27],
  ['production_native_client_provisions.production_native_client_provisions_immutable_truncate', 'production_native_client_provisions', 'production_native_client_provisions_immutable_truncate', 'production_native_client_provisions_immutable', 34],
  ['mirror_outbox.zzz_native_ordinary_receipt_guard', 'mirror_outbox', 'zzz_native_ordinary_receipt_guard', 'production_native_ordinary_receipt_guard', 31],
  ['mirror_outbox.zzz_native_ordinary_receipt_truncate_guard', 'mirror_outbox', 'zzz_native_ordinary_receipt_truncate_guard', 'production_native_ordinary_receipt_truncate_guard', 34],
  ['production_notification_intents.production_notification_intent_guard_before', 'production_notification_intents', 'production_notification_intent_guard_before', 'production_notification_intent_guard', 23],
  ['deliverable_events.production_notification_status_intent_after', 'deliverable_events', 'production_notification_status_intent_after', 'production_notification_status_intent_after', 5],
  ['production_comments.production_notification_comment_intent_after', 'production_comments', 'production_notification_comment_intent_after', 'production_notification_comment_intent_after', 5],
  ['deliverable_events.production_notification_client_comment_event_after', 'deliverable_events', 'production_notification_client_comment_event_after', 'production_notification_client_comment_event_after', 5],
]);

const COLUMNS = Object.freeze([
  ['production_intake_manifests.native_epochs', 'production_intake_manifests', 'native_epochs', 'jsonb', true],
  ['production_label_catalog_versions.operator_attestation', 'production_label_catalog_versions', 'operator_attestation', 'jsonb', false],
  ['production_native_identifier_mint.next_ordinal', 'production_native_identifier_mint', 'next_ordinal', 'bigint', true],
  ['production_native_identifier_grants.identifier', 'production_native_identifier_grants', 'identifier', 'text', true],
  ['clients.native_project_ids', 'clients', 'native_project_ids', 'jsonb', true],
  ['production_native_client_provisions.request_id', 'production_native_client_provisions', 'request_id', 'text', true],
  ['production_native_client_provisions.client_slug', 'production_native_client_provisions', 'client_slug', 'text', true],
  ['production_native_client_provisions.intent_sha256', 'production_native_client_provisions', 'intent_sha256', 'text', true],
  ['production_native_client_provisions.native_project_ids', 'production_native_client_provisions', 'native_project_ids', 'jsonb', true],
  ['production_native_client_provisions.created_at', 'production_native_client_provisions', 'created_at', 'timestamp with time zone', true],
  ['production_deliverables_browser_v1.raw_attribution_project_id', 'production_deliverables_browser_v1', 'raw_attribution_project_id', 'text', false],
  ['production_deliverables_browser_v1.raw_attribution_native_epoch', 'production_deliverables_browser_v1', 'raw_attribution_native_epoch', 'text', false],
  ['production_native_ordinary_receipt_admissions.token', 'production_native_ordinary_receipt_admissions', 'token', 'uuid', true],
  ['production_native_ordinary_receipt_admissions.epoch', 'production_native_ordinary_receipt_admissions', 'epoch', 'text', true],
  ['production_native_ordinary_receipt_admissions.owner', 'production_native_ordinary_receipt_admissions', 'owner', 'text', true],
  ['production_native_ordinary_receipt_admissions.entity', 'production_native_ordinary_receipt_admissions', 'entity', 'text', true],
  ['production_native_ordinary_receipt_admissions.entity_id', 'production_native_ordinary_receipt_admissions', 'entity_id', 'text', true],
  ['production_native_ordinary_receipt_admissions.receipt_operation', 'production_native_ordinary_receipt_admissions', 'receipt_operation', 'text', true],
  ['production_native_ordinary_receipt_admissions.native_operation', 'production_native_ordinary_receipt_admissions', 'native_operation', 'text', true],
  ['production_native_ordinary_receipt_admissions.client_slug', 'production_native_ordinary_receipt_admissions', 'client_slug', 'text', true],
  ['production_native_ordinary_receipt_admissions.team', 'production_native_ordinary_receipt_admissions', 'team', 'text', true],
  ['production_native_ordinary_receipt_admissions.actor', 'production_native_ordinary_receipt_admissions', 'actor', 'text', true],
  ['production_native_ordinary_receipt_admissions.role', 'production_native_ordinary_receipt_admissions', 'role', 'text', true],
  ['production_native_ordinary_receipt_admissions.test_only', 'production_native_ordinary_receipt_admissions', 'test_only', 'boolean', true],
  ['production_native_ordinary_receipt_admissions.legacy_parity', 'production_native_ordinary_receipt_admissions', 'legacy_parity', 'boolean', true],
  ['production_native_ordinary_receipt_admissions.dedup_key', 'production_native_ordinary_receipt_admissions', 'dedup_key', 'text', true],
  ['production_native_ordinary_receipt_admissions.intent_fingerprint', 'production_native_ordinary_receipt_admissions', 'intent_fingerprint', 'text', true],
  ['production_native_ordinary_receipt_admissions.source_edited_at', 'production_native_ordinary_receipt_admissions', 'source_edited_at', 'timestamp with time zone', true],
  ['production_native_ordinary_receipt_admissions.receipt_id', 'production_native_ordinary_receipt_admissions', 'receipt_id', 'bigint', false],
  ['production_native_ordinary_receipt_admissions.issued_at', 'production_native_ordinary_receipt_admissions', 'issued_at', 'timestamp with time zone', true],
  ['production_notification_config.key', 'production_notification_config', 'key', 'text', true],
  ['production_notification_config.value', 'production_notification_config', 'value', 'jsonb', true],
  ['production_notification_config.updated_at', 'production_notification_config', 'updated_at', 'timestamp with time zone', true],
  ['production_notification_intents.id', 'production_notification_intents', 'id', 'uuid', true],
  ['production_notification_intents.intent_key', 'production_notification_intents', 'intent_key', 'text', true],
  ['production_notification_intents.kind', 'production_notification_intents', 'kind', 'text', true],
  ['production_notification_intents.state', 'production_notification_intents', 'state', 'text', true],
  ['production_notification_intents.client_slug', 'production_notification_intents', 'client_slug', 'text', true],
  ['production_notification_intents.deliverable_id', 'production_notification_intents', 'deliverable_id', 'text', true],
  ['production_notification_intents.source_event_id', 'production_notification_intents', 'source_event_id', 'bigint', false],
  ['production_notification_intents.source_comment_id', 'production_notification_intents', 'source_comment_id', 'text', false],
  ['production_notification_intents.actor_member_id', 'production_notification_intents', 'actor_member_id', 'uuid', false],
  ['production_notification_intents.intended_member_id', 'production_notification_intents', 'intended_member_id', 'uuid', false],
  ['production_notification_intents.destination_kind', 'production_notification_intents', 'destination_kind', 'text', true],
  ['production_notification_intents.destination_channel_id', 'production_notification_intents', 'destination_channel_id', 'text', false],
  ['production_notification_intents.message', 'production_notification_intents', 'message', 'jsonb', true],
  ['production_notification_intents.attempt_count', 'production_notification_intents', 'attempt_count', 'integer', true],
  ['production_notification_intents.next_attempt_at', 'production_notification_intents', 'next_attempt_at', 'timestamp with time zone', true],
  ['production_notification_intents.lease_token', 'production_notification_intents', 'lease_token', 'uuid', false],
  ['production_notification_intents.lease_expires_at', 'production_notification_intents', 'lease_expires_at', 'timestamp with time zone', false],
  ['production_notification_intents.last_failure_code', 'production_notification_intents', 'last_failure_code', 'text', false],
  ['production_notification_intents.provider_message_id', 'production_notification_intents', 'provider_message_id', 'text', false],
  ['production_notification_intents.created_at', 'production_notification_intents', 'created_at', 'timestamp with time zone', true],
  ['production_notification_intents.updated_at', 'production_notification_intents', 'updated_at', 'timestamp with time zone', true],
  ['production_notification_intents.sent_at', 'production_notification_intents', 'sent_at', 'timestamp with time zone', false],
  ['production_notification_delivery_receipts.id', 'production_notification_delivery_receipts', 'id', 'bigint', true],
  ['production_notification_delivery_receipts.intent_id', 'production_notification_delivery_receipts', 'intent_id', 'uuid', true],
  ['production_notification_delivery_receipts.attempt', 'production_notification_delivery_receipts', 'attempt', 'integer', true],
  ['production_notification_delivery_receipts.outcome', 'production_notification_delivery_receipts', 'outcome', 'text', true],
  ['production_notification_delivery_receipts.intended_member_id', 'production_notification_delivery_receipts', 'intended_member_id', 'uuid', false],
  ['production_notification_delivery_receipts.destination_channel_id', 'production_notification_delivery_receipts', 'destination_channel_id', 'text', true],
  ['production_notification_delivery_receipts.provider_message_id', 'production_notification_delivery_receipts', 'provider_message_id', 'text', false],
  ['production_notification_delivery_receipts.failure_code', 'production_notification_delivery_receipts', 'failure_code', 'text', false],
  ['production_notification_delivery_receipts.created_at', 'production_notification_delivery_receipts', 'created_at', 'timestamp with time zone', true],
  ['production_notification_reconciliations.id', 'production_notification_reconciliations', 'id', 'bigint', true],
  ['production_notification_reconciliations.intent_id', 'production_notification_reconciliations', 'intent_id', 'uuid', true],
  ['production_notification_reconciliations.action', 'production_notification_reconciliations', 'action', 'text', true],
  ['production_notification_reconciliations.provider_message_id', 'production_notification_reconciliations', 'provider_message_id', 'text', false],
  ['production_notification_reconciliations.created_at', 'production_notification_reconciliations', 'created_at', 'timestamp with time zone', true],
]);

const SCHEMA_KEYS = Object.freeze([
  'constraint:clients.clients_native_project_ids_object',
  'index:clients.clients_native_project_ids_video_unique',
  'index:clients.clients_native_project_ids_graphics_unique',
  'relation:production_native_client_provisions',
  'relation:production_deliverables_browser_v1',
  'relation:production_native_ordinary_receipt_admissions',
  'constraint:production_native_ordinary_receipt_admissions.receipt_id_fkey',
  'relation:production_notification_config',
  'relation:production_notification_intents',
  'relation:production_notification_delivery_receipts',
  'relation:production_notification_reconciliations',
  'relation:production_notification_monitor_v1',
  'sequence:production_notification_delivery_receipts_id_seq',
  'sequence:production_notification_reconciliations_id_seq',
]);

function bodyFor(file, name) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${escaped}\\s*\\([\\s\\S]*?\\)`
      + `[\\s\\S]*?\\bas\\s+(\\$[A-Za-z0-9_]*\\$)([\\s\\S]*?)\\1\\s*;`, 'i'));
  if (!match) throw new Error(`repository contract body missing: ${file}:${name}`);
  return match[2];
}

function sqlString(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function expectedObjects() {
  const routines = ROUTINES.map(([signature, file, name, searchPath, securityDefiner = true]) => ({
    key: `routine:${signature}`,
    signature: `public.${signature}`,
    bodyMd5: crypto.createHash('md5').update(bodyFor(file, name), 'utf8').digest('hex'),
    searchPath,
    securityDefiner,
    serviceExecute: !PRIVATE_ROUTINES.has(name),
  }));
  return {
    routines,
    keys: [
      ...routines.map(row => row.key),
      ...TRIGGERS.map(row => `trigger:${row[0]}`),
      ...COLUMNS.map(row => `column:${row[0]}`),
      ...SCHEMA_KEYS,
      'config:native_intake_epochs',
      'config:native_assignment_epochs',
      'config:production_native_label_catalog',
      'config:production_native_identifier_mint',
      'config:production_native_ordinary_receipts',
      'config:urgent_video_destination',
    ],
  };
}

function contractQuery() {
  const expected = expectedObjects();
  const routines = expected.routines.map(row =>
    `(${sqlString(row.key)},${sqlString(row.signature)},${sqlString(row.bodyMd5)},${sqlString(row.searchPath)},${row.securityDefiner},${row.serviceExecute})`).join(',\n');
  const triggers = TRIGGERS.map(([key, table, trigger, fn, tgtype]) =>
    `(${sqlString(`trigger:${key}`)},${sqlString(table)},${sqlString(trigger)},${sqlString(fn)},${tgtype})`).join(',\n');
  const columns = COLUMNS.map(([key, table, column, type, notNull]) =>
    `(${sqlString(`column:${key}`)},${sqlString(table)},${sqlString(column)},${sqlString(type)},${notNull})`).join(',\n');
  return `with expected_routine(object_key,signature,body_md5,search_path,security_definer,service_execute) as (values\n${routines}\n),
routine_rows as (
  select e.object_key,(p.oid is not null) as present,
    coalesce(md5(p.prosrc)=e.body_md5
      and p.prosecdef=e.security_definer
      and p.proconfig=array['search_path='||e.search_path]::text[]
      and has_function_privilege('service_role',p.oid,'EXECUTE')=e.service_execute
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE'),false) as compatible
  from expected_routine e left join pg_proc p on p.oid=to_regprocedure(e.signature)
), expected_trigger(object_key,table_name,trigger_name,function_name,tgtype) as (values
${triggers}
), trigger_rows as (
  select e.object_key,(t.oid is not null) as present,
    coalesce(t.tgenabled='O' and t.tgtype=e.tgtype and t.tgqual is null
      and pn.nspname='public' and p.proname=e.function_name,false) as compatible
  from expected_trigger e left join pg_class c on c.relnamespace='public'::regnamespace and c.relname=e.table_name
  left join pg_trigger t on t.tgrelid=c.oid and t.tgname=e.trigger_name and not t.tgisinternal
  left join pg_proc p on p.oid=t.tgfoid left join pg_namespace pn on pn.oid=p.pronamespace
), expected_column(object_key,table_name,column_name,data_type,not_null) as (values
${columns}
), column_rows as (
  select e.object_key,(a.attnum is not null) as present,
    coalesce(format_type(a.atttypid,a.atttypmod)=e.data_type and a.attnotnull=e.not_null,false) as compatible
  from expected_column e left join pg_class c on c.relnamespace='public'::regnamespace and c.relname=e.table_name
  left join pg_attribute a on a.attrelid=c.oid and a.attname=e.column_name and a.attnum>0 and not a.attisdropped
), schema_rows as (
  select 'constraint:clients.clients_native_project_ids_object'::text object_key,(x.oid is not null) present,
    coalesce(x.contype='c' and x.convalidated
      and pg_get_constraintdef(x.oid) like '%native_project_ids = ''{}''::jsonb%'
      and pg_get_constraintdef(x.oid) like '%native_project_ids ? ''video''::text%'
      and pg_get_constraintdef(x.oid) like '%native_project_ids ? ''graphics''::text%'
      and pg_get_constraintdef(x.oid) like '%^svproj_video_[0-9a-f]{32}$%'
      and pg_get_constraintdef(x.oid) like '%^svproj_graphics_[0-9a-f]{32}$%',false) compatible
    from (values(true)) seed(v) left join pg_constraint x
      on x.conrelid='public.clients'::regclass and x.conname='clients_native_project_ids_object'
  union all
  select 'index:clients.clients_native_project_ids_video_unique',(i.indexrelid is not null),
    coalesce(i.indisunique and i.indisvalid and i.indisready
      and pg_get_expr(i.indexprs,i.indrelid)='(native_project_ids ->> ''video''::text)'
      and pg_get_expr(i.indpred,i.indrelid)='(native_project_ids ? ''video''::text)',false)
    from (values(true)) seed(v) left join pg_index i on i.indexrelid=to_regclass('public.clients_native_project_ids_video_unique')
  union all
  select 'index:clients.clients_native_project_ids_graphics_unique',(i.indexrelid is not null),
    coalesce(i.indisunique and i.indisvalid and i.indisready
      and pg_get_expr(i.indexprs,i.indrelid)='(native_project_ids ->> ''graphics''::text)'
      and pg_get_expr(i.indpred,i.indrelid)='(native_project_ids ? ''graphics''::text)',false)
    from (values(true)) seed(v) left join pg_index i on i.indexrelid=to_regclass('public.clients_native_project_ids_graphics_unique')
  union all
  select 'relation:production_native_client_provisions',(c.oid is not null),
    coalesce(c.relkind='r' and c.relrowsecurity
      and not exists (select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
        left join pg_roles role on role.oid=acl.grantee
        where acl.grantee=0 or role.rolname in ('anon','authenticated','service_role')),false)
    from (values(true)) seed(v) left join pg_class c
      on c.relnamespace='public'::regnamespace and c.relname='production_native_client_provisions'
  union all
  select 'relation:production_deliverables_browser_v1',(c.oid is not null),
    coalesce(c.relkind='v' and 'security_barrier=true'=any(coalesce(c.reloptions,array[]::text[]))
      and has_table_privilege('anon',c.oid,'SELECT')
      and has_table_privilege('authenticated',c.oid,'SELECT')
      and strpos(pg_get_viewdef(c.oid,true),'native_intake_legacy_project')>0,false)
    from (values(true)) seed(v) left join pg_class c
      on c.relnamespace='public'::regnamespace and c.relname='production_deliverables_browser_v1'
  union all
  select 'relation:production_native_ordinary_receipt_admissions',(c.oid is not null),
    coalesce(c.relkind='r' and c.relrowsecurity
      and not exists (select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
        left join pg_roles role on role.oid=acl.grantee
        where acl.grantee=0 or role.rolname in ('anon','authenticated','service_role')),false)
    from (values(true)) seed(v) left join pg_class c
      on c.relnamespace='public'::regnamespace and c.relname='production_native_ordinary_receipt_admissions'
  union all
  select 'constraint:production_native_ordinary_receipt_admissions.receipt_id_fkey',(x.oid is not null),
    coalesce(x.contype='f' and x.convalidated and x.condeferrable and x.condeferred
      and x.confrelid='public.mirror_outbox'::regclass
      and pg_get_constraintdef(x.oid) like 'FOREIGN KEY (receipt_id) REFERENCES mirror_outbox(id) DEFERRABLE INITIALLY DEFERRED%',false)
    from (values(true)) seed(v) left join pg_constraint x
      on x.conrelid=to_regclass('public.production_native_ordinary_receipt_admissions')
      and x.conname='production_native_ordinary_receipt_admissions_receipt_id_fkey'
  union all
  select 'relation:production_notification_config',(c.oid is not null),
    coalesce(c.relkind='r' and c.relrowsecurity
      and has_table_privilege('service_role',c.oid,'S'||'ELECT,I'||'NSERT,U'||'PDATE,D'||'ELETE')
      and not has_table_privilege('service_role',c.oid,'T'||'RUNCATE,R'||'EFERENCES,T'||'RIGGER')
      and not has_table_privilege('anon',c.oid,'S'||'ELECT,I'||'NSERT,U'||'PDATE,D'||'ELETE')
      and not has_table_privilege('authenticated',c.oid,'S'||'ELECT,I'||'NSERT,U'||'PDATE,D'||'ELETE'),false)
    from (values(true)) seed(v) left join pg_class c
      on c.relnamespace='public'::regnamespace and c.relname='production_notification_config'
  union all
  select 'relation:production_notification_intents',(c.oid is not null),
    coalesce(c.relkind='r' and c.relrowsecurity
      and not exists (select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
        left join pg_roles role on role.oid=acl.grantee
        where acl.grantee=0 or role.rolname in ('anon','authenticated'))
      and has_table_privilege('service_role',c.oid,'S'||'ELECT')
      and not has_table_privilege('service_role',c.oid,'I'||'NSERT,U'||'PDATE,D'||'ELETE,T'||'RUNCATE,R'||'EFERENCES,T'||'RIGGER'),false)
    from (values(true)) seed(v) left join pg_class c
      on c.relnamespace='public'::regnamespace and c.relname='production_notification_intents'
  union all
  select 'relation:production_notification_delivery_receipts',(c.oid is not null),
    coalesce(c.relkind='r' and c.relrowsecurity
      and not exists (select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
        left join pg_roles role on role.oid=acl.grantee
        where acl.grantee=0 or role.rolname in ('anon','authenticated'))
      and has_table_privilege('service_role',c.oid,'S'||'ELECT')
      and not has_table_privilege('service_role',c.oid,'I'||'NSERT,U'||'PDATE,D'||'ELETE,T'||'RUNCATE,R'||'EFERENCES,T'||'RIGGER'),false)
    from (values(true)) seed(v) left join pg_class c
      on c.relnamespace='public'::regnamespace and c.relname='production_notification_delivery_receipts'
  union all
  select 'relation:production_notification_reconciliations',(c.oid is not null),
    coalesce(c.relkind='r' and c.relrowsecurity
      and not exists (select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
        left join pg_roles role on role.oid=acl.grantee
        where acl.grantee=0 or role.rolname in ('anon','authenticated'))
      and has_table_privilege('service_role',c.oid,'S'||'ELECT')
      and not has_table_privilege('service_role',c.oid,'I'||'NSERT,U'||'PDATE,D'||'ELETE,T'||'RUNCATE,R'||'EFERENCES,T'||'RIGGER'),false)
    from (values(true)) seed(v) left join pg_class c
      on c.relnamespace='public'::regnamespace and c.relname='production_notification_reconciliations'
  union all
  select 'relation:production_notification_monitor_v1',(c.oid is not null),
    coalesce(c.relkind='v' and 'security_invoker=true'=any(coalesce(c.reloptions,array[]::text[]))
      and has_table_privilege('service_role',c.oid,'SELECT')
      and not has_table_privilege('anon',c.oid,'SELECT')
      and not has_table_privilege('authenticated',c.oid,'SELECT'),false)
    from (values(true)) seed(v) left join pg_class c
      on c.relnamespace='public'::regnamespace and c.relname='production_notification_monitor_v1'
  union all
  select 'sequence:production_notification_delivery_receipts_id_seq',(c.oid is not null),
    coalesce(c.relkind='S'
      and has_sequence_privilege('service_role',c.oid,'USAGE')
      and has_sequence_privilege('service_role',c.oid,'SELECT')
      and not has_sequence_privilege('service_role',c.oid,'U'||'PDATE')
      and not has_sequence_privilege('anon',c.oid,'USAGE,S'||'ELECT,U'||'PDATE')
      and not has_sequence_privilege('authenticated',c.oid,'USAGE,S'||'ELECT,U'||'PDATE'),false)
    from (values(true)) seed(v) left join pg_class c
      on c.relnamespace='public'::regnamespace and c.relname='production_notification_delivery_receipts_id_seq'
  union all
  select 'sequence:production_notification_reconciliations_id_seq',(c.oid is not null),
    coalesce(c.relkind='S'
      and has_sequence_privilege('service_role',c.oid,'USAGE')
      and has_sequence_privilege('service_role',c.oid,'SELECT')
      and not has_sequence_privilege('service_role',c.oid,'U'||'PDATE')
      and not has_sequence_privilege('anon',c.oid,'USAGE,S'||'ELECT,U'||'PDATE')
      and not has_sequence_privilege('authenticated',c.oid,'USAGE,S'||'ELECT,U'||'PDATE'),false)
    from (values(true)) seed(v) left join pg_class c
      on c.relnamespace='public'::regnamespace and c.relname='production_notification_reconciliations_id_seq'
), config_rows as (
  select 'config:native_intake_epochs'::text object_key,(f.key is not null) present,
    coalesce(jsonb_typeof(f.value)='object'
      and (select bool_and(coalesce(jsonb_typeof(f.value->team)='object'
        and jsonb_typeof(f.value->team->'enabled')='boolean'
        and (f.value->team->'enabled'='false'::jsonb or coalesce(f.value->team->>'epoch','')~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),false))
        from unnest(array['video','graphics']) team),false) compatible
    from (values('native_intake_epochs')) e(key) left join public.syncview_runtime_flags f using(key)
  union all
  select 'config:native_assignment_epochs',(f.key is not null),coalesce(jsonb_typeof(f.value)='object'
    and (select bool_and(coalesce(jsonb_typeof(f.value->team)='object' and coalesce(f.value->team->>'mode','') in ('provider','native','hold')
      and case when f.value->team->>'mode'='native' then coalesce(f.value->team->>'epoch','')~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
        else f.value->team->'epoch'='null'::jsonb end,false)) from unnest(array['video','graphics']) team),false)
    from (values('native_assignment_epochs')) e(key) left join public.syncview_runtime_flags f using(key)
  union all
  select 'config:production_native_label_catalog',(f.key is not null),coalesce(jsonb_typeof(f.value)='object'
    and f.value->'schema_version'='1'::jsonb and coalesce(f.value->>'mode','') in ('provider','native','hold')
    and case when f.value->>'mode'='native' then coalesce(f.value->>'version_id','')~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      else f.value->'version_id'='null'::jsonb end,false)
    from (values('production_native_label_catalog')) e(key) left join public.syncview_runtime_flags f using(key)
  union all
  select 'config:production_native_identifier_mint',(f.key is not null),coalesce(jsonb_typeof(f.value)='object'
    and f.value->'schema_version'='1'::jsonb
    and (select bool_and(coalesce(jsonb_typeof(f.value->team)='object'
      and coalesce(f.value->team->>'mode','') in ('provider','native'),false))
      from unnest(array['video','graphics']) team),false)
    from (values('production_native_identifier_mint')) e(key) left join public.syncview_runtime_flags f using(key)
  union all
  select 'config:production_native_ordinary_receipts',(f.key is not null),coalesce(jsonb_typeof(f.value)='object'
    and f.value->'schema_version'='1'::jsonb
    and (select bool_and(coalesce(jsonb_typeof(f.value->team)='object'
      and coalesce(f.value->team->>'mode','') in ('provider','native','hold')
      and case when f.value->team->>'mode'='native' then coalesce(f.value->team->>'epoch','')~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
        else f.value->team->'epoch'='null'::jsonb end,false))
      from unnest(array['video','graphics']) team),false)
    from (values('production_native_ordinary_receipts')) e(key) left join public.syncview_runtime_flags f using(key)
  union all
  select 'config:urgent_video_destination',(c.key is not null),coalesce(jsonb_typeof(c.value)='object'
    and (select count(*)=1 from jsonb_object_keys(c.value))
    and coalesce(c.value->>'channel_id','')~'^[CG][A-Z0-9]{8,}$',false)
    from (values('urgent_video_destination')) e(key) left join public.production_notification_config c using(key)
)
select object_key,present,compatible from routine_rows
union all select object_key,present,compatible from trigger_rows
union all select object_key,present,compatible from column_rows
union all select object_key,present,compatible from schema_rows
union all select object_key,present,compatible from config_rows
order by object_key`;
}

class PreflightError extends Error {
  constructor(code, objectKeys = []) { super(code); this.code = code; this.objectKeys = objectKeys; }
}

function validateRows(rows) {
  if (!Array.isArray(rows)) throw new PreflightError('READ_RESPONSE_INVALID');
  const expected = expectedObjects().keys.slice().sort();
  const actual = rows.map(row => String(row && row.object_key || '')).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new PreflightError('READ_RESPONSE_INVALID');
  }
  const absent = rows.filter(row => row.present !== true);
  if (absent.length) throw new PreflightError('CONTRACT_ABSENT', absent.map(row => row.object_key));
  const mismatched = rows.filter(row => row.compatible !== true);
  if (mismatched.length) throw new PreflightError('CONTRACT_MISMATCH', mismatched.map(row => row.object_key));
  return { status: 'PASS', contract: CONTRACT, checked_objects: expected.length, read_only: true };
}

async function readContract({ token, projectRef, fetchImpl = globalThis.fetch }) {
  if (!token || !/^[a-z0-9]{20}$/.test(projectRef || '')) throw new PreflightError('CONFIG_MISSING');
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  let response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetchImpl(url, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: contractQuery() }),
      });
    } catch (_) {
      if (attempt === 3) throw new PreflightError('READ_FAILED');
      continue;
    }
    if (response.ok) break;
    if (!TRANSIENT.has(response.status) || attempt === 3) throw new PreflightError(`READ_FAILED_HTTP_${response.status}`);
  }
  let rows;
  try { rows = await response.json(); } catch (_) { throw new PreflightError('READ_RESPONSE_INVALID'); }
  return validateRows(rows);
}

async function main() {
  try {
    const result = await readContract({
      token: String(process.env.SUPABASE_ACCESS_TOKEN || '').trim(),
      projectRef: String(process.env.PROJECT_REF || process.env.F27_PROJECT_REF || '').trim(),
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    const code = error instanceof PreflightError ? error.code : 'LOCAL_CONTRACT_INVALID';
    const objects = error instanceof PreflightError && error.objectKeys.length
      ? `:${error.objectKeys.join(',')}` : '';
    console.error(`linear-exit-deploy-preflight: ${code}${objects}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { CONTRACT, COLUMNS, ROUTINES, SCHEMA_KEYS, TRIGGERS, PreflightError, contractQuery, expectedObjects, readContract, validateRows };
