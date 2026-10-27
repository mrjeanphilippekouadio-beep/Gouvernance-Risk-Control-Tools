import { ApiError, apiRequest } from "./client";

const API_BASE_URL = import.meta.env["VITE_API_BASE_URL"] as string | undefined;

export interface Evidence {
  id: string;
  fileName: string;
  documentType: string;
  uploadedAt: string;
  /** Present on list results (S1); the storage location never reaches the client. */
  mimeType?: string | null;
  fileSize?: number | null;
  sha256?: string | null;
  uploadedBy?: string;
  version?: number;
}

/** EVD-2: what the server reads from an xlsx evidence (examples only with evidence.download). */
export interface EvidenceAnalysis {
  evidenceId: string;
  fileName: string;
  sha256: string;
  sheets: {
    name: string;
    headerRow: number | null;
    headerDetected: boolean;
    rowCount: number;
    columns: { index: number; name: string; inferredType: string; examples: string[]; isEmpty: boolean }[];
  }[];
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const evidenceApi = {
  /** S1: the evidences of one control execution (evidence.read). */
  listForExecution: (token: string, controlExecutionId: string) =>
    apiRequest<Evidence[]>(`/api/v1/evidences?controlExecutionId=${encodeURIComponent(controlExecutionId)}`, { token }),
  /** evidence.download; the server audits the access before releasing the link. */
  url: (token: string, id: string) => apiRequest<{ url: string }>(`/api/v1/evidences/${id}/url`, { token }),
  /** evidence.import; xlsx only, checked against its SHA-256 by the server. */
  analyze: (token: string, id: string) => apiRequest<EvidenceAnalysis>(`/api/v1/evidences/${id}/analysis`, { method: "POST", token }),

  async upload(token: string, file: File, documentType: string): Promise<Evidence> {
    const body = new FormData();
    body.append("file", file);
    body.append("documentType", documentType);
    const response = await fetch(`${API_BASE_URL ?? ""}/api/v1/evidences`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    const requestId = response.headers.get("X-Request-Id");
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: response.statusText }));
      throw new ApiError(payload.error ?? "Échec du dépôt de la preuve", response.status, requestId);
    }
    const payload = await response.json();
    return payload.data as Evidence;
  },
};
