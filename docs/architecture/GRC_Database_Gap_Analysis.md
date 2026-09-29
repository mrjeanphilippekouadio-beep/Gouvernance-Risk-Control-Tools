# GRC Database Gap Analysis

Statut : Adopté (2026-09-28), **révisé (2026-09-28)**, **corrigé
(2026-09-29)** — deuxième des 3
artefacts du gate posé par le Product Owner avant tout travail base de
données (voir `.claude/agent-context/SHARED_LOG.md`, entrée « Arbitrage
du Product Owner » du 2026-09-28). Révision : les 4 points laissés
`ARBITRER` par la version initiale (commit `96b7949`) ont été tranchés
par le Product Owner le même jour (`.claude/agent-context/SHARED_LOG.md`,
entrée « Arbitrage des 4 points ouverts de la Gap Analysis ») et
répercutés ici, à la suite de la mise à jour du Domain Model par
l'Architecte (`GRC_Target_Domain_Model.md`, commit `89c2be0`).

**Correction du 2026-09-29 (Architecte)** : la version précédente de ce
document affirmait, en §2.3 et en §2.5, que `risks.process_id` existait
déjà « en relation 1:1 ». **Cette affirmation était fausse** — vérifiée
par lecture directe des migrations : `003_risks.sql:4` déclare
`process text NOT NULL` et aucune migration `001` → `028` n'ajoute
jamais de colonne `process_id` sur `risks`. L'arbitrage `risk_processes`
du 2026-09-28, qui s'appuyait sur cette prémisse, a été **rouvert par le
Product Owner puis refait le 2026-09-29** : le verdict reste « ne pas
créer `risk_processes` », mais il repose désormais sur les faits
corrects (voir **§2.5bis**), et une FK 1:1 **réelle**
(`risks.process_id`) est créée par DECISION-006.

Intrant : `docs/architecture/GRC_Target_Domain_Model.md` (Architecte,
commit `54b20f0`). Confronté ici à l'état réel de
`database/postgresql/migrations/001_extensions.sql` →
`026_governance.sql` (26 migrations appliquées, dernier numéro utilisé :
**026**) et aux implémentations réelles dans
`backend/src/infrastructure/database/postgres/Postgres*Repository.ts`
(pas seulement `backend/src/domain/entities/`, qui peut décrire une
table jamais câblée — voir §1 ci-dessous).

Sert d'intrant à : `docs/architecture/GRC_Migration_Plan.md` (troisième
artefact).

Rôle : Agent Dev DB (A07). Ce document est une **self-review technique**,
pas une validation indépendante (voir `.claude/agents/dev-db.md` §41) —
les points marqués **ARBITRER** requièrent un tranchage humain (Product
Owner / Architecture) avant tout code, conformément à la mission confiée.

---

## 1. Point de vigilance prioritaire : `RiskAssessment` vs `RiskEvaluation`

### 1.1 Constat d'investigation

Inspection complète des deux chaînes de code :

| | `RiskAssessment` | `RiskEvaluation` |
|---|---|---|
| Entité TS | `domain/entities/RiskAssessment.ts` | `domain/entities/RiskEvaluation.ts` |
| Interface repository | `domain/repositories/RiskAssessmentRepository.ts` (`getLatest`, `getHistory`, `getAsOf`, `create`) | `domain/repositories/RiskEvaluationRepository.ts` |
| **Implémentation Postgres** | **AUCUNE** — pas de `PostgresRiskAssessmentRepository.ts` | `infrastructure/database/postgres/PostgresRiskEvaluationRepository.ts` |
| Service | **AUCUN** | `services/RiskEvaluationService.ts` (create, recordInherentScoring, recordMasteryAssessment, recordResidualScoring, validate, reject, validateByCommittee) |
| Routes API | **AUCUNE** | `api/v1/riskEvaluations.routes.ts` |
| Câblage `server.ts` | **AUCUN** (`grep RiskAssessment backend/src/server.ts` → 0 résultat) | Câblé |
| Table SQL | `risk_assessments` (migration `003_risks.sql`) — **table créée mais jamais écrite ni lue par le code applicatif** | `risk_evaluations` (migration `019_risk_evaluations.sql`, `CHECK status` étendu en `026_governance.sql` pour `VALIDE_COMITE`) |
| Index dédié | `risk_assessments_risk_effective_idx` (`005_indexes.sql`) — sur une table jamais alimentée | `risk_evaluations_tenant_risk_idx`, `risk_evaluations_tenant_status_idx` |
| Modèle | Simple : `probability`, `impact`, `inherentScore`, `residualProbability/Impact/Score`, versionné par ligne | Complet : axes d'impact multiples (JSONB), maîtrise par ligne de défense L1/L2/L3, workflow `BROUILLON → VALIDATED/REJECTED/VALIDE_COMITE`, comparaison à l'appétence, méthodologie versionnée (`RatingScale`) |

**Conclusion factuelle** : `RiskAssessment` est un artefact de
scaffolding — entité + interface + table SQL + index posés au tout début
du projet (migration `003`, la même que `risks`), jamais raccordé à un
service ni une route. Aucune ligne n'a jamais pu être insérée dans
`risk_assessments` par l'application (le seul point d'entrée possible,
`RiskAssessmentRepository.create`, n'a pas d'implémentation concrète
instanciable). `RiskEvaluation` est la chaîne complète, en production
(9 modules déjà livrés au 2026-09-27, retestée en sécurité SEC-011/
SEC-015), et couvre strictement un sur-ensemble du besoin de
`RiskAssessment` : probabilité/impact simple (via `inherentProbability`/
`inherentScore`) **plus** maîtrise, appétence, méthodologie versionnée,
workflow de validation à quatre yeux.

