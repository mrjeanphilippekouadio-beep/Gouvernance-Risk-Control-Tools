import { randomUUID } from "node:crypto";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { CreateRiskInput, Risk, UpdateRiskInput } from "../domain/entities/Risk.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/**
 * All business rules and transitions for Risk live here — never in the
 * frontend, never in the repository. This is the layer the ADR-001
 * "Backend décide" example maps to.
 */
export class RiskService {
  constructor(
    private readonly risks: RiskRepository,
    private readonly audit: AuditRepository,
  ) {}

  async create(actor: AuthenticatedUser, input: Omit<CreateRiskInput, "tenantId">, requestId: string): Promise<Risk> {
    requirePermission(actor, "risk.create");
    if (!input.process.trim()) throw new ValidationError("process is required");
    if (!input.description.trim()) throw new ValidationError("description is required");

    const risk = await this.risks.create({ ...input, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
      entityId: risk.id,
      action: "CREATE",
      oldValue: null,
      newValue: risk,
      reason: null,
      requestId,
    });

    return risk;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Risk> {
    requirePermission(actor, "risk.read");
    const risk = await this.risks.getById(actor.tenantId, id);
    if (!risk) throw new NotFoundError("Risk", id);
    return risk;
  }

  async list(actor: AuthenticatedUser, includeArchived = false): Promise<Risk[]> {
    requirePermission(actor, "risk.read");
    return this.risks.list(actor.tenantId, { includeArchived });
  }

  async update(actor: AuthenticatedUser, id: string, input: UpdateRiskInput, requestId: string): Promise<Risk> {
    requirePermission(actor, "risk.update");
    const before = await this.get(actor, id);

    if (input.status) {
      if (input.status === "ARCHIVED") {
        throw new ValidationError("Use the archive endpoint to archive a risk (requires a reason)");
      }
      if (!isValidTransition(before.status, input.status)) {
        throw new ValidationError(`Cannot transition risk from ${before.status} to ${input.status}`);
      }
    }

    const after = await this.risks.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
      entityId: id,
      action: input.status ? "STATUS_CHANGE" : "UPDATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  async archive(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<void> {
    requirePermission(actor, "risk.delete");
    if (!reason.trim()) throw new ValidationError("A reason is required to archive a risk");
    const before = await this.get(actor, id);

    await this.risks.softDelete(actor.tenantId, id, actor.userId, reason);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason,
      requestId,
    });
  }
}

const VALID_TRANSITIONS: Record<Risk["status"], Risk["status"][]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["ARCHIVED"],
  ARCHIVED: [],
};

function isValidTransition(from: Risk["status"], to: Risk["status"]): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from].includes(to);
}

export function newRequestId(): string {
  return `REQ-${randomUUID().slice(0, 8).toUpperCase()}`;
}
