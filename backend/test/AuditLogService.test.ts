import { describe, expect, it } from "vitest";
import { AuditLogService } from "../src/services/AuditLogService.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError } from "../src/domain/errors/DomainErrors.js";

function fakeAuditRepository(events: AuditEvent[]): AuditRepository {
  return {
    async record() {},
    async listForEntity(tenantId, entityType, entityId) {
      return events.filter(
        (e) => e.tenantId === tenantId && e.entityType === entityType && e.entityId === entityId,
      );
    },
    async listRecent(tenantId, limit) {
      return events.filter((e) => e.tenantId === tenantId).slice(0, limit);
    },
  };
}

const reader: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "jp@example.com",
  displayName: "JP",
  roles: ["audit.read"],
};

const noPermUser: AuthenticatedUser = { ...reader, roles: [] };

const sampleEvents: AuditEvent[] = Array.from({ length: 10 }, (_, i) => ({
  id: `evt-${i}`,
  tenantId: "tenant-1",
  timestamp: new Date(),
  userId: "user-1",
  entityType: "Risk",
  entityId: `risk-${i}`,
  action: "CREATE",
  oldValue: null,
  newValue: {},
  reason: null,
  requestId: `REQ-${i}`,
}));

describe("AuditLogService q251 names joined at read time", () => {
  const users = {
    async getById(tenantId: string, id: string) {
      return tenantId === "tenant-1" && id === "user-1" ? { id, displayName: "JP Dupont" } : null;
    },
  } as unknown as import("../src/domain/repositories/UserRepository.js").UserRepository;
  const userEvent = (over: Partial<AuditEvent>): AuditEvent => ({ ...sampleEvents[0]!, entityType: "User", entityId: "user-1", ...over });

  it("adds the actor and target display names from the id, and the id alone when the account does not resolve", async () => {
    const service = new AuditLogService(fakeAuditRepository([userEvent({}), userEvent({ id: "e2", userId: "gone", entityId: "gone" })]), users);
    const [known, gone] = await service.listRecent(reader);
    expect(known).toMatchObject({ userId: "user-1", userDisplayName: "JP Dupont", entityDisplayName: "JP Dupont" });
    expect(gone).toMatchObject({ userId: "gone", entityId: "gone" });
    expect(gone).not.toHaveProperty("userDisplayName");
    expect(gone).not.toHaveProperty("entityDisplayName");
  });
});

describe("AuditLogService", () => {
  it("lists recent events for the actor's tenant, respecting the limit", async () => {
    const service = new AuditLogService(fakeAuditRepository(sampleEvents));
    const events = await service.listRecent(reader, 3);
    expect(events).toHaveLength(3);
  });

  it("caps the limit at the service maximum even if a larger one is requested", async () => {
    const manyEvents = Array.from({ length: 600 }, (_, i) => ({ ...sampleEvents[0]!, id: `evt-${i}` }));
    const service = new AuditLogService(fakeAuditRepository(manyEvents));
    const events = await service.listRecent(reader, 10000);
    expect(events.length).toBeLessThanOrEqual(500);
  });

  it("requires audit.read permission", async () => {
    const service = new AuditLogService(fakeAuditRepository(sampleEvents));
    await expect(service.listRecent(noPermUser)).rejects.toThrow(ForbiddenError);
  });
});
