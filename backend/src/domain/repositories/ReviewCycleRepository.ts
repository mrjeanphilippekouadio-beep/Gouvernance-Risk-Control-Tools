import type { CreateReviewCycleInput, ListReviewCyclesOptions, ReviewCycle } from "../entities/ReviewCycle.js";

export interface ReviewCycleRepository {
  getById(tenantId: string, id: string): Promise<ReviewCycle | null>;
  list(tenantId: string, options?: ListReviewCyclesOptions): Promise<ReviewCycle[]>;
  create(input: CreateReviewCycleInput): Promise<ReviewCycle>;
  /** ACT-252 step 1 (maker): Risk Manager proposes closure. */
  proposeClosure(tenantId: string, id: string, proposedBy: string, comment: string | null): Promise<ReviewCycle>;
  /** ACT-252 step 2 (checker): Direction validates. Terminal. */
  close(tenantId: string, id: string, closedBy: string, comment: string | null): Promise<ReviewCycle>;
}
