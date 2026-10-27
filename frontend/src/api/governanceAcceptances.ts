import { apiRequest } from "./client";

export type AcceptanceStatus = "PENDING" | "ACTIVE" | "REJECTED" | "REVOKED";

/** A principle acceptance as the server returns it: names are null without audit.read (R-6.1), `mine` says if it is the caller's. */
export interface PrincipleAcceptance {
  id: string;
  principleId: string;
  catalogVersion: string;
  reason: string;
  expiresAt: string;
  status: AcceptanceStatus;
  /** ALONE = accepted with nobody able to confirm it. */
  regime: "ALONE" | "CONFIRMED" | null;
  acceptedBy: string | null;
  acceptedAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  endedBy: string | null;
  endedAt: string | null;
  endReason: string | null;
  mine: boolean;
}

const BASE = "/api/v1/governance-principle-acceptances";

/** D5 routes. Every rule (maker-checker, expiry, permissions) is the server's. */
export const governanceAcceptancesApi = {
  list: (token: string) => apiRequest<PrincipleAcceptance[]>(BASE, { token }),
  confirm: (token: string, id: string) => apiRequest<PrincipleAcceptance>(`${BASE}/${id}/confirm`, { method: "POST", token }),
  reject: (token: string, id: string, reason: string) =>
    apiRequest<PrincipleAcceptance>(`${BASE}/${id}/reject`, { method: "POST", body: { reason }, token }),
  revoke: (token: string, id: string, reason: string) =>
    apiRequest<PrincipleAcceptance>(`${BASE}/${id}/revoke`, { method: "POST", body: { reason }, token }),
};
