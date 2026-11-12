// QA niveau 2, import « familles et sous-categories » (q280 / q283) : parcours navigateur. VRAI backend (tsx, PostgreSQL 16 LOCAL, jamais Neon).
// Le script monte lui-meme la base `grc_qa_impui`, le serveur (qa-b6c-server.sh, port 8097) et attend vite sur 5198
// (VITE_API_BASE_URL=http://127.0.0.1:8097 VITE_AUTH_PROVIDER=local). Variables : QA_APP, QA_SHOTS.
//
// ORACLES (ecrits avant execution)
//  W1 l'onglet « Seuils d'appétence » d'un brouillon porte le panneau « Importer les familles et sous-catégories » (format, limites, « aucun seuil ni donnée personnelle »).
//  W2 fichier a erreurs : l'apercu dit « rien n'a été écrit », liste chaque verdict du serveur avec son numero de ligne, AUCUN bouton de confirmation ; base inchangee, aucune ligne d'audit.
//  W3 fichier valide : apercu (seuils 4 et 9), bouton « Confirmer l'import de N entrées », « Import terminé », entrees dans le formulaire avec « valeur de départ à confirmer », base = 4 / 9.
//  W4 refus d'emblee affiches dans le panneau (« Import impossible ») : Latin-1 (ligne citee), fichier vide, extension .csv, binaire ; aucune ecriture.
//  W5 reimport du meme fichier : lignes « Conservée », 0 acceptee, pas de bouton de confirmation.
//  W6 compte sans appartenance au groupe RM mais avec riskframework.update (adm) : l'apercu passe, le commit est refuse (403 metier) : le refus doit etre AFFICHE a l'ecran.
//  W7 zero erreur JS, aucune erreur console imprevue (hors 4xx provoques).
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
const API = "http://127.0.0.1:8097";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/import";
mkdirSync(SHOTS, { recursive: true });
const DBN = "grc_qa_impui";
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", DBN, "-Atq"];
const sql = (q) => execFileSync("/usr/bin/psql", [...PG, "-c", q], { encoding: "utf8" }).trim();
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const { check, failures } = verdicts();
const EMAIL = { rm1: "rm1@b6c.test", rm2: "rm2@b6c.test", adm: "adm@b6c.test" };
const { login, api } = localApi(API, EMAIL);

