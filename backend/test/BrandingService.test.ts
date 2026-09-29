import { describe, expect, it } from "vitest";
import { BrandingService } from "../src/services/BrandingService.js";
import type { BrandingRepository } from "../src/domain/repositories/BrandingRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { TenantBranding } from "../src/domain/entities/TenantBranding.js";
import type { DocumentStorage } from "../src/infrastructure/storage/DocumentStorage.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryBrandingRepository(): BrandingRepository {
  const store = new Map<string, TenantBranding>();
  function emptyBranding(tenantId: string): TenantBranding {
    return { tenantId, logoDriveFileId: null, logoUrl: null, logoUpdatedAt: null, logoUpdatedBy: null };
  }
  return {
    async getBranding(tenantId) {
      return store.get(tenantId) ?? emptyBranding(tenantId);
    },
    async setLogo(tenantId, logoDriveFileId, logoUrl, updatedBy) {
      const updated: TenantBranding = {
        tenantId,
        logoDriveFileId,
        logoUrl,
        logoUpdatedAt: new Date(),
        logoUpdatedBy: updatedBy,
      };
      store.set(tenantId, updated);
      return updated;
    },
  };
}

function fakeDocumentStorage(): DocumentStorage {
  return {
    async upload(params) {
      return {
        storageFileId: `drive-${params.tenantId}-${params.fileName}`,
        url: `https://drive.example/${params.fileName}`,
        fileName: params.fileName,
      };
    },
    async getUrl(storageFileId) {
      return `https://drive.example/file/${storageFileId}`;
    },
    async delete() {},
  };
}

