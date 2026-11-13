import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_PERMISSIONS } from "../src/domain/fixedGroupPermissions.js";
import { ROOT, qaVisibilityHarness } from "./qaVisibilityHarness.js";

/**
 * QA-visibility-v4 (level 2): lot V4 (DECISION-103 q197 A3 / A1, q202, q174, q215). `resource.readall` is never on a role; it is obtained through the q200
 * circuit (`sensitive_view_grants.kind = RESOURCE_READALL`, migration 084): requested by an administrator with a reason, never for oneself; beneficiary =
 * administrator outside Risk Manager / Committee / Audit; confirmed or refused by a Committee / Audit member who is neither author, beneficiary nor
 * administrator; expiry q174; revocable with a reason; ends at suspension or when the last administrator role is lost; audit in the same transaction;
 * GRANT badge in the matrix. APPROVED => the administrator reads everything (NOMINATIF included, hidden count = null). A1: an administrator without
 * the right gets `GET /restricted-resources` as metadata only and reads no restricted content (404). q215: reason cut to 140 characters in that list.
 * Oracles written BEFORE running, from the decisions. Not a Security / Privacy / Compliance opinion.
 *
 * Live part: QA_VIS4_LIVE=1 + LOCAL cluster of tests/integration/qa-visibility-v1-setup.sh (127.0.0.1:55442, never a remote host); own base grc_qa_vv4t is
 * rebuilt: run live suites with --no-file-parallelism. `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 */
