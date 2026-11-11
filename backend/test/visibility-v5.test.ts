import { beforeAll, describe, expect, it, vi } from "vitest";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { AccessRenewalResult, ResourceAccessRepository } from "../src/domain/repositories/ResourceAccessRepository.js";
import { ResourceVisibilityManager, type VisibilityTarget } from "../src/services/resourceVisibility.js";
import { RiskService } from "../src/services/RiskService.js";
import { RenewBody } from "../src/api/v1/resourceVisibility.routes.js";
import { PostgresResourceAccessRepository } from "../src/infrastructure/database/postgres/PostgresResourceAccessRepository.js";
import { PostgresRiskRepository } from "../src/infrastructure/database/postgres/PostgresRiskRepository.js";
import { hasLocalPg, migrationSql, useMigrationTenant } from "./migrationHarness.js";

/** Lot V5 (q225 A, DECISION-112) — level 1: a named access expires at closure or 30 days, renewable (30 days from now). */
const T = "t5";
const RM = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const NAMED = "44444444-4444-4444-8444-444444444444";
const actor = (userId: string, roles: string[] = []): AuthenticatedUser => ({ userId, tenantId: T, email: `${userId}@v5`, roles } as AuthenticatedUser);
const target = (over: Partial<VisibilityTarget> = {}): VisibilityTarget =>
  ({ type: "ACTION_PLAN", entity: "ActionPlan", id: "p1", visibility: "NOMINATIF", ownerId: OWNER, inheritsFrom: null, ...over });
const GOOD = { userIds: [NAMED], reason: "Dossier toujours en cours" };

function manager() {
  const audits: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
  const renewAccess = vi.fn(async (_t: string, _type: string, _id: string, userIds: string[]) =>
    ({ visibility: "NOMINATIF", before: userIds.map((userId) => ({ userId, expiresAt: new Date(0) })), after: userIds.map((userId) => ({ userId, expiresAt: new Date(2e12) })), widening: true }) as AccessRenewalResult);
  const accessExpiries = vi.fn(async () => [{ userId: NAMED, expiresAt: new Date(2e12) }]);
  const access = { listAccess: vi.fn(async () => [NAMED]), renewAccess, accessExpiries } as unknown as ResourceAccessRepository;
  const users = {
    getById: vi.fn(async (_t: string, id: string) => ({ id, displayName: id, deletedAt: id === OTHER ? new Date() : null })),
    listWithPermission: vi.fn(async () => [{ id: RM, displayName: "RM" }]),
  };
  const notifications = { create: vi.fn(async (n: unknown) => n) };
  const m = new ResourceVisibilityManager(access, { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { audits.push(e); } } as never, users as never, notifications as never);
  return { m, audits, notifications, renewAccess, accessExpiries };
}

