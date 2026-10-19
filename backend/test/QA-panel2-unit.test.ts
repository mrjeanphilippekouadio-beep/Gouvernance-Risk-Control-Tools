import { describe, expect, it, vi } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { ControlEffectivenessService } from "../src/services/ControlEffectivenessService.js";
import { FindingService } from "../src/services/FindingService.js";
import { GovernanceService } from "../src/services/GovernanceService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { ProcessEvaluationModeRequestService } from "../src/services/ProcessEvaluationModeRequestService.js";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import { TreatmentDecisionService } from "../src/services/TreatmentDecisionService.js";
import { SelfValidationGate } from "../src/services/SelfValidationGate.js";
import { GovernanceNotifier } from "../src/services/GovernanceNotifier.js";
import { actionPlanDashboardRouter } from "../src/api/v1/actionPlanDashboard.routes.js";
import { governanceNotificationsMiddleware } from "../src/api/middleware/governanceNotifications.js";
import { GoogleIdentityProvider } from "../src/infrastructure/identity/GoogleIdentityProvider.js";
import { createLastSeenRecorder } from "../src/infrastructure/identity/lastSeen.js";
import { FIXED_GROUP_PERMISSIONS, isAuditGroupPermission } from "../src/domain/fixedGroupPermissions.js";
import type { Config } from "../src/domain/entities/Config.js";
import type { GovernanceAuditRow } from "../src/domain/governance/governanceEvents.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-panel2, unit part (no database). Oracles written before running:
 *  U1  F-PNL-04 family: "already decided / impossible" is answered (400) BEFORE any confirmation prompt (409), whatever the service.
 *  U2  q159: the Committee paths never accept a self-validation, with or without a confirmation, whatever the gate says.
 *  U3  q155 Google: a NEW token (new iat) counts as a connection, the same token never; the recorder throttles to 1 write/hour.
 *  U4  the notification middleware reacts to success statuses of mutating requests only.
 *  U5  the notifier handles an audit row once per process (and not across processes: pinned).
 *  U6  fixed groups: Audit holds no deciding right introduced by q157/q158/D5.
 */
type Ev = Record<string, unknown>;
const ME = "u-self";
const actor = (roles: string[], userId = ME): AuthenticatedUser =>
  ({ userId, tenantId: "t1", email: `${userId}@x`, displayName: userId, roles }) as unknown as AuthenticatedUser;
const audit = (events: Ev[]) => ({ record: async (e: Ev) => { events.push(e); }, listForEntity: async () => [] }) as never;
const gate = (policy: Config["selfValidationPolicy"] = "DOUBLE_CONFIRMATION", otherExists = false) =>
  new SelfValidationGate({ getByTenant: async () => ({ selfValidationPolicy: policy }) as Config }, { existsOther: async () => otherExists });

