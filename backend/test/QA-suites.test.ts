import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { configRouter } from "../src/api/v1/config.routes.js";
import { governancePrincipleAcceptancesRouter } from "../src/api/v1/governancePrincipleAcceptances.routes.js";
import { ConfigService, MAX_GOVERNANCE_DELAY_DAYS } from "../src/services/ConfigService.js";
import { GovernancePrincipleAcceptanceService } from "../src/services/GovernancePrincipleAcceptanceService.js";
import { GovernanceNotifier } from "../src/services/GovernanceNotifier.js";
import { ADMIN_PERMISSIONS, FIXED_GROUP_PERMISSIONS, isAdministrator } from "../src/domain/fixedGroupPermissions.js";
import { ALL_PERMISSIONS } from "../src/domain/permissions.js";
import { NOTIFICATION_CATALOG } from "../src/domain/notificationCatalog.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import type { Config } from "../src/domain/entities/Config.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { Role } from "../src/domain/entities/Role.js";
import type { GovernancePrincipleAcceptance } from "../src/domain/entities/GovernanceReviews.js";
import type { GovernanceAuditRow, GovernanceEventSource } from "../src/domain/governance/governanceEvents.js";
import type { SelfValidationPolicyRequest } from "../src/domain/repositories/SelfValidationPolicyRequestRepository.js";
import { fakeDelayRequests } from "./fakeDelayRequests.js";
import type { AcceptanceCreated, GovernancePrincipleAcceptanceRepository } from "../src/domain/repositories/GovernanceReviewRepositories.js";

/**
 * QA-suites (level 2): DECISION-083 (q168/q169/q170/q174, migration 075). Oracles written before running:
 *  - PUT /config/governance-delays: strict body, 1..3650 whole days or null, own permission (+config.read, as the service reads the row),
 *    an omitted key is untouched, null clears ONE key, a refusal writes nothing (no version bump, no audit row).
 *  - q174: a request past requestedAt + days is never approvable (409, policy unchanged, request still PENDING) but stays
 *    rejectable and replaceable; no delay configured => expiresAt null and nothing expires.
 *  - q169: expiresAt == now + maxDays is accepted, + 1 ms refused; no setting / no repo => no bound.
 *  - q170: the acceptor is told when SOMEONE ELSE ends the acceptance early; never the revoker, never for an expiry close.
 *  - Migration 075: catch-up list == ADMIN_PERMISSIONS (minus the new key), no physical delete on a business table, down restores.
 */
const T = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const user = (userId: string, roles: string[], tenantId = T): AuthenticatedUser =>
  ({ userId, tenantId, email: `${userId}@x.io`, displayName: userId, roles }) as unknown as AuthenticatedUser;
const DAY = 86_400_000;
const NEW_PERM = "config.governancedelays.set";
const DELAYS = ["exceptionReviewDelayDays", "acceptanceMaxDays", "policyRequestExpiryDays"] as const;

// -- config world (q168 / q174) --------------------------------------------------------------------------------------
function configWorld(opts: { approver?: boolean; wired?: boolean } = {}) {
  const events: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
  const seenTenants: string[] = [];
  const rows = new Map<string, Config>();
  let request: SelfValidationPolicyRequest | null = null;
  let n = 0;
  const base = (tenantId: string): Config =>
    ({ id: `cfg-${tenantId}`, tenantId, version: 1, selfValidationPolicy: "REFUSE", committeeAuditCumulAllowed: true, exceptionReviewDelayDays: null, acceptanceMaxDays: null, policyRequestExpiryDays: null }) as unknown as Config;
  const configs = {
    getByTenant: async (t: string) => { seenTenants.push(t); return rows.get(t) ?? null; },
    // Mirrors buildUpdateSet: only keys that are !== undefined are written (null is written).
    upsert: async (t: string, patch: Record<string, unknown>, by: string) => {
      const cur = rows.get(t) ?? base(t);
      const next = { ...cur, version: cur.version + 1, updatedBy: by } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v;
      rows.set(t, next as unknown as Config);
      return next as unknown as Config;
    },
  };
  const requests = {
    getPending: async (t: string) => (request && request.tenantId === t && request.status === "PENDING" ? request : null),
    getById: async (t: string, id: string) => (request && request.tenantId === t && request.id === id ? request : null),
    create: async (t: string, policy: never, reason: string, by: string, expiresAt?: Date | null) =>
      (request = { id: `req${++n}`, tenantId: t, requestedPolicy: policy, reason, status: "PENDING", requestedBy: by, requestedAt: new Date(), decidedBy: null, decidedAt: null, decisionReason: null, expiresAt: expiresAt ?? null } as SelfValidationPolicyRequest),
    decide: async (_t: string, id: string, status: never, by: string, why: string | null) =>
      request?.id === id && request.status === "PENDING" ? (request = { ...request, status, decidedBy: by, decisionReason: why }) : null,
    reopen: async () => { if (request) request = { ...request, status: "PENDING", decidedBy: null }; },
  };
  const service = new ConfigService(
    configs as never,
    { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { events.push(e); } } as never,
    undefined,
    undefined,
    opts.wired === false ? undefined : { existsOther: async () => opts.approver ?? true },
    opts.wired === false ? undefined : (requests as never),
    opts.wired === false ? undefined : fakeDelayRequests(configs.upsert as never, events).repo,
  );
  return { service, events, rows, seenTenants, request: () => request, // moves the request back in time: both its submission date and its (frozen at submission) expiry
    ageRequest: (ms: number) => { request = { ...request!, requestedAt: new Date(request!.requestedAt.getTime() - ms), expiresAt: request!.expiresAt ? new Date(request!.expiresAt.getTime() - ms) : null }; } };
}

async function http(mount: (app: express.Express) => void, who: AuthenticatedUser, method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: AuthenticatedUser }).user = who;
    (req as unknown as { requestId: string }).requestId = "req";
    next();
  });
  mount(app);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  } finally {
    server.close();
  }
}

const delaysAdmin = user("adm", ["config.read", NEW_PERM]);
const put = (w: ReturnType<typeof configWorld>, who: AuthenticatedUser, body: unknown) =>
  http((a) => a.use("/config", configRouter(w.service)), who, "PUT", "/config/governance-delays", body);

