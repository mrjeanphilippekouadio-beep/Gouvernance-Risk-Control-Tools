/** DECISION-074/075 (lot D2c): a person named to a governance function. Ended (soft), never deleted. */
export type DesignationKind = "MANAGER" | "RISK_MANAGER_INTERIM";

export const DESIGNATION_KINDS: DesignationKind[] = ["MANAGER", "RISK_MANAGER_INTERIM"];

export interface GovernanceDesignation {
  id: string;
  tenantId: string;
  kind: DesignationKind;
  userId: string;
  reason: string;
  /** Planned end of the interim. Mandatory for RISK_MANAGER_INTERIM. Never triggers an automatic removal. */
  validUntil: Date | null;
  /** Set when the interim actually received the Risk Manager role (handOverLastRiskManager). */
  activatedAt: Date | null;
  activatedRef: string | null;
  designatedBy: string;
  createdAt: Date;
  endedAt: Date | null;
  endedBy: string | null;
  endReason: string | null;
}

/** designatedBy is never client-supplied: the service forces it to actor.userId. */
export interface CreateDesignationInput {
  tenantId: string;
  kind: DesignationKind;
  userId: string;
  reason: string;
  validUntil: Date | null;
  designatedBy: string;
}
