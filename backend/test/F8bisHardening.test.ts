import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { z } from "zod";
import { companyDomainNotAttested, emailDomain, isSuperAdminIdentity, parseSuperAdminDomains } from "../src/config/superAdminEmails.js";
import { GoogleIdentityProvider } from "../src/infrastructure/identity/GoogleIdentityProvider.js";
import { LocalIdentityProvider, hashLocalPassword } from "../src/infrastructure/identity/LocalIdentityProvider.js";
import type { AuthenticatedUser, IdentityProof } from "../src/infrastructure/identity/IdentityProvider.js";
import { TenantService } from "../src/services/TenantService.js";
import type { TenantRepository } from "../src/domain/repositories/TenantRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { Tenant } from "../src/domain/entities/Tenant.js";
import { ConflictError } from "../src/domain/errors/DomainErrors.js";
import { PostgresTenantRepository } from "../src/infrastructure/database/postgres/PostgresTenantRepository.js";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { ensureIdentityBinding } from "../src/infrastructure/database/postgres/identityBinding.js";
import { PG_HOST, hasLocalPg } from "./migrationHarness.js";

const Domains = z.string().default("").transform(parseSuperAdminDomains);

describe("q275 SUPER_ADMIN_DOMAINS and the attested-domain rule", () => {
  it("parses exact lowercase domains, refuses wildcards and more than 20", () => {
    expect(Domains.parse("")).toEqual([]);
    expect(Domains.parse(" Corp.COM , corp.com,sub.corp.com ")).toEqual(["corp.com", "sub.corp.com"]);
    for (const bad of ["*.corp.com", "corp", "a@corp.com", "corp.com/x", "co rp.com"]) expect(Domains.safeParse(bad).success, bad).toBe(false);
    expect(Domains.safeParse(Array.from({ length: 21 }, (_, i) => `d${i}.com`).join(",")).success).toBe(false);
  });

  const emails = ["boss@corp.com"];
  const domains = ["corp.com"];
  it("requires an attested domain equal to the address domain and listed", () => {
    expect(isSuperAdminIdentity("boss@corp.com", "corp.com", emails, domains)).toBe(true);
    expect(isSuperAdminIdentity("BOSS@corp.com", "CORP.com", emails, domains)).toBe(true);
    expect(isSuperAdminIdentity("boss@corp.com", null, emails, domains)).toBe(false); // nothing attested
    expect(isSuperAdminIdentity("boss@corp.com", undefined, emails, domains)).toBe(false);
    expect(isSuperAdminIdentity("boss@corp.com", "other.com", emails, domains)).toBe(false); // other domain
    expect(isSuperAdminIdentity("boss@corp.com", "corp.com", emails, [])).toBe(false); // domain not configured
    expect(isSuperAdminIdentity("boss@corp.com", "corp.com", [], domains)).toBe(false);
    expect(isSuperAdminIdentity("other@corp.com", "corp.com", emails, domains)).toBe(false);
    expect(emailDomain("a@B.com")).toBe("b.com");
  });

  it("q285: a company-domain address needs exactly that domain attested; other domains are unaffected", () => {
    const d = ["corp.com"];
    expect(companyDomainNotAttested("a@corp.com", null, d)).toBe(true);
    expect(companyDomainNotAttested("a@corp.com", undefined, d)).toBe(true);
    expect(companyDomainNotAttested("a@corp.com", "other.com", d)).toBe(true);
    expect(companyDomainNotAttested("a@corp.com", "CORP.com", d)).toBe(false);
    expect(companyDomainNotAttested("a@gmail.com", null, d)).toBe(false);
    expect(companyDomainNotAttested("a@sub.corp.com", null, d)).toBe(false); // exact domain only
    expect(companyDomainNotAttested("a@corp.com", null, [])).toBe(false); // no company domain configured
  });

  it("q285 wiring: the refusal sits before the sub binding in the membership lookup", () => {
    const server = readFileSync(join(__dirname, "..", "src", "server.ts"), "utf8");
    const refuse = server.indexOf("companyDomainNotAttested(email, proof.attestedDomain, env.SUPER_ADMIN_DOMAINS)");
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(server.indexOf("ensureIdentityBinding(pool, row, proof.subject)"));
  });

  const member = { userId: "u1", tenantId: "t1", roles: [], dashboardScopeMode: "GLOBAL" as const };
  const lookup = (seen: IdentityProof[]) => async (_email: string, proof: IdentityProof) => {
    seen.push(proof);
    return member;
  };

  it("Google adapter: `hd` becomes attestedDomain, absent hd = null; the stable `sub` is handed to the lookup", async () => {
    for (const [hd, expected] of [["Corp.com", "corp.com"], [undefined, null]] as const) {
      const seen: IdentityProof[] = [];
      const p = new GoogleIdentityProvider("cid", lookup(seen));
      (p as unknown as { client: unknown }).client = {
        verifyIdToken: async () => ({ getPayload: () => ({ email: "boss@corp.com", email_verified: true, iat: 1, sub: "g-42", hd }) }),
      };
      const user = await p.verifyToken("x");
      expect(seen[0]).toEqual({ attestedDomain: expected, subject: { provider: "google", id: "g-42" } });
      expect(user.attestedDomain).toBe(expected);
    }
  });

  it("Google adapter refuses a token without a subject", async () => {
    const p = new GoogleIdentityProvider("cid", async () => member);
    (p as unknown as { client: unknown }).client = {
      verifyIdToken: async () => ({ getPayload: () => ({ email: "a@corp.com", email_verified: true, iat: 1 }) }),
    };
    await expect(p.verifyToken("x")).rejects.toThrow(/subject/);
  });

  it("local adapter: attestedDomain null by default, the configured value otherwise; no subject", async () => {
    const hash = hashLocalPassword("pw");
    for (const [configured, expected] of [[undefined, null], ["corp.com", "corp.com"]] as const) {
      const seen: IdentityProof[] = [];
      const full = async (_e: string, proof: IdentityProof): Promise<AuthenticatedUser> => {
        seen.push(proof);
        return { ...member, email: "boss@corp.com", displayName: "B" };
      };
      const p = new LocalIdentityProvider([{ email: "boss@corp.com", passwordHash: hash }], "s".repeat(32), 60, full, undefined, configured);
      const token = await p.authenticate("boss@corp.com", "pw");
      await p.verifyToken(token);
      expect(seen.length).toBe(2);
      for (const proof of seen) expect(proof).toEqual({ attestedDomain: expected });
    }
  });

  it("static guard: no provider claim (`hd`) is read outside the Google adapter", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));
    const offenders = walk(join(__dirname, "..", "src")).filter(
      (f) => !f.endsWith("GoogleIdentityProvider.ts") && /payload\.hd\b|\.hd\b\s*[=!)]/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("env: LOCAL_AUTH_ATTESTED_DOMAIN is refused at start in production", async () => {
    vi.resetModules();
    const saved = { ...process.env };
    Object.assign(process.env, {
      DATABASE_URL: "postgres://x@127.0.0.1:1/db",
      APP_ENV: "production",
      NODE_ENV: "test",
      AUTH_PROVIDER: "google",
      GOOGLE_OAUTH_CLIENT_ID: "cid",
      LOCAL_AUTH_ATTESTED_DOMAIN: "corp.com",
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(import("../src/config/env.js")).rejects.toThrow(/exit:1/);
      expect(err.mock.calls.flat().join(" ")).toMatch(/LOCAL_AUTH_ATTESTED_DOMAIN/);
    } finally {
      exit.mockRestore();
      err.mockRestore();
      process.env = saved;
      vi.resetModules();
    }
  });
});

