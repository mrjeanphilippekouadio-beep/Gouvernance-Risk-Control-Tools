import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import { NotFoundError } from "../domain/errors/DomainErrors.js";
import { readerScope } from "../domain/visibility.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/**
 * Lot V1 (DECISION-102, q193): what inherits from a risk (evaluations, treatment decisions, escalations, KRIs and their
 * measures) is readable only when its risk is. One SQL query per call (`hiddenIds`), never a per-row lookup. A repository
 * without `hiddenIds` (test fakes) holds no restricted risk: nothing is hidden.
 */
export async function hiddenRiskIds(
  risks: Pick<RiskRepository, "hiddenIds"> | undefined,
  actor: AuthenticatedUser,
  riskIds: Array<string | null | undefined>,
): Promise<Set<string>> {
  const ids = [...new Set(riskIds.filter((id): id is string => !!id))];
  if (!risks?.hiddenIds || ids.length === 0) return new Set();
  return new Set(await risks.hiddenIds(actor.tenantId, ids, readerScope(actor)));
}

/** Keeps the rows whose risk the actor may read (rows without a risk are not restricted by this rule). */
export async function keepReadableByRisk<T>(
  risks: Pick<RiskRepository, "hiddenIds"> | undefined,
  actor: AuthenticatedUser,
  rows: T[],
  riskIdOf: (row: T) => string | null | undefined,
): Promise<T[]> {
  const hidden = await hiddenRiskIds(risks, actor, rows.map(riskIdOf));
  return hidden.size === 0 ? rows : rows.filter((row) => !hidden.has(riskIdOf(row) ?? ""));
}

/**
 * QA-VIS1-02: a row that stays readable (a CLIENT control, anomaly or plan) loses the ids of the risks the actor may not
 * read — `mask` rewrites the row with the hidden set. One `hiddenIds` query for all the rows.
 */
export async function maskHiddenRisks<T>(
  risks: Pick<RiskRepository, "hiddenIds"> | undefined,
  actor: AuthenticatedUser,
  rows: T[],
  riskIdsOf: (row: T) => Array<string | null | undefined>,
  mask: (row: T, hidden: Set<string>) => T,
): Promise<T[]> {
  const hidden = await hiddenRiskIds(risks, actor, rows.flatMap(riskIdsOf));
  return hidden.size === 0 ? rows : rows.map((row) => mask(row, hidden));
}

/** A row of a hidden risk answers exactly like a missing one (404, no existence oracle). */
export async function assertReadableByRisk(
  risks: Pick<RiskRepository, "hiddenIds"> | undefined,
  actor: AuthenticatedUser,
  riskId: string | null | undefined,
  entity: string,
  id: string,
): Promise<void> {
  if ((await hiddenRiskIds(risks, actor, [riskId])).size > 0) throw new NotFoundError(entity, id);
}
