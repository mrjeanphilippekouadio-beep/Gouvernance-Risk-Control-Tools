-- Extends the minimal `departments` table from migration 002 with the
-- fields from apps-script-legacy R_DEPARTEMENTS (06_Departements.gs).
-- A migration already applied is never edited in place (ADR-001) — this
-- is an ALTER, not a rewrite of 002.

ALTER TABLE departments
  ADD COLUMN entity text,
  ADD COLUMN manager text,
  ADD COLUMN risk_owner text,
  ADD COLUMN risk_owner_designated_by text,
  ADD COLUMN risk_owner_designated_at timestamptz,
  ADD COLUMN linked_processes text,
  ADD COLUMN active boolean NOT NULL DEFAULT true,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN deleted_by uuid REFERENCES users (id),
  ADD COLUMN deletion_reason text;

-- 002 created departments before manager/risk_owner existed, so
-- existing rows (if any) have no manager. New rows must have one going
-- forward — enforced in DepartmentService, not as a NOT NULL here, to
-- avoid breaking a migration that could run against pre-existing data.
