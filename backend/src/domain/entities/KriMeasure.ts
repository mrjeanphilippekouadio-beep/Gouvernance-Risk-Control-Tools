/**
 * Append-only, like KpiMeasure/ControlExecution: one row per recorded
 * value, never updated or deleted after creation (ACT-133). KriService
 * derives a KRI's status by reading the most recent row here, ordered by
 * measureDate then createdAt.
 */
export interface KriMeasure {
  id: string;
  tenantId: string;
  kriId: string;
  /** The date this value was measured for (ACT-133: "date_mesure"). */
  measureDate: Date;
  value: number;
  /** Where the value came from (ACT-133: "source") — e.g. a system name or "manuel". */
  source: string;
  comment: string | null;
  recordedBy: string;
  createdAt: Date;
}

export interface CreateKriMeasureInput {
  tenantId: string;
  kriId: string;
  measureDate: Date;
  value: number;
  source: string;
  comment?: string | null;
  recordedBy: string;
}