### 1.2 Arbitrage proposé

**`RiskEvaluation` est le « Risk Assessment » cible du cahier des
charges §7.1.C** (troisième maillon `Risk Catalog → Risk → Risk
Assessment`, distinction 1 du Domain Model). `RiskAssessment` (entité,
interface repository, table `risk_assessments`) est **DÉPRÉCIÉ** — non
pas par choix de conception a posteriori, mais parce que le code réel
montre qu'il n'a jamais été le chemin retenu : `RiskEvaluation` a été
construit, testé et livré à sa place sans jamais que `RiskAssessment`
soit débranché explicitement (probable scaffolding initial de
migration `003`, remplacé par la suite sans nettoyage).

Ce n'est **pas** une fusion (les deux modèles ne se recouvrent pas
champ à champ et fusionner casserait le contrat déjà stable de
`RiskEvaluation`) ni une coexistence légitime (aucun rôle distinct
identifiable pour `RiskAssessment` — même finalité, sous-ensemble strict
de champs, même position dans le cycle `Risk → ?`).

**Stratégie de dépréciation (jamais de suppression brutale, cf.
Expand/Contract, §16 de `.claude/agents/dev-db.md`)** :

1. **Ne rien supprimer en base immédiatement.** `risk_assessments` et
   son index restent en place — coût de stockage nul (table vide),
   aucun risque à la laisser exister le temps de l'arbitrage humain.
2. **Geler le code mort côté application** (hors périmètre de ce
   document, qui ne touche aucun fichier de code — action à confier à
   @dev-backend/@architect) : ne plus référencer
   `domain/entities/RiskAssessment.ts` ni
   `domain/repositories/RiskAssessmentRepository.ts` dans tout nouveau
   développement ; les marquer `@deprecated` en commentaire en attendant
   suppression de code (pas de DB) lors d'un batch de nettoyage validé.
3. **Validation requise avant toute suppression physique de la table** :
   confirmer par une requête (`SELECT count(*) FROM risk_assessments`)
   qu'elle est vide en production/staging, obtenir le sign-off explicite
   de l'Architecte (qui a soulevé le point de vigilance) et du Product
   Owner, puis seulement à ce moment planifier un `DROP TABLE` dans une
   migration ultérieure dédiée et documentée — jamais dans le même lot
   qu'une fonctionnalité.
4. **Ne pas router de nouvelle fonctionnalité vers `RiskAssessment`.**
   Toute évolution future du « scoring simple » se fait sur
   `RiskEvaluation` (déjà versionné, déjà workflow-validé).

**Tranché par le Product Owner le 2026-09-28** (`.claude/agent-context/SHARED_LOG.md`,
entrée « Arbitrage des 4 points ouverts de la Gap Analysis ») : la
recommandation (a) ci-dessus est confirmée sans réserve. `RiskEvaluation`
est l'**unique** implémentation technique du concept métier « Risk
Assessment » du cahier des charges §7.1.C — il ne s'agit plus d'une
ambiguïté à lever mais d'un fait acquis pour la suite du projet.
`RiskAssessment` (entité, interface repository, table `risk_assessments`)
reste **DÉPRÉCIÉ**, jamais réactivé ni fusionné. Seule la suppression
physique de la table reste soumise à un sign-off ultérieur explicite
(Architecture + Product Owner) — non tranchée à ce stade et hors
périmètre de ce lot, conformément à la stratégie d'Expand/Contract
décrite ci-dessus (§1.2, points 1 à 4). Le Domain Model (`GRC_Target_Domain_Model.md`
§5.1/§5.2, commit `89c2be0`) documente la même conclusion.

---

## 2. Classification par entité

Légende : **RÉUTILISER** (aucun changement de schéma) · **ÉTENDRE**
(colonnes/FK nullables additives) · **CRÉER** (nouvelle table) ·
**CONSOLIDER** (fusion non destructive de plusieurs tables déjà en
production vers un modèle physique unique — Expand/Contract avec
backfill et période de coexistence, jamais un simple `CRÉER`) ·
**DÉPRÉCIER** (objet existant devenant redondant) · **ARBITRER**
(décision humaine requise avant de coder — statut historique : les 4
points laissés ouverts par la première version de ce document ont tous
été tranchés par le Product Owner le 2026-09-28, voir §2.5).

### 2.1 Organisation (Domain Model §1)

| Entité | Classification | Détail |
|---|---|---|
| `Tenant` | **RÉUTILISER** | `tenants` (002, 006, 023, 024) couvre déjà `deploymentMode`, `driveFolderId`, branding, `active`. |
| `Department` | **RÉUTILISER** | `departments` (002 + `011_departments_fields.sql`) porte déjà `entity`, `manager`, `riskOwner` + traçabilité de désignation. Le Domain Model confirme explicitement « aucun champ nouveau requis à ce stade » — RACI (§2.2) couvre le besoin de co-responsabilité formelle sans toucher au schéma `departments`. |
| `Process` | **ÉTENDRE** | `processes` (012) n'a **pas** de colonne `department_id` — vérifié par lecture directe de `012_processes.sql`, confirmant le doute soulevé par le Domain Model (§1.3 : « implicite aujourd'hui — voir Gap Analysis »). Ajout proposé : `department_id uuid REFERENCES departments (id)` **nullable** (Expand ; un `Process` existant sans département reste valide, migration future de backfill optionnelle, jamais de `NOT NULL` immédiat). Le rattachement documentaire structuré (`document_links`) est traité en §2.4, pas une colonne sur `processes`. |
| `User` | **RÉUTILISER** | `users` (002) couvre `email`, `displayName`, `roles` (bootstrap legacy). |

