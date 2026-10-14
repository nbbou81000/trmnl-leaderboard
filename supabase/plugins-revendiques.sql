-- =====================================================================
--  Plugins TRMNL (trmnl.com/integrations/…) revendiqués par leurs créateurs
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ».
--  Nécessite schema4.sql, admin.sql et plugins-publies.sql. Peut être relancé sans risque.
--
--  Un créateur dont la liaison Discord est vérifiée demande à rattacher un plugin à son profil
--  (depuis « Mon profil », ou en déclarant son projet publié comme plugin). L'administrateur valide.
--  Une fois validé, le relevé horaire lit le nombre de connexions sur la page publique du plugin,
--  qui compte alors dans les points du créateur, comme une recette.
-- =====================================================================

create table if not exists public.creator_plugins (
  slug         text primary key check (slug ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  creator_id   text not null check (creator_id ~ '^[0-9]{1,10}$'),
  status       text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  requested_by uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
alter table public.creator_plugins enable row level security;
revoke all on public.creator_plugins from anon, authenticated;
grant select on public.creator_plugins to anon, authenticated;
drop policy if exists "plugins valides publics" on public.creator_plugins;
create policy "plugins valides publics" on public.creator_plugins for select using (status = 'verified');

-- ---------- Demande (créateur vérifié uniquement)
create or replace function public.plugin_claim(p_slug text) returns text
language plpgsql security definer set search_path = public as $$
declare cid text; cur creator_plugins;
begin
  if public.is_banned() then raise exception 'Your account is blocked.'; end if;
  select creator_id into cid from profiles where id = auth.uid() and creator_status = 'verified';
  if cid is null then raise exception 'Link your creator number first.'; end if;
  p_slug := lower(btrim(coalesce(p_slug, '')));
  if p_slug !~ '^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'Invalid plugin link.'; end if;
  select * into cur from creator_plugins where slug = p_slug;
  if found and cur.status = 'verified' and cur.creator_id <> cid then raise exception 'This plugin is already linked to another creator.'; end if;
  if found and cur.status = 'verified' then return 'verified'; end if;
  if not public.is_admin() and (select count(*) from creator_plugins where creator_id = cid and status = 'pending') >= 5 then
    raise exception 'You already have 5 plugins awaiting review.';
  end if;
  insert into creator_plugins (slug, creator_id, status, requested_by) values (p_slug, cid, 'pending', auth.uid())
  on conflict (slug) do update set creator_id = excluded.creator_id, status = 'pending', requested_by = excluded.requested_by,
                                   created_at = now(), decided_at = null;
  return 'pending';
end $$;
revoke all on function public.plugin_claim(text) from public;
grant execute on function public.plugin_claim(text) to authenticated;

-- ---------- Mes plugins (validés, en attente ou refusés)
create or replace function public.plugin_mine() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.created_at desc), '[]') from (
    select slug, status, created_at, decided_at from creator_plugins
    where creator_id = (select creator_id from profiles where id = auth.uid() and creator_status = 'verified')) x
$$;
revoke all on function public.plugin_mine() from public;
grant execute on function public.plugin_mine() to authenticated;

-- ---------- Retrait par le créateur lui-même
create or replace function public.plugin_unclaim(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from creator_plugins where slug = p_slug
    and creator_id = (select creator_id from profiles where id = auth.uid() and creator_status = 'verified');
end $$;
revoke all on function public.plugin_unclaim(text) from public;
grant execute on function public.plugin_unclaim(text) to authenticated;

-- ---------- Administrateur : demandes en attente, validation, refus
create or replace function public.plugin_pending() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return (select coalesce(json_agg(x order by x.created_at), '[]') from (
    select c.slug, c.creator_id, c.created_at, p.name, p.avatar from creator_plugins c left join profiles p on p.id = c.requested_by
    where c.status = 'pending') x);
end $$;
revoke all on function public.plugin_pending() from public;
grant execute on function public.plugin_pending() to authenticated;

create or replace function public.plugin_decide(p_slug text, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare cid text;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update creator_plugins set status = case when p_ok then 'verified' else 'rejected' end, decided_at = now()
  where slug = p_slug returning creator_id into cid;
  perform log_admin(case when p_ok then 'Plugin validé' else 'Plugin refusé' end, p_slug, 'créateur #' || coalesce(cid, '?'));
end $$;
revoke all on function public.plugin_decide(text, boolean) from public;
grant execute on function public.plugin_decide(text, boolean) to authenticated;

-- ---------- Un projet déclaré publié comme plugin par un créateur vérifié crée la demande tout seul
create or replace function public.project_plugin_claim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.shipped_plugin is not null and new.creator_id is not null
     and new.shipped_plugin is distinct from (case when tg_op = 'UPDATE' then old.shipped_plugin end)
     and not exists (select 1 from creator_plugins where slug = new.shipped_plugin and status in ('verified', 'pending')) then
    insert into creator_plugins (slug, creator_id, status, requested_by) values (new.shipped_plugin, new.creator_id, 'pending', new.owner)
    on conflict (slug) do update set creator_id = excluded.creator_id, status = 'pending', requested_by = excluded.requested_by,
                                     created_at = now(), decided_at = null;
  end if;
  return null;
end $$;
drop trigger if exists project_plugin_claim on public.projects;
create trigger project_plugin_claim after insert or update of shipped_plugin on public.projects
  for each row execute function public.project_plugin_claim();

-- ---------- Administrateur : rattacher directement un plugin à un créateur (par exemple sur demande Discord)
create or replace function public.plugin_admin_set(p_slug text, p_creator text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  p_slug := lower(btrim(coalesce(p_slug, '')));
  if p_slug !~ '^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'Invalid plugin link.'; end if;
  if p_creator !~ '^[0-9]{1,10}$' then raise exception 'Invalid creator number.'; end if;
  insert into creator_plugins (slug, creator_id, status, requested_by, decided_at) values (p_slug, p_creator, 'verified', auth.uid(), now())
  on conflict (slug) do update set creator_id = excluded.creator_id, status = 'verified', decided_at = now();
  perform log_admin('Plugin rattaché', p_slug, 'créateur #' || p_creator);
end $$;
revoke all on function public.plugin_admin_set(text, text) from public;
grant execute on function public.plugin_admin_set(text, text) to authenticated;

-- ---------- Administrateur : tous les plugins rattachés (pour les retirer au besoin)
create or replace function public.plugin_admin_remove(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  delete from creator_plugins where slug = p_slug;
  perform log_admin('Plugin retiré', p_slug, '');
end $$;
revoke all on function public.plugin_admin_remove(text) from public;
grant execute on function public.plugin_admin_remove(text) to authenticated;
