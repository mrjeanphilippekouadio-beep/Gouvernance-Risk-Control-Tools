import { Router } from "express";
import { z } from "zod";
import type { TenantService } from "../../services/TenantService.js";

const DeploymentMode = z.enum(["managed_saas", "customer_managed", "on_premise"]);

const CreateTenantBody = z.object({
  name: z.string().min(1),
  deploymentMode: DeploymentMode.optional(),
});

const UpdateTenantBody = z.object({
  name: z.string().min(1).optional(),
  deploymentMode: DeploymentMode.optional(),
  active: z.boolean().optional(),
});

/** ACT-222 — super-admin tenant management, see TenantService for why it isn't tenant-scoped. */
export function tenantsRouter(tenantService: TenantService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const tenants = await tenantService.list(req.user);
      res.json({ data: tenants });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const tenant = await tenantService.get(req.user, req.params["id"] as string);
      res.json({ data: tenant });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateTenantBody.parse(req.body);
      const tenant = await tenantService.create(req.user, body, req.requestId);
      res.status(201).json({ data: tenant });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const body = UpdateTenantBody.parse(req.body);
      const tenant = await tenantService.update(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: tenant });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
