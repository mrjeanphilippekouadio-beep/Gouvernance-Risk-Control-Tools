# GRC Target Domain Model

Statut : Adopté (2026-09-28), **révisé (2026-09-28)** — premier des 3
artefacts du gate posé par le Product Owner avant tout travail base de
données (voir `.claude/agent-context/SHARED_LOG.md`, entrée « Arbitrage
du Product Owner » du 2026-09-28).

**Révision** : cette version intègre les 4 décisions du Product Owner
du 2026-09-28 sur les points laissés `ARBITRER` par la Database Gap
Analysis (`docs/architecture/GRC_Database_Gap_Analysis.md`, commit
`96b7949` — SHARED_LOG, entrée « Arbitrage des 4 points ouverts de la
Gap Analysis ») : (1) `RiskEvaluation` confirmé unique implémentation
technique du « Risk Assessment » métier (§5.1/§5.2) ; (2) `RiskCategory`
confirmé canonique, 3 FK nullables proposées (§4.5) ; (3) `risk_processes`
explicitement écartée, pas différée (§4.2 — arbitrage refait le
2026-09-29, DECISION-007, sur la base de la FK 1:1 réelle
`risks.process_id` ajoutée par DECISION-006, migration 029) ; (4) `Kpi`/`Kri` fusionnés en
un modèle physique unique `Indicator`/`IndicatorMeasure` (§5.5 — le point
le plus structurant du lot). Voir §12 pour la synthèse chiffrée à jour.

Sert d'intrant à :
- **Database Gap Analysis** (à produire) — compare ce modèle cible à
  l'état réel des 26 migrations existantes.
- **Migration Plan / Migration Protocol** (à produire) — séquence les
  évolutions Expand/Contract nécessaires pour combler l'écart.

Source amont : `docs/Cahier_des_charges_GRC_v0.1.md` (v0.1, cahier des
charges fonctionnel et logique). Référence de style : `ADR-001-cible-architecture.md`.

---

## 0. Méthode et périmètre

Ce document répertorie, pour chaque entité du modèle métier cible, son
**statut d'implémentation** par rapport à `backend/src/domain/entities/`
(31 fichiers, inspectés intégralement le 2026-09-28) :

- **EXISTANT** — déjà codé, structure jugée conforme au besoin cible.
  Ne pas toucher structurellement.
- **EXISTANT_À_ÉTENDRE** — déjà codé, mais doit gagner des
  champs/relations pour couvrir le besoin cible. Extension additive
  uniquement (Expand/Contract) : colonne nullable, jamais de
  renommage/suppression d'un champ existant.
- **NOUVEAU** — n'existe pas encore dans `domain/entities/`.

Cinq distinctions structurantes, imposées explicitement par le Product
Owner et **non négociables dans ce modèle** (voir §0.1). Une directive
transverse gouverne l'ordre de conception vs l'ordre de livraison
(§0.2). Les capacités transverses (Comments/RACI/Evidence/Audit trail +
moteur polymorphe) sont traitées **une seule fois**, en §2, et
référencées — jamais dupliquées — par les sections de domaine.

### 0.1 Les 5 distinctions structurantes

