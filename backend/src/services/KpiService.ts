import type { KpiListFilters, KpiRepository } from "../domain/repositories/KpiRepository.js";
import type { KpiMeasureRepository } from "../domain/repositories/KpiMeasureRepository.js";
import type { DepartmentRepository } from "../domain/repositories/DepartmentRepository.js";
import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import {
  computeKpiStatus,
  type CreateKpiInput,
  type Kpi,
  type KpiStatus,
  type UpdateKpiInput,
} from "../domain/entities/Kpi.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { VisibilityResolver } from "./VisibilityResolver.js";
import { READER_DEFAULT_SCOPE, type Visibility } from "../domain/visibility.js";
import type { ResourceVisibilityManager, VisibilityTarget } from "./resourceVisibility.js";
import type { ResourceVisibilityState } from "../domain/repositories/ResourceAccessRepository.js";

export interface KpiWithStatus extends Kpi {
  status: KpiStatus;
  achievementRate: number | null;
  latestMeasureValue: number | null;
  latestMeasurePeriod: Date | null;
}

/**
 * New domain — no apps-script-legacy module to port (KPI tracking did
 * not exist in the Sheets tool). `kpis` is updated in place, like
 * Department/Process (ACT-140). A KPI's status is never stored: it's
 * computed here from KpiMeasureRepository.getLatest vs targetValue
 * (ACT-142/ACT-143). ACT-144 (linking to a department/process) is kept
 * as its own method because the backlog names it as a distinct
 * endpoint, even though it shares validation with `update`.
 */
export class KpiService {
  constructor(
    private readonly kpis: KpiRepository,
    private readonly measures: KpiMeasureRepository,
    private readonly departments: DepartmentRepository,
    private readonly processes: ProcessRepository,
    private readonly audit: AuditRepository,
    /** DECISION-100 (lot V0): optional for existing tests — absent, a reader sees CLIENT rows only (fail-closed, SEC V0-01). Wired in server.ts. */
    private readonly visibility?: VisibilityResolver,
    /** Lot V2: level and named-people list of a KPI. Optional: absent, every KPI stays CLIENT (restriction refused). */
    private readonly access?: ResourceVisibilityManager,
  ) {}

  /** I-4: `owner` is a free text, not an account — only the Risk Manager group changes a KPI's level. */
  private target(kpi: Kpi): VisibilityTarget {
    return { type: "KPI", entity: "Kpi", id: kpi.id, visibility: kpi.visibility ?? "CLIENT", ownerId: null, inheritsFrom: null };
  }

  async getAccess(actor: AuthenticatedUser, id: string): Promise<ResourceVisibilityState> {
    requirePermission(actor, "kpi.read");
    const kpi = await this.requireKpi(actor, id);
    if (!this.access) return { visibility: kpi.visibility ?? "CLIENT", accessUserIds: [] };
    return this.access.get(actor, this.target(kpi));
  }

  async setVisibility(
    actor: AuthenticatedUser,
    id: string,
    input: { visibility: Visibility; addUserIds?: string[]; revokeUserIds?: string[]; reason: string },
    requestId: string,
  ): Promise<ResourceVisibilityState> {
    requirePermission(actor, "kpi.read");
    const kpi = await this.requireKpi(actor, id);
    if (!this.access) throw new ValidationError("Changing a KPI's visibility is not available");
    return this.access.set(actor, this.target(kpi), input, requestId);
  }

