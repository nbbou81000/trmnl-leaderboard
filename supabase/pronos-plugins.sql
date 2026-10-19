-- =====================================================================
--  Pronostics : autoriser aussi les plugins rattachés (identifiant « p-<nom> »), pas seulement les recettes.
--  À coller en entier dans Supabase › SQL Editor › New query, puis « Run ». Peut être relancé sans risque.
-- =====================================================================
alter table public.predictions drop constraint if exists predictions_recipe_id_check;
alter table public.predictions add constraint predictions_recipe_id_check
  check (recipe_id ~ '^([0-9]{1,12}|p-[a-z0-9][a-z0-9_-]{0,79})$');
