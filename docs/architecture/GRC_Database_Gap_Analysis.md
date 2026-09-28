# GRC Database Gap Analysis

Statut : Adopté (2026-09-28) — deuxième des 3 artefacts du gate posé par
le Product Owner avant tout travail base de données (voir
`.claude/agent-context/SHARED_LOG.md`, entrée « Arbitrage du Product
Owner » du 2026-09-28).

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

Ce point relève d'une décision Architecture/Produit — voir la ligne
**ARBITRER** correspondante en §2.5 pour le tranchage formel attendu
avant toute suppression de code ou de table.

---

## 2. Classification par entité

Légende : **RÉUTILISER** (aucun changement de schéma) · **ÉTENDRE**
(colonnes/FK nullables additives) · **CRÉER** (nouvelle table) ·
**DÉPRÉCIER** (objet existant devenant redondant) · **ARBITRER**
(décision humaine requise avant de coder).

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
| `Risk` | **ÉTENDRE** | `risks` (003, étendue en `011`/`021` pour ownership) : ajout `risk_catalog_id uuid REFERENCES risk_catalogs (id)` **nullable** (Expand — FK posée avant tout backfill, jamais `NOT NULL` immédiat vu que `risk_catalogs` est une table neuve et vide au départ). Table `risk_processes` (N:N `Risk`↔`Process`) **non créée ici** — dépend de l'arbitrage §37.A du cahier des charges, voir §2.5 ARBITRER. |
| `RiskCause` / `RiskCatalogCause` | **CRÉER** | `risk_causes` (`id`, `tenant_id`, `label`, `description`) + `risk_catalog_causes` (`risk_catalog_id`, `risk_cause_id`, clé composite). |
| `Document` / `document_links` | **CRÉER** | `documents` (`id`, `tenant_id`, `reference`, `title`, `type`, `version`, `status`, `location`, `effective_from`, `effective_until`) + `document_links` (`id`, `tenant_id`, `object_type` whitelist, `object_id`, `document_id`). |
| `RiskCategory` | **RÉUTILISER** | `risk_categories` (024) déjà auto-référencée (`parent_id`), `name`, `active`. Pas de changement de schéma requis pour l'entité elle-même — voir §2.5 pour l'arbitrage sur son usage en FK depuis `RiskCatalog`/`RiskAppetite`/`RiskEvaluation`. |

### 2.4 Risk Management (Domain Model §5)

