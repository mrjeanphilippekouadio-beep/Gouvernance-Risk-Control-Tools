import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { UserService } from "../src/services/UserService.js";
import { RoleService } from "../src/services/RoleService.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { RoleRepository } from "../src/domain/repositories/RoleRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { DepartmentRepository } from "../src/domain/repositories/DepartmentRepository.js";
import type { Department } from "../src/domain/entities/Department.js";
import type { User } from "../src/domain/entities/User.js";
import type { Role, RoleAssignment } from "../src/domain/entities/Role.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryUserRepository(): UserRepository {
  const store = new Map<string, User>();
  return {
    async getById(tenantId, id) {
      const u = store.get(id);
      return u && u.tenantId === tenantId ? u : null;
    },
    async getByEmail(tenantId, email, options) {
      const u = [...store.values()].find((x) => x.tenantId === tenantId && x.email === email);
      if (!u) return null;
      if (!options?.includeSuspended && u.deletedAt) return null;
      return u;
    },
    async list(tenantId, options) {
      return [...store.values()].filter(
        (u) => u.tenantId === tenantId && (options?.includeSuspended || !u.deletedAt),
      );
    },
    async count(tenantId, options) {
      return [...store.values()].filter(
        (u) => u.tenantId === tenantId && (options?.includeSuspended || !u.deletedAt),
      ).length;
    },
    async create(input) {
      // Mirrors PostgresUserRepository mapping the (tenant_id, email)
      // unique constraint violation to a clean ValidationError.
      const clash = [...store.values()].some((u) => u.tenantId === input.tenantId && u.email === input.email);
      if (clash) throw new ValidationError(`A user with email "${input.email}" already exists`);

      const user: User = {
        id: randomUUID(),
        tenantId: input.tenantId,
        email: input.email,
        displayName: input.displayName,
        roles: [],
        departmentId: input.departmentId ?? null,
        createdAt: new Date(),
        deletedAt: null,
      };
      store.set(user.id, user);
      return user;
    },
    async update(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("User", id);
      const updated = { ...existing, ...input };
      store.set(id, updated);
      return updated;
    },
    async suspend(tenantId, id) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("User", id);
      store.set(id, { ...existing, deletedAt: new Date() });
    },
    async reactivate(tenantId, id) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("User", id);
      store.set(id, { ...existing, deletedAt: null });
    },
  };
}

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

