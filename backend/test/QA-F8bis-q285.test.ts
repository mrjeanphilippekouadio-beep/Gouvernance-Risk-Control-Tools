import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { Pool } from "pg";
import { companyDomainNotAttested, emailDomain, isSuperAdminIdentity } from "../src/config/superAdminEmails.js";
import { GoogleIdentityProvider } from "../src/infrastructure/identity/GoogleIdentityProvider.js";
import type { IdentityProof } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-F8bis q285 (niveau 2) : « toute adresse d'un domaine de SUPER_ADMIN_DOMAINS exige un domaine atteste, refus avant la liaison du `sub` » (DECISION-136, SEC-F8B R-2).
 * Oracles ecrits AVANT l'execution. Pas un avis Security.
 *
 * A  (statique) table de verite de `companyDomainNotAttested` / `isSuperAdminIdentity` avec les vraies sorties de l'adaptateur Google (`hd` absent, autre, casse, espaces,
 *    domaines voisins) ; l'adaptateur Google ne fabrique jamais de domaine atteste a partir de l'adresse.
 * B  (live, QA_Q285_LIVE=1, base `grc_qa_q285`, VRAI serveur redemarre pour chaque configuration, port 8398) :
 *    S1 SUPER_ADMIN_DOMAINS=vv1.test, aucun LOCAL_AUTH_ATTESTED_DOMAIN : TOUT compte @vv1.test est refuse (utilisateur normal comme super-admin liste) ; @autre.test,
 *       @xvv1.test, @sub.vv1.test acceptes (domaines voisins : comparaison exacte), jamais super-admin.
 *    S2 + LOCAL_AUTH_ATTESTED_DOMAIN=vv1.test : @vv1.test accepte, super-admin seulement si l'adresse est listee ; autres domaines inchanges.
 *    S3 LOCAL_AUTH_ATTESTED_DOMAIN=autre.test (mauvais domaine) : @vv1.test refuse, @autre.test accepte (domaine non liste), personne super-admin.
 *    S4 SUPER_ADMIN_DOMAINS vide : aucun refus (comportement inchange), personne super-admin meme liste.
 *    S5 SUPER_ADMIN_DOMAINS=vv1.test,autre.test + atteste vv1.test : @autre.test refuse (domaine liste non atteste exactement), @vv1.test accepte.
 *    Pour chaque refus : 403 a la connexion, aucun jeton ; un jeton emis dans une configuration n'ouvre rien dans une autre (verifyToken relit l'appartenance).
 */
const ROOT = join(__dirname, "..", "..");
const live = process.env["QA_Q285_LIVE"] === "1";
const PGPORT = 55442;
const DB = "grc_qa_q285";
const PORT = 8398;
const API = `http://127.0.0.1:${PORT}/api/v1`;
const T = "aaaaaaaa-0000-4000-8000-000000000001";

