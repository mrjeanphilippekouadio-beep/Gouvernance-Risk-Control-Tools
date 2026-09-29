import type { RiskEvaluationRepository } from "../domain/repositories/RiskEvaluationRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { ControlRepository } from "../domain/repositories/ControlRepository.js";
import type { ControlEffectivenessRepository } from "../domain/repositories/ControlEffectivenessRepository.js";
import type { RiskEvaluation } from "../domain/entities/RiskEvaluation.js";
import type { Risk } from "../domain/entities/Risk.js";
import type { Control } from "../domain/entities/Control.js";
import type { ControlEffectivenessAssessment } from "../domain/entities/ControlEffectivenessAssessment.js";
import { NotFoundError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

export interface CoveringControlView {
  control: Control;
  /** Most recent assessment of this control, whatever its status — null when the control was never assessed. */
  lastEffectiveness: ControlEffectivenessAssessment | null;
}

export interface RiskEvaluationContext {
  evaluation: RiskEvaluation;
  risk: Risk;
  coveringControls: CoveringControlView[];
}

/** Repositories don't declare an ordering in their interface — pick the latest explicitly rather than trust the SQL. */
function latest(assessments: ControlEffectivenessAssessment[]): ControlEffectivenessAssessment | null {
  return assessments.reduce<ControlEffectivenessAssessment | null>(
    (best, a) => (best === null || a.createdAt > best.createdAt ? a : best),
    null,
  );
}

/**
 * DIV-07 — read-only composition (`*ViewService` convention, ADR-003
 * Décision 2): shows the evaluator which controls actually cover the risk
 * being evaluated, and how effective each was last judged to be.
 *
 * NEVER derives `masteryLines`/`masteryGlobal` from control effectiveness.
 * Mastery stays a human judgement recorded through
 * `RiskEvaluationService.recordMasteryAssessment` — a validated evaluation
 * is immutable, and an auto-derived mastery would retroactively change
 * value every time a control is re-assessed (the exact defect
 * `ratingScaleId`/`ratingScaleVersion` were designed to avoid).
 *
 * No state transition, no write, no audit entry, no raw SQL: all reads go
 * through the existing repositories, scoped to `actor.tenantId`.
 *
 * Constructor injection is deliberately non-optional here — ADR-003
 * restricts the optional-parameter pattern to write services.
 */
export class RiskEvaluationViewService {
  constructor(
    private readonly evaluations: RiskEvaluationRepository,
    private readonly risks: RiskRepository,
    private readonly controls: ControlRepository,
    private readonly effectiveness: ControlEffectivenessRepository,
  ) {}

  async getEvaluationContext(actor: AuthenticatedUser, riskEvaluationId: string): Promise<RiskEvaluationContext> {
    // Three reads, three permissions — checked before any query, never as a
    // filter applied to an already-assembled response (PRIV-CH-DASH-001).
    requirePermission(actor, "riskevaluation.read");
    requirePermission(actor, "risk.read");
    requirePermission(actor, "control.read");

    const evaluation = await this.evaluations.getById(actor.tenantId, riskEvaluationId);
    if (!evaluation) throw new NotFoundError("RiskEvaluation", riskEvaluationId);

    const risk = await this.risks.getById(actor.tenantId, evaluation.riskId);
    if (!risk) throw new NotFoundError("Risk", evaluation.riskId);

    const controls = await this.controls.listCoveringRisk(actor.tenantId, evaluation.riskId);
    // ponytail: one effectiveness query per covering control (a risk carries a
    // handful, not hundreds). Add a batched listForControls() to the repository
    // if a real risk ever covers enough controls for this to show up.
    const coveringControls = await Promise.all(
      controls.map(async (control) => ({
        control,
        lastEffectiveness: latest(await this.effectiveness.listForControl(actor.tenantId, control.id)),
      })),
    );

    return { evaluation, risk, coveringControls };
  }
}
