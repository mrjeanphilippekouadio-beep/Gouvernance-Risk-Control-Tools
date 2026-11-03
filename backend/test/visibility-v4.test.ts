import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { RoleService } from "../src/services/RoleService.js";
import { ResourceVisibilityManager } from "../src/services/resourceVisibility.js";
import { withReadallAudit } from "../src/services/readallAudit.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_PERMISSIONS } from "../src/domain/fixedGroupPermissions.js";
import type { RoleRepository } from "../src/domain/repositories/RoleRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { ResourceAccessRepository } from "../src/domain/repositories/ResourceAccessRepository.js";
import type { SensitiveViewGrant, SensitiveViewGrantRepository } from "../src/domain/repositories/SensitiveViewGrantRepository.js";
import { PostgresSensitiveViewGrantRepository } from "../src/infrastructure/database/postgres/PostgresSensitiveViewGrantRepository.js";
import { PostgresResourceAccessRepository } from "../src/infrastructure/database/postgres/PostgresResourceAccessRepository.js";
import type { Role, RoleAssignment } from "../src/domain/entities/Role.js";
import type { User } from "../src/domain/entities/User.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import { hasLocalPg, migrationSql, useMigrationTenant } from "./migrationHarness.js";

/** Lot V4 (DECISION-103, q197 A3): resource.readall for one administrator; A1 metadata view — level 1. */
const T = "tenant-v4";
const person = (id: string): User => ({ id, tenantId: T, email: `${id}@v4`, displayName: id, roles: [], createdAt: new Date(), deletedAt: null });
const actor = (userId: string, roles: string[]): AuthenticatedUser => ({ userId, tenantId: T, email: `${userId}@v4`, displayName: userId, roles });

function world() {
  const roles: Role[] = [];
  const assignments: RoleAssignment[] = [];
  const grants: SensitiveViewGrant[] = [];
  const roleRepo = {
    async list() { return roles; },
    async getById(_t: string, id: string) { return roles.find((r) => r.id === id) ?? null; },
    async listForUser(_t: string, userId: string) {
      return roles.filter((r) => assignments.some((a) => a.roleId === r.id && a.userId === userId && !a.revokedAt));
    },
    async listAssignments(_t: string, roleId: string) { return assignments.filter((a) => a.roleId === roleId); },
    async update(_t: string, id: string, input: { permissions?: string[] }) {
      const r = roles.find((x) => x.id === id)!;
      if (input.permissions) r.permissions = input.permissions as Role["permissions"];
      return { ...r };
    },
  } as unknown as RoleRepository;
  const users = ["boss", "it", "auditor", "auditadmin", "rm", "staff"].map(person);
  const userRepo = { async getById(_t: string, id: string) { return users.find((u) => u.id === id) ?? null; }, async list() { return users; } } as unknown as UserRepository;
  const live = (g: SensitiveViewGrant) => g.status === "PENDING" || g.status === "APPROVED";
  const grantRepo: SensitiveViewGrantRepository = {
    async list() { return [...grants]; },
    async getById(_t, id) { return grants.find((g) => g.id === id) ?? null; },
    async isApproved(_t, userId, kind = "ROLE_READ_SENSITIVE") { return grants.some((g) => g.userId === userId && g.kind === kind && g.status === "APPROVED"); },
    async create(input, events) {
      if (grants.some((g) => g.userId === input.userId && live(g))) throw new ConflictError("live");
      const g = { id: randomUUID(), ...input, status: "PENDING", requestedAt: new Date(), decidedBy: null, decidedAt: null,
        decisionReason: null, revokedBy: null, revokedAt: null, revokeReason: null } as SensitiveViewGrant;
      grants.push(g);
      events(g);
      return g;
    },
    async decide(_t, id, change) {
      const g = grants.find((x) => x.id === id && x.status === "PENDING");
      if (!g) throw new ConflictError("decided");
      Object.assign(g, { status: change.status, decidedBy: change.by, decidedAt: new Date(), decisionReason: change.reason,
        accessExpiresAt: change.accessDays ? new Date(Date.now() + change.accessDays * 86_400_000) : null });
      return { ...g };
    },
    async revoke(_t, id, change) {
      const g = grants.find((x) => x.id === id && live(x));
      if (!g) throw new ConflictError("final");
      Object.assign(g, { status: "REVOKED", revokedBy: change.by, revokedAt: new Date(), revokeReason: change.reason });
      return { ...g };
    },
    async closeStaleLive(_t, userId, kind, change) {
      const g = grants.find((x) => x.userId === userId && x.kind === kind && x.status === "APPROVED" && x.accessExpiresAt && x.accessExpiresAt.getTime() <= Date.now());
      if (!g) return null;
      Object.assign(g, { status: "REVOKED", revokedBy: change.by, revokedAt: new Date(), revokeReason: change.reason });
      return { ...g };
    },
    async revokeLiveOf(_t, userId, change, _events, kind = "ROLE_READ_SENSITIVE") {
      const g = grants.find((x) => x.userId === userId && x.kind === kind && live(x));
      if (!g) return null;
      Object.assign(g, { status: "REVOKED", revokedBy: change.by, revokedAt: new Date(), revokeReason: change.reason });
      return { ...g };
    },
  };
  const role = (name: string, systemGroup: Role["systemGroup"], permissions: string[], members: string[]) => {
    const r = { id: randomUUID(), tenantId: T, name, permissions, systemGroup } as Role;
    roles.push(r);
    for (const userId of members) assignments.push({ id: randomUUID(), tenantId: T, roleId: r.id, userId, grantedBy: "seed", grantedAt: new Date(), revokedAt: null });
    return r;
  };
  role("Risk Manager", "RISK_MANAGER", ["role.read"], ["rm"]);
  role("Audit", "AUDIT", ["audit.read", "rolegroup.audit.validate"], ["auditor", "auditadmin"]);
  role("Administrateurs", null, ["role.assign"], ["boss", "auditadmin"]);
  const itRole = role("Support", null, ["role.assign"], ["it"]);
  const service = new RoleService(roleRepo, { record: async () => {} } as never, userRepo, undefined, undefined, undefined, undefined, undefined, undefined, grantRepo);
  return { service, grants, itRole };
}

