import { describe, expect, it, vi } from "vitest";
import express from "express";
import { RoleService } from "../src/services/RoleService.js";
import { rolesRouter } from "../src/api/v1/roles.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { Role, RolePermissionChange, SystemGroup } from "../src/domain/entities/Role.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA level 2 retest of B-8 quinquies (commit fbf96f9): F-B8t-01/03/04, q58-01, q63-01/02, q65-01.
// A QA PASS only: not a Security, Compliance or Privacy opinion.
// Oracle: INPUT/ACTION/EXPECTED were fixed from the spec comments in src before running.

const T1 = "t1";
type Ev = { entityType: string; entityId?: string; action: string; reason: string | null; oldValue: unknown; newValue: unknown };

function role(id: string, systemGroup: SystemGroup | null, permissions: Permission[] = ["risk.read"]): Role {
  return {
    id, tenantId: T1, name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
    systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
}
const actor = (userId: string, perms: Permission[]): AuthenticatedUser =>
  ({ userId, tenantId: T1, email: `${userId}@x`, roles: perms }) as AuthenticatedUser;
const admin = actor("admin", ["role.assign", "role.read", "role.update"]);
const validator = actor("val", ["rolegroup.audit.validate", "role.read"]);

interface Opts {
  cumul?: boolean; configThrows?: boolean; listAssignmentsThrows?: boolean; notifierThrows?: boolean;
  auditFails?: "approve" | "reject" | "all"; updateFails?: boolean; reopenFails?: boolean; yieldOnInsert?: boolean;
}

function world(opts: Opts = {}) {
  const roles: Role[] = [
    role("rm", "RISK_MANAGER"), role("co", "RISK_COMMITTEE", ["risk.read", "rolegroup.audit.validate"]),
    role("au", "AUDIT", ["audit.read", "rolegroup.audit.validate"]),
    role("plain", null), role("plain2", null, ["kri.read"]), role("adm", null, ["role.assign"]),
    role("auditish", null, ["audit.read"]),
  ];
  const held = new Map<string, string[]>();
  const revoked: Array<{ userId: string; roleId: string }> = [];
  const events: Ev[] = [];
  const sent: Array<{ recipientUserId: string; eventType: string; resourceId: string }> = [];
  const updates: Array<{ id: string; input: Record<string, unknown> }> = [];
  const changes: RolePermissionChange[] = [];
  let reopened = 0;
  let configReads = 0;
  const repo = {
    async getById(_t: string, id: string) { return roles.find((r) => r.id === id) ?? null; },
    async list() { return roles; },
    async listForUser(_t: string, u: string) { return roles.filter((r) => (held.get(u) ?? []).includes(r.id)); },
    async listAssignments(_t: string, roleId: string) {
      if (opts.listAssignmentsThrows) throw new Error("db down");
      return [
        ...[...held.entries()].filter(([, ids]) => ids.includes(roleId)).map(([userId]) => ({ userId, roleId, revokedAt: null })),
        ...revoked.filter((x) => x.roleId === roleId).map((x) => ({ ...x, revokedAt: new Date() })),
      ];
    },
    async assignToUser(_t: string, roleId: string, userId: string) {
      if (opts.yieldOnInsert) await new Promise((r) => setTimeout(r, 1));
      // faithful to user_roles_active_idx (013): one active (user, role) pair
      if ((held.get(userId) ?? []).includes(roleId)) throw new ConflictError("already held", roleId); // PostgresRoleRepository translates 23505 (q65-02)
      held.set(userId, [...(held.get(userId) ?? []), roleId]);
      return { id: "a", tenantId: T1, roleId, userId, grantedBy: "x", grantedAt: new Date(), revokedAt: null };
    },
    async revokeFromUser(_t: string, roleId: string, userId: string) {
      held.set(userId, (held.get(userId) ?? []).filter((r) => r !== roleId));
    },
    async countActiveAssignments() { return 99; },
    async update(_t: string, id: string, input: { permissions?: Permission[] }) {
      if (opts.updateFails) throw new Error("db down");
      updates.push({ id, input: input as Record<string, unknown> });
      const r = roles.find((x) => x.id === id)!;
      if (input.permissions) r.permissions = input.permissions;
      return r;
    },
  };
  const changeRepo = {
    async getById(_t: string, id: string) { return changes.find((c) => c.id === id) ?? null; },
    async decide(_t: string, id: string, status: "APPROVED" | "REJECTED", by: string) {
      const c = changes.find((x) => x.id === id)!;
      if (c.status !== "PENDING") return false;
      c.status = status; c.decidedBy = by;
      return true;
    },
    async reopen(_t: string, id: string) {
      reopened++;
      if (opts.reopenFails) throw new Error("reopen down");
      changes.find((x) => x.id === id)!.status = "PENDING";
    },
    async list() { return changes.filter((c) => c.status === "PENDING"); },
  };
  const users = {
    // faithful to PostgresUserRepository.listWithPermission
    async listWithPermission(_t: string, permission: string, excludeUserId: string) {
      return [...held.entries()]
        .filter(([u, ids]) => u !== excludeUserId && roles.some((r) => ids.includes(r.id) && r.permissions.includes(permission as Permission)))
        .map(([u]) => ({ id: u, displayName: u }));
    },
  };
  const notifications = {
    async record(i: { recipientUserId: string; eventType: string; resourceId: string }) {
      if (opts.notifierThrows) throw new Error("smtp down");
      sent.push(i);
    },
  };
  const audit = {
    async record(e: Ev) {
      if (opts.auditFails === "all") throw new Error("audit down");
      if (opts.auditFails === "approve" && e.entityType === "Role" && e.action === "PERMISSION_CHANGE") throw new Error("audit down");
      if (opts.auditFails === "reject" && e.entityType !== "Role") throw new Error("audit down");
      events.push(e);
    },
  };
  const configs = { async getByTenant() { configReads++; if (opts.configThrows) throw new Error("cfg down"); return { committeeAuditCumulAllowed: opts.cumul ?? true }; } };
  const service = new RoleService(repo as never, audit as never, users as never, undefined, changeRepo as never, notifications as never, configs as never);
  // a validator (Audit member) receives the cumul warnings
  held.set("val", ["au"]);
  return { service, held, revoked, events, sent, updates, changes, roles, reopened: () => reopened, configReads: () => configReads };
}
type W = ReturnType<typeof world>;
const perms = (w: W, id: string) => w.roles.find((r) => r.id === id)!.permissions;
const cumulSent = (w: W) => w.sent.filter((s) => s.eventType === "ADMIN_RISK_MANAGER_CUMUL");

async function http(service: RoleService, user: AuthenticatedUser, method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: AuthenticatedUser; requestId: string }).user = user;
    (req as unknown as { requestId: string }).requestId = "req";
    next();
  });
  app.use("/roles", rolesRouter(service));
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as { data?: unknown; error?: string; existingId?: string } | null };
  } finally {
    server.close();
  }
}

