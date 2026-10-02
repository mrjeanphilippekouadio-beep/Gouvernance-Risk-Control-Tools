import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { RiskEvaluationRepository } from "../domain/repositories/RiskEvaluationRepository.js";
import type { ControlRepository } from "../domain/repositories/ControlRepository.js";
import type { ControlEffectivenessRepository } from "../domain/repositories/ControlEffectivenessRepository.js";
import type { ActionPlanService } from "./ActionPlanService.js";
import type { RaciEnrichmentViewService } from "./RaciEnrichmentViewService.js";
import type { RiskAppetiteService } from "./RiskAppetiteService.js";
import type { Risk } from "../domain/entities/Risk.js";
import type { Control } from "../domain/entities/Control.js";
import type { ControlEffectivenessAssessment } from "../domain/entities/ControlEffectivenessAssessment.js";
import {
  AUTHORITATIVE_EVALUATION_STATUSES,
  type AuthoritativeEvaluationStatus,
  type RiskEvaluation,
} from "../domain/entities/RiskEvaluation.js";
import type { ActionPlanView } from "../domain/entities/ActionPlan.js";
import type { RaciAssignment } from "../domain/entities/RaciAssignment.js";
import type { RiskAppetite } from "../domain/entities/RiskAppetite.js";
import { NotFoundError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

export interface CoveringControlView {
  control: Control;
  /** Most recent assessment of this control, whatever its status — null when the control was never assessed. */
  lastEffectiveness: ControlEffectivenessAssessment | null;
}

export interface RiskAppetiteContext {
  /** RiskAppetite.threshold auto-resolved for (subCategory, entity) at the time the latest authoritative evaluation's residual score was recorded — null if that evaluation never reached residual scoring, or no authoritative evaluation exists. */
  appliedThreshold: number | null;
  suggestedThreshold: number | null;
  overrideThreshold: number | null;
  /** residualScore > appliedThreshold, straight off the evaluation — see RISK_BLOCK note on RiskDeviceView.evaluationStatus. */
  exceeded: boolean | null;
  /**
   * The threshold actually active *right now* for that (subCategory, entity)
   * — looked up live via RiskAppetiteService, independently of what the
   * evaluation captured. Can legitimately differ from appliedThreshold if
   * the threshold was redefined after the evaluation was scored (drift
   * visibility, not a discrepancy to silently reconcile). Null when there's
   * no authoritative evaluation to resolve a (subCategory, entity) from, or
   * no active threshold is defined for it.
   */
  currentThreshold: RiskAppetite | null;
}

export interface RiskDeviceView {
  risk: Risk;
  /**
   * Most recent evaluation among the authoritative terminal statuses
   * (VALIDATED, VALIDE_COMITE) — null if the risk has never been through a
   * finalized evaluation. RISK_BLOCK (Risk Manager, 2026-09-30 audit
   * finding): never read `residualScore`/`evaluationStatus` below without
   * this object (or its absence) — a BROUILLON/REJECTED evaluation is
   * never surfaced as authoritative here, same filter as
   * DashboardService/CartographyService/RiskOwnershipService.
   */
  latestAuthoritativeEvaluation: RiskEvaluation | null;
  /** Convenience mirror of latestAuthoritativeEvaluation.residualScore — never populated without evaluationStatus alongside it (see RISK_BLOCK note above). */
  residualScore: number | null;
  /** Convenience mirror of latestAuthoritativeEvaluation.status, narrowed to the two authoritative values — null means "no score to show", same contract as DashboardRiskSummary.evaluationStatus. */
  evaluationStatus: AuthoritativeEvaluationStatus | null;
  /** Full history, most recent first (BROUILLON/REJECTED included) — ACT-159 shape, for an auditor who wants to see drafts and rejections too, always alongside their own status. */
  evaluationHistory: RiskEvaluation[];
  coveringControls: CoveringControlView[];
  actionPlans: ActionPlanView[];
  raci: RaciAssignment[];
  appetite: RiskAppetiteContext;
}

/** Repositories don't declare an ordering in their interface — pick the latest explicitly rather than trust the SQL. */
function latestAssessment<T extends { createdAt: Date }>(assessments: T[]): T | null {
  return assessments.reduce<T | null>((best, a) => (best === null || a.createdAt > best.createdAt ? a : best), null);
}

/**
 * DECISION-002 point 4 / DECISION-003 (.claude/agent-context/ACTION_ITEMS.md,
 * 2026-09-28/29): backend for the "Risk 360 / Vue 360° du risque" and
 * "Dispositif de risque" screens of the UX brief
 * (docs/UX_Brief_Restructuration_Plateforme_v1.md §6 and §9).
 *
 * ONE service, not two — deliberate merge, not a shortcut:
 *   - DECISION-002 point 4 already settled Risk 360 as "the Registre
 *     enrichi, not a separate object" — a read composition over the same
 *     Risk, never a new entity.
 *   - DECISION-003 settled "Dispositif de risque" the same way, and its
 *     illustrative composition (RatingScale/mécanisme d'impact/Risques/
 *     Contrôles) is, in concrete domain terms, exactly this service's
 *     scope: a risk plus its evaluation, covering controls, action plans,
 *     RACI and applicable appetite.
 *   - Brief §6 itself ("Dispositif de risque") is actually about the
 *     Classique/Participatif workflow MODE, not a wider object — that
 *     distinction already exists as RiskEvaluation.evaluationMode
 *     (resolved by RiskEvaluationService.create, see that file's DIV-06
 *     comment). Nothing new was needed for §6 beyond what this service
 *     already surfaces (the evaluation, mode included).
 *
 * What this service deliberately does NOT cover, and why: brief §9 also
 * lists KRI, KPI, Incidents, and Audits as part of a full Risk 360. KRI/KPI
 * consolidation into `Indicator` is acted (ADR-002 Décision 3) but not
 * implemented — wiring it here would assume tables this codebase doesn't
 * have yet. Incident and Audit have no domain entities at all as of this
 * writing (Audit is being built on a separate branch,
 * feature/audit-module-backend, in parallel with this one — out of scope
 * here on purpose, not an oversight). Architecture's own review flagged
 * exactly this: Risk 360 must never be declared "prêt à coder" ahead of
 * Audit's modelling being settled. This service covers the subset that has
 * a real backend today (Risk, evaluation+status, covering controls +
 * their effectiveness, action plans, RACI, appetite) and is written so
 * extending it later — one more field, one more composed read — costs a
 * method, not a redesign.
 *
 * Read-only composition (`*ViewService` convention, ADR-003 Décision 2),
 * same template as RiskEvaluationViewService: no state transition, no
 * write, no audit entry, no raw SQL beyond what the composed
 * repositories/services already issue. Every permission this service's own
 * scope requires is checked before the first query — never as a filter
 * applied to an already-assembled response (PRIV-CH-DASH-001 — see also
 * the constructor's doc comment on why it doesn't resolve user identity at
 * all, so that specific condition doesn't even apply here).
 *
 * RACI is composed through RaciEnrichmentViewService, not
 * RaciAssignmentRepository directly — same reasoning as that service's own
 * file header: reusing it means this service never has to duplicate its
 * `raci.read` check or its entityType validation.
 */
export class RiskDeviceViewService {
  constructor(
    private readonly risks: RiskRepository,
    private readonly evaluations: RiskEvaluationRepository,
    private readonly controls: ControlRepository,
    private readonly effectiveness: ControlEffectivenessRepository,
    private readonly actionPlans: ActionPlanService,
    private readonly raci: RaciEnrichmentViewService,
    private readonly riskAppetites: RiskAppetiteService,
  ) {}

  async getDevice(actor: AuthenticatedUser, riskId: string): Promise<RiskDeviceView> {
    // Every permission this service's own reads need, checked up front —
    // never as a filter applied after assembly (PRIV-CH-DASH-001). RACI's
    // own raci.read is checked inside RaciEnrichmentViewService when it's
    // called below, same "each collaborator owns its own gate" pattern
    // that service itself documents.
    requirePermission(actor, "risk.read");
    requirePermission(actor, "riskevaluation.read");
    requirePermission(actor, "control.read");
    requirePermission(actor, "actionplan.read");
    requirePermission(actor, "riskappetite.read");

    const risk = await this.risks.getById(actor.tenantId, riskId);
    if (!risk) throw new NotFoundError("Risk", riskId);

    const evaluationHistory = await this.evaluations.listForRisk(actor.tenantId, riskId);
    // listForRisk orders created_at DESC (ACT-159) — the first match here is
    // genuinely the most recent authoritative evaluation, not just "an" one.
    const latestAuthoritativeEvaluation =
      evaluationHistory.find((e) => AUTHORITATIVE_EVALUATION_STATUSES.includes(e.status)) ?? null;

    const controls = await this.controls.listCoveringRisk(actor.tenantId, riskId);
    // ponytail: one effectiveness query per covering control, same call as
    // RiskEvaluationViewService.getEvaluationContext — a risk carries a
    // handful of controls, not hundreds.
    const coveringControls = await Promise.all(
      controls.map(async (control) => ({
        control,
        lastEffectiveness: latestAssessment(await this.effectiveness.listForControl(actor.tenantId, control.id)),
      })),
    );

    const actionPlans = await this.actionPlans.listForRisk(actor, riskId);
    const { raci } = await this.raci.getRiskWithRaci(actor, riskId);

    const currentThreshold = latestAuthoritativeEvaluation
      ? await this.riskAppetites.getApplicable(
          actor,
          latestAuthoritativeEvaluation.subCategory,
          latestAuthoritativeEvaluation.entity,
        )
      : null;

    return {
      risk,
      latestAuthoritativeEvaluation,
      // RISK_BLOCK: residualScore is only ever read alongside the status it
      // came from — both derived from the same (or absent) evaluation,
      // never independently.
      residualScore: latestAuthoritativeEvaluation?.residualScore ?? null,
      evaluationStatus: latestAuthoritativeEvaluation ? (latestAuthoritativeEvaluation.status as AuthoritativeEvaluationStatus) : null,
      evaluationHistory,
      coveringControls,
      actionPlans,
      raci,
      appetite: {
        appliedThreshold: latestAuthoritativeEvaluation?.appetiteThresholdApplied ?? null,
        suggestedThreshold: latestAuthoritativeEvaluation?.appetiteThresholdSuggested ?? null,
        overrideThreshold: latestAuthoritativeEvaluation?.appetiteThresholdOverride ?? null,
        exceeded: latestAuthoritativeEvaluation?.appetiteExceeded ?? null,
        currentThreshold,
      },
    };
  }
}