const admin = actor("boss", ["role.read", "role.assign"]);
const validator = actor("auditor", ["rolegroup.audit.validate"]);

describe("V4 — resource.readall through the q200 circuit (kind RESOURCE_READALL)", () => {
  it("asked by an administrator for another administrator, confirmed by Audit: GRANT in the matrix", async () => {
    const { service } = world();
    expect((await service.sensitiveViewCandidates(admin, "RESOURCE_READALL")).map((c) => c.id)).toEqual(["it"]);
    const g = await service.requestSensitiveView(admin, "it", "Support : enquête sur un incident", "R1", "RESOURCE_READALL");
    expect(g.kind).toBe("RESOURCE_READALL");
    expect(await service.listSensitiveViewGrants(admin)).toEqual([]); // the default kind stays role.read.sensitive
    expect((await service.listSensitiveViewGrants(admin, "RESOURCE_READALL")).map((x) => x.id)).toEqual([g.id]);
    await service.decideSensitiveView(validator, g.id, true, null, "R2");
    const sources = await service.getEffectivePermissionSources(admin, "it");
    expect(sources.permissions.find((p) => p.permission === "resource.readall")?.sources).toEqual([{ kind: "GRANT" }]);
  });

  it("beneficiary: an administrator outside the fixed groups; never for oneself; never on a role", async () => {
    const { service } = world();
    await expect(service.requestSensitiveView(admin, "boss", "Moi", "R1", "RESOURCE_READALL")).rejects.toThrow(ForbiddenError);
    await expect(service.requestSensitiveView(admin, "staff", "Pas admin", "R2", "RESOURCE_READALL")).rejects.toThrow(ValidationError);
    await expect(service.requestSensitiveView(admin, "auditadmin", "Voit déjà tout", "R3", "RESOURCE_READALL")).rejects.toThrow(ValidationError);
    await expect(service.create(admin, { name: "Lecteur", permissions: ["resource.readall"] } as never)).rejects.toThrow();
  });

  it("q202: an administrator (even an Audit member) never confirms it", async () => {
    const { service } = world();
    const g = await service.requestSensitiveView(admin, "it", "Support", "R1", "RESOURCE_READALL");
    await expect(service.decideSensitiveView(actor("auditadmin", ["rolegroup.audit.validate"]), g.id, true, null, "R2")).rejects.toThrow(ForbiddenError);
  });

  it("losing the last administration right ends it for good (calque SEC-RL-05)", async () => {
    const { service, grants } = world();
    const g = await service.requestSensitiveView(admin, "it", "Support", "R1", "RESOURCE_READALL");
    await service.decideSensitiveView(validator, g.id, true, null, "R2");
    await service.endSensitiveView(admin, "it", "Fin automatique : le compte n'est plus administrateur", "R3", "RESOURCE_READALL");
    expect(grants[0]!.status).toBe("REVOKED");
  });
});

