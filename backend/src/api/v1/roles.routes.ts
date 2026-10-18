import { Router } from "express";
import { z } from "zod";
import { boundedArray } from "../validation.js";
import type { RoleService } from "../../services/RoleService.js";
import { ALL_PERMISSIONS, type Permission } from "../../domain/permissions.js";
import { grantorsRateLimiter } from "../middleware/rateLimit.js";
import { DASHBOARD_SCOPE_MODES, type DashboardScopeMode } from "../../domain/entities/DashboardScope.js";

const PermissionEnum = z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]);
// PROCESS is a valid enum value here too (kept in sync with the DB CHECK
// / TS type) — RoleService.create/update is what actually rejects it at
// the write boundary, with a message pointing at the unfinished backfill.
const DashboardScopeModeEnum = z.enum(DASHBOARD_SCOPE_MODES as [DashboardScopeMode, ...DashboardScopeMode[]]);

const CreateRoleBody = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  permissions: boundedArray(PermissionEnum, ALL_PERMISSIONS.length, 1),
  dashboardScopeMode: DashboardScopeModeEnum.optional(),
  departmentId: z.guid().nullish(),
});

const UpdateRoleBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  permissions: boundedArray(PermissionEnum, ALL_PERMISSIONS.length, 1).optional(),
  dashboardScopeMode: DashboardScopeModeEnum.optional(),
  departmentId: z.guid().nullish(),
  /** F-B8t-01: required only when widening the role creates an administrator + Risk Manager cumul. */
  reason: z.string().trim().min(1).max(500).optional(),
});

// B-8 bis (q44): validated and bounded here, required by the service for the 3 fixed groups.
const AssignmentBody = z.object({ userId: z.string().min(1), reason: z.string().trim().min(1).max(500).optional() });
// q149: second confirmation to remove the last Risk Manager when no interim can take over.
const RevokeBody = AssignmentBody.extend({ confirmEmptyGroup: z.boolean().optional() });
// F-B8b-02 (q56): the reason is mandatory.
const AuditGroupPermissionsBody = z.object({
  permissions: boundedArray(PermissionEnum, ALL_PERMISSIONS.length, 1),
  reason: z.string().trim().min(1).max(500),
});
const PermissionChangesQuery = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING") });
const GrantorsQuery = z.object({ permission: PermissionEnum });

export function rolesRouter(roleService: RoleService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const includeDisabled = req.query["includeDisabled"] === "true";
      const roles = await roleService.list(req.user, includeDisabled);
      res.json({ data: roles });
    } catch (err) {
      next(err);
    }
  });

  // ACT-118: IAM matrix — the permission set for every role side by side.
  // Registered before "/:id" so "matrix" isn't parsed as a role id.
  router.get("/matrix", async (req, res, next) => {
    try {
      const roles = await roleService.list(req.user, false);
      res.json({ data: roles.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions })) });
    } catch (err) {
      next(err);
    }
  });

  // B-8 bis (q48): who can give a denied permission back. Any authenticated user; display names only; audited.
  router.get("/grantors", grantorsRateLimiter(), async (req, res, next) => {
    try {
      const { permission } = GrantorsQuery.parse(req.query);
      const result = await roleService.listGrantors(req.user, permission, req.requestId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // B-8 bis (q45): Audit group permissions — applied, or PENDING when the admin is also a Risk Manager.
  router.put("/audit-group/permissions", async (req, res, next) => {
    try {
      const body = AuditGroupPermissionsBody.parse(req.body);
      const result = await roleService.changeAuditGroupPermissions(req.user, body.permissions, req.requestId, body.reason);
      res.status(result.status === "PENDING" ? 202 : 200).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // F-B8b-02: the validator reads the before/after of a change before deciding (rolegroup.audit.validate, checked by the service).
  router.get("/permission-changes", async (req, res, next) => {
    try {
      const { status } = PermissionChangesQuery.parse(req.query);
      const data = await roleService.listPermissionChanges(req.user, status);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post("/permission-changes/:id/approve", async (req, res, next) => {
    try {
      const id = z.guid().parse(req.params["id"]);
      await roleService.decideAuditPermissionChange(req.user, id, true, req.requestId);
      res.json({ data: { status: "APPROVED" } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/permission-changes/:id/reject", async (req, res, next) => {
    try {
      const id = z.guid().parse(req.params["id"]);
      await roleService.decideAuditPermissionChange(req.user, id, false, req.requestId);
      res.json({ data: { status: "REJECTED" } });
    } catch (err) {
      next(err);
    }
  });

  // ACT-115: also registered before "/:id" for the same reason.
  router.get("/users/:userId", async (req, res, next) => {
    try {
      const roles = await roleService.listForUser(req.user, req.params["userId"] as string);
      res.json({ data: roles });
    } catch (err) {
      next(err);
    }
  });

  // SEC-005: the RBAC role names above aren't the full picture — this
  // returns the actual effective permission set (legacy users.roles +
  // BASE_PERMISSIONS + every held role's permissions), same computation
  // server.ts's identity resolver uses to gate requests.
  router.get("/users/:userId/permissions", async (req, res, next) => {
    try {
      const permissions = await roleService.getEffectivePermissions(req.user, req.params["userId"] as string);
      res.json({ data: permissions });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const role = await roleService.get(req.user, req.params["id"] as string);
      res.json({ data: role });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateRoleBody.parse(req.body);
      const role = await roleService.create(req.user, body, req.requestId);
      res.status(201).json({ data: role });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const body = UpdateRoleBody.parse(req.body);
      const { reason, ...input } = body;
      const role = await roleService.update(req.user, req.params["id"] as string, input, req.requestId, reason);
      res.json({ data: role });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/disable", async (req, res, next) => {
    try {
      await roleService.disable(req.user, req.params["id"] as string, req.requestId);
      res.json({ data: { status: "DISABLED" } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/assign", async (req, res, next) => {
    try {
      const body = AssignmentBody.parse(req.body);
      await roleService.assignToUser(req.user, req.params["id"] as string, body.userId, req.requestId, body.reason);
      res.status(201).json({ data: { status: "ASSIGNED" } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/revoke", async (req, res, next) => {
    try {
      const body = RevokeBody.parse(req.body);
      await roleService.revokeFromUser(req.user, req.params["id"] as string, body.userId, req.requestId, body.reason, body.confirmEmptyGroup);
      res.json({ data: { status: "REVOKED" } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
