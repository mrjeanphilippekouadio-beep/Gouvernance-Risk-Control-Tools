import { describe, expect, it, vi } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { NotificationService } from "../src/services/NotificationService.js";
import { KriMeasureService } from "../src/services/KriMeasureService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { notificationsRouter } from "../src/api/v1/notifications.routes.js";
import { notificationSubscriptionsRouter } from "../src/api/v1/notificationSubscriptions.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { NOTIFICATION_CATALOG } from "../src/domain/notificationCatalog.js";
import { NOTIFICATION_RESOURCE_TYPES, type Notification } from "../src/domain/entities/Notification.js";
import type { NotificationSubscription } from "../src/domain/entities/NotificationSubscription.js";
import type { ActionPlan } from "../src/domain/entities/ActionPlan.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

type Row = Record<string, unknown>;

/** Real NotificationService over fakes that mirror the Postgres repo scoping (tenant + recipient). */
function world(opts: { failCreate?: boolean; failAudit?: boolean } = {}) {
  const rows: Notification[] = [];
  const subs: NotificationSubscription[] = [];
  const audit: Row[] = [];
  let seq = 0;
  const service = new NotificationService(
    {
      async create(i) {
        if (opts.failCreate) throw new Error("db down");
        const n: Notification = { id: `n${++seq}`, ...i, sentAt: new Date(), readAt: null };
        rows.push(n);
        return n;
      },
      async getById(t, id) { return rows.find((n) => n.tenantId === t && n.id === id) ?? null; },
      async listForRecipient(t, u) {
        const data = rows.filter((n) => n.tenantId === t && n.recipientUserId === u);
        return { data, total: data.length };
      },
      async markAsRead(t, id, u) {
        const n = rows.find((r) => r.tenantId === t && r.id === id && r.recipientUserId === u)!;
        n.readAt = new Date();
        return n;
      },
      async countUnread(t, u) { return rows.filter((n) => n.tenantId === t && n.recipientUserId === u && n.readAt === null).length; },
      async markAllAsRead(t, u) {
        const todo = rows.filter((n) => n.tenantId === t && n.recipientUserId === u && n.readAt === null);
        todo.forEach((n) => (n.readAt = new Date()));
        return todo.length;
      },
    },
    {
      async listForUser(t, u) { return subs.filter((s) => s.tenantId === t && s.userId === u); },
      async getByKey(t, u, r, e) { return subs.find((s) => s.tenantId === t && s.userId === u && s.resourceType === r && s.eventType === e) ?? null; },
      async upsert(t, u, i) {
        const old = subs.find((s) => s.tenantId === t && s.userId === u && s.resourceType === i.resourceType && s.eventType === i.eventType);
        if (old) { old.enabled = i.enabled; return old; }
        const s = { id: `s${++seq}`, tenantId: t, userId: u, ...i, createdAt: new Date(), updatedAt: new Date() } as NotificationSubscription;
        subs.push(s);
        return s;
      },
    },
    {
      async record(e) {
        if (opts.failAudit) throw new Error("audit down");
        audit.push(e as unknown as Row);
      },
      async listForEntity() { return []; },
      async listRecent() { return []; },
    },
  );
  return { service, rows, subs, audit };
}

const actor: AuthenticatedUser = { userId: "u1", tenantId: "t1", email: "a@x.test", displayName: "A", roles: ["notification.read"] };
const base = { tenantId: "t1", resourceType: "KRI", resourceId: null, eventType: "KRI_THRESHOLD_BREACH", message: "m", triggeredBy: "u9", requestId: "r" } as const;
const MANDATORY = NOTIFICATION_CATALOG.filter((t) => t.mandatory);
const OPTIONAL = NOTIFICATION_CATALOG.filter((t) => !t.mandatory);

