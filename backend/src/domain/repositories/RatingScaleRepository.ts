import type {
  CreateRatingScaleInput,
  ImpactAxesConfig,
  MasteryScaleConfig,
  RatingScale,
  ScaleLevel,
  ScoreThreshold,
} from "../entities/RatingScale.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";

export interface RatingScaleRepository {
  /**
   * F-D044-03: true when every mutating method inserts the events given by `audit` in the SAME
   * transaction as the write (a failing audit insert rolls the write back). Absent = the service
   * records the audit after the write (test fakes).
   */
  readonly auditsInTransaction?: boolean;
  getById(tenantId: string, id: string): Promise<RatingScale | null>;
  list(tenantId: string, options?: { includeArchived?: boolean }): Promise<RatingScale[]>;
  create(input: CreateRatingScaleInput, audit?: TransactionalAudit<RatingScale>): Promise<RatingScale>;

  updateThresholds(tenantId: string, id: string, thresholds: ScoreThreshold[], audit?: TransactionalAudit<RatingScale>): Promise<RatingScale>;
  updateImpactAxes(tenantId: string, id: string, config: ImpactAxesConfig, audit?: TransactionalAudit<RatingScale>): Promise<RatingScale>;
  updateVelocity(tenantId: string, id: string, levels: ScaleLevel[], audit?: TransactionalAudit<RatingScale>): Promise<RatingScale>;
  updatePersistence(tenantId: string, id: string, levels: ScaleLevel[], audit?: TransactionalAudit<RatingScale>): Promise<RatingScale>;
  updateMastery(tenantId: string, id: string, config: MasteryScaleConfig, audit?: TransactionalAudit<RatingScale>): Promise<RatingScale>;

  /**
   * Activates `id` and archives whatever other scale was ACTIVE for the
   * same tenant, atomically — a tenant must never have more than one
   * ACTIVE rating scale at a time (ACT-176).
   */
  activateAndArchivePrevious(tenantId: string, id: string, audit?: TransactionalAudit<RatingScale>): Promise<RatingScale>;

  softDelete(tenantId: string, id: string, deletedBy: string, reason: string, audit?: TransactionalAudit<void>): Promise<void>;
}
