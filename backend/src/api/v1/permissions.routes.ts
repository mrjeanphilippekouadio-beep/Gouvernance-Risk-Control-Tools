import { Router } from "express";
import { ALL_PERMISSIONS } from "../../domain/permissions.js";

/**
 * The catalog of permission strings that exist, e.g. to render a
 * checklist when defining a role (ACT-116). No secrets in here — any
 * authenticated user can see which permissions *exist*, that's not the
 * same as holding them.
 */
export function permissionsRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ data: ALL_PERMISSIONS });
  });

  return router;
}
