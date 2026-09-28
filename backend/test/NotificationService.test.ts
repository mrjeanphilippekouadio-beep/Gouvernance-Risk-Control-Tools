import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NotificationService } from "../src/services/NotificationService.js";
import type { NotificationRepository } from "../src/domain/repositories/NotificationRepository.js";
import type { NotificationSubscriptionRepository } from "../src/domain/repositories/NotificationSubscriptionRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { Notification } from "../src/domain/entities/Notification.js";
import type { NotificationSubscription } from "../src/domain/entities/NotificationSubscription.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// ---------------------------------------------------------------------
// In-memory test doubles
// ---------------------------------------------------------------------

function inMemoryNotificationRepository(): NotificationRepository {
  const store = new Map<string, Notification>();
  return {
    async create(input) {
      const notification: Notification = {
        id: randomUUID(),
        tenantId: input.tenantId,
        recipientUserId: input.recipientUserId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        eventType: input.eventType,
        message: input.message,
        sentAt: new Date(),
        readAt: null,
      };
      store.set(notification.id, notification);
      return notification;
    },
    async getById(tenantId, id) {
      const n = store.get(id);
      return n && n.tenantId === tenantId ? n : null;
    },
    async listForRecipient(tenantId, recipientUserId, options) {
      let results = [...store.values()].filter((n) => n.tenantId === tenantId && n.recipientUserId === recipientUserId);
      if (options?.resourceType) results = results.filter((n) => n.resourceType === options.resourceType);
      if (options?.eventType) results = results.filter((n) => n.eventType === options.eventType);
      if (options?.read === true) results = results.filter((n) => n.readAt !== null);
      if (options?.read === false) results = results.filter((n) => n.readAt === null);
      results = results.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
      const total = results.length;
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 20;
      return { data: results.slice(offset, offset + limit), total };
    },
    async markAsRead(tenantId, id, recipientUserId) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId || existing.recipientUserId !== recipientUserId) {
        throw new Error("not found");
      }
      const updated = { ...existing, readAt: new Date() };
      store.set(id, updated);
      return updated;
    },
  };
}

function inMemorySubscriptionRepository(): NotificationSubscriptionRepository {
  const store = new Map<string, NotificationSubscription>();
  const key = (tenantId: string, userId: string, resourceType: string, eventType: string) =>
    `${tenantId}::${userId}::${resourceType}::${eventType}`;
  return {
    async listForUser(tenantId, userId) {
      return [...store.values()].filter((s) => s.tenantId === tenantId && s.userId === userId);
    },
    async getByKey(tenantId, userId, resourceType, eventType) {
      return store.get(key(tenantId, userId, resourceType, eventType)) ?? null;
    },
    async upsert(tenantId, userId, input) {
      const k = key(tenantId, userId, input.resourceType, input.eventType);
      const existing = store.get(k);
      const updated: NotificationSubscription = {
        id: existing?.id ?? randomUUID(),
        tenantId,
        userId,
        resourceType: input.resourceType,
        eventType: input.eventType,
        enabled: input.enabled,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      store.set(k, updated);
      return updated;
    },
  };
}

function inMemoryAuditRepository(): AuditRepository & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    async record(event) {
      events.push(event);
    },
    async listForEntity() {
      return [];
    },
    async listRecent() {
      return [];
    },
  };
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: TENANT,
  email: "user1@djamo.example",
  displayName: "User One",
  roles: ["notification.read"],
};

const otherUser: AuthenticatedUser = { ...actor, userId: "user-2" };

