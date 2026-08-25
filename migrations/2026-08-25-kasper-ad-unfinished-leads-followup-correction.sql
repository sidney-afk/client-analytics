-- Corrects a real error in the prior day's manual backfill
-- (2026-08-25-kasper-ad-unfinished-leads-backfill.sql).
--
-- That backfill sourced only from iClosed's own /v1/contacts API, which has
-- no follow-up fields at all, and set email_sent_at/follow_up_due_at to null
-- for all five rows on the (wrong) assumption that none of them had ever
-- been captured by the live automated pipeline. The owner caught this from
-- the live UI showing no follow-up status for leads he knew had been
-- emailed. Checked directly against n8n's booking_recovery Data Table (the
-- real source of truth for this field) and confirmed: four of the five
-- were already there, three with real recovery emails already sent.
--
-- iclosed_contact_id -> booking_recovery outcome:
--   4446501 (Han Pat)      -> status=completed,  email_sent_at=2026-08-16T22:50:42.263Z
--   4456254 (Hutchins)     -> status=suppressed/awaiting_sms, no email (phone-only
--                              contact, no email address was ever captured for him)
--   4473612 (James Williams) -> status=completed, email_sent_at=2026-08-19T10:20:42.220Z
--   4478230 (Natalie Geller) -> status=completed, email_sent_at=2026-08-19T19:00:40.703Z
-- Andrew Schwab (4415534) genuinely has no booking_recovery row -- he predates
-- the capture workflow's 2026-08-14 build -- so his row is correctly
-- untouched (both fields stay null).

begin;

update public.kasper_ad_unfinished_leads
set follow_up_due_at = '2026-08-16T22:40:51.936Z',
    email_sent_at = '2026-08-16T22:50:42.263Z',
    updated_by = 'backfill-correction:kasper-ad-performance-iclosed-manual-2026-08-25',
    updated_at = now()
where lead_key = '+640226406779'; -- Han Pat

update public.kasper_ad_unfinished_leads
set follow_up_due_at = '2026-08-17T19:53:33.083Z',
    updated_by = 'backfill-correction:kasper-ad-performance-iclosed-manual-2026-08-25',
    updated_at = now()
where lead_key = '+13109994435'; -- Hutchins (still no email_sent_at -- correct, none was sent)

update public.kasper_ad_unfinished_leads
set follow_up_due_at = '2026-08-19T10:11:53.984Z',
    email_sent_at = '2026-08-19T10:20:42.220Z',
    updated_by = 'backfill-correction:kasper-ad-performance-iclosed-manual-2026-08-25',
    updated_at = now()
where lead_key = '+16787759599'; -- James Williams

update public.kasper_ad_unfinished_leads
set follow_up_due_at = '2026-08-19T18:56:14.735Z',
    email_sent_at = '2026-08-19T19:00:40.703Z',
    updated_by = 'backfill-correction:kasper-ad-performance-iclosed-manual-2026-08-25',
    updated_at = now()
where lead_key = '+13474256615'; -- Natalie Geller

commit;
