-- =====================================================================
--  Réactions en émojis (👍 ❤️ 🔥 😂 😮 🎉 🚀 👀) sur les projets « En élaboration » et sur leurs commentaires
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ».
--  Peut être relancé sans risque. Nécessite schema4.sql (projets et commentaires) déjà installé.
--  Il faut être connecté avec Discord pour réagir (comme pour commenter) ; tout le monde voit les compteurs.
-- =====================================================================

create table if not exists public.reactions (
  id         bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  comment_id bigint references public.comments(id) on delete cascade,   -- vide = réaction au projet lui-même
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '❤️', '🔥', '😂', '😮', '🎉', '🚀', '👀')),
  created_at timestamptz not null default now()
);
-- Une même personne ne peut mettre qu'une fois le même émoji au même endroit
create unique index if not exists reactions_once on public.reactions (project_id, coalesce(comment_id, 0), user_id, emoji);
create index if not exists reactions_project on public.reactions (project_id);

alter table public.reactions enable row level security;
drop policy if exists "visible reactions" on public.reactions;
drop policy if exists "signed-in users react" on public.reactions;
drop policy if exists "remove own reactions" on public.reactions;
create policy "visible reactions" on public.reactions for select using (public.can_see_project(project_id));
create policy "signed-in users react" on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned() and public.can_see_project(project_id)
              and (comment_id is null or exists (select 1 from public.comments c where c.id = comment_id and c.project_id = reactions.project_id)));
create policy "remove own reactions" on public.reactions for delete to authenticated using (user_id = auth.uid() or public.is_admin());
grant select on public.reactions to anon, authenticated;
grant insert, delete on public.reactions to authenticated;
