import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { GovernancePrincipleAcceptanceRepository } from "../domain/repositories/GovernanceReviewRepositories.js";
import {
  PRINCIPLE_ACCEPTANCE_ALONE_EXCEPTION,
  type GovernancePrincipleAcceptance,
} from "../domain/entities/GovernanceReviews.js";
import { isAcceptableReason, type EligibleValidatorQuery } from "../domain/governance/selfValidation.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { ConfigRepository } from "../domain/repositories/ConfigRepository.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

export const MAX_ACCEPTANCE_REASON_LENGTH = 500;
export const ACCEPTANCE_LIST_LIMIT = 100;
/** Version of the A13 principles catalog the acceptance refers to (the catalog is not yet in code: D6). */
export const PRINCIPLE_CATALOG_VERSION = "0.3";
const PRINCIPLE_ID = /^[A-Z]+(-[A-Z0-9]+)+$/;

/** What the list shows. Names (ids) only for who may read the audit trail (q140, R-6.1); `mine` replaces them otherwise. */
export type AcceptanceView = Omit<GovernancePrincipleAcceptance, "acceptedBy" | "confirmedBy" | "endedBy"> & {
  acceptedBy: string | null;
  confirmedBy: string | null;
  endedBy: string | null;
  mine: boolean;
};

/**
 * DECISION-074 R-5 / q138 (lot D5): accepting, for a limited time, a governance principle that is not respected.
 *  - `governanceprinciple.accept` (administrator, Risk Manager). Another person able to confirm (holder of
 *    `governanceprinciple.acceptance.confirm`: Risk Manager or Committee, never the Audit — q157) => PENDING until they
 *    confirm; nobody else => ACTIVE at once, regime ALONE, journal marker `principle.acceptance.alone`.
 *  - Confirm / reject: `.acceptance.confirm`, never the acceptor (service + CHECK). Early end: `.acceptance.revoke` (terminal
 *    transition, its own gate); an acceptance whose date passed is closed REVOKED when the principle is accepted again.
 *  - Acceptor / confirmer / ender always come from the authenticated actor.
 *  - Maximum duration (q169, DECISION-083): for an acceptance made ALONE, the tenant's `acceptanceMaxDays` when
 *    configured; none otherwise (I-R6: never invented). A confirmed one only needs a date in the future.
 */
export class GovernancePrincipleAcceptanceService {
  constructor(
    private readonly acceptances: GovernancePrincipleAcceptanceRepository,
    private readonly audit: AuditRepository,
    private readonly eligible: EligibleValidatorQuery,
    /** Offenders at acceptance time (R-5 "portée"). D6 plugs the detectors in; until then the snapshot is empty. */
    private readonly snapshotOffenders?: (tenantId: string, principleId: string) => Promise<unknown[]>,
    /** q169: reads `acceptanceMaxDays`. Optional: without it no maximum applies, as before. */
    private readonly configs?: Pick<ConfigRepository, "getByTenant">,
  ) {}

  async list(actor: AuthenticatedUser): Promise<AcceptanceView[]> {
    requirePermission(actor, "governancehealth.read");
    const rows = await this.acceptances.list(actor.tenantId, ACCEPTANCE_LIST_LIMIT);
    return rows.map((a) => this.view(actor, a));
  }

  /** R-6.1 (I05): the same masking on the list and on every answer (accept / confirm / reject / revoke). */
  private view(actor: AuthenticatedUser, a: GovernancePrincipleAcceptance): AcceptanceView {
    const showNames = actor.roles.includes("audit.read");
    return {
      ...a,
      acceptedBy: showNames ? a.acceptedBy : null,
      confirmedBy: showNames ? a.confirmedBy : null,
      endedBy: showNames ? a.endedBy : null,
      mine: a.acceptedBy === actor.userId,
    };
  }

