import type { ActionLink, ActionPlan, ActionPlanListFilters, CreateActionPlanInput } from "../entities/ActionPlan.js";

export interface ActionPlanRepository {
  getById(tenantId: string, id: string): Promise<ActionPlan | null>;
  list(tenantId: string, filters?: ActionPlanListFilters): Promise<ActionPlan[]>;
  create(input: CreateActionPlanInput): Promise<ActionPlan>;
  /** ACT-191: narrow — sets progressPercent + the latest progress comment only, never a generic field-by-field update. */
  updateProgress(tenantId: string, id: string, progressPercent: number, comment: string | null): Promise<ActionPlan>;
  /** ACT-192: the only way status can move PLANIFIEE -> EN_COURS. */
  start(tenantId: string, id: string): Promise<ActionPlan>;
  /** ACT-195: the only way status can move to the terminal TERMINEE state. Evidence + closedBy are mandatory. */
  close(tenantId: string, id: string, closedBy: string, evidenceId: string, comment: string | null): Promise<ActionPlan>;
  /** ACT-194: current links for this action. */
  listLinks(tenantId: string, actionId: string): Promise<ActionLink[]>;
  /** Pure link-table exception (see control_risks in CLAUDE.md): rebuilt by DELETE + INSERT, tenant-scoped. */
  replaceLinks(tenantId: string, actionId: string, links: ActionLink[]): Promise<void>;
  /**
   * DECISION-003 (.claude/agent-context/ACTION_ITEMS.md, 2026-09-29): closes
   * the N+1 gap the architecture audit flagged for any future Risk 360/
   * Dispositif read model — a risk's action plans are reachable two ways
   * (directly, `source_type = 'RISK' AND source_id = riskId`, or through
   * `action_links`, a separate cross-reference table), and before this
   * method neither path was queryable without either listing every action
   * plan in the tenant or issuing one query per action to inspect its
   * links. Returns the union of both, no duplicates, single query.
   */
  listForRisk(tenantId: string, riskId: string): Promise<ActionPlan[]>;
}
