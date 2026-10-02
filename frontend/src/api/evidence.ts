import { ApiError } from "./client";

const API_BASE_URL = import.meta.env["VITE_API_BASE_URL"] as string | undefined;

export interface Evidence {
  id: string;
  fileName: string;
  documentType: string;
  uploadedAt: string;
}

export const evidenceApi = {
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
