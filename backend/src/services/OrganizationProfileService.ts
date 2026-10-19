import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { OrganizationProfile } from "../domain/entities/OrganizationProfile.js";
import type { OrganizationProfileRepository } from "../domain/repositories/OrganizationProfileRepository.js";
import {
  classifyOrganization,
  computeProfileGaps,
  DEFAULT_RULE,
  sizeRank,
  type Classification,
  type ClassificationRule,
  type ObservedOrganization,
  type ProfileGap,
} from "../domain/governance/classifyOrganization.js";
import {
  ORGANIZATION_QUESTIONS,
  parseOrganizationAnswers,
  QUESTIONNAIRE_VERSION,
  type QuestionDefinition,
} from "../domain/governance/organizationQuestionnaire.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

const NO_OBSERVED: ObservedOrganization = { activeAccounts: 0, riskManagers: 0, committeeMembers: 0, auditMembers: 0 };
export const HISTORY_LIMIT = 50;
export const MAX_REASON_LENGTH = 500;
/** Journal marker (audit_log.governance_exception): the size was lowered with no second validation. */
export const ADMIN_ALONE_EXCEPTION = "orgprofile.adminAlone";

export interface OrganizationProfileView {
  questionnaire: { version: string; questions: readonly QuestionDefinition[] };
  /** The version in force; null until the first one is submitted (then there is no size: nothing is highlighted). */
  active: OrganizationProfile | null;
  /** A reduction waiting for its second confirmation, if any. */
  pending: OrganizationProfile | null;
  /** Every version, most recent first (bounded). */
  history: OrganizationProfile[];
  /** What the tool already sees: accounts and group members. */
  observed: ObservedOrganization;
  /** Size retained, from the active version and the observed data. Always computed here, never by the client. */
  classification: Classification | null;
  /** Size the pending version would give, so the second validator sees the effect. */
  pendingClassification: Classification | null;
  /** Declared versus observed differences (E1 to E4, E7), for the active version. */
  profileGaps: ProfileGap[];
}

function requireReason(reason: unknown, what: string): string {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!trimmed) throw new ValidationError(`A reason is required to ${what}`);
  if (trimmed.length > MAX_REASON_LENGTH) throw new ValidationError(`The reason must be at most ${MAX_REASON_LENGTH} characters`);
  return trimmed;
}

/**
 * DECISION-074 R-2 / DECISION-075 q147: the organization profile questionnaire.
 *  - The administrator (orgprofile.submit) submits a new version with a reason; every version is kept.
 *  - Lowering the size (new class < current class) with a third party present (another active Risk Manager or Committee
 *    member, i.e. a possible approver; Audit never confirms) stays PENDING until someone else holding orgprofile.approve confirms it. With no third party it applies
 *    at once, marked "adminAlone" in the journal. Any other change applies at once.
 *  - Author and approver always come from the authenticated actor, never from the request; nobody decides their own submission.
 *  - The size is computed here on every read (classifyOrganization), the most demanding of declared and observed.
 */
export class OrganizationProfileService {
  constructor(
    private readonly profiles: OrganizationProfileRepository,
    private readonly audit: AuditRepository,
    private readonly rule: ClassificationRule = DEFAULT_RULE,
  ) {}

  async get(actor: AuthenticatedUser): Promise<OrganizationProfileView> {
    requirePermission(actor, "orgprofile.read");
    const [active, pending, history, observed] = await Promise.all([
      this.profiles.getActive(actor.tenantId),
      this.profiles.getPending(actor.tenantId),
      this.profiles.list(actor.tenantId, HISTORY_LIMIT),
      this.profiles.observe(actor.tenantId),
    ]);
    return {
      questionnaire: { version: QUESTIONNAIRE_VERSION, questions: ORGANIZATION_QUESTIONS },
      active,
      pending,
      history,
      observed,
      classification: active ? classifyOrganization(active.answers, observed, this.rule) : null,
      pendingClassification: pending ? classifyOrganization(pending.answers, observed, this.rule) : null,
      profileGaps: active ? computeProfileGaps(active.answers, observed) : [],
    };
  }

