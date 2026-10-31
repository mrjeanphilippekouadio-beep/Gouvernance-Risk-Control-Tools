import type { CreateKriInput, Kri, UpdateKriInput } from "../entities/Kri.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";

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
  /** DECISION-079: when true, the writes below insert `audit` events in their own transaction. */
  readonly auditsInTransaction?: boolean;
  getById(tenantId: string, id: string): Promise<Kri | null>;
  /** Batched existence check — mirrors RiskRepository.listByIds, used by dashboard to resolve department via linked risks. */
  list(tenantId: string, filters?: KriListFilters): Promise<Kri[]>;
  create(input: CreateKriInput, audit?: TransactionalAudit<Kri>): Promise<Kri>;
  update(tenantId: string, id: string, input: UpdateKriInput, audit?: TransactionalAudit<Kri>): Promise<Kri>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string, audit?: TransactionalAudit<void>): Promise<void>;
  /** ACT-136: additional risks covered by this KRI, beyond the mandatory primary `riskId`. */
  listCoveredRiskIds(tenantId: string, kriId: string): Promise<string[]>;
  /**
   * Pure link-table exception (see control_risks in CLAUDE.md): rebuilt by DELETE + INSERT, tenant-scoped.
   * The Postgres implementation locks the (still active) KRI, reads the previous set in the same transaction and
   * returns it (F7S6-01); an in-memory fake may return nothing.
   */
  replaceCoveredRisks(tenantId: string, kriId: string, riskIds: string[], audit?: TransactionalAudit<string[]>): Promise<string[] | void>;
}
