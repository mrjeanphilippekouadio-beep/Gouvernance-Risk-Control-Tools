import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { RiskEvaluationRepository } from "../domain/repositories/RiskEvaluationRepository.js";
import type { AnomalyRepository } from "../domain/repositories/AnomalyRepository.js";
import type { KriRepository } from "../domain/repositories/KriRepository.js";
import type { KriMeasureRepository } from "../domain/repositories/KriMeasureRepository.js";
import type { ActionPlanRepository } from "../domain/repositories/ActionPlanRepository.js";
import type { RiskAppetiteRepository } from "../domain/repositories/RiskAppetiteRepository.js";
import type { ControlRepository } from "../domain/repositories/ControlRepository.js";
import type { ControlExecutionRepository } from "../domain/repositories/ControlExecutionRepository.js";
import type { ControlEffectivenessRepository } from "../domain/repositories/ControlEffectivenessRepository.js";
import type { DepartmentRepository } from "../domain/repositories/DepartmentRepository.js";
import type { KpiRepository } from "../domain/repositories/KpiRepository.js";
import type { KpiMeasureRepository } from "../domain/repositories/KpiMeasureRepository.js";
import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";

import type { Risk, RiskStatus } from "../domain/entities/Risk.js";
import type { Process } from "../domain/entities/Process.js";
import {
  AUTHORITATIVE_EVALUATION_STATUSES,
  type AuthoritativeEvaluationStatus,
  type RiskEvaluation,
} from "../domain/entities/RiskEvaluation.js";
import type { Anomaly, AnomalyStatus } from "../domain/entities/Anomaly.js";
import { computeKriStatus, type Kri, type KriStatus } from "../domain/entities/Kri.js";
import {
  computeActionPlanPriority,
  computeActionPlanStatus,
  type ActionPlan,
  type ActionPlanListFilters,
  type ActionPlanView,
} from "../domain/entities/ActionPlan.js";
import type { Control } from "../domain/entities/Control.js";
import type { Department } from "../domain/entities/Department.js";
import { computeKpiStatus, type Kpi, type KpiStatus } from "../domain/entities/Kpi.js";

import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { DashboardScopeMode, RiskScope } from "../domain/entities/DashboardScope.js";
import type { DashboardScopeResolver } from "./DashboardScopeResolver.js";

// ---------------------------------------------------------------------
// Shared read models
// ---------------------------------------------------------------------

/**
 * Fixed fallback bands over the 1-25 score range, identical to
 * CartographyService's DEFAULT_CRITICALITY_BANDS. Deliberately NOT
 * wired to RatingScaleRepository here: CartographyService already owns
 * the "resolve the tenant's configured, methodology-versioned bands"
 * concern (ACT-181), and re-implementing that exact resolution here
 * would be the kind of duplicated aggregation logic this batch's brief
 * explicitly warns against. Dashboard/Reporting only need a rough
 * qualitative label for ranking/highlighting, not the heatmap's
 * methodology-accurate legend — if that ever changes, inject
 * RatingScaleRepository and reuse the exact same resolution instead of
 * hand-rolling a second one.
 */
const DEFAULT_CRITICALITY_BANDS: { label: string; min: number; max: number }[] = [
  { label: "Faible", min: 1, max: 4 },
  { label: "Modéré", min: 5, max: 9 },
  { label: "Élevé", min: 10, max: 15 },
  { label: "Critique", min: 16, max: 25 },
];

function deriveCriticality(score: number): string {
  const match = DEFAULT_CRITICALITY_BANDS.find((b) => score >= b.min && score <= b.max);
  if (match) return match.label;
  const first = DEFAULT_CRITICALITY_BANDS[0]!;
  const last = DEFAULT_CRITICALITY_BANDS[DEFAULT_CRITICALITY_BANDS.length - 1]!;
  return score < first.min ? first.label : last.label;
}

function toActionPlanView(action: ActionPlan): ActionPlanView {
  const computedStatus = computeActionPlanStatus(action);
  return { ...action, computedStatus, priority: computeActionPlanPriority(computedStatus) };
}

export interface DashboardRiskSummary {
  riskId: string;
  /** DIV-05 wiring: `Process.name` when `Risk.processId` resolves to a real process, `Risk.process` free text otherwise — see `resolvedVia`. */
  process: string;
  /** `Risk.processId` verbatim — null when the risk was never linked to a real Process row. */
  processId: string | null;
  /**
   * Explicit marker for how `process` above was produced — never a
   * silent degradation, same contract as CartographyDataPoint.resolvedVia.
   */
  resolvedVia: "processId" | "processText";
  description: string;
  status: RiskStatus;
  ownerDepartmentId: string | null;
  ownerId: string | null;
  /** Most recent authoritative (VALIDATED or VALIDE_COMITE) evaluation's residualScore (falling back to inherentScore), null if never authoritatively evaluated. */
  score: number | null;
  /** Which terminal status backs `score` — null when no authoritative evaluation was found (distinct from "evaluated but excluded": BROUILLON/REJECTED evaluations are never authoritative and always yield null here too). */
  evaluationStatus: AuthoritativeEvaluationStatus | null;
  criticality: string | null;
  subCategory: string | null;
  entity: string | null;
  appetiteExceeded: boolean | null;
}

export interface DashboardKriSummary {
  kri: Kri;
  status: KriStatus;
  latestValue: number | null;
  latestMeasureDate: Date | null;
}

export interface KriTrendPoint {
  measureDate: Date;
  value: number;
}

