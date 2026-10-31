import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RiskService } from "../src/services/RiskService.js";
import { RoleService } from "../src/services/RoleService.js";
import { KriService } from "../src/services/KriService.js";
import { riskVisibilityClause } from "../src/infrastructure/database/postgres/visibilityFilter.js";
import { readerScope, SYSTEM_SCOPE, type ReadScope } from "../src/domain/visibility.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import type { Risk, RiskVisibilityChange, RiskVisibilityState } from "../src/domain/entities/Risk.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import { PostgresRiskRepository } from "../src/infrastructure/database/postgres/PostgresRiskRepository.js";
import { hasLocalPg, migrationSql, useMigrationTenant } from "./migrationHarness.js";

/** Lot V1 (DECISION-102) — level 1: q203 audit.read, risk visibility on create / change, inheritance, the SQL clause. */
const T = "t1";
const OWNER = "11111111-1111-4111-8111-111111111111";
const RM = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const actor = (userId: string, roles: string[]): AuthenticatedUser =>
  ({ userId, tenantId: T, email: "a@x", displayName: "A", roles, dashboardScopeMode: "GLOBAL" }) as AuthenticatedUser;

const risk = (over: Partial<Risk> = {}): Risk => ({ id: "r1", tenantId: T, ownerId: OWNER, visibility: "PERIMETRE", status: "DRAFT" }) as Risk & typeof over;

function fixture(opts: { access?: string[]; visibility?: Risk["visibility"]; hidden?: string[] } = {}) {
  let state: RiskVisibilityState = { visibility: opts.visibility ?? "PERIMETRE", accessUserIds: [...(opts.access ?? [])] };
  const changes: RiskVisibilityChange[] = [];
  const audits: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
  const created: unknown[] = [];
  const risks = {
    getById: async (_t: string, id: string) => (id === "r1" ? { ...risk(), visibility: state.visibility } : null),
    list: async () => [],
    listAccess: async () => [...state.accessUserIds],
    changeVisibility: async (_t: string, _id: string, c: RiskVisibilityChange) => {
      changes.push(c);
      const before = state;
      const keep = before.accessUserIds.filter((u) => !c.revokeUserIds.includes(u));
      state = { visibility: c.visibility, accessUserIds: [...keep, ...c.addUserIds] };
      return { before, after: state };
    },
    creatorWouldSee: async (_t: string, _u: string, v: { visibility: string }) => v.visibility !== "NOMINATIF",
    create: async (input: unknown) => { created.push(input); return { ...risk(), ...(input as object), id: "new" } as Risk; },
    hiddenIds: async (_t: string, ids: string[], _s: ReadScope) => ids.filter((id) => (opts.hidden ?? []).includes(id)),
  };
  const audit = { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { audits.push(e); return e as AuditEvent; } };
  const users = {
    getById: async (_t: string, id: string) => (id === OTHER || id === RM || id === OWNER ? { id, deletedAt: null } : null),
    listWithPermission: async () => [{ id: RM, displayName: "RM" }],
  };
  const notifications = { create: vi.fn(async (n: unknown) => n) };
  const service = new RiskService(risks as never, audit as never, undefined, users as never, undefined, undefined, undefined, undefined, notifications as never);
  return { service, changes, audits, created, notifications, get state() { return state; } };
}

describe("q203 — audit.read belongs to the Audit group only", () => {
  it("RoleService refuses audit.read on an ordinary role", async () => {
    const roles = { getById: async () => null, create: vi.fn(), listForUser: async () => [] };
    const s = new RoleService(roles as never, { record: vi.fn() } as never);
    await expect(s.create(actor(RM, ["role.create"]), { name: "Lecteurs", permissions: ["audit.read"] } as never, "req")).rejects.toThrow(ValidationError);
    expect(roles.create).not.toHaveBeenCalled();
  });

  it("migration 081 strips audit.read from non-AUDIT roles and users.roles, with an audit row by a suspended technical account", () => {
    const dir = join(__dirname, "..", "..", "database", "postgresql", "migrations");
    const sql = readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith("081_") && !f.endsWith(".down.sql"))!), "utf8");
    expect(sql).toMatch(/array_remove\(r\.permissions,\s*'audit\.read'\)/);
    expect(sql).toMatch(/system_group IS DISTINCT FROM 'AUDIT'/);
    expect(sql).toMatch(/UPDATE users/);
    expect(sql).toMatch(/migration-081@system\.invalid/);
  });
});

