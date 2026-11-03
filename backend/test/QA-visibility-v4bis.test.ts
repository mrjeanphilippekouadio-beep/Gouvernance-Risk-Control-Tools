import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { qaVisibilityHarness } from "./qaVisibilityHarness.js";

/**
 * QA-visibility-v4bis (level 2): lot V4bis (DECISION-112, q224 A) « moins de 5 ». For a reader outside the fixed groups (Risk Manager, Committee, Audit)
 * every aggregate cell whose computation includes at least one restricted item (effective level other than CLIENT) and holds fewer than 5 items is
 * sent as null, its name listed in `belowThreshold`, derived scores included; the fixed groups and the holder of resource.readall get the real values.
 * Covered: executive dashboard (totalActiveRisks, openAnomaliesCount), consolidated report per entity (riskCount, criticalKriCount), appetite vs
 * residual per group (maxResidualScore, exceedanceCount, exceeded, riskIds emptied), compliance (totalControls + 2 rates, overdueControlActions).
 * Not covered on purpose: cartography and list views. Oracles written BEFORE running, from the decision. Not a Security / Privacy / Compliance opinion.
 *
 * Live part: QA_VIS4B_LIVE=1 + LOCAL cluster of tests/integration/qa-visibility-v1-setup.sh (127.0.0.1:55442, never a remote host); own base
 * (grc_qa_vv4bt) is rebuilt: run live suites with --no-file-parallelism. `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 */
const live = process.env["QA_VIS4B_LIVE"] === "1";
const DB = "grc_qa_vv4bt";
const PORT = 8096;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const T = I("001");

type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
const READER: Who = "named"; // ordinary reader, reads the restricted items through explicit grants only
const FIXED: Who[] = ["rm", "com", "aud"];
type Level = "CLIENT" | "PERIMETRE" | "NOMINATIF";
const C: Level = "CLIENT", P: Level = "PERIMETRE", N: Level = "NOMINATIF";

const H = qaVisibilityHarness({ db: DB, port: PORT, who: WHO, uid: UID });
const { sql, get } = H;
const data = async (w: Who, path: string) => { const r = await get(w, path); expect(r.status, `${w} ${path}: ${r.text.slice(0, 200)}`).toBe(200); return r.json.data; };

