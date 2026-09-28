import { Router } from "express";
import { z } from "zod";
import type { ModuleToggleService } from "../../services/ModuleToggleService.js";

const ToggleBody = z.object({ enabled: z.boolean() });

/** ACT-221 — see ModuleToggleService for why this is storage-only (no route-blocking middleware yet). */
export function moduleTogglesRouter(moduleToggleService: ModuleToggleService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const toggles = await moduleToggleService.list(req.user);
      res.json({ data: toggles });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:name/toggle", async (req, res, next) => {
    try {
      const body = ToggleBody.parse(req.body);
      const toggle = await moduleToggleService.toggle(req.user, req.params["name"] as string, body.enabled, req.requestId);
      res.json({ data: toggle });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
