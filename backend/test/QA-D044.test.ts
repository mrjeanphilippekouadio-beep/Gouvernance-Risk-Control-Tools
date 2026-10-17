import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { RoleService } from "../src/services/RoleService.js";
import { UserService } from "../src/services/UserService.js";
import { NotificationService } from "../src/services/NotificationService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { NOTIFICATION_CATALOG } from "../src/domain/notificationCatalog.js";
import { ALL_PERMISSIONS, type Permission } from "../src/domain/permissions.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type { Notification } from "../src/domain/entities/Notification.js";
import type { NotificationSubscription } from "../src/domain/entities/NotificationSubscription.js";
import type { ActionPlan } from "../src/domain/entities/ActionPlan.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA level 2 for DECISION-044 (q79, q80, q84, q85, q94, q95). QA PASS only: not a Security/Compliance/Privacy opinion.
// Oracle fixed from the decision text + the spec comments in src before running.

const T1 = "t1";
const role = (id: string, systemGroup: SystemGroup | null, permissions: Permission[] = ["risk.read"]): Role => ({
  id, tenantId: T1, name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
  systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
});
const actor = (userId: string, perms: Permission[], tenantId = T1) => ({ userId, tenantId, email: `${userId}@x`, roles: perms }) as AuthenticatedUser;
const assigner = actor("admin", ["role.assign", "role.read", "role.update", "user.read", "user.reactivate"]);

// ------------------------------------------------------------------ RBAC world

type Sent = { recipientUserId: string; eventType: string; message: string };
function rbac(extra: Role[] = []) {
  const roles: Role[] = [
    role("rm", "RISK_MANAGER"), role("co", "RISK_COMMITTEE", ["risk.read", "rolegroup.audit.validate"]),
    role("au", "AUDIT", ["audit.read", "rolegroup.audit.validate"]),
    role("plain", null), role("client", null, ["config.manage"]), role("method", null, ["config.update"]),
    role("filler", null, ["kri.read"]), ...extra,
  ];
  const held = new Map<string, string[]>();
  const sent: Sent[] = [];
  const events: Array<{ action: string; reason: string | null; entityType: string }> = [];
  const calls = { listForUser: [] as string[], reactivate: 0 };
  let listThrows = false;
  const repo = {
    async getById(_t: string, id: string) { return roles.find((r) => r.id === id) ?? null; },
    async listForUser(t: string, u: string) {
      calls.listForUser.push(`${t}/${u}`);
      if (listThrows) throw new Error("roles down");
      return roles.filter((r) => (held.get(u) ?? []).includes(r.id));
    },
    async assignToUser(_t: string, roleId: string, userId: string) {
      held.set(userId, [...(held.get(userId) ?? []), roleId]);
      return { id: "a", tenantId: T1, roleId, userId, grantedBy: "x", grantedAt: new Date(), revokedAt: null };
    },
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
    async listWithPermission(_t: string, perm: string, exclude: string) {
      return [...held.entries()]
        .filter(([u, ids]) => u !== exclude && roles.some((r) => ids.includes(r.id) && r.permissions.includes(perm as Permission)))
        .map(([u]) => ({ id: u, displayName: u }));
    },
    async getById(_t: string, id: string) {
      return { id, tenantId: T1, email: "e", displayName: id, roles: [], departmentId: null, createdAt: new Date(), deletedAt: id.startsWith("live") ? null : new Date() };
    },
    async reactivate() { calls.reactivate++; },
  };
  const notifications = { async record(i: Sent) { sent.push(i); } };
  const audit = { async record(e: { action: string; reason: string | null; entityType: string }) { events.push(e); } };
  const service = new RoleService(repo as never, audit as never, users as never, undefined, undefined, notifications as never);
  const userService = new UserService(users as never, audit as never, service);
  return { service, userService, held, sent, events, roles, calls, breakRoles: () => { listThrows = true; } };
}
const validators = (w: ReturnType<typeof rbac>) => { w.held.set("val", ["co"]); };
const cumulMsgs = (w: ReturnType<typeof rbac>) => w.sent.filter((s) => s.eventType === "ADMIN_RISK_MANAGER_CUMUL");

