-- =====================================================================
--  Souhaits ouverts à tous (version 2) : sans compte Discord, on peut
--   - soutenir un souhait (« moi aussi », un vote par navigateur) ;
--   - proposer un souhait, qui attend la validation de l'administrateur avant d'être visible.
--  Les comptes Discord publient toujours directement.
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ».
--  Peut être relancé sans risque. Nécessite souhaits.sql déjà installé.
--
--  Le navigateur d'un visiteur sans compte a un numéro tiré au hasard, propre aux souhaits
--  (sans lien avec la mesure d'audience). Ce numéro n'est jamais affiché ni lisible par les autres.
-- =====================================================================

alter table public.wishes alter column author drop not null;
alter table public.wishes alter column author drop default;
alter table public.wishes alter column author set default auth.uid();
alter table public.wishes add column if not exists guest      uuid;                 -- navigateur d'un visiteur sans compte
alter table public.wishes add column if not exists guest_name text check (guest_name is null or char_length(guest_name) <= 30);
alter table public.wishes add column if not exists pending    boolean not null default false;   -- en attente de validation
create index if not exists wishes_guest on public.wishes (guest, created_at);

-- Le numéro de navigateur ne doit jamais être lisible par les visiteurs
revoke select on public.wishes from anon, authenticated;
grant select (id, author, title, body, hidden, created_at, guest_name, pending) on public.wishes to anon, authenticated;

-- Visibles : publiés et non masqués ; l'auteur connecté voit les siens ; l'administrateur voit tout
drop policy if exists "visible wishes" on public.wishes;
create policy "visible wishes" on public.wishes for select
  using ((not hidden and not pending) or (author is not null and author = auth.uid()) or public.is_admin());

-- ---------- Votes des visiteurs sans compte
create table if not exists public.wish_guest_votes (
  wish_id    bigint not null references public.wishes(id) on delete cascade,
  visitor    uuid   not null,
  created_at timestamptz not null default now(),
  primary key (wish_id, visitor)
);
alter table public.wish_guest_votes enable row level security;
revoke all on public.wish_guest_votes from anon, authenticated;   -- uniquement par les fonctions ci-dessous

-- Proposer un souhait sans compte : en attente de validation, 3 par navigateur et par 24 h au plus
create or replace function public.wish_add_guest(p_visitor uuid, p_title text, p_body text default '', p_name text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare t text := btrim(coalesce(p_title, '')); b text := btrim(coalesce(p_body, '')); n text := nullif(btrim(coalesce(p_name, '')), ''); new_id bigint;
begin
  if p_visitor is null then raise exception 'Missing browser id.'; end if;
  if char_length(t) < 3 or char_length(t) > 80 then raise exception 'Title must be 3 to 80 characters.'; end if;
  if char_length(b) > 400 then raise exception 'Details must be 400 characters at most.'; end if;
  if n is not null and char_length(n) > 30 then n := left(n, 30); end if;
  if (select count(*) from wishes where guest = p_visitor and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Limit reached: 3 wishes a day.';
  end if;
  if (select count(*) from wishes where pending and created_at > now() - interval '1 day') >= 50 then
    raise exception 'Too many wishes waiting for review, please try again later.';
  end if;
  insert into wishes (author, guest, guest_name, title, body, pending) values (null, p_visitor, n, t, b, true) returning id into new_id;
  return new_id;
end $$;

-- Soutenir (ou retirer son soutien) sans compte
create or replace function public.wish_vote_guest(p_wish bigint, p_visitor uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_visitor is null then return; end if;
  if p_on then
    if not exists (select 1 from wishes where id = p_wish and not hidden and not pending) then raise exception 'Wish not found.'; end if;
    insert into wish_guest_votes (wish_id, visitor) values (p_wish, p_visitor) on conflict do nothing;
  else
    delete from wish_guest_votes where wish_id = p_wish and visitor = p_visitor;
  end if;
end $$;

-- Compteurs des votes sans compte (sans révéler qui a voté), et les votes de ce navigateur
create or replace function public.wish_guest_counts(p_visitor uuid default null)
returns table (wish_id bigint, n integer, mine boolean) language sql stable security definer set search_path = public as $$
  select v.wish_id, count(*)::int, coalesce(bool_or(v.visitor = p_visitor), false)
  from wish_guest_votes v join wishes w on w.id = v.wish_id
  where not w.hidden and not w.pending
  group by v.wish_id
$$;

revoke all on function public.wish_add_guest(uuid, text, text, text) from public;
revoke all on function public.wish_vote_guest(bigint, uuid, boolean) from public;
revoke all on function public.wish_guest_counts(uuid) from public;
grant execute on function public.wish_add_guest(uuid, text, text, text) to anon, authenticated;
grant execute on function public.wish_vote_guest(bigint, uuid, boolean) to anon, authenticated;
grant execute on function public.wish_guest_counts(uuid) to anon, authenticated;

-- Seul l'administrateur modifie un souhait (masquer, valider) : un auteur ne peut pas réafficher un souhait masqué
drop policy if exists "author or admin edits wish" on public.wishes;
drop policy if exists "admin edits wish" on public.wishes;
create policy "admin edits wish" on public.wishes for update to authenticated using (public.is_admin());
