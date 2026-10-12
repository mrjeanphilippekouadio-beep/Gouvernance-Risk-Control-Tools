import { describe, expect, it } from "vitest";
import { RoleService } from "../src/services/RoleService.js";
import { UserService } from "../src/services/UserService.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type { Permission } from "../src/domain/permissions.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// DECISION-044: q94 (Risk Manager + Committee forbidden), q80 (administrator + Committee marked), q79 (config.manage = administrator).

const role = (id: string, systemGroup: SystemGroup | null, permissions: Permission[]): Role => ({
  id, tenantId: "t1", name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
  systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
});

function world() {
  const roles = [
    role("rm", "RISK_MANAGER", ["risk.read"]),
    role("co", "RISK_COMMITTEE", ["risk.read", "rolegroup.audit.validate"]),
    role("coadm", "RISK_COMMITTEE", ["risk.read", "role.assign"]),
    role("client", null, ["config.manage"]),
    role("method", null, ["config.update"]),
    role("plain", null, ["risk.read"]),
  ];
  const held = new Map<string, string[]>();
  const sent: Array<{ recipientUserId: string; eventType: string; message: string }> = [];
  const repo = {
    async getById(_t: string, id: string) { return roles.find((r) => r.id === id) ?? null; },
    async listForUser(_t: string, u: string) { return roles.filter((r) => (held.get(u) ?? []).includes(r.id)); },
    async assignToUser(_t: string, roleId: string, userId: string) {
      held.set(userId, [...(held.get(userId) ?? []), roleId]);
      return { id: "a", tenantId: "t1", roleId, userId, grantedBy: "x", grantedAt: new Date(), revokedAt: null };
    },
    async listAssignments() { return []; },
  };
  const users = {
    async listWithPermission(_t: string, perm: string, exclude: string) {
      return [...held.entries()]
        .filter(([u, ids]) => u !== exclude && roles.some((r) => ids.includes(r.id) && r.permissions.includes(perm as Permission)))
        .map(([u]) => ({ id: u, displayName: u }));
    },
    async getById(_t: string, id: string) {
      return { id, tenantId: "t1", email: "e", displayName: id, roles: [], departmentId: null, createdAt: new Date(), deletedAt: new Date() };
    },
    async reactivate() {},
  };
  const notifications = { async record(i: { recipientUserId: string; eventType: string; message: string }) { sent.push(i); } };
  const audit = { async record() {} };
  const service = new RoleService(repo as never, audit as never, users as never, undefined, undefined, notifications as never);
  return { service, held, sent, users, audit };
}

const actor = (userId: string, perms: Permission[]): AuthenticatedUser => ({ userId, tenantId: "t1", email: "a@x", roles: perms }) as AuthenticatedUser;
const assigner = actor("admin", ["role.assign", "role.read", "user.read", "user.reactivate"]);

describe("DECISION-044 q94: Risk Manager + Committee forbidden", () => {
  it("refuses it in both directions with the Committee-specific message", async () => {
    const { service } = world();
    await service.assignToUser(assigner, "rm", "u1", "r", "motif");
    await expect(service.assignToUser(assigner, "co", "u1", "r", "motif")).rejects.toThrow(/Risk Manager group and in the Committee group/);
    await service.assignToUser(assigner, "co", "u2", "r", "motif");
    await expect(service.assignToUser(assigner, "rm", "u2", "r", "motif")).rejects.toThrow(ValidationError);
  });

  it("refuses to reactivate a user who still holds a pre-existing cumul, accepts a clean one", async () => {
    const w = world();
    w.held.set("old", ["rm", "co"]);
    w.held.set("clean", ["rm"]);
    const svc = new UserService(w.users as never, w.audit as never, w.service);
    await expect(svc.reactivate(assigner, "old", "r")).rejects.toThrow(ValidationError);
    await expect(svc.reactivate(assigner, "clean", "r")).resolves.toMatchObject({ id: "clean" });
  });
});

describe("DECISION-044 q80: administrator + Committee cumul", () => {
  it("needs a reason and warns the validators with the existing cumul event", async () => {
    const { service, sent, held } = world();
    held.set("val", ["co"]);
    held.set("u1", ["co"]);
    await expect(service.assignToUser(assigner, "client", "u1", "r")).rejects.toThrow(/administrator and Committee member/);
    await service.assignToUser(assigner, "client", "u1", "r", "continuité");
    const cumul = sent.filter((s) => s.eventType === "ADMIN_RISK_MANAGER_CUMUL");
    expect(cumul.map((s) => s.recipientUserId)).toEqual(["val"]);
    expect(cumul[0]?.message).toMatch(/Comité/);
  });

  it("is flagged on the user sheet", async () => {
    const w = world();
    w.held.set("u1", ["coadm"]);
    w.held.set("u2", ["co"]);
    const svc = new UserService({ async getById(_t: string, id: string) { return { id, tenantId: "t1", email: "e", displayName: id, roles: [], departmentId: null, createdAt: new Date(), deletedAt: null }; } } as never, w.audit as never, w.service);
    expect((await svc.getDetail(assigner, "u1")).administratorAndCommittee).toBe(true);
    expect((await svc.getDetail(assigner, "u2")).administratorAndCommittee).toBe(false);
  });
});

describe("DECISION-044 q79: client management counts as administrator, methodology does not", () => {
  it("config.manage + Risk Manager needs a reason; config.update + Risk Manager does not", async () => {
    const { service, held } = world();
    held.set("u1", ["rm"]);
    held.set("u2", ["rm"]);
    await expect(service.assignToUser(assigner, "client", "u1", "r")).rejects.toThrow(/administrator/);
    await service.assignToUser(assigner, "client", "u1", "r", "motif");
    await expect(service.assignToUser(assigner, "method", "u2", "r")).resolves.toBeUndefined();
  });
});