describe("risk visibility — creation", () => {
  it("a restricted risk records the list with the caller as author; the caller never adds themselves", async () => {
    const f = fixture();
    await f.service.create(actor(OWNER, ["risk.create"]), { title: "R", process: "P", description: "D", visibility: "PERIMETRE", accessUserIds: [OTHER] } as never, "req");
    expect(f.created[0]).toMatchObject({ visibility: "PERIMETRE", accessUserIds: [OTHER], grantedBy: OWNER });
    await expect(f.service.create(actor(OWNER, ["risk.create"]), { title: "R", process: "P", description: "D", visibility: "PERIMETRE", accessUserIds: [OWNER] } as never, "req")).rejects.toThrow(ValidationError);
  });

  it("a creator who would not see the risk is refused; a list on a CLIENT risk is refused", async () => {
    const f = fixture();
    await expect(f.service.create(actor(OWNER, ["risk.create"]), { title: "R", process: "P", description: "D", visibility: "NOMINATIF", accessUserIds: [OTHER] } as never, "req")).rejects.toThrow(/would not see/);
    await expect(f.service.create(actor(OWNER, ["risk.create"]), { title: "R", process: "P", description: "D", visibility: "CLIENT", accessUserIds: [OTHER] } as never, "req")).rejects.toThrow(ValidationError);
  });
});

describe("risk visibility — change (q194, q199)", () => {
  it("neither owner nor resourcevisibility.set: forbidden", async () => {
    const f = fixture();
    await expect(f.service.setVisibility(actor(OTHER, ["risk.read"]), "r1", { visibility: "CLIENT", reason: "Ouverture" }, "req")).rejects.toThrow(ForbiddenError);
  });

  it("a reason is mandatory; nobody adds themselves", async () => {
    const f = fixture();
    await expect(f.service.setVisibility(actor(OWNER, ["risk.read"]), "r1", { visibility: "NOMINATIF", reason: " " }, "req")).rejects.toThrow(ValidationError);
    await expect(f.service.setVisibility(actor(RM, ["risk.read", "resourcevisibility.set"]), "r1", { visibility: "NOMINATIF", addUserIds: [RM], reason: "Restreindre" }, "req")).rejects.toThrow(/yourself/);
  });

  it("RM restricts with a list: one PERMISSION_CHANGE audit row with the reason, no notification", async () => {
    const f = fixture({ visibility: "CLIENT" });
    const after = await f.service.setVisibility(actor(RM, ["risk.read", "resourcevisibility.set"]), "r1", { visibility: "NOMINATIF", addUserIds: [OTHER], reason: "Dossier sensible" }, "req");
    expect(after).toEqual({ visibility: "NOMINATIF", accessUserIds: [OTHER] });
    expect(f.changes[0]).toMatchObject({ changedBy: RM, reason: "Dossier sensible" });
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0]).toMatchObject({ action: "PERMISSION_CHANGE", entityType: "Risk", entityId: "r1", reason: "Dossier sensible" });
    expect(f.audits[0]!.newValue).toMatchObject({ visibility: "NOMINATIF", widening: false });
    expect(f.notifications.create).not.toHaveBeenCalled();
  });

  it("back to CLIENT by the owner revokes the whole list and notifies the Risk Manager group", async () => {
    const f = fixture({ visibility: "NOMINATIF", access: [OTHER] });
    const after = await f.service.setVisibility(actor(OWNER, ["risk.read"]), "r1", { visibility: "CLIENT", reason: "Plus sensible" }, "req");
    expect(after).toEqual({ visibility: "CLIENT", accessUserIds: [] });
    expect(f.changes[0]!.revokeUserIds).toEqual([OTHER]);
    expect(f.audits[0]!.newValue).toMatchObject({ widening: true });
    expect(f.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: RM, eventType: "RISK_VISIBILITY_WIDENED", resourceId: "r1" }));
  });
});

