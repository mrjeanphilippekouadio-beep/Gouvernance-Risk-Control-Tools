import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, qaVisibilityHarness } from "./qaVisibilityHarness.js";

/**
 * QA-governance-d6 (level 2): lot D6 of the governance panel. `GET /governance-health` (19 principles, 16 evaluated: one positive and one negative
 * case per detector, statuses, `covers`, ACCEPTED partial vs total with the D5 snapshot, `trackedSince`, exceptions block, masking without
 * `audit.read`, tenant isolation, permissions) and R3 / R5 (`configs.last_seen_retention_days`, `POST /privacy/last-seen-purge`, notice).
 * Oracles written BEFORE running, from docs/architecture/RM-V1-Panel-Principes-Gouvernance.md and the A13 catalog. Not a Security / Privacy / Compliance opinion.
 *
 * Live part: QA_GD6_LIVE=1 + LOCAL cluster of tests/integration/qa-visibility-v1-setup.sh (127.0.0.1:55442, never a remote host); own base (grc_qa_gd6t)
 * is rebuilt: run live suites with --no-file-parallelism. `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 */
const live = process.env["QA_GD6_LIVE"] === "1";
const DB = "grc_qa_gd6t";
const PORT = 8097;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const T = I("001");
const T2 = I("0f2");
const DAY = 86_400_000;
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("QA-governance-d6 STATIC", () => {
  it("migration 085: IF NOT EXISTS, retention CHECK 1..3650 default 1826, no function or trigger, no DELETE", () => {
    const sql = read("database", "postgresql", "migrations", "085_governance_tracking.sql");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS governance_tracking_started_at");
    expect(sql).toMatch(/last_seen_retention_days integer DEFAULT 1826\s+CHECK \(last_seen_retention_days BETWEEN 1 AND 3650\)/);
    expect(sql).not.toMatch(/CREATE (OR REPLACE )?(FUNCTION|TRIGGER)|DELETE FROM/i);
  });
  it("routes: the panel takes no parameter and is read-only; the purge is a POST behind the per-user rate limiter, the notice a GET", () => {
    const h = read("backend", "src", "api", "v1", "governanceHealth.routes.ts");
    expect(h).not.toMatch(/req\.(query|body|params)/);
    expect(h).not.toMatch(/router\.(post|put|patch|delete)/);
    const p = read("backend", "src", "api", "v1", "privacy.routes.ts");
    expect(p).toMatch(/router\.post\("\/last-seen-purge", perUserRateLimiter\(\)/);
    expect(p).toMatch(/router\.get\("\/notice"/);
  });
  it("purge repository: soft (UPDATE to NULL, never DELETE), tenant filter, only ended accounts", () => {
    const s = read("backend", "src", "infrastructure", "database", "postgres", "PostgresLastSeenRetentionRepository.ts");
    expect(s).not.toMatch(/DELETE FROM/i);
    expect(s).toContain("tenant_id = $1 AND deleted_at IS NOT NULL");
  });
  it.fails("QA-D6-03: with no retention (null = never erased) the notice must not still say the date is « puis effacée »", () => {
    const t = read("frontend", "src", "features", "privacy", "privacyNotice.ts");
    const body = t.slice(t.indexOf("export function fillPrivacyNotice"));
    expect(t).toContain("puis effacée");
    expect(body, "fillPrivacyNotice has no branch for a null retention").toMatch(/retentionDays === null/);
  });
  it("R5 text: both variables are filled by the code, the DPO contact is never invented, the text is mirrored in docs/privacy", () => {
    const t = read("frontend", "src", "features", "privacy", "privacyNotice.ts");
    expect(t).toContain("{duree}");
    expect(t).toContain("{contactDpo}");
    expect(t).toContain("DPO_CONTACT_MISSING");
    expect(read("docs", "privacy", "texte-information-R5-2026-11-04.md")).toContain("Base légale : intérêt légitime de sécurité et de gestion des habilitations.");
  });
});

type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
const R_PLAIN = I("3a1");
const R_AUDITX = I("3a2");

const H = qaVisibilityHarness({ db: DB, port: PORT, who: WHO, uid: UID });
const { sql, call, get, post } = H;

type Principle = { id: string; status: string; covers: string | null; notEvaluableReason: string | null; offenders: Array<Record<string, any>>; acceptance: Record<string, any> | null; requirementLevel: string | null; highlighted: string | null };
type Exc = { auditId: string; entityId: string; reviewed: boolean; overdue: boolean; ageDays: number; userId: string | null; userLabel: string | null; mine: boolean; rule: string; reason: string | null };
type Panel = { trackedSince: string; principles: Principle[]; exceptions: { total: number; unreviewed: number; reviewDelayDays: number | null; items: Exc[] }; organizationSize: unknown; profileGaps: unknown[] };
const panel = async (w: Who): Promise<Panel> => { const r = await get(w, "/governance-health"); expect(r.status, `${w}: ${r.text.slice(0, 200)}`).toBe(200); return r.json.data; };
const pr = (p: Panel, id: string) => p.principles.find((x) => x.id === id)!;
const status = async (id: string, w: Who = "aud") => pr(await panel(w), id).status;

const roleOfGroup = async (group: string) => (await sql<{ id: string }>("SELECT id FROM roles WHERE tenant_id = $1 AND system_group = $2", [T, group]))[0]!.id;
const joinGroup = async (group: string, w: Who) => sql("INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)", [T, await roleOfGroup(group), UID[w], UID.adm]);
const leave = async (group: string, w: Who) => sql("UPDATE user_roles SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL AND role_id = $3", [T, UID[w], await roleOfGroup(group)]);
/** Moves the start of the tracking to now: every audit row inserted before is out of the panel (no reconstitution, q143). */
const freshTracking = () => sql("UPDATE tenants SET governance_tracking_started_at = clock_timestamp() WHERE id = $1", [T]);
const mark = async (o: { rule?: string | null; user?: Who; entityType?: string; entityId?: string; action?: string; reason?: string; at?: string; tenant?: string }) => {
  const id = randomUUID();
  await sql(`INSERT INTO audit_log (id, tenant_id, user_id, entity_type, entity_id, action, reason, request_id, governance_exception, "timestamp")
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'REQ-QA-D6', $8, ${o.at ?? "clock_timestamp()"})`,
  [id, o.tenant ?? T, UID[o.user ?? "rm"], o.entityType ?? "Config", o.entityId ?? randomUUID(), o.action ?? "UPDATE", o.reason ?? "QA D6", o.rule === undefined ? "noSelfValidation" : o.rule]);
  return id;
};
const setUser = (w: Who, sqlSet: string) => sql(`UPDATE users SET ${sqlSet} WHERE id = $1`, [UID[w]]);

describe.skipIf(!live)("QA-governance-d6 on the REAL server + LOCAL PostgreSQL 16", () => {
  beforeAll(() => H.start(async () => {
    await sql("UPDATE users SET roles = roles || ARRAY['execution.read','effectiveness.read']::text[]");
    await sql("UPDATE users SET roles = roles || ARRAY['governancehealth.read','role.assign','role.read','user.update','config.read','config.governancedelays.set']::text[] WHERE email = 'adm@vv1.test'");
    await sql("INSERT INTO roles (id, tenant_id, name, permissions) VALUES ($1, $3, 'QA Plain', '{risk.read}'), ($2, $3, 'QA Audit extra', '{risk.read}')", [R_PLAIN, R_AUDITX, T]);
    // healthy baseline: RM {rm, n1}, Committee {com, raci}, Audit {aud}; settings ok; every process owned and championed
    await joinGroup("RISK_MANAGER", "n1");
    await joinGroup("RISK_COMMITTEE", "raci");
    await sql("INSERT INTO configs (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING", [T]);
    await sql("UPDATE configs SET committee_evaluation_enforced = true, committee_treatment_min_score = 12, exception_review_delay_days = 5, risk_manager_vacancy_max_days = 60, committee_audit_cumul_allowed = false WHERE tenant_id = $1", [T]);
    await sql("UPDATE processes SET risk_champion_user_id = $1 WHERE risk_champion_user_id IS NULL", [UID.own]);
    await sql("UPDATE processes SET owner_user_id = $1 WHERE owner_user_id IS NULL", [UID.pown]);
    await freshTracking();
  }), 280000);
  afterAll(() => H.stop());

  // ------------------------------------------------------------------------------------------------ SHAPE
  describe("shape, permissions, tenant", () => {
    it("401 anonymous; 403 without governancehealth.read (out, dept); 200 for Risk Manager, Committee, Audit and an administrator holding the right", async () => {
      expect((await call(null, "GET", "/governance-health")).status).toBe(401);
      for (const w of ["out", "dept", "own"] as const) expect((await get(w, "/governance-health")).status, w).toBe(403);
      for (const w of ["rm", "com", "aud", "adm"] as const) expect((await get(w, "/governance-health")).status, w).toBe(200);
    });
    it("the panel is read-only: no parameter changes it, POST/PUT/DELETE are refused, and reading writes no audit row (I-P3)", async () => {
      const before = (await sql<{ n: number }>("SELECT count(*)::int AS n FROM audit_log"))[0]!.n;
      await panel("aud");
      await get("aud", "/governance-health?tenant=other&status=ACCEPTED");
      expect((await sql<{ n: number }>("SELECT count(*)::int AS n FROM audit_log"))[0]!.n).toBe(before);
      for (const m of ["POST", "PUT", "PATCH", "DELETE"]) expect((await call("aud", m, "/governance-health", {})).status, m).toBeGreaterThanOrEqual(400);
    });
    it("19 principles, 16 evaluated: GOV-SOD-05, GOV-COM-02, GOV-OWN-03 are NOT_EVALUABLE with a reason, never RESPECTED; each evaluated one says what it covers (or nothing is claimed)", async () => {
      const p = await panel("aud");
      expect(p.principles.length).toBe(19);
      const ne = p.principles.filter((x) => x.status === "NOT_EVALUABLE").map((x) => x.id).sort((a, b) => a.localeCompare(b));
      expect(ne).toEqual(["GOV-COM-02", "GOV-OWN-03", "GOV-SOD-05"]);
      for (const x of p.principles.filter((q) => q.status === "NOT_EVALUABLE")) { expect(x.notEvaluableReason, x.id).toBeTruthy(); expect(x.covers, x.id).toBeNull(); }
      expect(new Set(p.principles.map((x) => x.id)).size).toBe(19);
    });
    it("healthy baseline: the 16 evaluated principles are RESPECTED (no offender, no acceptance)", async () => {
      const p = await panel("aud");
      const bad = p.principles.filter((x) => x.status !== "NOT_EVALUABLE" && x.status !== "RESPECTED").map((x) => `${x.id}=${x.status} ${JSON.stringify(x.offenders)}`);
      expect(bad).toEqual([]);
    });
    it("trackedSince is the tenant's governance_tracking_started_at (085); no organization size is guessed without an active profile", async () => {
      const p = await panel("aud");
      const t = (await sql<{ t: Date }>("SELECT governance_tracking_started_at AS t FROM tenants WHERE id = $1", [T]))[0]!.t;
      expect(new Date(p.trackedSince).getTime()).toBe(t.getTime());
      expect(p.organizationSize).toBeNull();
      expect(p.principles.every((x) => x.highlighted === null && x.requirementLevel === null)).toBe(true);
    });
    it("tenant isolation: marked rows, a user and a risk gap of another tenant change nothing here", async () => {
      await sql("INSERT INTO tenants (id, name) VALUES ($1, 'QA autre client') ON CONFLICT DO NOTHING", [T2]);
      await sql("INSERT INTO users (id, tenant_id, email, display_name, roles) VALUES ($1, $2, 'other@d6.test', 'Other', '{}') ON CONFLICT DO NOTHING", [I("0f3"), T2]);
      await freshTracking();
      const before = await panel("aud");
      await sql("INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, request_id, governance_exception) VALUES ($1, $2, 'Config', $3, 'UPDATE', 'REQ-QA', 'noSelfValidation')", [T2, I("0f3"), randomUUID()]);
      await sql("INSERT INTO risks (tenant_id, process, description, status, visibility) VALUES ($1, 'x', 'AUTRE-CLIENT', 'ACTIVE', 'CLIENT')", [T2]);
      const after = await panel("aud");
      expect(after.exceptions.total).toBe(before.exceptions.total);
      expect(pr(after, "GOV-OWN-01").status).toBe("RESPECTED");
      expect(JSON.stringify(after)).not.toContain("AUTRE-CLIENT");
    });
  });

  // ------------------------------------------------------------------------------------------------ DETECTORS
  describe("detectors: one positive and one negative case each", () => {
    it("GOV-SOD-01: a marked noSelfValidation act, and a validation by the author without marker, are offenders; a validation by another account, an unlisted entity type, a row before trackedSince, a marked row of another rule are not", async () => {
      await freshTracking();
      expect(await status("GOV-SOD-01")).toBe("RESPECTED");
      const obj = randomUUID();
      await mark({ rule: null, user: "rm", entityType: "ControlExecution", entityId: obj, action: "CREATE" });
      await mark({ rule: null, user: "n1", entityType: "ControlExecution", entityId: obj, action: "VALIDATE" }); // another account: not self
      await mark({ rule: null, user: "rm", entityType: "Risk", entityId: obj, action: "CREATE" });
      await mark({ rule: null, user: "rm", entityType: "Risk", entityId: obj, action: "VALIDATE" }); // not a protected entity type
      await mark({ rule: "riskappetite.adminAlone", user: "rm", entityType: "ControlExecution", entityId: randomUUID(), action: "VALIDATE" }); // other rule
      const old = randomUUID();
      await mark({ rule: null, user: "rm", entityType: "TreatmentDecision", entityId: old, action: "CREATE", at: "(SELECT governance_tracking_started_at - interval '2 days' FROM tenants WHERE id = '" + T + "')" });
      await mark({ rule: null, user: "rm", entityType: "TreatmentDecision", entityId: old, action: "VALIDATE", at: "(SELECT governance_tracking_started_at - interval '1 day' FROM tenants WHERE id = '" + T + "')" });
      expect(pr(await panel("aud"), "GOV-SOD-01").status, "none of these is a self-validation").toBe("RESPECTED");
      await mark({ rule: "noSelfValidation", user: "rm", entityType: "ControlEffectivenessAssessment", entityId: randomUUID(), action: "VALIDATE" });
      const marked = pr(await panel("aud"), "GOV-SOD-01");
      expect(marked.status).toBe("NOT_RESPECTED");
      expect(marked.offenders.length).toBe(1);
      expect(marked.offenders[0]).toMatchObject({ kind: "DECISION" });
      expect(marked.covers).toBeTruthy();
      const own = randomUUID();
      await mark({ rule: null, user: "com", entityType: "ActionPlan", entityId: own, action: "CREATE" });
      await mark({ rule: null, user: "com", entityType: "ActionPlan", entityId: own, action: "CLOSE" });
      const both = pr(await panel("aud"), "GOV-SOD-01");
      expect(both.offenders.length).toBe(2);
      expect(both.offenders.some((o) => /sans marqueur/.test(o.detail))).toBe(true);
    });
    it("GOV-SOD-02: a FALLBACK / BOOTSTRAP Dispositif decision whose ratification is pending is an offender; none => RESPECTED", async () => {
      expect(await status("GOV-SOD-02")).toBe("RESPECTED");
      const fw = randomUUID(), req = randomUUID();
      await sql("ALTER TABLE risk_framework_change_requests DISABLE TRIGGER USER");
      try {
        await sql("INSERT INTO risk_frameworks (id, tenant_id, name, is_default) VALUES ($1, $2, 'QA', false)", [fw, T]);
        await sql(`INSERT INTO risk_framework_change_requests (id, tenant_id, kind, framework_id, reason, status, requested_by, decided_by, decision_regime, decider_group, ratification_status, decided_at)
          VALUES ($1, $2, 'SET_DEFAULT', $3, 'QA', 'APPROVED', $4, $5, 'FALLBACK', 'RISK_MANAGER', 'PENDING', now() - interval '3 days')`, [req, T, fw, UID.rm, UID.n1]);
        const x = pr(await panel("aud"), "GOV-SOD-02");
        expect(x.status).toBe("NOT_RESPECTED");
        expect(x.offenders[0]).toMatchObject({ kind: "DECISION", id: req });
        expect(x.offenders[0]!["detail"]).toContain("3 jour");
        await sql("UPDATE risk_framework_change_requests SET ratification_status = NULL WHERE id = $1", [req]); // ratified
        expect(await status("GOV-SOD-02")).toBe("RESPECTED");
      } finally { await sql("ALTER TABLE risk_framework_change_requests ENABLE TRIGGER USER"); }
    });
    it("GOV-SOD-03: an active account that gave itself a role is an offender; a suspended one, or a role granted by someone else, is not", async () => {
      expect(await status("GOV-SOD-03")).toBe("RESPECTED");
      await sql("INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $3)", [T, R_PLAIN, UID.dept]);
      const x = pr(await panel("aud"), "GOV-SOD-03");
      expect(x.status).toBe("NOT_RESPECTED");
      expect(x.offenders[0]).toMatchObject({ kind: "USER", id: UID.dept });
      expect(x.offenders[0]!["detail"]).toContain("QA Plain");
      await setUser("dept", "deleted_at = now()");
      expect(await status("GOV-SOD-03"), "a suspended account is not counted").toBe("RESPECTED");
      await setUser("dept", "deleted_at = NULL");
      await sql("UPDATE user_roles SET revoked_at = now() WHERE role_id = $1 AND user_id = $2", [R_PLAIN, UID.dept]);
      expect(await status("GOV-SOD-03"), "a revoked assignment is not counted").toBe("RESPECTED");
    });
    it("GOV-SOD-04: administrator + Risk Manager, Risk Manager + Audit, Risk Manager + Committee, Committee + Audit (flagged even when the setting allows it, annotated) are offenders; no cumul => RESPECTED", async () => {
      expect(await status("GOV-SOD-04")).toBe("RESPECTED");
      await setUser("rm", "roles = roles || ARRAY['role.assign']::text[]");
      let x = pr(await panel("aud"), "GOV-SOD-04");
      expect(x.status).toBe("NOT_RESPECTED");
      expect(x.offenders.find((o) => o["id"] === UID.rm)!["detail"]).toContain("administrateur + Risk Manager");
      await setUser("rm", "roles = array_remove(roles, 'role.assign')");
      expect(await status("GOV-SOD-04")).toBe("RESPECTED");
      await joinGroup("AUDIT", "n1");
      x = pr(await panel("aud"), "GOV-SOD-04");
      expect(x.offenders.find((o) => o["id"] === UID.n1)!["detail"]).toContain("Risk Manager + Audit");
      await leave("AUDIT", "n1");
      await joinGroup("RISK_COMMITTEE", "n1");
      expect(pr(await panel("aud"), "GOV-SOD-04").offenders.find((o) => o["id"] === UID.n1)!["detail"]).toContain("Risk Manager + Comité");
      await leave("RISK_COMMITTEE", "n1");
      await joinGroup("AUDIT", "raci");
      expect(pr(await panel("aud"), "GOV-SOD-04").offenders.find((o) => o["id"] === UID.raci)!["detail"]).toBe("Comité + Audit");
      await sql("UPDATE configs SET committee_audit_cumul_allowed = true WHERE tenant_id = $1", [T]);
      expect(pr(await panel("aud"), "GOV-SOD-04").offenders.find((o) => o["id"] === UID.raci)!["detail"]).toContain("autorisé par le paramètre");
      await sql("UPDATE configs SET committee_audit_cumul_allowed = false WHERE tenant_id = $1", [T]);
      await leave("AUDIT", "raci");
      expect(await status("GOV-SOD-04")).toBe("RESPECTED");
    });
    it("GOV-RISK-01 / GOV-RISK-02: Risk Manager group of 1 => both; of 0 => vacancy; an interim designation lifts RISK-02 only; Committee of 1 => RISK-02 and COM-01", async () => {
      await leave("RISK_MANAGER", "n1");
      let p = await panel("aud");
      expect(pr(p, "GOV-RISK-01").status).toBe("NOT_RESPECTED");
      expect(pr(p, "GOV-RISK-01").offenders[0]).toMatchObject({ kind: "GROUP", id: "RISK_MANAGER", count: 1 });
      expect(pr(p, "GOV-RISK-02").status).toBe("NOT_RESPECTED");
      await sql("INSERT INTO governance_designations (tenant_id, kind, user_id, reason, designated_by, valid_until) VALUES ($1, 'RISK_MANAGER_INTERIM', $2, 'QA', $3, now() + interval '30 days')", [T, UID.own, UID.adm]);
      p = await panel("aud");
      expect(pr(p, "GOV-RISK-01").status, "an interim does not make the function plural").toBe("NOT_RESPECTED");
      expect(pr(p, "GOV-RISK-02").status, "one member but an interim is designated").toBe("RESPECTED");
      await leave("RISK_MANAGER", "rm");
      p = await panel("aud");
      expect(pr(p, "GOV-RISK-01").offenders[0]).toMatchObject({ count: 0, detail: "fonction risque vacante" });
      expect(pr(p, "GOV-RISK-02").offenders[0]).toMatchObject({ id: "RISK_MANAGER", count: 0, detail: "vacance" });
      await joinGroup("RISK_MANAGER", "rm"); await joinGroup("RISK_MANAGER", "n1");
      await sql("UPDATE governance_designations SET ended_at = now(), ended_by = $2, end_reason = 'QA' WHERE tenant_id = $1 AND ended_at IS NULL", [T, UID.adm]);
      await leave("RISK_COMMITTEE", "raci");
      p = await panel("aud");
      expect(pr(p, "GOV-RISK-02").offenders.find((o) => o["id"] === "RISK_COMMITTEE")).toMatchObject({ count: 1 });
      expect(pr(p, "GOV-COM-01").offenders.find((o) => o["id"] === "RISK_COMMITTEE")).toMatchObject({ count: 1, detail: "un seul membre" });
      await joinGroup("RISK_COMMITTEE", "raci");
      p = await panel("aud");
      expect([pr(p, "GOV-RISK-01").status, pr(p, "GOV-RISK-02").status, pr(p, "GOV-COM-01").status]).toEqual(["RESPECTED", "RESPECTED", "RESPECTED"]);
    });
    it("GOV-RISK-02 vacancy beyond the declared maximum: a vacancy trace older than the maximum with no active Risk Manager => SETTING offender; within the maximum => none", async () => {
      await freshTracking();
      await leave("RISK_MANAGER", "rm"); await leave("RISK_MANAGER", "n1");
      try {
        await mark({ rule: "riskManager.vacancy", user: "adm", entityType: "User", action: "UPDATE", at: "(clock_timestamp() - interval '10 days')" });
        // a trace inside the tracking window is needed: move tracking back
        await sql("UPDATE tenants SET governance_tracking_started_at = clock_timestamp() - interval '30 days' WHERE id = $1", [T]);
        let x = pr(await panel("aud"), "GOV-RISK-02");
        expect(x.offenders.some((o) => o["kind"] === "SETTING"), "10 days < 60").toBe(false);
        await sql("UPDATE configs SET risk_manager_vacancy_max_days = 5 WHERE tenant_id = $1", [T]);
        x = pr(await panel("aud"), "GOV-RISK-02");
        expect(x.offenders.find((o) => o["kind"] === "SETTING")).toMatchObject({ id: "riskManagerVacancyMaxDays" });
      } finally {
        await sql("UPDATE configs SET risk_manager_vacancy_max_days = 60 WHERE tenant_id = $1", [T]);
        await joinGroup("RISK_MANAGER", "rm"); await joinGroup("RISK_MANAGER", "n1");
        await freshTracking();
      }
    });
    it("GOV-AUD-01 / GOV-AUD-02: an Audit member who is also Risk Manager, or an Audit role carrying a non-reading right => AUD-01; no Audit member => AUD-02", async () => {
      expect([await status("GOV-AUD-01"), await status("GOV-AUD-02")]).toEqual(["RESPECTED", "RESPECTED"]);
      const auditRole = await roleOfGroup("AUDIT");
      await sql("UPDATE roles SET permissions = permissions || ARRAY['risk.create']::text[] WHERE id = $1", [auditRole]);
      let x = pr(await panel("aud"), "GOV-AUD-01");
      expect(x.status).toBe("NOT_RESPECTED");
      expect(x.offenders[0]).toMatchObject({ kind: "PERMISSION", id: "risk.create" });
      await sql("UPDATE roles SET permissions = array_remove(permissions, 'risk.create') WHERE id = $1", [auditRole]);
      await joinGroup("AUDIT", "n1");
      x = pr(await panel("aud"), "GOV-AUD-01");
      expect(x.offenders.find((o) => o["kind"] === "USER")).toMatchObject({ id: UID.n1, detail: "membre d'Audit et Risk Manager" });
      await leave("AUDIT", "n1");
      await leave("AUDIT", "aud");
      const p = await panel("rm");
      expect(pr(p, "GOV-AUD-02").offenders[0]).toMatchObject({ kind: "GROUP", id: "AUDIT", count: 0 });
      await joinGroup("AUDIT", "aud");
      expect([await status("GOV-AUD-01"), await status("GOV-AUD-02")]).toEqual(["RESPECTED", "RESPECTED"]);
    });
    it("GOV-COM-01: no configuration row => NOT_EVALUABLE; passage to the Committee off => SETTING; no treatment threshold => SETTING; a Committee of 1 => GROUP", async () => {
      await sql("UPDATE configs SET committee_evaluation_enforced = false WHERE tenant_id = $1", [T]);
      expect(pr(await panel("aud"), "GOV-COM-01").offenders[0]).toMatchObject({ kind: "SETTING", id: "committeeEvaluationEnforced" });
      await sql("UPDATE configs SET committee_evaluation_enforced = true, committee_treatment_min_score = NULL WHERE tenant_id = $1", [T]);
      expect(pr(await panel("aud"), "GOV-COM-01").offenders[0]).toMatchObject({ kind: "SETTING", id: "committeeTreatmentMinScore" });
      await sql("UPDATE configs SET committee_treatment_min_score = 12 WHERE tenant_id = $1", [T]);
      expect(await status("GOV-COM-01")).toBe("RESPECTED");
      await sql("DELETE FROM configs WHERE tenant_id = $1", [T]);
      const x = pr(await panel("aud"), "GOV-COM-01");
      expect(x.status).toBe("NOT_EVALUABLE");
      expect(x.notEvaluableReason).toBeTruthy();
      await sql("INSERT INTO configs (tenant_id) VALUES ($1)", [T]);
      await sql("UPDATE configs SET committee_evaluation_enforced = true, committee_treatment_min_score = 12, exception_review_delay_days = 5, risk_manager_vacancy_max_days = 60 WHERE tenant_id = $1", [T]);
      expect(await status("GOV-COM-01")).toBe("RESPECTED");
    });
    it("GOV-APP-01: an appetite change marked « sans seconde validation » is an offender; a marker of another rule is not", async () => {
      await freshTracking();
      await mark({ rule: "config.cumul.adminAlone", user: "rm" });
      expect(await status("GOV-APP-01")).toBe("RESPECTED");
      await mark({ rule: "riskappetite.adminAlone", user: "rm", entityType: "RiskAppetite", action: "UPDATE" });
      const x = pr(await panel("aud"), "GOV-APP-01");
      expect(x.status).toBe("NOT_RESPECTED");
      expect(x.offenders).toHaveLength(1);
    });
    it("GOV-OWN-01: a live risk without owner, or whose owner is suspended, is an offender (label only for a CLIENT risk); an archived or deleted one is not", async () => {
      expect(await status("GOV-OWN-01")).toBe("RESPECTED");
      const ids = { noOwner: randomUUID(), suspended: randomUUID(), restricted: randomUUID(), archived: randomUUID(), deleted: randomUUID() };
      const ins = (id: string, owner: string | null, vis: string, st = "ACTIVE", del = "NULL") =>
        sql(`INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility, deleted_at) VALUES ($1, $2, 'QA', $3, $4, $5, $6, ${del})`, [id, T, `LIBELLE-${vis}-${id.slice(0, 4)}`, st, owner, vis]);
      await ins(ids.noOwner, null, "CLIENT");
      await ins(ids.suspended, UID.dept, "CLIENT");
      await ins(ids.restricted, null, "PERIMETRE");
      await ins(ids.archived, null, "CLIENT", "ARCHIVED");
      await ins(ids.deleted, null, "CLIENT", "ACTIVE", "now()");
      await setUser("dept", "deleted_at = now()");
      try {
        const x = pr(await panel("aud"), "GOV-OWN-01");
        expect(x.status).toBe("NOT_RESPECTED");
        expect(x.offenders.map((o) => o["id"]).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([ids.noOwner, ids.suspended, ids.restricted].sort((a, b) => a.localeCompare(b)));
        expect(x.offenders.find((o) => o["id"] === ids.noOwner)!["label"]).toContain("LIBELLE-CLIENT");
        expect(x.offenders.find((o) => o["id"] === ids.suspended)!["detail"]).toBe("propriétaire suspendu");
        for (const w of ["aud", "rm", "com", "adm"] as const) expect(JSON.stringify(await panel(w)), `${w}: restricted label`).not.toContain("LIBELLE-PERIMETRE");
        expect(pr(await panel("rm"), "GOV-OWN-01").offenders.find((o) => o["id"] === ids.restricted)!["label"]).toBeNull();
      } finally {
        await sql("UPDATE risks SET deleted_at = now() WHERE description LIKE 'LIBELLE-%'");
        await setUser("dept", "deleted_at = NULL");
      }
      expect(await status("GOV-OWN-01")).toBe("RESPECTED");
    });
    it("GOV-OWN-02: an active process without owner account or without champion is an offender; an inactive one, or a complete one, is not", async () => {
      expect(await status("GOV-OWN-02")).toBe("RESPECTED");
      const a = randomUUID(), b = randomUUID(), c = randomUUID();
      const ins = (id: string, name: string, owner: string | null, champ: string | null, active: boolean) =>
        sql("INSERT INTO processes (id, tenant_id, level, name, owner_user_id, risk_champion_user_id, active) VALUES ($1, $2, 'PROCESS', $3, $4, $5, $6)", [id, T, name, owner, champ, active]);
      await ins(a, "QA sans champion", UID.pown, null, true);
      await ins(b, "QA inactif sans proprietaire", null, null, false);
      await ins(c, "QA complet", UID.pown, UID.own, true);
      const x = pr(await panel("aud"), "GOV-OWN-02");
      expect(x.offenders.map((o) => o["id"])).toEqual([a]);
      expect(x.offenders[0]!["detail"]).toBe("sans champion de risque");
      await sql("UPDATE processes SET active = false WHERE id = $1", [a]);
      expect(await status("GOV-OWN-02")).toBe("RESPECTED");
    });
    it("GOV-ACC-01: a custom role carrying rolegroup.audit.update is an offender; the fixed groups and an ordinary custom role are not", async () => {
      expect(await status("GOV-ACC-01")).toBe("RESPECTED");
      await sql("UPDATE roles SET permissions = permissions || ARRAY['rolegroup.audit.update']::text[] WHERE id = $1", [R_AUDITX]);
      const x = pr(await panel("aud"), "GOV-ACC-01");
      expect(x.status).toBe("NOT_RESPECTED");
      expect(x.offenders).toEqual([expect.objectContaining({ kind: "ROLE", id: R_AUDITX, label: "QA Audit extra" })]);
      await sql("UPDATE roles SET permissions = array_remove(permissions, 'rolegroup.audit.update') WHERE id = $1", [R_AUDITX]);
      expect(await status("GOV-ACC-01")).toBe("RESPECTED");
    });
    it("GOV-TRC-01 / GOV-TRC-02: an unreviewed marked decision => TRC-01 with count and age; a review clears it; a vacancy trace is not a decision to review; TRC-02 only when a severe principle fails and no manager is designated", async () => {
      await freshTracking();
      expect(await status("GOV-TRC-01")).toBe("RESPECTED");
      await mark({ rule: "riskManager.vacancy", user: "adm", entityType: "User", action: "UPDATE" });
      expect(await status("GOV-TRC-01"), "vacancy trace excluded").toBe("RESPECTED");
      const a1 = await mark({ rule: "config.cumul.adminAlone", user: "rm", at: "(clock_timestamp() - interval '3 days')" });
      await freshTracking();
      const a2 = await mark({ rule: "config.cumul.adminAlone", user: "rm", reason: "TRC" });
      await sql("UPDATE tenants SET governance_tracking_started_at = clock_timestamp() - interval '10 days' WHERE id = $1", [T]);
      let x = pr(await panel("aud"), "GOV-TRC-01");
      expect(x.status).toBe("NOT_RESPECTED");
      expect(x.offenders[0]).toMatchObject({ kind: "DECISION" });
      expect(x.offenders[0]!["count"], "the oldest is 3 days old, count >= the 2 unreviewed we added").toBeGreaterThanOrEqual(2);
      expect(x.offenders[0]!["detail"]).toContain("3 jour");
      expect(a2).toBeTruthy();
      for (const aid of [a1, a2]) await sql("INSERT INTO governance_exception_reviews (tenant_id, audit_log_id, outcome, reviewed_by, comment) VALUES ($1, $2, 'REVIEWED', $3, 'QA')", [T, aid, UID.aud]);
      const rest = pr(await panel("aud"), "GOV-TRC-01");
      expect(rest.offenders[0]?.["count"] ?? 0, "after the reviews only older unrelated rows may remain").toBeLessThan(x.offenders[0]!["count"]);
      // TRC-02: start from a clean window (earlier scenarios left marked acts that fail GOV-SOD-01, a severe principle)
      await freshTracking();
      expect(await status("GOV-TRC-02")).toBe("RESPECTED");
      await leave("RISK_MANAGER", "rm"); await leave("RISK_MANAGER", "n1");
      try {
        x = pr(await panel("aud"), "GOV-TRC-02");
        expect(x.status).toBe("NOT_RESPECTED");
        expect(x.offenders[0]).toMatchObject({ kind: "SETTING", id: "manager" });
        expect(x.offenders[0]!["count"]).toBeGreaterThanOrEqual(1);
        await sql("INSERT INTO governance_designations (tenant_id, kind, user_id, reason, designated_by) VALUES ($1, 'MANAGER', $2, 'QA', $3)", [T, UID.own, UID.adm]);
        expect(await status("GOV-TRC-02"), "manager designated").toBe("RESPECTED");
        expect(await status("GOV-RISK-01")).toBe("NOT_RESPECTED");
      } finally {
        await sql("UPDATE governance_designations SET ended_at = now(), ended_by = $2, end_reason = 'QA' WHERE tenant_id = $1 AND ended_at IS NULL", [T, UID.adm]);
        await joinGroup("RISK_MANAGER", "rm"); await joinGroup("RISK_MANAGER", "n1");
      }
    });
    it("GOV-REG-01: single-person regime declared while several people hold a role => offender; not declared with one person validating own acts => offender; coherent states => none", async () => {
      expect(await status("GOV-REG-01")).toBe("RESPECTED");
      await sql("ALTER TABLE tenants DISABLE TRIGGER USER");
      try {
        await sql("UPDATE tenants SET single_person_regime_declared_at = now(), single_person_regime_lifted_at = NULL WHERE id = $1", [T]);
        const x = pr(await panel("aud"), "GOV-REG-01");
        expect(x.status).toBe("NOT_RESPECTED");
        expect(x.offenders[0]).toMatchObject({ kind: "SETTING", id: "singlePersonRegime" });
        await sql("UPDATE tenants SET single_person_regime_lifted_at = now() WHERE id = $1", [T]);
        expect(await status("GOV-REG-01"), "regime lifted").toBe("RESPECTED");
      } finally {
        await sql("UPDATE tenants SET single_person_regime_declared_at = NULL, single_person_regime_lifted_at = NULL WHERE id = $1", [T]);
        await sql("ALTER TABLE tenants ENABLE TRIGGER USER");
      }
    });
  });

  // ------------------------------------------------------------------------------------------------ ACCEPTANCES
  describe("ACCEPTED (D5): total vs partial, snapshot of the objects in cause", () => {
    const accept = (by: Who, principleId: string, days = 5) => post(by, "/governance-principle-acceptances", { principleId, reason: "Risque accepté pour la période (QA D6)", expiresAt: new Date(Date.now() + days * DAY).toISOString() });
    it("an acceptance of GOV-OWN-01 snapshots the offenders (keys only); confirmed by a third party it turns the principle ACCEPTED; a NEW offender makes it NOT_RESPECTED again (partial); expiry or revocation too", async () => {
      const first = randomUUID();
      await sql("INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ($1, $2, 'QA', 'ACC-1', 'ACTIVE', NULL, 'CLIENT')", [first, T]);
      expect(await status("GOV-OWN-01")).toBe("NOT_RESPECTED");
      const a = await accept("rm", "GOV-OWN-01");
      expect(a.status, a.text).toBe(201);
      const id = a.json.data.id as string;
      expect(a.json.data.status).toBe("PENDING");
      const snap = (await sql<{ s: Array<Record<string, unknown>> }>("SELECT offenders_snapshot AS s FROM governance_principle_acceptances WHERE id = $1", [id]))[0]!.s;
      expect(snap).toEqual([{ kind: "RISK", id: first }]);
      expect(JSON.stringify(snap)).not.toContain("ACC-1");
      expect(await status("GOV-OWN-01"), "pending is not accepted").toBe("NOT_RESPECTED");
      expect((await post("rm", `/governance-principle-acceptances/${id}/confirm`, {})).status, "author cannot confirm").toBeGreaterThanOrEqual(400);
      const c = await post("com", `/governance-principle-acceptances/${id}/confirm`, {});
      expect(c.status, c.text).toBe(200);
      let x = pr(await panel("aud"), "GOV-OWN-01");
      expect(x.status).toBe("ACCEPTED");
      expect(x.offenders).toHaveLength(1);
      expect(x.acceptance).toMatchObject({ id, reason: "Risque accepté pour la période (QA D6)" });
      const second = randomUUID();
      await sql("INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ($1, $2, 'QA', 'ACC-2', 'ACTIVE', NULL, 'CLIENT')", [second, T]);
      x = pr(await panel("aud"), "GOV-OWN-01");
      expect(x.status, "partial: one offender is new").toBe("NOT_RESPECTED");
      expect(x.acceptance).toBeNull();
      await sql("UPDATE risks SET deleted_at = now() WHERE id = $1", [second]);
      expect(await status("GOV-OWN-01"), "back to the accepted set").toBe("ACCEPTED");
      await sql("ALTER TABLE governance_principle_acceptances DISABLE TRIGGER USER");
      await sql("UPDATE governance_principle_acceptances SET accepted_at = now() - interval '2 days', expires_at = now() - interval '1 minute' WHERE id = $1", [id]);
      await sql("ALTER TABLE governance_principle_acceptances ENABLE TRIGGER USER");
      expect(await status("GOV-OWN-01"), "an expired acceptance accepts nothing").toBe("NOT_RESPECTED");
      await sql("UPDATE risks SET deleted_at = now() WHERE id = $1", [first]);
      expect(await status("GOV-OWN-01"), "no offender left: RESPECTED, not ACCEPTED").toBe("RESPECTED");
    });
    it("masking on the acceptance: acceptedBy / confirmedBy are null without audit.read (Risk Manager, Committee), shown to Audit", async () => {
      const r = randomUUID();
      await sql("INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ($1, $2, 'QA', 'ACC-3', 'ACTIVE', NULL, 'CLIENT')", [r, T]);
      await sql("UPDATE governance_principle_acceptances SET status = 'REVOKED', ended_by = $1, ended_at = now(), end_reason = 'QA' WHERE status IN ('ACTIVE', 'PENDING')", [UID.aud]).catch(() => null);
      const a = await accept("rm", "GOV-OWN-01");
      expect(a.status, a.text).toBe(201);
      expect((await post("com", `/governance-principle-acceptances/${a.json.data.id}/confirm`, {})).status).toBe(200);
      const named = pr(await panel("aud"), "GOV-OWN-01").acceptance!;
      expect([named["acceptedBy"], named["confirmedBy"]]).toEqual([UID.rm, UID.com]);
      for (const w of ["rm", "com", "adm"] as const) {
        const masked = pr(await panel(w), "GOV-OWN-01").acceptance!;
        expect([masked["acceptedBy"], masked["confirmedBy"]], w).toEqual([null, null]);
      }
      await sql("UPDATE risks SET deleted_at = now() WHERE id = $1", [r]);
    });
  });

  // ------------------------------------------------------------------------------------------------ EXCEPTIONS + MASKING
  describe("exceptions block and masking (R-6.1)", () => {
    it("total / unreviewed / age / overdue (q168 / q180): counts exact, vacancy trace counted in the total but never overdue, reviewed ones not overdue, no delay => never overdue", async () => {
      await sql("UPDATE tenants SET governance_tracking_started_at = clock_timestamp() - interval '30 days' WHERE id = $1", [T]);
      await sql("UPDATE configs SET exception_review_delay_days = 5 WHERE tenant_id = $1", [T]);
      const base = (await panel("aud")).exceptions;
      const old = await mark({ rule: "config.cumul.adminAlone", user: "rm", at: "(clock_timestamp() - interval '8 days')", reason: "Ancienne" });
      const fresh = await mark({ rule: "config.cumul.adminAlone", user: "n1", at: "(clock_timestamp() - interval '1 day')" });
      const vac = await mark({ rule: "riskManager.vacancy", user: "adm", entityType: "User", at: "(clock_timestamp() - interval '9 days')" });
      const done = await mark({ rule: "config.cumul.adminAlone", user: "rm", at: "(clock_timestamp() - interval '7 days')" });
      await sql("INSERT INTO governance_exception_reviews (tenant_id, audit_log_id, outcome, reviewed_by, comment) VALUES ($1, $2, 'REVIEWED', $3, 'QA')", [T, done, UID.aud]);
      const p = await panel("aud");
      const by = (id: string) => p.exceptions.items.find((i) => i.auditId === id)!;
      expect(p.exceptions.total - base.total).toBe(4);
      expect(p.exceptions.unreviewed - base.unreviewed).toBe(2);
      expect(p.exceptions.reviewDelayDays).toBe(5);
      expect([by(old).overdue, by(fresh).overdue, by(vac).overdue, by(done).overdue]).toEqual([true, false, false, false]);
      expect([by(old).ageDays, by(fresh).ageDays]).toEqual([8, 1]);
      expect([by(old).reviewed, by(done).reviewed]).toEqual([false, true]);
      expect(by(old).userId).toBe(UID.rm);
      await sql("UPDATE configs SET exception_review_delay_days = NULL WHERE tenant_id = $1", [T]);
      expect((await panel("aud")).exceptions.items.some((i) => i.overdue)).toBe(false);
      await sql("UPDATE configs SET exception_review_delay_days = 5 WHERE tenant_id = $1", [T]);
    });
    it("without audit.read no author is named on an exception (userId, userLabel null) but `mine` lets a reviewer recognise his own; Audit sees the names", async () => {
      const items = async (w: Who) => (await panel(w)).exceptions.items;
      const a = await items("aud");
      expect(a.every((i) => i.userId !== null && i.userLabel !== null)).toBe(true);
      for (const w of ["rm", "com", "adm"] as const) {
        const m = await items(w);
        expect(m.length, w).toBe(a.length);
        expect(m.every((i) => i.userId === null && i.userLabel === null), w).toBe(true);
      }
      const mine = (await items("rm")).filter((i) => i.mine).length;
      expect(mine).toBe(a.filter((i) => i.userId === UID.rm).length);
      expect(mine).toBeGreaterThan(0);
    });
    it("without audit.read the USER offenders become « Personne N » (stable inside one answer, distinct per person), no id, no name; counts stay; GROUP / ROLE / PROCESS objects stay readable", async () => {
      await sql("INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $3), ($1, $2, $4, $4)", [T, R_PLAIN, UID.dept, UID.named]);
      try {
        const named = pr(await panel("aud"), "GOV-SOD-03");
        expect(named.offenders.map((o) => o["label"]).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(["QA dept", "QA named"]);
        const text = await get("rm", "/governance-health");
        const m = pr(text.json.data, "GOV-SOD-03");
        expect(m.status).toBe("NOT_RESPECTED");
        expect(m.offenders).toHaveLength(2);
        expect(m.offenders.map((o) => o["label"]).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(["Personne 1", "Personne 2"]);
        expect(m.offenders.every((o) => o["id"] === null)).toBe(true);
        expect(text.text).not.toContain("QA dept");
        expect(text.text).not.toContain("QA named");
        expect(text.text).not.toContain(UID.dept);
        expect(text.text).not.toContain(UID.named);
        // other users never leak through details either: SOD-04 detail carries roles, not names
        const cumul = await get("com", "/governance-health");
        expect(cumul.text).not.toMatch(/dept@vv1|named@vv1/);
      } finally {
        await sql("UPDATE user_roles SET revoked_at = now() WHERE role_id = $1", [R_PLAIN]);
      }
    });
    it.fails("QA-D6-01: an exception on a person's account (entityType User) does not hand that person's identifier to a reader without audit.read", async () => {
      const victim = UID.dept;
      await mark({ rule: "riskManager.vacancy", user: "adm", entityType: "User", entityId: victim, action: "UPDATE", reason: "Départ du dernier Risk Manager" });
      for (const w of ["rm", "com", "adm"] as const) expect((await get(w, "/governance-health")).text, w).not.toContain(victim);
      expect((await get("aud", "/governance-health")).text).toContain(victim);
    });
    it.fails("QA-D6-02: a list cut at 50 offenders says so (a count or the full list): 55 ownerless risks must not look like 50", async () => {
      const ids = Array.from({ length: 55 }, () => randomUUID());
      for (const id of ids) await sql("INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ($1, $2, 'QA55', 'QA55', 'ACTIVE', NULL, 'CLIENT')", [id, T]);
      try {
        const x = pr(await panel("aud"), "GOV-OWN-01");
        const shown = x.offenders.length;
        const total = Math.max(shown, ...x.offenders.map((o) => Number(o["count"] ?? 0)));
        expect(total, `shown ${shown}`).toBe(55);
      } finally { await sql("UPDATE risks SET deleted_at = now() WHERE process = 'QA55'"); }
    });
    it("no date per person leaks without audit.read: last_seen_at / last_token_iat are not in the answer for any reader", async () => {
      await sql("UPDATE users SET last_seen_at = '2031-02-03T04:05:06Z', last_token_iat = 1927000000");
      for (const w of ["aud", "rm", "com", "adm"] as const) {
        const t = (await get(w, "/governance-health")).text;
        expect(t, w).not.toContain("2031-02-03");
        expect(t, w).not.toMatch(/last_?[sS]een/);
      }
    });
    it("a restricted risk's label is never returned, to any reader (PERIMETRE and NOMINATIF), while its gap counts", async () => {
      const ids = [randomUUID(), randomUUID()];
      await sql("INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ($1, $3, 'QA', 'SECRET-PERIM', 'ACTIVE', NULL, 'PERIMETRE'), ($2, $3, 'QA', 'SECRET-NOMIN', 'ACTIVE', NULL, 'NOMINATIF')", [ids[0], ids[1], T]);
      try {
        for (const w of ["aud", "rm", "com", "adm"] as const) {
          const r = await get(w, "/governance-health");
          expect(r.text, w).not.toMatch(/SECRET-/);
          expect(pr(r.json.data, "GOV-OWN-01").offenders.length, w).toBeGreaterThanOrEqual(2);
        }
      } finally { await sql("UPDATE risks SET deleted_at = now() WHERE id = ANY($1::uuid[])", [ids]); }
    });
  });

  // ------------------------------------------------------------------------------------------------ R3
  describe("R3: configs.last_seen_retention_days and POST /privacy/last-seen-purge", () => {
    const U = { old: randomUUID(), edge1: randomUUID(), edge2: randomUUID(), tokenOnly: randomUUID(), active: randomUUID(), other: randomUUID(), noDate: randomUUID() };
    const lastSeen = (id: string) => sql<{ last_seen_at: Date | null; last_token_iat: Date | null }>("SELECT last_seen_at, last_token_iat FROM users WHERE id = $1", [id]);
    const purge = (w: Who | null) => call(w, "POST", "/privacy/last-seen-purge", {});
    const ended = (id: string, tenant: string, name: string, endedDaysAgo: number | null, seen: boolean, token: boolean) =>
      sql(`INSERT INTO users (id, tenant_id, email, display_name, roles, last_seen_at, last_token_iat, deleted_at) VALUES ($1, $2, $3, $4, '{}',
        ${seen ? "'2030-06-07T08:09:10Z'" : "NULL"}, ${token ? "1906000000" : "NULL"}, ${endedDaysAgo === null ? "NULL" : `now() - interval '${endedDaysAgo * 24 + 12} hours'`})`,
      [id, tenant, `${name}@d6.test`, name]);
    beforeAll(async () => {
      await ended(U.old, T, "r3-old", 1900, true, true);
      await ended(U.edge1, T, "r3-edge-after", 1826, true, false); // 1826 days + 12 h ago: past the 5 years
      await ended(U.edge2, T, "r3-edge-before", 1825, true, true); // 1825 days + 12 h: not yet (1825.5 < 1826)
      await ended(U.tokenOnly, T, "r3-token", 2000, false, true);
      await ended(U.active, T, "r3-active", null, true, true);
      await ended(U.noDate, T, "r3-nodate", 3000, false, false);
      await sql("INSERT INTO tenants (id, name) VALUES ($1, 'QA autre client') ON CONFLICT DO NOTHING", [T2]);
      await ended(U.other, T2, "r3-other", 4000, true, true);
    });
    it("config: the default is 1826 days; the column refuses 0, 3651, negatives; 1 and 3650 are accepted; NULL means never erased", async () => {
      expect((await sql<{ d: number | null }>("SELECT last_seen_retention_days AS d FROM configs WHERE tenant_id = $1", [T]))[0]!.d).toBe(1826);
      for (const bad of [0, -1, 3651]) await expect(sql("UPDATE configs SET last_seen_retention_days = $2 WHERE tenant_id = $1", [T, bad]), String(bad)).rejects.toThrow(/last_seen_retention_days|check/i);
      for (const ok of [1, 3650, 1826]) await sql("UPDATE configs SET last_seen_retention_days = $2 WHERE tenant_id = $1", [T, ok]);
    });
    it("the governance-delays route bounds it 1..3650 as integers (400 otherwise, nothing written) and rejects unknown keys", async () => {
      for (const bad of [0, 3651, 1.5, "5", -3]) {
        const r = await call("adm", "PUT", "/config/governance-delays", { lastSeenRetentionDays: bad, reason: "QA borne" });
        expect(r.status, JSON.stringify(bad)).toBe(400);
      }
      expect((await call("adm", "PUT", "/config/governance-delays", { lastSeenRetentionDays: 100, reason: "" })).status, "reason mandatory").toBe(400);
      expect((await sql<{ d: number }>("SELECT last_seen_retention_days AS d FROM configs WHERE tenant_id = $1", [T]))[0]!.d).toBe(1826);
    });
    it("circuit: shortening the retention applies at once (audited, with the reason); lengthening it or switching it off (null) is a request awaiting a second person, the value does not move", async () => {
      const set = (v: number | null) => call("adm", "PUT", "/config/governance-delays", { lastSeenRetentionDays: v, reason: "QA R3 circuit" });
      const cur = async () => (await sql<{ d: number | null }>("SELECT last_seen_retention_days AS d FROM configs WHERE tenant_id = $1", [T]))[0]!.d;
      const short = await set(1500);
      expect(short.status, short.text.slice(0, 80)).toBeLessThan(300);
      expect(await cur()).toBe(1500);
      expect((await sql<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'Config' AND reason = 'QA R3 circuit'"))[0]!.n).toBeGreaterThanOrEqual(1);
      const never = await set(null);
      expect(never.status, never.text.slice(0, 80)).toBe(202);
      expect(await cur(), "null = never erased is a lengthening: not applied without a second person").toBe(1500);
      expect(never.json.pendingRequest).toBeTruthy();
      const longer = await set(3000);
      expect([202, 409].includes(longer.status), longer.text.slice(0, 120)).toBe(true);
      expect(await cur()).toBe(1500);
      await sql("ALTER TABLE configs DISABLE TRIGGER USER");
      await sql("UPDATE configs SET last_seen_retention_days = 1826 WHERE tenant_id = $1", [T]);
      await sql("ALTER TABLE configs ENABLE TRIGGER USER");
    });
    it("permissions: 401 anonymous, 403 without user.update (out, dept, rm), 200 for an administrator holding user.update", async () => {
      expect((await purge(null)).status).toBe(401);
      for (const w of ["out", "dept", "rm", "com"] as const) expect((await purge(w)).status, w).toBe(403);
    });
    it("bounds at 1826 days: an account ended 1826 days + 12 h ago is erased (date and token date), one ended 1825.5 days ago, an active account, and another tenant's account are NOT; an ended account with nothing to erase is not counted", async () => {
      const r = await purge("adm");
      expect(r.status, r.text).toBe(200);
      expect(r.json.data.retentionDays).toBe(1826);
      expect(r.json.data.erased).toBe(3); // old, edge1, tokenOnly
      for (const id of [U.old, U.edge1, U.tokenOnly]) expect(await lastSeen(id), id).toEqual([{ last_seen_at: null, last_token_iat: null }]);
      for (const id of [U.edge2, U.active, U.other]) expect((await lastSeen(id))[0]!.last_seen_at, id).not.toBeNull();
      expect((await lastSeen(U.edge2))[0]!.last_token_iat).not.toBeNull();
      const row = await sql<{ deleted_at: Date | null }>("SELECT deleted_at FROM users WHERE id = $1", [U.old]);
      expect(row[0]!.deleted_at, "the account itself is untouched (erase, never delete)").not.toBeNull();
    });
    it("audit: one UPDATE row per erased account, by the caller, with the retention in the reason, no erased date anywhere in the journal; none for untouched accounts", async () => {
      const rows = await sql<{ entity_id: string; user_id: string; action: string; old_value: unknown; new_value: any; reason: string }>(
        "SELECT entity_id::text, user_id, action, old_value, new_value, reason FROM audit_log WHERE entity_type = 'User' AND reason LIKE 'Conservation R3%' ORDER BY entity_id");
      expect(rows.map((r) => r.entity_id).sort((a, b) => a.localeCompare(b))).toEqual([U.old, U.edge1, U.tokenOnly].sort((a, b) => a.localeCompare(b)));
      for (const r of rows) {
        expect(r).toMatchObject({ user_id: UID.adm, action: "UPDATE", old_value: null });
        expect(r.new_value).toMatchObject({ lastSeenAt: null, lastTokenIat: null, purge: "R3" });
        expect(r.reason).toContain("1826 jours");
        expect(JSON.stringify(r)).not.toContain("2030-06-07");
      }
    });
    it("idempotent: a second pass erases nothing and writes no new audit row", async () => {
      const before = (await sql<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE reason LIKE 'Conservation R3%'"))[0]!.n;
      const r = await purge("adm");
      expect(r.json.data).toEqual({ retentionDays: 1826, erased: 0 });
      expect((await sql<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE reason LIKE 'Conservation R3%'"))[0]!.n).toBe(before);
    });
    it("a shorter retention reaches more accounts at the next pass (1000 days => the 1825.5-day one); 1 day => anyone ended more than a day ago", async () => {
      await sql("UPDATE configs SET last_seen_retention_days = 1000 WHERE tenant_id = $1", [T]);
      const r = await purge("adm");
      expect(r.json.data).toEqual({ retentionDays: 1000, erased: 1 });
      expect((await lastSeen(U.edge2))[0]).toEqual({ last_seen_at: null, last_token_iat: null });
      const fresh = randomUUID(), recent = randomUUID();
      await ended(fresh, T, "r3-fresh", 0, true, true); // ended 12 h ago
      await ended(recent, T, "r3-recent", 2, true, true);
      await sql("UPDATE configs SET last_seen_retention_days = 1 WHERE tenant_id = $1", [T]);
      expect((await purge("adm")).json.data).toEqual({ retentionDays: 1, erased: 1 });
      expect((await lastSeen(fresh))[0]!.last_seen_at, "ended 12 h ago, retention 1 day").not.toBeNull();
      expect((await lastSeen(recent))[0]!.last_seen_at).toBeNull();
    });
    it("NULL retention = never erased: nothing is touched, nothing is audited; no configuration row at all => default 1826", async () => {
      await sql("UPDATE configs SET last_seen_retention_days = NULL WHERE tenant_id = $1", [T]);
      const keep = randomUUID();
      await ended(keep, T, "r3-keep", 9000, true, true);
      expect((await purge("adm")).json.data).toEqual({ retentionDays: null, erased: 0 });
      expect((await lastSeen(keep))[0]!.last_seen_at).not.toBeNull();
      await sql("UPDATE configs SET last_seen_retention_days = 1826 WHERE tenant_id = $1", [T]);
      const saved = (await sql<{ v: unknown }>("SELECT to_jsonb(c) AS v FROM configs c WHERE tenant_id = $1", [T]))[0]!.v;
      await sql("ALTER TABLE configs DISABLE TRIGGER USER");
      await sql("DELETE FROM configs WHERE tenant_id = $1", [T]);
      const r = await purge("adm");
      expect(r.json.data.retentionDays).toBe(1826);
      expect(r.json.data.erased).toBe(1); // keep
      await sql("INSERT INTO configs (tenant_id) VALUES ($1)", [T]);
      await sql("ALTER TABLE configs ENABLE TRIGGER USER");
      expect(saved).toBeTruthy();
    });
    it("the purge cannot be pointed at another tenant: no parameter is read from the body or query", async () => {
      const other = (await lastSeen(U.other))[0]!;
      const r = await call("adm", "POST", `/privacy/last-seen-purge?tenantId=${T2}`, { tenantId: T2, retentionDays: 1 });
      expect(r.status).toBe(200);
      expect(r.json.data.retentionDays, "the tenant's own setting is used").not.toBe(1);
      expect((await lastSeen(U.other))[0]).toEqual(other);
    });
    it("rate limit: the per-user cap answers 429 (not 5xx) once exceeded", async () => {
      let last = 200;
      for (let i = 0; i < 25 && last !== 429; i++) last = (await purge("adm")).status;
      expect(last).toBe(429);
    });
  });

  // ------------------------------------------------------------------------------------------------ R5
  describe("R5: GET /privacy/notice", () => {
    it("401 anonymous; any signed-in person (even without any right) gets the retention of THEIR client and no DPO contact; the value follows the configuration", async () => {
      expect((await call(null, "GET", "/privacy/notice")).status).toBe(401);
      await sql("UPDATE configs SET last_seen_retention_days = 1826 WHERE tenant_id = $1", [T]);
      for (const w of ["out", "dept", "rm", "aud"] as const) expect((await get(w, "/privacy/notice")).json.data, w).toEqual({ lastSeenRetentionDays: 1826, dpoContact: null });
      await sql("UPDATE configs SET last_seen_retention_days = 1000 WHERE tenant_id = $1", [T]);
      expect((await get("out", "/privacy/notice")).json.data.lastSeenRetentionDays).toBe(1000);
      await sql("UPDATE configs SET last_seen_retention_days = NULL WHERE tenant_id = $1", [T]);
      expect((await get("out", "/privacy/notice")).json.data.lastSeenRetentionDays).toBeNull();
      await sql("UPDATE configs SET last_seen_retention_days = 1826 WHERE tenant_id = $1", [T]);
    });
  });
});
