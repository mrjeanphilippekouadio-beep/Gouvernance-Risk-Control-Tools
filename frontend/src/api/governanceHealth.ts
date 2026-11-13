import { apiRequest } from "./client";

/** ALLOWED_BY_SETTING arrives with D6bis (q234 C): handled as a possible status, never computed here. */
export type PrincipleStatus = "NOT_RESPECTED" | "RESPECTED" | "NOT_EVALUABLE" | "ACCEPTED" | "ALLOWED_BY_SETTING";
export type OrganizationSize = "TPE" | "PME" | "GRANDE_ENTREPRISE";
export type RequirementLevel = "exige" | "recommande" | "informatif";

export interface PanelOffender {
  kind: string;
  id: string | null;
  label: string | null;
  count?: number;
  detail?: string;
}

export interface PanelPrinciple {
  id: string;
  title: string;
  severity: "elevee" | "moyenne" | "faible";
  status: PrincipleStatus;
  notEvaluableReason: string | null;
  covers: string | null;
  consequences: string;
  offenders: PanelOffender[];
  offendersTotal: number;
  indications: Record<OrganizationSize, { level: RequirementLevel; action: string }>;
  highlighted: OrganizationSize | null;
  requirementLevel: RequirementLevel | null;
  acceptance: { id: string; reason: string; expiresAt: string; regime: string | null; acceptedBy: string | null; confirmedBy: string | null } | null;
  acceptanceNote: string | null;
}

export interface PanelException {
  auditId: string;
  /** Exact timestamp for reviewers/auditors, a day (YYYY-MM-DD) otherwise. */
  at: string;
  rule: string;
  entityType: string;
  entityId: string;
  action: string;
  reason: string | null;
  reviewed: boolean;
  ageDays: number;
  overdue: boolean;
  userId: string | null;
  userLabel: string | null;
  mine: boolean;
}

export interface ProfileGap { id: string; questionId: string; declared: string | number; observed: number; message: string }

export interface GovernanceHealth {
  catalogVersion: string;
  computedAt: string;
  trackedSince: string;
  organizationSize: { value: OrganizationSize; ruleVersion: string; toConfirm: boolean; justification: string[] } | null;
  profileGaps: ProfileGap[];
  principles: PanelPrinciple[];
  exceptions: { total: number; unreviewed: number; reviewDelayDays: number | null; items: PanelException[] };
  /** q266 A: confirmations decided alone by the only Risk Manager (counts computed by the server). */
  soleRm: { total: number; unreviewed: number; overdue: number; withoutPriorReview: number; reviewDelayDays: number };
  retentionPurge: { lastRunAt: string | null; ageDays: number | null };
}

export const governanceHealthApi = {
  get: (token: string) => apiRequest<GovernanceHealth>("/api/v1/governance-health", { token }),
  /** D5: review or contest an action applied without a second validation. The reviewer is the authenticated user. */
  review: (token: string, auditId: string, outcome: "REVIEWED" | "CONTESTED", comment: string) =>
    apiRequest<unknown>(`/api/v1/governance-exceptions/${auditId}/reviews`, { method: "POST", body: { outcome, comment }, token }),
};
