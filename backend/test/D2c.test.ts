import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RoleService, RISK_MANAGER_VACANCY_EXCEPTION } from "../src/services/RoleService.js";
import { GovernanceDesignationService } from "../src/services/GovernanceDesignationService.js";
import type { RoleRepository } from "../src/domain/repositories/RoleRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { GovernanceDesignationRepository } from "../src/domain/repositories/GovernanceDesignationRepository.js";
import type { GovernanceDesignation } from "../src/domain/entities/GovernanceDesignation.js";
import type { Role, RoleAssignment, SystemGroup } from "../src/domain/entities/Role.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// Level 1 tests for lot D2c (DECISION-074 q137, DECISION-075 q149, R-3).

type Ev = Omit<AuditEvent, "id" | "timestamp">;
const T = "tenant-1";
const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";
const uid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function world() {
  const roles = new Map<string, Role>();
  const assignments: RoleAssignment[] = [];
  const suspended = new Set<string>();
  const events: Ev[] = [];
  const designations: GovernanceDesignation[] = [];
  const activeOf = (roleId: string) => assignments.filter((a) => a.roleId === roleId && !a.revokedAt && !suspended.has(a.userId));

  const seed = (name: string, systemGroup: SystemGroup | null, permissions: string[] = []) => {
    const r = { id: randomUUID(), tenantId: T, name, description: null, permissions, dashboardScopeMode: "GLOBAL", systemGroup,
      departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null } as Role;
    roles.set(r.id, r);
    return r;
  };
  const grant = (roleId: string, userId: string, grantedBy = "seed") => {
    const a: RoleAssignment = { id: randomUUID(), tenantId: T, roleId, userId, grantedBy, grantedAt: new Date(), revokedAt: null };
    assignments.push(a);
    return a;
  };

  const roleRepo = {
    async getById(_t: string, id: string) { return roles.get(id) ?? null; },
    async countActiveAssignments(_t: string, id: string) { return activeOf(id).length; },
    async listForUser(_t: string, userId: string) {
      const ids = assignments.filter((a) => a.userId === userId && !a.revokedAt).map((a) => a.roleId);
      return [...roles.values()].filter((r) => ids.includes(r.id));
    },
    async revokeFromUser(_t: string, roleId: string, userId: string, o?: { minRemaining?: number; auditEvents?: Ev[] }) {
      const mine = activeOf(roleId).find((a) => a.userId === userId);
      if (!mine) throw new NotFoundError("RoleAssignment", roleId);
      if (activeOf(roleId).filter((a) => a.userId !== userId).length < (o?.minRemaining ?? 0)) throw new ValidationError("last");
      mine.revokedAt = new Date();
      events.push(...(o?.auditEvents ?? []));
    },
    // mirrors PostgresRoleRepository.handOverLastRiskManager: revoke, then assign, then mark the designation, audit, 1 member.
    async handOverLastRiskManager(i: Parameters<NonNullable<RoleRepository["handOverLastRiskManager"]>>[0]) {
      const d = designations.find((x) => x.id === i.designationId);
      if (!d || d.endedAt || d.activatedAt || d.userId !== i.interimUserId) throw new ConflictError("unusable");
      if (i.recheck) await i.recheck(roles.get(i.roleId) as Role, await this.listForUser(T, i.interimUserId));
      const leaving = activeOf(i.roleId).find((a) => a.userId === i.leavingUserId);
      if (!leaving) throw new NotFoundError("RoleAssignment", i.roleId);
      leaving.revokedAt = new Date();
      const a = grant(i.roleId, i.interimUserId, i.grantedBy);
      d.activatedAt = new Date();
      d.activatedRef = a.id;
      events.push(...i.audit(a));
      return a;
    },
  } as unknown as RoleRepository;

  const audit = { async record(e: Ev) { events.push(e); } } as unknown as AuditRepository;
  const users = {
    async getById(_t: string, id: string) {
      return id.startsWith("ghost") ? null : ({ id, tenantId: T, deletedAt: suspended.has(id) ? new Date() : null } as never);
    },
  } as unknown as UserRepository;
  const desRepo: GovernanceDesignationRepository = {
    async getById(_t, id) { return designations.find((d) => d.id === id) ?? null; },
    async getActive(_t, kind) { return designations.find((d) => d.kind === kind && !d.endedAt) ?? null; },
    async list(_t, o) { return designations.filter((d) => o?.includeEnded || !d.endedAt); },
    async create(input) {
      const d: GovernanceDesignation = { id: randomUUID(), ...input, activatedAt: null, activatedRef: null, createdAt: new Date(),
        endedAt: null, endedBy: null, endReason: null };
      designations.push(d);
      return d;
    },
    async end(_t, id, by, why) {
      const d = designations.find((x) => x.id === id && !x.endedAt);
      if (!d) return null;
      Object.assign(d, { endedAt: new Date(), endedBy: by, endReason: why });
      return d;
    },
  };
  const roleService = new RoleService(roleRepo, audit, users, undefined, undefined, undefined, undefined, undefined, desRepo);
  const designationService = new GovernanceDesignationService(desRepo, audit, users, roleRepo);
  const rm = seed("Risk Manager", "RISK_MANAGER", ["risk.read"]);
  const auditGroup = seed("Audit", "AUDIT", ["audit.read"]);
  const filler = seed("Filler", null, ["risk.read"]); // keeps "last active role" out of the way
  return { roles, assignments, events, designations, suspended, roleService, designationService, rm, auditGroup, filler, grant, activeOf };
}

