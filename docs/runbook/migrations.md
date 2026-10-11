# Runbook — Application des migrations de base de données

```text
DOCUMENT_ID:   RUNBOOK-MIGRATIONS
TITLE:         Application et retour arrière des migrations SQL (staging puis production)
TYPE:          Runbook (Niveau 5 — Opérations)
VERSION:       0.1 (projet, non encore exécuté de bout en bout en dehors de la promotion du 2026-10-08)
OWNER:         HUMAN (Product Owner) — seul approbateur de l'application en production
AUTHOR:        Agent Documentation (A26)
REVIEWER:      Dev DB (A07), DevOps (A09), QA (A08)
STATUS:        DRAFT
CLASSIFICATION: INTERNE
LAST_TESTED:   Non testé comme procédure complète (voir section 9)
NEXT_REVIEW:   Avant la release R5 (mise en production de la V1)
```

## 1. Objet et périmètre

Ce runbook décrit comment une migration SQL du dossier
`database/postgresql/migrations/` passe de la pull request à la base de
staging, puis à la base de production, et comment revenir en arrière si
nécessaire. Il ne décrit pas la création d'une migration (voir la convention
dans `database/postgresql/migrations/README.md`).

## 2. Rôles

| Rôle | Responsabilité |
|---|---|
| **PO (HUMAN)** | Seul approbateur de l'application d'une migration en production (DECISION-025, q06 : procédure tenue par le PO). Décide aussi d'un retour arrière en production. |
| **Agents** | Rédigent les fichiers `NNN_nom.sql` et `NNN_nom.down.sql` dans une pull request. **Ils n'appliquent jamais une migration**, ni en staging ni en production (contrainte PO, rappelée dans DECISION-009). |
| **Dev DB (A07)** | Rédige la migration et son `.down.sql`, vérifie la numérotation. |
| **QA (A08) et Recette métier** | Valident le comportement sur staging. Recette métier : Charles Kouassi et Aboubacar Ouattara (DECISION-025, q06). |
| **DevOps (A09)** | Maintient les workflows et les environnements GitHub. |

## 3. Principes

1. **Forward-only par défaut.** Le runner n'a aucune commande de rollback
   intégrée. Un retour arrière est toujours un fichier SQL écrit à la main.
2. **Numérotation séquentielle.** Vérifier le dernier numéro du dossier avant
   de créer une migration. Ne jamais réutiliser ni deviner un numéro. Le
   prochain numéro libre est `047` à la date de ce runbook (ROADMAP-V1 et
   ACTION_ITEMS). Constat : **deux fichiers portent le numéro 044**
   (`044_audit_log_escalate.sql` et `044_risk_idempotency.sql`). Le runner
   trie par nom, donc il n'y a pas de casse aujourd'hui, mais la règle de
   numérotation unique n'est pas respectée.
3. **Un `.down.sql` pour toute migration qui modifie le schéma ou les données**
   (convention du `README.md` du dossier migrations).
4. **Pas de `DELETE FROM` sur une table métier**, ni dans une migration ni dans
   un rollback (soft delete, `CLAUDE.md`).
5. **Le code et le schéma avancent ensemble.** Une migration doit être
   appliquée avant que le code qui en a besoin ne démarre (voir section 4.5).

## 4. Procédure d'application

### 4.1 Prérequis avant toute application

- La pull request contenant la migration est relue (QA, et Security quand la
  GRC Trigger Matrix l'exige) et mergée sur `staging`.
- Le fichier `.down.sql` existe, et son commentaire d'en-tête indique si le
  retour arrière est destructif et à partir de quand il n'est plus sûr.
- **Point de restauration de la base cible.** Avant d'appliquer une migration
  en production, le PO crée une branche Neon de sécurité à partir de la base
  de production (console Neon). Raison : la rétention d'historique de la base
  de production est aujourd'hui de **6 heures** (ACTION_ITEMS, suivi
  DevOps du 2026-10-08), ce qui est court. La sauvegarde quotidienne par
  GitHub Actions, décidée dans DECISION-025 (q03) et visant 30 jours de
  rétention, **n'est pas encore présente dans `.github/workflows/`**. Tant
  qu'elle n'existe pas, la branche de sécurité est le seul point de retour
  disponible.

### 4.2 Vérification sur une branche Neon éphémère

- Le workflow `.github/workflows/neon_workflow.yml` crée, pour chaque pull
  request, une branche Neon `preview/pr-<numéro>-<branche>`, qui expire au
  bout de 14 jours. Cette branche est supprimée à la fermeture de la PR.
