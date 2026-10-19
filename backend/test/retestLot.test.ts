import { describe, expect, it, vi } from "vitest";
import express from "express";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { optionalComment, reasonText } from "../src/api/validation.js";
import { isAcceptableReason } from "../src/domain/governance/selfValidation.js";
import { governanceNotificationsMiddleware } from "../src/api/middleware/governanceNotifications.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ConflictError } from "../src/domain/errors/DomainErrors.js";
import { SelfValidationGate } from "../src/services/SelfValidationGate.js";
import { createLastSeenRecorder } from "../src/infrastructure/identity/lastSeen.js";
import { ConfigService } from "../src/services/ConfigService.js";
import type { Config } from "../src/domain/entities/Config.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/** Retest lot (F-PNL2-*, SEC-PNL2-*, I0x), level 1: the behavior each fix introduces. */
const NUL = "motif\u0000piégé";
const LONE_SURROGATE = "lone \ud800";

describe("reasonText / optionalComment (F-PNL2-06, I02)", () => {
  it("refuses NUL, lone surrogates and invisible-only text; accepts a normal sentence", () => {
    for (const bad of [NUL, LONE_SURROGATE, "   ", "​"]) expect(reasonText().safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(isAcceptableReason(LONE_SURROGATE)).toBe(false);
    expect(reasonText().parse("  un motif  ")).toBe("un motif");
  });
  it("multiline lets newlines through but still refuses NUL; optionalComment keeps null, undefined and \"\"", () => {
    expect(reasonText(500).safeParse("a\nb").success).toBe(false);
    expect(reasonText(500, true).safeParse("a\nb").success).toBe(true);
    expect(reasonText(500, true).safeParse("a\u0000b").success).toBe(false);
    for (const ok of [null, undefined, "", "bien"]) expect(optionalComment.safeParse(ok).success, String(ok)).toBe(true);
    expect(optionalComment.safeParse(NUL).success).toBe(false);
  });
  it("no HTTP body in api/v1 declares a reason / comment / justification as a bare z.string()", () => {
    const dir = join(__dirname, "..", "src", "api", "v1");
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      readFileSync(join(dir, f), "utf8").split("\n").forEach((line, i) => {
        if (/\b(reason|comment|justification)\w*\s*:\s*z\s*\.\s*string\(/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("SEC-PNL2-01: the mandatory notification does not depend on the socket", () => {
  it("a client that closes the connection before the answer still triggers the notifier once the handler ends", async () => {
    const processRequest = vi.fn(async () => undefined);
    const app = express();
    app.use((req, _res, next) => { req.requestId = "req-abort"; next(); });
    app.use(governanceNotificationsMiddleware({ processRequest }));
    app.post("/x", async (req, res) => {
      (req as unknown as { user: unknown }).user = { tenantId: "t1", userId: "u1" };
      await new Promise((r) => setTimeout(r, 150)); // the effect is "committed" here, after the client is gone
      res.status(200).json({});
    });
    const server = app.listen(0);
    try {
      const ac = new AbortController();
      const pending = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, signal: ac.signal }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 30));
      ac.abort();
      await pending;
      await new Promise((r) => setTimeout(r, 250));
      expect(processRequest).toHaveBeenCalledTimes(1);
      expect(processRequest).toHaveBeenCalledWith("t1", "u1", "req-abort");
    } finally { server.close(); }
  });
});

describe("I06: structured code on the 409 of the confirmation prompt", () => {
  it("SelfValidationGate raises a ConflictError carrying the code, and the handler puts it in the body (message prefix kept)", async () => {
    const gate = new SelfValidationGate({ getByTenant: async () => ({ selfValidationPolicy: "DOUBLE_CONFIRMATION" }) as Config }, { existsOther: async () => false });
    const err = await gate
      .check({ userId: "u", tenantId: "t", roles: [] } as unknown as AuthenticatedUser, { isSelf: true, permission: "x.validate", makerIds: ["u"], refusal: "Refus." })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("GOVERNANCE_CONFIRMATION_REQUIRED");
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };
    errorHandler(err, { requestId: "r" } as never, res as never, () => undefined);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(json.mock.calls[0]![0]).toMatchObject({ code: "GOVERNANCE_CONFIRMATION_REQUIRED", error: expect.stringMatching(/^GOVERNANCE_CONFIRMATION_REQUIRED:/) });
    // a plain conflict has no code
    const json2 = vi.fn();
    errorHandler(new ConflictError("clash", "id1"), { requestId: "r" } as never, { status: () => ({ json: json2 }) } as never, () => undefined);
    expect(json2.mock.calls[0]![0].code).toBeUndefined();
  });
});

describe("I01 / SEC-PNL3-01: the Google token's iat is compared in SQL and only ever moves forward", () => {
  it("a write needs a strictly newer iat (SQL and memory); alternating or older tokens write nothing more", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const rec = createLastSeenRecorder({ query } as never);
    for (const iat of [1000, 1000, 4600, 1000, 4600, 2000, 4600]) rec("t1", "u1", iat);
    await new Promise((r) => setTimeout(r, 10));
    expect(query).toHaveBeenCalledTimes(2); // 1000 then 4600; the alternation back to 1000 / 2000 is not a connection
    const first = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(first[0]).toContain("(last_token_iat IS NULL OR last_token_iat < $3)");
    expect(first[0]).not.toContain("DISTINCT");
    expect(first[0]).toContain("tenant_id = $1");
    expect(first[1]).toEqual(["t1", "u1", 1000]);
  });
});

describe("F-PNL2-06: committee enforcement and cumul are written with their audit in one transaction", () => {
  it("setCommitteeEnforcement / setCommitteeAuditCumul hand the audit builder to a transactional repository and record nothing themselves", async () => {
    const recorded: unknown[] = [];
    let seenAudit: unknown;
    const cfg = { id: "c1", tenantId: "t1", committeeEvaluationEnforced: false, committeeAuditCumulAllowed: false } as Config;
    const repo = {
      auditsInTransaction: true,
      getByTenant: async () => ({ ...cfg, committeeEvaluationEnforced: true }) as Config,
      upsert: async (_t: string, _p: unknown, _u: string, audit?: (c: Config) => unknown[]) => { seenAudit = audit; return cfg; },
    };
    const svc = new ConfigService(repo as never, { record: async (e: unknown) => { recorded.push(e); } } as never);
    const actor = { userId: "u", tenantId: "t1", roles: ["config.read", "config.committeeenforcement.set", "config.cumul.set"] } as unknown as AuthenticatedUser;
    await svc.setCommitteeEnforcement(actor, false, "motif", "r1");
    expect(typeof seenAudit).toBe("function");
    expect((seenAudit as (c: Config) => Array<{ action: string; reason: string }>)(cfg)[0]).toMatchObject({ action: "UPDATE", reason: "motif" });
    seenAudit = undefined;
    await svc.setCommitteeAuditCumul(actor, false, "motif", "r2");
    expect(typeof seenAudit).toBe("function");
    expect(recorded).toEqual([]);
    await expect(svc.setCommitteeEnforcement(actor, false, NUL, "r3")).rejects.toThrow(/reason/i);
  });
});
