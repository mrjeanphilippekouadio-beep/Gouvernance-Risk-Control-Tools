import type { GovernanceDesignationRepository } from "../domain/repositories/GovernanceDesignationRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type { RoleRepository } from "../domain/repositories/RoleRepository.js";
import type { DesignationKind, GovernanceDesignation } from "../domain/entities/GovernanceDesignation.js";
import { requirePermission } from "../domain/permissions.js";
import { canonicalId } from "../domain/ids.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import { writeAudited } from "./auditedWrite.js";

const MAX_REASON_LENGTH = 500;

export interface DesignateInput {
  kind: DesignationKind;
  userId: string;
  reason: string;
  validUntil?: Date | null;
}

/**
 * DECISION-074 q137 / DECISION-075 q149 (lot D2c): the designated manager and the interim of the Risk Manager.
 * Designating someone opens rights (an interim receives the Risk Manager role when the last one leaves), so it has its
 * own permission, never an administrator's self-designation, and an end date for the interim. Ending is a soft end.
 */
export class GovernanceDesignationService {
  constructor(
    private readonly designations: GovernanceDesignationRepository,
    private readonly audit: AuditRepository,
    private readonly users: UserRepository,
    private readonly roles: Pick<RoleRepository, "listForUser">,
  ) {}

  async list(actor: AuthenticatedUser, includeEnded = false): Promise<GovernanceDesignation[]> {
    requirePermission(actor, "designation.manage");
    return this.designations.list(actor.tenantId, { includeEnded });
  }

  async designate(actor: AuthenticatedUser, input: DesignateInput, requestId: string): Promise<GovernanceDesignation> {
    requirePermission(actor, "designation.manage");
    const userId = canonicalId(input.userId);
    // I-R1 / DECISION-072: nobody designates themselves (the interim gets the Risk Manager role).
    if (actor.userId === userId) throw new ForbiddenError("You cannot designate yourself — ask another administrator");
    const reason = input.reason?.trim();
    if (!reason) throw new ValidationError("A reason is required to designate someone");
    if (reason.length > MAX_REASON_LENGTH) throw new ValidationError(`reason must be at most ${MAX_REASON_LENGTH} characters`);
    const validUntil = input.validUntil ?? null;
    if (input.kind === "RISK_MANAGER_INTERIM" && !validUntil) {
      throw new ValidationError("An end date (validUntil) is required for the Risk Manager interim");
    }
    if (validUntil && !(validUntil.getTime() > Date.now())) throw new ValidationError("validUntil must be in the future");

    const user = await this.users.getById(actor.tenantId, userId);
    if (!user || user.deletedAt) throw new ValidationError("The designated user does not exist or is not active in this tenant");
    if (input.kind === "RISK_MANAGER_INTERIM") {
      const held = await this.roles.listForUser(actor.tenantId, userId);
      // q137: the interim does not come from Audit; already a Risk Manager = nothing to hand over.
      if (held.some((r) => r.systemGroup === "AUDIT")) throw new ValidationError("A member of the Audit group cannot be the Risk Manager interim");
      if (held.some((r) => r.systemGroup === "RISK_MANAGER")) throw new ValidationError("This user is already a Risk Manager");
    }
    if (await this.designations.getActive(actor.tenantId, input.kind)) {
      throw new ConflictError("A designation of this kind is already active; end it first", input.kind);
    }

    // DECISION-079: the designation and its audit row in one transaction.
    return writeAudited(
      this.designations.auditsInTransaction,
      this.audit,
      (audit) =>
        this.designations.create(
          {
            tenantId: actor.tenantId,
            kind: input.kind,
            userId,
            reason,
            validUntil,
            designatedBy: actor.userId, // never client-supplied
          },
          audit,
        ),
      (created) => [
        {
          tenantId: actor.tenantId,
          userId: actor.userId,
          entityType: "GovernanceDesignation",
          entityId: created.id,
          action: "CREATE",
          oldValue: null,
          newValue: { kind: created.kind, userId: created.userId, validUntil: created.validUntil },
          reason,
          requestId,
        },
      ],
    );
  }

  /** Ends the designation (soft). An activated interim keeps the role: removing it is the ordinary role revoke. */
  async end(actor: AuthenticatedUser, id: string, endReason: string, requestId: string): Promise<GovernanceDesignation> {
    requirePermission(actor, "designation.manage");
    const reason = endReason?.trim();
    if (!reason) throw new ValidationError("A reason is required to end a designation");
    if (reason.length > MAX_REASON_LENGTH) throw new ValidationError(`reason must be at most ${MAX_REASON_LENGTH} characters`);
    const before = await this.designations.getById(actor.tenantId, canonicalId(id));
    if (!before) throw new NotFoundError("GovernanceDesignation", id);
    // DECISION-079: the end and its audit row in one transaction (already ended -> null, nothing written).
    const ended = await writeAudited<GovernanceDesignation | null>(
      this.designations.auditsInTransaction,
      this.audit,
      (audit) => this.designations.end(actor.tenantId, before.id, actor.userId, reason, audit),
      (e) =>
        e
          ? [
              {
                tenantId: actor.tenantId,
                userId: actor.userId,
                entityType: "GovernanceDesignation",
                entityId: e.id,
                action: "UPDATE",
                oldValue: { kind: before.kind, userId: before.userId, activatedAt: before.activatedAt, endedAt: null },
                newValue: { endedAt: e.endedAt },
                reason,
                requestId,
              },
            ]
          : [],
    );
    if (!ended) throw new ConflictError("This designation is already ended", id);
    return ended;
  }
}
