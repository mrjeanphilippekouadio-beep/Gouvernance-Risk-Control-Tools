# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

This is a monorepo in transition: a production Google Apps Script tool
(`apps-script-legacy/`) being superseded by a layered TypeScript backend
+ React frontend. Both can be true at once — don't assume the Apps
Script code is dead. See `docs/architecture/ADR-001-cible-architecture.md`
for the full rationale and `docs/architecture/architecture_echange_complet.md`
for the complete design discussion behind it.

- `apps-script-legacy/` — container-bound Apps Script project (Sheets as
  DB). Still runs in production for Djamo. Install/deploy steps are in
  its own `apps-script-legacy/README.md`.
- `backend/` — Express/TypeScript API (target: Cloud Run).
- `frontend/` — React + Vite + TypeScript.
- `database/postgresql/` — versioned Neon Postgres migrations + a
  dev-only seed script.

## Commands

### Backend (`cd backend`)

- `npm install`
- `npm run dev` — tsx watch, requires `.env` (copy from `.env.example`)
- `npm run typecheck` — `tsc --noEmit`, no build output
- `npm test` — vitest, all suites; `npm run test:watch` for watch mode
- `npx vitest run test/RiskService.test.ts` — single test file
- `npm run build` — compiles to `dist/`
- `npm run migrate` — applies `database/postgresql/migrations/*.sql` in
  order, tracked in a `schema_migrations` table (idempotent, safe to
  rerun)

The server **fails fast** on invalid/missing env vars (`src/config/env.ts`
validates with zod and calls `process.exit(1)`) — this is intentional,
not a bug to work around.

### Frontend (`cd frontend`)

- `npm install`
- `npm run dev`
- `npm run build` — `tsc -b && vite build`

Note: the frontend's `tsconfig` has `erasableSyntaxOnly` enabled (Vite's
default TS template) — no constructor parameter properties
(`constructor(private x: T)`) in frontend code; that pattern is fine in
`backend/` but must be written out longhand in `frontend/`.

## Backend architecture

Strict layering, enforced by where imports are allowed to point — this
is the whole point of the rewrite (see ADR-001) and should not be
casually broken:

```
api/v1/*.routes.ts      → parses/validates HTTP, calls a service, shapes the response. No business rules.
services/*Service.ts    → ALL business rules, transitions, permission checks, audit logging.
domain/                 → entities + repository/storage/identity INTERFACES. No pg/googleapis/express imports, ever.
infrastructure/         → the only place allowed to import pg, googleapis, google-auth-library.
```

Concretely: `domain/repositories/RiskRepository.ts` is an interface;
`infrastructure/database/postgres/PostgresRiskRepository.ts` is the only
implementation. A service takes the interface via constructor injection
and is wired to the concrete class in `server.ts`. Swapping Neon for
another Postgres host, or Drive for S3, means writing a new
`infrastructure/` class — `services/` and `domain/` don't change.

**Every service method that touches tenant data takes `actor:
AuthenticatedUser` and calls `requirePermission(actor, "resource.action")`
first** (`domain/permissions.ts`). Tenant scoping is enforced by always
passing `actor.tenantId` into repository calls — never a client-supplied
tenant id. `EvidenceService` is the reference example for the pattern
that matters most here: it does a tenant-scoped DB lookup
(`EvidenceRepository.getById(tenantId, id)`) *before* ever calling
`DocumentStorage`, because `GoogleDriveStorage` itself has no concept of
tenants and must never be called with an unverified file id.

State transitions (e.g. `Risk.status`) are validated in the service
(`isValidTransition` in `RiskService.ts`), not in the database or the
frontend. Every create/update/delete goes through
`AuditRepository.record(...)` in the same service method — audit logging
is not optional or bolted on later.

## Adding a new domain module

Nine slices exist already (Risk, Evidence, Control, ControlExecution,
ControlEffectivenessAssessment, Anomaly, Department, Process, plus the
read-only audit log) — check `apps-script-legacy/` for the module you're
porting; one of these nine is almost always the closest shape to copy.
Order: `domain/entities/X.ts` → `domain/repositories/XRepository.ts`
(interface) → `infrastructure/database/postgres/PostgresXRepository.ts`
→ `services/XService.ts` (permissions + rules + audit) →
`api/v1/x.routes.ts` → wire into `server.ts` → migration in
`database/postgresql/migrations/NNN_x.sql`. Add the new permission
strings to `domain/permissions.ts`'s `Permission` union.

