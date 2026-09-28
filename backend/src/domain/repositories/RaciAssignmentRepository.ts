import type { CreateRaciAssignmentInput, RaciAssignment, RaciEntityType } from "../entities/RaciAssignment.js";

export interface RaciAssignmentRepository {
  create(input: CreateRaciAssignmentInput): Promise<RaciAssignment>;
  getById(tenantId: string, id: string): Promise<RaciAssignment | null>;
  listForEntity(tenantId: string, entityType: RaciEntityType, entityId: string): Promise<RaciAssignment[]>;
  /** Soft-delete (deleted_at), never a physical DELETE — see CLAUDE.md. */
  remove(tenantId: string, id: string): Promise<RaciAssignment>;
}
