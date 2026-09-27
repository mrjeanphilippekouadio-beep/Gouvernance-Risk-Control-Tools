-- RiskOwnership (ACT-120 to ACT-125, ACT-127): individual risk-level
-- ownership on `risks`, distinct from Department.risk_owner (free-text,
-- see 011_departments_fields.sql and Department.ts's doc comment) —
-- owner_id/superior_owner_id here point at a real `users` row and are
-- only ever written through RiskService.assignOwner/assignSuperiorOwner
-- (never the generic update()), same pattern as
-- departments.risk_owner_designated_by/at.

ALTER TABLE risks
  ADD COLUMN owner_id           uuid REFERENCES users (id),
  ADD COLUMN superior_owner_id  uuid REFERENCES users (id);

CREATE INDEX risks_tenant_owner_idx ON risks (tenant_id, owner_id);

-- ACT-125: append-only escalation history, like control_effectiveness_
-- assessments / kpi_measures — a new row per escalation, no deleted_at,
-- no generic UPDATE (see RiskEscalation.ts / RiskEscalationRepository.ts
-- for why this exists as its own table rather than a Notifier-only
-- side effect: it makes "consulter l'historique" a real query).
CREATE TABLE risk_escalations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  risk_id             uuid NOT NULL REFERENCES risks (id),
  escalated_by        uuid NOT NULL REFERENCES users (id),
  -- Snapshot of who was notified at escalation time — not re-derived
  -- from risks.superior_owner_id, which may change afterwards.
  superior_owner_id   uuid NOT NULL REFERENCES users (id),
  reason              text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX risk_escalations_tenant_risk_idx ON risk_escalations (tenant_id, risk_id, created_at DESC);
