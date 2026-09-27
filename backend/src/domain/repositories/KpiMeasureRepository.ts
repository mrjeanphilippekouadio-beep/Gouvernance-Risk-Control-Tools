import type { CreateKpiMeasureInput, KpiMeasure } from "../entities/KpiMeasure.js";

export interface KpiMeasureRepository {
  getById(tenantId: string, id: string): Promise<KpiMeasure | null>;
  /** Most recent first (period desc, then createdAt desc). */
  listForKpi(tenantId: string, kpiId: string): Promise<KpiMeasure[]>;
  /** The single most recent measure for a KPI — used by KpiService to compute status (ACT-142). */
  getLatest(tenantId: string, kpiId: string): Promise<KpiMeasure | null>;
  /** The only mutation this repository ever exposes: append-only, no update/delete (ACT-141). */
  create(input: CreateKpiMeasureInput): Promise<KpiMeasure>;
}
