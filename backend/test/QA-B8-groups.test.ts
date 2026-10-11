import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RoleService } from "../src/services/RoleService.js";
import { ProcessService } from "../src/services/ProcessService.js";
import { UserService } from "../src/services/UserService.js";
import type { RoleRepository } from "../src/domain/repositories/RoleRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { DepartmentRepository } from "../src/domain/repositories/DepartmentRepository.js";
import type { ProcessRepository } from "../src/domain/repositories/ProcessRepository.js";
import type { Role, RoleAssignment, SystemGroup } from "../src/domain/entities/Role.js";
import type { Process } from "../src/domain/entities/Process.js";
import type { User } from "../src/domain/entities/User.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// QA level 2 for B-8 (fixed groups, R1.2 / DECISION-038). The verdict is a QA PASS only, not a Security review.

type RecordedEvent = { action: string; userId: string; tenantId: string; entityType: string };

function roleRepo(): RoleRepository & { seed(r: Partial<Role> & { tenantId: string; name: string }): Role } {
  const roles = new Map<string, Role>();
  const assignments: RoleAssignment[] = [];
  const active = (tenantId: string, roleId: string) =>
    assignments.filter((a) => a.tenantId === tenantId && a.roleId === roleId && !a.revokedAt);
  return {
    seed(r) {
      const role: Role = {
        id: randomUUID(), description: null, permissions: [], dashboardScopeMode: "GLOBAL", systemGroup: null,
        departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...r,
      };
      roles.set(role.id, role);
      return role;
    },
    async getById(t, id) {
      const r = roles.get(id);
      return r && r.tenantId === t && !r.deletedAt ? r : null;
    },
    async getByName(t, name) {
      return [...roles.values()].find((r) => r.tenantId === t && r.name === name && !r.deletedAt) ?? null;
    },
    async list(t, o) {
      return [...roles.values()].filter((r) => r.tenantId === t && (o?.includeDisabled || !r.deletedAt));
    },
    async create(input) {
      return this.seed({ ...input, departmentId: input.departmentId ?? null, description: input.description ?? null } as never);
    },
    async update(t, id, input) {
      const e = roles.get(id);
      if (!e || e.tenantId !== t) throw new Error("not found");
      const u = { ...e, ...input } as Role;
      roles.set(id, u);
      return u;
    },
    async disable(t, id) {
      const e = roles.get(id);
      if (!e || e.tenantId !== t) throw new Error("not found");
      roles.set(id, { ...e, deletedAt: new Date() });
    },
    async countActiveAssignments(t, id) {
      return active(t, id).length;
    },
    async assignToUser(t, roleId, userId, grantedBy) {
      const a: RoleAssignment = { id: randomUUID(), tenantId: t, roleId, userId, grantedBy, grantedAt: new Date(), revokedAt: null };
      assignments.push(a);
      return a;
    },
    async revokeFromUser(t, roleId, userId, options) {
      const mine = active(t, roleId).find((a) => a.userId === userId);
      if (!mine) throw new NotFoundError("RoleAssignment", `${roleId}:${userId}`);
      // mirrors the atomic guard of PostgresRoleRepository (members other than the revoked one)
      const others = active(t, roleId).filter((a) => a.userId !== userId).length;
      if (others < (options?.minRemaining ?? 0)) throw new ValidationError("Cannot remove the last member of this group");
      mine.revokedAt = new Date();
    },
    async listForUser(t, userId) {
      const ids = assignments.filter((a) => a.tenantId === t && a.userId === userId && !a.revokedAt).map((a) => a.roleId);
      return [...roles.values()].filter((r) => ids.includes(r.id) && !r.deletedAt);
    },
    async listAssignments(t, roleId) {
      return assignments.filter((a) => a.tenantId === t && a.roleId === roleId);
    },
  };
}

function auditRepo(): AuditRepository & { events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  return {
    events,
    async record(e: RecordedEvent) {
      events.push(e);
    },
    async listForEntity() {
      return [];
    },
    async listRecent() {
      return [];
    },
  } as unknown as AuditRepository & { events: RecordedEvent[] };
}

/** dept-1 and dept-2 exist in tenant-1 only; dept-x belongs to tenant-2. */
const departments = {
  async getById(tenantId: string, id: string) {
    const owner: Record<string, string> = { "dept-1": "tenant-1", "dept-2": "tenant-1", "dept-x": "tenant-2" };
    return owner[id] === tenantId ? { id } : null;
  },
} as unknown as DepartmentRepository;

