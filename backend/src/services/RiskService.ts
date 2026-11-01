import { randomUUID } from "node:crypto";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { DepartmentRepository } from "../domain/repositories/DepartmentRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type { RiskEscalationRepository } from "../domain/repositories/RiskEscalationRepository.js";
import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import type { CreateRiskInput, Risk, RiskVisibilityState, UpdateRiskInput } from "../domain/entities/Risk.js";
import type { NotificationRepository } from "../domain/repositories/NotificationRepository.js";
import { isAcceptableReason } from "../domain/governance/selfValidation.js";
import { writeAudited } from "./auditedWrite.js";
import type { RiskEscalation } from "../domain/entities/RiskEscalation.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { VisibilityResolver } from "./VisibilityResolver.js";
import { READER_DEFAULT_SCOPE, type Visibility } from "../domain/visibility.js";
import type { Notifier } from "../infrastructure/notifications/Notifier.js";

/**
 * All business rules and transitions for Risk live here — never in the
 * frontend, never in the repository. This is the layer the ADR-001
 * "Backend décide" example maps to.
 */
export class RiskService {
  constructor(
    private readonly risks: RiskRepository,
    private readonly audit: AuditRepository,
    /** SEC-004: optional so existing tests keep compiling — server.ts must wire the real repository. */
    private readonly departments?: DepartmentRepository,
    /**
     * ACT-120/122: optional so existing callers/tests built before this
     * existed don't need to change — but server.ts MUST wire the real
     * repository, otherwise ownerId/superiorOwnerId stay unvalidated and
     * anyone can be pointed at as a risk owner, tenant or not, active or not.
     */
    private readonly users?: UserRepository,
    /** ACT-121/125: optional, same pattern as KriMeasureService's notifier — best-effort broadcast, never blocks the write it's attached to. */
    private readonly notifier?: Notifier,
    /** ACT-125: optional so existing tests keep compiling — server.ts must wire the real repository for escalate() to work in production. */
    private readonly escalations?: RiskEscalationRepository,
    /**
     * DIV-05: optional so existing tests keep compiling, but if a caller
     * actually supplies `processId`, `assertProcessExists` throws rather
     * than silently skipping validation when this is unwired — the
     * SEC-012 lesson (never `if (!this.x) return;` on a dependency the
     * current call is actually trying to use). server.ts must wire the
     * real repository for `processId` to ever be accepted.
     */
    private readonly processes?: ProcessRepository,
    /** DECISION-100 (lot V0): optional for existing tests — absent, a reader sees CLIENT rows only (fail-closed, SEC V0-01). Wired in server.ts. */
    private readonly visibility?: VisibilityResolver,
    /** Lot V1 (q199): notifies the Risk Manager group when an owner widens a risk. Optional: absent = no notification. */
    private readonly notifications?: Pick<NotificationRepository, "create">,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateRiskInput, "tenantId" | "grantedBy">,
    requestId: string,
    idempotencyKey?: string,
  ): Promise<Risk> {
    requirePermission(actor, "risk.create");
    if (!input.process.trim()) throw new ValidationError("process is required");
    if (!input.description.trim()) throw new ValidationError("description is required");
    await this.assertDepartmentExists(actor.tenantId, input.ownerDepartmentId);
    await this.assertProcessExists(actor.tenantId, input.processId);
    const visibility: Visibility = input.visibility ?? "CLIENT";
    const accessUserIds = [...new Set(input.accessUserIds ?? [])];
    await this.assertInitialVisibility(actor, visibility, accessUserIds, input.ownerDepartmentId ?? null, input.processId ?? null);

    // The author of the initial grants is always the caller (never a client-supplied field).
    const toCreate = { ...input, visibility, accessUserIds, grantedBy: actor.userId, tenantId: actor.tenantId };
    const result = idempotencyKey
      ? await this.risks.createIdempotent(toCreate, idempotencyKey)
      : { risk: await this.risks.create(toCreate), created: true };

    if (!result.created) {
      const existing = result.risk;
      // Codex P2: the replay compares the named people too (as granted at creation, whatever happened since).
      const initial = this.risks.listCreationAccess ? await this.risks.listCreationAccess(actor.tenantId, existing.id) : accessUserIds;
      const sameList = initial.length === accessUserIds.length && accessUserIds.every((u) => initial.some((x) => sameUserId(x, u)));
      if (
        existing.process !== input.process ||
        existing.description !== input.description ||
        existing.ownerDepartmentId !== (input.ownerDepartmentId ?? null) ||
        existing.processId !== (input.processId ?? null) ||
        (existing.visibility ?? "CLIENT") !== visibility ||
        !sameList
      ) {
        throw new ValidationError("Idempotency-Key was already used with a different risk payload");
      }
      return existing;
    }

    const risk = result.risk;

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
      entityId: risk.id,
      action: "CREATE",
      oldValue: null,
      newValue: accessUserIds.length > 0 ? { ...risk, accessUserIds } : risk,
      reason: null,
      requestId,
    });

    return risk;
  }

  /** Lot V1 (q192): the level and active named-people list of a risk the caller can read. */
  async getAccess(actor: AuthenticatedUser, id: string): Promise<RiskVisibilityState> {
    const risk = await this.get(actor, id);
    const accessUserIds = this.risks.listAccess ? await this.risks.listAccess(actor.tenantId, id) : [];
    return this.withNames(actor.tenantId, { visibility: risk.visibility ?? "CLIENT", accessUserIds });
  }

  /**
   * Lot V1 (q194, q199): change a risk's visibility after its creation, by a holder of `resourcevisibility.set` (Risk
   * Manager group) or by the risk's owner, with a mandatory reason and the audit row in the same transaction. Nobody
   * adds themselves to the list. Back to CLIENT revokes the whole list (it would otherwise come back silently on the
   * next restriction). When the owner widens a risk, the Risk Manager group is notified; the change is not blocked.
   */
  async setVisibility(
    actor: AuthenticatedUser,
    id: string,
    input: { visibility: Visibility; addUserIds?: string[]; revokeUserIds?: string[]; reason: string },
    requestId: string,
  ): Promise<RiskVisibilityState> {
    requirePermission(actor, "risk.read");
    const before = await this.get(actor, id);
    const holdsRight = actor.roles.includes("resourcevisibility.set");
    const isOwner = before.ownerId !== null && sameUserId(before.ownerId, actor.userId);
    if (!holdsRight && !isOwner) {
      throw new ForbiddenError("Only the Risk Manager group or the risk owner can change its visibility");
    }
    const reason = input.reason?.trim() ?? "";
    if (!reason || reason.length > 500 || !isAcceptableReason(reason)) {
      throw new ValidationError("A reason (1 to 500 characters) is required to change a risk's visibility");
    }
    const repo = this.risks;
    if (!repo.changeVisibility || !repo.listAccess) {
      throw new ValidationError("Changing a risk's visibility is not available");
    }
    const current = await repo.listAccess(actor.tenantId, id);
    const addUserIds = input.visibility === "CLIENT" ? [] : [...new Set(input.addUserIds ?? [])];
    const revokeUserIds = input.visibility === "CLIENT" ? current : [...new Set(input.revokeUserIds ?? [])];
    if (addUserIds.some((u) => sameUserId(u, actor.userId))) {
      throw new ValidationError("You cannot add yourself to a risk's access list");
    }
    for (const userId of addUserIds) await this.assertActiveAccessUser(actor.tenantId, userId);
    const change = { visibility: input.visibility, addUserIds, revokeUserIds, reason, changedBy: actor.userId };
    const changeVisibility = repo.changeVisibility.bind(repo);
    const result = await writeAudited<{ before: RiskVisibilityState; after: RiskVisibilityState; widening?: boolean }>(
      repo.auditsInTransaction,
      this.audit,
      (audit) => changeVisibility(actor.tenantId, id, change, audit),
      ({ before: b, after: a, widening }) => [{
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "Risk",
        entityId: id,
        action: "PERMISSION_CHANGE",
        oldValue: b,
        newValue: { ...a, widening: widening ?? isWidening(b, a) },
        reason,
        requestId,
      }],
    );
    if (!holdsRight && (result.widening ?? isWidening(result.before, result.after))) {
      await this.notifyVisibilityWidened(actor, id, requestId);
    }
    return this.withNames(actor.tenantId, result.after);
  }

  private async withNames(tenantId: string, state: RiskVisibilityState): Promise<RiskVisibilityState> {
    if (!this.users) return state;
    const users = this.users;
    const accessUsers = await Promise.all(state.accessUserIds.map(async (id) => ({ id, displayName: (await users.getById(tenantId, id))?.displayName ?? null })));
    return { ...state, accessUsers };
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Risk> {
    requirePermission(actor, "risk.read");
    const risk = await this.risks.getById(actor.tenantId, id, (await this.visibility?.resolve(actor)) ?? READER_DEFAULT_SCOPE);
    if (!risk) throw new NotFoundError("Risk", id);
    return risk;
  }

  /** ACT-124: `ownerId` (resolved by the route layer — "me" -> actor.userId) filters to that owner's risks. */
  async list(actor: AuthenticatedUser, includeArchived = false, ownerId?: string): Promise<Risk[]> {
    requirePermission(actor, "risk.read");
    return this.risks.list(actor.tenantId, { includeArchived, ownerId }, (await this.visibility?.resolve(actor)) ?? READER_DEFAULT_SCOPE);
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
    await this.assertDepartmentExists(actor.tenantId, input.ownerDepartmentId);
    await this.assertProcessExists(actor.tenantId, input.processId);

    // SEC V1-02: on a restricted risk, the department and the process decide who reads it (risk_visible_to). Changing
    // them is a visibility change: Risk Manager group or owner, mandatory reason, audited with the update.
    const { reason: rawReason, ...fields } = input;
    const perimeter = this.perimeterChange(before, fields);
    const reason = rawReason?.trim() ?? "";
    const holdsRight = actor.roles.includes("resourcevisibility.set");
    if (perimeter) {
      if (!holdsRight && !(before.ownerId !== null && sameUserId(before.ownerId, actor.userId))) {
        throw new ForbiddenError("Only the Risk Manager group or the risk owner can change the department or process of a restricted risk");
      }
      if (!reason || reason.length > 500 || !isAcceptableReason(reason)) {
        throw new ValidationError("A reason (1 to 500 characters) is required to change the department or process of a restricted risk");
      }
    }

    const repo = this.risks;
    const after = await writeAudited<Risk>(
      repo.auditsInTransaction,
      this.audit,
      (audit) => repo.update(actor.tenantId, id, fields, audit),
      (updated) => [
        {
          tenantId: actor.tenantId,
          userId: actor.userId,
          entityType: "Risk",
          entityId: id,
          action: fields.status ? "STATUS_CHANGE" : "UPDATE",
          oldValue: before,
          newValue: updated,
          reason: perimeter ? reason : null,
          requestId,
        },
        ...(perimeter ? [{
          tenantId: actor.tenantId,
          userId: actor.userId,
          entityType: "Risk",
          entityId: id,
          action: "PERMISSION_CHANGE" as const,
          oldValue: { visibility: before.visibility, ownerDepartmentId: before.ownerDepartmentId, processId: before.processId ?? null },
          newValue: { visibility: updated.visibility, ownerDepartmentId: updated.ownerDepartmentId, processId: updated.processId ?? null, widening: perimeter.widening },
          reason,
          requestId,
        }] : []),
      ],
    );
    if (perimeter?.widening && !holdsRight) await this.notifyVisibilityWidened(actor, id, requestId);
    return after;
  }

  /** Null when the change does not touch who may read the risk (a CLIENT risk, or same department and process). */
  private perimeterChange(before: Risk, input: UpdateRiskInput): { widening: boolean } | null {
    if ((before.visibility ?? "CLIENT") === "CLIENT") return null;
    const dept = input.ownerDepartmentId !== undefined && (input.ownerDepartmentId ?? null) !== (before.ownerDepartmentId ?? null);
    const proc = input.processId !== undefined && (input.processId ?? null) !== (before.processId ?? null);
    if (!dept && !proc) return null;
    // Only PERIMETRE reads through the department group and the process owner: a new non-null value lets new people in.
    const widening = before.visibility === "PERIMETRE"
      && ((dept && input.ownerDepartmentId != null) || (proc && input.processId != null));
    return { widening };
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

  /**
   * ACT-120/121: designate or reassign the individual Risk Owner. Not
   * folded into the generic `update()` — this is a distinct, audited
   * action (like archive()), not a routine field edit, and `Risk.ownerId`
   * has no place in UpdateRiskInput for exactly that reason.
   *
   * `ownerId: null` clears the owner. A non-null value must resolve to
   * an active user in the caller's tenant (SEC-004: never trust a
   * client-supplied id that could point at another tenant's user, or a
   * suspended one).
   */
  async assignOwner(actor: AuthenticatedUser, id: string, ownerId: string | null, requestId: string): Promise<Risk> {
    requirePermission(actor, "risk.owner.assign");
    const before = await this.get(actor, id);

    if (ownerId) {
      if (sameUserId(ownerId, actor.userId)) {
        throw new ValidationError("You cannot designate yourself as risk owner");
      }
      await this.assertActiveUser(actor.tenantId, ownerId, "owner");
      if (before.superiorOwnerId && sameUserId(before.superiorOwnerId, ownerId)) {
        throw new ValidationError("The risk owner cannot be the same person as the superior owner (N+1)");
      }
    }

    const after = await this.risks.assignOwner(actor.tenantId, id, ownerId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
      entityId: id,
      action: "ASSIGN",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    // ACT-121: best-effort broadcast on reassignment — never blocks the write.
    if (this.notifier && before.ownerId !== after.ownerId) {
      this.notifier
        .notify(
          `Risk ${id} owner changed from ${before.ownerId ?? "(none)"} to ${after.ownerId ?? "(none)"}`,
        )
        .catch(() => {
          // Best-effort — a broken notification channel must never fail the actual ownership change.
        });
    }

    return after;
  }

  /**
   * ACT-122: designate the owner's N+1 (superior owner), used by
   * escalate() (ACT-125) as the escalation target. `regles_critiques`
   * "hiérarchie owner < superior_owner" is enforced as: the two can never
   * be the same person — checked here and (bidirectionally) in
   * assignOwner. Automatic threshold-based escalation is explicitly out
   * of scope here — see escalate() below, which is the one and only
   * escalation mechanism this module builds.
   */
  async assignSuperiorOwner(
    actor: AuthenticatedUser,
    id: string,
    superiorOwnerId: string | null,
    requestId: string,
  ): Promise<Risk> {
    requirePermission(actor, "risk.owner.assign");
    const before = await this.get(actor, id);

    if (superiorOwnerId) {
      if (sameUserId(superiorOwnerId, actor.userId)) {
        throw new ValidationError("You cannot designate yourself as superior owner (N+1)");
      }
      await this.assertActiveUser(actor.tenantId, superiorOwnerId, "superior owner");
      if (before.ownerId && sameUserId(before.ownerId, superiorOwnerId)) {
        throw new ValidationError("The superior owner (N+1) cannot be the same person as the risk owner");
      }
    }

    const after = await this.risks.assignSuperiorOwner(actor.tenantId, id, superiorOwnerId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
      entityId: id,
      action: "ASSIGN",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  /**
   * ACT-125: escalate a risk to its superior owner. Requires a
   * superiorOwnerId to already be assigned (assignSuperiorOwner must run
   * first) and a mandatory reason — mirrors Anomaly's "on ne referme pas
   * un constat sans dire ce qui a été fait" for the same reason: an
   * escalation with no stated cause is not useful history.
   *
   * Writes an append-only RiskEscalation row (queryable history) in
   * addition to the standard audit event, then best-effort notifies via
   * Notifier — see RiskEscalation.ts for why a table exists here and not
   * just a Notifier call.
   */
  async escalate(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<RiskEscalation> {
    requirePermission(actor, "risk.escalate");
    if (!reason.trim()) throw new ValidationError("A reason is required to escalate a risk");
    if (!this.escalations) {
      throw new ValidationError("Risk escalation is not available: RiskEscalationRepository is not configured");
    }

    const risk = await this.get(actor, id);
    if (!risk.superiorOwnerId) {
      throw new ValidationError("This risk has no superior owner assigned — use assignSuperiorOwner first");
    }

    const escalation = await this.escalations.create({
      tenantId: actor.tenantId,
      riskId: id,
      escalatedBy: actor.userId,
      superiorOwnerId: risk.superiorOwnerId,
      reason,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
      entityId: id,
      action: "ESCALATE",
      oldValue: null,
      newValue: escalation,
      reason,
      requestId,
    });

    this.notifier
      ?.notify(`Risk ${id} escalated to superior owner ${risk.superiorOwnerId}: ${reason}`)
      .catch(() => {
        // Best-effort — a broken notification channel must never fail the actual escalation record.
      });

    return escalation;
  }

  /** ACT-120/122: an owner/superiorOwner, if validation is wired, must be an active user in the caller's tenant. */
  /**
   * Lot V1: a restricted level at creation needs the repository support, a list of active users of the tenant without
   * the creator (q194), and a creator who would still see the risk (spec §5) unless they see everything.
   */
  private async assertInitialVisibility(
    actor: AuthenticatedUser,
    visibility: Visibility,
    accessUserIds: string[],
    ownerDepartmentId: string | null,
    processId: string | null,
  ): Promise<void> {
    if (visibility === "CLIENT") {
      if (accessUserIds.length > 0) throw new ValidationError("A named-people list only applies to a restricted risk");
      return;
    }
    if (!this.risks.creatorWouldSee) throw new ValidationError("Restricted visibility is not available");
    if (accessUserIds.some((u) => sameUserId(u, actor.userId))) {
      throw new ValidationError("You cannot add yourself to a risk's access list");
    }
    for (const userId of accessUserIds) await this.assertActiveAccessUser(actor.tenantId, userId);
    const scope = (await this.visibility?.resolve(actor)) ?? READER_DEFAULT_SCOPE;
    if (scope.all) return;
    if (!(await this.risks.creatorWouldSee(actor.tenantId, actor.userId, { visibility, ownerDepartmentId, processId }))) {
      throw new ValidationError("You would not see this risk yourself with this visibility: choose a level that includes you");
    }
  }

  private async assertActiveAccessUser(tenantId: string, userId: string): Promise<void> {
    if (!this.users) throw new ValidationError("Access lists are not available");
    const user = await this.users.getById(tenantId, userId);
    if (!user) throw new ValidationError(`User ${userId} does not exist in this tenant`);
    if (user.deletedAt) throw new ValidationError(`User ${userId} is suspended and cannot be given access`);
  }

  /** q199: best-effort, a notification failure never undoes the visibility change. Never names the risk content. */
  private async notifyVisibilityWidened(actor: AuthenticatedUser, riskId: string, requestId: string): Promise<void> {
    if (!this.notifications || !this.users?.listWithPermission) return;
    try {
      const managers = await this.users.listWithPermission(actor.tenantId, "resourcevisibility.set", actor.userId);
      for (const m of managers) {
        await this.notifications.create({
          tenantId: actor.tenantId,
          recipientUserId: m.id,
          resourceType: "RISK",
          resourceId: riskId,
          eventType: "RISK_VISIBILITY_WIDENED",
          message: "Le propriétaire d'un risque a élargi sa visibilité.",
        });
      }
    } catch (err) {
      console.error(`RISK_VISIBILITY_WIDENED ${riskId}: managers could not be notified (requestId ${requestId})`, err instanceof Error ? err.message : err);
    }
  }

  private async assertActiveUser(tenantId: string, userId: string, role: "owner" | "superior owner"): Promise<void> {
    if (!this.users) return;
    const user = await this.users.getById(tenantId, userId);
    if (!user) throw new ValidationError(`User ${userId} does not exist in this tenant`);
    if (user.deletedAt) throw new ValidationError(`User ${userId} is suspended and cannot be a risk ${role}`);
  }

  /** SEC-004: an ownerDepartmentId, if given, must belong to the caller's tenant. */
  private async assertDepartmentExists(tenantId: string, ownerDepartmentId: string | null | undefined): Promise<void> {
    if (!ownerDepartmentId || !this.departments) return;
    const department = await this.departments.getById(tenantId, ownerDepartmentId);
    if (!department) throw new ValidationError(`Department ${ownerDepartmentId} does not exist in this tenant`);
  }

  /**
   * DIV-05: a processId, if given, must belong to the caller's tenant.
   * Unlike assertDepartmentExists, a missing repository here does NOT
   * silently skip validation when a processId was actually supplied —
   * that would reintroduce the SEC-012 class of bug (a field accepted
   * and stored with no validation ever having run). It's only safe to
   * no-op when the caller didn't ask to set processId at all.
   */
  private async assertProcessExists(tenantId: string, processId: string | null | undefined): Promise<void> {
    if (processId === undefined || processId === null) return;
    if (!this.processes) {
      throw new ValidationError("Risk process validation is not available: ProcessRepository is not configured");
    }
    const process = await this.processes.getById(tenantId, processId);
    if (!process) throw new ValidationError(`Process ${processId} does not exist in this tenant`);
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

/**
 * SEC-B0-1: Postgres accepts the same uuid in upper case, braced or
 * without dashes, so a plain string comparison with actor.userId could be
 * bypassed. Compare the normalised forms instead.
 */
/**
 * Fallback only (a repository that cannot compute the real effective sets, e.g. test fakes): the PostgreSQL repository
 * answers `widening` itself from risk_visible_to. Conservative: from CLIENT nothing widens (everyone already reads it);
 * otherwise a more open level, or any person added to the list (who may be outside the previous effective set,
 * e.g. PERIMETRE -> NOMINATIF with a new name), widens.
 */
const OPENNESS: Record<Visibility, number> = { NOMINATIF: 0, PERIMETRE: 1, CLIENT: 2 };
function isWidening(before: RiskVisibilityState, after: RiskVisibilityState): boolean {
  if (before.visibility === "CLIENT") return false;
  if (OPENNESS[after.visibility] > OPENNESS[before.visibility]) return true;
  return after.accessUserIds.some((u) => !before.accessUserIds.includes(u));
}

function sameUserId(a: string, b: string): boolean {
  const normalise = (id: string) => id.toLowerCase().replace(/[{}-]/g, "");
  return normalise(a) === normalise(b);
}
