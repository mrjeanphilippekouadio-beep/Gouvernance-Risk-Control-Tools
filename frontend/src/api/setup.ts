import { apiRequest } from "./client";

/** F8 R1 (q165): mise en service. Mirrors backend TenantBranding / ModuleToggle / Tenant / RiskImportReport (dates as ISO strings). */
export interface TenantBranding {
  tenantId: string;
  logoDriveFileId: string | null;
  logoUrl: string | null;
  logoUpdatedAt: string | null;
  logoUpdatedBy: string | null;
}

export interface ModuleToggle {
  /** "" = never persisted (enabled by default). */
  id: string;
  moduleName: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

export type DeploymentMode = "managed_saas" | "customer_managed" | "on_premise";

export interface Tenant {
  id: string;
  name: string;
  deploymentMode: DeploymentMode;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRowOutcome { row: number; process?: string; description?: string; errors: string[] }
export interface ImportReport { totalRows: number; validCount: number; invalidCount: number; rows: ImportRowOutcome[]; createdCount?: number; alreadyImported?: boolean }

const form = (file: File, extra?: Record<string, string>) => {
  const data = new FormData();
  // Text fields BEFORE the file would be fine too; the server reads both (commit only).
  for (const [key, value] of Object.entries(extra ?? {})) data.append(key, value);
  data.append("file", file);
  return data;
};

export const setupApi = {
  branding: (token: string) => apiRequest<TenantBranding>("/api/v1/branding", { token }),
  uploadLogo: (token: string, file: File) => apiRequest<TenantBranding>("/api/v1/branding", { method: "POST", formData: form(file), token }),
  modules: (token: string) => apiRequest<ModuleToggle[]>("/api/v1/modules", { token }),
  toggleModule: (token: string, name: string, enabled: boolean, reason: string) =>
    apiRequest<ModuleToggle>(`/api/v1/modules/${encodeURIComponent(name)}/toggle`, { method: "PATCH", body: { enabled, reason }, token }),
  tenants: (token: string) => apiRequest<Tenant[]>("/api/v1/tenants", { token }),
  createTenant: (token: string, body: { name: string; deploymentMode?: DeploymentMode }) => apiRequest<Tenant>("/api/v1/tenants", { method: "POST", body, token }),
  updateTenant: (token: string, id: string, body: { name?: string; deploymentMode?: DeploymentMode }) =>
    apiRequest<Tenant>(`/api/v1/tenants/${encodeURIComponent(id)}`, { method: "PATCH", body, token }),
  /** q261: dedicated actions, reason mandatory; reactivation needs a different super-administrator (server rule). */
  deactivateTenant: (token: string, id: string, reason: string) =>
    apiRequest<Tenant>(`/api/v1/tenants/${encodeURIComponent(id)}/deactivate`, { method: "POST", body: { reason }, token }),
  reactivateTenant: (token: string, id: string, reason: string) =>
    apiRequest<Tenant>(`/api/v1/tenants/${encodeURIComponent(id)}/reactivate`, { method: "POST", body: { reason }, token }),
  importPreview: (token: string, file: File) => apiRequest<ImportReport>("/api/v1/import/excel/preview", { method: "POST", formData: form(file), token }),
  /** q263: `reimportReason` only after the server answered 409 ALREADY_IMPORTED and the user confirmed with a reason. */
  importCommit: (token: string, file: File, reimportReason?: string) =>
    apiRequest<ImportReport>("/api/v1/import/excel/commit", {
      method: "POST", token,
      formData: form(file, reimportReason ? { confirmReimport: "true", reason: reimportReason } : undefined),
    }),
};
