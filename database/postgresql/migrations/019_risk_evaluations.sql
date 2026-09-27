-- RiskEvaluation domain (ACT-150 to ACT-160): periodic scoring of a
-- Risk. Append-only like control_effectiveness_assessments / kpi_measures
-- — a new row per occurrence, no deleted_at (nothing is ever removed),
-- no generic UPDATE. Unlike those two single-mutation tables, an
-- evaluation is progressively filled in by several narrow UPDATE
-- statements while status = 'BROUILLON' (inherent scoring, mastery
-- assessment, residual scoring), then finalized exactly once via
-- validate/reject — see backend/src/services/RiskEvaluationService.ts.
--
-- sub_category/entity are captured here rather than read off `risks`:
-- the Risk table (003_risks.sql) has no such columns yet. See the
-- design-decision note in backend/src/domain/entities/RiskEvaluation.ts
-- for why this mirrors apps-script-legacy's denormalized per-row
-- "fiche" snapshot instead of inventing new columns on `risks`.
--
-- rating_scale_id is nullable because a BROUILLON evaluation with no
-- inherent scoring yet has none — it is populated once, at
-- recordInherentScoring, and never changes afterwards (a snapshot of
-- which methodology version priced this evaluation).

CREATE TABLE risk_evaluations (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       uuid NOT NULL REFERENCES tenants (id),
  risk_id                         uuid NOT NULL REFERENCES risks (id),
  evaluation_type                 text NOT NULL CHECK (evaluation_type IN ('AD_HOC', 'ANNUELLE', 'ANTICIPEE')),
  status                          text NOT NULL DEFAULT 'BROUILLON' CHECK (status IN ('BROUILLON', 'VALIDATED', 'REJECTED')),
  evaluator_id                    uuid NOT NULL REFERENCES users (id),
  sub_category                    text NOT NULL,
  entity                          text,

  rating_scale_id                 uuid REFERENCES rating_scales (id),
  rating_scale_version            text,

  inherent_probability            integer,
  inherent_impacts                jsonb,
  inherent_impact_retained        integer,
  inherent_score                  integer,

  mastery_lines                   jsonb,
  mastery_global                  numeric,

  residual_probability            integer,
  residual_impacts                jsonb,
  residual_impact_retained        integer,
  residual_score                  integer,
  residual_justification          text,

  appetite_threshold_suggested    integer,
  appetite_threshold_override     integer,
  appetite_threshold_applied      integer,
  appetite_exceeded               boolean,

  validated_by                    uuid REFERENCES users (id),
  validated_at                    timestamptz,
  comment                         text,

  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX risk_evaluations_tenant_risk_idx ON risk_evaluations (tenant_id, risk_id, created_at DESC);
CREATE INDEX risk_evaluations_tenant_status_idx ON risk_evaluations (tenant_id, status);