describe("lot V5 — renewing a named access (resources)", () => {
  it("Risk Manager group or owner account only; anyone else gets 403 and nothing is written", async () => {
    const f = manager();
    await expect(f.m.renew(actor(OTHER), target(), GOOD, "r")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(f.m.renew(actor(OWNER), target({ type: "CONTROL", entity: "Control", ownerId: null }), GOOD, "r")).rejects.toBeInstanceOf(ForbiddenError);
    expect(f.renewAccess).not.toHaveBeenCalled();
    expect(f.audits).toHaveLength(0);
  });

  it("a reason is mandatory (empty, blank, too long refused), like the addition", async () => {
    const f = manager();
    for (const reason of ["", "   ", "\t\n", "x".repeat(501)]) {
      await expect(f.m.renew(actor(RM, ["resourcevisibility.set"]), target(), { userIds: [NAMED], reason }, "r")).rejects.toBeInstanceOf(ValidationError);
    }
    expect(f.renewAccess).not.toHaveBeenCalled();
  });

  it("never an inherited resource, never yourself, never nobody, never a suspended account", async () => {
    const f = manager();
    const rm = actor(RM, ["resourcevisibility.set"]);
    await expect(f.m.renew(rm, target({ inheritsFrom: "RISK" }), GOOD, "r")).rejects.toBeInstanceOf(ValidationError);
    await expect(f.m.renew(rm, target(), { ...GOOD, userIds: [RM] }, "r")).rejects.toBeInstanceOf(ValidationError);
    await expect(f.m.renew(rm, target(), { ...GOOD, userIds: [] }, "r")).rejects.toBeInstanceOf(ValidationError);
    await expect(f.m.renew(rm, target(), { ...GOOD, userIds: [OTHER] }, "r")).rejects.toBeInstanceOf(ValidationError);
    expect(f.renewAccess).not.toHaveBeenCalled();
  });

  it("Risk Manager renews: one PERMISSION_CHANGE row (author = caller, reason), no notification; tenant from the caller", async () => {
    const f = manager();
    await f.m.renew(actor(RM, ["resourcevisibility.set"]), target(), GOOD, "req-1");
    expect(f.renewAccess).toHaveBeenCalledWith(T, "ACTION_PLAN", "p1", [NAMED], undefined);
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0]).toMatchObject({ tenantId: T, userId: RM, entityType: "ActionPlan", entityId: "p1", action: "PERMISSION_CHANGE",
      reason: GOOD.reason, requestId: "req-1", newValue: { renewed: [NAMED], widening: true } });
    expect(f.notifications.create).not.toHaveBeenCalled();
  });

  it("the owner renews: the Risk Manager group is notified", async () => {
    const f = manager();
    await f.m.renew(actor(OWNER), target(), GOOD, "req-2");
    expect(f.audits[0]).toMatchObject({ userId: OWNER });
    expect(f.notifications.create).toHaveBeenCalledTimes(1);
    expect(f.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: RM, eventType: "ACTION_PLAN_VISIBILITY_WIDENED" }));
  });
});

describe("lot V5 — who sees the expiry (PRIV-V5-01)", () => {
  it("only the Risk Manager group and the owner get expiresAt; any other reader gets the names without it", async () => {
    const f = manager();
    const reader = await f.m.get(actor(OTHER, ["control.read"]), target());
    expect(reader.accessUsers).toEqual([{ id: NAMED, displayName: NAMED }]);
    expect(f.accessExpiries).not.toHaveBeenCalled();
    for (const who of [actor(RM, ["resourcevisibility.set"]), actor(OWNER)]) {
      const s = await f.m.get(who, target());
      expect(s.accessUsers?.[0]?.expiresAt).toBe(new Date(2e12).toISOString());
    }
  });
});

describe("lot V5 — renewing a named access (risk)", () => {
  function riskFixture(visibility: Risk["visibility"] = "NOMINATIF") {
    const audits: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
    const renewAccess = vi.fn(async (_t: string, _id: string, userIds: string[]) =>
      ({ visibility: "NOMINATIF", before: [], after: userIds.map((userId) => ({ userId, expiresAt: new Date(2e12) })), widening: false }) as AccessRenewalResult);
    const risks = {
      getById: async () => ({ id: "r1", tenantId: T, ownerId: OWNER, visibility, status: "ACTIVE" }) as Risk,
      listAccess: async () => [NAMED],
      renewAccess,
    };
    const users = { getById: async (_t: string, id: string) => ({ id, deletedAt: null }), listWithPermission: async () => [{ id: RM, displayName: "RM" }] };
    const notifications = { create: vi.fn(async (n: unknown) => n) };
    const audit = { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { audits.push(e); } };
    const service = new RiskService(risks as never, audit as never, undefined, users as never, undefined, undefined, undefined, undefined, notifications as never);
    return { service, audits, renewAccess, notifications };
  }

  it("refuses without right and without reason; renews with an audit row and notifies when the owner does", async () => {
    const f = riskFixture();
    await expect(f.service.renewAccess(actor(OTHER, ["risk.read"]), "r1", GOOD, "r")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(f.service.renewAccess(actor(OWNER, ["risk.read"]), "r1", { ...GOOD, reason: " " }, "r")).rejects.toBeInstanceOf(ValidationError);
    expect(f.renewAccess).not.toHaveBeenCalled();
    await f.service.renewAccess(actor(OWNER, ["risk.read"]), "r1", GOOD, "req-3");
    expect(f.audits[0]).toMatchObject({ entityType: "Risk", action: "PERMISSION_CHANGE", userId: OWNER, reason: GOOD.reason, newValue: { renewed: [NAMED] } });
    expect(f.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: RM, eventType: "RISK_VISIBILITY_WIDENED" }));
  });
});

