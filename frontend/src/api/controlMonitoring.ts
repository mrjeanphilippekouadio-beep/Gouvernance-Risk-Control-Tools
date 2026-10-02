import { apiRequest } from "./client";

export type ExecutionStatus = "DONE" | "NOT_DONE" | "NOT_APPLICABLE";
export interface ControlExecution {
  id: string;
  controlId: string;
  plannedDate: string | null;
  completedDate: string | null;
  executedBy: string;
  result: string | null;
  observedAnomalies: string | null;
  justificationIfNotDone: string | null;
  status: ExecutionStatus;
  validatedBy: string | null;
  validatedAt: string | null;
  createdAt: string;
}
export interface CreateExecutionInput {
  controlId: string;
  plannedDate?: string | null;
  completedDate?: string | null;
  result?: string | null;
  observedAnomalies?: string | null;
  justificationIfNotDone?: string | null;
  status: ExecutionStatus;
}
export const executionsApi = {
  list: (token: string, controlId: string) =>
    apiRequest<ControlExecution[]>(`/api/v1/executions?controlId=${encodeURIComponent(controlId)}`, { token }),
  create: (token: string, input: CreateExecutionInput) =>
    apiRequest<ControlExecution>("/api/v1/executions", { method: "POST", body: input, token }),
  validate: (token: string, id: string, comment: string) =>
    apiRequest<ControlExecution>(`/api/v1/executions/${encodeURIComponent(id)}/validate`, { method: "POST", body: { comment: comment || null }, token }),
};

export type EffectivenessRating = "EFFECTIVE" | "PARTIALLY_EFFECTIVE" | "INEFFECTIVE";
export type EffectivenessResult = EffectivenessRating | "INCONCLUSIVE";
export type AssessmentStatus = "COMPLETED" | "PROVISIONAL" | "VALIDATED";
export interface EffectivenessAssessment {
  id: string;
  controlId: string;
  evalDate: string;
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
  status: AssessmentStatus;
  validatedBy: string | null;
  validatedAt: string | null;
  createdAt: string;
}
export interface CreateAssessmentInput {
  controlId: string;
  evalType?: string | null;
  designAdequacy?: string | null;
  executionQuality?: string | null;
  operationalEffectiveness: EffectivenessRating;
  result?: EffectivenessResult | null;
  limitations?: string | null;
  compensatingControls?: string | null;
  conclusion?: string | null;
  justification: string;
  status?: AssessmentStatus;
}
export const effectivenessApi = {
  list: (token: string, controlId: string) =>
    apiRequest<EffectivenessAssessment[]>(`/api/v1/effectiveness?controlId=${encodeURIComponent(controlId)}`, { token }),
  create: (token: string, input: CreateAssessmentInput) =>
    apiRequest<EffectivenessAssessment>("/api/v1/effectiveness", { method: "POST", body: input, token }),
  validate: (token: string, id: string, comment: string) =>
    apiRequest<EffectivenessAssessment>(`/api/v1/effectiveness/${encodeURIComponent(id)}/validate`, { method: "POST", body: { comment: comment || null }, token }),
};