function newService() {
  const notifications = inMemoryNotificationRepository();
  const subscriptions = inMemorySubscriptionRepository();
  const audit = inMemoryAuditRepository();
  return { service: new NotificationService(notifications, subscriptions, audit), audit };
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe("NotificationService — subscriptions (ACT-200)", () => {
  it("creates a subscription for the caller, scoped to their own userId", async () => {
    const { service } = newService();
    const sub = await service.subscribe(actor, { resourceType: "KRI", eventType: "THRESHOLD_BREACH", enabled: true }, "REQ-1");
    expect(sub.userId).toBe(actor.userId);
    expect(sub.enabled).toBe(true);
  });

  it("upserts in place on a second call for the same (resourceType, eventType) — never a second row", async () => {
    const { service } = newService();
    await service.subscribe(actor, { resourceType: "KRI", eventType: "THRESHOLD_BREACH", enabled: true }, "REQ-1");
    const updated = await service.subscribe(actor, { resourceType: "KRI", eventType: "THRESHOLD_BREACH", enabled: false }, "REQ-2");

    const all = await service.listSubscriptions(actor);
    expect(all).toHaveLength(1);
    expect(updated.enabled).toBe(false);
  });

  it("rejects an unknown resourceType", async () => {
    const { service } = newService();
    await expect(
      // @ts-expect-error deliberately invalid for the test
      service.subscribe(actor, { resourceType: "NOT_A_TYPE", eventType: "X", enabled: true }, "REQ-3"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an empty eventType", async () => {
    const { service } = newService();
    await expect(service.subscribe(actor, { resourceType: "KRI", eventType: "  ", enabled: true }, "REQ-4")).rejects.toThrow(
      ValidationError,
    );
  });

  it("scopes listSubscriptions by user: another user's subscriptions are never returned", async () => {
    const { service } = newService();
    await service.subscribe(actor, { resourceType: "KRI", eventType: "THRESHOLD_BREACH", enabled: true }, "REQ-5");
    const otherUserSubs = await service.listSubscriptions(otherUser);
    expect(otherUserSubs).toHaveLength(0);
  });

  it("records CREATE then UPDATE in the audit log across the two calls", async () => {
    const { service, audit } = newService();
    await service.subscribe(actor, { resourceType: "KRI", eventType: "THRESHOLD_BREACH", enabled: true }, "REQ-6");
    await service.subscribe(actor, { resourceType: "KRI", eventType: "THRESHOLD_BREACH", enabled: false }, "REQ-7");
    expect(audit.events).toHaveLength(2);
    expect((audit.events[0] as { action: string }).action).toBe("CREATE");
    expect((audit.events[1] as { action: string }).action).toBe("UPDATE");
  });
});

describe("NotificationService — record (ACT-201, system-facing)", () => {
  it("creates a persistent notification row and audits it under the triggering user", async () => {
    const { service, audit } = newService();
    const notification = await service.record({
      tenantId: TENANT,
      recipientUserId: "owner-1",
      resourceType: "KRI",
      resourceId: "kri-1",
      eventType: "THRESHOLD_BREACH",
      message: "KRI seuil dépassé",
      triggeredBy: "system-caller-1",
      requestId: "REQ-8",
    });

    expect(notification.recipientUserId).toBe("owner-1");
    expect(notification.readAt).toBeNull();
    expect(audit.events).toHaveLength(1);
    expect((audit.events[0] as { userId: string }).userId).toBe("system-caller-1");
  });

  it("rejects a record() call with no message", async () => {
    const { service } = newService();
    await expect(
      service.record({
        tenantId: TENANT,
        recipientUserId: "owner-1",
        resourceType: "KRI",
        resourceId: null,
        eventType: "THRESHOLD_BREACH",
        message: "  ",
        triggeredBy: "system-caller-1",
        requestId: "REQ-9",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("is not gated by requirePermission — no actor/AuthenticatedUser is involved", async () => {
    const { service } = newService();
    // Calling with no actor at all proves this is a system-facing method,
    // not reachable from an HTTP route the way subscribe()/listForRecipient() are.
    const notification = await service.record({
      tenantId: TENANT,
      recipientUserId: "owner-1",
      resourceType: "ACTION_PLAN",
      resourceId: null,
      eventType: "OVERDUE",
      message: "Action en retard",
      triggeredBy: "system-caller-2",
      requestId: "REQ-10",
    });
    expect(notification.id).toBeTruthy();
  });
});

describe("NotificationService — notification center (ACT-202)", () => {
  async function seedTwo(service: NotificationService) {
    await service.record({
      tenantId: TENANT,
      recipientUserId: actor.userId,
      resourceType: "KRI",
      resourceId: "kri-1",
      eventType: "THRESHOLD_BREACH",
      message: "Alerte 1",
      triggeredBy: "system",
      requestId: "REQ-A",
    });
    await service.record({
      tenantId: TENANT,
      recipientUserId: actor.userId,
      resourceType: "ACTION_PLAN",
      resourceId: "action-1",
      eventType: "OVERDUE",
      message: "Alerte 2",
      triggeredBy: "system",
      requestId: "REQ-B",
    });
  }

  it("lists the caller's own notifications with user_id=me", async () => {
    const { service } = newService();
    await seedTwo(service);
    const result = await service.listForRecipient(actor, "me", {});
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
  });

  it("rejects user_id values other than 'me' or the caller's own id (IDOR guard)", async () => {
    const { service } = newService();
    await seedTwo(service);
    await expect(service.listForRecipient(actor, "some-other-user-id", {})).rejects.toThrow(ValidationError);
  });

  it("never returns another tenant's notifications even for the same userId", async () => {
    const { service } = newService();
    await seedTwo(service);
    const otherTenantActor: AuthenticatedUser = { ...actor, tenantId: OTHER_TENANT };
    const result = await service.listForRecipient(otherTenantActor, "me", {});
    expect(result.total).toBe(0);
  });

  it("filters by resourceType and by read status", async () => {
    const { service } = newService();
    await seedTwo(service);
    const kriOnly = await service.listForRecipient(actor, "me", { resourceType: "KRI" });
    expect(kriOnly.total).toBe(1);

    const unreadOnly = await service.listForRecipient(actor, "me", { read: false });
    expect(unreadOnly.total).toBe(2);
  });

  it("paginates with limit/offset", async () => {
    const { service } = newService();
    await seedTwo(service);
    const page1 = await service.listForRecipient(actor, "me", { limit: 1, offset: 0 });
    expect(page1.data).toHaveLength(1);
    expect(page1.total).toBe(2);
  });

  it("marks a notification as read, idempotently", async () => {
    const { service } = newService();
    await seedTwo(service);
    const before = await service.listForRecipient(actor, "me", {});
    const id = before.data[0]!.id;

    const read = await service.markAsRead(actor, id, "REQ-C");
    expect(read.readAt).not.toBeNull();

    const readAgain = await service.markAsRead(actor, id, "REQ-D");
    expect(readAgain.readAt).toEqual(read.readAt);
  });

  it("refuses to mark another user's notification as read (not just NotFound leakage)", async () => {
    const { service } = newService();
    await seedTwo(service);
    const before = await service.listForRecipient(actor, "me", {});
    const id = before.data[0]!.id;

    await expect(service.markAsRead(otherUser, id, "REQ-E")).rejects.toThrow(NotFoundError);
  });

  it("requires notification.read permission", async () => {
    const { service } = newService();
    const noPermActor: AuthenticatedUser = { ...actor, roles: [] };
    await expect(service.listForRecipient(noPermActor, "me", {})).rejects.toThrow(ForbiddenError);
  });
});
