import type { ActionPlanRepository } from "../domain/repositories/ActionPlanRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { ControlRepository } from "../domain/repositories/ControlRepository.js";
import type { KriRepository } from "../domain/repositories/KriRepository.js";
import type { AnomalyRepository } from "../domain/repositories/AnomalyRepository.js";
import type { FindingRepository } from "../domain/repositories/FindingRepository.js";
import type { EvidenceRepository } from "../domain/repositories/EvidenceRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type { DepartmentRepository } from "../domain/repositories/DepartmentRepository.js";
import {
  ACTION_LINK_RESOURCE_TYPES,
  ACTION_PLAN_SOURCE_TYPES,
  computeActionPlanPriority,
  computeActionPlanStatus,
  type ActionLink,
  type ActionLinkResourceType,
  type ActionPlan,
  type ActionPlanListFilters,
  type ActionPlanSourceType,
  type ActionPlanView,
  type CreateActionPlanInput,
} from "../domain/entities/ActionPlan.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { Notifier } from "../infrastructure/notifications/Notifier.js";

const SOURCE_TYPES: readonly ActionPlanSourceType[] = ACTION_PLAN_SOURCE_TYPES;
const LINK_RESOURCE_TYPES: readonly ActionLinkResourceType[] = ACTION_LINK_RESOURCE_TYPES;
/**
 * ACT-190: source types tied to an existing entity row that can be
 * validated. FINDING added Lot 4 (Audit module, 2026-09-30) — unlike
 * AUDIT/INCIDENT/MANAGEMENT, a Finding-sourced ActionPlan always has a
 * real Finding row behind it (see GrcObjectType.ts's FINDING comment).
 */
const ENTITY_BACKED_SOURCE_TYPES: ActionPlanSourceType[] = ["RISK", "CONTROL", "KRI", "FINDING"];

export interface CreateActionPlanRequest {
  title: string;
  description?: string | null;
  sourceType: ActionPlanSourceType;
  sourceId?: string | null;
  responsibleUserId: string;
  departmentId?: string | null;
  dueDate: Date;
}

export interface DashboardFilters extends Omit<ActionPlanListFilters, "status"> {
  /** Unlike the repository-level filter, this also accepts EN_RETARD — applied client-side after computing (ACT-196). */
  status?: ActionPlanListFilters["status"] | "EN_RETARD";
}

export interface EscalationResult {
  escalated: boolean;
  action: ActionPlanView;
}

/**
 * Rules ported from the ACT-190..196 backlog batch: a remediation ticket
 * with a lifecycle on one row (ticket-lifecycle pattern, same shape as
 * AnomalyService), not append-only. Two things make this module differ
 * from Anomaly:
 *
 *  - the "source" is polymorphic (risk/control/kri/audit/incident/
 *    management) instead of a fixed set of optional FKs;
 *  - closing requires mandatory *evidence* (not just a comment) and is
 *    maker-checker gated: the actor who created the action can never be
 *    the one who closes it (mirrors RiskEvaluationService's
 *    evaluator != validator check).
 *
 * EN_RETARD is never a stored status — see the comment on
 * `computeActionPlanStatus` in the entity file for why (no scheduler in
 * this codebase) and for the judgment call on exactly when it applies.
 */
export class ActionPlanService {
  constructor(
    private readonly actions: ActionPlanRepository,
    private readonly audit: AuditRepository,
    /**
     * Optional so existing callers/tests built before this existed don't
     * need to change — but server.ts MUST wire the real repositories,
     * otherwise sourceId/link resourceIds stay unvalidated and a
     * cross-tenant or nonexistent reference could be stored (same
     * SEC-004-shaped concern as AnomalyService's optional repos).
     */
    private readonly risks?: RiskRepository,
    private readonly controls?: ControlRepository,
    private readonly kris?: KriRepository,
    private readonly anomalies?: AnomalyRepository,
    private readonly evidences?: EvidenceRepository,
    /** Best-effort only — see ACT-193 notes on start()/escalateIfOverdue() below. */
    private readonly notifier?: Notifier,
    /**
     * SEC-012: optional so existing callers/tests keep compiling — but
     * server.ts MUST wire the real repositories, otherwise
     * responsibleUserId/departmentId stay unvalidated (same shape as
     * RiskService's users/departments — see assertActiveUser/
     * assertDepartmentExists there).
     */
    private readonly users?: UserRepository,
    private readonly departments?: DepartmentRepository,
    /**
     * Lot 4 (Audit module, 2026-09-30): validates sourceId when sourceType
     * is FINDING — optional for the same reason as the repos above
     * (appended at the end so existing positional constructor calls, incl.
     * server.ts wiring before this change, keep compiling unmodified).
     */
    private readonly findings?: FindingRepository,
  ) {}

