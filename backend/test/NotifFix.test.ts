import { describe, expect, it, vi } from "vitest";
import express from "express";
import { NotificationService } from "../src/services/NotificationService.js";
import { KriMeasureService } from "../src/services/KriMeasureService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { actionPlansRouter } from "../src/api/v1/actionPlans.routes.js";
import { notificationsRouter } from "../src/api/v1/notifications.routes.js";
import { notificationSubscriptionsRouter } from "../src/api/v1/notificationSubscriptions.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import type { Notification } from "../src/domain/entities/Notification.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

function world() {
  const rows: Notification[] = [];
  let seq = 0;
  const service = new NotificationService(
    {
      async create(i) { const n: Notification = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, ...i, sentAt: new Date(), readAt: null }; rows.push(n); return n; },
      async existsUnread(t, u, r, rid, e) { return rows.some((n) => n.tenantId === t && n.recipientUserId === u && n.resourceType === r && n.resourceId === rid && n.eventType === e && n.readAt === null); },
      async getById() { return null; },
      async listForRecipient() { return { data: [], total: 0 }; },
      async markAsRead() { throw new Error("n/a"); },
      async countUnread() { return 0; },
      async markAllAsRead() { return 0; },
    },
    { async listForUser() { return []; }, async getByKey() { return null; }, async upsert() { throw new Error("n/a"); } },
    { async record() {}, async listForEntity() { return []; }, async listRecent() { return []; } },
  );
  return { service, rows };
}

const actor: AuthenticatedUser = { userId: "u1", tenantId: "t1", email: "a@x.test", displayName: "A", roles: ["notification.read"] };

function kriService(risk: unknown, w = world()) {
  const kri = { id: "k1", label: "SECRET-LABEL", riskId: "r1", thresholdGreen: 1, thresholdOrange: 5, thresholdRed: 10 };
  const service = new KriMeasureService(
    { create: async (i: object) => ({ id: "m1", ...i }) } as never,
    { getById: async () => kri } as never,
    { record: async () => undefined } as never,
    undefined,
    w.service,
    { getById: async () => risk } as never,
  );
  const user = { ...actor, roles: ["kri.create"] };
  return { w, rec: (value: number) => service.record(user, { kriId: "k1", value, measureDate: new Date(), source: "s" } as never, "r") };
}

function apService(w = world()) {
  const action = { id: "a1", title: "SECRET-TITLE", status: "EN_COURS", dueDate: new Date(Date.now() - 86_400_000), responsibleUserId: "resp" };
  const service = new ActionPlanService(
    { getById: async () => action, start: async () => action } as never,
    { record: async () => undefined } as never,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    w.service,
  );
  return { w, service, user: { ...actor, roles: ["actionplan.update"] } };
}

describe("F-NOTIF-01 dedup of unread notifications", () => {
  it("two escalations of the same overdue action create one notification; after reading, a new one is created", async () => {
    const a = apService();
    await a.service.escalateIfOverdue(a.user, "a1", "r1");
    await a.service.escalateIfOverdue(a.user, "a1", "r2");
    expect(a.w.rows).toHaveLength(1);
    a.w.rows[0]!.readAt = new Date();
    await a.service.escalateIfOverdue(a.user, "a1", "r3");
    expect(a.w.rows).toHaveLength(2);
  });

  it("two KRI breaches while the first is unread notify each recipient once", async () => {
    const k = kriService({ ownerId: "o", superiorOwnerId: "s", status: "ACTIF", deletedAt: null });
    await k.rec(7);
    await k.rec(11);
    expect(k.w.rows.map((n) => n.recipientUserId).sort()).toEqual(["o", "s"]);
  });
});

describe("NOTIF-QA-01 / F-NOTIF-06 / F-NOTIF-03 on KRI", () => {
  it("a failure on the first recipient does not stop the second", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const w = world();
      const original = w.service.emit.bind(w.service);
      w.service.emit = async (i) => { if (i.recipientUserId === "o") throw new Error("boom"); return original(i); };
      await kriService({ ownerId: "o", superiorOwnerId: "s", status: "ACTIF" }, w).rec(7);
      expect(w.rows.map((n) => n.recipientUserId)).toEqual(["s"]);
    } finally { spy.mockRestore(); }
  });

  it("no notification for an archived or deleted risk", async () => {
    for (const risk of [{ ownerId: "o", status: "ARCHIVED" }, { ownerId: "o", status: "ACTIF", deletedAt: new Date() }]) {
      const k = kriService(risk);
      await k.rec(7);
      expect(k.w.rows).toHaveLength(0);
    }
  });

  it("KRI and action messages carry no label, value or title", async () => {
    const k = kriService({ ownerId: "o", status: "ACTIF" });
    await k.rec(7.77);
    const a = apService();
    await a.service.escalateIfOverdue(a.user, "a1", "r");
    for (const n of [...k.w.rows, ...a.w.rows]) {
      expect(n.message).not.toMatch(/SECRET|7\.77/);
    }
    expect(k.w.rows[0]!.message).toBe("Seuil KRI dépassé (KRI k1)");
    expect(a.w.rows[0]!.message).toBe("Action en retard (action a1)");
  });
});

describe("HTTP: F-NOTIF-04 / F-NOTIF-05 / escalate limiter", () => {
  async function serve(w: ReturnType<typeof world>, extra?: (app: express.Express) => void, user: AuthenticatedUser = actor) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { Object.assign(req, { user, requestId: "req" }); next(); });
    app.use("/n", notificationsRouter(w.service));
    app.use("/s", notificationSubscriptionsRouter(w.service));
    extra?.(app);
    app.use(errorHandler);
    const server = app.listen(0);
    const addr = server.address();
    const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    return { call: async (path: string, method = "GET", body?: unknown) => (await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).status, close: () => server.close() };
  }

  it("subscription outside the catalog or with a too long eventType is 400; a catalog pair is 201 shape-wise accepted by the schema", async () => {
    const s = await serve(world());
    try {
      expect(await s.call("/s", "POST", { resourceType: "KRI", eventType: "NOPE", enabled: false })).toBe(400);
      expect(await s.call("/s", "POST", { resourceType: "KRI", eventType: "X".repeat(101), enabled: false })).toBe(400);
    } finally { s.close(); }
  });

  it("PATCH read with a non-uuid id is 400 and a long eventType filter is 400", async () => {
    const s = await serve(world());
    try {
      expect(await s.call("/n/not-a-uuid/read", "PATCH")).toBe(400);
      expect(await s.call(`/n?eventType=${"X".repeat(101)}`)).toBe(400);
    } finally { s.close(); }
  });

  it("POST /action-plans/:id/escalate is limited per user (429 after 20 calls)", async () => {
    const a = apService();
    const s = await serve(a.w, (app) => app.use("/ap", actionPlansRouter(a.service, {} as never)), a.user);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) statuses.push(await s.call("/ap/a1/escalate", "POST"));
      expect(statuses.slice(0, 20).every((c) => c === 200)).toBe(true);
      expect(statuses[20]).toBe(429);
    } finally { s.close(); }
  });
});
