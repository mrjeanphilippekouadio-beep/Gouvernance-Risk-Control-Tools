import { Router } from "express";
import { z } from "zod";
import type { RoleService } from "../../services/RoleService.js";
import { ALL_PERMISSIONS, type Permission } from "../../domain/permissions.js";
import { DASHBOARD_SCOPE_MODES, type DashboardScopeMode } from "../../domain/entities/DashboardScope.js";

const PermissionEnum = z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]);
// PROCESS is a valid enum value here too (kept in sync with the DB CHECK
// / TS type) — RoleService.create/update is what actually rejects it at
// the write boundary, with a message pointing at the unfinished backfill.
const DashboardScopeModeEnum = z.enum(DASHBOARD_SCOPE_MODES as [DashboardScopeMode, ...DashboardScopeMode[]]);

const CreateRoleBody = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  permissions: z.array(PermissionEnum).min(1),
  dashboardScopeMode: DashboardScopeModeEnum.optional(),
});

const UpdateRoleBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  permissions: z.array(PermissionEnum).min(1).optional(),
  dashboardScopeMode: DashboardScopeModeEnum.optional(),
});

const AssignmentBody = z.object({ userId: z.string().min(1) });

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
      const role = await roleService.update(req.user, req.params["id"] as string, body, req.requestId);
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
      await roleService.assignToUser(req.user, req.params["id"] as string, body.userId, req.requestId);
      res.status(201).json({ data: { status: "ASSIGNED" } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/revoke", async (req, res, next) => {
    try {
      const body = AssignmentBody.parse(req.body);
      await roleService.revokeFromUser(req.user, req.params["id"] as string, body.userId, req.requestId);
      res.json({ data: { status: "REVOKED" } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