export interface KriConsolidatedRow extends DashboardKriSummary {
  /** Most recent first — same ordering as KriMeasureRepository.listForKri. */
  trend: KriTrendPoint[];
}

export interface DashboardKpiSummary {
  kpi: Kpi;
  status: KpiStatus;
  achievementRate: number | null;
  latestValue: number | null;
}

interface ScoredRisk {
  risk: Risk;
  evaluation: RiskEvaluation;
  score: number;
}

// ---------------------------------------------------------------------
// Per-endpoint response shapes
// ---------------------------------------------------------------------

export interface DepartmentDashboard {
  department: Department;
  risks: DashboardRiskSummary[];
  controls: Control[];
  kpis: DashboardKpiSummary[];
  kris: DashboardKriSummary[];
  actions: ActionPlanView[];
}

/**
 * @architect design 2026-09-30: surfaced on every dashboard.executive
 * response so the UI can render "périmètre : 2 départements" instead of
 * a silently empty page when a DEPARTMENT/PROCESS-scoped actor's
 * perimeter is genuinely empty (rule: empty perimeter -> empty
 * dashboard, never a fallback to GLOBAL).
 */
export interface DashboardScopeSummary {
  mode: DashboardScopeMode;
  departmentCount: number;
}

export interface ExecutiveDashboard {
  totalActiveRisks: number;
  topRisks: DashboardRiskSummary[];
  criticalKris: DashboardKriSummary[];
  overdueActions: ActionPlanView[];
  openAnomaliesCount: number;
  scope: DashboardScopeSummary;
}

export interface RiskCommitteeReport {
  topRisks: DashboardRiskSummary[];
  krisInAlert: DashboardKriSummary[];
  overdueActions: ActionPlanView[];
  scope: DashboardScopeSummary;
}

export interface ConsolidatedEntityBreakdown {
  /** RiskEvaluation.entity / Kri.entity free-text scope — "UNSPECIFIED" groups rows with no entity set. See getConsolidatedReport's doc comment for why this is NOT a cross-tenant view. */
  entity: string;
  riskCount: number;
  topRisks: DashboardRiskSummary[];
  criticalKriCount: number;
}

export interface ConsolidatedReport {
  entities: ConsolidatedEntityBreakdown[];
  scope: DashboardScopeSummary;
}

export interface AppetiteVsResidualRow {
  subCategory: string;
  entity: string | null;
  threshold: number | null;
  maxResidualScore: number | null;
  exceedanceCount: number;
  exceeded: boolean;
  riskIds: string[];
}

export interface KriConsolidatedReport {
  kris: KriConsolidatedRow[];
  activeAlerts: KriConsolidatedRow[];
  scope: DashboardScopeSummary;
}

export interface RiskOwnerAlert {
  type: "APPETITE_EXCEEDED" | "KRI_THRESHOLD";
  message: string;
  riskId?: string;
  kriId?: string;
}

export interface RiskOwnerDashboard {
  ownerId: string;
  risks: DashboardRiskSummary[];
  kris: DashboardKriSummary[];
  actions: ActionPlanView[];
  alerts: RiskOwnerAlert[];
}

export interface ComplianceReportFilters {
  framework: string;
  entity?: string;
  from?: Date;
  to?: Date;
}

export interface ComplianceReport {
  /**
   * Echoed back verbatim, never validated against a table of known
   * frameworks — see the class doc comment: there is no
   * regulatory-framework entity in this codebase yet (that's Config's
   * ACT-223), so `framework` has NO effect on which controls/executions
   * are counted below. This is a placeholder pending that module, not a
   * finished framework-aware compliance score.
   */
  framework: string;
  entity: string | null;
  period: { from: Date | null; to: Date | null };
  totalControls: number;
  /** DONE / (DONE + NOT_DONE) among matching ControlExecutions, null if there is no sample. */
  controlExecutionPassRate: number | null;
  /** EFFECTIVE / total among matching ControlEffectivenessAssessments, null if there is no sample. */
  controlEffectivenessPassRate: number | null;
  overdueControlActions: number;
}

// ---------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------

/**
 * ACT-080/081/082/084(partial: branding is its own BrandingService)/
 * 210-215/240-243 — the single shared, read-only aggregation layer for
 * both Dashboard and Reporting. Both domains overlap by design (per the
 * task brief): a "top risks by criticality" query, a "KRIs in
 * alert" query, and a "compliance signal" query are each computed here
 * exactly once and reused by whichever route (dashboard.routes.ts or
 * reports.routes.ts) needs that particular shape. There is deliberately
 * no separate ReportingService class duplicating these queries under a
 * different name — see the two thin route files for how the same
 * methods are exposed under both `/dashboard/*` and `/reports/*`.
 *
 * Pure read-only aggregation, like CartographyService: no entity of its
 * own, no migration, no writes, nothing to audit.
 *
 * N+1 by design in several places (most recent authoritative evaluation
 * per risk, executions/assessments per control) — same acknowledged
 * trade-off as CartographyService: none of the underlying repositories
 * expose a bulk "most recent per parent" query, and this is not the
 * place to add one speculatively to a neighboring, already-shipped
 * module's interface.
 */