### 2.2 Capacités transverses (Domain Model §2)

| Entité | Classification | Détail |
|---|---|---|
| `Role` / `RoleAssignment` / `Permission` | **RÉUTILISER** | `roles`/`user_roles` (013) déjà append-only (`granted_by`, pas de `revoked_at`… — vérifier lors de la migration si un `revoked_at` manque ; à date, `user_roles` sert de source pour le RBAC en place, aucun changement structurel requis par le Domain Model). |
| `RaciAssignment` | **CRÉER** | Table `raci_assignments` : `id`, `tenant_id`, `object_type` (whitelist `CHECK`, même patron que `action_plans.source_type`), `object_id`, `user_id`, `role` (`R`/`A`/`C`/`I`), `assigned_by`, `assigned_at`, `revoked_at` (append-only, jamais de `DELETE`). Colonnes structurantes seulement — pas de DDL complet ici. |
| `Evidence` | **ÉTENDRE** | `evidences` (003, FK `control_execution_id` ajoutée en 008) reste inchangée telle quelle (rétro-compatible). Extension = **nouvelle table** `evidence_links` (`id`, `tenant_id`, `evidence_id`, `object_type` whitelist, `object_id`, `linked_by`, `linked_at`, `description`) — techniquement un CRÉER, classé ici sous l'entité `Evidence` parce que le Domain Model le documente comme son extension N:N. |
| `Comment` / `CommentableObjectConfig` | **CRÉER** | `comments` : `id`, `tenant_id`, `object_type`, `object_id`, `author_id`, `body`, `created_at`, `edited_at` (nullable), `deleted_at` (soft delete). `commentable_object_configs` : `id`, `tenant_id`, `object_type`, `enabled`. |
| `AuditEvent` | **RÉUTILISER** | `audit_log` (004) déjà append-only strict (`AuditRepository` n'expose ni `update` ni `delete`, cf. `CLAUDE.md` §Domaine Audit). Aucune extension de schéma requise — seulement de nouveaux appels `AuditRepository.record` depuis les futurs services, hors périmètre DB. |

### 2.3 Référentiel (Domain Model §4)

| Entité | Classification | Détail |
|---|---|---|
| `RiskCatalog` | **CRÉER** | `risk_catalogs` : `id`, `tenant_id`, `reference`, `name`, `definition`, `risk_category_id` (FK nullable vers `risk_categories`), `status`, `regulatory_references`. |
| `Risk` | **ÉTENDRE** | `risks` (003, étendue en `011`/`021` pour ownership) : **(1)** ajout `risk_catalog_id uuid REFERENCES risk_catalogs (id)` **nullable** (Expand — FK posée avant tout backfill, jamais `NOT NULL` immédiat vu que `risk_catalogs` est une table neuve et vide au départ) ; **(2)** ajout `process_id uuid REFERENCES processes (id)` **nullable** (Expand, **requis par DECISION-006** — le mode d'évaluation Classique/Participatif est porté par le `Process`, ce qui suppose une référence réelle et non un libellé). **Correction factuelle du 2026-09-29** : la version précédente de cette ligne affirmait que `risks.process_id` existait déjà « en relation 1:1 » — **c'est faux**. `003_risks.sql:4` déclare `process text NOT NULL`, aucune migration `001` → `028` n'ajoute de colonne `process_id` sur `risks`, et `backend/src/domain/entities/Risk.ts:11` type `process: string` (texte libre, sans intégrité référentielle, affiché tel quel par `CartographyService`/`DashboardService`). La colonne texte `risks.process` est **conservée en parallèle** jusqu'au backfill (Expand/Contract, aucun `DROP` dans ce lot). Table `risk_processes` (N:N `Risk`↔`Process`) : **non créée** — arbitrage **refait le 2026-09-29 par l'Architecte** sur la prémisse corrigée, verdict inchangé mais motivé autrement : la FK 1:1 `risks.process_id` **suffit** à tous les besoins identifiés dans ce document et dans le Migration Plan ; le N:N n'est pas « différé faute de temps », il est **écarté faute de besoin métier confirmé**. Motivation complète et critère de réouverture : **§2.5bis**. |
| `RiskCause` / `RiskCatalogCause` | **CRÉER** | `risk_causes` (`id`, `tenant_id`, `label`, `description`) + `risk_catalog_causes` (`risk_catalog_id`, `risk_cause_id`, clé composite). |
| `Document` / `document_links` | **CRÉER** | `documents` (`id`, `tenant_id`, `reference`, `title`, `type`, `version`, `status`, `location`, `effective_from`, `effective_until`) + `document_links` (`id`, `tenant_id`, `object_type` whitelist, `object_id`, `document_id`). |
| `RiskCategory` | **RÉUTILISER** (table elle-même) — **CRÉER** (usage en FK, tranché) | `risk_categories` (024) déjà auto-référencée (`parent_id`), `name`, `active` — aucun changement de schéma requis sur la table elle-même. **Tranché par le Product Owner le 2026-09-28** : `risk_categories` est confirmée référentiel **canonique**, et **3 FK nullables** sont créées vers elle depuis `RiskCatalog.riskCategoryId`, `RiskAppetite.riskCategoryId` et `RiskEvaluation.riskCategoryId` (voir §2.3 `RiskCatalog`, §2.4 `RiskAppetite`/`RiskEvaluation`), chacune en Expand/Contract complet : FK nullable → backfill applicatif → contrôle → bascule applicative → dépréciation du champ texte libre correspondant — **jamais de `DROP` immédiat** des colonnes `category`/`subCategory` texte. Détail du séquencement : `GRC_Migration_Plan.md` §2 Lot E. |

### 2.4 Risk Management (Domain Model §5)

| Entité | Classification | Détail |
|---|---|---|
| `RiskAssessment` | **DÉPRÉCIER** | Voir §1. Table `risk_assessments` conservée (aucun `DROP`), plus aucun nouveau développement dessus. |
| `RiskEvaluation` | **ÉTENDRE** | `risk_evaluations` (019, `CHECK` étendu en 026) couvre déjà intégralement le besoin cible confirmé en §1 — devient le « Risk Assessment » de référence du modèle cible. Ajout `risk_category_id uuid REFERENCES risk_categories (id)` **nullable** (Expand, décision Product Owner du 2026-09-28, §2.3) en complément du `subCategory` texte libre existant, conservé jusqu'à bascule actée. |
| `RatingScale` | **RÉUTILISER** | `rating_scales` (018) couvre déjà probabilité/impact/axes/vélocité/persistance/maîtrise en JSONB versionné. |
| `RiskAppetite` | **ÉTENDRE** | `risk_appetites` (017). Ajout `risk_category_id uuid REFERENCES risk_categories (id)` **nullable** (Expand, décision Product Owner du 2026-09-28, §2.3) ; la résolution `(subCategory, entity)` reste en texte libre en parallèle jusqu'à bascule actée — pas de suppression immédiate. |
| `Kpi` / `Kri` / `KpiMeasure` / `KriMeasure` / `kri_risks` | **CONSOLIDER** | **Revirement du Product Owner (2026-09-28) par rapport à l'hypothèse par défaut de la première version de ce document** (statu quo recommandé alors). Les 4 tables/liens existants (`kpis`/`kpi_measures` en 016, `kris`/`kri_risks`/`kri_measures` en 020, déjà en production) sont **consolidés** vers un modèle physique unique `indicators`/`indicator_measures` (+ `indicator_risks`, remplace `kri_risks`). Détail complet en §2.4bis ci-dessous — traité avec la même prudence que la dépréciation `RiskAssessment` (§1), **pas un simple `CRÉER`**. |

### 2.4bis Consolidation `Kpi`/`Kri` → `Indicator` (**CONSOLIDER**)

**Le changement le plus lourd de ce lot.** Il ne s'agit **pas** de créer
une table de plus (`CRÉER`) : c'est la **consolidation non destructive
de deux tables déjà en production** (`kpis`/`kpi_measures`, `kris`/
`kri_measures`/`kri_risks`) **vers un modèle physique unique**, à
traiter avec la même prudence méthodologique que la dépréciation
`RiskAssessment` (§1) — la différence étant qu'ici les tables sources
sont réellement alimentées en production, contrairement à
`risk_assessments` qui était vide. Aucun raccourci « fusion = un
`CREATE TABLE` puis un `DROP TABLE` » n'est acceptable.

**Revirement du Product Owner (2026-09-28)** par rapport à
l'hypothèse par défaut de la première version de ce document (qui
recommandait le statu quo, deux tables séparées). KPI et KRI restent
**deux types métier distincts** (statuts, finalité, seuils — rien ne
change côté utilisateur ni côté vocabulaire produit) mais partagent
désormais un seul modèle physique de stockage.

**Nouvelles tables (Expand)** :

1. `indicators` — remplace `kpis`/`kris`. Colonnes communes à tous les
   indicateurs (`id`, `tenant_id`, `indicator_type` `CHECK IN ('KPI','KRI')`
   discriminant immuable après création, `label`, `frequency`,
   `description`, `active`, audit trail `created_at`/`updated_at`/
   `deleted_at`/`deleted_by`/`deletion_reason`) + colonnes spécifiques
   KPI **nullables** (`target_value`, `unit`, `owner`, `department_id`,
   `process_id`) + colonnes spécifiques KRI **nullables**
   (`threshold_green`/`threshold_orange`/`threshold_red`, `formula`,
   `risk_id` — obligatoire pour un KRI, `entity`, `methodology_version`).
   Intégrité : un `CHECK` SQL conditionné à `indicator_type` (les
   colonnes KPI `NOT NULL` seulement si `indicator_type = 'KPI'`, les
   colonnes KRI `NOT NULL` seulement si `indicator_type = 'KRI'`) — même
   patron que la règle « au moins un de `department_id`/`process_id` »
   déjà en place sur `kpis` aujourd'hui. Pas de JSONB fourre-tout, pas de
   sous-table par type — colonnes typées et contraintes au niveau SQL,
   conformément à la modélisation retenue par l'Architecte
   (`GRC_Target_Domain_Model.md` §5.5).
2. `indicator_measures` — remplace `kpi_measures`/`kri_measures`.
   `id`, `tenant_id`, `indicator_id` (FK `indicators`), `value`,
   `measured_at`, `recorded_by`. Append-only. Le type de l'indicateur
   (donc la fonction de statut à appliquer côté service —
   `computeKpiStatus`/`computeKriStatus` restent deux fonctions pures
   distinctes, jamais fusionnées) se résout par jointure sur
   `indicators.indicator_type`, jamais dupliqué sur la mesure.
3. `indicator_risks` — remplace `kri_risks` (N:N, pertinent uniquement
   pour les indicateurs de type KRI).

**Backfill obligatoire (Migrate)** : `indicators`/`indicator_measures`
sont peuplées par une **migration applicative** (lecture de
`kpis`/`kris`/`kpi_measures`/`kri_measures`, écriture dans les tables
neuves, préservation des identifiants et horodatages), **pas un `INSERT
INTO ... SELECT` SQL brut en masse** — cohérent avec le pattern déjà
établi ailleurs dans ce dépôt pour les backfills sensibles (cf. `037` en
§2.3 `Risk.risk_catalog_id`, qui exclut également tout backfill SQL de
masse dans la migration DDL elle-même). Détail opérationnel :
`GRC_Migration_Plan.md` §2 Lot E.

**Période de coexistence (Switch progressif)** : le temps de la bascule,
les deux jeux de tables coexistent. Les services applicatifs migrent
progressivement de `kpis`/`kris` vers `indicators`, soit par
double-écriture (nouvelle mesure/indicateur écrit dans l'ancien et le
nouveau modèle), soit par une vue de compatibilité en lecture le temps
que tous les lecteurs (API, rapports) soient basculés — le choix précis
entre ces deux mécanismes relève de l'implémentation (Dev Backend), pas
de cette Gap Analysis, mais l'un des deux est requis avant toute
dépréciation.

**Dépréciation (Contract), pas suppression** : `kpis`, `kris`,
`kpi_measures`, `kri_measures` ne sont **dépréciées** (marquage,
gel de nouveaux développements) qu'une fois la bascule applicative
validée — jamais de `DROP TABLE` dans ce lot. La suppression physique
des quatre anciennes tables reste **soumise à un sign-off ultérieur**
(Architecture + Product Owner), exactement comme pour `risk_assessments`
(§1.2) — **hors périmètre de ce lot**.

**Confirmation explicite** : aucune opération destructive
(`DROP TABLE`, `DROP COLUMN`, changement de type) n'intervient dans ce
lot sur `kpis`/`kris`/`kpi_measures`/`kri_measures`. Les quatre tables
restent lisibles et inscriptibles pendant toute la période de
coexistence.

### 2.5 Points ARBITRER — **tous tranchés par le Product Owner le 2026-09-28**

Les 4 points laissés ouverts par la première version de ce document
(commit `96b7949`) ont tous été arbitrés par le Product Owner
(`.claude/agent-context/SHARED_LOG.md`, entrée « Arbitrage des 4 points
ouverts de la Gap Analysis », 2026-09-28) et répercutés dans le Domain
Model (`GRC_Target_Domain_Model.md`, commit `89c2be0`). Cette section
est conservée à titre de trace historique — aucun de ces points ne
reste ouvert. **Un de ces arbitrages (`risk_processes`) reposait sur une
prémisse factuellement fausse ; il a été rouvert par le Product Owner et
refait le 2026-09-29 — voir §2.5bis.**

| Sujet | Options envisagées | Décision retenue (Product Owner, 2026-09-28) |
|---|---|---|
| **`RiskAssessment` vs `RiskEvaluation`** (voir §1) | (a) Déprécier `RiskAssessment` au profit de `RiskEvaluation` [recommandé par dev-db] · (b) Réactiver `RiskAssessment` en lui donnant un rôle distinct · (c) Supprimer physiquement `RiskAssessment` immédiatement | **(a) confirmé.** `RiskEvaluation` est l'implémentation technique unique. `RiskAssessment` reste déprécié (table conservée, aucun `DROP`) ; sa suppression physique reste soumise à un sign-off ultérieur distinct. |
| **FK `RiskCategory` depuis `RiskCatalog.category` / `RiskAppetite.subCategory` / `RiskEvaluation.subCategory`** | (a) Ajouter les FK nullables maintenant (Expand) [recommandé par dev-db] · (b) Garder en texte libre tant qu'aucun besoin de reporting croisé ne l'exige | **(a) retenu.** `risk_categories` confirmée canonique ; 3 FK nullables créées (voir §2.3 `RiskCatalog`, §2.4 `RiskAppetite`/`RiskEvaluation`), Expand/Contract complet, jamais de `DROP` immédiat du texte libre. |
| **`risk_processes` (N:N `Risk`↔`Process`)** | (a) Créer la table de liaison (cahier des charges §37.A) · (b) Ne pas la créer | **(b) retenu — mais sur une prémisse fausse, arbitrage REFAIT le 2026-09-29.** La justification d'origine (« `risks.process_id` existe déjà en 1:1 ») était **erronée** : cette colonne n'a jamais existé, `risks.process` est du texte libre (`003_risks.sql:4`). Le Product Owner a rouvert le point le 2026-09-29 ; l'Architecte l'a rejugé sur les faits corrects et **confirme (b)** — motivation entièrement réécrite en **§2.5bis**, qui fait désormais foi sur ce sujet. |
| **`Kpi`/`Kri` séparés vs `Indicator` unifié** | (a) Statu quo (deux tables) [recommandé par dev-db] · (b) Fusionner en un modèle physique unique avec discriminant `indicatorType` | **(b) retenu — revirement par rapport à la recommandation dev-db.** KPI et KRI restent deux types métier distincts mais partagent désormais un seul modèle physique `indicators`/`indicator_measures`. Traité en détail, avec toute la prudence d'une consolidation de tables en production, en §2.4bis ci-dessus. |

### 2.5bis `risk_processes` — arbitrage refait le 2026-09-29 (Architecte)

**Verdict : la FK 1:1 `risks.process_id` suffit. `risk_processes`
(N:N) n'est pas créée — écartée faute de besoin métier, pas différée
faute de temps.**

**Fait corrigé** : `risks.process_id` **n'existait pas**
(`003_risks.sql:4` = `process text NOT NULL` ; aucune migration `001` →
`028` ne l'ajoute). Il n'y avait donc aucune « relation 1:1 existante »
à préserver — le champ était pire que ce que le document supposait :
du texte libre sans aucune intégrité référentielle. DECISION-006
(2026-09-29, PO) crée la vraie FK `risks.process_id → processes(id)`,
nullable, `risks.process` texte conservé en parallèle jusqu'au backfill.
**La correction de la prémisse ne change pas le verdict, elle change sa
motivation** : ce qui manquait n'était pas le N:N, c'était toute
intégrité référentielle — et c'est exactement ce que la FK 1:1 apporte.

**Pourquoi le 1:1 suffit** (preuves) :

1. **Aucun besoin N:N confirmé nulle part.** Le cahier des charges
   v0.1 §37.A pose « un risque peut-il être rattaché à plusieurs
   processus ? » comme une **question ouverte**, et sa table de
   cardinalités (§31) écrit « Processus → Risque : **1:N ou N:N selon le
   modèle retenu** » — le CDC délègue la décision, il ne l'impose pas.
   Aucune autre ligne d'aucun document (UX Brief, Migration Plan,
   Domain Model) n'exprime un cas d'usage multi-processus.
2. **Les données réelles sont mono-valuées.** `RiskImportService`
   (import des `Suivi_Risques` legacy) calque
   `apps-script-legacy/02_Colonnes.gs` : une seule colonne `PROCESSUS`
   (`PROCESS_ALIASES`, schéma Zod `process: z.string().min(1)`). Toutes
   les lignes existantes et importables portent exactement un processus.
   Une table N:N serait créée et backfillée avec une seule ligne par
   risque.
3. **Le besoin « un même risque touche plusieurs processus » est déjà
   absorbé par la séparation Catalogue/Registre déjà actée.**
   `GRC_Target_Domain_Model.md` §4.1 : « un `RiskCatalog` peut donner
   naissance à zéro, un ou plusieurs `Risk` (registre) dans différents
   départements/processus ». Le même risque générique instancié sur 5
   processus = 1 `RiskCatalog` → 5 `Risk`, chacun avec son propriétaire,
   ses évaluations et son appétence. Ajouter `risk_processes`
   créerait un **second mécanisme concurrent pour le même besoin** —
   exactement la pathologie diagnostiquée par DECISION-003 (5 whitelists
   polymorphes divergentes décrivant toutes « quels objets GRC
   existent »).
4. **La hiérarchie `processes` répond déjà au cas « risque à cheval sur
   plusieurs sous-processus ».** `012_processes.sql` : `parent_id` +
   `level CHECK IN ('PROCESS','SUBPROCESS','ACTIVITY')`. Un risque
   transverse se rattache au nœud parent `PROCESS`, pas à N activités.
   DECISION-006 s'appuie déjà sur cette même hiérarchie (mode réglé au
   niveau `PROCESS`, hérité vers `SUBPROCESS`/`ACTIVITY`).
