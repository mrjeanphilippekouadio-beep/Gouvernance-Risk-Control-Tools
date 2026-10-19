import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { optionalComment, reasonText } from "../src/api/validation.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { governanceNotificationsMiddleware } from "../src/api/middleware/governanceNotifications.js";
import { GovernanceNotifier } from "../src/services/GovernanceNotifier.js";
import { createLastSeenRecorder } from "../src/infrastructure/identity/lastSeen.js";
import { configRouter } from "../src/api/v1/config.routes.js";
import { controlsRouter } from "../src/api/v1/controls.routes.js";
import { departmentsRouter } from "../src/api/v1/departments.routes.js";
import { kpisRouter } from "../src/api/v1/kpis.routes.js";
import { krisRouter } from "../src/api/v1/kris.routes.js";
import { moduleTogglesRouter } from "../src/api/v1/moduleToggles.routes.js";
import { processesRouter } from "../src/api/v1/processes.routes.js";
import { processEvaluationModeRequestsRouter } from "../src/api/v1/processEvaluationModeRequests.routes.js";
import { ratingScalesRouter } from "../src/api/v1/ratingScales.routes.js";
import { riskAppetiteRouter } from "../src/api/v1/riskAppetite.routes.js";
import { riskFrameworksRouter } from "../src/api/v1/riskFrameworks.routes.js";
import { risksRouter } from "../src/api/v1/risks.routes.js";

/**
 * QA-retest2 (A08, 2026-10-19): level 2 review of the retest fix lot (d99e281) and of the F3 frontend lot (eeec6b0).
 * Oracles written before running. The PG part is skipped unless QA_SWP_PGHOST starts with "/" (local socket, database
 * grc_qa_a08, never Neon). A defect still present is pinned with `it.fails`: remove `.fails` when it is fixed.
 */

const NL = "Première ligne du motif\nDeuxième ligne du motif";
const ID = randomUUID();
const ID2 = randomUUID();

/** A service stand-in whose every method succeeds with `{}`: only the HTTP contract (zod bodies) is exercised. */
const stub = new Proxy({}, { get: () => async () => ({}) }) as never;

const user = { userId: "u-1", tenantId: "t-1", email: "a@x.test", roles: [] };

