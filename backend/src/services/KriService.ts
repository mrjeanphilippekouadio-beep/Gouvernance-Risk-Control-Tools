import { readerScope } from "../domain/visibility.js";
import { assertReadableByRisk, hiddenRiskIds, keepReadableByRisk } from "./riskVisibility.js";
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
import type { AuditEvent } from "../domain/entities/AuditEvent.js";
import { writeAudited } from "./auditedWrite.js";
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
    // F7S6-02: a KRI is always created active; the only end of life is disable (kri.delete, with a reason).
    if (input.active !== undefined) throw new ValidationError("active cannot be set at creation — a KRI is always created active");
    if (!input.label.trim()) throw new ValidationError("label is required");
    if (!input.formula.trim()) throw new ValidationError("formula is required");
    if (!input.riskId?.trim()) {
      throw new ValidationError("riskId is required (ACT-130: lien risque obligatoire)");
    }
    this.assertThresholdOrder(input.thresholdGreen, input.thresholdOrange, input.thresholdRed);
    await this.assertRiskExists(actor, input.riskId);

    // F7S6-01 (DECISION-079): the write and its audit row in one transaction.
    return writeAudited<Kri>(
      this.kris.auditsInTransaction,
      this.audit,
      (audit) => this.kris.create({ ...input, tenantId: actor.tenantId }, audit),
      (kri) => [this.event(actor, kri.id, "CREATE", null, kri, null, requestId)],
    );
  }

  /** F7-S6: the detail also carries the additional covered risks (ACT-136), so the screen can show and edit them. */
  async get(actor: AuthenticatedUser, id: string): Promise<KriWithStatus & { coveredRiskIds: string[] }> {
    requirePermission(actor, "kri.read");
    const kri = await this.requireKri(actor, id);
    // QA-F7S6-01/03: only covered risks that still exist (not archived) — the screen never shows a raw id.
    // Lot V1: nor a covered risk the reader may not see.
    const linked = await this.kris.listCoveredRiskIds(actor.tenantId, id);
    const live = new Set(linked.length > 0 ? (await this.risks.listByIds(actor.tenantId, linked)).map((r) => r.id) : []);
    const hidden = await hiddenRiskIds(this.risks, actor, linked);
    return {
      ...(await this.withStatus(actor.tenantId, kri)),
      coveredRiskIds: linked.filter((rid) => live.has(rid) && !hidden.has(rid)),
    };
  }

  async list(actor: AuthenticatedUser, filters?: KriListFilters): Promise<KriWithStatus[]> {
    requirePermission(actor, "kri.read");
    // Lot V1 (q193): a KRI follows the visibility of its primary risk.
    const kris = await keepReadableByRisk(this.risks, actor, await this.kris.list(actor.tenantId, filters), (k) => k.riskId);
    return Promise.all(kris.map((kri) => this.withStatus(actor.tenantId, kri)));
  }

  /**
   * ACT-137: "tableau de bord KRI" — filterable by entity, department
   * (resolved from the linked primary risk), status (computed, ACT-134),
   * and period (the latest measure's date falling within [from, to]).
   */
  async dashboard(actor: AuthenticatedUser, filters?: KriDashboardFilters): Promise<KriDashboardRow[]> {
    requirePermission(actor, "kri.read");
    const kris = await keepReadableByRisk(this.risks, actor, await this.kris.list(actor.tenantId, { entity: filters?.entity }), (k) => k.riskId);

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
    // CLAUDE.md / SEC-013-014: a generic update never changes the active state; deactivation is terminal and
    // has its own method and permission (disable, kri.delete). No reactivation exists, so `true` is refused too.
    if (input.active !== undefined) {
      throw new ValidationError("active cannot be changed through update — use PATCH /kris/:id/disable (kri.delete)");
    }
    const before = await this.requireKri(actor, id);

    if (input.label !== undefined && !input.label.trim()) throw new ValidationError("label cannot be empty");
    if (input.formula !== undefined && !input.formula.trim()) throw new ValidationError("formula cannot be empty");

    const green = input.thresholdGreen ?? before.thresholdGreen;
    const orange = input.thresholdOrange ?? before.thresholdOrange;
    const red = input.thresholdRed ?? before.thresholdRed;
    if (input.thresholdGreen !== undefined || input.thresholdOrange !== undefined || input.thresholdRed !== undefined) {
      this.assertThresholdOrder(green, orange, red);
    }

    return writeAudited<Kri>(
      this.kris.auditsInTransaction,
      this.audit,
      (audit) => this.kris.update(actor.tenantId, id, input, audit),
      (after) => [this.event(actor, id, "UPDATE", before, after, null, requestId)],
    );
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
    const before = await this.requireKri(actor, id);

    const requested = [...new Set(riskIds)].filter((rid) => rid !== before.riskId);
    // QA-F7S6-01: only the risks being ADDED must exist (not archived); a risk archived after being linked can stay
    // or be removed without blocking the change.
    const linked = new Set(await this.kris.listCoveredRiskIds(actor.tenantId, id));
    const added = requested.filter((rid) => !linked.has(rid));
    if (added.length > 0) await this.assertRisksExist(actor, added);
    // Lot V1 (Codex P2): the editor replaces only what they see; a link to a risk they may not see is kept server-side.
    const hiddenLinked = await hiddenRiskIds(this.risks, actor, [...linked]);
    const uniqueIds = [...new Set([...requested, ...hiddenLinked])];

    // F7S6-01: the repository reads the previous set inside the replacing transaction (KRI row locked, still active)
    // and returns it, so the audit's oldValue is the set actually overwritten. Fakes return nothing: fall back.
    await writeAudited<string[]>(
      this.kris.auditsInTransaction,
      this.audit,
      async (audit) => (await this.kris.replaceCoveredRisks(actor.tenantId, id, uniqueIds, audit)) ?? [...linked],
      (old) => [this.event(actor, id, "ASSIGN", { coveredRiskIds: old }, { coveredRiskIds: uniqueIds }, null, requestId)],
    );

    return { riskId: before.riskId, coveredRiskIds: uniqueIds.filter((rid) => !hiddenLinked.has(rid)) };
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
    const before = await this.requireKri(actor, id);

    await writeAudited<void>(
      this.kris.auditsInTransaction,
      this.audit,
      (audit) => this.kris.softDelete(actor.tenantId, id, actor.userId, reason, audit),
      () => [this.event(actor, id, "DELETE", before, null, reason, requestId)],
    );
  }

  private event(
    actor: AuthenticatedUser,
    entityId: string,
    action: AuditEvent["action"],
    oldValue: unknown,
    newValue: unknown,
    reason: string | null,
    requestId: string,
  ): Omit<AuditEvent, "id" | "timestamp"> {
    return { tenantId: actor.tenantId, userId: actor.userId, entityType: "Kri", entityId, action, oldValue, newValue, reason, requestId };
  }

  /** Lot V1 (q193): a KRI of a risk the actor may not read answers like a missing one. */
  private async requireKri(actor: AuthenticatedUser, id: string): Promise<Kri> {
    const kri = await this.kris.getById(actor.tenantId, id);
    if (!kri) throw new NotFoundError("Kri", id);
    await assertReadableByRisk(this.risks, actor, kri.riskId, "Kri", id);
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

  /** Lot V1: one cannot attach a KRI to a risk one does not see (same answer as a missing risk). */
  private async assertRiskExists(actor: AuthenticatedUser, riskId: string): Promise<void> {
    const risk = await this.risks.getById(actor.tenantId, riskId, readerScope(actor));
    if (!risk) throw new ValidationError(`Risk ${riskId} does not exist in this tenant`);
  }

  private async assertRisksExist(actor: AuthenticatedUser, riskIds: string[]): Promise<void> {
    const found = await this.risks.listByIds(actor.tenantId, riskIds);
    const hidden = await hiddenRiskIds(this.risks, actor, riskIds);
    const foundIds = new Set(found.map((r) => r.id).filter((rid) => !hidden.has(rid)));
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
