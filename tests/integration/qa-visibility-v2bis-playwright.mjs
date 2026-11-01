// QA visibilite des ressources, lot V2bis (DECISION-107) : parcours navigateur court (Chromium) contre le VRAI backend (tsx, PostgreSQL 16 LOCAL,
// fournisseur local, jamais Neon). Jeu : qa-visibility-v2-setup.sh (jeu V1 + V2). Oracles ecrits AVANT l'execution.
//
// ORACLES
//  1. rm : l'entree de menu « Ressources restreintes » existe ; l'ecran liste des ressources restreintes (CANARY-V2-PLAN-PERIM, CANARY-V2-CTL-PERIM, CANARY-V2-KPI-PERIM,
//     CANARY-PERIM-DESC) avec leur niveau, jamais une ressource CLIENT (CANARY-V2-PLAN-CLIENT) ; compteur « N ressource(s) restreinte(s) » = longueur de l'API.
//  2. dept, out, com, aud : pas d'entree de menu ; GET /restricted-resources = 403 pour chacun.
//  3. dept (groupe Finance, lit le plan restreint CANARY-V2-PLAN-PERIM) ouvre « RACI », choisit `out` : « Ajouter » sans motif est REFUSE (message affiche, aucune ligne RACI) ;
//     avec un motif il est ACCEPTE ; `out` lit alors le plan (API) ; une ligne PERMISSION_CHANGE (through RACI) porte le motif.
//  4. rm : la cloche affiche « Une affectation RACI a ouvert la lecture d'un plan d'action restreint. » ; dept : aucune notification de ce type.
//  5. un RACI sur une ressource non restreinte (plan CLIENT) s'ajoute SANS motif.
//  6. zero erreur JS, aucune erreur console imprevue (hors 4xx attendus).
//
// Prerequis : qa-visibility-v2-setup.sh up grc_qa_vv2bp ; QA_PORT=8093 QA_DB=grc_qa_vv2bp QA_CORS=http://127.0.0.1:5199 qa-visibility-v2-server.sh start ;
// vite 127.0.0.1:5199 (VITE_AUTH_PROVIDER=local, VITE_API_BASE_URL=http://127.0.0.1:8093). Variables : QA_API, QA_APP, QA_SHOTS, QA_DB.
import { localApi, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const API = process.env.QA_API ?? "http://127.0.0.1:8093";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/visibility-v2bis";
mkdirSync(SHOTS, { recursive: true });
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", process.env.QA_DB ?? "grc_qa_vv2bp", "-Atq"];
const sql = (q) => execFileSync("/usr/bin/psql", [...PG, "-c", q], { encoding: "utf8" }).trim();
const I = (x) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const NAMES = ["dept", "out", "own", "rm", "com", "aud"];
const EMAIL = Object.fromEntries(NAMES.map((n) => [n, `${n}@vv1.test`]));
const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const norm = (s) => s.replace(/\s+/g, " ").trim();
const PLAN = "CANARY-V2-PLAN-PERIM", PLAN_ID = I("a06"), CLIENT_PLAN = "CANARY-V2-PLAN-CLIENT", CLIENT_ID = I("a08");

// dept doit pouvoir poser un RACI et lister les comptes : droits accordes par SQL (il lit deja le plan par le groupe Finance)
sql(`update users set roles = roles || '{raci.assign,raci.revoke,user.read}' where email = 'dept@vv1.test' and not ('raci.assign' = any(roles))`);

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
  // le menu est un accordeon : on ouvre les groupes un a un jusqu'a trouver l'entree
  const find = async (label) => {
    const entry = nav.getByRole("button", { name: new RegExp(`^${label}`) });
    if ((await entry.count()) > 0 && (await entry.first().isVisible())) return entry.first();
    for (const g of await nav.locator("button.sidebar-group-toggle").all()) {
      if ((await g.getAttribute("aria-expanded")) !== "true") await g.click();
      if ((await entry.count()) > 0 && (await entry.first().isVisible())) return entry.first();
    }
    return null;
  };
  st.hasEntry = async (label) => (await find(label)) !== null;
  st.go = async (label) => { const e = await find(label); await e.click(); await sleep(1400); };
  st.text = async () => norm(await page.locator("main").innerText());
  st.shot = (name) => page.screenshot({ path: `${SHOTS}/${who}-${name}.png`, fullPage: true });
  return st;
}

