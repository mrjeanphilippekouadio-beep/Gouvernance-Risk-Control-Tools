import { Router } from "express";
import { ValidationError } from "../../domain/errors/DomainErrors.js";
import { z } from "zod";
import type { RiskService } from "../../services/RiskService.js";
import type { RaciEnrichmentViewService } from "../../services/RaciEnrichmentViewService.js";
import type { RiskDeviceViewService } from "../../services/RiskDeviceViewService.js";

const CreateRiskBody = z.object({
  process: z.string().min(1),
  description: z.string().min(1),
  ownerDepartmentId: z.string().nullish(),
  processId: z.string().nullish(),
});

const UpdateRiskBody = z.object({
  process: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  ownerDepartmentId: z.string().nullish(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  processId: z.string().nullish(),
});

const ArchiveRiskBody = z.object({
  reason: z.string().min(1),
});

const AssignOwnerBody = z.object({
  ownerId: z.string().nullable(),
});

const AssignSuperiorOwnerBody = z.object({
  superiorOwnerId: z.string().nullable(),
});

const EscalateRiskBody = z.object({
  reason: z.string().min(1),
});

/**
 * Thin HTTP layer: parse/validate input, call the service, shape the
 * response. No business rule lives here — see RiskService.
 */
export function risksRouter(
  riskService: RiskService,
  raciEnrichmentViewService: RaciEnrichmentViewService,
  riskDeviceViewService: RiskDeviceViewService,
): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const includeArchived = req.query["includeArchived"] === "true";
      // ACT-124: "ownerId=me" is the risk owner's personal view — resolved
      // to the caller's own id here, never trusted as an arbitrary
      // client-supplied user id impersonating someone else's "me".
      const ownerIdParam = req.query["ownerId"];
      const ownerId =
        typeof ownerIdParam === "string" ? (ownerIdParam === "me" ? req.user.userId : ownerIdParam) : undefined;
      const risks = await riskService.list(req.user, includeArchived, ownerId);
      res.json({ data: risks });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const risk = await riskService.get(req.user, req.params["id"] as string);
      res.json({ data: risk });
    } catch (err) {
      next(err);
    }
  });

  // RACI read-side wiring (PO-confirmed follow-up to Lot 1): who is R/A/C/I
  // on this risk. Display only — never a condition for any write below.
  router.get("/:id/raci", async (req, res, next) => {
    try {
      const context = await raciEnrichmentViewService.getRiskWithRaci(req.user, req.params["id"] as string);
      res.json({ data: context });
    } catch (err) {
      next(err);
    }
  });

  // DECISION-002/DECISION-003: Risk 360 / Dispositif de risque — composed
  // read model (RiskDeviceViewService). See that service's file header for
  // exactly what's covered and what's deliberately left out for now.
  router.get("/:id/360", async (req, res, next) => {
    try {
      const device = await riskDeviceViewService.getDevice(req.user, req.params["id"] as string);
      res.json({ data: device });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const idempotencyKey = req.header("Idempotency-Key")?.trim();
      if (!idempotencyKey) throw new ValidationError("Idempotency-Key header is required for risk creation");
      if (idempotencyKey.length > 255) throw new ValidationError("Idempotency-Key must not exceed 255 characters");
      const body = CreateRiskBody.parse(req.body);
      const risk = await riskService.create(req.user, body, req.requestId, idempotencyKey);
      res.status(201).json({ data: risk });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const body = UpdateRiskBody.parse(req.body);
      const risk = await riskService.update(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: risk });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/archive", async (req, res, next) => {
    try {
      const body = ArchiveRiskBody.parse(req.body);
      await riskService.archive(req.user, req.params["id"] as string, body.reason, req.requestId);
      res.json({ data: { status: "ARCHIVED" } });
    } catch (err) {
      next(err);
    }
  });

  // ACT-120/121: designate or reassign the individual Risk Owner.
  router.post("/:id/owner", async (req, res, next) => {
    try {
      const body = AssignOwnerBody.parse(req.body);
      const risk = await riskService.assignOwner(req.user, req.params["id"] as string, body.ownerId, req.requestId);
      res.json({ data: risk });
    } catch (err) {
      next(err);
    }
  });

  // ACT-122: designate the owner's N+1 (superior owner).
  router.post("/:id/superior-owner", async (req, res, next) => {
    try {
      const body = AssignSuperiorOwnerBody.parse(req.body);
      const risk = await riskService.assignSuperiorOwner(
        req.user,
        req.params["id"] as string,
        body.superiorOwnerId,
        req.requestId,
      );
      res.json({ data: risk });
    } catch (err) {
      next(err);
    }
  });

  // ACT-125: escalate to the superior owner — mandatory reason.
  router.post("/:id/escalate", async (req, res, next) => {
    try {
      const body = EscalateRiskBody.parse(req.body);
      const escalation = await riskService.escalate(req.user, req.params["id"] as string, body.reason, req.requestId);
      res.status(201).json({ data: escalation });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
