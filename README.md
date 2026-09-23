# TRMNL Creator Leaderboard

A static site that ranks all creators of public TRMNL recipes, featuring a gallery, recipes currently in development, and TRMNL news. Updated hourly via GitHub Actions (triggered by cron-job.org).

## Files

- `index.html`: the website, available in both English and French
- `og.png`, `manifest.webmanifest`, `sw.js`, `icon-*.png`, `apple-touch-icon.png`: link previews and PWA installation assets
- `names.json`: public names of creators who have claimed their profiles
- `supabase/schema.sql`: database schema for recipes in development (Supabase, Discord login)
- `GUIDE-INSTALLATION.md`: setup guide for Supabase, Discord, and moderation
- `scripts/fetch-stats.mjs`: fetches recipes, history, and leaderboards
- `scripts/fetch-trmnl.mjs`: fetches service status, announcements, blog posts, and firmware updates
- `scripts/build-pages.mjs`: generates one page per recipe for link previews
- `scripts/names-lib.mjs`, `update-names.mjs`, `approve-all.mjs`, `reply-issues.mjs`: profile claiming management
- `.github/workflows/stats.yml`: data fetching and site deployment (to the `gh-pages` branch)
- `.github/workflows/names.yml`: name validation
- `.github/ISSUE_TEMPLATE/`: "Claim a creator profile" issue template

## Commands (via comments on a claim issue)

- Claims: `/approve`, `/approve Other Name`, `/reject reason`
- Batch processing: Actions › "Creator Names" › Run workflow

The data and the deployed site live on the `gh-pages` branch, which is rewritten on every run.

---

# Leaderboard des créateurs TRMNL

Site statique qui classe tous les créateurs de recettes publiques TRMNL, avec galerie, recettes en cours d'élaboration et actualité TRMNL. Mis à jour chaque heure par GitHub Actions (déclenché par cron-job.org).

## Fichiers

- `index.html` : le site, en français et en anglais
- `og.png`, `manifest.webmanifest`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` : aperçu des liens et installation en application
- `names.json` : noms publics des créateurs ayant revendiqué leur profil
- `supabase/schema.sql` : base de données des recettes en cours d'élaboration (Supabase, connexion Discord)
- `GUIDE-INSTALLATION.md` : mise en place de Supabase et de Discord, et modération
- `scripts/fetch-stats.mjs` : collecte des recettes, historique, classements
- `scripts/fetch-trmnl.mjs` : statut des services, annonces, blog, firmware
- `scripts/build-pages.mjs` : une page par recette, pour les aperçus de liens
- `scripts/names-lib.mjs`, `update-names.mjs`, `approve-all.mjs`, `reply-issues.mjs` : revendication des profils
- `.github/workflows/stats.yml` : collecte et publication (branche `gh-pages`)
- `.github/workflows/names.yml` : validation des noms
- `.github/ISSUE_TEMPLATE/` : formulaire « Claim a creator profile »

## Commandes (en commentaire d'une issue de revendication)

- Revendication : `/approve`, `/approve Autre nom`, `/reject raison`
- Beaucoup de revendications : Actions › « Noms des créateurs » › Run workflow

Les données et le site publié vivent sur la branche `gh-pages`, réécrite à chaque passage.
