# GRC Migration Plan / Migration Protocol

Statut : Adopté (2026-09-28) — troisième et dernier des 3 artefacts du
gate posé par le Product Owner avant tout travail base de données (voir
`.claude/agent-context/SHARED_LOG.md`, entrée « Arbitrage du Product
Owner » du 2026-09-28).

Intrants : `docs/architecture/GRC_Target_Domain_Model.md` (Architecte,
`54b20f0`) et `docs/architecture/GRC_Database_Gap_Analysis.md` (Dev DB,
ce même lot). Ce document ne réécrit aucune migration réelle — c'est un
plan de séquencement, pas une implémentation. Aucun fichier
`database/postgresql/migrations/*.sql` n'est créé ni modifié ici.

Rôle : Agent Dev DB (A07), self-review technique (`.claude/agents/dev-db.md`
§41) — pas une validation indépendante.

---

## 1. Protocole de numérotation

### 1.1 Constat sur le format réel

Les 26 migrations existantes suivent strictement le format
`NNN_description.sql` avec `NNN` un entier séquentiel sur 3 chiffres,
zéro-préfixé, **sans trou ni horodatage** (`001_extensions.sql` →
`026_governance.sql`, vérifié par listing direct du dossier). Il n'y a
**pas** de composant date/heure dans le nom de fichier — passer à un
format horodaté (`20260928_x.sql`) casserait la convention déjà
établie et le tri lexicographique déjà exploité par
`npm run migrate` (qui applique les fichiers dans l'ordre, trackés dans
`schema_migrations`). **Ce document ne recommande donc pas de changer de
format** — la séquence `NNN` reste la bonne base, le risque de collision
vient de l'attribution du prochain `NNN` entre agents parallèles, pas du
format lui-même.

### 1.2 Règle explicite anti-collision

**Dernier numéro utilisé au 2026-09-28 : `026` (`026_governance.sql`).**

Directive actée (SHARED_LOG, Arbitrage du Product Owner, point 6) :
« collision de numérotation = vrai risque de processus, pas un
détail ». Règle retenue :

1. **Numérotation centralisée, pas de plage pré-réservée par lot/agent.**
   Une plage réservée (« 027-032 pour le lot RACI ») créerait un risque
   symétrique : un agent qui découvre en cours de travail qu'il lui faut
   une migration de plus déborde de sa plage et recrée la collision
   qu'on voulait éviter. À la place : **avant d'écrire toute nouvelle
   migration, l'agent (ou l'orchestrateur qui le dispatche) doit relire
   `ls database/postgresql/migrations/` pour constater le dernier `NNN`
   réel au moment de l'écriture** — jamais un numéro mémorisé ou deviné
   à l'avance (déjà la règle documentée dans `CLAUDE.md` §Amorçage point
   4 ; ce document la rend opérationnelle pour ce chantier précis).
2. **Un seul agent A07 (Dev DB) écrit les migrations de schéma DB à un
   instant donné sur ce chantier.** Le Domain Model / cette Gap
   Analysis a été produit par un seul agent en série ; si l'orchestrateur
   dispatche plusieurs agents A06/A07 en parallèle sur des lots
   différents du séquencement §2, **chacun doit tourner en
   `isolation: "worktree"`** (déjà la convention par défaut du dépôt
   pour A06, cf. `CLAUDE.md` §Amorçage point 2) et la fusion des
   worktrees se fait **une migration à la fois**, en renumérotant au
   moment de la fusion si deux agents ont indépendamment produit un même
   `NNN` — jamais en committant deux fichiers portant le même numéro.
