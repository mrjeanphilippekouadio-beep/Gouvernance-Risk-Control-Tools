import type { KpiMeasureRepository } from "../domain/repositories/KpiMeasureRepository.js";
import type { KpiRepository } from "../domain/repositories/KpiRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { CreateKpiMeasureInput, KpiMeasure } from "../domain/entities/KpiMeasure.js";
import { ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/**
 * ACT-141: append-only, like ControlExecutionService — a new row per
 * recorded value, never an update to a previous measure. No
 * apps-script-legacy precedent (KPI tracking is a new domain).
 */
export class KpiMeasureService {
  constructor(
    private readonly measures: KpiMeasureRepository,
    private readonly kpis: KpiRepository,
    private readonly audit: AuditRepository,
  ) {}

  async record(
    actor: AuthenticatedUser,
    input: Omit<CreateKpiMeasureInput, "tenantId" | "recordedBy">,
    requestId: string,
  ): Promise<KpiMeasure> {
    requirePermission(actor, "kpi.create");

    const kpi = await this.kpis.getById(actor.tenantId, input.kpiId);
    if (!kpi) throw new ValidationError(`Kpi ${input.kpiId} does not exist in this tenant`);

    if (!Number.isFinite(input.value)) {
      throw new ValidationError("value must be a finite number");
    }
    if (!(input.period instanceof Date) || Number.isNaN(input.period.getTime())) {
      throw new ValidationError("period must be a valid date");
    }

    const measure = await this.measures.create({
      ...input,
      tenantId: actor.tenantId,
      recordedBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "KpiMeasure",
      entityId: measure.id,
      action: "CREATE",
      oldValue: null,
      newValue: measure,
      reason: null,
      requestId,
    });

    return measure;
  }

  async listForKpi(actor: AuthenticatedUser, kpiId: string): Promise<KpiMeasure[]> {
    requirePermission(actor, "kpi.read");
    const kpi = await this.kpis.getById(actor.tenantId, kpiId);
    if (!kpi) throw new ValidationError(`Kpi ${kpiId} does not exist in this tenant`);
    return this.measures.listForKpi(actor.tenantId, kpiId);
  }
}
