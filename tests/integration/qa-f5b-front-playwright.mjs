// QA-F5b : parcours navigateur court du lot F5b (page « Santé de la gouvernance », revue d'exception, acceptation de principe)
// contre le VRAI backend (tsx, PostgreSQL LOCAL 127.0.0.1:55442, fournisseur d'identite local, jamais Neon).
//
// Prerequis (ports propres) :
//   bash tests/integration/qa-visibility-v1-setup.sh up grc_qa_f5b        (utilisateurs adm/rm/aud/out @vv1.test, mot de passe « whatever »)
//   backend : PORT=8297, DATABASE_URL=.../grc_qa_f5b, AUTH_PROVIDER=local, CORS_ALLOWED_ORIGINS=http://127.0.0.1:5397 (voir qa-visibility-v1-server.sh)
//   vite    : 127.0.0.1:5397 avec VITE_API_BASE_URL=http://127.0.0.1:8297 VITE_AUTH_PROVIDER=local
// Le script pose lui-meme les droits et une exception (ligne audit_log marquee) par SQL.
//
// ORACLES (ecrits avant l'execution)
//  1. adm (governancehealth.read + accept + review) : l'entree de menu existe ; « Suivi depuis le <trackedSince de l'API> » ;
//     une ligne par principe de l'API ; chaque libelle de statut correspond au statut API ; aucun « Respecté » sur un NOT_EVALUABLE.
//  2. detail d'un principe : 3 colonnes TPE / PME / Grande entreprise ; taille inconnue -> aucune colonne aria-current.
//  3. acceptation depuis un NOT_RESPECTED : POST 201 corps = { principleId, reason, expiresAt } seulement ; l'API liste l'acceptation (PENDING ou ACTIVE).
//  4. exception : visible dans l'onglet ; « Revoir » -> POST /reviews 201 corps { outcome, comment } ; la ligne passe « Revue ».
//  5. out (aucun droit) : pas d'entree de menu ; l'API renvoie 403. aud (sans droit d'action) : ni « Accepter ce principe » ni « Revoir ».
//  6. aucune erreur JS / console imprevue.
import { checkNoErrors, finish, localApi, openSession, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const { Client } = createRequire(new URL("../../backend/node_modules/", import.meta.url).pathname)("pg");

const API = process.env.QA_API ?? "http://127.0.0.1:8297";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5397";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/f5b";
const DB = process.env.QA_DB ?? "postgres://postgres@127.0.0.1:55442/grc_qa_f5b";
const EMAIL = { adm: "adm@vv1.test", aud: "aud@vv1.test", out: "out@vv1.test" };
const T = "aaaaaaaa-0000-4000-8000-000000000001";
mkdirSync(SHOTS, { recursive: true });

const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const STATUS = { NOT_RESPECTED: /Non respecté/, RESPECTED: /^Respecté|\bRespecté\b/, NOT_EVALUABLE: /Non évaluable/, ACCEPTED: /Accepté/, ALLOWED_BY_SETTING: /Autorisé par un réglage/ };

const db = new Client({ connectionString: DB });
await db.connect();
await db.query(`UPDATE users SET roles = roles || ARRAY['governancehealth.read','governanceprinciple.accept','governanceexception.review'] WHERE email = $1`, [EMAIL.adm]);
await db.query(`UPDATE users SET roles = roles || ARRAY['governancehealth.read'] WHERE email = $1`, [EMAIL.aud]);
await db.query(`DELETE FROM governance_exception_reviews WHERE tenant_id = $1`, [T]).catch(() => undefined);
await db.query(
  `INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, reason, request_id, governance_exception)
   VALUES ($1, 'aaaaaaaa-0000-4000-8000-000000000109', 'Risk', 'aaaaaaaa-0000-4000-8000-000000000501', 'UPDATE', 'Motif QA F5b', 'qa-f5b', 'selfValidation.qa')`, [T]);
await db.end();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const posts = [];
const norm = (s) => s.replace(/\s+/g, " ").trim();
try {
  for (const w of ["adm", "aud", "out"]) await login(w);
  const health = (await api("adm", "GET", "/governance-health")).json.data;

  const A = await openSession(browser, { app: APP, email: EMAIL.adm, shots: SHOTS, who: "adm" });
  A.page.on("response", async (res) => {
    const req = res.request();
    if (req.method() === "POST" && res.url().startsWith(API)) { let body = null; try { body = req.postDataJSON(); } catch { /* none */ } posts.push({ path: new URL(res.url()).pathname, status: res.status(), body }); }
  });
  check("1.1 entrée de menu « Santé de la gouvernance » présente", await A.hasEntry("Santé de la gouvernance"));
  await A.go("Santé de la gouvernance");
  await A.shot("01-liste");
  const text = await A.text();
  check("1.2 « Suivi depuis le <date API> »", text.includes(`Suivi depuis le ${health.trackedSince.slice(0, 10)}`), health.trackedSince);
  const rows = A.page.locator("table tbody tr");
  check("1.3 une ligne par principe de l'API", (await rows.count()) === health.principles.length, `${await rows.count()} / ${health.principles.length}`);
  let ok = true; let detailMsg = "";
  for (const p of health.principles) {
    const t = norm(await rows.filter({ hasText: p.id }).first().innerText());
    if (!STATUS[p.status].test(t)) { ok = false; detailMsg += ` ${p.id}:${p.status}`; }
    if (p.status === "NOT_EVALUABLE" && /(^|\s)Respecté/.test(t)) { ok = false; detailMsg += ` ${p.id}:respecte`; }
  }
  check("1.4 statut affiché = statut API ; jamais « Respecté » si non évaluable", ok, detailMsg);

  const target = health.principles.find((p) => p.status === "NOT_RESPECTED");
  check("préparation : au moins un principe NOT_RESPECTED", !!target);
  await rows.filter({ hasText: target.id }).first().getByRole("button", { name: /Détail/ }).click();
  const dialog = A.page.getByRole("dialog");
  await dialog.waitFor();
  const dt = norm(await dialog.innerText());
  check("2.1 trois colonnes TPE / PME / Grande entreprise", ["TPE", "PME", "Grande entreprise"].every((s) => dt.includes(s)) && (await dialog.locator("details.gh-column").count()) === 3);
  check("2.2 taille inconnue : aucune colonne aria-current", (await dialog.locator("[aria-current]").count()) === 0 && health.organizationSize === null);
  await A.shot("02-detail");

  await dialog.getByRole("button", { name: "Accepter ce principe" }).click();
  await dialog.getByLabel(/Motif de l'acceptation/).fill("Acceptation QA F5b");
  await dialog.getByRole("button", { name: "Enregistrer l'acceptation" }).click();
  await A.page.getByText(/Acceptation enregistrée/).waitFor();
  const acc = posts.find((p) => p.path.endsWith("/governance-principle-acceptances"));
  check("3.1 POST acceptation 201, corps = principleId/reason/expiresAt seulement", acc?.status === 201 && Object.keys(acc.body).sort().join() === "expiresAt,principleId,reason" && acc.body.principleId === target.id, JSON.stringify(acc));
  // l'acceptation reste PENDING tant qu'un tiers ne l'a pas confirmee : le panel ne change qu'a ce moment-la (decision du serveur)
  const created = ((await api("adm", "GET", "/governance-principle-acceptances")).json.data ?? []).find((a) => a.principleId === target.id);
  check("3.2 l'API liste l'acceptation (PENDING ou ACTIVE)", created && ["PENDING", "ACTIVE"].includes(created.status), created?.status);

  // 3.3 acceptation PENDING : mention sur la ligne et dans le détail, plus de bouton « Accepter », statut du principe inchangé
  if (created?.status === "PENDING") {
    const prow = A.page.locator("table tbody tr").filter({ hasText: target.id }).first();
    await prow.getByText(/Acceptation en attente de confirmation par un tiers — demandée le/).waitFor();
    check("3.3 ligne : mention « en attente » + statut « Non respecté » conservé", /Non respecté/.test(await prow.innerText()));
    await prow.getByRole("button", { name: /Détail/ }).click();
    check("3.4 détail : mention + pas de bouton « Accepter »", (await A.page.getByRole("dialog").getByText(/en attente de confirmation par un tiers/).count()) === 1 && (await A.page.getByRole("button", { name: "Accepter ce principe" }).count()) === 0);
    await A.page.getByRole("button", { name: "Fermer" }).click();
  }

  await A.page.getByRole("button", { name: /Exceptions à revoir/ }).click();
  const erow = A.page.locator("table tbody tr").filter({ hasText: "selfValidation.qa" });
  check("4.1 l'exception est listée « À revoir »", (await erow.count()) === 1 && /À revoir/.test(await erow.innerText()));
  await A.shot("03-exceptions");
  await erow.getByRole("button", { name: /Revoir/ }).click();
  const rd = A.page.getByRole("dialog");
  await rd.getByLabel(/Motif/).fill("Revue QA F5b");
  await rd.getByRole("button", { name: "Enregistrer" }).click();
  await A.page.getByText("Exception revue.").waitFor();
  const rev = posts.find((p) => p.path.endsWith("/reviews"));
  check("4.2 POST /reviews 201 corps { outcome, comment }", rev?.status === 201 && Object.keys(rev.body).sort().join() === "comment,outcome" && rev.body.outcome === "REVIEWED", JSON.stringify(rev));
  const erow2 = A.page.locator("table tbody tr").filter({ hasText: "selfValidation.qa" });
  check("4.3 la ligne passe « Revue » et plus de bouton", /Revue/.test(await erow2.innerText()) && (await erow2.getByRole("button").count()) === 0);

  const O = await openSession(browser, { app: APP, email: EMAIL.out, shots: SHOTS, who: "out" });
  check("5.1 out : pas d'entrée de menu", !(await O.hasEntry("Santé de la gouvernance")));
  check("5.2 out : API 403", (await api("out", "GET", "/governance-health")).status === 403);

  const U = await openSession(browser, { app: APP, email: EMAIL.aud, shots: SHOTS, who: "aud" });
  await U.go("Santé de la gouvernance");
  const urows = U.page.locator("table tbody tr");
  const utarget = (await api("aud", "GET", "/governance-health")).json.data.principles.find((p) => p.status === "NOT_RESPECTED");
  if (utarget) {
    await urows.filter({ hasText: utarget.id }).first().getByRole("button", { name: /Détail/ }).click();
    check("5.3 aud : pas de bouton « Accepter ce principe »", (await U.page.getByRole("button", { name: "Accepter ce principe" }).count()) === 0);
    await U.page.getByRole("button", { name: "Fermer" }).click();
  }
  await U.page.getByRole("button", { name: /Exceptions à revoir/ }).click();
  check("5.4 aud : pas de bouton « Revoir »", (await U.page.getByRole("button", { name: /^Revoir/ }).count()) === 0);

  checkNoErrors(check, [A, O, U], "6");
} finally {
  await finish(browser, failures);
}