3. **Un fichier de migration ne doit jamais être modifié après avoir été
   appliqué** (même règle qu'un commit git poussé) — une correction se
   fait par une nouvelle migration `NNN+1`, jamais par édition rétroactive
   d'un fichier déjà appliqué en dev/staging, pour ne pas désynchroniser
   `schema_migrations`.
4. **Chaque migration reste atomique et indépendante** : une seule
   responsabilité fonctionnelle par fichier (comme les 26 existantes —
   `007_controls.sql` ne touche que `controls`/`control_risks`), pour
   qu'un rollback ciblé reste possible sans dépendre d'un fichier fourre-tout.

### 1.3 Conséquence pratique pour ce plan

La séquence §2 ci-dessous **numérote de façon indicative** à partir de
`027`, mais chaque numéro doit être **reconfirmé au moment réel de
l'écriture** de la migration (règle 1.2.1) — si d'autres migrations sont
appliquées entre la publication de ce plan et son exécution, les numéros
indicatifs décalent tous d'autant, l'ordre relatif et les dépendances
restent eux inchangés.

---

## 2. Séquence de migrations

Alignée sur le séquencement déjà arbitré par le Product Manager
(`docs/Cahier_des_charges_GRC_v0.1.md`, ACTION_ITEMS 2026-09-28) : RACI
minimal → Checklist des contrôles → Incident → Audit Findings →
Référentiel → Commentaires → Gouvernance transverse. Chaque migration
suit Expand/Contract (`.claude/agents/dev-db.md` §16) : colonne/FK
**nullable** d'abord, contrainte finale (`NOT NULL`, etc.) **toujours
différée** à une migration ultérieure distincte, appliquée seulement
après confirmation que les données existantes sont prêtes — aucune de
ces migrations ne pose de contrainte bloquante en un seul temps.

### Lot A — RACI minimal (Risk / Control / ActionPlan)

| # (indicatif) | Contenu | Dépendances | Expand/Contract |
|---|---|---|---|
| `027_raci_assignments.sql` | `CREATE TABLE raci_assignments` (`id`, `tenant_id`, `object_type` `CHECK` whitelist initiale `('RISK','CONTROL','ACTION_PLAN')`, `object_id`, `user_id`, `role` `CHECK IN ('R','A','C','I')`, `assigned_by`, `assigned_at`, `revoked_at`). Index `(tenant_id, object_type, object_id)`. | `026_governance.sql` (dernière migration appliquée) ; FK vers `tenants`/`users` (002) | Table neuve, aucune donnée existante à migrer — pas de phase Expand/Contract nécessaire pour la création elle-même. La whitelist `object_type` est volontairement restreinte à 3 valeurs ici (RACI minimal) ; son élargissement futur (Lot C, D, F) est une modification de `CHECK` non destructive, jamais un `DROP`. |

### Lot B — Checklist des contrôles

| # (indicatif) | Contenu | Dépendances | Expand/Contract |
|---|---|---|---|
| `028_control_sample_fields.sql` | `ALTER TABLE controls ADD COLUMN sample_size integer NULL, ADD COLUMN sample_size_rule text NULL`. | `007_controls.sql` (table `controls`) | Expand pur : colonnes nullables, `procedure_description`/`expected_evidence` existants inchangés en fallback — aucune donnée à backfiller, aucune contrainte finale prévue (champs restent optionnels par nature, cahier des charges §12.1 ne les rend pas obligatoires rétroactivement sur les contrôles déjà créés). |
| `029_checklist_items_results.sql` | `CREATE TABLE checklist_items` (`id`, `tenant_id`, `control_id` FK `controls`, `order`, `label`, `mandatory boolean`) ; `CREATE TABLE checklist_results` (`id`, `tenant_id`, `control_execution_id` FK `control_executions`, `checklist_item_id` FK `checklist_items`, `checked boolean`, `comment`, `anomaly_id` FK nullable `anomalies`). | `028` (cohérence fonctionnelle du même lot, pas une dépendance technique dure) ; `007_controls.sql`, `008_control_executions.sql`, `010_anomalies.sql` | Tables neuves — pas de contrainte différée nécessaire ; `anomaly_id` nullable dès la conception (un item de checklist n'a pas systématiquement généré d'anomalie). |

### Lot C — Incident

| # (indicatif) | Contenu | Dépendances | Expand/Contract |
|---|---|---|---|
| `030_incidents.sql` | `CREATE TABLE incidents` (`id`, `tenant_id`, `reference`, `title`, `description`, `department_id` FK nullable, `process_id` FK nullable, `severity`, `status CHECK IN ('OPEN','INVESTIGATING','CONTAINED','RESOLVED','CLOSED')`, `declared_by`, `responsible_user_id`, `occurred_at`, `detected_at` nullable, `contained_at` nullable, `resolved_at` nullable). | `002_tenants_and_users.sql`, `002_tenants_and_users.sql` (departments), `012_processes.sql` | Table neuve. Les 4 timestamps sources sont nullables par construction (un incident `OPEN` n'a pas encore de `resolved_at`) — c'est la forme normale du cycle de vie, pas une dette Expand/Contract. Vélocité/Persistance restent des fonctions de service, jamais de colonne stockée (distinction 5 du Domain Model) — rien à migrer pour elles. |
| `031_risk_incidents.sql` | `CREATE TABLE risk_incidents` (`risk_id` FK, `incident_id` FK, `linked_at`, `linked_by`, clé composite `(risk_id, incident_id)`). | `030_incidents.sql`, `003_risks.sql` | Table de liaison neuve — candidate à l'exception « lien pur » `DELETE`+`INSERT` (comme `control_risks`) plutôt qu'un `deleted_at` propre, si confirmé lors de l'implémentation qu'aucune valeur métier ne dépend de l'historique fin du lien (cf. `CLAUDE.md` §Security-sensitive conventions, exception documentée). |
| `032_action_plan_source_types.sql` | `ALTER TABLE action_plans DROP CONSTRAINT action_plans_source_type_check; ALTER TABLE action_plans ADD CONSTRAINT action_plans_source_type_check CHECK (source_type IN ('RISK','CONTROL','KRI','AUDIT','INCIDENT','MANAGEMENT','ANOMALY','FINDING'))`. | `022_action_plans.sql` ; même patron que `026_governance.sql` pour `risk_evaluations_status_check` | Élargissement non destructif d'un `CHECK` — toutes les valeurs déjà en base restent valides, seul l'ensemble autorisé grandit. `'FINDING'` n'est utilisable en pratique qu'après le Lot D (`findings` créée) ; la contrainte l'autorise dès ce lot pour ne pas avoir à la ré-élargir au Lot D (moins de migrations sur la même colonne). |

### Lot D — Audit Findings

| # (indicatif) | Contenu | Dépendances | Expand/Contract |
|---|---|---|---|
| `033_audit_missions.sql` | `CREATE TABLE audit_missions` (`id`, `tenant_id`, `reference`, `title`, `scope`, `status`, `lead_auditor_id` FK `users`, `start_date`, `end_date`). | `002_tenants_and_users.sql` | Table neuve. |
| `034_findings.sql` | `CREATE TABLE findings` (`id`, `tenant_id`, `audit_mission_id` FK `audit_missions`, `title`, `description`, `severity`, `recommendation`, `status`, `related_object_type` nullable whitelist, `related_object_id` nullable). | `033_audit_missions.sql` | Table neuve ; `related_object_type`/`related_object_id` nullables dès la conception (un `Finding` n'est pas systématiquement rattaché à un objet GRC précis). Avec cette migration, `'FINDING'` posé au Lot C (`032`) devient effectivement exploitable côté service. |

### Lot E — Référentiel (catalogue / registre / évaluation)

| # (indicatif) | Contenu | Dépendances | Expand/Contract |
|---|---|---|---|
| `035_risk_catalogs.sql` | `CREATE TABLE risk_catalogs` (`id`, `tenant_id`, `reference`, `name`, `definition`, `risk_category_id` FK nullable `risk_categories`, `status`, `regulatory_references`). | `024_config.sql` (table `risk_categories`) | Table neuve, `risk_category_id` nullable (Expand — le lien FK est posé mais le catalogue peut exister sans catégorie assignée au départ). |
| `036_risk_causes.sql` | `CREATE TABLE risk_causes` (`id`, `tenant_id`, `label`, `description`) ; `CREATE TABLE risk_catalog_causes` (`risk_catalog_id` FK, `risk_cause_id` FK, clé composite). | `035_risk_catalogs.sql` | Tables neuves. |
| `037_risk_catalog_id_on_risks.sql` | `ALTER TABLE risks ADD COLUMN risk_catalog_id uuid NULL REFERENCES risk_catalogs (id)`. | `035_risk_catalogs.sql`, `003_risks.sql` | Expand strict : colonne nullable, **aucun backfill automatique dans cette migration** (les `risks` déjà en base n'ont pas de catalogue d'origine connu de façon fiable — un backfill applicatif, s'il est décidé, est un traitement de données séparé, hors DDL, validé au cas par cas). La contrainte `NOT NULL` finale (phase Contract) n'est **pas** incluse ici — elle ne serait envisageable que si le produit décide un jour de rendre le rattachement au catalogue obligatoire, ce qui n'est pas acté. |
| `038_documents.sql` | `CREATE TABLE documents` (`id`, `tenant_id`, `reference`, `title`, `type`, `version`, `status`, `location`, `effective_from`, `effective_until`) ; `CREATE TABLE document_links` (`id`, `tenant_id`, `object_type` whitelist, `object_id`, `document_id` FK `documents`). | `002_tenants_and_users.sql` | Tables neuves. |
| `039_process_department_id.sql` | `ALTER TABLE processes ADD COLUMN department_id uuid NULL REFERENCES departments (id)`. | `012_processes.sql`, `002_tenants_and_users.sql` | Expand : nullable, confirme et comble le doute explicitement soulevé par le Domain Model (§1.3) sur l'absence de cette FK. Pas de `NOT NULL` immédiat — un `Process` existant peut rester sans département tant qu'aucun backfill n'a été validé fonctionnellement. |
| `040_evidence_links.sql` | `CREATE TABLE evidence_links` (`id`, `tenant_id`, `evidence_id` FK `evidences`, `object_type` whitelist (`CONTROL_EXECUTION`, `INCIDENT`, `ANOMALY`, `ACTION_PLAN`, `AUDIT_FINDING`, `RISK_EVALUATION`, …), `object_id`, `linked_by`, `linked_at`, `description`). `evidences.control_execution_id` **reste inchangée**, jamais retirée (rétro-compatibilité explicite du Domain Model §2.3). | `003_risks.sql` (table `evidences`) ; `030_incidents.sql`, `010_anomalies.sql`, `022_action_plans.sql`, `034_findings.sql`, `019_risk_evaluations.sql` pour que la whitelist référence des types déjà existants | Extension additive pure : nouvelle table de liaison, ancienne relation 1:1 legacy conservée en parallèle (Expand permanent assumé, pas de Contract prévu — les deux mécanismes coexistent, cf. Domain Model §2.3). |

### Lot F — Commentaires configurables

| # (indicatif) | Contenu | Dépendances | Expand/Contract |
|---|---|---|---|
| `041_comments.sql` | `CREATE TABLE commentable_object_configs` (`id`, `tenant_id`, `object_type`, `enabled boolean`) ; `CREATE TABLE comments` (`id`, `tenant_id`, `object_type`, `object_id`, `author_id` FK `users`, `body`, `created_at`, `edited_at` nullable, `deleted_at` nullable). | `002_tenants_and_users.sql` | Tables neuves. `commentable_object_configs` doit être créée dans la **même migration ou avant** `comments` pour que le service applicatif puisse vérifier `enabled` dès le premier déploiement (dépendance fonctionnelle, pas seulement technique). |

### Lot G — Gouvernance transverse finale

| # (indicatif) | Contenu | Dépendances | Expand/Contract |
|---|---|---|---|
| `042_raci_whitelist_expansion.sql` | `ALTER TABLE raci_assignments DROP CONSTRAINT raci_assignments_object_type_check; ALTER TABLE raci_assignments ADD CONSTRAINT raci_assignments_object_type_check CHECK (object_type IN ('RISK','CONTROL','ACTION_PLAN','INCIDENT','ANOMALY','KRI','AUDIT_MISSION','FINDING'))`. | `027_raci_assignments.sql` (Lot A), `030_incidents.sql`, `034_findings.sql` | Élargissement non destructif de whitelist — même patron que `032`. Ce lot ferme la boucle « RACI conçu au Lot A avec whitelist minimale, exposé complètement une fois tous les objets GRC créés » (directive « ordre de livraison ≠ dépendances techniques », Domain Model §0.2). |
| `043_risk_assessment_deprecation_note.sql` | **Optionnelle, conditionnée au sign-off Architecture/PO** (voir Gap Analysis §1.2/§2.5) — si et seulement si validée : documentation en commentaire SQL (`COMMENT ON TABLE risk_assessments IS 'DEPRECATED ...'`) marquant `risk_assessments` comme gelée. **Aucun `DROP TABLE` inclus dans ce plan** — une suppression physique éventuelle ferait l'objet d'une migration séparée, plus tard, hors de ce plan, après confirmation que la table est vide et sign-off explicite. | `003_risks.sql` | Marquage non destructif uniquement — conforme à la règle absolue §4. |

---

## 3. Règle de rétrocompatibilité

Chaque migration de ce plan doit rester utilisable avec le code
applicatif en version **N-1** (migration N appliquée, backend pas encore
redéployé avec le code qui l'exploite) :

- **Toute nouvelle colonne est nullable ou a un `DEFAULT`.** Le code en
  version N-1 qui ne connaît pas encore la colonne continue ses
  `INSERT`/`UPDATE` sans la renseigner — aucune requête existante ne se
  met à échouer. Vérifié pour chacune des migrations du plan (`028`,
  `037`, `039` : toutes nullables sans `DEFAULT` requis).
- **Toute nouvelle table est additive et non référencée en `NOT NULL`
  par une table existante.** Le code en version N-1 ignore simplement la
  table — aucune requête existante ne la joint obligatoirement.
- **Tout élargissement de `CHECK`/whitelist (`032`, `042`) est
  strictement additif** : l'ensemble de valeurs autorisées après
  migration est un sur-ensemble de l'ensemble avant migration. Le code
  N-1, qui n'écrit jamais les nouvelles valeurs, continue de fonctionner
  identiquement ; le code N (une fois déployé) peut commencer à écrire
  les nouvelles valeurs sans attendre une seconde migration.
- **Aucune migration de ce plan ne renomme ni ne retype une colonne
  existante.** Un renommage ou changement de type casserait le code N-1
  qui référence encore l'ancien nom/type — si un tel besoin apparaît
  plus tard, il suit la séquence Expand (ajouter la nouvelle
  colonne) → Migrate (écrire les deux) → Switch (lire la nouvelle) →
  Contract (retirer l'ancienne, migration séparée, après confirmation
  qu'aucun code ne la lit plus) — jamais un seul `ALTER COLUMN` en
  production.
- **Ordre de déploiement recommandé** : migration DB avant déploiement
  du code qui l'exploite (le sens inverse — code déployé avant migration
  — casserait sur une colonne/table absente). Neon étant serverless,
  aucune fenêtre de maintenance dédiée n'est requise pour ces migrations
  (uniquement des `CREATE TABLE`/`ADD COLUMN NULL`/changement de
  `CHECK` — aucune ne verrouille une table volumineuse ni ne réécrit
  des lignes existantes).

---

## 4. Rappel absolu : aucune opération destructive

Conformément à `.claude/agents/dev-db.md` §15-16 et à la directive du
Product Owner (SHARED_LOG, Arbitrage 2026-09-28, point 4 : « Expand/Contract
obligatoire… Aucun `DROP`/refonte destructive ») :

- **Aucun `DROP TABLE`, `DROP COLUMN`, changement de type ou suppression
  de contrainte réduisant l'ensemble de valeurs autorisées n'est inclus
  dans ce plan.** Y compris pour `risk_assessments` (§2, Lot G,
  `043` optionnelle) — la dépréciation reste documentaire, jamais une
  suppression.
- Toute future migration destructive (y compris une éventuelle
  suppression physique de `risk_assessments` après sign-off) doit suivre
  intégralement le workflow §14-16 de `.claude/agents/dev-db.md` :
  justification écrite, analyse d'impact, stratégie de
  sauvegarde/récupération, validation explicite — et être **hors** du
  périmètre de ce plan, dans une migration dédiée et isolée, jamais
  regroupée avec une migration fonctionnelle.
- Les exceptions déjà actées dans `CLAUDE.md` (`DELETE`+`INSERT` sur les
  tables de lien pures sans signification métier propre, ex.
  `control_risks`, candidat `risk_incidents`) restent les **seules**
  opérations `DELETE` tolérées en base — jamais sur une table portant un
  `deleted_at` ou une signification métier propre.