describe("QA notifications / tenant and user isolation", () => {
  it("unread-count and read-all only ever see (tenant, user) of the actor, in all four combinations", async () => {
    const { service, rows, audit } = world();
    for (const [t, u] of [["t1", "u1"], ["t1", "u1"], ["t1", "u2"], ["t2", "u1"], ["t2", "u2"], ["t2", "u2"], ["t2", "u2"]] as const) {
      await service.record({ ...base, tenantId: t, recipientUserId: u });
    }
    audit.length = 0; // drop the CREATE rows written by record()
    expect(await service.countUnread(actor)).toBe(2);
    expect(await service.countUnread({ ...actor, userId: "u2" })).toBe(1);
    expect(await service.countUnread({ ...actor, tenantId: "t2" })).toBe(1);
    expect(await service.countUnread({ ...actor, tenantId: "t2", userId: "u2" })).toBe(3);
    expect(await service.markAllAsRead(actor, "r")).toBe(2);
    expect(rows.filter((n) => n.readAt !== null).every((n) => n.tenantId === "t1" && n.recipientUserId === "u1")).toBe(true);
    expect(rows.filter((n) => n.readAt === null)).toHaveLength(5);
    expect(audit).toHaveLength(1);
    expect(audit.every((e) => e["tenantId"] === "t1" && e["userId"] === "u1")).toBe(true);
  });

  it("read-all on an empty inbox returns 0 and writes nothing", async () => {
    const { service, audit } = world();
    expect(await service.markAllAsRead(actor, "r")).toBe(0);
    expect(audit).toHaveLength(0);
  });

  it("another user's notification: list with a foreign user_id is 400, markAsRead is 404 and leaves it unread; a foreign tenant id is 404", async () => {
    const { service, rows } = world();
    const n = await service.record({ ...base, recipientUserId: "u2" });
    await expect(service.listForRecipient(actor, "u2")).rejects.toBeInstanceOf(ValidationError);
    await expect(service.markAsRead(actor, n.id, "r")).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(service.markAsRead({ ...actor, tenantId: "t2", userId: "u2" }, n.id, "r")).rejects.toMatchObject({ name: "NotFoundError" });
    expect(rows[0]!.readAt).toBeNull();
  });
});

