import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { EvidenceService } from "../src/services/EvidenceService.js";
import type { EvidenceRepository } from "../src/domain/repositories/EvidenceRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { DocumentStorage } from "../src/infrastructure/storage/DocumentStorage.js";
import type { Evidence } from "../src/domain/entities/Evidence.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryEvidenceRepository(): EvidenceRepository {
  const store = new Map<string, Evidence>();
  return {
    async getById(tenantId, id) {
      const evidence = store.get(id);
      return evidence && evidence.tenantId === tenantId ? evidence : null;
    },
    async listForControlExecution(tenantId, controlExecutionId) {
      return [...store.values()].filter(
        (e) => e.tenantId === tenantId && e.controlExecutionId === controlExecutionId,
      );
    },
    async create(input) {
      const evidence: Evidence = {
        id: randomUUID(),
        tenantId: input.tenantId,
        controlExecutionId: input.controlExecutionId,
        fileName: input.fileName,
        driveFileId: input.driveFileId,
        driveUrl: input.driveUrl,
        documentType: input.documentType,
        uploadedBy: input.uploadedBy,
        uploadedAt: new Date(),
        version: 1,
        status: "ACTIVE",
      };
      store.set(evidence.id, evidence);
      return evidence;
    },
    async markDeleted(tenantId, id) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      store.set(id, { ...existing, status: "DELETED" });
    },
  };
}

function fakeDocumentStorage(): DocumentStorage & { deletedIds: string[] } {
  const deletedIds: string[] = [];
  return {
    deletedIds,
    async upload(params) {
      return { storageFileId: randomUUID(), url: `https://drive.example/${params.fileName}`, fileName: params.fileName };
    },
    async getUrl(storageFileId) {
      return `https://drive.example/file/${storageFileId}`;
    },
    async delete(storageFileId) {
      deletedIds.push(storageFileId);
    },
  };
}

function inMemoryAuditRepository(): AuditRepository {
  return {
    async record() {},
    async listForEntity() {
      return [];
    },
  };
}

const tenantAUser: AuthenticatedUser = {
  userId: "user-a",
  tenantId: "tenant-a",
  email: "a@example.com",
  displayName: "A",
  roles: ["evidence.upload", "evidence.read", "evidence.delete"],
};

const tenantBUser: AuthenticatedUser = {
  ...tenantAUser,
  userId: "user-b",
  tenantId: "tenant-b",
  email: "b@example.com",
};

describe("EvidenceService", () => {
  it("uploads a file and stores Drive metadata scoped to the actor's tenant", async () => {
    const service = new EvidenceService(inMemoryEvidenceRepository(), fakeDocumentStorage(), inMemoryAuditRepository());
    const evidence = await service.upload(
      tenantAUser,
      { fileName: "preuve.pdf", mimeType: "application/pdf", content: Buffer.from("x"), documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
      "REQ-1",
    );
    expect(evidence.tenantId).toBe("tenant-a");
    expect(evidence.fileName).toBe("preuve.pdf");
  });

  it("rejects an empty file", async () => {
    const service = new EvidenceService(inMemoryEvidenceRepository(), fakeDocumentStorage(), inMemoryAuditRepository());
    await expect(
      service.upload(
        tenantAUser,
        { fileName: "vide.pdf", mimeType: "application/pdf", content: Buffer.alloc(0), documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
        "REQ-2",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("never lets a different tenant read another tenant's evidence, even knowing its id", async () => {
    const repo = inMemoryEvidenceRepository();
    const service = new EvidenceService(repo, fakeDocumentStorage(), inMemoryAuditRepository());
    const evidence = await service.upload(
      tenantAUser,
      { fileName: "confidentiel.pdf", mimeType: "application/pdf", content: Buffer.from("x"), documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
      "REQ-3",
    );

    await expect(service.getUrl(tenantBUser, evidence.id)).rejects.toThrow(NotFoundError);
  });

  it("never lets a different tenant delete another tenant's evidence", async () => {
    const repo = inMemoryEvidenceRepository();
    const storage = fakeDocumentStorage();
    const service = new EvidenceService(repo, storage, inMemoryAuditRepository());
    const evidence = await service.upload(
      tenantAUser,
      { fileName: "confidentiel.pdf", mimeType: "application/pdf", content: Buffer.from("x"), documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
      "REQ-4",
    );

    await expect(service.delete(tenantBUser, evidence.id, "REQ-5")).rejects.toThrow(NotFoundError);
    expect(storage.deletedIds).toHaveLength(0);
  });

  it("rejects upload without evidence.upload permission", async () => {
    const service = new EvidenceService(inMemoryEvidenceRepository(), fakeDocumentStorage(), inMemoryAuditRepository());
    const noPermUser = { ...tenantAUser, roles: ["evidence.read"] };
    await expect(
      service.upload(
        noPermUser,
        { fileName: "x.pdf", mimeType: "application/pdf", content: Buffer.from("x"), documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
        "REQ-6",
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});
