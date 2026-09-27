export type KpiFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL";

/**
 * New domain — no apps-script-legacy precedent (KPI tracking did not
 * exist in the Sheets-based tool). Updated in place, like
 * Department/Process (ACT-140/ACT-144). A KPI's status (Achieved / At
 * risk / Not achieved, ACT-142) is never stored here: KpiService derives
 * it at read time from the most recent KpiMeasure vs targetValue, so a
 * stale status can never be persisted.
 */
export interface Kpi {
  id: string;
  tenantId: string;
  label: string;
  targetValue: number;
  unit: string;
  frequency: KpiFrequency;
  owner: string;
  /** At least one of departmentId/processId must be set — enforced in KpiService and by a DB CHECK constraint (ACT-140/144). */
  departmentId: string | null;
  processId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deletionReason: string | null;
}

export interface CreateKpiInput {
  tenantId: string;
  label: string;
  targetValue: number;
  unit: string;
  frequency: KpiFrequency;
  owner: string;
  departmentId?: string | null;
  processId?: string | null;
  active?: boolean;
}

export interface UpdateKpiInput {
  label?: string;
  targetValue?: number;
  unit?: string;
  frequency?: KpiFrequency;
  owner?: string;
  departmentId?: string | null;
  processId?: string | null;
  active?: boolean;
}

export type KpiStatus = "ACHIEVED" | "AT_RISK" | "NOT_ACHIEVED" | "NO_MEASURE";

/**
 * % of target at/above which a KPI counts as "at risk" rather than
 * outright "not achieved" (ACT-142: "Statut selon % d'atteinte de la
 * cible"). The backlog doesn't specify exact thresholds — this is a
 * reasonable default kept in one place so it can be tuned or made
 * configurable later without touching call sites.
 */
export const KPI_AT_RISK_THRESHOLD = 0.8;

/**
 * Pure function, no I/O — kept next to the entity so it's trivially unit
 * testable and reusable by both KpiService.get (single) and
 * KpiService.list (dashboard, ACT-143).
 */
export function computeKpiStatus(
  targetValue: number,
  latestValue: number | null,
): { status: KpiStatus; achievementRate: number | null } {
  if (latestValue === null) return { status: "NO_MEASURE", achievementRate: null };

  if (targetValue === 0) {
    // Division by zero has no meaningful percentage — fall back to a
    // direct comparison instead of an achievement rate.
    return { status: latestValue >= targetValue ? "ACHIEVED" : "NOT_ACHIEVED", achievementRate: null };
  }

  const achievementRate = latestValue / targetValue;
  if (achievementRate >= 1) return { status: "ACHIEVED", achievementRate };
  if (achievementRate >= KPI_AT_RISK_THRESHOLD) return { status: "AT_RISK", achievementRate };
  return { status: "NOT_ACHIEVED", achievementRate };
}
