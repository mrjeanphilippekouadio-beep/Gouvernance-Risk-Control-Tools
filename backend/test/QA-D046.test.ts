import { describe, expect, it } from "vitest";
import { RoleService } from "../src/services/RoleService.js";
import { UserService } from "../src/services/UserService.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type { Permission } from "../src/domain/permissions.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA-D046 (A08): q104 admin + Audit cumul, cross-path edge cases. Oracle: one reason covers every cumul created by the same
// change; each created cumul warns once; a cumul that already existed warns/asks for nothing; leaving then re-entering asks again.

const role = (id: string, systemGroup: SystemGroup | null, permissions: Permission[]): Role => ({
  id, tenantId: "t1", name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
  systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
});

function world() {
  const roles: Role[] = [
    role("rm", "RISK_MANAGER", ["risk.read"]),
    role("co", "RISK_COMMITTEE", ["risk.read", "rolegroup.audit.validate"]),
    role("au", "AUDIT", ["audit.read"]),
    role("client", null, ["config.manage"]),
    role("client2", null, ["config.manage"]),
    role("plain", null, ["risk.read"]),
    role("plain2", null, ["risk.read"]),
    role("audperm", null, ["audit.read"]),
  ];
  const held = new Map<string, string[]>();
  const sent: Array<{ recipientUserId: string; eventType: string; message: string }> = [];
  const recheckOf: { fn?: (r: Role, holders: Array<{ userId: string; roles: Role[] }>) => Promise<void> } = {};
  const repo = {
    async getById(_t: string, id: string) { return roles.find((r) => r.id === id) ?? null; },
    async listForUser(_t: string, u: string) { return roles.filter((r) => (held.get(u) ?? []).includes(r.id)); },
    async assignToUser(_t: string, roleId: string, userId: string) {
      held.set(userId, [...(held.get(userId) ?? []), roleId]);
      return { id: "a", tenantId: "t1", roleId, userId, grantedBy: "x", grantedAt: new Date(), revokedAt: null };
    },
    async revokeFromUser(_t: string, roleId: string, userId: string) {
      held.set(userId, (held.get(userId) ?? []).filter((x) => x !== roleId));
    },
    async countActiveAssignments(_t: string, roleId: string) { return [...held.values()].filter((ids) => ids.includes(roleId)).length; },
    async listAssignments(_t: string, roleId: string) {
      return [...held.entries()].filter(([, ids]) => ids.includes(roleId)).map(([userId]) => ({ userId, revokedAt: null }));
    },
    async update(_t: string, id: string, input: { permissions?: Permission[] }, recheck?: typeof recheckOf.fn) {
      recheckOf.fn = recheck;
      const r = roles.find((x) => x.id === id)!;
      if (recheck) {
        await recheck(r, [...held.entries()].filter(([, ids]) => ids.includes(id))
          .map(([userId, ids]) => ({ userId, roles: roles.filter((x) => ids.includes(x.id)) })));
      }
      if (input.permissions) r.permissions = input.permissions;
      return r;
    },
  };
  const users = {
    async listWithPermission(_t: string, perm: string, exclude: string) {
      return [...held.entries()]
        .filter(([u, ids]) => u !== exclude && roles.some((r) => ids.includes(r.id) && r.permissions.includes(perm as Permission)))
        .map(([u]) => ({ id: u, displayName: u }));
    },
    async getById(_t: string, id: string) {
      return { id, tenantId: "t1", email: "e", displayName: id, roles: [], departmentId: null, createdAt: new Date(), deletedAt: null };
    },
  };
  const auditRows: unknown[] = [];
  const notifications = { async record(i: { recipientUserId: string; eventType: string; message: string }) { sent.push(i); } };
  const audit = { async record(e: unknown) { auditRows.push(e); } };
  const service = new RoleService(repo as never, audit as never, users as never, undefined, undefined, notifications as never);
  const cumul = () => sent.filter((s) => s.eventType === "ADMIN_RISK_MANAGER_CUMUL");
  return { service, held, sent, users, audit, auditRows, cumul, recheckOf, roles };
}

const actor = (userId: string, perms: Permission[]): AuthenticatedUser => ({ userId, tenantId: "t1", email: "a@x", roles: perms }) as AuthenticatedUser;
const assigner = actor("admin", ["role.assign", "role.read", "role.update", "user.read"]);

