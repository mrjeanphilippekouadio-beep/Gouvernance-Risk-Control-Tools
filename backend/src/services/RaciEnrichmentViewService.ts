import type { RiskService } from "./RiskService.js";
import type { ControlService } from "./ControlService.js";
import type { ActionPlanService } from "./ActionPlanService.js";
import type { RaciAssignmentService } from "./RaciAssignmentService.js";
import type { Risk } from "../domain/entities/Risk.js";
import type { Control } from "../domain/entities/Control.js";
import type { ActionPlanView } from "../domain/entities/ActionPlan.js";
import type { RaciAssignment } from "../domain/entities/RaciAssignment.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

export interface RiskWithRaci {
  risk: Risk;
  raci: RaciAssignment[];
}

export interface ControlWithRaci {
  control: Control;
  raci: RaciAssignment[];
}

export interface ActionPlanWithRaci {
  actionPlan: ActionPlanView;
  raci: RaciAssignment[];
}

/**
 * Lot 1 RACI follow-up (PO-confirmed, .claude/agent-context/SHARED_LOG.md
 * 2026-09-28 entries on RACI's "non câblé" gap): read-only composition
 * (`*ViewService` convention, ADR-003 Décision 2) that lets a Risk/
 * Control/ActionPlan reader also see who is R/A/C/I on that object,
 * without ever making that assignment a condition of anything.
 *
 * RACI STAYS DECLARATIVE — this is the one deliberate departure from the
 * ADR-003 Décision 2 template (which composes repositories directly, see
 * RiskEvaluationViewService): here each method calls the entity's own
 * write service's `get()` and `RaciAssignmentService.list()` instead of
 * their repositories directly. Two reasons, not a shortcut:
 *   - `ActionPlanService.get()` returns `ActionPlanView`, computed from
 *     the raw `ActionPlan` row by a *private* `toView()` — there is no
 *     repository-level way to get that computed shape (e.g.
 *     `computedStatus`) without duplicating that private logic here.
 *   - `RaciAssignmentService.list()` already owns the `raci.read`
 *     permission check and the `entityType` whitelist validation — going
 *     around it straight to `RaciAssignmentRepository.listForEntity`
 *     would duplicate both checks for no benefit (this service performs
 *     no write and no state transition, so reusing the write services'
 *     read paths carries none of the side-effect risk that composing
 *     write *methods* would).
 *
 * Each method call two permissions explicitly by construction (the
 * entity's own `<x>.read` inside its service, then `raci.read` inside
 * RaciAssignmentService) — never the other way around: a caller who can
 * read the entity but lacks `raci.read` gets a ForbiddenError from the
 * `raci.list` call, not a silently-empty RACI list. A caller with
 * `raci.read` but not e.g. `risk.read` never even reaches the RACI
 * lookup, because `risks.get()` throws first.
 *
 * NEVER let a RACI role gate a write here or anywhere else — RACI
 * records business responsibility, never a technical permission
 * (Lot 1 doc comment on RaciAssignmentService, IAM ≠ RACI distinction 3,
 * GRC_Target_Domain_Model.md §0.1). This service only ever reads.
 */
export class RaciEnrichmentViewService {
  constructor(
    private readonly risks: RiskService,
    private readonly controls: ControlService,
    private readonly actionPlans: ActionPlanService,
    private readonly raci: RaciAssignmentService,
  ) {}

  async getRiskWithRaci(actor: AuthenticatedUser, id: string): Promise<RiskWithRaci> {
    const risk = await this.risks.get(actor, id);
    const raci = await this.raci.list(actor, "RISK", id);
    return { risk, raci };
  }

  async getControlWithRaci(actor: AuthenticatedUser, id: string): Promise<ControlWithRaci> {
    const control = await this.controls.get(actor, id);
    const raci = await this.raci.list(actor, "CONTROL", id);
    return { control, raci };
  }

  async getActionPlanWithRaci(actor: AuthenticatedUser, id: string): Promise<ActionPlanWithRaci> {
    const actionPlan = await this.actionPlans.get(actor, id);
    const raci = await this.raci.list(actor, "ACTION_PLAN", id);
    return { actionPlan, raci };
  }
}
