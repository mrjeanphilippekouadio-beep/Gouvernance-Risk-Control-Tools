import type {
  ControlEffectivenessAssessment,
  CreateEffectivenessAssessmentInput,
} from "../entities/ControlEffectivenessAssessment.js";

export interface ControlEffectivenessRepository {
  getById(tenantId: string, id: string): Promise<ControlEffectivenessAssessment | null>;
  listForControl(tenantId: string, controlId: string): Promise<ControlEffectivenessAssessment[]>;
  create(input: CreateEffectivenessAssessmentInput): Promise<ControlEffectivenessAssessment>;
  /** The only mutation ever applied — see ControlEffectivenessService.validate. */
  recordValidation(
    tenantId: string,
    id: string,
    validatedBy: string,
    appendToJustification: string | null,
  ): Promise<ControlEffectivenessAssessment>;
}
