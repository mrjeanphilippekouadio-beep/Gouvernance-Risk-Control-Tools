-- Lot 4 (Audit module), GRC_Target_Domain_Model.md §9.2. New domain, no
-- apps-script-legacy precedent. Ticket-lifecycle pattern (same shape as
-- anomalies/action_plans/audit_missions). `related_object_id` is
-- deliberately NOT a foreign key — polymorphic (related_object_type,
-- related_object_id), existence + tenant scoping enforced in
-- FindingService at write time (mirrors Anomaly's optional
-- controlId/riskId and ActionPlan's polymorphic source).
--
-- "suivi des recommandations" (audit recommendation follow-up) is
-- deliberately NOT a separate table here — `recommendation` is a plain
-- text column on this row, and its tracking is ActionPlan's job
-- (sourceType = 'FINDING', sourceId = findings.id, see
-- 041_action_plan_finding_source.sql). See Finding.ts's module comment
-- for the full reasoning.

CREATE TABLE findings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id),
  audit_mission_id     uuid NOT NULL REFERENCES audit_missions (id),
  title                text NOT NULL,
  description          text NOT NULL,
  severity             text NOT NULL
                         CHECK (severity IN ('LOW', 'MODERATE', 'HIGH', 'MAJOR', 'CRITICAL')),
  recommendation       text,
  related_object_type  text CHECK (related_object_type IN ('RISK', 'CONTROL', 'INCIDENT', 'ANOMALY')),
  related_object_id    uuid,
  status               text NOT NULL DEFAULT 'OUVERT'
                         CHECK (status IN ('OUVERT', 'EN_TRAITEMENT', 'CLOS')),
  raised_by            uuid NOT NULL REFERENCES users (id),
  closed_by            uuid REFERENCES users (id),
  closed_at            timestamptz,
  closure_comment      text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- related_object_type and related_object_id must be both-null or
  -- both-set — no dangling type without an id or vice versa.
  CONSTRAINT findings_related_object_pair_chk CHECK (
    (related_object_type IS NULL) = (related_object_id IS NULL)
  )
);

CREATE INDEX findings_tenant_mission_idx ON findings (tenant_id, audit_mission_id);
CREATE INDEX findings_tenant_status_idx ON findings (tenant_id, status);
CREATE INDEX findings_tenant_related_object_idx ON findings (tenant_id, related_object_type, related_object_id);