describe("lot V5 — renewal body", () => {
  it("userIds is a bounded, non-empty list of guids and the reason is mandatory", () => {
    expect(RenewBody.safeParse(GOOD).success).toBe(true);
    expect(RenewBody.safeParse({ ...GOOD, userIds: [] }).success).toBe(false);
    expect(RenewBody.safeParse({ ...GOOD, userIds: Array.from({ length: 51 }, () => NAMED) }).success).toBe(false);
    expect(RenewBody.safeParse({ ...GOOD, userIds: ["nope"] }).success).toBe(false);
    expect(RenewBody.safeParse({ userIds: [NAMED] }).success).toBe(false);
    expect(RenewBody.safeParse({ ...GOOD, reason: "" }).success).toBe(false);
  });
  it("an attribution field in the body is dropped, never read", () => {
    expect(RenewBody.parse({ ...GOOD, renewedBy: OTHER, grantedBy: OTHER })).toEqual(GOOD);
  });
});

describe("migration 087 (text)", () => {
  it("pins search_path with pg_temp last on every function, and ships a down", () => {
    const up = migrationSql("087_named_access_expiry.sql");
    const fns = up.match(/CREATE OR REPLACE FUNCTION/g)?.length ?? 0;
    expect(fns).toBeGreaterThan(0);
    expect(up.match(/SET search_path = pg_catalog, public, pg_temp/g)?.length).toBeGreaterThanOrEqual(fns * 2);
    expect(migrationSql("087_named_access_expiry.down.sql")).toContain("DROP COLUMN IF EXISTS expires_at");
  });
});

