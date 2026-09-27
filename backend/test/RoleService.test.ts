import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RoleService } from "../src/services/RoleService.js";
import type { RoleRepository } from "../src/domain/repositories/RoleRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { Role, RoleAssignment } from "../src/domain/entities/Role.js";
import type { User } from "../src/domain/entities/User.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryRoleRepository(): RoleRepository {
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
      return [...assignments.values()].filter((a) => a.tenantId === tenantId && a.roleId === roleId && !a.revokedAt)
        .length;
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
    await expect(service.assignToUser(admin, role.id, admin.userId, "REQ-6")).rejects.toThrow(ForbiddenError);
  });

  it("assigns a role to another user, granting it via listForUser", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    const role = await service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-7");
    await service.assignToUser(admin, role.id, "user-1", "REQ-8");
    const userRoles = await service.listForUser(admin, "user-1");
    expect(userRoles.map((r) => r.id)).toContain(role.id);
  });

  it("refuses to disable a role that still has active assignments", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    const role = await service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-9");
    await service.assignToUser(admin, role.id, "user-1", "REQ-10");
    await expect(service.disable(admin, role.id, "REQ-11")).rejects.toThrow(ValidationError);
  });

  it("refuses to revoke a user's last active role", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    const role = await service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-12");
    await service.assignToUser(admin, role.id, "user-1", "REQ-13");
    await expect(service.revokeFromUser(otherAdmin, role.id, "user-1", "REQ-14")).rejects.toThrow(ValidationError);
  });

  it("refuses to let an admin revoke their own role", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    const role = await service.create(admin, { name: "Auditeur", permissions: ["audit.read"] }, "REQ-15");
    await service.assignToUser(otherAdmin, role.id, admin.userId, "REQ-16");
    await expect(service.revokeFromUser(admin, role.id, admin.userId, "REQ-17")).rejects.toThrow(ForbiddenError);
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
      await service.assignToUser(admin, role.id, targetUser.id, "REQ-19");

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

    it("throws when constructed without a UserRepository", async () => {
      const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
      await expect(service.getEffectivePermissions(admin, targetUser.id)).rejects.toThrow(
        "requires a UserRepository",
      );
    });
  });
});
