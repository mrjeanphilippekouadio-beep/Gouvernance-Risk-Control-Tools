import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { GovernanceExceptionReviewRepository } from "../domain/repositories/GovernanceReviewRepositories.js";
import { isAcceptableReason } from "../domain/governance/selfValidation.js";
import type { ExceptionReviewOutcome, GovernanceExceptionReview } from "../domain/entities/GovernanceReviews.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

export const MAX_REVIEW_COMMENT_LENGTH = 500;

/**
 * DECISION-074 R-1 line 3 (lot D5): a third party's review of an action applied without a second validation.
 * Add-only: a review is never edited or cancelled. `reviewedBy` is the authenticated actor, never the request; the author
 * of the reviewed action cannot review it (service + trigger). CONTESTED (q157, the Audit's way to object) changes no
 * business state: the Audit never decides — it records its objection and the Risk Manager / Committee are notified.
 */
export class GovernanceExceptionService {
  constructor(
    private readonly reviews: GovernanceExceptionReviewRepository,
    private readonly audit: AuditRepository,
  ) {}

  async review(
    actor: AuthenticatedUser,
    auditLogId: string,
    input: { outcome: ExceptionReviewOutcome; comment: string },
    requestId: string,
  ): Promise<GovernanceExceptionReview> {
    requirePermission(actor, "governanceexception.review");
    if (input.outcome !== "REVIEWED" && input.outcome !== "CONTESTED") throw new ValidationError("outcome must be REVIEWED or CONTESTED");
    const comment = typeof input.comment === "string" ? input.comment.trim() : "";
    if (!comment || !isAcceptableReason(comment)) throw new ValidationError("A comment is required");
    if (comment.length > MAX_REVIEW_COMMENT_LENGTH) throw new ValidationError(`The comment must be at most ${MAX_REVIEW_COMMENT_LENGTH} characters`);

    // Tenant-scoped lookup first; an entry that is not an exception looks exactly like an unknown one.
    const entry = await this.reviews.getAuditEntry(actor.tenantId, auditLogId);
    if (!entry || !entry.reviewable) throw new NotFoundError("GovernanceException", auditLogId);
    if (entry.userId === actor.userId) throw new ForbiddenError("The author of an action cannot review it");

    return this.reviews.insert(
      { tenantId: actor.tenantId, auditLogId, outcome: input.outcome, reviewedBy: actor.userId, comment },
      (created) => [
        {
          tenantId: actor.tenantId,
          userId: actor.userId,
          entityType: "GovernanceExceptionReview",
          entityId: created.id,
          action: "CREATE",
          oldValue: null,
          newValue: {
            id: created.id,
            auditLogId,
            outcome: created.outcome,
            reviewedEntityType: entry.entityType,
            reviewedEntityId: entry.entityId,
          },
          reason: comment,
          requestId,
        },
      ],
    );
  }
}