export class DashboardService {
  constructor(
    private readonly risks: RiskRepository,
    private readonly evaluations: RiskEvaluationRepository,
    private readonly anomalies: AnomalyRepository,
    private readonly kris: KriRepository,
    private readonly kriMeasures: KriMeasureRepository,
    private readonly actionPlans: ActionPlanRepository,
    private readonly riskAppetites: RiskAppetiteRepository,
    private readonly controls: ControlRepository,
    private readonly controlExecutions: ControlExecutionRepository,
    private readonly controlEffectiveness: ControlEffectivenessRepository,
    private readonly departments: DepartmentRepository,
    private readonly kpis: KpiRepository,
    private readonly kpiMeasures: KpiMeasureRepository,
    /**
     * DIV-05 wiring (ACTION_ITEMS.md, 2026-09-30): optional so existing
     * construction sites keep working unchanged. When absent, every risk
     * summary falls back to `Risk.process` free text — same degrade-
     * never-throw posture as CartographyService.processes, always
     * flagged via `resolvedVia`, never silently.
     */
    private readonly processes?: ProcessRepository,
    /**
     * @architect design 2026-09-30 (dashboard.executive scope): optional,
     * same degrade-never-throw posture as `processes` above — when
     * absent, every scope resolves to GLOBAL (today's unscoped
     * behavior), so existing construction sites keep working unchanged.
     */
    private readonly scopeResolver?: DashboardScopeResolver,
  ) {}

  // -- ACT-080 ---------------------------------------------------------

  /** GET /dashboard/risks — consolidated, tenant-filtered risk view. Includes risks with no validated evaluation yet (score/criticality null), unlike CartographyService which excludes them. */
  async getRisksOverview(actor: AuthenticatedUser): Promise<DashboardRiskSummary[]> {
    requirePermission(actor, "dashboard.read");
    const risks = await this.risks.list(actor.tenantId);
    return Promise.all(risks.map((risk) => this.toRiskSummaryOrNull(actor.tenantId, risk)));
  }

  // -- ACT-081 ---------------------------------------------------------

  /**
   * GET /dashboard/anomalies?status=open,in_progress — the backlog's
   * literal query tokens ("open", "in_progress") aren't Anomaly's actual
   * status enum (NEW/UNDER_ANALYSIS/ACTION_IN_PROGRESS/CLOSED); mapping
   * those generic tokens to real AnomalyStatus values is done in the
   * route layer (HTTP shaping), not here — this method just takes real
   * AnomalyStatus values and defaults to "everything not CLOSED" when
   * none are given.
   */
  async getOpenAnomalies(actor: AuthenticatedUser, statuses?: AnomalyStatus[]): Promise<Anomaly[]> {
    requirePermission(actor, "dashboard.read");
    const wanted: AnomalyStatus[] =
      statuses && statuses.length > 0 ? statuses : ["NEW", "UNDER_ANALYSIS", "ACTION_IN_PROGRESS"];
    const all = await this.anomalies.list(actor.tenantId);
    return all.filter((a) => wanted.includes(a.status));
  }

  // -- ACT-082 / ACT-210 / ACT-243 -------------------------------------

  /**
   * GET /dashboard/compliance and GET /reports/compliance?framework=...
   * — the SAME query, per the task brief, exposed under both paths by
   * both route files calling this one method. See ComplianceReport's
   * doc comment on `framework` for why it doesn't filter anything yet.
   * `entity` filters via Control.departmentId -> Department.entity
   * (Control itself has no entity field); `from`/`to` filter execution
   * completedDate / assessment evalDate.
   */
  async getComplianceReport(actor: AuthenticatedUser, filters: ComplianceReportFilters): Promise<ComplianceReport> {
    requirePermission(actor, "dashboard.read");
    if (!filters.framework?.trim()) {
      throw new ValidationError("framework is required (ACT-210: cadre obligatoire en paramètre)");
    }

    const controls = await this.controls.list(actor.tenantId, { includeArchived: false });
    const scopedControls = filters.entity
      ? await this.filterControlsByEntity(actor.tenantId, controls, filters.entity)
      : controls;

    let doneCount = 0;
    let notDoneCount = 0;
    let effectiveCount = 0;
    let assessedCount = 0;

    for (const control of scopedControls) {
      const executions = await this.controlExecutions.listForControl(actor.tenantId, control.id);
      for (const execution of executions) {
        if (filters.from && execution.completedDate && execution.completedDate < filters.from) continue;
        if (filters.to && execution.completedDate && execution.completedDate > filters.to) continue;
        if (execution.status === "DONE") doneCount++;
        else if (execution.status === "NOT_DONE") notDoneCount++;
      }

      const assessments = await this.controlEffectiveness.listForControl(actor.tenantId, control.id);
      for (const assessment of assessments) {
        if (filters.from && assessment.evalDate < filters.from) continue;
        if (filters.to && assessment.evalDate > filters.to) continue;
        assessedCount++;
        if (assessment.operationalEffectiveness === "EFFECTIVE") effectiveCount++;
      }
    }

    const overdueControlActions = (
      await this.getOverdueActionViews(actor.tenantId, { sourceType: "CONTROL" })
    ).length;

    const executionSample = doneCount + notDoneCount;

    return {
      framework: filters.framework.trim(),
      entity: filters.entity ?? null,
      period: { from: filters.from ?? null, to: filters.to ?? null },
      totalControls: scopedControls.length,
      controlExecutionPassRate: executionSample > 0 ? doneCount / executionSample : null,
      controlEffectivenessPassRate: assessedCount > 0 ? effectiveCount / assessedCount : null,
      overdueControlActions,
    };
  }

  // -- ACT-240 ----------------------------------------------------------