describe("QA-suites PUT /config/governance-delays", () => {
  it("200 for a strict body: all three set, then boundaries 1 and 3650", async () => {
    // q182: lengthening 90 -> 3650 is applied at once only when nobody else can approve (otherwise 202, see below).
    const w = configWorld({ approver: false });
    const r = await put(w, delaysAdmin, { exceptionReviewDelayDays: 30, acceptanceMaxDays: 90, policyRequestExpiryDays: 7, reason: "Paramétrage initial" });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ exceptionReviewDelayDays: 30, acceptanceMaxDays: 90, policyRequestExpiryDays: 7 });
    const edge = await put(w, delaysAdmin, { exceptionReviewDelayDays: 1, acceptanceMaxDays: 3650, reason: "bornes" });
    expect(edge.status).toBe(200);
    expect(edge.json.data).toMatchObject({ exceptionReviewDelayDays: 1, acceptanceMaxDays: 3650, policyRequestExpiryDays: 7 });
    expect(MAX_GOVERNANCE_DELAY_DAYS).toBe(3650);
  });

  it("400 and nothing written: 0, 3651, negative, decimal, string, boolean, array, NaN-like, Infinity-like", async () => {
    const w = configWorld();
    for (const bad of [0, 3651, -1, 1.5, "7", true, [7], 1e9, 3650.0000001]) {
      for (const key of DELAYS) {
        const r = await put(w, delaysAdmin, { [key]: bad, reason: "r" });
        expect(r.status, `${key}=${JSON.stringify(bad)}`).toBe(400);
      }
    }
    expect(w.rows.size).toBe(0);
    expect(w.events).toHaveLength(0);
  });

  it("400: empty change set, unknown or attribution keys (strict), missing / blank / non-string reason", async () => {
    const w = configWorld();
    expect((await put(w, delaysAdmin, { reason: "r" })).status).toBe(400);
    expect((await put(w, delaysAdmin, {})).status).toBe(400);
    for (const extra of [{ acceptanceMaxDay: 5 }, { selfValidationPolicy: "DOUBLE_CONFIRMATION" }, { updatedBy: "x" }, { version: 9 }, { tenantId: T2 }]) {
      expect((await put(w, delaysAdmin, { acceptanceMaxDays: 5, reason: "r", ...extra })).status, JSON.stringify(extra)).toBe(400);
    }
    for (const reason of [undefined, "", "   ", 5, null, "x".repeat(2001)]) {
      expect((await put(w, delaysAdmin, { acceptanceMaxDays: 5, reason })).status, String(reason)).toBe(400);
    }
    // not an object at all
    expect((await put(w, delaysAdmin, [1, 2])).status).toBe(400);
    expect(w.rows.size).toBe(0);
    expect(w.events).toHaveLength(0);
  });

  it("403 without the dedicated permission (neighbour permissions do not count), no effect, no audit", async () => {
    const w = configWorld();
    for (const perm of ["config.update", "config.manage", "config.selfvalidation.set", "config.cumul.set", "config.committeeenforcement.set", "config.selfvalidation.approve"]) {
      const r = await put(w, user("u", ["config.read", perm]), { acceptanceMaxDays: 5, reason: "r" });
      expect(r.status, perm).toBe(403);
    }
    expect((await put(w, user("u", []), { acceptanceMaxDays: 5, reason: "r" })).status).toBe(403);
    expect(w.rows.size).toBe(0);
    expect(w.events).toHaveLength(0);
  });

  it("the dedicated permission alone (no config.read) is enough, and the change is audited", async () => {
    const w = configWorld();
    const r = await put(w, user("u", [NEW_PERM]), { acceptanceMaxDays: 5, reason: "r" });
    expect(r.status).toBe(200);
    expect(w.events).toHaveLength(1);
  });

  it("null clears ONE key only; an omitted key is untouched; the audit carries before / after / reason", async () => {
    const w = configWorld({ approver: false }); // q182: clearing is a lengthening, applied alone (marked) without an approver
    await put(w, delaysAdmin, { exceptionReviewDelayDays: 30, acceptanceMaxDays: 90, policyRequestExpiryDays: 7, reason: "init" });
    const cleared = await put(w, delaysAdmin, { acceptanceMaxDays: null, reason: "Retrait du plafond" });
    expect(cleared.status).toBe(200);
    expect(cleared.json.data).toMatchObject({ exceptionReviewDelayDays: 30, acceptanceMaxDays: null, policyRequestExpiryDays: 7 });
    const last = w.events.at(-1)!;
    expect(last).toMatchObject({ entityType: "Config", action: "UPDATE", userId: "adm", reason: "Retrait du plafond", tenantId: T, governanceException: "config.governancedelays.adminAlone" });
    expect((last.oldValue as Config).acceptanceMaxDays).toBe(90);
    expect((last.newValue as Config).acceptanceMaxDays).toBeNull();
    expect(w.events).toHaveLength(2);
    // clearing an already-null key is accepted and stays null (not an error)
    const again = await put(w, delaysAdmin, { acceptanceMaxDays: null, reason: "idem" });
    expect(again.status).toBe(200);
    expect(again.json.data.acceptanceMaxDays).toBeNull();
  });

  it("the three keys can all be cleared in one call; the row stays and the other settings are untouched", async () => {
    const w = configWorld({ approver: false });
    await w.service.setCommitteeAuditCumul(user("c", ["config.read", "config.cumul.set"]), false, "r", "q");
    await put(w, delaysAdmin, { exceptionReviewDelayDays: 5, acceptanceMaxDays: 6, policyRequestExpiryDays: 7, reason: "init" });
    const r = await put(w, delaysAdmin, { exceptionReviewDelayDays: null, acceptanceMaxDays: null, policyRequestExpiryDays: null, reason: "tout retirer" });
    expect(r.json.data).toMatchObject({ exceptionReviewDelayDays: null, acceptanceMaxDays: null, policyRequestExpiryDays: null, committeeAuditCumulAllowed: false });
  });

  it("tenant scoped: a write for tenant A never touches tenant B; the tenant comes from the actor, not the body", async () => {
    const w = configWorld();
    await put(w, user("a", ["config.read", NEW_PERM], T), { acceptanceMaxDays: 10, reason: "r" });
    await put(w, user("b", ["config.read", NEW_PERM], T2), { acceptanceMaxDays: 20, reason: "r" });
    expect(w.rows.get(T)!.acceptanceMaxDays).toBe(10);
    expect(w.rows.get(T2)!.acceptanceMaxDays).toBe(20);
    expect(w.events.map((e) => e.tenantId)).toEqual([T, T2]);
  });

  it("GET /config exposes the three delays, null by default; other PUT routes cannot set them", async () => {
    const w = configWorld();
    const g = await http((a) => a.use("/config", configRouter(w.service)), delaysAdmin, "GET", "/config");
    expect(g.status).toBe(200);
    expect(g.json.data).toMatchObject({ exceptionReviewDelayDays: null, acceptanceMaxDays: null, policyRequestExpiryDays: null });
    const sneaky = await http((a) => a.use("/config", configRouter(w.service)), user("c", ["config.read", "config.cumul.set"]), "PUT", "/config/committee-audit-cumul", { allowed: false, reason: "r", acceptanceMaxDays: 5 });
    expect(sneaky.json?.data?.acceptanceMaxDays ?? null).toBeNull();
    expect(w.rows.get(T)?.acceptanceMaxDays ?? null).toBeNull();
  });

  it("service-level: non-integer or out-of-range values are refused even without the route (defence in depth)", async () => {
    const w = configWorld();
    for (const bad of [0, 3651, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -0.5]) {
      await expect(w.service.setGovernanceDelays(delaysAdmin, { acceptanceMaxDays: bad }, "r", "q")).rejects.toThrow(ValidationError);
    }
    await expect(w.service.setGovernanceDelays(delaysAdmin, { acceptanceMaxDays: 5 }, "r\u0000x", "q")).rejects.toThrow(ValidationError);
    expect(w.events).toHaveLength(0);
  });

  it("q182 HTTP: a lengthening answers 202 + pendingRequest (config unchanged); GET shows it; a third party approves; strict bodies", async () => {
    const w = configWorld();
    await put(w, delaysAdmin, { riskManagerVacancyMaxDays: 30, reason: "init" });
    const r = await put(w, delaysAdmin, { riskManagerVacancyMaxDays: 120, reason: "Allonger" });
    expect(r.status).toBe(202);
    expect(r.json.data.riskManagerVacancyMaxDays).toBe(30);
    expect(r.json.pendingRequest).toMatchObject({ status: "PENDING", requestedDelays: { riskManagerVacancyMaxDays: 120 } });
    const mount = (a: express.Express) => a.use("/config", configRouter(w.service));
    const rm = user("rm", ["config.selfvalidation.approve"]);
    const g = await http(mount, rm, "GET", "/config/governance-delays/request");
    expect(g.json.data.id).toBe(r.json.pendingRequest.id);
    const id = r.json.pendingRequest.id as string;
    expect((await http(mount, rm, "POST", "/config/governance-delays/requests/not-a-uuid/approve", { reason: "ok" })).status).toBe(400);
    expect((await http(mount, rm, "POST", `/config/governance-delays/requests/${id}/approve`, {})).status).toBe(400);
    expect((await http(mount, delaysAdmin, "POST", `/config/governance-delays/requests/${id}/approve`, { reason: "ok" })).status).toBe(403);
    const ok = await http(mount, rm, "POST", `/config/governance-delays/requests/${id}/approve`, { reason: "ok" });
    expect(ok.status).toBe(200);
    expect(ok.json.data.riskManagerVacancyMaxDays).toBe(120);
  });

  it("permission / ADMIN / fixed groups: the key exists, makes its holder an administrator, no fixed group holds it", () => {
    expect(ALL_PERMISSIONS).toContain(NEW_PERM);
    expect(ADMIN_PERMISSIONS).toContain(NEW_PERM);
    const role = { permissions: [NEW_PERM] } as unknown as Role;
    expect(isAdministrator([role])).toBe(true);
    for (const [group, perms] of Object.entries(FIXED_GROUP_PERMISSIONS)) expect(perms, group).not.toContain(NEW_PERM);
  });
});