describe("QA-D044 q94: widening a role (cumul replayed for each holder)", () => {
  it("adding an admin permission to a role held by a Committee member needs a reason, leaves the role untouched on refusal, notifies once with the Committee wording", async () => {
    const w = rbac(); validators(w);
    w.held.set("c1", ["co", "plain"]);
    await expect(w.service.update(assigner, "plain", { permissions: ["role.assign"] }, "r")).rejects.toThrow(/Committee member/);
    expect(w.roles.find((r) => r.id === "plain")!.permissions).toEqual(["risk.read"]);
    expect(w.sent).toEqual([]);
    expect(w.events).toEqual([]);
    await w.service.update(assigner, "plain", { permissions: ["role.assign"] }, "r", "  continuité  ");
    expect(w.events.at(-1)).toMatchObject({ action: "PERMISSION_CHANGE", reason: "continuité" });
    const m = cumulMsgs(w);
    expect(m.map((x) => x.recipientUserId)).toEqual(["val"]);
    expect(m[0]!.message).toMatch(/Comité/);
  });

  it("same role held by an RM member and a Committee member: both wordings, one reason, validators told for each", async () => {
    const w = rbac(); validators(w);
    w.held.set("r1", ["rm", "plain"]);
    w.held.set("c1", ["co", "plain"]);
    await expect(w.service.update(assigner, "plain", { permissions: ["role.assign"] }, "r")).rejects.toThrow(ValidationError);
    await w.service.update(assigner, "plain", { permissions: ["role.assign"] }, "r", "motif");
    const msgs = cumulMsgs(w).map((x) => (/Comité/.test(x.message) ? "COMMITTEE" : "RM")).sort();
    expect([...new Set(msgs)]).toEqual(["COMMITTEE", "RM"]); // validators = every holder of rolegroup.audit.validate except the user concerned (other Committee members too)
  });

  it("a holder ALREADY administrator + Committee: widening with another admin permission needs no reason, notifies nobody", async () => {
    const w = rbac(); validators(w);
    w.held.set("c1", ["co", "plain", "client"]);
    await w.service.update(assigner, "plain", { permissions: ["role.assign"] }, "r");
    expect(cumulMsgs(w)).toEqual([]);
  });

  it("widening the Committee group itself with an admin permission: every holder becomes admin + Committee, reason required", async () => {
    const w = rbac(); validators(w);
    w.held.set("c1", ["co"]);
    const perms: Permission[] = ["risk.read", "rolegroup.audit.validate", "user.update"];
    await expect(w.service.update(assigner, "co", { permissions: perms }, "r")).rejects.toThrow(/Committee member/);
    await w.service.update(assigner, "co", { permissions: perms }, "r", "motif");
    expect(cumulMsgs(w).map((m) => m.recipientUserId).sort()).toEqual(["c1", "val"]); // both holders flagged, each told to the other validator
  });

  it("narrowing never replays the cumul rules (no reason needed)", async () => {
    const w = rbac([role("two", null, ["risk.read", "config.manage"])]);
    w.held.set("c1", ["co", "two"]);
    await expect(w.service.update(assigner, "two", { permissions: ["risk.read"] }, "r")).resolves.toBeTruthy();
  });

  it("PINNED: with a pre-existing RM + Committee holder, ANY widening of the RM or Committee group is refused; an unrelated plain role is not blocked, but adding audit.* to it is", async () => {
    const w = rbac();
    w.held.set("old", ["rm", "co", "plain"]);
    await expect(w.service.update(assigner, "rm", { permissions: ["risk.read", "kri.read"] }, "r")).rejects.toThrow(ValidationError);
    await expect(w.service.update(assigner, "co", { permissions: ["risk.read", "rolegroup.audit.validate", "kri.read"] }, "r")).rejects.toThrow(ValidationError);
    await expect(w.service.update(assigner, "plain", { permissions: ["risk.read", "kri.read"] }, "r")).resolves.toBeTruthy();
    await expect(w.service.update(assigner, "plain", { permissions: ["risk.read", "audit.read"] }, "r")).rejects.toThrow(ValidationError);
  });
});

