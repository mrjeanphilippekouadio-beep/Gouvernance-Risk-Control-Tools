# RM V1 — Lot B-6 : Dispositif `RiskFramework` versionné — spécification d'implémentation

**Statut** : spécification de l'Architecte (A05), 2026-10-11. Aucun code ni migration produits.
**Roadmap** : R1.4 (`docs/ROADMAP-V1.md`). **Destinataires** : A06 (code), A07 (migrations), A08/A10/A14 (passages après merge).
**Sources** : `RM-V1-Lots-contrat-amende.md` (B-6, F-8, §4 invariants) ; contrat `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` §6, §8, §10 ; `RM-V1-Contrat-etape2-PROJET.md` §7 ; Decision Log jusqu'à DECISION-043 ; questions q81 à q83 (amorçage), posées au PO et encore sans réponse.

À lire avant de coder : `CLAUDE.md`, sections « Backend architecture », « Adding a new domain module » et « Security-sensitive conventions » ; puis `memory/dev-backend.md` et `memory/dev-db.md`.

Sauf mention contraire, chaque règle ci-dessous est **décidée**. Les points non tranchés sont regroupés au §14 (questions PO) et ne sont **pas** implémentés au-delà de ce qui y est indiqué.

---

## 0. Résumé

1. Le Dispositif se compose d'une identité stable (`risk_frameworks`) et de versions immuables (`risk_framework_versions`). Une version porte ses paramètres en colonnes typées, plus l'échelle, référencée par FK vers une `rating_scales` existante.
2. Une version suit ce cycle : `DRAFT → PENDING_APPROVAL → ACTIVE → ARCHIVED`. Un refus ou un retrait de la demande la ramène en `DRAFT`, et un brouillon abandonné passe en `ARCHIVED`.
3. Chaque changement passe par une demande inscrite dans `risk_framework_change_requests`, en append-only (une seule transition, de PENDING vers une décision). La personne qui décide est toujours un tiers. B-6 met en œuvre l'approbation par la fonction risque et le repli. Le vote d'Audit ou du Comité arrive avec B-12 : d'ici là, ces demandes restent en attente (fail-closed).
4. À partir de B-6b, le Dispositif devient la **source unique** des paramètres. Les écritures concurrentes dans `configs`, `risk_appetites` et `RatingScaleService.activateVersion` sont fermées.
5. Une évaluation fige à sa création la version du Dispositif, l'échelle et les seuils Comité (F-8, invariant 9).
6. L'amorçage (q77) est isolé dans le sous-lot B-6d, en attente de q81 à q83. Sans B-6d, un tenant qui n'a qu'un seul Risk Manager ne peut pas activer son premier Dispositif : la demande reste en attente avec une alerte.

## 1. Découpage en sous-lots

Le lot est de taille L. Il est découpé en quatre sous-lots, à merger dans cet ordre.

| Sous-lot | Contenu | Taille | Migration (indicative, à revérifier) | Dépend de |
|---|---|---|---|---|
| **B-6a** Socle | Tables, cycle de vie, demandes et circuit d'approbation (fonction risque et repli), immuabilité, permissions, routes, audit, brouillon de reprise par tenant | M | **055** | — |
| **B-6b** Branchement | Résolution du Dispositif applicable, instantané F-8 sur l'évaluation, Cartographie, Risk 360, fermeture des écritures concurrentes | M | **056** | B-6a |
| **B-6c** Multi-Dispositif | Rattachement Processus → Dispositif, changement du Dispositif par défaut, archivage d'un Dispositif | S | aucune (schéma dans 055) | B-6a |
| **B-6d** Amorçage | Exception q77, avec son périmètre et sa fin | S | aucune | B-6a ; **q81 à q83** |

B-6a et B-6b suffisent à faire fonctionner un tenant qui n'a qu'un seul Dispositif. B-6c et B-6d peuvent suivre sans bloquer B-5.

Avant d'écrire une migration, vérifier le dernier numéro dans `database/postgresql/migrations/`. Le 2026-10-11, c'était 054, donc 055 est libre.

## 2. Ce que porte le Dispositif

### 2.1 Identité : `risk_frameworks`

`id`, `tenant_id`, `name` (unique par tenant parmi les non archivés, comparaison insensible à la casse), `description`, `is_default` (au plus un `true` par tenant parmi les non archivés), `created_by` (nullable : NULL signifie « créé par la migration »), `created_at`, `updated_at`, `archived_at`, `archived_by`, `archive_reason`.

L'identité ne porte **aucun paramètre méthodologique**.

### 2.2 Version : `risk_framework_versions`

Une colonne typée par paramètre. Pas de jsonb générique.

| Colonne | Type et contrainte | Défaut | Source |
|---|---|---|---|
| `rating_scale_id` | uuid NOT NULL, FK `rating_scales` | — | §6 : échelle, axes, descriptifs, bandes, maîtrise |
| `default_evaluation_mode` | text, CHECK `CLASSIQUE`/`PARTICIPATIF` | `CLASSIQUE` | DECISION-018 P1 |
| `committee_evaluation_min_score` | int NOT NULL, CHECK 1..36 | n² × 15 / 25, arrondi à l'inférieur (5, 9, 15, 21) | §8, q71 |
| `committee_evaluation_enforced` | boolean NOT NULL | `true` | §8, Lot A |
| `committee_treatment_min_score` | int NULL, CHECK 1..36 | NULL (fail-closed) | §8 |
| `appetite_thresholds` | jsonb NOT NULL, CHECK `jsonb_typeof = 'array'` | `[]` | DECISION-017 §5 |
| `change_approver` | text, CHECK `RISK_MANAGER`/`AUDIT`/`COMMITTEE`/`AUDIT_AND_COMMITTEE` | `RISK_MANAGER` | q34, DECISION-016 |
| `self_proposal_allowed` | boolean NOT NULL | `false` | invariant 5, q65 |

