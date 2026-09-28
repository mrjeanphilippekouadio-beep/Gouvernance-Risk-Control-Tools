/**
 * ACT-222 — "entités du groupe" (multi-tenant group management).
 * Unlike every other entity in this codebase, a Tenant is not itself
 * scoped by a `tenant_id` — it IS the boundary other entities are scoped
 * by. TenantService therefore does not filter by `actor.tenantId`; it
 * gates on the `config.manage` permission alone ("Super-admin
 * uniquement" per the backlog). Flagged for Architect (A05) review: this
 * is the first cross-tenant-visible resource in the codebase, a
 * different trust model from every other service here.
 */
export type DeploymentMode = "managed_saas" | "customer_managed" | "on_premise";

export interface Tenant {
  id: string;
  name: string;
  deploymentMode: DeploymentMode;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantInput {
  name: string;
  deploymentMode?: DeploymentMode;
}

export interface UpdateTenantInput {
  name?: string;
  deploymentMode?: DeploymentMode;
  active?: boolean;
}
