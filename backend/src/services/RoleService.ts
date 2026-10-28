import type { RoleRepository, RoleUpdateRecheck } from "../domain/repositories/RoleRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type { DepartmentRepository } from "../domain/repositories/DepartmentRepository.js";
import type { RolePermissionChangeRepository } from "../domain/repositories/RolePermissionChangeRepository.js";
import type { CreateRoleInput, Role, RolePermissionChangeStatus, SystemGroup, UpdateRoleInput } from "../domain/entities/Role.js";
import {
  ALL_PERMISSIONS,
  BASE_PERMISSIONS,
  filterKnownPermissions,
  requirePermission,
  type Permission,
} from "../domain/permissions.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { ConfigRepository } from "../domain/repositories/ConfigRepository.js";
import type { NotificationService } from "./NotificationService.js";
import {
  isAdministrator,
  isAuditGroupMember,
  isAuditGroupPermission,
  isAuditPermission,
  isCommitteeMember,
  isCommitteeRole,
  isCommitteeValidationPermission,
  isRiskManagerMember,
  rolegroupAuditPermissionAllowedOn,
  governanceRightAllowedOn,
  GOVERNANCE_DECISION_RIGHTS,
  isGovernanceDecisionRight,
  type GovernanceDecisionRight,
} from "../domain/fixedGroupPermissions.js";
import { bootstrapNoticeMessage } from "../domain/frameworkApproval.js";
import type { RiskFrameworkRepository } from "../domain/repositories/RiskFrameworkRepository.js";
import type { DashboardScopeMode } from "../domain/entities/DashboardScope.js";
import type { GovernanceDesignationRepository } from "../domain/repositories/GovernanceDesignationRepository.js";
import type { AuditEvent } from "../domain/entities/AuditEvent.js";
import type { GovernanceDesignation } from "../domain/entities/GovernanceDesignation.js";
import { canonicalId } from "../domain/ids.js";

const MAX_GROUP_REASON_LENGTH = 500;
/** q149: value of audit_log.governance_exception when the last Risk Manager leaves with no usable interim. */
export const RISK_MANAGER_VACANCY_EXCEPTION = "riskManager.vacancy";

/** B-8 bis (q43): hard-coded for now (configurable part waits for PO q58). Risk Manager and Audit never cumulate. */
const FORBIDDEN_CUMUL: Partial<Record<SystemGroup, SystemGroup>> = { RISK_MANAGER: "AUDIT", AUDIT: "RISK_MANAGER" };

/** F-B8b-03: permissions whose "who can give it back" answer is never served (administration / governance). */
const NOT_REQUESTABLE = /^(role|rolegroup|user|audit)\./;

/** F-B8b-03: one audit row per (user, permission, hour); in memory, per instance, bounded. */
const GRANTORS_DEDUPE_MAX = 10_000;

/**
 * F-B8b-01 / F-B8b-05: rules on the permissions a role may carry, by fixed group
 * (null = ordinary role). rolegroup.audit.update is held by no role; .validate only by
 * Audit and the Committee; the Risk Manager and Committee groups never carry audit.*.
 */
function assertRolePermissionRules(group: SystemGroup | null, permissions: Permission[]): void {
  const misplaced = permissions.filter((p) => !rolegroupAuditPermissionAllowedOn(p, group));
  if (misplaced.length > 0) {
    throw new ValidationError(`Permission(s) not grantable to this role: ${misplaced.join(", ")}`);
  }
  // q179 (DECISION-095): the governance decision rights live on fixed groups only (Audit: the review alone, q157).
  const decision = permissions.filter((p) => !governanceRightAllowedOn(p, group));
  if (decision.length > 0) {
    throw new ValidationError(
      group === null
        ? `Governance decision right(s) are carried by fixed groups only, never by an ordinary role: ${decision.join(", ")}`
        : `The Audit group never confirms nor approves (q157): ${decision.join(", ")}`,
    );
  }
  if (group === "RISK_MANAGER") {
    const committee = permissions.filter(isCommitteeValidationPermission);
    if (committee.length > 0) {
      throw new ValidationError(`The Risk Manager group cannot carry Committee validation permissions (${committee.join(", ")}): Risk Manager and Committee never cumulate`);
    }
  }
  if (group === "RISK_MANAGER" || group === "RISK_COMMITTEE") {
    const audit = permissions.filter(isAuditPermission);
    if (audit.length > 0) {
      throw new ValidationError(`This group cannot carry audit permissions (${audit.join(", ")}): Risk Manager and Audit never cumulate`);
    }
  }
}

/**
 * F-B8b-05 (q43): Risk Manager and Audit never cumulate, in groups or in effective audit.* permissions.
 * q94 (DECISION-044): Risk Manager and Committee never cumulate either (not configurable).
 */
function assertNoCumul(role: Role, held: Role[]): void {
  const isRm = (r: Role) => r.systemGroup === "RISK_MANAGER";
  const isCommittee = isCommitteeRole;
  if ((isRm(role) && (isCommittee(role) || held.some(isCommittee))) || (isCommittee(role) && held.some(isRm))) {
    throw new ValidationError("A user cannot be both in the Risk Manager group and in the Committee group");
  }
  const isAuditor = (r: Role) => r.systemGroup === "AUDIT" || r.permissions.some(isAuditPermission);
  if ((isRm(role) && held.some(isAuditor)) || (isAuditor(role) && held.some(isRm))) {
    const groups = role.systemGroup && FORBIDDEN_CUMUL[role.systemGroup] && held.some((r) => r.systemGroup === FORBIDDEN_CUMUL[role.systemGroup!]);
    throw new ValidationError(
      groups
        ? "A user cannot be both in the Risk Manager group and in the Audit group"
        : "A user cannot be both in the Risk Manager group and hold audit permissions (audit.*)",
    );
  }
}

