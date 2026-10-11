-- B-9 bis (q49): score ceiling follows the matrix size n² (max 6x6 = 36).
--
-- Widen the CHECKs that cap a score at 25: risk_appetites.threshold (017) and
-- configs.committee_evaluation_min_score / committee_treatment_min_score (045).
-- Widening only: every existing row (<= 25) still satisfies the new constraints.
-- The exact ceiling n² of the ACTIVE scale is enforced by the services
-- (RiskAppetiteService, ConfigService, RiskEvaluationService); the database only
-- guards the absolute maximum (6 x 6 = 36).
--
-- Constraint names are NOT assumed (same approach as 050): every single-column CHECK
-- on the column is looked up in pg_constraint and dropped, then the canonical one is added.
DO $$
DECLARE
  t record;
  c record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('risk_appetites', 'threshold',                     'risk_appetites_threshold_check',                      'threshold BETWEEN 1 AND 36'),
      ('configs', 'committee_evaluation_min_score',       'configs_committee_evaluation_min_score_check',        'committee_evaluation_min_score BETWEEN 1 AND 36'),
      ('configs', 'committee_treatment_min_score',        'configs_committee_treatment_min_score_check',         'committee_treatment_min_score IS NULL OR committee_treatment_min_score BETWEEN 1 AND 36')
    ) AS v(tbl, col, new_name, expr)
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

    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (%s)',
                   current_schema(), t.tbl, t.new_name, t.expr);
  END LOOP;
END $$;