describe("q277 / SEC-F8B-02 TenantService hands the survival rule and the audit to one transactional call", () => {
  it("deactivate / reactivate use setActiveAudited with the rule (deactivation only) and both audit rows", async () => {
    const t: Tenant = { id: "t2", name: "Q", deploymentMode: "managed_saas", active: true, createdAt: new Date(), updatedAt: new Date() };
    const calls: unknown[] = [];
    let events: unknown[] = [];
    const repo = {
      getById: async () => t,
      list: async () => [t],
      setActiveAudited: async (input: Parameters<NonNullable<TenantRepository["setActiveAudited"]>>[0]) => {
        calls.push(input);
        const after = { ...t, active: input.active };
        events = input.audit({ before: t, after });
        return after;
      },
    } as unknown as TenantRepository;
    const audit = { listForEntity: async () => [], record: async () => undefined } as unknown as AuditRepository;
    const service = new TenantService(repo, audit, { emails: ["a@corp.com", "b@corp.com"], domains: ["corp.com"] });
    const actor: AuthenticatedUser = { userId: "u1", tenantId: "t1", email: "a@corp.com", displayName: "A", roles: [], dashboardScopeMode: "GLOBAL", isSuperAdmin: true };
    await service.deactivate(actor, "t2", "client left", "r1");
    expect((calls[0] as { survivalRule: unknown }).survivalRule).toEqual({ actorUserId: "u1", emails: ["a@corp.com", "b@corp.com"], domains: ["corp.com"] });
    expect(events).toHaveLength(2); // actor's tenant + the client's tenant
    t.active = false;
    await service.reactivate(actor, "t2", "back", "r2");
    expect((calls[1] as { survivalRule?: unknown }).survivalRule).toBeUndefined();
    expect((calls[1] as { reactivatorMustDifferFrom?: string }).reactivatorMustDifferFrom).toBe("u1");
  });
});