function assertKnownPermissions(permissions: Permission[]): void {
  if (permissions.length === 0) throw new ValidationError("A role needs at least one permission");
  const unknown = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown permission(s): ${unknown.join(", ")}`);
  }
}

/**
 * @architect design 2026-09-30: PROCESS is a valid stored
 * dashboard_scope_mode value (kept in the DB CHECK / TS enum so the
 * column and the application-level type never drift) but rejected here,
 * at the write boundary — `risks.process_id` (029_risks_process_id.sql)
 * has never been backfilled in real data (0 unique matches in the PO's
 * cited dry-run), so a role holding PROCESS today would see an empty
 * dashboard.executive regardless of its actual RACI/ownership.
 */
function assertDashboardScopeModeWritable(mode: DashboardScopeMode | undefined): void {
  if (mode === "PROCESS") {
    throw new ValidationError(
      "dashboardScopeMode: PROCESS is not yet usable — risks.process_id has not been backfilled " +
        "(0 unique matches found in the dry-run), so a PROCESS-scoped role would see an empty dashboard.executive. " +
        "Use GLOBAL or DEPARTMENT until that backfill is done.",
    );
  }
}

/**
 * RBAC per ACT-093/110-118: admin-defined named permission bundles,
 * assignable to users. Maker-checker throughout — an actor can never
 * grant or revoke a role on themselves, matching the "admin ne peut pas
 * s'attribuer ses propres rôles" rule the ACF backlog states for
 * ACT-093/113.
 */
export class RoleService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly audit: AuditRepository,
    private readonly users?: UserRepository,
    /** B-8: needed only to link a role to a department; fails closed (throws) if a departmentId is given without it. */
    private readonly departments?: DepartmentRepository,
    /** B-8 bis (q45): pending Audit-group permission changes; fails closed if a change must be queued without it. */
    private readonly permissionChanges?: RolePermissionChangeRepository,
    /** B-8 ter (F-B8b-02): tells Audit/Committee members that a change waits for them; skipped when absent. */
    private readonly notifications?: NotificationService,
    /** DECISION-042 q58: Committee + Audit cumul setting; absent = allowed (the default). */
    private readonly configs?: Pick<ConfigRepository, "getByTenant">,
    /** B-6d (q77): to tell a member arriving in Audit/Committee about bootstrap decisions; absent = no notice. */
    private readonly frameworks?: Pick<RiskFrameworkRepository, "latestBootstrapRequest">,
    /** D2c (q137/q149): the designated Risk Manager interim; absent = no interim, the last-member exit needs the confirmation. */
    private readonly designations?: Pick<GovernanceDesignationRepository, "getActive">,
  ) {}

  private readonly grantorsSeen = new Set<string>();

  /** B-8 bis (q44): entering/leaving a fixed group needs a bounded, non-empty reason. */
  private groupReason(role: Role, reason: string | undefined): string | null {
    const r = reason?.trim() || null;
    if (role.systemGroup && !r) throw new ValidationError("A reason is required to add or remove a member of a fixed group");
    if (r && r.length > MAX_GROUP_REASON_LENGTH) {
      throw new ValidationError(`reason must be at most ${MAX_GROUP_REASON_LENGTH} characters`);
    }
    return r;
  }

  /**
   * B-8: a department's group must point at a live department of this
   * tenant and be the only group of that department.
   */
  private async assertDepartmentLinkable(tenantId: string, departmentId: string, selfRoleId: string | null): Promise<void> {
    if (!this.departments) throw new Error("RoleService requires a DepartmentRepository to link a role to a department");
    const department = await this.departments.getById(tenantId, departmentId);
    if (!department) throw new ValidationError(`Department ${departmentId} does not exist in this tenant`);
    const roles = await this.roles.list(tenantId);
    if (roles.some((r) => r.departmentId === departmentId && r.id !== selfRoleId)) {
      throw new ValidationError("This department already has a group");
    }
  }

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateRoleInput, "tenantId">,
    requestId: string,
  ): Promise<Role> {
    requirePermission(actor, "role.create");
    if (!input.name.trim()) throw new ValidationError("name is required");
    assertKnownPermissions(input.permissions);
    assertRolePermissionRules(null, input.permissions);
    assertDashboardScopeModeWritable(input.dashboardScopeMode);
    if (input.departmentId) await this.assertDepartmentLinkable(actor.tenantId, input.departmentId, null);

    const existing = await this.roles.getByName(actor.tenantId, input.name);
    if (existing) throw new ValidationError(`A role named "${input.name}" already exists`);

    const role = await this.roles.create({ ...input, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: role.id,
      action: "CREATE",
      oldValue: null,
      newValue: role,
      reason: null,
      requestId,
    });

    return role;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Role> {
    requirePermission(actor, "role.read");
    const role = await this.roles.getById(actor.tenantId, id);
    if (!role) throw new NotFoundError("Role", id);
    return role;
  }

  async list(actor: AuthenticatedUser, includeDisabled = false): Promise<Role[]> {
    requirePermission(actor, "role.read");
    return this.roles.list(actor.tenantId, { includeDisabled });
  }

  /**
   * SEC-002: an actor holding role.update could otherwise widen a role
   * they themselves hold (self-escalation) — assignToUser/revokeFromUser
   * already block self-assignment, this closes the same door on the
   * role definition itself. An actor editing a role they hold must ask
   * another admin, same as assigning/revoking one on themselves.
   */
  async update(actor: AuthenticatedUser, id: string, input: UpdateRoleInput, requestId: string, reason?: string): Promise<Role> {
    requirePermission(actor, "role.update");
    const before = await this.get(actor, id);
    id = before.id; // SEC-ID-01: every comparison below uses the id read from the database

    if (input.permissions !== undefined) {
      const held = await this.roles.listForUser(actor.tenantId, actor.userId);
      if (held.some((r) => r.id === id)) {
        throw new ForbiddenError(
          "You cannot change the permissions of a role you hold yourself — ask another admin",
        );
      }
    }

    if (input.name !== undefined && !input.name.trim()) throw new ValidationError("name cannot be empty");
    if (before.systemGroup && input.name !== undefined && input.name !== before.name) {
      throw new ValidationError(`"${before.name}" is a fixed group: it cannot be renamed`);
    }
    if (before.systemGroup && input.departmentId) {
      throw new ValidationError(`"${before.name}" is a fixed group: it cannot be linked to a department`);
    }
    if (input.departmentId) await this.assertDepartmentLinkable(actor.tenantId, input.departmentId, id);
    if (input.permissions !== undefined) {
      assertKnownPermissions(input.permissions);
      assertRolePermissionRules(before.systemGroup, input.permissions);
    }
    // SEC-SA2-01: the four decision rights move only through PUT /roles/governance-rights (reason, at least one group).
    if (input.permissions !== undefined) {
      const moved = GOVERNANCE_DECISION_RIGHTS.filter((p) => before.permissions.includes(p) !== input.permissions!.includes(p));
      if (moved.length > 0) {
        throw new ValidationError(`Governance decision rights are changed through PUT /roles/governance-rights only: ${moved.join(", ")}`);
      }
    }
    if (before.systemGroup === "AUDIT" && input.permissions !== undefined) {
      throw new ValidationError("The permissions of the Audit group are changed through its dedicated endpoint");
    }
    assertDashboardScopeModeWritable(input.dashboardScopeMode);

    // F-B8t-01: widening a role replays the cumul rules for each active holder with the resulting permissions.
    let cumulUsers: string[] = [];
    let committeeCumulUsers: string[] = [];
    let auditCumulUsers: string[] = [];
    const cleanReason = reason?.trim() || null;
    let recheck: RoleUpdateRecheck | undefined;
    if (input.permissions !== undefined && input.permissions.some((p) => !before.permissions.includes(p))) {
      const newPermissions = input.permissions;
      // F-B8s-01: replayed by the repository under the holders' + role locks, on the committed state at that moment.
      recheck = async (lockedRole, holders) => {
        const resulting: Role = { ...lockedRole, permissions: newPermissions };
        cumulUsers = [];
        committeeCumulUsers = [];
        auditCumulUsers = [];
        for (const h of holders) {
          const others = h.roles.filter((r) => r.id !== id);
          const res = await this.assertCumulRules(actor.tenantId, resulting, others, h.roles, reason);
          if (res.createsAdminRiskManagerCumul) cumulUsers.push(h.userId);
          if (res.createsAdminCommitteeCumul) committeeCumulUsers.push(h.userId);
          if (res.createsAdminAuditCumul) auditCumulUsers.push(h.userId);
        }
      };
      const resulting: Role = { ...before, permissions: input.permissions };
      for (const a of await this.roles.listAssignments(actor.tenantId, id)) {
        if (a.revokedAt) continue;
        const previous = await this.roles.listForUser(actor.tenantId, a.userId);
        const others = previous.filter((r) => r.id !== id);
        const res = await this.assertCumulRules(actor.tenantId, resulting, others, previous, reason);
        if (res.createsAdminRiskManagerCumul) cumulUsers.push(a.userId);
        if (res.createsAdminCommitteeCumul) committeeCumulUsers.push(a.userId);
        if (res.createsAdminAuditCumul) auditCumulUsers.push(a.userId);
      }
    }

    const after = await this.roles.update(actor.tenantId, id, input, recheck);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: id,
      action: "PERMISSION_CHANGE",
      oldValue: before,
      newValue: after,
      reason: cleanReason,
      requestId,
    });

    for (const userId of cumulUsers) await this.notifyAdminCumul(actor, userId, "Risk Manager", requestId);
    for (const userId of committeeCumulUsers) await this.notifyAdminCumul(actor, userId, "Comité des risques", requestId);
    for (const userId of auditCumulUsers) await this.notifyAdminCumul(actor, userId, "Audit", requestId);
    return after;
  }

  /** ACT-112: refuses while a user is still actively assigned — revoke them first. */
  async disable(actor: AuthenticatedUser, id: string, requestId: string): Promise<void> {
    requirePermission(actor, "role.delete");
    const before = await this.get(actor, id);
    if (before.systemGroup) {
      throw new ValidationError(`"${before.name}" is a fixed group: it cannot be disabled`);
    }

    const activeCount = await this.roles.countActiveAssignments(actor.tenantId, id);
    if (activeCount > 0) {
      throw new ValidationError(
        `Cannot disable role "${before.name}": ${activeCount} user(s) still hold it — revoke them first`,
      );
    }

    await this.roles.disable(actor.tenantId, id);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason: null,
      requestId,
    });
  }

  /**
   * B-8 bis / B-8 ter (B8bis-01): every rule checkable before the assignment. UserService.create
   * calls it with userId = null BEFORE inserting the user row, so a refused initial role leaves no orphan.
   */
  async assertAssignable(
    actor: AuthenticatedUser,
    roleId: string,
    userId: string | null,
    reason: string | undefined,
  ): Promise<{ role: Role; cleanReason: string | null; createsAdminRiskManagerCumul: boolean; createsAdminCommitteeCumul: boolean; createsAdminAuditCumul: boolean }> {
    const role = await this.get(actor, roleId);
    const groupReason = this.groupReason(role, reason);
    const held = userId ? await this.roles.listForUser(actor.tenantId, userId) : [];
    if (held.some((r) => r.id === roleId)) throw new ConflictError(`This user already holds the role "${role.name}"`, roleId);
    const { cleanReason, createsAdminRiskManagerCumul, createsAdminCommitteeCumul, createsAdminAuditCumul } = await this.assertCumulRules(actor.tenantId, role, held, held, reason);
    return { role, cleanReason: cleanReason ?? groupReason, createsAdminRiskManagerCumul, createsAdminCommitteeCumul, createsAdminAuditCumul };
  }

  /**
   * The cumul rules, shared by an assignment and by a role update (F-B8t-01): `role` is the role as the
   * user will hold it, `others` their other roles, `previous` the roles they held before the change.
   */
  private async assertCumulRules(
    tenantId: string,
    role: Role,
    others: Role[],
    previous: Role[],
    reason: string | undefined,
  ): Promise<{ cleanReason: string | null; createsAdminRiskManagerCumul: boolean; createsAdminCommitteeCumul: boolean; createsAdminAuditCumul: boolean }> {
    assertNoCumul(role, others);

    // q58: Committee + Audit (group or effective audit.*) is allowed unless the tenant forbids it. RM + Audit is handled above.
    const isCommittee = (r: Role) => r.systemGroup === "RISK_COMMITTEE";
    const isAuditMember = (r: Role) => r.systemGroup === "AUDIT" || r.permissions.some(isAuditPermission);
    if ((isCommittee(role) && others.some(isAuditMember)) || (isAuditMember(role) && others.some(isCommittee))) {
      const cfg = await this.configs?.getByTenant(tenantId);
      if (cfg && !cfg.committeeAuditCumulAllowed) {
        throw new ValidationError("A user cannot be both in the Committee group and in the Audit group or hold audit permissions (setting of this tenant)");
      }
    }

    // q63: creating the administrator + Risk Manager cumul needs a reason and warns a third party.
    const after = [...others, role];
    const createsAdminRiskManagerCumul =
      isAdministrator(after) && isRiskManagerMember(after) && !(isAdministrator(previous) && isRiskManagerMember(previous));
    // q80 (DECISION-044): administrator + Committee is handled exactly like administrator + Risk Manager.
    const createsAdminCommitteeCumul =
      isAdministrator(after) && isCommitteeMember(after) && !(isAdministrator(previous) && isCommitteeMember(previous));
    // q104 (DECISION-046): administrator + Audit group, same handling.
    const createsAdminAuditCumul =
      isAdministrator(after) && isAuditGroupMember(after) && !(isAdministrator(previous) && isAuditGroupMember(previous));
    let cleanReason: string | null = null;
    if (createsAdminRiskManagerCumul || createsAdminCommitteeCumul || createsAdminAuditCumul) {
      cleanReason = reason?.trim() || null;
      if (!cleanReason) {
        throw new ValidationError(
          `A reason is required to make a user both application administrator and ${createsAdminRiskManagerCumul ? "Risk Manager" : createsAdminCommitteeCumul ? "Committee member" : "Audit member"}`,
        );
      }
      if (cleanReason.length > MAX_GROUP_REASON_LENGTH) {
        throw new ValidationError(`reason must be at most ${MAX_GROUP_REASON_LENGTH} characters`);
      }
    }
    return { cleanReason, createsAdminRiskManagerCumul, createsAdminCommitteeCumul, createsAdminAuditCumul };
  }

  /** ACT-093/113: the actor can never assign a role to themselves — that's the maker-checker boundary. */
  async assignToUser(
    actor: AuthenticatedUser,
    roleId: string,
    userId: string,
    requestId: string,
    reason?: string,
  ): Promise<void> {
    requirePermission(actor, "role.assign");
    userId = canonicalId(userId);
    if (actor.userId === userId) {
      throw new ForbiddenError("You cannot assign a role to yourself — ask another admin");
    }
    const pre = await this.assertAssignable(actor, roleId, userId, reason);
    const { role } = pre;
    let { cleanReason, createsAdminRiskManagerCumul, createsAdminCommitteeCumul, createsAdminAuditCumul } = pre;

    // F-B8s-01: the check above may be stale; the repository replays it under the user + role locks.
    const assignment = await this.roles.assignToUser(actor.tenantId, roleId, userId, actor.userId, async (lockedRole, held) => {
      const res = await this.assertCumulRules(actor.tenantId, lockedRole, held, held, reason);
      cleanReason = res.cleanReason ?? cleanReason;
      createsAdminRiskManagerCumul = res.createsAdminRiskManagerCumul;
      createsAdminCommitteeCumul = res.createsAdminCommitteeCumul;
      createsAdminAuditCumul = res.createsAdminAuditCumul;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: roleId,
      action: "ROLE_CHANGE",
      oldValue: null,
      newValue: { ...assignment, roleName: role.name },
      reason: cleanReason,
      requestId,
    });

    // q63: administrator + Risk Manager cumul -> Audit and Committee members. q65: Committee entry -> Audit members.
    if (createsAdminRiskManagerCumul) await this.notifyAdminCumul(actor, userId, "Risk Manager", requestId);
    // q80 / q104: same mechanism (same mandatory event type) for administrator + Committee and + Audit.
    if (createsAdminCommitteeCumul) await this.notifyAdminCumul(actor, userId, "Comité des risques", requestId);
    if (createsAdminAuditCumul) await this.notifyAdminCumul(actor, userId, "Audit", requestId);
    if (role.systemGroup === "RISK_COMMITTEE") {
      await this.notifyMembers(actor, "audit.read", userId, userId, "COMMITTEE_MEMBER_ADDED",
        "Un utilisateur vient d'entrer dans le groupe Comité des risques.", requestId);
    }
    if (role.systemGroup === "RISK_COMMITTEE" || role.systemGroup === "AUDIT") {
      await this.notifyBootstrapArrival(actor, userId, requestId);
    }
  }

  /**
   * B-6d (q77, q99): a member arriving in Audit or the Committee (assignment or reactivation) is told about the
   * bootstrap decisions already taken in the tenant. Best effort, after commit; nothing without a BOOTSTRAP decision.
   */
  async notifyBootstrapArrival(actor: AuthenticatedUser, userId: string, requestId: string): Promise<void> {
    try {
      const decision = await this.frameworks?.latestBootstrapRequest?.(actor.tenantId);
      if (!decision?.bootstrapJustification || !this.notifications) return;
      const held = await this.roles.listForUser(actor.tenantId, userId);
      if (!held.some((r) => r.systemGroup === "AUDIT" || r.systemGroup === "RISK_COMMITTEE")) return;
      await this.notifications.record({
        tenantId: actor.tenantId,
        recipientUserId: userId,
        resourceType: "MANAGEMENT",
        resourceId: decision.id,
        eventType: "RISK_FRAMEWORK_BOOTSTRAP_NOTICE",
        message: bootstrapNoticeMessage(decision.bootstrapJustification),
        triggeredBy: actor.userId,
        requestId,
      });
    } catch (err) {
      console.error(`bootstrap arrival notice for user ${userId} failed (requestId ${requestId})`, err instanceof Error ? err.message : err);
    }
  }

  /** ACT-114: also refuses to leave a user with zero active roles. */
  async revokeFromUser(
    actor: AuthenticatedUser,
    roleId: string,
    userId: string,
    requestId: string,
    reason?: string,
    /** q149: second confirmation to let the Risk Manager group become empty (no usable interim). */
    confirmEmptyGroup?: boolean,
  ): Promise<void> {
    requirePermission(actor, "role.assign");
    userId = canonicalId(userId);
    if (actor.userId === userId) {
      throw new ForbiddenError("You cannot revoke your own role — ask another admin");
    }
    const role = await this.get(actor, roleId);
    const cleanReason = this.groupReason(role, reason);

    // B-8 / q149: removing the LAST Risk Manager is handed over to the designated interim, or accepted
    // (reason + second confirmation) and the group stays empty. Otherwise the group is never left empty.
    // Checked here, and the "not last" case again atomically in the repository.
    const isRiskManagerGroup = role.systemGroup === "RISK_MANAGER";
    let interim: GovernanceDesignation | null = null;
    let vacancy = false;
    if (isRiskManagerGroup) {
      // F-B8-05: the count excludes suspended users, so a suspended target is not in it.
      // F-PNL-02: removing someone who is not in the group is a 404, not a "last member" conflict.
      const targetRoles = await this.roles.listForUser(actor.tenantId, userId);
      if (!targetRoles.some((r) => r.id === roleId)) throw new NotFoundError("RoleAssignment", `${roleId}/${userId}`);
      const active = await this.roles.countActiveAssignments(actor.tenantId, roleId);
      const target = this.users ? await this.users.getById(actor.tenantId, userId) : null;
      const targetCounted = !target || !target.deletedAt;
      if ((targetCounted ? active - 1 : active) < 1) {
        interim = targetCounted ? await this.usableInterim(actor, userId, role, cleanReason ?? undefined) : null;
        if (!interim) {
          if (confirmEmptyGroup !== true) {
            throw new ValidationError(
              "Cannot remove the last member of the Risk Manager group without an interim: designate one, " +
                "or confirm that the group is left empty (confirmEmptyGroup)",
            );
          }
          vacancy = true;
        }
      }
    }

    const remaining = await this.roles.listForUser(actor.tenantId, userId);
    if (remaining.length <= 1 && remaining.some((r) => r.id === roleId)) {
      throw new ValidationError("Cannot revoke the user's last active role");
    }

    const revokedEvent = {
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: roleId,
      action: "ROLE_CHANGE" as const,
      oldValue: { roleId, userId, roleName: role.name },
      newValue: null,
      reason: cleanReason,
      requestId,
    };

    if (interim) {
      await this.handOverToInterim(actor, role, userId, interim, cleanReason, revokedEvent);
      return;
    }
    if (vacancy) {
      // q149: the exception is written in the same transaction as the removal.
      await this.roles.revokeFromUser(actor.tenantId, roleId, userId, {
        auditEvents: [{
          ...revokedEvent,
          newValue: { riskManagerGroupEmpty: true, confirmed: true },
          governanceException: RISK_MANAGER_VACANCY_EXCEPTION,
        }],
      });
      return;
    }

    await this.roles.revokeFromUser(actor.tenantId, roleId, userId, isRiskManagerGroup ? { minRemaining: 1 } : undefined);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: roleId,
      action: "ROLE_CHANGE",
      oldValue: { roleId, userId, roleName: role.name },
      newValue: null,
      reason: cleanReason,
      requestId,
    });
  }

  /**
   * R-3: the designated interim, if it can take over now: not yet used, before its end date, an active user, and
   * neither the leaving member nor the actor (the activation assigns a role: no self-attribution, DECISION-072).
   * Anything else = no usable interim (the exit then needs the q149 confirmation).
   */
  private async usableInterim(actor: AuthenticatedUser, leavingUserId: string, role: Role, reason: string | undefined): Promise<GovernanceDesignation | null> {
    const d = await this.designations?.getActive(actor.tenantId, "RISK_MANAGER_INTERIM");
    if (!d || d.activatedAt || !d.validUntil || d.validUntil.getTime() <= Date.now()) return null;
    if (d.userId === leavingUserId || d.userId === actor.userId) return null;
    const user = await this.users?.getById(actor.tenantId, d.userId);
    if (!user || user.deletedAt) return null;
    // F-PNL-01: an interim the cumul rules forbid (e.g. Risk Manager + Audit) is "no usable interim": q149 confirmation path.
    try {
      const held = await this.roles.listForUser(actor.tenantId, d.userId);
      await this.assertCumulRules(actor.tenantId, role, held, held, reason);
    } catch (e) {
      if (e instanceof ValidationError) return null;
      throw e;
    }
    return d;
  }

  private async handOverToInterim(
    actor: AuthenticatedUser,
    role: Role,
    leavingUserId: string,
    interim: GovernanceDesignation,
    reason: string | null,
    revokedEvent: Omit<AuditEvent, "id" | "timestamp">,
  ): Promise<void> {
    if (!this.roles.handOverLastRiskManager) throw new Error("RoleRepository.handOverLastRiskManager is required for an interim hand-over");
    let adminCumul = false;
    await this.roles.handOverLastRiskManager({
      tenantId: actor.tenantId,
      roleId: role.id,
      leavingUserId,
      interimUserId: interim.userId,
      designationId: interim.id,
      grantedBy: actor.userId,
      // Same cumul rules as an ordinary assignment (e.g. Risk Manager + Audit stays forbidden), replayed under the locks.
      recheck: async (locked, held) => {
        adminCumul = (await this.assertCumulRules(actor.tenantId, locked, held, held, reason ?? undefined)).createsAdminRiskManagerCumul;
      },
      audit: (assignment) => [
        revokedEvent,
        {
          ...revokedEvent,
          oldValue: null,
          newValue: { ...assignment, roleName: role.name, designationId: interim.id, handOverFrom: leavingUserId },
        },
      ],
    });
    if (adminCumul) await this.notifyAdminCumul(actor, interim.userId, "Risk Manager", revokedEvent.requestId);
  }

  /**
   * F-B8-01: suspending a user removes them from every group in practice, so
   * the Risk Manager "never empty" rule applies as for a revoke. Clear error
   * here; the atomic guard is in UserRepository.suspend.
   */
  async assertNotLastRiskManager(tenantId: string, userId: string): Promise<void> {
    const held = await this.roles.listForUser(tenantId, userId);
    const rm = held.find((r) => r.systemGroup === "RISK_MANAGER");
    if (rm && (await this.roles.countActiveAssignments(tenantId, rm.id)) <= 1) {
      throw new ValidationError("Cannot remove the last member of the Risk Manager group");
    }
  }

  async listForUser(actor: AuthenticatedUser, userId: string): Promise<Role[]> {
    requirePermission(actor, "role.read");
    return this.roles.listForUser(actor.tenantId, userId);
  }

  /**
   * SEC-005 (second half): the RBAC role list alone (`listForUser`) isn't
   * what actually gates a request — server.ts's identity resolver unions
   * it with `users.roles` (legacy/bootstrap grants) and BASE_PERMISSIONS
   * to get the permission set `requirePermission` checks against. This
   * mirrors that same computation so an admin can see what a user can
   * *actually* do, not just which named roles they hold.
   */
  async getEffectivePermissions(actor: AuthenticatedUser, userId: string): Promise<Permission[]> {
    requirePermission(actor, "role.read");
    if (!this.users) {
      throw new Error("RoleService.getEffectivePermissions requires a UserRepository");
    }

    const user = await this.users.getById(actor.tenantId, userId);
    if (!user) throw new NotFoundError("User", userId);

    const roles = await this.roles.listForUser(actor.tenantId, userId);
    const legacyPermissions = filterKnownPermissions(user.roles);
    const rolePermissions = roles.flatMap((r) => r.permissions);

    return Array.from(new Set([...BASE_PERMISSIONS, ...legacyPermissions, ...rolePermissions]));
  }

  /**
   * F7-S3: the same effective set as `getEffectivePermissions`, each permission with where it comes from — every
   * source, so the screen never has to guess: BASE (every account), DIRECT (legacy `users.roles`) or a held role.
   */
  async getEffectivePermissionSources(actor: AuthenticatedUser, userId: string): Promise<EffectivePermissionSource[]> {
    requirePermission(actor, "role.read");
    if (!this.users) {
      throw new Error("RoleService.getEffectivePermissionSources requires a UserRepository");
    }
    const user = await this.users.getById(actor.tenantId, userId);
    if (!user) throw new NotFoundError("User", userId);
    const roles = await this.roles.listForUser(actor.tenantId, userId);

    const sources = new Map<Permission, PermissionSource[]>();
    const add = (p: Permission, src: PermissionSource) => sources.set(p, [...(sources.get(p) ?? []), src]);
    for (const p of BASE_PERMISSIONS) add(p, { kind: "BASE" });
    for (const p of filterKnownPermissions(user.roles)) add(p, { kind: "DIRECT" });
    for (const r of roles) for (const p of r.permissions) add(p, { kind: "ROLE", roleId: r.id, roleName: r.name, systemGroup: r.systemGroup });
    return [...sources].map(([permission, from]) => ({ permission, sources: from }));
  }

  // -- B-8 bis ----------------------------------------------------------

  /** Fixed groups a user belongs to (no permission check: callers already authorized the read). */
  async fixedGroupsOf(tenantId: string, userId: string): Promise<SystemGroup[]> {
    const held = await this.roles.listForUser(tenantId, userId);
    return held.flatMap((r) => (r.systemGroup ? [r.systemGroup] : []));
  }

  /** q63: true when the user is both application administrator (see ADMIN_PERMISSIONS) and in the Risk Manager group. */
  async isAdminAndRiskManager(tenantId: string, userId: string): Promise<boolean> {
    const held = await this.roles.listForUser(tenantId, userId);
    return isAdministrator(held) && isRiskManagerMember(held);
  }

  private notifyAdminCumul(actor: AuthenticatedUser, userId: string, group: string, requestId: string): Promise<void> {
    return this.notifyMembers(actor, "rolegroup.audit.validate", userId, userId, "ADMIN_RISK_MANAGER_CUMUL",
      `Un utilisateur cumule désormais l'administration de l'application et le groupe ${group}.`, requestId);
  }

  /** q104: true when the user is both application administrator and in the Audit group. */
  async isAdminAndAudit(tenantId: string, userId: string): Promise<boolean> {
    const held = await this.roles.listForUser(tenantId, userId);
    return isAdministrator(held) && isAuditGroupMember(held);
  }

  /** q80: true when the user is both application administrator and in the Committee group. */
  async isAdminAndCommittee(tenantId: string, userId: string): Promise<boolean> {
    const held = await this.roles.listForUser(tenantId, userId);
    return isAdministrator(held) && isCommitteeMember(held);
  }

  /**
   * q94: a user who still holds a forbidden cumul (Risk Manager + Committee, or + Audit) created before the rule
   * cannot be silently reactivated with it. No-op for everyone else.
   */
  async assertReactivable(tenantId: string, userId: string): Promise<void> {
    const held = await this.roles.listForUser(tenantId, userId);
    for (const r of held) assertNoCumul(r, held.filter((o) => o.id !== r.id));
  }

  /** F-B8-06: roles disabled while the user was suspended whose assignment remains (rights silently lost). */
  async listLostRoles(tenantId: string, userId: string): Promise<Role[]> {
    return (await this.roles.listDisabledForUser?.(tenantId, userId)) ?? [];
  }

  /**
   * q45: only the application administrator (rolegroup.audit.update) changes the
   * Audit group's permissions. If the actor is also a Risk Manager or a Committee member the change is
   * queued until a member of Audit or the Committee validates it.
   * F-B8b-01: read-only whitelist. F-B8b-02: mandatory reason, members notified.
   * F-B8b-04: a single PENDING change per group.
   */
  /** q179 (DECISION-095): which fixed group(s) carry each of the four governance decision rights. */
  async governanceRights(actor: AuthenticatedUser): Promise<Array<{ permission: GovernanceDecisionRight; groups: SystemGroup[] }>> {
    requirePermission(actor, "role.read");
    return this.governanceRightsOf(actor.tenantId);
  }

  private async governanceRightsOf(tenantId: string): Promise<Array<{ permission: GovernanceDecisionRight; groups: SystemGroup[] }>> {
    const groups = (await this.roles.list(tenantId)).filter((r) => r.systemGroup);
    return GOVERNANCE_DECISION_RIGHTS.map((permission) => ({
      permission,
      groups: groups.filter((r) => r.permissions.includes(permission)).map((r) => r.systemGroup!),
    }));
  }

  /**
   * q179 (DECISION-095): an administrator chooses the fixed group(s) carrying one governance decision right. Mandatory
   * reason; every refusal is raised before the first write. The groups changed directly (Risk Manager / Committee, and
   * the Audit when no validation is needed) and their audit rows are written in one transaction; an Audit change that
   * needs validation goes through the Audit circuit (PENDING). Refused: an ordinary role, the Audit for anything but the review
   * (q157), no group at all, a group the administrator belongs to.
   */
  async setGovernanceRightGroups(
    actor: AuthenticatedUser,
    permission: string,
    groups: SystemGroup[],
    reason: string,
    requestId: string,
  ): Promise<{ permission: GovernanceDecisionRight; groups: SystemGroup[]; auditChangePending: boolean }> {
    requirePermission(actor, "role.update");
    if (!isGovernanceDecisionRight(permission)) throw new ValidationError(`Not a governance decision right: ${permission}`);
    const why = reason?.trim() ?? "";
    if (!why) throw new ValidationError("A reason is required to change which groups carry a governance decision right");
    if (why.length > MAX_GROUP_REASON_LENGTH) throw new ValidationError(`reason must be at most ${MAX_GROUP_REASON_LENGTH} characters`);
    const wanted = [...new Set(groups)];
    if (wanted.length === 0) throw new ValidationError("At least one fixed group must carry a governance decision right");
    const refused = wanted.filter((g) => !governanceRightAllowedOn(permission, g));
    if (refused.length > 0) throw new ValidationError(`The Audit group never confirms nor approves (q157): ${permission}`);

    const fixed = (await this.roles.list(actor.tenantId)).filter((r) => r.systemGroup);
    const changes = fixed.filter((r) => r.permissions.includes(permission) !== wanted.includes(r.systemGroup!));
    const missing = wanted.filter((g) => !fixed.some((r) => r.systemGroup === g));
    if (missing.length > 0) throw new NotFoundError("Role", missing.join(", "));
    // Checked for every group BEFORE the first write, so that a refusal never leaves the right half moved.
    const held = await this.roles.listForUser(actor.tenantId, actor.userId);
    if (changes.some((r) => held.some((h) => h.id === r.id))) {
      throw new ForbiddenError("You cannot change the permissions of a group you belong to — ask another admin");
    }
    const auditChange = changes.find((r) => r.systemGroup === "AUDIT");
    // QA-SUITES2-02: every refusal of the Audit circuit is raised here too, before the first write.
    let auditChangePending = false;
    if (auditChange) {
      requirePermission(actor, "rolegroup.audit.update");
      const pending = await this.permissionChanges?.list?.(actor.tenantId, { status: "PENDING", roleId: auditChange.id });
      if (pending && pending.length > 0) {
        throw new ValidationError("A change of the Audit group permissions is already pending validation");
      }
      auditChangePending = auditChangeNeedsValidation(held);
      // A queued Audit change leaves the Audit as it is: the right must still be carried by a group meanwhile.
      const carriedNow = wanted.filter((g) => g !== "AUDIT" || !auditChangePending).length
        + (auditChangePending && auditChange.permissions.includes(permission) ? 1 : 0);
      if (carriedNow === 0) {
        throw new ValidationError("At least one fixed group must carry a governance decision right while the Audit change awaits validation");
      }
    }
    const toggled = (role: Role) => role.permissions.includes(permission)
      ? role.permissions.filter((p) => p !== permission)
      : [...role.permissions, permission];

    // SEC-SA2-03: the groups changed directly and their audit rows are written in one transaction.
    const direct = changes.filter((r) => r.systemGroup !== "AUDIT" || !auditChangePending);
    if (direct.length > 0) {
      const rows = (after: Role[]) => after.map((role) => ({
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "Role",
        entityId: role.id,
        action: "PERMISSION_CHANGE" as const,
        oldValue: direct.find((r) => r.id === role.id)!,
        newValue: role,
        reason: why,
        requestId,
      }));
      const list = direct.map((r) => ({ id: r.id, permissions: toggled(r) }));
      if (this.roles.setGroupPermissions) {
        await this.roles.setGroupPermissions(actor.tenantId, list, rows, actor.userId);
      } else {
        const after: Role[] = [];
        for (const c of list) after.push(await this.roles.update(actor.tenantId, c.id, { permissions: c.permissions }));
        for (const e of rows(after)) await this.audit.record(e);
      }
    }
    if (auditChange && auditChangePending) await this.changeAuditGroupPermissions(actor, toggled(auditChange), requestId, why);
    // The answer to a write never needs role.read on top of role.update (Codex PR #199).
    const now = (await this.governanceRightsOf(actor.tenantId)).find((r) => r.permission === permission)!;
    return { ...now, auditChangePending };
  }

  async changeAuditGroupPermissions(
    actor: AuthenticatedUser,
    permissions: Permission[],
    requestId: string,
    reason?: string,
  ): Promise<{ status: "APPLIED"; role: Role } | { status: "PENDING"; changeId: string }> {
    requirePermission(actor, "rolegroup.audit.update");
    const cleanReason = reason?.trim() ?? "";
    if (!cleanReason) throw new ValidationError("A reason is required to change the permissions of the Audit group");
    if (cleanReason.length > MAX_GROUP_REASON_LENGTH) {
      throw new ValidationError(`reason must be at most ${MAX_GROUP_REASON_LENGTH} characters`);
    }
    assertKnownPermissions(permissions);
    const notReadOnly = permissions.filter((p) => !isAuditGroupPermission(p));
    if (notReadOnly.length > 0) {
      throw new ValidationError(`The Audit group is read-only: not allowed (${notReadOnly.join(", ")})`);
    }
    const group = (await this.roles.list(actor.tenantId)).find((r) => r.systemGroup === "AUDIT");
    if (!group) throw new NotFoundError("Role", "AUDIT");
    const held = await this.roles.listForUser(actor.tenantId, actor.userId);
    if (held.some((r) => r.id === group.id)) {
      throw new ForbiddenError("You cannot change the permissions of a group you belong to");
    }
    const pending = await this.permissionChanges?.list?.(actor.tenantId, { status: "PENDING", roleId: group.id });
    if (pending && pending.length > 0) {
      throw new ValidationError("A change of the Audit group permissions is already pending validation");
    }

    // G1 (DECISION-044): an administrator who is also a Committee member would otherwise apply alone, like a Risk Manager.
    if (auditChangeNeedsValidation(held)) {
      if (!this.permissionChanges) throw new Error("RoleService requires a RolePermissionChangeRepository");
      const change = await this.permissionChanges.create({
        tenantId: actor.tenantId,
        roleId: group.id,
        permissions,
        requestedBy: actor.userId,
        reason: cleanReason,
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "RolePermissionChange",
        entityId: change.id,
        action: "PERMISSION_CHANGE",
        oldValue: { permissions: group.permissions },
        newValue: { status: "PENDING", permissions },
        reason: cleanReason,
        requestId,
      });
      await this.notifyValidators(actor, change.id, requestId);
      return { status: "PENDING", changeId: change.id };
    }

    const role = await this.roles.update(actor.tenantId, group.id, { permissions });
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: group.id,
      action: "PERMISSION_CHANGE",
      oldValue: group,
      newValue: role,
      reason: cleanReason,
      requestId,
    });
    return { status: "APPLIED", role };
  }

  /** Best effort: the action is already stored and audited; a notification failure must not undo it. */
  private async notifyMembers(
    actor: AuthenticatedUser,
    permission: string,
    excludeUserId: string | null,
    resourceId: string,
    eventType: string,
    message: string,
    requestId: string,
  ): Promise<void> {
    if (!this.notifications || !this.users?.listWithPermission) return;
    try {
      const members = await this.users.listWithPermission(actor.tenantId, permission, actor.userId);
      for (const v of members.filter((m) => m.id !== excludeUserId)) {
        await this.notifications.record({
          tenantId: actor.tenantId,
          recipientUserId: v.id,
          resourceType: "MANAGEMENT",
          resourceId,
          eventType,
          message,
          triggeredBy: actor.userId,
          requestId,
        });
      }
    } catch (err) {
      console.error(`${eventType} ${resourceId}: members could not be notified (requestId ${requestId})`, err instanceof Error ? err.message : err);
    }
  }

  /** F-B8b-02: tells the validators (Audit, Committee) that a change of Audit rights waits for them. */
  private notifyValidators(actor: AuthenticatedUser, changeId: string, requestId: string): Promise<void> {
    return this.notifyMembers(actor, "rolegroup.audit.validate", null, changeId, "AUDIT_RIGHTS_CHANGE_PENDING",
      "Un changement des droits du groupe Audit attend votre validation.", requestId);
  }

  /**
   * F-B8b-02: lets a validator read the before/after of the changes waiting for them.
   * Only rolegroup.audit.validate holders (Audit, Committee) see it.
   */
  async listPermissionChanges(
    actor: AuthenticatedUser,
    status: RolePermissionChangeStatus,
  ): Promise<
    Array<{
      id: string;
      roleId: string;
      roleName: string;
      status: RolePermissionChangeStatus;
      requestedBy: string;
      reason: string | null;
      createdAt: Date;
      before: Permission[];
      after: Permission[];
      added: Permission[];
      removed: Permission[];
    }>
  > {
    requirePermission(actor, "rolegroup.audit.validate");
    const changes = (await this.permissionChanges?.list?.(actor.tenantId, { status })) ?? [];
    const out = [];
    for (const c of changes) {
      const role = await this.roles.getById(actor.tenantId, c.roleId);
      const before = role?.permissions ?? [];
      out.push({
        id: c.id,
        roleId: c.roleId,
        roleName: role?.name ?? "",
        status: c.status,
        requestedBy: c.requestedBy,
        reason: c.reason ?? null,
        createdAt: c.createdAt,
        before,
        after: c.permissions,
        added: c.permissions.filter((p) => !before.includes(p)),
        removed: before.filter((p) => !c.permissions.includes(p)),
      });
    }
    return out;
  }

  /** q45 maker-checker: a member of Audit or the Committee (never the author) approves or rejects. */
  async decideAuditPermissionChange(
    actor: AuthenticatedUser,
    changeId: string,
    approve: boolean,
    requestId: string,
  ): Promise<void> {
    requirePermission(actor, "rolegroup.audit.validate");
    if (!this.permissionChanges) throw new Error("RoleService requires a RolePermissionChangeRepository");
    const change = await this.permissionChanges.getById(actor.tenantId, changeId);
    if (!change) throw new NotFoundError("RolePermissionChange", changeId);
    if (change.status !== "PENDING") throw new ValidationError("This change has already been decided");
    if (change.requestedBy === actor.userId) {
      throw new ForbiddenError("The author of a permission change cannot validate it");
    }
    const held = await this.roles.listForUser(actor.tenantId, actor.userId);
    if (!held.some((r) => r.systemGroup === "AUDIT" || r.systemGroup === "RISK_COMMITTEE")) {
      throw new ForbiddenError("Only a member of the Audit group or of the Committee can validate this change");
    }
    // F-B8b-02: the validator is independent of the risk team (a Risk Manager + Committee member is not).
    if (held.some((r) => r.systemGroup === "RISK_MANAGER")) {
      throw new ForbiddenError("A Risk Manager cannot validate a change of the Audit group permissions");
    }

    // F-B8t-03: the whitelist is checked again at approval (a PENDING stored before it existed must not be applied).
    if (approve) {
      const notReadOnly = change.permissions.filter((p) => !isAuditGroupPermission(p));
      if (notReadOnly.length > 0) {
        throw new ValidationError(`The Audit group is read-only: not allowed (${notReadOnly.join(", ")}) — reject this change`);
      }
    }

    const claimed = await this.permissionChanges.decide(
      actor.tenantId,
      changeId,
      approve ? "APPROVED" : "REJECTED",
      actor.userId,
    );
    if (!claimed) throw new ValidationError("This change has already been decided");

    // F-B8t-04: no cross-repository transaction exists. If the application itself fails the claim is undone
    // (nothing was applied). Once the rights ARE applied the change is never reopened: a failed audit write
    // is logged and the error returned, but the status stays APPROVED so it matches the stored rights.
    let before: Role | null = null;
    let after: Role | null = null;
    if (approve) {
      try {
        before = await this.roles.getById(actor.tenantId, change.roleId);
        after = await this.roles.update(actor.tenantId, change.roleId, { permissions: change.permissions });
      } catch (err) {
        // F-B8q-03(a): the update may have been committed with the response lost. If the stored rights already
        // equal the change, it IS applied: keep APPROVED and carry on to the audit write instead of reopening.
        const current = await this.roles.getById(actor.tenantId, change.roleId).catch(() => null);
        const wanted = new Set(change.permissions);
        if (current && new Set(current.permissions).size === wanted.size
            && [...wanted].every((p) => current.permissions.includes(p))) {
          after = current;
        } else {
          try {
            // F-B8q-03(b): reopen is a no-op (false) if another PENDING exists for this role.
            const reopened = await this.permissionChanges.reopen?.(actor.tenantId, changeId);
            if (reopened === false) {
              console.error(`Audit-rights change ${changeId}: application failed but it could not be reopened (another change is PENDING); it stays APPROVED without applied rights`);
            }
          } catch (reopenErr) {
            console.error(`Audit-rights change ${changeId}: could not be reopened after a failed application`, reopenErr instanceof Error ? reopenErr.message : reopenErr);
          }
          throw err;
        }
      }
    }
    try {
      if (approve) {
        await this.audit.record({
          tenantId: actor.tenantId,
          userId: actor.userId,
          entityType: "Role",
          entityId: change.roleId,
          action: "PERMISSION_CHANGE",
          oldValue: before,
          newValue: after,
          reason: `Validation of change ${changeId} requested by ${change.requestedBy}`,
          requestId,
        });
      }
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "RolePermissionChange",
        entityId: changeId,
        action: approve ? "APPROVE" : "REJECT",
        oldValue: { status: "PENDING" },
        newValue: { status: approve ? "APPROVED" : "REJECTED" },
        reason: null,
        requestId,
      });
    } catch (err) {
      console.error(`Audit-rights change ${changeId}: ${approve ? "APPROVED, rights applied" : "REJECTED"} but the audit write failed (requestId ${requestId})`, err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * q48 (F-B8-06), explicit exception to DECISION-011/q02, limited to this case:
   * for a denied permission, the active users of the tenant who can give it back
   * (holders of role.assign, if an active role carries the permission). Any
   * authenticated user may ask; only display names are returned, and every call is audited.
   */
  async listGrantors(
    actor: AuthenticatedUser,
    permission: Permission,
    requestId: string,
  ): Promise<{ permission: Permission; grantors: Array<{ displayName: string }> }> {
    if (!ALL_PERMISSIONS.includes(permission)) throw new ValidationError(`Unknown permission: ${permission}`);
    if (!this.users?.listWithPermission) throw new Error("RoleService.listGrantors requires a UserRepository");
    // F-B8b-03: nothing to ask for a permission already held, or for an administration / governance one.
    if (actor.roles.includes(permission) || NOT_REQUESTABLE.test(permission)) return { permission, grantors: [] };
    const carried = (await this.roles.list(actor.tenantId)).some((r) => r.permissions.includes(permission));
    const found = carried ? await this.users.listWithPermission(actor.tenantId, "role.assign", actor.userId) : [];
    // One audit row per (user, permission, hour).
    const key = `${actor.tenantId}:${actor.userId}:${permission}:${Math.floor(Date.now() / 3_600_000)}`;
    if (!this.grantorsSeen.has(key)) {
      if (this.grantorsSeen.size >= GRANTORS_DEDUPE_MAX) this.grantorsSeen.clear();
      this.grantorsSeen.add(key);
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "PermissionGrantorsLookup",
        entityId: actor.userId,
        action: "READ",
        oldValue: null,
        newValue: { permission, returned: found.length },
        reason: null,
        requestId,
      });
    }
    return { permission, grantors: found.map((u) => ({ displayName: u.displayName })) };
  }
}

/** G1 (DECISION-044): an administrator who is also a Risk Manager or a Committee member never changes the Audit alone. */
function auditChangeNeedsValidation(held: Role[]): boolean {
  return held.some((r) => r.systemGroup === "RISK_MANAGER" || isCommitteeRole(r));
}

export type PermissionSource =
  | { kind: "BASE" }
  | { kind: "DIRECT" }
  | { kind: "ROLE"; roleId: string; roleName: string; systemGroup: SystemGroup | null };
export interface EffectivePermissionSource {
  permission: Permission;
  sources: PermissionSource[];
}
