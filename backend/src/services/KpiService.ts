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
  ) {}

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

    const kpi = await this.kpis.create({ ...input, tenantId: actor.tenantId });

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
    const kpi = await this.requireKpi(actor.tenantId, id);
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
    const kpis = await this.kpis.list(actor.tenantId, filters);
    return Promise.all(kpis.map((kpi) => this.withStatus(actor.tenantId, kpi)));
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateKpiInput,
    requestId: string,
  ): Promise<Kpi> {
    requirePermission(actor, "kpi.update");
    const before = await this.requireKpi(actor.tenantId, id);

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

    const after = await this.kpis.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Kpi",
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
   * ACT-144: "Lier un KPI à un département ou un processus" — a
   * narrower, dedicated action for the same invariant `update` already
   * enforces (at least one link must remain set), kept separate because
   * the backlog names it as its own endpoint (POST /kpis/:id/link).
   */
  async link(
    actor: AuthenticatedUser,
    id: string,
    input: { departmentId?: string | null; processId?: string | null },
    requestId: string,
  ): Promise<Kpi> {
    requirePermission(actor, "kpi.update");
    const before = await this.requireKpi(actor.tenantId, id);

    const departmentId = input.departmentId !== undefined ? input.departmentId : before.departmentId;
    const processId = input.processId !== undefined ? input.processId : before.processId;
    await this.validateLinkage(actor.tenantId, departmentId, processId);

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
      reason: null,
      requestId,
    });

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
    const before = await this.requireKpi(actor.tenantId, id);

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

  private async requireKpi(tenantId: string, id: string): Promise<Kpi> {
    const kpi = await this.kpis.getById(tenantId, id);
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