5. **Le N:N casserait DECISION-006.** Le mode Classique/Participatif est
   un **scalaire**, résolu une seule fois à la création d'une
   `RiskEvaluation` et figé en instantané (`RiskEvaluation.evaluationMode`).
   Avec N processus par risque, « quel mode s'applique ? » devient
   indécidable sans un drapeau `is_primary` — c'est-à-dire une FK 1:1
   déguisée, plus un invariant supplémentaire (« exactement un principal
   par risque ») qu'aucune contrainte SQL n'exprime proprement. Coût
   ajouté, bénéfice nul.
6. **Le N:N fausserait les agrégations de lecture existantes.**
   `CartographyService` expose `CartographyDataPoint.process: string` et
   pousse un point par risque (`points.push({ ..., process: risk.process })`) ;
   `DashboardService.DashboardRiskSummary.process: string` de même. Avec
   un N:N, soit un risque est tracé une fois par processus — il compte
   3 fois dans la heatmap et dans la distribution de criticité, donnant
   une exposition fausse au Comité/BCEAO — soit on choisit un processus
   principal, et on est revenu au 1:1.
7. **Cohérence avec la chaîne de responsabilité déjà en place.**
   `Risk.ownerDepartmentId` est N:1 et `RiskOwnership` désigne un
   propriétaire + un propriétaire supérieur. Un risque de registre a
   **une** chaîne d'imputabilité ; le rattacher à N processus
   (potentiellement de départements différents) contredirait ce modèle
   sans qu'aucun besoin ne le demande.
