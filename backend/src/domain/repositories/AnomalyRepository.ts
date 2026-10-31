import type { Anomaly, AnomalyStatus, CreateAnomalyInput } from "../entities/Anomaly.js";
import type { ReadScope } from "../visibility.js";

export interface AnomalyRepository {
  /** `scope` (DECISION-100, fail-closed SEC V0-01): the reader's visibility, mandatory; internal reads pass SYSTEM_SCOPE. */
  getById(tenantId: string, id: string, scope: ReadScope): Promise<Anomaly | null>;
  list(tenantId: string, options: { status?: AnomalyStatus } | undefined, scope: ReadScope): Promise<Anomaly[]>;
  create(input: CreateAnomalyInput): Promise<Anomaly>;
  /** Sets status + (on closure) closedAt/closureComment, or appends a note to associatedActions otherwise. */
  updateStatus(
    tenantId: string,
    id: string,
    newStatus: AnomalyStatus,
    note: string | null,
  ): Promise<Anomaly>;
}
