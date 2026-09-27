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
}
