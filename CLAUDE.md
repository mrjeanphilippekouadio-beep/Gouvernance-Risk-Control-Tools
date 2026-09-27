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
