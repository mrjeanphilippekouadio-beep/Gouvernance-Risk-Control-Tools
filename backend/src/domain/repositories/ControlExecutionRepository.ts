import type { ControlExecution, CreateControlExecutionInput } from "../entities/ControlExecution.js";

export interface ControlExecutionRepository {
  getById(tenantId: string, id: string): Promise<ControlExecution | null>;
  listForControl(tenantId: string, controlId: string): Promise<ControlExecution[]>;
  create(input: CreateControlExecutionInput): Promise<ControlExecution>;
  /** The only mutation ever applied to an execution row — see ControlExecutionService.validate. */
  recordValidation(
    tenantId: string,
    id: string,
    validatedBy: string,
    appendToResult: string | null,
  ): Promise<ControlExecution>;
}