describe.skipIf(!hasLocalPg)("lot V5 on real PostgreSQL (local only)", () => {
  const { ctx, one } = useMigrationTenant("v5");
  const q = (sql: string, p: unknown[] = []) => ctx.pool.query(sql, p);
  // Other live suites re-apply 080..083 on the shared base, which restores older definitions: replay 084 then 087 (idempotent).
  beforeAll(async () => {
    await ctx.pool.query(migrationSql("084_resource_readall.sql"));
    await ctx.pool.query(migrationSql("087_named_access_expiry.sql"));
  });
  const user = async (name: string) =>
    (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`, [ctx.tenant, `${name}-${Math.random()}@v5`, name])).id as string;
  const sees = async (fn: string, id: string, userId: string) =>
    (await one(`SELECT ${fn}($1, $2, $3::uuid) AS v`, [ctx.tenant, id, userId])).v as boolean;
  const grant = async (type: string, id: string, userId: string, by: string, expires: string | null = "now() + interval '10 days'") =>
    (await one(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason, expires_at)
                VALUES ($1, $2, $3, $4, $5, 'test', ${expires ?? "NULL"}) RETURNING id`, [ctx.tenant, type, id, userId, by])).id as string;
  const control = async (visibility = "NOMINATIF") =>
    (await one(`INSERT INTO controls (tenant_id, label, control_type, frequency, executor, compliance_criteria, visibility)
                VALUES ($1, 'c', 'PREVENTIVE', 'M', 'x', 'y', $2) RETURNING id`, [ctx.tenant, visibility])).id as string;
  const risk = async (ownerId: string | null = null, visibility = "NOMINATIF") =>
    (await one(`INSERT INTO risks (tenant_id, process, description, owner_id, visibility) VALUES ($1, 'p', 'd', $2, $3) RETURNING id`, [ctx.tenant, ownerId, visibility])).id as string;
  // SEC-V5-03: the guard refuses to shorten an expiry; a test that backdates one switches it off for the statement.
  const backdate = async (resourceId: string) => {
    await q("ALTER TABLE resource_access_grants DISABLE TRIGGER resource_access_grants_guard");
    try { await q(`UPDATE resource_access_grants SET expires_at = now() - interval '1 hour' WHERE resource_id = $1`, [resourceId]); }
    finally { await q("ALTER TABLE resource_access_grants ENABLE TRIGGER resource_access_grants_guard"); }
  };
  const expiresAt = async (grantId: string) => (await one(`SELECT expires_at FROM resource_access_grants WHERE id = $1`, [grantId])).expires_at as Date | null;

  it("an expired access reads nothing; the row stays (no deletion, no revocation); a live one reads", async () => {
    const [by, g, late] = await Promise.all(["by", "g", "late"].map(user));
    const c = await control();
    const live = await grant("CONTROL", c, g!, by!);
    const gone = await grant("CONTROL", c, late!, by!, "now() - interval '1 minute'");
    expect(await sees("control_visible_to", c, g!)).toBe(true);
    expect(await sees("control_visible_to", c, late!)).toBe(false);
    const rows = (await q(`SELECT id, revoked_at FROM resource_access_grants WHERE id = ANY($1::uuid[])`, [[live, gone]])).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revoked_at === null)).toBe(true);
    // The same rule holds for a risk (its own function, risk_visible_core).
    const r = await risk(by);
    await grant("RISK", r, g!, by!, "now() - interval '1 second'");
    expect(await sees("risk_visible_to", r, g!)).toBe(false);
    await grant("RISK", r, late!, by!);
    expect(await sees("risk_visible_to", r, late!)).toBe(true);
  });

  it("a PERIMETRE list (no expiry) is untouched by q225", async () => {
    const [by, g] = await Promise.all(["by", "g"].map(user));
    const c = await control("PERIMETRE");
    await grant("CONTROL", c, g!, by!, null);
    expect(await sees("control_visible_to", c, g!)).toBe(true);
  });

  it("closing the dossier cuts the named access, per type", async () => {
    const [by, g] = await Promise.all(["by", "g"].map(user));
    const mk = {
      CONTROL: async () => control(),
      RISK: async () => risk(by),
      ANOMALY: async () => (await one(`INSERT INTO anomalies (tenant_id, description, severity, detected_by, status, visibility) VALUES ($1, 't', 'LOW', $2, 'NEW', 'NOMINATIF') RETURNING id`, [ctx.tenant, by])).id as string,
      ACTION_PLAN: async () => (await one(`INSERT INTO action_plans (tenant_id, title, source_type, source_id, responsible_user_id, due_date, created_by, visibility) VALUES ($1, 't', 'MANAGEMENT', NULL, $2, now(), $2, 'NOMINATIF') RETURNING id`, [ctx.tenant, by])).id as string,
      KPI: async () => (await one(`INSERT INTO kpis (tenant_id, label, target_value, unit, frequency, owner, department_id, visibility) VALUES ($1, 'k', 1, '%', 'MONTHLY', 'texte', $2, 'NOMINATIF') RETURNING id`, [ctx.tenant, (await one(`INSERT INTO departments (tenant_id, name) VALUES ($1, $2) RETURNING id`, [ctx.tenant, `D-${Math.random()}`])).id])).id as string,
    };
    const fn = { CONTROL: "control_visible_to", RISK: "risk_visible_to", ANOMALY: "anomaly_visible_to", ACTION_PLAN: "action_plan_visible_to", KPI: "kpi_visible_to" } as const;
    const close: Record<keyof typeof mk, string> = {
      CONTROL: `UPDATE controls SET status = 'ARCHIVED' WHERE id = $1`,
      RISK: `UPDATE risks SET status = 'ARCHIVED' WHERE id = $1`,
      ANOMALY: `UPDATE anomalies SET status = 'CLOSED' WHERE id = $1`,
      ACTION_PLAN: `UPDATE action_plans SET status = 'TERMINEE' WHERE id = $1`,
      KPI: `UPDATE kpis SET deleted_at = now() WHERE id = $1`,
    };
    for (const type of Object.keys(mk) as Array<keyof typeof mk>) {
      const id = await mk[type]();
      await grant(type, id, g!, by!);
      expect(await sees(fn[type], id, g!), `${type} open`).toBe(true);
      await q(close[type], [id]);
      expect(await sees(fn[type], id, g!), `${type} closed`).toBe(false);
    }
  });

  it("renewal: new expiry = now + 30 days at most; an expired access reads again; the guard refuses longer or no expiry", async () => {
    const [by, g] = await Promise.all(["by", "g"].map(user));
    const c = await control();
    const id = await grant("CONTROL", c, g!, by!, "now() - interval '1 day'");
    expect(await sees("control_visible_to", c, g!)).toBe(false);
    const repo = new PostgresResourceAccessRepository(ctx.pool);
    const res = await repo.renewAccess(ctx.tenant, "CONTROL", c, [g!]);
    expect(res.widening).toBe(true);
    expect(await sees("control_visible_to", c, g!)).toBe(true);
    const days = ((await expiresAt(id))!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    // Renewing again never goes past 30 days from now.
    await repo.renewAccess(ctx.tenant, "CONTROL", c, [g!]);
    expect(((await expiresAt(id))!.getTime() - Date.now()) / 86_400_000).toBeLessThanOrEqual(30);
    // The database refuses anything beyond 30 days, and the removal of an expiry.
    await expect(q(`UPDATE resource_access_grants SET expires_at = now() + interval '31 days' WHERE id = $1`, [id])).rejects.toThrow(/30 days/);
    await expect(q(`UPDATE resource_access_grants SET expires_at = NULL WHERE id = $1`, [id])).rejects.toThrow();
    await expect(grant("CONTROL", c, by!, g!, "now() + interval '31 days'")).rejects.toThrow(/30 days/);
  });

  it("renewal refuses a closed dossier, a non-NOMINATIF one, an unknown person, and never deletes", async () => {
    const [by, g, x] = await Promise.all(["by", "g", "x"].map(user));
    const repo = new PostgresResourceAccessRepository(ctx.pool);
    const c = await control();
    await grant("CONTROL", c, g!, by!);
    await expect(repo.renewAccess(ctx.tenant, "CONTROL", c, [x!])).rejects.toBeInstanceOf(ValidationError);
    await q(`UPDATE controls SET status = 'ARCHIVED' WHERE id = $1`, [c]);
    await expect(repo.renewAccess(ctx.tenant, "CONTROL", c, [g!])).rejects.toThrow(/closed/);
    const p = await control("PERIMETRE");
    await grant("CONTROL", p, g!, by!, null);
    await expect(repo.renewAccess(ctx.tenant, "CONTROL", p, [g!])).rejects.toBeInstanceOf(ValidationError);
    expect((await q(`SELECT count(*)::int AS n FROM resource_access_grants WHERE resource_id = ANY($1::uuid[])`, [[c, p]])).rows[0].n).toBe(2);
  });

  it("a risk: setting the level to NOMINATIF stamps 30 days on the list; renewal through the risk repository", async () => {
    const [by, g] = await Promise.all(["by", "g"].map(user));
    const repo = new PostgresRiskRepository(ctx.pool);
    const r = await risk(by, "PERIMETRE");
    await repo.changeVisibility(ctx.tenant, r, { visibility: "NOMINATIF", addUserIds: [g!], revokeUserIds: [], reason: "dossier", changedBy: by! });
    const [e] = await repo.accessExpiries(ctx.tenant, r);
    const days = (e!.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    await backdate(r);
    expect(await sees("risk_visible_to", r, g!)).toBe(false);
    await repo.renewAccess(ctx.tenant, r, [g!]);
    expect(await sees("risk_visible_to", r, g!)).toBe(true);
  });

  it("fail closed (SEC-V5-02): a NOMINATIF dossier whose access carries no expiry reads nothing", async () => {
    const [by, g] = await Promise.all(["by", "g"].map(user));
    const c = await control();
    await grant("CONTROL", c, g!, by!, null);
    expect(await sees("control_visible_to", c, g!)).toBe(false);
    const r = await risk(by);
    await grant("RISK", r, g!, by!, null);
    expect(await sees("risk_visible_to", r, g!)).toBe(false);
  });

  it("the guard only lengthens the expiry of a live access (SEC-V5-03)", async () => {
    const [by, g] = await Promise.all(["by", "g"].map(user));
    const c = await control();
    const id = await grant("CONTROL", c, g!, by!, "now() + interval '10 days'");
    await expect(q(`UPDATE resource_access_grants SET expires_at = now() + interval '5 days' WHERE id = $1`, [id])).rejects.toThrow(/lengthened/);
    await expect(q(`UPDATE resource_access_grants SET expires_at = now() - interval '1 day' WHERE id = $1`, [id])).rejects.toThrow(/lengthened/);
    await q(`UPDATE resource_access_grants SET expires_at = now() + interval '20 days' WHERE id = $1`, [id]);
  });

  it("an access that carries an expiry is renewable whatever the level (back to PERIMETRE too); a re-addition renews an expired one", async () => {
    const [by, g] = await Promise.all(["by", "g"].map(user));
    const repo = new PostgresResourceAccessRepository(ctx.pool);
    const c = await control();
    const id = await grant("CONTROL", c, g!, by!, "now() + interval '1 day'");
    await q(`UPDATE controls SET visibility = 'PERIMETRE' WHERE id = $1`, [c]);
    await repo.renewAccess(ctx.tenant, "CONTROL", c, [g!]);
    expect(((await expiresAt(id))!.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(29.9);
    // Re-adding someone whose access ended renews it: never a silent no-op, never a second live row.
    const c2 = await control();
    const id2 = await grant("CONTROL", c2, g!, by!, "now() - interval '1 minute'");
    const res = await repo.changeVisibility(ctx.tenant, "CONTROL", c2, { visibility: "NOMINATIF", addUserIds: [g!], revokeUserIds: [], reason: "r", changedBy: by! });
    expect(await sees("control_visible_to", c2, g!)).toBe(true);
    expect(res.after.accessUserIds).toEqual([g!]);
    expect((await q(`SELECT count(*)::int AS n FROM resource_access_grants WHERE resource_id = $1 AND revoked_at IS NULL`, [c2])).rows[0].n).toBe(1);
    expect(((await expiresAt(id2))!.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(29.9);
    // On a closed dossier the re-addition answers a clear 400.
    const c3 = await control();
    await grant("CONTROL", c3, g!, by!, "now() - interval '1 minute'");
    await q(`UPDATE controls SET status = 'ARCHIVED' WHERE id = $1`, [c3]);
    await expect(repo.changeVisibility(ctx.tenant, "CONTROL", c3, { visibility: "NOMINATIF", addUserIds: [g!], revokeUserIds: [], reason: "r", changedBy: by! })).rejects.toThrow(/closed/);
  });

  it("the audit snapshot and the access count leave out the people whose access ended (SEC-V5-04)", async () => {
    const [by, g, h] = await Promise.all(["by", "g", "h"].map(user));
    const repo = new PostgresResourceAccessRepository(ctx.pool);
    const c = await control();
    await grant("CONTROL", c, g!, by!, "now() - interval '1 minute'");
    await grant("CONTROL", c, h!, by!);
    const res = await repo.changeVisibility(ctx.tenant, "CONTROL", c, { visibility: "NOMINATIF", addUserIds: [], revokeUserIds: [], reason: "r", changedBy: by! });
    expect(res.before.accessUserIds).toEqual([h!]);
    const row = (await repo.listRestricted(ctx.tenant, { limit: 500 })).find((x) => x.id === c);
    expect(row?.accessCount).toBe(1);
    await q(`UPDATE controls SET status = 'ARCHIVED' WHERE id = $1`, [c]);
    expect((await repo.listRestricted(ctx.tenant, { limit: 500 })).find((x) => x.id === c)?.accessCount).toBe(0);
  });
});
