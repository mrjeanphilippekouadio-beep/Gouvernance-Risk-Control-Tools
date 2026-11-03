// QA visibilite des ressources, lot V4 : parcours navigateur court (Chromium) contre le VRAI backend (tsx, PostgreSQL 16 LOCAL, fournisseur local,
// jamais Neon). Jeu : qa-visibility-v2-setup.sh (jeu V1 + V2). Oracles ecrits AVANT l'execution.
//
// ORACLES
//  1. A1 : adm (administrateur, droits directs) ouvre « Ressources restreintes » : la liste n'a ni libelle (« Contenu non consultable »), ni CANARY, ni dernier changement ;
//     l'API ne rend que type, id, visibility, accessCount, updatedAt. out (administrateur par role) : meme chose, et la liste « Controles » affiche « non visibles ».
//  2. Circuit dans « Matrice des droits » > onglet « Vue elargie du Risk Manager » > carte « Lecture de tous les contenus » : adm demande pour « QA out » avec motif
//     (ligne « En attente de confirmation »), com (Comite) confirme (ligne « Active »). Avant confirmation out ne lit toujours rien (API 404).
//  3. out apres confirmation (DECISION-111) : « Ressources restreintes » reste en metadonnees (q219 : liste complete reservee aux groupes fixes) ; la liste
//     « Controles » n'affiche plus aucune mention « non visible » ; GET /hidden-counts reste numerique ; le PERIMETRE c02 se lit, le NOMINATIF c03 non (404) ;
//     la lecture de c02 ecrit une ligne READ (q220) ; le badge GRANT (resource.readall) apparait dans « Droits d'un compte » pour adm.
//  4. adm retire le droit avec motif : ligne « Retirée », out revient aux metadonnees (API) et la mention « non visible » reapparait.
//  5. q215 : la consigne « Ne nommez pas la personne concernée » est VISIBLE (texte de page, pas seulement une infobulle) sur « IAM · Rôles » (champ Motif de l'attribution) .
//  6. zero erreur JS, aucune erreur console imprevue (hors 4xx attendus).
//
// Prerequis : qa-visibility-v2-setup.sh up grc_qa_vv4p ; QA_PORT=8091 QA_DB=grc_qa_vv4p QA_CORS=http://127.0.0.1:5199 qa-visibility-v2-server.sh start ;
// vite 127.0.0.1:5199 (VITE_AUTH_PROVIDER=local, VITE_API_BASE_URL=http://127.0.0.1:8091). Variables : QA_API, QA_APP, QA_SHOTS, QA_DB.
import { checkNoErrors, finish, localApi, openSession, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const API = process.env.QA_API ?? "http://127.0.0.1:8091";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/visibility-v4";
mkdirSync(SHOTS, { recursive: true });
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", process.env.QA_DB ?? "grc_qa_vv4p", "-Atq"];
const sql = (q) => execFileSync("/usr/bin/psql", [...PG, "-c", q], { encoding: "utf8" }).trim();
const I = (x) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const NAMES = ["adm", "out", "com"];
const EMAIL = Object.fromEntries(NAMES.map((n) => [n, `${n}@vv1.test`]));
const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const T = I("001");

// adm : droits de gestion des roles (directs) ; out : administrateur PAR ROLE (ce que lit la regle SQL) ; aucun des deux ne lit de ressource restreinte
sql(`update users set roles = array_remove(roles, 'resourcevisibility.set') where email = 'adm@vv1.test'`);
sql(`update users set roles = roles || '{role.assign,role.read,role.create,role.update}' where email = 'adm@vv1.test' and not ('role.assign' = any(roles))`);
sql(`insert into roles (id, tenant_id, name, permissions) values ('${I("311")}', '${T}', 'QA Admins', '{role.assign,role.read,user.update}'), ('${I("313")}', '${T}', 'QA Plain', '{risk.read}') on conflict do nothing`);
sql(`insert into user_roles (tenant_id, role_id, user_id, granted_by) select '${T}', r, '${I("107")}', '${I("10c")}' from unnest(array['${I("311")}','${I("313")}']::uuid[]) r where not exists (select 1 from user_roles where role_id = r and user_id = '${I("107")}')`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const open = (who) => openSession(browser, { app: APP, email: EMAIL[who], shots: SHOTS, who });
const card = (s) => s.page.locator(`xpath=//h2[normalize-space()="Lecture de tous les contenus"]/..`);
const openViews = async (s) => {
  await s.go("Matrice des droits");
  const tab = s.page.getByRole("button", { name: "Vue élargie du Risk Manager" }); // absent sans role.read : l'ecran s'ouvre deja sur cet onglet
  if ((await tab.count()) > 0) await tab.click();
  await sleep(1200);
};

try {
  for (const w of NAMES) await login(w);

  // ---- 1. A1
  const A = await open("adm");
  await A.go("Ressources restreintes");
  await A.shot("a1-metadata");
  const t1 = await A.text();
  check("1.1 adm : l'ecran liste des ressources restreintes", /ressource\(s\) restreinte\(s\)/.test(t1), t1.slice(0, 160));
  check("1.2 adm : aucun libelle (« Contenu non consultable »), aucun CANARY", t1.includes("Contenu non consultable") && !t1.includes("CANARY"), t1.slice(0, 260));
  const meta = (await api("adm", "GET", "/restricted-resources?limit=500")).json?.data ?? [];
  check("1.3 adm : l'API ne rend que type, id, visibility, accessCount, updatedAt", meta.length > 0 && meta.every((r) => Object.keys(r).sort((x, y) => x.localeCompare(y)).join() === "accessCount,id,type,updatedAt,visibility"), JSON.stringify(meta[0]));
  check("1.4 adm : le contenu restreint reste illisible (404)", (await api("adm", "GET", `/controls/${I("c02")}`)).status === 404);
  const O = await open("out");
  await O.go("Contrôles");
  const noticeBefore = await O.text();
  check("1.5 out (administrateur par role) : mention « non visibles » sous les controles", /non visibles?\b/.test(noticeBefore), noticeBefore.slice(0, 200));
  check("1.6 out : hidden-counts numerique avant le droit", (await api("out", "GET", "/hidden-counts")).json?.data !== null);

  // ---- 2. circuit
  await openViews(A);
  const c = card(A);
  await c.getByLabel("Administrateur").selectOption({ label: "QA out" });
  await c.getByLabel("Motif").fill("Support : enquête incident QA V4");
  await c.getByRole("button", { name: "Demander", exact: true }).click();
  await sleep(1500);
  await A.shot("circuit-requested");
  check("2.1 adm : ligne « En attente de confirmation » pour QA out", /QA out[\s\S]*En attente de confirmation/.test(await c.innerText()), (await c.innerText()).slice(0, 300));
  check("2.2 avant confirmation out ne lit toujours rien (API 404)", (await api("out", "GET", `/controls/${I("c03")}`)).status === 404);
  const C = await open("com");
  await openViews(C);
  await card(C).getByRole("button", { name: "Confirmer", exact: true }).click();
  await sleep(1500);
  await C.shot("circuit-confirmed");
  check("2.3 com : la ligne passe a « Active »", /Active/.test(await card(C).innerText()), (await card(C).innerText()).slice(0, 300));

  // ---- 3. effet
  await O.go("Ressources restreintes");
  await O.shot("out-after");
  const t3 = await O.text();
  check("3.1 out : la liste reste en metadonnees (q219), aucun libelle", !t3.includes("CANARY") && t3.includes("Contenu non consultable"), t3.slice(0, 200));
  await O.go("Contrôles");
  check("3.2 out : plus aucune mention « non visible » sous les controles", !/non visibles?\b/.test(await O.text()));
  check("3.3 out : hidden-counts numerique, PERIMETRE c02 lisible, NOMINATIF c03 ferme (q219)", (await api("out", "GET", "/hidden-counts")).json?.data !== null
    && (await api("out", "GET", `/controls/${I("c02")}`)).status === 200 && (await api("out", "GET", `/controls/${I("c03")}`)).status === 404);
  check("3.3b la lecture de c02 grace au droit ecrit une ligne READ (q220)", Number(sql(`select count(*) from audit_log where action = 'READ' and user_id = '${I("107")}' and entity_id::text = '${I("c02")}'`)) > 0);
  await A.go("Matrice des droits");
  await A.page.getByRole("button", { name: "Droits d'un compte" }).click();
  await sleep(800);
  await A.page.locator("select").first().selectOption({ label: "QA out" }).catch(() => {});
  await sleep(1500);
  await A.shot("badge");
  const tb = await A.text();
  check("3.4 adm : « Droits d'un compte » de QA out affiche resource.readall avec la source GRANT", /resource\.readall|Lecture de tous les contenus/.test(tb) && /Vue élargie confirmée/.test(tb), tb.slice(0, 300));

  // ---- 4. retrait
  await openViews(A);
  await card(A).getByLabel("Motif").fill("Incident clos QA V4");
  await card(A).getByRole("button", { name: "Retirer", exact: true }).first().click();
  await sleep(1500);
  await A.shot("revoked");
  check("4.1 adm : la ligne passe a « Retirée »", /Retirée/.test(await card(A).innerText()), (await card(A).innerText()).slice(0, 300));
  const back = (await api("out", "GET", "/restricted-resources?limit=500")).json?.data ?? [];
  check("4.2 out revient aux metadonnees seules (API) et c03 redevient illisible", back.length > 0 && back.every((r) => !("label" in r)) && (await api("out", "GET", `/controls/${I("c03")}`)).status === 404);
  await O.go("Ressources restreintes"); // quitter l'ecran avant de revenir : le menu ne recharge pas l'ecran deja ouvert
  await O.go("Contrôles");
  check("4.3 out : la mention « non visibles » reapparait", /non visibles?\b/.test(await O.text()));

  // ---- 5. q215 consigne
  await A.go("IAM · Rôles");
  const roles = await A.text();
  check("5.1 « Ne nommez pas » visible sur IAM · Rôles (QA-V4-03)", roles.includes("Ne nommez pas"));
  await A.shot("roles-hint");

  checkNoErrors(check, [A, O, C], "6");
} catch (e) {
  check("exception du script", false, String(e).slice(0, 600));
} finally {
  await finish(browser, failures);
}
