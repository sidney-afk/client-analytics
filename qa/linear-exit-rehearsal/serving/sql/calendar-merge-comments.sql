-- Captured read-only serving prerequisite, 2026-09-12. No installation authorization.
CREATE OR REPLACE FUNCTION public.calendar_merge_comments(p_client text, p_id text, p_video text DEFAULT NULL::text, p_graphic text DEFAULT NULL::text, p_caption text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_base text DEFAULT ''::text)
 RETURNS SETOF calendar_posts
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  return query
  update calendar_posts c set
    video_tweaks   = case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.video_tweaks   end,
    tweaks         = case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.tweaks         end,
    graphic_tweaks = case when p_graphic is not null then _calmerge_comment_cell(c.graphic_tweaks, p_graphic, coalesce(p_base,'')) else c.graphic_tweaks end,
    caption_tweaks = case when p_caption is not null then _calmerge_comment_cell(c.caption_tweaks, p_caption, coalesce(p_base,'')) else c.caption_tweaks end,
    title_tweaks   = case when p_title   is not null then _calmerge_comment_cell(c.title_tweaks,   p_title,   coalesce(p_base,'')) else c.title_tweaks   end,
    updated_at     = now()
  where c.client = p_client and c.id = p_id
  returning c.*;
end;
$function$;
