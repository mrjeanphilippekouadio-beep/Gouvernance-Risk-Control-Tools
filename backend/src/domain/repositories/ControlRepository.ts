import type { Control, CreateControlInput, UpdateControlInput } from "../entities/Control.js";

export interface ControlRepository {
  getById(tenantId: string, id: string): Promise<Control | null>;
  list(tenantId: string, options?: { includeArchived?: boolean }): Promise<Control[]>;
  listCoveringRisk(tenantId: string, riskId: string): Promise<Control[]>;
  create(input: CreateControlInput): Promise<Control>;
  update(tenantId: string, id: string, input: UpdateControlInput): Promise<Control>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
}
