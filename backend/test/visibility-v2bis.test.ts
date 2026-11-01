import { describe, expect, it, vi } from "vitest";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { ResourceAccessRepository } from "../src/domain/repositories/ResourceAccessRepository.js";
import { ResourceVisibilityManager } from "../src/services/resourceVisibility.js";
import { RaciAssignmentService } from "../src/services/RaciAssignmentService.js";
import { PostgresResourceAccessRepository } from "../src/infrastructure/database/postgres/PostgresResourceAccessRepository.js";
import { hasLocalPg, useMigrationTenant } from "./migrationHarness.js";

/** Lot V2bis (DECISION-107, q207/q208) — level 1. */
const T = "t2b";
const RM = "11111111-1111-4111-8111-111111111111";
const EDITOR = "22222222-2222-4222-8222-222222222222";
const TARGET = "33333333-3333-4333-8333-333333333333";
const RISK = "44444444-4444-4444-8444-444444444444";
const actor = (userId: string, roles: string[] = []): AuthenticatedUser => ({ userId, tenantId: T, email: `${userId}@v2b`, roles } as AuthenticatedUser);

function world(readsBefore: boolean, readsAfter = true) {
  const audits: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
  let created = false;
  const access = {
    canRead: vi.fn(async () => (created ? readsAfter : readsBefore)),
    processOwnerGains: vi.fn(async () => []),
    listRestricted: vi.fn(async () => []),
    seesEverything: vi.fn(async () => false),
  } as unknown as ResourceAccessRepository;
  const notifications = { create: vi.fn(async (n: unknown) => n) };
  const users = {
    getById: vi.fn(async (_t: string, id: string) => ({ id, displayName: id, deletedAt: null })),
    listWithPermission: vi.fn(async () => [{ id: RM, displayName: "RM" }]),
  };
  const audit = { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { audits.push(e); } };
  const manager = new ResourceVisibilityManager(access, audit as never, users as never, notifications as never);
  const raci = {
    create: vi.fn(async (a: Record<string, unknown>) => { created = true; return { id: "ra1", ...a }; }),
    listForEntity: vi.fn(async () => []),
    remove: vi.fn(),
  };
  const risks = { getById: vi.fn(async () => ({ id: RISK })), hiddenIds: vi.fn(async () => []) };
  const svc = new RaciAssignmentService(raci as never, audit as never, risks as never, undefined, undefined, users as never, manager);
  return { svc, manager, audits, notifications, raci };
}

describe("q207 — a RACI assignment that opens a restricted resource", () => {
  it("outside the Risk Manager group: a reason is required, before any write", async () => {
    const w = world(false);
    await expect(w.svc.assign(actor(EDITOR, ["raci.assign"]), "RISK", RISK, TARGET, "C", "r")).rejects.toBeInstanceOf(ValidationError);
    expect(w.raci.create).not.toHaveBeenCalled();
  });

  it("with a reason: CREATE + PERMISSION_CHANGE (widening, through RACI) on the risk, and the Risk Manager group is notified", async () => {
    const w = world(false);
    await w.svc.assign(actor(EDITOR, ["raci.assign"]), "RISK", RISK, TARGET, "C", "req", "Expert consulté");
    expect(w.audits.map((a) => a.action)).toEqual(["CREATE", "PERMISSION_CHANGE"]);
    expect(w.audits[1]).toMatchObject({ entityType: "Risk", entityId: RISK, userId: EDITOR, reason: "Expert consulté", newValue: { widening: true, through: "RACI", raciUserId: TARGET } });
    expect(w.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: RM, eventType: "RISK_VISIBILITY_WIDENED", resourceId: RISK }));
  });

  it("the Risk Manager: no reason needed, still traced, no notification", async () => {
    const w = world(false);
    await w.svc.assign(actor(RM, ["raci.assign", "resourcevisibility.set"]), "RISK", RISK, TARGET, "C", "req");
    expect(w.audits.map((a) => a.action)).toEqual(["CREATE", "PERMISSION_CHANGE"]);
    expect(w.notifications.create).not.toHaveBeenCalled();
  });

  it("nothing opens (the person already reads it, or the level ignores RACI): no reason, no trace, no notification", async () => {
    for (const w of [world(true), world(false, false)]) {
      await w.svc.assign(actor(EDITOR, ["raci.assign"]), "RISK", RISK, TARGET, "C", "req", "Motif");
      expect(w.audits.map((a) => a.action)).toEqual(["CREATE"]);
      expect(w.notifications.create).not.toHaveBeenCalled();
    }
    const plain = world(true);
    await expect(plain.svc.assign(actor(EDITOR, ["raci.assign"]), "RISK", RISK, TARGET, "C", "req")).resolves.toBeTruthy();
  });
});

