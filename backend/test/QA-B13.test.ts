import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { DEFAULT_FRAMEWORK_TEMPLATES } from "../src/domain/defaultFrameworks.js";
import { contractDefaultViolations } from "../src/domain/frameworkApproval.js";

/**
 * QA-B13 (niveau 2) : lot B-13, Dispositifs par defaut Tranche (4x4) / Standard (5x5) / Renforce (6x6), SET_DEFAULT, archivage, migration 091
 * (DECISION-124, DECISION-127). Oracles ecrits AVANT l'execution. Ce n'est pas un avis Security / Privacy / Compliance.
 *
 * A  VALEURS (statique) : chaque libelle des modeles figure MOT POUR MOT dans le document A13 (copie dans test/fixtures) ; aucun « Leger » / « Prudent » ;
 *    parametres, bandes, tailles, nombre d'axes = tableaux du document (sections 4, 5.2, 12.3, 12.4) ; aucune valeur inventee (appetite vide).
 * B  PROVISIONNEMENT POST /risk-frameworks/defaults : 201, 3 brouillons (aucun ACTIVE, aucun defaut), valeurs en base = document ; idempotent par nom (insensible
 *    a la casse, un archive n'occupe pas le nom) ; 403 sans droit (compte simple, Audit, droits directs hors groupe), 401 ; corps non vide 400 ; isolation des tenants ;
 *    audit ; compatibilite amorçage (contractDefaultViolations sur les valeurs LUES en base) : Standard et Tranche [], Renforce 3 ecarts.
 *    B-int provisionnement INTERROMPU (panne d'audit au 2e modele) : mesurer l'echelle DRAFT orpheline et la reprise.
 * C  CIRCUIT : activation de Standard en premier => defaut ; SET_DEFAULT : maker-checker, effet au cycle suivant (evaluation E1 gardee, E2 nouvelle), audit des
 *    deux Dispositifs, refus / retrait / rejeu / concurrence ; un seul defaut a tout moment.
 * D  ARCHIVAGE : motif obligatoire ; refus si defaut, processus vivant rattache, demande en attente ; versions archivees avec ; evaluation existante lisible ;
 *    concurrence archivage // rattachement et archivage // SET_DEFAULT.
 * E  MIGRATION 091 : gardes directs en base (42501), up / down / up sur base jetable, down = fonctions de 090.
 */
const ROOT = join(__dirname, "..", "..");
const live = process.env["QA_B13_LIVE"] === "1";
const PGPORT = 55442;
const DB = "grc_qa_b13";
const PORT = 8095;
const API = `http://127.0.0.1:${PORT}/api/v1`;
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const TB = "bbbbbbbb-0000-4000-8000-000000000001";
const UNKNOWN = "cccccccc-0000-4000-8000-0000000009ff";
const DOC = readFileSync(join(__dirname, "fixtures", "A13-dispositifs-par-defaut-B13-2026-11-11.md"), "utf8");

// ------------------------------------------------------------------------------------------------ A (statique)
describe("A valeurs des modeles = document A13 (statique)", () => {
  const byName = (n: string) => DEFAULT_FRAMEWORK_TEMPLATES.find((t) => t.name === n)!;
  const strings = (o: unknown): string[] => (typeof o === "string" ? [o] : Array.isArray(o) ? o.flatMap(strings) : o && typeof o === "object" ? Object.values(o).flatMap(strings) : []);

  it("A1 exactement trois modeles : Tranché, Standard, Renforcé (dans cet ordre) ; aucun « Léger » ni « Prudent » nulle part dans les modeles", () => {
    expect(DEFAULT_FRAMEWORK_TEMPLATES.map((t) => t.name)).toEqual(["Tranché", "Standard", "Renforcé"]);
    const all = strings(DEFAULT_FRAMEWORK_TEMPLATES).join("\n");
    expect(all).not.toMatch(/\bL[ée]ger\b/);
    expect(all).not.toMatch(/\bPrudent\b/);
  });

  it("A2 chaque libelle / descriptif / description des modeles figure mot pour mot dans le document (aucune valeur inventee)", () => {
    const missing: string[] = [];
    for (const t of DEFAULT_FRAMEWORK_TEMPLATES) {
      const own = [t.description, ...strings(t.scale.probabilityLabels), ...strings(t.scale.impactLabels), ...strings(t.scale.axes), ...strings(t.scale.velocity), ...strings(t.scale.persistence),
        ...strings(t.scale.mastery.levels), ...t.scale.mastery.defenseLines, ...t.scale.thresholds.map((b) => b.label)];
      for (const s of own) {
        if (/^[A-Z_]+$/.test(s) || /^[a-zA-ZéÉèêôûîçÉ ]+$/.test(s) && s.length < 4) continue; // codes d'axe
        if (!DOC.includes(s)) missing.push(`${t.name}: ${s}`);
      }
    }
    // les libelles d'axe « Financier », « Réglementaire »... sont des intitules d'affichage des codes du document
    const nonAxis = missing.filter((m) => !/: (Financier|Réglementaire|Opérationnel|Client|Réputation|Données|Humain)$/.test(m));
    expect(nonAxis).toEqual([]);
  });

  it("A3 parametres de la version = section 4 (+ 12.2 variante 2 pour Tranché)", () => {
    expect(byName("Tranché").params).toEqual({ committeeEvaluationMinScore: 9, committeeTreatmentMinScore: 9, lowCriticalityThreshold: 3, riskOwnerExecutorCumulAllowed: true, delegateExecutorCumulAllowed: true, delegationMaxDays: 90 });
    expect(byName("Standard").params).toEqual({ committeeEvaluationMinScore: 15, committeeTreatmentMinScore: 15, lowCriticalityThreshold: 4, riskOwnerExecutorCumulAllowed: true, delegateExecutorCumulAllowed: true, delegationMaxDays: 90 });
    expect(byName("Renforcé").params).toEqual({ committeeEvaluationMinScore: 15, committeeTreatmentMinScore: 9, lowCriticalityThreshold: 3, riskOwnerExecutorCumulAllowed: false, delegateExecutorCumulAllowed: false, delegationMaxDays: 30 });
  });

  it("A4 echelles : taille, bandes (section 5.2), nombre d'axes et de niveaux par axe, vitesse / persistance / maitrise (5.1)", () => {
    const bands = (n: string) => byName(n).scale.thresholds.map((b) => [b.label, b.min, b.max]);
    expect(bands("Tranché")).toEqual([["Faible", 1, 3], ["Moyen", 4, 6], ["Élevé", 7, 8], ["Critique", 9, 16]]);
    expect(bands("Standard")).toEqual([["Faible", 1, 4], ["Moyen", 5, 9], ["Élevé", 10, 14], ["Critique", 15, 25]]);
    expect(bands("Renforcé")).toEqual([["Faible", 1, 3], ["Moyen", 4, 8], ["Élevé", 9, 14], ["Critique", 15, 36]]);
    for (const [n, size, axes] of [["Tranché", 4, 5], ["Standard", 5, 5], ["Renforcé", 6, 7]] as const) {
      const s = byName(n).scale;
      expect(s.size, n).toBe(size);
      expect(s.probabilityLabels, n).toHaveLength(size);
      expect(s.impactLabels, n).toHaveLength(size);
      expect(s.axes, n).toHaveLength(axes);
      for (const a of s.axes) expect(a.levelLabels, `${n} ${a.code}`).toHaveLength(size);
      expect(s.axes.map((a) => a.code).slice(0, 5), n).toEqual(["FINANCIER", "REGLEMENTAIRE", "OPERATIONNEL", "CLIENT", "REPUTATION"]);
      expect(s.velocity.map((x) => x.label), n).toEqual(["Lente", "Moyenne", "Rapide"]);
      expect(s.persistence.map((x) => x.label), n).toEqual(["Ponctuelle", "Récurrente", "Durable"]);
      expect(s.mastery.defenseLines, n).toEqual(["L1", "L2", "L3"]);
      // couverture continue de 1 a n x n, sans trou ni chevauchement
      const b = s.thresholds;
      expect(b[0]!.min).toBe(1);
      expect(b[b.length - 1]!.max).toBe(size * size);
      for (let i = 1; i < b.length; i++) expect(b[i]!.min, `${n} bande ${i}`).toBe(b[i - 1]!.max + 1);
    }
    expect(byName("Renforcé").scale.axes.slice(5).map((a) => a.code)).toEqual(["DONNEES", "HUMAIN"]);
  });

  it("A5 coherence du document : debut de « Critique » = seuil Comite d'evaluation ; haut de « Faible » = seuil bas ; Comite = floor(n²x15/25) sauf Renforcé", () => {
    for (const t of DEFAULT_FRAMEWORK_TEMPLATES) {
      const crit = t.scale.thresholds.find((b) => b.label === "Critique")!;
      const low = t.scale.thresholds.find((b) => b.label === "Faible")!;
      expect(crit.min, t.name).toBe(t.params.committeeEvaluationMinScore);
      expect(low.max, t.name).toBe(t.params.lowCriticalityThreshold);
    }
    expect(byName("Tranché").params.committeeEvaluationMinScore).toBe(Math.floor((16 * 15) / 25));
    expect(byName("Standard").params.committeeEvaluationMinScore).toBe(Math.floor((25 * 15) / 25));
  });

  it("A6 appetite : aucune entree inventee (la note le dit), le texte « valeur de depart » n'invente aucun seuil", () => {
    for (const t of DEFAULT_FRAMEWORK_TEMPLATES) expect(t.appetiteNote).toMatch(/non créée/);
  });

  it("A7 amorçage (spec 5.6 pt 2), valeurs du modele : Standard et Tranché sans ecart au contrat ; Renforcé refuse pour 3 raisons exactement", () => {
    const base = { defaultEvaluationMode: "CLASSIQUE", committeeEvaluationEnforced: true, changeApprover: "RISK_MANAGER", selfProposalAllowed: false, hybridPolicyEnabled: false,
      masteryAuthoritativeSource: "RISK_TEAM", committeeVoteRule: "DEFAULT", committeeVoteCustom: null } as const;
    for (const t of DEFAULT_FRAMEWORK_TEMPLATES) {
      const v = { ...base, committeeEvaluationMinScore: t.params.committeeEvaluationMinScore, riskOwnerExecutorCumulAllowed: t.params.riskOwnerExecutorCumulAllowed, delegateExecutorCumulAllowed: t.params.delegateExecutorCumulAllowed };
      const viol = contractDefaultViolations(v as never, t.scale.size);
      if (t.name === "Renforcé") expect(viol.sort((a, b) => a.localeCompare(b))).toEqual(["committeeEvaluationMinScore", "delegateExecutorCumulAllowed", "riskOwnerExecutorCumulAllowed"]);
      else expect(viol, t.name).toEqual([]);
    }
  });
});

