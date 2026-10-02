-- Lot 4 (Audit module), GRC_Target_Domain_Model.md §9.1. New domain, no
-- apps-script-legacy precedent. Ticket-lifecycle pattern (same shape as
-- anomalies/action_plans): one row per mission, updated in place, never
-- append-only. `scope` is free text on purpose — see the entity file
-- comment (AuditMission.ts) for why this isn't a polymorphic
-- GrcObjectType reference.

CREATE TABLE audit_missions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id),
  reference            text NOT NULL,
  title                text NOT NULL,
  scope                text NOT NULL,
  status               text NOT NULL DEFAULT 'PLANIFIEE'
                         CHECK (status IN ('PLANIFIEE', 'EN_COURS', 'CLOTUREE')),
  lead_auditor_id      uuid NOT NULL REFERENCES users (id),
  -- Other auditors on the mission team, beyond the lead. Plain array, not
  -- a join table: no independent lifecycle or per-row metadata beyond
  -- "is on this mission" (same judgment call as users.roles, 002).
  auditor_ids          uuid[] NOT NULL DEFAULT '{}',
  planned_start_date   date NOT NULL,
  planned_end_date     date NOT NULL,
  -- Set only by AuditMissionService.start()/close() — never client-supplied.
  actual_start_date    date,
  actual_end_date      date,
  closure_comment      text,
  created_by           uuid NOT NULL REFERENCES users (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX audit_missions_tenant_reference_idx ON audit_missions (tenant_id, reference);
CREATE INDEX audit_missions_tenant_status_idx ON audit_missions (tenant_id, status);
CREATE INDEX audit_missions_tenant_lead_auditor_idx ON audit_missions (tenant_id, lead_auditor_id);
