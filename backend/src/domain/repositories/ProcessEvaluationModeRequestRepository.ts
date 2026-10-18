import type { Process } from "../entities/Process.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";
import type {
  CreateProcessEvaluationModeRequestInput,
  ProcessEvaluationModeRequest,
} from "../entities/ProcessEvaluationModeRequest.js";

export interface ProcessEvaluationModeRequestRepository {
  /** F-SWP-01: true when `validateAndApply` exists and runs request transition + process update + audit in ONE transaction. */
  readonly auditsInTransaction?: boolean;
  getById(tenantId: string, id: string): Promise<ProcessEvaluationModeRequest | null>;
  list(
    tenantId: string,
    options?: { processId?: string; status?: ProcessEvaluationModeRequest["status"] },
  ): Promise<ProcessEvaluationModeRequest[]>;
  /**
   * Throws ValidationError (mapped from the partial unique index's
   * 23505) if a PENDING_VALIDATION request already exists for this
   * process — see 031_process_evaluation_mode_requests.sql.
   */
  create(input: CreateProcessEvaluationModeRequestInput): Promise<ProcessEvaluationModeRequest>;
  /** Terminal transition 1/2: PENDING_VALIDATION -> VALIDATED. Guarded server-side (WHERE status = 'PENDING_VALIDATION') against a double-validation race. */
  validate(tenantId: string, id: string, validatedBy: string): Promise<ProcessEvaluationModeRequest>;
  /** Terminal transition 2/2: PENDING_VALIDATION -> REJECTED. Same race guard as validate(). */
  reject(tenantId: string, id: string, validatedBy: string, reason: string): Promise<ProcessEvaluationModeRequest>;
  /**
   * F-SWP-01, one transaction, in this order: (1) PENDING_VALIDATION -> VALIDATED, conditional
   * (0 row = already decided -> NotFoundError, nothing else written); (2) processes.evaluation_mode
   * = the requested mode; (3) the events built by `audit`.
   */
  validateAndApply?(
    tenantId: string,
    id: string,
    validatedBy: string,
    audit: TransactionalAudit<{ request: ProcessEvaluationModeRequest; process: Process }>,
  ): Promise<{ request: ProcessEvaluationModeRequest; process: Process }>;
}
