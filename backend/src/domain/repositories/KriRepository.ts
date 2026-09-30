import type { CreateKriInput, Kri, UpdateKriInput } from "../entities/Kri.js";

export interface KriListFilters {
  includeInactive?: boolean;
  riskId?: string;
  entity?: string;
  /**
   * dashboard.executive scope fix (CWE-863, 2026-09-30): a real
   * `WHERE risk_id = ANY($n)` filter, symmetric to
   * RiskRepository.list's `ids` — used by DashboardService.getKriConsolidated
   * to restrict the KRI set to the actor's resolved RiskScope instead of
   * exposing every KRI in the tenant. Never a post-fetch, in-memory
   * filter. `Kri.riskId` is a mandatory, non-null FK (ACT-130), so this
   * excludes every KRI whose primary risk is out of scope with no
   * "orphan KRI" edge case to reason about.
   */
  riskIds?: string[];
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
