import type { TransactionalAudit } from "../entities/RiskFramework.js";
import type { CreateProcessInput, Process, ProcessResponsibilitiesInput, UpdateProcessInput } from "../entities/Process.js";

export interface ProcessRepository {
  getById(tenantId: string, id: string): Promise<Process | null>;
  list(tenantId: string, options?: { includeInactive?: boolean }): Promise<Process[]>;
  create(input: CreateProcessInput): Promise<Process>;
  update(tenantId: string, id: string, input: UpdateProcessInput): Promise<Process>;
  /** DECISION-079: true when `setResponsibilities` inserts the events given by `audit` in the SAME transaction. */
  readonly auditsInTransaction?: boolean;
  /** D2b: the only write of the three responsibility columns (not part of the generic update). */
  setResponsibilities(tenantId: string, id: string, input: ProcessResponsibilitiesInput, audit?: TransactionalAudit<Process>): Promise<Process>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
}
