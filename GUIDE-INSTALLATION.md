# Recettes en cours d'élaboration : installation et modération

Cette section fonctionne avec **Supabase** (base de données, images, connexion) et **Discord** (pour se connecter). Tout se fait en cliquant, sans terminal. Comptez une vingtaine de minutes, à faire de préférence sur ordinateur.

Gardez un bloc-notes ouvert : vous allez copier quatre valeurs d'un site à l'autre.

---

## Étape 1 : créer le projet Supabase

1. Allez sur **supabase.com** et cliquez sur *Start your project*. Connectez-vous avec votre compte GitHub.
2. Cliquez sur **New project**.
   - *Name* : `trmnl-leaderboard`
   - *Database Password* : cliquez sur *Generate a password*, puis notez-le dans votre bloc-notes (il ne servira qu'en cas de besoin).
   - *Region* : **Europe (Paris)**, ou la plus proche de vous.
   - Plan : **Free**.
3. Cliquez sur **Create new project** et patientez deux minutes, le temps que le projet démarre.

## Étape 2 : créer la base de données

1. Dans le menu de gauche de Supabase, ouvrez **SQL Editor**.
2. Cliquez sur **New query**.
3. Ouvrez le fichier `supabase/schema.sql`, copiez **tout** son contenu et collez-le dans l'éditeur.
4. Cliquez sur **Run** (en bas à droite). Le message **Success. No rows returned** doit apparaître.

Ce fichier crée les tables, les règles de sécurité (chacun ne peut modifier que ses propres contenus), les limites anti-spam et l'espace de stockage des captures. Vous pouvez le relancer sans risque : il ne supprime rien.

## Étape 3 : récupérer l'adresse de rappel de Supabase

1. Dans Supabase, ouvrez **Authentication**, puis **Sign In / Providers** (ou *Providers*).
2. Cliquez sur **Discord** dans la liste. Ne l'activez pas encore.
3. Copiez l'adresse **Callback URL (for OAuth)**, qui ressemble à `https://abcdefgh.supabase.co/auth/v1/callback`. Notez-la. Laissez cet onglet ouvert.

## Étape 4 : créer l'application Discord

1. Dans un nouvel onglet, allez sur **discord.com/developers/applications** et connectez-vous.
2. Cliquez sur **New Application**, nommez-la `TRMNL Leaderboard`, acceptez les conditions et validez. Vous pouvez ajouter une icône dans *General Information* : c'est ce que les gens verront au moment de se connecter.
3. Dans le menu de gauche, ouvrez **OAuth2**.
4. Copiez le **Client ID** et notez-le.
5. Cliquez sur **Reset Secret**, confirmez, puis copiez le **Client Secret** et notez-le.
6. Toujours dans OAuth2, section **Redirects** : cliquez sur **Add Redirect**, collez l'adresse de rappel notée à l'étape 3, puis cliquez sur **Save Changes** en bas de la page.

## Étape 5 : activer Discord dans Supabase

1. Revenez sur l'onglet Supabase ouvert à l'étape 3 (fiche Discord).
2. Activez **Enable Sign in with Discord**.
3. Collez le **Client ID** et le **Client Secret** notés à l'étape 4.
4. Cliquez sur **Save**.

## Étape 6 : autoriser votre site

1. Dans Supabase, ouvrez **Authentication**, puis **URL Configuration**.
2. *Site URL* : `https://nbbou81000.github.io/trmnl-leaderboard/`
3. *Redirect URLs* : cliquez sur **Add URL** et ajoutez `https://nbbou81000.github.io/trmnl-leaderboard/**` (avec les deux astérisques).
4. Enregistrez.

## Étape 7 : récupérer les deux clés

1. Dans Supabase, ouvrez **Project Settings** (roue crantée en bas à gauche), puis **Data API** ou **API Keys** selon la version de l'interface.
2. Copiez :
   - le **Project URL**, qui ressemble à `https://abcdefgh.supabase.co` ;
   - la clé **anon public** (ou **publishable**, qui commence par `sb_publishable_`).

Ces deux valeurs sont faites pour être publiques : la sécurité repose sur les règles créées à l'étape 2. Ne copiez **jamais** la clé `service_role` ou `secret`.

## Étape 8 : donner les clés à GitHub

1. Sur GitHub, ouvrez votre dépôt, puis **Settings › Secrets and variables › Actions**.
2. Choisissez l'onglet **Variables** (et non *Secrets*), puis **New repository variable** :
   - *Name* `SUPABASE_URL`, *Value* : le Project URL ;
   - *Name* `SUPABASE_ANON_KEY`, *Value* : la clé anon ou publishable.

Le workflow insère ces valeurs dans le site à chaque publication, et s'en sert aussi pour garder Supabase éveillé (un projet gratuit se met en pause après sept jours sans activité).

## Étape 9 : mettre les fichiers en ligne

Envoyez les fichiers de la mise à jour (*Add file › Upload files*, en glissant tout le contenu du dossier), puis lancez *Actions* › **Mise à jour des stats TRMNL** › *Run workflow*, case « Relever les recettes » décochée.

## Étape 10 : devenir administrateur

1. Sur votre site, ouvrez l'onglet **En élaboration** et cliquez sur **Se connecter avec Discord**. Autorisez l'application.
2. Revenez dans Supabase, **SQL Editor › New query**, collez cette ligne en remplaçant le nom si besoin par votre nom d'affichage Discord, puis **Run** :

```sql
update public.profiles set is_admin = true where name = 'nico81130';
```

3. Rechargez le site : un badge **admin** apparaît à côté de votre nom, avec un bouton **Signalements**.

Si le message indique *0 rows*, vérifiez votre nom exact dans **Table Editor › profiles**.

---

## Modérer au quotidien

Tout se fait **directement sur le site**, une fois connecté en administrateur.

| Où | Bouton | Effet |
|---|---|---|
| Fiche d'un projet | **Masquer** / **Afficher** | Le projet disparaît pour le public, mais reste visible pour son auteur et pour vous. |
| Fiche d'un projet | **Supprimer** | Supprime le projet, ses avancées, ses commentaires et ses images. |
| Fiche d'un projet | **Bloquer l'auteur** | L'auteur ne peut plus rien publier ni commenter. |
| Sous un commentaire | **masquer** / **afficher** | Le commentaire disparaît pour le public (son auteur le voit encore, grisé). |
| Sous un commentaire | **supprimer** | Supprime le commentaire. |
| Sous un commentaire | **bloquer** | Bloque l'auteur du commentaire. |
| En haut de la section | **Signalements** | Liste de ce que les visiteurs ont signalé. **ouvrir** mène au projet, **classer** retire le signalement. |
| En haut de la section | **Liaisons à valider** | Demandes de liaison entre un compte Discord et un numéro de créateur. **Valider** ou **Refuser** (voir ci-dessous). |

Pour débloquer quelqu'un : Supabase › **Table Editor › profiles**, décochez la case `banned` sur sa ligne.

## Valider les liaisons aux numéros de créateur

Pour que personne ne puisse se faire passer pour un autre créateur, le numéro de créateur d'un compte n'est jamais pris sur parole :

1. La personne clique sur **Lier mon numéro de créateur** et saisit son numéro.
2. Sa demande apparaît dans **Liaisons à valider**, avec son nom Discord, le créateur demandé et quelques-unes de ses recettes.
3. Vous comparez : le nom Discord correspond-il au nom revendiqué ou aux recettes ? En cas de doute, demandez-lui confirmation sur Discord.
4. **Valider** : ses projets affichent son nom de créateur, renvoient vers son profil, et leur publication officielle est repérée automatiquement. **Refuser** : la demande est effacée.

Garanties apportées par la base elle-même, et pas seulement par le site :

- un numéro ne peut être lié qu'à **un seul** compte ;
- personne ne peut valider sa propre demande ;
- tant qu'une liaison n'est pas validée, ses projets s'affichent sous le nom Discord, sans lien vers un profil de créateur ;
- une publication ne peut être déclarée qu'avec une recette appartenant au créateur vérifié.

Pour retirer une liaison déjà validée : Supabase › **Table Editor › profiles**, videz `creator_id` et remettez `creator_status` à `none` sur la ligne concernée.

## Mettre à jour la base après une nouvelle version

Quand le fichier `supabase/schema.sql` change, recollez-le en entier dans **SQL Editor › New query** et cliquez sur **Run**, puis confirmez l'avertissement. Il ne supprime aucune donnée : il ajoute ce qui manque et remet les règles à jour.

## Les règles automatiques

| Règle | Valeur |
|---|---|
| Projets en cours par personne | 5 au maximum |
| Description d'un projet | 120 caractères (environ trois lignes) |
| Avancées | une toutes les 12 heures par projet, 280 caractères, 30 au maximum |
| Commentaires | 500 caractères, un toutes les 20 secondes, 30 par jour et par personne |
| Signalements | 20 par jour et par personne |
| Captures | 2 Mo maximum, réduites à 1000 px de large avant l'envoi, avec une miniature de 420 px pour les cartes, gardées un an en cache par les navigateurs |
| « Tout juste publiées » | 14 jours après la publication de la recette |
| « En pause » | après 60 jours sans mise à jour |

En tant qu'administrateur, vous n'êtes pas soumis aux limites de fréquence.

## Ce que peuvent faire les autres

- **Tout le monde**, sans compte : lire les projets, les avancées et les commentaires.
- **Une personne connectée avec Discord** : demander à lier son numéro de créateur, publier ses projets, les modifier, publier des avancées avec captures, commenter n'importe quel projet, signaler un contenu, supprimer ses propres commentaires, et supprimer son compte avec tous ses contenus (lien en bas de la section).
- **Seul l'auteur d'un projet** peut le modifier, y publier des avancées ou le supprimer.