describe("U1 / already-decided is answered before any confirmation prompt (F-PNL-04 family, all gated services)", () => {
  const noWrite = (name: string) => async () => { throw new Error(`${name} must not be written`); };
  const cases: Array<{ name: string; run: () => Promise<unknown> }> = [
    {
      name: "ControlEffectiveness.validate (already validated)",
      run: () => new ControlEffectivenessService(
        { getById: async () => ({ id: "a1", tenantId: "t1", evaluatedBy: ME, validatedAt: new Date() }), recordValidation: noWrite("validation") } as never,
        {} as never, audit([]), gate(),
      ).validate(actor(["effectiveness.read", "effectiveness.validate"]), "a1", null, "r"),
    },
    {
      name: "Finding.close (already CLOS)",
      run: () => new FindingService(
        { getById: async () => ({ id: "f1", tenantId: "t1", status: "CLOS", raisedBy: ME }), close: noWrite("close") } as never,
        {} as never, audit([]), undefined, undefined, undefined, gate(),
      ).close(actor(["audit.finding.close"]), "f1", "fermé", "r"),
    },
    {
      name: "ReviewCycle close (already CLOTURE)",
      run: () => new GovernanceService(
        { getById: async () => ({ id: "c1", tenantId: "t1", status: "CLOTURE", proposedClosureBy: ME }), close: noWrite("close") } as never,
        audit([]), undefined, gate(),
      ).close(actor(["governance.read", "governance.validate"]), "c1", null, "r"),
    },
    {
      name: "ActionPlan.close (already TERMINEE)",
      run: () => new ActionPlanService(
        { getById: async () => ({ id: "ap1", tenantId: "t1", status: "TERMINEE", createdBy: ME, responsibleUserId: ME }), close: noWrite("close") } as never,
        audit([]), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, gate(),
      ).close(actor(["actionplan.validate"]), "ap1", "ev", null, "r"),
    },
    {
      name: "ProcessEvaluationModeRequest.validate (already decided)",
      run: () => new ProcessEvaluationModeRequestService(
        { getById: async () => ({ id: "q1", tenantId: "t1", status: "VALIDATED", requestedBy: ME, processId: "p1", requestedMode: "PARTICIPATIF" }) } as never,
        {} as never, { list: async () => [] } as never, audit([]), gate(),
      ).validate(actor(["evaluationmode.validate"]), "q1", "r"),
    },
    {
      name: "RiskEvaluation.validate (already VALIDEE)",
      run: () => new RiskEvaluationService(
        { getById: async () => ({ id: "r1", tenantId: "t1", status: "VALIDEE", residualScore: 5, evaluatorId: ME }) } as never,
        audit([]), undefined, undefined, undefined, undefined, undefined, undefined, undefined, gate(),
      ).validate(actor(["riskevaluation.read", "riskevaluation.validate"]), "r1", null, "r"),
    },
  ];
  for (const c of cases) {
    it(`${c.name}: maker + DOUBLE_CONFIRMATION + nobody else + no confirmation -> 400 (ValidationError), never the 409 prompt`, async () => {
      await expect(c.run()).rejects.toMatchObject({ name: "ValidationError" });
    });
  }

  // Same family, one step further (QA-panel2 finding F-PNL2-05): a precondition checked AFTER the gate.
  it("F-PNL2-05: ActionPlan.close with an evidence that does not exist is answered 400 before the confirmation prompt", async () => {
    const svc = new ActionPlanService(
      { getById: async () => ({ id: "ap1", tenantId: "t1", status: "EN_COURS", createdBy: ME, responsibleUserId: ME }), close: noWrite("close") } as never,
      audit([]), undefined, undefined, undefined, undefined, { getById: async () => null } as never, undefined, undefined, undefined, undefined, undefined, gate(),
    );
    await expect(svc.close(actor(["actionplan.validate"]), "ap1", "ev-unknown", null, "r")).rejects.toMatchObject({ name: "ValidationError" });
  });
  it("F-PNL2-05 control: the same close WITH a valid confirmation is refused at the same evidence check", async () => {
    const svc = new ActionPlanService(
      { getById: async () => ({ id: "ap1", tenantId: "t1", status: "EN_COURS", createdBy: ME, responsibleUserId: ME }), close: noWrite("close") } as never,
      audit([]), undefined, undefined, undefined, undefined, { getById: async () => null } as never, undefined, undefined, undefined, undefined, undefined, gate(),
    );
    await expect(svc.close(actor(["actionplan.validate"]), "ap1", "ev-unknown", null, "r", { rule: "noSelfValidation", reason: "seul" }))
      .rejects.toMatchObject({ name: "ValidationError", message: expect.stringMatching(/does not exist/) });
  });
  it("F-PNL2-05b: ProcessEvaluationModeRequest.validate on a process that is not at PROCESS level is answered 400 before the confirmation prompt", async () => {
    const svc = new ProcessEvaluationModeRequestService(
      { getById: async () => ({ id: "q1", tenantId: "t1", status: "PENDING_VALIDATION", requestedBy: ME, processId: "p1", requestedMode: "PARTICIPATIF" }) } as never,
      { getById: async () => ({ id: "p1", tenantId: "t1", level: "MACRO", evaluationMode: "CLASSIQUE" }) } as never,
      { list: async () => [] } as never, audit([]), gate(),
    );
    await expect(svc.validate(actor(["evaluationmode.validate"]), "q1", "r")).rejects.toMatchObject({ name: "ValidationError" });
  });
});