const live = process.env["QA_VIS4_LIVE"] === "1";
const DB = "grc_qa_vv4t";
const PORT = 8094;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("QA-visibility-v4 STATIC", () => {
  it("resource.readall is a known permission, never in ADMIN_PERMISSIONS (otherwise every holder would count as administrator, trap q63)", () => {
    expect(read("backend", "src", "domain", "permissions.ts")).toContain('"resource.readall"');
    expect((ADMIN_PERMISSIONS as string[]).includes("resource.readall")).toBe(false);
  });
  it("migration 084: kind CHECK, kind immutable in the guard, search_path pinned with pg_temp last on every function, no DELETE FROM, IF NOT EXISTS", () => {
    const sql = read("database", "postgresql", "migrations", "084_resource_readall.sql");
    expect(sql).toMatch(/CHECK \(kind IN \('ROLE_READ_SENSITIVE', 'RESOURCE_READALL'\)\)/);
    expect(sql).toMatch(/NEW\.kind IS DISTINCT FROM OLD\.kind/);
    // DECISION-111 (q219): 15 functions — guard, is_administrator, reads_all, 5 *_visible_core, 2 effective levels, 5 *_visible_to
    expect((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(15);
    expect((sql.match(/SET search_path = pg_catalog, public, pg_temp/g) ?? []).length).toBeGreaterThanOrEqual(30); // 15 inline + 15 ALTER FUNCTION
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS kind");
  });
  it("route: `kind` is a closed enum, body strict, the author is always the caller (no requestedBy in the body)", () => {
    const r = read("backend", "src", "api", "v1", "roles.routes.ts");
    expect(r).toMatch(/z\.enum\(\["ROLE_READ_SENSITIVE", "RESOURCE_READALL"\]\)/);
    expect(r).toMatch(/SensitiveViewRequestBody = z\.object\(\{[^}]*\}\)\.strict\(\)/);
    expect(r).not.toMatch(/requestedBy:\s*z\./);
  });
  it("q215: the « Ne nommez pas la personne concernée » hint is a VISIBLE help text on the visibility-opening reason fields (not only a tooltip)", () => {
    for (const f of ["design-system/RaciPanel", "features/risks/RiskVisibility", "features/risks/RisksPage", "features/referentials/ProcessResponsibilitiesCard"]) {
      expect(read("frontend", "src", `${f}.tsx`), f).toContain("REASON_NO_NAME_HINT");
    }
    expect(read("frontend", "src", "api", "visibility.ts")).toContain("Ne nommez pas la personne concernée");
  });
  it("q215 (QA-V4-03): RolesAdmin carries the hint as help text, not a `title` tooltip only", () => {
    expect(read("frontend", "src", "features", "admin", "RolesAdmin.tsx")).not.toMatch(/title=\{REASON_NO_NAME_HINT\}/);
  });
});

type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
const BASES = ["risks", "controls", "anomalies", "actions", "kpis"] as const;
const R_ADMIN = I("311"), R_ADMIN2 = I("312"), R_PLAIN = I("313");
const ADMIN_PERMS = "{role.assign,role.read,user.update}";
const READALL = "RESOURCE_READALL";
// restricted rows `out` legitimately reads anyway: a01 / a09 (responsible person), d08 (own level ignored, risk CLIENT)
const LEGIT = [I("a01"), I("a09"), I("d08")];

const H = qaVisibilityHarness({ db: DB, port: PORT, who: WHO, uid: UID });
const { sql, call, get, post, put, audits, notifs } = H;
const BASE = "/roles/sensitive-view-grants";
const ask = (by: Who, whom: Who | string, reason: unknown = "Support : enquête sur un incident", kind: unknown = READALL) =>
  post(by, BASE, { userId: UID[whom as Who] ?? whom, reason, ...(kind === undefined ? {} : { kind }) });
const decide = (by: Who, id: string, ok: boolean, reason?: string) => post(by, `${BASE}/${id}/${ok ? "approve" : "reject"}`, reason === undefined ? {} : { reason });
const revoke = (by: Who, id: string, reason: unknown = "Fin du besoin") => post(by, `${BASE}/${id}/revoke`, { reason });
const grantRows = (user: Who) => sql<{ id: string; status: string; kind: string }>("SELECT id, status, kind FROM sensitive_view_grants WHERE user_id = $1 ORDER BY requested_at, id", [UID[user]]);
const live_ = async (user: Who) => (await grantRows(user)).find((g) => g.status === "PENDING" || g.status === "APPROVED");
const assign = (roleId: string, user: Who) => sql("INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)", [I("001"), roleId, UID[user], UID.adm]);
const unassign = (roleId: string, user: Who) => sql("UPDATE user_roles SET revoked_at = now() WHERE role_id = $1 AND user_id = $2 AND revoked_at IS NULL", [roleId, UID[user]]);
const idsOf = (r: { json: any }): string[] => ((r.json?.data ?? []) as Array<{ id: string }>).map((x) => x.id).sort((a, b) => a.localeCompare(b));
// DECISION-111 (q219): resource.readall never opens NOMINATIF — the probe is c04 (PERIMETRE, read by none of the
// administrators of this data set: out, n1, raci, own, adm).
const probe = async (w: Who) => (await get(w, `/controls/${I("c04")}`)).status;
const EFFECTIVE: Record<(typeof BASES)[number], string> = {
  risks: "(SELECT visibility FROM risks WHERE id = $1 AND tenant_id = $2)", controls: "(SELECT visibility FROM controls WHERE id = $1 AND tenant_id = $2)",
  kpis: "(SELECT visibility FROM kpis WHERE id = $1 AND tenant_id = $2)", anomalies: "anomaly_effective_visibility($2, $1)", actions: "action_plan_effective_visibility($2, $1)",
};
const sources = async (user: Who) => ((await get("adm", `/roles/users/${UID[user]}/permission-sources`)).json?.data ?? []) as Array<{ permission: string; sources: Array<{ kind: string }> }>;
const hasBadge = async (user: Who) => (await sources(user)).find((p) => p.permission === "resource.readall")?.sources.map((s) => s.kind);
const failAudit = async (action: string) => {
  await sql(`CREATE OR REPLACE FUNCTION qa_v4_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' AND NEW.entity_type = 'SensitiveViewGrant' THEN RAISE EXCEPTION 'qa audit failure'; END IF; RETURN NEW; END $$`);
  await sql("DROP TRIGGER IF EXISTS qa_v4_fail ON audit_log");
  await sql("CREATE TRIGGER qa_v4_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_v4_fail_audit()");
};
const restoreAudit = () => sql("DROP TRIGGER IF EXISTS qa_v4_fail ON audit_log");
const patchGrant = async (id: string, set: string) => {
  await sql("ALTER TABLE sensitive_view_grants DISABLE TRIGGER USER");
  try { await sql(`UPDATE sensitive_view_grants SET ${set} WHERE id = $1`, [id]); } finally { await sql("ALTER TABLE sensitive_view_grants ENABLE TRIGGER USER"); }
};
/** Request + confirmation by Audit: the beneficiary now holds resource.readall. */
const grant = async (user: Who) => {
  const g = await ask("adm", user);
  expect(g.status, g.text).toBe(201);
  expect((await decide("aud", g.json.data.id, true)).status).toBe(200);
  return g.json.data.id as string;
};

describe.skipIf(!live)("QA-visibility-v4 on the REAL server + LOCAL PostgreSQL 16", () => {
  beforeAll(() => H.start(async () => {
    await sql("UPDATE users SET roles = roles || ARRAY['execution.read','effectiveness.read','evidence.read']::text[]");
    await sql("UPDATE users SET roles = array_remove(roles, 'resourcevisibility.set') WHERE email = 'adm@vv1.test'"); // the right lives in the RM group
    await sql("UPDATE users SET roles = roles || ARRAY['role.assign','role.read','role.create','role.update','user.delete','user.update','user.reactivate']::text[] WHERE email = 'adm@vv1.test'");
    // administrators by ROLE (what visibility_is_administrator reads): out, n1, raci, own ; adm holds the rights directly only
    await sql("INSERT INTO roles (id, tenant_id, name, permissions) VALUES ($1, $4, 'QA Admins', $5), ($2, $4, 'QA Admins 2', '{user.update}'), ($3, $4, 'QA Plain', '{risk.read}')",
      [R_ADMIN, R_ADMIN2, R_PLAIN, I("001"), ADMIN_PERMS]);
    for (const w of ["out", "n1", "raci", "own"] as const) { await assign(R_ADMIN, w); await assign(R_PLAIN, w); }
    await assign(R_ADMIN2, "own");
    // c03 is NOMINATIF and listed to `named` only; c02 PERIMETRE; a few more NOMINATIF/PERIMETRE come from the seed
  }), 280000);
  afterAll(() => H.stop());

  // ------------------------------------------------------------------------------------------------ A1
  describe("A1: an administrator without resource.readall (q197)", () => {
    it("the data set is what the oracles assume: out is administrator by role, cannot read c03 (404), no grant exists", async () => {
      expect(await probe("out")).toBe(404);
      expect(await probe("rm")).toBe(200);
      expect((await sql("SELECT count(*)::int AS n FROM sensitive_view_grants"))[0]).toEqual({ n: 0 });
    });
    it("GET /restricted-resources: 401 anonymous; 403 for a non-administrator (dept); 200 metadata only for administrators (adm direct rights, out by role)", async () => {
      expect((await call(null, "GET", "/restricted-resources")).status).toBe(401);
      expect((await get("dept", "/restricted-resources")).status).toBe(403);
      expect((await get("raci", "/restricted-resources")).status).toBe(200); // administrator by role
      for (const w of ["adm", "out"] as const) {
        const r = await get(w, "/restricted-resources?limit=500");
        expect(r.status, w).toBe(200);
        const rows = r.json.data as Array<Record<string, unknown>>;
        expect(rows.length, w).toBeGreaterThan(0);
        for (const row of rows) expect(Object.keys(row).sort((a, b) => a.localeCompare(b)), JSON.stringify(row)).toEqual(["accessCount", "id", "type", "updatedAt", "visibility"]);
        expect(r.text, w).not.toMatch(/CANARY|label|lastChange|reason|byName|userId/);
      }
    });
    it("the metadata list is the same set of resources as the Risk Manager's, in the same order, and paginates", async () => {
      const full = (await get("rm", "/restricted-resources?limit=500")).json.data as Array<{ type: string; id: string }>;
      const meta = (await get("adm", "/restricted-resources?limit=500")).json.data as Array<{ type: string; id: string }>;
      expect(meta.map((x) => `${x.type}:${x.id}`)).toEqual(full.map((x) => `${x.type}:${x.id}`));
      const page = (await get("adm", "/restricted-resources?limit=2&offset=1")).json.data as unknown[];
      expect(page.length).toBe(2);
      for (const q of ["limit=0", "limit=501", "offset=-1", "limit=abc"]) expect((await get("adm", `/restricted-resources?${q}`)).status, q).toBe(400);
    });
    it("no restricted content is readable by an administrator (404 on every PERIMETRE / NOMINATIF resource the RM lists, list endpoints exclude them)", async () => {
      const restricted = (await get("rm", "/restricted-resources?limit=500")).json.data as Array<{ type: string; id: string }>;
      const base: Record<string, string> = { RISK: "risks", CONTROL: "controls", ANOMALY: "anomalies", ACTION_PLAN: "actions", KPI: "kpis" };
      expect(restricted.length).toBeGreaterThan(3);
      for (const r of restricted) {
        // a01 / a09: `out` is their responsible person (seed): he reads them as such, with or without the right
        expect((await get("out", `/${base[r.type]}/${r.id}`)).status, `${r.type} ${r.id}`).toBe(LEGIT.includes(r.id) ? 200 : 404);
      }
      for (const b of BASES) {
        const seen = idsOf(await get("out", `/${b}`));
        for (const r of restricted.filter((x) => base[x.type] === b && !LEGIT.includes(x.id))) expect(seen, `${b} list leaks ${r.id}`).not.toContain(r.id);
      }
    });
    it("an administrator who is not Risk Manager / Committee / Audit gets a numeric hidden count (not null), the three groups get null", async () => {
      const c = (await get("out", "/hidden-counts")).json.data;
      expect(c).not.toBeNull();
      // DECISION-115 (q228 A): 1 to 4 hidden items come as « moins de 5 » ({ belowThreshold: true }), never the number
      expect(Object.values(c).some((n) => (typeof n === "object" && n !== null) || (n as number) >= 5)).toBe(true);
      expect(Object.values(c).every((n) => typeof n === "object" || n === 0 || (n as number) >= 5)).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------------------ REQUEST
  describe("circuit: request (POST /roles/sensitive-view-grants kind RESOURCE_READALL)", () => {
    it("401 anonymous; 403 for a non-administrator and for the RM / Committee / Audit seats (no role.assign)", async () => {
      expect((await call(null, "POST", BASE, { userId: UID.out, reason: "x", kind: READALL })).status).toBe(401);
      for (const w of ["dept", "rm", "com", "aud"] as const) expect((await ask(w, "out")).status, w).toBe(403);
    });
    it("body strict: unknown `kind`, missing / blank / null / 501-char / numeric reason, non-GUID userId, extra field (requestedBy) => 400, nothing written", async () => {
      expect((await ask("adm", "out", "Motif", "ADMIN")).status, "kind ADMIN").toBe(400);
      expect((await ask("adm", "out", "Motif", "resource.readall")).status, "kind resource.readall").toBe(400);
      expect((await post("adm", BASE, { userId: UID.out, kind: READALL })).status, "reason missing").toBe(400);
      for (const bad of ["", "   ", "\t\n ", "x".repeat(501), null, 5]) expect((await ask("adm", "out", bad)).status, JSON.stringify(bad)).toBe(400);
      expect((await post("adm", BASE, { userId: "not-a-guid", reason: "m", kind: READALL })).status, "non-GUID").toBe(400);
      expect((await post("adm", BASE, { userId: UID.out, reason: "m", kind: READALL, requestedBy: UID.rm })).status, "requestedBy").toBe(400);
      expect((await post("adm", BASE, { userId: UID.out, reason: "m", kind: READALL, status: "APPROVED" })).status, "status").toBe(400);
      expect((await grantRows("out")).length).toBe(0);
    });
    it("beneficiary rules: never oneself (403), never a non-administrator (400), never RM / Committee / Audit (400), unknown (404), direct-rights-only account (400)", async () => {
      await assign(R_ADMIN, "dept");
      expect((await ask("out", "out")).status, "oneself").toBe(403); // `out` is administrator by role, asks for himself
      await unassign(R_ADMIN, "dept");
      expect((await ask("adm", "named")).status, "not administrator").toBe(400);
      for (const w of ["rm", "com", "aud"] as const) expect((await ask("adm", w)).status, w).toBe(400);
      expect((await ask("adm", "aaaaaaaa-0000-4000-8000-0000000fffff")).status, "unknown").toBe(404);
      expect((await ask("out", "adm")).status, "adm holds administration rights only through users.roles: not an administrator for the SQL rule").toBe(400);
      expect((await grantRows("named")).length + (await grantRows("rm")).length + (await grantRows("adm")).length).toBe(0);
    });
    it("an administrator who also sits in a fixed group cannot be a beneficiary (already reads everything)", async () => {
      await assign(R_ADMIN, "com");
      try { expect((await ask("adm", "com")).status).toBe(400); } finally { await unassign(R_ADMIN, "com"); }
    });
    it("candidates: administrators by role outside the fixed groups, never the caller; kind is validated (400)", async () => {
      const r = await get("adm", `${BASE}/candidates?kind=${READALL}`);
      expect(r.status).toBe(200);
      expect((r.json.data as Array<{ id: string }>).map((c) => c.id).sort((a, b) => a.localeCompare(b))).toEqual([UID.out, UID.n1, UID.raci, UID.own].sort((a, b) => a.localeCompare(b)));
      expect((await get("out", `${BASE}/candidates?kind=${READALL}`)).json.data.map((c: { id: string }) => c.id)).not.toContain(UID.out);
      expect((await get("adm", `${BASE}/candidates?kind=ADMIN`)).status).toBe(400);
      expect((await get("dept", `${BASE}/candidates?kind=${READALL}`)).status).toBe(403);
    });
    it("a valid request: 201 PENDING kind RESOURCE_READALL, author = caller, SUBMIT audited with the reason, confirmers notified without the reason, beneficiary not", async () => {
      const r = await ask("adm", "out", "Support : enquête incident 4711");
      expect(r.status, r.text).toBe(201);
      const g = r.json.data;
      expect(g).toMatchObject({ userId: UID.out, kind: READALL, status: "PENDING", requestedBy: UID.adm });
      const a = (await audits(g.id)).filter((x) => x.action === "SUBMIT");
      expect(a.length).toBe(1);
      expect(a[0]).toMatchObject({ reason: "Support : enquête incident 4711", user_id: UID.adm, entity_type: "SensitiveViewGrant" });
      for (const w of ["com", "aud"] as const) {
        const n = await notifs(w, g.id);
        expect(n.length, w).toBe(1);
        expect(n[0]!.message).not.toContain("4711");
      }
      expect((await notifs("out", g.id)).length).toBe(0);
    });
    it("pending gives nothing: no badge, no content (404), hidden count still numeric", async () => {
      expect(await hasBadge("out")).toBeUndefined();
      expect(await probe("out")).toBe(404);
      expect((await get("out", "/hidden-counts")).json.data).not.toBeNull();
    });
    it("a second request for the same account while one is live: 409 (not 5xx); a parallel double request gives one 201 and one 409, one SUBMIT", async () => {
      expect((await ask("adm", "out")).status).toBe(409);
      const [a, b] = await Promise.all([ask("adm", "n1"), ask("out", "n1")]);
      expect([a.status, b.status].sort((x, y) => x - y), `${a.text} | ${b.text}`).toEqual([201, 409]);
      const g = (await live_("n1"))!;
      expect((await audits(g.id)).filter((x) => x.action === "SUBMIT").length).toBe(1);
      expect((await revoke("adm", g.id, "Nettoyage QA")).status).toBe(200);
    });
    it("a failing audit write rolls the request back (same transaction): 5xx and no grant row", async () => {
      await failAudit("SUBMIT");
      try {
        const r = await ask("adm", "n1");
        expect(r.status).toBeGreaterThanOrEqual(500);
      } finally { await restoreAudit(); }
      expect((await grantRows("n1")).filter((g) => g.status === "PENDING").length).toBe(0);
    });
  });

  // ------------------------------------------------------------------------------------------------ DECISION
  describe("circuit: confirmation / refusal (q202)", () => {
    let gid = "";
    beforeAll(async () => { gid = (await live_("out"))!.id; });
    it("unauthorized deciders get 403 and the grant stays PENDING: author, beneficiary, Risk Manager, plain user, an administrator who is Committee / Audit", async () => {
      for (const w of ["adm", "out", "rm", "dept", "n1"] as const) expect((await decide(w, gid, true)).status, w).toBe(403);
      await assign(R_ADMIN, "com");
      try { expect((await decide("com", gid, true)).status, "Committee member who is also administrator (q202)").toBe(403); } finally { await unassign(R_ADMIN, "com"); }
      await assign(R_ADMIN2, "aud");
      try { expect((await decide("aud", gid, false, "Refus")).status, "Audit member who is also administrator, refusal too").toBe(403); } finally { await unassign(R_ADMIN2, "aud"); }
      expect((await live_("out"))!.status).toBe("PENDING");
      expect(await probe("out")).toBe(404);
    });
    it("a refusal needs a reason (400); unknown grant 404; non-GUID id 400", async () => {
      expect((await decide("aud", gid, false)).status).toBe(400);
      expect((await decide("aud", I("fffffffff".slice(0, 3)), true)).status).toBeGreaterThanOrEqual(400);
      expect((await post("aud", `${BASE}/not-a-guid/approve`, {})).status).toBe(400);
      expect((await live_("out"))!.status).toBe("PENDING");
    });
    it("the beneficiary joined a fixed group while pending: the confirmation is refused (400), still PENDING", async () => {
      const committee = (await sql<{ id: string }>("SELECT id FROM roles WHERE system_group = 'RISK_COMMITTEE'"))[0]!.id;
      await assign(committee, "out");
      try { expect((await decide("aud", gid, true)).status).toBe(400); } finally { await unassign(committee, "out"); }
      expect((await live_("out"))!.status).toBe("PENDING");
    });
    it("a failing audit write rolls the decision back: stays PENDING, no effect", async () => {
      await failAudit("APPROVE");
      try { expect((await decide("aud", gid, true)).status).toBeGreaterThanOrEqual(500); } finally { await restoreAudit(); }
      expect((await live_("out"))!.status).toBe("PENDING");
      expect(await probe("out")).toBe(404);
    });
    it("expired request (q174): approval 409, no effect; it can still be refused", async () => {
      await patchGrant(gid, "expires_at = now() - interval '1 minute'");
      expect((await decide("aud", gid, true)).status).toBe(409);
      expect(await probe("out")).toBe(404);
      const fresh = await ask("adm", "n1"); // another account, not blocked
      expect(fresh.status).toBe(201);
      await patchGrant(fresh.json.data.id, "expires_at = now() - interval '1 minute'");
      const again = await ask("adm", "n1"); // the stale one is withdrawn (REVOKED, audited) and replaced
      expect(again.status, again.text).toBe(201);
      expect((await grantRows("n1")).map((g) => g.status).slice(-2)).toEqual(["REVOKED", "PENDING"]);
      expect((await revoke("adm", again.json.data.id, "Nettoyage QA")).status).toBe(200);
      await patchGrant(gid, "expires_at = NULL");
    });
    it("two confirmers at once: one 200, one 409, exactly one APPROVE audit row", async () => {
      const [a, b] = await Promise.all([decide("aud", gid, true), decide("com", gid, true)]);
      expect([a.status, b.status].sort((x, y) => x - y), `${a.text} | ${b.text}`).toEqual([200, 409]);
      expect((await audits(gid)).filter((x) => x.action === "APPROVE").length).toBe(1);
      expect((await live_("out"))!.status).toBe("APPROVED");
    });
    it("a decided request cannot be decided again (approve or reject => 409)", async () => {
      expect((await decide("aud", gid, true)).status).toBe(409);
      expect((await decide("com", gid, false, "Trop tard")).status).toBe(409);
    });
    it("the grant content is immutable and rows are never deleted (PostgreSQL guard): kind, user, reason, DELETE all refused", async () => {
      await expect(sql("UPDATE sensitive_view_grants SET kind = 'ROLE_READ_SENSITIVE' WHERE id = $1", [gid])).rejects.toThrow(/immutable/);
      await expect(sql("UPDATE sensitive_view_grants SET user_id = $2 WHERE id = $1", [gid, UID.n1])).rejects.toThrow(/immutable/);
      await expect(sql("DELETE FROM sensitive_view_grants WHERE id = $1", [gid])).rejects.toThrow(/never deleted/);
      await expect(sql("UPDATE sensitive_view_grants SET status = 'PENDING' WHERE id = $1", [gid])).rejects.toThrow(/forbidden transition/);
    });
  });

  // ------------------------------------------------------------------------------------------------ EFFECT
  describe("effect of an APPROVED resource.readall (beneficiary = out)", () => {
    it("GRANT badge in the effective sources; also in /roles/users/:id/permissions; nobody else has it; no role carries it", async () => {
      expect(await hasBadge("out")).toEqual(["GRANT"]);
      expect(((await get("adm", `/roles/users/${UID.out}/permissions`)).json.data as { permissions?: string[] } | string[])).toBeTruthy();
      for (const w of ["n1", "raci", "own", "rm", "com", "aud", "adm"] as const) expect(await hasBadge(w), w).toBeUndefined();
      const matrix = (await get("adm", "/roles/matrix")).json.data as Array<{ permissions: string[] }>;
      expect(matrix.some((r) => r.permissions.includes("resource.readall"))).toBe(false);
      expect(JSON.stringify((await get("adm", `/roles/users/${UID.out}/permissions`)).json.data)).toContain("resource.readall");
    });
    it("DECISION-111 q219: reads every PERIMETRE content, never NOMINATIF — what the Risk Manager lists and out does not is NOMINATIF (effective level), c03 stays 404", async () => {
      expect(await probe("out")).toBe(200);
      expect((await get("out", `/controls/${I("c03")}`)).status).toBe(404); // NOMINATIF, listed to `named` only
      for (const b of BASES) {
        const rm = idsOf(await get("rm", `/${b}`));
        const out = idsOf(await get("out", `/${b}`));
        expect(rm.length, b).toBeGreaterThan(0);
        expect(out.every((id) => rm.includes(id)), b).toBe(true);
        for (const id of rm.filter((x) => !out.includes(x))) {
          expect((await sql<{ v: string }>(`SELECT ${EFFECTIVE[b]} AS v`, [id, I("001")]))[0]!.v, `${b}/${id}`).toBe("NOMINATIF");
        }
        for (const id of out) expect((await get("out", `/${b}/${id}`)).status, `${b}/${id}`).toBe(200);
      }
    });
    it("DECISION-111 q219: hidden counts are normal numbers (no PERIMETRE hidden left), and the restricted list stays the A1 metadata view (fixed groups only)", async () => {
      const counts = (await get("out", "/hidden-counts")).json.data as Record<string, number>;
      expect(counts).not.toBeNull();
      expect(Object.values(counts).every((n) => n === 0)).toBe(true);
      const out = (await get("out", "/restricted-resources?limit=500")).json.data as Array<Record<string, unknown>>;
      for (const row of out) expect(Object.keys(row).sort((a, b) => a.localeCompare(b))).toEqual(["accessCount", "id", "type", "updatedAt", "visibility"]);
      expect(out.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x.updatedAt)))).toBe(true); // q223: the date only
    });
    it("DECISION-111 q220: a unitary read owed to the right writes one READ row (grant, no content); a list writes one row with the count; RM reads write nothing", async () => {
      const gid = (await live_("out"))!.id;
      const before = (await audits(I("c04"))).filter((a) => a.action === "READ").length;
      expect(await probe("out")).toBe(200);
      const rows = (await audits(I("c04"))).filter((a) => a.action === "READ");
      expect(rows.length).toBe(before + 1);
      expect(rows.at(-1)).toMatchObject({ entity_type: "Control", user_id: UID.out, new_value: { through: "RESOURCE_READALL", grantId: gid } });
      const listRows = async () => (await audits(gid)).filter((a) => a.action === "READ");
      const n = (await listRows()).length;
      expect((await get("out", "/controls")).status).toBe(200);
      // SEC V4-03: one list row per restrictable root the response names (the controls, and the covered risks it opens), with the ids
      const added = (await listRows()).slice(n);
      expect(added.filter((r) => r.new_value.list === "CONTROL")).toHaveLength(1);
      expect(added.find((r) => r.new_value.list === "CONTROL")!.new_value.ids).toContain(I("c04"));
      expect(await probe("rm")).toBe(200);
      expect((await audits(I("c04"))).filter((a) => a.action === "READ").length).toBe(before + 1);
    });
    it("it is a reading right only: the beneficiary still cannot change a visibility (403/404) nor read the Audit log", async () => {
      expect([403, 404]).toContain((await put("out", `/controls/${I("c03")}/visibility`, { visibility: "CLIENT", addUserIds: [], revokeUserIds: [], reason: "QA" })).status);
      expect((await get("out", "/audit-log")).status).toBe(403);
    });
    it("an administrator without the right (adm, raci) is unaffected by the grant of someone else", async () => {
      expect(await probe("raci")).toBe(404);
      expect(await probe("adm")).toBe(404);
      expect((await get("raci", "/restricted-resources")).json.data[0]).not.toHaveProperty("label");
    });
    it("the grant is listed under its kind only; the default list (role.read.sensitive) stays empty; both lists are closed to non-administrators", async () => {
      expect(((await get("adm", `${BASE}?kind=${READALL}`)).json.data as Array<{ kind: string }>).every((g) => g.kind === READALL)).toBe(true);
      expect((await get("adm", BASE)).json.data).toEqual([]);
      expect((await get("com", `${BASE}?kind=${READALL}`)).status).toBe(200); // confirmers see requests
      expect((await get("dept", `${BASE}?kind=${READALL}`)).status).toBe(403);
      expect((await get("adm", `${BASE}?kind=ADMIN`)).status).toBe(400);
    });
    it("q202: the beneficiary, now reading everything, can request for others (he is an administrator) but never confirm", async () => {
      expect((await decide("out", (await ask("out", "n1")).json.data.id, true)).status).toBe(403);
      const g = (await live_("n1"))!;
      expect((await revoke("adm", g.id, "Nettoyage QA")).status).toBe(200);
    });
  });

  // ------------------------------------------------------------------------------------------------ END OF THE RIGHT
  describe("end of the right", () => {
    it("revocation needs a reason (400), is audited (UNASSIGN + reason), takes effect at once; a second revocation is 409; a non-administrator gets 403", async () => {
      const gid = (await live_("out"))!.id;
      for (const bad of ["", "   ", null, "x".repeat(501)]) expect((await revoke("adm", gid, bad)).status, JSON.stringify(bad)).toBe(400);
      expect((await revoke("dept", gid)).status).toBe(403);
      expect(await probe("out")).toBe(200);
      expect((await revoke("adm", gid, "Incident clos")).status).toBe(200);
      expect(await probe("out")).toBe(404);
      expect(await hasBadge("out")).toBeUndefined();
      expect((await get("out", "/hidden-counts")).json.data).not.toBeNull();
      expect((await audits(gid)).filter((a) => a.action === "UNASSIGN")[0]).toMatchObject({ reason: "Incident clos", user_id: UID.adm });
      expect((await revoke("adm", gid)).status).toBe(409);
      expect((await decide("aud", gid, true)).status).toBe(409); // a revoked request is not resurrected by a late confirmation
    });
    it("a failing audit write rolls the revocation back: the right stays in force", async () => {
      const id = await grant("out");
      await failAudit("UNASSIGN");
      try { expect((await revoke("adm", id)).status).toBeGreaterThanOrEqual(500); } finally { await restoreAudit(); }
      expect((await live_("out"))!.status).toBe("APPROVED");
      expect(await probe("out")).toBe(200);
      expect((await revoke("adm", id, "Fin du test")).status).toBe(200);
    });
    it("a refusal leaves no right; a new request after a refusal is possible", async () => {
      const g = await ask("adm", "out");
      expect((await decide("com", g.json.data.id, false, "Besoin non justifié")).status).toBe(200);
      expect(await probe("out")).toBe(404);
      expect((await audits(g.json.data.id)).filter((a) => a.action === "REJECT")[0]).toMatchObject({ reason: "Besoin non justifié" });
      expect((await ask("adm", "out")).status).toBe(201);
      expect((await revoke("adm", (await live_("out"))!.id, "Nettoyage QA")).status).toBe(200);
    });
    it("suspension of the beneficiary ends the right for good (REVOKED, audited); reactivation does not bring it back", async () => {
      const id = await grant("raci");
      expect(await probe("raci")).toBe(200);
      const s = await call("adm", "PATCH", `/users/${UID.raci}/suspend`, { reason: "Départ" });
      expect(s.status, s.text).toBe(200);
      expect((await grantRows("raci")).at(-1)!.status).toBe("REVOKED");
      expect((await audits(id)).filter((a) => a.action === "UNASSIGN").length).toBe(1);
      expect((await call("adm", "PATCH", `/users/${UID.raci}/reactivate`, { reason: "Retour" })).status).toBe(200);
      expect(await hasBadge("raci")).toBeUndefined();
      expect(await probe("raci")).toBe(404);
    });
    it("losing the LAST administrator role ends the right for good; losing one of two does not", async () => {
      const id = await grant("own"); // own holds QA Admins and QA Admins 2
      expect(await probe("own")).toBe(200);
      const r1 = await post("adm", `/roles/${R_ADMIN}/revoke`, { userId: UID.own, reason: "Changement de poste" });
      expect(r1.status, r1.text).toBe(200);
      expect((await live_("own"))?.status, "still administrator through the second role").toBe("APPROVED");
      expect(await probe("own")).toBe(200);
      const r2 = await post("adm", `/roles/${R_ADMIN2}/revoke`, { userId: UID.own, reason: "Changement de poste" });
      expect(r2.status, r2.text).toBe(200);
      expect((await grantRows("own")).at(-1)!.status).toBe("REVOKED");
      expect((await audits(id)).filter((a) => a.action === "UNASSIGN").length).toBe(1);
      expect(await probe("own")).toBe(404);
      await assign(R_ADMIN, "own"); // administrator again: nothing comes back
      expect(await probe("own")).toBe(404);
      expect(await hasBadge("own")).toBeUndefined();
    });
    it("role stripped of every administration right: no effect at once (the SQL rule needs a current administrator)", async () => {
      const id = await grant("n1");
      expect(await probe("n1")).toBe(200);
      expect((await put("adm", `/roles/${R_ADMIN}`, {})).status).toBeGreaterThanOrEqual(400); // PUT not offered
      const strip = await call("adm", "PATCH", `/roles/${R_ADMIN}`, { permissions: ["risk.read"] });
      expect(strip.status, strip.text).toBe(200);
      expect(await probe("n1"), "no administration right left").toBe(404);
      expect(await hasBadge("n1"), "no badge either").toBeUndefined();
      expect(id).toBeTruthy();
    });
    // QA-V4-01: the spec says the right ends at the loss of the last administrator role = ends for good (a new request and a new confirmation are needed).
    // Today only revokeFromUser / suspension end the grant: stripping the role then restoring it brings the right back, with no new confirmation.
    it("QA-V4-01: restoring the administration rights of the role must NOT revive the right confirmed earlier", async () => {
      try {
        const restore = await call("adm", "PATCH", `/roles/${R_ADMIN}`, { permissions: ["role.assign", "role.read", "user.update"] });
        expect(restore.status, restore.text).toBe(200);
        expect(await probe("n1")).toBe(404);
        expect((await live_("n1"))?.status ?? "ENDED").not.toBe("APPROVED");
      } finally {
        await sql("UPDATE sensitive_view_grants SET status = 'REVOKED', revoked_by = $2, revoked_at = now(), revoke_reason_ref = (SELECT v.id FROM visibility_reasons v WHERE v.tenant_id = sensitive_view_grants.tenant_id ORDER BY v.created_at LIMIT 1) WHERE user_id = $1 AND status IN ('PENDING', 'APPROVED')", [UID.n1, UID.adm]);
      }
    });
  });

  // ------------------------------------------------------------------------------------------------ NEVER ON A ROLE
  describe("never on a role", () => {
    it("POST /roles and PATCH /roles/:id with resource.readall (and role.read.sensitive) are refused (400), nothing stored", async () => {
      for (const p of ["resource.readall", "role.read.sensitive"]) {
        expect((await post("adm", "/roles", { name: `Lecteur ${p}`, permissions: ["risk.read", p] })).status, p).toBe(400);
        expect((await call("adm", "PATCH", `/roles/${R_PLAIN}`, { permissions: ["risk.read", p] })).status, p).toBe(400);
      }
      expect((await sql("SELECT count(*)::int AS n FROM roles WHERE 'resource.readall' = ANY(permissions)"))[0]).toEqual({ n: 0 });
    });
    it("the fixed groups never carry it either (Audit permissions endpoint, governance rights endpoint)", async () => {
      expect((await call("adm", "PUT", "/roles/audit-group/permissions", { permissions: ["audit.read", "resource.readall"], reason: "QA" })).status).toBeGreaterThanOrEqual(400);
      expect((await sql("SELECT count(*)::int AS n FROM roles WHERE 'resource.readall' = ANY(permissions)"))[0]).toEqual({ n: 0 });
    });
  });

  // ------------------------------------------------------------------------------------------------ q200 NON REGRESSION
  describe("non-regression q200: kind ROLE_READ_SENSITIVE unchanged", () => {
    it("default kind: request for a Risk Manager member, confirmed by Audit, role.read.sensitive badge on the member; no resource.readall effect; ends on leaving the group", async () => {
      const r = await post("adm", BASE, { userId: UID.rm, reason: "Lecture élargie des droits" });
      expect(r.status, r.text).toBe(201);
      expect(r.json.data.kind ?? "ROLE_READ_SENSITIVE").toBe("ROLE_READ_SENSITIVE");
      expect((await decide("aud", r.json.data.id, true)).status).toBe(200);
      const rm = ((await get("adm", `/roles/users/${UID.rm}/permission-sources`)).json.data as Array<{ permission: string }>).map((p) => p.permission);
      expect(rm).toContain("role.read.sensitive");
      expect(rm).not.toContain("resource.readall");
      expect(((await get("adm", BASE)).json.data as Array<{ id: string }>).map((g) => g.id)).toContain(r.json.data.id);
      expect(((await get("adm", `${BASE}?kind=${READALL}`)).json.data as Array<{ id: string }>).map((g) => g.id)).not.toContain(r.json.data.id);
      expect((await revoke("adm", r.json.data.id, "Fin")).status).toBe(200);
    });
    it("explicit kind ROLE_READ_SENSITIVE for an administrator who is not a Risk Manager member: 400; and a RM member cannot be the beneficiary of a RESOURCE_READALL request", async () => {
      expect((await post("adm", BASE, { userId: UID.out, reason: "x", kind: "ROLE_READ_SENSITIVE" })).status).toBe(400);
      expect((await ask("adm", "rm")).status).toBe(400);
    });
    it("a live grant of one kind does not block the other kind for another person and leaves the other list untouched", async () => {
      const rmReq = await post("adm", BASE, { userId: UID.rm, reason: "Lecture élargie" });
      const roReq = await ask("adm", "out");
      expect([rmReq.status, roReq.status]).toEqual([201, 201]);
      expect((await get("adm", BASE)).json.data.filter((g: { status: string }) => g.status === "PENDING").length).toBe(1);
      expect((await get("adm", `${BASE}?kind=${READALL}`)).json.data.filter((g: { status: string }) => g.status === "PENDING").length).toBe(1);
      for (const g of [rmReq, roReq]) expect((await revoke("adm", g.json.data.id, "Nettoyage QA")).status).toBe(200);
    });
    it("edge: a beneficiary with a live RESOURCE_READALL who is later made Risk Manager can still be asked a role.read.sensitive grant without a server error", async () => {
      const id = await grant("out");
      const rmRole = (await sql<{ id: string }>("SELECT id FROM roles WHERE system_group = 'RISK_MANAGER'"))[0]!.id;
      await assign(rmRole, "out");
      try {
        const r = await post("adm", BASE, { userId: UID.out, reason: "Lecture élargie" });
        expect(r.status, r.text).toBeLessThan(500);
      } finally {
        await unassign(rmRole, "out");
        await sql("UPDATE sensitive_view_grants SET status = 'REVOKED', revoked_by = $2, revoked_at = now(), revoke_reason_ref = (SELECT v.id FROM visibility_reasons v WHERE v.tenant_id = sensitive_view_grants.tenant_id ORDER BY v.created_at LIMIT 1) WHERE user_id = $1 AND status IN ('PENDING', 'APPROVED')", [UID.out, UID.adm]);
      }
      expect(id).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------------------------------------ q215
  describe("q215 A: 140-character preview of the reason in the restricted list", () => {
    const setReason = async (reason: string, to: "PERIMETRE" | "CLIENT") => {
      const r = await put("rm", `/controls/${I("c01")}/visibility`, { visibility: to, addUserIds: [], revokeUserIds: [], reason });
      expect(r.status, r.text).toBe(200);
      return ((await get("rm", "/restricted-resources?limit=500")).json.data as Array<{ id: string; lastChange: { reason: string | null } | null }>).find((x) => x.id === I("c01"));
    };
    it("139 and 140 characters are kept whole; 141 and 500 are cut to 140 characters ending with an ellipsis; the audit keeps the full text", async () => {
      expect((await setReason("a".repeat(139), "PERIMETRE"))!.lastChange!.reason).toBe("a".repeat(139));
      expect((await setReason("b".repeat(140), "CLIENT"))).toBeUndefined(); // CLIENT again: leaves the list
      expect((await setReason("c".repeat(140), "PERIMETRE"))!.lastChange!.reason).toBe("c".repeat(140));
      const cut = (await setReason("d".repeat(141), "CLIENT"), (await setReason("e".repeat(141), "PERIMETRE"))!.lastChange!.reason!);
      expect(cut.length).toBe(140);
      expect(cut.endsWith("…")).toBe(true);
      expect(cut).toBe(`${"e".repeat(139)}…`);
      await setReason("f".repeat(500), "CLIENT");
      const long = (await setReason("g".repeat(500), "PERIMETRE"))!.lastChange!.reason!;
      expect([...long].length).toBe(140);
      const full = (await audits(I("c01"))).filter((a) => a.action === "PERMISSION_CHANGE" || a.reason?.startsWith("g")).map((a) => a.reason);
      expect(full).toContain("g".repeat(500));
    });
    it("the same preview for every reader of the full list (Risk Manager, Committee, Audit), never the raw 500 characters; the readall beneficiary gets no reason (DECISION-111 q219, A1 view)", async () => {
      const id = await grant("out");
      expect(JSON.stringify((await get("out", "/restricted-resources?limit=500")).json.data)).not.toContain("lastChange");
      for (const w of ["rm", "com", "aud"] as const) {
        const row = ((await get(w, "/restricted-resources?limit=500")).json.data as Array<{ id: string; lastChange: { reason: string } | null }>).find((x) => x.id === I("c01"))!;
        expect(row.lastChange!.reason.length, w).toBe(140);
      }
      expect((await revoke("adm", id, "Fin du test")).status).toBe(200);
    });
    it("a null reason stays null (no « null… »), an empty list page is still []", async () => {
      expect((await get("rm", "/restricted-resources?offset=100000")).json.data).toEqual([]);
    });
    it("(QA-V4-02) the cut never splits an astral character: no lone surrogate in the preview", async () => {
      await setReason("h".repeat(10), "CLIENT");
      const row = await setReason(`${"é".repeat(138)}😀${"x".repeat(50)}`, "PERIMETRE");
      const text = row!.lastChange!.reason!;
      expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      expect([...text].length).toBeLessThanOrEqual(140);
    });
  });
});