Three different write patterns coexist on purpose — match the one the
legacy `.gs` file for that module actually used, don't default to one:
- **Append-only** (Risk assessments — not yet built —, ControlExecution,
  ControlEffectivenessAssessment): a new row per occurrence, the only
  mutation ever allowed after creation is the maker-checker validation
  step. Repository exposes a narrow `recordValidation`/similar, never a
  general `update`.
- **Updated in place** (Department, Process): one row, edited directly.
  Uses `buildUpdateSet` (see below), not `UPDATE ... SET x = COALESCE($n, x)`.
- **Ticket lifecycle** (Anomaly): one row with a state machine
  (`VALID_TRANSITIONS` map in the service), closing/terminal states
  require a mandatory comment.

**`buildUpdateSet` (`infrastructure/database/postgres/dynamicUpdate.ts`)
is mandatory for any partial update with nullable columns.**
`COALESCE($n, col)` cannot distinguish "field omitted" from "field
explicitly set to null" — a real bug caught by `/code-review` and fixed
in both Risk and Control. Always build the SET list from only the keys
the caller actually provided.

**A generic `update()` must never allow a transition into the terminal/
archived state.** `RiskService.update`/`ControlService.update` both
explicitly reject `status: "ARCHIVED"` and point callers at the
dedicated `archive()` method — that's what enforces the mandatory reason
and the `*.delete` permission. This was a real authorization bypass
found by `/code-review`; don't reintroduce it in a new service that has
both a general update and an archive/close action.

## Security-sensitive conventions

- Soft delete only (`deleted_at`/`status` columns) — no `DELETE FROM` in
  application code, this is a compliance/audit requirement, not a style
  preference.
  - **Exception**: pure link/join tables with no `deleted_at` of their
    own and no business meaning outside the pair they represent (e.g.
    `control_risks`, mapping which risks a control covers) may be
    rebuilt with `DELETE` + `INSERT` — see `replaceCoveredRisks` in
    `PostgresControlRepository.ts`. This trades away history of *which*
    risk was linked/unlinked *when*; if a regulatory framework ever
    requires that history, migrate the table to carry its own
    `deleted_at` (diff + soft-delete the removed pairs) instead of
    stretching this exception. Every `DELETE`/`INSERT` on a link table
    must still filter by `tenant_id`, exception or not.
- `tenant_id` on every business table from the first migration touching
  it, even though the product is currently single-tenant.
- Secrets only via env vars (`backend/.env`, `frontend/.env.local`),
  never committed — see `.gitignore`.

## Architecture Agentique ACF

Source de vérité : `docs/acf/ACF_GRC_Tools_v2_COMPLET.xlsx` (feuilles
4️⃣ AGENT HIERARCHY, 5️⃣ AGENT CONFIG, 6️⃣ SYSTEM PROMPTS, 7️⃣ MODEL
REGISTRY, 8️⃣ GRC ACTIONS). Les subagents Claude Code générés à partir
de ce classeur vivent dans `.claude/agents/*.md` (un fichier par agent,
`name`/`model`/`tools` en frontmatter Claude Code, `acf_*` en métadonnées
de documentation, corps = system prompt copié verbatim depuis la feuille
6). Le backlog fonctionnel est dans `.claude/backlog/grc-actions.yaml`,
généré depuis la feuille 8 — c'est ce fichier qui dit aux agents quoi
construire (voir son en-tête pour le flux de découverte par agent).

