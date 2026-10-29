# Revue Sécurité A10 — lot V0 visibilité des ressources (2026-10-29)

- Cible : `git diff origin/staging...feat/r1-visibility-v0` (HEAD `c1ae09d`), 26 fichiers.
- Décisions de référence : DECISION-100/102/103 (`ACTION_ITEMS.md`, branche `origin/chore/suivi-r1-f7s3`), q197 A3.
- Méthode : analyse statique + `npx vitest run` de `visibility-v0`, `QA-panel-migrations`, `QA-panel2-migrations`, `QA-B6a11`, `RiskService` : 82 verts, 11 ignorés (suites PostgreSQL locales, sans base). Aucun accès Neon. Aucun code de production modifié.

**Escalade HUMAN : aucune.** CVSS effectif maximal en V0 : 0 (aucune ligne ne peut porter une visibilité autre que CLIENT par l'application). Les constats ci-dessous sont des **conditions bloquantes pour V1**, cotées sur leur effet une fois V1 livré.

**Verdict : VERT pour V0** (aucun changement visible, aucune nouvelle surface d'écriture). **Avant V1, il faut lever V0-01 à V0-04.**

## 1. Point d'application et fail-closed : PASS avec réserve

- `visibilityClause` (`backend/src/infrastructure/database/postgres/visibilityFilter.ts`) est injectée dans le `WHERE`, après `tenant_id = $1` et `deleted_at IS NULL`, sur `getById` et `list` des 5 repositories. Pas de filtrage après lecture. La colonne est un littéral fixe et aucun paramètre client n'entre dans le SQL.
- Le `ReadScope` est calculé côté serveur (`VisibilityResolver.resolve(actor)`) à partir de `actor.tenantId` et `actor.userId`. Aucune route ne l'accepte en entrée.
- Fail-closed sur la valeur : `{ all: false }` produit `= 'CLIENT'`, donc une valeur inconnue est invisible. La contrainte CHECK de la migration 080 l'interdit de toute façon. `isVisible` applique la même règle. Si le résolveur échoue (erreur de base), la requête répond 500, sans lecture.
- Les mutations héritent du filtre lorsqu'elles passent par `get()`/`getRaw()` : update, archive, assignOwner et escalate de Risk, update et archive de Control, updateStatus d'Anomaly, toutes les opérations d'ActionPlan via `getRaw`. Une ressource masquée ne peut donc pas être modifiée à l'aveugle. C'est cohérent.
- **Réserve (V0-01)** : le paramètre `scope` est optionnel et son absence veut dire « aucun filtre ». C'est fail-open sur le câblage : tout appelant qui oublie le scope, aujourd'hui ou en V1, lit tout. Voir V0-01.

## 2. Qui « voit tout » : PASS

- `SEES_EVERYTHING = RISK_MANAGER | RISK_COMMITTEE | AUDIT`, résolu depuis `user_roles` actifs (`revoked_at IS NULL`) joints à `roles` non supprimés (`ROLES_OF_USER_SQL`), par `roles.system_group`. La résolution n'utilise jamais `users.roles` ni une permission. Le constat Codex PR #207 ne s'applique donc pas.
- `system_group` n'a aucun écrivain applicatif : grep sans résultat hors migration 049. Index unique par client.
- Un compte suspendu est déjà rejeté par `lookupMembership` (`deleted_at IS NULL`) avant d'atteindre un service.
- INFO V0-06 : `ROLES_OF_USER_SQL` joint `user_roles` à `roles` sur `role_id` seul, sans `r.tenant_id = ur.tenant_id`, alors que `listActiveGrants` et `listDisabledForUser` font cette jointure. Ce n'est pas exploitable aujourd'hui, car l'affectation vérifie le client. En défense en profondeur, il faut ajouter `AND r.tenant_id = ur.tenant_id`, puisque ce résultat décide désormais d'un « voit tout ».

## 3. Administrateur (q197 A3) : PASS sur le résolveur, voie de contournement à fermer avant V1

- L'administrateur n'est pas dans `SEES_EVERYTHING` et le test le vérifie. C'est conforme à DECISION-103 A3, qui remplace q191.
- Le droit distinct « voir les contenus restreints » n'existe pas encore (prévu V4). Avant V4, l'administrateur est donc limité, ce qui est la position fail-closed attendue.
- Contournements administrateur identifiés pour V1 : voir V0-03 (le journal d'audit restitue le contenu) et V0-05 (deux administrateurs peuvent s'ajouter mutuellement à un groupe fixe, même classe que SEC-RL-04).

## 4. Migration 080 : PASS

- `tenant_id NOT NULL` avec FK `tenants`. FK composites `(tenant_id, user_id|granted_by|revoked_by) → users (tenant_id, id)`, dont la clé unique existe depuis 069.
- Les deux fonctions déclarent `SET search_path = pg_catalog, public, pg_temp` (avec `pg_temp` en dernier), répété par `ALTER FUNCTION`.
- Gardes en place : DELETE (trigger), TRUNCATE (trigger d'instruction), `REVOKE DELETE, TRUNCATE` sur `grc_app_runtime`.
- Immuabilité : tout le contenu est figé, la révocation n'a lieu qu'une fois et n'est jamais annulée, l'insertion se fait forcément en état actif, et la forme de la révocation est vérifiée par CHECK.
- Auto-attribution interdite par `CHECK (granted_by <> user_id)`. Index unique partiel sur l'accès actif.
- Le script est idempotent (`IF NOT EXISTS`, `OR REPLACE`, `DROP TRIGGER IF EXISTS`). Les colonnes ont le défaut `CLIENT` et une contrainte CHECK. Aucun `DELETE FROM` métier.
- INFO V0-07 : (a) `resource_id` n'a pas de FK, puisque la cible est polymorphe. Rien n'empêche donc en base un accès pointant une ressource d'un autre client : le service V1 doit faire la vérification préalable dans le client (patron EvidenceService). (b) `revoked_at` est libre (antérieur à `granted_at` ou dans le futur) ; on peut le forcer à `now()` dans le trigger. (c) `grant_reason`/`revoke_reason` acceptent les caractères de contrôle (classe SEC-PNL3-03) ; il faut passer par `isAcceptableReason` côté service. (d) Le fichier down supprime la table et les accès accordés sans trace d'audit. C'est documenté et ne concerne que le retour arrière.

## 5. Lectures non filtrées : inventaire et risque si une ressource passe en PERIMETRE

**Peut-on écrire une visibilité autre que CLIENT dès V0 ?** Non par l'application. Aucun `INSERT`/`UPDATE` ne cite `visibility`, `buildUpdateSet` reçoit des correspondances de colonnes fixes, aucune route ne lit ce champ, et rien n'apparaît dans le seed ni dans le frontend. Seul un SQL direct (DBA, migration) le peut. Le risque V0 est donc nul. Il se matérialise dès que V1 écrit PERIMETRE ou NOMINATIF.

Lectures qui contournent le filtre, toutes tenant-scopées mais **sans visibilité** :

| Zone | Points | Effet en V1 |
|---|---|---|
| Tableaux de bord | `DashboardService` (14 lectures), `DashboardScopeResolver`, `ActionPlanService.dashboard` (`GET /action-plan-dashboard/actions` lit `actions.list` sans scope alors que `list` est filtré) | contenu complet des ressources restreintes |
| Rapports | `reports.routes.ts` : compliance, risk-committee, consolidated, department, appetite-vs-residual, kri-consolidated | idem, et exportable |
| Cartographie | `CartographyService` (`risks.list`) | positionnement et libellé des risques restreints |
| Lectures liées | `ControlService.listCoveringRisk` (`?coveringRiskId=`), `ActionPlanService.listForRisk`/`listLinks`, `RiskDeviceViewService`, `RiskEvaluation(View)Service`, `KriService`/`KriMeasureService` (héritage q193/q195 non appliqué), `KpiMeasureService`, `ControlExecution`/`ControlEffectiveness`, `FindingService`, `RaciAssignmentService`, `ProcessService`, `TreatmentDecisionService`, `RiskOwnershipService` | contenu et existence par la ressource parente |
| KPI | `KpiService.update`/`setActive`/`archive` via `requireKpi` non filtré, qui renvoie le KPI complet | lecture et écriture à l'aveugle d'un KPI masqué (incohérent avec Risk/Control/Anomaly/ActionPlan) |
| Validation des liens | `AnomalyService.create` (controlId/riskId), `ActionPlanService` (sources/liens) | oracle d'existence et rattachement à une ressource masquée |
| Audit | `GET /audit-logs` (`entityId`, `old_value`/`new_value` complets) | restitution du contenu restreint à tout porteur de `audit.read` hors groupes « voit tout » (rôle ordinaire autorisé, administrateurs compris par ce biais) |
| Notifications | `NotificationService`/`GovernanceNotifier` (titres, destinataires) | à revoir en V1 |
| Recherche / export / import | aucune route de recherche ni d'export dédiée trouvée ; `riskImport` est en écriture seule | sans objet |

## Constats

### V0-01 — Scope optionnel = fail-open au câblage (LOW, CVSS V1 3,1 ; V0 0)
- `scope?: ReadScope` absent veut dire aucun filtre, sur les 5 interfaces. Tous les services gardent `visibility?` optionnel (patron « paramètre optionnel » appliqué pour les tests). Un oubli de câblage dans `server.ts`, ou un nouvel appelant, lit donc tout sans signal.
- Reco A06 : avant V1, rendre explicite la lecture interne (par exemple `scope: ReadScope | "INTERNAL"`, obligatoire sur `getById`/`list`), ou ajouter un test garde-fou qui vérifie que chaque service lecteur des 5 ressources reçoit `visibilityResolver` dans `server.ts`.
- Test de régression : instancier les services comme `server.ts` et vérifier qu'un acteur `{ all: false }` ne lit pas une ligne PERIMETRE par `get`, `list` et `dashboard`.

### V0-02 — Inventaire des lectures non filtrées (MEDIUM en V1, CVSS 4,3 ; V0 0)
- Voir le tableau §5. En V1, un utilisateur `risk.read` hors périmètre lit une ressource restreinte via dashboard, rapports, cartographie, `?coveringRiskId=` ou les vues 360.
- Reco A05/A06 : V1 ne doit écrire PERIMETRE/NOMINATIF qu'après avoir branché (ou désactivé) chacun de ces chemins. Gate de livraison V1 : retest A10 de l'inventaire complet.

### V0-03 — Le journal d'audit contourne la visibilité et q197 A3 (MEDIUM en V1, CVSS 4,3 ; V0 0)
- `audit_logs.old_value/new_value` contiennent la ressource complète. Par défaut, `audit.read` n'est porté que par le groupe Audit, qui voit déjà tout (051, seed). Mais `RoleService` n'interdit les permissions `audit.*` que sur les groupes RM et Comité : un rôle ORDINAIRE peut les porter. Un administrateur (`role.create`/`role.update`) crée ou modifie un rôle avec `audit.read`, un second administrateur le lui affecte (même classe que SEC-RL-04). L'administrateur lit alors le contenu restreint par `GET /audit-logs?entityId=` sans le droit distinct A3.
- Décision HUMAN/A05 requise avant V1 : filtrer les valeurs d'audit des entités non visibles pour le lecteur, ou réserver `audit.*` au groupe Audit.

### V0-04 — KPI : mutations et liens sans filtre (LOW en V1, CVSS 3,1)
- `requireKpi` (KpiService) et la validation des liens (AnomalyService.create, ActionPlanService) utilisent `getById` sans scope. Reco A06 : passer par `get(actor, …)` comme Risk/Control.

### V0-05 — « Voit tout » atteignable par deux administrateurs (INFO, classe SEC-RL-04)
- L'appartenance à Audit ou au Comité donne désormais la lecture de tout le contenu. Le maker-checker empêche l'auto-affectation, mais deux administrateurs suffisent. À faire porter par la décision SEC-RL-04 (HUMAN).

### V0-06 / V0-07 — INFO
- Voir §2 et §4.

## Statut
FINDING_IDENTIFIED (V0-01 à V0-04 à lever avant V1). Owners : A06 (V0-01, V0-02, V0-04, V0-06), A07 (V0-07), HUMAN/A05 (V0-03, V0-05). CLOSED ne vaut pas validation Risk, Compliance ou Privacy.
