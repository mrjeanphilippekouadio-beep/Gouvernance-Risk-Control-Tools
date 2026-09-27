import type {
  CreateRatingScaleInput,
  ImpactAxesConfig,
  MasteryScaleConfig,
  RatingScale,
  ScaleLevel,
  ScoreThreshold,
} from "../entities/RatingScale.js";

export interface RatingScaleRepository {
  getById(tenantId: string, id: string): Promise<RatingScale | null>;
  list(tenantId: string, options?: { includeArchived?: boolean }): Promise<RatingScale[]>;
  create(input: CreateRatingScaleInput): Promise<RatingScale>;

  updateThresholds(tenantId: string, id: string, thresholds: ScoreThreshold[]): Promise<RatingScale>;
  updateImpactAxes(tenantId: string, id: string, config: ImpactAxesConfig): Promise<RatingScale>;
  updateVelocity(tenantId: string, id: string, levels: ScaleLevel[]): Promise<RatingScale>;
  updatePersistence(tenantId: string, id: string, levels: ScaleLevel[]): Promise<RatingScale>;
  updateMastery(tenantId: string, id: string, config: MasteryScaleConfig): Promise<RatingScale>;

  /**
   * Activates `id` and archives whatever other scale was ACTIVE for the
   * same tenant, atomically — a tenant must never have more than one
   * ACTIVE rating scale at a time (ACT-176).
   */
  activateAndArchivePrevious(tenantId: string, id: string): Promise<RatingScale>;

  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
}
