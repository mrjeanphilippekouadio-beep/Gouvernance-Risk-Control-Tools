import { Router } from "express";
import { z } from "zod";
import type { UserService } from "../../services/UserService.js";

const CreateUserBody = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  roleId: z.string().min(1),
  departmentId: z.string().nullish(),
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

  // ACT-105: admin-only (user.read), tenant-scoped, paginated.
  router.get("/", async (req, res, next) => {
    try {
      const includeSuspended = req.query["includeSuspended"] === "true";
      const limit = req.query["limit"] ? Number(req.query["limit"]) : undefined;
      const offset = req.query["offset"] ? Number(req.query["offset"]) : undefined;
      const result = await userService.list(req.user, { includeSuspended, limit, offset });
      res.json({ data: result.users, total: result.total });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const user = await userService.get(req.user, req.params["id"] as string);
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
      await userService.suspend(req.user, req.params["id"] as string, req.requestId);
      res.json({ data: { status: "SUSPENDED" } });
    } catch (err) {
      next(err);
    }
  });

  // ACT-103: maker-checker counterpart to suspend.
  router.patch("/:id/reactivate", async (req, res, next) => {
    try {
      const user = await userService.reactivate(req.user, req.params["id"] as string, req.requestId);
      res.json({ data: user });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