  /** GET /dashboard/risk-owner?user_id=me — always the caller's own risks (RiskRepository.list's ownerId filter); there is no path here to view another user's owner dashboard. */
  async getRiskOwnerView(actor: AuthenticatedUser): Promise<RiskOwnerDashboard> {
    requirePermission(actor, "dashboard.read");

    const ownedRisks = await this.risks.list(actor.tenantId, { ownerId: actor.userId });
    const withEvaluations = await Promise.all(
      ownedRisks.map(async (risk) => ({
        risk,
        evaluation: await this.getMostRecentAuthoritativeEvaluation(actor.tenantId, risk.id),
      })),
    );
    const riskSummaries = await Promise.all(
      withEvaluations.map(({ risk, evaluation }) => this.buildRiskSummary(actor.tenantId, risk, evaluation)),
    );

    const ownedRiskIds = new Set(ownedRisks.map((r) => r.id));
    const allKris = await this.kris.list(actor.tenantId);
    // Primary link only (Kri.riskId) — mirrors KriService.dashboard's own department resolution, which likewise only follows the primary link, not ACT-136's additional covered risks.
    const ownedKris = allKris.filter((k) => ownedRiskIds.has(k.riskId));
    const kriSummaries = await Promise.all(ownedKris.map((k) => this.toKriSummary(actor.tenantId, k)));

    const actions = await this.actionPlans.list(actor.tenantId, { responsibleUserId: actor.userId });
    const actionViews = actions.map(toActionPlanView);

    const alerts: RiskOwnerAlert[] = [];
    for (const { risk, evaluation } of withEvaluations) {
      if (evaluation?.appetiteExceeded) {
        alerts.push({
          type: "APPETITE_EXCEEDED",
          riskId: risk.id,
          message: `Risk "${risk.process}" exceeds its risk appetite threshold (residual score ${evaluation.residualScore})`,
        });
      }
    }
    for (const kriSummary of kriSummaries) {
      if (kriSummary.status === "ORANGE" || kriSummary.status === "ROUGE") {
        alerts.push({
          type: "KRI_THRESHOLD",
          kriId: kriSummary.kri.id,
          message: `KRI "${kriSummary.kri.label}" is ${kriSummary.status} (latest value ${kriSummary.latestValue})`,
        });
      }
    }

    return { ownerId: actor.userId, risks: riskSummaries, kris: kriSummaries, actions: actionViews, alerts };
  }

  // -- ACT-241 / ACT-213 -------------------------------------------------

  /**
   * GET /dashboard/department/:id and GET /reports/department/:id — same
   * query, exposed under both paths. Access gate: the department's
   * designated risk pilot (Department.riskOwner, matched case-
   * insensitively against actor.email) OR dashboard.executive as a
   * broader admin override.
   *
   * Judgment call flagged for Risk Manager/Architecture: Department.
   * riskOwner is free text (a name or an email — see Department.ts's own
   * doc comment), not a User foreign key like Risk.ownerId. Matching it
   * against actor.email is a heuristic that works when the field
   * actually holds an email, and silently fails closed (falls through to
   * requiring dashboard.executive) when it holds a display name instead.
   * A reliable version of this authorization check would need a real
   * `riskPilotUserId` FK on Department, mirroring Risk.ownerId — that's a
   * data-model change to an already-shipped module, not something to
   * decide unilaterally here.
   */
  async getDepartmentView(actor: AuthenticatedUser, departmentId: string): Promise<DepartmentDashboard> {
    requirePermission(actor, "dashboard.read");

    const department = await this.departments.getById(actor.tenantId, departmentId);
    if (!department) throw new NotFoundError("Department", departmentId);
    this.assertDepartmentAccess(actor, department);

    const [allRisks, allControls, kpis, actions] = await Promise.all([
      this.risks.list(actor.tenantId),
      this.controls.list(actor.tenantId),
      this.kpis.list(actor.tenantId, { departmentId }),
      this.actionPlans.list(actor.tenantId, { departmentIds: [departmentId] }),
    ]);

    const departmentRisks = allRisks.filter((r) => r.ownerDepartmentId === departmentId);
    const riskSummaries = await Promise.all(
      departmentRisks.map((risk) => this.toRiskSummaryOrNull(actor.tenantId, risk)),
    );

    const departmentControls = allControls.filter((c) => c.departmentId === departmentId);

    const departmentRiskIds = new Set(departmentRisks.map((r) => r.id));
    const allKris = await this.kris.list(actor.tenantId);
    const departmentKris = allKris.filter((k) => departmentRiskIds.has(k.riskId));
    const kriSummaries = await Promise.all(departmentKris.map((k) => this.toKriSummary(actor.tenantId, k)));

    const kpiSummaries = await Promise.all(kpis.map((kpi) => this.toKpiSummary(actor.tenantId, kpi)));
    const actionViews = actions.map(toActionPlanView);

    return {
      department,
      risks: riskSummaries,
      controls: departmentControls,
      kpis: kpiSummaries,
      kris: kriSummaries,
      actions: actionViews,
    };
  }

  // -- ACT-242 -----------------------------------------------------------

