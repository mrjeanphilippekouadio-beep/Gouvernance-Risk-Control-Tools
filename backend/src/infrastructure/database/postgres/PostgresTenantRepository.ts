import type { Pool } from "pg";
import type { SetActiveInput, TenantRepository } from "../../../domain/repositories/TenantRepository.js";
import type { CreateTenantInput, DeploymentMode, Tenant, UpdateTenantInput } from "../../../domain/entities/Tenant.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";
import { insertAuditEvent } from "./PostgresAuditRepository.js";
import { FIXED_GROUP_PERMISSIONS } from "../../../domain/fixedGroupPermissions.js";

interface TenantRow {
  id: string;
  name: string;
  deployment_mode: DeploymentMode;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    deploymentMode: row.deployment_mode,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** QA-F8B-01: the unique index of migration 092 (normalized name) turns a concurrent duplicate into a clean 409. */
function mapNameClash(err: unknown): never {
  if ((err as { code?: string }).code === "23505" && (err as { constraint?: string }).constraint === "tenants_name_normalized_uq") {
    throw new ConflictError("A client with this name already exists");
  }
  throw err;
}

/** One platform-wide advisory lock for deactivate/reactivate (rare, human-driven actions). */
const TENANT_ACTIVATION_LOCK = 920092;

export class PostgresTenantRepository implements TenantRepository {
  constructor(private readonly pool: Pool) {}

  async getDriveFolderId(tenantId: string): Promise<string> {
    const { rows } = await this.pool.query<{ drive_folder_id: string | null }>(
      `SELECT drive_folder_id FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const folderId = rows[0]?.drive_folder_id;
    if (!folderId) {
      throw new ValidationError(
        `Tenant ${tenantId} has no drive_folder_id configured — set it before uploading evidence`,
      );
    }
    return folderId;
  }

  async getById(id: string): Promise<Tenant | null> {
    const { rows } = await this.pool.query<TenantRow>(
      `SELECT id, name, deployment_mode, active, created_at, updated_at FROM tenants WHERE id = $1`,
      [id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(): Promise<Tenant[]> {
    const { rows } = await this.pool.query<TenantRow>(
      `SELECT id, name, deployment_mode, active, created_at, updated_at FROM tenants ORDER BY name`,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateTenantInput): Promise<Tenant> {
    const { rows } = await this.pool
      .query<TenantRow>(
      `WITH t AS (
         INSERT INTO tenants (name, deployment_mode)
         VALUES ($1, $2)
         RETURNING id, name, deployment_mode, active, created_at, updated_at
       ), groups AS (
         -- B-8: every tenant has its three fixed groups from day one (same rows as migration 049).
         INSERT INTO roles (tenant_id, name, description, permissions, system_group)
         SELECT t.id, g.name, g.description, g.permissions, g.system_group
         FROM t CROSS JOIN (VALUES
           ('Risk Manager',   'Groupe fixe : équipe risque (jamais vide)', 'RISK_MANAGER', $3::text[]),
           ('Risk Committee', 'Groupe fixe : Comité des risques (peut être vide)', 'RISK_COMMITTEE', $4::text[]),
           ('Audit',          'Groupe fixe : Audit (peut être vide)', 'AUDIT', $5::text[])
         ) AS g (name, description, system_group, permissions)
       )
       SELECT * FROM t`,
      [
        input.name,
        input.deploymentMode ?? "managed_saas",
        // B-8 ter: the q42 rights of migration 051, from the single TS source.
        FIXED_GROUP_PERMISSIONS.RISK_MANAGER,
        FIXED_GROUP_PERMISSIONS.RISK_COMMITTEE,
        FIXED_GROUP_PERMISSIONS.AUDIT,
      ],
      )
      .catch(mapNameClash);
    const row = rows[0];
    if (!row) throw new Error("Insert into tenants returned no row");
    return toDomain(row);
  }

  async update(id: string, input: UpdateTenantInput): Promise<Tenant> {
    const { setClauses, values } = buildUpdateSet(
      { name: input.name, deployment_mode: input.deploymentMode, active: input.active },
      2,
    );
    if (setClauses.length === 0) {
      const current = await this.getById(id);
      if (!current) throw new NotFoundError("Tenant", id);
      return current;
    }

    const { rows } = await this.pool
      .query<TenantRow>(
        `UPDATE tenants SET ${setClauses.join(", ")}, updated_at = now()
       WHERE id = $1
       RETURNING id, name, deployment_mode, active, created_at, updated_at`,
        [id, ...values],
      )
      .catch(mapNameClash);
    const row = rows[0];
    if (!row) throw new NotFoundError("Tenant", id);
    return toDomain(row);
  }

  async setActiveAudited(input: SetActiveInput): Promise<Tenant> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // SEC-F8B-02 / q277: serialize every deactivation/reactivation, then lock the row; state, survival rule and audit commit together.
      await client.query("SELECT pg_advisory_xact_lock($1)", [TENANT_ACTIVATION_LOCK]);
      const { rows: current } = await client.query<TenantRow>(
        `SELECT id, name, deployment_mode, active, created_at, updated_at FROM tenants WHERE id = $1 FOR UPDATE`,
        [input.id],
      );
      if (!current[0]) throw new NotFoundError("Tenant", input.id);
      if (current[0].active !== input.expectedActive) {
        throw new ConflictError(input.active ? "This client is already active" : "This client is already inactive");
      }
      if (input.active && input.reactivatorMustDifferFrom) {
        // Re-read under the lock, in the transaction: the service's earlier check may be stale (QA-F8B-05 / race).
        const { rows: last } = await client.query<{ user_id: string }>(
          `SELECT user_id FROM audit_log
           WHERE tenant_id = $1 AND entity_type = 'Tenant' AND entity_id = $1 AND action = 'STATUS_CHANGE'
             AND (new_value ->> 'active') = 'false'
           ORDER BY "timestamp" DESC, id DESC LIMIT 1`,
          [input.id],
        );
        if (last[0]?.user_id === input.reactivatorMustDifferFrom) {
          throw new ValidationError("The reactivation must be done by a different super-administrator than the one who deactivated");
        }
      }
      const rule = input.survivalRule;
      if (!input.active && rule) {
        const { rows: survivors } = await client.query<{ n: number }>(
          `SELECT count(DISTINCT lower(u.email))::int AS n
           FROM users u JOIN tenants t ON t.id = u.tenant_id AND t.active = true
           WHERE u.deleted_at IS NULL AND u.tenant_id <> $1 AND u.id <> $2
             AND lower(u.email) = ANY($3::text[]) AND split_part(lower(u.email), '@', 2) = ANY($4::text[])`,
          [input.id, rule.actorUserId, [...rule.emails], [...rule.domains]],
        );
        if ((survivors[0]?.n ?? 0) < 1) {
          throw new ConflictError(
            "Refused: no other active super-administrator would remain outside this client to reactivate it (at least two super-administrators are required)",
          );
        }
      }
      const { rows } = await client.query<TenantRow>(
        `UPDATE tenants SET active = $2, updated_at = now() WHERE id = $1
         RETURNING id, name, deployment_mode, active, created_at, updated_at`,
        [input.id, input.active],
      );
      const after = toDomain(rows[0]!);
      for (const event of input.audit({ before: toDomain(current[0]), after })) await insertAuditEvent(client, event);
      await client.query("COMMIT");
      return after;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