execFileSync("bash", [join(HERE, "qa-visibility-v1-setup.sh"), "up", DBN], { stdio: "ignore" });
const RM = sql(`select id from roles where tenant_id = '${T}' and system_group = 'RISK_MANAGER'`);
const granter = sql(`select id from users where email = 'adm@vv1.test'`);
const mk = (n, perms = "{}") => sql(`insert into users (tenant_id, email, display_name, roles) values ('${T}','${n}@b6c.test','${n}','${perms}') returning id`).split("\n")[0];
for (const n of ["rm1", "rm2"]) { const id = mk(n); sql(`insert into user_roles (tenant_id, role_id, user_id, granted_by) values ('${T}','${RM}','${id}','${granter}')`); }
mk("adm", "{riskframework.read,riskframework.create,riskframework.update,riskframework.activate,riskframework.archive,riskframework.process.assign,risk.read,process.read}");
const cat = (name, parent) => sql(`insert into risk_categories (tenant_id, name, parent_id) values ('${T}','${name}',${parent ? `'${parent}'` : "null"}) returning id`).split("\n")[0];
const RA = cat("Risques opérationnels");
for (const n of ["Fraude interne", "Fraude sur transactions mobiles", "Fuite de données clients", "Risque de liquidité", "Rançongiciel"]) cat(n, RA);
execFileSync("bash", [join(HERE, "qa-b6c-server.sh"), "start"], { env: { ...process.env, QA_PORT: "8097", QA_DB: DBN }, stdio: "ignore" });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const sessions = [];
const open = async (who) => { const s = await openSession(browser, { app: APP, email: EMAIL[who], shots: SHOTS, who }); sessions.push(s); return s; };
const GOOD = "# test\nFraude;Fraude interne\nFraude;Fraude sur transactions mobiles\nDonnées et vie privée;Fuite de données clients\nFinancier;Risque de liquidité\n";
const file = (name, content, mimeType = "text/plain") => ({ name, mimeType, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8") });
let VID = "";
const appetiteCount = () => Number(sql(`select jsonb_array_length(appetite_thresholds) from risk_framework_versions where id = '${VID}'`));
const auditCount = () => Number(sql(`select count(*) from audit_log where tenant_id = '${T}' and entity_type <> 'Notification'`));
const panel = (s) => s.page.locator("div, section").filter({ hasText: "Importer les familles et sous-catégories" }).last();
const pick = async (s, f) => { await s.page.locator('input[type="file"]').setInputFiles(f); await sleep(300); };
const openAppetite = async (s) => {
  await s.go("Dispositif de risque");
  await s.page.getByRole("button", { name: /Voir le détail de Standard/ }).first().click();
  await sleep(1200);
  await s.page.getByText("Seuils d'appétence", { exact: true }).first().click();
  await sleep(800);
};
try {
  await login("rm1");
  const prov = await api("rm1", "POST", "/risk-frameworks/defaults", {});
  check("setup.1 modeles par defaut crees", prov.status === 201, JSON.stringify(prov.json).slice(0, 100));
  VID = sql(`select v.id from risk_framework_versions v join risk_frameworks f on f.id = v.framework_id where f.name = 'Standard' and f.tenant_id = '${T}'`);

  const rm1 = await open("rm1");
  await openAppetite(rm1);
  let t = await rm1.text();
  check("W1 panneau d'import present avec format, limites et mise en garde", /Importer les familles et sous-catégories/.test(t) && /64 Ko et 200 lignes/.test(t) && /aucun seuil ni donnée personnelle/.test(t), t.slice(0, 300));
  await rm1.shot("w1-panneau");

  // W2 erreurs
  const a0 = auditCount();
  await pick(rm1, file("erreurs.txt", "Fraude;Fraude interne\nBanane;Risque de liquidité\nFraude;Inventée\nFraude;Risques opérationnels\n"));
  await rm1.page.getByRole("button", { name: "Aperçu (sans écriture)" }).click();
  await sleep(1500);
  t = await rm1.text();
  check("W2.1 aperçu : « rien n'a été écrit », 4 lignes lues, 1 acceptée, 3 erreurs", /Aperçu : rien n'a été écrit/.test(t) && /4 lignes lues : 1 acceptée, 0 conservée, 0 avertissement, 3 erreurs/.test(t), t.slice(t.indexOf("Aperçu"), t.indexOf("Aperçu") + 250));
  check("W2.2 chaque verdict du serveur est affiché (famille inconnue, absente, premier niveau)", /Famille inconnue/.test(t) && /absente du référentiel/.test(t) && /premier niveau/.test(t));
  check("W2.3 AUCUN bouton de confirmation quand une erreur existe", (await rm1.page.getByRole("button", { name: /Confirmer l'import/ }).count()) === 0);
  check("W2.4 base : brouillon inchangé, aucun audit", appetiteCount() === 0 && auditCount() === a0);
  await rm1.shot("w2-erreurs");

  // W4 refus d'emblee
  const refus = [
    ["Latin-1", file("latin1.txt", Buffer.from("Fraude;Fraude interne\nConformit\xe9;x\n", "latin1")), /UTF-8.*ligne 2/],
    ["vide", file("vide.txt", ""), /vide/],
    ["extension .csv", file("f.csv", GOOD, "text/csv"), /texte|\.txt/],
    ["binaire (PK)", file("zip.txt", Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from("x")])), /texte/],
  ];
  for (const [label, f, re] of refus) {
    await pick(rm1, f);
    await rm1.page.getByRole("button", { name: "Aperçu (sans écriture)" }).click();
    await sleep(1200);
    t = await rm1.text();
    check(`W4 ${label} : « Import impossible » avec un message clair affiché dans le panneau`, /Import impossible/.test(t) && re.test(t), t.slice(t.indexOf("Import impossible"), t.indexOf("Import impossible") + 220));
  }
  check("W4.5 base toujours inchangée", appetiteCount() === 0 && auditCount() === a0);

  // W3 valide
  await pick(rm1, file("familles.txt", GOOD));
  await rm1.page.getByRole("button", { name: "Aperçu (sans écriture)" }).click();
  await sleep(1500);
  t = await rm1.text();
  check("W3.1 aperçu : 4 acceptées, seuils appliqués 4 (strictes) et 9 (autres)", /4 lignes lues : 4 acceptées/.test(t) && /Seuils appliqués : 4 \(familles strictes\), 9 \(autres\)/.test(t), t.slice(t.indexOf("Aperçu"), t.indexOf("Aperçu") + 260));
  check("W3.2 familles strictes sans sous-catégorie signalées (Conformité, Cybersécurité)", /famille stricte « Conformité »/.test(t) && /famille stricte « Cybersécurité »/.test(t));
  check("W3.3 sous-catégories sans famille listées (Rançongiciel)", /Rançongiciel/.test(t));
  check("W3.4 toujours rien d'écrit avant la confirmation", appetiteCount() === 0 && auditCount() === a0);
  await rm1.shot("w3-apercu");
  await rm1.page.getByRole("button", { name: /Confirmer l'import de 4 entrées/ }).click();
  await sleep(2000);
  t = await rm1.text();
  check("W3.5 « Import terminé » : 4 entrées ajoutées avec la mention", /Import terminé/.test(t) && /4 entrées ajoutées au brouillon/.test(t) && /valeur de départ à confirmer/.test(t), t.slice(t.indexOf("Import terminé"), t.indexOf("Import terminé") + 200));
  const rows = sql(`select string_agg((e->>'subCategory') || '=' || (e->>'threshold'), ',' order by e->>'subCategory') from risk_framework_versions v, jsonb_array_elements(v.appetite_thresholds) e where v.id = '${VID}'`);
  check("W3.6 base : seuils 4 (Fraude x2, Données) et 9 (Financier)", rows === "Fraude interne=4,Fraude sur transactions mobiles=4,Fuite de données clients=4,Risque de liquidité=9", rows);
  check("W3.7 les entrées apparaissent dans le formulaire du brouillon", /Fraude sur transactions mobiles/.test(await rm1.text()));
  await rm1.shot("w3-termine");

  // W5 reimport
  await rm1.page.getByRole("button", { name: "Nouvel import" }).click();
  await pick(rm1, file("familles.txt", GOOD));
  await rm1.page.getByRole("button", { name: "Aperçu (sans écriture)" }).click();
  await sleep(1500);
  t = await rm1.text();
  check("W5.1 réimport : 4 conservées, 0 acceptée", /4 conservées/.test(t) && /0 acceptée/.test(t), t.slice(t.indexOf("Aperçu"), t.indexOf("Aperçu") + 220));
  check("W5.2 pas de bouton de confirmation (rien à ajouter)", (await rm1.page.getByRole("button", { name: /Confirmer l'import/ }).count()) === 0);

  // W6 compte hors groupe RM
  const adm = await open("adm");
  await openAppetite(adm);
  const fresh = "Fraude;Rançongiciel\n";
  await pick(adm, file("adm.txt", fresh));
  await adm.page.getByRole("button", { name: "Aperçu (sans écriture)" }).click();
  await sleep(1500);
  t = await adm.text();
  check("W6.1 aperçu autorisé pour un compte sans appartenance au groupe RM (observation)", /Aperçu : rien n'a été écrit/.test(t), t.slice(0, 200));
  const before = appetiteCount();
  const confirm = adm.page.getByRole("button", { name: /Confirmer l'import/ });
  if ((await confirm.count()) > 0) {
    await confirm.click();
    await sleep(1800);
    t = await adm.text();
    const dlg = norm(await adm.page.locator("dialog[open]").innerText().catch(() => ""));
    check("W6.2 refus du serveur (groupe Risk Manager) AFFICHÉ à l'écran (panneau, page ou fenêtre)", /Réservé aux membres du groupe Risk Manager/.test(t + " " + dlg), `dialogue=${dlg.slice(0, 120)} | page=${t.slice(t.indexOf("Importer"), t.indexOf("Importer") + 200)}`);
    check("W6.3 base inchangée", appetiteCount() === before);
    await adm.shot("w6-refus");
  } else check("W6.2 bouton de confirmation présent pour adm", false, "absent");

  checkNoErrors(check, sessions, "W7");
} catch (e) {
  check("exception du parcours", false, String(e).slice(0, 500));
  for (const s of sessions) await s.shot("exception").catch(() => undefined);
}
execFileSync("bash", [join(HERE, "qa-b6c-server.sh"), "stop"], { stdio: "ignore" });
await finish(browser, failures);
