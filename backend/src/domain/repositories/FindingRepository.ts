import type { CreateFindingInput, Finding, FindingListFilters } from "../entities/Finding.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";

export interface FindingRepository {
  /** DECISION-079: true when `close` inserts the events given by `audit` in the SAME transaction. Absent = the service records the audit after (test fakes). */
  readonly auditsInTransaction?: boolean;
  getById(tenantId: string, id: string): Promise<Finding | null>;
  list(tenantId: string, filters?: FindingListFilters): Promise<Finding[]>;
  create(input: CreateFindingInput): Promise<Finding>;
  /** Narrow, non-terminal transition (OUVERT -> EN_TRAITEMENT). */
  updateStatus(tenantId: string, id: string, status: "EN_TRAITEMENT"): Promise<Finding>;
  /** Terminal transition -> CLOS, sets closedBy/closedAt/closureComment. */
  close(tenantId: string, id: string, closedBy: string, comment: string, audit?: TransactionalAudit<Finding>): Promise<Finding>;
}
