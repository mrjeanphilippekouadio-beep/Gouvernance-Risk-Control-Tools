import type { CreateDesignationInput, DesignationKind, GovernanceDesignation } from "../entities/GovernanceDesignation.js";

import type { TransactionalAudit } from "../entities/RiskFramework.js";

export interface GovernanceDesignationRepository {
  /** DECISION-079: true when `create`/`end` insert the events given by `audit` in the SAME transaction. Absent = the service records the audit after (test fakes). */
  readonly auditsInTransaction?: boolean;
  getById(tenantId: string, id: string): Promise<GovernanceDesignation | null>;
  /** The designation of this kind not yet ended (at most one: unique partial index). */
  getActive(tenantId: string, kind: DesignationKind): Promise<GovernanceDesignation | null>;
  list(tenantId: string, options?: { includeEnded?: boolean }): Promise<GovernanceDesignation[]>;
  /** A second active designation of the same kind -> ConflictError. */
  create(input: CreateDesignationInput, audit?: TransactionalAudit<GovernanceDesignation>): Promise<GovernanceDesignation>;
  /** Soft end. Null when it was not found, or already ended (conditional UPDATE; `audit` is then not called). */
  end(
    tenantId: string,
    id: string,
    endedBy: string,
    endReason: string,
    audit?: TransactionalAudit<GovernanceDesignation>,
  ): Promise<GovernanceDesignation | null>;
}
