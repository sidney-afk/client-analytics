-- ef-auto-deploy-applied-when: select exists (select 1 from storage.buckets where id = 'voice' and 'audio/mpeg' = any (allowed_mime_types))
--
-- The private Storage bucket "voice" (20261017040000_hf_voice_bucket.sql) took WAV only. The ElevenLabs Voice
-- Isolator engine of voice_cleanup (supabase/functions/higgsfield-mcp/isolate.mjs) gets its cleaned voice back
-- as an audio file whose format ElevenLabs decides (usually MP3), so the bucket must also accept common audio
-- types or the paid result could not be saved. Everything else is unchanged: still private, no storage policy
-- (only the higgsfield-mcp Edge Function, service role, writes and signs links), same size limit. This creates
-- no table, function or sequence, so it grants and revokes nothing.
--
-- Rollback: update storage.buckets set allowed_mime_types = array['audio/wav', 'audio/x-wav', 'audio/wave'] where id = 'voice';
begin;

update storage.buckets
set allowed_mime_types = array['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/x-m4a']
where id = 'voice';

commit;