- **L'étape qui applique les migrations sur cette branche est commentée** dans
  le workflow. L'application sur la branche de preview est donc manuelle :
  1. Récupérer l'URL de connexion de la branche preview dans la console Neon.
  2. Depuis `backend/`, avec `DATABASE_URL` pointant sur cette branche :
     `npm run migrate`.
  3. Vérifier le schéma (`\d <table>`) et les lignes de `schema_migrations`.
  4. Tester le `.down.sql` sur la même branche, puis rejouer la migration
     forward pour confirmer que l'aller-retour fonctionne.

### 4.3 Application en staging

- L'application est **automatique** : un push sur `staging` qui modifie
  `database/postgresql/migrations/**` déclenche le workflow
  `.github/workflows/migrate.yml` (job `migrate`, environnement GitHub
  `staging`).
- Le workflow exécute `npm run migrate` dans `backend/` avec
  `NODE_ENV=production`. Le runner refuse de s'exécuter si le rôle de
  migration (`grc_migrator_runtime`, secret `MIGRATION_DATABASE_URL`) et le
  rôle d'exécution (`grc_app_runtime`, secret `DATABASE_URL`) ne sont pas
  distincts, ou si le rôle de migration ne possède pas les tables.
- Une relance manuelle est possible avec `workflow_dispatch` (depuis `staging`
  ou `main` uniquement, selon la condition du job).
- **Vérification** : onglet Actions du dépôt, job `Migrate database` vert, puis
  dans la console Neon de staging (rôle en lecture seule) :
  `SELECT filename FROM schema_migrations ORDER BY filename;`
  La nouvelle migration doit apparaître.

### 4.4 Recette

- QA (A08) exécute les parcours touchés par la migration sur staging.
- La recette métier (Charles Kouassi, Aboubacar Ouattara) valide sur staging
  avant toute promotion (DECISION-025, q06).
- Le smoke test read-only `.github/workflows/staging-api-smoke.yml` peut être
  lancé manuellement (`workflow_dispatch`) après l'application.

### 4.5 Application en production

- La migration arrive en production par la **promotion de `staging` vers
  `main`** (pull request). Le push sur `main` déclenche le même workflow
  `migrate.yml`, avec l'environnement GitHub `production`.