const admin: AuthenticatedUser = {
  userId: "admin-1", tenantId: "tenant-1", email: "a@x.io", displayName: "A",
  roles: ["role.read", "role.create", "role.update", "role.delete", "role.assign", "user.delete"],
};
const otherTenantAdmin: AuthenticatedUser = { ...admin, userId: "admin-t2", tenantId: "tenant-2" };

const GROUPS: [string, SystemGroup][] = [
  ["Risk Manager", "RISK_MANAGER"],
  ["Risk Committee", "RISK_COMMITTEE"],
  ["Audit", "AUDIT"],
];

function setup() {
  const repo = roleRepo();
  const audit = auditRepo();
  const service = new RoleService(repo, audit, undefined, departments);
  const groups = Object.fromEntries(
    GROUPS.map(([name, sg]) => [sg, repo.seed({ tenantId: "tenant-1", name, systemGroup: sg })]),
  ) as Record<SystemGroup, Role>;
  const filler = repo.seed({ tenantId: "tenant-1", name: "Filler", permissions: ["audit.read"] });
  /** Gives each user a second role so only the group rule (not "last active role") can block a revoke. */
  async function join(group: Role, userIds: string[]) {
    for (const u of userIds) {
      await service.assignToUser({ ...admin, userId: "setup-admin" }, group.id, u, "R-j");
      if (!(await repo.listForUser("tenant-1", u)).some((r) => r.id === filler.id)) {
        await service.assignToUser({ ...admin, userId: "setup-admin" }, filler.id, u, "R-j");
      }
    }
    audit.events.length = 0;
  }
  return { repo, audit, service, groups, join };
}

