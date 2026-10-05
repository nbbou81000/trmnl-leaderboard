-- =====================================================================
--  Espace d'administration du site (adresse #admin, bouton « 🛠️ Administration »)
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ».
--  Peut être relancé sans risque. Nécessite schema4.sql déjà installé.
--  ⚠ Si vous relancez un jour schema4.sql, relancez admin.sql juste après
--    (schema4.sql remet la règle d'envoi d'images sans l'interrupteur).
--
--  Contenu :
--   1. Interrupteurs d'urgence : couper commentaires, projets, images, réactions ou pronostics
--   2. Règles de contenu : masquer un article e-ink, bloquer une source, retirer une recette
--      ou un créateur du palmarès, imposer la recette du jour
--   3. Journal de modération : qui a masqué, supprimé, bloqué ou modifié quoi, et quand
--   4. Liste des membres et tableau de bord « santé » (réservés à l'administrateur)
-- =====================================================================


-- =====================================================================
-- 1. INTERRUPTEURS D'URGENCE
-- =====================================================================
create table if not exists public.site_switches (
  id          int primary key default 1 check (id = 1),
  comments    boolean not null default true,   -- commentaires
  projects    boolean not null default true,   -- nouveaux projets et nouvelles avancées
  uploads     boolean not null default true,   -- envoi de captures d'écran
  reactions   boolean not null default true,   -- réactions en émojis
  predictions boolean not null default true,   -- nouveaux pronostics
  note_fr     text not null default '' check (char_length(note_fr) <= 200),
  note_en     text not null default '' check (char_length(note_en) <= 200),
  updated_at  timestamptz not null default now()
);
insert into public.site_switches (id) values (1) on conflict (id) do nothing;
alter table public.site_switches enable row level security;
drop policy if exists "switches are public" on public.site_switches;
create policy "switches are public" on public.site_switches for select using (true);
revoke insert, update, delete on public.site_switches from anon, authenticated;

create or replace function public.switch_on(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case k when 'comments' then comments when 'projects' then projects when 'uploads' then uploads
                                  when 'reactions' then reactions when 'predictions' then predictions end
                   from public.site_switches where id = 1), true)
$$;

create or replace function public.set_switches(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.site_switches set
    comments    = coalesce((p->>'comments')::boolean, comments),
    projects    = coalesce((p->>'projects')::boolean, projects),
    uploads     = coalesce((p->>'uploads')::boolean, uploads),
    reactions   = coalesce((p->>'reactions')::boolean, reactions),
    predictions = coalesce((p->>'predictions')::boolean, predictions),
    note_fr     = left(coalesce(p->>'note_fr', note_fr), 200),
    note_en     = left(coalesce(p->>'note_en', note_en), 200),
    updated_at  = now()
  where id = 1;
end $$;

-- Blocage côté serveur : même en contournant le site, rien ne passe quand l'interrupteur est coupé
-- (noms en « a_ » : vérifiés avant les autres contrôles, qui sont lancés par ordre alphabétique)
create or replace function public.pause_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or public.switch_on(tg_argv[0]) then return new; end if;
  raise exception 'Paused by the site admin: this feature is temporarily unavailable.';
end $$;

drop trigger if exists a_pause_comments on public.comments;
create trigger pause_comments before insert on public.comments for each row execute function public.pause_guard('comments');
drop trigger if exists a_pause_projects on public.projects;
create trigger pause_projects before insert on public.projects for each row execute function public.pause_guard('projects');
drop trigger if exists a_pause_updates on public.updates;
create trigger pause_updates before insert on public.updates for each row execute function public.pause_guard('projects');
drop trigger if exists a_pause_predictions on public.predictions;
create trigger pause_predictions before insert on public.predictions for each row execute function public.pause_guard('predictions');
do $$ begin
  if to_regclass('public.reactions') is not null then
    execute 'drop trigger if exists a_pause_reactions on public.reactions';
    execute 'create trigger pause_reactions before insert on public.reactions for each row execute function public.pause_guard(''reactions'')';
  end if;
end $$;

-- Envoi d'images : même règle qu'avant (dans son propre dossier, compte non bloqué) + l'interrupteur
drop policy if exists "users upload in own folder" on storage.objects;
create policy "users upload in own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'wip' and (storage.foldername(name))[1] = auth.uid()::text and not public.is_banned()
              and (public.is_admin() or public.switch_on('uploads')));


-- =====================================================================
-- 2. RÈGLES DE CONTENU
--    Appliquées par le site (articles masqués : tout de suite) et par la mise à jour horaire
--    (classements, recette du jour, actu e-ink : au prochain passage).
-- =====================================================================
create table if not exists public.content_rules (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('article', 'source', 'recipe', 'creator', 'spotlight')),
  target     text not null check (char_length(target) between 1 and 120),
  day        date,                                           -- recette du jour imposée : le jour concerné
  note       text not null default '' check (char_length(note) <= 200),   -- note privée, jamais publiée
  created_at timestamptz not null default now(),
  check ((kind = 'spotlight') = (day is not null))
);
create unique index if not exists content_rules_once on public.content_rules (kind, target) where kind <> 'spotlight';
create unique index if not exists content_rules_one_pin on public.content_rules (day) where kind = 'spotlight';
alter table public.content_rules enable row level security;
revoke all on public.content_rules from anon, authenticated;