| Entité | Classification | Détail |
|---|---|---|
| `RiskAssessment` | **DÉPRÉCIER** | Voir §1. Table `risk_assessments` conservée (aucun `DROP`), plus aucun nouveau développement dessus. |
| `RiskEvaluation` | **RÉUTILISER** | `risk_evaluations` (019, `CHECK` étendu en 026) couvre déjà intégralement le besoin cible confirmé en §1 — devient le « Risk Assessment » de référence du modèle cible, sans changement de schéma. |
| `RatingScale` | **RÉUTILISER** | `rating_scales` (018) couvre déjà probabilité/impact/axes/vélocité/persistance/maîtrise en JSONB versionné. |
| `RiskAppetite` | **RÉUTILISER** | `risk_appetites` (017) — schéma inchangé ; la résolution `(subCategory, entity)` reste en texte libre (voir §2.5 pour l'arbitrage FK). |
| `Kpi` / `Kri` / `KpiMeasure` / `KriMeasure` / `kri_risks` | **RÉUTILISER** | `kpis`/`kpi_measures` (016), `kris`/`kri_risks`/`kri_measures` (020) couvrent déjà le besoin — voir §2.5 pour la confirmation du choix « deux entités plutôt qu'un `Indicator` unique ». |

### 2.5 Points ARBITRER (Risk Management / Référentiel)

| Sujet | Options | Position dev-db |
|---|---|---|
| **`RiskAssessment` vs `RiskEvaluation`** (voir §1) | (a) Déprécier `RiskAssessment` au profit de `RiskEvaluation` [recommandé ici] · (b) Réactiver `RiskAssessment` en lui donnant un rôle distinct (ex. cotation rapide hors workflow) · (c) Supprimer physiquement `RiskAssessment` immédiatement | Recommande (a), mais la suppression de code (`domain/entities/RiskAssessment.ts` etc.) et de table reste **soumise à sign-off Architecture/PO** avant exécution — un agent Dev DB ne se déclare pas lui-même autorisé à trancher une décision d'architecture (`.claude/agents/dev-db.md` §1). |
| **FK `RiskCategory` depuis `RiskCatalog.category` / `RiskAppetite.subCategory` / `RiskEvaluation.subCategory`** | (a) Ajouter les FK nullables maintenant (Expand) · (b) Garder en texte libre tant qu'aucun besoin de reporting croisé ne l'exige | Le Domain Model documente cet écart comme déjà connu et non tranché dans le code source lui-même — décision à prendre en amont de toute migration touchant ces trois tables, car elle change la forme des colonnes concernées. |
| **`risk_processes` (N:N `Risk`↔`Process`)** | (a) Créer la table de liaison (cahier des charges §37.A tranché positivement) · (b) Ne pas la créer, `Risk.process` texte libre suffit | Non créée par anticipation dans ce document (cohérent avec la directive « toute nouvelle table doit être justifiée par une Gap Analysis, pas supposée nécessaire par défaut », SHARED_LOG 2026-09-28 point 3). |
| **`Kpi`/`Kri` séparés vs `Indicator` unifié** | (a) Statu quo (deux tables) [recommandé] · (b) Fusionner en une table `indicators` avec discriminant `type` | Une fusion serait une refonte destructive de deux tables en production (016, 020) sans bénéfice fonctionnel identifié — recommande explicitement de **ne pas fusionner**, mais formalise ici le point pour clôture actée plutôt que laissée implicite. |

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
| **RÉUTILISER** | 22 | `Tenant`, `Department`, `User`, `Role`/`RoleAssignment`, `AuditEvent`, `RiskCategory`, `RiskEvaluation`, `RatingScale`, `RiskAppetite`, `Kpi`, `Kri`, `KpiMeasure`, `KriMeasure`, `kri_risks`, `ControlExecution`, `ControlEffectivenessAssessment`, `Anomaly`, `ActionLink`, `RegulatoryFramework`/`ModuleToggle`/`Config`, `Notification`/`NotificationSubscription`, `ReviewCycle`, `Feedback`/`TenantBranding` |
| **ÉTENDRE** | 4 | `Process` (+`department_id`), `Risk` (+`risk_catalog_id`), `Control` (+`sample_size`/`sample_size_rule`), `ActionPlan` (élargissement `CHECK source_type`) |
| **CRÉER** | 12 (regroupements de tables) | `RiskCatalog`, `RaciAssignment`, `evidence_links`, `Comment`/`CommentableObjectConfig`, `RiskCause`/`RiskCatalogCause`, `Document`/`document_links`, `Incident`, `RiskIncident`, `ChecklistItem`/`ChecklistResult`, `AuditMission`, `Finding` |
| **DÉPRÉCIER** | 1 | `RiskAssessment` (table `risk_assessments`) au profit de `RiskEvaluation` |
| **ARBITRER** | 4 | `RiskAssessment` vs `RiskEvaluation` (tranchage formel de la recommandation §1.2) · FK `RiskCategory` depuis 3 tables · `risk_processes` N:N · confirmation `Kpi`/`Kri` non fusionnés |

Ce comptage part de la base « 24 EXISTANT + 4 EXISTANT_À_ÉTENDRE + ~12
NOUVEAU » du Domain Model (§12) et l'affine au niveau schéma réel : `Evidence`
sort de la liste ÉTENDRE au niveau colonnes (aucune colonne modifiée sur
`evidences` elle-même, seulement une table de liaison neuve, reclassée en
CRÉER) ; `Department` sort de la liste ÉTENDRE (aucun champ requis,
confirmé RÉUTILISER) ; `RiskAssessment` (compté dans les 24 EXISTANT du
Domain Model) est reclassé DÉPRÉCIER suite à l'investigation de code
réelle menée ici.