const admin: AuthenticatedUser = {
  userId: ADMIN_ID, tenantId: T, email: "a@x.io", displayName: "A",
  roles: ["role.read", "role.assign", "designation.manage"],
};
const future = () => new Date(Date.now() + 30 * 86_400_000);

/** One Risk Manager (u1), with a second role so only the group rule can block. */
function lastRm() {
  const w = world();
  w.grant(w.rm.id, uid(1));
  w.grant(w.filler.id, uid(1));
  return w;
}

describe("GovernanceDesignationService", () => {
  it("designates an interim: designatedBy forced to the actor, audited", async () => {
    const w = world();
    const d = await w.designationService.designate(admin, { kind: "RISK_MANAGER_INTERIM", userId: uid(2), reason: "absence", validUntil: future() }, "r1");
    expect(d).toMatchObject({ designatedBy: ADMIN_ID, userId: uid(2), kind: "RISK_MANAGER_INTERIM", tenantId: T });
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ entityType: "GovernanceDesignation", action: "CREATE", userId: ADMIN_ID });
  });

  it("requires the permission", async () => {
    const w = world();
    await expect(
      w.designationService.designate({ ...admin, roles: ["role.assign"] }, { kind: "MANAGER", userId: uid(2), reason: "x" }, "r"),
    ).rejects.toThrow(ForbiddenError);
    await expect(w.designationService.list({ ...admin, roles: [] })).rejects.toThrow(ForbiddenError);
  });

  it("refuses self-designation, also with an upper-case id", async () => {
    const w = world();
    for (const userId of [ADMIN_ID, ADMIN_ID.toUpperCase()]) {
      await expect(
        w.designationService.designate(admin, { kind: "RISK_MANAGER_INTERIM", userId, reason: "x", validUntil: future() }, "r"),
      ).rejects.toThrow(ForbiddenError);
    }
  });

  it("interim: end date mandatory and in the future; reason mandatory", async () => {
    const w = world();
    const base = { kind: "RISK_MANAGER_INTERIM" as const, userId: uid(2), reason: "x" };
    await expect(w.designationService.designate(admin, base, "r")).rejects.toThrow(/end date/);
    await expect(w.designationService.designate(admin, { ...base, validUntil: new Date(Date.now() - 1000) }, "r")).rejects.toThrow(ValidationError);
    await expect(w.designationService.designate(admin, { ...base, reason: "  ", validUntil: future() }, "r")).rejects.toThrow(/reason/);
  });

  it("interim cannot come from Audit, cannot be a Risk Manager already, must be an active user of the tenant", async () => {
    const w = world();
    const input = { kind: "RISK_MANAGER_INTERIM" as const, reason: "x", validUntil: future() };
    w.grant(w.auditGroup.id, uid(3));
    await expect(w.designationService.designate(admin, { ...input, userId: uid(3) }, "r")).rejects.toThrow(/Audit/);
    w.grant(w.rm.id, uid(4));
    await expect(w.designationService.designate(admin, { ...input, userId: uid(4) }, "r")).rejects.toThrow(/already a Risk Manager/);
    await expect(w.designationService.designate(admin, { ...input, userId: "ghost-user" }, "r")).rejects.toThrow(/not active/);
    w.suspended.add(uid(5));
    await expect(w.designationService.designate(admin, { ...input, kind: "MANAGER", userId: uid(5) }, "r")).rejects.toThrow(/not active/);
  });

  it("one active designation per kind; ending frees it (soft end, audited, reason required)", async () => {
    const w = world();
    const input = { kind: "MANAGER" as const, userId: uid(2), reason: "x" };
    const d = await w.designationService.designate(admin, input, "r");
    await expect(w.designationService.designate(admin, { ...input, userId: uid(3) }, "r")).rejects.toThrow(ConflictError);
    await expect(w.designationService.end(admin, d.id, " ", "r")).rejects.toThrow(/reason/);
    const ended = await w.designationService.end(admin, d.id, "fin de mission", "r");
    expect(ended.endedBy).toBe(ADMIN_ID);
    await expect(w.designationService.end(admin, d.id, "again", "r")).rejects.toThrow(ConflictError);
    await expect(w.designationService.end(admin, randomUUID(), "x", "r")).rejects.toThrow(NotFoundError);
    await expect(w.designationService.designate(admin, { ...input, userId: uid(3) }, "r")).resolves.toBeDefined();
  });
});