describe("A table de verite q285 (statique)", () => {
  const domains = ["corp.com"];
  const cases: Array<[string, string | null | undefined, boolean]> = [
    ["a@corp.com", undefined, true], ["a@corp.com", null, true], ["a@corp.com", "", true], ["a@corp.com", "   ", true],
    ["a@corp.com", "other.com", true], ["a@corp.com", "corp.com.evil.test", true], ["a@corp.com", "sub.corp.com", true], ["a@corp.com", "xcorp.com", true],
    ["a@corp.com", "corp.com", false], ["a@corp.com", "CORP.com", false], ["A@Corp.COM", "corp.com", false], ["a@corp.com", " corp.com ", false],
    ["a@other.com", undefined, false], ["a@other.com", "corp.com", false], ["a@sub.corp.com", undefined, false], ["a@xcorp.com", undefined, false],
    ["a@corp.com.evil.test", undefined, false], ["a@corp.com.", undefined, false], ["acorp.com", undefined, false], ["", undefined, false],
  ];
  it("companyDomainNotAttested : domaine liste sans attestation EXACTE = refus ; tout autre domaine = jamais refuse (comparaison exacte, casse ignoree)", () => {
    for (const [email, attested, refused] of cases) expect(companyDomainNotAttested(email, attested, domains), `${email} / ${JSON.stringify(attested)}`).toBe(refused);
    expect(companyDomainNotAttested("a@corp.com", undefined, [])).toBe(false); // domaines non configures : inchange
    expect(companyDomainNotAttested("a@corp.com", "other.com", ["corp.com", "other.com"])).toBe(true); // deux domaines listes : l'attestation doit etre CELUI de l'adresse
    expect(companyDomainNotAttested("a@other.com", "corp.com", ["corp.com", "other.com"])).toBe(true);
    expect(companyDomainNotAttested("a@other.com", "other.com", ["corp.com", "other.com"])).toBe(false);
  });

  it("emailDomain : dernier @, minuscules, espaces retires ; pas de domaine => chaine vide (jamais « liste »)", () => {
    expect(emailDomain(" A@B@Corp.COM ")).toBe("corp.com");
    expect(emailDomain("sans-arobase")).toBe("");
    expect(companyDomainNotAttested("sans-arobase", undefined, domains)).toBe(false);
  });

  it("super-admin : jamais sans attestation, jamais pour un autre domaine, jamais si l'adresse n'est pas listee (le refus de connexion est plus large que le droit)", () => {
    const emails = ["boss@corp.com"];
    expect(isSuperAdminIdentity("boss@corp.com", "corp.com", emails, domains)).toBe(true);
    expect(isSuperAdminIdentity("boss@corp.com", undefined, emails, domains)).toBe(false);
    expect(isSuperAdminIdentity("staff@corp.com", "corp.com", emails, domains)).toBe(false);
    expect(isSuperAdminIdentity("boss@corp.com", "corp.com.evil.test", emails, domains)).toBe(false);
  });

  it("adaptateur Google : `hd` absent => null ; `hd` d'un autre domaine reste tel quel (donc refuse pour une adresse d'entreprise) ; l'adresse ne fabrique jamais le domaine atteste", async () => {
    const member = { userId: "u1", tenantId: "t1", roles: [], dashboardScopeMode: "GLOBAL" as const };
    const table: Array<[string, string | undefined, string | null]> = [
      ["staff@corp.com", undefined, null], ["staff@corp.com", "corp.com", "corp.com"], ["staff@corp.com", "Corp.COM", "corp.com"],
      ["staff@corp.com", "other.com", "other.com"], ["staff@gmail.com", undefined, null],
    ];
    for (const [email, hd, expected] of table) {
      const seen: IdentityProof[] = [];
      const p = new GoogleIdentityProvider("cid", async (_e, proof) => { seen.push(proof); return member; });
      (p as unknown as { client: unknown }).client = {
        verifyIdToken: async () => ({ getPayload: () => ({ email, email_verified: true, iat: 1, sub: "g-1", hd }) }),
      };
      await p.verifyToken("x");
      expect(seen[0]!.attestedDomain, `${email} hd=${hd}`).toBe(expected);
      expect(companyDomainNotAttested(email, seen[0]!.attestedDomain, domains), `${email} hd=${hd}`).toBe(email.endsWith("@corp.com") && expected !== "corp.com");
    }
  });
});

