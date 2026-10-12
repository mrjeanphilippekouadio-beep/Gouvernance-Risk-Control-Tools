import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import express from "express";
import { RoleService } from "../src/services/RoleService.js";
import { rolesRouter } from "../src/api/v1/roles.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import { FIXED_GROUP_PERMISSIONS, isAuditGroupPermission } from "../src/domain/fixedGroupPermissions.js";
import { ALL_PERMISSIONS, type Permission } from "../src/domain/permissions.js";
import type { Role, RolePermissionChange, SystemGroup } from "../src/domain/entities/Role.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level 1 tests for B-8 ter (F-B8b-01/02/03/05, B8bis-02). Authored by the code's author: QA level 2 is A08's.

function role(id: string, systemGroup: SystemGroup | null, permissions: Permission[] = ["risk.read"]): Role {
  return {
    id, tenantId: "t1", name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
    systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
}
const actor = (userId: string, perms: Permission[]): AuthenticatedUser => ({ userId, tenantId: "t1", email: "a@x", roles: perms }) as AuthenticatedUser;
const admin = actor("admin", ["role.assign", "role.read", "role.update", "role.create", "rolegroup.audit.update"]);
const VALIDATE: Permission[] = ["rolegroup.audit.validate"];

function setup(extraRoles: Role[] = []) {
  const roles = [role("rm", "RISK_MANAGER"), role("co", "RISK_COMMITTEE"), role("au", "AUDIT", ["audit.read"]), ...extraRoles];
  const held = new Map<string, string[]>();
  const changes: RolePermissionChange[] = [];
  const events: Array<{ action: string; entityType: string; reason: string | null }> = [];
  const sent: Array<{ recipientUserId: string; eventType: string }> = [];
  const roleRepo = {
    async getById(_t: string, id: string) { return roles.find((r) => r.id === id) ?? null; },
    async getByName() { return null; },
    async list() { return roles; },
    async create(i: Partial<Role>) { const r = { ...role("new", null), ...i } as Role; roles.push(r); return r; },
    async listForUser(_t: string, u: string) { return roles.filter((r) => (held.get(u) ?? []).includes(r.id)); },
    async listAssignments(_t: string, roleId: string) { return [...held.entries()].filter(([, ids]) => ids.includes(roleId)).map(([userId]) => ({ userId, roleId, revokedAt: null })); },
    async assignToUser(_t: string, roleId: string, userId: string) {
      held.set(userId, [...(held.get(userId) ?? []), roleId]);
      return { id: "a", tenantId: "t1", roleId, userId, grantedBy: "x", grantedAt: new Date(), revokedAt: null };
    },
    async update(_t: string, id: string, input: { permissions?: Permission[] }) {
      const r = roles.find((x) => x.id === id)!;
      if (input.permissions) r.permissions = input.permissions;
      return r;
    },
  };
  const changeRepo = {
    async create(i: { roleId: string; permissions: Permission[]; requestedBy: string; reason?: string | null }) {
      const c: RolePermissionChange = { id: `c${changes.length + 1}`, tenantId: "t1", ...i, status: "PENDING", decidedBy: null, createdAt: new Date(), decidedAt: null };
      changes.push(c);
      return c;
    },
    async getById(_t: string, id: string) { return changes.find((c) => c.id === id) ?? null; },
    async decide(_t: string, id: string, status: "APPROVED" | "REJECTED", by: string) {
      const c = changes.find((x) => x.id === id)!;
      if (c.status !== "PENDING") return false;
      c.status = status; c.decidedBy = by;
      return true;
    },
    async list(_t: string, f: { status?: string }) { return changes.filter((c) => !f.status || c.status === f.status); },
  };
  const users = { async listWithPermission() { return [{ id: "aud1", displayName: "Aud One" }, { id: "com1", displayName: "Com One" }]; } };
  const notifications = { async record(i: { recipientUserId: string; eventType: string }) { sent.push(i); } };
  const audit = { async record(e: { action: string; entityType: string; reason: string | null }) { events.push(e); } };
  const service = new RoleService(roleRepo as never, audit as never, users as never, undefined, changeRepo as never, notifications as never);
  return { service, held, changes, events, sent, roles };
}

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
    return { status: res.status, json: (await res.json().catch(() => null)) as { data?: any } | null };
  } finally {
    server.close();
  }
}

