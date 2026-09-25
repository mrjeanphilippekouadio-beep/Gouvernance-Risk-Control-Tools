import type { Pool } from "pg";
import type { EvidenceRepository } from "../../../domain/repositories/EvidenceRepository.js";
import type { CreateEvidenceInput, Evidence } from "../../../domain/entities/Evidence.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface EvidenceRow {
  id: string;
  tenant_id: string;
  control_execution_id: string | null;
  file_name: string;
  drive_file_id: string;
  drive_url: string;
  document_type: string;
  uploaded_by: string;
  uploaded_at: Date;
  version: number;
  status: Evidence["status"];
}

function toDomain(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    controlExecutionId: row.control_execution_id,
    fileName: row.file_name,
    driveFileId: row.drive_file_id,
    driveUrl: row.drive_url,
    documentType: row.document_type,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    version: row.version,
    status: row.status,
  };
}

export class PostgresEvidenceRepository implements EvidenceRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<Evidence | null> {
    const { rows } = await this.pool.query<EvidenceRow>(
      `SELECT * FROM evidences WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listForControlExecution(tenantId: string, controlExecutionId: string): Promise<Evidence[]> {
    const { rows } = await this.pool.query<EvidenceRow>(
      `SELECT * FROM evidences
       WHERE tenant_id = $1 AND control_execution_id = $2 AND status = 'ACTIVE'
       ORDER BY uploaded_at DESC`,
      [tenantId, controlExecutionId],
    );
    return rows.map(toDomain);
  }

  async create(input: CreateEvidenceInput): Promise<Evidence> {
    const { rows } = await this.pool.query<EvidenceRow>(
      `INSERT INTO evidences
         (tenant_id, control_execution_id, file_name, drive_file_id, drive_url, document_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.tenantId,
        input.controlExecutionId,
        input.fileName,
        input.driveFileId,
        input.driveUrl,
        input.documentType,
        input.uploadedBy,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into evidences returned no row");
    return toDomain(row);
  }

  async markDeleted(tenantId: string, id: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE evidences SET status = 'DELETED' WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (!rowCount) throw new NotFoundError("Evidence", id);
  }
}