describe("QA-B8 fixed groups", () => {
  describe.each(GROUPS)("%s", (name, sg) => {
    it("cannot be disabled, even when empty (no state change, no audit)", async () => {
      const { service, groups, repo, audit } = setup();
      await expect(service.disable(admin, groups[sg].id, "R1")).rejects.toThrow(ValidationError);
      expect(await repo.getById("tenant-1", groups[sg].id)).not.toBeNull();
      expect(audit.events).toHaveLength(0);
    });

    it("cannot be renamed (different name or blank), but keeping its own name is accepted", async () => {
      const { service, groups, repo, audit } = setup();
      await expect(service.update(admin, groups[sg].id, { name: `${name} 2` }, "R2")).rejects.toThrow(ValidationError);
      await expect(service.update(admin, groups[sg].id, { name: "" }, "R2")).rejects.toThrow(ValidationError);
      expect((await repo.getById("tenant-1", groups[sg].id))?.name).toBe(name);
      expect(audit.events).toHaveLength(0);
      await service.update(admin, groups[sg].id, { name }, "R2b");
      expect(audit.events).toHaveLength(1);
    });

    it("cannot carry a departmentId", async () => {
      const { service, groups, repo } = setup();
      await expect(service.update(admin, groups[sg].id, { departmentId: "dept-1" }, "R3")).rejects.toThrow(/fixed group/);
      expect((await repo.getById("tenant-1", groups[sg].id))?.departmentId).toBeNull();
    });
  });

  it("a role cannot be created under a fixed group's name (name collision)", async () => {
    const { service } = setup();
    for (const [name] of GROUPS) {
      await expect(service.create(admin, { name, permissions: ["audit.read"] }, "R4")).rejects.toThrow(ValidationError);
    }
  });

  describe("Risk Manager is never empty", () => {
    it("refuses to remove the last member, accepts removing the second to last", async () => {
      const { service, groups, join, repo, audit } = setup();
      await join(groups.RISK_MANAGER, ["u1", "u2"]);
      await service.revokeFromUser(admin, groups.RISK_MANAGER.id, "u1", "R5");
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0]).toMatchObject({ entityType: "Role", action: "ROLE_CHANGE", userId: "admin-1", tenantId: "tenant-1" });
      await expect(service.revokeFromUser(admin, groups.RISK_MANAGER.id, "u2", "R6")).rejects.toThrow(
        /last member of the Risk Manager/,
      );
      expect(await repo.countActiveAssignments("tenant-1", groups.RISK_MANAGER.id)).toBe(1);
      expect(audit.events).toHaveLength(1); // the refusal wrote nothing
    });

    it("repository guard alone also refuses (defence against a race that passed the service pre-check)", async () => {
      const { groups, join, repo } = setup();
      await join(groups.RISK_MANAGER, ["u1"]);
      await expect(repo.revokeFromUser("tenant-1", groups.RISK_MANAGER.id, "u1", { minRemaining: 1 })).rejects.toThrow(
        ValidationError,
      );
    });

    it("after an add-then-remove cycle the last member is still protected", async () => {
      const { service, groups, join } = setup();
      await join(groups.RISK_MANAGER, ["u1"]);
      await join(groups.RISK_MANAGER, ["u2"]);
      await service.revokeFromUser(admin, groups.RISK_MANAGER.id, "u1", "R7");
      await expect(service.revokeFromUser(admin, groups.RISK_MANAGER.id, "u2", "R8")).rejects.toThrow(ValidationError);
    });
  });

  describe.each([["RISK_COMMITTEE"], ["AUDIT"]] as [SystemGroup][])("%s may be emptied", (sg) => {
    it("accepts removing every member, one by one, with an audit event each", async () => {
      const { service, groups, join, repo, audit } = setup();
      await join(groups[sg], ["u1", "u2"]);
      await service.revokeFromUser(admin, groups[sg].id, "u1", "R9");
      await service.revokeFromUser(admin, groups[sg].id, "u2", "R10");
      expect(await repo.countActiveAssignments("tenant-1", groups[sg].id)).toBe(0);
      expect(audit.events).toHaveLength(2);
    });
  });

  describe("maker-checker is still enforced on fixed groups", () => {
    it.each(GROUPS)("%s: self-assign and self-revoke are refused", async (_n, sg) => {
      const { service, groups, join, repo, audit } = setup();
      await join(groups[sg], ["u1", "u2", "admin-1"]);
      await expect(service.assignToUser(admin, groups[sg].id, "admin-1", "R11")).rejects.toThrow(ForbiddenError);
      await expect(service.revokeFromUser(admin, groups[sg].id, "admin-1", "R12")).rejects.toThrow(ForbiddenError);
      expect(await repo.countActiveAssignments("tenant-1", groups[sg].id)).toBe(3);
      expect(audit.events).toHaveLength(0);
    });

    it("a missing role.assign permission is refused", async () => {
      const { service, groups } = setup();
      const noPerm = { ...admin, userId: "admin-2", roles: ["role.read"] } as AuthenticatedUser;
      await expect(service.assignToUser(noPerm, groups.AUDIT.id, "u9", "R13")).rejects.toThrow();
      await expect(service.revokeFromUser(noPerm, groups.AUDIT.id, "u9", "R13")).rejects.toThrow();
    });
  });

  describe("department groups", () => {
    it("accepts one department's group, then refuses a second group for the same department", async () => {
      const { service, audit } = setup();
      const g = await service.create(admin, { name: "Dept 1", permissions: ["audit.read"], departmentId: "dept-1" }, "R14");
      expect(g.departmentId).toBe("dept-1");
      expect(audit.events).toHaveLength(1);
      await expect(
        service.create(admin, { name: "Dept 1 bis", permissions: ["audit.read"], departmentId: "dept-1" }, "R15"),
      ).rejects.toThrow(/already has a group/);
      const g2 = await service.create(admin, { name: "Dept 2", permissions: ["audit.read"], departmentId: "dept-2" }, "R16");
      await expect(service.update(admin, g2.id, { departmentId: "dept-1" }, "R17")).rejects.toThrow(/already has a group/);
    });

    it("re-saving a group with its own departmentId is accepted (self excluded from the duplicate check)", async () => {
      const { service } = setup();
      const g = await service.create(admin, { name: "Dept 1", permissions: ["audit.read"], departmentId: "dept-1" }, "R18");
      await expect(service.update(admin, g.id, { departmentId: "dept-1", description: "d" }, "R19")).resolves.toBeTruthy();
    });

    it("refuses a departmentId of another tenant or a nonexistent one (create and update), with no audit", async () => {
      const { service, audit } = setup();
      const plain = await service.create(admin, { name: "Plain", permissions: ["audit.read"] }, "R20");
      audit.events.length = 0;
      for (const id of ["dept-x", "does-not-exist"]) {
        await expect(
          service.create(admin, { name: `N-${id}`, permissions: ["audit.read"], departmentId: id }, "R21"),
        ).rejects.toThrow(/does not exist in this tenant/);
        await expect(service.update(admin, plain.id, { departmentId: id }, "R22")).rejects.toThrow(ValidationError);
      }
      expect(audit.events).toHaveLength(0);
    });

    it("fails closed (throws, no write) without a DepartmentRepository", async () => {
      const repo = roleRepo();
      const audit = auditRepo();
      const service = new RoleService(repo, audit);
      await expect(
        service.create(admin, { name: "D", permissions: ["audit.read"], departmentId: "dept-1" }, "R23"),
      ).rejects.toThrow(/requires a DepartmentRepository/);
      expect(await repo.list("tenant-1")).toHaveLength(0);
      expect(audit.events).toHaveLength(0);
    });

    it("a department group can be unlinked (departmentId: null) and the department then re-used", async () => {
      const { service } = setup();
      const g = await service.create(admin, { name: "Dept 1", permissions: ["audit.read"], departmentId: "dept-1" }, "R24");
      await service.update(admin, g.id, { departmentId: null }, "R25");
      await expect(
        service.create(admin, { name: "Dept 1 new", permissions: ["audit.read"], departmentId: "dept-1" }, "R26"),
      ).resolves.toBeTruthy();
    });

    it("a disabled department group frees its department", async () => {
      const { service } = setup();
      const g = await service.create(admin, { name: "Dept 1", permissions: ["audit.read"], departmentId: "dept-1" }, "R27");
      await service.disable(admin, g.id, "R28");
      await expect(
        service.create(admin, { name: "Dept 1 new", permissions: ["audit.read"], departmentId: "dept-1" }, "R29"),
      ).resolves.toBeTruthy();
    });
  });

  describe("tenant isolation", () => {
    it("another tenant's admin sees, changes, assigns and revokes nothing on tenant-1's groups", async () => {
      const { service, groups, join, repo, audit } = setup();
      await join(groups.RISK_MANAGER, ["u1", "u2"]);
      const id = groups.RISK_MANAGER.id;
      await expect(service.get(otherTenantAdmin, id)).rejects.toThrow(NotFoundError);
      await expect(service.update(otherTenantAdmin, id, { description: "x" }, "R30")).rejects.toThrow(NotFoundError);
      await expect(service.disable(otherTenantAdmin, id, "R31")).rejects.toThrow(NotFoundError);
      await expect(service.assignToUser(otherTenantAdmin, id, "u3", "R32")).rejects.toThrow(NotFoundError);
      await expect(service.revokeFromUser(otherTenantAdmin, id, "u1", "R33")).rejects.toThrow(NotFoundError);
      expect(await service.list(otherTenantAdmin)).toHaveLength(0);
      expect(await repo.countActiveAssignments("tenant-1", id)).toBe(2);
      expect(audit.events).toHaveLength(0);
    });

    it("tenant-2 cannot link tenant-1's department to one of its groups", async () => {
      const { service } = setup();
      await expect(
        service.create(otherTenantAdmin, { name: "Dept 1", permissions: ["audit.read"], departmentId: "dept-1" }, "R35"),
      ).rejects.toThrow(/does not exist in this tenant/);
    });
  });

  describe("audit on every mutation", () => {
    it("create, update, assign, revoke and disable each write one event with actor and tenant", async () => {
      const { service, audit } = setup();
      const r = await service.create(admin, { name: "Custom", permissions: ["audit.read"] }, "A1");
      await service.update(admin, r.id, { description: "d" }, "A2");
      await service.assignToUser(admin, r.id, "u1", "A3");
      const other = await service.create(admin, { name: "Custom2", permissions: ["audit.read"] }, "A3b");
      await service.assignToUser(admin, other.id, "u1", "A3c");
      await service.revokeFromUser(admin, r.id, "u1", "A4");
      await service.disable(admin, r.id, "A5");
      expect(audit.events.map((e) => e.action)).toEqual([
        "CREATE", "PERMISSION_CHANGE", "ROLE_CHANGE", "CREATE", "ROLE_CHANGE", "ROLE_CHANGE", "DELETE",
      ]);
      expect(audit.events.every((e) => e.userId === "admin-1" && e.tenantId === "tenant-1")).toBe(true);
    });
  });
});

