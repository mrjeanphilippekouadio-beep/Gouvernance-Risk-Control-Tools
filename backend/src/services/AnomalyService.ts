import { maskHiddenRisks } from "./riskVisibility.js";
import type { AnomalyRepository } from "../domain/repositories/AnomalyRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { ControlRepository } from "../domain/repositories/ControlRepository.js";
import type { ControlExecutionRepository } from "../domain/repositories/ControlExecutionRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { Anomaly, AnomalyStatus, CreateAnomalyInput } from "../domain/entities/Anomaly.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { VisibilityResolver } from "./VisibilityResolver.js";
import { READER_DEFAULT_SCOPE, readerScope, type Visibility } from "../domain/visibility.js";
import type { ResourceVisibilityManager, VisibilityTarget } from "./resourceVisibility.js";
import { sameUserId } from "./resourceVisibility.js";
import type { ResourceVisibilityState } from "../domain/repositories/ResourceAccessRepository.js";

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
    /**
     * SEC-004: optional so existing callers/tests built before this
     * existed don't need to change — but server.ts MUST wire the real
     * repositories, otherwise controlId/controlExecutionId/riskId stay
     * unvalidated and the finding is not actually fixed in production.
     */
    private readonly controls?: ControlRepository,
    private readonly controlExecutions?: ControlExecutionRepository,
    private readonly risks?: RiskRepository,
    /** DECISION-100 (lot V0): optional for existing tests — absent, a reader sees CLIENT rows only (fail-closed, SEC V0-01). Wired in server.ts. */
    private readonly visibility?: VisibilityResolver,
    /** Lot V2: own level and list of an anomaly without risk or control. Optional: absent, restriction refused. */
    private readonly access?: ResourceVisibilityManager,
  ) {}

  /** Spec §1: an anomaly follows its risk, else its control, else its own level; the declarer stands for the owner. */
  private target(a: Anomaly): VisibilityTarget {
    return {
      type: "ANOMALY",
      entity: "Anomaly",
      id: a.id,
      visibility: a.visibility ?? "CLIENT",
      ownerId: a.detectedBy,
      inheritsFrom: a.riskId ? "RISK" : a.controlId || a.controlExecutionId ? "CONTROL" : null,
    };
  }

  /** QA-VIS1-02 / QA-VIS2-02: hidden risk, control and execution ids are removed from a readable anomaly. */
  private async masked(actor: AuthenticatedUser, rows: Anomaly[]): Promise<Anomaly[]> {
    const withoutRisk = await withoutHiddenRisk(this.risks, actor, rows);
    return this.access ? this.access.maskAnomalyParents(actor, withoutRisk) : withoutRisk;
  }

  private async getRaw(actor: AuthenticatedUser, id: string): Promise<Anomaly> {
    const anomaly = await this.anomalies.getById(actor.tenantId, id, (await this.visibility?.resolve(actor)) ?? READER_DEFAULT_SCOPE);
    if (!anomaly) throw new NotFoundError("Anomaly", id);
    return anomaly;
  }

  async getAccess(actor: AuthenticatedUser, id: string): Promise<ResourceVisibilityState & { inheritsFrom: string | null }> {
    requirePermission(actor, "anomaly.read");
    const anomaly = await this.getRaw(actor, id);
    const target = this.target(anomaly);
    const state = this.access ? await this.access.get(actor, target) : { visibility: target.visibility, accessUserIds: [] };
    return { ...state, inheritsFrom: target.inheritsFrom };
  }

  async setVisibility(
    actor: AuthenticatedUser,
    id: string,
    input: { visibility: Visibility; addUserIds?: string[]; revokeUserIds?: string[]; reason: string },
    requestId: string,
  ): Promise<ResourceVisibilityState> {
    requirePermission(actor, "anomaly.read");
    const anomaly = await this.getRaw(actor, id);
    if (!this.access) throw new ValidationError("Changing an anomaly's visibility is not available");
    return this.access.set(actor, this.target(anomaly), input, requestId);
  }

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateAnomalyInput, "tenantId" | "detectedBy">,
    requestId: string,
  ): Promise<Anomaly> {
    requirePermission(actor, "anomaly.create");

    if (!input.description.trim()) throw new ValidationError("description is required");

    // SEC-004: these references are optional, but if given they must
    // belong to the caller's tenant — otherwise an anomaly can point at
    // another tenant's control/execution/risk (latent today, single
    // tenant; a real cross-tenant leak the moment that changes).
    // Lot V2: a link to a control, execution or risk the declarer does not see answers like a missing one.
    if (input.controlId && this.controls) {
      const control = await this.controls.getById(actor.tenantId, input.controlId, readerScope(actor));
      if (!control) throw new ValidationError(`Control ${input.controlId} does not exist in this tenant`);
    }
    if (input.controlExecutionId && this.controlExecutions) {
      const execution = await this.controlExecutions.getById(actor.tenantId, input.controlExecutionId);
      const readable = execution && (sameUserId(execution.executedBy, actor.userId)
        || !this.controls || (await this.controls.getById(actor.tenantId, execution.controlId, readerScope(actor))) !== null);
      if (!readable) {
        throw new ValidationError(`ControlExecution ${input.controlExecutionId} does not exist in this tenant`);
      }
    }
    if (input.riskId && this.risks) {
      const risk = await this.risks.getById(actor.tenantId, input.riskId, readerScope(actor));
      if (!risk) throw new ValidationError(`Risk ${input.riskId} does not exist in this tenant`);
    }

    const visibility: Visibility = input.visibility ?? "CLIENT";
    if (visibility !== "CLIENT") {
      if (!this.access) throw new ValidationError("Restricted visibility is not available");
      // The declarer is the owner account of the anomaly: they always see it.
      await this.access.assertCreation(actor, {
        visibility,
        inheritsFrom: input.riskId ? "RISK" : input.controlId || input.controlExecutionId ? "CONTROL" : null,
        isOwner: true,
        departmentId: null,
        processId: null,
      }, false);
    }

    const anomaly = await this.anomalies.create({
      ...input,
      visibility,
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
    const anomaly = await this.getRaw(actor, id);
    return (await this.masked(actor, [anomaly]))[0]!;
  }

  async list(actor: AuthenticatedUser, status?: AnomalyStatus): Promise<Anomaly[]> {
    requirePermission(actor, "anomaly.read");
    return this.masked(actor, await this.anomalies.list(actor.tenantId, { status }, (await this.visibility?.resolve(actor)) ?? READER_DEFAULT_SCOPE));
  }

  async updateStatus(
    actor: AuthenticatedUser,
    id: string,
    newStatus: AnomalyStatus,
    comment: string | null,
    requestId: string,
  ): Promise<Anomaly> {
    requirePermission(actor, "anomaly.update");
    requirePermission(actor, "anomaly.read");
    // The audit keeps the stored row (its real riskId); only the answer is masked.
    const before = await this.anomalies.getById(actor.tenantId, id, (await this.visibility?.resolve(actor)) ?? READER_DEFAULT_SCOPE);
    if (!before) throw new NotFoundError("Anomaly", id);

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

    // Codex P2: the mutation answer is masked like the reads.
    return (await this.masked(actor, [after]))[0]!;
  }
}

const VALID_TRANSITIONS: Record<AnomalyStatus, AnomalyStatus[]> = {
  NEW: ["UNDER_ANALYSIS", "ACTION_IN_PROGRESS"],
  UNDER_ANALYSIS: ["ACTION_IN_PROGRESS", "CLOSED"],
  ACTION_IN_PROGRESS: ["CLOSED"],
  CLOSED: [],
};

/** QA-VIS1-02: a readable anomaly linked to a risk the reader may not see shows no risk (riskId null). */
export function withoutHiddenRisk(risks: Pick<RiskRepository, "hiddenIds"> | undefined, actor: AuthenticatedUser, rows: Anomaly[]): Promise<Anomaly[]> {
  return maskHiddenRisks(risks, actor, rows, (a) => [a.riskId], (a, hidden) => (a.riskId && hidden.has(a.riskId) ? { ...a, riskId: null } : a));
}
