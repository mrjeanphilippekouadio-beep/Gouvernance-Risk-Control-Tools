import type { DepartmentRepository } from "../domain/repositories/DepartmentRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { CreateDepartmentInput, Department, UpdateDepartmentInput } from "../domain/entities/Department.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/**
 * Rules ported from apps-script-legacy/06_Departements.gs: updated in
 * place (not historized), and a department without an explicit risk
 * owner gets its manager as the owner by default — re-derived on every
 * write so it stays correct if the manager changes.
 */
export class DepartmentService {
  constructor(
    private readonly departments: DepartmentRepository,
    private readonly audit: AuditRepository,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateDepartmentInput, "tenantId">,
    requestId: string,
  ): Promise<Department> {
    requirePermission(actor, "department.create");
    if (!input.name.trim()) throw new ValidationError("name is required");
    if (!input.manager.trim()) {
      throw new ValidationError("manager (hierarchical superior) is required");
    }

    const department = await this.departments.create({ ...input, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Department",
      entityId: department.id,
      action: "CREATE",
      oldValue: null,
      newValue: department,
      reason: null,
      requestId,
    });

    return department;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Department> {
    requirePermission(actor, "department.read");
    const department = await this.departments.getById(actor.tenantId, id);
    if (!department) throw new NotFoundError("Department", id);
    return department;
  }

  async list(actor: AuthenticatedUser, includeInactive = false): Promise<Department[]> {
    requirePermission(actor, "department.read");
    return this.departments.list(actor.tenantId, { includeInactive });
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateDepartmentInput,
    requestId: string,
  ): Promise<Department> {
    requirePermission(actor, "department.update");
    const before = await this.get(actor, id);

    if (input.name !== undefined && !input.name.trim()) throw new ValidationError("name cannot be empty");
    if (input.manager !== undefined && !input.manager.trim()) {
      throw new ValidationError("manager cannot be empty");
    }

    const after = await this.departments.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Department",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  async designateRiskOwner(
    actor: AuthenticatedUser,
    id: string,
    riskOwner: string,
    requestId: string,
  ): Promise<Department> {
    requirePermission(actor, "department.update");
    if (!riskOwner.trim()) throw new ValidationError("riskOwner is required");
    const before = await this.get(actor, id);

    const after = await this.departments.designateRiskOwner(actor.tenantId, id, riskOwner, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Department",
      entityId: id,
      action: "ASSIGN",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  async archive(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<void> {
    requirePermission(actor, "department.delete");
    if (!reason.trim()) throw new ValidationError("A reason is required to archive a department");
    const before = await this.get(actor, id);

    await this.departments.softDelete(actor.tenantId, id, actor.userId, reason);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Department",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason,
      requestId,
    });
  }
}
