// QA niveau 2, B-13 (Dispositifs par defaut) : parcours navigateur. VRAI backend (tsx, PostgreSQL 16 LOCAL 127.0.0.1:55442, jamais Neon).
// Le script monte lui-meme la base `grc_qa_b13ui` (qa-visibility-v1-setup.sh), le serveur (qa-b6c-server.sh, port 8095) et attend vite sur 5198
// (VITE_API_BASE_URL=http://127.0.0.1:8095 VITE_AUTH_PROVIDER=local). Variables : QA_APP, QA_SHOTS.
//
// ORACLES (ecrits avant execution)
//  U1 liste vide : « Charger les modèles par défaut » visible ; clic -> bandeau « Modèles créés en brouillon : Tranché, Standard, Renforcé », trois lignes avec descriptif,
//     le bouton disparait ; aucun « Léger » / « Prudent » (mots entiers) dans toute la page, y compris les fenetres ; seconde charge impossible (bouton absent).
//  U2 valeurs : le detail de chaque Dispositif montre les seuils Comite du document (Tranché 9, Standard 15, Renforcé 15) et le seuil bas (3, 4, 3).
//  U3 activation de Standard par l'ecran (rm1 demande, rm2 approuve) : badge « Par défaut » sur Standard dans la liste et dans le detail ; Tranché et Renforcé sans badge.
//  U4 SET_DEFAULT : « Définir par défaut » absent sur le defaut, present sur Tranché ; la demande part (bandeau), apparait dans « Demandes en attente » (« Changement du Dispositif par défaut ») SANS
//     bouton « Confirmer seul » ; rm1 ne peut pas l'approuver (refus affiche) ; rm2 approuve : badge sur Tranché, plus sur Standard, un seul badge.
//  U5 archivage : sur le defaut, refus du serveur affiche dans la fenetre (fenetre ouverte) ; motif d'espaces refuse affiche ; Renforcé archive avec un motif (bandeau, mention « Archivé », badge de statut) ;
//     Standard avec un processus vivant rattache : refus affiche ; plus de bouton « Archiver » sur un Dispositif deja archive.
//  U6 zero erreur JS, aucune erreur console imprevue (hors 4xx provoques).
import { checkNoErrors, finish, localApi, norm, openSession, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.QA_APP ?? "http://127.0.0.1:5198";
const API = "http://127.0.0.1:8095";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/b13";
mkdirSync(SHOTS, { recursive: true });
const DBN = "grc_qa_b13ui";
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", DBN, "-Atq"];
const sql = (q) => execFileSync("/usr/bin/psql", [...PG, "-c", q], { encoding: "utf8" }).trim();
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const { check, failures } = verdicts();
const EMAIL = { rm1: "rm1@b6c.test", rm2: "rm2@b6c.test", plain: "plain@b6c.test" };
const { login, api } = localApi(API, EMAIL);

execFileSync("/bin/bash", [join(HERE, "qa-visibility-v1-setup.sh"), "up", DBN], { stdio: "ignore" });
const RM = sql(`select id from roles where tenant_id = '${T}' and system_group = 'RISK_MANAGER'`);
const granter = sql(`select id from users where email = 'adm@vv1.test'`);
const mk = (n, perms = "{}") => sql(`insert into users (tenant_id, email, display_name, roles) values ('${T}','${n}@b6c.test','${n}','${perms}') returning id`).split("\n")[0];
for (const n of ["rm1", "rm2"]) { const id = mk(n); sql(`insert into user_roles (tenant_id, role_id, user_id, granted_by) values ('${T}','${RM}','${id}','${granter}')`); }
mk("plain", "{risk.read,riskframework.read}");
const env = { ...process.env, QA_PORT: "8095", QA_DB: DBN };
execFileSync("/bin/bash", [join(HERE, "qa-b6c-server.sh"), "start"], { env, stdio: "ignore" });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const sessions = [];
const open = async (who) => { const s = await openSession(browser, { app: APP, email: EMAIL[who], shots: SHOTS, who }); sessions.push(s); return s; };
const dialogText = async (s) => norm(await s.page.locator("dialog[open]").innerText().catch(() => ""));
const BAD = /\bL[ée]ger\b|\bPrudent\b/;
const row = (s, name) => s.page.locator("tr", { has: s.page.locator(`strong:text-is("${name}")`) });
const detail = async (s, name) => { await s.page.getByRole("button", { name: new RegExp(`Voir le détail de ${name}`) }).first().click(); await sleep(1200); };
const fill = async (s, text, submit) => {
  await s.page.locator("#fw-reason-text").fill(text);
  await s.page.locator("dialog[open] button", { hasText: submit }).last().click();
  await sleep(1500);
};
let rm1, rm2;
try {
  await login("rm1"); await login("rm2");
  rm1 = await open("rm1");
  await rm1.go("Dispositif de risque");

  // ---------------------------------------------------------------- U1
  const prov = rm1.page.getByRole("button", { name: "Charger les modèles par défaut" });
  check("U1.1 liste vide : bouton « Charger les modèles par défaut » visible", (await prov.count()) === 1);
  await prov.click();
  await sleep(2000);
  let t = await rm1.text();
  check("U1.2 bandeau « Modèles créés en brouillon : Tranché, Standard, Renforcé »", /Modèles créés en brouillon : Tranché, Standard, Renforcé/.test(t), t.slice(0, 200));
  check("U1.3 les trois Dispositifs avec leur descriptif", /Tranché/.test(t) && /Standard/.test(t) && /Renforcé/.test(t) && /4 niveaux, pas de niveau du milieu/.test(t) && /5 niveaux, l'échelle classique/.test(t) && /6 niveaux, pas de milieu/.test(t), t.slice(0, 400));
  check("U1.4 le bouton de chargement a disparu (trois modeles presents)", (await rm1.page.getByRole("button", { name: "Charger les modèles par défaut" }).count()) === 0);
  check("U1.5 aucun « Léger » ni « Prudent » (mots entiers) dans la page", !BAD.test(await rm1.page.locator("body").innerText()));
  await rm1.shot("u1-liste");

  // ---------------------------------------------------------------- U2 valeurs affichees
  const seen = {};
  for (const [n, committee, low] of [["Tranché", "9", "3"], ["Standard", "15", "4"], ["Renforcé", "15", "3"]]) {
    await detail(rm1, n);
    await rm1.page.getByRole("button", { name: /^Voir la version 1/ }).first().click().catch(() => undefined);
    await sleep(800);
    const txt = await rm1.text();
    seen[n] = txt;
    check(`U2 ${n} : seuil Comité ${committee} et seuil bas ${low} affichés avec la version`, new RegExp(`(Comité|comité)[^.]{0,80}\\b${committee}\\b`).test(txt) && new RegExp(`(bas|faible|Faible|criticité)[^.]{0,80}\\b${low}\\b`, "i").test(txt), txt.slice(txt.indexOf("Version v1"), txt.indexOf("Version v1") + 500));
    check(`U2 ${n} : aucun « Léger » / « Prudent » dans le detail`, !BAD.test(txt));
    await rm1.shot(`u2-${n}`);
  }

  // ---------------------------------------------------------------- U3 activation de Standard par l'ecran
  await rm1.go("Registre").catch(() => undefined);
  await rm1.go("Dispositif de risque");
  await detail(rm1, "Standard");
  await rm1.page.getByRole("button", { name: /Demander l'activation de v1/ }).click();
  await sleep(500);
  await fill(rm1, "Mise en service du Dispositif Standard", "Envoyer la demande");
  rm2 = await open("rm2");
  await rm2.go("Dispositif de risque");
  await detail(rm2, "Standard");
  await rm2.page.locator("tr", { hasText: "Mise en service" }).getByRole("button", { name: "Approuver" }).click();
  await sleep(500);
  await fill(rm2, "ok", "Approuver");
  await rm2.go("Registre").catch(() => undefined);
  await rm2.go("Dispositif de risque");
  const badge = async (s, name) => (await row(s, name).getByText("Par défaut", { exact: true }).count()) > 0;
  check("U3.1 badge « Par défaut » sur Standard dans la liste", await badge(rm2, "Standard"));
  check("U3.2 Tranché et Renforcé sans badge", !(await badge(rm2, "Tranché")) && !(await badge(rm2, "Renforcé")));
  await detail(rm2, "Standard");
  check("U3.3 badge dans le detail de Standard", (await rm2.page.locator("header, .card, section").filter({ hasText: "Standard" }).getByText("Par défaut", { exact: true }).count()) > 0);
  check("U3.4 base : Standard est le defaut, une seule ligne", sql(`select name from risk_frameworks where tenant_id = '${T}' and is_default and archived_at is null`) === "Standard");
  await rm2.shot("u3-standard-defaut");

  // Tranché and Renforcé activated through the API (circuit already shown for Standard)
  for (const n of ["Tranché", "Renforcé"]) {
    const fw = sql(`select id from risk_frameworks where tenant_id = '${T}' and name = '${n}'`);
    const vid = sql(`select id from risk_framework_versions where framework_id = '${fw}'`);
    const rq = await api("rm1", "POST", `/risk-frameworks/${fw}/versions/${vid}/activation-requests`, { reason: `Activation ${n}` });
    await api("rm2", "POST", `/risk-frameworks/change-requests/${rq.json.data.id}/approve`, {});
  }

  // ---------------------------------------------------------------- U4 SET_DEFAULT
  await rm1.go("Registre").catch(() => undefined);
  await rm1.go("Dispositif de risque");
  await detail(rm1, "Standard");
  check("U4.1 « Définir par défaut » absent sur le Dispositif par défaut", (await rm1.page.getByRole("button", { name: /Définir Standard comme Dispositif par défaut/ }).count()) === 0);
  await detail(rm1, "Tranché");
  const sd = rm1.page.getByRole("button", { name: /Définir Tranché comme Dispositif par défaut/ });
  check("U4.2 « Définir par défaut » présent sur Tranché", (await sd.count()) === 1);
  await sd.click();
  await sleep(500);
  let d = await dialogText(rm1);
  check("U4.3 fenêtre « Définir comme Dispositif par défaut » avec rappel du tiers et de l'effet", /Définir comme Dispositif par défaut/.test(d) && /autre Risk Manager/.test(d), d.slice(0, 300));
  await fill(rm1, "Le 4x4 devient le défaut", "Envoyer la demande");
  t = await rm1.text();
  check("U4.4 bandeau « Demande envoyée : un tiers doit la décider »", /Demande envoyée : un tiers doit la décider/.test(t), t.slice(0, 200));
  check("U4.5 la demande est listée (« Changement du Dispositif par défaut ») sans « Confirmer seul »", /Changement du Dispositif par défaut/.test(t) && (await rm1.page.getByRole("button", { name: "Confirmer seul" }).count()) === 0);
  await rm1.shot("u4-demande");
  await rm1.page.locator("tr", { hasText: "Changement du Dispositif par défaut" }).getByRole("button", { name: "Approuver" }).click();
  await sleep(500);
  await fill(rm1, "Je m'approuve", "Approuver");
  const tt = await rm1.text();
  const dd = await dialogText(rm1);
  check("U4.6 le demandeur ne peut pas approuver : refus AFFICHÉ (fenêtre ou page)", /maker-checker|ne peut pas décider|demandeur/i.test(tt + " " + dd), (dd || tt).slice(0, 200));
  check("U4.7 base : toujours Standard", sql(`select name from risk_frameworks where tenant_id = '${T}' and is_default and archived_at is null`) === "Standard");
  await rm1.page.keyboard.press("Escape");
  await sleep(300);
  await detail(rm2, "Tranché").catch(() => undefined);
  await rm2.go("Registre").catch(() => undefined);
  await rm2.go("Dispositif de risque");
  await detail(rm2, "Tranché");
  await rm2.page.locator("tr", { hasText: "Changement du Dispositif par défaut" }).getByRole("button", { name: "Approuver" }).click();
  await sleep(500);
  await fill(rm2, "D'accord", "Approuver");
  await rm2.go("Registre").catch(() => undefined);
  await rm2.go("Dispositif de risque");
  check("U4.8 après approbation : badge sur Tranché, plus sur Standard, un seul badge", (await badge(rm2, "Tranché")) && !(await badge(rm2, "Standard")) && (await rm2.page.getByText("Par défaut", { exact: true }).count()) === 1);
  await rm2.shot("u4-tranche-defaut");

  // ---------------------------------------------------------------- U5 archivage
  await rm1.go("Registre").catch(() => undefined);
  await rm1.go("Dispositif de risque");
  await detail(rm1, "Tranché");
  await rm1.page.getByRole("button", { name: /Archiver Tranché/ }).click();
  await sleep(500);
  d = await dialogText(rm1);
  check("U5.1 fenêtre d'archivage : avertissement « Action définitive »", /Action définitive/.test(d), d.slice(0, 250));
  await fill(rm1, "Archivage du défaut", "Archiver");
  d = await dialogText(rm1);
  check("U5.2 archivage du Dispositif par défaut : refus du serveur affiché, fenêtre ouverte", (await rm1.page.locator("dialog[open]").count()) === 1 && /par défaut/.test(d), d.slice(0, 250));
  check("U5.3 base : Tranché non archivé", sql(`select archived_at is null from risk_frameworks where tenant_id = '${T}' and name = 'Tranché'`) === "t");
  await rm1.shot("u5-defaut-refuse");
  await rm1.page.keyboard.press("Escape");
  await sleep(300);

  await detail(rm1, "Renforcé");
  await rm1.page.getByRole("button", { name: /Archiver Renforcé/ }).click();
  await sleep(500);
  await fill(rm1, "     ", "Archiver");
  d = await dialogText(rm1);
  check("U5.4 motif d'espaces : refus affiché, fenêtre ouverte, Renforcé non archivé", (await rm1.page.locator("dialog[open]").count()) === 1 && sql(`select archived_at is null from risk_frameworks where tenant_id = '${T}' and name = 'Renforcé'`) === "t", d.slice(0, 250));
  await fill(rm1, "Modèle non retenu", "Archiver");
  t = await rm1.text();
  check("U5.5 archivage accepté : bandeau « Dispositif archivé. »", /Dispositif archivé\./.test(t), t.slice(0, 200));
  check("U5.6 base : Renforcé archivé avec le motif, versions archivées", sql(`select archive_reason from risk_frameworks where tenant_id = '${T}' and name = 'Renforcé'`) === "Modèle non retenu" && sql(`select count(*) from risk_framework_versions v join risk_frameworks f on f.id = v.framework_id where f.name = 'Renforcé' and f.tenant_id = '${T}' and v.status <> 'ARCHIVED'`) === "0");
  check("U5.7 plus de bouton « Archiver » ni « Définir par défaut » sur le Dispositif archivé", (await rm1.page.getByRole("button", { name: /Archiver Renforcé|Définir Renforcé/ }).count()) === 0);
  await rm1.shot("u5-archive");

  // Standard avec un processus vivant rattache
  const fwS = sql(`select id from risk_frameworks where tenant_id = '${T}' and name = 'Standard'`);
  const pid = sql(`insert into processes (tenant_id, level, name) values ('${T}','PROCESS','PW process rattaché') returning id`).split("\n")[0];
  sql(`alter table processes disable trigger processes_framework_guard`);
  sql(`update processes set risk_framework_id = '${fwS}' where id = '${pid}'`);
  sql(`alter table processes enable trigger processes_framework_guard`);
  await rm1.go("Registre").catch(() => undefined);
  await rm1.go("Dispositif de risque");
  await detail(rm1, "Standard");
  await rm1.page.getByRole("button", { name: /Archiver Standard/ }).click();
  await sleep(500);
  await fill(rm1, "Retrait de Standard", "Archiver");
  d = await dialogText(rm1);
  check("U5.8 Dispositif avec un processus vivant rattaché : refus affiché, fenêtre ouverte", (await rm1.page.locator("dialog[open]").count()) === 1 && /processus/i.test(d), d.slice(0, 250));
  check("U5.9 base : Standard non archivé", sql(`select archived_at is null from risk_frameworks where id = '${fwS}'`) === "t");
  await rm1.shot("u5-processus-refuse");
  check("U1.6 aucun « Léger » / « Prudent » en fin de parcours (liste, détails, fenêtres)", !BAD.test(await rm1.page.locator("body").innerText()));

  checkNoErrors(check, sessions, "U6");
} catch (e) {
  check("exception du parcours", false, String(e).slice(0, 500));
  for (const s of sessions) await s.shot("exception").catch(() => undefined);
}
execFileSync("/bin/bash", [join(HERE, "qa-b6c-server.sh"), "stop"], { stdio: "ignore" });
await finish(browser, failures);
