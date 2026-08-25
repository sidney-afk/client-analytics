-- One-time manual backfill for kasper_ad_unfinished_leads.
--
-- The live n8n pipeline mirrors n8n's booking_recovery Data Table, which only
-- captures leads from the moment iClosed's "Contact by status" webhook fired
-- for them (the workflow was built 2026-08-14) -- it has no history before
-- that. This left real, currently-unfinished leads from before that date
-- (and a handful captured after, but never routed through booking_recovery)
-- invisible to the dashboard, even though they exist in iClosed today.
--
-- Provenance, since the API path the live pipeline uses could not supply
-- this: iClosed's public /v1/contacts endpoint returns name/email/phone/
-- status/creation-date/calendar per contact (confirmed live via a disposable
-- read-only n8n probe workflow, archived after use), but does NOT return
-- UTM/ad-attribution fields on any variant tried (list, by numeric id, by
-- previewId, by the `?preview=` query param the dashboard URL itself uses).
-- The owner confirmed the same 14 real (non-team-test) contacts via iClosed's
-- own "Leads" smart view, which does show UTM SOURCE / UTM CONTENT columns --
-- data the public API does not expose. The five rows below are the
-- intersection: real people (owner's team-test entries -- Kasper Hytonen
-- variants, "test@gmail.com", etc. -- excluded), utm_source=facebook (two
-- of the fourteen were utm_source=ig / utm_content=link_in_bio, organic
-- Instagram bio-link traffic, not paid ads, and are excluded), scheduling
-- status potential/qualified (disqualified and already-booked/already-in-
-- kasper_ad_leads rows excluded), cross-verified against the API's own id/
-- phone/creation-date for each by email match.
--
-- utm_campaign is not itself visible in the owner's screenshot, but is set
-- to 'prospecting' here because campaign 120243068755680573 is the only
-- active Meta campaign this whole dashboard tracks, and every utm_source=
-- facebook row shown carries the same "Video+++|+..." utm_content pattern
-- already proven (via kasper_ad_leads and kasper_ad_performance_by_ad_daily)
-- to belong to that campaign.
--
-- captured_at uses each contact's iClosed creation date as a proxy -- there
-- is no original webhook event to source the true capture timestamp from,
-- since these predate (or were missed by) the webhook capture. email_sent_at
-- and sms_sent_at are left null: correctly, since no automated follow-up
-- ever ran against these before this backfill existed.

begin;

insert into public.kasper_ad_unfinished_leads
  (lead_key, iclosed_contact_id, first_name, last_name, email, phone,
   iclosed_status, utm_campaign, utm_content, captured_at,
   follow_up_due_at, email_sent_at, sms_sent_at, updated_by, updated_at)
values
  ('+13474256615', '4478230', 'Natalie', 'geller', 'gellernatalie@aol.com', '+13474256615',
   'potential', 'prospecting', 'Video+++|+Fast+Pitch', '2026-08-19T18:26:14.159Z',
   null, null, null, 'backfill:kasper-ad-performance-iclosed-manual-2026-08-25', now()),
  ('+16787759599', '4473612', 'James', 'Williams', 'jwflixvideography@gmail.com', '+16787759599',
   'potential', 'prospecting', 'Video+++|+Fast+Pitch', '2026-08-19T09:41:51.880Z',
   null, null, null, 'backfill:kasper-ad-performance-iclosed-manual-2026-08-25', now()),
  ('+13109994435', '4456254', null, 'Hutchins', null, '+13109994435',
   'potential', 'prospecting', 'Video+++|+Fast+Pitch', '2026-08-17T19:23:30.948Z',
   null, null, null, 'backfill:kasper-ad-performance-iclosed-manual-2026-08-25', now()),
  ('+640226406779', '4446501', 'Han', 'Pat', 'haanipat@gmail.com', '+640226406779',
   'qualified', 'prospecting', '{{ad.name}}', '2026-08-16T22:10:49.852Z',
   null, null, null, 'backfill:kasper-ad-performance-iclosed-manual-2026-08-25', now()),
  ('+17169973980', '4415534', 'Andrew', 'Schwab', 'drews_woodworking@yahoo.com', '+17169973980',
   'potential', 'prospecting', 'Video+++|+Fast+Pitch', '2026-08-13T21:04:41.613Z',
   null, null, null, 'backfill:kasper-ad-performance-iclosed-manual-2026-08-25', now())
on conflict (lead_key) do update set
  iclosed_contact_id = excluded.iclosed_contact_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email,
  phone = excluded.phone,
  iclosed_status = excluded.iclosed_status,
  utm_campaign = excluded.utm_campaign,
  utm_content = excluded.utm_content,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;
  -- captured_at, follow_up_due_at, email_sent_at, sms_sent_at deliberately
  -- NOT overwritten on conflict: if the live pipeline (or a future manual
  -- run) has since recorded a real follow-up against one of these leads,
  -- a re-run of this backfill must not erase it.

commit;
