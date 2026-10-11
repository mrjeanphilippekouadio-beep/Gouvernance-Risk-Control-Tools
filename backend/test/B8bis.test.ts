import { describe, expect, it } from "vitest";
import { RoleService } from "../src/services/RoleService.js";
import { UserService } from "../src/services/UserService.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Role, RolePermissionChange, SystemGroup } from "../src/domain/entities/Role.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { Permission } from "../src/domain/permissions.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

function role(id: string, systemGroup: SystemGroup | null, permissions: Permission[] = ["risk.read"]): Role {
  return {
    id, tenantId: "t1", name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
    systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
}

function setup() {
  const roles = [role("rm", "RISK_MANAGER"), role("co", "RISK_COMMITTEE"), role("au", "AUDIT"), role("plain", null, ["role.assign"])];
  const held = new Map<string, string[]>(); // userId -> roleIds
  const changes: RolePermissionChange[] = [];
  const events: AuditEvent[] = [];
  const roleRepo = {
    async getById(_t: string, id: string) { return roles.find((r) => r.id === id) ?? null; },
    async list() { return roles; },
    async listForUser(_t: string, u: string) { return roles.filter((r) => (held.get(u) ?? []).includes(r.id)); },
    async assignToUser(_t: string, roleId: string, userId: string) {
      held.set(userId, [...(held.get(userId) ?? []), roleId]);
      return { id: "a", tenantId: "t1", roleId, userId, grantedBy: "x", grantedAt: new Date(), revokedAt: null };
    },
    async update(_t: string, id: string, input: { permissions?: Permission[] }) {
      const r = roles.find((x) => x.id === id)!;
      if (input.permissions) r.permissions = input.permissions;
      return r;
    },
    async listDisabledForUser() { return [role("old", null, ["risk.read"])]; },
  };
  const changeRepo = {
    async create(i: { roleId: string; permissions: Permission[]; requestedBy: string }) {
      const c: RolePermissionChange = { id: "c1", tenantId: "t1", ...i, status: "PENDING", decidedBy: null, createdAt: new Date(), decidedAt: null };
      changes.push(c);
      return c;
    },
    async getById() { return changes[0] ?? null; },
    async decide(_t: string, _id: string, status: "APPROVED" | "REJECTED", by: string) {
      const c = changes[0]!;
      if (c.status !== "PENDING") return false;
      c.status = status; c.decidedBy = by;
      return true;
    },
  };
  const audit = { async record(e: Omit<AuditEvent, "id" | "timestamp">) { events.push(e as AuditEvent); } };
  const users = {
    async getById(_t: string, id: string) {
      return { id, tenantId: "t1", email: "e", displayName: "N", roles: [], departmentId: null, createdAt: new Date(), deletedAt: id === "susp" ? new Date() : null };
    },
    async reactivate() {},
    async listWithPermission() { return [{ id: "adm", displayName: "Awa Admin" }]; },
  };
  const service = new RoleService(roleRepo as never, audit as never, users as never, undefined, changeRepo as never);
  return { service, held, changes, events, roles, users, audit };
}

const actor = (userId: string, perms: Permission[]): AuthenticatedUser => ({ userId, tenantId: "t1", email: "a@x", roles: perms }) as AuthenticatedUser;
const admin = actor("admin", ["role.assign", "role.read", "role.update", "rolegroup.audit.update", "user.reactivate", "user.read"]);

describe("B-8 bis fixed groups", () => {
  it("requires a reason for a fixed group and records it in the audit", async () => {
    const { service, events } = setup();
    await expect(service.assignToUser(admin, "co", "u1", "r1")).rejects.toThrow(ValidationError);
    await expect(service.assignToUser(admin, "co", "u1", "r1", "x".repeat(501))).rejects.toThrow(ValidationError);
    await service.assignToUser(admin, "co", "u1", "r1", "  nomination  ");
    expect(events.at(-1)?.reason).toBe("nomination");
    await service.assignToUser(admin, "plain", "u1", "r2"); // ordinary role: no reason needed
  });

  it("refuses Risk Manager + Audit in both directions, allows Risk Manager + Committee", async () => {
    const { service } = setup();
    await service.assignToUser(admin, "rm", "u1", "r1", "motif");
    await expect(service.assignToUser(admin, "au", "u1", "r2", "motif")).rejects.toThrow(/both/);
    await service.assignToUser(admin, "au", "u2", "r3", "motif");
    await expect(service.assignToUser(admin, "rm", "u2", "r4", "motif")).rejects.toThrow(/both/);
    await service.assignToUser(admin, "co", "u1", "r5", "motif");
  });

  it("exposes the Risk Manager + Committee cumul on the user sheet", async () => {
    const { service, users, audit } = setup();
    await service.assignToUser(admin, "rm", "u1", "r1", "motif");
    await service.assignToUser(admin, "co", "u1", "r2", "motif");
    const userService = new UserService(users as never, audit as never, service);
    const detail = await userService.getDetail(admin, "u1");
    expect(detail.fixedGroups).toEqual(["RISK_MANAGER", "RISK_COMMITTEE"]);
    expect(detail.riskManagerAndCommittee).toBe(true);
  });
});

describe("B-8 bis Audit group permissions (q45)", () => {
  it("is refused without the dedicated permission and through the generic update", async () => {
    const { service } = setup();
    await expect(service.changeAuditGroupPermissions(actor("x", ["role.update"]), ["audit.read"], "r")).rejects.toThrow(ForbiddenError);
    await expect(service.update(admin, "au", { permissions: ["audit.read"] }, "r")).rejects.toThrow(ValidationError);
  });

  it("applies directly for a plain administrator", async () => {
    const { service, events } = setup();
    const res = await service.changeAuditGroupPermissions(admin, ["audit.read"], "r");
    expect(res.status).toBe("APPLIED");
    expect(events.at(-1)?.action).toBe("PERMISSION_CHANGE");
  });

  it("stays pending when the administrator is a Risk Manager; the author never validates, an Audit member does", async () => {
    const { service, held, changes } = setup();
    held.set("admin", ["rm"]);
    held.set("aud", ["au"]);
    const res = await service.changeAuditGroupPermissions(admin, ["audit.read"], "r");
    expect(res.status).toBe("PENDING");

    const validate: Permission[] = ["rolegroup.audit.validate"];
    held.set("admin", ["rm", "au"]); // even if the author were in Audit
    await expect(service.decideAuditPermissionChange(actor("admin", validate), "c1", true, "r")).rejects.toThrow(ForbiddenError);
    await expect(service.decideAuditPermissionChange(actor("stranger", validate), "c1", true, "r")).rejects.toThrow(ForbiddenError);
    await service.decideAuditPermissionChange(actor("aud", validate), "c1", true, "r");
    expect(changes[0]?.status).toBe("APPROVED");
    await expect(service.decideAuditPermissionChange(actor("aud", validate), "c1", true, "r")).rejects.toThrow(ValidationError);
  });
});

describe("B-8 bis grantors and lost rights (q48)", () => {
  it("returns display names only and audits the lookup", async () => {
    const { service, events } = setup();
    const res = await service.listGrantors(actor("u9", []), "role.assign", "r");
    expect(res.grantors).toEqual([{ displayName: "Awa Admin" }]);
    expect(events.at(-1)?.action).toBe("READ");
    const none = await service.listGrantors(actor("u9", []), "kri.delete", "r"); // no active role carries it
    expect(none.grantors).toEqual([]);
  });

  it("reactivation returns the lost roles and notifies the user", async () => {
    const { service, users, audit } = setup();
    const sent: Array<{ recipientUserId: string; resourceType: string }> = [];
    const notifications = { async record(i: { recipientUserId: string; resourceType: string }) { sent.push(i); } };
    const suspended = { ...users, getById: (() => { let n = 0; return async (_t: string, id: string) => ({ id, tenantId: "t1", email: "e", displayName: "N", roles: [], departmentId: null, createdAt: new Date(), deletedAt: n++ === 0 ? new Date() : null }); })() };
    const userService = new UserService(suspended as never, audit as never, service, undefined, notifications as never);
    const res = await userService.reactivate(admin, "susp", "r");
    expect(res.lostRoles).toEqual([{ id: "old", name: "old", permissions: ["risk.read"] }]);
    expect(sent).toEqual([expect.objectContaining({ recipientUserId: "susp", resourceType: "MANAGEMENT" })]);
  });
});
