# RM V1 — Contribution, mode HYBRIDE, E-10 : passage Architecte

**Statut** : PROPOSITION — non arbitrée. Rapport de l'agent Architecte du
2026-10-08 (lecture seule, aucun fichier modifié), consigné par
l'orchestrateur. Les Open Decisions OD-1 à OD-11 et le finding F-1 sont
suivis dans `.claude/agent-context/ACTION_ITEMS.md`. Aucun code ne démarre
avant leur arbitrage (contrat `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` §1,
§18).

Vérifié indépendamment par l'orchestrateur sur `staging` (`bb8929a`) :
F-1 (`RiskService.ts:165-174`), E-10 (`RiskEvaluationService.ts:168-180`),
F-4 (`riskEvaluations.routes.ts:189`).

## En bref

- **Le mode d'évaluation n'a aujourd'hui aucun effet sur le comportement** :
  aucune ligne de code ne se branche sur sa valeur. CLASSIQUE / PARTICIPATIF
  (et demain HYBRIDE) ne prennent un sens qu'avec la Contribution.
- **La correction E-10 serait contournable** sans durcir d'abord
  `assignOwner` (F-1) : tout détenteur de `risk.update` peut se désigner
  Risk Owner.
- **Le gap (9) est déjà fermé dans le code** (`GET
  /risk-evaluations/:id/treatment-decision` existe), et le gap (6) cite une
  constante qui n'existe plus.

## A. État actuel

### A.1 Modes d'évaluation
- `EvaluationMode = "CLASSIQUE" | "PARTICIPATIF"` (`Config.ts:46`) ; le
  commentaire `Config.ts:43-44` (« Not read yet ») est périmé, le service le
  lit (`RiskEvaluationService.ts:571-575`).
- Trois stockages : `configs.evaluation_mode` NOT NULL défaut `'CLASSIQUE'`
  (`030:24-25`) ; `processes.evaluation_mode` nullable = hérite
  (`030:31-32`) ; instantané `risk_evaluations.evaluation_mode` nullable,
  sans backfill (`034:28-29`).
- Demandes de changement : `process_evaluation_mode_requests` (`033:27-53`),
  CHECK `requested_mode` à deux valeurs (`033:31`), maker-checker
  `assertNotSelfValidated` (`ProcessEvaluationModeRequestService.ts:32`,
  `:153`, `:203`), niveau PROCESS uniquement (`:58`).
- Permissions : `process.evaluationmode.set`, `process.evaluationmode.propose`,
  `evaluationmode.validate` (`permissions.ts:46`, `:55`, `:66`).
- Résolution : `resolveInheritedEvaluationMode` (`Process.ts:84-92`), appelée
  une seule fois à la création (`RiskEvaluationService.ts:185`, `:556-569`),
  repli `"CLASSIQUE"` (`:24`). Parcours de chaîne dupliqué avec
  `ProcessService.resolveEvaluationMode` (`:545-555`).
- **Aucun branchement** : aucun `evaluationMode ===` / `case "PARTICIPATIF"`
  dans le dépôt.
- Listes de valeurs dupliquées : `ConfigService.ts:12`, `config.routes.ts:24`,
  `processEvaluationModeRequests.routes.ts:5`, `processes.routes.ts:7`,
  frontend `api/evaluations.ts:53`, `EvaluationPage.tsx:28-29`.

### A.2 Évaluateur
- `evaluatorId` forcé à `actor.userId` (`RiskEvaluationService.ts:165`,
  `:193`). Seule garde d'entrée : `riskevaluation.create` (`:168`), aucune
  comparaison avec `Risk.ownerId` (E-10) ; si `RiskRepository` n'est pas
  injecté, aucune vérification (`:176-180`).
- Les trois saisies passent par `assertIsEvaluator` (`:86-90`, appels `:245`,
  `:280`, `:337`). Maker-checker : `validate`/`reject`/`validateByCommittee`
  refusent `evaluatorId === actor.userId` (`:432`, `:472`, `:524`).
- `Risk.ownerId` nullable (`Risk.ts:31`), absent de `CreateRiskInput`
  (`Risk.ts:48-54`) : tout risque naît sans owner. Modifiable seulement via
  `RiskService.assignOwner` sous `risk.update` (`RiskService.ts:165-166`),
  sans garde anti-auto-désignation (`:169-174`).
