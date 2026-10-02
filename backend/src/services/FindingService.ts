import type { FindingRepository } from "../domain/repositories/FindingRepository.js";
import type { AuditMissionRepository } from "../domain/repositories/AuditMissionRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { ControlRepository } from "../domain/repositories/ControlRepository.js";
import type { AnomalyRepository } from "../domain/repositories/AnomalyRepository.js";
import {
  FINDING_RELATED_OBJECT_TYPES,
  type CreateFindingInput,
  type Finding,
  type FindingListFilters,
  type FindingRelatedObjectType,
} from "../domain/entities/Finding.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

const RELATED_OBJECT_TYPES: readonly FindingRelatedObjectType[] = FINDING_RELATED_OBJECT_TYPES;
/** Same asymmetry as ActionPlan's ENTITY_BACKED_SOURCE_TYPES: INCIDENT has no backing table in this codebase yet, so it's accepted but never existence-checked. */
const ENTITY_BACKED_RELATED_OBJECT_TYPES: FindingRelatedObjectType[] = ["RISK", "CONTROL", "ANOMALY"];

export interface CreateFindingRequest {
  auditMissionId: string;
  title: string;
  description: string;
  severity: CreateFindingInput["severity"];
  recommendation?: string | null;
  relatedObjectType?: FindingRelatedObjectType | null;
  relatedObjectId?: string | null;
}

/**
 * Lot 4 (Audit module), GRC_Target_Domain_Model.md §9.2. Ticket-lifecycle
 * pattern (OUVERT -> EN_TRAITEMENT -> CLOS), same shape as Anomaly.
 *
 * Two rules beyond Anomaly's:
 *  - a Finding can only be raised against a mission that's EN_COURS
 *    (constats are levés "pendant la mission", per the task brief — not
 *    before it starts, not after it's closed);
 *  - closing is maker-checker gated: the auditor who raised the Finding
 *    can never be the one who validates its closure (task brief's own
 *    suggestion, mirrors RiskEvaluationService/ActionPlanService.close).
 *
 * "suivi des recommandations" is deliberately not a feature of this
 * service beyond the plain `recommendation` text field — see Finding.ts's
 * module comment for why that follow-up belongs to ActionPlanService
 * (sourceType = "FINDING") instead of a parallel status machine here.
 */
export class FindingService {
  constructor(
    private readonly findings: FindingRepository,
    private readonly missions: AuditMissionRepository,
    private readonly audit: AuditRepository,
    /**
     * Optional so tests built without them keep compiling — but
     * server.ts MUST wire the real repositories, otherwise
     * relatedObjectId stays unvalidated (same shape as AnomalyService's
     * optional controls/controlExecutions/risks).
     */
    private readonly risks?: RiskRepository,
    private readonly controls?: ControlRepository,
    private readonly anomalies?: AnomalyRepository,
  ) {}

