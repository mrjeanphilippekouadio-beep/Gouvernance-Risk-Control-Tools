import { describe, expect, it, vi } from "vitest";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { ResourceAccessRepository } from "../src/domain/repositories/ResourceAccessRepository.js";
import { ResourceVisibilityManager } from "../src/services/resourceVisibility.js";
import { PostgresResourceAccessRepository } from "../src/infrastructure/database/postgres/PostgresResourceAccessRepository.js";
import { hasLocalPg, useMigrationTenant } from "./migrationHarness.js";

/** Lot V3 (q196, q198, q209, q212, R-1) — level 1. */
const T = "t3";
const RM = "11111111-1111-4111-8111-111111111111";
const READER = "22222222-2222-4222-8222-222222222222";
const actor = (userId: string, roles: string[] = []): AuthenticatedUser => ({ userId, tenantId: T, email: `${userId}@v3`, roles } as AuthenticatedUser);

function manager(over: Partial<Record<keyof ResourceAccessRepository, unknown>> = {}) {
  const audits: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
  const access = {
    hiddenCounts: vi.fn(async () => ({ RISK: 2, CONTROL: 1, ANOMALY: 0, ACTION_PLAN: 3, KPI: 4 })),
    seesEverything: vi.fn(async () => false),
    listRestricted: vi.fn(async () => []),
    departmentGroupGains: vi.fn(async () => []),
    canRead: vi.fn(async () => false),
    ...over,
  } as unknown as ResourceAccessRepository;
  const users = { getById: vi.fn(), listWithPermission: vi.fn(async () => [{ id: RM, displayName: "RM" }]) };
  const notifications = { create: vi.fn(async (n: unknown) => n) };
  const m = new ResourceVisibilityManager(access, { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { audits.push(e); } } as never, users as never, notifications as never);
  return { m, access, audits, notifications };
}

describe("V3 — « X éléments non visibles » (q196, q198)", () => {
  it("only the types the reader may list; null (no mention) for a group that sees everything", async () => {
    expect(await manager().m.hiddenCounts(actor(READER, ["risk.read", "kpi.read"]))).toEqual({ RISK: 2, KPI: 4 });
    expect(await manager({ hiddenCounts: vi.fn(async () => null) }).m.hiddenCounts(actor(RM, ["risk.read"]))).toBeNull();
  });
});

