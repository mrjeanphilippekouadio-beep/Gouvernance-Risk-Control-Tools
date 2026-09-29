import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import {
  PROCESS_LEVEL_BY_RANK,
  PROCESS_LEVEL_RANK,
  resolveInheritedEvaluationMode,
  type CreateProcessInput,
  type Process,
  type UpdateProcessInput,
} from "../domain/entities/Process.js";
import type { EvaluationMode } from "../domain/entities/Config.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/**
 * Rules ported from apps-script-legacy/07_Processus.gs
 * (validerHierarchieProcessus_): a 3-level hierarchy — a PROCESS is
 * always root (no parent), a SUBPROCESS's parent must be a PROCESS, an
 * ACTIVITY's parent must be a SUBPROCESS. No self-parenting.
 */
export class ProcessService {
  constructor(
    private readonly processes: ProcessRepository,
    private readonly audit: AuditRepository,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateProcessInput, "tenantId">,
    requestId: string,
  ): Promise<Process> {
    requirePermission(actor, "process.create");
    if (!input.name.trim()) throw new ValidationError("name is required");
    await this.validateHierarchy(actor.tenantId, input.level, input.parentId ?? null, null);

    const process = await this.processes.create({ ...input, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Process",
      entityId: process.id,
      action: "CREATE",
      oldValue: null,
      newValue: process,
      reason: null,
      requestId,
    });

    return process;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Process> {
    requirePermission(actor, "process.read");
    const process = await this.processes.getById(actor.tenantId, id);
    if (!process) throw new NotFoundError("Process", id);
    return process;
  }

  async list(actor: AuthenticatedUser, includeInactive = false): Promise<Process[]> {
    requirePermission(actor, "process.read");
    return this.processes.list(actor.tenantId, { includeInactive });
  }

  /**
   * Governance finding (2026-09-29 architect review, DECISION-006):
   * `evaluationMode` must never travel through this generic update —
   * `process.update` is widely held by anyone allowed to rename a
   * process, and Classique/Participatif is a governance-relevant
   * transition, same family as SEC-013/SEC-014. Excluded from the input
   * type (not just filtered at runtime) so no caller can pass it here by
   * mistake; use `setEvaluationMode` instead.
   */
  async update(
    actor: AuthenticatedUser,
    id: string,
    input: Omit<UpdateProcessInput, "evaluationMode">,
    requestId: string,
  ): Promise<Process> {
    requirePermission(actor, "process.update");
    const before = await this.get(actor, id);

    if (input.level !== undefined || input.parentId !== undefined) {
      const level = input.level ?? before.level;
      const parentId = input.parentId !== undefined ? input.parentId : before.parentId;
      await this.validateHierarchy(actor.tenantId, level, parentId, id);
    }

    const after = await this.processes.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Process",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  /**
   * DECISION-006 governance finding: the only write path for
   * Process.evaluationMode. Gated by a permission dedicated to this
   * transition and reserved to the Risk Manager (process.evaluationmode.
   * set), never by the generic process.update — mirrors
   * RiskAppetiteService.setThreshold being separate from a generic
   * update, and SEC-013/SEC-014's "terminal/governance transition needs
   * its own permission" convention (ADR-003). This is the direct
   * Risk-Manager path only; the propose/validate workflow for the
   * process-owner path (ACTION_ITEMS.md DECISION-006 point gouvernance)
   * is specified but not yet built and is out of scope here.
   */
  async setEvaluationMode(
    actor: AuthenticatedUser,
    id: string,
    evaluationMode: EvaluationMode | null,
    requestId: string,
  ): Promise<Process> {
    requirePermission(actor, "process.evaluationmode.set");
    const before = await this.get(actor, id);

    const after = await this.processes.update(actor.tenantId, id, { evaluationMode });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Process",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  async archive(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<void> {
    requirePermission(actor, "process.delete");
    if (!reason.trim()) throw new ValidationError("A reason is required to archive a process");
    const before = await this.get(actor, id);

    await this.processes.softDelete(actor.tenantId, id, actor.userId, reason);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Process",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason,
      requestId,
    });
  }

  /**
   * DIV-06: walks up from `processId` to its ancestors (bounded by
   * `PROCESS_LEVEL_BY_RANK.length` = 3, the hierarchy's own cap — no
   * separate loop guard needed) collecting `evaluationMode`, then
   * delegates the actual inheritance rule to the pure
   * `resolveInheritedEvaluationMode`. `tenantDefault` (Config.evaluationMode)
   * is passed in by the caller rather than fetched here — this service
   * has no ConfigRepository dependency, and none is added by this batch
   * (not called from RiskEvaluationService yet, see ACTION_ITEMS.md DIV-06).
   */
  async resolveEvaluationMode(
    actor: AuthenticatedUser,
    processId: string,
    tenantDefault: EvaluationMode,
  ): Promise<EvaluationMode> {
    requirePermission(actor, "process.read");
    const chain: Pick<Process, "evaluationMode">[] = [];
    let current: Process | null = await this.processes.getById(actor.tenantId, processId);
    if (!current) throw new NotFoundError("Process", processId);

    while (current && chain.length < PROCESS_LEVEL_BY_RANK.length) {
      chain.push(current);
      if (!current.parentId) break;
      current = await this.processes.getById(actor.tenantId, current.parentId);
    }

    return resolveInheritedEvaluationMode(chain, tenantDefault);
  }

  private async validateHierarchy(
    tenantId: string,
    level: Process["level"],
    parentId: string | null,
    selfId: string | null,
  ): Promise<void> {
    const rank = PROCESS_LEVEL_RANK[level];

    if (rank === 1) {
      if (parentId) {
        throw new ValidationError('A "PROCESS"-level item is root: it cannot have a parent');
      }
      return;
    }

    if (!parentId) {
      throw new ValidationError(`A "${level}"-level item must be attached to a parent`);
    }
    if (parentId === selfId) {
      throw new ValidationError("A process cannot be its own parent");
    }

    const parent = await this.processes.getById(tenantId, parentId);
    if (!parent) throw new ValidationError(`Parent process ${parentId} does not exist in this tenant`);

    const expectedParentLevel = PROCESS_LEVEL_BY_RANK[rank - 2];
    if (PROCESS_LEVEL_RANK[parent.level] !== rank - 1) {
      throw new ValidationError(
        `The parent of a "${level}"-level item must be "${expectedParentLevel}" ` +
          `(current parent is "${parent.level}"). The hierarchy is capped at 3 levels: ` +
          "PROCESS > SUBPROCESS > ACTIVITY.",
      );
    }
  }
}
