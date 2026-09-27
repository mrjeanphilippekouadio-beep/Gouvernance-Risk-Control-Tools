import type { KriListFilters, KriRepository } from "../domain/repositories/KriRepository.js";
import type { KriMeasureRepository } from "../domain/repositories/KriMeasureRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import {
  computeKriStatus,
  type CreateKriInput,
  type Kri,
  type KriStatus,
  type UpdateKriInput,
} from "../domain/entities/Kri.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

export interface KriWithStatus extends Kri {
  status: KriStatus;
  latestMeasureValue: number | null;
  latestMeasureDate: Date | null;
}

export interface KriDashboardFilters {
  departmentId?: string;
  entity?: string;
  status?: KriStatus;
  periodFrom?: Date;
  periodTo?: Date;
}

export interface KriDashboardRow extends KriWithStatus {
  /** Resolved from the linked primary risk's ownerDepartmentId — kris carries no department of its own. */
  departmentId: string | null;
}

/**
 * New domain — no apps-script-legacy module to port (KRI tracking did
 * not exist in the Sheets tool). `kris` is updated in place, like
 * Kpi/Department/Process (ACT-131). A KRI's status is never stored: it's
 * computed here from KriMeasureRepository.getLatest vs the three
 * thresholds (ACT-134). ACT-136 (covering additional risks) is kept as
 * its own method because the backlog names it as a distinct endpoint,
 * separate from the mandatory primary `riskId` validated at create time.
 */
export class KriService {
  constructor(
    private readonly kris: KriRepository,
    private readonly measures: KriMeasureRepository,
    private readonly risks: RiskRepository,
    private readonly audit: AuditRepository,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateKriInput, "tenantId">,
    requestId: string,
  ): Promise<Kri> {
    requirePermission(actor, "kri.create");
    if (!input.label.trim()) throw new ValidationError("label is required");
    if (!input.formula.trim()) throw new ValidationError("formula is required");
    if (!input.riskId?.trim()) {
      throw new ValidationError("riskId is required (ACT-130: lien risque obligatoire)");
    }
    this.assertThresholdOrder(input.thresholdGreen, input.thresholdOrange, input.thresholdRed);
    await this.assertRiskExists(actor.tenantId, input.riskId);

    const kri = await this.kris.create({ ...input, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Kri",
      entityId: kri.id,
      action: "CREATE",
      oldValue: null,
      newValue: kri,
      reason: null,
      requestId,
    });

    return kri;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<KriWithStatus> {
    requirePermission(actor, "kri.read");
    const kri = await this.requireKri(actor.tenantId, id);
    return this.withStatus(actor.tenantId, kri);
  }

  async list(actor: AuthenticatedUser, filters?: KriListFilters): Promise<KriWithStatus[]> {
    requirePermission(actor, "kri.read");
    const kris = await this.kris.list(actor.tenantId, filters);
    return Promise.all(kris.map((kri) => this.withStatus(actor.tenantId, kri)));
  }

  /**
   * ACT-137: "tableau de bord KRI" — filterable by entity, department
   * (resolved from the linked primary risk), status (computed, ACT-134),
   * and period (the latest measure's date falling within [from, to]).
   */
  async dashboard(actor: AuthenticatedUser, filters?: KriDashboardFilters): Promise<KriDashboardRow[]> {
    requirePermission(actor, "kri.read");
    const kris = await this.kris.list(actor.tenantId, { entity: filters?.entity });

    const riskIds = [...new Set(kris.map((k) => k.riskId))];
    const linkedRisks = riskIds.length > 0 ? await this.risks.listByIds(actor.tenantId, riskIds) : [];
    const departmentByRiskId = new Map(linkedRisks.map((r) => [r.id, r.ownerDepartmentId]));

    const rows = await Promise.all(
      kris.map(async (kri): Promise<KriDashboardRow> => {
        const withStatus = await this.withStatus(actor.tenantId, kri);
        return { ...withStatus, departmentId: departmentByRiskId.get(kri.riskId) ?? null };
      }),
    );

    return rows.filter((row) => {
      if (filters?.departmentId && row.departmentId !== filters.departmentId) return false;
      if (filters?.status && row.status !== filters.status) return false;
      if (filters?.periodFrom && (!row.latestMeasureDate || row.latestMeasureDate < filters.periodFrom)) return false;
      if (filters?.periodTo && (!row.latestMeasureDate || row.latestMeasureDate > filters.periodTo)) return false;
      return true;
    });
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateKriInput,
    requestId: string,
  ): Promise<Kri> {
    requirePermission(actor, "kri.update");
    const before = await this.requireKri(actor.tenantId, id);

    if (input.label !== undefined && !input.label.trim()) throw new ValidationError("label cannot be empty");
    if (input.formula !== undefined && !input.formula.trim()) throw new ValidationError("formula cannot be empty");

    const green = input.thresholdGreen ?? before.thresholdGreen;
    const orange = input.thresholdOrange ?? before.thresholdOrange;
    const red = input.thresholdRed ?? before.thresholdRed;
    if (input.thresholdGreen !== undefined || input.thresholdOrange !== undefined || input.thresholdRed !== undefined) {
      this.assertThresholdOrder(green, orange, red);
    }

    const after = await this.kris.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Kri",
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
   * ACT-136: "Lier un KRI à un risque du registre" — replaces the set of
   * *additional* risks this KRI covers, beyond the mandatory primary
   * riskId set at creation. Uses the same DELETE+INSERT link-table
   * pattern as ControlRepository.replaceCoveredRisks (see CLAUDE.md's
   * control_risks exemption).
   */
  async addCoveredRisks(
    actor: AuthenticatedUser,
    id: string,
    riskIds: string[],
    requestId: string,
  ): Promise<{ riskId: string; coveredRiskIds: string[] }> {
    requirePermission(actor, "kri.update");
    const before = await this.requireKri(actor.tenantId, id);

    const uniqueIds = [...new Set(riskIds)].filter((rid) => rid !== before.riskId);
    if (uniqueIds.length > 0) {
      await this.assertRisksExist(actor.tenantId, uniqueIds);
    }

    await this.kris.replaceCoveredRisks(actor.tenantId, id, uniqueIds);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Kri",
      entityId: id,
      action: "ASSIGN",
      oldValue: { coveredRiskIds: await this.kris.listCoveredRiskIds(actor.tenantId, id) },
      newValue: { coveredRiskIds: uniqueIds },
      reason: null,
      requestId,
    });

    return { riskId: before.riskId, coveredRiskIds: uniqueIds };
  }

