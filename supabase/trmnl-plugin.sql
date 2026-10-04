-- =====================================================================
--  Statistiques de visite pour votre écran TRMNL (plugin privé)
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ».
--  Nécessite visites.sql (version 3) déjà installé.
--
--  À la fin, Supabase affiche votre jeton secret : copiez-le, il sert dans l'adresse du plugin.
--  Relancer ce fichier ne change pas le jeton. Pour en créer un nouveau (si l'adresse a fuité) :
--    delete from public.stats_feed_token;   puis relancez ce fichier.
-- =====================================================================

-- ---------- Jeton secret : seul qui le connaît peut lire les chiffres
create table if not exists public.stats_feed_token (token text primary key, created_at timestamptz not null default now());
alter table public.stats_feed_token enable row level security;
revoke all on public.stats_feed_token from anon, authenticated;
insert into public.stats_feed_token (token)
select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
where not exists (select 1 from public.stats_feed_token);

-- ---------- Noms lisibles pour l'écran
create or replace function public.trmnl_tab_label(p text) returns text language sql immutable as $$
  select case
    when p like 'article-%' then 'Articles e-ink'
    when p = 'accueil' then 'Accueil'          when p = 'moi' then 'Mon profil'
    when p = 'galerie' then 'Galerie'          when p = 'elaboration' then 'En élaboration'
    when p = 'classements' then 'Classements'  when p = 'createurs' then 'Créateurs'
    when p = 'createur' then 'Fiche créateur'  when p = 'recettes' then 'Recettes'
    when p = 'tendances' then 'Tendances'      when p = 'semaine' then 'Cette semaine'
    when p = 'analyses' then 'Analyses'        when p = 'trmnl' then 'Actu TRMNL'
    when p = 'eink' then 'Actu e-ink'          when p = 'jour' then 'Recette du jour'
    when p = 'pronos' then 'Pronostics'        else initcap(p) end
$$;
create or replace function public.trmnl_source_label(p_via text, p_ref text) returns text language sql immutable as $$
  select case
    when p_via = 'discord' or p_ref like '%discord%' then 'Discord'
    when p_via = 'reddit' or p_ref like '%reddit%' then 'Reddit'
    when p_via = 'bluesky' or p_ref like '%bsky%' then 'Bluesky'
    when p_via = 'x' or p_ref in ('t.co', 'x.com', 'twitter.com') then 'X'
    when p_via = 'mastodon' then 'Mastodon'
    when p_via = 'linkedin' or p_ref like '%linkedin%' then 'LinkedIn'
    when p_via = 'facebook' or p_ref like '%facebook%' then 'Facebook'
    when p_via = 'whatsapp' then 'WhatsApp'
    when p_via in ('lien', 'partage') then 'Lien partagé'
    when p_ref like '%google.%' then 'Google'
    when p_ref like '%bing.%' or p_ref like '%duckduckgo%' or p_ref like '%qwant%' or p_ref like '%ecosia%' then 'Moteur de recherche'
    when p_ref like '%ycombinator%' then 'Hacker News'
    when p_ref like '%github%' then 'GitHub'
    when p_ref like '%trmnl.com%' or p_ref like '%usetrmnl%' then 'trmnl.com'
    when p_via is not null then initcap(p_via)
    when p_ref is not null then p_ref
    else 'Accès direct' end
$$;
create or replace function public.trmnl_country(tz text) returns text language sql immutable as $$
  select coalesce((select c from (values
    ('Europe/Paris','France'),('Europe/Brussels','Belgique'),('Europe/Zurich','Suisse'),('Europe/Luxembourg','Luxembourg'),('Europe/Monaco','Monaco'),
    ('Europe/London','Royaume-Uni'),('Europe/Dublin','Irlande'),('Europe/Berlin','Allemagne'),('Europe/Vienna','Autriche'),('Europe/Amsterdam','Pays-Bas'),
    ('Europe/Madrid','Espagne'),('Europe/Lisbon','Portugal'),('Europe/Rome','Italie'),('Europe/Copenhagen','Danemark'),('Europe/Stockholm','Suède'),
    ('Europe/Oslo','Norvège'),('Europe/Helsinki','Finlande'),('Europe/Warsaw','Pologne'),('Europe/Prague','Tchéquie'),('Europe/Budapest','Hongrie'),
    ('Europe/Athens','Grèce'),('Europe/Kyiv','Ukraine'),('Europe/Kiev','Ukraine'),('Europe/Istanbul','Turquie'),('Europe/Bucharest','Roumanie'),
    ('America/New_York','États-Unis'),('America/Chicago','États-Unis'),('America/Denver','États-Unis'),('America/Phoenix','États-Unis'),
    ('America/Los_Angeles','États-Unis'),('America/Detroit','États-Unis'),('America/Anchorage','États-Unis'),('Pacific/Honolulu','États-Unis'),
    ('America/Toronto','Canada'),('America/Montreal','Canada'),('America/Vancouver','Canada'),('America/Edmonton','Canada'),
    ('America/Mexico_City','Mexique'),('America/Sao_Paulo','Brésil'),('America/Argentina/Buenos_Aires','Argentine'),
    ('Asia/Tokyo','Japon'),('Asia/Seoul','Corée du Sud'),('Asia/Shanghai','Chine'),('Asia/Hong_Kong','Hong Kong'),('Asia/Taipei','Taïwan'),
    ('Asia/Singapore','Singapour'),('Asia/Kolkata','Inde'),('Asia/Calcutta','Inde'),('Asia/Dubai','Émirats'),('Asia/Jerusalem','Israël'),
    ('Australia/Sydney','Australie'),('Australia/Melbourne','Australie'),('Australia/Brisbane','Australie'),('Australia/Perth','Australie'),
    ('Pacific/Auckland','Nouvelle-Zélande'),('Africa/Casablanca','Maroc'),('Africa/Algiers','Algérie'),('Africa/Tunis','Tunisie'),
    ('Africa/Johannesburg','Afrique du Sud'),('Indian/Reunion','La Réunion'),('America/Martinique','Martinique'),('America/Guadeloupe','Guadeloupe')
  ) t(z, c) where z = tz), case when tz is null then 'Inconnu' else replace(split_part(tz, '/', -1), '_', ' ') end)
$$;

-- ---------- Drapeau du pays (déduit du fuseau horaire de l'appareil, sans adresse IP)
create or replace function public.trmnl_flag(tz text) returns text language sql immutable as $$
  select coalesce((select chr(127397 + ascii(substr(cc, 1, 1))) || chr(127397 + ascii(substr(cc, 2, 1))) from (values
    ('Europe/Paris','FR'),('Europe/Brussels','BE'),('Europe/Zurich','CH'),('Europe/Luxembourg','LU'),('Europe/Monaco','MC'),
    ('Europe/London','GB'),('Europe/Dublin','IE'),('Europe/Berlin','DE'),('Europe/Vienna','AT'),('Europe/Amsterdam','NL'),
    ('Europe/Madrid','ES'),('Atlantic/Canary','ES'),('Europe/Lisbon','PT'),('Europe/Rome','IT'),('Europe/Copenhagen','DK'),('Europe/Stockholm','SE'),
    ('Europe/Oslo','NO'),('Europe/Helsinki','FI'),('Europe/Warsaw','PL'),('Europe/Prague','CZ'),('Europe/Budapest','HU'),
    ('Europe/Athens','GR'),('Europe/Kyiv','UA'),('Europe/Kiev','UA'),('Europe/Istanbul','TR'),('Europe/Bucharest','RO'),('Europe/Moscow','RU'),
    ('Europe/Tallinn','EE'),('Europe/Riga','LV'),('Europe/Vilnius','LT'),('Europe/Bratislava','SK'),('Europe/Ljubljana','SI'),('Europe/Zagreb','HR'),
    ('Europe/Belgrade','RS'),('Europe/Sofia','BG'),
    ('America/New_York','US'),('America/Chicago','US'),('America/Denver','US'),('America/Phoenix','US'),('America/Los_Angeles','US'),
    ('America/Detroit','US'),('America/Anchorage','US'),('Pacific/Honolulu','US'),('America/Indiana/Indianapolis','US'),('America/Boise','US'),
    ('America/Toronto','CA'),('America/Montreal','CA'),('America/Vancouver','CA'),('America/Edmonton','CA'),('America/Winnipeg','CA'),('America/Halifax','CA'),
    ('America/Mexico_City','MX'),('America/Sao_Paulo','BR'),('America/Argentina/Buenos_Aires','AR'),('America/Santiago','CL'),('America/Bogota','CO'),('America/Lima','PE'),
    ('Asia/Tokyo','JP'),('Asia/Seoul','KR'),('Asia/Shanghai','CN'),('Asia/Hong_Kong','HK'),('Asia/Taipei','TW'),('Asia/Singapore','SG'),
    ('Asia/Kolkata','IN'),('Asia/Calcutta','IN'),('Asia/Bangkok','TH'),('Asia/Jakarta','ID'),('Asia/Manila','PH'),('Asia/Ho_Chi_Minh','VN'),
    ('Asia/Kuala_Lumpur','MY'),('Asia/Dubai','AE'),('Asia/Jerusalem','IL'),('Asia/Karachi','PK'),
    ('Australia/Sydney','AU'),('Australia/Melbourne','AU'),('Australia/Brisbane','AU'),('Australia/Perth','AU'),('Australia/Adelaide','AU'),
    ('Pacific/Auckland','NZ'),('Africa/Casablanca','MA'),('Africa/Algiers','DZ'),('Africa/Tunis','TN'),('Africa/Dakar','SN'),('Africa/Abidjan','CI'),
    ('Africa/Johannesburg','ZA'),('Africa/Cairo','EG'),('Africa/Lagos','NG'),('Africa/Nairobi','KE'),('Indian/Reunion','RE'),
    ('America/Martinique','MQ'),('America/Guadeloupe','GP'),('America/Cayenne','GF'),('Pacific/Noumea','NC'),('Pacific/Tahiti','PF')
  ) t(z, cc) where z = tz), '🌐')
$$;

-- ---------- Libellés des actions et de leurs cibles (écrans « Dernières visites » et « Actions » du plugin)
create or replace function public.trmnl_event_label(p text) returns text language sql immutable as $$
  select case p
    when 'pronostic' then 'Pronostic' when 'connexion-discord' then 'Connexion Discord'
    when 'actu-eink-lue' then 'Article e-ink lu' when 'actu-eink-partagee' then 'Article partagé'
    when 'recette-partagee' then 'Recette partagée' when 'commentaire-publie' then 'Commentaire publié'
    when 'projet-publie' then 'Projet publié' when 'projet-modifie' then 'Projet modifié' when 'projet-ouvert' then 'Projet ouvert'
    when 'projet-partage' then 'Projet partagé' when 'avancee-publiee' then 'Avancée publiée' when 'reaction' then 'Réaction'
    when 'lien-recette-copie' then 'Lien de recette copié' when 'lien-profil-copie' then 'Lien de profil copié'
    when 'vignette-ouverte' then 'Vignette ouverte' when 'vignette-telechargee' then 'Vignette téléchargée'
    when 'lien-pied-de-page' then 'Lien du pied de page' when 'liaison-demandee' then 'Liaison demandée'
    when 'revendication-ouverte' then 'Revendication ouverte' when 'profil-choisi' then 'Profil choisi'
    when 'bandeau-modifie' then 'Bandeau modifié' when 'langue-en' then 'Site en anglais' when 'langue-fr' then 'Site en français'
    else initcap(replace(p, '-', ' ')) end
$$;
create or replace function public.trmnl_target_label(t text) returns text language sql stable security definer set search_path = public as $$
  select case
    when t is null then null
    when split_part(t, '@', 1) like 'project:%' then coalesce((select name from projects where id::text = split_part(split_part(split_part(t, '@', 1), ':', 2), '.', 1)), 'projet')
    when t like 'recipe:%' then 'recette #' || split_part(split_part(t, ':', 2), '@', 1)
    when t like 'creator:%' then 'profil #' || split_part(split_part(t, ':', 2), '@', 1)
    when t like 'article:%' then 'article e-ink'
    when t like 'link:%' then split_part(split_part(t, ':', 2), '@', 1)
    else t end
    || case when position('@' in t) > 0 and split_part(t, '@', 2) !~ '^[0-9a-f-]+$' then ' · ' || split_part(t, '@', 2) else '' end
$$;

-- ---------- Encodage d'adresse web (pour fabriquer les adresses des graphiques QuickChart)
create or replace function public.trmnl_urlencode(t text) returns text language plpgsql immutable as $$
declare r text := ''; c text; i int;
begin
  for i in 1 .. length(t) loop
    c := substr(t, i, 1);
    if c ~ '[A-Za-z0-9_.~-]' then r := r || c;
    else r := r || upper(regexp_replace(encode(convert_to(c, 'UTF8'), 'hex'), '(..)', '%\1', 'g'));
    end if;
  end loop;
  return r;
end $$;

-- ---------- Le résumé lu par TRMNL toutes les 5 minutes
-- Adresse : https://<projet>.supabase.co/rest/v1/rpc/trmnl_stats?apikey=<clé anon>&p_token=<jeton>
-- p_ts (facultatif, ignoré) : un paramètre qui change à chaque minute oblige un widget de téléphone (KWGT) à recharger au lieu de garder sa copie
drop function if exists public.trmnl_stats(text);
create or replace function public.trmnl_stats(p_token text, p_ts text default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  tzn  text := 'Europe/Paris';
  lnow timestamp := now() at time zone 'Europe/Paris';
  d    date := (now() at time zone 'Europe/Paris')::date;
  t0   timestamptz := (d::timestamp at time zone 'Europe/Paris');
  y0   timestamptz := ((d - 1)::timestamp at time zone 'Europe/Paris');
  w0   timestamptz := ((d - 6)::timestamp at time zone 'Europe/Paris');
  hnow int := extract(hour from (now() at time zone 'Europe/Paris'))::int;
  res  json;
begin
  if p_token is null or not exists (select 1 from stats_feed_token where token = p_token) then raise exception 'Jeton invalide.'; end if;
  with td as (select * from visit_days where day = d),
       hv as (select *, (at at time zone tzn) as lt from visit_hits where kind = 'view' and at >= y0),
       wk as (select * from visit_days where day > d - 7)
  select json_build_object(
    'updated',      to_char(lnow, 'HH24:MI'),
    'date_label',   to_char(lnow, 'DD/MM'),
    'live',         (select count(*) from visit_days where last_seen > now() - interval '2 minutes'),
    'live_5',       (select count(*) from visit_days where last_seen > now() - interval '5 minutes'),
    'today',        (select count(*) from td),
    'today_views',  (select coalesce(sum(views), 0) from td),
    'today_new',    (select count(*) from td where is_new),
    'today_return', (select count(*) from td where not is_new),
    'today_avg',    (select case when a is null then '0 s' when a < 60 then a || ' s' else (a / 60) || ' min ' || lpad((a % 60)::text, 2, '0') end
                     from (select round(avg(seconds) filter (where seconds > 0))::int a from td) q),
    'today_engaged_pct', (select coalesce(round(100.0 * count(*) filter (where views > 1 or seconds >= 30 or events > 0) / nullif(count(*), 0)), 0) from td),
    'today_mobile_pct',  (select coalesce(round(100.0 * count(*) filter (where mobile) / nullif(count(*), 0)), 0) from td),
    'today_events', (select coalesce(sum(events), 0) from td),
    'yesterday',    (select count(*) from visit_days where day = d - 1),
    'yesterday_same_time', (select count(distinct visitor) from hv where at >= y0 and at < now() - interval '1 day'),
    'trend_pct',    (select round(100.0 * ((select count(*) from td) - n) / nullif(n, 0)) from (select count(distinct visitor) n from hv where at >= y0 and at < now() - interval '1 day') q),
    'unique_7',     (select count(distinct visitor) from wk),
    'unique_30',    (select count(distinct visitor) from visit_days where day > d - 30),
    'views_7',      (select coalesce(sum(views), 0) from wk),
    'avg_7',        (select coalesce(round(count(*) / 7.0), 0) from wk),
    'best_day',     (select json_build_object('label', to_char(day, 'DD/MM'), 'visitors', n) from (select day, count(*) n from visit_days where day > d - 30 group by day order by 2 desc, 1 desc limit 1) b),
    'peak_hour',    (select json_build_object('hour', h, 'visitors', n) from (select extract(hour from lt)::int h, count(distinct visitor) n from hv where lt::date = d group by 1 order by 2 desc, 1 limit 1) p),
    'hours', (select json_agg(json_build_object('h', g, 'label', lpad(g::text, 2, '0'),
                 'today', case when g <= hnow then (select count(distinct visitor) from hv where lt::date = d and extract(hour from lt) = g) end,
                 'yesterday', (select count(distinct visitor) from hv where lt::date = d - 1 and extract(hour from lt) = g)) order by g)
              from generate_series(0, 23) g),
    'days', (select json_agg(json_build_object('label', to_char(g, 'DD'), 'dow', (array['lun','mar','mer','jeu','ven','sam','dim'])[extract(isodow from g)::int],
                 'visitors', (select count(*) from visit_days v where v.day = g::date)) order by g)
             from generate_series(d - 13, d, interval '1 day') g),
    'tabs', (select coalesce(json_agg(x), '[]') from (
        select trmnl_tab_label(path) as name, count(*) as views, count(distinct visitor) as visitors
        from hv where lt::date = d group by 1 order by 2 desc limit 6) x),
    'sources', (select coalesce(json_agg(x), '[]') from (
        select trmnl_source_label(via, ref) as name, count(distinct visitor) as visitors
        from wk group by 1 order by 2 desc limit 6) x),
    'slot',         (floor(extract(epoch from now()) / 300)::bigint % 2),
    'new_7',        (select count(distinct visitor) from wk where is_new),
    'returning_pct_7', (select coalesce(round(100.0 * count(distinct visitor) filter (where not is_new) / nullif(count(distinct visitor), 0)), 0) from wk),
    'mobile_pct_7', (select coalesce(round(100.0 * count(*) filter (where mobile) / nullif(count(*), 0)), 0) from wk),
    'engaged_pct_7',(select coalesce(round(100.0 * count(*) filter (where views > 1 or seconds >= 30 or events > 0) / nullif(count(*), 0)), 0) from wk),
    'avg_7_time',   (select case when a is null then '0 s' when a < 60 then a || ' s' else (a / 60) || ' min ' || lpad((a % 60)::text, 2, '0') end
                     from (select round(avg(seconds) filter (where seconds > 0))::int a from wk) q),
    'articles_7',   (select count(*) from visit_hits where kind = 'view' and path like 'article-%' and at >= w0),
    'shares_7',     (select count(*) from visit_hits where kind = 'event' and path in ('actu-eink-partagee', 'recette-partagee', 'lien-recette-copie', 'lien-profil-copie') and at >= w0),
    'signins_7',    (select count(*) from visit_hits where kind = 'event' and path = 'connexion-discord' and at >= w0),
    'langs', (select coalesce(json_agg(x), '[]') from (
        select case lang when 'fr' then 'Français' when 'en' then 'Anglais' else 'Inconnue' end as name,
               round(100.0 * count(*) / sum(count(*)) over ()) as pct
        from wk group by lang order by 2 desc) x),
    'browsers', (select coalesce(json_agg(x), '[]') from (
        select coalesce(browser, 'Inconnu') as name, round(100.0 * count(distinct visitor) / sum(count(distinct visitor)) over ()) as pct
        from visit_hits where kind = 'view' and at >= w0 group by 1 order by 2 desc limit 4) x),
    'oses', (select coalesce(json_agg(x), '[]') from (
        select coalesce(os, 'Inconnu') as name, round(100.0 * count(distinct visitor) / sum(count(distinct visitor)) over ()) as pct
        from visit_hits where kind = 'view' and at >= w0 group by 1 order by 2 desc limit 4) x),
    'tabs_7', (select coalesce(json_agg(x), '[]') from (
        select trmnl_tab_label(path) as name, count(*) as views from visit_hits where kind = 'view' and at >= w0 group by 1 order by 2 desc limit 6) x),
    'countries', (select coalesce(json_agg(x), '[]') from (
        select trmnl_country(tz) as name, count(distinct visitor) as visitors
        from visit_hits where kind = 'view' and at >= w0 group by 1 order by 2 desc limit 6) x)
  ) into res;
  -- Écrans « Activité », « Dernières visites » et « Actions » du plugin
  res := (res::jsonb || jsonb_build_object(
    'slot5', (floor(extract(epoch from now()) / 300)::bigint % 5),
    -- grille jours × heures (4 dernières semaines), niveau 0 à 3 pour les 4 gris de l'OG
    'heat', (select jsonb_agg(row_to_json(r)::jsonb order by r.dw) from (
        select g.dw, (array['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'])[g.dw + 1] as day,
               jsonb_agg(jsonb_build_object('h', g.h, 'n', coalesce(z.n, 0),
                 'lvl', case when coalesce(z.n, 0) = 0 then 0 when z.n::numeric / greatest(1, mx.m) <= .34 then 1 when z.n::numeric / greatest(1, mx.m) <= .67 then 2 else 3 end) order by g.h) as cells
        from (select dw, h from generate_series(0, 6) dw, generate_series(0, 23) h) g
        left join (select extract(isodow from at at time zone tzn)::int - 1 dw, extract(hour from at at time zone tzn)::int h, count(*) n
                   from visit_hits where kind = 'view' and at >= now() - interval '28 days' group by 1, 2) z on z.dw = g.dw and z.h = g.h
        cross join (select max(n) m from (select count(*) n from visit_hits where kind = 'view' and at >= now() - interval '28 days'
                    group by extract(isodow from at at time zone tzn), extract(hour from at at time zone tzn)) q) mx
        group by g.dw) r),
    'durations', (select jsonb_agg(jsonb_build_object('label', l, 'n', coalesce(n, 0)) order by b) from (values (1, 'moins de 30 s'), (2, '30 s à 2 min'), (3, '2 à 10 min'), (4, '10 à 30 min'), (5, 'plus de 30 min')) v(b, l)
        left join (select case when seconds < 30 then 1 when seconds < 120 then 2 when seconds < 600 then 3 when seconds < 1800 then 4 else 5 end bb, count(*) n
                   from visit_days where day > (now() at time zone tzn)::date - 7 group by 1) q on q.bb = v.b),
    'loyalty', (select jsonb_agg(jsonb_build_object('label', l, 'n', coalesce(n, 0)) order by b) from (values (1, '1 jour'), (2, '2 à 3 jours'), (3, '4 à 7 jours'), (4, '8 jours et +')) v(b, l)
        left join (select case when c = 1 then 1 when c <= 3 then 2 when c <= 7 then 3 else 4 end bb, count(*) n
                   from (select visitor, count(*) c from visit_days where day > (now() at time zone tzn)::date - 30 group by visitor) x group by 1) q on q.bb = v.b),
    'targets_7', (select coalesce(jsonb_agg(x), '[]') from (
        select trmnl_event_label(path) as action, trmnl_target_label(target) as what, count(*) as n, count(distinct visitor) as visitors
        from visit_hits where kind = 'event' and target is not null and at >= w0 group by path, target order by 3 desc, 4 desc limit 8) x),
    'events_7', (select coalesce(jsonb_agg(x), '[]') from (
        select trmnl_event_label(path) as action, count(*) as n, count(distinct visitor) as visitors
        from visit_hits where kind = 'event' and at >= w0 group by path order by 2 desc limit 8) x),
    'tabs_all', (select coalesce(jsonb_agg(x), '[]') from (
        select trmnl_tab_label(path) as name, count(*) as views, count(distinct visitor) as visitors
        from visit_hits where kind = 'view' and at >= w0 group by 1 order by 2 desc limit 12) x),
    'recent_rows', (select coalesce(jsonb_agg(x order by x.at desc), '[]') from (
        select h.at, to_char(h.at at time zone tzn, 'HH24:MI:SS') as time, left(h.visitor::text, 4) as who, h.is_new as new, h.kind = 'event' as event,
               case when h.kind = 'event' then trmnl_event_label(h.path) else trmnl_tab_label(h.path) end as what,
               trmnl_target_label(h.target) as target,
               case when h.mobile then 'Mobile' when h.mobile is false then 'PC' else '' end as device,
               concat_ws(' · ', h.browser, h.os) as agent, trmnl_country(h.tz) as country,
               case when h.via is not null or h.ref is not null then trmnl_source_label(h.via, h.ref) else '' end as source
        from visit_hits h order by h.at desc limit 13) x)
  ))::json;

  -- Analyse automatique : quelques constats en français, de plus en plus fins à mesure que les données s'accumulent
  res := (res::jsonb || jsonb_build_object('insights', (
    with h28 as (select *, at at time zone tzn as lt from visit_hits where kind = 'view' and at >= now() - interval '28 days'),
         vd28 as (select * from visit_days where day > (now() at time zone tzn)::date - 28),
         ndays as (select count(distinct day) n from vd28),
         slot as (select (array['le lundi','le mardi','le mercredi','le jeudi','le vendredi','le samedi','le dimanche'])[extract(isodow from lt)::int] dname,
                         (floor(extract(hour from lt) / 3) * 3)::int b, count(*) n
                  from h28 group by 1, 2 order by 3 desc limit 1),
         dev as (select round(100.0 * count(*) filter (where mobile and (extract(hour from lt) >= 19 or extract(hour from lt) < 2)) / nullif(count(*) filter (where extract(hour from lt) >= 19 or extract(hour from lt) < 2), 0) ) evep,
                        round(100.0 * count(*) filter (where mobile and extract(hour from lt) between 8 and 18) / nullif(count(*) filter (where extract(hour from lt) between 8 and 18), 0)) dayp
                 from h28),
         tm as (select round(avg(seconds) filter (where mobile and seconds > 0)) m, round(avg(seconds) filter (where mobile is false and seconds > 0)) p from vd28),
         wk2 as (select count(distinct visitor) filter (where day > (now() at time zone tzn)::date - 7) a,
                        count(distinct visitor) filter (where day <= (now() at time zone tzn)::date - 7 and day > (now() at time zone tzn)::date - 14) b from visit_days),
         src as (select trmnl_source_label(via, ref) s, count(distinct visitor) n from vd28 where via is not null or ref is not null group by 1 order by 2 desc limit 1),
         ctry as (select string_agg(c, ', ') c from (select trmnl_country(tz) c from h28 where tz is not null group by 1 order by count(distinct visitor) desc limit 2) x),
         tab as (select trmnl_tab_label(path) t from h28 where path not like 'article-%' group by 1 order by count(*) desc limit 1)
    select coalesce(jsonb_agg(line) filter (where line is not null), '[]') from (values
      ((select 'Créneau le plus actif : ' || dname || ' entre ' || b || ' h et ' || case when b + 3 = 24 then 'minuit' else (b + 3) || ' h' end || '.' from slot where n >= 3)),
      ((select case when evep is not null and dayp is not null and abs(evep - dayp) >= 15
                    then 'Le soir, ' || evep || ' % des visites se font sur mobile, contre ' || dayp || ' % en journée.'
                    when evep is not null and dayp is not null then 'Mobile : ' || round((evep + dayp) / 2) || ' % des visites, le soir comme en journée.' end from dev)),
      ((select case when m is not null and p is not null then 'Durée moyenne : ' || replace(round(p / 60.0, 1)::text, '.', ',') || ' min sur ordinateur, ' || replace(round(m / 60.0, 1)::text, '.', ',') || ' min sur mobile.' end from tm)),
      ((select case when (res->>'today')::int > 0 then (res->>'today_return') || ' visiteur(s) sur ' || (res->>'today') || ' aujourd''hui étaient déjà venus.' end)),
      ((select case when (select n from ndays) >= 14 and b > 0 then 'Cette semaine : ' || case when a >= b then '+' else '' end || round(100.0 * (a - b) / b) || ' % de visiteurs par rapport à la précédente.'
                    when (select n from ndays) < 14 then 'Comparaison d''une semaine à l''autre possible dans ' || (14 - (select n from ndays)) || ' jour(s).' end from wk2)),
      ((select 'Première source identifiée : ' || s || ' (' || n || ' visiteur' || case when n > 1 then 's' else '' end || ').' from src)),
      ((select 'Pays en tête : ' || c || '.' from ctry where c is not null)),
      ((select 'Onglet préféré : ' || t || '.' from tab))
    ) v(line)
  )))::json;

  -- Mini-graphiques en caractères (▁▂▃▄▅▆▇█) : visiteurs par heure aujourd'hui, et par jour sur 14 jours
  res := (res::jsonb || jsonb_build_object(
    'spark_hours', (select string_agg(case when (h->>'today') is null then '·'
                      else substr('▁▂▃▄▅▆▇█', 1 + least(7, floor(8 * (h->>'today')::numeric / greatest(1, m.mx + 0.01)))::int, 1) end, '' order by (h->>'h')::int)
                    from json_array_elements(res->'hours') h,
                         (select max((x->>'today')::int) mx from json_array_elements(res->'hours') x) m),
    'spark_days',  (select string_agg(substr('▁▂▃▄▅▆▇█', 1 + least(7, floor(8 * (dd->>'visitors')::numeric / greatest(1, m.mx + 0.01)))::int, 1), '' order by ord)
                    from json_array_elements(res->'days') with ordinality as t(dd, ord),
                         (select max((x->>'visitors')::int) mx from json_array_elements(res->'days') x) m)))::json;
  -- Carte pour le widget de téléphone (KWGT : $wg("adresse", json, ".card")$), avec couleurs [c=…] et gras [b]
  res := (res::jsonb || jsonb_build_object('card', format(
    E'visiteurs aujourd''hui%s\n[c=#FFB59E]%s[/c]  [c=#9AA0A6]par heure[/c]\n[c=#8AB4F8]%s[/c]  [c=#9AA0A6]14 jours[/c]\n[c=#5BD68C]●[/c] %s en ligne · [b]%s[/b] sur 7 j · %s pages\n[c=#9AA0A6]mis à jour à %s[/c]',
    case when res->>'trend_pct' is null then '' else '  ' || case when (res->>'trend_pct')::int >= 0 then '[c=#5BD68C]▲ +' else '[c=#F28B82]▼ ' end || (res->>'trend_pct') || ' %[/c]' end,
    res->>'spark_hours', res->>'spark_days', res->>'live', res->>'unique_7', res->>'today_views', res->>'updated')))::json;
  -- Graphiques en image (service gratuit QuickChart, qui ne reçoit que des totaux) pour un widget de téléphone :
  -- KWGT : objet Image, source = $wg("adresse", json, ".chart_hours")$ ou ".chart_heat"
  res := (res::jsonb || jsonb_build_object(
    'chart_hours', 'https://quickchart.io/chart?v=4&w=520&h=260&devicePixelRatio=3&bkg=transparent&c=' || trmnl_urlencode(format(
      $c${type:'line',data:{labels:%s,datasets:[{label:"Aujourd'hui",data:%s,borderColor:'#FF7A63',backgroundColor:'rgba(255,122,99,.28)',fill:true,tension:.35,borderWidth:5,pointRadius:0},{label:'Hier',data:%s,borderColor:'#8C9BFF',borderWidth:3,borderDash:[8,6],tension:.35,pointRadius:0,fill:false}]},options:{plugins:{legend:{position:'top',align:'end',labels:{color:'#E8EAED',font:{size:22,weight:'500'},boxWidth:18,boxHeight:18,padding:12}}},layout:{padding:{right:8,left:2}},scales:{x:{ticks:{color:'#C9CDD2',font:{size:22},maxRotation:0,autoSkip:false,callback:(v,i)=>i%%6?'':i+'h'},grid:{display:false},border:{color:'rgba(255,255,255,.25)'}},y:{beginAtZero:true,ticks:{color:'#C9CDD2',font:{size:22},precision:0,maxTicksLimit:4},grid:{color:'rgba(255,255,255,.10)'},border:{display:false}}}}}$c$,
      (select json_agg((h->>'label') || 'h' order by (h->>'h')::int) from json_array_elements(res->'hours') h),
      (select json_agg((h->'today') order by (h->>'h')::int) from json_array_elements(res->'hours') h),
      (select json_agg((h->'yesterday') order by (h->>'h')::int) from json_array_elements(res->'hours') h))),
    'chart_heat', (select 'https://quickchart.io/chart?v=4&w=520&h=230&bkg=transparent&c=' || trmnl_urlencode(format(
      $c${type:'scatter',data:{datasets:[{data:[%s],pointStyle:'rectRounded',pointRadius:8.5,pointHoverRadius:8.5,backgroundColor:(c)=>{const v=c.raw.v;return v?'rgba(255,122,99,'+(0.18+0.82*v/%s)+')':'rgba(255,255,255,.12)'}}]},options:{plugins:{legend:{display:false}},layout:{padding:{left:0,right:6,top:6,bottom:0}},scales:{x:{type:'category',labels:['0','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23'],offset:true,ticks:{color:'#C9CDD2',font:{size:22},autoSkip:false,maxRotation:0,callback:(v,i)=>i%%6?'':i+'h'},grid:{display:false},border:{display:false}},y:{type:'category',labels:['Lu','Ma','Me','Je','Ve','Sa','Di'],offset:true,ticks:{color:'#C9CDD2',font:{size:20},autoSkip:false},grid:{display:false},border:{display:false}}}}}$c$,
      string_agg(format($p${x:'%s',y:'%s',v:%s}$p$, g.h, (array['Lu','Ma','Me','Je','Ve','Sa','Di'])[g.dw + 1], coalesce(z.n, 0)), ',' order by g.dw, g.h),
      greatest(1, max(coalesce(z.n, 0)))))
      from (select dw, h from generate_series(0, 6) dw, generate_series(0, 23) h) g
      left join (select extract(isodow from at at time zone tzn)::int - 1 dw, extract(hour from at at time zone tzn)::int h, count(*) n
                 from visit_hits where kind = 'view' and at >= now() - interval '28 days' group by 1, 2) z on z.dw = g.dw and z.h = g.h)))::json;
  -- Dernières visites, une par ligne : heure, drapeau, appareil, onglet (KWGT : $wg("adresse", json, ".recent")$)
  res := (res::jsonb || jsonb_build_object('recent', (select coalesce(string_agg(
      format('[c=#9AA0A6]%s[/c]  %s %s  %s%s', to_char(at at time zone tzn, 'HH24:MI'), trmnl_flag(tz),
        case when mobile then '📱' when mobile is false then '💻' else '·' end,
        case when kind = 'event' then '[c=#FFB59E]⚡ ' || case path
            when 'pronostic' then 'Pronostic' when 'connexion-discord' then 'Connexion Discord'
            when 'actu-eink-partagee' then 'Article partagé' when 'actu-eink-lue' then 'Article lu'
            when 'recette-partagee' then 'Recette partagée' when 'commentaire-publie' then 'Commentaire'
            when 'projet-publie' then 'Projet publié' when 'lien-recette-copie' then 'Lien de recette copié'
            when 'liaison-demandee' then 'Demande de liaison' when 'lien-profil-copie' then 'Lien de profil copié'
            when 'projet-ouvert' then 'Projet ouvert' when 'projet-partage' then 'Projet partagé' when 'reaction' then 'Réaction'
            when 'avancee-publiee' then 'Avancée publiée' when 'vignette-ouverte' then 'Vignette ouverte'
            when 'vignette-telechargee' then 'Vignette téléchargée' when 'lien-pied-de-page' then 'Lien du pied de page'
            when 'revendication-ouverte' then 'Revendication ouverte' when 'profil-choisi' then 'Profil choisi'
            else initcap(replace(path, '-', ' ')) end || '[/c]'
          else trmnl_tab_label(path) end,
        case when is_new and kind = 'view' then '  [c=#5BD68C]nouveau[/c]' else '' end),
      E'\n' order by at desc), 'Aucune visite pour l''instant')
    from (select * from visit_hits where kind = 'view' or path not in ('actu-eink-lue') order by at desc limit 12) r)))::json;
  -- Résumé déjà rédigé, pour un widget de téléphone qui n'affiche qu'un seul texte (KWGT : $wg("adresse", json, ".text")$)
  res := (res::jsonb || jsonb_build_object('text',
    format(E'● %s en ligne\n%s visiteurs aujourd''hui%s\n%s sur 7 jours · %s pages vues\nmàj %s',
      res->>'live', res->>'today',
      case when res->>'trend_pct' is null then '' else ' (' || case when (res->>'trend_pct')::int > 0 then '+' else '' end || (res->>'trend_pct') || ' %)' end,
      res->>'unique_7', res->>'today_views', res->>'updated')))::json;
  return res;
end $$;

revoke all on function public.trmnl_stats(text, text) from public;
grant execute on function public.trmnl_stats(text, text) to anon, authenticated;

-- ---------- Votre jeton (à copier dans l'adresse du plugin)
select token as "Votre jeton secret pour TRMNL" from public.stats_feed_token;

-- ---------- Version allégée pour le plugin TRMNL : seulement ce que l'écran affiche
-- (sans les graphiques, cartes et listes prévus pour les widgets de téléphone)
-- Adresse : https://<projet>.supabase.co/rest/v1/rpc/trmnl_plugin?apikey=<clé anon>&p_token=<jeton>
create or replace function public.trmnl_plugin(p_token text) returns json
language sql stable security definer set search_path = public as $$
  select (public.trmnl_stats(p_token)::jsonb
          - 'chart_hours' - 'chart_heat' - 'recent' - 'card' - 'text' - 'spark_hours' - 'spark_days' - 'tabs')::json
$$;
revoke all on function public.trmnl_plugin(text) from public;
grant execute on function public.trmnl_plugin(text) to anon, authenticated;
