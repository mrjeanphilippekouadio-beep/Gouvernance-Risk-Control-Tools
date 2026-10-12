import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import express from "express";
import { RoleService } from "../src/services/RoleService.js";
import { UserService } from "../src/services/UserService.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { CartographyService } from "../src/services/CartographyService.js";
import { rolesRouter } from "../src/api/v1/roles.routes.js";
import { configRouter } from "../src/api/v1/config.routes.js";
import { cartographyRouter } from "../src/api/v1/cartography.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type { Config, ConfigPatch } from "../src/domain/entities/Config.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA level 2 for B-8 ter / B-8 quater (DECISION-042 q58/q63/q65, DECISION-041).
// A QA PASS only: not a Security, Compliance or Privacy opinion.
// Oracle: INPUT/ACTION/EXPECTED were fixed from the spec comments in src before running.

const T1 = "t1";
type Ev = { entityType: string; action: string; reason: string | null; oldValue: unknown; newValue: unknown };

function role(id: string, systemGroup: SystemGroup | null, permissions: Permission[] = ["risk.read"]): Role {
  return {
    id, tenantId: T1, name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
    systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
}
const actor = (userId: string, perms: Permission[], tenantId = T1): AuthenticatedUser =>
  ({ userId, tenantId, email: `${userId}@x`, roles: perms }) as AuthenticatedUser;
const assigner = actor("admin", ["role.assign", "role.read", "role.update", "user.read"]);

function world(opts: { cumul?: boolean | null; configThrows?: boolean; noNotifier?: boolean; extraRoles?: Role[] } = {}) {
  const roles: Role[] = [
    role("rm", "RISK_MANAGER"), role("co", "RISK_COMMITTEE", ["risk.read", "rolegroup.audit.validate"]), role("au", "AUDIT", ["audit.read", "rolegroup.audit.validate"]),
    role("adm", null, ["role.assign", "user.update"]), role("plain", null), role("plain2", null, ["kri.read"]),
    role("auditish", null, ["audit.mission.read"]), ...(opts.extraRoles ?? []),
  ];
  const held = new Map<string, string[]>();
  const events: Ev[] = [];
  const sent: Array<{ recipientUserId: string; eventType: string; resourceId: string }> = [];
  let inserts = 0;
  const repo = {
    async getById(_t: string, id: string) { return roles.find((r) => r.id === id) ?? null; },
    async listForUser(_t: string, u: string) { return roles.filter((r) => (held.get(u) ?? []).includes(r.id)); },
    async assignToUser(_t: string, roleId: string, userId: string) {
      // faithful to user_roles_active_idx (013): one active (user, role) pair
      if ((held.get(userId) ?? []).includes(roleId)) throw Object.assign(new Error("duplicate key"), { code: "23505" });
      inserts++;
      held.set(userId, [...(held.get(userId) ?? []), roleId]);
      return { id: `a${inserts}`, tenantId: T1, roleId, userId, grantedBy: "x", grantedAt: new Date(), revokedAt: null };
    },
    async revokeFromUser(_t: string, roleId: string, userId: string) {
      held.set(userId, (held.get(userId) ?? []).filter((r) => r !== roleId));
    },
    async countActiveAssignments() { return 99; },
    async listAssignments(_t: string, roleId: string) {
      return [...held.entries()].filter(([, ids]) => ids.includes(roleId)).map(([userId]) => ({ userId, roleId, revokedAt: null }));
    },
    async update(_t: string, id: string, input: { permissions?: Permission[] }) {
      const r = roles.find((x) => x.id === id)!;
      if (input.permissions) r.permissions = input.permissions;
      return r;
    },
  };
  const users = {
    // faithful to PostgresUserRepository.listWithPermission: holders of the permission through an active role, minus excludeUserId
    async listWithPermission(_t: string, permission: string, excludeUserId: string) {
      return [...held.entries()]
        .filter(([u, ids]) => u !== excludeUserId && roles.some((r) => ids.includes(r.id) && r.permissions.includes(permission as Permission)))
        .map(([u]) => ({ id: u, displayName: u }));
    },
  };
  const notifications = opts.noNotifier ? undefined : { async record(i: { recipientUserId: string; eventType: string; resourceId: string }) { sent.push(i); } };
  const audit = { async record(e: Ev) { events.push(e); } };
  const stored: Config[] = [];
  const configRepo = {
    async getByTenant() {
      if (opts.configThrows) throw new Error("db down");
      if (opts.cumul === null || opts.cumul === undefined) return stored[0] ?? null;
      return { committeeAuditCumulAllowed: opts.cumul } as Config;
    },
    async upsert(_t: string, patch: ConfigPatch) {
      stored[0] = { id: "c1", committeeAuditCumulAllowed: true, version: (stored[0]?.version ?? 0) + 1, ...stored[0], ...patch } as Config;
      stored[0].version = (stored[0].version ?? 0);
      return stored[0];
    },
  };
  const service = new RoleService(repo as never, audit as never, users as never, undefined, undefined, notifications as never, configRepo as never);
  const configService = new ConfigService(configRepo as never, audit as never);
  return { service, configService, configRepo, held, events, sent, roles, stored, inserts: () => inserts };
}

async function serve(mount: (app: express.Express) => void, user: AuthenticatedUser, method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: AuthenticatedUser; requestId: string }).user = user;
    (req as unknown as { requestId: string }).requestId = "req";
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

