-- =====================================================================
--  Coulisses de « Ça va cartonner » : raisonnement, candidates écartées, choix de la formule,
--  courbes heure par heure et bilans à 7 jours. Lisibles par l'administrateur SEUL.
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ». Peut être relancé sans risque.
--  À la fin, copiez le jeton affiché dans GitHub › Settings › Secrets and variables › Actions,
--  bouton « New repository secret », nom : BREAKOUT_AI_TOKEN.
-- =====================================================================

-- ---------- Une ligne par jour de sélection
create table if not exists public.breakout_ai (
  day        date primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.breakout_ai enable row level security;
revoke all on public.breakout_ai from anon, authenticated;
grant select on public.breakout_ai to authenticated;
drop policy if exists "admin reads breakout ai" on public.breakout_ai;
create policy "admin reads breakout ai" on public.breakout_ai for select to authenticated using (public.is_admin());

-- ---------- Jeton secret du relevé horaire (seul lui peut écrire)
create table if not exists public.breakout_ai_token (
  id    int primary key default 1 check (id = 1),
  token text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
);
insert into public.breakout_ai_token (id) values (1) on conflict (id) do nothing;
alter table public.breakout_ai_token enable row level security;
revoke all on public.breakout_ai_token from anon, authenticated;

-- ---------- Écriture et relecture par le relevé horaire (protégées par le jeton)
create or replace function public.breakout_ai_put_many(p_token text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if p_token is null or not exists (select 1 from breakout_ai_token where token = p_token) then raise exception 'Jeton invalide.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then raise exception 'Format invalide.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if octet_length((r->'data')::text) > 400000 then raise exception 'Ligne trop volumineuse.'; end if;
    insert into breakout_ai (day, data, updated_at) values ((r->>'day')::date, r->'data', now())
    on conflict (day) do update set data = excluded.data, updated_at = now();
  end loop;
  delete from breakout_ai where day < current_date - 400;
end $$;

create or replace function public.breakout_ai_recent(p_token text, p_days int default 45) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_token is null or not exists (select 1 from breakout_ai_token where token = p_token) then raise exception 'Jeton invalide.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('day', day, 'data', data) order by day desc)
                   from breakout_ai where day >= current_date - least(greatest(coalesce(p_days, 45), 1), 120)), '[]'::jsonb);
end $$;

revoke all on function public.breakout_ai_put_many(text, jsonb) from public;
revoke all on function public.breakout_ai_recent(text, int) from public;
grant execute on function public.breakout_ai_put_many(text, jsonb) to anon, authenticated;
grant execute on function public.breakout_ai_recent(text, int) to anon, authenticated;

-- ---------- Interrupteur de la nouvelle formule (privé : ni les visiteurs ni les membres ne le voient)
--  Coupé : retour à l'ancienne formule (une recette par jour, sans aucun appel à Mistral).
create table if not exists public.breakout_ai_settings (
  id         int primary key default 1 check (id = 1),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.breakout_ai_settings (id) values (1) on conflict (id) do nothing;
alter table public.breakout_ai_settings enable row level security;
revoke all on public.breakout_ai_settings from anon, authenticated;

create or replace function public.breakout_ai_enabled(p_token text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_token is null or not exists (select 1 from breakout_ai_token where token = p_token) then raise exception 'Jeton invalide.'; end if;
  return coalesce((select enabled from breakout_ai_settings where id = 1), true);
end $$;

create or replace function public.cartonner_mode_get() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return coalesce((select enabled from breakout_ai_settings where id = 1), true);
end $$;

create or replace function public.cartonner_mode_set(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update breakout_ai_settings set enabled = coalesce(p_on, true), updated_at = now() where id = 1;
  begin
    perform public.log_admin(case when p_on then '« Ça va cartonner » : nouvelle formule réactivée' else '« Ça va cartonner » : retour à l''ancienne formule' end, 'cartonner');
  exception when undefined_function then null;
  end;
end $$;

revoke all on function public.breakout_ai_enabled(text) from public;
revoke all on function public.cartonner_mode_get() from public, anon;
revoke all on function public.cartonner_mode_set(boolean) from public, anon;
grant execute on function public.breakout_ai_enabled(text) to anon, authenticated;
grant execute on function public.cartonner_mode_get() to authenticated;
grant execute on function public.cartonner_mode_set(boolean) to authenticated;

-- ---------- Le jeton à copier dans GitHub (secret BREAKOUT_AI_TOKEN)
select token as "Jeton à copier dans GitHub › Secrets : BREAKOUT_AI_TOKEN" from public.breakout_ai_token;
