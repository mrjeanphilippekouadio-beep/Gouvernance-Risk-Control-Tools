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

ALTER TABLE rating_scales DROP CONSTRAINT rating_scales_probability_levels_check;
ALTER TABLE rating_scales ADD CONSTRAINT rating_scales_probability_levels_check
  CHECK (probability_levels BETWEEN 1 AND 6);
ALTER TABLE rating_scales DROP CONSTRAINT rating_scales_impact_levels_check;
ALTER TABLE rating_scales ADD CONSTRAINT rating_scales_impact_levels_check
  CHECK (impact_levels BETWEEN 1 AND 6);

ALTER TABLE risks DROP CONSTRAINT risks_probability_check;
ALTER TABLE risks ADD CONSTRAINT risks_probability_check CHECK (probability BETWEEN 1 AND 6);
ALTER TABLE risks DROP CONSTRAINT risks_impact_check;
ALTER TABLE risks ADD CONSTRAINT risks_impact_check CHECK (impact BETWEEN 1 AND 6);
ALTER TABLE risks DROP CONSTRAINT risks_residual_probability_check;
ALTER TABLE risks ADD CONSTRAINT risks_residual_probability_check CHECK (residual_probability BETWEEN 1 AND 6);
ALTER TABLE risks DROP CONSTRAINT risks_residual_impact_check;
ALTER TABLE risks ADD CONSTRAINT risks_residual_impact_check CHECK (residual_impact BETWEEN 1 AND 6);

-- Not touched (flagged to PO): score caps of 25 elsewhere (risk appetite threshold,
-- configs.committee_*_min_score, default criticality bands); see dev-backend memory.