describe("inheritance (q193): a KRI of a hidden risk answers like a missing one", () => {
  it("get -> 404, list -> filtered", async () => {
    const kris = {
      getById: async () => ({ id: "k1", tenantId: T, riskId: "hidden" }),
      list: async () => [{ id: "k1", riskId: "hidden" }, { id: "k2", riskId: "open" }],
    };
    const risks = { hiddenIds: async (_t: string, ids: string[]) => ids.filter((i) => i === "hidden") };
    const s = new KriService(kris as never, { getLatest: async () => null } as never, risks as never, { record: vi.fn() } as never);
    await expect(s.get(actor(OTHER, ["kri.read"]), "k1")).rejects.toThrow(NotFoundError);
    const listed = (await s.list(actor(OTHER, ["kri.read"]))) as Array<{ id: string }>;
    expect(listed.map((k) => k.id)).toEqual(["k2"]);
  });
});

describe("riskVisibilityClause", () => {
  it("nothing for sees-all; CLIENT only without a reader; risk_visible_to with the validated reader id", () => {
    expect(riskVisibilityClause(SYSTEM_SCOPE)).toBe("");
    expect(riskVisibilityClause({ all: false })).toMatch(/visibility = 'CLIENT'/);
    expect(riskVisibilityClause(readerScope({ userId: OWNER }))).toContain(`risk_visible_to(tenant_id, id, '${OWNER}'::uuid)`);
    expect(() => riskVisibilityClause({ all: false, userId: "x'; DROP TABLE risks;--" })).toThrow();
  });

  it("migration 082 pins search_path with pg_temp last and grants resourcevisibility.set to the Risk Manager group", () => {
    const dir = join(__dirname, "..", "..", "database", "postgresql", "migrations");
    const sql = readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith("082_") && !f.endsWith(".down.sql"))!), "utf8");
    expect(sql).toMatch(/FUNCTION risk_visible_to[\s\S]*?SET search_path = pg_catalog, public, pg_temp/);
    expect(sql).toMatch(/resourcevisibility\.set/);
  });
});

