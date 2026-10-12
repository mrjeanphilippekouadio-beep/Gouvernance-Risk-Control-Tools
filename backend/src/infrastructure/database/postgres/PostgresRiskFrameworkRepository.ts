import type { Pool, PoolClient } from "pg";
import type { RiskFrameworkRepository } from "../../../domain/repositories/RiskFrameworkRepository.js";
import type {
  AppetiteThresholdEntry,
  ApproverGroup,
  ChangeApprover,
  ChangeRequestKind,
  ChangeRequestStatus,
  CreateActivationRequestInput,
  DecisionRegime,
  DecisionResult,
  FrameworkParams,
  RecordDecisionInput,
  RiskFramework,
  RiskFrameworkChangeRequest,
  RiskFrameworkVersion,
  RiskFrameworkVersionStatus,
  UpdateDraftParams,
} from "../../../domain/entities/RiskFramework.js";
import type { EvaluationMode } from "../../../domain/entities/Config.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";

interface FrameworkRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  archived_by: string | null;
  archive_reason: string | null;
}

interface VersionRow {
  id: string;
  tenant_id: string;
  framework_id: string;
  version_number: number;
  status: RiskFrameworkVersionStatus;
  rating_scale_id: string;
  default_evaluation_mode: EvaluationMode;
  committee_evaluation_min_score: number;
  committee_evaluation_enforced: boolean;
  committee_treatment_min_score: number | null;
  appetite_thresholds: AppetiteThresholdEntry[];
  change_approver: ChangeApprover;
  self_proposal_allowed: boolean;
  created_by: string | null;
  last_edited_by: string | null;
  created_at: Date;
  updated_at: Date;
  activated_at: Date | null;
  activation_request_id: string | null;
  archived_at: Date | null;
  archived_by: string | null;
  archive_reason: string | null;
}

interface RequestRow {
  id: string;
  tenant_id: string;
  kind: ChangeRequestKind;
  framework_id: string;
  version_id: string | null;
  process_id: string | null;
  previous_value: unknown;
  reason: string;
  status: ChangeRequestStatus;
  requested_by: string;
  created_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  decision_comment: string | null;
  decision_regime: DecisionRegime | null;
  decider_group: ApproverGroup | null;
  ratification_status: "PENDING" | null;
}

const frameworkOf = (r: FrameworkRow): RiskFramework => ({
  id: r.id,
  tenantId: r.tenant_id,
  name: r.name,
  description: r.description,
  isDefault: r.is_default,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  archivedAt: r.archived_at,
  archivedBy: r.archived_by,
  archiveReason: r.archive_reason,
});

const versionOf = (r: VersionRow): RiskFrameworkVersion => ({
  id: r.id,
  tenantId: r.tenant_id,
  frameworkId: r.framework_id,
  versionNumber: r.version_number,
  status: r.status,
  ratingScaleId: r.rating_scale_id,
  defaultEvaluationMode: r.default_evaluation_mode,
  committeeEvaluationMinScore: r.committee_evaluation_min_score,
  committeeEvaluationEnforced: r.committee_evaluation_enforced,
  committeeTreatmentMinScore: r.committee_treatment_min_score,
  appetiteThresholds: r.appetite_thresholds,
  changeApprover: r.change_approver,
  selfProposalAllowed: r.self_proposal_allowed,
  createdBy: r.created_by,
  lastEditedBy: r.last_edited_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  activatedAt: r.activated_at,
  activationRequestId: r.activation_request_id,
  archivedAt: r.archived_at,
  archivedBy: r.archived_by,
  archiveReason: r.archive_reason,
});

const requestOf = (r: RequestRow): RiskFrameworkChangeRequest => ({
  id: r.id,
  tenantId: r.tenant_id,
  kind: r.kind,
  frameworkId: r.framework_id,
  versionId: r.version_id,
  processId: r.process_id,
  previousValue: r.previous_value,
  reason: r.reason,
  status: r.status,
  requestedBy: r.requested_by,
  createdAt: r.created_at,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionComment: r.decision_comment,
  decisionRegime: r.decision_regime,
  deciderGroup: r.decider_group,
  ratificationStatus: r.ratification_status,
});