describe("QA-D044 q94: UserService.reactivate / assertReactivable", () => {
  const reactivate = (w: ReturnType<typeof rbac>, id: string) => w.userService.reactivate(assigner, id, "r");

  it.each([
    ["RM + Committee", ["rm", "co"]],
    ["RM + Audit group", ["rm", "au"]],
    ["RM + plain role carrying audit.*", ["rm", "auditish"]],
  ])("refuses a suspended user holding a pre-existing %s, with no reactivation, no audit", async (_n, ids) => {
    const w = rbac([role("auditish", null, ["audit.read"])]);
    w.held.set("sus", ids);
    await expect(reactivate(w, "sus")).rejects.toThrow(ValidationError);
    expect(w.calls.reactivate).toBe(0);
    expect(w.events).toEqual([]);
  });

  it("accepts clean users, and Committee + Audit (q58 is a creation-time rule, not replayed on reactivation: pinned)", async () => {
    const w = rbac();
    w.held.set("sus1", ["rm", "plain"]);
    w.held.set("sus2", ["co", "au"]);
    await expect(reactivate(w, "sus1")).resolves.toBeTruthy();
    await expect(reactivate(w, "sus2")).resolves.toBeTruthy();
    expect(w.calls.reactivate).toBe(2);
  });

  it("fails closed when the role lookup fails, and checks the actor's tenant", async () => {
    const w = rbac();
    w.held.set("sus", ["rm"]);
    await reactivate(w, "sus");
    expect(w.calls.listForUser.every((c) => c.startsWith("t1/"))).toBe(true);
    w.breakRoles();
    const before = w.calls.reactivate;
    await expect(reactivate(w, "sus")).rejects.toThrow(/roles down/);
    expect(w.calls.reactivate).toBe(before);
  });

  it("a user who is not suspended is refused before any role lookup", async () => {
    const w = rbac();
    await expect(reactivate(w, "live1")).rejects.toThrow(/not suspended/);
    expect(w.calls.listForUser).toEqual([]);
  });
});

describe("QA-D044 q79: config.manage is administrator, config.update is not", () => {
  const CONFIG_ADMIN = new Set<Permission>(["config.manage", "config.cumul.set", "config.committeeenforcement.set"]);

  it("every config.* permission: reason required to give it to a Risk Manager only for the three administrator ones", async () => {
    const configPerms = ALL_PERMISSIONS.filter((p) => p.startsWith("config."));
    expect(configPerms).toContain("config.manage");
    for (const p of configPerms) {
      const w = rbac([role("x", null, [p])]);
      w.held.set("u", ["rm"]);
      const attempt = w.service.assignToUser(assigner, "x", "u", "r");
      if (CONFIG_ADMIN.has(p)) await expect(attempt, p).rejects.toThrow(/administrator/);
      else await expect(attempt, p).resolves.toBeUndefined();
    }
  });

  it("a real config.manage role on an RM: reason stored, validators told, user sheet flags it; same on a Committee member", async () => {
    const w = rbac(); validators(w);
    w.held.set("u", ["rm"]);
    w.held.set("c", ["co"]);
    await w.service.assignToUser(assigner, "client", "u", "r", "motif");
    await w.service.assignToUser(assigner, "client", "c", "r", "motif");
    expect(cumulMsgs(w).map((m) => `${m.recipientUserId}:${/Comité/.test(m.message) ? "CO" : "RM"}`).sort()).toEqual(["c:RM", "val:CO", "val:RM"]);
    expect(w.events.filter((e) => e.reason === "motif").length).toBeGreaterThanOrEqual(2);
    expect((await w.userService.getDetail(assigner, "u")).administratorAndRiskManager).toBe(true);
    expect((await w.userService.getDetail(assigner, "c")).administratorAndCommittee).toBe(true);
  });

  it("giving config.manage to a role already held by an RM goes through update with a reason", async () => {
    const w = rbac(); validators(w);
    w.held.set("u", ["rm", "filler"]);
    await expect(w.service.update(assigner, "filler", { permissions: ["config.manage"] }, "r")).rejects.toThrow(/administrator/);
    await w.service.update(assigner, "filler", { permissions: ["config.manage"] }, "r", "motif");
    expect(cumulMsgs(w)).toHaveLength(1);
  });

  it("config.update + RM/Committee: no reason, no notification", async () => {
    const w = rbac(); validators(w);
    w.held.set("u", ["rm"]); w.held.set("c", ["co"]);
    await w.service.assignToUser(assigner, "method", "u", "r");
    await w.service.assignToUser(assigner, "method", "c", "r");
    expect(cumulMsgs(w)).toEqual([]);
  });
});

