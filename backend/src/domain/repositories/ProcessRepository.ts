import type { CreateProcessInput, Process, ProcessResponsibilitiesInput, UpdateProcessInput } from "../entities/Process.js";

export interface ProcessRepository {
  getById(tenantId: string, id: string): Promise<Process | null>;
  list(tenantId: string, options?: { includeInactive?: boolean }): Promise<Process[]>;
  create(input: CreateProcessInput): Promise<Process>;
  update(tenantId: string, id: string, input: UpdateProcessInput): Promise<Process>;
  /** D2b: the only write of the three responsibility columns (not part of the generic update). */
  setResponsibilities(tenantId: string, id: string, input: ProcessResponsibilitiesInput): Promise<Process>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
}
