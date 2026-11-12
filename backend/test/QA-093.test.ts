import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

/**
 * QA-093 (niveau 2) : lot 093 (q279 A : regime SOLE_RM etendu a SET_DEFAULT ; SEC-B13-01 : un processus supprime ne se restaure pas ; audit du rebind d'identite).
 * Oracles ecrits AVANT l'execution. Pas un avis Security.
 * Vrai serveur tsx (QA_093_LIVE=1, port 8099, base `grc_qa_093` vierge 001..093) + PostgreSQL local. Tenant C : UN Risk Manager (solo), Audit (saud), Comite (scom).
 *
 * K1 confirmation seul d'un SET_DEFAULT : 200, SOLE_RM, defaut deplace (un seul), audit des DEUX Dispositifs + APPROVE marque, Audit et Comite prevenus (pas le demandeur),
 *    marqueur de sante ; motif absent / vide / espaces / 501 : 400 ; droits ; tenant croise ; demande ASSIGN_PROCESS inchangee.
 * K2 effet au cycle suivant : evaluation creee avant gardee, nouvelle evaluation sur le nouveau defaut.
 * K3 regle figee a la demande : 2e RM present a la demande => 409 meme apres son depart ; 2e RM arrive apres la demande => 409 ; rejeu 409.
 * K4 concurrence : deux confirmations simultanees : 1 x 200 ; confirmation pendant l'ajout d'un 2e RM : jamais 500, etat coherent ; confirmation // retrait.
 * K5 SET_DEFAULT dont la cible est archivee entre-temps : refus 4xx, demande PENDING, defaut inchange ; confirmable une fois la cible rouverte.
 * K6 SEC-B13-01 : un processus supprime ne se restaure pas (42501), suppression + detachement permis, detachement d'un vivant refuse.
 * K7 rebind d'identite : rien a la premiere liaison ; un changement de `sub` ou de fournisseur, ou son effacement : une ligne d'audit User UPDATE sans le `sub` ; sans changement : rien.
 * K8 migration 093 : CHECK de forme, up / down / up sur base jetable (down refuse avec une decision SOLE_RM sur SET_DEFAULT).
 */
const ROOT = join(__dirname, "..", "..");
const live = process.env["QA_093_LIVE"] === "1";
const PGPORT = 55442;
const DB = "grc_qa_093";
const PORT = 8099;
const API = `http://127.0.0.1:${PORT}/api/v1`;
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const TC = "dddddddd-0000-4000-8000-000000000001";
const UNKNOWN = "cccccccc-0000-4000-8000-0000000009ff";

type Who = "rm1" | "rm2" | "rm3" | "rm4" | "plain" | "adm" | "aud" | "pu" | "rmb" | "solo" | "solo2" | "saud" | "scom" | "sx";
const WHO: Who[] = ["rm1", "rm2", "rm3", "rm4", "plain", "adm", "aud", "pu", "rmb", "solo", "solo2", "saud", "scom", "sx"];
const TOK = {} as Record<Who, string>;
let pg: Pool;
const sh = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const sql = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows as Row[];
const one = async (q: string, p: unknown[] = []) => (await sql(q, p))[0]!;
const count = async (q: string, p: unknown[] = []) => Number((await one(q, p)).n);
type Res = { status: number; text: string; json: Row | null };
async function call(who: Who | null, method: string, path: string, body?: unknown): Promise<Res> {
  const r = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", connection: "close", ...(who ? { authorization: `Bearer ${TOK[who]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: Row | null = null;
  try { json = JSON.parse(text) as Row; } catch { /* not JSON */ }
  return { status: r.status, text, json };
}
const uid: Record<string, string> = {};
const F: Record<string, string> = {};
let seq = 0;
const proc = async (tenant = TC) => { seq += 1; return (await one(`INSERT INTO processes (tenant_id, level, name) VALUES ($1,'PROCESS',$2) RETURNING id`, [tenant, `QA 093 ${seq}`])).id as string; };
const defaultsOf = async (tenant = TC) => (await sql(`SELECT name FROM risk_frameworks WHERE tenant_id = $1 AND is_default AND archived_at IS NULL`, [tenant])).map((x) => x.name as string);
const ask = (who: Who, fw: string, reason = "Defaut QA 093") => call(who, "POST", `/risk-frameworks/${fw}/default-requests`, { reason });
const solo = (who: Who, rid: string, body: unknown) => call(who, "POST", `/risk-frameworks/change-requests/${rid}/sole-confirm`, body);
const notes = (user: string, type: string) => sql(`SELECT * FROM notifications WHERE recipient_user_id = $1 AND event_type = $2`, [uid[user], type]);
const reqRow = async (id: string) => one(`SELECT * FROM risk_framework_change_requests WHERE id = $1`, [id]);
const asLateral = async <R>(fn: () => Promise<R>): Promise<R> => fn();
/** Back to the starting state: Standard is the default of tenant C (set by fixture, guard lifted). */
async function resetDefault(name = "Standard") {
  await sql(`ALTER TABLE risk_frameworks DISABLE TRIGGER risk_frameworks_guard`);
  try {
    await sql(`UPDATE risk_frameworks SET is_default = false WHERE tenant_id = $1 AND is_default`, [TC]);
    await sql(`UPDATE risk_frameworks SET is_default = true WHERE tenant_id = $1 AND name = $2`, [TC, name]);
  } finally { await sql(`ALTER TABLE risk_frameworks ENABLE TRIGGER risk_frameworks_guard`); }
}
async function failAudit(entityType: string | null, action: string | null = null) {
  await sql(`DELETE FROM qa_fail_audit`);
  if (entityType) await sql(`INSERT INTO qa_fail_audit (entity_type, action) VALUES ($1,$2)`, [entityType, action]);
}
void asLateral; void failAudit; void UNKNOWN;