// -- q174 (expiry frozen at submission, F-SAD-02) ----------------------------------------------------------------------
describe("QA-suites q174 expiry of a self-validation relaxation request", () => {
  const admin = user("u-admin", ["config.read", "config.selfvalidation.set", NEW_PERM]);
  const approver = user("u-rm", ["config.read", "config.selfvalidation.approve"]);
  // q182: a lengthening (or clearing) of the delay waits for a third party: approved here so the delay really changes.
  const setExpiry = async (w: ReturnType<typeof configWorld>, days: number | null) => {
    const r = await w.service.setGovernanceDelays(admin, { policyRequestExpiryDays: days }, "r", "q");
    if (r.pendingRequest) await w.service.approveGovernanceDelays(approver, r.pendingRequest.id, "ok", "q");
    return r;
  };
  const submit = (w: ReturnType<typeof configWorld>) => w.service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "r", "q");
  afterEach(() => vi.useRealTimers());

  it("no delay configured: expiresAt is null and a very old request is still approvable", async () => {
    const w = configWorld();
    await submit(w);
    expect(w.request()!.expiresAt).toBeNull();
    w.ageRequest(5 * 365 * DAY);
    expect((await w.service.getPendingSelfValidationPolicyRequest(approver))!.expiresAt).toBeNull();
    await expect(w.service.approveSelfValidationPolicy(approver, "req1", "q")).resolves.toMatchObject({ selfValidationPolicy: "DOUBLE_CONFIRMATION" });
  });

  it("no config row at all and no pending request: view is null / no crash", async () => {
    const w = configWorld();
    expect(await w.service.getPendingSelfValidationPolicyRequest(approver)).toBeNull();
  });

  it("submission freezes expiresAt = now + days; the view reads it back without touching the config, and needs no config.read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    const w = configWorld();
    await setExpiry(w, 7);
    await submit(w);
    expect(w.request()!.expiresAt!.getTime()).toBe(Date.now() + 7 * DAY);
    const reads = w.seenTenants.length;
    const view = await w.service.getPendingSelfValidationPolicyRequest(user("u-rm2", ["config.selfvalidation.approve"]));
    expect(view!.expiresAt!.getTime()).toBe(Date.now() + 7 * DAY);
    expect(w.seenTenants).toHaveLength(reads); // F-SAD-02: no config re-read on the view
  });

  it("boundary (frozen clock): exactly at expiresAt is expired, 1 ms before is approvable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    const ok = configWorld();
    await setExpiry(ok, 7);
    await submit(ok);
    vi.setSystemTime(new Date(Date.now() + 7 * DAY - 1));
    await expect(ok.service.approveSelfValidationPolicy(approver, "req1", "q")).resolves.toBeDefined();
    const late = configWorld();
    await setExpiry(late, 7);
    await submit(late);
    vi.setSystemTime(new Date(Date.now() + 1));
    // the clock is now exactly at the second request's expiry? recompute explicitly
    late.ageRequest(0);
    vi.setSystemTime(late.request()!.expiresAt!);
    await expect(late.service.approveSelfValidationPolicy(approver, "req1", "q")).rejects.toThrow(ConflictError);
  });

  it("expired: approve is a ConflictError naming the date, policy unchanged, request still PENDING, no audit row", async () => {
    const w = configWorld();
    await setExpiry(w, 7);
    await submit(w);
    w.ageRequest(8 * DAY);
    const auditBefore = w.events.length;
    await expect(w.service.approveSelfValidationPolicy(approver, "req1", "q")).rejects.toThrow(/expired on \d{4}-\d{2}-\d{2}/);
    expect(w.rows.get(T)!.selfValidationPolicy).toBe("REFUSE");
    expect(w.request()!.status).toBe("PENDING");
    expect(w.events).toHaveLength(auditBefore);
    const view = await w.service.getPendingSelfValidationPolicyRequest(approver);
    expect(view!.expiresAt!.getTime()).toBeLessThan(Date.now());
  });

  it("expired: still rejectable by another person, and the author is still refused first (403, not 409)", async () => {
    const w = configWorld();
    await setExpiry(w, 7);
    await submit(w);
    w.ageRequest(30 * DAY);
    await expect(w.service.approveSelfValidationPolicy(user("u-admin", ["config.read", "config.selfvalidation.approve"]), "req1", "q")).rejects.toThrow(ForbiddenError);
    await expect(w.service.rejectSelfValidationPolicy(approver, "req1", "Échue", "q")).resolves.toMatchObject({ status: "REJECTED" });
    expect(w.events.at(-1)).toMatchObject({ entityType: "SelfValidationPolicyRequest", action: "REJECT" });
    await expect(w.service.approveSelfValidationPolicy(approver, "req1", "q")).rejects.toThrow(ValidationError);
  });

  it("expired: replaceable; the old one is WITHDRAWN, the new one gets a FRESH expiry and is approvable", async () => {
    const w = configWorld();
    await setExpiry(w, 7);
    await submit(w);
    w.ageRequest(10 * DAY);
    const again = await w.service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "Nouvelle demande", "q");
    expect(again.pendingRequest).toMatchObject({ id: "req2", status: "PENDING" });
    expect(w.request()!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect(w.events.map((e) => `${e.entityType}:${e.action}`).slice(-2)).toEqual(["SelfValidationPolicyRequest:CLOSE", "SelfValidationPolicyRequest:SUBMIT"]);
    await expect(w.service.approveSelfValidationPolicy(approver, "req2", "q")).resolves.toMatchObject({ selfValidationPolicy: "DOUBLE_CONFIRMATION" });
  });

  it("F-SAD-02: changing or clearing the delay AFTER submission never revives or shortens a submitted request", async () => {
    const w = configWorld();
    await setExpiry(w, 7);
    await submit(w);
    w.ageRequest(10 * DAY); // expired
    await setExpiry(w, 3650); // lengthening
    await expect(w.service.approveSelfValidationPolicy(approver, "req1", "q")).rejects.toThrow(ConflictError);
    await setExpiry(w, null); // clearing
    await expect(w.service.approveSelfValidationPolicy(approver, "req1", "q")).rejects.toThrow(ConflictError);
    // and the other way: a request submitted with no delay stays approvable when a short delay is set later
    const v = configWorld();
    await submit(v);
    v.ageRequest(30 * DAY);
    await setExpiry(v, 1);
    await expect(v.service.approveSelfValidationPolicy(approver, "req1", "q")).resolves.toBeDefined();
  });

  it("a non-relaxing change (no request) does not need or invent an expiry", async () => {
    const w = configWorld({ approver: false });
    await setExpiry(w, 7);
    const r = await submit(w); // nobody can approve: applied alone, no request row
    expect(r.pendingRequest).toBeNull();
    expect(w.request()).toBeNull();
  });

  it("HTTP: GET request carries expiresAt (ISO), approve of an expired request answers 409, reject 200", async () => {
    const w = configWorld();
    const mount = (a: express.Express) => a.use("/config", configRouter(w.service));
    await setExpiry(w, 7);
    await submit(w);
    const g = await http(mount, approver, "GET", "/config/self-validation-policy/request");
    expect(g.status).toBe(200);
    expect(new Date(g.json.data.expiresAt).toISOString()).toBe(g.json.data.expiresAt);
    w.ageRequest(9 * DAY);
    const id = "00000000-0000-4000-8000-0000000000aa";
    (w.request() as { id: string }).id = id; // the route validates a GUID
    const a = await http(mount, approver, "POST", `/config/self-validation-policy/requests/${id}/approve`, { reason: "ok" });
    expect(a.status).toBe(409);
    expect(a.json.error).toMatch(/expired/);
    const r = await http(mount, approver, "POST", `/config/self-validation-policy/requests/${id}/reject`, { reason: "Échue" });
    expect(r.status).toBe(200);
  });
});