- **Approbation du PO.** Le job `production` attend l'approbation d'un relecteur
  désigné sur l'environnement GitHub `production`. Cette approbation est
  constatée dans ACTION_ITEMS (2026-10-08, promotion PR #120). Elle est un
  réglage GitHub, pas du code du dépôt : vérifier dans les paramètres de
  l'environnement `production` que le PO est bien relecteur obligatoire.
- Le PO n'approuve que si : le point de restauration de la section 4.1 existe,
  la recette de la section 4.4 est passée, et le rollback est documenté.
- **Ordre avec le déploiement du backend.** Le backend de production est en
  `autoDeployTrigger=checksPass` (ACTION_ITEMS, 2026-10-08), pour qu'il ne
  démarre pas avant la fin de la migration. Lors de la promotion du
  2026-10-08, la migration a été appliquée à 15:35 UTC et le déploiement du
  backend a commencé à 15:35:11 UTC. Ce comportement n'est pas garanti par le
  dépôt : à confirmer dans les réglages Render avant chaque promotion.

### 4.6 Vérification après application

1. `GET /health` et `GET /ready` (routes dans `backend/src/server.ts`) répondent
   OK sur l'environnement concerné. `/ready` interroge la base.
2. `SELECT filename FROM schema_migrations ORDER BY filename;` contient la
   nouvelle migration.
3. Un parcours métier simple touché par la migration fonctionne.
4. Consigner la date, le commit et l'approbateur dans
   `.claude/agent-context/ACTION_ITEMS.md` (entrée de suivi) et, si une décision
   a été prise, dans le Decision Log.

## 5. Procédure de retour arrière

### 5.1 Quand revenir en arrière

Un retour arrière est une **dernière option**. Choisir d'abord le correctif en
avant (section 5.6). Revenir en arrière quand une migration casse le
démarrage ou le fonctionnement d'un parcours critique, et qu'aucun correctif
rapide n'est possible.

### 5.2 Fichiers `.down.sql` disponibles

Constat du dossier `database/postgresql/migrations/` au 2026-10-08 :

| Migration | `.down.sql` | Effet du rollback | Destructif ? |
|---|---|---|---|
| 001 à 026 | Non | Aucun rollback documenté | — |
| 027 `raci_assignments` | Oui | `DROP TABLE raci_assignments` | **Oui** (lignes RACI) |
| 028 `raci_entity_type_snake_case` | Oui | Restaure les valeurs et la contrainte de 027 | Non, si aucune ligne SNAKE_CASE n'a été écrite par du code déjà migré |
| 029 `risks_process_id` | Oui | Supprime la colonne `process_id` | Non, si la colonne n'est pas utilisée |
| 030 `evaluation_mode` | Oui | Supprime `evaluation_mode` sur `processes` et `configs` | Perte de la distinction explicite PARTICIPATIF pour `configs` |
| 031 `controls_process_id` | Oui | Voir le fichier (non documenté dans le README du dossier) | À vérifier |
| 032 `risk_appetites_sub_category_id` | Oui | Voir le fichier (non documenté dans le README) | À vérifier |
| 033 `process_evaluation_mode_requests` | Oui | `DROP TABLE` (historique des demandes) | **Oui** |
| 034 `risk_evaluations_evaluation_mode` | Oui | Voir le fichier (non documenté dans le README) | À vérifier |
| 035 `process_department_name_uniqueness` | Oui | Voir le fichier (non documenté dans le README) | À vérifier |
| 036 `users_department_id` | Oui | Supprime la colonne `department_id` | Non, si la colonne n'est pas utilisée |
| 037 `roles_dashboard_scope_mode` | Oui | Voir le fichier (non documenté dans le README) | À vérifier |
| 038 `audit_log_append_only` | Oui | Voir le fichier (non documenté dans le README) | À vérifier |
| 039 `audit_missions` | Oui | `DROP TABLE audit_missions` | **Oui** |
| 040 `findings` | Oui | `DROP TABLE findings` | **Oui** |
| 041 `action_plan_finding_source` | Oui | Restaure la contrainte sans `FINDING` | Échoue si une ligne a `FINDING` |
| 042 `module_toggles_audit` | Oui | Restaure la contrainte sans `AUDIT` | Échoue si une ligne a `AUDIT` |
| 043 `runtime_default_privileges` | **Non** | Aucun | — (rollback à écrire avant tout retour arrière de cette migration) |
| 044 `audit_log_escalate` | Oui | Restaure la contrainte sans `ESCALATE` | Échoue si une ligne a `ESCALATE` |
| 044 `risk_idempotency` | **Non** | Aucun | — |
| 045 `committee_thresholds` | Oui | Supprime les 3 colonnes `committee_*` | Non, si les seuils n'ont jamais été modifiés |
| 046 `treatment_decisions` | Oui | `DROP TABLE treatment_decisions` | **Oui** (toutes les décisions de traitement) |

Remarque : le `README.md` du dossier ne liste que les rollbacks 027 à 030,
033, 036, 039 à 042, 044 (escalate) et 045 à 046. Les fichiers 031, 032, 034,
035, 037 et 038 existent mais ne sont pas documentés dans ce README. Ils
doivent être relus avant tout usage.

### 5.3 Ordre d'exécution

- Les `.down.sql` s'exécutent dans l'**ordre inverse** de leur application :
  le numéro le plus élevé d'abord.
- Exemple : pour revenir de `046` à `044`, exécuter `046.down.sql`, puis
  `045.down.sql`. Pour revenir de `040` à `039`, exécuter `040.down.sql` avant
  `039.down.sql` (FK entrante `findings.audit_mission_id`).
- Chaque rollback doit être testé sur une branche Neon éphémère avant
  d'être joué en staging.

### 5.4 Exécution d'un rollback

- Il n'existe **aucun workflow de rollback** dans le dépôt. La procédure est
  manuelle.
- Commande documentée dans le `README.md` du dossier :
  `psql "$DATABASE_URL" -f database/postgresql/migrations/NNN_nom.down.sql`.
  Chaque `.down.sql` doit se terminer par
  `DELETE FROM schema_migrations WHERE filename = 'NNN_nom.sql';`.
- **Point à trancher** : en production, `DATABASE_URL` est le rôle d'exécution
  (`grc_app_runtime`), qui ne possède pas les droits DDL et n'a que `SELECT`
  sur `schema_migrations` (migration 043). Le rollback doit donc utiliser
  l'URL du rôle de migration (`MIGRATION_DATABASE_URL`, `grc_migrator_runtime`),
  et non `DATABASE_URL`. Le `README.md` du dossier ne le précise pas.
- Le rollback en production est exécuté par le PO ou sous son contrôle direct,
  après décision écrite (ACTION_ITEMS).

### 5.5 Restauration Neon (dernier recours)

- La restauration d'une base Neon à un instant passé (ou d'une branche) remet
  toutes les données à cet instant. **Toutes les écritures faites depuis sont
  perdues** (saisies, décisions, audit).
