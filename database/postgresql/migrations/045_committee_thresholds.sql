-- RISK_MANAGEMENT_V1_FINAL_DECISIONS.md §8 (Lot A) — the two Committee
-- score thresholds (Evaluation, Treatment Decision) are independent
-- decision references, never a single hardcoded business constant. This
-- migration adds tenant-wide storage for both, plus an obligation toggle
-- for the Evaluation one, on the existing one-row-per-tenant `configs`
-- table (see 024_config.sql).
--
-- Expand-only, no backfill needed — DEFAULT covers every existing row.
--
--   committee_evaluation_min_score: DEFAULT 15 reproduces the current
--     hardcoded COMMITTEE_VALIDATION_MIN_SCORE constant in
--     RiskEvaluationService.ts exactly — zero behavior change in value.
--   committee_treatment_min_score: DEFAULT NULL is intentional and
--     significant — NULL means "not configured yet", fail-closed (no
--     Treatment Decision can reach committee until a tenant explicitly
--     sets this). Never give this column a numeric default.
--   committee_evaluation_enforced: DEFAULT TRUE — the obligation to route
--     a residual score at/above the threshold through
--     validate-committee (rather than the plain validate() endpoint) is
--     ON by default, closing a real authorization gap (ACTION_ITEMS.md
--     "E-1"): before this column existed, nothing blocked
--     riskevaluation.validate from finalizing a Majeur/Critique score
--     without ever going through committee.
ALTER TABLE configs
  ADD COLUMN committee_evaluation_min_score integer NOT NULL DEFAULT 15
    CHECK (committee_evaluation_min_score BETWEEN 1 AND 25),
  ADD COLUMN committee_treatment_min_score integer NULL
    CHECK (committee_treatment_min_score IS NULL OR committee_treatment_min_score BETWEEN 1 AND 25),
  ADD COLUMN committee_evaluation_enforced boolean NOT NULL DEFAULT true;
