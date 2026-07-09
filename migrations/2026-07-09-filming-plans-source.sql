-- Filming plan master-doc source of truth.
-- Supabase replaces the public SyncView Sheet FilmingPlans tab as the default
-- app source. Reads are public like the previous sheet feed; writes go only
-- through the filming-plans Edge Function with ONBOARDING_STAFF_KEY.

create table if not exists public.filming_plans (
  client_slug text primary key,
  client_name text not null,
  doc_url text not null default '',
  doc_id text not null default '',
  notes text not null default '',
  plan_months text not null default '',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  updated_by text
);

alter table public.filming_plans enable row level security;

drop policy if exists "anon read filming plans" on public.filming_plans;
create policy "anon read filming plans"
  on public.filming_plans
  as permissive
  for select
  to anon, authenticated
  using (true);

grant select on table public.filming_plans to anon;
grant select on table public.filming_plans to authenticated;
grant select, insert, update, delete on table public.filming_plans to service_role;

alter table public.filming_plans replica identity full;

insert into public.filming_plans (client_slug, client_name, doc_url, doc_id, updated_by)
values
  ('adrianarizzolo', 'Adriana Rizzolo', 'https://docs.google.com/document/d/1NzCcEEy86QMrx60NIcQpO_-GlT_m1euo0zbLaqaBHog/edit', '1NzCcEEy86QMrx60NIcQpO_-GlT_m1euo0zbLaqaBHog', 'syncview-filmingplans-seed'),
  ('allischaper', 'Alli Schaper', 'https://docs.google.com/document/d/1OLIut2gxNuzbHiRENijQWxFCPuWTBIEV3pFm1wtAmAs/edit', '1OLIut2gxNuzbHiRENijQWxFCPuWTBIEV3pFm1wtAmAs', 'syncview-filmingplans-seed'),
  ('bayavoce', 'Baya Voce', 'https://docs.google.com/document/d/13FGKnpq_J6DKW7yM1HXC3Y8_9sJ3RgEtAJ-Y3FaJSA4/edit', '13FGKnpq_J6DKW7yM1HXC3Y8_9sJ3RgEtAJ-Y3FaJSA4', 'syncview-filmingplans-seed'),
  ('chelseyscaffidi', 'Chelsey Scaffidi', 'https://docs.google.com/document/d/1zwmKVqdWXbXspiwbXTohy_laEmIezBJZ0d0FNvo8wSk/edit', '1zwmKVqdWXbXspiwbXTohy_laEmIezBJZ0d0FNvo8wSk', 'syncview-filmingplans-seed'),
  ('daniellerobin', 'Danielle Robin', 'https://docs.google.com/document/d/1ow9BNbscn3VqjGA27QkyvOxQjXRd0_1T04f_e_SOWos/edit', '1ow9BNbscn3VqjGA27QkyvOxQjXRd0_1T04f_e_SOWos', 'syncview-filmingplans-seed'),
  ('davidkessler', 'David Kessler', 'https://docs.google.com/document/d/18iOVn8WJzKnLKj8a2qusS28rEe3ZtyR8RcE4blgJXIE/edit', '18iOVn8WJzKnLKj8a2qusS28rEe3ZtyR8RcE4blgJXIE', 'syncview-filmingplans-seed'),
  ('dougcartwright', 'Doug Cartwright', 'https://docs.google.com/document/d/1xSZpSiGkiphsIA413qw2ZQ5Epc_NSXcqzO3KnzU6HmA/edit', '1xSZpSiGkiphsIA413qw2ZQ5Epc_NSXcqzO3KnzU6HmA', 'syncview-filmingplans-seed'),
  ('roccopiazza', 'Dr. Rocco Piazza', 'https://docs.google.com/document/d/161ZA_D9fwihCiYD3yR9kLNYMsZgRqO0xx_mniY_Q_kA/edit', '161ZA_D9fwihCiYD3yR9kLNYMsZgRqO0xx_mniY_Q_kA', 'syncview-filmingplans-seed'),
  ('soniachopra', 'Dr. Sonia Chopra', 'https://docs.google.com/document/d/1zCotAjiFCtGlXp_DY3sDRSUHhsXzFkMOTim450BYtmI/edit', '1zCotAjiFCtGlXp_DY3sDRSUHhsXzFkMOTim450BYtmI', 'syncview-filmingplans-seed'),
  ('eben&annie', 'Eben & Annie', 'https://docs.google.com/document/d/1q4AbMYI5JqzG_FudMQ19yOm4NmzLNYEZxsrL6dW3a00/edit', '1q4AbMYI5JqzG_FudMQ19yOm4NmzLNYEZxsrL6dW3a00', 'syncview-filmingplans-seed'),
  ('edwardmannix', 'Edward Mannix', 'https://docs.google.com/document/d/1dHriASeW_dTWHqPPlAJ53Zut59zMs3YNPWGPTF_4qZo/edit', '1dHriASeW_dTWHqPPlAJ53Zut59zMs3YNPWGPTF_4qZo', 'syncview-filmingplans-seed'),
  ('ericamatluck', 'Erica Matluck', 'https://docs.google.com/document/d/1yu773GojiM4OsGpMDwF1NvFZnbZMqJ_SOxKHb_z4TBM/edit', '1yu773GojiM4OsGpMDwF1NvFZnbZMqJ_SOxKHb_z4TBM', 'syncview-filmingplans-seed'),
  ('henryammar', 'Henry Ammar', 'https://docs.google.com/document/d/1C-KnZcLMToekWbe9MpxSLi7PUNh_GDfU0_PBuEOcoLM/edit', '1C-KnZcLMToekWbe9MpxSLi7PUNh_GDfU0_PBuEOcoLM', 'syncview-filmingplans-seed'),
  ('jesseisrael', 'Jesse Israel', 'https://docs.google.com/document/d/1WDCg3qvuOdUDCFb0KFrS2u2lLa1D_cLC4bmHC2_CisA/edit', '1WDCg3qvuOdUDCFb0KFrS2u2lLa1D_cLC4bmHC2_CisA', 'syncview-filmingplans-seed'),
  ('jessicawinterstern', 'Jessica Winterstern', 'https://docs.google.com/document/d/1R021LrGimBDbvS7LvkhIMN6tjIjbav_gRjs5h7XzThs/edit', '1R021LrGimBDbvS7LvkhIMN6tjIjbav_gRjs5h7XzThs', 'syncview-filmingplans-seed'),
  ('johnwineland', 'John Wineland', 'https://docs.google.com/document/d/1_rvVCHNs6WXJrU3xWns7LtrwhCQcbl80hODwWs9xJY0/edit', '1_rvVCHNs6WXJrU3xWns7LtrwhCQcbl80hODwWs9xJY0', 'syncview-filmingplans-seed'),
  ('laurentaus', 'Lauren Taus', 'https://docs.google.com/document/d/1fyxb9hMBQm7QQTcCeMLPZgw5yRxraxRxwvpT6Fmk6e0/edit', '1fyxb9hMBQm7QQTcCeMLPZgw5yRxraxRxwvpT6Fmk6e0', 'syncview-filmingplans-seed'),
  ('lisakleyn', 'Lisa Kleyn', 'https://docs.google.com/document/d/1cAiSlCsuz6RHezzUJGJGpPicR5loEmsnbBzOQ5H1j6U/edit', '1cAiSlCsuz6RHezzUJGJGpPicR5loEmsnbBzOQ5H1j6U', 'syncview-filmingplans-seed'),
  ('mastinkipp', 'Mastin Kipp', 'https://docs.google.com/document/d/1e6nPIYPBzIVTAxJ83R8kVP87bTQ1J5xwn48z7y3eLwc/edit', '1e6nPIYPBzIVTAxJ83R8kVP87bTQ1J5xwn48z7y3eLwc', 'syncview-filmingplans-seed'),
  ('melissapruett', 'Melissa Pruett', 'https://docs.google.com/document/d/1_CXhqVo-AcxPlcrpGFhdYlTk4Wl8l_67tO_4ghGFenI/edit', '1_CXhqVo-AcxPlcrpGFhdYlTk4Wl8l_67tO_4ghGFenI', 'syncview-filmingplans-seed'),
  ('mikiagrawal', 'Miki Agrawal', 'https://docs.google.com/document/d/1z75Ry7iHScgf2re565X7Zc7eeCanvlXnDI2zcL11j3I/edit', '1z75Ry7iHScgf2re565X7Zc7eeCanvlXnDI2zcL11j3I', 'syncview-filmingplans-seed'),
  ('morganburch', 'Morgan Burch', 'https://docs.google.com/document/d/1DImUW9wtXequ3N3YxWQhc-jVUW8GyB10sy0-xtBaJtA/edit', '1DImUW9wtXequ3N3YxWQhc-jVUW8GyB10sy0-xtBaJtA', 'syncview-filmingplans-seed'),
  ('morganburton', 'Morgan Burton', 'https://docs.google.com/document/d/1ohGl1mymNpJNiO9FRCmmTxLHYL7iNPxQ0PInG0S6bfM/edit', '1ohGl1mymNpJNiO9FRCmmTxLHYL7iNPxQ0PInG0S6bfM', 'syncview-filmingplans-seed'),
  ('nataliemacneil', 'Natalie MacNeil', 'https://docs.google.com/document/d/1RAK4575-gC-d_QATggoDOScfNIsdI4L0zBm3UAwHDEk/edit', '1RAK4575-gC-d_QATggoDOScfNIsdI4L0zBm3UAwHDEk', 'syncview-filmingplans-seed'),
  ('lilybaker', 'Lily Baker', 'https://docs.google.com/document/d/1dp8mNZNKBJcXq-qPjC_KsAKl-t5d701xrsh42-Z6yC0/edit', '1dp8mNZNKBJcXq-qPjC_KsAKl-t5d701xrsh42-Z6yC0', 'syncview-filmingplans-seed'),
  ('terrinammar', 'Terrin Ammar', 'https://docs.google.com/document/d/1cWJ_buRzZPLnUw9fPcMHDm_qZyyjaJefn9Cm-lgcZAY/edit', '1cWJ_buRzZPLnUw9fPcMHDm_qZyyjaJefn9Cm-lgcZAY', 'syncview-filmingplans-seed'),
  ('sidneylaruel', 'Sidney Laruel', 'https://docs.google.com/document/d/1TzfCIfMTc4LPKnDPYJnLU8FHGBFdfggZAXer-P5QlQc/edit', '1TzfCIfMTc4LPKnDPYJnLU8FHGBFdfggZAXer-P5QlQc', 'syncview-filmingplans-seed'),
  ('jennaphillipsballard', 'Jenna Phillips Ballard', 'https://docs.google.com/document/d/14ii3SLzcXHZhssoCqcANq5gLYFY-oZbvFuOdsZFajNk/edit', '14ii3SLzcXHZhssoCqcANq5gLYFY-oZbvFuOdsZFajNk', 'syncview-filmingplans-seed'),
  ('alaynabellquist', 'Alayna Bellquist', 'https://docs.google.com/document/d/1VrrGpUv3B2yS7DwxbQhudcduLj8wpJXNBgiwaDO9gIM/edit', '1VrrGpUv3B2yS7DwxbQhudcduLj8wpJXNBgiwaDO9gIM', 'syncview-filmingplans-seed'),
  ('amandahanson', 'Amanda Hanson', 'https://docs.google.com/document/d/1nqn8vEecUZvJ6zbXb38skovnwz2zP5fX-KlDK3BT428/edit', '1nqn8vEecUZvJ6zbXb38skovnwz2zP5fX-KlDK3BT428', 'syncview-filmingplans-seed')
on conflict (client_slug) do update
set
  client_name = excluded.client_name,
  doc_url = case
    when coalesce(public.filming_plans.doc_url, '') = '' then excluded.doc_url
    else public.filming_plans.doc_url
  end,
  doc_id = case
    when coalesce(public.filming_plans.doc_id, '') = '' then excluded.doc_id
    else public.filming_plans.doc_id
  end,
  updated_by = case
    when coalesce(public.filming_plans.doc_url, '') = '' then excluded.updated_by
    else public.filming_plans.updated_by
  end;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'filming_plans'
  ) then
    alter publication supabase_realtime add table public.filming_plans;
  end if;
end $$;