  /** GET /dashboard/executive — cross-entity consolidated view, gated behind dashboard.executive, scoped per DashboardScopeResolver. */
  async getExecutiveView(actor: AuthenticatedUser, options?: { topN?: number }): Promise<ExecutiveDashboard> {
    requirePermission(actor, "dashboard.executive");
    const topN = options?.topN ?? 10;
    const scope = await this.resolveScope(actor);
    const scopeSummary = this.scopeSummary(scope);

    if (this.scopeIsEmpty(scope)) {
      return { totalActiveRisks: 0, topRisks: [], criticalKris: [], overdueActions: [], openAnomaliesCount: 0, scope: scopeSummary };
    }

    const riskListOptions = this.riskListOptionsForScope(scope);
    const [allRisks, scored, kriSummaries, overdueActions, allAnomalies, scopedRiskIds] = await Promise.all([
      this.risks.list(actor.tenantId, riskListOptions),
      this.getScoredRisks(actor.tenantId, riskListOptions),
      this.getAllKriSummaries(actor.tenantId),
      this.getOverdueActionViewsScoped(actor.tenantId, scope),
      this.anomalies.list(actor.tenantId),
      this.getScopedRiskIds(actor.tenantId, scope),
    ]);

    const topRisks = await Promise.all(
      [...scored]
        .sort((a, b) => b.score - a.score)
        .slice(0, topN)
        .map((s) => this.buildRiskSummary(actor.tenantId, s.risk, s.evaluation)),
    );
    const criticalKris = kriSummaries.filter((k) => k.status === "ORANGE" || k.status === "ROUGE");
    const openAnomaliesCount = this.countOpenAnomalies(allAnomalies, scope, scopedRiskIds);

    return {
      totalActiveRisks: allRisks.filter((r) => r.status !== "ARCHIVED").length,
      topRisks,
      criticalKris,
      overdueActions,
      openAnomaliesCount,
      scope: scopeSummary,
    };
  }

  // -- ACT-211 -------------------------------------------------------------

  /** GET /reports/risk-committee — board-pack view: top-N risks, KRIs in Orange/Rouge, overdue actions. Reuses the same helpers as getExecutiveView rather than re-querying. */
  async getRiskCommitteeReport(actor: AuthenticatedUser, options?: { topN?: number }): Promise<RiskCommitteeReport> {
    requirePermission(actor, "dashboard.executive");
    const topN = options?.topN ?? 10;
    const scope = await this.resolveScope(actor);
    const scopeSummary = this.scopeSummary(scope);

    if (this.scopeIsEmpty(scope)) {
      return { topRisks: [], krisInAlert: [], overdueActions: [], scope: scopeSummary };
    }

    const riskListOptions = this.riskListOptionsForScope(scope);
    const [scored, kriSummaries, overdueActions] = await Promise.all([
      this.getScoredRisks(actor.tenantId, riskListOptions),
      this.getAllKriSummaries(actor.tenantId),
      this.getOverdueActionViewsScoped(actor.tenantId, scope),
    ]);

    const topRisks = await Promise.all(
      [...scored]
        .sort((a, b) => b.score - a.score)
        .slice(0, topN)
        .map((s) => this.buildRiskSummary(actor.tenantId, s.risk, s.evaluation)),
    );
    const krisInAlert = kriSummaries.filter((k) => k.status === "ORANGE" || k.status === "ROUGE");

    return { topRisks, krisInAlert, overdueActions, scope: scopeSummary };
  }

  // -- ACT-212 ---------------------------------------------------------------

  /**
   * GET /reports/consolidated?entities=CI,SN,Finances — grouped by the
   * free-text `entity` scope already present on RiskEvaluation/Kri (the
   * same field CartographyService/RiskAppetiteService filter on), NOT by
   * Postgres `tenant_id`.
   *
   * Design ambiguity flagged for Architecture/Risk Manager: the backlog
   * text ("Multi-tenant view ; droits group-admin obligatoires",
   * mentioning "Djamo CI + SN + Finances") reads as if it wants
   * aggregation across separate tenants/deployments. This codebase is
   * single-tenant-per-deployment by design (CLAUDE.md: "tenant_id... even
   * though the product is currently single-tenant") and AuthenticatedUser
   * only ever carries one tenantId — there is no mechanism here to read
   * another tenant's data, and building one would cross the exact
   * isolation boundary CLAUDE.md treats as sacred. I've implemented
   * "entities" as filtering/grouping by the existing free-text
   * entity/subsidiary scope WITHIN one tenant instead, which is the only
   * multi-entity concept this codebase actually has today. If genuine
   * cross-tenant group reporting is required, that's a real architecture
   * decision (a group-level read replica/API, not a service-layer
   * workaround) and needs A05/A13 sign-off, not a unilateral call here.
   */
  async getConsolidatedReport(actor: AuthenticatedUser, entityFilter?: string[]): Promise<ConsolidatedReport> {
    requirePermission(actor, "dashboard.executive");
    const scope = await this.resolveScope(actor);
    const scopeSummary = this.scopeSummary(scope);

    if (this.scopeIsEmpty(scope)) {
      return { entities: [], scope: scopeSummary };
    }

    const riskListOptions = this.riskListOptionsForScope(scope);
    const [scored, kriSummaries] = await Promise.all([
      this.getScoredRisks(actor.tenantId, riskListOptions),
      this.getAllKriSummaries(actor.tenantId),
    ]);

    const entityKey = (v: string | null) => v ?? "UNSPECIFIED";
    const relevantEntities =
      entityFilter && entityFilter.length > 0
        ? entityFilter
        : [...new Set([...scored.map((s) => entityKey(s.evaluation.entity)), ...kriSummaries.map((k) => entityKey(k.kri.entity))])];

    const breakdown: ConsolidatedEntityBreakdown[] = await Promise.all(
      relevantEntities.map(async (entity) => {
        const entityScored = scored.filter((s) => entityKey(s.evaluation.entity) === entity);
        const entityKris = kriSummaries.filter((k) => entityKey(k.kri.entity) === entity);
        const topRisks = await Promise.all(
          [...entityScored]
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map((s) => this.buildRiskSummary(actor.tenantId, s.risk, s.evaluation)),
        );
        return {
          entity,
          riskCount: entityScored.length,
          topRisks,
          criticalKriCount: entityKris.filter((k) => k.status === "ORANGE" || k.status === "ROUGE").length,
        };
      }),
    );

    return { entities: breakdown.sort((a, b) => a.entity.localeCompare(b.entity)), scope: scopeSummary };
  }