-- Version publique (sans les notes), lue par le site et par la mise à jour horaire
create or replace function public.public_rules() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('kind', kind, 'target', target, 'day', day) order by id), '[]'::json)
  from public.content_rules
  where kind <> 'spotlight' or day >= (now() at time zone 'utc')::date - 1
$$;

create or replace function public.rules_list() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return (select coalesce(json_agg(r order by r.kind, r.day desc nulls last, r.created_at desc), '[]'::json)
          from (select id, kind, target, day, note, created_at from public.content_rules) r);
end $$;

create or replace function public.rule_add(p_kind text, p_target text, p_day date default null, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_kind = 'spotlight' then
    delete from public.content_rules where kind = 'spotlight' and day = p_day;
    insert into public.content_rules (kind, target, day, note) values (p_kind, btrim(p_target), p_day, left(coalesce(p_note, ''), 200));
  else
    insert into public.content_rules (kind, target, note) values (p_kind, btrim(p_target), left(coalesce(p_note, ''), 200))
    on conflict (kind, target) where kind <> 'spotlight' do update set note = excluded.note;
  end if;
end $$;

create or replace function public.rule_remove(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  delete from public.content_rules where id = p_id;
end $$;


-- =====================================================================
-- 3. JOURNAL DE MODÉRATION
--    Rempli automatiquement quand un administrateur agit. Conservé un an.
-- =====================================================================
create table if not exists public.admin_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  actor_name text not null default '',
  action     text not null,
  target     text not null default '',
  detail     text not null default ''
);
create index if not exists admin_log_at on public.admin_log (at desc);
alter table public.admin_log enable row level security;
revoke all on public.admin_log from anon, authenticated;

create or replace function public.log_admin(p_action text, p_target text default '', p_detail text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_log (actor, actor_name, action, target, detail)
  values (auth.uid(), coalesce((select name from public.profiles where id = auth.uid()), ''), p_action,
          left(coalesce(p_target, ''), 200), left(coalesce(p_detail, ''), 300));
  if random() < 0.02 then delete from public.admin_log where at < now() - interval '365 days'; end if;
end $$;
revoke all on function public.log_admin(text, text, text) from public, anon, authenticated;

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  -- Seules les actions d'un administrateur connecté sont journalisées
  if auth.uid() is null or not public.is_admin() then return null; end if;

  if tg_table_name = 'profiles' then
    who := coalesce(nullif(new.name, ''), left(new.id::text, 8));
    if new.banned is distinct from old.banned then
      perform log_admin(case when new.banned then 'Membre bloqué' else 'Membre débloqué' end, who);
    end if;
    if new.creator_status is distinct from old.creator_status and old.creator_status = 'pending' then
      perform log_admin(case when new.creator_status = 'verified' then 'Liaison de profil validée' else 'Liaison de profil refusée' end,
                        who, 'créateur #' || coalesce(old.creator_id, '?'));
    end if;

  elsif tg_table_name = 'projects' then
    if tg_op = 'UPDATE' and new.hidden is distinct from old.hidden then
      perform log_admin(case when new.hidden then 'Projet masqué' else 'Projet réaffiché' end, old.name);
    elsif tg_op = 'DELETE' and old.owner is distinct from auth.uid() then
      perform log_admin('Projet supprimé', old.name, 'auteur : ' || coalesce((select name from profiles where id = old.owner), '?'));
    end if;

  elsif tg_table_name = 'updates' then
    if old.owner is distinct from auth.uid() and exists (select 1 from projects where id = old.project_id) then
      perform log_admin('Avancée supprimée', coalesce((select name from projects where id = old.project_id), '?'), left(old.body, 120));
    end if;

  elsif tg_table_name = 'comments' then
    if tg_op = 'UPDATE' and new.hidden is distinct from old.hidden then
      perform log_admin(case when new.hidden then 'Commentaire masqué' else 'Commentaire réaffiché' end,
                        coalesce((select name from profiles where id = old.author), '?'), left(old.body, 120));
    elsif tg_op = 'DELETE' and old.author is distinct from auth.uid() and exists (select 1 from projects where id = old.project_id) then
      perform log_admin('Commentaire supprimé', coalesce((select name from profiles where id = old.author), '?'), left(old.body, 120));
    end if;

  elsif tg_table_name = 'reports' then
    -- signalement classé (pas ceux effacés avec le contenu signalé)
    if (old.comment_id is null or exists (select 1 from comments where id = old.comment_id))
       and (old.project_id is null or exists (select 1 from projects where id = old.project_id)) then
      perform log_admin('Signalement classé', case when old.comment_id is not null then 'commentaire #' || old.comment_id else 'projet #' || old.project_id end, old.reason);
    end if;

  elsif tg_table_name = 'predictions' then
    if old.user_id is distinct from auth.uid() then
      perform log_admin('Pronostic supprimé', coalesce((select name from profiles where id = old.user_id), '?'), 'recette #' || old.recipe_id);
    end if;

  elsif tg_table_name = 'site_settings' then
    perform log_admin('Bandeau d''accueil modifié', case when new.enabled then 'visible' else 'masqué' end);

  elsif tg_table_name = 'site_switches' then
    perform log_admin('Interrupteurs modifiés',
      concat_ws(' · ',
        case when new.comments is distinct from old.comments then 'commentaires ' || case when new.comments then 'ON' else 'OFF' end end,
        case when new.projects is distinct from old.projects then 'projets ' || case when new.projects then 'ON' else 'OFF' end end,
        case when new.uploads is distinct from old.uploads then 'images ' || case when new.uploads then 'ON' else 'OFF' end end,
        case when new.reactions is distinct from old.reactions then 'réactions ' || case when new.reactions then 'ON' else 'OFF' end end,
        case when new.predictions is distinct from old.predictions then 'pronostics ' || case when new.predictions then 'ON' else 'OFF' end end),
      nullif(new.note_fr, ''));

  elsif tg_table_name = 'content_rules' then
    if tg_op = 'INSERT' then
      perform log_admin('Règle ajoutée', new.kind || ' : ' || new.target || coalesce(' (' || new.day || ')', ''), new.note);
    else
      perform log_admin('Règle retirée', old.kind || ' : ' || old.target || coalesce(' (' || old.day || ')', ''), old.note);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after update on public.profiles for each row execute function public.audit_trigger();
drop trigger if exists audit_projects on public.projects;
create trigger audit_projects after update or delete on public.projects for each row execute function public.audit_trigger();
drop trigger if exists audit_updates on public.updates;
create trigger audit_updates after delete on public.updates for each row execute function public.audit_trigger();
drop trigger if exists audit_comments on public.comments;
create trigger audit_comments after update or delete on public.comments for each row execute function public.audit_trigger();
drop trigger if exists audit_reports on public.reports;
create trigger audit_reports after delete on public.reports for each row execute function public.audit_trigger();
drop trigger if exists audit_predictions on public.predictions;
create trigger audit_predictions after delete on public.predictions for each row execute function public.audit_trigger();
drop trigger if exists audit_site_settings on public.site_settings;
create trigger audit_site_settings after update on public.site_settings for each row execute function public.audit_trigger();
drop trigger if exists audit_site_switches on public.site_switches;
create trigger audit_site_switches after update on public.site_switches for each row execute function public.audit_trigger();
drop trigger if exists audit_content_rules on public.content_rules;
create trigger audit_content_rules after insert or delete on public.content_rules for each row execute function public.audit_trigger();

create or replace function public.admin_log_list(p_limit integer default 200) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return (select coalesce(json_agg(l order by l.at desc), '[]'::json)
          from (select at, actor_name, action, target, detail from public.admin_log
                order by at desc limit greatest(1, least(coalesce(p_limit, 200), 1000))) l);
end $$;


-- =====================================================================
-- 4. MEMBRES ET SANTÉ (lecture seule, administrateur uniquement)
-- =====================================================================
create or replace function public.admin_members() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return (select coalesce(json_agg(m order by m.last_seen desc nulls last), '[]'::json) from (
    select p.id, p.name, p.avatar, p.is_admin, p.banned, p.creator_id, p.creator_status, p.created_at,
           u.last_sign_in_at as last_seen,
           (select count(*) from projects x where x.owner = p.id)::int as projects,
           (select count(*) from comments x where x.author = p.id)::int as comments,
           (select count(*) from predictions x where x.user_id = p.id)::int as predictions,
           greatest((select max(created_at) from comments x where x.author = p.id),
                    (select max(created_at) from updates x where x.owner = p.id),
                    (select max(created_at) from projects x where x.owner = p.id),
                    (select max(created_at) from predictions x where x.user_id = p.id)) as last_action
    from profiles p left join auth.users u on u.id = p.id) m);
end $$;

create or replace function public.admin_health() returns json
language plpgsql stable security definer set search_path = public as $$
declare st json; tb json; visits bigint := null;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  begin
    select json_build_object('bytes', coalesce(sum((metadata->>'size')::bigint), 0), 'files', count(*))
      into st from storage.objects where bucket_id = 'wip';
  exception when others then st := null; end;
  if to_regclass('public.visit_hits') is not null then
    execute 'select count(*) from public.visit_hits' into visits;
  end if;
  select coalesce(json_agg(t), '[]'::json) into tb from (
    select c.relname as name, pg_total_relation_size(c.oid) as bytes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by pg_total_relation_size(c.oid) desc limit 8) t;
  return json_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage', st,
    'tables', tb,
    'members', (select count(*) from profiles),
    'banned', (select count(*) from profiles where banned),
    'pending_links', (select count(*) from profiles where creator_status = 'pending'),
    'projects', (select count(*) from projects),
    'hidden_projects', (select count(*) from projects where hidden),
    'updates', (select count(*) from updates),
    'comments', (select count(*) from comments),
    'hidden_comments', (select count(*) from comments where hidden),
    'reports', (select count(*) from reports),
    'predictions', (select count(*) from predictions),
    'visit_rows', visits,
    'log_last', (select max(at) from admin_log));
end $$;


-- =====================================================================
-- Droits
-- =====================================================================
revoke all on function public.switch_on(text) from public;
revoke all on function public.set_switches(jsonb) from public;
revoke all on function public.public_rules() from public;
revoke all on function public.rules_list() from public;
revoke all on function public.rule_add(text, text, date, text) from public;
revoke all on function public.rule_remove(bigint) from public;
revoke all on function public.admin_log_list(integer) from public;
revoke all on function public.admin_members() from public;
revoke all on function public.admin_health() from public;
grant execute on function public.switch_on(text) to anon, authenticated;
grant execute on function public.public_rules() to anon, authenticated;
grant execute on function public.set_switches(jsonb) to authenticated;
grant execute on function public.rules_list() to authenticated;
grant execute on function public.rule_add(text, text, date, text) to authenticated;
grant execute on function public.rule_remove(bigint) to authenticated;
grant execute on function public.admin_log_list(integer) to authenticated;
grant execute on function public.admin_members() to authenticated;
grant execute on function public.admin_health() to authenticated;

select 'Espace d''administration installé ✔' as "Résultat";
