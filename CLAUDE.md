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

## Adding a new domain module (e.g. Controls, Executions)

Follow the `Risk` / `Evidence` vertical slices as the template, in this
order: `domain/entities/X.ts` → `domain/repositories/XRepository.ts`
(interface) → `infrastructure/database/postgres/PostgresXRepository.ts`
→ `services/XService.ts` (permissions + rules + audit) →
`api/v1/x.routes.ts` → wire into `server.ts` → migration in
`database/postgresql/migrations/NNN_x.sql`. Add the new permission
strings to `domain/permissions.ts`'s `Permission` union.

## Security-sensitive conventions

- Soft delete only (`deleted_at`/`status` columns) — no `DELETE FROM` in
  application code, this is a compliance/audit requirement, not a style
  preference.
- `tenant_id` on every business table from the first migration touching
  it, even though the product is currently single-tenant.
- Secrets only via env vars (`backend/.env`, `frontend/.env.local`),
  never committed — see `.gitignore`.
