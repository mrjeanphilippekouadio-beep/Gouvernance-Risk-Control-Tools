import type { AnomalyRepository } from "../domain/repositories/AnomalyRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { Anomaly, AnomalyStatus, CreateAnomalyInput } from "../domain/entities/Anomaly.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/**
 * Rules ported from apps-script-legacy/14_Anomalies.gs: unlike
 * executions/effectiveness assessments, an anomaly is a ticket with a
 * lifecycle (NEW -> UNDER_ANALYSIS -> ACTION_IN_PROGRESS -> CLOSED) on
 * the same row — not append-only. Closing always requires a comment
 * ("on ne referme pas un constat sans dire ce qui a été fait").
 */
export class AnomalyService {
  constructor(
    private readonly anomalies: AnomalyRepository,
    private readonly audit: AuditRepository,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateAnomalyInput, "tenantId" | "detectedBy">,
    requestId: string,
  ): Promise<Anomaly> {
    requirePermission(actor, "anomaly.create");

    if (!input.description.trim()) throw new ValidationError("description is required");

    const anomaly = await this.anomalies.create({
      ...input,
      tenantId: actor.tenantId,
      detectedBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Anomaly",
      entityId: anomaly.id,
      action: "CREATE",
      oldValue: null,
      newValue: anomaly,
      reason: null,
      requestId,
    });

    return anomaly;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Anomaly> {
    requirePermission(actor, "anomaly.read");
    const anomaly = await this.anomalies.getById(actor.tenantId, id);
    if (!anomaly) throw new NotFoundError("Anomaly", id);
    return anomaly;
  }

  async list(actor: AuthenticatedUser, status?: AnomalyStatus): Promise<Anomaly[]> {
    requirePermission(actor, "anomaly.read");
    return this.anomalies.list(actor.tenantId, { status });
  }

  async updateStatus(
    actor: AuthenticatedUser,
    id: string,
    newStatus: AnomalyStatus,
    comment: string | null,
    requestId: string,
  ): Promise<Anomaly> {
    requirePermission(actor, "anomaly.update");
    const before = await this.get(actor, id);

    if (newStatus !== before.status && !VALID_TRANSITIONS[before.status].includes(newStatus)) {
      throw new ValidationError(
        `Cannot transition anomaly from ${before.status} directly to ${newStatus}`,
      );
    }
    if (newStatus === "CLOSED" && !comment?.trim()) {
      throw new ValidationError("Closing an anomaly requires a comment describing what was done");
    }

    const after = await this.anomalies.updateStatus(actor.tenantId, id, newStatus, comment);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Anomaly",
      entityId: id,
      action: newStatus === "CLOSED" ? "CLOSE" : "STATUS_CHANGE",
      oldValue: before,
      newValue: after,
      reason: comment,
      requestId,
    });

    return after;
  }
}

const VALID_TRANSITIONS: Record<AnomalyStatus, AnomalyStatus[]> = {
  NEW: ["UNDER_ANALYSIS", "ACTION_IN_PROGRESS"],
  UNDER_ANALYSIS: ["ACTION_IN_PROGRESS", "CLOSED"],
  ACTION_IN_PROGRESS: ["CLOSED"],
  CLOSED: [],
};
