export interface TenantRepository {
  getDriveFolderId(tenantId: string): Promise<string>;
}