| # | Distinction | Où elle s'applique dans ce document |
|---|---|---|
| 1 | `Risk Catalog ≠ Risk ≠ Risk Assessment` | §4 Référentiel / §5 Risk Management — `RiskCatalog` (NOUVEAU) est le dictionnaire, `Risk` (EXISTANT_À_ÉTENDRE) est le registre, « Risk Assessment » (concept métier du cahier des charges §7.1.C) est incarné exclusivement par `RiskEvaluation` (EXISTANT) — voir §5.1/§5.2, tranché le 2026-09-28. `RiskAssessment` (l'entité technique de ce nom, scaffolding jamais câblé) est DÉPRÉCIÉE, pas une seconde implémentation du même concept. Jamais fusionnés. |
| 2 | `Incident ≠ Anomaly ≠ Finding` | §6 Incidents / §7 Contrôle interne / §9 Audit — trois entités distinctes avec trois cycles de vie distincts : `Incident` (NOUVEAU) = événement réel, `Anomaly` (EXISTANT) = écart constaté lors d'un contrôle, `Finding` (NOUVEAU) = constat d'audit. |
| 3 | `IAM ≠ RACI` | §2.2 — `Role`/`Permission`/`RoleAssignment` (EXISTANT, IAM technique = *peut faire*) restent strictement séparés de `RaciAssignment` (NOUVEAU, responsabilité métier = *doit faire*). Le champ `owner`/`ownerId` sur les objets métier (déjà présent sur `Risk`, `Control`, `Indicator`) reste un raccourci de requêtage — la vérité détaillée reste RACI, jamais l'inverse. |
| 4 | `Evidence ≠ Document` | §2.3 vs §4.4 — `Evidence` (EXISTANT_À_ÉTENDRE) est une preuve d'exécution rattachée par le moteur polymorphe transverse ; `Document` (NOUVEAU) est une référence du dispositif documentaire (procédure, politique, manuel) rattachée au référentiel des risques. Deux objets, deux cycles de vie, jamais une même table. |
| 5 | Événements temporels ≠ métriques calculées | §6.3 — `Incident` conserve les 4 timestamps sources (occurrence/détection/confinement/résolution) ; `Velocity`/`Persistence` sont des valeurs **calculées** à la lecture (à la manière de `computeKriStatus`/`computeActionPlanStatus`, déjà pratiqué dans ce backend), jamais des colonnes saisies manuellement sur l'incident. |

### 0.2 Ordre de livraison ≠ dépendances techniques

Directive actée du Product Owner (2026-09-28) : certaines fondations
doivent être **conçues maintenant**, même si leur exposition utilisateur
n'arrive qu'à un lot ultérieur du découpage fonctionnel (§4 du cahier
des charges, Lot 1 → Lot 7). Concrètement dans ce modèle :

- Le **moteur polymorphe** `object_type`/`object_id` (Comments, RACI,
  Evidence — §2) est conçu ici en même temps que le reste du modèle,
  bien qu'il ne soit exposé utilisateur qu'au Lot 6/7 du cahier des
  charges. Il est déjà précédenté dans ce backend par
  `ActionPlan.sourceType`/`sourceId` (voir `ActionPlan.ts`) — le PO a
  confirmé cette approche comme la bonne (SHARED_LOG point 5).
- `RiskCatalog` (référentiel, Lot 2) est conçu avant que `Risk` ne soit
  formellement relié à lui, même si le lien `Risk.riskCatalogId` n'est
  câblé qu'à la Gap Analysis / Migration Plan à venir.
- `Finding` (Lot 6) est conçu dès ce document car il conditionne la
  forme polymorphe de `ActionPlan.sourceType` (`AUDIT` existe déjà côté
  code — voir §9.2) et la relation Evidence → objets GRC (§2.3).

---

## 1. Organisation

### 1.1 `Tenant` — **EXISTANT**
Limite d'isolation multi-organisation ; toutes les autres tables du
socle sont scopées par `tenantId`, mais `Tenant` lui-même n'est scopé
par personne (racine de l'arbre).
- **Attributs clés** : `id`, `name`, `deploymentMode` (`managed_saas` /
  `customer_managed` / `on_premise`), `active`.
- **Relations** : 1:N vers `Department`, `User`, `Process`, `Risk`, et
  toute table métier (`tenantId`). Voir aussi `TenantBranding` (1:1).
- Correspond au § 6.1 « Organisation/entité » du cahier des charges
  (identifiant, code implicite via `id`, statut, métadonnées).

### 1.2 `Department` — **EXISTANT_À_ÉTENDRE**
Une unité organisationnelle rattachée à un tenant, porteuse d'un pilote
de risque et d'un manager.
- **Attributs clés existants** : `name`, `entity`, `manager` (texte
  libre), `riskOwner` (texte libre, désigné via
  `DepartmentService.designateRiskOwner`), `linkedProcesses`, `active`.
- **Écart vs cahier des charges (§6.2)** : le cahier des charges décrit
  un « propriétaire du processus » distinct du « pilote de risque »,
  pouvant être la même personne ou deux personnes différentes.
  Aujourd'hui `Department.riskOwner` existe mais le propriétaire de
  processus vit sur `Process.owner` (texte libre également) — la
  distinction est déjà correcte structurellement, à documenter comme
  telle plutôt qu'à fusionner.
- **Point d'extension proposé** : aucun champ nouveau requis à ce
  stade ; RACI (§2.2) porte la relation many-to-many formelle
  pilote/propriétaire quand plusieurs personnes doivent être
  co-responsables (cas non couvert par les deux champs texte actuels).
- **Relations** : 1:N vers `Process` ; référencé par `Risk.ownerDepartmentId`,
  `Indicator.departmentId` (KPI uniquement, §5.5), `ActionPlan.departmentId`,
  `Control.departmentId`.

### 1.3 `Process` — **EXISTANT_À_ÉTENDRE**
Un processus (ou sous-processus, ou activité), hiérarchie
auto-référencée à 3 niveaux, rattaché à un département.
- **Attributs clés existants** : `parentId`, `level`
  (`PROCESS`/`SUBPROCESS`/`ACTIVITY`), `name`, `description`, `owner`
  (texte libre), `documentType`/`documentReference` (référence
  documentaire simple, texte libre).
- **Écart vs cahier des charges (§9, référentiel documentaire)** : le
  cahier des charges veut un objet `Document` structuré et réutilisable
  (référence, titre, type, version, statut, dates de validité — voir
  §4.4 ci-dessous), pas seulement une référence texte libre sur
  `Process`.
- **Point d'extension proposé** : `Process.documentReference` reste tel
  quel (rétro-compatible) ; le rattachement structuré passe par le
  moteur polymorphe `evidence_links`/`document_links` (§2.3/§4.4), pas
  par une nouvelle colonne sur `Process`.
- **Relations** : self N:1 (`parentId`) ; N:1 vers `Department`
  (implicite aujourd'hui — voir Gap Analysis pour vérifier la présence
  d'une FK `departmentId` réelle) ; 1:N vers `Indicator` (`processId`,
  KPI uniquement — §5.5).

### 1.4 `User` — **EXISTANT**
Identité applicative, une ligne par `(tenantId, email)`.
- **Attributs clés** : `email`, `displayName`, `roles` (liste legacy de
  chaînes, mécanisme de bootstrap — voir §2.1 sur la vraie RBAC).
- **Relations** : référencé comme `ownerId`/`superiorOwnerId` sur
  `Risk`, `executor`/`validator` sur `Control`, `recipientUserId` sur
  `Notification`, sujet de `RoleAssignment` et de `RaciAssignment`
  (§2.2).

---

## 2. Capacités transverses

Cette section existe **une seule fois** et est référencée par toutes
les sections de domaine ci-dessous (§3 à §9) — jamais redéfinie par
domaine, conformément à la Règle d'architecture §32.4 du cahier des
charges (« fonction transverse ≠ table par objet »).

### 2.1 IAM — `Role`, `RoleAssignment`, `Permission` — **EXISTANT**
- **Définition** : `Role` est un ensemble nommé de permissions
  techniques ; `RoleAssignment` est l'octroi d'un rôle à un utilisateur
  (append-only : une révocation pose `revokedAt`, ne supprime rien).
  `Permission` est une union de type TypeScript (`domain/permissions.ts`),
  pas une table.
- **Attributs clés** : `Role.permissions: Permission[]` ;
  `RoleAssignment.grantedBy/grantedAt/revokedAt`.
- **Relations** : `User` N:N `Role` via `RoleAssignment`. **Ne
  représente jamais** « qui est responsable de quoi » sur un objet
  métier — c'est le rôle du RACI (§2.2), distinction 3 imposée par le
  PO. `User.roles` (liste de chaînes sur l'entité `User`) reste un
  mécanisme de bootstrap legacy, non la source de vérité RBAC.

### 2.2 RACI — `RaciAssignment` — **NOUVEAU**
- **Définition** : responsabilité métier sur un objet GRC donné
  (Risque, Contrôle, Plan d'action, Incident, etc.), indépendante des
  droits techniques IAM. Répond à « qui est Accountable/Responsible/
  Consulted/Informed sur cet objet », jamais « qui peut cliquer sur quoi ».
- **Attributs clés** : `id`, `tenantId`, `objectType` (whitelist
  contrôlée — même mécanisme que `ActionPlan.sourceType`),
  `objectId`, `userId`, `role` (`R`/`A`/`C`/`I`), `assignedBy`,
  `assignedAt`, `revokedAt` (append-only, comme `RoleAssignment` —
  changement de RACI historisable, cf. cahier des charges §29 « audit
  trail », item « changement de RACI »).
- **Règles métier à trancher en Gap Analysis / spec détaillée** (déjà
  listées comme point d'arbitrage E du cahier des charges §37) :
  cardinalité de `A` (un seul recommandé), cardinalité de `R` (plusieurs
  admis), règles de cohérence par type d'objet. Non tranchées ici —
  ce document fixe la forme de la table, pas les règles de validation.
- **Relations** : N:1 vers `User` ; polymorphe vers tout objet GRC
  (`objectType`/`objectId`) — Risque, Contrôle, Plan d'action, Incident,
  Anomalie, Évaluation. Champ `owner`/`ownerId` déjà présent sur `Risk`,
  `Control`, `Indicator` (KPI : `owner` ; KRI : lien via `riskId`),
  `ActionPlan` reste un **raccourci de requêtage** vers le `A` (ou le
  `R`) principal — jamais la source de vérité, conformément à la Règle
  §25 du cahier des charges.
- **Conçu maintenant, exposé au Lot 7** (§0.2) — dépendance technique du
  moteur polymorphe déjà câblée dans ce document dès Lot 1 conceptuel.

### 2.3 Evidence — `Evidence` — **EXISTANT_À_ÉTENDRE**
- **Définition** : preuve/pièce justificative *d'exécution* (résultat
  d'une checklist, capture d'écran, export) — **jamais** un document de
  référence du dispositif (distinction 4, voir §4.4 `Document`
  ci-dessous). Métadonnées seulement ; le fichier physique vit sur
  Google Drive (ADR-001).
- **Attributs clés existants** : `fileName`, `driveFileId`, `driveUrl`,
  `documentType` (texte libre — nature du fichier, pas à confondre avec
  l'entité `Document`), `uploadedBy`, `uploadedAt`, `version`, `status`.
- **Écart vs cahier des charges (§14)** : `Evidence.controlExecutionId`
  est aujourd'hui la **seule** relation possible (1:1 conceptuel vers
  `ControlExecution`). Le cahier des charges veut une évidence
  potentiellement rattachée à plusieurs objets GRC (exécution de
  contrôle, incident, anomalie, plan d'action, recommandation d'audit,
  évaluation de risque — relation N:N via lien générique, §30 tableau
  des relations).
- **Point d'extension proposé** :
  - Garder `Evidence.controlExecutionId` tel quel (rétro-compatible,
    Expand/Contract — ne pas supprimer).
  - Ajouter une table de liaison polymorphe `evidence_links` (NOUVEAU,
    non une colonne sur `Evidence`) : `id`, `tenantId`, `evidenceId`,
    `objectType` (whitelist : `CONTROL_EXECUTION`, `INCIDENT`,
    `ANOMALY`, `ACTION_PLAN`, `AUDIT_FINDING`, `RISK_EVALUATION`, …),
    `objectId`, `linkedBy`, `linkedAt`, `description` (rattachement, cf.
    §14 « description du rattachement »). Cette table est le même
    patron que `RaciAssignment`/`CommentThread` — moteur polymorphe
    unique, whitelist maîtrisée (directive PO point 5).
- **Relations** : N:1 legacy vers `ControlExecution` (conservé) ; N:N
  future vers tout objet GRC via `evidence_links`.

### 2.4 Comments — `Comment` / `CommentableObjectConfig` — **NOUVEAU**
- **Définition** : commentaire libre rattaché à un objet GRC, autorisé
  seulement si l'administrateur a activé les commentaires pour ce type
  d'objet (§22 du cahier des charges — éviter une table par objet :
  `risk_comments`, `control_comments`, etc.).
- **Attributs clés** :
  - `Comment` : `id`, `tenantId`, `objectType`, `objectId`, `authorId`,
    `body`, `createdAt`, `editedAt` (nullable — arbitrage « modifiable ou
    ajout seul » resté ouvert au §37.F du cahier des charges, à trancher
    en spec détaillée, pas ici), `deletedAt` (soft delete cohérent avec
    la convention transverse du backend).
  - `CommentableObjectConfig` : `id`, `tenantId`, `objectType`,
    `enabled` (le commutateur par type d'objet évoqué en §22, motivé
    par l'exemple « Commentaires sur les indicateurs : NON »).
- **Relations** : N:1 vers `User` (auteur) ; polymorphe vers tout objet
  GRC whitelisté. `CommentableObjectConfig` est consulté par le service
  applicatif avant toute création de `Comment` (règle métier, pas une
  contrainte DB).
- **Conçu maintenant, exposé au Lot 7** — même moteur polymorphe que
  RACI et Evidence, whitelist partagée en conception (mais table de
  configuration propre à Comments, car « commentable » est une
  propriété différente de « évidençable » ou « raci-able »).

### 2.5 Audit trail — `AuditEvent` — **EXISTANT**
- **Définition** : journal append-only strict, déjà conforme à la
  Règle transverse « audit_logs append-only » (CLAUDE.md, section
  Domaine Audit). Pas d'`update`/`delete` exposés par
  `AuditRepository`.
- **Attributs clés** : `entityType`, `entityId`, `action` (union fermée
  incluant `ASSIGN`/`ESCALATE`/`STATUS_CHANGE`/`ROLE_CHANGE`/
  `PERMISSION_CHANGE`), `oldValue`/`newValue`, `reason`, `requestId`.
- **Relations** : polymorphe de fait (`entityType`/`entityId`, mêmes
  principes que §2.2-2.4 mais antérieur et déjà en production — sert de
  précédent validé pour le reste du moteur transverse). Couvre déjà les
  événements listés au §29 du cahier des charges (création,
  modification, changement de statut/responsable/RACI/scoring, ajout/
  suppression d'évidence, validation, clôture) — aucune extension de
  schéma requise, seulement de nouveaux appels `AuditRepository.record`
  depuis les futurs services (`RaciAssignment`, `Comment`,
  `evidence_links`) au moment de leur implémentation.
- **Rôle Auditeur** déjà câblé (RBAC + `audit.read`, voir CLAUDE.md) —
  fournit l'accès transverse en lecture décrit au §21 du cahier des
  charges, indépendamment des objets `Finding`/`AuditMission` (§9,
  nouveaux).

---

## 3. Organisation → voir §1 (pas de section dupliquée)

---

## 4. Référentiel

### 4.1 `RiskCatalog` — **NOUVEAU**
- **Définition** : le **dictionnaire** du risque — ce qu'*est* un type
  de risque, indépendamment de toute instance organisationnelle ou
  évaluation (distinction 1, cahier des charges §7.1.A). Un
  `RiskCatalog` peut donner naissance à zéro, un ou plusieurs `Risk`
  (registre) dans différents départements/processus.
- **Attributs clés** : `id`, `tenantId`, `reference` (ex. `R-OP-001`),
  `name`, `definition`, `category` (texte libre, conservé) +
  `riskCategoryId: string | null` (FK nullable vers `RiskCategory`,
  §4.5 — décision Product Owner du 2026-09-28), `status`
  (`ACTIVE`/`INACTIVE`), `regulatoryReferences` (texte libre ou lien
  vers `RegulatoryFramework`, EXISTANT).
- **Relations** : 1:N vers `Risk` (`Risk.riskCatalogId`, nouveau champ,
  voir §4.2) ; N:N vers `RiskCause` via `RiskCatalogCause` (§4.2) ; N:N
  vers `Document` via un lien polymorphe (§4.4/§2.3-2.4 pattern).

### 4.2 `Risk` — **EXISTANT_À_ÉTENDRE**
- **Définition** : le **registre** — le risque effectivement identifié
  dans un périmètre organisationnel donné (distinction 1, cahier des
  charges §7.1.B). Ce `Risk` existant dans le code **correspond
  exactement** à cette notion de « registre », jamais au dictionnaire
  générique ni à une évaluation — point de vigilance explicite demandé
  par le PO pour éviter toute confusion lexicale dans le reste du
  projet.
- **Attributs clés existants** : `process` (texte libre), `description`,
  `ownerDepartmentId`, `ownerId`, `superiorOwnerId`, `status`
  (`DRAFT`/`ACTIVE`/`ARCHIVED`).
- **Écart vs cahier des charges** : pas de lien vers `RiskCatalog`
  (§7.1), pas de `subCategory`/`entity` propres (ces champs sont
  aujourd'hui capturés en doublon sur chaque `RiskEvaluation` — voir la
  note de conception dans `RiskEvaluation.ts` qui documente déjà cet
  écart et le renvoie explicitement à l'Architecture), pas de N:N vers
  `RiskCause`/`Document`/`Process` (`process` est un champ texte, pas
  une FK).
- **Point d'extension proposé** (additif, Expand/Contract) :
  - `riskCatalogId: string | null` — FK nullable vers `RiskCatalog`
    (Expand ; un backfill ultérieur peut la remplir depuis les données
    existantes, jamais une contrainte NOT NULL immédiate).
  - Ne **pas** dupliquer `subCategory`/`entity` sur `Risk` sans trancher
    d'abord si `RiskEvaluation.subCategory/entity` doit continuer à être
    un instantané indépendant (design déjà documenté comme
    intentionnel dans le code) — décision Architecture explicitement
    laissée ouverte, à statuer en Gap Analysis.

> **`risk_processes` — écartée définitivement, pas différée (arbitrage
> refait le 2026-09-29, DECISION-007).** Tranché une première fois par
> le Product Owner le 2026-09-28 (SHARED_LOG, « Arbitrage des 4 points
> ouverts de la Gap Analysis ») sur une prémisse alors erronée (une FK
> 1:1 supposée déjà existante) ; rouvert et rejugé sur les faits
> corrects le 2026-09-29 — le verdict **ne change pas**, seule sa
> motivation change. **Pas de table de liaison N:N `Risk`↔`Process`.**
> La relation retenue est la FK 1:1 réelle **`risks.process_id →
> processes(id)`** (nullable, migration `029_risks_process_id.sql`,
> ajoutée par DECISION-006), en complément de `Risk.process` (colonne
> texte libre historique, `003_risks.sql`, conservée jusqu'au backfill).
> Le point d'arbitrage §37.A du cahier des charges (« un risque
> peut-il être rattaché à plusieurs processus ? ») n'est **pas** tranché
> positivement — aucun besoin métier N:N n'est confirmé (8 preuves,
> détail complet : `GRC_Database_Gap_Analysis.md` §2.5bis). **Écartée**
> signifie ici : ce n'est pas un report faute de temps, c'est l'absence
> de besoin métier qui motive la décision. **Critère de réouverture
> explicite** (à exiger, ne pas rouvrir sans) : une expression métier
> explicite du Product Owner ou du Risk Manager décrivant un cas réel où
> un même risque de registre doit être piloté sur plusieurs processus
> **avec une seule évaluation partagée** — un **2e cas d'usage réel
> confirmé**, jamais anticipé. Aucune table `risk_processes` n'est donc
> créée par ce document ni par la Gap Analysis/Migration Plan qui en
> découlent.
- **Relations** : N:1 vers `RiskCatalog` (proposé) ; N:1 vers
  `Department` (`ownerDepartmentId`) ; N:1 vers `User` (`ownerId`,
  `superiorOwnerId`) ; 1:N vers `RiskAssessment` et `RiskEvaluation` ;
  N:N vers `RiskCause` (proposé, via table de liaison) ; N:N vers
  `Document` (proposé, via lien polymorphe) ; N:N vers `Control`
  (`Control.coveredRiskIds`, EXISTANT) ; N:N vers `Incident` (proposé,
  §6.2) ; N:N vers `Indicator` (§5.5, type KRI uniquement — via
  `Indicator.riskId` obligatoire + table `indicator_risks`, remplace
  `kri_risks`) ; polymorphe vers RACI/Comments/Evidence (§2).

### 4.3 `RiskCause` / `RiskCatalogCause` — **NOUVEAU**
- **Définition** : une cause est un objet réutilisable, indépendant du
  risque qui la porte — un risque a plusieurs causes, une cause peut
  contribuer à plusieurs risques (cahier des charges §8.1, relation
  N:N explicite).
- **Attributs clés** : `RiskCause` : `id`, `tenantId`, `label`,
  `description`. `RiskCatalogCause` (table de liaison) : `riskCatalogId`,
  `riskCauseId`.
- **Relations** : N:N entre `RiskCatalog` et `RiskCause` via
  `RiskCatalogCause` — attaché au **catalogue**, pas au registre
  (`Risk`), conformément au diagramme du cahier des charges §8.1.

### 4.4 `Document` — **NOUVEAU**
- **Définition** : référence du dispositif documentaire existant
  (procédure, politique, note d'instruction, manuel — cahier des
  charges §9). **Distinct d'`Evidence`** (distinction 4) : un
  `Document` décrit une règle/référence normative durable, une
  `Evidence` prouve qu'une action a eu lieu à un instant donné. Les deux
  ne partagent ni cycle de vie, ni sémantique, ni table.
- **Attributs clés** : `id`, `tenantId`, `reference`, `title`, `type`
  (`PROCEDURE`/`POLICY`/`INSTRUCTION_NOTE`/`TRAINING_MATERIAL`/
  `MANUAL`/`REGULATORY_DOC`/autre configurable), `version`, `status`,
  `location` (URL ou emplacement), `effectiveFrom`, `effectiveUntil`.
- **Relations** : N:N vers `RiskCatalog`/`Risk`/`Process` via une table
  de liaison polymorphe (même patron que `evidence_links`, §2.3) —
  proposée comme `document_links` (`objectType`/`objectId`/`documentId`)
  plutôt qu'une FK directe sur `Risk`, pour rester cohérent avec le
  principe transverse « pas de table par objet » et pour permettre à
  `Process`/`Control` de référencer aussi des documents sans dupliquer
  le mécanisme.

### 4.5 `RiskCategory` — **EXISTANT** — canonique, FK nullable en cours de câblage

> **Tranché par le Product Owner le 2026-09-28** (SHARED_LOG, « Arbitrage
> des 4 points ouverts de la Gap Analysis ») : `RiskCategory` (table
> `risk_categories`, déjà en place) est confirmée comme le référentiel
> **canonique** unique des catégories/sous-catégories de risque. Les
> **3 tables** qui la référencent aujourd'hui en texte libre gagnent
> chacune une FK nullable vers elle, migrée progressivement
> (Expand/Contract complet : FK nullable → backfill → contrôle → bascule
> applicative → dépréciation du texte libre — **jamais de `DROP` du
> champ texte immédiat**) :
> 1. `RiskCatalog.category` → `RiskCatalog.riskCategoryId` (§4.1) ;
> 2. `RiskAppetite.subCategory` → `RiskAppetite.riskCategoryId` (§5.4) ;
> 3. `RiskEvaluation.subCategory` → `RiskEvaluation.riskCategoryId` (§5.2).
>
> Le séquencement précis (ordre des 5 étapes ci-dessus par table, avec
> quelle migration numérotée) relève du Migration Plan (prochain
> artefact, Dev DB), pas de ce document — ce document fixe seulement la
> forme cible : trois FK nullables vers `RiskCategory`, les trois champs
> texte restant lisibles jusqu'à dépréciation actée.

- **Définition** : taxonomie catégorie/sous-catégorie du risque,
  auto-référencée sur un niveau. Déjà conforme au besoin de
  configurabilité du cahier des charges (§34.1).
- **Attributs clés** : `name`, `parentId`, `active`.
- **Relations** : self N:1 (`parentId`) ; **cible** — 1:N vers
  `RiskCatalog` (`riskCategoryId`, proposé), `RiskAppetite`
  (`riskCategoryId`, proposé) et `RiskEvaluation` (`riskCategoryId`,
  proposé). Aucune des trois FK n'est câblée par ce document — c'est
  l'intrant que ce document fournit à la Gap Analysis/Migration Plan qui
  suit, conformément à la décision Product Owner.

---

## 5. Risk Management

### 5.1 `RiskAssessment` — **EXISTANT, DÉPRÉCIÉ**

> **Tranché par le Product Owner le 2026-09-28** (voir
> `.claude/agent-context/SHARED_LOG.md`, entrée « Arbitrage des 4 points
> ouverts de la Gap Analysis ») : le point de vigilance ci-dessous, posé
> par la première version de ce document, est **clos**. `RiskEvaluation`
> (§5.2) est l'**unique implémentation technique** du concept métier
> « Risk Assessment » du cahier des charges §7.1.C (troisième maillon
> `Risk Catalog → Risk → Risk Assessment`). « Risk Assessment » n'est
> **pas une entité séparée** du modèle physique — c'est le nom métier
> que porte `RiskEvaluation` dans le cahier des charges. Aucune ambiguïté
> ne doit subsister dans la suite du projet entre les deux usages du
> terme.

- **Statut** : scaffolding mort — entité, interface repository et table
  `risk_assessments` posées au tout début du projet (migration `003`,
  la même que `risks`), jamais raccordées à un service ni une route
  (voir investigation complète dans `GRC_Database_Gap_Analysis.md` §1).
  Aucune implémentation Postgres concrète n'existe
  (`PostgresRiskAssessmentRepository.ts` absent).
- **Décision** : `RiskAssessment` (l'entité technique de ce nom) reste
  **DÉPRÉCIÉE**, comme proposé par la Gap Analysis §1.2 — dépréciation,
  jamais suppression brutale (Expand/Contract). La table `risk_assessments`
  reste en place (coût de stockage nul, table vide) ; aucun nouveau
  développement ne doit s'y raccorder ; sa suppression physique reste
  soumise à un sign-off ultérieur explicite (Architecture + Product
  Owner), hors périmètre de ce document.
- **Ce que ce document ne fait pas** : il ne fusionne pas
  `RiskAssessment` et `RiskEvaluation` en une seule table — les deux
  modèles ne se recouvrent pas champ à champ et une fusion casserait le
  contrat déjà stable de `RiskEvaluation`. Il n'y a simplement plus
  qu'**un** chemin technique vivant : `RiskEvaluation`.
- **Relations** : N:1 vers `Risk` (chemin mort, non alimenté).

### 5.2 `RiskEvaluation` — **EXISTANT** — implémentation cible unique du « Risk Assessment » métier
- **Définition** : évaluation périodique complète d'un risque selon une
  méthodologie versionnée (axes d'impact, maîtrise par ligne de
  défense L1/L2/L3, appétence, workflow de validation). Append-only,
  immuable une fois `VALIDATED`/`REJECTED`/`VALIDE_COMITE`. Constitue,
  seule, le troisième maillon `Risk Catalog → Risk → Risk Assessment` du
  cahier des charges §7.1.C (décision Product Owner du 2026-09-28,
  §5.1) : toute évolution future du « scoring de risque », y compris un
  besoin de cotation rapide hors workflow, se conçoit comme une
  extension additive de `RiskEvaluation`, jamais comme un retour à
  `RiskAssessment` ni comme une nouvelle entité parallèle.
- **Attributs clés** : `evaluationType`, `status`, `evaluatorId`,
  `subCategory`/`entity` (capturés en instantané — voir §4.5/§5.4 sur
  le passage progressif vers une FK `RiskCategory`),
  `ratingScaleId`/`ratingScaleVersion`, `inherentProbability`/
  `inherentImpacts`/`inherentScore`, `masteryLines`/`masteryGlobal`,
  `residualProbability`/`residualImpacts`/`residualScore`,
  `appetiteThresholdSuggested`/`Override`/`Applied`/`appetiteExceeded`.
- **Point d'extension proposé (additif, Expand)** : `riskCategoryId:
  string | null` — FK nullable vers `RiskCategory` (§4.5), en
  complément (pas en remplacement immédiat) du `subCategory` texte libre
  existant, dans le cadre de la migration progressive décidée en §4.5.
- **Relations** : N:1 vers `Risk`, `RatingScale` ; N:1 optionnel vers
  `RiskCategory` (proposé) ; référence implicite `RiskAppetite`
  (résolution par `subCategory`/`entity`, pas de FK directe à ce stade).

### 5.3 `RatingScale` — **EXISTANT**
- **Définition** : le moteur de méthodologie externalisé du modèle
  métier (cahier des charges §10.1) — probabilité, impact (7 axes),
  vélocité, persistance, échelle de maîtrise, seuils de criticité, tout
  versionné par ligne (`version`, `status`).
- **Attributs clés** : `probabilityLevels`/`impactLevels`,
  `criticalityThresholds`, `impactAxes` (JSONB), `velocityLevels`/
  `persistenceLevels` (JSONB — les **niveaux configurables**, à ne pas
  confondre avec les métriques calculées de l'incident, distinction 5),
  `masteryScale` (JSONB).
- **Relations** : référencé par `RiskEvaluation.ratingScaleId`. Couvre
  déjà le besoin de configurabilité du §10 et §34.1 du cahier des
  charges (« une autre organisation doit pouvoir utiliser d'autres
  niveaux sans modification du modèle métier »).

### 5.4 `RiskAppetite` — **EXISTANT_À_ÉTENDRE**
- **Définition** : seuil d'appétence par sous-catégorie de risque,
  optionnellement scopé par entité.
- **Attributs clés existants** : `subCategory`, `entity`, `threshold`,
  `methodologyVersion`, `active`.
- **Point d'extension proposé (additif, Expand)** : `riskCategoryId:
  string | null` — FK nullable vers `RiskCategory` (§4.5), décision
  Product Owner du 2026-09-28. `subCategory` reste en place tant que la
  bascule applicative n'est pas actée (Expand/Contract, jamais de
  suppression immédiate du champ texte).
- **Relations** : résolu par `(subCategory, entity)` depuis
  `RiskEvaluation` (conservé) ; N:1 optionnel vers `RiskCategory`
  (proposé) en complément, pas en remplacement, de la résolution texte
  libre.

### 5.5 `Indicator` — **NOUVEAU (modèle physique unifié)** — remplace `Kpi`/`Kri`

> **Revirement tranché par le Product Owner le 2026-09-28** (SHARED_LOG,
> « Arbitrage des 4 points ouverts de la Gap Analysis ») : la Gap
> Analysis avait, par défaut, proposé le statu quo (`Kpi`/`Kri` = deux
> tables séparées, `kpis`/`kris` en production). **Le Product Owner
> tranche l'inverse.** KPI et KRI restent **deux types métier
> fonctionnellement distincts** (statuts, finalité, seuils — rien ne
> change côté utilisateur ni côté vocabulaire produit) mais partagent
> désormais **un seul modèle physique** : une entité `Indicator`
> (table `indicators`), discriminée par `indicatorType: "KPI" | "KRI"`,
> et une seule table de mesures `indicator_measures` (remplace
> `KpiMeasure`/`KriMeasure`). C'est le point le plus structurant des 4
> décisions de ce lot — il change la classification de la Gap Analysis
> (`Kpi`/`Kri` sortent de RÉUTILISER) et doit suivre la même logique de
> consolidation non destructive que la dépréciation de `RiskAssessment`
> (§5.1) : création de la table unifiée, backfill depuis
> `kpis`/`kris`/`kpi_measures`/`kri_measures`, période de coexistence,
> dépréciation des anciennes tables seulement après validation — jamais
> un `DROP` direct. Le séquencement précis relève du Migration Plan
> (Dev DB), pas de ce document.

- **Définition** : objet générique demandé par le cahier des charges
  §11 (« Indicator » supportant KRI et KPI), désormais pris au pied de
  la lettre au niveau du **stockage** : une seule table porte les deux
  types. Le KRI porte une **logique de seuil/risque** que le KPI n'a
  pas (seuils vert/orange/rouge, lien de risque obligatoire, calcul de
  statut par comparaison à un seuil) ; le KPI porte une **logique de
  cible** que le KRI n'a pas (valeur cible, unité, atteinte en %). Ces
  deux logiques sont modélisées comme des **colonnes optionnelles dans
  la même table**, jamais comme deux tables ni comme un JSONB
  fourre-tout — chaque colonne reste typée et contrainte au niveau SQL.
- **Attributs clés communs** (tous types) : `id`, `tenantId`,
  `indicatorType` (`"KPI" | "KRI"`, discriminant, immuable après
  création), `label`, `frequency`, `description`, `active`,
  `createdAt`/`updatedAt`/`deletedAt`/`deletedBy`/`deletionReason`
  (conventions déjà en place sur `Kpi`/`Kri`).
- **Attributs spécifiques KPI** (nullable, requis uniquement si
  `indicatorType = "KPI"`) : `targetValue`, `unit`, `owner` (texte
  libre, comme aujourd'hui), `departmentId`/`processId` (au moins un
  requis pour un KPI — même règle qu'aujourd'hui, portée par un `CHECK`
  conditionné au type plutôt qu'inconditionnel).
- **Attributs spécifiques KRI** (nullable, requis uniquement si
  `indicatorType = "KRI"`) : `thresholdGreen`/`thresholdOrange`/
  `thresholdRed` (contrainte `Green < Orange < Red`, comme aujourd'hui),
  `formula` (texte libre, jamais évalué serveur), `riskId` (lien
  primaire obligatoire pour un KRI, ACT-130), `entity` (scope
  organisationnel texte libre), `methodologyVersion`.
- **Contrainte d'intégrité proposée** : un `CHECK` SQL (ou une validation
  service équivalente en attendant, comme pour `Kpi`/`Kri` aujourd'hui)
  garantissant que les colonnes KPI sont `NOT NULL` seulement quand
  `indicatorType = 'KPI'` et que les colonnes KRI sont `NOT NULL`
  seulement quand `indicatorType = 'KRI'` — même patron que
  « au moins un de departmentId/processId » déjà en place sur `Kpi`.
- **Statut calculé, jamais stocké** — préserve la distinction 5 : le
  statut KPI (`ACHIEVED`/`AT_RISK`/`NOT_ACHIEVED`/`NO_MEASURE`, via
  `computeKpiStatus`) et le statut KRI (`VERT`/`ORANGE`/`ROUGE`/
  `NO_MEASURE`, via `computeKriStatus`) restent deux fonctions pures
  distinctes, sélectionnées à la lecture selon `indicatorType` — la
  fusion du stockage ne fusionne pas la logique de calcul métier, qui
  reste spécifique à chaque type.
- **`IndicatorMeasure` — NOUVEAU** (remplace `KpiMeasure`/`KriMeasure`) :
  mesures append-only, événements temporels sources (§0.1 distinction 5)
  à partir desquels les statuts sont recalculés à la lecture — jamais
  l'inverse. Une seule table `indicator_measures` (`id`, `tenantId`,
  `indicatorId`, `value`, `measuredAt`, `recordedBy`), le type de
  l'indicateur (donc la fonction de statut à appliquer) se résout par
  jointure sur `indicators.indicatorType`, jamais dupliqué sur la
  mesure elle-même.
- **Relations** : `Indicator.riskId` (1 obligatoire, uniquement si
  `indicatorType = "KRI"`) + `indicator_risks` (N:N additionnel,
  remplace `kri_risks`, ACT-136, uniquement pertinent pour les KRI) ;
  `Indicator.departmentId`/`processId` (N:1, uniquement pertinent pour
  les KPI) ; 1:N vers `IndicatorMeasure`.
- **Migration (rappel, détaillée dans le Migration Plan à venir)** :
  `kpis`/`kris`/`kpi_measures`/`kri_measures` restent en place le temps
  de la coexistence (Expand/Contract) ; `indicators`/
  `indicator_measures` sont peuplées par backfill ; les services
  applicatifs basculent progressivement ; les quatre anciennes tables ne
  sont dépréciées qu'après validation explicite (même gouvernance que
  §5.1 pour `RiskAssessment`).

---

## 6. Incidents

### 6.1 `Incident` — **NOUVEAU**
- **Définition** : un événement ayant **réellement eu lieu** ou produit
  un impact (cahier des charges §16.1). **Distinct d'`Anomaly`**
  (constat lors d'un contrôle, sans nécessairement d'impact réel) et de
  `Finding` (constat d'audit, §9) — distinction 2, imposée par le PO,
  trois cycles de vie et trois workflows différents (§28 du cahier des
  charges : Incident = `OPEN → INVESTIGATING → CONTAINED → RESOLVED →
  CLOSED` ; Anomaly = `NEW → UNDER_ANALYSIS → ACTION_IN_PROGRESS →
  CLOSED`, déjà codé ; Finding n'a pas de statut propre, il porte vers
  `ActionPlan`).
- **Attributs clés** : `id`, `tenantId`, `reference`, `title`,
  `description`, `departmentId`, `processId`, `severity`, `status`,
  `declaredBy`, `responsibleUserId`. **Événements temporels sources**
  (distinction 5, jamais de métrique calculée stockée ici) :
  `occurredAt`, `detectedAt`, `containedAt`, `resolvedAt`.
- **Relations** : N:1 `Department`/`Process` ; N:N vers `Risk` via
  `RiskIncident` (§6.2) ; polymorphe vers RACI/Comments/Evidence (§2).
  N:1 `ActionPlan.sourceType = "INCIDENT"` (déjà supporté côté
  `ActionPlan`, `sourceId` null pour ce type — voir §8.1).

### 6.2 `RiskIncident` — **NOUVEAU**
- **Définition** : table de liaison N:N entre `Risk` et `Incident`,
  permettant de consolider l'historique des événements associés à un
  risque (cahier des charges §17).
- **Attributs clés** : `riskId`, `incidentId`, `linkedAt`, `linkedBy`.
- **Relations** : N:1 vers `Risk` et `Incident`. Candidat à l'exception
  « table de lien pure » (`DELETE`+`INSERT` sans `deleted_at` propre,
  comme `control_risks`) si aucune valeur métier ne dépend de l'historique
  fin du lien lui-même — à confirmer en Gap Analysis, pas ici.

### 6.3 Vélocité et Persistance — **NOUVEAU (fonctions calculées, pas d'entité de stockage)**
- **Définition** : distinction 5 explicite. `Incident` conserve les 4
  événements sources (`occurredAt`/`detectedAt`/`containedAt`/
  `resolvedAt`) ; la **vélocité** (délai occurrence → détection) et la
  **persistance** (délai occurrence → résolution) sont des fonctions
  pures calculées à la lecture, sur le modèle exact de
  `computeKriStatus`/`computeActionPlanStatus`/`computeKpiStatus` déjà
  présents dans ce backend. Le cahier des charges (§18) exige que « les
  métriques calculées doivent pouvoir conserver leur valeur et le
  contexte de calcul » — traduit ici par : le calcul reste pur et
  déterministe à partir des colonnes sources, donc rejouable à
  l'identique à tout instant ; aucune colonne `velocity`/`persistence`
  n'est ajoutée sur `Incident` lui-même.
- **Pas de statut EXISTANT/NOUVEAU au sens entité** — ce sont des
  fonctions de service (`services/IncidentService.ts`, à créer), pas
  des lignes en base.

---

## 7. Contrôle interne

### 7.1 `Control` — **EXISTANT**
- **Définition** : définition d'un contrôle (première ou deuxième
  ligne de défense), distincte de son exécution (`ControlExecution`) et
  de son évaluation d'efficacité (`ControlEffectivenessAssessment`) —
  déjà correctement séparé dans le code, conforme à l'esprit du cahier
  des charges (§12).
- **Attributs clés** : `label`, `objective`, `coveredRiskIds` (array —
  relation N:N vers `Risk` déjà matérialisée), `process`,
  `departmentId`, `procedureDescription`, `controlType`
  (`PREVENTIVE`/`DETECTIVE`/`CORRECTIVE`), `nature`, `defenseLine`,
  `frequency`, `executor`, `validator`, `expectedEvidence`,
  `complianceCriteria`, `status`.
- **Relations** : N:N vers `Risk` (`coveredRiskIds`) ; N:1
  `Department` ; 1:N vers `ChecklistItem` (§7.2, nouveau) et
  `ControlExecution` (EXISTANT) ; 1:N vers
  `ControlEffectivenessAssessment` (EXISTANT).
- Couvre déjà les informations systématiques demandées au §12.1 du
  cahier des charges (taille d'échantillon via `procedureDescription`
  en texte libre aujourd'hui — voir point d'extension ci-dessous).

**Point d'extension proposé (additif)** : le cahier des charges §12.1
demande explicitement une taille d'échantillon, un poste en charge et
la nature des pièces justificatives comme champs **structurés**
distincts, actuellement absorbés dans `procedureDescription`/
`expectedEvidence` en texte libre. Proposition : `sampleSize: number |
null` et `sampleSizeRule: string | null` (nullable, Expand), sans
toucher aux champs texte existants qui restent valides en fallback.

### 7.2 `ChecklistItem` / `ChecklistResult` — **NOUVEAU**
- **Définition** : la checklist obligatoire d'un contrôle (cahier des
  charges §12.2) et le résultat de chaque item à chaque exécution
  (§13). Distincte de `ControlExecution` elle-même : l'exécution porte
  le résultat global, la checklist porte le détail ligne par ligne.
- **Attributs clés `ChecklistItem`** : `id`, `tenantId`, `controlId`,
  `order`, `label`, `mandatory` (booléen).
- **Attributs clés `ChecklistResult`** : `id`, `tenantId`,
  `controlExecutionId`, `checklistItemId`, `checked` (booléen),
  `comment`, `anomalyId` (nullable — lien vers `Anomaly` si l'item a
  généré une anomalie, cahier des charges §12.2 « associé à une
  anomalie »).
- **Relations** : `ChecklistItem` 1:N depuis `Control` ; `ChecklistResult`
  N:1 vers `ControlExecution` et `ChecklistItem`, N:1 optionnel vers
  `Anomaly` ; polymorphe vers Evidence (§2.3, « associé à une
  évidence », un item de checklist peut porter sa propre preuve).

### 7.3 `ControlExecution` — **EXISTANT**
- **Définition** : une occurrence d'exécution d'un contrôle,
  append-only — répond à « le contrôle a-t-il été exécuté ? », jamais «
  est-il efficace ? » (rôle de `ControlEffectivenessAssessment`).
- **Attributs clés** : `controlId`, `plannedDate`/`completedDate`,
  `executedBy`, `result`, `observedAnomalies`, `status`
  (`DONE`/`NOT_DONE`/`NOT_APPLICABLE`), `validatedBy`/`validatedAt`.
- **Relations** : N:1 `Control` ; 1:N `ChecklistResult` (proposé,
  §7.2) ; polymorphe vers Evidence (déjà via `Evidence.controlExecutionId`
  en legacy, plus `evidence_links` en cible).

### 7.4 `ControlEffectivenessAssessment` — **EXISTANT**
- **Définition** : « exécuté ne veut pas dire efficace » (commentaire
  déjà présent dans le code source) — évalue la conception et
  l'efficacité opérationnelle d'un contrôle, distincte de son exécution.
- **Attributs clés** : `evalDate`, `evalType`, `designAdequacy`,
  `executionQuality`, `operationalEffectiveness`, `result`,
  `limitations`, `compensatingControls`, `status`.
- **Relations** : N:1 `Control`.

### 7.5 `Anomaly` — **EXISTANT**
- **Définition** : situation constatée nécessitant qualification/action,
  typiquement lors d'une exécution de contrôle — **distincte d'un
  Incident** (pas nécessairement d'impact réel constaté) et d'un
  `Finding` (pas un constat d'audit formel) — distinction 2.
- **Attributs clés** : `controlId`/`controlExecutionId`/`riskId`
  (tous nullables — une anomalie peut naître de plusieurs contextes),
  `observedAt`, `severity`, `status`
  (`NEW → UNDER_ANALYSIS → ACTION_IN_PROGRESS → CLOSED`), `detectedBy`,
  `closureComment` (obligatoire à la clôture — déjà conforme à la
  convention « état terminal avec commentaire obligatoire »).
- **Relations** : N:1 optionnel vers `Control`/`ControlExecution`/`Risk` ;
  N:1 `ActionPlan.sourceType` n'inclut pas `ANOMALY` aujourd'hui dans le
  code (`ActionLinkResourceType` si, via `ActionLink` — voir §8.2), à
  clarifier en Gap Analysis si une anomalie doit pouvoir être *source*
  d'un plan d'action et pas seulement *liée* à un plan d'action.

---

## 8. Plans d'action

### 8.1 `ActionPlan` — **EXISTANT**
- **Définition** : ticket de remédiation, cycle de vie sur une seule
  ligne (comme `Anomaly`), source polymorphe déjà correctement conçue
  — précédent direct pour le moteur transverse Comments/RACI/Evidence
  (§0.2, §2).
- **Attributs clés** : `sourceType` (`RISK`/`CONTROL`/`KRI`/`AUDIT`/
  `INCIDENT`/`MANAGEMENT`), `sourceId` (nullable selon le type — voir
  commentaire dans `ActionPlan.ts`), `responsibleUserId`,
  `departmentId`, `dueDate`, `status`
  (`PLANIFIEE`/`EN_COURS`/`TERMINEE` — `EN_RETARD` **calculé**, jamais
  stocké : nouveau bon exemple de la distinction 5 appliquée à un objet
  hors incident), `progressPercent`, `evidenceId` (obligatoire à la
  clôture), `closedBy`/`closedAt`/`closureComment`.
- **Relations** : polymorphe vers sa source (`sourceType`/`sourceId`) ;
  1:N `ActionLink` (§8.2) ; N:1 `Evidence` (clôture) ; N:1 `Department` ;
  N:1 `User` (`responsibleUserId`) ; polymorphe vers RACI/Comments (§2).
- **Écart vs cahier des charges** : `sourceType` ne couvre pas
  aujourd'hui `ANOMALY` en tant que **source** directe (seulement comme
  lien secondaire via `ActionLink`), alors que le cahier des charges
  (§19, § « Sources possibles ») liste explicitement `ANOMALY` au même
  rang que `RISK`/`INCIDENT`/`CONTROL`/`AUDIT_FINDING`/
  `AUDIT_RECOMMENDATION`. Idem pour `FINDING` en tant que source
  distincte de `AUDIT` générique (chaîne logique §21 : `Finding →
  Action Plan`).

**Point d'extension proposé (additif)** : élargir l'union
`ActionPlanSourceType` pour inclure `ANOMALY` et `FINDING` comme valeurs
supplémentaires (extension de type, non destructive — les valeurs
existantes restent valides), avec `sourceId` validé côté service pour
ces deux nouveaux cas de la même manière que `RISK`/`CONTROL`/`KRI`
aujourd'hui.

### 8.2 `ActionLink` — **EXISTANT** (type `ActionLinkResourceType`)
- **Définition** : liens secondaires d'un plan d'action vers
  `RISK`/`CONTROL`/`KRI`/`ANOMALY`, distincts de la source primaire.
- **Relations** : N:N conceptuel entre `ActionPlan` et ces types de
  ressources.

---

## 9. Audit

### 9.1 `AuditMission` — **NOUVEAU**
- **Définition** : cadre d'une mission d'audit (le cahier des charges
  §21 parle de « missions » comme point d'entrée de l'auditeur). Non
  détaillé en profondeur ici (hors périmètre du batch de modules déjà
  livrés) ; posé comme fondation conceptuelle pour que `Finding` ait un
  parent naturel.
- **Attributs clés** : `id`, `tenantId`, `reference`, `title`, `scope`,
  `status`, `leadAuditorId`, `startDate`, `endDate`.
- **Relations** : 1:N vers `Finding`.

### 9.2 `Finding` — **NOUVEAU**
- **Définition** : un constat d'audit — **distinct d'`Incident`** (pas
  nécessairement un événement réel) et d'`Anomaly` (pas nécessairement
  issu d'une exécution de contrôle) — distinction 2. Peut être rattaché
  à un risque, un contrôle, un incident, une anomalie, une mission
  d'audit ou une recommandation (cahier des charges §21).
- **Attributs clés** : `id`, `tenantId`, `auditMissionId`, `title`,
  `description`, `severity`, `recommendation` (texte, ou entité
  `AuditRecommendation` séparée si le besoin de suivi indépendant de la
  recommandation se confirme — non tranché ici), `status`.
- **Relations** : N:1 `AuditMission` ; polymorphe vers
  `Risk`/`Control`/`Incident`/`Anomaly` (`relatedObjectType`/
  `relatedObjectId`, même moteur transverse) ; source possible d'un
  `ActionPlan` (`sourceType = "FINDING"`, extension proposée en §8.1)
  — la chaîne logique du cahier des charges (§21) « Finding → Action
  Plan » est ainsi respectée sans qu'un plan d'action naisse forcément
  d'un risque.
- **Accès Audit transverse** : `AuditLogService`/rôle « Auditeur »
  (§2.5, déjà en production) donne la lecture transverse du dispositif ;
  `Finding`/`AuditMission` sont les objets *produits* par l'auditeur,
  distincts du journal `AuditEvent` qu'il consulte.

---

## 10. Gouvernance & Collaboration

Cette section ne recrée pas de nouvelles tables : elle **référence**
les capacités transverses déjà définies en §2 (`RaciAssignment`,
`Comment`/`CommentableObjectConfig`, `Evidence`/`evidence_links`,
`AuditEvent`) et ajoute les deux éléments de gouvernance propres au
cahier des charges qui n'ont pas encore d'équivalent capacité
transverse :

### 10.1 Lignes de défense — **EXISTANT (partiel) / NOUVEAU (formalisation)**
- **État actuel** : `Control.defenseLine` (texte libre) et
  `RatingScale.masteryScale.defenseLines` (JSONB, liste de labels)
  existent déjà et permettent de ne **pas** déduire rigidement la ligne
  de défense du département — conforme au principe §23 du cahier des
  charges.
- **Écart** : pas de table `DefenseLineMapping`
  (`fonction/activité → rôle → ligne`) structurée ; le rattachement
  reste un champ texte sur `Control`. Jugé suffisant tant qu'aucun
  besoin de reporting croisé ne l'exige — à confirmer en Gap Analysis,
  pas de nouvelle table créée ici par anticipation (cohérent avec la
  directive « pas de nouvelle table sans justification par Gap
  Analysis »).

### 10.2 Workflows / statuts configurables — **EXISTANT (par entité), NOUVEAU (moteur générique)**
- **État actuel** : chaque entité porte ses propres transitions
  validées côté service (`isValidTransition` pour `Risk`,
  `VALID_TRANSITIONS` pour `Anomaly`, calcul read-time pour
  `ActionPlan`/`Indicator` (KPI et KRI, deux fonctions de statut
  distinctes sur la même table — §5.5). Le cahier des charges (§28)
  présente ces
  statuts comme « une proposition de modèle, doivent rester
  configurables » — aujourd'hui les transitions sont codées en dur par
  service, pas un moteur de workflow générique piloté par
  configuration.
- **Décision de ce document** : ne **pas** introduire de moteur de
  workflow générique tant qu'aucun besoin réel ne le justifie
  (cohérent avec ADR-001 « Ce qu'on NE fait PAS en V1 » et avec la
  directive ponytail du PO — pas d'abstraction spéculative). Les
  statuts par entité restent la source de vérité ; ce point est
  simplement documenté ici comme écart connu et assumé, à ne pas
  combler par une nouvelle entité `WorkflowEngine`.

---

## 11. Diagramme du modèle cible

```text
                                    TENANT
                                       │
                 ┌─────────────────────┼─────────────────────┐
                 │                     │                     │
           DEPARTMENT               USER                   ROLE
                 │                     │                     │
                 ▼                     │              PERMISSION
             PROCESS                   │                     │
                 │                     └──────RoleAssignment──┘
                 │
                 │        ┌──────────────────────────────────────┐
                 │        │      CAPACITÉS TRANSVERSES (§2)       │
                 │        │  ┌────────────┐  ┌──────────────────┐│
                 │        │  │RaciAssignment│  │Comment/Commentable││
                 │        │  └──────┬─────┘  └────────┬─────────┘│
                 │        │  ┌──────┴─────┐  ┌─────────┴────────┐│
                 │        │  │  Evidence   │  │    AuditEvent     ││
                 │        │  │(+evidence_  │  │  (append-only)    ││
                 │        │  │  links)     │  └────────────────────┘│
                 │        │  └─────────────┘   objectType/objectId  │
                 │        │      polymorphe, whitelist maîtrisée     │
                 │        └──────────────────────▲───────────────────┘
                 │                                │ référencé par TOUS
                 ▼                                │ les objets ci-dessous
          RISK_CATALOG (NOUVEAU)                  │
                 │  ↕ RiskCatalogCause ↕ RiskCause │
                 ▼                                │
               RISK (registre) ◄───────────────────┘
                 │
   ┌─────────────┼───────────────┬───────────────┬───────────────┐
   │              │               │               │               │
   ▼              ▼               ▼               ▼               ▼
RISK_ASSESSMENT RISK_EVALUATION CONTROL      INDICATOR      RISK_INCIDENT
(DÉPRÉCIÉ,      (= « Risk          │       (indicator_type=      │
 table morte,    Assessment »      │        KPI | KRI,           ▼
 non alimentée)  métier cible,     │        table unique)     INCIDENT
                 tranché 2026-     │             │            (occurredAt/
                 09-28)            │             ▼             detectedAt/
                     │            │      INDICATOR_MEASURE     containedAt/
                     │      ┌─────┼─────┐  (append-only,       resolvedAt)
                     │      ▼     ▼     ▼   remplace                │
                     │  CHECKLIST_ITEM  │   KpiMeasure/         Vélocité/
                     │      │    CONTROL_EXECUTION  KriMeasure) Persistance
                     │      ▼           │                       (CALCULÉES,
                     │  CHECKLIST_      ▼                        jamais
                     │  RESULT     CONTROL_EFFECTIVENESS_        stockées)
                     │      │        ASSESSMENT
                     │      ▼
                     │   ANOMALY ◄──────────────────┐
                     │      │                        │
                     ▼      ▼                        │
              RATING_SCALE  │                        │
                            ▼                        │
                    ACTION_PLAN ◄── sourceType ───────┤
                    (RISK/CONTROL/KRI/AUDIT/          │
                     INCIDENT/MANAGEMENT/             │
                     [+ANOMALY/FINDING proposés])      │
                            ▲                          │
                            │                          │
                       AUDIT_MISSION (NOUVEAU)         │
                            │                           │
                            ▼                           │
                        FINDING (NOUVEAU) ───────────────┘
                     (≠ Incident, ≠ Anomaly)

   RISK ◄──riskCategoryId (proposé)──┐
   RISK_CATALOG ◄──riskCategoryId────┼── RISK_CATEGORY (EXISTANT,
   RISK_EVALUATION/RISK_APPETITE ◄───┘    canonique — 3 FK nullables
   (subCategory encore texte libre         proposées, migration
    jusqu'à bascule actée)                 progressive Expand/Contract)

   RISK_CATALOG / RISK / PROCESS
              │
              ▼  (lien polymorphe document_links)
           DOCUMENT (NOUVEAU, ≠ Evidence)

   RISK ──process_id (FK 1:1 réelle, migration 029, DECISION-006)──► PROCESS
   (process texte libre conservé en parallèle jusqu'au backfill)
   pas de RISK_PROCESSES (N:N Risk↔Process écarté définitivement,
    pas différé — DECISION-007, 2026-09-29 ; réouverture seulement sur
    un 2e cas d'usage réel confirmé)

   TOUT OBJET GRC CI-DESSUS
        │
        ├── RACI_ASSIGNMENT   (IAM ≠ RACI, §2.1/§2.2)
        ├── COMMENT            (si CommentableObjectConfig.enabled)
        ├── EVIDENCE (via evidence_links)  (Evidence ≠ Document, §2.3/§4.4)
        └── AUDIT_EVENT         (append-only strict)
```

**Légende de statut** : `RISK_CATALOG`, `RISK_INCIDENT`, `INCIDENT`,
`RaciAssignment`, `Comment`/`CommentableObjectConfig`, `evidence_links`,
`ChecklistItem`/`ChecklistResult`, `Document`/`document_links`,
`AuditMission`, `Finding`, `Indicator`/`IndicatorMeasure` (modèle
physique unifié, §5.5 — décision Product Owner du 2026-09-28) =
**NOUVEAU**. `Risk` (+ `riskCatalogId`/`riskCategoryId`), `Department`,
`Process`, `Control`, `Evidence`, `RiskAppetite` (+ `riskCategoryId`),
`RiskEvaluation` (+ `riskCategoryId`) = **EXISTANT_À_ÉTENDRE** (extension
additive documentée par entité ci-dessus). `RiskAssessment` (l'entité
technique) = **EXISTANT, DÉPRÉCIÉ** (§5.1 — ne pas confondre avec le
concept métier « Risk Assessment », incarné par `RiskEvaluation`).
`Kpi`/`Kri`/`KpiMeasure`/`KriMeasure` = **EXISTANT, à consolider** vers
`Indicator`/`IndicatorMeasure` (coexistence Expand/Contract, dépréciées
seulement après validation — jamais un statut cible final). Tout le
reste (`RatingScale`, `RiskCategory`, `ControlExecution`,
`ControlEffectivenessAssessment`, `Anomaly`, `ActionPlan`, `ActionLink`,
`Role`, `RoleAssignment`, `AuditEvent`, `Tenant`, `User`,
`RegulatoryFramework`, `ModuleToggle`, `Config`, `Notification`,
`NotificationSubscription`, `ReviewCycle`, `Feedback`,
`TenantBranding`) = **EXISTANT**.

---

## 12. Synthèse pour la Gap Analysis (prochain artefact)

> Cette synthèse intègre les 4 décisions du Product Owner du 2026-09-28
> (SHARED_LOG, « Arbitrage des 4 points ouverts de la Gap Analysis ») :
> `RiskAssessment` confirmé DÉPRÉCIÉ au profit de `RiskEvaluation` ;
> `RiskCategory` confirmé canonique avec 3 FK nullables à câbler ;
> `risk_processes` explicitement **écartée, pas différée** (arbitrage
> refait le 2026-09-29, DECISION-007, sur la base de la FK 1:1 réelle
> `risks.process_id`, migration 029) ; `Kpi`/`Kri`
> **consolidés** en un modèle physique unique `Indicator`/
> `IndicatorMeasure` — le changement le plus structurant, qui déplace
> 4 tables existantes (`kpis`, `kris`, `kpi_measures`, `kri_measures`)
> d'EXISTANT vers une consolidation NOUVEAU/DÉPRÉCIÉ.

| Statut | Nombre d'entités | Détail |
|---|---|---|
| EXISTANT (inchangé) | 18 | `Tenant`, `User`, `TenantBranding`, `Role`/`RoleAssignment`, `AuditEvent`, `RatingScale`, `RiskCategory`, `Control`, `ControlExecution`, `ControlEffectivenessAssessment`, `Anomaly`, `ActionPlan`/`ActionLink`, `RegulatoryFramework`, `ModuleToggle`, `Config`, `Notification`/`NotificationSubscription`, `ReviewCycle`, `Feedback` |
| EXISTANT_À_ÉTENDRE | 6 | `Department`, `Process`, `Risk` (+ `riskCatalogId`, + `riskCategoryId`), `Evidence` (+ `evidence_links`), `Control` (+ `sampleSize`), `RiskAppetite` (+ `riskCategoryId`), `RiskEvaluation` (+ `riskCategoryId`, confirmée implémentation cible unique du « Risk Assessment » métier) — extensions toutes additives/nullables |
| EXISTANT, DÉPRÉCIÉ | 1 | `RiskAssessment` (entité + table `risk_assessments`) — scaffolding mort, dépréciation confirmée, suppression physique hors périmètre |
| NOUVEAU | ~12 | `RiskCatalog`, `RiskCause`/`RiskCatalogCause`, `Document`/`document_links`, `Incident`, `RiskIncident`, `ChecklistItem`/`ChecklistResult`, `RaciAssignment`, `Comment`/`CommentableObjectConfig`, `AuditMission`, `Finding` |
| NOUVEAU (consolidation) | 2 | `Indicator` (table `indicators`, discriminant `indicator_type = KPI \| KRI`), `IndicatorMeasure` (table `indicator_measures`) — remplacent à terme `Kpi`/`Kri`/`KpiMeasure`/`KriMeasure` (4 tables existantes, EXISTANT jusqu'à dépréciation actée après backfill et coexistence, Expand/Contract, même gouvernance que `RiskAssessment`) |
| Écartée (décision définitive, pas différée) | 1 | `risk_processes` (N:N `Risk`↔`Process`) — écartée le 2026-09-28, arbitrage refait le 2026-09-29 (DECISION-007) sur la base de la FK 1:1 réelle `risks.process_id` (migration 029) ; réouverture seulement sur un 2e cas d'usage réel confirmé (registre piloté sur plusieurs processus avec une seule évaluation partagée), jamais anticipé |

Ce comptage part de l'ordre de grandeur cité par le Product Owner
(« ~15 objets sur 35 cibles sont déjà présents sous une forme proche » —
SHARED_LOG, 2026-09-28) et l'affine à la lumière des 4 arbitrages du
2026-09-28 : il donne à la mise à jour de la Gap Analysis / du Migration
Plan une liste fermée à vérifier champ par champ contre les 26
migrations existantes, en tenant compte en particulier de la
consolidation `Kpi`/`Kri` → `Indicator`, la plus structurante des
quatre.
