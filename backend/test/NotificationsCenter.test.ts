import { describe, expect, it } from "vitest";
import { NotificationService } from "../src/services/NotificationService.js";
import { KriMeasureService } from "../src/services/KriMeasureService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { NOTIFICATION_CATALOG } from "../src/domain/notificationCatalog.js";
import type { Notification } from "../src/domain/entities/Notification.js";
import type { NotificationSubscription } from "../src/domain/entities/NotificationSubscription.js";
import type { ActionPlan } from "../src/domain/entities/ActionPlan.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function build() {
  const rows: Notification[] = [];
  const subs: NotificationSubscription[] = [];
  const events: Array<Record<string, unknown>> = [];
  let seq = 0;
  const service = new NotificationService(
    {
      async create(i) {
        const n: Notification = { id: `n${++seq}`, ...i, sentAt: new Date(), readAt: null };
        rows.push(n);
        return n;
      },
      async getById(t, id) {
        return rows.find((n) => n.tenantId === t && n.id === id) ?? null;
      },
      async listForRecipient() {
        return { data: [], total: 0 };
      },
      async markAsRead() {
        throw new Error("unused");
      },
      async countUnread(t, u) {
        return rows.filter((n) => n.tenantId === t && n.recipientUserId === u && n.readAt === null).length;
      },
      async markAllAsRead(t, u) {
        const todo = rows.filter((n) => n.tenantId === t && n.recipientUserId === u && n.readAt === null);
        todo.forEach((n) => (n.readAt = new Date()));
        return todo.length;
      },
    },
    {
      async listForUser() {
        return subs;
      },
      async getByKey(t, u, r, e) {
        return subs.find((s) => s.tenantId === t && s.userId === u && s.resourceType === r && s.eventType === e) ?? null;
      },
      async upsert(t, u, i) {
        const s = { id: `s${++seq}`, tenantId: t, userId: u, ...i, createdAt: new Date(), updatedAt: new Date() } as NotificationSubscription;
        subs.push(s);
        return s;
      },
    },
    {
      async record(e) {
        events.push(e as unknown as Record<string, unknown>);
      },
      async listForEntity() {
        return [];
      },
      async listRecent() {
        return [];
      },
    },
  );
  return { service, rows, subs, events };
}

const actor: AuthenticatedUser = { userId: "u1", tenantId: "t1", email: "a@x.test", displayName: "A", roles: ["notification.read"] };
const noPerm: AuthenticatedUser = { ...actor, roles: [] };
const base = { tenantId: "t1", resourceType: "KRI", resourceId: null, eventType: "KRI_THRESHOLD_BREACH", message: "m", triggeredBy: "u9", requestId: "r" } as const;

describe("notification center", () => {
  it("counts unread and marks all as read for the actor and tenant only", async () => {
    const { service, rows, events } = build();
    await service.record({ ...base, recipientUserId: "u1" });
    await service.record({ ...base, recipientUserId: "u1" });
    await service.record({ ...base, recipientUserId: "u2" });
    await service.record({ ...base, tenantId: "t2", recipientUserId: "u1" });
    expect(await service.countUnread(actor)).toBe(2);
    expect(await service.markAllAsRead(actor, "r1")).toBe(2);
    expect(await service.countUnread(actor)).toBe(0);
    expect(rows.filter((n) => n.readAt === null)).toHaveLength(2); // other user + other tenant untouched
    expect(events.filter((e) => e["reason"] === "MARK_ALL_READ")).toHaveLength(1);
    expect(await service.markAllAsRead(actor, "r2")).toBe(0);
    expect(events.filter((e) => e["reason"] === "MARK_ALL_READ")).toHaveLength(1); // nothing changed, no audit
  });

  it("requires notification.read", async () => {
    const { service } = build();
    await expect(service.countUnread(noPerm)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.markAllAsRead(noPerm, "r")).rejects.toBeInstanceOf(ForbiddenError);
    expect(() => service.getCatalog(noPerm)).toThrow(ForbiddenError);
  });

  it("exposes the catalog with the four governance types mandatory", () => {
    const { service } = build();
    const mandatory = service.getCatalog(actor).filter((t) => t.mandatory).map((t) => t.eventType).sort();
    expect(mandatory).toEqual(["ADMIN_RISK_MANAGER_CUMUL", "AUDIT_RIGHTS_CHANGE_PENDING", "COMMITTEE_MEMBER_ADDED", "RIGHTS_LOST_ON_REACTIVATION"]);
    expect(NOTIFICATION_CATALOG.filter((t) => !t.mandatory).map((t) => t.eventType)).toContain("KRI_THRESHOLD_BREACH");
  });
});

