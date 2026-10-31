import type { Control, CreateControlInput, UpdateControlInput } from "../entities/Control.js";
import type { ReadScope } from "../visibility.js";

export interface ControlRepository {
  /** `scope` (DECISION-100, fail-closed SEC V0-01): the reader's visibility, mandatory; internal reads pass SYSTEM_SCOPE. */
  getById(tenantId: string, id: string, scope: ReadScope): Promise<Control | null>;
  list(tenantId: string, options: { includeArchived?: boolean } | undefined, scope: ReadScope): Promise<Control[]>;
  listCoveringRisk(tenantId: string, riskId: string): Promise<Control[]>;
  create(input: CreateControlInput): Promise<Control>;
  update(tenantId: string, id: string, input: UpdateControlInput): Promise<Control>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
}