describe("V3 — list of the restricted resources (q209)", () => {
  it("Risk Manager group (resourcevisibility.set) or a group that sees everything (Committee, Audit); anyone else 403", async () => {
    await expect(manager().m.listRestricted(actor(READER, ["risk.read"]))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(manager({ seesEverything: vi.fn(async () => true) }).m.listRestricted(actor(READER))).resolves.toEqual([]);
    await expect(manager().m.listRestricted(actor(RM, ["resourcevisibility.set"]))).resolves.toEqual([]);
  });
});

describe("V3 — q212: a department group or a risk designation that opens restricted resources", () => {
  it("department group: reason required outside the RM group when something opens; nothing asked otherwise", async () => {
    const opens = manager({ departmentGroupGains: vi.fn(async () => [{ type: "RISK", id: "r1" }]) });
    await expect(opens.m.guardDepartmentGroupOpening(actor(READER), "d1", "u1", undefined)).rejects.toBeInstanceOf(ValidationError);
    await expect(opens.m.guardDepartmentGroupOpening(actor(READER), "d1", "u1", "Mutation")).resolves.toMatchObject({ reason: "Mutation", holdsRight: false });
    await expect(opens.m.guardDepartmentGroupOpening(actor(RM, ["resourcevisibility.set"]), "d1", "u1", undefined)).resolves.toMatchObject({ holdsRight: true });
    await expect(manager().m.guardDepartmentGroupOpening(actor(READER), "d1", "u1", undefined)).resolves.toBeNull();
  });

  it("risk designation: null when the person already reads it; reason required otherwise outside the RM group", async () => {
    await expect(manager({ canRead: vi.fn(async () => true) }).m.guardRiskDesignationOpening(actor(READER), "r1", "u1", undefined)).resolves.toBeNull();
    await expect(manager().m.guardRiskDesignationOpening(actor(READER), "r1", "u1", undefined)).rejects.toBeInstanceOf(ValidationError);
    await expect(manager().m.guardRiskDesignationOpening(actor(READER), "r1", "u1", "Nouveau propriétaire")).resolves.toMatchObject({ reason: "Nouveau propriétaire" });
  });
});

describe.skipIf(!hasLocalPg)("lot V3 on real PostgreSQL (local only)", () => {
  const { ctx, one } = useMigrationTenant("v3");
  const user = async (name: string) =>
    (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`, [ctx.tenant, `${name}-${Math.random()}@v3`, name])).id as string;

  it("hiddenCounts: PERIMETRE only (NOMINATIF never), inherited level for anomalies; null for a fixed group; seesEverything", async () => {
    const [o, x, com] = await Promise.all(["o", "x", "com"].map(user));
    const committee = (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, $2, '{}', 'RISK_COMMITTEE') RETURNING id`, [ctx.tenant, `C-${Math.random()}`])).id;
    await one(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4) RETURNING id`, [ctx.tenant, committee, com, o]);
    const risk = async (visibility: string) =>
      (await one(`INSERT INTO risks (tenant_id, process, description, owner_id, visibility) VALUES ($1, 'p', 'd', $2, $3) RETURNING id`, [ctx.tenant, o, visibility])).id as string;
    const perim = await risk("PERIMETRE");
    await risk("NOMINATIF");
    await risk("CLIENT");
    await one(`INSERT INTO anomalies (tenant_id, risk_id, description, severity, detected_by, status) VALUES ($1, $2, 't', 'LOW', $3, 'NEW') RETURNING id`, [ctx.tenant, perim, o]);
    const repo = new PostgresResourceAccessRepository(ctx.pool);
    expect(await repo.hiddenCounts(ctx.tenant, x!)).toEqual({ RISK: 1, CONTROL: 0, ANOMALY: 1, ACTION_PLAN: 0, KPI: 0 });
    expect(await repo.hiddenCounts(ctx.tenant, o!)).toEqual({ RISK: 0, CONTROL: 0, ANOMALY: 0, ACTION_PLAN: 0, KPI: 0 });
    expect(await repo.seesEverything(ctx.tenant, com!)).toBe(true);
    expect(await repo.hiddenCounts(ctx.tenant, com!)).toBeNull();
  });

  it("listRestricted carries the last visibility change (R-1) and is paginated; departmentGroupGains", async () => {
    const [o, x] = await Promise.all(["o", "x"].map(user));
    const dept = (await one(`INSERT INTO departments (tenant_id, name) VALUES ($1, $2) RETURNING id`, [ctx.tenant, `D-${Math.random()}`])).id as string;
    const kpi = (await one(`INSERT INTO kpis (tenant_id, label, target_value, unit, frequency, owner, department_id, visibility) VALUES ($1, 'KPI V3', 1, '%', 'MONTHLY', 't', $2, 'PERIMETRE') RETURNING id`, [ctx.tenant, dept])).id as string;
    await one(`INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id)
               VALUES ($1, $2, 'Kpi', $3, 'PERMISSION_CHANGE', '{}', '{"widening": false}', 'Restreint pour V3', 't-v3') RETURNING id`, [ctx.tenant, o, kpi]);
    const repo = new PostgresResourceAccessRepository(ctx.pool);
    const row = (await repo.listRestricted(ctx.tenant)).find((r) => r.id === kpi);
    expect(row?.lastChange).toMatchObject({ userId: o, reason: "Restreint pour V3", widening: false });
    expect(await repo.listRestricted(ctx.tenant, { limit: 1 })).toHaveLength(1);
    expect(await repo.departmentGroupGains(ctx.tenant, dept, x!)).toEqual([{ type: "KPI", id: kpi }]);
  });
});
