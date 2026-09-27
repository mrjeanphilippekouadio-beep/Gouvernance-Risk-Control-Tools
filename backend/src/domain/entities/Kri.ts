export type KriFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL";

/**
 * New domain — no apps-script-legacy precedent (KRI tracking did not
 * exist in the Sheets-based tool). `kris` is updated in place, like
 * Kpi/Department/Process (ACT-131). A KRI's status (Vert/Orange/Rouge,
 * ACT-134) is never stored: KriService derives it at read time from the
 * most recent KriMeasure vs the three thresholds below, so a stale
 * status can never be persisted.
 *
 * `riskId` is the mandatory primary link required by ACT-130 ("lien
 * risque obligatoire") — exactly one risk this indicator is built to
 * monitor. ACT-136's "un KRI peut couvrir plusieurs risques" is modeled
 * as an *additional* set of risks in the `kri_risks` join table (see
 * KriRepository.listCoveredRiskIds/replaceCoveredRisks), mirroring the
 * control_risks link-table exception from CLAUDE.md — it is deliberately
 * separate from this mandatory primary link, not a replacement for it.
 *
 * `entity` is a free-text organizational scope (e.g. a legal
 * entity/subsidiary), mirroring RiskAppetite.entity — added so ACT-137's
 * dashboard can filter by it; not named in ACT-130's field list but
 * required to satisfy ACT-137 without inventing a new domain concept.
 */
export interface Kri {
  id: string;
  tenantId: string;
  label: string;
  /** Free text describing how the indicator is computed — never evaluated server-side. */
  formula: string;
  /** Thresholds must satisfy thresholdGreen < thresholdOrange < thresholdRed (ACT-130). */
  thresholdGreen: number;
  thresholdOrange: number;
  thresholdRed: number;
  frequency: KriFrequency;
  /** Mandatory primary risk link (ACT-130). */
  riskId: string;
  entity: string | null;
  /** ACT-131: "version méthodologique tracée" — free text, caller-supplied. */
  methodologyVersion: string | null;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deletionReason: string | null;
}

export interface CreateKriInput {
  tenantId: string;
  label: string;
  formula: string;
  thresholdGreen: number;
  thresholdOrange: number;
  thresholdRed: number;
  frequency: KriFrequency;
  riskId: string;
  entity?: string | null;
  methodologyVersion?: string | null;
  description?: string | null;
  active?: boolean;
}

export interface UpdateKriInput {
  label?: string;
  formula?: string;
  thresholdGreen?: number;
  thresholdOrange?: number;
  thresholdRed?: number;
  frequency?: KriFrequency;
  entity?: string | null;
  methodologyVersion?: string | null;
  description?: string | null;
  active?: boolean;
  // riskId is intentionally not updatable through the general update —
  // the mandatory primary link is fixed at creation; additional coverage
  // goes through KriService.addCoveredRisks (ACT-136).
}

export type KriStatus = "VERT" | "ORANGE" | "ROUGE" | "NO_MEASURE";

/**
 * Pure function, no I/O — kept next to the entity so it's trivially unit
 * testable and reusable by KriService.get/list/dashboard alike.
 *
 * Thresholds are read as increasing lower bounds of severity (ACT-130:
 * "seuils Vert < Orange < Rouge"): a value at or above thresholdRed is
 * ROUGE, at or above thresholdOrange (but below thresholdRed) is ORANGE,
 * otherwise VERT.
 */
export function computeKriStatus(
  kri: Pick<Kri, "thresholdGreen" | "thresholdOrange" | "thresholdRed">,
  latestValue: number | null,
): KriStatus {
  if (latestValue === null) return "NO_MEASURE";
  if (latestValue >= kri.thresholdRed) return "ROUGE";
  if (latestValue >= kri.thresholdOrange) return "ORANGE";
  return "VERT";
}