// ------------------------------------------------------------------------------------------------ live
type Who = "rm1" | "rm2" | "rm3" | "rm4" | "plain" | "adm" | "aud" | "pu" | "rmb";
const WHO: Who[] = ["rm1", "rm2", "rm3", "rm4", "plain", "adm", "aud", "pu", "rmb"];
const TOK = {} as Record<Who, string>;
let pg: Pool;
const sh = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const sql = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows as Row[];
const one = async (q: string, p: unknown[] = []) => (await sql(q, p))[0]!;
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
let seq = 0;
const proc = async (tenant = T) => { seq += 1; return (await one(`INSERT INTO processes (tenant_id, level, name) VALUES ($1,'PROCESS',$2) RETURNING id`, [tenant, `QA B13 ${seq}`])).id as string; };
const attachedTo = async (p: string) => (await one(`SELECT risk_framework_id AS f FROM processes WHERE id = $1`, [p])).f as string | null;
const attach = async (id: string, fw: string) => {
  await sql(`ALTER TABLE processes DISABLE TRIGGER processes_framework_guard`);
  try { await sql(`UPDATE processes SET risk_framework_id = $2 WHERE id = $1`, [id, fw]); } finally { await sql(`ALTER TABLE processes ENABLE TRIGGER processes_framework_guard`); }
};
const fwList = async (who: Who = "rm1") => (await call(who, "GET", "/risk-frameworks")).json!["data"] as Row[];
const fwByName = async (name: string, tenant = T) => (await sql(`SELECT * FROM risk_frameworks WHERE tenant_id = $1 AND lower(name) = lower($2) AND archived_at IS NULL`, [tenant, name]))[0];
const verOf = async (fw: string) => (await sql(`SELECT * FROM risk_framework_versions WHERE framework_id = $1 ORDER BY version_number`, [fw]));
const decide = (who: Who, rid: string, what: "approve" | "reject" | "withdraw", text?: string) =>
  call(who, "POST", `/risk-frameworks/change-requests/${rid}/${what}`, what === "approve" ? (text ? { comment: text } : {}) : what === "reject" ? { comment: text ?? "Refus QA" } : { reason: text ?? "Retrait QA" });
const defaults = async (tenant = T) => (await sql(`SELECT id, name FROM risk_frameworks WHERE tenant_id = $1 AND is_default AND archived_at IS NULL`, [tenant]));
async function failAudit(entityType: string | null, action: string | null = null) {
  await sql(`DELETE FROM qa_fail_audit`);
  if (entityType) await sql(`INSERT INTO qa_fail_audit (entity_type, action, key) VALUES ($1,$2,NULL)`, [entityType, action]);
}
/** Activates a framework's version 1 through the ordinary circuit (rm1 asks, rm2 approves). */
async function activate(fw: string, asker: Who = "rm1", approver: Who = "rm2") {
  const v = (await verOf(fw))[0]!;
  const rq = await call(asker, "POST", `/risk-frameworks/${fw}/versions/${v.id}/activation-requests`, { reason: "Activation QA B13" });
  expect(rq.status, rq.text).toBe(201);
  const d = await decide(approver, rq.json!["data"].id, "approve", "ok");
  expect(d.status, d.text).toBe(200);
  return v.id as string;
}
const ask = (who: Who, fw: string, reason = "Defaut QA") => call(who, "POST", `/risk-frameworks/${fw}/default-requests`, { reason });
const NO_REASON = Symbol("no reason");
const archive = (who: Who, fw: string, reason: string | typeof NO_REASON = "Archivage QA") => call(who, "POST", `/risk-frameworks/${fw}/archive`, reason === NO_REASON ? {} : { reason });

