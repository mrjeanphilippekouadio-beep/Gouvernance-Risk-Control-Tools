import type { BrandingRepository } from "../domain/repositories/BrandingRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { TenantBranding } from "../domain/entities/TenantBranding.js";
import { ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { DocumentStorage } from "../infrastructure/storage/DocumentStorage.js";

const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB — generous for a logo image, far below EvidenceService's 25 MB document cap
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

/**
 * ACT-084 — "Importer le logo client". Deliberately reuses
 * DocumentStorage/GoogleDriveStorage rather than a second storage
 * mechanism: EvidenceService already established that pattern (tenant's
 * Drive folder, resolved via TenantRepository.getDriveFolderId, never a
 * raw Drive call without going through the interface) and a tenant logo
 * has the exact same shape of concern — one file, owned by one tenant,
 * that must never leak across tenants. The only two differences from
 * EvidenceService are: (1) branding is a single current value per
 * tenant (in-place update on `tenants`, not an append-only Evidence
 * row), and (2) content is restricted to a handful of image MIME types
 * and a much smaller size cap, since this is a logo, not a compliance
 * document.
 */
export class BrandingService {
  constructor(
    private readonly branding: BrandingRepository,
    private readonly storage: DocumentStorage,
    private readonly audit: AuditRepository,
  ) {}

  async getBranding(actor: AuthenticatedUser): Promise<TenantBranding> {
    requirePermission(actor, "branding.read");
    return this.branding.getBranding(actor.tenantId);
  }

  async uploadLogo(
    actor: AuthenticatedUser,
    params: { fileName: string; mimeType: string; content: Buffer },
    requestId: string,
  ): Promise<TenantBranding> {
    requirePermission(actor, "branding.update");

    if (!params.fileName.trim()) throw new ValidationError("fileName is required");
    if (params.content.byteLength === 0) throw new ValidationError("Uploaded file is empty");
    if (params.content.byteLength > MAX_LOGO_BYTES) {
      throw new ValidationError(`Logo exceeds the ${MAX_LOGO_BYTES / (1024 * 1024)}MB limit`);
    }
    if (!ALLOWED_MIME_TYPES.includes(params.mimeType)) {
      throw new ValidationError(`Logo must be one of: ${ALLOWED_MIME_TYPES.join(", ")}`);
    }

    const before = await this.branding.getBranding(actor.tenantId);

    const uploaded = await this.storage.upload({
      tenantId: actor.tenantId,
      fileName: params.fileName,
      mimeType: params.mimeType,
      content: params.content,
    });

    const after = await this.branding.setLogo(actor.tenantId, uploaded.storageFileId, uploaded.url, actor.userId);

    // SEC-008-style note (see EvidenceService.delete): the old logo file
    // in Drive, if any, is intentionally left in place rather than
    // trashed — ACT-084 has no "replace/delete logo" rule specified, and
    // silently trashing a still-possibly-referenced file (e.g. cached by
    // a client) is a bigger risk than a harmless orphaned Drive file.
    // Revisit if storage cost or Drive clutter ever makes that trade-off
    // worth reconsidering.

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "TenantBranding",
      entityId: actor.tenantId,
      action: before.logoDriveFileId ? "UPDATE" : "CREATE",
      oldValue: { ...before, logoUrl: undefined }, // never put the Drive URL in the audit trail (mirrors EvidenceService)
      newValue: { ...after, logoUrl: undefined },
      reason: null,
      requestId,
    });

    return after;
  }
}
