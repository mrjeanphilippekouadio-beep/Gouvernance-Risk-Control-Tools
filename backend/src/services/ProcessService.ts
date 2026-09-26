import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import {
  PROCESS_LEVEL_BY_RANK,
  PROCESS_LEVEL_RANK,
  type CreateProcessInput,
  type Process,
  type UpdateProcessInput,
} from "../domain/entities/Process.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/**
 * Rules ported from apps-script-legacy/07_Processus.gs
 * (validerHierarchieProcessus_): a 3-level hierarchy — a PROCESS is
 * always root (no parent), a SUBPROCESS's parent must be a PROCESS, an
 * ACTIVITY's parent must be a SUBPROCESS. No self-parenting.
 */
export class ProcessService {
  constructor(
    private readonly processes: ProcessRepository,
    private readonly audit: AuditRepository,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateProcessInput, "tenantId">,
    requestId: string,
  ): Promise<Process> {
    requirePermission(actor, "process.create");
    if (!input.name.trim()) throw new ValidationError("name is required");
    await this.validateHierarchy(actor.tenantId, input.level, input.parentId ?? null, null);

    const process = await this.processes.create({ ...input, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Process",
      entityId: process.id,
      action: "CREATE",
      oldValue: null,
      newValue: process,
      reason: null,
      requestId,
    });

    return process;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Process> {
    requirePermission(actor, "process.read");
    const process = await this.processes.getById(actor.tenantId, id);
    if (!process) throw new NotFoundError("Process", id);
    return process;
  }

  async list(actor: AuthenticatedUser, includeInactive = false): Promise<Process[]> {
    requirePermission(actor, "process.read");
    return this.processes.list(actor.tenantId, { includeInactive });
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateProcessInput,
    requestId: string,
  ): Promise<Process> {
    requirePermission(actor, "process.update");
    const before = await this.get(actor, id);

    if (input.level !== undefined || input.parentId !== undefined) {
      const level = input.level ?? before.level;
      const parentId = input.parentId !== undefined ? input.parentId : before.parentId;
      await this.validateHierarchy(actor.tenantId, level, parentId, id);
    }

    const after = await this.processes.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Process",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  async archive(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<void> {
    requirePermission(actor, "process.delete");
    if (!reason.trim()) throw new ValidationError("A reason is required to archive a process");
    const before = await this.get(actor, id);

    await this.processes.softDelete(actor.tenantId, id, actor.userId, reason);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Process",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason,
      requestId,
    });
  }

  private async validateHierarchy(
    tenantId: string,
    level: Process["level"],
    parentId: string | null,
    selfId: string | null,
  ): Promise<void> {
    const rank = PROCESS_LEVEL_RANK[level];

    if (rank === 1) {
      if (parentId) {
        throw new ValidationError('A "PROCESS"-level item is root: it cannot have a parent');
      }
      return;
    }

    if (!parentId) {
      throw new ValidationError(`A "${level}"-level item must be attached to a parent`);
    }
    if (parentId === selfId) {
      throw new ValidationError("A process cannot be its own parent");
    }

    const parent = await this.processes.getById(tenantId, parentId);
    if (!parent) throw new ValidationError(`Parent process ${parentId} does not exist in this tenant`);

    const expectedParentLevel = PROCESS_LEVEL_BY_RANK[rank - 2];
    if (PROCESS_LEVEL_RANK[parent.level] !== rank - 1) {
      throw new ValidationError(
        `The parent of a "${level}"-level item must be "${expectedParentLevel}" ` +
          `(current parent is "${parent.level}"). The hierarchy is capped at 3 levels: ` +
          "PROCESS > SUBPROCESS > ACTIVITY.",
      );
    }
  }
}
