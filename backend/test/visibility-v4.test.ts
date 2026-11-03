import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { RoleService } from "../src/services/RoleService.js";
import { ResourceVisibilityManager } from "../src/services/resourceVisibility.js";
import { ADMIN_PERMISSIONS } from "../src/domain/fixedGroupPermissions.js";
import type { RoleRepository } from "../src/domain/repositories/RoleRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { ResourceAccessRepository } from "../src/domain/repositories/ResourceAccessRepository.js";
import type { SensitiveViewGrant, SensitiveViewGrantRepository } from "../src/domain/repositories/SensitiveViewGrantRepository.js";
import { PostgresSensitiveViewGrantRepository } from "../src/infrastructure/database/postgres/PostgresSensitiveViewGrantRepository.js";
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
      Object.assign(g, { status: change.status, decidedBy: change.by, decidedAt: new Date(), decisionReason: change.reason });
      return { ...g };
    },
    async revoke() { throw new Error("unused"); },
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

describe("V4 A1 — an administrator without resource.readall lists the metadata only", () => {
  const row = { type: "RISK", id: "r1", label: "Fraude interne", visibility: "NOMINATIF", accessCount: 2, updatedAt: new Date(),
    lastChange: { userId: "rm", at: new Date(), reason: "Enquête", widening: false } };
  const manager = (seesEverything: boolean) => new ResourceVisibilityManager({
    seesEverything: vi.fn(async () => seesEverything), listRestricted: vi.fn(async () => [row]),
  } as unknown as ResourceAccessRepository, { record: async () => {} } as never, { getById: vi.fn() } as never, { create: vi.fn() } as never);

  it("no title, no last change; a non-administrator still gets 403", async () => {
    expect(await manager(false).listRestricted(actor("boss", ["role.assign"]))).toEqual([{ type: "RISK", id: "r1", visibility: "NOMINATIF", accessCount: 2, updatedAt: row.updatedAt }]);
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

  it("an APPROVED RESOURCE_READALL opens every content while the holder is administrator; kind is immutable", async () => {
    // Older idempotency tests re-run 082/083 on this shared base: put back the latest definitions first (idempotent).
    await ctx.pool.query(migrationSql("084_resource_readall.sql"));
    const [boss, it_, aud, owner] = await Promise.all(["boss", "it", "aud", "owner"].map(user));
    const adminRole = (await one(`INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, $2, '{role.assign}') RETURNING id`, [ctx.tenant, `A-${Math.random()}`])).id;
    const held = (await one(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4) RETURNING id`, [ctx.tenant, adminRole, it_, boss])).id;
    const risk = (await one(`INSERT INTO risks (tenant_id, process, description, owner_id, visibility) VALUES ($1, 'p', 'd', $2, 'NOMINATIF') RETURNING id`, [ctx.tenant, owner])).id;
    const sees = async () => (await one(`SELECT risk_visible_to($1, $2, $3) AS ok`, [ctx.tenant, risk, it_])).ok;
    expect(await sees()).toBe(false);
    const repo = new PostgresSensitiveViewGrantRepository(ctx.pool);
    const g = await repo.create({ tenantId: ctx.tenant, userId: it_!, reason: "Support", requestedBy: boss!, expiresAt: null, kind: "RESOURCE_READALL" }, () => []);
    expect(g.kind).toBe("RESOURCE_READALL");
    expect(await sees()).toBe(false); // pending
    await repo.decide(ctx.tenant, g.id, { status: "APPROVED", by: aud!, reason: null }, () => []);
    expect(await sees()).toBe(true);
    expect(await repo.isApproved(ctx.tenant, it_!)).toBe(false); // not a role.read.sensitive grant
    expect(await repo.isApproved(ctx.tenant, it_!, "RESOURCE_READALL")).toBe(true);
    await expect(one(`UPDATE sensitive_view_grants SET kind = 'ROLE_READ_SENSITIVE' WHERE id = $1 RETURNING id`, [g.id])).rejects.toThrow(/immutable/);
    await one(`UPDATE user_roles SET revoked_at = now() WHERE id = $1 RETURNING id`, [held]);
    expect(await sees()).toBe(false); // no longer administrator: no effect, without waiting for the revocation
    expect((await repo.revokeLiveOf(ctx.tenant, it_!, { by: boss!, reason: "Fin" }, () => [], "RESOURCE_READALL"))?.status).toBe("REVOKED");
  });
});