describe("QA-B8 ProcessService departmentId", () => {
  function processRepo(): ProcessRepository {
    const store = new Map<string, Process>();
    return {
      async getById(t: string, id: string) {
        const p = store.get(id);
        return p && p.tenantId === t ? p : null;
      },
      async list(t: string) {
        return [...store.values()].filter((p) => p.tenantId === t);
      },
      async create(input: Partial<Process> & { tenantId: string; level: Process["level"]; name: string }) {
        const p = {
          id: randomUUID(), parentId: input.parentId ?? null, description: null, documentType: null,
          documentReference: null, owner: null, active: true, evaluationMode: null,
          departmentId: input.departmentId ?? null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
          deletedBy: null, deletionReason: null, ...input,
        } as Process;
        store.set(p.id, p);
        return p;
      },
      async update(t: string, id: string, input: Partial<Process>) {
        const e = store.get(id);
        if (!e || e.tenantId !== t) throw new Error("not found");
        const u = { ...e, ...input } as Process;
        store.set(id, u);
        return u;
      },
      async softDelete() {},
    } as unknown as ProcessRepository;
  }
  const actor: AuthenticatedUser = {
    userId: "p-1", tenantId: "tenant-1", email: "p@x.io", displayName: "P",
    roles: ["process.create", "process.update", "process.read"],
  };

  it("accepts an own-tenant department; refuses other-tenant and unknown ones on create and update, no write, no audit", async () => {
    const audit = auditRepo();
    const repo = processRepo();
    const service = new ProcessService(repo, audit, undefined, undefined, undefined, departments);
    const p = await service.create(actor, { level: "PROCESS", name: "P", departmentId: "dept-1" }, "P1");
    expect(p.departmentId).toBe("dept-1");
    audit.events.length = 0;
    for (const id of ["dept-x", "ghost"]) {
      await expect(service.create(actor, { level: "PROCESS", name: "Q", departmentId: id }, "P2")).rejects.toThrow(ValidationError);
      await expect(service.update(actor, p.id, { departmentId: id }, "P3")).rejects.toThrow(ValidationError);
    }
    expect(await repo.list("tenant-1")).toHaveLength(1);
    expect((await repo.getById("tenant-1", p.id))?.departmentId).toBe("dept-1");
    expect(audit.events).toHaveLength(0);
  });

  it("a tenant-2 actor cannot attach a process to tenant-1's dept-1", async () => {
    const service = new ProcessService(processRepo(), auditRepo(), undefined, undefined, undefined, departments);
    await expect(
      service.create({ ...actor, tenantId: "tenant-2" }, { level: "PROCESS", name: "P", departmentId: "dept-1" }, "P4"),
    ).rejects.toThrow(ValidationError);
  });

  it("fails closed without a DepartmentRepository (create and update); omitting departmentId still works", async () => {
    const service = new ProcessService(processRepo(), auditRepo());
    await expect(service.create(actor, { level: "PROCESS", name: "P", departmentId: "dept-1" }, "P5")).rejects.toThrow(
      /requires a DepartmentRepository/,
    );
    const p = await service.create(actor, { level: "PROCESS", name: "P" }, "P6");
    await expect(service.update(actor, p.id, { departmentId: "dept-1" }, "P7")).rejects.toThrow(/requires a DepartmentRepository/);
    expect(p.departmentId).toBeNull();
  });
});

