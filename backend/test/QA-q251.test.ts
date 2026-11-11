import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, qaVisibilityHarness } from "./qaVisibilityHarness.js";

/**
 * QA-q251 (level 2): q251 A (DECISION-120). New audit_log rows carry neither the name nor the e-mail of a person (ids only); the names are
 * joined back at read time (GET /audit-log), tenant-scoped; an unresolvable account shows the id alone; existing rows are untouched.
 * Oracles written BEFORE running, from the task statement. Not a Security / Privacy / Compliance opinion.
 *
 * Live part: QA_Q251_LIVE=1 + LOCAL cluster of tests/integration/qa-visibility-v1-setup.sh (127.0.0.1:55442, never Neon); base grc_qa_q251
 * is rebuilt; run live suites with --no-file-parallelism. a former `it.fails` gap (QA-Q251-01) is now a normal test.
 */
const live = process.env["QA_Q251_LIVE"] === "1";
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const T = I("001");
const T2 = "bbbbbbbb-0000-4000-8000-000000000001";
const WHO = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"] as const;
type Who = (typeof WHO)[number];
const UID = Object.fromEntries(WHO.map((w, i) => [w, I(`10${"123456789abc"[i]}`)])) as Record<Who, string>;
const NAME = "CANARYNAME Zephyrine Q251";
const NAME2 = "CANARYNAME Renamed Q251";
const MAIL = "canary.q251@example.test";
const FOREIGN_NAME = "CANARYNAME OtherTenant Q251";
const LEGACY_NAME = "LEGACYNAME Old Row";
const LEGACY_MAIL = "legacy.row@example.test";
const NEEDLES = ["%canaryname%", "%canary.q251%"];
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("QA-q251 STATIC", () => {
  it("UserService writes only auditSnapshot(...) as old/new value of a User row (no raw user entity)", () => {
    const src = read("backend", "src", "services", "UserService.ts");
    const userRecords = src.split("this.audit.record(").slice(1);
    expect(userRecords.length).toBeGreaterThanOrEqual(4);
    for (const r of userRecords) {
      const block = r.slice(0, r.indexOf("});"));
      if (!/entityType: "User"/.test(block)) continue;
      expect(block).not.toMatch(/(oldValue|newValue):\s*(user|before|after)\s*[,}\n]/);
      expect(block).not.toMatch(/\.\.\.(user|before|after)\b/);
    }
  });
  it("AuditLogService is built with the user repository in server.ts", () => {
    expect(read("backend", "src", "server.ts")).toMatch(/new AuditLogService\(auditRepository, userRepository\)/);
  });
  it("no SQL migration copies a display name or an e-mail into audit_log (role names only)", () => {
    for (const f of ["077_governance_rights_ordinary_cleanup", "078_risk_manager_role_read", "081_audit_read_audit_group_only", "082_risk_visibility"]) {
      const s = read("database", "postgresql", "migrations", `${f}.sql`);
      for (const m of s.matchAll(/INSERT INTO audit_log[\s\S]*?;/g)) expect(m[0].replace(/s\.email = 'migration-\d+@system\.invalid'/, ""), f).not.toMatch(/display_name|email/i);
    }
  });
  it("the only INSERT INTO audit_log in the application is PostgresAuditRepository.insertAuditEvent", () => {
    const hits = readFileSync(join(ROOT, "backend", "src", "infrastructure", "database", "postgres", "PostgresAuditRepository.ts"), "utf8").match(/INSERT INTO audit_log/g);
    expect(hits).toHaveLength(1);
  });
});