describe("subscriptions applied at emission", () => {
  it("skips an explicitly unsubscribed optional type, persists otherwise", async () => {
    const { service, rows } = build();
    expect(await service.emit({ ...base, recipientUserId: "u1" })).not.toBeNull();
    await service.subscribe(actor, { resourceType: "KRI", eventType: "KRI_THRESHOLD_BREACH", enabled: false }, "r");
    expect(await service.emit({ ...base, recipientUserId: "u1" })).toBeNull();
    expect(await service.emit({ ...base, recipientUserId: "u2" })).not.toBeNull(); // other user unaffected
    expect(rows).toHaveLength(2);
  });

  it("refuses to disable a mandatory type and always persists it", async () => {
    const { service, subs, rows } = build();
    await expect(service.subscribe(actor, { resourceType: "MANAGEMENT", eventType: "COMMITTEE_MEMBER_ADDED", enabled: false }, "r")).rejects.toBeInstanceOf(ValidationError);
    // even a stale opt-out row cannot suppress it
    subs.push({ id: "s", tenantId: "t1", userId: "u1", resourceType: "MANAGEMENT", eventType: "COMMITTEE_MEMBER_ADDED", enabled: false, createdAt: new Date(), updatedAt: new Date() });
    const n = await service.emit({ ...base, resourceType: "MANAGEMENT", eventType: "COMMITTEE_MEMBER_ADDED", recipientUserId: "u1" });
    expect(n).not.toBeNull();
    expect(rows).toHaveLength(1);
  });
});

describe("persisted KRI and action-plan notifications", () => {
  it("persists a KRI breach for the risk owner and superior owner", async () => {
    const emitted: Array<{ recipientUserId: string; eventType: string }> = [];
    const notifications = { emit: async (i: { recipientUserId: string; eventType: string }) => void emitted.push(i) } as unknown as NotificationService;
    const kri = { id: "k1", label: "L", riskId: "r1", thresholdGreen: 1, thresholdOrange: 5, thresholdRed: 10 };
    const service = new KriMeasureService(
      { create: async (i: object) => ({ id: "m1", ...i }) } as never,
      { getById: async () => kri } as never,
      { record: async () => undefined } as never,
      undefined,
      notifications,
      { getById: async () => ({ ownerId: "owner", superiorOwnerId: "boss" }) } as never,
    );
    const kriActor = { ...actor, roles: ["kri.create"] };
    await service.record(kriActor, { kriId: "k1", value: 7, measureDate: new Date(), source: "s" } as never, "r");
    expect(emitted.map((e) => e.recipientUserId).sort()).toEqual(["boss", "owner"]);
    await service.record(kriActor, { kriId: "k1", value: 0, measureDate: new Date(), source: "s" } as never, "r"); // green: nothing
    expect(emitted).toHaveLength(2);
  });

  it("persists an overdue action for its responsible user; a failure does not break the escalation", async () => {
    const emitted: Array<{ recipientUserId: string; eventType: string }> = [];
    const action = { id: "a1", title: "T", status: "EN_COURS", dueDate: new Date(Date.now() - 86_400_000), responsibleUserId: "resp" } as unknown as ActionPlan;
    const build2 = (emit: (i: never) => Promise<unknown>) =>
      new ActionPlanService(
        { getById: async () => action } as never, { record: async () => undefined } as never,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        { emit } as unknown as NotificationService,
      );
    const apActor = { ...actor, roles: ["actionplan.update"] };
    const ok = await build2(async (i: never) => void emitted.push(i)).escalateIfOverdue(apActor, "a1", "r");
    expect(ok.escalated).toBe(true);
    expect(emitted).toEqual([expect.objectContaining({ recipientUserId: "resp", eventType: "ACTION_OVERDUE", resourceType: "ACTION_PLAN" })]);
    const failing = await build2(async () => { throw new Error("db down"); }).escalateIfOverdue(apActor, "a1", "r");
    expect(failing.escalated).toBe(true);
  });
});
