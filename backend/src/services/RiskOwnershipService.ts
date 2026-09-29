import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type { RiskEvaluationRepository } from "../domain/repositories/RiskEvaluationRepository.js";
import type { RiskStatus } from "../domain/entities/Risk.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

export interface RiskOwnerRiskSummary {
  riskId: string;
  process: string;
  description: string;
  status: RiskStatus;
  /** Latest VALIDATED evaluation's residualScore (falling back to inherentScore) — null if never evaluated/validated. */
  score: number | null;
}

export interface RiskOwnerSummary {
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  risks: RiskOwnerRiskSummary[];
  /** Highest `score` across this owner's risks, null if none has ever been scored. */
  maxScore: number | null;
}

export interface RiskOwnerGroup {
  /** Risk.ownerDepartmentId — null groups risks with no department assigned. */
  departmentId: string | null;
  owners: RiskOwnerSummary[];
}

/**
 * ACT-127: read-only admin view — "lister les pilotes avec leurs risques,
 * score max, statut, groupés par entité/département". Deliberately its
 * own service rather than folded into RiskService: this is a read-model
 * aggregating across Risk + User (+ RiskEvaluation for scoring), not a
 * Risk mutation/business-rule concern.
 *
 * Built by re-using RiskRepository.list + grouping in memory rather than
 * adding a bespoke GROUP BY query — the risk table is not expected to be
 * large enough in this product's single-tenant-per-deployment shape to
 * need one, and this keeps RiskRepository's surface unchanged.
 */
export class RiskOwnershipService {
  constructor(
    private readonly risks: RiskRepository,
    private readonly users: UserRepository,
    /**
     * Optional so this service can be constructed/tested without a real
     * RiskEvaluation store — but without it every risk's `score` is null
     * and `maxScore` is meaningless. server.ts must wire the real
     * repository for ACT-127's "score max" to actually work.
     */
    private readonly evaluations?: RiskEvaluationRepository,
  ) {}

  /** GET /risk-owners — tenant-scoped, active risks only unless includeArchived is set. */
  async listOwners(actor: AuthenticatedUser, options?: { includeArchived?: boolean }): Promise<RiskOwnerGroup[]> {
    requirePermission(actor, "risk.read");

    const risks = await this.risks.list(actor.tenantId, { includeArchived: options?.includeArchived ?? false });
    const ownedRisks = risks.filter((r): r is typeof r & { ownerId: string } => r.ownerId !== null);

    const scoreByRiskId = new Map<string, number | null>();
    if (this.evaluations) {
      await Promise.all(
        ownedRisks.map(async (risk) => {
          const [latest] = await this.evaluations!.listForRisk(actor.tenantId, risk.id, {
            status: "VALIDATED",
            limit: 1,
          });
          scoreByRiskId.set(risk.id, latest?.residualScore ?? latest?.inherentScore ?? null);
        }),
      );
    }

    const groups = new Map<string, Map<string, RiskOwnerSummary>>();
    const userCache = new Map<string, { displayName: string; email: string } | null>();

    for (const risk of ownedRisks) {
      const departmentKey = risk.ownerDepartmentId ?? "";
      if (!groups.has(departmentKey)) groups.set(departmentKey, new Map());
      const ownersInGroup = groups.get(departmentKey)!;

      if (!ownersInGroup.has(risk.ownerId)) {
        if (!userCache.has(risk.ownerId)) {
          const user = await this.users.getById(actor.tenantId, risk.ownerId);
          // PRIV-CH-DASH-001: getById doesn't filter deleted_at (unlike getByEmail/list),
          // so a suspended owner must be treated the same as "not found" here — same
          // fallback path as an unresolved user, never their real name/email.
          const activeUser = user && !user.deletedAt ? user : null;
          userCache.set(risk.ownerId, activeUser ? { displayName: activeUser.displayName, email: activeUser.email } : null);
        }
        const cached = userCache.get(risk.ownerId) ?? null;
        ownersInGroup.set(risk.ownerId, {
          ownerId: risk.ownerId,
          ownerName: cached?.displayName ?? risk.ownerId,
          ownerEmail: cached?.email ?? "",
          risks: [],
          maxScore: null,
        });
      }

      const summary = ownersInGroup.get(risk.ownerId)!;
      const score = scoreByRiskId.get(risk.id) ?? null;
      summary.risks.push({
        riskId: risk.id,
        process: risk.process,
        description: risk.description,
        status: risk.status,
        score,
      });
      if (score !== null && (summary.maxScore === null || score > summary.maxScore)) {
        summary.maxScore = score;
      }
    }

    return [...groups.entries()]
      .map(([departmentKey, ownersInGroup]) => ({
        departmentId: departmentKey === "" ? null : departmentKey,
        owners: [...ownersInGroup.values()].sort((a, b) => a.ownerName.localeCompare(b.ownerName)),
      }))
      .sort((a, b) => (a.departmentId ?? "").localeCompare(b.departmentId ?? ""));
  }
}
