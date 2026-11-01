import type { CreateRaciAssignmentInput, RaciAssignment, RaciEntityType, RaciRole } from "../entities/RaciAssignment.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";

/** Codex P2 (PR #224): what `createChecked` measured, under the lock of the entity row. */
export type RaciCreateResult = { assignment: RaciAssignment; opened: boolean };

export interface RaciAssignmentRepository {
  /** QA-V2B-01: refuses (ConflictError) an assignment identical to an active one, even under concurrent requests. */
  create(input: CreateRaciAssignmentInput): Promise<RaciAssignment>;
  /**
   * Codex P2 (PR #224), q207: the assignment, the check "does it give the person read access to a restricted entity?"
   * and its audit rows in ONE transaction, the entity row locked (FOR SHARE) so that no visibility change can slip in
   * between. `requireReasonIfOpens`: refuse (ValidationError, nothing written) when it opens and no reason was given.
   * Optional: a fake without it goes through `create` + the service's own checks.
   */
  createChecked?(
    input: CreateRaciAssignmentInput,
    requireReasonIfOpens: boolean,
    audit: TransactionalAudit<RaciCreateResult>,
  ): Promise<RaciCreateResult>;
  getById(tenantId: string, id: string): Promise<RaciAssignment | null>;
  listForEntity(tenantId: string, entityType: RaciEntityType, entityId: string): Promise<RaciAssignment[]>;
  /**
   * DashboardScopeResolver (dashboard.executive scope, 2026-09-30): every
   * RACI row for one actor, across every entity — the opposite direction
   * from `listForEntity`. Backed by `raci_assignments_tenant_user_idx`
   * (migration 037), not a scan. `options.roles` filters in SQL (e.g.
   * only R/A, or only C/I) so the resolver never pulls the full set and
   * filters in memory.
   */
  listForUser(tenantId: string, userId: string, options?: { roles?: RaciRole[] }): Promise<RaciAssignment[]>;
  /** Soft-delete (deleted_at), never a physical DELETE — see CLAUDE.md. */
  remove(tenantId: string, id: string): Promise<RaciAssignment>;
  /** Restore an assignment when its audit write fails, compensating the preceding soft-delete. */
  restore(tenantId: string, id: string): Promise<RaciAssignment>;
}
