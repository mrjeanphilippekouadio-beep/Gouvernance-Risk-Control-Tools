import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, qaVisibilityHarness } from "./qaVisibilityHarness.js";

/**
 * QA-visibility-v4bis (level 2), second version: DECISION-115 (q228 A). The « moins de 5 » threshold is gone from the dashboards and reports (their exact
 * values are back) and applies to `GET /hidden-counts` only: for each type, 0 hidden item => 0 (no mention), 1 to 4 => `{ belowThreshold: true }`
 * (the number is never sent), 5 and more => the exact number, null for the fixed groups. The screen shows « Moins de 5 éléments non visibles (accès restreint). »
 * Oracles written BEFORE running, from the decision. Not a Security / Privacy / Compliance opinion.
 *
 * Live part: QA_VIS4B_LIVE=1 + LOCAL cluster of tests/integration/qa-visibility-v1-setup.sh (127.0.0.1:55442, never a remote host); own base
 * (grc_qa_vv4bt) is rebuilt: run live suites with --no-file-parallelism. `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 */
const live = process.env["QA_VIS4B_LIVE"] === "1";
const DB = "grc_qa_vv4bt";
const PORT = 8096;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const T = I("001");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("QA-visibility-v4bis STATIC", () => {
  it("the threshold is gone from the dashboard service (no belowThreshold field, no q224 helper) and kept only in resourceVisibility.hiddenCounts", () => {
    expect(read("backend", "src", "services", "DashboardService.ts")).not.toMatch(/belowThreshold|SMALL_CELL_THRESHOLD/);
    const r = read("backend", "src", "services", "resourceVisibility.ts");
    expect(r).toMatch(/SMALL_CELL_THRESHOLD = 5/);
    expect(r).toMatch(/n > 0 && n < SMALL_CELL_THRESHOLD \? \{ belowThreshold: true \} : n/);
  });
  it("the screen text is the decided one, under the five lists", () => {
    expect(read("frontend", "src", "features", "risks", "HiddenCountNotice.tsx")).toContain("Moins de 5 éléments non visibles (accès restreint).");
    for (const [f, t] of [["risks/RisksPage", "RISK"], ["controls/ControlsPage", "CONTROL"], ["anomalies/AnomaliesPage", "ANOMALY"], ["actions/ActionPlansPage", "ACTION_PLAN"], ["indicators/KpiPage", "KPI"]]) {
      expect(read("frontend", "src", "features", `${f}.tsx`), f).toContain(`<HiddenCountNotice token={token} type="${t}" />`);
    }
  });
});

type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
const READER: Who = "named"; // ordinary reader; reads a hidden item only through an explicit grant
const OUTSIDER: Who = "out2"; // ordinary reader without any grant
const TYPES = ["RISK", "CONTROL", "KPI", "ANOMALY", "ACTION_PLAN"] as const;
type Type = (typeof TYPES)[number];
type Level = "CLIENT" | "PERIMETRE" | "NOMINATIF";
const BELOW = { belowThreshold: true };

const H = qaVisibilityHarness({ db: DB, port: PORT, who: WHO, uid: UID });
const { sql, get } = H;
const counts = async (w: Who) => { const r = await get(w, "/hidden-counts"); expect(r.status, `${w}: ${r.text.slice(0, 160)}`).toBe(200); return r.json.data as Record<string, unknown> | null; };
const data = async (w: Who, path: string) => { const r = await get(w, path); expect(r.status, `${w} ${path}: ${r.text.slice(0, 200)}`).toBe(200); return r.json.data; };
/** What the decision says for n hidden items of one type. */
const expected = (n: number) => (n === 0 ? 0 : n < 5 ? BELOW : n);

