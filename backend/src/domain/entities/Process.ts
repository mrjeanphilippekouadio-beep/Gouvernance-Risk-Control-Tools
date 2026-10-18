import type { EvaluationMode } from "./Config.js";

export type ProcessLevel = "PROCESS" | "SUBPROCESS" | "ACTIVITY";
export type ProcessDocumentType =
  | "CHARTER"
  | "POLICY"
  | "PROCEDURES_MANUAL"
  | "PROCEDURE"
  | "WORK_INSTRUCTION";

/**
 * Self-referencing hierarchy capped at 3 levels (Processus > Sous-processus
 * > Activité), updated in place — see apps-script-legacy/07_Processus.gs.
 */
export interface Process {
  id: string;
  tenantId: string;
  parentId: string | null;
  level: ProcessLevel;
  name: string;
  description: string | null;
  documentType: ProcessDocumentType | null;
  documentReference: string | null;
  owner: string | null;
  active: boolean;
  /**
   * DIV-06: null means "inherit" — see `resolveInheritedEvaluationMode`
   * below. Never dénormalisé onto a descendant process; resolved at read
   * time only.
   */
  evaluationMode: EvaluationMode | null;
  /** B-8: every Process belongs to a department (nullable only until existing data is backfilled). */
  departmentId: string | null;
  /**
   * D2b (DECISION-074/075): real accounts, single-valued per process. `owner` (free text) stays as the
   * legacy label, never overwritten. Written only through ProcessService.setResponsibilities.
   */
  ownerUserId: string | null;
  riskChampionUserId: string | null;
  deputyUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deletionReason: string | null;
}

export interface CreateProcessInput {
  tenantId: string;
  parentId?: string | null;
  level: ProcessLevel;
  name: string;
  description?: string | null;
  documentType?: ProcessDocumentType | null;
  documentReference?: string | null;
  owner?: string | null;
  active?: boolean;
  evaluationMode?: EvaluationMode | null;
  departmentId?: string | null;
}

export interface UpdateProcessInput {
  parentId?: string | null;
  level?: ProcessLevel;
  name?: string;
  description?: string | null;
  documentType?: ProcessDocumentType | null;
  documentReference?: string | null;
  owner?: string | null;
  active?: boolean;
  evaluationMode?: EvaluationMode | null;
  departmentId?: string | null;
}

/** D2b: keys left undefined are untouched, null clears. */
export interface ProcessResponsibilitiesInput {
  ownerUserId?: string | null;
  riskChampionUserId?: string | null;
  deputyUserId?: string | null;
}

/** Rank order used to validate parent/child level matching — 1-indexed, matches NIVEAUX_PROCESSUS in the legacy code. */
export const PROCESS_LEVEL_RANK: Record<ProcessLevel, number> = {
  PROCESS: 1,
  SUBPROCESS: 2,
  ACTIVITY: 3,
};

export const PROCESS_LEVEL_BY_RANK: ProcessLevel[] = ["PROCESS", "SUBPROCESS", "ACTIVITY"];

/**
 * DIV-06: pure resolution rule, no I/O — mirrors computeKriStatus/
 * computeActionPlanStatus (kept next to the entity, trivially unit
 * testable). `chain` is the process itself followed by its ancestors,
 * closest first (self, parent, grandparent — at most
 * `PROCESS_LEVEL_BY_RANK.length` entries, since the hierarchy is capped
 * at 3 levels); fetching that chain is the caller's job (ProcessService),
 * this function only picks the first non-null `evaluationMode` in it,
 * falling back to the tenant's `Config.evaluationMode` when every level
 * in the chain is null (inherited all the way up).
 */
export function resolveInheritedEvaluationMode(
  chain: readonly Pick<Process, "evaluationMode">[],
  configEvaluationMode: EvaluationMode,
): EvaluationMode {
  for (const process of chain) {
    if (process.evaluationMode) return process.evaluationMode;
  }
  return configEvaluationMode;
}