async function call(mount: (app: express.Express) => void, method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = user;
    (req as unknown as { requestId: string }).requestId = "req";
    next();
  });
  mount(app);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  } finally {
    server.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// R2-1: a reason typed in a <textarea> (the screens use <textarea rows=3|4> for every reason) contains a line break.
// Oracle: before the lot every one of these routes accepted it (z.string().min(1) / .trim().min(1).max(500)).
// ---------------------------------------------------------------------------------------------------------------------
type Case = { label: string; mount: (app: express.Express) => void; method: string; path: string; body: Record<string, unknown> };
const mountAt = (prefix: string, router: express.Router) => (app: express.Express) => void app.use(prefix, router);
const cases: Case[] = [
  { label: "controls archive", mount: mountAt("/c", controlsRouter(stub, stub)), method: "POST", path: `/c/${ID}/archive`, body: { reason: NL } },
  { label: "departments archive", mount: mountAt("/c", departmentsRouter(stub)), method: "POST", path: `/c/${ID}/archive`, body: { reason: NL } },
  { label: "processes archive", mount: mountAt("/c", processesRouter(stub)), method: "POST", path: `/c/${ID}/archive`, body: { reason: NL } },
  { label: "kpis archive", mount: mountAt("/c", kpisRouter(stub)), method: "POST", path: `/c/${ID}/archive`, body: { reason: NL } },
  { label: "kris disable", mount: mountAt("/c", krisRouter(stub)), method: "PATCH", path: `/c/${ID}/disable`, body: { reason: NL } },
  { label: "rating scales disable", mount: mountAt("/c", ratingScalesRouter(stub)), method: "PATCH", path: `/c/${ID}/disable`, body: { reason: NL } },
  { label: "risk appetite archive", mount: mountAt("/c", riskAppetiteRouter(stub)), method: "POST", path: `/c/${ID}/archive`, body: { reason: NL } },
  { label: "risks archive", mount: mountAt("/c", risksRouter(stub, stub, stub)), method: "POST", path: `/c/${ID}/archive`, body: { reason: NL } },
  { label: "module toggle", mount: mountAt("/c", moduleTogglesRouter(stub)), method: "PATCH", path: "/c/DASHBOARD/toggle", body: { enabled: false, reason: NL } },
  { label: "Dispositif: discard draft", mount: mountAt("/c", riskFrameworksRouter(stub)), method: "POST", path: `/c/${ID}/versions/${ID2}/discard`, body: { reason: NL } },
  { label: "Dispositif: request activation", mount: mountAt("/c", riskFrameworksRouter(stub)), method: "POST", path: `/c/${ID}/versions/${ID2}/activation-requests`, body: { reason: NL } },
  { label: "config: evaluation mode", mount: mountAt("/c", configRouter(stub)), method: "PUT", path: "/c/evaluation-mode", body: { mode: "CLASSIQUE", reason: NL } },
  { label: "config: committee thresholds", mount: mountAt("/c", configRouter(stub)), method: "PUT", path: "/c/committee-thresholds", body: { evaluationMinScore: 10, reason: NL } },
  { label: "config: committee enforcement", mount: mountAt("/c", configRouter(stub)), method: "PUT", path: "/c/committee-enforcement", body: { enforced: true, reason: NL } },
  { label: "config: committee/audit cumul", mount: mountAt("/c", configRouter(stub)), method: "PUT", path: "/c/committee-audit-cumul", body: { allowed: true, reason: NL } },
  { label: "config: self-validation policy", mount: mountAt("/c", configRouter(stub)), method: "PUT", path: "/c/self-validation-policy", body: { policy: "REFUSE", reason: NL } },
  { label: "config: reject policy request", mount: mountAt("/c", configRouter(stub)), method: "POST", path: `/c/self-validation-policy/requests/${ID}/reject`, body: { reason: NL } },
  { label: "config: approve policy request", mount: mountAt("/c", configRouter(stub)), method: "POST", path: `/c/self-validation-policy/requests/${ID}/approve`, body: { reason: NL } },
  { label: "evaluation-mode request: reject", mount: mountAt("/c", processEvaluationModeRequestsRouter(stub)), method: "POST", path: `/c/${ID}/reject`, body: { reason: NL } },
  // Control group: the same lot made these multi-line on purpose; they must keep accepting a line break.
  { label: "CONTROL Dispositif: withdraw (Comment, multiline)", mount: mountAt("/c", riskFrameworksRouter(stub)), method: "POST", path: `/c/change-requests/${ID}/withdraw`, body: { reason: NL } },
  { label: "CONTROL Dispositif: reject (Comment, multiline)", mount: mountAt("/c", riskFrameworksRouter(stub)), method: "POST", path: `/c/change-requests/${ID}/reject`, body: { comment: NL } },
];
// Filled after the first run: the routes that answer 400 on a two-line reason are the defect F-PNL3-02.
const KNOWN_SINGLE_LINE = new Set(cases.filter((c) => !c.label.startsWith("CONTROL")).map((c) => c.label));

describe("R2-1 (F-PNL3-02): a two-line reason typed in a textarea", () => {
  for (const c of cases) {
    const run = async () => {
      const res = await call(c.mount, c.method, c.path, c.body);
      expect(res.status, JSON.stringify(res.json)).toBeLessThan(400);
    };
    if (KNOWN_SINGLE_LINE.has(c.label)) it.fails(`KNOWN DEFECT F-PNL3-02 ${c.label}: accepted (answers 400 today)`, run);
    else it(`${c.label}: accepted`, run);
  }

  it("harness validity: with a single-line reason every one of these routes is mounted and answers < 400 (so the 400 above is the reason rule, not a 404)", async () => {
    for (const c of cases) {
      const body = Object.fromEntries(Object.entries(c.body).map(([k, v]) => [k, v === NL ? "motif sur une ligne" : v]));
      const res = await call(c.mount, c.method, c.path, body);
      expect(res.status, `${c.label}: ${JSON.stringify(res.json)}`).toBeLessThan(400);
    }
  });

  it("each refusal above is a 400 (not a 404 or 500)", async () => {
    for (const c of cases.filter((x) => KNOWN_SINGLE_LINE.has(x.label))) expect((await call(c.mount, c.method, c.path, c.body)).status, c.label).toBe(400);
  });

  it("the refusal carries no hint at all: the error handler answers the generic 'Requête invalide.' (the screen cannot tell the user what to fix)", async () => {
    const res = await call(cases[0]!.mount, cases[0]!.method, cases[0]!.path, cases[0]!.body);
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: "Requête invalide." });
    expect(JSON.stringify(res.json)).not.toMatch(/Motif|reason|ligne|line/i);
  });

  it("a single-line reason, and a 2000-character reason, still pass on an archive route; 2001 is refused", async () => {
    const mount = cases[0]!.mount;
    expect((await call(mount, "POST", cases[0]!.path, { reason: "motif simple" })).status).toBeLessThan(400);
    expect((await call(mount, "POST", cases[0]!.path, { reason: "x".repeat(2000) })).status).toBeLessThan(400);
    expect((await call(mount, "POST", cases[0]!.path, { reason: "x".repeat(2001) })).status).toBe(400);
  });
});