  async accept(
    actor: AuthenticatedUser,
    input: { principleId: string; reason: string; expiresAt: Date },
    requestId: string,
  ): Promise<AcceptanceView> {
    requirePermission(actor, "governanceprinciple.accept");
    if (!PRINCIPLE_ID.test(input.principleId ?? "") || input.principleId.length > 40) throw new ValidationError("Unknown principle id");
    const reason = requireReason(input.reason, "accept a principle");
    if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime()) || input.expiresAt.getTime() <= Date.now()) {
      throw new ValidationError("expiresAt must be a date in the future");
    }

    const thirdPartyExists = await this.eligible.existsOther(actor.tenantId, actor.userId, "governanceprinciple.acceptance.confirm");
    const snapshot = (await this.snapshotOffenders?.(actor.tenantId, input.principleId)) ?? [];
    const alone = !thirdPartyExists;
    // q169 (DECISION-083): the maximum duration frames an acceptance made ALONE; a confirmed one is checked by a third party.
    const maxDays = alone ? ((await this.configs?.getByTenant(actor.tenantId))?.acceptanceMaxDays ?? null) : null;
    if (maxDays !== null && input.expiresAt.getTime() > Date.now() + maxDays * 86_400_000) {
      throw new ValidationError(`An acceptance made alone can last at most ${maxDays} days (tenant setting)`);
    }

    const { acceptance } = await this.acceptances.create(
      {
        tenantId: actor.tenantId,
        principleId: input.principleId,
        catalogVersion: PRINCIPLE_CATALOG_VERSION,
        offendersSnapshot: snapshot,
        reason,
        expiresAt: input.expiresAt,
        acceptedBy: actor.userId, // never client-supplied
        status: alone ? "ACTIVE" : "PENDING",
        regime: alone ? "ALONE" : null,
      },
      ({ acceptance: created, expiredClosed }) => [
        ...(expiredClosed
          ? [{
              tenantId: actor.tenantId,
              userId: actor.userId,
              entityType: "GovernancePrincipleAcceptance",
              entityId: expiredClosed.id,
              action: "CLOSE" as const,
              oldValue: { previousStatus: expiredClosed.regime ? "ACTIVE" : "PENDING", expiresAt: expiredClosed.expiresAt },
              newValue: expiredClosed,
              reason: "Expired; replaced by a new acceptance",
              requestId,
            }]
          : []),
        {
          tenantId: actor.tenantId,
          userId: actor.userId,
          entityType: "GovernancePrincipleAcceptance",
          entityId: created.id,
          action: "CREATE" as const,
          oldValue: null,
          newValue: { ...created, thirdPartyAvailable: thirdPartyExists },
          reason,
          requestId,
          governanceException: alone ? PRINCIPLE_ACCEPTANCE_ALONE_EXCEPTION : null,
        },
      ],
    );
    return this.view(actor, acceptance);
  }

  async confirm(actor: AuthenticatedUser, id: string, requestId: string): Promise<AcceptanceView> {
    requirePermission(actor, "governanceprinciple.acceptance.confirm");
    const pending = await this.getPendingForThirdParty(actor, id, true);
    const confirmedRow = await this.acceptances.confirm(actor.tenantId, id, actor.userId, (confirmed) => [
      {
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "GovernancePrincipleAcceptance",
        entityId: id,
        action: "APPROVE",
        oldValue: pending,
        newValue: confirmed,
        reason: null,
        requestId,
      },
    ]);
    return this.view(actor, confirmedRow);
  }

  async reject(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<AcceptanceView> {
    requirePermission(actor, "governanceprinciple.acceptance.confirm");
    const why = requireReason(reason, "reject an acceptance");
    const pending = await this.getPendingForThirdParty(actor, id, false);
    const rejectedRow = await this.acceptances.end(actor.tenantId, id, "REJECTED", actor.userId, why, (rejected) => [
      {
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "GovernancePrincipleAcceptance",
        entityId: id,
        action: "REJECT",
        oldValue: pending,
        newValue: rejected,
        reason: why,
        requestId,
      },
    ]);
    return this.view(actor, rejectedRow);
  }

  /** Early end. A terminal transition: its own permission, mandatory reason. The acceptor may end their own acceptance. */
  async revoke(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<AcceptanceView> {
    requirePermission(actor, "governanceprinciple.acceptance.revoke");
    const why = requireReason(reason, "end an acceptance");
    const current = await this.acceptances.getById(actor.tenantId, id);
    if (!current) throw new NotFoundError("GovernancePrincipleAcceptance", id);
    if (current.status !== "PENDING" && current.status !== "ACTIVE") {
      throw new ConflictError(`This acceptance has already ended (${current.status})`, id);
    }
    const revokedRow = await this.acceptances.end(actor.tenantId, id, "REVOKED", actor.userId, why, (revoked) => [
      {
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "GovernancePrincipleAcceptance",
        entityId: id,
        action: "CLOSE",
        oldValue: current,
        newValue: revoked,
        reason: why,
        requestId,
      },
    ]);
    return this.view(actor, revokedRow);
  }

  /** Tenant-scoped lookup, still PENDING, and never the actor's own acceptance (maker-checker, no exception). */
  private async getPendingForThirdParty(actor: AuthenticatedUser, id: string, mustBeValid: boolean): Promise<GovernancePrincipleAcceptance> {
    const a = await this.acceptances.getById(actor.tenantId, id);
    if (!a) throw new NotFoundError("GovernancePrincipleAcceptance", id);
    if (a.status !== "PENDING") throw new ConflictError(`This acceptance has already been decided (${a.status})`, id);
    if (a.acceptedBy === actor.userId) throw new ForbiddenError("The author of an acceptance cannot confirm or reject it (maker-checker)");
    if (mustBeValid && a.expiresAt.getTime() <= Date.now()) throw new ValidationError("This acceptance has expired and can no longer be confirmed");
    return a;
  }
}

function requireReason(reason: unknown, what: string): string {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!trimmed || !isAcceptableReason(trimmed)) throw new ValidationError(`A reason is required to ${what}`);
  if (trimmed.length > MAX_ACCEPTANCE_REASON_LENGTH) throw new ValidationError(`The reason must be at most ${MAX_ACCEPTANCE_REASON_LENGTH} characters`);
  return trimmed;
}
