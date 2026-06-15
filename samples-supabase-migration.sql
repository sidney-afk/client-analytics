-- ============================================================
-- Content Samples → Supabase migration SQL
-- Run in the Supabase SQL editor for project uzltbbrjidmjwwfakwve.
-- Block 1 (DDL) is idempotent. Block 2 (seed) is an idempotent upsert
-- of the sample rows that existed at migration time (2026-06-15); the
-- live samples-upsert/reorder dual-write keeps the table current after.
-- ============================================================

-- ---- Block 1: table + RLS + realtime ----
create table if not exists public.content_samples (
  client                  text not null,
  id                      text not null,
  kind                    text,
  order_index             text,
  label                   text,
  media_url               text,
  creative_direction      text,
  hide_creative_direction text,
  comments                text,
  status                  text,
  approval                text,
  kasper_approved_at      text,
  kasper_approved_by      text,
  client_approved_at      text,
  client_approved_by      text,
  created_at              text,
  updated_at              text,
  primary key (client, id)
);

alter table public.content_samples enable row level security;
grant select on public.content_samples to anon;
drop policy if exists "anon read content_samples" on public.content_samples;
create policy "anon read content_samples"
  on public.content_samples for select to anon using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='content_samples'
  ) then
    execute 'alter publication supabase_realtime add table public.content_samples';
  end if;
end $$;
alter table public.content_samples replica identity full;

