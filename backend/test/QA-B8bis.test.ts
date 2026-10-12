import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { RoleService } from "../src/services/RoleService.js";
import { UserService } from "../src/services/UserService.js";
import { ProcessService } from "../src/services/ProcessService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { rolesRouter } from "../src/api/v1/roles.routes.js";
import { usersRouter } from "../src/api/v1/users.routes.js";
import { processesRouter } from "../src/api/v1/processes.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ALL_PERMISSIONS, type Permission } from "../src/domain/permissions.js";
import { NOTIFICATION_RESOURCE_TYPES } from "../src/domain/entities/Notification.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Role, RoleAssignment, RolePermissionChange, SystemGroup } from "../src/domain/entities/Role.js";
import type { Process } from "../src/domain/entities/Process.js";
import type { ActionPlan } from "../src/domain/entities/ActionPlan.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA level 2 for B-8 bis (DECISION-040 q42-q46, q48). A QA PASS only: not a Security, Compliance or Privacy opinion.

const T1 = "tenant-1";
const T2 = "tenant-2";

type Ev = { tenantId: string; userId: string; entityType: string; entityId: string; action: string; reason: string | null; oldValue: unknown; newValue: unknown };
type FakeUser = { id: string; tenantId: string; email: string; displayName: string; roles: string[]; departmentId: string | null; createdAt: Date; deletedAt: Date | null };

function actor(userId: string, perms: Permission[], tenantId = T1): AuthenticatedUser {
  return { userId, tenantId, email: `${userId}@x.io`, displayName: userId, roles: perms } as AuthenticatedUser;
}
const ADMIN_PERMS: Permission[] = ["role.read", "role.assign", "role.update", "role.create", "role.delete", "rolegroup.audit.update", "user.create", "user.read", "user.delete", "user.reactivate"];
const admin = actor("admin", ADMIN_PERMS);
const VALIDATE: Permission[] = ["rolegroup.audit.validate"];

function world(opts: { notifier?: "ok" | "fail" | "none"; changeRepo?: boolean; failRoleUpdateFor?: string } = {}) {
  const roles = new Map<string, Role>();
  const assignments: RoleAssignment[] = [];
  const users = new Map<string, FakeUser>();
  const events: Ev[] = [];
  const changes = new Map<string, RolePermissionChange>();
  const sent: Array<Record<string, unknown>> = [];
  const userCreates: string[] = [];

  const seedRole = (r: Partial<Role> & { tenantId: string; name: string }): Role => {
    const role: Role = {
      id: randomUUID(), description: null, permissions: ["risk.read"], dashboardScopeMode: "GLOBAL", systemGroup: null,
      departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...r,
    };
    roles.set(role.id, role);
    return role;
  };
  const activeA = (t: string, roleId: string) => assignments.filter((a) => a.tenantId === t && a.roleId === roleId && !a.revokedAt);

  const roleRepo = {
    async getById(t: string, id: string) { const r = roles.get(id); return r && r.tenantId === t && !r.deletedAt ? r : null; },
    async getByName(t: string, n: string) { return [...roles.values()].find((r) => r.tenantId === t && r.name === n && !r.deletedAt) ?? null; },
    async list(t: string, o?: { includeDisabled?: boolean }) { return [...roles.values()].filter((r) => r.tenantId === t && (o?.includeDisabled || !r.deletedAt)); },
    async create(i: Partial<Role> & { tenantId: string; name: string }) { return seedRole(i); },
    async update(t: string, id: string, input: Partial<Role>) {
      if (opts.failRoleUpdateFor === id) throw new Error("db down");
      const e = roles.get(id);
      if (!e || e.tenantId !== t) throw new Error("not found");
      const u = { ...e, ...input } as Role;
      roles.set(id, u);
      return u;
    },
    async disable(t: string, id: string) { const e = roles.get(id)!; roles.set(id, { ...e, deletedAt: new Date() }); },
    async countActiveAssignments(t: string, id: string) {
      return activeA(t, id).filter((a) => !users.get(a.userId)?.deletedAt).length;
    },
    async assignToUser(t: string, roleId: string, userId: string, grantedBy: string) {
      const a: RoleAssignment = { id: randomUUID(), tenantId: t, roleId, userId, grantedBy, grantedAt: new Date(), revokedAt: null };
      assignments.push(a);
      return a;
    },
    async revokeFromUser(t: string, roleId: string, userId: string, o?: { minRemaining?: number }) {
      const mine = activeA(t, roleId).find((a) => a.userId === userId);
      if (!mine) throw new NotFoundError("RoleAssignment", `${roleId}:${userId}`);
      const others = activeA(t, roleId).filter((a) => a.userId !== userId && !users.get(a.userId)?.deletedAt).length;
      if (others < (o?.minRemaining ?? 0)) throw new ValidationError("Cannot remove the last member of this group");
      mine.revokedAt = new Date();
    },
    async listForUser(t: string, userId: string) {
      const ids = assignments.filter((a) => a.tenantId === t && a.userId === userId && !a.revokedAt).map((a) => a.roleId);
      return [...roles.values()].filter((r) => ids.includes(r.id) && !r.deletedAt);
    },
    async listDisabledForUser(t: string, userId: string) {
      const ids = assignments.filter((a) => a.tenantId === t && a.userId === userId && !a.revokedAt).map((a) => a.roleId);
      return [...roles.values()].filter((r) => ids.includes(r.id) && r.deletedAt);
    },
    async listAssignments(t: string, id: string) { return assignments.filter((a) => a.tenantId === t && a.roleId === id); },
  };

  const userRepo = {
    async getById(t: string, id: string) { const u = users.get(id); return u && u.tenantId === t ? u : null; },
    async create(i: { tenantId: string; email: string; displayName: string; departmentId: string | null }) {
      userCreates.push(i.email);
      const u: FakeUser = { id: randomUUID(), roles: [], createdAt: new Date(), deletedAt: null, ...i };
      users.set(u.id, u);
      return u;
    },
    async suspend(t: string, id: string) { users.get(id)!.deletedAt = new Date(); },
    async reactivate(t: string, id: string) { users.get(id)!.deletedAt = null; },
    // mirrors PostgresUserRepository.listWithPermission
    async listWithPermission(t: string, perm: string, exclude: string) {
      return [...users.values()]
        .filter((u) => u.tenantId === t && !u.deletedAt && u.id !== exclude)
        .filter((u) => u.roles.includes(perm) || assignments.some((a) => a.tenantId === t && a.userId === u.id && !a.revokedAt && roles.get(a.roleId) && !roles.get(a.roleId)!.deletedAt && roles.get(a.roleId)!.permissions.includes(perm as Permission)))
        .map((u) => ({ id: u.id, displayName: u.displayName }));
    },
  };

  const changeRepo = {
    async create(i: { tenantId: string; roleId: string; permissions: Permission[]; requestedBy: string }) {
      const c: RolePermissionChange = { id: randomUUID(), ...i, status: "PENDING", decidedBy: null, createdAt: new Date(), decidedAt: null };
      changes.set(c.id, c);
      return c;
    },
    async getById(t: string, id: string) { const c = changes.get(id); return c && c.tenantId === t ? c : null; },
    async decide(t: string, id: string, status: "APPROVED" | "REJECTED", by: string) {
      const c = changes.get(id);
      if (!c || c.tenantId !== t || c.status !== "PENDING") return false;
      c.status = status; c.decidedBy = by; c.decidedAt = new Date();
      return true;
    },
    async reopen(t: string, id: string) {
      const c = changes.get(id);
      if (c && c.tenantId === t && c.status !== "PENDING") { c.status = "PENDING"; c.decidedBy = null; c.decidedAt = null; }
    },
    async list(t: string, f: { status?: string; roleId?: string }) {
      return [...changes.values()].filter((c) => c.tenantId === t && (!f.status || c.status === f.status) && (!f.roleId || c.roleId === f.roleId));
    },
  };

  const audit = {
    async record(e: Ev) { events.push(e); },
    async listForEntity() { return []; },
    async listRecent() { return []; },
  };
  const departments = { async getById(t: string, id: string) { return ({ "dept-1": T1, "dept-x": T2 } as Record<string, string>)[id] === t ? { id } : null; } };
  const notifier = {
    async record(i: Record<string, unknown>) {
      if (opts.notifier === "fail") throw new Error("notif down");
      sent.push(i);
    },
  };

  const groups = {
    RISK_MANAGER: seedRole({ tenantId: T1, name: "Risk Manager", systemGroup: "RISK_MANAGER", permissions: ["risk.read"] }),
    RISK_COMMITTEE: seedRole({ tenantId: T1, name: "Risk Committee", systemGroup: "RISK_COMMITTEE", permissions: ["risk.read"] }),
    AUDIT: seedRole({ tenantId: T1, name: "Audit", systemGroup: "AUDIT", permissions: ["audit.read"] }),
  } satisfies Record<SystemGroup, Role>;
  const filler = seedRole({ tenantId: T1, name: "Filler", permissions: ["dashboard.read"] });

  const roleService = new RoleService(roleRepo as never, audit as never, userRepo as never, departments as never, opts.changeRepo === false ? undefined : (changeRepo as never));
  const userService = new UserService(userRepo as never, audit as never, roleService, departments as never, opts.notifier === "none" ? undefined : (notifier as never));

  const addUser = (id: string, over: Partial<FakeUser> = {}) => {
    const u: FakeUser = { id, tenantId: T1, email: `${id}@x.io`, displayName: `Name ${id}`, roles: [], departmentId: null, createdAt: new Date(), deletedAt: null, ...over };
    users.set(id, u);
    return u;
  };
  /** Puts the user in the role through the real service (setup actor is neither the member nor under test). */
  const setupActor = actor("setup-admin", ["role.assign", "role.read"]);
  const put = async (role: Role, userId: string) => {
    if (!users.has(userId)) addUser(userId);
    await roleService.assignToUser(setupActor, role.id, userId, "R-setup", "setup");
  };
  const member = async (role: Role, userId: string) => { await put(role, userId); events.length = 0; };

  return { roles, assignments, users, events, changes, sent, userCreates, groups, filler, seedRole, roleService, userService, roleRepo, userRepo, addUser, put, member };
}

