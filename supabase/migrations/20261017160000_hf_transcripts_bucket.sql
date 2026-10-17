-- ef-auto-deploy-applied-when: select (select count(*) from storage.buckets where id in ('transcripts', 'transcribe-sources') and public = false) = 2
--
-- Two private Storage buckets for the connector's studio_transcribe tool
-- (supabase/functions/higgsfield-mcp/transcribe.mjs):
--
-- "transcribe-sources": the take's WAV is copied here first (named
--   <job_id>.wav), measured again, and ElevenLabs reads only this copy
--   through a 15 minute signed link, so the bytes it bills are the bytes that
--   were priced. The copy is deleted when the job ends. Up to 400 MB (the
--   project's Storage upload limit), WAV only.
-- "transcripts": ElevenLabs' transcript JSON, stored unchanged (named
--   <job_id>.json); the person gets a signed download link valid 1 hour, and
--   the same file transcribed again is served from here, free. Up to 50 MB
--   (a 30 minute take's transcript is a few MB), JSON only.
--
-- Access: no storage policies on purpose. RLS on storage.objects stays on and
-- with no policy anon and authenticated can neither list, read nor write
-- anything in either bucket; only the higgsfield-mcp Edge Function (service
-- role, which bypasses RLS) writes files and signs links. This file creates
-- no table, function or sequence, so it grants and revokes nothing (no role,
-- of public, anon, authenticated or service_role, gains anything here).
--
-- Until this is applied a job cannot copy the file and fails before anything
-- is sent to ElevenLabs, so the function is held until it is applied (the
-- probe above).
--
-- Rollback: delete from storage.objects where bucket_id in ('transcripts', 'transcribe-sources');
--           delete from storage.buckets where id in ('transcripts', 'transcribe-sources');
-- Written by session Quill 2026-10-17.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transcripts', 'transcripts', false, 52428800, array['application/json'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transcribe-sources', 'transcribe-sources', false, 419430400, array['audio/wav', 'audio/x-wav', 'audio/wave'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
