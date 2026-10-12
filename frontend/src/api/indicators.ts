import { apiRequest } from "./client";

export type IndicatorFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL";
export type KriStatus = "VERT" | "ORANGE" | "ROUGE" | "NO_MEASURE";
export type KpiStatus = "ACHIEVED" | "AT_RISK" | "NOT_ACHIEVED" | "NO_MEASURE";

/** status / latest* are computed by the backend (KriService.withStatus) — never recomputed client-side. */
export interface Kri {
  id: string;
  label: string;
  formula: string;
  thresholdGreen: number;
  thresholdOrange: number;
  thresholdRed: number;
  frequency: IndicatorFrequency;
  riskId: string;
  entity: string | null;
  methodologyVersion: string | null;
  description: string | null;
  active: boolean;
  status: KriStatus;
  latestMeasureValue: number | null;
  latestMeasureDate: string | null;
}

export interface KriInput {
  label: string;
  formula: string;
  thresholdGreen: number;
  thresholdOrange: number;
  thresholdRed: number;
  frequency: IndicatorFrequency;
  entity?: string | null;
  methodologyVersion?: string | null;
  description?: string | null;
}

export interface KriMeasure {
  id: string;
  kriId: string;
  measureDate: string;
  value: number;
  source: string;
  comment: string | null;
  recordedBy: string;
  createdAt: string;
}

/** recordedBy is set server-side from the authenticated actor — never sent. */
export interface KriMeasureInput {
  kriId: string;
  measureDate: string;
  value: number;
  source: string;
  comment?: string | null;
}

export interface Kpi {
  id: string;
  label: string;
  targetValue: number;
  unit: string;
  frequency: IndicatorFrequency;
  owner: string;
  departmentId: string | null;
  processId: string | null;
  active: boolean;
  status: KpiStatus;
  achievementRate: number | null;
  latestMeasureValue: number | null;
  latestMeasurePeriod: string | null;
}

export interface KpiInput {
  label: string;
  targetValue: number;
  unit: string;
  frequency: IndicatorFrequency;
  owner: string;
  departmentId?: string | null;
  processId?: string | null;
}

export interface KpiMeasure {
  id: string;
  kpiId: string;
  period: string;
  value: number;
  comment: string | null;
  recordedBy: string;
  createdAt: string;
}

export interface KpiMeasureInput {
  kpiId: string;
  period: string;
  value: number;
  comment?: string | null;
}

export interface ProcessSummary {
  id: string;
  name: string;
}

const enc = encodeURIComponent;

export const krisApi = {
  list: (token: string) => apiRequest<Kri[]>("/api/v1/kris", { token }),
  create: (token: string, input: KriInput & { riskId: string }) =>
    apiRequest<Kri>("/api/v1/kris", { method: "POST", body: input, token }),
  update: (token: string, id: string, input: Partial<KriInput>) =>
    apiRequest<Kri>(`/api/v1/kris/${enc(id)}`, { method: "PUT", body: input, token }),
  /** Newest first. apiRequest drops the pagination envelope (total) — first page only. */
  measures: (token: string, kriId: string) =>
    apiRequest<KriMeasure[]>(`/api/v1/kri-measures?kriId=${enc(kriId)}&pageSize=100`, { token }),
  record: (token: string, input: KriMeasureInput) =>
    apiRequest<KriMeasure>("/api/v1/kri-measures", { method: "POST", body: input, token }),
};

export const kpisApi = {
  list: (token: string) => apiRequest<Kpi[]>("/api/v1/kpis", { token }),
  create: (token: string, input: KpiInput) =>
    apiRequest<Kpi>("/api/v1/kpis", { method: "POST", body: input, token }),
  update: (token: string, id: string, input: Partial<KpiInput>) =>
    apiRequest<Kpi>(`/api/v1/kpis/${enc(id)}`, { method: "PATCH", body: input, token }),
  measures: (token: string, kpiId: string) =>
    apiRequest<KpiMeasure[]>(`/api/v1/kpi-measures?kpiId=${enc(kpiId)}`, { token }),
  record: (token: string, input: KpiMeasureInput) =>
    apiRequest<KpiMeasure>("/api/v1/kpi-measures", { method: "POST", body: input, token }),
};

/** Needs "process.read"; callers treat a 403 as "directory unavailable". */
export const processesApi = {
  list: (token: string) => apiRequest<ProcessSummary[]>("/api/v1/processes", { token }),
};
