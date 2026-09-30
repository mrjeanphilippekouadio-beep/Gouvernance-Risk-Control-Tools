import type {
  AuditMission,
  AuditMissionListFilters,
  CreateAuditMissionInput,
} from "../entities/AuditMission.js";

export interface AuditMissionRepository {
  getById(tenantId: string, id: string): Promise<AuditMission | null>;
  list(tenantId: string, filters?: AuditMissionListFilters): Promise<AuditMission[]>;
  create(input: CreateAuditMissionInput): Promise<AuditMission>;
  /** PLANIFIEE -> EN_COURS, sets actualStartDate. */
  start(tenantId: string, id: string): Promise<AuditMission>;
  /** EN_COURS -> CLOTUREE, sets actualEndDate + closureComment. */
  close(tenantId: string, id: string, comment: string): Promise<AuditMission>;
}
