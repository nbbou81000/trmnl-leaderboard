-- =====================================================================
--  Projets publiés comme plugin TRMNL (trmnl.com/integrations/…), et plus seulement comme recette
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ». Peut être relancé sans risque.
--  (Les mêmes changements figurent dans schema4.sql, pour qu'une réinstallation complète les garde.)
-- =====================================================================
alter table public.projects add column if not exists shipped_plugin text check (shipped_plugin ~ '^[a-z0-9][a-z0-9_-]{0,79}$');
alter table public.projects add column if not exists shipped_at timestamptz;

create or replace function public.guard_projects() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_banned() then raise exception 'Your account is blocked.'; end if;
  if tg_op = 'INSERT' then
    new.owner := auth.uid(); new.hidden := false; new.created_at := now(); new.updated_at := now();
    new.creator_id := (select creator_id from public.profiles where id = new.owner and creator_status = 'verified');
    new.shipped_at := case when new.shipped_plugin is not null then now() end;
    if not public.is_admin() and (select count(*) from public.projects where owner = auth.uid() and shipped_recipe is null and shipped_plugin is null) >= 5 then
      raise exception 'You can share up to 5 projects in progress at a time.';
    end if;
  else
    new.owner := old.owner; new.created_at := old.created_at;
    new.creator_id := (select creator_id from public.profiles where id = old.owner and creator_status = 'verified');
    if not public.is_admin() then new.hidden := old.hidden; end if;
    -- Date de publication d'un plugin : fixée au moment où l'auteur le déclare
    new.shipped_at := case when new.shipped_plugin is null then null
                           when new.shipped_plugin is distinct from old.shipped_plugin then now() else old.shipped_at end;
    if (new.name, new.description, new.status, new.category, new.link, new.eta, new.images, new.shipped_recipe, new.shipped_plugin)
       is distinct from (old.name, old.description, old.status, old.category, old.link, old.eta, old.images, old.shipped_recipe, old.shipped_plugin)
    then new.updated_at := now(); else new.updated_at := old.updated_at; end if;
  end if;
  if array_length(new.images, 1) > 4 then raise exception 'Up to 4 screenshots per project.'; end if;
  if exists (select 1 from unnest(new.images) x where char_length(x) > 300) then raise exception 'Invalid screenshot.'; end if;
  return new;
end $$;
