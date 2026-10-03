-- =====================================================================
--  Notification sur le téléphone à chaque nouvelle visite (application gratuite « ntfy »)
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ».
--  Nécessite visites.sql (version 3) et trmnl-plugin.sql déjà installés.
--
--  À la fin, Supabase affiche le nom de votre « canal » ntfy : abonnez-vous à ce nom dans l'application ntfy.
--  Ce nom fait office de mot de passe : ne le partagez pas.
--  Une « visite » = la première page vue d'un visiteur dans la journée (heure de Paris).
--
--  Couper les notifications :    update public.notify_settings set enabled = false;
--  Les rallumer :                update public.notify_settings set enabled = true;
--  Seulement les nouveaux visiteurs (première visite) :  update public.notify_settings set only_new = true;
-- =====================================================================

-- Outil intégré à Supabase pour envoyer des requêtes web depuis la base
create extension if not exists pg_net;

-- ---------- Réglages : nom du canal (tiré au hasard), marche/arrêt
create table if not exists public.notify_settings (
  id       int primary key default 1 check (id = 1),
  topic    text not null,
  enabled  boolean not null default true,
  only_new boolean not null default false
);
alter table public.notify_settings enable row level security;
revoke all on public.notify_settings from anon, authenticated;
insert into public.notify_settings (id, topic)
values (1, 'palmares-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20))
on conflict (id) do nothing;

-- ---------- Envoi de la notification à la première page vue d'un visiteur dans la journée
create or replace function public.notify_new_visit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s  public.notify_settings;
  t0 timestamptz := (((now() at time zone 'Europe/Paris')::date)::timestamp at time zone 'Europe/Paris');
  src text;
begin
  select * into s from notify_settings where id = 1;
  if s is null or not s.enabled or new.kind <> 'view' then return new; end if;
  if s.only_new and not new.is_new then return new; end if;
  -- déjà vu aujourd'hui : pas de nouvelle notification
  if exists (select 1 from visit_hits where visitor = new.visitor and at >= t0 and id <> new.id) then return new; end if;

  src := case when new.via is not null or new.ref is not null then ' · via ' || trmnl_source_label(new.via, new.ref) else '' end;
  begin
    perform net.http_post(
      url     := 'https://ntfy.sh',
      body    := jsonb_build_object(
        'topic',   s.topic,
        'title',   case when new.is_new then 'Nouveau visiteur sur le Palmarès' else 'Visite sur le Palmarès' end,
        'message', trmnl_flag(new.tz) || ' ' || case when new.mobile then '📱' when new.mobile is false then '💻' else '' end
                   || ' ' || trmnl_tab_label(new.path) || src,
        'tags',    jsonb_build_array(case when new.is_new then 'sparkles' else 'eyes' end),
        'click',   'https://nbbou81000.github.io/trmnl-leaderboard/#stats'),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  exception when others then
    null;   -- une notification ratée ne doit jamais empêcher de compter la visite
  end;
  return new;
end $$;

drop trigger if exists visit_hits_notify on public.visit_hits;
create trigger visit_hits_notify after insert on public.visit_hits
  for each row execute function public.notify_new_visit();

-- ---------- Votre canal ntfy (à saisir dans l'application)
select topic as "Votre canal ntfy (à saisir dans l'application)" from public.notify_settings;
