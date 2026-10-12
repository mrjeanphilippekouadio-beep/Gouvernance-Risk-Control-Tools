import { Router } from "express";
import { z } from "zod";
import type { RiskFrameworkService } from "../../services/RiskFrameworkService.js";
import { boundedArray } from "../validation.js";

const Id = z.guid();
const Reason = z.string().trim().min(1).max(500);
const Comment = z.string().trim().max(1000);
const Score = z.number().int().min(1).max(36);

const AppetiteEntry = z
  .object({
    subCategory: z.string().trim().min(1).max(200),
    subCategoryId: Id.nullable().default(null),
    entity: z.string().trim().min(1).max(200).nullable().default(null),
    threshold: Score,
    description: z.string().max(1000).nullable().default(null),
  })
  .strict();

/** Draft parameters (spec §2.2). `.strict()`: a `status` (or any unknown key) is a 400, never ignored. */
const ParamsShape = {
  defaultEvaluationMode: z.enum(["CLASSIQUE", "PARTICIPATIF"]),
  committeeEvaluationMinScore: Score,
  committeeEvaluationEnforced: z.boolean(),
  committeeTreatmentMinScore: Score.nullable(),
  appetiteThresholds: boundedArray(AppetiteEntry, 200),
  changeApprover: z.enum(["RISK_MANAGER", "AUDIT", "COMMITTEE", "AUDIT_AND_COMMITTEE"]),
  selfProposalAllowed: z.boolean(),
  // B-6b (q91). The seuil "faible" is entered explicitly (never pre-filled, R2); `null` clears it in a draft.
  lowCriticalityThreshold: Score.nullable(),
  riskOwnerExecutorCumulAllowed: z.boolean(),
  delegateExecutorCumulAllowed: z.boolean(),
  delegationMaxDays: z.number().int().min(1).max(3650).nullable(), // technical anti-abuse bound, not a business rule
  hybridPolicyEnabled: z.boolean(),
  masteryAuthoritativeSource: z.enum(["RISK_TEAM", "FIRST_LINE"]),
  committeeVoteRule: z.enum(["DEFAULT", "A", "B", "C", "CUSTOM"]),
  // Shape defined by B-12; the service refuses any value until then. Strict + empty: no free-form object reaches it.
  committeeVoteCustom: z.object({}).strict().nullable(),
};

const CreateBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(1000).nullable().optional(),
    ratingScaleId: Id,
    params: z.object(ParamsShape).partial().strict().optional(),
  })
  .strict();
const IdentityBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
    reason: Reason,
  })
  .strict();
const DraftBody = z.object({ fromVersionId: Id.optional() }).strict();
const PatchVersionBody = z.object({ ratingScaleId: Id.optional(), ...ParamsShape }).partial().strict();
const ReasonBody = z.object({ reason: Reason }).strict();
const ApproveBody = z.object({ comment: Comment.optional() }).strict();
const RejectBody = z.object({ comment: Comment.min(1) }).strict();
const WithdrawBody = z.object({ reason: Comment.optional() }).strict();
const ApplicableQuery = z
  .object({ riskId: Id.optional(), processId: Id.optional() })
  .refine((q) => (q.riskId === undefined) !== (q.processId === undefined), { message: "Exactly one of riskId or processId is required" });
const StatusQuery = z.enum(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]).optional();

/**
 * B-6a: the Dispositif. Parses and shapes only — every rule (permissions, Risk Manager membership,
 * maker-checker, immutability) lives in RiskFrameworkService. `requestedBy`, `decidedBy`, `createdBy` and
 * `lastEditedBy` are never read from the body.
 */
export function riskFrameworksRouter(service: RiskFrameworkService): Router {
  const router = Router();
  const id = (v: unknown) => Id.parse(v);

  router.get("/", async (req, res, next) => {
    try {
      res.json({ data: await service.list(req.user) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateBody.parse(req.body);
      const created = await service.create(req.user, body, req.requestId);
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  });

  // B-6b: the Dispositif version that applies to a risk or a process (read-only). Before "/:id".
  router.get("/applicable", async (req, res, next) => {
    try {
      const q = ApplicableQuery.parse(req.query);
      res.json({ data: await service.getApplicable(req.user, q) });
    } catch (err) {
      next(err);
    }
  });

  // Declared before "/:id" so "change-requests" is never read as an id.
  router.get("/change-requests", async (req, res, next) => {
    try {
      res.json({ data: await service.listRequests(req.user, StatusQuery.parse(req.query["status"])) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/change-requests/:rid/approve", async (req, res, next) => {
    try {
      const body = ApproveBody.parse(req.body ?? {});
      const result = await service.approve(req.user, id(req.params["rid"]), body.comment, req.requestId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.post("/change-requests/:rid/reject", async (req, res, next) => {
    try {
      const body = RejectBody.parse(req.body);
      const result = await service.reject(req.user, id(req.params["rid"]), body.comment, req.requestId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.post("/change-requests/:rid/withdraw", async (req, res, next) => {
    try {
      const body = WithdrawBody.parse(req.body ?? {});
      const result = await service.withdraw(req.user, id(req.params["rid"]), body.reason, req.requestId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      res.json({ data: await service.get(req.user, id(req.params["id"])) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const body = IdentityBody.parse(req.body);
      res.json({ data: await service.updateIdentity(req.user, id(req.params["id"]), body, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/versions/:vid", async (req, res, next) => {
    try {
      res.json({ data: await service.getVersion(req.user, id(req.params["id"]), id(req.params["vid"])) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/versions", async (req, res, next) => {
    try {
      const body = DraftBody.parse(req.body ?? {});
      const draft = await service.createDraft(req.user, id(req.params["id"]), body.fromVersionId, req.requestId);
      res.status(201).json({ data: draft });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id/versions/:vid", async (req, res, next) => {
    try {
      const body = PatchVersionBody.parse(req.body);
      const version = await service.updateDraft(req.user, id(req.params["id"]), id(req.params["vid"]), body, req.requestId);
      res.json({ data: version });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/versions/:vid/discard", async (req, res, next) => {
    try {
      const body = ReasonBody.parse(req.body);
      const version = await service.discardDraft(req.user, id(req.params["id"]), id(req.params["vid"]), body.reason, req.requestId);
      res.json({ data: version });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/versions/:vid/activation-requests", async (req, res, next) => {
    try {
      const body = ReasonBody.parse(req.body);
      const request = await service.requestActivation(req.user, id(req.params["id"]), id(req.params["vid"]), body.reason, req.requestId);
      res.status(201).json({ data: request });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