// ---------------------------------------------------------------- F-B8t-01
describe("F-B8t-01 RoleService.update with several holders", () => {
  it("widening the fixed Risk Manager group itself with an admin right (3 holders): reason required, nothing stored without it", async () => {
    const w = world();
    for (const u of ["u1", "u2", "u3"]) w.held.set(u, ["rm"]);
    await expect(w.service.update(admin, "rm", { permissions: ["risk.read", "role.assign"] }, "r")).rejects.toThrow(/reason is required/);
    expect(perms(w, "rm")).toEqual(["risk.read"]);
    expect(w.updates).toHaveLength(0);
    expect(w.events).toHaveLength(0);
    expect(cumulSent(w)).toHaveLength(0);
  });

  it("same widening with a reason: stored once, one audit row carrying the reason, one warning per holder", async () => {
    const w = world();
    for (const u of ["u1", "u2", "u3"]) w.held.set(u, ["rm"]);
    await w.service.update(admin, "rm", { permissions: ["risk.read", "role.assign"] }, "r", "politique");
    expect(w.updates).toHaveLength(1);
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ entityType: "Role", action: "PERMISSION_CHANGE", reason: "politique" });
    expect(cumulSent(w).map((s) => s.resourceId).sort()).toEqual(["u1", "u2", "u3"]);
    expect(new Set(cumulSent(w).map((s) => s.recipientUserId))).toEqual(new Set(["val"]));
  });

  it.each([["offender last", ["u1", "u2"]], ["offender first", ["u2", "u1"]]])(
    "one offending holder among harmless ones refuses the whole update (%s), nothing stored",
    async (_n, order) => {
      const w = world();
      w.held.set("u1", ["plain"]);
      w.held.set("u2", ["rm", "plain"]);
      // listAssignments order follows insertion order of `held`
      const reordered = new Map<string, string[]>();
      for (const u of order) reordered.set(u, w.held.get(u)!);
      w.held.clear();
      for (const [k, v] of reordered) w.held.set(k, v);
      w.held.set("val", ["au"]);
      await expect(w.service.update(admin, "plain", { permissions: ["risk.read", "role.assign"] }, "r")).rejects.toThrow(/reason is required/);
      expect(perms(w, "plain")).toEqual(["risk.read"]);
      expect(w.events).toHaveLength(0);
      expect(cumulSent(w)).toHaveLength(0);
    },
  );

  it("a holder who was already administrator + Risk Manager creates no new cumul: no reason, no warning", async () => {
    const w = world();
    w.held.set("u1", ["rm", "adm", "plain"]);
    await expect(w.service.update(admin, "plain", { permissions: ["risk.read", "user.update"] }, "r")).resolves.toBeDefined();
    expect(cumulSent(w)).toHaveLength(0);
  });

  it("a revoked assignment is ignored, even though the repository returns it", async () => {
    const w = world();
    w.held.set("u1", ["plain"]);
    w.revoked.push({ userId: "u9", roleId: "plain" });
    w.held.set("u9", ["rm"]); // u9 no longer holds `plain`
    await expect(w.service.update(admin, "plain", { permissions: ["risk.read", "role.assign"] }, "r")).resolves.toBeDefined();
    expect(cumulSent(w)).toHaveLength(0);
  });

  it("a role with no holder, or widening without any admin right: no reason needed", async () => {
    const w = world();
    await expect(w.service.update(admin, "plain", { permissions: ["risk.read", "role.assign"] }, "r")).resolves.toBeDefined();
    w.held.set("u1", ["rm", "plain2"]);
    await expect(w.service.update(admin, "plain2", { permissions: ["kri.read", "risk.read"] }, "r")).resolves.toBeDefined();
  });

  it("swapping a permission (one removed, one admin right added) counts as widening", async () => {
    const w = world();
    w.held.set("u1", ["rm", "plain"]);
    await expect(w.service.update(admin, "plain", { permissions: ["role.assign"] }, "r")).rejects.toThrow(/reason is required/);
  });

  it("narrowing or reordering only: holders are not even read (listAssignments would throw)", async () => {
    const w = world({ listAssignmentsThrows: true });
    w.held.set("u1", ["rm", "plain2"]);
    await expect(w.service.update(admin, "plain2", { permissions: ["kri.read"] }, "r")).resolves.toBeDefined();
    await expect(w.service.update(admin, "plain", { name: "renamed" } as never, "r")).resolves.toBeDefined();
  });

  it("fails closed when the holders cannot be listed: error, nothing stored, no audit", async () => {
    const w = world({ listAssignmentsThrows: true });
    await expect(w.service.update(admin, "plain", { permissions: ["risk.read", "kri.read"] }, "r")).rejects.toThrow("db down");
    expect(w.updates).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });

  describe("reason", () => {
    it("whitespace-only reason counts as missing", async () => {
      const w = world();
      w.held.set("u1", ["rm", "plain"]);
      await expect(w.service.update(admin, "plain", { permissions: ["role.assign"] }, "r", "   ")).rejects.toThrow(/reason is required/);
    });
    it("500 characters (padded with spaces) accepted and trimmed, 501 refused", async () => {
      const w = world();
      w.held.set("u1", ["rm", "plain"]);
      await expect(w.service.update(admin, "plain", { permissions: ["role.assign"] }, "r", "x".repeat(501))).rejects.toThrow(ValidationError);
      expect(w.updates).toHaveLength(0);
      await w.service.update(admin, "plain", { permissions: ["role.assign"] }, "r", `  ${"x".repeat(500)}  `);
      expect(w.events[0]!.reason).toBe("x".repeat(500));
    });
    it("a reason given when no cumul is created is still stored in the audit row, with no warning (pinned)", async () => {
      const w = world();
      await w.service.update(admin, "plain", { permissions: ["risk.read", "kri.read"] }, "r", " pourquoi ");
      expect(w.events[0]!.reason).toBe("pourquoi");
      expect(w.sent).toHaveLength(0);
    });
    it("no reason and no cumul: audit reason is null", async () => {
      const w = world();
      await w.service.update(admin, "plain", { permissions: ["risk.read", "kri.read"] }, "r");
      expect(w.events[0]!.reason).toBeNull();
    });
    it("HTTP: reason is not forwarded to the repository as a column", async () => {
      const w = world();
      const res = await http(w.service, admin, "PATCH", "/roles/plain", { permissions: ["risk.read", "kri.read"], reason: "motif" });
      expect(res.status).toBe(200);
      expect(w.updates[0]!.input).not.toHaveProperty("reason");
    });
    it.each([
      ["whitespace only", "   "], ["empty", ""], ["null", null], ["number", 5], ["501 chars", "x".repeat(501)],
    ])("HTTP: reason %s is a 400, nothing stored", async (_n, reason) => {
      const w = world();
      const res = await http(w.service, admin, "PATCH", "/roles/plain", { permissions: ["risk.read", "kri.read"], reason });
      expect(res.status).toBe(400);
      expect(w.updates).toHaveLength(0);
    });
    it("HTTP: 500 chars accepted; cumul without reason is a 400; with reason a 200 and a warning", async () => {
      const w = world();
      w.held.set("u1", ["rm", "plain"]);
      expect((await http(w.service, admin, "PATCH", "/roles/plain", { permissions: ["role.assign"] })).status).toBe(400);
      expect(w.updates).toHaveLength(0);
      expect((await http(w.service, admin, "PATCH", "/roles/plain", { permissions: ["role.assign"], reason: "x".repeat(500) })).status).toBe(200);
      expect(cumulSent(w)).toHaveLength(1);
    });
    it("HTTP: reason alone (no permissions) is accepted", async () => {
      const w = world();
      expect((await http(w.service, admin, "PATCH", "/roles/plain", { reason: "motif" })).status).toBe(200);
    });
  });

  describe("q58 on update", () => {
    it("a Committee holder + tenant forbids: giving audit.* to his ordinary role is refused whatever the other holders", async () => {
      const w = world({ cumul: false });
      w.held.set("u1", ["plain"]);
      w.held.set("u2", ["co", "plain"]);
      await expect(w.service.update(admin, "plain", { permissions: ["risk.read", "audit.mission.read"] }, "r")).rejects.toThrow(/setting of this tenant/);
      expect(perms(w, "plain")).toEqual(["risk.read"]);
      expect(w.events).toHaveLength(0);
    });
    it("same widening with the setting on: allowed, and the setting is read only when a pair exists", async () => {
      const w = world({ cumul: true });
      w.held.set("u1", ["plain"]);
      await w.service.update(admin, "plain", { permissions: ["risk.read", "audit.mission.read"] }, "r");
      expect(w.configReads()).toBe(0);
    });
    it("fails closed when the tenant setting cannot be read for a Committee holder", async () => {
      const w = world({ configThrows: true });
      w.held.set("u2", ["co", "plain"]);
      await expect(w.service.update(admin, "plain", { permissions: ["risk.read", "audit.mission.read"] }, "r")).rejects.toThrow("cfg down");
      expect(w.updates).toHaveLength(0);
    });
    it("Risk Manager + audit.*: refused with the tenant setting on or off", async () => {
      for (const cumul of [true, false]) {
        const w = world({ cumul });
        w.held.set("u1", ["rm", "plain"]);
        await expect(w.service.update(admin, "plain", { permissions: ["risk.read", "audit.mission.read"] }, "r")).rejects.toThrow(/Risk Manager/);
      }
    });
    it("OBSERVATION: a role that already carries audit.* and is held by a Committee member under a forbid cannot receive any unrelated widening", async () => {
      const w = world({ cumul: false });
      w.held.set("u2", ["co", "auditish"]); // legacy cumul created while it was allowed
      await expect(w.service.update(admin, "auditish", { permissions: ["audit.mission.read", "kri.read"] }, "r")).rejects.toThrow(ValidationError);
    });
  });

  it("a failed notification does not fail the (already stored) update", async () => {
    const w = world({ notifierThrows: true });
    w.held.set("u1", ["rm", "plain"]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(w.service.update(admin, "plain", { permissions: ["role.assign"] }, "r", "motif")).resolves.toBeDefined();
    spy.mockRestore();
    expect(perms(w, "plain")).toEqual(["role.assign"]);
  });

  it("regression: an actor still cannot widen a role he holds, and the Audit group still goes through its endpoint", async () => {
    const w = world();
    w.held.set("admin", ["plain"]);
    await expect(w.service.update(admin, "plain", { permissions: ["risk.read", "kri.read"] }, "r")).rejects.toThrow(ForbiddenError);
    await expect(w.service.update(admin, "au", { permissions: ["audit.mission.read"] }, "r")).rejects.toThrow(/dedicated endpoint/);
  });
});

