import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { ControlRepository } from "../domain/repositories/ControlRepository.js";
import type { DepartmentRepository } from "../domain/repositories/DepartmentRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type { ProcessEvaluationModeRequestRepository } from "../domain/repositories/ProcessEvaluationModeRequestRepository.js";
import {
  PROCESS_LEVEL_BY_RANK,
  PROCESS_LEVEL_RANK,
  resolveInheritedEvaluationMode,
  type CreateProcessInput,
  type Process,
  type ProcessResponsibilitiesInput,
  type UpdateProcessInput,
} from "../domain/entities/Process.js";
import type { EvaluationMode } from "../domain/entities/Config.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { canonicalId } from "../domain/ids.js";
import { requirePermission } from "../domain/permissions.js";
import { checkSelfValidation, type SelfValidationGate } from "./SelfValidationGate.js";
import { writeAudited } from "./auditedWrite.js";
import type { GovernanceConfirmation } from "../domain/governance/selfValidation.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

const MAX_CANDIDATE_SCAN = 1000;

export interface ProcessResponsibilitiesView {
  ownerUserId: string | null;
  riskChampionUserId: string | null;
  deputyUserId: string | null;
  /** The legacy free-text owner, kept as a label. */
  legacyOwner: string | null;
  /** Proposed accounts for the legacy owner (only while ownerUserId is null, only for an assigner). Never applied automatically. */
  ownerCandidates: Array<{ id: string; displayName: string }>;
}

