import type { OrganizationAnswers } from "../governance/organizationQuestionnaire.js";

export type OrganizationProfileStatus = "PENDING" | "ACTIVE" | "SUPERSEDED" | "REJECTED";
/** ALONE = size lowered with no second validation (no third party existed); CONFIRMED = confirmed by someone else. */
export type OrganizationProfileRegime = "ALONE" | "CONFIRMED";

/**
 * DECISION-074 R-2: one VERSION of the organization's questionnaire answers. Append-only for its content
 * (answers, reason, author, date); only the decision columns and the status move, once, along
 * PENDING -> ACTIVE | REJECTED and ACTIVE -> SUPERSEDED. The size is never stored (recomputed on read).
 */
export interface OrganizationProfile {
  id: string;
  tenantId: string;
  version: number;
  questionnaireVersion: string;
  answers: OrganizationAnswers;
  reason: string;
  status: OrganizationProfileStatus;
  regime: OrganizationProfileRegime | null;
  submittedBy: string;
  submittedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
}
