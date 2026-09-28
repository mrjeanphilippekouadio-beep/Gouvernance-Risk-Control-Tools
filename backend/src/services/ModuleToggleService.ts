import type { ModuleToggleRepository } from "../domain/repositories/ModuleToggleRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import { MODULE_NAMES, type ModuleName, type ModuleToggle } from "../domain/entities/ModuleToggle.js";
import { ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

function isModuleName(value: string): value is ModuleName {
  return (MODULE_NAMES as readonly string[]).includes(value);
}

/**
 * ACT-221 — storage for which modules are toggled off, plus the audit
 * trail for that decision. Does NOT enforce anything: no middleware here
 * actually blocks a request to a disabled module's routes. That's a
 * separate change touching server.ts and every route file (each route
 * file would need to check this before running), explicitly out of
 * scope for this batch per the dispatch brief. Treat GET as informational
 * only until that follow-up exists.
 */
export class ModuleToggleService {
  constructor(
    private readonly toggles: ModuleToggleRepository,
    private readonly audit: AuditRepository,
  ) {}

  /** GET /modules — every known module, enabled by default unless a row says otherwise. */
  async list(actor: AuthenticatedUser): Promise<ModuleToggle[]> {
    requirePermission(actor, "config.read");
    const rows = await this.toggles.list(actor.tenantId);
    const byName = new Map(rows.map((r) => [r.moduleName, r]));
    return MODULE_NAMES.map(
      (name) =>
        byName.get(name) ?? {
          id: "",
          tenantId: actor.tenantId,
          moduleName: name,
          enabled: true,
          updatedBy: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
    );
  }

  /** PATCH /modules/:name/toggle — ACT-221. */
  async toggle(actor: AuthenticatedUser, moduleName: string, enabled: boolean, requestId: string): Promise<ModuleToggle> {
    requirePermission(actor, "config.manage");
    if (!isModuleName(moduleName)) {
      throw new ValidationError(`Unknown module "${moduleName}" — expected one of: ${MODULE_NAMES.join(", ")}`);
    }

    const before = await this.toggles.getByName(actor.tenantId, moduleName);
    const after = await this.toggles.upsert(actor.tenantId, moduleName, enabled, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ModuleToggle",
      entityId: after.id,
      action: "STATUS_CHANGE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }
}
