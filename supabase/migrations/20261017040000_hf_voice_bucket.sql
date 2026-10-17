-- ef-auto-deploy-applied-when: select exists (select 1 from storage.buckets where id = 'voice' and public = false)
--
-- Private Storage bucket "voice" for the connector's voice_cleanup tool
-- (supabase/functions/higgsfield-mcp/voice.mjs). When Auphonic finishes a
-- clean-up, the connector copies the cleaned WAV here (named <job_id>.wav)
-- and hands the person a signed download link that works for 1 hour.
-- Auphonic's own download link is never handed out: it only works with the
-- account's key attached.
--
-- Up to 400 MB per file (a 5 minute WAV is well under; the input limit is
-- about 200 MB). WAV only. The project's global upload limit (Storage
-- settings) must be at least this for the largest files to save.
--
-- Access: no storage policies on purpose. RLS on storage.objects stays on and
-- with no policy anon and authenticated can neither list, read nor write
-- anything in this bucket; only the higgsfield-mcp Edge Function (service
-- role, which bypasses RLS) writes files and signs links. This file creates
-- no table, function or sequence, so it grants and revokes nothing (no role,
-- of public, anon, authenticated or service_role, gains anything here).
--
-- Rollback: delete from storage.objects where bucket_id = 'voice';
--           delete from storage.buckets where id = 'voice';
-- Written by session Lather 2026-10-17; applied by Lighthouse.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice', 'voice', false, 419430400, array['audio/wav', 'audio/x-wav', 'audio/wave'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
