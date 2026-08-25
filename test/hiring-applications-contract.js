'use strict';

// Offline contract for the private hiring sidecar. This makes it difficult to
// accidentally turn it into a public applicant datastore, revive the sales
// routing, or allow a double-send after an ambiguous provider result.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'migrations/2026-08-24-hiring-applications.sql'), 'utf8');
const AUTHORIZE_SQL = fs.readFileSync(path.join(ROOT, 'migrations/2026-08-25-hiring-invite-send-authorization.sql'), 'utf8');
const REPAIR_SQL = fs.readFileSync(path.join(ROOT, 'migrations/2026-08-25-hiring-state-version-qualification.sql'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'supabase/functions/hiring-applications/index.ts'), 'utf8');
let failed = 0;

function ok(value, message) {
  if (value) console.log('  ok  ' + message);
  else { failed++; console.error('FAIL  ' + message); }
}

ok(/create table if not exists public\.hiring_applications/.test(SQL)
  && /create table if not exists public\.hiring_invite_jobs/.test(SQL)
  && /create table if not exists public\.hiring_application_events/.test(SQL),
  'the application, one-job outbox, and minimal audit tables are explicitly isolated');
ok(/unique \(source_event_slug, source_contact_id\)/.test(SQL)
  && /application_id uuid not null unique references public\.hiring_applications/.test(SQL),
  'repeat iClosed deliveries dedupe by source contact and an application can have only one invite job');
ok(/alter table public\.hiring_applications enable row level security/.test(SQL)
  && /revoke all on table public\.hiring_applications from public, anon, authenticated/.test(SQL)
  && /revoke all on table public\.hiring_invite_jobs from public, anon, authenticated/.test(SQL),
  'the applicant mirror and delivery outbox are RLS-protected with no browser role grants');
ok(/drop trigger if exists hiring_applications_touch_updated_at on public\.hiring_applications;\s*create trigger hiring_applications_touch_updated_at/s.test(SQL)
  && /drop trigger if exists hiring_invite_jobs_touch_updated_at on public\.hiring_invite_jobs;\s*create trigger hiring_invite_jobs_touch_updated_at/s.test(SQL),
  'reapplying the additive schema cannot fail merely because its touch triggers already exist');
ok(/hiring_invites_enabled'.*?\{"enabled": false\}/s.test(SQL)
  && /hiring_flag_preexisting/.test(SQL)
  && !/hiring_invites_enabled'[\s\S]{0,180}on conflict \(key\) do nothing/i.test(SQL)
  && /value = '\{"enabled": true\}'::jsonb/.test(SQL)
  && /if not coalesce\(v_enabled, false\) then[\s\S]{0,140}feature_disabled/.test(SQL),
  'outbound invitation delivery begins disabled and a pre-existing enabled or malformed flag aborts the migration');
ok(/client-success-content-manager-application/.test(SQL)
  && /client-success-content-manager-interview/.test(SQL)
  && /client-success-content-manager-interview\/\?\$/.test(SQL),
  'capture and booking handlers are pinned to the two dedicated iClosed event slugs');
ok(/for update skip locked/.test(SQL)
  && /claim_token = gen_random_uuid\(\)/.test(SQL)
  && /v_job\.claim_token is distinct from p_claim_token/.test(SQL)
  && /hiring_claim_next_invite_v1[\s\S]{0,1500}if not coalesce\(v_enabled, false\) then[\s\S]{0,90}return;/i.test(SQL),
  'the dispatcher claim is locked, cannot be completed by a stale worker, and rechecks the kill switch');
ok(/delivery_uncertain/.test(SQL)
  && /coalesce\(j\.claimed_at, j\.created_at\) < now\(\) - interval '30 minutes'/.test(SQL)
  && /invite_delivery_uncertain/.test(SQL)
  && /state in \('queued', 'dispatching', 'delivery_uncertain'\)/.test(SQL),
  'an ambiguous or stale delivery stops later reviewer state changes instead of inviting twice');