describe("QA-D046 q104: admin + Committee + Audit (several cumuls in one change)", () => {
  it("one reason covers both; two distinct warnings (Comité, Audit), none to the user himself", async () => {
    const w = world();
    w.held.set("val", ["co"]);
    w.held.set("u1", ["co", "au"]);
    await w.service.assignToUser(assigner, "client", "u1", "r", "continuité");
    expect(w.cumul().map((s) => s.recipientUserId).sort()).toEqual(["val", "val"]);
    expect(w.cumul().map((s) => /Comité/.test(s.message) ? "co" : /Audit/.test(s.message) ? "au" : "?").sort()).toEqual(["au", "co"]);
    expect(w.cumul().every((s) => s.recipientUserId !== "u1")).toBe(true);
  });

  it("no reason -> refused once, nothing assigned, no warning", async () => {
    const w = world();
    w.held.set("u1", ["co", "au"]);
    await expect(w.service.assignToUser(assigner, "client", "u1", "r")).rejects.toThrow(/reason is required/);
    await expect(w.service.assignToUser(assigner, "client", "u1", "r", "   ")).rejects.toThrow(/reason is required/);
    expect(w.held.get("u1")).toEqual(["co", "au"]);
    expect(w.sent).toEqual([]);
  });

  it("reason bound: 500 accepted, 501 refused (Audit cumul)", async () => {
    const w = world();
    w.held.set("u1", ["au"]);
    await expect(w.service.assignToUser(assigner, "client", "u1", "r", "x".repeat(501))).rejects.toThrow(/at most 500/);
    await expect(w.service.assignToUser(assigner, "client", "u1", "r", "x".repeat(500))).resolves.toBeUndefined();
  });

  it("a second admin role on an existing admin + Audit user: no reason, no new warning", async () => {
    const w = world();
    w.held.set("u1", ["au", "client"]);
    await expect(w.service.assignToUser(assigner, "client2", "u1", "r")).resolves.toBeUndefined();
    expect(w.sent).toEqual([]);
  });

  it("existing admin + Committee, then Audit group added: only the Audit cumul is new", async () => {
    const w = world();
    w.held.set("val", ["co"]);
    w.held.set("u1", ["co", "client"]);
    // Audit group needs its own reason anyway; the q104 reason is the same string.
    await w.service.assignToUser(assigner, "au", "u1", "r", "audit");
    expect(w.cumul()).toHaveLength(1);
    expect(w.cumul()[0]!.message).toMatch(/Audit/);
  });

  it("leaving then re-entering the cumul asks for the reason and warns again", async () => {
    const w = world();
    w.held.set("val", ["co"]);
    w.held.set("u1", ["au", "plain"]);
    await w.service.assignToUser(assigner, "client", "u1", "r", "m1");
    expect(w.cumul()).toHaveLength(1);
    await w.service.revokeFromUser(assigner, "au", "u1", "r", "fin");
    await expect(w.service.assignToUser(assigner, "au", "u1", "r", "retour")).resolves.toBeUndefined();
    expect(w.cumul()).toHaveLength(2);
    // revoke the admin role instead, then re-add it
    await w.service.revokeFromUser(assigner, "client", "u1", "r");
    await expect(w.service.assignToUser(assigner, "client", "u1", "r")).rejects.toThrow(/Audit member/);
  });

  it("an ordinary role carrying audit.read is NOT Audit membership for q104 (pinned: F-D044-08 with A13)", async () => {
    const w = world();
    w.held.set("u1", ["audperm"]);
    await expect(w.service.assignToUser(assigner, "client", "u1", "r")).resolves.toBeUndefined();
    expect(w.cumul()).toEqual([]);
  });

  it("RM + Audit stays refused (q43) and admin + RM still flagged (q63)", async () => {
    const w = world();
    w.held.set("u1", ["rm"]);
    await expect(w.service.assignToUser(assigner, "au", "u1", "r", "m")).rejects.toThrow(/Risk Manager group and in the Audit group/);
    w.held.set("val", ["co"]);
    await expect(w.service.assignToUser(assigner, "client", "u1", "r")).rejects.toThrow(/Risk Manager/);
    await w.service.assignToUser(assigner, "client", "u1", "r", "m");
    expect(w.cumul()[0]!.message).toMatch(/Risk Manager/);
  });
});