describe("QA notifications / subscriptions", () => {
  it.each(MANDATORY.map((t) => [t.eventType, t] as const))("mandatory %s cannot be disabled (plain and padded), nothing stored, no audit", async (_n, t) => {
    const { service, subs, audit } = world();
    await expect(service.subscribe(actor, { resourceType: t.resourceType, eventType: t.eventType, enabled: false }, "r")).rejects.toBeInstanceOf(ValidationError);
    await expect(service.subscribe(actor, { resourceType: t.resourceType, eventType: `  ${t.eventType}  `, enabled: false }, "r")).rejects.toBeInstanceOf(ValidationError);
    expect(subs).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it("explicitly enabling a mandatory type is accepted and harmless", async () => {
    const { service } = world();
    await expect(service.subscribe(actor, { resourceType: "MANAGEMENT", eventType: "COMMITTEE_MEMBER_ADDED", enabled: true }, "r")).resolves.toMatchObject({ enabled: true });
  });

  it("disabling an optional type is effective for that user only and that type only; re-enabling restores", async () => {
    const { service, rows } = world();
    await service.subscribe(actor, { resourceType: "ACTION_PLAN", eventType: "ACTION_OVERDUE", enabled: false }, "r");
    const overdue = { ...base, resourceType: "ACTION_PLAN", eventType: "ACTION_OVERDUE" } as const;
    expect(await service.emit({ ...overdue, recipientUserId: "u1" })).toBeNull();
    expect(await service.emit({ ...overdue, recipientUserId: "u2" })).not.toBeNull(); // other user
    expect(await service.emit({ ...overdue, tenantId: "t2", recipientUserId: "u1" })).not.toBeNull(); // other tenant
    expect(await service.emit({ ...overdue, eventType: "ACTION_STARTED_LATE", recipientUserId: "u1" })).not.toBeNull(); // other optional type
    expect(await service.emit({ ...base, recipientUserId: "u1" })).not.toBeNull(); // KRI breach
    await service.subscribe(actor, { resourceType: "ACTION_PLAN", eventType: "ACTION_OVERDUE", enabled: true }, "r");
    expect(await service.emit({ ...overdue, recipientUserId: "u1" })).not.toBeNull();
    expect(rows).toHaveLength(5);
  });

  it("opting out of every optional type never suppresses any of the four mandatory types", async () => {
    const { service, rows } = world();
    for (const t of OPTIONAL) await service.subscribe(actor, { resourceType: t.resourceType, eventType: t.eventType, enabled: false }, "r");
    for (const t of OPTIONAL) expect(await service.emit({ ...base, resourceType: t.resourceType, eventType: t.eventType, recipientUserId: "u1" })).toBeNull();
    for (const t of MANDATORY) expect(await service.emit({ ...base, resourceType: t.resourceType, eventType: t.eventType, recipientUserId: "u1" })).not.toBeNull();
    expect(rows).toHaveLength(MANDATORY.length);
  });

  it("subscribe is audited CREATE then UPDATE and is always about the actor", async () => {
    const { service, audit } = world();
    const first = await service.subscribe(actor, { resourceType: "KRI", eventType: "KRI_THRESHOLD_BREACH", enabled: false }, "r");
    await service.subscribe(actor, { resourceType: "KRI", eventType: "KRI_THRESHOLD_BREACH", enabled: true }, "r");
    expect(first.userId).toBe("u1");
    expect(audit.map((e) => e["action"])).toEqual(["CREATE", "UPDATE"]);
  });

  it("OBSERVATION: the pair is not validated against the catalog (unknown event types and a mandatory name under another resourceType can be opted out; harmless because emit matches the pair)", async () => {
    const { service, rows } = world();
    await expect(service.subscribe(actor, { resourceType: "KRI", eventType: "COMMITTEE_MEMBER_ADDED", enabled: false }, "r")).resolves.toBeTruthy();
    await expect(service.subscribe(actor, { resourceType: "KRI", eventType: "NOPE", enabled: false }, "r")).resolves.toBeTruthy();
    expect(await service.emit({ ...base, resourceType: "MANAGEMENT", eventType: "COMMITTEE_MEMBER_ADDED", recipientUserId: "u1" })).not.toBeNull();
    expect(rows).toHaveLength(1);
  });

  it("catalog is coherent: unique pairs, valid resource types, exactly the 4 MANAGEMENT governance types mandatory", () => {
    const keys = NOTIFICATION_CATALOG.map((t) => `${t.resourceType}/${t.eventType}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(NOTIFICATION_CATALOG.every((t) => (NOTIFICATION_RESOURCE_TYPES as readonly string[]).includes(t.resourceType) && t.label.length > 0)).toBe(true);
    expect(MANDATORY).toHaveLength(4);
    expect(MANDATORY.every((t) => t.resourceType === "MANAGEMENT")).toBe(true);
  });
});

describe("QA notifications / HTTP routes", () => {
  async function serve(w: ReturnType<typeof world>, user: AuthenticatedUser) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { Object.assign(req, { user, requestId: "req" }); next(); });
    app.use("/api/v1/notifications", notificationsRouter(w.service));
    app.use("/api/v1/notification-subscriptions", notificationSubscriptionsRouter(w.service));
    app.use(errorHandler);
    const server = app.listen(0);
    const addr = server.address();
    const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    const call = async (path: string, method = "GET", body?: unknown) => {
      const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: (await res.json().catch(() => null)) as { data?: unknown; error?: string } | null };
    };
    return { call, close: () => server.close() };
  }

  it("response shapes the frontend reads: unread-count {data:number}, read-all {data:{updated}}, types {data:[...mandatory]}, list {data,total}", async () => {
    const w = world();
    await w.service.record({ ...base, recipientUserId: "u1" });
    await w.service.record({ ...base, recipientUserId: "u2" });
    const s = await serve(w, actor);
    try {
      expect((await s.call("/api/v1/notifications/unread-count")).json).toEqual({ data: 1 });
      const list = await s.call("/api/v1/notifications?user_id=me&read=false");
      expect(list.status).toBe(200);
      expect(list.json).toMatchObject({ total: 1 });
      expect(await s.call("/api/v1/notifications/read-all", "POST")).toMatchObject({ status: 200, json: { data: { updated: 1 } } });
      expect((await s.call("/api/v1/notifications/read-all", "POST")).json).toEqual({ data: { updated: 0 } });
      expect((await s.call("/api/v1/notifications/unread-count")).json).toEqual({ data: 0 });
      const types = (await s.call("/api/v1/notifications/types")).json!.data as Array<{ eventType: string; mandatory: boolean; label: string; resourceType: string }>;
      expect(types).toHaveLength(NOTIFICATION_CATALOG.length);
      expect(types.filter((t) => t.mandatory)).toHaveLength(4);
      expect(w.rows.find((n) => n.recipientUserId === "u2")!.readAt).toBeNull();
    } finally { s.close(); }
  });

  it("static routes are not swallowed by /:id; foreign user_id 400; bad limit 400; foreign notification PATCH 404", async () => {
    const w = world();
    const other = await w.service.record({ ...base, recipientUserId: "u2" });
    const s = await serve(w, actor);
    try {
      expect((await s.call("/api/v1/notifications?user_id=u2")).status).toBe(400);
      expect((await s.call("/api/v1/notifications?limit=101")).status).toBe(400);
      expect((await s.call("/api/v1/notifications?limit=0")).status).toBe(400);
      expect((await s.call("/api/v1/notifications?resourceType=NOPE")).status).toBe(400);
      expect((await s.call("/api/v1/notifications/unread-count", "POST")).status).toBe(404);
      expect((await s.call(`/api/v1/notifications/${other.id}/read`, "PATCH")).status).toBe(404);
      expect((await s.call("/api/v1/notifications/read-all", "GET")).status).toBe(404);
    } finally { s.close(); }
  });

  it("403 without notification.read on every route, and no side effect", async () => {
    const w = world();
    await w.service.record({ ...base, recipientUserId: "u1" });
    w.audit.length = 0;
    const s = await serve(w, { ...actor, roles: ["risk.read"] });
    try {
      for (const [p, m] of [["/unread-count", "GET"], ["/types", "GET"], ["/read-all", "POST"], ["", "GET"]] as const) {
        expect((await s.call(`/api/v1/notifications${p}`, m)).status).toBe(403);
      }
      expect((await s.call("/api/v1/notification-subscriptions", "POST", { resourceType: "KRI", eventType: "X", enabled: false })).status).toBe(403);
      expect(w.rows[0]!.readAt).toBeNull();
      expect(w.subs).toHaveLength(0);
      expect(w.audit).toHaveLength(0);
    } finally { s.close(); }
  });

  it("POST subscription: mandatory disable 400 (no row), optional disable 201, then listed; bad body 400", async () => {
    const w = world();
    const s = await serve(w, actor);
    try {
      expect((await s.call("/api/v1/notification-subscriptions", "POST", { resourceType: "MANAGEMENT", eventType: "RIGHTS_LOST_ON_REACTIVATION", enabled: false })).status).toBe(400);
      expect(w.subs).toHaveLength(0);
      expect((await s.call("/api/v1/notification-subscriptions", "POST", { resourceType: "KRI", eventType: "KRI_THRESHOLD_BREACH", enabled: false })).status).toBe(201);
      const listed = (await s.call("/api/v1/notification-subscriptions")).json!.data as Array<{ enabled: boolean }>;
      expect(listed).toHaveLength(1);
      expect(listed[0]!.enabled).toBe(false);
      expect((await s.call("/api/v1/notification-subscriptions", "POST", { resourceType: "KRI", eventType: "", enabled: false })).status).toBe(400);
      expect((await s.call("/api/v1/notification-subscriptions", "POST", { resourceType: "KRI", eventType: "K", enabled: "no" })).status).toBe(400);
      expect((await s.call("/api/v1/notification-subscriptions", "POST", { resourceType: "BOGUS", eventType: "K", enabled: false })).status).toBe(400);
    } finally { s.close(); }
  });
});

describe("QA notifications / MARK_ALL_READ audit", () => {
  it("one row per effective call (updated > 0) with entityId = actor, count, reason; none when 0", async () => {
    const { service, audit } = world();
    await service.record({ ...base, recipientUserId: "u1" });
    audit.length = 0;
    expect(await service.markAllAsRead(actor, "req-A")).toBe(1);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ tenantId: "t1", userId: "u1", entityType: "Notification", entityId: "u1", action: "UPDATE", reason: "MARK_ALL_READ", newValue: { markedRead: 1 }, requestId: "req-A" });
    await service.markAllAsRead(actor, "req-B");
    expect(audit).toHaveLength(1);
  });

  it("OBSERVATION: if the audit write fails after the update, the call rejects but the notifications stay read (no transaction)", async () => {
    const w = world({ failAudit: true });
    // record() audits too, so seed rows directly
    w.rows.push({ id: "n", tenantId: "t1", recipientUserId: "u1", resourceType: "KRI", resourceId: null, eventType: "x", message: "m", sentAt: new Date(), readAt: null });
    await expect(w.service.markAllAsRead(actor, "r")).rejects.toThrow("audit down");
    expect(w.rows[0]!.readAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------- KRI

function kriWorld(risk: unknown, w = world(), extra: { riskThrows?: boolean; wired?: boolean } = {}) {
  const kri = { id: "k1", label: "L", riskId: "r1", thresholdGreen: 1, thresholdOrange: 5, thresholdRed: 10 };
  const notifier = { notify: vi.fn(async () => undefined) };
  const risks = { getById: async () => { if (extra.riskThrows) throw new Error("risk db down"); return risk; } };
  const service = new KriMeasureService(
    { create: async (i: object) => ({ id: "m1", ...i }) } as never,
    { getById: async () => kri } as never,
    { record: async () => undefined } as never,
    notifier,
    extra.wired === false ? undefined : w.service,
    extra.wired === false ? undefined : (risks as never),
  );
  const user = { ...actor, roles: ["kri.create"] };
  const rec = (value: number) => service.record(user, { kriId: "k1", value, measureDate: new Date(), source: "s" } as never, "r");
  return { rec, notifier, w };
}

describe("QA notifications / KRI recipients", () => {
  const recipients = (w: ReturnType<typeof world>) => w.rows.map((n) => n.recipientUserId).sort();

  it("owner only (superior null), superior only (owner null), both null, risk not found: never throws, no null recipient persisted", async () => {
    for (const [risk, expected] of [
      [{ ownerId: "o", superiorOwnerId: null }, ["o"]],
      [{ ownerId: null, superiorOwnerId: "s" }, ["s"]],
      [{ ownerId: undefined, superiorOwnerId: undefined }, []],
      [{ ownerId: null, superiorOwnerId: null }, []],
      [{ ownerId: "", superiorOwnerId: "" }, []],
      [null, []],
    ] as const) {
      const k = kriWorld(risk);
      await expect(k.rec(7)).resolves.toBeTruthy();
      expect(recipients(k.w)).toEqual(expected);
      expect(k.notifier.notify).toHaveBeenCalledTimes(1); // the legacy channel still fires
    }
  });

  it("owner === superior is notified once; ORANGE and ROUGE both notify; GREEN never; notification points at the KRI with the catalog type", async () => {
    const k = kriWorld({ ownerId: "o", superiorOwnerId: "o" });
    await k.rec(7);
    await k.rec(11);
    await k.rec(0);
    expect(k.w.rows).toHaveLength(2);
    expect(k.w.rows.every((n) => n.resourceType === "KRI" && n.resourceId === "k1" && n.eventType === "KRI_THRESHOLD_BREACH")).toBe(true);
    expect(k.w.audit.filter((e) => e["entityType"] === "Notification" && e["userId"] === "u1")).toHaveLength(2); // triggeredBy = actor
  });

  it("recipient who opted out is skipped, the other recipient still gets it", async () => {
    const w = world();
    await w.service.subscribe({ ...actor, userId: "o" }, { resourceType: "KRI", eventType: "KRI_THRESHOLD_BREACH", enabled: false }, "r");
    const k = kriWorld({ ownerId: "o", superiorOwnerId: "s" }, w);
    await k.rec(7);
    expect(recipients(w)).toEqual(["s"]);
  });

  it("not wired (no NotificationService / RiskRepository) behaves as before", async () => {
    const k = kriWorld({ ownerId: "o" }, world(), { wired: false });
    await expect(k.rec(7)).resolves.toBeTruthy();
    expect(k.w.rows).toHaveLength(0);
  });

  it("persistence failures are not fatal: risk lookup throws, notification insert throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const a = kriWorld({ ownerId: "o" }, world(), { riskThrows: true });
      await expect(a.rec(7)).resolves.toBeTruthy();
      const b = kriWorld({ ownerId: "o", superiorOwnerId: "s" }, world({ failCreate: true }));
      await expect(b.rec(7)).resolves.toBeTruthy();
      expect(spy).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  // KNOWN GAP (MINOR): persistBreach loops inside ONE try/catch (KriMeasureService.ts persistBreach), so a failure on the
  // first recipient aborts the loop and the superior is never notified, even though the failure may be specific to one row.
  it.fails("KNOWN GAP NOTIF-QA-01: a failure persisting the owner's notification must not prevent the superior's", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const w = world();
      const original = w.service.emit.bind(w.service);
      w.service.emit = async (i) => { if (i.recipientUserId === "o") throw new Error("boom"); return original(i); };
      const k = kriWorld({ ownerId: "o", superiorOwnerId: "s" }, w);
      await k.rec(7);
      expect(recipients(w)).toEqual(["s"]);
    } finally { spy.mockRestore(); }
  });
});

// ---------------------------------------------------------------- Action plan

function apWorld(over: Partial<ActionPlan> = {}, w = world(), wired = true) {
  const action = { id: "a1", title: "T", status: "EN_COURS", dueDate: new Date(Date.now() - 86_400_000), responsibleUserId: "resp", ...over } as unknown as ActionPlan;
  const audit: Row[] = [];
  const notifier = { notify: vi.fn(async () => undefined) };
  const service = new ActionPlanService(
    { getById: async () => action, start: async () => ({ ...action, status: "EN_COURS" }) } as never,
    { record: async (e: Row) => void audit.push(e) } as never,
    undefined, undefined, undefined, undefined, undefined, notifier, undefined, undefined, undefined,
    wired ? w.service : undefined,
  );
  const user = { ...actor, roles: ["actionplan.update"] };
  return { service, user, audit, notifier, w };
}

describe("QA notifications / action plan", () => {
  it("start late persists ACTION_STARTED_LATE for the responsible user, tenant-scoped, triggeredBy = actor; start on time persists nothing", async () => {
    const late = apWorld({ status: "PLANIFIEE" });
    await late.service.start(late.user, "a1", "r");
    expect(late.w.rows).toEqual([expect.objectContaining({ tenantId: "t1", recipientUserId: "resp", eventType: "ACTION_STARTED_LATE", resourceType: "ACTION_PLAN", resourceId: "a1" })]);
    expect(late.w.audit.find((e) => e["entityType"] === "Notification")).toMatchObject({ userId: "u1" });
    const ok = apWorld({ status: "PLANIFIEE", dueDate: new Date(Date.now() + 86_400_000) });
    await ok.service.start(ok.user, "a1", "r");
    expect(ok.w.rows).toHaveLength(0);
  });

  it("escalate on a non-late or finished action persists nothing", async () => {
    for (const over of [{ dueDate: new Date(Date.now() + 86_400_000) }, { status: "TERMINEE" as const }]) {
      const a = apWorld(over);
      expect((await a.service.escalateIfOverdue(a.user, "a1", "r")).escalated).toBe(false);
      expect(a.w.rows).toHaveLength(0);
    }
  });

  it("persistence failure (insert down, or audit of the notification down) is not fatal for start and escalate; business audit row is kept", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      for (const o of [{ failCreate: true }, { failAudit: true }]) {
        const s = apWorld({ status: "PLANIFIEE" }, world(o));
        await expect(s.service.start(s.user, "a1", "r")).resolves.toBeTruthy();
        const e = apWorld({}, world(o));
        expect((await e.service.escalateIfOverdue(e.user, "a1", "r")).escalated).toBe(true);
        expect(e.audit).toHaveLength(1);
      }
      expect(spy).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("responsible user who opted out of ACTION_OVERDUE gets no notification, escalation still succeeds", async () => {
    const w = world();
    await w.service.subscribe({ ...actor, userId: "resp" }, { resourceType: "ACTION_PLAN", eventType: "ACTION_OVERDUE", enabled: false }, "r");
    const a = apWorld({}, w);
    expect((await a.service.escalateIfOverdue(a.user, "a1", "r")).escalated).toBe(true);
    expect(w.rows).toHaveLength(0);
  });

  it("without a NotificationService the legacy notifier path is unchanged", async () => {
    const a = apWorld({}, world(), false);
    expect((await a.service.escalateIfOverdue(a.user, "a1", "r")).escalated).toBe(true);
    expect(a.notifier.notify).toHaveBeenCalledTimes(1);
  });

  // KNOWN GAP (MINOR): escalateIfOverdue has no idempotence. Every call (the endpoint is manual, no scheduler) inserts a new
  // unread ACTION_OVERDUE row for the same action, plus a new audit row, so repeated clicks flood the responsible user.
  it.fails("KNOWN GAP NOTIF-QA-02: escalating the same overdue action twice must not create two unread ACTION_OVERDUE notifications", async () => {
    const a = apWorld();
    await a.service.escalateIfOverdue(a.user, "a1", "r1");
    await a.service.escalateIfOverdue(a.user, "a1", "r2");
    expect(a.w.rows.filter((n) => n.eventType === "ACTION_OVERDUE" && n.readAt === null)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- frontend contract (static)

describe("QA notifications / frontend contract (static review)", () => {
  const api = readFileSync(new URL("../../frontend/src/api/notifications.ts", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../src/api/v1/notifications.routes.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../../frontend/src/features/notifications/NotificationCenter.tsx", import.meta.url), "utf8");

  it("every notifications path called by the client has a matching backend route and method", () => {
    expect(api).toContain('"/api/v1/notifications/unread-count"');
    expect(routes).toContain('router.get("/unread-count"');
    expect(api).toContain('"/api/v1/notifications/types"');
    expect(routes).toContain('router.get("/types"');
    expect(api).toMatch(/read-all", \{ method: "POST"/);
    expect(routes).toContain('router.post("/read-all"');
    expect(api).toMatch(/\/read`, \{ method: "PATCH"/);
    expect(routes).toContain('router.patch("/:id/read"');
    expect(api).toContain("/api/v1/notification-subscriptions");
  });

  it("client resource types equal the backend enum", () => {
    const m = /NotificationResourceType =([^;]+);/.exec(api)![1]!;
    const front = [...m.matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]).sort();
    expect(front).toEqual([...NOTIFICATION_RESOURCE_TYPES].sort());
  });

  it("UI: unknown count is never rendered as 0, mandatory types get no disable button, 401/403/other errors are distinguished", () => {
    expect(ui).toContain("setUnread(null)");
    expect(ui).toMatch(/!mandatory && \(/);
    expect(ui).toContain("status === 401");
    expect(ui).toContain("status === 403");
  });
});