describe.skipIf(!live)("B q285 sur le VRAI serveur + PostgreSQL 16 LOCAL (une configuration = un redemarrage)", { timeout: 120000 }, () => {
  let pg: Pool;
  const server = (cmd: "start" | "stop", env: Record<string, string> = {}) => {
    const clean: NodeJS.ProcessEnv = { ...process.env };
    for (const k of ["SUPER_ADMIN_EMAILS", "SUPER_ADMIN_DOMAINS", "LOCAL_AUTH_ATTESTED_DOMAIN"]) delete clean[k];
    execFileSync("bash", [join(ROOT, "tests", "integration", "qa-q285-server.sh"), cmd], {
      env: { ...clean, QA_PORT: String(PORT), QA_DB: DB, QA_CORS: "http://127.0.0.1:5198", ...env }, stdio: ["ignore", "pipe", "pipe"], timeout: 120000,
    });
  };
  const login = async (email: string) => {
    const r = await fetch(`${API}/auth/local`, { method: "POST", headers: { "content-type": "application/json", connection: "close" }, body: JSON.stringify({ email, password: "whatever" }) });
    const body = (await r.json().catch(() => ({}))) as { accessToken?: string };
    return { status: r.status, token: body.accessToken };
  };
  const get = async (token: string, path: string) => (await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}`, connection: "close" } })).status;
  async function inConfig<R>(env: Record<string, string>, fn: () => Promise<R>): Promise<R> {
    server("stop");
    execFileSync("sleep", ["1"]);
    server("start", env);
    try { return await fn(); } finally { server("stop"); execFileSync("sleep", ["1"]); }
  }
  /** Outcome of a login attempt + what that session can do. */
  const outcome = async (email: string) => {
    const l = await login(email);
    if (l.status !== 200 || !l.token) return { login: (l.status === 401 || l.status === 403 ? "REFUSED" : l.status) as number | string, risks: null as number | null, tenants: null as number | null };
    return { login: l.status, risks: await get(l.token, "/risks"), tenants: await get(l.token, "/tenants") };
  };

  beforeAll(async () => {
    execFileSync("bash", [join(ROOT, "tests", "integration", "qa-visibility-v1-setup.sh"), "up", DB], { stdio: "ignore", timeout: 280000 });
    pg = new Pool({ host: "127.0.0.1", port: PGPORT, user: "postgres", database: DB, max: 2 });
    for (const e of ["ext@autre.test", "hors@autre.test", "look@xvv1.test", "look@sub.vv1.test"]) {
      await pg.query(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1,$2,$2,$3)`, [T, e, ["risk.read", "process.read"]]);
    }
  }, 300000);
  afterAll(async () => {
    server("stop");
    await pg?.end();
  });

  const COMPANY = ["adm@vv1.test", "aud@vv1.test", "own@vv1.test", "rm@vv1.test"]; // adm, aud, own : utilisateurs normaux ; rm : liste super-admin
  const OTHER = ["ext@autre.test", "look@xvv1.test", "look@sub.vv1.test"];

  it("S1 domaine d'entreprise liste, AUCUN domaine atteste (cas d'un fournisseur local sans LOCAL_AUTH_ATTESTED_DOMAIN, equivalent d'un Google sans `hd`) : tout @vv1.test refuse, y compris l'utilisateur normal ; les autres domaines passent et ne sont jamais super-admin", async () => {
    await inConfig({ SUPER_ADMIN_EMAILS: "rm@vv1.test", SUPER_ADMIN_DOMAINS: "vv1.test" }, async () => {
      for (const e of COMPANY) expect(await outcome(e), e).toEqual({ login: "REFUSED", risks: null, tenants: null });
      for (const e of OTHER) {
        const o = await outcome(e);
        expect(o.login, e).toBe(200);
        expect(o.risks, e).toBe(200);
        expect(o.tenants, `${e} : jamais super-admin`).toBe(403);
      }
    });
  });

  it("S2 domaine atteste = vv1.test : @vv1.test accepte (utilisateur normal inclus) ; super-admin SEULEMENT pour l'adresse listee ; autres domaines inchanges", async () => {
    await inConfig({ SUPER_ADMIN_EMAILS: "rm@vv1.test", SUPER_ADMIN_DOMAINS: "vv1.test", LOCAL_AUTH_ATTESTED_DOMAIN: "vv1.test" }, async () => {
      for (const e of ["adm@vv1.test", "aud@vv1.test", "own@vv1.test"]) {
        const o = await outcome(e);
        expect(o.login, e).toBe(200);
        expect(o.risks, e).toBeLessThan(500);
        expect(o.tenants, `${e} : utilisateur normal, jamais super-admin`).toBe(403);
      }
      const sa = await outcome("rm@vv1.test");
      expect(sa).toMatchObject({ login: 200, tenants: 200 });
      for (const e of OTHER) expect(await outcome(e), e).toMatchObject({ login: 200, risks: 200, tenants: 403 });
    });
  });

  it("S3 domaine atteste ERRONE (autre.test alors que la liste dit vv1.test) : @vv1.test refuse (y compris le super-admin liste) ; @autre.test accepte car non liste, jamais super-admin", async () => {
    await inConfig({ SUPER_ADMIN_EMAILS: "rm@vv1.test,ext@autre.test", SUPER_ADMIN_DOMAINS: "vv1.test", LOCAL_AUTH_ATTESTED_DOMAIN: "autre.test" }, async () => {
      for (const e of COMPANY) expect(await outcome(e), e).toEqual({ login: "REFUSED", risks: null, tenants: null });
      expect(await outcome("ext@autre.test")).toMatchObject({ login: 200, risks: 200, tenants: 403 }); // liste comme super-admin mais domaine non liste
    });
  });

  it("S4 SUPER_ADMIN_DOMAINS vide : aucun refus (comportement d'avant q285) ; personne n'est super-admin, meme l'adresse listee", async () => {
    await inConfig({ SUPER_ADMIN_EMAILS: "rm@vv1.test", LOCAL_AUTH_ATTESTED_DOMAIN: "vv1.test" }, async () => {
      for (const e of [...COMPANY, ...OTHER]) expect(await outcome(e), e).toMatchObject({ login: 200, tenants: 403 });
    });
    await inConfig({}, async () => {
      for (const e of [...COMPANY, ...OTHER]) expect(await outcome(e), `${e} sans aucune variable`).toMatchObject({ login: 200, tenants: 403 });
    });
  });

  it("S5 deux domaines listes, attestation vv1.test : @autre.test refuse (domaine liste non atteste exactement), @vv1.test accepte", async () => {
    await inConfig({ SUPER_ADMIN_EMAILS: "rm@vv1.test", SUPER_ADMIN_DOMAINS: "vv1.test,autre.test", LOCAL_AUTH_ATTESTED_DOMAIN: "vv1.test" }, async () => {
      expect(await outcome("ext@autre.test")).toEqual({ login: "REFUSED", risks: null, tenants: null });
      expect(await outcome("hors@autre.test")).toEqual({ login: "REFUSED", risks: null, tenants: null });
      expect(await outcome("adm@vv1.test")).toMatchObject({ login: 200, tenants: 403 });
      expect(await outcome("rm@vv1.test")).toMatchObject({ login: 200, tenants: 200 });
      expect((await outcome("look@xvv1.test")).login).toBe(200); // voisin non liste
    });
  });

  it("S6 un jeton emis avec l'attestation n'ouvre plus rien apres le redemarrage SANS attestation (verifyToken relit l'appartenance) ; meme secret impossible : jeton invalide (401/403, jamais 200)", async () => {
    let token = "";
    await inConfig({ SUPER_ADMIN_EMAILS: "rm@vv1.test", SUPER_ADMIN_DOMAINS: "vv1.test", LOCAL_AUTH_ATTESTED_DOMAIN: "vv1.test" }, async () => {
      const l = await login("adm@vv1.test");
      expect(l.status).toBe(200);
      token = l.token!;
      expect(await get(token, "/risks")).toBe(200);
    });
    await inConfig({ SUPER_ADMIN_EMAILS: "rm@vv1.test", SUPER_ADMIN_DOMAINS: "vv1.test" }, async () => {
      expect([401, 403]).toContain(await get(token, "/risks")); // le secret change a chaque demarrage : jeton invalide
      expect([401, 403]).toContain(await get(token, "/tenants"));
    });
  });
});
