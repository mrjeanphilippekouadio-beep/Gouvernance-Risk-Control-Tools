import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, qaVisibilityHarness } from "./qaVisibilityHarness.js";

/**
 * QA-governance-d6bis (level 2): lot D6bis of the governance panel. q233 A: the A13 thresholds are adjustable per client with defaults and bounds
 * (RISK-01 share of risks owned directly by a Risk Manager 20 % [10-40]; ACC-01 (a) active administrators <= 3 [2-5], (b) custom role > 25 permissions [15-40]
 * or >= 4 families [3-6], fixed groups excluded, (c) dormant privileged account 90 days [45-180], NULL dormant only 90 days after trackedSince, never suspended;
 * OWN-01 (d) risks created AND owned by the same person 50 % [25-80], creator read in the CREATE entry of the journal; RISK-01 and OWN-01 (d) NOT_EVALUABLE
 * under 10 risks); raising a threshold needs a second person, lowering is direct. q234 C: GOV-SOD-04 is ALLOWED_BY_SETTING when the Committee + Audit
 * cumul is allowed (still NOT_RESPECTED: Risk Manager + Audit, a cumulant who validated own input, a cumul while the setting says « forbidden »).
 * DECISION-061: the cumul default is false for NEW rows, no existing row modified (migration 086).
 * Oracles written BEFORE running, from the decisions. Not a Security / Privacy / Compliance opinion.
 *
 * Live part: QA_GD6B_LIVE=1 + LOCAL cluster of tests/integration/qa-visibility-v1-setup.sh (127.0.0.1:55442, never a remote host); own base (grc_qa_gd6bt)
 * is rebuilt: run live suites with --no-file-parallelism. `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 */
const live = process.env["QA_GD6B_LIVE"] === "1";
const DB = "grc_qa_gd6bt";
const PORT = 8099;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const T = I("001");
const DAY = 86_400_000;
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const BOUNDS = {
  govRmRiskShareMaxPct: { col: "gov_rm_risk_share_max_pct", def: 20, min: 10, max: 40 },
  govMaxAdmins: { col: "gov_max_admins", def: 3, min: 2, max: 5 },
  govRoleMaxPermissions: { col: "gov_role_max_permissions", def: 25, min: 15, max: 40 },
  govRoleMaxFamilies: { col: "gov_role_max_families", def: 4, min: 3, max: 6 },
  govDormantDays: { col: "gov_dormant_days", def: 90, min: 45, max: 180 },
  govOwnerCreatorShareMaxPct: { col: "gov_owner_creator_share_max_pct", def: 50, min: 25, max: 80 },
} as const;
type Key = keyof typeof BOUNDS;