describe("QA-D046 q104: widening a role creates the Audit cumul", () => {
  it("refused without reason for the Audit holder, accepted with one and warned once per created cumul", async () => {
    const w = world();
    w.held.set("val", ["co"]);
    w.held.set("u1", ["au", "plain"]);
    w.held.set("u2", ["plain"]); // not Audit: no cumul
    w.held.set("u3", ["au", "plain"]);
    await expect(w.service.update(assigner, "plain", { permissions: ["risk.read", "config.manage"] }, "r")).rejects.toThrow(/Audit member/);
    expect(w.roles.find((r) => r.id === "plain")!.permissions).toEqual(["risk.read"]);
    await w.service.update(assigner, "plain", { permissions: ["risk.read", "config.manage"] }, "r", "élargissement");
    expect(w.cumul().map((s) => s.recipientUserId)).toEqual(["val", "val"]);
    expect(w.cumul().every((s) => /Audit/.test(s.message))).toBe(true);
  });

  it("restriction or unrelated widening creates nothing; a user already admin + Audit is not re-warned", async () => {
    const w = world();
    w.held.set("val", ["co"]);
    w.held.set("u1", ["au", "client", "plain"]);
    await w.service.update(assigner, "plain", { permissions: ["risk.read", "config.manage"] }, "r");
    expect(w.sent).toEqual([]);
    await w.service.update(assigner, "plain2", { permissions: ["risk.read", "risk.create"] }, "r");
    expect(w.sent).toEqual([]);
  });

  it("replay under the lock: a holder who became Audit after the pre-check is caught (reason required)", async () => {
    const w = world();
    w.held.set("u1", ["plain"]);
    // The pre-check sees no Audit holder; the lock-time replay sees u1 + Audit.
    const original = w.roles.find((r) => r.id === "plain")!;
    await w.service.update(assigner, "plain", { permissions: ["risk.read", "config.manage"] }, "r"); // no Audit yet: ok
    original.permissions = ["risk.read"];
    const fn = w.recheckOf.fn!;
    expect(fn).toBeTypeOf("function");
    const au = w.roles.find((r) => r.id === "au")!;
    await expect(fn(original, [{ userId: "u1", roles: [original, au] }])).rejects.toThrow(/Audit member/);
  });

  it("widening the Audit group itself goes through its own endpoint (generic update refused)", async () => {
    const w = world();
    await expect(w.service.update(assigner, "au", { permissions: ["audit.read", "config.manage"] }, "r", "m")).rejects.toThrow(/dedicated endpoint/);
  });
});

describe("QA-D046 q104: user sheet flags and reactivation", () => {
  const sheet = (w: ReturnType<typeof world>) =>
    new UserService(w.users as never, w.audit as never, w.service);

  it("the three admin flags are independent", async () => {
    const w = world();
    w.held.set("a", ["client", "au"]);
    w.held.set("b", ["client", "co"]);
    w.held.set("c", ["client", "rm"]);
    w.held.set("d", ["client", "plain"]);
    const flags = async (u: string) => { const d = await sheet(w).getDetail(assigner, u); return [d.administratorAndRiskManager, d.administratorAndCommittee, d.administratorAndAudit]; };
    expect(await flags("a")).toEqual([false, false, true]);
    expect(await flags("b")).toEqual([false, true, false]);
    expect(await flags("c")).toEqual([true, false, false]);
    expect(await flags("d")).toEqual([false, false, false]);
  });

  it("flag disappears when the cumul is removed", async () => {
    const w = world();
    w.held.set("a", ["client", "au", "plain"]);
    expect((await sheet(w).getDetail(assigner, "a")).administratorAndAudit).toBe(true);
    await w.service.revokeFromUser(assigner, "client", "a", "r");
    expect((await sheet(w).getDetail(assigner, "a")).administratorAndAudit).toBe(false);
  });

  it("without a RoleService the flag is false (optional dependency)", async () => {
    const w = world();
    const d = await new UserService(w.users as never, w.audit as never).getDetail(assigner, "a");
    expect(d.administratorAndAudit).toBe(false);
  });

  it("OBSERVATION pinned: reactivation does not replay admin + Audit (only q43/q94 forbidden cumuls)", async () => {
    const w = world();
    w.held.set("old", ["client", "au"]);
    await expect(w.service.assertReactivable("t1", "old")).resolves.toBeUndefined();
  });
});