**Hiérarchie** : N0 = HUMAN (Jean-Philippe, Product Owner — décision
finale, valide avant toute action irréversible, reçoit les escalades)
> N1 = A02 Orchestrator (chef de pipeline, décide de l'ordre
d'activation, escalade vers HUMAN si bloqué) > N2 = agents spécialistes
(un par domaine technique ou GRC).

**Agent teams** (feuille 4) :
- `core-team` — A01, A02, A22 : pipeline principal (intake →
  orchestration → release)
- `product-team` — A03, A04, A21 : produit, UX, documentation
- `tech-team` — A05, A06, A07 : architecture, backend, base de données
- `qa-team` — A08 : tests et qualité
- `security-team` — A10, A23 : sécurité, audit
- `grc-team` — A13, A14, A15 : risques, compliance, privacy
- `infra-team` — A09, A16 : DevOps, infrastructure GCP

**can_spawn_agents** : seul HUMAN valide/débloque, seul A02 peut spawner
n'importe quel agent, et seul A06 (Dev Backend) peut spawner — uniquement
A07 (Dev DB), et uniquement pour une migration liée à une feature qu'il
implémente. Tous les autres agents de la feuille 4 ont `can_spawn_agents
= NON`. Ne fais pas spawner un agent qui n'a pas ce droit dans la feuille
4.

**Règles de sécurité transverses** (issues des system prompts feuille 6
et du catalogue GRC ACTIONS feuille 8, en plus des conventions déjà
listées ci-dessus) :
- `tenant_id` obligatoire sur toute table business et sur tout filtre de
  lecture (ex. ACT-071, ACT-230/231 sur l'audit trail).
- Soft-delete uniquement — jamais de `DELETE FROM` physique sur une
  table métier ; les system prompts A05/A06/A07 le répètent comme
  contrainte absolue.
- Maker-checker : l'exécuteur d'une action n'est jamais son propre
  validateur (ex. ACT-093/ACT-113 : un admin ne peut pas s'attribuer ses
  propres rôles).
- `audit_logs` est append-only strict (voir section Audit ci-dessous).
- A10 (Security) escalade vers HUMAN dès qu'une vulnérabilité atteint un
  CVSS ≥ 7 ; ne pas laisser un agent N2 trancher seul au-delà de ce
  seuil.

**JEV Decision Engine = DISABLED** (`JEV = NON` dans le classeur ACF).
Conséquence directe : A00 (Decision Router) est désactivé, et tous les
skills marqués `JEV_DYNAMIC` (feuille 9️⃣ SKILL REGISTRY) tombent en
`fallback_skills_mode = ALL_ACTIVE` — c'est-à-dire chargés/activés
automatiquement plutôt que routés dynamiquement par un moteur de
décision central.

### Domaine Audit

- `backend/src/domain/entities/AuditEvent.ts` porte déjà `tenantId`, et
  `AuditRepository` (`domain/repositories/AuditRepository.ts`) n'expose
  que `record`/`listForEntity`/`listRecent`/`search` — pas d'`update` ni
  de `delete`, ce qui applique l'append-only strict voulu par A23
  (Audit) et son `disallowedTools` (`update_audit_log`,
  `delete_audit_log` en feuille 5).
- `AuditLogService` vérifie la permission `audit.read` et scope toujours
  par `actor.tenantId` avant de lire — c'est le point d'accès qui
  correspond à ACT-071 (« Consulter l'audit trail », acteur Auditeur).
  `GET /audit-logs` accepte désormais les filtres `userId`, `action`,
  `entityType`, `entityId`, `from`, `to` (ACT-071, ACT-230/231) via
  `AuditRepository.search` — optionnel sur l'interface pour ne pas
  casser les faux-repository des tests existants (seul
  `PostgresAuditRepository` l'implémente).
- Le rôle applicatif « Auditeur » (ACT-093, ACT-110 à ACT-118) existe
  désormais via le module RBAC : `domain/entities/Role.ts` +
  `RoleRepository`/`RoleService`/`roles.routes.ts`, tables `roles` /
  `user_roles` (migration `013_roles.sql`). Un rôle « Auditeur » limité
  à `audit.read` est seedé en dev
  (`database/postgresql/seed/dev_seed.sql`) et assignable via
  `POST /api/v1/roles/:id/assign` — l'assigner donne un accès
  lecture-seule à l'audit trail, tenant-scopé, sans jamais pouvoir
  écrire (`RoleService` applique le maker-checker : un admin ne peut ni
  s'auto-assigner ni s'auto-révoquer un rôle).

## Amorçage d'un agent ACF (onboarding)

Les 16 fichiers `.claude/agents/*.md` portent un `tools:` en vrais noms
d'outils Claude Code (`Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`,
`Agent` selon le rôle) — la liste ACF d'origine (`read_yaml`,
`write_code`, `spawn_agent`, …) est conservée telle quelle dans
`acf_tools_conceptual` pour traçabilité, mais n'est plus ce que Claude
Code lit pour autoriser l'accès aux outils. Le corps de chaque fichier
(le system prompt) reste le texte ACF verbatim — sacré, jamais
reformulé — donc il ne contient aucune connaissance spécifique à ce
repo. Un agent frais (spawné via l'outil `Agent`, pas un fork) démarre
avec cette identité générique et rien d'autre : c'est à l'orchestrateur
(toi ou moi jouant A02) de fournir le contexte repo dans le prompt de
dispatch. Avant de dispatcher un travail réel à un agent frais :

1. **Fais-le lire les sections déjà existantes** de ce fichier :
   « Backend architecture » (les 4 couches), « Adding a new domain
   module » (la recette en 9 étapes), « Security-sensitive
   conventions » (tenant_id, soft-delete, maker-checker) — ne duplique
   pas ce contenu dans le prompt de dispatch, pointe dessus.
2. **Signale les fichiers partagés à haut risque de conflit** :
   `backend/src/server.ts` et `backend/src/domain/permissions.ts` sont
   modifiés par quasiment chaque nouveau module (wiring + permissions).
   Dès que plus d'un agent A06 travaille en parallèle sur ce dépôt,
   dispatcher chacun avec `isolation: "worktree"` (mode par défaut
   depuis le batch 2) — jamais laisser deux agents éditer ces fichiers
   dans le même répertoire de travail en même temps. L'orchestrateur
   fusionne les worktrees un par un ensuite (conflit attendu et trivial
   sur `permissions.ts` : deux blocs de nouvelles lignes en fin d'union
   de types et de tableau).
3. **Rappelle le pattern « paramètre optionnel »** pour ne jamais
   casser un test existant : quand un service gagne une nouvelle
   dépendance (ex. `Notifier` dans `FeedbackService`), elle doit être
   un paramètre de constructeur optionnel avec garde (`this.dep?.x()`),
   jamais un paramètre requis ajouté à un constructeur déjà utilisé par
   des tests non modifiables.
4. **Rappelle la numérotation séquentielle des migrations** — vérifier
   le dernier numéro dans `database/postgresql/migrations/` avant d'en
   créer une nouvelle, jamais réutiliser ou deviner un numéro.
5. **Donne la tâche précise** depuis `.claude/backlog/grc-actions.yaml`
   (un ou plusieurs `id: ACT-xxx`), pas juste un domaine — un agent
   frais ne sait pas deviner quel sous-ensemble tu veux.
6. **Demande une vérification avant de rapporter fini** :
   `npm run typecheck && npm test` côté backend, `npm run build` côté
   frontend, systématiquement avant de considérer une tâche terminée.
   Un agent A06 n'écrit que des tests de **niveau 1** (cas heureux +
   validations directement liées à son propre code) — la couverture des
   cas limites inter-modules revient à A08 (QA), en aval, jamais au même
   agent qui a écrit le code testé.
7. **Consulte `.claude/agent-context/`** avant de rédiger le prompt de
   dispatch : `SHARED_LOG.md` (grep le tag `@<rôle>` de l'agent que tu
   dispatches) et `ACTION_ITEMS.md` (un point déjà ouvert sur son
   périmètre ?). Après le dispatch, si l'agent a pris une décision qui
   concerne le périmètre d'un autre rôle (même non dispatché), ajoute
   une entrée dans `SHARED_LOG.md` avec le bon tag — c'est le mécanisme
   de "mise en copie" qui permet à un agent jamais appelé de ne pas
   repartir de zéro le jour où on l'active. Ce qui a une valeur au-delà
   de ce seul projet (une convention, une règle d'autorisation) se
   reporte en plus dans `~/.agentic-framework/agents/<rôle>/LEARNINGS.md`
   (en dehors du dépôt — survit au projet, alimente le suivant).
8. **Passages QA (A08) et sécurité (A10) après chaque batch livré/mergé**
   — non optionnels, pas seulement en début de projet. Voir
   `.claude/agent-context/ACTION_ITEMS.md` pour les passages déjà en
   retard sur ce projet.

Pour du travail répétitif sur ce même repo (ex. plusieurs modules du
backlog en parallèle), un **fork** de la session en cours est presque
toujours préférable à un agent frais : il hérite de tout ce contexte
sans qu'il faille le rebriefer, et partage le cache de prompt. Réserve
les 16 agents ACF aux cas où l'identité/le ton spécifique du rôle
compte (ex. faire challenger une décision par `security.md` avec son
ton "paranoïaque bienveillant, zero-trust").
