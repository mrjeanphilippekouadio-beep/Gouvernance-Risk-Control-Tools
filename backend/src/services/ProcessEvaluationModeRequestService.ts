import type { ProcessEvaluationModeRequestRepository } from "../domain/repositories/ProcessEvaluationModeRequestRepository.js";
import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { Process } from "../domain/entities/Process.js";
import type { EvaluationMode } from "../domain/entities/Config.js";
import type { ProcessEvaluationModeRequest, RiskOwnerRef } from "../domain/entities/ProcessEvaluationModeRequest.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

export interface ProcessEvaluationModeRequestWithOwners extends ProcessEvaluationModeRequest {
  /**
   * DECISION-006 governance finding: risk owners of the process, surfaced
   * here so they are *visible and audited* at validation time —
   * `validate()`/`reject()` never read this field for authorization,
   * only `requirePermission(actor, "evaluationmode.validate")` and
   * `assertNotSelfValidated` do. See RiskOwnerRef's doc comment.
   */
  riskOwners: RiskOwnerRef[];
}

/**
 * SEC-011-family guard: the validator can never be the proposer, no
 * exception — mirrors RiskEvaluationService's assertIsEvaluator and
 * GovernanceService.close's proposedClosureBy check. Applied to both
 * validate() and reject(), the two terminal transitions of a maker
 * (propose) / checker (validate|reject) workflow: a Risk Manager holding
 * `evaluationmode.validate` who also proposed the change must still have
 * a different person decide it.
 */
function assertNotSelfValidated(actor: AuthenticatedUser, request: ProcessEvaluationModeRequest): void {
  if (request.requestedBy === actor.userId) {
    throw new ForbiddenError(
      "The actor who proposed this evaluation-mode change cannot also validate or reject it (maker-checker) — no exception, even for a Risk Manager holding evaluationmode.validate",
    );
  }
}

function assertPending(request: ProcessEvaluationModeRequest): void {
  if (request.status !== "PENDING_VALIDATION") {
    throw new ValidationError(
      `This evaluation-mode request has already been decided (${request.status}) and cannot be validated or rejected again`,
    );
  }
}

/**
 * Governance finding (gouvernance refresh audit, 2026-09-29): DECISION-006
 * reserves the Classique/Participatif setting to the PROCESS level only
 * (inherited down to SUBPROCESS/ACTIVITY by resolveInheritedEvaluationMode)
 * — setting it directly on a SUBPROCESS/ACTIVITY would silently win over
 * its ancestor PROCESS's mode. Applied to every write path in this
 * service (propose/validate/setMode), mirroring the same guard added to
 * ProcessService.setEvaluationMode.
 */
function assertProcessLevel(process: Process): void {
  if (process.level !== "PROCESS") {
    throw new ValidationError(
      `evaluationMode can only be set on a PROCESS-level item (${process.id} is a ${process.level}) — DECISION-006 reserves the setting to the PROCESS level, inherited down to SUBPROCESS/ACTIVITY`,
    );
  }
}

/**
 * DECISION-006 (.claude/agent-context/ACTION_ITEMS.md, gouvernance,
 * 2026-09-29, Option A confirmed by the PO): the process-owner path of
 * setting Classique/Participatif ("propriétaire du processus sous
 * réserve de validation"), plus the direct Risk-Manager path
 * (`setMode`), kept as a genuinely separate method rather than an
 * internal propose()+validate() shortcut.
 *
 * Model gap, documented rather than worked around (per the PO's
 * instruction not to block on it): `Process.owner` is free text, not an
 * FK-based authorization subject (unlike `Risk.ownerId`), so `propose()`
 * cannot verify "the actor really is this process's owner" today —
 * it is gated by a dedicated permission
 * (`process.evaluationmode.propose`) instead, granted to whichever
 * roles (process owners, Risk Manager) an organization wants able to
 * open a proposal. Whoever ends up holding `evaluationmode.validate`
 * still can never validate their own proposal, so this gap does not
 * weaken the maker-checker guarantee itself.
 */
export class ProcessEvaluationModeRequestService {
  constructor(
    private readonly requests: ProcessEvaluationModeRequestRepository,
    private readonly processes: ProcessRepository,
    private readonly risks: RiskRepository,
    private readonly audit: AuditRepository,
  ) {}

  /** Maker step: process owner (or Risk Manager) proposes a mode change. Creates a PENDING_VALIDATION row; never touches Process.evaluationMode. */
  async propose(
    actor: AuthenticatedUser,
    processId: string,
    requestedMode: EvaluationMode,
    requestId: string,
  ): Promise<ProcessEvaluationModeRequest> {
    requirePermission(actor, "process.evaluationmode.propose");

    const process = await this.processes.getById(actor.tenantId, processId);
    if (!process) throw new NotFoundError("Process", processId);
    assertProcessLevel(process);

    const created = await this.requests.create({
      tenantId: actor.tenantId,
      processId,
      requestedMode,
      requestedBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ProcessEvaluationModeRequest",
      entityId: created.id,
      action: "CREATE",
      oldValue: null,
      newValue: created,
      reason: null,
      requestId,
    });

    return created;
  }

