// QA-F8 : parcours navigateur des ecrans « Mise en service » (F8 R1, q165, DECISION-058/080/118) contre le VRAI backend
// (tsx, PostgreSQL LOCAL 127.0.0.1:55442, identite locale, stockage Drive en memoire du preload QA ; jamais Neon).
//
// Prerequis :
//   bash tests/integration/qa-visibility-v1-setup.sh up grc_qa_f8
//   backend : QA_PORT=8397 QA_DB=grc_qa_f8, CORS_ALLOWED_ORIGINS=http://127.0.0.1:5497 (voir qa-visibility-v1-server.sh)
//   vite    : 127.0.0.1:5497, VITE_API_BASE_URL=http://127.0.0.1:8397 VITE_AUTH_PROVIDER=local (apres `npm run build` du design system)
//
// ORACLES (ecrits avant l'execution)
//  1. adm (branding.*, config.read/manage) : les 4 entrees « Mise en service » existent ; aud (branding.read + config.read) : Image de marque et Modules seulement ;
//     out (aucun droit) : aucune des 4.
//  2. Modules : une ligne par module renvoye par l'API ; motif vide : aucun PATCH ; motif d'espaces : le serveur refuse (400), son texte s'affiche, etat inchange ;
//     motif valide -> PATCH { enabled: !etat, reason } ; l'API reflete l'etat ; audit STATUS_CHANGE avec motif ; champ motif plafonne a 500 ; double clic = un seul PATCH.
//     aud (config.read sans config.manage) : PATCH refuse 403 « Missing permission: config.manage » explique a l'ecran, etat inchange.
//  3. Clients : écran retiré (SEC-F8-01, q260) ; aucune entrée de menu, même pour adm ; GET /tenants refusé à aud.
//  4. Import : apercu sans ecriture (0 risque cree) ; commit cree exactement validCount risques ; fichier non xlsx -> erreur serveur affichee ; fichier vide / sans en-tetes : pas de bouton Importer.
//  5. Branding : fichier .txt -> refus serveur affiche, logo inchange ; PNG -> POST multipart, API reflete le logo ; aud : upload 403.
//  6. client.ts : appels JSON = application/json ; multipart = multipart/form-data; boundary=..., jamais application/json.
//  7. aucune erreur JS / console imprevue.
import { checkNoErrors, finish, localApi, openSession, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const backendRequire = createRequire(new URL("../../backend/node_modules/", import.meta.url).pathname);
const { Client } = backendRequire("pg");
const ExcelJS = backendRequire("exceljs");

const API = process.env.QA_API ?? "http://127.0.0.1:8397";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5497";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/f8";
const DB = process.env.QA_DB ?? "postgres://postgres@127.0.0.1:55442/grc_qa_f8";
const TMP = process.env.QA_TMP ?? mkdtempSync(join(tmpdir(), "qaf8-files-"));
const EMAIL = { adm: "adm@vv1.test", aud: "aud@vv1.test", out: "out@vv1.test" };
mkdirSync(SHOTS, { recursive: true }); if (process.env.QA_TMP) mkdirSync(TMP, { recursive: true });

const { check, failures } = verdicts();
const { TOK, login, api } = localApi(API, EMAIL);

async function xlsx(path, rows, header = ["process", "description"]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Risques");
  ws.addRow(header); rows.forEach((r) => ws.addRow(r));
  await wb.xlsx.writeFile(path);
}
const MIXED = `${TMP}/mixte.xlsx`;
await xlsx(MIXED, [["Achats", "Fraude fournisseur QA-F8"], ["", "Sans processus"], ["Paie", "Erreur de paie QA-F8"], ["Ventes", ""]]);
const EMPTY = `${TMP}/vide.xlsx`; await xlsx(EMPTY, []);
const BADHDR = `${TMP}/mauvais-entetes.xlsx`; await xlsx(BADHDR, [["a", "b"]], ["foo", "bar"]);
const FAKE = `${TMP}/faux.xlsx`; writeFileSync(FAKE, "ceci n'est pas un classeur");
const PNG = `${TMP}/logo.png`;
writeFileSync(PNG, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const TXT = `${TMP}/note.txt`; writeFileSync(TXT, "pas une image");

const db = new Client({ connectionString: DB }); await db.connect();
await db.query(`UPDATE users SET roles = roles || $2::text[] WHERE email = $1`, [EMAIL.adm, ["branding.read", "branding.update", "config.read", "config.manage"]]);
await db.query(`UPDATE users SET roles = roles || $2::text[] WHERE email = $1`, [EMAIL.aud, ["branding.read", "config.read"]]);
const count = async (sql, p = []) => Number((await db.query(sql, p)).rows[0].n);
const risksBefore = await count(`SELECT count(*) n FROM risks WHERE description LIKE '%QA-F8%'`);

const browser = await chromium.launch();
const reqs = [];
const norm = (s) => s.replace(/\s+/g, " ").trim();
async function session(who) {
  const S = await openSession(browser, { app: APP, email: EMAIL[who], shots: SHOTS, who });
  S.page.on("request", (r) => {
    if (r.url().startsWith(API) && r.method() !== "GET" && r.method() !== "OPTIONS") {
      const pd = r.postData();
      reqs.push({ who, method: r.method(), path: new URL(r.url()).pathname, ct: r.headers()["content-type"] ?? null, body: pd && pd.length < 2000 ? pd : "(binaire)" });
    }
  });
  return S;
}
const lastReq = (path, method) => [...reqs].reverse().find((r) => r.path === path && r.method === method);
const modState = async (n) => (await api("adm", "GET", "/modules")).json.data.find((m) => m.moduleName === n).enabled;
async function rawUpload(who, path, file, type, name) {
  const fd = new FormData(); fd.append("file", new Blob([file], { type }), name);
  return (await fetch(`${API}/api/v1${path}`, { method: "POST", headers: { authorization: `Bearer ${TOK[who]}` }, body: fd })).status;
}
try {
  for (const w of ["adm", "aud", "out"]) await login(w);

  // ---------- 1. menu
  const O = await session("out");
  for (const l of ["Image de marque", "Modules", "Clients", "Import Excel"]) check(`1.out sans entree « ${l} »`, !(await O.hasEntry(l)));
  const U = await session("aud");
  check("1.aud entree Image de marque", await U.hasEntry("Image de marque"));
  check("1.aud entree Modules", await U.hasEntry("Modules"));
  check("1.aud sans Clients", !(await U.hasEntry("Clients")));
  check("1.aud sans Import Excel", !(await U.hasEntry("Import Excel")));
  const A = await session("adm");
  for (const l of ["Image de marque", "Modules", "Import Excel"]) check(`1.adm entree « ${l} »`, await A.hasEntry(l));

  // ---------- 2. Modules
  const mods = (await api("adm", "GET", "/modules")).json.data;
  await A.go("Modules");
  let txt = await A.text();
  check("2.1 une ligne par module de l'API", (await A.page.locator("main tbody tr").count()) === mods.length, `${mods.length} modules`);
  check("2.2 « Jamais modifié » affiché pour les modules sans id", mods.every((m) => m.id || txt.includes("Jamais modifié")));
  const row = A.page.locator("main tbody tr", { hasText: "Cartographie" });
  const wasEnabled = await modState("CARTOGRAPHY");
  await row.getByRole("button").click();
  const dlg = A.page.getByRole("dialog");
  await dlg.waitFor();
  const before = reqs.length;
  await dlg.getByRole("button", { name: "Confirmer" }).click(); await A.page.waitForTimeout(600);
  check("2.3 motif vide : aucun PATCH envoyé (champ required)", reqs.length === before && (await dlg.isVisible()));
  await dlg.locator("#module-reason").fill("     ");
  await dlg.getByRole("button", { name: "Confirmer" }).click(); await A.page.waitForTimeout(1200);
  const r24 = lastReq("/api/v1/modules/CARTOGRAPHY/toggle", "PATCH");
  const dtxt = norm(await dlg.innerText().catch(() => ""));
  check("2.4 motif d'espaces : état inchangé", (await modState("CARTOGRAPHY")) === wasEnabled, `PATCH=${r24?.body}`);
  check("2.5 motif d'espaces : message serveur visible (pas de silence)", /obligatoire|required|reason|motif/i.test(dtxt.replace(/Motif \(obligatoire\)/, "")), dtxt.slice(0, 240));
  await A.shot("modules-espaces");
  check("2.6 champ motif plafonné à 500", (await dlg.locator("#module-reason").getAttribute("maxlength")) === "500");
  await dlg.locator("#module-reason").fill("Motif QA-F8 valide");
  await dlg.getByRole("button", { name: "Confirmer" }).click(); await A.page.waitForTimeout(1500);
  const r27 = lastReq("/api/v1/modules/CARTOGRAPHY/toggle", "PATCH");
  const b27 = r27 ? JSON.parse(r27.body) : {};
  check("2.7 PATCH corps { enabled: !état, reason } en JSON", b27.enabled === !wasEnabled && b27.reason === "Motif QA-F8 valide" && Object.keys(b27).length === 2 && r27.ct?.startsWith("application/json"), JSON.stringify(r27));
  check("2.8 l'API reflète le nouvel état", (await modState("CARTOGRAPHY")) === !wasEnabled);
  check("2.9 audit STATUS_CHANGE avec motif", (await count(`SELECT count(*) n FROM audit_log WHERE entity_type='ModuleToggle' AND action='STATUS_CHANGE' AND reason='Motif QA-F8 valide'`)) === 1);
  txt = await A.text();
  check("2.10 bandeau de succès et ligne à jour", /Changement appliqué/.test(txt) && (await row.innerText()).includes(wasEnabled ? "Désactivé" : "Activé"), txt.slice(0, 200));
  check("2.11 effet serveur observé : module coupé => cartographie refusée (info)", wasEnabled ? (await api("adm", "GET", "/cartography/summary")).status !== 200 : true);
  await row.getByRole("button").click(); await A.page.locator("#module-reason").fill("Retour QA-F8");
  await A.page.getByRole("button", { name: "Confirmer" }).click(); await A.page.waitForTimeout(1500);
  check("2.12 aller-retour : état initial rétabli", (await modState("CARTOGRAPHY")) === wasEnabled);
  await row.getByRole("button").click(); await A.page.locator("#module-reason").fill("Double clic QA-F8");
  const nb = reqs.filter((r) => r.path.endsWith("/toggle")).length;
  await A.page.getByRole("button", { name: "Confirmer" }).dblclick(); await A.page.waitForTimeout(1500);
  const sent = reqs.filter((r) => r.path.endsWith("/toggle")).length - nb;
  check("2.13 double clic sur Confirmer : un seul PATCH", sent === 1, `${sent} PATCH`);
  await A.page.waitForTimeout(500);
  if ((await modState("CARTOGRAPHY")) !== wasEnabled) {
    await row.getByRole("button").click(); await A.page.locator("#module-reason").fill("Rétablissement QA-F8");
    await A.page.getByRole("button", { name: "Confirmer" }).click(); await A.page.waitForTimeout(1200);
  }
  check("2.14 état initial rétabli", (await modState("CARTOGRAPHY")) === wasEnabled);
  check("2.15 serveur : motif 501 refusé (400)", (await api("adm", "PATCH", "/modules/CARTOGRAPHY/toggle", { enabled: wasEnabled, reason: "x".repeat(501) })).status === 400);
  check("2.16 serveur : module inconnu refusé (400)", (await api("adm", "PATCH", "/modules/NOPE/toggle", { enabled: true, reason: "x" })).status === 400);

  await U.go("Modules");
  await U.page.locator("main tbody tr", { hasText: "Risques" }).getByRole("button").click();
  await U.page.locator("#module-reason").fill("Tentative aud QA-F8");
  await U.page.getByRole("button", { name: "Confirmer" }).click(); await U.page.waitForTimeout(1500);
  const utxt = norm(await U.page.locator("body").innerText());
  check("2.17 aud : état inchangé", (await modState("RISK")) === true);
  check("2.18 aud : le refus 403 est expliqué (dialogue global « Vous n’avez pas ce droit »)", /Vous n’avez pas ce droit/.test(utxt), utxt.slice(-300));
  await U.page.getByRole("button", { name: "Fermer" }).click();
  await U.shot("modules-403");

  // ---------- 3. Clients : écran retiré (SEC-F8-01, q260) — il ne doit être atteignable par personne
  check("3.1 adm sans entrée « Clients » (écran non exposé avant q260)", !(await A.hasEntry("Clients")));
  check("3.2 aud : GET /tenants refusé 403", (await api("aud", "GET", "/tenants")).status === 403);

  // ---------- 4. Import Excel
  await A.go("Import Excel");
  const imp = async (file) => { await A.page.locator('input[type="file"]').setInputFiles(file); await A.page.waitForTimeout(300); };
  const prevBtn = A.page.getByRole("button", { name: /Aperçu/ });
  check("4.1 Aperçu désactivé sans fichier", await prevBtn.isDisabled());
  await imp(MIXED); await prevBtn.click(); await A.page.waitForTimeout(1500);
  txt = await A.text();
  check("4.2 aperçu : 4 lignes, 2 valides, 2 refusées (chiffres du serveur)", /4 lignes lues : 2 valides, 2 refusées/.test(txt), txt.slice(0, 300));
  check("4.3 aperçu : aucun risque créé", (await count(`SELECT count(*) n FROM risks WHERE description LIKE '%QA-F8%'`)) === risksBefore);
  check("4.4 raisons de refus du serveur affichées", /Refusée/.test(txt));
  const rpv = lastReq("/api/v1/import/excel/preview", "POST");
  check("4.5 preview multipart, pas application/json", rpv?.ct?.startsWith("multipart/form-data; boundary="), rpv?.ct);
  await A.shot("import-preview");
  const commitBtn = A.page.getByRole("button", { name: /Importer 2 lignes valides/ });
  check("4.6 bouton « Importer 2 lignes valides »", (await commitBtn.count()) === 1);
  await commitBtn.click(); await A.page.waitForTimeout(2000);
  txt = await A.text();
  check("4.7 commit : exactement 2 risques créés", (await count(`SELECT count(*) n FROM risks WHERE description LIKE '%QA-F8%'`)) === risksBefore + 2);
  check("4.8 bandeau « 2 risques créés sur 4 lignes »", /2 risques créés sur 4 lignes/.test(txt), txt.slice(0, 300));
  check("4.9 plus de bouton Importer après commit", (await A.page.getByRole("button", { name: /^Importer/ }).count()) === 0);
  check("4.9b Aperçu verrouillé après commit (pas de réimport du même fichier, Codex P2)", await prevBtn.isDisabled());
  await A.page.getByRole("button", { name: "Nouvel import" }).click();
  check("4.10 Nouvel import remet à zéro", !/Détail par ligne/.test(await A.text()));
  await imp(FAKE); await prevBtn.click(); await A.page.waitForTimeout(1500);
  txt = await A.text();
  check("4.11 faux xlsx : erreur affichée, pas de rapport", /Import impossible/.test(txt) && !/Détail par ligne/.test(txt), txt.slice(0, 250));
  await A.shot("import-faux");
  await imp(EMPTY); await prevBtn.click(); await A.page.waitForTimeout(1500);
  txt = await A.text();
  check("4.12 classeur sans ligne : pas de bouton Importer", (await A.page.getByRole("button", { name: /^Importer/ }).count()) === 0, txt.slice(0, 250));
  await imp(BADHDR); await prevBtn.click(); await A.page.waitForTimeout(1500);
  txt = await A.text();
  check("4.13 mauvais en-têtes : pas de bouton Importer, retour visible", (await A.page.getByRole("button", { name: /^Importer/ }).count()) === 0 && txt.length > 60, txt.slice(0, 250));
  await imp(MIXED); await prevBtn.click(); await A.page.waitForTimeout(1200);
  await imp(EMPTY);
  check("4.14 nouvelle sélection : ancien aperçu effacé", !/Détail par ligne/.test(await A.text()));
  check("4.15 aud : preview refusé 403", (await rawUpload("aud", "/import/excel/preview", readFileSync(MIXED), "application/octet-stream", "m.xlsx")) === 403);
  check("4.16 aud : commit refusé 403, rien créé", (await rawUpload("aud", "/import/excel/commit", readFileSync(MIXED), "application/octet-stream", "m.xlsx")) === 403 && (await count(`SELECT count(*) n FROM risks WHERE description LIKE '%QA-F8%'`)) === risksBefore + 2);

  // ---------- 5. Branding
  await A.go("Image de marque");
  const b0 = (await api("adm", "GET", "/branding")).json.data;
  txt = await A.text();
  check("5.1 état initial conforme à l'API", b0.logoDriveFileId ? /Un logo est enregistré/.test(txt) : /Aucun logo enregistré/.test(txt), txt.slice(0, 200));
  const save = A.page.getByRole("button", { name: "Enregistrer le logo" });
  check("5.2 Enregistrer désactivé sans fichier", await save.isDisabled());
  await A.page.locator('input[type="file"]').setInputFiles(TXT); await A.page.waitForTimeout(300);
  if (await save.isEnabled()) { await save.click(); await A.page.waitForTimeout(1500); }
  txt = await A.text();
  const b1 = (await api("adm", "GET", "/branding")).json.data;
  check("5.3 .txt : logo inchangé", b1.logoDriveFileId === b0.logoDriveFileId);
  check("5.3b .txt : refus serveur affiché (ou fichier refusé par le sélecteur)", /Logo must be one of|png|jpeg/i.test(txt), txt.slice(0, 300));
  await A.shot("branding-txt");
  await A.page.locator('input[type="file"]').setInputFiles(PNG); await A.page.waitForTimeout(300);
  await save.click(); await A.page.waitForTimeout(2000);
  const rb = lastReq("/api/v1/branding", "POST");
  check("5.4 POST multipart sans application/json", rb?.ct?.startsWith("multipart/form-data; boundary="), rb?.ct);
  const b2 = (await api("adm", "GET", "/branding")).json.data;
  check("5.5 API : logo enregistré", !!b2.logoDriveFileId && b2.logoDriveFileId !== b0.logoDriveFileId);
  txt = await A.text();
  check("5.6 écran : « Logo enregistré » + « Un logo est enregistré »", /Logo enregistré/.test(txt) && /Un logo est enregistré/.test(txt), txt.slice(0, 300));
  check("5.7 lien du logo : https seulement + noopener (ou absent)", await (async () => {
    const a = A.page.locator("main a", { hasText: "Ouvrir le logo" });
    if ((await a.count()) === 0) return true;
    return /^https:/i.test(await a.getAttribute("href")) && /noopener/.test(await a.getAttribute("rel"));
  })(), `logoUrl=${b2.logoUrl}`);
  await A.shot("branding-ok");
  check("5.8 aud : upload refusé 403 par le serveur", (await rawUpload("aud", "/branding", Buffer.from("x"), "image/png", "a.png")) === 403);
  await U.go("Image de marque");
  check("5.9 aud : écran sans erreur de chargement", !/Chargement impossible/.test(await U.text()));

  // ---------- 6. regression client.ts
  const jsonCalls = reqs.filter((r) => !r.ct?.startsWith("multipart"));
  check("6.1 tous les appels JSON portent application/json", jsonCalls.length > 0 && jsonCalls.every((r) => r.ct?.startsWith("application/json")), jsonCalls.map((r) => r.ct).join(","));
  check("6.2 tous les multipart portent un boundary", reqs.filter((r) => r.ct?.startsWith("multipart")).length >= 3 && reqs.filter((r) => r.ct?.startsWith("multipart")).every((r) => /boundary=/.test(r.ct)));

  checkNoErrors(check, [A, U, O], "7");
} catch (e) { check("EXCEPTION " + e.message, false, e.stack?.split("\n")[1]); }
await db.end();
await finish(browser, failures);
