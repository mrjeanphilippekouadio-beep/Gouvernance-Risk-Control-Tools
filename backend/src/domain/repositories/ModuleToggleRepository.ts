import type { ModuleName, ModuleToggle } from "../entities/ModuleToggle.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";

export interface ModuleToggleRepository {
  /** QA-SWP-01 / F-SWP-02: true when `upsert` inserts the events given by `audit` in the SAME transaction as the write. Absent = the service records the audit after the write (test fakes). */
  readonly auditsInTransaction?: boolean;
  /** Only rows explicitly toggled at least once — a module absent here defaults to enabled (see ModuleToggleService.list). */
  list(tenantId: string): Promise<ModuleToggle[]>;
  getByName(tenantId: string, moduleName: ModuleName): Promise<ModuleToggle | null>;
  /** `audit` receives the row as it was read under lock inside the transaction (`before`, null if never toggled) and the new row. */
  upsert(
    tenantId: string,
    moduleName: ModuleName,
    enabled: boolean,
    updatedBy: string,
    audit?: TransactionalAudit<{ before: ModuleToggle | null; after: ModuleToggle }>,
  ): Promise<ModuleToggle>;
}
