/**
 * Append-only, like ControlExecution: one row per recorded value, never
 * updated or deleted after creation (ACT-141). KpiService derives a
 * KPI's status by reading the most recent row here, ordered by period
 * then createdAt.
 */
export interface KpiMeasure {
  id: string;
  tenantId: string;
  kpiId: string;
  /** The period this value was measured for (e.g. the month/quarter reference date) — not when the row was inserted. */
  period: Date;
  value: number;
  comment: string | null;
  recordedBy: string;
  createdAt: Date;
}

export interface CreateKpiMeasureInput {
  tenantId: string;
  kpiId: string;
  period: Date;
  value: number;
  comment?: string | null;
  recordedBy: string;
}
