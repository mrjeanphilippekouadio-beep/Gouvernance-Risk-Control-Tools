import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { Pool } from "pg";
import { PostgresRiskFrameworkRepository } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";

/**
 * QA-B6c (niveau 2) : lot B-6c, rattachement d'un processus a un autre Dispositif (spec RM-V1-B6-Dispositif-spec.md §11.1, q89, I-C1).
 * Oracles ecrits AVANT l'execution. Ce n'est pas un avis Security / Privacy / Compliance.
 *
 * Partie « live » : QA_B6C_LIVE=1, VRAI serveur tsx (AUTH_PROVIDER=local) + PostgreSQL 16 LOCAL (127.0.0.1:55442, jamais Neon),
 * cluster monte par tests/integration/qa-visibility-v1-setup.sh. Les requetes SQL du lot (verrous, FOR SHARE/FOR UPDATE, CHECK) ne sont
 * donc plus emulees par un faux pool.
 *
 * A  CREATION  POST /risk-frameworks/:id/process-assignments
 *    A1 RM -> 201, demande PENDING kind ASSIGN_PROCESS, previous_value {frameworkId:null}, processes.risk_framework_id TOUJOURS null,
 *       1 ligne d'audit SUBMIT (meme transaction), notification aux AUTRES detenteurs de riskframework.activate.
 *    A2 non RM (compte avec les droits en direct, compte simple, Audit) -> 403 ; sans jeton -> 401 ; rien ecrit.
 *    A3 corps invalides (processId absent / non uuid / champ en trop, motif absent / vide / espaces / NUL / 501 car.) -> 400, rien ecrit ;
 *       motif sur 2 lignes (textarea reel) et 500 car. -> 201.
 *    A4 cibles refusees sans rien ecrire : Dispositif inconnu 404 ; sans version ACTIVE 400 ; archive 400 ; processus inconnu / d'un autre tenant
 *       (meme reponse, pas d'oracle) / supprime / niveau SUBPROCESS 400 ; deja rattache a ce Dispositif 400 ; demande PENDING deja la : 409,
 *       y compris vers un AUTRE Dispositif (une demande vivante par processus pour tout le tenant) ; id en MAJUSCULES : memes regles.
 * B  DECISION  POST /change-requests/:rid/approve|reject|withdraw
 *    B1 le demandeur ne decide pas (403) ; non RM 403 ; approve par un autre RM -> 200 : APPROVED, decided_by, regime NORMAL,
 *       processes.risk_framework_id = Dispositif d'arrivee ; audit Process UPDATE (avant null -> apres FB, motif DE LA DEMANDE) + APPROVE ;
 *       notification au demandeur.
 *    B2 rejouer approve / reject apres approve / retrait apres approve -> 409, aucun effet supplementaire.
 *    B3 reject : commentaire obligatoire (400) ; REJECTED, processus inchange, 1 audit REJECT, 0 audit Process ; nouvelle demande possible ensuite.
 *    B4 retrait : demandeur seulement (403 sinon), motif obligatoire (400), WITHDRAWN, processus inchange, audit STATUS_CHANGE ; approve apres -> 409.
 *    B5 CONCURRENCE : N approbations simultanees d'une meme demande -> exactement 1 x 200, les autres 409, 1 seul audit Process UPDATE ;
 *       approve // reject et approve // withdraw -> 1 seule issue, processus rattache <=> APPROVED ; creations simultanees (meme processus, memes
 *       ou autres Dispositifs) -> 1 seule demande vivante.
 *    B6 ENTRE LA DEMANDE ET LA DECISION : processus supprime, processus qui change de niveau, Dispositif d'arrivee archive ou sans version
 *       ACTIVE : approve refuse (4xx, jamais 500), demande toujours PENDING, rien d'ecrit sur le processus ; reject reste possible.
 *    B7 ATOMICITE (panne d'audit injectee par trigger) : creation, approbation, retrait -> echec ET etat inchange (demande PENDING / absente,
 *       processus non rattache).
 *    B8 autre tenant : decider ou retirer la demande d'un autre tenant -> 404, rien d'ecrit.
 *    B9 deplacer un processus deja rattache : previous_value et audit portent l'ancien Dispositif.
 * C  EFFET AU CYCLE SUIVANT (de bout en bout, vraies evaluations)
 *    C1 evaluation E1 creee AVANT l'approbation : version / echelle / seuils figes ; apres approbation E1 est INCHANGEE et sa cotation reste sur son
 *       echelle (5x5) ; l'evaluation E2 creee APRES resout le Dispositif d'arrivee (version, echelle 3x3, seuil copie) ; E2 refuse une probabilite 5.
 *    C2 un sous-processus herite du rattachement du processus (GET /applicable) ; un autre processus garde le Dispositif par defaut.
 *    C3 audit du changement de processus d'un risque : ancien / nouveau Dispositif (+ frameworkChanged) ; pas de ligne si le processus ne change pas ;
 *       panne d'audit => le changement de processus n'est PAS applique (meme transaction).
 * D  I-C1 sur PG reel : un Dispositif 6x6 (seuil Comite 21) s'active alors que des echelles 3x3 / 5x5 restent ACTIVE ; un seuil > plafond de SA propre
 *    echelle reste refuse (message listant TOUS les seuils fautifs) ; un seuil entre le plafond de sa propre echelle (9) et celui d'une autre (25)
 *    est refuse pour l'echelle 3x3 mais accepte pour 5x5.
 */
const ROOT = join(__dirname, "..", "..");
const live = process.env["QA_B6C_LIVE"] === "1";
const PGPORT = 55442;
const DB = "grc_qa_b6c";
const PORT = 8094;
const API = `http://127.0.0.1:${PORT}/api/v1`;
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const TB = "bbbbbbbb-0000-4000-8000-000000000001";
const UNKNOWN = "cccccccc-0000-4000-8000-0000000009ff";

type Who = "rm1" | "rm2" | "rm3" | "rm4" | "plain" | "adm" | "aud" | "rmb" | "rmb2" | "pu";
const WHO: Who[] = ["rm1", "rm2", "rm3", "rm4", "plain", "adm", "aud", "rmb", "rmb2", "pu"];
const TOK = {} as Record<Who, string>;
let pg: Pool;
const sh = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const sql = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows as Row[];
const one = async (q: string, p: unknown[] = []) => (await sql(q, p))[0]!;
/** Test setup only: migration 088 forbids writing processes.risk_framework_id outside an approved request, so the guard is lifted around the write. */
const attach = async (id: string, fw: string) => {
  await sql(`ALTER TABLE processes DISABLE TRIGGER processes_framework_guard`);
  try { await sql(`UPDATE processes SET risk_framework_id = $2 WHERE id = $1`, [id, fw]); } finally { await sql(`ALTER TABLE processes ENABLE TRIGGER processes_framework_guard`); }
};