// --- Live part: disposable local PostgreSQL only (QA_SWP_PGHOST = unix socket directory), migrations applied up to 092. ---
describe.skipIf(!hasLocalPg)("F8 bis hardening on a real database (migration 092)", () => {
  let pool: Pool;
  let tenants: PostgresTenantRepository;
  let audit: PostgresAuditRepository;
  const tag = randomUUID().slice(0, 8);
  const reqId = () => randomUUID();

  beforeAll(() => {
    pool = new Pool({ host: PG_HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 6 });
    tenants = new PostgresTenantRepository(pool);
    audit = new PostgresAuditRepository(pool);
  });
  afterAll(async () => {
    await pool?.end();
  });

  async function user(tenantId: string, email: string): Promise<string> {
    const { rows } = await pool.query(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'U') RETURNING id`, [tenantId, email]);
    return rows[0].id;
  }
  const actorOf = (userId: string, tenantId: string, email: string): AuthenticatedUser => ({
    userId, tenantId, email, displayName: "SA", roles: [], dashboardScopeMode: "GLOBAL", isSuperAdmin: true,
  });

  it("QA-F8B-01: concurrent creations of the same normalized name give exactly one client", async () => {
    const names = [`Acme ${tag}`, `acme  ${tag}`, ` ACME ${tag} `, `Acme ${tag}`];
    // Repository level: the unique index is the guarantee under test (the service audit would need a real actor row).
    const results = await Promise.allSettled(names.map((name) => tenants.create({ name })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM tenants WHERE lower(name) LIKE $1`, [`acme%${tag}%`]);
    expect(rows[0].n).toBe(1);
    // a rename to a clashing normalized name is a clean 409 too
    const other = await tenants.create({ name: `Other ${tag}` });
    await expect(tenants.update(other.id, { name: `  ACME   ${tag}` })).rejects.toBeInstanceOf(ConflictError);
  });

  it("q277 + SEC-F8B-02: survival rule, and state + audit commit or roll back together", async () => {
    const A = await tenants.create({ name: `A-${tag}` });
    const B = await tenants.create({ name: `B-${tag}` });
    const C = await tenants.create({ name: `C-${tag}` });
    const e1 = `sa1-${tag}@corp.test`;
    const e2 = `sa2-${tag}@corp.test`;
    const u1 = await user(A.id, e1);
    await user(B.id, e2);
    const policy = { emails: [e1, e2], domains: ["corp.test"] };
    const service = new TenantService(tenants, audit, policy);
    const sa1 = actorOf(u1, A.id, e1);

    // C hosts no super-administrator and SA2 (in B) survives: allowed; audit rows in both tenants, same commit.
    await service.deactivate(sa1, C.id, "client left", reqId());
    expect((await tenants.getById(C.id))?.active).toBe(false);
    expect((await audit.listForEntity(C.id, "Tenant", C.id)).length).toBe(1);
    expect((await audit.listForEntity(A.id, "Tenant", C.id)).length).toBe(1);

    // B hosts the only other super-administrator: refused, nothing changed, nothing audited.
    await expect(service.deactivate(sa1, B.id, "oops", reqId())).rejects.toThrow(/at least two super-administrators/);
    expect((await tenants.getById(B.id))?.active).toBe(true);
    expect((await audit.listForEntity(B.id, "Tenant", B.id)).length).toBe(0);

    // QA-F8B-05 / race: the last deactivator is re-read INSIDE the transaction; sa1 deactivated C, so sa1 cannot reactivate it.
    await expect(
      tenants.setActiveAudited({ id: C.id, active: true, expectedActive: false, reactivatorMustDifferFrom: u1, audit: () => [] }),
    ).rejects.toThrow(/different super-administrator/);
    expect((await tenants.getById(C.id))?.active).toBe(false);

    // A failing audit insert rolls the state change back (no deactivation without trace).
    await expect(
      tenants.setActiveAudited({
        id: C.id, active: true, expectedActive: false,
        audit: () => [{ tenantId: A.id, userId: randomUUID(), entityType: "Tenant", entityId: C.id, action: "STATUS_CHANGE", oldValue: null, newValue: null, reason: "x", requestId: reqId() }],
      }),
    ).rejects.toBeDefined(); // FK on user_id fails
    expect((await tenants.getById(C.id))?.active).toBe(false);

    // Stale expectation (concurrent change) is a conflict.
    await expect(
      tenants.setActiveAudited({ id: C.id, active: false, expectedActive: true, audit: () => [] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("SEC-F8B-11: activation audit rows are dated after the lock is taken, not at transaction start", async () => {
    const T = await tenants.create({ name: `Clock-${tag}` });
    const uid = await user(T.id, `clock-${tag}@corp.test`);
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(920092)"); // same constant as PostgresTenantRepository
      const pending = tenants.setActiveAudited({
        id: T.id, active: false, expectedActive: true,
        audit: () => [{ tenantId: T.id, userId: uid, entityType: "Tenant", entityId: T.id, action: "STATUS_CHANGE", oldValue: null, newValue: { active: false }, reason: "x", requestId: reqId() }],
      }); // starts its transaction, then waits for the lock
      await new Promise((r) => setTimeout(r, 400));
      const released = new Date();
      await holder.query("COMMIT");
      await pending;
      const [row] = await audit.listForEntity(T.id, "Tenant", T.id);
      expect(row!.timestamp.getTime()).toBeGreaterThanOrEqual(released.getTime() - 5);
    } finally {
      holder.release();
    }
  });

  it("QA-F8B-02: a second FIRST import audit row of the same file is refused; a confirmed reimport is allowed", async () => {
    const T = await tenants.create({ name: `Imp-${tag}` });
    const uid = await user(T.id, `imp-${tag}@corp.test`);
    const entityId = randomUUID();
    const ev = (reimport: boolean) => ({
      tenantId: T.id, userId: uid, entityType: "RiskImport", entityId, action: "CREATE" as const,
      oldValue: null, newValue: { sha256: "h", reimport }, reason: reimport ? "again" : null, requestId: reqId(),
    });
    const results = await Promise.allSettled([audit.record(ev(false)), audit.record(ev(false))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    expect((rejected.reason as ConflictError).code).toBe("ALREADY_IMPORTED");
    await audit.record(ev(true));
    await audit.record(ev(true));
    // same hash in ANOTHER tenant is independent
    const T2 = await tenants.create({ name: `Imp2-${tag}` });
    const uid2 = await user(T2.id, `imp2-${tag}@corp.test`);
    await audit.record({ ...ev(false), tenantId: T2.id, userId: uid2 });
  });

  it("q282 A: first login binds the provider subject; another subject for the same account, or this subject on another account, is refused", async () => {
    const T = await tenants.create({ name: `Bind-${tag}` });
    const mk = async (email: string) => {
      const id = await user(T.id, email);
      const { rows } = await pool.query(`SELECT id, tenant_id, identity_provider, identity_subject FROM users WHERE id = $1`, [id]);
      return rows[0];
    };
    const reload = async (id: string) =>
      (await pool.query(`SELECT id, tenant_id, identity_provider, identity_subject FROM users WHERE id = $1`, [id])).rows[0];
    const sub = `g-${tag}`;
    const alice = await mk(`alice-${tag}@corp.test`);
    expect(await ensureIdentityBinding(pool, alice, { provider: "google", id: sub })).toBe(true); // first login: bound
    const bound = await reload(alice.id);
    expect(bound.identity_subject).toBe(sub);
    expect((await audit.listForEntity(T.id, "User", alice.id)).length).toBe(1);
    expect(JSON.stringify((await audit.listForEntity(T.id, "User", alice.id))[0])).not.toContain(sub); // subject never in the journal
    expect(await ensureIdentityBinding(pool, bound, { provider: "google", id: sub })).toBe(true); // same person later
    expect(await ensureIdentityBinding(pool, bound, { provider: "google", id: `${sub}-other` })).toBe(false); // address reassigned
    expect(await ensureIdentityBinding(pool, bound, { provider: "other", id: sub })).toBe(false);
    const bob = await mk(`bob-${tag}@corp.test`);
    expect(await ensureIdentityBinding(pool, bob, { provider: "google", id: sub })).toBe(false); // subject already bound elsewhere
    expect((await reload(bob.id)).identity_subject).toBeNull();
    // concurrent first logins of one unbound account with two subjects: exactly one wins
    const carol = await mk(`carol-${tag}@corp.test`);
    const race = await Promise.all([
      ensureIdentityBinding(pool, carol, { provider: "google", id: `${sub}-c1` }),
      ensureIdentityBinding(pool, carol, { provider: "google", id: `${sub}-c2` }),
    ]);
    expect(race.filter(Boolean)).toHaveLength(1);
  });
});
