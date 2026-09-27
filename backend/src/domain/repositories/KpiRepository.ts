import type { CreateKpiInput, Kpi, UpdateKpiInput } from "../entities/Kpi.js";

export interface KpiListFilters {
  includeInactive?: boolean;
  departmentId?: string;
  processId?: string;
}

export interface KpiRepository {
  getById(tenantId: string, id: string): Promise<Kpi | null>;
  list(tenantId: string, filters?: KpiListFilters): Promise<Kpi[]>;
  create(input: CreateKpiInput): Promise<Kpi>;
  update(tenantId: string, id: string, input: UpdateKpiInput): Promise<Kpi>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
}
