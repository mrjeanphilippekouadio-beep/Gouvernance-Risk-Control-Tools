import type { RoleRepository } from "../domain/repositories/RoleRepository.js";
import { SEES_EVERYTHING, type ReadScope } from "../domain/visibility.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/**
 * DECISION-100 lot V0: resolves a reader's `ReadScope` once per request. Members of the Risk Manager, Committee or
 * Audit fixed groups see everything; anyone else sees CLIENT-level resources only — which, until lot V1 writes another
 * level, is every row, so nothing changes. An administrator is not in the list by default (q197, A3).
 */
export class VisibilityResolver {
  constructor(private readonly roles: Pick<RoleRepository, "listForUser">) {}

  async resolve(actor: AuthenticatedUser): Promise<ReadScope> {
    const held = await this.roles.listForUser(actor.tenantId, actor.userId);
    return held.some((r) => r.systemGroup && SEES_EVERYTHING.includes(r.systemGroup))
      ? { all: true }
      : { all: false, userId: actor.userId };
  }
}