describe("RoleService.revokeFromUser: last Risk Manager (q137 / q149)", () => {
  it("with a usable interim: hands over automatically, two ROLE_CHANGE audits, designation activated", async () => {
    const w = lastRm();
    const d = await w.designationService.designate(admin, { kind: "RISK_MANAGER_INTERIM", userId: uid(2), reason: "x", validUntil: future() }, "r0");
    w.events.length = 0;
    await w.roleService.revokeFromUser(admin, w.rm.id, uid(1), "r1", "départ");
    expect(w.activeOf(w.rm.id).map((a) => a.userId)).toEqual([uid(2)]);
    expect(w.activeOf(w.rm.id)[0]?.grantedBy).toBe(ADMIN_ID);
    expect(d.activatedAt).not.toBeNull();
    expect(w.events).toHaveLength(2);
    expect(w.events.every((e) => e.action === "ROLE_CHANGE" && e.reason === "départ" && !e.governanceException)).toBe(true);
  });

  it("without interim and without confirmation: refused, nothing written", async () => {
    const w = lastRm();
    await expect(w.roleService.revokeFromUser(admin, w.rm.id, uid(1), "r", "départ")).rejects.toThrow(/last member of the Risk Manager/);
    expect(w.activeOf(w.rm.id)).toHaveLength(1);
    expect(w.events).toHaveLength(0);
  });

  it("without interim, confirmed, with a reason: group left empty, audit carries governance_exception", async () => {
    const w = lastRm();
    await w.roleService.revokeFromUser(admin, w.rm.id, uid(1), "r", "démission", true);
    expect(w.activeOf(w.rm.id)).toHaveLength(0);
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ action: "ROLE_CHANGE", reason: "démission", governanceException: RISK_MANAGER_VACANCY_EXCEPTION });
  });

  it("confirmed but no reason: refused", async () => {
    const w = lastRm();
    await expect(w.roleService.revokeFromUser(admin, w.rm.id, uid(1), "r", undefined, true)).rejects.toThrow(/reason/);
    expect(w.activeOf(w.rm.id)).toHaveLength(1);
  });

  it("an interim that is the acting administrator is not used (no self-attribution): needs the confirmation", async () => {
    const w = lastRm();
    // another admin designates the acting admin as interim
    await w.designationService.designate({ ...admin, userId: uid(9) }, { kind: "RISK_MANAGER_INTERIM", userId: ADMIN_ID, reason: "x", validUntil: future() }, "r0");
    await expect(w.roleService.revokeFromUser(admin, w.rm.id, uid(1), "r", "départ")).rejects.toThrow(/last member/);
    expect(w.activeOf(w.rm.id).map((a) => a.userId)).toEqual([uid(1)]);
  });

  it("an expired or suspended interim is not used", async () => {
    const w = lastRm();
    const d = await w.designationService.designate(admin, { kind: "RISK_MANAGER_INTERIM", userId: uid(2), reason: "x", validUntil: future() }, "r0");
    d.validUntil = new Date(Date.now() - 1000);
    await expect(w.roleService.revokeFromUser(admin, w.rm.id, uid(1), "r", "départ")).rejects.toThrow(/last member/);
    d.validUntil = future();
    w.suspended.add(uid(2));
    await expect(w.roleService.revokeFromUser(admin, w.rm.id, uid(1), "r", "départ")).rejects.toThrow(/last member/);
  });

  it("maker-checker kept: cannot revoke own role, even as the last Risk Manager", async () => {
    const w = lastRm();
    await expect(w.roleService.revokeFromUser({ ...admin, userId: uid(1) }, w.rm.id, uid(1), "r", "x", true)).rejects.toThrow(ForbiddenError);
  });

  it("not the last member: ordinary revoke, no exception marker", async () => {
    const w = lastRm();
    w.grant(w.rm.id, uid(6));
    await w.roleService.revokeFromUser(admin, w.rm.id, uid(1), "r", "départ");
    expect(w.events).toHaveLength(1);
    expect(w.events[0]?.governanceException).toBeUndefined();
  });

  it("an interim who is in the Audit group aborts the hand-over (cumul rule replayed), the leaving RM stays", async () => {
    const w = lastRm();
    await w.designationService.designate(admin, { kind: "RISK_MANAGER_INTERIM", userId: uid(2), reason: "x", validUntil: future() }, "r0");
    w.grant(w.auditGroup.id, uid(2)); // became Audit after the designation
    await expect(w.roleService.revokeFromUser(admin, w.rm.id, uid(1), "r", "départ")).rejects.toThrow(ValidationError);
    expect(w.activeOf(w.rm.id).map((a) => a.userId)).toEqual([uid(1)]);
  });
});
