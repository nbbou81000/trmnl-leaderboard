-- =====================================================================
--  Installations apportées par le site (estimation) : base de données Supabase
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ».
--  Nécessite visites.sql (version 4) et schema4.sql déjà installés. Peut être relancé sans risque.
--
--  Principe : chaque clic du site vers une page de recette sur trmnl.com est enregistré par le compteur
--  de visites (sans cookie). Toutes les heures, le workflow compare ce clic aux relevés d'installations
--  de la recette : si elle a gagné une installation (ou un fork) dans les 2 heures qui suivent, plus que
--  son rythme habituel ne l'expliquerait, le clic est noté « installation probable ».
--  TRMNL ne dit jamais qui installe une recette : ce n'est qu'une estimation.
--
--  Lecture : l'administrateur voit tout ; un créateur dont la liaison Discord est vérifiée voit
--  uniquement les totaux de ses propres recettes (aucune heure, aucun visiteur).
-- =====================================================================

create table if not exists public.recipe_clicks (
  hit_id     bigint primary key,                 -- le clic (visit_hits.id)
  at         timestamptz not null,
  recipe_id  text not null,
  creator_id text,
  source     text not null default 'autre',      -- onglet ou bloc d'où vient le clic
  verdict    text not null check (verdict in ('probable', 'aucune', 'indetermine', 'repetition')),
  gained     integer,                            -- installations + forks gagnés pendant la fenêtre
  expected   numeric,                            -- ce que le rythme habituel de la recette aurait donné
  win_start  timestamptz,
  win_end    timestamptz,
  checked_at timestamptz not null default now()
);
create index if not exists recipe_clicks_at on public.recipe_clicks (at);
create index if not exists recipe_clicks_creator on public.recipe_clicks (creator_id, at);

alter table public.recipe_clicks enable row level security;
revoke all on public.recipe_clicks from anon, authenticated;

-- ---------- Calcul commun (interne) : totaux, par source, par recette, par jour
create or replace function public.click_installs_calc(p_from timestamptz, p_creator text, p_detail boolean) returns json
language sql stable security definer set search_path = public as $$
  with c as (select * from recipe_clicks where at >= p_from and (p_creator is null or creator_id = p_creator))
  select json_build_object(
    'clicks',      (select count(*) from c),
    'probable',    (select count(*) from c where verdict = 'probable'),
    'none',        (select count(*) from c where verdict = 'aucune'),
    'undetermined',(select count(*) from c where verdict = 'indetermine'),
    'repeats',     (select count(*) from c where verdict = 'repetition'),
    'visitors',    case when p_detail then (select count(distinct h.visitor) from c join visit_hits h on h.id = c.hit_id) end,
    'recipes_hit', (select count(distinct recipe_id) from c),
    'sources', (select coalesce(json_agg(x order by x.clicks desc), '[]') from (
        select source, count(*) as clicks, count(*) filter (where verdict = 'probable') as probable,
               count(*) filter (where verdict = 'indetermine') as undetermined
        from c group by source) x),
    'recipes', (select coalesce(json_agg(x order by x.probable desc, x.clicks desc), '[]') from (
        select recipe_id, max(creator_id) as creator_id, count(*) as clicks, count(*) filter (where verdict = 'probable') as probable,
               count(*) filter (where verdict = 'indetermine') as undetermined
        from c group by recipe_id order by 4 desc, 3 desc limit case when p_creator is null then 30 else 200 end) x),
    'creators', case when p_detail then (select coalesce(json_agg(x order by x.probable desc, x.clicks desc), '[]') from (
        select creator_id, count(*) as clicks, count(*) filter (where verdict = 'probable') as probable
        from c where creator_id is not null group by creator_id order by 3 desc, 2 desc limit 15) x) end,
    'daily', case when p_detail then (select coalesce(json_agg(x order by x.day), '[]') from (
        select (at at time zone 'Europe/Paris')::date as day, count(*) as clicks, count(*) filter (where verdict = 'probable') as probable
        from c group by 1) x) end
  )
$$;
revoke all on function public.click_installs_calc(timestamptz, text, boolean) from public, anon, authenticated;

-- ---------- Administrateur : tout le site, sur la période choisie dans les statistiques
create or replace function public.click_installs_admin(p_days integer default 30) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  n  integer := greatest(1, least(coalesce(p_days, 30), 400));
  t0 timestamptz := (((now() at time zone 'Europe/Paris')::date - (n - 1))::timestamp at time zone 'Europe/Paris');
  res jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  res := public.click_installs_calc(t0, null, true)::jsonb;
  -- Clics encore en attente de vérification (moins de 2 à 3 heures, le temps du relevé suivant)
  res := res || jsonb_build_object('pending', (
    select count(*) from visit_hits h
    where h.kind = 'event' and h.path in ('recette-cliquee', 'incontournable-installe') and h.target like 'recipe:%'
      and h.at >= greatest(t0, now() - interval '8 days')
      and not exists (select 1 from recipe_clicks r where r.hit_id = h.id)));
  return res::json;
end $$;
revoke all on function public.click_installs_admin(integer) from public;
grant execute on function public.click_installs_admin(integer) to authenticated;

-- ---------- Créateur vérifié : ses propres recettes seulement, 30 derniers jours et depuis le début
create or replace function public.click_installs_mine() returns json
language plpgsql stable security definer set search_path = public as $$
declare cid text;
begin
  select creator_id into cid from profiles where id = auth.uid() and creator_status = 'verified' and not banned;
  if cid is null then raise exception 'Not a verified creator.'; end if;
  return json_build_object(
    'creator_id', cid,
    'since',  (select min(at) from recipe_clicks),
    'd30',    public.click_installs_calc(now() - interval '30 days', cid, false),
    'all',    public.click_installs_calc('-infinity'::timestamptz, cid, false));
end $$;
revoke all on function public.click_installs_mine() from public;
grant execute on function public.click_installs_mine() to authenticated;
