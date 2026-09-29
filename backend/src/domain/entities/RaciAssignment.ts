import type { GrcObjectType } from "../GrcObjectType.js";

/**
 * Lot 1 (RACI minimal, GRC_Migration_Plan.md §Lot A): business
 * responsibility on a GRC object — who is Responsible/Accountable/
 * Consulted/Informed — kept strictly separate from IAM (Role/Permission,
 * "can do") per distinction 3 of GRC_Target_Domain_Model.md §0.1. Scoped
 * to the 3 objects the Product Owner approved for this lot; `entityType`
 * is a closed TS union on purpose — widening it (Incident, Kri, ...) is
 * a deliberate later change to both this union and the DB CHECK, not an
 * open string.
 *
 * Derived from the canonical GrcObjectType (see GrcObjectType.ts) rather
 * than its own literal union — migration 028_raci_entity_type_snake_case.sql
 * renamed the previous PascalCase values ("Risk"/"Control"/"ActionPlan")
 * to match GrcObjectType's SNAKE_CASE upper convention.
 *
 * `entityId` is a polymorphic reference validated by the service against
 * the real Risk/Control/ActionPlan repositories before any write — same
 * "never trust entityId blindly" rule EvidenceService applies to file
 * ids (see CLAUDE.md). No DB foreign key is possible across three
 * target tables, so the DB migration whitelists `entity_type` via CHECK
 * and leaves existence checking to the service.
 */
export type RaciEntityType = Extract<GrcObjectType, "RISK" | "CONTROL" | "ACTION_PLAN">;

/** Runtime mirror of RaciEntityType, for the Zod enum / service whitelist. */
export const RACI_ENTITY_TYPES: readonly RaciEntityType[] = ["RISK", "CONTROL", "ACTION_PLAN"];

export type RaciRole = "R" | "A" | "C" | "I";

export interface RaciAssignment {
  id: string;
  tenantId: string;
  entityType: RaciEntityType;
  entityId: string;
  userId: string;
  role: RaciRole;
  /** SEC-001/SEC-009 pattern: forced server-side to actor.userId, never accepted from the client. */
  createdBy: string;
  createdAt: Date;
  /** Soft-delete only (CLAUDE.md convention) — revoke() sets this, never a physical DELETE. */
  deletedAt: Date | null;
}

export interface CreateRaciAssignmentInput {
  tenantId: string;
  entityType: RaciEntityType;
  entityId: string;
  userId: string;
  role: RaciRole;
  createdBy: string;
}
