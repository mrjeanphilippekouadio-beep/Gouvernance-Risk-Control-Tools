-- RBAC (ACT-093, ACT-110 to ACT-118). `roles` are named, admin-defined
-- permission bundles; `user_roles` is the grant/revoke history of who
-- holds which role. Grants are never deleted, only revoked (revoked_at)
-- -- the assignment history is itself audit-relevant.

CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  name         text NOT NULL,
  description  text,
  permissions  text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

-- A disabled/renamed role frees up its name for reuse, so the
-- uniqueness constraint only applies among active roles.
CREATE UNIQUE INDEX roles_active_name_idx ON roles (tenant_id, name) WHERE deleted_at IS NULL;

CREATE TABLE user_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  role_id     uuid NOT NULL REFERENCES roles (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  granted_by  uuid NOT NULL REFERENCES users (id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

-- One active grant per (user, role) at a time; re-granting after a
-- revoke inserts a new row rather than reviving the old one.
CREATE UNIQUE INDEX user_roles_active_idx ON user_roles (tenant_id, user_id, role_id) WHERE revoked_at IS NULL;
CREATE INDEX user_roles_user_active_idx ON user_roles (tenant_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX user_roles_role_active_idx ON user_roles (tenant_id, role_id) WHERE revoked_at IS NULL;

-- Filters needed for the audit journal search (ACT-071, ACT-230/231):
-- by actor, by action type, by time range — on top of the existing
-- (tenant_id, entity_type, entity_id, timestamp) index from 005.
CREATE INDEX audit_log_user_idx ON audit_log (tenant_id, user_id, "timestamp" DESC);
CREATE INDEX audit_log_action_idx ON audit_log (tenant_id, action, "timestamp" DESC);