Colonnes de cycle de vie : `framework_id`, `tenant_id`, `version_number` (unique par Dispositif), `status`, `created_by` (nullable : NULL signifie « migration »), `last_edited_by`, `created_at`, `updated_at`, `activated_at`, `activation_request_id`, `archived_at`, `archived_by`, `archive_reason`.

**Appétence en jsonb typé**, sur le modèle de `RatingScale.impactAxes`. C'est une liste de valeurs configurées ensemble et figées avec la version. Elle n'a pas d'identité propre et aucune autre entité ne la référence. Une table enfant obligerait à faire des `DELETE` sur les brouillons, ce qu'interdit CLAUDE.md. La forme d'une entrée est `{ subCategory, subCategoryId|null, entity|null, threshold, description|null }`. Le service la valide : au plus 200 entrées ; `(subCategory, entity)` unique ; seuil entier compris entre 1 et n² ; `subCategoryId` du tenant (fail-closed si le dépôt n'est pas câblé, voir `RiskAppetiteService.assertSubCategoryExists`).

**Invariants : jamais en colonne** (invariant 8). Rien ne permet de paramétrer « validateur hors des auteurs », « jamais d'auto-approbation », « RM + Audit interdit », etc.

**Paramètres reportés aux lots qui les consomment** (consigne ponytail : pas de colonne sans lecteur). Chacun est ajouté par `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT <défaut du contrat>`, ce qui ne déclenche pas le trigger d'immuabilité :
- seuil « faible », plafond de cumul RO + EXEC, cumul DEL + EXEC, durée de délégation → B-5 ;
- politique Hybride → B-2 ;
- Maîtrise qui fait foi → B-1 ;
- règle du Comité asynchrone (A, B, C ou personnalisée) → B-12 ;
- statuts de contribution personnalisés → B-3 ;
- mode d'appétence et règle de surcharge → arbitrage F-9.

Les versions déjà archivées reçoivent alors la valeur par défaut du contrat, qui était le comportement implicite. Ce point est noté dans la migration de chaque lot.

### 2.3 Échelle : réutilisation de `RatingScale`, sans duplication

- La version référence une `rating_scales` **existante**. Changer l'échelle, les axes, les descriptifs ou les bandes veut dire créer une nouvelle échelle par les routes `ratingscale.*` existantes, puis la référencer dans un brouillon de Dispositif.
- Une même échelle peut être référencée par plusieurs Dispositifs, par exemple les Dispositifs par défaut de B-13.
- Les règles d'activation d'une échelle quittent `RatingScaleService` pour une fonction pure, `domain/ratingScaleRules.ts` : `assertDescriptors` et `assertReadyToActivate` y sont **déplacées** et non copiées. `RatingScaleService` et `RiskFrameworkService` les importent toutes deux.
- Règles supplémentaires, vérifiées au moment de la demande d'activation :
  - `probabilityLevels === impactLevels`, échelle carrée (DECISION-041). Les échelles historiques à tailles inégales sont refusées.
  - `impactAxes` contient au moins un axe.
  - L'échelle n'est pas supprimée.
  - Chaque seuil de la version est ≤ `maxScoreForScale(scale)`, fonction de `domain/scoring.ts`. Cela vaut pour les seuils Comité, chaque appétence et chaque borne de `criticalityThresholds`.

**Statut de l'échelle.** `rating_scales.status` devient un **miroir dérivé**, écrit uniquement par `PostgresRiskFrameworkRepository` dans les transactions d'activation et d'archivage :
- une échelle est ACTIVE si au moins une version ACTIVE la référence ;
- elle passe ARCHIVED quand plus aucune version ACTIVE ne la référence.

Aucune décision métier ne lit ce miroir. Il existe pour que les gardes R-01 déjà en place (`assertMutable`, filtre `status = 'DRAFT'` de `setJsonColumn`) restent vraies, et pour que l'écran des échelles reste exact. La seule source de vérité pour savoir « quelle échelle s'applique » est le Dispositif (§7).

## 3. Ce qui reste dans `configs`, ce qui migre

**Règle anti-double-source.** À chaque instant, un paramètre a un seul propriétaire. À partir de B-6b, les paramètres qui migrent ne sont **plus ni lus ni écrits** dans leur ancien emplacement. Les colonnes restent en base (expand-only), mais leurs méthodes d'écriture répondent `ValidationError`, avec le message « Ce réglage est porté par le Dispositif : créez une nouvelle version ».

| Réglage actuel | Devient | Ancienne écriture fermée en B-6b |
|---|---|---|
| `configs.committee_evaluation_min_score` | `versions.committee_evaluation_min_score` | `ConfigService.updateCommitteeThresholds` |
| `configs.committee_treatment_min_score` | `versions.committee_treatment_min_score` | idem |
| `configs.committee_evaluation_enforced` | `versions.committee_evaluation_enforced` | `ConfigService.setCommitteeEnforcement` |
| `configs.evaluation_mode` | `versions.default_evaluation_mode` | `ConfigService.updateEvaluationMode` |
| `risk_appetites` (lignes actives) | `versions.appetite_thresholds` | `RiskAppetiteService.setThreshold` et `archive` |
| échelle ACTIVE du tenant | `versions.rating_scale_id` | `RatingScaleService.activateVersion` |

**Ce qui reste dans `configs`** :
- `committee_audit_cumul_allowed` (q58) : réglage de plateforme sur les groupes, et non sur la méthodologie.
- `score_formula`, `level_thresholds`, `impact_retenu_rule`, `appetite_mode` : aucun code ne les lit aujourd'hui (voir l'en-tête de `ConfigService`). Ils restent inertes et ne migrent pas. `appetite_mode` sera traité avec F-9.

**Fermeture conditionnelle au câblage.** Chaque service concerné reçoit un paramètre de constructeur **optionnel**, `frameworks?: Pick<RiskFrameworkRepository, "...">`. Quand il est présent (dans `server.ts`, donc toujours en production), l'écriture est fermée. Quand il est absent, le comportement actuel est conservé : c'est le motif du « paramètre optionnel » de CLAUDE.md, qui évite de casser les tests existants. Les lectures (`GET /config`, `GET /appetite`) restent disponibles comme historique et sont documentées comme obsolètes dans le JSDoc de la route.

