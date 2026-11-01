# Revue Sécurité A10 — lot V1 visibilité des ressources (2026-11-01)

- Cible : `git diff origin/staging...feat/r1-visibility-v1` (HEAD `ae07c61`), 54 fichiers.
- Références : SEC-visibility-v0 (V0-02/03/04 à lever), DECISION-102/103/104, spec `RM-V1-Visibilite-Ressources-spec.md` (62bbab4).
- Méthode : analyse statique + `npx vitest run` de `visibility-v1`, `visibility-v0`, `QA-visibility-v0`, `RoleService`, `RiskService`, `QA-B6a11`, `QA-panel-migrations`, `QA-panel2-migrations`, `boundedArray`, `QA-B8-groups` : 179 verts, 32 ignorés (suites PostgreSQL locales, sans base). Aucun accès Neon. Aucun code de production modifié.

**Escalade HUMAN : aucune** (CVSS maximal 4,9). **Verdict : ORANGE.** V0-02/03/04 sont levés pour le périmètre V1 (risques et enfants hérités). Deux contournements du modèle restent ouverts (V1-01, V1-02) et doivent être corrigés ou explicitement acceptés avant de livrer V1.

## 1. Retest V0-02 / V0-03 / V0-04

| Constat V0 | Résultat | Détail |
|---|---|---|
| V0-02 lectures non filtrées | **RETEST_PASS (périmètre risque)** | Plus aucun `SYSTEM_SCOPE` sur une lecture de `risks` faite pour un lecteur. Restent en `SYSTEM_SCOPE` des lectures internes sans restitution : `ProcessEvaluationModeRequestService.getRiskOwners` (couples id/propriétaire, affichage), `ProcessService.assertNoActiveReferences` (refus d'archivage, message sans id), `RiskEvaluationService.resolveScaleForInherent` (après `get` filtré), `KriMeasureService.persistBreach` (destinataires propriétaire/N+1, qui voient le risque), `DashboardScopeResolver` (risques dont le lecteur est propriétaire, donc visibles), script de backfill. Tableaux de bord (14 lectures), rapports (tous via `DashboardService`), cartographie, vue dispositif, contexte d'évaluation, `?coveringRiskId=`, évaluations, décisions de traitement, KRI, mesures de KRI, RACI d'un risque, validation des liens (anomalie, plan, KRI, contrôle, RACI, cadre) : filtrés. Aucun SQL brut sur `risks` hors `PostgresRiskRepository` et `visibilityFilter.ts`. Aucune route d'export ou de recherche. Câblage `server.ts` vérifié : les 7 services qui utilisent `hiddenIds` reçoivent bien `riskRepository`. Reste V1-03. |
| V0-03 journal d'audit | **RETEST_PASS** | `assertRolePermissionRules` refuse `audit.read` hors groupe AUDIT, en création et en modification. `governance-rights` ne déplace que les 4 droits de décision. Le circuit Audit ne touche que le groupe AUDIT. `users.roles` n'a aucun écrivain applicatif, et 081 l'a nettoyé. Le seed ne pose `audit.read` que sur le groupe Audit. Migration 081 : retrait sur les rôles non-AUDIT (supprimés compris) et sur `users.roles`, une ligne d'audit par objet, compte technique suspendu, idempotente, aucune suppression ; le down ne restaure rien (voulu). |
| V0-04 KPI et liens | **PASS (liens) / sans objet (KPI)** | Les liens vers un risque passent par le scope du lecteur. `KpiService.requireKpi` reste en `SYSTEM_SCOPE`, mais aucun écrivain de `kpis.visibility` ≠ CLIENT n'existe avant V2. À reprendre en V2. |

**`audit.mission.*` / `audit.finding.*` non restreints** : DECISION-104 dit littéralement « refuser `audit.*` sur tout rôle hors groupe Audit ». L'implémentation ne restreint que `audit.read`. Côté sécurité, l'écart est faible : ces objets sont propres à l'Audit et ne restituent pas le contenu d'un risque. Seul résidu : `FindingService.assertRelatedObjectExists` valide un `relatedObjectId` RISK en `SYSTEM_SCOPE`, ce qui fait un oracle d'existence pour un porteur ordinaire de `audit.finding.create` (INFO). **Accord HUMAN requis** : soit le texte de la décision est restreint à `audit.read`, soit le code est aligné sur `audit.*`.

## 2. `risk_visible_to` (migration 082) : PASS

- Les trois niveaux sont conformes à la spec §3 et à I-3. CLIENT : tout le monde. PERIMETRE : propriétaire, N+1, RACI (`entity_type = 'RISK'`, `deleted_at IS NULL`), responsable du processus, groupe du département (`user_roles` actif joint à `roles` sur `tenant_id`, jamais `users.department_id`), plus la liste. NOMINATIF : liste et propriétaire. Groupes RM, Comité et Audit : appartenance active.
- Fail-closed : un risque absent ou d'un autre client renvoie faux, un `p_user` NULL n'ouvre que CLIENT, et une valeur inconnue est bloquée par le CHECK (sinon seuls propriétaire, liste et groupes passent).
- `LANGUAGE sql STABLE`, **pas de SECURITY DEFINER** (droits de l'appelant, correct). `SET search_path = pg_catalog, public, pg_temp` dans la définition, répété par `ALTER FUNCTION`. Idempotente.
- Injection : l'id du lecteur est interpolé, mais seulement après validation par une regex UUID stricte, et il vient de l'identité authentifiée. Les alias sont des littéraux fixes.
- INFO : `processes.deleted_at` n'est pas testé, donc le responsable d'un processus archivé garde l'accès. La fonction est évaluée par ligne sur `list` (coût, pas de faille).

## 3. Modification de visibilité (q194) : PASS avec réserve V1-02

- `PUT /risks/:id/visibility` : `get()` filtré d'abord (404 si invisible), puis `resourcevisibility.set` **ou** propriétaire (`sameUserId`). Motif obligatoire, 1 à 500 caractères, `isAcceptableReason`. Audit `PERMISSION_CHANGE` (avant/après + `widening`) dans la même transaction (`runAudited`, verrou `FOR UPDATE`). Les accès sont révoqués par `revoked_at`, jamais supprimés. Repasser à CLIENT révoque toute la liste.
- `resourcevisibility.set` n'est accepté que sur le groupe RM (`assertRolePermissionRules`, `FIXED_GROUP_PERMISSIONS`). Migration 082 auditée. `grantedBy`/`changedBy` sont forcés à `actor.userId` et le champ est retiré du type d'entrée (`Omit`). `boundedArray` (50) partout.
- Pas d'auto-ajout, ni à la création ni à la modification. L'auto-désignation comme propriétaire reste refusée (`assignOwner`).
- Création : NOMINATIF n'est possible que pour un « voit tout ». PERIMETRE exige que le créateur soit membre du groupe du département ou responsable du processus. Le risque et la liste sont créés dans une seule transaction. La voie « créer restreint puis s'ajouter » est fermée.
- q199 : notification au groupe RM si le propriétaire élargit, sans le titre du risque, en best effort. q204 reste ouvert.
- INFO : l'action d'audit est `PERMISSION_CHANGE` et non `VISIBILITY_CHANGE`/`ACCESS_GRANT` (spec §5). Le rejeu idempotent ne compare pas `accessUserIds`. `GET /:id/visibility` donne la liste nominative à tout lecteur du risque (point pour Privacy, cf. q205).

## 4. Oracle : PASS avec réserve

- Risque, évaluation, décision et KRI masqués répondent comme un objet absent : 404 sur les lectures par id, et le même `ValidationError("… does not exist in this tenant")` sur les liens. Notifications : aucun titre de risque.
- **Écart (V1-04)** : `GET /raci?entityType=RISK&entityId=` et `GET /controls?coveringRiskId=` renvoient 404 pour un risque masqué, mais 200 `[]` pour un id inexistant, car `hiddenIds` ne connaît que les lignes existantes.

## 5. KRI filtrés après lecture (point 6) : PASS, écart de conception

- `keepReadableByRisk` filtre en mémoire, avec une seule requête `hiddenIds` par appel. `kris.list` n'est pas paginé et les totaux (`/kris/dashboard`, résumés) sont calculés après le filtre : aucun écart de compte ni de page aujourd'hui. `listForKri` (mesures, paginé) vérifie le KRI avant de lire. Les KRI `coveredRiskIds` masqués sont retirés.
- Ce filtrage contredit la spec §6 (« en SQL, avant pagination »). Il deviendra une fuite dès qu'une pagination ou un `total` sera ajouté à `kris.list`. `riskChildVisibilityClause` existe mais n'est utilisé nulle part. Reco : brancher cette clause dans `PostgresKriRepository.list` avant toute pagination.
- INFO intégrité : `KriService.addCoveredRisks`/`replaceCoveredRisks` reconstruit l'ensemble des risques couverts. Un éditeur qui ne voit pas un risque couvert masqué le supprime sans le savoir s'il renvoie l'ensemble qu'il voit.

## 6. Administrateur sans droit A3 (point 7) : FAIL, V1-01

- `VisibilityResolver` n'inclut pas l'administrateur, `risk_visible_to` non plus. Le journal d'audit lui est fermé (q203). Il ne peut ni s'auto-affecter un rôle, ni s'auto-ajouter à une liste, ni se désigner propriétaire ou responsable de processus.
- **Mais** `RoleService.update` ne bloque l'édition d'un rôle détenu que pour `permissions`, pas pour `departmentId`. Voir V1-01.

## Constats

### V1-01 — Un administrateur seul entre dans le périmètre d'un département (MEDIUM, CVSS 4,9 `AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:N/A:N`, PROBABLE, statique)
- Scénario : l'administrateur (`role.update`) retire le lien département D du groupe de D (`PUT /roles/:id {departmentId: null}`), puis lie D à un rôle qu'il détient déjà (`PUT /roles/:own {departmentId: D}`). `assertDepartmentLinkable` n'exige que l'unicité, et le contrôle SEC-002 « rôle détenu » ne porte que sur `permissions`. Si D n'a pas encore de groupe, une seule étape suffit. `risk_visible_to` le compte alors comme membre du groupe de D : il lit tous les risques PERIMETRE de D, avec leurs enfants. Pas de second regard ; c'est audité, mais rien ne le signale.
- Contredit q197 A3 (DECISION-103). NOMINATIF n'est pas touché.
- Reco A06 : appliquer le refus « rôle détenu » à `departmentId` (lien et retrait), et le lien ou retrait sur un rôle porté par l'acteur passe par un autre administrateur. Test de régression : un administrateur qui lie son propre rôle à un département reçoit 403, et `risk_visible_to` reste faux.

### V1-02 — Le périmètre change sans `resourcevisibility.set`, sans motif ni notification (MEDIUM, CVSS 5,4 `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N`, CONFIRMED par lecture)
- `RiskService.update` (`risk.update`) modifie `ownerDepartmentId`/`processId` d'un risque PERIMETRE, ce qui remplace un groupe de département entier par un autre et ouvre l'accès à un nouveau département ou à un nouveau responsable de processus. Ce n'est pas tracé comme un changement de visibilité : pas de `widening`, pas de motif, pas de notification q199. `assignSuperiorOwner` et la RACI ajoutent aussi des lecteurs, mais ils sont des critères de périmètre voulus par la spec (à confirmer, INFO).
- Classe CLAUDE.md « un effet de bord se gate comme l'action qu'il produit réellement ». Reco A06 : sur un risque non CLIENT, refuser dans `update()` tout changement de département ou de processus sans `resourcevisibility.set` ou sans être propriétaire, avec motif et marquage `widening`, ou exiger de passer par `setVisibility`. Décision A05/HUMAN si l'on préfère l'accepter.

### V1-03 — Anomalies et plans d'action rattachés à un risque restreint restent lisibles (LOW, CVSS 3,1, CONFIRMED)
- `AnomalyService.list`, `DashboardService.getOpenAnomalies`/vue exécutive/vue département, et `ActionPlanService.list`/`dashboard` (`SYSTEM_SCOPE`) renvoient l'anomalie ou le plan avec `riskId`/`sourceId` et leur texte, qui peut décrire le risque. La spec §1 les fait hériter du risque. Ce n'est pas branché en V1 (racines V2). Le nombre d'anomalies ouvertes de la vue exécutive inclut aussi celles des risques masqués.
- Reco : à brancher en V2 (A06), ou acceptation explicite du résidu jusqu'à V2 (HUMAN/A13).

### V1-04 — Oracle d'existence 404/200 (LOW, CVSS 2,7)
- Voir §4. Reco A06 : renvoyer 404 aussi pour un risque inexistant (`getById` lecteur) sur ces deux routes.

### INFO
- Écart DECISION-104 `audit.*` / `audit.read` (accord HUMAN), oracle `FindingService`, KRI filtrés en mémoire, perte silencieuse de liens KRI masqués, processus archivé, libellés d'audit, rejeu idempotent, liste nominative visible des lecteurs (Privacy).

## Statut
FINDING_IDENTIFIED. V0-02/V0-03 : RETEST_PASS (V0-02 limité aux risques et enfants hérités, V1-03 résiduel). V0-04 : PASS (liens), KPI reporté en V2. Owners : A06 (V1-01, V1-02, V1-04, KRI SQL), HUMAN/A05 (acceptation V1-02 éventuelle, V1-03 jusqu'à V2, écart `audit.*`). Gate : retest A10 de V1-01/V1-02 avant livraison V1. CLOSED ne vaut pas validation Risk, Compliance ou Privacy.