/** Empties the world (test base, hard deletes allowed) then seeds `n[type]` items of `level` per type (the owner / declarer is `own`). */
async function seed(n: Partial<Record<Type, number>>, level: Level = "PERIMETRE", extra: Partial<Record<Type, Array<{ level: Level; grantTo?: Who }>>> = {}) {
  await sql("UPDATE risks SET deleted_at = now() WHERE deleted_at IS NULL");
  await sql("UPDATE controls SET deleted_at = now() WHERE deleted_at IS NULL");
  await sql("UPDATE kpis SET deleted_at = now() WHERE deleted_at IS NULL");
  await sql("DELETE FROM anomalies");
  await sql("DELETE FROM action_plans");
  const ids: Record<Type, string[]> = { RISK: [], CONTROL: [], KPI: [], ANOMALY: [], ACTION_PLAN: [] };
  const grant = (type: string, id: string, who: Who) =>
    sql("INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason) VALUES ($1, $2, $3, $4, $5, 'QA')", [T, type, id, UID[who], UID.own]);
  for (const type of TYPES) {
    const all = [...Array.from({ length: n[type] ?? 0 }, () => ({ level })), ...(extra[type] ?? [])] as Array<{ level: Level; grantTo?: Who }>;
    for (const [i, item] of all.entries()) {
      const id = randomUUID();
      ids[type].push(id);
      if (type === "RISK") await sql("INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ($1, $2, $3, 'QA4B', 'ACTIVE', $4, $5)", [id, T, `QA4B-${i}`, UID.own, item.level]);
      if (type === "CONTROL") await sql("INSERT INTO controls (id, tenant_id, label, control_type, frequency, executor, compliance_criteria, visibility) VALUES ($1, $2, $3, 'PREVENTIVE', 'MONTHLY', 'x', 'y', $4)", [id, T, `QA4B-C${i}`, item.level]);
      if (type === "KPI") await sql("INSERT INTO kpis (id, tenant_id, label, target_value, unit, frequency, owner, department_id, visibility) VALUES ($1, $2, $3, 1, 'u', 'MONTHLY', 'x', 'aaaaaaaa-0000-4000-8000-000000000201', $4)", [id, T, `QA4B-K${i}`, item.level]);
      if (type === "ANOMALY") await sql("INSERT INTO anomalies (id, tenant_id, description, severity, detected_by, visibility) VALUES ($1, $2, 'QA4B', 'LOW', $3, $4)", [id, T, UID.own, item.level]);
      if (type === "ACTION_PLAN") await sql("INSERT INTO action_plans (id, tenant_id, title, source_type, responsible_user_id, due_date, created_by, visibility) VALUES ($1, $2, 'QA4B', 'MANAGEMENT', $3, current_date + 30, $3, $4)", [id, T, UID.own, item.level]);
      if (item.grantTo) await grant(type === "ACTION_PLAN" ? "ACTION_PLAN" : type, id, item.grantTo);
    }
  }
  return ids;
}