// ------------------------------------------------------------------ Notifications world

function notifWorld() {
  const rows: Notification[] = [];
  let failFor: string | null = null;
  const service = new NotificationService(
    {
      async create(i: never) {
        const n = { id: randomUUID(), ...(i as object), sentAt: new Date(), readAt: null } as Notification;
        if (failFor && n.recipientUserId === failFor) throw new Error("db down");
        rows.push(n);
        return n;
      },
      async existsUnread(t: string, u: string, r: string, rid: string, e: string) {
        return rows.some((n) => n.tenantId === t && n.recipientUserId === u && n.resourceType === r && n.resourceId === rid && n.eventType === e && n.readAt === null);
      },
    } as never,
    {
      async getByKey() { return null; },
      async upsert() { throw new Error("not used"); },
    } as never,
    { async record() {} } as never,
  );
  return { service, rows, failFor: (u: string) => { failFor = u; } };
}

function apWorld(over: Record<string, unknown>, risks: Record<string, Record<string, unknown>>, links: Array<{ resourceType: string; resourceId: string }> = [], opts: { linksThrow?: boolean; noRisks?: boolean } = {}) {
  const nw = notifWorld();
  const action = { id: "a1", title: "T", status: "EN_COURS", dueDate: new Date(Date.now() - 86_400_000), responsibleUserId: "resp", sourceType: null, sourceId: null, ...over } as unknown as ActionPlan;
  const riskCalls: string[] = [];
  const riskRepo = { async getById(t: string, id: string) { riskCalls.push(`${t}/${id}`); return t === T1 ? (risks[id] ?? null) : null; } };
  const service = new ActionPlanService(
    {
      getById: async () => action,
      start: async () => ({ ...action, status: "EN_COURS" }),
      listLinks: async () => { if (opts.linksThrow) throw new Error("links down"); return links; },
    } as never,
    { record: async () => undefined } as never,
    opts.noRisks ? undefined : (riskRepo as never),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    nw.service,
  );
  const user = actor("actor", ["actionplan.update"]);
  const recipients = () => nw.rows.map((n) => n.recipientUserId).sort();
  return { ...nw, service, user, riskCalls, recipients };
}
const risk = (ownerId: string | null, superiorOwnerId: string | null, extra: Record<string, unknown> = {}) => ({ status: "ACTIVE", deletedAt: null, ownerId, superiorOwnerId, ...extra });
const SRC = { sourceType: "RISK", sourceId: "k1" };