describe("q207 / q208 — process owner and list of restricted resources", () => {
  it("a new process owner who would open restricted resources: reason required outside the RM group", async () => {
    const w = world(true);
    const gains = vi.fn(async () => [{ type: "RISK", id: RISK }]);
    (w.manager as unknown as { access: { processOwnerGains: typeof gains } }).access.processOwnerGains = gains;
    await expect(w.manager.guardProcessOwnerOpening(actor(EDITOR), "p1", TARGET, undefined)).rejects.toBeInstanceOf(ValidationError);
    await expect(w.manager.guardProcessOwnerOpening(actor(EDITOR), "p1", TARGET, "Réorganisation")).resolves.toMatchObject({ reason: "Réorganisation", holdsRight: false, opened: [{ type: "RISK", id: RISK }] });
    await expect(w.manager.guardProcessOwnerOpening(actor(RM, ["resourcevisibility.set"]), "p1", TARGET, undefined)).resolves.toMatchObject({ reason: null, holdsRight: true });
  });

  it("the list of restricted resources is for the groups that see everything (PRIV-V3-01: membership, never a permission alone)", async () => {
    const w = world(true);
    await expect(w.manager.listRestricted(actor(EDITOR))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.manager.listRestricted(actor(RM, ["resourcevisibility.set"]))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe.skipIf(!hasLocalPg)("lot V2bis on real PostgreSQL (local only)", () => {
  const { ctx, one } = useMigrationTenant("v2bis");
  const user = async (name: string) =>
    (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`, [ctx.tenant, `${name}-${Math.random()}@v2b`, name])).id as string;

  it("canRead, processOwnerGains and listRestricted", async () => {
    const [o, x, g] = await Promise.all(["o", "x", "g"].map(user));
    const proc = (await one(`INSERT INTO processes (tenant_id, level, name) VALUES ($1, 'PROCESS', $2) RETURNING id`, [ctx.tenant, `P-${Math.random()}`])).id as string;
    const risk = (await one(`INSERT INTO risks (tenant_id, process, description, owner_id, process_id, visibility) VALUES ($1, 'p', 'Risque restreint V2bis', $2, $3, 'PERIMETRE') RETURNING id`, [ctx.tenant, o, proc])).id as string;
    const kpi = (await one(`INSERT INTO kpis (tenant_id, label, target_value, unit, frequency, owner, process_id, visibility) VALUES ($1, 'KPI V2bis', 1, '%', 'MONTHLY', 't', $2, 'NOMINATIF') RETURNING id`, [ctx.tenant, proc])).id as string;
    await one(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason) VALUES ($1, 'KPI', $2, $3, $4, 'test') RETURNING id`, [ctx.tenant, kpi, g, o]);
    const repo = new PostgresResourceAccessRepository(ctx.pool);
    expect(await repo.canRead(ctx.tenant, "RISK", risk, o!)).toBe(true);
    expect(await repo.canRead(ctx.tenant, "RISK", risk, x!)).toBe(false);
    // owning the process opens the PERIMETRE risk, not the NOMINATIF KPI
    expect(await repo.processOwnerGains(ctx.tenant, proc, x!)).toEqual([{ type: "RISK", id: risk }]);
    const list = await repo.listRestricted(ctx.tenant);
    expect(list.map((r) => [r.type, r.id, r.visibility, r.accessCount])).toEqual(expect.arrayContaining([["RISK", risk, "PERIMETRE", 0], ["KPI", kpi, "NOMINATIF", 1]]));
    expect(list.find((r) => r.id === risk)?.label).toBe("Risque restreint V2bis");
  });

  it("Codex P2 (PR #224): createChecked — refusal without reason writes nothing; audit and assignment commit or roll back together", async () => {
    const { PostgresRaciAssignmentRepository } = await import("../src/infrastructure/database/postgres/PostgresRaciAssignmentRepository.js");
    const [o, x] = await Promise.all(["o", "x"].map(user));
    const risk = (await one(`INSERT INTO risks (tenant_id, process, description, owner_id, visibility) VALUES ($1, 'p', 'd', $2, 'PERIMETRE') RETURNING id`, [ctx.tenant, o])).id as string;
    const repo = new PostgresRaciAssignmentRepository(ctx.pool);
    const input = { tenantId: ctx.tenant, entityType: "RISK" as const, entityId: risk, userId: x!, role: "C" as const, createdBy: o! };
    const count = async () => Number((await one(`SELECT count(*) AS n FROM raci_assignments WHERE entity_id = $1`, [risk])).n);
    await expect(repo.createChecked(input, true, () => [])).rejects.toThrow(/reason/);
    expect(await count()).toBe(0);
    await expect(repo.createChecked(input, false, () => [{ tenantId: ctx.tenant } as never])).rejects.toThrow();
    expect(await count()).toBe(0);
    const requestId = `t-v2b-cc-${Math.random()}`; // the local database may be reused between runs
    const ok = await repo.createChecked(input, false, ({ assignment }) => [{ tenantId: ctx.tenant, userId: o!, entityType: "RaciAssignment",
      entityId: assignment.id, action: "CREATE", oldValue: null, newValue: assignment, reason: "Motif", requestId }]);
    expect(ok.opened).toBe(true);
    expect(await count()).toBe(1);
    expect(Number((await one(`SELECT count(*) AS n FROM audit_log WHERE request_id = $1`, [requestId])).n)).toBe(1);
  });
});