describe("R2-1b: reasonText / optionalComment on real-world text", () => {
  it("accepts accents, emoji (valid surrogate pair), quotes and a CRLF / tab in multiline mode; refuses a lone surrogate, NUL, VT, U+0085", () => {
    const ml = reasonText(2000, true);
    for (const ok of ["Éléments reçus à l'équipe « Risques »", "validé 🙂", "a\r\nb\tc", "日本語のモチーフ"]) expect(ml.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["a\ud83dz", "a\u0000b", "a\u000bb", "a\u0085b", "\u200b\u200b"]) expect(ml.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it("the single-line variant refuses a lone CR, LF and TAB (the F-PNL3-02 cause); max is counted after trim", () => {
    const one = reasonText(10);
    for (const bad of ["a\nb", "a\rb", "a\tb"]) expect(one.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(one.safeParse("  " + "x".repeat(10) + "  ").success).toBe(true);
    expect(one.safeParse("x".repeat(11)).success).toBe(false);
  });
  it("optionalComment: 2000 accepted, 2001 refused, null / undefined / '' / spaces accepted, NUL refused", () => {
    expect(optionalComment.safeParse("x".repeat(2000)).success).toBe(true);
    expect(optionalComment.safeParse("x".repeat(2001)).success).toBe(false);
    for (const ok of [null, undefined, "", "   "]) expect(optionalComment.safeParse(ok).success, String(ok)).toBe(true);
    expect(optionalComment.safeParse("a\u0000b").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R2-2 (F-PNL3-01): the F3 screen approves a policy request with an empty body; the backend now requires { reason }.
// ---------------------------------------------------------------------------------------------------------------------
describe("R2-2 (F-PNL3-01): approve a self-validation policy request as the F3 screen calls it", () => {
  const frontendConfigApi = readFileSync(join(__dirname, "..", "..", "frontend", "src", "api", "config.ts"), "utf8");
  const approvePath = `/c/self-validation-policy/requests/${ID}/approve`;

  it("backend: an approval without the approver's own reason is refused 400; with a reason, 200", async () => {
    const mount = mountAt("/c", configRouter(stub));
    expect((await call(mount, "POST", approvePath, {})).status).toBe(400);
    expect((await call(mount, "POST", approvePath, { reason: "ok" })).status).toBe(200);
    expect((await call(mount, "POST", approvePath, { reason: "   " })).status).toBe(400);
  });

  it.fails("KNOWN DEFECT F-PNL3-01: the frontend client sends a body carrying the approver's reason", () => {
    const approve = /approvePolicyRequest:[\s\S]*?token\s*\}\)/.exec(frontendConfigApi)?.[0] ?? "";
    expect(approve).toMatch(/approve/);
    expect(approve).toMatch(/body:\s*\{[^}]*reason/);
  });

  it("(observation) the page shows no field for it: GovernanceSettingsPage has a reason textarea only for edit and reject", () => {
    const page = readFileSync(join(__dirname, "..", "..", "frontend", "src", "features", "governance", "GovernanceSettingsPage.tsx"), "utf8");
    expect(page).toMatch(/approvePolicyRequest\(token, pending\.id\)/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R2-3: other contract changes of the lot against the existing screens.
// ---------------------------------------------------------------------------------------------------------------------
describe("R2-3: Dispositif approve / withdraw comments (Comment = reasonText(1000, true), was z.string().trim().max(1000))", () => {
  const mount = mountAt("/c", riskFrameworksRouter(stub));
  const frontend = readFileSync(join(__dirname, "..", "..", "frontend", "src", "api", "riskFrameworks.ts"), "utf8");

  it("(observation) an empty or blank approve comment is now 400 (was accepted); the screen never sends one", async () => {
    const path = `/c/change-requests/${ID}/approve`;
    expect((await call(mount, "POST", path, {})).status).toBe(200);
    expect((await call(mount, "POST", path, { comment: "" })).status).toBe(400);
    expect((await call(mount, "POST", path, { comment: "   " })).status).toBe(400);
    expect(frontend).toMatch(/body: comment \? \{ comment \} : \{\}/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R2-4: SEC-PNL2-01, the notification fires on res.end. Edge cases A06 did not cover.
// ---------------------------------------------------------------------------------------------------------------------
describe("R2-4: notifications on res.end", () => {
  async function post(handler: express.RequestHandler, setUser = true) {
    const processRequest = vi.fn(async () => undefined);
    const app = express();
    app.use((req, _res, next) => { req.requestId = "rq"; next(); });
    app.use(governanceNotificationsMiddleware({ processRequest }));
    app.post("/x", (req, res, next) => {
      if (setUser) (req as unknown as { user: unknown }).user = { tenantId: "t1", userId: "u1" };
      handler(req, res, next);
    });
    app.use(errorHandler);
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      await res.text();
      await new Promise((r) => setTimeout(r, 30));
      return { status: res.status, calls: processRequest.mock.calls.length };
    } finally { server.close(); }
  }

  it("fires once for 200 json, 201, 202, 204 (sendStatus) and a plain res.send", async () => {
    expect((await post((_q, r) => void r.json({ data: 1 }))).calls).toBe(1);
    expect((await post((_q, r) => void r.status(201).json({}))).calls).toBe(1);
    expect((await post((_q, r) => void r.status(202).json({}))).calls).toBe(1);
    expect((await post((_q, r) => void r.sendStatus(204))).calls).toBe(1);
    expect((await post((_q, r) => void r.send("ok"))).calls).toBe(1);
  });
  it("does not fire for 3xx, a thrown domain error (409/400/500 via the real error handler), or a request without user", async () => {
    expect((await post((_q, r) => void r.redirect("/y"))).calls).toBe(0);
    const { ConflictError, ValidationError } = await import("../src/domain/errors/DomainErrors.js");
    expect(await post((_q, _r, next) => next(new ConflictError("clash")))).toMatchObject({ status: 409, calls: 0 });
    expect(await post((_q, _r, next) => next(new ValidationError("bad")))).toMatchObject({ status: 400, calls: 0 });
    expect(await post((_q, _r, next) => next(new Error("boom")))).toMatchObject({ status: 500, calls: 0 });
    expect((await post((_q, r) => void r.json({}), false)).calls).toBe(0);
  });
  it("a second res.end on the same response does not notify twice", async () => {
    const { calls } = await post((_q, r) => { r.json({}); r.end(); });
    expect(calls).toBe(1);
  });
  it("a notifier whose source throws never changes the 200 nor produces an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const logged: string[] = [];
    const notifier = new GovernanceNotifier({ emit: async () => undefined } as never, { rowsForRequest: async () => { throw new Error("db down"); } } as never, (m) => logged.push(m));
    const app = express();
    app.use((req, _res, next) => { req.requestId = "rq"; next(); });
    app.use(governanceNotificationsMiddleware(notifier));
    app.post("/x", (req, res) => { (req as unknown as { user: unknown }).user = { tenantId: "t1", userId: "u1" }; res.json({ ok: true }); });
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).not.toHaveBeenCalled();
      expect(logged.join(" ")).toMatch(/notifications for request rq failed/);
    } finally { server.close(); process.off("unhandledRejection", unhandled); }
  });
  it("the client closing the socket mid-handler with the REAL notifier: the effect's audit rows are still read (once)", async () => {
    const rowsForRequest = vi.fn(async () => []);
    const notifier = new GovernanceNotifier({ emit: async () => undefined } as never, { rowsForRequest } as never);
    const app = express();
    app.use((req, _res, next) => { req.requestId = "rq-abort"; next(); });
    app.use(governanceNotificationsMiddleware(notifier));
    app.post("/x", async (req, res) => {
      (req as unknown as { user: unknown }).user = { tenantId: "t1", userId: "u1" };
      await new Promise((r) => setTimeout(r, 120));
      res.json({});
    });
    const server = app.listen(0);
    try {
      const ac = new AbortController();
      const p = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, signal: ac.signal }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 30));
      ac.abort();
      await p;
      await new Promise((r) => setTimeout(r, 250));
      expect(rowsForRequest).toHaveBeenCalledTimes(1);
      expect(rowsForRequest).toHaveBeenCalledWith("t1", "rq-abort", "u1");
    } finally { server.close(); }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R2-5: PostgreSQL, migration 074 / lastSeen (I01) and 072 hardened in place.
// ---------------------------------------------------------------------------------------------------------------------
const HOST = process.env.QA_SWP_PGHOST ?? "";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!HOST.startsWith("/"))("R2-5 PostgreSQL (grc_qa_a08, 001..074)", () => {
  let pool: Pool;
  let t1: string;
  let t2: string;
  let a1: string;
  let b1: string;
  let a2: string;
  const one = async <T>(sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0] as T;
  const fails = (sql: string, p: unknown[] = []) => pool.query(sql, p).then(() => null, (e: { code?: string }) => e);
  const row = (id: string) => one<{ last_seen_at: Date | null; last_token_iat: string | null }>(`SELECT last_seen_at, last_token_iat FROM users WHERE id = $1`, [id]);

  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 4, application_name: "qa-retest2" });
    const mk = async (n: string) => (await one<{ id: string }>(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`qa-retest2-${n}-${randomUUID()}`])).id;
    t1 = await mk("1");
    t2 = await mk("2");
    const u = async (t: string) => (await one<{ id: string }>(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $2) RETURNING id`, [t, `q${randomUUID()}@retest2`])).id;
    a1 = await u(t1); b1 = await u(t1); a2 = await u(t2);
  });
  afterAll(async () => { await pool?.end(); });

  it("074: the column exists (bigint, nullable) and a Google token (iat) is written with its user only, scoped by tenant", async () => {
    const col = await one<{ data_type: string; is_nullable: string }>(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_token_iat'`);
    expect(col).toEqual({ data_type: "bigint", is_nullable: "YES" });
    // wrong tenant for the user id: nothing is written
    createLastSeenRecorder(pool)(t2, a1, 111);
    await wait(120);
    expect(await row(a1)).toMatchObject({ last_seen_at: null, last_token_iat: null });
    // right tenant: only this user
    createLastSeenRecorder(pool)(t1, a1, 111);
    await wait(120);
    expect(Number((await row(a1)).last_token_iat)).toBe(111);
    expect(await row(b1)).toMatchObject({ last_seen_at: null, last_token_iat: null });
  });

  it("074: a soft-deleted user is never touched", async () => {
    const d = (await one<{ id: string }>(`INSERT INTO users (tenant_id, email, display_name, deleted_at) VALUES ($1, $2, $2, now()) RETURNING id`, [t1, `d${randomUUID()}@retest2`])).id;
    createLastSeenRecorder(pool)(t1, d, 5);
    await wait(120);
    expect(await row(d)).toMatchObject({ last_seen_at: null, last_token_iat: null });
  });

  it("074: the local provider path (no iat) keeps its one-hour rule and does not touch last_token_iat", async () => {
    const rec = createLastSeenRecorder(pool);
    rec(t1, b1);
    await wait(120);
    const first = await row(b1);
    expect(first.last_seen_at).not.toBeNull();
    expect(first.last_token_iat).toBeNull();
    await pool.query(`UPDATE users SET last_seen_at = now() - interval '30 minutes' WHERE id = $1`, [b1]);
    const before = (await row(b1)).last_seen_at!.getTime();
    createLastSeenRecorder(pool)(t1, b1); // fresh process, < 1 hour: the SQL condition refuses
    await wait(120);
    expect((await row(b1)).last_seen_at!.getTime()).toBe(before);
  });

  it("074 (q175, known and accepted by the PO as open): a renewed Google token within the hour still counts as a login", async () => {
    await pool.query(`UPDATE users SET last_seen_at = now() - interval '5 minutes', last_token_iat = 100 WHERE id = $1`, [a1]);
    const before = (await row(a1)).last_seen_at!.getTime();
    createLastSeenRecorder(pool)(t1, a1, 3700); // silent hourly renewal, 5 minutes after the last "login"
    await wait(120);
    expect((await row(a1)).last_seen_at!.getTime()).toBeGreaterThan(before);
  });

  it("074: two instances racing on the same new iat: one value, no error, the last_seen date set once", async () => {
    await pool.query(`UPDATE users SET last_seen_at = NULL, last_token_iat = NULL WHERE id = $1`, [a2]);
    createLastSeenRecorder(pool)(t2, a2, 9000);
    createLastSeenRecorder(pool)(t2, a2, 9000);
    await wait(200);
    expect(Number((await row(a2)).last_token_iat)).toBe(9000);
  });

  it("072 (in place): the policy-request guard is installed with the pinned search_path on both functions and the triggers exist", async () => {
    const fns = (await pool.query(`SELECT proname, proconfig FROM pg_proc WHERE proname LIKE 'self_validation_policy_requests%guard' ORDER BY 1`)).rows as { proname: string; proconfig: string[] }[];
    expect(fns.map((f) => f.proname)).toEqual(["self_validation_policy_requests_guard", "self_validation_policy_requests_truncate_guard"]);
    for (const f of fns) expect(f.proconfig).toContain("search_path=pg_catalog, public, pg_temp");
    const trg = (await pool.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'self_validation_policy_requests'::regclass AND NOT tgisinternal ORDER BY 1`)).rows.map((r: { tgname: string }) => r.tgname);
    expect(trg).toEqual(["self_validation_policy_requests_guard", "self_validation_policy_requests_truncate_guard"]);
  });

  it("072: a decision_reason is bounded (1..500, not blank) and the approver's NUL is refused by the database too", async () => {
    const r = await one<{ id: string }>(`INSERT INTO self_validation_policy_requests (tenant_id, requested_policy, reason, requested_by) VALUES ($1, 'DOUBLE_CONFIRMATION', 'demande', $2) RETURNING id`, [t1, a1]);
    expect((await fails(`UPDATE self_validation_policy_requests SET status = 'APPLIED', decided_by = $2, decided_at = now(), decision_reason = '   ' WHERE id = $1`, [r.id, b1]))?.code).toBe("23514");
    expect((await fails(`UPDATE self_validation_policy_requests SET status = 'APPLIED', decided_by = $2, decided_at = now(), decision_reason = $3 WHERE id = $1`, [r.id, b1, "x".repeat(501)]))?.code).toBe("23514");
    expect((await fails(`UPDATE self_validation_policy_requests SET status = 'APPLIED', decided_by = $2, decided_at = now(), decision_reason = $3 WHERE id = $1`, [r.id, b1, "a\u0000b"]))?.code).toBe("22021");
    expect((await fails(`UPDATE self_validation_policy_requests SET status = 'APPLIED', decided_by = $2, decided_at = now(), decision_reason = 'ok' WHERE id = $1`, [r.id, a1]))?.code).toBe("23514"); // maker-checker
    // none of the refused attempts decided it
    expect((await one<{ status: string }>(`SELECT status FROM self_validation_policy_requests WHERE id = $1`, [r.id])).status).toBe("PENDING");
    await pool.query(`UPDATE self_validation_policy_requests SET status = 'WITHDRAWN', decided_by = $2, decided_at = now(), decision_reason = 'fin du test' WHERE id = $1`, [r.id, a1]);
  });
});
