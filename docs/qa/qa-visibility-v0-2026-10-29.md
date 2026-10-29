# QA — lot V0 visibilité des ressources (DECISION-100/102/103) — 2026-10-29

Branche `feat/r1-visibility-v0`, tête c1ae09d. Tests : `backend/test/QA-visibility-v0.test.ts` (33 tests : 31 PASS + 2 `it.fails` = défauts, 0 FAIL). Verdict : **PARTIAL_PASS** (V0 conforme à « aucun changement visible » ; 2 défauts de base mineurs ; 60 lectures non branchées, écart attendu pour V1). Ceci n'est pas un avis Security / Privacy / Compliance.

## Méthode
- Partie mémoire (toujours exécutée) : 5 services x get/list x 8 profils de lecteur (ordinaire, administrateur sans groupe, sans rôle, rôle seulement NOMMÉ « Risk Manager », RM, Comité, Audit, Audit parmi d'autres) ; double de dépôt fidèle au filtre SQL ; inventaire statique des lectures (parenthèses équilibrées).
- Partie PostgreSQL 16 locale (socket `/var/tmp/qavisv0`, jamais Neon ; `QA_VIS_PGHOST` / `QA_VIS_PGPORT`, ignorée sans variable) : le test construit lui-même `grc_qa_visv0_tpl` (migrations 001..079 par `/usr/bin/psql`), une base par bloc, tout supprimé à la fin.
- Mutation testing : filtre SQL neutralisé -> 3 tests rouges ; `AUDIT` retiré de `SEES_EVERYTHING` -> 4 rouges. Code restauré (`git checkout`).
- `npm run typecheck` OK ; `npm test` 2636 pass / 314 skipped (sans variable) ; avec PG local : 35 pass + 2 expected-fail sur les deux fichiers visibilité.

## Résultats
| Zone | Résultat |
|---|---|
| NR : tout CLIENT, listes et par id identiques pour les 8 profils (mémoire) et pour les 5 dépôts réels (JSON identique scope absent / all / CLIENT) | PASS |
| Portée transmise : RM/Comité/Audit -> `{all:true}`, tous les autres -> `{all:false}`, sans résolveur -> `undefined` (10 lectures x 8 profils) | PASS |
| Rôle seulement nommé « Risk Manager », siège révoqué, rôle désactivé, RM d'un autre client, administrateur sans groupe : ne voient que CLIENT | PASS |
| 080 : lignes existantes AVANT 080 = CLIENT (5 tables), ligne créée sans la colonne = CLIENT, CHECK 3 valeurs (PUBLIC, NULL, minuscule refusés) | PASS |
| 080 up / down / up, up x2, down x2 : schéma après down identique octet pour octet (colonnes, fonctions, triggers, tables), lignes conservées, `schema_migrations` nettoyée | PASS |
| `resource_access_grants` : chaque colonne de contenu immuable (8 UPDATE refusés, ligne inchangée), révocation une seule fois, pas de restauration, pas d'insertion déjà révoquée | PASS |
| DELETE (active/révoquée/tout) et TRUNCATE (simple, CASCADE) refusés au superutilisateur, y compris avec `search_path = pg_temp` ; refusés par privilège au rôle `grc_app_runtime` | PASS |
| Auto-attribution refusée (insert et UPDATE) ; isolation client : utilisateur / attributeur / révocateur d'un autre client, client inconnu, client NULL refusés | PASS |
| Un accès actif par (client, type, ressource, personne) ; nouveau après révocation ; motif 1..500 | PASS (voir QA-VIS0-02) |
| `search_path = pg_catalog, public, pg_temp` (pg_temp en dernier) sur les 2 fonctions ; triggers BEFORE ligne I/U/D et BEFORE instruction TRUNCATE | PASS |
| VIS (vrais services + dépôts + `PostgresRoleRepository`) : ligne PERIMETRE et NOMINATIF invisible d'une 1re ligne (liste ET par id, même erreur qu'un id inconnu, aucun oracle d'existence) ; visible pour RM, Comité, Audit ; autre client jamais | PASS |

## Défauts
| ID | Gravité QA | Où | Constat |
|---|---|---|---|
| QA-VIS0-01 | MINOR | `database/postgresql/migrations/080_resource_visibility.sql:48` (`rag_revocation_shape_check`) | `(revoked_at IS NULL) = (revoked_by IS NULL AND revoke_reason IS NULL)` accepte `revoked_at` + `revoked_by` SANS motif, et `revoked_at` + motif SANS révocateur. La spec veut un motif et un auteur de révocation ; seule la couche service (V1) les imposerait. Attendu : `(revoked_at IS NULL) = (revoked_by IS NULL)` ET `(revoked_at IS NULL) = (revoke_reason IS NULL)`. Test `it.fails` laissé tel quel. À corriger par A07 (nouvelle migration ou 080 non déployée). |
| QA-VIS0-02 | TRIVIAL | `080_resource_visibility.sql:36-37` (`grant_reason`, `revoke_reason`) | `btrim()` ne retire que les espaces : un motif `"\t\n"` passe le CHECK 1..500. Même famille que F-PNL-11. Test `it.fails`. |

Aucun défaut de sécurité suspecté dans le périmètre testé (à confirmer par Security : rapport séparé `docs/security/`). Les deux défauts ci-dessus sont à porter à Security pour avis sur la gravité, pas évalués ici.

## Lectures NON branchées (écart pour V1, non corrigé)
Les 10 lectures publiques `get` / `list` des 5 services sont branchées (garde de test : liste exacte). Les 60 lectures de racines suivantes n'ont pas de portée (un test d'instantané par fichier échoue si l'une change). Dès que V1 écrira PERIMETRE / NOMINATIF, chacune devient une fuite possible :

**Lectures utilisateur directes (priorité V1)**
- `ActionPlanService.ts:251` `listForRisk`, `:264` `dashboard` (liste filtrée des plans, ACT-196) ; `ControlService.ts:76` `listCoveringRisk` ; `KpiService.ts:201` `getById` (interne mais renvoie le KPI).
- Fiche risque 360 : `RiskDeviceViewService.ts:192` risque, `:201` contrôles couvrants, `:212` plans d'action ; `RiskEvaluationViewService.ts:69` risque, `:72` contrôles couvrants.
- Tableaux de bord : `DashboardService.ts:311, 330, 351, 403, 420, 474-477, 521, 525, 931, 977, 1025` (14 lectures : risques, anomalies, contrôles, plans, KPI) ; `DashboardScopeResolver.ts:41, 54, 55` ; cartographie `CartographyService.ts:273`.
- Autres vues : `KriService.ts:105, 245, 250` (KRI d'un risque caché), `KriMeasureService.ts:100`, `RiskOwnershipService.ts:62` (liste des propriétaires), `ProcessService.ts:421, 429` (risques / contrôles d'un processus), `ProcessEvaluationModeRequestService.ts:284`, `RiskEvaluationService.ts:204, 301, 722`, `RiskFrameworkService.ts:205`, `TreatmentDecisionService.ts:60`, `FindingService.ts:230, 233, 236`, `RaciAssignmentService.ts:166, 169, 172`.

**Lectures de validation d'existence (comportement à décider en V1 : oracle d'existence)**
- `ActionPlanService.ts:143, 248, 517, 520, 548, 551, 557`, `AnomalyService.ts:50, 60`, `ControlEffectivenessService.ts:39`, `ControlExecutionService.ts:35`, `ControlService.ts:158`, `KpiMeasureService.ts:28, 61`.

**Dépôts** : `PostgresRiskRepository.listByIds` (`:56`), `PostgresControlRepository.listCoveringRisk` (`:140`), `PostgresActionPlanRepository.listForRisk` (`:217`) n'acceptent pas de portée. Exports : aucun export de ces tables (seul l'import Excel des risques, écriture).

## Observations
- Le défaut CLIENT et le filtre `AND visibility = 'CLIENT'` ne touchent aucune écriture : les mises à jour passent par `get` (portée) et ne peuvent donc pas viser une ligne cachée.
- `PostgresAnomalyRepository.getById` n'a pas de filtre `deleted_at` (préexistant, hors V0).
- Le rôle administrateur sans groupe fixe est bien borné à CLIENT (q197, option A3 en attente de V4).

## Reproduire
```
initdb -D /var/tmp/qavisv0/data -A trust -U postgres ; pg_ctl -D … -o "-p 55441 -c listen_addresses= -c unix_socket_directories=/var/tmp/qavisv0" start
cd backend && QA_VIS_PGHOST=/var/tmp/qavisv0 QA_VIS_PGPORT=55441 npx vitest run test/QA-visibility-v0.test.ts
```
