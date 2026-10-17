import type { CreateDepartmentInput, Department, UpdateDepartmentInput } from "../entities/Department.js";

export interface DepartmentRepository {
  getById(tenantId: string, id: string): Promise<Department | null>;
  list(tenantId: string, options?: { includeInactive?: boolean }): Promise<Department[]>;
  /** `designatedBy` = the acting user, stamped when an explicit riskOwner is given (never client-supplied). */
  create(input: CreateDepartmentInput, designatedBy: string): Promise<Department>;
  update(tenantId: string, id: string, input: UpdateDepartmentInput): Promise<Department>;
  /** Touches only riskOwner/riskOwnerDesignatedBy/riskOwnerDesignatedAt — see designerPiloteRisque_ in the legacy code. */
  designateRiskOwner(
    tenantId: string,
    id: string,
    riskOwner: string,
    designatedBy: string,
  ): Promise<Department>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
}
