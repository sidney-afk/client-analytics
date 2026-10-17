-- ef-auto-deploy-applied-when: select exists (select 1 from storage.buckets where id = 'transcripts' and public = false)
--
-- Private Storage bucket "transcripts" for the connector's studio_transcribe
-- tool (supabase/functions/higgsfield-mcp/transcribe.mjs). When ElevenLabs
-- answers, the connector stores its transcript JSON here unchanged (named
-- <job_id>.json) and hands the person a signed download link that works for
-- 1 hour. The same file transcribed again is served from here, free.
--
-- Up to 50 MB per file (a 30 minute take's transcript is a few MB). JSON only.
--
-- Access: no storage policies on purpose. RLS on storage.objects stays on and
-- with no policy anon and authenticated can neither list, read nor write
-- anything in this bucket; only the higgsfield-mcp Edge Function (service
-- role, which bypasses RLS) writes files and signs links. This file creates
-- no table, function or sequence, so it grants and revokes nothing (no role,
-- of public, anon, authenticated or service_role, gains anything here).
--
-- Until this is applied the tool still prices and starts jobs, but the first
-- finished transcript cannot be stored (the job says so, and is charged), so
-- the function is held until it is applied (the probe above).
--
-- Rollback: delete from storage.objects where bucket_id = 'transcripts';
--           delete from storage.buckets where id = 'transcripts';
-- Written by session Quill 2026-10-17.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transcripts', 'transcripts', false, 52428800, array['application/json'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
