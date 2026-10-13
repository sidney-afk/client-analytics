-- Notes Step 1: DRY RUN for labelling old notes (docs/plans/2026-10-13-notes-messages.md, section 5).
-- Read-only: counts only, writes nothing, prints no text, names or slugs.
-- Rule (owner decision 10): audience from today's rule (staff -> internal,
-- client -> client); anything unclear stays internal (team only).
-- Only a thread's FIRST message carries an audience: a reply inherits its
-- root's, so replies are never labelled (labelling one by its author's role
-- could hide a staff reply on a client thread from the client).
-- kind from is_tweak (missing on a root -> change_request, as the page reads it);
-- component from the column the note sits in.
with cols as (
  select c.component, n.note
  from public.calendar_posts p
  cross join lateral (values
    ('video', p.video_tweaks), ('graphic', p.graphic_tweaks),
    ('caption', p.caption_tweaks), ('title', p.title_tweaks)) as c(component, raw)
  cross join lateral jsonb_array_elements(
    case when c.raw is null or btrim(c.raw::text) in ('', '""', 'null') then '[]'::jsonb
         when jsonb_typeof(c.raw::jsonb) = 'array' then c.raw::jsonb
         else '[]'::jsonb end) as n(note)
), labelled as (
  select component,
    (note ? 'audience' and note->>'audience' in ('internal','client')) as has_audience,
    case when note->>'audience' in ('internal','client') then note->>'audience'
         when coalesce(note->>'parent_id','') <> '' then 'from_root'
         when note->>'role' in ('kasper','smm') then 'internal'
         when note->>'role' = 'client' then 'client'
         else 'internal' end as audience,
    case when note->>'audience' in ('internal','client') then 'kept'
         when coalesce(note->>'parent_id','') <> '' then 'reply_inherits_root'
         when note->>'role' in ('kasper','smm','client') then 'by_role'
         else 'unclear_kept_internal' end as rule,
    coalesce(note->>'parent_id','') <> '' as is_reply,
    case when coalesce(note->>'parent_id','') <> '' then 'reply'
         when note->>'is_tweak' = 'false' then 'comment'
         else 'change_request' end as kind
  from cols
)
select rule, audience, count(*) as notes
from labelled
group by rollup (1,2)
order by 1 nulls last,2 nulls last;