describe.skipIf(!live)("QA-q251 LIVE (real PostgreSQL + real server)", () => {
  const H = qaVisibilityHarness({ db: "grc_qa_q251", port: 8098, who: WHO, uid: UID });
  const { sql, get, call } = H;
  let canaryId = "";
  const legacyId = "dddddddd-0000-4000-8000-000000000001";
  const legacyIdGone = "dddddddd-0000-4000-8000-0000000000ff";
  let legacyBefore = "";
  const needleRows = (since = "") =>
    sql<{ id: string; entity_type: string; action: string; txt: string }>(
      `SELECT id, entity_type, action, (coalesce(old_value::text,'') || ' ' || coalesce(new_value::text,'') || ' ' || coalesce(reason,'')) AS txt
         FROM audit_log WHERE request_id <> 'legacy-q251' AND (coalesce(old_value::text,'') || coalesce(new_value::text,'') || coalesce(reason,'')) ILIKE ANY($1::text[]) ${since}`,
      [NEEDLES],
    );

  beforeAll(async () => {
    await H.start(async () => {
      await sql("UPDATE users SET roles = roles || ARRAY['user.delete','user.reactivate','department.create','department.update','process.create','process.update','kpi.create','control.create','control.read','kpi.read','raci.assign','role.read']::text[] WHERE id = $1", [UID.adm]);
      await sql("INSERT INTO tenants (id, name) VALUES ($1, 'Tenant QA Q251 B')", [T2]);
      await sql("INSERT INTO users (id, tenant_id, email, display_name, roles) VALUES ($1, $2, 'other@tenantb.test', $3, '{}')", [I("1f1"), T2, FOREIGN_NAME]);
      // Rows as written BEFORE q251 (the name and e-mail are inside the snapshot) and rows pointing at unresolvable / foreign accounts.
      const snap = JSON.stringify({ id: legacyId, email: LEGACY_MAIL, displayName: LEGACY_NAME, roles: [] });
      await sql(
        "INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, request_id) VALUES ($1, $2, 'User', $3, 'CREATE', NULL, $4::jsonb, 'legacy-q251')",
        [T, UID.adm, legacyId, snap],
      );
      await sql("INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, new_value, request_id) VALUES ($1, $2, 'User', $3, 'UPDATE', '{\"status\":\"ACTIVE\"}'::jsonb, 'legacy-q251')", [T, UID.adm, legacyIdGone]);
      // cross-tenant probes: tenant A row whose actor / entity is a tenant-B account
      await sql("INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, new_value, request_id) VALUES ($1, $2, 'User', $3, 'UPDATE', '{\"x\":1}'::jsonb, 'legacy-q251')", [T, I("1f1"), I("1f1")]);
    });
    legacyBefore = JSON.stringify(await sql("SELECT * FROM audit_log WHERE id IS NOT NULL AND request_id = 'legacy-q251' ORDER BY entity_id, user_id"));
  }, 600000);
  afterAll(async () => { await H.stop(); }, 60000);

  it("L1 user lifecycle (create, rename, suspend, reactivate) succeeds and writes rows WITHOUT the name or the e-mail", async () => {
    const c = await call("adm", "POST", "/users", { email: MAIL, displayName: NAME, roleId: I("301"), reason: "QA q251 creation" });
    expect(c.status, c.text).toBe(201);
    canaryId = c.json.data.id;
    const u = await call("adm", "PUT", `/users/${canaryId}`, { displayName: NAME2 });
    expect(u.status, u.text).toBe(200);
    const s = await call("adm", "PATCH", `/users/${canaryId}/suspend`, { reason: "QA q251 suspension" });
    expect(s.status, s.text).toBe(200);
    const r = await call("adm", "PATCH", `/users/${canaryId}/reactivate`, { reason: "QA q251 reactivation" });
    expect(r.status, r.text).toBe(200);
    const rows = await H.audits(canaryId);
    const userRows = rows.filter((x) => x.entity_type === "User");
    expect(userRows.map((x) => x.action)).toEqual(expect.arrayContaining(["CREATE", "UPDATE", "DELETE"]));
    expect(userRows.length).toBeGreaterThanOrEqual(4);
    for (const x of userRows) {
      const t = JSON.stringify([x.old_value, x.new_value, x.reason]).toLowerCase();
      expect(t).not.toContain("canaryname");
      expect(t).not.toContain("canary.q251");
      for (const v of [x.old_value, x.new_value]) if (v) { expect(v).not.toHaveProperty("email"); expect(v).not.toHaveProperty("displayName"); expect(v).not.toHaveProperty("display_name"); }
    }
    // the other fields stay (the snapshot is not emptied): id, status/deletedAt, tenant
    const created = userRows.find((x) => x.action === "CREATE")!;
    expect(created.new_value.id).toBe(canaryId);
    expect(created.new_value.tenantId).toBe(T);
  }, 120000);

  it("L2 the rename row (UPDATE) still tells something changed: old and new snapshots exist and differ only outside name/e-mail", async () => {
    const rows = (await H.audits(canaryId)).filter((x) => x.entity_type === "User" && x.action === "UPDATE" && x.old_value && x.new_value && !x.reason);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // NOTE (pin): a pure rename leaves old == new apart from updatedAt; the journal no longer tells what the name was.
    expect(JSON.stringify(rows[0]!.old_value)).not.toContain("Renamed");
    // q272: the rename row says a name changed, without a value; suspend / reactivate rows carry no such flag.
    const all = (await H.audits(canaryId)).filter((x) => x.entity_type === "User" && x.action === "UPDATE");
    expect(all.filter((x) => x.new_value?.["displayNameChanged"] === true)).toHaveLength(1);
  });

  it("L3 role assignment, revocation, RACI and visibility writes of the named account carry ids only", async () => {
    const assign = await call("adm", "POST", `/roles/${I("302")}/assign`, { userId: canaryId });
    expect(assign.status, assign.text).toBe(201);
    const revoke = await call("adm", "POST", `/roles/${I("302")}/revoke`, { userId: canaryId, reason: "QA q251" });
    expect([200, 204], revoke.text).toContain(revoke.status);
    const raci = await call("out2", "POST", "/raci", { entityType: "RISK", entityId: I("501"), userId: canaryId, role: "C" });
    expect([200, 201], raci.text).toContain(raci.status);
    const vis = await call("rm", "PUT", `/risks/${I("503")}/visibility`, { visibility: "NOMINATIF", addUserIds: [canaryId], reason: "QA q251" });
    expect(vis.status, vis.text).toBe(200);
    expect((await sql("SELECT 1 FROM resource_access_grants WHERE resource_id = $1 AND user_id = $2 AND revoked_at IS NULL", [I("503"), canaryId])).length).toBe(1);
    const renew = await call("rm", "POST", `/risks/${I("503")}/visibility/renew`, { userIds: [canaryId], reason: "QA q251" });
    expect([200, 201], renew.text).toContain(renew.status);
    const unvis = await call("rm", "PUT", `/risks/${I("503")}/visibility`, { visibility: "NOMINATIF", revokeUserIds: [canaryId], reason: "QA q251" });
    expect(unvis.status, unvis.text).toBe(200);
    expect([200, 201], vis.text).toContain(vis.status);
    expect(await needleRows()).toEqual(expect.not.arrayContaining([expect.objectContaining({ entity_type: "User" })]));
    const hit = (await needleRows()).filter((x) => !["Department", "Process", "Kpi", "Control"].includes(x.entity_type));
    expect(hit, JSON.stringify(hit.map((h) => [h.entity_type, h.action]))).toEqual([]);
  }, 120000);

  it("L4 whole backend scan: after the exercised writes, no new audit_log row outside the free-text cases holds the name or the e-mail", async () => {
    const hit = (await needleRows()).filter((x) => !["Department", "Process", "Kpi", "Control"].includes(x.entity_type));
    expect(hit).toEqual([]);
    expect((await sql("SELECT count(*)::int AS n FROM audit_log WHERE request_id <> 'legacy-q251'"))[0]!["n"]).toBeGreaterThanOrEqual(8);
  });

  // QA-Q251-01: free-text person fields copied whole into whole-entity snapshots (Department.manager / riskOwner, Process.owner, Kpi.owner, Control.executor).
  describe("free-text person fields (gap, pinned)", () => {
    const cases: Array<[string, () => Promise<{ status: number; text: string }>, string]> = [
      ["Department manager", () => call("adm", "POST", "/departments", { name: "Dept QA q251", manager: NAME, riskOwner: MAIL }), "Department"],
      ["Process owner", () => call("adm", "POST", "/processes", { level: "PROCESS", name: "Proc QA q251", owner: NAME, departmentId: I("201") }), "Process"],
      ["Kpi owner", () => call("adm", "POST", "/kpis", { label: "Kpi QA q251", targetValue: 1, unit: "u", frequency: "MONTHLY", owner: NAME, departmentId: I("201") }), "Kpi"],
      ["Control executor", () => call("adm", "POST", "/controls", { label: "Ctl QA q251", coveredRiskIds: [I("501")], controlType: "PREVENTIVE", frequency: "MONTHLY", executor: NAME, complianceCriteria: "c" }), "Control"],
    ];
    const status: Record<string, number> = {};
    for (const [label, run] of cases) {
      // Not vacuous: the write itself must succeed (a 400 would make the test below pass for the wrong reason).
      it(`${label}: the write succeeds`, async () => {
        const r = await run();
        expect([200, 201], r.text).toContain(r.status);
        status[label] = r.status;
      });
    }
    for (const [label, , ent] of cases) {
      // Oracle (task): « aucune nouvelle ligne ne contient nom ni e-mail ». The row must not hold the typed person text.
      it(`${label}: a typed name / e-mail is not copied into the journal (QA-Q251-01, fixed by q273)`, async () => {
        expect(status[label]).toBeDefined();
        const hit = (await needleRows()).filter((x) => x.entity_type === ent);
        expect(hit).toEqual([]);
      });
    }
  });

  // Retest (DECISION-130, q272 / q273): every write path of the four free-text entities, with a typed name / e-mail, then a full scan.
  describe("retest q272 / q273: all writes of the free-text entities", () => {
    const ids: Record<string, string> = {};
    const ok = (r: { status: number; text: string }) => expect([200, 201, 204], r.text).toContain(r.status);
    const rowsOf = (id: string) => H.audits(id);
    it("R1 create, update (value changed), designate, archive of Department / Process / Kpi / Control succeed with typed names", async () => {
      await sql("UPDATE users SET roles = roles || ARRAY['process.responsibility.assign','process.delete','department.delete','kpi.delete','control.delete','control.update','kpi.update']::text[] WHERE id = $1", [UID.adm]);
      let r = await call("adm", "POST", "/departments", { name: "Dept R q251", manager: "CANARYNAME M1", riskOwner: "canary.q251.a@example.test" });
      ok(r); ids["dept"] = r.json.data.id;
      ok(await call("adm", "PATCH", `/departments/${ids["dept"]}`, { manager: "CANARYNAME M2" }));
      ok(await call("adm", "POST", `/departments/${ids["dept"]}/designate-risk-owner`, { riskOwner: "canary.q251.b@example.test" }));
      ok(await call("adm", "POST", `/departments/${ids["dept"]}/archive`, { reason: "QA q251 retest" }));
      r = await call("adm", "POST", "/processes", { level: "PROCESS", name: "Proc R q251", owner: "CANARYNAME P1", departmentId: I("201") });
      ok(r); ids["proc"] = r.json.data.id;
      ok(await call("adm", "PATCH", `/processes/${ids["proc"]}`, { owner: "CANARYNAME P2" }));
      ok(await call("adm", "PUT", `/processes/${ids["proc"]}/responsibilities`, { ownerUserId: canaryId, reason: "QA q251 retest" }));
      ok(await call("adm", "POST", `/processes/${ids["proc"]}/archive`, { reason: "QA q251 retest" }));
      r = await call("adm", "POST", "/kpis", { label: "Kpi R q251", targetValue: 1, unit: "u", frequency: "MONTHLY", owner: "CANARYNAME K1", departmentId: I("201") });
      ok(r); ids["kpi"] = r.json.data.id;
      ok(await call("adm", "PATCH", `/kpis/${ids["kpi"]}`, { owner: "CANARYNAME K2" }));
      ok(await call("adm", "POST", `/kpis/${ids["kpi"]}/link`, { departmentId: I("202") }));
      ok(await call("adm", "POST", `/kpis/${ids["kpi"]}/archive`, { reason: "QA q251 retest" }));
      r = await call("adm", "POST", "/controls", { label: "Ctl R q251", coveredRiskIds: [I("501")], controlType: "PREVENTIVE", frequency: "MONTHLY", executor: "CANARYNAME C1", complianceCriteria: "c" });
      ok(r); ids["ctl"] = r.json.data.id;
      ok(await call("adm", "PATCH", `/controls/${ids["ctl"]}`, { executor: "CANARYNAME C2" }));
      ok(await call("adm", "POST", `/controls/${ids["ctl"]}/archive`, { reason: "QA q251 retest" }));
    }, 120000);
    it("R2 a changed value leaves only `<field>Changed: true` (Department.manager, Process.owner, Kpi.owner, Control.executor), never the value", async () => {
      const flag: Array<[string, string, string]> = [["dept", "managerChanged", "manager"], ["proc", "ownerChanged", "owner"], ["kpi", "ownerChanged", "owner"], ["ctl", "executorChanged", "executor"]];
      for (const [k, f, field] of flag) {
        const rows = (await rowsOf(ids[k]!)).filter((x) => x.action === "UPDATE");
        expect(rows.some((x) => x.new_value?.[f] === true), `${k} ${f}`).toBe(true);
        for (const x of await rowsOf(ids[k]!)) for (const v of [x.old_value, x.new_value]) if (v) expect(v, `${k}`).not.toHaveProperty(field);
      }
      const dr = (await rowsOf(ids["dept"]!)).filter((x) => x.action === "UPDATE" || x.action === "ASSIGN");
      expect(dr.some((x) => x.new_value?.["riskOwnerChanged"] === true)).toBe(true);
      // legacy owner of a process (responsibilities row): flag only when it changed; here owner did not change in that call
      const pr = (await rowsOf(ids["proc"]!)).filter((x) => x.action === "UPDATE");
      expect(pr.length).toBeGreaterThanOrEqual(2);
    });
    it("R3 an update that does NOT change the field carries no flag (no false positive)", async () => {
      const rows = (await rowsOf(ids["ctl"]!)).filter((x) => x.action === "UPDATE");
      expect(rows.filter((x) => x.new_value?.["executorChanged"] === true)).toHaveLength(1);
      const kpiRows = (await rowsOf(ids["kpi"]!)).filter((x) => x.action === "UPDATE");
      expect(kpiRows.filter((x) => x.new_value?.["ownerChanged"] === true)).toHaveLength(1);
    });
    it("R4 FULL SCAN of audit_log (every entity type: RACI, resource access, roles, process, department, kpi, control...): no new row holds the name or the e-mail", async () => {
      const hit = await needleRows();
      expect(hit, JSON.stringify(hit.map((h) => [h.entity_type, h.action]))).toEqual([]);
      const all = await sql<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE request_id <> 'legacy-q251' AND (coalesce(old_value::text,'') || coalesce(new_value::text,'') || coalesce(reason,'')) ~* '(@[a-z0-9-]+\\.(test|com|org|net))'");
      expect(all[0]!.n, "any e-mail-looking string in a new row").toBe(0);
      const types = (await sql<{ t: string }>("SELECT DISTINCT entity_type AS t FROM audit_log WHERE request_id <> 'legacy-q251'")).map((x) => x.t);
      expect(types).toEqual(expect.arrayContaining(["User", "Role", "Department", "Process", "Kpi", "Control"]));
    });
    it("R5 the RACI and resource-access rows exist, carry the account by id only, and the entity types are covered by the scan", async () => {
      const rows = await sql<{ entity_type: string; txt: string }>(
        "SELECT entity_type, coalesce(old_value::text,'') || coalesce(new_value::text,'') AS txt FROM audit_log WHERE request_id <> 'legacy-q251' AND (coalesce(old_value::text,'') || coalesce(new_value::text,'')) LIKE '%' || $1 || '%'", [canaryId]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((x) => /raci/i.test(x.entity_type))).toBe(true);
      expect(rows.some((x) => x.entity_type === "Risk" && /accessUserIds/.test(x.txt))).toBe(true);
    });
  });

  it("L5 old rows are not modified by the new writes, and the database still refuses an UPDATE / DELETE of the journal", async () => {
    const after = JSON.stringify(await sql("SELECT * FROM audit_log WHERE id IS NOT NULL AND request_id = 'legacy-q251' ORDER BY entity_id, user_id"));
    expect(after).toBe(legacyBefore);
    expect(after).toContain(LEGACY_NAME);
    await expect(sql("UPDATE audit_log SET new_value = '{}'::jsonb WHERE request_id = 'legacy-q251'")).rejects.toThrow();
    await expect(sql("DELETE FROM audit_log WHERE request_id = 'legacy-q251'")).rejects.toThrow();
  });

  describe("GET /audit-log", () => {
    const names = (ev: any[]) => ev.map((e) => [e.userDisplayName, e.entityDisplayName]);
    it("L6 permission: a holder without audit.read gets 403, nobody anonymous gets in", async () => {
      expect((await get("adm", "/audit-log")).status).toBe(403);
      expect((await call(null, "GET", "/audit-log")).status).toBe(401);
    });
    it("L7 entity lookup: actor and subject names are joined by id (current name, not the one at write time)", async () => {
      const r = await get("aud", `/audit-log?entityType=User&entityId=${canaryId}`);
      expect(r.status, r.text).toBe(200);
      expect(r.json.data.length).toBeGreaterThanOrEqual(4);
      for (const e of r.json.data) {
        expect(e.entityDisplayName).toBe(NAME2);
        expect(e.userDisplayName).toBe("QA adm");
      }
      // the stored row has none of it: the name comes from the join only
      expect(r.text).not.toContain("canary.q251");
      // q272: the read states that the names are the current ones
      expect(r.json.data.every((e: any) => e.namesAreCurrent === true)).toBe(true);
    });
    it("L8 every filter returns the joined names (userId, action, entityType, from, to, combined, recent, limit)", async () => {
      const paths = [
        `/audit-log?userId=${UID.adm}&limit=500`,
        `/audit-log?action=DELETE&limit=500`,
        `/audit-log?entityType=User&limit=500`,
        `/audit-log?from=2000-01-01T00:00:00Z&limit=500`,
        `/audit-log?to=2999-01-01T00:00:00Z&limit=500`,
        `/audit-log?userId=${UID.adm}&entityType=User&entityId=${canaryId}&action=UPDATE&from=2000-01-01&to=2999-01-01`,
        `/audit-log?limit=500`,
        `/audit-log`,
        `/audit-log?limit=1`,
      ];
      for (const p of paths) {
        const r = await get("aud", p);
        expect(r.status, `${p} ${r.text.slice(0, 200)}`).toBe(200);
        expect(r.json.data.length, p).toBeGreaterThan(0);
        for (const e of r.json.data) {
          if (e.userId === UID.adm) expect(e.userDisplayName, p).toBe("QA adm");
          if (e.entityType === "User" && e.entityId === canaryId) expect(e.entityDisplayName, p).toBe(NAME2);
          if (e.entityType !== "User") expect(e, p).not.toHaveProperty("entityDisplayName");
        }
      }
      const filtered = await get("aud", `/audit-log?userId=${UID.adm}&limit=500`);
      expect(filtered.json.data.every((e: any) => e.userId === UID.adm)).toBe(true);
      const bad = await get("aud", "/audit-log?from=not-a-date");
      expect(bad.status).toBe(400);
    });
    it("L9 an old row keeps its stored snapshot untouched and still gets the joined names on top", async () => {
      const r = await get("aud", `/audit-log?entityType=User&entityId=${legacyId}`);
      expect(r.status).toBe(200);
      expect(r.json.data).toHaveLength(1);
      expect(r.json.data[0].newValue.displayName).toBe(LEGACY_NAME);
      expect(r.json.data[0].newValue.email).toBe(LEGACY_MAIL);
      expect(r.json.data[0].userDisplayName).toBe("QA adm");
      expect(r.json.data[0]).not.toHaveProperty("entityDisplayName");
    });
    it("L10 an unresolvable account: identifier alone, no name, no error, no invented placeholder", async () => {
      const r = await get("aud", `/audit-log?entityType=User&entityId=${legacyIdGone}`);
      expect(r.status, r.text).toBe(200);
      expect(r.json.data).toHaveLength(1);
      expect(r.json.data[0].entityId).toBe(legacyIdGone);
      expect(r.json.data[0]).not.toHaveProperty("entityDisplayName");
      expect(r.json.data[0].userDisplayName).toBe("QA adm");
    });
    it("L11 no cross-tenant leak: an actor / subject living in another tenant gets no name, and the foreign name is in no response", async () => {
      const r = await get("aud", `/audit-log?entityType=User&entityId=${I("1f1")}`);
      expect(r.status, r.text).toBe(200);
      expect(r.json.data).toHaveLength(1);
      expect(r.json.data[0].userId).toBe(I("1f1"));
      expect(r.json.data[0]).not.toHaveProperty("userDisplayName");
      expect(r.json.data[0]).not.toHaveProperty("entityDisplayName");
      for (const p of ["/audit-log?limit=500", `/audit-log?userId=${I("1f1")}`, "/audit-log?entityType=User&limit=500"]) {
        const all = await get("aud", p);
        expect(all.text, p).not.toContain(FOREIGN_NAME);
        expect(all.text, p).not.toContain("tenantb.test");
      }
    });
    it("L12 a suspended account is still named (getById does not filter deleted_at): documented behaviour", async () => {
      await sql("UPDATE users SET deleted_at = now() WHERE id = $1", [canaryId]);
      try {
        const r = await get("aud", `/audit-log?entityType=User&entityId=${canaryId}`);
        expect(r.json.data[0].entityDisplayName).toBe(NAME2);
      } finally {
        await sql("UPDATE users SET deleted_at = NULL WHERE id = $1", [canaryId]);
      }
    });
    it("L13 the join is read-time: renaming the account changes the shown name of OLD rows, the stored rows do not change", async () => {
      await sql("UPDATE users SET display_name = 'CANARYNAME Third Q251' WHERE id = $1", [canaryId]);
      const r = await get("aud", `/audit-log?entityType=User&entityId=${canaryId}`);
      expect(r.json.data.every((e: any) => e.entityDisplayName === "CANARYNAME Third Q251")).toBe(true);
      await sql("UPDATE users SET display_name = $2 WHERE id = $1", [canaryId, NAME2]);
      expect(names(r.json.data).length).toBeGreaterThan(0);
    });
  });
});
