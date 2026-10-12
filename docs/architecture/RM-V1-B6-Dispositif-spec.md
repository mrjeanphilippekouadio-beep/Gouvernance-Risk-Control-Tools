# RM V1 — Lot B-6 : Dispositif `RiskFramework` versionné — spécification d'implémentation

**Statut** : spécification de l'Architecte (A05), 2026-10-11. Aucun code ni migration produits.
**Mise à jour 2026-10-12 (A05)** : réponses du PO de DECISION-044 (q81 à q83, q86 à q93) intégrées. Les §0, §1, §2.2, §5, §8, §9, §11 à §17 sont modifiés, le §18 (plan de dispatch) est nouveau. B-6a est livré (migrations 055 à 058, voir `ACTION_ITEMS.md`).
**Mise à jour 2026-10-12 bis (A05)** : DECISION-045 (q98, q99) et DECISION-046 (q100 à q103), plus la revue A13 (`docs/risk/A13-review-DECISION-044.md`, I-D2 et I-D4 confirmés). Modifiés : §0, §1, §5.4 (nouveau §5.4.1, q100), §5.5, §5.6 (réécrit), §12.3, §13, §14.2, §15, §16, §17, §18. B-6d est dispatchable après la fusion de B-6b ; les points encore ouverts (§14.2 : I-D7, I-D8, I-D9) ne le bloquent pas.
**Roadmap** : R1.4 (`docs/ROADMAP-V1.md`). **Destinataires** : A06 (code), A07 (migrations), A13 (interprétations du §14.2), A08/A10/A14 (passages après merge).
**Sources** : `RM-V1-Lots-contrat-amende.md` (B-6, F-8, §4 invariants) ; contrat `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` §6, §8, §10 ; `RM-V1-Contrat-etape2-PROJET.md` §7 et §13.1 bis (N8 à N10) ; Decision Log jusqu'à **DECISION-044** ; avis Compliance `docs/compliance/B6a-compliance-review.md` ; arbitrage `RM-V1-B6a-arbitrage-A13.md`.

À lire avant de coder : `CLAUDE.md`, sections « Backend architecture », « Adding a new domain module » et « Security-sensitive conventions » ; puis `memory/dev-backend.md` et `memory/dev-db.md`.

Sauf mention contraire, chaque règle ci-dessous est **décidée**. Les points d'interprétation encore ouverts sont regroupés au §14.2 et ne sont **pas** implémentés au-delà de ce qui y est indiqué.

---

## 0. Résumé

1. Le Dispositif se compose d'une identité stable (`risk_frameworks`) et de versions immuables (`risk_framework_versions`). Une version porte ses paramètres en colonnes typées, plus l'échelle, référencée par FK vers une `rating_scales` existante.
2. Une version suit ce cycle : `DRAFT → PENDING_APPROVAL → ACTIVE → ARCHIVED`. Un refus ou un retrait de la demande la ramène en `DRAFT`, et un brouillon abandonné passe en `ARCHIVED`.
3. Chaque changement passe par une demande inscrite dans `risk_framework_change_requests`, en append-only (une seule transition, de PENDING vers une décision). La personne qui décide est toujours un tiers, sauf l'amorçage de B-6d (§5.6). B-6 met en œuvre l'approbation par la fonction risque et le repli. **Jusqu'à B-12, seul l'approbateur `RISK_MANAGER` peut être choisi** (q87) : Audit et Comité ne peuvent pas être retenus comme approbateurs avant que leur vote existe.
4. À partir de B-6b, le Dispositif devient la **source unique** des paramètres. Les écritures concurrentes dans `configs`, `risk_appetites` et `RatingScaleService.activateVersion` sont fermées. **Tous** les paramètres du contrat §10 sont portés par la version dès B-6b (q91), y compris ceux que des lots ultérieurs consomment.
5. Une évaluation fige à sa création la version du Dispositif, l'échelle et les seuils Comité (F-8, invariant 9).
6. Chaque action sur le Dispositif écrit son audit dans la même transaction que l'action (q90).
7. L'amorçage (q77) est isolé dans B-6d, désormais spécifié (q81 à q83, q93, q98, q99, q101 à q103). Sa fin est mémorisée par tenant et ne se rouvre jamais (q102).
8. Une version ACTIVE héritée dont l'approbateur est Audit ou le Comité (créée avant q87) ne gèle pas le Dispositif : jusqu'à B-12, la demande se replie vers un Risk Manager, avec ratification ultérieure (q100, §5.4.1, B-6d).

## 1. Découpage en sous-lots

Le lot est de taille L. Il est découpé en quatre sous-lots. L'ordre de merge est **B-6a → B-6b → B-6d → B-6c** (voir §18).

| Sous-lot | Contenu | Taille | Migration | Dépend de |
|---|---|---|---|---|
| **B-6a** Socle | Tables, cycle de vie, demandes et circuit d'approbation (fonction risque et repli), immuabilité, permissions, routes, audit, brouillon de reprise par tenant. Correctifs q87 et q90 en cours (A06) | M | **055** ; durcissements **056** (activation liée à une demande, BOOTSTRAP refusé), **057** (gardes INSERT), **058** (`search_path`) — livrées | — |
| **B-6b** Branchement | Résolution du Dispositif applicable, instantané F-8 sur l'évaluation, Cartographie, Risk 360, fermeture des écritures concurrentes, **paramètres q91** | M+ | **une** migration, numéro suivant le dernier présent (indicatif : 059) | B-6a, y compris q87/q90 |
| **B-6d** Amorçage + repli q100 | Exception q77 limitée à la liste fermée q81, valeurs par défaut du contrat (q98), fin quand un circuit fonctionne (q101), fin mémorisée et définitive (q102), sans ratification (q83), notification obligatoire (q99) ; réouverture contrôlée de BOOTSTRAP en base ; repli d'une version héritée Audit/Comité (q100) | S+ | **une** migration (numéro suivant celui de B-6b) | B-6b fusionné |
| **B-6c** Multi-Dispositif | Rattachement Processus → Dispositif (règle du Dispositif d'arrivée, q89), changement du Dispositif par défaut, archivage d'un Dispositif, retrait du contrôle de plafond inter-Dispositifs | S | aucune (schéma dans 055) | B-6b |

B-6a et B-6b suffisent à faire fonctionner un tenant qui a un seul Dispositif **et au moins deux Risk Managers**. Avec un seul Risk Manager (cas de Djamo au démarrage, q93), B-6d est nécessaire avant la mise en production de B-6b (§8.0).

Avant d'écrire une migration, vérifier le dernier numéro dans `database/postgresql/migrations/`. Le 2026-10-12 (commit `37766ab`), c'était 058. D'autres worktrees en cours (RBAC q79/q80/q94, notifications q84/q85/q95, B-6a q87/q90) peuvent en prendre un : ne jamais deviner.

## 2. Ce que porte le Dispositif

### 2.1 Identité : `risk_frameworks`

`id`, `tenant_id`, `name` (unique par tenant parmi les non archivés, comparaison insensible à la casse), `description`, `is_default` (au plus un `true` par tenant parmi les non archivés), `created_by` (nullable : NULL signifie « créé par la migration »), `created_at`, `updated_at`, `archived_at`, `archived_by`, `archive_reason`.

L'identité ne porte **aucun paramètre méthodologique**.

### 2.2 Version : `risk_framework_versions`

Une colonne typée par paramètre. Pas de jsonb générique.

**Paramètres posés par 055 (B-6a)** :

| Colonne | Type et contrainte | Défaut | Source |
|---|---|---|---|
| `rating_scale_id` | uuid NOT NULL, FK `rating_scales` | — | §6 : échelle, axes, descriptifs, bandes, maîtrise |
| `default_evaluation_mode` | text, CHECK `CLASSIQUE`/`PARTICIPATIF` | `CLASSIQUE` | DECISION-018 P1 |
| `committee_evaluation_min_score` | int NOT NULL, CHECK 1..36 | n² × 15 / 25, arrondi à l'inférieur (5, 9, 15, 21) | §8, q71 |
| `committee_evaluation_enforced` | boolean NOT NULL | `true` | §8, Lot A |
| `committee_treatment_min_score` | int NULL, CHECK 1..36 | NULL (fail-closed) | §8 |
| `appetite_thresholds` | jsonb NOT NULL, CHECK `jsonb_typeof = 'array'` | `[]` | DECISION-017 §5 |
| `change_approver` | text, CHECK `RISK_MANAGER`/`AUDIT`/`COMMITTEE`/`AUDIT_AND_COMMITTEE` | `RISK_MANAGER` ; seule valeur acceptée par le service avant B-12 (q87) | q34, DECISION-016 |
| `self_proposal_allowed` | boolean NOT NULL | `false` ; `true` impossible avant B-12 (q92) | invariant 5, q65 |

**Paramètres ajoutés par la migration de B-6b (q91 : tous dès maintenant, pas lot par lot)**. Défauts repris du tableau « Paramètres » du contrat §10 ; aucun défaut n'est inventé là où le contrat n'en donne pas.

| Colonne | Type et contrainte | Défaut | Contrat §10 | Lecteur |
|---|---|---|---|---|
| `low_criticality_threshold` | int NULL, CHECK 1..36 | NULL. Le contrat dit « inscrit à la création », sans valeur : **obligatoire à la demande d'activation**, ≤ n² | Seuil de criticité « faible » | B-5 |
| `risk_owner_executor_cumul_allowed` | boolean NOT NULL | `true` = autorisé jusqu'au seuil « faible », au-delà exception approuvée et revue à chaque cycle | Cumul Risk Owner + Exécuteur | B-5 |
| `delegate_executor_cumul_allowed` | boolean NOT NULL | `true`. « Le Délégué ne valide pas sa propre exécution » est un invariant, jamais une colonne | Cumul Délégué + Exécuteur | B-5 |
| `delegation_max_days` | int NULL, CHECK > 0 | NULL = durée non fixée par le client | Durée d'une délégation datée (« fixée par le client ») | B-5 |
| `hybrid_policy_enabled` | boolean NOT NULL | `false` | Politique Hybride | B-2 |
| `mastery_authoritative_source` | text NOT NULL, CHECK `RISK_TEAM`/`FIRST_LINE` | `RISK_TEAM` | Saisie de Maîtrise qui fait foi | B-1 |
| `committee_vote_rule` | text NOT NULL, CHECK `DEFAULT`/`A`/`B`/`C`/`CUSTOM` | `DEFAULT` (règle q61) | Règle du Comité asynchrone | B-12 |
| `committee_vote_custom` | jsonb NULL, CHECK `jsonb_typeof = 'object'` et (`committee_vote_rule = 'CUSTOM'`) = (`committee_vote_custom IS NOT NULL`) | NULL | Règle personnalisée | B-12 |

Règles de service pour ces paramètres (B-6b) :
- ils sont saisissables à la création et dans un brouillon, recopiés à la création d'un brouillon, et validés à la demande d'activation, comme les autres ;
- `low_criticality_threshold` est vérifié contre `maxScoreForScale(scale)` avec les autres seuils (§2.3) ;
- `committee_vote_rule = 'CUSTOM'` est refusé (`ValidationError`) jusqu'à B-12 : la forme d'une règle personnalisée (groupes, quorum, majorité, délai, relances) sera définie par B-12. Même principe que q87 : on n'accepte pas un réglage qu'aucun code ne sait appliquer ;
- une valeur non par défaut dont le lecteur n'est pas encore livré (par exemple `hybrid_policy_enabled = true` avant B-2) est acceptée : elle a été approuvée par un tiers, et elle prendra effet quand son lot la lira. L'écran de création (lot F) le signale ;
- aucune copie sur l'évaluation : la version étant immuable, la FK `risk_framework_version_id` de l'évaluation suffit à figer ces paramètres (invariant 9). Seuls les trois seuils Comité sont copiés (§8), pour les lignes antérieures.

Remplissage : `ADD COLUMN ... DEFAULT` remplit toutes les versions existantes, y compris ACTIVE et ARCHIVED, sans déclencher de trigger de ligne. Les versions existantes reçoivent ainsi le défaut du contrat, qui était le comportement implicite (condition d'A14 sur q91). `low_criticality_threshold` reste NULL sur une version déjà ACTIVE : B-5 devra traiter NULL de façon fermée (tout cumul RO + Exécuteur passe par l'exception approuvée). La migration le documente.

**Garde d'immuabilité** : `risk_framework_versions_guard()` compare une liste explicite de colonnes (`same_content`, 056). La migration de B-6b la redéfinit (`CREATE OR REPLACE`) en y ajoutant les huit colonnes, sinon elles seraient modifiables sur une version ACTIVE. La redéfinition reprend `SET search_path = pg_catalog, public, pg_temp` (règle CLAUDE.md, F-B6a-11) ; le test statique `QA-B6a11.test.ts` le vérifie.

**Appétence en jsonb typé**, sur le modèle de `RatingScale.impactAxes`. C'est une liste de valeurs configurées ensemble et figées avec la version. Elle n'a pas d'identité propre et aucune autre entité ne la référence. Une table enfant obligerait à faire des `DELETE` sur les brouillons, ce qu'interdit CLAUDE.md. La forme d'une entrée est `{ subCategory, subCategoryId|null, entity|null, threshold, description|null }`. Le service la valide : au plus 200 entrées ; `(subCategory, entity)` unique ; seuil entier compris entre 1 et n² ; `subCategoryId` du tenant (fail-closed si le dépôt n'est pas câblé, voir `RiskAppetiteService.assertSubCategoryExists`).

