import type {
  ControlEffectivenessAssessment,
  CreateEffectivenessAssessmentInput,
} from "../entities/ControlEffectivenessAssessment.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";

export interface ControlEffectivenessRepository {
  /** DECISION-079: true when `recordValidation` inserts the events given by `audit` in the SAME transaction. Absent = the service records the audit after (test fakes). */
  readonly auditsInTransaction?: boolean;
  getById(tenantId: string, id: string): Promise<ControlEffectivenessAssessment | null>;
  listForControl(tenantId: string, controlId: string): Promise<ControlEffectivenessAssessment[]>;
  create(input: CreateEffectivenessAssessmentInput): Promise<ControlEffectivenessAssessment>;
  /** The only mutation ever applied — see ControlEffectivenessService.validate. */
  recordValidation(
    tenantId: string,
    id: string,
    validatedBy: string,
    appendToJustification: string | null,
    audit?: TransactionalAudit<ControlEffectivenessAssessment>,
  ): Promise<ControlEffectivenessAssessment>;
}
