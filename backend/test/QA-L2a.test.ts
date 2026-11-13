import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BAD_REASONS, qaVisibilityHarness } from "./qaVisibilityHarness.js";

/**
 * QA-L2a (lot R1 « Conservation L2a », migration 096, head 7dd3b27): the text of a visibility reason lives in `visibility_reasons`,
 * the journal and the grant tables carry references. Oracles written BEFORE running, from the cadrage 8.4 L2a and CLAUDE.md
 * (« The text of a visibility reason never goes in audit_log.reason »):
 *  - no write path leaves the text of a visibility reason anywhere but in visibility_reasons (journal reason, old/new snapshots, grant
 *    columns, any other table: a row-by-row scan of every public table for a canary text);
 *  - a shared reason (one action, several rows) is ONE motif, referenced by every row that names it;
 *  - an error after the motif insert leaves no orphan motif, no grant, no journal row;
 *  - an erased motif reads « motif effacé le JJ/MM/AAAA (conservation) » through every reader, and the text is never served again;
 *  - PRIV-L2A-01: when a perimeter AND a Dispositif change together, and when a cumul reason is also an opening reason, the extra
 *    journal row carries the same reference, not the text; a Dispositif move alone and a role reason outside visibility stay in clear.
 * Not a Security / Privacy / Compliance opinion. Live part: QA_L2A_LIVE=1 + LOCAL cluster (127.0.0.1:55442), own base grc_qa_l2at
 * (rebuilt): run with --no-file-parallelism. `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 */
const SRC = join(__dirname, "..", "src");
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const rel = (f: string) => f.slice(SRC.length + 1).split("\\").join("/");

