// QA visibilite des ressources, lot V2 : parcours navigateur (Chromium) contre le VRAI backend (tsx, PostgreSQL 16 LOCAL, fournisseur local,
// jamais Neon, jamais Google). Oracles ecrits AVANT l'execution. Comptes <nom>@vv1.test, mot de passe « whatever » (jeu V1 + qa-visibility-v2-seed.sql).
//
// ORACLES
//  1. avant : out voit le controle CLIENT « CANARY-V2-CTL-CLIENT » et le plan CLIENT « CANARY-V2-PLAN-CLIENT » dans leurs ecrans.
//  2. rm restreint le controle (Personnes nommees, motif obligatoire : « Enregistrer » inactif sans motif) puis ajoute `named` a la liste (recherche par nom) ;
//     rm restreint le plan (responsable = own) en Personnes nommees.
//  3. apres : out ne voit plus ni le controle ni le plan (liste de l'ecran) ; GET /controls/:id et /actions/:id = 404 IDENTIQUE a un id inconnu ;
//     named voit le controle (liste) mais pas le plan ; own (responsable du plan) voit son plan et peut ouvrir la carte « Visibilité » avec « Modifier la visibilité » ;
//     own ne voit pas le controle ; com et aud voient les deux.
//  4. anomalie liee a un risque : out voit « CANARY-V2-ANO-RISKCLIENT » (risque 0501 CLIENT) ; rm restreint le risque (API) ; out ne la voit plus
//     (ecran Anomalies), own (proprietaire du risque) la voit ; la carte de l'anomalie (rm) indique qu'elle suit le risque et n'offre pas de bouton de modification.
//  5. anomalie autonome « CANARY-V2-ANO-PERIM » (declarant dept) : dept ouvre la carte, voit « Restreint au périmètre » + « QA named » et PEUT modifier ;
//     out ne la voit pas.
//  6. KPI « CANARY-V2-KPI-PERIM » : out ne la voit pas ; pown la voit ; rm ouvre la carte KPI (niveau + liste).
//  7. zero erreur JS, aucune erreur console imprevue (hors 404 de lecture d'un objet masque).
//
// Prerequis : tests/integration/qa-visibility-v2-setup.sh up grc_qa_vv2p ; QA_PORT=8095 QA_DB=grc_qa_vv2p QA_CORS=http://127.0.0.1:5199 qa-visibility-v2-server.sh start ;
// vite 127.0.0.1:5199 (VITE_AUTH_PROVIDER=local, VITE_API_BASE_URL=http://127.0.0.1:8095). Variables : QA_API, QA_APP, QA_SHOTS, QA_DB.
import { localApi, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");

const API = process.env.QA_API ?? "http://127.0.0.1:8095";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/visibility-v2";
mkdirSync(SHOTS, { recursive: true });
const PSQL = process.env.QA_PSQL ?? "/usr/bin/psql";
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", process.env.QA_DB ?? "grc_qa_vv2p", "-Atq"];
const sql = (q) => execFileSync(PSQL, [...PG, "-c", q], { encoding: "utf8" }).trim();
const I = (x) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const NAMES = ["dept", "out", "own", "named", "pown", "rm", "com", "aud"];
const EMAIL = Object.fromEntries(NAMES.map((n) => [n, `${n}@vv1.test`]));
const CTL = "CANARY-V2-CTL-CLIENT", PLAN = "CANARY-V2-PLAN-CLIENT", ANO = "CANARY-V2-ANO-RISKCLIENT", ANOP = "CANARY-V2-ANO-PERIM", KPI = "CANARY-V2-KPI-PERIM";
const CTL_ID = I("c01"), PLAN_ID = I("a08");

const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const norm = (s) => s.replace(/\s+/g, " ").trim();

// named, dept et rm doivent pouvoir nommer des personnes (annuaire) : droit de lecture des comptes, accorde par SQL (hors perimetre de visibilite).
sql(`update users set roles = roles || '{user.read}' where email in ('rm@vv1.test','dept@vv1.test','own@vv1.test') and not ('user.read' = any(roles))`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
async function open(who) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const page = await context.newPage();
  const st = { page, context, consoleErrors: [], jsErrors: [] };
  page.on("pageerror", (e) => st.jsErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") st.consoleErrors.push(m.text()); });
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await page.goto(APP);
  await page.getByLabel("Adresse e-mail QA").fill(EMAIL[who]);
  await page.getByLabel("Mot de passe QA").fill("whatever");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await nav.waitFor();
  await sleep(800);
  st.go = async (label) => {
    const entry = nav.getByRole("button", { name: new RegExp(`^${label}`) });
    if ((await entry.count()) === 0 || !(await entry.first().isVisible())) {
      for (const g of await nav.locator("button.sidebar-group-toggle").all()) {
        if ((await g.getAttribute("aria-expanded")) !== "true") await g.click();
        if ((await entry.count()) > 0 && (await entry.first().isVisible())) break;
      }
    }
    await nav.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
    await sleep(1400);
  };
  st.text = async () => norm(await page.locator("main").innerText());
  st.shot = (name) => page.screenshot({ path: `${SHOTS}/${who}-${name}.png`, fullPage: true });
  return st;
}

try {
  for (const w of NAMES) await login(w);
  const me = {};
  for (const w of NAMES) me[w] = (await api(w, "GET", "/users/me")).json?.data?.id;
  check("preparation : 8 comptes connectés", Object.values(me).every(Boolean));

  // ---- 1. avant
  const O1 = await open("out");
  await O1.go("Contrôles");
  check("1.1 out voit le contrôle CLIENT avant restriction", (await O1.text()).includes(CTL));
  await O1.go("Plans d'action");
  check("1.2 out voit le plan CLIENT avant restriction", (await O1.text()).includes(PLAN));
  await O1.shot("before-plans");

  // ---- 2. rm restreint le controle puis le plan
  const R = await open("rm");
  await R.go("Contrôles");
  const crow = R.page.locator("tr", { hasText: CTL });
  await crow.getByRole("button", { name: "Visibilité" }).click();
  await sleep(1200);
  await R.page.getByRole("button", { name: "Modifier la visibilité" }).click();
  const save = R.page.getByRole("button", { name: "Enregistrer", exact: true });
  check("2.1 contrôle : « Enregistrer » inactif sans motif", await save.isDisabled());
  await R.page.locator("#control-visibility-level").selectOption("NOMINATIF");
  await R.page.locator("#control-visibility-add").fill("QA nam");
  await R.page.locator(".risk-access-results li", { hasText: "QA named" }).getByRole("button", { name: "Ajouter", exact: true }).click();
  await R.page.locator("#control-visibility-reason").fill("   ");
  check("2.2 contrôle : motif blanc, toujours inactif", await save.isDisabled());
  await R.page.locator("#control-visibility-reason").fill("Contrôle sensible QA");
  await save.click();
  await sleep(1500);
  await R.shot("control-changed");
  const ccard = norm(await R.page.locator("main").innerText());
  check("2.3 contrôle : niveau « Personnes nommées » et QA named listé", /Niveau\s*Personnes nommées/.test(ccard) && /QA named/.test(ccard), ccard.slice(-300));
  check("2.4 base : NOMINATIF + 1 accès actif + audit PERMISSION_CHANGE avec motif", sql(`select visibility from controls where id='${CTL_ID}'`) === "NOMINATIF"
    && sql(`select count(*) from resource_access_grants where resource_id='${CTL_ID}' and revoked_at is null`) === "1"
    && sql(`select reason from audit_log where entity_id::text='${CTL_ID}' and action='PERMISSION_CHANGE' order by timestamp desc limit 1`) === "Contrôle sensible QA");

  await R.go("Plans d'action");
  await R.page.locator("tr", { hasText: PLAN }).getByRole("button", { name: "Visibilité" }).click();
  await sleep(1200);
  await R.page.getByRole("button", { name: "Modifier la visibilité" }).click();
  await R.page.locator("#action-visibility-level").selectOption("NOMINATIF");
  await R.page.locator("#action-visibility-reason").fill("Plan sensible QA");
  await R.page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await sleep(1500);
  await R.shot("plan-changed");
  check("2.5 plan : niveau « Personnes nommées » affiché", /Niveau\s*Personnes nommées/.test(norm(await R.page.locator("main").innerText())));
  check("2.6 base : plan NOMINATIF", sql(`select visibility from action_plans where id='${PLAN_ID}'`) === "NOMINATIF");

  // ---- 3. apres
  const O2 = await open("out");
  await O2.go("Contrôles");
  check("3.1 out : le contrôle a disparu de la liste", !(await O2.text()).includes(CTL));
  await O2.go("Plans d'action");
  check("3.2 out : le plan a disparu de la liste", !(await O2.text()).includes(PLAN));
  await O2.shot("after-plans");
  const hc = await api("out", "GET", `/controls/${CTL_ID}`), uc = await api("out", "GET", `/controls/${I("9ff")}`);
  const hp = await api("out", "GET", `/actions/${PLAN_ID}`), up = await api("out", "GET", `/actions/${I("9ff")}`);
  const strip = (j, id) => JSON.stringify(j).replaceAll(id, "X").replace(/"requestId":"[^"]*"/, "");
  check("3.3 out : GET /controls/:id = 404 identique à un id inconnu", hc.status === 404 && strip(hc.json, CTL_ID) === strip(uc.json, I("9ff")), `${hc.status} ${JSON.stringify(hc.json)}`);
  check("3.4 out : GET /actions/:id = 404 identique à un id inconnu", hp.status === 404 && strip(hp.json, PLAN_ID) === strip(up.json, I("9ff")), `${hp.status} ${JSON.stringify(hp.json)}`);
  check("3.5 out : /visibility du contrôle et du plan = 404", (await api("out", "GET", `/controls/${CTL_ID}/visibility`)).status === 404 && (await api("out", "GET", `/actions/${PLAN_ID}/visibility`)).status === 404);

  const N = await open("named");
  await N.go("Contrôles");
  check("3.6 named (sur la liste) voit le contrôle", (await N.text()).includes(CTL));
  await N.go("Plans d'action");
  check("3.7 named ne voit pas le plan (pas sur sa liste)", !(await N.text()).includes(PLAN));

  const W = await open("own");
  await W.go("Plans d'action");
  check("3.8 own (responsable du plan) voit son plan", (await W.text()).includes(PLAN));
  await W.page.locator("tr", { hasText: PLAN }).getByRole("button", { name: "Visibilité" }).click();
  await sleep(1200);
  await W.shot("owner-plan-card");
  const ocard = norm(await W.page.locator("main").innerText());
  check("3.9 own : la carte affiche « Personnes nommées » et offre « Modifier la visibilité » (propriétaire)", /Niveau\s*Personnes nommées/.test(ocard) && (await W.page.getByRole("button", { name: "Modifier la visibilité" }).count()) === 1, ocard.slice(-250));
  await W.go("Contrôles");
  check("3.10 own ne voit pas le contrôle", !(await W.text()).includes(CTL));
  for (const who of ["com", "aud"]) {
    const S = await open(who);
    await S.go("Contrôles");
    const c = (await S.text()).includes(CTL);
    await S.go("Plans d'action");
    check(`3.11 ${who} voit le contrôle et le plan`, c && (await S.text()).includes(PLAN));
    await S.context.close();
  }

  // ---- 4. anomalie liee a un risque
  await O2.go("Anomalies");
  check("4.1 out voit l'anomalie du risque CLIENT avant restriction", (await O2.text()).includes(ANO));
  const rs = await api("rm", "PUT", `/risks/${I("501")}/visibility`, { visibility: "NOMINATIF", addUserIds: [me.named], revokeUserIds: [], reason: "Risque sensible QA" });
  check("4.2 rm restreint le risque 0501 (API 200)", rs.status === 200, JSON.stringify(rs.json).slice(0, 160));
  const O3 = await open("out");
  await O3.go("Anomalies");
  await O3.shot("anomalies-after-risk");
  const ot = await O3.text();
  check("4.3 out : l'anomalie du risque masqué a disparu (et celles qui citent un contrôle/exécution via ce risque)", !ot.includes(ANO) && !ot.includes("CANARY-V2-ANO-IGNORED-OWN-LEVEL") && !ot.includes("CANARY-V2-ANO-CITES-HIDDEN-CTL"), ot.slice(0, 200));
  const W2 = await open("own");
  await W2.go("Anomalies");
  check("4.4 own (propriétaire du risque) la voit toujours", (await W2.text()).includes(ANO));
  await R.go("Anomalies");
  await R.page.locator("tr", { hasText: ANO }).first().getByRole("button", { name: "Ouvrir" }).click();
  await sleep(1200);
  await R.shot("anomaly-inherits");
  const acard = norm(await R.page.locator("[role=dialog], dialog[open]").first().innerText());
  check("4.5 rm : la carte de l'anomalie indique qu'elle suit son risque, sans bouton de modification", /risque/i.test(acard) && (await R.page.getByRole("button", { name: "Modifier la visibilité" }).count()) === 0, acard.slice(-300));

  await R.page.locator("dialog[open]").getByRole("button", { name: "Fermer" }).first().click();
  await sleep(500);
  // ---- 5. anomalie autonome
  const D = await open("dept");
  await D.go("Anomalies");
  await D.page.locator("tr", { hasText: ANOP }).first().getByRole("button", { name: "Ouvrir" }).click();
  await sleep(1200);
  await D.shot("declarer-card");
  const dcard = norm(await D.page.locator("[role=dialog], dialog[open]").first().innerText());
  check("5.1 dept (déclarant) : « Restreint au périmètre » + QA named, et peut modifier", /Restreint au périmètre/.test(dcard) && /QA named/.test(dcard) && (await D.page.getByRole("button", { name: "Modifier la visibilité" }).count()) === 1, dcard.slice(-300));
  const O4 = await open("out");
  await O4.go("Anomalies");
  check("5.2 out ne voit pas l'anomalie autonome restreinte", !(await O4.text()).includes(ANOP));

  // ---- 6. KPI
  const P = await open("pown");
  await P.go("KPI");
  check("6.1 pown (responsable du processus) voit le KPI restreint au périmètre", (await P.text()).includes(KPI));
  await O4.go("KPI");
  check("6.2 out ne voit pas le KPI restreint", !(await O4.text()).includes(KPI));
  await R.go("KPI");
  await R.page.locator("tr", { hasText: KPI }).first().getByRole("button", { name: /détail/i }).click();
  await sleep(1200);
  await R.shot("kpi-card");
  const kcard = norm(await R.page.locator("main").innerText());
  check("6.3 rm : carte KPI = niveau « Restreint au périmètre » + QA named", /Restreint au périmètre/.test(kcard) && /QA named/.test(kcard), kcard.slice(-300));

  // ---- 7. erreurs
  const all = [O1, R, O2, N, W, O3, W2, D, O4, P];
  const js = all.flatMap((s) => s.jsErrors);
  check("7.1 aucune erreur JS", js.length === 0, js.join(" | ").slice(0, 200));
  const con = all.flatMap((s) => s.consoleErrors).filter((t) => !/404|Failed to load resource/.test(t));
  check("7.2 aucune erreur console imprévue", con.length === 0, con.join(" | ").slice(0, 300));
} catch (e) {
  check("exception du script", false, String(e).slice(0, 600));
} finally {
  await browser.close();
  console.log(`\nECHECS : ${failures()}`);
  process.exit(failures() ? 1 : 0);
}
