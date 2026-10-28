import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RoleService } from "../src/services/RoleService.js";
import type { RoleRepository } from "../src/domain/repositories/RoleRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { Role, RoleAssignment } from "../src/domain/entities/Role.js";
import type { DepartmentRepository } from "../src/domain/repositories/DepartmentRepository.js";
import type { Department } from "../src/domain/entities/Department.js";
import type { User } from "../src/domain/entities/User.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

/** `suspended`: user ids treated as suspended (users.deleted_at set) — mirrors the Postgres JOIN on users. */
function inMemoryRoleRepository(suspended: ReadonlySet<string> = new Set()): RoleRepository {
  const roles = new Map<string, Role>();
  const assignments = new Map<string, RoleAssignment>();

  return {
    async getById(tenantId, id) {
      const r = roles.get(id);
      return r && r.tenantId === tenantId && !r.deletedAt ? r : null;
    },
    async getByName(tenantId, name) {
      return [...roles.values()].find((r) => r.tenantId === tenantId && r.name === name && !r.deletedAt) ?? null;
    },
    async list(tenantId, options) {
      return [...roles.values()].filter(
        (r) => r.tenantId === tenantId && (options?.includeDisabled || !r.deletedAt),
      );
    },
    async create(input) {
      const role: Role = {
        id: randomUUID(),
        tenantId: input.tenantId,
        name: input.name,
        description: input.description ?? null,
        permissions: input.permissions,
        dashboardScopeMode: input.dashboardScopeMode ?? "GLOBAL",
        systemGroup: (input as { systemGroup?: Role["systemGroup"] }).systemGroup ?? null,
        departmentId: input.departmentId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      roles.set(role.id, role);
      return role;
    },
    async update(tenantId, id, input) {
      const existing = roles.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, ...input, updatedAt: new Date() };
      roles.set(id, updated);
      return updated;
    },
    async disable(tenantId, id) {
      const existing = roles.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      roles.set(id, { ...existing, deletedAt: new Date() });
    },
    async countActiveAssignments(tenantId, roleId) {
      return [...assignments.values()].filter(
        (a) => a.tenantId === tenantId && a.roleId === roleId && !a.revokedAt && !suspended.has(a.userId),
      ).length;
    },
    async assignToUser(tenantId, roleId, userId, grantedBy) {
      const assignment: RoleAssignment = {
        id: randomUUID(),
        tenantId,
        roleId,
        userId,
        grantedBy,
        grantedAt: new Date(),
        revokedAt: null,
      };
      assignments.set(assignment.id, assignment);
      return assignment;
    },
    async revokeFromUser(tenantId, roleId, userId) {
      const assignment = [...assignments.values()].find(
        (a) => a.tenantId === tenantId && a.roleId === roleId && a.userId === userId && !a.revokedAt,
      );
      if (!assignment) throw new Error("not found");
      assignments.set(assignment.id, { ...assignment, revokedAt: new Date() });
    },
    async listForUser(tenantId, userId) {
      const activeRoleIds = [...assignments.values()]
        .filter((a) => a.tenantId === tenantId && a.userId === userId && !a.revokedAt)
        .map((a) => a.roleId);
      return [...roles.values()].filter((r) => activeRoleIds.includes(r.id) && !r.deletedAt);
    },
    async listAssignments(tenantId, roleId) {
      return [...assignments.values()].filter((a) => a.tenantId === tenantId && a.roleId === roleId);
    },
  };
}

function inMemoryUserRepository(users: User[]): UserRepository {
  return {
    async getById(tenantId, id) {
      return users.find((u) => u.tenantId === tenantId && u.id === id) ?? null;
    },
    async getByEmail(tenantId, email, options) {
      return (
        users.find(
          (u) => u.tenantId === tenantId && u.email === email && (options?.includeSuspended || !u.deletedAt),
        ) ?? null
      );
    },
    async list(tenantId, options) {
      return users.filter((u) => u.tenantId === tenantId && (options?.includeSuspended || !u.deletedAt));
    },
    async count(tenantId, options) {
      return users.filter((u) => u.tenantId === tenantId && (options?.includeSuspended || !u.deletedAt)).length;
    },
    async create() {
      throw new Error("not implemented in this fake");
    },
    async update() {
      throw new Error("not implemented in this fake");
    },
    async suspend() {
      throw new Error("not implemented in this fake");
    },
    async reactivate() {
      throw new Error("not implemented in this fake");
    },
  };
}