describe("B8bis-02 single source of truth for the fixed groups' rights", () => {
  const up = readFileSync("../database/postgresql/migrations/051_group_permissions.sql", "utf8");
  const fromMigration = (g: string) => {
    const m = up.match(new RegExp(`UPDATE roles SET permissions = ARRAY\\[([^\\]]*)\\]\\s*WHERE system_group = '${g}'`));
    return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  // B-6a: migration 055 adds the riskframework.* rights to the existing groups; the constant = 051 + 055.
  const up55 = readFileSync("../database/postgresql/migrations/055_risk_frameworks.sql", "utf8");
  const addedBy055 = (g: string) => {
    const m = up55.match(new RegExp(`ARRAY\\[([^\\]]*)\\]::text\\[\\]\\)\\)\\s*WHERE system_group (?:= '${g}'|IN \\([^)]*'${g}'[^)]*\\))`));
    return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  it.each(["RISK_MANAGER", "RISK_COMMITTEE", "AUDIT"] as const)("the TS constant for %s equals the list seeded by migration 051 completed by 055", (g) => {
    expect(FIXED_GROUP_PERMISSIONS[g]).toEqual([...fromMigration(g), ...addedBy055(g)]);
    expect(FIXED_GROUP_PERMISSIONS[g].every((p) => ALL_PERMISSIONS.includes(p))).toBe(true);
  });

  it("PostgresTenantRepository.create passes those lists as parameters", () => {
    const src = readFileSync("src/infrastructure/database/postgres/PostgresTenantRepository.ts", "utf8");
    expect(src).toMatch(/FIXED_GROUP_PERMISSIONS\.AUDIT/);
  });

  it("the seeded Audit rights satisfy the Audit whitelist (F-B8b-01)", () => {
    expect(FIXED_GROUP_PERMISSIONS.AUDIT.filter((p) => !isAuditGroupPermission(p))).toEqual([]);
  });
});

describe("F-B8b-01 Audit group whitelist and rolegroup.audit.* placement", () => {
  it("refuses a write / admin permission for the Audit group, accepts reads", async () => {
    const { service } = setup();
    await expect(service.changeAuditGroupPermissions(admin, ["audit.read", "risk.delete"], "r", "motif")).rejects.toThrow(/read-only/);
    await expect(service.changeAuditGroupPermissions(admin, ["rolegroup.audit.update"], "r", "motif")).rejects.toThrow(ValidationError);
    const res = await service.changeAuditGroupPermissions(admin, ["audit.read", "kri.read", "evidence.download", "dashboard.executive", "rolegroup.audit.validate"], "r", "motif");
    expect(res.status).toBe("APPLIED");
  });

  it("rolegroup.audit.* is refused on ordinary roles and on the Risk Manager group; .validate is allowed on the Committee", async () => {
    const { service } = setup([role("plain", null)]);
    await expect(service.create(admin, { name: "X", permissions: ["rolegroup.audit.validate"] }, "r")).rejects.toThrow(/not grantable/);
    await expect(service.update(admin, "plain", { permissions: ["rolegroup.audit.update"] }, "r")).rejects.toThrow(/not grantable/);
    await expect(service.update(admin, "rm", { permissions: ["risk.read", "rolegroup.audit.validate"] }, "r")).rejects.toThrow(/not grantable/);
    await service.update(admin, "co", { permissions: ["risk.read", "rolegroup.audit.validate"] }, "r");
  });
});

describe("F-B8b-02 validator independence, reading, notification, reason", () => {
  async function pending() {
    const s = setup();
    s.held.set("rmadmin", ["rm"]);
    const rmAdmin = actor("rmadmin", admin.roles);
    const res = await s.service.changeAuditGroupPermissions(rmAdmin, ["audit.read", "kri.read"], "r", "  ajout KRI  ");
    if (res.status !== "PENDING") throw new Error("setup");
    return { ...s, rmAdmin, id: res.changeId };
  }

  it("the reason is mandatory (service and route) and stored with the change and the audit row", async () => {
    const s = setup();
    await expect(s.service.changeAuditGroupPermissions(admin, ["audit.read"], "r")).rejects.toThrow(/reason is required/);
    await expect(s.service.changeAuditGroupPermissions(admin, ["audit.read"], "r", "   ")).rejects.toThrow(ValidationError);
    expect((await http(s.service, admin, "PUT", "/roles/audit-group/permissions", { permissions: ["audit.read"] })).status).toBe(400);
    const p = await pending();
    expect(p.changes[0]?.reason).toBe("ajout KRI");
    expect(p.events.at(-1)?.reason).toBe("ajout KRI");
  });

  it("creating a PENDING change notifies the Audit / Committee validators", async () => {
    const p = await pending();
    expect(p.sent.map((n) => n.recipientUserId).sort()).toEqual(["aud1", "com1"]);
    expect(p.sent[0]?.eventType).toBe("AUDIT_RIGHTS_CHANGE_PENDING");
  });

  it("a Risk Manager who is also in the Committee cannot validate; a Committee-only member can", async () => {
    const p = await pending();
    p.held.set("rmco", ["rm", "co"]);
    await expect(p.service.decideAuditPermissionChange(actor("rmco", VALIDATE), p.id, true, "r")).rejects.toThrow(ForbiddenError);
    expect(p.changes[0]?.status).toBe("PENDING");
    p.held.set("co-only", ["co"]);
    await p.service.decideAuditPermissionChange(actor("co-only", VALIDATE), p.id, true, "r");
    expect(p.roles.find((r) => r.id === "au")?.permissions).toEqual(["audit.read", "kri.read"]);
  });

  it("GET /roles/permission-changes shows the before/after to a validator only", async () => {
    const p = await pending();
    const ok = await http(p.service, actor("aud1", VALIDATE), "GET", "/roles/permission-changes?status=PENDING");
    expect(ok.status).toBe(200);
    expect(ok.json?.data).toHaveLength(1);
    expect(ok.json?.data[0]).toMatchObject({ before: ["audit.read"], after: ["audit.read", "kri.read"], added: ["kri.read"], removed: [], reason: "ajout KRI" });
    expect((await http(p.service, actor("nobody", ["role.read"]), "GET", "/roles/permission-changes")).status).toBe(403);
    expect((await http(p.service, actor("aud1", VALIDATE), "GET", "/roles/permission-changes?status=BOGUS")).status).toBe(400);
  });

  it("a failed notification does not undo the PENDING change", async () => {
    const s = setup();
    s.held.set("rmadmin", ["rm"]);
    const broken = { async record() { throw new Error("notif down"); } };
    const svc = new RoleService(
      { async list() { return s.roles; }, async listForUser(_t: string, u: string) { return s.roles.filter((r) => (s.held.get(u) ?? []).includes(r.id)); } } as never,
      { async record() {} } as never,
      { async listWithPermission() { return [{ id: "aud1", displayName: "A" }]; } } as never,
      undefined,
      { async create() { return { id: "c9" }; }, async list() { return []; } } as never,
      broken as never,
    );
    const res = await svc.changeAuditGroupPermissions(actor("rmadmin", admin.roles), ["audit.read"], "r", "motif");
    expect(res).toEqual({ status: "PENDING", changeId: "c9" });
  });
});

describe("F-B8b-03 /roles/grantors server-side guards", () => {
  const withAdmins = () => setup([role("admins", null, ["role.assign"])]);

  it("empty when the caller already holds the permission, and nothing is audited", async () => {
    const s = withAdmins();
    const res = await s.service.listGrantors(actor("u1", ["risk.read"]), "risk.read", "r");
    expect(res.grantors).toEqual([]);
    expect(s.events).toHaveLength(0);
  });

  it.each(["role.assign", "role.update", "rolegroup.audit.validate", "user.create", "audit.read"] as Permission[])(
    "administration / governance permission %s is never 'requestable': empty list, not even audited",
    async (p) => {
      const s = withAdmins();
      s.roles.push(role("carrier", null, [p]));
      const res = await s.service.listGrantors(actor("u1", []), p, "r");
      expect(res.grantors).toEqual([]);
      expect(s.events).toHaveLength(0);
    },
  );

  it("a requestable permission still lists display names, audited once per (user, permission, hour)", async () => {
    const s = withAdmins();
    const a = actor("u1", []);
    expect((await s.service.listGrantors(a, "risk.read", "r1")).grantors).toEqual([{ displayName: "Aud One" }, { displayName: "Com One" }]);
    await s.service.listGrantors(a, "risk.read", "r2");
    expect(s.events.filter((e) => e.action === "READ")).toHaveLength(1);
    await s.service.listGrantors(actor("u2", []), "risk.read", "r3");
    expect(s.events.filter((e) => e.action === "READ")).toHaveLength(2);
  });

  it("the route is limited per user: the 21st call in the window answers 429, another user is unaffected", async () => {
    const s = withAdmins();
    // one app = one limiter store
    const app = express();
    let current = "u1";
    app.use((req, _res, next) => {
      (req as unknown as { user: AuthenticatedUser; requestId: string }).user = actor(current, []);
      (req as unknown as { requestId: string }).requestId = "req";
      next();
    });
    app.use("/roles", rolesRouter(s.service));
    app.use(errorHandler);
    const server = app.listen(0);
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const get = async () => (await fetch(`http://127.0.0.1:${port}/roles/grantors?permission=risk.read`)).status;
      for (let i = 0; i < 20; i++) expect(await get()).toBe(200);
      expect(await get()).toBe(429);
      current = "u2";
      expect(await get()).toBe(200);
    } finally {
      server.close();
    }
  });
});

describe("F-B8b-05 Risk Manager / Audit cumul on effective permissions", () => {
  it("refuses an ordinary role carrying audit.* for a Risk Manager, and the Risk Manager group for a holder of such a role", async () => {
    const { service } = setup([role("auditish", null, ["audit.mission.read"]), role("plain", null, ["kri.read"])]);
    await service.assignToUser(admin, "rm", "u1", "r1", "motif");
    await expect(service.assignToUser(admin, "auditish", "u1", "r2")).rejects.toThrow(/audit permissions/);
    await service.assignToUser(admin, "plain", "u1", "r3"); // an ordinary role stays possible
    await service.assignToUser(admin, "auditish", "u2", "r4");
    await expect(service.assignToUser(admin, "rm", "u2", "r5", "motif")).rejects.toThrow(/audit permissions/);
  });

  it("the Risk Manager and Committee groups cannot be given audit.* by a role update", async () => {
    const { service } = setup();
    await expect(service.update(admin, "rm", { permissions: ["risk.read", "audit.read"] }, "r")).rejects.toThrow(/cannot carry audit/);
    await expect(service.update(admin, "co", { permissions: ["risk.read", "audit.finding.read"] }, "r")).rejects.toThrow(/cannot carry audit/);
  });

  it("the double-membership detection query is shipped for the pre-production check", () => {
    const sql = readFileSync("../docs/security/B8-predeploy-checks.sql", "utf8");
    expect(sql).toMatch(/system_group = 'RISK_MANAGER'/);
    expect(sql).toMatch(/system_group = 'AUDIT'/);
  });
});