- Treatment Decision : G2 réserve la proposition à l'évaluateur
  (`TreatmentDecisionService.ts:53-55`) ; une fois E-10 corrigé, le proposant
  sera mécaniquement le Risk Owner. Aucun changement nécessaire.

### A.3 Contribution
- Inexistante côté backend, absente de l'Apps Script et du backlog ACT.
  Frontend : bannière de gap (`EvaluationPage.tsx:423-425`).
- La recommandation Risk Manager du 2026-09-29 (« L1 soumet, L2 endosse »,
  `SHARED_LOG.md:2368-2384`) est remplacée par le contrat §5/§7 : aucun
  statut d'endossement n'est nécessaire sur `RiskEvaluation`.
- Les décisions sur les modes sont DECISION-006 et DIV-06 (DECISION-007
  porte sur `risk_processes`).

### A.4 Analyse (gap 5)
- `Risk` ne porte que `description` (`Risk.ts:21`) ; l'Analyse affichée se
  limite aux contrôles couvrants (`riskEvaluations.routes.ts:64-71`,
  `EvaluationPage.tsx:410`).

### A.5 Migrations
- Dernière : `046_treatment_decisions.sql` ; deux fichiers en 044.
  Prochain numéro libre : **047** (à revérifier juste avant d'écrire).

## B. Traduction technique proposée

### B.1 Contribution (`RiskContribution` / `risk_contributions`)
- **Append-only avec une seule transition terminale** SOUMISE → RETENUE |
  ECARTEE (même famille que `033` et `046`). Mise à jour en place écartée
  (§12 historique jamais écrasé, §13 historique lisible) ; ticket lifecycle
  écarté (ni réouverture ni état intermédiaire).
- Rattachement : Inherent/Maîtrise → `RiskEvaluation` en BROUILLON
  (`risk_id` déduit côté serveur) ; Identification/Analyse → risque ;
  Signalement → potentiellement sans risque (lot séparé, OD-5). **Résiduel
  exclu** du type et de la contrainte CHECK (§7).
- « Le contributeur ne cote jamais » : le service Contribution n'écrit
  jamais dans `RiskEvaluationRepository`, `RiskEvaluationService` ne lit
  jamais les contributions pour calculer, toute valeur indicative (OD-2) est
  stockée à part et jamais recopiée.

### B.2 HYBRIDE
- Une troisième valeur dans l'enum existant ; les quatre stockages en
  héritent sans nouvelle table.
- Ce que le mode change : une seule fonction pure
  `allowedContributionTypes(mode)`. Même parcours, mêmes saisies, mêmes
  validations : pas de troisième workflow (§7). Contenu de la matrice : OD-1.

### B.3 E-10
- Dans `RiskEvaluationService.create`, après le chargement du risque. Aucune
  migration, aucune permission. Prérequis : F-1.

### B.4 Champs Analyse (gap 5)
- Hors de ce lot : structure non fixée par §4, tension avec l'historique
  (§10/§12) si colonnes en place sur `risks`, et la contribution Analyse
  couvre déjà l'apport d'information (OD-10).

## C. Détail

### C.1 Contribution
- **Migration 048** `048_risk_contributions.sql` : `id`, `tenant_id` FK,
  `type` CHECK (`SIGNALEMENT`, `IDENTIFICATION`, `ANALYSE`, `INHERENT`,
  `MAITRISE`), `risk_id` FK (nullable seulement pour SIGNALEMENT),
  `risk_evaluation_id` FK (présent si et seulement si INHERENT/MAITRISE),
  `process_id` FK nullable, `evaluation_mode` NOT NULL (instantané, CHECK à
  trois valeurs), `content` NOT NULL, `proposed_values` jsonb et
  `rating_scale_id` (seulement si OD-2 = B), `status` CHECK (`SOUMISE`,
  `RETENUE`, `ECARTEE`), `contributed_by` NOT NULL, `reviewed_by`,
  `reviewed_at`, `review_comment`, `created_at`, `updated_at`. Index
  `(tenant_id, risk_id, created_at DESC)` et `(tenant_id,
  risk_evaluation_id)`. Pas de `deleted_at` ni de DELETE (comme `046`).
- **Permissions** : `riskcontribution.read`, `riskcontribution.create`,
  `riskcontribution.review` (transition terminale = permission dédiée). Pas
  d'update générique.
- **Gardes** :
  - G1 `requirePermission("riskcontribution.create")`.
  - G2 type autorisé ; `RESIDUEL` rejeté explicitement (§7).
  - G3 `contributedBy` forcé à `actor.userId`, absent de l'input.
  - G4 rattachement : Inherent/Maîtrise exigent `riskEvaluationId` (tenant),
    `riskId` déduit, incohérence rejetée ; Identification/Analyse exigent
    `riskId` et interdisent `riskEvaluationId`.
  - G5 Inherent/Maîtrise exigent une évaluation BROUILLON.
  - G6 `allowedContributionTypes(mode)` contient le type (instantané pour
    Inherent/Maîtrise, résolution à chaud sinon ; `null` = refus) ; extraire
    le parcours de chaîne en fonction partagée.
  - G7 contributeur ≠ `risk.ownerId` (sous réserve d'OD-3).
  - G8 `content` non vide ; si OD-2 = B, `proposed_values` validé contre la
    grille active (axes dynamiques, §6), aucun score calculé.
  - G9 revue : `riskcontribution.review`, acteur = `risk.ownerId` au moment
    de la revue, statut SOUMISE, RETENUE ou ECARTEE (commentaire obligatoire
    pour ECARTEE), `reviewedBy` forcé, acteur ≠ `contributedBy`.
  - G10 audit dans la même méthode (CREATE, VALIDATE/REJECT, déjà admis par
    `044_audit_log_escalate.sql:25-29`), compensation si l'audit échoue
    (pattern PR #58).
  - G11 `actor.tenantId` sur tous les appels repository.
- **Endpoints** `/api/v1/risk-contributions` : `POST /`, `GET
  /?riskId=&riskEvaluationId=`, `GET /:id`, `PATCH /:id/review`.
- **Frontend** : panneau Contributions à la place de la bannière
  `EvaluationPage.tsx:423-425`, distinct de la cotation (§13). Bloqué par
  Penpot.

### C.2 HYBRIDE
- **Migration 047** `047_evaluation_mode_hybride.sql` : recréer quatre
  contraintes CHECK (`configs_evaluation_mode_check`,
  `processes_evaluation_mode_check`,
  `process_evaluation_mode_requests_requested_mode_check`,
  `risk_evaluations_evaluation_mode_check`) — noms à vérifier en lecture
  seule dans `pg_constraint` ; down refusant ou documentant les lignes déjà
  à `'HYBRIDE'`.
- Code : `Config.ts:46`, `ConfigService.ts:12`, les trois `z.enum`, frontend
  `api/evaluations.ts:53` et `EvaluationPage.tsx:29` ; idéalement une seule
  constante `EVALUATION_MODES`.
- Aucune nouvelle permission. H-G1 : mêmes chemins gouvernés. H-G2 : seule
  `allowedContributionTypes` lit le mode.

### C.3 E-10
- E10-G1 `RiskRepository` obligatoire dans `create` (erreur explicite au lieu
  du saut silencieux `:177`) ; E10-G2 `risk.ownerId` non nul sinon
  `ValidationError` ; E10-G3 `actor.userId === risk.ownerId` sinon
  `ForbiddenError`.
- Tests : fixtures `RiskEvaluationService.test.ts:304-316` (ajouter
  `ownerId: "user-evaluator"`) et `GovernanceService.test.ts:469` ; nouveaux
  tests niveau 1 (non-owner refusé, risque sans owner refusé).
- Frontend : comparer `GET /api/v1/users/me` à `selectedRisk.ownerId` pour
  expliquer le blocage au lieu d'une erreur générique.

### C.4 Champs Analyse
- Hors lot (OD-10). Si faits plus tard : migration distincte,
  `buildUpdateSet`, permission `risk.analysis.update`, instantané sur
  `risk_evaluations`.

## D. Open Decisions

| OD | Arbitre | Question | Recommandation | Bloquante pour |
|---|---|---|---|---|
| OD-1 | Risk Manager puis PO | Définition d'HYBRIDE et matrice mode × types de contribution ouverts | Matrice fixe en code, contenu fourni par le RM (une ouverture configurable par tenant reviendrait à des workflows distincts, contraire à §7) | B-2, B-3 |
| OD-2 | Risk Manager | Contribution Inherent/Maîtrise : texte seul, ou texte + valeurs indicatives (jamais recopiées) ? | Valeurs indicatives si le RM les considère comme un avis, sinon texte seul | B-3 (schéma) |
| OD-3 | Risk Manager | Qui peut contribuer ; le Risk Owner est-il exclu des contributions ? | Permission + mode en V1, owner exclu | B-3 (défaut possible) |
| OD-4 | Risk Manager | L'owner statue-t-il sur chaque contribution (RETENUE/ECARTEE) ou simple journal ? | Statut de revue, pour tracer ce que l'owner fait de l'apport | B-3 |
| OD-5 | Risk Manager puis PO | Signalement : destinataire, rattachement, conversion en risque officiel | Lot séparé B-4 | B-4 |
| OD-6 | Risk Manager | E-10 strict (owner seul pour les trois saisies) ou saisie déléguée avec endossement ? | Strict, conforme au §5 tel qu'écrit | B-1 |
| OD-7 | Risk Manager | Owner changé pendant un brouillon : l'ancien termine (instantané) ou contrôle à chaque saisie ? | Instantané | Non bloquante |
| OD-8 | PO | Les risques sans owner deviennent inévaluables après E-10 | Assigner les owners avant déploiement, après comptage `owner_id IS NULL` | Déploiement de B-1 |
| OD-9 | PO + Security | Permission dédiée `risk.owner.assign` et interdiction de l'auto-désignation (F-1) | Oui (impose de revoir les droits staging et production) | B-0, donc B-1 |
| OD-10 | Risk Manager | Structure et historisation de l'Analyse | Hors lot, instantané par évaluation le jour venu | Non bloquante |
| OD-11 | Risk Manager | Des contributions SOUMISE bloquent-elles `validate()` ? | Non (contribution ≠ décision) | Non bloquante |

## E. Lots

| Lot | Contenu | Dépend de | Statut | Taille |
|---|---|---|---|---|
| B-0 | F-1 : `risk.owner.assign` + interdiction de l'auto-désignation | OD-9 | NO-GO | S |
| B-1 | E-10 : gardes E10-G1 à G3 + fixtures | B-0, OD-6, OD-8 | GO code dès OD-6 ; NO-GO déploiement avant OD-8 | S |
| B-2 | HYBRIDE : migration 047, enums, constante unique | OD-1 | NO-GO | S |
| B-3 | Contribution (Identification, Analyse, Inherent, Maîtrise) : migration 048 → routes | B-2, OD-1, OD-2, OD-4 | NO-GO | L |
| B-4 | Signalement | B-3, OD-5 | NO-GO | M |
| F-1 | Frontend : libellé HYBRIDE, garde UX E-10, message « assigner un owner » | B-1, B-2 | GO après merge backend | S |
| F-2 | Frontend : panneau Contributions | B-3, Penpot | NO-GO | M |
| — | Champs Analyse | OD-10 | NO-GO | M |

Chaque lot : passages QA et Security obligatoires, Compliance selon la GRC
Trigger Matrix. Migrations appliquées par `migrate.yml` après approbation
HUMAN, jamais par un agent.

## F. Findings et risques

- **F-1 (sécurité, famille SEC-013/014)** — `assignOwner` sous `risk.update`
  sans interdiction de l'auto-désignation (`RiskService.ts:165-174`). Après
  E-10, devenir owner donnera le droit exclusif de coter. **Vérifié par
  l'orchestrateur : les profils Contributeur de staging et de production
  (`aboubacar.ouattara@djamo.io`) détiennent `risk.update`.**
- **F-2 (données)** — E-10 rend inévaluables les risques sans owner ; les
  imports `RiskImportService` naissent sans owner (OD-8).
- **F-3 (tests)** — E-10 modifie deux fixtures existantes (à signaler à QA).
- **F-4 (trace périmée)** — gap (9) déjà fermé
  (`riskEvaluations.routes.ts:189-199`) ; gap (6) remplacé par la
  configuration (`RiskEvaluationService.ts:38-39`, `:586-595`).
- **F-5 (commentaires périmés)** — `RiskEvaluation.ts:106` (« Average » au
  lieu de MIN), `RiskEvaluationService.ts:235` (« x 7 impact axes »),
  `Config.ts:43-44`, `ProcessEvaluationModeRequest.ts:7` (cite `031` au lieu
  de `033`).
- **F-6 (duplication)** — parcours de chaîne de processus en deux exemplaires ;
  à extraire dans B-3 plutôt que d'en créer un troisième.
- **F-7 (Dispositif)** — si le Dispositif (gap 1) devient porteur du mode,
  la résolution changera de source ; les instantanés protègent l'historique.

**Information manquante** : la définition métier d'HYBRIDE.
