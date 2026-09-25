import type { Anomaly, AnomalyStatus, CreateAnomalyInput } from "../entities/Anomaly.js";

export interface AnomalyRepository {
  getById(tenantId: string, id: string): Promise<Anomaly | null>;
  list(tenantId: string, options?: { status?: AnomalyStatus }): Promise<Anomaly[]>;
  create(input: CreateAnomalyInput): Promise<Anomaly>;
  /** Sets status + (on closure) closedAt/closureComment, or appends a note to associatedActions otherwise. */
  updateStatus(
    tenantId: string,
    id: string,
    newStatus: AnomalyStatus,
    note: string | null,
  ): Promise<Anomaly>;
}