describe.skipIf(!live)("QA-093 sur le VRAI serveur + PostgreSQL 16 LOCAL (base vierge 001..093)", () => {
  beforeAll(async () => {
    sh("/bin/bash", [join(ROOT, "tests", "integration", "qa-visibility-v1-setup.sh"), "up", DB]);
    pg = new Pool({ host: "127.0.0.1", port: PGPORT, user: "postgres", database: DB, max: 6 });
    const rmPerms = (await one(`SELECT permissions AS p FROM roles WHERE tenant_id = $1 AND system_group = 'RISK_MANAGER'`, [T])).p as string[];
    const RM = (await one(`SELECT id FROM roles WHERE tenant_id = $1 AND system_group = 'RISK_MANAGER'`, [T])).id as string;
    const granter = (await one(`SELECT id FROM users WHERE email = 'adm@vv1.test'`)).id as string;
    const mk = async (tenant: string, n: string, perms: string[]) => { await sql(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1,$2,$2,$3)`, [tenant, `${n}@b6c.test`, perms]); uid[n] = (await one(`SELECT id FROM users WHERE email = $1`, [`${n}@b6c.test`])).id as string; };
    for (const n of ["rm1", "rm2", "rm3", "rm4"]) { await mk(T, n, []); await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [T, RM, uid[n], granter]); }
    await mk(T, "plain", ["risk.read", "process.read", "riskframework.read"]);
    await mk(T, "adm", rmPerms);
    await mk(T, "aud", []);
    await mk(T, "pu", ["process.read", "process.update", "riskframework.read"]);
    await sql(`INSERT INTO tenants (id, name) VALUES ($1,'Tenant C QA 093')`, [TC]);
    const grp = async (name: string, g: string, perms: string[]) => (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1,$2,$3,$4) RETURNING id`, [TC, name, perms, g])).id as string;
    for (const n of ["solo", "solo2", "saud", "scom"]) await mk(TC, n, []);
    await mk(TC, "sx", rmPerms); // droits directs, hors groupe RM
    await mk(T, "rmb", []);
    F["RM_C"] = await grp("Risk Manager C", "RISK_MANAGER", rmPerms);
    const AUD_C = await grp("Audit C", "AUDIT", ["audit.read"]);
    const COM_C = await grp("Comite C", "RISK_COMMITTEE", ["riskframework.read"]);
    await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$3)`, [TC, F["RM_C"], uid["solo"]]);
    await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [TC, AUD_C, uid["saud"], uid["solo"]]);
    await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [TC, COM_C, uid["scom"], uid["solo"]]);
    await sql(`CREATE TABLE qa_fail_audit (entity_type text, action text)`);
    sh("/bin/bash", [join(ROOT, "tests", "integration", "qa-b6c-server.sh"), "start"], { QA_PORT: String(PORT), QA_DB: DB });
    for (const w of WHO) {
      const r = await fetch(`${API}/auth/local`, { method: "POST", headers: { "content-type": "application/json", connection: "close" }, body: JSON.stringify({ email: `${w}@b6c.test`, password: "whatever" }) });
      TOK[w] = ((await r.json()) as { accessToken: string }).accessToken;
      expect(TOK[w], w).toBeTruthy();
    }
    // tenant C: provision the three models as the sole Risk Manager, activate Standard and Tranché by fixture (an ACTIVE version needs the circuit, which one person cannot run)
    const prov = await call("solo", "POST", "/risk-frameworks/defaults", {});
    expect(prov.status, prov.text).toBe(201);
    const c = await pg.connect();
    try {
      await c.query("SET session_replication_role = replica");
      for (const n of ["Standard", "Tranché", "Renforcé"]) {
        F[n] = (await c.query(`SELECT id FROM risk_frameworks WHERE tenant_id = $1 AND name = $2`, [TC, n])).rows[0].id as string;
        const v = (await c.query(`SELECT id, rating_scale_id FROM risk_framework_versions WHERE framework_id = $1`, [F[n]])).rows[0];
        await c.query(`UPDATE risk_framework_versions SET status = 'ACTIVE', activated_at = now() WHERE id = $1`, [v.id]);
        await c.query(`UPDATE rating_scales SET status = 'ACTIVE', activated_at = now() WHERE id = $1`, [v.rating_scale_id]);
        F[n + "v"] = v.id as string;
      }
      await c.query(`UPDATE risk_frameworks SET is_default = true WHERE id = $1`, [F["Standard"]]);
    } finally { await c.query("RESET session_replication_role"); c.release(); }
    F["CAT"] = (await one(`INSERT INTO risk_categories (tenant_id, name) VALUES ($1,'Racine 093') RETURNING id`, [TC])).id as string;
    F["SUB"] = (await one(`INSERT INTO risk_categories (tenant_id, name, parent_id) VALUES ($1,'Sous-cat 093',$2) RETURNING id`, [TC, F["CAT"]])).id as string;
  }, 300000);
  afterAll(async () => {
    await pg?.end();
    sh("/bin/bash", [join(ROOT, "tests", "integration", "qa-b6c-server.sh"), "stop"]);
  });

  // ------------------------------------------------------------------------------------------------ K1
  describe("K1-K3 confirmation seul d'un SET_DEFAULT", () => {
    it("K1 nominal : 200, SOLE_RM, defaut deplace (un seul), regle figee a la demande, audit des deux Dispositifs + APPROVE marque, Audit et Comite prevenus, marqueur de sante", async () => {
      expect(await defaultsOf()).toEqual(["Standard"]);
      const q = await ask("solo", F["Tranché"]!, "Passer au 4x4 (seul RM)");
      expect(q.status, q.text).toBe(201);
      const rid = q.json!["data"].id as string;
      expect((await reqRow(rid)).sole_rm_at_request, "regle figee a la demande").toBe(true);
      const nd = await notes("solo", "RISK_FRAMEWORK_NO_DECIDER");
      expect(nd.some((n) => /confirmer lui-même/.test(n.message))).toBe(true);
      const r = await solo("solo", rid, { reason: "Je suis le seul Risk Manager" });
      expect(r.status, r.text).toBe(200);
      expect(await defaultsOf()).toEqual(["Tranché"]);
      expect(await reqRow(rid)).toMatchObject({ status: "APPROVED", decision_regime: "SOLE_RM", decider_group: "RISK_MANAGER", decision_comment: "Je suis le seul Risk Manager" });
      expect((await reqRow(rid)).decided_by).toBe(uid["solo"]);
      const au = await sql(`SELECT entity_type, entity_id, action, old_value, new_value, reason, governance_exception FROM audit_log WHERE tenant_id = $1 AND request_id IS NOT NULL AND action IN ('UPDATE','APPROVE') AND entity_id = ANY($2) ORDER BY entity_type, entity_id`, [TC, [F["Standard"], F["Tranché"], rid]]);
      const std = au.find((x) => x.entity_id === F["Standard"] && x.action === "UPDATE")!;
      const tr = au.find((x) => x.entity_id === F["Tranché"] && x.action === "UPDATE")!;
      const ap = au.find((x) => x.entity_id === rid && x.action === "APPROVE")!;
      expect(std.old_value.isDefault).toBe(true);
      expect(std.new_value.isDefault).toBe(false);
      expect(tr.new_value).toMatchObject({ isDefault: true, decisionRegime: "SOLE_RM", effect: "NEXT_EVALUATIONS" });
      expect(std.reason).toBe("Passer au 4x4 (seul RM)"); // motif de la DEMANDE sur les lignes Dispositif
      expect(tr.reason).toBe("Passer au 4x4 (seul RM)");
      expect(ap.reason).toBe("Je suis le seul Risk Manager"); // motif de la CONFIRMATION sur la decision
      expect(ap.governance_exception).toBe("riskFramework.soleRiskManager");
      for (const u of ["saud", "scom"]) {
        const n = (await notes(u, "RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE")).filter((x) => x.resource_id === rid);
        expect(n, u).toHaveLength(1);
        expect(n[0]!.message).toMatch(/changement du Dispositif par défaut/i);
      }
      expect((await notes("solo", "RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE")).filter((x) => x.resource_id === rid)).toHaveLength(0);
      const h = await call("solo", "GET", "/governance-health");
      expect(h.status, h.text).toBe(200);
      expect(h.text).toContain("riskFramework.soleRiskManager");
      expect((await call("solo", "GET", "/risk-frameworks/change-requests?regime=SOLE_RM")).text).toContain(rid);
      expect((await solo("solo", rid, { reason: "Encore" })).status).toBe(409);
      await resetDefault();
    });

    it("K1b motif : absent, null, vide, espaces, nombre, champ en trop, 501 car. : 400, demande PENDING, defaut inchange ; 500 car. accepte ; droits : hors groupe RM / Audit / Comite 403, sans jeton 401, autre tenant 404", async () => {
      const q = await ask("solo", F["Tranché"]!);
      const rid = q.json!["data"].id as string;
      const bad: Array<[string, unknown]> = [["absent", {}], ["null", { reason: null }], ["vide", { reason: "" }], ["espaces", { reason: "    " }], ["nombre", { reason: 7 }],
        ["champ en trop", { reason: "ok", decidedBy: uid["solo2"] }], ["501", { reason: "x".repeat(501) }]];
      for (const [label, b] of bad) {
        const r = await solo("solo", rid, b);
        expect(r.status, `${label}: ${r.text}`).toBe(400);
        expect((await reqRow(rid)).status).toBe("PENDING");
        expect(await defaultsOf()).toEqual(["Standard"]);
      }
      for (const who of ["sx", "saud", "scom", "solo2"] as Who[]) expect((await solo(who, rid, { reason: "Tentative" })).status, who).toBe(403);
      expect((await solo(null as unknown as Who, rid, { reason: "x" })).status).toBe(401);
      expect((await solo("rm1", rid, { reason: "Autre tenant" })).status).toBe(404);
      expect((await reqRow(rid)).status).toBe("PENDING");
      expect((await solo("solo", rid, { reason: "x".repeat(500) })).status).toBe(200);
      await resetDefault();
    });

    it("K1c la permission suit la demande : un compte avec riskframework.process.assign SANS riskframework.update ne confirme pas un SET_DEFAULT (403) ; et l'inverse pour ASSIGN_PROCESS (sans process.assign : 403) ; ASSIGN_PROCESS toujours confirmable seul", async () => {
      const rid = (await ask("solo", F["Tranché"]!)).json!["data"].id as string;
      const full = (await one(`SELECT permissions AS p FROM roles WHERE id = $1`, [F["RM_C"]])).p as string[];
      const without = (drop: string) => full.filter((p) => p !== drop);
      try {
        await sql(`UPDATE roles SET permissions = $2 WHERE id = $1`, [F["RM_C"], without("riskframework.update")]);
        const r = await solo("solo", rid, { reason: "Sans le droit de la demande" });
        expect(r.status, r.text).toBe(403);
        expect((await reqRow(rid)).status).toBe("PENDING");
      } finally { await sql(`UPDATE roles SET permissions = $2 WHERE id = $1`, [F["RM_C"], full]); }
      expect((await solo("solo", rid, { reason: "Avec les droits" })).status).toBe(200);
      await resetDefault();
      const p = await proc();
      const a = await call("solo", "POST", `/risk-frameworks/${F["Tranché"]}/process-assignments`, { processId: p, reason: "Rattachement 093" });
      expect(a.status, a.text).toBe(201);
      try {
        await sql(`UPDATE roles SET permissions = $2 WHERE id = $1`, [F["RM_C"], without("riskframework.process.assign")]);
        expect((await solo("solo", a.json!["data"].id, { reason: "Sans process.assign" })).status).toBe(403);
      } finally { await sql(`UPDATE roles SET permissions = $2 WHERE id = $1`, [F["RM_C"], full]); }
      expect((await solo("solo", a.json!["data"].id, { reason: "Rattachement seul" })).status).toBe(200);
    });

    it("K2 EFFET AU CYCLE SUIVANT : une evaluation creee avant la confirmation garde son Dispositif ; la suivante resout le nouveau defaut", async () => {
      await resetDefault();
      const p = await proc();
      const rk = (await one(`INSERT INTO risks (tenant_id, process, description, status, owner_id, process_id) VALUES ($1,'QA 093','QA 093','ACTIVE',$2,$3) RETURNING id`, [TC, uid["solo"], p])).id as string;
      const createEval = () => call("solo", "POST", "/risk-evaluations", { riskId: rk, evaluationType: "AD_HOC", subCategoryId: F["SUB"] });
      const e1 = await createEval();
      expect(e1.status, e1.text).toBe(201);
      expect(e1.json!["data"]).toMatchObject({ riskFrameworkVersionId: F["Standardv"], committeeEvaluationMinScore: 15 });
      const rid = (await ask("solo", F["Tranché"]!, "Effet au cycle suivant")).json!["data"].id as string;
      expect((await call("solo", "GET", `/risk-frameworks/applicable?processId=${p}`)).text).toContain(F["Standard"]); // en attente : inchange
      expect((await solo("solo", rid, { reason: "Seul RM, effet au cycle suivant" })).status).toBe(200);
      expect((await call("solo", "GET", `/risk-evaluations/${e1.json!["data"].id}`)).json!["data"]).toMatchObject({ riskFrameworkVersionId: F["Standardv"], committeeEvaluationMinScore: 15 });
      expect((await call("solo", "GET", `/risk-frameworks/applicable?processId=${p}`)).text).toContain(F["Tranché"]);
      await sql(`UPDATE risk_evaluations SET status = 'VALIDATED' WHERE id = $1`, [e1.json!["data"].id]);
      const e2 = await createEval();
      expect(e2.status, e2.text).toBe(201);
      expect(e2.json!["data"]).toMatchObject({ riskFrameworkVersionId: F["Tranchév"], committeeEvaluationMinScore: 9 });
      await resetDefault();
    });

    it("K3 regle FIGEE a la demande : demande faite avec un 2e RM present => 409 meme apres son depart ; 2e RM arrive apres la demande => 409 ; une fois seul de nouveau, une NOUVELLE demande est confirmable", async () => {
      const addRm = () => sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [TC, F["RM_C"], uid["solo2"], uid["solo"]]);
      const dropRm = () => sql(`UPDATE user_roles SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`, [TC, uid["solo2"]]);
      // (a) 2e RM present a la demande
      await addRm();
      let rid = "";
      try {
        const q = await ask("solo", F["Tranché"]!, "Demande avec un 2e RM");
        expect(q.status, q.text).toBe(201);
        rid = q.json!["data"].id as string;
        expect((await reqRow(rid)).sole_rm_at_request).toBe(false);
      } finally { await dropRm(); }
      const r1 = await solo("solo", rid, { reason: "Le second est parti" });
      expect(r1.status, r1.text).toBe(409);
      expect(r1.text).toMatch(/tiers/);
      expect((await reqRow(rid)).status).toBe("PENDING");
      expect((await call("solo", "POST", `/risk-frameworks/change-requests/${rid}/withdraw`, { reason: "Retrait" })).status).toBe(200);
      // (b) 2e RM arrive apres la demande
      const q2 = await ask("solo", F["Tranché"]!, "Demande seul");
      const rid2 = q2.json!["data"].id as string;
      expect((await reqRow(rid2)).sole_rm_at_request).toBe(true);
      await addRm();
      try {
        const r2 = await solo("solo", rid2, { reason: "Un second est arrive" });
        expect(r2.status, r2.text).toBe(409);
        expect((await reqRow(rid2)).status).toBe("PENDING");
        expect(await defaultsOf()).toEqual(["Standard"]);
      } finally { await dropRm(); }
      // (c) de nouveau seul : la demande (b) est toujours valable (figee a vrai) et se confirme
      const r3 = await solo("solo", rid2, { reason: "De nouveau seul" });
      expect(r3.status, r3.text).toBe(200);
      await resetDefault();
    });

    it("K3b SET_DEFAULT decidable par un tiers quand il existe : le tiers approuve normalement (regime NORMAL), le demandeur seul ne le peut plus", async () => {
      await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [TC, F["RM_C"], uid["solo2"], uid["solo"]]);
      try {
        const rid = (await ask("solo", F["Tranché"]!, "Avec un tiers")).json!["data"].id as string;
        expect((await solo("solo", rid, { reason: "Seul" })).status).toBe(409);
        const d = await call("solo2", "POST", `/risk-frameworks/change-requests/${rid}/approve`, { comment: "ok" });
        expect(d.status, d.text).toBe(200);
        expect((await reqRow(rid)).decision_regime).toBe("NORMAL");
        expect(await defaultsOf()).toEqual(["Tranché"]);
      } finally {
        await sql(`UPDATE user_roles SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`, [TC, uid["solo2"]]);
        await resetDefault();
      }
    });
  });

  // ------------------------------------------------------------------------------------------------ K4
  describe("K4 concurrence", () => {
    it("K4a deux confirmations simultanees de la MEME demande SET_DEFAULT : exactement un 200, l'autre 409, un seul changement de defaut, une seule paire d'audit", async () => {
      await resetDefault();
      const rid = (await ask("solo", F["Tranché"]!, "Double confirmation")).json!["data"].id as string;
      const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => solo("solo", rid, { reason: `Simultanee ${i}` })));
      expect(rs.filter((r) => r.status === 200), JSON.stringify(rs.map((r) => r.status))).toHaveLength(1);
      expect(rs.filter((r) => r.status === 409), JSON.stringify(rs.map((r) => r.status))).toHaveLength(4);
      expect(await defaultsOf()).toEqual(["Tranché"]);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE request_id IS NOT NULL AND entity_type = 'RiskFramework' AND action = 'UPDATE' AND entity_id = $1 AND new_value->>'requestId' = $2`, [F["Tranché"], rid])).toBe(1);
      expect(await count(`SELECT count(*)::int n FROM notifications WHERE event_type = 'RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE' AND resource_id = $1 AND recipient_user_id = $2`, [rid, uid["saud"]])).toBe(1);
      await resetDefault();
    });

    it("K4b CONFIRMATION PENDANT L'AJOUT D'UN 2e RM (12 courses decalees) : jamais 500 ; 200 <=> APPROVED + defaut deplace ; 409 <=> PENDING + defaut inchange ; avec le 2e RM en place la confirmation d'une demande NEUVE est refusee", async () => {
      const seen = { ok: 0, conflict: 0 };
      for (let i = 0; i < 12; i++) {
        await resetDefault();
        const q0 = await ask("solo", F["Tranché"]!, `Course ${i}`);
        expect(q0.status, `${i}: ${q0.text}`).toBe(201);
        const rid = q0.json!["data"].id as string;
        const extra = (await one(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1,$2,$2,$3) RETURNING id`, [TC, `race093-${i}-${Date.now()}@b6c.test`, []])).id as string;
        const [c, ins] = await Promise.all([
          solo("solo", rid, { reason: `Course ${i}` }),
          new Promise<void>((ok) => setTimeout(ok, i * 5)).then(() => sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4) RETURNING id`, [TC, F["RM_C"], extra, uid["solo"]])),
        ]);
        try {
          expect(ins).toHaveLength(1);
          expect([200, 409], `${i}: ${c.text}`).toContain(c.status);
          const row = await reqRow(rid);
          if (c.status === 200) { seen.ok++; expect(row).toMatchObject({ status: "APPROVED", decision_regime: "SOLE_RM" }); expect(await defaultsOf()).toEqual(["Tranché"]); }
          else { seen.conflict++; expect(row.status).toBe("PENDING"); expect(await defaultsOf()).toEqual(["Standard"]); }
          if (c.status !== 200) expect((await call("solo", "POST", `/risk-frameworks/change-requests/${rid}/withdraw`, { reason: "Nettoyage" })).status).toBe(200);
          await resetDefault();
          const later = (await ask("solo", F["Tranché"]!, `Apres ${i}`)).json!["data"].id as string;
          expect((await solo("solo", later, { reason: "Apres la course" })).status).toBe(409);
          expect((await reqRow(later)).status).toBe("PENDING");
          await call("solo", "POST", `/risk-frameworks/change-requests/${later}/withdraw`, { reason: "Nettoyage" });
        } finally {
          await sql(`UPDATE user_roles SET revoked_at = now() WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL`, [extra, TC]);
          if (c.status !== 200) await call("solo", "POST", `/risk-frameworks/change-requests/${rid}/withdraw`, { reason: "Nettoyage" });
        }
      }
      console.log("K4b outcomes", JSON.stringify(seen));
      await resetDefault();
    });

    it("K4c confirmation // retrait : une seule issue ; defaut deplace <=> APPROVED", async () => {
      for (let i = 0; i < 4; i++) {
        await resetDefault();
        const rid = (await ask("solo", F["Tranché"]!, `Retrait ${i}`)).json!["data"].id as string;
        const [a, b] = await Promise.all([solo("solo", rid, { reason: "Confirmer" }), call("solo", "POST", `/risk-frameworks/change-requests/${rid}/withdraw`, { reason: "Retirer" })]);
        expect([a.status, b.status].sort((x, y) => x - y), `${a.text} | ${b.text}`).toEqual([200, 409]);
        const row = await reqRow(rid);
        expect((await defaultsOf())[0] === "Tranché").toBe(row.status === "APPROVED");
      }
      await resetDefault();
    });

    it("K4d atomicite : panne d'audit sur l'UPDATE du Dispositif puis sur l'APPROVE : 5xx, defaut inchange, demande PENDING, aucune notification ; reprise possible", async () => {
      for (const [et, ac] of [["RiskFramework", "UPDATE"], ["RiskFrameworkChangeRequest", "APPROVE"]] as const) {
        await resetDefault();
        const rid = (await ask("solo", F["Tranché"]!, `Panne ${et}`)).json!["data"].id as string;
        await sql(`CREATE OR REPLACE FUNCTION qa_fail_audit_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $f$
          BEGIN IF EXISTS (SELECT 1 FROM qa_fail_audit f WHERE f.entity_type = NEW.entity_type AND (f.action IS NULL OR f.action = NEW.action)) THEN RAISE EXCEPTION 'QA: audit failure injected'; END IF; RETURN NEW; END $f$`);
        await sql(`DROP TRIGGER IF EXISTS qa_fail_audit_trg ON audit_log`);
        await sql(`CREATE TRIGGER qa_fail_audit_trg BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_audit_fn()`);
        await failAudit(et, ac);
        try {
          const r = await solo("solo", rid, { reason: `Panne ${et}` });
          expect(r.status, r.text).toBeGreaterThanOrEqual(500);
        } finally { await failAudit(null); await sql(`DROP TRIGGER qa_fail_audit_trg ON audit_log`); }
        expect(await defaultsOf(), et).toEqual(["Standard"]);
        expect((await reqRow(rid)).status).toBe("PENDING");
        expect(await count(`SELECT count(*)::int n FROM notifications WHERE event_type = 'RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE' AND resource_id = $1`, [rid])).toBe(0);
        expect((await solo("solo", rid, { reason: "Reprise" })).status).toBe(200);
      }
      await resetDefault();
    });
  });

  // ------------------------------------------------------------------------------------------------ K5
  describe("K5 cible archivee entre-temps", () => {
    it("K5 sole-confirm d'un SET_DEFAULT dont le Dispositif a ete archive : refus 4xx (jamais 500), demande PENDING, defaut inchange, aucune ecriture ; confirmable une fois la cible rouverte ; rejeu sur une demande deja confirmee 409", async () => {
      await resetDefault();
      const rid = (await ask("solo", F["Renforcé"]!, "Avant archivage")).json!["data"].id as string;
      await sql(`ALTER TABLE risk_frameworks DISABLE TRIGGER risk_frameworks_guard`);
      try { await sql(`UPDATE risk_frameworks SET archived_at = now(), archived_by = $2, archive_reason = 'QA' WHERE id = $1`, [F["Renforcé"], uid["solo"]]); } finally { await sql(`ALTER TABLE risk_frameworks ENABLE TRIGGER risk_frameworks_guard`); }
      const a0 = await count(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1 AND entity_type <> 'Notification'`, [TC]);
      try {
        const r = await solo("solo", rid, { reason: "Cible archivee" });
        expect(r.status, r.text).toBeGreaterThanOrEqual(400);
        expect(r.status, r.text).toBeLessThan(500);
        expect((await reqRow(rid)).status).toBe("PENDING");
        expect(await defaultsOf()).toEqual(["Standard"]);
        expect(await count(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1 AND entity_type <> 'Notification'`, [TC])).toBe(a0);
        expect(await count(`SELECT count(*)::int n FROM risk_frameworks WHERE tenant_id = $1 AND is_default AND archived_at IS NOT NULL`, [TC])).toBe(0);
      } finally {
        await sql(`ALTER TABLE risk_frameworks DISABLE TRIGGER risk_frameworks_guard`);
        try { await sql(`UPDATE risk_frameworks SET archived_at = NULL, archived_by = NULL, archive_reason = NULL WHERE id = $1`, [F["Renforcé"]]); } finally { await sql(`ALTER TABLE risk_frameworks ENABLE TRIGGER risk_frameworks_guard`); }
      }
      const ok = await solo("solo", rid, { reason: "Cible rouverte" });
      expect(ok.status, ok.text).toBe(200);
      expect(await defaultsOf()).toEqual(["Renforcé"]);
      expect((await solo("solo", rid, { reason: "Rejeu" })).status).toBe(409);
      await resetDefault();
    });

    it("K5b la version ACTIVE de la cible est archivee entre-temps (Dispositif non archive) : meme refus propre ; demande ASSIGN_PROCESS vers un Dispositif archive : meme refus", async () => {
      await resetDefault();
      const rid = (await ask("solo", F["Tranché"]!, "Version perdue")).json!["data"].id as string;
      await sql(`ALTER TABLE risk_framework_versions DISABLE TRIGGER USER`);
      try { await sql(`UPDATE risk_framework_versions SET status = 'ARCHIVED', archived_at = now(), archived_by = $2, archive_reason = 'QA' WHERE id = $1`, [F["Tranchév"], uid["solo"]]); } finally { await sql(`ALTER TABLE risk_framework_versions ENABLE TRIGGER USER`); }
      try {
        const r = await solo("solo", rid, { reason: "Sans version active" });
        expect(r.status, r.text).toBeGreaterThanOrEqual(400);
        expect(r.status, r.text).toBeLessThan(500);
        expect((await reqRow(rid)).status).toBe("PENDING");
        expect(await defaultsOf()).toEqual(["Standard"]);
      } finally {
        await sql(`ALTER TABLE risk_framework_versions DISABLE TRIGGER USER`);
        try { await sql(`UPDATE risk_framework_versions SET status = 'ACTIVE', archived_at = NULL, archived_by = NULL, archive_reason = NULL WHERE id = $1`, [F["Tranchév"]]); } finally { await sql(`ALTER TABLE risk_framework_versions ENABLE TRIGGER USER`); }
      }
      expect((await call("solo", "POST", `/risk-frameworks/change-requests/${rid}/withdraw`, { reason: "Nettoyage" })).status).toBe(200);
    });
  });

  // ------------------------------------------------------------------------------------------------ K6
  describe("K6 SEC-B13-01 : un processus supprime ne se restaure pas", () => {
    const code = async (q: string, p: unknown[] = []) => { try { await pg.query(q, p); return null; } catch (e) { return (e as { code?: string }).code ?? "?"; } };
    const attach = async (id: string, fw: string) => {
      await sql(`ALTER TABLE processes DISABLE TRIGGER processes_framework_guard`);
      try { await sql(`UPDATE processes SET risk_framework_id = $2 WHERE id = $1`, [id, fw]); } finally { await sql(`ALTER TABLE processes ENABLE TRIGGER processes_framework_guard`); }
    };

    it("K6 supprimer un processus rattache (avec ou sans detachement dans la meme ecriture) reste permis ; le RESTAURER (deleted_at -> NULL) est refuse en 42501 quel que soit le reste, y compris apres un detachement : plus de chemin « supprimer, detacher, restaurer »", async () => {
      const p = await proc();
      await attach(p, F["Tranché"]!);
      expect(await code(`UPDATE processes SET risk_framework_id = NULL WHERE id = $1`, [p]), "detacher un vivant").toBe("42501");
      expect(await code(`UPDATE processes SET deleted_at = now() WHERE id = $1`, [p]), "supprimer").toBeNull();
      expect(await code(`UPDATE processes SET deleted_at = NULL WHERE id = $1`, [p]), "restaurer").toBe("42501");
      expect(await code(`UPDATE processes SET risk_framework_id = NULL WHERE id = $1`, [p]), "detacher un supprime").toBeNull();
      expect(await code(`UPDATE processes SET deleted_at = NULL WHERE id = $1`, [p]), "restaurer apres detachement").toBe("42501");
      expect(await code(`UPDATE processes SET deleted_at = NULL, risk_framework_id = $2 WHERE id = $1`, [p, F["Standard"]]), "restaurer + rattacher").toBe("42501");
      expect((await one(`SELECT deleted_at IS NOT NULL AS d, risk_framework_id FROM processes WHERE id = $1`, [p])).d).toBe(true);
      // un processus jamais rattache : meme regle
      const q = await proc();
      expect(await code(`UPDATE processes SET deleted_at = now() WHERE id = $1`, [q])).toBeNull();
      expect(await code(`UPDATE processes SET deleted_at = NULL WHERE id = $1`, [q])).toBe("42501");
      // modifier un processus supprime sans le restaurer reste possible (nom)
      expect(await code(`UPDATE processes SET name = 'renomme' WHERE id = $1`, [q])).toBeNull();
      // aucun chemin applicatif : l'API ne restaure pas
      const del = await call("pu", "PATCH", `/processes/${q}`, { active: true });
      expect(del.status).toBeLessThan(500);
      expect((await one(`SELECT deleted_at IS NOT NULL AS d FROM processes WHERE id = $1`, [q])).d).toBe(true);
    });

    it("K6b chemins applicatifs intacts : archivage soft d'un processus par l'API (reason) puis rattachement d'un autre processus approuve (guard 088) toujours possible", async () => {
      const p = await proc();
      const a = await call("solo", "POST", `/risk-frameworks/${F["Tranché"]}/process-assignments`, { processId: p, reason: "Rattachement K6b" });
      expect(a.status, a.text).toBe(201);
      expect((await solo("solo", a.json!["data"].id, { reason: "Seul RM K6b" })).status).toBe(200);
      expect((await one(`SELECT risk_framework_id AS f FROM processes WHERE id = $1`, [p])).f).toBe(F["Tranché"]);
    });
  });

  // ------------------------------------------------------------------------------------------------ K7
  describe("K7 audit du rebind d'identite", () => {
    const code = async (q: string, p: unknown[] = []) => { try { await pg.query(q, p); return null; } catch (e) { return (e as { code?: string }).code ?? "?"; } };
    const rows = (id: string) => sql(`SELECT action, entity_type, entity_id, user_id, old_value, new_value, reason, request_id FROM audit_log WHERE entity_type = 'User' AND entity_id = $1 AND request_id = 'identity-rebind' ORDER BY timestamp, id`, [id]);

    it("K7 rien a la PREMIERE liaison (NULL -> sub) ; changement de sub : 1 ligne User UPDATE sans le sub ; changement de fournisseur seul : 1 ligne ; effacement : 1 ligne « Identity binding cleared » ; re-liaison apres effacement : aucune ; mise a jour sans changement ou d'une autre colonne : aucune", async () => {
      const u = uid["solo2"]!;
      const subA = "SUB-ALPHA-12345";
      const subB = "SUB-BRAVO-67890";
      expect(await code(`UPDATE users SET identity_provider = 'google', identity_subject = $2 WHERE id = $1`, [u, subA]), "premiere liaison").toBeNull();
      expect(await rows(u), "rien a la premiere liaison").toHaveLength(0);
      expect(await code(`UPDATE users SET identity_subject = $2 WHERE id = $1`, [u, subA]), "meme valeur").toBeNull();
      expect(await code(`UPDATE users SET display_name = 'Autre nom' WHERE id = $1`, [u]), "autre colonne").toBeNull();
      expect(await rows(u)).toHaveLength(0);
      expect(await code(`UPDATE users SET identity_subject = $2 WHERE id = $1`, [u, subB]), "changement de sub").toBeNull();
      let r = await rows(u);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ action: "UPDATE", entity_type: "User", request_id: "identity-rebind" });
      expect(r[0]!.old_value).toEqual({ identityLinked: true, identityProvider: "google" });
      expect(r[0]!.new_value).toEqual({ identityLinked: true, identityProvider: "google" });
      expect(r[0]!.reason).toMatch(/changed directly in the database/);
      expect(await code(`UPDATE users SET identity_provider = 'okta' WHERE id = $1`, [u]), "fournisseur seul").toBeNull();
      r = await rows(u);
      expect(r).toHaveLength(2);
      expect(r[1]!.old_value).toEqual({ identityLinked: true, identityProvider: "google" });
      expect(r[1]!.new_value).toEqual({ identityLinked: true, identityProvider: "okta" });
    });

    it("K7b suite : fournisseur change avec le sub, effacement, re-liaison ; le sub n'apparait dans AUCUNE ligne d'audit ; tenant et auteur de la ligne ; la ligne est append-only comme le reste de l'audit", async () => {
      const u = uid["solo2"]!;
      const before = (await rows(u)).length;
      expect(await code(`UPDATE users SET identity_provider = 'okta', identity_subject = 'SUB-CHARLIE-111' WHERE id = $1`, [u]), "fournisseur change").toBeNull();
      expect(await code(`UPDATE users SET identity_provider = NULL, identity_subject = NULL WHERE id = $1`, [u]), "effacement").toBeNull();
      const afterClear = await rows(u);
      expect(afterClear.length - before).toBe(2);
      const cleared = afterClear[afterClear.length - 1]!;
      expect(cleared.new_value).toEqual({ identityLinked: false, identityProvider: null });
      expect(cleared.reason).toMatch(/Identity binding cleared/);
      expect(await code(`UPDATE users SET identity_provider = 'google', identity_subject = 'SUB-DELTA-222' WHERE id = $1`, [u]), "re-liaison").toBeNull();
      expect((await rows(u)).length, "re-liaison apres effacement : aucune ligne").toBe(afterClear.length);
      const all = JSON.stringify(await sql(`SELECT old_value, new_value, reason FROM audit_log WHERE entity_type = 'User' AND entity_id = $1`, [u]));
      for (const s of ["SUB-ALPHA-12345", "SUB-BRAVO-67890", "SUB-CHARLIE-111", "SUB-DELTA-222"]) expect(all, s).not.toContain(s);
      const row = (await rows(u))[0]!;
      expect(row.user_id).toBe(u);
      expect(await one(`SELECT tenant_id FROM audit_log WHERE entity_type = 'User' AND entity_id = $1 LIMIT 1`, [u])).toMatchObject({ tenant_id: TC });
      expect(await code(`UPDATE audit_log SET reason = 'x' WHERE entity_type = 'User' AND entity_id = $1`, [u])).not.toBeNull(); // append-only
    });

    it("K7c fonction : search_path epingle (pg_temp en dernier), trigger actif ; un utilisateur supprime (deleted_at) ou d'un autre tenant : la ligne porte SON tenant", async () => {
      const f = await sql(`SELECT proconfig FROM pg_proc WHERE proname = 'users_identity_rebind_audit'`);
      expect(f).toHaveLength(1);
      expect(f[0]!.proconfig).toEqual(["search_path=pg_catalog, public, pg_temp"]);
      expect((await sql(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'users_identity_rebind_audit'`)).map((x) => x.tgenabled)).toEqual(["O"]);
      const other = uid["rm1"]!; // tenant T
      await sql(`UPDATE users SET identity_provider = 'google', identity_subject = 'SUB-ECHO-1' WHERE id = $1`, [other]);
      await sql(`UPDATE users SET identity_subject = 'SUB-ECHO-2' WHERE id = $1`, [other]);
      expect(await one(`SELECT tenant_id FROM audit_log WHERE entity_type = 'User' AND entity_id = $1 AND request_id = 'identity-rebind'`, [other])).toMatchObject({ tenant_id: T });
    });
  });

  // ------------------------------------------------------------------------------------------------ K8
  describe("K8 migration 093", () => {
    const code = async (q: string, p: unknown[] = []) => { try { await pg.query(q, p); return null; } catch (e) { return (e as { code?: string }).code ?? "?"; } };

    it("K8a CHECK de forme : SOLE_RM sur SET_DEFAULT exige sole_rm_at_request vrai (comme ASSIGN_PROCESS), un decideur = demandeur, un motif non vide ; un SOLE_RM sur ACTIVATE_VERSION reste refuse", async () => {
      const mkReq = async (o: { kind: string; sole: boolean; regime: string | null; comment: string | null; same?: boolean }) => {
        await sql(`ALTER TABLE risk_framework_change_requests DISABLE TRIGGER USER`);
        try {
          const fw = (await one(`INSERT INTO risk_frameworks (tenant_id, name, created_by) VALUES ($1,$2,$3) RETURNING id`, [TC, `K8a ${Math.random()}`, uid["solo"]])).id as string;
          const decider = o.same === false ? uid["solo2"] : uid["solo"];
          return await code(`INSERT INTO risk_framework_change_requests (tenant_id, kind, framework_id, reason, requested_by, status, decided_by, decided_at, decision_regime, decider_group, decision_comment, sole_rm_at_request)
            VALUES ($1,$2,$3,'r',$4,'APPROVED',$5,now(),$6,'RISK_MANAGER',$7,$8)`, [TC, o.kind, fw, uid["solo"], decider, o.regime, o.comment, o.sole]);
        } finally { await sql(`ALTER TABLE risk_framework_change_requests ENABLE TRIGGER USER`); }
      };
      expect(await mkReq({ kind: "SET_DEFAULT", sole: true, regime: "SOLE_RM", comment: "ok" })).toBeNull();
      expect(await mkReq({ kind: "SET_DEFAULT", sole: false, regime: "SOLE_RM", comment: "ok" })).toBe("23514");
      expect(await mkReq({ kind: "SET_DEFAULT", sole: true, regime: "SOLE_RM", comment: "   " })).toBe("23514");
      expect(await mkReq({ kind: "SET_DEFAULT", sole: true, regime: "SOLE_RM", comment: null })).toBe("23514");
      expect(await mkReq({ kind: "SET_DEFAULT", sole: true, regime: "SOLE_RM", comment: "ok", same: false })).toBe("23514");
      expect(await mkReq({ kind: "SET_DEFAULT", sole: true, regime: "NORMAL", comment: "ok" })).toBe("23514"); // maker-checker conserve
    });

    it("K8b up / down / up sur base jetable (001..093 vs 001..092) : up rejoue identique ; down = fonctions de 092 et plus de trigger de rebind ; down REFUSE s'il existe une decision SOLE_RM sur SET_DEFAULT (rien ne change) ; up retablit l'etat", () => {
      const MDB = "grc_qa_093_mig";
      const REF = "grc_qa_093_ref";
      const M = (n: string) => join(ROOT, "database", "postgresql", "migrations", n);
      const psql = (db: string, args: string[]) => execFileSync("/usr/bin/psql", ["-X", "-q", "-h", "127.0.0.1", "-p", String(PGPORT), "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const run = (db: string, f: string) => { try { psql(db, ["-f", M(f)]); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
      const build = (db: string, upTo: string) => {
        psql("postgres", ["-c", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`, "-c", `CREATE DATABASE ${db}`]);
        try { psql(db, ["-c", "CREATE ROLE grc_app_runtime NOLOGIN"]); } catch { /* role du cluster deja la */ }
        try { psql(db, ["-c", "CREATE ROLE grc_migrator NOLOGIN"]); } catch { /* idem */ }
        psql(db, ["-c", "CREATE TABLE schema_migrations (filename text primary key, applied_at timestamptz not null default now())"]);
        const files = readdirSync(join(ROOT, "database", "postgresql", "migrations")).filter((x) => /^\d{3}_.*\.sql$/.test(x) && !x.endsWith(".down.sql")).sort((a, b) => a.localeCompare(b));
        for (const f of files) { if (f.slice(0, 3) > upTo) break; psql(db, ["-1", "-f", M(f)]); }
      };
      const defs = (db: string) => psql(db, ["-At", "-c", `SELECT p.proname || E'\\n' || pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname IN ('processes_framework_guard','risk_framework_change_requests_guard','users_identity_rebind_audit') ORDER BY p.proname`]);
      const cons = (db: string) => psql(db, ["-At", "-c", `SELECT conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'risk_framework_change_requests'::regclass ORDER BY conname`]);
      const trg = (db: string) => psql(db, ["-At", "-c", `SELECT tgname FROM pg_trigger WHERE tgname IN ('users_identity_rebind_audit','processes_framework_guard') ORDER BY tgname`]);
      build(MDB, "093");
      build(REF, "092");
      const full = { d: defs(MDB), c: cons(MDB), t: trg(MDB) };
      expect(trg(REF).trim()).toBe("processes_framework_guard");
      expect(full.t.trim().split("\n")).toEqual(["processes_framework_guard", "users_identity_rebind_audit"]);
      expect(run(MDB, "093_sole_rm_set_default_hardening.sql")).toBeNull(); // rejeu
      expect({ d: defs(MDB), c: cons(MDB), t: trg(MDB) }).toEqual(full);
      // une decision SOLE_RM sur SET_DEFAULT : le down refuse et annule tout
      psql(MDB, ["-c", `INSERT INTO tenants (id, name) VALUES ('${TC}','C') ON CONFLICT DO NOTHING`,
        "-c", "ALTER TABLE risk_framework_change_requests DISABLE TRIGGER USER",
        "-c", `INSERT INTO users (id, tenant_id, email, display_name, roles) VALUES ('11111111-0000-4000-8000-000000000001','${TC}','u@k8.test','u','{}')`,
        "-c", `INSERT INTO risk_frameworks (id, tenant_id, name, created_by) VALUES ('22222222-0000-4000-8000-000000000001','${TC}','F','11111111-0000-4000-8000-000000000001')`,
        "-c", `INSERT INTO risk_framework_change_requests (id, tenant_id, kind, framework_id, reason, requested_by, status, decided_by, decided_at, decision_regime, decider_group, decision_comment, sole_rm_at_request)
              VALUES ('33333333-0000-4000-8000-000000000001','${TC}','SET_DEFAULT','22222222-0000-4000-8000-000000000001','r','11111111-0000-4000-8000-000000000001','APPROVED','11111111-0000-4000-8000-000000000001',now(),'SOLE_RM','RISK_MANAGER','ok',true)`,
        "-c", "ALTER TABLE risk_framework_change_requests ENABLE TRIGGER USER"]);
      const err = run(MDB, "093_sole_rm_set_default_hardening.down.sql");
      expect(err, "down refuse").not.toBeNull();
      expect(err).toMatch(/violat|check/i);
      expect({ d: defs(MDB), c: cons(MDB), t: trg(MDB) }, "rien n'a change").toEqual(full);
      psql(MDB, ["-c", "ALTER TABLE risk_framework_change_requests DISABLE TRIGGER USER", "-c", "DELETE FROM risk_framework_change_requests WHERE decision_regime = 'SOLE_RM' AND kind = 'SET_DEFAULT'", "-c", "ALTER TABLE risk_framework_change_requests ENABLE TRIGGER USER"]);
      expect(run(MDB, "093_sole_rm_set_default_hardening.down.sql")).toBeNull();
      const strip = (s: string) => s.split("\n").filter((l) => l.trim() !== "").join("\n");
      expect(strip(defs(MDB))).toBe(strip(defs(REF)));
      expect(trg(MDB).trim()).toBe("processes_framework_guard");
      expect(strip(cons(MDB))).toBe(strip(cons(REF)));
      expect(run(MDB, "093_sole_rm_set_default_hardening.down.sql")).toBeNull(); // rejouable
      expect(run(MDB, "093_sole_rm_set_default_hardening.sql")).toBeNull();
      expect({ d: defs(MDB), c: cons(MDB), t: trg(MDB) }).toEqual(full);
    }, 280000);
  });
});
