import type { RiskAppetiteRepository } from "../domain/repositories/RiskAppetiteRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type {
  ListRiskAppetiteOptions,
  RiskAppetite,
  SetRiskAppetiteInput,
} from "../domain/entities/RiskAppetite.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

const MIN_THRESHOLD = 1;
const MAX_THRESHOLD = 25;

/**
 * ACT-165 (define/redefine a threshold) and ACT-168 (consult the active
 * appetite table) only. Updated in place, one row per (tenant,
 * subCategory, entity) — see RiskAppetite.ts for why.
 *
 * ACT-166/ACT-167 (auto-compare a residual risk score against the
 * threshold, then alert on breach) are OUT OF SCOPE: they need a
 * RiskEvaluation domain (residual risk scoring) this codebase doesn't
 * have yet. Nothing here should be read as a substitute for that.
 */
export class RiskAppetiteService {
  constructor(
    private readonly appetites: RiskAppetiteRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * PUT /appetite/:subCategory — "Définir ou modifier": upserts the
   * threshold for (tenant, subCategory, entity) as a single write, then
   * records CREATE or UPDATE in the audit trail depending on whether a
   * row already existed for that natural key.
   */
  async setThreshold(
    actor: AuthenticatedUser,
    subCategory: string,
    input: Omit<SetRiskAppetiteInput, "tenantId" | "subCategory">,
    requestId: string,
  ): Promise<RiskAppetite> {
    requirePermission(actor, "riskappetite.update");

    const trimmedSubCategory = subCategory.trim();
    if (!trimmedSubCategory) throw new ValidationError("sous_categorie is required");

    if (!Number.isInteger(input.threshold) || input.threshold < MIN_THRESHOLD || input.threshold > MAX_THRESHOLD) {
      throw new ValidationError(`threshold (seuil) must be an integer between ${MIN_THRESHOLD} and ${MAX_THRESHOLD}`);
    }
    if (!input.methodologyVersion?.trim()) {
      throw new ValidationError("methodologyVersion is required");
    }

    const entity = input.entity?.trim() || null;
    const before = await this.appetites.getBySubCategory(actor.tenantId, trimmedSubCategory, entity);

    const after = await this.appetites.upsert({
      tenantId: actor.tenantId,
      subCategory: trimmedSubCategory,
      entity,
      threshold: input.threshold,
      methodologyVersion: input.methodologyVersion,
      description: input.description ?? null,
      active: input.active ?? true,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RiskAppetite",
      entityId: after.id,
      action: before ? "UPDATE" : "CREATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  /** GET /appetite/:id — direct lookup, not exposed by ACT-168's route but useful for e.g. archive's before-state. */
  async get(actor: AuthenticatedUser, id: string): Promise<RiskAppetite> {
    requirePermission(actor, "riskappetite.read");
    const appetite = await this.appetites.getById(actor.tenantId, id);
    if (!appetite) throw new NotFoundError("RiskAppetite", id);
    return appetite;
  }

  /** GET /appetite — ACT-168's consolidated view; active-only unless the caller opts into includeInactive. */
  async list(actor: AuthenticatedUser, options?: ListRiskAppetiteOptions): Promise<RiskAppetite[]> {
    requirePermission(actor, "riskappetite.read");
    return this.appetites.list(actor.tenantId, options);
  }

  /**
   * Soft-delete ("retirer une appétence"), not part of ACT-165/ACT-168 as
   * specified but required by the table design (soft-delete only, per
   * CLAUDE.md's security-sensitive conventions). Gated on the dedicated
   * riskappetite.delete permission, not riskappetite.update — matching
   * Department/Control/Risk/Kpi, where a terminal-state transition always
   * sits behind its own *.delete permission rather than the generic
   * update one, specifically so holding *.update alone is never enough
   * to archive something.
   */
  async archive(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<void> {
    requirePermission(actor, "riskappetite.delete");
    if (!reason.trim()) throw new ValidationError("A reason is required to retire a risk appetite threshold");
    const before = await this.get(actor, id);

    await this.appetites.softDelete(actor.tenantId, id, actor.userId, reason);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RiskAppetite",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason,
      requestId,
    });
  }
}
