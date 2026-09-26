import type { CreateProcessInput, Process, UpdateProcessInput } from "../entities/Process.js";

export interface ProcessRepository {
  getById(tenantId: string, id: string): Promise<Process | null>;
  list(tenantId: string, options?: { includeInactive?: boolean }): Promise<Process[]>;
  create(input: CreateProcessInput): Promise<Process>;
  update(tenantId: string, id: string, input: UpdateProcessInput): Promise<Process>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
}
