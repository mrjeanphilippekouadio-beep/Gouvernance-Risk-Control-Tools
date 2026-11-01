import { describe, expect, it, vi } from "vitest";
import { readerScope } from "../src/domain/visibility.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { ResourceAccessRepository, VisibilityChangeResult } from "../src/domain/repositories/ResourceAccessRepository.js";
import { ResourceVisibilityManager, type VisibilityTarget } from "../src/services/resourceVisibility.js";
import { resourceVisibilityClause } from "../src/infrastructure/database/postgres/visibilityFilter.js";
import { PostgresResourceAccessRepository } from "../src/infrastructure/database/postgres/PostgresResourceAccessRepository.js";
import { PostgresRiskRepository } from "../src/infrastructure/database/postgres/PostgresRiskRepository.js";
import { PostgresControlRepository } from "../src/infrastructure/database/postgres/PostgresControlRepository.js";
import { PostgresActionPlanRepository } from "../src/infrastructure/database/postgres/PostgresActionPlanRepository.js";
import { hasLocalPg, migrationSql, useMigrationTenant } from "./migrationHarness.js";

/** Lot V2 (DECISION-100/102) — level 1: the four roots restrictable, their inheritance, the change of level. */
const T = "t2";
const RM = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const NAMED = "44444444-4444-4444-8444-444444444444";
const actor = (userId: string, roles: string[] = []): AuthenticatedUser => ({ userId, tenantId: T, email: `${userId}@v2`, roles } as AuthenticatedUser);
const target = (over: Partial<VisibilityTarget> = {}): VisibilityTarget =>
  ({ type: "ACTION_PLAN", entity: "ActionPlan", id: "p1", visibility: "PERIMETRE", ownerId: OWNER, inheritsFrom: null, ...over });

function manager(widening = true) {
  const audits: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
  const changeVisibility = vi.fn(async (_t: string, _type: string, _id: string, change: { visibility: string; addUserIds: string[] }) =>
    ({ before: { visibility: "PERIMETRE", accessUserIds: [] }, after: { visibility: change.visibility, accessUserIds: change.addUserIds }, widening }) as VisibilityChangeResult);
  const access = {
    listAccess: vi.fn(async () => []),
    changeVisibility,
    readers: vi.fn(async () => []),
    hiddenIds: vi.fn(async () => []),
    inPerimeter: vi.fn(async () => false),
  } as unknown as ResourceAccessRepository;
  const users = {
    getById: vi.fn(async (_t: string, id: string) => ({ id, displayName: id, deletedAt: null })),
    listWithPermission: vi.fn(async () => [{ id: RM, displayName: "RM" }]),
  };
  const notifications = { create: vi.fn(async (n: unknown) => n) };
  const m = new ResourceVisibilityManager(access, { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { audits.push(e); } } as never, users as never, notifications as never);
  return { m, access, audits, notifications, changeVisibility };
}

