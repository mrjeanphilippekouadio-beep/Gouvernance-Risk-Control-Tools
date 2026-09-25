export type ExecutionStatus = "DONE" | "NOT_DONE" | "NOT_APPLICABLE";

/**
 * Append-only, like apps-script-legacy R04_EXECUTIONS_CONTROLES: one row
 * per occurrence of a control being run, never an update to the control
 * definition. The only mutation allowed after creation is validation
 * (validatedBy/validatedAt) — see ControlExecutionService.validate.
 */
export interface ControlExecution {
  id: string;
  tenantId: string;
  controlId: string;
  plannedDate: Date | null;
  completedDate: Date | null;
  executedBy: string;
  result: string | null;
  observedAnomalies: string | null;
  justificationIfNotDone: string | null;
  status: ExecutionStatus;
  validatedBy: string | null;
  validatedAt: Date | null;
  createdAt: Date;
}

export interface CreateControlExecutionInput {
  tenantId: string;
  controlId: string;
  plannedDate?: Date | null;
  completedDate?: Date | null;
  executedBy: string;
  result?: string | null;
  observedAnomalies?: string | null;
  justificationIfNotDone?: string | null;
  status: ExecutionStatus;
}
