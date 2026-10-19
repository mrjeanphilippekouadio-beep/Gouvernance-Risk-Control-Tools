import type { ControlExecution, CreateControlExecutionInput } from "../entities/ControlExecution.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";

export interface ControlExecutionRepository {
  /** DECISION-079: true when `recordValidation` inserts the events given by `audit` in the SAME transaction. Absent = the service records the audit after (test fakes). */
  readonly auditsInTransaction?: boolean;
  getById(tenantId: string, id: string): Promise<ControlExecution | null>;
  listForControl(tenantId: string, controlId: string): Promise<ControlExecution[]>;
  create(input: CreateControlExecutionInput): Promise<ControlExecution>;
  /** The only mutation ever applied to an execution row — see ControlExecutionService.validate. */
  recordValidation(
    tenantId: string,
    id: string,
    validatedBy: string,
    appendToResult: string | null,
    audit?: TransactionalAudit<ControlExecution>,
  ): Promise<ControlExecution>;
}