describe("Codex P2 (PR #226) — reactivation ends a grant the suspension left alive", () => {
  it("reactivate() ends every live grant of the account before reactivating", async () => {
    const { UserService } = await import("../src/services/UserService.js");
    const suspended = { ...person("it"), deletedAt: new Date() };
    const users = { getById: vi.fn(async () => suspended), reactivate: vi.fn(async () => { suspended.deletedAt = null as never; }) };
    const ended: unknown[][] = [];
    const roleService = { assertReactivable: vi.fn(), listLostRoles: vi.fn(async () => []),
      endSensitiveView: vi.fn(async (...a: unknown[]) => { ended.push(a); expect(users.reactivate).not.toHaveBeenCalled(); }) };
    const svc = new UserService(users as never, { record: async () => {} } as never, roleService as never);
    await svc.reactivate(actor("boss", ["user.reactivate"]), "it", "R1", "Retour");
    expect(ended.map((a) => a[4] ?? "ROLE_READ_SENSITIVE")).toEqual(["ROLE_READ_SENSITIVE", "RESOURCE_READALL"]);
  });
});

describe("V4 — corrections A10 (SEC V4-01, SEC V4-02)", () => {
  it("SEC V4-01: a role update that removes the last administration right ends resource.readall for good (t -> f -> t does not revive it)", async () => {
    const { service, grants, itRole } = world();
    const g = await service.requestSensitiveView(admin, "it", "Support", "R1", "RESOURCE_READALL");
    await service.decideSensitiveView(validator, g.id, true, null, "R2");
    await service.update(actor("boss", ["role.update", "role.read"]), itRole.id, { permissions: ["risk.read"] } as never, "R3", "Retrait des droits d'administration");
    expect(grants[0]!.status).toBe("REVOKED");
    await service.update(actor("boss", ["role.update", "role.read"]), itRole.id, { permissions: ["role.assign"] } as never, "R4", "Droits rendus");
    expect(grants[0]!.status).toBe("REVOKED");
    const sources = await service.getEffectivePermissionSources(admin, "it");
    expect(sources.permissions.some((p) => p.permission === "resource.readall")).toBe(false);
  });

  it("SEC V4-02: an administrator by direct permission, seated in Audit, never confirms resource.readall", async () => {
    const { service } = world();
    const g = await service.requestSensitiveView(admin, "it", "Support", "R1", "RESOURCE_READALL");
    await expect(service.decideSensitiveView(actor("auditor", ["rolegroup.audit.validate", "role.assign"]), g.id, true, null, "R2")).rejects.toThrow(ForbiddenError);
  });
});