  async create(actor: AuthenticatedUser, input: CreateActionPlanRequest, requestId: string): Promise<ActionPlanView> {
    requirePermission(actor, "actionplan.create");

    if (!input.title?.trim()) throw new ValidationError("title is required");
    if (!SOURCE_TYPES.includes(input.sourceType)) {
      throw new ValidationError(`sourceType must be one of: ${SOURCE_TYPES.join(", ")}`);
    }
    if (!input.responsibleUserId?.trim()) throw new ValidationError("responsibleUserId is required");
    if (!(input.dueDate instanceof Date) || Number.isNaN(input.dueDate.getTime())) {
      throw new ValidationError("dueDate must be a valid date");
    }

    const isEntityBacked = ENTITY_BACKED_SOURCE_TYPES.includes(input.sourceType);
    if (isEntityBacked && !input.sourceId?.trim()) {
      throw new ValidationError(`sourceId is required when sourceType is ${input.sourceType}`);
    }
    if (!isEntityBacked && input.sourceId) {
      throw new ValidationError(`sourceId must be omitted when sourceType is ${input.sourceType} (not tied to an existing entity row)`);
    }
    if (isEntityBacked && input.sourceId) {
      await this.assertSourceExists(actor.tenantId, input.sourceType, input.sourceId);
    }
    await this.assertActiveUser(actor.tenantId, input.responsibleUserId);
    await this.assertDepartmentExists(actor.tenantId, input.departmentId);

    const createInput: CreateActionPlanInput = {
      tenantId: actor.tenantId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      sourceType: input.sourceType,
      sourceId: isEntityBacked ? (input.sourceId as string) : null,
      responsibleUserId: input.responsibleUserId,
      departmentId: input.departmentId ?? null,
      dueDate: input.dueDate,
      createdBy: actor.userId,
    };

    const action = await this.actions.create(createInput);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ActionPlan",
      entityId: action.id,
      action: "CREATE",
      oldValue: null,
      newValue: action,
      reason: null,
      requestId,
    });

    return this.toView(action);
  }

  async get(actor: AuthenticatedUser, id: string): Promise<ActionPlanView> {
    requirePermission(actor, "actionplan.read");
    return this.toView(await this.getRaw(actor, id));
  }

  async list(actor: AuthenticatedUser, filters?: ActionPlanListFilters): Promise<ActionPlanView[]> {
    requirePermission(actor, "actionplan.read");
    const rows = await this.actions.list(actor.tenantId, filters);
    return rows.map((row) => this.toView(row));
  }

  /**
   * DECISION-003: a risk's action plans (direct source + action_links
   * cross-reference, see ActionPlanRepository.listForRisk) — the read-model
   * building block Risk 360/Dispositif de risque needs and this service
   * did not expose before (the architecture audit's N+1 finding).
   */
  async listForRisk(actor: AuthenticatedUser, riskId: string): Promise<ActionPlanView[]> {
    requirePermission(actor, "actionplan.read");
    if (this.risks) {
      const risk = await this.risks.getById(actor.tenantId, riskId);
      if (!risk) throw new ValidationError(`Risk ${riskId} does not exist in this tenant`);
    }
    const rows = await this.actions.listForRisk(actor.tenantId, riskId);
    return rows.map((row) => this.toView(row));
  }

  /** ACT-196: filters by statut (incl. computed EN_RETARD)/source/responsable/date/département. */
  async dashboard(actor: AuthenticatedUser, filters?: DashboardFilters): Promise<ActionPlanView[]> {
    requirePermission(actor, "actionplan.read");

    const wantsOverdueOnly = filters?.status === "EN_RETARD";
    // EN_RETARD isn't a stored value — never pass it down to the repository filter.
    const storedStatusFilter = wantsOverdueOnly ? undefined : (filters?.status as ActionPlanListFilters["status"]);
    const repoFilters: ActionPlanListFilters = { ...filters, status: storedStatusFilter };

    const rows = await this.actions.list(actor.tenantId, repoFilters);
    const views = rows.map((row) => this.toView(row));
    return wantsOverdueOnly ? views.filter((v) => v.computedStatus === "EN_RETARD") : views;
  }

  /** ACT-191: narrow update — progressPercent + a comment, never a generic field-by-field update. */
  async updateProgress(
    actor: AuthenticatedUser,
    id: string,
    progressPercent: number,
    comment: string | null,
    requestId: string,
  ): Promise<ActionPlanView> {
    requirePermission(actor, "actionplan.update");
    const before = await this.getRaw(actor, id);

    if (before.status === "TERMINEE") {
      throw new ValidationError("Cannot update progress on an action that has already been closed");
    }
    if (!Number.isInteger(progressPercent) || progressPercent < 0 || progressPercent > 100) {
      throw new ValidationError("progressPercent must be an integer between 0 and 100");
    }

    const after = await this.actions.updateProgress(actor.tenantId, id, progressPercent, comment?.trim() || null);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ActionPlan",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: after,
      reason: comment ?? null,
      requestId,
    });

    return this.toView(after);
  }

  /**
   * ACT-192: the only narrow, non-terminal status transition —
   * PLANIFIEE -> EN_COURS. TERMINEE is reachable exclusively through
   * close() (its own permission + maker-checker + mandatory evidence);
   * this module has no generic update() that could otherwise be used to
   * bypass that gate, matching the "terminal transition needs its own
   * gate" rule used throughout this codebase.
   *
   * ACT-193 (best-effort, no scheduler in this codebase — see the entity
   * file comment): if the action was already overdue at the moment it's
   * started, notify best-effort. This is one of the two trigger points
   * called out in the task brief; the other is escalateIfOverdue below,
   * which must be invoked manually (via its own endpoint) since there is
   * no cron to poll it periodically.
   */
  async start(actor: AuthenticatedUser, id: string, requestId: string): Promise<ActionPlanView> {
    requirePermission(actor, "actionplan.update");
    const before = await this.getRaw(actor, id);

    if (before.status !== "PLANIFIEE") {
      throw new ValidationError(`Cannot start an action that is not PLANIFIEE (current status: ${before.status})`);
    }

    const wasAlreadyOverdue = computeActionPlanStatus(before) === "EN_RETARD";
    const after = await this.actions.start(actor.tenantId, id);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ActionPlan",
      entityId: id,
      action: "STATUS_CHANGE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    if (wasAlreadyOverdue) {
      this.notifier
        ?.notify(`Action "${after.title}" démarrée en retard (échéance dépassée le ${after.dueDate.toISOString().slice(0, 10)})`)
        .catch(() => {
          // Best-effort — a broken notification channel must never fail the actual transition.
        });
    }

    return this.toView(after);
  }

  /**
   * ACT-193: dedicated method meant to back a small, manually-triggered
   * endpoint (e.g. POST /actions/:id/escalate) — this codebase has no
   * scheduler that could call it periodically on its own, so an overdue
   * action is only actually escalated when something (a human, a future
   * cron once one exists) calls this. Read-only with respect to stored
   * state: it never mutates `status` (EN_RETARD is never stored, see the
   * entity file), it only best-effort notifies and leaves an audit trail
   * when the computed status is EN_RETARD at the moment it's called.
   */
  async escalateIfOverdue(actor: AuthenticatedUser, id: string, requestId: string): Promise<EscalationResult> {
    requirePermission(actor, "actionplan.update");
    const action = await this.getRaw(actor, id);
    const computedStatus = computeActionPlanStatus(action);

    if (computedStatus !== "EN_RETARD") {
      return { escalated: false, action: this.toView(action) };
    }

    this.notifier
      ?.notify(
        `Action en retard : "${action.title}" (échéance ${action.dueDate.toISOString().slice(0, 10)}, responsable ${action.responsibleUserId}) — priorité HIGH`,
      )
      .catch(() => {
        // Best-effort — a broken notification channel must never fail the escalation record below.
      });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ActionPlan",
      entityId: id,
      action: "STATUS_CHANGE",
      oldValue: action,
      newValue: action,
      reason: "ESCALATE: computed status EN_RETARD",
      requestId,
    });

    return { escalated: true, action: this.toView(action) };
  }

  /** ACT-194: rebuilds the full set of linked resources — pure link table, DELETE + INSERT (see CLAUDE.md's control_risks exemption). */
  async setLinks(actor: AuthenticatedUser, id: string, links: ActionLink[], requestId: string): Promise<ActionLink[]> {
    requirePermission(actor, "actionplan.update");
    await this.getRaw(actor, id); // existence + tenant check

    for (const link of links) {
      if (!LINK_RESOURCE_TYPES.includes(link.resourceType)) {
        throw new ValidationError(`Unknown link resourceType: ${link.resourceType}`);
      }
      if (!link.resourceId?.trim()) {
        throw new ValidationError("Each link requires a non-empty resourceId");
      }
      await this.assertLinkTargetExists(actor.tenantId, link.resourceType, link.resourceId);
    }

    const before = await this.actions.listLinks(actor.tenantId, id);
    await this.actions.replaceLinks(actor.tenantId, id, links);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ActionPlan",
      entityId: id,
      action: "UPDATE",
      oldValue: { links: before },
      newValue: { links },
      reason: "LINKS_CHANGE",
      requestId,
    });

    return links;
  }

  async listLinks(actor: AuthenticatedUser, id: string): Promise<ActionLink[]> {
    requirePermission(actor, "actionplan.read");
    await this.getRaw(actor, id);
    return this.actions.listLinks(actor.tenantId, id);
  }

  /**
   * ACT-195: terminal transition to TERMINEE. Gated behind its own
   * permission (actionplan.validate, never actionplan.update) with two
   * mandatory conditions: an evidenceId that resolves to a real,
   * in-tenant Evidence row, and maker-checker — the actor who created
   * the action can never be the one who closes it (mirrors
   * RiskEvaluationService's evaluator != validator guard).
   */
  async close(
    actor: AuthenticatedUser,
    id: string,
    evidenceId: string,
    comment: string | null,
    requestId: string,
  ): Promise<ActionPlanView> {
    requirePermission(actor, "actionplan.validate");
    const before = await this.getRaw(actor, id);

    if (before.status === "TERMINEE") {
      throw new ValidationError("This action has already been closed");
    }
    if (!evidenceId?.trim()) {
      throw new ValidationError("evidenceId is required to close an action");
    }
    if (before.createdBy === actor.userId) {
      throw new ForbiddenError("The actor who created this action cannot close it themselves — ask another user to close it");
    }
    if (this.evidences) {
      const evidence = await this.evidences.getById(actor.tenantId, evidenceId);
      if (!evidence) throw new ValidationError(`Evidence ${evidenceId} does not exist in this tenant`);
    }

    const after = await this.actions.close(actor.tenantId, id, actor.userId, evidenceId, comment?.trim() || null);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ActionPlan",
      entityId: id,
      action: "CLOSE",
      oldValue: before,
      newValue: after,
      reason: comment ?? null,
      requestId,
    });

    return this.toView(after);
  }

  private async getRaw(actor: AuthenticatedUser, id: string): Promise<ActionPlan> {
    const action = await this.actions.getById(actor.tenantId, id);
    if (!action) throw new NotFoundError("ActionPlan", id);
    return action;
  }

  private toView(action: ActionPlan): ActionPlanView {
    const computedStatus = computeActionPlanStatus(action);
    return { ...action, computedStatus, priority: computeActionPlanPriority(computedStatus) };
  }

  private async assertSourceExists(tenantId: string, sourceType: ActionPlanSourceType, sourceId: string): Promise<void> {
    if (sourceType === "RISK" && this.risks) {
      const risk = await this.risks.getById(tenantId, sourceId);
      if (!risk) throw new ValidationError(`Risk ${sourceId} does not exist in this tenant`);
    } else if (sourceType === "CONTROL" && this.controls) {
      const control = await this.controls.getById(tenantId, sourceId);
      if (!control) throw new ValidationError(`Control ${sourceId} does not exist in this tenant`);
    } else if (sourceType === "KRI" && this.kris) {
      const kri = await this.kris.getById(tenantId, sourceId);
      if (!kri) throw new ValidationError(`Kri ${sourceId} does not exist in this tenant`);
    } else if (sourceType === "FINDING" && this.findings) {
      const finding = await this.findings.getById(tenantId, sourceId);
      if (!finding) throw new ValidationError(`Finding ${sourceId} does not exist in this tenant`);
    }
  }

  /** SEC-012: the responsible user, if validation is wired, must be an active user in the actor's tenant. */
  private async assertActiveUser(tenantId: string, userId: string): Promise<void> {
    if (!this.users) return;
    const user = await this.users.getById(tenantId, userId);
    if (!user) throw new ValidationError(`User ${userId} does not exist in this tenant`);
    if (user.deletedAt) throw new ValidationError(`User ${userId} is suspended and cannot be a responsible user`);
  }

  /** SEC-012: a departmentId, if given, must belong to the actor's tenant. */
  private async assertDepartmentExists(tenantId: string, departmentId: string | null | undefined): Promise<void> {
    if (!departmentId || !this.departments) return;
    const department = await this.departments.getById(tenantId, departmentId);
    if (!department) throw new ValidationError(`Department ${departmentId} does not exist in this tenant`);
  }

  private async assertLinkTargetExists(tenantId: string, resourceType: ActionLinkResourceType, resourceId: string): Promise<void> {
    if (resourceType === "RISK" && this.risks) {
      const risk = await this.risks.getById(tenantId, resourceId);
      if (!risk) throw new ValidationError(`Risk ${resourceId} does not exist in this tenant`);
    } else if (resourceType === "CONTROL" && this.controls) {
      const control = await this.controls.getById(tenantId, resourceId);
      if (!control) throw new ValidationError(`Control ${resourceId} does not exist in this tenant`);
    } else if (resourceType === "KRI" && this.kris) {
      const kri = await this.kris.getById(tenantId, resourceId);
      if (!kri) throw new ValidationError(`Kri ${resourceId} does not exist in this tenant`);
    } else if (resourceType === "ANOMALY" && this.anomalies) {
      const anomaly = await this.anomalies.getById(tenantId, resourceId);
      if (!anomaly) throw new ValidationError(`Anomaly ${resourceId} does not exist in this tenant`);
    }
  }
}