// ---------------------------------------------------------------- q65-01 / 409
describe("409 on double assignment", () => {
  it("second assignment: 409, one active pair, no extra audit row, no extra Committee notification", async () => {
    const w = world();
    expect((await http(w.service, admin, "POST", "/roles/co/assign", { userId: "u1", reason: "motif" })).status).toBe(201);
    const sentBefore = w.sent.length;
    const eventsBefore = w.events.length;
    const res = await http(w.service, admin, "POST", "/roles/co/assign", { userId: "u1", reason: "motif" });
    expect(res.status).toBe(409);
    expect(w.held.get("u1")).toEqual(["co"]);
    expect(w.sent).toHaveLength(sentBefore);
    expect(w.events).toHaveLength(eventsBefore);
  });
  it("a different user, or the same user after a revocation, is not a conflict", async () => {
    const w = world();
    await w.service.assignToUser(admin, "plain", "u1", "r");
    await expect(w.service.assignToUser(admin, "plain", "u2", "r")).resolves.toBeUndefined();
    await w.service.assignToUser(admin, "plain2", "u1", "r"); // revoking a user's last role is refused
    await w.service.revokeFromUser(admin, "plain", "u1", "r");
    await expect(w.service.assignToUser(admin, "plain", "u1", "r")).resolves.toBeUndefined();
  });
  it("service error type is ConflictError with the role id", async () => {
    const w = world();
    await w.service.assignToUser(admin, "plain", "u1", "r");
    await expect(w.service.assignToUser(admin, "plain", "u1", "r")).rejects.toBeInstanceOf(ConflictError);
  });
  it("PINNED ORDER: on a fixed group the missing-reason 400 wins over the 409", async () => {
    const w = world();
    await w.service.assignToUser(admin, "co", "u1", "r", "motif");
    expect((await http(w.service, admin, "POST", "/roles/co/assign", { userId: "u1" })).status).toBe(400);
  });
  it("self-assignment is still refused before anything else", async () => {
    const w = world();
    await expect(w.service.assignToUser(admin, "plain", "admin", "r")).rejects.toThrow(ForbiddenError);
  });
  it("q65-02: two simultaneous assignments of the same role race past the pre-check; the loser gets a ConflictError (repository translates 23505)", async () => {
    const w = world({ yieldOnInsert: true });
    const results = await Promise.allSettled([
      w.service.assignToUser(admin, "plain", "u1", "r"),
      w.service.assignToUser(admin, "plain", "u1", "r"),
    ]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictError);
  });
});