describe("DECISION-111 — q221 end of the access, q222 revocation by a confirmer", () => {
  it("q221: the confirmation fixes the end at 90 days by default (no extension)", async () => {
    const { service, grants } = world();
    const g = await service.requestSensitiveView(admin, "it", "Support", "R1", "RESOURCE_READALL");
    await service.decideSensitiveView(validator, g.id, true, null, "R2");
    expect(Math.round((grants[0]!.accessExpiresAt!.getTime() - Date.now()) / 86_400_000)).toBe(90);
  });

  it("Codex P2 (PR #226): an ended (expired) resource.readall is closed by the targeted lookup, then a new request is accepted", async () => {
    const { service, grants } = world();
    const g = await service.requestSensitiveView(admin, "it", "Support", "R1", "RESOURCE_READALL");
    await service.decideSensitiveView(validator, g.id, true, null, "R2");
    grants[0]!.accessExpiresAt = new Date(Date.now() - 1000);
    const again = await service.requestSensitiveView(admin, "it", "Nouveau besoin", "R3", "RESOURCE_READALL");
    expect(grants[0]!.status).toBe("REVOKED");
    expect(again.status).toBe("PENDING");
  });

  it("q222: an Audit member may revoke a resource.readall, never a q200 view; anyone else is refused", async () => {
    const { service, grants } = world();
    const g = await service.requestSensitiveView(admin, "it", "Support", "R1", "RESOURCE_READALL");
    await service.decideSensitiveView(validator, g.id, true, null, "R2");
    await expect(service.revokeSensitiveView(actor("staff", ["risk.read"]), g.id, "Fin", "R3")).rejects.toThrow(ForbiddenError);
    expect((await service.revokeSensitiveView(validator, g.id, "Fin de l'enquête", "R4")).status).toBe("REVOKED");
    const view = await service.requestSensitiveView(admin, "rm", "Contrôle", "R5");
    await expect(service.revokeSensitiveView(validator, view.id, "Fin", "R6")).rejects.toThrow(ForbiddenError);
    expect(grants.find((x) => x.id === view.id)!.status).toBe("PENDING");
  });
});

describe("q220 / SEC V4-03 — reads allowed only by resource.readall are audited (helper + repository wrapper)", () => {
  const make = (opened: { grantId: string | null; ids: string[] }, fail = false) => {
    const audits: Array<Record<string, unknown>> = [];
    const readOnlyThroughReadall = vi.fn(async () => opened);
    const m = new ResourceVisibilityManager({ readOnlyThroughReadall } as unknown as ResourceAccessRepository,
      { record: async (e: Record<string, unknown>) => { if (fail) throw new Error("audit down"); audits.push(e); } } as never, {} as never, {} as never);
    return { m, audits, readOnlyThroughReadall };
  };
  it("ONE: a READ row per resource (type, id, grant, no content); LIST: a single row with the ids and the count", async () => {
    const one = make({ grantId: "g1", ids: ["r1"] });
    await one.m.recordReadallFor(T, "it", "RISK", ["r1"], "ONE");
    expect(one.audits).toEqual([expect.objectContaining({ action: "READ", entityType: "Risk", entityId: "r1", newValue: { through: "RESOURCE_READALL", grantId: "g1" } })]);
    const list = make({ grantId: "g1", ids: ["c1", "c2"] });
    await list.m.recordReadallFor(T, "it", "CONTROL", ["c0", "c1", "c2"], "LIST");
    expect(list.audits).toEqual([expect.objectContaining({ action: "READ", entityType: "SensitiveViewGrant", entityId: "g1",
      newValue: { through: "RESOURCE_READALL", list: "CONTROL", count: 2, ids: ["c1", "c2"] } })]);
  });
  it("Codex P2 (PR #226): an item the rules without the right do not open is logged even without a live grant (reference null, keyed on the reader)", async () => {
    const gone = make({ grantId: null, ids: ["r1", "r2"] });
    await gone.m.recordReadallFor(T, "it", "RISK", ["r1", "r2"], "LIST");
    expect(gone.audits).toEqual([expect.objectContaining({ action: "READ", entityType: "User", entityId: "it", newValue: { through: "RESOURCE_READALL", list: "RISK", count: 2, ids: ["r1", "r2"] } })]);
  });
  it("nothing for a read owing nothing to the right; a failed write fails the read", async () => {
    const none = make({ grantId: "g1", ids: [] });
    await none.m.recordReadallFor(T, "it", "RISK", ["r1"], "LIST");
    expect(none.audits).toEqual([]);
    await expect(make({ grantId: "g1", ids: ["r1"] }, true).m.recordReadallFor(T, "it", "RISK", ["r1"], "ONE")).rejects.toThrow("audit down");
  });
  it("withReadallAudit: every reader-scoped read is recorded (one row, a list, hiddenIds' complement); SYSTEM_SCOPE and writes untouched", async () => {
    const calls: unknown[][] = [];
    const recorder = { recordReadallFor: vi.fn(async (...a: unknown[]) => { calls.push(a); }) };
    const repo = withReadallAudit({
      async getById(_t: string, id: string) { return { id }; },
      async list() { return [{ id: "a" }, { id: "b" }]; },
      async hiddenIds(_t: string, ids: string[]) { return ids.filter((x) => x === "h"); },
      async update(_t: string, id: string) { return { id }; },
    }, "RISK", recorder as never);
    const reader = { all: false as const, userId: "u1" };
    await repo.getById(T, "r1", reader);
    await repo.list(T, undefined, reader);
    await repo.hiddenIds(T, ["h", "v"], reader);
    await repo.getById(T, "r2", { all: true });
    await repo.update(T, "r3");
    expect(calls).toEqual([[T, "u1", "RISK", ["r1"], "ONE"], [T, "u1", "RISK", ["a", "b"], "LIST"], [T, "u1", "RISK", ["v"], "LIST"]]);
  });
  it("inventory (SEC V4-03 / CMP-V4-10): the five restrictable roots are built only through withReadallAudit in server.ts", () => {
    const server = readFileSync(join(__dirname, "..", "src", "server.ts"), "utf8");
    for (const cls of ["PostgresRiskRepository", "PostgresControlRepository", "PostgresAnomalyRepository", "PostgresKpiRepository", "PostgresActionPlanRepository"]) {
      const built = [...server.matchAll(new RegExp(`new ${cls}\\(`, "g"))].length;
      const wrapped = [...server.matchAll(new RegExp(`withReadallAudit\\(new ${cls}\\(`, "g"))].length;
      expect(built, cls).toBeGreaterThan(0);
      expect(wrapped, cls).toBe(built);
    }
  });
});

