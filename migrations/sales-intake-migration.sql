-- ============================================================
-- Sales Intake tab → Supabase migration SQL
-- Run in the Supabase SQL editor for project uzltbbrjidmjwwfakwve.
-- Idempotent. (There is no auto-runner — apply this manually.)
--
-- One row per Sales Intake submission (Kasper closes a client, fills the
-- SyncView Sales Intake form, n8n `sales-intake-submit` writes here before
-- creating the eSignatures agreement + sending the combined email).
-- This is the audit log / status record for the paperwork chain.
--
-- SECURITY (same posture as client_onboarding, stricter than samples/calendar):
-- This table holds BILLING data (invoice amounts, payment links, contract
-- terms). It therefore has *** NO anon policies AT ALL ***. The public
-- browser anon key (committed in index.html) can neither read nor write it.
--   - Writes: only the service-role n8n webhook `sales-intake-submit`.
--   - Reads:  only service-role (n8n) — the tab itself doesn't read it back in v1.
-- Do not add `grant ... to anon` or any anon/authenticated policy here.
-- ============================================================

create table if not exists public.sales_intakes (
  id                        text not null,            -- submission id, si_<ts36>_<rand> (n8n-minted)
  created_at                text,                     -- ISO timestamp from the form submit
  closed_by                 text,                     -- who closed the deal ('Kasper' for now)
  client_name               text,
  client_email              text,
  instagram                 text,
  contract_start_date       text,                     -- YYYY-MM-DD, the day the deal closed
  deliverables              text,                     -- free text, goes into the agreement
  billing_type              text,                     -- 'monthly' | 'quarterly' | 'custom_recurring' | 'one_time'
  invoice_amount            numeric,                  -- USD
  payment_link              text,                     -- the Stripe URL actually emailed
  termination_clause_type   text,                     -- 'regular' | 'custom'
  termination_clause_text   text,                     -- the clause text as sent (regular text travels in the payload)
  referred_by               text,
  esign_contract_id         text,                     -- eSignatures.com contract id once created
  status                    text default 'submitted', -- submitted | preview_requested | preview_created | contract_created | email_sent | failed
  raw                       jsonb,                    -- full submission payload as received; custom_recurring cadence lives in raw.billing_cadence
  primary key (id)
);

-- RLS on, with NO policies on purpose. service_role bypasses RLS, so the
-- n8n webhook (service-role credential) keeps working; the public anon key
-- is locked out entirely.
alter table public.sales_intakes enable row level security;
revoke all on public.sales_intakes from anon;
revoke all on public.sales_intakes from authenticated;

-- (No realtime publication — nothing in the app subscribes to sales intakes.)
