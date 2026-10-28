import type { CreateKpiInput, Kpi, UpdateKpiInput } from "../entities/Kpi.js";
import type { ReadScope } from "../visibility.js";

export interface KpiListFilters {
  includeInactive?: boolean;
  departmentId?: string;
  processId?: string;
}

export interface KpiRepository {
  /** `scope` (DECISION-100): the reader's visibility; omitted for internal reads (no filter). */
  getById(tenantId: string, id: string, scope?: ReadScope): Promise<Kpi | null>;
  list(tenantId: string, filters?: KpiListFilters, scope?: ReadScope): Promise<Kpi[]>;
  create(input: CreateKpiInput): Promise<Kpi>;
  update(tenantId: string, id: string, input: UpdateKpiInput): Promise<Kpi>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
}
