import type { Pool } from "pg";
import type { RolePermissionChangeRepository } from "../../../domain/repositories/RolePermissionChangeRepository.js";
import type { RolePermissionChange, RolePermissionChangeStatus } from "../../../domain/entities/Role.js";
import type { Permission } from "../../../domain/permissions.js";

interface Row {
  id: string;
  tenant_id: string;
  role_id: string;
  permissions: string[];
  requested_by: string;
  reason: string | null;
  status: RolePermissionChangeStatus;
  decided_by: string | null;
  created_at: Date;
  decided_at: Date | null;
}

function toDomain(row: Row): RolePermissionChange {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    roleId: row.role_id,
    permissions: row.permissions as Permission[],
    requestedBy: row.requested_by,
    reason: row.reason,
    status: row.status,
    decidedBy: row.decided_by,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export class PostgresRolePermissionChangeRepository implements RolePermissionChangeRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: { tenantId: string; roleId: string; permissions: Permission[]; requestedBy: string; reason?: string | null }): Promise<RolePermissionChange> {
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO role_permission_changes (tenant_id, role_id, permissions, requested_by, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.tenantId, input.roleId, input.permissions, input.requestedBy, input.reason ?? null],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into role_permission_changes returned no row");
    return toDomain(row);
  }

  async getById(tenantId: string, id: string): Promise<RolePermissionChange | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM role_permission_changes WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async decide(tenantId: string, id: string, status: "APPROVED" | "REJECTED", decidedBy: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE role_permission_changes SET status = $3, decided_by = $4, decided_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
      [tenantId, id, status, decidedBy],
    );
    return (rowCount ?? 0) > 0;
  }

  async reopen(tenantId: string, id: string): Promise<boolean> {
    // F-B8q-03(b): never reopen onto an existing PENDING of the same role (unique index) -> no-op, returns false.
    const { rowCount } = await this.pool.query(
      `UPDATE role_permission_changes c SET status = 'PENDING', decided_by = NULL, decided_at = NULL
       WHERE c.tenant_id = $1 AND c.id = $2 AND c.status IN ('APPROVED', 'REJECTED')
         AND NOT EXISTS (SELECT 1 FROM role_permission_changes o
                         WHERE o.tenant_id = c.tenant_id AND o.role_id = c.role_id AND o.status = 'PENDING' AND o.id <> c.id)`,
      [tenantId, id],
    );
    return (rowCount ?? 0) > 0;
  }

  async list(tenantId: string, filter: { status?: RolePermissionChangeStatus; roleId?: string }): Promise<RolePermissionChange[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM role_permission_changes
       WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2) AND ($3::uuid IS NULL OR role_id = $3)
       ORDER BY created_at DESC LIMIT 100`,
      [tenantId, filter.status ?? null, filter.roleId ?? null],
    );
    return rows.map(toDomain);
  }
}
