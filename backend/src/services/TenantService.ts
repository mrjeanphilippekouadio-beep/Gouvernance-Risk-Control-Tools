import type { TenantRepository } from "../domain/repositories/TenantRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { CreateTenantInput, Tenant, UpdateTenantInput } from "../domain/entities/Tenant.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/**
 * ACT-222 — see Tenant.ts's file header: this is the one service in the
 * codebase that does NOT scope its reads/writes by `actor.tenantId`,
 * because a Tenant is the scoping boundary itself, not a resource owned
 * by one. Gated entirely on `config.manage` ("Super-admin uniquement").
 * Audit events are still recorded with `actor.tenantId` (the acting
 * admin's own tenant) since AuditEvent requires one, even though the
 * entity being changed may be a different tenant.
 */
export class TenantService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly audit: AuditRepository,
  ) {}

  async list(actor: AuthenticatedUser): Promise<Tenant[]> {
    requirePermission(actor, "config.manage");
    return this.tenants.list();
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Tenant> {
    requirePermission(actor, "config.manage");
    const tenant = await this.tenants.getById(id);
    if (!tenant) throw new NotFoundError("Tenant", id);
    return tenant;
  }

  async create(actor: AuthenticatedUser, input: CreateTenantInput, requestId: string): Promise<Tenant> {
    requirePermission(actor, "config.manage");
    if (!input.name.trim()) throw new ValidationError("name is required");

    const tenant = await this.tenants.create(input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Tenant",
      entityId: tenant.id,
      action: "CREATE",
      oldValue: null,
      newValue: tenant,
      reason: null,
      requestId,
    });

    return tenant;
  }

  async update(actor: AuthenticatedUser, id: string, input: UpdateTenantInput, requestId: string): Promise<Tenant> {
    requirePermission(actor, "config.manage");
    if (input.name !== undefined && !input.name.trim()) throw new ValidationError("name cannot be empty");
    const before = await this.get(actor, id);

    const after = await this.tenants.update(id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Tenant",
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