/** Empties the world, then seeds risks (one validated evaluation, entity / sub-category, one NEW anomaly each unless `anomalies` says which). */
async function seedRisks(levels: Level[], o: { entity?: string[]; score?: number[]; criticalKri?: number[]; anomalies?: number[]; sub?: string[] } = {}) {
  await sql("UPDATE risks SET deleted_at = now() WHERE deleted_at IS NULL");
  await sql("UPDATE kris SET deleted_at = now() WHERE deleted_at IS NULL");
  await sql("UPDATE anomalies SET status = 'CLOSED' WHERE status <> 'CLOSED'");
  const ids: string[] = [];
  for (const [i, level] of levels.entries()) {
    const id = randomUUID();
    ids.push(id);
    await sql("INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ($1, $2, $3, 'QA4B', 'ACTIVE', $4, $5)", [id, T, `QA4B-${i}`, UID.own, level]);
    await sql(`INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, status, evaluator_id, sub_category, entity, inherent_probability, inherent_impact_retained, inherent_score,
      residual_probability, residual_impact_retained, residual_score) VALUES ($1, $2, 'AD_HOC', 'VALIDATED', $3, $4, $5, 4, 4, 16, 3, 3, $6)`,
    [T, id, UID.own, o.sub?.[i] ?? "QA4B-SC", o.entity?.[i] ?? "QA4B-A", o.score?.[i] ?? 9]);
    if (level !== C) await sql("INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason) VALUES ($1, 'RISK', $2, $3, $4, 'QA')", [T, id, UID[READER], UID.own]);
    if ((o.anomalies ?? levels.map((_, k) => k)).includes(i)) await sql("INSERT INTO anomalies (tenant_id, risk_id, description, severity, detected_by) VALUES ($1, $2, 'QA4B', 'LOW', $3)", [T, id, UID.own]);
    if (o.criticalKri?.includes(i)) {
      const kri = randomUUID();
      await sql("INSERT INTO kris (id, tenant_id, label, formula, threshold_green, threshold_orange, threshold_red, frequency, risk_id, entity) VALUES ($1, $2, 'QA4B', 'f', 1, 2, 3, 'MONTHLY', $3, $4)", [kri, T, id, o.entity?.[i] ?? "QA4B-A"]);
      await sql("INSERT INTO kri_risks (tenant_id, kri_id, risk_id) VALUES ($1, $2, $3)", [T, kri, id]);
      await sql("INSERT INTO kri_measures (tenant_id, kri_id, measure_date, value, source, comment, recorded_by) VALUES ($1, $2, current_date, 99, 'QA', 'c', $3)", [T, kri, UID.own]);
    }
  }
  return ids;
}
/** Controls (+ one DONE execution and one EFFECTIVE assessment each) and overdue plans sourced on given controls. */
async function seedControls(levels: Level[], overdueOn: number[] = []) {
  await sql("UPDATE controls SET deleted_at = now() WHERE deleted_at IS NULL");
  await sql("UPDATE action_plans SET due_date = current_date + 365");
  const ids: string[] = [];
  for (const [i, level] of levels.entries()) {
    const id = randomUUID();
    ids.push(id);
    await sql("INSERT INTO controls (id, tenant_id, label, control_type, frequency, executor, compliance_criteria, visibility) VALUES ($1, $2, $3, 'PREVENTIVE', 'MONTHLY', 'x', 'y', $4)", [id, T, `QA4B-C${i}`, level]);
    await sql("INSERT INTO control_executions (tenant_id, control_id, planned_date, executed_by, status) VALUES ($1, $2, current_date, $3, 'DONE')", [T, id, UID.own]);
    await sql("INSERT INTO control_effectiveness_assessments (tenant_id, control_id, evaluated_by, operational_effectiveness, justification) VALUES ($1, $2, $3, 'EFFECTIVE', 'j')", [T, id, UID.own]);
    if (level !== C) await sql("INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason) VALUES ($1, 'CONTROL', $2, $3, $4, 'QA')", [T, id, UID[READER], UID.own]);
    if (overdueOn.includes(i)) {
      await sql("INSERT INTO action_plans (tenant_id, title, source_type, source_id, responsible_user_id, due_date, created_by) VALUES ($1, 'QA4B', 'CONTROL', $2, $3, current_date - 10, $3)", [T, id, UID.own]);
    }
  }
  return ids;
}
const expectHidden = (cells: Record<string, unknown>, names: string[], payload: { belowThreshold?: string[] }) => {
  for (const n of names) expect(cells[n], n).toBeNull();
  expect([...(payload.belowThreshold ?? [])].sort((a, b) => a.localeCompare(b))).toEqual([...names].sort((a, b) => a.localeCompare(b)));
};
const expectShown = (cells: Record<string, unknown>, expected: Record<string, unknown>, payload: { belowThreshold?: string[] }) => {
  expect(cells).toMatchObject(expected);
  expect(payload.belowThreshold ?? []).toEqual([]);
};

