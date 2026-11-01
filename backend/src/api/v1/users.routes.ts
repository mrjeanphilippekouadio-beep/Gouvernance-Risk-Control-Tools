import { Router } from "express";
import { z } from "zod";
import { reasonText } from "../validation.js";
import type { UserService } from "../../services/UserService.js";
import { ValidationError } from "../../domain/errors/DomainErrors.js";

const CreateUserBody = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  roleId: z.string().min(1),
  departmentId: z.string().nullish(),
  reason: reasonText().optional(),
});

const ReasonBody = z.object({ reason: reasonText() }).strict();

const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const UpdateUserBody = z.object({
  displayName: z.string().min(1).optional(),
  departmentId: z.string().nullish(),
});

export function usersRouter(userService: UserService): Router {
  const router = Router();

  // ACT-104: registered before "/:id" so "me" is never parsed as a user id.
  router.get("/me", async (req, res, next) => {
    try {
      const user = await userService.getSelf(req.user);
      res.json({ data: user });
    } catch (err) {
      next(err);
    }
  });

  // Lot F4: the caller's own permissions; also registered before "/:id".
  router.get("/me/permissions", async (req, res, next) => {
    try {
      const permissions = await userService.getSelfPermissions(req.user);
      res.json({ data: permissions });
    } catch (err) {
      next(err);
    }
  });

  // Lot F4: account picker for the designation screens (id + name of active accounts).
  router.get("/directory", async (req, res, next) => {
    try {
      // q205: `?q=` is the name search (also open to risk.create / risk.update); without it, the full list.
      const q = req.query["q"];
      if (q !== undefined) {
        if (typeof q !== "string") throw new ValidationError("q must be a single string");
        res.json({ data: await userService.searchDirectory(req.user, q) });
        return;
      }
      res.json({ data: await userService.directory(req.user) });
    } catch (err) {
      next(err);
    }
  });

  // ACT-105: admin-only (user.read), tenant-scoped, paginated.
  router.get("/", async (req, res, next) => {
    try {
      const includeSuspended = req.query["includeSuspended"] === "true";
      const { limit, offset } = PaginationQuery.parse(req.query);
      const result = await userService.list(req.user, { includeSuspended, limit, offset });
      res.json({ data: result.users, total: result.total });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const user = await userService.getDetail(req.user, req.params["id"] as string);
      res.json({ data: user });
    } catch (err) {
      next(err);
    }
  });

  // ACT-100: initial RBAC role is mandatory (roleId), see UserService.create.
  router.post("/", async (req, res, next) => {
    try {
      const body = CreateUserBody.parse(req.body);
      const user = await userService.create(req.user, body, req.requestId);
      res.status(201).json({ data: user });
    } catch (err) {
      next(err);
    }
  });

  // ACT-101: profile edit — display name only.
  router.put("/:id", async (req, res, next) => {
    try {
      const body = UpdateUserBody.parse(req.body);
      const user = await userService.update(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: user });
    } catch (err) {
      next(err);
    }
  });

  // ACT-102/ACT-107: soft-delete; blocks all future auth on the next request (see UserService doc comment).
  router.patch("/:id/suspend", async (req, res, next) => {
    try {
      const { reason } = ReasonBody.parse(req.body);
      await userService.suspend(req.user, req.params["id"] as string, req.requestId, reason);
      res.json({ data: { status: "SUSPENDED" } });
    } catch (err) {
      next(err);
    }
  });

  // ACT-103: maker-checker counterpart to suspend.
  router.patch("/:id/reactivate", async (req, res, next) => {
    try {
      const { reason } = ReasonBody.parse(req.body);
      const user = await userService.reactivate(req.user, req.params["id"] as string, req.requestId, reason);
      res.json({ data: user });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
