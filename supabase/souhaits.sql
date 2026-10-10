-- =====================================================================
--  Souhaits de plugins (onglet « En élaboration ») : n'importe quel utilisateur de TRMNL, créateur ou non,
--  propose un plugin qu'il aimerait avoir ; les autres le soutiennent d'un clic ; un créateur le reprend
--  en créant son projet (le projet est alors relié au souhait).
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ».
--  Peut être relancé sans risque. Nécessite schema4.sql (profils et projets) déjà installé.
--  Il faut être connecté avec Discord pour proposer ou soutenir ; la lecture est libre.
-- =====================================================================

create table if not exists public.wishes (
  id         bigint generated always as identity primary key,
  author     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title      text not null check (char_length(title) between 3 and 80),
  body       text not null default '' check (char_length(body) <= 400),
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists wishes_created on public.wishes (created_at desc);

create table if not exists public.wish_votes (
  wish_id    bigint not null references public.wishes(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (wish_id, user_id)
);

-- Un projet peut dire quel souhait il réalise
alter table public.projects add column if not exists wish_id bigint references public.wishes(id) on delete set null;
create index if not exists projects_wish on public.projects (wish_id);

-- Garde-fou anti-abus : 5 souhaits par personne et par 24 h au plus
create or replace function public.can_wish() returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from wishes where author = auth.uid() and created_at > now() - interval '1 day') < 5
$$;

alter table public.wishes     enable row level security;
alter table public.wish_votes enable row level security;
drop policy if exists "visible wishes"            on public.wishes;
drop policy if exists "signed-in users wish"      on public.wishes;
drop policy if exists "author or admin edits wish" on public.wishes;
drop policy if exists "author or admin deletes wish" on public.wishes;
drop policy if exists "votes are public"          on public.wish_votes;
drop policy if exists "signed-in users vote"      on public.wish_votes;
drop policy if exists "remove own vote"           on public.wish_votes;

create policy "visible wishes" on public.wishes for select using (not hidden or author = auth.uid() or public.is_admin());
create policy "signed-in users wish" on public.wishes for insert to authenticated
  with check (author = auth.uid() and not public.is_banned() and public.can_wish());
create policy "author or admin edits wish" on public.wishes for update to authenticated using (author = auth.uid() or public.is_admin());
create policy "author or admin deletes wish" on public.wishes for delete to authenticated using (author = auth.uid() or public.is_admin());

create policy "votes are public" on public.wish_votes for select using (true);
create policy "signed-in users vote" on public.wish_votes for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned()
              and exists (select 1 from public.wishes w where w.id = wish_id and not w.hidden));
create policy "remove own vote" on public.wish_votes for delete to authenticated using (user_id = auth.uid() or public.is_admin());

grant select on public.wishes, public.wish_votes to anon, authenticated;
grant insert, update, delete on public.wishes to authenticated;
grant insert, delete on public.wish_votes to authenticated;
grant execute on function public.can_wish() to authenticated;
