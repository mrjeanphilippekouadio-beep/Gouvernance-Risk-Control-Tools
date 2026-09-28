import { Router } from "express";
import { z } from "zod";
import type { RaciAssignmentService } from "../../services/RaciAssignmentService.js";
import type { RaciEntityType, RaciRole } from "../../domain/entities/RaciAssignment.js";

const EntityType = z.enum(["Risk", "Control", "ActionPlan"]);
const RaciRoleSchema = z.enum(["R", "A", "C", "I"]);

const AssignBody = z.object({
  entityType: EntityType,
  entityId: z.string().min(1),
  userId: z.string().min(1),
  role: RaciRoleSchema,
});

/** Lot 1 RACI minimal — mounted at /api/v1/raci by server.ts. */
export function raciRouter(raciService: RaciAssignmentService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const entityType = EntityType.parse(req.query["entityType"]) as RaciEntityType;
      const entityId = z.string().min(1).parse(req.query["entityId"]);
      const assignments = await raciService.list(req.user, entityType, entityId);
      res.json({ data: assignments });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = AssignBody.parse(req.body);
      const assignment = await raciService.assign(
        req.user,
        body.entityType as RaciEntityType,
        body.entityId,
        body.userId,
        body.role as RaciRole,
        req.requestId,
      );
      res.status(201).json({ data: assignment });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const entityType = EntityType.parse(req.query["entityType"]) as RaciEntityType;
      const entityId = z.string().min(1).parse(req.query["entityId"]);
      const assignment = await raciService.revoke(req.user, entityType, entityId, req.params["id"] as string, req.requestId);
      res.json({ data: assignment });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
