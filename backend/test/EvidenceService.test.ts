import { describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { EvidenceService } from "../src/services/EvidenceService.js";
import type { EvidenceRepository } from "../src/domain/repositories/EvidenceRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { DocumentStorage } from "../src/infrastructure/storage/DocumentStorage.js";
import type { Evidence } from "../src/domain/entities/Evidence.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

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
    async findBySha256(tenantId, sha256) {
      return [...store.values()].find((e) => e.tenantId === tenantId && e.sha256 === sha256 && e.status === "ACTIVE") ?? null;
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
        sha256: input.sha256,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
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
    async restoreActive(tenantId, id) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      store.set(id, { ...existing, status: "ACTIVE" });
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
    async getContent() {
      return Buffer.alloc(0);
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
  roles: ["evidence.upload", "evidence.read", "evidence.download", "evidence.delete"],
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
      { fileName: "preuve.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.7\nminimal test fixture"), documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
      "REQ-1",
    );
    expect(evidence.tenantId).toBe("tenant-a");
    expect(evidence.fileName).toBe("preuve.pdf");
  });

  it("cleans up the stored document if metadata persistence fails", async () => {
    const baseRepo = inMemoryEvidenceRepository();
    const repo: EvidenceRepository = {
      ...baseRepo,
      async create() { throw new Error("database unavailable"); },
    };
    const storage = fakeDocumentStorage();
    const service = new EvidenceService(repo, storage, inMemoryAuditRepository());

    await expect(service.upload(
      tenantAUser,
      { fileName: "preuve.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.7\\nfixture"), documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
      "REQ-COMP-1",
    )).rejects.toThrow("database unavailable");
    expect(storage.deletedIds).toHaveLength(1);
  });

  it("soft-deletes and cleans up the document if audit recording fails", async () => {
    const storage = fakeDocumentStorage();
    const audit: AuditRepository = {
      async record() { throw new Error("audit unavailable"); },
      async listForEntity() { return []; },
      async listRecent() { return []; },
    };
    const service = new EvidenceService(inMemoryEvidenceRepository(), storage, audit);

    await expect(service.upload(
      tenantAUser,
      { fileName: "preuve.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.7\\nfixture"), documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
      "REQ-COMP-2",
    )).rejects.toThrow("audit unavailable");
    expect(storage.deletedIds).toHaveLength(1);
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
      { fileName: "confidentiel.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.7\nminimal test fixture"), documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
      "REQ-3",
    );

    await expect(service.getUrl(tenantBUser, evidence.id, "REQ-3b")).rejects.toThrow(NotFoundError);
  });

  it("restores the evidence row and does not touch Drive when audit recording fails during delete", async () => {
    const repo = inMemoryEvidenceRepository();
    const storage = fakeDocumentStorage();
    let auditCalls = 0;
    const audit: AuditRepository = {
      async record() {
        auditCalls += 1;
        if (auditCalls === 2) throw new Error("audit unavailable");
      },
      async listForEntity() { return []; },
    };
    const service = new EvidenceService(repo, storage, audit);
    const evidence = await service.upload(
      tenantAUser,
      { fileName: "audit-failure.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.7\nminimal test fixture"), documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
      "REQ-DELETE-AUDIT-1",
    );

    await expect(service.delete(tenantAUser, evidence.id, "REQ-DELETE-AUDIT-2")).rejects.toThrow("audit unavailable");

    const restored = await repo.getById(tenantAUser.tenantId, evidence.id);
    expect(restored?.status).toBe("ACTIVE");
    expect(storage.deletedIds).toHaveLength(0);
  });

  it("never lets a different tenant delete another tenant's evidence", async () => {
    const repo = inMemoryEvidenceRepository();
    const storage = fakeDocumentStorage();
    const service = new EvidenceService(repo, storage, inMemoryAuditRepository());
    const evidence = await service.upload(
      tenantAUser,
      { fileName: "confidentiel.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.7\nminimal test fixture"), documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
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
        { fileName: "x.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.7\nminimal test fixture"), documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
        "REQ-6",
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const xlsxBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("fixture")]);

  it("accepts an xlsx linked to an execution and records sha256, size and mime type", async () => {
    const service = new EvidenceService(inMemoryEvidenceRepository(), fakeDocumentStorage(), inMemoryAuditRepository());
    const evidence = await service.upload(
      tenantAUser,
      { fileName: "preuve.xlsx", mimeType: XLSX, content: xlsxBytes, documentType: "CONTROL_EVIDENCE", controlExecutionId: "exec-1" },
      "REQ-X1",
    );
    expect(evidence.sha256).toBe(createHash("sha256").update(xlsxBytes).digest("hex"));
    expect(evidence.fileSize).toBe(xlsxBytes.byteLength);
    expect(evidence.mimeType).toBe(XLSX);
  });

  it("rejects an xlsx that is not linked to a control execution", async () => {
    const service = new EvidenceService(inMemoryEvidenceRepository(), fakeDocumentStorage(), inMemoryAuditRepository());
    await expect(
      service.upload(
        tenantAUser,
        { fileName: "preuve.xlsx", mimeType: XLSX, content: xlsxBytes, documentType: "CONTROL_EVIDENCE", controlExecutionId: null },
        "REQ-X2",
      ),
    ).rejects.toThrow(/controlExecutionId is required/);
  });

  it("answers 409 with the existing id on a duplicate hash, unless a new reference is explicitly requested", async () => {
    const service = new EvidenceService(inMemoryEvidenceRepository(), fakeDocumentStorage(), inMemoryAuditRepository());
    const params = { fileName: "preuve.xlsx", mimeType: XLSX, content: xlsxBytes, documentType: "CONTROL_EVIDENCE", controlExecutionId: "exec-1" };
    const first = await service.upload(tenantAUser, params, "REQ-X3");

    const err = await service.upload(tenantAUser, params, "REQ-X4").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).existingId).toBe(first.id);

    const second = await service.upload(tenantAUser, { ...params, allowDuplicate: true }, "REQ-X5");
    expect(second.id).not.toBe(first.id);
    // Another tenant is never told about this tenant's file.
    await expect(service.upload(tenantBUser, params, "REQ-X6")).resolves.toBeDefined();
  });

  it("audits a download without file content, and requires evidence.download", async () => {
    const recorded: unknown[] = [];
    const audit: AuditRepository = { ...inMemoryAuditRepository(), async record(e) { recorded.push(e); } };
    const service = new EvidenceService(inMemoryEvidenceRepository(), fakeDocumentStorage(), audit);
    const evidence = await service.upload(
      tenantAUser,
      { fileName: "preuve.xlsx", mimeType: XLSX, content: xlsxBytes, documentType: "CONTROL_EVIDENCE", controlExecutionId: "exec-1" },
      "REQ-X7",
    );
    await service.getUrl(tenantAUser, evidence.id, "REQ-X8");
    expect(recorded.at(-1)).toMatchObject({ action: "DOWNLOAD", entityId: evidence.id, requestId: "REQ-X8", tenantId: "tenant-a" });

    const readOnly = { ...tenantAUser, roles: ["evidence.read"] };
    await expect(service.getUrl(readOnly, evidence.id, "REQ-X9")).rejects.toThrow(ForbiddenError);
  });

  it("lists evidences of an execution without Drive references", async () => {
    const service = new EvidenceService(inMemoryEvidenceRepository(), fakeDocumentStorage(), inMemoryAuditRepository());
    await service.upload(
      tenantAUser,
      { fileName: "preuve.xlsx", mimeType: XLSX, content: xlsxBytes, documentType: "CONTROL_EVIDENCE", controlExecutionId: "exec-1" },
      "REQ-X10",
    );
    const list = await service.listForControlExecution(tenantAUser, "exec-1");
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("driveUrl");
    expect(list[0]).not.toHaveProperty("driveFileId");
    expect(await service.listForControlExecution(tenantBUser, "exec-1")).toHaveLength(0);
  });
});
