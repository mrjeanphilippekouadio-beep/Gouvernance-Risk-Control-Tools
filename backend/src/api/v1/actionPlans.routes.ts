import { Router } from "express";
import { z } from "zod";
import type { ActionPlanService } from "../../services/ActionPlanService.js";
import {
  ACTION_LINK_RESOURCE_TYPES,
  ACTION_PLAN_SOURCE_TYPES,
  type ActionLinkResourceType,
  type ActionPlanSourceType,
  type ActionPlanStatus,
} from "../../domain/entities/ActionPlan.js";

const SourceType = z.enum(ACTION_PLAN_SOURCE_TYPES);
const Status = z.enum(["PLANIFIEE", "EN_COURS", "TERMINEE"]);
const LinkResourceType = z.enum(ACTION_LINK_RESOURCE_TYPES);

const CreateActionPlanBody = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  sourceType: SourceType,
  sourceId: z.string().nullish(),
  responsibleUserId: z.string().min(1),
  departmentId: z.string().nullish(),
  dueDate: z.coerce.date(),
});

const ProgressBody = z.object({
  progressPercent: z.number().int().min(0).max(100),
  comment: z.string().nullish(),
});

const LinksBody = z.object({
  links: z.array(
    z.object({
      resourceType: LinkResourceType,
      resourceId: z.string().min(1),
    }),
  ),
});

const CloseBody = z.object({
  evidenceId: z.string().min(1),
  comment: z.string().nullish(),
});

function parseListFilters(query: Record<string, unknown>) {
  const status = typeof query["status"] === "string" ? (Status.parse(query["status"]) as ActionPlanStatus) : undefined;
  const sourceType = typeof query["sourceType"] === "string" ? (SourceType.parse(query["sourceType"]) as ActionPlanSourceType) : undefined;
  const responsibleUserId = typeof query["responsibleUserId"] === "string" ? query["responsibleUserId"] : undefined;
  const departmentId = typeof query["departmentId"] === "string" ? query["departmentId"] : undefined;
  const dueFrom = typeof query["dueFrom"] === "string" ? new Date(query["dueFrom"]) : undefined;
  const dueTo = typeof query["dueTo"] === "string" ? new Date(query["dueTo"]) : undefined;
  return { status, sourceType, responsibleUserId, departmentId, dueFrom, dueTo };
}

/**
 * ACT-190..195: mounted at /api/v1/actions by server.ts. ACT-196's
 * dashboard is deliberately NOT nested here — see
 * actionPlanDashboard.routes.ts, mounted separately at
 * /api/v1/dashboard so the literal backlog path `GET /dashboard/actions`
 * is honored.
 */
export function actionPlansRouter(actionPlanService: ActionPlanService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const actions = await actionPlanService.list(req.user, parseListFilters(req.query as Record<string, unknown>));
      res.json({ data: actions });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const action = await actionPlanService.get(req.user, req.params["id"] as string);
      res.json({ data: action });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/links", async (req, res, next) => {
    try {
      const links = await actionPlanService.listLinks(req.user, req.params["id"] as string);
      res.json({ data: links });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateActionPlanBody.parse(req.body);
      const action = await actionPlanService.create(req.user, body, req.requestId);
      res.status(201).json({ data: action });
    } catch (err) {
      next(err);
    }
  });

  // ACT-191: narrow — progressPercent + comment only, never a generic field-by-field update.
  router.patch("/:id/progress", async (req, res, next) => {
    try {
      const body = ProgressBody.parse(req.body);
      const action = await actionPlanService.updateProgress(
        req.user,
        req.params["id"] as string,
        body.progressPercent,
        body.comment ?? null,
        req.requestId,
      );
      res.json({ data: action });
    } catch (err) {
      next(err);
    }
  });

  // ACT-192: the only non-terminal stored transition, PLANIFIEE -> EN_COURS.
  router.patch("/:id/start", async (req, res, next) => {
    try {
      const action = await actionPlanService.start(req.user, req.params["id"] as string, req.requestId);
      res.json({ data: action });
    } catch (err) {
      next(err);
    }
  });

  // ACT-193: manually-triggered escalation check — see ActionPlanService.escalateIfOverdue
  // for why this can't be a background job in this codebase (no scheduler).
  router.post("/:id/escalate", async (req, res, next) => {
    try {
      const result = await actionPlanService.escalateIfOverdue(req.user, req.params["id"] as string, req.requestId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // ACT-194: replaces the full set of linked resources (pure link table, DELETE + INSERT).
  router.post("/:id/links", async (req, res, next) => {
    try {
      const body = LinksBody.parse(req.body);
      const links = await actionPlanService.setLinks(
        req.user,
        req.params["id"] as string,
        body.links as { resourceType: ActionLinkResourceType; resourceId: string }[],
        req.requestId,
      );
      res.json({ data: links });
    } catch (err) {
      next(err);
    }
  });

  // ACT-195: terminal transition, mandatory evidence, maker-checker (creator != closer).
  router.patch("/:id/close", async (req, res, next) => {
    try {
      const body = CloseBody.parse(req.body);
      const action = await actionPlanService.close(
        req.user,
        req.params["id"] as string,
        body.evidenceId,
        body.comment ?? null,
        req.requestId,
      );
      res.json({ data: action });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