  /** Read a request with its process's risk owners attached — visible, never authoritative (DECISION-006). */
  async get(actor: AuthenticatedUser, id: string): Promise<ProcessEvaluationModeRequestWithOwners> {
    requirePermission(actor, "evaluationmode.validate");
    const request = await this.requests.getById(actor.tenantId, id);
    if (!request) throw new NotFoundError("ProcessEvaluationModeRequest", id);

    const riskOwners = await this.getRiskOwners(actor.tenantId, request.processId);
    return { ...request, riskOwners };
  }

  async listForProcess(actor: AuthenticatedUser, processId: string): Promise<ProcessEvaluationModeRequest[]> {
    requirePermission(actor, "process.read");
    return this.requests.list(actor.tenantId, { processId });
  }

  /**
   * Checker step (endorse): applies `requestedMode` onto
   * `processes.evaluation_mode` and marks the request VALIDATED. Risk
   * owners of the process are captured on the audit record (visible +
   * audited, never authoritative — DECISION-006).
   */
  async validate(actor: AuthenticatedUser, id: string, requestId: string): Promise<Process> {
    requirePermission(actor, "evaluationmode.validate");
    const request = await this.requests.getById(actor.tenantId, id);
    if (!request) throw new NotFoundError("ProcessEvaluationModeRequest", id);
    assertPending(request);
    assertNotSelfValidated(actor, request);

    const beforeProcess = await this.processes.getById(actor.tenantId, request.processId);
    if (!beforeProcess) throw new NotFoundError("Process", request.processId);
    assertProcessLevel(beforeProcess);

    const riskOwners = await this.getRiskOwners(actor.tenantId, request.processId);

    const afterProcess = await this.processes.update(actor.tenantId, request.processId, {
      evaluationMode: request.requestedMode,
    });
    const validatedRequest = await this.requests.validate(actor.tenantId, id, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Process",
      entityId: request.processId,
      action: "UPDATE",
      oldValue: beforeProcess,
      newValue: afterProcess,
      reason: null,
      requestId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ProcessEvaluationModeRequest",
      entityId: id,
      action: "VALIDATE",
      oldValue: request,
      // riskOwners embedded here so validation-time risk ownership is
      // captured in the audit trail (DECISION-006: visible + audited,
      // never authoritative — not read by any permission check above).
      newValue: { ...validatedRequest, riskOwners },
      reason: null,
      requestId,
    });

    return afterProcess;
  }

  /** Checker step (reject): marks the request REJECTED. Never touches processes.evaluation_mode. */
  async reject(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<ProcessEvaluationModeRequest> {
    requirePermission(actor, "evaluationmode.validate");
    if (!reason?.trim()) throw new ValidationError("A reason is required to reject an evaluation-mode request");

    const request = await this.requests.getById(actor.tenantId, id);
    if (!request) throw new NotFoundError("ProcessEvaluationModeRequest", id);
    assertPending(request);
    assertNotSelfValidated(actor, request);

    const rejected = await this.requests.reject(actor.tenantId, id, actor.userId, reason.trim());

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ProcessEvaluationModeRequest",
      entityId: id,
      action: "REJECT",
      oldValue: request,
      newValue: rejected,
      reason: reason.trim(),
      requestId,
    });

    return rejected;
  }

  /**
   * Direct Risk-Manager path (DECISION-006 point 3): sets
   * Process.evaluationMode immediately, gated by the existing
   * `process.evaluationmode.set` permission (PR #17 / ProcessService.
   * setEvaluationMode). Deliberately a separate method — never a
   * propose()+validate() shortcut chained internally — and never touches
   * the requests table.
   */
  async setMode(actor: AuthenticatedUser, processId: string, mode: EvaluationMode | null, requestId: string): Promise<Process> {
    requirePermission(actor, "process.evaluationmode.set");
    const before = await this.processes.getById(actor.tenantId, processId);
    if (!before) throw new NotFoundError("Process", processId);
    assertProcessLevel(before);

    const after = await this.processes.update(actor.tenantId, processId, { evaluationMode: mode });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Process",
      entityId: processId,
      action: "UPDATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  /**
   * DECISION-006 governance finding: risk ownership within the process
   * under review, resolved in-memory from RiskRepository.list (no
   * process-scoped repository method exists yet, and the risk table
   * isn't expected to be large enough per tenant to need one — same
   * reasoning as RiskOwnershipService). Display/audit data only — never
   * consulted for authorization.
   */
  private async getRiskOwners(tenantId: string, processId: string): Promise<RiskOwnerRef[]> {
    const risks = await this.risks.list(tenantId);
    return risks
      .filter((r): r is typeof r & { ownerId: string } => r.processId === processId && r.ownerId !== null)
      .map((r) => ({ riskId: r.id, ownerId: r.ownerId }));
  }
}
