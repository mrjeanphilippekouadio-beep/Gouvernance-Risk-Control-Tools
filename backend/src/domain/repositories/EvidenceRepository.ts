import type { CreateEvidenceInput, Evidence } from "../entities/Evidence.js";

export interface EvidenceRepository {
  /**
   * Scoped by tenantId in the WHERE clause, never trusted from the
   * caller otherwise — this is what makes cross-tenant document access
   * impossible even if a caller guesses another tenant's evidence id or
   * Drive file id (see security review note on GoogleDriveStorage).
   */
  getById(tenantId: string, id: string): Promise<Evidence | null>;
  listForControlExecution(tenantId: string, controlExecutionId: string): Promise<Evidence[]>;
  /** Oldest ACTIVE evidence of this tenant with this hash, if any. Optional so pre-EVD-1 fake repositories keep compiling; the Postgres repository implements it. */
  findBySha256?(tenantId: string, sha256: string): Promise<Evidence | null>;
  create(input: CreateEvidenceInput): Promise<Evidence>;
  markDeleted(tenantId: string, id: string): Promise<void>;
  /** Restore an evidence row after an audit failure before external storage is touched. */
  restoreActive(tenantId: string, id: string): Promise<void>;
}