8. **Asymétrie de coût et réversibilité totale.** Ne pas créer
   `risk_processes` coûte zéro : c'est une table neuve, ajoutable plus
   tard en pur Expand, `risks.process_id` devenant alors le raccourci
   « processus principal » sans réécriture ni migration destructive. La
   créer maintenant coûte une migration + repository + service +
   permissions + entrées de whitelist + écran, **plus** la résolution des
   ambiguïtés (5) et (6), pour des données aujourd'hui mono-valuées.

**Critère de réouverture (à exiger, ne pas rouvrir sans)** : une
expression métier explicite du Product Owner ou du Risk Manager décrivant
un cas réel où **un même risque de registre** doit être piloté sur
plusieurs processus **avec une seule évaluation partagée** (si les
évaluations sont distinctes, la réponse reste Catalogue → N `Risk`).
Même règle que DECISION-003 pour le moteur polymorphe : un **second cas
d'usage réel confirmé**, jamais un cas anticipé.

**Points de vigilance ouverts par la FK 1:1 (à ne pas perdre)** :

- **Backfill partiel attendu** : `risks.process` est du texte libre ;
  rien ne garantit qu'une valeur corresponde à un `processes.name`
  existant. `process_id` reste nullable, et
  `CartographyService`/`DashboardService` doivent continuer à afficher le
  libellé texte tant que la requête de contrôle post-backfill n'a pas
  été revue (même séquencement Expand/Contract que les 3 FK
  `RiskCategory`, §2.3).