describe("QA-B8 known defect DEFECT-B8-01: suspending the last Risk Manager member (reported by A06)", () => {
  // UserService.suspend only soft-deletes the user; the user_roles row stays active, so
  // RoleService.countActiveAssignments still counts a suspended user and the "never empty" invariant is bypassed.
  // Invariant asserted: after any admin action, the Risk Manager group keeps >= 1 non-suspended member.
  // `it.fails` keeps the suite green while the defect exists and turns RED the day it is fixed, which forces
  // this test to be switched to a plain `it`.
  it("suspending the only active Risk Manager member must be refused (group never empty)", async () => {
    const repo = roleRepo();
    const audit = auditRepo();
    const roleService = new RoleService(repo, audit);
    const rm = repo.seed({ tenantId: "tenant-1", name: "Risk Manager", systemGroup: "RISK_MANAGER" });
    await roleService.assignToUser(admin, rm.id, "rm-1", "S1");

    const users: User[] = [
      { id: "rm-1", tenantId: "tenant-1", email: "rm@x.io", displayName: "RM", roles: [], createdAt: new Date(), deletedAt: null },
    ];
    const userRepo = {
      async getById(t: string, id: string) {
        return users.find((u) => u.tenantId === t && u.id === id) ?? null;
      },
      async suspend(t: string, id: string) {
        const u = users.find((x) => x.tenantId === t && x.id === id)!;
        u.deletedAt = new Date();
      },
    } as unknown as UserRepository;
    const userService = new UserService(userRepo, audit, roleService);

    await userService.suspend(admin, "rm-1", "S2").catch(() => undefined);

    const members = await repo.listAssignments("tenant-1", rm.id);
    const activeNonSuspended = members.filter((a) => !a.revokedAt && !users.find((u) => u.id === a.userId)?.deletedAt);
    expect(activeNonSuspended.length).toBeGreaterThanOrEqual(1);
  });
});