**Invariants : jamais en colonne** (invariant 8). Rien ne permet de paramétrer « validateur hors des auteurs », « jamais d'auto-approbation », « RM + Audit interdit », « le Délégué ne valide pas sa propre exécution », etc.

**Restent hors de q91** (non cités dans la réponse du PO, voir §14.2 point R1) : statuts de contribution personnalisés → B-3 ; mode d'appétence et règle de surcharge → arbitrage F-9. Ils seront ajoutés par leur lot selon le même procédé (`ADD COLUMN ... NOT NULL DEFAULT <défaut du contrat>` et mise à jour de la garde).

### 2.3 Échelle : réutilisation de `RatingScale`, sans duplication

- La version référence une `rating_scales` **existante**. Changer l'échelle, les axes, les descriptifs ou les bandes veut dire créer une nouvelle échelle par les routes `ratingscale.*` existantes, puis la référencer dans un brouillon de Dispositif.
- Une même échelle peut être référencée par plusieurs Dispositifs, par exemple les Dispositifs par défaut de B-13.
- Les règles d'activation d'une échelle quittent `RatingScaleService` pour une fonction pure, `domain/ratingScaleRules.ts` : `assertDescriptors` et `assertReadyToActivate` y sont **déplacées** et non copiées. `RatingScaleService` et `RiskFrameworkService` les importent toutes deux.
- Règles supplémentaires, vérifiées au moment de la demande d'activation :
  - `probabilityLevels === impactLevels`, échelle carrée (DECISION-041). Les échelles historiques à tailles inégales sont refusées.
  - `impactAxes` contient au moins un axe.
  - L'échelle n'est pas supprimée.
  - Chaque seuil de la version est ≤ `maxScoreForScale(scale)`, fonction de `domain/scoring.ts`. Cela vaut pour les seuils Comité, chaque appétence, le seuil « faible » (B-6b) et chaque borne de `criticalityThresholds`.

**Statut de l'échelle.** `rating_scales.status` devient un **miroir dérivé**, écrit uniquement par `PostgresRiskFrameworkRepository` dans les transactions d'activation et d'archivage :
- une échelle est ACTIVE si au moins une version ACTIVE la référence ;
- elle passe ARCHIVED quand plus aucune version ACTIVE ne la référence.

Aucune décision métier ne lit ce miroir. Il existe pour que les gardes R-01 déjà en place (`assertMutable`, filtre `status = 'DRAFT'` de `setJsonColumn`) restent vraies, et pour que l'écran des échelles reste exact. La seule source de vérité pour savoir « quelle échelle s'applique » est le Dispositif (§7).

**Contrôles de plafond dans `mirrorScale` (état B-6a, et leur sort).** Tant que du code hérité lit « l'échelle ACTIVE la plus récente » (`resolveMaxScore`, `configs`, `risk_appetites`), `mirrorScale` vérifie aussi les seuils de `configs` et de `risk_appetites`, et compare tous les seuils au **plus petit** plafond des échelles qui restent ACTIVE (F-B6a-10). Ce dernier contrôle compare les seuils d'une version aux échelles d'**autres** Dispositifs (réserve QA de F-B6a-12). Il est retiré en deux temps :
- **B-6b** : les écritures et lectures héritées sont fermées (§3, §8) ; `mirrorScale` ne lit plus `configs` ni `risk_appetites`, ce qui ferme F-B6a-12 (lecture de `configs` sans verrou). A06 dresse l'inventaire de tous les lecteurs restants d'une échelle par son statut ACTIVE et les migre vers le Dispositif, ou les documente comme chemin historique en lecture seule n'alimentant aucune garde ;
- **B-6c** : une fois l'inventaire vide (précondition vérifiée par un test), le contrôle « plus petit plafond inter-Dispositifs » est retiré. Chaque version n'est plus comparée qu'à **sa propre** échelle (§2.3, ci-dessus). C'est ce qui rend possible deux Dispositifs actifs de tailles différentes (par exemple 6×6 avec un seuil Comité 21 et 3×3), que le contrôle actuel refuserait. Voir §14.2 point I-C1 pour la confirmation par A13.

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
- **Approbation** : voir §5. Une seule transaction SQL dans le dépôt, **audit compris** (q90, §13) :
  1. réserver la demande (`FOR UPDATE`, PENDING → APPROVED) ;
  2. passer la version en ACTIVE ;
  3. passer l'éventuelle version ACTIVE précédente du même Dispositif en ARCHIVED (`archived_by` = décideur, `archive_reason` = « remplacée par vN ») ;
  4. mettre à jour le miroir des échelles ;
  5. si le tenant n'a encore aucun Dispositif par défaut, passer ce Dispositif en `is_default = true` ;
  6. écrire les lignes d'audit (§13).
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
| `ratification_status` | NULL, ou `PENDING` pour une décision `FALLBACK` (q62). La ratification elle-même relève de B-12. **Une décision `BOOTSTRAP` n'est pas soumise à ratification** (q83, confirmé par A13, §14.2 point I-D4) : `ratification_status` reste NULL |
| `fallback_cause` | **B-6d.** NULL, ou `LEGACY_APPROVER_PRE_B12` quand une décision `FALLBACK` vient du garde-fou q100 (§5.4.1). CHECK : `fallback_cause IS NULL OR (decision_regime = 'FALLBACK' AND ratification_status = 'PENDING')` |
| `bootstrap_justification` | **B-6d.** jsonb, motif structuré d'une décision `BOOTSTRAP` (§5.6 point 6). CHECK : `(decision_regime IS NOT DISTINCT FROM 'BOOTSTRAP') = (bootstrap_justification IS NOT NULL)` et `jsonb_typeof = 'object'` |

Contraintes :
- `CHECK (decided_by IS NULL OR decided_by <> requested_by OR decision_regime = 'BOOTSTRAP')` (055). Inchangé par B-6d.
- `risk_framework_change_requests_no_bootstrap_check` (056) refuse BOOTSTRAP jusqu'à B-6d ; B-6d le remplace (§12.3).
- Index unique partiel : une seule demande `PENDING` par `(framework_id, kind, coalesce(process_id))`.
- Mutations autorisées : seulement la transition PENDING → terminal, via des méthodes étroites du dépôt (`recordDecision`, `withdraw`). Jamais d'`update` générique.
- Toute demande naît PENDING sans champ de décision (057), y compris celles que l'amorçage décidera.

### 5.2 Quelle règle s'applique

La règle d'approbation vient de la **version ACTIVE en vigueur** :
- pour `ACTIVATE_VERSION` et `SET_DEFAULT` : la version active du Dispositif concerné ;
- pour `ASSIGN_PROCESS` : la version active du **Dispositif d'arrivée** (q89, décidé ; voir §11.1).

Un brouillon ne choisit donc jamais son propre approbateur. Changer `change_approver` est lui-même approuvé selon l'ancienne règle.

Sans version active (premier Dispositif, q51) : `RISK_MANAGER`.

### 5.3 Qui peut décider (`decide()`, permission `riskframework.activate`)