/** Domain key -> column. The only columns a draft update may ever write (whitelist, never client-named). */
const DRAFT_COLUMNS: Record<keyof UpdateDraftParams, string> = {
  ratingScaleId: "rating_scale_id",
  defaultEvaluationMode: "default_evaluation_mode",
  committeeEvaluationMinScore: "committee_evaluation_min_score",
  committeeEvaluationEnforced: "committee_evaluation_enforced",
  committeeTreatmentMinScore: "committee_treatment_min_score",
  appetiteThresholds: "appetite_thresholds",
  changeApprover: "change_approver",
  selfProposalAllowed: "self_proposal_allowed",
};

/** A failing ROLLBACK (dead connection) must not replace the error that caused it. */
async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* the original error is the one to report */
  }
}

/** Unique-index violations and the immutability triggers (42501) become clean domain errors. */
function mapPgError(err: unknown): unknown {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === "23505") {
    if (e.constraint === "risk_frameworks_tenant_name_idx") return new ConflictError("Un Dispositif porte déjà ce nom");
    if (e.constraint === "risk_framework_versions_open_idx") {
      return new ConflictError("Ce Dispositif a déjà une version en brouillon ou en attente d'approbation");
    }
    if (e.constraint === "risk_framework_change_requests_pending_idx") {
      return new ConflictError("Une demande est déjà en attente pour ce Dispositif");
    }
    return new ConflictError("Conflit avec une donnée existante");
  }
  if (e?.code === "42501") return new ValidationError("Cette version est figée : créez une nouvelle version");
  return err;
}

export class PostgresRiskFrameworkRepository implements RiskFrameworkRepository {
  constructor(private readonly pool: Pool) {}