describe.skipIf(!hasLocalPg)("visibility V1 (real PostgreSQL, local only)", () => {
  const { ctx, one } = useMigrationTenant("v1");
  const user = async (name: string) =>
    (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`, [ctx.tenant, `${name}-${Math.random()}@v1`, name])).id as string;
  const role = async (group: string | null, departmentId: string | null = null) =>
    (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group, department_id) VALUES ($1, $2, '{}', $3, $4) RETURNING id`,
      [ctx.tenant, `r-${Math.random()}`, group, departmentId])).id as string;
  const member = (roleId: string, userId: string, by: string) =>
    one(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4) RETURNING id`, [ctx.tenant, roleId, userId, by]);
  const sees = async (riskId: string, userId: string) =>
    (await one(`SELECT risk_visible_to($1, $2, $3) AS v`, [ctx.tenant, riskId, userId])).v as boolean;

  it("risk_visible_to: perimeter = owner, N+1, RACI, process owner, department group, list; NOMINATIF = owner + list; RM sees all", async () => {
    const [o, s, r, po, dm, g, rm, x] = await Promise.all(["o", "s", "r", "po", "dm", "g", "rm", "x"].map(user));
    const dept = (await one(`INSERT INTO departments (tenant_id, name) VALUES ($1, 'Dpt V1') RETURNING id`, [ctx.tenant])).id;
    const proc = (await one(`INSERT INTO processes (tenant_id, level, name, owner_user_id) VALUES ($1, 'PROCESS', 'Proc V1', $2) RETURNING id`, [ctx.tenant, po])).id;
    await member(await role(null, dept), dm!, o!);
    await member(await role("RISK_MANAGER"), rm!, o!);
    const riskId = (await one(
      `INSERT INTO risks (tenant_id, process, description, owner_id, superior_owner_id, process_id, owner_department_id, visibility)
       VALUES ($1, 'v1', 'risque restreint', $2, $3, $4, $5, 'PERIMETRE') RETURNING id`, [ctx.tenant, o, s, proc, dept])).id;
    await one(`INSERT INTO raci_assignments (tenant_id, entity_type, entity_id, user_id, role, created_by) VALUES ($1, 'RISK', $2, $3, 'C', $4) RETURNING id`, [ctx.tenant, riskId, r, o]);
    await one(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason) VALUES ($1, 'RISK', $2, $3, $4, 'test') RETURNING id`, [ctx.tenant, riskId, g, o]);

    for (const u of [o, s, r, po, dm, g, rm]) expect(await sees(riskId, u!), u).toBe(true);
    expect(await sees(riskId, x!)).toBe(false);

    await ctx.pool.query(`UPDATE risks SET visibility = 'NOMINATIF' WHERE id = $1`, [riskId]);
    for (const u of [o, g, rm]) expect(await sees(riskId, u!)).toBe(true);
    for (const u of [s, r, po, dm, x]) expect(await sees(riskId, u!)).toBe(false);

    const repo = new PostgresRiskRepository(ctx.pool);
    expect(await repo.getById(ctx.tenant, riskId, readerScope({ userId: x! }))).toBeNull();
    expect((await repo.getById(ctx.tenant, riskId, readerScope({ userId: g! })))?.visibility).toBe("NOMINATIF");
    expect(await repo.hiddenIds(ctx.tenant, [riskId], readerScope({ userId: x! }))).toEqual([riskId]);
    expect(await repo.hiddenIds(ctx.tenant, [riskId], readerScope({ userId: g! }))).toEqual([]);

    // back to CLIENT with the list revoked: one transaction, the revocation carries its author and reason
    const { after } = await repo.changeVisibility(ctx.tenant, riskId, { visibility: "CLIENT", addUserIds: [], revokeUserIds: [g!], reason: "Ouverture", changedBy: rm! });
    expect(after).toEqual({ visibility: "CLIENT", accessUserIds: [] });
    expect(await one(`SELECT revoked_by, revoke_reason FROM resource_access_grants WHERE resource_id = $1`, [riskId])).toEqual({ revoked_by: rm, revoke_reason: "Ouverture" });
    expect(await sees(riskId, x!)).toBe(true);
  });

  it("creation writes the list with the risk; the creator check follows the department group and the process owner", async () => {
    const [c, g, po] = await Promise.all(["c", "g", "po"].map(user));
    const dept = (await one(`INSERT INTO departments (tenant_id, name) VALUES ($1, 'Dpt V1b') RETURNING id`, [ctx.tenant])).id;
    const proc = (await one(`INSERT INTO processes (tenant_id, level, name, owner_user_id) VALUES ($1, 'PROCESS', 'Proc V1b', $2) RETURNING id`, [ctx.tenant, po])).id;
    const repo = new PostgresRiskRepository(ctx.pool);
    expect(await repo.creatorWouldSee(ctx.tenant, c!, { visibility: "PERIMETRE", ownerDepartmentId: dept, processId: null })).toBe(false);
    await member(await role(null, dept), c!, po!);
    expect(await repo.creatorWouldSee(ctx.tenant, c!, { visibility: "PERIMETRE", ownerDepartmentId: dept, processId: null })).toBe(true);
    expect(await repo.creatorWouldSee(ctx.tenant, po!, { visibility: "PERIMETRE", ownerDepartmentId: null, processId: proc })).toBe(true);

    const created = await repo.create({ tenantId: ctx.tenant, process: "v1", description: "créé restreint", ownerDepartmentId: dept, visibility: "PERIMETRE", accessUserIds: [g!], grantedBy: c! });
    expect(created.visibility).toBe("PERIMETRE");
    expect(await repo.listAccess(ctx.tenant, created.id)).toEqual([g]);
  });

  it("082 is idempotent and down -> up gives the function back, search_path pinned", async () => {
    const up = migrationSql("082_risk_visibility.sql");
    await ctx.pool.query(up);
    await ctx.pool.query(migrationSql("082_risk_visibility.down.sql"));
    expect((await one(`SELECT to_regprocedure('risk_visible_to(uuid,uuid,uuid)') AS f`)).f).toBeNull();
    await ctx.pool.query(up);
    await ctx.pool.query(`INSERT INTO schema_migrations (filename) VALUES ('082_risk_visibility.sql') ON CONFLICT DO NOTHING`);
    const cfg = (await one(`SELECT proconfig FROM pg_proc WHERE proname = 'risk_visible_to'`)).proconfig as string[];
    expect(cfg).toEqual(["search_path=pg_catalog, public, pg_temp"]);
  });
});