// ---------------------------------------------------------------- F-B8t-03
function pending(w: W, permissions: Permission[], id = "c1", requestedBy = "maker") {
  w.changes.push({ id, tenantId: T1, roleId: "au", permissions, requestedBy, status: "PENDING", decidedBy: null, createdAt: new Date(), decidedAt: null } as RolePermissionChange);
}
describe("F-B8t-03 whitelist rechecked at approval", () => {
  it.each([
    [["audit.read", "risk.delete"]], [["role.assign"]], [["audit.read", "user.update", "role.update"]], [["not.a.permission" as Permission]],
  ])("approving %j is refused: still PENDING, rights untouched, no audit row, no reopen", async (p) => {
    const w = world();
    pending(w, p as Permission[]);
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow(/read-only/);
    expect(w.changes[0]!.status).toBe("PENDING");
    expect(w.changes[0]!.decidedBy).toBeNull();
    expect(perms(w, "au")).toEqual(["audit.read", "rolegroup.audit.validate"]);
    expect(w.updates).toHaveLength(0);
    expect(w.events).toHaveLength(0);
    expect(w.reopened()).toBe(0);
  });
  it("the error names every offending permission", async () => {
    const w = world();
    pending(w, ["audit.read", "risk.delete", "role.assign"]);
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow(/risk\.delete, role\.assign/);
  });
  it("the same change can be rejected, with an audit row, and then cannot be approved", async () => {
    const w = world();
    pending(w, ["role.assign"]);
    await w.service.decideAuditPermissionChange(validator, "c1", false, "r");
    expect(w.changes[0]!.status).toBe("REJECTED");
    expect(w.events).toHaveLength(1);
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow(/already been decided/);
  });
  it("a whitelisted change is still approved and applied (control)", async () => {
    const w = world();
    pending(w, ["audit.read", "risk.read"]);
    await w.service.decideAuditPermissionChange(validator, "c1", true, "r");
    expect(w.changes[0]!.status).toBe("APPROVED");
    expect(perms(w, "au")).toEqual(["audit.read", "risk.read"]);
    expect(w.events.map((e) => e.entityType).sort()).toEqual(["Role", "RolePermissionChange"]);
  });
  it("authorization still comes first: the author, a non-member and a Risk Manager are refused before the whitelist", async () => {
    const w = world();
    pending(w, ["role.assign"]);
    await expect(w.service.decideAuditPermissionChange(actor("maker", ["rolegroup.audit.validate"]), "c1", true, "r")).rejects.toThrow(ForbiddenError);
    await expect(w.service.decideAuditPermissionChange(actor("stranger", ["rolegroup.audit.validate"]), "c1", true, "r")).rejects.toThrow(ForbiddenError);
    w.held.set("val", ["au", "rm"]);
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow(ForbiddenError);
  });
  it("unknown change id: not found", async () => {
    const w = world();
    await expect(w.service.decideAuditPermissionChange(validator, "nope", true, "r")).rejects.toThrow(/nope/);
  });
});

