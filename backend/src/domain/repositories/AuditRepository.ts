import type { AuditEvent } from "../entities/AuditEvent.js";

export interface AuditRepository {
  record(event: Omit<AuditEvent, "id" | "timestamp">): Promise<void>;
  listForEntity(tenantId: string, entityType: string, entityId: string): Promise<AuditEvent[]>;
}
