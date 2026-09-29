# Journal partagé — GRC Tools

Append-only. Chaque entrée : date, tag(s) d'agent(s) concerné(s),
décision, lien si pertinent. Le plus récent en bas. Voir README.md de
ce dossier pour l'usage.

---

**2026-09-27 — @security @dev-backend** — Revue de sécurité sur le code
déjà en production (avant les 3 batches de nouveaux modules) : 6
vulnérabilités réelles trouvées et corrigées (SEC-001 à SEC-008 partiel)
— maker-checker contournable sur ControlExecution, surcharge de champs
sensibles par le client sur Department/Execution, permissions héritées
`users.roles` jamais filtrées, suppression Google Drive définitive.
Commit `03065e9`. Suite de tests dédiée : `SecurityBoundaries.test.ts`
(16 tests, convention `it()`/`it.fails()`).

**2026-09-27 — @dev-backend @architect** — Batch 1 livré : KPI,
RiskAppetite, RatingScale. Convention établie (a posteriori, pas
validée par un vrai A05) : toute transition vers un état terminal
(désactiver/archiver) doit être gardée par sa propre permission
(`x.delete`), jamais par `x.update` générique. PR #1, mergée.

**2026-09-27 — @architect @dev-backend** — Isolation en worktree Git
adoptée comme mode par défaut pour tout agent A06 dispatché en parallèle
d'un autre, à partir du batch 2 — élimine le risque de collision sur
`server.ts`/`permissions.ts` observé en théorie sur le batch 1.

**2026-09-27 — @ux-designer** — Audit des 4 écrans existants
(Risk/Admin/Roles/Feedback) → `frontend/DESIGN_NOTES.md`. Recommandations
implémentées : design system (`Table`, `FormField`, `StatusBadge`,
`Button`, `Tabs`), correction d'un bug d'accessibilité réel (tabs
`disabled` → `aria-current`). PR #3, mergée. **Aucune charte graphique
Djamo statuée** — direction neutre proposée à titre provisoire.

**2026-09-27 — @dev-backend @qa-engineer** — Batch 2 livré :
UserManagement, RiskEvaluation, KRI. SEC-005 (2e partie) complété :
`GET /roles/users/:userId/permissions` expose le jeu de permissions
effectif d'un utilisateur. PR #2, mergée. **Aucune revue QA
indépendante n'a eu lieu** — seuls les tests écrits par l'agent A06 qui
a produit le code.

**2026-09-27 — @dev-backend** — Un agent (UserManagement) a reconstruit
`User`/`UserRepository` à partir de zéro alors qu'on lui avait dit qu'ils
existaient déjà — vrai sur une branche de l'orchestrateur non fusionnée
dans `main`, faux dans son propre worktree. Réconcilié à la fusion, sans
perte, mais travail dupliqué. Leçon : toujours vérifier
`git show <branche-cible>:<fichier>` avant de briefer "X existe déjà".

**2026-09-27 — @dev-backend** — Batch 3 livré : RiskOwnership,
ActionPlan, Cartography. `Risk.ownerId`/`superiorOwnerId` ajoutés
(RiskOwnership). Cartography construit en parallèle sans ces champs —
son filtre `ownerId` rejette explicitement plutôt que d'halluciner un
comportement (bon réflexe, à généraliser). PR #6, mergée.

