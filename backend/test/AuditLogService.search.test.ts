import { describe, expect, it } from "vitest";
import { AuditLogService } from "../src/services/AuditLogService.js";
import type { AuditRepository, AuditSearchFilters } from "../src/domain/repositories/AuditRepository.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

function fakeAuditRepositoryWithSearch(events: AuditEvent[]): AuditRepository {
  return {
    async record() {},
    async listForEntity() {
      return [];
    },
    async listRecent() {
      return [];
    },
    async search(tenantId: string, filters: AuditSearchFilters, limit: number) {
      return events
        .filter((e) => e.tenantId === tenantId)
        .filter((e) => filters.userId === undefined || e.userId === filters.userId)
        .filter((e) => filters.action === undefined || e.action === filters.action)
        .filter((e) => filters.entityType === undefined || e.entityType === filters.entityType)
        .slice(0, limit);
    },
  };
}

const reader: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "auditeur@example.com",
  displayName: "Auditeur",
  roles: ["audit.read"],
};

const events: AuditEvent[] = [
  {
    id: "evt-1",
    tenantId: "tenant-1",
    timestamp: new Date(),
    userId: "user-2",
    entityType: "Risk",
    entityId: "risk-1",
    action: "CREATE",
    oldValue: null,
    newValue: {},
    reason: null,
    requestId: "REQ-1",
  },
  {
    id: "evt-2",
    tenantId: "tenant-1",
    timestamp: new Date(),
    userId: "user-3",
    entityType: "Role",
    entityId: "role-1",
    action: "ROLE_CHANGE",
    oldValue: null,
    newValue: {},
    reason: null,
    requestId: "REQ-2",
  },
];

describe("AuditLogService.search", () => {
  it("filters by userId", async () => {
    const service = new AuditLogService(fakeAuditRepositoryWithSearch(events));
    const results = await service.search(reader, { userId: "user-2" });
    expect(results.map((e) => e.id)).toEqual(["evt-1"]);
  });

  it("filters by action", async () => {
    const service = new AuditLogService(fakeAuditRepositoryWithSearch(events));
    const results = await service.search(reader, { action: "ROLE_CHANGE" });
    expect(results.map((e) => e.id)).toEqual(["evt-2"]);
  });

  it("throws if the repository implementation doesn't support search", async () => {
    const noSearchRepo: AuditRepository = {
      async record() {},
      async listForEntity() {
        return [];
      },
      async listRecent() {
        return [];
      },
    };
    const service = new AuditLogService(noSearchRepo);
    await expect(service.search(reader, {})).rejects.toThrow();
  });
});
