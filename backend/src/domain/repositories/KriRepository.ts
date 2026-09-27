import type { CreateKriInput, Kri, UpdateKriInput } from "../entities/Kri.js";

export interface KriListFilters {
  includeInactive?: boolean;
  riskId?: string;
  entity?: string;
}

export interface KriRepository {
  getById(tenantId: string, id: string): Promise<Kri | null>;
  /** Batched existence check — mirrors RiskRepository.listByIds, used by dashboard to resolve department via linked risks. */
  list(tenantId: string, filters?: KriListFilters): Promise<Kri[]>;
  create(input: CreateKriInput): Promise<Kri>;
  update(tenantId: string, id: string, input: UpdateKriInput): Promise<Kri>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
  /** ACT-136: additional risks covered by this KRI, beyond the mandatory primary `riskId`. */
  listCoveredRiskIds(tenantId: string, kriId: string): Promise<string[]>;
  /** Pure link-table exception (see control_risks in CLAUDE.md): rebuilt by DELETE + INSERT, tenant-scoped. */
  replaceCoveredRisks(tenantId: string, kriId: string, riskIds: string[]): Promise<void>;
}
