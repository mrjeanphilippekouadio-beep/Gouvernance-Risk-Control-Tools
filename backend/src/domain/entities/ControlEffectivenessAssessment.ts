export type EffectivenessRating = "EFFECTIVE" | "PARTIALLY_EFFECTIVE" | "INEFFECTIVE";
export type EffectivenessResult = EffectivenessRating | "INCONCLUSIVE";
export type EffectivenessAssessmentStatus = "COMPLETED" | "PROVISIONAL" | "VALIDATED";

/**
 * Append-only, like ControlExecution — but answers a different question:
 * not "was the control performed?" (that's ControlExecution) but "is it
 * well-designed and actually effective at mitigating the risk?"
 * ("exécuté ne veut pas dire efficace" — apps-script-legacy/13_Efficacite.gs).
 */
export interface ControlEffectivenessAssessment {
  id: string;
  tenantId: string;
  controlId: string;
  evalDate: Date;
  evalType: string | null;
  evaluatedBy: string;
  designAdequacy: string | null;
  executionQuality: string | null;
  operationalEffectiveness: EffectivenessRating;
  result: EffectivenessResult | null;
  limitations: string | null;
  compensatingControls: string | null;
  conclusion: string | null;
  justification: string;
  controlVersionSnapshot: string | null;
  status: EffectivenessAssessmentStatus;
  validatedBy: string | null;
  validatedAt: Date | null;
  createdAt: Date;
}

export interface CreateEffectivenessAssessmentInput {
  tenantId: string;
  controlId: string;
  evalType?: string | null;
  evaluatedBy: string;
  designAdequacy?: string | null;
  executionQuality?: string | null;
  operationalEffectiveness: EffectivenessRating;
  result?: EffectivenessResult | null;
  limitations?: string | null;
  compensatingControls?: string | null;
  conclusion?: string | null;
  justification: string;
  controlVersionSnapshot?: string | null;
  status?: EffectivenessAssessmentStatus;
}