function recordingAuditRepository(): AuditRepository & { events: Omit<AuditEvent, "id" | "timestamp">[] } {
  const events: Omit<AuditEvent, "id" | "timestamp">[] = [];
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

const tenantAUser: AuthenticatedUser = {
  userId: "user-a",
  tenantId: "tenant-a",
  email: "a@example.com",
  displayName: "A",
  roles: ["branding.read", "branding.update"],
};

const tenantBUser: AuthenticatedUser = {
  ...tenantAUser,
  userId: "user-b",
  tenantId: "tenant-b",
  email: "b@example.com",
};

const validUpload = {
  fileName: "logo.png",
  mimeType: "image/png",
  content: Buffer.from("fake-png-bytes"),
};

describe("BrandingService", () => {
  describe("permission gates", () => {
    it("rejects getBranding without branding.read", async () => {
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), recordingAuditRepository());
      const noPermUser = { ...tenantAUser, roles: [] };
      await expect(service.getBranding(noPermUser)).rejects.toThrow(ForbiddenError);
    });

    it("rejects uploadLogo without branding.update", async () => {
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), recordingAuditRepository());
      const readOnlyUser = { ...tenantAUser, roles: ["branding.read"] };
      await expect(service.uploadLogo(readOnlyUser, validUpload, "REQ-1")).rejects.toThrow(ForbiddenError);
    });

    it("allows getBranding with only branding.read", async () => {
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), recordingAuditRepository());
      const readOnlyUser = { ...tenantAUser, roles: ["branding.read"] };
      await expect(service.getBranding(readOnlyUser)).resolves.toBeDefined();
    });
  });

  describe("tenant isolation", () => {
    it("never returns another tenant's branding", async () => {
      const repo = inMemoryBrandingRepository();
      const service = new BrandingService(repo, fakeDocumentStorage(), recordingAuditRepository());
      await service.uploadLogo(tenantAUser, validUpload, "REQ-1");

      const brandingForB = await service.getBranding(tenantBUser);
      expect(brandingForB.logoDriveFileId).toBeNull();
      expect(brandingForB.tenantId).toBe("tenant-b");
    });

    it("never lets a different tenant overwrite another tenant's logo", async () => {
      const repo = inMemoryBrandingRepository();
      const service = new BrandingService(repo, fakeDocumentStorage(), recordingAuditRepository());
      await service.uploadLogo(tenantAUser, validUpload, "REQ-1");

      await service.uploadLogo(tenantBUser, { ...validUpload, fileName: "b-logo.png" }, "REQ-2");

      const brandingA = await repo.getBranding("tenant-a");
      const brandingB = await repo.getBranding("tenant-b");
      expect(brandingA.logoDriveFileId).toContain("tenant-a");
      expect(brandingB.logoDriveFileId).toContain("tenant-b");
      expect(brandingA.logoDriveFileId).not.toBe(brandingB.logoDriveFileId);
    });
  });

  describe("upload validation", () => {
    it("rejects an empty fileName", async () => {
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), recordingAuditRepository());
      await expect(
        service.uploadLogo(tenantAUser, { ...validUpload, fileName: "" }, "REQ-1"),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects a whitespace-only fileName", async () => {
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), recordingAuditRepository());
      await expect(
        service.uploadLogo(tenantAUser, { ...validUpload, fileName: "   " }, "REQ-1"),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects empty content", async () => {
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), recordingAuditRepository());
      await expect(
        service.uploadLogo(tenantAUser, { ...validUpload, content: Buffer.alloc(0) }, "REQ-1"),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects content over the 5MB limit", async () => {
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), recordingAuditRepository());
      const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
      await expect(
        service.uploadLogo(tenantAUser, { ...validUpload, content: oversized }, "REQ-1"),
      ).rejects.toThrow(ValidationError);
    });

    it("accepts content exactly at the 5MB limit (boundary)", async () => {
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), recordingAuditRepository());
      const atLimit = Buffer.alloc(5 * 1024 * 1024);
      await expect(
        service.uploadLogo(tenantAUser, { ...validUpload, content: atLimit }, "REQ-1"),
      ).resolves.toBeDefined();
    });

    it("rejects a disallowed MIME type", async () => {
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), recordingAuditRepository());
      await expect(
        service.uploadLogo(tenantAUser, { ...validUpload, mimeType: "application/pdf" }, "REQ-1"),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects an executable-disguised-as-image MIME type", async () => {
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), recordingAuditRepository());
      await expect(
        service.uploadLogo(tenantAUser, { ...validUpload, mimeType: "application/x-msdownload" }, "REQ-1"),
      ).rejects.toThrow(ValidationError);
    });

    it.each(["image/png", "image/jpeg", "image/svg+xml", "image/webp"])(
      "accepts the allowed MIME type %s",
      async (mimeType) => {
        const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), recordingAuditRepository());
        await expect(
          service.uploadLogo(tenantAUser, { ...validUpload, mimeType }, "REQ-1"),
        ).resolves.toBeDefined();
      },
    );
  });

  describe("audit trail", () => {
    it("records a CREATE action on the first upload (no prior logo)", async () => {
      const audit = recordingAuditRepository();
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), audit);
      await service.uploadLogo(tenantAUser, validUpload, "REQ-1");

      expect(audit.events).toHaveLength(1);
      expect(audit.events[0].action).toBe("CREATE");
      expect(audit.events[0].entityType).toBe("TenantBranding");
      expect(audit.events[0].entityId).toBe("tenant-a");
      expect(audit.events[0].tenantId).toBe("tenant-a");
      expect(audit.events[0].userId).toBe("user-a");
      expect(audit.events[0].requestId).toBe("REQ-1");
    });

    it("records an UPDATE action when a logo already existed", async () => {
      const repo = inMemoryBrandingRepository();
      const audit = recordingAuditRepository();
      const service = new BrandingService(repo, fakeDocumentStorage(), audit);

      await service.uploadLogo(tenantAUser, validUpload, "REQ-1");
      await service.uploadLogo(tenantAUser, { ...validUpload, fileName: "new-logo.png" }, "REQ-2");

      expect(audit.events).toHaveLength(2);
      expect(audit.events[0].action).toBe("CREATE");
      expect(audit.events[1].action).toBe("UPDATE");
    });

    it("scrubs logoUrl from both oldValue and newValue in the audit trail", async () => {
      const audit = recordingAuditRepository();
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), audit);
      await service.uploadLogo(tenantAUser, validUpload, "REQ-1");

      const [event] = audit.events;
      expect(event.oldValue).toMatchObject({ logoUrl: undefined });
      expect(event.newValue).toMatchObject({ logoUrl: undefined });
      // Explicitly assert the raw Drive URL string never appears in the recorded audit payload.
      expect(JSON.stringify(event.oldValue)).not.toContain("https://drive.example");
      expect(JSON.stringify(event.newValue)).not.toContain("https://drive.example");
    });

    it("still returns the real logoUrl to the caller even though it is scrubbed from audit", async () => {
      const service = new BrandingService(inMemoryBrandingRepository(), fakeDocumentStorage(), recordingAuditRepository());
      const result = await service.uploadLogo(tenantAUser, validUpload, "REQ-1");
      expect(result.logoUrl).toBe("https://drive.example/logo.png");
    });
  });
});