function inMemoryAuditRepository(): AuditRepository {
  return {
    async record() {},
    async listForEntity() {
      return [];
    },
    async listRecent() {
      return [];
    },
  };
}

const admin: AuthenticatedUser = {
  userId: "admin-1",
  tenantId: "tenant-1",
  email: "admin@example.com",
  displayName: "Admin",
  roles: ["role.read", "role.create", "role.update", "role.delete", "role.assign"],
};

const otherAdmin: AuthenticatedUser = { ...admin, userId: "admin-2" };

describe("RoleService", () => {
  it("creates a role with a valid permission set", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    const role = await service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-1");
    expect(role.name).toBe("Auditeur");
    expect(role.permissions).toEqual(["audit.read"]);
  });

  it("rejects an unknown permission", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    await expect(
      service.create(admin, { name: "Bogus", permissions: ["not.a.real.permission" as never] }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a duplicate active role name", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    await service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-3");
    await expect(
      service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-4"),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses to let an admin assign a role to themselves", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    const role = await service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-5");
    await expect(service.assignToUser(admin, role.id, admin.userId, "REQ-6", "motif de test")).rejects.toThrow(ForbiddenError);
    // Upper-case form of the actor's own id: same user for Postgres, must be refused too (QA-B6d-01 class)
    await expect(service.assignToUser(admin, role.id, ` ${admin.userId.toUpperCase()}`, "REQ-6b", "motif de test")).rejects.toThrow(ForbiddenError);
  });

  it("assigns a role to another user, granting it via listForUser", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    const role = await service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-7");
    await service.assignToUser(admin, role.id, "user-1", "REQ-8", "motif de test");
    const userRoles = await service.listForUser(admin, "user-1");
    expect(userRoles.map((r) => r.id)).toContain(role.id);
  });

  it("refuses to disable a role that still has active assignments", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    const role = await service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-9");
    await service.assignToUser(admin, role.id, "user-1", "REQ-10", "motif de test");
    await expect(service.disable(admin, role.id, "REQ-11")).rejects.toThrow(ValidationError);
  });

  it("refuses to revoke a user's last active role", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    const role = await service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-12");
    await service.assignToUser(admin, role.id, "user-1", "REQ-13", "motif de test");
    await expect(service.revokeFromUser(otherAdmin, role.id, "user-1", "REQ-14", "motif de test")).rejects.toThrow(ValidationError);
  });

  it("refuses to let an admin revoke their own role", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    const role = await service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-15");
    await service.assignToUser(otherAdmin, role.id, admin.userId, "REQ-16", "motif de test");
    await expect(service.revokeFromUser(admin, role.id, admin.userId, "REQ-17", "motif de test")).rejects.toThrow(ForbiddenError);
    await expect(service.revokeFromUser(admin, role.id, admin.userId.toUpperCase(), "REQ-17b", "motif de test")).rejects.toThrow(ForbiddenError);
  });

  describe("dashboardScopeMode (@architect design, 2026-09-30)", () => {
    it("defaults a role to GLOBAL when dashboardScopeMode is omitted", async () => {
      const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
      const role = await service.create(admin, { name: "Chef", permissions: ["dashboard.read"] }, "REQ-D1");
      expect(role.dashboardScopeMode).toBe("GLOBAL");
    });

    it("accepts DEPARTMENT on create", async () => {
      const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
      const role = await service.create(
        admin,
        { name: "Chef Dept", permissions: ["dashboard.executive"], dashboardScopeMode: "DEPARTMENT" },
        "REQ-D2",
      );
      expect(role.dashboardScopeMode).toBe("DEPARTMENT");
    });

    it("rejects PROCESS on create — risks.process_id backfill is not done", async () => {
      const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
      await expect(
        service.create(
          admin,
          { name: "Chef Process", permissions: ["dashboard.executive"], dashboardScopeMode: "PROCESS" },
          "REQ-D3",
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects PROCESS on update", async () => {
      const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
      const role = await service.create(admin, { name: "Chef", permissions: ["dashboard.executive"] }, "REQ-D4");
      await expect(
        service.update(admin, role.id, { dashboardScopeMode: "PROCESS" }, "REQ-D5"),
      ).rejects.toThrow(ValidationError);
    });

    it("accepts switching an existing role from GLOBAL to DEPARTMENT on update", async () => {
      const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
      const role = await service.create(admin, { name: "Chef", permissions: ["dashboard.executive"] }, "REQ-D6");
      const updated = await service.update(admin, role.id, { dashboardScopeMode: "DEPARTMENT" }, "REQ-D7");
      expect(updated.dashboardScopeMode).toBe("DEPARTMENT");
    });
  });

  describe("getEffectivePermissions", () => {
    const targetUser: User = {
      id: "user-1",
      tenantId: "tenant-1",
      email: "user1@example.com",
      displayName: "User One",
      // "not.a.real.permission" simulates a stale/hand-edited grant that
      // must be filtered out, not trusted (SEC-005).
      roles: ["evidence.upload", "not.a.real.permission"],
      createdAt: new Date(),
      deletedAt: null,
    };

    it("unions BASE_PERMISSIONS, filtered legacy grants and RBAC role permissions", async () => {
      const service = new RoleService(
        inMemoryRoleRepository(),
        inMemoryAuditRepository(),
        inMemoryUserRepository([targetUser]),
      );
      const role = await service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-18");
      await service.assignToUser(admin, role.id, targetUser.id, "REQ-19", "motif de test");

      const permissions = await service.getEffectivePermissions(admin, targetUser.id);

      expect(permissions).toContain("feedback.create"); // BASE_PERMISSIONS
      expect(permissions).toContain("evidence.upload"); // legacy grant, known permission
      expect(permissions).toContain("audit.read"); // via RBAC role
      expect(permissions).not.toContain("not.a.real.permission");
    });

    it("throws NotFoundError for a user that doesn't exist", async () => {
      const service = new RoleService(
        inMemoryRoleRepository(),
        inMemoryAuditRepository(),
        inMemoryUserRepository([]),
      );
      await expect(service.getEffectivePermissions(admin, "missing-user")).rejects.toThrow(NotFoundError);
    });

    it("F7-S3: gives each effective permission its origins (base, direct grant, role)", async () => {
      const service = new RoleService(
        inMemoryRoleRepository(),
        inMemoryAuditRepository(),
        inMemoryUserRepository([targetUser]),
      );
      const role = await service.create(admin, { name: "Auditeur", permissions: ["audit.read", "evidence.upload"] }, "REQ-30");
      await service.assignToUser(admin, role.id, targetUser.id, "REQ-31", "motif de test");

      const sources = await service.getEffectivePermissionSources(admin, targetUser.id);
      const of = (p: string) => sources.find((s) => s.permission === p)?.sources;

      expect(of("feedback.create")).toEqual([{ kind: "BASE" }]);
      expect(of("audit.read")).toEqual([{ kind: "ROLE", roleId: role.id, roleName: "Auditeur", systemGroup: null }]);
      expect(of("evidence.upload")?.map((s) => s.kind)).toEqual(["DIRECT", "ROLE"]);
      expect(of("not.a.real.permission")).toBeUndefined();
      expect(sources.map((s) => s.permission).sort()).toEqual((await service.getEffectivePermissions(admin, targetUser.id)).sort());
    });

    it("F7-S3: origins require role.read", async () => {
      const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository(), inMemoryUserRepository([targetUser]));
      const reader: AuthenticatedUser = { ...admin, roles: admin.roles.filter((p) => p !== "role.read") };
      await expect(service.getEffectivePermissionSources(reader, targetUser.id)).rejects.toThrow(ForbiddenError);
    });

    it("throws when constructed without a UserRepository", async () => {
      const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
      await expect(service.getEffectivePermissions(admin, targetUser.id)).rejects.toThrow(
        "requires a UserRepository",
      );
    });
  });

  describe("fixed groups and department groups (B-8)", () => {
    const departments = {
      async getById(_tenantId: string, id: string) {
        return id === "dept-1" || id === "dept-2" ? ({ id } as Department) : null;
      },
    } as unknown as DepartmentRepository;

    async function withGroup(systemGroup: "RISK_MANAGER" | "RISK_COMMITTEE", suspended: Set<string> = new Set()) {
      const repo = inMemoryRoleRepository(suspended);
      const service = new RoleService(repo, inMemoryAuditRepository(), undefined, departments);
      const group = await repo.create({
        tenantId: admin.tenantId,
        name: systemGroup,
        permissions: [],
        systemGroup,
      } as never);
      // Every member also holds a second role so the "last active role" rule is not what blocks the revoke.
      const other = await service.create(admin, { name: "Other", permissions: ["risk.read"] }, "REQ-o");
      for (const userId of ["u1", "u2"]) {
        await service.assignToUser(admin, group.id, userId, "REQ-a", "motif de test");
        await service.assignToUser(admin, other.id, userId, "REQ-a", "motif de test");
      }
      return { service, group };
    }

    it("F-B8-01: a suspended member does not count — RM = {u1 active, u2 suspended}, revoking u1 is refused", async () => {
      const { service, group } = await withGroup("RISK_MANAGER", new Set(["u2"]));
      await expect(service.revokeFromUser(admin, group.id, "u1", "REQ-1", "motif de test")).rejects.toThrow(ValidationError);
    });

    it("F-B8-05: revoking a suspended member succeeds while another active member remains; the last active one is still refused", async () => {
      const suspended = new Set(["u2"]);
      const repo = inMemoryRoleRepository(suspended);
      const mkUser = (id: string, deletedAt: Date | null) => ({ id, tenantId: admin.tenantId, deletedAt }) as User;
      const users = inMemoryUserRepository([mkUser("u1", null), mkUser("u2", new Date())]);
      const service = new RoleService(repo, inMemoryAuditRepository(), users, departments);
      const group = await repo.create({ tenantId: admin.tenantId, name: "RM", permissions: [], systemGroup: "RISK_MANAGER" } as never);
      const other = await service.create(admin, { name: "Other", permissions: ["risk.read"] }, "REQ-o");
      for (const userId of ["u1", "u2"]) {
        await service.assignToUser(admin, group.id, userId, "REQ-a", "motif de test");
        await service.assignToUser(admin, other.id, userId, "REQ-a", "motif de test");
      }
      await service.revokeFromUser(admin, group.id, "u2", "REQ-1", "motif de test");
      await expect(service.revokeFromUser(admin, group.id, "u1", "REQ-2", "motif de test")).rejects.toThrow(ValidationError);
    });

    it("F-B8-01: refuses to suspend the last active Risk Manager member", async () => {
      const { service, group } = await withGroup("RISK_MANAGER");
      await service.revokeFromUser(admin, group.id, "u1", "REQ-1", "motif de test");
      await expect(service.assertNotLastRiskManager(admin.tenantId, "u2")).rejects.toThrow(ValidationError);
    });

    it("refuses to disable or rename a fixed group", async () => {
      const { service, group } = await withGroup("RISK_MANAGER");
      await expect(service.disable(admin, group.id, "REQ-d")).rejects.toThrow(ValidationError);
      await expect(service.update(admin, group.id, { name: "Renamed" }, "REQ-r")).rejects.toThrow(ValidationError);
    });

    it("never lets the Risk Manager group become empty", async () => {
      const { service, group } = await withGroup("RISK_MANAGER");
      await service.revokeFromUser(admin, group.id, "u1", "REQ-1", "motif de test");
      await expect(service.revokeFromUser(admin, group.id, "u2", "REQ-2", "motif de test")).rejects.toThrow(ValidationError);
    });

    it("lets the Risk Committee group become empty", async () => {
      const { service, group } = await withGroup("RISK_COMMITTEE");
      await service.revokeFromUser(admin, group.id, "u1", "REQ-1", "motif de test");
      await service.revokeFromUser(admin, group.id, "u2", "REQ-2", "motif de test");
    });

    it("links a role to a department only once, and only to a real department", async () => {
      const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository(), undefined, departments);
      const role = await service.create(admin, { name: "Finance", permissions: ["audit.read"], departmentId: "dept-1" }, "REQ-1");
      expect(role.departmentId).toBe("dept-1");
      await expect(
        service.create(admin, { name: "Finance 2", permissions: ["audit.read"], departmentId: "dept-1" }, "REQ-2"),
      ).rejects.toThrow(ValidationError);
      await expect(
        service.create(admin, { name: "Ghost", permissions: ["audit.read"], departmentId: "nope" }, "REQ-3"),
      ).rejects.toThrow(ValidationError);
    });

    it("fails closed when a departmentId is given without a DepartmentRepository", async () => {
      const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
      await expect(
        service.create(admin, { name: "Finance", permissions: ["audit.read"], departmentId: "dept-1" }, "REQ-1"),
      ).rejects.toThrow("requires a DepartmentRepository");
    });
  });
});
