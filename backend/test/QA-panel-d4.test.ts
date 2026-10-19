import { describe, expect, it } from "vitest";
import express from "express";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { executionsRouter } from "../src/api/v1/executions.routes.js";
import { effectivenessRouter } from "../src/api/v1/effectiveness.routes.js";
import { findingsRouter } from "../src/api/v1/findings.routes.js";
import { reviewCyclesRouter } from "../src/api/v1/reviewCycles.routes.js";
import { actionPlansRouter } from "../src/api/v1/actionPlans.routes.js";
import { processEvaluationModeRequestsRouter } from "../src/api/v1/processEvaluationModeRequests.routes.js";
import { riskEvaluationsRouter } from "../src/api/v1/riskEvaluations.routes.js";
import { treatmentDecisionsRouter } from "../src/api/v1/treatmentDecisions.routes.js";
import { ControlExecutionService } from "../src/services/ControlExecutionService.js";
import { ControlEffectivenessService } from "../src/services/ControlEffectivenessService.js";
import { FindingService } from "../src/services/FindingService.js";
import { GovernanceService } from "../src/services/GovernanceService.js";
import { ProcessEvaluationModeRequestService } from "../src/services/ProcessEvaluationModeRequestService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import { TreatmentDecisionService } from "../src/services/TreatmentDecisionService.js";
import { SelfValidationGate } from "../src/services/SelfValidationGate.js";
import { withIndependence } from "../src/api/validationIndependence.js";
import type { Config } from "../src/domain/entities/Config.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { GovernanceConfirmation } from "../src/domain/governance/selfValidation.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-panel D4: cross-module review of the self-validation double confirmation (DECISION-074 q141/q142/q153).
 * Oracle (written before running): every one of the 10 guarded paths behaves identically:
 *   REFUSE / no gate -> 403, nothing written | DOUBLE_CONFIRMATION + another validator -> 403 (never names them)
 *   DOUBLE_CONFIRMATION + nobody else + no confirmation -> 409 GOVERNANCE_CONFIRMATION_REQUIRED, nothing written
 *   confirmed -> applied, ONE audit row carrying governanceException "noSelfValidation" on the entity type the route decorates
 *   somebody else validating -> no marker, no validator query.
 */

type Ev = Omit<AuditEvent, "id" | "timestamp">;
const CONF: GovernanceConfirmation = { rule: "noSelfValidation", reason: "Seule personne de la structure" };
const ME = "u-self";
const actor = (roles: string[], userId = ME): AuthenticatedUser =>
  ({ userId, tenantId: "t1", email: `${userId}@x`, displayName: userId, roles }) as unknown as AuthenticatedUser;

function gateOf(policy: Config["selfValidationPolicy"], otherExists: boolean) {
  const queries: Array<{ permission: string; exclude: string[] | undefined }> = [];
  const gate = new SelfValidationGate(
    { getByTenant: async () => ({ selfValidationPolicy: policy }) as Config },
    { existsOther: async (_t, _a, permission, exclude) => { queries.push({ permission, exclude }); return otherExists; } },
  );
  return { gate, queries };
}

interface Built {
  run: (who: AuthenticatedUser, conf?: GovernanceConfirmation) => Promise<unknown>;
  events: Ev[];
  writes: string[];
}
interface PathCase {
  name: string;
  /** entity type written in audit_log: must be the one the route's withIndependence() looks up (else the label is lost). */
  entityType: string;
  routeEntityType: string;
  permission: string;
  roles: string[];
  makers: string[];
  build: (gate: SelfValidationGate | undefined, makerOverride?: string) => Built;
}

function audit(events: Ev[]) {
  return { record: async (e: Ev) => { events.push(e); }, listForEntity: async () => [] } as never;
}

