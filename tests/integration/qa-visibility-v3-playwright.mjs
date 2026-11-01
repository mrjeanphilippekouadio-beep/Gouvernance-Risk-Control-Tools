// QA visibilite des ressources, lot V3 : parcours navigateur court (Chromium) contre le VRAI backend (tsx, PostgreSQL 16 LOCAL, fournisseur local,
// jamais Neon). Jeu : qa-visibility-v2-setup.sh (jeu V1 + V2). Oracles ecrits AVANT l'execution.
//
// ORACLES
//  1. out (hors perimetre) : sous la liste des Controles « 2 éléments non visibles (accès restreint). » (c02 PERIMETRE + c04 orphelin ; le NOMINATIF c03 n'est pas compte),
//     sous le Registre « 1 élément non visible », sous les Plans d'action et les KPI le nombre de l'API ; chaque nombre = GET /hidden-counts.
//  2. rm : aucune mention « non visible » sous ces listes ; GET /hidden-counts = null.
//  3. com : l'entree « Ressources restreintes » existe, l'ecran liste les ressources restreintes ; l'API ne rend ni userId ni byName du dernier changement ;
//     out n'a pas l'entree et reçoit 403.
//  4. adm (role.assign) attribue le groupe « Groupe Finance QA » a `out` depuis « IAM · Rôles » : SANS motif refus affiche et aucune appartenance ; AVEC motif accepte,
//     `out` lit alors le controle restreint c02 (API), une ligne PERMISSION_CHANGE (through DEPARTMENT_GROUP) porte le motif ; le comptage de out baisse.
//  5. zero erreur JS, aucune erreur console imprevue (hors 4xx attendus).
//
// Prerequis : qa-visibility-v2-setup.sh up grc_qa_vv3p ; QA_PORT=8091 QA_DB=grc_qa_vv3p QA_CORS=http://127.0.0.1:5199 qa-visibility-v2-server.sh start ;
// vite 127.0.0.1:5199 (VITE_AUTH_PROVIDER=local, VITE_API_BASE_URL=http://127.0.0.1:8091). Variables : QA_API, QA_APP, QA_SHOTS, QA_DB.
import { localApi, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const API = process.env.QA_API ?? "http://127.0.0.1:8091";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/visibility-v3";
mkdirSync(SHOTS, { recursive: true });
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", process.env.QA_DB ?? "grc_qa_vv3p", "-Atq"];
const sql = (q) => execFileSync("/usr/bin/psql", [...PG, "-c", q], { encoding: "utf8" }).trim();
const I = (x) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const NAMES = ["adm", "out", "rm", "com"];
const EMAIL = Object.fromEntries(NAMES.map((n) => [n, `${n}@vv1.test`]));
const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const norm = (s) => s.replace(/\s+/g, " ").trim();
const plural = (n) => `${n} élément${n > 1 ? "s" : ""} non visible${n > 1 ? "s" : ""} (accès restreint).`;

// adm porte les droits de gestion des roles (par SQL) ; il ne lit aucune ressource restreinte
sql(`update users set roles = array_remove(roles, 'resourcevisibility.set') where email = 'adm@vv1.test'`);
sql(`update users set roles = roles || '{role.assign,role.read}' where email = 'adm@vv1.test' and not ('role.assign' = any(roles))`);

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
  st.go = async (label) => { const e = await find(label); await e.click(); await sleep(1500); };
  st.text = async () => norm(await page.locator("main").innerText());
  st.shot = (name) => page.screenshot({ path: `${SHOTS}/${who}-${name}.png`, fullPage: true });
  return st;
}

