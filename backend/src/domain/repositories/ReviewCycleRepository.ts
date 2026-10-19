import type { CreateReviewCycleInput, ListReviewCyclesOptions, ReviewCycle } from "../entities/ReviewCycle.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";

export interface ReviewCycleRepository {
  /** DECISION-079: true when `close` inserts the events given by `audit` in the SAME transaction. Absent = the service records the audit after (test fakes). */
  readonly auditsInTransaction?: boolean;
  getById(tenantId: string, id: string): Promise<ReviewCycle | null>;
  list(tenantId: string, options?: ListReviewCyclesOptions): Promise<ReviewCycle[]>;
  create(input: CreateReviewCycleInput): Promise<ReviewCycle>;
  /** ACT-252 step 1 (maker): Risk Manager proposes closure. */
  proposeClosure(tenantId: string, id: string, proposedBy: string, comment: string | null): Promise<ReviewCycle>;
  /** ACT-252 step 2 (checker): Direction validates. Terminal. */
  close(tenantId: string, id: string, closedBy: string, comment: string | null, audit?: TransactionalAudit<ReviewCycle>): Promise<ReviewCycle>;
}