// ---- HTTP helper -----------------------------------------------------------------------------

async function http(mount: (app: express.Express) => void, user: AuthenticatedUser, method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: AuthenticatedUser; requestId: string }).user = user;
    (req as unknown as { requestId: string }).requestId = "req-http";
    next();
  });
  mount(app);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as { data?: any; error?: string } | null };
  } finally {
    server.close();
  }
}

// ---------------------------------------------------------------------------------------------
describe("QA-B8bis cumul rule (q43)", () => {
  it("refuses Audit for a Risk Manager and Risk Manager for an Audit member, with no state change and no audit row", async () => {
    const w = world();
    await w.member(w.groups.RISK_MANAGER, "u1");
    await w.member(w.groups.AUDIT, "u2");
    const before = w.assignments.length;
    await expect(w.roleService.assignToUser(admin, w.groups.AUDIT.id, "u1", "R1", "motif")).rejects.toThrow(ValidationError);
    await expect(w.roleService.assignToUser(admin, w.groups.RISK_MANAGER.id, "u2", "R2", "motif")).rejects.toThrow(ValidationError);
    expect(w.assignments.length).toBe(before);
    expect(w.events).toHaveLength(0);
  });

  it("is lifted once the conflicting membership is revoked", async () => {
    const w = world();
    await w.member(w.groups.RISK_MANAGER, "rm-other"); // keeps the group non-empty
    await w.member(w.groups.RISK_MANAGER, "u1");
    await w.put(w.filler, "u1");
    await w.roleService.revokeFromUser(admin, w.groups.RISK_MANAGER.id, "u1", "R3", "départ");
    await w.roleService.assignToUser(admin, w.groups.AUDIT.id, "u1", "R4", "arrivée");
    expect((await w.roleService.fixedGroupsOf(T1, "u1"))).toEqual(["AUDIT"]);
  });

  it("refuses Risk Manager + Committee in both orders (q94), still allows Committee + Audit", async () => {
    const w = world();
    await w.put(w.groups.RISK_MANAGER, "a");
    await expect(w.put(w.groups.RISK_COMMITTEE, "a")).rejects.toThrow(/Committee/);
    await w.put(w.groups.RISK_COMMITTEE, "b");
    await expect(w.put(w.groups.RISK_MANAGER, "b")).rejects.toThrow(/Committee/);
    await w.put(w.groups.RISK_COMMITTEE, "c"); await w.put(w.groups.AUDIT, "c");
    expect(await w.roleService.fixedGroupsOf(T1, "a")).toHaveLength(1);
    expect(await w.roleService.fixedGroupsOf(T1, "b")).toHaveLength(1);
    expect(await w.roleService.fixedGroupsOf(T1, "c")).toHaveLength(2);
  });

  it("fixedGroups / riskManagerAndCommittee on the user sheet: flag only for RM + Committee", async () => {
    const w = world();
    const reader = actor("reader", ["user.read"]);
    await w.put(w.groups.RISK_MANAGER, "rm");
    // q94: the cumul can no longer be created through the service; a pre-existing one is simulated in the held map
    await w.put(w.groups.RISK_MANAGER, "rmco");
    await w.roleRepo.assignToUser(T1, w.groups.RISK_COMMITTEE.id, "rmco", "setup-admin");
    await w.put(w.groups.RISK_COMMITTEE, "coau"); await w.put(w.groups.AUDIT, "coau");
    await w.put(w.filler, "plain");
    const d = (id: string) => w.userService.getDetail(reader, id);
    expect(await d("rm")).toMatchObject({ fixedGroups: ["RISK_MANAGER"], riskManagerAndCommittee: false });
    expect(await d("rmco")).toMatchObject({ riskManagerAndCommittee: true });
    expect((await d("rmco")).fixedGroups.sort()).toEqual(["RISK_COMMITTEE", "RISK_MANAGER"]);
    expect(await d("coau")).toMatchObject({ riskManagerAndCommittee: false });
    expect(await d("plain")).toMatchObject({ fixedGroups: [], riskManagerAndCommittee: false });
    await expect(w.userService.getDetail(actor("x", []), "rm")).rejects.toThrow(ForbiddenError);
    await expect(w.userService.getDetail(actor("r2", ["user.read"], T2), "rm")).rejects.toThrow(NotFoundError);
  });

  it("an actor cannot assign themselves a group even with a reason", async () => {
    const w = world();
    await expect(w.roleService.assignToUser(admin, w.groups.AUDIT.id, "admin", "R5", "moi")).rejects.toThrow(ForbiddenError);
  });

  it("POST /users with a fixed group as initial role: needs the reason; once created the user is subject to the cumul rule", async () => {
    const w = world();
    const u = await w.userService.create(admin, { email: "N@X.io", displayName: "N", roleId: w.groups.RISK_MANAGER.id, reason: "nomination" }, "R6");
    expect(await w.roleService.fixedGroupsOf(T1, u.id)).toEqual(["RISK_MANAGER"]);
    await expect(w.roleService.assignToUser(admin, w.groups.AUDIT.id, u.id, "R7", "motif")).rejects.toThrow(/both/);
  });

  it("POST /users with an ordinary initial role needs no reason", async () => {
    const w = world();
    const u = await w.userService.create(admin, { email: "o@x.io", displayName: "O", roleId: w.filler.id }, "R8");
    expect(await w.roleService.fixedGroupsOf(T1, u.id)).toEqual([]);
  });

  it("POST /users with a fixed group and no reason is refused (HTTP 400)", async () => {
    const w = world();
    const res = await http((a) => a.use("/users", usersRouter(w.userService)), admin, "POST", "/users", { email: "z@x.io", displayName: "Z", roleId: w.groups.AUDIT.id });
    expect(res.status).toBe(400);
  });

  // DEFECT-B8bis-01. The reason is checked by assignToUser AFTER users.create(): a refused creation leaves a login-capable, role-less user
  // (same shape as SEC-010). Expected: no user row when the initial role is refused for a validation reason.
  it("FIXED B-8 ter: a refused POST /users (fixed group without reason) leaves no orphan user row", async () => {
    const w = world();
    await expect(w.userService.create(admin, { email: "orphan@x.io", displayName: "O", roleId: w.groups.AUDIT.id }, "R9")).rejects.toThrow(ValidationError);
    expect(w.userCreates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA-B8bis reason (q44)", () => {
  const fixed = (w: ReturnType<typeof world>) => w.groups.RISK_COMMITTEE;

  it.each([[undefined], [""], ["   "], ["\n\t "]])("fixed group, reason %j -> refused, nothing written", async (reason) => {
    const w = world();
    await expect(w.roleService.assignToUser(admin, fixed(w).id, "u1", "R1", reason as string | undefined)).rejects.toThrow(/reason is required/);
    expect(w.assignments).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });

  it("500 characters accepted (stored trimmed), 501 refused; padding spaces do not count", async () => {
    const w = world();
    await w.roleService.assignToUser(admin, fixed(w).id, "u1", "R2", "x".repeat(500));
    expect(w.events.at(-1)?.reason).toBe("x".repeat(500));
    await w.roleService.assignToUser(admin, fixed(w).id, "u2", "R3", `  ${"y".repeat(500)}  `);
    expect(w.events.at(-1)?.reason).toBe("y".repeat(500));
    const n = w.assignments.length;
    await expect(w.roleService.assignToUser(admin, fixed(w).id, "u3", "R4", "z".repeat(501))).rejects.toThrow(/at most 500/);
    expect(w.assignments.length).toBe(n);
  });

  it("ordinary role: no reason needed (reason null), whitespace-only reason becomes null, 501 chars still refused", async () => {
    const w = world();
    await w.roleService.assignToUser(admin, w.filler.id, "u1", "R5");
    expect(w.events.at(-1)?.reason).toBeNull();
    await w.roleService.assignToUser(admin, w.filler.id, "u2", "R6", "   ");
    expect(w.events.at(-1)?.reason).toBeNull();
    await w.roleService.assignToUser(admin, w.filler.id, "u3", "R7", "pourquoi");
    expect(w.events.at(-1)?.reason).toBe("pourquoi");
    await expect(w.roleService.assignToUser(admin, w.filler.id, "u4", "R8", "q".repeat(501))).rejects.toThrow(ValidationError);
  });

  it("revoking a fixed-group member needs the reason too, and stores it", async () => {
    const w = world();
    await w.member(w.groups.RISK_COMMITTEE, "u1");
    await w.put(w.filler, "u1");
    await expect(w.roleService.revokeFromUser(admin, w.groups.RISK_COMMITTEE.id, "u1", "R9")).rejects.toThrow(/reason is required/);
    await expect(w.roleService.revokeFromUser(admin, w.groups.RISK_COMMITTEE.id, "u1", "R9", "s".repeat(501))).rejects.toThrow(ValidationError);
    expect(await w.roleService.fixedGroupsOf(T1, "u1")).toEqual(["RISK_COMMITTEE"]);
    await w.roleService.revokeFromUser(admin, w.groups.RISK_COMMITTEE.id, "u1", "R9", "fin de mandat");
    expect(w.events.at(-1)).toMatchObject({ action: "ROLE_CHANGE", reason: "fin de mandat" });
  });

  it("HTTP: whitespace-only, 501 and non-string reasons are 400; 500 is accepted; reason is required on a fixed group", async () => {
    const w = world();
    const mount = (a: express.Express) => a.use("/roles", rolesRouter(w.roleService));
    const path = `/roles/${w.groups.RISK_COMMITTEE.id}/assign`;
    expect((await http(mount, admin, "POST", path, { userId: "u1", reason: "   " })).status).toBe(400);
    expect((await http(mount, admin, "POST", path, { userId: "u1", reason: "x".repeat(501) })).status).toBe(400);
    expect((await http(mount, admin, "POST", path, { userId: "u1", reason: 42 })).status).toBe(400);
    expect((await http(mount, admin, "POST", path, { userId: "u1", reason: null })).status).toBe(400);
    expect((await http(mount, admin, "POST", path, { userId: "u1" })).status).toBe(400); // service: reason required
    expect((await http(mount, admin, "POST", path, { userId: "u1", reason: "x".repeat(500) })).status).toBe(201);
    expect((await http(mount, admin, "POST", `/roles/${w.filler.id}/assign`, { userId: "u2" })).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA-B8bis Audit-group permission changes (q45)", () => {
  const rmAdmin = actor("rm-admin", ADMIN_PERMS);

  it("APPLIED for a plain administrator: permissions replaced, audited with old and new value", async () => {
    const w = world();
    const res = await w.roleService.changeAuditGroupPermissions(admin, ["audit.read", "risk.read"], "R1", "motif de test");
    expect(res.status).toBe("APPLIED");
    expect(w.roles.get(w.groups.AUDIT.id)?.permissions).toEqual(["audit.read", "risk.read"]);
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ action: "PERMISSION_CHANGE", entityType: "Role", entityId: w.groups.AUDIT.id, userId: "admin", tenantId: T1 });
    expect((w.events[0]!.oldValue as Role).permissions).toEqual(["audit.read"]);
  });

  it("PENDING for an administrator who is a Risk Manager: group untouched, change stored, audited; no direct application", async () => {
    const w = world();
    await w.member(w.groups.RISK_MANAGER, "rm-admin");
    const res = await w.roleService.changeAuditGroupPermissions(rmAdmin, ["audit.read", "risk.read"], "R2", "motif de test");
    expect(res.status).toBe("PENDING");
    expect(w.roles.get(w.groups.AUDIT.id)?.permissions).toEqual(["audit.read"]);
    expect([...w.changes.values()]).toHaveLength(1);
    expect([...w.changes.values()][0]).toMatchObject({ status: "PENDING", requestedBy: "rm-admin", roleId: w.groups.AUDIT.id });
    expect(w.events.map((e) => e.entityType)).toEqual(["RolePermissionChange"]);
  });

  it("PENDING path fails closed without the change repository (nothing applied)", async () => {
    const w = world({ changeRepo: false });
    await w.member(w.groups.RISK_MANAGER, "rm-admin");
    await expect(w.roleService.changeAuditGroupPermissions(rmAdmin, ["audit.read"], "R3", "motif de test")).rejects.toThrow(/RolePermissionChangeRepository/);
    expect(w.roles.get(w.groups.AUDIT.id)?.permissions).toEqual(["audit.read"]);
    expect(w.events).toHaveLength(0);
  });

  it("refuses: missing permission, unknown permission, empty list, an Audit member changing their own group, tenant without Audit group", async () => {
    const w = world();
    await expect(w.roleService.changeAuditGroupPermissions(actor("x", ["role.update"]), ["audit.read"], "R4", "motif de test")).rejects.toThrow(ForbiddenError);
    await expect(w.roleService.changeAuditGroupPermissions(admin, ["nope.nope" as Permission], "R4", "motif de test")).rejects.toThrow(ValidationError);
    await expect(w.roleService.changeAuditGroupPermissions(admin, [], "R4", "motif de test")).rejects.toThrow(ValidationError);
    await w.member(w.groups.AUDIT, "aud-admin");
    await expect(w.roleService.changeAuditGroupPermissions(actor("aud-admin", ADMIN_PERMS), ["audit.read", "risk.read"], "R4", "motif de test")).rejects.toThrow(/belong/);
    await expect(w.roleService.changeAuditGroupPermissions(actor("t2-admin", ADMIN_PERMS, T2), ["audit.read"], "R4", "motif de test")).rejects.toThrow(NotFoundError);
    expect(w.roles.get(w.groups.AUDIT.id)?.permissions).toEqual(["audit.read"]);
    expect(w.events).toHaveLength(0);
  });

  it("an Audit member who is also a Risk Manager cannot exist (cumul), so the 'own group' refusal is not bypassed through the PENDING path", async () => {
    const w = world();
    await w.member(w.groups.AUDIT, "aud-admin");
    await expect(w.roleService.assignToUser(admin, w.groups.RISK_MANAGER.id, "aud-admin", "R5", "motif")).rejects.toThrow(/both/);
  });

  it("PATCH /roles/:id with permissions on the Audit group is refused (service and HTTP), other fields and other groups unaffected", async () => {
    const w = world();
    await expect(w.roleService.update(admin, w.groups.AUDIT.id, { permissions: ["audit.read", "risk.read"] }, "R6")).rejects.toThrow(/dedicated endpoint/);
    const mount = (a: express.Express) => a.use("/roles", rolesRouter(w.roleService));
    expect((await http(mount, admin, "PATCH", `/roles/${w.groups.AUDIT.id}`, { permissions: ["risk.read"] })).status).toBe(400);
    expect(w.roles.get(w.groups.AUDIT.id)?.permissions).toEqual(["audit.read"]);
    expect((await http(mount, admin, "PATCH", `/roles/${w.groups.AUDIT.id}`, { description: "ok" })).status).toBe(200);
    expect((await http(mount, admin, "PATCH", `/roles/${w.groups.RISK_COMMITTEE.id}`, { permissions: ["risk.read", "kri.read"] })).status).toBe(200);
  });

  describe("approval", () => {
    async function pending() {
      const w = world();
      await w.member(w.groups.RISK_MANAGER, "rm-admin");
      await w.member(w.groups.AUDIT, "aud");
      await w.member(w.groups.RISK_COMMITTEE, "com");
      await w.put(w.filler, "plain"); w.events.length = 0;
      const res = await w.roleService.changeAuditGroupPermissions(rmAdmin, ["audit.read", "kri.read"], "R-req", "motif de test");
      if (res.status !== "PENDING") throw new Error("setup");
      w.events.length = 0;
      return { w, id: res.changeId };
    }
    const decide = (w: ReturnType<typeof world>, who: string, perms: Permission[], id: string, approve: boolean) =>
      w.roleService.decideAuditPermissionChange(actor(who, perms), id, approve, "R-dec");

    it("the author cannot approve or reject, even holding the validate permission and an Audit/Committee seat", async () => {
      const { w, id } = await pending();
      await expect(decide(w, "rm-admin", VALIDATE, id, true)).rejects.toThrow(ForbiddenError);
      await expect(decide(w, "rm-admin", VALIDATE, id, false)).rejects.toThrow(ForbiddenError);
      expect(w.changes.get(id)?.status).toBe("PENDING");
      expect(w.roles.get(w.groups.AUDIT.id)?.permissions).toEqual(["audit.read"]);
      expect(w.events).toHaveLength(0);
    });

    it("refused for a non-member of Audit/Committee, for a Risk Manager colleague, and for an Audit member without the validate permission", async () => {
      const { w, id } = await pending();
      await w.member(w.groups.RISK_MANAGER, "rm-2");
      await expect(decide(w, "plain", VALIDATE, id, true)).rejects.toThrow(/Only a member/);
      await expect(decide(w, "rm-2", VALIDATE, id, true)).rejects.toThrow(ForbiddenError);
      await expect(decide(w, "stranger", VALIDATE, id, false)).rejects.toThrow(ForbiddenError);
      await expect(decide(w, "aud", [], id, true)).rejects.toThrow(/Missing permission/);
      expect(w.changes.get(id)?.status).toBe("PENDING");
      expect(w.roles.get(w.groups.AUDIT.id)?.permissions).toEqual(["audit.read"]);
    });

    it("an Audit member and a Committee member can each approve; permissions applied once, two audit rows", async () => {
      for (const who of ["aud", "com"]) {
        const { w, id } = await pending();
        await decide(w, who, VALIDATE, id, true);
        expect(w.changes.get(id)).toMatchObject({ status: "APPROVED", decidedBy: who });
        expect(w.roles.get(w.groups.AUDIT.id)?.permissions).toEqual(["audit.read", "kri.read"]);
        expect(w.events.map((e) => `${e.entityType}:${e.action}`)).toEqual(["Role:PERMISSION_CHANGE", "RolePermissionChange:APPROVE"]);
        expect(w.events[0]!.userId).toBe(who);
      }
    });

    it("reject leaves the group untouched and writes a single REJECT row", async () => {
      const { w, id } = await pending();
      await decide(w, "com", VALIDATE, id, false);
      expect(w.changes.get(id)?.status).toBe("REJECTED");
      expect(w.roles.get(w.groups.AUDIT.id)?.permissions).toEqual(["audit.read"]);
      expect(w.events.map((e) => `${e.entityType}:${e.action}`)).toEqual(["RolePermissionChange:REJECT"]);
    });

    it("double approve, approve-after-reject, reject-after-approve are refused and write nothing more", async () => {
      const a = await pending();
      await decide(a.w, "aud", VALIDATE, a.id, true);
      const n = a.w.events.length;
      await expect(decide(a.w, "com", VALIDATE, a.id, true)).rejects.toThrow(/already been decided/);
      await expect(decide(a.w, "com", VALIDATE, a.id, false)).rejects.toThrow(/already been decided/);
      expect(a.w.events).toHaveLength(n);
      expect(a.w.changes.get(a.id)?.status).toBe("APPROVED");
      const b = await pending();
      await decide(b.w, "aud", VALIDATE, b.id, false);
      await expect(decide(b.w, "com", VALIDATE, b.id, true)).rejects.toThrow(/already been decided/);
      expect(b.w.roles.get(b.w.groups.AUDIT.id)?.permissions).toEqual(["audit.read"]);
    });

    it("concurrent double approval: the atomic claim lets exactly one through", async () => {
      const { w, id } = await pending();
      const r = await Promise.allSettled([decide(w, "aud", VALIDATE, id, true), decide(w, "com", VALIDATE, id, true)]);
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(w.events.filter((e) => e.action === "APPROVE")).toHaveLength(1);
    });

    it("unknown change id and a change of another tenant are 404; route rejects non-uuid ids", async () => {
      const { w, id } = await pending();
      await expect(decide(w, "aud", VALIDATE, randomUUID(), true)).rejects.toThrow(NotFoundError);
      await expect(w.roleService.decideAuditPermissionChange(actor("aud-t2", VALIDATE, T2), id, true, "R")).rejects.toThrow(NotFoundError);
      const mount = (a: express.Express) => a.use("/roles", rolesRouter(w.roleService));
      expect((await http(mount, actor("aud", VALIDATE), "POST", "/roles/permission-changes/not-a-uuid/approve")).status).toBe(400);
      expect((await http(mount, actor("aud", VALIDATE), "POST", `/roles/permission-changes/${id}/approve`)).status).toBe(200);
      expect((await http(mount, actor("aud", VALIDATE), "POST", `/roles/permission-changes/${id}/reject`)).status).toBe(400);
    });

    it("HTTP: PUT /roles/audit-group/permissions is 200 (applied) or 202 (pending); bad bodies are 400; no permission is 403", async () => {
      const w = world();
      const mount = (a: express.Express) => a.use("/roles", rolesRouter(w.roleService));
      const url = "/roles/audit-group/permissions";
      const reason = "motif de test"; // B-8 ter (F-B8b-02): the reason is mandatory
      expect((await http(mount, admin, "PUT", url, { permissions: [], reason })).status).toBe(400);
      expect((await http(mount, admin, "PUT", url, {})).status).toBe(400);
      expect((await http(mount, admin, "PUT", url, { permissions: ["bogus"], reason })).status).toBe(400);
      expect((await http(mount, admin, "PUT", url, { permissions: Array(ALL_PERMISSIONS.length + 1).fill("risk.read"), reason })).status).toBe(400);
      expect((await http(mount, actor("x", ["role.update"]), "PUT", url, { permissions: ["audit.read"], reason })).status).toBe(403);
      const ok = await http(mount, admin, "PUT", url, { permissions: ["audit.read", "risk.read"], reason });
      expect(ok.status).toBe(200);
      expect(ok.json?.data?.status).toBe("APPLIED");
      await w.member(w.groups.RISK_MANAGER, "rm-admin");
      const pend = await http(mount, rmAdmin, "PUT", url, { permissions: ["audit.read"], reason });
      expect(pend.status).toBe(202);
      expect(pend.json?.data?.status).toBe("PENDING");
    });

    // DEFECT-B8bis-03 (MINOR, already flagged by A06 as "claim + application hors transaction"): when the application of an approved
    // change fails, the change stays APPROVED (and can never be retried) while the group keeps its old permissions.
    it("FIXED B-8 ter: a failed application of an approved change does not leave it APPROVED-but-not-applied", async () => {
      const w = world();
      await w.member(w.groups.RISK_MANAGER, "rm-admin");
      await w.member(w.groups.AUDIT, "aud");
      const res = await w.roleService.changeAuditGroupPermissions(rmAdmin, ["audit.read", "kri.read"], "R", "motif de test");
      if (res.status !== "PENDING") throw new Error("setup");
      const real = w.roleRepo.update;
      w.roleRepo.update = async () => { throw new Error("db down"); };
      await expect(w.roleService.decideAuditPermissionChange(actor("aud", VALIDATE), res.changeId, true, "R")).rejects.toThrow("db down");
      w.roleRepo.update = real;
      expect(w.changes.get(res.changeId)?.status).toBe("PENDING"); // currently "APPROVED"
    });

    it("F-B8b-04 (was an OBSERVATION): a second change is refused while one is PENDING; after a decision a new one is possible", async () => {
      const w = world();
      await w.member(w.groups.RISK_MANAGER, "rm-admin");
      await w.member(w.groups.AUDIT, "aud");
      const c1 = await w.roleService.changeAuditGroupPermissions(rmAdmin, ["audit.read", "kri.read"], "R", "motif de test");
      await expect(w.roleService.changeAuditGroupPermissions(rmAdmin, ["audit.read", "risk.read"], "R", "motif de test")).rejects.toThrow(/already pending/);
      if (c1.status !== "PENDING") throw new Error("setup");
      await w.roleService.decideAuditPermissionChange(actor("aud", VALIDATE), c1.changeId, true, "R");
      expect(w.roles.get(w.groups.AUDIT.id)?.permissions).toEqual(["audit.read", "kri.read"]);
      const c2 = await w.roleService.changeAuditGroupPermissions(rmAdmin, ["audit.read", "risk.read"], "R", "motif de test");
      expect(c2.status).toBe("PENDING");
    });

    it("F-B8b-01 (was an OBSERVATION): the 'read-only' Audit group cannot be given write or admin permissions (q42)", async () => {
      const w = world();
      await expect(
        w.roleService.changeAuditGroupPermissions(admin, ["audit.read", "risk.delete", "role.assign", "rolegroup.audit.update"], "R", "motif de test"),
      ).rejects.toThrow(ValidationError);
      expect(w.roles.get(w.groups.AUDIT.id)?.permissions).toEqual(["audit.read"]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA-B8bis /roles/grantors (q48)", () => {
  function gw() {
    const w = world();
    const holder = w.seedRole({ tenantId: T1, name: "Admins", permissions: ["role.assign", "role.read"] });
    return { w, holder };
  }
  const asker = actor("asker", []);

  it("returns display names only (no id, no email), excludes the requester, excludes suspended users", async () => {
    const { w, holder } = gw();
    await w.put(holder, "g1"); await w.put(holder, "g2"); await w.put(holder, "asker"); await w.put(holder, "g-susp");
    w.users.get("g-susp")!.deletedAt = new Date();
    const res = await w.roleService.listGrantors(asker, "risk.read", "R1");
    expect(res.grantors.map((g) => g.displayName).sort()).toEqual(["Name g1", "Name g2"]);
    for (const g of res.grantors) expect(Object.keys(g)).toEqual(["displayName"]);
    expect(JSON.stringify(res)).not.toMatch(/@x\.io|asker|g-susp/);
  });

  it("never returns users of another tenant", async () => {
    const { w, holder } = gw();
    await w.put(holder, "g1");
    const other = w.seedRole({ tenantId: T2, name: "Admins2", permissions: ["role.assign", "risk.read"] });
    w.addUser("t2-user", { tenantId: T2, displayName: "Autre Tenant" });
    w.assignments.push({ id: "z", tenantId: T2, roleId: other.id, userId: "t2-user", grantedBy: "x", grantedAt: new Date(), revokedAt: null });
    const res = await w.roleService.listGrantors(asker, "risk.read", "R2");
    expect(res.grantors).toEqual([{ displayName: "Name g1" }]);
    const t2 = await w.roleService.listGrantors(actor("t2-asker", [], T2), "risk.read", "R2b");
    expect(t2.grantors).toEqual([{ displayName: "Autre Tenant" }]);
  });

  it("legacy users.roles holders of role.assign count as grantors", async () => {
    const { w } = gw();
    w.addUser("legacy", { roles: ["role.assign"], displayName: "Legacy Admin" });
    const res = await w.roleService.listGrantors(asker, "risk.read", "R3");
    expect(res.grantors).toEqual([{ displayName: "Legacy Admin" }]);
  });

  it("empty list when no active role carries the permission (disabled role included), and the lookup is still audited", async () => {
    const { w, holder } = gw();
    await w.put(holder, "g1");
    w.roles.set(w.filler.id, { ...w.filler, permissions: ["kri.delete"], deletedAt: new Date() });
    const res = await w.roleService.listGrantors(asker, "kri.delete", "R4");
    expect(res.grantors).toEqual([]);
    expect(w.events.at(-1)).toMatchObject({ action: "READ", entityType: "PermissionGrantorsLookup" });
  });

  // F-B8b-03: one audit row per (user, permission, hour), so a loop cannot inflate the append-only table.
  it("one audit row per (user, permission, hour), with tenant, actor, permission and count; a repeat writes nothing, another permission writes a row", async () => {
    const { w, holder } = gw();
    await w.put(holder, "g1"); w.events.length = 0;
    await w.roleService.listGrantors(asker, "risk.read", "R5");
    await w.roleService.listGrantors(asker, "risk.read", "R6");
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ tenantId: T1, userId: "asker", entityId: "asker", action: "READ", newValue: { permission: "risk.read", returned: 1 } });
    expect(w.events[0]!.entityType).toBe("PermissionGrantorsLookup");
    await w.roleService.listGrantors(asker, "dashboard.read", "R6b");
    expect(w.events).toHaveLength(2);
  });

  it("unknown permission: ValidationError, no audit row (service) / 400 (HTTP); missing and array query are 400", async () => {
    const { w, holder } = gw();
    await w.put(holder, "g1"); w.events.length = 0;
    await expect(w.roleService.listGrantors(asker, "nope.nope" as Permission, "R7")).rejects.toThrow(ValidationError);
    expect(w.events).toHaveLength(0);
    const mount = (a: express.Express) => a.use("/roles", rolesRouter(w.roleService));
    expect((await http(mount, asker, "GET", "/roles/grantors?permission=nope.nope")).status).toBe(400);
    expect((await http(mount, asker, "GET", "/roles/grantors")).status).toBe(400);
    expect((await http(mount, asker, "GET", "/roles/grantors?permission=risk.read&permission=kri.read")).status).toBe(400);
    expect(w.events).toHaveLength(0);
  });

  it("HTTP: any authenticated user (no permission) gets 200 with the documented shape; route not shadowed by /:id", async () => {
    const { w, holder } = gw();
    await w.put(holder, "g1");
    const mount = (a: express.Express) => a.use("/roles", rolesRouter(w.roleService));
    const res = await http(mount, asker, "GET", "/roles/grantors?permission=risk.read");
    expect(res.status).toBe(200);
    expect(res.json?.data).toEqual({ permission: "risk.read", grantors: [{ displayName: "Name g1" }] });
  });

  it("fails closed when the user repository cannot list by permission", async () => {
    const w = world();
    const svc = new RoleService(w.roleRepo as never, { async record() {} } as never, {} as never);
    await expect(svc.listGrantors(asker, "risk.read", "R8")).rejects.toThrow(/UserRepository/);
  });

  it("OBSERVATION: the answer is 'holders of role.assign', whatever permission was asked; a permission carried only by a legacy users.roles grant yields an empty list", async () => {
    const { w, holder } = gw();
    await w.put(holder, "g1");
    w.addUser("legacy-only", { roles: ["kri.delete"] });
    const res = await w.roleService.listGrantors(asker, "kri.delete", "R9");
    expect(res.grantors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA-B8bis reactivation and lost rights (F-B8-06)", () => {
  async function suspendedWithLostRole(opts: Parameters<typeof world>[0] = {}) {
    const w = world(opts);
    const old = w.seedRole({ tenantId: T1, name: "Ancien rôle", permissions: ["kri.read"] });
    await w.put(old, "u1"); await w.put(w.filler, "u1");
    w.users.get("u1")!.deletedAt = new Date(); // suspended
    w.roles.set(old.id, { ...old, deletedAt: new Date() }); // role disabled meanwhile (only suspended holders)
    w.events.length = 0;
    return { w, old };
  }

  it("returns lostRoles, audits the names, notifies the user once (MANAGEMENT / RIGHTS_LOST_ON_REACTIVATION)", async () => {
    const { w, old } = await suspendedWithLostRole();
    const res = await w.userService.reactivate(admin, "u1", "R1");
    expect(res.deletedAt).toBeNull();
    expect(res.lostRoles).toEqual([{ id: old.id, name: "Ancien rôle", permissions: ["kri.read"] }]);
    expect(w.events).toHaveLength(1);
    expect((w.events[0]!.newValue as { lostRoles: string[] }).lostRoles).toEqual(["Ancien rôle"]);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toMatchObject({ tenantId: T1, recipientUserId: "u1", resourceType: "MANAGEMENT", eventType: "RIGHTS_LOST_ON_REACTIVATION", triggeredBy: "admin" });
    expect(String(w.sent[0]!["message"])).toContain("Ancien rôle");
  });

  it("no lost role: lostRoles is empty, no notification, audit newValue has no lostRoles key", async () => {
    const w = world();
    await w.put(w.filler, "u1");
    w.users.get("u1")!.deletedAt = new Date(); w.events.length = 0;
    const res = await w.userService.reactivate(admin, "u1", "R2");
    expect(res.lostRoles).toEqual([]);
    expect(w.sent).toHaveLength(0);
    expect(w.events[0]!.newValue).not.toHaveProperty("lostRoles");
  });

  it("works without a NotificationService", async () => {
    const { w } = await suspendedWithLostRole({ notifier: "none" });
    const res = await w.userService.reactivate(admin, "u1", "R3");
    expect(res.lostRoles).toHaveLength(1);
  });

  it("refusals: not suspended, unknown, other tenant, no permission; no notification, no audit", async () => {
    const { w } = await suspendedWithLostRole();
    w.addUser("active");
    await expect(w.userService.reactivate(admin, "active", "R4")).rejects.toThrow(ValidationError);
    await expect(w.userService.reactivate(admin, "ghost", "R4")).rejects.toThrow(NotFoundError);
    await expect(w.userService.reactivate(actor("t2", ADMIN_PERMS, T2), "u1", "R4")).rejects.toThrow(NotFoundError);
    await expect(w.userService.reactivate(actor("n", ["user.read"]), "u1", "R4")).rejects.toThrow(ForbiddenError);
    expect(w.sent).toHaveLength(0);
    expect(w.events).toHaveLength(0);
    expect(w.users.get("u1")!.deletedAt).not.toBeNull();
  });

  it("a very long list of lost roles keeps the notification message within the 1500 characters sent", async () => {
    const w = world();
    w.addUser("u1"); w.users.get("u1")!.deletedAt = new Date();
    for (let i = 0; i < 60; i++) {
      const r = w.seedRole({ tenantId: T1, name: `Role-${"n".repeat(40)}-${i}`, permissions: ["kri.read"] });
      w.assignments.push({ id: `a${i}`, tenantId: T1, roleId: r.id, userId: "u1", grantedBy: "x", grantedAt: new Date(), revokedAt: null });
      w.roles.set(r.id, { ...r, deletedAt: new Date() });
    }
    const res = await w.userService.reactivate(admin, "u1", "R5");
    expect(res.lostRoles).toHaveLength(60);
    expect(String(w.sent[0]!["message"]).length).toBeLessThanOrEqual(1500);
  });

  // DEFECT-B8bis-04 (MINOR): the notification is sent after the reactivation is committed and audited; a notification failure turns the
  // whole call into a 500 although the user IS reactivated (a retry then answers "User is not suspended" and the lost rights are never shown).
  it("FIXED B-8 ter: a notification failure does not fail an already committed reactivation", async () => {
    const { w } = await suspendedWithLostRole({ notifier: "fail" });
    const res = await w.userService.reactivate(admin, "u1", "R6");
    expect(res.lostRoles).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA-B8bis process department mandatory on creation (q46)", () => {
  function pw() {
    const store = new Map<string, Process>();
    const events: Ev[] = [];
    const repo = {
      async getById(t: string, id: string) { const p = store.get(id); return p && p.tenantId === t && !p.deletedAt ? p : null; },
      async list(t: string) { return [...store.values()].filter((p) => p.tenantId === t); },
      async create(i: Partial<Process> & { tenantId: string }) {
        const p = { id: randomUUID(), parentId: null, description: null, documentType: null, documentReference: null, owner: null, active: true, evaluationMode: null, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null, ...i } as Process;
        store.set(p.id, p);
        return p;
      },
      async update(t: string, id: string, i: Partial<Process>) { const u = { ...store.get(id)!, ...i } as Process; store.set(id, u); return u; },
      async softDelete() {},
    };
    const departments = { async getById(t: string, id: string) { return ({ "11111111-1111-4111-8111-111111111111": T1, "22222222-2222-4222-8222-222222222222": T2 } as Record<string, string>)[id] === t ? { id } : null; } };
    const service = new ProcessService(repo as never, { async record(e: Ev) { events.push(e); } } as never, undefined, undefined, undefined, departments as never);
    return { store, events, service, repo };
  }
  const D1 = "11111111-1111-4111-8111-111111111111";
  const DX = "22222222-2222-4222-8222-222222222222";
  const pa = actor("p", ["process.create", "process.update", "process.read"]);
  const base = { level: "PROCESS" as const, name: "P" };

  it.each([[undefined], [null], [""]])("service: departmentId %j on creation -> ValidationError, no row, no audit", async (d) => {
    const { service, store, events } = pw();
    await expect(service.create(pa, { ...base, departmentId: d as never }, "R1")).rejects.toThrow(/departmentId is required/);
    expect(store.size).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("service: department of another tenant / unknown refused; valid accepted and audited", async () => {
    const { service, store, events } = pw();
    await expect(service.create(pa, { ...base, departmentId: DX }, "R2")).rejects.toThrow(/does not exist/);
    await expect(service.create(pa, { ...base, departmentId: "33333333-3333-4333-8333-333333333333" }, "R2")).rejects.toThrow(ValidationError);
    expect(store.size).toBe(0);
    await service.create(pa, { ...base, departmentId: D1 }, "R3");
    expect(store.size).toBe(1);
    expect(events).toHaveLength(1);
  });

  it("HTTP POST /processes: missing, null, empty and non-uuid departmentId are 400; a valid one is 201", async () => {
    const { service } = pw();
    const mount = (a: express.Express) => a.use("/processes", processesRouter(service));
    for (const body of [{ ...base }, { ...base, departmentId: null }, { ...base, departmentId: "" }, { ...base, departmentId: "dept-1" }, { ...base, departmentId: 5 }]) {
      expect((await http(mount, pa, "POST", "/processes", body)).status).toBe(400);
    }
    expect((await http(mount, pa, "POST", "/processes", { ...base, departmentId: D1 })).status).toBe(201);
    expect((await http(mount, pa, "POST", "/processes", { ...base, departmentId: DX })).status).toBe(400);
  });

  it("update is unchanged: a legacy process without department can be renamed without giving one", async () => {
    const { service, repo } = pw();
    const legacy = await repo.create({ tenantId: T1, level: "PROCESS", name: "Legacy" } as never);
    const res = await service.update(pa, legacy.id, { name: "Legacy 2" }, "R4");
    expect(res.name).toBe("Legacy 2");
    expect(res.departmentId).toBeNull();
    const mount = (a: express.Express) => a.use("/processes", processesRouter(service));
    expect((await http(mount, pa, "PATCH", `/processes/${legacy.id}`, { name: "Legacy 3" })).status).toBe(200);
  });

  it("B-8 ter (was an OBSERVATION): update refuses departmentId null, a process created with a department cannot be detached", async () => {
    const { service, store } = pw();
    const p = await service.create(pa, { ...base, departmentId: D1 }, "R5");
    const mount = (a: express.Express) => a.use("/processes", processesRouter(service));
    expect((await http(mount, pa, "PATCH", `/processes/${p.id}`, { departmentId: null })).status).toBe(400);
    expect(store.get(p.id)?.departmentId).toBe(D1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA-B8bis ActionPlanService self-validation (point signalé par A06)", () => {
  const plan = (createdBy: string, responsibleUserId: string): ActionPlan => ({
    id: "ap1", tenantId: T1, title: "t", description: null, sourceType: "MANAGEMENT", sourceId: null, responsibleUserId, departmentId: null,
    dueDate: new Date(Date.now() + 86_400_000), status: "EN_COURS", progressPercent: 50, progressComment: null, evidenceId: null,
    createdBy, closedBy: null, closedAt: null, closureComment: null, createdAt: new Date(), updatedAt: new Date(),
  } as ActionPlan);
  function aw(p: ActionPlan) {
    const closes: string[] = [];
    const repo = {
      async getById(t: string, id: string) { return t === p.tenantId && id === p.id ? p : null; },
      async close(_t: string, _id: string, by: string) { closes.push(by); return { ...p, status: "TERMINEE", closedBy: by }; },
    };
    return { closes, service: new ActionPlanService(repo as never, { async record() {} } as never) };
  }
  const closer = (id: string) => actor(id, ["actionplan.validate"]);

  it("the A06 claim is INFIRMED for the creator: the creator cannot close their own action (403), and nothing is closed", async () => {
    const { service, closes } = aw(plan("rm1", "someone"));
    await expect(service.close(closer("rm1"), "ap1", "ev-1", "ok", "R1")).rejects.toThrow(ForbiddenError);
    expect(closes).toEqual([]);
  });

  it("another holder of actionplan.validate (e.g. a second Risk Manager) can close; without the permission nobody can", async () => {
    const { service, closes } = aw(plan("rm1", "someone"));
    await expect(service.close(actor("rm2", ["actionplan.update"]), "ap1", "ev-1", "ok", "R2")).rejects.toThrow(ForbiddenError);
    await service.close(closer("rm2"), "ap1", "ev-1", "ok", "R2");
    expect(closes).toEqual(["rm2"]);
  });

  // F-B8b-06 (Security review B-8 bis, confirmed by QA): the control only compares with createdBy, so the RESPONSIBLE user (executor of the
  // action) who did not create it can close it with their own evidence. Expected by the maker-checker principle: executor != closer.
  it("FIXED B-8 ter F-B8b-06: the responsible user cannot close their own action", async () => {
    const { service, closes } = aw(plan("rm1", "exec"));
    await expect(service.close(closer("exec"), "ap1", "ev-1", "ok", "R3")).rejects.toThrow(ForbiddenError);
    expect(closes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA-B8bis migration 051 (static review, never applied)", () => {
  const dir = "../database/postgresql/migrations/";
  const up = readFileSync(`${dir}051_group_permissions.sql`, "utf8");
  const down = readFileSync(`${dir}051_group_permissions.down.sql`, "utf8");
  const stmt = (group: string) => {
    const m = up.match(new RegExp(`UPDATE roles SET permissions = ARRAY\\[([^\\]]*)\\]\\s*WHERE system_group = '${group}'([^;]*);`));
    if (!m) throw new Error(`no statement for ${group}`);
    return { perms: [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!), where: m[2]! };
  };
  const rm = stmt("RISK_MANAGER"), co = stmt("RISK_COMMITTEE"), au = stmt("AUDIT");

  it("every permission string seeded for the 3 groups is a real Permission (a typo would be stored silently)", () => {
    for (const g of [rm, co, au]) {
      expect(g.perms.filter((p) => !ALL_PERMISSIONS.includes(p as Permission))).toEqual([]);
      expect(new Set(g.perms).size).toBe(g.perms.length);
    }
  });

  it("each rights UPDATE only touches an active, still-empty group (idempotent, keeps adopted rights)", () => {
    for (const g of [rm, co, au]) expect(g.where).toMatch(/deleted_at IS NULL AND permissions = '\{\}'/);
  });

  it("group content matches DECISION-040 q42/q45", () => {
    const writeish = /\.(create|update|delete|assign|revoke|escalate|upload|set)$/;
    expect(au.perms.filter((p) => writeish.test(p))).toEqual([]);
    expect(co.perms.filter((p) => writeish.test(p))).toEqual([]);
    expect(au.perms).toContain("audit.read");
    expect(au.perms).toContain("rolegroup.audit.validate");
    expect(co.perms).toContain("rolegroup.audit.validate");
    expect(co.perms).toEqual(expect.arrayContaining(["riskevaluation.validate.committee", "treatmentdecision.validate.committee"]));
    expect(rm.perms).not.toContain("rolegroup.audit.update");
    expect(rm.perms).not.toContain("rolegroup.audit.validate");
    expect(rm.perms.filter((p) => /^(role|user|tenant|audit|rolegroup)\./.test(p))).toEqual([]);
    expect(rm.perms.filter((p) => p.endsWith(".committee"))).toEqual([]);
  });

  it("Risk Manager 'validate' rights are all backed by a self-validation guard in their service", () => {
    const guards: Record<string, [string, RegExp]> = {
      "actionplan.validate": ["ActionPlanService", /createdBy === actor\.userId/],
      "execution.validate": ["ControlExecutionService", /executedBy === actor\.userId/],
      "effectiveness.validate": ["ControlEffectivenessService", /evaluatorId === actor\.userId|evaluator/],
      "riskevaluation.validate": ["RiskEvaluationService", /evaluatorId === actor\.userId/],
      "treatmentdecision.validate": ["TreatmentDecisionService", /proposer|proposedBy|decidedBy === actor\.userId|=== actor\.userId/],
    };
    for (const p of rm.perms.filter((x) => x.endsWith(".validate"))) {
      const g = guards[p];
      expect(g, `no guard mapping for ${p}`).toBeDefined();
      expect(readFileSync(`src/services/${g![0]}.ts`, "utf8")).toMatch(g![1]);
    }
  });

  it("Auditeur carry-over: skips holders already in AUDIT or RISK_MANAGER, then revokes, then soft-disables the old role (never DELETE FROM)", () => {
    const insert = up.slice(up.indexOf("INSERT INTO user_roles"), up.indexOf("UPDATE user_roles"));
    expect(insert).toMatch(/system_group IN \('AUDIT', 'RISK_MANAGER'\)/);
    expect(insert).toMatch(/revoked_at IS NULL/);
    expect(up.indexOf("INSERT INTO user_roles")).toBeLessThan(up.indexOf("UPDATE user_roles SET revoked_at"));
    expect(up.indexOf("UPDATE user_roles SET revoked_at")).toBeLessThan(up.indexOf("UPDATE roles SET deleted_at"));
    expect(up).not.toMatch(/DELETE FROM/i);
    expect(up).toMatch(/name = 'Auditeur' AND system_group IS NULL AND deleted_at IS NULL/);
  });

  it("Notification and audit CHECK lists in the migration match the application lists (MANAGEMENT, READ), and the down restores the previous ones", () => {
    const list = (sql: string, name: string) => {
      const m = sql.match(new RegExp(`ADD CONSTRAINT ${name}\\s+CHECK \\([^(]*\\(([^)]*)\\)`));
      return m ? [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!) : [];
    };
    expect(list(up, "notifications_resource_type_check").sort()).toEqual([...NOTIFICATION_RESOURCE_TYPES].sort());
    expect(list(up, "notification_subscriptions_resource_type_check").sort()).toEqual([...NOTIFICATION_RESOURCE_TYPES].sort());
    expect(list(up, "audit_log_action_check")).toContain("READ");
    expect(list(down, "audit_log_action_check")).not.toContain("READ");
    expect(list(down, "notifications_resource_type_check")).not.toContain("MANAGEMENT");
    expect(down).toMatch(/DROP TABLE role_permission_changes/);
    expect(down).toMatch(/DELETE FROM schema_migrations WHERE filename = '051_group_permissions\.sql'/);
  });

  it("role_permission_changes carries tenant_id, a status CHECK and an index", () => {
    expect(up).toMatch(/CREATE TABLE role_permission_changes[\s\S]*tenant_id\s+uuid NOT NULL/);
    expect(up).toMatch(/status\s+text NOT NULL DEFAULT 'PENDING' CHECK \(status IN \('PENDING', 'APPROVED', 'REJECTED'\)\)/);
    expect(up).toMatch(/CREATE INDEX role_permission_changes_tenant_idx/);
  });

  // DEFECT-B8bis-02 (MAJOR): migration 051 seeds the rights of the 3 groups of EXISTING tenants only. Tenants created afterwards
  // (PostgresTenantRepository.create, same rows as 049) still get the groups with '{}' permissions: their Risk Manager has no rights
  // and their Audit group cannot read the audit trail (it replaced the "Auditeur" role).
  it("FIXED B-8 ter: a tenant created after migration 051 gets its 3 groups with the q42 rights, not with empty permissions", () => {
    const src = readFileSync("src/infrastructure/database/postgres/PostgresTenantRepository.ts", "utf8");
    const insert = src.slice(src.indexOf("INSERT INTO roles"), src.indexOf("AS g (name"));
    expect(insert).not.toMatch(/'\{\}'/);
  });
});