const paths: PathCase[] = [
  {
    name: "ControlExecution.validate", entityType: "ControlExecution", routeEntityType: "ControlExecution",
    permission: "execution.validate", roles: ["execution.read", "execution.validate"], makers: [ME],
    build: (gate, maker = ME) => {
      const events: Ev[] = []; const writes: string[] = [];
      const row = { id: "e1", tenantId: "t1", executedBy: maker, validatedAt: null, status: "DONE" };
      const svc = new ControlExecutionService(
        { getById: async () => row, recordValidation: async () => { writes.push("validate"); return { ...row, validatedAt: new Date() }; } } as never,
        {} as never, audit(events), gate);
      return { events, writes, run: (who, conf) => svc.validate(who, "e1", null, "r", conf) };
    },
  },
  {
    name: "ControlEffectiveness.validate", entityType: "ControlEffectivenessAssessment", routeEntityType: "ControlEffectivenessAssessment",
    permission: "effectiveness.validate", roles: ["effectiveness.read", "effectiveness.validate"], makers: [ME],
    build: (gate, maker = ME) => {
      const events: Ev[] = []; const writes: string[] = [];
      const row = { id: "a1", tenantId: "t1", evaluatedBy: maker, validatedAt: null };
      const svc = new ControlEffectivenessService(
        { getById: async () => row, recordValidation: async () => { writes.push("validate"); return { ...row, validatedAt: new Date() }; } } as never,
        {} as never, audit(events), gate);
      return { events, writes, run: (who, conf) => svc.validate(who, "a1", null, "r", conf) };
    },
  },
  {
    name: "Finding.close", entityType: "Finding", routeEntityType: "Finding",
    permission: "audit.finding.close", roles: ["audit.finding.close"], makers: [ME],
    build: (gate, maker = ME) => {
      const events: Ev[] = []; const writes: string[] = [];
      const row = { id: "f1", tenantId: "t1", status: "EN_TRAITEMENT", raisedBy: maker };
      const svc = new FindingService(
        { getById: async () => row, close: async () => { writes.push("close"); return { ...row, status: "CLOS" }; } } as never,
        {} as never, audit(events), undefined, undefined, undefined, gate);
      return { events, writes, run: (who, conf) => svc.close(who, "f1", "fermé", "r", conf) };
    },
  },
  {
    name: "ReviewCycle close (GovernanceService.close)", entityType: "ReviewCycle", routeEntityType: "ReviewCycle",
    permission: "governance.validate", roles: ["governance.read", "governance.validate"], makers: [ME],
    build: (gate, maker = ME) => {
      const events: Ev[] = []; const writes: string[] = [];
      const row = { id: "c1", tenantId: "t1", status: "CLOTURE_PROPOSEE", proposedClosureBy: maker };
      const svc = new GovernanceService(
        { getById: async () => row, close: async () => { writes.push("close"); return { ...row, status: "CLOTURE" }; } } as never,
        audit(events), undefined, gate);
      return { events, writes, run: (who, conf) => svc.close(who, "c1", null, "r", conf) };
    },
  },
  {
    name: "ProcessEvaluationModeRequest.validate", entityType: "ProcessEvaluationModeRequest", routeEntityType: "ProcessEvaluationModeRequest",
    permission: "evaluationmode.validate", roles: ["evaluationmode.validate"], makers: [ME],
    build: (gate, maker = ME) => {
      const events: Ev[] = []; const writes: string[] = [];
      const request = { id: "q1", tenantId: "t1", status: "PENDING_VALIDATION", requestedBy: maker, processId: "p1", requestedMode: "PARTICIPATIF" };
      const process = { id: "p1", tenantId: "t1", level: "PROCESS", evaluationMode: "CLASSIQUE" };
      const svc = new ProcessEvaluationModeRequestService(
        { getById: async () => request, validate: async () => { writes.push("request"); return { ...request, status: "VALIDATED" }; } } as never,
        { getById: async () => process, update: async () => { writes.push("process"); return { ...process, evaluationMode: "PARTICIPATIF" }; } } as never,
        { list: async () => [] } as never, audit(events), gate);
      return { events, writes, run: (who, conf) => svc.validate(who, "q1", "r", conf) };
    },
  },
  {
    name: "ActionPlan.close (creator)", entityType: "ActionPlan", routeEntityType: "ActionPlan",
    permission: "actionplan.validate", roles: ["actionplan.validate"], makers: [ME, "u-resp"],
    build: (gate, maker = ME) => {
      const events: Ev[] = []; const writes: string[] = [];
      const row = { id: "ap1", tenantId: "t1", status: "EN_COURS", createdBy: maker, responsibleUserId: "u-resp", dueDate: new Date(Date.now() + 1e9) };
      const svc = new ActionPlanService(
        { getById: async () => row, close: async () => { writes.push("close"); return { ...row, status: "TERMINEE" }; } } as never,
        audit(events), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, gate);
      return { events, writes, run: (who, conf) => svc.close(who, "ap1", "ev-1", null, "r", conf) };
    },
  },
  {
    name: "RiskEvaluation.validate", entityType: "RiskEvaluation", routeEntityType: "RiskEvaluation",
    permission: "riskevaluation.validate", roles: ["riskevaluation.read", "riskevaluation.validate"], makers: [ME],
    build: (gate, maker = ME) => {
      const events: Ev[] = []; const writes: string[] = [];
      const row = { id: "r1", tenantId: "t1", status: "BROUILLON", residualScore: 5, evaluatorId: maker, committeeEvaluationMinScore: 15, committeeEvaluationEnforced: true };
      const svc = new RiskEvaluationService(
        { getById: async () => row, recordValidation: async () => { writes.push("validate"); return { ...row, status: "VALIDEE" }; } } as never,
        audit(events), undefined, undefined, undefined, undefined, undefined, undefined, undefined, gate);
      return { events, writes, run: (who, conf) => svc.validate(who, "r1", null, "r", conf) };
    },
  },
  // q159 (DECISION-078): the two committee paths left the double confirmation; see test/q159-committee.test.ts.
];