describe("U2 / q159: the Committee paths leave the double confirmation and stay collegial", () => {
  const cfg = { gate: gate("DOUBLE_CONFIRMATION", false) };
  it("RiskEvaluation.validateByCommittee: the evaluator is refused (403) with or without governanceConfirmation, nothing written, no marker", async () => {
    const events: Ev[] = [];
    const row = { id: "r1", tenantId: "t1", status: "BROUILLON", residualScore: 20, evaluatorId: ME, committeeEvaluationMinScore: 15, committeeEvaluationEnforced: true };
    const svc = new RiskEvaluationService(
      { getById: async () => row, recordCommitteeValidation: async () => { throw new Error("must not be written"); } } as never,
      audit(events), undefined, undefined, undefined, undefined, undefined, undefined, undefined, cfg.gate,
    );
    const a = actor(["riskevaluation.read", "riskevaluation.validate.committee"]);
    await expect(svc.validateByCommittee(a, "r1", null, "r")).rejects.toMatchObject({ name: "ForbiddenError" });
    // an extra argument (what ValidateCommitteeBody still accepts on the wire) must change nothing
    await expect((svc.validateByCommittee as unknown as (...x: unknown[]) => Promise<unknown>)(a, "r1", null, "r", { rule: "noSelfValidation", reason: "seul" }))
      .rejects.toMatchObject({ name: "ForbiddenError" });
    expect(events).toEqual([]);
  });
  it("TreatmentDecision.validateByCommittee: the proposer is refused (403) with or without governanceConfirmation", async () => {
    const row = { id: "d1", tenantId: "t1", status: "PROPOSEE", decidedBy: ME, validatorId: "u-sup", riskEvaluationId: "r1" };
    const svc = new TreatmentDecisionService(
      { getById: async () => row, recordCommitteeValidation: async () => { throw new Error("must not be written"); } } as never,
      { getById: async () => ({ residualScore: 20, committeeTreatmentMinScore: 15, riskFrameworkVersionId: "v1" }) } as never,
      {} as never, audit([]), undefined, cfg.gate,
    );
    const a = actor(["treatmentdecision.validate.committee"]);
    await expect(svc.validateByCommittee(a, "d1", null, "r")).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect((svc.validateByCommittee as unknown as (...x: unknown[]) => Promise<unknown>)(a, "d1", null, "r", { rule: "noSelfValidation", reason: "seul" }))
      .rejects.toMatchObject({ name: "ForbiddenError" });
  });
  it("the ordinary (non-Committee) validate keeps the confirmation: the same evaluator below the threshold gets the 409 prompt, then is applied once confirmed", async () => {
    const events: Ev[] = [];
    const row = { id: "r1", tenantId: "t1", status: "BROUILLON", residualScore: 5, evaluatorId: ME, committeeEvaluationMinScore: 15, committeeEvaluationEnforced: true };
    const svc = new RiskEvaluationService(
      { getById: async () => row, recordValidation: async () => ({ ...row, status: "VALIDEE" }) } as never,
      audit(events), undefined, undefined, undefined, undefined, undefined, undefined, undefined, cfg.gate,
    );
    const a = actor(["riskevaluation.read", "riskevaluation.validate"]);
    await expect(svc.validate(a, "r1", null, "r")).rejects.toMatchObject({ name: "ConflictError" });
    await svc.validate(a, "r1", null, "r", { rule: "noSelfValidation", reason: "seule personne" });
    expect(events.map((e) => e["governanceException"])).toEqual(["noSelfValidation"]);
  });
});

