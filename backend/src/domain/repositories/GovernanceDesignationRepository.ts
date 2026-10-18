import type { CreateDesignationInput, DesignationKind, GovernanceDesignation } from "../entities/GovernanceDesignation.js";

export interface GovernanceDesignationRepository {
  getById(tenantId: string, id: string): Promise<GovernanceDesignation | null>;
  /** The designation of this kind not yet ended (at most one: unique partial index). */
  getActive(tenantId: string, kind: DesignationKind): Promise<GovernanceDesignation | null>;
  list(tenantId: string, options?: { includeEnded?: boolean }): Promise<GovernanceDesignation[]>;
  /** A second active designation of the same kind -> ConflictError. */
  create(input: CreateDesignationInput): Promise<GovernanceDesignation>;
  /** Soft end. Null when it was not found, or already ended (conditional UPDATE). */
  end(tenantId: string, id: string, endedBy: string, endReason: string): Promise<GovernanceDesignation | null>;
}