  /** Runs `fn` in a transaction; unique/immutability violations are mapped to domain errors. */
  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await rollbackQuietly(client);
      throw mapPgError(err);
    } finally {
      client.release();
    }
  }

  async listFrameworks(tenantId: string): Promise<RiskFramework[]> {
    const { rows } = await this.pool.query<FrameworkRow>(
      `SELECT * FROM risk_frameworks WHERE tenant_id = $1 ORDER BY is_default DESC, lower(name)`,
      [tenantId],
    );
    return rows.map(frameworkOf);
  }

  async getFramework(tenantId: string, id: string): Promise<RiskFramework | null> {
    const { rows } = await this.pool.query<FrameworkRow>(
      `SELECT * FROM risk_frameworks WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? frameworkOf(rows[0]) : null;
  }

  async listVersions(tenantId: string, frameworkId: string): Promise<RiskFrameworkVersion[]> {
    const { rows } = await this.pool.query<VersionRow>(
      `SELECT * FROM risk_framework_versions WHERE tenant_id = $1 AND framework_id = $2 ORDER BY version_number DESC`,
      [tenantId, frameworkId],
    );
    return rows.map(versionOf);
  }

  async getVersion(tenantId: string, frameworkId: string, versionId: string): Promise<RiskFrameworkVersion | null> {
    const { rows } = await this.pool.query<VersionRow>(
      `SELECT * FROM risk_framework_versions WHERE tenant_id = $1 AND framework_id = $2 AND id = $3`,
      [tenantId, frameworkId, versionId],
    );
    return rows[0] ? versionOf(rows[0]) : null;
  }

  async getActiveVersion(tenantId: string, frameworkId: string): Promise<RiskFrameworkVersion | null> {
    const { rows } = await this.pool.query<VersionRow>(
      `SELECT * FROM risk_framework_versions WHERE tenant_id = $1 AND framework_id = $2 AND status = 'ACTIVE'`,
      [tenantId, frameworkId],
    );
    return rows[0] ? versionOf(rows[0]) : null;
  }

  async createWithDraft(input: {
    tenantId: string;
    name: string;
    description: string | null;
    createdBy: string;
    params: FrameworkParams;
  }): Promise<{ framework: RiskFramework; version: RiskFrameworkVersion }> {
    const p = input.params;
    return this.tx(async (c) => {
      const fw = await c.query<FrameworkRow>(
        `INSERT INTO risk_frameworks (tenant_id, name, description, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.tenantId, input.name, input.description, input.createdBy],
      );
      const ver = await c.query<VersionRow>(
        `INSERT INTO risk_framework_versions
           (tenant_id, framework_id, version_number, status, rating_scale_id, default_evaluation_mode,
            committee_evaluation_min_score, committee_evaluation_enforced, committee_treatment_min_score,
            appetite_thresholds, change_approver, self_proposal_allowed, created_by, last_edited_by)
         VALUES ($1, $2, 1, 'DRAFT', $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         RETURNING *`,
        [
          input.tenantId,
          fw.rows[0]!.id,
          p.ratingScaleId,
          p.defaultEvaluationMode,
          p.committeeEvaluationMinScore,
          p.committeeEvaluationEnforced,
          p.committeeTreatmentMinScore,
          JSON.stringify(p.appetiteThresholds),
          p.changeApprover,
          p.selfProposalAllowed,
          input.createdBy,
        ],
      );
      return { framework: frameworkOf(fw.rows[0]!), version: versionOf(ver.rows[0]!) };
    });
  }

  async updateIdentity(
    tenantId: string,
    id: string,
    fields: { name?: string; description?: string | null },
  ): Promise<RiskFramework> {
    const { setClauses, values } = buildUpdateSet({ name: fields.name, description: fields.description }, 3);
    if (setClauses.length === 0) throw new ValidationError("Nothing to update");
    try {
      const { rows } = await this.pool.query<FrameworkRow>(
        `UPDATE risk_frameworks SET ${setClauses.join(", ")}, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL RETURNING *`,
        [tenantId, id, ...values],
      );
      if (!rows[0]) throw new NotFoundError("RiskFramework", id);
      return frameworkOf(rows[0]);
    } catch (err) {
      throw mapPgError(err);
    }
  }

  async createDraftFrom(
    tenantId: string,
    frameworkId: string,
    sourceVersionId: string,
    createdBy: string,
  ): Promise<RiskFrameworkVersion> {
    return this.tx(async (c) => {
      // Serialises concurrent drafts of one Dispositif so max(version_number) + 1 is reliable.
      const lock = await c.query(
        `SELECT id FROM risk_frameworks WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL FOR UPDATE`,
        [tenantId, frameworkId],
      );
      if (lock.rows.length === 0) throw new NotFoundError("RiskFramework", frameworkId);
      const { rows } = await c.query<VersionRow>(
        `INSERT INTO risk_framework_versions
           (tenant_id, framework_id, version_number, status, rating_scale_id, default_evaluation_mode,
            committee_evaluation_min_score, committee_evaluation_enforced, committee_treatment_min_score,
            appetite_thresholds, change_approver, self_proposal_allowed, created_by, last_edited_by)
         SELECT s.tenant_id, s.framework_id,
                (SELECT COALESCE(MAX(version_number), 0) + 1 FROM risk_framework_versions WHERE framework_id = s.framework_id),
                'DRAFT', s.rating_scale_id, s.default_evaluation_mode, s.committee_evaluation_min_score,
                s.committee_evaluation_enforced, s.committee_treatment_min_score, s.appetite_thresholds,
                s.change_approver, s.self_proposal_allowed, $4, $4
         FROM risk_framework_versions s
         WHERE s.tenant_id = $1 AND s.framework_id = $2 AND s.id = $3
         RETURNING *`,
        [tenantId, frameworkId, sourceVersionId, createdBy],
      );
      if (!rows[0]) throw new NotFoundError("RiskFrameworkVersion", sourceVersionId);
      return versionOf(rows[0]);
    });
  }

  async updateDraft(
    tenantId: string,
    frameworkId: string,
    versionId: string,
    fields: UpdateDraftParams,
    editedBy: string,
  ): Promise<RiskFrameworkVersion> {
    const columns: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(DRAFT_COLUMNS)) {
      const value = fields[key as keyof UpdateDraftParams];
      columns[column] = key === "appetiteThresholds" && value !== undefined ? JSON.stringify(value) : value;
    }
    const { setClauses, values } = buildUpdateSet(columns, 5);
    if (setClauses.length === 0) throw new ValidationError("Nothing to update");
    try {
      const { rows } = await this.pool.query<VersionRow>(
        `UPDATE risk_framework_versions SET ${setClauses.join(", ")}, last_edited_by = $4, updated_at = now()
         WHERE tenant_id = $1 AND framework_id = $2 AND id = $3 AND status = 'DRAFT' RETURNING *`,
        [tenantId, frameworkId, versionId, editedBy, ...values],
      );
      if (!rows[0]) throw new ValidationError("Only a draft version can be modified");
      return versionOf(rows[0]);
    } catch (err) {
      throw mapPgError(err);
    }
  }

  async discardDraft(
    tenantId: string,
    frameworkId: string,
    versionId: string,
    archivedBy: string,
    reason: string,
  ): Promise<RiskFrameworkVersion> {
    try {
      const { rows } = await this.pool.query<VersionRow>(
        `UPDATE risk_framework_versions
         SET status = 'ARCHIVED', archived_at = now(), archived_by = $4, archive_reason = $5, updated_at = now()
         WHERE tenant_id = $1 AND framework_id = $2 AND id = $3 AND status = 'DRAFT' RETURNING *`,
        [tenantId, frameworkId, versionId, archivedBy, reason],
      );
      if (!rows[0]) throw new ValidationError("Only a draft version can be discarded");
      return versionOf(rows[0]);
    } catch (err) {
      throw mapPgError(err);
    }
  }

  async createActivationRequest(input: CreateActivationRequestInput): Promise<RiskFrameworkChangeRequest> {
    return this.tx(async (c) => {
      // F-B6a-02: the version is locked, then validated as it is NOW; a concurrent PATCH waits for the commit.
      if (input.validateLocked) {
        const locked = await c.query<VersionRow>(
          `SELECT * FROM risk_framework_versions WHERE tenant_id = $1 AND framework_id = $2 AND id = $3 FOR UPDATE`,
          [input.tenantId, input.frameworkId, input.versionId],
        );
        if (!locked.rows[0] || locked.rows[0].status !== "DRAFT") {
          throw new ValidationError("Only a draft version can be submitted for activation");
        }
        await input.validateLocked(versionOf(locked.rows[0]));
      }
      const moved = await c.query(
        `UPDATE risk_framework_versions SET status = 'PENDING_APPROVAL', updated_at = now()
         WHERE tenant_id = $1 AND framework_id = $2 AND id = $3 AND status = 'DRAFT'`,
        [input.tenantId, input.frameworkId, input.versionId],
      );
      if (moved.rowCount !== 1) throw new ValidationError("Only a draft version can be submitted for activation");
      const { rows } = await c.query<RequestRow>(
        `INSERT INTO risk_framework_change_requests
           (tenant_id, kind, framework_id, version_id, previous_value, reason, requested_by)
         VALUES ($1, 'ACTIVATE_VERSION', $2, $3, $4, $5, $6) RETURNING *`,
        [input.tenantId, input.frameworkId, input.versionId, JSON.stringify(input.previousValue), input.reason, input.requestedBy],
      );
      return requestOf(rows[0]!);
    });
  }

  async getRequest(tenantId: string, id: string): Promise<RiskFrameworkChangeRequest | null> {
    const { rows } = await this.pool.query<RequestRow>(
      `SELECT * FROM risk_framework_change_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? requestOf(rows[0]) : null;
  }

  async listRequests(tenantId: string, filter?: { status?: ChangeRequestStatus }): Promise<RiskFrameworkChangeRequest[]> {
    const { rows } = await this.pool.query<RequestRow>(
      `SELECT * FROM risk_framework_change_requests
       WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at DESC LIMIT 500`,
      [tenantId, filter?.status ?? null],
    );
    return rows.map(requestOf);
  }

  /** Locks the request; only a PENDING ACTIVATE_VERSION request can be decided or withdrawn. */
  private async lockPending(c: PoolClient, tenantId: string, requestId: string): Promise<RequestRow> {
    const { rows } = await c.query<RequestRow>(
      `SELECT * FROM risk_framework_change_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, requestId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("RiskFrameworkChangeRequest", requestId);
    if (row.status !== "PENDING") throw new ConflictError(`Cette demande est déjà traitée (${row.status})`);
    if (row.kind !== "ACTIVATE_VERSION" || !row.version_id) {
      throw new ValidationError(`Request kind ${row.kind} is not supported yet`);
    }
    return row;
  }

  /**
   * F-B6a-01. The scale of the activated version becomes ACTIVE: refused when ARCHIVED, refused when a
   * threshold (version, configs, legacy appetites) exceeds its n x n ceiling (F-B9b-01, fail-closed:
   * the throw rolls the whole decision back). Any other ACTIVE scale that no ACTIVE version references is
   * archived, so the legacy readers (newest ACTIVE scale wins) cannot pick a scale this one outranks.
   */
  private async mirrorScale(c: PoolClient, tenantId: string, v: RiskFrameworkVersion): Promise<void> {
    const sc = await c.query<{ status: string; probability_levels: number; impact_levels: number }>(
      `SELECT status, probability_levels, impact_levels FROM rating_scales
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [tenantId, v.ratingScaleId],
    );
    const scale = sc.rows[0];
    if (!scale) throw new ValidationError("The rating scale of this version no longer exists");
    if (scale.status === "ARCHIVED") {
      throw new ValidationError("Cannot activate a version on an archived rating scale — create a new scale instead");
    }
    const ceiling = scale.probability_levels * scale.impact_levels;
    const over: string[] = [];
    const check = (label: string, value: number | null) => {
      if (value !== null && value > ceiling) over.push(`${label} (${value})`);
    };
    check("seuil Comité évaluation de la version", v.committeeEvaluationMinScore);
    check("seuil Comité traitement de la version", v.committeeTreatmentMinScore);
    for (const a of v.appetiteThresholds) check(`appétence "${a.subCategory}" de la version`, a.threshold);
    const cfg = await c.query<{ e: number; t: number | null }>(
      `SELECT committee_evaluation_min_score AS e, committee_treatment_min_score AS t FROM configs WHERE tenant_id = $1`,
      [tenantId],
    );
    check("seuil Comité évaluation (configs)", cfg.rows[0]?.e ?? null);
    check("seuil Comité traitement (configs)", cfg.rows[0]?.t ?? null);
    const apps = await c.query<{ sub_category: string; threshold: number }>(
      `SELECT sub_category, threshold FROM risk_appetites WHERE tenant_id = $1 AND active AND deleted_at IS NULL`,
      [tenantId],
    );
    for (const a of apps.rows) check(`appétence "${a.sub_category}"`, a.threshold);
    if (over.length > 0) {
      throw new ValidationError(`Cannot activate: these thresholds exceed the maximum score of the scale (${ceiling}): ${over.join(", ")}. Lower them first.`);
    }
    await c.query(
      `UPDATE rating_scales SET status = 'ACTIVE', activated_at = COALESCE(activated_at, now()), archived_at = NULL, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status <> 'ACTIVE'`,
      [tenantId, v.ratingScaleId],
    );
    await c.query(
      `UPDATE rating_scales SET status = 'ARCHIVED', archived_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id <> $2 AND status = 'ACTIVE' AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM risk_framework_versions x
                         WHERE x.tenant_id = $1 AND x.rating_scale_id = rating_scales.id AND x.status = 'ACTIVE')`,
      [tenantId, v.ratingScaleId],
    );
  }

  async recordDecision(tenantId: string, requestId: string, d: RecordDecisionInput): Promise<DecisionResult> {
    return this.tx(async (c) => {
      const req = await this.lockPending(c, tenantId, requestId);
      const decided = await c.query<RequestRow>(
        `UPDATE risk_framework_change_requests
         SET status = $3, decided_by = $4, decided_at = now(), decision_comment = $5,
             decision_regime = $6, decider_group = $7, ratification_status = $8
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, requestId, d.outcome, d.decidedBy, d.comment, d.decisionRegime, d.deciderGroup, d.ratificationStatus],
      );
      const request = requestOf(decided.rows[0]!);

      if (d.outcome === "REJECTED") {
        const back = await c.query<VersionRow>(
          `UPDATE risk_framework_versions SET status = 'DRAFT', updated_at = now()
           WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING_APPROVAL' RETURNING *`,
          [tenantId, req.version_id],
        );
        if (!back.rows[0]) throw new ConflictError("La version n'est plus en attente d'approbation");
        return { request, version: versionOf(back.rows[0]), previousActive: null };
      }

      // The previous ACTIVE goes first: at most one ACTIVE version per Dispositif (unique index).
      const prev = await c.query<VersionRow>(
        `SELECT * FROM risk_framework_versions
         WHERE tenant_id = $1 AND framework_id = $2 AND status = 'ACTIVE' FOR UPDATE`,
        [tenantId, req.framework_id],
      );
      const previousActive = prev.rows[0] ? versionOf(prev.rows[0]) : null;
      if (previousActive) {
        const next = await c.query<{ version_number: number }>(
          `SELECT version_number FROM risk_framework_versions WHERE tenant_id = $1 AND id = $2`,
          [tenantId, req.version_id],
        );
        await c.query(
          `UPDATE risk_framework_versions
           SET status = 'ARCHIVED', archived_at = now(), archived_by = $3, archive_reason = $4, updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, previousActive.id, d.decidedBy, `remplacée par v${next.rows[0]?.version_number}`],
        );
      }
      const activated = await c.query<VersionRow>(
        `UPDATE risk_framework_versions
         SET status = 'ACTIVE', activated_at = now(), activation_request_id = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING_APPROVAL' RETURNING *`,
        [tenantId, req.version_id, requestId],
      );
      const version = activated.rows[0];
      if (!version) throw new ConflictError("La version n'est plus en attente d'approbation");

      // Scale status mirror (spec §2.3), F-B6a-01: same guards as RatingScaleService.activateVersion, same transaction.
      await this.mirrorScale(c, tenantId, versionOf(version));
      // The first activated Dispositif of a tenant becomes its default.
      await c.query(
        `UPDATE risk_frameworks SET is_default = true, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM risk_frameworks WHERE tenant_id = $1 AND is_default AND archived_at IS NULL)`,
        [tenantId, req.framework_id],
      );
      return { request, version: versionOf(version), previousActive };
    });
  }

  async withdraw(tenantId: string, requestId: string, comment: string | null): Promise<DecisionResult> {
    return this.tx(async (c) => {
      const req = await this.lockPending(c, tenantId, requestId);
      const done = await c.query<RequestRow>(
        `UPDATE risk_framework_change_requests
         SET status = 'WITHDRAWN', decided_at = now(), decision_comment = $3
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, requestId, comment],
      );
      const back = await c.query<VersionRow>(
        `UPDATE risk_framework_versions SET status = 'DRAFT', updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING_APPROVAL' RETURNING *`,
        [tenantId, req.version_id],
      );
      if (!back.rows[0]) throw new ConflictError("La version n'est plus en attente d'approbation");
      return { request: requestOf(done.rows[0]!), version: versionOf(back.rows[0]), previousActive: null };
    });
  }
}
