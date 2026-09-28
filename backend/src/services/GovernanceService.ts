import type { ReviewCycleRepository } from "../domain/repositories/ReviewCycleRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { ReviewCycle, ReviewCycleType } from "../domain/entities/ReviewCycle.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { Notifier } from "../infrastructure/notifications/Notifier.js";

const CYCLE_TYPES: ReviewCycleType[] = ["ANNUELLE", "ANTICIPEE"];

export interface CreateReviewCycleRequest {
  type: ReviewCycleType;
  title: string;
  scope?: string | null;
  /** Mandatory when type is ANTICIPEE (ACT-251); ignored/must be omitted for ANNUELLE. */
  reason?: string | null;
}

/**
 * ACT-250/251/252: review-cycle campaigns (annual or triggered), ticket
 * lifecycle on one row. Kept independent from NotificationService/Part A
 * on purpose (no shared code between the two slices in this batch) —
 * "notify Risk Owners at creation" uses the same best-effort, optional
 * `Notifier` broadcast pattern already used by ActionPlanService/
 * KriMeasureService, not a persistent per-user notification record.
 */
export class GovernanceService {
  constructor(
    private readonly cycles: ReviewCycleRepository,
    private readonly audit: AuditRepository,
    /** Optional — same pattern as ActionPlanService/KriMeasureService/FeedbackService. */
    private readonly notifier?: Notifier,
  ) {}

  /** ACT-250 (type=ANNUELLE) and ACT-251 (type=ANTICIPEE, motif obligatoire) — same endpoint, differentiated by type. */
  async create(actor: AuthenticatedUser, input: CreateReviewCycleRequest, requestId: string): Promise<ReviewCycle> {
    requirePermission(actor, "governance.create");

    if (!CYCLE_TYPES.includes(input.type)) {
      throw new ValidationError(`type must be one of: ${CYCLE_TYPES.join(", ")}`);
    }
    if (!input.title?.trim()) throw new ValidationError("title is required");
    if (input.type === "ANTICIPEE" && !input.reason?.trim()) {
      throw new ValidationError("reason is required for an ANTICIPEE review cycle (incident, changement majeur, résultat audit)");
    }

    const cycle = await this.cycles.create({
      tenantId: actor.tenantId,
      type: input.type,
      title: input.title.trim(),
      scope: input.scope?.trim() || null,
      reason: input.type === "ANTICIPEE" ? (input.reason as string).trim() : null,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ReviewCycle",
      entityId: cycle.id,
      action: "CREATE",
      oldValue: null,
      newValue: cycle,
      reason: cycle.reason,
      requestId,
    });

    this.notifier
      ?.notify(
        `Nouveau cycle de revue de cartographie [${cycle.type}] "${cycle.title}" ouvert — merci de revoir vos risques.`,
      )
      .catch(() => {
        // Best-effort — a broken notification channel must never fail the actual creation.
      });

    return cycle;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<ReviewCycle> {
    requirePermission(actor, "governance.read");
    const cycle = await this.cycles.getById(actor.tenantId, id);
    if (!cycle) throw new NotFoundError("ReviewCycle", id);
    return cycle;
  }

  async list(actor: AuthenticatedUser, filters?: { status?: ReviewCycle["status"]; type?: ReviewCycleType }): Promise<ReviewCycle[]> {
    requirePermission(actor, "governance.read");
    return this.cycles.list(actor.tenantId, filters);
  }

  /**
   * ACT-252 step 1 (maker): Risk Manager proposes closure. Gated behind
   * governance.create (the same permission used to open a cycle) since
   * this is the Risk Manager side of the maker-checker, not the
   * Direction-side validation.
   */
  async proposeClosure(actor: AuthenticatedUser, id: string, comment: string | null, requestId: string): Promise<ReviewCycle> {
    requirePermission(actor, "governance.create");
    const before = await this.get(actor, id);

    if (before.status !== "OUVERT") {
      throw new ValidationError(`Cannot propose closure for a cycle that is not OUVERT (current status: ${before.status})`);
    }

    const after = await this.cycles.proposeClosure(actor.tenantId, id, actor.userId, comment?.trim() || null);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ReviewCycle",
      entityId: id,
      action: "STATUS_CHANGE",
      oldValue: before,
      newValue: after,
      reason: comment ?? null,
      requestId,
    });

    return after;
  }

  /**
   * ACT-252 step 2 (checker): Direction validates and closes. Terminal,
   * immutable afterwards. The proposer can never be the closer (maker !=
   * checker), mirroring RiskEvaluationService's evaluator != validator
   * guard and ActionPlanService's creator != closer guard.
   */
  async close(actor: AuthenticatedUser, id: string, comment: string | null, requestId: string): Promise<ReviewCycle> {
    requirePermission(actor, "governance.validate");
    const before = await this.get(actor, id);

    if (before.status !== "CLOTURE_PROPOSEE") {
      throw new ValidationError(`Cannot close a cycle that has no pending closure proposal (current status: ${before.status})`);
    }
    if (before.proposedClosureBy === actor.userId) {
      throw new ForbiddenError("The actor who proposed closing this review cycle cannot also validate it (maker-checker)");
    }

    const after = await this.cycles.close(actor.tenantId, id, actor.userId, comment?.trim() || null);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ReviewCycle",
      entityId: id,
      action: "CLOSE",
      oldValue: before,
      newValue: after,
      reason: comment ?? null,
      requestId,
    });

    return after;
  }
}