describe("q221 cap (CMP (iii), Privacy Q3, SEC INFO-08): the life of a reading of every content is 1 to 90 days", () => {
  it("91 days is refused before any write; 90 is accepted as a value; the migration CHECK says the same", async () => {
    const { ConfigService } = await import("../src/services/ConfigService.js");
    const configs = { getByTenant: vi.fn(async () => null) };
    const svc = new ConfigService(configs as never, { record: async () => {} } as never);
    const who = actor("boss", ["config.governancedelays.set"]);
    await expect(svc.setGovernanceDelays(who, { resourceReadallMaxDays: 91 } as never, "Durée", "R1")).rejects.toThrow(ValidationError);
    expect(configs.getByTenant).not.toHaveBeenCalled();
    expect(migrationSql("084_resource_readall.sql")).toMatch(/CHECK \(resource_readall_max_days BETWEEN 1 AND 90\)/);
  });
});

describe("V4 A1 — an administrator without resource.readall lists the metadata only", () => {
  const row = { type: "RISK", id: "r1", label: "Fraude interne", visibility: "NOMINATIF", accessCount: 2, updatedAt: new Date(),
    lastChange: { userId: "rm", at: new Date(), reason: "Enquête", widening: false } };
  const manager = (seesEverything: boolean) => new ResourceVisibilityManager({
    seesEverything: vi.fn(async () => seesEverything), listRestricted: vi.fn(async () => [row]),
  } as unknown as ResourceAccessRepository, { record: async () => {} } as never, { getById: vi.fn() } as never, { create: vi.fn() } as never);

  it("no title, no last change; a non-administrator still gets 403", async () => {
    expect(await manager(false).listRestricted(actor("boss", ["role.assign"]))).toEqual([{ type: "RISK", id: "r1", visibility: "NOMINATIF", accessCount: 2, updatedAt: row.updatedAt.toISOString().slice(0, 10) }]); // q223: the date only
    await expect(manager(false).listRestricted(actor("staff", ["risk.read"]))).rejects.toThrow(ForbiddenError);
    expect((await manager(true).listRestricted(actor("it", ["role.assign"])))[0]).toMatchObject({ label: "Fraude interne" });
  });
});