- La rétention d'historique de la production est de 6 heures (ACTION_ITEMS).
  Au-delà, seule la branche de sécurité de la section 4.1 permet de revenir
  en arrière.
- **Aucune restauration réelle n'a été mesurée** (RPO et RTO non mesurés, voir
  le plan de continuation sécurité du 2026-09-30). À ne pas présenter comme un
  mécanisme éprouvé.
- Décision de restauration : PO, avec trace dans ACTION_ITEMS.

### 5.6 Quand préférer un correctif en avant

Préférer une nouvelle migration corrective (`NNN+1_fix.sql`) quand :

- des données ont déjà été écrites par le nouveau code (rollback destructif ou
  contrainte qui échouerait, cas 041, 042, 044 escalate) ;
- le rollback supprime une table ou une colonne contenant des données métier
  (039, 040, 046, 033, 027) ;
- une migration ultérieure dépend de l'objet touché ;
- le retour arrière demanderait de désactiver du code déjà en production.

Dans ces cas, le retour arrière est rarement la bonne réponse. Le correctif
en avant doit lui aussi passer par staging, recette, approbation PO.

## 6. Modèle d'échec

| Situation | Conduite |
|---|---|
| Le job `Migrate database` échoue sur staging | Ne pas promouvoir vers `main`. Lire le log. Corriger par une PR (correctif en avant). Le runner applique chaque fichier dans sa propre transaction, donc un échec ne laisse pas un fichier à moitié appliqué. |
| Le job échoue sur production | Le backend de production ne doit pas démarrer (checksPass). Vérifier l'état avec `schema_migrations`. Alerter le PO. Ne rien relancer sans son accord. |
| Migration appliquée, code en erreur | Décider : correctif en avant (préféré) ou rollback (section 5). Consigner la décision. |
| Divergence entre `staging` et `main` | Signalé dans ROADMAP-V1 (R0.5). Ne pas promouvoir tant que la divergence n'est pas résolue. |

## 7. Escalade

- Problème technique sur le workflow ou la base : DevOps (A09), puis PO (HUMAN).
- Décision d'application ou de retour arrière en production : PO (HUMAN)
  uniquement.
- Donnée personnelle ou incident de sécurité pendant une opération : Security
  (A10) et Privacy (A24), puis PO.

## 8. Preuves à conserver

- Lien vers la pull request, le commit et le run du workflow `Migrate database`.
- Date et heure UTC de l'application, approbateur sur l'environnement
  `production`.
- Sortie de `SELECT filename FROM schema_migrations ORDER BY filename;` avant
  et après.
- Lien vers la décision (Decision Log) si un rollback ou une restauration a
  eu lieu.

## 9. Points non vérifiés ou à trancher par le PO

1. **Sauvegarde quotidienne de la production** (DECISION-025, q03) : décidée,
   non livrée dans `.github/workflows/` au 2026-10-08.
2. **Rétention de la production** : 6 heures d'après ACTION_ITEMS. À trancher
   avec la décision d'hébergement de R5.1 (plan Render payant ou non, région
   Neon).
3. **Approbation GitHub de l'environnement `production`** : constatée dans
   ACTION_ITEMS, mais le dépôt ne la décrit pas. À vérifier dans les
   paramètres GitHub, avec capture ou date de contrôle.
4. **Ordre migration / déploiement Render** : repose sur le réglage
   `checksPass`, qui n'est pas dans le dépôt. À vérifier avant chaque promotion.
5. **Rôle utilisé pour les rollbacks** : `DATABASE_URL` ou
   `MIGRATION_DATABASE_URL` (voir 5.4). À trancher et à documenter dans le
   `README.md` du dossier migrations.
6. **Migrations sans rollback** : 043 et 044 `risk_idempotency`. À décider :
   écrire le `.down.sql` ou accepter l'absence de retour arrière.
7. **Deux fichiers 044** : à renuméroter ou à documenter comme exception.
8. **Procédure non testée de bout en bout** : la section 4.2 (application sur
   branche preview) et les rollbacks n'ont pas été exécutés comme procédure
   écrite. À tester avant la R5.
9. **Branche de sécurité** (section 4.1) : procédure proposée par la
   documentation, non validée par le PO.

## 10. Historique

| Date | Version | Changement | Auteur |
|---|---|---|---|
| 2026-10-08 | 0.1 | Création du runbook (R0.6). Application automatique staging/production via `migrate.yml` décrite (DECISION-009). | A26 |
