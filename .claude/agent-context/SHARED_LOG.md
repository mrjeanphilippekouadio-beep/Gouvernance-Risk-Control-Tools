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