describe.skipIf(!live)("QA-B13 sur le VRAI serveur + PostgreSQL 16 LOCAL (base vierge 001..091)", () => {
  beforeAll(async () => {
    sh("/bin/bash", [join(ROOT, "tests", "integration", "qa-visibility-v1-setup.sh"), "up", DB]);
    pg = new Pool({ host: "127.0.0.1", port: PGPORT, user: "postgres", database: DB, max: 6 });
    const RM = (await one(`SELECT id FROM roles WHERE tenant_id = $1 AND system_group = 'RISK_MANAGER'`, [T])).id as string;
    const AUD = (await one(`SELECT id FROM roles WHERE tenant_id = $1 AND system_group = 'AUDIT'`, [T])).id as string;
    const granter = (await one(`SELECT id FROM users WHERE email = 'adm@vv1.test'`)).id as string;
    const RMPERMS = ["riskframework.read", "riskframework.create", "riskframework.update", "riskframework.activate", "riskframework.archive", "riskframework.process.assign", "risk.read", "process.read"];
    const mk = async (tenant: string, n: string, perms: string[]) => {
      uid[n] = (await one(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1,$2,$2,$3) RETURNING id`, [tenant, `${n}@b6c.test`, perms])).id as string;
    };
    for (const n of ["rm1", "rm2", "rm3", "rm4"]) {
      await mk(T, n, []);
      await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [T, RM, uid[n], granter]);
    }
    await mk(T, "plain", ["risk.read", "process.read", "riskframework.read"]);
    await mk(T, "adm", RMPERMS); // droits directs, hors groupe Risk Manager
    await mk(T, "aud", []);
    await mk(T, "pu", ["process.read", "process.update", "process.create", "department.read", "riskframework.read"]);
    await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [T, AUD, uid["aud"], granter]);
    await sql(`INSERT INTO tenants (id, name) VALUES ($1,'Tenant B QA B13')`, [TB]);
    const roleB = (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1,'Risk Manager B',$2,'RISK_MANAGER') RETURNING id`, [TB, RMPERMS])).id as string;
    await mk(TB, "rmb", []);
    await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$3)`, [TB, roleB, uid["rmb"]]);
    await sql(`CREATE TABLE qa_fail_audit (entity_type text, action text, key text)`);
    await sql(`CREATE FUNCTION qa_fail_audit_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $f$
      BEGIN IF EXISTS (SELECT 1 FROM qa_fail_audit f WHERE f.entity_type = NEW.entity_type AND (f.action IS NULL OR f.action = NEW.action))
      THEN RAISE EXCEPTION 'QA: audit failure injected'; END IF; RETURN NEW; END $f$`);
    await sql(`CREATE TRIGGER qa_fail_audit_trg BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_audit_fn()`);
    sh("/bin/bash", [join(ROOT, "tests", "integration", "qa-b6c-server.sh"), "start"], { QA_PORT: String(PORT), QA_DB: DB });
    for (const w of WHO) {
      const r = await fetch(`${API}/auth/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${w}@b6c.test`, password: "whatever" }) });
      TOK[w] = ((await r.json()) as { accessToken: string }).accessToken;
      expect(TOK[w], w).toBeTruthy();
    }
  }, 280000);
  afterAll(async () => {
    await pg?.end();
    sh("/bin/bash", [join(ROOT, "tests", "integration", "qa-b6c-server.sh"), "stop"]);
  });

  const count = async (q: string, p: unknown[] = []) => Number((await one(q, p)).n);
  const scalesNamed = (name: string, tenant = T) => count(`SELECT count(*)::int n FROM rating_scales WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`, [tenant, name]);

  // ------------------------------------------------------------------------------------------------ B0 provisionnement interrompu
  describe("B-int provisionnement interrompu (SEC-B13-02 / QA-B13-01 corriges : une transaction par modele)", () => {
    const orphanScales = () => count(`SELECT count(*)::int n FROM rating_scales s WHERE s.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM risk_framework_versions v WHERE v.rating_scale_id = s.id)`, [T]);

    it("B-int1 panne d'audit a la creation du Dispositif : 5xx, ni Dispositif ni defaut, AUCUNE echelle orpheline", async () => {
      expect(await count(`SELECT count(*)::int n FROM risk_frameworks WHERE tenant_id = $1`, [T])).toBe(0);
      await failAudit("RiskFramework", "CREATE");
      let r: Res;
      try { r = await call("rm1", "POST", "/risk-frameworks/defaults", {}); } finally { await failAudit(null); }
      expect(r.status, r.text).toBeGreaterThanOrEqual(500);
      expect(await count(`SELECT count(*)::int n FROM risk_frameworks WHERE tenant_id = $1`, [T])).toBe(0);
      expect(await scalesNamed("Tranché (4x4)")).toBe(0);
      expect(await orphanScales()).toBe(0);
    });

    it("B-int2 panne d'audit sur l'echelle elle-meme : 5xx, rien d'ecrit", async () => {
      await failAudit("RatingScale", "CREATE");
      let r: Res;
      try { r = await call("rm1", "POST", "/risk-frameworks/defaults", {}); } finally { await failAudit(null); }
      expect(r.status, r.text).toBeGreaterThanOrEqual(500);
      expect(await scalesNamed("Tranché (4x4)")).toBe(0);
      expect(await orphanScales()).toBe(0);
    });

    it("B-int4 panne au 2e modele (echelle « Standard (5x5) » refusee par trigger) : Tranché reste cree ENTIER (Dispositif + echelle + version), Standard absent, aucune orpheline", async () => {
      await sql(`CREATE FUNCTION qa_fail_scale_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $f$ BEGIN IF NEW.name = 'Standard (5x5)' THEN RAISE EXCEPTION 'QA: scale refused'; END IF; RETURN NEW; END $f$`);
      await sql(`CREATE TRIGGER qa_fail_scale_trg BEFORE INSERT ON rating_scales FOR EACH ROW EXECUTE FUNCTION qa_fail_scale_fn()`);
      let r: Res;
      try { r = await call("rm1", "POST", "/risk-frameworks/defaults", {}); } finally { await sql(`DROP TRIGGER qa_fail_scale_trg ON rating_scales`); await sql(`DROP FUNCTION qa_fail_scale_fn()`); }
      expect(r.status, r.text).toBeGreaterThanOrEqual(500);
      const tr = (await fwByName("Tranché"))!;
      expect(tr, "le premier modele, deja commite, reste").toBeTruthy();
      const v = (await verOf(tr.id))[0]!;
      const sc = await one(`SELECT status, criticality_thresholds, impact_axes, velocity_levels, mastery_scale FROM rating_scales WHERE id = $1`, [v.rating_scale_id]);
      expect(sc.status).toBe("DRAFT");
      expect(sc.criticality_thresholds).toHaveLength(4);
      expect((sc.impact_axes as Row).axes).toHaveLength(5);
      expect(sc.velocity_levels).toHaveLength(3);
      expect(sc.mastery_scale).toBeTruthy();
      expect(await fwByName("Standard")).toBeUndefined();
      expect(await fwByName("Renforcé")).toBeUndefined();
      expect(await scalesNamed("Standard (5x5)")).toBe(0);
      expect(await orphanScales()).toBe(0);
    });

    it("B-int3 reprise apres B-int4 : la relance cree les deux modeles manquants et saute Tranché, exactement une echelle par modele, aucune orpheline", async () => {
      const r = await call("rm1", "POST", "/risk-frameworks/defaults", {});
      expect(r.status, r.text).toBe(201);
      expect(r.json!["data"]).toEqual({ created: ["Standard", "Renforcé"], skipped: ["Tranché"] });
      expect(await scalesNamed("Tranché (4x4)")).toBe(1);
      expect(await scalesNamed("Standard (5x5)")).toBe(1);
      expect(await scalesNamed("Renforcé (6x6)")).toBe(1);
      expect(await orphanScales()).toBe(0);
      for (const n of ["Tranché", "Standard", "Renforcé"]) {
        const f = (await fwByName(n))!;
        const v = (await verOf(f.id))[0]!;
        const sc = await one(`SELECT name, status FROM rating_scales WHERE id = $1`, [v.rating_scale_id]);
        expect(sc.status).toBe("DRAFT");
        expect(sc.name.startsWith(n)).toBe(true);
      }
    });
  });

  // ------------------------------------------------------------------------------------------------ B provisionnement
  describe("B provisionnement POST /risk-frameworks/defaults", () => {
    it("B1 etat apres provisionnement : 3 brouillons, aucune version ACTIVE, aucun defaut, 3 echelles DRAFT, valeurs de la base = document", async () => {
      expect((await defaults()).length).toBe(0);
      expect(await count(`SELECT count(*)::int n FROM risk_framework_versions WHERE tenant_id = $1 AND status = 'ACTIVE'`, [T])).toBe(0);
      const expected: Record<string, Row> = {
        "Tranché": { size: 4, cm: 9, ct: 9, low: 3, ro: true, de: true, days: 90, axes: 5, thr: [[1, 3], [4, 6], [7, 8], [9, 16]] },
        "Standard": { size: 5, cm: 15, ct: 15, low: 4, ro: true, de: true, days: 90, axes: 5, thr: [[1, 4], [5, 9], [10, 14], [15, 25]] },
        "Renforcé": { size: 6, cm: 15, ct: 9, low: 3, ro: false, de: false, days: 30, axes: 7, thr: [[1, 3], [4, 8], [9, 14], [15, 36]] },
      };
      for (const [n, e] of Object.entries(expected)) {
        const f = (await fwByName(n))!;
        expect(f.is_default, n).toBe(false);
        const vs = await verOf(f.id);
        expect(vs, n).toHaveLength(1);
        const v = vs[0]!;
        expect(v).toMatchObject({ status: "DRAFT", default_evaluation_mode: "CLASSIQUE", committee_evaluation_min_score: e.cm, committee_evaluation_enforced: true, committee_treatment_min_score: e.ct,
          low_criticality_threshold: e.low, change_approver: "RISK_MANAGER", self_proposal_allowed: false, risk_owner_executor_cumul_allowed: e.ro, delegate_executor_cumul_allowed: e.de,
          delegation_max_days: e.days, hybrid_policy_enabled: false, mastery_authoritative_source: "RISK_TEAM", committee_vote_rule: "DEFAULT", committee_vote_custom: null });
        expect(v.appetite_thresholds, `${n}: aucune appetence inventee`).toEqual([]);
        const sc = await one(`SELECT * FROM rating_scales WHERE id = $1`, [v.rating_scale_id]);
        expect(sc).toMatchObject({ status: "DRAFT", probability_levels: e.size, impact_levels: e.size });
        expect((sc.criticality_thresholds as Row[]).map((b) => [b.min, b.max]), n).toEqual(e.thr);
        expect((sc.impact_axes as Row).axes, n).toHaveLength(e.axes);
        expect((sc.impact_axes as Row).retainedImpactRule, n).toBe("MAX");
        expect(sc.probability_labels, n).toHaveLength(e.size);
        expect(sc.velocity_levels, n).toHaveLength(3);
        expect(sc.persistence_levels, n).toHaveLength(3);
        expect((sc.mastery_scale as Row).aggregation, n).toBe("MIN");
        expect((sc.mastery_scale as Row).defenseLines, n).toEqual(["L1", "L2", "L3"]);
        // every label stored is in the document
        for (const s of JSON.stringify([sc.probability_labels, sc.impact_labels, sc.impact_axes, sc.velocity_levels, sc.persistence_levels]).match(/"label":"([^"]+)"/g) ?? []) {
          const label = s.slice(9, -1);
          if (!["Financier", "Réglementaire", "Opérationnel", "Client", "Réputation", "Données", "Humain"].includes(label)) expect(DOC.includes(label.replace(/\\"/g, '"')), `${n}: ${label}`).toBe(true);
        }
      }
      const names = (await fwList()).map((f) => f.name).sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(["Renforcé", "Standard", "Tranché"]);
      expect(names.join(" ")).not.toMatch(/Léger|Prudent/);
    });

    it("B2 amorçage : sur les valeurs LUES en base, Standard et Tranché sont compatibles (aucun ecart), Renforcé non (3 ecarts)", async () => {
      for (const n of ["Tranché", "Standard", "Renforcé"]) {
        const f = (await fwByName(n))!;
        const v = (await verOf(f.id))[0]!;
        const size = (await one(`SELECT impact_levels FROM rating_scales WHERE id = $1`, [v.rating_scale_id])).impact_levels as number;
        const viol = contractDefaultViolations({
          defaultEvaluationMode: v.default_evaluation_mode, committeeEvaluationMinScore: v.committee_evaluation_min_score, committeeEvaluationEnforced: v.committee_evaluation_enforced,
          changeApprover: v.change_approver, selfProposalAllowed: v.self_proposal_allowed, riskOwnerExecutorCumulAllowed: v.risk_owner_executor_cumul_allowed,
          delegateExecutorCumulAllowed: v.delegate_executor_cumul_allowed, hybridPolicyEnabled: v.hybrid_policy_enabled, masteryAuthoritativeSource: v.mastery_authoritative_source,
          committeeVoteRule: v.committee_vote_rule, committeeVoteCustom: v.committee_vote_custom,
        } as never, size);
        if (n === "Renforcé") expect(viol.sort((a, b) => a.localeCompare(b))).toEqual(["committeeEvaluationMinScore", "delegateExecutorCumulAllowed", "riskOwnerExecutorCumulAllowed"]);
        else expect(viol, n).toEqual([]);
      }
    });

    it("B3 idempotent : relance = rien cree, 3 sautes, aucun doublon ; audit des creations present (Dispositif + echelle)", async () => {
      const before = { f: await count(`SELECT count(*)::int n FROM risk_frameworks WHERE tenant_id = $1`, [T]), s: await count(`SELECT count(*)::int n FROM rating_scales WHERE tenant_id = $1`, [T]) };
      const r = await call("rm1", "POST", "/risk-frameworks/defaults", {});
      expect(r.status, r.text).toBe(201);
      expect(r.json!["data"]).toEqual({ created: [], skipped: ["Tranché", "Standard", "Renforcé"] });
      expect(await count(`SELECT count(*)::int n FROM risk_frameworks WHERE tenant_id = $1`, [T])).toBe(before.f);
      expect(await count(`SELECT count(*)::int n FROM rating_scales WHERE tenant_id = $1`, [T])).toBe(before.s);
      const f = (await fwByName("Standard"))!;
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1 AND entity_type = 'RiskFramework' AND action = 'CREATE'`, [f.id])).toBe(1);
      const v = (await verOf(f.id))[0]!;
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1 AND entity_type = 'RatingScale'`, [v.rating_scale_id])).toBe(1); // one CREATE: the scale is born complete, in the transaction of its Dispositif
      // concurrent relaunch from two Risk Managers: documented race (check-then-create by name, no unique index)
      const rs = await Promise.all([call("rm1", "POST", "/risk-frameworks/defaults", {}), call("rm2", "POST", "/risk-frameworks/defaults", {})]);
      for (const x of rs) expect(x.status, x.text).toBeLessThan(500);
      expect(await count(`SELECT count(*)::int n FROM risk_frameworks WHERE tenant_id = $1`, [T])).toBe(before.f);
    });

    it("B4 droits : compte simple, Audit, droits directs hors groupe RM : 403 ; sans jeton 401 ; corps non vide ou champ en trop 400 ; rien cree", async () => {
      const before = await count(`SELECT count(*)::int n FROM risk_frameworks`);
      for (const who of ["plain", "aud", "adm", "pu"] as Who[]) {
        const r = await call(who, "POST", "/risk-frameworks/defaults", {});
        expect(r.status, `${who}: ${r.text}`).toBe(403);
      }
      expect((await call(null, "POST", "/risk-frameworks/defaults", {})).status).toBe(401);
      for (const body of [{ name: "x" }, { tenantId: TB }, { createdBy: uid["rm2"] }, []] as unknown[]) {
        const r = await call("rm1", "POST", "/risk-frameworks/defaults", body);
        expect(r.status, JSON.stringify(body) + r.text).toBe(400);
      }
      expect(await count(`SELECT count(*)::int n FROM risk_frameworks`)).toBe(before);
      expect((await call("rm1", "GET", "/risk-frameworks/defaults")).status).not.toBe(200); // pas de GET
    });

    it("B5 tenants : le provisionnement de B cree SES trois Dispositifs et ne touche pas ceux de T ; nom pris (casse differente) = saute ; un archive n'occupe pas le nom", async () => {
      const t = await count(`SELECT count(*)::int n FROM risk_frameworks WHERE tenant_id = $1`, [T]);
      const mkB = await one(`INSERT INTO risk_frameworks (tenant_id, name, created_by) VALUES ($1,'sTaNdArD',$2) RETURNING id`, [TB, uid["rmb"]]);
      const r = await call("rmb", "POST", "/risk-frameworks/defaults", {});
      expect(r.status, r.text).toBe(201);
      expect(r.json!["data"]).toEqual({ created: ["Tranché", "Renforcé"], skipped: ["Standard"] });
      expect(await count(`SELECT count(*)::int n FROM risk_frameworks WHERE tenant_id = $1`, [T])).toBe(t);
      expect(await count(`SELECT count(*)::int n FROM risk_frameworks WHERE tenant_id = $1`, [TB])).toBe(3);
      expect(mkB.id).toBeTruthy();
      // archive Tranché of B then relaunch: it is created again (new Dispositif, old one stays archived)
      const tr = (await fwByName("Tranché", TB))!;
      const a = await archive("rmb", tr.id, "Archive pour le test");
      expect(a.status, a.text).toBe(200);
      const r2 = await call("rmb", "POST", "/risk-frameworks/defaults", {});
      expect(r2.json!["data"]).toEqual({ created: ["Tranché"], skipped: ["Standard", "Renforcé"] });
      expect(await count(`SELECT count(*)::int n FROM risk_frameworks WHERE tenant_id = $1 AND name = 'Tranché'`, [TB])).toBe(2);
    });
  });

  // ------------------------------------------------------------------------------------------------ C circuit et SET_DEFAULT
  describe("C activation, SET_DEFAULT, effet au cycle suivant", () => {
    const F: Record<string, string> = {};
    let CAT = "";
    beforeAll(async () => {
      for (const n of ["Tranché", "Standard", "Renforcé"]) F[n] = (await fwByName(n))!.id as string;
      CAT = (await one(`INSERT INTO risk_categories (tenant_id, name) VALUES ($1,'Racine B13') RETURNING id`, [T])).id as string;
      CAT = (await one(`INSERT INTO risk_categories (tenant_id, name, parent_id) VALUES ($1,'Sous-categorie B13',$2) RETURNING id`, [T, CAT])).id as string;
    });

    const impacts = (v: number) => ["FINANCIER", "REGLEMENTAIRE", "OPERATIONNEL", "CLIENT", "REPUTATION"].map((code) => ({ code, value: v }));
    it("C1 le PREMIER Dispositif active devient le defaut (Standard) ; activer ensuite Tranché et Renforcé ne change pas le defaut ; une seule ligne par defaut", async () => {
      const vS = await activate(F["Standard"]!);
      expect((await defaults()).map((d) => d.name)).toEqual(["Standard"]);
      expect((await one(`SELECT status FROM risk_framework_versions WHERE id = $1`, [vS])).status).toBe("ACTIVE");
      expect((await one(`SELECT status FROM rating_scales WHERE id = (SELECT rating_scale_id FROM risk_framework_versions WHERE id = $1)`, [vS])).status).toBe("ACTIVE");
      await activate(F["Tranché"]!);
      await activate(F["Renforcé"]!); // Renforcé passe par le circuit ordinaire (2 Risk Managers)
      expect((await defaults()).map((d) => d.name)).toEqual(["Standard"]);
      const list = await fwList();
      expect(list.filter((f) => f.isDefault).map((f) => f.name)).toEqual(["Standard"]);
      for (const f of list) expect(f.activeVersion, f.name).not.toBeNull();
    });

    it("C2 demande SET_DEFAULT : refus (reason / defaut deja / sans version active / droits / tenant), puis 201 PENDING sans effet", async () => {
      for (const [label, b] of [["absent", undefined], ["vide", ""], ["espaces", "   "], ["501", "x".repeat(501)]] as [string, string | undefined][]) {
        const r = await call("rm1", "POST", `/risk-frameworks/${F["Tranché"]}/default-requests`, b === undefined ? {} : { reason: b });
        expect(r.status, `${label}: ${r.text}`).toBe(400);
      }
      expect((await ask("rm1", F["Standard"]!)).status).toBe(400); // deja defaut
      const nv = await call("rm1", "POST", "/risk-frameworks", { name: "Sans version active", ratingScaleId: (await verOf(F["Standard"]!))[0]!.rating_scale_id, params: { committeeEvaluationMinScore: 15, committeeEvaluationEnforced: true, committeeTreatmentMinScore: null, appetiteThresholds: [], lowCriticalityThreshold: 4 } });
      expect(nv.status, nv.text).toBe(201);
      const nvId = (nv.json!["data"].framework?.id ?? nv.json!["data"].id) as string;
      const r0 = await ask("rm1", nvId);
      expect(r0.status, r0.text).toBe(400);
      for (const who of ["plain", "aud", "adm", "pu"] as Who[]) expect((await ask(who, F["Tranché"]!)).status, who).toBe(403);
      expect((await call(null, "POST", `/risk-frameworks/${F["Tranché"]}/default-requests`, { reason: "x" })).status).toBe(401);
      expect((await ask("rmb", F["Tranché"]!)).status).toBe(404);
      expect((await ask("rm1", UNKNOWN)).status).toBe(404);
      expect((await call("rm1", "POST", `/risk-frameworks/${F["Tranché"]}/default-requests`, { reason: "ok", requestedBy: uid["rm2"] })).status).toBe(400);
      const r = await ask("rm1", F["Tranché"]!, "Passer au 4x4");
      expect(r.status, r.text).toBe(201);
      expect(r.json!["data"]).toMatchObject({ kind: "SET_DEFAULT", status: "PENDING", frameworkId: F["Tranché"], requestedBy: uid["rm1"] });
      expect((await defaults()).map((d) => d.name)).toEqual(["Standard"]); // rien n'a change
      expect((await sql(`SELECT action FROM audit_log WHERE tenant_id = $1 AND entity_type = 'RiskFrameworkChangeRequest' AND entity_id = $2`, [T, r.json!["data"].id])).map((x) => x.action)).toEqual(["SUBMIT"]);
      // a second live request for the same Dispositif is refused
      expect((await ask("rm2", F["Tranché"]!)).status).toBe(409);
      await decide("rm1", r.json!["data"].id, "withdraw"); // clean up for the next tests
    });

    it("C3 decision : le demandeur ne decide pas (403), non RM 403, rejet sans commentaire 400, rejet = defaut inchange, retrait par un autre 403, rejeu 409", async () => {
      const r = await ask("rm1", F["Tranché"]!, "Passer au 4x4");
      const rid = r.json!["data"].id as string;
      expect((await decide("rm1", rid, "approve")).status).toBe(403);
      for (const who of ["plain", "aud", "adm"] as Who[]) expect((await decide(who, rid, "approve")).status, who).toBe(403);
      expect((await call("rm2", "POST", `/risk-frameworks/change-requests/${rid}/reject`, {})).status).toBe(400);
      expect((await decide("rm3", rid, "withdraw")).status).toBe(403);
      expect((await decide("rmb", rid, "approve")).status).toBe(404);
      expect((await decide("rm2", rid, "reject", "Pas maintenant")).status).toBe(200);
      expect((await defaults()).map((d) => d.name)).toEqual(["Standard"]);
      expect((await decide("rm3", rid, "approve")).status).toBe(409);
      expect((await decide("rm1", rid, "withdraw")).status).toBe(409);
      const r2 = await ask("rm1", F["Tranché"]!, "Deuxieme essai");
      expect(r2.status, r2.text).toBe(201); // nouvelle demande possible apres rejet
      expect((await decide("rm1", r2.json!["data"].id, "withdraw", "Je retire")).status).toBe(200);
      expect((await decide("rm2", r2.json!["data"].id, "approve")).status).toBe(409); // approve apres retrait
    });

    it("C4 atomicite : panne d'audit a l'approbation (RiskFramework UPDATE puis APPROVE) => 5xx, defaut inchange, demande PENDING", async () => {
      for (const [et, ac] of [["RiskFramework", "UPDATE"], ["RiskFrameworkChangeRequest", "APPROVE"]] as const) {
        const r = await ask("rm1", F["Tranché"]!, `Panne ${et}`);
        const rid = r.json!["data"].id as string;
        await failAudit(et, ac);
        try {
          const d = await decide("rm2", rid, "approve");
          expect(d.status, d.text).toBeGreaterThanOrEqual(500);
        } finally { await failAudit(null); }
        expect((await defaults()).map((x) => x.name), et).toEqual(["Standard"]);
        expect((await one(`SELECT status FROM risk_framework_change_requests WHERE id = $1`, [rid])).status).toBe("PENDING");
        expect((await decide("rm1", rid, "withdraw")).status).toBe(200);
      }
    });

    it("C5 EFFET AU CYCLE SUIVANT : E1 creee avant garde Standard (version, echelle 5x5, seuil 15) ; apres approbation SET_DEFAULT l'evaluation E2 resout Tranché (4x4, seuil 9) ; E1 inchangee ; audit des DEUX Dispositifs", async () => {
      const p = await proc();
      const rk = (await one(`INSERT INTO risks (tenant_id, process, description, status, owner_id, process_id) VALUES ($1,'QA B13','QA B13','ACTIVE',$2,$3) RETURNING id`, [T, uid["rm1"], p])).id as string;
      const createEval = () => call("rm1", "POST", "/risk-evaluations", { riskId: rk, evaluationType: "AD_HOC", subCategoryId: CAT });
      const vStd = (await verOf(F["Standard"]!))[0]!;
      const vTr = (await verOf(F["Tranché"]!))[0]!;
      const e1 = await createEval();
      expect(e1.status, e1.text).toBe(201);
      const E1 = e1.json!["data"];
      expect(E1).toMatchObject({ riskFrameworkVersionId: vStd.id, ratingScaleId: vStd.rating_scale_id, committeeEvaluationMinScore: 15 });

      const r = await ask("rm1", F["Tranché"]!, "Le 4x4 devient le defaut");
      expect(r.status, r.text).toBe(201);
      const rid = r.json!["data"].id as string;
      // pending : still Standard
      expect((await call("rm1", "GET", `/risk-frameworks/applicable?processId=${p}`)).text).toContain(F["Standard"]);
      const d = await decide("rm2", rid, "approve", "D'accord");
      expect(d.status, d.text).toBe(200);
      const now = await defaults();
      expect(now.map((x) => x.name)).toEqual(["Tranché"]); // exactement un defaut
      // E1 unchanged, still scored on 5x5
      expect((await call("rm1", "GET", `/risk-evaluations/${E1.id}`)).json!["data"]).toMatchObject({ riskFrameworkVersionId: vStd.id, ratingScaleId: vStd.rating_scale_id, committeeEvaluationMinScore: 15 });
      const pe = await call("rm1", "PATCH", `/risk-evaluations/${E1.id}/inherent`, { probability: 5, impacts: impacts(5) });
      expect(pe.status, pe.text).toBe(200);
      expect((await call("rm1", "GET", `/risk-frameworks/applicable?processId=${p}`)).text).toContain(F["Tranché"]);
      await sql(`UPDATE risk_evaluations SET status = 'VALIDATED' WHERE id = $1`, [E1.id]);
      const e2 = await createEval();
      expect(e2.status, e2.text).toBe(201);
      expect(e2.json!["data"]).toMatchObject({ riskFrameworkVersionId: vTr.id, ratingScaleId: vTr.rating_scale_id, committeeEvaluationMinScore: 9 });
      expect((await call("rm1", "PATCH", `/risk-evaluations/${e2.json!["data"].id}/inherent`, { probability: 5, impacts: impacts(3) })).status).toBe(400);
      expect((await call("rm1", "PATCH", `/risk-evaluations/${e2.json!["data"].id}/inherent`, { probability: 4, impacts: impacts(4) })).status).toBe(200);
      // audit : ancien et nouveau defaut + APPROVE, avec le motif de la demande
      const au = await sql(`SELECT entity_id, action, old_value, new_value, reason FROM audit_log WHERE tenant_id = $1 AND request_id IS NOT NULL AND action IN ('UPDATE','APPROVE') AND entity_type IN ('RiskFramework','RiskFrameworkChangeRequest') AND (entity_id = ANY($2)) ORDER BY entity_type, entity_id`, [T, [F["Standard"], F["Tranché"], rid]]);
      const std = au.find((x) => x.entity_id === F["Standard"] && x.action === "UPDATE")!;
      const tr = au.find((x) => x.entity_id === F["Tranché"] && x.action === "UPDATE")!;
      expect(std, JSON.stringify(au)).toBeTruthy();
      expect(std.old_value.isDefault).toBe(true);
      expect(std.new_value.isDefault).toBe(false);
      expect(tr.old_value.isDefault).toBe(false);
      expect(tr.new_value).toMatchObject({ isDefault: true, decisionRegime: "NORMAL", effect: "NEXT_EVALUATIONS" });
      expect(std.reason).toBe("Le 4x4 devient le defaut");
      expect(tr.reason).toBe("Le 4x4 devient le defaut");
      expect(au.some((x) => x.entity_id === rid && x.action === "APPROVE")).toBe(true);
      // the requester is told, Audit group notified
      expect(await count(`SELECT count(*)::int n FROM notifications WHERE recipient_user_id = $1 AND event_type = 'RISK_FRAMEWORK_CHANGE_DECIDED' AND resource_id = $2`, [uid["rm1"], rid])).toBe(1);
    });

    it("C6 CONCURRENCE : deux SET_DEFAULT en attente (Standard, Renforcé) approuvees en meme temps -> 2 x 200 ou 1 x 409, jamais 500, EXACTEMENT un defaut, coherent avec la derniere decision", async () => {
      for (let i = 0; i < 4; i++) {
        const cur = (await defaults())[0]!.id as string;
        const others = ["Tranché", "Standard", "Renforcé"].map((n) => F[n]!).filter((x) => x !== cur);
        const rqs = [];
        for (const [k, fw] of others.entries()) { const q = await ask(k === 0 ? "rm1" : "rm4", fw, `Course ${i}-${k}`); expect(q.status, `${i}/${k}: ${q.text}`).toBe(201); rqs.push(q.json!["data"].id as string); }
        const [a, b] = await Promise.all([decide("rm2", rqs[0]!, "approve", "A"), decide("rm3", rqs[1]!, "approve", "B")]);
        for (const x of [a, b]) expect(x.status, x.text).toBeLessThan(500);
        const now = await defaults();
        expect(now, `iteration ${i}: ${a.status}/${b.status}`).toHaveLength(1);
        const approved = await sql(`SELECT framework_id FROM risk_framework_change_requests WHERE id = ANY($1) AND status = 'APPROVED' ORDER BY decided_at DESC, id`, [rqs]);
        expect(approved.length).toBeGreaterThanOrEqual(1);
        // les demandes non approuvees restent PENDING / ou ont ete approuvees et leurs effets sont ecrases par la derniere
        const left = await sql(`SELECT id FROM risk_framework_change_requests WHERE id = ANY($1) AND status = 'PENDING'`, [rqs]);
        for (const l of left) await decide(l.id === rqs[0] ? "rm1" : "rm4", l.id, "withdraw");
        expect(await count(`SELECT count(*)::int n FROM risk_frameworks WHERE tenant_id = $1 AND is_default AND archived_at IS NULL`, [T])).toBe(1);
      }
    });

    it("C7 la MEME demande approuvee 5 fois en parallele : un seul 200, un seul remplacement, trois lignes d'audit au plus", async () => {
      const cur = (await defaults())[0]!.id as string;
      const target = ["Tranché", "Standard", "Renforcé"].map((n) => F[n]!).find((x) => x !== cur)!;
      const rid = (await ask("rm1", target, "Meme demande")).json!["data"].id as string;
      const rs = await Promise.all(["rm2", "rm3", "rm4", "rm2", "rm3"].map((w) => decide(w as Who, rid, "approve", "ok")));
      expect(rs.filter((r) => r.status === 200), JSON.stringify(rs.map((r) => r.status))).toHaveLength(1);
      for (const r of rs.filter((x) => x.status !== 200)) expect(r.status).toBe(409);
      expect((await defaults()).map((d) => d.id)).toEqual([target]);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE request_id IS NOT NULL AND entity_type = 'RiskFramework' AND action = 'UPDATE' AND entity_id = $1 AND new_value->>'requestId' = $2 AND new_value @> '{"isDefault": true}'`, [target, rid])).toBe(1);
    });

    it("C8 un Dispositif archive ne peut pas devenir defaut ; une demande SET_DEFAULT vivante sur une cible archivee entre-temps ne s'approuve pas (4xx, defaut inchange)", async () => {
      const cur = (await defaults())[0]!.id as string;
      const target = ["Tranché", "Standard", "Renforcé"].map((n) => F[n]!).find((x) => x !== cur)!;
      const rid = (await ask("rm1", target, "Avant archivage")).json!["data"].id as string;
      // archive refused while the request is pending (C-archive rule); force the situation by SQL to test the approval guard
      expect((await archive("rm2", target)).status).toBe(409);
      await sql(`ALTER TABLE risk_frameworks DISABLE TRIGGER risk_frameworks_guard`);
      try { await sql(`UPDATE risk_frameworks SET archived_at = now(), archived_by = $2, archive_reason = 'QA' WHERE id = $1`, [target, uid["rm1"]]); } finally { await sql(`ALTER TABLE risk_frameworks ENABLE TRIGGER risk_frameworks_guard`); }
      try {
        const d = await decide("rm2", rid, "approve");
        expect(d.status, d.text).toBeGreaterThanOrEqual(400);
        expect(d.status, d.text).toBeLessThan(500);
        expect((await defaults()).map((x) => x.id)).toEqual([cur]);
        expect((await ask("rm3", target)).status).toBe(400); // archived
      } finally {
        await sql(`ALTER TABLE risk_frameworks DISABLE TRIGGER risk_frameworks_guard`);
        try { await sql(`UPDATE risk_frameworks SET archived_at = NULL, archived_by = NULL, archive_reason = NULL WHERE id = $1`, [target]); } finally { await sql(`ALTER TABLE risk_frameworks ENABLE TRIGGER risk_frameworks_guard`); }
        await decide("rm1", rid, "withdraw");
      }
    });

    // ---------------------------------------------------------------------------------------------- D archivage
    describe("D archivage POST /:id/archive", () => {
      const mkFw = async (name: string) => {
        // A scale that is ACTIVE right now (never the scale of a Dispositif that D6 may have archived: the order of C6/C7 decides which default is left, so D6 archives Standard or Renforcé)
        const sc = (await one(`SELECT id FROM rating_scales WHERE tenant_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [T])).id as string;
        const c = await call("rm1", "POST", "/risk-frameworks", { name, ratingScaleId: sc, params: { committeeEvaluationMinScore: 15, committeeEvaluationEnforced: true, committeeTreatmentMinScore: null, appetiteThresholds: [], lowCriticalityThreshold: 4 } });
        expect(c.status, c.text).toBe(201);
        return (c.json!["data"].framework?.id ?? c.json!["data"].id) as string;
      };
      const archived = async (fw: string) => (await one(`SELECT archived_at, archived_by, archive_reason FROM risk_frameworks WHERE id = $1`, [fw]));

      it("D1 motif obligatoire (absent, vide, espaces, 501) -> 400 ; droits : compte simple, Audit, droits directs hors groupe RM 403, sans jeton 401, autre tenant 404, inconnu 404 ; rien ecrit", async () => {
        const f = await mkFw("Archivable D1");
        for (const [label, b] of [["absent", NO_REASON], ["vide", ""], ["espaces", "   "], ["501", "x".repeat(501)], ["NUL", "a\u0000b"]] as [string, string | typeof NO_REASON][]) {
          const r = await archive("rm1", f, b);
          expect(r.status, `${label}: ${r.text}`).toBe(400);
        }
        for (const who of ["plain", "aud", "adm", "pu"] as Who[]) expect((await archive(who, f)).status, who).toBe(403);
        expect((await call(null, "POST", `/risk-frameworks/${f}/archive`, { reason: "x" })).status).toBe(401);
        expect((await archive("rmb", f)).status).toBe(404);
        expect((await archive("rm1", UNKNOWN)).status).toBe(404);
        expect((await call("rm1", "POST", `/risk-frameworks/${f}/archive`, { reason: "ok", archivedBy: uid["rm2"] })).status).toBe(400);
        expect((await archived(f)).archived_at).toBeNull();
      });

      it("D2 succes : archive, archived_by = acteur, motif, versions DRAFT archivees avec, audit (Dispositif + chaque version) avec le motif ; 2e archivage 400 ; defaut impossible ; nom libere", async () => {
        const f = await mkFw("Archivable D2");
        const r = await archive("rm2", f, "Plus utilise");
        expect(r.status, r.text).toBe(200);
        expect(await archived(f)).toMatchObject({ archived_by: uid["rm2"], archive_reason: "Plus utilise" });
        expect((await archived(f)).archived_at).not.toBeNull();
        const vs = await verOf(f);
        for (const v of vs) { expect(v.status).toBe("ARCHIVED"); expect(v.archive_reason).toContain("Plus utilise"); }
        const au = await sql(`SELECT entity_type, action, reason FROM audit_log WHERE request_id IS NOT NULL AND (entity_id = $1 OR entity_id = ANY($2)) AND action = 'STATUS_CHANGE'`, [f, vs.map((v) => v.id)]);
        expect(au.map((x) => x.entity_type).sort((a, b) => a.localeCompare(b))).toEqual(["RiskFramework", ...vs.map(() => "RiskFrameworkVersion")].sort((a, b) => a.localeCompare(b)));
        for (const x of au) expect(x.reason).toContain("Plus utilise");
        expect((await archive("rm1", f)).status).toBe(400);
        expect((await ask("rm1", f)).status).toBe(400);
        expect((await call("rm1", "PATCH", `/risk-frameworks/${f}`, { name: "Renomme", description: null, reason: "x" })).status).toBeGreaterThanOrEqual(400);
        // le nom est libere pour un nouveau Dispositif
        expect((await call("rm1", "POST", "/risk-frameworks", { name: "Archivable D2", ratingScaleId: (await verOf(F["Standard"]!))[0]!.rating_scale_id })).status).toBeLessThan(500);
      });

      it("D3 refus : le Dispositif PAR DEFAUT (400, rien d'ecrit), un processus VIVANT rattache (400), un rattachement en attente (400), une activation en attente (400) ; accepte quand le processus est supprime (soft delete) ou la demande retiree", async () => {
        const cur = (await defaults())[0]!.id as string;
        const rd = await archive("rm1", cur);
        expect(rd.status, rd.text).toBe(400);
        expect((await archived(cur)).archived_at).toBeNull();
        expect((await defaults()).map((x) => x.id)).toEqual([cur]);

        const f = await mkFw("Archivable D3");
        const p = await proc();
        await attach(p, f);
        const r1 = await archive("rm1", f);
        expect(r1.status, r1.text).toBe(400);
        expect((await archived(f)).archived_at).toBeNull();
        for (const v of await verOf(f)) expect(v.status).not.toBe("ARCHIVED");
        await sql(`UPDATE processes SET deleted_at = now() WHERE id = $1`, [p]);
        // pending ACTIVATE_VERSION request
        const v1 = (await verOf(f))[0]!;
        const rq = await call("rm1", "POST", `/risk-frameworks/${f}/versions/${v1.id}/activation-requests`, { reason: "Activation D3" });
        expect(rq.status, rq.text).toBe(201);
        const r2 = await archive("rm1", f);
        expect(r2.status, r2.text).toBe(409);
        expect((await archived(f)).archived_at).toBeNull();
        expect((await decide("rm1", rq.json!["data"].id, "withdraw")).status).toBe(200);
        // pending ASSIGN_PROCESS request to this Dispositif (needs an ACTIVE version): done on a Dispositif with an active version below
        const r3 = await archive("rm1", f);
        expect(r3.status, r3.text).toBe(200); // process deleted + no pending request
        expect((await archived(f)).archived_at).not.toBeNull();
      });

      it("D4 un rattachement ASSIGN_PROCESS en attente vers le Dispositif, ou une SET_DEFAULT en attente, interdit l'archivage ; apres retrait c'est possible ; un processus de l'autre cote d'une demande rejetee n'empeche rien", async () => {
        const cur = (await defaults())[0]!.id as string;
        const f = ["Tranché", "Standard", "Renforcé"].map((n) => F[n]!).find((x) => x !== cur)!;
        const p = await proc();
        const a = await call("rm1", "POST", `/risk-frameworks/${f}/process-assignments`, { processId: p, reason: "Rattachement D4" });
        expect(a.status, a.text).toBe(201);
        const r1 = await archive("rm2", f);
        expect(r1.status, r1.text).toBe(409);
        expect((await decide("rm1", a.json!["data"].id, "withdraw")).status).toBe(200);
        const s = await ask("rm1", f, "Defaut D4");
        expect(s.status, s.text).toBe(201);
        const r2 = await archive("rm2", f);
        expect(r2.status, r2.text).toBe(409);
        expect((await decide("rm1", s.json!["data"].id, "withdraw")).status).toBe(200);
        expect((await archived(f)).archived_at).toBeNull();
      });

      it("D5 atomicite : panne d'audit sur la version (STATUS_CHANGE RiskFrameworkVersion) => 5xx, Dispositif ET versions inchanges", async () => {
        const f = await mkFw("Archivable D5");
        await failAudit("RiskFrameworkVersion", "STATUS_CHANGE");
        let r: Res;
        try { r = await archive("rm1", f); } finally { await failAudit(null); }
        expect(r.status, r.text).toBeGreaterThanOrEqual(500);
        expect((await archived(f)).archived_at).toBeNull();
        for (const v of await verOf(f)) expect(v.status).toBe("DRAFT");
        await failAudit("RiskFramework", "STATUS_CHANGE");
        try { r = await archive("rm1", f); } finally { await failAudit(null); }
        expect(r.status, r.text).toBeGreaterThanOrEqual(500);
        expect((await archived(f)).archived_at).toBeNull();
        for (const v of await verOf(f)) expect(v.status).toBe("DRAFT");
        expect((await archive("rm1", f)).status).toBe(200);
      });

      it("D6 un Dispositif ACTIF non defaut : ses versions ACTIVE sont archivees avec lui ; une evaluation deja creee reste lisible avec son instantane", async () => {
        const cur = (await defaults())[0]!.id as string;
        const f = ["Standard", "Renforcé"].map((n) => F[n]!).find((x) => x !== cur)!;
        const vAct = (await sql(`SELECT * FROM risk_framework_versions WHERE framework_id = $1 AND status = 'ACTIVE'`, [f]))[0]!;
        const p = await proc();
        await attach(p, f);
        const rk = (await one(`INSERT INTO risks (tenant_id, process, description, status, owner_id, process_id) VALUES ($1,'QA D6','QA D6','ACTIVE',$2,$3) RETURNING id`, [T, uid["rm1"], p])).id as string;
        const e = await call("rm1", "POST", "/risk-evaluations", { riskId: rk, evaluationType: "AD_HOC", subCategoryId: CAT });
        expect(e.status, e.text).toBe(201);
        expect(e.json!["data"].riskFrameworkVersionId).toBe(vAct.id);
        expect((await archive("rm1", f)).status).toBe(400); // processus vivant rattache
        await sql(`UPDATE processes SET deleted_at = now() WHERE id = $1`, [p]);
        const r = await archive("rm1", f, "Retrait du modele");
        expect(r.status, r.text).toBe(200);
        expect((await one(`SELECT status FROM risk_framework_versions WHERE id = $1`, [vAct.id])).status).toBe("ARCHIVED");
        const g = await call("rm1", "GET", `/risk-evaluations/${e.json!["data"].id}`);
        expect(g.status, g.text).toBe(200);
        expect(g.json!["data"]).toMatchObject({ riskFrameworkVersionId: vAct.id, ratingScaleId: vAct.rating_scale_id });
        // l'echelle reste lisible par id
        expect((await call("rm1", "GET", `/rating-scales/${vAct.rating_scale_id}`)).status).toBe(200);
        // plus de rattachement possible vers un archive
        const p2 = await proc();
        expect((await call("rm1", "POST", `/risk-frameworks/${f}/process-assignments`, { processId: p2, reason: "x" })).status).toBe(400);
      });

      it("D7 CONCURRENCE archivage // rattachement : jamais de Dispositif archive avec une demande de rattachement vivante, jamais 500", async () => {
        const seen = { archived: 0, refused: 0 };
        for (let i = 0; i < 8; i++) {
          const f = await mkFw(`Course D7 ${i}`);
          // a Dispositif needs an ACTIVE version to receive an assignment: use the ordinary circuit
          await activate(f, "rm1", "rm2");
          const p = await proc();
          const [a, b] = await Promise.all([
            archive("rm3", f, `Course ${i}`),
            new Promise<Res>((ok) => setTimeout(ok, i * 3)).then(() => call("rm1", "POST", `/risk-frameworks/${f}/process-assignments`, { processId: p, reason: `Course ${i}` })),
          ]);
          expect(a.status, a.text).toBeLessThan(500);
          expect(b.status, b.text).toBeLessThan(500);
          const isArch = (await archived(f)).archived_at !== null;
          const pend = await count(`SELECT count(*)::int n FROM risk_framework_change_requests WHERE framework_id = $1 AND status = 'PENDING'`, [f]);
          expect(isArch && pend > 0, `iter ${i}: archive=${a.status} assign=${b.status} archived=${isArch} pending=${pend}`).toBe(false);
          if (isArch) seen.archived++; else seen.refused++;
        }
        console.log("D7 outcomes", JSON.stringify(seen));
      });

      it("D9 CONCURRENCE archivage // soumission d'une version (SEC-B13-03 : interblocage) : jamais de 5xx, jamais archive avec une demande d'activation vivante", async () => {
        const seen = { archived: 0, submitted: 0 };
        for (let i = 0; i < 20; i++) {
          const f = await mkFw(`Course D9 ${i}`); // DRAFT v1, no ACTIVE version
          const v = (await verOf(f))[0]!;
          const [a, b] = await Promise.all([
            new Promise<Res>((ok) => setTimeout(ok, i % 2 === 0 ? i % 7 : 0)).then(() => archive("rm3", f, `Course ${i}`)),
            new Promise<Res>((ok) => setTimeout(ok, i % 2 === 1 ? i % 7 : 0)).then(() => call("rm1", "POST", `/risk-frameworks/${f}/versions/${v.id}/activation-requests`, { reason: `Course ${i}` })),
          ]);
          expect(a.status, `iter ${i} archive: ${a.text}`).toBeLessThan(500);
          expect(b.status, `iter ${i} submit: ${b.text}`).toBeLessThan(500);
          const isArch = (await archived(f)).archived_at !== null;
          const pend = await count(`SELECT count(*)::int n FROM risk_framework_change_requests WHERE framework_id = $1 AND status = 'PENDING'`, [f]);
          expect(isArch && pend > 0, `iter ${i}: archive=${a.status} submit=${b.status} archived=${isArch} pending=${pend}`).toBe(false);
          expect(isArch || pend > 0 || (a.status >= 400 && b.status >= 400), `iter ${i}: rien n'a abouti sans erreur`).toBe(true);
          if (isArch) seen.archived++; else seen.submitted++;
          if (pend > 0) await decide("rm1", (await one(`SELECT id FROM risk_framework_change_requests WHERE framework_id = $1 AND status = 'PENDING'`, [f])).id, "withdraw");
        }
        console.log("D9 outcomes", JSON.stringify(seen));
      });

      it("D8 CONCURRENCE archivage // SET_DEFAULT : jamais archive ET defaut", async () => {
        for (let i = 0; i < 6; i++) {
          const f = await mkFw(`Course D8 ${i}`);
          await activate(f, "rm1", "rm2");
          const rid = (await ask("rm1", f, `Course ${i}`)).json!["data"].id as string;
          const [a, b] = await Promise.all([archive("rm3", f, `Course ${i}`), new Promise<Res>((ok) => setTimeout(ok, i * 4)).then(() => decide("rm2", rid, "approve", "ok"))]);
          expect(a.status, a.text).toBeLessThan(500);
          expect(b.status, b.text).toBeLessThan(500);
          const row = await one(`SELECT is_default, archived_at FROM risk_frameworks WHERE id = $1`, [f]);
          expect(row.is_default && row.archived_at !== null, `iter ${i}: archive=${a.status} decide=${b.status}`).toBe(false);
          expect(await count(`SELECT count(*)::int n FROM risk_frameworks WHERE tenant_id = $1 AND is_default AND archived_at IS NULL`, [T])).toBe(1);
        }
      });
    });
  });

  // ------------------------------------------------------------------------------------------------ E migration 091
  describe("E migration 091 : gardes en base", () => {
    const code = async (q: string, p: unknown[] = []) => { try { await pg.query(q, p); return null; } catch (e) { return (e as { code?: string }).code ?? "?"; } };
    const mkF = async (isDefault = false) => (await one(`INSERT INTO risk_frameworks (tenant_id, name, created_by) VALUES ($1,$2,$3) RETURNING id`, [T, `E ${Math.random()}`, uid["rm1"]])).id as string;
    void mkF;

    it("E1 gardes directs : defaut / archive / tenant / detachement refuses (42501) sans demande approuvee dans la transaction", async () => {
      expect(await code(`INSERT INTO risk_frameworks (tenant_id, name, is_default, created_by) VALUES ($1,'E default',true,$2)`, [T, uid["rm1"]])).toBe("42501");
      expect(await code(`INSERT INTO risk_frameworks (tenant_id, name, archived_at, archived_by, archive_reason, created_by) VALUES ($1,'E arch',now(),$2,'x',$2)`, [T, uid["rm1"]])).toBe("42501");
      const f = (await one(`INSERT INTO risk_frameworks (tenant_id, name, created_by) VALUES ($1,'E plain',$2) RETURNING id`, [T, uid["rm1"]])).id as string;
      expect(await code(`UPDATE risk_frameworks SET is_default = true WHERE id = $1`, [f])).toBe("42501");
      const cur = (await defaults())[0]!.id as string;
      expect(await code(`UPDATE risk_frameworks SET is_default = false WHERE id = $1`, [cur])).toBe("42501");
      expect(await code(`UPDATE risk_frameworks SET archived_at = now(), archived_by = $2, archive_reason = 'x' WHERE id = $1`, [cur, uid["rm1"]])).toBe("42501"); // defaut
      expect(await code(`UPDATE risk_frameworks SET archived_at = now() WHERE id = $1`, [f])).toBe("42501"); // sans archived_by / motif
      expect(await code(`UPDATE risk_frameworks SET archived_at = now(), archived_by = $2, archive_reason = '   ' WHERE id = $1`, [f, uid["rm1"]])).toBe("42501");
      expect(await code(`UPDATE risk_frameworks SET tenant_id = $2 WHERE id = $1`, [f, TB])).toBe("42501");
      expect(await code(`UPDATE risk_frameworks SET archived_by = $2 WHERE id = $1`, [f, uid["rm1"]])).toBe("42501"); // champs d'archive sans archived_at
      expect(await code(`UPDATE risk_frameworks SET archived_at = now(), archived_by = $2, archive_reason = 'ok' WHERE id = $1`, [f, uid["rm1"]])).toBeNull();
      expect(await code(`UPDATE risk_frameworks SET archived_at = NULL WHERE id = $1`, [f])).toBe("42501"); // pas de desarchivage
      expect(await code(`UPDATE risk_frameworks SET is_default = true WHERE id = $1`, [f])).toBe("42501"); // archive : fige
      const p = await proc();
      const g = (await one(`INSERT INTO risk_frameworks (tenant_id, name, created_by) VALUES ($1,'E attached',$2) RETURNING id`, [T, uid["rm1"]])).id as string;
      await attach(p, g);
      expect(await code(`UPDATE risk_frameworks SET archived_at = now(), archived_by = $2, archive_reason = 'x' WHERE id = $1`, [g, uid["rm1"]])).toBe("42501"); // processus vivant
      // R-02 : detacher un processus vivant est refuse ; supprime, c'est permis
      expect(await code(`UPDATE processes SET risk_framework_id = NULL WHERE id = $1`, [p])).toBe("42501");
      expect(await attachedTo(p)).toBe(g);
      expect(await code(`UPDATE processes SET risk_framework_id = NULL, deleted_at = now() WHERE id = $1`, [p])).toBeNull();
    });

    it("E2 SET_DEFAULT : une demande d'un Dispositif d'un AUTRE tenant est refusee en base ; les fonctions de garde fixent leur search_path (pg_temp en dernier)", async () => {
      const fB = (await one(`SELECT id FROM risk_frameworks WHERE tenant_id = $1 LIMIT 1`, [TB])).id as string;
      expect(await code(`INSERT INTO risk_framework_change_requests (tenant_id, kind, framework_id, reason, requested_by) VALUES ($1,'SET_DEFAULT',$2,'x',$3)`, [T, fB, uid["rm1"]])).toBe("42501");
      const f = await sql(`SELECT proname, proconfig FROM pg_proc WHERE proname IN ('risk_frameworks_guard','risk_framework_assign_tenant_guard','processes_framework_guard')`);
      expect(f).toHaveLength(3);
      for (const x of f) expect(x.proconfig, x.proname).toEqual(["search_path=pg_catalog, public, pg_temp"]);
      const t = await sql(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'risk_frameworks_guard'`);
      expect(t.map((x) => x.tgenabled)).toEqual(["O"]);
    });

    it("E3 la creation reste possible sans defaut ni archive (INSERT normal) et les chemins applicatifs (create, activate, decide, archive) ne declenchent aucune garde (vus aux blocs C et D)", async () => {
      expect(await code(`INSERT INTO risk_frameworks (tenant_id, name, created_by) VALUES ($1,'E ok',$2)`, [T, uid["rm1"]])).toBeNull();
    });
  });

  describe("E4 migration 091 up / down / up (base jetable, sans serveur)", () => {
    const MDB = "grc_qa_b13_mig";
    const REF = "grc_qa_b13_ref";
    const M = (n: string) => join(ROOT, "database", "postgresql", "migrations", n);
    const psql = (db: string, args: string[]) => execFileSync("/usr/bin/psql", ["-X", "-q", "-h", "127.0.0.1", "-p", String(PGPORT), "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const fns = (db: string) => psql(db, ["-At", "-c", `SELECT p.proname || E'\\n' || pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname IN ('risk_frameworks_guard','risk_framework_assign_tenant_guard','processes_framework_guard') ORDER BY p.proname`]);
    const trg = (db: string) => psql(db, ["-At", "-c", `SELECT tgname FROM pg_trigger WHERE tgname = 'risk_frameworks_guard'`]);
    const run = (db: string, f: string) => { try { psql(db, ["-f", M(f)]); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };

    it("E4 up rejoue sans effet ; down = fonctions de 090 (identiques a une base 001..090), trigger retire ; down rejouable ; up retablit exactement l'etat initial", () => {
      const build = (db: string, upTo: string) => {
        psql("postgres", ["-c", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`, "-c", `CREATE DATABASE ${db}`]);
        try { psql(db, ["-c", "CREATE ROLE grc_app_runtime NOLOGIN"]); } catch { /* role du cluster deja la */ }
        try { psql(db, ["-c", "CREATE ROLE grc_migrator NOLOGIN"]); } catch { /* idem */ }
        psql(db, ["-c", "CREATE TABLE schema_migrations (filename text primary key, applied_at timestamptz not null default now())"]);
        const files = readdirSync(join(ROOT, "database", "postgresql", "migrations")).filter((x) => /^\d{3}_.*\.sql$/.test(x) && !x.endsWith(".down.sql")).sort((a, b) => a.localeCompare(b));
        for (const f of files) { if (f.slice(0, 3) > upTo) break; psql(db, ["-1", "-f", M(f)]); }
      };
      build(MDB, "091");
      build(REF, "090");
      const full = fns(MDB);
      const ref = fns(REF);
      expect(trg(MDB).trim()).toBe("risk_frameworks_guard");
      expect(trg(REF).trim()).toBe("");
      expect(run(MDB, "091_framework_default_archive_guard.sql")).toBeNull(); // replay
      expect(fns(MDB)).toBe(full);
      expect(run(MDB, "091_framework_default_archive_guard.down.sql")).toBeNull();
      expect(trg(MDB).trim()).toBe("");
      expect(psql(MDB, ["-At", "-c", "SELECT count(*) FROM pg_proc WHERE proname = 'risk_frameworks_guard'"]).trim()).toBe("0");
      // the two other guard functions come back to their 090 definitions
      const strip = (s: string) => s.split("\n").filter((l) => !/^\s*$/.test(l)).join("\n");
      expect(strip(fns(MDB))).toBe(strip(ref));
      expect(run(MDB, "091_framework_default_archive_guard.down.sql")).toBeNull(); // rejouable
      expect(run(MDB, "091_framework_default_archive_guard.sql")).toBeNull();
      expect(fns(MDB)).toBe(full);
      expect(trg(MDB).trim()).toBe("risk_frameworks_guard");
    }, 280000);
  });
});