// ---------------------------------------------------------------- F-B8t-04
describe("F-B8t-04 APPROVED is kept when the audit write fails", () => {
  it("approve + audit failure: rights applied, status APPROVED, error surfaced, logged with the request id, no reopen", async () => {
    const w = world({ auditFails: "approve" });
    pending(w, ["audit.read", "risk.read"]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "req-42")).rejects.toThrow("audit down");
    expect(spy.mock.calls.some((c) => String(c[0]).includes("req-42") && String(c[0]).includes("APPROVED"))).toBe(true);
    spy.mockRestore();
    expect(w.changes[0]!.status).toBe("APPROVED");
    expect(perms(w, "au")).toEqual(["audit.read", "risk.read"]);
    expect(w.reopened()).toBe(0);
  });
  it("retrying after that failure is refused (already decided): no second application", async () => {
    const w = world({ auditFails: "approve" });
    pending(w, ["audit.read", "risk.read"]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("audit down");
    spy.mockRestore();
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow(/already been decided/);
    await expect(w.service.decideAuditPermissionChange(validator, "c1", false, "r")).rejects.toThrow(/already been decided/);
    expect(w.updates).toHaveLength(1);
  });
  it("reject + audit failure: REJECTED kept, no reopen, rights untouched", async () => {
    const w = world({ auditFails: "reject" });
    pending(w, ["audit.read", "risk.read"]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(w.service.decideAuditPermissionChange(validator, "c1", false, "r")).rejects.toThrow("audit down");
    spy.mockRestore();
    expect(w.changes[0]!.status).toBe("REJECTED");
    expect(w.reopened()).toBe(0);
    expect(w.updates).toHaveLength(0);
  });
  it("application failure: nothing applied, no audit row, claim reopened, original error kept; can then be retried", async () => {
    const w = world({ updateFails: true });
    pending(w, ["audit.read", "risk.read"]);
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("db down");
    expect(w.changes[0]!.status).toBe("PENDING");
    expect(w.events).toHaveLength(0);
    expect(w.reopened()).toBe(1);
  });
  it("OBSERVATION: application failure AND reopen failure leaves APPROVED without the rights applied; the original error is still the one returned", async () => {
    const w = world({ updateFails: true, reopenFails: true });
    pending(w, ["audit.read", "risk.read"]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("db down");
    spy.mockRestore();
    expect(w.changes[0]!.status).toBe("APPROVED");
    expect(perms(w, "au")).toEqual(["audit.read", "rolegroup.audit.validate"]);
  });
  it("OBSERVATION: an approved change whose audit row was lost leaves a permission change on the Audit group with no PERMISSION_CHANGE event (traceable only through role_permission_changes and the log line)", async () => {
    const w = world({ auditFails: "approve" });
    pending(w, ["audit.read"]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow();
    spy.mockRestore();
    expect(w.events.filter((e) => e.entityType === "Role")).toHaveLength(0);
    expect(w.changes[0]!.decidedBy).toBe("val");
  });
});
