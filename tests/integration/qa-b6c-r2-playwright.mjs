// QA niveau 2, B-6c round 2 (DECISION-121) : parcours navigateur. VRAI backend (tsx, PostgreSQL 16 LOCAL 127.0.0.1:55442, jamais Neon).
// Prerequis : base grc_qa_b6c montee par `QA_B6C_LIVE=1 npx vitest run test/QA-B6c.test.ts` (tenants T / C / D, comptes <nom>@b6c.test),
// puis `QA_PORT=8094 QA_DB=grc_qa_b6c bash tests/integration/qa-b6c-server.sh start` et vite sur 5198
// (VITE_API_BASE_URL=http://127.0.0.1:8094 VITE_AUTH_PROVIDER=local). Variables : QA_API, QA_APP, QA_SHOTS, QA_DB.
//
// ORACLES (ecrits avant execution)
//  P1 solo (seul RM du tenant C) : « Confirmer seul » sur une demande ASSIGN_PROCESS PENDING -> fenetre « Confirmer seul le rattachement » + avertissement,
//     un clic ne part PAS au serveur (etat inchange) ; 2e etape : bandeau « Seconde confirmation », bouton « Oui, confirmer seul », motif non modifiable ;
//     2e clic -> 200, bandeau de succes, la demande quitte la liste, base : APPROVED / SOLE_RM / processus rattache.
//  P2 Annuler ou Echap a la 2e etape : rien d'envoye ; la fenetre rouverte repart de l'etape 1.
//  P3 motif d'espaces : le serveur refuse (400) et le message s'affiche DANS la fenetre ; l'utilisateur peut corriger le motif et renvoyer.
//  P4 rm1 (4 RM dans le tenant T) sur sa propre demande : 409 « Un autre Risk Manager peut valider... » affiche dans la fenetre, demande PENDING.
//  P5 rm2 (autre RM) sur la demande de rm1 : 403 « Seul le demandeur... » AFFICHE a l'ecran (pas une fenetre qui se ferme sans rien dire), demande PENDING.
//  P6 Processus : champ « Motif du changement de parent » absent tant que le parent ne change pas, visible apres changement, retire si on revient au parent d'origine ;
//     deplacement vers un autre Dispositif sans motif -> message serveur 400 affiche tel quel, fenetre ouverte, rien d'ecrit ; avec motif -> enregistre, audit ancien/nouveau Dispositif ;
//     meme Dispositif sans motif -> enregistre.
//  P7 zero erreur JS, aucune erreur console imprevue (hors 4xx/5xx provoques).
import { checkNoErrors, finish, localApi, norm, openSession, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const API = process.env.QA_API ?? "http://127.0.0.1:8094";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5198";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/b6c";
mkdirSync(SHOTS, { recursive: true });
const QA_DB = process.env.QA_DB ?? "grc_qa_b6c";
if (!/^[a-z0-9_]+$/.test(QA_DB)) { console.error("QA_DB invalide (a-z, 0-9, _ seulement)"); process.exit(2); }
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", QA_DB, "-Atq"];
const sql = (q) => execFileSync("/usr/bin/psql", [...PG, "-c", q], { encoding: "utf8" }).trim();
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const TC = "dddddddd-0000-4000-8000-000000000001";
const NAMES = ["solo", "rm1", "rm2", "pu"];
const EMAIL = Object.fromEntries(NAMES.map((n) => [n, `${n}@b6c.test`]));
const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const row = (q) => sql(q).split("|");

const fwOf = (tenant, nameLike) => sql(`select id from risk_frameworks where tenant_id = '${tenant}' and name like '${nameLike}' order by created_at limit 1`);
const FC1 = fwOf(TC, "Dispositif r2");
const FB = fwOf(T, "Dispositif B%");
const FA = fwOf(T, "Dispositif A%");
const newProc = (tenant, name, level = "PROCESS", parent = null) =>
  sql(`insert into processes (tenant_id, level, name, parent_id) values ('${tenant}','${level}','${name}',${parent ? `'${parent}'` : "null"}) returning id`).split("\n")[0];
const attach = (id, fw) => { sql(`alter table processes disable trigger processes_framework_guard`); sql(`update processes set risk_framework_id = '${fw}' where id = '${id}'`); sql(`alter table processes enable trigger processes_framework_guard`); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const sessions = [];
const open = async (who) => { const s = await openSession(browser, { app: APP, email: EMAIL[who], shots: SHOTS, who }); sessions.push(s); return s; };
const dialogText = async (s) => norm(await s.page.locator("dialog[open]").innerText().catch(() => ""));
const frameworkDetail = async (s, name) => {
  await s.go("Dispositif de risque");
  await s.page.getByRole("button", { name: new RegExp(`Voir le détail de ${name}`) }).first().click();
  await sleep(1200);
};
const soleRow = (s, reasonText) => s.page.locator("tr", { hasText: reasonText }).getByRole("button", { name: "Confirmer seul" });

try {
  for (const w of NAMES) await login(w);

  // ------------------------------------------------------------------ P1 / P2 / P3 (solo, tenant C)
  const p1 = newProc(TC, "PW solo proc 1");
  const r1 = await api("solo", "POST", `/risk-frameworks/${FC1}/process-assignments`, { processId: p1, reason: "PW-REQ-1 rattachement" });
  check("setup.1 demande creee (201)", r1.status === 201, JSON.stringify(r1.json).slice(0, 120));
  const p3 = newProc(TC, "PW solo proc 3");
  const r3 = await api("solo", "POST", `/risk-frameworks/${FC1}/process-assignments`, { processId: p3, reason: "PW-REQ-3 rattachement" });
  check("setup.2 demande creee (201)", r3.status === 201);

  const solo = await open("solo");
  await frameworkDetail(solo, "Dispositif r2");
  const t0 = await solo.text();
  check("P1.0 les deux demandes en attente sont listees avec « Confirmer seul »", /PW-REQ-1/.test(t0) && (await solo.page.getByRole("button", { name: "Confirmer seul" }).count()) >= 2, t0.slice(0, 160));
  await solo.shot("p1-liste");

  // P2 : annulation a la 2e etape
  await soleRow(solo, "PW-REQ-1").click();
  await sleep(500);
  let d = await dialogText(solo);
  check("P2.1 fenetre « Confirmer seul le rattachement » + avertissement", /Confirmer seul le rattachement/.test(d) && /Confirmation sans second avis/.test(d), d.slice(0, 200));
  await solo.page.locator("#fw-reason-text").fill("Je suis le seul Risk Manager");
  await solo.page.locator("dialog[open] button[type=submit], dialog[open] button:has-text('Confirmer seul')").last().click();
  await sleep(500);
  d = await dialogText(solo);
  const ro = await solo.page.locator("#fw-reason-text").getAttribute("readonly");
  check("P2.2 2e etape : « Seconde confirmation », bouton « Oui, confirmer seul », motif non modifiable", /Seconde confirmation/.test(d) && /Oui, confirmer seul/.test(d) && ro !== null, d.slice(0, 260));
  check("P2.3 rien n'est parti au serveur apres le 1er clic", sql(`select status from risk_framework_change_requests where id = '${r1.json.data.id}'`) === "PENDING");
  await solo.shot("p2-armed");
  await solo.page.keyboard.press("Escape");
  await sleep(500);
  check("P2.4 Echap ferme la fenetre sans rien envoyer", (await solo.page.locator("dialog[open]").count()) === 0 && sql(`select status from risk_framework_change_requests where id = '${r1.json.data.id}'`) === "PENDING");
  await soleRow(solo, "PW-REQ-1").click();
  await sleep(500);
  d = await dialogText(solo);
  const reset = /Confirmation sans second avis/.test(d) && !/Seconde confirmation/.test(d) && (await solo.page.locator("#fw-reason-text").inputValue()) === "";
  check("P2.5 la fenetre rouverte repart de l'etape 1, motif vide", reset, d.slice(0, 200));
  await solo.page.keyboard.press("Escape");
  await sleep(300);

  // P3 : motif d'espaces
  await soleRow(solo, "PW-REQ-3").click();
  await sleep(400);
  await solo.page.locator("#fw-reason-text").fill("     ");
  const submit = () => solo.page.locator("dialog[open] button:has-text('Confirmer seul')").last();
  await submit().click(); // etape 1 (rien n'est envoye)
  await sleep(400);
  await solo.page.locator("dialog[open] button:has-text('Oui, confirmer seul')").click(); // etape 2 -> 400 serveur
  await sleep(1200);
  d = await dialogText(solo);
  check("P3.1 motif d'espaces : le serveur refuse, la fenetre reste ouverte et affiche le message", (await solo.page.locator("dialog[open]").count()) === 1 && /reason|motif|required|Validation|invalid/i.test(d), d.slice(0, 300));
  check("P3.2 base : demande toujours PENDING", sql(`select status from risk_framework_change_requests where id = '${r3.json.data.id}'`) === "PENDING");
  const roAfter = await solo.page.locator("#fw-reason-text").getAttribute("readonly");
  check("P3.3 apres l'erreur le motif est de nouveau modifiable (sinon l'utilisateur est bloque)", roAfter === null, `readonly=${roAfter} ; bouton=${await submit().innerText().catch(() => "?")}`);
  await solo.shot("p3-erreur-espaces");
  await solo.page.keyboard.press("Escape");
  await sleep(300);

  // P1 : confirmation reelle
  await soleRow(solo, "PW-REQ-1").click();
  await sleep(400);
  await solo.page.locator("#fw-reason-text").fill("Je suis le seul Risk Manager du tenant");
  await submit().click();
  await sleep(400);
  await solo.page.locator("dialog[open] button:has-text('Oui, confirmer seul')").click();
  await sleep(1800);
  const t1 = await solo.text();
  check("P1.1 bandeau de succes", /Rattachement confirmé/.test(t1), t1.slice(0, 200));
  check("P1.2 la demande a quitte la liste des demandes en attente", !/PW-REQ-1/.test(t1));
  const st = row(`select status, decision_regime, (decided_by = requested_by), (select risk_framework_id = '${FC1}' from processes where id = '${p1}') from risk_framework_change_requests where id = '${r1.json.data.id}'`);
  check("P1.3 base : APPROVED / SOLE_RM / decideur = demandeur / processus rattache", st.join("|") === "APPROVED|SOLE_RM|t|t", st.join("|"));
  await solo.shot("p1-apres");
  // la demande P3 est toujours la : la confirmer maintenant avec un vrai motif (reprise apres erreur)
  await soleRow(solo, "PW-REQ-3").click();
  await sleep(400);
  await solo.page.locator("#fw-reason-text").fill("Motif valide apres erreur");
  await submit().click();
  await sleep(400);
  await solo.page.locator("dialog[open] button:has-text('Oui, confirmer seul')").click();
  await sleep(1500);
  check("P3.4 la demande P3 est confirmable ensuite", sql(`select status from risk_framework_change_requests where id = '${r3.json.data.id}'`) === "APPROVED");
  // le panneau de sante montre le marqueur
  const healthMarker = sql(`select count(*) from audit_log where tenant_id = '${TC}' and governance_exception = 'riskFramework.soleRiskManager'`);
  check("P1.4 audit marque (>= 4 lignes pour 2 confirmations)", Number(healthMarker) >= 4, healthMarker);
  if (await solo.hasEntry("Santé de la gouvernance")) {
    await solo.go("Santé de la gouvernance");
    await solo.page.getByText(/Exceptions à revoir/).first().click();
    await sleep(800);
    const ht = await solo.text();
    check("P1.5 la sante de la gouvernance affiche le marqueur de la confirmation seul", /riskFramework\.soleRiskManager|seul Risk Manager|sans second avis|soleRiskManager/i.test(ht), ht.slice(0, 400));
    await solo.shot("p1-sante");
  } else check("P1.5 entree « Santé de la gouvernance » disponible", false, "pas d'entree de menu");

  // ------------------------------------------------------------------ P4 / P5 (tenant T, 4 RM)
  const pT = newProc(T, "PW T proc 1");
  const rq = await api("rm1", "POST", `/risk-frameworks/${FB}/process-assignments`, { processId: pT, reason: "PW-REQ-T rattachement" });
  check("setup.3 demande rm1 creee", rq.status === 201, JSON.stringify(rq.json).slice(0, 100));
  const rm1 = await open("rm1");
  await frameworkDetail(rm1, "Dispositif B");
  await soleRow(rm1, "PW-REQ-T").click();
  await sleep(400);
  await rm1.page.locator("#fw-reason-text").fill("Je confirme seul");
  await rm1.page.locator("dialog[open] button:has-text('Confirmer seul')").last().click();
  await sleep(400);
  await rm1.page.locator("dialog[open] button:has-text('Oui, confirmer seul')").click();
  await sleep(1500);
  d = await dialogText(rm1);
  check("P4.1 409 affiche dans la fenetre (« Un autre Risk Manager peut valider »)", /(Un autre Risk Manager peut valider|n.était pas le seul Risk Manager au moment de la demande).*un tiers doit la décider/.test(d) && (await rm1.page.locator("dialog[open]").count()) === 1, d.slice(0, 300));
  check("P4.2 base : demande PENDING, processus non rattache", sql(`select status from risk_framework_change_requests where id = '${rq.json.data.id}'`) === "PENDING" && sql(`select coalesce(risk_framework_id::text,'null') from processes where id = '${pT}'`) === "null");
  await rm1.shot("p4-409");

  const rm2 = await open("rm2");
  await frameworkDetail(rm2, "Dispositif B");
  await soleRow(rm2, "PW-REQ-T").click();
  await sleep(400);
  await rm2.page.locator("#fw-reason-text").fill("Je confirme a sa place");
  await rm2.page.locator("dialog[open] button:has-text('Confirmer seul')").last().click();
  await sleep(400);
  await rm2.page.locator("dialog[open] button:has-text('Oui, confirmer seul')").click();
  await sleep(1500);
  const t5 = await rm2.text();
  const d5 = await dialogText(rm2);
  check("P5.1 403 « Seul le demandeur... » est AFFICHE a l'ecran (fenetre ou page)", /Seul le demandeur/.test(t5 + " " + d5), `dialogue=${d5.slice(0, 120)} | page=${t5.slice(0, 160)}`);
  check("P5.2 base : demande PENDING", sql(`select status from risk_framework_change_requests where id = '${rq.json.data.id}'`) === "PENDING");
  await rm2.shot("p5-403");

  // ------------------------------------------------------------------ P6 Processus (pu)
  const pFB = newProc(T, "PW parent B");
  attach(pFB, FB);
  const pDefA = newProc(T, "PW parent defaut A");
  const pDefB = newProc(T, "PW parent defaut B");
  const sub1 = newProc(T, "PW sous-processus 1", "SUBPROCESS", pDefA);
  const pu = await open("pu");
  await pu.go("Processus");
  const selectSub = async (name) => {
    await pu.page.getByRole("button", { name: new RegExp(`Voir le détail de ${name}`) }).first().click();
    await sleep(700);
    await pu.page.getByRole("button", { name: "Modifier", exact: true }).click();
    await sleep(500);
  };
  await selectSub("PW sous-processus 1");
  const field = pu.page.locator("#proc-move-reason");
  check("P6.1 champ « Motif du changement de parent » absent tant que le parent ne change pas", (await field.count()) === 0);
  await pu.page.locator("#proc-parent").selectOption({ label: "PW parent B (Processus)" });
  await sleep(300);
  check("P6.2 champ visible apres changement de parent", (await field.count()) === 1);
  await pu.page.locator("#proc-parent").selectOption({ label: "PW parent defaut A (Processus)" });
  await sleep(300);
  check("P6.3 champ retire quand on revient au parent d'origine", (await field.count()) === 0);
  await pu.page.locator("#proc-parent").selectOption({ label: "PW parent B (Processus)" });
  await sleep(300);
  await pu.page.locator("dialog[open] button:has-text('Enregistrer')").click(); // sans motif -> 400
  await sleep(1500);
  d = await dialogText(pu);
  check("P6.4 sans motif vers un autre Dispositif : message serveur 400 affiche tel quel, fenetre ouverte", /A reason \(1 to 500 characters\) is required to move a sub-process to another Dispositif/.test(d) && (await pu.page.locator("dialog[open]").count()) === 1, d.slice(0, 300));
  check("P6.5 base : parent inchange, aucun audit", sql(`select parent_id from processes where id = '${sub1}'`) === pDefA && sql(`select count(*) from audit_log where entity_id = '${sub1}' and action = 'UPDATE'`) === "0");
  await pu.shot("p6-400");
  await pu.page.locator("#proc-move-reason").fill("Alignement sur le Dispositif B");
  await pu.page.locator("dialog[open] button:has-text('Enregistrer')").click();
  await sleep(1500);
  check("P6.6 avec motif : enregistre, fenetre fermee", (await pu.page.locator("dialog[open]").count()) === 0 && sql(`select parent_id from processes where id = '${sub1}'`) === pFB);
  const au = row(`select reason, old_value->>'riskFrameworkId', new_value->>'riskFrameworkId', new_value->>'frameworkChanged' from audit_log where entity_id = '${sub1}' and action = 'UPDATE'`);
  check("P6.7 audit : motif, ancien et nouveau Dispositif", au.join("|") === `Alignement sur le Dispositif B|${FA}|${FB}|true`, au.join("|"));
  // meme Dispositif : sans motif
  const sub2 = newProc(T, "PW sous-processus 2", "SUBPROCESS", pDefA);
  await pu.go("Registre").catch(() => undefined);
  await pu.go("Processus");
  await selectSub("PW sous-processus 2");
  await pu.page.locator("#proc-parent").selectOption({ label: "PW parent defaut B (Processus)" });
  await pu.page.locator("dialog[open] button:has-text('Enregistrer')").click();
  await sleep(1500);
  check("P6.8 meme Dispositif sans motif : enregistre", sql(`select parent_id from processes where id = '${sub2}'`) === pDefB);
  // motif d'espaces + changement de Dispositif : le front n'envoie pas de motif (trim) -> 400 serveur
  const sub3 = newProc(T, "PW sous-processus 3", "SUBPROCESS", pDefA);
  await pu.go("Registre").catch(() => undefined);
  await pu.go("Processus");
  await selectSub("PW sous-processus 3");
  await pu.page.locator("#proc-parent").selectOption({ label: "PW parent B (Processus)" });
  await pu.page.locator("#proc-move-reason").fill("      ");
  await pu.page.locator("dialog[open] button:has-text('Enregistrer')").click();
  await sleep(1500);
  d = await dialogText(pu);
  check("P6.9 motif d'espaces : 400 affiche, rien d'ecrit", /reason/i.test(d) && sql(`select parent_id from processes where id = '${sub3}'`) === pDefA, d.slice(0, 200));

  checkNoErrors(check, sessions, "P7");
} catch (e) {
  check("exception du parcours", false, String(e).slice(0, 400));
  for (const s of sessions) await s.shot("exception").catch(() => undefined);
}
await finish(browser, failures);