// -- q169 ------------------------------------------------------------------------------------------------------------
function acceptanceWorld(maxDays: number | null | "unwired", opts: { tenantSeen?: string[]; thirdParty?: boolean } = {}) {
  const rows = new Map<string, GovernancePrincipleAcceptance>();
  const audits: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
  let n = 0;
  let expiredClosed: GovernancePrincipleAcceptance | null = null;
  const repo: GovernancePrincipleAcceptanceRepository = {
    list: async () => [...rows.values()],
    getById: async (_t, id) => rows.get(id) ?? null,
    create: async (input, audit) => {
      const a = {
        id: `ac${++n}`, tenantId: input.tenantId, principleId: input.principleId, catalogVersion: input.catalogVersion, offendersSnapshot: input.offendersSnapshot,
        reason: input.reason, expiresAt: input.expiresAt, status: input.status, regime: input.regime, acceptedBy: input.acceptedBy, acceptedAt: new Date(),
        confirmedBy: null, confirmedAt: null, endedBy: null, endedAt: null, endReason: null,
      } as GovernancePrincipleAcceptance;
      rows.set(a.id, a);
      const out: AcceptanceCreated = { acceptance: a, expiredClosed };
      audits.push(...(audit(out) as never[]));
      return out;
    },
    confirm: async () => { throw new Error("unused"); },
    end: async (_t, id, to, by, reason, audit) => {
      const a = { ...rows.get(id)!, status: to, endedBy: by, endReason: reason };
      rows.set(id, a);
      audits.push(...(audit(a) as never[]));
      return a;
    },
  };
  const service = new GovernancePrincipleAcceptanceService(
    repo,
    { record: async () => undefined } as never,
    { existsOther: async () => opts.thirdParty ?? false },
    undefined,
    maxDays === "unwired" ? undefined : { getByTenant: async (t: string) => { opts.tenantSeen?.push(t); return maxDays === null ? null : ({ acceptanceMaxDays: maxDays } as never); } },
  );
  return { service, rows, audits, setExpiredClosed: (a: GovernancePrincipleAcceptance) => { expiredClosed = a; } };
}
const accepter = user("rm", ["governanceprinciple.accept", "governanceprinciple.acceptance.revoke", "governancehealth.read"]);
const NOW = new Date("2026-06-01T10:00:00.000Z");
const input = (expiresAt: Date) => ({ principleId: "GOV-SOD-01", reason: "temporaire", expiresAt });

