import type { EvidenceRepository } from "../domain/repositories/EvidenceRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { ControlExecutionRepository } from "../domain/repositories/ControlExecutionRepository.js";
import type { Evidence } from "../domain/entities/Evidence.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { DocumentStorage } from "../infrastructure/storage/DocumentStorage.js";
import { validateEvidenceFile } from "./evidenceFileValidation.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB — generous for scanned evidence, not unbounded

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
    },
    requestId: string,
  ): Promise<Evidence> {
    requirePermission(actor, "evidence.upload");

    if (!params.fileName.trim()) throw new ValidationError("fileName is required");
    if (params.content.byteLength === 0) throw new ValidationError("Uploaded file is empty");
    if (params.content.byteLength > MAX_UPLOAD_BYTES) {
      throw new ValidationError(`File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
    }
    validateEvidenceFile(params.fileName, params.mimeType, params.content);

    // SEC-004: don't attach evidence to another tenant's control execution.
    if (params.controlExecutionId && this.controlExecutions) {
      const execution = await this.controlExecutions.getById(actor.tenantId, params.controlExecutionId);
      if (!execution) {
        throw new ValidationError(`ControlExecution ${params.controlExecutionId} does not exist in this tenant`);
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

    return evidence;
  }

  async getUrl(actor: AuthenticatedUser, id: string): Promise<string> {
    requirePermission(actor, "evidence.read");
    const evidence = await this.getOwnedOrThrow(actor, id);
    // Tenant ownership already confirmed above — only now do we touch Drive.
    return this.storage.getUrl(evidence.driveFileId);
  }

  async delete(actor: AuthenticatedUser, id: string, requestId: string): Promise<void> {
    requirePermission(actor, "evidence.delete");
    const evidence = await this.getOwnedOrThrow(actor, id);

    // SEC-008: soft-delete the DB row first. If the Drive call below then
    // fails, the record is already correctly marked deleted and the file
    // is merely an orphan (recoverable, no proof lost) — the old order
    // could otherwise leave the DB row "active" pointing at nothing were
    // the DB write to fail after storage.delete had already succeeded.
    await this.evidences.markDeleted(actor.tenantId, id);
    await this.storage.delete(evidence.driveFileId);

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
  }

  private async getOwnedOrThrow(actor: AuthenticatedUser, id: string): Promise<Evidence> {
    const evidence = await this.evidences.getById(actor.tenantId, id);
    if (!evidence || evidence.status === "DELETED") throw new NotFoundError("Evidence", id);
    return evidence;
  }
}
