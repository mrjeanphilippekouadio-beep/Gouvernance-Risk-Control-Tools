-- Lot 1 (RACI minimal), GRC_Migration_Plan.md Lot A / GRC_Target_Domain_Model.md
-- §2.2. Business responsibility (Responsible/Accountable/Consulted/
-- Informed) on a GRC object, kept strictly separate from IAM
-- (roles/permissions = "can do") per distinction 3 of the Domain Model.
--
-- Numbering: 026_governance.sql is the latest migration in this repo at
-- the time this file was authored — confirmed by listing the migrations
-- directory directly (no reserved range, per the anti-collision protocol
-- in GRC_Migration_Plan.md §1: reread the folder before writing, never
-- guess a number).
--
-- entity_id is deliberately NOT a foreign key: it is a polymorphic
-- reference across three tables (risks/controls/action_plans), which
-- can't be expressed as a single real FK. Existence + tenant scoping is
-- enforced by RaciAssignmentService before any write (same pattern as
-- ActionPlan.source_id, see 022_action_plans.sql). entity_type is
-- restricted to the 3 objects the Product Owner approved for this lot
-- via CHECK; widening it later (Incident, Kri, ...) is a non-destructive
-- CHECK change, never a DROP.
--
-- Soft-delete only (deleted_at), matching this codebase's convention
-- (CLAUDE.md "Security-sensitive conventions") — a revoked RACI
-- assignment is never physically deleted.

CREATE TABLE raci_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  entity_type  text NOT NULL CHECK (entity_type IN ('Risk', 'Control', 'ActionPlan')),
  entity_id    uuid NOT NULL,
  user_id      uuid NOT NULL REFERENCES users (id),
  role         text NOT NULL CHECK (role IN ('R', 'A', 'C', 'I')),
  created_by   uuid NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX raci_assignments_tenant_entity_idx ON raci_assignments (tenant_id, entity_type, entity_id);
