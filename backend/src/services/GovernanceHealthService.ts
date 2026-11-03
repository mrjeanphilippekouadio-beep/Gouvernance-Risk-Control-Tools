import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { GovernanceHealthRepository } from "../domain/repositories/GovernanceHealthRepository.js";
import type { OrganizationProfileRepository } from "../domain/repositories/OrganizationProfileRepository.js";
import { CATALOG_VERSION, PRINCIPLES, type PrincipleEntry, type RequirementLevel } from "../domain/governance/catalog.js";
import {
  classifyOrganization,
  computeProfileGaps,
  DEFAULT_RULE,
  type ClassificationRule,
  type OrganizationSize,
  type ProfileGap,
} from "../domain/governance/classifyOrganization.js";
import { computePanel, offendersOf, type Offender, type OffenderKind, type PrincipleStatus } from "../domain/governance/health.js";

const DAY = 86_400_000;

export interface PanelOffender {
  kind: OffenderKind;
  id: string | null;
  label: string | null;
  count?: number;
  detail?: string;
}

export interface PanelPrinciple {
  id: string;
  title: string;
  severity: PrincipleEntry["severity"];
  status: PrincipleStatus;
  notEvaluableReason: string | null;
  /** Which parts of the A13 rule are evaluated (the others wait for a PO threshold or a feature). */
  covers: string | null;
  consequences: string;
  offenders: PanelOffender[];
  indications: PrincipleEntry["indications"];
  /** Size whose indication applies (= organizationSize.value); null when the size is unknown: nothing highlighted. */
  highlighted: OrganizationSize | null;
  requirementLevel: RequirementLevel | null;
  acceptance: { id: string; reason: string; expiresAt: Date; regime: string | null; acceptedBy: string | null; confirmedBy: string | null } | null;
}

export interface PanelException {
  auditId: string;
  at: Date;
  rule: string;
  entityType: string;
  entityId: string;
  action: string;
  reason: string | null;
  reviewed: boolean;
  ageDays: number;
  /** q180: past the tenant's review delay (q168), not reviewed. Never computed when no delay is set. */
  overdue: boolean;
  /** Named only for who may read the audit trail (R-6.1, q156); `mine` lets a reviewer see an entry is their own. */
  userId: string | null;
  userLabel: string | null;
  mine: boolean;
}

export interface GovernanceHealthView {
  catalogVersion: string;
  computedAt: Date;
  /** q143: the panel shows nothing before this date (no reconstitution). */
  trackedSince: Date;
  organizationSize: { value: OrganizationSize; ruleVersion: string; toConfirm: boolean; justification: string[] } | null;
  profileGaps: ProfileGap[];
  principles: PanelPrinciple[];
  exceptions: { total: number; unreviewed: number; reviewDelayDays: number | null; items: PanelException[] };
}

/**
 * Lot D6 (DECISION-074 R-6): the governance panel. Reads the client's state once, runs the pure detectors
 * (`domain/governance/health.ts`) and assembles the answer; the frontend displays it and never recomputes a status.
 *  - `governancehealth.read` (administrators, Risk Manager, Committee, Audit).
 *  - R-6.1 / q140 / q156: without `audit.read`, no person is named — USER offenders become « Personne 1, 2… » (stable in
 *    this answer only, nothing stored), exception authors and acceptance actors are null; counts stay visible.
 *  - No write, no audit entry (I-P3: reading the panel is not journaled).
 */
export class GovernanceHealthService {
  constructor(
    private readonly health: GovernanceHealthRepository,
    private readonly profiles: Pick<OrganizationProfileRepository, "getActive" | "observe">,
    private readonly rule: ClassificationRule = DEFAULT_RULE,
  ) {}

  async get(actor: AuthenticatedUser): Promise<GovernanceHealthView> {
    requirePermission(actor, "governancehealth.read");
    const now = new Date();
    const [facts, acceptances, active, observed] = await Promise.all([
      this.health.loadFacts(actor.tenantId, now),
      this.health.activeAcceptances(actor.tenantId),
      this.profiles.getActive(actor.tenantId),
      this.profiles.observe(actor.tenantId),
    ]);
    const showNames = actor.roles.includes("audit.read");
    const labels = new Map(facts.users.map((u) => [u.id, u.label]));
    const pseudonyms = new Map<string, string>();
    const person = (id: string): string => {
      if (!pseudonyms.has(id)) pseudonyms.set(id, `Personne ${pseudonyms.size + 1}`);
      return pseudonyms.get(id)!;
    };
    const mask = (o: Offender): PanelOffender => (o.kind === "USER" && !showNames ? { ...o, id: null, label: person(o.id) } : o);

    const classification = active ? classifyOrganization(active.answers, observed, this.rule) : null;
    const size = classification?.value ?? null;
    const principles = computePanel(facts, acceptances).map((r): PanelPrinciple => {
      const entry: PrincipleEntry = PRINCIPLES.find((p) => p.id === r.id)!;
      return {
        id: r.id,
        title: entry.title,
        severity: entry.severity,
        status: r.status,
        notEvaluableReason: r.notEvaluableReason,
        covers: r.covers,
        consequences: entry.consequence,
        offenders: r.offenders.map(mask),
        indications: entry.indications,
        highlighted: size,
        requirementLevel: size ? entry.indications[size].level : null,
        acceptance: r.acceptance
          ? {
              id: r.acceptance.id,
              reason: r.acceptance.reason,
              expiresAt: r.acceptance.expiresAt,
              regime: r.acceptance.regime,
              acceptedBy: showNames ? r.acceptance.acceptedBy : null,
              confirmedBy: showNames ? r.acceptance.confirmedBy : null,
            }
          : null,
      };
    });

    const delay = facts.exceptionReviewDelayDays;
    const items = facts.markedActions.map((m): PanelException => {
      const ageDays = Math.floor((now.getTime() - m.at.getTime()) / DAY);
      return {
        auditId: m.auditId,
        at: m.at,
        rule: m.rule,
        entityType: m.entityType,
        entityId: m.entityId,
        action: m.action,
        reason: m.reason,
        reviewed: m.reviewed,
        ageDays,
        overdue: delay !== null && !m.reviewed && m.rule !== "riskManager.vacancy" && ageDays > delay,
        userId: showNames ? m.userId : null,
        userLabel: showNames ? (labels.get(m.userId) ?? null) : null,
        mine: m.userId === actor.userId,
      };
    });

    return {
      catalogVersion: CATALOG_VERSION,
      computedAt: now,
      trackedSince: facts.trackedSince,
      organizationSize: classification
        ? { value: classification.value, ruleVersion: classification.ruleVersion, toConfirm: classification.toConfirm, justification: classification.justification }
        : null,
      profileGaps: active ? computeProfileGaps(active.answers, observed) : [],
      principles,
      exceptions: { total: facts.markedTotal, unreviewed: facts.unreviewedTotal, reviewDelayDays: delay, items },
    };
  }

  /**
   * R-5 « portée » (lot D5 snapshot): the offenders of a principle now, as keys only (kind + id) — enough to tell a new
   * offender from an accepted one, and no name is stored in the acceptance.
   */
  async offenderKeys(tenantId: string, principleId: string): Promise<Array<{ kind: OffenderKind; id: string }>> {
    const facts = await this.health.loadFacts(tenantId, new Date());
    return offendersOf(facts, principleId).map((o) => ({ kind: o.kind, id: o.id }));
  }
}
