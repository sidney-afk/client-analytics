-- Notes Step 1: APPLY the old-note labels counted by notes-label-dryrun.sql.
-- NOT run by the session that wrote it; Lighthouse applies it (owner, 2026-10-13).
-- Adds "audience" to a thread's FIRST message only where it has none:
-- kasper/smm -> internal, client -> client, anything else -> internal.
-- Replies are never touched (they inherit their root). Text, ids, statuses and
-- every other field are left exactly as they are. One transaction; prints counts.
begin;
create temporary table _notes_label_before on commit drop as
  select id, tweaks, video_tweaks, graphic_tweaks, caption_tweaks, title_tweaks from public.calendar_posts;
create or replace function pg_temp.label_notes(raw text) returns text language sql immutable as $$
  select case
    when raw is null or btrim(raw) in ('', '""', 'null') then raw
    when jsonb_typeof(raw::jsonb) <> 'array' then raw
    else (select coalesce(jsonb_agg(
            case when coalesce(n->>'parent_id','') = '' and not (n->>'audience' in ('internal','client'))
                 then n || jsonb_build_object('audience', case when n->>'role' = 'client' then 'client' else 'internal' end)
                 else n end order by ord), '[]'::jsonb)::text
          from jsonb_array_elements(raw::jsonb) with ordinality as e(n, ord))
  end $$;
update public.calendar_posts p set
  tweaks         = pg_temp.label_notes(p.tweaks),   -- legacy mirror of video_tweaks
  video_tweaks   = pg_temp.label_notes(p.video_tweaks),
  graphic_tweaks = pg_temp.label_notes(p.graphic_tweaks),
  caption_tweaks = pg_temp.label_notes(p.caption_tweaks),
  title_tweaks   = pg_temp.label_notes(p.title_tweaks)
where pg_temp.label_notes(p.tweaks) is distinct from p.tweaks
   or pg_temp.label_notes(p.video_tweaks) is distinct from p.video_tweaks
   or pg_temp.label_notes(p.graphic_tweaks) is distinct from p.graphic_tweaks
   or pg_temp.label_notes(p.caption_tweaks) is distinct from p.caption_tweaks
   or pg_temp.label_notes(p.title_tweaks) is distinct from p.title_tweaks;
-- Expect the dry run's by_role + unclear roots (233 on 2026-10-13) to now be "kept".
select count(*) as cards_changed from public.calendar_posts p join _notes_label_before b using (id)
 where p.video_tweaks is distinct from b.video_tweaks or p.graphic_tweaks is distinct from b.graphic_tweaks
    or p.caption_tweaks is distinct from b.caption_tweaks or p.title_tweaks is distinct from b.title_tweaks;
-- Review the count, then COMMIT; or ROLLBACK;