try {
  for (const w of NAMES) await login(w);
  const me = {};
  for (const w of NAMES) me[w] = (await api(w, "GET", "/users/me")).json?.data?.id;
  check("preparation : 6 comptes connectes", Object.values(me).every(Boolean));

  // ---- 1. RM : menu + ecran
  const R = await open("rm");
  check("1.1 rm : l'entree « Ressources restreintes » existe", await R.hasEntry("Ressources restreintes"));
  await R.go("Ressources restreintes");
  await R.shot("list");
  const t = await R.text();
  const apiRows = (await api("rm", "GET", "/restricted-resources")).json?.data ?? [];
  check("1.2 l'ecran liste plan, controle, KPI et risque restreints", [PLAN, "CANARY-V2-CTL-PERIM", "CANARY-V2-KPI-PERIM", "CANARY-PERIM-DESC"].every((c) => t.includes(c)), t.slice(0, 300));
  check("1.3 aucune ressource CLIENT n'est listee", !t.includes(CLIENT_PLAN) && !t.includes("CANARY-V2-CTL-CLIENT"));
  check("1.4 le compteur affiche la longueur de la liste de l'API", t.includes(`${apiRows.length} ressource(s) restreinte(s)`), `${apiRows.length}`);
  check("1.5 niveaux affiches (Restreint au perimetre / Personnes nommees)", /Restreint au périmètre/.test(t) && /Personnes nommées/.test(t));

  // ---- 2. non RM
  for (const w of ["dept", "out", "com", "aud"]) {
    const S = await open(w);
    check(`2.1 ${w} : pas d'entree de menu`, !(await S.hasEntry("Ressources restreintes")));
    check(`2.2 ${w} : GET /restricted-resources = 403`, (await api(w, "GET", "/restricted-resources")).status === 403);
    await S.context.close();
  }

  // ---- 3. RACI sans motif refuse puis accepte
  const D = await open("dept");
  await D.go("Plans d'action");
  await D.page.locator("tr", { hasText: PLAN }).getByRole("button", { name: "RACI" }).click();
  await sleep(1200);
  await D.page.locator("#raci-user").selectOption({ label: "QA out (out@vv1.test)" });
  check("3.1 l'aide du champ Motif est affichee", /Demandé si cette personne ne voit pas encore une ressource restreinte/.test(norm(await D.page.locator("main").innerText())));
  const add = D.page.getByRole("button", { name: "Ajouter", exact: true });
  await add.click();
  await sleep(1200);
  await D.shot("raci-refused");
  const refused = norm(await D.page.locator("main").innerText());
  check("3.2 sans motif : refus affiche", /A reason \(1 to 500 characters\) is required/.test(refused), refused.slice(-250));
  check("3.3 sans motif : aucune ligne RACI creee", sql(`select count(*) from raci_assignments where entity_id='${PLAN_ID}' and user_id='${me.out}'`) === "0");
  await D.page.locator("#raci-reason").fill("Besoin QA V2bis");
  await D.page.locator("#raci-user").selectOption({ label: "QA out (out@vv1.test)" });
  await D.page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await sleep(1500);
  await D.shot("raci-accepted");
  check("3.4 avec motif : ligne RACI creee", sql(`select count(*) from raci_assignments where entity_id='${PLAN_ID}' and user_id='${me.out}' and deleted_at is null`) === "1");
  check("3.5 out lit maintenant le plan (API)", (await api("out", "GET", `/actions/${PLAN_ID}`)).status === 200);
  const pc = sql(`select reason||'|'||(new_value->>'through')||'|'||(new_value->>'widening') from audit_log where entity_id::text='${PLAN_ID}' and action='PERMISSION_CHANGE' order by timestamp desc limit 1`);
  check("3.6 audit PERMISSION_CHANGE avec motif, through RACI, widening", pc === "Besoin QA V2bis|RACI|true", pc);

  // ---- 4. notification RM
  await R.page.getByRole("button", { name: /^Notifications/ }).click();
  await sleep(1200);
  const modal = norm(await R.page.locator("dialog[open], [role=dialog]").first().innerText());
  await R.shot("notif");
  check("4.1 rm : la cloche affiche l'ouverture par affectation RACI", /Une affectation RACI a ouvert la lecture d.un plan d.action restreint/.test(modal), modal.slice(0, 250));
  check("4.2 la notification ne contient pas le titre du plan", !modal.includes(PLAN));
  check("4.3 base : dept (auteur) n'a aucune notification de ce type", sql(`select count(*) from notifications where recipient_user_id='${me.dept}' and event_type='ACTION_PLAN_VISIBILITY_WIDENED'`) === "0");

  // ---- 5. non restreint : sans motif
  await D.go("Plans d'action");
  await D.page.locator("tr", { hasText: CLIENT_PLAN }).getByRole("button", { name: "RACI" }).click();
  await sleep(1200);
  await D.page.locator("#raci-user").selectOption({ label: "QA out (out@vv1.test)" });
  await D.page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await sleep(1300);
  check("5.1 plan CLIENT : RACI ajoute sans motif", sql(`select count(*) from raci_assignments where entity_id='${CLIENT_ID}' and user_id='${me.out}' and deleted_at is null`) === "1");
  check("5.2 aucun PERMISSION_CHANGE pour ce plan", sql(`select count(*) from audit_log where entity_id::text='${CLIENT_ID}' and action='PERMISSION_CHANGE'`) === "0");

  const all = [R, D];
  const js = all.flatMap((s) => s.jsErrors);
  check("6.1 aucune erreur JS", js.length === 0, js.join(" | ").slice(0, 200));
  const con = all.flatMap((s) => s.consoleErrors).filter((x) => !/40[0-9]|Failed to load resource/.test(x));
  check("6.2 aucune erreur console imprevue", con.length === 0, con.join(" | ").slice(0, 300));
} catch (e) {
  check("exception du script", false, String(e).slice(0, 600));
} finally {
  await browser.close();
  console.log(`\nECHECS : ${failures()}`);
  process.exit(failures() ? 1 : 0);
}