-- ---- Block 2: seed existing rows (idempotent upsert) ----
-- Seed content_samples with the 19 existing sample rows (read live from the Sheet via samples-get).
-- Idempotent: safe to re-run. Run AFTER the table DDL.
insert into public.content_samples (client,id,kind,order_index,label,media_url,creative_direction,hide_creative_direction,comments,status,approval,kasper_approved_at,kasper_approved_by,client_approved_at,client_approved_by,created_at,updated_at) values
('melissapruett','s_mq7409xo_mrkz3','thumb','1','Thumbnail 1','https://drive.google.com/file/d/1pMGlXZ2T9G7CGDyftimZ2NK6iLrko68-/view?usp=drive_link','','','','Archived','draft','','','','','2026-06-09T20:45:45.419Z','2026-06-09T20:47:35.721Z'),
('melissapruett','s_mq740pxo_x3ce0','thumb','2','Thumbnail 2','https://drive.google.com/file/d/1A_bU70aQ4VshEt6-jZcflMEHqEP1Q-iu/view?usp=drive_link','','','','Archived','draft','','','','','2026-06-09T20:46:06.156Z','2026-06-09T20:47:33.517Z'),
('melissapruett','s_mq741ai9_sd9sx','thumb','3','Thumbnail 3','https://drive.google.com/file/d/1wD3EzpmZDfKzZjU8_X_2_wtxRnL6-qo6/view?usp=drive_link','','','','Archived','draft','','','','','2026-06-09T20:46:32.817Z','2026-06-09T20:47:31.705Z'),
('melissapruett','s_mq741hle_4wzj9','thumb','4','Thumbnail 4','https://drive.google.com/file/d/16Z4ZMyTpneuwippzE1IEWttCJ-qFgpGd/view?usp=drive_link','','','','Archived','draft','','','','','2026-06-09T20:46:42.002Z','2026-06-09T20:47:29.916Z'),
('sidneylaruel','s_selftest_1','reel','1','Reel 1','https://f.io/selftest','Self-test sample — safe to delete.','','','Archived','','','','','','2026-06-09T15:00:00.000Z','2026-06-09T15:04:18.131Z'),
('sidneylaruel','s_mq6uha30_y0mt4','reel','1','Reel 1','https://f.io/HXh_8tQv','xzczxc','TRUE','[{"id":"c_mq6ui7ol_7guhv","parent_id":null,"author":"Synchro Social","role":"smm","body":"Test","created_at":"2026-06-09T16:19:46.149Z","updated_at":"2026-06-09T16:24:22.673Z","done":false,"done_at":"","done_by":"","audience":"client","deleted":true},{"id":"c_mq6uiffo_8428w","parent_id":null,"author":"Synchro Social","role":"smm","body":"Test","created_at":"2026-06-09T16:19:56.196Z","updated_at":"2026-06-09T16:19:56.196Z","done":false,"done_at":"","done_by":"","audience":"internal"},{"id":"c_mq6x1ing_egrt9","parent_id":null,"author":"Sidney Laruel","role":"client","body":"Test","created_at":"2026-06-09T17:30:46.060Z","updated_at":"2026-06-09T17:30:46.060Z","audience":"client"}]','Active','client','2026-06-09T17:30:35.285Z','Synchro Social','2026-06-09T19:47:52.783Z','Sidney Laruel','2026-06-09T16:19:02.603Z','2026-06-11T15:38:08.878Z'),
('sidneylaruel','s_mq6uitzj_j4414','thumb','2','Thumbnail 1','https://drive.google.com/file/d/1rpOCT4NRO6ZUWoiWfShrMP3YQ3e8tDT2/view?usp=drive_link','Test','','[{"id":"c_mq6ujxab_553l7","parent_id":null,"author":"Synchro Social","role":"smm","body":"Do this","created_at":"2026-06-09T16:21:05.987Z","updated_at":"2026-06-09T16:21:05.987Z","done":false,"done_at":"","done_by":"","audience":"client"},{"id":"c_mq6ukbr8_t5x3b","parent_id":null,"author":"Sidney Laruel","role":"client","body":"Do this","created_at":"2026-06-09T16:21:24.740Z","updated_at":"2026-06-09T16:21:32.219Z","done":false,"done_at":"","done_by":"","audience":"client"}]','Active','approved','2026-06-09T19:01:44.272Z','Synchro Social','2026-06-09T19:02:06.456Z','Synchro Social','2026-06-09T16:20:15.055Z','2026-06-09T19:02:06.134Z'),
('sidneylaruel','s_appr_verify','reel','50','Approval verify','https://f.io/verify','verify dir','','','Archived','approved','2026-06-09T16:00:00.000Z','Synchro Social','2026-06-09T17:30:00.000Z','Sidney Laruel','2026-06-09T16:00:00.000Z','2026-06-09T17:19:14.162Z'),
('lisakleyn','s_mq84q9sj_x3in3','reel','1','Reel 1','','','','','Archived','','','','','','2026-06-10T13:53:44.462Z','2026-06-10T13:54:00.000Z'),
('henryammar','s_mqb0mups_iaef4','reel','1','Reel 1','','','FALSE','','Archived','draft','','','','','2026-06-12T14:22:25.024Z','2026-06-12T14:22:31.415Z'),
('lilybaker','s_mq74369v_o093s','thumb','1','Thumbnail 1','https://drive.google.com/file/d/1pMGlXZ2T9G7CGDyftimZ2NK6iLrko68-/view?usp=drive_link','','','','Active','kasper','','','','','2026-06-09T20:48:00.643Z','2026-06-10T14:36:22.513Z'),
('lilybaker','s_mq743ff1_uuctq','thumb','2','Thumbnail 2','https://drive.google.com/file/d/1A_bU70aQ4VshEt6-jZcflMEHqEP1Q-iu/view?usp=drive_link','','','','Active','kasper','','','','','2026-06-09T20:48:12.493Z','2026-06-10T14:36:23.550Z'),
('lilybaker','s_mq743p4s_w4mli','thumb','3','Thumbnail 3','https://drive.google.com/file/d/1wD3EzpmZDfKzZjU8_X_2_wtxRnL6-qo6/view?usp=drive_link','','','','Active','kasper','','','','','2026-06-09T20:48:25.083Z','2026-06-10T14:36:24.298Z'),
('lilybaker','s_mq743vit_df2r0','thumb','4','Thumbnail 4','https://drive.google.com/file/d/16Z4ZMyTpneuwippzE1IEWttCJ-qFgpGd/view?usp=drive_link','','','','Active','kasper','','','','','2026-06-09T20:48:33.365Z','2026-06-10T14:36:24.992Z'),
('lilybaker','s_mq744sif_mbwle','reel','5','Reel 1','https://f.io/lreqXi4p','','','','Active','kasper','','','','','2026-06-09T20:49:16.119Z','2026-06-10T14:36:16.060Z'),
('lilybaker','s_mq867xk4_7x476','reel','6','Reel 2','https://f.io/9_8Q0vDI','','','','Active','kasper','','','','','2026-06-10T14:35:28.036Z','2026-06-10T14:36:16.995Z'),
('lilybaker','s_mq868j0b_rm0ku','reel','7','Reel 3','https://f.io/YsPpqUn9','','','','Active','kasper','','','','','2026-06-10T14:35:55.835Z','2026-06-10T14:36:17.802Z'),
('lilybaker','s_mq9lirww_sukp9','thumb','8','Thumbnail 5','https://drive.google.com/file/d/1Lc4mRlDWTzr_yVghhcdRpkRcQkXeLMcs/view?usp=sharing','This is a sample carousel: https://drive.google.com/drive/folders/1lnCUn418q9agboVojgsTPdBoZmB5cwtO?usp=drive_link','','','Active','kasper','','','','','2026-06-11T14:31:34.352Z','2026-06-11T14:34:23.180Z'),
('lilybaker','s_mq9llw7b_nxauz','thumb','9','Thumbnail 6','https://drive.google.com/drive/folders/1lnCUn418q9agboVojgsTPdBoZmB5cwtO?usp=drive_link','','','','Archived','draft','','','','','2026-06-11T14:33:59.879Z','2026-06-11T14:34:25.543Z')
on conflict (client,id) do update set kind=excluded.kind, order_index=excluded.order_index, label=excluded.label, media_url=excluded.media_url, creative_direction=excluded.creative_direction, hide_creative_direction=excluded.hide_creative_direction, comments=excluded.comments, status=excluded.status, approval=excluded.approval, kasper_approved_at=excluded.kasper_approved_at, kasper_approved_by=excluded.kasper_approved_by, client_approved_at=excluded.client_approved_at, client_approved_by=excluded.client_approved_by, created_at=excluded.created_at, updated_at=excluded.updated_at;