ok(/hiring_authorize_invite_send_v1/.test(SQL)
  && /send_authorized_at/.test(SQL)
  && /send_already_authorized/.test(SQL)
  && /hiring_invite_jobs_require_send_auth/.test(SQL)
  && /send_not_authorized/.test(SQL)
  && /return query select false/.test(SQL)
  && /hiring_authorize_invite_send_v1/.test(AUTHORIZE_SQL)
  && /add column if not exists send_authorized_at/.test(AUTHORIZE_SQL)
  && /for share/.test(AUTHORIZE_SQL),
  'a claim-scoped, one-shot pre-send authorization blocks duplicate Gmail calls, safely requeues when disabled, and gates sent state');
ok(/v_slug <> 'client-success-content-manager-application'/.test(SQL)
  && /source_event_slug, source_contact_id\) do nothing/.test(SQL)
  && /if p_source_updated_at is null then[\s\S]{0,120}invalid_source_timestamp/.test(SQL)
  && /p_source_updated_at is not null/.test(SQL)
  && /p_source_updated_at > v_existing\.source_updated_at/.test(SQL)
  && /state_version = state_version \+ 1/.test(SQL)
  && /where j\.application_id = v_existing\.id/.test(SQL),
  'capture rejects other events, accepts only fresh complete snapshots, and invalidates stale reviewer previews');
ok(/if p_source_updated_at is null then[\s\S]{0,120}invalid_source_timestamp/.test(SQL),
  'a first capture without a source timestamp fails closed instead of creating a notification-worthy application');
ok(/or \(case jsonb_typeof\(v_answers\)[\s\S]{0,220}end\)\s+or v_video_url = '' then/.test(SQL),
  'the empty-answer guard keeps its CASE expression parenthesized as valid PostgreSQL');
ok(/v_result = 'sent' and v_provider_message_id is null/.test(SQL)
  && /missing_provider_receipt/.test(SQL)
  && /pre_send_provider_unavailable/.test(SQL)
  && /pre_send_configuration/.test(SQL)
  && /provider_ambiguous/.test(SQL),
  'only a bounded result code and real provider receipt may mark an invitation sent');
ok(/hiring_retry_failed_invite_v1/.test(SQL)
  && /hiring_retry_failed_invite_v1[\s\S]{0,1300}if not coalesce\(v_enabled, false\) then[\s\S]{0,120}feature_disabled/i.test(SQL)
  && /v_job\.state <> 'failed'/.test(SQL)
  && /v_job\.provider_message_id is not null/.test(SQL)
  && /invite_requeued/.test(SQL)
  && /retry_not_available/.test(SQL),
  'only an explicit audited retry can requeue a proven pre-send failure');
ok(/hiring_set_application_status_v1[\s\S]{0,2200}state_version = a\.state_version \+ 1/.test(REPAIR_SQL)
  && /hiring_retry_failed_invite_v1[\s\S]{0,2800}state_version = a\.state_version \+ 1/.test(REPAIR_SQL)
  && /hiring_claim_next_invite_v1[\s\S]{0,2200}returning j\.id, j\.application_id[\s\S]{0,500}select s\.application_id/.test(REPAIR_SQL)
  && /hiring_record_interview_booking_v1[\s\S]{0,2200}case when a\.status = 'interview_booked' then a\.state_version else a\.state_version \+ 1 end/.test(REPAIR_SQL),
  'the applied repair qualifies every mutable output-name collision, including the dispatcher claim path');
ok(/p_source_contact_id text/.test(SQL)
  && /where source_contact_id = v_contact_id/.test(SQL)
  && !/where lower\(email\) = v_email/.test(SQL),
  'an interview booking binds to the stable iClosed contact rather than an ambiguous email match');
ok(!/Sales —|Sales Intake|booking_recovery|ACQUISITION/.test(SQL + API),
  'the hiring database/API contract has no dependency on existing sales routes');
ok(/We'd love to speak with you — Synchro Social/.test(API)
  && /client-success-content-manager-interview/.test(API),
  'the preview uses the dedicated interview link and role-appropriate invitation copy');

console.log(failed
  ? `\nhiring-applications-contract: ${failed} failed`
  : '\nHiring applications contract checks passed');
process.exit(failed ? 1 : 0);