/** "Jean-Marc  DUPONT" and "dupont jean marc" give the same key: accents stripped, lower case, words sorted. */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join(" ");
}

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
    /**
     * Architect audit finding (2026-09-30): `risks.process_id`/
     * `controls.process_id` are `NO ACTION` FKs and `getById` filters
     * `deleted_at IS NULL` — soft-deleting a referenced Process (what
     * `archive()` does) previously left those FKs silently unresolvable,
     * no error anywhere. These three are guard-only dependencies for
     * `archive()`'s referential check, same optional-degrade posture as
     * `ActionPlanService`'s SEC-012 guards: if absent, the check is
     * skipped rather than throwing — accepted because only `server.ts`
     * (always fully wired) and tests (explicit fakes to exercise the
     * guard) construct this service, so there is no active production
     * hole, only a documented structural risk if a future construction
     * site ever omits them.
     */
    private readonly risks?: RiskRepository,
    private readonly controls?: ControlRepository,
    private readonly evaluationModeRequests?: ProcessEvaluationModeRequestRepository,
    /** B-8: validates `departmentId`; fails closed (throws) if a departmentId is given without it. */
    private readonly departments?: DepartmentRepository,
    /** D2b: validates the accounts named as owner / champion / N-1; fails closed if one is given without it. */
    private readonly users?: UserRepository,
    /** q166: the only way past I-R1 (self as risk champion when nobody else can assign); without it, refused as before. */
    private readonly selfValidation?: SelfValidationGate,
  ) {}

  private async assertDepartmentExists(tenantId: string, departmentId: string): Promise<void> {
    if (!this.departments) throw new Error("ProcessService requires a DepartmentRepository to set departmentId");
    if (!(await this.departments.getById(tenantId, departmentId))) {
      throw new ValidationError(`Department ${departmentId} does not exist in this tenant`);
    }
  }

  /**
   * Governance finding (gouvernance refresh audit, 2026-09-29, DIV-06
   * scope): `evaluationMode` must never travel through creation either —
   * `process.create` is a much wider grant than `process.evaluationmode.
   * set`, and accepting it here would let any creator originate a
   * process directly in PARTICIPATIF, bypassing the dedicated permission
   * enforced everywhere else (update, the requests workflow). Excluded
   * from the input type, same gesture as `update`'s exclusion — a new
   * process's `evaluationMode` is always null (inherited) until
   * `setEvaluationMode`/the validated-request path sets it explicitly.
   */
  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateProcessInput, "tenantId" | "evaluationMode">,
    requestId: string,
  ): Promise<Process> {
    requirePermission(actor, "process.create");
    if (!input.name.trim()) throw new ValidationError("name is required");
    await this.validateHierarchy(actor.tenantId, input.level, input.parentId ?? null, null);
    // B-8 bis (q46): every new process is attached to a department (DB column stays nullable until existing rows are attached).
    if (!input.departmentId) throw new ValidationError("departmentId is required");
    await this.assertDepartmentExists(actor.tenantId, input.departmentId);

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

    // B-8 ter: a process attached to a department can be moved, never detached (q46).
    if (input.departmentId === null && before.departmentId) {
      throw new ValidationError("departmentId cannot be removed once a process is attached to a department");
    }
    if (input.departmentId) await this.assertDepartmentExists(actor.tenantId, input.departmentId);

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
   * D2b / DECISION-075 (q150): reads the three responsibilities plus, for an assigner only, the proposed match of the
   * legacy free-text owner against active accounts. A proposal is never applied here: it is confirmed process by
   * process through setResponsibilities.
   */
  async getResponsibilities(actor: AuthenticatedUser, id: string): Promise<ProcessResponsibilitiesView> {
    requirePermission(actor, "process.read");
    const process = await this.get(actor, id);
    const canAssign = actor.roles.includes("process.responsibility.assign");
    return {
      ownerUserId: process.ownerUserId,
      riskChampionUserId: process.riskChampionUserId,
      deputyUserId: process.deputyUserId,
      legacyOwner: process.owner,
      ownerCandidates: canAssign && !process.ownerUserId ? await this.ownerCandidates(actor.tenantId, process.owner) : [],
    };
  }

  /**
   * D2b (DECISION-074): owner / risk champion / N-1 of a process. Dedicated permission (the relation opens rights),
   * never process.update. Omitted key = untouched, null = cleared. Each named account must be active and of the
   * actor's tenant; nobody designates themselves (I-R1). The legacy `owner` text is left as is (DECISION-075).
   */
  async setResponsibilities(
    actor: AuthenticatedUser,
    id: string,
    input: ProcessResponsibilitiesInput,
    requestId: string,
    confirmation?: GovernanceConfirmation,
  ): Promise<Process> {
    requirePermission(actor, "process.responsibility.assign");
    const before = await this.get(actor, id);

    const changes = changedResponsibilities(before, input);
    if (Object.keys(changes).length === 0) return before;

    const selfId = canonicalId(actor.userId);
    const selfRefusal = "Nobody can designate themselves as owner, risk champion or N-1 of a process";
    if (changes.ownerUserId === selfId || changes.deputyUserId === selfId) throw new ValidationError(selfRefusal);
    // q166 (DECISION-080): the one exception to I-R1, risk champion only, when nobody else in the tenant can assign
    // responsibilities, with the explicit double confirmation and its reason; audited as a governance exception.
    const selfChampion =
      changes.riskChampionUserId === selfId
        ? await checkSelfValidation(this.selfValidation, actor, {
            isSelf: true,
            permission: "process.responsibility.assign",
            makerIds: [actor.userId],
            refusal: selfRefusal,
            confirmation,
          })
        : null;

    for (const userId of Object.values(changes)) {
      if (!userId) continue;
      if (!this.users) throw new Error("ProcessService requires a UserRepository to set process responsibilities");
      const user = await this.users.getById(actor.tenantId, userId);
      if (!user || user.deletedAt) throw new ValidationError(`User ${userId} is not an active account of this tenant`);
    }

    // DECISION-075 traceability: was the confirmed owner the account proposed from the legacy name?
    const ownerFromProposal = changes.ownerUserId
      ? (await this.ownerCandidates(actor.tenantId, before.owner)).some((c) => c.id === changes.ownerUserId)
      : undefined;

    const pick = (p: Process) => ({ ownerUserId: p.ownerUserId, riskChampionUserId: p.riskChampionUserId, deputyUserId: p.deputyUserId });
    // DECISION-079: the change and its audit row (with the q166 marker) in one transaction.
    return writeAudited(
      this.processes.auditsInTransaction,
      this.audit,
      (audit) => this.processes.setResponsibilities(actor.tenantId, id, changes, audit),
      (after) => [
        {
          tenantId: actor.tenantId,
          userId: actor.userId,
          entityType: "Process",
          entityId: id,
          action: "UPDATE",
          oldValue: { ...pick(before), legacyOwner: before.owner },
          newValue: {
            ...pick(after),
            legacyOwner: after.owner,
            ...(ownerFromProposal !== undefined ? { ownerFromProposal } : {}),
            ...selfChampion?.newValueExtra,
          },
          reason: selfChampion?.newValueExtra.selfValidation.reason ?? null,
          requestId,
          ...(selfChampion ? { governanceException: selfChampion.governanceException } : {}),
        },
      ],
    );
  }

  /** Active accounts of the tenant whose display name equals the legacy owner text (accent/case/word-order insensitive). Id + name only. */
  private async ownerCandidates(tenantId: string, legacyOwner: string | null): Promise<Array<{ id: string; displayName: string }>> {
    const wanted = legacyOwner ? normalizeName(legacyOwner) : "";
    if (!wanted || !this.users) return [];
    const users = await this.users.list(tenantId, { limit: MAX_CANDIDATE_SCAN });
    return users.filter((u) => normalizeName(u.displayName) === wanted).map((u) => ({ id: u.id, displayName: u.displayName }));
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
   * process-owner path lives in ProcessEvaluationModeRequestService.
   *
   * Governance finding (gouvernance refresh audit, 2026-09-29): DECISION-006
   * reserves the mode setting to the PROCESS level only (inherited down
   * to SUBPROCESS/ACTIVITY by resolveInheritedEvaluationMode) — setting
   * it directly on a SUBPROCESS/ACTIVITY would silently win over its
   * ancestor PROCESS's mode. Enforced here, not just documented.
   */
  async setEvaluationMode(
    actor: AuthenticatedUser,
    id: string,
    evaluationMode: EvaluationMode | null,
    requestId: string,
  ): Promise<Process> {
    requirePermission(actor, "process.evaluationmode.set");
    const before = await this.get(actor, id);
    if (before.level !== "PROCESS") {
      throw new ValidationError(
        `evaluationMode can only be set on a PROCESS-level item (this is a ${before.level}) — DECISION-006 reserves the setting to the PROCESS level, inherited down to SUBPROCESS/ACTIVITY`,
      );
    }

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

  /**
   * Architect audit finding (2026-09-30): refuses the archive (a hard
   * soft-delete — `deleted_at`, invisible to `getById`/`list` from then
   * on) when a live risk, control, or pending evaluation-mode request
   * still points at this process, since `risks.process_id`/
   * `controls.process_id` are `NO ACTION` FKs that would otherwise dangle
   * silently. Same family as `ActionPlanService.assertDepartmentExists`
   * (SEC-012): a "still referenced" check before a destructive write,
   * not a new architectural layer.
   */
  async archive(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<void> {
    requirePermission(actor, "process.delete");
    if (!reason.trim()) throw new ValidationError("A reason is required to archive a process");
    const before = await this.get(actor, id);

    await this.assertNoActiveReferences(actor.tenantId, id);

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

  /** See `archive()`'s doc comment — checks live (non-archived, non-soft-deleted) references only, mirroring `list()`'s own default scoping for each repository. */
  private async assertNoActiveReferences(tenantId: string, processId: string): Promise<void> {
    if (this.risks) {
      const risks = await this.risks.list(tenantId);
      if (risks.some((r) => r.processId === processId)) {
        throw new ValidationError(
          "Cannot archive this process: it is still referenced by risks.processId — unlink those risks first, or the FK would silently dangle",
        );
      }
    }
    if (this.controls) {
      const controls = await this.controls.list(tenantId);
      if (controls.some((c) => c.processId === processId)) {
        throw new ValidationError(
          "Cannot archive this process: it is still referenced by controls.processId — unlink those controls first, or the FK would silently dangle",
        );
      }
    }
    if (this.evaluationModeRequests) {
      const pending = await this.evaluationModeRequests.list(tenantId, { processId, status: "PENDING_VALIDATION" });
      if (pending.length > 0) {
        throw new ValidationError(
          "Cannot archive this process: it has a pending evaluation-mode request awaiting validation",
        );
      }
    }
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

/**
 * D2b: the responsibility keys the caller actually changes. F-PNL-06 (SEC-ID-01 class): ids are compared in canonical
 * form, an upper-case uuid is the same account in Postgres. Omitted key = untouched, null = cleared.
 */
function changedResponsibilities(before: Process, input: ProcessResponsibilitiesInput): ProcessResponsibilitiesInput {
  const changes: ProcessResponsibilitiesInput = {};
  for (const key of ["ownerUserId", "riskChampionUserId", "deputyUserId"] as const) {
    const raw = input[key];
    if (raw === undefined) continue;
    const next = typeof raw === "string" ? canonicalId(raw) : raw;
    if (next !== before[key]) changes[key] = next;
  }
  return changes;
}