describe("V4 — 084 copies ADMIN_PERMISSIONS", () => {
  it("visibility_is_administrator lists exactly ADMIN_PERMISSIONS", () => {
    const sql = migrationSql("084_resource_readall.sql");
    const array = /ro\.permissions && ARRAY\[([^\]]*)\]/.exec(sql)![1]!;
    expect([...array.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()).toEqual([...ADMIN_PERMISSIONS].sort());
  });
});

describe.skipIf(!hasLocalPg)("lot V4 on real PostgreSQL (local only)", () => {
  const { ctx, one } = useMigrationTenant("v4");
  const user = async (name: string) =>
    (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`, [ctx.tenant, `${name}-${Math.random()}@v4`, name])).id as string;

  it("q219/q221: an APPROVED, unexpired RESOURCE_READALL opens PERIMETRE (never NOMINATIF) while the holder is administrator; kind and end are immutable", async () => {
    // Older idempotency tests re-run 082/083 on this shared base: put back the latest definitions first (idempotent).
    await ctx.pool.query(migrationSql("084_resource_readall.sql"));
    const [boss, it_, aud, owner] = await Promise.all(["boss", "it", "aud", "owner"].map(user));
    const adminRole = (await one(`INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, $2, '{role.assign}') RETURNING id`, [ctx.tenant, `A-${Math.random()}`])).id;
    const held = (await one(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4) RETURNING id`, [ctx.tenant, adminRole, it_, boss])).id;
    const risk = async (v: string) => (await one(`INSERT INTO risks (tenant_id, process, description, owner_id, visibility) VALUES ($1, 'p', 'd', $2, $3) RETURNING id`, [ctx.tenant, owner, v])).id as string;
    const [perim, nomin] = [await risk("PERIMETRE"), await risk("NOMINATIF")];
    const sees = async (r: string) => (await one(`SELECT risk_visible_to($1, $2, $3) AS ok`, [ctx.tenant, r, it_])).ok;
    expect(await sees(perim)).toBe(false);
    const repo = new PostgresSensitiveViewGrantRepository(ctx.pool);
    const g = await repo.create({ tenantId: ctx.tenant, userId: it_!, reason: "Support", requestedBy: boss!, expiresAt: null, kind: "RESOURCE_READALL" }, () => []);
    expect(await sees(perim)).toBe(false); // pending
    const approved = await repo.decide(ctx.tenant, g.id, { status: "APPROVED", by: aud!, reason: null, accessDays: 90 }, () => []);
    expect(Math.round((approved.accessExpiresAt!.getTime() - Date.now()) / 86_400_000)).toBe(90); // q221: fixed at the confirmation
    expect(await sees(perim)).toBe(true);
    expect(await sees(nomin)).toBe(false); // q219: never NOMINATIF
    const access = new PostgresResourceAccessRepository(ctx.pool);
    expect(await access.readOnlyThroughReadall(ctx.tenant, it_!, "RISK", [perim])).toEqual({ grantId: g.id, ids: [perim] }); // q220
    // SEC V4-03: a child path (here `hiddenIds`, as KRIs, evaluations, decisions use it) through the wrapped repository writes the row
    const { PostgresRiskRepository } = await import("../src/infrastructure/database/postgres/PostgresRiskRepository.js");
    const { PostgresAuditRepository } = await import("../src/infrastructure/database/postgres/PostgresAuditRepository.js");
    const manager = new ResourceVisibilityManager(access, new PostgresAuditRepository(ctx.pool), {} as never, {} as never);
    await withReadallAudit(new PostgresRiskRepository(ctx.pool), "RISK", manager).hiddenIds!(ctx.tenant, [perim, nomin], { all: false, userId: it_! });
    const row = await one(`SELECT new_value FROM audit_log WHERE tenant_id = $1 AND entity_id::text = $2 AND action = 'READ' ORDER BY timestamp DESC LIMIT 1`, [ctx.tenant, g.id]);
    expect(row.new_value).toEqual({ through: "RESOURCE_READALL", list: "RISK", count: 1, ids: [perim] });
    expect(await access.seesEverything(ctx.tenant, it_!)).toBe(false); // the fixed groups only
    expect(await repo.isApproved(ctx.tenant, it_!)).toBe(false); // not a role.read.sensitive grant
    expect(await repo.isApproved(ctx.tenant, it_!, "RESOURCE_READALL")).toBe(true);
    await expect(one(`UPDATE sensitive_view_grants SET kind = 'ROLE_READ_SENSITIVE' WHERE id = $1 RETURNING id`, [g.id])).rejects.toThrow(/immutable/);
    await expect(one(`UPDATE sensitive_view_grants SET access_expires_at = now() + interval '1 year' WHERE id = $1 RETURNING id`, [g.id])).rejects.toThrow(/confirmation only/);
    // q221: past its end the grant opens nothing (the guard is bypassed here only to age the row)
    await ctx.pool.query(`ALTER TABLE sensitive_view_grants DISABLE TRIGGER sensitive_view_grants_guard`);
    try { await ctx.pool.query(`UPDATE sensitive_view_grants SET access_expires_at = now() - interval '1 day' WHERE id = $1`, [g.id]); }
    finally { await ctx.pool.query(`ALTER TABLE sensitive_view_grants ENABLE TRIGGER sensitive_view_grants_guard`); }
    expect(await sees(perim)).toBe(false);
    expect(await repo.isApproved(ctx.tenant, it_!, "RESOURCE_READALL")).toBe(false);
    // Codex P2 (PR #226): decided by the rules without the right, not by a live grant — the last confirmed one is the reference
    expect(await access.readOnlyThroughReadall(ctx.tenant, it_!, "RISK", [perim])).toEqual({ grantId: g.id, ids: [perim] });
    // Codex P2 (PR #226): the expired APPROVED grant is closed by a targeted, locked lookup (frees the live index)
    expect((await repo.closeStaleLive(ctx.tenant, it_!, "RESOURCE_READALL", { by: boss!, reason: "Échue" }, () => []))?.status).toBe("REVOKED");
    expect(await repo.closeStaleLive(ctx.tenant, it_!, "RESOURCE_READALL", { by: boss!, reason: "Échue" }, () => [])).toBeNull();
    await one(`UPDATE user_roles SET revoked_at = now() WHERE id = $1 RETURNING id`, [held]);
    expect(await repo.revokeLiveOf(ctx.tenant, it_!, { by: boss!, reason: "Fin" }, () => [], "RESOURCE_READALL")).toBeNull(); // already closed
  });
});

