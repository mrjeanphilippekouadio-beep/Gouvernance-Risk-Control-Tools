import type { FeedbackRepository } from "../domain/repositories/FeedbackRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { Feedback, FeedbackCategory, FeedbackStatus } from "../domain/entities/Feedback.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { Notifier } from "../infrastructure/notifications/Notifier.js";

const VALID_TRANSITIONS: Record<FeedbackStatus, FeedbackStatus[]> = {
  NEW: ["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "DECLINED"],
  ACKNOWLEDGED: ["IN_PROGRESS", "RESOLVED", "DECLINED"],
  IN_PROGRESS: ["RESOLVED", "DECLINED"],
  RESOLVED: [],
  DECLINED: [],
};

export class FeedbackService {
  constructor(
    private readonly feedback: FeedbackRepository,
    private readonly audit: AuditRepository,
    /** Optional so existing callers/tests built before this existed don't need to change. */
    private readonly notifier?: Notifier,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: { category: FeedbackCategory; message: string; page?: string | null },
    requestId: string,
  ): Promise<Feedback> {
    requirePermission(actor, "feedback.create");
    if (!input.message.trim()) throw new ValidationError("message is required");

    const entry = await this.feedback.create({
      tenantId: actor.tenantId,
      userId: actor.userId,
      category: input.category,
      message: input.message,
      page: input.page ?? null,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Feedback",
      entityId: entry.id,
      action: "CREATE",
      oldValue: null,
      newValue: entry,
      reason: null,
      requestId,
    });

    this.notifier
      ?.notify(`Nouveau feedback [${entry.category}]${entry.page ? ` depuis ${entry.page}` : ""}: ${entry.message}`)
      .catch(() => {
        // Best-effort — a broken notification channel must never fail the actual feedback submission.
      });

    return entry;
  }

  async list(actor: AuthenticatedUser, status?: FeedbackStatus): Promise<Feedback[]> {
    requirePermission(actor, "feedback.read");
    return this.feedback.list(actor.tenantId, { status });
  }

  async updateStatus(
    actor: AuthenticatedUser,
    id: string,
    status: FeedbackStatus,
    requestId: string,
  ): Promise<Feedback> {
    requirePermission(actor, "feedback.update");
    const before = await this.feedback.getById(actor.tenantId, id);
    if (!before) throw new NotFoundError("Feedback", id);

    if (!VALID_TRANSITIONS[before.status].includes(status)) {
      throw new ValidationError(`Cannot move feedback from ${before.status} to ${status}`);
    }

    const after = await this.feedback.updateStatus(actor.tenantId, id, status);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Feedback",
      entityId: id,
      action: "STATUS_CHANGE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }
}