describe("U3 / q155 Google: what counts as a connection", () => {
  const payloads: Record<string, { email: string; email_verified: boolean; iat: number; name?: string }> = {};
  function provider(onIdentified: (t: string, u: string) => void, membership: { userId: string; tenantId: string } | null = { userId: "u1", tenantId: "t1" }) {
    const p = new GoogleIdentityProvider("client", async () => (membership ? { ...membership, roles: [], dashboardScopeMode: "GLOBAL" } : null) as never, onIdentified);
    (p as unknown as { client: unknown }).client = { verifyIdToken: async ({ idToken }: { idToken: string }) => ({ getPayload: () => payloads[idToken] }) };
    return p;
  }
  it("many requests with ONE token = one call; a renewed token (new iat) = a new call (pinned: the silent renewal counts as a connection)", async () => {
    const onId = vi.fn();
    const p = provider(onId);
    payloads["tokA"] = { email: "a@x", email_verified: true, iat: 1000 };
    payloads["tokB"] = { email: "a@x", email_verified: true, iat: 4600 }; // ~1 hour later, minted silently by the Google client
    for (let i = 0; i < 20; i += 1) await p.verifyToken("tokA");
    expect(onId).toHaveBeenCalledTimes(1);
    await p.verifyToken("tokB");
    expect(onId).toHaveBeenCalledTimes(2); // no human action needed for this call: see F-PNL2-02
    await p.verifyToken("tokB");
    expect(onId).toHaveBeenCalledTimes(2);
  });
  it("two devices with two live tokens alternate iat: the provider calls back each time (pinned), the recorder keeps it at one write per hour", async () => {
    const onId = vi.fn();
    const p = provider(onId);
    payloads["dev1"] = { email: "a@x", email_verified: true, iat: 2000 };
    payloads["dev2"] = { email: "a@x", email_verified: true, iat: 2010 };
    for (let i = 0; i < 5; i += 1) { await p.verifyToken("dev1"); await p.verifyToken("dev2"); }
    expect(onId).toHaveBeenCalledTimes(10);
    const query = vi.fn(async () => ({ rows: [] }));
    const rec = createLastSeenRecorder({ query } as never);
    for (let i = 0; i < 10; i += 1) rec("t1", "u1");
    await new Promise((r) => setTimeout(r, 10));
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("an open session that silently renews its token every hour moves last_seen_at every hour with nobody at the keyboard (evidence for F-PNL2-02)", async () => {
    vi.useFakeTimers();
    try {
      const query = vi.fn(async () => ({ rows: [] }));
      const rec = createLastSeenRecorder({ query } as never);
      const p = provider((t, u) => rec(t, u));
      for (let hour = 0; hour < 6; hour += 1) {
        payloads[`night${hour}`] = { email: "a@x", email_verified: true, iat: 1_000_000 + hour * 3600 };
        await p.verifyToken(`night${hour}`);
        await vi.advanceTimersByTimeAsync(3_600_001);
      }
      expect(query).toHaveBeenCalledTimes(6);
    } finally { vi.useRealTimers(); }
  });
  it("no call for an unverified e-mail, an unknown member, or a failing verification; a throwing callback never blocks the request", async () => {
    const onId = vi.fn(() => { throw new Error("boom"); });
    payloads["unverified"] = { email: "a@x", email_verified: false, iat: 1 };
    await expect(provider(onId).verifyToken("unverified")).rejects.toMatchObject({ name: "ForbiddenError" });
    payloads["ok"] = { email: "a@x", email_verified: true, iat: 1 };
    await expect(provider(onId, null).verifyToken("ok")).rejects.toMatchObject({ name: "ForbiddenError" });
    expect(onId).not.toHaveBeenCalled();
    await expect(provider(onId).verifyToken("ok")).resolves.toMatchObject({ userId: "u1" }); // callback throws, request goes on
    await expect(provider(onId).verifyToken("missing")).rejects.toBeTruthy();
  });
});

describe("U4 / notification middleware: success statuses of mutating requests only", () => {
  async function call(method: string, status: number, withUser = true) {
    const processRequest = vi.fn(async () => undefined);
    const app = express();
    app.use((req, _res, next) => { req.requestId = "req-1"; next(); });
    app.use(governanceNotificationsMiddleware({ processRequest }));
    app.all("/x", (req, res) => { if (withUser) (req as unknown as { user: unknown }).user = { tenantId: "t1", userId: "u1" }; res.status(status).json({}); });
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      await fetch(`http://127.0.0.1:${port}/x`, { method, ...(method === "GET" ? {} : { body: "{}", headers: { "content-type": "application/json" } }) });
      await new Promise((r) => setTimeout(r, 20));
    } finally { server.close(); }
    return processRequest;
  }
  it("200, 201 and 202 (pendingRequest) notify with tenant, actor and request id", async () => {
    for (const s of [200, 201, 202]) {
      const spy = await call("POST", s);
      expect(spy, String(s)).toHaveBeenCalledWith("t1", "u1", "req-1");
    }
  });
  it("PUT/PATCH notify too; 204 notifies; 3xx, 4xx (400, 403, 404, 409, 429) and 5xx never; GET never; unauthenticated never", async () => {
    expect(await call("PUT", 200)).toHaveBeenCalledTimes(1);
    expect(await call("PATCH", 200)).toHaveBeenCalledTimes(1);
    expect(await call("POST", 204)).toHaveBeenCalledTimes(1);
    for (const s of [302, 400, 401, 403, 404, 409, 429, 500, 503]) expect(await call("POST", s), String(s)).not.toHaveBeenCalled();
    expect(await call("GET", 200)).not.toHaveBeenCalled();
    expect(await call("POST", 200, false)).not.toHaveBeenCalled();
  });
});

describe("U5 / notifier: one row handled once per process", () => {
  const row = (over: Partial<GovernanceAuditRow>): GovernanceAuditRow =>
    ({ id: "a1", userId: "author", entityType: "Finding", entityId: "f1", action: "CLOSE", governanceException: "noSelfValidation", oldValue: null, newValue: null, systemGroup: null, ...over }) as GovernanceAuditRow;
  const source = (rows: GovernanceAuditRow[]) => ({
    rowsForRequest: async () => rows,
    holdersOf: async (_t: string, p: string) => (p === "governanceexception.review" ? ["rm", "author", "audit"] : []),
    groupMembers: async () => [], managerId: async () => "mgr", unreviewedExceptionCount: async () => 0,
  });
  it("the same request processed twice in ONE notifier emits once; a SECOND notifier (another instance) emits again (pinned; skipIfUnread is the only protection)", async () => {
    const emit = vi.fn(async () => undefined);
    const one = new GovernanceNotifier({ emit } as never, source([row({})]));
    await one.processRequest("t1", "author", "req-same");
    await one.processRequest("t1", "author", "req-same");
    expect(emit.mock.calls.map((c) => (c[0] as { recipientUserId: string }).recipientUserId).sort()).toEqual(["audit", "mgr", "rm"]); // never the author
    const two = new GovernanceNotifier({ emit } as never, source([row({})]));
    await two.processRequest("t1", "author", "req-same");
    expect(emit).toHaveBeenCalledTimes(6);
    for (const c of emit.mock.calls) expect((c[0] as { skipIfUnread: boolean }).skipIfUnread).toBe(true);
  });
  it("F-PNL2-04: a failing emit for one recipient does not stop the other recipients of the same row (it does today: the loop aborts)", async () => {
    let n = 0;
    const emit = vi.fn(async () => { n += 1; if (n === 1) throw new Error("db down"); });
    const logged: string[] = [];
    const nf = new GovernanceNotifier({ emit } as never, source([row({})]), (m) => logged.push(m));
    await expect(nf.processRequest("t1", "author", "req-2")).resolves.toBeUndefined();
    expect(emit).toHaveBeenCalledTimes(3); // today: 1 -- the remaining two mandatory notifications are silently lost
    expect(logged.join(" ")).not.toMatch(/db down|author/); // no detail with identities in the message
  });
});

describe("U6 / fixed groups after q157, q158 and D5", () => {
  it("Audit holds no deciding right: no approve/confirm/accept/set, no orgprofile.approve, no config.*", () => {
    const audit = FIXED_GROUP_PERMISSIONS.AUDIT as string[];
    for (const p of audit) {
      expect(p, p).not.toMatch(/\.approve$|\.confirm$|\.accept$|^config\.|\.set$|\.submit$|\.assign$|designation\./);
      expect(isAuditGroupPermission(p as never), p).toBe(true);
    }
    expect(audit).toEqual(expect.arrayContaining(["governanceexception.review", "governanceprinciple.acceptance.revoke"]));
    expect(audit).not.toContain("orgprofile.approve");
  });
  it("Risk Manager and Committee both hold config.selfvalidation.approve, and NEITHER holds config.selfvalidation.set (the maker of a relaxation)", () => {
    for (const g of ["RISK_MANAGER", "RISK_COMMITTEE"] as const) {
      const perms = FIXED_GROUP_PERMISSIONS[g] as string[];
      expect(perms, g).toContain("config.selfvalidation.approve");
      expect(perms, g).not.toContain("config.selfvalidation.set");
    }
  });
  it("accepting a principle is for the Risk Manager (and administrators) only: the Committee confirms, never accepts (q138)", () => {
    expect(FIXED_GROUP_PERMISSIONS.RISK_MANAGER).toContain("governanceprinciple.accept");
    expect(FIXED_GROUP_PERMISSIONS.RISK_COMMITTEE).not.toContain("governanceprinciple.accept");
    expect(FIXED_GROUP_PERMISSIONS.RISK_COMMITTEE).toContain("governanceprinciple.acceptance.confirm");
  });
});

describe("U7 / q142 label on the lists the screens actually read", () => {
  it("F-PNL2-01: GET /dashboard/actions (the ONLY list the Plans d'action screen reads) carries validationIndependence like GET /actions does", async () => {
    const app = express();
    app.use((req, _res, next) => { (req as unknown as { user: unknown }).user = { tenantId: "t1", userId: "u1", roles: [] }; next(); });
    app.use("/api/v1/dashboard", actionPlanDashboardRouter(
      { dashboard: async () => [{ id: "ap1", status: "TERMINEE", computedStatus: "TERMINEE" }] } as never,
      { forEntities: async () => new Map([["ap1", "WITHOUT_INDEPENDENT_REVIEW"]]) } as never,
    ));
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/dashboard/actions`);
      const body = (await res.json()) as { data: Array<Record<string, unknown>> };
      expect(body.data[0]).toMatchObject({ validationIndependence: "WITHOUT_INDEPENDENT_REVIEW" });
    } finally { server.close(); }
  });
  it("control: the other action-plan reads and the Findings / executions / effectiveness / evaluations reads DO carry it (router signature accepts the lookup)", () => {
    for (const f of ["actionPlans", "findings", "executions", "effectiveness", "riskEvaluations", "treatmentDecisions", "reviewCycles", "processEvaluationModeRequests"]) {
      const src = readFileSync(join(__dirname, "..", "src", "api", "v1", `${f}.routes.ts`), "utf8");
      expect(src, f).toMatch(/GovernanceExceptionLookup/);
    }
    expect(readFileSync(join(__dirname, "..", "src", "api", "v1", "actionPlanDashboard.routes.ts"), "utf8")).toMatch(/GovernanceExceptionLookup/);
  });
});
