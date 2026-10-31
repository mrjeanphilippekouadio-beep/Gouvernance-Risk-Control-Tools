import { describe, expect, it } from "vitest";
import express from "express";
import { RoleService } from "../src/services/RoleService.js";
import { rolesRouter } from "../src/api/v1/roles.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { Role, RolePermissionChange, SystemGroup } from "../src/domain/entities/Role.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level 1 tests for B-8 quinquies (F-B8t-01/03/04, q65-01). Authored by the code's author: QA level 2 is A08's.

function role(id: string, systemGroup: SystemGroup | null, permissions: Permission[] = ["risk.read"]): Role {
  return {
    id, tenantId: "t1", name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
    systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
}
const actor = (userId: string, perms: Permission[]): AuthenticatedUser => ({ userId, tenantId: "t1", email: "a@x", roles: perms }) as AuthenticatedUser;
const admin = actor("admin", ["role.assign", "role.read", "role.update"]);
const validator = actor("val", ["rolegroup.audit.validate", "role.read"]);

function setup(opts: { cumul?: boolean; auditFails?: boolean; updateFails?: boolean } = {}) {
  const roles = [
    role("rm", "RISK_MANAGER"), role("co", "RISK_COMMITTEE"), role("au", "AUDIT", ["audit.read"]),
    role("plain", null), role("plain2", null),
  ];
  const held = new Map<string, string[]>();
  const changes: RolePermissionChange[] = [];
  const events: Array<{ action: string; entityType: string; reason: string | null }> = [];
  const sent: Array<{ recipientUserId: string; eventType: string }> = [];
  let reopened = 0;
  const roleRepo = {
    async getById(_t: string, id: string) { return roles.find((r) => r.id === id) ?? null; },
    async list() { return roles; },
    async listForUser(_t: string, u: string) { return roles.filter((r) => (held.get(u) ?? []).includes(r.id)); },
    async listAssignments(_t: string, roleId: string) {
      return [...held.entries()].filter(([, ids]) => ids.includes(roleId)).map(([userId]) => ({ userId, roleId, revokedAt: null }));
    },
    async assignToUser(_t: string, roleId: string, userId: string) {
      held.set(userId, [...(held.get(userId) ?? []), roleId]);
      return { id: "a", tenantId: "t1", roleId, userId, grantedBy: "x", grantedAt: new Date(), revokedAt: null };
    },
    async update(_t: string, id: string, input: { permissions?: Permission[] }) {
      if (opts.updateFails) throw new Error("db down");
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
    async reopen(_t: string, id: string) { reopened++; changes.find((x) => x.id === id)!.status = "PENDING"; },
  };
  const users = { async listWithPermission() { return [{ id: "aud1", displayName: "Aud One" }]; } };
  const notifications = { async record(i: { recipientUserId: string; eventType: string }) { sent.push(i); } };
  const audit = {
    async record(e: { action: string; entityType: string; reason: string | null }) {
      if (opts.auditFails) throw new Error("audit down");
      events.push(e);
    },
  };
  const configs = { async getByTenant() { return { committeeAuditCumulAllowed: opts.cumul ?? true }; } };
  const service = new RoleService(roleRepo as never, audit as never, users as never, undefined, changeRepo as never, notifications as never, configs as never);
  return { service, held, changes, events, sent, roles, reopened: () => reopened };
}

describe("F-B8t-01 RoleService.update replays the cumul rules for each holder", () => {
  it("refuses giving audit.* to a role held by a Risk Manager, and stores nothing", async () => {
    const w = setup();
    w.held.set("u1", ["rm", "plain"]);
    await expect(w.service.update(admin, "plain", { permissions: ["audit.mission.read"] }, "r")).rejects.toThrow(ValidationError);
    expect(w.roles.find((r) => r.id === "plain")!.permissions).toEqual(["risk.read"]);
    expect(w.events).toHaveLength(0);
  });

  it("refuses giving audit.* to a role held by a Committee member when the tenant forbids the cumul, allows it otherwise", async () => {
    const forbid = setup({ cumul: false });
    forbid.held.set("u1", ["co", "plain"]);
    await expect(forbid.service.update(admin, "plain", { permissions: ["audit.mission.read"] }, "r")).rejects.toThrow(/setting of this tenant/);
    const allow = setup({ cumul: true });
    allow.held.set("u1", ["co", "plain"]);
    await expect(allow.service.update(admin, "plain", { permissions: ["audit.mission.read"] }, "r")).resolves.toBeDefined();
  });

  it("new admin + Risk Manager cumul: reason required, then audited with the reason and notified once per holder", async () => {
    const w = setup();
    w.held.set("u1", ["rm", "plain"]);
    w.held.set("u2", ["rm", "plain"]);
    await expect(w.service.update(admin, "plain", { permissions: ["role.assign"] }, "r")).rejects.toThrow(/reason is required/);
    expect(w.sent).toHaveLength(0);
    await w.service.update(admin, "plain", { permissions: ["role.assign"] }, "r", " politique ");
    expect(w.events[0]).toMatchObject({ action: "PERMISSION_CHANGE", reason: "politique" });
    expect(w.sent.map((s) => s.eventType)).toEqual(["ADMIN_RISK_MANAGER_CUMUL", "ADMIN_RISK_MANAGER_CUMUL"]);
  });

  it("no replay and no reason needed when nothing is added, or when no holder is a Risk Manager", async () => {
    const w = setup();
    w.held.set("u1", ["rm", "plain"]);
    w.held.set("u2", ["plain2"]);
    await expect(w.service.update(admin, "plain", { permissions: ["risk.read"] }, "r")).resolves.toBeDefined();
    await expect(w.service.update(admin, "plain2", { permissions: ["role.assign"] }, "r")).resolves.toBeDefined();
    expect(w.sent).toHaveLength(0);
  });

  it("PATCH /roles/:id accepts the optional reason (400 when over 500 chars)", async () => {
    const w = setup();
    w.held.set("u1", ["rm", "plain"]);
    const ok = await http(w.service, admin, "PATCH", "/roles/plain", { permissions: ["role.assign"], reason: "motif" });
    expect(ok.status).toBe(200);
    const bad = await http(w.service, admin, "PATCH", "/roles/plain2", { permissions: ["kri.read"], reason: "x".repeat(501) });
    expect(bad.status).toBe(400);
  });
});

describe("q65-01 assigning a role already held", () => {
  it("is a 409 over HTTP, with no second insert", async () => {
    const w = setup();
    await w.service.assignToUser(admin, "plain", "u1", "r");
    const res = await http(w.service, admin, "POST", "/roles/plain/assign", { userId: "u1" });
    expect(res.status).toBe(409);
    expect(w.held.get("u1")).toEqual(["plain"]);
  });
});

function pending(w: ReturnType<typeof setup>, permissions: Permission[]) {
  w.changes.push({ id: "c1", tenantId: "t1", roleId: "au", permissions, requestedBy: "maker", status: "PENDING", decidedBy: null, createdAt: new Date(), decidedAt: null } as RolePermissionChange);
}
function validatorHolds(w: ReturnType<typeof setup>) { w.held.set("val", ["au"]); }

describe("F-B8t-03 approval rechecks the whitelist", () => {
  it("refuses to approve a PENDING change holding a non-read permission; it stays PENDING and can be rejected", async () => {
    const w = setup();
    validatorHolds(w);
    pending(w, ["audit.read", "risk.delete"]);
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow(/read-only/);
    expect(w.changes[0]!.status).toBe("PENDING");
    expect(w.roles.find((r) => r.id === "au")!.permissions).toEqual(["audit.read"]);
    await w.service.decideAuditPermissionChange(validator, "c1", false, "r");
    expect(w.changes[0]!.status).toBe("REJECTED");
  });

  it("the author still cannot validate", async () => {
    const w = setup();
    w.held.set("maker", ["au"]);
    pending(w, ["audit.read"]);
    await expect(w.service.decideAuditPermissionChange(actor("maker", ["rolegroup.audit.validate"]), "c1", true, "r")).rejects.toThrow(/author/);
  });
});

describe("F-B8t-04 no reopen once the rights are applied", () => {
  it("audit failure after application: error returned, status stays APPROVED, no reopen", async () => {
    const w = setup({ auditFails: true });
    validatorHolds(w);
    pending(w, ["audit.read", "risk.read"]);
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("audit down");
    expect(w.reopened()).toBe(0);
    expect(w.changes[0]!.status).toBe("APPROVED");
    expect(w.roles.find((r) => r.id === "au")!.permissions).toEqual(["audit.read", "risk.read"]);
  });

  it("application failure: nothing applied, the claim is reopened", async () => {
    const w = setup({ updateFails: true });
    validatorHolds(w);
    pending(w, ["audit.read", "risk.read"]);
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("db down");
    expect(w.reopened()).toBe(1);
    expect(w.changes[0]!.status).toBe("PENDING");
  });
});

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
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status };
  } finally {
    server.close();
  }
}
