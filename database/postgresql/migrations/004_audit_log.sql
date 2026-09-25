-- Present from V1, not limited to logins — ADR-001 §"Journal d'audit".
CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  "timestamp"  timestamptz NOT NULL DEFAULT now(),
  user_id      uuid NOT NULL REFERENCES users (id),
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  action       text NOT NULL CHECK (action IN (
                 'CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'VALIDATE', 'REJECT',
                 'APPROVE', 'CLOSE', 'REOPEN', 'ASSIGN', 'UNASSIGN',
                 'STATUS_CHANGE', 'ROLE_CHANGE', 'PERMISSION_CHANGE'
               )),
  old_value    jsonb,
  new_value    jsonb,
  reason       text,
  request_id   text NOT NULL
);

-- Audit trails are append-only: no UPDATE/DELETE grants at the
-- application role level (enforced in 005_security.sql).