describe("lot V2 — changing the level of a control, anomaly, plan or KPI", () => {
  const input = { visibility: "NOMINATIF" as const, addUserIds: [NAMED], reason: "Dossier sensible" };

  it("Risk Manager group or owner account only; a control or KPI has no owner account (403 for anyone else)", async () => {
    await expect(manager().m.set(actor(OTHER), target(), input, "r")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(manager().m.set(actor(OWNER), target({ type: "CONTROL", entity: "Control", ownerId: null }), input, "r")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(manager().m.set(actor(RM, ["resourcevisibility.set"]), target({ type: "KPI", entity: "Kpi", ownerId: null }), input, "r")).resolves.toMatchObject({ visibility: "NOMINATIF" });
  });

  it("an owner who widens: audited PERMISSION_CHANGE (actor = caller, widening) and the Risk Manager group is notified", async () => {
    const { m, audits, notifications } = manager(true);
    await m.set(actor(OWNER), target(), input, "req");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: OWNER, entityType: "ActionPlan", action: "PERMISSION_CHANGE", reason: "Dossier sensible", newValue: { widening: true } });
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: RM, eventType: "ACTION_PLAN_VISIBILITY_WIDENED" }));
  });

  it("the Risk Manager widening, or an owner narrowing: no notification", async () => {
    const a = manager(true);
    await a.m.set(actor(RM, ["resourcevisibility.set"]), target(), input, "r");
    expect(a.notifications.create).not.toHaveBeenCalled();
    const b = manager(false);
    await b.m.set(actor(OWNER), target(), input, "r");
    expect(b.notifications.create).not.toHaveBeenCalled();
  });

  it("refused before any write: self-add, missing reason, a resource that follows its parent", async () => {
    const { m, changeVisibility } = manager();
    await expect(m.set(actor(OWNER), target(), { ...input, addUserIds: [OWNER] }, "r")).rejects.toBeInstanceOf(ValidationError);
    await expect(m.set(actor(OWNER), target(), { ...input, reason: "  " }, "r")).rejects.toBeInstanceOf(ValidationError);
    await expect(m.set(actor(RM, ["resourcevisibility.set"]), target({ type: "ANOMALY", inheritsFrom: "RISK" }), input, "r")).rejects.toThrow(/follows the visibility of its risk/);
    expect(changeVisibility).not.toHaveBeenCalled();
  });

  it("creation: a restricted level is refused when the creator would not read it, unless owner, perimeter member or sees-everything", async () => {
    const { m, access } = manager();
    const c = { visibility: "PERIMETRE" as const, inheritsFrom: null, isOwner: false, departmentId: "d", processId: null };
    await expect(m.assertCreation(actor(OTHER), c, false)).rejects.toThrow(/would not see this resource/);
    await expect(m.assertCreation(actor(OTHER), { ...c, visibility: "NOMINATIF" }, true)).resolves.toBeUndefined();
    await expect(m.assertCreation(actor(OTHER), { ...c, isOwner: true }, false)).resolves.toBeUndefined();
    vi.mocked(access.inPerimeter).mockResolvedValueOnce(true);
    await expect(m.assertCreation(actor(OTHER), c, false)).resolves.toBeUndefined();
    await expect(m.assertCreation(actor(OTHER), { ...c, inheritsFrom: "RISK" }, true)).rejects.toThrow(/cannot have its own level/);
  });

  it("perimeter change of a restricted resource: Risk Manager group or owner, mandatory reason; nothing for a CLIENT one", () => {
    const { m } = manager();
    expect(m.guardPerimeterChange(actor(OTHER), target({ visibility: "CLIENT" }), true, undefined)).toBeNull();
    expect(() => m.guardPerimeterChange(actor(OTHER), target(), true, "motif")).toThrow(ForbiddenError);
    expect(() => m.guardPerimeterChange(actor(OWNER), target(), true, "")).toThrow(ValidationError);
    expect(m.guardPerimeterChange(actor(OWNER), target(), true, "Réorganisation")).toMatchObject({ reason: "Réorganisation", holdsRight: false });
  });

  it("SQL clause: the reader id is a strict uuid literal; anomalies and plans always go through their function (inheritance)", () => {
    expect(resourceVisibilityClause("CONTROL", { all: true })).toBe("");
    expect(resourceVisibilityClause("KPI", { all: false })).toBe("AND (visibility = 'CLIENT' OR kpi_visible_to(tenant_id, id, NULL::uuid))");
    expect(resourceVisibilityClause("ANOMALY", readerScope({ userId: OWNER }), "a.")).toBe(`AND anomaly_visible_to(a.tenant_id, a.id, '${OWNER}'::uuid)`);
    expect(() => resourceVisibilityClause("ACTION_PLAN", { all: false, userId: "x' OR true --" })).toThrow(/not a uuid/);
  });
});