describe("QA-suites q169 maximum duration of an acceptance", () => {
  afterEach(() => vi.useRealTimers());

  it("exact limit accepted, limit + 1 ms refused, limit - 1 ms accepted (frozen clock)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const max of [1, 30, 3650]) {
      const w = acceptanceWorld(max);
      await expect(w.service.accept(accepter, input(new Date(NOW.getTime() + max * DAY - 1)), "r")).resolves.toMatchObject({ status: "ACTIVE" });
      await expect(w.service.accept(accepter, input(new Date(NOW.getTime() + max * DAY)), "r")).resolves.toMatchObject({ status: "ACTIVE" });
      const refused = acceptanceWorld(max);
      await expect(refused.service.accept(accepter, input(new Date(NOW.getTime() + max * DAY + 1)), "r")).rejects.toThrow(new RegExp(`at most ${max} days`));
      expect(refused.rows.size).toBe(0);
      expect(refused.audits).toHaveLength(0);
    }
  });

  it("no setting (null row, null value, repo not wired): no bound at all, even 10 years", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const far = new Date(NOW.getTime() + 3650 * DAY);
    for (const cfg of [null, "unwired"] as const) {
      await expect(acceptanceWorld(cfg).service.accept(accepter, input(far), "r")).resolves.toMatchObject({ status: "ACTIVE" });
    }
  });

  it("a date in the past is still refused first with the 'future' message, whatever the setting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await expect(acceptanceWorld(30).service.accept(accepter, input(new Date(NOW.getTime() - 1)), "r")).rejects.toThrow(/in the future/);
    await expect(acceptanceWorld(30).service.accept(accepter, input(new Date("garbage")), "r")).rejects.toThrow(/in the future/);
  });

  it("the setting is read for the ACTOR's tenant, and a failing read stops the acceptance (no row, no audit)", async () => {
    const seen: string[] = [];
    await acceptanceWorld(30, { tenantSeen: seen }).service.accept(user("rm", ["governanceprinciple.accept"], T2), input(new Date(Date.now() + DAY)), "r");
    expect(seen).toEqual([T2]);
    const w = acceptanceWorld(30);
    const broken = new GovernancePrincipleAcceptanceService({ create: async () => { throw new Error("must not be reached"); } } as never, { record: async () => undefined } as never, { existsOther: async () => false }, undefined, {
      getByTenant: async () => { throw new Error("db down"); },
    });
    await expect(broken.accept(accepter, input(new Date(Date.now() + DAY)), "r")).rejects.toThrow("db down");
    expect(w.rows.size).toBe(0);
  });

  it("a stricter setting does not touch existing acceptances: confirm / revoke still work on a long one", async () => {
    const w = acceptanceWorld(null);
    const long = await w.service.accept(accepter, input(new Date(Date.now() + 400 * DAY)), "r");
    const strict = new GovernancePrincipleAcceptanceService({ getById: async (_t: string, id: string) => w.rows.get(id) ?? null, end: async (_t: string, id: string, to: string, by: string, why: string, audit: (a: unknown) => unknown[]) => { const a = { ...w.rows.get(id)!, status: to, endedBy: by, endReason: why }; w.rows.set(id, a as never); audit(a); return a; } } as never, { record: async () => undefined } as never, { existsOther: async () => false }, undefined, { getByTenant: async () => ({ acceptanceMaxDays: 30 }) as never });
    await expect(strict.revoke(accepter, long.id, "fin", "r")).resolves.toMatchObject({ status: "REVOKED" });
  });

  it("HTTP: POST over the limit = 400 with the days in the message; at the limit = 201", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const w = acceptanceWorld(30);
    const mount = (a: express.Express) => a.use("/acc", governancePrincipleAcceptancesRouter(w.service));
    const over = await http(mount, accepter, "POST", "/acc", { principleId: "GOV-SOD-01", reason: "r", expiresAt: new Date(NOW.getTime() + 31 * DAY).toISOString() });
    expect(over.status).toBe(400);
    expect(over.json.error).toMatch(/at most 30 days/);
    const at = await http(mount, accepter, "POST", "/acc", { principleId: "GOV-SOD-01", reason: "r", expiresAt: new Date(NOW.getTime() + 30 * DAY).toISOString() });
    expect(at.status).toBe(201);
  });
});

// -- q170 ------------------------------------------------------------------------------------------------------------
const auditRow = (over: Partial<GovernanceAuditRow>): GovernanceAuditRow => ({
  id: "row1", userId: "actor", entityType: "GovernancePrincipleAcceptance", entityId: "ac1", action: "CLOSE", governanceException: null, oldValue: null, newValue: null, systemGroup: null, ...over,
});
function notifier(rows: GovernanceAuditRow[], opts: { failFor?: string } = {}) {
  const sent: Array<{ to: string; type: string; resourceId: string | null | undefined; message: string; skipIfUnread: boolean | undefined; triggeredBy: string | undefined }> = [];
  const source: GovernanceEventSource = {
    rowsForRequest: async () => rows,
    holdersOf: async () => [],
    groupMembers: async () => [],
    managerId: async () => null,
    unreviewedExceptionCount: async () => 0,
  };
  const n = new GovernanceNotifier(
    {
      emit: async (i) => {
        if (i.recipientUserId === opts.failFor) throw new Error("recipient gone");
        sent.push({ to: i.recipientUserId, type: i.eventType, resourceId: i.resourceId, message: i.message, skipIfUnread: i.skipIfUnread, triggeredBy: i.triggeredBy });
        return null;
      },
    },
    source,
    () => undefined,
  );
  return { run: () => n.processRequest(T, "actor", "req"), sent };
}
const revokeRow = (over: Partial<GovernanceAuditRow> = {}) =>
  auditRow({ oldValue: { status: "ACTIVE", acceptedBy: "rmx" }, newValue: { status: "REVOKED", acceptedBy: "rmx" }, ...over });

