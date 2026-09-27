-- RatingScale domain (ACT-170 to ACT-177): Djamo's risk rating
-- methodology, versioned. One row per methodology version, updated in
-- place (like departments/processes), with the sub-configurations
-- (criticality thresholds, impact axes, velocity, persistence, mastery
-- scale) stored as JSONB — see backend/src/domain/entities/RatingScale.ts
-- for the rationale (structured value lists configured together as one
-- methodology, not independent entities with their own lifecycle).
--
-- Only one ACTIVE rating scale per tenant at a time is enforced in
-- RatingScaleService.activateVersion (transactional: activate this row,
-- archive whatever was ACTIVE before), not as a DB constraint — a
-- partial unique index on (tenant_id) WHERE status = 'ACTIVE' would work
-- too, but the transition also needs to stamp archived_at on the
-- previous row, which a constraint alone can't do.

CREATE TABLE rating_scales (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenants (id),
  name                    text NOT NULL,
  version                 text NOT NULL,
  status                  text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),

  probability_levels      integer NOT NULL CHECK (probability_levels BETWEEN 1 AND 5),
  probability_labels      jsonb,
  impact_levels           integer NOT NULL CHECK (impact_levels BETWEEN 1 AND 5),
  impact_labels           jsonb,

  criticality_thresholds  jsonb,
  impact_axes             jsonb,
  velocity_levels         jsonb,
  persistence_levels      jsonb,
  mastery_scale           jsonb,

  activated_at            timestamptz,
  archived_at             timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  deleted_by              uuid REFERENCES users (id),
  deletion_reason         text
);

CREATE INDEX rating_scales_tenant_idx ON rating_scales (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX rating_scales_tenant_active_idx ON rating_scales (tenant_id, status) WHERE deleted_at IS NULL;