  // -- ACT-214 -----------------------------------------------------------------

  /** GET /reports/appetite-vs-residual — per (subCategory, entity), max current residual score vs the active RiskAppetite threshold, exceedances highlighted. */
  /**
   * Return shape stays a bare array on purpose (pre-existing API
   * contract, unlike the 4 other dashboard.executive endpoints which
   * already returned an object) — see the class-level scope wiring note.
   * The underlying risk set IS scoped (empty perimeter -> `[]`), only
   * the `DashboardScopeSummary` metadata isn't surfaced here, since
   * doing so would mean breaking this one endpoint's response shape for
   * a purely informational addition.
   */
  async getAppetiteVsResidual(actor: AuthenticatedUser): Promise<AppetiteVsResidualRow[]> {
    requirePermission(actor, "dashboard.executive");
    const scope = await this.resolveScope(actor);
    if (this.scopeIsEmpty(scope)) return [];

    const riskListOptions = this.riskListOptionsForScope(scope);
    const [scored, appetites] = await Promise.all([
      this.getScoredRisks(actor.tenantId, riskListOptions),
      this.riskAppetites.list(actor.tenantId, { activeOnly: true }),
    ]);

    interface Group {
      subCategory: string;
      entity: string | null;
      scores: number[];
      riskIds: string[];
    }
    const groups = new Map<string, Group>();
    const keyOf = (subCategory: string, entity: string | null) => `${subCategory}::${entity ?? ""}`;

    for (const s of scored) {
      const key = keyOf(s.evaluation.subCategory, s.evaluation.entity);
      let group = groups.get(key);
      if (!group) {
        group = { subCategory: s.evaluation.subCategory, entity: s.evaluation.entity, scores: [], riskIds: [] };
        groups.set(key, group);
      }
      group.scores.push(s.score);
      group.riskIds.push(s.risk.id);
    }
    for (const appetite of appetites) {
      const key = keyOf(appetite.subCategory, appetite.entity);
      if (!groups.has(key)) {
        groups.set(key, { subCategory: appetite.subCategory, entity: appetite.entity, scores: [], riskIds: [] });
      }
    }

    const rows: AppetiteVsResidualRow[] = [];
    for (const group of groups.values()) {
      const appetite = appetites.find(
        (a) => a.subCategory === group.subCategory && (a.entity ?? null) === group.entity,
      );
      const threshold = appetite?.threshold ?? null;
      const maxResidualScore = group.scores.length > 0 ? Math.max(...group.scores) : null;
      const exceedanceCount = threshold !== null ? group.scores.filter((sc) => sc > threshold).length : 0;
      rows.push({
        subCategory: group.subCategory,
        entity: group.entity,
        threshold,
        maxResidualScore,
        exceedanceCount,
        exceeded: threshold !== null && maxResidualScore !== null && maxResidualScore > threshold,
        riskIds: group.riskIds,
      });
    }

    return rows.sort((a, b) => a.subCategory.localeCompare(b.subCategory));
  }

  // -- ACT-215 -------------------------------------------------------------------

  /** GET /reports/kri-consolidated — global KRI view, trend over N periods (default 6), active alerts. */
  /**
   * Security fix (CWE-863 HIGH, confirmed on PR #27 independent review):
   * this endpoint previously resolved and surfaced `scope` but never
   * applied it to `this.kris.list(...)`, so a dashboard.executive holder
   * scoped to DEPARTMENT/PROCESS received every KRI in the tenant
   * (formulas, measured values, riskId) through this one endpoint even
   * though the response's `scope` field implied a respected perimeter.
   * Now mirrors getExecutiveView/getRiskCommitteeReport/getConsolidatedReport:
   * GLOBAL -> unfiltered (unchanged behavior); DEPARTMENT/PROCESS -> the
   * KRI set is restricted to `Kri.riskId` values inside `getScopedRiskIds`,
   * via a real repository-level `riskIds` filter, never a post-fetch
   * in-memory one; empty perimeter -> `[]` directly, no repository call
   * (same "empty perimeter -> empty result" doctrine as the other scoped
   * endpoints). `Kri.riskId` is a mandatory non-null FK (ACT-130), so
   * there is no orphan-KRI case to special-case here — unlike orphan
   * anomalies (`riskId IS NULL`), which are excluded from scoped counts
   * elsewhere in this class for the same fail-closed reason.
   */
  async getKriConsolidated(actor: AuthenticatedUser, options?: { periods?: number }): Promise<KriConsolidatedReport> {
    requirePermission(actor, "dashboard.executive");
    const periods = options?.periods ?? 6;
    const scope = await this.resolveScope(actor);
    const scopeSummary = this.scopeSummary(scope);

    if (this.scopeIsEmpty(scope)) {
      return { kris: [], activeAlerts: [], scope: scopeSummary };
    }

    let kriListFilters: { riskIds?: string[] } | undefined;
    if (scope.mode !== "GLOBAL") {
      const scopedRiskIds = await this.getScopedRiskIds(actor.tenantId, scope);
      const riskIds = [...(scopedRiskIds ?? new Set<string>())];
      // A non-empty perimeter (scopeIsEmpty already returned above
      // otherwise) can still resolve to zero actual risks — e.g. the
      // configured departments currently own none. `kris.list`'s
      // `riskIds` filter, like RiskRepository.list's `ids`, treats an
      // empty array as "no constraint" (matches everything), which would
      // silently re-leak the whole tenant here. Short-circuit to an
      // empty result instead of ever calling the repository with an
      // ambiguous empty filter.
      if (riskIds.length === 0) {
        return { kris: [], activeAlerts: [], scope: scopeSummary };
      }
      kriListFilters = { riskIds };
    }

    const kris = await this.kris.list(actor.tenantId, kriListFilters);
    const rows = await Promise.all(
      kris.map(async (kri): Promise<KriConsolidatedRow> => {
        const summary = await this.toKriSummary(actor.tenantId, kri);
        const history = await this.kriMeasures.listForKri(actor.tenantId, kri.id, { page: 1, pageSize: periods });
        return { ...summary, trend: history.items.map((m) => ({ measureDate: m.measureDate, value: m.value })) };
      }),
    );

    const activeAlerts = rows.filter((r) => r.status === "ORANGE" || r.status === "ROUGE");
    return { kris: rows, activeAlerts, scope: scopeSummary };
  }