describe("QA-D044 q84: ActionPlanService.resolveRecipients", () => {
  it("responsible + owner + superior of the source risk, each once; escalate again does not duplicate while unread", async () => {
    const a = apWorld(SRC, { k1: risk("own", "sup") });
    await a.service.escalateIfOverdue(a.user, "a1", "r1");
    expect(a.recipients()).toEqual(["own", "resp", "sup"]);
    await a.service.escalateIfOverdue(a.user, "a1", "r2");
    expect(a.recipients()).toEqual(["own", "resp", "sup"]);
  });

  it("dedupe is per recipient: one recipient already has an unread one, the others still get theirs", async () => {
    const a = apWorld(SRC, { k1: risk("own", "sup") });
    a.rows.push({ id: "x", tenantId: T1, recipientUserId: "own", resourceType: "ACTION_PLAN", resourceId: "a1", eventType: "ACTION_OVERDUE", message: "m", sentAt: new Date(), readAt: null } as Notification);
    await a.service.escalateIfOverdue(a.user, "a1", "r1");
    expect(a.recipients()).toEqual(["own", "resp", "sup"]);
    expect(a.rows.filter((n) => n.recipientUserId === "own")).toHaveLength(1);
  });

  it("owner == responsible == superior, and two risks sharing an owner, collapse to one notification each; source also linked is looked up once", async () => {
    const a = apWorld(SRC, { k1: risk("resp", "resp"), k2: risk("resp", "sup") }, [{ resourceType: "RISK", resourceId: "k2" }, { resourceType: "RISK", resourceId: "k1" }]);
    await a.service.escalateIfOverdue(a.user, "a1", "r");
    expect(a.recipients()).toEqual(["resp", "sup"]);
    expect([...a.riskCalls].sort()).toEqual(["t1/k1", "t1/k2"]);
  });

  it("archived, soft-deleted and missing risks are skipped; non-RISK links ignored; null owner ignored", async () => {
    const a = apWorld({ sourceType: "RISK", sourceId: "arch" },
      { arch: risk("o1", "s1", { status: "ARCHIVED" }), del: risk("o2", "s2", { deletedAt: new Date() }), ok: risk(null, "s3") },
      [{ resourceType: "RISK", resourceId: "del" }, { resourceType: "RISK", resourceId: "ghost" }, { resourceType: "CONTROL", resourceId: "ok" }, { resourceType: "RISK", resourceId: "ok" }]);
    await a.service.escalateIfOverdue(a.user, "a1", "r");
    expect(a.recipients()).toEqual(["resp", "s3"]);
  });

  it("risk lookups use the actor's tenant (a risk of another tenant yields nobody)", async () => {
    const a = apWorld(SRC, { k1: risk("own", "sup") });
    await a.service.escalateIfOverdue(actor("actor", ["actionplan.update"], "t2"), "a1", "r").catch(() => undefined);
    expect(a.riskCalls.every((c) => c.startsWith("t2/"))).toBe(true);
    expect(a.recipients()).not.toContain("own");
  });

  it("a failing recipient does not block the next ones; failing links lookup or no risk repo = responsible only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const a = apWorld(SRC, { k1: risk("own", "sup") });
      a.failFor("resp");
      await a.service.escalateIfOverdue(a.user, "a1", "r");
      expect(a.recipients()).toEqual(["own", "sup"]);
      const b = apWorld(SRC, { k1: risk("own", "sup") }, [], { linksThrow: true });
      await b.service.escalateIfOverdue(b.user, "a1", "r");
      expect(b.recipients()).toEqual(["resp"]);
      const c = apWorld(SRC, { k1: risk("own", "sup") }, [], { noRisks: true });
      await c.service.escalateIfOverdue(c.user, "a1", "r");
      expect(c.recipients()).toEqual(["resp"]);
    } finally { spy.mockRestore(); }
  });

  it("start late notifies the same recipient set with ACTION_STARTED_LATE", async () => {
    const a = apWorld({ status: "PLANIFIEE", ...SRC }, { k1: risk("own", "sup") });
    await a.service.start(a.user, "a1", "r");
    expect(a.recipients()).toEqual(["own", "resp", "sup"]);
    expect(a.rows.every((n) => n.eventType === "ACTION_STARTED_LATE")).toBe(true);
  });
});

describe("QA-D044 q85/q95: catalog and subscriptions", () => {
  it("the 12 types are all mandatory: subscribe(enabled:false) refused for each, also space-padded, nothing stored", async () => {
    for (const t of NOTIFICATION_CATALOG) {
      const upsert = vi.fn();
      const svc = new NotificationService({} as never, { getByKey: async () => null, upsert } as never, { record: async () => undefined } as never);
      const u = actor("u1", ["notification.read"]);
      await expect(svc.subscribe(u, { resourceType: t.resourceType, eventType: t.eventType, enabled: false }, "r")).rejects.toBeInstanceOf(ValidationError);
      await expect(svc.subscribe(u, { resourceType: t.resourceType, eventType: ` ${t.eventType} `, enabled: false }, "r")).rejects.toBeInstanceOf(ValidationError);
      expect(upsert).not.toHaveBeenCalled();
    }
    expect(NOTIFICATION_CATALOG).toHaveLength(12);
  });

  it("the Dispositif event types used by RiskFrameworkService exist in the catalog under MANAGEMENT, mandatory (no drift)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/services/RiskFrameworkService.ts", import.meta.url), "utf8");
    const used = [...new Set([...src.matchAll(/"(RISK_FRAMEWORK_[A-Z_]+)"/g)].map((m) => m[1]!))];
    expect(used.length).toBeGreaterThanOrEqual(4);
    for (const e of used) expect(NOTIFICATION_CATALOG.find((t) => t.eventType === e && t.resourceType === "MANAGEMENT" && t.mandatory), e).toBeTruthy();
  });
});
