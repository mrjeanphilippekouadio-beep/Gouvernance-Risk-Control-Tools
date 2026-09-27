import type { RegulatoryFrameworkRepository } from "../domain/repositories/RegulatoryFrameworkRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type {
  CreateRegulatoryFrameworkInput,
  RegulatoryFramework,
  UpdateRegulatoryFrameworkInput,
} from "../domain/entities/RegulatoryFramework.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/** ACT-223 — registry CRUD only, no link to Control/Report (see RegulatoryFramework.ts). */
export class RegulatoryFrameworkService {
  constructor(
    private readonly frameworks: RegulatoryFrameworkRepository,
    private readonly audit: AuditRepository,
  ) {}

  async list(actor: AuthenticatedUser, includeInactive = false): Promise<RegulatoryFramework[]> {
    requirePermission(actor, "config.read");
    return this.frameworks.list(actor.tenantId, { activeOnly: !includeInactive });
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RegulatoryFramework> {
    requirePermission(actor, "config.read");
    const framework = await this.frameworks.getById(actor.tenantId, id);
    if (!framework) throw new NotFoundError("RegulatoryFramework", id);
    return framework;
  }

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateRegulatoryFrameworkInput, "tenantId">,
    requestId: string,
  ): Promise<RegulatoryFramework> {
    requirePermission(actor, "config.manage");
    if (!input.name.trim()) throw new ValidationError("name is required");

    const existing = await this.frameworks.getByName(actor.tenantId, input.name);
    if (existing) throw new ValidationError(`A regulatory framework named "${input.name}" already exists`);

    const framework = await this.frameworks.create({ ...input, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RegulatoryFramework",
      entityId: framework.id,
      action: "CREATE",
      oldValue: null,
      newValue: framework,
      reason: null,
      requestId,
    });

    return framework;
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateRegulatoryFrameworkInput,
    requestId: string,
  ): Promise<RegulatoryFramework> {
    requirePermission(actor, "config.manage");
    if (input.name !== undefined && !input.name.trim()) throw new ValidationError("name cannot be empty");
    const before = await this.get(actor, id);

    const after = await this.frameworks.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RegulatoryFramework",
      entityId: id,
      action: input.active === false ? "STATUS_CHANGE" : "UPDATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }
}