  // ---------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------

  private assertDepartmentAccess(actor: AuthenticatedUser, department: Department): void {
    const isPilot = department.riskOwner.trim().toLowerCase() === actor.email.trim().toLowerCase();
    if (isPilot) return;
    requirePermission(actor, "dashboard.executive");
  }

  /**
   * Most recent evaluation among the authoritative terminal statuses
   * (VALIDATED, VALIDE_COMITE), by `created_at DESC` — whichever of the
   * two is more recent wins, since neither status outranks the other
   * (2026-09-30 audit finding, ACT-253).
   */
  private async getMostRecentAuthoritativeEvaluation(tenantId: string, riskId: string): Promise<RiskEvaluation | null> {
    const results = await this.evaluations.listForRisk(tenantId, riskId, {
      status: [...AUTHORITATIVE_EVALUATION_STATUSES],
      limit: 1,
    });
    return results[0] ?? null;
  }

  /**
   * DIV-05 wiring: prefer the real FK (`Risk.processId` -> `Process.name`)
   * over the free-text `Risk.process` when it resolves — falls back
   * explicitly (never silently) to the free text when `processId` is
   * null, no `ProcessRepository` is wired, or the FK is stale (points at
   * a process that no longer exists/is soft-deleted). Same contract as
   * CartographyService.resolveProcessLabel; not shared code because these
   * two services don't otherwise depend on each other (ADR-003 — no
   * speculative shared abstraction for a two-line lookup).
   */
  private async resolveProcessLabel(
    tenantId: string,
    risk: Risk,
  ): Promise<{ process: string; resolvedVia: "processId" | "processText" }> {
    if (risk.processId && this.processes) {
      const process = await this.processes.getById(tenantId, risk.processId);
      if (process) return { process: process.name, resolvedVia: "processId" };
    }
    return { process: risk.process, resolvedVia: "processText" };
  }

  private async buildRiskSummary(
    tenantId: string,
    risk: Risk,
    evaluation: RiskEvaluation | null,
  ): Promise<DashboardRiskSummary> {
    const score = evaluation ? evaluation.residualScore ?? evaluation.inherentScore : null;
    const { process, resolvedVia } = await this.resolveProcessLabel(tenantId, risk);
    return {
      riskId: risk.id,
      process,
      processId: risk.processId,
      resolvedVia,
      description: risk.description,
      status: risk.status,
      ownerDepartmentId: risk.ownerDepartmentId,
      ownerId: risk.ownerId,
      score,
      // Safe: getMostRecentAuthoritativeEvaluation only ever returns an
      // evaluation whose status is in AUTHORITATIVE_EVALUATION_STATUSES.
      evaluationStatus: evaluation ? (evaluation.status as AuthoritativeEvaluationStatus) : null,
      criticality: score !== null ? deriveCriticality(score) : null,
      subCategory: evaluation?.subCategory ?? null,
      entity: evaluation?.entity ?? null,
      appetiteExceeded: evaluation?.appetiteExceeded ?? null,
    };
  }

  private async toRiskSummaryOrNull(tenantId: string, risk: Risk): Promise<DashboardRiskSummary> {
    const evaluation = await this.getMostRecentAuthoritativeEvaluation(tenantId, risk.id);
    return this.buildRiskSummary(tenantId, risk, evaluation);
  }

  /**
   * Only risks with an authoritative (VALIDATED/VALIDE_COMITE), scored
   * evaluation — used by every "top risks by score" ranking
   * (executive/committee/consolidated/appetite-vs-residual). `options`
   * accepts the same scope filters as RiskRepository.list — callers pass
   * `riskListOptionsForScope(scope)` to apply the dashboard.executive
   * perimeter as a real SQL filter, never a post-fetch one.
   */
  private async getScoredRisks(
    tenantId: string,
    options?: { includeArchived?: boolean; ownerDepartmentIds?: string[]; processIds?: string[]; ids?: string[] },
  ): Promise<ScoredRisk[]> {
    const risks = await this.risks.list(tenantId, options);
    const scored: ScoredRisk[] = [];
    for (const risk of risks) {
      const evaluation = await this.getMostRecentAuthoritativeEvaluation(tenantId, risk.id);
      if (!evaluation) continue;
      const score = evaluation.residualScore ?? evaluation.inherentScore;
      if (score === null) continue;
      scored.push({ risk, evaluation, score });
    }
    return scored;
  }