  async submit(
    actor: AuthenticatedUser,
    input: { questionnaireVersion: string; answers: unknown; reason: string },
    requestId: string,
  ): Promise<OrganizationProfile> {
    requirePermission(actor, "orgprofile.submit");
    const answers = parseOrganizationAnswers(input.questionnaireVersion, input.answers);
    const reason = requireReason(input.reason, "submit a profile version");

    const pending = await this.profiles.getPending(actor.tenantId);
    if (pending) throw new ConflictError("A profile version is already waiting for its confirmation", pending.id);

    const [active, observed] = await Promise.all([this.profiles.getActive(actor.tenantId), this.profiles.observe(actor.tenantId)]);
    const sizeAfter = classifyOrganization(answers, observed, this.rule).value;
    const sizeBefore = active ? classifyOrganization(active.answers, observed, this.rule).value : null;
    // SEC-PNL-03: a drop of the DECLARED size is a drop even when the observed data still holds the retained size up.
    const declaredBefore = active ? classifyOrganization(active.answers, NO_OBSERVED, this.rule).value : null;
    const declaredAfter = classifyOrganization(answers, NO_OBSERVED, this.rule).value;
    const lowers =
      sizeBefore !== null &&
      declaredBefore !== null &&
      (sizeRank(sizeAfter) < sizeRank(sizeBefore) || sizeRank(declaredAfter) < sizeRank(declaredBefore));
    const thirdParties = lowers ? await this.profiles.countOtherGovernanceMembers(actor.tenantId, actor.userId) : 0;
    const needsConfirmation = lowers && thirdParties > 0;
    const alone = lowers && !needsConfirmation;

    const { profile } = await this.profiles.insertVersion(
      {
        tenantId: actor.tenantId,
        questionnaireVersion: input.questionnaireVersion,
        answers,
        reason,
        submittedBy: actor.userId,
        status: needsConfirmation ? "PENDING" : "ACTIVE",
        regime: alone ? "ALONE" : null,
        expectedActiveId: active?.id ?? null,
      },
      ({ profile: created, superseded }) => [
        {
          tenantId: actor.tenantId,
          userId: actor.userId,
          entityType: "OrganizationProfile",
          entityId: created.id,
          action: "SUBMIT",
          oldValue: superseded ?? active,
          newValue: { ...created, sizeBefore, sizeAfter, lowersSize: lowers, otherGovernanceMembers: thirdParties },
          reason,
          requestId,
          governanceException: alone ? ADMIN_ALONE_EXCEPTION : null,
        },
      ],
    );
    return profile;
  }

  async approve(actor: AuthenticatedUser, id: string, requestId: string): Promise<OrganizationProfile> {
    requirePermission(actor, "orgprofile.approve");
    const pending = await this.getPendingOrThrow(actor, id);
    const { profile } = await this.profiles.approve(actor.tenantId, id, actor.userId, ({ profile: approved, superseded }) => [
      {
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "OrganizationProfile",
        entityId: id,
        action: "APPROVE",
        oldValue: pending,
        newValue: { ...approved, supersededId: superseded?.id ?? null },
        reason: null,
        requestId,
      },
    ]);
    return profile;
  }

  async reject(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<OrganizationProfile> {
    requirePermission(actor, "orgprofile.approve");
    const why = requireReason(reason, "reject a profile version");
    const pending = await this.getPendingOrThrow(actor, id);
    return this.profiles.reject(actor.tenantId, id, actor.userId, why, (rejected) => [
      {
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "OrganizationProfile",
        entityId: id,
        action: "REJECT",
        oldValue: pending,
        newValue: rejected,
        reason: why,
        requestId,
      },
    ]);
  }

  /** Tenant-scoped lookup, still PENDING, and never the actor's own submission (maker-checker, no exception). */
  private async getPendingOrThrow(actor: AuthenticatedUser, id: string): Promise<OrganizationProfile> {
    const profile = await this.profiles.getById(actor.tenantId, id);
    if (!profile) throw new NotFoundError("OrganizationProfile", id);
    if (profile.status !== "PENDING") throw new ValidationError(`This profile version has already been decided (${profile.status})`);
    if (profile.submittedBy === actor.userId) {
      throw new ForbiddenError("The author of a profile version cannot confirm or reject it (maker-checker)");
    }
    return profile;
  }
}
