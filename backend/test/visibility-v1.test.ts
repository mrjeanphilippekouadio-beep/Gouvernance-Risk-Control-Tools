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
import { RaciAssignmentService } from "../src/services/RaciAssignmentService.js";
import { ControlService } from "../src/services/ControlService.js";
import { AnomalyService } from "../src/services/AnomalyService.js";
import { RiskEvaluationViewService } from "../src/services/RiskEvaluationViewService.js";
import { UserService } from "../src/services/UserService.js";
import { PostgresUserRepository } from "../src/infrastructure/database/postgres/PostgresUserRepository.js";
import { corsOptions } from "../src/api/corsOptions.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { maskCoveredRisks, maskRiskSource } from "../src/services/riskVisibility.js";
import express from "express";
import cors from "cors";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

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
    expect(after).toMatchObject({ visibility: "NOMINATIF", accessUserIds: [OTHER], accessUsers: [{ id: OTHER, displayName: null }] });
    expect(f.changes[0]).toMatchObject({ changedBy: RM, reason: "Dossier sensible" });
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0]).toMatchObject({ action: "PERMISSION_CHANGE", entityType: "Risk", entityId: "r1", reason: "Dossier sensible" });
    expect(f.audits[0]!.newValue).toMatchObject({ visibility: "NOMINATIF", widening: false });
    expect(f.notifications.create).not.toHaveBeenCalled();
  });

  it("back to CLIENT by the owner revokes the whole list and notifies the Risk Manager group", async () => {
    const f = fixture({ visibility: "NOMINATIF", access: [OTHER] });
    const after = await f.service.setVisibility(actor(OWNER, ["risk.read"]), "r1", { visibility: "CLIENT", reason: "Plus sensible" }, "req");
    expect(after).toMatchObject({ visibility: "CLIENT", accessUserIds: [] });
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
    expect(after).toMatchObject({ visibility: "CLIENT", accessUserIds: [] });
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

// ============================================================== fix pass (SEC V1-01/02/04, QA-VIS1-01/02/03/05, q205)
describe("SEC V1-01 — the department link of a role one holds goes through another administrator", () => {
  const role = { id: "r1", tenantId: T, name: "Équipe", permissions: [], systemGroup: null, departmentId: null, deletedAt: null };
  const make = (held: string[], departmentId: string | null = null) => new RoleService({
    getById: async () => ({ ...role, departmentId }),
    listForUser: async () => held.map((id) => ({ ...role, id })),
    update: vi.fn(async () => ({ ...role, departmentId: "d1" })),
  } as never, { record: vi.fn() } as never);
  const admin = actor(RM, ["role.read", "role.update"]);

  it("linking or unlinking a held role to a department: 403, before any write", async () => {
    await expect(make(["r1"]).update(admin, "r1", { departmentId: "d1" } as never, "req")).rejects.toThrow(/department of a role you hold/);
    await expect(make(["r1"], "d0").update(admin, "r1", { departmentId: null } as never, "req")).rejects.toThrow(/department of a role you hold/);
    // a role one does not hold: the guard does not apply
    await expect(make(["other"]).update(admin, "r1", { departmentId: "d1" } as never, "req")).rejects.not.toThrow(/role you hold/);
  });
});

describe("SEC V1-02 — the department or process of a restricted risk changes like its visibility", () => {
  const DEPT2 = "44444444-4444-4444-8444-444444444444";
  function fx(visibility: Risk["visibility"]) {
    const audits: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
    const update = vi.fn(async (_t: string, _id: string, input: Record<string, unknown>) => ({ ...risk(), visibility, ownerDepartmentId: input.ownerDepartmentId ?? null, processId: null }) as Risk);
    const risks = { getById: async () => ({ ...risk(), visibility, ownerDepartmentId: null, processId: null }), update };
    const notifications = { create: vi.fn(async (n: unknown) => n) };
    const users = { getById: async () => null, listWithPermission: async () => [{ id: RM, displayName: "RM" }] };
    const departments = { getById: async () => ({ id: DEPT2, deletedAt: null }) };
    const s = new RiskService(risks as never, { record: async (e: never) => { audits.push(e); } } as never, departments as never, users as never,
      undefined, undefined, undefined, undefined, notifications as never);
    return { s, audits, update, notifications };
  }

  it("CLIENT risk: nothing changes (no reason, no extra audit row)", async () => {
    const f = fx("CLIENT");
    await f.s.update(actor(OTHER, ["risk.read", "risk.update"]), "r1", { ownerDepartmentId: DEPT2 }, "req");
    expect(f.audits.map((a) => a.action)).toEqual(["UPDATE"]);
  });

  it("restricted risk: neither owner nor RM -> 403; owner without reason -> 400; nothing written", async () => {
    const f = fx("PERIMETRE");
    await expect(f.s.update(actor(OTHER, ["risk.read", "risk.update"]), "r1", { ownerDepartmentId: DEPT2, reason: "x" }, "req")).rejects.toThrow(ForbiddenError);
    await expect(f.s.update(actor(OWNER, ["risk.read", "risk.update"]), "r1", { ownerDepartmentId: DEPT2 }, "req")).rejects.toThrow(ValidationError);
    expect(f.update).not.toHaveBeenCalled();
  });

  it("owner widens a PERIMETRE risk: PERMISSION_CHANGE with reason and widening, RM notified; the reason is never stored on the risk", async () => {
    const f = fx("PERIMETRE");
    await f.s.update(actor(OWNER, ["risk.read", "risk.update"]), "r1", { ownerDepartmentId: DEPT2, reason: "Réorganisation" }, "req");
    expect(f.update.mock.calls[0]![2]).not.toHaveProperty("reason");
    expect(f.audits.map((a) => a.action)).toEqual(["UPDATE", "PERMISSION_CHANGE"]);
    expect(f.audits[1]).toMatchObject({ reason: "Réorganisation", newValue: { ownerDepartmentId: DEPT2, widening: true } });
    expect(f.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ eventType: "RISK_VISIBILITY_WIDENED" }));
  });

  it("RM changes the department of a NOMINATIF risk: allowed with reason, not a widening, no notification", async () => {
    const f = fx("NOMINATIF");
    await f.s.update(actor(RM, ["risk.read", "risk.update", "resourcevisibility.set"]), "r1", { ownerDepartmentId: DEPT2, reason: "Rattachement" }, "req");
    expect(f.audits[1]).toMatchObject({ action: "PERMISSION_CHANGE", newValue: { widening: false } });
    expect(f.notifications.create).not.toHaveBeenCalled();
  });
});

