export type EvidenceStatus = "ACTIVE" | "DELETED";

/**
 * Metadata only — the file itself lives on Google Drive
 * (ADR-001 §1: business data in Postgres, documents in Drive).
 */
export interface Evidence {
  id: string;
  tenantId: string;
  controlExecutionId: string | null;
  fileName: string;
  driveFileId: string;
  driveUrl: string;
  documentType: string;
  uploadedBy: string;
  uploadedAt: Date;
  version: number;
  status: EvidenceStatus;
}

export interface CreateEvidenceInput {
  tenantId: string;
  controlExecutionId: string | null;
  fileName: string;
  driveFileId: string;
  driveUrl: string;
  documentType: string;
  uploadedBy: string;
}
