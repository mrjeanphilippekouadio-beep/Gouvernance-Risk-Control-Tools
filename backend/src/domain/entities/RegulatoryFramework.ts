/**
 * ACT-223 — reference registry of regulatory frameworks (BCEAO, ISO
 * 31000, COSO ERM, DORA...). Updated in place, active/inactive only, no
 * linking to Control/Report yet — that's for whoever builds real
 * compliance scoring on top of this registry later (Compliance/A14
 * territory per the dispatch brief), not built here.
 */
export interface RegulatoryFramework {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRegulatoryFrameworkInput {
  tenantId: string;
  name: string;
  description?: string | null;
  active?: boolean;
}

export interface UpdateRegulatoryFrameworkInput {
  name?: string;
  description?: string | null;
  active?: boolean;
}