try {
  for (const w of NAMES) await login(w);
  const me = {};
  for (const w of NAMES) me[w] = (await api(w, "GET", "/users/me")).json?.data?.id;
  check("preparation : 4 comptes connectes", Object.values(me).every(Boolean));

  // ---- 1. out : mentions
  const O = await open("out");
  const c = (await api("out", "GET", "/hidden-counts")).json?.data;
  check("1.0 API out : controles 2, risques 1 (NOMINATIF jamais compte)", c?.CONTROL === 2 && c?.RISK === 1, JSON.stringify(c));
  for (const [label, key] of [["Contrôles", "CONTROL"], ["Registre", "RISK"], ["Plans d'action", "ACTION_PLAN"], ["Anomalies", "ANOMALY"], ["KPI", "KPI"]]) {
    await O.go(label);
    const t = await O.text();
    check(`1.${key} out : « ${plural(c[key])} » sous la liste ${label}`, t.includes(plural(c[key])), t.slice(0, 160));
    if (key === "CONTROL") await O.shot("controls-notice");
  }
  check("1.9 les textes ne contiennent aucun identifiant ni libelle restreint", !(await O.text()).includes("CANARY-V2-KPI-PERIM"));

  // ---- 2. rm : rien
  const R = await open("rm");
  check("2.1 rm : GET /hidden-counts = null", (await api("rm", "GET", "/hidden-counts")).json?.data === null);
  for (const label of ["Contrôles", "Registre", "Plans d'action", "KPI"]) {
    await R.go(label);
    check(`2.2 rm : aucune mention « non visible » sous ${label}`, !/non visibles?\b/.test(await R.text()));
  }

  // ---- 3. comite
  const C = await open("com");
  check("3.1 com : entree « Ressources restreintes » presente", await C.hasEntry("Ressources restreintes"));
  await C.go("Ressources restreintes");
  await C.shot("committee-list");
  const ct = await C.text();
  check("3.2 com : l'ecran liste des ressources restreintes", /ressource\(s\) restreinte\(s\)/.test(ct) && ct.includes("CANARY-V2-CTL-PERIM"), ct.slice(0, 200));
  const rowsCom = (await api("com", "GET", "/restricted-resources?limit=500")).json?.data ?? [];
  check("3.3 com : l'API ne rend ni userId ni byName du dernier changement", rowsCom.every((r) => !r.lastChange || (!("userId" in r.lastChange) && !("byName" in r.lastChange))), JSON.stringify(rowsCom.find((r) => r.lastChange)?.lastChange));
  check("3.4 out : pas d'entree de menu et 403", !(await O.hasEntry("Ressources restreintes")) && (await api("out", "GET", "/restricted-resources")).status === 403);

  // ---- 4. attribution du role de departement
  const A = await open("adm");
  await A.go("IAM · Rôles");
  const row = A.page.locator("tr", { hasText: "Groupe Finance QA" });
  await row.getByLabel("Identifiant utilisateur pour le rôle Groupe Finance QA").fill(me.out);
  await row.getByRole("button", { name: "Assigner", exact: true }).click();
  await sleep(1300);
  await A.shot("assign-refused");
  const refused = norm(await A.page.locator("main").innerText());
  check("4.1 sans motif : refus affiche", /A reason \(1 to 500 characters\) is required/.test(refused), refused.slice(0, 200));
  check("4.2 sans motif : aucune appartenance", sql(`select count(*) from user_roles where user_id='${me.out}' and role_id='${I("301")}' and revoked_at is null`) === "0");
  check("4.3 out ne lit toujours pas c02 (API)", (await api("out", "GET", `/controls/${I("c02")}`)).status === 404);
  await A.page.locator("tr", { hasText: "Groupe Finance QA" }).getByLabel("Motif de l'attribution du rôle Groupe Finance QA").fill("Rattachement Finance QA V3");
  await A.page.locator("tr", { hasText: "Groupe Finance QA" }).getByRole("button", { name: "Assigner", exact: true }).click();
  await sleep(1500);
  await A.shot("assign-accepted");
  check("4.4 avec motif : appartenance creee", sql(`select count(*) from user_roles where user_id='${me.out}' and role_id='${I("301")}' and revoked_at is null`) === "1");
  check("4.5 out lit maintenant c02 (API)", (await api("out", "GET", `/controls/${I("c02")}`)).status === 200);
  const pc = sql(`select reason||'|'||(new_value->>'through')||'|'||(new_value->>'widening') from audit_log where entity_id::text='${I("301")}' and action='PERMISSION_CHANGE' order by timestamp desc limit 1`);
  check("4.6 audit PERMISSION_CHANGE avec motif, through DEPARTMENT_GROUP", pc === "Rattachement Finance QA V3|DEPARTMENT_GROUP|true", pc);
  const c2 = (await api("out", "GET", "/hidden-counts")).json?.data;
  check("4.7 le comptage de out baisse (controles 2 -> 1, risques 1 -> 0)", c2?.CONTROL === 1 && c2?.RISK === 0, JSON.stringify(c2));

  const all = [O, R, C, A];
  const js = all.flatMap((s) => s.jsErrors);
  check("5.1 aucune erreur JS", js.length === 0, js.join(" | ").slice(0, 200));
  const con = all.flatMap((s) => s.consoleErrors).filter((x) => !/40[0-9]|Failed to load resource/.test(x));
  check("5.2 aucune erreur console imprevue", con.length === 0, con.join(" | ").slice(0, 300));
} catch (e) {
  check("exception du script", false, String(e).slice(0, 600));
} finally {
  await browser.close();
  console.log(`\nECHECS : ${failures()}`);
  process.exit(failures() ? 1 : 0);
}
