import type { KriMeasureListFilters, KriMeasureListResult, KriMeasureRepository } from "../domain/repositories/KriMeasureRepository.js";
import type { KriRepository } from "../domain/repositories/KriRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { CreateKriMeasureInput, KriMeasure } from "../domain/entities/KriMeasure.js";
import { computeKriStatus } from "../domain/entities/Kri.js";
import { ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { Notifier } from "../infrastructure/notifications/Notifier.js";

/**
 * ACT-133: append-only, like KpiMeasureService/ControlExecutionService —
 * a new row per recorded value, never an update to a previous measure.
 * No apps-script-legacy precedent (KRI tracking is a new domain).
 *
 * ACT-135: on record, if the new value breaches the Orange or Rouge
 * threshold, the injected Notifier (optional — same pattern as
 * FeedbackService's notifier) is called with a best-effort broadcast.
 * This batch does not build a persistent notification/ticket entity for
 * these alerts (per the task brief) — just a direct Notifier call. A
 * persistent notification log (so a breach isn't lost if nobody was
 * watching the channel when it fired, and so Risk Owner / superior_owner
 * targeting from ACT-135's "regles_critiques" can be resolved to actual
 * users rather than a single broadcast channel) is a reasonable next
 * step, but Risk doesn't yet carry an owner *user*, only
 * ownerDepartmentId — flagging this as an open question rather than
 * guessing at a notification-target model.
 */
export class KriMeasureService {
  constructor(
    private readonly measures: KriMeasureRepository,
    private readonly kris: KriRepository,
    private readonly audit: AuditRepository,
    /** Optional so existing callers/tests built before this existed don't need to change. */
    private readonly notifier?: Notifier,
  ) {}

  async record(
    actor: AuthenticatedUser,
    input: Omit<CreateKriMeasureInput, "tenantId" | "recordedBy">,
    requestId: string,
  ): Promise<KriMeasure> {
    requirePermission(actor, "kri.create");

    const kri = await this.kris.getById(actor.tenantId, input.kriId);
    if (!kri) throw new ValidationError(`Kri ${input.kriId} does not exist in this tenant`);

    if (!Number.isFinite(input.value)) {
      throw new ValidationError("value must be a finite number");
    }
    if (!(input.measureDate instanceof Date) || Number.isNaN(input.measureDate.getTime())) {
      throw new ValidationError("measureDate must be a valid date");
    }
    if (!input.source?.trim()) {
      throw new ValidationError("source is required (ACT-133: date_mesure + valeur + source)");
    }

    const measure = await this.measures.create({
      ...input,
      tenantId: actor.tenantId,
      recordedBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "KriMeasure",
      entityId: measure.id,
      action: "CREATE",
      oldValue: null,
      newValue: measure,
      reason: null,
      requestId,
    });

    const status = computeKriStatus(kri, measure.value);
    if (status === "ORANGE" || status === "ROUGE") {
      this.notifier
        ?.notify(
          `Alerte KRI [${status}] "${kri.label}" (risque ${kri.riskId}) : valeur ${measure.value} le ${measure.measureDate.toISOString().slice(0, 10)} (seuil orange=${kri.thresholdOrange}, rouge=${kri.thresholdRed})`,
        )
        .catch(() => {
          // Best-effort — a broken notification channel must never fail the actual measure recording.
        });
    }

    return measure;
  }

  async listForKri(actor: AuthenticatedUser, kriId: string, filters?: KriMeasureListFilters): Promise<KriMeasureListResult> {
    requirePermission(actor, "kri.read");
    const kri = await this.kris.getById(actor.tenantId, kriId);
    if (!kri) throw new ValidationError(`Kri ${kriId} does not exist in this tenant`);
    return this.measures.listForKri(actor.tenantId, kriId, filters);
  }
}
