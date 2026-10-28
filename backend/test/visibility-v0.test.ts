import { describe, expect, it } from "vitest";
import { isVisible, SEES_EVERYTHING, type ReadScope } from "../src/domain/visibility.js";
import { visibilityClause } from "../src/infrastructure/database/postgres/visibilityFilter.js";
import { PostgresRiskRepository } from "../src/infrastructure/database/postgres/PostgresRiskRepository.js";
import { VisibilityResolver } from "../src/services/VisibilityResolver.js";
import { RiskService } from "../src/services/RiskService.js";
import type { Role } from "../src/domain/entities/Role.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { hasLocalPg, migrationSql, useMigrationTenant } from "./migrationHarness.js";

/**
 * DECISION-100 lot V0 (migration 080): the model and the single read filter are in place, nothing visible changes.
 * Static/unit part always runs; the live part (080 re-run + a forced restricted row) needs a disposable local database
 * (QA_SWP_PGHOST unix socket, 001..080 applied).
 */
const UP = migrationSql("080_resource_visibility.sql");
const actor: AuthenticatedUser = { userId: "u1", tenantId: "t1", email: "a@x", displayName: "A", roles: ["risk.read"], dashboardScopeMode: "GLOBAL" };
const role = (systemGroup: Role["systemGroup"]) => ({ systemGroup }) as Role;

describe("visibility V0 — model and single filter point", () => {
  it("080 defaults every root resource to CLIENT, so existing rows keep today's behaviour", () => {
    for (const table of ["risks", "controls", "anomalies", "action_plans", "kpis"]) {
      expect(UP).toMatch(new RegExp(`ALTER TABLE ${table}\\s+ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'CLIENT'`));
    }
    expect(UP).toMatch(/CREATE TABLE IF NOT EXISTS resource_access_grants/);
    expect(UP).toMatch(/rag_no_self_grant_check CHECK \(granted_by <> user_id\)/);
  });

  it("the SQL filter adds nothing without a scope or for a 'sees everything' scope, and keeps CLIENT rows otherwise", () => {
    expect(visibilityClause(undefined)).toBe("");
    expect(visibilityClause({ all: true })).toBe("");
    expect(visibilityClause({ all: false })).toBe("AND visibility = 'CLIENT'");
    expect(isVisible("PERIMETRE", undefined)).toBe(true);
    expect(isVisible("NOMINATIF", { all: true })).toBe(true);
    expect(isVisible("CLIENT", { all: false })).toBe(true);
    expect(isVisible("PERIMETRE", { all: false })).toBe(false);
  });

  it("Risk Manager, Committee and Audit see everything; anyone else (administrators included, q197) is scoped", async () => {
    expect([...SEES_EVERYTHING]).toEqual(["RISK_MANAGER", "RISK_COMMITTEE", "AUDIT"]);
    for (const g of SEES_EVERYTHING) {
      const resolver = new VisibilityResolver({ listForUser: async () => [role(null), role(g)] });
      expect(await resolver.resolve(actor)).toEqual({ all: true });
    }
    const ordinary = new VisibilityResolver({ listForUser: async () => [role(null)] });
    expect(await ordinary.resolve(actor)).toEqual({ all: false });
  });

  it("the service passes the reader's scope to the repository; without a resolver it passes nothing (no filter)", async () => {
    const seen: (ReadScope | undefined)[] = [];
    const risks = {
      getById: async (_t: string, _id: string, scope?: ReadScope) => { seen.push(scope); return { id: "r1" }; },
      list: async (_t: string, _o: unknown, scope?: ReadScope) => { seen.push(scope); return []; },
    } as unknown as RiskRepository;
    const audit = {} as AuditRepository;
    const resolver = new VisibilityResolver({ listForUser: async () => [] });

    await new RiskService(risks, audit).get(actor, "r1");
    await new RiskService(risks, audit, undefined, undefined, undefined, undefined, undefined, resolver).get(actor, "r1");
    await new RiskService(risks, audit, undefined, undefined, undefined, undefined, undefined, resolver).list(actor);
    expect(seen).toEqual([undefined, { all: false }, { all: false }]);
  });
});

describe.skipIf(!hasLocalPg)("visibility V0 (real PostgreSQL)", () => {
  const { ctx, one } = useMigrationTenant("v0");

  it("080 is idempotent; a CLIENT risk is read by everyone, a forced PERIMETRE risk only by a 'sees everything' scope", async () => {
    await ctx.pool.query(UP); // re-run on top of 001..080: no error, nothing changes
    const insert = (title: string) =>
      one(`INSERT INTO risks (tenant_id, process, description) VALUES ($1, 'v0', $2) RETURNING id, visibility`, [ctx.tenant, title]);
    const open = await insert("V0 ouvert");
    expect(open.visibility).toBe("CLIENT");
    const restricted = (await insert("V0 restreint")).id;
    await ctx.pool.query(`UPDATE risks SET visibility = 'PERIMETRE' WHERE id = $1`, [restricted]);

    const repo = new PostgresRiskRepository(ctx.pool);
    const ids = async (scope?: ReadScope) => (await repo.list(ctx.tenant, {}, scope)).map((r) => r.id).sort();
    expect(await ids()).toEqual([open.id, restricted].sort());
    expect(await ids({ all: true })).toEqual([open.id, restricted].sort());
    expect(await ids({ all: false })).toEqual([open.id]);
    expect(await repo.getById(ctx.tenant, restricted, { all: false })).toBeNull();
    expect((await repo.getById(ctx.tenant, restricted, { all: true }))?.id).toBe(restricted);
  });

  it("an access grant is append-only and never self-granted", async () => {
    const user = (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'U') RETURNING id`, [ctx.tenant, `u-${Math.random()}@v0`])).id;
    const other = (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'O') RETURNING id`, [ctx.tenant, `o-${Math.random()}@v0`])).id;
    const grant = (rid: string, by: string) => ctx.pool.query(
      `INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason) VALUES ($1, 'RISK', $2, $3, $4, 'v0') RETURNING id`,
      [ctx.tenant, rid, user, by]);
    const rid = crypto.randomUUID();
    await expect(grant(rid, user)).rejects.toThrow(/rag_no_self_grant_check/);
    const id = (await grant(rid, other)).rows[0].id;
    await expect(ctx.pool.query(`DELETE FROM resource_access_grants WHERE id = $1`, [id])).rejects.toThrow(/never deleted/);
    await expect(ctx.pool.query(`UPDATE resource_access_grants SET grant_reason = 'x' WHERE id = $1`, [id])).rejects.toThrow(/immutable/);
    await ctx.pool.query(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = 'fin' WHERE id = $1`, [id, other]);
    await expect(ctx.pool.query(`UPDATE resource_access_grants SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE id = $1`, [id])).rejects.toThrow(/revoked once/);
  });
});
