-- Kasper Ad Performance dashboard — unfinished (abandoned-booking) leads.
--
-- One new table, same locked-down posture as kasper_ad_leads
-- (migrations/2026-08-24-kasper-ad-performance-v2.sql): RLS enabled, zero
-- anon/authenticated policy or grant, service-role SELECT/INSERT/UPDATE only,
-- DELETE/TRUNCATE/REFERENCES/TRIGGER revoked even from service role.
--
-- Source is n8n's existing "booking_recovery" Data Table (fed by the
-- "Sales — Booking Recovery Capture (iClosed)" workflow), not a new capture
-- path: these are people who started the iClosed acquisition-calendar
-- booking flow (social-media-consultation / ai-intro-call) but never
-- completed a call. kasper_ad_unfinished_leads mirrors only the rows scoped
-- to this campaign (utm_campaign = 'prospecting') and still armed for
-- follow-up (status = 'pending' — booked/disqualified/other-calendar rows
-- are excluded upstream by that same workflow's own logic, not re-filtered
-- here).
--
-- Carries real PII (name/email/phone) — never exposed through browser
-- PostgREST, and the reading Edge Function must log aggregate counts only.

begin;

create table if not exists public.kasper_ad_unfinished_leads (
  lead_key text primary key
    check (btrim(lead_key) <> ''),
  iclosed_contact_id text,
  first_name text,
  last_name text,
  email text,
  phone text,
  iclosed_status text,
  utm_campaign text,
  utm_content text,
  captured_at timestamptz not null,
  follow_up_due_at timestamptz,
  email_sent_at timestamptz,
  sms_sent_at timestamptz,
  updated_by text not null
    check (btrim(updated_by) <> ''),
  updated_at timestamptz not null default now()
);

comment on table public.kasper_ad_unfinished_leads is
  'One row per abandoned iClosed booking (prospecting campaign, still pending follow-up) mirrored from n8n''s booking_recovery Data Table. Real PII (name/email/phone). Never exposed to anon/authenticated PostgREST; the reading Edge Function must log aggregate counts only, never a row''s name/email/phone.';
comment on column public.kasper_ad_unfinished_leads.lead_key is
  'Phone-first identity key from booking_recovery (phone, else email, else the iClosed contact id) — not the iClosed contact id alone, since one human can produce more than one iClosed contact record.';
comment on column public.kasper_ad_unfinished_leads.iclosed_status is
  'HubSpot/iClosed qualification status at capture time: potential or qualified. Rows the source workflow marked disqualified, booked, or other_calendar never reach status=pending and so are never mirrored here.';
comment on column public.kasper_ad_unfinished_leads.email_sent_at is
  'Set by the "Sales — Booking Recovery Dispatch" n8n workflow once the recovery email actually sends. Null means no email has gone out yet.';

create index if not exists kasper_ad_unfinished_leads_captured_at_idx
  on public.kasper_ad_unfinished_leads (captured_at);

alter table public.kasper_ad_unfinished_leads enable row level security;

revoke all on table public.kasper_ad_unfinished_leads from public, anon, authenticated;
grant select, insert, update on table public.kasper_ad_unfinished_leads to service_role;
revoke delete, truncate, references, trigger on table public.kasper_ad_unfinished_leads from service_role;

commit;