describe.each(paths)("QA-panel D4 / $name", (p) => {
  const me = actor(p.roles);

  it("without a gate, or REFUSE (even with a confirmation): 403 and nothing written", async () => {
    for (const gate of [undefined, gateOf("REFUSE", false).gate]) {
      const b = p.build(gate);
      await expect(b.run(me, CONF)).rejects.toMatchObject({ name: "ForbiddenError" });
      expect(b.writes).toEqual([]);
      expect(b.events).toEqual([]);
    }
  });

  it("DOUBLE_CONFIRMATION but another validator exists: 403 that does not name them, makers excluded from the search", async () => {
    const { gate, queries } = gateOf("DOUBLE_CONFIRMATION", true);
    const b = p.build(gate);
    const err = await b.run(me, CONF).catch((e: Error) => e);
    expect(err).toMatchObject({ name: "ForbiddenError" });
    expect((err as Error).message).not.toMatch(/u-sup|u-resp/);
    expect(queries).toEqual([{ permission: p.permission, exclude: p.makers }]);
    expect(b.writes).toEqual([]);
    expect(b.events).toEqual([]);
  });

  it("nobody else, no confirmation (absent / wrong rule / blank reason): 409 GOVERNANCE_CONFIRMATION_REQUIRED, nothing written", async () => {
    for (const conf of [undefined, { rule: "other", reason: "x" }, { rule: "noSelfValidation", reason: "   " }] as unknown as Array<GovernanceConfirmation | undefined>) {
      const b = p.build(gateOf("DOUBLE_CONFIRMATION", false).gate);
      const err = await b.run(me, conf).catch((e: Error) => e);
      expect(err).toMatchObject({ name: "ConflictError" });
      expect((err as Error).message).toMatch(/^GOVERNANCE_CONFIRMATION_REQUIRED:/);
      expect(b.writes).toEqual([]);
      expect(b.events).toEqual([]);
    }
  });

  it("confirmed: applied once, one audit row with the marker on the decorated entity type, reason trimmed, actor = caller", async () => {
    const b = p.build(gateOf("DOUBLE_CONFIRMATION", false).gate);
    await b.run(me, { rule: "noSelfValidation", reason: "  Seule personne  " });
    const marked = b.events.filter((e) => e.governanceException);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toMatchObject({ governanceException: "noSelfValidation", entityType: p.entityType, userId: ME, tenantId: "t1" });
    expect(marked[0]!.newValue).toMatchObject({ selfValidation: { otherValidatorExists: false, reason: "Seule personne" } });
    // the label would silently vanish if the audit entity type differed from the one the route looks up
    expect(p.entityType).toBe(p.routeEntityType);
  });

  it("somebody else validating: no marker, no validator query, even under DOUBLE_CONFIRMATION", async () => {
    const { gate, queries } = gateOf("DOUBLE_CONFIRMATION", false);
    const b = p.build(gate, "u-maker");
    await b.run(actor(p.roles, "u-other"), CONF);
    expect(queries).toEqual([]);
    expect(b.events.every((e) => !e.governanceException)).toBe(true);
    expect(b.writes.length).toBeGreaterThan(0);
  });
});

