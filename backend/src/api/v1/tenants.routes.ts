import { Router } from "express";
import { z } from "zod";
import type { TenantService } from "../../services/TenantService.js";
import { MAX_TENANT_NAME } from "../../services/TenantService.js";
import { reasonText } from "../validation.js";
import { requireSuperAdmin } from "../../domain/permissions.js";
import { ValidationError } from "../../domain/errors/DomainErrors.js";

const DeploymentMode = z.enum(["managed_saas", "customer_managed", "on_premise"]);

// QA-F8-03: the offending field is named in the refusal (the generic errorHandler message does not).
const TenantName = z
  .string({ error: "Le nom du client est obligatoire." })
  .trim()
  .min(1, "Le nom du client est obligatoire.")
  .max(MAX_TENANT_NAME, `Le nom du client doit faire au plus ${MAX_TENANT_NAME} caractères.`);

const CreateTenantBody = z.strictObject({
  name: TenantName,
  deploymentMode: DeploymentMode.optional(),
});

// SEC-F8-02: `active` is refused (strict): deactivation / reactivation are dedicated routes with a reason.
const UpdateTenantBody = z.strictObject({
  name: TenantName.optional(),
  deploymentMode: DeploymentMode.optional(),
});

const ReasonBody = z.strictObject({
  reason: reasonText(500),
});

/** ACT-222 / q260 — platform super-administrator client management, see TenantService for why it isn't tenant-scoped. */
export function tenantsRouter(tenantService: TenantService): Router {
  const router = Router();

  const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const result = schema.safeParse(body);
    if (result.success) return result.data;
    const issue = result.error.issues[0];
    const field = issue?.path.length ? String(issue.path[0]) : "";
    const message = issue?.code === "unrecognized_keys" ? `Champ non accepté : ${(issue as { keys: string[] }).keys.join(", ")}.` : issue?.message;
    throw new ValidationError(
      field && issue?.code !== "unrecognized_keys" && !message?.includes(field) ? `${message} (${field})` : (message ?? "Requête invalide."),
    );
  };

  // q260: deny first, before any parsing: only a platform super-administrator reaches these routes.
  router.use((req, _res, next) => {
    try {
      requireSuperAdmin(req.user);
      next();
    } catch (err) {
      next(err);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      res.json({ data: await tenantService.list(req.user) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      res.json({ data: await tenantService.get(req.user, req.params["id"] as string) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = parse(CreateTenantBody, req.body);
      res.status(201).json({ data: await tenantService.create(req.user, body, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const body = parse(UpdateTenantBody, req.body);
      res.json({ data: await tenantService.update(req.user, req.params["id"] as string, body, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/deactivate", async (req, res, next) => {
    try {
      const body = parse(ReasonBody, req.body);
      res.json({ data: await tenantService.deactivate(req.user, req.params["id"] as string, body.reason, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/reactivate", async (req, res, next) => {
    try {
      const body = parse(ReasonBody, req.body);
      res.json({ data: await tenantService.reactivate(req.user, req.params["id"] as string, body.reason, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
