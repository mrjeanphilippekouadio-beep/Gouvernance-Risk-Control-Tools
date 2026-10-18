import type { OrganizationProfile, OrganizationProfileRegime } from "../entities/OrganizationProfile.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";
import type { ObservedOrganization } from "../governance/classifyOrganization.js";
import type { OrganizationAnswers } from "../governance/organizationQuestionnaire.js";

export interface InsertOrganizationProfileInput {
  tenantId: string;
  questionnaireVersion: string;
  answers: OrganizationAnswers;
  reason: string;
  submittedBy: string;
  /** ACTIVE: replaces the active version (superseded in the same transaction). PENDING: waits for a second confirmation. */
  status: "ACTIVE" | "PENDING";
  /** ALONE only with status ACTIVE (size lowered with no third party). */
  regime: Extract<OrganizationProfileRegime, "ALONE"> | null;
}

/** The row written and, when it became ACTIVE, the version it replaced (now SUPERSEDED). */
export interface OrganizationProfileChange {
  profile: OrganizationProfile;
  superseded: OrganizationProfile | null;
}

export interface OrganizationProfileRepository {
  /** Most recent first, at most `limit` rows. */
  list(tenantId: string, limit: number): Promise<OrganizationProfile[]>;
  getActive(tenantId: string): Promise<OrganizationProfile | null>;
  getPending(tenantId: string): Promise<OrganizationProfile | null>;
  getById(tenantId: string, id: string): Promise<OrganizationProfile | null>;
  /** Accounts and group members the tool already sees (active users only; one count per person per group). */
  observe(tenantId: string): Promise<ObservedOrganization>;
  /**
   * Active people other than `excludeUserId` who belong to the Risk Manager, Committee or Audit group (the "third party"
   * whose existence requires a second confirmation to lower the size, q147).
   */
  countOtherGovernanceMembers(tenantId: string, excludeUserId: string): Promise<number>;
  /**
   * One transaction: next version number, supersede the active row when the new one is ACTIVE, INSERT, then the audit
   * events built from the stored row. A second PENDING or a concurrent version clash -> ConflictError.
   */
  insertVersion(
    input: InsertOrganizationProfileInput,
    audit: TransactionalAudit<OrganizationProfileChange>,
  ): Promise<OrganizationProfileChange>;
  /**
   * One transaction: PENDING -> ACTIVE conditional on status (0 row -> NotFoundError), the previous ACTIVE becomes SUPERSEDED
   * first, then the audit events. `decidedBy` <> `submittedBy` is also enforced by a CHECK.
   */
  approve(
    tenantId: string,
    id: string,
    decidedBy: string,
    audit: TransactionalAudit<OrganizationProfileChange>,
  ): Promise<OrganizationProfileChange>;
  /** PENDING -> REJECTED conditional on status (0 row -> NotFoundError), reason mandatory, audit in the same transaction. */
  reject(
    tenantId: string,
    id: string,
    decidedBy: string,
    reason: string,
    audit: TransactionalAudit<OrganizationProfile>,
  ): Promise<OrganizationProfile>;
}