type Res = { status: number; text: string; json: Row | null };
async function call(who: Who | null, method: string, path: string, body?: unknown): Promise<Res> {
  const r = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${TOK[who]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: Row | null = null;
  try { json = JSON.parse(text) as Row; } catch { /* not JSON */ }
  return { status: r.status, text, json };
}
const uid: Record<string, string> = {};

// fixtures filled in beforeAll
const F: Record<string, string> = {}; // FA FB FC FD (frameworks), vA vB (versions), S5 S3 S6 (scales), CAT (sub category)
let seq = 0;
async function proc(level = "PROCESS", parent: string | null = null, tenant = T): Promise<string> {
  seq += 1;
  return (await one(`INSERT INTO processes (tenant_id, level, name, parent_id) VALUES ($1,$2,$3,$4) RETURNING id`, [tenant, level, `QA B6c ${level} ${seq}`, parent])).id as string;
}
async function risk(processId: string | null): Promise<string> {
  seq += 1;
  return (await one(`INSERT INTO risks (tenant_id, process, description, status, owner_id, process_id) VALUES ($1,$2,$3,'ACTIVE',$4,$5) RETURNING id`,
    [T, `QA risk ${seq}`, `QA risk ${seq}`, uid["rm1"], processId])).id as string;
}
const attached = async (p: string) => (await one(`SELECT risk_framework_id AS f FROM processes WHERE id = $1`, [p])).f as string | null;
const reqRow = async (id: string) => one(`SELECT * FROM risk_framework_change_requests WHERE id = $1`, [id]);
const audits = (entityId: string, entityType?: string) =>
  sql(`SELECT * FROM audit_log WHERE entity_id = $1 ${entityType ? "AND entity_type = $2" : ""} ORDER BY timestamp, action`, entityType ? [entityId, entityType] : [entityId]);
const snap = async () => ({
  req: (await one(`SELECT count(*)::int n FROM risk_framework_change_requests WHERE tenant_id = $1`, [T])).n as number,
  aud: (await one(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1`, [T])).n as number,
  att: (await one(`SELECT count(*)::int n FROM processes WHERE tenant_id = $1 AND risk_framework_id IS NOT NULL`, [T])).n as number,
});
const ask = (who: Who, fw: string, processId: string, reason = "Rattachement QA") => call(who, "POST", `/risk-frameworks/${fw}/process-assignments`, { processId, reason });
const decide = (who: Who, rid: string, what: "approve" | "reject" | "withdraw", text?: string) =>
  call(who, "POST", `/risk-frameworks/change-requests/${rid}/${what}`, what === "approve" ? (text ? { comment: text } : {}) : what === "reject" ? { comment: text ?? "Refus QA" } : { reason: text ?? "Retrait QA" });
async function failAudit(entityType: string | null, action: string | null = null, key: string | null = null) {
  await sql(`DELETE FROM qa_fail_audit`);
  if (entityType) await sql(`INSERT INTO qa_fail_audit (entity_type, action, key) VALUES ($1,$2,$3)`, [entityType, action, key]);
}
/** A pending request ready for decision tests. */
async function pending(fw = F["FB"]!, who: Who = "rm1") {
  const p = await proc();
  const r = await ask(who, fw, p);
  expect(r.status, r.text).toBe(201);
  return { p, rid: r.json!["data"].id as string };
}

describe.skipIf(!live)("QA-B6c sur le VRAI serveur + PostgreSQL 16 LOCAL", () => {
  beforeAll(async () => {
    sh("bash", [join(ROOT, "tests", "integration", "qa-visibility-v1-setup.sh"), "up", DB]);
    pg = new Pool({ host: "127.0.0.1", port: PGPORT, user: "postgres", database: DB, max: 6 });
    const RM = (await one(`SELECT id FROM roles WHERE tenant_id = $1 AND system_group = 'RISK_MANAGER'`, [T])).id as string;
    const AUD = (await one(`SELECT id FROM roles WHERE tenant_id = $1 AND system_group = 'AUDIT'`, [T])).id as string;
    const granter = (await one(`SELECT id FROM users WHERE email = 'adm@vv1.test'`)).id as string;
    const RMPERMS = ["riskframework.read", "riskframework.create", "riskframework.update", "riskframework.activate", "riskframework.archive", "riskframework.process.assign", "risk.read", "process.read"];
    const mk = async (n: string, perms: string[]) => {
      uid[n] = (await one(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1,$2,$2,$3) RETURNING id`, [T, `${n}@b6c.test`, perms])).id as string;
    };
    for (const n of ["rm1", "rm2", "rm3", "rm4"]) {
      await mk(n, []);
      await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [T, RM, uid[n], granter]);
    }
    await mk("plain", ["risk.read", "process.read", "riskframework.read"]);
    await mk("adm", RMPERMS); // every right in direct, but NOT a member of the Risk Manager group
    await mk("aud", []);
    await mk("pu", ["process.read", "process.update", "process.create", "department.read", "riskframework.read"]); // edits processes, is no Risk Manager
    await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [T, AUD, uid["aud"], granter]);

    // second tenant: one Risk Manager, one process, one framework with an ACTIVE version, one pending request
    await sql(`INSERT INTO tenants (id, name) VALUES ($1,'Tenant B QA B6c')`, [TB]);
    const roleB = (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1,'Risk Manager B',$2,'RISK_MANAGER') RETURNING id`, [TB, RMPERMS])).id as string;
    uid["rmb"] = (await one(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1,'rmb@b6c.test','rmb',$2) RETURNING id`, [TB, []])).id as string;
    uid["rmb2"] = (await one(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1,'rmb2@b6c.test','rmb2',$2) RETURNING id`, [TB, []])).id as string;
    await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$3),($1,$2,$4,$3)`, [TB, roleB, uid["rmb"], uid["rmb2"]]);

    const c = await pg.connect();
    try {
      await c.query("SET session_replication_role = replica"); // fixtures only: ACTIVE versions are normally reached through the activation circuit
      const lv = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `Niveau ${i + 1}` })));
      const axes = (n: number) => JSON.stringify({ axes: [{ code: "FIN", label: "Financier", order: 1, levelLabels: JSON.parse(lv(n)) }], retainedImpactRule: "MAX" });
      const scale = async (tenant: string, n: number, status: string) => (await c.query(
        `INSERT INTO rating_scales (tenant_id, name, version, status, probability_levels, probability_labels, impact_levels, impact_labels, impact_axes, activated_at)
         VALUES ($1,$2,'1',$3,$4,$5::jsonb,$4,$6::jsonb,$7::jsonb, CASE WHEN $3 = 'ACTIVE' THEN now() END) RETURNING id`,
        [tenant, `Echelle ${n}x${n} ${status}`, status, n, lv(n), lv(n), axes(n)])).rows[0].id as string;
      F["S5"] = await scale(T, 5, "ACTIVE");
      F["S3"] = await scale(T, 3, "ACTIVE");
      F["S6"] = await scale(T, 6, "DRAFT");
      F["S3b"] = await scale(T, 3, "DRAFT");
      F["S5b"] = await scale(T, 5, "DRAFT");
      const fw = async (tenant: string, name: string, isDefault: boolean) => (await c.query(`INSERT INTO risk_frameworks (tenant_id, name, is_default, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [tenant, name, isDefault, tenant === T ? uid["rm1"] : uid["rmb"]])).rows[0].id as string;
      const ver = async (tenant: string, fwId: string, scaleId: string, status: string, committee: number) => (await c.query(
        `INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, status, rating_scale_id, committee_evaluation_min_score, created_by, last_edited_by, activated_at, low_criticality_threshold)
         VALUES ($1,$2,1,$3,$4,$5,$6,$6, CASE WHEN $3 = 'ACTIVE' THEN now() END, 3) RETURNING id`, [tenant, fwId, status, scaleId, committee, tenant === T ? uid["rm1"] : uid["rmb"]])).rows[0].id as string;
      F["FA"] = await fw(T, "Dispositif A (defaut, 5x5)", true);
      F["FB"] = await fw(T, "Dispositif B (3x3)", false);
      F["FC"] = await fw(T, "Dispositif C (sans version active)", false);
      F["FD"] = await fw(T, "Dispositif D (archive)", false);
      F["FX"] = await fw(T, "Dispositif X (sacrifie)", false);
      F["vA"] = await ver(T, F["FA"]!, F["S5"]!, "ACTIVE", 15);
      F["vB"] = await ver(T, F["FB"]!, F["S3"]!, "ACTIVE", 6);
      F["vX"] = await ver(T, F["FX"]!, F["S5"]!, "ACTIVE", 14);
      await ver(T, F["FC"]!, F["S5b"]!, "DRAFT", 10);
      await ver(T, F["FD"]!, F["S5"]!, "ACTIVE", 10);
      await c.query(`UPDATE risk_frameworks SET archived_at = now(), archived_by = $2, archive_reason = 'QA' WHERE id = $1`, [F["FD"], uid["rm1"]]);
      await c.query(`UPDATE risk_framework_versions SET status = 'ARCHIVED', archived_at = now(), archived_by = $2, archive_reason = 'QA' WHERE framework_id = $1`, [F["FD"], uid["rm1"]]);
      F["FB_B"] = await fw(TB, "Dispositif tenant B", true);
      await ver(TB, F["FB_B"]!, await scale(TB, 5, "ACTIVE"), "ACTIVE", 15);
    } finally { await c.query("RESET session_replication_role"); c.release(); }
    F["CATROOT"] = (await one(`INSERT INTO risk_categories (tenant_id, name) VALUES ($1,'Racine QA') RETURNING id`, [T])).id as string;
    F["CAT"] = (await one(`INSERT INTO risk_categories (tenant_id, name, parent_id) VALUES ($1,'Sous-categorie QA',$2) RETURNING id`, [T, F["CATROOT"]])).id as string;
    F["PB"] = await proc("PROCESS", null, TB);
    await sql(`INSERT INTO risk_framework_change_requests (tenant_id, kind, framework_id, process_id, reason, requested_by) VALUES ($1,'ASSIGN_PROCESS',$2,$3,'B',$4)`, [TB, F["FB_B"], F["PB"], uid["rmb"]]);
    F["RB"] = (await one(`SELECT id FROM risk_framework_change_requests WHERE tenant_id = $1`, [TB])).id as string;

    await sql(`CREATE TABLE qa_fail_audit (entity_type text, action text, key text)`);
    await sql(`CREATE FUNCTION qa_fail_audit_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $f$
      BEGIN IF EXISTS (SELECT 1 FROM qa_fail_audit f WHERE f.entity_type = NEW.entity_type AND (f.action IS NULL OR f.action = NEW.action) AND (f.key IS NULL OR NEW.new_value ? f.key))
      THEN RAISE EXCEPTION 'QA: audit failure injected'; END IF; RETURN NEW; END $f$`);
    await sql(`CREATE TRIGGER qa_fail_audit_trg BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_audit_fn()`);

    sh("bash", [join(ROOT, "tests", "integration", "qa-b6c-server.sh"), "start"], { QA_PORT: String(PORT), QA_DB: DB });
    for (const w of WHO) {
      const r = await fetch(`${API}/auth/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${w}@b6c.test`, password: "whatever" }) });
      TOK[w] = ((await r.json()) as { accessToken: string }).accessToken;
      expect(TOK[w], w).toBeTruthy();
    }
  }, 280000);
  afterAll(async () => {
    await pg?.end();
    sh("bash", [join(ROOT, "tests", "integration", "qa-b6c-server.sh"), "stop"]);
  });

  // ------------------------------------------------------------------------------------------------ A
  describe("A creation", () => {
    it("A1 RM: 201, PENDING, process untouched, 1 SUBMIT audit, other holders notified", async () => {
      const p = await proc();
      const r = await ask("rm1", F["FB"]!, p, "Pour le test A1");
      expect(r.status, r.text).toBe(201);
      const d = r.json!["data"];
      expect(d).toMatchObject({ kind: "ASSIGN_PROCESS", status: "PENDING", frameworkId: F["FB"], processId: p, requestedBy: uid["rm1"], reason: "Pour le test A1" });
      expect(d.previousValue).toEqual({ frameworkId: null });
      expect(await attached(p)).toBeNull();
      const a = await audits(d.id);
      expect(a.map((x) => `${x.entity_type}/${x.action}/${x.user_id === uid["rm1"]}/${x.reason}`)).toEqual(["RiskFrameworkChangeRequest/SUBMIT/true/Pour le test A1"]);
      const n = await sql(`SELECT recipient_user_id FROM notifications WHERE tenant_id = $1 AND event_type = 'RISK_FRAMEWORK_CHANGE_PENDING' AND resource_id = $2`, [T, F["FB"]]);
      expect(n.map((x) => x.recipient_user_id)).toContain(uid["rm2"]);
      expect(n.map((x) => x.recipient_user_id)).not.toContain(uid["rm1"]);
    });

    it("A2 non Risk Manager (rights held directly / plain / Audit) 403, anonymous 401, nothing written", async () => {
      const p = await proc();
      const before = await snap();
      for (const who of ["adm", "plain", "aud"] as Who[]) expect((await ask(who, F["FB"]!, p)).status, who).toBe(403);
      expect((await ask(null as unknown as Who, F["FB"]!, p)).status).toBe(401);
      expect(await snap()).toEqual(before);
    });

    it("A3 invalid bodies are 400 and write nothing; a 2-line reason and a 500-char reason are accepted", async () => {
      const p = await proc();
      const before = await snap();
      const bad: Array<[string, unknown]> = [
        ["no processId", { reason: "x" }], ["processId not a uuid", { processId: "abc", reason: "x" }], ["processId null", { processId: null, reason: "x" }],
        ["extra field", { processId: p, reason: "x", requestedBy: uid["rm2"] }], ["no reason", { processId: p }], ["empty reason", { processId: p, reason: "" }],
        ["blank reason", { processId: p, reason: "   " }], ["NUL in reason", { processId: p, reason: "a\u0000b" }], ["501 chars", { processId: p, reason: "x".repeat(501) }],
        ["reason is a number", { processId: p, reason: 5 }], ["body is an array", [p]],
      ];
      for (const [label, body] of bad) {
        const r = await call("rm1", "POST", `/risk-frameworks/${F["FB"]}/process-assignments`, body);
        expect(r.status, `${label}: ${r.text}`).toBe(400);
      }
      expect((await call("rm1", "POST", `/risk-frameworks/not-a-uuid/process-assignments`, { processId: p, reason: "x" })).status).toBe(400);
      expect(await snap()).toEqual(before);
      const ok1 = await ask("rm1", F["FB"]!, p, "ligne 1\nligne 2");
      expect(ok1.status, ok1.text).toBe(201);
      const p2 = await proc();
      expect((await ask("rm1", F["FB"]!, p2, "x".repeat(500))).status).toBe(201);
    });

    it("A4 refused targets write nothing; unknown / other-tenant process answer alike; pending is tenant-wide", async () => {
      const p = await proc();
      const sub = await proc("SUBPROCESS", await proc());
      const gone = await proc();
      await sql(`UPDATE processes SET deleted_at = now() WHERE id = $1`, [gone]);
      const already = await proc();
      await attach(already, F["FB"]);
      const before = await snap();
      const refused: Array<[string, Res, number]> = [
        ["unknown framework", await ask("rm1", UNKNOWN, p), 404],
        ["framework without ACTIVE version", await ask("rm1", F["FC"]!, p), 400],
        ["archived framework", await ask("rm1", F["FD"]!, p), 400],
        ["unknown process", await ask("rm1", F["FB"]!, UNKNOWN), 400],
        ["other-tenant process", await ask("rm1", F["FB"]!, F["PB"]!), 400],
        ["deleted process", await ask("rm1", F["FB"]!, gone), 400],
        ["SUBPROCESS level", await ask("rm1", F["FB"]!, sub), 400],
        ["already attached to this framework", await ask("rm1", F["FB"]!, already), 400],
      ];
      for (const [label, r, status] of refused) expect(r.status, `${label}: ${r.text}`).toBe(status);
      const msg = (r: Res, id: string) => String(r.json?.["error"] ?? r.text).replaceAll(id, "<id>");
      expect(msg(refused[4]![1], F["PB"]!)).toBe(msg(refused[3]![1], UNKNOWN)); // no cross-tenant existence oracle
      expect(await snap()).toEqual(before);
      // pending is one per process for the whole tenant
      expect((await ask("rm1", F["FB"]!, p)).status).toBe(201);
      expect((await ask("rm2", F["FB"]!, p)).status).toBe(409);
      expect((await ask("rm2", F["FA"]!, p)).status).toBe(409);
      expect((await one(`SELECT count(*)::int n FROM risk_framework_change_requests WHERE process_id = $1 AND status = 'PENDING'`, [p])).n).toBe(1);
    });

    it("A5 an UPPERCASE process id follows the same rules (stored canonical, duplicate refused)", async () => {
      const p = await proc();
      const r = await ask("rm1", F["FB"]!, p.toUpperCase());
      expect(r.status, r.text).toBe(201);
      expect((await reqRow(r.json!["data"].id)).process_id).toBe(p);
      expect((await ask("rm2", F["FB"]!, p)).status).toBe(409);
      expect((await ask("rm2", F["FB"]!, p.toUpperCase())).status).toBe(409);
    });
  });

  // ------------------------------------------------------------------------------------------------ B
  describe("B decision", () => {
    it("B1 requester cannot decide, non RM cannot; another RM approves: state, audit (same transaction), notification", async () => {
      const { p, rid } = await pending();
      for (const [who, what] of [["rm1", "approve"], ["rm1", "reject"], ["adm", "approve"], ["plain", "approve"], ["aud", "approve"], ["rmb", "approve"]] as Array<[Who, "approve" | "reject"]>) {
        expect((await decide(who, rid, what)).status, `${who} ${what}`).toBe(who === "rmb" ? 404 : 403);
      }
      expect((await reqRow(rid)).status).toBe("PENDING");
      expect(await attached(p)).toBeNull();
      const r = await decide("rm2", rid, "approve", "ok pour moi");
      expect(r.status, r.text).toBe(200);
      const row = await reqRow(rid);
      expect(row).toMatchObject({ status: "APPROVED", decided_by: uid["rm2"], decision_regime: "NORMAL", decider_group: "RISK_MANAGER", decision_comment: "ok pour moi" });
      expect(await attached(p)).toBe(F["FB"]);
      const pa = await audits(p, "Process");
      expect(pa).toHaveLength(1);
      expect(pa[0]).toMatchObject({ action: "UPDATE", user_id: uid["rm2"], reason: "Rattachement QA" });
      expect(pa[0]!.old_value).toEqual({ riskFrameworkId: null });
      expect(pa[0]!.new_value).toMatchObject({ riskFrameworkId: F["FB"], requestId: rid, decisionRegime: "NORMAL", effect: "NEXT_EVALUATIONS" });
      const ra = await audits(rid, "RiskFrameworkChangeRequest");
      expect(ra.map((x) => x.action).sort((a, b) => a.localeCompare(b))).toEqual(["APPROVE", "SUBMIT"]);
      expect(new Date(pa[0]!.timestamp).getTime()).toBe(new Date(ra.find((x) => x.action === "APPROVE")!.timestamp).getTime());
      expect((await sql(`SELECT 1 FROM notifications WHERE recipient_user_id = $1 AND event_type = 'RISK_FRAMEWORK_CHANGE_DECIDED' AND resource_id = $2`, [uid["rm1"], rid]))).toHaveLength(1);
    });

    it("B2 replay / opposite decision / withdrawal after approval: 409 and no further effect", async () => {
      const { p, rid } = await pending();
      expect((await decide("rm2", rid, "approve")).status).toBe(200);
      const before = await snap();
      expect((await decide("rm2", rid, "approve")).status).toBe(409);
      expect((await decide("rm3", rid, "approve")).status).toBe(409);
      expect((await decide("rm3", rid, "reject")).status).toBe(409);
      expect((await decide("rm1", rid, "withdraw")).status).toBe(409);
      expect(await snap()).toEqual(before);
      expect(await attached(p)).toBe(F["FB"]);
      expect((await reqRow(rid)).status).toBe("APPROVED");
    });

    it("B3 reject: comment mandatory, process untouched, REJECT audit only, a new request is possible afterwards", async () => {
      const { p, rid } = await pending();
      expect((await call("rm2", "POST", `/risk-frameworks/change-requests/${rid}/reject`, {})).status).toBe(400);
      expect((await call("rm2", "POST", `/risk-frameworks/change-requests/${rid}/reject`, { comment: "  " })).status).toBe(400);
      expect((await reqRow(rid)).status).toBe("PENDING");
      expect((await decide("rm2", rid, "reject", "Non, car QA")).status).toBe(200);
      expect(await reqRow(rid)).toMatchObject({ status: "REJECTED", decided_by: uid["rm2"], decision_comment: "Non, car QA" });
      expect(await attached(p)).toBeNull();
      expect(await audits(p, "Process")).toHaveLength(0);
      expect((await audits(rid)).map((x) => x.action).sort((a, b) => a.localeCompare(b))).toEqual(["REJECT", "SUBMIT"]);
      expect((await ask("rm1", F["FB"]!, p)).status).toBe(201);
    });

    it("B4 withdrawal: requester only, reason mandatory, nothing on the process, approve afterwards 409, new request possible", async () => {
      const { p, rid } = await pending();
      expect((await decide("rm2", rid, "withdraw")).status).toBe(403);
      expect((await call("rm1", "POST", `/risk-frameworks/change-requests/${rid}/withdraw`, {})).status).toBe(400);
      expect((await reqRow(rid)).status).toBe("PENDING");
      const w = await decide("rm1", rid, "withdraw", "Je me suis trompe");
      expect(w.status, w.text).toBe(200);
      expect(await reqRow(rid)).toMatchObject({ status: "WITHDRAWN", decision_comment: "Je me suis trompe", decided_by: null });
      expect(await attached(p)).toBeNull();
      expect((await audits(rid)).map((x) => x.action).sort((a, b) => a.localeCompare(b))).toEqual(["STATUS_CHANGE", "SUBMIT"]);
      expect((await decide("rm2", rid, "approve")).status).toBe(409);
      expect((await decide("rm1", rid, "withdraw")).status).toBe(409);
      expect((await ask("rm1", F["FB"]!, p)).status).toBe(201);
    });

    it("B5 CONCURRENCE: 6 simultaneous approvals -> one winner; approve // reject; approve // withdraw; simultaneous creations", async () => {
      for (let round = 0; round < 3; round++) {
        const { p, rid } = await pending();
        const rs = await Promise.all((["rm2", "rm3", "rm4", "rm2", "rm3", "rm4"] as Who[]).map((w) => decide(w, rid, "approve")));
        expect(rs.filter((r) => r.status === 200), JSON.stringify(rs.map((r) => r.status))).toHaveLength(1);
        expect(rs.filter((r) => r.status === 409), JSON.stringify(rs.map((r) => r.status))).toHaveLength(5);
        expect(await attached(p)).toBe(F["FB"]);
        expect(await audits(p, "Process")).toHaveLength(1);
        expect((await audits(rid)).filter((x) => x.action === "APPROVE")).toHaveLength(1);
      }
      for (let round = 0; round < 3; round++) {
        const { p, rid } = await pending();
        const [a, b] = await Promise.all([decide("rm2", rid, "approve"), decide("rm3", rid, "reject")]);
        expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);
        expect((await reqRow(rid)).status).toBe(a.status === 200 ? "APPROVED" : "REJECTED");
        expect(await attached(p)).toBe(a.status === 200 ? F["FB"] : null);
        expect(await audits(p, "Process")).toHaveLength(a.status === 200 ? 1 : 0);
      }
      for (let round = 0; round < 3; round++) {
        const { p, rid } = await pending();
        const [a, w] = await Promise.all([decide("rm2", rid, "approve"), decide("rm1", rid, "withdraw")]);
        expect([a.status, w.status].sort((x, y) => x - y)).toEqual([200, 409]);
        expect((await reqRow(rid)).status).toBe(a.status === 200 ? "APPROVED" : "WITHDRAWN");
        expect(await attached(p)).toBe(a.status === 200 ? F["FB"] : null);
      }
      const p = await proc();
      const cs = await Promise.all([ask("rm1", F["FB"]!, p), ask("rm2", F["FB"]!, p), ask("rm3", F["FA"]!, p), ask("rm4", F["FX"]!, p)]);
      expect(cs.map((r) => r.status).sort((x, y) => x - y), cs.map((r) => r.text).join("|")).toEqual([201, 409, 409, 409]);
      expect((await one(`SELECT count(*)::int n FROM risk_framework_change_requests WHERE process_id = $1 AND status = 'PENDING'`, [p])).n).toBe(1);
    });

    it("B6 between request and decision: deleted process, level change, archived target, target without ACTIVE version", async () => {
      // deleted process
      let x = await pending();
      await sql(`UPDATE processes SET deleted_at = now() WHERE id = $1`, [x.p]);
      let r = await decide("rm2", x.rid, "approve");
      expect(r.status, r.text).toBeLessThan(500);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect((await reqRow(x.rid)).status).toBe("PENDING");
      expect(await attached(x.p)).toBeNull();
      expect(await audits(x.p, "Process")).toHaveLength(0);
      expect((await decide("rm2", x.rid, "reject")).status).toBe(200);
      // level change (the process becomes a sub-process of another one)
      x = await pending();
      const parent = await proc();
      await sql(`UPDATE processes SET level = 'SUBPROCESS', parent_id = $2 WHERE id = $1`, [x.p, parent]);
      r = await decide("rm2", x.rid, "approve");
      expect(r.status, r.text).toBeLessThan(500);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect((await reqRow(x.rid)).status).toBe("PENDING");
      expect(await attached(x.p)).toBeNull();
      expect((await decide("rm2", x.rid, "reject")).status).toBe(200);
      // target archived since the request
      x = await pending(F["FX"]!);
      await sql(`UPDATE risk_frameworks SET archived_at = now(), archived_by = $2, archive_reason = 'QA' WHERE id = $1`, [F["FX"], uid["rm1"]]);
      r = await decide("rm2", x.rid, "approve");
      expect(r.status, r.text).toBe(400);
      expect((await reqRow(x.rid)).status).toBe("PENDING");
      expect(await attached(x.p)).toBeNull();
      expect((await decide("rm2", x.rid, "reject")).status).toBe(200);
      await sql(`UPDATE risk_frameworks SET archived_at = NULL, archived_by = NULL, archive_reason = NULL WHERE id = $1`, [F["FX"]]);
      // target lost its ACTIVE version
      x = await pending(F["FX"]!);
      const c = await pg.connect();
      try {
        await c.query("SET session_replication_role = replica");
        await c.query(`UPDATE risk_framework_versions SET status = 'ARCHIVED', archived_at = now(), archived_by = $2, archive_reason = 'QA' WHERE id = $1`, [F["vX"], uid["rm1"]]);
      } finally { await c.query("RESET session_replication_role"); c.release(); }
      r = await decide("rm2", x.rid, "approve");
      expect(r.status, r.text).toBe(400);
      expect((await reqRow(x.rid)).status).toBe("PENDING");
      expect(await attached(x.p)).toBeNull();
    });

    it("B6b the repository replays the target check under lock (the service check alone is a TOCTOU window): archived target / lost ACTIVE version / deleted process -> refused, PENDING kept", async () => {
      const repo = new PostgresRiskFrameworkRepository(pg);
      const d = { outcome: "APPROVED" as const, decidedBy: uid["rm2"]!, comment: null, decisionRegime: "NORMAL" as const, deciderGroup: "RISK_MANAGER" as const, ratificationStatus: null };
      const fwY = (await one(`INSERT INTO risk_frameworks (tenant_id, name, created_by) VALUES ($1,'Dispositif Y',$2) RETURNING id`, [T, uid["rm1"]])).id as string;
      const c = await pg.connect();
      let vY: string;
      try {
        await c.query("SET session_replication_role = replica");
        vY = (await c.query(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, status, rating_scale_id, committee_evaluation_min_score, created_by, last_edited_by, activated_at, low_criticality_threshold)
          VALUES ($1,$2,1,'ACTIVE',$3,10,$4,$4,now(),3) RETURNING id`, [T, fwY, F["S5"], uid["rm1"]])).rows[0].id as string;
      } finally { await c.query("RESET session_replication_role"); c.release(); }
      const mkReq = async () => { const x = await pending(fwY); return x; };
      let x = await mkReq();
      await sql(`UPDATE risk_frameworks SET archived_at = now(), archived_by = $2, archive_reason = 'QA' WHERE id = $1`, [fwY, uid["rm1"]]);
      await expect(repo.decideAssignment!(T, x.rid, d)).rejects.toThrow();
      expect((await reqRow(x.rid)).status).toBe("PENDING");
      expect(await attached(x.p)).toBeNull();
      await sql(`UPDATE risk_frameworks SET archived_at = NULL, archived_by = NULL, archive_reason = NULL WHERE id = $1`, [fwY]);
      x = await mkReq();
      const c2 = await pg.connect();
      try {
        await c2.query("SET session_replication_role = replica");
        await c2.query(`UPDATE risk_framework_versions SET status = 'ARCHIVED', archived_at = now(), archived_by = $2, archive_reason = 'QA' WHERE id = $1`, [vY!, uid["rm1"]]);
      } finally { await c2.query("RESET session_replication_role"); c2.release(); }
      await expect(repo.decideAssignment!(T, x.rid, d)).rejects.toThrow();
      expect((await reqRow(x.rid)).status).toBe("PENDING");
      expect(await attached(x.p)).toBeNull();
      // a REJECTION never needs the target
      const rj = await repo.decideAssignment!(T, x.rid, { ...d, outcome: "REJECTED", comment: "non" });
      expect(rj.request.status).toBe("REJECTED");
      expect(rj.frameworkId).toBeNull();
    });

    it("B7 ATOMICITY: an audit failure on create / approve / withdraw leaves state unchanged", async () => {
      try {
        // creation
        await failAudit("RiskFrameworkChangeRequest", "SUBMIT");
        const p0 = await proc();
        const before = await snap();
        const c = await ask("rm1", F["FB"]!, p0);
        expect(c.status, c.text).toBeGreaterThanOrEqual(400);
        expect(await snap()).toEqual(before);
        // approval
        await failAudit(null);
        const { p, rid } = await pending();
        await failAudit("Process", "UPDATE");
        const a = await decide("rm2", rid, "approve");
        expect(a.status, a.text).toBeGreaterThanOrEqual(400);
        expect((await reqRow(rid)).status).toBe("PENDING");
        expect(await attached(p)).toBeNull();
        // rejection
        await failAudit("RiskFrameworkChangeRequest", "REJECT");
        const rj = await decide("rm2", rid, "reject");
        expect(rj.status, rj.text).toBeGreaterThanOrEqual(400);
        expect((await reqRow(rid)).status).toBe("PENDING");
        // withdrawal
        await failAudit("RiskFrameworkChangeRequest", "STATUS_CHANGE");
        const w = await decide("rm1", rid, "withdraw");
        expect(w.status, w.text).toBeGreaterThanOrEqual(400);
        expect((await reqRow(rid)).status).toBe("PENDING");
        // recovery
        await failAudit(null);
        expect((await decide("rm2", rid, "approve")).status).toBe(200);
        expect(await attached(p)).toBe(F["FB"]);
      } finally { await failAudit(null); }
    });

    it("B8 another tenant's request: 404 whatever the decision, nothing written", async () => {
      const before = await snap();
      for (const w of ["approve", "reject", "withdraw"] as const) expect((await decide("rm2", F["RB"]!, w)).status, w).toBe(404);
      expect((await reqRow(F["RB"]!)).status).toBe("PENDING");
      expect(await snap()).toEqual(before);
      const { rid } = await pending();
      for (const w of ["approve", "reject"] as const) expect((await decide("rmb", rid, w)).status, w).toBe(404);
      expect((await reqRow(rid)).status).toBe("PENDING");
    });

    it("B9 moving an already attached process: previous value and audit carry the former Dispositif", async () => {
      const p = await proc();
      await attach(p, F["FB"]);
      const r = await ask("rm1", F["FA"]!, p, "Retour au A");
      expect(r.status, r.text).toBe(201);
      expect(r.json!["data"].previousValue).toEqual({ frameworkId: F["FB"] });
      expect((await decide("rm2", r.json!["data"].id, "approve")).status).toBe(200);
      expect(await attached(p)).toBe(F["FA"]);
      const pa = await audits(p, "Process");
      expect(pa).toHaveLength(1);
      expect(pa[0]!.old_value).toEqual({ riskFrameworkId: F["FB"] });
      expect(pa[0]!.new_value).toMatchObject({ riskFrameworkId: F["FA"] });
    });
  });

  // ------------------------------------------------------------------------------------------------ C
  describe("C effect on the next cycle, end to end", () => {
    const evalOf = (rid: string) => call("rm1", "GET", `/risk-evaluations/${rid}`);
    const createEval = (riskId: string) => call("rm1", "POST", "/risk-evaluations", { riskId, evaluationType: "AD_HOC", subCategoryId: F["CAT"] });

    it("C1 the evaluation created before keeps its version and scale, the one created after resolves the new Dispositif", async () => {
      const p = await proc();
      const rk = await risk(p);
      const e1 = await createEval(rk);
      expect(e1.status, e1.text).toBe(201);
      const E1 = e1.json!["data"];
      expect(E1).toMatchObject({ riskFrameworkVersionId: F["vA"], ratingScaleId: F["S5"], committeeEvaluationMinScore: 15 });
      const appBefore = await call("rm1", "GET", `/risk-frameworks/applicable?processId=${p}`);
      expect(appBefore.json!["data"].frameworkId ?? appBefore.json!["data"].framework?.id ?? appBefore.text).toContain(F["FA"]);

      const rq = await ask("rm1", F["FB"]!, p);
      expect(rq.status).toBe(201);
      // still the old Dispositif while the request is pending
      expect((await call("rm1", "GET", `/risk-frameworks/applicable?processId=${p}`)).text).toContain(F["FA"]);
      expect((await decide("rm2", rq.json!["data"].id, "approve")).status).toBe(200);

      const e1After = (await evalOf(E1.id)).json!["data"];
      expect(e1After).toMatchObject({ riskFrameworkVersionId: F["vA"], ratingScaleId: F["S5"], committeeEvaluationMinScore: 15 });
      // E1 is still scored on ITS 5x5 scale
      const s1 = await call("rm1", "PATCH", `/risk-evaluations/${E1.id}/inherent`, { probability: 5, impacts: [{ code: "FIN", value: 5 }] });
      expect(s1.status, s1.text).toBe(200);
      // the next evaluation resolves the Dispositif of arrival
      const appAfter = await call("rm1", "GET", `/risk-frameworks/applicable?processId=${p}`);
      expect(appAfter.text).toContain(F["FB"]);
      expect(appAfter.text).not.toContain(F["FA"]);
      await sql(`UPDATE risk_evaluations SET status = 'VALIDATED' WHERE id = $1`, [E1.id]); // free the risk for a new cycle
      const e2 = await createEval(rk);
      expect(e2.status, e2.text).toBe(201);
      expect(e2.json!["data"]).toMatchObject({ riskFrameworkVersionId: F["vB"], ratingScaleId: F["S3"], committeeEvaluationMinScore: 6 });
      const s2 = await call("rm1", "PATCH", `/risk-evaluations/${e2.json!["data"].id}/inherent`, { probability: 5, impacts: [{ code: "FIN", value: 3 }] });
      expect(s2.status, s2.text).toBe(400);
      const s3 = await call("rm1", "PATCH", `/risk-evaluations/${e2.json!["data"].id}/inherent`, { probability: 3, impacts: [{ code: "FIN", value: 3 }] });
      expect(s3.status, s3.text).toBe(200);
      // E1 unchanged after all this
      expect((await evalOf(E1.id)).json!["data"]).toMatchObject({ riskFrameworkVersionId: F["vA"], ratingScaleId: F["S5"] });
    });

    it("C2 a sub-process inherits the attachment; an unattached process keeps the default Dispositif", async () => {
      const p = await proc();
      const sub = await proc("SUBPROCESS", p);
      const other = await proc();
      const rk = await risk(sub);
      const app = (id: string) => call("rm1", "GET", `/risk-frameworks/applicable?processId=${id}`).then((r) => r.text);
      expect(await app(sub)).toContain(F["FA"]);
      const rq = await ask("rm1", F["FB"]!, p);
      expect((await decide("rm2", rq.json!["data"].id, "approve")).status).toBe(200);
      expect(await app(sub)).toContain(F["FB"]);
      expect(await app(other)).toContain(F["FA"]);
      expect((await call("rm1", "GET", `/risk-frameworks/applicable?riskId=${rk}`)).text).toContain(F["FB"]);
      const e = await call("rm1", "POST", "/risk-evaluations", { riskId: rk, evaluationType: "AD_HOC", subCategoryId: F["CAT"] });
      expect(e.status, e.text).toBe(201);
      expect(e.json!["data"].riskFrameworkVersionId).toBe(F["vB"]);
    });

    it("C3 moving a risk to another process: audit keeps the Dispositif before / after; no row when the process does not change; atomic", async () => {
      const pA = await proc();
      const pB = await proc();
      await attach(pB, F["FB"]);
      const rk = await risk(pA);
      const moves = async () => (await sql(`SELECT * FROM audit_log WHERE entity_id = $1 AND entity_type = 'Risk' AND new_value ? 'frameworkChanged'`, [rk]));
      expect((await call("rm1", "PATCH", `/risks/${rk}`, { description: "sans changement de processus" })).status).toBe(200);
      expect((await call("rm1", "PATCH", `/risks/${rk}`, { processId: pA })).status).toBe(200);
      expect(await moves()).toHaveLength(0);
      const mv = await call("rm1", "PATCH", `/risks/${rk}`, { processId: pB });
      expect(mv.status, mv.text).toBe(200);
      let m = await moves();
      expect(m).toHaveLength(1);
      expect(m[0]!.old_value).toEqual({ processId: pA, riskFrameworkId: F["FA"] });
      expect(m[0]!.new_value).toEqual({ processId: pB, riskFrameworkId: F["FB"], frameworkChanged: true });
      const pC = await proc();
      const back = await call("rm1", "PATCH", `/risks/${rk}`, { processId: pC });
      expect(back.status, back.text).toBe(200);
      m = await moves();
      expect(m).toHaveLength(2);
      expect(m.find((x) => x.new_value.processId === pC)!.new_value).toEqual({ processId: pC, riskFrameworkId: F["FA"], frameworkChanged: true });
      // same Dispositif on both sides -> logged with frameworkChanged false
      const pD = await proc();
      expect((await call("rm1", "PATCH", `/risks/${rk}`, { processId: pD })).status).toBe(200);
      m = await moves();
      expect(m.find((x) => x.new_value.processId === pD)!.new_value).toEqual({ processId: pD, riskFrameworkId: F["FA"], frameworkChanged: false });
      // atomicity: audit failure on that row => the process is NOT changed
      try {
        await failAudit("Risk", "UPDATE", "frameworkChanged");
        const pE = await proc();
        const bad = await call("rm1", "PATCH", `/risks/${rk}`, { processId: pE });
        expect(bad.status, bad.text).toBeGreaterThanOrEqual(400);
        expect((await one(`SELECT process_id FROM risks WHERE id = $1`, [rk])).process_id).toBe(pD);
      } finally { await failAudit(null); }
    });
  });

  // ------------------------------------------------------------------------------------------------ E
  describe("E edges around the attachment", () => {
    it("E1 two Risk Managers only (requester + one decider): decided NORMAL by the other; Audit group and audit.read are told (q34)", async () => {
      const p = await proc("PROCESS", null, TB);
      const r = await call("rmb", "POST", `/risk-frameworks/${F["FB_B"]}/process-assignments`, { processId: p, reason: "Deux RM seulement" });
      expect(r.status, r.text).toBe(201);
      const d = await decide("rmb2", r.json!["data"].id, "approve");
      expect(d.status, d.text).toBe(200);
      expect(await reqRow(r.json!["data"].id)).toMatchObject({ status: "APPROVED", decision_regime: "NORMAL", ratification_status: null, fallback_cause: null });
      const { rid } = await pending();
      expect((await decide("rm2", rid, "approve")).status).toBe(200);
      const n = await sql(`SELECT recipient_user_id FROM notifications WHERE event_type = 'RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE' AND resource_id = $1`, [rid]);
      expect(n.map((x) => x.recipient_user_id)).toContain(uid["aud"]);
    });

    it("E2 the attachment cannot be written by a process PATCH / POST body (mass assignment)", async () => {
      const p = await proc();
      const patch = await call("pu", "PATCH", `/processes/${p}`, { riskFrameworkId: F["FB"], risk_framework_id: F["FB"], name: "renomme QA" });
      expect(patch.status, patch.text).toBe(200);
      expect(await attached(p)).toBeNull();
      const post = await call("pu", "POST", "/processes", { level: "PROCESS", name: "Cree QA", departmentId: "aaaaaaaa-0000-4000-8000-000000000201", riskFrameworkId: F["FB"] });
      expect(post.status, post.text).toBe(201);
      expect(await attached(post.json!["data"].id)).toBeNull();
    });

    it("QA-B6C-01 E3 an ATTACHED process cannot be turned into a sub-process through PATCH /processes (clean 4xx, attachment kept)", async () => {
      const p = await proc();
      const parent = await proc();
      await attach(p, F["FB"]);
      const r = await call("pu", "PATCH", `/processes/${p}`, { level: "SUBPROCESS", parentId: parent });
      // state first: whatever the answer, nothing is half-written
      expect(await attached(p)).toBe(F["FB"]);
      expect((await one(`SELECT level FROM processes WHERE id = $1`, [p])).level).toBe("PROCESS");
      expect(r.status, r.text).not.toBe(403);
      expect(r.status, r.text).toBeGreaterThanOrEqual(400);
      expect(r.status, r.text).toBeLessThan(500);
    });

    it.fails("KNOWN GAP QA-B6C-02 E4 re-parenting a sub-process under a PROCESS attached elsewhere moves its Dispositif: the audit must say so", async () => {
      const pFB = await proc();
      await attach(pFB, F["FB"]);
      const pDefault = await proc();
      const sub = await proc("SUBPROCESS", pDefault);
      const app = (id: string) => call("rm1", "GET", `/risk-frameworks/applicable?processId=${id}`).then((r) => r.text);
      expect(await app(sub)).toContain(F["FA"]);
      const r = await call("pu", "PATCH", `/processes/${sub}`, { parentId: pFB });
      expect(r.status, r.text).toBe(200);
      expect(await app(sub)).toContain(F["FB"]); // the Dispositif of the sub-process (and of its risks) changed with no request, no approval
      const a = await audits(sub, "Process");
      const mentionsFramework = a.some((x) => JSON.stringify([x.old_value, x.new_value]).match(/ramework/i));
      expect(mentionsFramework, JSON.stringify(a.map((x) => [x.action, x.old_value, x.new_value]))).toBe(true);
    });

    it("E5 the list of change requests shows the assignment with its process and framework", async () => {
      const { p, rid } = await pending();
      const l = await call("rm3", "GET", "/risk-frameworks/change-requests?status=PENDING");
      expect(l.status, l.text).toBe(200);
      const row = (l.json!["data"] as Row[]).find((x) => x.id === rid);
      expect(row).toMatchObject({ kind: "ASSIGN_PROCESS", processId: p, frameworkId: F["FB"], status: "PENDING" });
    });
  });

  // ------------------------------------------------------------------------------------------------ D
  describe("D I-C1 on a real PostgreSQL: each version is compared to its OWN scale only", () => {
    const params = (o: Row = {}) => ({ committeeEvaluationMinScore: 21, committeeEvaluationEnforced: true, committeeTreatmentMinScore: null, appetiteThresholds: [], lowCriticalityThreshold: 3, ...o });
    const create = (name: string, scaleId: string, p: Row) => call("rm1", "POST", "/risk-frameworks", { name, ratingScaleId: scaleId, params: p });
    async function activate(name: string, scaleId: string, p: Row) {
      const c = await create(name, scaleId, p);
      if (c.status !== 201) return { step: "create", res: c };
      const fwId = c.json!["data"].framework?.id ?? c.json!["data"].id;
      const vId = c.json!["data"].version?.id ?? c.json!["data"].versions?.[0]?.id;
      const rq = await call("rm1", "POST", `/risk-frameworks/${fwId}/versions/${vId}/activation-requests`, { reason: "Activation QA" });
      if (rq.status !== 201) return { step: "request", res: rq };
      return { step: "approve", res: await decide("rm2", rq.json!["data"].id, "approve", "ok"), fwId, vId };
    }

    it("D1 a 6x6 Dispositif with Committee threshold 21 activates while the 3x3 and 5x5 scales stay ACTIVE", async () => {
      const a = await activate("Dispositif 6x6", F["S6"]!, params());
      expect(a.step, JSON.stringify(a.res.json ?? a.res.text)).toBe("approve");
      expect(a.res.status, a.res.text).toBe(200);
      expect((await sql(`SELECT status FROM risk_framework_versions WHERE id = $1`, [a.vId])).map((x) => x.status)).toEqual(["ACTIVE"]);
      const st = await sql(`SELECT id, status FROM rating_scales WHERE id = ANY($1)`, [[F["S3"], F["S5"], F["S6"]]]);
      expect(Object.fromEntries(st.map((x) => [x.id, x.status]))).toEqual({ [F["S3"]!]: "ACTIVE", [F["S5"]!]: "ACTIVE", [F["S6"]!]: "ACTIVE" });
    });

    it("D2 a threshold above the ceiling of ITS OWN scale is still refused, all offenders named", async () => {
      const c = await create("Dispositif 3x3 trop haut", F["S3b"]!, params({ committeeEvaluationMinScore: 10, committeeTreatmentMinScore: 12, lowCriticalityThreshold: 3 }));
      const fwId = c.json?.["data"]?.framework?.id ?? c.json?.["data"]?.id;
      if (c.status === 201) {
        const vId = c.json!["data"].version?.id ?? c.json!["data"].versions?.[0]?.id;
        const rq = await call("rm1", "POST", `/risk-frameworks/${fwId}/versions/${vId}/activation-requests`, { reason: "Activation QA" });
        expect(rq.status, rq.text).toBe(400);
        expect(rq.text).toMatch(/10/);
        expect(rq.text).toMatch(/12/);
      } else {
        expect(c.status, c.text).toBe(400);
        expect(c.text).toMatch(/10/);
      }
    });

    it("D3 a threshold of 15 is refused on the 3x3 scale (ceiling 9) but accepted on the 5x5 (ceiling 25) although 3x3 stays ACTIVE", async () => {
      const bad = await activate("Dispositif 3x3 seuil 15", F["S3b"]!, params({ committeeEvaluationMinScore: 15 }));
      expect(bad.res.status, bad.res.text).toBeGreaterThanOrEqual(400);
      const ok = await activate("Dispositif 5x5 seuil 15", F["S5b"]!, params({ committeeEvaluationMinScore: 15 }));
      expect(ok.step, JSON.stringify(ok.res.json ?? ok.res.text)).toBe("approve");
      expect(ok.res.status, ok.res.text).toBe(200);
    });
  });
});
