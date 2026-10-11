import type { EvidenceRepository } from "../domain/repositories/EvidenceRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { ControlExecutionRepository } from "../domain/repositories/ControlExecutionRepository.js";
import { createHash } from "node:crypto";
import type { Evidence } from "../domain/entities/Evidence.js";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import { MAX_DOCUMENT_BYTES, type DocumentStorage } from "../infrastructure/storage/DocumentStorage.js";
import { validateEvidenceFile, XLSX_MIME } from "./evidenceFileValidation.js";

/** List view: no Drive reference, since reaching the file requires evidence.download. */
export type EvidenceSummary = Omit<Evidence, "driveFileId" | "driveUrl">;

function toSummary({ driveFileId: _f, driveUrl: _u, ...summary }: Evidence): EvidenceSummary {
  return summary;
}

const MAX_UPLOAD_BYTES = MAX_DOCUMENT_BYTES; // 25 MB — generous for scanned evidence, not unbounded

/**
 * Owns the one rule that keeps document access tenant-isolated: never
 * call documentStorage.getUrl/delete with a driveFileId that hasn't
 * first been confirmed, via a tenant-scoped DB lookup, to belong to the
 * caller's tenant. GoogleDriveStorage itself has no notion of tenants —
 * this service is where that boundary is actually enforced.
 */
export class EvidenceService {
  constructor(
    private readonly evidences: EvidenceRepository,
    private readonly storage: DocumentStorage,
    private readonly audit: AuditRepository,
    /** SEC-004: optional so existing tests keep compiling — server.ts must wire the real repository. */
    private readonly controlExecutions?: ControlExecutionRepository,
  ) {}

