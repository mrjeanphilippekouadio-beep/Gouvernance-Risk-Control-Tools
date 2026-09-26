import type { Pool } from "pg";
import type { DepartmentRepository } from "../../../domain/repositories/DepartmentRepository.js";
import type {
  CreateDepartmentInput,
  Department,
  UpdateDepartmentInput,
} from "../../../domain/entities/Department.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";

interface DepartmentRow {
  id: string;
  tenant_id: string;
  name: string;
  entity: string | null;
  manager: string;
  risk_owner: string;
  risk_owner_designated_by: string | null;
  risk_owner_designated_at: Date | null;
  linked_processes: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  deletion_reason: string | null;
}

function toDomain(row: DepartmentRow): Department {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    entity: row.entity,
    manager: row.manager,
    riskOwner: row.risk_owner,
    riskOwnerDesignatedBy: row.risk_owner_designated_by,
    riskOwnerDesignatedAt: row.risk_owner_designated_at,
    linkedProcesses: row.linked_processes,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deletionReason: row.deletion_reason,
  };
}

export class PostgresDepartmentRepository implements DepartmentRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<Department | null> {
    const { rows } = await this.pool.query<DepartmentRow>(
      `SELECT * FROM departments WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, options?: { includeInactive?: boolean }): Promise<Department[]> {
    const activeFilter = options?.includeInactive ? "" : "AND active = true";
    const { rows } = await this.pool.query<DepartmentRow>(
      `SELECT * FROM departments
       WHERE tenant_id = $1 AND deleted_at IS NULL ${activeFilter}
       ORDER BY name`,
      [tenantId],
    );
    return rows.map(toDomain);
  }

  async create(input: CreateDepartmentInput): Promise<Department> {
    // Legacy rule: an unspecified risk owner defaults to the manager,
    // reapplied on every write so it stays consistent if the manager
    // changes (06_Departements.gs, ecrireLigneDepartement_).
    const riskOwner = input.riskOwner?.trim() || input.manager;
    const designatedBy = input.riskOwner?.trim()
      ? (input.riskOwnerDesignatedBy ?? input.manager)
      : "Pilote par défaut (manager, aucune désignation explicite)";

    const { rows } = await this.pool.query<DepartmentRow>(
      `INSERT INTO departments
         (tenant_id, name, entity, manager, risk_owner, risk_owner_designated_by,
          risk_owner_designated_at, linked_processes, active)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)
       RETURNING *`,
      [
        input.tenantId,
        input.name,
        input.entity ?? null,
        input.manager,
        riskOwner,
        designatedBy,
        input.linkedProcesses ?? null,
        input.active ?? true,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into departments returned no row");
    return toDomain(row);
  }

  async update(tenantId: string, id: string, input: UpdateDepartmentInput): Promise<Department> {
    // If the manager changes and no explicit riskOwner is given in the
    // same call, the legacy rule still re-derives riskOwner = manager —
    // fetch current state first so we know whether riskOwner was ever
    // explicitly designated.
    const current = await this.getById(tenantId, id);
    if (!current) throw new NotFoundError("Department", id);

    let riskOwnerUpdate: string | undefined;
    let designatedByUpdate: string | undefined;
    if (input.riskOwner !== undefined) {
      riskOwnerUpdate = input.riskOwner?.trim() || input.manager || current.manager;
      designatedByUpdate = input.riskOwner?.trim()
        ? (input.riskOwnerDesignatedBy ?? input.manager ?? current.manager)
        : "Pilote par défaut (manager, aucune désignation explicite)";
    } else if (input.manager !== undefined && current.riskOwnerDesignatedBy?.startsWith("Pilote par défaut")) {
      // Risk owner was never explicitly designated — keep tracking the manager.
      riskOwnerUpdate = input.manager;
    }

    const { setClauses, values } = buildUpdateSet(
      {
        name: input.name,
        entity: input.entity,
        manager: input.manager,
        risk_owner: riskOwnerUpdate,
        risk_owner_designated_by: designatedByUpdate,
        linked_processes: input.linkedProcesses,
        active: input.active,
      },
      3,
    );
    if (setClauses.length === 0) return current;

    const { rows } = await this.pool.query<DepartmentRow>(
      `UPDATE departments SET ${setClauses.join(", ")}, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [tenantId, id, ...values],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Department", id);
    return toDomain(row);
  }

  async designateRiskOwner(
    tenantId: string,
    id: string,
    riskOwner: string,
    designatedBy: string,
  ): Promise<Department> {
    const { rows } = await this.pool.query<DepartmentRow>(
      `UPDATE departments
       SET risk_owner = $3, risk_owner_designated_by = $4, risk_owner_designated_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [tenantId, id, riskOwner, designatedBy],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Department", id);
    return toDomain(row);
  }

  async softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE departments
       SET deleted_at = now(), deleted_by = $3, deletion_reason = $4
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id, deletedBy, reason],
    );
    if (!rowCount) throw new NotFoundError("Department", id);
  }
}