- **Pas de double source de vérité durable** : une fois le backfill
  validé, `risks.process` doit cesser d'être écrit par l'application
  (phase Contract), sans quoi les deux champs divergeront.
- **`Control.process` est du texte libre lui aussi**
  (`backend/src/domain/entities/Control.ts:15`) : même lacune
  référentielle, **hors périmètre de cet arbitrage**, mais la même
  logique de FK 1:1 s'appliquera le jour où le sujet sera ouvert — à
  tracer, pas à traiter ici.

### 2.6 Incidents (Domain Model §6)

| Entité | Classification | Détail |
|---|---|---|
| `Incident` | **CRÉER** | `incidents` : `id`, `tenant_id`, `reference`, `title`, `description`, `department_id`, `process_id`, `severity`, `status` (`OPEN`/`INVESTIGATING`/`CONTAINED`/`RESOLVED`/`CLOSED`), `declared_by`, `responsible_user_id`, `occurred_at`, `detected_at`, `contained_at`, `resolved_at`. Vélocité/Persistance = **fonctions calculées**, aucune colonne stockée (distinction 5, confirmée réutilisable — même patron que `computeKriStatus`). |
| `RiskIncident` | **CRÉER** | `risk_incidents` (`risk_id`, `incident_id`, `linked_at`, `linked_by`). Candidat à l'exception « table de lien pure » `DELETE`+`INSERT` (comme `control_risks`) — à confirmer en Migration Plan selon si un historique fin des liens est requis. |

