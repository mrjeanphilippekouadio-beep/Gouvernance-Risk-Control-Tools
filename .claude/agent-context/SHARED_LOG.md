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
