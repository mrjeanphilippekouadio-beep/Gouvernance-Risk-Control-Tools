import { apiRequest } from "./client";
import type { RiskVisibility, RiskVisibilityState } from "./risks";

/** Lot V2: controls, anomalies, action plans and KPIs carry the same three levels as risks (DECISION-102). */
export type ResourceVisibilityState = RiskVisibilityState & {
  /** Set when the resource follows its risk / control / KRI: it has no level of its own. */
  inheritsFrom?: "RISK" | "CONTROL" | "KRI" | null;
};

export interface VisibilityChange { visibility: RiskVisibility; addUserIds?: string[]; revokeUserIds?: string[]; reason: string }

/** GET / PUT `<base>/:id/visibility` — the server decides who may change it and checks everything. */
export function visibilityApi(base: string) {
  return {
    get: (token: string, id: string) =>
      apiRequest<ResourceVisibilityState>(`${base}/${encodeURIComponent(id)}/visibility`, { token }),
    set: (token: string, id: string, input: VisibilityChange) =>
      apiRequest<ResourceVisibilityState>(`${base}/${encodeURIComponent(id)}/visibility`, { method: "PUT", body: input, token }),
  };
}

export const controlVisibilityApi = visibilityApi("/api/v1/controls");
export const anomalyVisibilityApi = visibilityApi("/api/v1/anomalies");
export const actionPlanVisibilityApi = visibilityApi("/api/v1/actions");
export const kpiVisibilityApi = visibilityApi("/api/v1/kpis");

/** Who the "Restreint au périmètre" level admits, per resource (presentation only: the server applies the rule). */
export const PERIMETER_HELP = {
  CONTROL: "Membres du groupe du département, responsable du processus, RACI du contrôle, et la liste ci-dessous.",
  ANOMALY: "Le déclarant et la liste ci-dessous.",
  ACTION_PLAN: "Le responsable, membres du groupe du département, RACI du plan, et la liste ci-dessous.",
  KPI: "Membres du groupe du département, responsable du processus, et la liste ci-dessous.",
} as const;

export const INHERITS_LABEL: Record<"RISK" | "CONTROL" | "KRI", string> = {
  RISK: "Suit la visibilité de son risque.",
  CONTROL: "Suit la visibilité de son contrôle.",
  KRI: "Suit la visibilité du risque de son KRI.",
};

/** q208 (DECISION-107): a restricted resource, as listed for the Risk Manager group. */
export interface RestrictedResource {
  type: "RISK" | "CONTROL" | "ANOMALY" | "ACTION_PLAN" | "KPI";
  id: string;
  label: string;
  visibility: "PERIMETRE" | "NOMINATIF";
  accessCount: number;
  updatedAt: string;
  /** R-1: last visibility change (author id, date, reason, widening), when there is one. */
  lastChange: { userId?: string; byName?: string | null; at: string; reason: string | null; widening: boolean | null } | null;
}

/** V3 (q196, q198): one number per type the reader may list; null for the groups that see everything (no mention). */
export type HiddenCounts = Partial<Record<RestrictedResource["type"], number>> | null;

export const restrictedResourcesApi = {
  list: (token: string) => apiRequest<RestrictedResource[]>("/api/v1/restricted-resources?limit=500", { token }),
};

export const hiddenCountsApi = {
  get: (token: string) => apiRequest<HiddenCounts>("/api/v1/hidden-counts", { token }),
};
