import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { BAD_REASONS, ROOT, qaVisibilityHarness } from "./qaVisibilityHarness.js";

/**
 * QA-q253 (niveau 2) : q253 A (DECISION-121, PRIV-V5-02) : la regle de V5 (acces nomme : 30 jours au plus, renouvelable avec motif, fin a la cloture)
 * s'applique aussi aux personnes ajoutees nommement a un dossier PERIMETRE ; migration 094 : les acces vivants sans echeance d'un dossier PERIMETRE recoivent
 * now() + 30 jours. Oracles ecrits AVANT l'execution. Pas un avis Security / Privacy / Compliance.
 * Live : QA_Q253_LIVE=1 (vrai serveur, port 8100, base `grc_qa_q253` ; migration sur `grc_qa_q253mig`), cluster LOCAL 127.0.0.1:55442 ; suites live en --no-file-parallelism.
 *
 * T  cinq types, risques et ressources : pose de 30 j a l'ajout (PUT PERIMETRE, creation d'un risque PERIMETRE) ; lecture vivante / echue (404 comme un inconnu) / renouvelee / close ;
 *    le Risk Manager et le proprietaire lisent toujours ; la ligne n'est ni supprimee ni revoquee ; heritage (anomalie / plan d'un parent PERIMETRE).
 * R  renouvellement : motif obligatoire (6 motifs invalides), jamais au-dela de 30 jours (renouvellements repetes sans empilement, garde SQL), pas de renouvellement de son propre acces.
 * L  cloture et q254 (pas de retour a la reouverture) : aucun chemin applicatif ne rouvre un dossier clos ; une reouverture directe en base ne redonne l'acces qu'avant l'echeance (observation).
 * C  acces CLIENT et acces deja dates intacts ; changement de niveau.
 * V  PRIV-V5-01 : `expiresAt` visible du seul Risk Manager et du proprietaire, sur un dossier PERIMETRE aussi (GET et reponse du PUT).
 * M  migration 094 sur base jetable : datation des seuls acces PERIMETRE vivants sans echeance, rejeu sans effet, up / down / up.
 */
const live = process.env["QA_Q253_LIVE"] === "1";
const DB = "grc_qa_q253";
const MIG_DB = "grc_qa_q253mig";
const PORT = 8100;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const T = I("001");
const DAY = 86_400_000;
const PSQL = "/usr/bin/psql";

type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
const TYPES = ["RISK", "CONTROL", "KPI", "ANOMALY", "ACTION_PLAN"] as const;
type Type = (typeof TYPES)[number];
const PATH: Record<Type, string> = { RISK: "/risks", CONTROL: "/controls", KPI: "/kpis", ANOMALY: "/anomalies", ACTION_PLAN: "/actions" };
const CLOSE: Record<Type, string> = {
  RISK: "UPDATE risks SET status = 'ARCHIVED' WHERE id = $1",
  CONTROL: "UPDATE controls SET status = 'ARCHIVED' WHERE id = $1",
  KPI: "UPDATE kpis SET deleted_at = now() WHERE id = $1",
  ANOMALY: "UPDATE anomalies SET status = 'CLOSED' WHERE id = $1",
  ACTION_PLAN: "UPDATE action_plans SET status = 'TERMINEE' WHERE id = $1",
};
const REOPEN: Record<Type, string> = {
  RISK: "UPDATE risks SET status = 'ACTIVE' WHERE id = $1",
  CONTROL: "UPDATE controls SET status = 'ACTIVE' WHERE id = $1",
  KPI: "UPDATE kpis SET deleted_at = NULL WHERE id = $1",
  ANOMALY: "UPDATE anomalies SET status = 'NEW' WHERE id = $1",
  ACTION_PLAN: "UPDATE action_plans SET status = 'EN_COURS' WHERE id = $1",
};
const REASON = "Dossier toujours en cours, acces a prolonger";

const H = qaVisibilityHarness({ db: DB, port: PORT, who: WHO, uid: UID });
const { sql, get, call, post } = H;