  async create(actor: AuthenticatedUser, input: CreateFindingRequest, requestId: string): Promise<Finding> {
    requirePermission(actor, "audit.finding.create");

    if (!input.auditMissionId?.trim()) throw new ValidationError("auditMissionId is required");
    if (!input.title?.trim()) throw new ValidationError("title is required");
    if (!input.description?.trim()) throw new ValidationError("description is required");

    const mission = await this.missions.getById(actor.tenantId, input.auditMissionId);
    if (!mission) throw new ValidationError(`AuditMission ${input.auditMissionId} does not exist in this tenant`);
    if (mission.status !== "EN_COURS") {
      throw new ValidationError(
        `Cannot raise a Finding against a mission that is not EN_COURS (current status: ${mission.status})`,
      );
    }

    const hasType = !!input.relatedObjectType;
    const hasId = !!input.relatedObjectId?.trim();
    if (hasType !== hasId) {
      throw new ValidationError("relatedObjectType and relatedObjectId must be both set or both omitted");
    }
    if (hasType && !RELATED_OBJECT_TYPES.includes(input.relatedObjectType as FindingRelatedObjectType)) {
      throw new ValidationError(`relatedObjectType must be one of: ${RELATED_OBJECT_TYPES.join(", ")}`);
    }
    if (hasType) {
      await this.assertRelatedObjectExists(
        actor.tenantId,
        input.relatedObjectType as FindingRelatedObjectType,
        input.relatedObjectId as string,
      );
    }

    const createInput: CreateFindingInput = {
      tenantId: actor.tenantId,
      auditMissionId: input.auditMissionId,
      title: input.title.trim(),
      description: input.description.trim(),
      severity: input.severity,
      recommendation: input.recommendation?.trim() || null,
      relatedObjectType: hasType ? (input.relatedObjectType as FindingRelatedObjectType) : null,
      relatedObjectId: hasId ? (input.relatedObjectId as string) : null,
      raisedBy: actor.userId,
    };

    const finding = await this.findings.create(createInput);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Finding",
      entityId: finding.id,
      action: "CREATE",
      oldValue: null,
      newValue: finding,
      reason: null,
      requestId,
    });

    return finding;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Finding> {
    requirePermission(actor, "audit.finding.read");
    return this.getRaw(actor, id);
  }

  async list(actor: AuthenticatedUser, filters?: FindingListFilters): Promise<Finding[]> {
    requirePermission(actor, "audit.finding.read");
    return this.findings.list(actor.tenantId, filters);
  }

  /** OUVERT -> EN_TRAITEMENT. Narrow, non-terminal transition — same permission tier as ActionPlanService.start/AnomalyService.updateStatus for non-terminal moves. */
  async startTreatment(actor: AuthenticatedUser, id: string, requestId: string): Promise<Finding> {
    requirePermission(actor, "audit.finding.update");
    const before = await this.getRaw(actor, id);

    if (before.status !== "OUVERT") {
      throw new ValidationError(`Cannot start treatment on a Finding that is not OUVERT (current status: ${before.status})`);
    }

    const after = await this.findings.updateStatus(actor.tenantId, id, "EN_TRAITEMENT");

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Finding",
      entityId: id,
      action: "STATUS_CHANGE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  /**
   * Terminal transition -> CLOS. Dedicated permission (audit.finding.close,
   * never audit.finding.update), mandatory closure comment, and
   * maker-checker: the actor who raised the Finding can never be the one
   * who closes it (task brief's own suggestion, mirrors
   * RiskEvaluationService's evaluator != validator and
   * ActionPlanService.close's createdBy != closer checks).
   */
  async close(actor: AuthenticatedUser, id: string, comment: string, requestId: string): Promise<Finding> {
    requirePermission(actor, "audit.finding.close");
    const before = await this.getRaw(actor, id);

    if (before.status !== "EN_TRAITEMENT") {
      throw new ValidationError(
        `Cannot close a Finding unless it is EN_TRAITEMENT (current status: ${before.status})`,
      );
    }
    if (!comment?.trim()) {
      throw new ValidationError("Closing a Finding requires a closure comment");
    }
    if (before.raisedBy === actor.userId) {
      throw new ForbiddenError("The auditor who raised this Finding cannot close it themselves — ask another auditor to close it");
    }

    const after = await this.findings.close(actor.tenantId, id, actor.userId, comment.trim());

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Finding",
      entityId: id,
      action: "CLOSE",
      oldValue: before,
      newValue: after,
      reason: comment,
      requestId,
    });

    return after;
  }

  private async getRaw(actor: AuthenticatedUser, id: string): Promise<Finding> {
    const finding = await this.findings.getById(actor.tenantId, id);
    if (!finding) throw new NotFoundError("Finding", id);
    return finding;
  }

  private async assertRelatedObjectExists(
    tenantId: string,
    relatedObjectType: FindingRelatedObjectType,
    relatedObjectId: string,
  ): Promise<void> {
    if (!ENTITY_BACKED_RELATED_OBJECT_TYPES.includes(relatedObjectType)) return;

    if (relatedObjectType === "RISK" && this.risks) {
      const risk = await this.risks.getById(tenantId, relatedObjectId);
      if (!risk) throw new ValidationError(`Risk ${relatedObjectId} does not exist in this tenant`);
    } else if (relatedObjectType === "CONTROL" && this.controls) {
      const control = await this.controls.getById(tenantId, relatedObjectId);
      if (!control) throw new ValidationError(`Control ${relatedObjectId} does not exist in this tenant`);
    } else if (relatedObjectType === "ANOMALY" && this.anomalies) {
      const anomaly = await this.anomalies.getById(tenantId, relatedObjectId);
      if (!anomaly) throw new ValidationError(`Anomaly ${relatedObjectId} does not exist in this tenant`);
    }
  }
}