describe("QA-suites q170 PRINCIPLE_ACCEPTANCE_REVOKED", () => {
  it("catalog: mandatory, MANAGEMENT, so it cannot be unsubscribed from", () => {
    const e = NOTIFICATION_CATALOG.find((x) => x.eventType === "PRINCIPLE_ACCEPTANCE_REVOKED");
    expect(e).toMatchObject({ resourceType: "MANAGEMENT", mandatory: true });
    expect(NOTIFICATION_CATALOG.filter((x) => x.eventType === "PRINCIPLE_ACCEPTANCE_REVOKED")).toHaveLength(1);
  });

  it("someone else ends an ACTIVE or a PENDING acceptance: the acceptor is told once, deduplicated, no name in the message", async () => {
    for (const previous of ["ACTIVE", "PENDING"]) {
      const n = notifier([revokeRow({ oldValue: { status: previous, acceptedBy: "rmx" } })]);
      await n.run();
      expect(n.sent).toHaveLength(1);
      expect(n.sent[0]).toMatchObject({ to: "rmx", type: "PRINCIPLE_ACCEPTANCE_REVOKED", resourceId: "ac1", skipIfUnread: true, triggeredBy: "actor" });
      expect(n.sent[0]!.message).not.toMatch(/actor|rmx/);
    }
  });

  it("NOT sent to the author of the revocation (acceptor revokes their own acceptance)", async () => {
    const n = notifier([revokeRow({ userId: "actor", oldValue: { status: "ACTIVE", acceptedBy: "actor" }, newValue: { status: "REVOKED", acceptedBy: "actor" } })]);
    await n.run();
    expect(n.sent).toEqual([]);
  });

  it("not sent for: REJECTED, an already ended acceptance, expiry close, CREATE/APPROVE, other entity, missing / non-string acceptor", async () => {
    const cases: GovernanceAuditRow[] = [
      revokeRow({ newValue: { status: "REJECTED", acceptedBy: "rmx" } }),
      revokeRow({ oldValue: { status: "REVOKED", acceptedBy: "rmx" } }),
      revokeRow({ oldValue: { status: "EXPIRED", acceptedBy: "rmx" } }),
      revokeRow({ oldValue: { previousStatus: "ACTIVE", expiresAt: "2026-01-01" } }),
      revokeRow({ action: "CREATE" }),
      revokeRow({ action: "APPROVE" }),
      revokeRow({ entityType: "GovernanceExceptionReview" }),
      revokeRow({ newValue: { status: "REVOKED" } }),
      revokeRow({ newValue: { status: "REVOKED", acceptedBy: 42 } }),
      revokeRow({ newValue: { status: "REVOKED", acceptedBy: null } }),
      revokeRow({ oldValue: null }),
      revokeRow({ newValue: null }),
    ];
    for (const [i, c] of cases.entries()) {
      const n = notifier([c]);
      await n.run();
      expect(n.sent, `case ${i}`).toEqual([]);
    }
  });

  it("a failing emit for the acceptor does not throw nor stop the other rows of the request", async () => {
    const n = notifier([revokeRow({ id: "r1" }), revokeRow({ id: "r2", entityId: "ac2", oldValue: { status: "ACTIVE", acceptedBy: "other" }, newValue: { status: "REVOKED", acceptedBy: "other" } })], { failFor: "rmx" });
    await expect(n.run()).resolves.toBeUndefined();
    expect(n.sent.map((s) => s.to)).toEqual(["other"]);
  });

  it("end to end with the REAL service rows: revoke by another person -> acceptor told; own revoke -> nobody; expiry close of a new acceptance -> nobody", async () => {
    const w = acceptanceWorld(null);
    const a = await w.service.accept(accepter, input(new Date(Date.now() + DAY)), "r1"); // acceptor "rm"
    const revoker = user("aud", ["governanceprinciple.acceptance.revoke"]);
    await w.service.revoke(revoker, a.id, "Fin anticipée", "r2");
    const closeRow = w.audits.at(-1)!;
    expect(closeRow).toMatchObject({ action: "CLOSE", userId: "aud" });
    const toNotifierRow = (e: Omit<AuditEvent, "id" | "timestamp">, userId = e.userId): GovernanceAuditRow =>
      auditRow({ userId, entityId: e.entityId, action: e.action, oldValue: e.oldValue, newValue: e.newValue, governanceException: null });
    const n = new GovernanceNotifier(
      { emit: async (i) => { sent.push(`${i.recipientUserId}:${i.eventType}`); return null; } },
      { rowsForRequest: async () => [toNotifierRow(closeRow)], holdersOf: async () => [], groupMembers: async () => [], managerId: async () => null, unreviewedExceptionCount: async () => 0 },
      () => undefined,
    );
    const sent: string[] = [];
    await n.processRequest(T, "aud", "r2");
    expect(sent).toEqual(["rm:PRINCIPLE_ACCEPTANCE_REVOKED"]);

    // the acceptor revokes their own acceptance
    const own = acceptanceWorld(null);
    const b = await own.service.accept(accepter, input(new Date(Date.now() + DAY)), "r3");
    await own.service.revoke(accepter, b.id, "Fin", "r4");
    const sentOwn: string[] = [];
    await new GovernanceNotifier(
      { emit: async (i) => { sentOwn.push(i.recipientUserId); return null; } },
      { rowsForRequest: async () => [toNotifierRow(own.audits.at(-1)!)], holdersOf: async () => [], groupMembers: async () => [], managerId: async () => null, unreviewedExceptionCount: async () => 0 },
      () => undefined,
    ).processRequest(T, "rm", "r4");
    expect(sentOwn).toEqual([]);

    // a new acceptance closes an expired one (real service path): that CLOSE row must not notify
    const exp = acceptanceWorld(null);
    exp.setExpiredClosed({ id: "old", tenantId: T, principleId: "GOV-SOD-01", status: "REVOKED", regime: "ALONE", acceptedBy: "rm0", expiresAt: new Date(Date.now() - DAY) } as GovernancePrincipleAcceptance);
    await exp.service.accept(accepter, input(new Date(Date.now() + DAY)), "r5");
    const expiryClose = exp.audits.find((e) => e.action === "CLOSE")!;
    expect(expiryClose).toBeDefined();
    const sentExp: string[] = [];
    await new GovernanceNotifier(
      { emit: async (i) => { sentExp.push(i.recipientUserId); return null; } },
      { rowsForRequest: async () => [toNotifierRow(expiryClose)], holdersOf: async () => [], groupMembers: async () => [], managerId: async () => null, unreviewedExceptionCount: async () => 0 },
      () => undefined,
    ).processRequest(T, "rm", "r5");
    expect(sentExp).toEqual([]);
  });
});

// -- migration 075 (static) ------------------------------------------------------------------------------------------
const MIG = join(__dirname, "..", "..", "database", "postgresql", "migrations");
const UP = readFileSync(join(MIG, "075_governance_delays.sql"), "utf8");
const DOWN = readFileSync(join(MIG, "075_governance_delays.down.sql"), "utf8");
const code = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const listsIn = (sql: string): string[][] =>
  [...code(sql).matchAll(/&&\s*ARRAY\[([^\]]*)\]/g)].map((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));

