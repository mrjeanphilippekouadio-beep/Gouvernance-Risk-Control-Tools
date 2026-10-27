import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { Config, ConfigPatch } from "../src/domain/entities/Config.js";
import type { DelayChange, GovernanceDelayRequest, GovernanceDelayRequestRepository } from "../src/domain/repositories/GovernanceDelayRequestRepository.js";
import type { TransactionalAudit } from "../src/domain/entities/RiskFramework.js";
import { ConflictError } from "../src/domain/errors/DomainErrors.js";

/**
 * q182: in-memory GovernanceDelayRequestRepository. `change` applies the steps like the PostgreSQL one (claim refused when
 * not PENDING or, for APPLIED, expired) and pushes the audit rows it is given into `events`.
 */
export function fakeDelayRequests(
  upsert: (tenantId: string, patch: ConfigPatch, by: string) => Promise<Config>,
  events: Array<Omit<AuditEvent, "id" | "timestamp">>,
) {
  let request: GovernanceDelayRequest | null = null;
  let n = 0;
  const repo: GovernanceDelayRequestRepository = {
    getPending: async (t) => (request && request.tenantId === t && request.status === "PENDING" ? request : null),
    getById: async (t, id) => (request && request.tenantId === t && request.id === id ? request : null),
    change: async (t: string, c: DelayChange, audit: TransactionalAudit<{ decided: GovernanceDelayRequest | null; submitted: GovernanceDelayRequest | null; config: Config | null }>) => {
      let decided: GovernanceDelayRequest | null = null;
      if (c.decide) {
        const r = request;
        const expired = !!r?.expiresAt && r.expiresAt.getTime() <= Date.now();
        if (!r || r.tenantId !== t || r.id !== c.decide.id || r.status !== "PENDING" || (c.decide.status === "APPLIED" && expired)) {
          throw new ConflictError("This request has already been decided or has expired");
        }
        decided = request = { ...r, status: c.decide.status, decidedBy: c.decide.by, decidedAt: new Date(), decisionReason: c.decide.reason };
      }
      const submitted = c.submit
        ? (request = {
            id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, tenantId: t, requestedDelays: c.submit.delays, reason: c.submit.reason, status: "PENDING",
            requestedBy: c.submit.by, requestedAt: new Date(), expiresAt: c.submit.expiresAt, decidedBy: null, decidedAt: null, decisionReason: null,
          })
        : null;
      const config = c.setDelays ? await upsert(t, c.setDelays.patch, c.setDelays.updatedBy) : null;
      const result = { decided, submitted, config };
      events.push(...audit(result));
      return result;
    },
  };
  return { repo, request: () => request, setRequest: (r: GovernanceDelayRequest | null) => { request = r; } };
}