describe("QA-L2a (static): independent inventory of the writers of a visibility reason", () => {
  const files = walk(SRC).filter((f) => f.endsWith(".ts"));

  it("only these files name a stored reason (visibilityReasonOf, insertVisibilityReason, a *_reason_ref column)", () => {
    const named = files
      .filter((f) => /visibilityReasonOf\(|insertVisibilityReason\(|reason_ref|reasonRef/.test(readFileSync(f, "utf8")))
      .map(rel)
      .sort((a, b) => a.localeCompare(b));
    expect(named).toEqual([
      "domain/entities/AuditEvent.ts",
      "domain/entities/VisibilityReason.ts",
      "domain/repositories/SensitiveViewGrantRepository.ts",
      "infrastructure/database/postgres/PostgresAuditRepository.ts",
      "infrastructure/database/postgres/PostgresResourceAccessRepository.ts",
      "infrastructure/database/postgres/PostgresRiskRepository.ts",
      "infrastructure/database/postgres/PostgresSensitiveViewGrantRepository.ts",
      "infrastructure/database/postgres/visibilityReasons.ts",
      "services/ProcessService.ts",
      "services/RaciAssignmentService.ts",
      "services/resourceVisibility.ts",
      "services/RiskService.ts",
      "services/RoleService.ts",
    ]);
  });

  it("every SQL writer of resource_access_grants / sensitive_view_grants writes a reference, except the creation constant of a risk", () => {
    const writers = files.filter((f) => /(UPDATE|INSERT INTO)\s+(resource_access_grants|sensitive_view_grants)/.test(readFileSync(f, "utf8")));
    expect(writers.map(rel).sort((a, b) => a.localeCompare(b))).toEqual([
      "infrastructure/database/postgres/namedAccess.ts", // expiry only (087 / 094): no reason column
      "infrastructure/database/postgres/PostgresResourceAccessRepository.ts",
      "infrastructure/database/postgres/PostgresRiskRepository.ts",
      "infrastructure/database/postgres/PostgresSensitiveViewGrantRepository.ts",
    ]);
    for (const f of writers) {
      const src = readFileSync(f, "utf8");
      // the only clear-text reason column ever assigned is the technical constant of a risk creation (PostgresRiskRepository)
      const clear = [...src.matchAll(/(?:grant_reason|revoke_reason|decision_reason)\s*=\s*\$/g)].length;
      // PostgresRiskRepository reads the creation constant back (`AND grant_reason = $3`, listCreationAccess): one occurrence, a SELECT
      expect(clear, rel(f)).toBe(rel(f).endsWith("PostgresRiskRepository.ts") ? 1 : 0);
    }
    expect(readFileSync(join(SRC, "infrastructure/database/postgres/PostgresRiskRepository.ts"), "utf8")).toMatch(/Accès accordé à la création du risque/);
  });

  it("the oracles A06 realigned still demand the text through the reference: no `COALESCE(reason, …)` in the strict suites (the harness one is covered by the leak scan below)", () => {
    for (const f of ["QA-visibility-v1.test.ts"]) {
      expect(readFileSync(join(__dirname, f), "utf8"), f).toMatch(/reason: null, reason_text:/);
    }
  });
});

const live = process.env["QA_L2A_LIVE"] === "1";
const DB = "grc_qa_l2at";
const PORT = 8114;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
const R502 = I("502"), R503 = I("503"), R501 = I("501");
const FIN_ROLE = I("301");
const R_ADMIN = I("311"), R_ADMCOM = I("312");
const FW1 = I("f01"), FW2 = I("f02");
const P2 = I("402"), P3 = I("403");
const CANARY = "CANARY-L2A-";
const GONE = /^motif effacé le \d{2}\/\d{2}\/\d{4} \(conservation\)$/;

const H = qaVisibilityHarness({ db: DB, port: PORT, who: WHO, uid: UID });
const { sql, call, get, post, put } = H;
const setVis = (w: Who, path: string, visibility: string, add: string[], reason: unknown, revoke: string[] = []) => put(w, `${path}/visibility`, { visibility, addUserIds: add, revokeUserIds: revoke, reason });
type Counts = { reasons: number; audit: number; rag: number; svg: number };
const counts = async (): Promise<Counts> => ({
  reasons: (await sql<{ n: number }>("SELECT count(*)::int AS n FROM visibility_reasons"))[0]!.n,
  audit: (await sql<{ n: number }>("SELECT count(*)::int AS n FROM audit_log"))[0]!.n,
  rag: (await sql<{ n: number }>("SELECT count(*)::int AS n FROM resource_access_grants"))[0]!.n,
  svg: (await sql<{ n: number }>("SELECT count(*)::int AS n FROM sensitive_view_grants"))[0]!.n,
});
const motifs = (text: string) => sql<{ id: string; source: string; text: string | null }>("SELECT id, source, text FROM visibility_reasons WHERE text = $1", [text]);
const auditRefs = (text: string) => sql<{ id: string; action: string; entity_type: string; reason: string | null; reason_ref: string | null; old_value: unknown; new_value: unknown }>(
  `SELECT a.id, a.action, a.entity_type, a.reason, a.reason_ref, a.old_value, a.new_value FROM audit_log a
   WHERE a.reason_ref IN (SELECT id FROM visibility_reasons WHERE text = $1) OR a.reason = $1 ORDER BY a."timestamp", a.id`, [text]);
/** Every public table, row by row: where does this text appear? Only visibility_reasons may answer. */
const whereIs = async (needle: string): Promise<string[]> => {
  const tables = (await sql<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).map((t) => t.tablename);
  const hits: string[] = [];
  for (const t of tables) {
    const n = (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "${t}" WHERE "${t}"::text LIKE $1`, [`%${needle}%`]))[0]!.n;
    if (n > 0) hits.push(`${t}:${n}`);
  }
  return hits;
};
const failAudit = async () => {
  await sql("CREATE OR REPLACE FUNCTION qa_l2a_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason_ref IS NOT NULL THEN RAISE EXCEPTION 'qa audit failure'; END IF; RETURN NEW; END $$");
  await sql("DROP TRIGGER IF EXISTS qa_l2a_fail ON audit_log");
  await sql("CREATE TRIGGER qa_l2a_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_l2a_fail_audit()");
};
const restoreAudit = () => sql("DROP TRIGGER IF EXISTS qa_l2a_fail ON audit_log");
const BASE = "/roles/sensitive-view-grants";
const ask = (by: Who, whom: Who, reason: unknown) => post(by, BASE, { userId: UID[whom], reason, kind: "RESOURCE_READALL" });
const decide = (by: Who, gid: string, ok: boolean, reason?: string) => post(by, `${BASE}/${gid}/${ok ? "approve" : "reject"}`, reason === undefined ? {} : { reason });
const revoke = (by: Who, gid: string, reason: unknown) => post(by, `${BASE}/${gid}/revoke`, { reason });

describe.skipIf(!live)("QA-L2a on the REAL server + LOCAL PostgreSQL 16 (head 7dd3b27)", () => {
  beforeAll(() => H.start(async () => {
    await sql("UPDATE users SET roles = roles || ARRAY['execution.read','effectiveness.read','evidence.read']::text[]");
    await sql("UPDATE users SET roles = array_remove(roles, 'resourcevisibility.set') WHERE email = 'adm@vv1.test'");
    await sql("UPDATE users SET roles = roles || ARRAY['role.assign','role.read','role.create','role.update','user.update']::text[] WHERE email = 'adm@vv1.test'");
    await sql("UPDATE users SET roles = roles || ARRAY['risk.owner.assign']::text[] WHERE email IN ('own@vv1.test','dept@vv1.test')");
    await sql("UPDATE users SET roles = roles || ARRAY['raci.assign']::text[] WHERE email = 'own@vv1.test'");
    // administrators by ROLE (resource.readall requests are for administrators): n1, out
    await sql("INSERT INTO roles (id, tenant_id, name, permissions) VALUES ($1, $3, 'QA L2a Admins', '{role.assign,role.read,user.update}'), ($2, $3, 'QA L2a AdminCommittee', '{user.update,riskevaluation.validate.committee}')", [R_ADMIN, R_ADMCOM, I("001")]);
    for (const w of ["n1", "out"] as const) await sql("INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)", [I("001"), R_ADMIN, UID[w], UID.adm]);
    // the Finance group role also carries administrator + Committee powers: assigning it creates a cumul AND opens Finance PERIMETRE resources
    await sql("UPDATE roles SET permissions = permissions || ARRAY['user.update','riskevaluation.validate.committee']::text[] WHERE id = $1", [FIN_ROLE]);
    // two Dispositifs, three processes: 401 -> FW1, P2 -> FW2, P3 -> FW2 (same Dispositif as P2)
    for (const [f, n] of [[FW1, "QA L2a F1"], [FW2, "QA L2a F2"]] as const) await sql("INSERT INTO risk_frameworks (id, tenant_id, name, created_by) VALUES ($1, $2, $3, $4)", [f, I("001"), n, UID.rm]);
    for (const [p, n] of [[P2, "Processus L2a 2"], [P3, "Processus L2a 3"]] as const) await sql("INSERT INTO processes (id, tenant_id, level, name, department_id) VALUES ($1, $2, 'PROCESS', $3, $4)", [p, I("001"), n, I("201")]);
    await sql("ALTER TABLE processes DISABLE TRIGGER processes_framework_guard");
    try {
      for (const [p, f] of [[I("401"), FW1], [P2, FW2], [P3, FW2]] as const) await sql("UPDATE processes SET risk_framework_id = $2 WHERE id = $1", [p, f]);
    } finally { await sql("ALTER TABLE processes ENABLE TRIGGER processes_framework_guard"); }
  }), 280000);
  afterAll(() => H.stop());

  it("the data set is what the oracles assume: no motif yet, the Dispositifs are attached", async () => {
    expect((await counts()).reasons).toBe(0);
    expect((await sql<{ f: string | null }>("SELECT risk_framework_id AS f FROM processes WHERE id = $1", [I("401")]))[0]!.f).toBe(FW1);
  });

  // ------------------------------------------------------------------------------------------------ one shared motif per action
  describe("SHARED: one action, one motif, referenced by every row that names it", () => {
    it("designation (owner) that opens a restricted risk: the ASSIGN row and the PERMISSION_CHANGE row share ONE motif", async () => {
      const reason = `${CANARY}DESIGNATION`;
      const r = await post("dept", `/risks/${R502}/owner`, { ownerId: UID.out2, reason });
      expect(r.status, r.text).toBe(200);
      const m = await motifs(reason);
      expect(m).toHaveLength(1);
      const rows = await auditRefs(reason);
      expect(rows.map((x) => x.action).sort((a, b) => a.localeCompare(b))).toEqual(["ASSIGN", "PERMISSION_CHANGE"]);
      expect(rows.every((x) => x.reason === null && x.reason_ref === m[0]!.id)).toBe(true);
    });

    it("PUT /risks/:id/visibility adding three people: ONE motif, one journal row by reference, three grants by the same reference", async () => {
      const reason = `${CANARY}SET-3-people`;
      const c0 = await counts();
      const r = await setVis("rm", `/risks/${R502}`, "NOMINATIF", [UID.raci, UID.out, UID.out2], reason);
      expect(r.status, r.text).toBe(200);
      const m = await motifs(reason);
      expect(m).toHaveLength(1);
      expect(m[0]!.source).toBe("VISIBILITY_CHANGE");
      const rows = await auditRefs(reason);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "PERMISSION_CHANGE", reason: null, reason_ref: m[0]!.id });
      const g = await sql<{ grant_reason: string | null; grant_reason_ref: string | null }>("SELECT grant_reason, grant_reason_ref FROM resource_access_grants WHERE resource_id = $1 AND grant_reason_ref = $2", [R502, m[0]!.id]);
      expect(g).toHaveLength(3);
      expect(g.every((x) => x.grant_reason === null && x.grant_reason_ref === m[0]!.id)).toBe(true);
      const c1 = await counts();
      expect([c1.reasons - c0.reasons, c1.audit - c0.audit, c1.rag - c0.rag]).toEqual([1, 1, 3]);
    });

    it("revoking one person: ONE new motif shared by the journal row and the revoked grant; the grant keeps its original motif", async () => {
      const reason = `${CANARY}REVOKE-1`;
      const before = (await sql<{ grant_reason_ref: string }>("SELECT grant_reason_ref FROM resource_access_grants WHERE resource_id = $1 AND user_id = $2", [R502, UID.out]))[0]!.grant_reason_ref;
      const r = await setVis("rm", `/risks/${R502}`, "NOMINATIF", [], reason, [UID.out]);
      expect(r.status, r.text).toBe(200);
      const m = await motifs(reason);
      expect(m).toHaveLength(1);
      const g = (await sql<{ revoke_reason: string | null; revoke_reason_ref: string | null; grant_reason_ref: string }>("SELECT revoke_reason, revoke_reason_ref, grant_reason_ref FROM resource_access_grants WHERE resource_id = $1 AND user_id = $2", [R502, UID.out]))[0]!;
      expect(g).toEqual({ revoke_reason: null, revoke_reason_ref: m[0]!.id, grant_reason_ref: before });
      expect((await auditRefs(reason))[0]).toMatchObject({ reason: null, reason_ref: m[0]!.id });
    });

    it("renewal (ACCESS_RENEWAL) on a risk and a control change (resource manager): by reference, source recorded", async () => {
      const renewal = `${CANARY}RENEW`;
      const r = await call("rm", "POST", `/risks/${R502}/visibility/renew`, { userIds: [UID.named, UID.out2], reason: renewal });
      expect(r.status, r.text).toBe(200);
      expect((await motifs(renewal))[0]).toMatchObject({ source: "ACCESS_RENEWAL" });
      expect((await auditRefs(renewal))[0]).toMatchObject({ reason: null });
      const control = `${CANARY}CONTROL-SET`;
      const c = await setVis("rm", `/controls/${I("c02")}`, "NOMINATIF", [UID.named], control);
      expect(c.status, c.text).toBe(200);
      expect((await motifs(control))).toHaveLength(1);
      expect((await auditRefs(control))[0]).toMatchObject({ reason: null, entity_type: "Control" });
    });

    it("RACI opening: both rows share ONE motif", async () => {
      const reason = `${CANARY}RACI`;
      const r = await post("own", "/raci", { entityType: "ACTION_PLAN", entityId: I("a06"), userId: UID.out2, role: "C", reason });
      expect(r.status, r.text).toBe(201);
      const m = await motifs(reason);
      expect(m).toHaveLength(1);
      const rows = await auditRefs(reason);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((x) => x.reason === null && x.reason_ref === m[0]!.id)).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------------------ PRIV-L2A-01 (a) and (b)
  describe("PRIV-L2A-01 (b): perimeter AND Dispositif change together (PATCH /risks/:id)", () => {
    it("the Dispositif-move row, the perimeter row and the update row carry the SAME reference; no journal row holds the text", async () => {
      const reason = `${CANARY}PERIMETER-AND-DISPOSITIF`;
      const c0 = await counts();
      const r = await call("rm", "PATCH", `/risks/${R502}`, { processId: P2, reason });
      expect(r.status, r.text).toBe(200);
      const m = await motifs(reason);
      expect(m).toHaveLength(1);
      expect(m[0]!.source).toBe("PERIMETER_CHANGE");
      const rows = await auditRefs(reason);
      expect(rows.every((x) => x.reason === null)).toBe(true); // nothing in clear
      expect(rows.every((x) => x.reason_ref === m[0]!.id)).toBe(true);
      expect(await sql("SELECT 1 FROM audit_log WHERE reason LIKE $1", [`%${reason}%`])).toHaveLength(0);
      const move = rows.find((x) => x.action === "UPDATE" && JSON.stringify(x.new_value).includes("frameworkChanged"));
      expect(move, JSON.stringify(rows.map((x) => [x.action, x.new_value]))).toBeTruthy();
      expect(move!.new_value).toMatchObject({ frameworkChanged: true, riskFrameworkId: FW2 });
      expect(rows.some((x) => x.action === "PERMISSION_CHANGE")).toBe(true);
      expect((await counts()).reasons - c0.reasons).toBe(1); // one motif for the three rows
      expect(await whereIs(reason)).toEqual(["visibility_reasons:1"]);
    });

    it("perimeter change with the SAME Dispositif (P2 -> P3, both on F2): the move row carries no reason at all, the perimeter row the reference", async () => {
      const reason = `${CANARY}PERIMETER-SAME-DISPOSITIF`;
      const r = await call("rm", "PATCH", `/risks/${R502}`, { processId: P3, reason });
      expect(r.status, r.text).toBe(200);
      const m = await motifs(reason);
      expect(m).toHaveLength(1);
      const all = await sql<{ action: string; reason: string | null; reason_ref: string | null; new_value: any }>( // eslint-disable-line @typescript-eslint/no-explicit-any
        "SELECT action, reason, reason_ref, new_value FROM audit_log WHERE entity_id = $1 ORDER BY \"timestamp\" DESC, id LIMIT 3", [R502]);
      const move = all.find((x) => x.new_value && "frameworkChanged" in x.new_value)!;
      expect(move).toMatchObject({ reason: null, reason_ref: null });
      expect(move.new_value.frameworkChanged).toBe(false);
      expect(all.some((x) => x.action === "PERMISSION_CHANGE" && x.reason === null && x.reason_ref === m[0]!.id)).toBe(true);
      expect(await whereIs(reason)).toEqual(["visibility_reasons:1"]);
    });

    it("Dispositif move ALONE (unrestricted risk 501, P2 -> other Dispositif): the move row keeps its own reason in clear, no visibility motif (outside L2a)", async () => {
      const reason = "Déplacement de Dispositif QA L2a (hors visibilité)";
      const c0 = await counts();
      const r = await call("rm", "PATCH", `/risks/${R501}`, { processId: P2, reason });
      expect(r.status, r.text).toBe(200);
      const rows = await sql<{ reason: string | null; reason_ref: string | null }>("SELECT reason, reason_ref FROM audit_log WHERE entity_id = $1 AND new_value::text LIKE '%frameworkChanged%'", [R501]);
      expect(rows).toEqual([{ reason, reason_ref: null }]);
      expect((await counts()).reasons).toBe(c0.reasons);
    });

    it("perimeter-only change (department of the NOMINATIF risk 503): PERIMETER_CHANGE motif shared by the update row and the perimeter row", async () => {
      const reason = `${CANARY}PERIMETER-ONLY`;
      const r = await call("rm", "PATCH", `/risks/${R503}`, { ownerDepartmentId: I("202"), reason });
      expect(r.status, r.text).toBe(200);
      const m = await motifs(reason);
      expect(m).toHaveLength(1);
      const rows = await auditRefs(reason);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.every((x) => x.reason === null && x.reason_ref === m[0]!.id)).toBe(true);
    });
  });

  describe("PRIV-L2A-01 (a): a cumul reason that is also an opening reason (POST /roles/:id/assign)", () => {
    it("administrator + Committee cumul through a department role that opens Finance: ROLE_CHANGE and PERMISSION_CHANGE rows carry the SAME reference, nothing in clear", async () => {
      const reason = `${CANARY}CUMUL-AND-OPENING`;
      const c0 = await counts();
      const r = await post("adm", `/roles/${FIN_ROLE}/assign`, { userId: UID.named === UID.out2 ? UID.out : UID.out2, reason });
      expect(r.status, r.text).toBe(201);
      const m = await motifs(reason);
      expect(m).toHaveLength(1);
      expect(m[0]!.source).toBe("DEPARTMENT_GROUP_OPENING");
      const rows = await auditRefs(reason);
      expect(rows.map((x) => x.action).sort((a, b) => a.localeCompare(b))).toEqual(["PERMISSION_CHANGE", "ROLE_CHANGE"]);
      expect(rows.every((x) => x.reason === null && x.reason_ref === m[0]!.id)).toBe(true);
      expect(await sql("SELECT 1 FROM audit_log WHERE reason LIKE $1", [`%${reason}%`])).toHaveLength(0);
      expect((await counts()).reasons - c0.reasons).toBe(1);
      expect(await whereIs(reason)).toEqual(["visibility_reasons:1"]);
    });

    it("a cumul reason with NO opening (role without department): the ROLE_CHANGE row keeps the reason in clear, no motif (role reason, outside L2a)", async () => {
      const reason = "Cumul administrateur et Comité QA L2a (hors visibilité)";
      const c0 = await counts();
      const r = await post("adm", `/roles/${R_ADMCOM}/assign`, { userId: UID.named, reason });
      expect(r.status, r.text).toBe(201);
      const rows = await sql<{ action: string; reason: string | null; reason_ref: string | null }>("SELECT action, reason, reason_ref FROM audit_log WHERE reason = $1", [reason]);
      expect(rows).toEqual([{ action: "ROLE_CHANGE", reason, reason_ref: null }]);
      expect((await counts()).reasons).toBe(c0.reasons);
    });
  });

  // ------------------------------------------------------------------------------------------------ sensitive view grants
  describe("SVG: request, decision, revocation, rejection by reference", () => {
    it("request + approval + revocation: three motifs (sources), snapshots hold references only, grant columns empty", async () => {
      const rq = `${CANARY}SVG-REQUEST`, dc = `${CANARY}SVG-DECISION`, rv = `${CANARY}SVG-REVOKE`;
      const a = await ask("adm", "n1", rq);
      expect(a.status, a.text).toBe(201);
      const gid = a.json.data.id as string;
      expect((await decide("aud", gid, true, dc)).status).toBe(200);
      expect((await revoke("adm", gid, rv)).status).toBe(200);
      const g = (await sql<Record<string, string | null>>("SELECT reason, decision_reason, revoke_reason, reason_ref, decision_reason_ref, revoke_reason_ref FROM sensitive_view_grants WHERE id = $1", [gid]))[0]!;
      expect([g["reason"], g["decision_reason"], g["revoke_reason"]]).toEqual([null, null, null]);
      expect((await motifs(rq))[0]).toMatchObject({ id: g["reason_ref"], source: "SENSITIVE_VIEW_REQUEST" });
      expect((await motifs(dc))[0]).toMatchObject({ id: g["decision_reason_ref"], source: "SENSITIVE_VIEW_DECISION" });
      expect((await motifs(rv))[0]).toMatchObject({ id: g["revoke_reason_ref"], source: "SENSITIVE_VIEW_REVOCATION" });
      const journal = await sql<{ action: string; reason: string | null; reason_ref: string | null; old_value: any; new_value: any }>( // eslint-disable-line @typescript-eslint/no-explicit-any
        "SELECT action, reason, reason_ref, old_value, new_value FROM audit_log WHERE entity_id = $1 ORDER BY \"timestamp\", id", [gid]);
      expect(journal.map((x) => x.action)).toEqual(["SUBMIT", "APPROVE", "UNASSIGN"]);
      expect(journal.map((x) => x.reason)).toEqual([null, null, null]);
      expect(journal.map((x) => x.reason_ref)).toEqual([g["reason_ref"], g["decision_reason_ref"], g["revoke_reason_ref"]]);
      for (const x of journal) {
        for (const snap of [x.old_value, x.new_value]) {
          if (snap) expect(Object.keys(snap)).not.toEqual(expect.arrayContaining(["reason"]));
          if (snap) expect(JSON.stringify(snap)).not.toContain(CANARY);
        }
      }
      expect(journal[2]!.new_value).toMatchObject({ reasonRef: g["reason_ref"], decisionReasonRef: g["decision_reason_ref"], revokeReasonRef: g["revoke_reason_ref"] });
    });

    it("rejection: the mandatory decision reason is a motif (svg_reject_reason_check satisfied by the reference)", async () => {
      const dc = `${CANARY}SVG-REJECT`;
      const a = await ask("adm", "out", `${CANARY}SVG-REQUEST-2`);
      expect(a.status, a.text).toBe(201);
      const d = await decide("aud", a.json.data.id, false, dc);
      expect(d.status, d.text).toBe(200);
      expect((await motifs(dc))).toHaveLength(1);
      expect((await sql<{ decision_reason: string | null }>("SELECT decision_reason FROM sensitive_view_grants WHERE id = $1", [a.json.data.id]))[0]!.decision_reason).toBeNull();
      expect((await decide("aud", (await ask("adm", "n1", `${CANARY}SVG-REQUEST-3`)).json.data.id, false)).status).toBe(400); // reject without reason
    });
  });

  // ------------------------------------------------------------------------------------------------ input edge cases
  describe("INPUT: 500 characters, special characters, rejected inputs", () => {
    it("exactly 500 characters and a hostile text are stored byte for byte; 501, blank and a NUL character are 400 and write nothing", async () => {
      const long = `${CANARY}LEN-${"x".repeat(500 - `${CANARY}LEN-`.length)}`;
      expect(long).toHaveLength(500);
      const hostile = `${CANARY}HOSTILE ' OR 1=1; DROP TABLE visibility_reasons;-- "q" \\ back\nline2 \t tab {"json":true} % _ 😀 é`;
      const c0 = await counts();
      for (const reason of [long, hostile]) {
        const r = await setVis("rm", `/risks/${R503}`, "NOMINATIF", [], reason, []);
        expect(r.status, `${r.text.slice(0, 120)}`).toBe(200);
        expect((await motifs(reason)).map((m) => m.text)).toEqual([reason]);
        expect((await auditRefs(reason))[0]).toMatchObject({ reason: null });
      }
      expect((await counts()).reasons - c0.reasons).toBe(2);
      const c1 = await counts();
      for (const bad of [...BAD_REASONS, `${CANARY}NUL\u0000x`, "x".repeat(501)]) {
        const r = await setVis("rm", `/risks/${R503}`, "NOMINATIF", [], bad);
        expect(r.status, `${JSON.stringify(bad)?.slice(0, 30)} ${r.text.slice(0, 80)}`).toBe(400);
      }
      expect(await counts()).toEqual(c1);
    });
  });

  // ------------------------------------------------------------------------------------------------ rollback
  describe("ROLLBACK: an error after the motif insert leaves no motif, no grant, no journal row", () => {
    const cases: Array<[string, () => Promise<{ status: number; text: string }>]> = [
      ["setVisibility (risk)", () => setVis("rm", `/risks/${R503}`, "NOMINATIF", [UID.raci], `${CANARY}RB-SET`)],
      ["setVisibility (control)", () => setVis("rm", `/controls/${I("c02")}`, "NOMINATIF", [UID.raci], `${CANARY}RB-CTL`)],
      ["renewal", () => call("rm", "POST", `/risks/${R502}/visibility/renew`, { userIds: [UID.named], reason: `${CANARY}RB-RENEW` })],
      ["perimeter + Dispositif", () => call("rm", "PATCH", `/risks/${R502}`, { processId: P2, reason: `${CANARY}RB-PERIM` })],
      ["designation", () => post("rm", `/risks/${R502}/owner`, { ownerId: UID.pown, reason: `${CANARY}RB-DESIG` })],
      ["role assignment (department group)", () => post("adm", `/roles/${FIN_ROLE}/assign`, { userId: UID.raci, reason: `${CANARY}RB-ROLE` })],
      ["sensitive-view request", () => ask("adm", "out", `${CANARY}RB-SVG`)],
    ];
    it.each(cases)("%s", async (_name, act) => {
      await failAudit();
      try {
        const c0 = await counts();
        const r = await act();
        expect(r.status, r.text.slice(0, 160)).toBeGreaterThanOrEqual(500);
        expect(await counts()).toEqual(c0);
        expect(await whereIs(`${CANARY}RB-`)).toEqual([]);
      } finally { await restoreAudit(); }
    });
  });

  // ------------------------------------------------------------------------------------------------ concurrency
  describe("CONCURRENCY: simultaneous changeVisibility on one resource", () => {
    it("six parallel changes with their own reasons: every success has its motif and its journal row, every failure left nothing; no orphan motif anywhere", async () => {
      const people: Who[] = ["pown", "dept", "raci", "n1", "own", "com"];
      const reasons = people.map((_p, i) => `${CANARY}CONC-${i}`);
      const rs = await Promise.all(people.map((p, i) => setVis("rm", `/risks/${R503}`, "NOMINATIF", [UID[p]], reasons[i])));
      const statuses = rs.map((r) => r.status);
      expect(statuses.every((s) => s === 200 || s === 409 || s === 400), statuses.join(",")).toBe(true);
      expect(statuses).toContain(200);
      for (let i = 0; i < reasons.length; i++) {
        const m = await motifs(reasons[i]!);
        const rows = await auditRefs(reasons[i]!);
        if (rs[i]!.status === 200) {
          expect(m, reasons[i]).toHaveLength(1);
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ reason: null, reason_ref: m[0]!.id });
        } else {
          expect(m, `${reasons[i]} failed ${rs[i]!.status}`).toHaveLength(0);
          expect(rows).toHaveLength(0);
        }
      }
      const g = await sql<{ n: number }>("SELECT count(*)::int AS n FROM resource_access_grants g JOIN visibility_reasons v ON v.id = g.grant_reason_ref WHERE v.text LIKE $1", [`${CANARY}CONC-%`]);
      expect(g[0]!.n).toBe(statuses.filter((s) => s === 200).length);
    });
  });

  // ------------------------------------------------------------------------------------------------ global invariants and readers
  describe("GLOBAL: leak scan, orphans, and the readers once a motif is erased", () => {
    it("no canary text anywhere but in visibility_reasons (row-by-row scan of every public table), no clear reason on any journal row that carries a reference", async () => {
      expect(await whereIs(CANARY)).toEqual(["visibility_reasons:" + (await sql<{ n: number }>("SELECT count(*)::int AS n FROM visibility_reasons WHERE text LIKE $1", [`${CANARY}%`]))[0]!.n]);
      expect(await sql("SELECT 1 FROM audit_log WHERE reason_ref IS NOT NULL AND reason IS NOT NULL")).toHaveLength(0);
      expect(await sql("SELECT 1 FROM audit_log WHERE reason LIKE $1 OR old_value::text LIKE $1 OR new_value::text LIKE $1", [`%${CANARY}%`])).toHaveLength(0);
    });

    it("every motif is referenced by at least one journal row or grant row (no orphan), and by no row of another tenant", async () => {
      const orphans = await sql<{ id: string; text: string | null }>(
        `SELECT v.id, v.text FROM visibility_reasons v
         WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.reason_ref = v.id)
           AND NOT EXISTS (SELECT 1 FROM resource_access_grants g WHERE g.grant_reason_ref = v.id OR g.revoke_reason_ref = v.id)
           AND NOT EXISTS (SELECT 1 FROM sensitive_view_grants s WHERE s.reason_ref = v.id OR s.decision_reason_ref = v.id OR s.revoke_reason_ref = v.id)`);
      expect(orphans).toEqual([]);
    });

    it("erased motifs: every reader shows « motif effacé le JJ/MM/AAAA (conservation) », never the text, never null/undefined", async () => {
      const stamp = "2026-11-10T08:00:00Z";
      const erased = await sql<{ id: string }>("UPDATE visibility_reasons SET text = NULL, erased_at = $1 WHERE text LIKE $2 RETURNING id", [stamp, `${CANARY}%`]);
      expect(erased.length).toBeGreaterThan(10);
      // 1. the journal, three consultation reads
      const byEntity = await get("aud", `/audit-log?entityType=Risk&entityId=${R502}`);
      const recent = await get("aud", "/audit-log?limit=200");
      const searched = await get("aud", `/audit-log?action=PERMISSION_CHANGE&limit=200`);
      for (const [name, r] of [["byEntity", byEntity], ["recent", recent], ["search", searched]] as const) {
        expect(r.status, `${name} ${r.text.slice(0, 120)}`).toBe(200);
        expect(r.text, name).not.toContain(CANARY);
      }
      const refRows = (await sql<{ id: string }>("SELECT id FROM audit_log WHERE reason_ref IS NOT NULL")).map((x) => x.id);
      expect(refRows.length).toBeGreaterThan(10);
      const shown = [...byEntity.json.data, ...searched.json.data].filter((e: { id: string }) => refRows.includes(e.id)) as Array<{ reason: string | null }>;
      expect(shown.length).toBeGreaterThan(3);
      for (const e of shown) expect(e.reason).toMatch(GONE);
      expect(shown[0]!.reason).toBe("motif effacé le 10/11/2026 (conservation)");
      // 2. the restricted-resources list (last change)
      const list = await get("rm", "/restricted-resources?limit=500");
      expect(list.status).toBe(200);
      expect(list.text).not.toContain(CANARY);
      const changed = (list.json.data as Array<{ lastChange?: { reason: string | null } | null }>).filter((x) => x.lastChange);
      expect(changed.length).toBeGreaterThan(0);
      for (const x of changed) expect(x.lastChange!.reason === null || GONE.test(x.lastChange!.reason)).toBe(true);
      expect(changed.some((x) => x.lastChange!.reason !== null && GONE.test(x.lastChange!.reason))).toBe(true);
      // 3. the grants screen
      const grants = await get("adm", `${BASE}?kind=RESOURCE_READALL`);
      expect(grants.status).toBe(200);
      expect(grants.text).not.toContain(CANARY);
      const rows = grants.json.data as Array<{ reason: string; decisionReason: string | null; revokeReason: string | null }>;
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const g of rows) for (const v of [g.reason, g.decisionReason, g.revokeReason]) expect(v === null || GONE.test(v), String(v)).toBe(true);
      // the text cannot come back (guard), and the guard still refuses a second erasure
      await expect(sql("UPDATE visibility_reasons SET text = 'retour' WHERE id = $1", [erased[0]!.id])).rejects.toThrow(/erased once/);
    });
  });
});
