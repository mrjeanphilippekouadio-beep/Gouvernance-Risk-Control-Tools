import type { Pool, PoolClient } from "pg";
import type { ControlRepository } from "../../../domain/repositories/ControlRepository.js";
import type {
  Control,
  ControlStatus,
  ControlType,
  CreateControlInput,
  UpdateControlInput,
} from "../../../domain/entities/Control.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";

interface ControlRow {
  id: string;
  tenant_id: string;
  label: string;
  objective: string | null;
  process: string | null;
  department_id: string | null;
  procedure_description: string | null;
  control_type: ControlType;
  nature: string | null;
  defense_line: string | null;
  frequency: string;
  executor: string;
  validator: string | null;
  expected_evidence: string | null;
  compliance_criteria: string;
  status: ControlStatus;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  deletion_reason: string | null;
}

function toDomain(row: ControlRow, coveredRiskIds: string[]): Control {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    label: row.label,
    objective: row.objective,
    coveredRiskIds,
    process: row.process,
    departmentId: row.department_id,
    procedureDescription: row.procedure_description,
    controlType: row.control_type,
    nature: row.nature,
    defenseLine: row.defense_line,
    frequency: row.frequency,
    executor: row.executor,
    validator: row.validator,
    expectedEvidence: row.expected_evidence,
    complianceCriteria: row.compliance_criteria,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deletionReason: row.deletion_reason,
  };
}

async function coveredRiskIdsFor(client: Pool | PoolClient, controlId: string): Promise<string[]> {
  const { rows } = await client.query<{ risk_id: string }>(
    `SELECT risk_id FROM control_risks WHERE control_id = $1`,
    [controlId],
  );
  return rows.map((r) => r.risk_id);
}

/** One query for N controls instead of N — used by list()/listCoveringRisk(). */
async function coveredRiskIdsForMany(
  client: Pool | PoolClient,
  controlIds: string[],
): Promise<Map<string, string[]>> {
  const byControl = new Map<string, string[]>();
  if (controlIds.length === 0) return byControl;

  const { rows } = await client.query<{ control_id: string; risk_id: string }>(
    `SELECT control_id, risk_id FROM control_risks WHERE control_id = ANY($1)`,
    [controlIds],
  );
  for (const row of rows) {
    const existing = byControl.get(row.control_id);
    if (existing) existing.push(row.risk_id);
    else byControl.set(row.control_id, [row.risk_id]);
  }
  return byControl;
}

async function replaceCoveredRisks(
  client: PoolClient,
  tenantId: string,
  controlId: string,
  riskIds: string[],
): Promise<void> {
  // control_risks is a pure link table (see the exemption in
  // CLAUDE.md's Security-sensitive conventions) — rebuilt by delete +
  // insert rather than soft-deleted, but still tenant-scoped so this
  // can never touch another tenant's row even if controlId were reused.
  await client.query(`DELETE FROM control_risks WHERE tenant_id = $1 AND control_id = $2`, [tenantId, controlId]);
  for (const riskId of riskIds) {
    await client.query(
      `INSERT INTO control_risks (tenant_id, control_id, risk_id) VALUES ($1, $2, $3)`,
      [tenantId, controlId, riskId],
    );
  }
}

export class PostgresControlRepository implements ControlRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<Control | null> {
    const { rows } = await this.pool.query<ControlRow>(
      `SELECT * FROM controls WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    const row = rows[0];
    if (!row) return null;
    return toDomain(row, await coveredRiskIdsFor(this.pool, row.id));
  }

  async list(tenantId: string, options?: { includeArchived?: boolean }): Promise<Control[]> {
    const statusFilter = options?.includeArchived ? "" : "AND status <> 'ARCHIVED'";
    const { rows } = await this.pool.query<ControlRow>(
      `SELECT * FROM controls
       WHERE tenant_id = $1 AND deleted_at IS NULL ${statusFilter}
       ORDER BY created_at DESC`,
      [tenantId],
    );
    const byControl = await coveredRiskIdsForMany(this.pool, rows.map((r) => r.id));
    return rows.map((row) => toDomain(row, byControl.get(row.id) ?? []));
  }

  async listCoveringRisk(tenantId: string, riskId: string): Promise<Control[]> {
    const { rows } = await this.pool.query<ControlRow>(
      `SELECT c.* FROM controls c
       JOIN control_risks cr ON cr.control_id = c.id
       WHERE c.tenant_id = $1 AND cr.risk_id = $2 AND c.deleted_at IS NULL`,
      [tenantId, riskId],
    );
    const byControl = await coveredRiskIdsForMany(this.pool, rows.map((r) => r.id));
    return rows.map((row) => toDomain(row, byControl.get(row.id) ?? []));
  }

  async create(input: CreateControlInput): Promise<Control> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<ControlRow>(
        `INSERT INTO controls
           (tenant_id, label, objective, process, department_id, procedure_description,
            control_type, nature, defense_line, frequency, executor, validator,
            expected_evidence, compliance_criteria, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'DRAFT')
         RETURNING *`,
        [
          input.tenantId,
          input.label,
          input.objective ?? null,
          input.process ?? null,
          input.departmentId ?? null,
          input.procedureDescription ?? null,
          input.controlType,
          input.nature ?? null,
          input.defenseLine ?? null,
          input.frequency,
          input.executor,
          input.validator ?? null,
          input.expectedEvidence ?? null,
          input.complianceCriteria,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error("Insert into controls returned no row");

      await replaceCoveredRisks(client, input.tenantId, row.id, input.coveredRiskIds);
      await client.query("COMMIT");
      return toDomain(row, input.coveredRiskIds);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async update(tenantId: string, id: string, input: UpdateControlInput): Promise<Control> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Dynamic SET list, not COALESCE: COALESCE($n, col) can't tell
      // "field omitted" from "field explicitly set to null", so nullable
      // columns (objective, process, departmentId, ...) could never be
      // cleared through the API otherwise.
      const { setClauses, values } = buildUpdateSet(
        {
          label: input.label,
          objective: input.objective,
          process: input.process,
          department_id: input.departmentId,
          procedure_description: input.procedureDescription,
          control_type: input.controlType,
          nature: input.nature,
          defense_line: input.defenseLine,
          frequency: input.frequency,
          executor: input.executor,
          validator: input.validator,
          expected_evidence: input.expectedEvidence,
          compliance_criteria: input.complianceCriteria,
          status: input.status,
        },
        3,
      );
      if (setClauses.length === 0 && input.coveredRiskIds === undefined) {
        throw new ValidationError("No fields to update");
      }

      const row =
        setClauses.length > 0
          ? (
              await client.query<ControlRow>(
                `UPDATE controls SET ${setClauses.join(", ")}, updated_at = now()
                 WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
                 RETURNING *`,
                [tenantId, id, ...values],
              )
            ).rows[0]
          : (
              await client.query<ControlRow>(
                `SELECT * FROM controls WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
                [tenantId, id],
              )
            ).rows[0];
      if (!row) throw new NotFoundError("Control", id);

      let coveredRiskIds: string[];
      if (input.coveredRiskIds !== undefined) {
        await replaceCoveredRisks(client, tenantId, id, input.coveredRiskIds);
        coveredRiskIds = input.coveredRiskIds;
      } else {
        coveredRiskIds = await coveredRiskIdsFor(client, id);
      }

      await client.query("COMMIT");
      return toDomain(row, coveredRiskIds);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE controls
       SET deleted_at = now(), deleted_by = $3, deletion_reason = $4
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id, deletedBy, reason],
    );
    if (!rowCount) throw new NotFoundError("Control", id);
  }
}