  /** Lot V2 (SEC V1-02 extended): department / process of a restricted KPI decide who reads it. */
  private async perimeterGuard(actor: AuthenticatedUser, before: Kpi, input: { departmentId?: string | null; processId?: string | null }, reason: string | undefined) {
    const changed = (input.departmentId !== undefined && (input.departmentId ?? null) !== before.departmentId)
      || (input.processId !== undefined && (input.processId ?? null) !== before.processId);
    const guard = this.access?.guardPerimeterChange(actor, this.target(before), changed, reason) ?? null;
    const readersBefore = guard ? await this.access!.readers(actor, "KPI", before.id) : [];
    return {
      reason: guard?.reason ?? null,
      record: async (after: Kpi, requestId: string) => {
        if (!guard) return;
        await this.access!.recordPerimeterChange(actor, this.target(before), guard, readersBefore, {
          before: { departmentId: before.departmentId, processId: before.processId },
          after: { departmentId: after.departmentId, processId: after.processId },
        }, requestId);
      },
    };
  }

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateKpiInput, "tenantId">,
    requestId: string,
  ): Promise<Kpi> {
    requirePermission(actor, "kpi.create");
    if (!input.label.trim()) throw new ValidationError("label is required");
    if (!input.unit.trim()) throw new ValidationError("unit is required");
    if (!input.owner.trim()) throw new ValidationError("owner is required");
    if (!Number.isFinite(input.targetValue)) {
      throw new ValidationError("targetValue must be a finite number (ACT-140: cible chiffrée obligatoire)");
    }
    await this.validateLinkage(actor.tenantId, input.departmentId ?? null, input.processId ?? null);
    const visibility: Visibility = input.visibility ?? "CLIENT";
    if (visibility !== "CLIENT") {
      if (!this.access) throw new ValidationError("Restricted visibility is not available");
      const seesEverything = (await this.visibility?.resolve(actor))?.all === true;
      await this.access.assertCreation(actor, { visibility, inheritsFrom: null, isOwner: false, departmentId: input.departmentId ?? null, processId: input.processId ?? null }, seesEverything);
    }

    const kpi = await this.kpis.create({ ...input, visibility, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Kpi",
      entityId: kpi.id,
      action: "CREATE",
      oldValue: null,
      newValue: kpi,
      reason: null,
      requestId,
    });

    return kpi;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<KpiWithStatus> {
    requirePermission(actor, "kpi.read");
    const kpi = await this.kpis.getById(actor.tenantId, id, (await this.visibility?.resolve(actor)) ?? READER_DEFAULT_SCOPE);
    if (!kpi) throw new NotFoundError("Kpi", id);
    return this.withStatus(actor.tenantId, kpi);
  }

  /**
   * ACT-143's "tableau de bord KPI par département et processus" —
   * filterable listing where every row already carries its computed
   * status (ACT-142), so a dashboard client never has to call back per
   * KPI.
   */
  async list(actor: AuthenticatedUser, filters?: KpiListFilters): Promise<KpiWithStatus[]> {
    requirePermission(actor, "kpi.read");
    const kpis = await this.kpis.list(actor.tenantId, filters, (await this.visibility?.resolve(actor)) ?? READER_DEFAULT_SCOPE);
    return Promise.all(kpis.map((kpi) => this.withStatus(actor.tenantId, kpi)));
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    rawInput: UpdateKpiInput & { reason?: string },
    requestId: string,
  ): Promise<Kpi> {
    requirePermission(actor, "kpi.update");
    const { reason: rawReason, ...input } = rawInput;
    const before = await this.requireKpi(actor, id);

    if (input.label !== undefined && !input.label.trim()) throw new ValidationError("label cannot be empty");
    if (input.unit !== undefined && !input.unit.trim()) throw new ValidationError("unit cannot be empty");
    if (input.owner !== undefined && !input.owner.trim()) throw new ValidationError("owner cannot be empty");
    if (input.targetValue !== undefined && !Number.isFinite(input.targetValue)) {
      throw new ValidationError("targetValue must be a finite number");
    }

    if (input.departmentId !== undefined || input.processId !== undefined) {
      const departmentId = input.departmentId !== undefined ? input.departmentId : before.departmentId;
      const processId = input.processId !== undefined ? input.processId : before.processId;
      await this.validateLinkage(actor.tenantId, departmentId, processId);
    }

    const perimeter = await this.perimeterGuard(actor, before, input, rawReason);
    const after = await this.kpis.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Kpi",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: after,
      reason: perimeter.reason,
      requestId,
    });
    await perimeter.record(after, requestId);

    return after;
  }

  /**
   * ACT-144: "Lier un KPI à un département ou un processus" — a
   * narrower, dedicated action for the same invariant `update` already
   * enforces (at least one link must remain set), kept separate because
   * the backlog names it as its own endpoint (POST /kpis/:id/link).
   */
  async link(
    actor: AuthenticatedUser,
    id: string,
    input: { departmentId?: string | null; processId?: string | null; reason?: string },
    requestId: string,
  ): Promise<Kpi> {
    requirePermission(actor, "kpi.update");
    const before = await this.requireKpi(actor, id);

    const departmentId = input.departmentId !== undefined ? input.departmentId : before.departmentId;
    const processId = input.processId !== undefined ? input.processId : before.processId;
    await this.validateLinkage(actor.tenantId, departmentId, processId);

    const perimeter = await this.perimeterGuard(actor, before, input, input.reason);
    const after = await this.kpis.update(actor.tenantId, id, {
      departmentId: input.departmentId,
      processId: input.processId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Kpi",
      entityId: id,
      action: "ASSIGN",
      oldValue: before,
      newValue: after,
      reason: perimeter.reason,
      requestId,
    });
    await perimeter.record(after, requestId);

    return after;
  }

  /**
   * Not part of ACT-140..144 (the backlog defines no "delete a KPI"
   * action) but included for parity with every other in-place-update
   * module and the repo's blanket soft-delete convention — see the
   * KNOWN_LIMITATIONS note in this task's handoff about the extra
   * `kpi.delete` permission this requires.
   */
  async archive(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<void> {
    requirePermission(actor, "kpi.delete");
    if (!reason.trim()) throw new ValidationError("A reason is required to archive a KPI");
    const before = await this.requireKpi(actor, id);

    await this.kpis.softDelete(actor.tenantId, id, actor.userId, reason);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Kpi",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason,
      requestId,
    });
  }

  /** SEC V0-04 (lot V2): a KPI the actor may not read answers like a missing one, for every write too. */
  private async requireKpi(actor: AuthenticatedUser, id: string): Promise<Kpi> {
    const kpi = await this.kpis.getById(actor.tenantId, id, (await this.visibility?.resolve(actor)) ?? READER_DEFAULT_SCOPE);
    if (!kpi) throw new NotFoundError("Kpi", id);
    return kpi;
  }

  /** ACT-140/144 critical rule: "lien département ou processus" — enforced here and, defense in depth, by a DB CHECK constraint. */
  private async validateLinkage(
    tenantId: string,
    departmentId: string | null,
    processId: string | null,
  ): Promise<void> {
    if (!departmentId && !processId) {
      throw new ValidationError("A KPI must be linked to a department or a process (ACT-140/144)");
    }
    if (departmentId) {
      const department = await this.departments.getById(tenantId, departmentId);
      if (!department) throw new ValidationError(`Department ${departmentId} does not exist in this tenant`);
    }
    if (processId) {
      const process = await this.processes.getById(tenantId, processId);
      if (!process) throw new ValidationError(`Process ${processId} does not exist in this tenant`);
    }
  }

  private async withStatus(tenantId: string, kpi: Kpi): Promise<KpiWithStatus> {
    const latest = await this.measures.getLatest(tenantId, kpi.id);
    const { status, achievementRate } = computeKpiStatus(kpi.targetValue, latest?.value ?? null);
    return {
      ...kpi,
      status,
      achievementRate,
      latestMeasureValue: latest?.value ?? null,
      latestMeasurePeriod: latest?.period ?? null,
    };
  }
}
