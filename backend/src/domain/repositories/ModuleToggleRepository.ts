import type { ModuleName, ModuleToggle } from "../entities/ModuleToggle.js";

export interface ModuleToggleRepository {
  /** Only rows explicitly toggled at least once — a module absent here defaults to enabled (see ModuleToggleService.list). */
  list(tenantId: string): Promise<ModuleToggle[]>;
  getByName(tenantId: string, moduleName: ModuleName): Promise<ModuleToggle | null>;
  upsert(tenantId: string, moduleName: ModuleName, enabled: boolean, updatedBy: string): Promise<ModuleToggle>;
}
