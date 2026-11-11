import type { TenantRepository } from "../domain/repositories/TenantRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { CreateTenantInput, Tenant, UpdateTenantInput } from "../domain/entities/Tenant.js";
import type { AuditAction } from "../domain/entities/AuditEvent.js";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requireSuperAdmin } from "../domain/permissions.js";
import { isAcceptableReason } from "../domain/governance/selfValidation.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/** QA-F8-01: a client name is bounded. */
export const MAX_TENANT_NAME = 120;
const MAX_REASON = 500;

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * ACT-222 — see Tenant.ts's file header: this is the one service in the codebase that does NOT scope its reads/writes
 * by `actor.tenantId`, because a Tenant is the scoping boundary itself.
 *
 * q260 (DECISION-125, SEC-F8-01): gated on the PLATFORM super-administrator status (`actor.isSuperAdmin`, from the
 * SUPER_ADMIN_EMAILS server list, compared with the authenticated e-mail), never on a tenant permission: no tenant role
 * can grant it. Every method requires it first. A super-administrator manages the clients; nothing else in the API reads
 * or modifies another tenant (every other service stays scoped by `actor.tenantId`).
 *
 * q261: deactivation and reactivation are dedicated actions (never `update`), reason mandatory, reactivation by a super-
 * administrator other than the one who deactivated (maker-checker, read from the target tenant's audit trail).
 * Every action is audited in the actor's tenant AND in the targeted tenant (so the client's own auditors see it).
 */
export class TenantService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly audit: AuditRepository,
  ) {}

  async list(actor: AuthenticatedUser): Promise<Tenant[]> {
    requireSuperAdmin(actor);
    return this.tenants.list();
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Tenant> {
    requireSuperAdmin(actor);
    const tenant = await this.tenants.getById(id);
    if (!tenant) throw new NotFoundError("Tenant", id);
    return tenant;
  }

  async create(actor: AuthenticatedUser, input: CreateTenantInput, requestId: string): Promise<Tenant> {
    requireSuperAdmin(actor);
    const name = this.validName(input.name);
    await this.assertNameFree(name, null);

    const tenant = await this.tenants.create({ ...input, name });
    await this.record(actor, tenant, "CREATE", null, tenant, null, requestId);
    return tenant;
  }

  /** Name and deployment mode only. `active` is NOT updatable here (SEC-F8-02): see deactivate/reactivate. */
  async update(actor: AuthenticatedUser, id: string, input: UpdateTenantInput, requestId: string): Promise<Tenant> {
    requireSuperAdmin(actor);
    if ((input as { active?: unknown }).active !== undefined) {
      throw new ValidationError("Use the deactivate / reactivate actions to change a client's status");
    }
    const before = await this.get(actor, id);
    const patch: UpdateTenantInput = {};
    if (input.name !== undefined) {
      patch.name = this.validName(input.name);
      await this.assertNameFree(patch.name, id);
    }
    if (input.deploymentMode !== undefined) patch.deploymentMode = input.deploymentMode;

    const after = await this.tenants.update(id, patch);
    await this.record(actor, after, "UPDATE", before, after, null, requestId);
    return after;
  }

  /** q261: dedicated, reason mandatory, never one's own client (the actor would cut their own access and nobody could reverse it). */
  async deactivate(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<Tenant> {
    requireSuperAdmin(actor);
    const why = this.validReason(reason);
    if (id === actor.tenantId) throw new ValidationError("A super-administrator cannot deactivate their own client");
    const before = await this.get(actor, id);
    if (!before.active) throw new ConflictError("This client is already inactive");

    const after = await this.tenants.update(id, { active: false });
    await this.record(actor, after, "STATUS_CHANGE", before, after, why, requestId);
    return after;
  }

  /** q261: second person + reason. The deactivator is read from the client's audit trail (no migration, append-only source). */
  async reactivate(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<Tenant> {
    requireSuperAdmin(actor);
    const why = this.validReason(reason);
    const before = await this.get(actor, id);
    if (before.active) throw new ConflictError("This client is already active");

    const history = await this.audit.listForEntity(id, "Tenant", id);
    const lastDeactivation = history
      .filter((e) => e.action === "STATUS_CHANGE" && (e.newValue as { active?: unknown } | null)?.active === false)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
    if (lastDeactivation && lastDeactivation.userId === actor.userId) {
      throw new ValidationError("The reactivation must be done by a different super-administrator than the one who deactivated");
    }

    const after = await this.tenants.update(id, { active: true });
    await this.record(actor, after, "STATUS_CHANGE", before, after, why, requestId);
    return after;
  }

  private validName(raw: string): string {
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) throw new ValidationError("name is required");
    if (name.length > MAX_TENANT_NAME) throw new ValidationError(`name must be at most ${MAX_TENANT_NAME} characters`);
    return name;
  }

  private validReason(raw: string): string {
    const reason = raw.trim();
    if (!reason) throw new ValidationError("reason is required");
    if (reason.length > MAX_REASON) throw new ValidationError(`reason must be at most ${MAX_REASON} characters`);
    if (!isAcceptableReason(reason)) throw new ValidationError("reason contains invalid characters or no visible character");
    return reason;
  }

  /** QA-F8-01: no two clients with the same name (case/space-insensitive). Check-then-write: no unique index (no migration). */
  private async assertNameFree(name: string, exceptId: string | null): Promise<void> {
    const wanted = normalizeName(name);
    const clash = (await this.tenants.list()).find((t) => t.id !== exceptId && normalizeName(t.name) === wanted);
    if (clash) throw new ConflictError("A client with this name already exists", clash.id);
  }

  private async record(
    actor: AuthenticatedUser,
    target: Tenant,
    action: AuditAction,
    before: Tenant | null,
    after: Tenant,
    reason: string | null,
    requestId: string,
  ): Promise<void> {
    const base = {
      userId: actor.userId,
      entityType: "Tenant",
      entityId: target.id,
      action,
      oldValue: before,
      newValue: after,
      reason,
      requestId,
    };
    await this.audit.record({ ...base, tenantId: actor.tenantId });
    if (target.id !== actor.tenantId) await this.audit.record({ ...base, tenantId: target.id });
  }
}