describe("QA-governance-d6bis STATIC", () => {
  it("migration 086: six NOT NULL columns with the A13 defaults and CHECK bounds, cumul DEFAULT false with no UPDATE, IF NOT EXISTS, no DELETE on a business table", () => {
    const sql = read("database", "postgresql", "migrations", "086_governance_thresholds.sql");
    for (const b of Object.values(BOUNDS)) expect(sql).toMatch(new RegExp(`${b.col} integer NOT NULL DEFAULT ${b.def}\\s+CHECK \\(${b.col} BETWEEN ${b.min} AND ${b.max}\\)`));
    expect(sql).toContain("ALTER COLUMN committee_audit_cumul_allowed SET DEFAULT false");
    expect(sql).not.toMatch(/\bUPDATE\b\s+configs|DELETE FROM/i);
    expect((sql.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length).toBe(6);
  });
  it("the TS bounds equal the migration's (one source each, no drift) and the service default of the cumul is false", () => {
    const cfg = read("backend", "src", "domain", "entities", "Config.ts");
    for (const [k, b] of Object.entries(BOUNDS)) expect(cfg).toMatch(new RegExp(`${k}: \\{ default: ${b.def}, min: ${b.min}, max: ${b.max} \\}`));
    expect(read("backend", "src", "services", "ConfigService.ts")).toMatch(/committeeAuditCumulAllowed: false,/);
  });
});

type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
const ADMIN_ROLE = I("3b1");

const H = qaVisibilityHarness({ db: DB, port: PORT, who: WHO, uid: UID });
const { sql, call, get } = H;

type Principle = { id: string; status: string; covers: string | null; notEvaluableReason: string | null; offenders: Array<Record<string, any>>; offendersTotal?: number };
type Panel = { principles: Principle[] };
const panel = async (w: Who = "aud"): Promise<Panel> => { const r = await get(w, "/governance-health"); expect(r.status, `${w}: ${r.text.slice(0, 200)}`).toBe(200); return r.json.data; };
const one = async (id: string, w: Who = "aud") => (await panel(w)).principles.find((p) => p.id === id)!;
const setCfg = (key: Key, v: number) => sql(`UPDATE configs SET ${BOUNDS[key].col} = $2 WHERE tenant_id = $1`, [T, v]);
const resetCfg = () => sql(`UPDATE configs SET ${Object.values(BOUNDS).map((b) => `${b.col} = ${b.def}`).join(", ")}, committee_audit_cumul_allowed = false WHERE tenant_id = $1`, [T]);
const groupRole = async (group: string) => (await sql<{ id: string }>("SELECT id FROM roles WHERE tenant_id = $1 AND system_group = $2", [T, group]))[0]!.id;
const joinGroup = async (group: string, w: Who) => sql("INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)", [T, await groupRole(group), UID[w], UID.adm]);
const leaveGroup = async (group: string, w: Who) => sql("UPDATE user_roles SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL AND role_id = $3", [T, UID[w], await groupRole(group)]);
const freshTracking = () => sql("UPDATE tenants SET governance_tracking_started_at = clock_timestamp() WHERE id = $1", [T]);
const setSeen = (w: Who, expr: string) => sql(`UPDATE users SET last_seen_at = ${expr} WHERE id = $1`, [UID[w]]);
const allSeenNow = () => sql("UPDATE users SET last_seen_at = now() WHERE deleted_at IS NULL");
/** Replaces the live risks by `spec`: owner, and creator (the author of the audit CREATE entry; null = no entry). */
async function seedRisks(spec: Array<{ owner: Who | null; creator?: Who | null }>) {
  await sql("UPDATE risks SET deleted_at = now() WHERE deleted_at IS NULL");
  for (const s of spec) {
    const id = randomUUID();
    await sql("INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ($1, $2, 'QA6B', 'QA6B', 'ACTIVE', $3, 'CLIENT')", [id, T, s.owner ? UID[s.owner] : null]);
    if (s.creator) await sql("INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, request_id) VALUES ($1, $2, 'Risk', $3, 'CREATE', 'REQ-QA6B')", [T, UID[s.creator], id]);
  }
}
const times = <X>(n: number, x: X): X[] => Array.from({ length: n }, () => x);

describe.skipIf(!live)("QA-governance-d6bis on the REAL server + LOCAL PostgreSQL 16", () => {
  beforeAll(() => H.start(async () => {
    await sql("UPDATE users SET roles = roles || ARRAY['execution.read','effectiveness.read']::text[]");
    await sql("UPDATE users SET roles = roles || ARRAY['governancehealth.read','role.assign','role.read','user.update','config.read','config.governancedelays.set']::text[] WHERE email = 'adm@vv1.test'");
    await sql("INSERT INTO roles (id, tenant_id, name, permissions) VALUES ($1, $2, 'QA6B Admins', '{role.create}')", [ADMIN_ROLE, T]);
    await joinGroup("RISK_MANAGER", "n1");
    await joinGroup("RISK_COMMITTEE", "raci");
    await sql("INSERT INTO configs (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING", [T]);
    await sql("UPDATE configs SET committee_evaluation_enforced = true, committee_treatment_min_score = 12, exception_review_delay_days = 5, risk_manager_vacancy_max_days = 60 WHERE tenant_id = $1", [T]);
    await sql("UPDATE processes SET risk_champion_user_id = $1 WHERE risk_champion_user_id IS NULL", [UID.own]);
    await sql("UPDATE processes SET owner_user_id = $1 WHERE owner_user_id IS NULL", [UID.pown]);
    await allSeenNow();
    await seedRisks(times(12, { owner: "own" as Who }));
    await freshTracking();
  }), 280000);
  afterAll(() => H.stop());

  // ------------------------------------------------------------------------------------------------ DEFAULTS AND BOUNDS
  describe("thresholds: defaults, bounds, circuit", () => {
    it("defaults on the base: 20 / 3 / 25 / 4 / 90 / 50 (and the healthy baseline is RESPECTED on RISK-01, ACC-01, OWN-01, SOD-04)", async () => {
      const row = (await sql<Record<string, number>>(`SELECT ${Object.values(BOUNDS).map((b) => b.col).join(", ")} FROM configs WHERE tenant_id = $1`, [T]))[0]!;
      for (const b of Object.values(BOUNDS)) expect(row[b.col], b.col).toBe(b.def);
      const p = await panel();
      for (const id of ["GOV-RISK-01", "GOV-ACC-01", "GOV-OWN-01", "GOV-SOD-04"]) expect(p.principles.find((x) => x.id === id)!.status, id).toBe("RESPECTED");
    });
    for (const [key, b] of Object.entries(BOUNDS) as Array<[Key, (typeof BOUNDS)[Key]]>) {
      it(`${key}: the column refuses ${b.min - 1} and ${b.max + 1}, accepts ${b.min} and ${b.max}; the route answers 400 for ${b.min - 1}, ${b.max + 1}, a decimal, a string and null, writing nothing`, async () => {
        for (const bad of [b.min - 1, b.max + 1]) await expect(setCfg(key, bad), String(bad)).rejects.toThrow(/check|violates/i);
        for (const ok of [b.min, b.max]) await setCfg(key, ok);
        await setCfg(key, b.def);
        for (const bad of [b.min - 1, b.max + 1, b.def + 0.5, String(b.def), null]) {
          const r = await call("adm", "PUT", "/config/governance-delays", { [key]: bad, reason: "QA borne" });
          expect(r.status, `${key}=${JSON.stringify(bad)}`).toBe(400);
        }
        expect((await sql<Record<string, number>>(`SELECT ${b.col} AS v FROM configs WHERE tenant_id = $1`, [T]))[0]!["v"]).toBe(b.def);
      });
    }
    it("circuit: lowering a threshold is direct (200, value moved, audited with the reason); raising one is a request awaiting a second person (202, value unchanged); the author cannot approve it; a Committee member approves and it applies", async () => {
      const put = (body: Record<string, unknown>) => call("adm", "PUT", "/config/governance-delays", { ...body, reason: "QA6B circuit" });
      const val = async () => (await sql<{ v: number }>("SELECT gov_max_admins AS v FROM configs WHERE tenant_id = $1", [T]))[0]!.v;
      const low = await put({ govMaxAdmins: 2 });
      expect(low.status, low.text.slice(0, 160)).toBe(200);
      expect(await val()).toBe(2);
      const audit = await sql<{ old_value: any; new_value: any; reason: string }>("SELECT old_value, new_value, reason FROM audit_log WHERE entity_type = 'Config' AND reason = 'QA6B circuit' ORDER BY \"timestamp\" DESC LIMIT 1");
      expect(audit[0]!.reason).toBe("QA6B circuit");
      expect(JSON.stringify(audit[0])).toMatch(/govMaxAdmins|gov_max_admins|2/);
      const up = await put({ govMaxAdmins: 5 });
      expect(up.status, up.text.slice(0, 160)).toBe(202);
      expect(up.json.pendingRequest).toBeTruthy();
      expect(await val(), "raising waits for the second person").toBe(2);
      const id = up.json.pendingRequest.id as string;
      expect((await call("adm", "POST", `/config/governance-delays/requests/${id}/approve`, { reason: "QA6B" })).status, "author").toBeGreaterThanOrEqual(400);
      const ok = await call("com", "POST", `/config/governance-delays/requests/${id}/approve`, { reason: "QA6B ok" });
      expect(ok.status, ok.text.slice(0, 160)).toBeLessThan(300);
      expect(await val()).toBe(5);
      const down = await put({ govMaxAdmins: 3 });
      expect(down.status).toBe(200);
      expect(await val()).toBe(3);
    });
    it("raising and lowering in one request: the request is a relaxation as a whole (nothing applied before approval)", async () => {
      const r = await call("adm", "PUT", "/config/governance-delays", { govDormantDays: 60, govRoleMaxPermissions: 30, reason: "QA6B mixte" });
      expect(r.status, r.text.slice(0, 160)).toBe(202);
      const cfg = (await sql<{ d: number; p: number }>("SELECT gov_dormant_days AS d, gov_role_max_permissions AS p FROM configs WHERE tenant_id = $1", [T]))[0]!;
      expect(cfg, "a mixed request must not apply its lowering half before the second person decides").toEqual({ d: 90, p: 25 });
      const pending = (await call("adm", "GET", "/config/governance-delays/request")).json.data;
      // Codex P2 (PR #236): the pending request carries EVERY requested key with its value, for the approver's screen
      expect(pending.requestedDelays).toEqual({ govDormantDays: 60, govRoleMaxPermissions: 30 });
      if (pending?.id) await call("com", "POST", `/config/governance-delays/requests/${pending.id}/reject`, { reason: "QA6B nettoyage" });
    });
  });

  // ------------------------------------------------------------------------------------------------ RISK-01
  describe("GOV-RISK-01: share of risks owned directly by a Risk Manager", () => {
    it("10 risks, rm owns 2 (20 %, not above the 20 % threshold) => RESPECTED; 3 (30 %) => offender USER with the share; 1 per member over 10 => fine", async () => {
      await seedRisks([...times(2, { owner: "rm" as Who }), ...times(8, { owner: "own" as Who })]);
      expect((await one("GOV-RISK-01")).status).toBe("RESPECTED");
      await seedRisks([...times(3, { owner: "rm" as Who }), ...times(7, { owner: "own" as Who })]);
      const x = await one("GOV-RISK-01");
      expect(x.status).toBe("NOT_RESPECTED");
      expect(x.offenders).toHaveLength(1);
      expect(x.offenders[0]).toMatchObject({ kind: "USER", id: UID.rm });
      expect(x.offenders[0]!["detail"]).toContain("30 %");
      expect(x.covers).toContain("20 %");
    });
    it("the share is per member, not summed: rm 2 + n1 2 over 10 (20 % each) => RESPECTED; the threshold follows the client's setting (10 => rm at 20 % is an offender, 40 => 3/10 is fine)", async () => {
      await seedRisks([...times(2, { owner: "rm" as Who }), ...times(2, { owner: "n1" as Who }), ...times(6, { owner: "own" as Who })]);
      expect((await one("GOV-RISK-01")).status).toBe("RESPECTED");
      await setCfg("govRmRiskShareMaxPct", 10);
      expect((await one("GOV-RISK-01")).offenders.map((o) => o["id"]).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([UID.rm, UID.n1].sort((a, b) => a.localeCompare(b)));
      await setCfg("govRmRiskShareMaxPct", 40);
      await seedRisks([...times(4, { owner: "rm" as Who }), ...times(6, { owner: "own" as Who })]);
      expect((await one("GOV-RISK-01")).status, "4/10 = 40 % is not above 40").toBe("RESPECTED");
      await seedRisks([...times(5, { owner: "rm" as Who }), ...times(5, { owner: "own" as Who })]);
      expect((await one("GOV-RISK-01")).status).toBe("NOT_RESPECTED");
      await resetCfg();
    });
    it("sample: 9 risks => NOT_EVALUABLE with a reason (even if the group is sound); 10 risks => evaluated; archived and deleted risks do not count in the sample", async () => {
      await seedRisks(times(9, { owner: "own" as Who }));
      const nine = await one("GOV-RISK-01");
      expect(nine.status).toBe("NOT_EVALUABLE");
      expect(nine.notEvaluableReason).toMatch(/9 risque/);
      await seedRisks(times(10, { owner: "own" as Who }));
      expect((await one("GOV-RISK-01")).status).toBe("RESPECTED");
      await sql("UPDATE risks SET status = 'ARCHIVED' WHERE id = (SELECT id FROM risks WHERE deleted_at IS NULL LIMIT 1)");
      expect((await one("GOV-RISK-01")).status, "archived => 9 live risks").toBe("NOT_EVALUABLE");
    });
    it("under 10 risks a real gap is still reported: a Risk Manager group of one member stays NOT_RESPECTED (never hidden by the sample rule)", async () => {
      await seedRisks(times(3, { owner: "own" as Who }));
      await leaveGroup("RISK_MANAGER", "n1");
      try {
        const x = await one("GOV-RISK-01");
        expect(x.status).toBe("NOT_RESPECTED");
        expect(x.offenders[0]).toMatchObject({ kind: "GROUP", id: "RISK_MANAGER", count: 1 });
      } finally { await joinGroup("RISK_MANAGER", "n1"); }
    });
  });

  // ------------------------------------------------------------------------------------------------ ACC-01
  describe("GOV-ACC-01 (a) administrators, (b) custom roles, (c) dormant privileged accounts", () => {
    const makeAdmin = (w: Who) => sql("UPDATE users SET roles = roles || ARRAY['role.create']::text[] WHERE id = $1", [UID[w]]);
    const unmakeAdmin = (w: Who) => sql("UPDATE users SET roles = array_remove(roles, 'role.create') WHERE id = $1", [UID[w]]);
    it("(a) 3 active administrators (threshold 3) => RESPECTED; 4 => SETTING offender with the count; a suspended administrator does not count; threshold 4 or 2 moves the line by one", async () => {
      await makeAdmin("dept"); await makeAdmin("named");
      expect((await sql<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE roles && ARRAY['role.create','role.assign']::text[] AND deleted_at IS NULL"))[0]!.n).toBe(3);
      expect((await one("GOV-ACC-01")).status, "adm + dept + named").toBe("RESPECTED");
      await makeAdmin("pown");
      let x = await one("GOV-ACC-01");
      expect(x.status).toBe("NOT_RESPECTED");
      expect(x.offenders.find((o) => o["id"] === "administrators")).toMatchObject({ kind: "SETTING", count: 4 });
      await sql("UPDATE users SET deleted_at = now() WHERE id = $1", [UID.pown]);
      expect((await one("GOV-ACC-01")).status, "suspended admin not counted").toBe("RESPECTED");
      await sql("UPDATE users SET deleted_at = NULL WHERE id = $1", [UID.pown]);
      await setCfg("govMaxAdmins", 4);
      expect((await one("GOV-ACC-01")).status, "4 <= 4").toBe("RESPECTED");
      await setCfg("govMaxAdmins", 2);
      x = await one("GOV-ACC-01");
      expect(x.offenders.find((o) => o["id"] === "administrators")).toMatchObject({ count: 4 });
      await resetCfg();
      for (const w of ["dept", "named", "pown"] as const) await unmakeAdmin(w);
      expect((await one("GOV-ACC-01")).status).toBe("RESPECTED");
    });
    const perms = (n: number, families = 1) => Array.from({ length: n }, (_, i) => `fam${i % families}.p${i}`);
    const setRole = (p: string[]) => sql("UPDATE roles SET permissions = $2 WHERE id = $1", [ADMIN_ROLE, p]);
    it("(b) a custom role of 25 permissions (threshold 25) is fine, 26 is too wide; 3 families fine, 4 families too wide; the offender names the reason; both thresholds are adjustable", async () => {
      await setRole(perms(25, 3));
      expect((await one("GOV-ACC-01")).status).toBe("RESPECTED");
      await setRole(perms(26, 3));
      let x = await one("GOV-ACC-01");
      expect(x.offenders).toEqual([expect.objectContaining({ kind: "ROLE", id: ADMIN_ROLE, label: "QA6B Admins" })]);
      expect(x.offenders[0]!["detail"]).toContain("26 permissions (seuil 25)");
      await setRole(perms(8, 4));
      x = await one("GOV-ACC-01");
      expect(x.offenders[0]!["detail"]).toContain("4 familles de permissions (seuil 4)");
      await setCfg("govRoleMaxFamilies", 5);
      expect((await one("GOV-ACC-01")).status, "4 < 5").toBe("RESPECTED");
      await setCfg("govRoleMaxFamilies", 3);
      await setRole(perms(8, 3));
      expect((await one("GOV-ACC-01")).offenders[0]!["detail"]).toContain("3 familles");
      await resetCfg();
      await setCfg("govRoleMaxPermissions", 15);
      await setRole(perms(16, 2));
      expect((await one("GOV-ACC-01")).offenders[0]!["detail"]).toContain("16 permissions (seuil 15)");
      await setRole(perms(15, 2));
      expect((await one("GOV-ACC-01")).status, "15 <= 15").toBe("RESPECTED");
      await resetCfg();
      await setRole(["role.create"]);
    });
    it("(b) the fixed groups are excluded: the Risk Manager group carries far more than 25 permissions from many families and is never an offender; rolegroup.audit.update on a custom role stays an offender", async () => {
      const rm = (await sql<{ n: number; f: number }>("SELECT cardinality(permissions) AS n, (SELECT count(DISTINCT split_part(p, '.', 1)) FROM unnest(permissions) p)::int AS f FROM roles WHERE tenant_id = $1 AND system_group = 'RISK_MANAGER'", [T]))[0]!;
      expect(rm.n).toBeGreaterThan(25);
      expect(rm.f).toBeGreaterThanOrEqual(4);
      expect((await one("GOV-ACC-01")).offenders.some((o) => o["kind"] === "ROLE" && o["label"] !== "QA6B Admins")).toBe(false);
      await setRole(["role.create", "rolegroup.audit.update"]);
      expect((await one("GOV-ACC-01")).offenders[0]!["detail"]).toContain("rolegroup.audit.update");
      await setRole(["role.create"]);
    });
    it("(c) a privileged account (administrator or fixed-group member) silent for 91 days is dormant, for 89 days not; an ordinary account never; a suspended one never; no date leaves the panel", async () => {
      await setSeen("rm", "now() - interval '89 days'");
      expect((await one("GOV-ACC-01")).status).toBe("RESPECTED");
      await setSeen("rm", "now() - interval '91 days'");
      const text = (await get("aud", "/governance-health")).text;
      const x = (JSON.parse(text).data.principles as Principle[]).find((p) => p.id === "GOV-ACC-01")!;
      expect(x.status).toBe("NOT_RESPECTED");
      expect(x.offenders).toEqual([expect.objectContaining({ kind: "USER", id: UID.rm })]);
      expect(x.offenders[0]!["detail"]).toContain("90 jours");
      expect(text).not.toMatch(/last_?[sS]een|2026-0[0-9]-[0-9]{2}T.*Z".*dormant/);
      await setSeen("dept", "now() - interval '400 days'");
      await sql("UPDATE users SET deleted_at = now() WHERE id = $1", [UID.rm]);
      expect((await one("GOV-ACC-01")).status, "suspended privileged and ordinary silent accounts are not flagged").toBe("RESPECTED");
      await sql("UPDATE users SET deleted_at = NULL WHERE id = $1", [UID.rm]);
      await setCfg("govDormantDays", 180);
      expect((await one("GOV-ACC-01")).status, "91 < 180").toBe("RESPECTED");
      await setSeen("rm", "now() - interval '181 days'");
      expect((await one("GOV-ACC-01")).status).toBe("NOT_RESPECTED");
      await setCfg("govDormantDays", 45);
      await setSeen("rm", "now() - interval '44 days'");
      expect((await one("GOV-ACC-01")).status).toBe("RESPECTED");
      await setSeen("rm", "now() - interval '46 days'");
      expect((await one("GOV-ACC-01")).status).toBe("NOT_RESPECTED");
      await resetCfg();
      await allSeenNow();
    });
    it("(c) a NULL last activity is dormant only once the tracking is older than the threshold: tracked 89 days ago => fine, 91 days ago => dormant; a fixed-group member and an administrator alike", async () => {
      await sql("UPDATE users SET last_seen_at = NULL WHERE id = ANY($1::uuid[])", [[UID.aud, UID.adm]]);
      try {
        await sql("UPDATE tenants SET governance_tracking_started_at = now() - interval '89 days' WHERE id = $1", [T]);
        expect((await one("GOV-ACC-01")).status).toBe("RESPECTED");
        await sql("UPDATE tenants SET governance_tracking_started_at = now() - interval '91 days' WHERE id = $1", [T]);
        const x = await one("GOV-ACC-01");
        expect(x.status).toBe("NOT_RESPECTED");
        expect(x.offenders.map((o) => o["id"]).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([UID.aud, UID.adm].sort((a, b) => a.localeCompare(b)));
      } finally { await allSeenNow(); await freshTracking(); }
    });
  });

  // ------------------------------------------------------------------------------------------------ OWN-01 (d)
  describe("GOV-OWN-01 (d): risks created and owned by the same person", () => {
    it("10 risks, 5 created and owned by the same people (50 %, not above 50) => RESPECTED; 6 (60 %) => SETTING offender with the share; the creator comes from the CREATE entry of the journal, not from the owner", async () => {
      await seedRisks([...times(5, { owner: "own" as Who, creator: "own" as Who }), ...times(5, { owner: "own" as Who, creator: "adm" as Who })]);
      expect((await one("GOV-OWN-01")).status).toBe("RESPECTED");
      await seedRisks([...times(6, { owner: "own" as Who, creator: "own" as Who }), ...times(4, { owner: "own" as Who, creator: "adm" as Who })]);
      const x = await one("GOV-OWN-01");
      expect(x.status).toBe("NOT_RESPECTED");
      expect(x.offenders.find((o) => o["id"] === "creatorOwnerShare")).toMatchObject({ kind: "SETTING", count: 6 });
      expect(x.offenders.find((o) => o["id"] === "creatorOwnerShare")!["detail"]).toContain("60 %");
    });
    it("a risk without CREATE entry, or without owner, or whose creator differs from the owner, is not counted as created-and-owned", async () => {
      await seedRisks([...times(6, { owner: "own" as Who, creator: null }), ...times(2, { owner: null, creator: "own" as Who }), ...times(2, { owner: "own" as Who, creator: "n1" as Who })]);
      const x = await one("GOV-OWN-01");
      expect(x.offenders.some((o) => o["id"] === "creatorOwnerShare")).toBe(false);
      expect(x.offenders.map((o) => o["detail"])).toContain("sans propriétaire");
    });
    it("the threshold is the client's: 25 => 3/10 (30 %) is above, 2/10 is not; 80 => 8/10 is not above, 9/10 is", async () => {
      await setCfg("govOwnerCreatorShareMaxPct", 25);
      await seedRisks([...times(2, { owner: "own" as Who, creator: "own" as Who }), ...times(8, { owner: "own" as Who })]);
      expect((await one("GOV-OWN-01")).status).toBe("RESPECTED");
      await seedRisks([...times(3, { owner: "own" as Who, creator: "own" as Who }), ...times(7, { owner: "own" as Who })]);
      expect((await one("GOV-OWN-01")).status).toBe("NOT_RESPECTED");
      await setCfg("govOwnerCreatorShareMaxPct", 80);
      await seedRisks([...times(8, { owner: "own" as Who, creator: "own" as Who }), ...times(2, { owner: "own" as Who })]);
      expect((await one("GOV-OWN-01")).status).toBe("RESPECTED");
      await seedRisks([...times(9, { owner: "own" as Who, creator: "own" as Who }), ...times(1, { owner: "own" as Who })]);
      expect((await one("GOV-OWN-01")).status).toBe("NOT_RESPECTED");
      await resetCfg();
    });
    it("sample: 9 risks all created and owned by one person => NOT_EVALUABLE (never RESPECTED for lack of data); 10 => evaluated; 9 risks with an ownerless one => NOT_RESPECTED (the gap is real)", async () => {
      await seedRisks(times(9, { owner: "own" as Who, creator: "own" as Who }));
      const x = await one("GOV-OWN-01");
      expect(x.status).toBe("NOT_EVALUABLE");
      expect(x.notEvaluableReason).toMatch(/9 risque/);
      await seedRisks(times(10, { owner: "own" as Who, creator: "own" as Who }));
      expect((await one("GOV-OWN-01")).status).toBe("NOT_RESPECTED");
      await seedRisks([...times(8, { owner: "own" as Who }), { owner: null }]);
      const gap = await one("GOV-OWN-01");
      expect(gap.status).toBe("NOT_RESPECTED");
      expect(gap.offenders).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------------------------------------ SOD-04 / ALLOWED_BY_SETTING
  describe("GOV-SOD-04: ALLOWED_BY_SETTING (q234 C)", () => {
    const allow = (v: boolean) => sql("UPDATE configs SET committee_audit_cumul_allowed = $2 WHERE tenant_id = $1", [T, v]);
    /** Journal entry of the last change of the setting, by `who`. */
    const settingChange = (who: Who) => sql(`INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, request_id)
      VALUES ($1, $2, 'Config', $3, 'UPDATE', '{"committeeAuditCumulAllowed": false}', '{"committeeAuditCumulAllowed": true}', 'REQ-QA6B')`, [T, UID[who], randomUUID()]);
    const selfValidate = async (w: Who) => {
      const obj = randomUUID();
      for (const action of ["CREATE", "VALIDATE"]) await sql("INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, request_id) VALUES ($1, $2, 'ControlExecution', $3, $4, 'REQ-QA6B')", [T, UID[w], obj, action]);
    };
    it("setting forbidden + a Committee + Audit cumulant => NOT_RESPECTED « paramètre : interdit »; setting allowed => ALLOWED_BY_SETTING, the cumulant still listed, with who set it and when (named for Audit)", async () => {
      await freshTracking();
      await joinGroup("AUDIT", "raci");
      try {
        await allow(false);
        let x = await one("GOV-SOD-04");
        expect(x.status).toBe("NOT_RESPECTED");
        expect(x.offenders[0]!["detail"]).toBe("Comité + Audit (paramètre : interdit)");
        await allow(true);
        await settingChange("adm");
        x = await one("GOV-SOD-04");
        expect(x.status).toBe("ALLOWED_BY_SETTING");
        expect(x.offenders).toHaveLength(1);
        expect(x.offenders[0]).toMatchObject({ kind: "USER", id: UID.raci });
        expect(x.offenders[0]!["detail"]).toMatch(/autorisé par le paramètre \(réglage du \d{4}-\d{2}-\d{2} par QA adm\)/);
      } finally { await allow(false); await leaveGroup("AUDIT", "raci"); }
    });
    const maskedRead = async (w: Who) => {
      await joinGroup("AUDIT", "raci");
      await allow(true);
      await settingChange("adm");
      try { return await get(w, "/governance-health"); } finally { await allow(false); await leaveGroup("AUDIT", "raci"); }
    };
    it("masking: without audit.read the status is the same and the cumulant is « Personne N » (no id, no name of the cumulant)", async () => {
      for (const w of ["rm", "com"] as const) {
        const r = await maskedRead(w);
        const x = (r.json.data.principles as Principle[]).find((p) => p.id === "GOV-SOD-04")!;
        expect(x.status, w).toBe("ALLOWED_BY_SETTING");
        expect(x.offenders[0]!["label"], w).toMatch(/^Personne \d+$/);
        expect(x.offenders[0]!["id"], w).toBeNull();
        expect(r.text, w).not.toContain(UID.raci);
        expect(r.text, w).not.toContain("QA raci");
      }
    });
    it("QA-D6B-01: without audit.read the author of the setting is not named either: the detail of a USER offender carries « par <account id> » unmasked", async () => {
      const r = await maskedRead("rm");
      expect(r.text).not.toContain(UID.adm);
      expect(r.text).not.toContain("QA adm");
    });
    it("stays NOT_RESPECTED: Risk Manager + Audit even with the setting allowed; a Committee + Audit cumulant who validated their own input (marked or not); an allowed cumul next to another cumul (administrator + Risk Manager)", async () => {
      await allow(true);
      try {
        await joinGroup("AUDIT", "n1");
        let x = await one("GOV-SOD-04");
        expect(x.status, "RM + Audit").toBe("NOT_RESPECTED");
        expect(x.offenders[0]!["detail"]).toContain("Risk Manager + Audit");
        await leaveGroup("AUDIT", "n1");
        await joinGroup("AUDIT", "raci");
        expect((await one("GOV-SOD-04")).status, "alone, allowed").toBe("ALLOWED_BY_SETTING");
        await selfValidate("raci");
        x = await one("GOV-SOD-04");
        expect(x.status, "validated own input").toBe("NOT_RESPECTED");
        expect(x.offenders[0]!["detail"]).toContain("a validé ses propres saisies");
        await freshTracking();
        expect((await one("GOV-SOD-04")).status, "window moved: back to allowed").toBe("ALLOWED_BY_SETTING");
        await sql("UPDATE users SET roles = roles || ARRAY['role.create']::text[] WHERE id = $1", [UID.rm]);
        x = await one("GOV-SOD-04");
        expect(x.status, "another cumul next to the allowed one").toBe("NOT_RESPECTED");
        expect(x.offenders).toHaveLength(2);
      } finally {
        await sql("UPDATE users SET roles = array_remove(roles, 'role.create') WHERE id = $1", [UID.rm]);
        await allow(false);
        await leaveGroup("AUDIT", "raci");
        await leaveGroup("AUDIT", "n1");
        await freshTracking();
      }
    });
    it("an administrator + Audit cumul is not covered by the setting even when allowed; no cumul => RESPECTED, not ALLOWED_BY_SETTING; an allowed setting with nobody cumulating => RESPECTED", async () => {
      await allow(true);
      try {
        expect((await one("GOV-SOD-04")).status, "setting allowed, nobody cumulates").toBe("RESPECTED");
        await sql("UPDATE users SET roles = roles || ARRAY['role.create']::text[] WHERE id = $1", [UID.aud]);
        expect((await one("GOV-SOD-04")).status).toBe("NOT_RESPECTED");
      } finally {
        await sql("UPDATE users SET roles = array_remove(roles, 'role.create') WHERE id = $1", [UID.aud]);
        await allow(false);
      }
    });
    it("ALLOWED_BY_SETTING is not an acceptance: no acceptance object, and the principle is out of the count of severe principles that fail (GOV-TRC-02 unaffected)", async () => {
      await joinGroup("AUDIT", "raci");
      await allow(true);
      try {
        const p = await panel("aud");
        const x = p.principles.find((q) => q.id === "GOV-SOD-04")! as Principle & { acceptance: unknown };
        expect(x.status).toBe("ALLOWED_BY_SETTING");
        expect(x.acceptance).toBeNull();
        expect(p.principles.find((q) => q.id === "GOV-TRC-02")!.status).toBe("RESPECTED");
      } finally { await allow(false); await leaveGroup("AUDIT", "raci"); }
    });
  });

  // ------------------------------------------------------------------------------------------------ MIGRATION 086
  describe("migration 086 on a base where the cumul was already allowed (DECISION-061)", () => {
    const up = () => sql(read("database", "postgresql", "migrations", "086_governance_thresholds.sql"));
    const down = () => sql(read("database", "postgresql", "migrations", "086_governance_thresholds.down.sql"));
    const T2 = I("0f6");
    const dflt = async () => (await sql<{ d: string | null }>("SELECT column_default AS d FROM information_schema.columns WHERE table_name = 'configs' AND column_name = 'committee_audit_cumul_allowed'"))[0]!.d;
    it("existing rows keep their value: a client with the cumul allowed (true) stays true after down then up; only the DEFAULT of new rows becomes false; a second up is a no-op; thresholds come back at their defaults", async () => {
      await sql("UPDATE configs SET committee_audit_cumul_allowed = true WHERE tenant_id = $1", [T]);
      await down();
      expect(await dflt(), "old default restored by the rollback").toBe("true");
      await sql("INSERT INTO tenants (id, name) VALUES ($1, 'QA 086 ancien') ON CONFLICT DO NOTHING", [T2]);
      await sql("INSERT INTO configs (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING", [T2]);
      expect((await sql<{ v: boolean }>("SELECT committee_audit_cumul_allowed AS v FROM configs WHERE tenant_id = $1", [T2]))[0]!.v, "old new-row default").toBe(true);
      await up();
      expect(await dflt()).toBe("false");
      expect((await sql<{ v: boolean }>("SELECT committee_audit_cumul_allowed AS v FROM configs WHERE tenant_id = $1", [T]))[0]!.v, "Djamo-like row untouched").toBe(true);
      expect((await sql<{ v: boolean }>("SELECT committee_audit_cumul_allowed AS v FROM configs WHERE tenant_id = $1", [T2]))[0]!.v, "an existing row is never revoked in silence").toBe(true);
      const T3 = I("0f7");
      await sql("INSERT INTO tenants (id, name) VALUES ($1, 'QA 086 nouveau') ON CONFLICT DO NOTHING", [T3]);
      await sql("INSERT INTO configs (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING", [T3]);
      expect((await sql<{ v: boolean }>("SELECT committee_audit_cumul_allowed AS v FROM configs WHERE tenant_id = $1", [T3]))[0]!.v, "a NEW row defaults to forbidden").toBe(false);
      await up();
      const row = (await sql<Record<string, number>>(`SELECT ${Object.values(BOUNDS).map((b) => b.col).join(", ")} FROM configs WHERE tenant_id = $1`, [T]))[0]!;
      for (const b of Object.values(BOUNDS)) expect(row[b.col], b.col).toBe(b.def);
      await sql("UPDATE configs SET committee_audit_cumul_allowed = false WHERE tenant_id = $1", [T]);
    });
    it("round trip: down removes the six columns, up restores them with the CHECK bounds; the panel works again afterwards", async () => {
      await down();
      expect((await sql<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'configs' AND column_name LIKE 'gov\\_%' ESCAPE '\\'"))[0]!.n).toBe(0);
      await up();
      expect((await sql<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'configs' AND column_name LIKE 'gov\\_%' ESCAPE '\\'"))[0]!.n).toBe(6);
      await expect(setCfg("govDormantDays", 44)).rejects.toThrow(/check|violates/i);
      await resetCfg();
      expect((await panel()).principles).toHaveLength(19);
    });
  });
});
