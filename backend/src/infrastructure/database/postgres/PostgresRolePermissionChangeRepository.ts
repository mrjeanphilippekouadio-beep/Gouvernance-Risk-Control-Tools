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

  async reopen(tenantId: string, id: string): Promise<void> {
    await this.pool.query(
      `UPDATE role_permission_changes SET status = 'PENDING', decided_by = NULL, decided_at = NULL
       WHERE tenant_id = $1 AND id = $2 AND status IN ('APPROVED', 'REJECTED')`,
      [tenantId, id],
    );
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
