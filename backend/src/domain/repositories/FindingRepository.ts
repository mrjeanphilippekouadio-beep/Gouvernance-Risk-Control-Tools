import type { CreateFindingInput, Finding, FindingListFilters, FindingStatus } from "../entities/Finding.js";

export interface FindingRepository {
  getById(tenantId: string, id: string): Promise<Finding | null>;
  list(tenantId: string, filters?: FindingListFilters): Promise<Finding[]>;
  create(input: CreateFindingInput): Promise<Finding>;
  /** Narrow, non-terminal transition (OUVERT -> EN_TRAITEMENT). */
  updateStatus(tenantId: string, id: string, status: FindingStatus): Promise<Finding>;
  /** Terminal transition -> CLOS, sets closedBy/closedAt/closureComment. */
  close(tenantId: string, id: string, closedBy: string, comment: string): Promise<Finding>;
}