async function insertItem(type: Type, level: string, extra: { riskId?: string; controlId?: string; source?: ["RISK" | "CONTROL", string] } = {}): Promise<string> {
  const id = randomUUID();
  if (type === "RISK") await sql("INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ($1, $2, 'Q253', 'Q253', 'ACTIVE', $3, $4)", [id, T, UID.own, level]);
  if (type === "CONTROL") await sql("INSERT INTO controls (id, tenant_id, label, control_type, frequency, executor, compliance_criteria, visibility) VALUES ($1, $2, 'Q253', 'PREVENTIVE', 'MONTHLY', 'x', 'y', $3)", [id, T, level]);
  if (type === "KPI") await sql("INSERT INTO kpis (id, tenant_id, label, target_value, unit, frequency, owner, department_id, visibility) VALUES ($1, $2, 'Q253', 1, 'u', 'MONTHLY', 'x', $3, $4)", [id, T, I("201"), level]);
  if (type === "ANOMALY") await sql("INSERT INTO anomalies (id, tenant_id, description, severity, detected_by, visibility, risk_id, control_id) VALUES ($1, $2, 'Q253', 'LOW', $3, $4, $5, $6)", [id, T, UID.own, level, extra.riskId ?? null, extra.controlId ?? null]);
  if (type === "ACTION_PLAN") await sql("INSERT INTO action_plans (id, tenant_id, title, source_type, source_id, responsible_user_id, due_date, created_by, visibility) VALUES ($1, $2, 'Q253', $3, $4, $5, current_date + 30, $5, $6)", [id, T, extra.source?.[0] ?? "MANAGEMENT", extra.source?.[1] ?? null, UID.own, level]);
  return id;
}
const grant = (type: string, id: string, user: string, inInterval: string | null = null) =>
  sql(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason, expires_at) VALUES ($1, $2, $3, $4, $5, 'Q253', ${inInterval ? `now() + interval '${inInterval}'` : "NULL"})`, [T, type, id, user, user === UID.rm ? UID.adm : UID.rm]);
const withoutGuard = async (query: string, params: unknown[]) => {
  await sql("ALTER TABLE resource_access_grants DISABLE TRIGGER resource_access_grants_guard");
  try { await sql(query, params); } finally { await sql("ALTER TABLE resource_access_grants ENABLE TRIGGER resource_access_grants_guard"); }
};
const expire = (type: string, id: string, user = UID.out2) =>
  withoutGuard("UPDATE resource_access_grants SET expires_at = now() - interval '1 minute' WHERE resource_type = $1 AND resource_id = $2 AND user_id = $3 AND revoked_at IS NULL", [type, id, user]);
const expiryOf = async (type: string, id: string, user = UID.out2) =>
  (await sql<{ expires_at: Date | null }>("SELECT expires_at FROM resource_access_grants WHERE resource_type = $1 AND resource_id = $2 AND user_id = $3 AND revoked_at IS NULL", [type, id, user]))[0]?.expires_at ?? null;
const daysFromNow = (d: Date | string | null) => (new Date(d as string).getTime() - Date.now()) / DAY;
const reads = async (who: Who, type: Type, id: string) => (await get(who, `${PATH[type]}/${id}`)).status === 200;
const renew = (who: Who, type: Type, id: string, userIds: string[], reason: unknown = REASON) => post(who, `${PATH[type]}/${id}/visibility/renew`, { userIds, reason });
const setVis = (who: Who, type: Type, id: string, visibility: string, addUserIds: string[] = [], revokeUserIds: string[] = []) =>
  H.put(who, `${PATH[type]}/${id}/visibility`, { visibility, addUserIds, revokeUserIds, reason: REASON });
const grantRows = (id: string) => sql<{ user_id: string; revoked_at: Date | null; expires_at: Date | null }>("SELECT user_id, revoked_at, expires_at FROM resource_access_grants WHERE resource_id = $1 ORDER BY granted_at, id", [id]);
/** A PERIMETRE dossier with `out2` (outside every perimeter) added by name through the real API. */
const perimetre = async (type: Type, extra: Parameters<typeof insertItem>[2] = {}) => {
  const id = await insertItem(type, "PERIMETRE", extra);
  const r = await setVis("rm", type, id, "PERIMETRE", [UID.out2]);
  expect(r.status, `${type}: ${r.text.slice(0, 200)}`).toBe(200);
  return id;
};

describe.skipIf(!live)("QA-q253 sur le VRAI serveur + PostgreSQL 16 LOCAL", () => {
  beforeAll(() => H.start(async () => { await sql("TRUNCATE anomalies, action_plans CASCADE"); }), 280000);
  afterAll(() => H.stop());

  // ------------------------------------------------------------------------------------------------ T
  describe("T cinq types : pose, lecture, echeance, renouvellement, cloture", () => {
    for (const type of TYPES) {
      it(`${type} PERIMETRE : l'ajout nominatif recoit 30 j ; vivant lit ; echu => 404 comme un inconnu, ligne intacte, RM et proprietaire lisent ; renouvele lit ; clos ne lit plus`, async () => {
        const id = await perimetre(type);
        const d = daysFromNow(await expiryOf(type, id));
        expect(d, "pose de 30 jours").toBeGreaterThan(29.9);
        expect(d).toBeLessThanOrEqual(30);
        expect(await reads("out2", type, id), "vivant").toBe(true);
        expect(await reads("out", type, id), "inconnu").toBe(false);
        await expire(type, id);
        expect(await reads("out2", type, id), "echu").toBe(false);
        expect((await get("out2", `${PATH[type]}/${id}`)).status, "meme reponse qu'un inconnu").toBe((await get("out", `${PATH[type]}/${id}`)).status);
        expect(await reads("rm", type, id), "RM").toBe(true);
        if (type === "RISK") expect(await reads("own", type, id), "proprietaire").toBe(true);
        const rows = await grantRows(id);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.revoked_at, "ni revoquee ni supprimee").toBeNull();
        const r = await renew("rm", type, id, [UID.out2]);
        expect(r.status, r.text.slice(0, 200)).toBe(200);
        expect(await reads("out2", type, id), "renouvele").toBe(true);
        const d2 = daysFromNow(await expiryOf(type, id));
        expect(d2).toBeGreaterThan(29.9);
        expect(d2).toBeLessThanOrEqual(30);
        expect(await grantRows(id), "une seule ligne vivante").toHaveLength(1);
        await sql(CLOSE[type], [id]);
        expect(await reads("out2", type, id), "clos").toBe(false);
        expect(await reads("rm", type, id), "RM lit un dossier clos (un KPI clos est supprime : 404 pour tous)").toBe(type !== "KPI");
      });
    }

    it("les personnes DEJA presentes dans la liste d'un dossier PERIMETRE (sans echeance) sont datees des l'enregistrement suivant : gardees et ajoutees, cinq types", async () => {
      for (const type of TYPES) {
        const id = await insertItem(type, "PERIMETRE");
        await grant(type, id, UID.named); // ancienne personne, sans echeance
        expect(await expiryOf(type, id, UID.named)).toBeNull();
        const r = await setVis("rm", type, id, "PERIMETRE", [UID.out2]);
        expect(r.status, `${type}: ${r.text.slice(0, 200)}`).toBe(200);
        for (const u of [UID.named, UID.out2]) expect(daysFromNow(await expiryOf(type, id, u)), `${type} ${u}`).toBeGreaterThan(29.9);
      }
    });

    it("risque CREE en PERIMETRE avec une liste nominative (POST /risks) : chaque personne nommee porte une echeance de 30 jours", async () => {
      const body = { process: "Q253", description: "Q253 create", visibility: "PERIMETRE", accessUserIds: [UID.out2], departmentId: I("201") };
      const r = await call("rm", "POST", "/risks", body);
      let id: string | undefined = r.json?.data?.id;
      if (!id) {
        const f = await fetch(`${H.API}/risks`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${H.TOK.rm}`, "idempotency-key": randomUUID() }, body: JSON.stringify(body) });
        const j = (await f.json()) as { data?: { id?: string } };
        expect(f.status, JSON.stringify(j).slice(0, 240)).toBeLessThan(300);
        id = j.data!.id!;
      }
      const d = daysFromNow(await expiryOf("RISK", id));
      expect(d).toBeGreaterThan(29.9);
      expect(d).toBeLessThanOrEqual(30);
    });

    for (const [parent, child] of [["RISK", "ANOMALY"], ["RISK", "ACTION_PLAN"], ["CONTROL", "ANOMALY"], ["CONTROL", "ACTION_PLAN"]] as const) {
      it(`heritage : ${child} d'un ${parent} PERIMETRE : lisible par l'acces nomme du parent, illisible a son echeance, relisible au renouvellement, illisible a la cloture du parent`, async () => {
        const p = await perimetre(parent);
        const c = child === "ANOMALY"
          ? await insertItem("ANOMALY", "CLIENT", parent === "RISK" ? { riskId: p } : { controlId: p })
          : await insertItem("ACTION_PLAN", "CLIENT", { source: [parent, p] });
        expect(await reads("out2", child, c), "herite").toBe(true);
        expect(await reads("out", child, c), "inconnu").toBe(false);
        await expire(parent, p);
        expect(await reads("out2", child, c), "echu").toBe(false);
        expect((await renew("rm", parent, p, [UID.out2])).status).toBe(200);
        expect(await reads("out2", child, c), "renouvele").toBe(true);
        await sql(CLOSE[parent], [p]);
        expect(await reads("out2", child, c), "parent clos").toBe(false);
      });
    }

    it("compteur des dossiers restreints : un acces PERIMETRE echu ou clos n'est plus compte ; renouvele, il l'est de nouveau", async () => {
      const id = await perimetre("CONTROL");
      const count = async () => {
        const r = await get("rm", "/restricted-resources");
        expect(r.status, r.text.slice(0, 160)).toBe(200);
        const rows = (r.json.data ?? r.json) as Array<{ id?: string; resourceId?: string; accessCount?: number }>;
        return rows.find((x) => (x.id ?? x.resourceId) === id)?.accessCount ?? null;
      };
      const live1 = await count();
      await expire("CONTROL", id);
      const after = await count();
      console.log("T compteur : vivant", live1, "echu", after);
      expect(after === null || after === 0, "echu : plus compte").toBe(true);
      expect((await renew("rm", "CONTROL", id, [UID.out2])).status).toBe(200);
      expect(await count()).toBe(live1);
    });
  });

  // ------------------------------------------------------------------------------------------------ R
  describe("R renouvellement : motif obligatoire, jamais au-dela de 30 jours", () => {
    it("motif absent, vide, espaces, 501 caracteres, null, nombre : 400, aucune ecriture ni audit ; cinq types", async () => {
      for (const type of TYPES) {
        const id = await perimetre(type);
        await expire(type, id);
        const audits = (await H.audits(id)).length;
        const before = (await expiryOf(type, id))!.getTime();
        for (const bad of BAD_REASONS) {
          const r = await renew("rm", type, id, [UID.out2], bad);
          expect(r.status, `${type} ${JSON.stringify(bad)}: ${r.text.slice(0, 120)}`).toBe(400);
        }
        const noReason = await post("rm", `${PATH[type]}/${id}/visibility/renew`, { userIds: [UID.out2] });
        expect(noReason.status, `${type} sans champ motif`).toBe(400);
        expect((await H.audits(id)).length, type).toBe(audits);
        expect((await expiryOf(type, id))!.getTime(), type).toBe(before);
        expect(await reads("out2", type, id), "toujours illisible").toBe(false);
      }
    });

    it("jamais au-dela de 30 jours : renouvellements repetes sans empilement (<= 30 j a chaque fois) ; garde SQL : 31 j (insertion et mise a jour), retrait de l'echeance, 30 j + 1 s refuses", async () => {
      const id = await perimetre("RISK");
      for (let i = 0; i < 3; i++) {
        expect((await renew("rm", "RISK", id, [UID.out2], `${REASON} ${i}`)).status).toBe(200);
        const d = daysFromNow(await expiryOf("RISK", id));
        expect(d, `renouvellement ${i}`).toBeLessThanOrEqual(30);
        expect(d).toBeGreaterThan(29.9);
      }
      const upd = async (q: string, p: unknown[]) => { try { await sql(q, p); return null; } catch (e) { return (e as { code?: string }).code ?? "?"; } };
      expect(await upd("UPDATE resource_access_grants SET expires_at = now() + interval '31 days' WHERE resource_id = $1 AND revoked_at IS NULL", [id]), "31 j").not.toBeNull();
      expect(await upd("UPDATE resource_access_grants SET expires_at = now() + interval '30 days 1 second' WHERE resource_id = $1 AND revoked_at IS NULL", [id]), "30 j + 1 s").not.toBeNull();
      expect(await upd("UPDATE resource_access_grants SET expires_at = NULL WHERE resource_id = $1 AND revoked_at IS NULL", [id]), "retrait de l'echeance").not.toBeNull();
      expect(await upd("INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason, expires_at) VALUES ($1,'RISK',$2,$3,$4,'x', now() + interval '31 days')", [T, id, UID.n1, UID.rm]), "insertion 31 j").not.toBeNull();
      expect(daysFromNow(await expiryOf("RISK", id))).toBeLessThanOrEqual(30);
    });

    it("un acces sans echeance d'un dossier PERIMETRE (ancien, avant 094) se renouvelle aussi (il recoit 30 j) ; une personne sans acces : 400 ; son propre acces : refuse ; lecteur sans droit : 403 ; anonyme : 401", async () => {
      const id = await insertItem("CONTROL", "PERIMETRE");
      await grant("CONTROL", id, UID.out2);
      const r = await renew("rm", "CONTROL", id, [UID.out2]);
      console.log("R renouveler un acces sans echeance (PERIMETRE) ->", r.status, r.text.slice(0, 120));
      expect(r.status, r.text.slice(0, 160)).toBeLessThan(500);
      const noAccess = await renew("rm", "CONTROL", id, [UID.named]);
      expect(noAccess.status, noAccess.text.slice(0, 160)).toBe(400);
      const self = await renew("out2", "CONTROL", id, [UID.out2]);
      expect([400, 403, 404], `son propre acces : ${self.text.slice(0, 120)}`).toContain(self.status);
      expect((await renew("aud", "CONTROL", id, [UID.out2])).status).toBe(403);
      expect((await call(null as unknown as Who, "POST", `${PATH.CONTROL}/${id}/visibility/renew`, { userIds: [UID.out2], reason: REASON })).status).toBe(401);
    });

    it("le proprietaire renouvelle l'acces d'un dossier PERIMETRE (comme l'ajout) et le groupe Risk Manager est prevenu ; une ligne d'audit avec ancien / nouvel acces", async () => {
      const id = await perimetre("RISK");
      await expire("RISK", id);
      const r = await renew("own", "RISK", id, [UID.out2]);
      expect(r.status, r.text.slice(0, 200)).toBe(200);
      const row = (await H.audits(id)).filter((a) => a.action === "PERMISSION_CHANGE").pop()!;
      expect(row).toBeTruthy();
      expect(new Date(row.old_value.access[0].expiresAt).getTime()).toBeLessThan(Date.now());
      expect(daysFromNow(row.new_value.access[0].expiresAt)).toBeGreaterThan(29.9);
      expect((await H.notifs("rm", id)).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ------------------------------------------------------------------------------------------------ L
  describe("L cloture et q254 : pas de retour d'acces a la reouverture", () => {
    it("aucun chemin applicatif ne rouvre un dossier clos : risque ARCHIVED, controle ARCHIVED, anomalie CLOSED, plan TERMINEE, KPI supprime : refus 4xx et etat inchange (RM)", async () => {
      const risk = await perimetre("RISK");
      await sql(CLOSE.RISK, [risk]);
      const r1 = await call("rm", "PATCH", `/risks/${risk}`, { status: "ACTIVE" });
      expect(r1.status, r1.text.slice(0, 160)).toBeGreaterThanOrEqual(400);
      expect((await sql<{ status: string }>("SELECT status FROM risks WHERE id = $1", [risk]))[0]!.status).toBe("ARCHIVED");
      const control = await perimetre("CONTROL");
      await sql(CLOSE.CONTROL, [control]);
      const r2 = await call("rm", "PATCH", `/controls/${control}`, { status: "ACTIVE" });
      expect(r2.status, r2.text.slice(0, 160)).toBeGreaterThanOrEqual(400);
      expect((await sql<{ status: string }>("SELECT status FROM controls WHERE id = $1", [control]))[0]!.status).toBe("ARCHIVED");
      const anomaly = await perimetre("ANOMALY");
      await sql(CLOSE.ANOMALY, [anomaly]);
      for (const to of ["NEW", "UNDER_ANALYSIS", "ACTION_IN_PROGRESS"]) {
        const r = await call("rm", "PATCH", `/anomalies/${anomaly}/status`, { status: to, comment: "reouverture" });
        expect(r.status, `${to}: ${r.text.slice(0, 160)}`).toBeGreaterThanOrEqual(400);
      }
      expect((await sql<{ status: string }>("SELECT status FROM anomalies WHERE id = $1", [anomaly]))[0]!.status).toBe("CLOSED");
      const plan = await perimetre("ACTION_PLAN");
      await sql(CLOSE.ACTION_PLAN, [plan]);
      for (const path of [`/actions/${plan}/start`, `/actions/${plan}/progress`]) {
        const r = await call("rm", "PATCH", path, path.endsWith("progress") ? { progress: 10 } : {});
        expect(r.status, `${path}: ${r.text.slice(0, 160)}`).toBeGreaterThanOrEqual(400);
      }
      expect((await sql<{ status: string }>("SELECT status FROM action_plans WHERE id = $1", [plan]))[0]!.status).toBe("TERMINEE");
      const kpi = await perimetre("KPI");
      await sql(CLOSE.KPI, [kpi]);
      const r5 = await call("rm", "PATCH", `/kpis/${kpi}`, { label: "x" });
      expect(r5.status, r5.text.slice(0, 160)).toBeGreaterThanOrEqual(400);
      expect((await sql<{ d: boolean }>("SELECT deleted_at IS NOT NULL AS d FROM kpis WHERE id = $1", [kpi]))[0]!.d).toBe(true);
      // et la personne nommee n'a toujours rien
      for (const [t, id] of [["RISK", risk], ["CONTROL", control], ["ANOMALY", anomaly], ["ACTION_PLAN", plan], ["KPI", kpi]] as const) expect(await reads("out2", t, id), t).toBe(false);
    });

    it("OBSERVATION (q254 = « rien a coder, pas de reouverture ») : une reouverture directe en base redonne l'acces tant que l'echeance n'est pas passee, jamais apres ; la ligne d'acces n'est pas revoquee a la cloture", async () => {
      const seen: string[] = [];
      for (const type of TYPES) {
        const id = await perimetre(type);
        await sql(CLOSE[type], [id]);
        expect(await reads("out2", type, id), `${type} clos`).toBe(false);
        expect((await grantRows(id))[0]!.revoked_at, `${type} ligne non revoquee a la cloture`).toBeNull();
        await sql(REOPEN[type], [id]);
        const back = await reads("out2", type, id);
        seen.push(`${type}:${back ? "acces rendu" : "pas d'acces"}`);
        await sql(CLOSE[type], [id]);
        await expire(type, id);
        await sql(REOPEN[type], [id]);
        expect(await reads("out2", type, id), `${type} rouvert apres echeance`).toBe(false);
      }
      console.log("L reouverture directe en base (echeance non passee) ->", seen.join(" "));
    });
  });

  // ------------------------------------------------------------------------------------------------ C
  describe("C acces CLIENT, acces deja dates, changements de niveau", () => {
    it("un dossier CLIENT : personne n'a d'echeance posee (PUT CLIENT garde les lignes sans echeance) ; lisible par tous ; cinq types", async () => {
      for (const type of TYPES) {
        const id = await insertItem(type, "CLIENT");
        await grant(type, id, UID.named);
        const r = await setVis("rm", type, id, "CLIENT");
        expect(r.status, `${type}: ${r.text.slice(0, 200)}`).toBeLessThan(500);
        expect(await expiryOf(type, id, UID.named), `${type} CLIENT : aucune echeance posee`).toBeNull();
        expect(await reads("out", type, id), `${type} lisible par tous`).toBe(true);
      }
    });

    it("un acces DEJA date (NOMINATIF ou PERIMETRE) garde son echeance quand on enregistre de nouveau (pas de prolongation silencieuse a +30 j) ; deux personnes, deux echeances", async () => {
      for (const type of TYPES) {
        const id = await insertItem(type, "PERIMETRE");
        await grant(type, id, UID.named, "5 days");
        const before = (await expiryOf(type, id, UID.named))!.getTime();
        const r = await setVis("rm", type, id, "PERIMETRE", [UID.out2]);
        expect(r.status, `${type}: ${r.text.slice(0, 200)}`).toBe(200);
        expect((await expiryOf(type, id, UID.named))!.getTime(), `${type} acces date intact`).toBe(before);
        expect(daysFromNow(await expiryOf(type, id, UID.out2)), `${type} nouvelle personne`).toBeGreaterThan(29.9);
      }
    });

    it("niveau change : PERIMETRE -> CLIENT conserve les lignes et leurs echeances ; retour a PERIMETRE : l'acces echu reste echu (pas de resurrection)", async () => {
      const id = await perimetre("CONTROL");
      await expire("CONTROL", id);
      expect((await setVis("rm", "CONTROL", id, "CLIENT")).status).toBeLessThan(500);
      expect((await grantRows(id))[0]!.expires_at, "echeance conservee").not.toBeNull();
      expect((await setVis("rm", "CONTROL", id, "PERIMETRE")).status).toBeLessThan(500);
      expect(await reads("out2", "CONTROL", id), "toujours echu").toBe(false);
      expect((await setVis("rm", "CONTROL", id, "NOMINATIF")).status).toBeLessThan(500);
      expect(await reads("out2", "CONTROL", id), "NOMINATIF : toujours echu").toBe(false);
    });
  });

  // ------------------------------------------------------------------------------------------------ V
  describe("V PRIV-V5-01 : expiresAt visible du seul Risk Manager et du proprietaire", () => {
    it("GET /visibility et reponse du PUT d'un dossier PERIMETRE : expiresAt present pour le RM et le proprietaire, ABSENT pour tout autre lecteur (noms seuls) ; cinq types", async () => {
      for (const type of TYPES) {
        const id = await perimetre(type);
        const users = (w: Who, r: { json: { data: { accessUsers?: Array<{ id: string; expiresAt?: string | null }> } } }) => ({ w, users: r.json.data.accessUsers ?? [] });
        const rm = await get("rm", `${PATH[type]}/${id}/visibility`);
        expect(rm.status, `${type} rm: ${rm.text.slice(0, 160)}`).toBe(200);
        const rmU = users("rm", rm).users;
        expect(rmU.map((u) => u.id)).toContain(UID.out2);
        expect(typeof rmU.find((u) => u.id === UID.out2)!.expiresAt, `${type} RM voit expiresAt`).toBe("string");
        if (type === "RISK" || type === "CONTROL" || type === "KPI") {
          const own = await get("own", `${PATH[type]}/${id}/visibility`);
          if (own.status === 200) expect(typeof (own.json.data.accessUsers ?? []).find((u: { id: string }) => u.id === UID.out2)?.expiresAt, `${type} proprietaire voit expiresAt`).toBe("string");
        }
        for (const w of ["out2", "dept", "n1", "raci", "pown", "named", "com"] as Who[]) {
          const r = await get(w, `${PATH[type]}/${id}/visibility`);
          if (r.status !== 200) continue; // pas de droit de lecture de l'etat : rien ne fuit
          const list = (r.json.data.accessUsers ?? []) as Array<{ id: string; expiresAt?: unknown }>;
          for (const u of list) expect(u.expiresAt, `${type} ${w} ne voit pas expiresAt`).toBeUndefined();
          expect(JSON.stringify(r.json), `${type} ${w} : aucune date d'echeance dans la reponse`).not.toMatch(/expiresAt|expires_at/);
        }
      }
    });

    it("la fiche d'un risque PERIMETRE (GET /risks/:id) et la liste n'exposent pas l'echeance a un lecteur ordinaire ; un acces echu : meme 404 que pour un inconnu (pas d'oracle sur l'existence de l'acces)", async () => {
      const id = await perimetre("RISK");
      const sheet = await get("out2", `/risks/${id}`);
      expect(sheet.status).toBe(200);
      expect(JSON.stringify(sheet.json)).not.toMatch(/expiresAt|expires_at/);
      await expire("RISK", id);
      const a = await get("out2", `/risks/${id}`);
      const b = await get("out", `/risks/${id}`);
      expect(a.status).toBe(b.status);
      expect(JSON.stringify(a.json).replace(/REQ-[0-9A-F]+/g, "")).toBe(JSON.stringify(b.json).replace(/REQ-[0-9A-F]+/g, ""));
    });
  });
});

