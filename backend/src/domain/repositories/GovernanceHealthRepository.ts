import type { ActiveAcceptance, GovernanceFacts } from "../governance/health.js";

/** Lot D6: one read-only snapshot of the client for the governance panel. Every query is tenant-scoped. */
export interface GovernanceHealthRepository {
  loadFacts(tenantId: string, now: Date): Promise<GovernanceFacts>;
  /** ACTIVE acceptances (expiry checked by the domain on read). */
  activeAcceptances(tenantId: string): Promise<ActiveAcceptance[]>;
}