describe("QA-VIS1-01/02/03 — a hidden risk answers like an unknown one and its id does not leak", () => {
  const hiddenRepo = { hiddenIds: async (_t: string, ids: string[]) => ids.filter((i) => i === "hidden") };

  it("RACI of a hidden risk: the empty list of an unknown id", async () => {
    const raci = { listForEntity: vi.fn(async () => [{ id: "a1" }]) };
    const s = new RaciAssignmentService(raci as never, {} as never, hiddenRepo as never);
    expect(await s.list(actor(OTHER, ["raci.read"]), "RISK", "hidden")).toEqual([]);
    expect(raci.listForEntity).not.toHaveBeenCalled();
  });

  it("controls: coveringRiskId of a hidden risk = []; coveredRiskIds lose the hidden id", async () => {
    const controls = {
      listCoveringRisk: vi.fn(async () => [{ id: "c1" }]),
      list: async () => [{ id: "c1", coveredRiskIds: ["hidden", "open"] }],
      getById: async () => ({ id: "c1", coveredRiskIds: ["hidden"] }),
    };
    const s = new ControlService(controls as never, hiddenRepo as never, {} as never);
    expect(await s.listCoveringRisk(actor(OTHER, ["control.read"]), "hidden")).toEqual([]);
    expect((await s.list(actor(OTHER, ["control.read"])))[0]!.coveredRiskIds).toEqual(["open"]);
    expect((await s.get(actor(OTHER, ["control.read"]), "c1")).coveredRiskIds).toEqual([]);
  });

  it("anomalies: riskId of a hidden risk becomes null", async () => {
    const anomalies = { list: async () => [{ id: "a1", riskId: "hidden" }, { id: "a2", riskId: "open" }] };
    const s = new AnomalyService(anomalies as never, {} as never, undefined, undefined, hiddenRepo as never);
    expect((await s.list(actor(OTHER, ["anomaly.read"]))).map((a) => a.riskId)).toEqual([null, "open"]);
  });

  it("evaluation context of a hidden risk: the 404 of an unknown evaluation, without the risk id", async () => {
    const evaluations = { getById: async () => ({ id: "e1", riskId: "r-hidden" }) };
    const s = new RiskEvaluationViewService(evaluations as never, { getById: async () => null } as never, {} as never, {} as never);
    const err = await s.getEvaluationContext(actor(OTHER, ["riskevaluation.read", "risk.read", "control.read"]), "e1").catch((e: Error) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(String((err as Error).message)).toContain("RiskEvaluation");
    expect(String((err as Error).message)).not.toContain("r-hidden");
  });
});

describe("q205 — directory search for risk.create / risk.update (DECISION-105)", () => {
  const users = { searchActive: vi.fn(async () => [{ id: OTHER, displayName: "Awa" }]), list: vi.fn(async () => []) };
  const s = new UserService(users as never, { record: vi.fn() } as never);

  it("risk.create may search by name (2+ characters, 20 max, id + name only); the full list stays closed to it (403)", async () => {
    expect(await s.searchDirectory(actor(OWNER, ["risk.create"]), " aw ")).toEqual([{ id: OTHER, displayName: "Awa" }]);
    expect(users.searchActive).toHaveBeenCalledWith(T, "aw", 20);
    await expect(s.searchDirectory(actor(OWNER, ["risk.create"]), "a")).rejects.toThrow(ValidationError);
    await expect(s.directory(actor(OWNER, ["risk.create"]))).rejects.toThrow(ForbiddenError);
  });

  it("without risk.create / risk.update or a directory right: 403", async () => {
    await expect(s.searchDirectory(actor(OWNER, ["risk.read"]), "awa")).rejects.toThrow(ForbiddenError);
  });
});

describe("QA-VIS1-05 — CORS lets the browser send Idempotency-Key (POST /risks requires it)", () => {
  it("the preflight of POST /risks with Idempotency-Key is allowed for an allowed origin", async () => {
    const routes = readFileSync(join(__dirname, "..", "src", "api", "v1", "risks.routes.ts"), "utf8");
    expect(routes).toContain('req.header("Idempotency-Key")');
    const app = express();
    app.use(cors(corsOptions(["http://front.test"])));
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/risks`, {
        method: "OPTIONS",
        headers: { origin: "http://front.test", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,idempotency-key" },
      });
      expect(r.headers.get("access-control-allow-origin")).toBe("http://front.test");
      expect(r.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("idempotency-key");
    } finally {
      server.close();
    }
  });
});

describe.skipIf(!hasLocalPg)("q205 directory search (real PostgreSQL, local only)", () => {
  const { ctx, one } = useMigrationTenant("v1dir");
  it("filters in SQL before the limit, active accounts of the tenant only, LIKE wildcards are literal", async () => {
    for (let i = 0; i < 25; i += 1) await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`, [ctx.tenant, `z${i}-${Math.random()}@v1`, `Zz ${String(i).padStart(2, "0")}`]);
    const target = (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'Koffi 50%') RETURNING id`, [ctx.tenant, `k-${Math.random()}@v1`])).id;
    await one(`INSERT INTO users (tenant_id, email, display_name, deleted_at) VALUES ($1, $2, 'Koffi suspendu', now()) RETURNING id`, [ctx.tenant, `ks-${Math.random()}@v1`]);
    const repo = new PostgresUserRepository(ctx.pool);
    expect(await repo.searchActive(ctx.tenant, "koffi", 20)).toEqual([{ id: target, displayName: "Koffi 50%" }]);
    expect(await repo.searchActive(ctx.tenant, "%", 20)).toEqual([{ id: target, displayName: "Koffi 50%" }]);
    expect(await repo.searchActive(ctx.tenant, "_", 20)).toEqual([]);
    expect(await repo.searchActive(ctx.tenant, "zz", 20)).toHaveLength(20);
    expect(await repo.searchActive(randomUUID(), "koffi", 20)).toEqual([]);
  });
});

// ============================================================== Codex P2 (PR #222)
describe("Codex P2 — a hidden risk is never removed by, nor named in, what an editor sees", () => {
  const hiddenRepo = {
    hiddenIds: async (_t: string, ids: string[]) => ids.filter((i) => i === "hidden"),
    getById: async (_t: string, id: string) => (id === "hidden" ? null : { id }),
    listByIds: async (_t: string, ids: string[]) => ids.map((id) => ({ id })),
  };
  const auditRepo = () => ({ record: vi.fn(async () => undefined) });

  it("1. KRI covered risks: replacing keeps the link to a hidden risk; the answer does not name it", async () => {
    const replace = vi.fn(async () => undefined);
    const kris = { getById: async () => ({ id: "k1", riskId: "primary" }), listCoveredRiskIds: async () => ["hidden", "open"], replaceCoveredRisks: replace };
    const s = new KriService(kris as never, {} as never, hiddenRepo as never, auditRepo() as never);
    const out = await s.addCoveredRisks(actor(OTHER, ["kri.update"]), "k1", ["open"], "req");
    expect(replace.mock.calls[0]![2]).toEqual(["open", "hidden"]);
    expect(out.coveredRiskIds).toEqual(["open"]);
  });

  it("2. helpers of the department / executive views: covered-risk ids and RISK sources of hidden risks are masked", async () => {
    const a = actor(OTHER, []);
    expect(await maskCoveredRisks(hiddenRepo as never, a, [{ coveredRiskIds: ["hidden", "open"] }])).toEqual([{ coveredRiskIds: ["open"] }]);
    expect(await maskRiskSource(hiddenRepo as never, a, [{ sourceType: "RISK", sourceId: "hidden" }, { sourceType: "CONTROL", sourceId: "hidden" }]))
      .toEqual([{ sourceType: "RISK", sourceId: null }, { sourceType: "CONTROL", sourceId: "hidden" }]);
    const dash = readFileSync(join(__dirname, "..", "src", "services", "DashboardService.ts"), "utf8");
    expect(dash).toContain("controls: await maskCoveredRisks(this.risks, actor, departmentControls)");
    expect((dash.match(/maskRiskSource\(this\.risks, actor/g) ?? []).length).toBe(3); // department, risk-owner, overdue (executive + committee)
  });

  it("3 + 7. controls: ?coveringRiskId= masks the other covered risks; update keeps the hidden link and answers masked", async () => {
    const update = vi.fn(async (_t: string, _id: string, input: { coveredRiskIds: string[] }) => ({ id: "c1", status: "DRAFT", coveredRiskIds: input.coveredRiskIds }));
    const controls = {
      listCoveringRisk: async () => [{ id: "c1", coveredRiskIds: ["open", "hidden"] }],
      getById: async () => ({ id: "c1", status: "DRAFT", coveredRiskIds: ["open", "hidden"] }),
      update,
    };
    const s = new ControlService(controls as never, hiddenRepo as never, auditRepo() as never);
    expect((await s.listCoveringRisk(actor(OTHER, ["control.read"]), "open"))[0]!.coveredRiskIds).toEqual(["open"]);
    const after = await s.update(actor(OTHER, ["control.read", "control.update"]), "c1", { coveredRiskIds: ["open"] }, "req");
    expect(update.mock.calls[0]![2].coveredRiskIds).toEqual(["open", "hidden"]);
    expect(after.coveredRiskIds).toEqual(["open"]);
  });

  it("4. RACI revoke on a hidden risk: the 404 of an unknown assignment, nothing removed", async () => {
    const raci = { getById: async () => ({ id: "a1", entityType: "RISK", entityId: "hidden" }), remove: vi.fn() };
    const s = new RaciAssignmentService(raci as never, auditRepo() as never, hiddenRepo as never);
    const err = await s.revoke(actor(OTHER, ["raci.revoke"]), "RISK", "hidden", "a1", "req").catch((e: Error) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(String((err as Error).message)).toContain("RaciAssignment");
    expect(raci.remove).not.toHaveBeenCalled();
  });

  it("5. idempotent replay compares the named people granted at creation", async () => {
    const existing = { ...risk(), id: "r9", process: "P", description: "D", ownerDepartmentId: null, processId: null, visibility: "PERIMETRE" };
    const repo = {
      createIdempotent: async () => ({ risk: existing, created: false }),
      listCreationAccess: async () => [OTHER],
      creatorWouldSee: async () => true,
    };
    const users = { getById: async (_t: string, id: string) => ({ id, deletedAt: null }) };
    const s = new RiskService(repo as never, auditRepo() as never, undefined, users as never);
    const base = { process: "P", description: "D", visibility: "PERIMETRE" as const };
    expect((await s.create(actor(OWNER, ["risk.create"]), { ...base, accessUserIds: [OTHER] }, "req", "key")).id).toBe("r9");
    await expect(s.create(actor(OWNER, ["risk.create"]), { ...base, accessUserIds: [] }, "req", "key")).rejects.toThrow(/Idempotency-Key/);
    await expect(s.create(actor(OWNER, ["risk.create"]), { ...base, accessUserIds: [RM] }, "req", "key")).rejects.toThrow(/Idempotency-Key/);
  });

  it("6. PERIMETRE -> NOMINATIF admitting someone new is a widening (fallback rule, owner): audited and notified", async () => {
    const f = fixture({ visibility: "PERIMETRE" });
    await f.service.setVisibility(actor(OWNER, ["risk.read"]), "r1", { visibility: "NOMINATIF", addUserIds: [OTHER], reason: "Expert externe" }, "req");
    expect(f.audits[0]!.newValue).toMatchObject({ widening: true });
    expect(f.notifications.create).toHaveBeenCalled();
  });

  it("7. action plans: listForRisk and mutation answers mask a hidden risk source; replacing links keeps a hidden one; anomaly status answer masked, audit not", async () => {
    const plan = { id: "p1", sourceType: "RISK", sourceId: "hidden", status: "A_FAIRE", progressPercent: 0, dueDate: new Date("2999-01-01") };
    const replaceLinks = vi.fn(async () => undefined);
    const actions = {
      listForRisk: async () => [plan],
      getById: async () => plan,
      updateProgress: async () => ({ ...plan, progressPercent: 10 }),
      listLinks: async () => [{ resourceType: "RISK", resourceId: "hidden" }, { resourceType: "RISK", resourceId: "open" }],
      replaceLinks,
    };
    const s = new ActionPlanService(actions as never, auditRepo() as never, hiddenRepo as never);
    const a = actor(OTHER, ["actionplan.read", "actionplan.update"]);
    expect((await s.listForRisk(a, "open"))[0]!.sourceId).toBeNull();
    expect((await s.updateProgress(a, "p1", 10, null, "req")).sourceId).toBeNull();
    await s.setLinks(a, "p1", [{ resourceType: "RISK", resourceId: "open" }] as never, "req");
    expect(replaceLinks.mock.calls[0]![2]).toEqual([{ resourceType: "RISK", resourceId: "open" }, { resourceType: "RISK", resourceId: "hidden" }]);

    const audit = auditRepo();
    const anomalies = { getById: async () => ({ id: "an1", status: "NEW", riskId: "hidden" }), updateStatus: async () => ({ id: "an1", status: "UNDER_ANALYSIS", riskId: "hidden" }) };
    const an = new AnomalyService(anomalies as never, audit as never, undefined, undefined, hiddenRepo as never);
    expect((await an.updateStatus(actor(OTHER, ["anomaly.read", "anomaly.update"]), "an1", "UNDER_ANALYSIS", null, "req")).riskId).toBeNull();
    expect(audit.record.mock.calls[0]![0]).toMatchObject({ oldValue: { riskId: "hidden" }, newValue: { riskId: "hidden" } });
  });
});

describe.skipIf(!hasLocalPg)("Codex P2 6 — widening from the real effective sets (real PostgreSQL, local only)", () => {
  const { ctx, one } = useMigrationTenant("v1wid");
  it("PERIMETRE -> NOMINATIF with a new name widens; with a name already in the perimeter it does not", async () => {
    const u = async (n: string) => (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`, [ctx.tenant, `${n}-${Math.random()}@v1`, n])).id as string;
    const [o, s, x] = [await u("o"), await u("s"), await u("x")];
    const mk = async () => (await one(`INSERT INTO risks (tenant_id, process, description, owner_id, superior_owner_id, visibility) VALUES ($1, 'w', 'w', $2, $3, 'PERIMETRE') RETURNING id`, [ctx.tenant, o, s])).id as string;
    const repo = new PostgresRiskRepository(ctx.pool);
    const r1 = await mk();
    expect((await repo.changeVisibility(ctx.tenant, r1, { visibility: "NOMINATIF", addUserIds: [x], revokeUserIds: [], reason: "w", changedBy: o })).widening).toBe(true);
    const r2 = await mk();
    expect((await repo.changeVisibility(ctx.tenant, r2, { visibility: "NOMINATIF", addUserIds: [s], revokeUserIds: [], reason: "w", changedBy: o })).widening).toBe(false);
  });
});