describe("QA-suites migration 075 (static)", () => {
  it("the catch-up lists (roles AND users) are exactly ADMIN_PERMISSIONS minus the new key, same order irrelevant", () => {
    const expected = ADMIN_PERMISSIONS.filter((p) => p !== NEW_PERM).sort();
    const lists = listsIn(UP);
    expect(lists).toHaveLength(2);
    for (const l of lists) expect([...l].sort()).toEqual(expected);
  });

  it("adds three nullable integer columns with CHECK 1..3650 and NO default (never invent a delay)", () => {
    const sql = code(UP);
    for (const c of ["exception_review_delay_days", "acceptance_max_days", "policy_request_expiry_days"]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN ${c} integer CHECK \\(${c} BETWEEN 1 AND 3650\\)`));
    }
    expect(sql).not.toMatch(/\bDEFAULT\b/i);
    expect(sql).not.toMatch(/NOT NULL/i);
  });

  it("adds requests.expires_at (nullable timestamptz, no default) and the down drops it before the configs columns", () => {
    expect(code(UP)).toMatch(/ALTER TABLE self_validation_policy_requests ADD COLUMN expires_at timestamptz;/);
    expect(code(DOWN)).toMatch(/ALTER TABLE self_validation_policy_requests DROP COLUMN IF EXISTS expires_at;/);
  });

  it("no physical DELETE / TRUNCATE / DROP in the up; the down deletes only its own tracker row", () => {
    const up = code(UP);
    expect(up).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(up).not.toMatch(/^\s*TRUNCATE\b/im);
    expect(up).not.toMatch(/\bDROP\b/i);
    expect(code(DOWN).match(/\bDELETE\s+FROM\s+\w+[^;]*;/gi)).toEqual(["DELETE FROM schema_migrations WHERE filename = '075_governance_delays.sql';"]);
  });

  it("the role catch-up skips system groups and soft-deleted roles, and de-duplicates", () => {
    const roleUpdate = code(UP).match(/UPDATE roles[\s\S]*?;/)![0];
    expect(roleUpdate).toMatch(/system_group IS NULL/);
    expect(roleUpdate).toMatch(/deleted_at IS NULL/);
    expect(roleUpdate).toMatch(/DISTINCT/);
  });

  it("the down is atomic (BEGIN/COMMIT), strips the key from roles AND users, drops the 3 columns", () => {
    const sql = code(DOWN);
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/COMMIT;/);
    expect(sql).toMatch(/UPDATE users SET roles = array_remove/);
    expect(sql).toMatch(/UPDATE roles SET permissions = array_remove/);
    for (const c of ["exception_review_delay_days", "acceptance_max_days", "policy_request_expiry_days"]) expect(sql).toContain(`DROP COLUMN IF EXISTS ${c}`);
  });
});

// -- migration 075 on a REAL PostgreSQL (socket, never Neon) ---------------------------------------------------------
const HOST = process.env.QA_SUITES_PGHOST ?? "";
const DB = process.env.QA_SUITES_PGDB ?? "qa_suites";
const live = HOST.startsWith("/") && /^qa_suites/.test(DB);

describe.skipIf(!live)("QA-suites migration 075 on real PostgreSQL (QA_SUITES_PGHOST = unix socket dir, db qa_suites*)", () => {
  let pool: Pool;
  const q = <R = Record<string, unknown>>(sql: string, params: unknown[] = []) => pool.query(sql, params).then((r) => r.rows as R[]);
  const cols = async () => (await q<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'configs' AND column_name IN ('exception_review_delay_days','acceptance_max_days','policy_request_expiry_days') ORDER BY 1")).map((r) => r.column_name);
  const runUp = () => pool.query(UP);
  const runDown = () => pool.query(DOWN);
  const T_A = "aaaaaaaa-0000-4000-8000-00000000000a";
  const ids = { admin: "", plain: "", sys: "", deleted: "", userAdmin: "", userPlain: "" };

  // Disposable database only: requests are never deleted by the app (guard), so the cleanup bypasses triggers for this session.
  const cleanup = async () => {
    const c = await pool.connect();
    try {
      await c.query("SET session_replication_role = replica");
      for (const t of ["self_validation_policy_requests", "users", "roles", "configs"]) await c.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [T_A]);
      await c.query("DELETE FROM tenants WHERE id = $1", [T_A]);
    } finally {
      c.release(true);
    }
  };
  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SUITES_PGPORT ?? 55433), user: "postgres", database: DB });
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    if ((await cols()).length !== 3) await runUp(); // leave the database as found
    await pool.end();
  });

  it("down removes the columns and the key (roles + users); a second down on the already-down schema (replay)", async () => {
    expect(await cols()).toHaveLength(3);
    await pool.query("INSERT INTO tenants (id, name) VALUES ($1, 'qa-suites')", [T_A]);
    const role = async (name: string, perms: string[], extra = "") =>
      (await q<{ id: string }>(`INSERT INTO roles (tenant_id, name, permissions${extra ? ", " + extra.split("=")[0] : ""}) VALUES ($1, $2, $3${extra ? ", " + extra.split("=")[1] : ""}) RETURNING id`, [T_A, name, perms]))[0]!.id;
    ids.admin = await role("admin", ["config.manage", "risk.read"]);
    ids.plain = await role("plain", ["risk.read", "config.read"]);
    const hasSys = (await q("SELECT 1 FROM information_schema.columns WHERE table_name='roles' AND column_name='system_group'")).length > 0;
    const hasDel = (await q("SELECT 1 FROM information_schema.columns WHERE table_name='roles' AND column_name='deleted_at'")).length > 0;
    expect(hasSys && hasDel).toBe(true);
    ids.sys = await role("sys-admin-like", ["role.update"], "system_group='RISK_COMMITTEE'");
    ids.deleted = await role("deleted-admin", ["role.update"], "deleted_at=now()");
    const mkUser = async (email: string, roles: string[]) => (await q<{ id: string }>("INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1, $2, $2, $3) RETURNING id", [T_A, email, roles]))[0]!.id;
    ids.userAdmin = await mkUser("adm@qa-suites.test", ["user.create", "risk.read"]);
    ids.userPlain = await mkUser("plain@qa-suites.test", ["risk.read"]);
    // a holder of the new key before the down (as after a normal run of the app)
    await pool.query("UPDATE roles SET permissions = permissions || ARRAY['config.governancedelays.set']::text[] WHERE id = $1", [ids.plain]);
    await pool.query("UPDATE users SET roles = roles || ARRAY['config.governancedelays.set']::text[] WHERE id = $1", [ids.userPlain]);

    await runDown();
    expect(await cols()).toEqual([]);
    expect(await q("SELECT 1 FROM roles WHERE 'config.governancedelays.set' = ANY(permissions)")).toHaveLength(0);
    expect(await q("SELECT 1 FROM users WHERE 'config.governancedelays.set' = ANY(roles)")).toHaveLength(0);
    // other permissions are untouched
    expect((await q<{ permissions: string[] }>("SELECT permissions FROM roles WHERE id = $1", [ids.plain]))[0]!.permissions).toEqual(["risk.read", "config.read"]);
  });

  it("up on the seeded schema: administrators get the key, others do not, system / soft-deleted roles skipped, no duplicates", async () => {
    await runUp();
    expect(await cols()).toEqual(["acceptance_max_days", "exception_review_delay_days", "policy_request_expiry_days"]);
    const perms = async (id: string) => (await q<{ permissions: string[] }>("SELECT permissions FROM roles WHERE id = $1", [id]))[0]!.permissions;
    expect(await perms(ids.admin)).toContain(NEW_PERM);
    expect(await perms(ids.plain)).not.toContain(NEW_PERM);
    expect(await perms(ids.sys)).not.toContain(NEW_PERM);
    expect(await perms(ids.deleted)).not.toContain(NEW_PERM);
    const ur = async (id: string) => (await q<{ roles: string[] }>("SELECT roles FROM users WHERE id = $1", [id]))[0]!.roles;
    expect(await ur(ids.userAdmin)).toContain(NEW_PERM);
    expect(await ur(ids.userPlain)).not.toContain(NEW_PERM);
    expect((await ur(ids.userAdmin)).filter((p) => p === NEW_PERM)).toHaveLength(1);
    // consistency with the code: every role granted by the catch-up holds at least one ADMIN permission
    const granted = await q<{ permissions: string[] }>("SELECT permissions FROM roles WHERE tenant_id = $1 AND $2 = ANY(permissions)", [T_A, NEW_PERM]);
    for (const g of granted) expect(g.permissions.some((p) => p !== NEW_PERM && ADMIN_PERMISSIONS.includes(p as never))).toBe(true);
  });

  it("CHECK 1..3650: 0, -1, 3651 rejected on each column; 1, 3650 and NULL accepted; the default is NULL", async () => {
    await pool.query("INSERT INTO configs (tenant_id) VALUES ($1)", [T_A]);
    const row = (await q<Record<string, unknown>>("SELECT * FROM configs WHERE tenant_id = $1", [T_A]))[0]!;
    expect([row["exception_review_delay_days"], row["acceptance_max_days"], row["policy_request_expiry_days"]]).toEqual([null, null, null]);
    for (const c of ["exception_review_delay_days", "acceptance_max_days", "policy_request_expiry_days"]) {
      for (const bad of [0, -1, 3651]) await expect(pool.query(`UPDATE configs SET ${c} = $2 WHERE tenant_id = $1`, [T_A, bad]), `${c}=${bad}`).rejects.toMatchObject({ code: "23514" });
      for (const ok of [1, 3650, null]) await expect(pool.query(`UPDATE configs SET ${c} = $2 WHERE tenant_id = $1`, [T_A, ok])).resolves.toBeDefined();
    }
  });

  it("up -> down -> up round trip is clean (idempotence of the pair)", async () => {
    await runDown();
    expect(await cols()).toEqual([]);
    await runUp();
    expect(await cols()).toHaveLength(3);
    const dup = await q<{ n: number }>("SELECT count(*)::int n FROM users WHERE id = $1 AND roles @> ARRAY[$2]::text[]", [ids.userAdmin, NEW_PERM]);
    expect(dup[0]!.n).toBe(1);
  });

  // QA-SUITES-02 (fixed): the down is replayable (DROP COLUMN IF EXISTS), like 066-073.
  it("replaying the DOWN on an already-down schema changes nothing (no error)", async () => {
    await runDown();
    try {
      await expect(runDown()).resolves.not.toThrow();
    } finally {
      await runUp();
    }
  });

  it("requests.expires_at: stored at insert, NULL by default, read back as given", async () => {
    const at = new Date("2030-01-01T00:00:00Z");
    const ins = (exp: Date | null) => q<{ id: string; expires_at: Date | null }>(
      "INSERT INTO self_validation_policy_requests (tenant_id, requested_policy, reason, requested_by, expires_at) VALUES ($1, 'DOUBLE_CONFIRMATION', 'qa', $2, $3) RETURNING id, expires_at",
      [T_A, ids.userAdmin, exp],
    );
    const a = (await ins(at))[0]!;
    expect(a.expires_at!.toISOString()).toBe(at.toISOString());
    await pool.query("UPDATE self_validation_policy_requests SET status='WITHDRAWN', decided_by=$2, decided_at=now() WHERE id=$1", [a.id, ids.userAdmin]);
    const b = (await ins(null))[0]!;
    expect(b.expires_at).toBeNull();
    await pool.query("UPDATE self_validation_policy_requests SET status='WITHDRAWN', decided_by=$2, decided_at=now() WHERE id=$1", [b.id, ids.userAdmin]);
  });

  // The guard (073) refuses ANY update that leaves a request PENDING, so the frozen expiry cannot be rewritten in place.
  it("the frozen expiry of a PENDING request cannot be rewritten by an UPDATE (guard 42501)", async () => {
    const r = (await q<{ id: string }>(
      "INSERT INTO self_validation_policy_requests (tenant_id, requested_policy, reason, requested_by, expires_at) VALUES ($1, 'DOUBLE_CONFIRMATION', 'qa', $2, now() - interval '1 day') RETURNING id",
      [T_A, ids.userAdmin],
    ))[0]!;
    try {
      await expect(pool.query("UPDATE self_validation_policy_requests SET expires_at = now() + interval '3650 days' WHERE id = $1", [r.id])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await pool.query("UPDATE self_validation_policy_requests SET status='WITHDRAWN', decided_by=$2, decided_at=now() WHERE id=$1", [r.id, ids.userPlain]);
    }
  });

  it("the down never touches a business row other than the permission arrays (config row survives with its values)", async () => {
    await pool.query("UPDATE configs SET committee_evaluation_min_score = 17 WHERE tenant_id = $1", [T_A]);
    await runDown();
    await runUp();
    const r = await q<{ committee_evaluation_min_score: number }>("SELECT committee_evaluation_min_score FROM configs WHERE tenant_id = $1", [T_A]);
    expect(r[0]!.committee_evaluation_min_score).toBe(17);
  });
});