### 2.7 Contrôle interne (Domain Model §7)

| Entité | Classification | Détail |
|---|---|---|
| `Control` | **ÉTENDRE** | `controls` (007) : ajout `sample_size integer` **nullable** et `sample_size_rule text` **nullable** (Expand — cahier des charges §12.1, champs structurés distincts de `procedure_description`/`expected_evidence` en texte libre, conservés inchangés). |
| `ChecklistItem` / `ChecklistResult` | **CRÉER** | `checklist_items` (`id`, `tenant_id`, `control_id`, `order`, `label`, `mandatory`) + `checklist_results` (`id`, `tenant_id`, `control_execution_id`, `checklist_item_id`, `checked`, `comment`, `anomaly_id` nullable). |
| `ControlExecution` | **RÉUTILISER** | `control_executions` (008) inchangée — `ChecklistResult` référence `control_execution_id` sans modifier cette table. |
| `ControlEffectivenessAssessment` | **RÉUTILISER** | `control_effectiveness_assessments` (009) déjà conforme. |
| `Anomaly` | **RÉUTILISER** | `anomalies` (010) — `control_id`/`control_execution_id`/`risk_id` déjà tous nullables. Le point ouvert « `Anomaly` source directe d'`ActionPlan` » est traité en §2.8 (extension de `action_plans.source_type`), pas un changement sur `anomalies`. |

### 2.8 Plans d'action (Domain Model §8)

| Entité | Classification | Détail |
|---|---|---|
| `ActionPlan` | **ÉTENDRE** | `action_plans` (022) : `source_type CHECK IN ('RISK','CONTROL','KRI','AUDIT','INCIDENT','MANAGEMENT')` doit être élargi pour inclure `'ANOMALY'` et `'FINDING'`. Techniquement une modification de contrainte `CHECK`, pas une colonne — appliquée par `DROP CONSTRAINT` + `ADD CONSTRAINT` (même patron déjà utilisé pour `risk_evaluations_status_check` en `026_governance.sql`, précédent direct et sûr : les valeurs existantes restent valides, seul l'ensemble autorisé s'élargit — non destructif). |
| `ActionLink` | **RÉUTILISER** | `action_links` (022, `resource_type CHECK IN ('RISK','CONTROL','KRI','ANOMALY')`) déjà conforme aux liens secondaires du Domain Model. |

### 2.9 Audit (Domain Model §9)

| Entité | Classification | Détail |
|---|---|---|
| `AuditMission` | **CRÉER** | `audit_missions` : `id`, `tenant_id`, `reference`, `title`, `scope`, `status`, `lead_auditor_id`, `start_date`, `end_date`. |
| `Finding` | **CRÉER** | `findings` : `id`, `tenant_id`, `audit_mission_id`, `title`, `description`, `severity`, `recommendation`, `status`, `related_object_type`/`related_object_id` (polymorphe, whitelist). |