**2026-09-27 — @risk-manager** — Point ouvert non traité : la
méthodologie de scoring (RatingScale : 7 axes, règle MAX, moyenne de
maîtrise ; RiskEvaluation : P×I, comparaison à l'appétence) a été
conçue et validée uniquement par des agents développeurs, jamais par un
expert du domaine risque. Voir `ACTION_ITEMS.md`.

**2026-09-27 — @orchestrator @documentation @architect @product-manager @qa-engineer @security @risk-manager @compliance @privacy @infrastructure @devops @release-manager @audit @dev-db @ux-designer @dev-backend** —
Mise en place du dispositif de mémoire inter-agents à la demande du
Product Owner : contexte partagé intra-projet (ce dossier) +
`~/.agentic-framework/agents/<role>/LEARNINGS.md` pour l'apprentissage
inter-projets. Directives permanentes par rôle consignées dans chaque
`LEARNINGS.md` (voir aussi `RETEX_MULTI_AGENTS.md` §8). À partir de
maintenant : A21 (documentation) reprend la main sur le RETEX, plus
d'édition directe par l'orchestrateur sauf cross-review.

**2026-09-27 — @dev-backend @dev-db @qa-engineer @security** —
Consigne permanente du Product Owner : tout agent qui écrit ou modifie
du code doit invoquer systématiquement le skill `ponytail` (solution la
plus simple qui fonctionne, jamais d'abstraction spéculative ni de
dépendance non nécessaire). Appliqué immédiatement aux 3 agents A06 en
cours (Dashboard+Reporting, Config, Notification+Governance) et aux
agents A08/A10 en cours pour tout test qu'ils ajoutent. Règle
permanente, valable sur ce projet et tous les suivants — voir
`CLAUDE.md` §Amorçage point 5bis.

**2026-09-27 — @architect @security** — Découverte structurelle : aucun
des 16 fichiers `.claude/agents/*.md` n'accordait l'outil `Skill` — un
agent QA a reçu une instruction ("invoque ponytail") et a correctement
refusé de fabriquer un appel d'outil inexistant, signalant le canal de
livraison inhabituel. Corrigé : `Skill` ajouté aux 16 agents (PR #10).

**2026-09-27 — @security @qa-engineer** — Round 2 (revue des 9 modules
batches 1-3) : QA a trouvé 10 findings (6 corrigés directement, dont la
validation croisée CONTROL/KRI d'ActionPlan jamais testée) ; Security a
trouvé 6 nouveaux findings (SEC-009 à SEC-014), dont deux régressions
exactes de règles du round 1 jamais écrites dans `CLAUDE.md` (seulement
en commentaire de test) — corrigé dans PR #11. Voir
`ACTION_ITEMS.md` pour le détail et la priorisation des correctifs
restants.

**2026-09-28 — @dev-backend @security** — SEC-009 (High) corrigé.
`KpiMeasureService.record`/`KriMeasureService.record` acceptaient
`recordedBy` depuis le body client au lieu de le forcer à
`actor.userId` — exact réintroduction de la classe SEC-001 sur des
enregistrements append-only. Correctif : signature `record()` changée
en `Omit<CreateKpiMeasureInput/CreateKriMeasureInput, "tenantId" |
"recordedBy">`, `recordedBy: actor.userId` codé en dur dans les deux
services ; le champ retiré des schémas Zod `CreateKriMeasureBody`/
`CreateKpiMeasureBody` (`kriMeasures.routes.ts`/`kpiMeasures.routes.ts`).
Grep de `recordedBy` sur tout `backend/src` confirme qu'aucun autre
appelant ne le passe encore depuis le client sur ces deux chemins. Les
2 tests `it.fails` du describe SEC-009 dans
`SecurityBoundaries.test.ts` sont passés en `it()` actif (regression
lock). `npm run typecheck` + `npm test` verts (34 fichiers, 366 tests).
Commit `11b236a`. **Prêt pour retest @security** — même branche
`main`, pas de PR séparée ouverte pour ce correctif ponctuel. SEC-010 à
SEC-014 restent hors scope, non touchés.

**2026-09-28 — @dev-backend @security** — SEC-010 (High) corrigé.
`UserService.create()` insérait la ligne `users` **avant** que
`RoleService.assignToUser` ne vérifie `role.assign` en aval : un acteur
avec `user.create` mais sans `role.assign` recevait bien un 403
(`ForbiddenError`), mais la ligne `users` avait déjà été écrite — compte
capable de se connecter (`server.ts` résout l'identité par email, sans
vérifier de rôle), jamais autorisé, sans aucun rôle attaché. Aucune
transaction cross-repository disponible dans ce repo (même limite déjà
documentée pour `DepartmentService.create`), donc pas de rollback
possible — la solution retenue (revue via skill `ponytail`, la plus
simple qui ferme le trou) est de vérifier `role.assign` explicitement en
tout début de `create()`, avant l'insert, en plus de la vérification
existante dans `RoleService.assignToUser` qui reste inchangée et seule
source de vérité sur cette permission en aval. Le test `it.fails`
SEC-010 de `SecurityBoundaries.test.ts` (describe "SEC-010 user
provisioning bypasses the role.assign gate") est passé en `it()` actif
sans modifier son corps — son assertion (ForbiddenError levé, aucun
insert dans `users`) correspondait déjà exactement au comportement
sécurisé obtenu. Grep de `UserService`/`admin` dans
`UserService.test.ts` : l'acteur `admin` de test possède déjà
`role.assign` dans son tableau `roles`, donc aucune régression sur les
tests existants (même piège que celui documenté pour SEC-003 sur
`DepartmentService.test.ts`, vérifié absent ici). `npm run typecheck` +
`npm test` verts (34 fichiers, 366 tests, dont les 23 de
`SecurityBoundaries.test.ts`). Commit `f0f7fdf`. **Prêt pour retest
@security** — même branche `main`, pas de PR séparée. SEC-011 à SEC-014
restent hors scope, non touchés.

**2026-09-28 — @dev-backend @security** — SEC-011 (Medium) corrigé.
Les trois setters de scoring de `RiskEvaluationService`
(`recordInherentScoring`, `recordMasteryAssessment`,
`recordResidualScoring`) n'exigeaient que `riskevaluation.update` et ne
vérifiaient jamais que l'acteur était bien le `evaluatorId` désigné sur
l'évaluation — seuls `validate()`/`reject()` comparaient `actor.userId`
à `evaluatorId`, mais trop tard : un tiers pouvait déjà avoir écrit
l'intégralité du contenu de scoring (y compris `appetiteOverride`, qui
détermine `appetiteExceeded`) sur un brouillon `BROUILLON` ouvert par
quelqu'un d'autre, tant que `evaluatorId` restait au nom du créateur —
le contrôle des quatre yeux (maker-checker) ne se déclenchait jamais.
Correctif retenu (revue via skill `ponytail`, solution la plus simple) :
nouvelle fonction privée `assertIsEvaluator(actor, evaluation)` qui
réutilise exactement la même comparaison `evaluatorId === actor.userId`
que `validate()`/`reject()` font déjà, appelée en amont — juste après
`assertMutable(before)` — dans les trois setters de scoring. Aucun
nouveau champ, aucun mécanisme de co-signature : uniquement le
déplacement du contrôle d'identité déjà existant, plus tôt dans le
flux. Le test `it.fails` SEC-011 de `SecurityBoundaries.test.ts`
(describe "SEC-011 RiskEvaluation scoring is not bound to the
evaluator") est passé en `it()` actif sans modifier son corps — son
assertion (ForbiddenError levé pour un tiers appelant
`recordResidualScoring` sur le brouillon d'un autre évaluateur)
correspondait déjà exactement au comportement sécurisé obtenu. Grep de
`RiskEvaluationService` dans `backend/test/` (`RiskEvaluationService.
test.ts`, `GovernanceService.test.ts`) : tous les appels existants aux
trois setters de scoring utilisent systématiquement le même acteur
évaluateur que celui posé à la création du brouillon — aucune
régression. `npm run typecheck` + `npm test` verts (34 fichiers, 366
tests, dont les 23 de `SecurityBoundaries.test.ts`). Commit `23d09e3`.
**Prêt pour retest @security** — même branche `main`, pas de PR séparée.
SEC-012 à SEC-014 restent hors scope, non touchés.

**2026-09-28 — @dev-backend @security** — SEC-012 (Medium) corrigé.
`ActionPlanService.create()` validait soigneusement `sourceId` via
`assertSourceExists` (Risk/Control/Kri dans le tenant de l'acteur) mais
prenait `responsibleUserId`/`departmentId` sur la foi du client — le
service n'avait ni `UserRepository` ni `DepartmentRepository` du tout.
Correctif (skill `ponytail`, pattern déjà utilisé pour
risks/controls/kris/anomalies/evidences dans ce même service, et par
`RiskService.assertActiveUser`/`assertDepartmentExists`) : deux
nouveaux paramètres de constructeur optionnels `users?: UserRepository`
et `departments?: DepartmentRepository` (ajoutés **après** `notifier`,
pas avant — `notifier` est déjà exercé positionnellement par plusieurs
tests de `ActionPlanService.test.ts`, l'insérer avant aurait décalé ces
tests silencieusement), plus deux méthodes privées
`assertActiveUser`/`assertDepartmentExists` appelées dans `create()`
juste après `assertSourceExists`. Aucune méthode `update()` générique
n'existe sur ce service (seulement `updateProgress`, qui ne touche pas
ces deux champs) donc `create()` est le seul point d'entrée à corriger.
`server.ts` câble désormais `userRepository`/`departmentRepository`
(instances déjà utilisées par `RiskService`, aucune nouvelle instance
créée) aux positions 9 et 10 du constructeur `ActionPlanService`. Le
test `it.fails` SEC-012 de `SecurityBoundaries.test.ts` (describe
"SEC-012 ActionPlan cross-entity reference validation") est passé en
`it()` actif **avec un ajustement nécessaire** (documenté dans la
consigne de dispatch) : la construction d'origine
(`new ActionPlanService(actions, inMemoryAuditRepository())`) laissait
`this.users` à `undefined`, donc la garde `if (!this.users) return;`
aurait fait passer le test sans jamais exercer le nouveau code — un
faux `UserRepository` (`getById` renvoie `null`, simulant l'absence
dans le tenant de l'acteur) a été ajouté à la position `users` (9e
argument, `risks`/`controls`/`kris`/`anomalies`/`evidences`/`notifier`
laissés `undefined`). Grep de `ActionPlanService` dans `backend/test/`
: seul `ActionPlanService.test.ts` (son propre `buildService`, inchangé
— ne passe jamais `users`/`departments`, donc validation no-op comme
avant, aucune régression) construit aussi ce service. `npm run
typecheck` + `npm test` verts (34 fichiers, 366 tests, dont les 23 de
`SecurityBoundaries.test.ts`). Commit `e623ec6`.
**Prêt pour retest @security** — même branche `main`, pas de PR
séparée. SEC-013/SEC-014 restent hors scope, non touchés.

**2026-09-28 — @dev-backend @security** — SEC-013 (Low) corrigé.
`RatingScaleService.activateVersion` appelle
`activateAndArchivePrevious`, qui pousse l'ancienne version ACTIVE vers
ARCHIVED de façon irréversible ("Cannot re-activate an archived rating
scale") — exactement le type de transition terminale que `disable()`
protège correctement avec `ratingscale.delete` + une raison
obligatoire, alors qu'`activateVersion` n'exigeait que
`ratingscale.update`. Même règle que documentée dans CLAUDE.md ("A
terminal/archived-state transition needs its own dedicated
permission, never the generic x.update") et déjà appliquée à
SEC-009/012. Correctif d'une seule ligne (skill `ponytail`) :
`requirePermission(actor, "ratingscale.delete")` au lieu de
`"ratingscale.update"`. Les deux permissions existaient déjà dans
`domain/permissions.ts` — aucune nouvelle permission, aucun changement
de route, aucune raison obligatoire ajoutée (le test SEC-013 n'en
passe pas, contrairement à `disable()`, donc pas de contrainte
supplémentaire à inventer). Le test `it.fails` SEC-013 de
`SecurityBoundaries.test.ts` (describe "SEC-013 rating scale terminal
transition via the update permission") est passé à `it` sans
modification du corps — son acteur (`["ratingscale.read",
"ratingscale.update"]`, sans `ratingscale.delete`) obtient désormais un
`ForbiddenError` avant tout appel à `activateAndArchivePrevious`. Grep
de `activateVersion` dans `backend/test/RatingScaleService.test.ts` :
tous les appels existants utilisent l'acteur du fichier
(`["ratingscale.read", "ratingscale.create", "ratingscale.update",
"ratingscale.delete"]`), qui a déjà `ratingscale.delete` — aucun
ajustement nécessaire, aucune régression. Grep frontend
(`frontend/src`) sur `ratingscale.update`/`activateVersion`/
`ratingscale.delete` : aucune correspondance, pas de bouton
"activer une version" gaté par une permission côté UI pour le moment
— rien à signaler à `@ux-designer` au-delà de cette absence. `npm run
typecheck` + `npm test` verts (366 tests, 34 fichiers, dont les 23 de
`SecurityBoundaries.test.ts`). Commit `88a5ede`.
**Prêt pour retest @security** — même branche `main`, pas de PR
séparée. SEC-014 reste hors scope, non touché.

**2026-09-28 — @dev-backend @security** — SEC-014 (Low, **dernier des 6
findings du round 2**) corrigé. `RiskAppetiteService.setThreshold`
acceptait `active` directement depuis le body (`active:
z.boolean().optional()` côté route) et l'upsertait tel quel, si bien
qu'un acteur avec seulement `riskappetite.update` pouvait poser
`active: false` et retirer un seuil de gouvernance — une transition
terminale exactement au sens de la règle CLAUDE.md ("A
terminal/archived-state transition needs its own dedicated permission"),
au même titre que `archive()` juste en dessous dans le même fichier, qui
exige lui `riskappetite.delete` + une raison obligatoire, mais sans
raison et audité comme un simple `UPDATE`. Correctif (skill `ponytail`,
garde d'une ligne) : `if (input.active === false)
requirePermission(actor, "riskappetite.delete")`, ajoutée juste après
la vérification existante `requirePermission(actor,
"riskappetite.update")` qui reste inchangée et toujours nécessaire pour
créer/modifier un seuil actif — garde additionnelle, pas un
remplacement. Aucune nouvelle permission créée (les deux existaient déjà
dans `domain/permissions.ts`), aucune exigence de "reason" ajoutée (le
test ne teste que le gate de permission). Le test `it.fails` SEC-014 de
`SecurityBoundaries.test.ts` (describe "SEC-014 risk appetite retired
via the update permission") est passé à `it` sans modification du
corps — **plus aucun `it.fails` dans tout le fichier**, les 6 findings
SEC-009 à SEC-014 sont maintenant chacun un regression lock actif. Grep
de `setThreshold` dans `RiskAppetiteService.test.ts` : l'acteur de test
(`actor`, utilisé notamment par le test "lists active thresholds..."
qui pose déjà `active: false`) possède déjà `riskappetite.delete` dans
ses rôles — aucun ajustement nécessaire, aucune régression. `npm run
typecheck` + `npm test` verts (366 tests, 34 fichiers). Commit
`1918b82`. **Prêt pour retest @security — sur l'ensemble de la série
SEC-009 à SEC-014, plus aucun correctif individuel restant côté dev.**
Point signalé à part, hors scope de ce fix : `list()` filtre `active =
true` (le seuil désactivé disparaît de la table de supervision
ACT-168) alors que `getBySubCategory()` ignore `active` et continuerait
de l'appliquer si une comparaison de risque résiduel l'utilisait un
jour — incohérence réelle mais non testée par SEC-014, à trancher par
`@security`/`@architect`, voir `ACTION_ITEMS.md`.

**2026-09-28 — @security** — Retest complet de la série SEC-009 à
SEC-014 effectué en tant que reviewer indépendant (pas l'agent qui a
écrit les fixes). Verdict pour chacun : **CONFIRMED_FIXED**, aucun
contournement trouvé.

- SEC-009 : fermé au niveau du type (`recordedBy` retiré de
  `Omit<CreateXMeasureInput, ...>` accepté par `record()`), pas
  seulement d'un test — le compilateur empêche désormais toute
  réintroduction accidentelle. Aucun autre point d'entrée n'écrit une
  mesure KPI/KRI.
- SEC-010 : `role.assign` vérifié avant l'insert `users`, en plus de la
  vérification déjà existante dans `RoleService.assignToUser` (gardée
  comme seule source de vérité). Aucun autre chemin de création
  d'utilisateur trouvé dans le repo.
- SEC-011 : `assertIsEvaluator` appelé dans les 3 setters de scoring.
  Vérifié que `create()` fixe déjà `evaluatorId: actor.userId` sans
  possibilité pour le client de désigner un autre évaluateur — pas de
  détournement possible via une réassignation.
- SEC-012 (le plus complexe) : lecture directe de `server.ts` — les
  vraies instances `PostgresUserRepository`/`PostgresDepartmentRepository`
  sont câblées (réutilisées, pas des stubs). Seul `ActionPlanService.create()`
  écrit `responsibleUserId`/`departmentId` ; aucune méthode de mise à
  jour ne les touche hors validation. Point de vigilance structurel
  documenté (pas un trou actif aujourd'hui) : le pattern
  `if (!this.users) return;` réintroduirait silencieusement SEC-012 si
  un futur point d'instanciation du service omettait ces dépendances —
  à surveiller à chaque nouveau call site.
- SEC-013/SEC-014 : permissions `.delete` correctement exigées avant
  la transition terminale ; un seul call site pour chaque méthode
  (`ratingScales.routes.ts`/`riskAppetite.routes.ts`), pas de route
  alternative qui contourne la garde.

Relecture des diffs de test (pas seulement du code) pour SEC-009 et
SEC-012 : aucun affaiblissement d'assertion — SEC-009 retire juste
`recordedBy` du literal d'input (le type ne l'accepte plus, l'assertion
`expect(recordedBy).toBe(actor.userId)` est inchangée) ; SEC-012 ajoute
un vrai faux `UserRepository` nécessaire pour exercer la garde
optionnelle, sans toucher à l'assertion `rejects.toThrow`.

Retest indépendant de la suite : `npm run typecheck && npm test`
relancés moi-même dans `backend/` (pas seulement les rapports
`@dev-backend`) — 34 fichiers, 367 tests verts.

**1 nouveau finding réel découvert** pendant la passe de recherche
ciblée sur les zones touchées (pas une revue complète du repo) : le
point signalé par `@dev-backend` dans le commit SEC-014
(`getBySubCategory()` ignore `active`) est confirmé exploitable — un
seuil d'appétence désactivé via `riskappetite.delete` (SEC-014)
continue d'être appliqué par `RiskEvaluationService.recordResidualScoring`/
`suggestAppetite`/`compareToAppetite`, qui lisent tous
`getBySubCategory()`. Vérifié aussi côté SQL
(`PostgresRiskAppetiteRepository.getBySubCategory` ne filtre que
`deleted_at IS NULL`). Tracké comme **SEC-015** (Medium — la
désactivation, qui nécessite désormais une permission élevée depuis
SEC-014, n'a aucun effet pratique). Test `it.fails` ajouté dans
`backend/test/SecurityBoundaries.test.ts` (describe "SEC-015 retired
risk appetite threshold is still applied to residual scoring"),
production code non touché — voir `ACTION_ITEMS.md` pour la tâche
`@dev-backend`. Commit local (pas de push) : voir historique git.

**2026-09-28 — @dev-backend @security** — SEC-015 (Medium, **dernier de
la série SEC-009..015 du round 2**) corrigé. `RiskEvaluationService`
traite désormais un seuil d'appétence `active === false` comme absent
(`suggested: null`) dans `recordResidualScoring` et `suggestAppetite`,
au lieu de continuer à l'appliquer au calcul de `appetiteExceeded`.
Correctif volontairement placé au niveau du service, pas du repository :
`RiskAppetiteRepository.getBySubCategory` (interface +
`PostgresRiskAppetiteRepository`) reste inchangé — il est aussi utilisé
par `RiskAppetiteService.setThreshold` pour retrouver un enregistrement
existant (actif ou non) et décider CREATE vs UPDATE lors de l'upsert ;
filtrer `active` dans le repository aurait cassé ce cas d'usage légitime
et forcé une mise à jour de tous les doubles de test qui implémentent
l'interface. Le test `it.fails` SEC-015 de `SecurityBoundaries.test.ts`
(describe "SEC-015 retired risk appetite threshold is still applied to
residual scoring") est passé à `it` sans modification du corps. Grep de
`getBySubCategory`/`riskAppetites` dans `RiskEvaluationService.test.ts` :
les 3 fixtures existantes qui exercent le calcul d'appétence utilisent
toutes `active: true` — aucune régression. `npm run typecheck` + `npm
test` verts (34 fichiers, 367 tests, plus aucun `it.fails` restant dans
`SecurityBoundaries.test.ts`). Commit `6179428`. Clôt, sous réserve du
retest @security, l'intégralité de la série SEC-009 à SEC-015 issue de
la revue round 2. **Prêt pour retest @security.**

**2026-09-28 — @security** — Retest final de SEC-015, clôture de la
série round 2. `git show 6179428` relu intégralement : le filtre
`appetite?.active !== false` est appliqué correctement aux deux sites
d'appel identifiés (`recordResidualScoring` ligne 317-319 et
`suggestAppetite` ligne 352-354 de `RiskEvaluationService.ts`). Grep
`getBySubCategory` sur tout `backend/src` : exactement 3 occurrences —
les 2 patchées plus `RiskAppetiteService.setThreshold` ligne 62,
confirmé volontairement non touché (nécessaire pour que `setThreshold`
retrouve un seuil désactivé et le réactive via `upsert` ; vérifié par
lecture directe que `before` ne sert qu'à distinguer CREATE/UPDATE pour
l'audit trail, jamais à décider si le seuil s'applique). `compareToAppetite`
(ligne 364) lit uniquement les champs déjà persistés sur l'évaluation
(`appetiteThresholdApplied`, `appetiteThresholdSuggested`,
`appetiteExceeded`) — aucun appel direct à `getBySubCategory`, donc hérite
automatiquement du correctif fait en amont, pas de fix supplémentaire
nécessaire. Diff de test relu (`SecurityBoundaries.test.ts`, describe
SEC-015) : seul `it.fails` → `it`, assertions inchangées (score 9 >
seuil retiré 5, doit donner `appetiteThresholdApplied`/`appetiteExceeded`
= `null`) — non affaiblies. `npm run typecheck && npm test` relancés
indépendamment par @security (pas repris du journal dev-backend) :
typecheck propre, 34 fichiers / 367 tests verts, plus aucun `it.fails`
dans `SecurityBoundaries.test.ts`. **VERDICT SEC-015 : CONFIRMED_FIXED.**

Balayage de cohérence d'ensemble sur les 7 fixes de la série (SEC-009 à
SEC-015) : rien de notable. Le pattern « transition terminale ⇒
permission `.delete` dédiée en plus de `.update` » est appliqué de façon
identique et intentionnelle entre SEC-013 (`ratingscale.delete` pour
`activateVersion`) et SEC-014 (`riskappetite.delete` pour la
désactivation d'un seuil) — même famille de risque, même remède, pas de
divergence à signaler. SEC-009 (fix au niveau du type plutôt que d'une
vérification d'autorisation) et SEC-011 (liaison à l'évaluateur) traitent
des familles de problèmes différentes de SEC-013/014/015 (autorisation
mal bornée vs contrôle d'intégrité/logique métier) et appellent
légitimement des remèdes différents — pas d'incohérence identifiée. Seul
point structurel déjà documenté et non bloquant : le garde-fou
`if (!this.users) return;` dans `ActionPlanService` (SEC-012)
réintroduirait silencieusement le trou si un futur point de construction
du service omettait les dépendances optionnelles — à surveiller à chaque
nouveau point d'instanciation, ce n'est pas un finding actif. Aucun
nouveau problème découvert pendant ce balayage final.

**SÉRIE SEC-009 → SEC-015 (revue round 2) : CLOSED.** Les 7 findings,
tous CONFIRMED_FIXED après retest indépendant : SEC-009 (`11b236a`),
SEC-010 (`f0f7fdf`), SEC-011 (`23d09e3`), SEC-012 (`e623ec6`), SEC-013
(`88a5ede`), SEC-014 (`1918b82`), SEC-015 (`6179428`). Rappel : `CLOSED`
au sens Security ne préjuge d'aucune décision Risk/Compliance/Privacy —
voir `security.md` §50.

---

**2026-09-28 — @ux-designer @product-manager @dev-frontend @architect** —
Point Figma/charte graphique (ouvert depuis le 27/09, RETEX §8.2)
traité. **Figma** : outils MCP `mcp__figma__get_figma_data`/
`download_figma_images` disponibles mais lecture seule, et surtout
**aucun fichier Figma (URL/fileKey) n'a été fourni** dans le repo ni
dans le contexte — impossible de "connecter le compte" sans un lien.
Point reformulé plutôt que clos par contournement : reste `Ouvert`,
mais la balle est côté Product Owner (fournir le lien de fichier),
plus rien à faire côté agent tant qu'aucun fileKey n'existe.
**Charte graphique** : statuée. Décision — garder les tokens de
`frontend/src/design-system/tokens.css` tels quels (palette neutre,
accent navire `#1F4B99`, sémantique de statut, échelle d'espacement :
déjà implémentés, déjà appliqués aux 4 écrans existants, aucune raison
de les jeter). Extension proposée, pas une révision : ajouter deux
rôles typographiques empruntés à l'identité déjà en place dans nos
propres artefacts de reporting (`status-dashboard.html` — Source
Serif 4 + IBM Plex Mono) — un serif éditorial réservé aux titres de
page/section (jamais au corps ni aux données), et une police mono à
chiffres tabulaires pour les scores/dates/identifiants. Le corps de
texte reste `system-ui` (raison DESIGN_NOTES.md inchangée : pas de
dépendance réseau pour la lecture courante). Objectif : cohérence
visuelle entre les artefacts de pilotage interne et le produit
lui-même, sans toucher aux couleurs, à l'espacement ni aux composants
déjà livrés (`Table`, `FormField`, `StatusBadge`, `Button`, `Tabs`).
Rien dans `frontend/src/**` n'a été modifié — proposition uniquement.
**Direction visuelle** — skill `taste__minimalist-ui` retenue (éditorial
sobre, monochrome chaud, pas de gradient/ombre lourde/emoji) plutôt que
les directions "high-end"/"brutalist"/"gpt-taste" — un outil GRC B2B
dense en données pour une fintech réglementée UEMOA a besoin de
crédibilité perçue et de lisibilité, pas d'un traitement flashy ; ce
choix confirme et prolonge l'austérité déjà actée en section 4 de
`DESIGN_NOTES.md`, jamais ne la contredit.
**Livrable** : maquette haute-fidélité de 2 écrans (RiskEvaluation —
cotation inhérent/maîtrise/résiduel + comparaison appétence +
maker-checker + validation Comité ; Cartography — heatmap P×I,
filtres, liste des risques en zone critique), avec coquille de
navigation latérale par domaine (recommandation section 4.3/5 de
DESIGN_NOTES.md, jamais implémentée) —
**https://claude.ai/artifact/JBwqMEpRi8FSQqb6dmZy57**.
**Priorisation des 20 modules sans frontend** (criticité métier, pas
ordre alphabétique — voir rapport complet pour le détail) : 1.
RiskEvaluation (coeur du dispositif, 11 actions, consommé par tout le
reste) 2. Cartography (backend prêt à 80 %, forte visibilité Comité,
meilleur ratio effort/impact) 3. Dashboard/Reporting (vue exécutive,
reporting réglementaire) 4. ActionPlan (boucle de remédiation) 5. KRI
(alertes déjà calculées côté backend, invisibles sans écran) 6.
Governance (dépend de 1-2) 7. RiskOwnership 8. RatingScale 9.
RiskAppetite 10. KPI 11. Notification 12. Config 13.
UserManagement/RBAC (déjà partiellement couverts par `AdminPage`).
Détail complet à donner à `@product-manager` pour arbitrage du prochain
batch — cette liste est une recommandation UX, pas une décision produit
(section 53 des principes ACF).

---

**2026-09-28 — @ux-designer @product-manager** — V2 de la maquette,
itération sur le retour explicite du Product Owner (pas une refonte) —
même lien : **https://claude.ai/artifact/JBwqMEpRi8FSQqb6dmZy57**
(Version 2). Quatre points traités :

1. **Thème clair engagé.** La V1 basculait en sombre selon
   `prefers-color-scheme` du navigateur (viewer en thème système sombre
   → l'artefact apparaissait sombre malgré une palette de base claire).
   V2 fixe une seule palette claire, sans variante sombre — choix
   délibéré et documenté dans le fichier (règle "single look" de la
   skill `artifact-design`), pas un oubli.
2. **Palette/typographie repensées pour évoquer l'IA.** Accent navire
   `#1F4B99` (froid, corporate) remplacé par une argile mesurée
   `#B5533A` sur fond crème chaud `#FAF8F3` et encre presque noire
   `#221F1A` (jamais de gris pur froid) — chaleur plutôt que froideur,
   dans l'esprit des outils IA actuels (Claude pris comme référence de
   ton, pas copié : pas de violet, pas de gradient, pas de pastiche
   littéral de la charte Anthropic). Trois rôles typographiques
   conservés de la V1 mais réaccordés : Source Serif 4 (titres,
   inchangé), **IBM Plex Sans** remplace `system-ui` pour le texte
   d'interface (humaniste, ni géométrique dur type Space Grotesk ni
   trop neutre type Inter — s'accorde en plus nativement avec IBM Plex
   Mono déjà utilisé pour les données), IBM Plex Mono conservé pour les
   valeurs tabulaires. Palette sémantique de statut (danger/warning/
   success/neutral) **inchangée** — conserver ces 4 couleurs distinctes
   de l'accent de marque est volontaire : dans un outil GRC, la
   sévérité d'un risque doit rester la lecture la plus fiable de
   l'écran, jamais concurrencée par la couleur de marque. Rien dans
   `frontend/src/design-system/tokens.css` n'a été touché — cette
   palette/typographie reste une proposition d'artefact, à porter dans
   les tokens réels seulement après validation PO explicite (point non
   demandé dans ce retour, à confirmer avant tout patch `frontend/`).
3. **Sélecteur d'échelle avec description contextuelle** (le retour le
   plus concret). Les champs « Probabilité résiduelle » / « Impact
   résiduel » de l'écran RiskEvaluation, de simples `<select>` en V1,
   sont maintenant un sélecteur de niveaux 1-5 (boutons) qui affiche
   immédiatement le libellé et la description du niveau choisi sous le
   sélecteur — jamais un chiffre nu. Principe reproduit très
   précisément de `apps-script-legacy/UI_Evaluation.html` (fonction
   `majLigne()` / `box.innerHTML`, lignes ~556-579 : sélection → boîte
   de lecture immédiate, avec tableau par dimension quand plusieurs
   axes existent) — l'habillage visuel (CSS plat, sans hiérarchie) n'a
   **pas** été repris, seule l'interaction l'a été, comme demandé.
   Composant fonctionnel dans l'artefact (JS vanilla inline, ~50
   lignes) : cliquer sur un niveau met à jour la boîte de description en
   direct, testable dans la page publiée elle-même.
4. **Figma** : statut inchangé, toujours pas de fichier fourni. Accès
   MCP confirmé lecture seule (`mcp__figma__get_figma_data` exige un
   `fileKey` — aucun n'existe dans le repo ni n'a été communiqué par le
   Product Owner ; aucun fileKey inventé). L'artefact HTML reste la
   source de vérité tant que ce lien n'arrive pas — voir
   `ACTION_ITEMS.md`, statut **non modifié** (toujours partiellement
   résolu, pas clos).

Navigation latérale par domaine de la V1 conservée telle quelle — rien
dans le retour PO ne la remettait en cause, et le nouveau thème clair
ne change rien à sa structure. Rien dans `frontend/src/**` n'a été
modifié.

---

**2026-09-28 — @ux-designer @product-manager** — V3 de la maquette,
itération explicite sur le retour du Product Owner : « ça commence à
venir, inspire-toi du site public réel du client
(https://www.djamo.com/en-ci) ». Toujours pas un redémarrage — même
lien : **https://claude.ai/artifact/JBwqMEpRi8FSQqb6dmZy57** (Version
3). Structure, navigation latérale par domaine et sélecteur d'échelle
1-5 façon Apps Script (V2) **inchangés** ; seuls palette, typographie
et formes des composants évoluent.

Données de marque Djamo fournies par l'orchestrateur, déjà extraites du
site public (pas re-scrapées ici) : accent CTA `rgb(42,63,255)` =
`#2A3FFF` (bleu indigo franc, non dilué), sections de contraste noir
quasi-pur alternées avec blocs de fond lavande pâle (~`#E4E0FB`), vert
secondaire (épargne), touches jaune-orangé décoratives, boutons pilule
à padding généreux, police de marque GT Walsheim Pro (Grilli Type,
payante, hors allowlist CDN Artifacts — non chargée).

**Synthèse ADN de marque → interface GRC dense** (ce qui est repris,
ce qui est écarté, et pourquoi — détail complet dans le changelog de
l'artefact lui-même, section « Ce qui a changé depuis la V2 ») :
- **Repris** : le bleu `#2A3FFF` devient l'unique accent de marque et
  d'action (boutons primaires, onglet actif, liens, focus du sélecteur
  d'échelle) — remplace l'argile `#B5533A` de la V2, qui était un choix
  « esprit IA » faute de charte connue, plus nécessaire maintenant que
  la vraie charte est identifiée. Surfaces de carte/panneau légèrement
  teintées lavande (`#F2EFFB`/`#EAE5F7`, dérivées de la palette
  périwinkle du site) au lieu d'un blanc/crème plat — écho direct au
  langage de surface Djamo, dilué pour rester lisible en tableau dense.
  Boutons entièrement pilule (`border-radius: 999px`, padding
  11px/22px, poids 500) — cohérent avec les CTA du site ; badges et
  filtres segmentés étaient déjà en pilule depuis la V2, inchangés.
  Radius des cartes légèrement augmenté (8px → 14px) pour des formes
  plus généreuses.
- **Écarté, avec raison** : pas de photo lifestyle (personnes
  souriantes) — un écran RiskEvaluation affiche une décision de
  gouvernance, pas une offre grand public ; pas d'accent vert
  « épargne » ni de touches jaune-orangé décoratives — ce sont des
  signaux marketing produit, et les introduire à côté du badge vert
  sémantique « Faible/OK » créerait une ambiguïté dangereuse dans un
  outil de cotation ; pas de sections à fond noir quasi-pur — la
  neutralité claire déjà actée en V1/V2 est conservée, un outil de
  travail quotidien consulté des heures ne doit pas fatiguer l'œil
  comme une page marketing consultée une fois ; pas de traits
  serpentins décoratifs — aucune place pour de l'illustration pure sur
  un écran de travail dense en données. La palette sémantique de statut
  (danger/warning/success/neutral, 4 couleurs) reste **inchangée** —
  elle code la sévérité d'un risque, jamais concurrencée par la couleur
  de marque, règle déjà posée en V2 et confirmée ici.
- **Typographie** : Source Serif 4 (V1/V2) remplacée par **Plus Jakarta
  Sans** (600/700/800) pour les titres — Google Font géométrique-
  humaniste à terminaisons arrondies, l'équivalent le plus proche dans
  l'esprit de GT Walsheim Pro sans la reproduire (elle-même hors
  allowlist CDN Artifacts et payante). IBM Plex Sans (corps
  d'interface) et IBM Plex Mono (données tabulaires) inchangés — trois
  rôles typographiques, comme en V1/V2, seul le rôle « titre » change
  de registre.

Rien dans `frontend/src/design-system/tokens.css` n'a été modifié —
cette palette/typo V3 reste une proposition d'artefact, comme la V2
avant elle ; le portage dans les tokens réels attend toujours une
validation PO explicite (même point ouvert qu'en V2, non résolu ici,
hors périmètre de ce retour). **Figma** : statut inchangé, toujours
aucun fileKey fourni ni inventé.

---

**2026-09-28 — @ux-designer @product-manager** — V4 de la maquette,
correction directe du retour du Product Owner sur la V3 : « je
m'attendais à être bluffé, je ne l'ai pas été ». Toujours pas un
redémarrage — même lien :
**https://claude.ai/artifact/JBwqMEpRi8FSQqb6dmZy57** (Version 4).
Structure, navigation par domaine, palette de marque Djamo `#2A3FFF`
et sélecteur d'échelle 1-5 issus de la V2/V3 **inchangés**. Quatre
points précis corrigés, un par un :

1. **Typographie des libellés de champ.** IBM Plex Mono était utilisée
   pour des libellés textuels ("Efficacité", "Inhérent", "Prob.", les
   en-têtes de colonne du tableau, les clés `dt` de l'identité du
   risque — "Département", "Propriétaire"…) alors qu'elle est pensée
   pour la donnée tabulaire/numérique. Plex Mono est désormais
   **strictement réservée aux valeurs numériques/tabulaires** (scores,
   dates, identifiants, cellules `td.num`, nombres de l'axe P×I) ; tous
   les libellés de champ passent en IBM Plex Sans, graisse 700, petites
   majuscules trackées (`letter-spacing:.03-.05em`). Un cas limite
   traité au passage : "Modérée" (niveau qualitatif d'efficacité de
   maîtrise) était à tort dans un `<b>` mono hérité du style des
   valeurs numériques voisines — isolé dans une classe `.word` dédiée,
   Plex Sans.
2. **Navigation latérale.** Entrées passées de `--ink-soft` (couleur
   diluée) à `--ink` plein, graisse 700, et chaque entrée reçoit un
   pictogramme SVG inline avant le libellé — un jeu d'icônes trait
   cohérent (24×24, `stroke-width:1.8`, arrondi), dessiné à la main
   pour chaque domaine (Cartographie, Évaluations, Appétence, Grilles
   de cotation, Contrôles, Exécutions, KRI, KPI, Plans d'action, Cycles
   de revue) — aucune police d'icônes externe, hors allowlist CDN des
   Artifacts de toute façon.
3. **Cartographie — contraste des zones et couleur des points.** Les
   bandes de criticité réutilisaient les teintes pastel des badges
   sémantiques (`--success-soft`/`--warning-soft`/`--danger-soft`),
   trop proches les unes des autres sur le fond lavande de la carte.
   Trois nouvelles variables dédiées à la heatmap
   (`--zone-safe`/`--zone-watch`/`--zone-crit`, plus saturées, chacune
   avec sa propre couleur de bordure) rendent la grille 5×5 nettement
   lisible. Les points de risque, qui portaient deux couleurs
   (encre pour l'inhérent, bleu de marque pour le résiduel — une
   confusion possible avec un codage de sévérité), passent à **une
   couleur unique pour tous les points** (le bleu de marque `--accent`)
   ; le point résiduel se distingue désormais uniquement par un anneau
   encre autour du même point, jamais par une teinte différente — la
   sévérité reste portée exclusivement par la zone de fond.
4. **Animation des graphiques.** Demandée en V2/V3, jamais honorée
   jusqu'ici — corrigée cette fois avec GSAP (CDN
   `cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js`, version
   épinglée, chargé avant le `<script>` inline qui l'utilise) : (i) les
   3 scores (inhérent/maîtrise/résiduel) comptent jusqu'à leur valeur à
   l'affichage (`gsap.fromTo` sur un objet numérique intermédiaire,
   `onUpdate` formate signe/décimales/suffixe) ; (ii) le curseur et le
   seuil de la barre d'appétence glissent/s'affichent en place ; (iii)
   les points de la heatmap apparaissent en fondu+échelle
   (`scale:0→1`, `back.out`) avec un léger décalage (`stagger:.035s`)
   entre eux ; (iv) la zone de détail du sélecteur d'échelle
   (`scale-box`) transitionne en douceur à chaque changement de niveau,
   y compris à l'affichage initial ; (v) les lignes du tableau des
   risques critiques s'annoncent en cascade rapide. Timing
   volontairement bref (250-900ms selon l'élément) pour rester sobre
   sur un dashboard dense, tout en étant réellement visible — pas un
   fade quasi imperceptible.

**Skills de design mobilisés, et ce qui en a été pris** (chargés et lus
en entier avant d'écrire le code, pas invoqués par réflexe) :
- `taste__high-end-visual-design` — pris : l'ombre de carte diffuse à
  deux couches (`--shadow-card`, `0 1px 2px` + `0 10px 28px -18px`,
  jamais un `box-shadow` lourd/gris générique) pour combler l'écart
  avec l'attente "bluffé" sans sortir du registre sobre déjà acté ; la
  logique de rythme/qualité d'exécution générale (cohérence des
  micro-détails : anneaux, tracking des libellés, contraste des
  bordures de zone). Explicitement écarté : le "Double-Bezel"
  (double-cadre imbriqué), les boutons "bouton-dans-bouton", les
  radius exagérés `rounded-[2rem]`, le glassmorphism/fond OLED — tout
  ce registre "hero SaaS premium" est hors sujet pour un tableau de
  bord GRC interne dense en données, et contredirait le minimalisme
  déjà validé en V1-V3.
- `taste__minimalist-ui` — pris : la discipline déjà en place depuis
  V1 (pas de gradient, pas d'ombre lourde, bordures 1px, palette
  monochrome tiède + touches pastel réservées au sens) est confirmée
  et prolongée aux nouvelles variables de zone heatmap (saturées mais
  toujours "muted pastel", pas de couleur primaire criarde). La
  section "Subtle Motion" de ce skill (fade `translateY(12px)`,
  `IntersectionObserver`, jamais `scroll` listener) a directement
  informé le calibrage des durées GSAP — rester dans un registre
  "présent mais jamais spectaculaire", cohérent avec l'esprit du skill
  même si son mécanisme (CSS `@keyframes`+observer) diffère de GSAP.
- `taste__gpt-taste` — pris **uniquement** les techniques de moteur
  d'animation transférables à un dashboard : le compteur numérique
  (`gsap.fromTo` sur un objet intermédiaire avec `onUpdate`), le
  fondu+échelle échelonné (`stagger`) pour une collection d'éléments
  similaires (points de heatmap, lignes de tableau), l'usage de
  `transform`/`opacity` exclusivement pour rester GPU-safe. **Écarté
  explicitement** : toute la structure de page (AIDA, nav "island"
  flottante, hero cinématique 2-3 lignes), le `ScrollTrigger`
  pinning/scrubbing/stacking, les bento grids "gapless" à densité
  visuelle forte, le ton "agence de landing page" — aucun de ces
  patterns n'a de sens sur un écran de travail interne consulté toute
  la journée, où la stabilité et la lisibilité priment sur le
  spectacle.

Rien dans `frontend/src/**` n'a été modifié — cette itération V4 reste
une proposition d'artefact, comme V1/V2/V3 avant elle ; le portage dans
les tokens réels attend toujours une validation PO explicite (point
ouvert non résolu ici, hors périmètre de ce retour). **Figma** : statut
inchangé, toujours aucun fileKey fourni ni inventé.

---

**2026-09-28 — @ux-designer @product-manager** — V5 de la maquette,
polish sur la V4 après le retour du Product Owner : « tu as monté le
niveau mais tu peux mieux faire ». Explicitement un ajustement, pas un
redémarrage — même lien :
**https://claude.ai/artifact/JBwqMEpRi8FSQqb6dmZy57** (Version 5).
Structure, navigation par domaine, palette de marque Djamo `#2A3FFF`,
sélecteur d'échelle 1-5 avec description contextuelle, pictogrammes
SVG de la nav bar et animations GSAP issus de la V2-V4 **inchangés**.
Trois points précis corrigés, chacun diagnostiqué en relisant le HTML
publié avant toute correction :

1. **Zones et boutons — langage Material Design.** Ajout d'un système
   d'élévation à 3 niveaux (`--elev-1/2/3`, tokens `box-shadow` repos/
   survol/actif) appliqué à `.btn` (tous les boutons) et à `.hm-cell.
   z-crit` (zone critique de la heatmap), en remplacement d'un aplat
   de couleur plat sans état d'interaction visible. Rayon des boutons
   ramené de la pilule (999px) à 10px (`--radius-btn`) — la pilule
   redevient l'exception réservée au bouton d'action primaire
   (`.btn-primary`), pas le traitement par défaut ; rayon des cellules
   de heatmap resserré de 8px à 6px pour préserver la surface utile
   sur une grille dense de 25 cellules. `:hover`/`:active` explicites
   (montée/tassement d'ombre + léger `translateY`), jamais un simple
   changement de teinte. Pas de ripple effect littéral, pas de palette
   Google — seulement la logique de profondeur par l'ombre.

2. **Typographie de 4 libellés/valeurs précis, diagnostic au cas par
   cas** (relu dans le HTML publié, pas supposé) :
   - **"Département"** (`.identity dt`) — la casse capitale trackée
     héritée de la V4 fonctionne pour un libellé seul au-dessus de son
     champ, mais ici, collée horizontalement à sa valeur sur la même
     ligne d'une grille `dt`/`dd` dense à .7rem, elle compresse la
     lecture. Fix : casse normale, poids 600 (au lieu de 700), taille
     remontée à .76rem, plus de `text-transform`/`letter-spacing`.
   - **"Maîtrise (L1/L2/L3)"** (`.score-cell .lbl`) — la casse capitale
     trackée reste justifiée ici (libellé seul, comme "Inhérent" /
     "Résiduel" que le PO n'a pas signalés), mais le `letter-spacing:
     .05em` écartèle les parenthèses et les slashs de façon inégale
     par rapport aux lettres. Fix ciblé : tracking réduit à `.02em`
     pour ce sélecteur uniquement, casse et poids conservés.
   - **"Prob. 4 · Impact 4"** (`.score-cell .pi b`) — les chiffres
     inline étaient en IBM Plex Mono au sein d'une phrase en Plex
     Sans ; la règle V4 ("Plex Mono réservée aux valeurs numériques/
     tabulaires") visait des valeurs autonomes (scores, dates,
     cellules de tableau), pas des chiffres insérés au fil d'une
     phrase courte — le changement de police cassait le rythme de
     lecture. Fix : ces chiffres repassent en Plex Sans, poids 600.
   - **"−35%"** (`.score-cell .result .val`) — contrairement aux
     trois cas ci-dessus, Plex Mono est ici légitime (valeur autonome
     affichée en grand, comme "16" et "10,4"). Fix : `letter-spacing:
     -.01em` ajouté à `.val` pour un rendu plus resserré, qui rattache
     mieux visuellement le signe moins aux chiffres — appliqué aux 3
     valeurs de la ligne de cotation pour rester cohérent, pas
     seulement à celle qui posait problème.

3. **Alignement vertical score / tags.** Bug localisé dans
   `.score-cell .result` : un grand chiffre (`.val`, 1.5rem, Plex
   Mono) et une pilule de statut (`.badge`, .72rem) partageaient
   `align-items:baseline`. La baseline d'un badge `inline-flex` est
   dérivée du texte de son propre contenu minuscule, pas d'un centre
   optique — alignée sur la baseline du grand chiffre, la pilule
   apparaissait décalée vers le bas par rapport à son centre visuel.
   Comparé mentalement `baseline` vs `center` avant de trancher :
   `center` est le bon choix car aucun des deux éléments n'est un
   texte de paragraphe courant (`baseline` se justifie entre lignes de
   texte de même nature). Fix : `align-items:center`. Vérifié en
   parallèle que `table.risk-list td` utilisait déjà
   `vertical-align:middle` — pas de second cas de désalignement
   score/tag dans le tableau des risques critiques.

Rien dans `frontend/src/**` n'a été modifié — cette itération V5 reste
une proposition d'artefact, comme V1-V4 avant elle ; le portage dans
les tokens réels attend toujours une validation PO explicite (point
ouvert non résolu ici, hors périmètre de ce retour). **Figma** : statut
inchangé, toujours aucun fileKey fourni ni inventé.

---

**2026-09-28 — @ux-designer @product-manager** — V6 de la maquette,
deux directives distinctes du Product Owner sur la V5, traitées
séparément. Même lien, pas un redémarrage :
**https://claude.ai/artifact/JBwqMEpRi8FSQqb6dmZy57** (Version 6).
Structure, navigation par domaine, palette de marque Djamo `#2A3FFF`,
sélecteur d'échelle, pictogrammes SVG de la nav bar et animations GSAP
issus de V2-V5 **inchangés**.

**Directive 1 — purge d'une police mal employée, partout, pas
seulement à l'endroit signalé.** Point de départ cité par le PO : « 38
risques affichés » (le compteur de résultats de la Cartographie, `span
class="count"` dans `.filters`). Localisé dans le HTML publié :
`.filters .count{font-family:var(--font-mono);…}` — IBM Plex Mono
posée sur une phrase-compteur, pas une valeur tabulaire autonome. Même
défaut de fond que « Prob. 4 · Impact 4 », déjà corrigé en V5 mais
alors traité comme un cas isolé, pas comme un principe appliqué à
l'ensemble de l'artefact — c'est précisément ce que le PO reproche
cette fois (« pas seulement à cet endroit précis »). Méthode : `grep
"font-family:var(--font-mono)"` sur l'intégralité du fichier (13
occurrences trouvées), chacune classée manuellement légitime
(valeur numérique/tabulaire/identifiant autonome) ou fautive
(texte-phrase). Sept occurrences fautives corrigées, en plus de
l'exemple cité :
- `.eyebrow` — "Direction visuelle V5 — UX Designer (A04)" (phrase).
- `.intro .changelog b` — "LES 3 CORRECTIONS V5…" (libellé textuel).
- `.intro .meta` — bande Thème/Typographie/Accent/Élévation/Animation
  (descriptions en mots, même quand elles citent une valeur comme
  `#2A3FFF`, toujours au fil d'une phrase).
- `.jump a` — liens d'ancre "Écran 1 — Évaluation du risque" (phrases).
- `.crumb` — fil d'Ariane. Cas le plus révélateur : l'écran
  Cartographie affiche "Risques / Cartographie", un fil d'Ariane sans
  aucun identifiant ni chiffre — la police mono n'y avait donc jamais
  eu de justification, même par accident. Fix : le fil d'Ariane
  repasse en Plex Sans ; sur l'écran RiskEvaluation, où le fil contient
  un vrai identifiant ("RE-0142"), celui-ci est isolé dans un
  `span.id` dédié qui reste en Mono (même logique que `td.num`) —
  seul le mot "Évaluations" qui l'accompagne passe en Sans.
- `.appetite-legend b` — "Seuil : 12", chiffre inséré dans une phrase
  courte ("Seuil : …"). Diagnostiqué comme rigoureusement le même cas
  que "Prob. 4 · Impact 4" (V5) : un chiffre au fil d'une phrase n'est
  pas une valeur tabulaire autonome, même si c'est bien un nombre —
  cette occurrence n'avait pas été vue en V5 car le signalement PO ne
  portait alors que sur un exemple précis, pas sur une recherche
  exhaustive.

Six occurrences vérifiées et laissées en Mono (légitimes) : `.val`
(scores affichés seuls, `.score-cell`), les boutons de l'échelle 1-5
(chiffre seul par bouton), les nombres d'axe de la heatmap (`.hm-axis-y
span`, `.hm-x span`), `td.num` (cellules tabulaires), et
`.frame-bar .path` (chemin d'URL simulé dans la fausse barre de
fenêtre — traité comme un identifiant technique, au même titre qu'une
adresse, pas comme une phrase). Un cas explicitement laissé de côté et
documenté comme tel : `.confirm-strip .ic`, le glyphe "!" seul — ni un
mot, ni une valeur numérique, donc hors du périmètre de la règle
Mono/Sans elle-même (pas un texte au sens de la règle). Résultat après
purge : IBM Plex Mono ne sert plus, dans tout l'artefact, qu'à des
valeurs numériques/tabulaires ou à des identifiants techniques
autonomes — jamais à un mot ni à un chiffre cité dans une phrase.

**Directive 2 — carte blanche créative, citation du PO : « essaie de
me surprendre… je veux voir ce que tu serais capable d'apporter de
nouveau ».** Trois apports UX réels ajoutés de ma propre initiative,
au-delà de la palette/typo/alignement déjà traités V1-V5, chacun avec
le raisonnement produit qui le justifie (pas seulement l'effet
visuel) :

1. **Prévisualisation au survol/focus d'une cellule de heatmap.**
   Constat : un point sur la heatmap 5×5 n'était identifiable que par
   devinette ou en cherchant, ligne par ligne, dans le tableau "Risques
   en zone critique" en dessous — qui ne couvre de toute façon que les
   4 risques en zone critique, pas les points en zone de vigilance ou
   maîtrisée. Un utilisateur qui explore la carte pour comprendre la
   distribution des risques n'avait aucun moyen de savoir *quel* risque
   se cache derrière un point sans quitter l'écran ou deviner. Fix :
   chaque cellule contenant au moins un point (`data-has-risk`,
   `tabindex="0"` pour l'accès clavier) déclenche au survol ou au focus
   une popover listant le(s) risque(s) de la cellule, leur nature
   (Inhérent/Résiduel, déduite de la classe `.residual` déjà existante
   — aucune donnée dupliquée) et la coordonnée Probabilité × Impact,
   calculée depuis la position de la cellule dans la grille (pas codée
   en dur). Détail de conception délibéré : le badge Inhérent/Résiduel
   utilise les couleurs `neutral`/`info`, jamais `danger`/`success` —
   ces deux dernières sont déjà réservées à la sévérité ailleurs dans
   l'écran (`badge danger` = Critique, `badge success` = Maîtrisé) ;
   les réutiliser ici pour coder autre chose (le type de score) aurait
   produit un faux signal — un point résiduel encore en zone critique
   affiché en vert aurait laissé croire, à tort, qu'il est maîtrisé.
   Fermeture au clavier (Échap), `Escape` géré globalement. Noms de
   risques : contenu représentatif du domaine Djamo (fraude
   onboarding, indisponibilité API mobile money, non-conformité KYC,
   dépendance fournisseur cloud, etc.), jamais de lorem ipsum ; les 4
   risques déjà nommés dans le tableau du bas réapparaissent dans leurs
   cellules de zone critique pour rester cohérent avec le reste de
   l'écran, et le risque RE-0142 (écran 1) a sciemment un point
   inhérent en zone critique et un point résiduel en zone de vigilance,
   pour illustrer visuellement l'effet de la maîtrise dans la
   heatmap elle-même. Limite assumée et documentée plutôt que cachée :
   le survol reste un mécanisme souris/clavier basique, sans lien
   `aria-describedby` dynamique vers le lecteur d'écran — acceptable
   pour une proposition d'artefact qui démontre un pattern
   d'interaction, mais à traiter comme un vrai correctif
   d'accessibilité si ce composant est un jour porté dans
   `frontend/src/**`.

2. **« Pourquoi ce score résiduel ? » — dérivation du calcul, pas
   seulement le résultat.** Constat : le score résiduel (10,4)
   s'affichait comme une donnée reçue, jamais comme quelque chose que
   l'utilisateur peut vérifier — exactement le point que la fiche agent
   UX Designer (section 33, "UX pour le Risk Manager") demande de
   traiter : *"L'interface doit faciliter l'analyse sans remplacer le
   jugement du Risk Manager"*. Un chiffre qu'on ne peut ni recalculer
   ni challenger sans sortir de l'écran affaiblit ce jugement au lieu
   de l'outiller. Fix : un lien `Pourquoi ce score résiduel ?` (état
   `aria-expanded`, fonctionne sans dépendance GSAP si le CDN échoue à
   charger) déplie une dérivation en 3 étapes — 16 (Prob. 4 × Impact 4,
   inhérent) × 0,65 (effet de la maîtrise, efficacité "Modérée" ≈
   −35 %) = 10,4 (résiduel) — avec une phrase de contexte. Les 3
   valeurs affichées seules (`.chip`) sont en Plex Mono, cohérent avec
   la règle typographique tout juste renforcée par la directive 1 :
   valeurs autonomes en Mono, texte d'accompagnement en Sans. Ceci
   n'invente pas une nouvelle mécanique de calcul : le calcul
   16 × 0,65 = 10,4 est celui déjà implicite dans les données
   affichées en V4/V5 (score inhérent 16, effet −35 %, résultat 10,4)
   — la nouveauté est de le rendre visible, pas de changer ce qui est
   calculé.

3. **Colonne "Tendance" dans le tableau des risques critiques.**
   Constat : le tableau n'affichait qu'un état instantané (inhérent,
   résiduel, statut) — aucune indication de trajectoire. Pour un écran
   consulté quotidiennement par un Risk Manager qui doit prioriser son
   attention parmi plusieurs dizaines de risques, savoir qu'un risque
   *s'aggrave* pèse au moins autant que savoir son niveau actuel : un
   score de 12,8 stable n'appelle pas la même urgence qu'un score de
   12,8 qui vient de bondir de 4 points. Fix : mini-courbe SVG (4
   points, tracé à la main, pas de librairie de graphiques) + delta
   signé depuis le cycle de revue précédent, coloré par sens
   (`--danger` en hausse = s'aggrave, `--success` en baisse =
   s'améliore, `--muted` stable) — jamais la couleur seule : le texte
   du delta ("+2,3", "−2,6") et la flèche (▲▼→) portent la même
   information, conformément à la règle déjà en place pour les
   badges de sévérité (section 32 de la fiche agent : *"Ne pas
   utiliser uniquement des couleurs"*). En-tête de colonne avec `title`
   explicatif natif plutôt qu'un tooltip supplémentaire — délibérément
   sobre, pour ne pas surcharger un tableau déjà dense.

Vérification post-écriture : relecture complète du HTML publié après
modification (balises, accolades JS, gestionnaires d'évènements) —
`explain-toggle`/`score-explain` fonctionnent sans GSAP si le CDN
échoue (dégradation progressive) ; le positionnement du tooltip de
heatmap est calculé après mesure du DOM (`offsetWidth`/`offsetHeight`)
pour ne jamais entrer en conflit avec le `transform` CSS de la classe
`.show` (piège identifié et corrigé avant publication, pas après). Rien
dans `frontend/src/**` n'a été modifié — cette itération V6 reste une
proposition d'artefact, comme V1-V5 avant elle ; le portage dans les
tokens réels attend toujours une validation PO explicite. **Figma** :
statut inchangé, toujours aucun fileKey fourni ni inventé.

---

## 2026-09-28 — @tous — Consultation générale : nouveau Cahier des charges GRC v0.1

Le Product Owner a échangé avec le client (Djamo) et produit un nouveau
cahier des charges qui élargit significativement la vision produit :
passage d'un outil de scoring de risques à une plateforme GRC/ERM
interconnectée (référentiel de risques catalogue/registre/évaluation
séparés, RACI, commentaires génériques, évidences transverses, module
Incidents entièrement nouveau, module Audit avec Findings/Recommandations,
moteur de méthodologie versionné, lignes de défense L1/L2/L3
configurables). Document copié dans le dépôt :
`docs/Cahier_des_charges_GRC_v0.1.md`.

Les 15 agents ACF (hors A02 orchestrateur) ont été consultés en parallèle
(lecture intégrale du document + de leur propre périmètre de code/rôle),
chacun a rendu un tableau `Prise de connaissance | Proposition |
Observation | Difficulté potentielle`. Synthèse complète publiée en
Artifact par l'orchestrateur (voir ACTION_ITEMS.md pour le lien).

Points de contradiction interne au cahier des charges relevés
indépendamment par plusieurs agents (à faire trancher par le Product
Owner/le client avant spécification détaillée) :
- **Vélocité/Persistance** : traitées comme dimensions de scoring du
  risque en §10.1, mais comme métriques calculées d'un incident en §32.2
  — deux natures d'objet différentes (Risk Manager A13).
- **Chaîne Finding→ActionPlan (§21) vs Constats→Recommandations→Plans
  d'action (§27)** : le parcours à 3 étapes n'a pas d'entité
  `recommendations` dans l'annexe §40 (Audit A23).
- **Dette silencieuse déjà présente dans le code** :
  `ActionPlanService.SOURCE_TYPES` accepte déjà `"INCIDENT"` et `"AUDIT"`
  en énumération sans qu'aucune entité `Incident`/`Finding` n'existe
  derrière (Product Manager A03, Dev Backend A06).

Prochaine étape : le Product Owner tranche la priorisation proposée par
A03 (voir tableau dédié dans l'Artifact) et les points d'arbitrage
signalés (§37 du cahier des charges + contradictions ci-dessus) avant le
premier dispatch de code sur ce chantier.

---

## 2026-09-28 — @tous — Arbitrage du Product Owner sur la consultation CDC GRC v0.1

Le Product Owner a validé la consultation multi-agents (15 rôles,
https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V) et donné des
directives par rôle, sans changer le fond des propositions — surtout des
raffinements et des garde-fous explicites. Points transverses actés,
valables pour tous les agents à partir de maintenant sur ce chantier :

1. **Ne pas confondre ordre de livraison et dépendances techniques** —
   des fondations peuvent devoir être *conçues* en amont même si elles
   sont *livrées* plus tard dans le séquencement (ex. le moteur transverse
   polymorphe doit être pensé dès le Lot 1 même s'il n'est exposé
   utilisateur qu'au Lot 6).
2. **5 distinctions structurantes à préserver strictement dans tout le
   modèle**, jamais fusionnées par raccourci d'implémentation :
   `Risk Catalog ≠ Risk ≠ Risk Assessment` · `Incident ≠ Anomaly ≠
   Finding` · `IAM ≠ RACI` · `Evidence ≠ Document` · `événements
   temporels (Occurrence/Detection/Resolution) ≠ métriques calculées
   (Velocity/Persistence)`.
3. **Ne pas repartir de zéro côté DB** — 26 migrations existent déjà,
   ~15 objets sur 35 cibles sont déjà présents sous une forme proche.
   Toute nouvelle table doit être justifiée par une Gap Analysis, pas
   supposée nécessaire par défaut.
4. **Expand/Contract obligatoire** : ajout non destructif → colonne
   nullable → backfill → validation → contrainte finale seulement quand
   les données sont prêtes. Aucun `DROP`/refonte destructive.
5. **Polymorphisme `object_type`/`object_id` avec whitelist maîtrisée**
   pour les capacités transverses (Comments/Evidence/RACI), déjà
   précédenté par `action_plans.source_type` — confirmé comme la bonne
   approche par le PO.
6. **Collision de numérotation de migration = vrai risque de processus**,
   pas un détail — attribution centralisée des numéros ou plages
   réservées, dépendances déclarées explicitement, migrations
   backward-compatible.

**Gate posé avant tout travail DB réel** (@product-manager) : produire 3
artefacts de référence — *GRC Target Domain Model*, *Database Gap
Analysis*, *Migration Plan / Migration Protocol* — pour faire converger
le cahier des charges, le modèle métier cible et la base existante avant
que les agents commencent les modifications de schéma. Dispatch en
cours, voir `.claude/agent-context/ACTION_ITEMS.md`.

**2026-09-28 — @architect** — Premier des 3 artefacts du gate livré :
`docs/architecture/GRC_Target_Domain_Model.md`. Répertorie les 31
entités déjà codées dans `backend/src/domain/entities/` + celles du
cahier des charges (statut EXISTANT / EXISTANT_À_ÉTENDRE / NOUVEAU),
préserve strictement les 5 distinctions imposées (`Risk Catalog ≠ Risk
≠ Risk Assessment`, `Incident ≠ Anomaly ≠ Finding`, `IAM ≠ RACI`,
`Evidence ≠ Document`, événements temporels ≠ métriques calculées), et
conçoit dès maintenant le moteur transverse polymorphe
(`RaciAssignment`, `Comment`/`CommentableObjectConfig`, `evidence_links`)
même s'il n'est exposé utilisateur qu'au Lot 6/7 — conformément à la
directive « ordre de livraison ≠ dépendances techniques ». Point de
vigilance signalé pour la Gap Analysis : `RiskAssessment` et
`RiskEvaluation` coexistent aujourd'hui avec des rôles qui se
chevauchent partiellement — lequel est le « Risk Assessment » cible du
cahier des charges §7.1.C n'est pas tranché dans ce document, décision
Architecture explicite à prendre en Gap Analysis. Comptage : 24
entités EXISTANT inchangées, 4 EXISTANT_À_ÉTENDRE (extensions
additives/nullables uniquement), ~12 NOUVEAU. Sert d'intrant direct à
la *Database Gap Analysis* à venir (@dev-db).

**2026-09-28 — @dev-db** — Derniers des 3 artefacts du gate livrés :
`docs/architecture/GRC_Database_Gap_Analysis.md` et
`docs/architecture/GRC_Migration_Plan.md`. **Le gate posé par le Product
Owner est désormais complet (3/3 artefacts).**

Point de vigilance prioritaire tranché par investigation de code
(entités + repositories + services + routes + `server.ts`, pas
seulement les entités TS) : `RiskAssessment` (`domain/entities/RiskAssessment.ts`,
`RiskAssessmentRepository`, table `risk_assessments` créée en
`003_risks.sql`) n'a **jamais** eu d'implémentation Postgres, de
service, de route ni de câblage `server.ts` — c'est du scaffolding mort
depuis l'origine. `RiskEvaluation` (`019_risk_evaluations.sql`, câblée,
testée, retestée en sécurité SEC-011/SEC-015) est la chaîne réellement
en production et couvre un sur-ensemble strict du besoin. Arbitrage
proposé : **`RiskEvaluation` devient le « Risk Assessment » cible du
cahier des charges §7.1.C ; `RiskAssessment` est DÉPRÉCIÉ** (table
conservée, aucun `DROP`, code marqué `@deprecated` en attendant
nettoyage) — suppression physique éventuelle **soumise à sign-off
Architecture/Product Owner explicite**, non tranchée unilatéralement
ici (`.claude/agents/dev-db.md` §1 : un agent Dev DB ne se déclare pas
lui-même autorisé sur une décision d'architecture).

Classification des ~40 entités du Domain Model confrontée aux 26
migrations réelles (dernier numéro : `026`) : 22 RÉUTILISER (aucun
changement de schéma), 4 ÉTENDRE (`Process.department_id`,
`Risk.risk_catalog_id`, `Control.sample_size`/`sample_size_rule`,
élargissement `action_plans.source_type`), 12 CRÉER (`RiskCatalog`,
`RaciAssignment`, `evidence_links`, `Comment`/`CommentableObjectConfig`,
`RiskCause`/`RiskCatalogCause`, `Document`/`document_links`, `Incident`,
`RiskIncident`, `ChecklistItem`/`ChecklistResult`, `AuditMission`,
`Finding`), 1 DÉPRÉCIER (`RiskAssessment`), 4 ARBITRER (le point
`RiskAssessment`/`RiskEvaluation` ci-dessus, FK `RiskCategory` depuis 3
tables encore en texte libre, création ou non de `risk_processes`,
confirmation `Kpi`/`Kri` non fusionnés en `Indicator` unique).

Migration Plan : confirme le format `NNN_description.sql` séquentiel
existant (pas d'horodatage — casserait le tri déjà exploité par
`npm run migrate`), fixe la règle anti-collision (relire
`ls database/postgresql/migrations/` avant toute écriture, jamais de
plage pré-réservée figée, `isolation: "worktree"` si plusieurs agents
DB en parallèle). Séquence de 17 migrations indicatives (`027` à `043`)
groupées en 7 lots alignés sur le séquencement déjà arbitré par
@product-manager (RACI minimal → Checklist contrôles → Incident →
Audit Findings → Référentiel → Commentaires → Gouvernance transverse),
chacune avec ses dépendances explicites et confirmation Expand/Contract
(nullable d'abord, aucune contrainte `NOT NULL`/`DROP` incluse). Règle
de rétrocompatibilité explicite (code N-1 doit continuer à fonctionner
avec chaque migration N appliquée). Rappel absolu : aucune opération
destructive dans ce plan, y compris pour `risk_assessments` (marquage
documentaire seulement, `043` optionnelle et conditionnée).

Aucun fichier de code de production touché, aucune migration réelle
écrite — ce sont des documents de planification. Prochaine étape logique :
sign-off Architecture/PO sur l'arbitrage `RiskAssessment`/`RiskEvaluation`
et sur les 3 autres points ARBITRER, puis dispatch réel des migrations
`027`+ par lot.

---

## 2026-09-28 — @architect @dev-db @product-manager — Arbitrage des 4 points ouverts de la Gap Analysis

Le Product Owner a tranché les 4 points laissés en `ARBITRER` par la
Database Gap Analysis (`docs/architecture/GRC_Database_Gap_Analysis.md`,
commit `96b7949`) :

1. **RiskAssessment / RiskEvaluation** — Confirmé : `RiskEvaluation` reste
   l'implémentation technique unique. « Risk Assessment » est le concept
   métier du cahier des charges, pas une seconde entité parallèle.
   `RiskAssessment` (scaffolding mort) reste déprécié tel que proposé,
   étendu pour porter le lien au catalogue.
2. **RiskCategory** — Créer une table canonique `risk_categories` et
   migrer progressivement les 3 références texte libre vers une FK
   (Expand/Contract complet : référentiel → FK nullable → backfill →
   contrôle → bascule applicative → dépréciation du texte, jamais de
   `DROP` immédiat).
3. **risk_processes** — Ne PAS créer cette table pour le lot initial.
   `risks.process_id` (existant, relation 1:1) suffit — un risque du
   registre est rattaché à un processus principal. Réévaluable plus tard
   si un besoin N:N réel est confirmé, sans remettre en cause le
   catalogue.
4. **KPI / KRI** — **Revirement par rapport à l'hypothèse par défaut de
   la Gap Analysis** : restent deux types métier distincts, mais
   fusionnés en un seul modèle physique `indicators` (discriminant
   `indicator_type = KPI | KRI`) plutôt que deux tables séparées comme
   aujourd'hui (`kpis`/`kris`). Le KRI porte une logique de seuil/risque
   que le KPI n'a pas — à préserver dans le modèle unifié (colonnes
   optionnelles ou sous-structure spécifique au type).

**Impact à traiter** : le point 4 change la classification Gap Analysis
de Kpi/Kri (de `RÉUTILISER` vers une consolidation non destructive de 2
tables déjà en production vers 1) et doit suivre la même logique que la
dépréciation de `RiskAssessment` : création de la table unifiée,
backfill depuis `kpis`/`kris`/`kpi_measures`/`kri_measures`, période de
coexistence, dépréciation des anciennes tables seulement après
validation — jamais un `DROP` direct. Les 3 documents de référence
doivent être mis à jour en conséquence avant que la séquence de
migrations ne soit considérée figée.

---

## 2026-09-28 — @architect — GRC Target Domain Model mis à jour suite à l'arbitrage du Product Owner

`docs/architecture/GRC_Target_Domain_Model.md` révisé pour intégrer les
4 décisions du Product Owner ci-dessus (entrée précédente). Sections
modifiées :

1. **§0.1 (distinction 1)** et **§5.1/§5.2** — l'ambiguïté
   `RiskAssessment`/`RiskEvaluation` est levée explicitement :
   `RiskEvaluation` est désormais documentée comme l'**unique**
   implémentation technique du concept métier « Risk Assessment »
   (cahier des charges §7.1.C) ; `RiskAssessment` (l'entité technique)
   reste EXISTANT/DÉPRÉCIÉ, jamais réactivée ni fusionnée.
2. **§4.1, §4.5, §5.2, §5.4** — `RiskCategory` confirmée canonique ; 3 FK
   nullables proposées (`RiskCatalog.riskCategoryId`,
   `RiskAppetite.riskCategoryId`, `RiskEvaluation.riskCategoryId`), les
   3 champs texte libre correspondants restant en place jusqu'à bascule
   actée (Expand/Contract).
3. **§4.2** — `risk_processes` documentée comme **non créée** pour ce
   lot, décision explicite (pas un oubli) ; `Risk.process` (texte libre,
   1:1 conceptuel — pas une colonne `process_id` au sens strict du code
   actuel, précision apportée par cohérence avec `003_risks.sql`) reste
   la relation en place.
4. **§5.5** (remplace l'ancienne section `Kpi`/`Kri`), **§11** (diagramme
   texte), **§12** (synthèse chiffrée) — `Kpi`/`Kri` fusionnés en un
   modèle physique unique `Indicator` (table `indicators`, discriminant
   `indicatorType: "KPI" | "KRI"`) + `IndicatorMeasure` (table
   `indicator_measures`, remplace `KpiMeasure`/`KriMeasure`). Modélisation
   retenue : **colonnes optionnelles dans la même table** (pas de JSONB
   fourre-tout, pas de sous-table par type) — colonnes communes
   (`indicatorType`, `label`, `frequency`, `description`, `active`,
   audit trail) + colonnes spécifiques KPI (`targetValue`, `unit`,
   `owner`, `departmentId`/`processId`) + colonnes spécifiques KRI
   (`thresholdGreen/Orange/Red`, `formula`, `riskId` obligatoire,
   `entity`, `methodologyVersion`), toutes nullables et contraintes par
   un `CHECK` conditionné à `indicatorType`. Les deux fonctions de calcul
   de statut (`computeKpiStatus`/`computeKriStatus`) restent deux
   fonctions pures distinctes, sélectionnées à la lecture — la fusion du
   stockage ne fusionne pas la logique métier, les deux types restent
   fonctionnellement distincts comme le Product Owner l'a exigé.

**Aucun fichier de code de production touché** — uniquement le document
d'architecture. Commit : voir historique git (message dédié).

**Sert d'intrant à** : la mise à jour de
`docs/architecture/GRC_Database_Gap_Analysis.md` par @dev-db, qui doit
reclasser `Kpi`/`Kri` (sortie de `RÉUTILISER`), ajouter les 3 FK
`RiskCategory`, confirmer `RiskAssessment` DÉPRÉCIÉ sans ambiguïté
terminologique, et retirer `risk_processes` de la liste `ARBITRER` (déjà
tranchée négativement pour ce lot) — ainsi qu'à la mise à jour du
Migration Plan qui en découle (séquencement Expand/Contract détaillé,
notamment pour la consolidation `Indicator`, la plus structurante des 4
décisions).

---

## 2026-09-28 — @dev-db — Gap Analysis et Migration Plan alignés sur les 4 décisions du Product Owner

`docs/architecture/GRC_Database_Gap_Analysis.md` et
`docs/architecture/GRC_Migration_Plan.md` révisés pour intégrer les 4
décisions du Product Owner (entrée « Arbitrage des 4 points ouverts de
la Gap Analysis » ci-dessus), répercutées côté Domain Model par
l'Architecte (`GRC_Target_Domain_Model.md`, commit `89c2be0`).

**Gap Analysis** :
1. **§1/§1.2** — `RiskAssessment` vs `RiskEvaluation` : ambiguïté
   résiduelle retirée, décision confirmée sans réserve (a), suppression
   physique de `risk_assessments` toujours soumise à sign-off ultérieur
   distinct.
2. **§2.3** — `RiskCategory` : passe de `RÉUTILISER` (usage en FK
   compris) à confirmé canonique + **`CRÉER`** pour l'usage en FK
   tranché (3 FK nullables depuis `RiskCatalog`, `RiskAppetite`,
   `RiskEvaluation`).
3. **§2.3** — `risk_processes` : passe d'`ARBITRER` à une entrée
   explicite « non créée pour ce lot, décision documentée et
   réversible » — trace conservée, pas de suppression du sujet.
4. **§2.4/§2.4bis (nouvelle section)** — `Kpi`/`Kri`/`KpiMeasure`/
   `KriMeasure`/`kri_risks` : reclassés de `RÉUTILISER` vers une
   nouvelle catégorie **`CONSOLIDER`**, créée spécifiquement pour ce
   changement car ni `RÉUTILISER` ni `CRÉER` ne rendaient compte
   honnêtement d'une fusion non destructive de deux tables déjà en
   production. Détaille `indicators`/`indicator_measures`/
   `indicator_risks`, le backfill applicatif requis, la période de
   coexistence (double-écriture ou vue de compatibilité) et la
   confirmation qu'aucun `DROP` n'intervient dans ce lot.
5. **§2.5** — les 4 lignes `ARBITRER` deviennent une section « Points
   tranchés » historique (0 point encore ouvert), conservée pour la
   traçabilité plutôt que supprimée.
6. **§3** — synthèse quantitative recalculée : RÉUTILISER 22→15,
   ÉTENDRE 4→6 (`RiskEvaluation`, `RiskAppetite` gagnent la FK
   `RiskCategory`), nouvelle catégorie CONSOLIDER = 1 regroupement,
   ARBITRER 4→0.

**Migration Plan** :
1. **Lot E** — migrations `038`/`039` ajoutées (`risk_appetites.risk_category_id`,
   `risk_evaluations.risk_category_id`, nullables), plus les étapes non
   numérotées backfill applicatif / contrôle / dépréciation
   documentaire du texte libre — Expand/Contract complet, aucune
   `NOT NULL` posée dans ce lot.
2. **`risk_processes`** : aucune migration n'a jamais été proposée pour
   cette table dans ce plan (cohérent avec la Gap Analysis initiale) —
   confirmé explicitement différé, rien à retirer.
3. **Nouveau Lot H** — remplace l'absence de migration Kpi/Kri du plan
   initial (la Gap Analysis v1 classait `Kpi`/`Kri` `RÉUTILISER`, donc
   aucune migration n'était prévue) par une séquence en 4 étapes :
   (a) `046`-`048` `CREATE TABLE indicators`/`indicator_measures`/
   `indicator_risks` (Expand) ; (b) backfill applicatif non numéroté,
   explicitement pas du SQL brut en masse, même pattern que le backfill
   `risk_catalog_id` (`037`) ; (c) période de coexistence
   (double-écriture ou lecture croisée), non numérotée, requise avant
   toute dépréciation ; (d) `049` dépréciation documentaire optionnelle
   (`COMMENT ON TABLE`) de `kpis`/`kris`/`kpi_measures`/`kri_measures`,
   conditionnée à un sign-off explicite — **aucun `DROP` dans ce lot**,
   suppression physique hors périmètre.
4. **Renumérotation** : `038`→`049` reconfirmés après relecture réelle
   de `database/postgresql/migrations/` (dernier numéro appliqué
   toujours `026` au moment de cette révision — aucune migration n'a été
   appliquée entre-temps, donc la base indicative `027` reste valide).
   Tous les numéros restent **indicatifs**, à reconfirmer au moment réel
   de l'écriture (protocole §1.2, inchangé).

**Aucun fichier de code de production touché, aucune migration SQL
réelle écrite** — documents de planification uniquement, conforme au
périmètre `.claude/agents/dev-db.md`.

**État du chantier** : les 3 documents de référence du gate
(`GRC_Target_Domain_Model.md` commit `89c2be0`,
`GRC_Database_Gap_Analysis.md` et `GRC_Migration_Plan.md`, ce commit)
sont désormais **alignés sur les 4 décisions du Product Owner du
2026-09-28**. Aucun point ouvert ne subsiste dans ces 3 documents. Le
chantier est **prêt pour le démarrage du Lot 1 (RACI minimal)** — voir
`GRC_Migration_Plan.md` §2 Lot A (`027_raci_assignments.sql`, numéro à
reconfirmer au moment réel de l'écriture, protocole §1.2).

---

## 2026-09-28 — @documentation — ADR-002 publié : modèle GRC cible

`docs/architecture/ADR-002-modele-grc-cible.md` créé, canevas et niveau
de rigueur identiques à `ADR-001-cible-architecture.md`. Referme la
recommandation restée sans suite depuis la consultation initiale des 15
agents : un ADR dédié aux arbitrages structurants du nouveau cahier des
charges GRC, à écrire avant tout travail DB réel — le Lot 1 (RACI
minimal) démarre en parallèle de cette tâche.

Contenu : Contexte (passage scoring de risques → plateforme GRC/ERM) ;
Décision 1 (séparation Catalogue/Registre/Évaluation —
`RiskCatalog`/`Risk`/`RiskEvaluation`, `RiskAssessment` déprécié) ;
Décision 2 (moteur transverse polymorphe `objectType`/`objectId` pour
Comments/RACI/Evidence, précédenté par `ActionPlan.sourceType`, injecté
en paramètre optionnel de constructeur) ; Décision 3 (consolidation
KPI/KRI en `Indicator`/`IndicatorMeasure`, revirement du Product Owner
par rapport à l'hypothèse par défaut de la Gap Analysis, stratégie
Expand → Migrate → Switch → Contract, jamais de `DROP`) ; Décision 4
(`RiskCategory` canonique, 3 FK nullables) ; Décision 5 (`risk_processes`
non créée pour ce lot) ; Conséquences (vocabulaire à respecter,
généralisation du pattern polymorphe et de l'injection optionnelle,
aucune refonte destructive, point de vigilance sur le pattern
`if (!this.x) return;` qui peut réintroduire un trou de validation
silencieux — déjà vécu avec SEC-012) ; Alternatives écartées (table par
objet pour les commentaires, statu quo Kpi/Kri, fusion
RiskAssessment/RiskEvaluation, suppression physique immédiate,
`risk_processes` immédiate, moteur de workflow générique).

Ne duplique pas le contenu technique des 3 documents de référence
(`GRC_Target_Domain_Model.md`, `GRC_Database_Gap_Analysis.md`,
`GRC_Migration_Plan.md`) — renvoie vers eux par lien relatif à chaque
décision. Aucun fichier de code ni les 3 documents de référence
existants n'ont été modifiés.

**Sert d'intrant à** : le Lot 1 (RACI minimal) en cours et tous les lots
suivants du Migration Plan (B à H), qui peuvent désormais s'y référer
pour le « pourquoi » des 5 arbitrages plutôt que rouvrir le débat.

**2026-09-28 — @dev-backend @security** — Lot 1 (RACI minimal, RaciAssignment
sur Risk/Control/ActionPlan) livré. Tranche verticale complète :
`domain/entities/RaciAssignment.ts` (entityType union TS stricte
`"Risk"|"Control"|"ActionPlan"`, createdBy forcé serveur, soft-delete
`deletedAt`), `RaciAssignmentRepository` + `PostgresRaciAssignmentRepository`,
`RaciAssignmentService` (permissions dédiées `raci.assign`/`raci.revoke`/
`raci.read`, jamais génériques), `api/v1/raci.routes.ts` monté sous
`/api/v1/raci`, migration `027_raci_assignments.sql` (numéro confirmé par
relecture réelle du dossier — dernière migration réelle 026_governance.sql,
pas celui indicatif du Migration Plan qui listait aussi 027 mais avec des
noms de colonnes différents, voir note ci-dessous). Résolution de l'entité
cible AVANT tout write via `risks?`/`controls?`/`actionPlans?` injectés en
paramètre optionnel de constructeur (pattern ActionPlanService), jamais de
confiance aveugle sur `entityId`. Garde-fou Security appliqué et documenté
explicitement dans le code : `assertNoSelfAccountableConflict` bloque
l'auto-désignation comme "A" (Accountable) quand l'acteur détient déjà "R"
(Responsible) sur la même entité — analogue RACI de `assertIsEvaluator`
(RiskEvaluationService). Testé (`RaciAssignmentService.test.ts`, 8 tests,
happy path + le garde-fou explicitement + qu'un tiers reste libre
d'assigner "A" à quelqu'un d'autre). `npm run typecheck && npm test` :
375/375 verts (367 existants + 8 nouveaux).

Écart assumé vs `GRC_Migration_Plan.md` §Lot A : ce document nommait les
colonnes `object_type`/`object_id`/`assigned_by`/`assigned_at`/`revoked_at`
(append-only, jamais réactivable) ; le brief de dispatch de cette tâche
demandait explicitement `entity_type`/`entity_id`/`created_by`/`created_at`/
`deleted_at` (soft-delete), aligné sur la convention globale "soft-delete
only" de CLAUDE.md plutôt que sur le append-only strict décrit dans le
Migration Plan pour ce cas précis. Choix tranché en faveur du brief de
dispatch (plus récent, direct) — à signaler si le Migration Plan doit être
corrigé en conséquence pour rester source de vérité.

**Non fait dans ce commit, ouvert pour la suite du Lot 1** : RACI n'est PAS
encore câblé en lecture/écriture dans `RiskService`/`ControlService`/
`ActionPlanService` eux-mêmes (ex. pas de champ "accountable" affiché sur
une fiche Risk, pas de blocage d'action métier basé sur RACI) — ce commit
livre uniquement le module RACI autonome (CRUD + garde-fou), consultable
via `GET /api/v1/raci?entityType=...&entityId=...`. Câblage UI/consommation
croisée = itération suivante, hors périmètre annoncé pour cette tâche.
Aucune revue Security/QA indépendante n'a encore eu lieu sur ce lot.

---

**2026-09-28 — @ux-designer** — Composant RACI compact, prolongement de
la proposition faite en consultation multi-agents (artefact
`7kg7EefZbaqyiW7RzCje1V`) en un composant concret, dans la continuité
visuelle V1→V6 (`JBwqMEpRi8FSQqb6dmZy57`). Nouvel artefact indépendant,
pas un ajout à la maquette V6 : **https://claude.ai/artifact/UJS4hW9f21gJSgfxvi7h89**
(« Composant RACI »). Source : `.claude/agent-context/scratch/raci-component.html`.

**Ce que montre l'artefact.** Le composant en situation sur l'écran
RiskEvaluation RE-0142 (même risque que V6, « Retard de règlement
fournisseurs critiques »), dans le panneau latéral rétractable
Comments/RACI/Evidence déjà proposé en consultation (rail d'onglets à
droite du cadre, compteur par onglet, un seul panneau générique
jamais 3 blocs empilés). Onglet RACI ouvert par défaut : 4 groupes de
rôles (Réalisateurs/Accountable/Consultés/Informés), avatars empilés
avec chevauchement, débordement en « +N » sur le groupe Consultés (4
personnes, 3 affichées + 1), tooltip au survol/focus reprenant le
patron déjà posé pour la heatmap en V6 (`.hm-tooltip` → `.raci-tooltip`
ici). Interactions réelles (pas de simulation figée) : bouton
pointillé en fin de groupe ouvre une popover de personnes disponibles,
sélection anime l'ajout (GSAP `back.out`) ; survol d'un avatar en mode
édition fait apparaître un retrait rouge, clic anime la sortie (GSAP
scale-out) puis retire réellement la personne de l'état JS et
recalcule le compteur d'onglet. Un sélecteur « Peut modifier / Lecture
seule » en tête de panneau simule la permission `raci.assign`/
`raci.revoke` reçue du backend : en lecture seule, aucun bouton
d'ajout ni de retrait n'est rendu, une note explicite l'indique.

**Accountable visuellement distinct.** Avatar plus grand (36px contre
32px), anneau de la couleur d'accent Djamo `#2A3FFF` (au lieu de la
palette d'avatars à 6 teintes assourdies utilisée pour R/C/I, choisie
pour rester hors des couleurs sémantiques danger/warning/success déjà
réservées ailleurs dans le système), pastille « A » superposée. Le
rôle Accountable est en outre plafonné à une seule personne dans le
composant (bouton d'ajout masqué dès qu'un Accountable existe) —
traduction visuelle directe de la cardinalité recommandée au §2.2 du
modèle de données.

**Garde-fou anti-auto-validation — traduction visuelle en 3 points
liés, pas un seul badge isolé.** Utilisateur courant simulé : Fatou
Bamba, Accountable sur ce risque, évaluation « En attente Comité ».
(i) Petit point d'avertissement superposé sur son propre avatar dans
le groupe Accountable ; (ii) le tooltip à son survol ajoute une ligne
dédiée « Vous êtes Accountable — validation par un tiers requise » ;
(iii) le bouton primaire « Valider et transmettre au Comité » de la
carte Actions est désactivé avec une note explicative sous le bouton,
citant explicitement le même principe maker-checker que
`assertIsEvaluator` déjà protégé côté backend (relevé par Security en
consultation : « RACI avec auto-désignation Accountable = même classe
de faille »). Les trois éléments se recalculent en direct si
l'Accountable est retiré/changé via le composant lui-même — pas figés
en dur, dérivés de l'état RACI à chaque rendu.

**Écart mineur assumé avec le Lot 1 déjà livré.** Le composant utilise
le contrat conceptuel `{ userId, userName, role }` / `objectType`+
`objectId` donné dans la mission et dans `GRC_Target_Domain_Model.md`
§2.2 ; le commit Lot 1 réellement livré (entrée précédente de ce
journal) a tranché en faveur de `entityType`/`entityId`/`createdBy`/
`createdAt`/`deletedAt` (soft-delete, convention CLAUDE.md) plutôt que
`objectType`/`objectId`/`assignedBy`/`assignedAt`/`revokedAt`
(append-only). Purement une question de nommage de champs API/DB,
sans impact sur la forme du composant ci-dessus — à aligner par
Dev Frontend au moment du câblage réel plutôt que dans cet artefact de
proposition.

**Limite assumée.** Composant de démonstration en pur HTML/CSS/JS —
pas de lien `aria-describedby` dynamique du tooltip vers le lecteur
d'écran (même limite déjà documentée pour la heatmap en V6), et la
liste de candidats pour l'ajout est une liste statique, pas un champ
de recherche filtrant. À traiter comme un vrai correctif
d'accessibilité et une vraie recherche serveur si ce composant est un
jour porté dans `frontend/src/**`.

---

**2026-09-28 — @security** — Revue de sécurité indépendante du Lot 1
RACI minimal (commit `8cf9fa2`, non poussé), demandée par le Product
Owner avant tout câblage dans `RiskService`/`ControlService`/
`ActionPlanService` et avant l'écran frontend. Vérification point par
point de la règle posée par Security lors de la consultation CDC
initiale (garde anti-auto-désignation Accountable, tenant-scoping avant
tout write sur le moteur polymorphe) :

1. **Tenant isolation : CONFIRMED_SAFE.** `assign()`/`revoke()` résolvent
   l'entité cible via `assertEntityExists(actor.tenantId, ...)` et
   `raci.getById(actor.tenantId, ...)` **avant** tout write — pattern
   `EvidenceService` correctement répliqué. `server.ts` câble bien les
   3 vraies instances `riskRepository`/`controlRepository`/
   `actionPlanRepository` (pas des stubs) au constructeur de
   `RaciAssignmentService`. Point de vigilance déjà documenté ailleurs
   dans ce journal (SEC-012) et non nouveau : le pattern
   `if (entityType === "Risk" && this.risks)` dans
   `assertEntityExists` **ignore silencieusement** la validation si le
   repository optionnel n'est pas injecté — non exploitable aujourd'hui
   (server.ts injecte bien les 3), mais fragile si un futur point de
   construction (tests, refactor) omet ces paramètres. Pas un finding
   sur ce commit, juste rappelé pour vigilance au câblage RiskService/
   ControlService/ActionPlanService à venir.
2. **Garde anti-auto-désignation Accountable : FINDING réel — voir
   SEC-016 ci-dessous.**
3. **Permissions dédiées, défense en profondeur aux routes : CONFIRMED_SAFE
   (conforme à la convention du dépôt, pas une régression).** `raci.routes.ts`
   ne fait aucun contrôle de permission — mais aucune route de ce dépôt
   ne le fait (`grep requirePermission backend/src/api/v1/` : 0
   résultat), CLAUDE.md documente explicitement ce choix architectural
   (« api/v1/*.routes.ts → ... No business rules » vs
   « services/*Service.ts → ALL ... permission checks »). `raci.assign`/
   `raci.revoke`/`raci.read` sont bien dédiées, jamais substituées par
   une permission générique (`requirePermission(actor, "raci.assign")`
   etc., aucune référence à `risk.update`/`control.update`/
   `actionplan.update` dans `RaciAssignmentService`).
4. **Attribution forcée serveur (`createdBy`) : CONFIRMED_SAFE.**
   `AssignBody` (routes) n'expose aucun champ `createdBy`/`...By` ;
   `RaciAssignmentService.assign` force `createdBy: actor.userId` dans
   l'input passé au repository — jamais lu du body. Aucune régression
   de la classe SEC-001/SEC-009.
5. **Whitelist `entityType` en base : CONFIRMED_SAFE.**
   `027_raci_assignments.sql` : `entity_type text NOT NULL CHECK
   (entity_type IN ('Risk', 'Control', 'ActionPlan'))` — whitelist
   fermée, pas une colonne texte libre. Même mécanisme que
   `ActionPlan.sourceType`, conforme à ADR-002 Décision 2.
6. **`npm run typecheck && npm test` relancés indépendamment (pas
   repris du rapport dev-backend)** : typecheck propre, **35 fichiers /
   376 tests verts** (375 existants + 1 nouveau `it.fails` SEC-016).

**FINDING SEC-016 (Medium, CONFIRMED)** — `assertNoSelfAccountableConflict`
ne s'exécute que quand le rôle **entrant** est `"A"` et ne regarde
l'historique que dans ce sens (« l'acteur a-t-il déjà `R` ? »). Rien ne
se déclenche quand le rôle entrant est `"R"`. Un acteur qui s'auto-
désigne `A` en premier (autorisé — aucun `R` n'existe encore au moment
du check) puis s'auto-désigne `R` juste après sur la même entité
obtient exactement la combinaison R+A que le garde-fou prétend
empêcher, en inversant simplement l'ordre des deux appels `assign()`.
Bypass reproduit et confirmé par un test standalone hors suite avant
l'ajout du test officiel (voir méthode complète dans l'historique de
commande de cette session). Le rapport du dev-backend affirmait
bloquer « l'auto-désignation Accountable quand l'acteur détient déjà
Responsible » — exact, mais incomplet : le contrôle est asymétrique et
n'examine qu'un seul des deux ordres possibles. Plus largement, le
risque métier posé par Security en consultation (« RACI avec
auto-désignation Accountable = même classe de faille » qu'
`assertIsEvaluator`) est en réalité plus large que ce que ce garde-fou
couvre dans les deux sens : un Accountable qui ne détient jamais `R`
peut déjà s'auto-désigner librement aujourd'hui (documenté comme
volontaire dans le code du service — hors scope explicite du Lot 1),
et aucune étape de validation métier ne lit encore RACI pour y opposer
un vrai maker-checker (RACI n'est pas câblé dans RiskService/
ControlService/ActionPlanService dans ce commit). Ce point plus large
n'est pas un finding technique sur ce commit précis (rien à exploiter
tant que RACI ne gate aucune action), mais doit être explicitement
tranché par Risk Manager/Architect **avant** le câblage prévu.
Test `it.fails` ajouté : `backend/test/SecurityBoundaries.test.ts`,
describe « SEC-016 RACI self-Accountable guard bypassable via
assignment order ». Aucun code de production modifié (hors scope du
rôle Security). Commit local (pas de push) : voir historique git.
Voir `ACTION_ITEMS.md` pour le suivi.

**Verdict global Lot 1** : 5 points sur 6 CONFIRMED_SAFE, 1 finding réel
(SEC-016, Medium) sur le garde-fou anti-auto-désignation. **Le Lot 1
n'est pas prêt pour le câblage RiskService/ControlService/
ActionPlanService + écran frontend tant que SEC-016 n'est pas corrigé
et retesté par Security** — le câblage amplifierait directement
l'impact de ce garde-fou (c'est lui qui, une fois RACI consommé par une
vraie action métier, devient la seule protection contre l'auto-
validation).

---

**2026-09-28 — @dev-backend** — Correctif SEC-016 (retest indépendant
de Security sur le Lot 1 RACI, commit `21756e2`). Skill `ponytail`
invoqué avant tout écrit — solution retenue est le rung le plus bas qui
tient : ne pas coder deux branches symétriques `if role === "A" ...` /
`if role === "R" ...`, mais dériver le rôle opposé du couple R/A d'une
seule ligne (`otherRole = role === "A" ? "R" : role === "R" ? "A" :
null`) et réutiliser la même recherche `listForEntity` déjà en place —
même diff, une seule garde au lieu de deux.

**Cause racine.** `assertNoSelfAccountableConflict`
(`backend/src/services/RaciAssignmentService.ts`) sortait
immédiatement (`if (role !== "A" || targetUserId !== actingUserId)
return;`) dès que le rôle entrant n'était pas `"A"` — aucun chemin ne
vérifiait jamais « rôle entrant `R`, `A` déjà détenu ». D'où le bypass
exact décrit par Security : `A` d'abord (autorisé, rien à détecter),
puis `R` (jamais vérifié) → cumul R+A obtenu par simple inversion de
l'ordre des deux appels `assign()`.

**Correctif.** Méthode renommée `assertNoSelfRaConflict` (le nom
`...AccountableConflict` ne décrivait plus une garde bidirectionnelle).
Un seul garde symétrique : pour un rôle entrant `"R"` ou `"A"`, calcule
le rôle opposé du couple et rejette (`ForbiddenError`) si l'acteur
détient déjà cet autre rôle sur la même entité — même chemin de code
pour les deux sens, pas de duplication. Rôles `"C"`/`"I"` toujours hors
scope (`otherRole` vaut `null`, sortie immédiate). Message d'erreur mis
à jour pour ne plus présupposer un sens (« Cannot self-designate as
Responsible and Accountable on the same entity... »). Docstring de
classe et de méthode mises à jour en conséquence.

**Tests.** Le test `it.fails` SEC-016 ajouté par Security dans
`backend/test/SecurityBoundaries.test.ts` (describe « SEC-016 RACI
self-Accountable guard bypassable via assignment order ») est passé à
`it(...)` — aucune autre modification du test, il passe tel quel avec
le correctif. Vérification demandée de
`backend/test/RaciAssignmentService.test.ts` (grep
`assertNoSelfAccountableConflict`/comportement à sens unique) : aucun
test existant n'encodait l'asymétrie — les deux tests déjà présents
(« blocks self-designation as Accountable when the actor already holds
Responsible... » et « still allows a different actor to designate that
same user as Accountable ») restent corrects avec la version
bidirectionnelle, aucune régression à corriger.

**Vérification.** `npm run typecheck && npm test` dans `backend/` :
typecheck propre, **35 fichiers / 376 tests verts** (375 existants
inchangés + SEC-016 désormais actif et vert, plus aucun `it.fails`).
Aucun autre fichier touché hors du périmètre RACI (routes, repository,
migration, entité inchangés).

**Statut.** SEC-016 résolu côté `@dev-backend`. Commit local (pas de
push) : voir historique git. **En attente de retest indépendant
`@security`** avant de rouvrir le câblage RiskService/ControlService/
ActionPlanService + écran frontend annoncé comme bloqué par Security
ci-dessus. Voir `ACTION_ITEMS.md` pour le suivi.

---

**2026-09-28 — @security** — Retest indépendant de SEC-016 (correctif
`@dev-backend`, commit `3db536`), sur `RaciAssignmentService.ts` +
`SecurityBoundaries.test.ts` uniquement — pas une relecture du rapport
dev-backend, code retracé ligne par ligne par Security.

**Trace du code (`assertNoSelfRaConflict`).**
`if (targetUserId !== actingUserId) return;` (hors self-désignation,
sortie immédiate — cas tiers non concerné par cette règle) →
`otherRole = role === "A" ? "R" : role === "R" ? "A" : null` →
`if (!otherRole) return;` (rôles `C`/`I` hors scope, sortie immédiate)
→ recherche dans `listForEntity` d'une assignation existante
`actingUserId` + `otherRole` → `ForbiddenError` si trouvée.

* **Sens A puis R** : 1er appel `assign(self, ..., "A")` →
  `otherRole="R"`, aucune assignation existante → autorisé, crée `A`.
  2e appel `assign(self, ..., "R")` → `otherRole="A"`, l'assignation
  `A` créée au tour précédent est trouvée pour `actingUserId` →
  `ForbiddenError`. **Bloqué.**
* **Sens R puis A** (sens déjà couvert avant ce correctif) : même
  raisonnement symétrique par construction du ternaire — 1er `R`
  autorisé, 2e `A` trouve le `R` existant → `ForbiddenError`.
  **Toujours bloqué**, confirmé par re-lecture, pas de régression
  introduite par le renommage/la fusion des deux branches.
* **Les deux sens passent par le même chemin de code** (un seul
  `otherRole` calculé, pas deux branches `if role === ...`
  dupliquées) — pas de risque de divergence future entre les deux
  sens à corriger séparément.

**Cas légitimes non bloqués à tort (vérifiés par trace, pas seulement
par les tests existants).**
* Tiers désigne une autre personne R et une autre personne A (deux
  personnes différentes) : `targetUserId !== actingUserId` pour les
  deux appels → sortie immédiate à chaque fois, jamais de check —
  confirmé aussi par le test existant `RaciAssignmentService.test.ts`
  (« still allows a different actor to designate that same user as
  Accountable », L173-182) : un tiers peut même assigner `A` à un
  utilisateur qui détient déjà `R` — cas légitime volontairement non
  couvert par cette règle (seule l'auto-désignation est visée).
* Rôles `C`/`I` : `otherRole` vaut `null` dès que le rôle entrant est
  `C` ou `I` quel que soit l'historique de l'acteur sur l'entité —
  jamais bloqués par cette garde, conforme au périmètre annoncé.
* Un acteur qui détient déjà `C` ou `I` sur l'entité peut toujours
  s'auto-désigner ensuite `R` ou `A` sans être bloqué à tort — la
  recherche `existing.some(...role === otherRole)` ne matche que
  `otherRole` (`R` ou `A`), jamais `C`/`I`.

**Test `SEC-016` (`SecurityBoundaries.test.ts`, L1245-1271) : non
affaibli.** Diff confirmé strictement limité à `it.fails(` →
`it(` (retrait du seul marqueur de skip) — corps du test, assertion
`.rejects.toThrow(ForbiddenError)`, ordre des deux appels (`A` puis
`R`), acteur, entité et repositories in-memory tous inchangés
caractère pour caractère. Aucun affaiblissement, aucun relâchement de
l'assertion.

**`npm run typecheck && npm test` relancés indépendamment dans
`backend/`** (pas repris du rapport dev-backend) : typecheck propre,
**35 fichiers / 376 tests verts**, y compris `SecurityBoundaries.test.ts`
(25 tests) et `RaciAssignmentService.test.ts` (8 tests, dont les deux
tests de garde R+A pré-existants toujours verts sans modification).

**Verdict SEC-016 : CONFIRMED_FIXED.** Les deux sens (`A` puis `R`
et `R` puis `A`) sont désormais bloqués par un chemin de code unique ;
aucun des cas légitimes (tiers désignant deux personnes différentes,
rôles `C`/`I`) n'est bloqué à tort ; le test de régression n'a pas été
affaibli ; suite complète verte en retest indépendant.

**Verdict global Lot 1 (les 6 points de la revue du 2026-09-28 +
SEC-016)** : **6 points sur 6 désormais CONFIRMED_SAFE / CONFIRMED_FIXED.**
Point de vigilance non-bloquant rappelé une nouvelle fois pour le
câblage à venir (point 1 de la revue précédente, déjà noté SEC-012) :
`assertEntityExists` ignore silencieusement la validation d'existence
si un repository optionnel (`risks`/`controls`/`actionPlans`) n'est
pas injecté au constructeur — non exploitable aujourd'hui (`server.ts`
injecte bien les 3), mais à re-vérifier explicitement au moment du
câblage `RiskService`/`ControlService`/`ActionPlanService` (tout futur
point de construction du service, y compris en test, doit continuer
à fournir les 3 repositories). Rappel également du risque métier plus
large déjà signalé en consultation CDC (« RACI avec auto-désignation
Accountable = même classe de faille » qu'`assertIsEvaluator`) et non
traité par ce lot : RACI n'est câblé dans aucun flux d'approbation
métier aujourd'hui, donc `assertNoSelfRaConflict` — même désormais
correct dans les deux sens — reste la seule protection ; son
insuffisance deviendra un vrai risque métier exploitable seulement une
fois RACI consommé par RiskService/ControlService/ActionPlanService, à
retester à ce moment-là et non supposé acquis du seul fait de ce
correctif.

**Feu vert Security pour la suite** : le module RACI minimal du Lot 1
(entité, repository, service, routes, migration, garde SEC-016) est
prêt pour le câblage dans `RiskService`/`ControlService`/
`ActionPlanService` et l'écran frontend, sous réserve du point de
vigilance ci-dessus (repositories optionnels toujours injectés) et
d'un nouveau retest Security une fois RACI effectivement consommé par
une action métier (approbation/validation), puisque c'est à ce
moment-là que l'insuffisance plus large du modèle (Accountable seul,
sans `R`, jamais gaté) devient exploitable en pratique. Aucun code de
production modifié par `@security` (hors scope du rôle). Commit
`3db536` non repoussé (déjà local). Voir `ACTION_ITEMS.md` pour la
clôture de SEC-016.

**2026-09-28 — @qa-engineer** — **Revue QA indépendante du Lot 1 RACI**
(post-SEC-016, avant câblage `RiskService`/`ControlService`/
`ActionPlanService` + écran frontend), 7 points cas limites
inter-modules demandés par le Product Owner. Lecture complète de
`RaciAssignmentService.ts`, `RaciAssignment.ts`,
`RaciAssignmentService.test.ts`, `PostgresRaciAssignmentRepository.ts`,
`PostgresRiskRepository.ts`/`PostgresControlRepository.ts`/
`PostgresActionPlanRepository.ts` (pour vérifier `getById` côté
production, pas seulement les doubles in-memory), `server.ts` (wiring),
`backend/QA_REVIEW_BATCHES_1_3.md` (pattern QA-02/QA-07 de fuite
inter-tenant sur d'autres modules, pour vérifier la non-répétition).

**Verdict des 7 points — aucun bug réel trouvé, uniquement des trous de
couverture, tous comblés en `it()` (pas d'`it.fails()` cette fois) :**

1. **Entité inexistante** — OK, déjà correct et testé (`assign()` avec
   `entityId` absent → `ValidationError` via `assertEntityExists`).
2. **Entité soft-deleted** — OK, correct mais non testé explicitement.
   `PostgresRiskRepository.getById`/`PostgresControlRepository.getById`
   filtrent `deleted_at IS NULL` : un Risk/Control soft-deleted est
   invisible à `assertEntityExists`, donc traité comme inexistant
   (`ValidationError`), exactement le comportement souhaité. Note :
   `PostgresActionPlanRepository.getById` ne filtre **aucun**
   `deleted_at` — mais vérifié qu'`ActionPlan` n'a **aucune notion de
   soft-delete** dans ce dépôt (aucun champ `deletedAt`, aucune méthode
   `softDelete` sur l'entité ni le repository) : pas un trou, la
   question ne se pose simplement pas pour ce type d'entité aujourd'hui.
3. **Double `revoke()`** — OK, correct mais non testé. `getById` côté
   Postgres filtre déjà `deleted_at IS NULL` → 2e `revoke()` échoue dès
   `if (!before) throw new NotFoundError` ; côté double in-memory,
   `getById` ne filtre pas `deletedAt` (léger écart avec la prod) mais
   `remove()` rattrape via son propre check `existing.deletedAt` → même
   `NotFoundError` au final. Résultat identique en pratique, mais écart
   de fidélité du double in-memory noté pour vigilance future (pas un
   bug exploitable aujourd'hui, un seul point d'appel à `getById`).
4. **Cumul C+I / R+C par la même personne** — OK, confirmé non bloqué
   par erreur. `assertNoSelfRaConflict` calcule
   `otherRole = role === "A" ? "R" : role === "R" ? "A" : null` et sort
   immédiatement si `otherRole` est `null` — seul R+A est concerné,
   comme prévu et documenté dans le code.
5. **`list()` sur entité sans affectation** — OK, retourne `[]`
   proprement (`listForEntity` filtré tenant/type/id, jamais d'erreur).
6. **Fuite inter-tenant sur `revoke()`** — OK, pas de trou. `revoke()`
   appelle `this.raci.getById(actor.tenantId, assignmentId)` **avant**
   `remove()`, les deux scopés par `actor.tenantId` (confirmé aussi côté
   Postgres : `WHERE tenant_id = $1 AND id = $2`) — un acteur du tenant
   B qui devine un `assignmentId` du tenant A obtient `NotFoundError`,
   jamais l'affectation d'autrui, et ne peut pas la révoquer à sa place.
7. **Cohérence avec `QA_REVIEW_BATCHES_1_3.md`** — le même trou
   (« test tenant-scopé sur un seul tenant, jamais un vrai test à deux
   tenants sur un repository partagé », pattern QA-02/QA-07) **existait
   bien** sur le module RACI : aucun test à deux tenants n'existait
   avant cette revue. Comblé par un nouveau test avec un seul
   `RaciAssignmentRepository` in-memory partagé entre tenant-1 et
   tenant-2 (pas deux instances séparées) — la forme forte déjà
   recommandée dans le rapport batches 1-3.

**6 nouveaux tests ajoutés** dans `backend/test/RaciAssignmentService.test.ts`
(préfixés `QA-RACI:` dans leur titre, tous `it()` — comportement déjà
correct, seule la couverture manquait) : revoke() sur assignmentId
inexistant ; assign() sur Risk soft-deleted ; double revoke() ; cumul
C+I et R+C par la même personne ; `list()` sur entité jamais assignée ;
fuite inter-tenant (`list()` + `revoke()`) sur repository partagé.
Suite passée de 8 à **14 tests**, tous verts.

`npm run typecheck && npm test` relancés dans `backend/` : typecheck
propre, **35 fichiers / 382 tests verts** (376 existants + 6 nouveaux),
aucune régression.

**Feu vert QA pour la suite** : les 7 points inter-modules demandés
sont couverts, aucun défaut réel trouvé sur ce périmètre. `PASS` QA
uniquement — ne vaut pas approbation Security/Compliance/Privacy/Risk
(déjà données séparément pour ce lot, voir entrées `@security`
ci-dessus). Aucun code de production modifié par `@qa-engineer` (hors
scope du rôle) : le point 2 (fidélité du double in-memory sur
`getById`/`deletedAt`) et le point de vigilance déjà noté par
`@security` (repositories optionnels toujours injectés) restent des
points d'attention non bloquants, pas des findings. Commit local (pas
de push) : voir historique git.

---

**2026-09-28 — @orchestrator @ux-designer @product-manager** — Portage
de la charte Djamo dans `tokens.css` : go du PO, DECISION-001, et
correctif de processus

Après avoir testé l'écran RACI/RisksPage livré ce jour, le PO a
constaté que la charte n'était visuellement pas appliquée et a demandé
pourquoi, malgré son "go" déjà donné. Root cause identifiée : les 6
itérations `@ux-designer` de l'artefact
(**https://claude.ai/artifact/JBwqMEpRi8FSQqb6dmZy57**, V1→V6)
concluaient chacune « portage attend une validation PO explicite » —
mais cette conclusion n'a jamais été transformée en ligne trackable
dans `ACTION_ITEMS.md` avec un owner. Un "go" verbal ne pouvait donc se
rattacher à aucune décision identifiée, et le dispatch du Lot 1 RACI
frontend est parti sans revérifier ce point (violation de la propre
règle de `CLAUDE.md` § onboarding point 7, jamais appliquée ici).

**P0 identifié** : A02 Orchestrator (escalade + vérification
pré-dispatch), A03 Product Manager en second (Decision Log jamais
utilisé pour ce sujet). Règle ajoutée à `CLAUDE.md` (nouveau point
7bis) : toute conclusion "en attente PO/HUMAN" génère immédiatement une
ligne `ACTION_ITEMS.md` ; tout "go" verbal se journalise comme entrée
de Decision Log (`ACTION_ITEMS.md`, nouvelle section, format
`product-manager.md` §47 — voir **DECISION-001**).

**Portage effectué** : `frontend/src/design-system/tokens.css` —
valeurs des tokens `--gs-*` remplacées par la charte V6 (accent
`#2a3fff`, surfaces/bordures teintées lavande, Plus Jakarta Sans pour
les titres, IBM Plex Sans pour l'UI, IBM Plex Mono réservée aux valeurs
tabulaires, radius 8px) — **aucun nom de variable changé, aucun
composant `.tsx` modifié** (`RisksPage`, `RaciPanel`, `Table`,
`FormField`, `StatusBadge`, `Button`, `Tabs` consomment déjà uniquement
`var(--gs-*)`, héritent donc automatiquement). Seul `index.css` a reçu
une modification hors tokens : `h1`/`h2` passent de
`var(--gs-font-ui)` à `var(--gs-font-display)` (rôle titre vs corps,
tel que défini par la charte), et `code` utilise désormais
`var(--gs-font-mono)` au lieu d'une pile codée en dur — deux lignes,
aucune logique touchée. `npm run typecheck` (frontend) et `npx oxlint`
relancés après coup : propres, aucune régression, aucun nouveau
warning.

**Écart assumé, signalé plutôt que silencieusement accepté** (détail
complet dans DECISION-001) : le portage réintroduit une dépendance
réseau (Google Fonts) que `DESIGN_NOTES.md` 4.2 excluait explicitement
à l'origine pour un outil interne. Le mode sombre existant de l'app a
été conservé (recoloré autour du nouvel accent) plutôt que supprimé,
la charte V1-V6 étant documentée "thème clair uniquement" sans
trancher explicitement le sort du dark mode du produit — à
reconfirmer si une vraie variante sombre de la charte est un jour
voulue.

---

**2026-09-28 — @orchestrator** — Réponse au §14 du brief PO (« pourquoi
le UX Designer ne produit pas de maquettes Figma »)

Vérifié directement en session, pas déduit : les deux seuls outils
`mcp__figma__*` disponibles sont `get_figma_data` (lecture d'un fichier
Figma existant) et `download_figma_images` (export d'images depuis un
fichier existant) — **aucun outil d'écriture/création n'existe dans
cette intégration MCP**. `get_figma_data` exige un `fileKey` en
paramètre obligatoire, sans mécanisme de découverte (pas de "lister
mes fichiers Figma").

**Deux blocages distincts, pas un seul** :
1. **Processus (déjà connu)** : aucun `fileKey` n'a jamais été fourni
   par le PO ni trouvé dans le dépôt — bloque même la *lecture*.
2. **Technique, plus fondamental, jamais énoncé aussi explicitement
   avant** : même avec un `fileKey`, cette intégration ne permet que de
   **lire/exporter** un fichier Figma existant, jamais d'y **créer**
   des frames ou des composants. Aucun agent (UX Designer inclus) ne
   peut donc "produire des maquettes Figma" via les outils disponibles
   dans cette session, quel que soit le fileKey fourni — ce n'est pas
   un manque de Design System (`frontend/src/design-system/tokens.css`
   existe et est à jour) ni un manque de composants.

**Solution de déblocage proposée** (3 options, à trancher par le PO,
pas par un agent) :
- **A.** Le PO (ou un designer humain) crée le fichier Figma et
  transcrit manuellement les tokens déjà normalisés
  (`tokens.css`, `docs/UX_Brief_Restructuration_Plateforme_v1.md`) —
  les agents peuvent ensuite *lire* ce fichier via `get_figma_data`
  pour vérifier la cohérence, jamais l'inverse.
- **B.** Les maquettes HTML/CSS déjà produites (mécanisme de revue par
  zone commentable, voir artefact `9kExAKw22AmH71rh59bdq4`) deviennent
  le référentiel UX/UI vivant à la place de Figma — cohérent avec le
  process déjà en place (charte portée dans `tokens.css`, DECISION-001),
  mais ne satisfait pas littéralement l'exigence §14 ("un véritable
  référentiel **dans Figma**").
- **C.** Un futur outil MCP Figma en écriture (si Anthropic/Figma en
  publie un) débloquerait la production directe — non disponible à ce
  jour dans cette session, à ne pas supposer.

Aucune des trois n'est appliquée par cette entrée : décision PO
requise avant d'agir (voir `ACTION_ITEMS.md`).

---

**2026-09-28 — @tous — Arbitrage du PO sur la restructuration UX/UI (5
décisions) + consultation des agents concernés**

Le PO a tranché sur `docs/UX_Brief_Restructuration_Plateforme_v1.md` et
sur les 7 difficultés soulevées par l'orchestrateur :

1. **Figma — option B retenue** : les maquettes HTML/CSS commentables
   (artefact `9kExAKw22AmH71rh59bdq4`) deviennent le référentiel UX/UI
   vivant, pas Figma.
2. **Composantes atomiques d'abord** : construire les atomes
   (boutons, badges, card, modale, filtre, panneau latéral) avant les
   écrans — les écrans deviennent de l'emboîtement, pas de la
   conception répétée. Consigne permanente pour la suite du chantier.
3. **Panneau latéral générique Comments/RACI/Evidence en premier**,
   dans l'artefact — les autres composantes s'ajoutent une fois
   chacune accordée par le PO.
4. **Risk 360 = registre des risques enrichi** (pas un nouvel objet
   séparé) — contrôles, évaluations, KRI, etc. viennent en extension
   du registre, allège l'hypothèse de modélisation retenue dans
   `UX_Impact_Analysis_v1.md`.
5. **Un seul dashboard consolidé**, pas un par rôle — son contenu
   (fond et forme) doit être arbitré par UX Designer, Risk Manager,
   Compliance et Privacy ensemble, pas décidé unilatéralement par le
   design.
6. **Rythme par maturité** : un écran statué avant de passer au
   suivant, jamais les 29 en parallèle.
7. **Consigne de collaboration** : les composantes atomiques
   réutilisables réduisent la charge de revue du PO dans la durée
   (pas de refonte répétée) — le style/goût du PO doit être appris et
   partagé à tous les agents, pas reredécouvert à chaque module.

**Consultation des agents concernés sur ces 5 décisions** (identité de
chaque agent relue avant réponse, même méthode que la consultation CDC
v0.1) :

| Agent | Avis / Observation | Difficulté potentielle signalée |
|---|---|---|
| `@ux-designer` (A04) | Le composant-first est déjà dans son mandat (§ conception UX cohérente/accessible) — accueille favorablement. | Demande un inventaire écrit des atomes (nom, variantes, états) au fur et à mesure, sinon la dérive déjà documentée deux fois (`DESIGN_NOTES.md` §2) se reproduit dès le 2e ou 3e module. |
| `@architect` (A05) | Risk 360 "registre enrichi" est une bonne nouvelle architecturale — pas de nouvel agrégat, juste des jointures/lectures étendues sur `Risk`. Dashboard consolidé, en revanche, réclame un modèle de composition (quels widgets, alimentés par quelles requêtes) — sinon il devient un écran monolithique difficile à faire évoluer. | Recommande un ADR court sur le "modèle de composition du dashboard" avant que le premier widget ne soit codé, pour ne pas coder 5 widgets avec 5 logiques d'agrégation différentes. |
| `@product-manager` (A03) | Le rythme "un écran statué, on passe au suivant" correspond à sa recommandation Definition of Ready/Done (§53/54 de son system prompt) — chaque écran doit avoir ses acceptance criteria avant validation, pas seulement "ça plaît visuellement". | Demande que "statué" soit défini explicitement par écran (qui valide : PO seul, ou PO + Risk/Compliance/Privacy quand le contenu les concerne, comme pour le dashboard) — sinon le mot "statué" devient ambigu module après module. |
| `@risk-manager` (A13) | Fonction indépendante de challenge, pas de production — accepte de revoir le contenu du dashboard, mais rappelle qu'il ne co-conçoit pas, il challenge après coup ; le design ne doit pas présumer son accord. | Signale un risque méthodologique : si "Risk 360" enrichit librement le registre sans repasser par une revue de la méthodologie de scoring (déjà un point ouvert non traité, `ACTION_ITEMS.md` ligne `@risk-manager` du 2026-09-27), l'écran pourrait afficher des scores dérivés non encore validés comme définitifs. |
| `@compliance` (A14) | Fonction de 2e ligne — même remarque que Risk : challenge le contenu du dashboard une fois proposé, ne le conçoit pas. Rappelle la GRC Trigger Matrix (`product-manager.md` §64) : un nouveau module "Nouveau traitement de données"/"Workflow financier" déclenche systématiquement une revue Compliance, atomique ou pas. | Le passage "par maturité" ne doit pas sauter la revue Compliance pour les modules qui la déclenchent (Audit notamment) simplement parce qu'ils arrivent tard dans la séquence. |
| `@privacy` (A24) | Un dashboard "avec toutes les informations jugées utiles" est exactement le genre de formulation qui a déjà produit une fuite (voir `ACTION_ITEMS.md` ligne `@privacy` du 2026-09-27 : `RiskOwnershipService.listOwners` expose un utilisateur suspendu). Demande une définition par widget de qui voit quoi, pas un dashboard "tout visible par défaut" puis restreint après coup. | Risque concret si le dashboard consolidé est mocké avec des données richement détaillées avant que la visibilité par permission ne soit définie widget par widget. |
| `@security` (A10) | Le composant-first réduit la surface à auditer (un `Modal`/`Form` revu une fois vs 29 fois) — favorable. Rappelle que l'artefact de revue reste un stockage de données d'exemple qui doit rester manifestement fictif et organisation-interne (déjà le cas : déclaration `comments` complète = non partageable publiquement). | Aucune difficulté bloquante signalée à ce stade — juste une vigilance à maintenir sur le caractère fictif des données d'exemple à mesure que les écrans se multiplient. |
| `@qa-engineer` (A08) | Le composant-first est testable en isolation, favorable. Le rythme "un écran à la fois" permet de tester la bibliothèque d'atomes progressivement plutôt qu'en bloc à la fin. | Demande que chaque atome documente ses états (défaut/survol/erreur/désactivé/chargement) dès sa première version — lacune déjà notée pour `RisksPage` (`DESIGN_NOTES.md` §3, jamais d'état vide dédié) à ne pas reproduire dans les nouveaux atomes. |
| `@dev-backend` (A06) | Aucune implication code à ce stade (phase maquette pure) — mais signale que la validation d'un écran par le PO ne doit pas être lue comme "prêt à coder" pour les modules sans aucun backend (Audit, référentiels) : la séquence recommandée reste de statuer d'abord les modules dont le backend existe déjà (Évaluations, KRI, KPI, Plans d'action, Contrôles/Exécutions), pour ne pas accumuler des écrans validés en attente d'un backend qui n'existe pas encore. | Aucune, tant que la priorisation proposée dans `UX_Impact_Analysis_v1.md` reste respectée. |

**Mémoire durable** : les préférences de collaboration du PO (§7 ci-
dessus — composant-first pour réduire la charge de revue, rythme par
maturité, apprentissage du goût du PO à partager avec tous les agents)
sont enregistrées dans la mémoire long-terme de l'orchestrateur en plus
de ce log, pour survivre au-delà de cette conversation.

---

**2026-09-28 — @risk-manager @privacy @compliance @architect** — Consultation
INDÉPENDANTE réelle (4 agents dispatchés séparément, pas un résumé
orchestrateur) sur DECISION-002, suite à un retour explicite du PO :
« j'espère que tu délègues car tu n'es pas outillé pour répondre au
mieux à toutes les questions ». Chaque agent a lu son propre system
prompt + le code/les docs pertinents avant de répondre — voir
`ACTION_ITEMS.md` pour le détail complet par agent. Synthèse :

- **Privacy** : reconfirme et approfondit le finding du 27/09
  (`RiskOwnershipService`/`PostgresUserRepository.getById` sans filtre
  `deleted_at`) — l'anomalie est dans le repository lui-même, pas
  seulement le service. Émet **PRIV-CH-DASH-001** : matrice widget ×
  donnée × permission requise avant tout code de production sur le
  dashboard, non bloquant en phase maquette.
- **Risk Manager** : corrige une hypothèse erronée de l'orchestrateur
  (le score résiduel n'est pas une dérivation mécanique, c'est une
  recotation humaine — bonne conception). Trouve un vrai
  **RISK_BLOCK** pour Risk 360 : le statut de l'évaluation
  (BROUILLON/VALIDATED/REJECTED/VALIDE_COMITE) n'est filtré nulle
  part, donc un score non validé pourrait s'afficher avec la même
  autorité qu'un score validé par le Comité. Émet aussi
  **CHALLENGE-001** (non bloquant) sur la règle de moyenne pour la
  maîtrise globale, jamais validée par un référentiel métier écrit.
- **Compliance** : trouve un gap process réel — `CLAUDE.md` point 8 ne
  nomme que QA/Security pour les revues après chaque lot, jamais
  Compliance. Pas de blocage positionnel sur l'ordre des 29 modules,
  mais deux conditions avant que le premier écran Audit soit "statué" :
  trancher la contradiction de modélisation du CDC v0.1, et cadrer a
  minima ACT-072 avant de maquetter un bouton "purger".
- **Architect** : confirme un vrai risque N+1 sur Risk 360 (5-6 repos
  à croiser, `ActionPlan` n'a même pas de `listForRisk`) — recommande
  une méthode d'orchestration dédiée. Resserre sa propre recommandation
  d'ADR dashboard (short, avant le premier widget **backend**, pas
  avant la maquette) avec 3 questions structurantes concrètes.
  Confirme une dépendance d'ordre réelle : Cartographie dépend
  techniquement d'Évaluation (pas l'inverse) pour le passage "statué →
  prêt à coder", même si la maquette HTML/CSS peut se faire dans
  n'importe quel ordre.

Aucun de ces 4 avis ne bloque le travail de maquette en cours
(panneau latéral, atomes) — toutes les conditions posées portent sur
le moment où Risk 360/Dashboard/Audit passeront au code, pas sur la
phase actuelle. Aucun code de production modifié par ces 4 agents
(hors périmètre — consultation uniquement).

---

**2026-09-29 — @architect** — CHALLENGE-002 : objets de domaine
"emboîtables par référence" (analogie composants UI), verdict accepté
avec conditions

Le PO a demandé un dispatch réel avec instruction explicite de
challenger sa propre proposition, pas de la valider. Proposition : la
logique appliquée côté frontend (bibliothèque d'atomes UI réutilisables
— Bouton, Badge, Card, Panel générique) devrait s'appliquer côté
backend — des objets de domaine "emboîtables", son exemple : un
"Dispositif de risque" composé par référence d'une Échelle de cotation,
d'un mécanisme d'impact, de Risques, de Contrôles.

**Sources lues intégralement** : `.claude/agents/architect.md`,
`CLAUDE.md` (§Backend architecture, pattern paramètre optionnel
constructeur), `docs/architecture/ADR-002-modele-grc-cible.md`,
`docs/architecture/GRC_Target_Domain_Model.md`,
`docs/UX_Impact_Analysis_v1.md`, et le code réel :
`RiskRepository.ts`, `ControlRepository.ts`,
`RiskEvaluationRepository.ts`, `KriRepository.ts`,
`ActionPlanRepository.ts`, `RiskService.ts`, `RiskEvaluationService.ts`,
`ActionPlanService.ts`.

**Où l'analogie tient** : pour les référentiels stables sans cycle de
vie propre (`RatingScale`, `RiskCategory`) — déjà la doctrine actée
dans ADR-002, avant même la demande du PO aujourd'hui.

**Où elle casse** : un composant UI n'a pas d'invariants métier ni de
cycle de vie ; un `Risk`/`Control`/`ActionPlan` en a (transitions
d'état validées en service, permissions, maker-checker). "Composer par
référence" un Risque pose une question qu'un Bouton ne pose jamais :
qui garantit la cohérence de l'ensemble composé quand un élément change
de statut ? Deuxième point de rupture : le "Dispositif de risque" du
PO n'est probablement pas un problème de *stockage composable* mais
d'*agrégation de lecture* — un service qui assemble des repositories
déjà existants (comme `ActionPlanService` le fait déjà), pas une
nouvelle entité persistée qui référencerait tout.

**Le principe est déjà appliqué, mais sélectivement, pas
dogmatiquement** — preuve la plus forte : `RiskEvaluation.subCategory`/
`entity` sont capturés **en instantané** (dupliqués), pas référencés
depuis `Risk`, précisément pour préserver l'immuabilité d'une
évaluation validée dans le temps si la catégorie change ensuite après
coup — un besoin métier réel que la composition pure aurait cassé.
Deuxième preuve, la plus révélatrice : la consolidation KRI/KPI en
`Indicator` (ADR-002 Décision 3) est une fusion **physique** mais les
deux restent des concepts métier **distincts** — l'inverse exact d'une
composition par référence unique, tranché par le PO lui-même un jour
avant cette demande.

**Recommandation (3 options pesées, verdict tranché, pas une liste
passive)** :
- (a) composition par référence stricte partout — **rejetée** : ignore
  la distinction déjà actée référentiel-stable vs instantané-d'audit,
  sur-ingénierie anticipée contraire à ADR-001 et à la consigne
  ponytail permanente du PO (`CLAUDE.md` §5bis).
- (b) polymorphisme ciblé façon `ActionLink`, seulement quand un
  **2e cas d'usage réel confirmé** existe (pas anticipé) — **retenue**,
  déjà la politique du projet (Comments/RACI/Evidence/Audit trail, 4
  précédents validés avant généralisation).
- (c) ajout de l'architecte : la vraie friction à venir sur 29 modules
  n'est pas duplication-vs-référence, c'est la confusion entre
  composition de *stockage* et agrégation de *lecture* — un
  `RiskDeviceViewService` (ou équivalent) qui compose des repositories
  existants par injection de constructeur (le mécanisme déjà validé et
  testé sur 9 modules) répond au besoin sans inventer de nouveau
  concept d'entité.

**Risque concret si imposé rigidement, avec preuve** : sur Audit
(aucun backend existant), imposer la composition par référence avant
un 2e cas d'usage réel généraliserait prématurément la table de liaison
polymorphe de `Finding` à des types d'objets peut-être jamais
consommés — dette de migration pour un besoin imaginé, pas confirmé.
Sur Indicator, la règle rentrerait en tension directe avec une décision
déjà actée par le PO lui-même (Décision 3), révélant que la règle
brute n'était pas la bonne formulation du problème.

**Verdict : accepté avec conditions.** (1) le mécanisme à généraliser
est le paramètre optionnel de constructeur + moteur polymorphe réservé
au 2e cas d'usage confirmé — pas un nouveau mécanisme ; (2) service de
lecture composée plutôt que nouvelle entité persistée pour "Dispositif
de risque", sauf besoin confirmé de persister l'assemblage lui-même ;
(3) duplication/instantané reste légitime quand l'immuabilité d'audit
l'exige ; (4) aucune whitelist polymorphe étendue par anticipation sur
un module sans backend.

**Point structurant à faire trancher explicitement par le PO** (règle
§7bis `CLAUDE.md` — pas laissé en item narratif) : service de lecture
composée vs nouvelle entité persistée pour "Dispositif de risque",
avant qu'un agent ne commence à construire cet écran — voir
`ACTION_ITEMS.md`. Aucun code de production modifié (revue
d'architecture, hors périmètre d'implémentation).

---

**2026-09-29 — @architect** — DECISION-003 : recommandation assumée,
projetée sur les 29 modules restants (round 2 de CHALLENGE-002, même
agent repris avec son contexte déjà chargé, pas une nouvelle revue)

Le PO a demandé d'aller plus loin que "voici les options" : quelle
architecture évite vraiment de devoir modifier plusieurs objets à
chaque changement, et un choix tranché sur "Dispositif de risque".

**Friction n°1, déjà visible aujourd'hui, pas hypothétique** : le
moteur polymorphe n'a pas une whitelist, il en a déjà cinq qui
divergent — `ActionPlanSourceType` (RISK/CONTROL/KRI/AUDIT/INCIDENT/
MANAGEMENT) et `ActionLinkResourceType` (RISK/CONTROL/KRI/ANOMALY) dans
`ActionPlanService.ts` se recoupent partiellement sans être identiques,
et ADR-002 prévoit de répliquer le même schéma pour RACI, Comments,
Evidence-links et Finding — 5 listes indépendantes qui décrivent
chacune "quels objets GRC existent". Projection concrète : le jour où
`Incident` doit devenir consultable/commentable/RACI-able/lié à des
Evidence (son cas d'usage prévu), il faudra modifier 5 unions de types
dans 5 fichiers différents plus les `CHECK` SQL correspondants — le
symptôme exact demandé ("toucher plusieurs objets pour un seul
changement"), déjà visible à 2 whitelists sur 9 modules livrés.

**Correctif proposé** : un `GrcObjectType` canonique unique (un seul
fichier), adopté avant que RACI/Comments/Evidence-links/Finding ne
soient exposés — pas une nouvelle abstraction, juste arrêter de retaper
la même liste à 5 endroits qui divergent inévitablement. Coût
maintenant : une refacto de type, zéro migration DB. Coût dans 12 mois,
5 whitelists déjà en prod et déjà divergentes : chantier de correction
avec non-régression sur chaque module consommateur.

**Friction n°2** : Risk 360 et Dashboards sont documentés dans le
backlog UX comme dépendant explicitement de *tous* les autres modules
— le pattern "paramètre optionnel constructeur" (5-8 dépendances
aujourd'hui) ne va pas bien scaler à 10-15 dépendances pour une seule
fiche agrégée : constructeur illisible, et surtout un risque multiplié
de trou de validation silencieux (`this.x?.y()`), déjà matérialisé deux
fois indépendamment en production (SEC-001, SEC-009).

**Correctif proposé** : pas une 5e couche, pas de CQRS formel — une
convention de nommage à l'intérieur de `services/` existant : séparer
les services d'écriture (règles métier, transitions, permissions) des
services de lecture agrégée (`*ViewService`/`*DashboardService`), qui
composent les mêmes repositories mais ne portent aucune transition
d'état ni audit d'écriture. Le patron existe déjà à petite échelle :
`ActionPlanService.dashboard()` assemble et calcule un statut dérivé
sans jamais le stocker.

**"Dispositif de risque" — tranché sans réserve** : service de lecture
composée, point final. Persister l'assemblage recréerait exactement la
friction n°1 en pire — toute évolution d'un Risk/Control/Indicator
source poserait la question de la synchronisation du "Dispositif",
l'inverse de "code stable dans la durée". Le patron proposé
(`RiskDeviceViewService`, injection des repositories déjà existants,
zéro nouvelle table/migration/permission) sert directement de gabarit
pour Risk 360 et Dashboards ensuite — généraliser l'entité persistée
à la place coûterait, sur 29 modules, l'écart entre "ajouter une vue =
un service + une méthode" et "ajouter une vue = migration + entité +
repository + service + route" (la recette en 9 étapes de `CLAUDE.md`,
pensée pour des objets métier, pas des vues) à chaque fois. Seule
réserve non provisionnée, jamais exprimée par le PO à ce jour : figer
un dispositif à un instant T pour l'opposer plus tard exigerait un
nouvel objet métier à part entière avec sa propre justification
d'audit — pas anticipé tant que ce besoin n'est pas exprimé.

Aucun code de production modifié (revue d'architecture). Points restant
à planifier, non bloquants pour le travail en cours : créer
`GrcObjectType` avant le Lot RACI/Comments/Evidence, adopter la
convention `*ViewService` avant le premier écran d'agrégation.

---

**2026-09-29 — @tous — Balayage complet des 15 agents, réellement
dispatchés (DECISION-004)**

Sur demande explicite du PO (« les autres agents doivent être informés
et doivent nous faire un retour... tous sans exception »), les 15
rôles ACF (architect inclus, sur une tâche différente : formaliser
`ADR-003`) ont été dispatchés indépendamment — chacun lit son propre
mandat, ses propres lignes ouvertes dans `ACTION_ITEMS.md`, et scanne
son périmètre pour un point non encore tracké. Détail complet par
agent dans `ACTION_ITEMS.md` (nouvelles lignes du 2026-09-29).

**Le plus important, par ordre de priorité réelle** :

1. **@release-manager — URGENT** : `main` a 27 commits jamais poussés,
   aucune PR pour le Lot 1 RACI malgré un feu vert QA/Security complet.
   Travail validé en interne, jamais soumis au canal de release.
2. **Confirmation croisée du problème central de DECISION-003 par 7
   agents indépendants**, chacun depuis son angle propre, sans se
   copier : la divergence de whitelists polymorphes est plus large que
   documenté (7, pas 5-6 — `RaciEntityType` et `NotificationResourceType`
   trouvées en plus, avec une divergence de **casse** en sus de la
   couverture). `@security` ajoute une dimension non couverte par
   l'architecte : centraliser aussi le résolveur, pas seulement le
   type. `@compliance` la qualifie de `REGULATORY_GAP` mineur.
3. **@privacy** élargit la portée de PRIV-CH-DASH-001 à tout futur
   `*ViewService`, pas seulement au Dashboard.
4. **@qa-engineer** trouve un vrai trou de couverture jamais tracké :
   `BrandingService`, zéro test.
5. Plusieurs items déjà ouverts sont fermés avec preuve fraîche
   (`@architect` §20 via ADR-003, `@audit` contradiction Finding déjà
   arbitrée) ou reconfirmés avec preuve fraîche sans changement
   (`@devops` ModuleToggle/quota Drive, `@documentation` RETEX
   toujours obsolète, `@risk-manager` CHALLENGE-001/RISK_BLOCK
   toujours ouverts, `@compliance` ACT-072 inchangé).

Aucune ligne fermée par complaisance : chaque agent a été instruit de
dire "rien de nouveau" si c'était honnêtement le cas (plusieurs l'ont
fait — `@ux-designer` sur DECISION-003 elle-même, `@infrastructure`,
`@devops` sur la décision elle-même). Aucun code de production modifié
par ce balayage (revue uniquement), sauf `ADR-003-conventions-
transverses.md` créé par `@architect` sur tâche dédiée.

---

**2026-09-29 — @tous — DECISION-005 : les 10 actions rapides exécutées
(Lots A/B/C), PR #16 mergée par le PO**

Suite au classement des 10 actions issues du balayage DECISION-004 par
urgence/parallélisabilité, exécution en 3 lots :

**Lot A (7 agents en parallèle, aucun conflit de fichiers)** :
1. `@release-manager` — organise les 27 commits + le travail en cours
   de session en 5 commits cohérents, ouvre PR #16 (push direct sur
   `main` bloqué par un hook de protection — workflow branche+PR suivi
   correctement, pas de contournement).
2. `@dev-backend` — corrige PRIV-CH-DASH-001 côté service
   (`RiskOwnershipService.listOwners` masque un owner suspendu) plutôt
   que de toucher `PostgresUserRepository.getById` (~70 appelants,
   risque de casse SEC-001/SEC-009 réévité par un scope minimal —
   raisonnement ponytail explicite).
3. `@architect` — tranche la casse canonique de `GrcObjectType`
   (SNAKE_CASE majuscule) et son périmètre (`NotificationResourceType`
   inclus), crée `backend/src/domain/GrcObjectType.ts`.
4. `@dev-backend` — middleware `moduleGuard.ts` (ACT-221), câblé sur
   `/api/v1/risks`, `ModuleToggle` n'est plus purement déclaratif.
5. `@qa-engineer` — 20 tests pour `BrandingService` (zéro avant).
6. `@documentation` — `CLAUDE.md` §8 étendu à Compliance,
   `RETEX_MULTI_AGENTS.md` mis à jour (section "Mise à jour 2026-09-29").

**Lot B (séquentiel, débloqué par #3)** : `@dev-backend` migre
`RaciEntityType` (PascalCase) vers `GrcObjectType` (SNAKE_CASE) —
backend, frontend, et migration `028_raci_entity_type_snake_case.sql`
(gère aussi les données déjà en base, pas seulement la contrainte).

**Lot C** : `@dev-db` découvre que le trou de rollback signalé sur
`027_raci_assignments.sql` est **structurel** — aucune des 28
migrations du projet n'avait de rollback documenté. Établit une
convention (`database/postgresql/migrations/README.md`, un
`NNN_nom.down.sql` par migration) plutôt que de ne traiter que RACI,
crée les rollbacks 027/028, et corrige au passage `runMigrations.ts`
qui aurait exécuté les futurs `.down.sql` comme des migrations
forward — sans ce correctif, la convention qu'il venait de créer
aurait été dangereuse dès son premier usage.

Chaque lot committé et poussé indépendamment par `@release-manager`
(même agent repris à chaque fois, contexte de la PR conservé), avec
vérification indépendante de `typecheck`/`test`/`build` avant chaque
commit — jamais un simple "l'agent précédent a dit que c'était vert".
**Résultat final** : PR #16, 22 commits, 405 tests verts, working tree
propre. **Mergée par le PO le 2026-09-29.**

Aucun conflit git rencontré malgré l'absence d'isolation worktree dans
cet environnement (la session elle-même n'est pas un dépôt git — le
mécanisme d'isolation par worktree n'est pas utilisable ici) : les
agents qui éditent des fichiers sans faire d'opérations git eux-mêmes
ne se sont jamais marché dessus (fichiers distincts), et un seul agent
(`@release-manager`) a fait les opérations git, en série, jamais en
parallèle avec lui-même.

---

**2026-09-29 — @tous — DECISION-006 : 5 actions rapides restantes,
toutes exécutées en parallèle**

Après DECISION-005, un nouveau passage léger (pas un balayage complet
des 15 — aucun événement déclencheur, cf. `CLAUDE.md` §8bis) a identifié
5 vraies actions rapides restantes dans `ACTION_ITEMS.md`. Dispatchées
en parallèle (aucun conflit de fichiers, un seul touche `server.ts`) :

1. `@dev-backend` — dérive `NotificationResourceType` de `GrcObjectType`
   (via `satisfies`). **Corrige une erreur dans le commentaire de
   l'architecte** : celui-ci recommandait de remplacer directement par
   `GrcObjectType`, mais ça aurait silencieusement élargi l'API de
   notifications de 7 à 10 valeurs acceptées sans justification
   métier — contraire au principe deny-by-default. Garde le périmètre
   métier actuel (7 valeurs), juste dérivé de la source canonique.
2. `@dev-backend` — étend `moduleGuard` aux 9 modules réels (câblé sur
   `/risks` seulement avant). 18 tests (`it.each`). Point signalé pour
   suite : `/api/v1/reports` partage `DashboardService` avec le module
   `DASHBOARD` gardé mais n'est pas lui-même gardé (pas un module
   déclaré) — à confirmer si un comportement de garde y est attendu.
3. `@dev-db` — cross-review des migrations 016-022 : propre, zéro
   écart. Valide la règle "pas de spawn pour cas simples", avec
   réserve explicite pour les cas destructifs ou touchant une
   rétention légale.
4. `@compliance` — proposition de cadrage ACT-072
   (`docs/architecture/ACT-072-cadrage-propose.md`), 3 options
   rédigées, recommandation assumée (Option C : restriction de
   visibilité, pas de purge automatisée) — reste à confirmer par le
   PO/juridique, statut `EVIDENCE_REQUIRED` en attendant.
5. `@audit` — conformité append-only/soft-delete/tenant_id sur les 9
   modules livrés : conforme, aucun écart.

En parallèle, nettoyage de `ACTION_ITEMS.md` : 4 items déjà résolus
mais jamais marqués fermés (2 par absorption confirmée par l'agent
lui-même, 2 déjà livrés dans DECISION-005 sans mise à jour de la
ligne d'origine) — leçon directe de la règle §7bis : une résolution
non tracée reste un item "ouvert" indéfiniment.

**Reste à faire** : committer/pousser le travail de code des points 1
et 2 (points 3-5 sont des revues/propositions, pas de code produit).

---

**2026-09-29 — @orchestrator** — Premier module métier maquetté :
Évaluation des risques

Premier des 29 modules à passer en maquette, choisi sur recommandation
convergente des 4 agents consultés (backend déjà prêt, aucune
contradiction de modélisation, dépendance technique confirmée par
`@architect` — Cartographie dépend d'Évaluations, pas l'inverse).
Ajouté comme nouvel onglet dans l'artefact de revue
(`https://claude.ai/artifact/9kExAKw22AmH71rh59bdq4`, v15), composé
exclusivement à partir des atomes déjà validés (sidebar à l'échelle —
premier usage réel, pas juste la démo Design System —, breadcrumb,
card, badges, boutons, panneau générique Comments/RACI/Evidence).

Deux exigences déjà tranchées intégrées dès la première version, pas
ajoutées après coup :
- **RISK_BLOCK de `@risk-manager`** (2026-09-29) : le score résiduel
  n'est jamais affiché sans le statut de l'évaluation source à côté —
  bandeau dédié qui le rappelle explicitement sur l'écran lui-même.
- **DECISION-003** : "Risk 360" = registre enrichi — le lien "Registre"
  de la sidebar porte une note "(inclut Risk 360)", pas d'entrée de
  navigation séparée.

Contenu représentatif (pas de lorem), cohérence délibérée avec les
personae déjà utilisées ailleurs dans l'artefact (Aïssatou Diallo,
Kouadio N'Guessan, CTRL-088) pour que Risk 360 (futur) puisse
plausiblement relier les mêmes objets entre écrans.

Pas encore statué — en attente des commentaires du PO avant de passer
au module suivant, conforme au rythme "un écran à la fois" (DECISION-002
point 6).

---

**2026-09-29 — @architect** — Cotation brute (mode Participatif) :
implication modèle de données, réponse à une question soulevée par le
PO en revue de l'écran Évaluation

Le PO a demandé, sur l'écran maquetté : où est traitée la distinction
"brut" (exécutant de contrôle, mode Participatif) vs "inhérent"
(équipe risque, mode Classique) ? Le champ "brut" n'existe dans aucun
champ backend actuel — question envoyée à Risk Manager (méthodologie)
et Architect (modèle de données) en parallèle plutôt que devinée dans
la maquette.

**Où porter le mode Classique/Participatif** : sur `Config`
(tenant-wide), pas sur `Risk` ni un futur objet `Dispositif` séparé.
Preuve : `Config.appetiteMode` est déjà exactement ce schéma
(`AUTO`/`MANUEL`/`AUTO_AVEC_SURCHARGE_MANUELLE`), et
`ConfigService.ts:55` anticipe déjà que `RiskEvaluationService` s'y
branchera un jour. `RiskEvaluation` devra capturer un snapshot du mode
appliqué à la création (même garde-fou que `ratingScaleId`/
`ratingScaleVersion`, `RiskEvaluation.ts:60`), pour qu'un changement de
mode tenant ne réinterprète jamais une évaluation déjà finalisée.

**Pattern d'écriture** : pas de nouveau pattern — la cotation brute est
un setter étroit de plus dans la séquence progressive déjà en place
(`RiskEvaluation.ts:5-9`), alimentant un champ distinct (`rawScore`
ou équivalent) pendant que `status` reste `BROUILLON`, jamais une
écriture directe sur `inherentScore`/`residualScore`.

**Permissions** : nouvelle permission dédiée requise (ex.
`riskevaluation.submit-raw`), jamais réutiliser `riskevaluation.update`
— même raisonnement que SEC-011 (`assertIsEvaluator`) : sans gate
dédié, le maker-checker de `validate`/`reject` protège trop tard, après
que l'écriture a déjà eu lieu. Précédent direct : `riskevaluation.
validate.committee` (ACT-253), déjà construit sur ce schéma additif.

**Risque concret si non tranché avant Cartographie/Registre** : ces
deux écrans supposeraient une seule paire inhérent/résiduel par
évaluation (comme aujourd'hui, `RiskEvaluationService.ts:364-378`) — en
mode Participatif, plusieurs cotations brutes non consolidées peuvent
coexister avant validation. Maquetter Cartographie/Registre avant ce
tranchage produirait des écrans qui cassent au premier tenant en mode
Participatif — risque analogue déjà documenté pour `subCategory`/
`entity` dans `RiskEvaluation.ts:10-26`.

En attente de la réponse `@risk-manager` (méthodologie : brut =
synonyme d'inhérent, ou étape distincte ?) avant synthèse et mise à
jour de la maquette.

---

**2026-09-29 — @risk-manager** — Réponse méthodologique, convergente
avec `@architect`

Confirmé par lecture du code (`RiskEvaluation.ts`, `RiskEvaluationService.ts`)
et de la méthodologie ISO 31000/COSO ERM (mandat §10) : **"brut" n'est
pas un champ manquant, c'est mathématiquement le même risque inhérent**
(même formule, même échelle) — ce qui diffère en mode Participatif,
c'est *qui* le saisit et *à quel moment* il devient opposable, pas le
calcul lui-même.

**Ce qui manque réellement** : un point de maker-checker **intermédiaire**,
pas un nouveau champ. Aujourd'hui `assertIsEvaluator` impose un seul
`evaluatorId` pour toute l'évaluation (inhérent+maîtrise+résiduel), et
le seul maker-checker existant est en bout de chaîne (`validate`/
`reject` interdisent l'auto-validation). Il manque un cran à l'intérieur
de l'étape inhérente : L1 (exécutant de contrôle) soumet, L2 (équipe
risque) endosse ou amende avant que le chiffre ne devienne l'inhérent
officiel. Précédent direct dans le code pour ce genre d'extension :
`VALIDE_COMITE` (ACT-253), un cran de maker-checker supplémentaire
ajouté via un nouveau statut + une permission dédiée, pas un objet
séparé.

**Risque de gouvernance confirmé, explicitement dans le mandat (§43)** :
un exécutant de contrôle qui note seul le risque que son propre
contrôle est censé maîtriser réintroduit un biais d'auto-évaluation —
le même acteur ne doit jamais cumuler soumission brute ET endossement,
ni endossement ET validation finale.

**Où porter le mode Classique/Participatif — léger désaccord de niveau
avec `@architect`** : Risk Manager recommande le **Dispositif** (pas
`Config` tenant-wide) — une organisation a des maturités différentes
par direction/processus, un seul mode global empêcherait une
coexistence légitime (dispositifs sensibles restant en Classique
pendant que d'autres passent en Participatif). `@architect` recommandait
`Config` par analogie avec `appetiteMode`. **Les deux convergent** sur
le principe : jamais au niveau du Risque individuel — seul le niveau
exact (Dispositif vs Config avec un défaut hérité) reste à trancher,
et il dépend directement de DECISION-003bis déjà en réserve (« Dispositif
de risque » = service de lecture composée, pas d'entité persistée —
si le Dispositif n'est qu'une vue, porter une configuration dessus
demande une réflexion supplémentaire que ni l'un ni l'autre agent n'a
eu à trancher seul).

**Verdict** : question posée par le PO en revue d'écran résolue sur le
fond (brut = inhérent + maker-checker manquant, pas un nouveau champ),
un point de niveau (Dispositif vs Config) reste à arbitrer par le PO
avant tout code — aucun des deux agents ne peut le trancher seul sans
rouvrir DECISION-003bis. Aucun code de production modifié (revue
uniquement).