function inMemoryDepartmentRepository(seed: Department[] = []): DepartmentRepository {
  const store = new Map<string, Department>(seed.map((d) => [d.id, d]));
  return {
    async getById(tenantId, id) {
      const d = store.get(id);
      return d && d.tenantId === tenantId ? d : null;
    },
    async list(tenantId) {
      return [...store.values()].filter((d) => d.tenantId === tenantId);
    },
    async create(input) {
      const department: Department = {
        id: randomUUID(),
        tenantId: input.tenantId,
        name: input.name,
        entity: input.entity ?? null,
        manager: input.manager,
        riskOwner: input.riskOwner ?? input.manager,
        riskOwnerDesignatedBy: input.riskOwnerDesignatedBy ?? null,
        riskOwnerDesignatedAt: null,
        linkedProcesses: input.linkedProcesses ?? null,
        active: input.active ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      };
      store.set(department.id, department);
      return department;
    },
    async update(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Department", id);
      const updated = { ...existing, ...input, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async designateRiskOwner(tenantId, id, riskOwner, designatedBy) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Department", id);
      const updated = { ...existing, riskOwner, riskOwnerDesignatedBy: designatedBy, riskOwnerDesignatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async softDelete(tenantId, id, deletedBy, reason) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Department", id);
      store.set(id, { ...existing, deletedAt: new Date(), deletedBy, deletionReason: reason });
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
  roles: ["user.create", "user.read", "user.update", "user.delete", "user.reactivate", "role.assign", "role.read"],
};

const otherTenantAdmin: AuthenticatedUser = { ...admin, userId: "admin-2", tenantId: "tenant-2" };

function makeServices(departmentRepo?: DepartmentRepository) {
  const audit = inMemoryAuditRepository();
  const roleRepo = inMemoryRoleRepository();
  const roleService = new RoleService(roleRepo, audit);
  const userRepo = inMemoryUserRepository();
  const userService = new UserService(userRepo, audit, roleService, departmentRepo);
  return { userService, roleService, userRepo, roleRepo };
}

async function seedRole(roleService: RoleService, actor: AuthenticatedUser, name = "Auditeur"): Promise<Role> {
  return roleService.create({ ...actor, roles: [...actor.roles, "role.create"] }, { name, permissions: ["audit.read"] }, "REQ-ROLE");
}

describe("UserService", () => {
  it("creates a user and assigns the mandatory initial role", async () => {
    const { userService, roleService } = makeServices();
    const role = await seedRole(roleService, admin);

    const user = await userService.create(
      admin,
      { email: "new.user@djamo.com", displayName: "New User", roleId: role.id },
      "REQ-1",
    );

    expect(user.email).toBe("new.user@djamo.com");
    const grantedRoles = await roleService.listForUser(admin, user.id);
    expect(grantedRoles.map((r) => r.id)).toContain(role.id);
  });

  it("rejects creating a user without an initial role", async () => {
    const { userService } = makeServices();
    await expect(
      userService.create(admin, { email: "x@djamo.com", displayName: "X", roleId: "" }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a duplicate email within the same tenant", async () => {
    const { userService, roleService } = makeServices();
    const role = await seedRole(roleService, admin);
    await userService.create(admin, { email: "dup@djamo.com", displayName: "First", roleId: role.id }, "REQ-3");

    await expect(
      userService.create(admin, { email: "dup@djamo.com", displayName: "Second", roleId: role.id }, "REQ-4"),
    ).rejects.toThrow(ValidationError);
  });

  it("throws when no RoleService is configured", async () => {
    const audit = inMemoryAuditRepository();
    const userRepo = inMemoryUserRepository();
    const userService = new UserService(userRepo, audit);
    await expect(
      userService.create(admin, { email: "noRole@djamo.com", displayName: "No Role", roleId: "role-1" }, "REQ-5"),
    ).rejects.toThrow(ValidationError);
  });

  it("F-B8-01: suspend fails closed without a RoleService (Risk Manager guard)", async () => {
    const { userService: withRbac, roleService } = makeServices();
    const role = await seedRole(roleService, admin);
    const user = await withRbac.create(admin, { email: "fc@djamo.com", displayName: "FC", roleId: role.id }, "REQ-fc1");
    const userRepo = (withRbac as unknown as { users: ConstructorParameters<typeof UserService>[0] }).users;
    const bare = new UserService(userRepo, inMemoryAuditRepository());
    await expect(bare.suspend(admin, user.id, "REQ-fc2", "Motif de test")).rejects.toThrow("requires a RoleService");
  });

  it("refuses to let an actor suspend their own account", async () => {
    const { userService } = makeServices();
    await expect(userService.suspend(admin, admin.userId, "REQ-6", "Motif de test")).rejects.toThrow(ForbiddenError);
    await expect(userService.suspend(admin, admin.userId.toUpperCase(), "REQ-6b", "Motif de test")).rejects.toThrow(ForbiddenError);
  });

  it("suspends a user (soft-delete) and blocks a duplicate suspend", async () => {
    const { userService, roleService } = makeServices();
    const role = await seedRole(roleService, admin);
    const user = await userService.create(
      admin,
      { email: "toSuspend@djamo.com", displayName: "To Suspend", roleId: role.id },
      "REQ-7",
    );

    await userService.suspend(admin, user.id, "REQ-8", "Motif de test");
    await expect(userService.get(admin, user.id)).resolves.toMatchObject({ deletedAt: expect.any(Date) });
    await expect(userService.suspend(admin, user.id, "REQ-9", "Motif de test")).rejects.toThrow(ValidationError);
  });

  it("q177: suspend and reactivate require a reason, audited with the action; without one nothing changes", async () => {
    const events: Array<{ action: string; reason: string | null }> = [];
    const audit: AuditRepository = { ...inMemoryAuditRepository(), record: async (e) => void events.push(e as never) };
    const roleService = new RoleService(inMemoryRoleRepository(), audit);
    const userService = new UserService(inMemoryUserRepository(), audit, roleService);
    const role = await seedRole(roleService, admin);
    const user = await userService.create(admin, { email: "why@djamo.com", displayName: "Why", roleId: role.id }, "REQ-Q177a");
    events.length = 0;

    for (const reason of ["", "   ", undefined as unknown as string]) {
      await expect(userService.suspend(admin, user.id, "REQ-Q177b", reason)).rejects.toThrow(ValidationError);
    }
    await expect(userService.get(admin, user.id)).resolves.toMatchObject({ deletedAt: null });
    expect(events).toHaveLength(0);

    await userService.suspend(admin, user.id, "REQ-Q177c", "  Départ de l'entreprise  ");
    expect(events.at(-1)).toMatchObject({ action: "DELETE", reason: "Départ de l'entreprise" });

    await expect(userService.reactivate(admin, user.id, "REQ-Q177d", "")).rejects.toThrow(ValidationError);
    await expect(userService.get(admin, user.id)).resolves.toMatchObject({ deletedAt: expect.any(Date) });
    await userService.reactivate(admin, user.id, "REQ-Q177e", "Retour de congé");
    expect(events.at(-1)).toMatchObject({ action: "UPDATE", reason: "Retour de congé" });
  });

  it("reactivates a suspended user (maker-checker counterpart to suspend)", async () => {
    const { userService, roleService } = makeServices();
    const role = await seedRole(roleService, admin);
    const user = await userService.create(
      admin,
      { email: "toReactivate@djamo.com", displayName: "To Reactivate", roleId: role.id },
      "REQ-10",
    );
    await userService.suspend(admin, user.id, "REQ-11", "Motif de test");

    const reactivated = await userService.reactivate(admin, user.id, "REQ-12", "Motif de test");
    expect(reactivated.deletedAt).toBeNull();
  });

  it("refuses to reactivate a user who isn't suspended", async () => {
    const { userService, roleService } = makeServices();
    const role = await seedRole(roleService, admin);
    const user = await userService.create(
      admin,
      { email: "active@djamo.com", displayName: "Active", roleId: role.id },
      "REQ-13",
    );
    await expect(userService.reactivate(admin, user.id, "REQ-14", "Motif de test")).rejects.toThrow(ValidationError);
  });

  it("GET /users/me only ever returns the caller's own row", async () => {
    const { userService, roleService } = makeServices();
    const role = await seedRole(roleService, admin);
    const created = await userService.create(
      admin,
      { email: "self@djamo.com", displayName: "Self", roleId: role.id },
      "REQ-15",
    );

    const selfActor: AuthenticatedUser = { ...admin, userId: created.id };
    const self = await userService.getSelf(selfActor);
    expect(self.id).toBe(created.id);

    // No id parameter exists on getSelf at all — it can only ever resolve
    // to actor.userId, so a caller impersonating someone else via the
    // actor object gets their own row, never another user's.
    const impostor: AuthenticatedUser = { ...admin, userId: "does-not-exist" };
    await expect(userService.getSelf(impostor)).rejects.toThrow(NotFoundError);
  });

  it("getSelfPermissions returns only the actor's known permissions, sorted and deduplicated", async () => {
    const { userService, roleService } = makeServices();
    const role = await seedRole(roleService, admin);
    const created = await userService.create(
      admin,
      { email: "perms@djamo.com", displayName: "Perms", roleId: role.id },
      "REQ-F4",
    );
    const selfActor: AuthenticatedUser = {
      ...admin,
      userId: created.id,
      roles: ["user.read", "not.a.permission", "audit.read", "user.read"],
    };
    expect(await userService.getSelfPermissions(selfActor)).toEqual(["audit.read", "user.read"]);
    await expect(
      userService.getSelfPermissions({ ...admin, userId: "does-not-exist" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("directory: id and name of active accounts only, for a designation right, never without one", async () => {
    const { userService, roleService } = makeServices();
    const role = await seedRole(roleService, admin);
    const kept = await userService.create(admin, { email: "kept@djamo.com", displayName: "Kept", roleId: role.id }, "REQ-F4a");
    const gone = await userService.create(admin, { email: "gone@djamo.com", displayName: "Gone", roleId: role.id }, "REQ-F4b");
    await userService.suspend(admin, gone.id, "REQ-F4c", "Motif de test");

    const assigner: AuthenticatedUser = { ...admin, userId: "assigner", roles: ["process.responsibility.assign"] };
    const entries = await userService.directory(assigner);
    expect(entries).toContainEqual({ id: kept.id, displayName: "Kept" });
    expect(entries.some((e) => e.id === gone.id)).toBe(false);
    expect(Object.keys(entries[0]!).sort()).toEqual(["displayName", "id"]);

    await expect(userService.directory({ ...admin, roles: ["risk.read"] })).rejects.toThrow(ForbiddenError);
    // q183: whoever may create an audit mission may compose its team.
    await expect(userService.directory({ ...admin, userId: "auditor", roles: ["audit.mission.create"] })).resolves.toContainEqual({ id: kept.id, displayName: "Kept" });
  });

  it("scopes list() and get() to the actor's tenant", async () => {
    // Deliberately shares one UserService/RoleService/repository pair
    // across both tenants so the assertions actually exercise the
    // repository's tenant filter, not just two disjoint in-memory stores.
    const { userService, roleService } = makeServices();
    const role = await seedRole(roleService, admin);
    const userInTenant1 = await userService.create(
      admin,
      { email: "t1@djamo.com", displayName: "Tenant 1 User", roleId: role.id },
      "REQ-16",
    );

    const otherRole = await seedRole(roleService, otherTenantAdmin);
    await userService.create(
      otherTenantAdmin,
      { email: "t2@djamo.com", displayName: "Tenant 2 User", roleId: otherRole.id },
      "REQ-17",
    );

    const { users } = await userService.list(admin);
    expect(users.map((u) => u.id)).toEqual([userInTenant1.id]);

    await expect(userService.get(admin, userInTenant1.id)).resolves.toMatchObject({ id: userInTenant1.id });
    await expect(userService.get(otherTenantAdmin, userInTenant1.id)).rejects.toThrow(NotFoundError);
  });

  it("gates the terminal suspend action behind its own permission, distinct from update", async () => {
    const { userService, roleService } = makeServices();
    const role = await seedRole(roleService, admin);
    const user = await userService.create(
      admin,
      { email: "gated@djamo.com", displayName: "Gated", roleId: role.id },
      "REQ-18",
    );

    const updateOnlyActor: AuthenticatedUser = { ...admin, userId: "updater", roles: ["user.update"] };
    await expect(userService.suspend(updateOnlyActor, user.id, "REQ-19", "Motif de test")).rejects.toThrow(ForbiddenError);

    const deleteOnlyActor: AuthenticatedUser = { ...admin, userId: "deleter", roles: ["user.delete"] };
    await expect(
      userService.update(deleteOnlyActor, user.id, { displayName: "Hacked" }, "REQ-20"),
    ).rejects.toThrow(ForbiddenError);

    // The actual, correctly-permissioned actions still work.
    await userService.suspend(admin, user.id, "REQ-21", "Motif de test");
    const reactivateOnlyActor: AuthenticatedUser = { ...admin, userId: "reactivator", roles: ["user.reactivate"] };
    await expect(userService.reactivate(reactivateOnlyActor, user.id, "REQ-22", "Motif de test")).resolves.toMatchObject({
      deletedAt: null,
    });
  });

  it("attaches a user to a department that exists in the actor's tenant", async () => {
    const departmentRepo = inMemoryDepartmentRepository();
    const department = await departmentRepo.create({ tenantId: "tenant-1", name: "Finance", manager: "Manager" });
    const { userService, roleService } = makeServices(departmentRepo);
    const role = await seedRole(roleService, admin);

    const user = await userService.create(
      admin,
      { email: "dept@djamo.com", displayName: "Dept User", roleId: role.id, departmentId: department.id },
      "REQ-23",
    );

    expect(user.departmentId).toBe(department.id);
  });

  it("rejects creating a user with a department from another tenant", async () => {
    const departmentRepo = inMemoryDepartmentRepository();
    const otherTenantDepartment = await departmentRepo.create({
      tenantId: "tenant-2",
      name: "Ops",
      manager: "Manager",
    });
    const { userService, roleService } = makeServices(departmentRepo);
    const role = await seedRole(roleService, admin);

    await expect(
      userService.create(
        admin,
        { email: "crosstenant@djamo.com", displayName: "X", roleId: role.id, departmentId: otherTenantDepartment.id },
        "REQ-24",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects creating a user with a department that does not exist", async () => {
    const departmentRepo = inMemoryDepartmentRepository();
    const { userService, roleService } = makeServices(departmentRepo);
    const role = await seedRole(roleService, admin);

    await expect(
      userService.create(
        admin,
        { email: "ghost@djamo.com", displayName: "Ghost", roleId: role.id, departmentId: "does-not-exist" },
        "REQ-25",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("throws (does not silently skip) when a departmentId is supplied but no DepartmentRepository is configured", async () => {
    const { userService, roleService } = makeServices();
    const role = await seedRole(roleService, admin);

    await expect(
      userService.create(
        admin,
        { email: "unwired@djamo.com", displayName: "Unwired", roleId: role.id, departmentId: "dept-1" },
        "REQ-26",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("updates a user's department, and rejects an update to a department outside the tenant", async () => {
    const departmentRepo = inMemoryDepartmentRepository();
    const department = await departmentRepo.create({ tenantId: "tenant-1", name: "Finance", manager: "Manager" });
    const otherTenantDepartment = await departmentRepo.create({
      tenantId: "tenant-2",
      name: "Ops",
      manager: "Manager",
    });
    const { userService, roleService } = makeServices(departmentRepo);
    const role = await seedRole(roleService, admin);
    const user = await userService.create(
      admin,
      { email: "toUpdate@djamo.com", displayName: "To Update", roleId: role.id },
      "REQ-27",
    );

    const updated = await userService.update(admin, user.id, { departmentId: department.id }, "REQ-28");
    expect(updated.departmentId).toBe(department.id);

    await expect(
      userService.update(admin, user.id, { departmentId: otherTenantDepartment.id }, "REQ-29"),
    ).rejects.toThrow(ValidationError);
  });
});