describe.skipIf(!live)("QA-visibility-v4bis on the REAL server + LOCAL PostgreSQL 16", () => {
  beforeAll(() => H.start(async () => {
    await sql("UPDATE users SET roles = roles || ARRAY['dashboard.executive','dashboard.read','execution.read','effectiveness.read']::text[]");
    // out = administrator by ROLE holding an APPROVED resource.readall (kind RESOURCE_READALL, migration 084; since q219 it opens PERIMETRE, never NOMINATIF)
    const role = randomUUID();
    await sql("INSERT INTO roles (id, tenant_id, name, permissions) VALUES ($1, $2, 'QA4B Admins', '{role.assign,role.read}')", [role, T]);
    await sql("INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)", [T, role, UID.out, UID.adm]);
    const g = randomUUID();
    await sql("INSERT INTO sensitive_view_grants (id, tenant_id, user_id, reason, requested_by, kind) VALUES ($1, $2, $3, 'QA', $4, 'RESOURCE_READALL')", [g, T, UID.out, UID.adm]);
    await sql("UPDATE sensitive_view_grants SET status = 'APPROVED', decided_by = $2, decided_at = now(), access_expires_at = now() + interval '30 days' WHERE id = $1", [g, UID.aud]);
  }), 280000);
  afterAll(() => H.stop());

  // ------------------------------------------------------------------------------------------------ EXECUTIVE
  describe("executive dashboard: totalActiveRisks, openAnomaliesCount", () => {
    const view = (w: Who) => data(w, "/dashboard/executive");
    it("sanity: the scenario engine gives the Risk Manager the true counts (4 risks, 4 anomalies)", async () => {
      await seedRisks([C, C, C, P]);
      const v = await view("rm");
      expect([v.totalActiveRisks, v.openAnomaliesCount]).toEqual([4, 4]);
    });
    for (const [label, levels, hidden] of [
      ["4 items, 1 PERIMETRE", [C, C, C, P], true], ["4 items, 1 NOMINATIF", [C, C, C, N], true], ["4 items, all restricted", [P, N, P, N], true],
      ["1 item, restricted", [P], true], ["4 items, all CLIENT (nothing restricted in the cell)", [C, C, C, C], false],
      ["5 items, 1 restricted (limit exact: shown)", [C, C, C, C, P], false], ["6 items, 2 restricted", [C, C, C, C, P, N], false],
      ["3 CLIENT + 2 restricted = 5", [C, C, C, P, N], false], ["0 item (empty cell holds nothing restricted)", [], false],
    ] as Array<[string, Level[], boolean]>) {
      it(`${label}: ordinary reader ${hidden ? "gets null + belowThreshold" : "gets the real values"}; fixed groups always the real ones`, async () => {
        await seedRisks(levels);
        const n = levels.length;
        const v = await view(READER);
        if (hidden) expectHidden(v, ["totalActiveRisks", "openAnomaliesCount"], v);
        else expectShown(v, { totalActiveRisks: n, openAnomaliesCount: n }, v);
        for (const w of FIXED) {
          const f = await view(w);
          expect([f.totalActiveRisks, f.openAnomaliesCount], w).toEqual([n, n]);
          expect(f.belowThreshold, w).toBeUndefined();
        }
      });
    }
    it("the cells are judged independently: 6 risks (1 restricted) but anomalies on 3 risks incl. the restricted one => only openAnomaliesCount hidden, and conversely", async () => {
      await seedRisks([C, C, C, C, C, P], { anomalies: [0, 1, 5] });
      let v = await view(READER);
      expect(v.totalActiveRisks).toBe(6);
      expectHidden({ openAnomaliesCount: v.openAnomaliesCount }, ["openAnomaliesCount"], v);
      await seedRisks([C, C, C, C, C, P], { anomalies: [0, 1, 2] }); // 3 anomalies, all on CLIENT risks: nothing restricted in the cell
      v = await view(READER);
      expect([v.totalActiveRisks, v.openAnomaliesCount]).toEqual([6, 3]);
      expect(v.belowThreshold).toBeUndefined();
    });
    it("holder of resource.readall (outside the fixed groups => ordinary reader for q224): reads PERIMETRE, so [C,C,C,P] gives him 4 items incl. a restricted one => null; [C,C,C,N] gives him 3 CLIENT => real 3", async () => {
      await seedRisks([C, C, C, P]);
      const a = await view("out");
      expectHidden(a, ["totalActiveRisks", "openAnomaliesCount"], a);
      await seedRisks([C, C, C, N]);
      const b = await view("out");
      expectShown(b, { totalActiveRisks: 3, openAnomaliesCount: 3 }, b);
      await seedRisks([C, C, C, C, P, P]);
      expectShown(await view("out"), { totalActiveRisks: 6, openAnomaliesCount: 6 }, await view("out"));
    });
    it("restricted items the reader cannot read are not part of his cell: 3 readable CLIENT + 1 hidden PERIMETRE for `out2` (no grant) => 3 shown, no belowThreshold", async () => {
      await seedRisks([C, C, C, P]);
      const v = await view("out2");
      expect([v.totalActiveRisks, v.openAnomaliesCount]).toEqual([3, 3]);
      expect(v.belowThreshold).toBeUndefined();
    });
    it("a risk stepped from PERIMETRE to CLIENT lifts the suppression at once (effective level read live)", async () => {
      const ids = await seedRisks([C, C, C, P]);
      expect((await view(READER)).totalActiveRisks).toBeNull();
      await sql("UPDATE risks SET visibility = 'CLIENT' WHERE id = $1", [ids[3]]);
      expect((await view(READER)).totalActiveRisks).toBe(4);
    });
    it("an anomaly follows its risk: CLIENT risks with an anomaly of the NOMINATIF risk counts as restricted", async () => {
      await seedRisks([C, C, C, N], { anomalies: [3] });
      const v = await view(READER);
      expect(v.openAnomaliesCount).toBeNull();
      expect(v.belowThreshold).toContain("openAnomaliesCount");
      expect(v.totalActiveRisks).toBeNull();
    });
    it.fails("no leak by difference between two cells: when a count is null, nothing else in the same payload gives it back (QA-V4B-01: topRisks lists the same risks)", async () => {
      await seedRisks([C, C, C, P]);
      const v = await view(READER);
      expect(v.totalActiveRisks).toBeNull();
      expect(v.topRisks.length, "topRisks (<= 5 here) re-derives the suppressed total").not.toBe(4);
    });
  });

  // ------------------------------------------------------------------------------------------------ CONSOLIDATED
  describe("consolidated report per entity: riskCount, criticalKriCount", () => {
    const rows = async (w: Who) => (await data(w, "/reports/consolidated")).entities as Array<{ entity: string; riskCount: number | null; criticalKriCount: number | null; belowThreshold?: string[]; topRisks: unknown[] }>;
    const by = (r: Awaited<ReturnType<typeof rows>>, e: string) => r.find((x) => x.entity === e)!;
    it("entity A has 4 risks (1 restricted), entity B 6 (1 restricted): A.riskCount hidden, B.riskCount shown; fixed groups see both", async () => {
      await seedRisks([C, C, C, P, C, C, C, C, C, N], { entity: ["A", "A", "A", "A", "B", "B", "B", "B", "B", "B"].map((e) => `QA4B-${e}`) });
      const r = await rows(READER);
      expect(by(r, "QA4B-A").riskCount).toBeNull();
      expect(by(r, "QA4B-A").belowThreshold).toContain("riskCount");
      expect(by(r, "QA4B-B").riskCount).toBe(6);
      expect(by(r, "QA4B-B").belowThreshold ?? []).toEqual([]);
      for (const w of FIXED) {
        const f = await rows(w);
        expect([by(f, "QA4B-A").riskCount, by(f, "QA4B-B").riskCount], w).toEqual([4, 6]);
        expect(by(f, "QA4B-A").belowThreshold, w).toBeUndefined();
      }
    });
    it("limit: 4 => hidden, 5 => shown (same entity, one restricted)", async () => {
      await seedRisks([C, C, C, P]);
      expect(by(await rows(READER), "QA4B-A").riskCount).toBeNull();
      await seedRisks([C, C, C, C, P]);
      expect(by(await rows(READER), "QA4B-A").riskCount).toBe(5);
    });
    it("criticalKriCount: 2 critical KRIs on risks incl. a restricted one => hidden even though riskCount (8) is shown; 2 critical KRIs on CLIENT risks => shown", async () => {
      await seedRisks([C, C, C, C, C, C, C, P], { criticalKri: [0, 7] });
      const rm = by(await rows("rm"), "QA4B-A");
      expect([rm.riskCount, rm.criticalKriCount]).toEqual([8, 2]);
      let a = by(await rows(READER), "QA4B-A");
      expect(a.riskCount).toBe(8);
      expect(a.criticalKriCount).toBeNull();
      expect(a.belowThreshold).toEqual(["criticalKriCount"]);
      await seedRisks([C, C, C, C, C, C, C, P], { criticalKri: [0, 1] });
      a = by(await rows(READER), "QA4B-A");
      expect([a.riskCount, a.criticalKriCount]).toEqual([8, 2]);
      expect(a.belowThreshold ?? []).toEqual([]);
    });
    it("5 critical KRIs incl. a restricted one: the limit is exact (shown)", async () => {
      await seedRisks([C, C, C, C, P], { criticalKri: [0, 1, 2, 3, 4] });
      const a = by(await rows(READER), "QA4B-A");
      expect([a.riskCount, a.criticalKriCount]).toEqual([5, 5]);
    });
    it.fails("no leak by difference between two cells: executive total minus the shown entity counts must not give a suppressed entity count (QA-V4B-02)", async () => {
      await seedRisks([C, C, C, P, C, C, C, C, C, C], { entity: ["A", "A", "A", "A", "B", "B", "B", "B", "B", "B"].map((e) => `QA4B-${e}`) });
      const total = (await data(READER, "/dashboard/executive")).totalActiveRisks as number | null;
      const r = await rows(READER);
      const suppressed = r.filter((x) => x.riskCount === null);
      expect(suppressed.length).toBe(1);
      const derived = total === null ? null : total - r.reduce((s, x) => s + (x.riskCount ?? 0), 0);
      expect(derived, "total - shown entities = suppressed entity count").not.toBe(4);
    });
  });

  // ------------------------------------------------------------------------------------------------ APPETITE
  describe("appetite vs residual per group (sub-category x entity)", () => {
    const rows = async (w: Who) => (await data(w, "/reports/appetite-vs-residual")) as Array<{ subCategory: string; entity: string | null; maxResidualScore: number | null; exceedanceCount: number | null; exceeded: boolean | null; riskIds: string[]; belowThreshold?: string[] }>;
    const row = (r: Awaited<ReturnType<typeof rows>>, entity: string) => r.find((x) => x.entity === entity)!;
    it("a group of 4 with a restricted risk: score, count, flag null, riskIds emptied, all four named; a group of 5 shown with its ids; fixed groups see both", async () => {
      const ids = await seedRisks([C, C, C, P, C, C, C, C, C], { entity: ["A", "A", "A", "A", "B", "B", "B", "B", "B"].map((e) => `QA4B-${e}`), score: [5, 7, 6, 12, 3, 4, 5, 6, 8] });
      const r = await rows(READER);
      const a = row(r, "QA4B-A"), b = row(r, "QA4B-B");
      expectHidden(a, ["maxResidualScore", "exceedanceCount", "exceeded"], { belowThreshold: a.belowThreshold?.filter((n) => n !== "riskIds") });
      expect(a.belowThreshold).toContain("riskIds");
      expect(a.riskIds).toEqual([]);
      expect(b).toMatchObject({ maxResidualScore: 8, exceedanceCount: 0, exceeded: false });
      expect(b.riskIds.sort((x, y) => x.localeCompare(y))).toEqual(ids.slice(4).sort((x, y) => x.localeCompare(y)));
      expect(b.belowThreshold ?? []).toEqual([]);
      for (const w of FIXED) {
        const f = row(await rows(w), "QA4B-A");
        expect(f, w).toMatchObject({ maxResidualScore: 12, exceedanceCount: 0, exceeded: false });
        expect(f.riskIds.length, w).toBe(4);
        expect(f.belowThreshold, w).toBeUndefined();
      }
    });
    it("a group of 4 CLIENT risks is not suppressed even when another group holds restricted ones; a group of 5 with a restricted one is shown", async () => {
      await seedRisks([C, C, C, C, C, C, C, C, P], { entity: ["A", "A", "A", "A", "B", "B", "B", "B", "B"].map((e) => `QA4B-${e}`) });
      const r = await rows(READER);
      expect(row(r, "QA4B-A").maxResidualScore).toBe(9);
      expect(row(r, "QA4B-B").maxResidualScore).toBe(9);
      expect(row(r, "QA4B-B").riskIds.length).toBe(5);
    });
    it("the score of a suppressed group does not come back through the response (no residual score, no id of the group anywhere)", async () => {
      const ids = await seedRisks([C, C, C, N], { score: [1, 2, 3, 25] });
      const r = await get(READER, "/reports/appetite-vs-residual");
      expect(r.text).not.toContain(ids[3]);
      expect(r.text).not.toContain('"maxResidualScore":25');
    });
  });

  // ------------------------------------------------------------------------------------------------ COMPLIANCE
  describe("compliance: totalControls + 2 rates, overdueControlActions", () => {
    for (const path of ["/dashboard/compliance?framework=ISO27001", "/reports/compliance?framework=ISO27001"]) {
      it(`${path}: 4 controls with a restricted one => totalControls and both rates hidden and named; 5 => shown; all CLIENT => shown; fixed groups real`, async () => {
        await seedControls([C, C, C, P]);
        const v = await data(READER, path);
        expectHidden(v, ["totalControls", "controlExecutionPassRate", "controlEffectivenessPassRate"], v);
        const rm = await data("rm", path);
        expect(rm).toMatchObject({ totalControls: 4, controlExecutionPassRate: 1, controlEffectivenessPassRate: 1 });
        expect(rm.belowThreshold).toBeUndefined();
        await seedControls([C, C, C, C, P]);
        expectShown(await data(READER, path), { totalControls: 5, controlExecutionPassRate: 1, controlEffectivenessPassRate: 1 }, await data(READER, path));
        await seedControls([C, C, C, C]);
        const all = await data(READER, path);
        expectShown(all, { totalControls: 4, controlExecutionPassRate: 1 }, all);
        for (const w of ["com", "aud"] as Who[]) expect((await data(w, path)).totalControls, w).toBe(4);
      });
    }
    it("overdueControlActions is its own cell: 6 controls (1 restricted) but 2 overdue plans incl. the restricted control's => only overdueControlActions hidden; plans on CLIENT controls only => shown", async () => {
      await seedControls([C, C, C, C, C, P], [0, 5]);
      const p = "/dashboard/compliance?framework=ISO27001";
      let v = await data(READER, p);
      expect(v.totalControls).toBe(6);
      expect(v.overdueControlActions).toBeNull();
      expect(v.belowThreshold).toEqual(["overdueControlActions"]);
      expect((await data("rm", p)).overdueControlActions).toBe(2);
      await seedControls([C, C, C, C, C, P], [0, 1]);
      v = await data(READER, p);
      expect(v.overdueControlActions).toBe(2);
      expect(v.belowThreshold ?? []).toEqual([]);
    });
    it("5 overdue plans incl. one on a NOMINATIF control: the limit is exact (shown, real value)", async () => {
      await seedControls([C, C, C, C, C, C, N], [6, 0, 1, 2, 3]);
      expect((await data(READER, "/dashboard/compliance?framework=X")).overdueControlActions).toBe(5);
    });
  });
});
