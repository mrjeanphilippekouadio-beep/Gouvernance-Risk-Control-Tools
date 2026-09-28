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
