-- tenant_id is present from V1 even though the product is mono-client
-- today (ADR-001 §"tenant_id dès le départ").

CREATE TABLE tenants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  deployment_mode   text NOT NULL DEFAULT 'managed_saas'
                      CHECK (deployment_mode IN ('managed_saas', 'customer_managed', 'on_premise')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  email         text NOT NULL,
  display_name  text NOT NULL,
  roles         text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (tenant_id, email)
);

-- Email lookup (login) must be fast and only ever resolve to one active user.
CREATE UNIQUE INDEX users_active_email_idx ON users (email) WHERE deleted_at IS NULL;
