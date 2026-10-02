-- =====================================================================
--  Bandeau d'accueil : mise en page complète (couleurs, fond, alignement, boutons…)
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ».
--  Peut être relancé sans risque : le bandeau actuel est conservé.
-- =====================================================================

-- Tous les réglages de mise en page sont rangés dans une seule colonne
alter table public.site_settings add column if not exists style jsonb not null default '{}'::jsonb;

-- Nouveau rythme « une seule fois par visiteur »
alter table public.site_settings drop constraint if exists site_settings_frequency_check;
alter table public.site_settings add constraint site_settings_frequency_check check (frequency in ('once', 'day', 'week', 'always'));

-- Enregistrement du bandeau en une fois (réservé aux administrateurs).
-- La version augmente quand c'est une nouvelle annonce, pour que le bandeau réapparaisse chez tout le monde ;
-- une simple correction (p.silent = true) garde la version : ceux qui l'ont déjà vu ne le revoient pas.
create or replace function public.set_banner(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if length(coalesce(p->>'text_fr', '')) > 40000 or length(coalesce(p->>'text_en', '')) > 40000 then raise exception 'Texte trop long.'; end if;
  if length(coalesce(p->'style', '{}'::jsonb)::text) > 8000 then raise exception 'Réglages de style trop longs.'; end if;
  update public.site_settings set
    enabled    = coalesce((p->>'enabled')::boolean, false),
    img        = coalesce(p->>'img', ''),
    text_fr    = coalesce(p->>'text_fr', ''),
    text_en    = coalesce(p->>'text_en', ''),
    show_stats = coalesce((p->>'show_stats')::boolean, false),
    frequency  = case when p->>'frequency' in ('once', 'day', 'week', 'always') then p->>'frequency' else 'once' end,
    expires_at = nullif(p->>'expires_at', '')::timestamptz,
    font       = coalesce(nullif(btrim(p->>'font'), ''), 'default'),
    color      = coalesce(p->'style'->>'text', ''),
    style      = coalesce(p->'style', '{}'::jsonb),
    version    = version + case when coalesce((p->>'silent')::boolean, false) then 0 else 1 end,
    updated_at = now()
  where id = 1;
end $$;

revoke all on function public.set_banner(jsonb) from public;
grant execute on function public.set_banner(jsonb) to authenticated;
