import type { CreateRaciAssignmentInput, RaciAssignment, RaciEntityType, RaciRole } from "../entities/RaciAssignment.js";

export interface RaciAssignmentRepository {
  create(input: CreateRaciAssignmentInput): Promise<RaciAssignment>;
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
}
