import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import type { RatingScaleRepository } from "../domain/repositories/RatingScaleRepository.js";
import type { RiskFrameworkRepository } from "../domain/repositories/RiskFrameworkRepository.js";
import type { RatingScale } from "../domain/entities/RatingScale.js";
import type { RiskFrameworkVersion } from "../domain/entities/RiskFramework.js";
import { PROCESS_LEVEL_BY_RANK, type Process } from "../domain/entities/Process.js";

/** B-6b (spec §3): thrown by a write path that the Dispositif now owns. */
export const FRAMEWORK_OWNS_SETTING_MESSAGE = "Ce réglage est porté par le Dispositif : créez une nouvelle version";
/** B-6b (spec §7/§8.0): no fallback to `configs` nor to the old "ACTIVE scale". */
export const NO_APPLICABLE_FRAMEWORK_MESSAGE = "Aucun Dispositif actif ne s'applique à ce risque";

export interface ApplicableFramework {
  frameworkId: string;
  version: RiskFrameworkVersion;
  scale: RatingScale;
}

export interface FrameworkResolutionDeps {
  frameworks: Pick<RiskFrameworkRepository, "getDefaultFramework" | "getProcessFrameworkId" | "getActiveVersion">;
  ratingScales: Pick<RatingScaleRepository, "getById">;
  /** Without it the process chain is not walked: only the tenant default applies. */
  processes?: Pick<ProcessRepository, "getById">;
}

/**
 * Spec §7. Internal: no permission check, the callers have already authorized the act (same reasoning as
 * RiskEvaluationService.resolveEvaluationModeForRisk). Walks up from `processId` to its PROCESS-level ancestor;
 * if that process is attached to a Dispositif, that one applies, otherwise the tenant's default Dispositif.
 * Returns null when there is no Dispositif, no ACTIVE version, or its scale is gone: the write callers then
 * answer NO_APPLICABLE_FRAMEWORK_MESSAGE. Never a fallback to `configs`.
 */
export async function resolveApplicableVersion(
  deps: FrameworkResolutionDeps,
  tenantId: string,
  processId: string | null,
): Promise<ApplicableFramework | null> {
  let frameworkId: string | null = null;
  if (processId && deps.processes) {
    let current: Process | null = await deps.processes.getById(tenantId, processId);
    for (let i = 0; current && i < PROCESS_LEVEL_BY_RANK.length; i++) {
      if (current.level === "PROCESS") {
        frameworkId = await deps.frameworks.getProcessFrameworkId(tenantId, current.id);
        break;
      }
      current = current.parentId ? await deps.processes.getById(tenantId, current.parentId) : null;
    }
  }
  if (!frameworkId) frameworkId = (await deps.frameworks.getDefaultFramework(tenantId))?.id ?? null;
  if (!frameworkId) return null;

  const version = await deps.frameworks.getActiveVersion(tenantId, frameworkId);
  if (!version) return null;
  const scale = await deps.ratingScales.getById(tenantId, version.ratingScaleId);
  return scale ? { frameworkId, version, scale } : null;
}
