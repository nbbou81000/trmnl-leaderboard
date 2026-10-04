-- =====================================================================
--  Mesure d'audience anonyme (sans cookie) : base de données Supabase — version 4
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ».
--  Peut être relancé sans risque : il ne supprime aucune donnée récente.
--
--  Ce qui est enregistré, et rien d'autre :
--   - un numéro tiré au hasard par le navigateur du visiteur (aucun lien avec la personne, pas d'adresse IP) ;
--   - chaque page vue ou action (partage, changement de langue…) avec son heure, l'onglet,
--     le site d'où il arrivait, la langue, le type d'appareil, le navigateur, le système,
--     la taille d'écran et le fuseau horaire (qui donne le pays approximatif) ;
--   - le temps passé sur le site, compté par tranches de 30 secondes quand la page est visible.
--  Les données de plus de 13 mois sont effacées automatiquement (règle de la CNIL).
--  Personne ne peut lire ces tables directement : seuls les administrateurs voient les statistiques.
-- =====================================================================

-- ---------- Un enregistrement par visiteur et par jour (visiteurs uniques, temps passé, présence en direct)
create table if not exists public.visit_days (
  day     date    not null,
  visitor uuid    not null,
  views   integer not null default 1,
  is_new  boolean not null default false,
  ref     text,
  lang    text,
  mobile  boolean,
  primary key (day, visitor)
);
alter table public.visit_days add column if not exists seconds   integer not null default 0;
alter table public.visit_days add column if not exists last_seen timestamptz not null default now();
alter table public.visit_days add column if not exists events    integer not null default 0;
alter table public.visit_days add column if not exists via       text;
create index if not exists visit_days_last_seen on public.visit_days (last_seen);

-- ---------- Chaque page vue et chaque action, avec son heure
create table if not exists public.visit_hits (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  visitor uuid    not null,
  kind    text    not null default 'view' check (kind in ('view', 'event')),
  path    text    not null,
  is_new  boolean not null default false,
  ref     text,
  lang    text,
  mobile  boolean,
  browser text,
  os      text,
  screen  text,
  tz      text
);
alter table public.visit_hits add column if not exists via text;
-- Cible d'une action (recipe:123, creator:40325, project:9, article:…, link:ko-fi.com), avec le réseau éventuel (@reddit)
alter table public.visit_hits add column if not exists target text;
create index if not exists visit_hits_at on public.visit_hits (at);
create index if not exists visit_hits_visitor on public.visit_hits (visitor, at);

-- Ancien compteur par onglet (version 1), conservé pour ne rien casser
create table if not exists public.page_days (
  day   date    not null,
  path  text    not null,
  views integer not null default 1,
  primary key (day, path)
);

alter table public.visit_days enable row level security;
alter table public.visit_hits enable row level security;
alter table public.page_days  enable row level security;
revoke all on public.visit_days from anon, authenticated;
revoke all on public.visit_hits from anon, authenticated;
revoke all on public.page_days  from anon, authenticated;

-- ---------- Petit nettoyeur de texte : lettres, chiffres et quelques signes, longueur limitée
create or replace function public.vclean(t text, n integer, pat text default '[^A-Za-z0-9 ._/+-]') returns text
language sql immutable as $$ select nullif(left(regexp_replace(coalesce(t, ''), pat, '', 'g'), n), '') $$;

-- ---------- Comptage d'une page vue ou d'une action (appelé par le site, sans connexion)
-- p_via : l'étiquette d'un lien de partage (discord, reddit…) ou d'un lien publié avec ?via=…
drop function if exists public.track_hit(uuid, text, text, boolean, text, text, boolean, text, text, text, text);
drop function if exists public.track_hit(uuid, text, text, boolean, text, text, boolean, text, text, text, text, text);
create or replace function public.track_hit(
  p_visitor uuid, p_kind text, p_path text, p_new boolean default false,
  p_ref text default null, p_lang text default null, p_mobile boolean default null,
  p_browser text default null, p_os text default null, p_screen text default null, p_tz text default null,
  p_via text default null, p_target text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Europe/Paris')::date; k text := case when p_kind = 'event' then 'event' else 'view' end;
begin
  if p_visitor is null then return; end if;
  p_path := coalesce(vclean(lower(p_path), 40, '[^a-z0-9_-]'), 'accueil');
  p_ref  := lower(vclean(p_ref, 80, '[^A-Za-z0-9.-]'));
  p_lang := case when p_lang in ('fr', 'en') then p_lang end;
  p_via  := lower(vclean(p_via, 30, '[^A-Za-z0-9_-]'));
  p_target := vclean(p_target, 80, '[^A-Za-z0-9:@._-]');

  -- Garde-fou : pas plus de 600 enregistrements par visiteur et par jour
  if (select views from visit_days where day = d and visitor = p_visitor) >= 600 then return; end if;

  insert into visit_days (day, visitor, views, events, is_new, ref, via, lang, mobile, last_seen)
  values (d, p_visitor, case when k = 'view' then 1 else 0 end, case when k = 'event' then 1 else 0 end,
          coalesce(p_new, false), p_ref, p_via, p_lang, p_mobile, now())
  on conflict (day, visitor) do update
    set views     = visit_days.views + case when k = 'view' then 1 else 0 end,
        events    = visit_days.events + case when k = 'event' then 1 else 0 end,
        is_new    = visit_days.is_new or excluded.is_new,
        ref       = coalesce(visit_days.ref, excluded.ref),
        via       = coalesce(visit_days.via, excluded.via),
        last_seen = now();

  insert into visit_hits (visitor, kind, path, is_new, ref, via, lang, mobile, browser, os, screen, tz, target)
  values (p_visitor, k, p_path, coalesce(p_new, false), p_ref, p_via, p_lang, p_mobile,
          vclean(p_browser, 20), vclean(p_os, 20), vclean(p_screen, 12), vclean(p_tz, 40), case when k = 'event' then p_target end);

  if random() < 0.02 then
    delete from visit_days where day < d - 395;
    delete from page_days  where day < d - 395;
    delete from visit_hits where at < now() - interval '395 days';
  end if;
end $$;

-- ---------- Temps passé : le site signale toutes les 30 secondes que la page est ouverte et visible
create or replace function public.track_ping(p_visitor uuid, p_seconds integer) returns void
language sql security definer set search_path = public as $$
  update visit_days set seconds = least(seconds + greatest(0, least(coalesce(p_seconds, 0), 60)), 86400), last_seen = now()
  where day = (now() at time zone 'Europe/Paris')::date and visitor = p_visitor;
$$;

-- Ancienne fonction de comptage (version 1), redirigée vers la nouvelle pour les pages restées en cache
create or replace function public.track_visit(
  p_visitor uuid, p_path text, p_new boolean default false,
  p_ref text default null, p_lang text default null, p_mobile boolean default null
) returns void
language sql security definer set search_path = public as $$ select public.track_hit(p_visitor, 'view', p_path, p_new, p_ref, p_lang, p_mobile) $$;

revoke all on function public.track_hit(uuid, text, text, boolean, text, text, boolean, text, text, text, text, text, text) from public;
revoke all on function public.track_ping(uuid, integer) from public;
revoke all on function public.track_visit(uuid, text, boolean, text, text, boolean) from public;
grant execute on function public.track_hit(uuid, text, text, boolean, text, text, boolean, text, text, text, text, text, text) to anon, authenticated;

-- ---------- Effacer les visites d'un appareil de l'administrateur (appelé une fois, quand il se connecte)
create or replace function public.forget_visitor(p_visitor uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  delete from visit_hits where visitor = p_visitor;
  delete from visit_days where visitor = p_visitor;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.forget_visitor(uuid) from public;
grant execute on function public.forget_visitor(uuid) to authenticated;
grant execute on function public.track_ping(uuid, integer) to anon, authenticated;
grant execute on function public.track_visit(uuid, text, boolean, text, text, boolean) to anon, authenticated;

-- ---------- Statistiques complètes d'une période (administrateurs seulement)
create or replace function public.visit_stats(p_days integer default 30) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  tzn text := 'Europe/Paris';
  d   date := (now() at time zone 'Europe/Paris')::date;
  n   integer := greatest(1, least(coalesce(p_days, 30), 400));
  d0  date := d - (n - 1);
  t0  timestamptz := (d0::timestamp at time zone 'Europe/Paris');
  res json;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  with vd as (select * from visit_days where day >= d0),
       h  as (select *, (at at time zone tzn) as lt from visit_hits where at >= t0),
       hv as (select * from h where kind = 'view')
  select json_build_object(
    'days', n,
    'today',      (select count(*) from visit_days where day = d),
    'yesterday',  (select count(*) from visit_days where day = d - 1),
    'unique_7',   (select count(distinct visitor) from visit_days where day > d - 7),
    'unique_30',  (select count(distinct visitor) from visit_days where day > d - 30),
    'unique',     (select count(distinct visitor) from vd),
    'new',        (select count(distinct visitor) from vd where is_new),
    'views',      (select coalesce(sum(views), 0) from vd),
    'visits',     (select count(*) from vd),
    'bounces',    (select count(*) from vd where views <= 1),
    'engaged',    (select count(*) from vd where views > 1 or seconds >= 30 or events > 0),
    'seconds',    (select coalesce(sum(seconds), 0) from vd),
    'timed',      (select count(*) from vd where seconds > 0),
    'mobile',     (select count(*) filter (where mobile) from vd),
    'daily', (select json_agg(x order by x.day) from (
        select g::date as day, count(v.visitor) as visitors, coalesce(sum(v.views), 0) as views,
               count(v.visitor) filter (where v.is_new) as new, coalesce(sum(v.seconds), 0) as seconds
        from generate_series(d0, d, interval '1 day') g left join vd v on v.day = g::date group by g) x),
    'hours_today', (select json_agg(x order by x.hour) from (
        select g as hour, count(distinct h.visitor) as visitors, count(h.id) as views
        from generate_series(0, 23) g left join hv h on h.lt::date = d and extract(hour from h.lt) = g group by g) x),
    'hours_yesterday', (select json_agg(x order by x.hour) from (
        select g as hour, count(distinct h.visitor) as visitors, count(h.id) as views
        from generate_series(0, 23) g left join hv h on h.lt::date = d - 1 and extract(hour from h.lt) = g group by g) x),
    'hours_avg', (select json_agg(x order by x.hour) from (
        select g as hour, round(count(h.id)::numeric / n, 2) as views
        from generate_series(0, 23) g left join hv h on extract(hour from h.lt) = g group by g) x),
    'heat', (select coalesce(json_agg(x), '[]') from (
        select extract(isodow from lt)::int as dow, extract(hour from lt)::int as hour, count(*) as views
        from hv group by 1, 2) x),
    'pages', (select coalesce(json_agg(x), '[]') from (
        select path, count(*) as views, count(distinct visitor) as visitors from hv where path not like 'article-%' group by path order by 2 desc limit 20) x),
    'articles', (select coalesce(json_agg(x), '[]') from (
        select substr(path, 9) as id, count(*) as views, count(distinct visitor) as visitors from hv where path like 'article-%' group by path order by 2 desc limit 25) x),
    'vias', (select coalesce(json_agg(x), '[]') from (
        select via, count(distinct visitor) as visitors from vd where via is not null group by via order by 2 desc limit 15) x),
    'entries', (select coalesce(json_agg(x), '[]') from (
        select path, count(*) as visitors from (
          select distinct on (visitor, lt::date) path from hv where path not like 'article-%' order by visitor, lt::date, at) f
        group by path order by 2 desc limit 10) x),
    'refs', (select coalesce(json_agg(x), '[]') from (
        select ref, count(distinct visitor) as visitors from vd where ref is not null group by ref order by 2 desc limit 15) x),
    'direct', (select count(*) from vd where ref is null),
    'browsers', (select coalesce(json_agg(x), '[]') from (
        select coalesce(browser, '?') as k, count(distinct visitor) as v from hv group by 1 order by 2 desc limit 8) x),
    'oses', (select coalesce(json_agg(x), '[]') from (
        select coalesce(os, '?') as k, count(distinct visitor) as v from hv group by 1 order by 2 desc limit 8) x),
    'screens', (select coalesce(json_agg(x), '[]') from (
        select coalesce(screen, '?') as k, count(distinct visitor) as v from hv group by 1 order by 2 desc) x),
    'langs', (select coalesce(json_agg(x), '[]') from (
        select coalesce(lang, '?') as k, count(*) as v from vd group by 1 order by 2 desc) x),
    'tzs', (select coalesce(json_agg(x), '[]') from (
        select coalesce(tz, '?') as k, count(distinct visitor) as v from hv group by 1 order by 2 desc limit 40) x),
    'events', (select coalesce(json_agg(x), '[]') from (
        select path, count(*) as n, count(distinct visitor) as visitors from h where kind = 'event' group by path order by 2 desc limit 25) x),
    'targets', (select coalesce(json_agg(x), '[]') from (
        select path, target, count(*) as n, count(distinct visitor) as visitors from h
        where kind = 'event' and target is not null group by path, target order by 3 desc limit 30) x),
    'loyalty', (select coalesce(json_agg(x order by x.b), '[]') from (
        select case when c = 1 then 1 when c <= 3 then 2 when c <= 7 then 3 else 4 end as b, count(*) as visitors
        from (select visitor, count(*) as c from vd group by visitor) q group by 1) x),
    'durations', (select coalesce(json_agg(x order by x.b), '[]') from (
        select case when seconds < 30 then 1 when seconds < 120 then 2 when seconds < 600 then 3 when seconds < 1800 then 4 else 5 end as b, count(*) as visits
        from vd group by 1) x)
  ) into res;
  return res;
end $$;

-- ---------- En direct : visiteurs présents, activité des 30 dernières minutes, dernières visites (administrateurs seulement)
create or replace function public.visit_live() returns json
language plpgsql stable security definer set search_path = public as $$
declare res json;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select json_build_object(
    'now',     (select count(*) from visit_days where last_seen > now() - interval '2 minutes'),
    'last5',   (select count(*) from visit_days where last_seen > now() - interval '5 minutes'),
    'today',   (select count(*) from visit_days where day = (now() at time zone 'Europe/Paris')::date),
    'minutes', (select json_agg(x order by x.m) from (
        select g as m, count(h.id) as views
        from generate_series(0, 29) g
        left join visit_hits h on h.kind = 'view' and h.at > now() - interval '30 minutes'
          and floor(extract(epoch from (now() - h.at)) / 60) = 29 - g
        group by g) x),
    'recent',  (select coalesce(json_agg(x), '[]') from (
        select at, kind, path, target, is_new, ref, via, lang, mobile, browser, os, tz, left(visitor::text, 4) as who
        from visit_hits order by at desc limit 40) x)
  ) into res;
  return res;
end $$;

revoke all on function public.visit_stats(integer) from public;
revoke all on function public.visit_live() from public;
grant execute on function public.visit_stats(integer) to authenticated;
grant execute on function public.visit_live() to authenticated;
