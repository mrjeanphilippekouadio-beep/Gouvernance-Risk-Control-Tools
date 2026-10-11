-- B-9 (F-13, R1.3): impact/probability scales of 3 to 6 levels.
--
-- Widen the CHECKs that cap levels/scores at 5 so that risks and scales
-- built on a 6-level scale can be stored. Widening only: every existing
-- row (1..5) still satisfies the new constraints, so no NOT VALID is
-- needed and nothing is rewritten.
--
-- The new business rules (size 3..6, probability size = impact size,
-- max 7 axes, one descriptor per level) are NOT DB constraints on
-- rating_scales: ACTIVE and ARCHIVED versions are immutable (R-01) and
-- legacy rows may hold 1..5 with unequal sizes (a CHECK would reject
-- them or force NOT VALID, which still blocks later updates such as
-- archiving). They are enforced in RatingScaleService.create /
-- updateImpactAxes, i.e. on new versions only.

-- Constraint names are NOT assumed (incident staging 2026-10-11: the first
-- version of this file did DROP CONSTRAINT risks_probability_check by name and
-- failed with "constraint ... does not exist"; root cause: those CHECKs live on
-- risk_assessments (003), not risks, which has no probability/impact columns). For each (table, column) we drop
-- every single-column CHECK on that column in the current schema (looked up in
-- pg_constraint: contype='c', conkey = {that column}; multi-column CHECKs and
-- NOT NULL are untouched), then add the canonical-named 1..6 constraint.
DO $$
DECLARE
  t record;
  c record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('rating_scales', 'probability_levels', 'rating_scales_probability_levels_check'),
      ('rating_scales', 'impact_levels',      'rating_scales_impact_levels_check'),
      ('risk_assessments', 'probability',        'risk_assessments_probability_check'),
      ('risk_assessments', 'impact',             'risk_assessments_impact_check'),
      ('risk_assessments', 'residual_probability', 'risk_assessments_residual_probability_check'),
      ('risk_assessments', 'residual_impact',    'risk_assessments_residual_impact_check')
    ) AS v(tbl, col, new_name)
  LOOP
    FOR c IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attname = t.col AND NOT a.attisdropped
      WHERE con.contype = 'c'
        AND con.conrelid = (quote_ident(current_schema()) || '.' || quote_ident(t.tbl))::regclass
        AND con.conkey = ARRAY[a.attnum]
    LOOP
      EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', current_schema(), t.tbl, c.conname);
    END LOOP;

    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (%I BETWEEN 1 AND 6)',
                   current_schema(), t.tbl, t.new_name, t.col);
  END LOOP;
END $$;

-- Not touched (flagged to PO): score caps of 25 elsewhere (risk appetite threshold,
-- configs.committee_*_min_score, default criticality bands); see dev-backend memory.
