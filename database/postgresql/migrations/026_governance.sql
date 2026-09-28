-- Governance domain (ACT-250/251/252): review-cycle campaigns. Ticket
-- lifecycle pattern (same shape as action_plans/anomalies) — one row,
-- updated in place through narrow methods, never append-only.
--
-- Numbering note: see 025_notifications.sql for the same caveat — latest
-- migration at authoring time was 022_action_plans.sql, 025/026 assigned
-- per the task brief; renumber if the merged history differs.

CREATE TABLE review_cycles (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants (id),
  type                        text NOT NULL CHECK (type IN ('ANNUELLE', 'ANTICIPEE')),
  title                       text NOT NULL,
  scope                       text,
  -- Mandatory for ANTICIPEE (ACT-251: incident, changement majeur, résultat
  -- audit) — enforced in GovernanceService.create, not by NOT NULL here
  -- since the column is legitimately empty for ANNUELLE.
  reason                      text,
  status                      text NOT NULL DEFAULT 'OUVERT'
                                CHECK (status IN ('OUVERT', 'CLOTURE_PROPOSEE', 'CLOTUREE')),
  created_by                  uuid NOT NULL REFERENCES users (id),
  -- ACT-252 step 1 (maker): Risk Manager proposes closure.
  proposed_closure_by         uuid REFERENCES users (id),
  proposed_closure_at         timestamptz,
  proposed_closure_comment    text,
  -- ACT-252 step 2 (checker): Direction validates. Terminal — enforced in
  -- GovernanceService.close (proposed_closure_by != closed_by).
  closed_by                   uuid REFERENCES users (id),
  closed_at                   timestamptz,
  closure_comment             text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX review_cycles_tenant_status_idx ON review_cycles (tenant_id, status);
CREATE INDEX review_cycles_tenant_type_idx ON review_cycles (tenant_id, type);

-- ACT-253: additive change to the already-shipped risk_evaluations table
-- (019_risk_evaluations.sql) — a new terminal status reachable only for
-- Majeur (15-19)/Critique (20-25) residual scores, via a distinct
-- "Comité des Risques / Direction" maker-checker
-- (RiskEvaluationService.validateByCommittee, permission
-- riskevaluation.validate.committee). Existing 'BROUILLON'/'VALIDATED'/
-- 'REJECTED' values and the existing validate()/reject() methods are
-- untouched — this only widens the allowed set.
ALTER TABLE risk_evaluations DROP CONSTRAINT risk_evaluations_status_check;
ALTER TABLE risk_evaluations ADD CONSTRAINT risk_evaluations_status_check
  CHECK (status IN ('BROUILLON', 'VALIDATED', 'REJECTED', 'VALIDE_COMITE'));
