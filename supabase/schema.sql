-- =====================================================================
--  Recettes en cours d'élaboration : base de données Supabase
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ».
--  Peut être relancé sans risque : il ne supprime aucune donnée.
-- =====================================================================

-- ---------- Profils (créés automatiquement à la première connexion Discord)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  avatar     text,
  is_admin   boolean not null default false,
  banned     boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_banned() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select banned from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, name, avatar)
  values (
    new.id,
    left(coalesce(meta->'custom_claims'->>'global_name', meta->>'full_name', meta->>'name', meta->>'user_name', 'Anonymous'), 40),
    meta->>'avatar_url'
  )
  on conflict (id) do update set name = excluded.name, avatar = excluded.avatar;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Projets
create table if not exists public.projects (
  id             bigint generated always as identity primary key,
  owner          uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name           text not null check (char_length(name) between 2 and 60),
  description    text not null default '' check (char_length(description) <= 120),
  status         text not null default 'building' check (status in ('idea', 'building', 'testing', 'submitted')),
  category       text not null default 'other' check (char_length(category) <= 30),
  creator_id     text check (creator_id ~ '^[0-9]{1,10}$'),
  link           text check (link ~* '^https?://' and char_length(link) <= 300),
  eta            text check (char_length(eta) <= 40),
  image          text check (char_length(image) <= 300),
  shipped_recipe text check (shipped_recipe ~ '^[0-9]{1,10}$'),
  hidden         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------- Journal de bord (réservé à l'auteur du projet)
create table if not exists public.updates (
  id         bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  owner      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null default '' check (char_length(body) <= 280),
  image      text check (char_length(image) <= 300),
  created_at timestamptz not null default now(),
  check (body <> '' or image is not null)
);

-- ---------- Commentaires (tout visiteur connecté)
create table if not exists public.comments (
  id         bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  author     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 500),
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Signalements
create table if not exists public.reports (
  id         bigint generated always as identity primary key,
  comment_id bigint references public.comments(id) on delete cascade,
  project_id bigint references public.projects(id) on delete cascade,
  reporter   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  reason     text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  check (comment_id is not null or project_id is not null)
);
create unique index if not exists reports_once on public.reports (reporter, coalesce(comment_id, 0), coalesce(project_id, 0));

create index if not exists updates_project on public.updates (project_id, created_at desc);
create index if not exists comments_project on public.comments (project_id, created_at);
create index if not exists projects_updated on public.projects (updated_at desc);

-- ---------- Garde-fous (limites et champs protégés)
create or replace function public.guard_projects() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_banned() then raise exception 'Your account is blocked.'; end if;
  if tg_op = 'INSERT' then
    new.owner := auth.uid(); new.hidden := false; new.created_at := now(); new.updated_at := now();
    if not public.is_admin() and (select count(*) from public.projects where owner = auth.uid() and shipped_recipe is null) >= 5 then
      raise exception 'You can share up to 5 projects in progress at a time.';
    end if;
  else
    new.owner := old.owner; new.created_at := old.created_at;
    if not public.is_admin() then new.hidden := old.hidden; end if;
    if (new.name, new.description, new.status, new.category, new.creator_id, new.link, new.eta, new.image, new.shipped_recipe)
       is distinct from (old.name, old.description, old.status, old.category, old.creator_id, old.link, old.eta, old.image, old.shipped_recipe)
    then new.updated_at := now(); else new.updated_at := old.updated_at; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_projects on public.projects;
create trigger guard_projects before insert or update on public.projects for each row execute function public.guard_projects();

create or replace function public.guard_updates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_banned() then raise exception 'Your account is blocked.'; end if;
  new.owner := auth.uid(); new.created_at := now();
  if not exists (select 1 from public.projects where id = new.project_id and owner = auth.uid()) then
    raise exception 'Only the author of a project can post updates to it.';
  end if;
  if not public.is_admin() then
    if exists (select 1 from public.updates where project_id = new.project_id and created_at > now() - interval '12 hours') then
      raise exception 'One update every 12 hours per project, to keep the page tidy.';
    end if;
    if (select count(*) from public.updates where project_id = new.project_id) >= 30 then
      raise exception 'This project already has 30 updates. Delete an old one first.';
    end if;
  end if;
  update public.projects set updated_at = now() where id = new.project_id;
  return new;
end $$;
drop trigger if exists guard_updates on public.updates;
create trigger guard_updates before insert on public.updates for each row execute function public.guard_updates();

create or replace function public.guard_comments() returns trigger
language plpgsql security definer set search_path = public as $$
declare keep_hidden boolean;
begin
  if tg_op = 'INSERT' then
    if public.is_banned() then raise exception 'Your account is blocked.'; end if;
    new.author := auth.uid(); new.hidden := false; new.created_at := now(); new.body := btrim(new.body);
    if not public.is_admin() then
      if exists (select 1 from public.comments where author = auth.uid() and created_at > now() - interval '20 seconds') then
        raise exception 'Please wait a few seconds before commenting again.';
      end if;
      if (select count(*) from public.comments where author = auth.uid() and created_at > now() - interval '1 day') >= 30 then
        raise exception 'Daily comment limit reached. See you tomorrow!';
      end if;
    end if;
    return new;
  end if;
  keep_hidden := new.hidden;
  new := old;
  new.hidden := keep_hidden;
  return new;
end $$;
drop trigger if exists guard_comments on public.comments;
create trigger guard_comments before insert or update on public.comments for each row execute function public.guard_comments();

create or replace function public.guard_reports() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.reporter := auth.uid(); new.created_at := now();
  if (select count(*) from public.reports where reporter = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Too many reports today.';
  end if;
  return new;
end $$;
drop trigger if exists guard_reports on public.reports;
create trigger guard_reports before insert on public.reports for each row execute function public.guard_reports();

-- Un administrateur peut bloquer ou débloquer quelqu'un (et rien d'autre sur les profils)
create or replace function public.set_banned(target uuid, value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.profiles set banned = value where id = target and not is_admin;
end $$;

-- Chacun peut supprimer son compte et tous ses contenus (les images sont effacées par le site juste avant)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------- Règles d'accès (Row Level Security)
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.updates  enable row level security;
alter table public.comments enable row level security;
alter table public.reports  enable row level security;

create or replace function public.can_see_project(pid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p where p.id = pid and (not p.hidden or p.owner = auth.uid() or public.is_admin()))
$$;

do $$ declare t text; p text;
begin
  for t, p in select tablename, policyname from pg_policies where schemaname = 'public' and tablename in ('profiles', 'projects', 'updates', 'comments', 'reports') loop
    execute format('drop policy %I on public.%I', p, t);
  end loop;
end $$;

create policy "profiles are public"        on public.profiles for select using (true);

create policy "visible projects"           on public.projects for select using (not hidden or owner = auth.uid() or public.is_admin());
create policy "signed-in users create"     on public.projects for insert to authenticated with check (owner = auth.uid());
create policy "owner or admin edits"       on public.projects for update to authenticated using (owner = auth.uid() or public.is_admin());
create policy "owner or admin deletes"     on public.projects for delete to authenticated using (owner = auth.uid() or public.is_admin());

create policy "updates of visible projects" on public.updates for select using (public.can_see_project(project_id));
create policy "only the project owner logs" on public.updates for insert to authenticated
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner = auth.uid()));
create policy "owner or admin deletes updates" on public.updates for delete to authenticated using (owner = auth.uid() or public.is_admin());

create policy "visible comments"           on public.comments for select using (public.can_see_project(project_id) and (not hidden or author = auth.uid() or public.is_admin()));
create policy "signed-in users comment"    on public.comments for insert to authenticated with check (author = auth.uid() and public.can_see_project(project_id));
create policy "admins hide comments"       on public.comments for update to authenticated using (public.is_admin());
create policy "author or admin deletes comments" on public.comments for delete to authenticated using (author = auth.uid() or public.is_admin());

create policy "signed-in users report"     on public.reports for insert to authenticated with check (reporter = auth.uid());
create policy "admins read reports"        on public.reports for select to authenticated using (public.is_admin());
create policy "admins clear reports"       on public.reports for delete to authenticated using (public.is_admin());

grant execute on function public.set_banned(uuid, boolean) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- Stockage des captures (dossier par utilisateur, 2 Mo maximum, images uniquement)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wip', 'wip', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

drop policy if exists "wip images are public"      on storage.objects;
drop policy if exists "users upload in own folder" on storage.objects;
drop policy if exists "users delete own images"    on storage.objects;
create policy "wip images are public"      on storage.objects for select using (bucket_id = 'wip');
create policy "users upload in own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'wip' and (storage.foldername(name))[1] = auth.uid()::text and not public.is_banned());
create policy "users delete own images"    on storage.objects for delete to authenticated
  using (bucket_id = 'wip' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
