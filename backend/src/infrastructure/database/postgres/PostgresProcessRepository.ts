import type { Pool } from "pg";
import type { ProcessRepository } from "../../../domain/repositories/ProcessRepository.js";
import type {
  CreateProcessInput,
  Process,
  ProcessDocumentType,
  ProcessLevel,
  ProcessResponsibilitiesInput,
  UpdateProcessInput,
} from "../../../domain/entities/Process.js";
import type { EvaluationMode } from "../../../domain/entities/Config.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";
import { runAudited } from "./PostgresAuditRepository.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";

export interface ProcessRow {
  id: string;
  tenant_id: string;
  parent_id: string | null;
  level: ProcessLevel;
  name: string;
  description: string | null;
  document_type: ProcessDocumentType | null;
  document_reference: string | null;
  owner: string | null;
  active: boolean;
  evaluation_mode: EvaluationMode | null;
  department_id: string | null;
  owner_user_id: string | null;
  risk_champion_user_id: string | null;
  deputy_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  deletion_reason: string | null;
}

export function toDomain(row: ProcessRow): Process {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    parentId: row.parent_id,
    level: row.level,
    name: row.name,
    description: row.description,
    documentType: row.document_type,
    documentReference: row.document_reference,
    owner: row.owner,
    active: row.active,
    evaluationMode: row.evaluation_mode,
    departmentId: row.department_id,
    ownerUserId: row.owner_user_id,
    riskChampionUserId: row.risk_champion_user_id,
    deputyUserId: row.deputy_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deletionReason: row.deletion_reason,
  };
}

export class PostgresProcessRepository implements ProcessRepository {
  readonly auditsInTransaction = true;

  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<Process | null> {
    const { rows } = await this.pool.query<ProcessRow>(
      `SELECT * FROM processes WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, options?: { includeInactive?: boolean }): Promise<Process[]> {
    const activeFilter = options?.includeInactive ? "" : "AND active = true";
    const { rows } = await this.pool.query<ProcessRow>(
      `SELECT * FROM processes
       WHERE tenant_id = $1 AND deleted_at IS NULL ${activeFilter}
       ORDER BY name`,
      [tenantId],
    );
    return rows.map(toDomain);
  }

  async create(input: CreateProcessInput): Promise<Process> {
    const { rows } = await this.pool.query<ProcessRow>(
      `INSERT INTO processes
         (tenant_id, parent_id, level, name, description, document_type, document_reference, owner, active, evaluation_mode, department_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.tenantId,
        input.parentId ?? null,
        input.level,
        input.name,
        input.description ?? null,
        input.documentType ?? null,
        input.documentReference ?? null,
        input.owner ?? null,
        input.active ?? true,
        input.evaluationMode ?? null,
        input.departmentId ?? null,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into processes returned no row");
    return toDomain(row);
  }

  async update(tenantId: string, id: string, input: UpdateProcessInput, audit?: TransactionalAudit<Process>): Promise<Process> {
    const { setClauses, values } = buildUpdateSet(
      {
        parent_id: input.parentId,
        level: input.level,
        name: input.name,
        description: input.description,
        document_type: input.documentType,
        document_reference: input.documentReference,
        owner: input.owner,
        active: input.active,
        evaluation_mode: input.evaluationMode,
        department_id: input.departmentId,
      },
      3,
    );
    // SEC-B6C-05: the change and its audit row (old/new Dispositif, motive) commit together.
    return runAudited(
      this.pool,
      async (db) => {
        if (setClauses.length === 0) {
          const current = await db.query<ProcessRow>(
            `SELECT * FROM processes WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, id]);
          if (!current.rows[0]) throw new NotFoundError("Process", id);
          return toDomain(current.rows[0]);
        }
        let rows: ProcessRow[];
        try {
          ({ rows } = await db.query<ProcessRow>(
            `UPDATE processes SET ${setClauses.join(", ")}, updated_at = now()
             WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
             RETURNING *`,
            [tenantId, id, ...values],
          ));
        } catch (err) {
          // QA-B6C-01: only a PROCESS-level process can carry a Dispositif (055): a clear refusal instead of a 500.
          if ((err as { code?: string; constraint?: string })?.code === "23514"
              && (err as { constraint?: string }).constraint === "processes_risk_framework_level_check") {
            throw new ValidationError("Ce processus est rattaché à un Dispositif : un processus rattaché doit rester de niveau PROCESS. Détachez-le d'abord.");
          }
          throw err;
        }
        const row = rows[0];
        if (!row) throw new NotFoundError("Process", id);
        return toDomain(row);
      },
      audit,
    );
  }

  async setResponsibilities(
    tenantId: string,
    id: string,
    input: ProcessResponsibilitiesInput,
    audit?: TransactionalAudit<Process>,
  ): Promise<Process> {
    const { setClauses, values } = buildUpdateSet(
      {
        owner_user_id: input.ownerUserId,
        risk_champion_user_id: input.riskChampionUserId,
        deputy_user_id: input.deputyUserId,
      },
      3,
    );
    if (setClauses.length === 0) {
      const current = await this.getById(tenantId, id);
      if (!current) throw new NotFoundError("Process", id);
      return current;
    }
    // DECISION-079 (SEC-F4-01): the responsibilities and their audit row (q166 marker included) commit together.
    return runAudited(
      this.pool,
      async (db) => {
        const { rows } = await db.query<ProcessRow>(
          `UPDATE processes SET ${setClauses.join(", ")}, updated_at = now()
           WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
           RETURNING *`,
          [tenantId, id, ...values],
        );
        const row = rows[0];
        if (!row) throw new NotFoundError("Process", id);
        return toDomain(row);
      },
      audit,
    );
  }

  async softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE processes
       SET deleted_at = now(), deleted_by = $3, deletion_reason = $4
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id, deletedBy, reason],
    );
    if (!rowCount) throw new NotFoundError("Process", id);
  }
}