  private async toKriSummary(tenantId: string, kri: Kri): Promise<DashboardKriSummary> {
    const latest = await this.kriMeasures.getLatest(tenantId, kri.id);
    const status = computeKriStatus(kri, latest?.value ?? null);
    return { kri, status, latestValue: latest?.value ?? null, latestMeasureDate: latest?.measureDate ?? null };
  }

  private async getAllKriSummaries(tenantId: string): Promise<DashboardKriSummary[]> {
    const kris = await this.kris.list(tenantId);
    return Promise.all(kris.map((kri) => this.toKriSummary(tenantId, kri)));
  }

  private async toKpiSummary(tenantId: string, kpi: Kpi): Promise<DashboardKpiSummary> {
    const latest = await this.kpiMeasures.getLatest(tenantId, kpi.id);
    const { status, achievementRate } = computeKpiStatus(kpi.targetValue, latest?.value ?? null);
    return { kpi, status, achievementRate, latestValue: latest?.value ?? null };
  }

  private async getOverdueActionViews(tenantId: string, filters?: ActionPlanListFilters): Promise<ActionPlanView[]> {
    const rows = await this.actionPlans.list(tenantId, filters);
    return rows.map(toActionPlanView).filter((v) => v.computedStatus === "EN_RETARD");
  }

  private async filterControlsByEntity(tenantId: string, controls: Control[], entity: string): Promise<Control[]> {
    const departments = await this.departments.list(tenantId, { includeInactive: true });
    const entityByDepartmentId = new Map(departments.map((d) => [d.id, d.entity]));
    return controls.filter((c) => c.departmentId !== null && entityByDepartmentId.get(c.departmentId) === entity);
  }

  // -- dashboard.executive scope (@architect design, 2026-09-30) --------

  /** GLOBAL when no resolver is wired (degrade-never-throw, same posture as `processes`). */
  private async resolveScope(actor: AuthenticatedUser): Promise<RiskScope> {
    if (!this.scopeResolver) return { mode: "GLOBAL" };
    return this.scopeResolver.resolve(actor);
  }

  /** Rule 5 (PO): empty perimeter -> empty dashboard, never a fallback to GLOBAL. GLOBAL itself is never "empty". */
  private scopeIsEmpty(scope: RiskScope): boolean {
    if (scope.mode === "GLOBAL") return false;
    if (scope.mode === "DEPARTMENT") return scope.departmentIds.length === 0 && scope.processIds.length === 0;
    return scope.processIds.length === 0;
  }

  private scopeSummary(scope: RiskScope): DashboardScopeSummary {
    return { mode: scope.mode, departmentCount: scope.mode === "DEPARTMENT" ? scope.departmentIds.length : 0 };
  }

  /** Translates a RiskScope into RiskRepository.list's real SQL filter options — never applied as a post-fetch, in-memory filter. */
  private riskListOptionsForScope(
    scope: RiskScope,
    base: { includeArchived?: boolean } = {},
  ): { includeArchived?: boolean; ownerDepartmentIds?: string[]; processIds?: string[] } {
    if (scope.mode === "GLOBAL") return base;
    if (scope.mode === "DEPARTMENT") return { ...base, ownerDepartmentIds: scope.departmentIds, processIds: scope.processIds };
    return { ...base, processIds: scope.processIds };
  }

  /**
   * The full set of risk ids in scope (including archived — an archived
   * risk's still-open anomalies counted under the old GLOBAL behavior
   * too), used only for anomaly-membership checks. `null` for GLOBAL —
   * callers must treat `null` as "no filtering needed", not "empty".
   */
  private async getScopedRiskIds(tenantId: string, scope: RiskScope): Promise<Set<string> | null> {
    if (scope.mode === "GLOBAL") return null;
    if (this.scopeIsEmpty(scope)) return new Set();
    const risks = await this.risks.list(tenantId, this.riskListOptionsForScope(scope, { includeArchived: true }));
    return new Set(risks.map((r) => r.id));
  }

  /**
   * Rule 3 (PO): orphan anomalies (`riskId IS NULL`) are excluded from
   * any scoped count (fail-closed) — they only ever show up in GLOBAL
   * mode, same as before this feature.
   */
  private countOpenAnomalies(anomalies: Anomaly[], scope: RiskScope, scopedRiskIds: Set<string> | null): number {
    if (scope.mode === "GLOBAL") return anomalies.filter((a) => a.status !== "CLOSED").length;
    return anomalies.filter((a) => a.status !== "CLOSED" && a.riskId !== null && (scopedRiskIds?.has(a.riskId) ?? false))
      .length;
  }

  /**
   * ActionPlan has a `departmentId` dimension but no `processId` one —
   * DEPARTMENT-mode R/A widening maps onto it directly; DEPARTMENT-mode
   * C/I widening (process-only) and PROCESS mode itself have no
   * department to filter action plans by, so both yield `null` (no
   * action plans visible) rather than either an unfiltered list or a
   * fabricated department match.
   */
  private actionPlanFiltersForScope(
    scope: RiskScope,
    base: ActionPlanListFilters = {},
  ): ActionPlanListFilters | null {
    if (scope.mode === "GLOBAL") return base;
    if (scope.mode === "DEPARTMENT") {
      if (scope.departmentIds.length === 0) return null;
      return { ...base, departmentIds: scope.departmentIds };
    }
    return null;
  }

  private async getOverdueActionViewsScoped(
    tenantId: string,
    scope: RiskScope,
    filters?: ActionPlanListFilters,
  ): Promise<ActionPlanView[]> {
    const scopedFilters = this.actionPlanFiltersForScope(scope, filters);
    if (scopedFilters === null) return [];
    return this.getOverdueActionViews(tenantId, scopedFilters);
  }
}
