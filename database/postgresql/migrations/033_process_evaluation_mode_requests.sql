-- DECISION-006 (.claude/agent-context/ACTION_ITEMS.md, gouvernance,
-- 2026-09-29) — validation guard for the Classique/Participatif mode set
-- on a Process ("écran Processus"). Option A retained by the PO: a
-- dedicated permission (`evaluationmode.validate`) is the source of
-- validator authority, never `Risk.ownerId` (that field stays nullable,
-- multi-valued in practice, and mutable via the widely-held
-- `risk.update` — the same class of hazard as SEC-011/SEC-013/SEC-014).
--
-- Table is append-only in intent: a proposal is never edited in place
-- except its own terminal transition (PENDING_VALIDATION ->
-- VALIDATED/REJECTED, mirroring review_cycles' propose/close shape from
-- 026_governance.sql) — old rows are never reused or overwritten by a
-- later proposal, a new proposal is always a new row. The partial unique
-- index is what actually enforces "at most one open proposal per
-- process at a time".
--
-- Process.evaluation_mode (030_evaluation_mode.sql) is untouched by this
-- migration and stays exclusively the mode *in force* — never a pending
-- proposal.
--
-- Numbering: originally authored as 031, renumbered to 033 — a parallel
-- branch claimed 031 (031_controls_process_id.sql) and 032
-- (032_risk_appetites_sub_category_id.sql) first (anti-collision
-- protocol, GRC_Migration_Plan.md §1; re-checked by listing the
-- migrations directory immediately before commit).

CREATE TABLE process_evaluation_mode_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants (id),
  process_id        uuid NOT NULL REFERENCES processes (id),
  requested_mode    text NOT NULL CHECK (requested_mode IN ('CLASSIQUE', 'PARTICIPATIF')),
  status            text NOT NULL DEFAULT 'PENDING_VALIDATION'
                       CHECK (status IN ('PENDING_VALIDATION', 'VALIDATED', 'REJECTED')),
  requested_by      uuid NOT NULL REFERENCES users (id),
  requested_at      timestamptz NOT NULL DEFAULT now(),
  -- Set only on the terminal transition (validate/reject) — enforced in
  -- ProcessEvaluationModeRequestService, not here: the validator can
  -- never be requested_by (maker-checker, no exception even for a Risk
  -- Manager holding evaluationmode.validate).
  validated_by      uuid REFERENCES users (id),
  validated_at      timestamptz,
  rejection_reason  text
);

CREATE INDEX process_evaluation_mode_requests_tenant_process_idx
  ON process_evaluation_mode_requests (tenant_id, process_id);

-- Enforces "one PENDING_VALIDATION request per process at a time" —
-- the single source of truth for that rule; the service layer only
-- turns its violation into a clean ValidationError.
CREATE UNIQUE INDEX process_evaluation_mode_requests_pending_unique_idx
  ON process_evaluation_mode_requests (process_id)
  WHERE status = 'PENDING_VALIDATION';