Toutes les conditions suivantes doivent être réunies :
1. le décideur détient `riskframework.activate` ;
2. il est **membre actif du groupe Risk Manager** (q51 : l'administrateur seul n'est jamais décideur ; un administrateur qui est aussi RM l'est en tant que RM, q63). « Membre actif » a la même définition qu'en B-8 v2 : assignation non révoquée et utilisateur non suspendu ;
3. il n'est pas le demandeur ;
4. il n'est l'auteur d'aucune modification de la version : son identifiant n'apparaît ni dans `created_by` ni dans les entrées `CREATE` ou `UPDATE` de `AuditRepository.listForEntity(tenantId, "RiskFrameworkVersion", versionId)`. On réutilise l'existant, sans nouvelle colonne. Avec q90, ces entrées ne peuvent plus manquer (l'audit est dans la transaction de l'action), ce qui ferme la faiblesse relevée par C-B6a-01.

Seule exception aux points 3 et 4 : l'amorçage (§5.6).

### 5.4 Circuit (q34, q54, q69, q72, q76, q87)

La fonction pure `resolveDecider(approver, groups, excluded)` est placée dans `domain/frameworkApproval.ts`. Elle prend la liste des membres actifs de chaque groupe et l'ensemble des personnes exclues (demandeur et auteurs). Un groupe n'est **sollicité** que s'il compte **au moins 2 membres éligibles** (q72) ; sinon on passe au maillon suivant, et la décision est marquée comme prise en repli.

| `change_approver` | Résultat |
|---|---|
| `RISK_MANAGER` (défaut, **seule valeur possible avant B-12**, q87) | Décision par un RM (§5.3), `NORMAL`. Audit est **notifié** si son groupe n'est pas vide (q34) |
| `COMMITTEE` | B-12. Comité éligible (≥ 2) → **vote** ; sinon Audit éligible (≥ 2) → **vote** (q76) ; sinon RM en `FALLBACK` |
| `AUDIT` | B-12. Audit éligible → **vote** ; sinon Comité éligible → **vote** ; sinon RM en `FALLBACK` |
| `AUDIT_AND_COMMITTEE` | B-12. Deux votes, **Comité d'abord, puis Audit** (q88) ; sinon même repli |

- **Choix d'Audit ou du Comité interdit avant B-12 (q87, contrat).** Toute écriture qui ferait porter à une version un `change_approver` autre que `RISK_MANAGER` est refusée par `ValidationError` (« disponible avec le vote du Comité, B-12 ») : à la création, à la modification d'un brouillon et, en dernier rempart, à la demande d'activation. Aucune demande n'est donc créée avec un approbateur que personne ne peut exercer (C-B6a-02). Avant la mise en production, une requête de contrôle vérifie qu'aucune version DRAFT, PENDING ou ACTIVE ne porte un autre approbateur (staging a pu en créer avant le correctif) : requête n° 10 du §5.4.1. B-12 lève la garde. Le cas d'une version **ACTIVE** héritée, qui fixe la règle des demandes suivantes (§5.2), est traité au §5.4.1 (q100) ; depuis B-6d, le chemin 409 « vote requis » de `decide()` n'est plus atteignable avant B-12.
- **Repli (`FALLBACK`)** : la décision est prise par un RM (§5.3), avec un commentaire **obligatoire**. `ratification_status = 'PENDING'`, Audit est notifié s'il n'est pas vide (q56), et la décision est marquée pour la vue « décisions prises en votre absence » (B-12).
- **Auto-proposition (q65, q92).** Une demande qui fait passer `self_proposal_allowed` de `false` (ou d'une absence de version active) à `true` n'est recevable **que si le décideur résolu est un vote du Comité**. Si le résultat est un vote d'Audit, une décision RM, un repli ou un amorçage, la demande est **refusée dès sa création** (`ValidationError`) : « L'activation de l'auto-proposition exige un vote du Comité ». Le PO confirme qu'elle reste désactivée jusqu'à B-12 (q92).
- **Plus personne pour décider** (q75). Si aucun RM ne remplit les conditions du §5.3 (par exemple un seul RM, qui est le demandeur), la demande reste PENDING. Une notification `RISK_FRAMEWORK_NO_DECIDER` est envoyée à tous les membres RM. Jamais de validation tacite, jamais par l'administrateur. Si les conditions de l'amorçage sont réunies (§5.6), la notification l'indique.

### 5.4.1 Version ACTIVE héritée avec approbateur Audit ou Comité (q100, B-6d)

**Problème** (revue A13 §2.1). Une version ACTIVE créée avant le correctif q87 peut porter `change_approver` = `COMMITTEE`, `AUDIT` ou `AUDIT_AND_COMMITTEE`. Elle fixe la règle de toutes les demandes suivantes de son Dispositif (§5.2). Si le groupe concerné compte au moins 2 éligibles, `resolveDecider` renvoie un vote, que personne ne peut exercer avant B-12 : `decide()` répond 409 (y compris pour un refus) et le Dispositif est gelé. La seule autre issue serait de désactiver le trigger d'immuabilité, hors audit : c'est exclu. Depuis q87, aucune nouvelle version de ce type ne peut être créée : la population est finie et fermée.

**Décision (q100, DECISION-046 point 1) : repérage avant production ET garde-fou construit tout de suite.**

**Régime.** C'est le repli **existant** (q62, §5.4 « Repli »), avec une cause tracée. Aucun nouveau régime, jamais `NORMAL` :
- fonction pure `foldVoteBeforeB12(decider)` dans `domain/frameworkApproval.ts` : si `decider.kind === "VOTE"`, elle renvoie `{ decider: { kind: "RISK_MANAGER", regime: "FALLBACK" }, fallbackCause: "LEGACY_APPROVER_PRE_B12", bypassedGroups: decider.groups }` ; sinon `{ decider, fallbackCause: null, bypassedGroups: [] }`. Elle est appliquée **dans `resolveFor`**, juste après `resolveDecider`, pour que tous les appelants (demande, relecture verrouillée F-B6a-02, approbation, refus, contrôle d'auto-proposition) voient le même résultat ;
- conséquence sur q65 : le contrôle « auto-proposition seulement sur vote du Comité » voit désormais toujours un repli et refuse, ce qui est cohérent avec q92 ;
- le garde-fou **disparaît avec B-12**, quand le vote devient exécutable : B-12 retire l'appel à `foldVoteBeforeB12` (les décisions déjà prises gardent leur cause).

**Décision.** Par `approve` ou `reject`, sans nouvelle route :
- décideur : §5.3 points 1 à 4 (RM actif, tiers, non auteur). Si aucun RM n'est éligible, la demande reste PENDING avec `RISK_FRAMEWORK_NO_DECIDER` (q75). L'amorçage ne s'applique jamais ici : une version ACTIVE existe, donc ce n'est pas le premier Dispositif (q81) ;
- permission `riskframework.activate` (inchangée) ;
- commentaire **obligatoire** (repli) ;
- colonnes écrites par `recordDecision` : `decision_regime = 'FALLBACK'`, `decider_group = 'RISK_MANAGER'`, `ratification_status = 'PENDING'` (**ratification ultérieure**, B-12), `fallback_cause = 'LEGACY_APPROVER_PRE_B12'`. Le CHECK du §5.1 interdit une cause sans ratification en attente.

**Différence avec l'amorçage.** Le repli q100 est décidé par un **tiers** RM et **reste à ratifier** (q62). L'amorçage (§5.6) est décidé par le demandeur lui-même et **n'a pas de ratification** (q83). Les deux régimes ne se combinent jamais.

**Audit** (dans la transaction, q90) : `APPROVE` ou `REJECT` sur `RiskFrameworkChangeRequest` ; à l'approbation, `STATUS_CHANGE` sur `RiskFrameworkVersion` avec, dans `new`, `decisionRegime: "FALLBACK"`, `fallbackCause` et `bypassedGroups` (le ou les groupes dont le vote a été contourné).

**Notifications** (après commit, au mieux) : `RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE` aux détenteurs de `audit.read` (comme tout repli, q56), **plus** les membres actifs des groupes contournés (`bypassedGroups`), sans doublon. Le message nomme la cause : « décidée en repli par un Risk Manager : l'approbation par le Comité/Audit n'est pas encore disponible (ratification à venir) ».

**Repérage avant production** (lecture seule, exécuté et journalisé par HUMAN) : A06 ajoute à `docs/security/B8-predeploy-checks.sql` une requête n° 10, sur le modèle des n° 8 et 9 :

```sql
-- 10. q100 (DECISION-046) : versions de Dispositif dont l'approbateur n'est pas RISK_MANAGER (creees avant q87).
-- Lecture seule, a executer par HUMAN. Attendu : 0 ligne.
-- ACTIVE : le garde-fou q100 s'applique (repli RM + ratification), aucune correction en base.
-- PENDING_APPROVAL : approuvable ; une fois ACTIVE, le garde-fou s'appliquera aux demandes suivantes.
-- DRAFT : le RM corrige le brouillon (change_approver = RISK_MANAGER) avant toute demande (q87 la refuserait).
SELECT v.tenant_id, v.framework_id, f.name AS framework_name, v.id AS version_id,
       v.version_number, v.status, v.change_approver
FROM risk_framework_versions v
JOIN risk_frameworks f ON f.id = v.framework_id AND f.tenant_id = v.tenant_id
WHERE v.status IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE')
  AND v.change_approver <> 'RISK_MANAGER'
ORDER BY v.tenant_id, f.name, v.version_number;
```

Elle remplace la « requête de contrôle » mentionnée plus haut au §5.4 (q87) : une seule requête pour les deux usages.

### 5.5 Notifications (au mieux, sur le modèle de `RoleService.notifyMembers`)

Un échec de notification est journalisé et n'est jamais fatal. Les notifications sont émises **après la validation de la transaction**, jamais à l'intérieur, et ne dépendent pas de l'écriture de l'audit (C-B6a-01, condition 1). `resourceType` vaut `MANAGEMENT`. Les quatre types sont au catalogue comme **obligatoires** (q95).

| Événement | Destinataires |
|---|---|
| `RISK_FRAMEWORK_CHANGE_PENDING` | Détenteurs de `riskframework.activate`, sauf le demandeur |
| `RISK_FRAMEWORK_CHANGE_DECIDED` | Le demandeur |
| `RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE` | Détenteurs de `audit.read` (même convention qu'en q65), quand Audit n'est pas le décideur |
| `RISK_FRAMEWORK_NO_DECIDER` | Membres RM |
| `RISK_FRAMEWORK_BOOTSTRAP_NOTICE` (**B-6d**, obligatoire au catalogue, q99) | Membres actifs d'Audit et du Comité : à chaque décision BOOTSTRAP, et à l'arrivée d'un membre dans l'un de ces groupes si le tenant a au moins une décision BOOTSTRAP (§5.6 point 7). Personne d'autre (q103) |

En repli q100, `RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE` part aussi aux membres des groupes contournés (§5.4.1).

### 5.6 Amorçage (B-6d : q77, q81, q82, q83, q93, q98, q99, q101, q102, q103)

**Pourquoi** : Djamo démarre avec un seul Risk Manager (q93). Sans exception, sa première demande d'activation reste PENDING sans décideur (§5.4, q75).

**Sources** : DECISION-044 points 3 à 5 (q81 à q83) ; DECISION-045 points 3 et 4 (q98, q99) ; DECISION-046 points 2 à 4 (q101 à q103). q101 **remplace** la lecture « fin dès le premier membre » de q82 (I-D1). I-D2 et I-D4 sont confirmés par A13 (revue du 2026-10-12, §1.2). Seule I-D7 (lecture du seuil de q103) attend A13, sans bloquer (§14.2).

1. **Périmètre fermé (q81).** L'amorçage ne couvre que :
   - l'activation du **premier** Dispositif du tenant : demande `ACTIVATE_VERSION` alors qu'aucune version du tenant n'a jamais été activée (`activated_at IS NULL` partout) ;
   - l'approbation des désignations (responsable de risque, délégué, exécuteur). Ces désignations n'existent pas encore : B-6d ne fournit que la fonction pure, que B-5 réutilisera.

   Toujours exclus : `SET_DEFAULT`, `ASSIGN_PROCESS`, toute version suivante (v2 et au-delà), les changements de droits d'Audit (q67), l'activation de l'auto-proposition (q65). Le premier Dispositif devient Dispositif par défaut par l'étape 5 de l'approbation (§4), sans demande `SET_DEFAULT`.

   L'exception ne lève **que** la règle « le décideur n'est ni le demandeur ni un auteur » (§5.3 points 3 et 4, qui désignent ici la même personne). Tout le reste s'applique : membre RM actif, `riskframework.activate`, validations du §2.3, q65, q67, audit dans la transaction (q90), et en B-5 les plafonds de cumul RO + Exécuteur et Délégué + Exécuteur (A13, I-D2 point 3).
2. **Valeurs du Dispositif amorcé (q98).** Le premier Dispositif activé par amorçage porte **uniquement les valeurs par défaut du contrat** ; tout autre réglage passe ensuite par une demande ordinaire (v2, circuit normal). Fonction pure `contractDefaultViolations(version, scaleSize): string[]` dans `domain/frameworkApproval.ts` ; la décision est refusée (`ValidationError`, liste des champs) si elle n'est pas vide. Paramètres contrôlés : ceux pour lesquels le contrat §10 ou §8 donne une valeur :

   | Colonne | Valeur exigée |
   |---|---|
   | `default_evaluation_mode` | `CLASSIQUE` |
   | `committee_evaluation_min_score` | `floor(n*n*15/25)`, n = taille de l'échelle (5, 9, 15, 21 ; q71) |
   | `committee_evaluation_enforced` | `true` |
   | `change_approver` | `RISK_MANAGER` |
   | `self_proposal_allowed` | `false` |
   | `risk_owner_executor_cumul_allowed` | `true` |
   | `delegate_executor_cumul_allowed` | `true` |
   | `hybrid_policy_enabled` | `false` |
   | `mastery_authoritative_source` | `RISK_TEAM` |
   | `committee_vote_rule` / `committee_vote_custom` | `DEFAULT` / NULL |

   Les paramètres que le contrat laisse « fixés à la création » ou « fixés par le client », sans valeur (échelle et axes, `appetite_thresholds`, `low_criticality_threshold`, `delegation_max_days`, `committee_treatment_min_score`), ne sont pas contraints au-delà des validations ordinaires : lecture A05 à confirmer, voir §14.2 point I-D8. Le brouillon de reprise (055) recopie les seuils de `configs` : s'ils diffèrent du défaut, le RM corrige le brouillon avant de demander l'activation (§8.0 étape 3).
3. **Condition d'ouverture (q77, q83, q101).** Toutes ces conditions, relues sous verrou (point 9) :
   - la fin n'est pas mémorisée (`tenants.risk_framework_bootstrap_ended_at IS NULL`, point 5) ;
   - **aucun circuit ne fonctionne** (point 4) ;
   - le demandeur est l'unique membre actif du groupe Risk Manager.

   Avoir un membre au Comité ou à Audit n'empêche plus l'amorçage (q101) : tant que le groupe n'a pas 2 membres, il ne peut pas décider (q72).
4. **Fin : un circuit fonctionne réellement (q101).** Fonction pure `isCircuitFunctional(activeMembers)` : vraie si le groupe Risk Manager compte **au moins 2 membres actifs**, ou si le Comité **ou** Audit compte **au moins 2 membres actifs** (`MIN_VOTERS`, q72). « Membre actif » a la définition du §5.3 (affectation non révoquée, utilisateur non suspendu, rattachement par `roles.system_group`). Le seuil n'exclut pas le demandeur ni les auteurs, que q72 retire pour une demande donnée : l'unique RM ne peut être ni au Comité (q94) ni à Audit (invariant), donc le résultat est le même pour l'amorçage (voir §14.2 point I-D10). Pas de durée maximale (q82).
5. **Fin définitive et mémorisée (q102).** La fin n'est **jamais recalculée** sur l'état courant des groupes : sinon révoquer ou suspendre le second RM ou un membre d'Audit suffirait à rouvrir l'exception (revue A13, I-D3). Mise en œuvre :
   - **où** : colonne `tenants.risk_framework_bootstrap_ended_at timestamptz NULL` (migration de B-6d, §12.3). NULL = amorçage possible ; non NULL = terminé, pour toujours, pour ce tenant, quel que soit le Dispositif ;
   - **qui l'écrit** : uniquement le trigger `risk_framework_bootstrap_end_mark` (§12.3), AFTER sur `user_roles` (nouvelle affectation active, ou `revoked_at` remis à NULL) et sur `users` (réactivation : `deleted_at` repasse à NULL). Quand l'événement touche l'un des trois groupes fixes, il prend le verrou du tenant, recompte les membres actifs et, si `isCircuitFunctional` est vrai (même règle en SQL), pose `now()`. Un trigger plutôt qu'un appel dans chaque service : aucun chemin d'affectation présent ou futur (`RoleService.assign`, mise à jour de rôle, `UserService.reactivate`, intervention HUMAN) ne peut l'oublier, et l'écriture fait partie de la transaction qui crée le second membre ;
   - **sous quel verrou** : `SELECT … FROM tenants WHERE id = $1 FOR UPDATE`. Le trigger le prend avant de compter. En READ COMMITTED, chaque requête de la fonction voit les validations faites avant elle : deux ajouts concurrents (deux premiers membres d'Audit) sont sérialisés, et le second voit bien le premier. Sans ce verrou, chacun compterait 1 et la fin serait perdue ;
   - **jamais rouverte** : trigger `tenants_bootstrap_end_guard` BEFORE UPDATE sur `tenants`, qui refuse (`42501`) toute modification de la colonne une fois non NULL, y compris le retour à NULL. Les retraits (révocation, suspension) ne prennent pas le verrou et n'ont aucun effet sur le marqueur ;
   - **remplissage initial** : la migration pose `now()` pour chaque tenant dont le circuit fonctionne déjà. L'état passé n'est pas reconstitué (l'historique des suspensions n'est pas conservé) : risque très faible, puisque la production n'a pas d'utilisateurs (DECISION-038 §9) ; sur staging, un tenant qui a eu deux RM puis un seul reste ouvert ;
   - **trace** : la date est le marqueur lui-même. Il n'y a pas de ligne d'audit propre ; la fin se rattache à l'audit de l'affectation ou de la réactivation qui l'a provoquée (même transaction seulement quand l'audit RBAC sera transactionnel, ce qui n'est pas encore le cas : constat A23 AUD-D044, ouvert, hors B-6d).
6. **Motif structuré (q83, I-D2 confirmé par A13).** Le RM doit d'abord faire désigner un second membre du groupe risque. Il ne crée pas d'utilisateur lui-même (droit d'administrateur, q79), sauf s'il cumule administrateur + RM (q63). S'il n'y parvient pas, il le déclare. Corps de `bootstrap-approve` : `{ comment, justification: { askedUserId, askedOn, outcome } }`, tous obligatoires :
   - `askedUserId` : l'administrateur à qui la désignation a été demandée. Le service vérifie qu'il appartient au tenant et détient au moins une permission d'administrateur (`ADMIN_PERMISSIONS`, q79 ; A06 l'exporte de `RoleService` vers le domaine). Il peut s'agir du demandeur lui-même s'il cumule (§14.2 point I-D9) ;
   - `askedOn` : date (`YYYY-MM-DD`), au plus aujourd'hui ;
   - `outcome` : texte non vide, au plus 500 caractères, qui explique pourquoi la désignation n'a pas abouti.

   La justification est enregistrée dans `bootstrap_justification` (§5.1) et le commentaire dans `decision_comment`. Le système ne peut pas vérifier l'impossibilité : c'est déclaratif et tracé, et ce risque résiduel est accepté par le PO (A13, I-D2 point 4).
7. **Information, visibilité, pas de tiers externe (q99, q101, q103).**
   - À **chaque** décision BOOTSTRAP, `RISK_FRAMEWORK_BOOTSTRAP_NOTICE` (obligatoire au catalogue, q99) part, après commit, aux **membres actifs d'Audit et du Comité** du moment, sans doublon (q101 : « l'auditeur est informé »). Elle remplace `RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE` sur ce chemin ;
   - **à l'arrivée** d'un membre dans Audit ou le Comité (affectation ou réactivation), si le tenant a au moins une décision BOOTSTRAP, la même notification lui est adressée (q77). Elle est émise par `RoleService` et `UserService.reactivate` après commit, au mieux ;
   - **groupes vides (q103)** : **personne d'autre** n'est prévenu, ni les administrateurs ni HUMAN. Le PO écarte ici la recommandation d'A13 (tiers prévenu, Q-A13-4 option A). Le risque devient réel tant qu'aucun membre n'est arrivé : le premier Dispositif d'un RM seul n'est revu par personne avant cette arrivée ;
   - **consultation** : toutes les décisions BOOTSTRAP sont journalisées (audit dans la transaction, q90) et consultables par `GET /risk-frameworks/change-requests?regime=BOOTSTRAP` (`riskframework.read`, détenue par Comité et Audit) ; l'écran « décisions prises en votre absence » relève d'un lot F. Lecture retenue : information et consultation dès le **premier** membre ; « supérieur à un membre » (q103) est la condition de **fin** (point 4). Lecture de l'orchestrateur, à confirmer par A13 (I-D7, non bloquant : si A13 la renverse, seul le moment de la notification change).
8. **Décision.** Le RM décide sa propre demande : `decision_regime = 'BOOTSTRAP'`, `decider_group = 'RISK_MANAGER'`, `decided_by = requested_by`, `decision_comment` et `bootstrap_justification` obligatoires, `ratification_status = NULL`, `fallback_cause = NULL`. **Pas de ratification ultérieure** (q83 l'emporte sur q62 pour ce seul régime, confirmé par A13, I-D4).
9. **Contrôle sous verrou.** Méthode de dépôt `recordBootstrapDecision(tenantId, requestId, decision, validateLocked, audit)`, en une transaction :
   1. `SELECT risk_framework_bootstrap_ended_at FROM tenants WHERE id = $1 FOR UPDATE` (le même verrou que le trigger de fin : un ajout concurrent attend, ou a déjà posé la fin) ;
   2. réserver la demande (`FOR UPDATE`, toujours PENDING) ;
   3. relire, dans cette transaction, les membres actifs des trois groupes et le fait qu'une version du tenant ait déjà été activée ;
   4. appeler `validateLocked(ctx)` : le service y appelle `isBootstrapAllowed(ctx)` et lève une exception si c'est refusé (même motif que `validateLocked`, F-B6a-02) ;
   5. puis les étapes de l'approbation du §4 (version ACTIVE, miroir, défaut, audit).

   Ordre des verrous : le chemin d'affectation verrouille `users`, puis `roles`, puis (trigger) `tenants`. Ce chemin-ci ne verrouille que `tenants` et les tables du Dispositif. Il ne prend ni `users` ni `roles` : pas de cycle, donc pas d'interblocage. Un retrait concurrent (révocation, suspension) ne prend pas le verrou du tenant ; il ne peut que rendre la condition plus vraie, ce qui est sans danger.

**Contrat de `isBootstrapAllowed`** (pure, `domain/frameworkApproval.ts`) :

```ts
export type BootstrapKind = "ACTIVATE_VERSION" | "ASSIGN_PROCESS" | "SET_DEFAULT" | "DESIGNATION";
export interface BootstrapContext {
  kind: BootstrapKind;
  /** q102 : tenants.risk_framework_bootstrap_ended_at relu sous verrou ; non NULL = fin définitive. */
  endedAt: Date | null;
  /** Membres actifs par groupe fixe (§5.3), relus sous verrou. */
  activeMembers: { RISK_MANAGER: number; COMMITTEE: number; AUDIT: number };
  /** Le demandeur (= décideur) est membre actif du groupe Risk Manager. */
  requesterIsActiveRiskManager: boolean;
  /** ACTIVATE_VERSION : aucune version du tenant n'a jamais été activée (q81). */
  firstActivationOfTenant: boolean;
  /** ACTIVATE_VERSION : contractDefaultViolations(...) est vide (q98). */
  contractDefaultsOnly: boolean;
  /** La demande ferait passer l'auto-proposition à true (q65). */
  switchesSelfProposalOn: boolean;
}
export type BootstrapRefusal =
  | "ENDED" | "CIRCUIT_FUNCTIONAL" | "NOT_SOLE_RISK_MANAGER" | "OUT_OF_SCOPE"
  | "NOT_FIRST_ACTIVATION" | "NOT_CONTRACT_DEFAULTS" | "SELF_PROPOSAL";
export function isCircuitFunctional(m: BootstrapContext["activeMembers"]): boolean;
/** null = autorisé ; sinon la première raison de refus, dans l'ordre ci-dessous. */
export function bootstrapRefusal(ctx: BootstrapContext): BootstrapRefusal | null;
export const isBootstrapAllowed = (ctx: BootstrapContext) => bootstrapRefusal(ctx) === null;
```

Ordre d'évaluation : `ENDED` (marqueur non NULL) → `CIRCUIT_FUNCTIONAL` (filet de sécurité : le marqueur aurait dû être posé ; le service ne le pose pas lui-même) → `NOT_SOLE_RISK_MANAGER` (`!requesterIsActiveRiskManager` ou `activeMembers.RISK_MANAGER !== 1`) → `SELF_PROPOSAL` → selon `kind` : `ASSIGN_PROCESS` et `SET_DEFAULT` donnent `OUT_OF_SCOPE` ; `ACTIVATE_VERSION` donne `NOT_FIRST_ACTIVATION` puis `NOT_CONTRACT_DEFAULTS` ; `DESIGNATION` est autorisé (B-5). Chaque raison a son message `ValidationError` (ou `ForbiddenError` pour `NOT_SOLE_RISK_MANAGER`). L'âge du tenant ne fait pas partie du contexte (q82).

**Mise en œuvre (contrat pour A06)** :
- route dédiée `POST /risk-frameworks/change-requests/:rid/bootstrap-approve` (`riskframework.activate`, membre RM, demandeur seulement, corps du point 6 en zod strict), distincte de `approve` pour que l'exception soit explicite dans les journaux HTTP et l'audit. `approve` garde son refus « décideur = demandeur » ;
- `createActivationRequest` évalue `bootstrapRefusal` sans verrou, seulement pour adapter le message de `RISK_FRAMEWORK_NO_DECIDER` (« vous pouvez décider en amorçage ») ; la décision ne s'y fie jamais ;
- défense en base : voir §12.3.

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

Complété depuis par 056 (activation liée à une demande APPROVED par un tiers), 057 (gardes `BEFORE INSERT`) et 058 (`search_path` fixé). Toute redéfinition ultérieure de ces fonctions (B-6b, B-6d) doit reprendre la garde 056 et le `search_path`.

## 7. Résolution du Dispositif applicable (B-6b)

La fonction de service interne `resolveApplicableVersion(tenantId, processId | null)` se trouve dans `services/riskFrameworkResolution.ts`. Elle ne vérifie pas de permission : ce sont les appelants qui ont déjà autorisé l'acte (même raisonnement que `resolveEvaluationModeForRisk`).

1. Remonter la chaîne des Processus jusqu'au niveau PROCESS, en réutilisant le parcours existant (`PROCESS_LEVEL_BY_RANK`).
2. Si `processes.risk_framework_id` est renseigné, prendre ce Dispositif. Sinon, prendre le Dispositif du tenant marqué `is_default`.
3. Renvoyer sa version ACTIVE, avec son échelle.
4. S'il n'y a pas de Dispositif, ou pas de version ACTIVE, renvoyer `null`. Pour un appelant en écriture, cela donne `ValidationError` : « Aucun Dispositif actif ne s'applique à ce risque ». Il n'existe **aucun repli** vers `configs` ni vers l'ancienne « échelle ACTIVE ».

`processes.risk_framework_id` (FK nullable) est posé par la migration 055 avec `CHECK (risk_framework_id IS NULL OR level = 'PROCESS')`. Il n'est écrit qu'en B-6c, après approbation.

## 8. Instantané pris par l'évaluation (F-8, B-6b)

### 8.0 Bascule (q86, décidé) et séquencement

Le PO accepte une **courte période sans évaluation possible** entre le déploiement de B-6b et la première activation d'un Dispositif. Pendant cette période, la création et la cotation d'une évaluation sont refusées (« Aucun Dispositif actif ne s'applique à ce risque »), et la Cartographie n'affiche pas de grille.

Séquencement, par environnement :
1. **Avant le déploiement de B-6b** : B-6a et ses correctifs q87/q90 sont déployés ; chaque tenant a son « Dispositif initial » en DRAFT (brouillon de reprise de 055) ; le tenant dispose d'un décideur pour la première activation, c'est-à-dire **deux RM actifs, ou B-6d déployé** (un seul RM). Sur staging, désigner un second RM de test suffit. **En production** (un seul RM au départ, q93), B-6d doit être déployé **avant ou avec** B-6b, sinon la période sans évaluation n'a pas de fin ;
2. **Déploiement** : migration de B-6b (§12.2), puis code ;
3. **Activation** : le RM corrige le brouillon si besoin (seuil hérité supérieur à n², seuil « faible » à renseigner), demande l'activation ; un second RM approuve, ou le RM seul décide en amorçage (§5.6) ;
4. **Preuve** (vigilance A14 sur q86) : la procédure est écrite dans le runbook de déploiement, et la demande APPROVED avec son audit en est la trace ;
5. les évaluations existantes restent lisibles et validables pendant toute la période : leurs seuils sont copiés par la migration (ci-dessous).

### 8.1 Colonnes et règles

Nouvelles colonnes de `risk_evaluations` :
- `risk_framework_version_id` (FK, nullable seulement pour les lignes antérieures) ;
- `committee_evaluation_min_score` (int, 1..36) ;
- `committee_evaluation_enforced` (boolean) ;
- `committee_treatment_min_score` (int, nullable).

À la création (`RiskEvaluationService.create`) :
- la version applicable est résolue (§7). Sans version, la création est refusée ;
- `riskFrameworkVersionId` est enregistré ;
- `ratingScaleId` et `ratingScaleVersion` sont désormais posés **à la création**, à partir de la version, et non plus lors de la cotation de l'Inhérent ;
- les trois seuils sont **copiés**. La version étant immuable, la FK suffirait ; la copie permet de rendre explicites les lignes antérieures, remplies par la migration. Les paramètres q91 ne sont pas copiés (§2.2) ;
- `evaluationMode` vaut `resolveInheritedEvaluationMode(chain, version.defaultEvaluationMode)`, en réutilisant la fonction existante. `Config.evaluationMode` n'est plus lu.

Ce qui se lit ensuite sur l'évaluation, et nulle part ailleurs :
- `validate`, `validateByCommittee` : seuils copiés sur l'évaluation. `resolveCommitteeEvaluationSettings` disparaît des chemins de validation ;
- `TreatmentDecisionService` : seuil de traitement de l'évaluation rattachée, au lieu de `Config` ;
- `recordInherentScoring` et `recordResidualScoring` : `getRatingScaleOrThrow(evaluation.ratingScaleId)`. Pour une ligne antérieure dont `ratingScaleId` est NULL, l'échelle est celle de la version applicable (§7), pas l'ancienne « échelle active » ;
- appétence suggérée (cotation résiduelle et `suggestAppetite`) : `version.appetiteThresholds` de l'évaluation, par la fonction pure `findAppetite(list, subCategory, entity)` placée dans le domaine. Elle doit appliquer exactement la même règle de correspondance que `PostgresRiskAppetiteRepository.getBySubCategory` (A06 la relit avant de l'écrire). Pour une ligne antérieure sans version, la lecture actuelle de `risk_appetites` est conservée en lecture seule et documentée comme chemin historique.

La surcharge d'appétence (F-9) n'est pas modifiée.

Remplissage par la migration de B-6b, uniquement pour les lignes dont les colonnes sont NULL :
- seuils copiés depuis la ligne `configs` du tenant ;
- à défaut de ligne, `floor(n*n*15/25)`, où n est la taille de l'échelle de l'évaluation (5 si aucune), `enforced = true` et seuil de traitement NULL ;
- `risk_framework_version_id` reste NULL : aucune version n'était active quand ces évaluations ont été créées. Ces lignes sont « antérieures au Dispositif » et le restent (§9).

**`mirrorScale` en B-6b** : ne lit plus `configs` ni `risk_appetites` (F-B6a-12 fermé), voir §2.3.

## 9. Cartographie et `GET /cartography/scale` (DECISION-041)

L'« échelle active du tenant » devient l'échelle de la version ACTIVE du Dispositif affiché.

- `GET /cartography/scale?frameworkId=` : sans paramètre, c'est le Dispositif `is_default`. Si le Dispositif n'existe pas, s'il n'a pas de version ACTIVE, ou si le tenant n'a pas de Dispositif, la réponse est `data: null` et la page n'affiche **aucune grille** (§4 de DECISION-041). La forme actuelle est conservée : `scaleId`, `name`, `version`, `size`, `probabilityLevels`, `impactLevels`, `maxScore`, `bands`, `bandsSource`. Quatre champs s'ajoutent : `frameworkId`, `frameworkName`, `frameworkVersionId`, `frameworkVersionNumber`. Le calcul des bandes de `getActiveScale` devient la fonction privée `scaleView(scale)`, réutilisée telle quelle.
- `GET /cartography` et `GET /cartography/compare` acceptent `frameworkId`, avec le même défaut. Une évaluation appartient à un Dispositif par sa `risk_framework_version_id`. Les lignes antérieures (NULL) sont affichées avec le Dispositif par défaut, **sans y être rattachées** : chaque point porte `frameworkVersionId: null`, ce qui permet de les présenter comme « antérieures au Dispositif » (vigilance A14 sur q86 : ne pas affirmer une méthodologie qu'on ne peut pas prouver). Aucune donnée n'est réécrite. Chaque point garde les bandes de **son** échelle (logique `resolveCriticalityBands` inchangée).
- Le frontend affiche « un Dispositif à la fois » (q25, q39). Le sélecteur et le libellé « antérieure au Dispositif » relèvent d'un lot F, hors B-6. Le visuel de la page n'est pas modifié.

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
- seuils (y compris `lowCriticalityThreshold`) : entiers compris entre 1 et 36 (`ABSOLUTE_MAX_SCORE`), le service vérifiant ensuite le plafond n² ;
- `delegationMaxDays` : entier > 0 avec une borne haute zod anti-abus choisie par A06 (garde technique, pas règle métier) ;
- `committeeVoteCustom` : objet zod strict, refusé par le service avant B-12 (§2.2).

| Méthode et chemin | Permission | Corps | Sous-lot |
|---|---|---|---|
| `GET /risk-frameworks` | read | — (Dispositifs, version active résumée, `isDefault`) | a |
| `POST /risk-frameworks` | create | `{name, description?, ratingScaleId, params?}` → Dispositif + v1 en brouillon | a (paramètres q91 : b) |
| `GET /risk-frameworks/:id` | read | — (avec la liste des versions) | a |
| `PATCH /risk-frameworks/:id` | update | `{name?, description?, reason}` (identité seulement) | a |
| `GET /risk-frameworks/:id/versions/:vid` | read | — | a |
| `POST /risk-frameworks/:id/versions` | update | `{fromVersionId?}` | a |
| `PATCH /risk-frameworks/:id/versions/:vid` | update | paramètres partiels du §2.2, sans `status` | a (paramètres q91 : b) |
| `POST /risk-frameworks/:id/versions/:vid/discard` | archive | `{reason}` | a |
| `POST /risk-frameworks/:id/versions/:vid/activation-requests` | update | `{reason}` → 201, demande | a |
| `GET /risk-frameworks/change-requests?status=&regime=` | read | — (`regime` : d) | a |
| `POST /risk-frameworks/change-requests/:rid/approve` | activate | `{comment?}` (obligatoire en repli, y compris le repli q100) ; 409 si un vote est requis, plus atteignable avant B-12 depuis B-6d (§5.4.1) | a |
| `POST /risk-frameworks/change-requests/:rid/reject` | activate | `{comment}` | a |
| `POST /risk-frameworks/change-requests/:rid/withdraw` | update | `{reason?}` ; demandeur seulement | a |
| `GET /risk-frameworks/applicable?riskId=` ou `?processId=` | read | version applicable (§7), en lecture seule pour F-1 | b |
| `POST /risk-frameworks/change-requests/:rid/bootstrap-approve` | activate | `{comment, justification: {askedUserId, askedOn, outcome}}`, tout obligatoire ; demandeur seulement, conditions du §5.6 | d |
| `POST /risk-frameworks/:id/process-assignments` | process.assign | `{processId, reason}` → demande `ASSIGN_PROCESS` | c |
| `POST /risk-frameworks/:id/default-requests` | update | `{reason}` → demande `SET_DEFAULT` | c |
| `POST /risk-frameworks/:id/archive` | archive | `{reason}` ; refusé si un Processus y est rattaché ou si c'est le Dispositif par défaut | c |

### 11.1 Rattachement d'un Processus (B-6c, q89)

- **Règle d'approbation : celle du Dispositif d'arrivée** (q89), lue sur sa version ACTIVE (§5.2). Le Dispositif d'arrivée doit donc avoir une version ACTIVE ; sinon la demande est refusée à sa création.
- **Effet au cycle suivant** (q89, invariant 9) : une fois approuvée, la demande écrit `processes.risk_framework_id` (niveau PROCESS seulement), avec un audit `Process` `UPDATE` et le motif, dans la même transaction (q90). Les évaluations déjà créées gardent leur version par l'instantané (§8) ; seules les évaluations créées **après** l'approbation résolvent le nouveau Dispositif (§7). Il n'y a ni recalcul ni réaffectation des évaluations existantes.
- Décideur : §5.3 points 1 à 3 (demandeur exclu). Le point 4 (auteurs de la version) ne s'applique pas : la demande ne crée pas de version.
- Le changement de Dispositif par défaut (`SET_DEFAULT`) suit la règle de la version active du Dispositif concerné, avec le même effet au cycle suivant pour les Processus sans rattachement explicite.
- Contrôle de plafond : chaque version n'est comparée qu'à sa propre échelle ; le contrôle inter-Dispositifs de F-B6a-10 est retiré dans ce sous-lot (§2.3).

Archiver un Dispositif fait passer sa version ACTIVE en ARCHIVED (miroir des échelles mis à jour) et renseigne `archived_*` sur l'identité. Les évaluations qui le référencent restent lisibles.

## 12. Migrations

Règles d'écriture (mémoire dev-db), pour toutes les migrations de B-6 :
- `CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` ;
- contraintes ajoutées dans un `DO $$` qui teste `pg_constraint`, avec un nom explicite distinct de tout nom automatique (incident 42710 de 055) ;
- `CREATE OR REPLACE FUNCTION`, puis `DROP TRIGGER IF EXISTS` suivi de `CREATE TRIGGER` ; **chaque** fonction de trigger fixe `SET search_path = pg_catalog, public, pg_temp`, à répéter à chaque redéfinition (058) ;
- `INSERT ... WHERE NOT EXISTS` ;
- **ne deviner aucun nom de colonne ou de contrainte** : vérifier dans les migrations existantes avant d'écrire ;
- en tête de fichier : « Ne jamais appliquer à la main : passe par `npm run migrate` » ; chaque `.down.sql` est enveloppé dans `BEGIN`/`COMMIT` et porte l'avertissement de C-B6a-08.

### 12.1 Migration 055 (B-6a, livrée) et durcissements 056 à 058

Contenu de 055, dans l'ordre :
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

Durcissements livrés : **056** (FK composite version ACTIVE → demande APPROVED par un tiers, CHECK `risk_framework_change_requests_no_bootstrap_check`), **057** (version née DRAFT, demande née PENDING, utilisateurs du tenant), **058** (`search_path` fixé sur les six fonctions de garde).

### 12.2 Migration de B-6b (numéro suivant le dernier présent)

1. Colonnes d'instantané de `risk_evaluations` et leur remplissage (§8.1).
2. Paramètres q91 sur `risk_framework_versions` avec leurs CHECK et défauts (§2.2), chacun documenté (« valeur par défaut = comportement implicite antérieur »).
3. `CREATE OR REPLACE FUNCTION risk_framework_versions_guard()` : la version de 056 (contrôle d'activation compris), avec les huit nouvelles colonnes dans `same_content`, et `SET search_path`.
4. `.down.sql` : retire les colonnes, puis restaure la fonction de 056 **avec** son `search_path` (piège F-B6a-14 : un down qui restaure une fonction sans `search_path` rouvre F-B6a-11). Un test vérifie la restauration.

### 12.3 Migration de B-6d (numéro suivant celui de B-6b)

Vérifier d'abord le dernier numéro présent : le 2026-10-12, c'était 058 ; B-6b prend le suivant (en cours) ; B-6d prend **le numéro suivant celui de B-6b**. Ne jamais le deviner ni le réutiliser. **Toute** fonction de trigger créée ou redéfinie ici fixe `SET search_path = pg_catalog, public, pg_temp` (F-B6a-11, test `QA-B6a11.test.ts`).

1. **CHECK BOOTSTRAP.** `DROP CONSTRAINT IF EXISTS risk_framework_change_requests_no_bootstrap_check`, remplacée par un CHECK nommé (`risk_framework_change_requests_bootstrap_shape_check`) qui borne BOOTSTRAP au lieu de l'interdire : `decision_regime IS DISTINCT FROM 'BOOTSTRAP' OR (kind = 'ACTIVATE_VERSION' AND status = 'APPROVED' AND decided_by = requested_by AND decider_group = 'RISK_MANAGER' AND ratification_status IS NULL AND fallback_cause IS NULL AND decision_comment IS NOT NULL AND bootstrap_justification IS NOT NULL)`. `NOT VALID`, comme 056. Quand B-5 réutilisera l'amorçage pour les désignations, ce sera dans sa propre table : ce CHECK n'a pas à les prévoir.
2. **Colonnes de `risk_framework_change_requests`** (§5.1), avec leurs CHECK nommés (`DO $$` sur `pg_constraint`) :
   - `fallback_cause text NULL`, CHECK `fallback_cause IS NULL OR fallback_cause = 'LEGACY_APPROVER_PRE_B12'`, et CHECK `fallback_cause IS NULL OR (decision_regime = 'FALLBACK' AND ratification_status = 'PENDING')` (q100) ;
   - `bootstrap_justification jsonb NULL`, CHECK `bootstrap_justification IS NULL OR jsonb_typeof(bootstrap_justification) = 'object'`, et CHECK `(decision_regime IS NOT DISTINCT FROM 'BOOTSTRAP') = (bootstrap_justification IS NOT NULL)` (q83, I-D2).

   Les deux CHECK de forme empêchent aussi de renseigner ces colonnes à l'INSERT (une demande naît avec `decision_regime` NULL). La garde d'insertion de 057 n'a donc pas à être redéfinie. La garde de mise à jour (`risk_framework_change_requests_guard`, une ligne décidée est figée) couvre les nouvelles colonnes sans changement.
3. **`risk_framework_versions_guard()` redéfinie** (reprend **toute** la garde de B-6b : liste `same_content` avec les huit colonnes q91, contrôles 056) : `PENDING_APPROVAL → ACTIVE` accepte une demande `decision_regime = 'BOOTSTRAP'` (décideur = demandeur) **seulement si** (a) aucune autre version du même tenant n'a `activated_at` renseigné (premier Dispositif, q81) **et** (b) `tenants.risk_framework_bootstrap_ended_at IS NULL` pour ce tenant (q102). Tous les autres cas restent ceux de 056 (tiers, `NORMAL` ou `FALLBACK`). Les valeurs par défaut du contrat (q98) restent contrôlées dans le service seulement, comme q87.
4. **Fin mémorisée (q102)** :
   - `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS risk_framework_bootstrap_ended_at timestamptz NULL`, commentée (« fin définitive de l'amorçage du Dispositif, q102 ; posée par trigger, jamais remise à NULL ») ;
   - fonction `risk_framework_bootstrap_end_mark()` (plpgsql, `SECURITY INVOKER`, `SET search_path`) et deux triggers `AFTER … FOR EACH ROW` :
     - `user_roles_bootstrap_end_mark` : `AFTER INSERT` avec `WHEN (NEW.revoked_at IS NULL)`, et `AFTER UPDATE OF revoked_at` avec `WHEN (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)` ;
     - `users_bootstrap_end_mark` : `AFTER UPDATE OF deleted_at` avec `WHEN (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)` ;
   - corps : (1) si le marqueur du tenant est déjà posé, sortir ; (2) sortir si l'événement ne concerne aucun rôle non supprimé de `system_group` `RISK_MANAGER`, `RISK_COMMITTEE` ou `AUDIT` (pour `users` : aucune affectation active de cet utilisateur à ces groupes) ; (3) `PERFORM 1 FROM tenants WHERE id = <tenant> FOR UPDATE` ; (4) compter les utilisateurs **distincts** actifs par groupe (`user_roles.revoked_at IS NULL`, `users.deleted_at IS NULL`, `roles.deleted_at IS NULL`, même `tenant_id` partout) ; (5) si `RISK_MANAGER ≥ 2` ou `RISK_COMMITTEE ≥ 2` ou `AUDIT ≥ 2`, `UPDATE tenants SET risk_framework_bootstrap_ended_at = now() WHERE id = <tenant> AND risk_framework_bootstrap_ended_at IS NULL`. La règle SQL doit rester identique à `isCircuitFunctional` (un test le vérifie sur Postgres jetable, §15) ;
   - fonction `tenants_bootstrap_end_guard()` (`SET search_path`) et trigger `BEFORE UPDATE ON tenants` : si `OLD.risk_framework_bootstrap_ended_at IS NOT NULL AND NEW.risk_framework_bootstrap_ended_at IS DISTINCT FROM OLD.risk_framework_bootstrap_ended_at`, `RAISE … USING ERRCODE = '42501'` ;
   - remplissage : `UPDATE tenants SET risk_framework_bootstrap_ended_at = now() WHERE risk_framework_bootstrap_ended_at IS NULL AND <circuit fonctionnel, même calcul>` ;
   - privilèges : `grc_app_runtime` doit pouvoir faire `UPDATE` sur `tenants` (A07 vérifie 043 ; le trigger s'exécute avec les droits de l'appelant).
5. Aucun changement à 057 (point 2).
6. Les conditions liées aux groupes (unique RM, aucun circuit fonctionnel) et q98 restent dans le service, sous le verrou du tenant (§5.6 point 9). La base garde le périmètre (premier Dispositif, type de demande, forme de la décision) et la fin mémorisée.
7. `.down.sql` (`BEGIN`/`COMMIT`, avertissement C-B6a-08) : supprime les triggers et fonctions du point 4, puis la colonne `tenants.risk_framework_bootstrap_ended_at` ; supprime les colonnes et CHECK du point 2 ; restaure le CHECK `no_bootstrap` (`NOT VALID`) et la fonction de garde de B-6b **avec** son `search_path`. Avertissement en tête : « à ne pas jouer après une décision BOOTSTRAP réelle ou une fin d'amorçage posée, sans export : la descente efface la fin mémorisée, donc rouvrirait l'amorçage (q102) ».

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

Une décision d'amorçage s'inscrit comme `APPROVE` avec `decisionRegime = 'BOOTSTRAP'` dans `new`, ainsi que `bootstrapJustification` (porté par la ligne de demande, §5.6 point 6). Une décision de repli q100 porte `fallbackCause = 'LEGACY_APPROVER_PRE_B12'` et `bypassedGroups` (§5.4.1). Aucune nouvelle valeur d'`action` : la contrainte `audit_log_action_check` reste inchangée.

La fin de l'amorçage (`tenants.risk_framework_bootstrap_ended_at`, posée par trigger) n'a pas de ligne d'audit propre ; elle se rattache à l'affectation ou à la réactivation qui l'a provoquée (§5.6 point 5).

**Audit dans la même transaction (q90, décidé ; correctif B-6a en cours, A06).** Contrat :
- **toutes** les actions du Dispositif, et pas seulement l'activation, écrivent leurs lignes d'audit dans la **même transaction** que l'écriture métier : création, modification de l'identité, création et modification d'un brouillon, abandon, demande, approbation, refus, retrait, et, dans les sous-lots suivants, rattachement, changement de défaut, archivage et amorçage ;
- si l'écriture de l'audit échoue, toute l'action est annulée et une erreur est renvoyée : jamais d'état métier appliqué sans sa ligne d'audit, donc plus de `reopen` ni de compensation (invariant 7) ;
- les notifications partent après la validation de la transaction et ne dépendent pas de l'audit (§5.5) ;
- le contrôle « auteur de la version » (§5.3 point 4) peut ainsi se fier au journal ;
- ce contrat ferme C-B6a-01 une fois livré. Il remplace l'« écart connu » de la version du 2026-10-11 ; il n'étend pas d'office la règle aux autres modules (lot transverse Compliance B-8, inchangé).

## 14. Questions au PO

### 14.1 Questions de la version du 2026-10-11 : toutes tranchées (DECISION-044)

| Question | Réponse du PO | Réf. | Où c'est traité |
|---|---|---|---|
| **Q1.** Fenêtre de bascule | Courte période sans évaluation acceptée | q86 | §8.0 (séquencement) |
| **Q2.** Audit ou Comité choisi comme approbateur avant B-12 | **Interdire ce choix** avant B-12 (et non plus laisser la demande en attente) | q87 | §5.4 ; correctif B-6a (A06) |
| **Q3.** « Audit et Comité » | Les deux votes requis, Comité d'abord, puis Audit | q88 | **B-12** (réserve C-B6a-03 : contrôle double dégradé marqué, voix d'Audit marquée 3e ligne) |
| **Q4.** Rattachement d'un Processus à un autre Dispositif | Règle d'approbation du Dispositif d'arrivée, effet au cycle suivant | q89 | §5.2, §11.1 (B-6c) |
| **Q5.** Amorçage | Liste fermée (q81) ; fin dès que le Comité ou Audit a un membre, sans durée maximale (q82) ; pas d'auto-approbation par défaut, le RM seul fait d'abord désigner un second membre du groupe risque, sinon agit seul, sans ratification ultérieure (q83) ; un seul RM au départ, amorçage maintenu (q93) | q81, q82, q83, q93 ; précisées par q98, q99 (DECISION-045) et q101 à q103 (DECISION-046) | §5.6, §12.3 (B-6d) ; points restants au §14.2 |
| **Q6.** Audit dans la même transaction | Oui, dès le Dispositif, pour toutes ses actions | q90 | §13 ; correctif B-6a (A06) |
| **Q7.** Paramètres reportés | Non : tous les paramètres sont prévus dès maintenant | q91 | §2.2 (B-6b) |
| **Q8.** Auto-proposition | Désactivée jusqu'à B-12 | q92 | §5.4 ; **B-12** pour son ouverture |

### 14.2 Points d'interprétation et questions résiduelles

**Amorçage (B-6d)** : I-D1 à I-D6 sont **tranchés** ; restent I-D7 à I-D10, aucun ne bloque le dispatch.

| Point | Statut | Décision | Où |
|---|---|---|---|
| **I-D1.** Sens de « fin » (q82) | **Tranché** (q101, DECISION-046) | La fin vient quand un circuit fonctionne réellement : second RM actif, ou au moins 2 membres au Comité ou à Audit (q72). Jusque-là, le RM s'auto-approuve et les membres existants d'Audit et du Comité sont informés. Plus de blocage « 1 RM + 1 auditeur ». Le PO n'a pas retenu la recommandation A+C d'A13 (Q-A13-2) : l'auto-approbation persiste en présence d'un seul tiers, qui est informé | §5.6 points 3, 4, 7 |
| **I-D2.** « Créer d'abord un autre utilisateur » (q83) | **Confirmé par A13**, avec renforcement | Lecture déclarative ; motif **structuré** (administrateur sollicité, date, raison) ; l'exception ne lève que « décideur ≠ demandeur ». Le point « tiers prévenu si groupes vides » d'A13 est écarté par q103 | §5.6 points 1, 6 |
| **I-D3.** Fin définitive ou réversible | **Tranché** (q102) | Définitive et mémorisée : `tenants.risk_framework_bootstrap_ended_at`, posée par trigger sous verrou du tenant, jamais remise à NULL | §5.6 point 5, §12.3 point 4 |
| **I-D4.** Pas de ratification (q83) contre q62 | **Confirmé par A13** | q83 l'emporte sur q62 pour le seul régime BOOTSTRAP. Le repli q100 reste, lui, ratifié | §5.6 point 8, §5.4.1 |
| **I-D5.** Valeurs du Dispositif amorcé | **Tranché** (q98, DECISION-045) | Valeurs par défaut du contrat seulement ; tout réglage ensuite par une demande ordinaire | §5.6 point 2 |
| **I-D6.** Notification d'arrivée | **Tranché** (q99, DECISION-045) | `RISK_FRAMEWORK_BOOTSTRAP_NOTICE` obligatoire au catalogue | §5.5, §5.6 point 7 |
| **I-D7.** Seuil de q103 | **Ouvert, A13** (ligne I-D7 de `ACTION_ITEMS.md`), **non bloquant** | Lecture de l'orchestrateur, implémentée : information et consultation dès le premier membre ; « supérieur à un membre » = condition de fin. Si A13 la renverse, seul le déclenchement de la notification change (seuil 2 au lieu de 1) ; la donnée et la route de lecture ne bougent pas | §5.6 point 7 |
| **I-D8.** q98 et les paramètres sans valeur au contrat | **Ouvert, A13 (puis PO si besoin)**, **non bloquant** | Lecture A05, implémentée : q98 contraint les paramètres qui ont une valeur par défaut au contrat (tableau du §5.6 point 2). Échelle, appétence, seuil « faible », durée de délégation et seuil Comité de traitement restent libres dans les validations ordinaires, car le contrat les fait « fixer à la création » ou « par le client ». Pour le seuil « faible », une lecture stricte serait d'ailleurs impossible : aucun défaut, saisie obligatoire (B-6b). Exposition : un RM seul peut fixer une appétence haute ou un seuil « faible » haut (A13, R2), donc une méthodologie plus laxiste sur ces deux points. Si A13 veut les contraindre, le changement se limite à `contractDefaultViolations` | §5.6 point 2 |
| **I-D9.** Administrateur sollicité = le RM lui-même | **Ouvert, A13**, **non bloquant** | Quand le RM cumule administrateur + RM (q63), il peut créer lui-même un second RM ; la lecture retenue l'autorise à se nommer dans `askedUserId`, et son `outcome` doit expliquer pourquoi il ne l'a pas fait. L'alternative (refuser l'amorçage à un RM administrateur) bloquerait le cas où l'organisation n'a vraiment qu'une personne | §5.6 point 6 |
| **I-D10.** « Éligibles au sens de q72 » pour la fin | **Information**, non bloquant | La fin compte les membres **actifs**, sans retirer demandeur ni auteurs, puisque c'est un état du tenant, indépendant d'une demande. Pour l'amorçage, le résultat est le même : l'unique RM n'est ni au Comité (q94) ni à Audit (invariant). Une demande donnée peut ensuite trouver moins de 2 éligibles (auteurs exclus) et passer en repli ou en attente : c'est le circuit ordinaire, pas une réouverture | §5.6 point 4 |

**Demandes d'A13 hors périmètre de B-6d** (revue §1.2 et §3), non tranchées par le PO, à porter par leur lot :
- KRI « âge de l'amorçage ouvert » et KRI « décisions BOOTSTRAP non consultées par Audit ou le Comité » : lot KRI ou B-12. Il suffit que la notification conserve son état lu ou non lu (centre de notifications, q70 ; A06 vérifie que c'est déjà le cas, sans nouveau code en B-6d) ;
- exclusion de vote B-12 calculée depuis l'audit (G2) : cahier de B-12 ;
- cause du repli `ABSENCE` / `EXCLUSION` (F-B6a-05, décision PO facultative) : non introduite ; la colonne `fallback_cause` de B-6d ne porte que `LEGACY_APPROVER_PRE_B12`, et son CHECK s'élargira si le PO retient F-B6a-05.

**Repli q100** : tranché (DECISION-046 point 1) ; voir §5.4.1. Pas de point ouvert.

**B-6b, R1 à R5** : A13 a répondu (revue §4) ; ces réponses relèvent de B-6b, en cours, et ne sont pas reprises dans cette mise à jour.

**B-6b, paramètres q91 : à confirmer par A13 (et le PO si A13 ne peut pas trancher)** :
- **R1.** « Tous les paramètres » couvre-t-il aussi les statuts de contribution personnalisés (B-3) et le mode d'appétence avec sa règle de surcharge (F-9) ? La spec les laisse à leur lot, faute de mention dans q91.
- **R2.** Seuil « faible » : le contrat ne donne pas de valeur par défaut. La spec le rend obligatoire à la demande d'activation. Faut-il une valeur proposée par l'assistant (par exemple la borne haute de la bande la plus basse de l'échelle) ?
- **R3.** Les deux cumuls sont modélisés en booléens (`true` = règle du contrat, `false` = cumul interdit, plus strict). Le contrat les présente comme paramètres sans dire quelle autre valeur est possible. A13 confirme-t-il que « interdit » est la seule alternative ?
- **R4.** Maîtrise : la seconde valeur `FIRST_LINE` (la saisie de la 1re ligne fait foi) est une lecture du contrat (« celle désignée par le paramètre fait foi »). « Qui note la Maîtrise » reste « selon le mode » et n'a pas de colonne : faut-il d'autres valeurs ?
- **R5.** Durée de délégation : NULL signifie « non fixée ». B-5 doit-il alors exiger une date de fin sur chaque délégation datée ?

**B-6c** :
- **I-C1. Réserve QA (F-B6a-12) : seuils comparés aux échelles d'autres Dispositifs.** Traitement retenu au §2.3 : retrait en B-6c du contrôle inter-Dispositifs, une fois les lecteurs hérités supprimés par B-6b. Chaque version n'est comparée qu'à sa propre échelle. A13 confirme (c'était le point « à confirmer par A13 avec B-6c »).
- **I-C2. Sens de « cycle suivant » (q89).** Lecture retenue : « évaluations créées après l'approbation ». Une `ReviewCycle` ouverte doit-elle figer le Dispositif de ses Processus jusqu'à sa clôture ? Recommandation A05 : non en B-6c (aucun lien évaluation ↔ campagne aujourd'hui), à revoir si ce lien est créé.
- **I-C3. Information au PO.** A14 recommandait la plus exigeante des deux règles (Dispositif quitté et d'arrivée) pour éviter qu'on rattache un Processus à un Dispositif moins exigeant afin d'éviter un vote. Le PO a retenu la règle d'arrivée (q89). Le risque reste théorique jusqu'à B-12, puisque seul RISK_MANAGER est possible d'ici là (q87). À réexaminer avec B-12. Aucune action en B-6c.

## 15. Tests de niveau 1 attendus (A06)

Les cas limites inter-modules relèvent d'A08.

**B-6a** (`test/RiskFrameworkService.test.ts`, faux repositories) :
- création : Dispositif + v1 en DRAFT ; `created_by` forcé ; refus sans `riskframework.create` ; refus pour un non-membre RM détenant la permission (q51) ; nom vide refusé ;
- brouillon : modification partielle ; `status` absent de l'entrée (le typage le garantit, et un champ inconnu est ignoré ou refusé par zod) ; modification refusée sur une version PENDING, ACTIVE ou ARCHIVED ;
- demande d'activation refusée dans chacun de ces cas : échelle non carrée ; descriptif manquant ; seuil Comité supérieur à n² ; appétence supérieure à n² ; appétences en doublon ; motif vide ;
- approbation par un 2e RM : la version passe ACTIVE et la précédente ARCHIVED, en un seul appel au dépôt ; audit `STATUS_CHANGE` avec l'ancienne et la nouvelle version ; premier Dispositif marqué par défaut ;
- refus du décideur dans chacun de ces cas : décideur = demandeur ; décideur auteur d'une modification (trouvé dans le journal d'audit) ; administrateur non RM ; absence de `riskframework.activate` ;
- refus (commentaire obligatoire) et retrait (demandeur seulement) : la version revient en DRAFT ;
- circuit : Comité vide et Audit vide donnent un repli RM `FALLBACK` avec commentaire obligatoire, `ratification_status = PENDING` et Audit notifié ;
- **q87** : `changeApprover` autre que `RISK_MANAGER` refusé à la création, à la modification d'un brouillon et à la demande d'activation ;
- **q90** : échec simulé de l'audit → aucune écriture métier visible, erreur renvoyée, notification non émise ; pour chaque action du Dispositif ;
- auto-proposition `false → true` refusée dès la création de la demande hors vote du Comité ;
- un seul RM qui est aussi le demandeur : la demande reste PENDING et `RISK_MANAGER` reçoit la notification `NO_DECIDER` ;
- fonctions pures : `resolveDecider` (table du §5.4) et `assertReadyToActivate` déplacée (les tests `RatingScaleService` existants restent verts).

**B-6b** :
- `create` d'une évaluation : version, échelle et seuils copiés ; refus sans Dispositif actif ; mode résolu à partir de `defaultEvaluationMode` ;
- `validate` lit le seuil copié : changer ensuite la version active ne modifie pas le circuit de l'évaluation (F-8) ;
- `findAppetite` ;
- `getActiveScale` renvoie l'échelle du Dispositif par défaut, ou `null` sans Dispositif actif ; une ligne antérieure ressort avec `frameworkVersionId: null` ;
- écritures fermées (`updateCommitteeThresholds`, `setThreshold`, `activateVersion`) quand le dépôt du Dispositif est câblé ; comportement inchangé quand il ne l'est pas ;
- paramètres q91 : défauts posés à la création, recopiés dans un brouillon ; demande d'activation refusée sans seuil « faible » ou avec un seuil « faible » supérieur à n² ; `CUSTOM` refusé ; `mirrorScale` ne lit plus `configs`.

**B-6d** (fonctions pures dans `test/frameworkApproval.test.ts`, service dans `test/RiskFrameworkService.test.ts`, faux dépôts) :
- **q101, fin quand un circuit fonctionne** : `isCircuitFunctional` vrai pour 2 RM, 2 membres du Comité, 2 membres d'Audit ; faux pour 1 RM + 1 membre au Comité + 1 membre à Audit. `bootstrapRefusal` renvoie `null` pour un RM seul avec **un** membre au Comité et **un** à Audit (l'amorçage reste ouvert) ; `CIRCUIT_FUNCTIONAL` dès 2 RM, 2 au Comité ou 2 à Audit ; `NOT_SOLE_RISK_MANAGER`, `OUT_OF_SCOPE` (`SET_DEFAULT`, `ASSIGN_PROCESS`), `NOT_FIRST_ACTIVATION` (v2), `SELF_PROPOSAL`, chacun sur un cas dédié ; `DESIGNATION` autorisé ;
- **q102, fin mémorisée** : `bootstrapRefusal` renvoie `ENDED` quand `endedAt` est renseigné, **même si** les compteurs sont revenus à 1 RM et 0 membre (cas « le second RM a été révoqué ») ; service : `bootstrap-approve` refusé dans ce cas avec le message de fin définitive ;
- **q98** : `contractDefaultViolations` vide pour une version aux défauts (échelles 3 à 6 : seuil 5, 9, 15, 21) ; une violation par colonne du tableau du §5.6 point 2 (au moins : seuil Comité différent, `committee_evaluation_enforced = false`) ; une appétence renseignée ne compte pas comme violation (I-D8) ; service : `bootstrap-approve` refusé avec `NOT_CONTRACT_DEFAULTS` et la liste des champs ;
- **q83 / I-D2** : `bootstrap-approve` enregistre le régime BOOTSTRAP, `decided_by = requested_by`, `ratification_status` NULL, `fallback_cause` NULL, `bootstrap_justification` égale au corps, audit dans la transaction (`APPROVE` + `STATUS_CHANGE` avec `decisionRegime`) ; refusé sans `justification`, avec un `askedUserId` hors tenant ou sans permission d'administrateur, avec `askedOn` dans le futur ; refusé par un autre que le demandeur ; `approve` garde son refus de l'auto-décision ;
- **q99 / q101 / q103, notifications** : après une décision BOOTSTRAP, `RISK_FRAMEWORK_BOOTSTRAP_NOTICE` part aux membres actifs d'Audit et du Comité (un seul membre suffit) et à personne d'autre ; avec les deux groupes vides, **aucune** notification n'est émise (ni administrateur, ni autre) ; le type est au catalogue comme obligatoire ; `RoleService` : affecter un membre à Audit ou au Comité dans un tenant qui a une décision BOOTSTRAP lui envoie la notification, et ne l'envoie pas s'il n'y en a pas ;
- **q100, repli d'une version héritée** : `foldVoteBeforeB12` transforme chaque `VOTE` en `FALLBACK` avec `LEGACY_APPROVER_PRE_B12` et `bypassedGroups`, et laisse `NORMAL` et `FALLBACK` intacts. Service, avec une version ACTIVE `COMMITTEE` et un Comité de 2 membres éligibles : `approve` par un second RM réussit (plus de 409), `decision_regime = 'FALLBACK'`, `ratification_status = 'PENDING'`, `fallback_cause` renseignée ; commentaire obligatoire ; `reject` fonctionne aussi ; le demandeur ne peut pas décider ; Audit et les membres du Comité reçoivent l'avis ; une demande qui active l'auto-proposition reste refusée.

**Migrations B-6d** (A07, Postgres jetable) :
- appliquée deux fois sans erreur ; le remplissage pose la fin pour un tenant à 2 RM et la laisse NULL pour un tenant à 1 RM ;
- **trigger de fin** : affecter un second RM pose `risk_framework_bootstrap_ended_at` ; un second membre d'Audit aussi ; un seul membre au Comité, non. Révoquer ensuite le second RM laisse le marqueur posé. Réactiver un utilisateur suspendu qui fait passer Audit à 2 pose le marqueur. (La concurrence, deux premiers membres d'Audit affectés en parallèle, relève d'A08, §17) ;
- `UPDATE tenants SET risk_framework_bootstrap_ended_at = NULL` (ou une autre date) refusé (`42501`) une fois posé ;
- activation BOOTSTRAP refusée en base quand le marqueur est posé ; demande BOOTSTRAP sans `bootstrap_justification` refusée par le CHECK ; `fallback_cause` sans `ratification_status = 'PENDING'` refusée ;
- `QA-B6a11.test.ts` vert sur les trois nouvelles fonctions (`search_path`).

**B-6c** :
- rattachement approuvé : `risk_framework_id` est écrit au niveau PROCESS seulement, et un sous-processus en hérite par la résolution ; la règle appliquée est celle du Dispositif d'arrivée ; une évaluation créée avant l'approbation garde sa version ;
- cible sans version ACTIVE refusée ;
- archivage refusé pour le Dispositif par défaut ou pour un Dispositif auquel un Processus est rattaché ;
- deux Dispositifs actifs d'échelles différentes (6×6 avec seuil 21, 3×3) : activation acceptée.

**Migrations** (A07) :
- chaque migration appliquée deux fois de suite sans erreur ;
- trigger : `UPDATE` d'une version ACTIVE refusé, **y compris sur chacune des colonnes q91** ; `DELETE` refusé ;
- modification du contenu d'une échelle référencée par une version PENDING refusée ;
- B-6d : activation BOOTSTRAP acceptée pour le premier Dispositif, refusée en base pour une seconde activation du tenant, pour un autre type de demande ou avec `ratification_status` renseigné (compléments B-6d ci-dessus) ;
- `.down.sql` testés sur un Postgres jetable (procédure de `memory/dev-db.md`), fonction restaurée avec son `search_path`.

**Vérification avant rapport** : `npm run typecheck && npm test` dans `backend/`.

## 16. Fichiers touchés (repère pour A06)

- **Nouveaux** :
  - `domain/entities/RiskFramework.ts`
  - `domain/repositories/RiskFrameworkRepository.ts`
  - `domain/frameworkApproval.ts` (`resolveDecider`, puis `isBootstrapAllowed` en B-6d)
  - `domain/ratingScaleRules.ts`
  - `infrastructure/database/postgres/PostgresRiskFrameworkRepository.ts`
  - `services/RiskFrameworkService.ts`
  - `services/riskFrameworkResolution.ts`
  - `api/v1/riskFrameworks.routes.ts`
  - migrations 055 à 058 (livrées), puis une migration pour B-6b et une pour B-6d, avec leurs `.down.sql`
- **Modifiés** :
  - `domain/permissions.ts` et `domain/fixedGroupPermissions.ts` (fichiers partagés : travailler en worktree) ;
  - `server.ts` (câblage, fichier partagé) ;
  - `RatingScaleService` (import des règles déplacées, fermeture de `activateVersion` si câblé) ;
  - `ConfigService` et `RiskAppetiteService` (fermetures, B-6b) ;
  - `RiskEvaluationService` et `TreatmentDecisionService` (instantané, B-6b) ;
  - `CartographyService` et `cartography.routes.ts` (B-6b) ;
  - `RiskDeviceViewService` (B-6b) ;
  - `domain/notificationCatalog.ts` (B-6d : type d'amorçage, obligatoire) ;
  - le point d'ajout d'un membre au Comité ou à Audit (`RoleService`, `UserService.reactivate`, B-6d : notification d'amorçage après commit) ; `ADMIN_PERMISSIONS` exporté de `RoleService` vers le domaine (B-6d, §5.6 point 6) ;
  - `domain/frameworkApproval.ts` (B-6d : `isCircuitFunctional`, `bootstrapRefusal`/`isBootstrapAllowed`, `contractDefaultViolations`, `foldVoteBeforeB12`) ; `RiskFrameworkService.resolveFor` (q100) ; `PostgresRiskFrameworkRepository` (`recordBootstrapDecision`, colonnes `fallback_cause` et `bootstrap_justification`) ;
  - `docs/security/B8-predeploy-checks.sql` (B-6d : requête n° 10, §5.4.1).
- Toute nouvelle dépendance de constructeur est un **paramètre optionnel avec garde**. Une dépendance qui porte une règle de sécurité échoue de façon fermée (fail-closed), comme le prévoit le principe 9 de `memory/dev-backend.md`.

## 17. Passages après merge

- **Security (A10)** : circuit d'activation, exclusion des auteurs, triggers d'immuabilité, fermeture des écritures concurrentes. CLAUDE.md impose de vérifier tout champ `...By` d'un `Create...Input` : `requestedBy`, `decidedBy`, `createdBy` et `lastEditedBy` doivent tous être forcés côté serveur. B-6d : contournement de l'amorçage (seconde activation, autre type, ajout concurrent d'un membre) ; **réouverture de la fin** (révocation ou suspension du second membre, `UPDATE tenants` direct, chemin d'affectation qui échapperait au trigger, par exemple un rôle dont le `system_group` changerait) ; `askedUserId` arbitraire ; repli q100 (le demandeur ou un auteur ne décide jamais, `fallback_cause` jamais posée hors repli).
- **QA (A08)** : cas limites du circuit, concurrence des approbations (`FOR UPDATE`), lignes antérieures sans version, rollback complet sur échec d'audit (q90). B-6d : deux premiers membres d'Audit affectés en parallèle (marqueur posé), `bootstrap-approve` concurrent d'une affectation de second RM (l'un des deux gagne, jamais une décision BOOTSTRAP après la fin), absence d'interblocage entre affectation, réactivation et `recordBootstrapDecision`.
- **Compliance (A14)** : B-6b (gouvernance des paramètres, ligne de la GRC Trigger Matrix) et **B-6d** (seule exception à « jamais d'auto-approbation », repli q100 avec ratification, q103 « personne d'autre prévenu » contre la recommandation A13). B-6c si A13 ne confirme pas I-C1 sans réserve.

## 18. Plan de dispatch

| Ordre | Sous-lot | Rôles | Migration | Prérequis de dispatch |
|---|---|---|---|---|
| 0 | Correctifs B-6a q87 + q90 | A06 (en cours, worktree `wt/b6a-q87q90`) | aucune prévue | — ; puis A08, A10 ; ferme C-B6a-01 et C-B6a-02 |
| 1 | **B-6b** branchement + paramètres q91 | A06 ; A07 pour la migration (spawn par A06 autorisé) | une (n° suivant le dernier, indicatif 059) | correctifs q87/q90 fusionnés ; A13 sur R1 à R5 (non bloquant : la spec applique les défauts du contrat et laisse NULL ce qui n'en a pas) |
| 2 | **B-6d** amorçage + repli q100 | A06 ; A07 pour la migration (spawn par A06 autorisé) | une (n° suivant celui de B-6b) | **B-6b fusionné** (la garde de version de B-6d reprend celle de B-6b, et le numéro de migration en dépend). I-D1 à I-D6 tranchés (DECISION-045, DECISION-046, revue A13) ; I-D7 à I-D10 non bloquants. Doit être en production **avant ou avec** B-6b (q93). Requête n° 10 jouée par HUMAN avant la production |
| 3 | **B-6c** multi-Dispositif | A06 | aucune | B-6b fusionné, inventaire des lecteurs hérités vide ; A13 sur I-C1 |

- Les quatre sous-lots modifient `RiskFrameworkService`, les routes et la fonction de garde : ils sont **séquentiels**, un seul A06 à la fois, en worktree (fichiers partagés `server.ts`, `permissions.ts`).
- Après chaque sous-lot : A08 et A10 ; A14 après B-6b et B-6d (§17).
- Rappeler à A06 la consigne `ponytail`, la vérification `npm run typecheck && npm test`, et la règle `search_path` pour toute fonction de trigger redéfinie.