  /**
   * ACT-132: soft-delete. Gated on the dedicated `kri.delete` permission,
   * never `kri.update` — this codebase's established convention (see
   * KpiService.archive, RiskAppetiteService.archive, RatingScaleService.
   * disable) that a generic update must never reach a terminal/archived
   * state; only a narrow dedicated method with its own `.delete`
   * permission can.
   */
  async disable(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<void> {
    requirePermission(actor, "kri.delete");
    if (!reason.trim()) throw new ValidationError("A reason is required to disable a KRI");
    const before = await this.requireKri(actor.tenantId, id);

    await this.kris.softDelete(actor.tenantId, id, actor.userId, reason);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Kri",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason,
      requestId,
    });
  }

  private async requireKri(tenantId: string, id: string): Promise<Kri> {
    const kri = await this.kris.getById(tenantId, id);
    if (!kri) throw new NotFoundError("Kri", id);
    return kri;
  }

  /** ACT-130 critical rule: thresholds must satisfy green < orange < red (numerically increasing risk). */
  private assertThresholdOrder(green: number, orange: number, red: number): void {
    if (!Number.isFinite(green) || !Number.isFinite(orange) || !Number.isFinite(red)) {
      throw new ValidationError("thresholds must be finite numbers");
    }
    if (!(green < orange && orange < red)) {
      throw new ValidationError(
        "thresholds must satisfy thresholdGreen < thresholdOrange < thresholdRed (ACT-130)",
      );
    }
  }

  private async assertRiskExists(tenantId: string, riskId: string): Promise<void> {
    const risk = await this.risks.getById(tenantId, riskId);
    if (!risk) throw new ValidationError(`Risk ${riskId} does not exist in this tenant`);
  }

  private async assertRisksExist(tenantId: string, riskIds: string[]): Promise<void> {
    const found = await this.risks.listByIds(tenantId, riskIds);
    const foundIds = new Set(found.map((r) => r.id));
    const missing = riskIds.filter((rid) => !foundIds.has(rid));
    if (missing.length > 0) {
      throw new ValidationError(`Risk(s) do not exist in this tenant: ${missing.join(", ")}`);
    }
  }

  private async withStatus(tenantId: string, kri: Kri): Promise<KriWithStatus> {
    const latest = await this.measures.getLatest(tenantId, kri.id);
    const status = computeKriStatus(kri, latest?.value ?? null);
    return {
      ...kri,
      status,
      latestMeasureValue: latest?.value ?? null,
      latestMeasureDate: latest?.measureDate ?? null,
    };
  }
}
