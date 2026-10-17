import { apiRequest } from "./client";

/** Mirrors backend/src/domain/entities/RiskFramework.ts (dates are ISO strings). */
export type VersionStatus = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED";
export type ChangeApprover = "RISK_MANAGER" | "AUDIT" | "COMMITTEE" | "AUDIT_AND_COMMITTEE";
export type EvaluationMode = "CLASSIQUE" | "PARTICIPATIF";
export type MasterySource = "RISK_TEAM" | "FIRST_LINE";
export type VoteRule = "DEFAULT" | "A" | "B" | "C" | "CUSTOM";
export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export interface AppetiteEntry {
  subCategory: string;
  subCategoryId: string | null;
  entity: string | null;
  threshold: number;
  description: string | null;
}

export interface FrameworkParams {
  ratingScaleId: string;
  defaultEvaluationMode: EvaluationMode;
  committeeEvaluationMinScore: number;
  committeeEvaluationEnforced: boolean;
  committeeTreatmentMinScore: number | null;
  appetiteThresholds: AppetiteEntry[];
  changeApprover: ChangeApprover;
  selfProposalAllowed: boolean;
  lowCriticalityThreshold: number | null;
  riskOwnerExecutorCumulAllowed: boolean;
  delegateExecutorCumulAllowed: boolean;
  delegationMaxDays: number | null;
  hybridPolicyEnabled: boolean;
  masteryAuthoritativeSource: MasterySource;
  committeeVoteRule: VoteRule;
  committeeVoteCustom: Record<string, unknown> | null;
}

export interface FrameworkVersion extends FrameworkParams {
  id: string;
  frameworkId: string;
  versionNumber: number;
  status: VersionStatus;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  archiveReason: string | null;
  /** Returned by the server on every read of a version. */
  reducedMasteryIndependence: boolean;
}

export interface Framework {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  archiveReason: string | null;
}

export interface FrameworkSummary extends Framework {
  activeVersion: { id: string; versionNumber: number; activatedAt: string | null; ratingScaleId: string; reducedMasteryIndependence: boolean } | null;
}

export interface FrameworkDetail extends Framework {
  versions: FrameworkVersion[];
}

export interface ChangeRequest {
  id: string;
  kind: string;
  frameworkId: string;
  versionId: string | null;
  reason: string;
  status: RequestStatus;
  requestedBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
}

/** Scalar draft parameters sent on PATCH (appetiteThresholds and committeeVoteCustom are never sent from this screen). */
export type DraftPatch = Partial<Omit<FrameworkParams, "appetiteThresholds" | "committeeVoteCustom">>;

const base = "/api/v1/risk-frameworks";

export const riskFrameworksApi = {
  list: (token: string) => apiRequest<FrameworkSummary[]>(base, { token }),
  get: (token: string, id: string) => apiRequest<FrameworkDetail>(`${base}/${id}`, { token }),
  create: (token: string, body: { name: string; description?: string | null; ratingScaleId: string }) =>
    apiRequest<unknown>(base, { method: "POST", body, token }),
  updateIdentity: (token: string, id: string, body: { name?: string; description?: string | null; reason: string }) =>
    apiRequest<Framework>(`${base}/${id}`, { method: "PATCH", body, token }),
  createDraft: (token: string, id: string, fromVersionId?: string) =>
    apiRequest<FrameworkVersion>(`${base}/${id}/versions`, { method: "POST", body: fromVersionId ? { fromVersionId } : {}, token }),
  updateDraft: (token: string, id: string, versionId: string, body: DraftPatch) =>
    apiRequest<FrameworkVersion>(`${base}/${id}/versions/${versionId}`, { method: "PATCH", body, token }),
  discardDraft: (token: string, id: string, versionId: string, reason: string) =>
    apiRequest<FrameworkVersion>(`${base}/${id}/versions/${versionId}/discard`, { method: "POST", body: { reason }, token }),
  requestActivation: (token: string, id: string, versionId: string, reason: string) =>
    apiRequest<ChangeRequest>(`${base}/${id}/versions/${versionId}/activation-requests`, { method: "POST", body: { reason }, token }),
  listRequests: (token: string, status?: RequestStatus) =>
    apiRequest<ChangeRequest[]>(`${base}/change-requests${status ? `?status=${status}` : ""}`, { token }),
  approve: (token: string, rid: string, comment?: string) =>
    apiRequest<unknown>(`${base}/change-requests/${rid}/approve`, { method: "POST", body: comment ? { comment } : {}, token }),
  reject: (token: string, rid: string, comment: string) =>
    apiRequest<unknown>(`${base}/change-requests/${rid}/reject`, { method: "POST", body: { comment }, token }),
  withdraw: (token: string, rid: string, reason: string) =>
    apiRequest<unknown>(`${base}/change-requests/${rid}/withdraw`, { method: "POST", body: { reason }, token }),
};