`resolveMaxScore` (`services/scoreCeiling.ts`) n'est plus appelé sur un chemin d'écriture ouvert. On le garde pour les chemins hérités : il n'y a rien à supprimer dans ce lot.

## 4. Cycle de vie

```
DRAFT ──(demande)──► PENDING_APPROVAL ──(approbation)──► ACTIVE ──(remplacement ou archivage)──► ARCHIVED
  ▲                        │
  └───(refus / retrait)────┘
DRAFT ──(abandon, riskframework.archive)──► ARCHIVED   (activated_at IS NULL)
```

- **Unicité** (index uniques partiels) : au plus une version `DRAFT` ou `PENDING_APPROVAL` par Dispositif, et au plus une version `ACTIVE` par Dispositif.
- **Création d'un brouillon** : par copie d'une version (l'ACTIVE par défaut, ou `fromVersionId`). Tous les paramètres sont recopiés ; `version_number` vaut le maximum + 1.
- **Modification d'un brouillon** : `PATCH` partiel construit avec `buildUpdateSet`. **Aucun champ `status`** dans l'entrée : une modification ne peut jamais servir de transition (règle CLAUDE.md sur `update()`). `last_edited_by` est forcé à `actor.userId`.
- **Demande d'activation** : la version passe en `PENDING_APPROVAL` et une ligne de demande est créée, avec un motif obligatoire. Toutes les validations du §2.3 sont rejouées à ce moment-là. Une version PENDING est figée : l'approbateur approuve exactement ce qui a été demandé.
- **Approbation** : voir §5. Une seule transaction SQL dans le dépôt :
  1. réserver la demande (`FOR UPDATE`, PENDING → APPROVED) ;
  2. passer la version en ACTIVE ;
  3. passer l'éventuelle version ACTIVE précédente du même Dispositif en ARCHIVED (`archived_by` = décideur, `archive_reason` = « remplacée par vN ») ;
  4. mettre à jour le miroir des échelles ;
  5. si le tenant n'a encore aucun Dispositif par défaut, passer ce Dispositif en `is_default = true`.
- **Refus et retrait** : la demande passe en REJECTED ou WITHDRAWN (commentaire obligatoire en cas de refus) et la version revient en `DRAFT`. Le refus reste dans l'historique ; il n'est pas compté comme un échec pour la suite.
- **Abandon d'un brouillon** : `DRAFT → ARCHIVED`, avec motif, sous `riskframework.archive` (transition terminale, donc permission dédiée).

**Effet au cycle suivant** (invariant 9) : obtenu par l'instantané (§8). Aucune évaluation existante ne change.

## 5. Demandes et circuit d'approbation

### 5.1 Table `risk_framework_change_requests` (append-only, modèle de la migration 033)

| Colonne | Contenu |
|---|---|
| `kind` | `ACTIVATE_VERSION` \| `ASSIGN_PROCESS` \| `SET_DEFAULT` |
| `framework_id` | NOT NULL |
| `version_id` | NOT NULL si `ACTIVATE_VERSION` |
| `process_id` | NOT NULL si `ASSIGN_PROCESS`. La cohérence entre `kind` et les colonnes est contrôlée par un CHECK |
| `previous_value` | jsonb : version active, Dispositif précédent du Processus ou ancien défaut |
| `reason` | NOT NULL, au plus 500 caractères |
| `status` | `PENDING` \| `APPROVED` \| `REJECTED` \| `WITHDRAWN` |
| `requested_by` | NOT NULL, forcé à `actor.userId` |
| `decided_by`, `decided_at`, `decision_comment` | renseignés à la décision |
| `decision_regime` | NULL tant que la demande est PENDING ; sinon `NORMAL` \| `FALLBACK` \| `BOOTSTRAP` |
| `decider_group` | `RISK_MANAGER` \| `AUDIT` \| `COMMITTEE` |
| `ratification_status` | NULL, ou `PENDING` pour une décision `FALLBACK` ou `BOOTSTRAP` (q62). La ratification elle-même relève de B-12 |

Contraintes :
- `CHECK (decided_by IS NULL OR decided_by <> requested_by OR decision_regime = 'BOOTSTRAP')`. Le cas `BOOTSTRAP` n'est utilisé qu'à partir de B-6d. Le CHECK est posé dès 055 pour éviter une migration de plus.
- Index unique partiel : une seule demande `PENDING` par `(framework_id, kind, coalesce(process_id))`.
- Mutations autorisées : seulement la transition PENDING → terminal, via des méthodes étroites du dépôt (`recordDecision`, `withdraw`). Jamais d'`update` générique.

### 5.2 Quelle règle s'applique

La règle d'approbation vient de la **version ACTIVE en vigueur** :
- pour `ACTIVATE_VERSION` et `SET_DEFAULT` : la version active du Dispositif concerné ;
- pour `ASSIGN_PROCESS` : la version active du Dispositif **cible** (voir §14, Q4).

Un brouillon ne choisit donc jamais son propre approbateur. Changer `change_approver` est lui-même approuvé selon l'ancienne règle.

Sans version active (premier Dispositif, q51) : `RISK_MANAGER`.

### 5.3 Qui peut décider (`decide()`, permission `riskframework.activate`)

Toutes les conditions suivantes doivent être réunies :
1. le décideur détient `riskframework.activate` ;
2. il est **membre actif du groupe Risk Manager** (q51 : l'administrateur seul n'est jamais décideur ; un administrateur qui est aussi RM l'est en tant que RM, q63). « Membre actif » a la même définition qu'en B-8 v2 : assignation non révoquée et utilisateur non suspendu ;
3. il n'est pas le demandeur ;
4. il n'est l'auteur d'aucune modification de la version : son identifiant n'apparaît ni dans `created_by` ni dans les entrées `CREATE` ou `UPDATE` de `AuditRepository.listForEntity(tenantId, "RiskFrameworkVersion", versionId)`. On réutilise l'existant, sans nouvelle colonne.

### 5.4 Circuit (q34, q54, q69, q72, q76)

La fonction pure `resolveDecider(approver, groups, excluded)` est placée dans `domain/frameworkApproval.ts`. Elle prend la liste des membres actifs de chaque groupe et l'ensemble des personnes exclues (demandeur et auteurs). Un groupe n'est **sollicité** que s'il compte **au moins 2 membres éligibles** (q72) ; sinon on passe au maillon suivant, et la décision est marquée comme prise en repli.

| `change_approver` | Résultat |
|---|---|
| `RISK_MANAGER` (défaut) | Décision par un RM (§5.3), `NORMAL`. Audit est **notifié** si son groupe n'est pas vide (q34) |
| `COMMITTEE` | Comité éligible (≥ 2) → **vote** ; sinon Audit éligible (≥ 2) → **vote** (q76) ; sinon RM en `FALLBACK` |
| `AUDIT` | Audit éligible → **vote** ; sinon Comité éligible → **vote** ; sinon RM en `FALLBACK` |
| `AUDIT_AND_COMMITTEE` | Deux votes (§14, Q3) ; sinon même repli |

- **Vote : pas dans B-6.** Si le décideur résolu est un vote, `decide()` répond `ConflictError` (409) : « Cette demande attend le vote du groupe X (fonctionnalité B-12) ». La demande reste PENDING et le demandeur peut la retirer. B-12 branchera son vote sur ce même `decide`, avec `decision_regime = 'NORMAL'` et `decider_group` = le groupe concerné.
- **Repli (`FALLBACK`)** : la décision est prise par un RM (§5.3), avec un commentaire **obligatoire**. `ratification_status = 'PENDING'`, Audit est notifié s'il n'est pas vide (q56), et la décision est marquée pour la vue « décisions prises en votre absence » (B-12).
- **Auto-proposition (q65).** Une demande qui fait passer `self_proposal_allowed` de `false` (ou d'une absence de version active) à `true` n'est recevable **que si le décideur résolu est un vote du Comité**. Si le résultat est un vote d'Audit, une décision RM, un repli ou un amorçage, la demande est **refusée dès sa création** (`ValidationError`) : « L'activation de l'auto-proposition exige un vote du Comité ». Conséquence : elle n'est pas activable avant B-12 (§14, Q8).
- **Plus personne pour décider** (q75). Si aucun RM ne remplit les conditions du §5.3 (par exemple un seul RM, qui est le demandeur), la demande reste PENDING. Une notification `RISK_FRAMEWORK_NO_DECIDER` est envoyée à tous les membres RM. Jamais de validation tacite, jamais par l'administrateur.

### 5.5 Notifications (au mieux, sur le modèle de `RoleService.notifyMembers`)

Un échec de notification est journalisé et n'est jamais fatal. `resourceType` vaut `MANAGEMENT`.

| Événement | Destinataires |
|---|---|
| `RISK_FRAMEWORK_CHANGE_PENDING` | Détenteurs de `riskframework.activate`, sauf le demandeur |
| `RISK_FRAMEWORK_CHANGE_DECIDED` | Le demandeur |
| `RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE` | Détenteurs de `audit.read` (même convention qu'en q65), quand Audit n'est pas le décideur |
| `RISK_FRAMEWORK_NO_DECIDER` | Membres RM |

## 6. Immuabilité (invariant 7 et R-01), défense en profondeur

1. **Service** : seules les versions `DRAFT` sont modifiables (`assertDraft`). Aucune méthode n'accepte de `status`.
2. **Trigger** `risk_framework_versions_guard`, BEFORE UPDATE OR DELETE, avec une fonction plpgsql dédiée :
   - `DELETE` est toujours refusé ;
   - si `OLD.status IN ('ACTIVE','ARCHIVED')`, seule la transition `ACTIVE → ARCHIVED` est permise, avec `archived_at`, `archived_by` et `archive_reason` renseignés, tous les autres champs inchangés et `updated_at` toléré ;
   - si `OLD.status = 'PENDING_APPROVAL'`, seules les transitions vers `DRAFT` ou `ACTIVE` sont permises (ainsi que `activated_at` et `activation_request_id`), paramètres inchangés ;
   - un trigger de TRUNCATE refuse toute troncature (modèle de la migration 038) ;
   - code d'erreur `42501`, mappé en `ValidationError` par le dépôt.
3. **Trigger sur `rating_scales`** (`rating_scales_framework_freeze`) : refuse toute modification d'une colonne de contenu, et tout passage de `deleted_at` à une valeur non NULL, quand l'échelle est référencée par une version au statut différent de `DRAFT`. Colonnes de contenu : `name`, `version`, `probability_levels`, `probability_labels`, `impact_levels`, `impact_labels`, `criticality_thresholds`, `impact_axes`, `velocity_levels`, `persistence_levels`, `mastery_scale`. Les colonnes `status`, `activated_at` et `archived_at` restent modifiables, pour le miroir.
4. `risk_framework_change_requests` : un trigger refuse `DELETE` et toute mise à jour d'une ligne dont `status <> 'PENDING'`.

## 7. Résolution du Dispositif applicable (B-6b)

La fonction de service interne `resolveApplicableVersion(tenantId, processId | null)` se trouve dans `services/riskFrameworkResolution.ts`. Elle ne vérifie pas de permission : ce sont les appelants qui ont déjà autorisé l'acte (même raisonnement que `resolveEvaluationModeForRisk`).

1. Remonter la chaîne des Processus jusqu'au niveau PROCESS, en réutilisant le parcours existant (`PROCESS_LEVEL_BY_RANK`).
2. Si `processes.risk_framework_id` est renseigné, prendre ce Dispositif. Sinon, prendre le Dispositif du tenant marqué `is_default`.
3. Renvoyer sa version ACTIVE, avec son échelle.
4. S'il n'y a pas de Dispositif, ou pas de version ACTIVE, renvoyer `null`. Pour un appelant en écriture, cela donne `ValidationError` : « Aucun Dispositif actif ne s'applique à ce risque ». Il n'existe **aucun repli** vers `configs` ni vers l'ancienne « échelle ACTIVE ».

`processes.risk_framework_id` (FK nullable) est posé par la migration 055 avec `CHECK (risk_framework_id IS NULL OR level = 'PROCESS')`. Il n'est écrit qu'en B-6c, après approbation.

## 8. Instantané pris par l'évaluation (F-8, B-6b, migration 056)

Nouvelles colonnes de `risk_evaluations` :
- `risk_framework_version_id` (FK, nullable seulement pour les lignes antérieures) ;
- `committee_evaluation_min_score` (int, 1..36) ;
- `committee_evaluation_enforced` (boolean) ;
- `committee_treatment_min_score` (int, nullable).

À la création (`RiskEvaluationService.create`) :
- la version applicable est résolue (§7). Sans version, la création est refusée ;
- `riskFrameworkVersionId` est enregistré ;
- `ratingScaleId` et `ratingScaleVersion` sont désormais posés **à la création**, à partir de la version, et non plus lors de la cotation de l'Inhérent ;
- les trois seuils sont **copiés**. La version étant immuable, la FK suffirait ; la copie permet de rendre explicites les lignes antérieures, remplies par la migration ;
- `evaluationMode` vaut `resolveInheritedEvaluationMode(chain, version.defaultEvaluationMode)`, en réutilisant la fonction existante. `Config.evaluationMode` n'est plus lu.

Ce qui se lit ensuite sur l'évaluation, et nulle part ailleurs :
- `validate`, `validateByCommittee` : seuils copiés sur l'évaluation. `resolveCommitteeEvaluationSettings` disparaît des chemins de validation ;
- `TreatmentDecisionService` : seuil de traitement de l'évaluation rattachée, au lieu de `Config` ;
- `recordInherentScoring` et `recordResidualScoring` : `getRatingScaleOrThrow(evaluation.ratingScaleId)`. Pour une ligne antérieure dont `ratingScaleId` est NULL, l'échelle est celle de la version applicable (§7), pas l'ancienne « échelle active » ;
- appétence suggérée (cotation résiduelle et `suggestAppetite`) : `version.appetiteThresholds` de l'évaluation, par la fonction pure `findAppetite(list, subCategory, entity)` placée dans le domaine. Elle doit appliquer exactement la même règle de correspondance que `PostgresRiskAppetiteRepository.getBySubCategory` (A06 la relit avant de l'écrire). Pour une ligne antérieure sans version, la lecture actuelle de `risk_appetites` est conservée en lecture seule et documentée comme chemin historique.

La surcharge d'appétence (F-9) n'est pas modifiée.

Remplissage par la migration 056, uniquement pour les lignes dont les colonnes sont NULL :
- seuils copiés depuis la ligne `configs` du tenant ;
- à défaut de ligne, `floor(n*n*15/25)`, où n est la taille de l'échelle de l'évaluation (5 si aucune), `enforced = true` et seuil de traitement NULL ;
- `risk_framework_version_id` reste NULL : aucune version n'était active quand ces évaluations ont été créées.

## 9. Cartographie et `GET /cartography/scale` (DECISION-041)

L'« échelle active du tenant » devient l'échelle de la version ACTIVE du Dispositif affiché.

- `GET /cartography/scale?frameworkId=` : sans paramètre, c'est le Dispositif `is_default`. Si le Dispositif n'existe pas, s'il n'a pas de version ACTIVE, ou si le tenant n'a pas de Dispositif, la réponse est `data: null` et la page n'affiche **aucune grille** (§4 de DECISION-041). La forme actuelle est conservée : `scaleId`, `name`, `version`, `size`, `probabilityLevels`, `impactLevels`, `maxScore`, `bands`, `bandsSource`. Quatre champs s'ajoutent : `frameworkId`, `frameworkName`, `frameworkVersionId`, `frameworkVersionNumber`. Le calcul des bandes de `getActiveScale` devient la fonction privée `scaleView(scale)`, réutilisée telle quelle.
- `GET /cartography` et `GET /cartography/compare` acceptent `frameworkId`, avec le même défaut. Une évaluation appartient à un Dispositif par sa `risk_framework_version_id`. Les lignes antérieures (NULL) sont rattachées au Dispositif par défaut. Chaque point garde les bandes de **son** échelle (logique `resolveCriticalityBands` inchangée).
- Le frontend affiche « un Dispositif à la fois » (q25, q39). Le sélecteur est un lot F, hors B-6. Le visuel de la page n'est pas modifié.

Risk 360 (`RiskDeviceViewService`) : le seuil d'appétence applicable vient de la version du Dispositif applicable au risque (§7 et `findAppetite`), et non plus de `RiskAppetiteService.getApplicable`.

## 10. Permissions

À ajouter à l'union `Permission` et à `ALL_PERMISSIONS`. Ce sont les six permissions du contrat §10 :

| Permission | Usage |
|---|---|
| `riskframework.read` | Lectures, liste des demandes |
| `riskframework.create` | Créer un Dispositif et sa version 1 en brouillon |
| `riskframework.update` | Créer ou modifier un brouillon, demander une activation ou un changement de défaut, retirer **sa propre** demande |
| `riskframework.activate` | Décider (approuver ou refuser) une demande. Permission dédiée, distincte de `update` : l'activation archive la version précédente, donc elle n'est jamais accessible par `update` |
| `riskframework.archive` | Transitions terminales : abandon d'un brouillon, archivage d'un Dispositif (B-6c) |
| `riskframework.process.assign` | Demander le rattachement d'un Processus (B-6c) |

- `riskframework.activate.committee`, prévue par le plan de lots, est **abandonnée** : le choix configurable de l'approbateur (q34) et le vote de B-12 la remplacent. Pas de permission morte.
- Garde complémentaire : `create`, `update`, `process.assign` et `activate` exigent en plus d'être **membre actif du groupe Risk Manager** (DECISION-016 : « possibilités de configuration détenues par la fonction risque » ; q51).
- `FIXED_GROUP_PERMISSIONS` :
  - RISK_MANAGER reçoit les six ;
  - RISK_COMMITTEE et AUDIT reçoivent `riskframework.read`, ce qui est conforme à `isAuditGroupPermission`.
- La migration 055 ajoute ces permissions aux groupes fixes existants (voir §12). Le test qui compare la constante à la migration 051 doit être **adapté** pour comparer la constante à la migration 051 complétée par les ajouts de 055. C'est une modification légitime : la source de vérité a changé. Elle doit être signalée à A08.

## 11. Routes HTTP (`api/v1/riskFrameworks.routes.ts`, montées sur `/risk-frameworks`)

Validation zod :
- `name` : au plus 120 caractères ; `description` : au plus 1000 ; `reason` : au plus 500, non vide ; `comment` : au plus 1000 ;
- identifiants en `z.guid()` ;
- `appetiteThresholds` : `boundedArray(el, 200)`, jamais de `z.array` nu ;
- seuils : entiers compris entre 1 et 36 (`ABSOLUTE_MAX_SCORE`), le service vérifiant ensuite le plafond n².

| Méthode et chemin | Permission | Corps | Sous-lot |
|---|---|---|---|
| `GET /risk-frameworks` | read | — (Dispositifs, version active résumée, `isDefault`) | a |
| `POST /risk-frameworks` | create | `{name, description?, ratingScaleId, params?}` → Dispositif + v1 en brouillon | a |
| `GET /risk-frameworks/:id` | read | — (avec la liste des versions) | a |
| `PATCH /risk-frameworks/:id` | update | `{name?, description?, reason}` (identité seulement) | a |
| `GET /risk-frameworks/:id/versions/:vid` | read | — | a |
| `POST /risk-frameworks/:id/versions` | update | `{fromVersionId?}` | a |
| `PATCH /risk-frameworks/:id/versions/:vid` | update | paramètres partiels du §2.2, sans `status` | a |
| `POST /risk-frameworks/:id/versions/:vid/discard` | archive | `{reason}` | a |
| `POST /risk-frameworks/:id/versions/:vid/activation-requests` | update | `{reason}` → 201, demande | a |
| `GET /risk-frameworks/change-requests?status=` | read | — | a |
| `POST /risk-frameworks/change-requests/:rid/approve` | activate | `{comment?}` (obligatoire en repli) ; 409 si un vote est requis | a |
| `POST /risk-frameworks/change-requests/:rid/reject` | activate | `{comment}` | a |
| `POST /risk-frameworks/change-requests/:rid/withdraw` | update | `{reason?}` ; demandeur seulement | a |
| `GET /risk-frameworks/applicable?riskId=` ou `?processId=` | read | version applicable (§7), en lecture seule pour F-1 | b |
| `POST /risk-frameworks/:id/process-assignments` | process.assign | `{processId, reason}` → demande `ASSIGN_PROCESS` | c |
| `POST /risk-frameworks/:id/default-requests` | update | `{reason}` → demande `SET_DEFAULT` | c |
| `POST /risk-frameworks/:id/archive` | archive | `{reason}` ; refusé si un Processus y est rattaché ou si c'est le Dispositif par défaut | c |

Pour `ASSIGN_PROCESS`, le Dispositif cible doit avoir une version ACTIVE. Une fois approuvée, la demande écrit `processes.risk_framework_id`, avec un audit `Process` `UPDATE` et le motif.

Archiver un Dispositif fait passer sa version ACTIVE en ARCHIVED (miroir des échelles mis à jour) et renseigne `archived_*` sur l'identité. Les évaluations qui le référencent restent lisibles.

## 12. Migration 055 (B-6a) : idempotente, rejouable

Règles d'écriture (mémoire dev-db) :
- `CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` ;
- contraintes ajoutées dans un `DO $$` qui teste `pg_constraint` ;
- `CREATE OR REPLACE FUNCTION`, puis `DROP TRIGGER IF EXISTS` suivi de `CREATE TRIGGER` ;
- `INSERT ... WHERE NOT EXISTS` ;
- **ne deviner aucun nom de colonne ou de contrainte** : vérifier dans 012, 017, 018, 024, 030 et 045 avant d'écrire ;
- en tête de fichier : « Ne jamais appliquer à la main : passe par `npm run migrate` ».

Contenu, dans l'ordre :
1. Tables `risk_frameworks`, `risk_framework_versions` et `risk_framework_change_requests`, avec leurs CHECK et index (§2, §4, §5).
2. `processes.risk_framework_id`, avec son CHECK de niveau et un index `(tenant_id, risk_framework_id)`.
3. Fonctions et triggers du §6.
4. **GRANT explicites**, en plus des privilèges par défaut de la migration 043 :
   - `GRANT SELECT, INSERT, UPDATE ON risk_frameworks, risk_framework_versions, risk_framework_change_requests TO grc_app_runtime` ;
   - `REVOKE DELETE, TRUNCATE ON` ces trois tables `FROM grc_app_runtime`. Elles n'ont jamais de DELETE ; c'est le même principe que pour `audit_log`.
5. Permissions des groupes fixes, posées sur les rôles `system_group` existants sans doublon : `permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[...]))`.
6. **Brouillon de reprise.** Pour chaque tenant **sans** ligne `risk_frameworks` mais **avec** une échelle `ACTIVE` non supprimée :
   - créer le Dispositif « Dispositif initial », avec `is_default = false` (le marquage par défaut se fait à la première activation) et `created_by = NULL` ;
   - créer sa version 1 en **DRAFT**, avec `rating_scale_id` = cette échelle, et les valeurs `evaluation_mode`, `committee_*` et `committee_evaluation_enforced` de `configs`. À défaut de ligne `configs` : `CLASSIQUE`, `floor(n*n*15/25)`, `true`, NULL ;
   - remplir `appetite_thresholds` par l'agrégat jsonb des `risk_appetites` actives et non supprimées.

   Rien n'est **activé** par la migration : la première activation reste un acte d'un membre RM (q51). Un seuil hérité supérieur à n² (par exemple 15 sur une échelle 3×3) est recopié tel quel ; la demande d'activation le refusera avec un message clair, et le RM le corrigera dans le brouillon.

Fichier `055_risk_frameworks.down.sql` : enveloppé dans `BEGIN`/`COMMIT`. Il supprime triggers, fonctions, colonne et tables, et retire les permissions ajoutées.

Migration **056** (B-6b) : colonnes du §8, remplissage, `.down.sql`.

## 13. Audit

L'audit est écrit dans chaque méthode de service. `userId` est toujours `actor.userId`.

| Entité (`entityType`) | Action | old → new | reason |
|---|---|---|---|
| `RiskFramework` | `CREATE` / `UPDATE` / `STATUS_CHANGE` (archivage) | identité | motif |
| `RiskFrameworkVersion` | `CREATE` (brouillon, copie) | null → version | — |
| `RiskFrameworkVersion` | `UPDATE` (modification d'un brouillon) | avant → après | — |
| `RiskFrameworkVersion` | `STATUS_CHANGE` (activation) | **version active précédente complète** (ou null) → **nouvelle version complète**, avec `decisionRegime` et `requestId` de la demande | commentaire de décision |
| `RiskFrameworkVersion` | `STATUS_CHANGE` (abandon ou archivage) | avant → après | motif |
| `RiskFrameworkChangeRequest` | `SUBMIT` / `APPROVE` / `REJECT` / `STATUS_CHANGE` (retrait) | avant → après | motif ou commentaire |
| `Process` | `UPDATE` (B-6c, rattachement) | `riskFrameworkId` avant → après | motif de la demande |

Aucune nouvelle valeur d'`action` : la contrainte `audit_log_action_check` reste inchangée.

**Écart connu** (invariant 7, q12 : l'audit doit être écrit dans la même transaction que l'action). Le dépôt n'a aucune transaction qui couvre plusieurs repositories (mémoire dev-backend, B-8 ter et quinquies). B-6 suit le schéma existant : l'action se fait dans une transaction unique dans son repository, puis l'audit est écrit. Un échec de l'audit est journalisé et renvoyé en erreur, sans `reopen` une fois l'activation appliquée (même choix que F-B8t-04). Cet écart est déjà suivi comme lot transverse (Compliance B-8) ; voir §14, Q6.

## 14. Questions au PO (non tranchées dans ce lot)

- **Q1. Fenêtre de bascule.** Entre le déploiement de B-6b et la première activation par un RM, aucune évaluation ne peut être créée ni cotée, et la Cartographie n'affiche pas de grille. *Recommandation* : accepter. La production n'a pas d'utilisateurs (DECISION-038 §9) ; sur staging, le RM active le « Dispositif initial » juste après le déploiement.
- **Q2. Audit ou Comité choisi comme approbateur avant B-12.** Une demande qui exige un vote reste PENDING (409 sur `approve`) jusqu'à la livraison de B-12. *Recommandation* : accepter, avec un message clair dans l'interface. Les demandes sont retirables, et l'approbation par la fonction risque (défaut) reste pleinement fonctionnelle.
- **Q3. « Audit et/ou Comité » (q34), cas « et ».** Faut-il deux votes successifs, et dans quel ordre ? *Recommandation* : les deux sont requis, le Comité d'abord puis Audit. Chaque groupe suit sa propre règle et son propre repli. À mettre en œuvre dans B-12.
- **Q4. Rattachement d'un Processus à un autre Dispositif.** Quelle règle d'approbation s'applique : celle du Dispositif quitté ou celle du Dispositif cible ? *Recommandation* : celle du Dispositif **cible**, puisque c'est sa méthodologie qui s'appliquera, avec effet au cycle suivant.
- **Q5. Amorçage (q77), via q81 à q83, déjà posées par l'orchestrateur.** Ce point est isolé dans **B-6d** et n'est pas implémenté avant la réponse. Conception prévue pour suivre la réponse sans retoucher B-6a :
  - une fonction pure unique `isBootstrapAllowed(ctx)` dans `domain/frameworkApproval.ts` ;
  - `ctx` contient : le type de demande, le fait qu'il s'agisse du premier Dispositif du tenant, le nombre de RM actifs, le nombre de membres d'Audit et du Comité, l'âge du tenant, et l'activation éventuelle de l'auto-proposition ;
  - si elle renvoie `true`, le demandeur décide lui-même avec un commentaire obligatoire ; `decision_regime = 'BOOTSTRAP'` et `ratification_status = 'PENDING'` ;
  - le CHECK du §5.1 l'autorise déjà.

  Les recommandations de l'orchestrateur sont reprises sans être tranchées :
  - q81 : périmètre limité à l'activation du premier Dispositif, plus les désignations de B-5 ; les droits d'Audit (q67) et l'auto-proposition (q65) sont toujours exclus ;
  - q82 : fin automatique dès qu'il existe un 2e RM, ou un membre d'Audit ou du Comité, et au plus tard 90 jours après la création du tenant ; ensuite, attente avec alerte (q75) ;
  - q83 : seule exception écrite à « jamais d'auto-approbation », avec ratification a posteriori non bloquante.

  Point technique pour q82 : la règle des 90 jours exige `tenants.created_at`, à vérifier dans le schéma au moment de B-6d.
- **Q6. Audit dans la même transaction (q12).** B-6 est livré avec l'audit écrit juste après l'action, comme le reste du code, en attendant le lot transverse. *Recommandation* : accepter pour le MVP, sans en faire une exception propre à B-6.
- **Q7. Paramètres reportés.** Le seuil « faible », les cumuls, la délégation, la politique Hybride, la Maîtrise et la règle du Comité sont ajoutés par les lots qui les consomment, et non par B-6 (§2.2). *Recommandation* : accepter (consigne ponytail). L'assistant de création (lot F) affichera ces paramètres au fur et à mesure.
- **Q8. Auto-proposition.** Ce paramètre ne pourra pas être activé avant B-12, puisque q65 exige un vrai vote du Comité. *Recommandation* : accepter. Le défaut reste désactivé, ce qui correspond au comportement de B-0.

Les points suivants **ne sont pas des questions**, car ils sont déjà décidés et appliqués ici : l'échelle carrée obligatoire (DECISION-041), les seuils Comité par défaut 5, 9, 15 et 21 (q71), la première activation par un membre RM seulement (q51), et les champs inertes de `configs` qui restent en place (§3).

## 15. Tests de niveau 1 attendus (A06)

Les cas limites inter-modules relèvent d'A08.

**B-6a** (`test/RiskFrameworkService.test.ts`, faux repositories) :
- création : Dispositif + v1 en DRAFT ; `created_by` forcé ; refus sans `riskframework.create` ; refus pour un non-membre RM détenant la permission (q51) ; nom vide refusé ;
- brouillon : modification partielle ; `status` absent de l'entrée (le typage le garantit, et un champ inconnu est ignoré ou refusé par zod) ; modification refusée sur une version PENDING, ACTIVE ou ARCHIVED ;
- demande d'activation refusée dans chacun de ces cas : échelle non carrée ; descriptif manquant ; seuil Comité supérieur à n² ; appétence supérieure à n² ; appétences en doublon ; motif vide ;
- approbation par un 2e RM : la version passe ACTIVE et la précédente ARCHIVED, en un seul appel au dépôt ; audit `STATUS_CHANGE` avec l'ancienne et la nouvelle version ; premier Dispositif marqué par défaut ;
- refus du décideur dans chacun de ces cas : décideur = demandeur ; décideur auteur d'une modification (trouvé dans le journal d'audit) ; administrateur non RM ; absence de `riskframework.activate` ;
- refus (commentaire obligatoire) et retrait (demandeur seulement) : la version revient en DRAFT ;
- circuit : `COMMITTEE` avec au moins 2 membres éligibles donne 409 ; Comité vide et Audit vide donnent un repli RM `FALLBACK` avec commentaire obligatoire, `ratification_status = PENDING` et Audit notifié ;
- auto-proposition `false → true` refusée dès la création de la demande hors vote du Comité ;
- un seul RM qui est aussi le demandeur : la demande reste PENDING et `RISK_MANAGER` reçoit la notification `NO_DECIDER` ;
- fonctions pures : `resolveDecider` (table du §5.4) et `assertReadyToActivate` déplacée (les tests `RatingScaleService` existants restent verts).

**B-6b** :
- `create` d'une évaluation : version, échelle et seuils copiés ; refus sans Dispositif actif ; mode résolu à partir de `defaultEvaluationMode` ;
- `validate` lit le seuil copié : changer ensuite la version active ne modifie pas le circuit de l'évaluation (F-8) ;
- `findAppetite` ;
- `getActiveScale` renvoie l'échelle du Dispositif par défaut, ou `null` sans Dispositif actif ;
- écritures fermées (`updateCommitteeThresholds`, `setThreshold`, `activateVersion`) quand le dépôt du Dispositif est câblé ; comportement inchangé quand il ne l'est pas.

**B-6c** :
- rattachement approuvé : `risk_framework_id` est écrit au niveau PROCESS seulement, et un sous-processus en hérite par la résolution ;
- cible sans version ACTIVE refusée ;
- archivage refusé pour le Dispositif par défaut ou pour un Dispositif auquel un Processus est rattaché.

**Migrations** (A07) :
- 055 et 056 appliquées deux fois de suite sans erreur ;
- trigger : `UPDATE` d'une version ACTIVE refusé ; `DELETE` refusé ;
- modification du contenu d'une échelle référencée par une version PENDING refusée ;
- `.down.sql` testés sur un Postgres jetable (procédure de `memory/dev-db.md`).

**Vérification avant rapport** : `npm run typecheck && npm test` dans `backend/`.

## 16. Fichiers touchés (repère pour A06)

- **Nouveaux** :
  - `domain/entities/RiskFramework.ts`
  - `domain/repositories/RiskFrameworkRepository.ts`
  - `domain/frameworkApproval.ts`
  - `domain/ratingScaleRules.ts`
  - `infrastructure/database/postgres/PostgresRiskFrameworkRepository.ts`
  - `services/RiskFrameworkService.ts`
  - `services/riskFrameworkResolution.ts`
  - `api/v1/riskFrameworks.routes.ts`
  - migrations 055 et 056, avec leurs `.down.sql`
- **Modifiés** :
  - `domain/permissions.ts` et `domain/fixedGroupPermissions.ts` (fichiers partagés : travailler en worktree) ;
  - `server.ts` (câblage, fichier partagé) ;
  - `RatingScaleService` (import des règles déplacées, fermeture de `activateVersion` si câblé) ;
  - `ConfigService` et `RiskAppetiteService` (fermetures, B-6b) ;
  - `RiskEvaluationService` et `TreatmentDecisionService` (instantané, B-6b) ;
  - `CartographyService` et `cartography.routes.ts` (B-6b) ;
  - `RiskDeviceViewService` (B-6b).
- Toute nouvelle dépendance de constructeur est un **paramètre optionnel avec garde**. Une dépendance qui porte une règle de sécurité échoue de façon fermée (fail-closed), comme le prévoit le principe 9 de `memory/dev-backend.md`.

## 17. Passages après merge

- **Security (A10)** : circuit d'activation, exclusion des auteurs, triggers d'immuabilité, fermeture des écritures concurrentes. CLAUDE.md impose de vérifier tout champ `...By` d'un `Create...Input` : `requestedBy`, `decidedBy`, `createdBy` et `lastEditedBy` doivent tous être forcés côté serveur.
- **QA (A08)** : cas limites du circuit, concurrence des approbations (`FOR UPDATE`), lignes antérieures sans version.
- **Compliance (A14)** : le lot touche à la gouvernance des paramètres, ligne de la GRC Trigger Matrix.
