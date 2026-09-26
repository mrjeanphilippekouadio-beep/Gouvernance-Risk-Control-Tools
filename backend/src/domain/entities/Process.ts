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
}

/** Rank order used to validate parent/child level matching — 1-indexed, matches NIVEAUX_PROCESSUS in the legacy code. */
export const PROCESS_LEVEL_RANK: Record<ProcessLevel, number> = {
  PROCESS: 1,
  SUBPROCESS: 2,
  ACTIVITY: 3,
};

export const PROCESS_LEVEL_BY_RANK: ProcessLevel[] = ["PROCESS", "SUBPROCESS", "ACTIVITY"];
