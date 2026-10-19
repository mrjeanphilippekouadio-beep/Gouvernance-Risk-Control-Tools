import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { AuditEvent } from "../domain/entities/AuditEvent.js";
import type { TransactionalAudit } from "../domain/entities/RiskFramework.js";

/**
 * DECISION-079 (CMP-PNL-01): a governance action and its audit rows are written together. When the repository
 * declares `auditsInTransaction`, `write` receives the audit builder and the repository inserts the events in the same
 * transaction as the write; otherwise (test fakes) the events are recorded right after, as before.
 */
export async function writeAudited<T>(
  transactional: boolean | undefined,
  audit: AuditRepository,
  write: (audit?: TransactionalAudit<T>) => Promise<T>,
  events: (result: T) => Array<Omit<AuditEvent, "id" | "timestamp">>,
): Promise<T> {
  if (transactional === true) return write(events);
  const result = await write();
  for (const event of events(result)) await audit.record(event);
  return result;
}