### 2.10 Gouvernance & transverse (Domain Model §10)

| Sujet | Classification | Détail |
|---|---|---|
| Lignes de défense (`DefenseLineMapping`) | **Non créée** (ni ÉTENDRE ni CRÉER) | `Control.defense_line` (texte libre) et `rating_scales.mastery_scale.defenseLines` (JSONB) jugés suffisants par le Domain Model — confirmé ici, aucune nouvelle table par anticipation. |
| Moteur de workflow générique | **Non créé** | Statuts par entité (`CHECK` + validation service) restent la source de vérité — cohérent avec ADR-001 et la directive ponytail du PO. |
| `RegulatoryFramework`, `ModuleToggle`, `Config`, `Notification`/`NotificationSubscription`, `ReviewCycle`, `Feedback`, `TenantBranding` | **RÉUTILISER** | Tables `regulatory_frameworks`/`module_toggles`/`configs` (024), `notifications`/`notification_subscriptions` (025), `review_cycles` (026), `feedback` (014), branding sur `tenants` (023) — aucune n'est concernée par un écart identifié dans le Domain Model. |

---

## 3. Synthèse quantitative

| Catégorie | Nombre d'entités/tables | Liste |
|---|---|---|
| **RÉUTILISER** | 15 | `Tenant`, `Department`, `User`, `Role`/`RoleAssignment`, `AuditEvent`, `RiskCategory` (table elle-même), `RatingScale`, `ControlExecution`, `ControlEffectivenessAssessment`, `Anomaly`, `ActionLink`, `RegulatoryFramework`/`ModuleToggle`/`Config`, `Notification`/`NotificationSubscription`, `ReviewCycle`, `Feedback`/`TenantBranding` |
| **ÉTENDRE** | 6 | `Process` (+`department_id`), `Risk` (+`risk_catalog_id`, +`process_id` — DECISION-006, 2026-09-29), `Control` (+`sample_size`/`sample_size_rule`), `ActionPlan` (élargissement `CHECK source_type`), `RiskEvaluation` (+`risk_category_id`, tranché 2026-09-28), `RiskAppetite` (+`risk_category_id`, tranché 2026-09-28) |
| **CRÉER** | 12 (regroupements de tables) | `RiskCatalog` (incl. FK `risk_category_id`), `RaciAssignment`, `evidence_links`, `Comment`/`CommentableObjectConfig`, `RiskCause`/`RiskCatalogCause`, `Document`/`document_links`, `Incident`, `RiskIncident`, `ChecklistItem`/`ChecklistResult`, `AuditMission`, `Finding` |
| **CONSOLIDER** | 1 (regroupement de 5 objets vers 3) | `Kpi`/`Kri`/`KpiMeasure`/`KriMeasure`/`kri_risks` → `indicators`/`indicator_measures`/`indicator_risks` (tranché 2026-09-28, revirement PO — voir §2.4bis) |
| **DÉPRÉCIER** | 1 | `RiskAssessment` (table `risk_assessments`) au profit de `RiskEvaluation` |
| **ARBITRER** | 0 (historique : 4) | Les 4 points ouverts de la première version de ce document sont tous tranchés — voir §2.5 pour la trace des décisions, et §2.5bis pour l'arbitrage `risk_processes` refait le 2026-09-29 sur prémisse corrigée. |

Ce comptage part de la base « 24 EXISTANT + 4 EXISTANT_À_ÉTENDRE + ~12
NOUVEAU » du Domain Model (§12) et l'affine au niveau schéma réel : `Evidence`
sort de la liste ÉTENDRE au niveau colonnes (aucune colonne modifiée sur
`evidences` elle-même, seulement une table de liaison neuve, reclassée en
CRÉER) ; `Department` sort de la liste ÉTENDRE (aucun champ requis,
confirmé RÉUTILISER) ; `RiskAssessment` (compté dans les 24 EXISTANT du
Domain Model) est reclassé DÉPRÉCIER suite à l'investigation de code
réelle menée ici. **Mise à jour du 2026-09-28** (arbitrage Product
Owner, `89c2be0`/`.claude/agent-context/SHARED_LOG.md`) : `RiskEvaluation`
et `RiskAppetite` passent de RÉUTILISER à ÉTENDRE (FK `RiskCategory`
nullable ajoutée à chacune) ; `Kpi`/`Kri`/`KpiMeasure`/`KriMeasure`/
`kri_risks` sortent de RÉUTILISER pour une nouvelle catégorie
**CONSOLIDER**, créée spécifiquement pour ce lot car ni RÉUTILISER
(le schéma change bel et bien) ni CRÉER (ce n'est pas une table neuve
indépendante — c'est le remplacement contrôlé de deux tables en
production) ne rendaient compte honnêtement de la nature de ce
changement ; les 4 points ARBITRER passent à 0, tous tranchés.
**Mise à jour du 2026-09-29** (correction factuelle + arbitrage refait,
Architecte) : `Risk` gagne `process_id` (FK réelle vers `processes`,
requise par DECISION-006) — la colonne n'existait pas, contrairement à
ce que ce document affirmait ; `risk_processes` (N:N) reste non créée,
verdict confirmé sur les faits corrects (§2.5bis).
