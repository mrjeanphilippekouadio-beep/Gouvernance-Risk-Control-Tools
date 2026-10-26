import { apiRequest } from "./client";

export type OrganizationAnswers = Record<"Q1" | "Q2", number> & Record<"Q5" | "Q7" | "Q8" | "Q11", string>;
export type QuestionId = keyof OrganizationAnswers;

export type Question =
  | { id: "Q1" | "Q2"; label: string; type: "number"; min: number; max: number }
  | { id: "Q5" | "Q7" | "Q8" | "Q11"; label: string; type: "choice"; options: { value: string; label: string }[] };

export interface OrganizationProfile {
  id: string;
  version: number;
  questionnaireVersion: string;
  answers: OrganizationAnswers;
  reason: string;
  status: "PENDING" | "ACTIVE" | "SUPERSEDED" | "REJECTED";
  /** ALONE = size lowered with no third party to confirm it. */
  regime: "ALONE" | "CONFIRMED" | null;
  submittedBy: string;
  submittedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

export interface Classification {
  value: "TPE" | "PME" | "GRANDE_ENTREPRISE";
  ruleVersion: string;
  effectiveHeadcount: number;
  declaredHeadcount: number;
  observedAccounts: number;
  structureScore: number;
  criteria: { id: string; label: string; met: boolean; declared: boolean; observed: boolean }[];
  supervised: "YES" | "NO" | "UNKNOWN";
  toConfirm: boolean;
}

/** Everything is computed by the server (size, gaps): the screen displays it, never recomputes it. */
export interface OrganizationProfileView {
  questionnaire: { version: string; questions: Question[] };
  active: OrganizationProfile | null;
  pending: OrganizationProfile | null;
  history: OrganizationProfile[];
  observed: { activeAccounts: number; riskManagers: number; committeeMembers: number; auditMembers: number };
  classification: Classification | null;
  pendingClassification: Classification | null;
  profileGaps: { id: string; questionId: string; declared: string | number; observed: number; message: string }[];
}

export const organizationProfileApi = {
  get: (token: string) => apiRequest<OrganizationProfileView>("/api/v1/organization-profile", { token }),
  submit: (token: string, questionnaireVersion: string, answers: OrganizationAnswers, reason: string) =>
    apiRequest<OrganizationProfile>("/api/v1/organization-profile/submit", { method: "POST", body: { questionnaireVersion, answers, reason }, token }),
  approve: (token: string, id: string) =>
    apiRequest<OrganizationProfile>(`/api/v1/organization-profile/${id}/approve`, { method: "POST", token }),
  reject: (token: string, id: string, reason: string) =>
    apiRequest<OrganizationProfile>(`/api/v1/organization-profile/${id}/reject`, { method: "POST", body: { reason }, token }),
};
