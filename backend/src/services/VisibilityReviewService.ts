import { requirePermission } from "../domain/permissions.js";
import { ForbiddenError, NotFoundError } from "../domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { ReviewableType, VisibilityReviewRepository } from "../domain/repositories/VisibilityReviewRepository.js";
import type { ResourceAccessRepository } from "../domain/repositories/ResourceAccessRepository.js";

/**
 * Conservation L2c (q248 B, q269 A): the Risk Manager confirms the yearly review of a restricted RESOURCE. Reserved to the Risk
 * Manager group (real membership checked server-side, not the permission alone). The review extends nothing and erases nothing;
 * the author is always the authenticated account.
 */
export class VisibilityReviewService {
  constructor(
    private readonly reviews: VisibilityReviewRepository,
    private readonly access: Pick<ResourceAccessRepository, "isRiskManagerMember">,
  ) {}

  async confirm(actor: AuthenticatedUser, type: ReviewableType, id: string, requestId: string): Promise<{ resourceType: ReviewableType; resourceId: string; reviewedAt: Date }> {
    requirePermission(actor, "resourcevisibility.set");
    if (!(await this.access.isRiskManagerMember(actor.tenantId, actor.userId))) {
      throw new ForbiddenError("Only the Risk Manager group can confirm the review of a restriction");
    }
    const done = await this.reviews.confirm(actor.tenantId, type, id, actor.userId, requestId);
    if (!done) throw new NotFoundError("VisibilityReview", id);
    return { resourceType: type, resourceId: id, reviewedAt: done.reviewedAt };
  }
}