describe.skipIf(!hasLocalPg)("lot V2 on real PostgreSQL (local only)", () => {
  const { ctx, one } = useMigrationTenant("v2");
  const user = async (name: string) =>
    (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`, [ctx.tenant, `${name}-${Math.random()}@v2`, name])).id as string;
  const role = async (group: string | null, departmentId: string | null = null) =>
    (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group, department_id) VALUES ($1, $2, '{}', $3, $4) RETURNING id`,
      [ctx.tenant, `r-${Math.random()}`, group, departmentId])).id as string;
  const member = (roleId: string, userId: string, by: string) =>
    one(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4) RETURNING id`, [ctx.tenant, roleId, userId, by]);
  const sees = async (fn: string, id: string, userId: string | null) =>
    (await one(`SELECT ${fn}($1, $2, $3::uuid) AS v`, [ctx.tenant, id, userId])).v as boolean;
  const grant = (type: string, id: string, userId: string, by: string) =>
    one(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason) VALUES ($1, $2, $3, $4, $5, 'test') RETURNING id`, [ctx.tenant, type, id, userId, by]);
  const dept = async () => (await one(`INSERT INTO departments (tenant_id, name) VALUES ($1, $2) RETURNING id`, [ctx.tenant, `D-${Math.random()}`])).id as string;
  const control = async (visibility: string, departmentId: string | null = null, processId: string | null = null) =>
    (await one(`INSERT INTO controls (tenant_id, label, process_id, department_id, control_type, frequency, executor, compliance_criteria, visibility)
                VALUES ($1, 'c', $2, $3, 'PREVENTIVE', 'M', 'x', 'y', $4) RETURNING id`, [ctx.tenant, processId, departmentId, visibility])).id as string;
  const risk = async (visibility: string, ownerId: string | null = null) =>
    (await one(`INSERT INTO risks (tenant_id, process, description, owner_id, visibility) VALUES ($1, 'p', 'd', $2, $3) RETURNING id`, [ctx.tenant, ownerId, visibility])).id as string;

  it("control_visible_to: PERIMETRE = department group, process owner, RACI, list; NOMINATIF = list; fixed groups see all; NULL reader = CLIENT only", async () => {
    const [dm, po, ra, g, rm, x] = await Promise.all(["dm", "po", "ra", "g", "rm", "x"].map(user));
    const d = await dept();
    const proc = (await one(`INSERT INTO processes (tenant_id, level, name, owner_user_id) VALUES ($1, 'PROCESS', $2, $3) RETURNING id`, [ctx.tenant, `P-${Math.random()}`, po])).id;
    await member(await role(null, d), dm!, rm!);
    await member(await role("RISK_MANAGER"), rm!, dm!);
    const c = await control("PERIMETRE", d, proc);
    await one(`INSERT INTO raci_assignments (tenant_id, entity_type, entity_id, user_id, role, created_by) VALUES ($1, 'CONTROL', $2, $3, 'C', $4) RETURNING id`, [ctx.tenant, c, ra, rm]);
    await grant("CONTROL", c, g!, rm!);
    for (const u of [dm, po, ra, g, rm]) expect(await sees("control_visible_to", c, u!), u).toBe(true);
    expect(await sees("control_visible_to", c, x!)).toBe(false);
    expect(await sees("control_visible_to", c, null)).toBe(false);
    await ctx.pool.query(`UPDATE controls SET visibility = 'NOMINATIF' WHERE id = $1`, [c]);
    for (const u of [g, rm]) expect(await sees("control_visible_to", c, u!)).toBe(true);
    for (const u of [dm, po, ra]) expect(await sees("control_visible_to", c, u!)).toBe(false);

    const repo = new PostgresControlRepository(ctx.pool);
    expect(await repo.getById(ctx.tenant, c, readerScope({ userId: x! }))).toBeNull();
    expect((await repo.getById(ctx.tenant, c, readerScope({ userId: g! })))?.visibility).toBe("NOMINATIF");
  });

  it("anomaly_visible_to follows the risk, else the control, else its own level (declarer + list)", async () => {
    const [o, decl, g, x] = await Promise.all(["o", "decl", "g", "x"].map(user));
    const rHidden = await risk("NOMINATIF", o);
    const cHidden = await control("NOMINATIF");
    const anomaly = async (riskId: string | null, controlId: string | null, visibility = "CLIENT") =>
      (await one(`INSERT INTO anomalies (tenant_id, risk_id, control_id, description, severity, detected_by, status, visibility)
                  VALUES ($1, $2, $3, 'texte', 'LOW', $4, 'NEW', $5) RETURNING id`, [ctx.tenant, riskId, controlId, decl, visibility])).id as string;
    const onRisk = await anomaly(rHidden, null);
    const onControl = await anomaly(null, cHidden);
    const own = await anomaly(null, null, "NOMINATIF");
    await grant("ANOMALY", own, g!, decl!);
    expect(await sees("anomaly_visible_to", onRisk, x!)).toBe(false);
    expect(await sees("anomaly_visible_to", onRisk, o!)).toBe(true);
    // SEC V1-03: the declarer does not read an anomaly whose risk is hidden from them (it follows the risk)
    expect(await sees("anomaly_visible_to", onRisk, decl!)).toBe(false);
    expect(await sees("anomaly_visible_to", onControl, x!)).toBe(false);
    for (const u of [decl, g]) expect(await sees("anomaly_visible_to", own, u!)).toBe(true);
    expect(await sees("anomaly_visible_to", own, x!)).toBe(false);
  });

  it("action_plan_visible_to: the responsible always; else RISK / CONTROL / KRI source; else own level (department group, list)", async () => {
    const [o, resp, dm, x, g] = await Promise.all(["o", "resp", "dm", "x", "g"].map(user));
    const d = await dept();
    await member(await role(null, d), dm!, o!);
    const rHidden = await risk("NOMINATIF", o);
    const kri = (await one(`INSERT INTO kris (tenant_id, label, formula, threshold_green, threshold_orange, threshold_red, frequency, risk_id)
                            VALUES ($1, 'k', 'f', 1, 2, 3, 'MONTHLY', $2) RETURNING id`, [ctx.tenant, rHidden])).id as string;
    const plan = async (sourceType: string, sourceId: string | null, visibility = "CLIENT", departmentId: string | null = null) =>
      (await one(`INSERT INTO action_plans (tenant_id, title, source_type, source_id, responsible_user_id, department_id, due_date, created_by, visibility)
                  VALUES ($1, 't', $2, $3, $4, $5, now(), $4, $6) RETURNING id`, [ctx.tenant, sourceType, sourceId, resp, departmentId, visibility])).id as string;
    const pRisk = await plan("RISK", rHidden);
    const pKri = await plan("KRI", kri);
    const pOwn = await plan("MANAGEMENT", null, "PERIMETRE", d);
    await grant("ACTION_PLAN", pOwn, g!, o!);
    for (const p of [pRisk, pKri, pOwn]) expect(await sees("action_plan_visible_to", p, resp!), p).toBe(true);
    for (const p of [pRisk, pKri]) {
      expect(await sees("action_plan_visible_to", p, x!)).toBe(false);
      expect(await sees("action_plan_visible_to", p, o!)).toBe(true);
    }
    for (const u of [dm, g]) expect(await sees("action_plan_visible_to", pOwn, u!)).toBe(true);
    expect(await sees("action_plan_visible_to", pOwn, x!)).toBe(false);
    // the SQL clause in a list: x sees none of them, the responsible all three
    const repo = new PostgresActionPlanRepository(ctx.pool);
    const ids = new Set([pRisk, pKri, pOwn]);
    expect((await repo.list(ctx.tenant, undefined, readerScope({ userId: x! }))).filter((a) => ids.has(a.id))).toEqual([]);
    expect((await repo.list(ctx.tenant, undefined, readerScope({ userId: resp! }))).filter((a) => ids.has(a.id))).toHaveLength(3);
  });

  it("kpi_visible_to: department group and process owner in PERIMETRE, list only in NOMINATIF", async () => {
    const [dm, x, rm] = await Promise.all(["dm", "x", "rm"].map(user));
    const d = await dept();
    await member(await role(null, d), dm!, rm!);
    const k = (await one(`INSERT INTO kpis (tenant_id, label, target_value, unit, frequency, owner, department_id, visibility)
                          VALUES ($1, 'k', 1, '%', 'MONTHLY', 'texte', $2, 'PERIMETRE') RETURNING id`, [ctx.tenant, d])).id as string;
    expect(await sees("kpi_visible_to", k, dm!)).toBe(true);
    expect(await sees("kpi_visible_to", k, x!)).toBe(false);
    await ctx.pool.query(`UPDATE kpis SET visibility = 'NOMINATIF' WHERE id = $1`, [k]);
    expect(await sees("kpi_visible_to", k, dm!)).toBe(false);
  });

  it("access repository: list, widening from the effective sets, back to CLIENT revokes the list (revoked_at, never deleted), hiddenIds", async () => {
    const [rm, g, x] = await Promise.all(["rm", "g", "x"].map(user));
    const c = await control("NOMINATIF");
    const repo = new PostgresResourceAccessRepository(ctx.pool);
    const r1 = await repo.changeVisibility(ctx.tenant, "CONTROL", c, { visibility: "NOMINATIF", addUserIds: [g!], revokeUserIds: [], reason: "Nommer", changedBy: rm! });
    expect(r1).toMatchObject({ widening: true, after: { visibility: "NOMINATIF", accessUserIds: [g] } });
    expect(await repo.hiddenIds(ctx.tenant, "CONTROL", [c], readerScope({ userId: x! }))).toEqual([c]);
    expect(await repo.hiddenIds(ctx.tenant, "CONTROL", [c], readerScope({ userId: g! }))).toEqual([]);
    const r2 = await repo.changeVisibility(ctx.tenant, "CONTROL", c, { visibility: "CLIENT", addUserIds: [], revokeUserIds: [], reason: "Ouvrir", changedBy: rm! });
    expect(r2.after).toEqual({ visibility: "CLIENT", accessUserIds: [] });
    expect(await one(`SELECT revoked_by, revoke_reason FROM resource_access_grants WHERE resource_id = $1`, [c])).toEqual({ revoked_by: rm, revoke_reason: "Ouvrir" });
    expect((await repo.readers(ctx.tenant, "CONTROL", c))).toEqual(expect.arrayContaining([x, g, rm]));
    await expect(repo.changeVisibility(ctx.tenant, "KPI", c, { visibility: "CLIENT", addUserIds: [], revokeUserIds: [], reason: "x", changedBy: rm! }))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("SEC V1-02: a restricted risk's department change is measured on the effective readers (widening only if someone new reads it)", async () => {
    const [o, dm] = await Promise.all(["o", "dm"].map(user));
    const [d1, d2] = [await dept(), await dept()];
    await member(await role(null, d2), dm!, o!);
    const repo = new PostgresRiskRepository(ctx.pool);
    const r = await risk("PERIMETRE", o);
    expect((await repo.update(ctx.tenant, r, { ownerDepartmentId: d1 })).perimeterWidening).toBe(false); // empty group
    expect((await repo.update(ctx.tenant, r, { ownerDepartmentId: d2 })).perimeterWidening).toBe(true);
    expect((await repo.update(ctx.tenant, r, { description: "x" })).perimeterWidening).toBeUndefined();
  });

  it("083 is idempotent and down -> up gives the functions back, search_path pinned on each", async () => {
    const up = migrationSql("083_resource_visibility_v2.sql");
    await ctx.pool.query(up);
    await ctx.pool.query(migrationSql("083_resource_visibility_v2.down.sql"));
    expect((await one(`SELECT to_regprocedure('control_visible_to(uuid,uuid,uuid)') AS f`)).f).toBeNull();
    await ctx.pool.query(up);
    await ctx.pool.query(`INSERT INTO schema_migrations (filename) VALUES ('083_resource_visibility_v2.sql') ON CONFLICT DO NOTHING`);
    const { rows } = await ctx.pool.query<{ proname: string; proconfig: string[] }>(
      `SELECT proname, proconfig FROM pg_proc WHERE proname IN ('control_visible_to', 'kpi_visible_to', 'anomaly_visible_to', 'action_plan_visible_to',
         'visibility_sees_everything', 'visibility_in_department_group', 'visibility_granted') ORDER BY proname`);
    expect(rows).toHaveLength(7);
    for (const r of rows) expect(r.proconfig, r.proname).toEqual(["search_path=pg_catalog, public, pg_temp"]);
  });
});