describe.skipIf(!live)("QA-visibility-v4bis on the REAL server + LOCAL PostgreSQL 16", () => {
  beforeAll(() => H.start(async () => {
    await sql("UPDATE users SET roles = roles || ARRAY['dashboard.executive','dashboard.read','execution.read','effectiveness.read']::text[]");
    await sql("TRUNCATE anomalies, action_plans CASCADE");
    // out = administrator by ROLE holding an APPROVED resource.readall (kind RESOURCE_READALL, migration 084; opens PERIMETRE, never NOMINATIF)
    const role = randomUUID();
    await sql("INSERT INTO roles (id, tenant_id, name, permissions) VALUES ($1, $2, 'QA4B Admins', '{role.assign,role.read}')", [role, T]);
    await sql("INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)", [T, role, UID.out, UID.adm]);
    const g = randomUUID();
    await sql("INSERT INTO sensitive_view_grants (id, tenant_id, user_id, reason, requested_by, kind) VALUES ($1, $2, $3, 'QA', $4, 'RESOURCE_READALL')", [g, T, UID.out, UID.adm]);
    await sql("UPDATE sensitive_view_grants SET status = 'APPROVED', decided_by = $2, decided_at = now(), access_expires_at = now() + interval '30 days' WHERE id = $1", [g, UID.aud]);
  }), 280000);
  afterAll(() => H.stop());

  // ------------------------------------------------------------------------------------------------ HIDDEN COUNTS
  describe("GET /hidden-counts: 0 / 1-4 / 5+ per type", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 12]) {
      it(`${n} hidden item(s) of every type => ${JSON.stringify(expected(n))} per type for an ordinary reader without access`, async () => {
        await seed({ RISK: n, CONTROL: n, KPI: n, ANOMALY: n, ACTION_PLAN: n });
        const c = await counts(OUTSIDER);
        expect(c).toEqual({ RISK: expected(n), CONTROL: expected(n), KPI: expected(n), ANOMALY: expected(n), ACTION_PLAN: expected(n) });
      });
    }
    it("types are judged independently: RISK 0, CONTROL 1, KPI 4, ANOMALY 5, ACTION_PLAN 6 => 0, below, below, 5, 6", async () => {
      await seed({ RISK: 0, CONTROL: 1, KPI: 4, ANOMALY: 5, ACTION_PLAN: 6 });
      expect(await counts(OUTSIDER)).toEqual({ RISK: 0, CONTROL: BELOW, KPI: BELOW, ANOMALY: 5, ACTION_PLAN: 6 });
    });
    it("a below-threshold type never carries the number: no `count`, no digit, only the flag (checked on the raw body)", async () => {
      await seed({ RISK: 3, CONTROL: 7 });
      const r = await get(OUTSIDER, "/hidden-counts");
      expect(r.json.data.RISK).toStrictEqual({ belowThreshold: true });
      expect(r.text).not.toMatch(/"RISK":\{[^}]*[0-9]/);
      expect(r.json.data.CONTROL).toBe(7);
    });
    it("NOMINATIF and CLIENT items never count: 3 PERIMETRE + 10 NOMINATIF + 10 CLIENT risks => still below the threshold, 6 PERIMETRE + 10 NOMINATIF => exactly 6", async () => {
      await seed({ RISK: 3 }, "PERIMETRE", { RISK: [...Array(10).fill({ level: "NOMINATIF" }), ...Array(10).fill({ level: "CLIENT" })] });
      expect((await counts(OUTSIDER))!["RISK"]).toEqual(BELOW);
      await seed({ RISK: 6 }, "PERIMETRE", { RISK: Array(10).fill({ level: "NOMINATIF" }) });
      expect((await counts(OUTSIDER))!["RISK"]).toBe(6);
    });
    it("the threshold is on what the reader does NOT read: 6 PERIMETRE risks of which 2 are granted to him => 4 hidden => below; 1 granted => 5 hidden => exactly 5; all granted => 0", async () => {
      await seed({ RISK: 4 }, "PERIMETRE", { RISK: [{ level: "PERIMETRE", grantTo: READER }, { level: "PERIMETRE", grantTo: READER }] });
      expect((await counts(READER))!["RISK"]).toEqual(BELOW);
      expect((await counts(OUTSIDER))!["RISK"], "another reader sees 6").toBe(6);
      await seed({ RISK: 4 }, "PERIMETRE", { RISK: [{ level: "PERIMETRE", grantTo: READER }] });
      expect((await counts(READER))!["RISK"], "5 in total, 1 granted => 4 hidden").toEqual(BELOW);
      await seed({ RISK: 5 }, "PERIMETRE", { RISK: [{ level: "PERIMETRE", grantTo: READER }] });
      expect((await counts(READER))!["RISK"]).toBe(5);
      await seed({}, "PERIMETRE", { RISK: Array(3).fill({ level: "PERIMETRE", grantTo: READER }) });
      expect((await counts(READER))!["RISK"]).toBe(0);
    });
    it("the boundary follows the data at once: 5 hidden => 5, one is opened (level CLIENT) => 4 => below, a fifth is added => 5 again", async () => {
      const ids = await seed({ CONTROL: 5 });
      expect((await counts(OUTSIDER))!["CONTROL"]).toBe(5);
      await sql("UPDATE controls SET visibility = 'CLIENT' WHERE id = $1", [ids.CONTROL[0]]);
      expect((await counts(OUTSIDER))!["CONTROL"]).toEqual(BELOW);
      await sql("INSERT INTO controls (tenant_id, label, control_type, frequency, executor, compliance_criteria, visibility) VALUES ($1, 'QA4B-new', 'PREVENTIVE', 'MONTHLY', 'x', 'y', 'PERIMETRE')", [T]);
      expect((await counts(OUTSIDER))!["CONTROL"]).toBe(5);
      await sql("UPDATE controls SET deleted_at = now() WHERE label = 'QA4B-new'");
      expect((await counts(OUTSIDER))!["CONTROL"]).toEqual(BELOW);
    });
    it("fixed groups (Risk Manager, Committee, Audit) get null whatever the data; the holder of resource.readall reads every PERIMETRE item, so he gets 0 per type (no mention), never belowThreshold", async () => {
      await seed({ RISK: 3, CONTROL: 3, KPI: 3, ANOMALY: 3, ACTION_PLAN: 3 });
      for (const w of ["rm", "com", "aud"] as const) expect(await counts(w), w).toBeNull();
      expect(await counts("out")).toEqual({ RISK: 0, CONTROL: 0, KPI: 0, ANOMALY: 0, ACTION_PLAN: 0 });
    });
    it("the holder of resource.readall still has NOMINATIF hidden, but NOMINATIF is never counted: 3 NOMINATIF risks => 0, not below", async () => {
      await seed({ RISK: 3 }, "NOMINATIF");
      expect((await counts("out"))!["RISK"]).toBe(0);
      expect((await counts(OUTSIDER))!["RISK"]).toBe(0);
    });
    it("only the types the reader may list: without kpi.read no KPI key; the below-threshold flag is not sent for a type he cannot list", async () => {
      await seed({ RISK: 2, KPI: 2 });
      await sql("UPDATE users SET roles = array_remove(roles, 'kpi.read') WHERE email = 'out2@vv1.test'");
      try {
        const c = await counts(OUTSIDER);
        expect(Object.keys(c!).sort((a, b) => a.localeCompare(b))).toEqual(["ACTION_PLAN", "ANOMALY", "CONTROL", "RISK"]);
        expect(c!["RISK"]).toEqual(BELOW);
      } finally { await sql("UPDATE users SET roles = roles || ARRAY['kpi.read']::text[] WHERE email = 'out2@vv1.test'"); }
    });
    it("no difference leak: a type at 4 and the same type at 3 look identical (the flag), so the count cannot be recovered by adding or removing one item", async () => {
      await seed({ RISK: 4 });
      const four = JSON.stringify(await counts(OUTSIDER));
      await seed({ RISK: 3 });
      const three = JSON.stringify(await counts(OUTSIDER));
      expect(four).toBe(three);
    });
  });

  // ------------------------------------------------------------------------------------------------ DASHBOARDS
  describe("non-regression of the dashboards and reports: the exact values are back (no null, no belowThreshold)", () => {
    const ent = (n: number, e: string) => Array.from({ length: n }, () => e);
    /** n risks (visibility given, all granted to READER), one validated evaluation each, one NEW anomaly each. */
    async function seedRisks(levels: Level[], entities: string[] = [], scores: number[] = []) {
      await sql("UPDATE risks SET deleted_at = now() WHERE deleted_at IS NULL");
      await sql("DELETE FROM anomalies");
      for (const [i, level] of levels.entries()) {
        const id = randomUUID();
        await sql("INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ($1, $2, $3, 'QA4B', 'ACTIVE', $4, $5)", [id, T, `QA4B-${i}`, UID.own, level]);
        await sql(`INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, status, evaluator_id, sub_category, entity, inherent_probability, inherent_impact_retained, inherent_score,
          residual_probability, residual_impact_retained, residual_score) VALUES ($1, $2, 'AD_HOC', 'VALIDATED', $3, 'QA4B-SC', $4, 4, 4, 16, 3, 3, $5)`, [T, id, UID.own, entities[i] ?? "QA4B-A", scores[i] ?? 9]);
        if (level !== "CLIENT") await sql("INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason) VALUES ($1, 'RISK', $2, $3, $4, 'QA')", [T, id, UID[READER], UID.own]);
        await sql("INSERT INTO anomalies (tenant_id, risk_id, description, severity, detected_by) VALUES ($1, $2, 'QA4B', 'LOW', $3)", [T, id, UID.own]);
      }
    }
    for (const [label, levels] of [["4 risks incl. 1 PERIMETRE", ["CLIENT", "CLIENT", "CLIENT", "PERIMETRE"]], ["1 risk, NOMINATIF", ["NOMINATIF"]], ["4 restricted", ["PERIMETRE", "NOMINATIF", "PERIMETRE", "NOMINATIF"]], ["5 incl. 1 restricted", ["CLIENT", "CLIENT", "CLIENT", "CLIENT", "PERIMETRE"]]] as Array<[string, Level[]]>) {
      it(`executive dashboard, ${label}: totalActiveRisks and openAnomaliesCount are exact for the ordinary reader and the Risk Manager, with no belowThreshold`, async () => {
        await seedRisks(levels);
        for (const w of [READER, "rm"] as Who[]) {
          const v = await data(w, "/dashboard/executive");
          expect([v.totalActiveRisks, v.openAnomaliesCount], w).toEqual([levels.length, levels.length]);
          expect(v).not.toHaveProperty("belowThreshold");
        }
      });
    }
    it("consolidated report: an entity of 4 risks (1 restricted) shows riskCount 4, entity of 6 shows 6; no belowThreshold on any row", async () => {
      await seedRisks(["CLIENT", "CLIENT", "CLIENT", "PERIMETRE", "CLIENT", "CLIENT", "CLIENT", "CLIENT", "CLIENT", "NOMINATIF"], [...ent(4, "QA4B-A"), ...ent(6, "QA4B-B")]);
      const rows = (await data(READER, "/reports/consolidated")).entities as Array<{ entity: string; riskCount: number | null }>;
      expect([rows.find((r) => r.entity === "QA4B-A")!.riskCount, rows.find((r) => r.entity === "QA4B-B")!.riskCount]).toEqual([4, 6]);
      expect(JSON.stringify(rows)).not.toContain("belowThreshold");
    });
    it("appetite vs residual: a group of 4 with a restricted risk keeps its max score, exceedance count, flag and riskIds", async () => {
      await seedRisks(["CLIENT", "CLIENT", "CLIENT", "PERIMETRE"], [], [5, 7, 6, 12]);
      const rows = await data(READER, "/reports/appetite-vs-residual") as Array<{ maxResidualScore: number | null; exceedanceCount: number | null; exceeded: boolean | null; riskIds: string[] }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ maxResidualScore: 12, exceedanceCount: 0, exceeded: false });
      expect(rows[0]!.riskIds).toHaveLength(4);
      expect(JSON.stringify(rows)).not.toContain("belowThreshold");
    });
    it("compliance (both paths): 4 controls incl. a restricted one => totalControls 4 and both rates exact; overdueControlActions exact", async () => {
      await sql("UPDATE controls SET deleted_at = now() WHERE deleted_at IS NULL");
      await sql("DELETE FROM action_plans");
      const levels: Level[] = ["CLIENT", "CLIENT", "CLIENT", "PERIMETRE"];
      let restricted = "";
      for (const [i, level] of levels.entries()) {
        const id = randomUUID();
        if (level !== "CLIENT") restricted = id;
        await sql("INSERT INTO controls (id, tenant_id, label, control_type, frequency, executor, compliance_criteria, visibility) VALUES ($1, $2, $3, 'PREVENTIVE', 'MONTHLY', 'x', 'y', $4)", [id, T, `QA4B-C${i}`, level]);
        await sql("INSERT INTO control_executions (tenant_id, control_id, planned_date, executed_by, status) VALUES ($1, $2, current_date, $3, 'DONE')", [T, id, UID.own]);
        await sql("INSERT INTO control_effectiveness_assessments (tenant_id, control_id, evaluated_by, operational_effectiveness, justification) VALUES ($1, $2, $3, 'EFFECTIVE', 'j')", [T, id, UID.own]);
        if (level !== "CLIENT") await sql("INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason) VALUES ($1, 'CONTROL', $2, $3, $4, 'QA')", [T, id, UID[READER], UID.own]);
      }
      await sql("INSERT INTO action_plans (tenant_id, title, source_type, source_id, responsible_user_id, due_date, created_by) VALUES ($1, 'QA4B', 'CONTROL', $2, $3, current_date - 10, $3)", [T, restricted, UID.own]);
      for (const path of ["/dashboard/compliance?framework=ISO27001", "/reports/compliance?framework=ISO27001"]) {
        for (const w of [READER, "rm"] as Who[]) {
          const v = await data(w, path);
          expect(v, `${w} ${path}`).toMatchObject({ totalControls: 4, controlExecutionPassRate: 1, controlEffectivenessPassRate: 1, overdueControlActions: 1 });
          expect(v).not.toHaveProperty("belowThreshold");
        }
      }
    });
    it("the dashboard no longer leaks anything through the threshold: for the holder of readall and for the groups the values are the same exact ones", async () => {
      await seedRisks(["CLIENT", "CLIENT", "CLIENT", "PERIMETRE"]);
      for (const w of ["out", "com", "aud"] as Who[]) expect((await data(w, "/dashboard/executive")).totalActiveRisks, w).toBe(4);
    });
  });
});
