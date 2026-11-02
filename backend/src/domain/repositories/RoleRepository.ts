import type { TransactionalAudit } from "../entities/RiskFramework.js";
import type { CreateRoleInput, Role, RoleAssignment, UpdateRoleInput } from "../entities/Role.js";
import type { AuditEvent } from "../entities/AuditEvent.js";
import type { Permission } from "../permissions.js";

type AuditToWrite = Omit<AuditEvent, "id" | "timestamp">;

/** D2c (R-3): the last Risk Manager leaves and the designated interim takes the role, in ONE transaction. */
export interface HandOverInput {
  tenantId: string;
  roleId: string;
  leavingUserId: string;
  interimUserId: string;
  designationId: string;
  /** Always the acting administrator (never client-supplied). */
  grantedBy: string;
  /** Replays the cumul rules on the interim's roles read under the locks; throws to abort. */
  recheck?: RoleAssignRecheck;
  /** Built from the new assignment; inserted in the same transaction. */
  audit: (assignment: RoleAssignment) => AuditToWrite[];
}

/** F-B8s-01: run inside the repository transaction, under the user + role locks; throws to abort. */
export type RoleAssignRecheck = (lockedRole: Role, held: Role[]) => Promise<void>;
export type RoleUpdateRecheck = (lockedRole: Role, holders: { userId: string; roles: Role[] }[]) => Promise<void>;

export interface RoleRepository {
  getById(tenantId: string, id: string): Promise<Role | null>;
  getByName(tenantId: string, name: string): Promise<Role | null>;
  list(tenantId: string, options?: { includeDisabled?: boolean }): Promise<Role[]>;
  create(input: CreateRoleInput): Promise<Role>;
  /** `recheck` (widening permissions): locks holders then the role and replays the cumul rules before the UPDATE. */
  update(tenantId: string, id: string, input: UpdateRoleInput, recheck?: RoleUpdateRecheck): Promise<Role>;
  /**
   * q179 (QA-SUITES2-02): the permissions of several fixed groups and their audit rows in ONE transaction.
   * Optional for the existing test doubles; RoleService then writes them one by one. `actorUserId`: rechecked under
   * the user-then-role locks, the actor never belongs to a changed group (Codex PR #199).
   */
  setGroupPermissions?(
    tenantId: string,
    changes: Array<{ id: string; permissions: Permission[] }>,
    audit: (roles: Role[]) => AuditToWrite[],
    actorUserId?: string,
  ): Promise<Role[]>;
  disable(tenantId: string, id: string): Promise<void>;
  /** Used by ACT-112: a role can't be disabled while a user is still actively assigned to it. */
  countActiveAssignments(tenantId: string, roleId: string): Promise<number>;
  /** QA-V3-03: true when `assignToUser` writes the rows of `audit` in its own transaction (before COMMIT). */
  readonly assignAuditsInTransaction?: boolean;
  assignToUser(
    tenantId: string,
    roleId: string,
    userId: string,
    grantedBy: string,
    recheck?: RoleAssignRecheck,
    audit?: TransactionalAudit<RoleAssignment>,
  ): Promise<RoleAssignment>;
  /**
   * `minRemaining`: refuse (ValidationError) when fewer than that many active
   * members would remain after the revoke — checked atomically (B-8: the
   * Risk Manager group is never left empty).
   */
  revokeFromUser(
    tenantId: string,
    roleId: string,
    userId: string,
    options?: { minRemaining?: number; /** inserted in the same transaction (D2c: vacancy exception). */ auditEvents?: AuditToWrite[] },
  ): Promise<void>;
  /**
   * D2c (R-3): lock order users -> roles -> tenants -> designation; revoke the leaving member THEN assign the interim
   * (062's trigger counts RM members on each insert); mark the designation activated; audit; exactly one active member at COMMIT.
   * Optional on the interface for the existing test doubles; RoleService fails closed without it.
   */
  handOverLastRiskManager?(input: HandOverInput): Promise<RoleAssignment>;
  listForUser(tenantId: string, userId: string): Promise<Role[]>;
  /** B-8 bis (F-B8-06): roles DISABLED since the user got them but whose non-revoked assignment remains. */
  listDisabledForUser?(tenantId: string, userId: string): Promise<Role[]>;
  listAssignments(tenantId: string, roleId: string): Promise<RoleAssignment[]>;
  /** B-6d (F-B6d-01): the user's active roles with who granted each one and when. */
  listActiveGrants?(tenantId: string, userId: string): Promise<Array<{ role: Role; grantedBy: string; grantedAt: Date }>>;
}