describe.skipIf(!hasLocalPg)("q224 (DECISION-112) on real PostgreSQL: anyRestricted reads the effective level", () => {
  const { ctx, one } = useMigrationTenant("v4bis");
  it("CLIENT only -> false; a PERIMETRE risk -> true; an anomaly inheriting a NOMINATIF risk -> true", async () => {
    const owner = (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'o') RETURNING id`, [ctx.tenant, `o-${Math.random()}@v4b`])).id;
    const risk = async (v: string) => (await one(`INSERT INTO risks (tenant_id, process, description, owner_id, visibility) VALUES ($1, 'p', 'd', $2, $3) RETURNING id`, [ctx.tenant, owner, v])).id as string;
    const [c, p, n] = [await risk("CLIENT"), await risk("PERIMETRE"), await risk("NOMINATIF")];
    const anomaly = (await one(`INSERT INTO anomalies (tenant_id, risk_id, description, severity, detected_by, status) VALUES ($1, $2, 't', 'LOW', $3, 'NEW') RETURNING id`, [ctx.tenant, n, owner])).id as string;
    const repo = new PostgresResourceAccessRepository(ctx.pool);
    expect(await repo.anyRestricted(ctx.tenant, "RISK", [c])).toBe(false);
    expect(await repo.anyRestricted(ctx.tenant, "RISK", [c, p])).toBe(true);
    expect(await repo.anyRestricted(ctx.tenant, "ANOMALY", [anomaly])).toBe(true);
  });
});