describe("QA-panel D4 / ordering and edge cases", () => {
  it("a confirmed self-validation of an ALREADY validated execution is refused as 'already validated' and leaves no marker", async () => {
    const events: Ev[] = [];
    const row = { id: "e1", tenantId: "t1", executedBy: ME, validatedAt: new Date(), status: "DONE" };
    const svc = new ControlExecutionService({ getById: async () => row } as never, {} as never, audit(events), gateOf("DOUBLE_CONFIRMATION", false).gate);
    await expect(svc.validate(actor(["execution.read", "execution.validate"]), "e1", null, "r", CONF)).rejects.toMatchObject({ name: "ValidationError" });
    expect(events).toEqual([]);
  });

  // F-PNL-04 (MINOR): the gate runs BEFORE the "already validated" check, so the maker of an already validated
  // execution is first asked for a confirmation (409) about an act that cannot happen at all.
  it("F-PNL-04: an already validated execution answers 'already validated' (400), not a 409 confirmation request", async () => {
    const row = { id: "e1", tenantId: "t1", executedBy: ME, validatedAt: new Date(), status: "DONE" };
    const svc = new ControlExecutionService({ getById: async () => row } as never, {} as never, audit([]), gateOf("DOUBLE_CONFIRMATION", false).gate);
    await expect(svc.validate(actor(["execution.read", "execution.validate"]), "e1", null, "r")).rejects.toMatchObject({ name: "ValidationError" });
  });

  // F-PNL-05 (MINOR): same family for the ordinary RiskEvaluation.validate above the committee threshold.
  it("F-PNL-05: a self-validation above the committee threshold is told to use the committee path before any confirmation prompt", async () => {
    const row = { id: "r1", tenantId: "t1", status: "BROUILLON", residualScore: 20, evaluatorId: ME, committeeEvaluationMinScore: 15, committeeEvaluationEnforced: true };
    const svc = new RiskEvaluationService({ getById: async () => row } as never, audit([]), undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      gateOf("DOUBLE_CONFIRMATION", false).gate);
    await expect(svc.validate(actor(["riskevaluation.read", "riskevaluation.validate"]), "r1", null, "r")).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("reject paths stay hard refusals under DOUBLE_CONFIRMATION (documented scope, DECISION-074 D4 choice 2)", async () => {
    const row = { id: "r1", tenantId: "t1", status: "BROUILLON", residualScore: 5, evaluatorId: ME };
    const svc = new RiskEvaluationService({ getById: async () => row, recordRejection: async () => { throw new Error("must not be written"); } } as never, audit([]),
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, gateOf("DOUBLE_CONFIRMATION", false).gate);
    await expect(svc.reject(actor(["riskevaluation.read", "riskevaluation.validate"]), "r1", "non", "r")).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("actionplan: the RESPONSIBLE user (not the creator) is also a self-validator and the creator is a maker excluded from 'another validator'", async () => {
    const { gate, queries } = gateOf("DOUBLE_CONFIRMATION", false);
    const events: Ev[] = [];
    const row = { id: "ap1", tenantId: "t1", status: "EN_COURS", createdBy: "u-creator", responsibleUserId: ME, dueDate: new Date(Date.now() + 1e9) };
    const svc = new ActionPlanService({ getById: async () => row, close: async () => ({ ...row, status: "TERMINEE" }) } as never, audit(events),
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, gate);
    await svc.close(actor(["actionplan.validate"]), "ap1", "ev", null, "r", CONF);
    expect(queries[0]!.exclude).toEqual(["u-creator", ME]);
    expect(events[0]!.governanceException).toBe("noSelfValidation");
  });

  // F-PNL-11 (INFO): "reason mandatory" is satisfied by one invisible character; the same holds for every `trim().min(1)` reason.
  it("F-PNL-11 closed: a zero-width space is not a reason (the confirmation is refused)", async () => {
    const { GovernanceConfirmationBody } = await import("../src/api/validation.js");
    expect(GovernanceConfirmationBody.safeParse({ rule: "noSelfValidation", reason: "\u200b" }).success).toBe(false);
    expect(GovernanceConfirmationBody.safeParse({ rule: "noSelfValidation", reason: "\u00a0 \t" }).success).toBe(false);
  });

  it("withIndependence marks only the marked entity, and a missing entity type match yields INDEPENDENT (why entity types must match)", async () => {
    const lookup = {
      forEntities: async (_t: string, type: string, ids: string[]) =>
        new Map(ids.map((id) => [id, type === "ActionPlan" && id === "a" ? ("WITHOUT_INDEPENDENT_REVIEW" as const) : ("INDEPENDENT" as const)])),
    };
    expect((await withIndependence(lookup, "ActionPlan")("t1", { id: "a" })).validationIndependence).toBe("WITHOUT_INDEPENDENT_REVIEW");
    expect((await withIndependence(lookup, "Action")("t1", { id: "a" })).validationIndependence).toBe("INDEPENDENT");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Routes: every guarded route forwards `governanceConfirmation`; the non-guarded ones do not accept it.
async function http(mount: (app: express.Express) => void, method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: AuthenticatedUser }).user = actor([]);
    (req as unknown as { requestId: string }).requestId = "req";
    next();
  });
  mount(app);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  } finally {
    server.close();
  }
}

describe("QA-panel D4 / routes forward the confirmation (a route that drops it would turn every confirmation into a permanent 409)", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const spy = () => {
    const calls: unknown[][] = [];
    const fn = async (...a: unknown[]) => { calls.push(a); return { id: ID }; };
    return { calls, fn };
  };
  type RouteCase = { name: string; method: string; path: string; body: Record<string, unknown>; mount: (s: ReturnType<typeof spy>) => (app: express.Express) => void };
  const routeCases: RouteCase[] = [
    { name: "executions", method: "POST", path: `/x/${ID}/validate`, body: {}, mount: (s) => (a) => a.use("/x", executionsRouter({ validate: s.fn } as never)) },
    { name: "effectiveness", method: "POST", path: `/x/${ID}/validate`, body: {}, mount: (s) => (a) => a.use("/x", effectivenessRouter({ validate: s.fn } as never)) },
    { name: "findings", method: "POST", path: `/x/${ID}/close`, body: { comment: "c" }, mount: (s) => (a) => a.use("/x", findingsRouter({ close: s.fn } as never)) },
    { name: "reviewCycles", method: "PATCH", path: `/x/${ID}/close`, body: {}, mount: (s) => (a) => a.use("/x", reviewCyclesRouter({ close: s.fn } as never)) },
    { name: "actionPlans", method: "PATCH", path: `/x/${ID}/close`, body: { evidenceId: "e" }, mount: (s) => (a) => a.use("/x", actionPlansRouter({ close: s.fn } as never, {} as never)) },
    { name: "evaluationmode requests", method: "POST", path: `/x/${ID}/validate`, body: {}, mount: (s) => (a) => a.use("/x", processEvaluationModeRequestsRouter({ validate: s.fn } as never)) },
    { name: "risk evaluations validate", method: "PATCH", path: `/x/${ID}/validate`, body: {}, mount: (s) => (a) => a.use("/x", riskEvaluationsRouter({ validate: s.fn } as never, {} as never, {} as never)) },
  ];

  it.each(routeCases)("$name: the confirmation reaches the service as the last argument; absent stays undefined", async (c) => {
    const s = spy();
    const withConf = await http(c.mount(s), c.method, c.path, { ...c.body, governanceConfirmation: CONF });
    expect(withConf.status).toBe(200);
    expect(s.calls[0]!.at(-1)).toEqual(CONF);
    const s2 = spy();
    expect((await http(c.mount(s2), c.method, c.path, c.body)).status).toBe(200);
    expect(s2.calls[0]!.at(-1)).toBeUndefined();
  });

  it.each(routeCases)("$name: a malformed confirmation is a 400 and never reaches the service", async (c) => {
    for (const bad of [{ rule: "other", reason: "x" }, { rule: "noSelfValidation", reason: "" }, { rule: "noSelfValidation", reason: "x".repeat(501) }, { rule: "noSelfValidation" }, "yes", 1, null]) {
      const s = spy();
      const res = await http(c.mount(s), c.method, c.path, { ...c.body, governanceConfirmation: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(s.calls).toEqual([]);
    }
  });

  it("end to end: 409 carries GOVERNANCE_CONFIRMATION_REQUIRED, then the same request with the confirmation is a 200 (execution)", async () => {
    const events: Ev[] = [];
    const row = { id: ID, tenantId: "t1", executedBy: ME, validatedAt: null, status: "DONE" };
    const svc = new ControlExecutionService(
      { getById: async () => row, recordValidation: async () => ({ ...row, validatedAt: new Date() }) } as never,
      {} as never, audit(events), gateOf("DOUBLE_CONFIRMATION", false).gate);
    const mount = (a: express.Express) => a.use("/x", executionsRouter(svc));
    // the stub user has no roles: give the service what requirePermission wants
    const mountWithRoles = (a: express.Express) => {
      a.use("/x", (req, _res, next) => { (req as unknown as { user: AuthenticatedUser }).user = actor(["execution.read", "execution.validate"]); next(); });
      mount(a);
    };
    const first = await http(mountWithRoles, "POST", `/x/${ID}/validate`, {});
    expect(first.status).toBe(409);
    expect(JSON.stringify(first.json)).toContain("GOVERNANCE_CONFIRMATION_REQUIRED");
    expect(events).toEqual([]);
    const second = await http(mountWithRoles, "POST", `/x/${ID}/validate`, { governanceConfirmation: CONF });
    expect(second.status).toBe(200);
    expect(events.map((e) => e.governanceException)).toEqual(["noSelfValidation"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Guard against "a service forgotten": any maker-checker comparison with the actor in a service must go through the
// gate or be in this reviewed list. A new `x === actor.userId` guard that is not listed fails here.
describe("QA-panel D4 / no self-validation guard outside the gate (static)", () => {
  const SERVICES = join(__dirname, "..", "src", "services");
  // reviewed: file -> number of `=== actor.userId`-style comparisons that are NOT validations of one's own input
  const REVIEWED_NON_GATE: Record<string, string> = {
    "NotificationService.ts": "recipient checks",
    "RiskEvaluationService.ts": "evaluator-only setters + reject() (rejects stay hard refusals, D4 choice 2)",
    "TreatmentDecisionService.ts": "propose(): G2/G4 (proposer rules) + assertIsValidator (snapshot validator)",
    "ProcessEvaluationModeRequestService.ts": "reject() (hard refusal) via assertNotSelfValidated",
    "OrganizationProfileService.ts": "own maker-checker (submittedBy)",
    "RiskFrameworkService.ts": "own maker-checker (change requests), out of D4 scope (D4 choice 2)",
    "ProcessService.ts": "no self-designation",
    "UserService.ts": "no self-suspension",
    "RoleService.ts": "no self-assignment, hand-over interim rules, permission-change decisions (out of D4 scope)",
    "GovernanceDesignationService.ts": "no self-designation",
    "GovernanceExceptionService.ts": "D5: the author of an action never reviews it (maker-checker, add-only review)",
    "GovernancePrincipleAcceptanceService.ts": "D5: the acceptor never confirms or rejects their own acceptance",
    "ConfigService.ts": "own maker-checker (q158 policy requests: requestedBy)",
    "DashboardScopeResolver.ts": "comment only",
    "ControlEffectivenessService.ts": "gate", "ControlExecutionService.ts": "gate", "FindingService.ts": "gate", "GovernanceService.ts": "gate", "ActionPlanService.ts": "gate",
  };
  it("every service comparing something to actor.userId is either routed through checkSelfValidation or explicitly reviewed", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(SERVICES).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(SERVICES, f), "utf8");
      if (!/(===|!==)\s*actor\.userId|actor\.userId\s*(===|!==)/.test(src)) continue;
      if (!(f in REVIEWED_NON_GATE)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
  it("services that name a gate dependency call checkSelfValidation at least once, and never `throw new ForbiddenError` on a self comparison", () => {
    for (const f of ["ControlEffectivenessService.ts", "ControlExecutionService.ts", "FindingService.ts", "GovernanceService.ts", "ActionPlanService.ts"]) {
      const src = readFileSync(join(SERVICES, f), "utf8");
      expect(src, f).toMatch(/checkSelfValidation\(/);
      expect(src, f).not.toMatch(/if \(before\.\w+ === actor\.userId\)\s*\{?\s*throw new ForbiddenError/);
    }
  });
});