  async upload(
    actor: AuthenticatedUser,
    params: {
      fileName: string;
      mimeType: string;
      content: Buffer;
      documentType: string;
      controlExecutionId: string | null;
      /** Explicit client request to register a file whose hash already exists in the tenant. */
      allowDuplicate?: boolean;
    },
    requestId: string,
  ): Promise<EvidenceSummary> {
    requirePermission(actor, "evidence.upload");

    if (!params.fileName.trim()) throw new ValidationError("fileName is required");
    if (params.content.byteLength === 0) throw new ValidationError("Uploaded file is empty");
    if (params.content.byteLength > MAX_UPLOAD_BYTES) {
      throw new ValidationError(`File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
    }
    validateEvidenceFile(params.fileName, params.mimeType, params.content);

    // A spreadsheet is only meaningful as proof of a specific control execution.
    if (params.mimeType.trim().toLowerCase() === XLSX_MIME && !params.controlExecutionId) {
      throw new ValidationError("controlExecutionId is required for an xlsx evidence");
    }

    // SEC-004: don't attach evidence to another tenant's control execution.
    if (params.controlExecutionId && this.controlExecutions) {
      const execution = await this.controlExecutions.getById(actor.tenantId, params.controlExecutionId);
      if (!execution) {
        throw new ValidationError(`ControlExecution ${params.controlExecutionId} does not exist in this tenant`);
      }
    }

    // Hash computed server-side; never trusted from the client.
    const sha256 = createHash("sha256").update(params.content).digest("hex");
    if (!params.allowDuplicate) {
      const existing = await this.evidences.findBySha256?.(actor.tenantId, sha256);
      if (existing) {
        // Only an actor allowed to read evidences learns the existing id.
        if (actor.roles.includes("evidence.read")) {
          throw new ConflictError(`An identical file already exists as evidence ${existing.id}`, existing.id);
        }
        throw new ConflictError("Un fichier identique est déjà enregistré.");
      }
    }

    const uploaded = await this.storage.upload({
      tenantId: actor.tenantId,
      fileName: params.fileName,
      mimeType: params.mimeType,
      content: params.content,
    });

    let evidence: Evidence;
    try {
      evidence = await this.evidences.create({
        tenantId: actor.tenantId,
        controlExecutionId: params.controlExecutionId,
        fileName: uploaded.fileName,
        driveFileId: uploaded.storageFileId,
        driveUrl: uploaded.url,
        documentType: params.documentType,
        uploadedBy: actor.userId,
        sha256,
        fileSize: params.content.byteLength,
        mimeType: params.mimeType.trim().toLowerCase(),
      });
    } catch (persistError) {
      try {
        await this.storage.delete(uploaded.storageFileId);
      } catch (cleanupError) {
        throw new Error(
          "Evidence metadata persistence failed and document cleanup also failed; reconciliation is required",
          { cause: new AggregateError([persistError, cleanupError]) },
        );
      }
      throw persistError;
    }

    try {
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "Evidence",
        entityId: evidence.id,
        action: "CREATE",
        oldValue: null,
        newValue: { ...evidence, driveUrl: undefined },
        reason: null,
        requestId,
      });
    } catch (auditError) {
      try {
        await this.evidences.markDeleted(actor.tenantId, evidence.id);
      } catch (rollbackError) {
        throw new Error(
          "Evidence audit failed and database compensation failed; reconciliation is required",
          { cause: new AggregateError([auditError, rollbackError]) },
        );
      }
      try {
        await this.storage.delete(uploaded.storageFileId);
      } catch (cleanupError) {
        throw new Error(
          "Evidence audit failed; record was soft-deleted but document cleanup failed; reconciliation is required",
          { cause: new AggregateError([auditError, cleanupError]) },
        );
      }
      throw auditError;
    }

    return toSummary(evidence);
  }

  async listForControlExecution(actor: AuthenticatedUser, controlExecutionId: string): Promise<EvidenceSummary[]> {
    requirePermission(actor, "evidence.read");
    const items = await this.evidences.listForControlExecution(actor.tenantId, controlExecutionId);
    return items.map(toSummary);
  }

  async getUrl(actor: AuthenticatedUser, id: string, requestId: string): Promise<string> {
    requirePermission(actor, "evidence.download");
    const evidence = await this.getOwnedOrThrow(actor, id);
    // Audited before the URL is released: if the trail can't be written, no download.
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Evidence",
      entityId: id,
      action: "DOWNLOAD",
      oldValue: null,
      newValue: { fileName: evidence.fileName, sha256: evidence.sha256 },
      reason: null,
      requestId,
    });
    // Tenant ownership already confirmed above — only now do we touch Drive.
    return this.storage.getUrl(evidence.driveFileId);
  }

  async delete(actor: AuthenticatedUser, id: string, requestId: string): Promise<void> {
    requirePermission(actor, "evidence.delete");
    const evidence = await this.getOwnedOrThrow(actor, id);

    // SEC-008: establish the logical deletion and its audit record before
    // touching external storage. If the audit write fails, restore the DB
    // row to ACTIVE so the logical state and audit trail do not diverge.
    await this.evidences.markDeleted(actor.tenantId, id);

    try {
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "Evidence",
        entityId: id,
        action: "DELETE",
        oldValue: { ...evidence, driveUrl: undefined },
        newValue: null,
        reason: null,
        requestId,
      });
    } catch (auditError) {
      try {
        await this.evidences.restoreActive(actor.tenantId, id);
      } catch (rollbackError) {
        throw new Error(
          "Evidence audit failed and DB rollback failed; reconciliation is required",
          { cause: new AggregateError([auditError, rollbackError]) },
        );
      }
      throw auditError;
    }

    try {
      await this.storage.delete(evidence.driveFileId);
    } catch (storageError) {
      throw new Error(
        `Evidence was logically deleted and audited, but Drive cleanup failed; reconciliation is required: ${
          storageError instanceof Error ? storageError.message : String(storageError)
        }`,
        { cause: storageError },
      );
    }
  }

  private async getOwnedOrThrow(actor: AuthenticatedUser, id: string): Promise<Evidence> {
    const evidence = await this.evidences.getById(actor.tenantId, id);
    if (!evidence || evidence.status === "DELETED") throw new NotFoundError("Evidence", id);
    return evidence;
  }
}