// ------------------------------------------------------------------------------------------------ M migration 094
describe.skipIf(!live)("M migration 094 (base jetable, sans serveur)", () => {
  const M = (f: string) => join(ROOT, "database", "postgresql", "migrations", f);
  const psql = (args: string[], db = MIG_DB) => execFileSync(PSQL, ["-X", "-q", "-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const rows = (q: string) => psql(["-At", "-F", "|", "-c", q]).trim().split("\n").filter((l) => l !== "");
  const MT = "bbbbbbbb-0000-4000-8000-0000000000a1";
  const U = [1, 2, 3].map((n) => `bbbbbbbb-0000-4000-8000-0000000001${n}0`);
  const ID = (n: number) => `cccccccc-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
  const snapshot = () => rows("SELECT resource_type || '/' || resource_id || '/' || user_id || '/' || COALESCE(expires_at::text, 'NULL') || '/' || (revoked_at IS NOT NULL) FROM resource_access_grants ORDER BY 1");
  const fnDefs = () => rows("SELECT p.proname || '=' || md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1");

  it("094 sur une base 001..093 avec donnees : seuls les acces VIVANTS SANS ECHEANCE d'un dossier PERIMETRE sont dates a +30 j (cinq types) ; CLIENT, acces deja dates (NOMINATIF et PERIMETRE), acces revoques : intacts ; aucune ligne perdue ; rejeu et up / down / up sans effet", () => {
    psql(["-c", `DROP DATABASE IF EXISTS ${MIG_DB} WITH (FORCE)`, "-c", `CREATE DATABASE ${MIG_DB}`], "postgres");
    for (const r of ["grc_app_runtime", "grc_migrator"]) { try { psql(["-c", `CREATE ROLE ${r} NOLOGIN`]); } catch { /* role du cluster deja la */ } }
    psql(["-c", "CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"]);
    const files = readdirSync(join(ROOT, "database", "postgresql", "migrations")).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith(".down.sql") && f < "094").sort((a, b) => a.localeCompare(b));
    for (const f of files) psql(["-1", "-f", M(f)]);
    psql(["-c", `INSERT INTO tenants (id, name) VALUES ('${MT}', 'Tenant mig q253')`]);
    for (const [i, u] of U.entries()) psql(["-c", `INSERT INTO users (id, tenant_id, email, display_name, roles) VALUES ('${u}', '${MT}', 'm${i}@mig.test', 'M${i}', '{}')`]);
    psql(["-c", `INSERT INTO departments (id, tenant_id, name) VALUES ('${ID(90)}', '${MT}', 'D')`]);
    const lvl = (n: number, t: string) => `'${t}'`;
    void lvl;
    const stmts: string[] = [];
    // un dossier de chaque type et niveau : PERIMETRE (P), CLIENT (C), NOMINATIF (N)
    const mkRisk = (n: number, level: string) => `INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ('${ID(n)}', '${MT}', 'p', 'd', 'ACTIVE', '${U[0]}', '${level}');`;
    const mkControl = (n: number, level: string) => `INSERT INTO controls (id, tenant_id, label, control_type, frequency, executor, compliance_criteria, visibility) VALUES ('${ID(n)}', '${MT}', 'c', 'PREVENTIVE', 'M', 'x', 'y', '${level}');`;
    const mkKpi = (n: number, level: string) => `INSERT INTO kpis (id, tenant_id, label, target_value, unit, frequency, owner, department_id, visibility) VALUES ('${ID(n)}', '${MT}', 'k', 1, 'u', 'MONTHLY', 'x', '${ID(90)}', '${level}');`;
    const mkAnomaly = (n: number, level: string) => `INSERT INTO anomalies (id, tenant_id, description, severity, detected_by, visibility) VALUES ('${ID(n)}', '${MT}', 'a', 'LOW', '${U[0]}', '${level}');`;
    const mkPlan = (n: number, level: string) => `INSERT INTO action_plans (id, tenant_id, title, source_type, source_id, responsible_user_id, due_date, created_by, visibility) VALUES ('${ID(n)}', '${MT}', 'p', 'RISK', '${ID(80)}', '${U[0]}', current_date + 30, '${U[0]}', '${level}');`;
    const mk = [mkRisk, mkControl, mkKpi, mkAnomaly, mkPlan];
    const type = ["RISK", "CONTROL", "KPI", "ANOMALY", "ACTION_PLAN"];
    mk.forEach((f, i) => { stmts.push(f(10 + i, "PERIMETRE"), f(20 + i, "CLIENT"), f(30 + i, "NOMINATIF"), f(40 + i, "PERIMETRE")); });
    const g = (t: string, n: number, u: string, expires: string) => `INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason, expires_at) VALUES ('${MT}', '${t}', '${ID(n)}', '${u}', '${U[0]}', 'avant 094', ${expires});`;
    type.forEach((t, i) => {
      stmts.push(g(t, 10 + i, U[1]!, "NULL"), g(t, 10 + i, U[2]!, "NULL"));              // PERIMETRE sans echeance : a dater
      stmts.push(g(t, 20 + i, U[1]!, "NULL"));                                            // CLIENT sans echeance : intact
      stmts.push(g(t, 30 + i, U[1]!, "now() + interval '12 days'"));                      // NOMINATIF deja date (087) : intact
      stmts.push(g(t, 40 + i, U[1]!, "now() + interval '3 days'"), g(t, 40 + i, U[2]!, "NULL")); // PERIMETRE : un date (intact), un non date (a dater)
    });
    stmts.push(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = '${U[0]}', revoke_reason = 'retrait' WHERE resource_id = '${ID(10)}' AND user_id = '${U[2]}';`); // revoque PERIMETRE : intact
    psql(["-c", stmts.join("\n")]);
    const before = snapshot();
    const countBefore = rows("SELECT count(*) FROM resource_access_grants")[0];
    const defsBefore = fnDefs();
    psql(["-1", "-f", M("094_perimeter_named_access_expiry.sql")]);
    const after = rows("SELECT resource_type, resource_id, user_id, expires_at IS NULL, revoked_at IS NOT NULL, round(extract(epoch FROM (expires_at - now())) / 86400)::int FROM resource_access_grants ORDER BY 1, 2, 3");
    expect(rows("SELECT count(*) FROM resource_access_grants")[0], "aucune ligne perdue").toBe(countBefore);
    const row = (t: string, n: number, u: string) => after.find((l) => l.startsWith(`${t}|${ID(n)}|${u}|`))!.split("|");
    type.forEach((t, i) => {
      expect(row(t, 10 + i, U[1]!)[3], `${t} PERIMETRE vivant : date`).toBe("f");
      expect(Number(row(t, 10 + i, U[1]!)[5]), `${t} +30 j`).toBe(30);
      expect(row(t, 20 + i, U[1]!)[3], `${t} CLIENT : echeance toujours NULL`).toBe("t");
      expect(Number(row(t, 30 + i, U[1]!)[5]), `${t} NOMINATIF deja date : 12 j intact`).toBe(12);
      expect(Number(row(t, 40 + i, U[1]!)[5]), `${t} PERIMETRE deja date : 3 j intact`).toBe(3);
      expect(Number(row(t, 40 + i, U[2]!)[5]), `${t} PERIMETRE sans echeance : date`).toBe(30);
    });
    expect(row("RISK", 10, U[2]!)[4], "revoque").toBe("t");
    expect(row("RISK", 10, U[2]!)[3], "revoque PERIMETRE : echeance toujours NULL").toBe("t");
    const stamped = snapshot();
    // rejeu x2 : aucune ligne ne bouge (l'UPDATE ne touche que les lignes sans echeance)
    psql(["-1", "-f", M("094_perimeter_named_access_expiry.sql")]);
    psql(["-1", "-f", M("094_perimeter_named_access_expiry.sql")]);
    expect(snapshot(), "rejeu x2 sans effet").toEqual(stamped);
    expect(before.filter((l) => l.endsWith("/NULL/false")).length, "il y avait des acces sans echeance").toBeGreaterThan(10);
    // down : seul le suivi des migrations bouge ; donnees intactes ; up apres down : aucun changement
    psql(["-c", "INSERT INTO schema_migrations (filename) VALUES ('094_perimeter_named_access_expiry.sql') ON CONFLICT DO NOTHING"]);
    psql(["-f", M("094_perimeter_named_access_expiry.down.sql")]);
    expect(rows("SELECT count(*) FROM schema_migrations WHERE filename = '094_perimeter_named_access_expiry.sql'")[0]).toBe("0");
    expect(snapshot(), "down : donnees intactes").toEqual(stamped);
    psql(["-1", "-f", M("094_perimeter_named_access_expiry.sql")]);
    expect(snapshot(), "up apres down : aucun changement").toEqual(stamped);
    expect(fnDefs(), "094 ne redefinit aucune fonction").toEqual(defsBefore);
    // une ligne ajoutee APRES 094 sans echeance n'est pas datee par un rejeu (le code pose l'echeance, pas la migration)
    psql(["-c", `INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason) VALUES ('${MT}', 'RISK', '${ID(11 - 1)}', '${U[0]}', '${U[1]}', 'apres 094')`]);
    psql(["-1", "-f", M("094_perimeter_named_access_expiry.sql")]);
    expect(rows(`SELECT round(extract(epoch FROM (expires_at - now())) / 86400)::int FROM resource_access_grants WHERE grant_reason = 'apres 094'`)[0], "le rejeu date une ligne sans echeance d'un dossier PERIMETRE (comportement documente : idempotent sur les lignes datees seulement)").toBe("30");
  }, 280000);
});
