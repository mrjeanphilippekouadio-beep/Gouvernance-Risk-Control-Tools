import type { CreateTenantInput, Tenant, UpdateTenantInput } from "../entities/Tenant.js";

export interface TenantRepository {
  getDriveFolderId(tenantId: string): Promise<string>;
  getById(id: string): Promise<Tenant | null>;
  list(): Promise<Tenant[]>;
  create(input: CreateTenantInput): Promise<Tenant>;
  update(id: string, input: UpdateTenantInput): Promise<Tenant>;
}
