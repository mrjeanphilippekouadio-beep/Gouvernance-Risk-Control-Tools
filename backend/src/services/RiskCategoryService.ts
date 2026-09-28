import type { RiskCategoryRepository } from "../domain/repositories/RiskCategoryRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { CreateRiskCategoryInput, RiskCategory, UpdateRiskCategoryInput } from "../domain/entities/RiskCategory.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/** ACT-224 — risk category/sub-category taxonomy, CRUD + active/inactive only (see RiskCategory.ts for scope limits). */
export class RiskCategoryService {
  constructor(
    private readonly categories: RiskCategoryRepository,
    private readonly audit: AuditRepository,
  ) {}

  async list(actor: AuthenticatedUser, includeInactive = false): Promise<RiskCategory[]> {
    requirePermission(actor, "config.read");
    return this.categories.list(actor.tenantId, { activeOnly: !includeInactive });
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RiskCategory> {
    requirePermission(actor, "config.read");
    const category = await this.categories.getById(actor.tenantId, id);
    if (!category) throw new NotFoundError("RiskCategory", id);
    return category;
  }

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateRiskCategoryInput, "tenantId">,
    requestId: string,
  ): Promise<RiskCategory> {
    requirePermission(actor, "config.manage");
    if (!input.name.trim()) throw new ValidationError("name is required");

    if (input.parentId) {
      const parent = await this.categories.getById(actor.tenantId, input.parentId);
      if (!parent) throw new ValidationError(`parentId "${input.parentId}" does not exist for this tenant`);
      if (parent.parentId) {
        throw new ValidationError("A sub-category cannot itself be the parent of another sub-category");
      }
    }

    const category = await this.categories.create({ ...input, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RiskCategory",
      entityId: category.id,
      action: "CREATE",
      oldValue: null,
      newValue: category,
      reason: null,
      requestId,
    });

    return category;
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateRiskCategoryInput,
    requestId: string,
  ): Promise<RiskCategory> {
    requirePermission(actor, "config.manage");
    if (input.name !== undefined && !input.name.trim()) throw new ValidationError("name cannot be empty");
    if (input.parentId === id) throw new ValidationError("A category cannot be its own parent");
    const before = await this.get(actor, id);

    const after = await this.categories.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RiskCategory",
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
