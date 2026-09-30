import type { RaciAssignmentRepository } from "../domain/repositories/RaciAssignmentRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { RiskScope } from "../domain/entities/DashboardScope.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/**
 * @architect design, 2026-09-30 ("Conception du scope configurable
 * dashboard.executive via RACI", .claude/agent-context/ACTION_ITEMS.md).
 * Resolves an actor's `dashboard.executive` perimeter from RACI +
 * `Risk.ownerId`, at read time — never stored, never cached as a
 * computed perimeter.
 *
 * Seed rule (PO, precise):
 *   - R/A (and `Risk.ownerId === actor.userId`, which counts as an
 *     implicit R/A — it's the field actually populated in real data,
 *     RACI itself is sparse) widen the WHOLE perimeter: the risk's
 *     department in DEPARTMENT mode, the risk's process in PROCESS mode.
 *   - C/I widen ONLY to the process level, in both modes — never to a
 *     whole department, even when the resolver itself is running in
 *     DEPARTMENT mode. A department pulled in via a C/I risk that also
 *     happens to have R/A elsewhere is still fine (it's in departmentIds
 *     via the R/A seed, not the C/I one) — the two seeds are independent
 *     and simply unioned into one RiskScope.
 *
 * This service does not read `users.department_id` (PR #25) — the scope
 * stays derived from RACI + Risk.ownerId only, as designed and confirmed
 * by the PO; wiring that column in is explicitly out of scope here.
 */
export class DashboardScopeResolver {
  constructor(
    private readonly raci: RaciAssignmentRepository,
    private readonly risks: RiskRepository,
  ) {}

  async resolve(actor: AuthenticatedUser): Promise<RiskScope> {
    if (actor.dashboardScopeMode === "GLOBAL") return { mode: "GLOBAL" };

    const [wideRaci, narrowRaci, ownedRisks] = await Promise.all([
      this.raci.listForUser(actor.tenantId, actor.userId, { roles: ["R", "A"] }),
      this.raci.listForUser(actor.tenantId, actor.userId, { roles: ["C", "I"] }),
      this.risks.list(actor.tenantId, { includeArchived: true, ownerId: actor.userId }),
    ]);

    const wideRiskIds = new Set<string>([
      ...wideRaci.filter((a) => a.entityType === "RISK").map((a) => a.entityId),
      ...ownedRisks.map((r) => r.id),
    ]);
    const narrowRiskIds = new Set<string>(
      narrowRaci.filter((a) => a.entityType === "RISK").map((a) => a.entityId),
    );

    // Batched existence + field lookup — listByIds, not N getById calls.
    const [wideRisks, narrowRisks] = await Promise.all([
      this.risks.listByIds(actor.tenantId, [...wideRiskIds]),
      this.risks.listByIds(actor.tenantId, [...narrowRiskIds]),
    ]);

    const wideDepartmentIds = new Set<string>();
    const wideProcessIds = new Set<string>();
    for (const risk of wideRisks) {
      if (risk.ownerDepartmentId) wideDepartmentIds.add(risk.ownerDepartmentId);
      if (risk.processId) wideProcessIds.add(risk.processId);
    }
    const narrowProcessIds = new Set<string>();
    for (const risk of narrowRisks) {
      if (risk.processId) narrowProcessIds.add(risk.processId);
    }

    if (actor.dashboardScopeMode === "PROCESS") {
      // PROCESS mode: R/A widen to the risk's whole process, C/I stay at
      // the individual risk's process too (no narrower unit exists below
      // "process" here) — both seeds land in the same processIds set.
      return { mode: "PROCESS", processIds: [...new Set([...wideProcessIds, ...narrowProcessIds])] };
    }

    // DEPARTMENT mode: R/A widen to the whole department (wideProcessIds
    // is deliberately NOT folded in here — R/A's reach in this mode is
    // department-shaped, not process-shaped). C/I stay process-only,
    // never promoted to their process's department.
    return {
      mode: "DEPARTMENT",
      departmentIds: [...wideDepartmentIds],
      processIds: [...narrowProcessIds],
    };
  }
}