// ---------------------------------------------------------------- q58
describe("q58 Committee + Audit cumul setting: edge cases", () => {
  it("setting true -> false -> true on the same tenant: refused, then allowed again (real ConfigService + RoleService)", async () => {
    const w = world({ cumul: null });
    const cfgActor = actor("cfg", ["config.read", "config.cumul.set"]);
    await w.service.assignToUser(assigner, "co", "u1", "r", "motif");
    await w.configService.setCommitteeAuditCumul(cfgActor, false, "politique", "r");
    await expect(w.service.assignToUser(assigner, "au", "u1", "r", "motif")).rejects.toThrow(ValidationError);
    await w.configService.setCommitteeAuditCumul(cfgActor, true, "revue", "r");
    await expect(w.service.assignToUser(assigner, "au", "u1", "r", "motif")).resolves.toBeUndefined();
  });

  it("a refusal leaves no assignment, no audit row, no notification", async () => {
    const w = world({ cumul: false });
    await w.service.assignToUser(assigner, "au", "u1", "r", "motif");
    const eventsBefore = w.events.length;
    const sentBefore = w.sent.length;
    await expect(w.service.assignToUser(assigner, "co", "u1", "r", "motif")).rejects.toThrow(/setting of this tenant/);
    expect(w.held.get("u1")).toEqual(["au"]);
    expect(w.events).toHaveLength(eventsBefore);
    expect(w.sent).toHaveLength(sentBefore);
  });

  it("forbidding the cumul does not touch existing double members: they can still receive other roles (pinned behaviour, documented in ConfigService)", async () => {
    const w = world({ cumul: true });
    await w.service.assignToUser(assigner, "co", "u1", "r", "motif");
    await w.service.assignToUser(assigner, "au", "u1", "r", "motif");
    const forbidding = world({ cumul: false });
    forbidding.held.set("u1", ["co", "au"]);
    await expect(forbidding.service.assignToUser(assigner, "plain", "u1", "r")).resolves.toBeUndefined();
  });

  it("the setting does not apply to non-group roles; Committee + Risk Manager is refused regardless (q94)", async () => {
    const w = world({ cumul: false });
    await w.service.assignToUser(assigner, "co", "u1", "r", "motif");
    await expect(w.service.assignToUser(assigner, "plain", "u1", "r")).resolves.toBeUndefined();
    await expect(w.service.assignToUser(assigner, "rm", "u1", "r", "motif")).rejects.toThrow(ValidationError);
  });

  it("fails closed when the config read fails: error propagates, nothing is assigned", async () => {
    const w = world({ configThrows: true });
    w.held.set("u1", ["co"]);
    await expect(w.service.assignToUser(assigner, "au", "u1", "r", "motif")).rejects.toThrow("db down");
    expect(w.held.get("u1")).toEqual(["co"]);
  });

  it("the config is only read when a Committee/Audit pair is at stake (no needless dependency on it)", async () => {
    const w = world({ configThrows: true });
    await expect(w.service.assignToUser(assigner, "plain", "u1", "r")).resolves.toBeUndefined();
    await expect(w.service.assignToUser(assigner, "co", "u2", "r", "motif")).resolves.toBeUndefined();
  });

  it("is per tenant: the setting is read with actor.tenantId", async () => {
    const asked: string[] = [];
    const w = world();
    const svc = new RoleService(
      { async getById(_t: string, id: string) { return w.roles.find((r) => r.id === id) ?? null; }, async listForUser() { return [w.roles.find((r) => r.id === "co")!]; }, async assignToUser() { return { id: "a" }; } } as never,
      { async record() {} } as never, undefined, undefined, undefined, undefined,
      { async getByTenant(t: string) { asked.push(t); return { committeeAuditCumulAllowed: t !== "tenant-forbids" } as Config; } } as never,
    );
    await expect(svc.assignToUser(actor("a", ["role.assign", "role.read"], "tenant-forbids"), "au", "u1", "r", "motif")).rejects.toThrow(ValidationError);
    await expect(svc.assignToUser(actor("a", ["role.assign", "role.read"], "tenant-ok"), "au", "u1", "r", "motif")).resolves.toBeUndefined();
    expect(asked).toEqual(["tenant-forbids", "tenant-ok"]);
  });

  it("FIXED (B-8 quinquies) q58-01 (MAJOR): the forbid setting is bypassed by an ordinary role carrying audit.* given to a Committee member", async () => {
    // EXPECTED: with the cumul forbidden, a Committee member cannot get effective audit permissions
    // (the Risk Manager + Audit rule already looks at effective audit.*, F-B8b-05; the q58 check looks only at systemGroup).
    const w = world({ cumul: false });
    await w.service.assignToUser(assigner, "co", "u1", "r", "motif");
    await expect(w.service.assignToUser(assigner, "auditish", "u1", "r")).rejects.toThrow(ValidationError);
  });
  it("FIXED (B-8 quinquies) q58-01 (MAJOR): same bypass in the other order (ordinary audit.* role first, then the Committee group)", async () => {
    const w = world({ cumul: false });
    await w.service.assignToUser(assigner, "auditish", "u1", "r");
    await expect(w.service.assignToUser(assigner, "co", "u1", "r", "motif")).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------- PUT /config/committee-audit-cumul
describe("PUT /config/committee-audit-cumul over HTTP", () => {
  const cfg = actor("cfg", ["config.read", "config.cumul.set"]);
  const put = (w: ReturnType<typeof world>, user: AuthenticatedUser, body: unknown) =>
    serve((app) => app.use("/config", configRouter(w.configService)), user, "PUT", "/config/committee-audit-cumul", body);

  it.each([
    ["allowed as string", { allowed: "false", reason: "r" }],
    ["allowed null", { allowed: null, reason: "r" }],
    ["allowed 0", { allowed: 0, reason: "r" }],
    ["allowed missing", { reason: "r" }],
    ["reason missing", { allowed: false }],
    ["reason empty", { allowed: false, reason: "" }],
    ["reason null", { allowed: false, reason: null }],
    ["reason number", { allowed: false, reason: 5 }],
    ["reason 501 chars", { allowed: false, reason: "x".repeat(501) }],
    ["reason spaces only (service)", { allowed: false, reason: "   " }],
  ])("400 for %s, and nothing stored", async (_n, body) => {
    const w = world({ cumul: null });
    const res = await put(w, cfg, body);
    expect(res.status).toBe(400);
    expect(w.stored).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });

  it("accepts a 500-char reason, stores before/after in the audit, returns the new flag", async () => {
    const w = world({ cumul: null });
    const res = await put(w, cfg, { allowed: false, reason: "x".repeat(500), unexpected: 1 });
    expect(res.status).toBe(200);
    expect(res.json?.data.committeeAuditCumulAllowed).toBe(false);
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ entityType: "Config", action: "UPDATE" });
    expect((w.events[0]!.oldValue as Config).committeeAuditCumulAllowed).toBe(true);
    expect((w.events[0]!.newValue as Config).committeeAuditCumulAllowed).toBe(false);
  });

  it.each([
    ["config.update", ["config.read", "config.update"]],
    ["config.committeeenforcement.set", ["config.read", "config.committeeenforcement.set"]],
    ["config.manage", ["config.read", "config.manage"]],
    ["no permission", []],
  ] as Array<[string, Permission[]]>)("403 with %s only (dedicated permission)", async (_n, perms) => {
    const w = world({ cumul: null });
    expect((await put(w, actor("u", perms), { allowed: false, reason: "r" })).status).toBe(403);
    expect(w.stored).toHaveLength(0);
  });

  it("403 with config.cumul.set but without config.read (the handler reads the current config first; same as the sibling setCommitteeEnforcement)", async () => {
    const w = world({ cumul: null });
    expect((await put(w, actor("u", ["config.cumul.set"]), { allowed: false, reason: "r" })).status).toBe(403);
  });

  it("the other PUT /config/* endpoints cannot flip the flag (zod strips the field)", async () => {
    const w = world({ cumul: null });
    const mount = (app: express.Express) => app.use("/config", configRouter(w.configService));
    const admin = actor("a", ["config.read", "config.update", "config.committeethreshold.set", "config.committeeenforcement.set"]);
    for (const [path, body] of [
      ["/config/methodology", { reason: "r", committeeAuditCumulAllowed: false }],
      ["/config/appetite-mode", { mode: "AUTO", reason: "r", committeeAuditCumulAllowed: false }],
      ["/config/evaluation-mode", { mode: "CLASSIQUE", reason: "r", committeeAuditCumulAllowed: false }],
      ["/config/committee-enforcement", { enforced: true, reason: "r", committeeAuditCumulAllowed: false }],
    ] as const) {
      await serve(mount, admin, "PUT", path, body);
    }
    expect(w.stored.every((c) => c.committeeAuditCumulAllowed === true)).toBe(true);
  });

  it("setting the same value twice is not a no-op: two audit rows (pinned, no idempotence short-circuit)", async () => {
    const w = world({ cumul: null });
    await put(w, cfg, { allowed: true, reason: "a" });
    await put(w, cfg, { allowed: true, reason: "b" });
    expect(w.events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- q63
describe("q63 administrator + Risk Manager cumul: edge cases", () => {
  it("reason bounds: 500 accepted and stored trimmed, 501 refused with no side effect, spaces refused", async () => {
    const w = world();
    await w.service.assignToUser(assigner, "rm", "u1", "r", "motif");
    await expect(w.service.assignToUser(assigner, "adm", "u1", "r", "x".repeat(501))).rejects.toThrow(/at most 500/);
    await expect(w.service.assignToUser(assigner, "adm", "u1", "r", "   ")).rejects.toThrow(ValidationError);
    expect(w.held.get("u1")).toEqual(["rm"]);
    expect(w.sent).toHaveLength(0);
    await w.service.assignToUser(assigner, "adm", "u1", "r", `  ${"y".repeat(498)}  `);
    expect(w.events.at(-1)!.reason).toBe("y".repeat(498));
  });

  it.each(["role.create", "role.update", "role.delete", "role.assign", "user.create", "user.update", "user.delete", "user.reactivate", "rolegroup.audit.update"] as Permission[])(
    "%s is an administrator permission: reason required, notification sent",
    async (p) => {
      const w = world({ extraRoles: [role("carrier", null, [p])] });
      w.held.set("aud", ["au"]);
      w.held.set("u1", ["rm"]);
      await expect(w.service.assignToUser(assigner, "carrier", "u1", "r")).rejects.toThrow(/reason is required/);
      await w.service.assignToUser(assigner, "carrier", "u1", "r", "motif");
      expect(w.sent.map((s) => s.eventType)).toContain("ADMIN_RISK_MANAGER_CUMUL");
    },
  );

  it.each(["role.read", "user.read", "config.update", "config.read", "risk.read", "audit.read"] as Permission[])(
    "%s alone does not make an administrator (no reason, no notification) for a Risk Manager",
    async (p) => {
      if (p === "audit.read") return; // refused by the RM + Audit rule, covered elsewhere
      const w = world({ extraRoles: [role("carrier", null, [p])] });
      w.held.set("u1", ["rm"]);
      await w.service.assignToUser(assigner, "carrier", "u1", "r");
      expect(w.sent).toHaveLength(0);
    },
  );

  it("already admin + RM: another admin role needs no reason and does not re-notify", async () => {
    const w = world({ extraRoles: [role("adm2", null, ["user.delete"])] });
    w.held.set("aud", ["au"]);
    await w.service.assignToUser(assigner, "rm", "u1", "r", "motif");
    await w.service.assignToUser(assigner, "adm", "u1", "r", "motif");
    expect(w.sent.filter((s) => s.eventType === "ADMIN_RISK_MANAGER_CUMUL")).toHaveLength(1);
    await w.service.assignToUser(assigner, "adm2", "u1", "r");
    expect(w.sent.filter((s) => s.eventType === "ADMIN_RISK_MANAGER_CUMUL")).toHaveLength(1);
  });

  it("revoking the admin role then assigning it again re-creates the cumul: reason required and notified again", async () => {
    const w = world();
    w.held.set("aud", ["au"]);
    await w.service.assignToUser(assigner, "rm", "u1", "r", "motif");
    await w.service.assignToUser(assigner, "adm", "u1", "r", "motif");
    await w.service.revokeFromUser(assigner, "adm", "u1", "r");
    expect(await w.service.isAdminAndRiskManager(T1, "u1")).toBe(false);
    await expect(w.service.assignToUser(assigner, "adm", "u1", "r")).rejects.toThrow(/reason is required/);
    await w.service.assignToUser(assigner, "adm", "u1", "r", "retour");
    expect(w.sent.filter((s) => s.eventType === "ADMIN_RISK_MANAGER_CUMUL")).toHaveLength(2);
  });

  it("recipients are Audit/Committee validators only: not the person concerned, not the assigning actor, none when nobody validates", async () => {
    const w = world();
    w.held.set("aud", ["au"]);
    w.held.set("com", ["co"]);
    w.held.set("admin", ["au"]); // the assigner also holds a validator role: excluded
    w.held.set("u1", ["rm"]);
    await w.service.assignToUser(assigner, "adm", "u1", "r", "motif");
    expect(w.sent.map((s) => s.recipientUserId).sort()).toEqual(["aud", "com"]);
    expect(w.sent.every((s) => s.resourceId === "u1")).toBe(true);

    const empty = world();
    empty.held.set("u2", ["rm"]);
    await expect(empty.service.assignToUser(assigner, "adm", "u2", "r", "motif")).resolves.toBeUndefined();
    expect(empty.sent).toHaveLength(0);
  });

  it("works without a notifier wired, and a notifier failure does not undo the assignment nor skip the audit row", async () => {
    const none = world({ noNotifier: true });
    none.held.set("u1", ["rm"]);
    await expect(none.service.assignToUser(assigner, "adm", "u1", "r", "motif")).resolves.toBeUndefined();

    const w = world();
    w.held.set("aud", ["au"]);
    w.held.set("u1", ["rm"]);
    (w.service as unknown as { notifications: unknown }).notifications = { async record() { throw new Error("down"); } };
    await w.service.assignToUser(assigner, "adm", "u1", "r", "motif");
    expect(w.held.get("u1")).toEqual(["rm", "adm"]);
    expect(w.events.at(-1)).toMatchObject({ action: "ROLE_CHANGE", reason: "motif" });
  });

  it("the audit row of the assignment carries the cumul reason", async () => {
    const w = world();
    w.held.set("u1", ["rm"]);
    await w.service.assignToUser(assigner, "adm", "u1", "r", "continuite");
    expect(w.events.at(-1)!.reason).toBe("continuite");
  });

  it("cumul + Committee entry together: both notifications, to their own audiences", async () => {
    const w = world({ extraRoles: [role("coadm", "RISK_COMMITTEE", ["role.assign"])] });
    w.held.set("aud", ["au"]);
    // q94: u1 can no longer be a Risk Manager entering the Committee; q80: administrator + Committee uses the same notification
    await w.service.assignToUser(assigner, "coadm", "u1", "r", "motif");
    expect(w.sent.map((s) => `${s.eventType}:${s.recipientUserId}`).sort()).toEqual(["ADMIN_RISK_MANAGER_CUMUL:aud", "COMMITTEE_MEMBER_ADDED:aud"]);
  });

  it("maker-checker still wins first: self-assignment is refused before any cumul logic", async () => {
    const w = world();
    w.held.set("admin", ["rm"]);
    await expect(w.service.assignToUser(assigner, "adm", "admin", "r", "motif")).rejects.toThrow(/yourself/);
    expect(w.sent).toHaveLength(0);
  });

  it("UserService.getDetail exposes administratorAndRiskManager (true / false / false without RoleService)", async () => {
    const w = world();
    w.held.set("u1", ["rm", "adm"]);
    w.held.set("u2", ["rm"]);
    const user = (id: string) => ({ id, tenantId: T1, email: `${id}@x`, displayName: id, roles: [], departmentId: null, createdAt: new Date(), deletedAt: null });
    const repo = { async getById(_t: string, id: string) { return user(id); } };
    const svc = new UserService(repo as never, { async record() {} } as never, w.service);
    const reader = actor("r", ["user.read"]);
    expect((await svc.getDetail(reader, "u1")).administratorAndRiskManager).toBe(true);
    expect((await svc.getDetail(reader, "u2")).administratorAndRiskManager).toBe(false);
    expect((await new UserService(repo as never, { async record() {} } as never).getDetail(reader, "u1")).administratorAndRiskManager).toBe(false);
  });

  it("UserService.create with an admin initial role runs the q63 check BEFORE inserting the user (no orphan) for a refused cumul reason", async () => {
    // a new user holds no role yet, so no cumul is possible at creation; the check must still not break creation
    const w = world();
    const created: string[] = [];
    const users = {
      async create(i: { email: string }) { created.push(i.email); return { id: "new", tenantId: T1, email: i.email, displayName: "n", roles: [], departmentId: null, createdAt: new Date(), deletedAt: null }; },
      async listWithPermission() { return []; },
    };
    const svc = new UserService(users as never, { async record() {} } as never, w.service);
    await svc.create(actor("admin", ["user.create", "role.assign", "role.read"]), { email: "n@x.io", displayName: "N", roleId: "adm" } as never, "r");
    expect(created).toEqual(["n@x.io"]);
    expect(w.held.get("new")).toEqual(["adm"]);
  });

  it("FIXED (B-8 quinquies) q63-02 (MINOR): a role carrying only config.cumul.set (settings administrator, documented as an application-administrator right) is not counted: Risk Manager + that role needs no reason", async () => {
    const w = world({ extraRoles: [role("cfgadm", null, ["config.cumul.set"])] });
    w.held.set("u1", ["rm"]);
    await expect(w.service.assignToUser(assigner, "cfgadm", "u1", "r")).rejects.toThrow(/reason is required/);
  });

  it("FIXED (B-8 quinquies) q63-01 (known limit, MAJOR): RoleService.update adding an admin permission to a role held by a Risk Manager creates the cumul with no reason and no notification", async () => {
    const w = world();
    w.held.set("aud", ["au"]);
    w.held.set("u1", ["rm", "plain"]);
    await w.service.update(assigner, "plain", { permissions: ["role.assign"] }, "r").catch(() => undefined);
    expect(await w.service.isAdminAndRiskManager(T1, "u1")).toBe(false); // expected: the update is refused or the cumul is justified/notified
  });
});

// ---------------------------------------------------------------- q65 + duplicates
describe("q65 Committee entry notification: edge cases", () => {
  it("recipients are audit.read holders minus the target and the actor; none when nobody reads audit", async () => {
    const w = world();
    w.held.set("aud", ["au"]);
    w.held.set("admin", ["au"]);
    w.held.set("u1", ["au"]); // the target is also an auditor (Committee + Audit allowed by default)
    await w.service.assignToUser(assigner, "co", "u1", "r", "motif");
    expect(w.sent.map((s) => s.recipientUserId)).toEqual(["aud"]);
    expect(w.sent[0]).toMatchObject({ eventType: "COMMITTEE_MEMBER_ADDED", resourceId: "u1" });

    const empty = world();
    await expect(empty.service.assignToUser(assigner, "co", "u9", "r", "motif")).resolves.toBeUndefined();
    expect(empty.sent).toHaveLength(0);
  });

  it("is not sent when the Committee assignment is refused (cumul forbidden)", async () => {
    const w = world({ cumul: false });
    w.held.set("aud", ["au"]);
    w.held.set("u1", ["au"]);
    await expect(w.service.assignToUser(assigner, "co", "u1", "r", "motif")).rejects.toThrow(ValidationError);
    expect(w.sent).toHaveLength(0);
  });

  it("is not sent for Audit or Risk Manager entry, nor for an ordinary role", async () => {
    const w = world();
    w.held.set("aud", ["au"]);
    for (const [id, r] of [["u1", "au"], ["u2", "rm"], ["u3", "plain"]] as const) await w.service.assignToUser(assigner, r, id, "r", "motif");
    expect(w.sent).toHaveLength(0);
  });

  it("re-assigning a group the user already holds sends no second notification", async () => {
    const w = world();
    w.held.set("aud", ["au"]);
    await w.service.assignToUser(assigner, "co", "u1", "r", "motif");
    await w.service.assignToUser(assigner, "co", "u1", "r", "motif").catch(() => undefined);
    expect(w.sent).toHaveLength(1);
  });

  it("FIXED (B-8 quinquies) q65-01 (MINOR, pre-existing): assigning a role the user already holds surfaces the raw unique violation as HTTP 500 (expected 4xx)", async () => {
    const w = world();
    await w.service.assignToUser(assigner, "plain", "u1", "r");
    const res = await serve((app) => app.use("/roles", rolesRouter(w.service)), assigner, "POST", "/roles/plain/assign", { userId: "u1" });
    expect(res.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------- DECISION-041 scale
describe("GET /cartography/scale", () => {
  const scale = (over: Record<string, unknown>) => ({
    id: "s1", tenantId: T1, name: "E", version: "v1", status: "ACTIVE", probabilityLevels: 5, impactLevels: 5,
    criticalityThresholds: null, ...over,
  });
  const make = (scales: Array<Record<string, unknown>>) =>
    new CartographyService({} as never, {} as never, { async list(t: string) { return scales.filter((s) => s["tenantId"] === t); } } as never);
  const get = (svc: CartographyService, user: AuthenticatedUser) =>
    serve((app) => app.use("/cartography", cartographyRouter(svc)), user, "GET", "/cartography/scale");
  const reader = actor("u", ["cartography.read"]);

  it("HTTP: 200 {data: null} without an active scale; 403 without permission; 200 with the scale", async () => {
    expect(await get(make([scale({ status: "DRAFT" }), scale({ id: "s2", status: "ARCHIVED" })]), reader)).toMatchObject({ status: 200, json: { data: null } });
    expect((await get(make([scale({})]), actor("u", []))).status).toBe(403);
    const ok = await get(make([scale({})]), reader);
    expect(ok.status).toBe(200);
    expect(ok.json?.data).toMatchObject({ scaleId: "s1", size: 5, maxScore: 25, bandsSource: "DEFAULT" });
  });

  it("is not shadowed by another cartography route (does not answer with the heatmap shape)", async () => {
    const res = await get(make([scale({})]), reader);
    expect(res.json?.data).not.toHaveProperty("points");
    expect(res.json?.data).toHaveProperty("bands");
  });

  it("tenant isolation: another tenant's active scale is never served", async () => {
    const svc = make([scale({ tenantId: "other" })]);
    expect(await svc.getActiveScale(reader)).toBeNull();
    expect(await svc.getActiveScale(actor("u", ["cartography.read"], "other"))).toMatchObject({ scaleId: "s1" });
  });

  it("no rating-scale repository wired -> null (no crash)", async () => {
    expect(await new CartographyService({} as never, {} as never).getActiveScale(reader)).toBeNull();
  });

  it.each([3, 4, 5, 6])("default bands for a %i x %i scale are contiguous, start at 1 and end at n²", async (n) => {
    const res = (await make([scale({ probabilityLevels: n, impactLevels: n })]).getActiveScale(reader))!;
    expect(res.size).toBe(n);
    expect(res.maxScore).toBe(n * n);
    expect(res.bands[0]!.min).toBe(1);
    expect(res.bands.at(-1)!.max).toBe(n * n);
    res.bands.slice(1).forEach((b, i) => expect(b.min).toBe(res.bands[i]!.max + 1));
    expect(res.bands.every((b) => b.min <= b.max)).toBe(true);
  });

  it("legacy P != I scale: size null, maxScore P x I, bands cover 1..P x I", async () => {
    const res = (await make([scale({ probabilityLevels: 5, impactLevels: 3 })]).getActiveScale(reader))!;
    expect(res).toMatchObject({ size: null, probabilityLevels: 5, impactLevels: 3, maxScore: 15 });
    expect(res.bands[0]!.min).toBe(1);
    expect(res.bands.at(-1)!.max).toBe(15);
  });

  it("an empty configured array falls back to the default bands (DEFAULT), configured bands are returned untouched (CONFIGURED)", async () => {
    expect((await make([scale({ criticalityThresholds: [] })]).getActiveScale(reader))!.bandsSource).toBe("DEFAULT");
    const bands = [{ label: "A", min: 1, max: 25 }];
    expect(await make([scale({ criticalityThresholds: bands })]).getActiveScale(reader)).toMatchObject({ bandsSource: "CONFIGURED", bands });
  });
});

// ---------------------------------------------------------------- B-8 ter / 054 static
describe("migration 054 and persistence mapping (static; nothing is applied)", () => {
  const up = readFileSync("../database/postgresql/migrations/054_committee_audit_cumul.sql", "utf8");
  const down = readFileSync("../database/postgresql/migrations/054_committee_audit_cumul.down.sql", "utf8");
  it("up adds a NOT NULL boolean defaulting to true (current behaviour preserved)", () => {
    expect(up).toMatch(/ADD COLUMN committee_audit_cumul_allowed boolean NOT NULL DEFAULT true/);
  });
  it("down is one transaction, drops the column, purges schema_migrations", () => {
    expect(down).toMatch(/BEGIN;[\s\S]*DROP COLUMN committee_audit_cumul_allowed[\s\S]*DELETE FROM schema_migrations WHERE filename = '054_committee_audit_cumul.sql'[\s\S]*COMMIT;/);
  });
  it("PostgresConfigRepository reads and writes the column", () => {
    const src = readFileSync("src/infrastructure/database/postgres/PostgresConfigRepository.ts", "utf8");
    expect(src).toMatch(/committeeAuditCumulAllowed: row\.committee_audit_cumul_allowed/);
    expect(src).toMatch(/committee_audit_cumul_allowed: patch\.committeeAuditCumulAllowed/);
  });
  it("053 and 054 are consecutive (no gap, no reuse)", () => {
    const nums = readdirSync("../database/postgresql/migrations").filter((f) => /^\d+_.*(?<!\.down)\.sql$/.test(f)).map((f) => Number(f.slice(0, 3))).sort((a, b) => a - b);
    // B-6a added 055: the tail must stay gap-free from 53 on (no gap, no reuse).
    expect(nums.at(-1)).toBeGreaterThanOrEqual(54);
    // observation: two migrations share the number 044 (pre-existing, applied by filename so harmless); none after it.
    const recent = nums.filter((n) => n > 44);
    expect(new Set(recent).size).toBe(recent.length);
    expect(nums.slice(nums.indexOf(53)).map((n, i) => n - 53 - i)).toEqual(nums.slice(nums.indexOf(53)).map(() => 0));
  });
});
