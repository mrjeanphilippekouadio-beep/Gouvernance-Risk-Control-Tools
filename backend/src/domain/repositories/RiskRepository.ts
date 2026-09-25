import type { CreateRiskInput, Risk, UpdateRiskInput } from "../entities/Risk.js";

/**
 * The domain talks only to this interface — never to `pg`, Neon, or any
 * SQL directly. Swapping the storage engine means writing a new
 * implementation of this interface, not touching services/api. See
 * ADR-001.
 */
export interface RiskRepository {
  getById(tenantId: string, id: string): Promise<Risk | null>;
  list(tenantId: string, options?: { includeArchived?: boolean }): Promise<Risk[]>;
  create(input: CreateRiskInput): Promise<Risk>;
  update(tenantId: string, id: string, input: UpdateRiskInput): Promise<Risk>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
}
