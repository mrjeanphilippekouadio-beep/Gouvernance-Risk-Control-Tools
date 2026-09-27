import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { FeedbackService } from "../src/services/FeedbackService.js";
import type { FeedbackRepository } from "../src/domain/repositories/FeedbackRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { Feedback } from "../src/domain/entities/Feedback.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryFeedbackRepository(): FeedbackRepository {
  const store = new Map<string, Feedback>();
  return {
    async create(input) {
      const entry: Feedback = {
        id: randomUUID(),
        tenantId: input.tenantId,
        userId: input.userId,
        category: input.category,
        message: input.message,
        page: input.page ?? null,
        status: "NEW",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(entry.id, entry);
      return entry;
    },
    async getById(tenantId, id) {
      const entry = store.get(id);
      return entry && entry.tenantId === tenantId ? entry : null;
    },
    async list(tenantId, options) {
      return [...store.values()].filter(
        (e) => e.tenantId === tenantId && (!options?.status || e.status === options.status),
      );
    },
    async updateStatus(tenantId, id, status) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, status, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
  };
}

function inMemoryAuditRepository(): AuditRepository {
  return {
    async record() {},
    async listForEntity() {
      return [];
    },
    async listRecent() {
      return [];
    },
  };
}

const submitter: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "user@example.com",
  displayName: "User",
  roles: ["feedback.create"],
};

const reviewer: AuthenticatedUser = {
  userId: "reviewer-1",
  tenantId: "tenant-1",
  email: "reviewer@example.com",
  displayName: "Reviewer",
  roles: ["feedback.read", "feedback.update"],
};

describe("FeedbackService", () => {
  it("lets any user with feedback.create submit an entry", async () => {
    const service = new FeedbackService(inMemoryFeedbackRepository(), inMemoryAuditRepository());
    const entry = await service.create(submitter, { category: "IDEA", message: "Ajouter un export PDF" }, "REQ-1");
    expect(entry.status).toBe("NEW");
    expect(entry.userId).toBe("user-1");
  });

  it("rejects an empty message", async () => {
    const service = new FeedbackService(inMemoryFeedbackRepository(), inMemoryAuditRepository());
    await expect(service.create(submitter, { category: "BUG", message: "   " }, "REQ-2")).rejects.toThrow(
      ValidationError,
    );
  });

  it("requires feedback.create to submit", async () => {
    const service = new FeedbackService(inMemoryFeedbackRepository(), inMemoryAuditRepository());
    const noPerm: AuthenticatedUser = { ...submitter, roles: [] };
    await expect(service.create(noPerm, { category: "BUG", message: "x" }, "REQ-3")).rejects.toThrow(ForbiddenError);
  });

  it("moves a submission through valid status transitions", async () => {
    const service = new FeedbackService(inMemoryFeedbackRepository(), inMemoryAuditRepository());
    const entry = await service.create(submitter, { category: "BUG", message: "x" }, "REQ-4");
    const ack = await service.updateStatus(reviewer, entry.id, "ACKNOWLEDGED", "REQ-5");
    expect(ack.status).toBe("ACKNOWLEDGED");
    const resolved = await service.updateStatus(reviewer, entry.id, "RESOLVED", "REQ-6");
    expect(resolved.status).toBe("RESOLVED");
  });

  it("refuses a transition out of a terminal status", async () => {
    const service = new FeedbackService(inMemoryFeedbackRepository(), inMemoryAuditRepository());
    const entry = await service.create(submitter, { category: "BUG", message: "x" }, "REQ-7");
    await service.updateStatus(reviewer, entry.id, "DECLINED", "REQ-8");
    await expect(service.updateStatus(reviewer, entry.id, "IN_PROGRESS", "REQ-9")).rejects.toThrow(ValidationError);
  });
});
